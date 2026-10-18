// The /lotus-concepts page's controls, read from and written to the address so a screenshot script can open any
// combination directly: ?stage=bloom&time=golden&mood=happy&view=pond. Every control has a default, an unknown value
// falls back to it, and a few aliases are accepted (stage=open, stage=seed, time=evening, view=garden). The pond view
// (the default) is the owner's small koi pond, a stepped granite tank in the lotus garden's own courtyard (v2, its
// "before dawn" drawn at the blue minutes before sunrise: POND_DAWN); the Meadow view is the Meadow's lazy river
// (Option A, the Rose Island moat: components/lotus/river), whose cameras are cam=product (the driving camera on the
// cart by the near bridge), cam=bridge (a bridge side-on), cam=close (the near bridge's lotus) and cam=overview; the
// plot view keeps the earlier urli on a single Meadow plot (?vessel picks its option; the river's overflow urli is
// option A). Numeric overrides (water, algae, moisture, open, warmth, droop, podDry) pin one of the look's numbers for
// exploring between the named moods. ?still=1 freezes the garden's clock (the koi, the dragonflies, the fireflies and
// the mist hold their places), ?koi=0 empties the pond (or the river) of fish. Pure: no DOM, no three.

export type Vessel = "a" | "b" | "c";
export type Stage = "jar" | "floating" | "aerial" | "bud" | "bloom" | "pod";
export type Mood = "happy" | "drying" | "green";
export type TimeOfDay = "predawn" | "noon" | "golden" | "dusk" | "night";
export type View = "pond" | "meadow" | "plot";
export type Cam = "product" | "close" | "bridge" | "overview";
/** Which of the flower's three days is drawn (or the re-closed cup); auto picks the honest one for the hour. */
export type FlowerDay = "auto" | "1" | "2" | "3" | "closed";
export type PetalColour = "pink" | "white" | "tipped";

export interface Overrides {
  /** urli: water above the mud, mm (0 bare mud .. 40 at the brim); pond: the level against the fill line, mm (-120 .. 20) */
  water?: number;
  /** green water 0 clear .. 1 pea soup */
  algae?: number;
  /** the urli's mud, as the model's Visual moisture: 0.6 while water stands, falling to 0 as it dries */
  moisture?: number;
  /** the flower's open fraction 0 shut .. 1 widest */
  open?: number;
  /** the flower's warmth 0..1 (its inner glow) */
  warmth?: number;
  /** stalk and blade droop 0..1 */
  droop?: number;
  /** the seed pod drying 0 green .. 1 dark brown */
  podDry?: number;
}

export interface ConceptParams {
  vessel: Vessel;
  stage: Stage;
  mood: Mood;
  time: TimeOfDay;
  view: View;
  cam: Cam;
  day: FlowerDay;
  colour: PetalColour;
  rain: boolean;
  still: boolean;
  /** the pond's three young koi, or the river's twelve ambient koi (not on the plot view) */
  koi: boolean;
  overrides: Overrides;
}

export const DEFAULTS: ConceptParams = {
  vessel: "a",
  stage: "bloom",
  mood: "happy",
  time: "noon",
  view: "pond",
  cam: "product",
  day: "auto",
  colour: "pink",
  rain: false,
  still: false,
  koi: true,
  overrides: {},
};

/** Bangalore hours for each time of day (the development panel's golden hour and night, lib/sky). */
export const HOURS: Record<TimeOfDay, number> = {
  predawn: 5.25,
  noon: 12,
  golden: 17.6,
  dusk: 18.25,
  night: 21.5,
};

/**
 * The courtyard's "before dawn" is the last minutes before sunrise (about 06:16 in Bangalore in November), when the
 * mist lies on the tank in the first light and the lamps still burn: later than the flower garden's 05:15, which is
 * still night. The flower's own clock (look.ts) goes by the time of day, not the hour, so the lotus is drawn the same.
 */
export const POND_DAWN = 6.17;

/** The hour a frame is drawn at. */
export function hourFor(p: Pick<ConceptParams, "view" | "time">): number {
  return p.view === "pond" && p.time === "predawn" ? POND_DAWN : HOURS[p.time];
}

/** A clear sky, as the development panel's presets; a rainy afternoon is overcast. */
export function skyFor(time: TimeOfDay, rain: boolean): { cloud: number; rain: number } {
  if (rain) return { cloud: 0.9, rain: 0.7 };
  return { cloud: time === "night" || time === "predawn" ? 0.1 : 0.15, rain: 0 };
}

/** Labels for the on-page controls, in the order they are offered. */
export const OPTIONS = {
  vessel: [
    ["a", "A · bell-metal urli"],
    ["b", "B · granite urli"],
    ["c", "C · duck-egg glaze"],
  ],
  stage: [
    ["jar", "Seed in jar"],
    ["floating", "Floating leaves"],
    ["aerial", "Standing leaves"],
    ["bud", "Bud"],
    ["bloom", "Open flower"],
    ["pod", "Seed pod"],
  ],
  mood: [
    ["happy", "Happy"],
    ["drying", "Water low"],
    ["green", "Green water"],
  ],
  time: [
    ["predawn", "Before dawn"],
    ["noon", "Noon"],
    ["golden", "Golden hour"],
    ["dusk", "Dusk"],
    ["night", "Night"],
  ],
  view: [
    ["pond", "Pond"],
    ["meadow", "Meadow river"],
    ["plot", "Meadow plot (urli)"],
  ],
  cam: [
    ["product", "Product framing"],
    ["close", "Close"],
    ["bridge", "Bridge (river)"],
    ["overview", "Overview (river)"],
  ],
  day: [
    ["auto", "Auto"],
    ["1", "Day 1"],
    ["2", "Day 2"],
    ["3", "Day 3"],
    ["closed", "Closed"],
  ],
  colour: [
    ["pink", "Pink"],
    ["white", "White"],
    ["tipped", "Rose tips"],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>;

const ALIASES: Record<string, Record<string, string>> = {
  vessel: { brass: "a", urli: "a", granite: "b", stone: "b", glaze: "c", glazed: "c" },
  stage: {
    seed: "jar",
    float: "floating",
    floats: "floating",
    leaves: "aerial",
    standing: "aerial",
    open: "bloom",
    flower: "bloom",
    seedpod: "pod",
  },
  mood: { dry: "drying", mud: "drying", algae: "green" },
  time: { dawn: "predawn", day: "noon", midday: "noon", evening: "golden", sunset: "golden", midnight: "night" },
  view: { garden: "pond", water: "pond", river: "meadow", moat: "meadow", urli: "plot" },
  cam: { default: "product", near: "close", drive: "product", aerial: "overview", party: "overview" },
  colour: { tips: "tipped", bicolour: "tipped" },
};

function pick<T extends string>(key: string, raw: string | null, allowed: ReadonlyArray<readonly [string, string]>, fallback: T): T {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  const resolved = ALIASES[key]?.[v] ?? v;
  return (allowed.some(([id]) => id === resolved) ? resolved : fallback) as T;
}

function num(raw: string | null, lo: number, hi: number): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
}

const flag = (raw: string | null) => raw !== null && raw !== "0" && raw.toLowerCase() !== "false";

/** The controls in an address's query string (with or without the leading "?"). */
export function parseParams(search: string): ConceptParams {
  const q = new URLSearchParams(search);
  const o: Overrides = {};
  const view = pick<View>("view", q.get("view"), OPTIONS.view, DEFAULTS.view);
  const water = view === "pond" ? num(q.get("water"), -120, 20) : num(q.get("water"), 0, 40);
  if (water !== undefined) o.water = water;
  const algae = num(q.get("algae"), 0, 1);
  if (algae !== undefined) o.algae = algae;
  const moisture = num(q.get("moisture"), 0, 0.6);
  if (moisture !== undefined) o.moisture = moisture;
  const open = num(q.get("open"), 0, 1);
  if (open !== undefined) o.open = open;
  const warmth = num(q.get("warmth"), 0, 1);
  if (warmth !== undefined) o.warmth = warmth;
  const droop = num(q.get("droop"), 0, 1);
  if (droop !== undefined) o.droop = droop;
  const podDry = num(q.get("podDry") ?? q.get("poddry"), 0, 1);
  if (podDry !== undefined) o.podDry = podDry;
  return {
    vessel: pick("vessel", q.get("vessel"), OPTIONS.vessel, DEFAULTS.vessel),
    stage: pick("stage", q.get("stage"), OPTIONS.stage, DEFAULTS.stage),
    mood: pick("mood", q.get("mood"), OPTIONS.mood, DEFAULTS.mood),
    time: pick("time", q.get("time"), OPTIONS.time, DEFAULTS.time),
    view,
    cam: pick("cam", q.get("cam"), OPTIONS.cam, DEFAULTS.cam),
    day: pick("day", q.get("day"), OPTIONS.day, DEFAULTS.day),
    colour: pick("colour", q.get("colour") ?? q.get("color"), OPTIONS.colour, DEFAULTS.colour),
    rain: flag(q.get("rain")),
    still: flag(q.get("still")),
    // koi live in the owner's pond; the Meadow's river has none unless asked for (?koi=1), as the owner said the
    // Meadow needs no koi
    koi: q.get("koi") === null ? view !== "meadow" && DEFAULTS.koi : flag(q.get("koi")),
    overrides: o,
  };
}

/** Query keys this page owns; anything else in the address (quality, governor) is passed through untouched. */
const OWN = ["vessel", "stage", "mood", "time", "view", "cam", "day", "colour", "color", "rain", "still", "koi", "water", "algae", "moisture", "open", "warmth", "droop", "podDry", "poddry"];

/**
 * The query string for `p`, keeping whatever else `current` carries (?quality=cinematic&governor=off). The four main
 * controls and the view are always written, so a copied address says exactly what it shows; the urli's vessel when
 * the plot view shows it (or it is not the default); the rest only when not the default.
 */
export function toSearch(p: ConceptParams, current = ""): string {
  const q = new URLSearchParams(current);
  for (const k of OWN) q.delete(k);
  if (p.view === "plot" || p.vessel !== DEFAULTS.vessel) q.set("vessel", p.vessel);
  q.set("stage", p.stage);
  q.set("mood", p.mood);
  q.set("time", p.time);
  q.set("view", p.view);
  if (p.cam !== DEFAULTS.cam) q.set("cam", p.cam);
  if (p.day !== DEFAULTS.day) q.set("day", p.day);
  if (p.colour !== DEFAULTS.colour) q.set("colour", p.colour);
  if (p.rain) q.set("rain", "1");
  if (p.still) q.set("still", "1");
  if (!p.koi) q.set("koi", "0");
  for (const [k, v] of Object.entries(p.overrides)) if (v !== undefined) q.set(k, String(v));
  return "?" + q.toString();
}

/** A stable key for everything that changes what is drawn (the ready flag re-arms on it). */
export function sceneKey(p: ConceptParams): string {
  return toSearch(p);
}
