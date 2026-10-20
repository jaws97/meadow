// The courtyard's moments as timings (product/timings.ts): the pour's beats and its level waiting for the water, a
// refused top-up easing the pot home in each of its windows without a jump, the latch that plays a pour on after its
// stamp has gone, the spill's threshold and its drying, the pellets, the planting's glide, and that the planting plays
// once per plant on a device, only fresh.
import { describe, expect, it } from "vitest";
import {
  claimGlide,
  GLIDE,
  GLIDE_KEY,
  glideState,
  newPourLatch,
  PELLETS,
  pelletLeft,
  POUR,
  POUR_FADE,
  POUR_HOME,
  POUR_SETTLE,
  pourHome,
  pourLevel,
  pourOver,
  pourPose,
  since,
  spills,
  spillWet,
  stepPour,
  type Memo,
  type PourPose,
} from "@/components/lotus/product/timings";

const memo = (): Memo & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("the pour", () => {
  it("lifts, tips over the coping, pours, and is set back on its step", () => {
    expect(pourPose(-1)).toEqual({ tilt: 0, lift: 0, flow: 0 });
    expect(pourPose(0.3).tilt).toBeGreaterThan(0);
    expect(pourPose(0.3).flow).toBe(0);
    const pouring = pourPose((POUR.flowFrom + POUR.flowTo) / 2);
    expect(pouring.flow).toBe(1);
    expect(pouring.tilt).toBeGreaterThan(0.9);
    expect(pourPose(POUR.back)).toEqual({ tilt: 0, lift: 0, flow: 0 });
  });

  it("holds the drawn level until the water reaches the pond, then lets it rise", () => {
    expect(pourLevel(0.5, -8, 3.5)).toBe(-8);
    expect(pourLevel((POUR.flowFrom + POUR.flowTo) / 2, -8, 3.5)).toBeCloseTo(-2.25, 6);
    expect(pourLevel(POUR.flowTo, -8, 3.5)).toBe(3.5);
    expect(pourLevel(-1, -8, 3.5)).toBe(3.5);
  });

  it("spills only when the bucket brought the pond to its notch, and the wet stone dries", () => {
    expect(spills(20)).toBe(true);
    expect(spills(11.5)).toBe(false);
    expect(spillWet(POUR.flowTo + 1.2).spread).toBeCloseTo(1, 6);
    expect(spillWet(POUR.flowTo + 40).wet).toBe(0);
  });
});

const pose = (t: number, refused = -1): PourPose => pourPose(t, { tilt: 0, lift: 0, flow: 0 }, refused);
const FRAME = 1 / 60;

/**
 * The pot's pose frame by frame at 60 frames a second, played as the courtyard plays it (the latch, then the pose) from
 * a top-up whose stamp goes back to 0 `gone` s after the press (-1: never): with a refusal said in the same frame, as
 * lib/client/plant does, or without one, as when the top-up's hour folds into the server's state.
 */
function frames(gone: number, refusedToo: boolean): PourPose[] {
  const press = 1_000_000;
  const l = newPourLatch();
  const out: PourPose[] = [];
  for (let k = 0; k * FRAME < POUR.back + 1; k++) {
    const t = k * FRAME;
    const withdrawn = gone >= 0 && t >= gone;
    const refusal = withdrawn && refusedToo ? { at: press, refusedAt: press + gone * 1000 } : null;
    out.push(pose(stepPour(l, withdrawn ? 0 : press, refusal, press + t * 1000), l.refused));
  }
  return out;
}

/** The largest change in the pot's tilt and lift and in the stream from one frame to the next. */
function largestStep(poses: PourPose[]) {
  const most = { tilt: 0, lift: 0, flow: 0 };
  for (let k = 1; k < poses.length; k++) {
    most.tilt = Math.max(most.tilt, Math.abs(poses[k].tilt - poses[k - 1].tilt));
    most.lift = Math.max(most.lift, Math.abs(poses[k].lift - poses[k - 1].lift));
    most.flow = Math.max(most.flow, Math.abs(poses[k].flow - poses[k - 1].flow));
  }
  return most;
}

describe("a refused top-up", () => {
  it("refused before the stream starts, the pot never pours and eases back onto its step over about 0.6 s", () => {
    for (const r of [0, 0.3, 1, 1.45]) {
      // up to the refusal the pot moves as it would have
      expect(pose(r, r)).toEqual(pose(r));
      for (let t = 0; t < 3; t += 0.01) expect(pose(t, r).flow).toBe(0);
      expect(pourHome(r)).toBeCloseTo(r + POUR_HOME, 9);
      expect(pose(r + POUR_HOME, r)).toEqual({ tilt: 0, lift: 0, flow: 0 });
      // it never tips further than it would have, and it is on its way back down by half way
      for (let t = r; t < r + POUR_HOME; t += 0.01) expect(pose(t, r).tilt).toBeLessThanOrEqual(pose(t).tilt + 1e-12);
      expect(pose(r + POUR_HOME / 2, r).tilt).toBeLessThan(pose(r + POUR_HOME / 2).tilt * 0.6);
    }
    // a refusal half way through the tip: the pot was well over, and comes back without ever pouring
    expect(pose(1.2, 1.2).tilt).toBeGreaterThan(0.6);
    expect(pose(1.5, 1.2).tilt).toBeLessThan(pose(1.2, 1.2).tilt);
  });

  it("refused mid-pour, the stream fades over 0.35 s, then the pot rights itself over the pour's own back beat", () => {
    const r = 2.2;
    const full = pose(r);
    expect(full.flow).toBe(1);
    expect(pose(r, r)).toEqual(full);
    expect(pose(r + POUR_FADE / 2, r).flow).toBeGreaterThan(0.2);
    expect(pose(r + POUR_FADE / 2, r).flow).toBeLessThan(0.8);
    expect(pose(r + POUR_FADE, r).flow).toBe(0);
    // still fully tipped while the stream fades, then the righting the full pour has from its flowTo, sooner
    expect(pose(r + POUR_FADE, r).tilt).toBeCloseTo(full.tilt, 9);
    for (let x = 0; x <= POUR.back - POUR.flowTo; x += 0.05) {
      const early = pose(r + POUR_FADE + x, r);
      const own = pose(POUR.flowTo + x);
      expect(early.tilt).toBeCloseTo(own.tilt, 9);
      expect(early.lift).toBeCloseTo(own.lift, 9);
    }
    expect(pourHome(r)).toBeCloseTo(r + POUR_FADE + (POUR.back - POUR.flowTo), 9);
    expect(pose(pourHome(r), r)).toEqual({ tilt: 0, lift: 0, flow: 0 });
  });

  it("refused once the stream has begun to stop, or after the pour, the pour finishes as it would have", () => {
    for (const r of [POUR.flowTo - POUR_FADE, POUR.flowTo - 0.1, 4, POUR.back + 1]) {
      for (let t = 0; t <= POUR.back + 0.5; t += 0.05) expect(pose(t, r)).toEqual(pose(t));
      expect(pourHome(r)).toBe(POUR.back);
    }
  });

  it("never jumps at 60 frames a second, whenever the refusal comes", () => {
    const full = frames(-1, false);
    const own = largestStep(full);
    expect(own.tilt).toBeLessThan(0.03);
    for (let r = 0; r <= POUR.back + 0.5; r += 0.01) {
      const most = largestStep(frames(r, true));
      // the pot used to stand upright in a single frame (up to 1.05 rad); now no frame moves it more than twice as far
      // as the pour's own quickest, and the lift and the stream no further than the pour's own
      expect(most.tilt).toBeLessThanOrEqual(2 * own.tilt);
      expect(most.lift).toBeLessThanOrEqual(own.lift * 1.01);
      expect(most.flow).toBeLessThanOrEqual(own.flow * 1.01);
    }
    // the stamp going back to 0 without a refusal (the hour folded in) changes nothing at all
    for (const fold of [0.3, 1.6, 2.5, 4.2]) expect(frames(fold, false)).toEqual(full);
  });

  it("lets the level rise only by what was poured, and hands it back to the pond's own without a jump", () => {
    // the pond's own level as the courtyard has it (mm over `before` = 0): the bucket's rise, eased by the plant bridge
    // (1 s) and again by the frame loop (0.6 s), withdrawn when the top-up is refused `r` s after the press (-1: never)
    const drawn = (r: number) => {
      let shown = 0;
      let eased = 0;
      const out: number[] = [];
      for (let k = 0; k * FRAME < 14; k++) {
        const t = k * FRAME;
        const refused = r >= 0 && t >= r ? r : -1;
        shown += ((refused >= 0 ? 0 : 11.5) - shown) * (1 - Math.exp(-FRAME / 1));
        eased += (shown - eased) * (1 - Math.exp(-FRAME / 0.6));
        // the courtyard hands the level back to the pond's own once the latch is over
        out.push(t >= pourOver(refused) ? eased : pourLevel(t, 0, eased, refused));
      }
      return out;
    };
    const largest = (xs: number[]) => xs.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - xs[i])), 0);
    const own = largest(drawn(-1));
    for (const r of [0.2, 1, 1.45, 2.2, 3, 3.5, 4.5]) {
      const xs = drawn(r);
      expect(largest(xs)).toBeLessThanOrEqual(own);
      // back to the level before the press, where the pond's own level is going too
      expect(Math.abs(xs[Math.round((r + POUR_SETTLE + 1) / FRAME)])).toBeLessThan(0.05);
    }
    // refused before the stream, the level never rises at all
    for (const r of [0.2, 1, 1.45]) for (const x of drawn(r)) expect(x).toBeLessThan(0.08);
  });

  it("spills only what its stream poured, and dries it as a full spill dries", () => {
    expect(spillWet(5, 1)).toEqual({ spread: 0, wet: 0 });
    const r = 2.6;
    const stopped = spillWet(r + POUR_FADE + 1.2, r).spread;
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThan(spillWet(POUR.flowTo + 1.2).spread);
    expect(spillWet(r + POUR_FADE + 5, r).spread).toBeCloseTo(stopped, 9);
    expect(spillWet(POUR.flowTo + 40, r).wet).toBe(0);
    // up to the refusal it spreads as the full one does
    expect(spillWet(r, r)).toEqual(spillWet(r));
  });
});

describe("the pour's latch", () => {
  const press = 1_000_000;
  const at = (s: number) => press + s * 1000;

  it("plays a top-up on to its end when its stamp goes back to 0 as its hour folds into the server's state", () => {
    const l = newPourLatch();
    expect(stepPour(l, press, null, at(0.5))).toBeCloseTo(0.5, 9);
    expect(stepPour(l, 0, null, at(2))).toBeCloseTo(2, 9);
    expect(l.refused).toBe(-1);
    expect(stepPour(l, 0, null, at(4))).toBeCloseTo(4, 9);
    expect(stepPour(l, 0, null, at(pourOver() + 0.1))).toBe(-1);
    // and once over, the same stamp is never played again
    expect(stepPour(l, press, null, at(pourOver() + 0.2))).toBe(-1);
  });

  it("is refused only by the store's refusal of the very press it is playing", () => {
    const l = newPourLatch();
    stepPour(l, press, null, at(0.2));
    stepPour(l, 0, { at: press - 5000, refusedAt: at(1) }, at(1));
    expect(l.refused).toBe(-1);
    stepPour(l, 0, { at: press, refusedAt: at(1.1) }, at(1.12));
    expect(l.refused).toBeCloseTo(1.1, 9);
    // the pot goes home 0.6 s on, and the latch lasts until the level has settled and any spill dried
    expect(stepPour(l, 0, { at: press, refusedAt: at(1.1) }, at(1.8))).toBeCloseTo(1.8, 9);
    expect(pourHome(l.refused)).toBeCloseTo(1.7, 9);
  });

  it("holds a newer press made while the pot is still out until it is home, then plays it from then", () => {
    const l = newPourLatch();
    const refusal = { at: press, refusedAt: at(2.2) };
    stepPour(l, press, null, at(0.1));
    stepPour(l, 0, refusal, at(2.2));
    // a retry 0.5 s after the refusal: the pot is still righting itself (home at 3.85 s)
    const retry = at(2.7);
    expect(stepPour(l, retry, refusal, at(2.7))).toBeCloseTo(2.7, 9);
    expect(l.waiting).toBe(retry);
    expect(stepPour(l, retry, refusal, at(3.8))).toBeCloseTo(3.8, 9);
    // home: the retry starts from its first beat
    expect(stepPour(l, retry, refusal, at(3.9))).toBe(0);
    expect(l.at).toBe(retry);
    expect(l.refused).toBe(-1);
    expect(stepPour(l, retry, refusal, at(4.4))).toBeCloseTo(0.5, 9);
  });

  it("never plays a press refused while it waited, nor an older stamp that comes back", () => {
    const l = newPourLatch();
    stepPour(l, press, null, at(0.1));
    const second = at(1);
    stepPour(l, second, null, at(1));
    expect(l.waiting).toBe(second);
    stepPour(l, press, { at: second, refusedAt: at(1.5) }, at(1.5));
    expect(l.waiting).toBe(0);
    expect(stepPour(l, press, { at: second, refusedAt: at(1.5) }, at(6))).toBeCloseTo(6, 9);
    expect(l.at).toBe(press);
    // an earlier top-up, still pending when a later one was refused, showing again as the stamp is not a new press
    const m = newPourLatch();
    stepPour(m, at(10), null, at(10));
    stepPour(m, press, { at: at(10), refusedAt: at(11) }, at(11));
    expect(m.at).toBe(at(10));
    expect(m.refused).toBeCloseTo(1, 9);
  });
});

describe("the pinch's pellets", () => {
  it("land, float, and are all taken within about half a minute", () => {
    expect(pelletLeft(0, -1)).toBe(0);
    expect(pelletLeft(0, 2)).toBe(1);
    for (let i = 0; i < PELLETS.count; i++) expect(pelletLeft(i, PELLETS.lastTaken + 1)).toBe(0);
  });
});

describe("the planting", () => {
  it("glides, sinks, lets the plant show from the landing, and fades the jar", () => {
    const start = glideState(0)!;
    expect(start.along).toBe(0);
    expect(start.plant).toBe(false);
    expect(start.jar).toBe(1);
    expect(glideState(GLIDE.arrive)!.along).toBe(1);
    expect(glideState(GLIDE.plantShows)!.plant).toBe(true);
    expect(glideState(GLIDE.jarGone)!.jar).toBe(0);
    expect(glideState(GLIDE.fade)).toBeNull();
  });

  it("plays once per plant on a device, only right after the press", () => {
    const m = memo();
    const press = 1_000_000;
    expect(claimGlide("asha", press, press + 500, m)).toBe(true);
    expect(claimGlide("asha", press, press + 900, m)).toBe(false);
    expect(JSON.parse(m.data[GLIDE_KEY]).asha).toBe(press);
    // a reload long after the press, with the planting still pending, does not replay it
    expect(claimGlide("ravi", press, press + 60_000, m)).toBe(false);
    // storage that fails lets it play
    const broken: Memo = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(claimGlide("asha", press, press + 100, broken)).toBe(true);
    expect(since(0, press)).toBe(-1);
  });
});
