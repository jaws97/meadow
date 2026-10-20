// Model invariants beyond the golden file: the water book closes, the state stays finite and JSON-safe (also on broken
// weather rows), inputs are never mutated, untrusted event payloads are tamed, petals open only in their own part of the
// day, the plant asks for water before thirst, roots that have started to rot never read calm, the rain cover is asked for
// as soon as a rain-soaked bed flushes hard enough to build a dose, the cans' share of the flush never counts more water
// than the cans supplied, and the bloom forecast never runs off the climate table.
import { describe, expect, it } from "vitest";
import { CLIM_T } from "./climate";
import { BED, Bideal, PLANT_CLOSE_H, SIM_SPECIES, WX_FALLBACK, cleanWx, createPlant, expectBloom, fOf, hodOf, openWindow, step, thetaOf, toVisual } from "./model";
import type { HourWeather, LooseWeather, PlantState, SimEvent } from "./model";
import { IDS, PARTY, W, YEARS, at, goodCare, inOwnPart, mulberry32, randomPolicy, rowsFor, simulate } from "./__fixtures__/harness";

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
      const rnd = mulberry32(12345 + 7919 * k), id = IDS[k % IDS.length], y = YEARS[k % 3], plantH = PARTY + Math.floor(rnd() * 400);
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
      const rnd = mulberry32(99 + k), r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(rnd), endH: 983 });
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
      const rnd = mulberry32(4242 + 31 * k), r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(rnd), endH: 983 });
      for (const x of r.rec) {
        for (const [key, val] of Object.entries(x.v)) {
          if (typeof val !== "number") continue;
          const hi = key === "size" ? 1.1 : key === "headYaw" ? 360 : key === "mushrooms" ? 5 : key === "snails" ? 3 : 1;
          if (!Number.isFinite(val) || val < 0 || val > hi) bad.push(`${x.h} ${key} ${val}`);
        }
        for (const key of ["W", "L", "B", "D", "Dw", "Ds", "R", "O", "Qd", "Qc", "Qr", "Ns", "Np", "turgor", "aba", "op", "fDev"] as const)
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
    const s = deepFreeze(simulate({ spId: "island", endH: 200 }).s);
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

  it("replants only inside the planting window, as a watered sprout of the next generation whose flower is capped", () => {
    const gone = { ...a, alive: false, fairyUsed: true };
    const re = st([{ kind: "replant" }], gone, PLANT_CLOSE_H - 1);
    expect(re).toMatchObject({ gen: 2, alive: true, plantedH: PLANT_CLOSE_H - 1, lastCanH: PLANT_CLOSE_H - 1, fairyUsed: true, cap: BED.replantCap });
    expect(re.D).toBeGreaterThanOrEqual(BED.sproutD);
    expect(re.D).toBeLessThan(BED.sproutD + 0.01);
    expect(re.B).toBeGreaterThanOrEqual(Bideal(SIM_SPECIES.rose, BED.sproutD));
    expect(toVisual(re).says).toBe("a second-chance sprout; my flower will be smaller");
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

describe("broken weather rows (cleanWx)", () => {
  const KEYS = ["T", "RH", "P", "SW", "ET0", "U", "Ts", "isDay"] as const;
  const BROKEN: unknown[] = [undefined, null, NaN, Infinity, -Infinity, "x"];

  it("replaces every field that is not a finite number, from the previous hour first, then calm defaults", () => {
    for (const bad of BROKEN) {
      const all = Object.fromEntries(KEYS.map((k) => [k, bad])) as LooseWeather;
      expect(cleanWx(all), String(bad)).toEqual({ ...WX_FALLBACK, Ts: WX_FALLBACK.T, isDay: 0 });
      const prev = rowsFor(2025)[40];
      expect(cleanWx(all, prev), String(bad)).toEqual({ T: prev.T, RH: prev.RH, P: 0, SW: prev.SW, ET0: prev.ET0, U: prev.U, Ts: prev.T, isDay: prev.SW > 0 ? 1 : 0 });
    }
    expect(cleanWx(null)).toEqual(cleanWx({}));
    expect(cleanWx(WX)).toEqual(WX);
    expect(cleanWx({ ...WX, RH: 140, P: -2, SW: -5, ET0: -1, U: -3 })).toMatchObject({ RH: 100, P: 0, SW: 0, ET0: 0, U: 0 });
    expect(cleanWx({ ...WX, isDay: true }).isDay).toBe(1);
  });

  it("keeps the state finite and the water book closed when 3% of hours carry broken fields", () => {
    let bad = 0, worst = 0, broken = 0;
    for (let k = 0; k < 40; k++) {
      const rnd = mulberry32(555 + 31 * k), id = IDS[k % IDS.length], y = YEARS[k % 3], rows = rowsFor(y);
      const wxAt = (h: number) => {
        const w: Record<string, unknown> = { ...rows[h] };
        if (rnd() < 0.03) { broken++; for (let j = 0, m = 1 + Math.floor(rnd() * 3); j < m; j++) w[KEYS[Math.floor(rnd() * KEYS.length)]] = BROKEN[Math.floor(rnd() * BROKEN.length)]; }
        return w as unknown as HourWeather;
      };
      const r = simulate({ spId: id, year: y, policy: randomPolicy(mulberry32(99 + k)), wxAt, endH: 983 });
      const s0 = createPlant(id, PARTY), b0 = s0.W + s0.L;
      for (const x of r.rec) {
        for (const key of ["W", "L", "B", "D", "Dw", "Ds", "R", "O", "Qd", "Qc", "Qr", "Ns", "Np", "turgor", "aba", "op", "fDev", "Sc", "Tleaf"] as const)
          if (!Number.isFinite(x.s[key])) bad++;
        for (const val of Object.values(x.v)) if (typeof val === "number" && !Number.isFinite(val)) bad++;
        const s = x.s;
        worst = Math.max(worst, Math.abs((s.W + s.L) - b0 - (s.cP + s.cI + s.cMag - s.cET - s.cDP - s.cRO)));
      }
    }
    expect(broken).toBeGreaterThan(500);
    expect(bad).toBe(0);
    expect(worst).toBeLessThanOrEqual(1e-9);
  });
});

describe("opening in the flower's own part of the day", () => {
  it("morning flowers open from first light to 17:00, Night Jasmine from dusk to 06:00", () => {
    const hours = (id: keyof typeof SIM_SPECIES) => Array.from({ length: 24 }, (_, h) => h).filter((h) => openWindow(SIM_SPECIES[id], h));
    const morning = ["rose", "sundrop", "magnolia", "marigold", "island", "lily"] as const;
    for (const id of morning) expect(hours(id), id).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(hours("jasmine")).toEqual([0, 1, 2, 3, 4, 5, 17, 18, 19, 20, 21, 22, 23]);
    expect([...morning, "jasmine"].sort(), "every species is checked").toEqual(Object.keys(SIM_SPECIES).sort());
  });

  it("a wilted bud still opening when its window closes pauses, says so, and finishes in the next window", () => {
    const sp = SIM_SPECIES.rose, h = 24 * 5 + 17;
    const ripe: PlantState = { ...createPlant("rose", PARTY, "me"), D: 1, ripeH: 100, op: 0.3, turgor: 0.5, h, hod: 17 };
    const next = step(ripe, { h, wx: WX }, []);
    expect(next.op).toBe(ripe.op);                                   // no opening outside the window
    expect(toVisual(next, sp, 18).says).toBe("my petals will finish opening with the morning light");
    expect(toVisual(next, sp, 8).says).toBe("my petals are opening");
    const morning = step({ ...next, h: h + 15, hod: 8 }, { h: h + 15, wx: WX }, []);
    expect(morning.op).toBeGreaterThan(next.op);
  });

  it("the bloom forecast also lands in the flower's own part of the day", () => {
    for (const id of IDS) for (const p of [PARTY, PARTY + 7, PARTY + 24 * 9 + 4, PLANT_CLOSE_H - 1]) {
      const e = expectBloom(createPlant(id, p, "me"), SIM_SPECIES[id], { h: p, climT: CLIM_T });
      expect(e !== null && inOwnPart(id, hodOf(e.bloomH)), `${id} planted h ${p}`).toBe(true);
    }
  });
});

describe("advice and mood", () => {
  it("the can asks for a drink well before thirst, and never while it warns that the soil is damp", () => {
    let ready = 0, readyAm = 0;
    for (let k = 0; k < 24; k++) {
      const r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(mulberry32(31 + k)), endH: 983 });
      for (const x of r.rec) {
        if (x.v.canAdvice !== "ready") continue;
        ready++;
        const f = fOf(x.s), am = x.s.hod >= BED.readyAmFrom && x.s.hod < BED.readyAmTo;
        if (am) readyAm++;
        expect(f).toBeGreaterThan(am ? BED.readyAmF : BED.readyF);
        expect(f).toBeGreaterThanOrEqual(BED.dampF);
      }
    }
    expect(ready).toBeGreaterThan(100);
    expect(readyAm).toBeGreaterThan(10);
  });

  // the lines that read calm or reassuring (the prototype's CALM_SAYS)
  const CALM = /^(happy|in bloom|my petals|my bud will open|growing slowly|a second-chance sprout|the rain soaked the soil; it will drain soon|the rain has stopped; my roots are slowly drying out|the rain cover is on; my roots will slowly dry out|recovering; new leaves|roots recovering)/;

  it("thirst and a soaked bed outrank the blooming mood, and roots past the infection lag read unwell and never calm", () => {
    let blooming = 0, rotting = 0, early = 0;
    for (let k = 0; k < 60; k++) {
      const r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(mulberry32(7000 + k)), endH: 983 });
      for (const x of r.rec) {
        if (!x.s.alive) continue;
        const f = fOf(x.s), thirsty = f > 0.4 || (x.s.turgor < 0.85 && f > 0.3), th = thetaOf(x.s);
        const soaked = th >= BED.tfc && (x.s.O > 0.5 * BED.Olag || x.s.Qd >= BED.Qt || th > BED.tanox);
        if (x.v.mood === "blooming") { blooming++; expect(thirsty).toBe(false); expect(soaked).toBe(false); }
        if (x.s.O > BED.Olag) {
          rotting++;
          if (x.s.R <= 0.05) early++;                                   // rotting before any damage shows
          expect(x.v.mood).toBe("unwell");
          expect(CALM.test(x.v.says), x.v.says).toBe(false);
        }
      }
    }
    expect(blooming).toBeGreaterThan(0);
    expect(rotting).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(0);
  });

  it("asks for the rain cover as soon as a rain-soaked bed flushes hard enough to build a dose, before the dose is up", () => {
    const base = simulate({ spId: "rose", policy: goodCare(), endH: PARTY + 24 * 5 }).s;
    const wet: PlantState = { ...base, W: 1000 * BED.thFresh * base.Zr * 1.02, wR: 6, wC: 1, O: 2, dryH: 0, cover: false };
    expect(toVisual({ ...wet, Qd: BED.Qt + 0.5 })).toMatchObject({ says: "the rain keeps my roots wet; a rain cover would help", mood: "soggy" });
    expect(toVisual({ ...wet, Qd: BED.Qt - 0.5 }).says).toBe("the rain soaked the soil; it will drain soon");
    expect(toVisual({ ...wet, Qd: BED.Qt + 0.5, cover: true }).says).toBe("the rain cover is on; my roots will slowly dry out");
    expect(toVisual({ ...wet, Qd: BED.Qt + 0.5, dryH: BED.coverH }).says).toBe("the rain has stopped, but my roots are still soaked");
    // a 2 mm/h drizzle with a daily can at 09:00: the first cover prompt comes while the dose is still low
    const a = W(4, 0), b = rowsFor(2025);
    const wxAt = (h: number) => (h >= a && h < a + 72 ? { ...b[h], P: 2, SW: b[h].SW * 0.3, ET0: b[h].ET0 * 0.3, RH: 97 } : b[h]);
    for (const id of IDS) {
      const r = simulate({ spId: id, wxAt, policy: at((h, hod) => h >= a && hod === 9) });
      const first = r.rec.find((x) => /rain cover would help/.test(x.v.says));
      expect(first, id).toBeDefined();
      expect(first?.s.O, id).toBeLessThanOrEqual(0.5 * BED.Olag);
    }
  });
});

describe("the flush that feeds the rot", () => {
  // Qc and Qr are 24 h memories of the care and rain shares of the drainage (mm/day): Q' = Q + (q - Q) kq, so the hour's
  // drainage can be read back exactly from two states in a row
  const kq = 1 - Math.exp(-1 / BED.tauQ);
  const drained = (q0: number, q1: number) => (q0 + (q1 - q0) / kq) / 24;   // mm in that hour

  it("never counts more care water than the cans supplied, even when a long rain follows an evening can", () => {
    const a = W(8, 0), b = rowsFor(2024), can = a - 6;
    const wxAt = (h: number) => (h >= a && h < a + 96 ? { ...b[h], P: 3, SW: b[h].SW * 0.3, ET0: b[h].ET0 * 0.3, RH: 97 } : b[h]);
    for (const id of IDS) {
      const r = simulate({ spId: id, year: 2024, wxAt, policy: goodCare({ force: [can], pause: [can + 1, a + 168], cover: false }), endH: a + 168 });
      const i0 = r.rec.findIndex((x) => x.h === can + 1), before = r.rec[i0 - 1].s;
      let care = 0, rain = 0;
      for (let i = i0; i < r.rec.length; i++) {
        const p = r.rec[i - 1].s, q = r.rec[i].s;
        care += drained(p.Qc, q.Qc);
        rain += drained(p.Qr, q.Qr);
      }
      expect(care, id).toBeLessThanOrEqual(BED.can + before.wCx + 1e-6);   // the evening can, and what was still free to drain
      expect(rain, id).toBeGreaterThan(100);                                // the rain flushed on as rain
      expect(Math.max(...r.rec.map((x) => x.s.O)), id).toBeLessThan(BED.Olag);
      expect(r.s.alive, id).toBe(true);
    }
  });

  it("keeps the care water free to drain at or above zero and near the bed's water above field capacity", () => {
    for (let k = 0; k < 30; k++) {
      const r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(mulberry32(300 + k)), endH: 983 });
      for (const x of r.rec) {
        expect(x.s.wCx).toBeGreaterThanOrEqual(0);
        // clipped to the water above field capacity before the hour's root growth, which can move the line a little
        expect(x.s.wCx).toBeLessThanOrEqual(Math.max(0, x.s.W - 1000 * BED.tfc * x.s.Zr) + 1.5);
      }
    }
  });
});
