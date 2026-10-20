// Test harness for the target suites: a TypeScript copy of the prototype's sim/harness.mjs and the policies, sweeps and
// metrics of sim/run.mjs (SIM_VERSION 7), run on the recorded weather fixtures in this folder. Keep it in step with the
// prototype: the targets are only meaningful if they are measured exactly the way the model was tuned.
//
// Weather: Open-Meteo best_match archive for Bangalore, 2023-25, cut to the game window (10 Nov 00:00 - 20 Dec 24:00
// IST; Weather data by Open-Meteo.com, CC BY 4.0). Year y's calendar hours stand in for 2026: h = 0 is 10 Nov 00:00 IST
// of year y and row h is the Open-Meteo row stamped at the end of that hour. 2025 is the prototype's demo-weather.json
// as written; 2023 and 2024 use the same scaled-integer format, and the 3-10 Nov 2023 wet week has its own file.
import fs from "node:fs";
import type { SoilSpeciesId as SpeciesId } from "@/lib/plant/species";
import { BED, PLANT_OPEN_H, SIM_SPECIES, createPlant, fOf, opensInMorning, rainSoon, step, toVisual } from "../model";
import type { ForecastRow, HourWeather, PlantState, SimEvent, SimSpecies, Visual } from "../model";

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

/**
 * Every soil species, in SIM_SPECIES order: the prototype's six, then the Pink Lily (added after the prototype was locked).
 * Every sweep below runs over all of them and the target suites count their runs by IDS.length, so a species added to
 * SIM_SPECIES is measured by every target without touching the tests.
 */
export const IDS = Object.keys(SIM_SPECIES) as SpeciesId[];
export const OWNER = "me";
/** 10 Nov 15:00 IST: the party starts and the seeds are handed out */
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
    const hod = ((h % 24) + 24) % 24, w = wx(h);   // a planting before 10 Nov has negative hours
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
  for (let k = a; k < b; k++) { const w = ctx.wx(k); if (w) t += w.P; }   // hours with no row (before the fixture) add nothing
  return t;
}

// ---- policies --------------------------------------------------------------------------------------------------------

export interface GoodCareOpts {
  pause?: [number, number] | null;
  force?: number[];
  extra?: Policy | null;
  tend?: boolean;
  cover?: boolean;
  forecast?: boolean;
  hint?: boolean;
}
/** the forecast rows of the next n hours from h, as the app would hand them to rainSoon() (a perfect forecast here) */
export const ahead = (ctx: Pick<Ctx, "wx">, h: number, n: number = BED.soonH): ForecastRow[] =>
  Array.from({ length: n }, (_, k) => ({ h: h + k, wx: ctx.wx(h + k) }));
/**
 * Good care: visits at 08:00 and 18:00 and acts only on what the app shows. It waters when the can asks for it
 * (canAdvice "ready" or "thirsty") unless the player can see it is raining or has just rained (1 mm in the last 6 h, or
 * 2 mm since midnight); tends pests when they show (visual pest level above 0.3); puts the rain cover on when the plant asks
 * for it and takes it off once 12 h have passed without rain and the plant no longer names the rain. It never reads the
 * hidden soil depletion. forecast: true adds an older, cruder hint (no can when 2 mm or more is due in the next 12 h; the
 * cover on when 10 mm or more is due), kept for comparison. hint: true follows the app's "heavy rain tonight; skip the
 * can" hint as rainSoon() gives it: when heavy rain is due the player skips the can and puts the cover on (if cover is
 * allowed), and leaves it on while it is due.
 */
export function goodCare({ pause = null, force = [], extra = null, tend = true, cover = true, forecast = false, hint = false }: GoodCareOpts = {}): Policy {
  return (h, hod, s, ctx) => {
    const ev = extra ? extra(h, hod, s, ctx) : [];
    if (force.includes(h)) { ev.push({ kind: "water" }); return ev; }
    if (pause && h >= pause[0] && h < pause[1]) return ev;
    if (!s.alive || (hod !== 8 && hod !== 18)) return ev;
    const v = toVisual(s), asks = v.canAdvice === "ready" || v.canAdvice === "thirsty";
    const rained = sumP(ctx, h - 6, h) >= 1 || sumP(ctx, h - hod, h) >= 2, due = forecast && sumP(ctx, h, h + 12) >= 2;
    const heavy = hint && rainSoon(ahead(ctx, h), h).heavy;
    if (asks && !rained && !due && !heavy) ev.push({ kind: "water" });
    if (tend && v.pests > 0.3) ev.push({ kind: "tend" });
    if (cover && !s.cover && (/rain cover would help/.test(v.says) || (forecast && sumP(ctx, h, h + 12) >= 10) || heavy)) ev.push({ kind: "cover", amount: 1 });
    if (cover && s.cover && !heavy && sumP(ctx, h - 12, h) < 0.5 && !/^the rain/.test(v.says)) ev.push({ kind: "cover", amount: 0 });
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
/** 30 friends a day (3 an hour, 09:00-18:00); only the first two a day count, as 0.12 L each */
export const spam: Policy = (h, hod) =>
  (hod >= 9 && hod <= 18 ? [0, 1, 2].map((k) => ({ kind: "sprinkle" as const, actor: "c" + ((hod - 9) * 3 + k) })) : []);
/**
 * The second chance: abandoned until gone, Fairy Dust (and a can) 12 h later, abandoned again until gone, replanted as a
 * sprout 6 h after, then good care. A fresh closure per run.
 */
export function secondChance(after: () => Policy = () => goodCare()): Policy {
  let died1: number | null = null, died2: number | null = null;
  const care = after();
  return (h, hod, s, ctx) => {
    if (!s.alive && died1 === null) died1 = h;
    if (!s.alive && s.fairyUsed && died2 === null) died2 = h;
    if (died1 !== null && h === died1 + 12) return [{ kind: "revive" }, { kind: "water" }];
    if (died2 !== null && h === died2 + 6) return [{ kind: "replant" }];
    return died2 !== null && h > died2 + 6 ? care(h, hod, s, ctx) : [];
  };
}
/** the can asks for water: "ready for a drink" or thirsty */
export const asksCan = (v: Visual) => v.canAdvice === "ready" || v.canAdvice === "thirsty";
/** the plant's line asks for water */
export const asksLine = (v: Visual) => /drink|thirsty|water today|drooping/.test(v.says);
/**
 * A player who waters only when the plant asks (want), at the given visit hours: pests tended when they show, the cover as
 * the plant asks.
 */
export const cueLed = (hrs: number[], want: (v: Visual) => boolean): Policy => (h, hod, s, ctx) => {
  const ev: SimEvent[] = [];
  if (!s.alive || !hrs.includes(hod)) return ev;
  const v = toVisual(s);
  if (want(v)) ev.push({ kind: "water" });
  if (v.pests > 0.3) ev.push({ kind: "tend" });
  if (!s.cover && /rain cover would help/.test(v.says)) ev.push({ kind: "cover", amount: 1 });
  if (s.cover && sumP(ctx, h - 12, h) < 0.5 && !/^the rain/.test(v.says)) ev.push({ kind: "cover", amount: 0 });
  return ev;
};

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
  const s = r.s, b = r.rec.find((x) => x.s.bloomH >= x.s.plantedH && x.s.gen === s.gen && x.h >= x.s.bloomH);
  if (!b || !b.s.alive) return null;
  const pl = b.s.plantedH;
  return { days: (b.s.bloomH - pl) / 24, ripe: (b.s.ripeH - pl) / 24, flower: b.v.flower, size: b.v.size, health: b.v.health, at: b.s.bloomH, Q: 1 - 2 * b.s.budS };
}
/** the bloom moment (the end of the hour op reached 0.5) of an unstressed bud: 08:00, magnolia 09:00, Night Jasmine 18:00 */
export const HOD_OK = (id: SpeciesId) => (SIM_SPECIES[id].openHod + Math.ceil(SIM_SPECIES[id].openDur / 2)) % 24;
/** a bloom moment lies in the flower's own part of the day: a morning flower 07:00-17:00, Night Jasmine 18:00-06:00 */
export const inOwnPart = (id: SpeciesId, hod: number) =>
  (opensInMorning(SIM_SPECIES[id]) ? hod >= 7 && hod <= 17 : hod >= 18 || hod <= 6);

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
/** did the run die, and of rot (R above the drought injury in its last living hour)? */
export function deathOf(r: Run): { dead: boolean; rot: boolean } {
  const i = r.rec.findIndex((x) => !x.s.alive);
  if (i < 0) return { dead: false, rot: false };
  const p = i > 0 ? r.rec[i - 1].s : r.rec[i].s;
  return { dead: true, rot: p.R > p.Dw + p.Ds };
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
  r2024: { label: "real 2024 spell (last can 17 Nov; dry to 28 Nov)", y: 2024, plant: W(5, 15), lastDay: 7 },
  r2025: { label: "real 2025 spell (last can 6 Dec; dry to 19 Dec)", y: 2025, plant: W(24, 15), lastDay: 26 },
  r2023: { label: "real 2023 spell (last can 10 Dec; dry to 20 Dec)", y: 2023, plant: W(28, 15), lastDay: 30 },
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

/**
 * Older plants abandoned: planted at the party (2025), good care, a last can at every hour of day lastDay (2, 5, 8 or 11),
 * then nobody, on stitched typical or hottest dry days. Elapsed days to droop, yellowing and death, and the calendar day
 * (the day of the last can is day 0) for daytime cans (07-20 h), as the game verifier counts it.
 */
export function abandonAge(key: "typ" | "hot", lastDay: number) {
  const out = { dr: [] as number[], ye: [] as number[], de: [] as number[], cdr: [] as number[], cye: [] as number[], cde: [] as number[], alive: 0, n: 0 };
  const rows = rowsFor(2025), a = W(lastDay + 1, 0), syn = SYN[key].flat();
  const wxAt: WxAt = (h) => (h < a ? rows[h] : syn[(h - a) % syn.length]);
  for (const id of IDS) for (let hod = 0; hod < 24; hod++) {
    const lw = W(lastDay, hod);
    const r = simulate({ spId: id, year: 2025, plantH: PARTY, wxAt, policy: goodCare({ force: [lw], pause: [lw + 1, 1e9] }), endH: Math.min(NH, lw + 24 * 12) });
    const t0 = lw + 1, firstH = (fn: (q: Rec) => boolean) => { const x = r.rec.find((q) => q.h > t0 && fn(q)); return x ? x.h : null; };
    const hs = [firstH(isDroop), firstH((q) => q.s.alive && q.s.Ds >= YELLOW_DS), firstH((q) => !q.s.alive)];
    out.n++;
    [out.dr, out.ye, out.de].forEach((c, j) => { const Hh = hs[j]; if (Hh !== null) c.push((Hh - t0) / 24); });
    if (hs[2] === null) out.alive++;
    if (hod >= 7 && hod <= 20) [out.cdr, out.cye, out.cde].forEach((c, j) => { const Hh = hs[j]; if (Hh !== null) c.push(Math.floor((Hh - 1) / 24) - lastDay); });
  }
  return out;
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
 * Good care at every planting hour of days 0-22 (from the party at 15:00 on day 0), 2023-25, every species (1656 runs a
 * species: 9936 for the prototype's six): the bloom day, the bud day, the bloom's clock hour and the error of
 * expectBloom() made at planting (days). Each run is stepped to 17 days after planting.
 */
export interface HourRun { id: SpeciesId; y: Year; p: number; days: number | null; ripe: number | null; hod: number | null; flower: number | null; err: number | null }
export function hourSweep(forecast: (s: PlantState, sp: SimSpecies, h: number) => number, plantHours?: (p: number) => boolean): HourRun[] {
  const runs: HourRun[] = [];
  for (const y of YEARS) for (let p = PARTY; p < PARTY + 24 * 23; p++) {
    if (plantHours && !plantHours(p)) continue;
    for (const id of IDS) {
      const r = simulate({ spId: id, year: y, plantH: p, policy: goodCare(), endH: p + 24 * 17 }), b = bloomOf(r);
      const eH = forecast(createPlant(id, p, OWNER), SIM_SPECIES[id], p);
      runs.push({ id, y, p, days: b ? b.days : null, ripe: b ? b.ripe : null, hod: b ? b.at % 24 : null, flower: b ? b.flower : null, err: b ? (eH - b.at) / 24 : null });
    }
  }
  return runs;
}

/**
 * Stressed players, for the bloom moment's part of the day: 600 random under-waterers (random cans, revive or replant when
 * gone), 300 casual players (1-3 visits a day at random hours, a can at 80% of visits) and a can every day at 21:00 through
 * the 2023 wet week grafted on day 1, 5 or 10 (9 runs a species). The random and casual players take the species in turn
 * (k % IDS.length) and the year as k % 3. Returns every bloom moment as species and clock hour, and n, the runs made.
 */
export function openingStressed() {
  const moments: { id: SpeciesId; hod: number; what: string }[] = [];
  const tally = (r: Run, id: SpeciesId, what: string) => { for (const x of r.rec) if (x.s.bloomH === x.h) moments.push({ id, hod: x.h % 24, what }); };
  for (let k = 0; k < 600; k++) {
    const R = mulberry32(777 + 31 * k), id = IDS[k % IDS.length], y = YEARS[k % 3], p = PARTY + Math.floor(R() * 400), pw = 0.01 + R() * 0.12;
    tally(simulate({ spId: id, year: y, plantH: p, endH: NH, policy: (h, hh, s) => { const ev: SimEvent[] = []; if (R() < pw) ev.push({ kind: "water" }); if (!s.alive && R() < 0.1) ev.push({ kind: s.fairyUsed ? "replant" : "revive" }); return ev; } }), id, `random ${k}`);
  }
  for (let k = 0; k < 300; k++) {
    const R = mulberry32(9100 + 17 * k), id = IDS[k % IDS.length], y = YEARS[k % 3], p = PARTY + 24 * Math.floor(R() * 8);
    const hrs = new Set(Array.from({ length: 1 + Math.floor(R() * 3) }, () => 7 + Math.floor(R() * 15)));
    tally(simulate({ spId: id, year: y, plantH: p, endH: Math.min(NH, p + 24 * 24), policy: (h, hh, s) => (s.alive && hrs.has(hh) && R() < 0.8 ? [{ kind: "water" }] : []) }), id, `casual ${k}`);
  }
  for (const gd of [1, 5, 10]) for (const y of YEARS) for (const id of IDS) {
    const g = graft(y, gd);
    tally(simulate({ spId: id, year: y, wxAt: g.wx, policy: at((h, hh) => hh === 21), endH: Math.min(NH, PARTY + 24 * 26) }), id, `21:00 can, wet week d${gd} ${y}`);
  }
  return { moments, n: 600 + 300 + 9 * IDS.length };
}

/**
 * The second chance, every species and year: abandoned until gone, Fairy Dust 12 h later, abandoned again until gone,
 * replanted 6 h after (a sprout), then good care to bloom. Compared with a seed planted the same hour under good care.
 */
export function replantSweep() {
  const rows: { y: Year; id: SpeciesId; replantH: number | null; D0: number | null; days: number | null; flower: number | null; maxFlower: number | null; firstDays: number | null; first: number | null; says: string[] }[] = [];
  for (const y of YEARS) for (const id of IDS) {
    const r = simulate({ spId: id, year: y, plantH: PARTY, policy: secondChance(), endH: NH });
    const ri = r.rec.findIndex((x) => x.s.gen === 2), b = bloomOf(r);
    const g1 = ri >= 0 ? bloomOf(simulate({ spId: id, year: y, plantH: r.rec[ri].s.plantedH, policy: goodCare() })) : null;
    const after = ri >= 0 ? r.rec.slice(ri) : [];
    rows.push({ y, id, replantH: ri >= 0 ? r.rec[ri].s.plantedH : null, D0: ri >= 0 ? r.rec[ri].s.D : null, days: b ? b.days : null, flower: b ? b.flower : null,
      maxFlower: after.length ? Math.max(...after.map((x) => x.v.flower)) : null, first: g1 ? g1.flower : null, firstDays: g1 ? g1.days : null,
      says: [...new Set(after.map((x) => x.v.says as string))] });
  }
  return rows;
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

/**
 * Rain-only weeks by their total: every 7-day window starting every 12 h with rain (>= 1 mm) on 3 or more days, planted on
 * day 0, 5 or 10 (before the window), nobody watering for the week, no cover, good care before and after. Deaths and runs
 * by the week's rain: 15 mm or more, 10-15 mm, under 10 mm.
 */
export type RainBand = "15 mm or more" | "10-15 mm" | "under 10 mm";
export function rainLight() {
  const band = (mm: number): RainBand => (mm >= 15 ? "15 mm or more" : mm >= 10 ? "10-15 mm" : "under 10 mm");
  const res = { n: { "15 mm or more": 0, "10-15 mm": 0, "under 10 mm": 0 } as Record<RainBand, number>, dead: { "15 mm or more": 0, "10-15 mm": 0, "under 10 mm": 0 } as Record<RainBand, number>, rot: 0 };
  for (const y of YEARS) {
    const rows = rowsFor(y);
    for (let a = W(1, 0); a + 168 + 72 <= NH; a += 12) {
      let rd = 0, mm = 0;
      for (let k = 0; k < 7; k++) { const t = rows.slice(a + 24 * k, a + 24 * k + 24).reduce((q, r) => q + r.P, 0); mm += t; if (t >= 1) rd++; }
      if (rd < 3) continue;
      for (const d of [0, 5, 10]) {
        const p = PARTY + 24 * d;
        if (p >= a) continue;
        for (const id of IDS) {
          const r = simulate({ spId: id, year: y, plantH: p, policy: goodCare({ pause: [a, a + 168], cover: false }), endH: a + 168 + 72 });
          const b = band(mm), x = deathOf(r);
          res.n[b]++;
          if (x.dead) { res.dead[b]++; if (x.rot) res.rot++; }
        }
      }
    }
  }
  return res;
}

/**
 * Rain only beyond the 2023-25 record: steady synthetic drizzles (cloud and ET0 cut to 30%, RH 97) of 0.5-3 mm/h for
 * 48-120 h starting on game day 1, 4 or 8, and the real rain of cyclone Fengal (1-3 Dec 2024) and of 13-16 Nov 2024 scaled
 * x1.5, x2 and x3. Nobody waters from pre hours before the rain (12: the last can is the 08:00 visit the day before; 0: the
 * last visit is at 18:00, 6 h before the rain, and good care waters if the plant asks) for 7 days after its start; good
 * care before and after; planted at the party. No rain cover, unless hint is "cover": the player follows the app's
 * heavy-rain hint (rainSoon) at the last visit, skipping the can and putting the cover on; "skip" skips the can only.
 */
export function drizzleSweep(pre = 12, hint: "cover" | "skip" | null = null) {
  // flagged: rains the hint would flag at the last visit; maxOHeavy: the highest dose in those rains
  const res = { n: 0, rot: 0, deaths: 0, spread: { n: 0, deaths: 0 }, maxR: 0, maxO: 0, maxOHeavy: 0, cans: 0, flagged: 0 };
  const one = (y: Year, a: number, wxAt: WxAt) => {
    let rainDays = 0;
    for (let d = 0; d < 7; d++) { let t = 0; for (let k = 0; k < 24; k++) t += (wxAt(a + 24 * d + k) as HourWeather).P; if (t >= 1) rainDays++; }
    const last = a - pre - (pre === 0 ? 6 : 4);                          // the last visit: 18:00 (pre 0) or 08:00 the day before
    const heavy = rainSoon(ahead({ wx: wxAt }, last), last).heavy;
    if (heavy) res.flagged++;
    for (const id of IDS) {
      const pol = goodCare({ pause: [a - pre, a + 168], cover: hint === "cover", hint: hint !== null });
      const r = simulate({ spId: id, year: y, plantH: PARTY, wxAt, policy: pol, endH: Math.min(NH, a + 168 + 72) });
      if (r.rec.some((x) => x.h === last + 1 && x.s.lastCanH === last)) res.cans++;
      res.n++;
      if (rainDays >= 3) res.spread.n++;
      for (const x of r.rec) if (x.h > a) {
        res.maxR = Math.max(res.maxR, x.s.R); res.maxO = Math.max(res.maxO, x.s.O);
        if (heavy) res.maxOHeavy = Math.max(res.maxOHeavy, x.s.O);
      }
      const d = deathOf(r);
      if (d.dead) { res.deaths++; if (rainDays >= 3) res.spread.deaths++; if (d.rot) res.rot++; }
    }
  };
  for (const i of [0.5, 1, 1.5, 2, 3]) for (const n of [48, 72, 96, 120]) for (const d0 of [1, 4, 8]) for (const y of YEARS) {
    const b = rowsFor(y), a = W(d0, 0);
    one(y, a, (h) => (h >= a && h < a + n ? { ...b[h], P: i, SW: b[h].SW * 0.3, ET0: b[h].ET0 * 0.3, RH: 97 } : b[h]));
  }
  for (const [y, d] of [[2024, 21], [2024, 3]] as const) for (const k of [1.5, 2, 3]) {
    const b = rowsFor(y), a = W(d, 0);
    one(y, a, (h) => (h >= a && h < a + 168 ? { ...b[h], P: b[h].P * k } : b[h]));
  }
  return res;
}

/**
 * Good care until the grafted 2023 wet week begins (graft day gd), then one can a day at hh, rain or not, planted at the
 * party: days from the first heavy shower to death, or null if it did not die of rot.
 */
export function wetAfterCare(y: Year, gd: number, hh: number, id: SpeciesId): number | null {
  const g = graft(y, gd), a = W(gd, 0), care = goodCare();
  const r = simulate({ spId: id, year: y, plantH: PARTY, wxAt: g.wx, policy: (h, hod, s, ctx) => (h < a ? care(h, hod, s, ctx) : hod === hh ? [{ kind: "water" }] : []), endH: Math.min(NH, a + 24 * 14) });
  const t = soakTimes(r, g.anchor);
  return t ? t.death : null;
}

export const range = (a: number[]) => (a.length ? [Math.min(...a), Math.max(...a)] : [NaN, NaN]);
