"use client";
// The bed's kerb: flat, angular fieldstones laid shoulder to shoulder round
// the rim, mossy on their tops, with a second course along the raised back
// of the bed; moss in the joints and at their feet; a soft contact shadow on
// the ground round each stone's foot; and outside it a spade-cut edge of bare
// dark soil where the lawn has been trimmed back. The ring is planned from
// the owner's seed, so every garden's border is its own. Four meshes, four
// draw calls; the stones also cast real shadows onto the mulch and the lawn.
import { useEffect, useMemo } from "react";
import {
  COMPANION_BUDGET,
  makeFieldstones,
  makeMossCushions,
  makeSpadeEdge,
  makeStoneContactShadows,
  planFieldstones,
} from "@/lib/garden/dressing";
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
  const contactGeo = useMemo(() => makeStoneContactShadows(stones), [stones]);
  const spadeGeo = useMemo(() => makeSpadeEdge(quality === "lite" ? 96 : 160), [quality]);
  useEffect(() => () => stoneGeo.dispose(), [stoneGeo]);
  useEffect(() => () => spadeGeo.dispose(), [spadeGeo]);
  useEffect(() => () => mossGeo.dispose(), [mossGeo]);
  useEffect(() => () => contactGeo.dispose(), [contactGeo]);

  return (
    <group name="border">
      <mesh geometry={stoneGeo} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={mossGeo} material={mats.moss} receiveShadow />
      <mesh geometry={contactGeo} material={mats.contact} renderOrder={1} />
      <mesh geometry={spadeGeo} material={mats.pathBed} receiveShadow />
    </group>
  );
}
