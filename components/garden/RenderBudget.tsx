"use client";
// The two pieces of the canvas that look after its cost rather than its
// picture: the opening (shader warm-up behind the loading veil) and the
// runtime governor (lib/garden/quality) that holds the frame rate.
//
// Opening. A cold browser compiles the garden's seventy-odd shader programs
// one after another on the main thread the first time it draws, which on an
// office laptop is ten to twenty seconds of black screen. Instead the canvas
// mounts with its frame loop stopped, and once every part of the scene and
// the post-processing chain exist, renderer.compileAsync hands all of the
// scene's programs to the driver at once: with KHR_parallel_shader_compile
// they compile side by side, off the main thread, while the veil's CSS
// animation keeps moving. The materials are compiled into the composer's
// input buffer, as the render pass will draw them (a render target changes
// the colour-space define), so none is compiled twice; the shadow pass's
// depth programs and the post chain's own are prepared alongside (warmup.ts),
// and the textures upload while the driver works. A compiled program still
// costs the driver a draw-time variant on its first draw, so the scene is
// then pre-drawn a group per frame into a tiny target (warmup.predraw), and
// the first real frame has almost nothing left to do. The governor spends a
// moment under the veil (until frame times settle, a few seconds at most)
// fitting the pixel budget, stepping the tier there if even the floor is too
// slow (and, when the veil's time runs out with that still being decided,
// stepping it then rather than after the reveal), and the veil lifts.
//
// A tier step under the veil compiles the new tier's programs again; that
// wait is capped short (STEP_COMPILE_WAIT_MS), and whatever the driver has not
// finished compiles on the first frames, still behind the veil.
//
// Once the garden has been seen it never goes back behind the veil, and a
// tier change (the governor's, only a step down after a sustained drop while
// nobody is touching the screen, or one picked in the development panel) is
// prepared before anyone sees it: the new tier is mounted as a hidden second
// layer beside the live one (TierLayers.tsx), built in a React transition a
// part at a time between frames, and TierPreparer compiles its programs in
// parallel a few objects a frame (under its own lights, in a stand-in scene
// where it takes the live layer's place, as lightSets.prepareSet prepares the
// light sets), uploads its textures and pre-draws it. Only then is the swap
// made, behind a still of the last frame (frameHold.ts) held for a few frames
// while the prepared layer goes live (and the canvas takes the new tier's
// pixel budget), dissolving into it. Nothing is built or compiled in that
// moment.
// Without parallel compiling (no KHR_parallel_shader_compile) the change is
// made in place instead: the still goes up, the new tier is built and its
// programs compile behind it, then the pre-draw and the settling get only what
// is left of HELD_FREEZE_MS, and whatever they have not done happens on the
// first frames, under the dissolve. The governor never climbs a tier on a
// showing garden: room for the tier above is remembered, and the next visit
// opens on it, under the veil. A change of
// pixel budget does the same in miniature: resizing the canvas clears its
// drawing buffer and reallocates the effect composer's, which on screen is a
// blink of the whole picture, so the still covers the canvas while it
// resizes and draws a few frames at its new size, then dissolves into them.
//
// Governor. Times every frame (and the GPU's share of it, where a timer is
// offered), feeds lib/garden/quality's Governor, and applies its decisions:
// the pixel budget (through the store, which the Canvas reads for its dpr)
// and tier changes. A tier picked by hand (development panel, ?quality=)
// pins the tier; the budget still adapts. A few seconds into a settled visit
// it also keeps a small still for next time (poster.ts).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type * as THREE from "three";
import { composerHandle, preparedComposer } from "@/components/garden/Effects";
import { holdFrame, isHolding, releaseFrame, RESIZE_HOLD } from "@/components/garden/frameHold";
import { GpuTimer } from "@/components/garden/gpuTimer";
import {
  applySet,
  canSwitchSets,
  compilePinned,
  lightSet,
  markReady,
  switchIsNear,
  wantedFullSet,
  withSet,
} from "@/components/garden/lightSets";
import { tierLayerGroups, tierStage, withHiddenLayer } from "@/components/garden/TierLayers";
import { lookOf, savePoster } from "@/components/garden/poster";
import {
  compilePost,
  compileShadowCasters,
  compileSliced,
  compileTransmissionBackfaces,
  predraw,
  unchecked,
  uploadTextures,
  type Compile,
} from "@/components/garden/warmup";
import { rememberTier } from "@/lib/garden/device";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { Governor, quality, stepTier, type Phase, type QualityState } from "@/lib/garden/quality";

/**
 * Seconds of frames under the veil before it lifts: at least the first, then
 * as soon as the frame times have settled at a comfortable rate (frames no
 * longer than REVEAL_FRAME_MS), but never more than the second, so a device
 * that never settles still opens. When the frames are too slow even for the
 * floor the governor is about to ask for a lighter tier, and the veil waits
 * for it up to the third, then takes that step there, rather than lift on a
 * garden that must change.
 */
const CALIBRATE_S = 0.9;
const CALIBRATE_MAX_S = 2.5;
const CALIBRATE_TIER_MAX_S = 4;
const REVEAL_FRAME_MS = 22;
/** Behind a held still the garden is paused, so the settling is brief: a few frames, then the dissolve. */
const HELD_CALIBRATE_S = 0.12;
const HELD_CALIBRATE_MAX_S = 0.4;
/**
 * A held tier change dissolves into the new tier no later than this (ms)
 * after the still went up, unless the new tier's shaders are still compiling
 * (nothing can be drawn before they are). The pre-draw leaves the last
 * HELD_SETTLE_MS of it for the first frames, and is split more coarsely.
 */
const HELD_FREEZE_MS = 1200;
const HELD_SETTLE_MS = 300;
const HELD_PREDRAW_GROUPS = 2;
/** After the reveal, the governor's heavy rungs wait this long (ms) for start-up work to drain. */
const GRACE_MS = 6000;
/** The veil's fade-out, and a held still's dissolve, after which the garden is simply live. */
const REVEAL_MS = 1500;
const HELD_REVEAL_MS = 600;
/** Nothing changes on a live garden until nobody has touched it for this long (ms). */
const INPUT_QUIET_MS = 3000;
/**
 * The opening never takes longer than this to give up waiting on a part and
 * draw anyway. A tier step under the veil waits much less for its compile: a
 * starved driver has been seen to take twenty seconds and more over it, and
 * the veil must not stand that long; what is left compiles on the first
 * frames, still behind the veil.
 */
const COMPOSER_WAIT_MS = 4000;
const COMPILE_WAIT_MS = 25000;
const STEP_COMPILE_WAIT_MS = 5000;
/**
 * Pre-draw groups: each one frame (or a few, while the GPU catches up), and
 * at most this long (ms) for all of them; after a tier step under the veil,
 * on a device just proven slow, less (what it misses is built on the first
 * frames, still veiled).
 */
const PREDRAW_GROUPS = 6;
const PREDRAW_MAX_MS = 4000;
const STEP_PREDRAW_MAX_MS = 2000;
/** At most this many tier changes a session: each is a deliberate fade, not a habit. */
const MAX_TIER_CHANGES = 3;
/**
 * A tier prepared out of sight (TierPreparer): how long its hidden layer and
 * post chain may take to mount, its compile to finish and its pre-draw to run
 * (ms). It is never in a hurry, the live garden carries on meanwhile; what it
 * has not done by then is done behind the still at the swap.
 */
const PREPARE_MOUNT_WAIT_MS = 20000;
const PREPARE_COMPILE_WAIT_MS = 25000;
const PREPARE_PREDRAW_MAX_MS = 6000;
/** Its pre-draw is split finer than the opening's: each group's first draws are a stall the live garden would show. */
const PREPARE_PREDRAW_GROUPS = 8;
/** The still over a prepared swap stays until the new tier has drawn this many frames at its pixel ratio, or this long (ms). */
const SWAP_HOLD = { frames: 3, maxMs: 1500 } as const;
/** The still kept for next time: first this long into a live visit, then refreshed this often (ms). */
const POSTER_AFTER_MS = 5000;
const POSTER_EVERY_MS = 120000;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * When the still for a tier change on a showing garden went up
 * (performance.now() ms), or -1: the opening and the governor share it to
 * keep that freeze within HELD_FREEZE_MS. One canvas per page, so one clock.
 */
let heldAt = -1;

/** Resolves once the post-processing chain has its passes, or after `ms`. */
async function composerReady(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const c = composerHandle.current;
    if (c && c.passes.length > 1) return c;
    await wait(16);
  }
  return composerHandle.current;
}

/** A warm-up step that may fail on an unusual driver: whatever it missed compiles on the first frame instead. */
function attempt(job: () => Promise<unknown>): Promise<unknown> {
  try {
    return job().catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/** Opening marks for the first, veiled opening; a held swap's marks are prefixed so they never read as a first look. */
function mark(name: string) {
  try {
    performance.mark(quality.get().veiled ? `garden:${name}` : `garden:swap-${name}`);
  } catch {
    // marks are a measuring aid only
  }
}

/** Compiles the scene's programs in parallel, then pre-draws them, each time a tier is (re)built. */
export function Opening() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const tier = useGarden((s) => s.quality);

  useEffect(() => {
    if (quality.get().phase !== "compiling") return;
    let cancelled = false;
    (async () => {
      mark("compile-start");
      const composer = await composerReady(COMPOSER_WAIT_MS);
      if (cancelled) return;
      // Compile for the light set the clock asks for now (lightSets.ts).
      if (canSwitchSets(gl)) {
        lightSet.full = wantedFullSet(true);
        lightSet.ready = { full: lightSet.full, day: !lightSet.full };
        lightSet.generation++;
        applySet(scene, lightSet.full);
      }
      const target = composer ? composer.inputBuffer : null;
      const jobs = [
        attempt(() => {
          const previous = gl.getRenderTarget();
          try {
            gl.setRenderTarget(target);
            return gl.compileAsync(scene, camera);
          } finally {
            gl.setRenderTarget(previous);
          }
        }),
        attempt(() => compileShadowCasters(gl, scene, camera, target)),
        attempt(() => compileTransmissionBackfaces(gl, scene, camera, target)),
        composer ? attempt(() => compilePost(gl, composer)) : Promise.resolve(),
        // after the compile calls have been issued, while the driver works through them
        attempt(() => wait(0).then(() => uploadTextures(gl, scene))),
      ];
      // Near the day/night light switch, the other set is prepared here too, behind the veil.
      if (canSwitchSets(gl) && switchIsNear()) {
        const other = !lightSet.full;
        const pinned: Compile = (s, c, t) => compilePinned(gl, s, c, t);
        jobs.push(
          attempt(() => {
            let pending: Promise<unknown> = Promise.resolve();
            withSet(scene, other, () => {
              const previous = gl.getRenderTarget();
              try {
                gl.setRenderTarget(target);
                pending = Promise.all([
                  compilePinned(gl, scene, camera),
                  compileShadowCasters(gl, scene, camera, target, pinned),
                  compileTransmissionBackfaces(gl, scene, camera, target, pinned),
                ]);
              } finally {
                gl.setRenderTarget(previous);
              }
            });
            return pending.then(() => markReady(other));
          }),
        );
      }
      const q = quality.get();
      const step = q.veiled && q.tierChanges > 0;
      await Promise.race([Promise.all(jobs), wait(step ? STEP_COMPILE_WAIT_MS : COMPILE_WAIT_MS)]);
      if (cancelled) return;
      mark("compiled");
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __gardenCompiled?: number }).__gardenCompiled = gl.info.programs?.length ?? 0;
      }
      // The pre-draw waits on the GPU between groups, which on a GPU shared
      // with a busy tab can take seconds each: under the veil it gets
      // PREDRAW_MAX_MS (less after a tier step), behind a held still what is
      // left of the freeze's allowance (a group at least). What it has not
      // reached is built on the first frames instead, still unseen or under
      // the dissolve.
      const until = quality.get().veiled
        ? performance.now() + (step ? STEP_PREDRAW_MAX_MS : PREDRAW_MAX_MS)
        : Math.max(performance.now() + 100, heldAt + HELD_FREEZE_MS - HELD_SETTLE_MS);
      const groups = quality.get().veiled ? PREDRAW_GROUPS : HELD_PREDRAW_GROUPS;
      const pre = attempt(() => predraw(gl, scene, camera, groups, () => cancelled || performance.now() > until));
      await Promise.race([pre, wait(until - performance.now())]);
      if (cancelled) return;
      mark("predrawn");
      quality.set({ phase: "warming" });
    })();
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, tier]);

  return null;
}

/** TierPreparers mounted now: a canvas without one (the party screen) has no hidden layer to prepare. */
let preparers = 0;

/** A tier change on a showing garden is prepared out of sight when the driver compiles in parallel (TierLayers). */
function canPrepare(gl: THREE.WebGLRenderer, q: QualityState): boolean {
  return preparers > 0 && !q.veiled && (q.phase === "live" || q.phase === "revealing") && canSwitchSets(gl);
}

/** The light sets the prepared tier's programs were compiled for, handed to lightSets at the swap. */
const preparedSets = { full: false, day: false };

/** Resolves with the hidden layer once it is mounted and its post chain has its passes, or after `ms` with what there is. */
async function hiddenLayerReady(ms: number, cancelled: () => boolean) {
  const until = performance.now() + ms;
  for (;;) {
    if (cancelled()) return null;
    const layer = tierLayerGroups[tierStage.get().slot === 0 ? 1 : 0];
    const composer = preparedComposer.current;
    if (layer && composer && composer.passes.length > 1) return { layer, composer };
    if (performance.now() > until) return layer ? { layer, composer } : null;
    await wait(32);
  }
}

/**
 * Prepares the hidden layer's tier for the swap, as the opening prepares the
 * first one, but never stopping the live garden: its programs (the scene's,
 * the shadow pass's and the leaves' back faces, under its own lights; and
 * when the day/night switch is near, under the other light set too) compile
 * in parallel a few objects per frame (warmup.compileSliced), its post
 * chain's with them, its textures upload a few at a time, and it is
 * pre-drawn a group per frame into a tiny target. Each synchronous step runs
 * with the hidden layer standing in for the live one (withHiddenLayer), in
 * one task, so no frame sees it.
 */
async function prepareTier(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, cancelled: () => boolean) {
  mark("prepare-start");
  const hidden = await hiddenLayerReady(PREPARE_MOUNT_WAIT_MS, cancelled);
  if (!hidden || cancelled()) return false;
  const { layer, composer } = hidden;
  mark("prepare-mounted");
  const target = composer ? composer.inputBuffer : null;
  const live = lightSet.full;
  const sets = { full: live, day: !live };
  // the hidden layer in the live one's place, under the live light set or the other one
  const under = (set: boolean | null) => (step: (stand: THREE.Scene) => void) =>
    withHiddenLayer(scene, (stand) => (set === null ? step(stand) : withSet(stand, set, () => step(stand))));
  const compiled = compileSliced(gl, camera, target, under(null), cancelled).then(async (ok) => {
    // near the day/night switch the other set is prepared too, as the opening does
    if (!ok || !switchIsNear()) return ok;
    if (await compileSliced(gl, camera, target, under(!live), cancelled)) {
      if (live) sets.day = true;
      else sets.full = true;
    }
    return ok;
  });
  const jobs: Promise<unknown>[] = [attempt(() => compiled)];
  if (composer) jobs.push(attempt(() => wait(0).then(() => compilePost(gl, composer))));
  jobs.push(attempt(() => wait(0).then(() => uploadTextures(gl, layer))));
  await Promise.race([Promise.all(jobs), wait(PREPARE_COMPILE_WAIT_MS)]);
  if (cancelled()) return false;
  mark("prepare-compiled");
  const until = performance.now() + PREPARE_PREDRAW_MAX_MS;
  // its programs' first draws, done here so the swap has none left (warmup.unchecked)
  await attempt(() =>
    predraw(gl, scene, camera, PREPARE_PREDRAW_GROUPS, () => cancelled() || performance.now() > until, (step) => {
      withHiddenLayer(scene, unchecked(gl, step));
    }),
  );
  if (cancelled()) return false;
  preparedSets.full = sets.full;
  preparedSets.day = sets.day;
  mark("prepare-ready");
  return true;
}

/** Prepares each tier TierLayers mounts out of sight, and marks it ready for the swap (RenderGovernor). */
export function TierPreparer() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    let job: { tier: Quality; cancelled: boolean } | null = null;
    const follow = () => {
      const s = tierStage.get();
      if (job && job.tier !== s.preparing) {
        job.cancelled = true;
        job = null;
      }
      if (job || s.preparing === null || s.ready) return;
      const j = { tier: s.preparing, cancelled: false };
      job = j;
      const cancelled = () => j.cancelled || tierStage.get().preparing !== j.tier;
      void prepareTier(gl, scene, camera, cancelled).then((ok) => {
        if (job === j) job = null;
        if (cancelled()) return;
        // a preparation that could not finish is dropped, so the governor can ask again in its next window
        if (ok) tierStage.markReady(j.tier);
        else tierStage.cancel();
      });
    };
    preparers++;
    follow();
    const off = tierStage.subscribe(follow);
    return () => {
      preparers--;
      off();
      if (job) job.cancelled = true;
    };
  }, [gl, scene, camera]);

  return null;
}

/**
 * Swaps the tier and lets the opening run again: under the veil if it is
 * still up, otherwise behind a still of the frame just drawn (call it from
 * the frame loop, after the composer, so that frame is still readable).
 * `ownTier` records that this change is the governor's, so it does not read
 * as a tier picked by hand.
 */
function changeTier(next: Quality, canvas: HTMLCanvasElement, governor: Governor, ownTier: RefObject<Quality>) {
  const q = quality.get();
  if (!q.veiled) {
    if (!isHolding()) holdFrame(canvas);
    heldAt = performance.now();
    mark("held");
  }
  // a change made in place replaces any tier being prepared out of sight
  tierStage.cancel();
  ownTier.current = next;
  quality.adoptTier(next);
  const after = quality.get();
  governor.reset(after.range, after.budget, q.veiled ? undefined : performance.now());
  quality.set({ phase: "compiling", tierChanges: q.tierChanges + 1 });
  garden.set({ quality: next });
}

/** A prepared swap's still: when it went up, and the frames drawn since at the new tier's pixel ratio. */
interface SwapHold {
  at: number;
  dpr: number;
  frames: number;
  held: boolean;
}

/**
 * The prepared tier goes live (TierLayers, TierPreparer): a still of the
 * frame just drawn goes up (call it from the frame loop, after the composer),
 * the budget restarts in the new tier's range, and the hidden layer is
 * shown in the commit before the next frame. Nothing is built or compiled
 * here; the still dissolves once the new tier has drawn a few frames.
 */
function swapTier(
  next: Quality,
  byGovernor: boolean,
  canvas: HTMLCanvasElement,
  governor: Governor,
  ownTier: RefObject<Quality>,
  now: number,
): SwapHold {
  const held = isHolding() || holdFrame(canvas);
  mark("held");
  ownTier.current = next;
  quality.adoptTier(next);
  const q = quality.get();
  governor.reset(q.range, q.budget, now);
  // its first frames are its own start-up (the post chain sizing its buffers, the last draw variants), not the device
  governor.beginGrace(now, GRACE_MS);
  if (byGovernor) quality.set({ tierChanges: q.tierChanges + 1 });
  // the new tier's materials are compiled for the light sets its preparation saw; a preparation still running is stale
  lightSet.ready = { ...preparedSets };
  lightSet.generation++;
  if (garden.get().quality !== next) garden.set({ quality: next });
  tierStage.swapped();
  return { at: now, dpr: q.dpr, frames: 0, held };
}

/** When a finger, mouse, wheel or key last moved the garden (performance.now() ms). */
function useLastInput(target: HTMLElement | null): RefObject<number> {
  const last = useRef(-Infinity);
  useEffect(() => {
    const touch = () => {
      last.current = performance.now();
    };
    const move = (e: PointerEvent) => {
      if (e.buttons !== 0 || e.pointerType === "touch") touch();
    };
    const el = target ?? window;
    el.addEventListener("pointerdown", touch, { passive: true });
    el.addEventListener("pointermove", move as EventListener, { passive: true });
    el.addEventListener("wheel", touch, { passive: true });
    window.addEventListener("keydown", touch);
    return () => {
      el.removeEventListener("pointerdown", touch);
      el.removeEventListener("pointermove", move as EventListener);
      el.removeEventListener("wheel", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [target]);
  return last;
}

/** Times frames, runs the governor, and carries out its decisions. */
export function RenderGovernor() {
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const timer = useMemo(() => GpuTimer.create(gl.getContext()), [gl]);
  const governor = useMemo(() => {
    const q = quality.get();
    return new Governor(q.range, q.budget);
  }, []);
  /** The tier the governor itself last set, so a change made by hand can be told apart. */
  const ownTier = useRef<Quality>(garden.get().quality);
  const clock = useRef({
    phase: "boot" as Phase,
    since: 0,
    statsAt: 0,
    range: quality.get().range,
    refresh: 0,
    liveAt: -1,
    posterAt: -1,
    /** The tier above has been remembered for the next visit (Governor.roomAbove). */
    roomNoted: false,
    /** A budget change being drawn behind the still: the pixel ratio it waits for, since when, and frames drawn at it. */
    resize: null as { dpr: number; at: number; frames: number } | null,
    /** A prepared tier just swapped in behind the still (swapTier). */
    swap: null as SwapHold | null,
  });
  const lastInput = useLastInput(gl.domElement.parentElement);

  useEffect(() => () => timer?.dispose(), [timer]);

  useLayoutEffect(() => {
    quality.setCss(width, height);
  }, [width, height]);

  // A tier chosen anywhere but here pins the tier; the budget restarts in that tier's range.
  useEffect(
    () =>
      garden.subscribe(() => {
        const tier = garden.get().quality;
        if (tier === ownTier.current) return;
        const from = ownTier.current;
        ownTier.current = tier;
        const before = quality.get();
        // On a showing garden the new tier is built and compiled out of sight
        // first (TierLayers, TierPreparer); the frame loop swaps it in once it
        // is ready, and the budget restarts then.
        if (canPrepare(gl, before)) {
          quality.set({ pinned: true });
          tierStage.prepare(from, tier, false);
          return;
        }
        tierStage.cancel();
        // The garden has been seen: hold a still of it while the new tier
        // builds. React has not re-rendered the scene yet (the store only
        // schedules that), so one more frame of the old tier is drawn here
        // to copy from.
        if (!before.veiled && (before.phase === "live" || before.phase === "revealing") && !isHolding()) {
          try {
            composerHandle.current?.render();
            holdFrame(gl.domElement);
          } catch {
            // without a still the new tier simply appears
          }
        }
        if (!before.veiled) {
          heldAt = performance.now();
          mark("held");
        }
        quality.set({ pinned: true });
        quality.adoptTier(tier);
        const q = quality.get();
        governor.reset(q.range, q.budget, before.veiled ? undefined : performance.now());
        // The new tier's shaders compile behind the veil or the still instead of freezing the frame.
        if (q.phase !== "boot" && q.phase !== "compiling") quality.set({ phase: "compiling" });
      }),
    [governor, gl],
  );

  // Dev-only handle for measuring from the console.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __gardenQuality?: () => unknown; __gardenBudget?: unknown; __gardenComposer?: unknown };
    w.__gardenBudget = quality;
    w.__gardenComposer = composerHandle;
    (window as unknown as { __gardenLights?: unknown }).__gardenLights = lightSet;
    // `__gardenTiers.prepare(from, to, true)` rehearses the governor's prepared step down
    (window as unknown as { __gardenTiers?: unknown }).__gardenTiers = tierStage;
    w.__gardenQuality = () => {
      const q = quality.get();
      return {
        phase: q.phase,
        veiled: q.veiled,
        tier: garden.get().quality,
        drawn: tierStage.get().hold ?? garden.get().quality,
        preparing: tierStage.get().preparing,
        prepared: tierStage.get().ready,
        kind: q.device?.kind,
        gpu: q.device?.gpu,
        budget: +q.budget.toFixed(2),
        range: q.range,
        dpr: q.dpr,
        pinned: q.pinned,
        tierChanges: q.tierChanges,
        timer: Boolean(timer),
        refreshHz: governor.refreshHz,
        roomAbove: governor.roomAbove,
        last: governor.last,
      };
    };
  }, [governor, timer]);

  // Just before the composer (priority 1) draws, so the frame's JavaScript is not counted as GPU time.
  useFrame(() => {
    timer?.begin();
  }, 0.99);

  // After the composer (priority 1) has drawn the frame.
  useFrame((_, delta) => {
    timer?.end();
    const gpuMs = timer ? timer.poll() : null;
    const q = quality.get();
    const now = performance.now();
    const c = clock.current;
    if (q.phase !== c.phase) {
      c.phase = q.phase;
      c.since = now;
    }
    if (q.range !== c.range) {
      // The canvas changed size: a new floor and ceiling, the budget as the store left it.
      c.range = q.range;
      governor.setRange(q.range, q.budget);
    }
    if (q.refreshHz !== c.refresh) {
      // The panel's rate, measured at startup: what smooth means on this screen.
      c.refresh = q.refreshHz;
      governor.setRefresh(q.refreshHz);
    }
    const phaseS = (now - c.since) / 1000;
    const showing = q.phase === "revealing" || q.phase === "live";

    // A budget change behind the still: once a few frames are drawn at the new
    // size, the still dissolves into them. A tier change that started
    // meanwhile owns the still now and releases it itself.
    const r = c.resize;
    if (r) {
      if (!showing) c.resize = null;
      else {
        if (Math.abs(gl.getPixelRatio() - r.dpr) < 1e-6) r.frames++;
        if (r.frames >= RESIZE_HOLD.frames || now - r.at > RESIZE_HOLD.maxMs) {
          c.resize = null;
          releaseFrame(RESIZE_HOLD.dissolveMs);
        }
      }
    }

    // A prepared tier swapped in behind the still: once it has drawn a few
    // frames at its pixel ratio, the still dissolves into it. A tier change
    // made in place meanwhile owns the still now.
    const w = c.swap;
    if (w) {
      if (!showing) c.swap = null;
      else {
        if (Math.abs(gl.getPixelRatio() - w.dpr) < 1e-6) w.frames++;
        if (w.frames >= SWAP_HOLD.frames || now - w.at > SWAP_HOLD.maxMs) {
          c.swap = null;
          mark("revealed");
          if (w.held) releaseFrame(HELD_REVEAL_MS);
        }
      }
    }

    // A tier prepared out of sight is ready: it goes live now, behind a still
    // of the frame just drawn, unless the governor asked for it and someone is
    // touching the garden (a tier picked by hand goes at once).
    const stage = tierStage.get();
    const touched = now - lastInput.current < INPUT_QUIET_MS;
    if (stage.ready && stage.preparing !== null && showing && !c.resize && !c.swap && !(stage.byGovernor && touched)) {
      c.swap = swapTier(stage.preparing, stage.byGovernor, gl.domElement, governor, ownTier, now);
      return;
    }

    if (q.phase === "warming") {
      // The first frame has been drawn (and its leftover shaders compiled).
      mark("first-frame");
      quality.set({ phase: "calibrating" });
      return;
    }
    if (q.phase === "compiling" || q.phase === "boot") return;

    const calibrating = q.phase === "calibrating";
    // the tier on screen (another may be being prepared out of sight)
    const tier = stage.hold ?? garden.get().quality;
    const canStep = !q.pinned && q.tierChanges < MAX_TIER_CHANGES && q.plan !== null;
    const lowest = !canStep || stepTier(tier, -1, q.plan?.maxTier ?? tier) === null;
    // Room above is only ever noted for the next visit, so the session's tier changes do not limit it.
    const highest = q.pinned || stepTier(tier, 1, q.plan?.maxTier ?? tier) === null;
    const interacting = touched;
    // Sampled even when frozen (?governor=off), so the readout still reports the frame.
    const sampled = governor.sample(delta * 1000, gpuMs, now, { calibrating, lowest, highest, interacting });
    const decision = q.auto ? sampled : { kind: "none" as const };
    if (!q.auto && sampled.kind === "budget") governor.hold(q.budget);
    if (now - c.statsAt > 1000) {
      c.statsAt = now;
      const l = governor.last;
      quality.set({ stats: { fps: l.fps, frameMs: l.frameMs, gpuMs: l.gpuMs, timer: Boolean(timer) } });
    }

    if (decision.kind === "budget") {
      quality.set({ budget: decision.budget });
      // On a showing garden the canvas resizes behind a still of the frame just
      // drawn (React applies the new pixel ratio after this frame, before the
      // browser paints). Under the veil, or a still already held for a tier
      // change, nobody can see it.
      const dpr = quality.get().dpr;
      if (showing && dpr !== q.dpr && (c.resize || !isHolding()) && (c.resize || holdFrame(gl.domElement))) {
        c.resize = { dpr, at: now, frames: 0 };
      }
    } else if (decision.kind === "tier" && canStep && q.plan) {
      // Out in the open, only while nobody is touching the garden; the governor asks again next window.
      const quiet = calibrating || !interacting;
      const next = stepTier(tier, decision.dir, q.plan.maxTier);
      if (next && quiet) {
        if (canPrepare(gl, q)) {
          // On a showing garden the step is prepared out of sight first and
          // made once it is ready; asked again meanwhile, it simply waits.
          if (stage.preparing === null) {
            if (decision.dir < 0) governor.slowTierUp();
            tierStage.prepare(tier, next, true);
          }
        } else {
          if (decision.dir < 0) governor.slowTierUp();
          changeTier(next, gl.domElement, governor, ownTier);
          return;
        }
      }
    }

    if (calibrating) {
      const held = !q.veiled;
      const settled = governor.stable && governor.last.frameMs <= Math.max(REVEAL_FRAME_MS, governor.slowMs);
      const minS = held ? HELD_CALIBRATE_S : CALIBRATE_S;
      const maxS = held ? HELD_CALIBRATE_MAX_S : governor.wantsTier ? CALIBRATE_TIER_MAX_S : CALIBRATE_MAX_S;
      // A held still's allowance spent: it dissolves into whatever the new tier is drawing by now.
      const spent = held && heldAt >= 0 && now - heldAt > HELD_FREEZE_MS && phaseS > 0.05;
      if ((phaseS > minS && settled) || phaseS > maxS || spent) {
        // The veil's time is up with the floor rule still deciding: its tier
        // step is taken now, still veiled, rather than seconds after the
        // reveal behind a held still (P1).
        if (!held && phaseS > maxS && q.auto && canStep && q.plan) {
          const next = governor.settleTier(lowest).kind === "tier" ? stepTier(tier, -1, q.plan.maxTier) : null;
          if (next) {
            governor.slowTierUp();
            changeTier(next, gl.domElement, governor, ownTier);
            return;
          }
        }
        mark("revealed");
        governor.beginGrace(now, GRACE_MS);
        quality.set({ phase: "revealing" });
        if (held) {
          heldAt = -1;
          releaseFrame(HELD_REVEAL_MS);
        }
      }
    } else if (q.phase === "revealing" && now - c.since > (q.veiled ? REVEAL_MS : HELD_REVEAL_MS)) {
      mark("live");
      c.liveAt = now;
      quality.set({ phase: "live", veiled: false });
      // A startup refresh reading of 30 Hz is believed only if a second one, now, agrees.
      quality.confirmRefresh();
    } else if (q.phase === "live") {
      // Once the garden has settled, keep a still for the next visit's veil and
      // the tier this device settled on, so the next visit opens on it (or on
      // the tier above, once the governor has found room for it: that climb is
      // never made on a showing garden). Both only on the real clock: a
      // friend's garden and the party screen hold the clock by hand, and must
      // not decide how the viewer's own garden opens.
      const due = c.posterAt < 0 ? now - c.liveAt > POSTER_AFTER_MS : now - c.posterAt > POSTER_EVERY_MS;
      const g = garden.get();
      const room = governor.roomAbove && !q.pinned && q.plan ? stepTier(g.quality, 1, q.plan.maxTier) : null;
      const remember = () => {
        if (g.autoClock && !q.pinned && q.device) rememberTier(q.device, g.quality, room ?? undefined);
      };
      if (due && c.liveAt >= 0 && !document.hidden) {
        c.posterAt = now;
        if (g.autoClock) savePoster(gl.domElement, lookOf(g));
        remember();
      } else if (room && !c.roomNoted) remember();
      c.roomNoted = room !== null;
    }
  }, 2);

  return null;
}
