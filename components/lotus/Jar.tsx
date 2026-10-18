"use client";
/* eslint-disable react-hooks/immutability --
   The seed's light (its emissive and its halo) is a three.js material written in the frame loop. */
// The seed's first days (art direction 4.1): a plain kitchen glass jar on a flat fieldstone at the urli's front right
// foot, water to 80%, the dark glossy seed on the bottom with its short white root, and the garden's seed of light
// breathing inside it (SeedMound's 5.5 s breath). Through clear water the light is a crisp point; as the water clouds
// it spreads into a milky halo, an honest cue for fresh water. In the urli frame. A live lotus (the product's courtyard)
// rewrites the look's clarity in place as it eases, and a kind word (`live`'s glow) brightens the light for its hour.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { SphereGeometry } from "three";
import type * as THREE from "three";
import { env } from "@/lib/garden/env";
import { useLayerFrame } from "@/components/garden/TierLayers";
import { gardenMaterials } from "@/components/garden/garden/materials";
import { makeJarGeometry, type Tier } from "@/components/lotus/geometry";
import { haloMaterial, jarGlassMaterial, jarWaterMaterial, rootMaterial, seedMaterial, seedSpotMaterial } from "@/components/lotus/materials";
import { JAR_SPOT, SEED_IN_JAR, type JarLook } from "@/components/lotus/look";

/** The seed of light's breath, as the seed mound's (components/garden/garden/SeedMound.tsx). */
const BREATH_S = 5.5;

/**
 * In the urli frame by default (JAR_SPOT, at the urli's foot); the pond places it on a coping stone with `at` (its
 * foot) and leaves out the jar's own stone.
 */
export function Jar({
  jar,
  tier,
  groundY,
  at,
  stone = true,
  live,
}: {
  jar: JarLook;
  tier: Tier;
  groundY?: number;
  at?: readonly [number, number, number];
  stone?: boolean;
  live?: RefObject<{ glow: number } | null>;
}) {
  const geo = useMemo(() => makeJarGeometry(tier), [tier]);
  // the filed spot: a small pale patch on the seed's end, away from where the root comes out
  const spot = useMemo(() => new SphereGeometry(0.0027, 10, 8).scale(0.55, 0.85, 1), []);
  useEffect(
    () => () => {
      for (const g of [geo.glass, geo.water, geo.seed, geo.root, geo.stone]) g.dispose();
      spot.dispose();
    },
    [geo, spot],
  );
  const halo = useRef<THREE.Sprite>(null);
  const seedMat = seedMaterial();
  const haloMat = haloMaterial();

  useLayerFrame(() => {
    const kind = 1 + 0.6 * (live?.current?.glow ?? 0);
    const breath = (0.85 + 0.15 * Math.sin((env.time / BREATH_S) * Math.PI * 2)) * kind;
    const night = env.nightness;
    seedMat.emissiveIntensity = (0.12 + 0.1 * night) * breath;
    const s = halo.current;
    if (s) {
      // crisp in clear water, a milky spread when cloudy; brighter as the light goes, and still seen by day
      const cloudy = 1 - jar.clarity;
      s.scale.setScalar((0.03 + 0.07 * cloudy) * (0.9 + 0.1 * breath));
      haloMat.opacity = (0.6 + 0.4 * night) * (0.8 - 0.35 * cloudy) * breath;
    }
  });

  if (!jar.show) return null;
  const sx = SEED_IN_JAR[0] - JAR_SPOT[0];
  const sz = SEED_IN_JAR[2] - JAR_SPOT[2];
  return (
    <group name="jar" position={at ? [at[0], at[1], at[2]] : [JAR_SPOT[0], groundY ?? JAR_SPOT[1], JAR_SPOT[2]]}>
      {stone ? <mesh geometry={geo.stone} material={gardenMaterials().stone} castShadow receiveShadow /> : null}
      <group position-y={stone ? 0.011 : 0} rotation-y={0.4}>
        <mesh geometry={geo.seed} material={seedMat} position={[sx, 0.0155, sz]} castShadow />
        <mesh geometry={spot} material={seedSpotMaterial()} position={[sx - 0.0072, 0.0172, sz + 0.005]} rotation-y={0.6} />
        <mesh geometry={geo.root} material={rootMaterial()} position={[sx, 0.0155, sz]} scale={0.6 + 0.6 * jar.root} />
        <sprite ref={halo} material={haloMat} position={[sx, 0.016, sz]} renderOrder={4} />
        <mesh geometry={geo.water} material={jarWaterMaterial(jar.clarity)} renderOrder={3} />
        <mesh geometry={geo.glass} material={jarGlassMaterial(tier)} renderOrder={5} castShadow />
      </group>
    </group>
  );
}
