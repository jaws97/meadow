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
// eases again per frame). The one clock it steps instead is a lily's: the hours since its first flower opened, which
// opens the later flowers on the mornings after (lib/plant/raceme). A different plant replacing the one on screen (the
// owner's rose making way for a colleague's seed, or back) is a soft dissolve once the garden is showing, and immediate
// under the loading veil. The last plant shown is kept in localStorage so a returning visitor's garden opens on their
// own plant (and their own poster), and a lily on its own flowers.
//
// The pure helpers (words for the soil and the weather, the overlays, the bloom outlook) are exported for the care layer
// and the tests; nothing here touches the DOM until startPlantSync runs, apart from reading that one cached look.
//
// The lotus (lib/sim/pond.ts) comes through the same doors with its own words and a pond for the scene. Its water action
// freshens the jar, then plants the seedling in its pot ("Plant in the pond"), then pours a bucket ("Top up the pond");
// "Tend the pond" gives the koi a pinch and rinses aphids; it has four care buttons (no shade cloth, no rain cover). Its
// pond numbers reach the garden store as PondShown (pondShownOf), eased like the rest, with the moments this device's
// own top-up, pinch and planting began, so the scene can play each once; a refused top-up is said outright
// (topUpRefused), so the brass pot pouring for it goes home rather than stopping dead. Everything lotus-only is keyed
// on isLotus() or isPondVisual(); the soil flowers read exactly as before.
import { useSyncExternalStore } from "react";
import { getJson, newEventId, postJson, type ApiFail } from "@/lib/client/api";
import { rememberGarden } from "@/lib/client/gardens";
import { flowerSizeOf, pondShownOf } from "@/lib/client/plantShown";
import { garden, type CanMoment, type CanSoil, type GardenState, type PondShown } from "@/lib/garden/store";
import { underVeil } from "@/lib/garden/quality";
import { swapSettled } from "@/lib/garden/swapGate";
import { openedSince } from "@/lib/plant/raceme";
import { SPECIES, isLotus, type SpeciesId } from "@/lib/plant/species";
import type { CareResult, MeView } from "@/lib/server/garden";
import type { CareKind } from "@/lib/server/validate";
import {
  BED,
  IST_OFFSET_MIN,
  JAR,
  POND,
  POND_GEO,
  dateOfHour,
  hod,
  hourIndexOf,
  isPondVisual,
  rainSoon,
  type PondVisual,
  type SoilVisual,
  type Visual,
} from "@/lib/sim";

export type { CareKind, MeView };
// pure, in their own module so a friend's garden can use them without this one's remembered look (lib/client/plantShown)
export { developmentOf, flowerSizeOf, pondShownOf } from "@/lib/client/plantShown";

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

/**
 * The model's Visual as the care layer shows it: glow eases, so it is a number, and a can earns a local thank-you line.
 * Spelled out per model, because TypeScript's Omit on the union Visual would keep only the keys both share.
 */
export type ShownSoilVisual = Omit<SoilVisual, "glow" | "says"> & { glow: number; says: string };
export type ShownPondVisual = Omit<PondVisual, "glow" | "says"> & { glow: number; says: string };
export type ShownVisual = ShownSoilVisual | ShownPondVisual;

/** The shown visual is a lotus's. */
export function isPondShown(v: ShownVisual): v is ShownPondVisual {
  return (v as Partial<ShownPondVisual>).medium === "pond";
}

/** A lotus's visual (the model's or the shown one), or null for a soil flower. */
function pondOf(v: Visual | ShownVisual | undefined): ShownPondVisual | PondVisual | null {
  return v && "medium" in v && v.medium === "pond" ? v : null;
}

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
  lily: "lily",
  lotus: "lotus",
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

export type PondWord = "full" | "at its line" | "could use a top-up" | "low" | "below the pot" | "the pot is drying" | "clear" | "clouding" | "cloudy";

/**
 * A lotus's water in words, for the Pond chip: in the jar, how clear its water is (it hazes at JAR.haze and clouds at
 * JAR.cloudy, as the model's lines say); in the pond, its level as the model's advice reads it (full from 9 mm over the
 * line, where a bucket would spill and the top-up asks first; could use a top-up 10 mm under the line, low at 18, below
 * the pot's rim at 25), and the pot drying once the pond has left it.
 */
export function pondWord(v: Pick<PondVisual, "stage" | "jarClarity" | "waterMM" | "potIsolated" | "potDry">): PondWord {
  if (v.stage === "jar") return v.jarClarity > 1 - JAR.haze ? "clear" : v.jarClarity > 1 - JAR.cloudy ? "clouding" : "cloudy";
  if (v.potDry) return "the pot is drying";
  if (v.potIsolated) return "below the pot";
  if (v.waterMM <= -POND.thirstyMM) return "low";
  if (v.waterMM <= -POND.readyMM) return "could use a top-up";
  return v.waterMM >= POND.fullMM ? "full" : "at its line";
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

/**
 * The rain hint as the water prompt says it: "Heavy rain tonight; skip the can.", or for a lotus, whose pond only gains
 * from rain, "Heavy rain tonight; it will top up the pond."
 */
export function rainHintText(r: RainHint, nowH: number, species?: SpeciesId): string {
  return species && isLotus(species) ? `${rainLead(r, nowH)}; it will top up the pond.` : `${rainLead(r, nowH)}; skip the can.`;
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

/**
 * The warm line in the slot, once a day for each friend: "Asha left a sprinkle for your jasmine today." A sprinkle cannot
 * top up a pond, so a lotus's (`pond`) is thanked as the kind thought it is: "Asha left a sprinkle by your pond today, a
 * kind thought for your lotus."
 */
export function friendsLine(names: readonly string[], noun: string, pond = false): string | null {
  if (names.length === 0) return null;
  const named = names.filter((n) => n !== "A friend");
  const anon = names.length - named.length;
  const parts = [...named];
  if (anon === 1) parts.push("a friend");
  else if (anon > 1) parts.push(`${anon} friends`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const who = list[0].toUpperCase() + list.slice(1);
  if (pond) return names.length === 1 ? `${who} left a sprinkle by your pond today, a kind thought for your ${noun}.` : `${who} left sprinkles by your pond today, kind thoughts for your ${noun}.`;
  return names.length === 1 ? `${who} left a sprinkle for your ${noun} today.` : `${who} left sprinkles for your ${noun} today.`;
}

// ---- the plant's line ----------------------------------------------------------------------------------------------------

/** The model's lines that ask for water (the can's cue), as the plant says them. */
const THIRSTY_LINES = new Set<string>(["very tired, would love water today", "drooping in the afternoon heat", "a little thirsty", "ready for a drink"]);
/** A lotus's lines that ask for a top-up: the pond's level, and the pot left high and dry. Rain answers these. */
const POND_WATER_LINES = new Set<string>([
  "the pond could use a top-up",
  "the pond is low",
  "the pond has dropped below the rim of my pot; a top-up or two, please",
  "the water in my pot is gone; the mud is drying",
  "my pot has dried out; my leaves are crisping",
]);
/** A lotus's lines that ask for fresh jar water: only its owner can give it, rain cannot. */
const JAR_WATER_LINES = new Set<string>([
  "my seed is rotting in murky water; fresh water, please",
  "my water has been cloudy for a while; fresh water, please",
  "time for fresh water",
  "fresh water would be lovely",
  "that food clouded my water",
]);
/** A lotus's lines that ask for a pinch for the koi. */
const KOI_LINES = new Set<string>([
  "the koi are hungry",
  "the koi keep eating my young leaves, so I cannot grow; feed them, please",
  "the koi have nibbled many of my floating leaves; they are hungry",
  "the koi are nibbling my young leaves; they are hungry",
  "the koi are nosing at my bud; they are hungry",
]);
/** A seed calm in its jar, which the narrator speaks for. */
const JAR_CALM_LINES = new Set<string>(["a seed in clear water, waking up", "my first root is showing"]);

/** Whether the plant's own line already asks for water (or a lotus's for a top-up or fresh jar water), so the chips need not say it again. */
export function lineAsksForWater(says: string): boolean {
  return THIRSTY_LINES.has(says) || POND_WATER_LINES.has(says) || JAR_WATER_LINES.has(says);
}

export const SEED_LINE = "Your seed is settling into the bed. The first shoot shows in a few hours.";
export const JAR_LINE = "Your seed is waking in its glass of water by the pond. Keep the water fresh; in a day or two it goes into its pot.";
export const RAIN_DRINK_LINE = "The rain is giving me a drink.";
export const COVERED_RAIN_LINE = "The cover is keeping the rain off me.";
export const RAIN_POND_LINE = "The rain is topping up the pond.";
export const RAIN_SOON_LINE = "The rain is on its way.";

/**
 * A seed not yet up: its stem shows from growth 0.03 (about nine hours after planting in the model, its first leaves
 * about three hours later), so before then the bed is bare but for the seed's mound. Read from growth rather than the
 * stage, which stays "seed" until D 0.05, some hours after the first leaves are out. A lotus is a seed while it is in its
 * jar.
 */
export function isSeed(me: Pick<MeView, "state">, v: Pick<Visual, "growth"> & { medium?: "pond"; stage?: "jar" | "pond" }): boolean {
  if (v.medium === "pond") return me.state.alive && v.stage === "jar";
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
  v: Pick<Visual, "growth" | "mood" | "alive"> & { says: string; medium?: "pond"; stage?: "jar" | "pond" },
  rain: RainHint | null,
  cover = false,
): { text: string; voice: "plant" | "narrator"; mood: Visual["mood"] } | null {
  if (!v.alive || !me.state.alive) return null;
  const pond = v.medium === "pond";
  if (isSeed(me, v) && v.mood === "content" && (!pond || JAR_CALM_LINES.has(v.says))) return { text: pond ? JAR_LINE : SEED_LINE, voice: "narrator", mood: v.mood };
  // the lines rain answers: a soil flower's thirst, a lotus's pond level (never its jar: rain cannot freshen a jar)
  const rainAnswers = pond ? POND_WATER_LINES.has(v.says) : THIRSTY_LINES.has(v.says);
  if (rain?.when === "now" && rainAnswers) {
    return { text: pond ? RAIN_POND_LINE : cover ? COVERED_RAIN_LINE : RAIN_DRINK_LINE, voice: "plant", mood: v.mood === "thirsty" ? "content" : v.mood };
  }
  // heavy rain due: the plant still says what it feels, and that the rain is coming to see to it
  if (rain?.when === "soon" && rainAnswers) return { text: `${sayLine(v.says)} ${RAIN_SOON_LINE}`, voice: "plant", mood: v.mood };
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
  return { mode: "closed" };
}

// ---- optimistic care -----------------------------------------------------------------------------------------------------

export interface OverlayEvent {
  kind: CareKind | "sprinkle";
  on: boolean | null;
  /** when it happened (ms); for an action this page did not send, the start of its hour */
  t: number;
  /** this page sent it (its moment is exact, and the scene may play it) */
  mine: boolean;
  /**
   * a lotus's tend: whether it also gave the koi a pinch (one counts every POND.koiGapH hours; a tend always rinses the
   * aphids). Absent reads as a pinch.
   */
  pinch?: boolean;
}

/**
 * The care that is not yet inside the server's state: this page's own actions (with their exact times) and the
 * server's pending list for anything else (another device, an earlier visit), without counting an action twice.
 * A lotus's tends are marked with whether each was also the koi's pinch (koiPinches).
 */
export function overlayEvents(me: Pick<MeView, "pending" | "state"> & { care?: Pick<MeView["care"], "koi"> }, local: readonly LocalAction[]): OverlayEvent[] {
  const out: OverlayEvent[] = [];
  const mine = local.filter((a) => hourIndexOf(new Date(a.at)) >= me.state.h);
  const used = new Set<LocalAction>();
  const fromServer = new Set<OverlayEvent>();
  for (const p of me.pending) {
    const a = mine.find((x) => !used.has(x) && x.kind === p.kind && hourIndexOf(new Date(x.at)) === p.h);
    if (a) used.add(a);
    const e: OverlayEvent = { kind: p.kind, on: p.on, t: a ? a.at : dateOfHour(p.h).getTime(), mine: !!a };
    fromServer.add(e);
    out.push(e);
  }
  for (const a of mine) if (!used.has(a)) out.push({ kind: a.kind, on: a.on, t: a.at, mine: true });
  const koi = me.care?.koi;
  if (koi) koiPinches(out, fromServer, koi);
  return out;
}

/**
 * Marks which of a lotus's tends were also the koi's pinch, as the server counts them (lib/server/rules lastPinchH): the
 * view's last pinch already folds in the server's pending tends, so of those only the one in that hour was a pinch; a
 * tend the view does not hold yet is a pinch when it comes POND.koiGapH or more after the last one that was.
 */
function koiPinches(events: OverlayEvent[], fromServer: ReadonlySet<OverlayEvent>, koi: NonNullable<MeView["care"]["koi"]>) {
  const lastH = koi.lastAt ? hourIndexOf(new Date(koi.lastAt)) : null;
  let last = lastH ?? -Infinity;
  for (const e of [...events].filter((x) => x.kind === "tend").sort((a, b) => a.t - b.t)) {
    const h = hourIndexOf(new Date(e.t));
    if (fromServer.has(e)) e.pinch = h === lastH;
    else {
      e.pinch = h - last >= POND.koiGapH;
      if (e.pinch) last = h;
    }
  }
}

/** The latest tend that was also the koi's pinch (ms), or null. */
function lastPinchOf(events: readonly OverlayEvent[]): number | null {
  let t: number | null = null;
  for (const e of events) if (e.kind === "tend" && e.pinch !== false && (t === null || e.t > t)) t = e.t;
  return t;
}

/** Whether a tend given now would also be the koi's pinch (a lotus; true when the view says nothing of the koi). */
export function tendIsPinch(me: Pick<MeView, "pending" | "state" | "care">, local: readonly LocalAction[], now: number): boolean {
  const probe: LocalAction = { id: "", kind: "tend", on: null, at: now, status: "sending", confirmedAt: 0 };
  const e = overlayEvents(me, [...local, probe]).find((x) => x.kind === "tend" && x.t === now && x.mine);
  return e?.pinch !== false;
}

/**
 * The model's Visual with the pending care's local effect on top. A can soaks in over six seconds (the surface darkens,
 * then settles back toward the root zone's share over the hour) and the leaves firm up over the next hour; tending
 * clears the pests over a few seconds; a kind word brings a glow. `settled` reads the soak as complete, for words.
 * A drink the plant asked for leaves the soil reading "just right" (the can's advice "ok"), not damp: damp would read as
 * too much water when it was exactly what was asked; a can given on damp soil anyway reads damp, honestly.
 */
export function withCare(base: Visual, events: readonly OverlayEvent[], now: number, settled = false): ShownVisual {
  if (isPondVisual(base)) return withPondCare(base, events, now);
  let v: ShownSoilVisual = { ...base };
  const last = (k: OverlayEvent["kind"]) => lastOf(events, k);
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

/** The latest overlay event of a kind (ms), or null. */
function lastOf(events: readonly OverlayEvent[], k: OverlayEvent["kind"]): number | null {
  let t: number | null = null;
  for (const e of events) if (e.kind === k && (t === null || e.t > t)) t = e.t;
  return t;
}

/** One 15 L bucket on the open pond, mm (11.5). */
const TOP_UP_MM = POND.can / POND_GEO.Ap;
/** The overflow notch, mm above the fill line (20): the pond never stands higher. */
const NOTCH_MM = 1000 * POND.over;
/** The pot's rim, mm against the fill line (-25), and its pebbles' top (-50). */
const RIM_MM = 1000 * POND_GEO.rim;
const STONES_MM = 1000 * POND.stoneTop;

/**
 * A lotus's pending care, shown at once: the water action freshens a cloudy jar (it clears), or plants a ready seedling
 * in its pot (the stage turns to pond), or pours a bucket (the level rises 11.5 mm, never past the notch); a tend rinses
 * the aphids, and when it is also the koi's pinch it feeds them (their hunger falls away, they gather); a kind word
 * brings the glow. What the server says next takes over through the same easing.
 */
function withPondCare(base: PondVisual, events: readonly OverlayEvent[], now: number): ShownPondVisual {
  let v: ShownPondVisual = { ...base };
  const water = lastOf(events, "water");
  if (water !== null && base.alive) {
    const calm = base.mood === "thirsty" ? "content" : base.mood;
    if (base.stage === "jar" && base.moveReady) {
      v = { ...v, stage: "pond", moveReady: false, jarClarity: 1, canAdvice: "ok", says: "I have settled into my pot in the pond", mood: calm };
    } else if (base.stage === "jar") {
      v = { ...v, jarClarity: 1 - JAR.J0, canAdvice: "damp", says: JAR_WATER_LINES.has(base.says) ? "thank you for the fresh water" : base.says, mood: calm };
    } else {
      const level = Math.min(NOTCH_MM, base.waterMM + TOP_UP_MM);
      const over = level >= RIM_MM;
      v = {
        ...v,
        waterMM: level,
        pondMM: level,
        stonesMM: over ? level - STONES_MM : base.stonesMM,
        potIsolated: !over,
        potDry: over ? false : base.potDry,
        water: clamp01((level - STONES_MM) / 70),
        canAdvice: level >= POND.fullMM ? "damp" : "ok",
        says: POND_WATER_LINES.has(base.says) ? "thank you for the top-up" : base.says,
        mood: calm,
      };
    }
  }
  const tend = lastOf(events, "tend");
  if (tend !== null) {
    const k = 1 - 0.9 * smooth01((now - tend) / 8000);
    v = { ...v, pests: v.pests * k, aphids: v.aphids * k, says: /^aphids on my/.test(v.says) ? "the aphids are rinsed into the pond" : v.says };
  }
  const pinch = lastPinchOf(events);
  if (pinch !== null) {
    v = {
      ...v,
      koiHunger: v.koiHunger * (1 - smooth01((now - pinch) / 4000)),
      koiGather: 1,
      koiAdvice: "fed",
      says: KOI_LINES.has(v.says) ? "the koi are fed" : v.says,
    };
  }
  const talk = lastOf(events, "talk");
  if (talk !== null && base.alive) v = { ...v, glow: Math.max(v.glow, smooth01((now - talk) / 2500)) };
  return v;
}

/**
 * When this page's own pending top-up, pinch for the koi and planting began (ms, 0 for none), read against the plant
 * before them: a water action on a ready seedling plants it, in the pond it pours a bucket. The scene plays each once.
 */
export function pondStamps(base: Pick<PondVisual, "stage" | "moveReady">, events: readonly OverlayEvent[]): Pick<PondShown, "topUpAt" | "pinchAt" | "plantedAt"> {
  let topUpAt = 0, pinchAt = 0, plantedAt = 0;
  for (const e of events) {
    if (!e.mine) continue;
    if (e.kind === "tend" && e.pinch !== false) pinchAt = Math.max(pinchAt, e.t);
    else if (e.kind === "water" && base.stage === "pond") topUpAt = Math.max(topUpAt, e.t);
    else if (e.kind === "water" && base.moveReady) plantedAt = Math.max(plantedAt, e.t);
  }
  return { topUpAt, pinchAt, plantedAt };
}

/**
 * The watering can's moment for this page's own can (the garden carries its can to the bed and pours it, and the soil
 * answers: components/garden/garden/canMoment), or null: only a living soil flower's own water starts one, never a
 * lotus's (its brass pot has its own pour), a resting plant's or a friend's sprinkle. It carries how the soil was before
 * this can, as the plant shows it: it asked for water, it was fine, or it was still damp (watered anyway).
 */
export function canMomentFor(me: MeView, kind: CareKind, local: readonly LocalAction[], now: number): CanMoment | null {
  if (kind !== "water" || isPondVisual(me.visual) || !me.visual.alive) return null;
  const v = shownVisual(me, local, now);
  if (isPondShown(v)) return null;
  const soil: CanSoil =
    v.canAdvice === "thirsty" || v.canAdvice === "ready" || v.mood === "thirsty" ? "thirsty" : v.canAdvice === "damp" || v.moisture >= 0.66 ? "damp" : "ok";
  return { at: now, refusedAt: 0, soil };
}

/** The garden's can goes home: the press it is pouring for was refused (or the phone gave up offline). */
function refuseCan(at: number) {
  const m = garden.get().canMoment;
  if (m && m.at === at && !m.refusedAt) garden.set({ canMoment: { ...m, refusedAt: Date.now() } });
}

/** A water action on a lotus already in its pond: a top-up, which the courtyard's brass pot pours at once (pondStamps). */
export function isTopUp(me: Pick<MeView, "visual">, kind: CareKind): boolean {
  return kind === "water" && isPondVisual(me.visual) && me.visual.stage === "pond";
}

/**
 * The courtyard's brass pot goes home: the top-up it is pouring for (pressed at `at`) was refused, or the phone gave
 * up offline. Said outright, since the stamp going back to 0 alone is just as often the top-up's hour being folded in.
 */
function refuseTopUp(at: number) {
  garden.set({ topUpRefused: { at, refusedAt: Date.now() } });
}

/** Seconds each eased pond number takes to cover most of the way (levels over 3 s); the rest (counts, flags, stamps) step. */
const POND_EASE = {
  waterMM: 3, stonesMM: 3, jarClarity: 3, algae: 8, floatBrown: 8, nibbled: 6, koiHunger: 3, koiGather: 2, aphids: 3,
  podDry: 10, bud2: 6, petalDrop: 3, warmth: 4,
} as const satisfies Partial<Record<keyof PondShown, number>>;
const POND_EASED = Object.keys(POND_EASE) as (keyof typeof POND_EASE)[];

/** One easing step of a lotus's shown pond toward its target, dt seconds on. */
export function easePond(shown: PondShown, target: PondShown, dt: number): PondShown {
  const next: PondShown = { ...target };
  for (const k of POND_EASED) {
    const d = target[k] - shown[k];
    next[k] = Math.abs(d) < 5e-4 ? target[k] : shown[k] + d * (1 - Math.exp(-dt / (POND_EASE[k] / 3)));
  }
  return next;
}

const POND_NUMBERS: readonly (keyof PondShown)[] = [
  "waterMM", "stonesMM", "jarClarity", "algae", "floatLeaves", "aerialLeaves", "floatBrown", "nibbled", "koiHunger", "koiGather", "aphids",
  "flowerDay", "flowers", "pods", "podDry", "bud2", "petalDrop", "warmth", "topUpAt", "pinchAt", "plantedAt",
];
/** A remembered pond (localStorage) that still has every field, or null. */
function validPond(p: unknown): PondShown | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (o.stage !== "jar" && o.stage !== "pond") return null;
  for (const k of POND_NUMBERS) if (typeof o[k] !== "number" || !Number.isFinite(o[k])) return null;
  for (const k of ["moveReady", "potIsolated", "potDry", "koiGasp"]) if (typeof o[k] !== "boolean") return null;
  return o as unknown as PondShown;
}

function samePond(a: PondShown | null, b: PondShown | null): boolean {
  if (a === null || b === null) return a === b;
  for (const k of Object.keys(b) as (keyof PondShown)[]) {
    const x = a[k], y = b[k];
    if (typeof x === "number" && typeof y === "number" ? Math.abs(x - y) > 2e-4 : x !== y) return false;
  }
  return true;
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
 * A lotus's tend thanks the koi only when it was also their pinch (`pinch`, tendIsPinch); otherwise it only rinses.
 */
export function thanksFor(
  kind: CareKind,
  on: boolean | null,
  noun: string,
  pestsBefore: number,
  n: number,
  seed = false,
  v?: Visual | ShownVisual,
  pinch = true,
): string {
  const pond = pondOf(v);
  if (pond) return lotusThanks(kind, noun, pestsBefore, n, seed, pond, pinch);
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

/**
 * A lotus's calm words for its care, by what the action did to it (v: the lotus before the action). A bucket on a pond
 * already at its line (asked first, POND_FULL_PROMPT) spills through the notch, and says so.
 */
function lotusThanks(
  kind: CareKind,
  noun: string,
  pestsBefore: number,
  n: number,
  seed: boolean,
  v: Pick<PondVisual, "stage" | "moveReady" | "waterMM">,
  pinch: boolean,
): string {
  switch (kind) {
    case "water":
      if (v.stage === "jar") return v.moveReady ? "Into its pot in the pond it goes. The seedling settles under the water." : "Fresh water for the jar. Your seed rests easy.";
      if (v.waterMM >= POND.fullMM) return "A bucket for the pond. It was at its line, so the extra spills through the notch.";
      if (v.waterMM >= 0) return "A bucket for the pond. It rises a little above its line.";
      return v.waterMM + TOP_UP_MM >= 0 ? "A bucket for the pond. The water is back at its line." : "A bucket for the pond. The water rises a little toward its line.";
    case "feed":
      return "A lotus tablet, pressed into the mud of its pot.";
    case "tend":
      if (!pinch) return pestsBefore > 0.15 ? "The aphids rinsed into the pond, a treat for the koi. Their next pinch comes a little later." : "The pond is tidy. The koi had their pinch not long ago.";
      return pestsBefore > 0.15 ? "A pinch for the koi, and the aphids rinsed into the pond for them." : "A pinch for the koi. They gather at once.";
    case "talk":
      if (seed) return ["Your seed hears you.", "A kind word. Your seed rests easy in its jar.", "Your seed is listening, snug in its jar."][n % 3];
      return [`Your ${noun} glows a little brighter.`, `A kind word. Your ${noun} glows softly.`, `Your ${noun} seems to lean toward your voice.`][n % 3];
    case "revive":
      return `A pinch of Fairy Dust. Your ${noun} will wake within the hour.`;
    case "replant":
      return "A second-chance seedling goes into the pot. It will be settled within the hour.";
    case "shade":
    case "cover":
      // never offered for a pond; the server declines them
      return "A lotus needs neither shade cloth nor rain cover.";
  }
}

/** Kinds whose word waits for the server's yes (see thanksFor). */
const THANKS_AFTER_YES: ReadonlySet<CareKind> = new Set<CareKind>(["shade", "cover", "revive", "replant"]);

/**
 * Why the can or the plant food has to wait, in the server's own words (a lotus's: its jar, its planting, its pond).
 * `planted`: the lotus's last water was its planting (the server's care.water.planted), so no bucket has been poured yet.
 */
export function notReadyText(kind: "water" | "feed", nextAt: string | null, noun: string, nowMs: number, v?: Visual | ShownVisual, planted = false): string {
  const when = nextAt ? `${istWhen(nextAt, nowMs)} IST` : "a little later";
  const pond = pondOf(v);
  if (pond) {
    if (kind === "feed") return `Your ${noun} had a lotus tablet recently; tablets are best every two days at most. The next one is welcome from ${when}.`;
    if (planted) return `Your seedling is settling into its pot; the pond's first top-up is welcome from ${when}.`;
    if (pond.stage === "pond") return `The pond had a bucket not long ago; the next top-up is welcome from ${when}.`;
    return pond.moveReady
      ? `Your seedling had fresh water not long ago; it can go into its pot in the pond from ${when}.`
      : `Your seed had fresh water not long ago; the next fresh water is welcome from ${when}.`;
  }
  return kind === "water"
    ? `Your ${noun} had a can of water not long ago; the next one is welcome from ${when}.`
    : `Your ${noun} was fed recently; plant food is best every two days. The next feed is welcome from ${when}.`;
}

const CARE_WORDS: Record<CareKind, string> = {
  water: "The water", shade: "The shade cloth", cover: "The rain cover", feed: "The plant food",
  tend: "The tending", talk: "Your words", revive: "The Fairy Dust", replant: "The sprout",
};
const LOTUS_CARE_WORDS: Record<CareKind, string> = {
  ...CARE_WORDS, feed: "The lotus tablet", tend: "The pinch for the koi", replant: "The seedling",
};

/** A declined action's message: the server's own calm words, or, when it could not be reached, a kind fallback. */
export function declinedText(kind: CareKind, f: ApiFail, species?: SpeciesId): string {
  if (f.code === "offline" || f.code === "server_error" || f.code === "unexpected") {
    return `${(species && isLotus(species) ? LOTUS_CARE_WORDS : CARE_WORDS)[kind]} did not reach the garden just now. Please try again in a moment.`;
  }
  return f.message;
}

// ---- the care buttons -------------------------------------------------------------------------------------------------

export type CareKey = "water" | "shade" | "cover" | "feed" | "tend" | "talk";
const SOIL_KEYS: readonly CareKey[] = ["water", "shade", "cover", "feed", "tend", "talk"];
const POND_KEYS: readonly CareKey[] = ["water", "feed", "tend", "talk"];

/** The care buttons a plant has, in order: six for a soil flower; four for a lotus (a pond has no shade cloth or rain cover). */
export function careKeysFor(species: SpeciesId): readonly CareKey[] {
  return isLotus(species) ? POND_KEYS : SOIL_KEYS;
}

/**
 * The words on the two buttons that change with the plant: the water button ("Water"; for a lotus "Fresh water" in the
 * jar, "Plant in the pond" once the seedling is ready, then "Top up the pond") and the tend button ("Tend"; "Tend the
 * pond" for a lotus).
 */
export function careLabels(v: Visual | ShownVisual): { water: string; tend: string } {
  const pond = pondOf(v);
  if (!pond) return { water: "Water", tend: "Tend" };
  return { water: pond.stage === "pond" ? "Top up the pond" : pond.moveReady ? "Plant in the pond" : "Fresh water", tend: "Tend the pond" };
}

/** "The koi are hungry", "Koi fed at 08:00", "Koi fed yesterday at 18:00", or null (a soil flower, or nothing to say). */
export function koiLine(me: Pick<MeView, "care" | "visual" | "state">, nowMs: number): string | null {
  const koi = me.care.koi ?? null;
  if (!koi || !isPondVisual(me.visual) || !me.state.alive) return null;
  if (me.visual.koiAdvice === "hungry") return "The koi are hungry";
  if (!koi.lastAt) return null;
  const ms = Date.parse(koi.lastAt), d = new Date(ms + IST_OFFSET_MIN * 60_000);
  const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`, days = istDay(nowMs) - istDay(ms);
  if (days <= 0) return `Koi fed at ${hm}`;
  if (days === 1) return `Koi fed yesterday at ${hm}`;
  return `Koi last fed on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The question before a top-up the pond does not need. */
export const POND_FULL_PROMPT = { title: "The pond is at its line. Top up anyway?", body: "The extra will spill through the notch." } as const;

/** The seed picker's honest line for the lotus. */
export const LOTUS_PICKER_LINE = "A lotus in a pond needs you most in its first days; after that the pond looks after it, but the koi still want feeding.";

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
  /** a lotus's pond (absent from looks remembered before the lotus, and for a soil flower) */
  pond?: PondShown | null;
  /** when the flower opened, for a lily's later flowers (absent from looks remembered before the lily's stem of flowers) */
  bloomedAt?: string | null;
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
    l.pond = isLotus(l.speciesId) ? validPond(l.pond) : null;
    if (typeof l.bloomedAt !== "string") l.bloomedAt = null;
    return l;
  } catch {
    return null;
  }
}

function saveLook(speciesId: SpeciesId, seed: string, target: RenderTarget, pond: PondShown | null, bloomedAt: string | null) {
  const now = Date.now();
  if (now - lookSavedAt < 60_000) return;
  lookSavedAt = now;
  try {
    // the pond's moments are this visit's only: a remembered look never replays a top-up or a planting
    const kept = pond ? { ...pond, topUpAt: 0, pinchAt: 0, plantedAt: 0 } : null;
    window.localStorage.setItem(LOOK_KEY, JSON.stringify({ speciesId, seed, target, at: now, pond: kept, bloomedAt } satisfies Look));
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
// (This module loads with the care layer, which may be after the canvas has begun its opening on the owner's rose: a
// remembered lotus then has the opening start again for its courtyard, RenderBudget reopenUnderVeil.)
if (typeof window !== "undefined" && underVeil()) {
  const look = readLook();
  if (look) {
    garden.set({
      speciesId: look.speciesId,
      seed: look.seed,
      ...gardenPatch(look.target),
      pond: look.pond ?? null,
      opened: openedSince(look.bloomedAt, Date.now()),
    });
    primed = true;
  }
}

// ---- the bridge to the garden store --------------------------------------------------------------------------------------

let shown: RenderTarget | null = null;
let shownPond: PondShown | null = null;
let lastStep = 0;
let bridgeTimer: ReturnType<typeof setInterval> | undefined;
let swapTimers: ReturnType<typeof setTimeout>[] = [];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function currentTarget(me: MeView, now: number): { target: RenderTarget; pond: PondShown | null; opened: number | null } {
  const events = overlayEvents(me, snap.local);
  const v = withCare(me.visual, events, now);
  const target = renderTarget(v, me.plant.generation, snap.weather, { shade: toggleShown(snap, "shade"), cover: toggleShown(snap, "cover") });
  const pond = isPondVisual(me.visual) && isPondShown(v) ? pondShownOf(v, pondStamps(me.visual, events)) : null;
  return { target, pond, opened: openedSince(me.state.bloomedAt, now) };
}

/** Whether the store's bloom clock already reads `b`, to the minute (far finer than a lily's mornings). */
function sameOpened(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) < 1 / 60;
}

function writeTarget(t: RenderTarget, pond: PondShown | null, opened: number | null, identity?: { speciesId: SpeciesId; seed: string }) {
  const g = garden.get();
  // a can poured (or a top-up refused) for one plant is never played over the next
  const p: Partial<GardenState> = identity ? { ...identity, canMoment: null, topUpRefused: null } : {};
  let changed = !!identity;
  // the bloom clock steps, never eased: a new plant takes its own at once (null before its flower opens)
  if (identity || !sameOpened(g.opened, opened)) {
    p.opened = opened;
    changed = true;
  }
  for (const k of RENDER_KEYS) {
    const now = g[k];
    if (typeof now !== "number" || Math.abs(now - t[k]) > 2e-4) {
      p[k] = t[k];
      changed = true;
    }
  }
  if (!samePond(g.pond, pond)) {
    p.pond = pond;
    changed = true;
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

/**
 * The longest the dim waits for a new scene to be ready (lib/garden/swapGate), from the moment the plant is swapped:
 * longer than a lotus courtyard's own preparation may take from its mount (LotusGarden PREPARE_MAX_MS, 7 s), so a
 * courtyard that mounts promptly is always shown before the dim lifts; one that is later still is told to show itself
 * when this runs out (swapGate onSwapOverdue), and one whose code has not even arrived keeps the dim down up to
 * swapGate's LATE_MS more. Nothing holds a soil flower's swap, so it lifts after the usual moment.
 */
const SWAP_HOLD_MS = 9000;
let swapToken = 0;

/**
 * Dims the garden, swaps the plant under it, and lets the garden back; immediate while the loading veil covers it (and
 * the opening compiles the new garden: RenderBudget reopenUnderVeil), dimmed from the veil's fade on. After the usual
 * moment, the dim also waits for whatever the scene is still preparing (a lotus's courtyard compiling behind it holds the
 * swap through lib/garden/swapGate), for up to SWAP_HOLD_MS in all, and up to LATE_MS beyond that for a courtyard whose
 * code is still on its way (then the swap gives up and the dim lifts).
 */
function swapTo(apply: () => void) {
  swapTimers.forEach(clearTimeout);
  swapTimers = [];
  const token = ++swapToken;
  if (underVeil()) {
    apply();
    setDim("none");
    patch({ swap: "none" });
    return;
  }
  const quick = reducedMotion();
  const moment = quick ? 500 : 1300;
  setDim("in");
  patch({ swap: "in" });
  swapTimers.push(
    setTimeout(() => {
      apply();
      // a moment for the new plant's materials to compile behind the dim (by then a new scene has said what it still
      // needs), then the garden comes back
      swapTimers.push(
        setTimeout(() => {
          void swapSettled(SWAP_HOLD_MS - moment).then(() => {
            if (token !== swapToken) return;
            setDim("out");
            patch({ swap: "out" });
            swapTimers.push(
              setTimeout(() => {
                setDim("none");
                patch({ swap: "none" });
              }, moment),
            );
          });
        }, moment),
      );
    }, quick ? 160 : 480),
  );
}

function bridgeStep() {
  const me = snap.me;
  if (!me || snap.swap === "in") return;
  const now = Date.now();
  const { target, pond, opened } = currentTarget(me, now);
  const identity = { speciesId: me.plant.species, seed: me.plant.seed };
  const g = garden.get();
  if (g.speciesId !== identity.speciesId || g.seed !== identity.seed) {
    shown = null;
    shownPond = null;
    swapTo(() => {
      const fresh = snap.me ? currentTarget(snap.me, Date.now()) : { target, pond, opened };
      shown = fresh.target;
      shownPond = fresh.pond;
      lastStep = Date.now();
      writeTarget(fresh.target, fresh.pond, fresh.opened, identity);
    });
    return;
  }
  if (!shown) {
    // the first view of a plant already on screen (a remembered look): ease from what the store shows
    shown = Object.fromEntries(RENDER_KEYS.map((k) => [k, typeof g[k] === "number" ? (g[k] as number) : target[k]])) as RenderTarget;
    shownPond = g.pond;
    lastStep = now;
  }
  const dt = Math.min(5, (now - lastStep) / 1000);
  lastStep = now;
  shown = easeToward(shown, target, dt);
  // a pond eases from what is shown; a stage change (the jar to the pond) or a first pond steps straight in
  shownPond = pond && shownPond && shownPond.stage === pond.stage ? easePond(shownPond, pond, dt) : pond;
  writeTarget(shown, shownPond, opened);
  saveLook(identity.speciesId, identity.seed, target, pond, me.state.bloomedAt);
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
  shownPond = null;
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
  // a lotus's tend is the koi's pinch only once every few hours (it always rinses): known before this one is counted
  const pinch = kind === "tend" && isLotus(me.plant.species) ? tendIsPinch(me, snap.local, now) : true;
  // a soil flower's can is carried to the bed and poured at once, read against the soil as it was before it
  const moment = canMomentFor(me, kind, snap.local, now);
  // a lotus's top-up is poured at once by the courtyard's brass pot, stamped with this press (pondStamps)
  const topUp = isTopUp(me, kind);
  const action: LocalAction = { id: newEventId(), kind, on: on ?? null, at: now, status: "sending", confirmedAt: 0 };
  patch({ local: [...snap.local, action], failure: null, now });
  bridgeStep();
  if (moment) garden.set({ canMoment: moment });
  const thanks = thanksFor(kind, on ?? null, plantNoun(me.plant.species), me.visual.pests, talkCount++, isSeed(me, me.visual), me.visual, pinch);
  const afterYes = THANKS_AFTER_YES.has(kind);
  if (!afterYes) say(thanks);
  const seq = ++meSeq;
  const res = await postJson<CareResult>("/api/care", { kind, clientEventId: action.id, ...(on === undefined ? {} : { on }) });
  if (res.ok) {
    updateLocal(action.id, { status: "sent", confirmedAt: Date.now() });
    if (seq > appliedSeq) applyMe(res.data.me, seq, now);
    const e = res.data.event;
    if (e.duplicate && !e.unchanged && kind === "tend") {
      say(isLotus(me.plant.species) ? "Tended this hour already; the koi have had their pinch and the leaves are rinsed." : "Tended this hour already; the leaves are tidy.");
    }
    else if (afterYes) say(thanks);
    return;
  }
  updateLocal(action.id, null);
  bridgeStep();
  if (moment) refuseCan(moment.at);
  if (topUp) refuseTopUp(action.at);
  if (res.status === 401) {
    signedOut("signed-out", true);
    return;
  }
  const text = declinedText(kind, res, me.plant.species);
  patch({ failure: { id: ++failureId, kind, text } });
  say(text, "gentle");
}

/**
 * Development only: a can given without telling the server, so the garden's watering moment can be watched again and
 * again past the four-hour rule (the development panel's Water buttons; window.__rehearseWater in scripted captures).
 * Everything else follows a real press: the card's word, the soil's soak, the can's moment. With `refuseAfterMs` the
 * press is withdrawn after that long, as a refusal from the server would be, and the can goes home.
 */
export function rehearseWater(refuseAfterMs?: number): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const me = snap.me;
  if (!me) return false;
  const now = Date.now();
  const moment = canMomentFor(me, "water", snap.local, now);
  const action: LocalAction = { id: newEventId(), kind: "water", on: null, at: now, status: "sent", confirmedAt: now };
  patch({ local: [...snap.local, action], failure: null, now });
  bridgeStep();
  if (moment) garden.set({ canMoment: moment });
  say(thanksFor("water", null, plantNoun(me.plant.species), me.visual.pests, talkCount++, isSeed(me, me.visual), me.visual, true));
  if (refuseAfterMs !== undefined) {
    setTimeout(() => {
      updateLocal(action.id, null);
      bridgeStep();
      if (moment) refuseCan(moment.at);
      say("The water did not reach the garden just now. Please try again in a moment.", "gentle");
    }, refuseAfterMs);
  }
  return true;
}
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __rehearseWater?: typeof rehearseWater }).__rehearseWater = rehearseWater;
}

/** For the care layer: the plant as shown right now (with this page's care on top), for words and cues. */
export function shownVisual(me: MeView, local: readonly LocalAction[], now: number): ShownVisual {
  return withCare(me.visual, overlayEvents(me, local), now, true);
}
