"use client";
// The whole lotus in one frame: the urli with its mud and water, the plant, and (for the seed's first days) the jar on
// its stone. In the urli frame; the garden places it on the mound's crown, the Meadow on its plot's soil at the
// Meadow's plant scale. Named "lotus-pot" so the ready flag can count its triangles.
import type { Tier } from "@/components/lotus/geometry";
import { Jar } from "@/components/lotus/Jar";
import { LotusPlant } from "@/components/lotus/LotusPlant";
import { Urli } from "@/components/lotus/Urli";
import type { LotusLook } from "@/components/lotus/look";
import type { PetalColour, Vessel } from "@/components/lotus/params";

export const POT_NAME = "lotus-pot";

export function LotusPot({
  look,
  vessel,
  tier,
  colour,
  rain,
  jarGroundY,
}: {
  look: LotusLook;
  vessel: Vessel;
  tier: Tier;
  colour: PetalColour;
  rain: boolean;
  jarGroundY?: number;
}) {
  return (
    <group name={POT_NAME}>
      <Urli vessel={vessel} tier={tier} look={look} />
      <LotusPlant look={look} tier={tier} colour={colour} rain={rain} />
      <Jar jar={look.jar} tier={tier} groundY={jarGroundY} />
    </group>
  );
}
