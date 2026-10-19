"use client";
// The personal garden's scene (components/garden/Scene.tsx), part for part,
// with the party camera in place of the orbit rig: the same sky, lights,
// lawn, bed, backdrop and hero, so the big screen shows exactly the garden
// colleagues will open on their own phones. The frame order is the garden's:
// the clock at -10 writes the shared env first, the plant writes the flower
// head before the camera (tree order among priority-0 subscribers) and the
// effects read both, drawing last.
//
// The party trailer (components/party/trailer) plays here too: its director
// writes each frame's hour, growth and shot ahead of the clock, and its doe
// is built and prepared with the garden, off stage until her cue.
import { Suspense } from "react";
import { PartyCamera } from "@/components/party/PartyCamera";
import { TrailerDirector, TrailerDoe } from "@/components/party/trailer/Director";
import { Atmosphere } from "@/components/garden/Atmosphere";
import { Backdrop } from "@/components/garden/Backdrop";
import { Clock } from "@/components/garden/Clock";
import { Effects } from "@/components/garden/Effects";
import { FarWoods } from "@/components/garden/FarWoods";
import { Garden } from "@/components/garden/Garden";
import { Ground } from "@/components/garden/Ground";
import { Lights } from "@/components/garden/Lights";
import { Plant } from "@/components/garden/Plant";
import { SkyDome } from "@/components/garden/SkyDome";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";

export function PartyScene() {
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
      <TrailerDoe />
      <PartyCamera />
      <TrailerDirector />
      <Suspense fallback={null}>
        <Effects />
      </Suspense>
    </>
  );
}
