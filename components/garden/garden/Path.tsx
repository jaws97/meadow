"use client";
// The flagstone path: irregular five- to seven-sided slabs laid close along
// the owner's path line, from the lawn's front-left edge round the bed to the
// arch, sunk so they stand about a centimetre proud of the soil, with moss in
// the tight joints between them and a strip of dark, mossy earth showing in
// the gaps and along the edges. The same plan keeps the grass off the slabs
// (and lets a little grow in the joints) in Ground.tsx, so both always agree.
import { useEffect, useMemo } from "react";
import { COMPANION_BUDGET, makeFlagstones, makeJointMoss, makePathBed, pathPlan } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";

export function Path({ seed, quality }: { seed: string; quality: Quality }) {
  const { flagSides } = COMPANION_BUDGET[quality];
  const mats = gardenMaterials();
  const plan = useMemo(() => pathPlan(seed), [seed]);
  const flags = useMemo(() => makeFlagstones(plan, flagSides), [plan, flagSides]);
  const strip = useMemo(() => makePathBed(plan), [plan]);
  const moss = useMemo(() => makeJointMoss(plan, quality === "lite" ? 0.5 : 1), [plan, quality]);
  useEffect(() => () => flags.dispose(), [flags]);
  useEffect(() => () => moss.dispose(), [moss]);
  useEffect(() => () => strip.dispose(), [strip]);

  return (
    <group name="path">
      <mesh geometry={strip} material={mats.pathBed} receiveShadow />
      <mesh geometry={flags} material={mats.stone} castShadow={quality !== "lite"} receiveShadow />
      <mesh geometry={moss} material={mats.moss} receiveShadow />
    </group>
  );
}
