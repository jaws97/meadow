"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes, the scene's fog) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// The plant being visited, drawn in full: when a plant's card is open, its real procedural plant (flowerPlant.ts,
// from that person's own seed, species and the model's live numbers from GET /api/garden/[plot]) takes the place of
// its cheap instanced stand-in, so the visit shows their plant exactly as their garden does: its leaves, its droop
// or its bloom. A seed is still a seed of light in its mound (the instanced one says it best), so a plant is drawn
// in full from the sprout on. Only one plant is ever drawn this way, and it is released when the card closes.
import { useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { loadFriend, meadowData, type FriendGarden } from "@/components/meadow/data";
import { applyPlantEnv, buildFlowerPlant, petalGlow, type BuiltPlant } from "@/components/meadow/flowerPlant";
import { BED, plotAt } from "@/components/meadow/layout";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { useUi } from "@/components/meadow/ui";
import type { Quality } from "@/lib/garden/store";

interface Shown {
  friend: FriendGarden;
  plant: BuiltPlant;
}

/** Plants worth drawing in full: anything past the seed. */
const drawable = (f: FriendGarden) => f.stage !== "seed";

export function VisitedPlant({ quality }: { quality: Quality }) {
  const card = useUi((s) => s.card);
  const [loaded, setLoaded] = useState<FriendGarden | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const friend = loaded && loaded.plot === card ? loaded : null;

  // the friend's plant for the open card (the card loads the same, so this is usually a cache hit)
  useEffect(() => {
    if (card === null || card < 0) return;
    let live = true;
    void loadFriend(card).then((r) => {
      if (live && r.ok) setLoaded(r.value);
    });
    return () => {
      live = false;
    };
  }, [card]);

  // build it a moment after the tap (so the card answers first) and swap it in for the instanced plant
  useEffect(() => {
    if (!friend || !drawable(friend)) return;
    const id = window.setTimeout(() => {
      const v = friend.visual;
      const plant = buildFlowerPlant(
        {
          speciesId: friend.species,
          seed: friend.seed,
          growth: v.growth,
          bloom: v.bloom,
          health: v.health,
          moisture: v.moisture,
          scorch: v.scorch,
          droop: v.droop,
          flower: v.flower,
          chlorosis: v.chlorosis,
        },
        { petals: quality, leaves: "lite" },
      );
      setShown({ friend, plant });
    }, 60);
    return () => window.clearTimeout(id);
  }, [friend, quality]);

  // a built plant is released when another replaces it, or when the Meadow closes
  useEffect(() => {
    if (!shown) return;
    return () => shown.plant.dispose();
  }, [shown]);

  // drawn only while its card is open and the Meadow still has that plant there
  const live = shown && shown.friend.plot === card && meadowData.get().byPlot.get(card)?.species === shown.friend.species ? shown : null;
  useEffect(() => {
    if (!live) return;
    const plot = live.friend.plot;
    meadow.detailPlot = plot;
    return () => {
      if (meadow.detailPlot === plot) meadow.detailPlot = -1;
    };
  }, [live]);

  useFrame((state) => {
    if (!live) return;
    const g = live.plant.group.parent;
    const t = state.clock.elapsedTime;
    if (g) g.rotation.z = 0.02 * Math.sin(t * 0.9 + live.friend.plot) + 0.008 * Math.sin(t * 2.1);
    applyPlantEnv(live.plant, meadow.plantEnv, meadow.plantEnvStrength);
    const ei = petalGlow(live.friend.species, meadow.night, live.friend.visual.health, live.friend.visual.bloom, t);
    for (const mat of live.plant.petalMats) mat.emissiveIntensity = ei;
    live.plant.budMat.emissiveIntensity = ei * 0.3;
  });

  if (!live) return null;
  const plot = plotAt(live.friend.plot);
  if (!plot) return null;
  return (
    <group position={[plot.x, BED.soilH, plot.z]} rotation-y={-plot.a} scale={PLANT_SCALE}>
      <group>
        <primitive object={live.plant.group} />
      </group>
    </group>
  );
}
