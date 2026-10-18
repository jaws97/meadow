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
//
// A lotus has its own place instead of the flower garden's (its lawn, bed,
// hedges, plant, butterflies and far woods): the courtyard round its koi pond
// (components/lotus/product/LotusGarden), in the same tier layers, under the
// same clock, sky, lights, post-processing and camera. Its code is a chunk of
// its own (React.lazy, as Next 16.4's lazy-loading guide describes), so a soil
// flower's garden never downloads it. While that chunk loads the whole scene
// waits in the canvas's Suspense boundary (GardenCanvas): under the loading
// veil the opening then compiles the courtyard with everything else (when the
// lotus arrives after the opening has begun, as /api/me answers, it starts
// again for it: RenderBudget reopenUnderVeil), and on a swap from a soil
// flower the garden is behind the soft dim, which the swap holds
// (lib/garden/swapGate) until the courtyard has compiled and pre-drawn itself
// out of sight. A chunk that fails to load (the venue's Wi-Fi) is asked for
// again a couple of times; the garden page never falls over for it.
import { Component, createElement, lazy, Suspense, useState, type ReactNode } from "react";
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
import { holdSwap } from "@/lib/garden/swapGate";
import { underVeil } from "@/lib/garden/quality";
import { garden, useGarden } from "@/lib/garden/store";
import { isLotus } from "@/lib/plant/species";
import { loadCourtyard, preloadCourtyard } from "@/components/lotus/product/preload";
import { courtyardPending, courtyardReady } from "@/components/lotus/product/stage";

// A plant swap on a showing garden that brings in a lotus is held until its courtyard is ready to be seen (the
// courtyard says so: product/stage). Under the veil the swap is immediate and the opening compiles it. A lotus's
// chunk starts loading the moment the store names one.
if (typeof window !== "undefined") {
  let was = garden.get().speciesId;
  if (isLotus(was)) preloadCourtyard();
  garden.subscribe(() => {
    const now = garden.get().speciesId;
    if (now === was) return;
    was = now;
    if (!isLotus(now)) {
      courtyardReady();
      return;
    }
    preloadCourtyard();
    if (!underVeil()) holdSwap(courtyardPending());
  });
}

/** The courtyard's chunk, and a fresh one for each try after a failed load (React.lazy keeps a rejection for good). */
const courtyards = [lazy(loadCourtyard)];
const courtyardAt = (attempt: number) => (courtyards[attempt] ??= lazy(loadCourtyard));
/** Loads that have failed this visit: a courtyard mounting later starts from a fresh try, not a kept rejection. */
let failedLoads = 0;
/** How long to wait before asking for the chunk again, once per entry; after the last, the courtyard is let go. */
const RETRY_MS = [1500, 5000] as const;

/** Catches the courtyard's chunk failing to load, inside the canvas, so the page carries on without it. */
class CourtyardBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * A lotus's courtyard, its chunk asked for again after a failure; when every try has failed, the swap's dim is let go
 * (the scene shows its sky and the care layer carries on) rather than the page falling over.
 */
function LotusPlace() {
  const [first] = useState(() => failedLoads);
  const [attempt, setAttempt] = useState(first);
  const onFail = () => {
    failedLoads = Math.max(failedLoads, attempt + 1);
    const retried = attempt - first;
    if (retried < RETRY_MS.length) window.setTimeout(() => setAttempt(attempt + 1), RETRY_MS[retried]);
    else courtyardReady();
  };
  return (
    <CourtyardBoundary key={attempt} onFail={onFail}>
      {createElement(courtyardAt(attempt))}
    </CourtyardBoundary>
  );
}

export function Scene() {
  const lotus = useGarden((s) => isLotus(s.speciesId));
  return (
    <>
      <Clock />
      <SkyDome />
      <SceneLighting />
      <TierLayers>
        <TierLights />
        {lotus ? (
          <LotusPlace />
        ) : (
          <>
            <Ground />
            <Garden />
            <Backdrop />
            <group position-y={HERO_GROUND_Y}>
              <Plant />
            </group>
            <Atmosphere />
          </>
        )}
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      </TierLayers>
      {lotus ? null : <FarWoods />}
      <CameraRig />
    </>
  );
}
