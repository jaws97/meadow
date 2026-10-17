"use client";
// Sun, moon, sky bounce, a soft fill, an image-based environment for the
// sheen on the petals, and the fog that swallows the hills. Everything follows
// the real sun over Bangalore via the shared env object, updated every frame.
//
// The lighting is set up like a cinematographer's: at noon a warm key with
// deep shadows and a restrained fill; at golden hour a saturated amber key
// from behind the garden (the sun sets back-left of the camera), cool
// blue-violet sky light in the shadows the camera looks into, a warm bounce
// off the lawn from below, a share of sunlight that ignores the canopy so the
// bed is lit, a warm rim on the silhouettes (the garden's own shader patch,
// driven from here) and a narrow kicker from the sun's bearing aimed at the
// flower head so its petal edges glow against the darker garden. Every light
// is mounted all day (at intensity 0 when idle): changing the light count
// would recompile every material in the scene. The ones that only work with
// the sun low or down are hidden while it stands high, with their programs
// prepared in the background before each switch (LightSets, lightSets.ts).
//
// On the lite tier the night lift comes from the sky bounce and the fill
// rather than the tone-mapping exposure, which would also lift every emissive.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { lightState, rimUniforms } from "@/lib/garden/dressing";
import { composerHandle } from "@/components/garden/Effects";
import {
  applySet,
  canSwitchSets,
  compilePinned,
  isReadySet,
  lightSet,
  markReady,
  OPTIONAL_LIGHT,
  prepareSet,
  upcomingSet,
  wantedFullSet,
} from "@/components/garden/lightSets";
import { compileShadowCasters, compileTransmissionBackfaces, type Compile } from "@/components/garden/warmup";
import { env } from "@/lib/garden/env";
import { quality as budget } from "@/lib/garden/quality";
import { useGarden, type Quality } from "@/lib/garden/store";
import { clamp01, lerp } from "@/lib/plant/prng";

/**
 * The sun sits far enough out that the tree canopies between it and the hero
 * fall inside the shadow camera at golden hour, when the light comes in low
 * through them and dapples the bed; the moon sits the same distance out.
 */
const SUN_DISTANCE = 16;
const MOON_DISTANCE = 16;

/**
 * The key light never comes in lower than this, though its compass bearing
 * always follows the sun. The sky model keeps a warm glow going for a few
 * degrees below the horizon, and that light must still come from above the
 * ground; and in the last half hour before sunset a truly grazing sun lights
 * the lawn and the kerb's tops at a tenth of its strength and lays every
 * hedge's shadow ten metres long, so golden hour would go murky just when it
 * should glow. Nine degrees is the cinematographer's cheat: the light still
 * reads low and long, but it reaches into the garden.
 */
const MIN_SUN_Y = Math.sin(THREE.MathUtils.degToRad(9));

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
const LEAK_SHARE = 0.62;
const LEAK_GONE_ALTITUDE = THREE.MathUtils.degToRad(26);

/**
 * Golden-hour bounce: sunlight off the lawn and the warm air, lifting the
 * shadow side of the hedges and the bed out of black. Its colour mixes into
 * the hemisphere's ground and the fill as the sun gets low.
 */
const WARM_BOUNCE = new THREE.Color("#c48a52");
/** The golden-hour sky light: blue-violet, so the shadow side the camera sees goes cool against the amber key. */
const COOL_SKY = new THREE.Color("#7d8ce0");
const COOL_FILL = new THREE.Color("#8f9ad8");
const BOUNCE_HEMI_GAIN = 0.7;
const BOUNCE_FILL = 0.45;
/** The rim on the garden's silhouettes: a trace by day, strong with the low sun behind. */
const RIM_DAY = 0.15;
const RIM_GOLDEN = 1.6;
/** Lite's night lift, as gains on the sky bounce and the fill at full night. */
const LITE_NIGHT_HEMI = 0.7;
const LITE_NIGHT_FILL = 0.35;
/** radians of sun altitude by which the golden-hour treatment has gone */
const LOW_SUN_GONE = THREE.MathUtils.degToRad(28);

/**
 * The kicker: a narrow spot from the sun's bearing, a little above the
 * flower, aimed at the head. three.js lights cannot be linked to single
 * objects, so the cone does the isolating: it is just wide enough for the
 * bloom and the top of the stem, and falls off well before the hedges.
 */
const RIM_DISTANCE = 2.6;
const RIM_RISE = 0.55;
const RIM_ANGLE = THREE.MathUtils.degToRad(9);
const RIM_INTENSITY = 30;
const RIM_WARM = new THREE.Color("#ffb070");

/** Noon: a warmer key and less sky fill, so the shadows under leaves and kerb read. */
const NOON_WARM = new THREE.Color("#ffe0b4");
const NOON_FROM = THREE.MathUtils.degToRad(30);
const NOON_FULL = THREE.MathUtils.degToRad(60);

/** Environment-map strength by sun height, then by night. */
const ENV_HIGH_SUN = 0.72;
const ENV_LOW_SUN = 0.4;
const ENV_NIGHT = 0.14;
/** radians of sun altitude at which the environment reaches full strength */
const ENV_FULL_ALTITUDE = THREE.MathUtils.degToRad(24);

/** Fog range by haze: a clear noon reaches past the hills, a hazy dawn swallows them. */
const FOG_NEAR_CLEAR = 11;
const FOG_NEAR_THICK = 2.5;
const FOG_FAR_CLEAR = 60;
const FOG_FAR_THICK = 17;

const tmpDir = new THREE.Vector3();
const tmpFlat = new THREE.Vector3();

/**
 * Keeps the optional lights in the live set (a light mounted later, by a
 * replanted bloom, joins it before it is drawn), prepares the other set's
 * programs in the background as the sun nears the threshold, and switches
 * once they are ready. See lightSets.ts.
 */
function LightSets() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const enabled = useRef(false);
  useEffect(() => {
    enabled.current = canSwitchSets(gl);
    if (!enabled.current) {
      lightSet.full = true;
      applySet(scene, true);
    }
  }, [gl, scene]);
  useFrame(() => {
    if (!enabled.current) return;
    applySet(scene, lightSet.full);
    const alt = env.sun.altitude;
    const want = wantedFullSet(lightSet.full, alt);
    if (want !== lightSet.full && isReadySet(want)) {
      lightSet.full = want;
      applySet(scene, want);
      return;
    }
    if (lightSet.preparing) return;
    const next = want !== lightSet.full ? want : upcomingSet(lightSet.full, alt);
    if (next === null || isReadySet(next)) return;
    lightSet.preparing = true;
    const target = composerHandle.current?.inputBuffer ?? null;
    const pinned: Compile = (s, c, t) => compilePinned(gl, s, c, t);
    prepareSet(gl, scene, camera, next, target, () =>
      Promise.all([
        compileShadowCasters(gl, scene, camera, target, pinned),
        compileTransmissionBackfaces(gl, scene, camera, target, pinned),
      ]),
    ).then(() => {
      markReady(next);
      lightSet.preparing = false;
    });
  }, -9);
  return null;
}

export function Lights() {
  const quality = useGarden((s) => s.quality);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const leakRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.SpotLight>(null);
  const rimTarget = useMemo(() => new THREE.Object3D(), []);
  const frame = useRef(0);

  const shadowSize = SHADOW_SIZE[quality];

  useFrame((state) => {
    const alt = env.sun.altitude;
    // 1 while the sun is just up and low, gone by mid-morning and back by late afternoon
    const low = THREE.MathUtils.smoothstep(alt, -0.03, 0.04) * (1 - THREE.MathUtils.smoothstep(alt, 0.04, LOW_SUN_GONE));
    const noon = THREE.MathUtils.smoothstep(alt, NOON_FROM, NOON_FULL) * (1 - env.cloud);

    const sun = sunRef.current;
    if (sun) {
      tmpDir.copy(env.sun.dir);
      if (tmpDir.y < MIN_SUN_Y) tmpDir.setY(MIN_SUN_Y).normalize();
      sun.position.copy(tmpDir).multiplyScalar(SUN_DISTANCE);
      sun.color.copy(env.sky.sun).lerp(NOON_WARM, 0.45 * noon);
      sun.intensity = env.sky.sunIntensity * (1 + 0.15 * noon);
      // The light stays visible at intensity 0 through the night. Hiding it
      // changes the directional-light count, and three releases the unused
      // program variant, so every material would recompile at each dusk and
      // dawn. Skipping the light's own shadow pass saves the work instead.
      // Under load the governor (lib/garden/quality) may refresh the map every
      // other frame: the sun crawls and the foliage's dappled sway reads the
      // same at half rate, so it is the cheapest rung before a tier change.
      const every = budget.get().shadowEvery;
      sun.shadow.autoUpdate = env.sky.sunIntensity > 0.01 && (every === 1 || frame.current++ % every === 0);
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

    const bounce = low * (1 - 0.7 * env.cloud);
    lightState.golden = bounce;
    rimUniforms.uRim.value = lerp(RIM_DAY, RIM_GOLDEN, bounce) * (1 - 0.6 * env.rain);
    const lite = quality === "lite";
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(env.sky.hemiSky).lerp(COOL_SKY, 0.45 * bounce);
      hemi.groundColor.copy(env.sky.hemiGround).lerp(WARM_BOUNCE, 0.6 * bounce);
      hemi.intensity =
        env.sky.hemiIntensity *
        (1 + BOUNCE_HEMI_GAIN * bounce) *
        (1 - 0.25 * noon) *
        (lite ? 1 + LITE_NIGHT_HEMI * env.nightness : 1);
    }

    const fill = fillRef.current;
    if (fill) {
      fill.color.copy(env.sky.horizon).lerp(NIGHT_FILL, env.nightness).lerp(COOL_FILL, 0.55 * bounce);
      fill.intensity = lerp(0.1, lite ? 0.3 + LITE_NIGHT_FILL : 0.3, env.nightness) + BOUNCE_FILL * bounce;
    }

    const rim = rimRef.current;
    if (rim) {
      // along the sun's compass bearing, at a fixed height over the head
      tmpFlat.set(env.sun.dir.x, 0, env.sun.dir.z);
      if (tmpFlat.lengthSq() < 1e-6) tmpFlat.set(0, 0, -1);
      tmpFlat.normalize();
      rim.position.copy(env.headPos).addScaledVector(tmpFlat, RIM_DISTANCE);
      rim.position.y += RIM_RISE;
      rimTarget.position.copy(env.headPos);
      rimTarget.updateMatrixWorld();
      rim.color.copy(env.sky.sun).lerp(RIM_WARM, 0.4);
      rim.intensity = RIM_INTENSITY * low * clamp01(env.sky.sunIntensity / 1.4) * (1 - 0.85 * env.cloud);
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
      <LightSets />
      <directionalLight ref={leakRef} intensity={0} userData={OPTIONAL_LIGHT} />
      <directionalLight ref={moonRef} color={MOON_COLOR} intensity={0} userData={OPTIONAL_LIGHT} />
      <hemisphereLight ref={hemiRef} intensity={0.6} />
      <directionalLight ref={fillRef} position={[1.2, 3, 3.5]} intensity={0.12} />
      <primitive object={rimTarget} />
      <spotLight
        ref={rimRef}
        target={rimTarget}
        userData={OPTIONAL_LIGHT}
        intensity={0}
        angle={RIM_ANGLE}
        penumbra={0.8}
        distance={RIM_DISTANCE * 2}
        decay={2}
      />

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
