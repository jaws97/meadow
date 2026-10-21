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
// It casts no shadow: a point-light shadow is six extra depth passes. On the
// lite tier there is no point light at all (every lit pixel in the scene pays
// for one, all day, and phones are short of fill rate). Instead the garden's
// own materials near the lamp (lawn, mulch, stones, path, grass, companions,
// the hero's leaves) evaluate the same falloff in their shaders through
// lampUniforms, so the leaves round the lamp are lit with the ground rather
// than standing black against a painted pool of light.
//
// The party trailer strikes the lamp on a beat at nightfall through a gain in
// lib/garden/trailerFx: it scales the light, the halo and the lite tier's
// shader light, and the flame shrinks with it, but never shows or hides
// anything (the lantern's own dusk still decides that). It is 1 whenever the
// trailer is not playing, so the lantern burns exactly as above.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { lampUniforms, makeLantern } from "@/lib/garden/dressing";
import { LAYOUT } from "@/lib/garden/layout";
import { OPTIONAL_LIGHT } from "@/components/garden/lightSets";
import type { Quality } from "@/lib/garden/store";
import { makeCanvas } from "@/lib/plant/textures";
import { gardenMaterials } from "@/components/garden/garden/materials";
import { weather } from "@/components/garden/garden/weather";
import { trailerFx } from "@/lib/garden/trailerFx";
import { useLayerFrame } from "@/components/garden/TierLayers";

/** Candela at full flame; with decay 2 this lifts the bed a metre away to a warm glow at night. */
const LIGHT_INTENSITY = 1.7;
const LIGHT_DISTANCE = 6;
/** Halo sprite width in metres, and its HDR tint so the bloom pass softens it further. */
const HALO_SIZE = 0.5;
const HALO_TINT = new THREE.Color(1.6, 1.15, 0.7);
/** The lamp's colour for the lite tier's shader light; the real light takes the layout's colour directly. */
const LAMP_COLOR = new THREE.Color(LAYOUT.lantern.color);
/** How far the flame shrinks as the trailer's lamp gain falls from 1 to 0 (a turned-down wick, not a gone one). */
const FLAME_TURN_DOWN = 0.4;

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

export function Lantern({ quality }: { quality: Quality }) {
  const realLight = quality !== "lite";
  const mats = gardenMaterials();
  const geo = useMemo(() => makeLantern(), []);
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
  // The shader light sits where the real one would, and is switched off when this lantern unmounts.
  useEffect(() => {
    lampUniforms.uLampPos.value.set(geo.lamp.x, geo.lamp.y - 0.01, geo.lamp.z);
    lampUniforms.uLampColor.value.copy(LAMP_COLOR);
    return () => {
      lampUniforms.uLampIntensity.value = 0;
    };
  }, [geo]);

  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);

  /* eslint-disable react-hooks/immutability -- the memoised halo material and the shared lamp uniforms are
     three.js objects the frame loop drives imperatively; React never re-renders on them. */
  useLayerFrame(() => {
    const lit = weather.lit;
    // the trailer's lamp gain, 1 otherwise
    const gain = trailerFx.lamp;
    const glow = lit * weather.flicker * gain;
    if (light.current) light.current.intensity = LIGHT_INTENSITY * glow;
    const f = flame.current;
    if (f) {
      f.visible = lit > 0.02;
      // the flame stretches a little as it brightens, and is turned down with the trailer's gain (never up past 1)
      const turn = 1 - FLAME_TURN_DOWN * (1 - Math.min(1, gain));
      f.scale.set(turn, (0.95 + 1.5 * (weather.flicker - 1)) * turn, turn);
    }
    const s = sprite.current;
    if (s) s.visible = lit > 0.02;
    halo.opacity = 0.45 * glow;
    lampUniforms.uLampIntensity.value = realLight ? 0 : LIGHT_INTENSITY * glow;
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
      {realLight ? (
        <pointLight
          ref={light}
          userData={OPTIONAL_LIGHT}
          position={[lamp.x, lamp.y - 0.01, lamp.z]}
          color={LAYOUT.lantern.color}
          intensity={0}
          distance={LIGHT_DISTANCE}
          decay={2}
        />
      ) : null}
    </group>
  );
}
