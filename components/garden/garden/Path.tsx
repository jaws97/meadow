"use client";
// The stepping-stone path: a strip of trodden earth along the owner's path
// line, from the lawn's front-left edge round the bed to the arch, with
// irregular flagstones laid in it, some single, some in pairs. The same plan
// keeps the grass off the stones in Ground.tsx, so both always agree.
import { useEffect, useMemo } from "react";
import { COMPANION_BUDGET, makeFlagstones, makePathBed, pathPlan } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";

export function Path({ seed, quality }: { seed: string; quality: Quality }) {
  const { flagSides } = COMPANION_BUDGET[quality];
  const mats = gardenMaterials();
  const plan = useMemo(() => pathPlan(seed), [seed]);
  const flags = useMemo(() => makeFlagstones(plan, flagSides), [plan, flagSides]);
  const strip = useMemo(() => makePathBed(plan), [plan]);
  useEffect(() => () => flags.dispose(), [flags]);
  useEffect(() => () => strip.dispose(), [strip]);

  return (
    <group name="path">
      <mesh geometry={strip} material={mats.pathBed} receiveShadow />
      <mesh geometry={flags} material={mats.stone} receiveShadow />
    </group>
  );
}
