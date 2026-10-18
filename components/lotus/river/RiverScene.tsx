"use client";
// The Meadow's lazy river (Option A, the Rose Island moat) for /lotus-concepts?view=meadow: the whole Meadow on the
// river plan at its real scale, lit by the Meadow's own sky and lights, with the river, its bridges, pockets and lotus,
// the ring beds and their plants, the rose on its dais, and the Lantern Cart parked on the outer towpath beside the
// near bridge for scale. The owner keeps koi to the personal pond (the Meadow needs none), so the channel's twelve
// ambient koi (RiverKoi.tsx) show only with ?koi=1, kept for comparison.
//
// Frame order: the clock at -10 writes the shared env (held in still mode), the camera at -1 keeps the shadow box and
// the haze on the view, the sky and lights at -0.5, the cart's jar publishes its light at -0.45 and the guardian light
// follows at -0.4, the scene draws, and the ready flag counts frames after it.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { DaisRose } from "@/components/meadow/DaisRose";
import { FireflyTrolley, meadowLite } from "@/components/meadow/FireflyTrolley";
import { tangentYaw } from "@/components/meadow/layout";
import { updateEnv } from "@/lib/garden/env";
import { garden, type Quality } from "@/lib/garden/store";
import type { Tier } from "@/components/lotus/geometry";
import { KOI_STILL_TIME } from "@/components/lotus/koi";
import { hourFor, sceneKey, type ConceptParams } from "@/components/lotus/params";
import { ReadyFlag } from "@/components/lotus/ReadyFlag";
import { riverPlan, polar, type BedPlot, type RiverPlan } from "@/components/lotus/river/plan";
import { River } from "@/components/lotus/river/River";
import { DETAIL_REACH, RiverCamera } from "@/components/lotus/river/RiverCamera";
import { RiverGrounds } from "@/components/lotus/river/RiverGrounds";
import { RIVER_KOI_NAME, RiverKoi } from "@/components/lotus/river/RiverKoi";
import { heroFocus, OverflowUrli, RiverLotus } from "@/components/lotus/river/RiverLotus";
import { RiverPlants } from "@/components/lotus/river/RiverPlants";
import { RiverSky } from "@/components/lotus/river/RiverSky";

export const RIVER_NAME = "river-lotus";
/** The cart's chassis stands this high over the ground at rest (concepts/kit GROUND_Y). */
const CHASSIS_Y = 0.74;

/** As LotusScene's clock: the garden's env from the store's hour, held still for repeatable frames. */
function RiverClock({ still }: { still: boolean }) {
  useFrame((state, delta) => {
    const s = garden.get();
    updateEnv(s.hour, s.cloud, s.rain, s.wind, still ? KOI_STILL_TIME : state.clock.elapsedTime, still ? 0 : Math.min(delta, 0.1));
  }, -10);
  return null;
}

/** Where the cart is parked: at the visiting spot of the outer pocket nearest the near bridge's right, facing the bridge. */
export function cartSpot(P: RiverPlan): { x: number; z: number; a: number; yaw: number } {
  const pk = P.pockets.find((p) => p.bank === "out" && p.arc === 3 && p.place === 7)!;
  const a = pk.a;
  return { ...pk.park, a, yaw: tangentYaw(a) };
}

/** The bed plot the overflow urli stands on: bed 1's inner row, between the cart and the near bridge. */
export function urliPlot(P: RiverPlan): BedPlot {
  let best = P.plots[0];
  let bestD = Infinity;
  for (const p of P.plots) {
    if (p.ring !== 2) continue;
    const d = Math.abs(Math.atan2(Math.sin(p.a - 0.6), Math.cos(p.a - 0.6)));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function ParkedCart({ x, z, yaw, lite }: { x: number; z: number; yaw: number; lite: boolean }) {
  const wheels = useRef<Array<THREE.Group | null>>([]);
  return (
    <group name="river-cart" position={[x, CHASSIS_Y + 0.012, z]} rotation-y={yaw}>
      <FireflyTrolley wheels={wheels} lite={lite} groundY={0.012} />
    </group>
  );
}

export function RiverScene({ params, nonce, tier }: { params: ConceptParams; nonce: number; tier: Tier }) {
  const P = riverPlan();
  const lite = tier === "lite" || meadowLite();
  const cart = useMemo(() => cartSpot(P), [P]);
  const plot = useMemo(() => urliPlot(P), [P]);
  // the subject of each camera preset
  const focus = useMemo(() => {
    if (params.cam === "close") return heroFocus(P, params);
    if (params.cam === "bridge") {
      const p = polar(P.river.mid, (7 * Math.PI) / 4);
      return new THREE.Vector3(p.x, 0.5, p.z);
    }
    if (params.cam === "overview") return new THREE.Vector3(cart.x * 0.15, 0, cart.z * 0.15);
    // between the cart and the near bridge, over the middle of the water, so the river runs across the frame's middle
    const p = polar(P.river.mid, (cart.a + Math.PI / 4) / 2);
    return new THREE.Vector3(p.x, 0, p.z);
  }, [P, params, cart]);
  // a phone's narrow frame is aimed nearer the cart, past the bridge's deck, so the river crosses the whole width
  const portraitFocus = useMemo(() => {
    if (params.cam !== "product") return focus;
    const p = polar(P.river.mid, cart.a * 0.8 + (Math.PI / 4) * 0.2);
    return new THREE.Vector3(p.x, 0, p.z);
  }, [P, params.cam, cart, focus]);
  const key = sceneKey(params) + "|" + tier;
  const dais: Quality = tier === "lite" ? "lite" : "balanced";
  const shadows = !lite;

  return (
    <>
      <RiverClock still={params.still} />
      <RiverSky hour={hourFor(params)} shadowSize={lite ? 1024 : 2048} lite={lite} />
      <RiverLotus P={P} params={params} tier={tier} focus={focus} detail={DETAIL_REACH[params.cam]} />
      <OverflowUrli plot={plot} params={params} tier={tier === "cinematic" ? "balanced" : tier} />
      <RiverGrounds P={P} shadows={shadows} carpet={lite ? 1.3 : 2.4} />
      <River P={P} tier={tier} still={params.still} shadows={shadows} />
      {params.koi ? <RiverKoi tier={tier} /> : null}
      <RiverPlants P={P} skip={plot.index} shadows={shadows} />
      <DaisRose quality={dais} />
      <ParkedCart x={cart.x} z={cart.z} yaw={cart.yaw} lite={lite} />
      <RiverCamera cam={params.cam} focus={focus} portraitFocus={portraitFocus} frameKey={key + "|" + nonce} still={params.still} />
      <ReadyFlag sceneKey={key} lotusName={RIVER_NAME} tier={tier} extra={{ river: "river", beds: "river-beds", grounds: "river-grounds", cart: "river-cart", koi: RIVER_KOI_NAME, urli: "river-urli" }} />
    </>
  );
}
