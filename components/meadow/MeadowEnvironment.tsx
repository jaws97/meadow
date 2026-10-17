"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes, the scene's fog) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// Sky, light and haze for the Meadow, following the real sun over Bangalore like the personal garden does (the same
// sun position and sky colour keys, lib/sky/sun), so a visit at lunch, at dusk or late at night each looks its hour:
// a warm day, an amber evening, a deep blue night lit by the lanterns and the flowers' own glow. `?hour=18.5` pins
// the clock for a look at another time of day.
//
// The sun's shadow box rides along with the camera's focus and grows with the view (so shadows stay crisp near the
// cart and still reach across the overview), snapped to whole texels so its edges never shimmer as it follows. The
// key light never comes in lower than twelve degrees, and by night the moon takes over the shadows, faint and cool.
// A small environment map, rendered once, gives the full plants' petals and leaves something soft to reflect.
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadowLayout } from "@/components/meadow/layout";
import { meadow } from "@/components/meadow/runtime";
import { istDateAt, istNow, skyState, sunInfo } from "@/lib/sky/sun";

const SUN_DISTANCE = 60;
const MIN_SUN_Y = Math.sin(THREE.MathUtils.degToRad(12));
const MOON = new THREE.Color("#9db3ff");
/** The light's numbers are the garden's sky keys, scaled for an open meadow under the same sky. */
const HEMI_GAIN = 2.1;
const SUN_GAIN = 0.95;
const CLOUD = 0.2;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uSunDisc;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.85, h), 0.7));
  float sun = max(dot(d, uSun), 0.0);
  col += uGlow * (pow(sun, 10.0) * 0.4 + pow(1.0 - abs(h), 6.0) * 0.18);
  col += uGlow * pow(sun, 600.0) * 1.2 * uSunDisc;
  // a sparse, still field of stars once it is dark
  vec3 cell = floor(d * 220.0);
  float star = step(0.9975, hash(cell)) * smoothstep(0.05, 0.4, h);
  col += vec3(0.85, 0.9, 1.0) * star * uStars * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The hour the Meadow is lit for: Bangalore's, unless the address pins one (?hour=). */
function readHour(): number | null {
  const raw = new URLSearchParams(window.location.search).get("hour");
  const h = raw === null ? NaN : Number(raw);
  return Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
}

function Sky({ uniforms }: { uniforms: Record<string, THREE.IUniform> }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [uniforms],
  );
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<THREE.Mesh>(null);
  // The dome follows the camera so its horizon never comes closer. It draws after everything solid, so the depth test
  // spends its shading only on the sky that shows (looking down on the Meadow, very little does).
  useFrame((state) => ref.current?.position.copy(state.camera.position), -0.5);
  return (
    <mesh ref={ref} material={material} renderOrder={3} frustumCulled={false}>
      <sphereGeometry args={[180, 32, 16]} />
    </mesh>
  );
}

export function MeadowEnvironment({ shadowSize }: { shadowSize: number }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const scene = useThree((s) => s.scene);
  const pinned = useMemo(() => readHour(), []);
  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color("#86aedb") },
      uHorizon: { value: new THREE.Color("#ecdcc6") },
      uGlow: { value: new THREE.Color("#ffd9a8") },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunDisc: { value: 1 },
      uStars: { value: 0 },
    }),
    [],
  );
  const fog = useMemo(() => new THREE.Fog("#ecdcc6", 40, 120), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);
  const clock = useRef({ next: 0, hour: 12 });
  const dir = useMemo(() => new THREE.Vector3(), []);
  // The environment map goes to the full plants alone (the rose and a visited plant), never the whole scene: every
  // lit pixel of the ground sampling it cost a fifth of the frame on an office laptop, for nothing anyone could see.
  const plantEnv = useMemo(() => new THREE.Scene(), []);

  useFrame((state) => {
    const c = clock.current;
    const t = state.clock.elapsedTime;
    // the sky moves slowly: twice a second is plenty
    if (t >= c.next) {
      c.next = t + 0.5;
      c.hour = pinned ?? istNow();
      const info = sunInfo(istDateAt(c.hour));
      const sky = skyState(info.altitude, CLOUD, c.hour, 0);
      uniforms.uZenith.value.copy(sky.zenith);
      uniforms.uHorizon.value.copy(sky.horizon);
      uniforms.uGlow.value.copy(sky.glow);
      uniforms.uSun.value.copy(info.dir);
      uniforms.uSunDisc.value = sky.sunDisc;
      uniforms.uStars.value = sky.stars;
      meadow.night = sky.nightness;
      fog.color.copy(sky.fog);
      const L = meadowLayout();
      // the haze starts past the Meadow as seen from wherever the camera stands, so pulling back never fogs it
      const back = Math.max(0, meadow.cameraDistance - 17);
      fog.near = back + L.hedgeR + 4 + 10 * (1 - sky.haze);
      fog.far = back + L.groundR + 40 + 50 * (1 - sky.haze);
      const h = hemi.current;
      if (h) {
        h.color.copy(sky.hemiSky);
        h.groundColor.copy(sky.hemiGround);
        // a little more sky light by night than the garden takes, so the beds read as blue shapes, not holes
        h.intensity = sky.hemiIntensity * HEMI_GAIN * (1 + 1.1 * sky.nightness);
      }
      const light = sun.current;
      if (light) {
        // by night the moon keeps a faint, cool key so the Meadow still has shape
        const moonUp = info.moonAltitude > 0.05 && sky.nightness > 0.6;
        if (sky.sunIntensity > 0.05 || !moonUp) {
          dir.copy(info.dir);
          light.color.copy(sky.sun);
          light.intensity = sky.sunIntensity * SUN_GAIN;
        } else {
          dir.copy(info.moonDir);
          light.color.copy(MOON);
          light.intensity = 0.35 * info.moonFraction + 0.1;
        }
        dir.y = Math.max(MIN_SUN_Y, dir.y);
        dir.normalize();
      }
      meadow.plantEnv = plantEnv.environment;
      meadow.plantEnvStrength = THREE.MathUtils.lerp(1, 0.25, sky.nightness);
    }
    const light = sun.current;
    if (!light) return;
    const half = Math.min(42, Math.max(12, meadow.viewReach));
    const cam = light.shadow.camera;
    if (Math.abs(cam.right - half) > 0.5) {
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    const texel = (half * 2) / shadowSize;
    const fx = Math.round(meadow.focus.x / texel) * texel;
    const fz = Math.round(meadow.focus.z / texel) * texel;
    light.target.position.set(fx, 0, fz);
    light.position.set(fx + dir.x * SUN_DISTANCE, dir.y * SUN_DISTANCE, fz + dir.z * SUN_DISTANCE);
    light.target.updateMatrixWorld();
  }, -0.5);

  return (
    <>
      <Sky uniforms={uniforms} />
      <hemisphereLight ref={hemi} args={["#dfe9ff", "#7f9160", 1.05]} />
      <directionalLight
        ref={sun}
        color="#ffe1b8"
        intensity={2.6}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE * 2}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      {/* a soft studio of light for the petals' sheen, drawn once, for the full plants only (see plantEnv) */}
      <Environment frames={1} resolution={64} scene={plantEnv}>
        {/* Lightformer honours only a whole `rotation` (a dashed rotation-x is reset by its own lookAt) */}
        <Lightformer form="rect" intensity={1.4} color="#dfeaff" position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[20, 20, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#ffe2b8" position={[-6, 3, -6]} scale={5} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.4} color="#b8d49a" position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[20, 20, 1]} />
      </Environment>
    </>
  );
}
