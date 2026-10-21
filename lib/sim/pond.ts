// The Lotus model, POND_VERSION 1: a line-for-line TypeScript port of the frozen scratch prototype (pond-v1.js, the pond
// model the owner signed off as pond.js with four changes, integration/plan.md F1). One step() is one real hour of a sacred
// lotus (Nelumbo nucifera) raised from seed: first in a glass jar, then in a holeless lotus pot on the front shelf of a small
// stepped koi pond in its own courtyard in Bangalore. It sits beside the soil model (model.ts, SIM_VERSION 7), which carries
// the seven soil flowers, and keeps its own version: a change here bumps POND_VERSION and never touches them.
//
// The plant machinery is the soil model's family (radiation-use growth, thermal time slowed by stress, the drought signal,
// drought injury, nitrogen, aphids, the ideal twin, a dawn-opening flower), with the water of a pond:
//   * the pond: an oval of 1.30 m2 inside the coping, about 800 L at its fill line; an overflow notch 20 mm above the line
//     spills any extra, harmlessly. Rain, top-ups (15 L, a bucket) and friends' sprinkles come in; open water evaporates
//     at the pond's own water temperature (an equilibrium-temperature energy balance with the pond's heat capacity), the
//     standing leaves transpire, the notch overflows.
//   * the lotus pot: 40 cm across, 15 cm of heavy clay mud under 3 cm of pebbles, its rim 25 mm below the fill line. While
//     the pond stands above the rim the pot is part of the pond; below it the pot keeps its own puddle, which evaporates
//     and is drunk, and then its mud dries (the soil model's drought rules on 15 cm of mud).
//   * the jar: the seed waits in a glass of water. Only the owner freshens it, and the owner plants the seedling into its
//     pot with the next water action once its root and first leaf are out (moveReady). Stale water rots the seed.
//   * three young koi: "Tend the pond" gives them a pinch (counted at most once every koiGapH hours) and rinses aphids into
//     the pond. Hungry koi strip a seedling's floating leaves: until its standing leaves rise it cannot grow or develop (it
//     stalls, never dies of it); later they only nibble floating leaf. Their waste and leftover food turn the water green.
//     The koi never die.
//   * the flower opens at dawn on three days: days 1 and 2 close by the afternoon, day 3 opens widest and drops its petals
//     that evening, then the pod ripens; later flowers follow about every 13-14 days.
// Numbers marked [E] in the prototype are estimates; scratchpad lotus/v2/pond-model.md lists the sources behind the rest.
//
// Pure and deterministic: no Date, no Math.random, no module state, inputs never mutated, so a state is stored as JSON and
// stepped on any server, exactly as model.ts. The equations, their order and every constant match pond-v1.js; the parity
// test replays its golden file (__fixtures__/golden-pond-v1.json) to 1e-9. Change a number here only together with a new
// POND_VERSION and a regenerated golden file: in the scratch folder, change pond-v1.js (as pond-v2.js), rerun its studies
// (`node run.mjs <mode>` and `node checks.mjs`), then `node golden-pond.mjs` writes the golden file for this folder.
//
// "Not yet" hour marks (lastCanH, lastFeedH, lastKoiH, ripeH, bloomH, flH, movedH, diedH) start at POND_NONE (-1e6) and are
// compared against it, never against 0, so a planting at a negative hour (before 10 Nov: planting opened on 20 Oct)
// behaves like any other. The soil model keeps its own -1 / -99 marks.
//
// Hour index h counts whole hours from GAME_START (10 Nov 2026 00:00 IST), as model.ts. No runtime import from model.ts
// (types only): it keeps its own copies of the small helpers, as the prototype does.
import type { BloomForecast, CanAdvice, HourInput, HourWeather, LooseWeather, PlantMood, SimEvent, Visual as SoilVisual } from "./model";

export const POND_VERSION = 1;
/** "Not yet": an hour mark that has never been set. */
export const POND_NONE = -1e6;
const NONE = POND_NONE;

export const POND = Object.freeze({
  // pond (m, L)
  rx: 0.83, rz: 0.50, Vfill: 800, over: 0.020, coping: 0.05,
  // lotus pot (m): inner and outer radius, mud depth, stone layer and its pore share, stone top and rim relative to the fill line
  rPot: 0.20, rPotO: 0.215, dm: 0.15, peb: 0.03, phi: 0.4, stoneTop: -0.05, rimUp: 0.025,
  Kbot: 8, alb: 0.08, emis: 0.97, su: 0.45, windFn: 48, agit: 1.0,   // ground coupling W/m2K (walls and floor in the soil) [E]; grid->pond wind [E]
  thS: 0.50, thFC: 0.36, thWP: 0.22, rhoMud: 1300,   // clay mud
  REW: 10, KeMud: 1.10, pMud: 0.20,
  Kcb: 1.15, oasis: 1.2,
  can: 15, canGapH: 4, sprinkle: 0.12, sprinkleCap: 2, feedGapH: 48,   // a top-up is 15 L (a bucket) [E]; rate limits as the soil game
  koiGapH: 4,                       // a pinch at most every 4 h
  koiLag: 18, koiFull: 48,          // koi start to graze 18 h after their last pinch, fully hungry by 48 h [E]
  kGraze: 0.010,                    // leaf loss per hour to a seedling whose leaves all float, under fully hungry koi [E]
  grazeLethal: 1,                   // 1 = before its standing leaves a seedling is within the koi's reach (it stalls) [E]
  koiKills: 0,                      // 0 = a seedling stripped by hungry koi stalls until they are fed; 1 = it dies [E]
  koiEnd: 0.52,                     // the seedling is out of the koi's reach once D passes this (two standing leaves up) [E]
  grazeCap: 0.40,                   // once standing leaves are up, browsing takes at most 40% of the leaf [E]
  devG: 0,                          // browsing of an established plant costs leaf and growth, not development directly [E]
  devGy: 1.0,                       // a seedling stripped of its floating leaves stalls: development x (1 - browsing) while young [E]
  rGraze: 0.15,                     // per day: new leaves replace eaten ones while the koi are fed [E]
  koiBud: 0,                        // no bud nibbling: the bud rises on a spiny stalk out of reach
  koiGraze: 1,                      // 1 = koi can reach the lotus; 0 = a mesh guard keeps them off
  koiN: 5,                          // nutrient (algae index x L) from one pinch, its waste [proxy]
  tapN: 0.10,                       // nutrient per litre of tank/tap water [proxy]
  B0: 0.30,
  N0: 30, Nmin: 0.8, feedN: 152, Nrich: 10, richH: 4,
  Djar: 0.10, Daer: 0.40, Dbud: 0.64,
  burn: 0.15, burnM: 14, kBurnM: 0.0002,   // the salt-burn pile threshold scales with the pot's mud
  kD: 0.020, fSen: 0.35, fSpan: 0.40, sFrac: 0.5, rDw: 0.4,
  devA: 0.7, devInj: 0.2, aba0: 0.3, pest0: 0.1, pestDev: 0.3, abaUp: 3, abaRec: 20,
  abaF0: 0.10, abaDp: 0.05, budK: 0.4,
  devStunt: 0.25,
  kDes: 0.06,
  expDev: 0.985,
  replantCap: 0.7,
  readyMM: 10, thirstyMM: 18, fullMM: 9,    // "could use a top-up" 10 mm under the line; "low" at 18 mm (the rim is 25 mm down); a top-up would spill above +9 mm
  algaeGreen: 0.40,
  tabIdx: 10, nBg: 0.008,            // nBg: background release per litre a day (leaf litter, dust, the new pond's own) [proxy]
  potBound: 2.5,                    // a 40 cm pot lets the plant grow to about 2.5 times its first-bloom size [E]
  rootUp: 0.15, skim: 0.3, aphBud: 0.4,
  flMax: 4, reTT: 0.75,
  soonH: 12, soakMM: 10,
});
export type Pond = typeof POND;
/** The seed's jar: water volume (L), the clouding (microbial load) logistic, rot after a lag, a seedling slowed by foul water. */
export const JAR = Object.freeze({ V: 0.30, J0: 0.02, r25: 0.60, Q10: 2, cloudy: 0.5, lag: 24, kR: 0.011, haze: 0.2, sun: 0.003, slow: 0.5, alarm: 12 });

export interface PondSpecies {
  readonly id: "lotus";
  readonly name: string;
  readonly Tb: number;
  readonly Tlo: number;
  readonly Topt: number;
  readonly Tmax: number;
  /** thermal time from seed to a mature bud, degC.d of water temperature (game-tuned) */
  readonly TT: number;
  readonly TTreal: number | null;
  readonly RUE: number;
  readonly SLA: number;
  /** leaf share of the biomass before the bud */
  readonly leafF: number;
  readonly Tcrit: number;
  readonly dLeaf: number;
  readonly wilt: number;
  readonly tolD: number;
  /** aphid susceptibility */
  readonly aphid: number;
  /** leaf area at first bloom under ideal care, m2 (what the pond sees) */
  readonly LAbloom: number;
  /** the flower opens from openHod over openDur hours and closes from closeHod (days 1 and 2) */
  readonly openHod: number;
  readonly openDur: number;
  readonly closeHod: number;
  readonly truth: string;
}

export const POND_SPECIES: Readonly<{ lotus: PondSpecies }> = Object.freeze({
  lotus: Object.freeze<PondSpecies>({ id: "lotus", name: "Lotus", Tb: 8, Tlo: 17, Topt: 32, Tmax: 42, TT: 118.1, TTreal: null, RUE: 2.2, SLA: 0.025, leafF: 0.60, Tcrit: 45, dLeaf: 0.12, wilt: 0.50, tolD: 0.8, aphid: 1.5, LAbloom: 0.055, openHod: 4, openDur: 4, closeHod: 12,
    truth: "A lotus raised from seed rarely flowers in its first season, and even a planted rhizome takes six weeks to three months. Here it takes about two weeks." }),
});

/**
 * The lotus's ideal twin (as twin.ts for the soil flowers): its biomass (g) at D = 0, 0.05 .. 1 under ideal care in the mean weather
 * of 2023-25, fitted with TT by the prototype's calib.mjs. Copied verbatim from pond-v1.js.
 */
export const POND_TWIN = Object.freeze({
  lotus: Object.freeze({
    Bpot: 2.5905,
    tab: Object.freeze([0.3, 0.3, 0.3, 0.3567, 0.3672, 0.4517, 0.5093, 0.5243, 0.6363, 0.7383, 0.7655, 0.9269, 1.0372, 1.1201, 1.3722, 1.5356, 1.6613, 1.9505, 2.0895, 2.2802, 2.5905]),
  }),
});

// ---- state and outputs -----------------------------------------------------------------------------------------------

/** Everything the model remembers about one lotus. JSON-safe; stepPond() returns a new object. */
export interface PondState {
  /** POND_VERSION that produced this state */
  v: number;
  medium: "pond";
  sp: "lotus";
  owner: string | null;
  /** the next hour to step; the state describes the moment h */
  h: number;
  plantedH: number;
  hod: number;
  alive: boolean;
  gen: number;
  fairyUsed: boolean;
  diedH: number;
  /** 0 in the jar, 1 in its pot in the pond */
  stage: 0 | 1;
  /** the hour the owner planted it in its pot, or POND_NONE */
  movedH: number;
  /** jar: clouding 0..1 and hours it has been cloudy */
  Jm: number;
  Jo: number;
  /** pond water (L), the pot's own water when it stands alone (L), the pot's mud water (L) */
  Vp: number;
  Vq: number;
  Wm: number;
  /** water temperature now, this hour's mean, the 3-day mean, the 5-night mean of the coldest hour, the running night low */
  Tw: number;
  Tm: number;
  Tw3: number;
  Tn5: number;
  TnRun: number;
  /** air temperature, cloudiness 0..1, the day's soil temperature mean, algae 0..1 */
  Ta: number;
  cl: number;
  Ts24: number;
  Al: number;
  /** nutrient in the pond (algae index x L) and the lotus tabs in the pot's mud */
  Nw: number;
  Nm: number;
  /** hours since the koi's last pinch, the hour of it, pinches today */
  kH: number;
  lastKoiH: number;
  koiDay: number;
  B: number;
  D: number;
  dD: number;
  fDev: number;
  aba: number;
  turgor: number;
  /** the standing-leaf response to cool nights 0.4..1 */
  aer: number;
  Dw: number;
  Ds: number;
  Dd: number;
  /** koi browsing 0..1 */
  Dg: number;
  R: number;
  Sc: number;
  Ns: number;
  Np: number;
  NNI: number;
  Ps: number;
  Pa: number;
  Pm: number;
  Dpest: number;
  budS: number;
  op: number;
  ripeH: number;
  bloomH: number;
  cap: number;
  /** flowers so far, the hour the latest opened, the next bud's progress, the bud's light (sum and hours), most standing leaves */
  flN: number;
  flH: number;
  nb: number;
  bL: number;
  bN: number;
  aMax: number;
  shade: boolean;
  cover: boolean;
  shadeH: number;
  naiveH: number;
  daySpr: number;
  givers: string[];
  glowH: number;
  richH: number;
  burnH: number;
  lastCanH: number;
  lastFeedH: number;
  f: number;
  Kse: number;
  /** overflow at the notch this hour (L), koi browsing this hour */
  over: number;
  gz: number;
  /** cumulative water book (L): rain, care, evaporation, transpiration, overflow, magic, the mud soaked at a replant, jar changes */
  cP: number;
  cI: number;
  cE: number;
  cT: number;
  cO: number;
  cMag: number;
  cSet: number;
  cJ: number;
}

/** Every line the lotus can say, in the order toVisualPond() checks them. */
export const POND_LINES = [
  "gone to sleep",
  "my seed is rotting in murky water; fresh water, please",
  "my root and first leaf are out and my water is murky; plant me in my pot in the pond",
  "my root and first leaf are out; plant me in my pot in the pond",
  "my water has been cloudy for a while; fresh water, please",
  "that food clouded my water",
  "time for fresh water",
  "fresh water would be lovely",
  "my first root is showing",
  "a seed in clear water, waking up",
  "my pot has dried out; my leaves are crisping",
  "the water in my pot is gone; the mud is drying",
  "the koi keep eating my young leaves, so I cannot grow; feed them, please",
  "the pond has dropped below the rim of my pot; a top-up or two, please",
  "the koi have nibbled many of my floating leaves; they are hungry",
  "the koi are nibbling my young leaves; they are hungry",
  "the koi are nosing at my bud; they are hungry",
  "the pond is low",
  "that food was too strong for my young leaves",
  "my mud is already rich",
  "recovering; new leaves will replace the lost ones",
  "my petals are falling; my seed pod is ready",
  "my flower is at its widest; the petals fall this evening",
  "in bloom; a smaller second-chance flower",
  "in bloom again",
  "in bloom",
  "my flower closes in the afternoon and opens again before dawn",
  "my flower opens widest this morning",
  "my petals are opening",
  "my petals will finish opening at dawn",
  "my bud will open before dawn",
  "my bud will open before dawn; a smaller flower this time",
  "the koi are gulping at the surface this morning; the pond is too green",
  "the pond has turned green; go easy on the koi food",
  "I have settled into my pot in the pond",
  "aphids on my bud; wash them into the pond for the koi",
  "aphids on my leaves; wash them into the pond for the koi",
  "the koi are hungry",
  "my leaves are paling; a little food would help",
  "the pond could use a top-up",
  "the pond is turning a little green",
  "the koi have had plenty today; leftover food clouds the water",
  "growing slowly in the shade; I love full sun",
  "another bud is on its way",
  "my seed pod is ripening",
  "a second-chance seedling; my flower will be smaller",
  "happy",
] as const;
export type PondLine = (typeof POND_LINES)[number];
/** "hungry": the koi want a pinch; "ready": a pinch is welcome; "plenty": two today already; "fed": just fed. */
export type KoiAdvice = "hungry" | "ready" | "plenty" | "fed";
/** "young": lotus food would burn the young leaves (before the second standing leaf); "rich": the mud is rich already. */
export type PondFeedAdvice = "ok" | "young" | "rich" | "hungry";

/** What the renderer and the UI need for a lotus: every soil Visual key (with pond meanings), plus the pond's own. */
export interface PondVisual extends Omit<SoilVisual, "says" | "feedAdvice"> {
  medium: "pond";
  says: PondLine;
  feedAdvice: PondFeedAdvice;
  koiAdvice: KoiAdvice;
  /** in its jar, or planted in its pot in the pond */
  stage: "jar" | "pond";
  /** in the jar: its root and first leaf are out, so the next water action plants it */
  moveReady: boolean;
  /** the pond level against the fill line, mm (negative below it); pondMM is the same */
  waterMM: number;
  pondMM: number;
  /** water over the pot's pebbles, mm */
  stonesMM: number;
  /** the pond has fallen below the pot's rim; the pot's own water is gone */
  potIsolated: boolean;
  potDry: boolean;
  /** 0..1: the water over the pebbles against 70 mm (a renderer convenience) */
  water: number;
  /** the jar's water 0 (murky) .. 1 (clear); 1 once planted */
  jarClarity: number;
  /** green water 0..1 */
  algae: number;
  floatLeaves: number;
  aerialLeaves: number;
  floatBrown: number;
  nibbled: number;
  koiHunger: number;
  koiGather: 0 | 1;
  koiGasp: boolean;
  /** 1, 2 or 3 on the flower's three days, 0 otherwise */
  flowerDay: 0 | 1 | 2 | 3;
  flowers: number;
  pods: number;
  pod: 0 | 1;
  bud2: number;
  podDry: number;
  /** the flower's own warmth (a sacred lotus heats its flower) 0..1, only while the model says it is warm */
  warmth: number;
  /** the pond's water temperature, degC */
  waterT: number;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function clamp01(x: number): number { return clamp(x, 0, 1); }
function smooth(a: number, b: number, x: number): number { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function hodOf(h: number): number { return ((h % 24) + 24) % 24; }
function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
const SIG = 5.670e-8, LAM = 2.45e6, CW = 4.186e6;
const ELEV = 890, LAT = 12.9254 * Math.PI / 180, LON = 77.6848, LZ = 82.5;
const PK = 101.3 * Math.pow((293 - 0.0065 * ELEV) / 293, 5.26), GAM = 0.000665 * PK;
function es(T: number): number { return 0.6108 * Math.exp(17.27 * T / (T + 237.3)); }
function dES(T: number): number { return 4098 * es(T) / Math.pow(T + 237.3, 2); }

// ---- the pond and the pot ----------------------------------------------------------------------------------------------

/** The pond's and the pot's geometry (m2, m, L), derived once from POND. */
export const POND_GEO = (() => {
  const P = POND, Ap = Math.PI * P.rx * P.rz, Apot = Math.PI * P.rPot * P.rPot, ApotO = Math.PI * P.rPotO * P.rPotO;
  const rim = P.stoneTop + P.rimUp, Vmud = Apot * P.dm * 1000;
  const Vqpeb = P.phi * P.peb * Apot * 1000, Vqrim = Vqpeb + P.rimUp * Apot * 1000;
  return Object.freeze({
    Ap, Apot, ApotO, Aout: Ap - ApotO, rim, D: 2 * Math.sqrt(Ap / Math.PI),
    Vmud, Vqpeb, Vqrim, VpRim: P.Vfill + rim * Ap * 1000, VpOver: P.Vfill + P.over * Ap * 1000,
    Wsat: P.thS * Vmud, Wfc: P.thFC * Vmud, Wwp: P.thWP * Vmud, mass: P.rhoMud * Vmud / 1000, Am: Apot,
    TEW: 1000 * (P.thFC - 0.5 * P.thWP) * P.dm,
  });
})();
const GEO = POND_GEO;
/** The pond level against the fill line, m (negative below it). */
function levelP(Vp: number): number { return Vp >= GEO.VpRim ? GEO.rim + (Vp - GEO.VpRim) / (GEO.Ap * 1000) : GEO.rim - (GEO.VpRim - Vp) / (GEO.Aout * 1000); }
/** The pond stands at or above the pot's rim, so the pot is part of the pond. */
export function connected(s: PondState): boolean { return s.Vp >= GEO.VpRim - 1e-9; }
function overStones(s: PondState): number { const L = levelP(s.Vp); return L >= GEO.rim - 1e-12 ? L - POND.stoneTop : Math.max(0, s.Vq - GEO.Vqpeb) / (GEO.Apot * 1000); }

function sunAt(J: number, hod: number): { Ra: number; sinB: number } {
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365), dec = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39);
  const b = 2 * Math.PI * (J - 81) / 364, Sc = 0.1645 * Math.sin(2 * b) - 0.1255 * Math.cos(b) - 0.025 * Math.sin(b);
  const w = Math.PI / 12 * ((hod + 0.5 - 0.06667 * (LZ - LON) + Sc) - 12), ws = Math.acos(-Math.tan(LAT) * Math.tan(dec));
  const w1 = clamp(w - Math.PI / 24, -ws, ws), w2 = clamp(w + Math.PI / 24, -ws, ws);
  const Ra = w2 > w1 ? 12 * 60 / Math.PI * 0.0820 * dr * ((w2 - w1) * Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * (Math.sin(w2) - Math.sin(w1))) : 0;
  const sinB = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(w);
  return { Ra: Ra * 1e6 / 3600, sinB: Math.max(0, sinB) };
}
function diffuseFrac(kt: number): number {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt * kt - 16.638 * Math.pow(kt, 3) + 12.336 * Math.pow(kt, 4);
  return 0.165;
}

// ---- plant helpers -----------------------------------------------------------------------------------------------------

function Bpot(sp: PondSpecies): number { return POND_TWIN[sp.id].Bpot; }
function Bideal(sp: PondSpecies, D: number): number {
  const tab = POND_TWIN[sp.id].tab, x = clamp(D, 0, 1) * 20, i = Math.min(19, Math.floor(x));
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}
function ttHour(sp: PondSpecies, T: number): number {
  const r = T <= sp.Tb ? 0 : T < sp.Tlo ? (T - sp.Tb) / (sp.Tlo - sp.Tb) : T <= sp.Topt ? 1 : Math.max(0, (sp.Tmax - T) / (sp.Tmax - sp.Topt));
  return r * (sp.Tlo - sp.Tb) / 24;
}
function fTg(sp: PondSpecies, T: number): number {
  if (T <= sp.Tb || T >= sp.Tmax) return 0;
  if (T < sp.Topt - 4) return (T - sp.Tb) / (sp.Topt - 4 - sp.Tb);
  if (T <= sp.Topt + 2) return 1;
  return (sp.Tmax - T) / (sp.Tmax - sp.Topt - 2);
}
function leafArea(s: PondState, sp: PondSpecies): number {
  if (s.stage === 0) return 0;
  const leafFrac = s.D < 0.64 ? sp.leafF : sp.leafF - 0.15 * (s.D - 0.64) / 0.36;
  return sp.SLA * leafFrac * s.B * (1 - 0.7 * Math.min(1, s.Dw + s.Ds + s.Dg)) * (1 - 0.5 * s.Sc) * (1 - 0.5 * s.Dpest);
}
function aerialShare(s: PondState): number { return 0.8 * smooth(POND.Daer, 0.70, s.D) * s.aer; }
function aerCount(s: PondState): number { return s.stage === 0 ? 0 : 3 * smooth(POND.Daer, 0.85, s.D) * s.aer; }
function feedYoung(s: PondState): number { return s.stage === 0 ? 1 : 1 - smooth(0.9, 1.5, s.aMax || 0); }
function shownLA(s: PondState, sp: PondSpecies): number {
  if (s.stage === 0) return 0;
  const g = clamp((s.B - POND.B0) / (Bpot(sp) - POND.B0), 0, POND.potBound);
  return Math.max(0.001, sp.LAbloom * g) * (1 - 0.7 * Math.min(1, s.Dw + s.Ds + s.Dg)) * (1 - 0.5 * s.Sc) * (1 - 0.5 * s.Dpest);
}
function mudN(s: PondState): number { return s.Ns / GEO.mass; }
function nRich(s: PondState): boolean { return s.NNI >= 0.9 && mudN(s) >= POND.Nrich; }
/** The petals open (and a paused opening resumes) only from openHod to closeHod. */
export function pondOpenWindow(sp: PondSpecies, hod: number): boolean { return hod >= sp.openHod && hod < sp.closeHod; }
const openWindow = pondOpenWindow;
/** The pond level against the fill line, mm (negative below it). */
export function levelMM(s: PondState): number { return 1000 * levelP(s.Vp); }
/** How hungry the koi are, 0 (fed within 18 h) .. 1 (48 h or more). */
export function koiHunger(s: PondState): number { return smooth(POND.koiLag, POND.koiFull, s.kH); }
// 1 while every leaf floats (a seedling the koi can strip), falling to 0 as the first standing leaves rise out of reach
function koiYoung(s: PondState): number { return s.stage === 0 || !POND.grazeLethal ? 0 : 1 - smooth(POND.Daer, POND.koiEnd, s.D); }
// the koi browsing as injury: in full while young, half of it as lost leaf once the plant is out of reach
function koiInj(s: PondState): number { const y = koiYoung(s) * (POND.koiKills ? 1 : 0.5); return (y + 0.5 * (1 - y)) * (s.Dg || 0); }

const WX_FALLBACK = Object.freeze({ T: 22, RH: 75, P: 0, SW: 0, ET0: 0, U: 5 });
// as model.ts's cleanWx (the prototype keeps a raw isDay, which the pond never reads)
function cleanWx(w?: LooseWeather | null, prev?: LooseWeather | null): HourWeather {
  const a: LooseWeather = w || {}, b: LooseWeather = prev || {};
  const T = isNum(a.T) ? a.T : isNum(b.T) ? b.T : WX_FALLBACK.T;
  const RH = clamp(isNum(a.RH) ? a.RH : isNum(b.RH) ? b.RH : WX_FALLBACK.RH, 0, 100);
  const P = isNum(a.P) ? Math.max(0, a.P) : 0;
  const SW = Math.max(0, isNum(a.SW) ? a.SW : isNum(b.SW) ? b.SW : 0);
  const ET0 = Math.max(0, isNum(a.ET0) ? a.ET0 : isNum(b.ET0) ? b.ET0 : 0);
  const U = Math.max(0, isNum(a.U) ? a.U : isNum(b.U) ? b.U : WX_FALLBACK.U);
  const Ts = isNum(a.Ts) ? a.Ts : T;
  const day = typeof a.isDay === "boolean" || isNum(a.isDay) ? !!a.isDay : SW > 0;
  return { T, RH, P, SW, ET0, U, Ts, isDay: day ? 1 : 0 };
}
function devFactor(s: PondState, sp: PondSpecies, fN: number, jarFoul: number): number {
  return (1 - POND.devA * clamp01((s.aba - POND.aba0) / (1 - POND.aba0))) * (1 - POND.devInj * Math.min(1, s.Dw + s.Ds + POND.devG * s.Dg)) * (1 - POND.devGy * koiYoung(s) * Math.min(1, s.Dg || 0))
    * (1 - POND.pestDev * clamp01((s.Dpest - POND.pest0) / (0.6 - POND.pest0)))
    * (0.7 + 0.3 * fN) * (1 - POND.devStunt + POND.devStunt * clamp01(s.B / Bideal(sp, s.D)))
    * (1 - JAR.slow * jarFoul);
}

/** A fresh lotus seed in its jar beside a full pond. plantedAtIndex is the game hour it goes in. */
export function createPond(speciesId: "lotus", plantedAtIndex: number, owner?: string | null): PondState {
  return {
    v: POND_VERSION, medium: "pond", sp: speciesId, owner: owner == null ? null : owner, h: plantedAtIndex, plantedH: plantedAtIndex,
    hod: hodOf(plantedAtIndex), alive: true, gen: 1, fairyUsed: false, diedH: NONE,
    stage: 0, movedH: NONE, Jm: JAR.J0, Jo: 0,
    Vp: POND.Vfill, Vq: GEO.Vqrim, Wm: GEO.Wsat,                        // the pond at its line, the pot full and its mud soaked
    Tw: 22, Tm: 22, Tw3: 22, Tn5: 20, TnRun: 99, Ta: 22, cl: 0.4, Ts24: 24, Al: 0.005,
    Nw: POND.nBg / 0.15 * POND.Vfill, Nm: 0,
    kH: 0, lastKoiH: NONE, koiDay: 0,                                     // the koi were fed at the planting
    B: POND.B0, D: 0, dD: 0, fDev: 1, aba: 0, turgor: 1, aer: 1,
    Dw: 0, Ds: 0, Dd: 0, Dg: 0, R: 0, Sc: 0, Ns: POND.N0 * GEO.mass, Np: 45 * POND.B0, NNI: 1,
    Ps: 0, Pa: 0, Pm: 0, Dpest: 0, budS: 0, op: 0, ripeH: NONE, bloomH: NONE, cap: 1,
    flN: 0, flH: NONE, nb: 0, bL: 0, bN: 0, aMax: 0,
    shade: false, cover: false, shadeH: 0, naiveH: 0, daySpr: 0, givers: [], glowH: 0, richH: 0, burnH: 0,
    lastCanH: NONE, lastFeedH: NONE, f: 0, Kse: 1, over: 0, gz: 0,
    cP: 0, cI: 0, cE: 0, cT: 0, cO: 0, cMag: 0, cSet: 0, cJ: 0,
  };
}

// ---- step --------------------------------------------------------------------------------------------------------------

const EV_ORDER: Readonly<Record<string, number>> = { revive: 0, replant: 1, shade: 2, cover: 2, feed: 3, water: 4, sprinkle: 5, tend: 6, talk: 7 };
interface LooseEvent { kind?: unknown; amount?: unknown; actor?: unknown; id?: unknown }
function ord(e: LooseEvent): number {
  return typeof e.kind === "string" && Object.prototype.hasOwnProperty.call(EV_ORDER, e.kind) ? EV_ORDER[e.kind] : 9;
}
function idDiff(a: LooseEvent, b: LooseEvent): number {
  const d = Number(a.id || 0) - Number(b.id || 0);
  return Number.isNaN(d) ? 0 : d;
}
function isOnOff(a: unknown): boolean { return a === 0 || a === 1 || a === true || a === false; }

/**
 * Steps one hour, as model.ts's step(): hour.h must equal state.h, the weather row goes through cleanWx, events are
 * validated here (unknown kinds, a cover change (a pond has none), a sprinkle without an actor or from the owner, cans
 * and feeds inside their rate limits are ignored; a tend's pinch inside koiGapH still rinses). Returns a new state.
 */
export function stepPond(state: PondState, hour: HourInput, events?: readonly SimEvent[] | null, sp?: PondSpecies | null): PondState {
  sp = sp || POND_SPECIES[state.sp];
  let s: PondState = { ...state, givers: state.givers.slice() };
  const w = cleanWx(hour.wx, null), h = hour.h, hod = hodOf(h), G = GEO, P = POND, J = 314 + Math.floor(h / 24);
  if (h < s.plantedH) return s;

  // 1. midnight IST: reset the daily sprinkle cap and the day's koi pinches
  if (hod === 0 && h > s.plantedH) { s.daySpr = 0; s.givers = []; s.koiDay = 0; }
  if (s.glowH > 0) s.glowH--;
  if (s.richH > 0) s.richH--;
  if (s.burnH > 0) s.burnH--;

  // 2. events
  let Iin = 0;
  const seen = new Set<string>();
  const ev = ((events || []) as readonly LooseEvent[]).slice().sort((a, b) => (ord(a) - ord(b)) || idDiff(a, b));
  for (const e of ev) {
    const k = e.kind;
    if (e.id != null) { const key = String(e.id); if (seen.has(key)) continue; seen.add(key); }   // idempotent retries
    if (k === "revive" && !s.alive && !s.fairyUsed) {
      if (s.stage === 0) { s.Jm = JAR.J0; s.Jo = 0; }
      else {   // magic water: the pond back to its line, the pot full, the mud soaked
        const addP = Math.max(0, P.Vfill - s.Vp), addQ = Math.max(0, G.Vqrim - s.Vq), addM = Math.max(0, G.Wsat - s.Wm);
        s.cMag += addP + addQ + addM; s.Vp += addP; s.Vq += addQ; s.Wm += addM;
      }
      s.kH = 0;
      s.alive = true; s.fairyUsed = true; s.Dw = s.Ds = s.Dg = s.R = 0; s.Pa = s.Dpest = 0; s.Sc *= 0.5; s.turgor = 0.5; s.aba = 0;
      s.B = Math.max(s.B, 0.6 * Bideal(sp, s.D));
    } else if (k === "replant" && !s.alive && s.fairyUsed) {             // at any hour: planting never closes
      const keep = { fairyUsed: true, gen: s.gen + 1, owner: s.owner, Vp: s.Vp, Vq: s.Vq, Wm: s.Wm, Tw: s.Tw, Tm: s.Tm, Tw3: s.Tw3, Tn5: s.Tn5, TnRun: s.TnRun, Ta: s.Ta, cl: s.cl, Ts24: s.Ts24,
        Al: s.Al, Nw: s.Nw, Nm: s.Nm, Ns: s.Ns, kH: s.kH, lastKoiH: s.lastKoiH, koiDay: s.koiDay,
        cP: s.cP, cI: s.cI, cE: s.cE, cT: s.cT, cO: s.cO, cMag: s.cMag, cSet: s.cSet, cJ: s.cJ, lastFeedH: s.lastFeedH, lastCanH: s.lastCanH };
      s = { ...createPond(sp.id, h, s.owner), ...keep };
      s.stage = 1; s.movedH = h; s.D = P.Djar; s.B = Bideal(sp, P.Djar); s.Np = 45 * s.B; s.cap = P.replantCap;
      const soak = Math.max(0, G.Wsat - s.Wm); s.Wm += soak; s.cSet += soak;   // the pot's mud is soaked when the new seedling goes in
    } else if ((k === "shade" || k === "cover") && isOnOff(e.amount)) {
      const on = !!e.amount;
      if (k === "shade") { if (!on && s.shade && s.shadeH >= 48) s.naiveH = 72; if (!on) s.shadeH = 0; s.shade = on; }
    } else if (k === "feed" && s.alive && h - s.lastFeedH >= P.feedGapH) {
      s.lastFeedH = h;
      if (s.stage === 0) { s.Jm = Math.max(s.Jm, 0.7); s.Jo += 12; s.burnH = 12; }
      else {
        if (nRich(s)) s.richH = P.richH;
        s.Ns += P.feedN; s.Nm += 1;
        const young = feedYoung(s);
        if (young > 0.01) { const bd = P.burn * young; s.Ds += bd; s.Sc = Math.min(1, s.Sc + 0.5 * bd); s.burnH = 24; }
      }
    } else if (k === "water" && h - s.lastCanH >= P.canGapH && (s.alive || s.stage === 1)) {
      s.lastCanH = h;
      if (s.alive && s.stage === 0 && s.D >= P.Djar) { s.stage = 1; s.movedH = h; }   // the owner plants the seedling in its pot
      else if (s.alive && s.stage === 0) { s.Jm = JAR.J0; s.Jo = 0; s.cJ++; }         // fresh jar water
      else Iin += P.can;                                                               // a 15 L bucket into the pond
    } else if (k === "sprinkle" && e.actor != null && e.actor !== s.owner && s.givers.indexOf(e.actor as string) < 0) {
      s.givers.push(e.actor as string); s.daySpr++;
      if (s.daySpr <= P.sprinkleCap) {
        if (s.stage === 0) s.Jm = JAR.J0 + (s.Jm - JAR.J0) * JAR.V / (JAR.V + P.sprinkle);
        else Iin += P.sprinkle;                                                        // 0.12 L into an 800 L pond
      }
    }
    else if (k === "tend") {
      // "Tend the pond": a pinch of koi food (the koi gather; their waste, and anything they leave beyond two pinches a day,
      // feeds algae), counted at most once every koiGapH hours; and the aphids washed into the pond, where the koi eat them
      if (h - s.lastKoiH >= P.koiGapH) {
        s.lastKoiH = h; s.kH = 0; s.koiDay++;
        s.Nw += P.koiN * (s.koiDay > 2 ? 2 : 1);
      }
      s.Pa *= 0.1;
    }
    else if (k === "talk") s.glowH = 1;
  }

  // 3. the pond's water temperature and evaporation (the pond is always there, plant or not)
  const conn0 = s.Vp >= G.VpRim - 1e-9, L0 = levelP(s.Vp), Aw = G.Ap, Drim = G.D;
  const sun = sunAt(J, hod);
  if (sun.Ra > 150 && sun.sinB > 0.17) s.cl += (clamp01(1 - w.SW / (0.768 * sun.Ra)) - s.cl) * 0.5;
  const TaK = w.T + 273.15, ea = w.RH / 100 * es(w.T);
  let Ld = (1.24 * Math.pow(10 * ea / TaK, 1 / 7) * (1 - s.cl) + s.cl) * SIG * Math.pow(TaK, 4);
  if (s.shade) Ld = 0.5 * Ld + 0.5 * SIG * Math.pow(TaK, 4);
  s.Ts24 += (w.Ts - s.Ts24) / 24; s.Ta = w.T;
  const SW = w.SW * (s.shade ? 0.5 : 1), fb = Math.max(0, P.coping - L0);
  const kt = sun.Ra > 1 ? clamp01(w.SW / sun.Ra) : 0, fd = sun.Ra > 1 ? diffuseFrac(kt) : 1;
  const Sdir = SW * (1 - fd), Sdif = SW * fd, tanB = sun.sinB > 0.02 ? sun.sinB / Math.sqrt(1 - sun.sinB * sun.sinB) : 0.02;
  const rimShade = clamp01(4 * (fb / tanB) / (Math.PI * Drim));
  const alive = s.alive, LA = alive ? leafArea(s, sp) : 0, LAs = alive ? shownLA(s, sp) : 0, sa = aerialShare(s), LAa = LAs * sa, LAf = LAs - LAa;
  const ca = clamp(0.56 * LAa / Aw, 0, 0.9), cf = clamp(LAf / Aw, 0, 0.9), caPot = clamp(0.56 * LAa / G.Apot, 0, 0.9);
  const swWater = ((1 - rimShade) * Sdir + Sdif * (1 - 0.5 * fb / Drim)) * (1 - 0.9 * ca);
  const u2 = 0.748 * w.U / 3.6 * P.su * clamp(1 - 0.6 * (fb / Drim - 0.1), 0.6, 1.06) * (1 - 0.5 * ca) * (s.shade ? 0.8 : 1);
  const fW = (P.windFn === 48 ? 2.626 + 1.381 * u2 : 1.313 + 1.381 * u2) * LAM / 86400 * P.agit;
  // heat capacity per m2 of surface: the whole mixed pond (the pump keeps it mixed); walls and floor exchange with the ground
  const C = CW * Math.max(s.Vp / 1000, 0.05) / Aw;
  const K = 4 * P.emis * SIG * Math.pow(TaK, 3) + fW * (dES(w.T) + GAM) + P.Kbot;
  const Q0 = (1 - P.alb) * swWater + P.emis * (Ld - SIG * Math.pow(TaK, 4)) - fW * (es(w.T) - ea) + P.Kbot * (s.Ts24 - w.T);
  const Te = w.T + Q0 / K, x = 3600 * K / C, T0 = s.Tw;
  s.Tw = Te + (T0 - Te) * Math.exp(-x);
  const Tm = Te + (T0 - Te) * (1 - Math.exp(-x)) / x;
  const E = Math.max(0, fW * (es(w.T) - ea + dES(w.T) * (Tm - w.T))) * 3600 / LAM;   // mm over open water this hour
  s.Tm = Tm; s.Tw3 += (Tm - s.Tw3) / 72;
  s.TnRun = Math.min(s.TnRun, Tm);
  if (hod === 10) { s.Tn5 += (s.TnRun - s.Tn5) / 5; s.TnRun = 99; }
  const rainAll = w.P * G.Ap, rainQ = conn0 ? 0 : w.P * G.Apot, rainP = rainAll - rainQ;   // rain on the pond (L); into the pot when it stands alone
  if (rainAll > 0) s.Tw = (s.Tw * s.Vp + (w.T - (1 - w.RH / 100) * 4) * rainAll) / (s.Vp + rainAll);
  if (Iin > 0) s.Tw = (s.Tw * s.Vp + w.T * Iin) / (s.Vp + Iin);
  if (rainAll + Iin > 0) s.Al *= s.Vp / (s.Vp + rainAll + Iin);

  // 4. water book: the pond, the pot's own puddle when the pond is below its rim, the pot's mud, overflow at the notch
  const TAWm = G.Wsat - G.Wwp, RAWm = P.pMud * TAWm, Dmud = G.Wsat - s.Wm, potDry = !conn0 && s.Vq <= 0;
  const f = potDry ? clamp01(Dmud / TAWm) : 0, Ks = potDry ? clamp01((TAWm - Dmud) / (TAWm - RAWm)) : 1;
  const Kse = alive && s.stage === 1 ? Ks : alive ? 1 : 0;
  const E0 = w.ET0 * (s.shade ? 0.65 : 1), Ac = Math.max(G.Apot, LAa / 1.5), LAIc = LAa / Ac;
  let Tr = alive && s.stage === 1 ? P.Kcb * P.oasis * (1 - Math.exp(-0.7 * LAIc)) * E0 * Ac * Kse : 0;
  const EpL = E * (conn0 ? G.Ap : G.Aout);
  let EqL = 0, EsL = 0;
  if (!conn0) {
    if (s.Vq > G.Vqpeb) EqL = E * G.Apot * (1 - 0.9 * caPot);                              // open water in the pot
    else if (s.Vq > 0) EqL = E * G.Apot * (1 - 0.9 * caPot) * (0.35 + 0.65 * s.Vq / G.Vqpeb); // water among the pebbles: the wet tops dry first [E]
    else {                                                                                 // bare stones over drying mud (FAO-56)
      const xs = G.Wsat - G.Wfc, REW = xs + P.REW * G.Am, TEW = xs + Math.max(P.REW + 1, G.TEW) * G.Am;
      const Kr = Dmud <= REW ? 1 : clamp01((TEW - Dmud) / (TEW - REW));
      EsL = P.KeMud * Kr * Math.exp(-0.5 * LAIc) * E0 * G.Am * 0.7;                       // the stone mulch slows it [E]
    }
  }
  let Vp = s.Vp + rainP + Iin - EpL, Vq = s.Vq, Wm = s.Wm, over = 0;
  if (conn0) {
    Vp -= Tr;
    if (Wm < G.Wsat) { const dr0 = Math.min(G.Wsat - Wm, Math.max(0, Vp)); Wm += dr0; Vp -= dr0; }
  } else {
    Vq += rainQ - EqL - Tr - EsL;
    if (Vq > 0 && Wm < G.Wsat) { const dr1 = Math.min(Vq, G.Wsat - Wm); Wm += dr1; Vq -= dr1; }
    if (Vq < 0) {
      const take = Math.min(-Vq, Math.max(0, Wm - 0.85 * G.Wwp)), short = -Vq - take;
      if (short > 0) { const lossL = EqL + Tr + EsL, kq = lossL > 0 ? Math.max(0, (lossL - short) / lossL) : 1; EqL *= kq; Tr *= kq; EsL *= kq; }
      Wm -= take; Vq = 0;
    }
  }
  for (let pass = 0; pass < 2; pass++) {                       // the pond above the rim pours into the pot
    if (Vp > G.VpRim && Vq < G.Vqrim) { const d0 = Math.min(G.Vqrim - Vq, Vp - G.VpRim); Vq += d0; Vp -= d0; }
    if (Vq > 0 && Wm < G.Wsat) { const d1 = Math.min(Vq, G.Wsat - Wm); Wm += d1; Vq -= d1; }
  }
  if (Vp > G.VpOver) { over = Vp - G.VpOver; Vp = G.VpOver; }
  s.Vp = Vp; s.Vq = Vq; s.Wm = Wm; s.over = over;
  s.cP += rainAll; s.cI += Iin; s.cE += EpL + EqL + EsL; s.cT += Tr; s.cO += over;
  s.f = f; s.Kse = Kse;

  // 5. green water (a proxy on the pond's volume): background release (mud, debris, the koi's foraging), koi food, tank
  // water, the lotus's tabs; a slow sink; dilution by inflow; overflow skims
  const Vref = Math.max(Vp, 1), leak = 0.015 / 24 * s.Nm;
  s.Nm -= leak + (LAa > 0.002 ? P.rootUp / 24 * s.Nm : 0);
  s.Nw += P.tabIdx * leak + P.nBg * P.Vfill / 24 + P.tapN * Iin;
  s.Nw *= Math.exp(-0.15 / 24);
  if (over > 0) { s.Nw *= Math.max(0, 1 - over / (Vp + over)); s.Al *= Math.max(0.05, 1 - P.skim * over / Math.max(Vp, 1)); }
  const nW = s.Nw / Vref;
  const Il = swWater * (1 - 0.8 * cf), mu = 2.0 * Math.pow(1.066, Tm - 20) * (Il / (Il + 60)) * (nW / (nW + 0.5));
  s.Al += (mu * s.Al * (1 - s.Al) - 0.10 * s.Al) / 24;
  s.Al = clamp(s.Al, 0.005, 1);

  // 6. the koi: hours since their last pinch
  s.kH += 1;

  s.h = h + 1; s.hod = hodOf(h + 1);
  if (s.shade) s.shadeH++;
  if (s.naiveH > 0) s.naiveH--;
  if (!s.alive) { s.turgor += (0 - s.turgor) * 0.1; s.gz = 0; return s; }

  // 7. the jar
  let jarFoul = 0, Tdev = Tm;
  if (s.stage === 0) {
    const Tj = w.T + JAR.sun * SW, rj = JAR.r25 * Math.pow(JAR.Q10, (Tj - 25) / 10);
    s.Jm = clamp(s.Jm + rj * s.Jm * (1 - s.Jm), JAR.J0, 1);
    if (s.Jm >= JAR.cloudy) s.Jo += 1;
    if (s.Jo > JAR.lag) s.R += JAR.kR * Math.min(1, (s.Jo - JAR.lag) / 12) * Math.pow(2, (Tj - 25) / 10);
    jarFoul = clamp01((s.Jo - JAR.alarm) / (JAR.lag - JAR.alarm)); Tdev = Tj;
  }

  // 8. turgor
  const dem = Math.min(1, E0 / 0.5);
  const tgt = Math.pow(Kse, 0.4 + 0.6 * dem) * (1 - sp.wilt * dem * smooth(0.10, P.pMud + 0.15, f));
  s.turgor += (tgt - s.turgor) * 0.249;

  // 9. scorch
  const sw = SW, u = Math.max(0.2, 0.4 * w.U / 3.6), ra = 150 * Math.sqrt(sp.dLeaf / u);
  const Tleaf = w.T + 0.5 * sw * (1 - 0.8 * Kse) * ra / 1200, vpd = es(w.T) * (1 - w.RH / 100);
  s.Sc = Math.min(1, s.Sc + 0.03 * Math.max(0, Tleaf - sp.Tcrit + (s.naiveH > 0 ? 3 : 0))
    + (1 - s.Sc) * P.kDes * clamp01((f - 0.4) / 0.4) * sw / 1000 * Math.min(2, vpd)
    + (s.stage === 1 ? P.kBurnM * Math.max(0, s.Nm - P.burnM) : 0));

  // 10. drought injury once the pot's mud dries
  if (f > P.fSen) {
    const dd = (P.kD / sp.tolD) * Math.min(1.5, (f - P.fSen) / P.fSpan) * (0.25 + 0.75 * Math.min(1, E0 / 0.3));
    s.Dw += (1 - P.sFrac) * dd; s.Ds += P.sFrac * dd;
  } else if (f <= P.pMud) s.Dw = Math.max(0, s.Dw - P.rDw / 24);

  // 10b. hungry koi graze the floating leaves (a seedling's leaves all float; standing leaves, on spiny stalks, are out of reach)
  const hk = koiHunger(s);
  let gz = 0;
  if (s.stage === 1 && P.koiGraze) {
    gz = P.koiGraze * P.kGraze * hk * (1 - aerialShare(s));
    const capG = koiYoung(s) > 0.5 ? 1 : P.grazeCap;
    if (hk < 0.05) s.Dg = Math.max(0, s.Dg - P.rGraze / 24);                  // fed koi leave the leaves be; new ones replace the eaten
    else if (s.Dg > capG) s.Dg = Math.max(capG, s.Dg - P.rGraze / 24);        // out of reach now: regrowth brings it back to the cap
    else s.Dg = Math.min(capG, s.Dg + gz);
  }
  s.gz = gz;

  // 11. aphids
  if (s.stage === 1) {
    const NNI0 = s.Np / (45 * s.B);
    if (w.T >= 18 && w.T <= 30 && w.RH < 75 && w.P === 0) s.Pa += sp.aphid * (0.002 + 0.01 * (NNI0 > 1.05 && mudN(s) > 30 ? 2 : 1) * s.Pa * (1 - s.Pa));
    if (w.P > 2) s.Pa *= 0.7;
    s.Pa = clamp01(s.Pa);
  }
  s.Dpest = Math.min(0.6, s.Dpest + 0.002 * s.Pa);

  // 12. nitrogen in the pot's mud
  let fN = 1;
  if (s.stage === 1) {
    s.Ns += P.Nmin * G.mass / 24;
    const up = Math.min(0.01 * s.Ns * Kse, Math.max(0, 54 * s.B - s.Np));
    s.Ns -= up; s.Np += up;
    s.NNI = s.Np / (45 * s.B); fN = clamp01((s.NNI - 0.5) / 0.4);
  }

  // 13. growth
  if (s.stage === 1) {
    const LAI = LA / G.Apot, Ipar = 0.5 * sw * 0.0036 * G.Apot * (1 - Math.exp(-0.8 * LAI));
    let dB = sp.RUE * (s.shade ? 1.1 : 1) * Ipar * fTg(sp, w.T) * fN * Kse * (1 - P.devGy * koiYoung(s) * Math.min(1, s.Dg || 0));   // a stripped seedling cannot grow
    if (s.B > Bpot(sp)) dB *= clamp01(1 - (s.B - Bpot(sp)) / ((P.potBound - 1) * Bpot(sp)));
    const g = s.B / (s.B + dB);
    s.Sc *= g; s.Ds *= g; s.Dpest *= g; s.R *= g; s.B += dB;
  }
  s.aer += ((0.4 + 0.6 * clamp01((s.Tn5 - 15) / 6)) * (s.shade ? 0.6 : 1) - s.aer) / 72;
  s.aMax = Math.max(s.aMax || 0, aerCount(s));

  // 14. development
  const sig = smooth(P.abaF0, P.pMud + P.abaDp, f);
  s.aba += (sig - s.aba) * (1 - Math.exp(-1 / (sig > s.aba ? P.abaUp : P.abaRec)));
  s.fDev = devFactor(s, sp, fN, jarFoul);
  const dD = ttHour(sp, Tdev) * s.fDev / sp.TT;
  s.dD = dD;
  if (s.D >= P.Dbud && s.D < 0.85) s.budS += P.budK * s.aba * dD / 0.21;
  if (P.aphBud && s.D >= P.Dbud && s.D < 0.95) s.budS += P.aphBud * clamp01((s.Pa - 0.3) / 0.7) * dD / 0.31;
  if (P.koiGraze && s.stage === 1 && s.D >= P.Dbud && s.D < 1) s.budS += P.koiBud * hk * dD / 0.36;   // hungry koi at the bud
  if (s.D >= P.Dbud && s.D < 1 && w.SW > 0) { s.bL += s.shade ? 0.5 : 1; s.bN += 1; }
  s.D = Math.min(1, s.D + dD);
  if (s.D >= 1) {
    if (s.ripeH === NONE) s.ripeH = h + 1;
    if (s.op < 1 && openWindow(sp, hod) && (s.op > 0 || hod === sp.openHod)) s.op = Math.min(1, s.op + smooth(0.3, 0.7, s.turgor) / sp.openDur);
    if (s.op >= 0.5 && s.bloomH === NONE) s.bloomH = h + 1;
  }
  if (s.bloomH !== NONE) {
    if (s.flN === 0) { s.flN = 1; s.flH = s.bloomH; }
    const fdNow = Math.floor((h + 1) / 24) - Math.floor(s.flH / 24);
    if (fdNow >= 3 && s.flN < P.flMax) {
      if (Kse > 0.9 && s.Dw + s.Ds < 0.3) s.nb = Math.min(1, s.nb + ttHour(sp, Tdev) * s.fDev / (sp.TT * P.reTT));
      if (s.nb >= 1 && hod === sp.openHod && s.turgor > 0.5) { s.flN++; s.flH = h + 2; s.nb = 0; }
    }
  }

  // 15. death
  s.Dd = s.Dw + s.Ds + POND.koiKills * koiYoung(s) * s.Dg;   // koi browsing can kill only a seedling (koiKills 1); later it costs leaf and growth
  if (s.Dd + s.R >= 1) { s.alive = false; s.diedH = h + 1; }
  return s;
}

// ---- bloom forecast ----------------------------------------------------------------------------------------------------

function climAt(climT: readonly number[], k: number): number {
  const n = climT.length;
  // before 10 Nov (a planting from 20 Oct): the mean daily cycle of the table's first 7 days, as model.ts climAt
  if (k < 0) {
    const hh = ((k % 24) + 24) % 24;
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
 * When the bud should mature and the flower open if care stays good from now, as model.ts's expectBloom(): mean air
 * temperature (climT) at expDev of the stress-free rate, the petals opening only from openHod. ripeH and bloomH are
 * POND_NONE where they are not reached within 90 days (days is then null). Returns null when the lotus is asleep.
 */
export function expectBloomPond(s: PondState, sp: PondSpecies | null | undefined, hour: { h: number; climT: readonly number[] }): BloomForecast | null {
  sp = sp || POND_SPECIES[s.sp];
  if (!s.alive) return null;
  let k = Math.max(hour.h, s.h), D = s.D, ripe = s.ripeH, op = s.op, bloom = s.bloomH;
  const lim = k + 24 * 90;
  for (; bloom === NONE && k < lim; k++) {
    if (D < 1) { D += ttHour(sp, climAt(hour.climT, k)) * POND.expDev / sp.TT; if (D >= 1) { D = 1; ripe = k + 1; } }
    if (D >= 1 && openWindow(sp, hodOf(k)) && (op > 0 || hodOf(k) === sp.openHod)) { op += 1 / sp.openDur; if (op >= 0.5) bloom = k + 1; }
  }
  return { ripeH: ripe, bloomH: bloom, days: bloom === NONE ? null : (bloom - s.plantedH) / 24 };
}

// ---- renderer mapping --------------------------------------------------------------------------------------------------

// how open the flower is through its day: t = IST clock hour, day = 0, 1, 2 (the flower's first, second and third day)
function lotusRhythm(t: number, day: number): number {
  const peak = day === 0 ? 0.55 : day === 1 ? 0.8 : 1;
  if (day === 2) return t < 6 ? 0.12 : t < 11 ? 0.12 + (peak - 0.12) * (t - 6) / 5 : 1;
  if (t >= 4 && t < 7) return 0.12 + (peak - 0.12) * (t - 4) / 3;
  if (t >= 7 && t < 10) return peak;
  if (t >= 10 && t < 16) return peak - (peak - 0.12) * (t - 10) / 6;
  return 0.12;
}

/**
 * What the renderer and the UI show for a lotus. clock is the IST clock hour to draw at (defaults to the state's own hour;
 * a fractional hour animates the flower's day and the falling petals between steps).
 */
export function toVisualPond(s: PondState, sp?: PondSpecies | null, clock?: number): PondVisual {
  sp = sp || POND_SPECIES[s.sp];
  const P = POND, t = clock === undefined ? s.hod : clock, D = s.D, Dd = s.Dw + s.Ds + koiInj(s), jar = s.stage === 0;
  const Lmm = levelMM(s), conn = connected(s), stonesMM = 1000 * overStones(s), potDry = !conn && s.Vq <= 0;
  const growth = 0.9 * Math.min(D, 0.85) / 0.85 + 0.1 * Math.max(0, D - 0.85) / 0.15;
  const Q = clamp01(1 - 2 * s.budS);
  const flH = s.flH !== NONE ? s.flH : s.bloomH;
  let fday = -1, flowering = false, pods = 0;
  if (s.bloomH !== NONE) { fday = Math.floor(s.h / 24) - Math.floor(flH / 24); flowering = fday >= 0 && fday <= 2; pods = Math.max(1, s.flN) - (flowering ? 1 : 0); }
  const drop = flowering && fday === 2 ? clamp01((t - 17) / 7) : 0;
  const opF = s.flN > 1 ? 1 : smooth(0, 1, s.op);
  const rhythm = s.bloomH !== NONE ? (flowering ? lotusRhythm(t, fday) * (1 - drop) : 0) : 1;
  const bloom = s.alive ? opF * rhythm * (0.55 + 0.45 * s.turgor) * (0.6 + 0.4 * Q) : 0;
  const nDef = clamp01((0.9 - s.NNI) / 0.4);
  const health = s.alive ? Math.max(0.01, (1 - Dd - s.R) * (1 - 0.3 * s.Dpest) * (1 - 0.25 * nDef)) : 0;
  const thirst = 1 - smooth(0.5, 1.0, s.turgor), sick = 1 - smooth(0.1, 0.45, health);
  const droop = s.alive ? clamp01(Math.max(0.9 * thirst, 0.75 * sick)) : 1;
  const size = clamp(Math.cbrt(s.B / Bideal(sp, D)), 0.5, 1.1);
  const night = t >= 18 || t < 6, bloomNow = bloom > 0.3 && s.bloomH !== NONE;
  const low = !jar && Lmm <= -P.thirstyMM, ready = !jar && Lmm <= -P.readyMM;
  const thirsty = !jar && (!conn || (s.turgor < 0.85 && s.f > 0.2));
  const budReady = D >= 1 && s.op === 0, opening = D >= 1 && s.op > 0 && s.op < 1 && s.flN <= 1, second = s.cap < 1;
  const green = clamp01((s.Al - 0.15) / 0.55), jarRot = jar && s.R > 0.05;
  const full = Lmm >= P.fullMM, cloudy = jar && s.Jm >= JAR.cloudy, hazy = jar && s.Jm >= JAR.haze;
  const moveReady = jar && D >= P.Djar, alarm = jar && (s.Jo >= JAR.alarm || s.R > 0.05);
  const hungry = !jar && s.NNI < 0.85 && feedYoung(s) <= 0.01 && s.h - s.lastFeedH >= 240;
  const budPhase = D >= P.Dbud && D < 1, bugs = !jar && s.Pa > 0.3, bud2 = s.bloomH !== NONE && !flowering && s.nb > 0.3 ? clamp01((s.nb - 0.3) / 0.7) : 0;
  const hk = koiHunger(s), koiHungry = s.kH >= 20, koiReady = s.kH >= 10, plenty = s.koiDay >= 2;
  const nibbling = s.alive && !jar && !!P.koiGraze && hk > 0.25 && (1 - aerialShare(s)) > 0.5;
  const budNibble = s.alive && !jar && !!P.koiGraze && P.koiBud > 0 && hk > 0.25 && budPhase;
  const gasp = green >= 0.6 && s.cl >= 0.55 && t >= 5 && t < 9;     // dawn oxygen low after a grey day in green water (visual only)
  const danger = s.alive && (jarRot || (health < 0.3 && !thirsty));
  const mood: PlantMood = !s.alive ? "resting" : danger ? "unwell" : thirsty ? "thirsty" : bloomNow ? "blooming" : (Dd > 0.15 || night) ? "resting" : "content";
  const bud: PondLine = second ? "my bud will open before dawn; a smaller flower this time" : "my bud will open before dawn";
  const says: PondLine = !s.alive ? "gone to sleep"
    : jar ? (s.R > 0.3 ? "my seed is rotting in murky water; fresh water, please"
      : moveReady ? (alarm ? "my root and first leaf are out and my water is murky; plant me in my pot in the pond" : "my root and first leaf are out; plant me in my pot in the pond")
      : alarm ? "my water has been cloudy for a while; fresh water, please"
      : s.burnH > 0 ? "that food clouded my water" : cloudy ? "time for fresh water" : hazy ? "fresh water would be lovely"
      : D > 0.06 ? "my first root is showing" : "a seed in clear water, waking up")
    : potDry && s.f > P.fSen ? "my pot has dried out; my leaves are crisping"
    : potDry ? "the water in my pot is gone; the mud is drying"
    : s.Dg > 0.3 && nibbling && koiYoung(s) > 0.5 ? "the koi keep eating my young leaves, so I cannot grow; feed them, please"
    : !conn ? "the pond has dropped below the rim of my pot; a top-up or two, please"
    : s.Dg > 0.3 && nibbling ? "the koi have nibbled many of my floating leaves; they are hungry"
    : nibbling ? "the koi are nibbling my young leaves; they are hungry"
    : budNibble ? "the koi are nosing at my bud; they are hungry"
    : low ? "the pond is low"
    : s.burnH > 0 ? "that food was too strong for my young leaves"
    : s.richH > 0 ? "my mud is already rich"
    : s.Ds > 0.075 ? "recovering; new leaves will replace the lost ones"
    : bloomNow ? (fday === 2 ? (drop > 0 ? "my petals are falling; my seed pod is ready" : "my flower is at its widest; the petals fall this evening") : second ? "in bloom; a smaller second-chance flower" : s.flN > 1 ? "in bloom again" : "in bloom")
    : flowering && fday <= 1 ? "my flower closes in the afternoon and opens again before dawn"
    : flowering && fday === 2 ? "my flower opens widest this morning"
    : opening ? (openWindow(sp, t) ? "my petals are opening" : "my petals will finish opening at dawn") : budReady ? bud
    : gasp ? "the koi are gulping at the surface this morning; the pond is too green"
    : green >= 0.45 ? "the pond has turned green; go easy on the koi food"
    : s.movedH !== NONE && s.h - s.movedH < 12 && s.gen === 1 ? "I have settled into my pot in the pond"
    : bugs ? (budPhase || bud2 > 0 ? "aphids on my bud; wash them into the pond for the koi" : "aphids on my leaves; wash them into the pond for the koi")
    : koiHungry ? "the koi are hungry"
    : hungry ? "my leaves are paling; a little food would help"
    : ready ? "the pond could use a top-up"
    : green >= 0.2 ? "the pond is turning a little green"
    : plenty && s.koiDay > 2 ? "the koi have had plenty today; leftover food clouds the water"
    : s.shade ? "growing slowly in the shade; I love full sun"
    : bud2 > 0.5 ? "another bud is on its way"
    : pods > 0 && !flowering ? "my seed pod is ripening"
    : second && s.bloomH === NONE ? "a second-chance seedling; my flower will be smaller" : "happy";
  const nAer = jar ? 0 : Math.round(s.aMax || 0);
  const nFloat = jar ? 0 : clamp(Math.round(1 + 3 * clamp01((D - P.Djar) / 0.30)) + Math.round(3 * smooth(P.Daer, 0.85, D) * (1 - s.aer)), 1, 6);
  const canAdvice: CanAdvice = jar ? (!s.alive ? "ok" : alarm ? "thirsty" : moveReady || hazy ? "ready" : s.Jm < 0.06 ? "damp" : "ok")
    : full ? "damp" : (low || !conn) ? "thirsty" : ready ? "ready" : "ok";
  const heat = !s.alive ? 0 : s.bloomH === NONE ? (D >= 0.95 ? 1 : 0) : flowering ? (fday <= 1 ? 1 : clamp01(1 - t / 18)) : s.nb >= 0.93 ? 1 : 0;
  const light = s.bN > 0 ? s.bL / s.bN : 1;
  return {
    medium: "pond", growth: growth, bloom: bloom, health: health,
    moisture: !potDry ? 0.6 : 0.6 * clamp01((s.Wm / GEO.Vmud - P.thWP) / (P.thS - P.thWP)),
    scorch: clamp01(s.Sc), droop: droop, chlorosis: clamp01(Math.max(3 * s.Ds, nDef)), rot: jar ? clamp01(2 * s.R) : 0,
    pests: clamp01(s.Pa), size: size, turgor: s.turgor,
    flower: !s.alive || D < P.Dbud ? 0 : s.cap * (0.3 + 0.7 * smooth(P.Dbud, 0.95, D)) * (0.6 + 0.4 * Q) * (0.8 + 0.2 * clamp01((size - 0.5) / 0.5)) * (0.4 + 0.6 * light),
    puddle: 0, mushrooms: 0, snails: 0, aphids: s.Pa, mites: 0, blackSpot: 0,
    headYaw: 90, petalDrop: drop,
    glow: s.glowH > 0 ? 1 : 0, mood: mood, says: says, alive: s.alive, canAdvice: canAdvice,
    feedAdvice: !s.alive ? "ok" : feedYoung(s) > 0.01 ? "young" : nRich(s) ? "rich" : hungry ? "hungry" : "ok",
    koiAdvice: koiHungry ? "hungry" : koiReady ? "ready" : plenty ? "plenty" : "fed",
    // pond-only keys
    stage: jar ? "jar" : "pond", moveReady: moveReady, waterMM: Lmm, pondMM: Lmm, stonesMM: stonesMM, potIsolated: !conn, potDry: potDry,
    water: clamp01((Lmm + 1000 * (P.stoneTop < 0 ? -P.stoneTop : 0.05)) / 70), jarClarity: jar ? 1 - s.Jm : 1, algae: green,
    floatLeaves: nFloat, aerialLeaves: nAer, floatBrown: potDry ? clamp01(0.3 + s.f) : 0, nibbled: clamp01(s.Dg * 1.5),
    koiHunger: hk, koiGather: s.kH < 2 ? 1 : 0, koiGasp: gasp,
    flowerDay: (flowering ? fday + 1 : 0) as PondVisual["flowerDay"], flowers: s.flN, pods: pods, pod: pods > 0 ? 1 : 0, bud2: bud2,
    podDry: s.bloomH !== NONE ? clamp01((s.h - (Math.floor(s.bloomH / 24) + 3) * 24) / (24 * 20)) : 0,
    warmth: heat * clamp01((34 - s.Ta) / 18) * (night || t < 8 ? 1 : 0.4), waterT: s.Tm,
  };
}
