// Test harness for the target suites: a TypeScript copy of the prototype's sim/harness.mjs and the policies, sweeps and
// metrics of sim/run.mjs, run on the recorded weather fixtures in this folder. Keep it in step with the prototype: the
// targets are only meaningful if they are measured exactly the way the model was tuned.
//
// Weather: Open-Meteo best_match archive for Bangalore, 2023-25, cut to the game window (10 Nov 00:00 - 20 Dec 24:00
// IST; Weather data by Open-Meteo.com, CC BY 4.0). Year y's calendar hours stand in for 2026: h = 0 is 10 Nov 00:00 IST
// of year y and row h is the Open-Meteo row stamped at the end of that hour. 2025 is the prototype's demo-weather.json
// as written; 2023 and 2024 use the same scaled-integer format, and the 3-10 Nov 2023 wet week has its own file.
import fs from "node:fs";
import type { SpeciesId } from "@/lib/plant/species";
import { PLANT_OPEN_H, SIM_SPECIES, createPlant, fOf, step, toVisual } from "../model";
import type { HourWeather, PlantState, SimEvent, SimSpecies, Visual } from "../model";

// ---- weather fixtures ------------------------------------------------------------------------------------------------

/** demo-weather.json's format: scaled integers, T/Ts x10 degC, P x10 mm, ET0 x100 mm, U x10 km/h, SW W/m2, RH %. */
export interface PackedWeather {
  n: number;
  h0?: number;
  T: number[];
  RH: number[];
  P: number[];
  SW: number[];
  ET0: number[];
  U: number[];
  Ts: number[];
  day: string;
  climT?: number[];
}

export function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8")) as T;
}

// x / 10 of an integer is the same double as the decimal the archive sent, so unpacking is exact
export function unpack(p: PackedWeather): HourWeather[] {
  return Array.from({ length: p.n }, (_, i) => ({
    T: p.T[i] / 10, RH: p.RH[i], P: p.P[i] / 10, SW: p.SW[i], ET0: p.ET0[i] / 100, U: p.U[i] / 10, Ts: p.Ts[i] / 10,
    isDay: p.day[i] === "1" ? 1 : 0,
  }));
}

export const YEARS = [2023, 2024, 2025] as const;
export type Year = (typeof YEARS)[number];
const ROWS: Record<Year, HourWeather[]> = {
  2023: unpack(readFixture<PackedWeather>("weather-2023.json")),
  2024: unpack(readFixture<PackedWeather>("weather-2024.json")),
  2025: unpack(readFixture<PackedWeather>("demo-weather.json")),
};
export const rowsFor = (y: Year): HourWeather[] => ROWS[y];
/** game hours with weather in every year: 983, to 20 Dec 23:00-24:00 */
export const NH = Math.min(...YEARS.map((y) => rowsFor(y).length));
/** mean weather of the three years by game hour (no rain), as the prototype's meanRows() */
export const MEAN: HourWeather[] = Array.from({ length: NH }, (_, h) => {
  const rs = YEARS.map((y) => rowsFor(y));
  const avg = (k: "T" | "RH" | "SW" | "ET0" | "U" | "Ts") => rs.reduce((a, r) => a + r[h][k], 0) / rs.length;
  const SW = avg("SW");
  return { P: 0, T: avg("T"), RH: avg("RH"), SW, ET0: avg("ET0"), U: avg("U"), Ts: avg("Ts"), isDay: SW > 0 ? 1 : 0 };
});

export const IDS = Object.keys(SIM_SPECIES) as SpeciesId[];
export const OWNER = "me";
/** 10 Nov 17:00 IST, seeds handed out */
export const PARTY = PLANT_OPEN_H;
/** game hour of day d (10 Nov = day 0) at clock hour hh */
export const W = (d: number, hh: number) => 24 * d + hh;

// ---- runner ----------------------------------------------------------------------------------------------------------

export type WxAt = (h: number) => HourWeather | undefined;
export interface Ctx { wx: WxAt; nWater: number; nFeed: number }
export type Policy = (h: number, hod: number, s: PlantState, ctx: Ctx) => SimEvent[];
export interface Rec { h: number; s: PlantState; v: Visual; w: HourWeather; ev: SimEvent[] }
export interface Run { rec: Rec[]; s: PlantState; ctx: Ctx; sp: SimSpecies; plantH: number }

export interface SimOpts {
  spId: SpeciesId;
  year?: Year;
  plantH?: number;
  endH?: number | null;
  policy?: Policy | null;
  wxAt?: WxAt;
  init?: PlantState | null;
}

/** Runs from plantH (or init.h) to endH, one step per hour, recording the state and visual after every step. */
export function simulate({ spId, year = 2025, plantH = PARTY, endH = null, policy = null, wxAt, init = null }: SimOpts): Run {
  const rows = rowsFor(year), sp = SIM_SPECIES[spId];
  const wx: WxAt = wxAt ?? ((h) => rows[h]);
  const end = Math.min(endH ?? plantH + 24 * 26, NH);
  let s = init ? { ...init, givers: init.givers.slice() } : createPlant(spId, plantH, OWNER);
  const rec: Rec[] = [];
  const ctx: Ctx = { wx, nWater: 0, nFeed: 0 };
  for (let h = init ? init.h : plantH; h < end; h++) {
    const hod = h % 24, w = wx(h);
    if (!w) break;
    const ev = policy ? policy(h, hod, s, ctx) : [];
    const w0 = s.lastCanH, f0 = s.lastFeedH;
    s = step(s, { h, wx: w }, ev, sp);
    if (s.lastCanH !== w0 && s.lastCanH === h) ctx.nWater++;
    if (s.lastFeedH !== f0) ctx.nFeed++;
    rec.push({ h: h + 1, s, v: toVisual(s, sp), w, ev });
  }
  return { rec, s, ctx, sp, plantH };
}

export function sumP(ctx: Ctx, a: number, b: number): number {
  let t = 0;
  for (let k = Math.max(0, a); k < b; k++) { const w = ctx.wx(k); if (w) t += w.P; }
  return t;
}

// ---- policies --------------------------------------------------------------------------------------------------------

export interface GoodCareOpts { pause?: [number, number] | null; force?: number[]; extra?: Policy | null; tend?: boolean; cover?: boolean }
/**
 * Good care: visits at 08:00 and 18:00; waters when the soil is getting dry, never when it is raining or rain is due;
 * tends pests; puts the rain cover on when the plant asks for it and takes it off once the rain has passed.
 */
export function goodCare({ pause = null, force = [], extra = null, tend = true, cover = true }: GoodCareOpts = {}): Policy {
  return (h, hod, s, ctx) => {
    const ev = extra ? extra(h, hod, s, ctx) : [];
    if (force.includes(h)) { ev.push({ kind: "water" }); return ev; }
    if (pause && h >= pause[0] && h < pause[1]) return ev;
    if (!s.alive || (hod !== 8 && hod !== 18)) return ev;
    const f = fOf(s), says = toVisual(s).says;
    const rainy = sumP(ctx, h - 6, h) >= 1 || sumP(ctx, h, h + 12) >= 2 || sumP(ctx, h - hod, h) >= 2;
    if (f > (hod === 8 ? 0.2 : 0.35) && !rainy) ev.push({ kind: "water" });
    if (tend && Math.max(s.Ps, s.Pa, s.Pm) > 0.3) ev.push({ kind: "tend" });
    if (cover && !s.cover && /rain cover would help/.test(says)) ev.push({ kind: "cover", amount: 1 });
    if (cover && s.cover && sumP(ctx, h - 12, h) < 0.5 && !/^the rain/.test(says)) ev.push({ kind: "cover", amount: 0 });
    return ev;
  };
}
/** Ideal care, as the twin gets it: a can whenever depletion passes 0.2, a feed on day 5, pests tended at once. */
export const idealCare = (plantH: number): Policy => (h, hod, s) => {
  const ev: SimEvent[] = [];
  if (fOf(s) > 0.2) ev.push({ kind: "water" });
  if (h === plantH + 5 * 24 - 8) ev.push({ kind: "feed" });
  if (hod === 9 && Math.max(s.Ps, s.Pa, s.Pm) > 0.1) ev.push({ kind: "tend" });
  return ev;
};
type PlainKind = "water" | "feed" | "tend" | "talk" | "revive" | "replant";
export const at = (pred: (h: number, hod: number) => boolean, kind: PlainKind = "water"): Policy =>
  (h, hod) => (pred(h, hod) ? [{ kind }] : []);
/** a can every n days at hh:00, counted from the planting day */
export const everyN = (n: number, hh = 9, p0 = PARTY): Policy =>
  at((h, hod) => hod === hh && Math.floor((h - (p0 - (p0 % 24))) / 24) % n === 0);
export const firstCan = (set: number[], p0 = PARTY): number => { for (let h = p0; ; h++) if (set.includes(h % 24)) return h; };

/** Integer PRNG (mulberry32), for random players in tests; the model itself has no randomness. */
export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Random players, as the prototype's fuzz: cans, feeds, shade and cover, friends' sprinkles, tending, revives, replants. */
export function randomPolicy(rnd: () => number): Policy {
  const pw = rnd() * 0.25, pf = rnd() * 0.03, ps = rnd() * 0.02;
  return (h, hod, s) => {
    const ev: SimEvent[] = [];
    if (rnd() < pw) ev.push({ kind: "water" });
    if (rnd() < pf) ev.push({ kind: "feed" });
    if (rnd() < ps) ev.push({ kind: rnd() < 0.7 ? "shade" : "cover", amount: rnd() < 0.5 ? 1 : 0 });
    if (rnd() < 0.05) ev.push({ kind: "sprinkle", actor: "a" + Math.floor(rnd() * 40) });
    if (rnd() < 0.01) ev.push({ kind: "tend" });
    if (!s.alive && rnd() < 0.05) ev.push({ kind: rnd() < 0.5 ? "revive" : "replant" });
    return ev;
  };
}

// ---- metrics ---------------------------------------------------------------------------------------------------------

export const ROT_SIGN = 0.25, DROOP_SIGN = 0.15, YELLOW_DS = 0.075;
export const isDroop = (x: Rec) => x.s.alive && x.v.droop >= DROOP_SIGN && fOf(x.s) > 0.3;

export interface Bloom { days: number; ripe: number; flower: number; size: number; health: number; at: number; Q: number }
/** days from planting to the bloom moment (op >= 0.5) and the flower and plant at that hour; null if it never bloomed */
export function bloomOf(r: Run): Bloom | null {
  const s = r.s, b = r.rec.find((x) => x.s.bloomH > 0 && x.s.gen === s.gen && x.h >= x.s.bloomH);
  if (!b || !b.s.alive) return null;
  const pl = b.s.plantedH;
  return { days: (b.s.bloomH - pl) / 24, ripe: (b.s.ripeH - pl) / 24, flower: b.v.flower, size: b.v.size, health: b.v.health, at: b.s.bloomH, Q: 1 - 2 * b.s.budS };
}

/**
 * The fatal soak of a run that died of rot (null if it lived or died of drought), counted from anchorH: the first can of
 * a three-cans-a-day run, or the first heavy shower of a wet week. Days to death and to the first rot sign.
 */
export function soakTimes(r: Run, anchorH: number): { death: number; rot: number | null } | null {
  const i = r.rec.findIndex((x) => !x.s.alive);
  if (i < 1) return null;
  const pre = r.rec[i - 1].s;
  if (pre.R < pre.Dw + pre.Ds) return null;
  const fr = r.rec.find((x) => x.h > anchorH && x.s.alive && x.v.rot >= ROT_SIGN);
  return { death: (r.rec[i].h - anchorH) / 24, rot: fr ? (fr.h - anchorH) / 24 : null };
}

// ---- weather scenarios -----------------------------------------------------------------------------------------------

// The reference wet week, 3-10 Nov 2023 (84.8 mm), grafted onto game days d0..d0+6 of a year: its rain, cloud (SW),
// humidity and ET0 with that year's temperatures, wind and soil temperature. Its first heavy shower is the soak anchor.
const WK23 = unpack(readFixture<PackedWeather>("weather-2023-wet-week.json"));
const WK23_ANCHOR = (() => {
  for (let d = 0; d < 7; d++) {
    const tot = WK23.slice(24 * d, 24 * d + 24).reduce((a, r) => a + r.P, 0);
    if (tot >= 5) for (let k = 24 * d; k < 24 * d + 24; k++) if (WK23[k].P >= 1) return k;
  }
  return 0;
})();
export const WK23_MM = WK23.reduce((a, r) => a + r.P, 0);
export interface Graft { rows: HourWeather[]; wx: WxAt; anchor: number }
const GRAFT = new Map<string, Graft>();
export function graft(y: Year, d0 = 3): Graft {
  const key = `${y}@${d0}`, hit = GRAFT.get(key);
  if (hit) return hit;
  const a = W(d0, 0);
  const rows = rowsFor(y).map((r, h) => (h >= a && h < a + 168 ? { ...r, P: WK23[h - a].P, SW: WK23[h - a].SW, ET0: WK23[h - a].ET0, RH: WK23[h - a].RH } : r));
  const g = { rows, wx: (h: number) => rows[h], anchor: a + WK23_ANCHOR };
  GRAFT.set(key, g);
  return g;
}

// Dry spells: stitched whole dry days (<= 0.2 mm) from 2025 then 2024 (typical), the same from 2023 first (its 11-13 Nov
// days are the window's highest demand), and three real spells, each entered two days after planting.
function dryDays(ys: Year[]): HourWeather[][] {
  const out: HourWeather[][] = [];
  for (const y of ys) {
    const r = rowsFor(y);
    for (let d = 0; 24 * (d + 1) <= r.length; d++) { const rs = r.slice(24 * d, 24 * d + 24); if (rs.reduce((a, x) => a + x.P, 0) <= 0.2) out.push(rs); }
  }
  return out;
}
const SYN = { typ: dryDays([2025, 2024]), hot: dryDays([2023, 2025, 2024]) };
export type DryKey = "syn" | "hot" | "r2024" | "r2025" | "r2023";
export const DRY: Record<DryKey, { label: string; y: Year; plant: number; lastDay: number; syn?: keyof typeof SYN }> = {
  syn: { label: "stitched dry days, 2025 then 2024", y: 2025, plant: PARTY, lastDay: 2, syn: "typ" },
  hot: { label: "stitched dry days, 2023 first (highest demand)", y: 2025, plant: PARTY, lastDay: 2, syn: "hot" },
  r2024: { label: "real 2024 spell (last can 17 Nov; dry to 28 Nov)", y: 2024, plant: W(5, 17), lastDay: 7 },
  r2025: { label: "real 2025 spell (last can 6 Dec; dry to 19 Dec)", y: 2025, plant: W(24, 17), lastDay: 26 },
  r2023: { label: "real 2023 spell (last can 10 Dec; dry to 20 Dec)", y: 2023, plant: W(28, 17), lastDay: 30 },
};
export interface Drydown { hod: number; droop: number | null; yellow: number | null; death: number | null }
/** good care until a last can at hod on the spell's last day, then nobody: elapsed days to droop, yellowing, death */
export function drydown(id: SpeciesId, hod: number, key: DryKey): Drydown {
  const S = DRY[key], lw = W(S.lastDay, hod), rows = rowsFor(S.y), syn = S.syn ? SYN[S.syn].flat() : null, a = W(S.lastDay + 1, 0);
  const wxAt: WxAt = syn ? (h) => (h < a ? rows[h] : syn[(h - a) % syn.length]) : (h) => rows[h];
  const r = simulate({ spId: id, year: S.y, plantH: S.plant, wxAt, policy: goodCare({ force: [lw], pause: [lw + 1, 1e9] }), endH: Math.min(NH, lw + 24 * 10) });
  const t0 = lw + 1, first = (fn: (q: Rec) => boolean) => { const x = r.rec.find((q) => q.h > t0 && fn(q)); return x ? (x.h - t0) / 24 : null; };
  return { hod, droop: first(isDroop), yellow: first((q) => q.s.alive && q.s.Ds >= YELLOW_DS), death: first((q) => !q.s.alive) };
}
/** every species and every last-can hour of one spell */
export function dryAll(key: DryKey) {
  const all = IDS.flatMap((id) => Array.from({ length: 24 }, (_, hod) => drydown(id, hod, key)));
  const col = (k: "droop" | "yellow" | "death") => all.map((x) => x[k]).filter((x): x is number => x !== null);
  return { droop: col("droop"), yellow: col("yellow"), death: col("death"), alive: all.filter((x) => x.death === null).length, n: all.length };
}

/** every 63 h gap (Fri 18:00 to Mon 09:00) starting on days 1-20, planted at the party with good care otherwise */
export function weekendStats() {
  const res = { n: 0, deaths: 0, worst: 1, delaysDry: [] as { d: number; bd: number }[] };
  for (const y of YEARS) for (const id of IDS) {
    const base = bloomOf(simulate({ spId: id, year: y, policy: goodCare() }));
    for (let d = 1; d <= 20; d++) {
      const fri = W(d, 18), mon = fri + 63;
      res.n++;
      const r = simulate({ spId: id, year: y, policy: goodCare({ force: [fri, mon], pause: [fri + 1, mon] }) });
      if (r.rec.some((x) => !x.s.alive)) { res.deaths++; continue; }
      const atMon = r.rec.find((x) => x.h === mon + 1);
      if (atMon) res.worst = Math.min(res.worst, atMon.v.health);
      const b = bloomOf(r), dry = sumP(r.ctx, fri, mon) <= 1;
      if (b && base && base.ripe * 24 + PARTY > fri && dry) res.delaysDry.push({ d: b.ripe - base.ripe, bd: b.days - base.days });
    }
  }
  return res;
}

/**
 * Rain only: every 7-day window of the game window with at least 15 mm (and the grafted reference week), nobody watering
 * for those 7 days (good care before and after, no rain cover), planted at the party.
 */
export function rainWindows(minMM = 15) {
  const res = { n: 0, deaths: 0, rot: 0, spread: { n: 0, deaths: 0 }, bad: [] as string[] };
  const one = (y: Year, a: number, label: string, wxAt?: WxAt) => {
    const rws = wxAt ? Array.from({ length: 168 }, (_, k) => wxAt(a + k) as HourWeather) : rowsFor(y).slice(a, a + 168);
    let rainDays = 0;
    for (let d = 0; d < 7; d++) if (rws.slice(24 * d, 24 * d + 24).reduce((t, r) => t + r.P, 0) >= 1) rainDays++;
    const spread = rainDays >= 3;
    for (const id of IDS) {
      res.n++;
      if (spread) res.spread.n++;
      const r = simulate({ spId: id, year: y, plantH: PARTY, wxAt, policy: goodCare({ pause: [a, a + 168], cover: false }), endH: Math.min(NH, a + 168 + 72) });
      const i = r.rec.findIndex((x) => !x.s.alive);
      if (i >= 0) {
        res.deaths++;
        if (spread) res.spread.deaths++;
        const p = r.rec[i - 1].s, rot = p.R > p.Dw + p.Ds;
        if (rot) res.rot++;
        res.bad.push(`${label}, rain on ${rainDays} days, ${id}: died ${((r.rec[i].h - a) / 24).toFixed(1)} d after the pause began (${rot ? "rot" : "drought"})`);
      }
    }
  };
  for (const y of YEARS) {
    const rows = rowsFor(y);
    for (let d = 1; W(d + 7, 0) + 72 <= NH; d++) {
      const a = W(d, 0), mm = rows.slice(a, a + 168).reduce((s, r) => s + r.P, 0);
      if (mm >= minMM) one(y, a, `${y} game day ${d} (${mm.toFixed(0)} mm)`);
    }
  }
  for (const y of YEARS) { const g = graft(y, 3); one(y, W(3, 0), `${y} + 2023 wet week on days 3-9`, g.wx); }
  return res;
}

export const range = (a: number[]) => (a.length ? [Math.min(...a), Math.max(...a)] : [NaN, NaN]);
