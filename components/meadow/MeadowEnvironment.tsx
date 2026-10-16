"use client";
// Sky, light and haze for the spike: a late-afternoon gradient dome with a
// soft sun glow, a warm sun whose shadow box rides along with the camera's
// focus (so shadows stay crisp wherever the cart goes), a sky/lawn hemisphere
// fill, and a peach haze that melts the far lawn into the horizon. The
// garden's own sky and lights are tuned to a three-metre bed and follow the
// real clock, so the spike keeps its own simple, fixed lighting instead.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadow } from "@/components/meadow/runtime";

const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
const SUN_DISTANCE = 30;
const SHADOW_HALF = 16;
const FOG = "#ecdcc6";

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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.85, h), 0.7));
  float sun = max(dot(d, uSun), 0.0);
  col += uGlow * (pow(sun, 12.0) * 0.35 + pow(sun, 200.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          uZenith: { value: new THREE.Color("#86aedb") },
          uHorizon: { value: new THREE.Color(FOG) },
          uGlow: { value: new THREE.Color("#ffd9a8") },
          uSun: { value: SUN_DIR.clone() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<THREE.Mesh>(null);
  // The dome follows the camera so its horizon never comes closer.
  useFrame((state) => ref.current?.position.copy(state.camera.position), -0.5);
  return (
    <mesh ref={ref} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[150, 32, 16]} />
    </mesh>
  );
}

export function MeadowEnvironment({ shadowSize }: { shadowSize: number }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const texel = (SHADOW_HALF * 2) / shadowSize;
  useFrame(() => {
    const light = sun.current;
    if (!light) return;
    // Snap the shadow box to whole texels so its edges do not shimmer as it follows.
    const fx = Math.round(meadow.focus.x / texel) * texel;
    const fz = Math.round(meadow.focus.z / texel) * texel;
    light.target.position.set(fx, 0, fz);
    light.position.set(fx + SUN_DIR.x * SUN_DISTANCE, SUN_DIR.y * SUN_DISTANCE, fz + SUN_DIR.z * SUN_DISTANCE);
    light.target.updateMatrixWorld();
  }, -0.5);

  return (
    <>
      <Sky />
      <hemisphereLight args={["#dfe9ff", "#7f9160", 1.05]} />
      <directionalLight
        ref={sun}
        color="#ffe1b8"
        intensity={2.6}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE * 2}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
      />
      <fog attach="fog" args={[FOG, 30, 95]} />
    </>
  );
}
