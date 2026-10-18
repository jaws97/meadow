"use client";
// The concepts page's scene. The garden's own sky, sun and post-processing are imported as they are (the party
// screen's pattern, components/party/PartyScene.tsx: no tier layers, so every part reads the store's tier and runs its
// frame work every frame); the set round the lotus depends on the view:
// - The pond view (the default): the lotus garden's own place, a South Indian courtyard round the owner's small koi
//   tank (components/lotus/courtyard: granite steps down to the water, laterite walls with a lamp niche, brass oil
//   lamps, banana, areca palms and jasmine), with its own air (dawn mist, dragonflies by day, fireflies at dusk; no
//   butterflies: here the koi are the living things). None of the flower garden's set (its bed, lantern, path, arch,
//   hedges, lawn and woods) is drawn, so the two gardens never look the same.
// - The plot view: a stretch of a Meadow bed with the earlier urli on its plot (MeadowPlot), on the garden's lawn,
//   with its air, kept for later.
// The Meadow view (the lazy river) has its own canvas and scene (river/RiverStage.tsx), as the Meadow draws.
//
// Frame order, as the garden's: the clock at -10 writes the shared env (frozen in still mode), the garden's weather
// eases at -5 (the lamps' flames read it), the lotus writes the flower head and the koi swim at 0, the pond's
// reflection draws at 0.5, the composer draws at 1, and the ready flag counts frames after it.
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Atmosphere } from "@/components/garden/Atmosphere";
import { Effects } from "@/components/garden/Effects";
import { FarWoods } from "@/components/garden/FarWoods";
import { Ground } from "@/components/garden/Ground";
import { Lights } from "@/components/garden/Lights";
import { SkyDome } from "@/components/garden/SkyDome";
import { companionGrow, companionOpen } from "@/components/garden/garden/heroGrowth";
import { driveGardenMaterials, gardenMaterials } from "@/components/garden/garden/materials";
import { stepWeather, weather } from "@/components/garden/garden/weather";
import { swayUniforms } from "@/lib/garden/dressing";
import { updateEnv } from "@/lib/garden/env";
import { garden, useGarden } from "@/lib/garden/store";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { LotusCamera } from "@/components/lotus/LotusCamera";
import { POT_NAME } from "@/components/lotus/LotusPot";
import { MeadowPlot, POT_Y } from "@/components/lotus/MeadowPlot";
import { Pond, POND_NAME } from "@/components/lotus/KoiPond";
import { ReadyFlag } from "@/components/lotus/ReadyFlag";
import { lookFor } from "@/components/lotus/look";
import { sceneKey, type ConceptParams } from "@/components/lotus/params";
import { POT_FRAME } from "@/components/lotus/pond";
import { KOI_STILL_TIME } from "@/components/lotus/koi";
import { CourtyardAir, COURT_AIR_NAME } from "@/components/lotus/courtyard/Air";
import { Courtyard, COURT_LAMPS_NAME, COURT_PLANTS_NAME, COURTYARD_NAME } from "@/components/lotus/courtyard/Courtyard";

/** The garden clock's time in still mode: every sway, ripple, flicker, drifting cloud and koi holds here. */
const STILL_TIME = KOI_STILL_TIME;

/** As components/garden/Clock.tsx, with the clock held still for repeatable frames (the hour is always set by hand). */
function LotusClock({ still }: { still: boolean }) {
  useFrame((state, delta) => {
    const s = garden.get();
    updateEnv(s.hour, s.cloud, s.rain, s.wind, still ? STILL_TIME : state.clock.elapsedTime, still ? 0 : Math.min(delta, 0.1));
  }, -10);
  return null;
}

/** The near garden's weather (wet stone, the lantern's flame), as Garden.tsx does it. */
function GardenWeather() {
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    stepWeather(dt);
    driveGardenMaterials(gardenMaterials(), weather);
    const g = garden.get().growth;
    swayUniforms.uGrow.value = companionGrow(g);
    swayUniforms.uOpen.value = companionOpen(g);
  }, -5);
  return null;
}

/** What the ready flag counts besides the pond, for the pond view (the panel and window.__lotusStats). */
const COURT_PARTS = { court: COURTYARD_NAME, plants: COURT_PLANTS_NAME, lamps: COURT_LAMPS_NAME, air: COURT_AIR_NAME };

/** `nonce` reframes the camera without changing the look (the panel's Reframe button). */
export function LotusScene({ params, nonce }: { params: ConceptParams; nonce: number }) {
  const tier = useGarden((s) => s.quality);
  const look = useMemo(() => lookFor(params), [params]);
  const key = sceneKey(params) + "|" + tier;
  const pond = params.view === "pond";
  // the camera's subject in world space
  const focus = useMemo(() => {
    if (!pond) {
      const h = Math.max(0.16, look.focus[1] * 0.62);
      return new THREE.Vector3(0, POT_Y + h * PLANT_SCALE, 0);
    }
    return new THREE.Vector3(look.focus[0] + POT_FRAME[0], look.focus[1] + POT_FRAME[1], look.focus[2] + POT_FRAME[2]);
  }, [look, pond]);

  return (
    <>
      <LotusClock still={params.still} />
      <GardenWeather />
      <SkyDome />
      <Lights />
      {pond ? <Courtyard tier={tier} /> : <Ground />}
      {pond ? null : <FarWoods />}
      {pond ? (
        <Pond look={look} tier={tier} colour={params.colour} rain={params.rain} koi={params.koi} />
      ) : (
        <MeadowPlot look={look} vessel={params.vessel} tier={tier} colour={params.colour} rain={params.rain} stage={params.stage} />
      )}
      {pond ? <CourtyardAir tier={tier} /> : <Atmosphere />}
      <LotusCamera view={params.view} cam={params.cam} stage={params.stage} focus={focus} frameKey={key + "|" + nonce} still={params.still} />
      <ReadyFlag sceneKey={key} lotusName={pond ? POND_NAME : POT_NAME} tier={tier} extra={pond ? COURT_PARTS : undefined} />
      <Suspense fallback={null}>
        <Effects />
      </Suspense>
    </>
  );
}
