"use client";
// The near garden round the hero: the raised bed of mulch with its watering
// saucer, the ring of mossy fieldstones, the stepping-stone path, the lantern
// and the companion planting. The lawn and its grass are in Ground.tsx; the
// hedges, arch, fence and trees in Backdrop.tsx. Every part is planned from
// LAYOUT and the owner's seed in lib/garden/dressing, and scaled by quality.
//
// One frame callback eases the garden's weather (wet stone, watered mulch,
// standing water, the lantern's flame) at priority -5, after the clock has
// written the env at -10 and before the parts and their materials read it.
import { useFrame } from "@react-three/fiber";
import { useGarden } from "@/lib/garden/store";
import { Bed } from "@/components/garden/garden/Bed";
import { Border } from "@/components/garden/garden/Border";
import { Companions } from "@/components/garden/garden/Companions";
import { Lantern } from "@/components/garden/garden/Lantern";
import { Path } from "@/components/garden/garden/Path";
import { driveGardenMaterials, gardenMaterials } from "@/components/garden/garden/materials";
import { stepWeather, weather } from "@/components/garden/garden/weather";

export function Garden() {
  const seed = useGarden((s) => s.seed);
  const quality = useGarden((s) => s.quality);

  useFrame((_, delta) => {
    stepWeather(Math.min(delta, 0.1));
    driveGardenMaterials(gardenMaterials(), weather);
  }, -5);

  return (
    <group name="garden">
      <Bed quality={quality} />
      <Border seed={seed} quality={quality} />
      <Path seed={seed} quality={quality} />
      <Lantern />
      <Companions seed={seed} quality={quality} />
    </group>
  );
}
