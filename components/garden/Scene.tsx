"use client";
// The scene graph. The frame order is set by useFrame priorities, not by tree
// order: the clock runs at -10 and writes the shared env before everything at
// 0 reads it, and the effect composer renders last at 1. Among the priority-0
// subscribers, tree order decides, so the plant (which writes env.headPos) sits
// before the camera rig and the effects that read it. (A tier prepared out of
// sight joins the loop when it is mounted, after the camera rig, so after a
// swap the rig eases toward the head as it stood a frame earlier; its easing
// hides that.)
// Everything the quality tier changes is in the tier's layer (TierLayers): the
// lights, the lawn, the near garden, the backdrop, the plant, the air and the
// post chain. The clock, the sky, the far woods, the environment map and fog,
// and the camera are the same in every tier and are shared.
// The effects get their own Suspense boundary so the garden stays visible if a
// pass ever suspends on an asset; with the current stack nothing does, SMAA
// loads its lookup textures asynchronously without suspending.
// The plant grows from the crown of its mound in the raised bed, not from the
// lawn, so a seedling stands on the mulch instead of under it. The far woods
// close the view beyond the hedges for wide screens and side orbits.
import { Suspense } from "react";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { Atmosphere } from "@/components/garden/Atmosphere";
import { CameraRig } from "@/components/garden/CameraRig";
import { Clock } from "@/components/garden/Clock";
import { Effects } from "@/components/garden/Effects";
import { FarWoods } from "@/components/garden/FarWoods";
import { Garden } from "@/components/garden/Garden";
import { Backdrop } from "@/components/garden/Backdrop";
import { Ground } from "@/components/garden/Ground";
import { SceneLighting, TierLights } from "@/components/garden/Lights";
import { Plant } from "@/components/garden/Plant";
import { SkyDome } from "@/components/garden/SkyDome";
import { TierLayers } from "@/components/garden/TierLayers";

export function Scene() {
  return (
    <>
      <Clock />
      <SkyDome />
      <SceneLighting />
      <TierLayers>
        <TierLights />
        <Ground />
        <Garden />
        <Backdrop />
        <group position-y={HERO_GROUND_Y}>
          <Plant />
        </group>
        <Atmosphere />
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      </TierLayers>
      <FarWoods />
      <CameraRig />
    </>
  );
}
