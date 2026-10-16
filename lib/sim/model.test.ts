// Model invariants beyond the golden file: the water book closes, the state stays finite and JSON-safe, inputs are never
// mutated, untrusted event payloads are tamed, and the bloom forecast never runs off the climate table.
import { describe, expect, it } from "vitest";
import { CLIM_T } from "./climate";
import { BED, PLANT_CLOSE_H, SIM_SPECIES, createPlant, expectBloom, step, toVisual } from "./model";
import type { HourWeather, PlantState, SimEvent } from "./model";
import { IDS, PARTY, YEARS, mulberry32, randomPolicy, simulate } from "./__fixtures__/harness";

const WX: HourWeather = { T: 25, RH: 60, P: 0, SW: 500, ET0: 0.3, U: 5, Ts: 25, isDay: 1 };
const NIGHT: HourWeather = { ...WX, SW: 0, ET0: 0, isDay: 0 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

describe("the water book", () => {
  it("closes to 1e-9 mm every hour for random players (revives, replants, cover, sprinkles included)", () => {
    let worst = 0, hours = 0, revived = 0, replanted = 0;
    for (let k = 0; k < 120; k++) {
      const rnd = mulberry32(12345 + 7919 * k), id = IDS[k % 6], y = YEARS[k % 3], plantH = PARTY + Math.floor(rnd() * 400);
      const r = simulate({ spId: id, year: y, plantH, policy: randomPolicy(rnd), endH: 983 });
      const s0 = createPlant(id, plantH), b0 = s0.W + s0.L;
      for (const x of r.rec) {
        hours++;
        const s = x.s, res = (s.W + s.L) - b0 - (s.cP + s.cI + s.cMag - s.cET - s.cDP - s.cRO);
        worst = Math.max(worst, Math.abs(res));
      }
      if (r.s.fairyUsed) revived++;
      if (r.s.gen > 1) replanted++;
    }
    expect(hours).toBeGreaterThan(40000);
    expect(revived).toBeGreaterThan(5);
    expect(replanted).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it("keeps the root zone above its air-dry floor, and evaporation never runs backwards", () => {
    let low = 0, back = 0;
    for (let k = 0; k < 30; k++) {
      const rnd = mulberry32(99 + k), r = simulate({ spId: IDS[k % 6], year: YEARS[k % 3], policy: randomPolicy(rnd), endH: 983 });
      let prevET = 0;
      for (const x of r.rec) {
        if (x.s.W < 0.85 * 1000 * BED.twp * x.s.Zr - 1e-9 || x.s.L <= 0) low++;
        if (x.s.cET < prevET) back++;
        prevET = x.s.cET;
      }
    }
    expect(low).toBe(0);
    expect(back).toBe(0);
  });
});

describe("state and visual invariants", () => {
  it("stay finite and in range, health is 0 only at death, and nothing blooms when gone", () => {
    const bad: string[] = [];
    for (let k = 0; k < 60; k++) {
      const rnd = mulberry32(4242 + 31 * k), r = simulate({ spId: IDS[k % 6], year: YEARS[k % 3], policy: randomPolicy(rnd), endH: 983 });
      for (const x of r.rec) {
        for (const [key, val] of Object.entries(x.v)) {
          if (typeof val !== "number") continue;
          const hi = key === "size" ? 1.1 : key === "headYaw" ? 360 : key === "mushrooms" ? 5 : key === "snails" ? 3 : 1;
          if (!Number.isFinite(val) || val < 0 || val > hi) bad.push(`${x.h} ${key} ${val}`);
        }
        for (const key of ["W", "L", "B", "D", "Dw", "Ds", "R", "O", "Qd", "Ns", "Np", "turgor", "aba", "op", "fDev"] as const)
          if (!Number.isFinite(x.s[key]) || x.s[key] < 0) bad.push(`${x.h} state.${key} ${x.s[key]}`);
        if (x.s.alive && x.v.health <= 0) bad.push(`${x.h} health 0 while alive`);
        if (!x.s.alive && (x.v.health > 0 || x.v.flower > 0 || x.v.bloom > 0)) bad.push(`${x.h} shows life when gone`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("is JSON-safe: a state survives a JSON round trip unchanged and steps on identically", () => {
    const r = simulate({ spId: "rose", policy: randomPolicy(mulberry32(7)), endH: 300 });
    const s = r.s, back = JSON.parse(JSON.stringify(s)) as PlantState;
    expect(back).toEqual(s);
    expect(step(back, { h: s.h, wx: WX }, [{ kind: "water" }])).toEqual(step(s, { h: s.h, wx: WX }, [{ kind: "water" }]));
  });

  it("never mutates its inputs", () => {
    const s = deepFreeze(simulate({ spId: "tefiti", endH: 200 }).s);
    const ev = deepFreeze<SimEvent[]>([{ kind: "water", id: 1 }, { kind: "sprinkle", actor: "pal" }, { kind: "shade", amount: 1 }]);
    const wx = deepFreeze({ ...WX });
    expect(() => step(s, { h: s.h, wx }, ev)).not.toThrow();
    expect(() => toVisual(s)).not.toThrow();
    expect(() => expectBloom(s, null, { h: s.h, climT: CLIM_T })).not.toThrow();
  });
});

describe("untrusted events", () => {
  const a = createPlant("rose", PARTY, "me");
  const st = (ev: unknown[], s: PlantState = a, h = 34, wx: HourWeather = WX) => step(s, { h, wx }, ev as SimEvent[]);
  const can = st([{ kind: "water" }]).W - st([]).W;

  it("a can is always exactly one can, at most once per 4 hours", () => {
    expect(can).toBeGreaterThan(0);
    expect(st([{ kind: "water", amount: -5 }]).W - st([]).W).toBeCloseTo(can, 12);
    expect(st([{ kind: "water", amount: 1000 }]).W - st([]).W).toBeCloseTo(can, 12);
    expect(st(Array.from({ length: 10 }, () => ({ kind: "water" }))).W - st([]).W).toBeCloseTo(can, 12);
    const watered = st([{ kind: "water" }]);
    expect(step(watered, { h: 35, wx: WX }, [{ kind: "water" }]).lastCanH).toBe(34);
    expect(step(watered, { h: 34 + BED.canGapH, wx: WX }, [{ kind: "water" }]).lastCanH).toBe(34 + BED.canGapH);
  });

  it("a sprinkle needs a friend: no actor or the owner does not count, nor does the same friend twice a day", () => {
    expect(st([{ kind: "sprinkle" }, { kind: "sprinkle", actor: "me" }]).daySpr).toBe(0);
    expect(st([{ kind: "sprinkle", actor: "pal" }, { kind: "sprinkle", actor: "pal" }]).daySpr).toBe(1);
    const two = step(a, { h: 41, wx: NIGHT }, [{ kind: "sprinkle", actor: "p1" }, { kind: "sprinkle", actor: "p2" }]);
    expect(two.cI - a.cI).toBeCloseTo(2 * BED.sprinkle, 12);
  });

  it("shade and cover need an explicit on/off; unknown kinds and a replant of a living plant are ignored", () => {
    expect(st([{ kind: "shade" }, { kind: "cover", amount: "yes" }])).toMatchObject({ shade: false, cover: false });
    expect(st([{ kind: "nuke" }, { kind: "replant" }])).toEqual(st([]));
    expect(st([{ kind: "replant" }], { ...a, alive: false }).gen).toBe(1);        // Fairy Dust not used yet
  });

  it("orders events of one kind by numeric id and drops a repeated id", () => {
    expect(st([{ kind: "shade", amount: 1, id: 2 }, { kind: "shade", amount: 0, id: 1 }]).shade).toBe(true);
    expect(st([{ kind: "shade", amount: 1, id: 7 }, { kind: "shade", amount: 0, id: 7 }]).shade).toBe(true);
    expect(st(Array.from({ length: 30 }, () => ({ kind: "feed" }))).Sf).toBeCloseTo(BED.feedSalt * (1 - 0.1 / 24), 12);
  });

  it("replants only inside the planting window, as a fresh watered seed of the next generation", () => {
    const gone = { ...a, alive: false, fairyUsed: true };
    const re = st([{ kind: "replant" }], gone, PLANT_CLOSE_H - 1);
    expect(re).toMatchObject({ gen: 2, alive: true, plantedH: PLANT_CLOSE_H - 1, lastCanH: PLANT_CLOSE_H - 1, fairyUsed: true });
    expect(st([{ kind: "replant" }], gone, PLANT_CLOSE_H).gen).toBe(1);
  });
});

describe("the bloom forecast", () => {
  it("covers a planting on the last day, past the end of the climate table", () => {
    for (const id of IDS) {
      const s = createPlant(id, PLANT_CLOSE_H - 1, "me"), e = expectBloom(s, SIM_SPECIES[id], { h: s.h, climT: CLIM_T });
      expect(e?.days, id).toBeGreaterThan(12);
      expect(e?.days, id).toBeLessThan(20);
    }
  });

  it("is null for a plant that is gone", () => {
    expect(expectBloom({ ...createPlant("rose", PARTY), alive: false }, null, { h: PARTY, climT: CLIM_T })).toBeNull();
  });
});
