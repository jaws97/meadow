// The fit of a soil species' thermal time TT and its ideal twin (twin.ts): the prototype's run.mjs calib, reconstructed
// in this repo to fit the Pink Lily, which the prototype never had. Both readings plant at the party (h 15) in the mean
// hourly weather of 2023-25 (the harness's MEAN):
//   * twinOnce: under ideal care (idealCare) the twin's biomass B is read where development crosses D = 0.05, 0.10 .. 1,
//     interpolated within the crossing hour, rounded to 0.1 mg, tab[0] pinned to the seed mass BED.B0, made
//     non-decreasing; B_pot is tab[20], the mass when the bud matures.
//   * fitTT: TT is solved so that good care (goodCare: visits at 08:00 and 18:00, a can when the plant asks) brings the
//     bud to maturity (D crossing 1, interpolated within the hour) RIPE_DAYS after planting, and rounded to 0.1 degC.d.
//     That rule is read back from the six: solved this way, each of their recorded TTs comes out exactly.
// The prototype iterated the two together until a full pass changed TT by at most 0.1 degC.d and the table by at most
// 0.2%. At that fixed point a species' recorded TT and table reproduce themselves, which climate.test.ts checks for every
// species. Iterating from a first guess needs a twin the model can be handed, and the model reads TWIN itself (Bideal),
// so the lily's fit ran these same readings on a scratch copy of model.ts with a writable TWIN: from a flat table it
// settled in four passes (TT 152.8, 152.759 before rounding), and the same run started from a TT 20% off and a flat
// table reproduced all six recorded TTs exactly and their tables to within 0.1 mg.
import { BED, createPlant, step, ttHour } from "../model";
import type { HourWeather, PlantState, SimSpecies } from "../model";
import { MEAN, OWNER, PARTY, goodCare, idealCare, type Ctx, type Policy } from "./harness";

/** good care brings the bud to maturity this many days after planting, in mean weather, at the party hour */
export const RIPE_DAYS = 13.25;

interface Step { prev: PlantState; s: PlantState; w: HourWeather }

/** Planted at the party in MEAN weather under policy, stepped with this species record until the bud has matured. */
function run(sp: SimSpecies, policy: Policy): Step[] {
  const ctx: Ctx = { wx: (h) => MEAN[h], nWater: 0, nFeed: 0 };
  let s = createPlant(sp.id, PARTY, OWNER);
  const steps: Step[] = [];
  for (let h = PARTY; h < PARTY + 24 * 20; h++) {
    const prev = s, w = MEAN[h];
    s = step(s, { h, wx: w }, policy(h, h % 24, s, ctx), sp);
    steps.push({ prev, s, w });
    if (prev.D >= 1) break;
  }
  return steps;
}

/** the development of one step before step() caps D at 1 */
const dDof = (sp: SimSpecies, x: Step) => (ttHour(sp, x.w.T) * x.s.fDev) / sp.TT;

/** days from planting to the bud's maturity (D crossing 1, interpolated within the hour), or null */
function ripeDays(sp: SimSpecies, steps: Step[]): number | null {
  for (const x of steps) if (x.prev.D < 1 && x.s.D >= 1) return (x.prev.h + (1 - x.prev.D) / dDof(sp, x) - PARTY) / 24;
  return null;
}

/** The twin as this species' record reads it with the twin it has now: one pass of the fit's table. */
export function twinOnce(sp: SimSpecies): { Bpot: number; tab: number[] } {
  const raw: (number | null)[] = Array.from({ length: 21 }, () => null);
  for (const x of run(sp, idealCare(PARTY))) {
    const D0 = x.prev.D, dD = dDof(sp, x);
    if (!(dD > 0)) continue;
    for (let i = 1; i <= 20; i++) if (raw[i] === null && D0 < i / 20 && D0 + dD >= i / 20) raw[i] = x.prev.B + ((x.s.B - x.prev.B) * (i / 20 - D0)) / dD;
  }
  if (raw.some((v, i) => i > 0 && v === null)) throw new Error(`${sp.id}: the twin's bud did not mature`);
  const tab = raw.map((v) => Math.round((v as number) * 1e4) / 1e4);
  tab[0] = BED.B0;
  for (let i = 1; i < 21; i++) tab[i] = Math.max(tab[i], tab[i - 1]);
  return { Bpot: tab[20], tab };
}

/** TT for which good care matures the bud RIPE_DAYS after planting, with the twin it has now: exact, and to 0.1 degC.d. */
export function fitTT(sp: SimSpecies): { exact: number; TT: number } {
  const miss = (TT: number) => (ripeDays({ ...sp, TT }, run({ ...sp, TT }, goodCare())) ?? Infinity) - RIPE_DAYS;
  let a = sp.TT * 0.8, b = sp.TT * 1.25;
  if (miss(a) > 0 || miss(b) < 0) throw new Error(`${sp.id}: TT is not within 20% of ${sp.TT}`);
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (miss(m) > 0) b = m; else a = m; }
  const exact = (a + b) / 2;
  return { exact, TT: Math.round(exact * 10) / 10 };
}
