// The lotus's twelve rules (scratchpad lotus/v2/pond-model.md section 7, accepted by the owner, rerun on the frozen
// pond-v1.js in lotus/integration/proto/rerun.md), measured on this folder's weather fixtures exactly as the prototype
// measured them. If one of these fails, the model has drifted from what was agreed: change it only with a new
// POND_VERSION, a rerun of the studies and the owner's word.
import { describe, expect, it } from "vitest";
import { CLIM_T } from "./climate";
import { createPond, expectBloomPond, toVisualPond } from "./pond";
import {
  NH, NONE, OWNER, PARTY, SP, W, YEARS, careUntilMoved, delays, drydown, everyNrel, feedAt, goodCare, graft, pinches, range, simulate, sweep,
  weekendStats, type SynKey,
} from "./__fixtures__/pond-harness";

const days = (h: number, p: number) => (h - p) / 24;
/** a few seconds each on their own; the whole suite in parallel with the others takes longer */
const SLOW = 120_000;

describe("rule 1: good care blooms it in 13-15 days, at dawn, and the forecast knows when", () => {
  it("every planting hour from the party to day 22, and the late planters of 3-10 Dec", () => {
    const blooms: number[] = [], hods = new Set<number>(), errs: number[] = [];
    const late: number[] = [];
    for (const y of YEARS) {
      for (let p = PARTY; p < 24 * 31; p += p < 24 * 23 ? 1 : 3) {
        const r = simulate({ year: y, plantH: p, policy: goodCare(), endH: Math.min(NH, p + 24 * 22), lean: true });
        expect(r.s.alive && r.s.bloomH !== NONE, `${y} planted at h ${p}`).toBe(true);
        const d = days(r.s.bloomH, p);
        (p < 24 * 23 ? blooms : late).push(d);
        hods.add(r.s.bloomH % 24);
        const e = expectBloomPond(createPond("lotus", p, OWNER), SP, { h: p, climT: CLIM_T });
        errs.push((e!.bloomH - r.s.bloomH) / 24);
      }
    }
    expect(blooms.length).toBe(1611);
    const [lo, hi] = range(blooms);
    expect(lo).toBeGreaterThanOrEqual(13);
    expect(hi).toBeLessThanOrEqual(15.25);
    // all but a few in 13-15 (20 of 1611 by 15.25 in the rerun)
    expect(blooms.filter((d) => d > 15).length).toBeLessThanOrEqual(25);
    const [llo, lhi] = range(late);
    expect(llo).toBeGreaterThanOrEqual(13);
    expect(lhi).toBeLessThanOrEqual(15);
    // the flower is half open by 06:00: it opens from 04:00 over four hours
    expect([...hods]).toEqual([6]);
    // the forecast at planting (on the app's CLIM_T) is right within a day, for every planting
    expect(Math.max(...errs.map(Math.abs))).toBeLessThanOrEqual(1);
  }, SLOW);

  it("the party planting blooms on day 13.63 in each year", () => {
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: goodCare(), lean: true });
      expect(days(r.s.bloomH, PARTY), String(y)).toBeCloseTo(13.625, 6);
    }
  }, SLOW);
});

describe("rule 2 and 11: the first days need you", () => {
  it("a seed nobody touches rots in its jar in 5.5-6.8 days, whoever sprinkles it", () => {
    for (const pol of [() => null, () => (h: number, hod: number) => (hod === 12 ? [{ kind: "sprinkle" as const, actor: "friend0" }, { kind: "sprinkle" as const, actor: "friend1" }] : [])]) {
      const rows = sweep(pol, { len: 8 });
      expect(rows.every((r) => r.diedFirst && r.bloom === null)).toBe(true);
      const [lo, hi] = range(rows.map((r) => r.death as number));
      expect(lo).toBeGreaterThanOrEqual(5.4);
      expect(hi).toBeLessThanOrEqual(6.9);
    }
  }, SLOW);

  it("planted and walked away: none of 69 bloom", () => {
    const rows = sweep(() => careUntilMoved(), { len: 30 });
    expect(rows.filter((r) => r.bloom !== null)).toEqual([]);
  }, SLOW);

  it("the koi never fed: none of 69 bloom, all still alive at day 30 (the seedling stalls, it is never eaten)", () => {
    const rows = sweep(() => goodCare({ koi: false }), { len: 30 });
    expect(rows.filter((r) => r.bloom !== null)).toEqual([]);
    expect(rows.filter((r) => r.death !== null)).toEqual([]);
  }, SLOW);
});

describe("rule 3: once its standing leaves are up, the pond is patient", () => {
  it("left alone on dry days after a last visit on day 3 or 8, it dies 21-27 days later", () => {
    const deaths: number[] = [];
    for (const key of ["typ", "hot", "hottest"] as SynKey[]) for (const lastDay of [3, 8]) for (let hod = 0; hod < 24; hod += 2) {
      const d = drydown(key, lastDay, hod);
      if (!d) continue;
      expect(d.death, `${key} day ${lastDay} ${hod}:00`).not.toBeNull();
      deaths.push(d.death as number);
      // the pond falls below the pot's rim within days, the pot dries a week or more later, death comes last
      expect(d.rim as number).toBeLessThan(d.dry as number);
      expect(d.dry as number).toBeLessThan(d.death as number);
    }
    expect(deaths.length).toBeGreaterThan(60);
    const [lo, hi] = range(deaths);
    expect(lo).toBeGreaterThanOrEqual(21);
    expect(hi).toBeLessThanOrEqual(27);
  }, SLOW);
});

describe("rule 4: a weekend away is always safe", () => {
  it("no deaths in 60 weekends; the pond never falls below the pot's rim; at most a day later", () => {
    const w = weekendStats();
    expect(w.n).toBe(60);
    expect(w.deaths).toBe(0);
    expect(w.rimExposed).toBe(0);
    expect(w.minLvl).toBeGreaterThan(-25);
    expect(w.maxGraze).toBeLessThanOrEqual(0.4);
    expect(Math.max(...w.delays)).toBeLessThanOrEqual(1);
  }, SLOW);
});

describe("rule 5: overwatering cannot hurt it", () => {
  it("two top-ups a day through the 85 mm wet week spill hundreds of litres through the notch, harmlessly", () => {
    for (const y of YEARS) {
      const g = graft(y, 3);
      const r = simulate({ year: y, wxAt: g.wx, policy: (h, hod) => (hod === 8 || hod === 18 ? [{ kind: "water" }, { kind: "tend" }] : []), endH: PARTY + 24 * 22 });
      const a = r.rec.find((x) => x.h === W(3, 0))!.s.cO, b = r.rec.find((x) => x.h === W(10, 0))!.s.cO;
      expect(b - a, String(y)).toBeGreaterThan(200);
      expect(Math.min(...r.rec.filter((x) => x.h > PARTY + 48).map((x) => x.v.health)), String(y)).toBeGreaterThan(0.85);
      expect(days(r.s.bloomH, PARTY), String(y)).toBeCloseTo(13.625, 6);
    }
  }, SLOW);
});

describe("rule 7: planted late, it still blooms well", () => {
  it("planted on 17 Nov or 8 Dec: on time, size 0.87 or more", () => {
    for (const y of YEARS) for (const p of [PARTY + 24 * 7, PARTY + 24 * 28]) {
      const r = simulate({ year: y, plantH: p, policy: goodCare(), endH: p + 24 * 20 });
      const at = r.rec.find((x) => x.h === r.s.bloomH)!;
      expect(days(r.s.bloomH, p), `${y} h ${p}`).toBeLessThanOrEqual(15);
      expect(at.v.size, `${y} h ${p}`).toBeGreaterThanOrEqual(0.87);
    }
  }, SLOW);
});

describe("rule 8: lotus food has a right time", () => {
  it("food before the second standing leaf burns: health 0.65-0.85, a day late at most; the app says too young first", () => {
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: goodCare({ extra: feedAt((h) => [W(2, 21), W(4, 21), W(6, 21)].includes(h)) }) });
      const minH = Math.min(...r.rec.filter((x) => x.s.alive).map((x) => x.v.health));
      expect(minH, String(y)).toBeGreaterThanOrEqual(0.6);
      expect(minH, String(y)).toBeLessThanOrEqual(0.85);
      expect(days(r.s.bloomH, PARTY), String(y)).toBeLessThanOrEqual(14.63);
      // every hour a feed would still burn, the advice says "young"
      for (const x of r.rec) if (x.s.stage === 1 && x.s.alive && x.s.aMax < 0.9) expect(x.v.feedAdvice).toBe("young");
    }
  }, SLOW);

  it("good care never needs lotus food before mid-January", () => {
    for (const y of YEARS) expect(simulate({ year: y, policy: goodCare(), endH: NH }).ctx.nFeed, String(y)).toBe(0);
  }, SLOW);
});

describe("rule 9: koi food has a right amount", () => {
  const tint = (r: ReturnType<typeof simulate>, x: number) => { const q = r.rec.find((z) => z.s.Al >= x); return q ? days(q.h, PARTY) : null; };
  it("about two pinches a day keeps the water clear for 30 days", () => {
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: goodCare(), endH: PARTY + 24 * 30 });
      expect(Math.max(...r.rec.map((x) => x.s.Al)), String(y)).toBeLessThan(0.15);
    }
  }, SLOW);

  it("four a day tints it in about three weeks and turns it green by about day 28-30", () => {
    const green: (number | null)[] = [];
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: goodCare({ koi: false, extra: pinches((h, hod) => hod >= 8 && hod <= 20 && (hod - 8) % 4 === 0) }), endH: PARTY + 24 * 30 });
      const t = tint(r, 0.15);
      expect(t, String(y)).not.toBeNull();
      expect(t as number).toBeGreaterThanOrEqual(19);
      expect(t as number).toBeLessThanOrEqual(24);
      expect(Math.max(...r.rec.map((x) => x.s.Al)), String(y)).toBeGreaterThan(0.38);
      green.push(tint(r, 0.4));
    }
    const g = green.filter((x): x is number => x !== null);
    expect(g.length).toBeGreaterThanOrEqual(2);
    for (const d of g) expect(d).toBeGreaterThanOrEqual(27);
  }, SLOW);
});

describe("rule 10: a careless rhythm shows", () => {
  it("a visit every 3 days blooms 2-3 days later; every 4 days 2-4 days later", () => {
    const base = sweep(() => goodCare(), { len: 30 });
    expect(base.every((r) => r.bloom !== null)).toBe(true);
    for (const [n, lo, hi] of [[3, 2, 3], [4, 2, 4]] as const) {
      const rows = sweep(() => everyNrel(n), { len: 30 });
      expect(rows.every((r) => r.bloom !== null), `every ${n}`).toBe(true);
      const [a, b] = range(delays(rows, base));
      expect(a).toBeGreaterThanOrEqual(lo);
      expect(b).toBeLessThanOrEqual(hi);
    }
  }, SLOW);
});

describe("rule 12: the flower behaves like a real lotus", () => {
  it("three flower days, closed on the afternoons of days 1 and 2, then a pod; four flowers by 15 Jan", () => {
    for (const y of YEARS) {
      const r = simulate({ year: y, policy: goodCare(), endH: NH });
      expect(r.s.flN, String(y)).toBe(4);
      const first = r.rec.filter((x) => x.s.flN === 1);
      const dayOf = (fd: number) => first.filter((x) => x.v.flowerDay === fd);
      // day 1 runs from the bloom moment (06:00) to midnight; days 2 and 3 are whole days
      expect(dayOf(1).length, `${y} day 1`).toBe(18);
      for (const fd of [2, 3]) expect(dayOf(fd).length, `${y} day ${fd}`).toBe(24);
      for (const fd of [1, 2]) {
        const x = dayOf(fd).find((q) => q.h % 24 === 16)!;
        // open in the morning, closed again by the late afternoon (warm inside)
        expect(toVisualPond(x.s, SP, 8.5).bloom, `${y} day ${fd} at 08:30`).toBeGreaterThan(0.3);
        expect(toVisualPond(x.s, SP, 16.5).bloom, `${y} day ${fd} at 16:30`).toBeLessThan(0.15);
        expect(toVisualPond(x.s, SP, 3).warmth, `${y} day ${fd} before dawn`).toBeGreaterThan(0);
      }
      // day 3: widest, the petals falling through the evening, then the pod
      const d3 = dayOf(3).find((q) => q.h % 24 === 20)!;
      expect(toVisualPond(d3.s, SP, 20).petalDrop).toBeGreaterThan(0);
      const after = first.find((x) => x.v.flowerDay === 0 && x.h > d3.h)!;
      expect(after.v.pod).toBe(1);
      expect(after.v.warmth).toBe(0);
    }
  }, SLOW);
});
