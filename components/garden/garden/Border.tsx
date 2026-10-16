"use client";
// The bed's kerb: a ring of mossy, lichen-flecked fieldstones walked round
// the rim so they touch but never overlap, settled into the mulch, and moss
// cushions in the gaps between them and at their feet. The ring is planned
// from the owner's seed, so every garden's border is its own. Two meshes,
// two draw calls; the stones cast shadows onto the mulch and the lawn.
import { useEffect, useMemo } from "react";
import { COMPANION_BUDGET, makeFieldstones, makeMossCushions, planFieldstones } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";

export function Border({ seed, quality }: { seed: string; quality: Quality }) {
  const { stoneDetail, stoneFineDetail } = COMPANION_BUDGET[quality];
  const mats = gardenMaterials();
  const stones = useMemo(() => planFieldstones(seed), [seed]);
  const stoneGeo = useMemo(
    () => makeFieldstones(stones, seed, stoneDetail, stoneFineDetail),
    [stones, seed, stoneDetail, stoneFineDetail],
  );
  const mossGeo = useMemo(() => makeMossCushions(stones, seed), [stones, seed]);
  useEffect(() => () => stoneGeo.dispose(), [stoneGeo]);
  useEffect(() => () => mossGeo.dispose(), [mossGeo]);

  return (
    <group name="border">
      <mesh geometry={stoneGeo} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={mossGeo} material={mats.moss} receiveShadow />
    </group>
  );
}
