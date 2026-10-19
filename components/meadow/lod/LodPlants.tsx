"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes and their attributes) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// The Meadow's growing plants (sprouts, young plants, buds and blooms) at the detail each one deserves on screen:
//
// - L0, the plant being visited: drawn in full from the owner's own seed and numbers by VisitedPlant.tsx, which
//   dissolves in over this plant's light plant or picture and back out (handover.ts); here the plant draws the rest of
//   the dissolve, and nothing once the full plant has taken over.
// - L1, near: the garden's own procedural flower, posed once per species and band from its species' most typical seed
//   at a light tessellation (bake.ts), one instanced mesh per species and band, rocking in the breeze on the GPU and
//   casting shadows (its stem and leaves) where the Meadow has plant shadows. Built on demand within a small budget a
//   frame, the commonest first, and compiled off the frame where the browser can.
// - L2, far: a picture of exactly that plant from the camera's bearing (the atlas in public/meadow/, baked by
//   scripts/bake-meadow-plants.mjs), one quad per plant facing the camera, all of them in a single draw, lit per pixel
//   by the Meadow's sun through the atlas's normals, casting its shadow as a card turned to the sun where plants cast
//   shadows (so the shadows do not stop at the light plants' edge, and a plant off screen still casts into view).
// Both are lit by the full plants' soft plant environment as well (meadow.plantEnv), in the shares that keep the three
// levels equally bright (materials.ts).
//
// Which plants are near is decided every frame the view moves by how tall each stands on screen (levels.ts), with
// hysteresis in size and at the edges of the view and a cap per kind of device, and the swap is a short dissolve in
// which the light plant and its picture share the pixels between them. Seeds and resting plants stay with Plants.tsx,
// which also keeps drawing the growing plants its old cheap way until the atlas has arrived (or if it never does). A
// lotus is drawn as its kind (bands.ts): in its urli on a bed plot, or standing in a river pocket, its foot on the water
// (Plants.tsx lays its floating leaves on the water at every distance, and draws a floating-leaf sprout there alone).
//
// Every plant keeps its own angle (one of three), lean and tint from its plot (bands.ts plotTurn), and the full plant's
// size, so it is the same plant at every level, standing exactly as its full plant does, from one visit to the next.
//
// Development only: ?lod=off leaves every growing plant to Plants.tsx's cheap stand-ins, for comparing.
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadowData, useMeadowData, type MeadowPlot } from "@/components/meadow/data";
import { plotOf, type MeadowLayout } from "@/components/meadow/layout";
import { ATLAS, CELLS, HEIGHTS } from "@/components/meadow/lod/atlasManifest";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import {
  bandOf,
  BANDS,
  cellIndex,
  hasLight,
  LOD_KINDS,
  LOD_REACH,
  LOD_SPECIES,
  lodKindOf,
  plotHash,
  plotTilt,
  plotTurnOf,
  speciesOfKind,
  spinOfPlot,
  standsUpright,
  type Band,
  type LodKind,
} from "@/components/meadow/lod/bands";
import { handover } from "@/components/meadow/lod/handover";
import { advanceFades, chooseNear, nearRange, screenHeight, type LevelOptions } from "@/components/meadow/lod/levels";
import {
  cardGeometry,
  farDepthMaterial,
  farMaterial,
  flowerGlow,
  lodUniforms,
  nearDepthMaterial,
  nearMaterial,
  SELF_SHADE,
} from "@/components/meadow/lod/materials";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { readDevice, type DeviceKind } from "@/lib/garden/device";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

/** Whether the pictures have arrived and the levels draw the growing plants (Plants.tsx stands down then). */
export const lodStatus = { ready: false, failed: false };

/**
 * How tall a plant stands on screen (device pixels) before its light plant takes over from its picture, how short it
 * gets before it goes back, and how many light plants a device draws at most. The pictures are drawn about 118 pixels
 * tall, so they hold up to about there; a phone keeps fewer light plants than a laptop.
 */
const LEVELS: Record<DeviceKind, LevelOptions> = {
  phone: { enterPx: 100, leavePx: 72, maxNear: 36 },
  tablet: { enterPx: 100, leavePx: 72, maxNear: 60 },
  laptop: { enterPx: 96, leavePx: 68, maxNear: 96 },
  bigscreen: { enterPx: 96, leavePx: 68, maxNear: 120 },
};
/** How long a new plant takes to rise out of the soil, ms (as Plants.tsx). */
const RISE_MS = 1600;
/** Most milliseconds a frame spends building light plants (more while the opening veil is up). */
const BAKE_BUDGET_MS = 6;
const BAKE_BUDGET_LOADING_MS = 40;
/**
 * Frustum margins: a plant comes near inside the first (so one just off screen is near before it slides in) and stays
 * near inside the second.
 */
const MARGIN = 1.15;
const MARGIN_OUT = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

/** Per-plant tints: thriving a touch brighter, poorly paler toward straw (as the Meadow has always shown them). */
const TINT: Record<MeadowPlot["health"], readonly [number, number, number, number]> = {
  thriving: [1.06, 1.06, 1.06, 0],
  fine: [1, 1, 1, 0],
  poorly: [0.97, 0.97, 0.97, 0.45],
  resting: [1, 1, 1, 0],
};

let deviceKind: DeviceKind | null = null;
function deviceLevels(): LevelOptions {
  if (deviceKind === null) deviceKind = readDevice().kind;
  return LEVELS[deviceKind];
}

const easeOutBack = (t: number) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

interface Slot {
  plot: number;
  /** what it is drawn as (a lotus in a river pocket is its own kind), and the species whose flower and glow it has */
  kind: LodKind;
  species: SpeciesId;
  band: Band;
  combo: number;
  spin: number;
  foot: THREE.Vector3;
  tilt: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
  height: number;
  tint: [number, number, number, number];
  /** sway phase (the plot number, or -1: standing still) and the row's angle */
  sway: [number, number];
  /** when it appeared (performance.now() ms) while it is still rising, else -1 */
  appeared: number;
}

interface NearMesh {
  mesh: THREE.InstancedMesh;
  fade: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  sway: THREE.InstancedBufferAttribute;
  /** slot index of each instance */
  slots: number[];
  ready: boolean;
}

type FarAttributes = ReturnType<typeof farAttributes>;

interface LodState {
  slots: Slot[];
  px: Float32Array;
  inView: Uint8Array;
  near: Uint8Array;
  fade: Float32Array;
  ready: Uint8Array;
  member: Uint8Array;
  /** the visit's handover as last laid out */
  handPlot: number;
  handShare: number;
  /** the view the levels were last chosen for (camera, projection, canvas), and whether they must be chosen again */
  view: Float32Array;
  dirty: boolean;
  /** whether anything was still changing last frame (a dissolve, a light plant waited for): settled levels are left be */
  busy: boolean;
  order: { order: number[] };
  meshes: Map<number, NearMesh>;
  queue: number[];
  rising: boolean;
  /** development only: this component's share of the frame, ms (smoothed), and the last light plant's build time */
  frameMs: number;
  buildMs: number;
}

/** One kind in one band, as an index into the near meshes. */
const comboOf = (kind: LodKind, band: Band) => LOD_KINDS.indexOf(kind) * BANDS.length + BANDS.indexOf(band);

/** Where and how one plant stands: the same numbers at both levels. */
function placeSlot(p: MeadowPlot, band: Band, L: MeadowLayout, now: number): Slot | null {
  const plot = plotOf(L, p.plot);
  if (!plot) return null;
  const kind = lodKindOf(p.species, plot.kind === "pocket");
  // (a pocket's floating-leaf sprout is all pads, Plants.tsx's at every distance)
  if (!hasLight(kind, band)) return null;
  // leaning a touch toward the path (more for a poorly plant; a lotus stands level) and turned to its angle (a pocket's
  // lotus to the one nearest to facing its channel), as its full plant stands
  const inner = plot.side === "inner";
  const poorly = p.health === "poorly";
  const upright = standsUpright(kind);
  const tilt = plotTilt(p.plot, plot.a, inner, poorly, undefined, upright);
  const spin = spinOfPlot(plot);
  const quat = plotTurnOf(plot, poorly, upright);
  // the full plant's size (VisitedPlant.tsx), so the visit's handover never grows or shrinks it
  const scale = PLANT_SCALE;
  const jitter = 0.96 + 0.08 * plotHash(p.plot, 9);
  const t = TINT[p.health];
  const appeared = meadowData.get().appeared.get(p.plot);
  return {
    plot: p.plot,
    kind,
    species: p.species,
    band,
    combo: comboOf(kind, band),
    spin,
    foot: new THREE.Vector3(plot.x, plot.y, plot.z),
    tilt,
    quat,
    scale,
    // (a lotus is chosen by its width where that is more than its height: bands.ts LOD_REACH)
    height: Math.max(HEIGHTS[kind][band], LOD_REACH[kind] ?? 0) * scale,
    tint: [t[0] * jitter, t[1] * jitter, t[2] * jitter, t[3]],
    // (a pocket's lotus stands still, as its full plant does: VisitedPlant.tsx)
    sway: [plot.kind === "pocket" ? -1 : p.plot, plot.a],
    appeared: appeared !== undefined && now - appeared < RISE_MS ? appeared : -1,
  };
}

/** The far pictures' instanced attributes, sized for every plot. */
function farAttributes(cap: number) {
  const a = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
  return { base: a(3), tilt: a(3), card: a(4), uv: a(4), tint: a(4), misc: a(4), glow: a(3), fade: a(1) };
}

/** A new plant rises out of the soil: its scale this moment, 1 once risen. */
function riseOf(slot: Slot, now: number): number {
  if (slot.appeared < 0) return 1;
  const k = Math.min(1, Math.max(0, (now - slot.appeared) / RISE_MS));
  return Math.max(0.0001, easeOutBack(k));
}

/** Writes every plant's picture: where it stands, its cell, its lean, tint and glow. */
function writeFar(slots: Slot[], a: FarAttributes, now: number): void {
  const base = a.base.array as Float32Array, tilt = a.tilt.array as Float32Array, card = a.card.array as Float32Array;
  const uv = a.uv.array as Float32Array, tint = a.tint.array as Float32Array, misc = a.misc.array as Float32Array;
  const glow = a.glow.array as Float32Array;
  slots.forEach((slot, i) => {
    const c = CELLS[cellIndex(slot.kind, slot.band, slot.spin)];
    base.set([slot.foot.x, slot.foot.y, slot.foot.z], i * 3);
    tilt.set([slot.tilt.x, slot.tilt.y, slot.tilt.z], i * 3);
    uv.set([c[0], c[1], c[2], c[3]], i * 4);
    card.set([c[4], c[5], c[6], c[7]], i * 4);
    tint.set(slot.tint, i * 4);
    misc.set([slot.sway[0], slot.sway[1], slot.scale * riseOf(slot, now), c[8]], i * 4);
    const f = SPECIES[slot.species];
    glow.set([f.flower.emissiveDay, f.flower.emissiveNight, f.fx.pulse ? 1 : 0], i * 3);
  });
  for (const attr of Object.values(a)) attr.needsUpdate = true;
}

/** The Meadow's sun (by night its moon): the light that casts the shadows. */
function findSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  let sun: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    if (!sun && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) sun = o as THREE.DirectionalLight;
  });
  return sun;
}

/** Whether the view differs from the one kept in `last` (camera, projection, canvas size and pixel ratio); keeps it. */
function viewMoved(last: Float32Array, cam: THREE.Camera, w: number, h: number, pr: number): boolean {
  let moved = false;
  const put = (k: number, x: number) => {
    if (last[k] !== Math.fround(x)) {
      last[k] = x;
      moved = true;
    }
  };
  const m = cam.matrixWorld.elements, p = cam.projectionMatrix.elements;
  for (let k = 0; k < 16; k++) {
    put(k, m[k]);
    put(16 + k, p[k]);
  }
  put(32, w);
  put(33, h);
  put(34, pr);
  return moved;
}

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();

/** The full plant's share of plot slot i's pixels (handover.ts), 0 when it is not the plant being visited. */
const shareOf = (s: LodState, i: number) => (s.slots[i].plot === s.handPlot ? s.handShare : 0);

/** Whether plot slot i draws its light plant at all: dissolving in or out, or near, and not all handed to its full plant. */
const drawsNear = (s: LodState, i: number) => s.fade[i] > 0 && shareOf(s, i) < 1;

/** Writes the light plants' dissolve ranges (levels.ts nearRange). */
function writeNearFades(s: LodState): void {
  for (const m of s.meshes.values()) {
    if (m.slots.length === 0) continue;
    const arr = m.fade.array as Float32Array;
    m.slots.forEach((i, k) => {
      const [from, to] = nearRange(s.fade[i], shareOf(s, i));
      arr[k * 2] = from;
      arr[k * 2 + 1] = to;
    });
    m.fade.needsUpdate = true;
  }
}

/** Writes the pictures' dissolve: each draws above its light plant's range. */
function writeFarFades(s: LodState, a: FarAttributes): void {
  const arr = a.fade.array as Float32Array;
  for (let i = 0; i < s.slots.length; i++) arr[i] = nearRange(s.fade[i], shareOf(s, i))[1];
  a.fade.needsUpdate = true;
}

/** Lays the light plants' instances out: every plant fading in, near, or fading out, in its species' mesh. */
function layOutNear(s: LodState, now: number, cap: number): void {
  for (const m of s.meshes.values()) m.slots.length = 0;
  s.slots.forEach((slot, i) => {
    if (!drawsNear(s, i)) return;
    const m = s.meshes.get(slot.combo);
    if (m && m.slots.length < cap) m.slots.push(i);
  });
  for (const m of s.meshes.values()) {
    const tint = m.tint.array as Float32Array;
    const sway = m.sway.array as Float32Array;
    m.slots.forEach((i, k) => {
      const slot = s.slots[i];
      const scale = riseOf(slot, now) * slot.scale;
      tmpM.compose(slot.foot, slot.quat, tmpS.set(scale, scale, scale));
      m.mesh.setMatrixAt(k, tmpM);
      tint.set(slot.tint, k * 4);
      sway[k * 2] = slot.sway[0];
      sway[k * 2 + 1] = slot.sway[1];
    });
    m.mesh.count = m.slots.length;
    m.mesh.visible = m.slots.length > 0;
    m.mesh.instanceMatrix.needsUpdate = true;
    m.tint.needsUpdate = true;
    m.sway.needsUpdate = true;
  }
  writeNearFades(s);
}

export function LodPlants({ layout: L, shadows }: { layout: MeadowLayout; shadows: boolean }) {
  const cap = L.plots.length;
  const version = useMeadowData((d) => d.version);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const opts = useMemo(() => deviceLevels(), []);
  const sun = useRef<THREE.DirectionalLight | null>(null);

  const uniforms = useMemo(() => {
    const u = lodUniforms();
    // where plants cast shadows the light plants shade themselves, and their pictures take that in (materials.ts)
    u.uSelfShade.value = shadows ? SELF_SHADE : 1;
    return u;
  }, [shadows]);
  const glows = useMemo(() => Object.fromEntries(LOD_SPECIES.map((id) => [id, { value: 0.24 }])) as Record<SpeciesId, { value: number }>, []);
  const nearMats = useMemo(
    () => Object.fromEntries(LOD_SPECIES.map((id) => [id, nearMaterial(uniforms, glows[id])])) as Record<SpeciesId, THREE.MeshStandardMaterial>,
    [uniforms, glows],
  );
  const depthMat = useMemo(() => nearDepthMaterial(uniforms), [uniforms]);
  const farNormals = useMemo(() => ({ value: null as THREE.Texture | null }), []);
  const farDepth = useMemo(() => farDepthMaterial(uniforms, ATLAS.elevation, farNormals), [uniforms, farNormals]);
  const group = useMemo(() => new THREE.Group(), []);
  const far = useMemo(() => {
    const geometry = cardGeometry();
    const attrs = farAttributes(cap);
    geometry.setAttribute("aBase", attrs.base);
    geometry.setAttribute("aTilt", attrs.tilt);
    geometry.setAttribute("aCard", attrs.card);
    geometry.setAttribute("aUv", attrs.uv);
    geometry.setAttribute("aTint", attrs.tint);
    geometry.setAttribute("aMisc", attrs.misc);
    geometry.setAttribute("aGlow", attrs.glow);
    geometry.setAttribute("aFade", attrs.fade);
    geometry.instanceCount = 0;
    return { geometry, attrs, mesh: null as THREE.Mesh | null, textures: [] as THREE.Texture[] };
  }, [cap]);

  // per-plant state, by slot
  const state = useRef<LodState>({
    slots: [],
    px: new Float32Array(cap),
    inView: new Uint8Array(cap),
    near: new Uint8Array(cap),
    fade: new Float32Array(cap),
    ready: new Uint8Array(cap),
    member: new Uint8Array(cap),
    handPlot: -1,
    handShare: 0,
    view: new Float32Array(36),
    dirty: true,
    busy: true,
    order: { order: [] },
    meshes: new Map(),
    queue: [],
    rising: false,
    frameMs: 0,
    buildMs: 0,
  });

  // Dev-only handle for probing the levels from the console.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __meadowLod?: unknown }).__meadowLod = { state: state.current, status: lodStatus, opts, handover, uniforms };
  }, [opts, uniforms]);

  // the pictures: both atlases, then the far material compiled before anything is shown
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("lod") === "off") return;
    let live = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string, tries = 3): Promise<THREE.Texture> =>
      loader.loadAsync(url).catch((e) => (tries > 1 ? new Promise<THREE.Texture>((r) => window.setTimeout(() => r(load(url, tries - 1)), 1500)) : Promise.reject(e)));
    void Promise.all([load(ATLAS.albedo), load(ATLAS.normal)])
      .then(async ([albedo, normals]) => {
        far.textures.push(albedo, normals);
        if (!live) return;
        // premultiplied as it is uploaded, so filtering and mipmaps never pull in the colour round a plant
        albedo.premultiplyAlpha = true;
        albedo.colorSpace = THREE.NoColorSpace;
        albedo.anisotropy = 4;
        normals.colorSpace = THREE.NoColorSpace;
        farNormals.value = normals;
        const material = farMaterial(uniforms, albedo, normals, ATLAS.elevation);
        // lit by the plant environment from the first frame, so it compiles once
        material.envMap = meadow.plantEnv;
        const mesh = new THREE.Mesh(far.geometry, material);
        mesh.frustumCulled = false;
        // where plants cast no shadows (phones) the pictures skip the shadow lookups too: a card is many pixels
        mesh.receiveShadow = shadows;
        mesh.castShadow = shadows;
        mesh.customDepthMaterial = farDepth;
        await gl.compileAsync(mesh, camera, scene).catch(() => undefined);
        if (!live) return;
        far.mesh = mesh;
        mesh.visible = far.geometry.instanceCount > 0;
        group.add(mesh);
        lodStatus.ready = true;
      })
      .catch(() => {
        // the old cheap plants stay (Plants.tsx); the Meadow never shows an error for this
        lodStatus.failed = true;
      });
    return () => {
      live = false;
    };
  }, [gl, camera, scene, uniforms, far, group, shadows, farDepth, farNormals]);

  // the plants: a slot for every growing plant, keeping each plot's level and dissolve across snapshots
  useLayoutEffect(() => {
    const s = state.current;
    const d = meadowData.get();
    const before = new Map<number, { near: number; fade: number }>();
    s.slots.forEach((slot, i) => before.set(slot.plot, { near: s.near[i], fade: s.fade[i] }));
    const now = performance.now();
    const slots: Slot[] = [];
    const counts = new Map<number, number>();
    for (const p of [...d.byPlot.values()].sort((a, b) => a.plot - b.plot)) {
      const band = bandOf(p);
      const slot = band && slots.length < cap ? placeSlot(p, band, L, now) : null;
      if (!slot) continue;
      slots.push(slot);
      counts.set(slot.combo, (counts.get(slot.combo) ?? 0) + 1);
    }
    s.slots = slots;
    s.dirty = true;
    s.near.fill(0);
    s.fade.fill(0);
    s.member.fill(0);
    slots.forEach((slot, i) => {
      const b = before.get(slot.plot);
      if (b) {
        s.near[i] = b.near;
        s.fade[i] = b.fade;
      }
    });
    s.rising = slots.some((x) => x.appeared >= 0);
    // the commonest light plants are built first, ahead of need
    s.queue = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([combo]) => combo)
      .filter((c) => !s.meshes.has(c));
    writeFar(slots, far.attrs, now);
    far.geometry.instanceCount = slots.length;
    if (far.mesh) far.mesh.visible = slots.length > 0;
    layOutNear(s, now, opts.maxNear);
    writeFarFades(s, far.attrs);
  }, [version, L, cap, far, opts]);

  // everything made here is released with the Meadow
  useEffect(
    () => () => {
      const s = state.current;
      for (const m of s.meshes.values()) m.mesh.geometry.dispose();
      s.meshes.clear();
      group.clear();
      for (const m of Object.values(nearMats)) m.dispose();
      depthMat.dispose();
      farDepth.dispose();
      if (far.mesh) (far.mesh.material as THREE.Material).dispose();
      far.mesh = null;
      for (const t of far.textures) t.dispose();
      far.textures.length = 0;
      far.geometry.dispose();
      lodStatus.ready = false;
    },
    [group, nearMats, depthMat, farDepth, far],
  );

  /** Builds one kind-and-band light plant as an instanced mesh, compiled before it joins the scene. */
  const build = (combo: number) => {
    const s = state.current;
    if (s.meshes.has(combo)) return;
    const kind = LOD_KINDS[Math.floor(combo / BANDS.length)];
    const species = speciesOfKind(kind);
    const band = BANDS[combo % BANDS.length];
    const t0 = performance.now();
    const plant = bakeLodPlant(kind, band);
    s.buildMs = performance.now() - t0;
    const n = opts.maxNear;
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const sway = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    plant.geometry.setAttribute("aFade", fade);
    plant.geometry.setAttribute("aTint", tint);
    plant.geometry.setAttribute("aSway", sway);
    const material = nearMats[species];
    if (material.envMap !== meadow.plantEnv) {
      material.envMap = meadow.plantEnv;
      material.needsUpdate = true;
    }
    const mesh = new THREE.InstancedMesh(plant.geometry, material, n);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = depthMat;
    const entry: NearMesh = { mesh, fade, tint, sway, slots: [], ready: false };
    s.meshes.set(combo, entry);
    void gl
      .compileAsync(mesh, camera, scene)
      .catch(() => undefined)
      .then(() => {
        if (s.meshes.get(combo) !== entry) return;
        mesh.visible = false;
        group.add(mesh);
        entry.ready = true;
      });
  };

  useFrame((frame, dt) => {
    const s = state.current;
    // the dissolves' patterns are pinned in drawing-buffer pixels (the visited plant's too, which may dissolve first)
    frame.gl.getDrawingBufferSize(uniforms.uLodRes.value);
    if (!lodStatus.ready || !far.mesh) return;
    const now = performance.now();
    step(frame, dt, s, now);
    if (process.env.NODE_ENV !== "production") s.frameMs += (performance.now() - now - s.frameMs) * 0.05;
  });

  function step(frame: RootState, dt: number, s: LodState, now: number) {
    if (!far.mesh) return;
    const t = frame.clock.elapsedTime;
    const cam = frame.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    uniforms.uTime.value = t;
    uniforms.uNight.value = meadow.night;
    for (const id of LOD_SPECIES) glows[id].value = flowerGlow(id, meadow.night, t);
    if (!sun.current || !sun.current.parent) sun.current = findSun(frame.scene);
    if (sun.current) uniforms.uLightPos.value.copy(sun.current.position);
    // the plant environment's soft light, as the full plants take it (a material recompiles once, when it arrives)
    const env = meadow.plantEnv;
    for (const mat of [...Object.values(nearMats), far.mesh.material as THREE.MeshStandardMaterial]) {
      if (mat.envMap !== env) {
        mat.envMap = env;
        mat.needsUpdate = true;
      }
      mat.envMapIntensity = meadow.plantEnvStrength;
    }
    const n = s.slots.length;

    // how tall each plant stands on screen, chosen afresh only when the view has moved (or the plants changed)
    const pr = frame.gl.getPixelRatio();
    const moved = s.dirty || viewMoved(s.view, cam, frame.size.width, frame.size.height, pr);
    if (moved) {
      s.dirty = false;
      const fov = THREE.MathUtils.degToRad(cam.fov);
      const tan = Math.tan(fov / 2);
      const focal = (frame.size.height * pr) / (2 * tan);
      const view = cam.matrixWorldInverse;
      for (let i = 0; i < n; i++) {
        const slot = s.slots[i];
        const v = tmpV.copy(slot.foot).addScaledVector(UP, slot.height * 0.5).applyMatrix4(view);
        const depth = -v.z;
        const r = slot.height * 0.6;
        const within = (m: number) => depth > 0.1 && Math.abs(v.x) < depth * tan * m * cam.aspect + r && Math.abs(v.y) < depth * tan * m + r;
        s.inView[i] = within(MARGIN) ? 1 : 0;
        s.px[i] = s.inView[i] || within(MARGIN_OUT) ? screenHeight(slot.height, depth, focal) : 0;
      }
      chooseNear(s.px, s.inView, s.near, n, opts, s.order);
    }

    // the visit's handover: the full plant's share, as VisitedPlant.tsx dissolves it in or out
    const handed = handover.plot !== s.handPlot || handover.share !== s.handShare;
    s.handPlot = handover.plot;
    s.handShare = handover.share;
    // nothing moved and nothing is changing: the levels stand as they are
    if (!moved && !handed && !s.busy && !s.rising && s.queue.length === 0) return;

    // light plants are built on demand, the ones wanted now first
    let waiting = false;
    for (let i = 0; i < n; i++) {
      const combo = s.slots[i].combo;
      const m = s.meshes.get(combo);
      s.ready[i] = m && m.ready ? 1 : 0;
      if (s.near[i] && !s.ready[i]) waiting = true;
      if (s.near[i] && !m && s.queue[0] !== combo) {
        const at = s.queue.indexOf(combo);
        if (at > 0) s.queue.splice(at, 1);
        s.queue.unshift(combo);
      }
    }
    const budget = meadow.stats.loading ? BAKE_BUDGET_LOADING_MS : BAKE_BUDGET_MS;
    const started = performance.now();
    while (s.queue.length > 0) {
      build(s.queue.shift()!);
      // one light plant a frame once the Meadow is open (each takes a few milliseconds), more behind the veil
      if (performance.now() - started > budget / 2) break;
    }

    const faded = advanceFades(s.fade, s.near, s.ready, n, dt);
    s.busy = faded || waiting;
    let membership = false;
    for (let i = 0; i < n; i++) {
      const m = drawsNear(s, i) ? 1 : 0;
      if (m !== s.member[i]) {
        s.member[i] = m;
        membership = true;
      }
    }
    if (s.rising) {
      writeFar(s.slots, far.attrs, now);
      s.rising = s.slots.some((x) => x.appeared >= 0 && now - x.appeared < RISE_MS);
    }
    if (membership || s.rising) layOutNear(s, now, opts.maxNear);
    else if (faded || handed) writeNearFades(s);
    if (membership || faded || handed) writeFarFades(s, far.attrs);
  }

  return <primitive object={group} />;
}
