// The Meadow plant model, SIM_VERSION 7: a line-for-line TypeScript port of the locked scratch prototype
// (sim/model.js). One step() is one real hour of a seedling-scale plant (grams, not a shrub) in a raised bed in
// Bangalore. Water, weather, damage, pests, nitrogen and biomass run in real time.
//
// Development runs in thermal time with a broad optimum plateau (17 degC up to each species' Topt, as crop phenology
// models use), so Bangalore's November barely moves it; what the plant goes through slows it: a sustained drought signal
// (not a dry afternoon), rotting roots, salt, a heavy pest load (not a few nibbles), nitrogen, drought injury, a clearly
// stunted plant. Care, not the weather, decides the bloom: good care brings the bud to maturity about 13.25 days after
// planting whatever the planting day or hour; neglect blooms later and smaller, or never. There is no shared bloom: every
// plant keeps its own clock from its own planting hour, and a late planter has the same chance as one who planted at the
// party.
//
// A mature bud opens at its natural hour: rose, sundrop, marigold, the Island Bloom and the Pink Lily with the morning
// light (half open by 08:00), magnolia over the morning (half open by 09:00), Night Jasmine at dusk (18:00). Petals open
// only in their own part of the day (openWindow), so a wilted bud that has not finished pauses and finishes the next
// morning (or dusk). The plant asks for water ("ready for a drink") well before the drought signal can slow its bud, so a
// player who waters only when asked, twice a day at any hours, gets the 13-15 day bloom. After the one Fairy Dust
// revival is used, a plant that dies again can be replanted as a sprout whose flower is capped at 0.7. Damping-off runs
// on the water the bed has to shed each day; rain's share of that flush is capped just below the infection threshold,
// so rain alone never builds a rot dose while cans on a rain-soaked bed do, and the cans' share never counts more water
// than the cans supplied.
//
// SIM_VERSION 6 (after 5; the database keeps sim_version as a smallint, so versions stay integers): a plant whose roots
// have started to rot (the dose past the infection lag) never reads calm, and a soaked bed outranks the blooming mood;
// while it rains the plant asks for the rain cover as soon as the bed flushes hard enough to build a dose; the care
// share of the flush is capped by the care water still free to drain (wCx), and the damping-off rate kR is 4% higher so
// the over-watering clocks stay on their agreed days; rainSoon() reads a forecast for the app's "heavy rain tonight;
// skip the can" hint.
//
// SIM_VERSION 7 (after 6) is a rename only: the tropical flower's key is "island" (the Island Bloom). Not one equation
// or number changed, but a stored state carries its species key, so every SIM_VERSION 6 checkpoint is rebuilt from its
// planting and events (lib/server/catchup.ts) under the new key.
//
// The Pink Lily ("lily") joined under SIM_VERSION 7, after the prototype was locked: one more row of SIM_SPECIES and of
// TWIN (twin.ts), fitted in this repo. Not one equation, shared constant or code path changed, so the six species step
// exactly as before (SIM_VERSION 7's fingerprint in lib/server/sim-version.test.ts still holds) and no stored state needs
// rebuilding. The lily's numbers are held by a fingerprint of their own there and by the target sweeps.
//
// Pure and deterministic: no Date, no Math.random, no module state, and inputs are never mutated, so a state can be
// stored as JSON and stepped on any server. The equations, their order and every constant match the prototype (the
// lily's row aside); the parity test replays the prototype's golden file (golden-v7.json) to 1e-9. Change a number here
// only together with a new SIM_VERSION and a regenerated golden file (for the lily's row, a new SIM_VERSION and its
// fingerprint recorded under it).
//
// Hour index h counts whole hours from GAME_START (10 Nov 2026 00:00 IST), so the IST clock hour is h % 24. step() for
// hour h covers [h, h + 1) and takes the Open-Meteo row stamped at the END of that hour (weather.ts builds those rows).
//
// The seven soil species only (SoilSpeciesId): the Lotus grows in a pond under its own model and version (pond.ts,
// POND_VERSION), and plant.ts sends each plant to its model. Since the lotus joined, the species ids here are typed
// SoilSpeciesId; not one equation or number changed.
import type { SoilSpeciesId } from "@/lib/plant/species";
import { TWIN } from "./twin";

export { TWIN };
export type { TwinEntry } from "./twin";

export const SIM_VERSION = 7;
/** h = 0: 10 Nov 2026 00:00 IST, the day of the party. */
export const GAME_START = "2026-11-10T00:00+05:30";
/**
 * 10 Nov 15:00 IST: the party starts and Lijas hands out the seeds. Planting itself opened earlier, on 20 Oct, and has no
 * closing hour (since 21 Oct: the prototype's closed after 10 Dec), so this hour now only names the party; the
 * prototype opened planting here.
 */
export const PLANT_OPEN_H = 15;

export const BED = Object.freeze({
  A: 0.1, Zr0: 0.07, Zbed: 0.25, rho: 1300,     // m2 per plant, root depth at planting (m), raised-bed depth (m), kg/m3
  ts: 0.48, tfc: 0.30, twp: 0.12, tanox: 0.38,
  Ksat: 15, tau: 0.9,          // mm/h macropore drainage above theta_anox; slow drainage: share of the FC..anox excess per day
  Ke: 1.05, REWf: 0.4, Kcb: 1.05, // bare wet-soil evaporation coeff; stage-1 evaporable water (x TAW); full-cover transpiration
  can: 10, canGapH: 4, sprinkle: 1.2, sprinkleCap: 2, feedGapH: 48, // mm over the share (1 L, 0.12 L); rate limits (h)
  Sbg: 1.2, feedSalt: 0.8, feedN: 152,           // g salts; one feed = 0.8 g of 19:19:19 (152 mg N)
  N0: 20, Nmin: 0.8,                             // soil mineral N at planting (mg/kg); mineralisation (mg/kg/day)
  B0: 0.03, TURG_LO: 0.5, TURG_HI: 1.0,
  kD: 0.020, fSen: 0.40, fSpan: 0.40, sFrac: 0.5, rDw: 0.4, // drought injury /h; share that is senescence; reversible heal /day
  thW: 0.32,                                     // wet-soil theta: a can or shower above it has "wetted" the root zone
  tauQ: 24, Qt: 14, Qs: 7.5,                      // flush memory (h); daily flush (mm/day) above which the rot dose builds, and
                                                 // the further mm/day for the full rate of 1 dose hour per hour
  Qrmax: 13,                                     // rain's share of the daily flush counts in full only up to this (mm/day, < Qt)
  Olag: 12, Ocap: 36, tauO: 8,                   // infection lag and cap (dose hours); dose decay once the flush stops (h)
  kR: 0.0079, Q10: 2,                            // damping-off /h at 24 dose hours and 25 degC soil (2 kR at the cap); Q10.
                                                 // 0.0076 until SIM_VERSION 5: raised 4% with the cap on the cans' share of
                                                 // the flush, which no longer over-counts care water on rainy days, so the
                                                 // over-watering clocks stay on their agreed days (it acts only past Olag)
  kDes: 0.06,                                    // desiccation (leaf-edge) scorch per sunny dry hour
  tauMem: 12,                                    // memory of recent rain vs care water (h), so the plant blames the right one
  dampF: 0.15, Nrich: 10, richH: 4,              // can advice "damp" below this depletion; feed advice "rich" at root-zone
                                                 // N >= Nrich mg/kg with NNI >= 0.9, and hours the plant says so after a feed
  thFresh: 0.34,                                 // theta of a fresh heavy shower that earns a calm rain line before any dose
  devA: 0.7, devInj: 0.2,                        // development lost at a full drought signal; slowing per unit drought injury
  aba0: 0.3,                                     // the bud slows only once the drought signal passes this (a sustained deficit)
  pest0: 0.1, pestDev: 0.3,                      // pest damage that does not hold the bud back; slowing at the 0.6 damage cap
  abaUp: 3, abaRec: 20,                          // drought signal rise and recovery times (h)
  abaF0: 0.35, abaDp: 0.05, budK: 0.4,           // the signal starts at depletion abaF0 and is full at p + abaDp; its cost to the
                                                 // flower's size while the bud forms (the whole signal, not only above aba0)
  expDev: 0.985,                                 // expectBloom assumes good care: development at this share of the stress-free
                                                 // rate (fitted by the prototype's run.mjs calib)
  coverH: 3,                                     // cover advice: while it rains, then for up to this many hours while the bed
                                                 // still flushes (Qd >= Qt); never once the dose falls
  sproutD: 0.1, replantCap: 0.7,                 // a replant after Fairy Dust starts as a sprout (D 0.1); its flower is capped at 0.7
  readyF: 0.2, readyAmF: 0.15,                   // "ready for a drink" (canAdvice 'ready') above this depletion (below abaF0); in
  readyAmFrom: 5, readyAmTo: 12,                 // the morning (readyAmFrom to readyAmTo h) above readyAmF, as soon as it is not damp
  dawnH: 6, duskH: 17,                           // petals open only in their part of the day: morning flowers openHod..duskH,
                                                 // Night Jasmine openHod..dawnH (across midnight)
  soonH: 12, soakMM: 10,                         // rainSoon(): the hours it looks ahead, and the rain in them that soaks the bed
                                                 // by itself (as much as a can) and so counts as heavy
});
export type Bed = typeof BED;

// ---- species ---------------------------------------------------------------------------------------------------------

export interface SimSpecies {
  readonly id: SoilSpeciesId;
  readonly name: string;
  /** depletion share before the stomata close */
  readonly p: number;
  /** visible midday flagging (soft herbs high, woody magnolia low) */
  readonly wilt: number;
  /** deepest root zone (m) */
  readonly Zrmax: number;
  /** drought and waterlogging tolerance (divide the damage rates) */
  readonly tolD: number;
  readonly tolW: number;
  /**
   * cardinal temperatures, degC: development is zero at Tb, rises to the lower optimum Tlo, is flat from Tlo to Topt and
   * falls to zero at Tmax; growth keeps its own response
   */
  readonly Tb: number;
  readonly Tlo: number;
  readonly Topt: number;
  readonly Tmax: number;
  /** thermal time from seed to a mature bud, degC.d (game-tuned); TT / (Tlo - Tb) optimal days */
  readonly TT: number;
  /** what the real plant would need, degC.d, where known (informational) */
  readonly TTreal: number | null;
  /** radiation use efficiency, g/MJ PAR */
  readonly RUE: number;
  /** specific leaf area, m2/g */
  readonly SLA: number;
  /** leaf temperature where heat scorch starts, degC */
  readonly Tcrit: number;
  /** characteristic leaf size, m */
  readonly dLeaf: number;
  /** clock hour the mature bud starts to open, and the hours it takes (op 0 -> 1); bloom counts from op 0.5 */
  readonly openHod: number;
  readonly openDur: number;
  /** spider-mite susceptibility */
  readonly mites: number;
  readonly blackSpot?: true;
  /** drops a forming bud when the soil is very dry */
  readonly budDrop?: true;
  /** opens at dusk and drops its petals at dawn every day */
  readonly nightBloom?: true;
  /** a line for the seed packet: how long the real plant takes */
  readonly truth: string;
}

// * game-tuned or estimated. Tb/Tlo/Topt/Tmax degC, TT degC.d (seed to a mature bud), RUE g/MJ PAR, SLA m2/g, dLeaf m.
// Morning flowers start opening at 06:00 and are half open by 08:00 (magnolia, slower, by 09:00); Night Jasmine at 17:00,
// half open by 18:00.
// The Pink Lily's row is this repo's own (the prototype never had a lily), a bulb lily's: it likes it cool (Topt 25, Tmax
// 35) and shaded in the afternoon (Tcrit 41), has narrow leaves (dLeaf, SLA), roots a little deeper than most from a bulb
// planted deep (Zrmax), carries a missed day a little better (tolD) and rots a little sooner in soggy soil (tolW, with the
// jasmine the lowest); its buds blast in very dry soil (budDrop), and it opens with the morning light. Two numbers moved
// from the first bulb-lily guess to meet the agreed targets (targets-*.test.ts): Zrmax 0.10 to 0.088 (at 0.10 an
// abandoned lily lived 6.7 days after its last can, past the agreed 6.5, and a dry weekend slowed its bud least of all
// the flowers) and tolW 0.9 to 0.95 (at 0.9 a soaked lily died 4.4 days after the first heavy shower, before the agreed
// 4.5). TT and its twin were fitted together as the prototype fitted the six's (twin.ts); TTreal is a planted bulb's.
export const SIM_SPECIES: Readonly<Record<SoilSpeciesId, SimSpecies>> = Object.freeze({
  rose: Object.freeze<SimSpecies>({ id: "rose", name: "Enchanted Rose", p: 0.40, wilt: 0.30, Zrmax: 0.085, tolD: 1.1, tolW: 1.0, Tb: 5.2, Tlo: 17, Topt: 27, Tmax: 42.7, TT: 155.8, TTreal: 1000, RUE: 2.2, SLA: 0.020, Tcrit: 43, dLeaf: 0.088, openHod: 6, openDur: 4, mites: 0.5, blackSpot: true,
    truth: "A germinated seedling of a repeat-flowering rose usually shows its first small flower after about 6-10 weeks; here it takes 2." }),
  sundrop: Object.freeze<SimSpecies>({ id: "sundrop", name: "Sundrop", p: 0.45, wilt: 0.50, Zrmax: 0.10, tolD: 1.1, tolW: 0.96, Tb: 6, Tlo: 17, Topt: 28, Tmax: 40, TT: 145.5, TTreal: 900, RUE: 2.5, SLA: 0.025, Tcrit: 45, dLeaf: 0.04, openHod: 6, openDur: 4, mites: 0.3,
    truth: "A sunflower takes about two months from sowing to flower; here it takes 2 weeks." }),
  magnolia: Object.freeze<SimSpecies>({ id: "magnolia", name: "Magnolia", p: 0.40, wilt: 0.08, Zrmax: 0.085, tolD: 1.05, tolW: 1.0, Tb: 5, Tlo: 17, Topt: 26, Tmax: 38, TT: 156.8, TTreal: null, RUE: 1.8, SLA: 0.012, Tcrit: 42, dLeaf: 0.10, openHod: 6, openDur: 6, mites: 0.3,
    truth: "A magnolia grown from seed usually takes a decade or more to flower. This one is pure magic." }),
  marigold: Object.freeze<SimSpecies>({ id: "marigold", name: "Marigold", p: 0.50, wilt: 0.45, Zrmax: 0.08, tolD: 1.2, tolW: 0.96, Tb: 6, Tlo: 17, Topt: 26, Tmax: 38, TT: 143.5, TTreal: 1000, RUE: 2.4, SLA: 0.030, Tcrit: 44, dLeaf: 0.025, openHod: 6, openDur: 4, mites: 1.0,
    truth: "An African marigold flowers about 6-8 weeks after sowing; here it takes 2." }),
  island: Object.freeze<SimSpecies>({ id: "island", name: "Island Bloom", p: 0.35, wilt: 0.50, Zrmax: 0.085, tolD: 1.1, tolW: 1.0, Tb: 9, Tlo: 17, Topt: 29, Tmax: 42, TT: 105.6, TTreal: null, RUE: 2.2, SLA: 0.022, Tcrit: 45, dLeaf: 0.18, openHod: 6, openDur: 4, mites: 0.3, budDrop: true,
    truth: "Hibiscus and tiare grown from seed take one to several years to flower. This one is magic." }),
  jasmine: Object.freeze<SimSpecies>({ id: "jasmine", name: "Night Jasmine", p: 0.50, wilt: 0.35, Zrmax: 0.085, tolD: 1.15, tolW: 0.95, Tb: 10, Tlo: 17, Topt: 28, Tmax: 38, TT: 92.6, TTreal: null, RUE: 2.0, SLA: 0.020, Tcrit: 42, dLeaf: 0.07, openHod: 17, openDur: 2, mites: 0.3, nightBloom: true,
    truth: "A parijat raised from seed or a cutting usually needs a year or more before it flowers. This one is magic." }),
  lily: Object.freeze<SimSpecies>({ id: "lily", name: "Pink Lily", p: 0.45, wilt: 0.40, Zrmax: 0.088, tolD: 1.15, tolW: 0.95, Tb: 5, Tlo: 17, Topt: 25, Tmax: 35, TT: 152.8, TTreal: 1300, RUE: 2.0, SLA: 0.018, Tcrit: 41, dLeaf: 0.035, openHod: 6, openDur: 4, mites: 0.3, budDrop: true,
    truth: "A lily grows from a bulb, not a seed: a planted bulb takes about three months to flower, and one raised from seed two years or more. Here it takes about two weeks." }),
});

// ---- state, inputs, outputs ------------------------------------------------------------------------------------------

/** One hour of weather: the Open-Meteo row stamped at the END of the hour being stepped. */
export interface HourWeather {
  /** air temperature at 2 m, degC */
  T: number;
  /** relative humidity, % */
  RH: number;
  /** precipitation over the hour, mm */
  P: number;
  /** mean global shortwave radiation over the hour, W/m2 */
  SW: number;
  /** FAO-56 reference evapotranspiration over the hour, mm */
  ET0: number;
  /** wind speed at 10 m, km/h */
  U: number;
  /** soil temperature 0-7 cm, degC (cleanWx falls back to T when it is missing) */
  Ts: number;
  /** 1 while the sun is up */
  isDay: 0 | 1;
}

/** A weather row as it may arrive from a live API or storage: any field may be missing or not a number. */
export type LooseWeather = { readonly [K in keyof HourWeather]?: unknown };

/** The hour argument of step(): the hour index and its weather. The IST clock hour is always h % 24. */
export interface HourInput {
  h: number;
  wx: HourWeather;
}

export type OnOff = 0 | 1 | boolean;

interface EventBase {
  /**
   * Idempotency key: an id repeated within one hour is applied once (a retried request). Numeric ids also order
   * events of the same rank within the hour. Ids are compared within one hour only; dedupe across hours upstream.
   */
  id?: number | string;
}

/** A player action, applied at the start of the hour it falls in. Payloads are validated by step() again. */
export type SimEvent =
  | (EventBase & { kind: "water" })
  | (EventBase & { kind: "sprinkle"; actor: string })
  | (EventBase & { kind: "shade"; amount: OnOff })
  | (EventBase & { kind: "cover"; amount: OnOff })
  | (EventBase & { kind: "feed" })
  | (EventBase & { kind: "tend" })
  | (EventBase & { kind: "talk" })
  | (EventBase & { kind: "revive" })
  | (EventBase & { kind: "replant" });
export type SimEventKind = SimEvent["kind"];

/** Everything the model remembers about one plant. JSON-safe; step() returns a new object. */
export interface PlantState {
  /** SIM_VERSION that produced this state */
  v: number;
  sp: SoilSpeciesId;
  owner: string | null;
  /** the next hour to step; the state describes the moment h (the start of hour h) */
  h: number;
  plantedH: number;
  /** IST clock hour of h */
  hod: number;
  alive: boolean;
  /** 1 for the first seed, 2+ after a replant */
  gen: number;
  /** the one Fairy Dust revival has been used */
  fairyUsed: boolean;
  diedH: number;
  /** root-zone water (mm), lower-bed water (mm), root depth (m), turgor 0..1 */
  W: number;
  L: number;
  Zr: number;
  turgor: number;
  /** drought injury: reversible wilting and senescence; Dd = Dw + Ds */
  Dw: number;
  Ds: number;
  Dd: number;
  /** the daily flush that drives the rot dose (mm/day): Qc + min(Qr, Qrmax) */
  Qd: number;
  /** water drained through the root zone over about the last day (mm/day), the share from care water and from rain */
  Qc: number;
  Qr: number;
  /** damping-off dose (dose hours) and root rot 0..1 */
  O: number;
  R: number;
  /** fertiliser salts (g) and salt burn */
  Sf: number;
  Dsalt: number;
  /** soil and plant nitrogen (mg) */
  Ns: number;
  Np: number;
  /** biomass (g), development 0..1 (1 = a mature bud), last development factor, drought signal 0..1 */
  B: number;
  D: number;
  fDev: number;
  aba: number;
  /** scorch 0..1, bud stress (shrinks the flower), petal opening 0..1 */
  Sc: number;
  budS: number;
  op: number;
  /** hour the bud matured and the hour it bloomed (op >= 0.5), or a "not yet" mark below plantedH (createPlant) */
  ripeH: number;
  bloomH: number;
  shade: boolean;
  cover: boolean;
  shadeH: number;
  /** hours of sun-naive leaves left after a long shade comes off */
  naiveH: number;
  /** slugs and snails, aphids, spider mites 0..1, and the leaf damage they did */
  Ps: number;
  Pa: number;
  Pm: number;
  Dpest: number;
  /** mushroom moisture memory (harmless), leaf-wet hours, black spot */
  M: number;
  Lw: number;
  BS: number;
  /** sprinkles counted today, and who gave them (resets at midnight IST) */
  daySpr: number;
  givers: string[];
  budDropDay: number;
  glowH: number;
  richH: number;
  lastCanH: number;
  lastFeedH: number;
  /** flower cap: 1, or replantCap for a second-chance sprout */
  cap: number;
  /** hours since the last hour with rain falling (cover or not), at most 99 */
  dryH: number;
  /** rain and care water that reached the bed (mm, 12 h memory) */
  wR: number;
  wC: number;
  /** care water still free to drain (mm): the cans' water above field capacity, less what has drained */
  wCx: number;
  /** cumulative water book (mm): rain in, care in, ET, deep drainage, runoff, magic */
  cP: number;
  cI: number;
  cET: number;
  cDP: number;
  cRO: number;
  cMag: number;
  /** last hour's depletion share, stress coefficient, nitrogen nutrition index, salinity (dS/m), leaf temperature */
  f: number;
  Kse: number;
  NNI: number;
  EC: number;
  Tleaf: number;
}

/** Every line a plant can say, in the order toVisual() checks them. */
export const PLANT_LINES = [
  "gone to sleep",
  // rain-soaked or soggy (the wet lines; the "sick" forms name rotting or damaged roots)
  "the soil is soaked and my roots are sick",
  "the soil is soaked, let it breathe",
  "the rain soaked the soil; my roots are still mending",
  "the rain soaked the soil; it will drain soon",
  "the rain cover is on, but my roots are sick",
  "the rain cover is on; my roots will slowly dry out",
  "the rain keeps my sick roots wet; a rain cover would help",
  "the rain keeps my roots wet; a rain cover would help",
  "the rain has stopped, but my roots are soaked and sick",
  "the rain has stopped, but my roots are still soaked",
  "the rain has stopped, but my roots are sick",
  "the rain has stopped; my roots are slowly drying out",
  "very tired, would love water today",
  "a little thirsty, but my roots are sick",
  "my roots are sick from too much water; let the soil dry",
  "the soil is draining; let it dry a little",
  "a little thirsty; my roots are still mending",
  "roots recovering; may look worse before better",
  "too much food; a deep drink will flush it",
  "my bed is already rich",
  "thirsty; a few lower leaves yellowing",
  "recovering; new leaves will replace the yellow ones",
  "drooping in the afternoon heat",
  "a little thirsty",
  "in bloom; a smaller second-chance flower",
  "in bloom",
  "my petals are opening",
  "my petals will finish opening with the morning light",
  "my petals will finish opening at dusk",
  "my bud will open with the morning light",
  "my bud will open with the morning light; a smaller flower this time",
  "my bud will open at dusk",
  "my bud will open at dusk; a smaller flower this time",
  "ready for a drink",
  "growing slowly in the shade",
  "a second-chance sprout; my flower will be smaller",
  "happy",
] as const;
export type PlantLine = (typeof PLANT_LINES)[number];
/**
 * "unwell" from the hour the roots start to rot (the dose past the infection lag), or while health is very low for any
 * reason but thirst; then "soggy" (a soaked bed), "thirsty" and "blooming", in that order.
 */
export type PlantMood = "resting" | "unwell" | "blooming" | "soggy" | "thirsty" | "content";
/**
 * "damp": the UI asks "the soil is still damp, water anyway?" before a can. "ready": a gentle "ready for a drink" cue;
 * "thirsty": a stronger thirst cue. ready and thirsty are the plant asking for water, and a player who waters only then
 * keeps the bud on time. ready never shows together with damp.
 */
export type CanAdvice = "damp" | "ok" | "ready" | "thirsty";
/** "rich": the UI warns "my bed is already rich"; "ok" is no warning, not a promise of growth. */
export type FeedAdvice = "rich" | "ok";

/** What the renderer and the UI need. All 0..1 except size (0.5..1.1), headYaw (compass degrees) and the counts. */
export interface Visual {
  growth: number;
  bloom: number;
  health: number;
  moisture: number;
  scorch: number;
  droop: number;
  chlorosis: number;
  rot: number;
  pests: number;
  size: number;
  turgor: number;
  /** flower head: 0 until buds form (D 0.64), full size by D 0.95, smaller after stress while budding, capped after a replant */
  flower: number;
  puddle: 0 | 1;
  /** 0..5 */
  mushrooms: number;
  /** 0..3, at night */
  snails: number;
  aphids: number;
  mites: number;
  blackSpot: number;
  headYaw: number;
  petalDrop: number;
  glow: 0 | 1;
  mood: PlantMood;
  says: PlantLine;
  alive: boolean;
  canAdvice: CanAdvice;
  feedAdvice: FeedAdvice;
}

/** expectBloom(): when the bud should mature and the flower open if care stays good from now. */
export interface BloomForecast {
  ripeH: number;
  bloomH: number;
  /** bloom, in days after planting; null when it would not bloom within 90 days */
  days: number | null;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function clamp01(x: number): number { return clamp(x, 0, 1); }
function smooth(a: number, b: number, x: number): number { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function Wx(theta: number, Z: number): number { return 1000 * theta * Z; }
export function hodOf(h: number): number { return ((h % 24) + 24) % 24; }
function Bpot(sp: SimSpecies): number { return TWIN[sp.id].Bpot; }
/** The ideal twin's biomass (g) at development D. */
export function Bideal(sp: SimSpecies, D: number): number {
  const tab = TWIN[sp.id].tab, x = clamp(D, 0, 1) * 20, i = Math.min(19, Math.floor(x));
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}
/**
 * Thermal time of one hour, degC.d: linear from Tb to the lower optimum Tlo, a plateau to Topt, linear decline to Tmax.
 * On the plateau a day is worth (Tlo - Tb) degC.d, so TT / (Tlo - Tb) is the number of optimal days to a mature bud.
 */
export function ttHour(sp: SimSpecies, T: number): number {
  const r = T <= sp.Tb ? 0 : T < sp.Tlo ? (T - sp.Tb) / (sp.Tlo - sp.Tb) : T <= sp.Topt ? 1
    : Math.max(0, (sp.Tmax - T) / (sp.Tmax - sp.Topt));
  return r * (sp.Tlo - sp.Tb) / 24;
}
function fTg(sp: SimSpecies, T: number): number { // growth temperature trapezoid
  if (T <= sp.Tb || T >= sp.Tmax) return 0;
  if (T < sp.Topt - 4) return (T - sp.Tb) / (sp.Topt - 4 - sp.Tb);
  if (T <= sp.Topt + 2) return 1;
  return (sp.Tmax - T) / (sp.Tmax - sp.Topt - 2);
}
/** Root-zone volumetric water content. */
export function thetaOf(s: PlantState): number { return s.W / (1000 * s.Zr); }
/** Root-zone depletion share: 0 at field capacity, 1 at the wilting point. */
export function fOf(s: PlantState): number { const fc = Wx(BED.tfc, s.Zr), wp = Wx(BED.twp, s.Zr); return Math.max(0, fc - s.W) / (fc - wp); }
export function leafArea(s: PlantState, sp: SimSpecies): number {
  const leafFrac = s.D < 0.64 ? 0.55 : 0.55 - 0.15 * (s.D - 0.64) / 0.36;   // the flower takes the rest
  return sp.SLA * leafFrac * s.B * (1 - 0.7 * Math.min(1, s.Dw + s.Ds)) * (1 - 0.5 * s.Sc) * (1 - 0.5 * s.Dpest);
}
/** Root-zone mineral N, mg/kg. */
export function soilN(s: PlantState): number { return s.Ns / (BED.rho * BED.A * s.Zr); }
/** A feed adds no growth once the plant is N-sufficient (fN = 1 at NNI >= 0.9) and the bed still holds plenty. */
export function nRich(s: PlantState): boolean { return s.NNI >= 0.9 && soilN(s) >= BED.Nrich; }
/** Rose, sundrop, magnolia, marigold, the Island Bloom and the Pink Lily open with the morning light; Night Jasmine at dusk. */
export function opensInMorning(sp: SimSpecies): boolean { return sp.openHod < 12; }
/**
 * The petals of a mature bud open only in their own part of the day: a morning flower from first light to duskH, Night
 * Jasmine from dusk to dawnH. A wilted bud that is still opening when its window closes waits for the next one.
 */
export function openWindow(sp: SimSpecies, hod: number): boolean {
  return opensInMorning(sp) ? hod >= sp.openHod && hod < BED.duskH : hod >= sp.openHod || hod < BED.dawnH;
}

/** cleanWx's last-resort values for a field with no usable value this hour or the previous one. */
export const WX_FALLBACK = Object.freeze({ T: 22, RH: 75, P: 0, SW: 0, ET0: 0, U: 5 });
function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
/**
 * Makes a weather row safe to step. Rows come from a live API and a catch-up replay, and a field that is not a finite
 * number would poison the state for good (one NaN stays in W, D and B, and the plant then never blooms or dies). So a
 * missing or non-finite T, RH, SW, ET0 or U falls back to prev (the previous hour, when the caller has it) and then to
 * WX_FALLBACK; rain falls back to none; soil temperature to the air temperature; isDay to whether the sun is up (SW > 0).
 * RH is clamped to 0..100 and P, SW, ET0 and U are floored at 0; nothing else is range-checked (an absurd but finite T or
 * SW passes through), so weather.ts still validates rows before they are stored. step() runs every row through this
 * with no prev, exactly as the prototype does.
 */
export function cleanWx(w?: LooseWeather | null, prev?: LooseWeather | null): HourWeather {
  const a: LooseWeather = w || {}, b: LooseWeather = prev || {};
  const T = isNum(a.T) ? a.T : isNum(b.T) ? b.T : WX_FALLBACK.T;
  const RH = clamp(isNum(a.RH) ? a.RH : isNum(b.RH) ? b.RH : WX_FALLBACK.RH, 0, 100);
  const P = isNum(a.P) ? Math.max(0, a.P) : 0;
  const SW = Math.max(0, isNum(a.SW) ? a.SW : isNum(b.SW) ? b.SW : 0);
  const ET0 = Math.max(0, isNum(a.ET0) ? a.ET0 : isNum(b.ET0) ? b.ET0 : 0);
  const U = Math.max(0, isNum(a.U) ? a.U : isNum(b.U) ? b.U : WX_FALLBACK.U);
  const Ts = isNum(a.Ts) ? a.Ts : T;
  // the prototype keeps a boolean or numeric isDay as given; only its truthiness is ever read, so 0 | 1 is the same
  const day = typeof a.isDay === "boolean" || isNum(a.isDay) ? !!a.isDay : SW > 0;
  return { T, RH, P, SW, ET0, U, Ts, isDay: day ? 1 : 0 };
}

/**
 * Development rate as a share of the stress-free rate. A sustained drought signal (aba: an ABA-like stress hormone, 0..1)
 * slows it most, but only once it passes aba0: a meristem rides out a dry afternoon (the signal peaks and fades within the
 * day) and is held back by a deficit that lasts, such as a dry weekend or a can every few days. Drought injury, a heavy
 * pest load (light grazing below pest0 does not delay flowering), nitrogen shortage and a plant stunted below its ideal
 * twin slow it further (the last only a little: a clearly stunted plant flowers later, a cloudy fortnight hardly delays it).
 */
export function devFactor(s: PlantState, sp: SimSpecies, fN: number): number {
  return (1 - BED.devA * clamp01((s.aba - BED.aba0) / (1 - BED.aba0))) * (1 - BED.devInj * Math.min(1, s.Dw + s.Ds))
    * (1 - BED.pestDev * clamp01((s.Dpest - BED.pest0) / (0.6 - BED.pest0)))
    * (0.7 + 0.3 * fN) * (0.9 + 0.1 * clamp01(s.B / Bideal(sp, s.D)));
}
/**
 * The drought signal: roots in drying soil start it as depletion passes abaF0 (0.35: at or before the point where the
 * stomata start to close, p = 0.35-0.5) and it is full just past p; sick or salted roots start it in wet soil. It builds
 * within hours and fades over about a day after a good drink. Only its part above aba0 slows the bud (devFactor), so a dry
 * afternoon under good care costs almost nothing while a dry weekend costs about half a day to a day.
 */
export function abaSignal(sp: SimSpecies, f: number, KsRoot: number, KsSalt: number): number {
  return Math.max(smooth(BED.abaF0, sp.p + BED.abaDp, f), 1 - KsRoot * KsSalt);
}

/**
 * A fresh seed in a bed watered at planting. plantedAtIndex is the game hour it goes in (any hour: planting never closes).
 *
 * "Not yet" marks sit below the planting hour, so they never collide with a real hour: -1 (and -99 for the last can and
 * feed, -1 for the last bud-drop day) as in the prototype for a planting on or after 10 Nov, and further back for a
 * planting before it, whose real hours are negative. Every check of a mark compares it with plantedH, never with 0.
 */
export function createPlant(speciesId: SoilSpeciesId, plantedAtIndex: number, owner?: string | null): PlantState {
  const none = Math.min(-1, plantedAtIndex - 1);
  const never = Math.min(-99, plantedAtIndex - 99);
  return {
    v: SIM_VERSION, sp: speciesId, owner: owner == null ? null : owner, h: plantedAtIndex, plantedH: plantedAtIndex,
    hod: hodOf(plantedAtIndex), alive: true, gen: 1, fairyUsed: false, diedH: none,
    W: Wx(BED.tfc, BED.Zr0), L: Wx(BED.tfc, BED.Zbed - BED.Zr0), Zr: BED.Zr0, turgor: 1,   // bed watered at planting
    Dw: 0, Ds: 0, Dd: 0, Qd: 0, Qc: 0, Qr: 0, O: 0, R: 0, Sf: 0, Dsalt: 0, Ns: BED.N0 * BED.rho * BED.A * BED.Zr0, Np: 45 * BED.B0,
    B: BED.B0, D: 0, fDev: 1, aba: 0, Sc: 0, budS: 0, op: 0, ripeH: none, bloomH: none,
    shade: false, cover: false, shadeH: 0, naiveH: 0,
    Ps: 0, Pa: 0, Pm: 0, Dpest: 0, M: 0, Lw: 0, BS: 0,
    daySpr: 0, givers: [], budDropDay: Math.min(-1, Math.floor(plantedAtIndex / 24) - 1), glowH: 0, richH: 0, lastCanH: never, lastFeedH: never,
    cap: 1,
    dryH: 99,
    wR: 0, wC: 0,
    wCx: 0,
    cP: 0, cI: 0, cET: 0, cDP: 0, cRO: 0, cMag: 0,
    f: 0, Kse: 1, NNI: 1, EC: 0, Tleaf: 0,
  };
}

// ---- step --------------------------------------------------------------------------------------------------------------

const EV_ORDER: Readonly<Record<string, number>> = { revive: 0, replant: 1, shade: 2, cover: 2, feed: 3, water: 4, sprinkle: 5, tend: 6, talk: 7 };
// Events arrive from the network, so step() reads them as untyped records and checks every field it uses.
interface LooseEvent { kind?: unknown; amount?: unknown; actor?: unknown; id?: unknown }
function ord(e: LooseEvent): number {
  return typeof e.kind === "string" && Object.prototype.hasOwnProperty.call(EV_ORDER, e.kind) ? EV_ORDER[e.kind] : 9;
}
// Numeric ids order events of the same rank; anything else keeps the arrival order (the sort is stable).
function idDiff(a: LooseEvent, b: LooseEvent): number {
  const d = Number(a.id || 0) - Number(b.id || 0);
  return Number.isNaN(d) ? 0 : d;
}
function isOnOff(a: unknown): boolean { return a === 0 || a === 1 || a === true || a === false; }

/**
 * Steps one hour. hour.h must equal state.h (replay.ts guarantees contiguous hours; step() does not check). The weather
 * row goes through cleanWx first. Events are validated here (the payload is never trusted): unknown kinds, a shade or
 * cover without an explicit on/off, a sprinkle without an actor or from the owner, and cans or feeds inside their rate
 * limits are ignored. Returns a new state.
 */
export function step(state: PlantState, hour: HourInput, events?: readonly SimEvent[] | null, sp?: SimSpecies | null): PlantState {
  sp = sp || SIM_SPECIES[state.sp];
  let s: PlantState = { ...state, givers: state.givers.slice() };
  const w = cleanWx(hour.wx, null), h = hour.h, hod = hodOf(h);
  if (h < s.plantedH) return s;
  let Zr = s.Zr, Wfc = Wx(BED.tfc, Zr), Wwp = Wx(BED.twp, Zr), Wsat = Wx(BED.ts, Zr), Wan = Wx(BED.tanox, Zr);
  let TAW = Wfc - Wwp;
  const day = Math.floor(h / 24);

  // 1. midnight IST: reset the daily sprinkle cap
  if (hod === 0 && h > s.plantedH) { s.daySpr = 0; s.givers = []; }

  // 2. events
  if (s.glowH > 0) s.glowH--;
  if (s.richH > 0) s.richH--;
  let I = 0, Isp = 0, leafWet = false;
  const seen = new Set<string>();
  const ev = ((events || []) as readonly LooseEvent[]).slice().sort((a, b) => (ord(a) - ord(b)) || idDiff(a, b));
  for (const e of ev) {
    const k = e.kind;
    if (e.id != null) { const key = String(e.id); if (seen.has(key)) continue; seen.add(key); }   // idempotent retries
    if (k === "revive" && !s.alive && !s.fairyUsed) {
      s.cMag += Wfc - s.W; s.W = Wfc;                                        // Fairy Dust water is logged as magic
      s.alive = true; s.fairyUsed = true; s.Dw = s.Ds = s.R = s.O = s.Qd = s.Qc = s.Qr = s.wCx = s.Dsalt = s.BS = 0;
      s.Ps = s.Pa = s.Pm = s.Dpest = 0; s.Sc *= 0.5; s.Sf = 0; s.turgor = 0.5; s.aba = 0;
      s.B = Math.max(s.B, 0.6 * Bideal(sp, s.D));
    } else if (k === "replant" && !s.alive && s.fairyUsed) {                // at any hour: planting never closes
      const dz = s.Zr - BED.Zr0;
      const keep = { fairyUsed: true, gen: s.gen + 1, owner: s.owner, W: s.W * BED.Zr0 / s.Zr,
        L: s.L + s.W * dz / s.Zr, cP: s.cP, cI: s.cI, cET: s.cET, cDP: s.cDP, cRO: s.cRO, cMag: s.cMag, lastFeedH: s.lastFeedH,
        wR: s.wR, wC: s.wC, wCx: s.wCx, Qd: s.Qd, Qc: s.Qc, Qr: s.Qr }; // the bed remembers its water; the dose restarts with the new roots
      s = { ...createPlant(sp.id, h, s.owner), ...keep };                    // shed root-zone soil returns to the lower bed
      // a second chance, gentle but not free: a sprout (past germination, about a day ahead of a seed) watered in, whose
      // flower will be smaller
      s.D = BED.sproutD; s.B = Bideal(sp, BED.sproutD); s.Np = 45 * s.B; s.cap = BED.replantCap;
      I += BED.can; s.lastCanH = h;
      Zr = s.Zr; Wfc = Wx(BED.tfc, Zr); Wwp = Wx(BED.twp, Zr); Wsat = Wx(BED.ts, Zr); Wan = Wx(BED.tanox, Zr); TAW = Wfc - Wwp;
    } else if ((k === "shade" || k === "cover") && isOnOff(e.amount)) {
      const on = !!e.amount;
      if (k === "cover") s.cover = on;
      else { if (!on && s.shade && s.shadeH >= 48) s.naiveH = 72; if (!on) s.shadeH = 0; s.shade = on; } // sun-naive leaves
    } else if (k === "feed" && s.alive && h - s.lastFeedH >= BED.feedGapH) {
      if (nRich(s)) s.richH = BED.richH;                                      // honest: this feed adds salts, not growth
      s.Ns += BED.feedN; s.Sf += BED.feedSalt; s.lastFeedH = h;
    } else if (k === "water" && h - s.lastCanH >= BED.canGapH) {
      I += BED.can; s.lastCanH = h;                                           // always exactly one can, whatever amount says
    } else if (k === "sprinkle" && typeof e.actor === "string" && e.actor !== s.owner && s.givers.indexOf(e.actor) < 0) {
      s.givers.push(e.actor); s.daySpr++;
      if (s.daySpr <= BED.sprinkleCap) { Isp += BED.sprinkle; leafWet = true; } // extras are visual wishes
    }
    else if (k === "tend") { s.Ps *= 0.1; s.Pa *= 0.1; s.Pm *= 0.1; }
    else if (k === "talk") s.glowH = 1;
  }

  // 3-4. water in; root zone drains into the lower bed (fast above theta_anox, slow to FC); lower bed drains to the ground
  const Pin = s.cover ? 0.1 * w.P : w.P, kdr = 1 - Math.pow(1 - BED.tau, 1 / 24);
  let W = s.W + Pin + I, L = s.L, q = 0, DP = 0, RO = 0;
  const Lz = BED.Zbed - Zr;
  if (W > Wan) { q = Math.min(W - Wan, BED.Ksat); W -= q; }
  if (W > Wfc) { const sl = (W - Wfc) * kdr; W -= sl; q += sl; }
  L += q;
  if (L > Wx(BED.tanox, Lz)) { DP = Math.min(L - Wx(BED.tanox, Lz), BED.Ksat); L -= DP; }
  if (L > Wx(BED.tfc, Lz)) { const ls = (L - Wx(BED.tfc, Lz)) * kdr; L -= ls; DP += ls; }
  let up = 0;
  if (L > Wx(BED.ts, Lz)) { up = L - Wx(BED.ts, Lz); W += up; L = Wx(BED.ts, Lz); }  // perched water pushes back up
  if (W > Wsat) { RO = W - Wsat; W = Wsat; }                                  // runs off over the bed edge
  if (q > 0) { const lf = W / (W + q); s.Sf *= lf; s.Ns *= lf; }             // nitrate and salts leach with drainage
  // a sprinkle (0.12 L) wets the leaves and the top centimetre: the root zone keeps it only up to field capacity (it never
  // percolates) and the rest evaporates from leaves and surface, so a crowd of friends cannot soak or flush a bed
  const Ikeep = Math.min(Isp, Math.max(0, Wfc - W));
  W += Ikeep;
  s.cP += Pin; s.cI += I + Isp; s.cDP += DP; s.cRO += RO; s.cET += Isp - Ikeep;
  const km = Math.exp(-1 / BED.tauMem); s.wR = s.wR * km + Pin; s.wC = s.wC * km + I + Ikeep;
  s.dryH = w.P >= 0.1 ? 0 : Math.min(99, s.dryH + 1);

  // 5. stress
  const f = Math.max(0, Wfc - W) / TAW;
  const Ks = f <= sp.p ? 1 : Math.max(0, (1 - f) / (1 - sp.p));
  const KsRoot = (1 - 0.8 * Math.min(1, s.R)) * (1 - 0.3 * clamp01((s.O - BED.Olag) / BED.Olag)); // sick roots wilt in wet soil
  const EC = 1.4 * (BED.Sbg + s.Sf) / (0.1 * W);
  const KsSalt = clamp01(1 - 0.12 * (EC - 2.6));
  const Kse = s.alive ? Ks * KsRoot * KsSalt : 0;

  // 6. ET = bare-soil evaporation (species-independent, FAO-56 two-stage) + transpiration (leaf area x Kse)
  const LAI = s.alive ? leafArea(s, sp) / BED.A : 0, E0 = w.ET0 * (s.shade ? 0.65 : 1) * (s.cover ? 0.8 : 1);
  const Dr = Wfc - W, REW = BED.REWf * TAW, TEW = Wfc - 0.85 * Wwp;
  const Kr = Dr <= REW ? 1 : Math.max(0, (TEW - Dr) / (TEW - REW));
  const ET = BED.Ke * Kr * Math.exp(-0.5 * LAI) * E0 + BED.Kcb * (1 - Math.exp(-0.7 * LAI)) * Kse * E0;
  const W1 = Math.max(0.85 * Wwp, W - ET); s.cET += W - W1; W = W1;
  s.W = W; s.L = L; s.f = f; s.Kse = Kse; s.EC = EC;
  s.h = h + 1; s.hod = hodOf(h + 1);
  if (s.shade) s.shadeH++;
  if (s.naiveH > 0) s.naiveH--;
  const theta = W / (1000 * Zr), wet = theta >= 0.33 || Pin > 0.2;
  s.M += ((wet ? 1 : 0) - s.M) / 24;                                          // mushrooms (harmless)
  // Damping-off runs on the water the bed has to shed. The flush = the water drained through the root zone over about the
  // last day (mm/day, 24 h memory). A free-draining bed only stays above field capacity, with free water in its pores for
  // Pythium-type zoospores to swim and spread in, while more water arrives than the plant and the sun can use. The dose O
  // builds while Qd > Qt (more than about a can a day beyond what the bed loses) and decays once the flushing stops. A can
  // at 09:00 or at 21:00 sheds the same water by the next day, so the clock does not depend on the hour of the can.
  // The flush is split by where the water came from (the 12 h rain and care memories): Qc from cans and sprinkles, Qr from
  // rain. Rain counts in full only up to Qrmax, just below Qt: damping-off strikes at the stem collar, where a can is
  // poured, while rain falls on the whole bed and, once the bed is at its drained limit, passes through or runs off the
  // crowned surface. That is also the agreed game rule: rain alone never builds a rot dose; cans on a rain-soaked bed do.
  // The care share never counts more water than the cans supplied: it is capped by wCx, the care water still free to drain
  // (a can's water above field capacity, less what has drained already); care water the soil has soaked up can no longer
  // drain, so wCx never exceeds the bed's water above field capacity. Without the cap, a can at 18:00 followed by a night
  // of heavy rain kept most of the rain's flush on the care side (the 12 h memories still favoured the can) and counted
  // several cans' worth of care water; now the rain that follows flushes on as rain.
  // Soil temperature acts once, on the infection rate.
  const fT = Math.pow(BED.Q10, (w.Ts - 25) / 10);
  const qn = 24 * Math.max(0, q - up), kq = 1 - Math.exp(-1 / BED.tauQ), wm = s.wR + s.wC, cs = wm > 1e-9 ? s.wC / wm : 1;
  const qc = Math.min(qn * cs, 24 * (s.wCx + I));
  s.wCx = Math.max(0, Math.min(s.wCx + I - qc / 24, W - Wfc));
  s.Qc += (qc - s.Qc) * kq; s.Qr += (qn - qc - s.Qr) * kq;
  s.Qd = s.Qc + Math.min(s.Qr, BED.Qrmax);
  s.O = s.Qd >= BED.Qt ? Math.min(BED.Ocap, s.O + Math.min(1, (s.Qd - BED.Qt) / BED.Qs))
    : s.O * Math.exp(-(BED.Qt - s.Qd) / BED.Qt / BED.tauO);
  if (!s.alive) { s.turgor += (0 - s.turgor) * 0.1; return s; }

  // 7. turgor: afternoon droop, overnight recovery (tau 3.5 h); soft species flag at midday as the soil dries
  const dem = Math.min(1, E0 / 0.5);
  const tgt = Math.pow(Kse, 0.4 + 0.6 * dem) * (1 - sp.wilt * dem * smooth(0.2, sp.p + 0.1, f));
  s.turgor += (tgt - s.turgor) * 0.249;

  // 8. scorch, irreversible: heat (leaf energy balance) + desiccation (leaf-edge browning in sun on dry soil)
  const sw = w.SW * (s.shade ? 0.5 : 1) * (s.cover ? 0.85 : 1);
  const u = Math.max(0.2, 0.4 * w.U / 3.6), ra = 150 * Math.sqrt(sp.dLeaf / u);
  const Tleaf = w.T + 0.5 * sw * (1 - 0.8 * Kse) * ra / 1200;
  const vpd = 0.6108 * Math.exp(17.27 * w.T / (w.T + 237.3)) * (1 - w.RH / 100);
  s.Tleaf = Tleaf;
  s.Sc = Math.min(1, s.Sc + 0.03 * Math.max(0, Tleaf - sp.Tcrit + (s.naiveH > 0 ? 3 : 0))
    + (1 - s.Sc) * BED.kDes * clamp01((f - 0.6) / 0.4) * sw / 1000 * Math.min(2, vpd));

  // 9. damage: drought injury (half reversible wilting injury, half senescence), damping-off, salt burn
  if (f > BED.fSen) {
    const dd = (BED.kD / sp.tolD) * Math.min(1.5, (f - BED.fSen) / BED.fSpan) * (0.25 + 0.75 * Math.min(1, E0 / 0.3));
    s.Dw += (1 - BED.sFrac) * dd; s.Ds += BED.sFrac * dd;
  } else if (f <= sp.p) s.Dw = Math.max(0, s.Dw - BED.rDw / 24);
  if (s.O > BED.Olag) s.R += (BED.kR / sp.tolW) * (s.O - BED.Olag) / BED.Olag * fT; // O <= Ocap: at most 2 kR
  s.Dsalt = Math.min(1, s.Dsalt + 0.01 * Math.min(2, Math.max(0, EC - 3))); s.Sf *= 1 - 0.1 / 24;

  // pests: logistic + immigration; damage capped so pests never kill alone
  const mass = BED.rho * BED.A * Zr, NNI0 = s.Np / (45 * s.B);
  if (!w.isDay && w.RH >= 90 && theta >= 0.28 && w.T >= 10 && w.U < 15) s.Ps += 0.03 + 0.15 * s.Ps * (1 - s.Ps);
  else s.Ps *= 0.98;
  if (w.T >= 18 && w.T <= 30 && w.RH < 75 && w.P === 0) s.Pa += 0.002 + 0.01 * (NNI0 > 1.05 && s.Ns / mass > 30 ? 2 : 1) * s.Pa * (1 - s.Pa);
  if (Pin > 2) s.Pa *= 0.7;
  const mi = sp.mites || 0;
  if (w.T >= 27 && w.RH <= 55 && Kse < 0.8) s.Pm += mi * (0.002 + 0.0096 * s.Pm * (1 - s.Pm));
  else if (w.RH >= 80 || Pin > 0.1) s.Pm *= 0.98;
  s.Ps = clamp01(s.Ps); s.Pa = clamp01(s.Pa); s.Pm = clamp01(s.Pm);
  s.Dpest = Math.min(0.6, s.Dpest + 0.004 * s.Ps + 0.002 * s.Pa + 0.003 * s.Pm);
  if (sp.blackSpot) {
    const lw = Pin > 0.1 || w.RH >= 95 || leafWet;
    s.Lw = lw ? s.Lw + 1 : 0;
    if (s.Lw >= 7 && w.T >= 10 && w.T <= 27) s.BS = Math.min(1, s.BS + 0.01);
  }

  // 10. nitrogen in real units (mg): mineralisation, uptake to a luxury cap of 54 mg/g, nitrogen nutrition index
  s.Ns += BED.Nmin * mass / 24;
  const upN = Math.min(0.01 * s.Ns * Kse, Math.max(0, 54 * s.B - s.Np));
  s.Ns -= upN; s.Np += upN;
  const NNI = s.Np / (45 * s.B), fN = clamp01((NNI - 0.5) / 0.4);
  s.NNI = NNI;

  // 11. growth (Monteith); new leaves and roots dilute old damage (yellow leaves, lesions, rotted roots do not heal)
  const Ipar = 0.5 * sw * 0.0036 * BED.A * (1 - Math.exp(-0.8 * LAI));
  const dB = s.D < 0.05 ? 0 : sp.RUE * (s.shade ? 1.15 : 1) * Ipar * fTg(sp, w.T) * fN * Kse;
  const g = s.B / (s.B + dB);
  s.Sc *= g; s.Ds *= g; s.BS *= g; s.Dsalt *= g; s.Dpest *= g; s.B += dB;
  s.R *= Math.pow(g, 1 - clamp01(s.O / BED.Olag));                           // new roots in a soaked, infested bed rot too
  const Zn = BED.Zr0 + (sp.Zrmax - BED.Zr0) * Math.min(1, s.B / Bpot(sp));
  if (Zn > s.Zr) {                                                            // roots grow into the lower bed and take its water
    const dzr = Zn - s.Zr, mv = s.L * dzr / (BED.Zbed - s.Zr);
    s.W += mv; s.L -= mv; s.Ns += BED.N0 * BED.rho * BED.A * dzr; s.Zr = Zn;
  }

  // 12. development in thermal time (flat across the optimum plateau), slowed by stress; germination needs moist soil
  const sig = abaSignal(sp, f, KsRoot, KsSalt);
  s.aba += (sig - s.aba) * (1 - Math.exp(-1 / (sig > s.aba ? BED.abaUp : BED.abaRec)));
  s.fDev = devFactor(s, sp, fN);
  const dD = s.D >= 0.05 || f <= 0.5 ? ttHour(sp, w.T) * s.fDev / sp.TT : 0;
  if (s.D >= 0.64 && s.D < 0.85) s.budS += BED.budK * s.aba * dD / 0.21;    // the drought signal while the bud forms costs flower size
  s.D = Math.min(1, s.D + dD);
  if (sp.budDrop && f > 0.7 && s.D >= 0.64 && s.D < 0.85 && s.budDropDay !== day) { s.D -= 0.04; s.budDropDay = day; }
  if (s.D >= 1) {          // a mature bud opens at its natural hour (first light, or dusk); petals need turgor to expand
    if (s.ripeH < s.plantedH) s.ripeH = h + 1;
    if (s.op < 1 && openWindow(sp, hod) && (s.op > 0 || hod === sp.openHod)) s.op = Math.min(1, s.op + smooth(0.3, 0.7, s.turgor) / sp.openDur);
    if (s.op >= 0.5 && s.bloomH < s.plantedH) s.bloomH = h + 1;
  }

  // 13. death
  s.Dd = s.Dw + s.Ds;
  if (s.Dd + s.R >= 1) { s.alive = false; s.diedH = h + 1; }
  return s;
}

// ---- bloom forecast ---------------------------------------------------------------------------------------------------

/**
 * Mean hourly temperature at hour k: climT (mean of past years by h), extended past its end by the mean daily cycle of
 * its last 7 days, so a forecast for a late planting never runs off the table, and before its start (a planting before
 * 10 Nov) by the mean daily cycle of its first 7 days.
 */
export function climAt(climT: readonly number[], k: number): number {
  const n = climT.length;
  if (k < 0) {
    const hh = hodOf(k);
    let t = 0, m = 0;
    for (let j = 0; j < 7; j++) { const i = 24 * j + hh; if (i < n) { t += climT[i]; m++; } }
    return m ? t / m : climT[0];
  }
  if (k < n) return climT[k];
  const hh = (k - n) % 24;
  let t = 0, m = 0;
  for (let j = 1; j <= 7; j++) { const i = n - 24 * j + hh; if (i >= 0) { t += climT[i]; m++; } }
  return m ? t / m : climT[n - 1];
}

/**
 * When the bud should mature and the flower open if care stays good from now: mean weather (climT, see climate.ts) and
 * development at expDev of the stress-free rate, which is what good care achieves on average; a single plant can be a
 * day either side. The petals open only inside the flower's own part of the day, as in step(). Returns null when the
 * plant is not alive.
 */
export function expectBloom(s: PlantState, sp: SimSpecies | null | undefined, hour: { h: number; climT: readonly number[] }): BloomForecast | null {
  sp = sp || SIM_SPECIES[s.sp];
  if (!s.alive) return null;
  let k = Math.max(hour.h, s.h), D = s.D, ripe = s.ripeH, op = s.op, bloom = s.bloomH;
  const lim = k + 24 * 90;
  for (; bloom < s.plantedH && k < lim; k++) {
    if (D < 1) { D += ttHour(sp, climAt(hour.climT, k)) * BED.expDev / sp.TT; if (D >= 1) { D = 1; ripe = k + 1; } }
    if (D >= 1 && openWindow(sp, hodOf(k)) && (op > 0 || hodOf(k) === sp.openHod)) { op += 1 / sp.openDur; if (op >= 0.5) bloom = k + 1; }
  }
  return { ripeH: ripe, bloomH: bloom, days: bloom < s.plantedH ? null : (bloom - s.plantedH) / 24 };
}

// ---- forecast hint ----------------------------------------------------------------------------------------------------

/** A forecast row as weather.ts's parseHourly() returns it ({ h, wx }); rainSoon() reads only wx.P. */
export interface ForecastRow {
  readonly h: number;
  readonly wx?: { readonly P?: unknown } | null;
}

/** rainSoon(): is rain heavy enough to soak the bed due soon? */
export interface RainSoon {
  /** at least BED.soakMM (as much as a can) in the hours looked at: say "heavy rain tonight; skip the can", offer the cover */
  heavy: boolean;
  /** the rain due in those hours, mm, to 0.1 mm */
  mm: number;
  /** hours from fromH to the first hour with rain falling (P >= 0.1 mm, as dryH counts it), or null */
  startsInH: number | null;
}

/**
 * A forecast helper for the app; the model itself never reads a forecast. Is rain heavy enough to soak the bed by itself
 * (BED.soakMM) due in the next `hours` (BED.soonH) from game hour fromH? rows are forecast rows by game hour, in any order;
 * an hour with no row, or no usable P, counts as dry, and a repeated hour counts once (the last row). When heavy is true
 * the app says "heavy rain tonight; skip the can" and offers the rain cover: a can on a bed the rain is about to soak
 * counts as care water in the flush, and a long rain on top of it can rot the roots.
 */
export function rainSoon(rows: readonly (ForecastRow | null | undefined)[] | null | undefined, fromH: number, hours?: number | null): RainSoon {
  const n = isNum(hours) && hours >= 1 ? Math.floor(hours) : BED.soonH;
  const byK = new Map<number, number>();
  for (const r of rows ?? []) {
    const k = r && isNum(r.h) && isNum(fromH) ? r.h - fromH : -1;
    if (r && k >= 0 && k < n && k % 1 === 0) byK.set(k, r.wx && isNum(r.wx.P) ? Math.max(0, r.wx.P) : 0);
  }
  let mm = 0, first: number | null = null;
  for (const k of [...byK.keys()].sort((a, b) => a - b)) {
    const p = byK.get(k) as number;
    mm += p;
    if (first === null && p >= 0.1) first = k;
  }
  mm = Math.round(mm * 10) / 10;
  return { heavy: mm >= BED.soakMM, mm, startsInH: first };
}

// ---- renderer mapping -------------------------------------------------------------------------------------------------

function jasmineRhythm(t: number): number { // t = IST clock hour; opens at dusk (sunset ~17:50), drops at dawn
  if (t >= 17.5 && t < 19) return 0.15 + 0.85 * (t - 17.5) / 1.5;
  if (t >= 6 && t < 7.5) return 1 - 0.85 * (t - 6) / 1.5;
  return t >= 19 || t < 6 ? 1 : 0.15;
}
function pwl(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0])
    return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
  return pts[pts.length - 1][1];
}
const MOISTURE_PTS = [[0.12, 0], [0.228, 0.42], [0.30, 0.65], [0.38, 0.82], [0.48, 1]] as const;

/**
 * What the renderer and the UI show for a state. clock is the IST clock hour to draw at (defaults to the state's own
 * hour; a fractional hour animates the jasmine rhythm and the sundrop's head between steps).
 */
export function toVisual(s: PlantState, sp?: SimSpecies | null, clock?: number): Visual {
  sp = sp || SIM_SPECIES[s.sp];
  const t = clock === undefined ? s.hod : clock, D = s.D, theta = thetaOf(s), f = fOf(s), Dd = s.Dw + s.Ds;
  const growth = 0.9 * Math.min(D, 0.85) / 0.85 + 0.1 * Math.max(0, D - 0.85) / 0.15;
  const rhythm = sp.nightBloom ? jasmineRhythm(t) : 1, Q = clamp01(1 - 2 * s.budS);
  const bloom = s.alive ? smooth(0, 1, s.op) * rhythm * (0.55 + 0.45 * s.turgor) * (0.6 + 0.4 * Q) : 0;
  const nDef = clamp01((0.9 - s.NNI) / 0.4);
  // health reaches 0 only at death (Dd + R = 1); salt, pests, nitrogen and black spot scale what is left
  const health = s.alive ? Math.max(0.01, (1 - Dd - s.R) * (1 - 0.4 * s.Dsalt) * (1 - 0.3 * s.Dpest) * (1 - 0.25 * nDef) * (1 - 0.2 * s.BS)) : 0;
  const thirst = 1 - smooth(BED.TURG_LO, BED.TURG_HI, s.turgor);
  const sick = 1 - smooth(0.1, 0.45, health);
  const droop = s.alive ? clamp01(Math.max(0.9 * thirst, 0.75 * sick)) : 1;
  const rot = clamp01(Math.max(2 * s.R, (s.O - 2) / BED.Olag));   // a dark, water-soaked stem base from 5 dose hours
  const size = clamp(Math.cbrt(s.B / Bideal(sp, D)), 0.5, 1.1);
  const night = t >= 18 || t < 6, bloomNow = bloom > 0.5, dosing = s.O > 0.5 * BED.Olag;
  const building = s.Qd >= BED.Qt;                 // the bed is flushing hard enough to build a rot dose right now
  // soggy only while the bed is at field capacity or wetter: a bed drying below it no longer reads "soaked"
  const soggy = theta >= BED.tfc && (dosing || building || theta > BED.tanox), thirsty = f > 0.4 || (s.turgor < 0.85 && f > 0.3);
  const salty = s.EC > 3 || s.Dsalt > 0.15, byRain = s.wR > s.wC && s.wR >= 1;  // recent rain outweighs recent cans (12 h memory)
  const freshRain = byRain && !dosing && theta >= BED.thFresh;                    // a heavy shower that has not built a dose yet
  // a mature bud waits for its opening hour; once it starts, the petals open over openDur hours (slower when wilted)
  const budReady = D >= 1 && s.op === 0, opening = D >= 1 && s.op > 0 && s.op < 1, second = s.cap < 1;
  // The plant asks for a drink well before the drought signal starts (readyF 0.2 < abaF0 0.35). A sunny day dries a
  // seedling's small root zone by a quarter to a third of its available water, so asking only at real thirst (0.4) would
  // leave a player who waits for the cue with dry afternoons that slow the bud. In the morning the whole day's drying is
  // still ahead, so it asks as soon as the soil is no longer damp. Never while the can warns that the soil is still damp
  // (a bed still draining a rot dose, or still flushing hard enough to build one, counts as damp up to 0.3).
  const damp = f < BED.dampF || ((dosing || building) && f < 0.3);
  const ready = !damp && f > (t >= BED.readyAmFrom && t < BED.readyAmTo ? BED.readyAmF : BED.readyF);
  // the roots have started to rot: R rises from the hour the dose passes the infection lag, so the plant says so from that
  // hour on, before any damage shows. A plant whose roots are rotting never reads calm.
  const rotting = s.alive && s.O > BED.Olag;
  const danger = s.alive && (rotting || (health < 0.3 && !thirsty));
  // rotting roots, then a soaked bed, then real thirst outrank the blooming mood: a flower drowning or drying out must not
  // look serene
  const mood: PlantMood = !s.alive ? "resting" : danger ? "unwell" : soggy ? "soggy" : thirsty ? "thirsty" : bloomNow ? "blooming" : freshRain ? "soggy"
    : (Dd > 0.15 || night || salty) ? "resting" : "content";
  // Rain-soaked: reassure only while no rot dose builds; once the bed flushes hard enough to build one (Qd >= Qt), or the
  // dose is already up, suggest the cover while it rains, or in the first coverH hours after the rain only while the bed
  // is still flushing (the dose rising); a cover cannot take back water already in the bed. After that the plant says the
  // rain has stopped: still soaked while the bed keeps flushing, drying once the dose falls. Roots that are rotting or
  // damaged (R > 0.12) are named in every wet line, so a plant dying of rot never reads calm.
  const sickRoots = rotting || s.R > 0.12;
  const wet: PlantLine = !byRain ? (sickRoots ? "the soil is soaked and my roots are sick" : "the soil is soaked, let it breathe")
    : !dosing && !building ? (sickRoots ? "the rain soaked the soil; my roots are still mending" : "the rain soaked the soil; it will drain soon")
    : s.cover ? (sickRoots ? "the rain cover is on, but my roots are sick" : "the rain cover is on; my roots will slowly dry out")
    : s.dryH === 0 || (s.dryH < BED.coverH && building)
      ? (sickRoots ? "the rain keeps my sick roots wet; a rain cover would help" : "the rain keeps my roots wet; a rain cover would help")
    : building ? (sickRoots ? "the rain has stopped, but my roots are soaked and sick" : "the rain has stopped, but my roots are still soaked")
    : sickRoots ? "the rain has stopped, but my roots are sick" : "the rain has stopped; my roots are slowly drying out";
  const bud: PlantLine = opensInMorning(sp)
    ? (second ? "my bud will open with the morning light; a smaller flower this time" : "my bud will open with the morning light")
    : (second ? "my bud will open at dusk; a smaller flower this time" : "my bud will open at dusk");
  // a wilted bud still opening when its part of the day ends finishes in the next one
  const paused: PlantLine = opensInMorning(sp) ? "my petals will finish opening with the morning light" : "my petals will finish opening at dusk";
  // thirst outranks old root damage: a plant drying out says so, even while its roots are still mending
  const says: PlantLine = !s.alive ? "gone to sleep" : soggy || freshRain ? wet
    : Dd > 0.5 && f > 0.4 ? "very tired, would love water today"
    : rotting ? (f > 0.4 ? "a little thirsty, but my roots are sick" : "my roots are sick from too much water; let the soil dry")
    : (dosing || building) && f < BED.dampF ? "the soil is draining; let it dry a little"
    : s.R > 0.12 ? (f > 0.4 ? "a little thirsty; my roots are still mending" : "roots recovering; may look worse before better")
    : salty ? "too much food; a deep drink will flush it"
    : s.richH > 0 ? "my bed is already rich"
    : s.Ds > 0.075 ? (f > 0.4 ? "thirsty; a few lower leaves yellowing" : "recovering; new leaves will replace the yellow ones")
    : s.turgor < 0.9 && f > 0.3 ? "drooping in the afternoon heat" : f > 0.4 ? "a little thirsty"
    : bloomNow ? (second ? "in bloom; a smaller second-chance flower" : "in bloom")
    : opening ? (openWindow(sp, t) ? "my petals are opening" : paused) : budReady ? bud
    : ready ? "ready for a drink"
    : s.shade && !night ? "growing slowly in the shade" : second && s.bloomH < s.plantedH ? "a second-chance sprout; my flower will be smaller" : "happy";
  let yaw = 90;
  if (sp.id === "sundrop" && D < 0.85 && t >= 6 && t <= 18) yaw = 105 + (t - 6) * 12.5;
  return {
    growth: growth, bloom: bloom, health: health,
    moisture: pwl(theta, MOISTURE_PTS),
    scorch: clamp01(s.Sc + 0.6 * s.Dsalt), droop: droop,
    chlorosis: clamp01(Math.max(3 * s.Ds, nDef, 0.5 * s.Dsalt)), rot: rot,
    pests: clamp01(Math.max(s.Ps, s.Pa, s.Pm)),
    size: size, turgor: s.turgor,
    // flower head: 0 until buds form (D 0.64); the bud grows to full size by D 0.95; drought stress while the bud formed
    // makes it smaller, a stunted plant a little smaller (flower size is far less plastic than plant mass, so a cloudy
    // fortnight that halves the plant costs the flower about a tenth); a second-chance sprout's flower is capped at
    // replantCap. Nothing about the planting date enters.
    flower: !s.alive || D < 0.64 ? 0 : s.cap * (0.3 + 0.7 * smooth(0.64, 0.95, D)) * (0.6 + 0.4 * Q) * (0.8 + 0.2 * clamp01((size - 0.5) / 0.5)),
    puddle: theta > 0.38 ? 1 : 0, mushrooms: Math.round(5 * clamp01((s.M - 0.4) / 0.5)),
    snails: night ? Math.round(3 * s.Ps) : 0, aphids: s.Pa, mites: s.Pm, blackSpot: s.BS,
    headYaw: yaw, petalDrop: sp.nightBloom && s.op > 0 && t >= 6 && t < 7.5 ? (t - 6) / 1.5 : 0,
    glow: s.glowH > 0 ? 1 : 0, mood: mood, says: says, alive: s.alive,
    canAdvice: !s.alive ? "ok" : damp ? "damp" : thirsty ? "thirsty" : ready ? "ready" : "ok",
    feedAdvice: s.alive && nRich(s) ? "rich" : "ok",
  };
}
