"use client";
// The raised bed's mulch: the height field from lib/garden/dressing as one
// mesh, densest at the rim where the plateau rolls down under the stones,
// with the hero's mound and its watering saucer in the middle. Standing water
// gathers in the saucer in the rain (or when the bed is drowned) and drains
// away slowly after; the sheet is hidden whenever it has dried.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { COMPANION_BUDGET, makeBedGeometry, makePuddleGeometry } from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { gardenMaterials } from "@/components/garden/garden/materials";
import { weather } from "@/components/garden/garden/weather";

export function Bed({ quality }: { quality: Quality }) {
  const { bedRings, bedSegs } = COMPANION_BUDGET[quality];
  const mats = gardenMaterials();
  const bed = useMemo(() => makeBedGeometry(bedRings, bedSegs), [bedRings, bedSegs]);
  const puddle = useMemo(() => makePuddleGeometry(12, quality === "lite" ? 64 : 112), [quality]);
  useEffect(() => () => bed.dispose(), [bed]);
  useEffect(() => () => puddle.dispose(), [puddle]);

  const water = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (water.current) water.current.visible = weather.puddle > 0.02;
  });

  return (
    <group name="bed">
      <mesh geometry={bed} material={mats.mulch} receiveShadow />
      {/* Drawn after the mulch so the sheet blends over it; it writes no depth. */}
      <mesh ref={water} geometry={puddle} material={mats.water} renderOrder={1} visible={false} receiveShadow />
    </group>
  );
}
