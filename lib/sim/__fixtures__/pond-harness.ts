// Test harness for the lotus's suites: a TypeScript copy of the frozen prototype's harness.mjs and the policies, sweeps and
// clocks of its lib.mjs (POND_VERSION 1, scratchpad lotus/integration/proto), run on the recorded weather fixtures in this
// folder. Keep it in step with the prototype: the targets are only meaningful if they are measured exactly the way the
// model was studied.
//
// Weather: the soil suites' fixtures (10 Nov - 20 Dec of 2023-25, harness.ts), continued to 15 Jan by the same grid
// point's archive rows (weather-late-<y>.json, game hours 983-1606; Weather data by Open-Meteo.com, CC BY 4.0), so a
// lotus's later flowers and a late planter's bloom have real weather.
//
// The prototype's good care visits at 08:00 and 18:00 and acts only on what the app shows: in the jar it freshens the water
// when asked and plants the seedling when told (the same water action); in the pond it pours a bucket when the pond could
// use one or is low, "Tends the pond" (a pinch for the koi and a rinse for aphids, one action) when the koi are ready or
// hungry or aphids show, and feeds the lotus when it says its leaves are paling. When the pond has turned green it gives the
// koi a pinch only when they are hungry.
import type { HourWeather, SimEvent } from "../model";
import { POND_NONE, POND_SPECIES, createPond, stepPond, toVisualPond, type PondState, type PondVisual } from "../pond";
import { OWNER, PARTY, W, YEARS, graft, readFixture, rowsFor as soilRows, unpack, type PackedWeather, type Year } from "./harness";

export { OWNER, PARTY, W, YEARS, graft };
export type { Year };

const LATE: Record<Year, HourWeather[]> = {
  2023: unpack(readFixture<PackedWeather>("weather-late-2023.json")),
  2024: unpack(readFixture<PackedWeather>("weather-late-2024.json")),
  2025: unpack(readFixture<PackedWeather>("weather-late-2025.json")),
};
const ROWS: Record<Year, HourWeather[]> = { 2023: [], 2024: [], 2025: [] };
for (const y of YEARS) ROWS[y] = soilRows(y).concat(LATE[y]);
/** Game hours 0-1606 (10 Nov 00:00 to 15 Jan 23:00) of year y. */
export const rowsFor = (y: Year): HourWeather[] => ROWS[y];
/** 983: the soil window, to 20 Dec 23:00-24:00 */
export const NH0 = soilRows(2025).length;
/** 1607: to 15 Jan 23:00-24:00 */
export const NH = Math.min(...YEARS.map((y) => rowsFor(y).length));
export const SP = POND_SPECIES.lotus;
export const NONE = POND_NONE;

// ---- runner ----------------------------------------------------------------------------------------------------------

export type WxAt = (h: number) => HourWeather | undefined;
export interface Ctx { wx: WxAt; nWater: number; nFeed: number; nJar: number; nTop: number; nMove: number; p0: number }
export type Policy = (h: number, hod: number, s: PondState, ctx: Ctx) => SimEvent[];
export interface Rec { h: number; s: PondState; v: PondVisual; w: HourWeather; ev: SimEvent[] }
export interface Run { rec: Rec[]; s: PondState; ctx: Ctx; plantH: number }

export interface SimOpts {
  year?: Year;
  plantH?: number;
  endH?: number | null;
  policy?: Policy | null;
  wxAt?: WxAt;
  init?: PondState | null;
  /** keep only the final state (no per-hour record): for the big sweeps */
  lean?: boolean;
}

/** Runs from plantH (or init.h) to endH, one step per hour, recording the state and visual after every step. */
export function simulate({ year = 2025, plantH = PARTY, endH = null, policy = null, wxAt, init = null, lean = false }: SimOpts): Run {
  const rows = rowsFor(year);
  const wx: WxAt = wxAt ?? ((h) => rows[h]);
  const end = Math.min(endH ?? plantH + 24 * 26, NH);
  let s = init ? { ...init, givers: init.givers.slice() } : createPond("lotus", plantH, OWNER);
  const rec: Rec[] = [];
  const ctx: Ctx = { wx, nWater: 0, nFeed: 0, nJar: 0, nTop: 0, nMove: 0, p0: plantH };
  for (let h = init ? init.h : plantH; h < end; h++) {
    const hod = h % 24, w = wx(h);
    if (!w) break;
    const ev = policy ? policy(h, hod, s, ctx) : [];
    const w0 = s.lastCanH, f0 = s.lastFeedH, st0 = s.stage;
    s = stepPond(s, { h, wx: w }, ev, SP);
    if (s.lastCanH !== w0 && s.lastCanH === h) { ctx.nWater++; if (st0 === 0 && s.stage === 1) ctx.nMove++; else if (st0 === 0) ctx.nJar++; else ctx.nTop++; }
    if (s.lastFeedH !== f0) ctx.nFeed++;
    if (!lean) rec.push({ h: h + 1, s, v: toVisualPond(s, SP), w, ev });
  }
  return { rec, s, ctx, plantH };
}

export function sumP(ctx: Pick<Ctx, "wx">, a: number, b: number): number {
  let t = 0;
  for (let k = Math.max(0, a); k < b; k++) { const w = ctx.wx(k); if (w) t += w.P; }
  return t;
}

// ---- policies ----------------------------------------------------------------------------------------------------------

export interface GoodCareOpts {
  pause?: [number, number] | null;
  force?: number[];
  extra?: Policy | null;
  /** rinse aphids when they show (a tend) */
  tend?: boolean;
  /** give the koi less when the pond has turned green */
  freshen?: boolean;
  feed?: boolean;
  /** false: never tend (the koi never fed) */
  koi?: boolean;
}
export function goodCare({ pause = null, force = [], extra = null, tend = true, freshen = true, feed = true, koi = true }: GoodCareOpts = {}): Policy {
  return (h, hod, s, ctx) => {
    const ev = extra ? extra(h, hod, s, ctx) : [];
    if (force.includes(h)) { ev.push({ kind: "water" }, ...(koi ? [{ kind: "tend" } as SimEvent] : [])); return ev; }
    if (pause && h >= pause[0] && h < pause[1]) return ev;
    if (!s.alive || (hod !== 8 && hod !== 18)) return ev;
    const v = toVisualPond(s), asks = v.canAdvice === "ready" || v.canAdvice === "thirsty";
    if (asks) ev.push({ kind: "water" });
    const greenNow = freshen && v.stage === "pond" && v.algae >= 0.45;
    const pinch = koi && (v.koiAdvice === "hungry" || (!greenNow && v.koiAdvice === "ready")), rinse = koi && tend && v.pests > 0.3;
    if (pinch || rinse) ev.push({ kind: "tend" });
    if (feed && v.feedAdvice === "hungry" && !ev.some((e) => e.kind === "feed")) ev.push({ kind: "feed" });
    return ev;
  };
}
type PlainKind = "water" | "feed" | "tend" | "talk" | "revive" | "replant";
export const at = (pred: (h: number, hod: number) => boolean, kind: PlainKind = "water"): Policy => (h, hod) => (pred(h, hod) ? [{ kind }] : []);
export const merge = (...ps: (Policy | null)[]): Policy => (h, hod, s, ctx) => ps.flatMap((p) => (p ? p(h, hod, s, ctx) : []));
/** a visit: a top-up and "Tend the pond" (the pinch and the aphid rinse) */
export const VISIT = (): SimEvent[] => [{ kind: "water" }, { kind: "tend" }];
export const feedAt = (pred: (h: number, hod: number) => boolean): Policy => (h, hod) => (pred(h, hod) ? [{ kind: "feed" }] : []);
export const careUntil = (hh: number, care: Policy = goodCare()): Policy => (h, hod, s, ctx) => (h < hh ? care(h, hod, s, ctx) : []);
/** good care until the seedling is in its pot, then nothing (the jar cared for, the pond abandoned) */
export const careUntilMoved = (care: Policy = goodCare()): Policy => (h, hod, s, ctx) => (s.stage === 0 ? care(h, hod, s, ctx) : []);
/** a visit every n days at hh, counted from the planting day (ctx.p0); in the jar the same water action freshens or plants */
export const everyNrel = (n: number, hh = 9): Policy => (h, hod, s, ctx) => {
  if (hod !== hh) return [];
  const pd = Math.floor((h - ctx.p0) / 24);
  return pd >= 0 && pd % n === 0 ? VISIT() : [];
};
export const friends = (k = 2): Policy => (h, hod) => (hod === 12 ? Array.from({ length: k }, (_, i) => ({ kind: "sprinkle" as const, actor: "friend" + i })) : []);
export const pinches = (pred: (h: number, hod: number) => boolean): Policy => (h, hod) => (pred(h, hod) ? [{ kind: "tend" }] : []);

// ---- metrics -----------------------------------------------------------------------------------------------------------

export interface Bloom { days: number; ripe: number; flower: number; size: number; health: number; at: number }
/** days from planting to the bloom moment of the current generation, and the flower then; null if it never bloomed */
export function bloomOf(r: Run): Bloom | null {
  const s = r.s, b = r.rec.find((x) => x.s.bloomH !== NONE && x.s.gen === s.gen && x.h >= x.s.bloomH);
  if (!b || !b.s.alive) return null;
  const pl = b.s.plantedH;
  return { days: (b.s.bloomH - pl) / 24, ripe: (b.s.ripeH - pl) / 24, flower: b.v.flower, size: b.v.size, health: b.v.health, at: b.s.bloomH };
}
/** the day (from t0) of the first death, or null */
export function deathDay(r: Run, t0 = r.plantH): number | null {
  const x = r.rec.find((q) => q.h > t0 && !q.s.alive);
  return x ? (x.h - t0) / 24 : null;
}

export interface SweepRow { y: Year; d: number; p: number; bloom: number | null; flower: number | null; size: number | null; death: number | null; diedFirst: boolean; rain14: number }
/** every planting at hod (15:00) on days 0-22 of 2023-25 (69 plantings), len days each */
export function sweep(polF: () => Policy | null, { days = [...Array(23).keys()], hod = 15, len = 30 }: { days?: number[]; hod?: number; len?: number } = {}): SweepRow[] {
  const out: SweepRow[] = [];
  for (const y of YEARS) for (const d of days) {
    const p = 24 * d + hod, pol = polF();
    const r = simulate({ year: y, plantH: p, policy: pol, endH: Math.min(NH, p + 24 * len) });
    const b = bloomOf(r), death = deathDay(r);
    out.push({ y, d, p, bloom: b ? b.days : null, flower: b ? b.flower : null, size: b ? b.size : null, death, diedFirst: death !== null && (!b || b.at > p + 24 * death), rain14: sumP(r.ctx, p, p + 24 * 14) });
  }
  return out;
}
/** how much later each bloom came than good care's for the same planting (days) */
export function delays(rows: readonly SweepRow[], base: readonly SweepRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r.bloom === null) continue;
    const q = base.find((x) => x.y === r.y && x.d === r.d);
    if (q && q.bloom !== null) out.push(r.bloom - q.bloom);
  }
  return out;
}

// ---- dry-down clocks ---------------------------------------------------------------------------------------------------
// Whole dry days (<= 0.2 mm) of the soil window: "typ" 2025 then 2024, "hot" 2023 first, "hottest" every dry day sorted
// by demand (the prototype's SYN).
function dryDays(ys: Year[]): HourWeather[][] {
  const out: HourWeather[][] = [];
  for (const y of ys) {
    const r = rowsFor(y).slice(0, NH0);
    for (let d = 0; 24 * (d + 1) <= r.length; d++) { const rs = r.slice(24 * d, 24 * d + 24); if (rs.reduce((a, x) => a + x.P, 0) <= 0.2) out.push(rs); }
  }
  return out;
}
const dayET = (d: HourWeather[]) => d.reduce((a, x) => a + x.ET0, 0);
export const SYN = {
  typ: dryDays([2025, 2024]),
  hot: dryDays([2023, 2025, 2024]),
  hottest: dryDays([2023, 2024, 2025]).sort((a, b) => dayET(b) - dayET(a)),
};
export type SynKey = keyof typeof SYN;
/**
 * Good care (2025, planted at the party), a last visit (a top-up and a tend) at clock hour hod of day lastDay, then stitched
 * whole dry days with nobody at all (the koi go hungry too). Days from the last visit to the pond falling below the pot's
 * rim, the pot drying, and death; null for a run still in its jar at the last visit.
 */
export function drydown(key: SynKey, lastDay: number, hod: number): { rim: number | null; dry: number | null; death: number | null } | null {
  const rows = rowsFor(2025), lw = W(lastDay, hod), a = W(lastDay + 1, 0), syn = SYN[key].flat();
  const wxAt: WxAt = (h) => (h < a ? rows[h] : syn[(h - a) % syn.length]);
  const g = goodCare();
  const pol: Policy = (h, hh, s, ctx) => (h === lw ? VISIT() : h >= lw - 4 ? [] : g(h, hh, s, ctx));
  const r = simulate({ year: 2025, plantH: PARTY, wxAt, policy: pol, endH: lw + 24 * 60 });
  const t0 = lw + 1, at0 = r.rec.find((q) => q.h === t0);
  if (!at0 || at0.s.stage !== 1) return null;
  const first = (fn: (q: Rec) => boolean) => { const x = r.rec.find((q) => q.h > t0 && fn(q)); return x ? (x.h - t0) / 24 : null; };
  return { rim: first((q) => q.v.potIsolated), dry: first((q) => q.v.potDry), death: first((q) => !q.s.alive) };
}

/** every 63 h gap (Fri 18:00 visit, Mon 09:00 visit) starting on days 1-20, planted at the party, good care otherwise */
export function weekendStats() {
  const res = { n: 0, deaths: 0, worstH: 1, minLvl: 1e9, rimExposed: 0, maxGraze: 0, delays: [] as number[] };
  for (const y of YEARS) {
    const base = bloomOf(simulate({ year: y, policy: goodCare() }));
    for (let d = 1; d <= 20; d++) {
      const fri = W(d, 18), mon = fri + 63, g = goodCare();
      res.n++;
      const pol: Policy = (h, hh, s, ctx) => (h === fri || h === mon ? VISIT() : h >= fri - 4 && h < mon ? [] : g(h, hh, s, ctx));
      const r = simulate({ year: y, policy: pol, endH: PARTY + 24 * 26 });
      if (r.rec.some((x) => !x.s.alive)) { res.deaths++; continue; }
      const win = r.rec.filter((x) => x.h > fri && x.h <= mon);
      res.worstH = Math.min(res.worstH, ...win.map((x) => x.v.health));
      const lv = win.filter((x) => x.s.stage === 1).map((x) => x.v.waterMM);
      if (lv.length) res.minLvl = Math.min(res.minLvl, ...lv);
      if (win.some((x) => x.s.stage === 1 && x.v.potIsolated)) res.rimExposed++;
      res.maxGraze = Math.max(res.maxGraze, ...win.map((x) => x.s.Dg));
      const b = bloomOf(r);
      if (b && base && base.ripe * 24 + PARTY > fri) res.delays.push(b.days - base.days);
    }
  }
  return res;
}

export function range(a: readonly number[]): [number, number] {
  return [Math.min(...a), Math.max(...a)];
}
