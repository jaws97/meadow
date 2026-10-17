// The ideal twin: how heavy each species is at every stage of development when nothing goes wrong. The model compares a
// plant with its twin to size the plant (size = cube root of B / B_ideal(D)), to slow a clearly stunted plant's
// development a little, and to grow roots (root depth follows B / B_pot). Nothing here depends on the planting date.
//
// How it was generated: by `node run.mjs calib` in the scratch prototype (sim/run.mjs, twinOnce), iterated together with
// each species' thermal time TT until a full pass changed nothing (TT by at most 0.1 degC.d, the table by at most 0.2%).
// The twin is planted at the party (h 15) in the mean hourly weather of 2023-25 (game window, Open-Meteo archive) under
// ideal care: a can whenever depletion passes 0.2, one feed on day 5, pests tended at once. Its biomass B (g) is read where
// development crosses D = 0.05, 0.10 .. 1 (interpolated within the crossing hour, rounded to 0.1 mg, tab[0] pinned to the
// seed mass BED.B0, made non-decreasing); B_pot is its mass when the bud matures (D = 1).
// The numbers are copied verbatim from the locked model.js (SIM_VERSION 5) and are checked against golden-v5.json, so the
// port reproduces the prototype exactly. Refitting means a new SIM_VERSION and a regenerated golden file.
import type { SpeciesId } from "@/lib/plant/species";

export interface TwinEntry {
  /** twin biomass (g) when its bud matures (D = 1) */
  readonly Bpot: number;
  /** twin biomass (g) at D = 0, 0.05, 0.10 .. 1 (21 entries) */
  readonly tab: readonly number[];
}

export const TWIN: Readonly<Record<SpeciesId, TwinEntry>> = Object.freeze({
  rose: Object.freeze({
    Bpot: 0.228,
    tab: Object.freeze([0.03, 0.03, 0.0364, 0.0422, 0.0431, 0.0511, 0.0574, 0.0585, 0.0692, 0.0793, 0.0809, 0.0949, 0.1073, 0.1119, 0.1327, 0.15, 0.1559, 0.1789, 0.1969, 0.2042, 0.228]),
  }),
  sundrop: Object.freeze({
    Bpot: 0.5172,
    tab: Object.freeze([0.03, 0.03, 0.0393, 0.0485, 0.0499, 0.0636, 0.0748, 0.0768, 0.097, 0.1178, 0.1209, 0.1513, 0.1805, 0.1904, 0.242, 0.2882, 0.3036, 0.3683, 0.4215, 0.443, 0.5172]),
  }),
  magnolia: Object.freeze({
    Bpot: 0.0819,
    tab: Object.freeze([0.03, 0.03, 0.033, 0.0356, 0.0359, 0.0391, 0.0414, 0.0418, 0.0454, 0.0485, 0.049, 0.0531, 0.0563, 0.0576, 0.0627, 0.0666, 0.0679, 0.0727, 0.0763, 0.0776, 0.0819]),
  }),
  marigold: Object.freeze({
    Bpot: 0.8048,
    tab: Object.freeze([0.03, 0.03, 0.041, 0.0528, 0.0541, 0.0716, 0.0863, 0.0892, 0.1172, 0.1454, 0.1512, 0.1961, 0.2367, 0.256, 0.3376, 0.4102, 0.4378, 0.546, 0.6369, 0.6744, 0.8048]),
  }),
  tefiti: Object.freeze({
    Bpot: 0.2649,
    tab: Object.freeze([0.03, 0.03, 0.037, 0.0433, 0.0443, 0.0534, 0.0602, 0.0615, 0.0735, 0.0849, 0.087, 0.1034, 0.117, 0.1232, 0.1481, 0.1673, 0.1761, 0.2042, 0.2233, 0.2354, 0.2649]),
  }),
  jasmine: Object.freeze({
    Bpot: 0.1861,
    tab: Object.freeze([0.03, 0.03, 0.0357, 0.0408, 0.0416, 0.0486, 0.0539, 0.0548, 0.0637, 0.0721, 0.0733, 0.0847, 0.0946, 0.0981, 0.1144, 0.1277, 0.1323, 0.1497, 0.163, 0.1686, 0.1861]),
  }),
});
