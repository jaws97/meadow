// The plant numbers the garden store is given, as pure functions: the flower against a full one, and a lotus's pond as
// the scene draws it. lib/client/plant.ts uses them for the visitor's own plant (and re-exports them); a friend's garden
// (components/meadow/FriendGarden.tsx) and the developer panel use them too. Kept apart from lib/client/plant because
// that module, when it loads, puts this device's own remembered plant into the store, which a friend's garden must
// never inherit. No side effects, no DOM.
import type { PondShown } from "@/lib/garden/store";
import type { PondVisual, Visual } from "@/lib/sim";

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

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

/** A lotus's pond for the garden store, from its (shown) PondVisual and this page's moments (none on a friend's visit). */
export function pondShownOf(v: Omit<PondVisual, "glow" | "says">, stamps: Partial<Pick<PondShown, "topUpAt" | "pinchAt" | "plantedAt">> = {}): PondShown {
  return {
    stage: v.stage, moveReady: v.moveReady,
    waterMM: v.waterMM, stonesMM: v.stonesMM, potIsolated: v.potIsolated, potDry: v.potDry,
    jarClarity: v.jarClarity, algae: v.algae,
    floatLeaves: v.floatLeaves, aerialLeaves: v.aerialLeaves, floatBrown: v.floatBrown, nibbled: v.nibbled,
    koiHunger: v.koiHunger, koiGather: v.koiGather, koiGasp: v.koiGasp, aphids: v.aphids,
    flowerDay: v.flowerDay, flowers: v.flowers, pods: v.pods, podDry: v.podDry, bud2: v.bud2, petalDrop: v.petalDrop, warmth: v.warmth,
    topUpAt: stamps.topUpAt ?? 0, pinchAt: stamps.pinchAt ?? 0, plantedAt: stamps.plantedAt ?? 0,
  };
}
