// Shader warm-up beyond what renderer.compileAsync(scene) reaches. The scene
// compile covers every material in the garden; the first frame would still
// compile, one by one on the main thread, the programs the frame uses for
// other things: the shadow pass's depth materials and the post-processing
// chain's own. Both are prepared here so they too compile in parallel behind
// the loading veil (see RenderBudget's Opening). Then predraw draws each part
// once, a group per frame, so the driver's draw-time work is done before the
// first real frame instead of freezing it.
//
// Programs are shared by their parameters, not by material identity, so a
// stand-in material with the same parameters as the one three will use is
// enough to put the right program in the cache. Everything here is best
// effort: whatever is missed simply compiles on the first frame, as before.
import * as THREE from "three";
import type { EffectComposer } from "postprocessing";

/** The side a shadow pass draws, as three's WebGLShadowMap maps it. */
const SHADOW_SIDE: Record<THREE.Side, THREE.Side> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
};

type Drawable = THREE.Mesh | THREE.Points | THREE.Line;

/** How a warm-up step compiles: renderer.compileAsync by default, or a pinned compile (lightSets). */
export type Compile = (scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null) => Promise<unknown>;
const asyncCompile = (gl: THREE.WebGLRenderer): Compile => (s, c, t) => gl.compileAsync(s, c, t);
const isDrawable = (o: THREE.Object3D): o is Drawable =>
  (o as THREE.Mesh).isMesh === true || (o as THREE.Points).isPoints === true || (o as THREE.Line).isLine === true;

/** userData key marking a tier layer's group (TierLayers.tsx). */
export const TIER_LAYER = "tierLayer";

/**
 * Like Object3D.traverse, but never enters a hidden tier layer: a tier being
 * prepared out of sight (TierLayers) has its own lights, and compiling its
 * parts under the live layer's would only build programs nothing draws.
 */
export function traverseShown(root: THREE.Object3D, visit: (o: THREE.Object3D) => void): void {
  if (root.userData[TIER_LAYER] === true && !root.visible) return;
  visit(root);
  for (const c of root.children) traverseShown(c, visit);
}

/**
 * The depth programs the sun's shadow pass will need: for each shadow caster
 * its custom depth material, or a stand-in for three's internal one, given
 * the same side, alpha test and maps the shadow pass copies onto it, on a
 * stand-in object of the same kind (instanced or not, with or without
 * instance colours), compiled into the target the pass draws to.
 */
export function compileShadowCasters(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  compile: Compile = asyncCompile(gl),
): Promise<unknown> {
  interface Use {
    depth: THREE.MeshDepthMaterial;
    proxy: THREE.Object3D;
    apply: () => void;
  }
  // One custom depth material can serve casters of different sides; three
  // sets the side per draw, so each variant needs its own compile. Casters
  // are dealt into rounds in which every depth material appears once.
  const rounds: Use[][] = [];
  const variants = new Map<THREE.Material, string[]>();
  const standIns = new Map<string, THREE.MeshDepthMaterial>();
  traverseShown(scene, (o) => {
    if (!isDrawable(o) || !o.castShadow || Array.isArray(o.material)) return;
    const m = o.material as THREE.Material & {
      map?: THREE.Texture | null;
      alphaMap?: THREE.Texture | null;
      displacementMap?: THREE.Texture | null;
      displacementScale?: number;
    };
    const custom = (o as THREE.Mesh).customDepthMaterial as THREE.MeshDepthMaterial | undefined;
    const side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : SHADOW_SIDE[m.side];
    const alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
    const im = o as THREE.InstancedMesh;
    const kind = im.isInstancedMesh ? (im.instanceColor ? "ic" : "i") : o.type;
    const signature = `${kind}|${side}|${alphaTest > 0}|${Boolean(m.map)}|${Boolean(m.alphaMap)}|${Boolean(m.displacementMap)}`;
    let depth: THREE.MeshDepthMaterial;
    if (custom) depth = custom;
    else {
      let d = standIns.get(signature);
      if (!d) {
        d = new THREE.MeshDepthMaterial();
        standIns.set(signature, d);
      }
      depth = d;
    }
    const seen = variants.get(depth) ?? [];
    variants.set(depth, seen);
    let round = seen.indexOf(signature);
    if (round < 0) {
      round = seen.length;
      seen.push(signature);
    } else return; // this material already compiles with this state in an earlier round
    let proxy: THREE.Object3D;
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const src = o as THREE.InstancedMesh;
      const im = new THREE.InstancedMesh(src.geometry, depth, 1);
      im.instanceColor = src.instanceColor;
      proxy = im;
    } else if ((o as THREE.Points).isPoints) proxy = new THREE.Points(o.geometry, depth);
    else if ((o as THREE.Line).isLine) proxy = new THREE.Line(o.geometry, depth);
    else proxy = new THREE.Mesh(o.geometry, depth);
    const apply = () => {
      depth.side = side;
      depth.alphaTest = alphaTest;
      depth.map = m.map ?? null;
      depth.alphaMap = m.alphaMap ?? null;
      depth.displacementMap = m.displacementMap ?? null;
      if (m.displacementScale !== undefined) depth.displacementScale = m.displacementScale;
    };
    (rounds[round] ??= []).push({ depth, proxy, apply });
  });
  // The shadow pass draws with no scene (so no fog) but under the scene's
  // lights; the compile borrows the scene for its lights with the fog lifted.
  const previous = gl.getRenderTarget();
  const fog = scene.fog;
  const jobs: Promise<unknown>[] = [];
  try {
    gl.setRenderTarget(target);
    scene.fog = null;
    for (const round of rounds) {
      const group = new THREE.Scene();
      for (const use of round) {
        use.apply();
        group.add(use.proxy);
      }
      // The stand-ins are left to the garbage collector, never disposed:
      // disposing a material releases its program, and these programs are the point.
      jobs.push(compile(group, camera, scene));
    }
  } finally {
    scene.fog = fog;
    gl.setRenderTarget(previous);
  }
  return Promise.all(jobs);
}

/**
 * A transmissive, double-sided material (the leaves on cinematic and
 * balanced) is drawn back faces first into the transmission buffer each
 * frame, as a BackSide variant of its program; that variant is compiled here.
 */
export function compileTransmissionBackfaces(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  compile: Compile = asyncCompile(gl),
): Promise<unknown> {
  const jobs: Promise<unknown>[] = [];
  const previous = gl.getRenderTarget();
  try {
    gl.setRenderTarget(target);
    traverseShown(scene, (o) => {
      if (!isDrawable(o) || Array.isArray(o.material)) return;
      const m = o.material as THREE.MeshPhysicalMaterial;
      if (!(m.transmission > 0) || m.side !== THREE.DoubleSide) return;
      m.side = THREE.BackSide;
      m.needsUpdate = true;
      jobs.push(compile(o, camera, scene));
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    });
  } finally {
    gl.setRenderTarget(previous);
  }
  return Promise.all(jobs);
}

/** The stand-in scene withStandIn lends out, and whether it is lent right now. */
let stand: THREE.Scene | null = null;
let lent = false;

/**
 * Runs `f` on a stand-in for `scene`: a scene of its own holding the same
 * objects (they keep their parent), all but `leaveOut`, with the scene's fog
 * and environment. Compiles and draws in it see whatever lights the caller
 * has switched in for the moment (another light set, a tier prepared out of
 * sight), and being another scene it has its own light state in the
 * renderer: the live scene's never changes, so the live garden's lit
 * materials never have to look their programs up again on the next frame.
 */
export function withStandIn(scene: THREE.Scene, f: (stand: THREE.Scene) => void, leaveOut?: THREE.Object3D): void {
  const s = lent ? new THREE.Scene() : (stand ??= new THREE.Scene());
  const own = s === stand;
  s.children = leaveOut ? scene.children.filter((c) => c !== leaveOut) : scene.children.slice();
  s.fog = scene.fog;
  s.environment = scene.environment;
  s.environmentIntensity = scene.environmentIntensity;
  s.environmentRotation.copy(scene.environmentRotation);
  if (own) lent = true;
  try {
    f(s);
  } finally {
    s.children = [];
    if (own) lent = false;
  }
}

/**
 * Wraps a draw done ahead of time (a tier or a light set prepared in the
 * background) so three skips its shader error check: a program's first draw
 * reads its compile logs back, a round trip that waits for the GPU to finish
 * everything queued before it, tens of milliseconds a program on a busy GPU,
 * which the live garden would show. The check is left to the opening, which
 * draws the same shaders under the veil.
 */
export function unchecked<A extends unknown[]>(gl: THREE.WebGLRenderer, draw: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    const check = gl.debug.checkShaderErrors;
    gl.debug.checkShaderErrors = false;
    try {
      draw(...args);
    } finally {
      gl.debug.checkShaderErrors = check;
    }
  };
}

/** Main-thread time per compile slice (ms), with a frame drawn between slices. */
const SLICE_MS = 5;

interface ProgramLike {
  isReady(): boolean;
  /** three sets this to undefined when it destroys the program */
  program?: WebGLProgram;
}

const lightIn = (o: THREE.Object3D): boolean => (o as THREE.Light).isLight === true || o.children.some(lightIn);

/**
 * The scene's programs compiled a few objects at a time, a frame apart, so
 * the work never shows as a stall (as lightSets.prepareSet prepares a light
 * set): each slice compiles some objects for `target`, in the scene `around`
 * hands it (which may stand other lights in, synchronously, and says whether
 * it could), and
 * the last one also the shadow pass's depth programs and the leaves' back
 * faces. Settles true once the driver reports every program these compiles
 * produced ready (pinned, as lightSets.compilePinned is: a frame drawn
 * meanwhile under other lights changes a material's current program), false
 * when cancelled or `around` could not run. An object holding a light is left
 * out (compiled on its own it would count that light twice) and compiles on
 * first use instead; the garden has none.
 *
 * A compile leaves each material pointing at the program it just built. A lit
 * material looks its program up again when it is next drawn under other
 * lights; an unlit one (basic, sprites, depth, an unlit shader) does not, so
 * one the live scene shares would be drawn with the new program, still
 * compiling, and that draw would wait for the driver. After each slice those
 * go back to the program they were drawn with.
 */
export function compileSliced(
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
  around: (step: (scene: THREE.Scene) => void) => boolean,
  cancelled: () => boolean,
): Promise<boolean> {
  const objects: THREE.Object3D[] = [];
  const collected = around((scene) =>
    traverseShown(scene, (o) => {
      if ((isDrawable(o) || (o as THREE.Sprite).isSprite === true) && !lightIn(o)) objects.push(o);
    }),
  );
  if (!collected) return Promise.resolve(false);
  type Props = { currentProgram?: ProgramLike; needsLights?: boolean };
  const props = (m: THREE.Material) => gl.properties.get(m) as Props;
  const programs: ProgramLike[] = [];
  // the program each material compiled in this slice had before it
  const drawnWith = new Map<THREE.Material, ProgramLike | undefined>();
  const remember = (root: THREE.Object3D) =>
    root.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : [mats]) if (m && !drawnWith.has(m)) drawnWith.set(m, props(m).currentProgram);
    });
  const compile = (root: THREE.Object3D, c: THREE.Camera, t: THREE.Scene | null) => {
    remember(root);
    for (const m of gl.compile(root, c, t)) {
      const p = props(m).currentProgram;
      if (p) programs.push(p);
    }
  };
  const restore = () => {
    for (const [m, p] of drawnWith) {
      const pr = props(m);
      if (p && !pr.needsLights) pr.currentProgram = p;
    }
    drawnWith.clear();
  };
  const pinned: Compile = (s, c, t) => {
    compile(s, c, t);
    return Promise.resolve();
  };
  let i = 0;
  return new Promise((resolve) => {
    const slice = () => {
      if (cancelled()) return resolve(false);
      const t0 = performance.now();
      const ran = around((scene) => {
        const previous = gl.getRenderTarget();
        try {
          gl.setRenderTarget(target);
          while (i < objects.length && performance.now() - t0 < SLICE_MS) {
            const o = objects[i++];
            if (o.parent) compile(o, camera, scene);
          }
        } finally {
          gl.setRenderTarget(previous);
        }
        if (i >= objects.length) {
          void compileShadowCasters(gl, scene, camera, target, pinned);
          void compileTransmissionBackfaces(gl, scene, camera, target, pinned);
        }
        restore();
      });
      if (!ran) return resolve(false);
      if (i < objects.length) {
        window.setTimeout(slice, 16);
        return;
      }
      const check = () => {
        if (cancelled()) resolve(false);
        // a program destroyed while linking (its material was disposed) reads not-ready forever: count it as done
        else if (programs.every((p) => p.program === undefined || p.isReady())) resolve(true);
        else window.setTimeout(check, 32);
      };
      check();
    };
    window.setTimeout(slice, 0);
  });
}

/** Back-references that would lead the walk out of the post chain and into the garden or React. */
const SKIP_KEYS = new Set(["__r3f", "_listeners", "renderer", "camera", "parent", "children"]);
const MAX_DEPTH = 8;

/**
 * Every shader material reachable from the post-processing chain: each
 * pass's own and the ones passes swap in as they render (the mipmap blur's
 * down- and up-sampling, the depth of field's bokeh passes, N8AO's quads).
 * Breadth first, so each object is reached by its shortest path; the walk
 * never enters the garden itself: Object3Ds are only looked into for their
 * material, and textures, targets, geometry and back-references are skipped.
 */
function postMaterials(passes: readonly object[]): THREE.ShaderMaterial[] {
  const seen = new Set<object>();
  const found = new Set<THREE.ShaderMaterial>();
  let level: unknown[] = [...passes];
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: unknown[] = [];
    for (const v of level) {
      if (v === null || typeof v !== "object" || seen.has(v)) continue;
      seen.add(v);
      if (v instanceof THREE.ShaderMaterial) {
        found.add(v);
        continue;
      }
      if (
        v instanceof THREE.Texture ||
        v instanceof THREE.RenderTarget ||
        v instanceof THREE.BufferGeometry ||
        v instanceof THREE.WebGLRenderer ||
        v instanceof THREE.Camera ||
        v instanceof THREE.Scene ||
        v instanceof Node ||
        ArrayBuffer.isView(v)
      )
        continue;
      if (v instanceof THREE.Object3D) next.push((v as THREE.Mesh).material);
      else if (Array.isArray(v)) next.push(...v);
      else if (v instanceof Map || v instanceof Set) next.push(...v.values());
      else for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k)) next.push((v as Record<string, unknown>)[k]);
    }
    level = next;
  }
  return [...found];
}

/**
 * The post chain's programs, compiled into a render target (as every pass
 * but the last draws) and, for the last pass, to the screen as well, since a
 * render target changes the colour-space define.
 */
export function compilePost(gl: THREE.WebGLRenderer, composer: EffectComposer): Promise<unknown> {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Position and uv only, like the passes' own full-screen triangle: a normal
  // attribute would change the program's parameters.
  const quad = new THREE.BufferGeometry();
  quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quad.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const toScene = (mats: THREE.ShaderMaterial[]) => {
    const s = new THREE.Scene();
    for (const m of mats) s.add(new THREE.Mesh(quad, m));
    return s;
  };
  const all = postMaterials(composer.passes);
  const last = composer.passes[composer.passes.length - 1];
  const lastMats = last ? postMaterials([last]) : [];
  const previous = gl.getRenderTarget();
  const jobs: Promise<unknown>[] = [];
  try {
    gl.setRenderTarget(composer.inputBuffer);
    jobs.push(gl.compileAsync(toScene(all), camera));
    gl.setRenderTarget(null);
    if (lastMats.length) jobs.push(gl.compileAsync(toScene(lastMats), camera));
  } finally {
    gl.setRenderTarget(previous);
  }
  return Promise.all(jobs).finally(() => quad.dispose());
}

/** The next animation frame, or a short timeout where frames are paused (a hidden tab). */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 64);
    requestAnimationFrame(() => {
      window.clearTimeout(t);
      resolve();
    });
  });

/** Waits, frame by frame and without blocking, until the GPU has worked through everything issued so far (or `maxMs`). */
async function gpuCaughtUp(gl: WebGL2RenderingContext, maxMs: number): Promise<void> {
  const sync = typeof gl.fenceSync === "function" ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
  gl.flush();
  if (!sync) return nextFrame();
  const until = performance.now() + maxMs;
  try {
    do {
      await nextFrame();
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED) return;
    } while (performance.now() < until);
  } finally {
    gl.deleteSync(sync);
  }
}

/**
 * Draws every visible part of the scene once, a group at a time, into a tiny
 * target in the composer's own format, shadow pass and transmission pass
 * included. A compiled program is not yet a drawable one: on its first draw
 * the driver (ANGLE on Direct3D, above all) builds the variant for the actual
 * vertex layout and target, and with a cold shader cache that work for the
 * whole garden landed in the first real frame as one frozen frame of three
 * seconds. Spread over a few frames here, each waited out on a GPU fence, the
 * work is the same but the page keeps breathing and the first frame is quick.
 *
 * Everything is drawn without frustum culling so parts off-screen at first
 * (round an orbit) are ready too. The leaves' transmissive materials join
 * every group, so each group's opaque parts are also drawn into the
 * transmission buffer as they will be. Best effort: a group that throws is
 * skipped and will simply be built on first use, as before. `around` runs
 * each synchronous step on the scene to draw (TierLayers' withHiddenLayer
 * hands it a stand-in, to draw a tier being prepared out of sight under its
 * own lights).
 */
export async function predraw(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  groups: number,
  cancelled: () => boolean,
  around: (step: (scene: THREE.Scene) => void) => void = (step) => step(scene),
): Promise<void> {
  const parts: Drawable[] = [];
  const always: Drawable[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if (isDrawable(o)) {
      const m = o.material as THREE.MeshPhysicalMaterial | THREE.Material[];
      if (!Array.isArray(m) && m.transmission > 0) always.push(o);
      else parts.push(o);
    }
    for (const c of o.children) visit(c);
  };
  around((s) => visit(s));
  if (parts.length === 0) return;
  const all = [...parts, ...always];
  const everyGroup = new Set<THREE.Object3D>(always);
  const saved = all.map((o) => ({ o, visible: o.visible, culled: o.frustumCulled }));
  const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
  const ctx = gl.getContext() as WebGL2RenderingContext;
  const size = Math.ceil(parts.length / Math.max(1, groups));
  try {
    for (let g = 0; g * size < parts.length; g++) {
      if (cancelled()) return;
      const batch = new Set<THREE.Object3D>(parts.slice(g * size, (g + 1) * size));
      around((drawn) => {
        const previous = gl.getRenderTarget();
        try {
          for (const s of saved) {
            s.o.visible = batch.has(s.o) || everyGroup.has(s.o);
            s.o.frustumCulled = false;
          }
          gl.setRenderTarget(target);
          gl.shadowMap.needsUpdate = true;
          gl.render(drawn, camera);
        } catch {
          // this group is built on first use instead
        } finally {
          gl.setRenderTarget(previous);
          for (const s of saved) {
            s.o.visible = s.visible;
            s.o.frustumCulled = s.culled;
          }
        }
      });
      await gpuCaughtUp(ctx, 2500);
    }
  } finally {
    target.dispose();
  }
}

/**
 * Uploads the scene's textures while the driver compiles, so the first frame
 * does not stall on them (the garden's leaves, petals, bark and ground are
 * canvas-painted textures, several of them large). Spread over a few tasks.
 */
export async function uploadTextures(gl: THREE.WebGLRenderer, scene: THREE.Object3D): Promise<void> {
  const textures = new Set<THREE.Texture>();
  const take = (v: unknown) => {
    if (v instanceof THREE.Texture && !(v as THREE.CubeTexture).isCubeTexture && !v.isRenderTargetTexture) textures.add(v);
  };
  scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      for (const v of Object.values(m)) take(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) take(u?.value);
    }
  });
  let i = 0;
  for (const t of textures) {
    gl.initTexture(t);
    if (++i % 6 === 0) await new Promise((r) => window.setTimeout(r, 0));
  }
}
