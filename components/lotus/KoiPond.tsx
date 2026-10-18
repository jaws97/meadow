"use client";
/* eslint-disable react-hooks/immutability --
   The water's, the underwater and the lawn's uniforms, the reflection's camera and target, and the renderer are
   three.js objects written in the frame loop or in layout effects, which is how an R3F part animates without
   re-rendering; the React Compiler lint reads those writes as mutating a hook's value. Nothing they write feeds back
   into what React renders. */
// The owner's small koi pond (lotus v2, pond.ts), as the courtyard's granite tank (components/lotus/courtyard): the
// basin (the front shelf, the step, the deep zone, upright granite walls), dark clear water with its reflections, the
// breeze's ripples, rain rings and the koi's rings, the lotus pot on the shelf with its pebbles (the plant itself is
// LotusPlant, in the pot's frame), the three koi (KoiSchool.tsx), and the seed's jar on the front coping. The steps,
// the coping and the rest of the court are Courtyard.tsx's.
//
// Two things it does at runtime only, and only while it is mounted:
// - every light, and the parts the water should mirror (the courtyard's steps, walls, lamps and plants, the lotus's
//   standing leaves and flower), are put on a second layer too, for the planar reflection: a mirrored camera draws
//   only that layer, at half resolution, into a target the water samples; what it misses (the sky over the walls) is
//   faked by the reflected ray's elevation;
// - the underwater uniforms (materials.ts withUnderwater) are driven from the level, the sky and the sun.
// The concepts page draws it from one look; the product's courtyard (components/lotus/product) hands it the level and
// the green water live as well (`live`, eased every frame without a rebuild), its own koi (`school`) and the moments
// that play on and round the water (`children`, in world space). In the garden's tier layers every shared uniform is
// written by the live layer's frame only (useLayerFrame), so a tier being prepared out of sight, or one leaving, never
// takes the water's level, reflection or clarity from the one on screen.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { useLayerFrame } from "@/components/garden/TierLayers";
import { weather } from "@/components/garden/garden/weather";
import { Jar } from "@/components/lotus/Jar";
import { Koi } from "@/components/lotus/KoiSchool";
import { LotusPlant, type PlantLive, type PlantMeniscus } from "@/components/lotus/LotusPlant";
import type { Tier } from "@/components/lotus/geometry";
import type { LotusLook } from "@/components/lotus/look";
import {
  pebbleMaterial,
  petalUniforms,
  POND_LEAVES,
  POND_RINGS,
  pondWaterMaterial,
  pondWaterUniforms,
  potMaterial,
  potMudMaterial,
  setPondClarity,
  underwaterUniforms,
} from "@/components/lotus/materials";
import type { PetalColour } from "@/components/lotus/params";
import { jarSpot, levelY, POND, POND_FRAME, POT_FRAME } from "@/components/lotus/pond";
import { tankBasinMaterial } from "@/components/lotus/courtyard/materials";
import {
  makeBasinGeometry,
  makePebblesGeometry,
  makePondWaterGeometry,
  makePotGeometry,
  makePotMudGeometry,
  makePotWaterGeometry,
  POND_TESS,
} from "@/components/lotus/pondGeometry";

export const POND_NAME = "lotus-pond";
/** The layer the planar reflection draws (every light is on it too). */
export const REFLECT_LAYER = 1;

const POT_IN_POND: readonly [number, number] = [POND.potX - POND.cx, POND.potZ - POND.cz];

// ---------------------------------------------------------------------------------------------------------------------
// The planar reflection

const REFLECT_SCALE: Record<Tier, number> = { cinematic: 0.5, balanced: 0.4, lite: 0 };
const UP = new THREE.Vector3(0, 1, 0);

/** The water's surface as the pond's frame last set it (world y), for the reflection drawn after it. */
interface Surface {
  y: number;
}

/**
 * The mirrored camera, one for the page: three keeps a camera's transmission buffer (the standing leaves' and the
 * petals' light-through on cinematic and balanced) under that camera, never freed, so a camera made per mount (each
 * courtyard, tier swap or new seed) would leave one behind each time. Only the live layer's reflection draws with it.
 */
let mirrorCamera: THREE.PerspectiveCamera | null = null;
function sharedMirror(): THREE.PerspectiveCamera {
  if (!mirrorCamera) {
    mirrorCamera = new THREE.PerspectiveCamera();
    mirrorCamera.layers.set(REFLECT_LAYER);
  }
  return mirrorCamera;
}

function PondReflection({ tier, surface }: { tier: Tier; surface: RefObject<Surface> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const scale = REFLECT_SCALE[tier];
  const rt = useMemo(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true }), []);
  const mirror = sharedMirror();
  const scratch = useMemo(
    () => ({
      planeAt: new THREE.Vector3(),
      camAt: new THREE.Vector3(),
      view: new THREE.Vector3(),
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      plane: new THREE.Plane(),
      clip: new THREE.Vector4(),
      q: new THREE.Vector4(),
      clear: new THREE.Color(),
    }),
    [],
  );
  useEffect(() => () => rt.dispose(), [rt]);
  useEffect(
    () => () => {
      // only if the water still samples this one (a tier swap's new layer has already put its own in)
      if (pondWaterUniforms.uRefl.value !== rt.texture) return;
      pondWaterUniforms.uReflOn.value = 0;
      pondWaterUniforms.uRefl.value = null;
    },
    [rt],
  );

  useLayerFrame((state) => {
    if (scale === 0) {
      pondWaterUniforms.uReflOn.value = 0;
      return;
    }
    // sized here, before it is drawn into (an effect runs only after the first frames: a 1 px target's transmission
    // buffer is empty, and drawing into it is an error)
    const w = Math.max(2, Math.round(state.size.width * state.viewport.dpr * scale));
    const h = Math.max(2, Math.round(state.size.height * state.viewport.dpr * scale));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    pondWaterUniforms.uRefl.value = rt.texture;
    pondWaterUniforms.uReflTexel.value.set(1 / w, 1 / h);
    // the reflected layer: every light (both cameras must see the same lights, or every program recompiles), and
    // the roots the plant and the garden mark
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(REFLECT_LAYER);
      else if (o.userData.pondReflect && !o.layers.isEnabled(REFLECT_LAYER)) o.traverse((c) => c.layers.enable(REFLECT_LAYER));
    });
    const s = scratch;
    s.planeAt.set(POND.cx, surface.current.y, POND.cz);
    s.camAt.setFromMatrixPosition(camera.matrixWorld);
    s.view.subVectors(s.planeAt, s.camAt);
    if (s.view.dot(UP) > 0) {
      pondWaterUniforms.uReflOn.value = 0;
      return;
    }
    // the mirrored camera (three's Reflector, examples/jsm/objects/Reflector.js, MIT)
    s.view.reflect(UP).negate().add(s.planeAt);
    s.rot.extractRotation(camera.matrixWorld);
    s.look.set(0, 0, -1).applyMatrix4(s.rot).add(s.camAt);
    s.target.subVectors(s.planeAt, s.look).reflect(UP).negate().add(s.planeAt);
    mirror.position.copy(s.view);
    mirror.up.set(0, 1, 0).applyMatrix4(s.rot).reflect(UP);
    mirror.lookAt(s.target);
    mirror.far = (camera as THREE.PerspectiveCamera).far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    pondWaterUniforms.uReflMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix)
      .multiply(mirror.matrixWorldInverse);
    // an oblique near plane at the water, so nothing under it is mirrored
    s.plane.setFromNormalAndCoplanarPoint(UP, s.planeAt).applyMatrix4(mirror.matrixWorldInverse);
    s.clip.set(s.plane.normal.x, s.plane.normal.y, s.plane.normal.z, s.plane.constant);
    const e = mirror.projectionMatrix.elements;
    s.q.set((Math.sign(s.clip.x) + e[8]) / e[0], (Math.sign(s.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    s.clip.multiplyScalar(2 / s.clip.dot(s.q));
    e[2] = s.clip.x;
    e[6] = s.clip.y;
    e[10] = s.clip.z + 1 - 0.003;
    e[14] = s.clip.w;

    const prevTarget = gl.getRenderTarget();
    const prevShadow = gl.shadowMap.autoUpdate;
    const prevBg = scene.background;
    gl.getClearColor(s.clear);
    const prevAlpha = gl.getClearAlpha();
    scene.background = null;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    gl.render(scene, mirror);
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(s.clear, prevAlpha);
    gl.shadowMap.autoUpdate = prevShadow;
    scene.background = prevBg;
    pondWaterUniforms.uReflOn.value = 1;
  }, 0.5);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pond

/**
 * The light the water scatters back toward the eye from what it carries (the colour things fade to with depth): a dark
 * tea-green, as a garden pond with a lotus pot and fish in it is (they stir its silt; it is never a pool's blue).
 */
const DEEP = new THREE.Color(0.02, 0.036, 0.026);
/**
 * Per metre: the water's absorption (tea-green: red and blue go first, by the dissolved organic matter a planted pond
 * carries) and its suspended silt's scattering, which is grey. A pond with about a metre of visibility [E]: koi 5-14 cm
 * down keep most of their colour, the pot's pebbles 5 cm down lose a quarter of their contrast, the deep zone is dark.
 */
const ABSORB = new THREE.Vector3(1.5, 0.8, 1.25);
const SILT = 1.45;
const FAKE_WALL = new THREE.Color(0.2, 0.115, 0.075);
const DEEP_GREEN = new THREE.Color(0.05, 0.085, 0.02);
/** The lamp-lit stone's warm bounce onto the petals at full flame (an oil flame's amber). */
const LAMP_FILL = new THREE.Color(0.34, 0.2, 0.1);

/** What the product's courtyard hands the pond each frame (components/lotus/product), eased so nothing rebuilds. */
export interface PondLive {
  /** the pond's level against the fill line, mm (clamped to the notch and the lowest the page draws), and green water */
  levelMM: number;
  algae: number;
}

export function Pond({
  look,
  tier,
  colour,
  rain,
  koi,
  live,
  plantLive,
  school,
  children,
}: {
  look: LotusLook;
  tier: Tier;
  colour: PetalColour;
  rain: boolean;
  koi: boolean;
  /** the level and the green water now (the look's own when left out) */
  live?: RefObject<PondLive | null>;
  /** handed on to the plant and the jar (LotusPlant's PlantLive) */
  plantLive?: RefObject<PlantLive | null>;
  /** the koi to draw in the pond's frame instead of the page's three (KoiSchool) */
  school?: ReactNode;
  /** moments on and round the water, in world space */
  children?: ReactNode;
}) {
  const t = POND_TESS[tier];
  const geo = useMemo(
    () => ({
      water: makePondWaterGeometry(t.water[0], t.water[1]),
      basin: makeBasinGeometry(t.basin[0], t.basin[1], t.basin[2]),
      pot: makePotGeometry(t.pot),
      mud: makePotMudGeometry(Math.max(16, t.pot >> 1)),
      potWater: makePotWaterGeometry(Math.max(24, t.pot >> 1)),
      pebbles: makePebblesGeometry(t.pebbles, t.pebbleDetail, 5),
    }),
    [t],
  );
  useEffect(
    () => () => {
      geo.water.dispose();
      geo.basin.dispose();
      geo.pot.dispose();
      geo.mud.dispose();
      geo.potWater.dispose();
      geo.pebbles.dispose();
    },
    [geo],
  );
  const waterMat = pondWaterMaterial();
  const jar = useMemo(() => jarSpot("Lijas"), []);
  // the plant tells the water where its stalks pass through the surface
  const meniscus = useRef<PlantMeniscus>({ pierce: [] });
  const water = useRef<THREE.Mesh>(null);
  const surface = useRef<Surface>({ y: levelY(look.waterMM) });
  useEffect(
    () => () => {
      underwaterUniforms.uUwLevel.value = -100;
    },
    [],
  );

  useLayerFrame(() => {
    // the level and the green water: the courtyard's eased numbers, or the look's
    const lv = live?.current;
    const algae = lv ? lv.algae : look.algae;
    const y = levelY(lv ? lv.levelMM : look.waterMM);
    surface.current.y = y;
    if (water.current) water.current.position.y = y - POND.waterY;
    setPondClarity(waterMat, algae);
    underwaterUniforms.uUwLevel.value = y;

    const u = pondWaterUniforms;
    u.uTime.value = env.time;
    u.uWind.value = env.wind;
    u.uRain.value = env.rain;
    u.uNight.value = env.nightness;
    u.uSkyHorizon.value.copy(env.sky.horizon);
    u.uSkyZenith.value.copy(env.sky.zenith);
    // the faked surround's walls: laterite and granite in the sky's light
    const lum = env.sky.horizon.r * 0.2126 + env.sky.horizon.g * 0.7152 + env.sky.horizon.b * 0.0722;
    u.uFakeWall.value.copy(FAKE_WALL).multiplyScalar(0.25 + 1.2 * lum);
    // the meniscus round every floating leaf and every stalk through the surface, in the pond frame
    const leaves = u.uLeaves.value;
    let n = 0;
    for (const f of look.floating) {
      if (n >= POND_LEAVES) break;
      leaves[n++].set(f.x + POT_IN_POND[0], f.z + POT_IN_POND[1], f.r * 0.97);
    }
    for (const p of meniscus.current.pierce) {
      if (n >= POND_LEAVES) break;
      leaves[n++].set(p.x + POT_IN_POND[0], p.y + POT_IN_POND[1], 0.0045);
    }
    while (n < POND_LEAVES) leaves[n++].set(0, 0, 0);
    if (!koi) for (let i = 0; i < POND_RINGS; i++) u.uRings.value[i].w = 0;

    // under the water: the light it scatters back follows the sky's brightness; the caustics need sun and ripples
    const uw = underwaterUniforms;
    const day = env.sky.horizon.r * 0.2126 + env.sky.horizon.g * 0.7152 + env.sky.horizon.b * 0.0722;
    uw.uUwDeep.value.copy(DEEP).multiplyScalar(0.25 + 1.6 * day).lerp(DEEP_GREEN, Math.min(1, algae * 1.2));
    uw.uUwSigma.value.set(ABSORB.x + SILT + 6 * algae, ABSORB.y + SILT + 4 * algae, ABSORB.z + SILT + 6.5 * algae);
    const sunUp = THREE.MathUtils.smoothstep(env.sun.altitude, 0.05, 0.5);
    uw.uUwCaustic.value = tier === "lite" ? 0 : 0.75 * sunUp * (1 - env.cloud) * (0.45 + 0.55 * Math.min(1, env.wind)) * (1 - 0.9 * algae);
    uw.uUwTime.value = env.time;
    // the lamps' warm light thrown back off the stone onto the petals, as the lamps are lit
    petalUniforms.uPetalFill.value.copy(LAMP_FILL).multiplyScalar(weather.lit * weather.flicker);
  });
  useEffect(
    () => () => {
      petalUniforms.uPetalFill.value.setRGB(0, 0, 0);
    },
    [],
  );

  // the pebbles dry only once neither the pond nor the pot's own water covers them
  const dry = look.waterMM < -POND.pebbleDepth * 1000 && look.potWaterMM === null;
  return (
    <group name={POND_NAME}>
      <group position={POND_FRAME}>
        <mesh name="pond-basin" geometry={geo.basin} material={tankBasinMaterial(tier)} receiveShadow />
        <mesh ref={water} name="pond-water" geometry={geo.water} material={waterMat} position-y={levelY(look.waterMM) - POND.waterY} renderOrder={2} receiveShadow />
        {school ?? (koi ? <Koi tier={tier} /> : null)}
      </group>
      <group position={POT_FRAME}>
        <mesh name="pond-pot" geometry={geo.pot} material={potMaterial()} castShadow receiveShadow />
        <mesh geometry={geo.mud} material={potMudMaterial()} receiveShadow />
        {/* (no shadows of their own: under the water the light is soft, scattered by the ripples) */}
        <mesh geometry={geo.pebbles} material={pebbleMaterial(dry)} receiveShadow />
        {look.potWaterMM !== null ? <mesh geometry={geo.potWater} material={waterMat} position-y={look.potWaterMM / 1000} renderOrder={2} receiveShadow /> : null}
        <LotusPlant look={look} tier={tier} colour={colour} rain={rain} meniscus={meniscus} live={plantLive} />
      </group>
      <group position={jar.at} rotation-y={jar.yaw + 0.4}>
        <Jar jar={look.jar} tier={tier} at={[0, 0, 0]} stone={false} live={plantLive} />
      </group>
      {children}
      <PondReflection tier={tier} surface={surface} />
    </group>
  );
}
