// One door to both models: the seven soil flowers step in the garden bed (model.ts, SIM_VERSION 7) and the Lotus in its koi
// pond (pond.ts, POND_VERSION 1). createPlant() picks the model by species; step(), toVisual() and expectBloom() by the
// state itself (a pond state carries medium: "pond"; a soil state never has that key), so a stored state always goes back
// to the model that wrote it. Everything else reads the two through these types and helpers:
//   * PlantState and Visual are the unions; isPondState() and isPondVisual() narrow them.
//   * modelVersionOf(species) is what a checkpoint's sim_version column stores: SIM_VERSION (7) for the seven, and
//     1000 + POND_VERSION (1001) for the lotus, so the two never collide in the one smallint column. isCurrentState()
//     says whether a stored state came from the model running now.
//   * bloomedAt(), ripeAt() and diedAt() read the "not yet" marks of either model (the soil model's marks below the
//     planting hour, the pond's POND_NONE) and answer an hour or null.
// Pure, like the models.
import type { SoilSpeciesId, SpeciesId } from "@/lib/plant/species";
import {
  SIM_VERSION,
  createPlant as createSoil,
  expectBloom as expectBloomSoil,
  step as stepSoil,
  toVisual as toVisualSoil,
  type BloomForecast,
  type HourInput,
  type PlantState as SoilState,
  type SimEvent,
  type SimSpecies,
  type Visual as SoilVisual,
} from "./model";
import {
  POND_NONE,
  POND_VERSION,
  createPond,
  expectBloomPond,
  stepPond,
  toVisualPond,
  type PondSpecies,
  type PondState,
  type PondVisual,
} from "./pond";

export type { SoilState, SoilVisual };
/** Everything a model remembers about one plant: a soil flower's state or a lotus's. */
export type PlantState = SoilState | PondState;
/** What the renderer and the UI need: a soil flower's Visual or a lotus's (narrow with isPondVisual). */
export type Visual = SoilVisual | PondVisual;

/** The lotus's offset in the sim_version column: a lotus checkpoint stores POND_MODEL_BASE + POND_VERSION. */
export const POND_MODEL_BASE = 1000;

export function isPondState(s: PlantState): s is PondState {
  return (s as Partial<PondState>).medium === "pond";
}

export function isPondVisual(v: Visual): v is PondVisual {
  return (v as Partial<PondVisual>).medium === "pond";
}

/** The model version a plant of this species is stepped by, as the checkpoints' sim_version column stores it. */
export function modelVersionOf(sp: SpeciesId): number {
  return sp === "lotus" ? POND_MODEL_BASE + POND_VERSION : SIM_VERSION;
}

/** The model version that wrote this state, in the same terms as modelVersionOf(). */
export function modelVersionOfState(s: PlantState): number {
  return isPondState(s) ? POND_MODEL_BASE + s.v : s.v;
}

/**
 * The state was written by the model running now (its own version mark, for its own medium). A soil state planted
 * before 10 Nov whose bud and bloom marks are both -1 was written before the "not yet" marks moved below the planting
 * hour (20 Oct 2026, same SIM_VERSION): those -1s would read as real hours, so it is rebuilt from its planting. The model
 * now never writes that pair for such a planting, and a real bud and bloom can never share one hour.
 */
export function isCurrentState(s: PlantState): boolean {
  if (isPondState(s)) return s.v === POND_VERSION;
  return s.v === SIM_VERSION && !(s.plantedH < -1 && s.ripeH === -1 && s.bloomH === -1);
}

// A soil plant's "not yet" marks sit below its planting hour (model.ts createPlant), so a real hour before 10 Nov reads
// as an hour; the pond marks "not yet" with POND_NONE.
const markOf = (s: PlantState, h: number): number | null => (isPondState(s) ? (h === POND_NONE ? null : h) : h >= s.plantedH ? h : null);
/** The hour the flower opened (op 0.5), or null. */
export function bloomedAt(s: PlantState): number | null { return markOf(s, s.bloomH); }
/** The hour the bud matured, or null. */
export function ripeAt(s: PlantState): number | null { return markOf(s, s.ripeH); }
/** The hour the plant went to sleep (its last death), or null. */
export function diedAt(s: PlantState): number | null { return markOf(s, s.diedH); }

/** A fresh seed: a soil seed in the bed, or a lotus seed in its jar beside the pond. */
export function createPlant(speciesId: SoilSpeciesId, plantedAtIndex: number, owner?: string | null): SoilState;
export function createPlant(speciesId: "lotus", plantedAtIndex: number, owner?: string | null): PondState;
export function createPlant(speciesId: SpeciesId, plantedAtIndex: number, owner?: string | null): PlantState;
export function createPlant(speciesId: SpeciesId, plantedAtIndex: number, owner?: string | null): PlantState {
  return speciesId === "lotus" ? createPond(speciesId, plantedAtIndex, owner) : createSoil(speciesId, plantedAtIndex, owner);
}

/** Steps one hour in the model that wrote the state (model.ts step(), or pond.ts stepPond()). */
export function step(state: SoilState, hour: HourInput, events?: readonly SimEvent[] | null, sp?: SimSpecies | null): SoilState;
export function step(state: PondState, hour: HourInput, events?: readonly SimEvent[] | null, sp?: PondSpecies | null): PondState;
export function step(state: PlantState, hour: HourInput, events?: readonly SimEvent[] | null): PlantState;
export function step(state: PlantState, hour: HourInput, events?: readonly SimEvent[] | null, sp?: SimSpecies | PondSpecies | null): PlantState {
  return isPondState(state) ? stepPond(state, hour, events, sp as PondSpecies | null | undefined) : stepSoil(state, hour, events, sp as SimSpecies | null | undefined);
}

/** What the renderer and the UI show for a state, from its own model. */
export function toVisual(s: SoilState, sp?: SimSpecies | null, clock?: number): SoilVisual;
export function toVisual(s: PondState, sp?: PondSpecies | null, clock?: number): PondVisual;
// (the union's sp is typed as broadly as the implementation's: typed sp?: null, TypeScript would prefer this overload even
// for a soil state)
export function toVisual(s: PlantState, sp?: SimSpecies | PondSpecies | null, clock?: number): Visual;
export function toVisual(s: PlantState, sp?: SimSpecies | PondSpecies | null, clock?: number): Visual {
  return isPondState(s) ? toVisualPond(s, sp as PondSpecies | null | undefined, clock) : toVisualSoil(s, sp as SimSpecies | null | undefined, clock);
}

/** When the flower should open if care stays good from now, from the state's own model (null while asleep). */
export function expectBloom(s: PlantState, sp: null | undefined, hour: { h: number; climT: readonly number[] }): BloomForecast | null {
  return isPondState(s) ? expectBloomPond(s, sp, hour) : expectBloomSoil(s, sp, hour);
}
