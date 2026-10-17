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
// slow, and the veil lifts.
//
// Once the garden has been seen it never goes back behind the veil. A tier
// change after that (the governor's, only after a sustained drop while nobody
// is touching the screen, or one picked in the development panel) holds a
// still of the last frame over the canvas (frameHold.ts), runs the same
// opening behind it, and dissolves the still into the new tier. A change of
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
import { composerHandle } from "@/components/garden/Effects";
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
import { lookOf, savePoster } from "@/components/garden/poster";
import {
  compilePost,
  compileShadowCasters,
  compileTransmissionBackfaces,
  predraw,
  uploadTextures,
  type Compile,
} from "@/components/garden/warmup";
import { rememberTier } from "@/lib/garden/device";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { Governor, quality, stepTier, type Phase } from "@/lib/garden/quality";

/**
 * Seconds of frames under the veil before it lifts: at least the first, then
 * as soon as the frame times have settled at a comfortable rate (frames no
 * longer than REVEAL_FRAME_MS), but never more than the second, so a device
 * that never settles still opens. When the governor is at its floor and
 * still slow it is about to ask for a lighter tier, and the veil waits for
 * it up to the third, rather than lift on a garden that must change.
 */
const CALIBRATE_S = 0.9;
const CALIBRATE_MAX_S = 2.5;
const CALIBRATE_TIER_MAX_S = 4;
const REVEAL_FRAME_MS = 22;
/** Behind a held still the garden is paused, so the settling is brief. */
const HELD_CALIBRATE_S = 0.35;
const HELD_CALIBRATE_MAX_S = 1.5;
/** After the reveal, the governor's heavy rungs wait this long (ms) for start-up work to drain. */
const GRACE_MS = 6000;
/** The veil's fade-out, and a held still's dissolve, after which the garden is simply live. */
const REVEAL_MS = 1500;
const HELD_REVEAL_MS = 600;
/** Nothing changes on a live garden until nobody has touched it for this long (ms). */
const INPUT_QUIET_MS = 3000;
/** The opening never takes longer than this to give up waiting on a part and draw anyway. */
const COMPOSER_WAIT_MS = 4000;
const COMPILE_WAIT_MS = 25000;
/** Pre-draw groups: each one frame (or a few, while the GPU catches up). */
const PREDRAW_GROUPS = 6;
/** At most this many tier changes a session: each is a deliberate fade, not a habit. */
const MAX_TIER_CHANGES = 3;
/** The still kept for next time: first this long into a live visit, then refreshed this often (ms). */
const POSTER_AFTER_MS = 5000;
const POSTER_EVERY_MS = 120000;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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
      await Promise.race([Promise.all(jobs), wait(COMPILE_WAIT_MS)]);
      if (cancelled) return;
      mark("compiled");
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __gardenCompiled?: number }).__gardenCompiled = gl.info.programs?.length ?? 0;
      }
      await attempt(() => predraw(gl, scene, camera, PREDRAW_GROUPS, () => cancelled));
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

/**
 * Swaps the tier and lets the opening run again: under the veil if it is
 * still up, otherwise behind a still of the frame just drawn (call it from
 * the frame loop, after the composer, so that frame is still readable).
 * `ownTier` records that this change is the governor's, so it does not read
 * as a tier picked by hand.
 */
function changeTier(next: Quality, canvas: HTMLCanvasElement, governor: Governor, ownTier: RefObject<Quality>) {
  const q = quality.get();
  if (!q.veiled && !isHolding()) holdFrame(canvas);
  ownTier.current = next;
  quality.adoptTier(next);
  const after = quality.get();
  governor.reset(after.range, after.budget, q.veiled ? undefined : performance.now());
  quality.set({ phase: "compiling", tierChanges: q.tierChanges + 1 });
  garden.set({ quality: next });
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
    liveAt: -1,
    posterAt: -1,
    /** A budget change being drawn behind the still: the pixel ratio it waits for, since when, and frames drawn at it. */
    resize: null as { dpr: number; at: number; frames: number } | null,
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
        ownTier.current = tier;
        const before = quality.get();
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
    w.__gardenQuality = () => {
      const q = quality.get();
      return {
        phase: q.phase,
        veiled: q.veiled,
        tier: garden.get().quality,
        kind: q.device?.kind,
        gpu: q.device?.gpu,
        budget: +q.budget.toFixed(2),
        range: q.range,
        dpr: q.dpr,
        pinned: q.pinned,
        tierChanges: q.tierChanges,
        timer: Boolean(timer),
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

    if (q.phase === "warming") {
      // The first frame has been drawn (and its leftover shaders compiled).
      mark("first-frame");
      quality.set({ phase: "calibrating" });
      return;
    }
    if (q.phase === "compiling" || q.phase === "boot") return;

    const calibrating = q.phase === "calibrating";
    const tier = garden.get().quality;
    const canStep = !q.pinned && q.tierChanges < MAX_TIER_CHANGES && q.plan !== null;
    const lowest = !canStep || stepTier(tier, -1, q.plan?.maxTier ?? tier) === null;
    const highest = !canStep || stepTier(tier, 1, q.plan?.maxTier ?? tier) === null;
    const interacting = now - lastInput.current < INPUT_QUIET_MS;
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
        if (decision.dir < 0) governor.slowTierUp();
        changeTier(next, gl.domElement, governor, ownTier);
        return;
      }
    }

    if (calibrating) {
      const held = !q.veiled;
      const settled = governor.stable && governor.last.frameMs <= REVEAL_FRAME_MS;
      const minS = held ? HELD_CALIBRATE_S : CALIBRATE_S;
      const maxS = held ? HELD_CALIBRATE_MAX_S : governor.wantsTier ? CALIBRATE_TIER_MAX_S : CALIBRATE_MAX_S;
      if ((phaseS > minS && settled) || phaseS > maxS) {
        mark("revealed");
        governor.beginGrace(now, GRACE_MS);
        quality.set({ phase: "revealing" });
        if (held) releaseFrame(HELD_REVEAL_MS);
      }
    } else if (q.phase === "revealing" && now - c.since > (q.veiled ? REVEAL_MS : HELD_REVEAL_MS)) {
      mark("live");
      c.liveAt = now;
      quality.set({ phase: "live", veiled: false });
    } else if (q.phase === "live") {
      // Once the garden has settled, keep a still for the next visit's veil and
      // the tier this device settled on, so the next visit opens on it. Both
      // only on the real clock: a friend's garden and the party screen hold the
      // clock by hand, and must not decide how the viewer's own garden opens.
      const due = c.posterAt < 0 ? now - c.liveAt > POSTER_AFTER_MS : now - c.posterAt > POSTER_EVERY_MS;
      const g = garden.get();
      if (due && c.liveAt >= 0 && !document.hidden) {
        c.posterAt = now;
        if (g.autoClock) {
          savePoster(gl.domElement, lookOf(g));
          if (!q.pinned && q.device) rememberTier(q.device, g.quality);
        }
      }
    }
  }, 2);

  return null;
}
