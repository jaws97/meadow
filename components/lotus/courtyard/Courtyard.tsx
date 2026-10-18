"use client";
/* eslint-disable react-hooks/immutability --
   The lamps' flames, halos and lights, the shared courtyard materials and the lite lamp's uniforms are three.js
   objects written in the frame loop, which is how an R3F part animates without re-rendering; nothing they write
   feeds back into what React renders. */
// The lotus garden's own place (plan.ts): the granite steps round the tank and the court's paving, the laterite walls
// with the niche, the veranda behind the camera, the banana, the areca palms and the jasmine, the brass lamps and the
// clay lamps, and the brass water pot. It replaces the flower garden's set (its bed, lantern, arch, hedges and lawn)
// in the pond view; the sky, the sun and the post-processing are still the garden's own.
//
// The lamps are lit with the garden's own clock (weather.lit: as the light goes, and on a dark rainy afternoon), so
// the oil lamps burn before dawn and from dusk; the flames breathe with the candle's slow swell (weather.flicker) and
// each tongue shivers on its own, all on the garden clock, so a still frame holds them. On cinematic each lamp has its
// own warm point light (hidden by day with the garden's light sets); balanced has the niche's and one for the two on
// the steps; lite has none and lights the lotus and the stone through the garden's lamp patch instead.
//
// What the water mirrors (its planar reflection, KoiPond.tsx) is marked here: the steps, the walls and the niche, the
// lamps and their flames, the plants.
//
// The brass water pot stands on its step; in the product a top-up tips it over the coping for a moment and pours
// (components/lotus/product/Moments.tsx writes kodamPose, which the lamps' frame applies), then sets it back.
import { useLayerFrame } from "@/components/garden/TierLayers";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { lampUniforms } from "@/lib/garden/dressing";
import { OPTIONAL_LIGHT } from "@/components/garden/lightSets";
import { weather } from "@/components/garden/garden/weather";
import type { Tier } from "@/components/lotus/geometry";
import { haloTexture } from "@/components/lotus/textures";
import { DIYAS, KODAM, LAMP_H, LAMPS } from "@/components/lotus/courtyard/plan";
import { makeCourtStones, makeCourtWalls, makeVeranda } from "@/components/lotus/courtyard/geometry";
import { makeArecas, makeBanana, makeJasmine } from "@/components/lotus/courtyard/plants";
import { makeDiya, makeFlame, makeKodam, makeLamp } from "@/components/lotus/courtyard/props";
import { CourtLight } from "@/components/lotus/courtyard/CourtLight";
import {
  arecaTrunkMaterial,
  bananaLeafMaterial,
  bananaStemMaterial,
  beddingMaterial,
  brassMaterial,
  clayMaterial,
  dressedMaterial,
  foliageMaterial,
  graniteMaterial,
  jasmineFlowerMaterial,
  lateriteMaterial,
  doorwayMaterial,
  limeMaterial,
  oilMaterial,
  teakMaterial,
  tileMaterial,
  waterLightUniforms,
  wetCourt,
} from "@/components/lotus/courtyard/materials";

export const COURTYARD_NAME = "courtyard";
export const COURT_PLANTS_NAME = "courtyard-plants";
export const COURT_LAMPS_NAME = "courtyard-lamps";

/**
 * The brass water pot's pose for a pour: tipped toward the water about the foot of its base nearest it (radians), and
 * lifted a little (m). At rest both are 0, as the concepts page always has them.
 */
export const kodamPose = { tilt: 0, lift: 0 };
/** The pot's base radius: it tips about that edge (props.ts makeKodam). */
export const KODAM_FOOT = 0.09;

/** The lamps' warm light (an oil flame, about 1900 K). */
const FLAME_COLOUR = new THREE.Color("#ffad5e");
/** Candela per lamp at full flame (five wicks), the niche's (one small lamp in a recess), and the light's reach. */
const LAMP_CANDELA = 0.9;
const NICHE_CANDELA = 0.45;
const LAMP_REACH = 4.5;

let flameMat: THREE.MeshBasicMaterial | null = null;
/** The flames: vertex-coloured HDR light, added, so they bloom and never take a shadow. */
function flameMaterial(): THREE.MeshBasicMaterial {
  if (!flameMat) {
    flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  return flameMat;
}

let haloMat: THREE.SpriteMaterial | null = null;
function lampHaloMaterial(): THREE.SpriteMaterial {
  if (!haloMat) {
    haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: new THREE.Color(1.6, 1.0, 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
  }
  return haloMat;
}

interface FlameRef {
  mesh: THREE.Mesh | null;
  phase: number;
}

/** The lamps, clay lamps, flames, halos and lights. */
function Lamps({ tier }: { tier: Tier }) {
  const geo = useMemo(
    () => ({
      tall: makeLamp(tier, LAMP_H.tall, 1),
      niche: makeLamp(tier, LAMP_H.niche, 0.62),
      diya: makeDiya(tier),
      flame: makeFlame(),
      kodam: makeKodam(tier),
    }),
    [tier],
  );
  useEffect(
    () => () => {
      for (const g of [geo.tall.brass, geo.niche.brass, geo.diya.clay, geo.diya.oil, geo.flame, geo.kodam]) g.dispose();
    },
    [geo],
  );
  const flames = useRef<FlameRef[]>([]);
  const diyas = useRef<THREE.Group>(null);
  const kodam = useRef<THREE.Group>(null);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const halos = useRef<(THREE.Sprite | null)[]>([]);
  const fm = flameMaterial();
  const hm = lampHaloMaterial();

  // which lights each tier carries: cinematic one per lamp; balanced the niche's and one between the two on the steps
  const lightSpots = useMemo(() => {
    const out: { at: THREE.Vector3; candela: number }[] = [];
    if (tier === "lite") return out;
    const glowOf = (i: number) => {
      const l = LAMPS[i];
      const g = l.kind === "tall" ? geo.tall.glow : geo.niche.glow;
      return new THREE.Vector3(l.x, l.y, l.z).add(g);
    };
    if (tier === "cinematic") {
      LAMPS.forEach((l, i) => {
        const at = glowOf(i);
        // the niche's light sits a little forward of the lamp so it fills the recess and spills out onto the steps
        if (l.kind === "niche") at.z += 0.05;
        out.push({ at, candela: l.kind === "tall" ? LAMP_CANDELA : NICHE_CANDELA });
      });
    } else {
      const a = glowOf(0);
      const b = glowOf(1);
      out.push({ at: a.add(b).multiplyScalar(0.5), candela: LAMP_CANDELA * 1.7 });
      const n = glowOf(2);
      n.z += 0.05;
      out.push({ at: n, candela: NICHE_CANDELA });
    }
    return out;
  }, [tier, geo]);

  useEffect(() => {
    // the lite tier's stand-in: the garden's lamp patch, from between the two tall lamps
    if (tier !== "lite") return;
    lampUniforms.uLampPos.value.set(0, LAMPS[0].y + LAMP_H.tall + 0.05, LAMPS[0].z);
    lampUniforms.uLampColor.value.copy(FLAME_COLOUR);
    return () => {
      lampUniforms.uLampIntensity.value = 0;
    };
  }, [tier]);

  useLayerFrame(() => {
    const lit = weather.lit;
    const t = env.time;
    const on = lit > 0.02;
    for (const f of flames.current) {
      const m = f.mesh;
      if (!m) continue;
      m.visible = on;
      if (!on) continue;
      // each tongue shivers on its own over the lamp's slow swell
      const shiver = Math.sin(t * 9.3 + f.phase) * 0.5 + Math.sin(t * 15.7 + f.phase * 2.3) * 0.3;
      const s = lit * (0.92 + 0.12 * (weather.flicker - 1) * 8 + 0.06 * shiver);
      m.scale.set(0.95 + 0.05 * Math.sin(t * 6 + f.phase), Math.max(0.05, s), 0.95);
      m.rotation.z = 0.06 * Math.sin(t * 2.1 + f.phase);
    }
    if (diyas.current) diyas.current.visible = on;
    lights.current.forEach((l, i) => {
      if (l) l.intensity = lightSpots[i].candela * lit * weather.flicker;
    });
    hm.opacity = 0.32 * lit * weather.flicker;
    for (const h of halos.current) if (h) h.visible = on;
    if (tier === "lite") lampUniforms.uLampIntensity.value = LAMP_CANDELA * 2.2 * lit * weather.flicker;
    const k = kodam.current;
    if (k) {
      k.rotation.z = -kodamPose.tilt;
      k.position.y = KODAM.y + kodamPose.lift;
    }
  });

  let fi = 0;
  const flame = (at: THREE.Vector3, key: string) => {
    const i = fi++;
    return (
      <mesh
        key={key}
        geometry={geo.flame}
        material={fm}
        position={at}
        renderOrder={6}
        visible={false}
        ref={(m) => {
          flames.current[i] = { mesh: m, phase: i * 1.73 };
        }}
      />
    );
  };

  return (
    <group name={COURT_LAMPS_NAME}>
      <group userData={{ pondReflect: true }}>
        {LAMPS.map((l, li) => {
          const g = l.kind === "tall" ? geo.tall : geo.niche;
          return (
            <group key={li} position={[l.x, l.y, l.z]} rotation-y={l.yaw}>
              <mesh geometry={g.brass} material={brassMaterial()} castShadow receiveShadow />
              {g.wicks.map((w, k) => flame(w, `f${li}-${k}`))}
            </group>
          );
        })}
        <group ref={diyas} visible={false}>
          {DIYAS.map((d, i) => (
            <group key={i} position={[d.x, d.y, d.z]} rotation-y={Math.PI / 2 + (i % 3) * 0.4 - 0.4}>
              <mesh geometry={geo.diya.clay} material={clayMaterial()} receiveShadow />
              <mesh geometry={geo.diya.oil} material={oilMaterial()} />
              {flame(geo.diya.wick, `d${i}`)}
            </group>
          ))}
        </group>
        <group ref={kodam} position={[KODAM.x + KODAM_FOOT, KODAM.y, KODAM.z]}>
          <mesh geometry={geo.kodam} material={brassMaterial()} position-x={-KODAM_FOOT} castShadow receiveShadow />
        </group>
      </group>
      {LAMPS.map((l, li) => {
        const g = l.kind === "tall" ? geo.tall : geo.niche;
        return (
          <sprite
            key={li}
            ref={(s) => {
              halos.current[li] = s;
            }}
            material={hm}
            position={[l.x, l.y + g.glow.y - 0.02, l.z + (l.kind === "niche" ? 0.04 : 0)]}
            scale={l.kind === "tall" ? 0.42 : 0.26}
            renderOrder={7}
            visible={false}
          />
        );
      })}
      {lightSpots.map((s, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          userData={OPTIONAL_LIGHT}
          position={s.at}
          color={FLAME_COLOUR}
          intensity={0}
          distance={LAMP_REACH}
          decay={2}
        />
      ))}
    </group>
  );
}

/** The banana, the areca palms and the jasmine. */
function Plants({ tier }: { tier: Tier }) {
  const geo = useMemo(() => ({ banana: makeBanana(tier), areca: makeArecas(tier), jasmine: makeJasmine(tier) }), [tier]);
  useEffect(
    () => () => {
      for (const g of [geo.banana.stems, geo.banana.leaves, geo.areca.trunks, geo.areca.crowns, geo.jasmine.leaves, geo.jasmine.flowers, geo.jasmine.canes]) g.dispose();
    },
    [geo],
  );
  const shadows = tier !== "lite";
  const flowerMat = jasmineFlowerMaterial();
  useLayerFrame(() => {
    // jasmine opens toward evening and its white holds the last light: a faint inner glow at dusk and night
    flowerMat.emissiveIntensity = 0.12 * env.nightness;
  });
  return (
    <group name={COURT_PLANTS_NAME} userData={{ pondReflect: true }}>
      <mesh geometry={geo.banana.stems} material={bananaStemMaterial()} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.banana.leaves} material={bananaLeafMaterial()} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.areca.trunks} material={arecaTrunkMaterial()} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.areca.crowns} material={foliageMaterial("areca", 0.55)} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.jasmine.canes} material={foliageMaterial("cane", 0.8)} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.jasmine.leaves} material={foliageMaterial("jasmine", 0.38)} castShadow={shadows} receiveShadow />
      <mesh geometry={geo.jasmine.flowers} material={flowerMat} receiveShadow />
    </group>
  );
}

/** The whole courtyard (everything but the tank's water and what is in it: KoiPond.tsx). */
export function Courtyard({ tier }: { tier: Tier }) {
  const stones = useMemo(() => makeCourtStones(tier), [tier]);
  const walls = useMemo(() => makeCourtWalls(), []);
  const veranda = useMemo(() => makeVeranda(tier), [tier]);
  useEffect(
    () => () => {
      stones.granite.dispose();
      stones.bedding.dispose();
    },
    [stones],
  );
  useEffect(
    () => () => {
      for (const g of [walls.laterite, walls.niche, walls.dressed]) g.dispose();
    },
    [walls],
  );
  useEffect(
    () => () => {
      for (const g of [veranda.plinth, veranda.pillars, veranda.roof, veranda.house, veranda.door]) g.dispose();
    },
    [veranda],
  );

  useLayerFrame(() => {
    wetCourt(weather.wet);
    // the water's light on the stone: the sun on the water, gone under cloud, in the rain and at night
    const sunUp = THREE.MathUtils.smoothstep(env.sun.altitude, 0.08, 0.6);
    waterLightUniforms.uWaterLight.value = tier === "lite" ? 0 : 1.1 * sunUp * (1 - env.cloud) * (1 - 0.8 * env.rain) * Math.min(1.4, env.sky.sunIntensity);
    waterLightUniforms.uWaterLightColor.value.copy(env.sky.sun);
    waterLightUniforms.uWaterLightTime.value = env.time;
  });

  const shadows = tier !== "lite";
  return (
    <group name={COURTYARD_NAME}>
      <group userData={{ pondReflect: true }}>
        <mesh name="court-granite" geometry={stones.granite} material={graniteMaterial(tier)} castShadow={shadows} receiveShadow />
        <mesh geometry={stones.bedding} material={beddingMaterial()} receiveShadow />
        <mesh name="court-walls" geometry={walls.laterite} material={lateriteMaterial(tier)} castShadow={shadows} receiveShadow />
        <mesh geometry={walls.niche} material={lateriteMaterial(tier)} receiveShadow />
        <mesh geometry={walls.dressed} material={dressedMaterial(tier)} castShadow={shadows} receiveShadow />
      </group>
      <group name="court-veranda">
        <mesh geometry={veranda.plinth} material={dressedMaterial(tier)} receiveShadow />
        <mesh geometry={veranda.pillars} material={teakMaterial()} castShadow={shadows} receiveShadow />
        <mesh geometry={veranda.roof} material={tileMaterial()} castShadow={shadows} receiveShadow />
        <mesh geometry={veranda.house} material={limeMaterial()} receiveShadow />
        <mesh geometry={veranda.door} material={doorwayMaterial()} />
      </group>
      <Plants tier={tier} />
      <Lamps tier={tier} />
      <CourtLight />
    </group>
  );
}
