"use client";
// The party trailer, played in the canvas (components/party/PartyScene). Before the clock runs (priority -11, ahead of
// the garden's clock at -10) it writes the trailer's frame into the garden's store (the hour, growth, bloom, rain and
// cloud), the party camera's shot, the depth of field's focus and the black over the picture, and tells the doe and
// the page's overlay what they show.
//
// When the trailer is asked for, the page dips to black (control.ts); under it the director lets the garden draw what
// the opening never drew, a seed in its mound at night in the rain (the mound, the saucer's puddle, the moon), then
// sets the dawn the trailer opens on, waits for the plant to sink to its seed and the frame rate to settle, and only
// then starts the clock. The clock advances by the frame's time, capped, so a slow frame reads as a pause, never a
// jump; at each gate (a flower changed, the garden put back, always under black) it waits for the garden to settle
// again. Anything that throws here stops the trailer and brings the panel back, rather than freezing the screen.
import { useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Doe, doeHandle, type DoeStage } from "@/components/deer/Doe";
import { lightSet } from "@/components/garden/lightSets";
import { weather } from "@/components/garden/garden/weather";
import { goldenHour } from "@/components/party/logic";
import { finishTrailer, OPEN_S, PREPARE_MAX_S, putBack, returnPanel, run, stopTrailer } from "@/components/party/trailer/control";
import { blankFrame, GATES, MONTAGE, RESTORE_AT, RETURN_AT, TRAILER_S, trailerAt } from "@/components/party/trailer/script";
import { cover, trailer, trailerCam, trailerCues } from "@/components/party/trailer/store";
import { env } from "@/lib/garden/env";
import { garden } from "@/lib/garden/store";

/** The clock's longest step (s): below about 20 frames a second the trailer slows rather than skips. */
const MAX_STEP = 0.05;
/** Under black before the trailer: the night-and-rain look shown first (s), then the dawn held at least this long. */
const PRIME_S = 0.6;
const SETTLE_S = 2.4;
/**
 * The garden has settled when this many frames in a row came in no slower than the device's usual frame by this much
 * (or under `CALM_DT`), and at least `GATE_MIN_S` has passed; a gate never waits longer than `GATE_MAX_S`, so a slow
 * device plays on rather than stopping in the black.
 */
const CALM_FRAMES = 6;
const CALM_DT = 1 / 24;
const CALM_OVER = 1.6;
const GATE_MIN_S = 0.35;
const GATE_MAX_S = 3;
/** The usual frame (s), learned as the trailer plays, from frames under this. */
const USUAL_MAX = 0.25;
/** The doe's head bone (components/deer/build BONE_NAMES). */
const HEAD_BONE = 7;

type Prep = "dip" | "prime" | "dawn";

interface Run {
  prep: Prep;
  prepAt: number;
  t: number;
  golden: number;
  /** a gate the clock waits at: since when, and frames in a row that came in calm */
  gate: number | null;
  gateAt: number;
  calm: number;
  /** the device's usual frame time (s), eased */
  usual: number;
  returned: boolean;
}

const frame = blankFrame();
const focus = new THREE.Vector3();
const doeHead = new THREE.Vector3();

/**
 * The doe's cue: she is in the garden while the trailer's frame says so, shown off stage while the trailer prepares
 * (so a light set prepared then draws her too), and on the trailer's own clock.
 */
const DOE_STAGE: DoeStage = { on: () => trailerCues.doe, primed: () => trailer.get().phase === "opening", maxStep: MAX_STEP };

function write(t: number, golden: number) {
  trailerAt(t, golden, frame);
  if (!frame.restored) {
    garden.set({ hour: frame.hour, growth: frame.growth, bloom: frame.bloom, rain: frame.rain, cloud: frame.cloud });
    Object.assign(trailerCam.shot, frame.shot);
  }
  trailerCues.doe = frame.doe;
  const head = doeHandle.anim?.bones[HEAD_BONE];
  if (frame.rack > 0.001 && head) {
    head.getWorldPosition(doeHead);
    env.focus = focus.copy(env.headPos).lerp(doeHead, frame.rack);
  } else env.focus = null;
  cover.set(frame.cover);
  trailer.set({
    captionOn: frame.caption !== null,
    ...(frame.caption !== null && { caption: frame.caption }),
    subOn: frame.sub !== null,
    ...(frame.sub !== null && { sub: frame.sub }),
    card: frame.card,
  });
}

export function TrailerDirector() {
  const gl = useThree((s) => s.gl);
  const state = useRef<Run>({ prep: "dip", prepAt: 0, t: 0, golden: 17.5, gate: null, gateAt: 0, calm: 0, usual: 1 / 60, returned: false });

  // Dev-only: the trailer's clock, for checking it from the console.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __trailer?: unknown }).__trailer = state;
  }, []);

  // A lost GPU context leaves a frozen picture: the trailer stops and the panel comes back, and no trailer starts until
  // the context is back.
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = () => {
      run.lost = true;
      stopTrailer();
    };
    const restored = () => {
      run.lost = false;
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const r = state.current;
    const phase = trailer.get().phase;
    if (phase !== "opening" && phase !== "playing") {
      r.prep = "dip";
      return;
    }
    // the page's watchdog: the garden is still drawing (a lost context draws nothing, so it lets the watchdog act)
    if (!run.lost) run.beat = performance.now();
    try {
      const now = performance.now();
      const calm = delta < Math.max(CALM_DT, r.usual * CALM_OVER) ? r.calm + 1 : 0;
      r.calm = calm;
      if (delta < USUAL_MAX) r.usual += (delta - r.usual) * 0.05;
      if (phase === "opening") {
        if (r.prep === "dip") {
          // wait for the black, and for the full light set (a rehearsal opened at noon prepares it first, the doe and
          // the showcase garden drawn under it)
          if (now - run.openedAt < OPEN_S * 1000) return;
          if (!lightSet.full && now - run.openedAt < (OPEN_S + PREPARE_MAX_S) * 1000) return;
          r.golden = goldenHour(new Date());
          // first draws the opening never made: the seed's mound, the moon, and the saucer's puddle in the rain
          garden.set({ growth: 0, bloom: 0, hour: r.golden + 2, rain: 0.6, cloud: 0.8 });
          trailerCam.active = true;
          trailerAt(0, r.golden, frame);
          Object.assign(trailerCam.shot, frame.shot);
          r.prep = "prime";
          r.prepAt = now;
          return;
        }
        if (r.prep === "prime") {
          if (now - r.prepAt < PRIME_S * 1000) return;
          trailerAt(0, r.golden, frame);
          garden.set({ hour: frame.hour, growth: 0, bloom: 0, rain: 0, cloud: frame.cloud });
          // dry stones and the dawn's lantern at once
          weather.primed = false;
          r.prep = "dawn";
          r.prepAt = now;
          return;
        }
        // the plant sunk to its seed, the full light set live, calm frames
        const waited = now - r.prepAt;
        const lit = lightSet.full || now - run.openedAt > (OPEN_S + PREPARE_MAX_S) * 1000;
        const settled = calm >= CALM_FRAMES || waited > (SETTLE_S + GATE_MAX_S) * 1000;
        if (waited < SETTLE_S * 1000 || !lit || !settled) return;
        r.t = 0;
        r.gate = null;
        r.returned = false;
        trailerCam.snapFrames = 2;
        trailer.set({ phase: "playing" });
        write(0, r.golden);
        return;
      }

      // playing
      if (r.gate !== null) {
        const waited = now - r.gateAt;
        if (waited < GATE_MIN_S * 1000 || (calm < CALM_FRAMES && waited < GATE_MAX_S * 1000)) return;
        r.gate = null;
        trailerCam.snapFrames = Math.max(trailerCam.snapFrames, 3);
      } else {
        const t = r.t + Math.min(delta, MAX_STEP);
        const crossed = GATES.find((g) => r.t < g && t >= g);
        if (crossed !== undefined) {
          r.t = crossed;
          write(crossed, r.golden);
          if (crossed >= RESTORE_AT) putBack();
          else garden.set({ speciesId: MONTAGE[GATES.indexOf(crossed)] });
          r.gate = crossed;
          r.gateAt = now;
          r.calm = 0;
          return;
        }
        r.t = t;
      }
      write(r.t, r.golden);
      if (!r.returned && r.t >= RETURN_AT) {
        r.returned = true;
        returnPanel();
      }
      if (r.t >= TRAILER_S) finishTrailer();
    } catch (error) {
      console.error("[party] the trailer stopped", error);
      stopTrailer();
    }
  }, -11);

  return null;
}

/** Catches the doe failing to build, inside the canvas, so the party screen carries on without her. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[party] the trailer's doe could not be built", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The trailer's visitor: built and prepared with the garden, waiting off stage for her cue. */
export function TrailerDoe() {
  return (
    <QuietBoundary>
      <Doe act="arrive" lookAt={env.headPos} stage={DOE_STAGE} />
    </QuietBoundary>
  );
}
