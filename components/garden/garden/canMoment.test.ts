// The watering can's moment (canMoment.ts): it is carried to the bed and pours on the lotus pot's rhythm, moves without a
// jump on every path, never pours or snaps when refused, lands its water in the saucer from whichever side the viewer
// stands, keeps clear of the kerb, and the soil answers only once the water lands, honestly for how damp it was.
import { describe, expect, it } from "vitest";
import { POUR, pourPose } from "@/components/lotus/product/timings";
import { HERO_GROUND_Y, WATERING_CAN, bedRho, bedSurfaceY, planFieldstones, stoneTop } from "@/lib/garden/dressing";
import {
  CAN,
  CAN_BODY,
  CAN_RADIUS,
  CAN_ROSE,
  EXIT_SPEED,
  GRAVITY,
  REST_HAND,
  REST_YAW,
  canPoint,
  canPose,
  canStillAt,
  coverInTheWay,
  dripTimes,
  exitDir,
  flowOf,
  landsAt,
  momentOver,
  newPose,
  newSoil,
  soilAt,
  stationFor,
  varyOf,
  type CanPlan,
  type CanPose,
} from "@/components/garden/garden/canMoment";

/** The default camera's own bearing round the stem (layout framings: azimuth about 0.1 rad). */
const VIEW = Math.PI / 2 - 0.1;
const AT = 1_762_000_000_000;

function plan(o: Partial<CanPlan> & { growth?: number; view?: number; at?: number } = {}): CanPlan {
  const vary = varyOf(o.at ?? AT);
  const station = stationFor(o.growth ?? 0.5, o.view ?? VIEW, vary.sweep);
  return { station, vary, still: o.still ?? false, refusedAt: o.refusedAt ?? -1, stoppedAt: o.stoppedAt ?? -1 };
}

const p3 = () => ({ x: 0, y: 0, z: 0 });
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Where a drop leaving the rose at this pose lands on the plane y = floor. */
function landing(pose: CanPose, floor: number) {
  const rose = canPoint(pose, CAN_ROSE.x, CAN_ROSE.y, p3());
  const d = exitDir(pose, p3());
  const vy = EXIT_SPEED * d.y;
  const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * (rose.y - floor))) / GRAVITY;
  return { x: rose.x + EXIT_SPEED * d.x * t, z: rose.z + EXIT_SPEED * d.z * t, fall: rose.y - floor };
}

describe("the can's moment", () => {
  it("stands on its own spot before and after, its base exactly where the garden places it", () => {
    const p = plan();
    const before = canPose(p, -1, newPose());
    const base = canPoint(before, 0, 0, p3());
    expect(base.x).toBeCloseTo(WATERING_CAN.x, 9);
    expect(base.y).toBeCloseTo(0, 9);
    expect(base.z).toBeCloseTo(WATERING_CAN.z, 9);
    expect(before.yaw).toBe(REST_YAW);
    const after = canPose(p, canStillAt(p) + 0.01, newPose());
    expect([after.x, after.y, after.z, after.tilt, after.roll, after.flow]).toEqual([REST_HAND.x, REST_HAND.y, REST_HAND.z, 0, 0, 0]);
  });

  it("lifts the can, carries it over to the bed, tips, pours, rights it and sets it home in about eight seconds", () => {
    const p = plan();
    expect(canPose(p, 0.5, newPose()).lift).toBeGreaterThan(0.04);
    const carried = canPose(p, 1.2, newPose());
    expect(carried.x).toBeLessThan(REST_HAND.x - 0.1);
    expect(carried.flow).toBe(0);
    const pouring = canPose(p, (CAN.flowFrom + CAN.flowTo) / 2, newPose());
    expect(pouring.flow).toBe(1);
    expect(pouring.tilt).toBeGreaterThan(0.95);
    const going = canPose(p, 6.7, newPose());
    expect(going.flow).toBe(0);
    expect(going.tilt).toBeLessThan(0.05);
    expect(canStillAt(p)).toBeGreaterThan(8);
    expect(canStillAt(p)).toBeLessThan(8.5);
  });

  it("pours on the lotus pot's rhythm: the tip, the pour and the righting take as long as its own", () => {
    expect(CAN.tipTo - CAN.tipFrom).toBeCloseTo(POUR.tip - POUR.lift, 9);
    expect(CAN.tipTo).toBe(CAN.flowFrom);
    expect(CAN.flowTo - CAN.flowFrom).toBeCloseTo(POUR.flowTo - POUR.flowFrom, 9);
    expect(CAN.rightTo - CAN.flowTo).toBeCloseTo(POUR.back - POUR.flowTo, 9);
    const p = plan();
    const shift = CAN.flowFrom - POUR.flowFrom;
    for (let x = 0; x <= POUR.back; x += 0.05) expect(flowOf(p, x + shift)).toBeCloseTo(pourPose(x).flow, 9);
  });

  it("moves without a jump on every path: the hand and the rose never leap between frames", () => {
    const cases: CanPlan[] = [
      plan(),
      plan({ at: AT + 7 }),
      plan({ growth: 0.02 }),
      plan({ growth: 1 }),
      plan({ view: 0 }),
      plan({ view: Math.PI }),
      ...[0.1, 0.5, 0.8, 1.3, 1.9, 2.4, 3.5, 4.7, 7].map((r) => plan({ refusedAt: r })),
      plan({ stoppedAt: 1 }),
      plan({ stoppedAt: 3.3 }),
    ];
    const a = newPose();
    const b = newPose();
    for (const p of cases) {
      const end = canStillAt(p) + 0.3;
      let worstHand = 0;
      let worstRose = 0;
      let worstTilt = 0;
      for (let t = -0.1; t < end; t += 1 / 60) {
        canPose(p, t, a);
        canPose(p, t + 1 / 60, b);
        worstHand = Math.max(worstHand, dist(a, b));
        worstRose = Math.max(worstRose, dist(canPoint(a, CAN_ROSE.x, CAN_ROSE.y, p3()), canPoint(b, CAN_ROSE.x, CAN_ROSE.y, p3())));
        worstTilt = Math.max(worstTilt, Math.abs(a.tilt - b.tilt), Math.abs(a.roll - b.roll));
      }
      // a full can carried half a metre in under a second and a half peaks near 0.7 m/s: about 1.2 cm a frame
      expect(worstHand).toBeLessThan(0.02);
      expect(worstRose).toBeLessThan(0.03);
      expect(worstTilt).toBeLessThan(0.05);
    }
  });

  it("never pours when refused before the tip, and goes back home the way it came", () => {
    const p = plan({ refusedAt: 0.8 });
    for (let t = 0; t < 12; t += 0.05) expect(flowOf(p, t)).toBe(0);
    expect(dripTimes(p)).toEqual([]);
    expect(canStillAt(p)).toBeLessThan(3.5);
    expect(landsAt(p)).toBe(Infinity);
    const soil = soilAt(p, "ok", 3, newSoil());
    expect(soil.holding).toBe(false);
    expect(soil.patch).toBe(0);
  });

  it("stops the water within a moment when refused mid-pour, and the can still rights itself and goes home", () => {
    const p = plan({ refusedAt: 3.5 });
    expect(flowOf(p, 3.4)).toBe(1);
    expect(flowOf(p, 3.86)).toBe(0);
    expect(canPose(p, 5.2, newPose()).tilt).toBeLessThan(canPose(p, 3.9, newPose()).tilt);
    expect(canStillAt(p)).toBeLessThan(canStillAt(plan()));
    // the water that did land fades within three seconds of the refusal
    expect(soilAt(p, "ok", 3.4, newSoil()).patch).toBeGreaterThan(0);
    expect(soilAt(p, "ok", 6.6, newSoil()).patch).toBe(0);
    expect(soilAt(p, "ok", 6.6, newSoil()).pool).toBe(0);
  });

  it("pours nothing and lets nothing drip when stopped while it tips, before any water comes", () => {
    for (const r of [1.8, 2.0, 2.3, 2.6, 2.69]) {
      const p = plan({ refusedAt: r });
      for (let t = 0; t < 12; t += 0.05) expect(flowOf(p, t)).toBe(0);
      expect(dripTimes(p)).toEqual([]);
      expect(landsAt(p)).toBe(Infinity);
      const s = soilAt(p, "ok", 10, newSoil());
      expect([s.patch, s.ring, s.pool, s.canWet]).toEqual([0, 0, 0, 0]);
    }
    // a cover moved mid-tip: no water from the can, but the soil still answers, as it does with the can at home
    const c = plan({ stoppedAt: 2.2 });
    expect(dripTimes(c)).toEqual([]);
    expect(landsAt(c)).toBeCloseTo(2.6, 9);
  });

  it("lets water that had already landed fade, never vanish, when a refusal follows a cover's stop", () => {
    const p = plan({ stoppedAt: 1, refusedAt: 2.6 });
    const a = soilAt(p, "ok", 2.59, newSoil());
    const b = soilAt(p, "ok", 2.61, newSoil());
    expect(Math.abs(a.patch - b.patch)).toBeLessThan(0.02);
    expect(Math.abs(a.pool - b.pool)).toBeLessThan(0.02);
    expect(soilAt(p, "ok", 5.7, newSoil()).patch).toBe(0);
    // and a refused still moment takes back the can's just-used gloss
    expect(soilAt(plan({ still: true, refusedAt: 0.5 }), "ok", 4, newSoil()).canWet).toBe(0);
  });

  it("keeps the spout at its pouring point while the can tips and rights, never reaching into the plant", () => {
    for (const growth of [0.3, 1]) {
      for (const view of [VIEW, 1, 2]) {
        const p = plan({ growth, view });
        for (let t = CAN.carryTo; t < CAN.rightTo; t += 0.05) {
          const rose = canPoint(canPose(p, t, newPose()), CAN_ROSE.x, CAN_ROSE.y, p3());
          expect(Math.hypot(rose.x, rose.z)).toBeGreaterThan(0.25);
        }
      }
    }
  });

  it("sends the can home without pouring when a cover moves before the tip, but the water still reaches the soil", () => {
    const p = plan({ stoppedAt: 1 });
    for (let t = 0; t < 12; t += 0.05) expect(flowOf(p, t)).toBe(0);
    expect(landsAt(p)).toBeCloseTo(1.4, 9);
    expect(soilAt(p, "ok", 3.5, newSoil()).patch).toBeGreaterThan(0);
  });

  it("goes home lighter: an empty can swings less than a full one", () => {
    const p = plan();
    const s = newPose();
    let out = 0;
    let back = 0;
    for (let t = CAN.carryFrom; t < CAN.carryTo; t += 0.01) out = Math.max(out, Math.abs(canPose(p, t, s).roll));
    for (let t = CAN.homeFrom + 0.2; t < CAN.homeTo; t += 0.01) back = Math.max(back, Math.abs(canPose(p, t, s).roll));
    expect(out).toBeGreaterThan(0.02);
    expect(back).toBeLessThan(out);
  });

  it("lets the last drops fall after the water stops, each later than the last, two to four of them", () => {
    for (let k = 0; k < 40; k++) {
      const p = plan({ at: AT + k * 104_729 });
      const d = dripTimes(p);
      expect(d.length).toBeGreaterThanOrEqual(2);
      expect(d.length).toBeLessThanOrEqual(4);
      expect(d[0]).toBeGreaterThan(CAN.flowTo);
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
      expect(d[d.length - 1]).toBeLessThan(canStillAt(p));
    }
  });

  it("varies each press a little, the same way every time for the same press", () => {
    expect(varyOf(AT)).toEqual(varyOf(AT));
    const sweeps = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const v = varyOf(AT + k * 7919);
      expect(Math.abs(v.sweep)).toBeGreaterThanOrEqual(0.3);
      expect(Math.abs(v.sweep)).toBeLessThanOrEqual(0.38);
      expect(v.lift).toBeGreaterThanOrEqual(0.9);
      expect(v.lift).toBeLessThanOrEqual(1.1);
      sweeps.add(Math.sign(v.sweep));
    }
    expect(sweeps.size).toBe(2);
  });
});

describe("where it pours", () => {
  it("chooses the clear front-right of the bed on the viewer's side, whichever way the viewer has turned", () => {
    expect(stationFor(0.5, VIEW, 0).bearing).toBeCloseTo(VIEW - 0.77, 6);
    for (const sweep of [-0.38, -0.3, 0, 0.3, 0.38]) {
      for (let view = -Math.PI; view < Math.PI; view += 0.05) {
        // the whole sweep stays in the clear quarter, away from the right side cane
        const b = stationFor(0.5, view, sweep).bearing;
        for (const x of [b, b + sweep]) {
          expect(x).toBeGreaterThanOrEqual(0.49 - 1e-9);
          expect(x).toBeLessThanOrEqual(0.98 + 1e-9);
        }
      }
    }
  });

  it("lands the shower in the saucer for a growing plant, from every side the viewer may stand", () => {
    const pose = newPose();
    for (const growth of [0.12, 0.3, 0.6, 1]) {
      for (let view = -Math.PI; view < Math.PI; view += Math.PI / 36) {
        for (const at of [AT, AT + 3]) {
          const p = plan({ growth, view, at });
          for (const t of [CAN.flowFrom + 0.3, (CAN.flowFrom + CAN.flowTo) / 2, CAN.flowTo - 0.4]) {
            const l = landing(canPose(p, t, pose), p.station.y);
            const r = Math.hypot(l.x, l.z);
            expect(r).toBeGreaterThan(0.13);
            expect(r).toBeLessThan(0.215);
            // on the bed's plateau, where the saucer holds water
            expect(bedRho(l.x, l.z)).toBeLessThan(0.84);
          }
        }
      }
    }
  });

  it("pours onto a seed's mound, gently, close to its crown", () => {
    const p = plan({ growth: 0.02 });
    expect(p.station.seed).toBe(true);
    const pose = canPose(p, 3.6, newPose());
    expect(pose.tilt).toBeLessThan(0.98);
    const l = landing(pose, p.station.y);
    expect(Math.hypot(l.x, l.z)).toBeLessThan(0.06);
    expect(p.station.y).toBeGreaterThan(HERO_GROUND_Y);
  });

  it("raises the rose over a grown plant's skirt of low leaves", () => {
    expect(plan({ growth: 1 }).station.fall).toBeGreaterThan(plan({ growth: 0.03 }).station.fall + 0.15);
  });

  it("carries the can clear of the kerb stones on every garden", () => {
    const pose = newPose();
    const q = p3();
    const ring = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
    const under = (st: ReturnType<typeof planFieldstones>[number], x: number, z: number) => {
      const dx = x - st.x;
      const dz = z - st.z;
      const lx = dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw);
      const lz = dx * Math.sin(st.yaw) + dz * Math.cos(st.yaw);
      return Math.abs(lx) < st.length / 2 && Math.abs(lz) < st.width / 2;
    };
    const rest = canPose(plan(), -1, newPose());
    const misses: string[] = [];
    for (let g = 0; g < 40; g++) {
      // the can stands on the lawn hard by the kerb: a stone its foot already shares ground with at rest is passed
      // over only by the straight lift, so the stones that matter are the front-right ones it is carried over
      const stones = planFieldstones(`garden-${g}`).filter(
        (st) => st.x > 0 && st.z > -0.3 && !ring.some((a) => under(st, canPoint(rest, Math.cos(a) * CAN_RADIUS, 0, q, Math.sin(a) * CAN_RADIUS).x, q.z)),
      );
      for (const growth of [0.02, 0.3, 1]) {
        const p = plan({ growth, at: AT + g });
        for (let t = CAN.liftFrom; t < canStillAt(p); t += 0.03) {
          canPose(p, t, pose);
          // resting on the lawn (and its last rock) it is where it always stood; off the ground it must clear every stone
          if (pose.lift < 0.01) continue;
          for (const a of ring) {
            for (const h of [0, CAN_BODY.y]) {
              canPoint(pose, Math.cos(a) * CAN_RADIUS, h, q, Math.sin(a) * CAN_RADIUS);
              for (const st of stones) if (under(st, q.x, q.z) && q.y < stoneTop(st) + 0.02) misses.push(`garden-${g} stone at ${t.toFixed(2)} s`);
              // and never dips into the bed's mulch
              if (bedRho(q.x, q.z) < 0.98 && q.y < bedSurfaceY(q.x, q.z) + 0.02) misses.push(`garden-${g} mulch at ${t.toFixed(2)} s`);
            }
          }
        }
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });
});

describe("the soil's answer", () => {
  it("darkens the soil only once the water lands, not at the press", () => {
    const p = plan();
    const before = soilAt(p, "ok", CAN.lands - 0.5, newSoil());
    expect(before.holding).toBe(true);
    expect(before.patch).toBe(0);
    expect(before.pool).toBe(0);
    const after = soilAt(p, "ok", CAN.lands + 0.6, newSoil());
    expect(after.holding).toBe(false);
    expect(after.patch).toBeGreaterThan(0);
  });

  it("lets thirsty soil drink the saucer's water within seconds, and damp soil hold it for half a minute", () => {
    const p = plan();
    const goneBy = (soil: "thirsty" | "ok" | "damp") => {
      let peak = 0;
      for (let t = 0; t < 70; t += 0.05) {
        const pool = soilAt(p, soil, t, newSoil()).pool;
        peak = Math.max(peak, pool);
        if (peak > 0.1 && pool < 0.02) return t;
      }
      return Infinity;
    };
    expect(goneBy("thirsty")).toBeLessThan(10.5);
    expect(goneBy("ok")).toBeGreaterThan(goneBy("thirsty"));
    expect(goneBy("ok")).toBeLessThan(19);
    expect(goneBy("damp")).toBeGreaterThan(30);
    expect(goneBy("damp")).toBeLessThan(46);
    // thirsty mulch shows the darkest patch; damp soil more gloss than colour
    const thirsty = soilAt(p, "thirsty", 6, newSoil());
    const damp = soilAt(p, "damp", 6, newSoil());
    expect(thirsty.patch * thirsty.tone).toBeGreaterThan(damp.patch * damp.tone);
    expect(damp.gloss).toBeGreaterThanOrEqual(thirsty.gloss);
  });

  it("blends the wet back into the bed within the minute", () => {
    const p = plan();
    const late = soilAt(p, "ok", momentOver(p), newSoil());
    expect(late.patch).toBe(0);
    expect(late.ring).toBe(0);
    expect(late.pool).toBe(0);
    expect(late.canWet).toBe(0);
  });

  it("keeps the can home and lets the soil answer alone with reduced motion, a late page or the cover in the way", () => {
    const p = plan({ still: true });
    for (let t = 0; t < 10; t += 0.1) {
      const pose = canPose(p, t, newPose());
      expect([pose.x, pose.y, pose.z, pose.tilt, pose.flow]).toEqual([REST_HAND.x, REST_HAND.y, REST_HAND.z, 0, 0]);
    }
    const soil = soilAt(p, "ok", 2, newSoil());
    expect(soil.patch).toBeGreaterThan(0);
    expect(soil.pool).toBeGreaterThan(0);
    expect(soil.canWet).toBeGreaterThan(0);
  });

  it("lets a seed's light breathe once as the water reaches it, and a grown plant's low leaves shiver as drops land", () => {
    const seed = plan({ growth: 0.02 });
    expect(soilAt(seed, "ok", CAN.lands + 0.6, newSoil()).breath).toBeGreaterThan(0.9);
    expect(soilAt(seed, "ok", CAN.lands + 4, newSoil()).breath).toBe(0);
    const grown = plan({ growth: 1 });
    expect(soilAt(grown, "ok", 3.6, newSoil()).shiver).toBeGreaterThan(0.9);
    expect(soilAt(grown, "ok", 7, newSoil()).shiver).toBe(0);
  });
});

describe("the covers", () => {
  it("keeps the can home when the closed rain cover stands over the saucer", () => {
    const v = varyOf(AT);
    expect(coverInTheWay(stationFor(1, VIEW, v.sweep), 1.12)).toBe(true);
    expect(coverInTheWay(stationFor(0.02, VIEW, v.sweep), 0)).toBe(true);
  });

  it("lets the can pour past a seedling's small cloche when the saucer lies outside it", () => {
    const v = varyOf(AT);
    expect(coverInTheWay(stationFor(0.15, VIEW, v.sweep), 0.12)).toBe(false);
  });
});
