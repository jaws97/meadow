// The Meadow's opening view without a browser: the wide view's distance holds the river ring and its bridges in the
// frame of a laptop, an iPad and a phone (checked with three's own projection, from the rig's bearing, against the
// built plan's lamp posts), the settle's curve eases in and out with no overshoot and begins when the Meadow shows,
// and the visitor's hand stops it only once there is something to see.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { meadowLayout } from "@/components/meadow/layout";
import {
  fovFor,
  releaseShare,
  RELEASE_MS,
  ringFocus,
  SETTLE_DELAY_MS,
  SETTLE_MS,
  settleDistance,
  settleEase,
  settleProgress,
  settleProgressAfter,
  settleStartAt,
  stopsSettle,
  WIDE_FILL,
  WIDE_PHI,
  WIDE_RING,
  wideDistance,
  type Hand,
} from "@/components/meadow/openingView";
import { advance, BREATH_MS, begin, dwellEndAt, INITIAL, ready, type OpeningState } from "@/lib/garden/opening";

/** CameraRig.tsx: its fixed bearing. */
const THETA = 0.25 * Math.PI;
const TOWARD_CAMERA = new THREE.Vector3(Math.sin(THETA), 0, Math.cos(THETA));
const SCREENS = { laptop: [1440, 900], ipad: [820, 1180], phone: [390, 844], party: [1920, 1080], ultrawide: [2560, 1080] } as const;
const L = meadowLayout();
const band = L.river.band;

/** A camera as the rig places it for the wide view on a screen of this aspect, `scale` times the fitted distance back. */
function wideCamera(aspect: number, scale = 1): THREE.PerspectiveCamera {
  const d = wideDistance(aspect) * scale;
  const cam = new THREE.PerspectiveCamera(fovFor(aspect), aspect, 0.1, 400);
  const focus = TOWARD_CAMERA.clone().multiplyScalar(ringFocus(d, WIDE_PHI, WIDE_RING.radius));
  cam.position.copy(focus).add(new THREE.Vector3().setFromSphericalCoords(d, WIDE_PHI, THETA));
  cam.lookAt(focus);
  cam.updateMatrixWorld();
  return cam;
}

/** The river as the wide view must hold it: both copings' outer edges all round, and every bridge lamp's foot and top. */
function riverPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    for (const r of [band.c0, band.c1]) pts.push(new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a)));
  }
  for (const b of L.river.bridges) for (const p of b.lamps) for (const y of [0, WIDE_RING.height]) pts.push(new THREE.Vector3(p.x, y, p.z));
  return pts;
}

/** The furthest any of the points falls from the middle of the frame, across and up (1 is the frame's edge). */
function reach(cam: THREE.PerspectiveCamera, pts: THREE.Vector3[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    const v = p.clone().project(cam);
    x = Math.max(x, Math.abs(v.x));
    y = Math.max(y, Math.abs(v.y));
  }
  return { x, y };
}

describe("the wide view's framing", () => {
  it("opens the field of view on a tall screen and caps it on an ultrawide, as the rig always has", () => {
    expect(fovFor(1440 / 900)).toBe(30);
    expect(fovFor(16 / 9)).toBe(30);
    const across = (aspect: number) => (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovFor(aspect) / 2)) * aspect) * 180) / Math.PI;
    expect(across(390 / 844)).toBeCloseTo(24, 6);
    expect(across(820 / 1180)).toBeCloseTo(24, 6);
    expect(across(2560 / 1080)).toBeCloseTo(60, 6);
  });

  it("centres a ring: its near and far points as far below and above the middle of the view", () => {
    for (const [d, phi, r] of [
      [70, WIDE_PHI, 19.75],
      [104, 0.17 * Math.PI, 30],
      [24, 0.28 * Math.PI, 8],
    ]) {
      const a = ringFocus(d, phi, r);
      const cam = new THREE.Vector3(a + d * Math.sin(phi), d * Math.cos(phi), 0);
      const mid = new THREE.Vector3(a, 0, 0).sub(cam).normalize();
      const near = new THREE.Vector3(r, 0, 0).sub(cam).normalize();
      const far = new THREE.Vector3(-r, 0, 0).sub(cam).normalize();
      expect(mid.angleTo(near)).toBeCloseTo(mid.angleTo(far), 9);
    }
  });

  for (const [name, [w, h]] of Object.entries(SCREENS)) {
    it(`holds the whole river ring and its bridges with a little margin, and no more, on ${name} (${w}x${h})`, () => {
      const aspect = w / h;
      const pts = riverPoints();
      const fit = reach(wideCamera(aspect), pts);
      // inside the margin on both axes...
      expect(fit.x).toBeLessThanOrEqual(WIDE_FILL + 1e-3);
      expect(fit.y).toBeLessThanOrEqual(WIDE_FILL + 1e-3);
      // ...and filling it on one (it is the nearest distance that fits): a few per cent closer breaks the margin
      expect(Math.max(fit.x, fit.y)).toBeGreaterThan(WIDE_FILL - 0.03);
      const closer = reach(wideCamera(aspect, 0.95), pts);
      expect(Math.max(closer.x, closer.y)).toBeGreaterThan(WIDE_FILL);
    });
  }

  it("is filled top to bottom on a laptop, side to side on a tall iPad and a phone", () => {
    const pts = riverPoints();
    const laptop = reach(wideCamera(1440 / 900), pts);
    expect(laptop.y).toBeGreaterThan(laptop.x);
    for (const [w, h] of [SCREENS.ipad, SCREENS.phone]) {
      const tall = reach(wideCamera(w / h), pts);
      expect(tall.x).toBeGreaterThan(tall.y);
    }
  });

  it("stands well back of the start view on every screen, farther for a bigger ring, within the camera's reach", () => {
    for (const [w, h] of Object.values(SCREENS)) {
      const aspect = w / h;
      const d = wideDistance(aspect);
      // the start view stands 24 m back on a landscape screen, about 32 on a tall phone
      expect(d).toBeGreaterThan(55);
      expect(d).toBeLessThan(120);
      expect(wideDistance(aspect, WIDE_RING.radius + 4)).toBeGreaterThan(d);
    }
    // the ring reaches past the outer coping and up to the lamp tops
    expect(WIDE_RING.radius).toBeGreaterThan(band.c1);
    expect(WIDE_RING.height).toBeGreaterThan(2);
  });
});

/** An opening whose quote has been read and whose Meadow was ready: the reveal at the returned time. */
function revealed(reduced = false): { s: OpeningState; at: number } {
  const q = ready(begin(INITIAL, { waitForDoor: false, skip: false, reduced, quote: 0, words: 6 }, 0), 0);
  const breath = advance(q, dwellEndAt(q)!);
  const s = advance(breath, breath.breathAt! + BREATH_MS);
  expect(s.stage).toBe("peace");
  return { s, at: s.revealAt! };
}

/** An opening skipped for a quote moment minutes ago (the plain veil), its Meadow ready at `readyAt` if given. */
function skipped(readyAt: number | null, reduced = false): OpeningState {
  const s = begin(INITIAL, { waitForDoor: false, skip: true, reduced, quote: 0, words: 6 }, 0);
  return readyAt === null ? s : ready(s, readyAt);
}

describe("the settle's curve", () => {
  it("eases in and out between wide and at rest, never past either end", () => {
    expect(settleEase(0)).toBe(0);
    expect(settleEase(1)).toBe(1);
    expect(settleEase(-0.5)).toBe(0);
    expect(settleEase(1.7)).toBe(1);
    expect(settleEase(0.5)).toBeCloseTo(0.5, 12);
    let last = 0;
    for (let i = 1; i <= 1000; i++) {
      const k = settleEase(i / 1000);
      expect(k).toBeGreaterThanOrEqual(last);
      expect(k).toBeLessThanOrEqual(1);
      // symmetric: it lands as gently as it leaves
      expect(k).toBeCloseTo(1 - settleEase(1 - i / 1000), 12);
      last = k;
    }
    // no jolt at either end: the first and last hundredths barely move
    expect(settleEase(0.01)).toBeLessThan(0.001);
    expect(1 - settleEase(0.99)).toBeLessThan(0.001);
  });

  it("brings the distance in by the same proportion for each step of the curve, ending exactly on the start view", () => {
    expect(settleDistance(0, 70, 24)).toBe(70);
    expect(settleDistance(1, 70, 24)).toBeCloseTo(24, 12);
    expect(settleDistance(0.5, 70, 24)).toBeCloseTo(Math.sqrt(70 * 24), 9);
    const steps = [0, 0.25, 0.5, 0.75, 1].map((k) => settleDistance(k, 104, 32));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
      expect(steps[i] / steps[i - 1]).toBeCloseTo(steps[1] / steps[0], 9);
    }
  });

  it("holds the wide view through the quote and the reveal, then settles over about five and a half seconds", () => {
    const { s, at } = revealed();
    const q = begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 0, words: 6 }, 0);
    expect(settleProgress(INITIAL, 0)).toBe(0);
    expect(settleProgress(q, 5000)).toBe(0);
    expect(settleStartAt(q)).toBeNull();
    expect(settleStartAt(s)).toBe(at + SETTLE_DELAY_MS);
    // the reveal's focus pull happens on the wide view, which holds until it has cleared
    expect(settleProgress(s, at)).toBe(0);
    expect(settleProgress(s, at + SETTLE_DELAY_MS)).toBe(0);
    expect(settleProgress(s, at + SETTLE_DELAY_MS + SETTLE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(settleProgress(s, at + SETTLE_DELAY_MS + SETTLE_MS)).toBe(1);
    expect(settleProgress(s, at + 60_000)).toBe(1);
    // it waits for the reveal's focus pull (2.2 s) to clear, so the wide view is seen sharp first
    expect(SETTLE_DELAY_MS).toBeGreaterThanOrEqual(2200);
    expect(SETTLE_MS).toBeGreaterThanOrEqual(5000);
    expect(SETTLE_MS).toBeLessThanOrEqual(6000);
  });

  it("plays the same when the quote is skipped, from the plain veil starting to lift", () => {
    expect(settleStartAt(skipped(null))).toBeNull();
    expect(settleProgress(skipped(null), 9000)).toBe(0);
    const s = skipped(2400);
    expect(settleStartAt(s)).toBe(2400 + SETTLE_DELAY_MS);
    expect(settleProgress(s, 2400)).toBe(0);
    expect(settleProgress(s, 2400 + SETTLE_DELAY_MS + SETTLE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(settleProgress(s, 2400 + SETTLE_DELAY_MS + SETTLE_MS)).toBe(1);
  });

  it("never glides for reduced motion: the start view from the first frame, quote or no quote", () => {
    const { s, at } = revealed(true);
    expect(settleProgress(s, at)).toBe(1);
    expect(settleProgress({ ...INITIAL, stage: "quote", reduced: true }, 0)).toBe(1);
    expect(settleProgress(skipped(null, true), 0)).toBe(1);
    expect(settleProgress(skipped(100, true), 200)).toBe(1);
  });
});

describe("the visitor taking over", () => {
  const idle: Hand = { mode: "idle", zoomed: false, tapped: false };
  const hands: Array<[string, Hand]> = [
    ["a drag", { ...idle, mode: "drag" }],
    ["the drive keys", { ...idle, mode: "keys" }],
    ["a pinch or the wheel", { ...idle, zoomed: true }],
    ["a tap on the ground or a plant", { ...idle, tapped: true }],
    ["the autopilot setting off (a tap to go, a plant, a friend found)", { ...idle, mode: "autopilot" }],
  ];

  it("stops the settle for anything that moves the view, from the reveal on (the second's hold included)", () => {
    const { s, at } = revealed();
    for (const [, hand] of hands) expect(stopsSettle(s, hand)).toBe(true);
    expect(stopsSettle(s, idle)).toBe(false);
    // the progress a stop freezes is the one at that moment: a second in it has not moved yet, halfway it is halfway
    expect(settleProgress(s, at + 500)).toBe(0);
    const skip = skipped(1000);
    for (const [, hand] of hands) expect(stopsSettle(skip, hand)).toBe(true);
  });

  it("counts nothing under a veil, and nothing for reduced motion", () => {
    const quote = begin(INITIAL, { waitForDoor: false, skip: false, reduced: false, quote: 0, words: 6 }, 0);
    const breath = advance(ready(quote, 0), dwellEndAt(ready(quote, 0))!);
    expect(breath.stage).toBe("breath");
    for (const veiled of [INITIAL, quote, breath, skipped(null)]) {
      for (const [, hand] of hands) expect(stopsSettle(veiled, hand)).toBe(false);
    }
    const { s } = revealed(true);
    for (const [, hand] of hands) expect(stopsSettle(s, hand)).toBe(false);
  });

  it("hands the view over without a jump: what is left of the settle's framing eases out from all of it to none", () => {
    expect(releaseShare(0)).toBe(1);
    expect(releaseShare(RELEASE_MS)).toBe(0);
    expect(releaseShare(RELEASE_MS * 4)).toBe(0);
    let last = 1;
    for (let t = 0; t <= RELEASE_MS; t += RELEASE_MS / 200) {
      const share = releaseShare(t);
      expect(share).toBeLessThanOrEqual(last);
      last = share;
    }
    expect(1 - releaseShare(RELEASE_MS / 100)).toBeLessThan(0.001);
  });
});

describe("the settle's own clock", () => {
  it("runs on elapsed frame time, so a stall cannot skip ahead", () => {
    const s = { ...INITIAL, stage: "skip" as const, readyAt: 1000 };
    expect(settleProgressAfter(s, 0)).toBe(0);
    expect(settleProgressAfter(s, SETTLE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(settleProgressAfter(s, SETTLE_MS * 3)).toBe(1);
    expect(settleProgressAfter({ ...s, reduced: true }, 0)).toBe(1);
  });
});
