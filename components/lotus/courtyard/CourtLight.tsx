"use client";
/* eslint-disable react-hooks/immutability --
   The garden's lights and the scene's environment strength are three.js state, nudged in the frame loop after the
   garden's own lights have written them. */
// The courtyard's light, on top of the garden's (components/garden/Lights.tsx, imported unchanged): the sun, the moon
// and the sky are the same Bangalore sky, but a walled court of pale granite is a stiller, cooler, more reflective
// place than an open lawn. So, every frame after the garden's lights have been set (they run at priority 0):
// - by day the shade fills more: the stone court throws the sun back into it (the hemisphere's ground light warmed
//   toward granite and raised, the environment's reflections a little stronger), and the noon sun is softened a
//   touch, so the shadows read as cool and calm rather than black;
// - before sunrise the first light is cool, pale and soft, brighter than the evening's at the same sun height, with
//   the mist lit by it; in the evening the court lies in the back wall's shade, which glows amber with the warm sky
//   and the sunlit walls; after dusk the sky's light is cooled toward blue, so the lamps' amber reads against it.
// Nothing is added to the scene (no new light, so no program changes): only the existing values are scaled. In the
// garden (its tier layers, components/garden/TierLayers) only the live layer's lights are found and nudged: a tier being
// prepared out of sight has lights of its own, which the walk passes over.
import { useThree } from "@react-three/fiber";
import { useLayerFrame } from "@/components/garden/TierLayers";
import { useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { traverseShown } from "@/components/garden/warmup";

const STONE_BOUNCE = new THREE.Color("#b9ad98");
const COOL_SKY = new THREE.Color("#8fa6d8");
/** The first light: a pale lilac-blue sky over the court, and its bounce off the misty stone. */
const DAWN_SKY = new THREE.Color("#a9b4d8");
const DAWN_GROUND = new THREE.Color("#8e8a96");
/** The evening: the warm sky over the walls and the light thrown down from their sunlit tops. */
const GOLD_SKY = new THREE.Color("#ffc896");
const GOLD_GROUND = new THREE.Color("#d29a66");

export function CourtLight() {
  const scene = useThree((s) => s.scene);
  const found = useRef<{ hemi: THREE.HemisphereLight | null; sun: THREE.DirectionalLight | null; frame: number }>({ hemi: null, sun: null, frame: 0 });
  useLayerFrame(() => {
    const f = found.current;
    // the garden's lights are rebuilt with the tier: look again now and then (the lite tier's sun casts no shadow, so
    // it is never found there, and the noon softening is left out)
    if (!f.hemi || f.frame++ % 60 === 0) {
      f.hemi = null;
      f.sun = null;
      traverseShown(scene, (o) => {
        if ((o as THREE.HemisphereLight).isHemisphereLight) f.hemi = o as THREE.HemisphereLight;
        else if ((o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) f.sun = o as THREE.DirectionalLight;
      });
    }
    const day = THREE.MathUtils.smoothstep(env.sun.altitude, -0.05, 0.35);
    const high = THREE.MathUtils.smoothstep(env.sun.altitude, 0.5, 1.0);
    const dim = (1 - day) * (1 - 0.5 * env.nightness);
    // the first light before sunrise: cool, soft and a little brighter than the evening's at the same sun height
    const morning = env.hour < 12 ? 1 : 0;
    const dawn = morning * dim;
    if (f.hemi) {
      f.hemi.groundColor.lerp(STONE_BOUNCE, 0.45 * day).lerp(DAWN_GROUND, 0.6 * dawn);
      f.hemi.color.lerp(COOL_SKY, 0.35 * dim * (1 - morning)).lerp(DAWN_SKY, 0.9 * dawn);
      f.hemi.intensity *= (1 + 0.55 * day) * (1 + 3.2 * dawn);
    }
    // the low evening sun is behind the back wall: the court lies in its shade, lit by the warm sky and the sunlit
    // walls round it, so its shade glows amber rather than going brown
    const low = THREE.MathUtils.smoothstep(env.sun.altitude, -0.02, 0.05) * (1 - THREE.MathUtils.smoothstep(env.sun.altitude, 0.12, 0.45)) * (1 - morning) * (1 - env.cloud);
    if (f.hemi && low > 0) {
      f.hemi.color.lerp(GOLD_SKY, 0.6 * low);
      f.hemi.groundColor.lerp(GOLD_GROUND, 0.7 * low);
      f.hemi.intensity *= 1 + 1.4 * low;
    }
    if (f.sun) f.sun.intensity *= 1 - 0.12 * high;
    scene.environmentIntensity *= (1 + 0.4 * day) * (1 + 2.6 * dawn);
  }, 0.25);
  return null;
}
