"use client";
// The garden lantern at the bed's left shoulder: a weathered oak post in a
// cut-stone plinth set into the kerb, an iron bracket, and a four-pane lamp
// with a candle in it. As the light goes the candle is lit: the flame cards
// show and breathe, the glass and wax warm, a soft halo blooms round the lamp,
// and a warm point light pools on the bed, the path and the hero's left side.
//
// The point light is always in the scene, at intensity 0 by day. Adding or
// removing a light changes the light count every lit program is compiled
// for, so toggling it at dusk would recompile every material in the garden.
// It casts no shadow: a point-light shadow is six extra depth passes.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { makeLantern } from "@/lib/garden/dressing";
import { LAYOUT } from "@/lib/garden/layout";
import { makeCanvas } from "@/lib/plant/textures";
import { gardenMaterials } from "@/components/garden/garden/materials";
import { weather } from "@/components/garden/garden/weather";

/** Candela at full flame; with decay 2 this lifts the bed a metre away to a warm glow at night. */
const LIGHT_INTENSITY = 2.4;
const LIGHT_DISTANCE = 6;
/** Halo sprite width in metres, and its HDR tint so the bloom pass softens it further. */
const HALO_SIZE = 0.5;
const HALO_TINT = new THREE.Color(1.6, 1.15, 0.7);

let haloTexture: THREE.CanvasTexture | null = null;

/** A soft radial falloff with a faint wider skirt, painted once. */
function getHaloTexture(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture;
  const W = 128;
  const c = makeCanvas(W, W);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,240,220,0.55)");
  g.addColorStop(0.4, "rgba(255,220,180,0.14)");
  g.addColorStop(1, "rgba(255,210,170,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

export function Lantern() {
  const mats = gardenMaterials();
  const geo = useMemo(makeLantern, []);
  useEffect(
    () => () => {
      geo.wood.dispose();
      geo.plinth.dispose();
      geo.iron.dispose();
      geo.glass.dispose();
      geo.candle.dispose();
      geo.flame.dispose();
    },
    [geo],
  );
  const halo = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: HALO_TINT,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => halo.dispose(), [halo]);

  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);

  /* eslint-disable react-hooks/immutability -- the memoised halo material is a
     three.js object the frame loop drives imperatively; React never re-renders on it. */
  useFrame(() => {
    const lit = weather.lit;
    const glow = lit * weather.flicker;
    if (light.current) light.current.intensity = LIGHT_INTENSITY * glow;
    const f = flame.current;
    if (f) {
      f.visible = lit > 0.02;
      // the flame stretches a little as it brightens
      f.scale.set(1, 0.95 + 1.5 * (weather.flicker - 1), 1);
    }
    const s = sprite.current;
    if (s) s.visible = lit > 0.02;
    halo.opacity = 0.6 * glow;
  });
  /* eslint-enable react-hooks/immutability */

  const { lamp, wick } = geo;
  return (
    <group name="lantern">
      <mesh geometry={geo.plinth} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={geo.wood} material={mats.wood} castShadow receiveShadow />
      <mesh geometry={geo.iron} material={mats.iron} castShadow receiveShadow />
      <mesh geometry={geo.candle} material={mats.candle} />
      {/* The glass draws after the candle and flame inside it. */}
      <mesh geometry={geo.glass} material={mats.glass} renderOrder={2} />
      <group ref={flame} position={wick} visible={false}>
        <mesh geometry={geo.flame} material={mats.flame} position={[-wick.x, -wick.y, -wick.z]} renderOrder={1} />
      </group>
      <sprite ref={sprite} material={halo} position={lamp} scale={HALO_SIZE} renderOrder={3} visible={false} />
      <pointLight
        ref={light}
        position={[lamp.x, lamp.y - 0.01, lamp.z]}
        color={LAYOUT.lantern.color}
        intensity={0}
        distance={LIGHT_DISTANCE}
        decay={2}
      />
    </group>
  );
}
