// The product koi's moves (product/koiMoves.ts), checked without a browser: when the school gathers, circles and gasps;
// and that every path it can take, at every blend of its moods, keeps the page's rules (inside the walls by 6 cm, 30 cm
// from the pot's centre, never across the pot's front) and changes shape smoothly.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { KOI_POT } from "@/components/lotus/koi";
import { FEED_SPOT, PINCH, koiMood, koiPace, morphPaths, pathReach, pinchCrowd, ringGap } from "@/components/lotus/product/koiMoves";

const calm = { koiGather: 0, koiHunger: 0, koiGasp: false, pinchAt: 0 };

describe("the school's mood", () => {
  it("gathers for this device's pinch: up within seconds, held, then drifting back", () => {
    expect(pinchCrowd(-1)).toBe(0);
    expect(pinchCrowd(0)).toBe(0);
    expect(pinchCrowd(PINCH.arrive)).toBe(1);
    expect(pinchCrowd(PINCH.arrive + PINCH.hold / 2)).toBe(1);
    expect(pinchCrowd(PINCH.arrive + PINCH.hold + PINCH.leave)).toBe(0);
    const now = 1_000_000;
    expect(koiMood({ ...calm, pinchAt: now - 10_000 }, now).gather).toBe(1);
    expect(koiMood({ ...calm, pinchAt: now - 10 * 60_000 }, now).gather).toBe(0);
  });

  it("lingers only a little for the model's flag after any pinch, and circles the pot only when hungry and not fed", () => {
    expect(koiMood({ ...calm, koiGather: 1 }, 0).gather).toBeCloseTo(0.3, 9);
    expect(koiMood({ ...calm, koiHunger: 0.1 }, 0).circle).toBe(0);
    expect(koiMood({ ...calm, koiHunger: 0.9 }, 0).circle).toBe(1);
    expect(koiMood({ ...calm, koiHunger: 0.9, pinchAt: 5000 }, 10_000).circle).toBe(0);
    expect(koiMood({ ...calm, koiGasp: true }, 0).gasp).toBe(1);
  });

  it("swims faster for pellets and slower when gasping; rings often when busy, rarely when content", () => {
    expect(koiPace({ gather: 1, circle: 0, gasp: 0 })).toBeGreaterThan(koiPace({ gather: 0, circle: 0, gasp: 0 }));
    expect(koiPace({ gather: 0, circle: 0, gasp: 1 })).toBeLessThan(1);
    expect(ringGap({ gather: 1, circle: 0, gasp: 0 })).toBeLessThan(3);
    expect(ringGap({ gather: 0, circle: 0, gasp: 0 })).toBeGreaterThan(10);
  });
});

describe("the paths", () => {
  const weights = [0, 0.25, 0.5, 0.75, 1];

  it("keep every rule at every blend of gathering, circling and gasping", () => {
    for (const path of morphPaths())
      for (const gather of weights)
        for (const circle of weights) {
          if (gather + circle > 1) continue;
          for (const gasp of [0, 1]) {
            path.setMood({ gather, circle, gasp });
            const r = pathReach(path);
            expect(r.pot, `g${gather} c${circle} s${gasp}`).toBeGreaterThanOrEqual(KOI_POT.clear - 1e-9);
            expect(r.wallX).toBeGreaterThanOrEqual(0.06 - 1e-9);
            expect(r.wallZ).toBeGreaterThanOrEqual(0.06 - 1e-9);
            expect(r.top).toBeLessThan(-0.015);
            expect(r.bottom).toBeGreaterThan(-0.2);
          }
        }
  });

  it("change shape smoothly: a small change of mood moves no point far", () => {
    for (const path of morphPaths()) {
      const p = new THREE.Vector3();
      const q = new THREE.Vector3();
      for (let w = 0; w < 1; w += 0.05) {
        for (let u = 0; u < 1; u += 0.02) {
          path.setMood({ gather: w, circle: 0, gasp: 0 });
          path.getPoint(u, p);
          path.setMood({ gather: w + 0.05, circle: 0, gasp: 0 });
          path.getPoint(u, q);
          expect(p.distanceTo(q), `w ${w.toFixed(2)} u ${u.toFixed(2)}`).toBeLessThan(0.12);
        }
      }
    }
  });

  it("gathers at the feeding spot, in front of where the owner stands", () => {
    for (const path of morphPaths()) {
      path.setMood({ gather: 1, circle: 0, gasp: 0 });
      const p = new THREE.Vector3();
      for (let u = 0; u < 1; u += 0.05) {
        path.getPoint(u, p);
        expect(Math.hypot(p.x - FEED_SPOT.x, p.z - FEED_SPOT.z)).toBeLessThan(0.14);
      }
    }
  });
});
