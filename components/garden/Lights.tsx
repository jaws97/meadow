"use client";
// Sun, moon, sky bounce, a soft fill, an image-based environment for the
// sheen on the petals, and the fog that swallows the hills. Everything follows
// the real sun over Bangalore via the shared env object, updated every frame.
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { useGarden, type Quality } from "@/lib/garden/store";
import { lerp } from "@/lib/plant/prng";

/**
 * The sun sits far enough out that the tree canopies between it and the hero
 * fall inside the shadow camera at golden hour, when the light comes in low
 * through them and dapples the bed; the moon sits the same distance out.
 */
const SUN_DISTANCE = 16;
const MOON_DISTANCE = 16;

/**
 * The sky model keeps a warm glow going for a few degrees below the horizon.
 * The light that carries it must still come from above the ground, so its
 * elevation is clamped here while its compass direction is kept.
 */
const MIN_SUN_Y = Math.sin(THREE.MathUtils.degToRad(3));

/**
 * One shadow map covers the bed, path, lantern, arch and hedges, and reaches
 * up to the canopies that dapple the evening light. The bounds are square
 * because the shadow camera's "up" swings with the sun's compass bearing: at
 * noon it points along the lawn, at dusk it points at the sky.
 */
const SHADOW_HALF = 3.6;
const SHADOW_TOP = 5.2;
const SHADOW_SIZE: Record<Quality, number> = { cinematic: 4096, balanced: 2048, lite: 1024 };
/** PCF radius in texels: a 4096 map over 7 m gives about 2 mm texels, so 3 is a soft 6 mm. */
const SHADOW_RADIUS: Record<Quality, number> = { cinematic: 3, balanced: 2.2, lite: 1.5 };

/** Moonlight: cool blue, scaled by how much of the moon is lit. */
const MOON_COLOR = new THREE.Color("#9db3ff");
const MOON_STRENGTH = 0.45;

/** Night fill: the city's sky glow, cool and from high in front. */
const NIGHT_FILL = new THREE.Color("#6d84c8");

/**
 * Low-sun leak: a share of the sun that casts no shadow, standing in for the
 * light that scatters through a canopy and off the air around it. It keeps a
 * warm rim on the petals when the evening sun sits behind the trees, and it
 * is gone by mid-morning so the noon shadows stay deep.
 */
const LEAK_SHARE = 0.38;
const LEAK_GONE_ALTITUDE = THREE.MathUtils.degToRad(26);

/** Environment-map strength by sun height, then by night. */
const ENV_HIGH_SUN = 0.9;
const ENV_LOW_SUN = 0.4;
const ENV_NIGHT = 0.14;
/** radians of sun altitude at which the environment reaches full strength */
const ENV_FULL_ALTITUDE = THREE.MathUtils.degToRad(24);

/** Fog range by haze: a clear noon reaches past the hills, a hazy dawn swallows them. */
const FOG_NEAR_CLEAR = 9;
const FOG_NEAR_THICK = 2.5;
const FOG_FAR_CLEAR = 60;
const FOG_FAR_THICK = 17;

const tmpDir = new THREE.Vector3();

export function Lights() {
  const quality = useGarden((s) => s.quality);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const leakRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);

  const shadowSize = SHADOW_SIZE[quality];

  useFrame((state) => {
    const sun = sunRef.current;
    if (sun) {
      tmpDir.copy(env.sun.dir);
      if (tmpDir.y < MIN_SUN_Y) tmpDir.setY(MIN_SUN_Y).normalize();
      sun.position.copy(tmpDir).multiplyScalar(SUN_DISTANCE);
      sun.color.copy(env.sky.sun);
      sun.intensity = env.sky.sunIntensity;
      // The light stays visible at intensity 0 through the night. Hiding it
      // changes the directional-light count, and three releases the unused
      // program variant, so every material would recompile at each dusk and
      // dawn. Skipping the light's own shadow pass saves the work instead.
      sun.shadow.autoUpdate = env.sky.sunIntensity > 0.01;
      // A quality change resizes mapSize but the allocated map keeps its old
      // size; dropping it makes the next pass allocate at the new one.
      const map = sun.shadow.map;
      if (map && map.width !== shadowSize) {
        map.dispose();
        sun.shadow.map = null;
      }
      // The map is created by the shadow pass itself. If the garden opens at
      // night the pass would never run, the map would stay null, and every
      // shadow-receiving draw would fail against the placeholder texture.
      if (!sun.shadow.map) sun.shadow.needsUpdate = true;
    }

    const leak = leakRef.current;
    if (leak) {
      leak.position.copy(tmpDir).multiplyScalar(SUN_DISTANCE);
      leak.color.copy(env.sky.sun);
      const low = 1 - THREE.MathUtils.smoothstep(env.sun.altitude, 0, LEAK_GONE_ALTITUDE);
      leak.intensity = env.sky.sunIntensity * LEAK_SHARE * low;
    }

    const moon = moonRef.current;
    if (moon) {
      moon.position.copy(env.sun.moonDir).multiplyScalar(MOON_DISTANCE);
      const up = THREE.MathUtils.smoothstep(env.sun.moonAltitude, 0, 0.12);
      moon.intensity = MOON_STRENGTH * env.sun.moonFraction * env.nightness * up * (1 - env.cloud * 0.8);
    }

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(env.sky.hemiSky);
      hemi.groundColor.copy(env.sky.hemiGround);
      hemi.intensity = env.sky.hemiIntensity;
    }

    const fill = fillRef.current;
    if (fill) {
      fill.color.copy(env.sky.horizon).lerp(NIGHT_FILL, env.nightness);
      fill.intensity = lerp(0.1, 0.3, env.nightness);
    }

    const scene = state.scene;
    // The baked environment is a bright noon sky. Dialled down with a low sun
    // it stops filling the long shadows of golden hour, and at night it fades
    // to a trace so the petal sheen keeps a cool edge.
    const sunHigh = THREE.MathUtils.smoothstep(env.sun.altitude, 0, ENV_FULL_ALTITUDE);
    scene.environmentIntensity = lerp(lerp(ENV_LOW_SUN, ENV_HIGH_SUN, sunHigh), ENV_NIGHT, env.nightness);
    const fog = scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.color.copy(env.sky.fog);
      const h = env.sky.haze;
      fog.near = lerp(FOG_NEAR_CLEAR, FOG_NEAR_THICK, h);
      fog.far = lerp(FOG_FAR_CLEAR, FOG_FAR_THICK, h);
    }
  });

  return (
    <>
      {/* The normal bias is kept small so petal-on-petal contact shadows survive;
          the PCF radius softens the edges without the cost of a soft map. */}
      <directionalLight
        ref={sunRef}
        castShadow={quality !== "lite"}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-radius={SHADOW_RADIUS[quality]}
        shadow-bias={-0.00018}
        shadow-normalBias={0.01}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE + 14}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_TOP}
        shadow-camera-bottom={-SHADOW_HALF}
      />
      <directionalLight ref={leakRef} intensity={0} />
      <directionalLight ref={moonRef} color={MOON_COLOR} intensity={0} />
      <hemisphereLight ref={hemiRef} intensity={0.6} />
      <directionalLight ref={fillRef} position={[1.2, 3, 3.5]} intensity={0.12} />

      <Environment resolution={128} frames={1}>
        <Lightformer form="ring" intensity={2} color="#fff2d8" position={[-3, 3, -3]} scale={4} target={[0, 0, 0]} />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#bcd3ff"
          position={[4, 2, 2]}
          scale={[6, 3, 1]}
          target={[0, 0, 0]}
        />
        {/* Lightformer only honours a whole `rotation` prop; a dashed rotation-x is
            reset by its lookAt in a layout effect. +90° about x turns the plane's
            normal to -y, so the panel faces down onto the garden. */}
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#dfe9ff"
          position={[0, 5, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[8, 8, 1]}
        />
        {/* A faint warm bounce from below, the lawn's colour on the underside of leaves and petals. */}
        <Lightformer
          form="rect"
          intensity={0.25}
          color="#9fb86a"
          position={[0, -3, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[8, 8, 1]}
        />
      </Environment>

      <fog attach="fog" args={["#cfe1f4", 5, 45]} />
    </>
  );
}
