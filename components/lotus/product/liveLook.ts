// The courtyard lotus's look, split for the frame loop: what its geometry is built from (the shape), and what moves every
// frame without a rebuild (the flower's opening and warmth, the water's level and green, the jar's clearness). The garden
// store's numbers ease a little every 400 ms (lib/client/plant), so a look rebuilt from them as they come would rebuild
// the plant several times a second; instead the shape is built from those numbers rounded to the steps below (a
// floating leaf more, a new standing leaf, the flower's next day, a fallen petal, a droop or a browning in twentieths),
// and the rest is written into that same look each frame (LotusPlant, Jar and the pond read it there). The level is
// rounded coarsely while the pond is over the pot's rim (the floating leaves ride the rest), so a bucket (11.5 mm)
// rebuilds the plant at most once as it pours, not at every few millimetres. Pure: no three, no DOM.
import { drawnBloom, flowerOpen, holdsBud, pondLookFromShown, type LotusLookInput } from "@/components/lotus/live/pondLook";
import type { LotusLook } from "@/components/lotus/look";
import { POND } from "@/components/lotus/pond";
import { smoothstep } from "@/lib/plant/prng";
import type { PondShown } from "@/lib/garden/store";

/** The steps the shape is rounded to: a rebuild only when one of them is crossed. */
export const SHAPE_STEPS = {
  /**
   * the level (mm) while the pond is over the pot's rim: the floating leaves ride the rest (PlantLive.floatLift, at most
   * 6 mm, within the 7 mm their stalks end under them), so a bucket crosses one step at most
   */
  levelMM: 12,
  /** the level (mm) once the pond is under the rim, and the pot's own water: finer, the leaves lie on what is left */
  lowMM: 4,
  growth: 0.02,
  droop: 0.05,
  chlorosis: 0.1,
  floatBrown: 0.1,
  podDry: 0.05,
  bud2: 0.1,
  flowerSize: 0.05,
  /** the jar water's material comes in quarters (materials.ts jarWaterMaterial) */
  jarClarity: 0.25,
} as const;

const round = (x: number, step: number) => Math.round(x / step) * step;

/** Where the floating leaves drift off the pot's rim (look.ts pondFloatingLeaves: the rim stands 25 mm down), mm. */
const RIM_EXPOSED_MM = -POND.rimDepth * 1000 + 2;

/** The level the shape is built at: rounded to its step, never across the rim's mark from where the water really is. */
function shapeLevel(p: PondShown): number {
  const w = round(p.waterMM, p.potIsolated ? SHAPE_STEPS.lowMM : SHAPE_STEPS.levelMM);
  if (p.waterMM >= RIM_EXPOSED_MM) return Math.max(w, RIM_EXPOSED_MM);
  return Math.min(w, RIM_EXPOSED_MM - SHAPE_STEPS.lowMM);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The input the shape is built from: every number the geometry depends on, rounded to its step; what moves every frame
 * (and what the plant's shape never reads: the koi, the aphids, the moments) left out.
 */
export function shapeInput(i: LotusLookInput, clock = 12): LotusLookInput {
  const p = i.pond;
  const pond: PondShown = {
    stage: p.stage,
    moveReady: p.moveReady,
    waterMM: shapeLevel(p),
    stonesMM: round(p.stonesMM, SHAPE_STEPS.lowMM),
    potIsolated: p.potIsolated,
    potDry: p.potDry,
    jarClarity: round(clamp01(p.jarClarity), SHAPE_STEPS.jarClarity),
    algae: 0,
    floatLeaves: Math.round(p.floatLeaves),
    aerialLeaves: Math.round(p.aerialLeaves),
    floatBrown: round(clamp01(p.floatBrown), SHAPE_STEPS.floatBrown),
    nibbled: 0,
    koiHunger: 0,
    koiGather: 0,
    koiGasp: false,
    aphids: 0,
    flowerDay: p.flowerDay,
    flowers: p.flowers,
    pods: p.pods,
    podDry: round(clamp01(p.podDry), SHAPE_STEPS.podDry),
    bud2: round(clamp01(p.bud2), SHAPE_STEPS.bud2),
    // a petal falls at each eighteenth (the head has 18): exactly where pondLookFromShown counts them
    petalDrop: Math.round(clamp01(p.petalDrop) * 18) / 18,
    warmth: 0,
    topUpAt: 0,
    pinchAt: 0,
    plantedAt: 0,
  };
  return {
    pond,
    growth: round(clamp01(i.growth), SHAPE_STEPS.growth),
    // only whether day 1's dawn bud still holds (holdsBud) is the shape's: the opening itself moves every frame
    bloom: holdsBud(i, clock) ? 0 : 1,
    health: 0,
    droop: round(clamp01(i.droop), SHAPE_STEPS.droop),
    chlorosis: round(clamp01(i.chlorosis), SHAPE_STEPS.chlorosis),
    flowerSize: round(i.flowerSize, SHAPE_STEPS.flowerSize),
    glow: 0,
    alive: i.alive,
  };
}

/** The shape's identity: two inputs with the same key build the same plant. */
export function shapeKey(i: LotusLookInput, clock: number): string {
  const s = shapeInput(i, clock);
  // the hour only for the dew (beads on the first standing leaf before sunrise) and day 1's dawn
  const t = ((clock % 24) + 24) % 24;
  return JSON.stringify([s, t >= 4 && t < 6.5]);
}

/** The shape itself: the look for the rounded input at the clock hour, with the seed's jar spot. */
export function shapeLook(i: LotusLookInput, clock: number, seed: string): LotusLook {
  return pondLookFromShown(shapeInput(i, clock), clock, seed);
}

/**
 * Writes what moves every frame into a shape's look, from the (eased) unrounded input: the flower's opening (o =
 * bloom^1.6, the bud-to-open shape and the re-closed cup), day 3's relaxing outer whorl, its warmth (only while the
 * model says it is warm, never on a pod), the jar's clearness and the green of the water.
 */
export function applyLive(look: LotusLook, i: LotusLookInput): void {
  const p = i.pond;
  const f = look.flower;
  if (f.kind === "flower") {
    const { open, morph } = flowerOpen(drawnBloom(i.bloom, f.day, p.petalDrop), f.day);
    f.open = open;
    f.morph = morph;
    f.relax = f.day === 3 ? 0.15 + 0.25 * clamp01(p.petalDrop) : 0;
  }
  f.warmth = f.kind === "flower" || f.kind === "bud" ? clamp01(p.warmth) : 0;
  look.jar.clarity = clamp01(p.jarClarity);
  look.algae = clamp01(p.algae);
}

/** How many of the aphids to draw (LotusPlant's 0..1), from the model's aphid pressure: a few from 0.1, all by 0.7. */
export const aphidShare = (aphids: number) => smoothstep(0.1, 0.7, aphids);

/** How hard hungry koi nose the floating leaves (LotusPlant's nibble): from the model's hunger and the leaves bitten. */
export const nibbleOf = (p: Pick<PondShown, "koiHunger" | "nibbled" | "stage">) =>
  p.stage === "pond" ? Math.max(smoothstep(0.25, 0.7, p.koiHunger), 0.6 * clamp01(p.nibbled)) : 0;
