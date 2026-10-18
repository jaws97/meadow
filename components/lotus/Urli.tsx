"use client";
/* eslint-disable react-hooks/immutability --
   The water's and the light play's uniforms and the shared vessel material are three.js objects written in the frame
   loop, which is how an R3F part animates without re-rendering; the React Compiler lint reads those writes as
   mutating a hook's value. They never feed back into what React renders. */
// The vessel and what it holds: the urli (option A, B or C), its mud, the water at the level the look asks for, and
// the light play on the far inner wall. Drawn in the urli frame (y = 0 at the mound's crown, frame.ts); the parent
// places and scales it. The water's level and radius follow waterMM on the model's own cone, so 1 L in the 35 cm
// bowl is the same 8 mm in the picture as in the arithmetic.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { weather } from "@/components/garden/garden/weather";
import { BAND_SEGS, makeMudGeometry, makeUrliGeometry, makeWallBand, makeWaterDisc, MUD_TESS, WATER_TESS, type Tier } from "@/components/lotus/geometry";
import { causticMaterial, causticUniforms, mudMaterial, setClarity, urliMaterial, waterMaterial, waterUniforms } from "@/components/lotus/materials";
import { URLI, waterR, waterY } from "@/components/lotus/frame";
import type { LotusLook } from "@/components/lotus/look";
import type { MudState } from "@/components/lotus/textures";
import type { Vessel } from "@/components/lotus/params";

/** The mud's look from the model's moisture (section 3.4): glistening wet, matte and paling, then cracked. */
export function mudState(moisture: number): MudState {
  if (moisture >= 0.45) return "wet";
  if (moisture >= 0.15) return "drying";
  return "cracked";
}

const WHITE = new THREE.Color(1, 1, 1);
const WET_TINT = new THREE.Color(0.85, 0.85, 0.85);
const sunH = new THREE.Vector2();

export function Urli({ vessel, tier, look }: { vessel: Vessel; tier: Tier; look: LotusLook }) {
  const urli = useMemo(() => makeUrliGeometry(vessel, tier), [vessel, tier]);
  const mud = useMemo(() => makeMudGeometry(MUD_TESS[tier][0], MUD_TESS[tier][1], 5), [tier]);
  const water = useMemo(() => makeWaterDisc(WATER_TESS[tier][0], WATER_TESS[tier][1]), [tier]);
  const mm = look.waterMM;
  const hasWater = mm > 0.5;
  const band = useMemo(() => (hasWater ? makeWallBand(waterY(mm), URLI.brimY - 0.0015, BAND_SEGS[tier]) : null), [hasWater, mm, tier]);
  useEffect(() => () => urli.dispose(), [urli]);
  useEffect(() => () => mud.dispose(), [mud]);
  useEffect(() => () => water.dispose(), [water]);
  useEffect(() => () => band?.dispose(), [band]);

  const urliMat = urliMaterial(vessel, tier);
  const waterMat = waterMaterial();
  const mudMat = mudMaterial(mudState(look.mudMoisture));
  const waterRef = useRef<THREE.Mesh>(null);

  // the level, its radius and the leaves the meniscus rings, set as the look changes, before the frame is drawn (no
  // easing: a frame is a frame)
  useLayoutEffect(() => {
    setClarity(waterMat, look.algae);
    waterUniforms.uRadius.value = waterR(mm);
    const leaves = waterUniforms.uLeaves.value;
    for (let i = 0; i < leaves.length; i++) {
      const f = look.floating[i];
      if (f && !f.onMud && hasWater && f.tilt < 0.05) leaves[i].set(f.x, f.z, f.r * 0.98);
      else leaves[i].set(0, 0, 0);
    }
    const w = waterRef.current;
    if (w) {
      w.position.y = waterY(mm);
      w.scale.set(waterR(mm), 1, waterR(mm));
    }
    causticUniforms.uBottom.value = waterY(mm);
    causticUniforms.uTop.value = URLI.brimY - 0.0015;
  }, [waterMat, look, mm, hasWater]);

  useFrame(() => {
    waterUniforms.uTime.value = env.time;
    waterUniforms.uWind.value = env.wind;
    waterUniforms.uRain.value = env.rain;
    waterUniforms.uNight.value = env.nightness;
    waterUniforms.uSkyHorizon.value.copy(env.sky.horizon);
    waterUniforms.uSkyZenith.value.copy(env.sky.zenith);
    // the light play: sun up, the sky clear, the water rippling (never on the lite tier)
    const sunUp = THREE.MathUtils.smoothstep(env.sun.altitude, 0.05, 0.5);
    causticUniforms.uTime.value = env.time;
    causticUniforms.uStrength.value = tier === "lite" ? 0 : 0.55 * sunUp * (1 - env.cloud) * (0.35 + 0.65 * Math.min(1, env.wind)) * (1 - 0.8 * look.algae);
    causticUniforms.uColor.value.copy(env.sky.sun);
    sunH.set(env.sun.dir.x, env.sun.dir.z);
    if (sunH.lengthSq() < 1e-6) sunH.set(0, 1);
    causticUniforms.uSun.value.copy(sunH.normalize());
    // the vessel darkens and shines in the rain, like the can
    urliMat.color.copy(WHITE).lerp(WET_TINT, weather.wet);
    // (every option's roughness lives in its map, the factor at 1)
    urliMat.roughness = 1 - 0.4 * weather.wet;
  });

  return (
    <group name="urli">
      <mesh geometry={urli} material={urliMat} castShadow receiveShadow />
      <mesh geometry={mud} material={mudMat} position-y={URLI.mudY} receiveShadow />
      <mesh ref={waterRef} geometry={water} material={waterMat} visible={hasWater} renderOrder={2} receiveShadow position-y={waterY(mm)} scale={[waterR(mm), 1, waterR(mm)]} />
      {band && tier !== "lite" ? <mesh geometry={band} material={causticMaterial()} renderOrder={3} /> : null}
    </group>
  );
}
