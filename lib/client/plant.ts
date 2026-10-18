"use client";
// The signed-in visitor's plant in the browser: what the server says about it (GET /api/me), the weather at the office
// (GET /api/weather/now), the care the visitor has just given (POST /api/care), and the bridge that eases all of it into
// the garden store so the 3D plant shows the model's live state.
//
// Sync. The view is fetched on start, every few minutes, shortly after each hour completes (care and weather take
// effect when their hour completes, lib/server/garden.ts), when the tab comes back into view, and when the gift flow
// says a session has just appeared (refreshPlant, or the SESSION_EVENT window event). Answers are applied in the order
// their requests started, so a slow poll never overwrites the view a care answer brought.
//
// Optimism. A care action shows its local effect at once and is reconciled with the server, never forced: a can darkens
// the soil within seconds and firms the leaves over the next hour, tending clears the pests, a kind word makes the flower
// glow. The effect lasts while the action is pending (its hour has not yet been folded into the server's state); once it
// is, the server's own numbers take over through the same easing. A declined or failed action is withdrawn and its calm
// message shown instead.
//
// Rendering. Values never jump: the bridge eases every number toward its target a couple of times a second (the plant
// eases again per frame). A different plant replacing the one on screen (the owner's rose making way for a colleague's
// seed, or back) is a soft dissolve once the garden is showing, and immediate under the loading veil. The last plant
// shown is kept in localStorage so a returning visitor's garden opens on their own plant (and their own poster).
//
// The pure helpers (words for the soil and the weather, the overlays, the bloom outlook) are exported for the care layer
// and the tests; nothing here touches the DOM until startPlantSync runs, apart from reading that one cached look.
import { useSyncExternalStore } from "react";
import { getJson, newEventId, postJson, type ApiFail } from "@/lib/client/api";
import { rememberGarden } from "@/lib/client/gardens";
import { garden, type GardenState } from "@/lib/garden/store";
import { quality } from "@/lib/garden/quality";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";
import type { CareResult, MeView } from "@/lib/server/garden";
import type { CareKind } from "@/lib/server/validate";
import { BED, IST_OFFSET_MIN, PLANT_OPEN_H, dateOfHour, hod, hourIndexOf, rainSoon, type Visual } from "@/lib/sim";

export type { CareKind, MeView };

// ---- shapes ------------------------------------------------------------------------------------------------------------

/** GET /api/weather/now (app/api/weather/now/route.ts). */
export interface WeatherNow {
  h: number;
  from: string;
  until: string;
  temperatureC: number;
  humidityPct: number;
  rainMm: number;
  raining: boolean;
  sunWm2: number;
  windKmh: number;
  soilTempC: number;
  isDay: boolean;
  place: string;
  credit: string;
  upToDate: boolean;
  lagHours: number;
  /** the hour in progress when the route answered, where `forecast` and `rainSoon` count from (absent from older answers) */
  nowH?: number;
  /**
   * the hours ahead by game hour (lib/server/forecast.ts; empty while the forecast is unavailable): rain as rainMm, or
   * as the model's weather row (wx.P), so rainSoon can read them
   */
  forecast?: readonly { h: number; rainMm?: number | null; wx?: { P?: number | null } | null }[];
  /** the model's heavy-rain hint over the next twelve hours from nowH, or null without a forecast */
  rainSoon?: { heavy: boolean; mm: number; startsInH: number | null } | null;
}

/**
 * starting: nothing heard yet; signed-out / no-plant: nothing to care for here (`lost` says whether to tell the person);
 * unreachable: the first fetch failed, and the sync looks again by itself.
 */
export type PlantPhase = "starting" | "signed-out" | "no-plant" | "ready" | "unreachable";

/** A care action this page sent, kept until its hour is inside the server's state (for the optimistic effect). */
export interface LocalAction {
  id: string;
  kind: CareKind;
  on: boolean | null;
  /** when it was sent (ms) */
  at: number;
  status: "sending" | "sent";
  /** when the server confirmed it (ms), 0 while sending */
  confirmedAt: number;
}

export interface Notice {
  id: number;
  text: string;
  tone: "thanks" | "gentle";
}

/** A declined care action, kept until the next one so a once-only action (the Fairy Dust) can say why beside its button. */
export interface Failure {
  id: number;
  kind: CareKind;
  text: string;
}

export interface PlantSnapshot {
  phase: PlantPhase;
  me: MeView | null;
  /** when the request behind `me` started (ms) */
  meAt: number;
  weather: WeatherNow | null;
  local: readonly LocalAction[];
  notice: Notice | null;
  failure: Failure | null;
  /** while unreachable: the server's own words for why, when it gave some */
  meProblem: string | null;
  /** signed out after this visit had a garden, and nobody else has told the person yet: the care layer says so */
  lost: boolean;
  /** a different plant coming in: the garden is dimmed while it is swapped */
  swap: "none" | "in" | "out";
  /** the clock the care layer renders against (ms), ticking every 20 s */
  now: number;
}

/** The model's Visual as the care layer shows it: glow eases, so it is a number, and a can earns a local thank-you line. */
export type ShownVisual = Omit<Visual, "glow" | "says"> & { glow: number; says: string };

// ---- small helpers -------------------------------------------------------------------------------------------------------

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth01 = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The IST calendar day a moment falls on, as a day count (for "today", "yesterday", "tomorrow"). */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MIN * 60_000) / DAY);
}

/** "15:00", "tomorrow at 09:00" or "12 Nov, 09:00": an ISO moment in IST, as seen from nowMs (as the server words it). */
export function istWhen(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  const d = new Date(ms + IST_OFFSET_MIN * 60_000);
  const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  const days = istDay(ms) - istDay(nowMs);
  if (days <= 0) return hm;
  if (days === 1) return `tomorrow at ${hm}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hm}`;
}

const NOUNS: Record<SpeciesId, string> = {
  rose: "rose",
  sundrop: "sundrop",
  magnolia: "magnolia",
  marigold: "marigold",
  island: "flower",
  jasmine: "jasmine",
};

/** What the copy calls the plant: "your rose", "your marigold". */
export function plantNoun(species: SpeciesId): string {
  return NOUNS[species] ?? "plant";
}

/** The plant's own words as a sentence: "a little thirsty" becomes "A little thirsty." */
export function sayLine(says: string): string {
  const t = says.trim();
  if (!t) return t;
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.?]$/.test(s) ? s : `${s}.`;
}

// ---- words for the chips -------------------------------------------------------------------------------------------------

export type SoilWord = "dry" | "ready for a drink" | "just right" | "damp" | "soaked";

/**
 * The soil in words, from the model's can advice (it knows the depletion; damp means the can would ask first) and, past
 * the anoxic point or with standing water, from moisture: soaked. A resting plant gives no advice, so moisture alone.
 */
export function soilWord(v: Pick<Visual, "alive" | "canAdvice" | "moisture" | "puddle">): SoilWord {
  if (v.moisture >= 0.82 || v.puddle === 1) return "soaked";
  if (!v.alive) return v.moisture >= 0.62 ? "damp" : v.moisture >= 0.4 ? "just right" : "dry";
  switch (v.canAdvice) {
    case "damp":
      return "damp";
    case "thirsty":
      return "dry";
    case "ready":
      return "ready for a drink";
    default:
      return "just right";
  }
}

export type Sky = "sun" | "moon" | "rain" | "soft";

/** The weather chip: "24°" and a word or two, an icon, and a sentence for screen readers. */
export function weatherWords(w: WeatherNow): { temp: string; words: string; sky: Sky; spoken: string } {
  const t = Math.round(w.temperatureC);
  let words: string;
  let sky: Sky;
  if (w.rainMm >= 4) [words, sky] = ["heavy rain", "rain"];
  else if (w.rainMm >= 1) [words, sky] = ["rain", "rain"];
  else if (w.raining) [words, sky] = ["light rain", "rain"];
  else if (!w.isDay) [words, sky] = ["night", "moon"];
  else if (w.sunWm2 >= 450) [words, sky] = ["sunny", "sun"];
  else if (w.sunWm2 >= 150) [words, sky] = ["bright", "sun"];
  else [words, sky] = ["soft light", "soft"];
  return { temp: `${t}°`, words, sky, spoken: `At the Disney office: ${t} degrees, ${words}.` };
}

export interface RainHint {
  when: "now" | "soon";
  heavy: boolean;
  /** hours from now to the first rain (0 while it rains) */
  startsInH: number;
}

/** An hour this wet is the rain itself arriving; a drizzle ahead of it does not set when the hint says it comes. */
const RAIN_ARRIVES_MM = 1;

/**
 * Rain worth skipping the can for: rain falling at the office now (at least a millimetre this hour, heavy from 4 mm), or
 * heavy rain due soon by the model's rainSoon (enough to soak the bed by itself). The forecast rows are read against
 * this page's own hour, so an answer the CDN kept from the hour before still counts from now; without rows, the route's
 * own rainSoon is used, moved on by the hours since it was made. "Soon" counts to the first hour of real rain (a
 * millimetre or more), not to a passing drizzle before it. Weather more than two hours old advises nothing.
 */
export function rainHint(w: WeatherNow | null, nowH: number): RainHint | null {
  if (!w || w.lagHours > 2) return null;
  if (w.rainMm >= 1) return { when: "now", heavy: w.rainMm >= 4, startsInH: 0 };
  const rows = (w.forecast ?? []).filter((r) => r && Number.isFinite(r.h));
  if (rows.length > 0) {
    const mm = (r: (typeof rows)[number]) => Math.max(0, r.wx?.P ?? r.rainMm ?? 0);
    const soon = rainSoon(rows.map((r) => ({ h: r.h, wx: { P: mm(r) } })), nowH);
    if (!soon.heavy) return null;
    let arrives: number | null = null;
    for (const r of rows) {
      const k = r.h - nowH;
      if (k >= 0 && k < BED.soonH && mm(r) >= RAIN_ARRIVES_MM && (arrives === null || k < arrives)) arrives = k;
    }
    return { when: "soon", heavy: true, startsInH: arrives ?? soon.startsInH ?? 0 };
  }
  const s = w.rainSoon;
  if (s && s.heavy) {
    const since = typeof w.nowH === "number" && Number.isFinite(w.nowH) ? Math.max(0, nowH - w.nowH) : 0;
    return { when: "soon", heavy: true, startsInH: Math.max(0, (s.startsInH ?? 0) - since) };
  }
  return null;
}

/**
 * The rain itself, in a few words: "Heavy rain tonight", "Heavy rain this afternoon", "Heavy rain tomorrow morning",
 * "It is raining at the office". Game hour 0 is midnight IST, so whole days of game hours are IST calendar days.
 */
export function rainLead(r: RainHint, nowH: number): string {
  if (r.when === "now") return r.heavy ? "Heavy rain at the office now" : "It is raining at the office";
  if (r.startsInH <= 1) return "Heavy rain is on its way";
  const h = nowH + r.startsInH;
  const at = hod(h);
  if (at >= 17 || at < 5) return "Heavy rain tonight";
  const day = Math.floor(h / 24) === Math.floor(nowH / 24) ? "this" : "tomorrow";
  return `Heavy rain ${day} ${at < 12 ? "morning" : "afternoon"}`;
}

/** The rain hint as the water prompt says it: "Heavy rain tonight; skip the can." */
export function rainHintText(r: RainHint, nowH: number): string {
  return `${rainLead(r, nowH)}; skip the can.`;
}

/** "Planted today", "Planted yesterday", "Planted 5 days ago" (IST calendar days). */
export function plantedText(plantedAt: string, nowMs: number): string {
  const days = istDay(nowMs) - istDay(Date.parse(plantedAt));
  if (days <= 0) return "Planted today";
  if (days === 1) return "Planted yesterday";
  return `Planted ${days} days ago`;
}

/**
 * The plant's day and its outlook in one short chip, so the payoff fits on a phone: "Planted today", "Day 4",
 * "Day 4 · about 10 days to bloom", "Day 15 · in bloom". Day N is N IST calendar days after planting, as the bloom
 * outlook counts (about 14 days when well kept). `spoken` is the same for screen readers.
 */
export function outlookText(me: Pick<MeView, "plant" | "state" | "forecast" | "now">, nowMs: number): { text: string; spoken: string } {
  const days = istDay(nowMs) - istDay(Date.parse(me.plant.plantedAt));
  const day = days <= 0 ? "Planted today" : `Day ${days}`;
  const bloom = bloomText(me);
  if (!bloom) return { text: day, spoken: days <= 0 ? day : `Day ${days} since planting` };
  const lower = bloom[0].toLowerCase() + bloom.slice(1);
  return { text: `${day} · ${lower}`, spoken: `${days <= 0 ? day : `Day ${days} since planting`}, ${lower}` };
}

/** "About 9 days to bloom" from the server's forecast (expectBloom), "In bloom" once it has, or null. */
export function bloomText(me: Pick<MeView, "state" | "forecast" | "now">): string | null {
  if (!me.state.alive) return null;
  if (me.state.bloomH !== null) return "In bloom";
  const f = me.forecast;
  if (!f) return null;
  const days = (f.bloomH - me.now.h) / 24;
  if (days < 0) return null;
  if (days < 1) return "Blooming very soon";
  if (days < 1.75) return "About a day to bloom";
  return `About ${Math.round(days)} days to bloom`;
}

/** "A sprinkle from Asha today", "Sprinkles from Asha and a friend today", or null. */
export function friendsText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const named = names.filter((n) => n !== "A friend");
  const anon = names.length - named.length;
  const parts = [...named];
  if (anon === 1) parts.push("a friend");
  else if (anon > 1) parts.push(`${anon} friends`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return names.length === 1 ? `A sprinkle from ${list} today` : `Sprinkles from ${list} today`;
}

/** The warm line in the slot, once a day for each friend: "Asha left a sprinkle for your jasmine today." */
export function friendsLine(names: readonly string[], noun: string): string | null {
  if (names.length === 0) return null;
  const named = names.filter((n) => n !== "A friend");
  const anon = names.length - named.length;
  const parts = [...named];
  if (anon === 1) parts.push("a friend");
  else if (anon > 1) parts.push(`${anon} friends`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const who = list[0].toUpperCase() + list.slice(1);
  return names.length === 1 ? `${who} left a sprinkle for your ${noun} today.` : `${who} left sprinkles for your ${noun} today.`;
}

// ---- the plant's line ----------------------------------------------------------------------------------------------------

/** The model's lines that ask for water (the can's cue), as the plant says them. */
const THIRSTY_LINES = new Set<string>(["very tired, would love water today", "drooping in the afternoon heat", "a little thirsty", "ready for a drink"]);

/** Whether the plant's own line already asks for water, so the chips need not say it again. */
export function lineAsksForWater(says: string): boolean {
  return THIRSTY_LINES.has(says);
}

export const SEED_LINE = "Your seed is settling into the bed. The first shoot shows in a few hours.";
export const RAIN_DRINK_LINE = "The rain is giving me a drink.";
export const COVERED_RAIN_LINE = "The cover is keeping the rain off me.";
export const RAIN_SOON_LINE = "The rain is on its way.";

/**
 * A seed not yet up: its stem shows from growth 0.03 (about nine hours after planting in the model, its first leaves
 * about three hours later), so before then the bed is bare but for the seed's mound. Read from growth rather than the
 * stage, which stays "seed" until D 0.05, some hours after the first leaves are out.
 */
export function isSeed(me: Pick<MeView, "state">, v: Pick<Visual, "growth">): boolean {
  return me.state.alive && v.growth < 0.03;
}

/**
 * What the card says for the plant, or null while it rests (the resting card says it). A seed that is content gets a
 * quiet narrator's line (its bed is still bare); in rain falling now, a plant whose last-hour line asked for water says
 * the rain is giving it one instead (or, under the rain cover, that the cover keeps it off), and with heavy rain due it
 * adds that the rain is on its way, so the line never asks for the can the rain hint says to skip; otherwise the
 * plant's own words.
 */
export function plantLine(
  me: Pick<MeView, "state">,
  v: Pick<Visual, "growth" | "mood" | "alive"> & { says: string },
  rain: RainHint | null,
  cover = false,
): { text: string; voice: "plant" | "narrator"; mood: Visual["mood"] } | null {
  if (!v.alive || !me.state.alive) return null;
  if (isSeed(me, v) && v.mood === "content") return { text: SEED_LINE, voice: "narrator", mood: v.mood };
  if (rain?.when === "now" && THIRSTY_LINES.has(v.says)) {
    return { text: cover ? COVERED_RAIN_LINE : RAIN_DRINK_LINE, voice: "plant", mood: v.mood === "thirsty" ? "content" : v.mood };
  }
  // heavy rain due: the plant still says what it feels, and that the rain is coming to see to it
  if (rain?.when === "soon" && THIRSTY_LINES.has(v.says)) return { text: `${sayLine(v.says)} ${RAIN_SOON_LINE}`, voice: "plant", mood: v.mood };
  return { text: sayLine(v.says), voice: "plant", mood: v.mood };
}

// ---- resting -------------------------------------------------------------------------------------------------------------

export type Resting =
  /** the one Fairy Dust revival is there to use */
  | { mode: "revive" }
  /** the Fairy Dust is on its way to the garden (sent, not yet confirmed) */
  | { mode: "sprinkling" }
  /** the dust is on; the plant wakes when the hour completes */
  | { mode: "waking" }
  /** a second-chance sprout can go in */
  | { mode: "replant" }
  /** the sprout is on its way to the garden (sent, not yet confirmed) */
  | { mode: "sprouting" }
  /** the sprout is going in this hour */
  | { mode: "replanting" }
  /** before the seeds are handed out (rehearsals), a sprout waits for the party */
  | { mode: "replant-later" }
  /** planting has closed for the season */
  | { mode: "closed" };

/** What a resting plant offers, or null while it is awake. */
export function restingOf(me: Pick<MeView, "state" | "care" | "pending" | "now">, local: readonly LocalAction[]): Resting | null {
  if (me.state.alive) return null;
  // only the server's word says it will wake: until then the card waits, and a failure puts the button back
  const sending = (k: CareKind) => local.some((a) => a.kind === k && a.status === "sending");
  const pending = (k: CareKind) => me.pending.some((p) => p.kind === k) || local.some((a) => a.kind === k && a.status === "sent");
  if (pending("revive")) return { mode: "waking" };
  if (pending("replant")) return { mode: "replanting" };
  if (sending("revive")) return { mode: "sprinkling" };
  if (sending("replant")) return { mode: "sprouting" };
  if (me.care.revive || !me.state.fairyUsed) return { mode: "revive" };
  if (me.care.replant) return { mode: "replant" };
  return me.now.h < PLANT_OPEN_H ? { mode: "replant-later" } : { mode: "closed" };
}

// ---- optimistic care -----------------------------------------------------------------------------------------------------

export interface OverlayEvent {
  kind: CareKind | "sprinkle";
  on: boolean | null;
  /** when it happened (ms); for an action this page did not send, the start of its hour */
  t: number;
}

/**
 * The care that is not yet inside the server's state: this page's own actions (with their exact times) and the
 * server's pending list for anything else (another device, an earlier visit), without counting an action twice.
 */
export function overlayEvents(me: Pick<MeView, "pending" | "state">, local: readonly LocalAction[]): OverlayEvent[] {
  const out: OverlayEvent[] = [];
  const mine = local.filter((a) => hourIndexOf(new Date(a.at)) >= me.state.h);
  const used = new Set<LocalAction>();
  for (const p of me.pending) {
    const a = mine.find((x) => !used.has(x) && x.kind === p.kind && hourIndexOf(new Date(x.at)) === p.h);
    if (a) used.add(a);
    out.push({ kind: p.kind, on: p.on, t: a ? a.at : dateOfHour(p.h).getTime() });
  }
  for (const a of mine) if (!used.has(a)) out.push({ kind: a.kind, on: a.on, t: a.at });
  return out;
}

/**
 * The model's Visual with the pending care's local effect on top. A can soaks in over six seconds (the surface darkens,
 * then settles back toward the root zone's share over the hour) and the leaves firm up over the next hour; tending
 * clears the pests over a few seconds; a kind word brings a glow. `settled` reads the soak as complete, for words.
 * A drink the plant asked for leaves the soil reading "just right" (the can's advice "ok"), not damp: damp would read as
 * too much water when it was exactly what was asked; a can given on damp soil anyway reads damp, honestly.
 */
export function withCare(base: Visual, events: readonly OverlayEvent[], now: number, settled = false): ShownVisual {
  let v: ShownVisual = { ...base };
  const last = (k: OverlayEvent["kind"]) => {
    let t: number | null = null;
    for (const e of events) if (e.kind === k && (t === null || e.t > t)) t = e.t;
    return t;
  };
  const water = last("water");
  if (water !== null && base.alive) {
    const since = Math.max(0, now - water);
    const soak = settled ? 1 : smooth01(since / 6000);
    const peak = Math.max(base.moisture, Math.min(0.8, base.moisture + 0.27));
    const rest = Math.max(base.moisture, Math.min(0.74, base.moisture + 0.18));
    const moisture = lerp(base.moisture, lerp(peak, rest, smooth01(since / HOUR)), soak);
    const firm = 1 - (1 - Math.min(1, since / HOUR)) ** 2;
    const asked = base.canAdvice === "ready" || base.canAdvice === "thirsty";
    v = {
      ...v,
      moisture,
      droop: base.droop * (1 - 0.85 * firm),
      canAdvice: moisture >= 0.66 && !asked ? "damp" : "ok",
      says: THIRSTY_LINES.has(base.says) ? "thank you for the drink" : base.says,
      mood: base.mood === "thirsty" ? "content" : base.mood,
    };
  }
  const tend = last("tend");
  if (tend !== null) {
    const k = 1 - 0.9 * smooth01((now - tend) / 8000);
    v = { ...v, pests: v.pests * k, aphids: v.aphids * k, mites: v.mites * k, snails: Math.round(v.snails * k) };
  }
  const talk = last("talk");
  if (talk !== null && base.alive) v = { ...v, glow: Math.max(v.glow, smooth01((now - talk) / 2500)) };
  return v;
}

/** The plant this page last showed for an action kind: on/off for the shade cloth and the rain cover. */
export function toggleShown(snap: Pick<PlantSnapshot, "me" | "meAt" | "local">, kind: "shade" | "cover"): boolean {
  const me = snap.me;
  let on = me ? me.care[kind] : false;
  for (const a of snap.local) {
    // a change still on its way, or confirmed after the view was asked for, is newer than the view
    if (a.kind === kind && a.on !== null && (a.status === "sending" || a.confirmedAt > snap.meAt)) on = a.on;
  }
  return on;
}

// ---- what the renderer is given ------------------------------------------------------------------------------------------

/** Undo the model's growth mapping (toVisual) to recover development D. */
export function developmentOf(growth: number): number {
  return growth <= 0.9 ? (growth * 0.85) / 0.9 : 0.85 + (growth - 0.9) * 1.5;
}

/**
 * The flower against a full one: the model's flower head divided by its growth ramp (so only the stress and the replant
 * cap are left). Before buds form there is nothing to measure, so a second-chance sprout reads its cap and a first seed 1.
 */
export function flowerSizeOf(v: Pick<Visual, "growth" | "flower" | "alive">, generation: number): number {
  const cap = generation > 1 ? 0.7 : 1;
  if (!v.alive || v.flower <= 0) return cap;
  const ramp = 0.3 + 0.7 * smooth01((developmentOf(v.growth) - 0.64) / (0.95 - 0.64));
  return clamp(v.flower / ramp, 0.4, 1);
}

const RENDER_KEYS = [
  "growth", "bloom", "health", "moisture", "scorch", "droop", "chlorosis", "rot", "pests", "mushrooms", "snails", "flowerSize",
  "glow", "rain", "cloud", "wind", "shade", "cover",
] as const;
type RenderKey = (typeof RENDER_KEYS)[number];
export type RenderTarget = Record<RenderKey, number>;
/** Keys a look remembered before they existed may lack; they read as 0 (folded away). */
const OPTIONAL_KEYS: ReadonlySet<RenderKey> = new Set<RenderKey>(["shade", "cover"]);

/**
 * Seconds each number takes to cover most of the way to a new value (0: it steps, as counts do, and the shade cloth and
 * the rain cover, which the garden eases in and out itself).
 */
const EASE_S: Record<RenderKey, number> = {
  growth: 8, bloom: 6, health: 10, moisture: 3, scorch: 10, droop: 5, chlorosis: 12, rot: 12, pests: 3,
  mushrooms: 0, snails: 0, flowerSize: 10, glow: 1.5, rain: 6, cloud: 8, wind: 6, shade: 0, cover: 0,
};

/**
 * What the garden store is given for a plant: its shown Visual, softened while it rests (a sleeping plant, muted and
 * bowed, never a bare brown stick), the shade cloth and the rain cover as they stand, and the office's weather on the
 * sky: rain while it rains, the wind as it blows.
 */
export function renderTarget(
  v: ShownVisual,
  generation: number,
  w: WeatherNow | null,
  covers: { shade: boolean; cover: boolean } = { shade: false, cover: false },
): RenderTarget {
  const resting = !v.alive;
  const raining = w !== null && w.lagHours <= 2 && w.raining;
  return {
    growth: v.growth,
    bloom: resting ? 0 : v.bloom,
    health: resting ? 0.45 : v.health,
    moisture: v.moisture,
    scorch: v.scorch,
    droop: resting ? 0.55 : v.droop,
    chlorosis: resting ? Math.max(0.5, v.chlorosis) : v.chlorosis,
    rot: resting ? v.rot * 0.5 : v.rot,
    pests: resting ? 0 : v.pests,
    mushrooms: v.mushrooms,
    snails: resting ? 0 : v.snails,
    flowerSize: flowerSizeOf(v, generation),
    glow: resting ? 0 : v.glow,
    rain: raining && w ? clamp(0.3 + w.rainMm / 6, 0.3, 0.95) : 0,
    cloud: raining && w ? clamp(0.7 + w.rainMm / 20, 0.7, 0.95) : 0.2,
    wind: w ? clamp(0.25 + w.windKmh / 30, 0.2, 0.9) : 0.5,
    shade: covers.shade ? 1 : 0,
    cover: covers.cover ? 1 : 0,
  };
}

/** One easing step of the shown numbers toward the target, dt seconds on. */
export function easeToward(shown: RenderTarget, target: RenderTarget, dt: number): RenderTarget {
  const next = { ...shown };
  for (const k of RENDER_KEYS) {
    const tau = EASE_S[k];
    const d = target[k] - shown[k];
    next[k] = tau <= 0 || Math.abs(d) < 5e-4 ? target[k] : shown[k] + d * (1 - Math.exp(-dt / (tau / 3)));
  }
  return next;
}

// ---- care copy -----------------------------------------------------------------------------------------------------------

/**
 * The calm word that greets a care action: at once for the can, the food, tending and talk (their effect shows at once),
 * and once the server has said yes for the shade cloth, the rain cover, the Fairy Dust and the sprout, so the card never
 * promises what did not happen. A seed not yet up (`seed`) is spoken of as a seed: there are no leaves to firm or glow.
 */
export function thanksFor(kind: CareKind, on: boolean | null, noun: string, pestsBefore: number, n: number, seed = false): string {
  switch (kind) {
    case "water":
      return seed ? "A good drink. The seed soaks it in." : "A good drink. The leaves will firm up over the next hour.";
    case "shade":
      return on ? "The shade cloth is up. It softens the strongest sun." : "The shade cloth is folded away.";
    case "cover":
      return on ? "The rain cover is on. Rain will run off the bed." : "The rain cover is off. The bed can breathe.";
    case "feed":
      return "A little plant food, stirred into the bed.";
    case "tend":
      if (seed) return "All tidy. The bed is ready for the first shoot.";
      return pestsBefore > 0.15 ? "You picked off the nibblers. The leaves can rest now." : "All tidy. The leaves look well.";
    case "talk":
      if (seed) return ["Your seed hears you.", "A kind word. Your seed rests easy in the bed.", "Your seed is listening, snug in the bed."][n % 3];
      return [
        `Your ${noun} glows a little brighter.`,
        `A kind word. Your ${noun} glows softly.`,
        `Your ${noun} seems to lean toward your voice.`,
      ][n % 3];
    case "revive":
      return `A pinch of Fairy Dust. Your ${noun} will wake within the hour.`;
    case "replant":
      return "A second-chance sprout goes in. It will be settled within the hour.";
  }
}

/** Kinds whose word waits for the server's yes (see thanksFor). */
const THANKS_AFTER_YES: ReadonlySet<CareKind> = new Set<CareKind>(["shade", "cover", "revive", "replant"]);

/** Why the can or the plant food has to wait, in the server's own words. */
export function notReadyText(kind: "water" | "feed", nextAt: string | null, noun: string, nowMs: number): string {
  const when = nextAt ? `${istWhen(nextAt, nowMs)} IST` : "a little later";
  return kind === "water"
    ? `Your ${noun} had a can of water not long ago; the next one is welcome from ${when}.`
    : `Your ${noun} was fed recently; plant food is best every two days. The next feed is welcome from ${when}.`;
}

const CARE_WORDS: Record<CareKind, string> = {
  water: "The water", shade: "The shade cloth", cover: "The rain cover", feed: "The plant food",
  tend: "The tending", talk: "Your words", revive: "The Fairy Dust", replant: "The sprout",
};

/** A declined action's message: the server's own calm words, or, when it could not be reached, a kind fallback. */
export function declinedText(kind: CareKind, f: ApiFail): string {
  if (f.code === "offline" || f.code === "server_error" || f.code === "unexpected") {
    return `${CARE_WORDS[kind]} did not reach the garden just now. Please try again in a moment.`;
  }
  return f.message;
}

// ---- the store -----------------------------------------------------------------------------------------------------------

const EMPTY: PlantSnapshot = {
  phase: "starting", me: null, meAt: 0, weather: null, local: [], notice: null, failure: null, meProblem: null, lost: false,
  swap: "none", now: 0,
};
let snap: PlantSnapshot = EMPTY;
const listeners = new Set<() => void>();

function patch(p: Partial<PlantSnapshot>) {
  snap = { ...snap, ...p };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const plantStore = { get: () => snap, subscribe };

/** Select from the plant store; the selector must return a stored value or a primitive (not a fresh object). */
export function usePlant<T>(selector: (s: PlantSnapshot) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snap),
    () => selector(EMPTY),
  );
}

/** Window event the gift flow dispatches after planting or opening a garden link here: the plant is fetched at once. */
export const SESSION_EVENT = "garden:session";

/**
 * Window event the care layer dispatches (cancelable) when this device stops holding the garden it was showing (the
 * session is gone): the door can take the name pill away and explain. When nobody cancels it, the care layer explains
 * by itself (`lost`). detail: { firstName } of the garden that was showing, when known.
 */
export const SIGNED_OUT_EVENT = "garden:signed-out";

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let noticeId = 0;
let failureId = 0;

/** Shows a calm line in the care layer for a few seconds (the newest replaces the last). */
export function say(text: string, tone: Notice["tone"] = "thanks", ms?: number) {
  clearTimeout(noticeTimer);
  patch({ notice: { id: ++noticeId, text, tone } });
  noticeTimer = setTimeout(() => patch({ notice: null }), ms ?? (tone === "gentle" ? 9000 : 6500));
}

export function dismissNotice() {
  clearTimeout(noticeTimer);
  patch({ notice: null });
}

// ---- remembered look -----------------------------------------------------------------------------------------------------

/** Also read, as a sign that this device has shown its own garden, by the garden veil's first look (lib/garden/opening). */
export const LOOK_KEY = "garden-plant:v1";
const LOOK_MAX_AGE = 7 * DAY;
let lookSavedAt = 0;
/** the store holds a remembered plant that /api/me has not confirmed yet */
let primed = false;

interface Look {
  speciesId: SpeciesId;
  seed: string;
  target: RenderTarget;
  at: number;
}

function readLook(): Look | null {
  try {
    const raw = window.localStorage.getItem(LOOK_KEY);
    if (!raw) return null;
    const l = JSON.parse(raw) as Look;
    if (!l || typeof l.seed !== "string" || !Object.hasOwn(SPECIES, l.speciesId)) return null;
    if (!(Date.now() - l.at < LOOK_MAX_AGE) || typeof l.target !== "object" || l.target === null) return null;
    for (const k of RENDER_KEYS) {
      if (typeof l.target[k] === "number" && Number.isFinite(l.target[k])) continue;
      if (!OPTIONAL_KEYS.has(k)) return null;
      l.target[k] = 0;
    }
    return l;
  } catch {
    return null;
  }
}

function saveLook(speciesId: SpeciesId, seed: string, target: RenderTarget) {
  const now = Date.now();
  if (now - lookSavedAt < 60_000) return;
  lookSavedAt = now;
  try {
    window.localStorage.setItem(LOOK_KEY, JSON.stringify({ speciesId, seed, target, at: now } satisfies Look));
  } catch {
    // a convenience only: without it the garden opens on the owner's rose and swaps
  }
}

function forgetLook() {
  lookSavedAt = 0;
  try {
    window.localStorage.removeItem(LOOK_KEY);
  } catch {
    // nothing to forget
  }
}

function gardenPatch(t: RenderTarget): Partial<GardenState> {
  return { ...t };
}

// When this module loads with the page, the first render reads the store (the canvas builds that plant, the loading veil
// looks for its poster), so a returning visitor's own plant goes in before anything is drawn. /api/me confirms it, or
// puts the owner's rose back.
// Only while the loading veil still covers the garden: once it is showing, a new plant comes in through the dissolve.
if (typeof window !== "undefined" && quality.get().veiled) {
  const look = readLook();
  if (look) {
    garden.set({ speciesId: look.speciesId, seed: look.seed, ...gardenPatch(look.target) });
    primed = true;
  }
}

// ---- the bridge to the garden store --------------------------------------------------------------------------------------

let shown: RenderTarget | null = null;
let lastStep = 0;
let bridgeTimer: ReturnType<typeof setInterval> | undefined;
let swapTimers: ReturnType<typeof setTimeout>[] = [];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function currentTarget(me: MeView, now: number): RenderTarget {
  const v = withCare(me.visual, overlayEvents(me, snap.local), now);
  return renderTarget(v, me.plant.generation, snap.weather, { shade: toggleShown(snap, "shade"), cover: toggleShown(snap, "cover") });
}

function writeTarget(t: RenderTarget, identity?: { speciesId: SpeciesId; seed: string }) {
  const g = garden.get();
  const p: Partial<GardenState> = identity ? { ...identity } : {};
  let changed = !!identity;
  for (const k of RENDER_KEYS) {
    const now = g[k];
    if (typeof now !== "number" || Math.abs(now - t[k]) > 2e-4) {
      p[k] = t[k];
      changed = true;
    }
  }
  if (changed) garden.set(p);
}

let dim: HTMLDivElement | null = null;

/**
 * The soft night that covers the garden during a swap (CareLayer.css .care-swap); plain DOM, so it works unmounted too.
 * It goes into the page's layer of garden overlays (the garden page's [data-garden-layers]), under the care card, the
 * name pill and the loading veil, so it dims the garden alone; a page without one gets it over everything, on the body.
 */
function setDim(state: "in" | "out" | "none") {
  if (state === "none") {
    dim?.remove();
    dim = null;
    return;
  }
  if (!dim) {
    dim = document.createElement("div");
    dim.className = "care-swap";
    dim.setAttribute("aria-hidden", "true");
    (document.querySelector("[data-garden-layers]") ?? document.body).appendChild(dim);
  }
  dim.dataset.state = state;
}

/** Dims the garden, swaps the plant under it, and lets the garden back; immediate while the loading veil covers it. */
function swapTo(apply: () => void) {
  swapTimers.forEach(clearTimeout);
  swapTimers = [];
  if (quality.get().veiled) {
    apply();
    setDim("none");
    patch({ swap: "none" });
    return;
  }
  const quick = reducedMotion();
  setDim("in");
  patch({ swap: "in" });
  swapTimers.push(
    setTimeout(() => {
      apply();
      // a moment for the new plant's materials to compile behind the dim, then the garden comes back
      swapTimers.push(
        setTimeout(() => {
          setDim("out");
          patch({ swap: "out" });
        }, quick ? 500 : 1300),
      );
      swapTimers.push(
        setTimeout(() => {
          setDim("none");
          patch({ swap: "none" });
        }, quick ? 1000 : 2600),
      );
    }, quick ? 160 : 480),
  );
}

function bridgeStep() {
  const me = snap.me;
  if (!me || snap.swap === "in") return;
  const now = Date.now();
  const target = currentTarget(me, now);
  const identity = { speciesId: me.plant.species, seed: me.plant.seed };
  const g = garden.get();
  if (g.speciesId !== identity.speciesId || g.seed !== identity.seed) {
    shown = null;
    swapTo(() => {
      const fresh = snap.me ? currentTarget(snap.me, Date.now()) : target;
      shown = fresh;
      lastStep = Date.now();
      writeTarget(fresh, identity);
    });
    return;
  }
  if (!shown) {
    // the first view of a plant already on screen (a remembered look): ease from what the store shows
    shown = Object.fromEntries(RENDER_KEYS.map((k) => [k, typeof g[k] === "number" ? (g[k] as number) : target[k]])) as RenderTarget;
    lastStep = now;
  }
  const dt = Math.min(5, (now - lastStep) / 1000);
  lastStep = now;
  shown = easeToward(shown, target, dt);
  writeTarget(shown);
  saveLook(identity.speciesId, identity.seed, target);
}

function startBridge() {
  if (bridgeTimer === undefined) bridgeTimer = setInterval(bridgeStep, 400);
}

function stopBridge() {
  clearInterval(bridgeTimer);
  bridgeTimer = undefined;
}

/** Back to the owner's rose (the garden everyone sees when nobody is signed in here). */
function restoreOwnersGarden() {
  shown = null;
  primed = false;
  swapTo(() => garden.reset());
}

// ---- sync ----------------------------------------------------------------------------------------------------------------

const ME_EVERY_MS = 4 * 60_000;
const WEATHER_EVERY_MS = 10 * 60_000;
const FOCUS_AFTER_MS = 60_000;

let users = 0;
let meSeq = 0;
let appliedSeq = 0;
let lastMeFetch = 0;
let lastWeatherFetch = 0;
let meInFlight: Promise<void> | null = null;
let signedOutRetries = 0;
let failedRetries = 0;
let talkCount = 0;
/** SIGNED_OUT_EVENT has gone out for this visit (until a garden shows again) */
let toldSignedOut = false;
const timers: {
  me?: ReturnType<typeof setInterval>;
  wx?: ReturnType<typeof setInterval>;
  hour?: ReturnType<typeof setTimeout>;
  tick?: ReturnType<typeof setInterval>;
  retry?: ReturnType<typeof setTimeout>;
  leave?: ReturnType<typeof setTimeout>;
} = {};

// ---- how long the shade cloth has been up ---------------------------------------------------------------------------------
//
// The model leaves leaves that grew under the cloth for two days sun-naive for three more once it comes off (they scorch
// more easily), so lifting a long shade gets a gentle word first. The view says when the cloth went up (care.shadeSinceH,
// the game hour its change was filed in). A view from before the server said so, or a cloth this page has only just
// put up, falls back to when this device first saw it up (its own action, or a view): a lower bound, so the word comes
// late, never wrongly early. A convenience in localStorage, like the remembered look.

const SHADE_KEY = "garden-shade-since:v1";

function readShadeSince(seed: string): number | null {
  try {
    const raw = window.localStorage.getItem(SHADE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as { seed?: unknown; at?: unknown };
    return r && r.seed === seed && typeof r.at === "number" && Number.isFinite(r.at) ? r.at : null;
  } catch {
    return null;
  }
}

function writeShadeSince(seed: string, at: number | null) {
  try {
    if (at === null) window.localStorage.removeItem(SHADE_KEY);
    else window.localStorage.setItem(SHADE_KEY, JSON.stringify({ seed, at }));
  } catch {
    // without it, lifting the shade simply asks nothing
  }
}

/** Keeps the remembered start of the shade in step with the shade as this page shows it. */
function noteShade(seed: string, up: boolean, at: number) {
  if (typeof window === "undefined") return;
  const since = readShadeSince(seed);
  if (up && since === null) writeShadeSince(seed, at);
  else if (!up && since !== null) writeShadeSince(seed, null);
}

/**
 * How long the shade cloth has been up on the plant on screen, in hours, or null when it is down or nobody knows: the
 * server's hour when the view carries it (and agrees the cloth is up), else this device's own memory.
 */
export function shadeUpHours(nowMs: number): number | null {
  const me = snap.me;
  if (!me || !toggleShown(snap, "shade")) return null;
  const sinceH: unknown = me.care.shadeSinceH;
  if (me.care.shade && typeof sinceH === "number" && Number.isFinite(sinceH)) return Math.max(0, hourIndexOf(new Date(nowMs)) - sinceH);
  const since = typeof window === "undefined" ? null : readShadeSince(me.plant.seed);
  return since === null ? null : Math.max(0, (nowMs - since) / HOUR);
}

// ---- applying views ---------------------------------------------------------------------------------------------------------

function applyMe(me: MeView, seq: number, requestedAt: number) {
  appliedSeq = seq;
  primed = false;
  signedOutRetries = 0;
  failedRetries = 0;
  // an action stays while its hour is not yet inside the state (or it is still on its way)
  const local = snap.local.filter((a) => a.status === "sending" || hourIndexOf(new Date(a.at)) >= me.state.h);
  toldSignedOut = false;
  patch({ me, meAt: requestedAt, phase: "ready", local, meProblem: null, lost: false, now: Date.now() });
  noteShade(me.plant.seed, toggleShown(snap, "shade"), requestedAt);
  // so the identity menu and the switch question can name this garden by its flower and its day
  rememberGarden(me.plant.plot, me.plant.species, me.plant.plantedAt);
  startBridge();
  bridgeStep();
}

/**
 * The garden this page was showing is not here any more (`tell`: say so now, rather than looking again first). The
 * owner's rose comes back; SIGNED_OUT_EVENT lets the door explain, and when nobody takes it up, the care layer does.
 */
function signedOut(phase: "signed-out" | "no-plant", tell = false) {
  const hadPlant = snap.me !== null || primed;
  const firstName = snap.me?.person.firstName ?? null;
  patch({ phase, me: null, meAt: 0, local: [], failure: null, meProblem: null });
  stopBridge();
  forgetLook();
  if (hadPlant) restoreOwnersGarden();
  if (phase === "signed-out" && (hadPlant || tell) && !toldSignedOut && typeof window !== "undefined") {
    toldSignedOut = true;
    const handled = !window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { cancelable: true, detail: { firstName } }));
    if (!handled) patch({ lost: true });
  }
}

/** The server's own reason for not answering, when it gave one (not the fallbacks for no answer at all). */
function serverWords(f: ApiFail): string | null {
  return f.code === "offline" || f.code === "aborted" || f.code === "server_error" || f.code === "unexpected" ? null : f.message;
}

function fetchMe(force = false): Promise<void> {
  if (meInFlight && !force) return meInFlight;
  const seq = ++meSeq;
  const requestedAt = Date.now();
  lastMeFetch = requestedAt;
  const run = (async () => {
    const res = await getJson<MeView>("/api/me");
    if (seq < appliedSeq) return;
    if (res.ok) return applyMe(res.data, seq, requestedAt);
    if (res.status === 401 || res.code === "no_session") {
      // a session may be moments away (a garden link being opened, a seed going in): look again twice, soon, and only
      // then say so; a garden that was showing is said at once
      const lookAgain = users > 0 && signedOutRetries < 2;
      signedOut("signed-out", !lookAgain);
      if (lookAgain) {
        clearTimeout(timers.retry);
        timers.retry = setTimeout(() => void fetchMe(), signedOutRetries++ === 0 ? 4000 : 12000);
      }
      return;
    }
    if (res.status === 404 && res.code === "no_plant") return signedOut("no-plant");
    // busy or unreachable: keep what is showing; with nothing showing yet, look again soon, then less often
    if (snap.phase === "starting" || snap.phase === "unreachable") {
      patch({ phase: "unreachable", meProblem: serverWords(res) });
      if (users > 0) {
        clearTimeout(timers.retry);
        timers.retry = setTimeout(() => void fetchMe(), [3000, 8000, 20000, 45000][Math.min(failedRetries++, 3)]);
      }
    }
  })();
  const tracked = run.finally(() => {
    if (meInFlight === tracked) meInFlight = null;
  });
  meInFlight = tracked;
  return tracked;
}

async function fetchWeather() {
  lastWeatherFetch = Date.now();
  const res = await getJson<WeatherNow>("/api/weather/now");
  if (res.ok) {
    patch({ weather: res.data });
    if (snap.me) bridgeStep();
  }
}

function scheduleHour() {
  clearTimeout(timers.hour);
  const now = Date.now();
  // shortly after the hour completes, spread over a minute so the office does not ask at once
  const next = dateOfHour(hourIndexOf(new Date(now)) + 1).getTime() + 40_000 + Math.random() * 50_000;
  timers.hour = setTimeout(() => {
    void fetchMe();
    void fetchWeather();
    scheduleHour();
  }, next - now);
}

function onWake() {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastMeFetch > FOCUS_AFTER_MS) void fetchMe();
  if (now - lastWeatherFetch > WEATHER_EVERY_MS / 2) void fetchWeather();
  patch({ now });
}

function onSession() {
  signedOutRetries = 0;
  failedRetries = 0;
  void fetchMe(true);
}

function begin() {
  clearTimeout(timers.leave);
  // the care layer stays hidden until this visit's own view arrives (a remount may be for another garden)
  toldSignedOut = false;
  patch({ phase: "starting", failure: null, meProblem: null, lost: false, now: Date.now() });
  void fetchMe();
  void fetchWeather();
  timers.me = setInterval(() => void fetchMe(), ME_EVERY_MS + Math.round(Math.random() * 30_000));
  timers.wx = setInterval(() => void fetchWeather(), WEATHER_EVERY_MS);
  timers.tick = setInterval(() => patch({ now: Date.now() }), 20_000);
  scheduleHour();
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener(SESSION_EVENT, onSession);
}

function end() {
  clearInterval(timers.me);
  clearInterval(timers.wx);
  clearInterval(timers.tick);
  clearTimeout(timers.hour);
  clearTimeout(timers.retry);
  window.removeEventListener("focus", onWake);
  window.removeEventListener("online", onWake);
  document.removeEventListener("visibilitychange", onWake);
  window.removeEventListener(SESSION_EVENT, onSession);
  stopBridge();
  // Nobody signed in here any more puts the owner's rose back; a remount for another garden (moments later) does not.
  timers.leave = setTimeout(() => {
    if (users > 0) return;
    const hadPlant = snap.me !== null || primed;
    patch({ phase: "starting", me: null, meAt: 0, local: [], notice: null, failure: null, meProblem: null, lost: false });
    forgetLook();
    if (hadPlant) restoreOwnersGarden();
  }, 600);
}

/** Starts fetching and easing the plant (the care layer calls it once mounted); returns the stop. Counted, so nesting is safe. */
export function startPlantSync(): () => void {
  users++;
  if (users === 1) begin();
  return () => {
    users--;
    if (users === 0) end();
  };
}

/** Fetch the plant now: after planting, or after a garden link was opened on this device. */
export function refreshPlant(): Promise<void> {
  signedOutRetries = 0;
  failedRetries = 0;
  return fetchMe(true);
}

/** Adopt a view the caller already has (POST /api/seed answers with the new plant's view). */
export function adoptPlant(me: MeView) {
  applyMe(me, ++meSeq, Date.now());
}

// ---- care ----------------------------------------------------------------------------------------------------------------

function updateLocal(id: string, change: Partial<LocalAction> | null) {
  patch({
    local: change === null ? snap.local.filter((a) => a.id !== id) : snap.local.map((a) => (a.id === id ? { ...a, ...change } : a)),
  });
}

/**
 * Gives one care action: shows its effect and a calm word at once, posts it with a fresh clientEventId (the same id on
 * every retry), and reconciles with the server's answer, or withdraws it and shows the server's message.
 */
export async function sendCare(kind: CareKind, on?: boolean): Promise<void> {
  const me = snap.me;
  if (!me) return;
  const now = Date.now();
  const action: LocalAction = { id: newEventId(), kind, on: on ?? null, at: now, status: "sending", confirmedAt: 0 };
  patch({ local: [...snap.local, action], failure: null, now });
  bridgeStep();
  const thanks = thanksFor(kind, on ?? null, plantNoun(me.plant.species), me.visual.pests, talkCount++, isSeed(me, me.visual));
  const afterYes = THANKS_AFTER_YES.has(kind);
  if (!afterYes) say(thanks);
  const seq = ++meSeq;
  const res = await postJson<CareResult>("/api/care", { kind, clientEventId: action.id, ...(on === undefined ? {} : { on }) });
  if (res.ok) {
    updateLocal(action.id, { status: "sent", confirmedAt: Date.now() });
    if (seq > appliedSeq) applyMe(res.data.me, seq, now);
    const e = res.data.event;
    if (e.duplicate && !e.unchanged && kind === "tend") say("Tended this hour already; the leaves are tidy.");
    else if (afterYes) say(thanks);
    return;
  }
  updateLocal(action.id, null);
  bridgeStep();
  if (res.status === 401) {
    signedOut("signed-out", true);
    return;
  }
  const text = declinedText(kind, res);
  patch({ failure: { id: ++failureId, kind, text } });
  say(text, "gentle");
}

/** For the care layer: the plant as shown right now (with this page's care on top), for words and cues. */
export function shownVisual(me: MeView, local: readonly LocalAction[], now: number): ShownVisual {
  return withCare(me.visual, overlayEvents(me, local), now, true);
}
