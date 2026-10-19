"use client";
// The flagstone path: irregular five- to seven-sided slabs laid close along
// the owner's path line, from the lawn's front-left edge round the bed to the
// arch, sunk so they stand about a centimetre proud of the soil, with moss in
// the tight joints between them and a strip of dark, mossy earth showing in
// the gaps and along the edges; and the front walk, the same stones from the
// gateway at the garden's front in to the path's first stone (seen once the
// view is turned round). The same plans keep the grass off the slabs (and let
// a little grow in the joints) in Ground.tsx, so both always agree.
import { useEffect, useMemo } from "react";
import { COMPANION_BUDGET, makeFlagstones, makeJointMoss, makePathBed, pathPlan, walkPlan, type PathPlan } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";

function Paving({ plan, quality, name }: { plan: PathPlan; quality: Quality; name: string }) {
  const { flagSides } = COMPANION_BUDGET[quality];
  const mats = gardenMaterials();
  const flags = useMemo(() => makeFlagstones(plan, flagSides), [plan, flagSides]);
  const strip = useMemo(() => makePathBed(plan), [plan]);
  const moss = useMemo(() => makeJointMoss(plan, quality === "lite" ? 0.5 : 1), [plan, quality]);
  useEffect(() => () => flags.dispose(), [flags]);
  useEffect(() => () => moss.dispose(), [moss]);
  useEffect(() => () => strip.dispose(), [strip]);

  return (
    <group name={name}>
      <mesh geometry={strip} material={mats.pathBed} receiveShadow />
      <mesh geometry={flags} material={mats.stone} castShadow={quality !== "lite"} receiveShadow />
      <mesh geometry={moss} material={mats.moss} receiveShadow />
    </group>
  );
}

export function Path({ seed, quality }: { seed: string; quality: Quality }) {
  const plan = useMemo(() => pathPlan(seed), [seed]);
  const walk = useMemo(() => walkPlan(seed), [seed]);
  return (
    <>
      <Paving plan={plan} quality={quality} name="path" />
      <Paving plan={walk} quality={quality} name="walk" />
    </>
  );
}
