// Day and night light sets. The garden mounts eight lights so that dusk and
// dawn never change the light count (which would recompile every material in
// the scene, a long freeze): sun, fill and sky bounce, plus five that only
// work when the sun is low or down (the low-sun leak, the moon, the rim
// kicker on the bloom, the lantern's candle and the bloom's own glow). By day
// those five sit at intensity 0, yet every lit pixel still pays for them,
// about a fifth of the scene's shading cost on an integrated GPU.
//
// So the five are marked `userData.optionalLight` and hidden while the sun
// stands high: above 30 degrees none of them can be lit (the low-sun
// treatment is gone by 28, the moon and the candles need night). Before the
// set changes, the other set's programs are compiled in the background with
// KHR_parallel_shader_compile and the garden is pre-drawn under it (each step
// in a stand-in scene, so the live one never sees the other set), and the
// switch is made only once that is done, so it never stalls a frame; the sun
// takes about eight minutes to sink from 30 to 28 degrees, ample time. Where
// the extension is missing the garden keeps every light all day, as before.
import * as THREE from "three";
import { compileSliced, predraw, unchecked, withStandIn } from "@/components/garden/warmup";
import { garden } from "@/lib/garden/store";
import { istDateAt, istNow, sunInfo } from "@/lib/sky/sun";

/** Above this sun altitude the optional lights are hidden; below the lower edge they are shown. */
const DAY_ABOVE = THREE.MathUtils.degToRad(31);
const NIGHT_BELOW = THREE.MathUtils.degToRad(30);

export const OPTIONAL_LIGHT = { optionalLight: true } as const;

/**
 * The live set, shared by the opening (which compiles for it) and the frame
 * loop (which changes it), and which sets have their programs ready. A tier
 * change rebuilds the materials, so the opening (or a prepared tier's swap,
 * RenderBudget) resets `ready` and bumps `generation`, and a preparation
 * begun before it never marks a set ready.
 */
export const lightSet = {
  full: true,
  preparing: false,
  ready: { full: false, day: false },
  generation: 0,
  /**
   * A set held whatever the sun does (the party trailer sweeps the hours in seconds and keeps the full set it opened
   * with), prepared first if it is not ready; null: the sun decides.
   */
  pin: null as boolean | null,
};

/** The other set starts preparing when the sun comes within this much of the threshold. */
const PREPARE_AHEAD = THREE.MathUtils.degToRad(4);
/** Its pre-draw: groups a frame or more apart, and at most this long (ms) in all. */
const PREDRAW_GROUPS = 8;
const PREDRAW_MAX_MS = 6000;

const isOptional = (o: THREE.Object3D) => (o as THREE.Light).isLight === true && o.userData.optionalLight === true;

interface ProgramLike {
  isReady(): boolean;
}

/** Whether background compiles can be awaited without stalling (else the set never changes). */
export function canSwitchSets(gl: THREE.WebGLRenderer): boolean {
  return gl.extensions.has("KHR_parallel_shader_compile");
}

/** The sun's altitude for the garden's clock now, before any frame has run. */
export function altitudeNow(): number {
  const s = garden.get();
  return sunInfo(istDateAt(s.autoClock ? istNow() : s.hour)).altitude;
}

/** The set the sun asks for (the opening compiles for it before the first frame). */
export function wantedFullSet(currentlyFull: boolean, altitude = altitudeNow()): boolean {
  return currentlyFull ? altitude < DAY_ABOVE : altitude < NIGHT_BELOW;
}

/**
 * Within about three quarters of an hour of sun movement from the switch:
 * the opening then prepares both sets behind the veil, since a visitor is
 * likely still in the garden when it comes (the party starts at 15:00 and the
 * sun sinks through 30 degrees at about 15:40 in November).
 */
export function switchIsNear(altitude = altitudeNow()): boolean {
  return Math.abs(altitude - (DAY_ABOVE + NIGHT_BELOW) / 2) < THREE.MathUtils.degToRad(12);
}

/** The set the sun will soon ask for, if it is not the live one: prepared ahead so the switch is free. */
export function upcomingSet(full: boolean, altitude: number): boolean | null {
  if (!full && altitude < NIGHT_BELOW + PREPARE_AHEAD) return true;
  if (full && altitude > DAY_ABOVE - PREPARE_AHEAD) return false;
  return null;
}

export const isReadySet = (full: boolean) => (full ? lightSet.ready.full : lightSet.ready.day);
export function markReady(full: boolean) {
  if (full) lightSet.ready.full = true;
  else lightSet.ready.day = true;
}

/** Shows or hides every optional light; returns true if anything changed. */
export function applySet(scene: THREE.Object3D, full: boolean): boolean {
  let changed = false;
  scene.traverse((o) => {
    if (isOptional(o) && o.visible !== full) {
      o.visible = full;
      changed = true;
    }
  });
  return changed;
}

/**
 * Runs `start` (which issues compiles) with the scene's lights switched to
 * `full`, then switches them back, all synchronously, so no frame ever sees
 * the set being prepared.
 */
export function withSet(scene: THREE.Object3D, full: boolean, start: () => void): void {
  const flipped: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (isOptional(o) && o.visible !== full) {
      o.visible = full;
      flipped.push(o);
    }
  });
  try {
    start();
  } finally {
    for (const o of flipped) o.visible = !full;
  }
}

/**
 * Compiles like renderer.compileAsync, but waits on the exact programs this
 * compile produced. (compileAsync checks each material's current program
 * when it polls; after a frame drawn with the other light set that is no
 * longer the one being prepared.)
 */
export function compilePinned(
  gl: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  target: THREE.Scene | null = null,
): Promise<void> {
  const materials = gl.compile(scene, camera, target);
  const programs: ProgramLike[] = [];
  for (const m of materials) {
    const p = (gl.properties.get(m) as { currentProgram?: ProgramLike }).currentProgram;
    if (p) programs.push(p);
  }
  return new Promise((resolve) => {
    const check = () => {
      if (programs.every((p) => p.isReady())) resolve();
      else window.setTimeout(check, 16);
    };
    check();
  });
}

/**
 * Prepares a set without ever stalling a frame: its programs compile a few
 * objects a frame, in parallel (warmup.compileSliced, the shadow pass's and
 * the leaves' back faces included), then the garden is pre-drawn under it a
 * group per frame, so the switch has no first draws left to make. Every step
 * runs in a stand-in for the scene (warmup.withStandIn) with the optional
 * lights switched to that set and back, in one task, so the live scene never
 * sees the set and its light state never changes. Settles true once done,
 * false when `cancelled` (a tier built meanwhile has materials this never saw).
 */
export async function prepareSet(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  full: boolean,
  target: THREE.WebGLRenderTarget | null,
  cancelled: () => boolean,
): Promise<boolean> {
  const under = (step: (stand: THREE.Scene) => void) => {
    withStandIn(scene, (stand) => withSet(stand, full, () => step(stand)));
    return true;
  };
  if (!(await compileSliced(gl, camera, target, under, cancelled))) return false;
  const until = performance.now() + PREDRAW_MAX_MS;
  try {
    await predraw(gl, scene, camera, PREDRAW_GROUPS, () => cancelled() || performance.now() > until, (step) => {
      under(unchecked(gl, step));
    });
  } catch {
    // whatever was not pre-drawn is drawn for the first time at the switch, as before
  }
  return !cancelled();
}
