// The lotus model's invariants (the frozen prototype's checks.mjs, ported): the water book closes (rain + care + magic +
// the mud soaked at a replant - evaporation - transpiration - overflow = the change in the pond, the pot's water and the
// pot's mud, to 1e-9 L), runs repeat exactly, stepPond() never changes its input, every field stays finite, a state
// survives a JSON round trip, and stopping, serialising and resuming gives the same plant. Plus the pond's own rules
// that the server and the UI lean on: the "not yet" marks, the koi's pinch inside a tend, the jar and the planting move.
import { describe, expect, it } from "vitest";
import type { SimEvent } from "./model";
import { JAR, POND, POND_GEO, POND_NONE, createPond, expectBloomPond, levelMM, stepPond, toVisualPond, type PondState } from "./pond";
import { CLIM_T } from "./climate";
import { OWNER, PARTY, SP, YEARS, at, goodCare, rowsFor, simulate, type Policy } from "./__fixtures__/pond-harness";

const store = (q: PondState) => q.Vp + q.Vq + q.Wm;
const book = (q: PondState) => q.cP + q.cI + q.cMag + q.cSet - q.cE - q.cT - q.cO;

const spam: Policy = (h, hod) => (hod >= 9 && hod <= 18 ? [0, 1, 2].map((k) => ({ kind: "sprinkle" as const, actor: "c" + ((hod - 9) * 3 + k) })) : []);
const POLICIES: Record<string, Policy | null> = {
  good: goodCare(),
  abandoned: null,
  daily2: at((h, hod) => hod === 8 || hod === 18),
  spam,
  feed: goodCare({ extra: (h, hod) => (hod === 9 ? [{ kind: "feed" }] : []) }),
  revive: (h, hod, s, ctx) => (!s.alive && !s.fairyUsed ? [{ kind: "revive" }] : !s.alive && s.fairyUsed ? [{ kind: "replant" }] : goodCare()(h, hod, s, ctx)),
  shade: goodCare({ extra: (h, hod, s) => (s.shade ? [] : [{ kind: "shade", amount: 1 }]) }),
};
const END = PARTY + 24 * 50;

describe("the lotus model's invariants", () => {
  it("closes the water book, keeps every field finite and survives a JSON round trip", () => {
    let worst = 0, nonFinite = 0, jsonBad = 0;
    for (const y of YEARS) for (const p of Object.values(POLICIES)) {
      const r = simulate({ year: y, policy: p, endH: END });
      const s0 = createPond("lotus", PARTY, OWNER);
      for (const x of r.rec) {
        worst = Math.max(worst, Math.abs(store(x.s) - store(s0) - book(x.s)));
        for (const v of Object.values(x.s)) if (typeof v === "number" && !Number.isFinite(v)) nonFinite++;
        for (const v of Object.values(x.v)) if (typeof v === "number" && !Number.isFinite(v)) nonFinite++;
      }
      if (JSON.stringify(JSON.parse(JSON.stringify(r.s))) !== JSON.stringify(r.s)) jsonBad++;
    }
    expect(worst).toBeLessThan(1e-9);
    expect(nonFinite).toBe(0);
    expect(jsonBad).toBe(0);
  });

  it("repeats exactly, and a stopped, serialised and resumed run lands on the same plant", () => {
    for (const y of YEARS) for (const [k, p] of Object.entries(POLICIES)) {
      const a = simulate({ year: y, policy: p, endH: END }), b = simulate({ year: y, policy: p, endH: END });
      expect(b.s, `${y} ${k}`).toEqual(a.s);
      const mid = a.rec.find((x) => x.h === PARTY + 300)!.s;
      const resumed = simulate({ year: y, policy: p, init: JSON.parse(JSON.stringify(mid)) as PondState, endH: END });
      expect(resumed.s, `${y} ${k} resumed`).toEqual(a.s);
    }
  });

  it("never changes the state it is given", () => {
    const bag: SimEvent[] = [{ kind: "water" }, { kind: "tend" }, { kind: "feed" }, { kind: "sprinkle", actor: "x" }, { kind: "shade", amount: 1 }, { kind: "revive" }, { kind: "replant" }];
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: POLICIES.revive, endH: END });
      for (const i of [5, 40, 100, 400, 900]) {
        const a = r.rec[Math.min(i, r.rec.length - 2)].s, snap = JSON.stringify(a);
        stepPond(a, { h: a.h, wx: rowsFor(y)[a.h] }, bag, SP);
        toVisualPond(a, SP, 4.5);
        expectBloomPond(a, SP, { h: a.h, climT: CLIM_T });
        expect(JSON.stringify(a)).toBe(snap);
      }
    }
  });
});

describe("the pond's own rules", () => {
  const rows = rowsFor(2025);
  const stepAt = (s: PondState, ev: SimEvent[] = []) => stepPond(s, { h: s.h, wx: rows[s.h] }, ev, SP);

  it("marks what has not happened yet with POND_NONE, so a practice planting before the party starts clean", () => {
    const s = createPond("lotus", -600, OWNER);
    for (const k of ["lastCanH", "lastFeedH", "lastKoiH", "ripeH", "bloomH", "flH", "movedH", "diedH"] as const) expect(s[k], k).toBe(POND_NONE);
    // at h -600 the first can, pinch and feed are all welcome (the soil model's -99 would refuse them for weeks)
    const early = stepPond(s, { h: -600, wx: rows[0] }, [{ kind: "water" }, { kind: "tend" }, { kind: "feed" }], SP);
    expect(early.lastCanH).toBe(-600);
    expect(early.lastKoiH).toBe(-600);
    expect(early.lastFeedH).toBe(-600);
  });

  it("a tend is the koi's pinch at most every 4 h, and always a rinse", () => {
    let s = createPond("lotus", PARTY, OWNER);
    s = { ...s, Pa: 0.5 };
    const a = stepAt(s, [{ kind: "tend" }]);
    expect(a.lastKoiH).toBe(PARTY);
    expect(a.kH).toBe(1);
    expect(a.koiDay).toBe(1);
    expect(a.Pa).toBeLessThan(0.06);
    const b = stepAt({ ...a, Pa: 0.5 }, [{ kind: "tend" }]);   // an hour later: no pinch, still a rinse
    expect(b.lastKoiH).toBe(PARTY);
    expect(b.koiDay).toBe(1);
    expect(b.Pa).toBeLessThan(0.06);
  });

  it("only the owner's water action freshens the jar, and the same action plants a ready seedling", () => {
    let s = createPond("lotus", PARTY, OWNER);
    for (let i = 0; i < 20; i++) s = stepAt(s);
    expect(s.Jm).toBeGreaterThan(JAR.J0);
    const fresh = stepAt(s, [{ kind: "water" }]);
    expect(fresh.cJ).toBe(1);
    expect(fresh.stage).toBe(0);
    // a friend's sprinkle only dilutes the jar a little
    const sprinkled = stepAt(s, [{ kind: "sprinkle", actor: "friend" }]);
    expect(sprinkled.Jm).toBeGreaterThan(fresh.Jm);
    const ready = stepAt({ ...s, D: POND.Djar }, [{ kind: "water" }]);
    expect(ready.stage).toBe(1);
    expect(ready.movedH).toBe(s.h);
    expect(toVisualPond(ready).stage).toBe("pond");
  });

  it("a bucket is 15 L, about 11.5 mm on the pond, and a full pond spills at the notch", () => {
    let s = createPond("lotus", PARTY, OWNER);
    s = { ...s, stage: 1, movedH: PARTY, D: 0.2 };
    const before = levelMM(s);
    const after = stepAt(s, [{ kind: "water" }]);
    expect(after.cI).toBeCloseTo(15, 9);
    expect(levelMM(after) - before).toBeGreaterThan(9);
    expect(levelMM(after) - before).toBeLessThan(12);
    let full = { ...s, Vp: POND_GEO.VpOver - 1 };
    full = stepAt(full, [{ kind: "water" }]);
    expect(full.over).toBeGreaterThan(10);
    expect(full.Vp).toBeLessThanOrEqual(POND_GEO.VpOver + 1e-9);
  });

  it("a cover does nothing for a pond, and an unknown kind is ignored", () => {
    const s = createPond("lotus", PARTY, OWNER);
    const a = stepAt(s, [{ kind: "cover", amount: 1 }, { kind: "nuke" } as unknown as SimEvent]);
    const b = stepAt(s);
    expect(a).toEqual(b);
  });
});
