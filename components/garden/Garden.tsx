"use client";
// The near garden round the hero: the raised bed of mulch with its watering
// saucer, the kerb of fieldstones, the flagstone path, the lantern, the
// watering can, the companion planting, and the hero's own body of side canes and low leaves
// (the hero's bloom and main stem are Plant.tsx). The lawn and its grass are in Ground.tsx; the
// hedges, arch, fence and trees in Backdrop.tsx. Every part is planned from
// LAYOUT and the owner's seed in lib/garden/dressing, and scaled by quality.
//
// One frame callback eases the garden's weather (wet stone, watered mulch,
// standing water, the lantern's flame) at priority -5, after the clock has
// written the env at -10 and before the parts and their materials read it.
// It also stages the companions by the hero's growth (see heroGrowth): low
// and in leaf while the owner's flower is young, in flower as it buds.
// For a signed-in visitor's plant two more parts follow the store: a mound of
// fresh soil while the seed has not come up (SeedMound), and the shade cloth
// and rain cover on their hoops (BedCovers); neither draws for a grown plant
// with both folded away, as the owner's rose always is.
import { swayUniforms } from "@/lib/garden/dressing";
import { garden, useGarden } from "@/lib/garden/store";
import { Bed } from "@/components/garden/garden/Bed";
import { BedCovers } from "@/components/garden/garden/BedCovers";
import { Border } from "@/components/garden/garden/Border";
import { Companions } from "@/components/garden/garden/Companions";
import { HeroBush } from "@/components/garden/garden/HeroBush";
import { Lantern } from "@/components/garden/garden/Lantern";
import { Path } from "@/components/garden/garden/Path";
import { SeedMound } from "@/components/garden/garden/SeedMound";
import { WateringCan } from "@/components/garden/garden/WateringCan";
import { driveGardenMaterials, gardenMaterials } from "@/components/garden/garden/materials";
import { stepWeather, weather } from "@/components/garden/garden/weather";
import { companionGrow, companionOpen } from "@/components/garden/garden/heroGrowth";
import { useLayerFrame, useTier } from "@/components/garden/TierLayers";

/**
 * The hero's growth as the companions follow it, eased like the plant's own (Plant.tsx) so both move together, and
 * started afresh with it when a new plant (another seed) takes the bed.
 */
const staged = { primed: false, growth: 1, seed: "" };

export function Garden() {
  const seed = useGarden((s) => s.seed);
  const quality = useTier();
  const speciesId = useGarden((s) => s.speciesId);

  useLayerFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    stepWeather(dt);
    driveGardenMaterials(gardenMaterials(), weather);
    const { growth: g, seed: owner } = garden.get();
    if (!staged.primed || staged.seed !== owner) {
      staged.primed = true;
      staged.seed = owner;
      staged.growth = g;
    } else staged.growth += (g - staged.growth) * (1 - Math.exp(-dt * 2.5));
    swayUniforms.uGrow.value = companionGrow(staged.growth);
    swayUniforms.uOpen.value = companionOpen(staged.growth);
  }, -5);

  return (
    <group name="garden">
      <Bed quality={quality} />
      <Border seed={seed} quality={quality} />
      <Path seed={seed} quality={quality} />
      <Lantern quality={quality} />
      <WateringCan quality={quality} />
      <Companions seed={seed} quality={quality} />
      <HeroBush speciesId={speciesId} seed={seed} quality={quality} />
      <SeedMound quality={quality} />
      <BedCovers quality={quality} />
    </group>
  );
}
