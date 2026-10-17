"use client";
// The scene graph. The frame order is set by useFrame priorities, not by tree
// order: the clock runs at -10 and writes the shared env before everything at
// 0 reads it, and the effect composer renders last at 1. Among the priority-0
// subscribers, tree order decides, so the plant (which writes env.headPos) sits
// before the camera rig and the effects that read it.
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
import { Lights } from "@/components/garden/Lights";
import { Plant } from "@/components/garden/Plant";
import { SkyDome } from "@/components/garden/SkyDome";

export function Scene() {
  return (
    <>
      <Clock />
      <SkyDome />
      <Lights />
      <Ground />
      <Garden />
      <Backdrop />
      <FarWoods />
      <group position-y={HERO_GROUND_Y}>
        <Plant />
      </group>
      <Atmosphere />
      <CameraRig />
      <Suspense fallback={null}>
        <Effects />
      </Suspense>
    </>
  );
}
