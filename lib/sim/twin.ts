// The ideal twin: how heavy each species is at every stage of development when nothing goes wrong. The model compares a
// plant with its twin to size the plant (size = cube root of B / B_ideal(D)), to slow a stunted plant's development, and to
// grow roots (root depth follows B / B_pot). Nothing here depends on the planting date.
//
// How it was generated: by `node run.mjs twin` / `calib` in the scratch prototype (sim/run.mjs, twinOnce), iterated
// together with each species' thermal time TT. The twin is planted at the party (h 17) in the mean hourly weather of
// 2023-25 (game window, Open-Meteo archive) under ideal care: a can whenever depletion passes 0.2, one feed on day 5, pests
// tended at once. Its biomass B (g) is sampled where development first reaches D = 0, 0.05, 0.10 .. 1 (rounded to 0.1 mg,
// tab[0] pinned to the seed mass BED.B0, made non-decreasing); B_pot is its mass when the bud matures (D = 1).
// The numbers are copied verbatim from the locked model.js (SIM_VERSION 4) and are checked against golden-v4.json, so the
// port reproduces the prototype exactly. Note: the prototype's calibration stopped one iteration short of convergence (its
// verifier saw a fresh twin fit move a few entries slightly, e.g. tefiti B_pot 0.2143 -> 0.2082); refitting means a new
// SIM_VERSION and a regenerated golden file.
import type { SpeciesId } from "@/lib/plant/species";

export interface TwinEntry {
  /** twin biomass (g) when its bud matures (D = 1) */
  readonly Bpot: number;
  /** twin biomass (g) at D = 0, 0.05, 0.10 .. 1 (21 entries) */
  readonly tab: readonly number[];
}

export const TWIN: Readonly<Record<SpeciesId, TwinEntry>> = Object.freeze({
  rose: Object.freeze({
    Bpot: 0.1912,
    tab: Object.freeze([0.03, 0.03, 0.0344, 0.0401, 0.0407, 0.0484, 0.0523, 0.0554, 0.0655, 0.069, 0.0766, 0.0888, 0.0898, 0.1059, 0.1161, 0.1251, 0.1464, 0.1522, 0.1673, 0.1883, 0.1912]),
  }),
  sundrop: Object.freeze({
    Bpot: 0.453,
    tab: Object.freeze([0.03, 0.03, 0.0364, 0.0452, 0.0469, 0.0589, 0.0688, 0.0711, 0.0898, 0.1069, 0.112, 0.1402, 0.1538, 0.1764, 0.2226, 0.239, 0.2799, 0.3337, 0.3392, 0.4059, 0.453]),
  }),
  magnolia: Object.freeze({
    Bpot: 0.0719,
    tab: Object.freeze([0.03, 0.03, 0.0325, 0.0341, 0.0353, 0.0382, 0.0385, 0.0411, 0.042, 0.0447, 0.0475, 0.0483, 0.0522, 0.0524, 0.0566, 0.0584, 0.0613, 0.0656, 0.066, 0.0702, 0.0719]),
  }),
  marigold: Object.freeze({
    Bpot: 0.6339,
    tab: Object.freeze([0.03, 0.03, 0.0375, 0.0482, 0.0495, 0.0654, 0.0742, 0.0815, 0.1071, 0.1167, 0.1382, 0.1783, 0.1826, 0.2341, 0.2836, 0.3073, 0.3965, 0.4476, 0.4922, 0.6044, 0.6339]),
  }),
  tefiti: Object.freeze({
    Bpot: 0.2143,
    tab: Object.freeze([0.03, 0.03, 0.0349, 0.0404, 0.0417, 0.0503, 0.0522, 0.0579, 0.0683, 0.0699, 0.0818, 0.0906, 0.0971, 0.1151, 0.1182, 0.138, 0.1555, 0.1629, 0.1875, 0.1939, 0.2143]),
  }),
  jasmine: Object.freeze({
    Bpot: 0.1665,
    tab: Object.freeze([0.03, 0.03, 0.0332, 0.0381, 0.039, 0.0451, 0.0492, 0.0509, 0.0591, 0.0648, 0.0681, 0.0786, 0.0817, 0.0911, 0.1049, 0.1084, 0.1223, 0.1353, 0.1383, 0.1553, 0.1665]),
  }),
});
