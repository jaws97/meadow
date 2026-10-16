"use client";
// The sky: a gradient dome with a sun glow, drifting clouds lit from the sun's
// side, and twinkling stars; a phased moon with a soft halo; and rings of
// distant hills, their ridge lines cut by noise, that the scene fog melts into
// the horizon. At night the dome is deep indigo with the warm, light-polluted
// horizon of a city rather than black, and the cloud bellies catch that glow.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { vnoise2 } from "@/lib/plant/prng";

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform float uStars;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform float uDrift;
varying vec3 vDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

const mat2 OCTAVE = mat2(1.6, 1.2, -1.2, 1.6);

// Five octaves, summing to just under one: mean about 0.48.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = OCTAVE * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // The horizon colour reaches high into a daytime sky; at night it stays a
  // tighter band so the zenith reads as deep indigo.
  float grad = pow(clamp(h, 0.0, 1.0), mix(0.55, 0.4, uNight));
  vec3 col = mix(uHorizon, uZenith, grad);
  col = mix(col * 0.45, col, smoothstep(-0.12, 0.0, h));
  // Warm glow pooled on the horizon: sunset fire by day, city light at night.
  float band = exp(-max(h, 0.0) * mix(9.0, 7.0, uNight)) * mix(0.35, 0.55, uNight);
  col = mix(col, uGlow, band * smoothstep(-0.08, 0.02, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // The disc leans on the horizon glow so a low sun stays orange instead of
  // clipping to white; the wide halo keeps the paler light colour.
  vec3 discCol = mix(uSunColor, uGlow, 0.5);
  col += uSunDisc * (discCol * (pow(sd, 400.0) * 1.8 + pow(sd, 14.0) * 0.26) + uSunColor * pow(sd, 3.0) * 0.09);

  // Clouds: the dome projected onto a flat layer overhead, so the shapes
  // flatten and crowd toward the horizon as real cloud decks do. A second
  // sample toward the sun finds the lit edge of each shape.
  float cloud = 0.0;
  float lit = 0.5;
  if (h > -0.02) {
    vec2 cp = d.xz / (max(h, 0.0) + 0.16) * 0.5 + vec2(uDrift, uDrift * 0.35);
    float f = fbm(cp * 1.3);
    float f2 = fbm(cp * 1.3 + uSunDir.xz * 0.14);
    float base = 0.6 - uCloud * 0.42;
    cloud = smoothstep(base, base + 0.24, f) * smoothstep(0.0, 0.14, h);
    lit = clamp((f - f2) * 5.0 + 0.5, 0.0, 1.0);
  }
  vec3 skyMid = mix(uZenith, uHorizon, 0.55);
  vec3 shade = skyMid * 0.8 + vec3(0.05);
  vec3 sunlit = mix(uHorizon, uSunColor, 0.55) * 1.15 + vec3(0.08);
  // Facing the sun the whole bank glows; away from it only the edges do.
  float toward = 0.35 + 0.65 * sd;
  vec3 cloudCol = mix(shade, sunlit, lit * toward);
  // An overcast deck flattens to the sky's own grey.
  cloudCol = mix(cloudCol, skyMid * 1.05, uCloud * 0.5);
  // At night the bellies catch the city's glow near the horizon.
  cloudCol = mix(cloudCol, mix(skyMid * 0.6, uGlow * 1.1, band * 1.6), uNight);
  col = mix(col, cloudCol, cloud * (0.6 + 0.4 * uCloud));

  if (uStars > 0.001 && h > 0.0) {
    vec2 p = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * vec2(70.0, 46.0);
    vec2 c = floor(p);
    vec2 f = fract(p) - 0.5;
    float r = hash21(c);
    vec2 off = vec2(hash21(c + 1.3), hash21(c + 7.1)) - 0.5;
    // Three in ten cells hold a star; a few are bright enough for the bloom.
    // The depth of field spreads each one into a small disc, so they are kept
    // small and modest here and read as points of light rather than bubbles.
    float mag = hash21(c + 3.3);
    float bright = 0.3 + 1.9 * mag * mag * mag;
    float radius = 0.045 + 0.06 * mag;
    float dist = length(f + off * 0.6);
    // Edges in ascending order: smoothstep with edge0 > edge1 is undefined by the GLSL spec.
    float star = (1.0 - smoothstep(0.0, radius, dist)) * step(0.7, r);
    float tw = 0.7 + 0.3 * sin(uTime * 3.0 + r * 60.0);
    // Faint colour spread, from cool white to a warm tint, and no stars down in the glow band.
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.93, 0.8), step(0.8, hash21(c + 9.7)));
    col += tint * star * bright * uStars * tw * smoothstep(0.03, 0.3, h) * (1.0 - cloud);
  }
  gl_FragColor = vec4(col, 1.0);
  // Behave like the built-in materials: tone-mapped and sRGB-encoded when drawn
  // straight to the canvas (before the composer mounts), passed through linear
  // when drawn into the composer's render target.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOON_VERTEX = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The sun lights the moon from wherever it really is, so the disc shows the
// true phase; the dark limb keeps a trace of earthshine so the circle reads.
const MOON_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  float lit = smoothstep(-0.08, 0.3, dot(normalize(vNormal), uSunDir));
  vec3 col = uColor * (0.045 + 1.0 * lit);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// A type alias (not an interface) so it satisfies ShaderMaterial's indexed uniforms type.
type SkyUniforms = {
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSunDisc: { value: number };
  uStars: { value: number };
  uNight: { value: number };
  uTime: { value: number };
  uCloud: { value: number };
  uDrift: { value: number };
};

type MoonUniforms = {
  uSunDir: { value: THREE.Vector3 };
  uColor: { value: THREE.Color };
  uOpacity: { value: number };
};

const MOON_DISTANCE = 40;
const MOON_RADIUS = 0.9;
/** Over 1 so the lit limb clears the bloom threshold and blooms softly. */
const MOON_COLOR = new THREE.Color(1.35, 1.4, 1.6);
const HALO_COLOR = new THREE.Color(0.55, 0.62, 0.9);
const HALO_SCALE = 7;

/** The twinkle is sin(3t + phase), so wrapping at 1000 periods keeps it continuous while the float stays precise. */
const TWINKLE_WRAP = ((2 * Math.PI) / 3) * 1000;

/** How fast the cloud deck crosses the sky, in layer units per second at wind 1. */
const CLOUD_DRIFT_RATE = 0.012;

interface Ridge {
  radius: number;
  /** metres below the lawn the wall starts, so no gap shows past the lawn's edge */
  base: number;
  minHeight: number;
  maxHeight: number;
  /** how many crests around the ring, and a seed to turn the noise */
  crests: number;
  seed: number;
  color: string;
}

/**
 * Three rings of hills, nearest and darkest first, spread around every side of
 * the garden. The far ring is tallest and bluest, as distance makes it.
 */
const RIDGES: readonly Ridge[] = [
  { radius: 21, base: -4, minHeight: 0.8, maxHeight: 3.4, crests: 7, seed: 1.7, color: "#213f27" },
  { radius: 28, base: -4, minHeight: 1.4, maxHeight: 5.2, crests: 5, seed: 7.3, color: "#1f3c2b" },
  { radius: 36, base: -4, minHeight: 2.4, maxHeight: 7.4, crests: 4, seed: 13.1, color: "#1d3730" },
];

/** Owned by the one sky material: written once per frame from env, read by the shader. */
const uniforms: SkyUniforms = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uSunDisc: { value: 0 },
  uStars: { value: 0 },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uCloud: { value: 0 },
  uDrift: { value: 0 },
};

const moonUniforms: MoonUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uColor: { value: MOON_COLOR.clone() },
  uOpacity: { value: 0 },
};

/** A soft radial falloff for the moon's halo, drawn once into a small canvas. */
function makeHaloTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.18, "rgba(255,255,255,0.22)");
    g.addColorStop(0.45, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A ring-shaped wall whose top edge is a noisy ridge line: seen from inside,
 * with flat shading and fog, it reads as a range of hills on the horizon. The
 * normals lean up so the sky bounce lights the slopes; the vertex colour runs
 * lighter at the foot, where more air lies between the valleys and the eye.
 */
function makeRidgeGeometry(ridge: Ridge, segments = 240): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const { radius, base, minHeight, maxHeight, crests, seed } = ridge;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Sampled on a circle so the ridge joins up seamlessly where the ring closes.
    const n1 = vnoise2(ca * crests + seed, sa * crests - seed);
    const n2 = vnoise2(ca * crests * 2.7 + seed * 3, sa * crests * 2.7 + seed);
    const n3 = vnoise2(ca * crests * 6.1 - seed, sa * crests * 6.1 + seed * 2);
    const t = Math.min(1, Math.max(0, 0.5 + 0.42 * n1 + 0.2 * n2 + 0.08 * n3));
    const height = minHeight + (maxHeight - minHeight) * t;
    const x = ca * radius;
    const z = sa * radius;
    // Flat normals tilted upward; inward-facing so the ring is lit from inside.
    const nx = -ca * 0.7;
    const nz = -sa * 0.7;
    pos.push(x, base, z, x, base + height, z);
    nor.push(nx, 0.72, nz, nx, 0.72, nz);
    col.push(1.18, 1.18, 1.18, 0.86, 0.86, 0.86);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Module state for the cloud drift, so the deck never jumps when the dome remounts. */
let cloudDrift = 0;

export function SkyDome() {
  const moonRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const haloMatRef = useRef<THREE.SpriteMaterial>(null);

  // Built by hand rather than as <shaderMaterial uniforms={...}>: the reconciler
  // copies each uniform entry into the material's own table, so per-frame writes
  // of the scalar uniforms on a shared object would never reach the GPU. The
  // constructor keeps the object by reference, so `uniforms` is the live table.
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => skyMat.dispose(), [skyMat]);

  const moonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: moonUniforms,
        vertexShader: MOON_VERTEX,
        fragmentShader: MOON_FRAGMENT,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => moonMat.dispose(), [moonMat]);

  const haloTex = useMemo(() => makeHaloTexture(), []);
  useEffect(() => () => haloTex.dispose(), [haloTex]);

  const ridges = useMemo(
    () =>
      RIDGES.map((ridge) => ({
        geometry: makeRidgeGeometry(ridge),
        material: new THREE.MeshStandardMaterial({ color: ridge.color, roughness: 1, vertexColors: true }),
      })),
    [],
  );
  useEffect(
    () => () => {
      for (const r of ridges) {
        r.geometry.dispose();
        r.material.dispose();
      }
    },
    [ridges],
  );

  useFrame(() => {
    uniforms.uZenith.value.copy(env.sky.zenith);
    uniforms.uHorizon.value.copy(env.sky.horizon);
    uniforms.uGlow.value.copy(env.sky.glow);
    uniforms.uSunColor.value.copy(env.sky.sun);
    uniforms.uSunDir.value.copy(env.sun.dir);
    uniforms.uSunDisc.value = env.sky.sunDisc;
    uniforms.uStars.value = env.sky.stars;
    uniforms.uNight.value = env.nightness;
    uniforms.uTime.value = env.time % TWINKLE_WRAP;
    uniforms.uCloud.value = env.cloud;
    cloudDrift += env.dt * CLOUD_DRIFT_RATE * (0.35 + env.wind);
    uniforms.uDrift.value = cloudDrift;

    const moon = moonRef.current;
    const halo = haloRef.current;
    const haloMat = haloMatRef.current;
    if (moon && halo && haloMat) {
      moon.position.copy(env.sun.moonDir).multiplyScalar(MOON_DISTANCE);
      halo.position.copy(moon.position);
      const up = THREE.MathUtils.smoothstep(env.sun.moonAltitude, 0.01, 0.06);
      const opacity = env.nightness * up * (1 - env.cloud * 0.7);
      moonUniforms.uSunDir.value.copy(env.sun.dir);
      moonUniforms.uOpacity.value = opacity;
      moon.visible = opacity > 0.01;
      // The halo swells with the lit fraction: a full moon hangs in a wide glow.
      haloMat.opacity = opacity * (0.35 + 0.65 * env.sun.moonFraction);
      halo.visible = moon.visible;
    }
  });

  return (
    <group>
      <mesh renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[45, 48, 32]} />
        <primitive object={skyMat} attach="material" />
      </mesh>

      <sprite ref={haloRef} visible={false} scale={[HALO_SCALE, HALO_SCALE, 1]} renderOrder={-1}>
        <spriteMaterial
          ref={haloMatRef}
          map={haloTex}
          color={HALO_COLOR}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>

      <mesh ref={moonRef} visible={false}>
        <sphereGeometry args={[MOON_RADIUS, 24, 16]} />
        <primitive object={moonMat} attach="material" />
      </mesh>

      {ridges.map((r, i) => (
        <mesh key={i} geometry={r.geometry} material={r.material} frustumCulled={false} />
      ))}
    </group>
  );
}
