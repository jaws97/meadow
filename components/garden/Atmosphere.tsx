"use client";
// The air of the garden: everything that floats, flutters, falls or glows
// between the lens and the hills.
//
// Points fields, each one THREE.Points with a small custom shader, so every
// particle's motion, blink and shape runs on the GPU and the CPU only writes a
// handful of uniforms per frame:
//
//   pollen     slow warm motes spread through the depth of the scene
//   fluff      a few dandelion seeds riding the wind
//   fireflies  warm yellow-green, soft attack and slow decay, with a halo,
//              each living in a lazy curve around the lantern or over the bed
//   rain       thin streaks slanted by the wind
//   splash     expanding rings where the drops meet the lawn
//   mist       a low band of damp air behind the hedges
//   scent      pale sparkles rising from a scented flower at dusk
//   embers     glowing petal sparks falling from a sickly flower
//
// Every field fakes its own depth of field: the vertex shader compares each
// particle's view depth with the distance to the flower head (the focus of the
// real DoF pass) and grows the sprite into a dim bokeh disc as it leaves focus,
// so motes near the lens and far behind the plant read as photography, not
// confetti. Which field you see is decided by its opacity curve, read from the
// shared env and the store every frame; a field at opacity 0 is not drawn.
//
// Butterflies are one InstancedMesh: two wing grids and a crossed body quad
// per instance, a canvas-painted atlas with three colourways, the wingbeat
// folded in the vertex shader by each vertex's distance from the body, and a
// small steering model on the CPU that wanders the bed, lands on the hero and
// the hedges for a moment, and flies off when it rains or the light goes.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { garden, useGarden, type GardenState, type Quality } from "@/lib/garden/store";
import { Rng } from "@/lib/plant/prng";
import { SPECIES, SPECIES_LIST, type SpeciesId } from "@/lib/plant/species";
import { makeCanvas, rgba, toTexture } from "@/lib/plant/textures";
import { useLayerFrame, useTier } from "@/components/garden/TierLayers";

type Env = typeof env;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 1 through the scented hours of the evening, easing in at 17:00 and out by 21:00. */
const duskWindow = (hour: number) => smooth(17, 17.8, hour) * (1 - smooth(20.2, 21, hour));

// ---------------------------------------------------------------------------
// Points fields

/** The shader branch a field compiles with; mirrors the MODE define below. */
const MODE = {
  pollen: 0,
  fluff: 1,
  firefly: 2,
  rain: 3,
  splash: 4,
  mist: 5,
  scent: 6,
  ember: 7,
} as const;
type Mode = (typeof MODE)[keyof typeof MODE];

/** How the resting positions are laid out before the shader animates them. */
type Spawn = "box" | "sphere" | "ground" | "fireflies";

interface FieldSpec {
  mode: Mode;
  spawn: Spawn;
  count: number;
  /** box size in metres, centred on `center`; the shader wraps and fades inside it */
  bounds: [number, number, number];
  center: [number, number, number];
  color: string;
  /** base sprite size in pixels at 1 m, before per-particle variation */
  size: number;
  /** per-particle size spread, multiplied into `size` */
  sizeRange: [number, number];
  /** sprite size cap in CSS pixels, before the pixel ratio */
  maxSize: number;
  /** fall speed in m/s for the rain */
  fall: number;
  /** fake bokeh: circle-of-confusion strength per metre out of focus */
  coc: number;
  /** fake bokeh: how many times the sprite grows at full confusion */
  bokeh: number;
  /** draw every particle twice, the copy as a large faint halo */
  halo: boolean;
  additive: boolean;
  seed: string;
  /** keep the field centred on the flower head */
  follow?: boolean;
  opacity: (e: Env, s: GardenState) => number;
  /** per-frame colour, written in place; omitted means the static `color` */
  tint?: (e: Env, s: GardenState, out: THREE.Color) => void;
}

type FieldUniforms = {
  uTime: THREE.IUniform<number>;
  uSize: THREE.IUniform<number>;
  uMaxSize: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uAspect: THREE.IUniform<number>;
  uFall: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  uRain: THREE.IUniform<number>;
  uFocus: THREE.IUniform<number>;
  uCoc: THREE.IUniform<number>;
  uBokeh: THREE.IUniform<number>;
  uBounds: THREE.IUniform<THREE.Vector3>;
  uColor: THREE.IUniform<THREE.Color>;
  uOpacity: THREE.IUniform<number>;
};

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uMaxSize;
  uniform float uPixelRatio;
  uniform float uAspect;
  uniform float uFall;
  uniform float uWind;
  uniform float uRain;
  uniform float uFocus;
  uniform float uCoc;
  uniform float uBokeh;
  uniform vec3 uBounds;
  attribute float aSeed;
  attribute float aSize;
  attribute float aLayer;
  attribute vec3 aAux;
  varying float vSeed;
  varying float vAlpha;
  varying float vCoc;
  varying float vLayer;
  varying float vPhase;
  varying float vSquash;
  varying vec2 vDir;

  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

  // 1 inside the box, easing to 0 at its faces, so wrapped particles never pop.
  float edgeFade(vec3 p, vec3 hb) {
    vec3 q = abs(p) / max(hb, vec3(1e-3));
    return 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));
  }

  void main() {
    vSeed = aSeed;
    vLayer = aLayer;
    vPhase = 0.0;
    vSquash = 1.0;
    vDir = vec2(0.0, 1.0);
    float t = uTime;
    vec3 hb = uBounds * 0.5;
    vec3 p = position;
    float alpha = 1.0;
    float sizeMul = 1.0;

  #if MODE == 0
    // Pollen: a slow three-tone wander plus wind advection, wrapped in x.
    p.x += sin(t * (0.11 + aSeed * 0.14) + aSeed * 12.0) * 0.18 + sin(t * 0.43 + aSeed * 3.0) * 0.04;
    p.y += sin(t * (0.09 + aSeed * 0.11) + aSeed * 7.0) * 0.12 + cos(t * 0.37 + aSeed * 23.0) * 0.025;
    p.z += cos(t * (0.1 + aSeed * 0.13) + aSeed * 5.0) * 0.18;
    p.x += t * uWind * 0.04 * (0.5 + aSeed);
    p.x = mod(p.x + hb.x, uBounds.x) - hb.x;
    alpha = edgeFade(p, hb);
  #elif MODE == 1
    // Fluff: bigger, slower, bobbing on gusts, carried further by the wind.
    p.x += sin(t * (0.08 + aSeed * 0.08) + aSeed * 12.0) * 0.35;
    p.y += sin(t * (0.17 + aSeed * 0.1) + aSeed * 7.0) * 0.16 + sin(t * 0.9 + aSeed * 40.0) * 0.02;
    p.z += cos(t * (0.07 + aSeed * 0.1) + aSeed * 5.0) * 0.35;
    p.x += t * uWind * 0.08 * (0.6 + aSeed * 0.8);
    p.x = mod(p.x + hb.x, uBounds.x) - hb.x;
    alpha = edgeFade(p, hb);
  #elif MODE == 2
    // Fireflies: each one lives around its own home point (aAux), drifting on
    // a lazy curve made of slow incommensurate sines, with a faint quick
    // jitter on top so the path never looks drawn. position.x is the reach of
    // the wander, position.y its height.
    float s1 = t * (0.06 + 0.06 * hash(aSeed * 3.3)) + aSeed * 6.2832;
    float s2 = t * (0.041 + 0.05 * hash(aSeed * 5.1)) + aSeed * 11.0;
    float reach = position.x;
    float lift = position.y;
    p = aAux + vec3(
      reach * (sin(s1) * 0.8 + sin(s2 * 1.7 + 1.3) * 0.35),
      lift * (sin(s2 * 1.3 + 0.7) * 0.6 + sin(s1 * 2.1) * 0.3),
      reach * (cos(s1 * 0.9 + 2.0) * 0.8 + cos(s2 * 1.4) * 0.35));
    p += vec3(sin(t * 1.3 + aSeed * 40.0), sin(t * 1.7 + aSeed * 20.0), cos(t * 1.1 + aSeed * 30.0)) * 0.018;
    p.y = max(p.y, 0.1);
    // Blink: a soft attack over the first part of the cycle, then a slow
    // exponential decay; some cycles are skipped so the swarm never pulses.
    float period = 2.6 + 3.0 * hash(aSeed * 7.1);
    float cyc = floor(t / period + aSeed);
    float ph = fract(t / period + aSeed);
    float on = step(0.3, hash(cyc * 0.731 + aSeed * 13.7));
    float att = 0.1;
    float e = ph < att ? smoothstep(0.0, att, ph) : exp(-(ph - att) * 4.5);
    vPhase = e * on;
  #elif MODE == 3
    // Rain: falls through the box, drifts with the wind, wraps in both. The
    // velocity is projected to the screen so the streak follows it from every
    // camera angle.
    float sp = uFall * (0.85 + 0.3 * aSeed);
    float wx = uWind * 1.4;
    p.y = mod(p.y + hb.y - t * sp, uBounds.y) - hb.y;
    p.x = mod(p.x + hb.x + t * wx + sin(t * 0.7 + aSeed * 9.0) * 0.03, uBounds.x) - hb.x;
    vec3 vel = vec3(wx, -sp, 0.0);
    vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p + vel * 0.02, 1.0);
    vec2 d = c1.xy / c1.w - c0.xy / c0.w;
    d.x *= uAspect;
    vDir = normalize(d + vec2(0.0, -1e-5));
    alpha = edgeFade(vec3(p.x, 0.0, p.z), hb) * (0.45 + 0.55 * hash(aSeed * 9.9));
  #elif MODE == 4
    // Splash rings: each sprite cycles at its own rate; a drop lands when the
    // cycle's random is below the rain amount, so the lawn fizzes in proportion.
    float rate = 1.1 + 1.5 * hash(aSeed * 4.4);
    float cyc = floor(t * rate + aSeed);
    float ph = fract(t * rate + aSeed);
    float on = step(1.0 - uRain, hash(cyc * 0.37 + aSeed * 21.1));
    vPhase = ph;
    sizeMul = 0.3 + 0.7 * ph;
    alpha = on * pow(1.0 - ph, 1.4) * edgeFade(vec3(p.x, 0.0, p.z), hb);
    // The ring lies on the ground, so from the camera's elevation it is an ellipse.
    vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
    vSquash = max(0.12, abs(normalize(cameraPosition - wp).y));
  #elif MODE == 5
    // Mist: wide soft puffs drifting with the wind, wrapped in x.
    p.x += sin(t * (0.05 + aSeed * 0.04) + aSeed * 12.0) * 0.4 + t * uWind * 0.06;
    p.y += sin(t * (0.07 + aSeed * 0.05) + aSeed * 7.0) * 0.08;
    p.x = mod(p.x + hb.x, uBounds.x) - hb.x;
    alpha = edgeFade(p, hb);
  #elif MODE == 6
    // Scent: sparkles born on the flower head rise, spread and fade.
    float rate = 0.22 + 0.2 * hash(aSeed * 4.4);
    float ph = fract(t * rate + aSeed);
    vPhase = ph;
    float spread = 1.0 + ph * 2.2;
    p.xz *= spread;
    p.y += ph * (0.3 + 0.3 * aSize);
    p.x += sin(t * 0.8 + aSeed * 20.0) * 0.02 * ph + uWind * ph * ph * 0.08;
    p.z += cos(t * 0.7 + aSeed * 13.0) * 0.02 * ph;
    alpha = sin(ph * 3.1416);
  #elif MODE == 7
    // Embers: sparks leave the flower head and fall faster and faster,
    // fluttering sideways and fading before they reach the lawn.
    float rate = 0.3 + 0.25 * hash(aSeed * 4.4);
    float ph = fract(t * rate + aSeed);
    vPhase = ph;
    p.y -= ph * ph * 0.9;
    p.x += sin(t * 2.5 + aSeed * 20.0) * 0.05 * ph + uWind * ph * ph * 0.12;
    p.z += cos(t * 2.1 + aSeed * 13.0) * 0.05 * ph;
    alpha = pow(1.0 - ph, 1.3) * smoothstep(0.0, 0.06, ph);
  #endif

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(0.05, -mv.z);
    // Thin-lens circle of confusion, normalised: 0 sharp .. 1 fully defocused.
    float coc = clamp(abs(depth - uFocus) / depth * uCoc, 0.0, 1.0);
    vCoc = coc;
    float px = uSize * aSize * sizeMul * uPixelRatio / depth;
    px *= 1.0 + coc * uBokeh;
    // A defocused sprite spreads the same light over more pixels.
    alpha /= 1.0 + coc * uBokeh * 1.2;
    if (aLayer > 0.5) {
      px *= 3.8;
      alpha *= 0.22;
    }
    // Sub-pixel sprites alias into hard dots; fade them out instead.
    alpha *= smoothstep(0.6, 2.2, px);
    // Nothing right against the lens.
    alpha *= smoothstep(0.12, 0.35, depth);
    gl_PointSize = clamp(px, 1.0, uMaxSize * uPixelRatio);
    vAlpha = alpha;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vSeed;
  varying float vAlpha;
  varying float vCoc;
  varying float vLayer;
  varying float vPhase;
  varying float vSquash;
  varying vec2 vDir;

  // Out-of-focus highlights become a soft disc with a faintly brighter rim.
  float bokehDisc(float r) {
    return smoothstep(1.0, 0.72, r) * (0.7 + 0.3 * smoothstep(0.35, 0.9, r));
  }

  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float r = length(c);
    float clip = 1.0 - smoothstep(0.9, 1.0, r);
    vec3 col = uColor;
    float a = 0.0;

  #if MODE == 0
    float soft = exp(-r * r * 3.0);
    a = mix(soft, bokehDisc(r), vCoc) * clip;
    a *= 0.75 + 0.25 * sin(uTime * (0.9 + vSeed * 1.2) + vSeed * 40.0);
  #elif MODE == 1
    // A seed head: a bright core and a fuzz of fine spokes that turn slowly.
    float spin = uTime * (0.25 + vSeed * 0.3) * (vSeed > 0.5 ? 1.0 : -1.0);
    float ang = atan(c.y, c.x) + spin;
    float spokes = (0.5 + 0.5 * sin(ang * 15.0 + vSeed * 20.0)) * (0.6 + 0.4 * sin(ang * 7.0 - vSeed * 9.0));
    float core = exp(-r * r * 12.0);
    float fuzz = smoothstep(1.0, 0.15, r) * (0.3 + 0.7 * spokes);
    float sharp = (core * 0.9 + fuzz * 0.45) * clip;
    a = mix(sharp, exp(-r * r * 2.5) * 0.55 * clip, vCoc);
  #elif MODE == 2
    float blink = vPhase;
    if (vLayer > 0.5) {
      a = exp(-r * r * 2.6) * clip;
      col = uColor * 0.85;
    } else {
      float core = exp(-r * r * 5.0);
      float glow = exp(-r * r * 1.8);
      float sharp = core + glow * 0.35;
      a = mix(sharp, bokehDisc(r) * 0.8, vCoc) * clip;
      col = mix(uColor, vec3(1.0, 0.98, 0.85), core * 0.75) * 2.6;
    }
    a *= blink;
  #elif MODE == 3
    // gl_PointCoord runs top-down, the projected velocity bottom-up.
    vec2 cs = vec2(c.x, -c.y);
    vec2 perp = vec2(vDir.y, -vDir.x);
    vec2 q = vec2(dot(cs, perp), dot(cs, vDir));
    float across = exp(-q.x * q.x * 80.0);
    float along = 1.0 - smoothstep(0.5, 1.0, abs(q.y));
    float head = 0.35 + 0.65 * smoothstep(-1.0, 0.7, q.y);
    a = across * along * head;
  #elif MODE == 4
    vec2 q = vec2(c.x, c.y / vSquash);
    float rr = length(q);
    float ring = exp(-pow((rr - 0.74) * 7.5, 2.0)) * (1.0 - smoothstep(0.9, 1.0, rr));
    float drop = exp(-rr * rr * 20.0) * (1.0 - smoothstep(0.0, 0.3, vPhase)) * 0.8;
    a = ring * 0.75 + drop;
  #elif MODE == 5
    vec2 q = vec2(c.x, c.y * 1.7);
    float rq = length(q);
    a = exp(-rq * rq * 2.6) * (1.0 - smoothstep(0.75, 1.0, rq));
  #elif MODE == 6
    // A four-point sparkle with a quick twinkle.
    float cross = max(exp(-c.x * c.x * 45.0) * exp(-c.y * c.y * 3.5), exp(-c.y * c.y * 45.0) * exp(-c.x * c.x * 3.5));
    float core = exp(-r * r * 6.0);
    float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (5.0 + vSeed * 7.0) + vSeed * 50.0), 2.0);
    a = mix(core + cross * 0.6, bokehDisc(r) * 0.7, vCoc) * clip * tw;
    col = mix(uColor, vec3(1.0), core * 0.5) * 1.8;
  #elif MODE == 7
    float core = exp(-r * r * 7.0);
    float glow = exp(-r * r * 2.2);
    float flick = 0.6 + 0.4 * sin(uTime * (9.0 + vSeed * 6.0) + vSeed * 30.0);
    a = mix(core + glow * 0.35, bokehDisc(r) * 0.8, vCoc) * clip * flick;
    col = mix(uColor, vec3(1.0, 0.92, 0.7), core * 0.85) * 2.2;
  #endif

    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
    // No-ops inside the linear buffer of the post-processing stack; when the
    // scene renders straight to the canvas (effects still loading) these apply
    // the tone mapping and output colour space of the renderer, as built-in
    // materials do.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function spawnAt(spawn: Spawn, rng: Rng, bx: number, by: number, bz: number, out: Float32Array, aux: Float32Array, i: number) {
  const o = i * 3;
  switch (spawn) {
    case "box":
      out[o] = (rng.next() - 0.5) * bx;
      out[o + 1] = (rng.next() - 0.5) * by;
      out[o + 2] = (rng.next() - 0.5) * bz;
      return;
    case "sphere": {
      const g = rng.gauss();
      const u = rng.next() * Math.PI * 2;
      const v = Math.acos(2 * rng.next() - 1);
      const rad = Math.abs(g) * 0.5 + 0.2;
      out[o] = Math.sin(v) * Math.cos(u) * rad * bx * 0.5;
      out[o + 1] = Math.cos(v) * rad * by * 0.5;
      out[o + 2] = Math.sin(v) * Math.sin(u) * rad * bz * 0.5;
      return;
    }
    case "ground": {
      // An annulus clear of the hero's stem, flat on the lawn and the bed.
      const u = rng.next() * Math.PI * 2;
      const rad = 0.3 + Math.sqrt(rng.next()) * (bx * 0.5 - 0.3);
      out[o] = Math.cos(u) * rad;
      out[o + 1] = 0;
      out[o + 2] = Math.sin(u) * rad;
      return;
    }
    case "fireflies": {
      // Where this one lives: four in ten in the lantern's light, the rest
      // over the bed and the lawn around it. aux is the home point; x and y
      // of the position are the reach and lift of its wander.
      if (rng.next() < 0.4) {
        const [lx, , lz] = LAYOUT.lantern.position;
        const a = rng.next() * Math.PI * 2;
        const rr = 0.1 + Math.sqrt(rng.next()) * 0.55;
        aux[o] = lx + Math.cos(a) * rr;
        aux[o + 1] = LAYOUT.lantern.lampHeight + rng.range(-0.5, 0.3);
        aux[o + 2] = lz + Math.sin(a) * rr;
        out[o] = rng.range(0.1, 0.3);
        out[o + 1] = rng.range(0.06, 0.18);
      } else {
        const [cx, , cz] = LAYOUT.bed.center;
        const a = rng.next() * Math.PI * 2;
        const rr = Math.sqrt(rng.next()) * 1.35;
        aux[o] = cx + Math.cos(a) * rr * LAYOUT.bed.rx;
        aux[o + 1] = rng.range(0.22, 1.05);
        aux[o + 2] = cz + Math.sin(a) * rr * LAYOUT.bed.rz;
        out[o] = rng.range(0.15, 0.45);
        out[o + 1] = rng.range(0.08, 0.25);
      }
      out[o + 2] = 0;
      return;
    }
  }
}

/**
 * The largest point size a context rasterises, read once per context: the
 * query waits for the GPU to finish its work (a tenth of a second on a busy
 * one), and a tier built out of sight on a showing garden (TierLayers) would
 * otherwise wait on it again, in the open.
 */
const pointSizes = new WeakMap<object, number>();
function pointSizeMax(ctx: WebGLRenderingContext | WebGL2RenderingContext): number {
  let max = pointSizes.get(ctx);
  if (max === undefined) {
    const range = ctx.getParameter(ctx.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    max = range && range.length > 1 ? range[1] : 64;
    pointSizes.set(ctx, max);
  }
  return max;
}

function ParticleField({ spec, count }: { spec: FieldSpec; count: number }) {
  const gl = useThree((s) => s.gl);
  const pointsRef = useRef<THREE.Points>(null);
  const { mode, spawn, bounds, center, color, size, sizeRange, maxSize, fall, coc, bokeh, halo, additive, seed } = spec;
  const [bx, by, bz] = bounds;
  const [s0, s1] = sizeRange;

  const geometry = useMemo(() => {
    const rng = new Rng(seed);
    const layers = halo ? 2 : 1;
    const n = count * layers;
    const positions = new Float32Array(n * 3);
    const aux = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const sizes = new Float32Array(n);
    const layer = new Float32Array(n);
    for (let i = 0; i < count; i++) {
      spawnAt(spawn, rng, bx, by, bz, positions, aux, i);
      seeds[i] = rng.next();
      sizes[i] = rng.range(s0, s1);
      layer[i] = 0;
    }
    for (let l = 1; l < layers; l++) {
      for (let i = 0; i < count; i++) {
        const j = l * count + i;
        positions[j * 3] = positions[i * 3];
        positions[j * 3 + 1] = positions[i * 3 + 1];
        positions[j * 3 + 2] = positions[i * 3 + 2];
        aux[j * 3] = aux[i * 3];
        aux[j * 3 + 1] = aux[i * 3 + 1];
        aux[j * 3 + 2] = aux[i * 3 + 2];
        seeds[j] = seeds[i];
        sizes[j] = sizes[i];
        layer[j] = l;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aAux", new THREE.BufferAttribute(aux, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aLayer", new THREE.BufferAttribute(layer, 1));
    return g;
  }, [count, spawn, bx, by, bz, s0, s1, halo, seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const { material, uniforms } = useMemo(() => {
    const u: FieldUniforms = {
      uTime: { value: 0 },
      uSize: { value: 1 },
      uMaxSize: { value: 64 },
      uPixelRatio: { value: 1 },
      uAspect: { value: 1 },
      uFall: { value: 0 },
      uWind: { value: 0 },
      uRain: { value: 0 },
      uFocus: { value: 2.5 },
      uCoc: { value: 0 },
      uBokeh: { value: 0 },
      uBounds: { value: new THREE.Vector3(1, 1, 1) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      defines: { MODE: mode },
      uniforms: u,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return { material: m, uniforms: u };
  }, [mode, additive]);
  useEffect(() => () => material.dispose(), [material]);

  // The largest sprite this GPU will rasterise; the shader clamps to it so a
  // mist puff degrades to a smaller puff instead of vanishing.
  const hardwareMax = useMemo(() => pointSizeMax(gl.getContext()), [gl]);

  // The static uniforms follow the props. Layout effect so they are in place
  // before the render loop's first tick after mount.
  /* eslint-disable react-hooks/immutability -- the memoised uniforms are three.js
     objects the effect and the frame loop drive imperatively; React never re-renders on them. */
  useLayoutEffect(() => {
    uniforms.uSize.value = size;
    uniforms.uMaxSize.value = Math.min(maxSize, hardwareMax / gl.getPixelRatio());
    uniforms.uPixelRatio.value = gl.getPixelRatio();
    uniforms.uFall.value = fall;
    uniforms.uCoc.value = coc;
    uniforms.uBokeh.value = bokeh;
    uniforms.uBounds.value.set(bx, by, bz);
    uniforms.uColor.value.set(color);
  }, [uniforms, gl, hardwareMax, size, maxSize, fall, coc, bokeh, bx, by, bz, color]);

  useLayerFrame((state) => {
    const s = garden.get();
    const o = spec.opacity(env, s);
    const points = pointsRef.current;
    const visible = o > 0.005;
    if (points) points.visible = visible;
    if (!visible) return;
    uniforms.uOpacity.value = o;
    uniforms.uTime.value = env.time;
    uniforms.uWind.value = env.wind;
    uniforms.uRain.value = env.rain;
    const pr = state.gl.getPixelRatio();
    uniforms.uPixelRatio.value = pr;
    uniforms.uMaxSize.value = Math.min(maxSize, hardwareMax / pr);
    uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height);
    // The real DoF focuses on the flower head; the sprites agree with it.
    focusScratch.copy(env.headPos).applyMatrix4(state.camera.matrixWorldInverse);
    uniforms.uFocus.value = Math.max(0.2, -focusScratch.z);
    if (spec.tint) spec.tint(env, s, uniforms.uColor.value);
    if (spec.follow && points) points.position.copy(env.headPos);
  });
  /* eslint-enable react-hooks/immutability */

  return <points ref={pointsRef} geometry={geometry} material={material} position={center} frustumCulled={false} />;
}

const focusScratch = new THREE.Vector3();
const POLLEN_WARM = new THREE.Color("#ffd98a");
const MIST_LIFT = new THREE.Color("#dfe6ee");
const SCENT_PALE = new THREE.Color("#fff6e4");
const WHITE = new THREE.Color("#ffffff");

const GLOW_COLORS = Object.fromEntries(
  SPECIES_LIST.map((s) => [s.id, new THREE.Color(s.fx.glowColor)]),
) as Record<SpeciesId, THREE.Color>;

/** A clear, dry day; 1 at noon in sunshine, 0 in rain or after dark. */
const dayAir = (e: Env) => (1 - e.nightness) * (1 - e.rain);

/** A dawn mist on the lawn, thickest a little after sunrise. */
const dawnMist = (hour: number) => smooth(5.6, 6.4, hour) * (1 - smooth(7.4, 8.8, hour));

// Module-level so every prop keeps the same reference between renders.
// The box stops a metre short of the default camera and the sprites are held
// small and faint: at noon a mote drifting past the lens became a large white
// blob, noise against the calm rather than light in the air.
const POLLEN: FieldSpec = {
  mode: MODE.pollen,
  spawn: "box",
  count: 56,
  bounds: [5, 1.4, 4.6],
  center: [0, 0.65, -0.4],
  color: "#fff0c8",
  size: 6,
  sizeRange: [0.5, 1.3],
  maxSize: 14,
  fall: 0,
  coc: 1.2,
  bokeh: 2.2,
  halo: false,
  additive: true,
  seed: "pollen",
  // fainter still with a high sun, when the sky behind them is brightest
  opacity: (e) => dayAir(e) * (1 - e.cloud * 0.55) * (0.42 - 0.3 * smooth(0.5, 0.95, e.sun.altitude)),
  // Lit by the sun: white-gold at noon, amber at golden hour.
  tint: (e, _s, out) => out.copy(e.sky.sun).lerp(POLLEN_WARM, 0.6),
};

const FLUFF: FieldSpec = {
  mode: MODE.fluff,
  spawn: "box",
  count: 5,
  bounds: [5.5, 1.8, 5.5],
  center: [0, 0.9, 0.2],
  color: "#fffaf0",
  size: 62,
  sizeRange: [0.7, 1.3],
  maxSize: 170,
  fall: 0,
  coc: 1.0,
  bokeh: 1.6,
  halo: false,
  // Backlit seed heads glow against the lawn; additive keeps them luminous.
  additive: true,
  seed: "fluff",
  opacity: (e) => dayAir(e) * (1 - e.cloud * 0.4) * 0.9,
  tint: (e, _s, out) => out.copy(WHITE).lerp(e.sky.sun, 0.5),
};

const FIREFLIES: FieldSpec = {
  mode: MODE.firefly,
  spawn: "fireflies",
  count: 56,
  bounds: [4, 2, 4],
  center: [0, 0, 0],
  color: "#dcef52",
  size: 9,
  sizeRange: [0.7, 1.35],
  maxSize: 120,
  fall: 0,
  coc: 1.1,
  bokeh: 3,
  halo: true,
  additive: true,
  seed: "fireflies",
  // Marigolds draw them out earlier, while the sky is still lit.
  opacity: (e, s) =>
    (s.speciesId === "marigold" ? smooth(0.28, 0.75, e.nightness) : smooth(0.45, 0.9, e.nightness)) * (1 - e.rain * 0.7),
};

const RAIN: FieldSpec = {
  mode: MODE.rain,
  spawn: "box",
  count: 1800,
  bounds: [6.5, 3.6, 6.5],
  center: [0, 1.6, 0.3],
  color: "#e4edf7",
  size: 34,
  sizeRange: [0.7, 1.3],
  maxSize: 110,
  fall: 3.2,
  coc: 0,
  bokeh: 0,
  halo: false,
  additive: false,
  seed: "rain",
  opacity: (e) => e.rain * 0.6,
  tint: (e, _s, out) => out.copy(e.sky.horizon).lerp(WHITE, 0.6),
};

const SPLASH: FieldSpec = {
  mode: MODE.splash,
  spawn: "ground",
  count: 300,
  bounds: [4.6, 0, 4.6],
  center: [0, 0.018, 0],
  color: "#eef4fa",
  size: 95,
  sizeRange: [0.7, 1.3],
  maxSize: 90,
  fall: 0,
  coc: 0,
  bokeh: 0,
  halo: false,
  additive: false,
  seed: "splash",
  opacity: (e) => smooth(0.05, 0.6, e.rain) * 0.42,
  tint: (e, _s, out) => out.copy(e.sky.horizon).lerp(WHITE, 0.5),
};

const MIST: FieldSpec = {
  mode: MODE.mist,
  spawn: "box",
  count: 140,
  bounds: [15, 1.3, 3.2],
  center: [0, 0.5, -5.2],
  color: "#cfd8e2",
  size: 1000,
  sizeRange: [0.7, 1.4],
  maxSize: 520,
  fall: 0,
  coc: 0,
  bokeh: 0,
  halo: false,
  additive: false,
  seed: "mist",
  opacity: (e) => (e.rain * 0.2 + smooth(0.6, 1, e.cloud) * 0.04 + dawnMist(e.hour) * 0.1) * (1 - 0.5 * e.nightness),
  tint: (e, _s, out) => out.copy(e.sky.fog).lerp(MIST_LIFT, 0.35),
};

const SCENT: FieldSpec = {
  mode: MODE.scent,
  spawn: "sphere",
  count: 80,
  bounds: [0.26, 0.2, 0.26],
  center: [0, 0.9, 0],
  color: "#fff6e4",
  size: 9,
  sizeRange: [0.6, 1.4],
  maxSize: 90,
  fall: 0,
  coc: 2,
  bokeh: 4,
  halo: false,
  additive: true,
  seed: "scent",
  follow: true,
  opacity: (e, s) => (SPECIES[s.speciesId].fx.scent ? 1 : 0) * duskWindow(e.hour) * (1 - e.rain) * s.bloom * s.growth,
  tint: (_e, s, out) => out.copy(SCENT_PALE).lerp(GLOW_COLORS[s.speciesId], 0.35),
};

const EMBERS: FieldSpec = {
  mode: MODE.ember,
  spawn: "sphere",
  count: 60,
  bounds: [0.3, 0.26, 0.3],
  center: [0, 0.9, 0],
  color: "#ff6a4a",
  size: 15,
  sizeRange: [0.5, 1.4],
  maxSize: 90,
  fall: 0,
  coc: 1.6,
  bokeh: 3,
  halo: false,
  additive: true,
  seed: "embers",
  follow: true,
  opacity: (_e, s) => (SPECIES[s.speciesId].fx.sparks ? 1 : 0) * smooth(0.5, 0.42, s.health) * (1 - s.health) * s.growth,
  tint: (_e, s, out) => out.copy(GLOW_COLORS[s.speciesId]),
};

const FIELDS: FieldSpec[] = [POLLEN, FLUFF, FIREFLIES, RAIN, SPLASH, MIST, SCENT, EMBERS];

// The fields cost fill rate, not vertices: fewer blended sprites on weaker
// devices. A count change rebuilds that field's geometry once.
const COUNT_SCALE: Record<Quality, number> = { cinematic: 1, balanced: 0.7, lite: 0.45 };

// ---------------------------------------------------------------------------
// Butterflies

/** Atlas cell: the wing image on the left, a strip for the body on the right. */
const CELL_W = 272;
const CELL_H = 256;
const WING_W = 224;
const WING_U = WING_W / CELL_W;

interface Colorway {
  base: string;
  inner: string;
  tip: string;
  vein: string;
  veinWidth: number;
  border: number;
  borderColor: string;
  dots: string | null;
  /** an orange patch on the forewing tip */
  apex: string | null;
  /** a single dark eyespot on the forewing */
  spot: boolean;
  /** wing size, relative to the monarch */
  scale: number;
}

const COLORWAYS: Colorway[] = [
  // monarch: orange panes in a black lattice, white dots on the margins
  { base: "#f28a1e", inner: "#d4541a", tip: "#ffa43a", vein: "#1a120b", veinWidth: 3, border: 18, borderColor: "#17110b", dots: "#fff1d6", apex: null, spot: false, scale: 1 },
  // morpho: electric blue in a wide black frame
  { base: "#2f86ff", inner: "#1e46c8", tip: "#9ae6ff", vein: "#15275e", veinWidth: 1.4, border: 26, borderColor: "#0b1230", dots: "#d8e6ff", apex: null, spot: false, scale: 1.2 },
  // orange-tip: cream with sun-orange forewing tips and one eyespot
  { base: "#fff3d2", inner: "#f0dba6", tip: "#fff8e6", vein: "#b39a66", veinWidth: 1.3, border: 7, borderColor: "#5a4a36", dots: null, apex: "#ff8a2a", spot: true, scale: 0.8 },
];

/** Vein endpoints on the margins, in the wing image's pixels (body at x = 0). */
const FORE_VEINS: ReadonlyArray<readonly [number, number]> = [
  [214, 26], [204, 56], [192, 86], [176, 112], [156, 132], [112, 136],
];
const HIND_VEINS: ReadonlyArray<readonly [number, number]> = [
  [160, 140], [162, 176], [146, 212], [112, 236], [76, 240], [40, 232], [12, 200],
];
/** Marginal dots: x, y, radius. */
const DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [62, 56, 2.5], [96, 38, 3], [130, 27, 3], [166, 24, 3], [197, 38, 3], [201, 64, 2.5], [191, 92, 2.5], [177, 116, 2.5],
  [157, 162, 2.5], [149, 198, 3], [126, 226, 3], [96, 237, 3], [64, 236, 3], [36, 220, 2.5], [14, 190, 2.5],
];

/** Both lobes of one wing: the pointed forewing above, the rounded hindwing below. */
function wingPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(2, 124);
  ctx.bezierCurveTo(40, 46, 140, 8, 214, 26);
  ctx.bezierCurveTo(206, 66, 186, 108, 164, 130);
  ctx.bezierCurveTo(120, 136, 50, 134, 2, 131);
  ctx.closePath();
  ctx.moveTo(2, 131);
  ctx.bezierCurveTo(60, 126, 136, 126, 160, 138);
  ctx.bezierCurveTo(166, 186, 128, 240, 76, 240);
  ctx.bezierCurveTo(34, 240, 6, 206, 2, 162);
  ctx.closePath();
}

/** The outer margins only, for the dark border band. */
function marginPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(2, 124);
  ctx.bezierCurveTo(40, 46, 140, 8, 214, 26);
  ctx.bezierCurveTo(206, 66, 186, 108, 164, 130);
  ctx.moveTo(160, 138);
  ctx.bezierCurveTo(166, 186, 128, 240, 76, 240);
  ctx.bezierCurveTo(34, 240, 6, 206, 2, 162);
}

function paintWing(ctx: CanvasRenderingContext2D, cw: Colorway, rng: Rng) {
  ctx.save();
  wingPath(ctx);
  ctx.clip();
  // Pigment: deeper toward the body, brighter at the tip.
  const g = ctx.createLinearGradient(0, 0, WING_W, 0);
  g.addColorStop(0, cw.inner);
  g.addColorStop(0.35, cw.base);
  g.addColorStop(1, cw.tip);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WING_W, CELL_H);
  // Scales catching the light across the middle of the wing.
  const sheen = ctx.createRadialGradient(110, 96, 10, 110, 96, 120);
  sheen.addColorStop(0, "rgba(255,255,255,0.24)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, WING_W, CELL_H);
  if (cw.apex) {
    const ag = ctx.createLinearGradient(110, 0, 214, 0);
    ag.addColorStop(0, rgba(cw.apex, 0));
    ag.addColorStop(0.45, rgba(cw.apex, 0.85));
    ag.addColorStop(1, cw.apex);
    ctx.fillStyle = ag;
    ctx.fillRect(100, 0, 124, 134);
  }
  // Scale grain.
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.5 ? cw.inner : cw.tip, 0.05 + rng.next() * 0.07);
    ctx.fillRect(rng.next() * WING_W, rng.next() * CELL_H, 1.5, 1.5);
  }
  // Veins fan out from the root to the margins; the fore and hind wings meet
  // along a fainter fold.
  ctx.strokeStyle = cw.vein;
  ctx.lineWidth = cw.veinWidth;
  ctx.lineCap = "round";
  for (const [x, y] of FORE_VEINS) {
    ctx.beginPath();
    ctx.moveTo(4, 126);
    ctx.quadraticCurveTo((4 + x) * 0.5, (126 + y) * 0.5 - 12, x, y);
    ctx.stroke();
  }
  for (const [x, y] of HIND_VEINS) {
    ctx.beginPath();
    ctx.moveTo(4, 134);
    ctx.quadraticCurveTo((4 + x) * 0.5, (134 + y) * 0.5 + 10, x, y);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(cw.vein, 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, 131);
  ctx.quadraticCurveTo(90, 128, 160, 136);
  ctx.stroke();
  // The dark border band, stroked on the margins and clipped to the inside.
  ctx.strokeStyle = cw.borderColor;
  ctx.lineWidth = cw.border * 2;
  ctx.lineJoin = "round";
  marginPath(ctx);
  ctx.stroke();
  if (cw.dots) {
    ctx.fillStyle = cw.dots;
    for (const [x, y, r] of DOTS) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (cw.spot) {
    ctx.fillStyle = "#2a2018";
    ctx.beginPath();
    ctx.ellipse(128, 80, 9, 7, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shadow under the thorax where the wing roots meet the body.
  const root = ctx.createRadialGradient(0, 128, 0, 0, 128, 44);
  root.addColorStop(0, "rgba(20,12,6,0.55)");
  root.addColorStop(1, "rgba(20,12,6,0)");
  ctx.fillStyle = root;
  ctx.fillRect(0, 60, 60, 140);
  ctx.restore();
}

/** Head, furry thorax and a tapering ringed abdomen, antennae at the top. */
function paintBody(ctx: CanvasRenderingContext2D) {
  const cx = WING_W + (CELL_W - WING_W) / 2;
  ctx.save();
  ctx.strokeStyle = "#1b1209";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 2, 96);
  ctx.quadraticCurveTo(cx - 10, 72, cx - 14, 50);
  ctx.moveTo(cx + 2, 96);
  ctx.quadraticCurveTo(cx + 10, 72, cx + 14, 50);
  ctx.stroke();
  ctx.fillStyle = "#1b1209";
  for (const sx of [-14, 14]) {
    ctx.beginPath();
    ctx.arc(cx + sx, 49, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const bg = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
  bg.addColorStop(0, "#1a110a");
  bg.addColorStop(0.45, "#4e3622");
  bg.addColorStop(1, "#160e08");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(cx, 101, 6, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, 122, 8.5, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 7, 132);
  ctx.quadraticCurveTo(cx - 7, 190, cx, 214);
  ctx.quadraticCurveTo(cx + 7, 190, cx + 7, 132);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,230,180,0.28)";
  ctx.lineWidth = 1;
  for (let y = 142; y < 206; y += 9) {
    const hw = 7 * (1 - (y - 132) / 90);
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx + hw, y);
    ctx.stroke();
  }
  ctx.restore();
}

let wingAtlas: THREE.CanvasTexture | null = null;

/**
 * The wings' atlas, painted once for the page and kept, never disposed: it is
 * the same in every tier, and Chrome rasterises a 2D canvas on the GPU, so
 * painting it again for a tier built out of sight on a showing garden
 * (TierLayers) stalled the live garden's frames for half a second.
 */
function wingTexture(): THREE.CanvasTexture {
  wingAtlas ??= toTexture(paintWingAtlas());
  return wingAtlas;
}

function paintWingAtlas(): HTMLCanvasElement {
  const c = makeCanvas(CELL_W, CELL_H * COLORWAYS.length);
  const ctx = c.getContext("2d")!;
  const rng = new Rng("wings");
  COLORWAYS.forEach((cw, row) => {
    ctx.save();
    ctx.translate(0, row * CELL_H);
    paintWing(ctx, cw, rng);
    paintBody(ctx);
    ctx.restore();
  });
  return c;
}

/**
 * Unit butterfly: wings span 1 from the body to each tip along x, forward
 * is +z, the body a cross of two thin quads along the axis. The wings are
 * grids so the shader can fold them.
 */
function makeButterflyGeometry(): THREE.BufferGeometry {
  const NU = 8;
  const NV = 6;
  const CHORD = 1.05;
  const pos: number[] = [];
  const uv: number[] = [];
  const body: number[] = [];
  const idx: number[] = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        pos.push(side * u, 0, (v - 0.5) * CHORD);
        uv.push(u * WING_U, v);
        body.push(0);
      }
    }
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i;
        const b = a + 1;
        const c = a + NU + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const R = 0.1;
  const Z0 = -0.5 * CHORD;
  const Z1 = 0.5 * CHORD;
  const quad = (corners: ReadonlyArray<readonly [number, number, number, number]>, kind: number) => {
    const base = pos.length / 3;
    for (const [x, y, z, t] of corners) {
      pos.push(x, y, z);
      uv.push(WING_U + t * (1 - WING_U), z < 0 ? 0 : 1);
      body.push(kind);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  quad([[0, -R, Z0, 0], [0, R, Z0, 1], [0, -R, Z1, 0], [0, R, Z1, 1]], 1);
  quad([[-R, 0, Z0, 0], [R, 0, Z0, 1], [-R, 0, Z1, 0], [R, 0, Z1, 1]], 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aBody", new THREE.Float32BufferAttribute(body, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const WING_VERTEX = /* glsl */ `
  uniform float uTime;
  attribute float aBody;
  attribute float aPhase;
  attribute float aRate;
  attribute float aFold;
  attribute float aColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  #include <fog_pars_vertex>

  void main() {
    float d = abs(position.x);
    // The beat in flight is a fast sine; at rest the wings are held up and
    // fanned slowly. aFold eases between them as the butterfly lands.
    float beat = sin(6.2832 * (uTime * aRate + aPhase));
    float fly = 0.45 + 0.85 * beat;
    float rest = 1.2 + 0.28 * sin(6.2832 * (uTime * 0.35 + aPhase));
    float ang = mix(fly, rest, aFold);
    // The tips travel further than the roots, so the wing bends.
    ang *= 1.0 + 0.22 * d;
    float s = sin(ang);
    float c = cos(ang);
    vec3 p = position;
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (aBody < 0.5) {
      float sx = sign(position.x);
      p = vec3(position.x * c, d * s, position.z);
      // The hindwing trails the beat a touch.
      p.y += (0.5 - uv.y) * 0.08 * beat * d * (1.0 - aFold);
      n = vec3(-sx * s, c, 0.0);
    } else {
      n = aBody > 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    }
    vUv = vec2(uv.x, (uv.y + (2.0 - aColor)) / 3.0);
    mat4 model = modelMatrix;
    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
    #endif
    vec4 world = model * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(model) * n);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WING_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGround;
  uniform float uAmbient;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.5) discard;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    float ndl = dot(n, uSunDir);
    vec3 hemi = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * n.y);
    // A wing is a thin membrane: light from behind comes through it.
    float through = max(-ndl, 0.0) * 0.7;
    vec3 light = hemi + vec3(uAmbient) + uSunColor * (max(ndl, 0.0) + through);
    // A touch of sheen where the view grazes the scales.
    float fres = pow(1.0 - abs(dot(n, v)), 3.0);
    vec3 col = tex.rgb * light + uSunColor * fres * 0.06;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Shadow pass: the same fold, packed depth, the wing shape cut by the alpha. */
const WING_DEPTH_FRAGMENT = /* glsl */ `
  precision highp float;
  #include <packing>
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    if (texture2D(uMap, vUv).a < 0.5) discard;
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  }
`;

type WingUniforms = {
  uTime: THREE.IUniform<number>;
  uMap: THREE.IUniform<THREE.Texture>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uHemiSky: THREE.IUniform<THREE.Color>;
  uHemiGround: THREE.IUniform<THREE.Color>;
  uAmbient: THREE.IUniform<number>;
  fogColor: THREE.IUniform<THREE.Color>;
  fogNear: THREE.IUniform<number>;
  fogFar: THREE.IUniform<number>;
  fogDensity: THREE.IUniform<number>;
};

const FLY = 0;
const LAND = 1;
const SIT = 2;
const LEAVE = 3;
const GONE = 4;

interface Flyer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  heading: THREE.Vector3;
  mode: number;
  timer: number;
  jitter: number;
  fold: number;
  bank: number;
  /** index into the perches, or -1 */
  perch: number;
  cruise: number;
  rate: number;
  phase: number;
  color: number;
  scale: number;
  rng: Rng;
}

interface Swarm {
  flyers: Flyer[];
  /** which flyer holds each perch, or -1 */
  busy: number[];
}

/** Wingspan in metres of the monarch; the other colourways scale from it. */
const WINGSPAN = 0.1;
/** The air the butterflies keep to: a torus over the bed and the lawn around it. */
const ROAM_MIN = 0.3;
const ROAM_MAX = 1.9;
const ROAM_Z_MIN = -2.3;
const ROAM_Z_MAX = 1.7;
/** Beyond this they are out of the picture; they come back in from just behind the hedges. */
const AWAY = 5.5;
const ENTRY = 3.6;

/** How high the open bloom reaches above the head origin, per species. */
const BLOOM_TOP = Object.fromEntries(
  SPECIES_LIST.map((s) => [
    s.id,
    Math.max(...s.flower.layers.map((l) => l.length * Math.cos(Math.min(l.open, 1.45)))),
  ]),
) as Record<SpeciesId, number>;

const UP = new THREE.Vector3(0, 1, 0);
const tmpDesired = new THREE.Vector3();
const tmpHeading = new THREE.Vector3();
const tmpCross = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpR2 = new THREE.Vector3();
const tmpU2 = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const MIN_SUN_Y = Math.sin(THREE.MathUtils.degToRad(3));
/** The hero bloom, then the two nearer hedges. */
const PERCHES = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

function makeSwarm(count: number, seed: string): Swarm {
  const rng = new Rng(`${seed}|garden`).fork("butterflies");
  const flyers: Flyer[] = [];
  for (let i = 0; i < count; i++) {
    const color = rng.int(0, COLORWAYS.length - 1);
    const f: Flyer = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      heading: new THREE.Vector3(0, 0, 1),
      mode: FLY,
      timer: 0,
      jitter: rng.range(0.2, 0.8),
      fold: 0,
      bank: 0,
      perch: -1,
      cruise: rng.range(0.4, 0.62),
      rate: rng.range(6.5, 9),
      phase: rng.next(),
      color,
      scale: (WINGSPAN / 2) * COLORWAYS[color].scale * rng.range(0.9, 1.1),
      rng: rng.fork(`fly${i}`),
    };
    pickTarget(f);
    f.pos.copy(f.target);
    pickTarget(f);
    f.heading.subVectors(f.target, f.pos).normalize();
    flyers.push(f);
  }
  return { flyers, busy: PERCHES.map(() => -1) };
}

/** Somewhere in the air over the bed, now and then a pass right over the hero. */
function pickTarget(f: Flyer) {
  const r = f.rng;
  const [cx, , cz] = LAYOUT.bed.center;
  if (r.next() < 0.3) {
    f.target.set(
      env.headPos.x + r.range(-0.3, 0.3),
      env.headPos.y + r.range(0.1, 0.55),
      env.headPos.z + r.range(-0.3, 0.3),
    );
  } else {
    const a = r.next() * Math.PI * 2;
    const rad = ROAM_MIN + Math.pow(r.next(), 0.7) * (ROAM_MAX - ROAM_MIN);
    f.target.set(cx + Math.cos(a) * rad, r.range(0.3, 1.35), cz + Math.sin(a) * rad * 0.85);
  }
  f.target.z = clamp(f.target.z, ROAM_Z_MIN, ROAM_Z_MAX);
}

/** A point far outside the picture, high enough to clear the hedges. */
function awayPoint(r: Rng, radius: number, out: THREE.Vector3) {
  const a = r.next() * Math.PI * 2;
  out.set(Math.cos(a) * radius, r.range(1.4, 2.6), Math.sin(a) * radius - 1);
}

function releasePerch(f: Flyer, busy: number[]) {
  if (f.perch >= 0) {
    busy[f.perch] = -1;
    f.perch = -1;
  }
}

/** Fly toward the target with a little erratic darting; returns the distance left. */
function steer(f: Flyer, dt: number, speed: number, dart: boolean): number {
  tmpDesired.subVectors(f.target, f.pos);
  const dist = tmpDesired.length();
  tmpDesired.multiplyScalar(speed / Math.max(dist, 1e-4));
  if (dart) {
    f.jitter -= dt;
    if (f.jitter <= 0) {
      f.jitter = f.rng.range(0.3, 0.9);
      f.vel.x += f.rng.range(-0.3, 0.3);
      f.vel.y += f.rng.range(-0.22, 0.28);
      f.vel.z += f.rng.range(-0.3, 0.3);
    }
  }
  f.vel.lerp(tmpDesired, Math.min(1, dt * 2.6));
  f.pos.addScaledVector(f.vel, dt);
  if (f.pos.y < 0.14) {
    f.pos.y = 0.14;
    f.vel.y = Math.abs(f.vel.y);
  }
  if (f.vel.lengthSq() > 1e-4) {
    tmpHeading.copy(f.vel).normalize();
    tmpCross.crossVectors(f.heading, tmpHeading);
    const bankGoal = clamp((tmpCross.y / Math.max(dt, 1e-3)) * 0.4, -0.7, 0.7);
    f.bank += (bankGoal - f.bank) * Math.min(1, dt * 4);
    f.heading.lerp(tmpHeading, Math.min(1, dt * 6)).normalize();
  }
  return dist;
}

function stepFlyer(f: Flyer, i: number, dt: number, active: number, swarm: Swarm, heroOpen: boolean) {
  const busy = swarm.busy;
  // Rain or dusk: leave the picture; a sudden change just takes them away.
  if (active < 0.15) {
    if (f.mode !== GONE) {
      releasePerch(f, busy);
      f.mode = GONE;
      f.timer = f.rng.range(0.2, 3);
    }
    return;
  }
  if (active < 0.5) {
    if (f.mode !== GONE && f.mode !== LEAVE) {
      releasePerch(f, busy);
      f.mode = LEAVE;
      awayPoint(f.rng, AWAY + 2, f.target);
    }
  } else if (f.mode === LEAVE) {
    f.mode = FLY;
    pickTarget(f);
  }

  switch (f.mode) {
    case GONE:
      f.timer -= dt;
      if (active >= 0.5 && f.timer <= 0) {
        awayPoint(f.rng, ENTRY, f.pos);
        f.vel.set(0, 0, 0);
        f.fold = 0;
        f.mode = FLY;
        pickTarget(f);
        f.heading.subVectors(f.target, f.pos).normalize();
      }
      return;
    case SIT:
      f.timer -= dt;
      f.fold += (1 - f.fold) * Math.min(1, dt * 3);
      f.bank += (0 - f.bank) * Math.min(1, dt * 4);
      // The hero perch moves as the plant sways; stay on it.
      if (f.perch >= 0) f.pos.copy(PERCHES[f.perch]);
      if (f.timer <= 0 || (f.perch === 0 && !heroOpen)) {
        releasePerch(f, busy);
        f.mode = FLY;
        f.vel.set(0, 0.3, 0);
        pickTarget(f);
      }
      return;
    case LAND: {
      if (f.perch >= 0) f.target.copy(PERCHES[f.perch]);
      const dist = steer(f, dt, Math.min(0.5, 0.1 + dist2(f) * 1.6), false);
      f.fold += (0.25 - f.fold) * Math.min(1, dt * 3);
      if (dist < 0.03 || (f.perch === 0 && !heroOpen)) {
        if (f.perch >= 0 && (f.perch !== 0 || heroOpen)) {
          f.pos.copy(PERCHES[f.perch]);
          f.vel.set(0, 0, 0);
          f.mode = SIT;
          f.timer = f.rng.range(2.5, 6);
        } else {
          releasePerch(f, busy);
          f.mode = FLY;
          pickTarget(f);
        }
      }
      return;
    }
    case LEAVE: {
      steer(f, dt, 1.3, true);
      f.fold += (0 - f.fold) * Math.min(1, dt * 4);
      if (f.pos.x * f.pos.x + f.pos.z * f.pos.z > AWAY * AWAY) {
        f.mode = GONE;
        f.timer = f.rng.range(0.2, 3);
      }
      return;
    }
    default: {
      // Coming in from outside the picture they cross the lawn briskly.
      const far = f.pos.x * f.pos.x + f.pos.z * f.pos.z > (ROAM_MAX + 0.4) * (ROAM_MAX + 0.4);
      const dist = steer(f, dt, far ? 1.0 : f.cruise, true);
      f.fold += (0 - f.fold) * Math.min(1, dt * 4);
      if (dist < 0.14) {
        // Now and then, settle on something for a moment.
        if (f.rng.next() < 0.3) {
          const want = f.rng.next() < 0.6 ? 0 : f.rng.int(1, PERCHES.length - 1);
          const ok = busy[want] < 0 && (want !== 0 || heroOpen);
          if (ok) {
            busy[want] = i;
            f.perch = want;
            f.mode = LAND;
            return;
          }
        }
        pickTarget(f);
      }
    }
  }
}

function dist2(f: Flyer): number {
  return f.pos.distanceTo(f.target);
}

/** The instance matrix: heading forward, banked into the turn, bobbing with the beat. */
function writeMatrix(f: Flyer, t: number, out: THREE.Matrix4) {
  tmpHeading.copy(f.heading);
  if (f.mode === SIT) tmpHeading.y = 0;
  if (tmpHeading.lengthSq() < 1e-6) tmpHeading.set(0, 0, 1);
  tmpHeading.normalize();
  tmpRight.crossVectors(UP, tmpHeading);
  if (tmpRight.lengthSq() < 1e-6) tmpRight.set(1, 0, 0);
  tmpRight.normalize();
  tmpUp.crossVectors(tmpHeading, tmpRight);
  const cb = Math.cos(f.bank);
  const sb = Math.sin(f.bank);
  tmpR2.copy(tmpRight).multiplyScalar(cb).addScaledVector(tmpUp, sb);
  tmpU2.copy(tmpUp).multiplyScalar(cb).addScaledVector(tmpRight, -sb);
  out.makeBasis(tmpR2, tmpU2, tmpHeading);
  const sc = f.mode === GONE ? 0 : f.scale;
  out.scale(tmpScale.set(sc, sc, sc));
  const bob = (1 - f.fold) * 0.012 * Math.sin(6.2832 * (t * f.rate + f.phase) - 1.2);
  out.setPosition(f.pos.x, f.pos.y + bob + f.scale * 0.1, f.pos.z);
}

function Butterflies({ count, seed, shadows }: { count: number; seed: string; shadows: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const swarm = useMemo(() => makeSwarm(count, seed), [count, seed]);
  useEffect(() => {
    // Dev-only handle for probing the flight from the console.
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __gardenButterflies?: Swarm };
    w.__gardenButterflies = swarm;
    return () => {
      if (w.__gardenButterflies === swarm) delete w.__gardenButterflies;
    };
  }, [swarm]);

  // The per-instance attributes read the swarm, so the atlas row and the
  // wingbeat match the flyer the CPU moves.
  const { geometry, foldAttr, foldArray } = useMemo(() => {
    const g = makeButterflyGeometry();
    const phase = new Float32Array(count);
    const rate = new Float32Array(count);
    const color = new Float32Array(count);
    const fold = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const f = swarm.flyers[i];
      color[i] = f.color;
      phase[i] = f.phase;
      rate[i] = f.rate;
    }
    const fa = new THREE.InstancedBufferAttribute(fold, 1);
    fa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute("aRate", new THREE.InstancedBufferAttribute(rate, 1));
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 1));
    g.setAttribute("aFold", fa);
    return { geometry: g, foldAttr: fa, foldArray: fold };
  }, [count, swarm]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const { material, depthMaterial, uniforms } = useMemo(() => {
    const tex = wingTexture();
    const u: WingUniforms = {
      uTime: { value: 0 },
      uMap: { value: tex },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uHemiSky: { value: new THREE.Color(0.5, 0.6, 0.8) },
      uHemiGround: { value: new THREE.Color(0.2, 0.25, 0.1) },
      uAmbient: { value: 0.2 },
      fogColor: { value: new THREE.Color(1, 1, 1) },
      fogNear: { value: 1 },
      fogFar: { value: 100 },
      fogDensity: { value: 0.00025 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: WING_VERTEX,
      fragmentShader: WING_FRAGMENT,
      side: THREE.DoubleSide,
      fog: true,
    });
    const d = new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uMap: u.uMap },
      vertexShader: WING_VERTEX,
      fragmentShader: WING_DEPTH_FRAGMENT,
      side: THREE.DoubleSide,
    });
    return { material: m, depthMaterial: d, uniforms: u };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      depthMaterial.dispose();
    },
    [material, depthMaterial],
  );

  /* eslint-disable react-hooks/immutability -- the memoised uniforms, attributes and
     flyers are three.js and plain objects the frame loop drives imperatively. */
  useLayerFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const s = garden.get();
    // The steering is stable up to the clock's own cap on a slow frame.
    const dt = Math.min(env.dt, 0.1);
    const t = env.time;
    const active = dayAir(env);
    // The hero perch rides the top of the bloom; the hedges' crowns are fixed.
    const top = lerp(SPECIES[s.speciesId].flower.budRadius * 1.6, BLOOM_TOP[s.speciesId], s.bloom);
    PERCHES[0].copy(env.headPos);
    PERCHES[0].y += top + 0.004;
    PERCHES[0].z += 0.03;
    for (let k = 1; k < PERCHES.length; k++) {
      const h = LAYOUT.hedges[k - 1];
      PERCHES[k].set(h.center[0], h.height + 0.01, h.center[2]);
    }
    const heroOpen = s.bloom > 0.45 && s.growth > 0.75;

    let any = false;
    const flyers = swarm.flyers;
    for (let i = 0; i < flyers.length; i++) {
      const f = flyers[i];
      stepFlyer(f, i, dt, active, swarm, heroOpen);
      if (f.mode !== GONE) any = true;
      writeMatrix(f, t, tmpMatrix);
      mesh.setMatrixAt(i, tmpMatrix);
      foldArray[i] = f.fold;
    }
    mesh.visible = any;
    mesh.instanceMatrix.needsUpdate = true;
    foldAttr.needsUpdate = true;

    uniforms.uTime.value = t;
    const dir = uniforms.uSunDir.value.copy(env.sun.dir);
    if (dir.y < MIN_SUN_Y) dir.setY(MIN_SUN_Y).normalize();
    const k = 1 / Math.PI;
    uniforms.uSunColor.value.copy(env.sky.sun).multiplyScalar(env.sky.sunIntensity * k);
    uniforms.uHemiSky.value.copy(env.sky.hemiSky).multiplyScalar(env.sky.hemiIntensity * k);
    uniforms.uHemiGround.value.copy(env.sky.hemiGround).multiplyScalar(env.sky.hemiIntensity * k);
    uniforms.uAmbient.value = lerp(0.9, 0.14, env.nightness) * 0.2;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      customDepthMaterial={depthMaterial}
      castShadow={shadows}
      frustumCulled={false}
    />
  );
}

const BUTTERFLIES: Record<Quality, number> = { cinematic: 10, balanced: 7, lite: 0 };

export function Atmosphere() {
  const quality = useTier();
  const seed = useGarden((s) => s.seed);
  const k = COUNT_SCALE[quality];
  const butterflies = BUTTERFLIES[quality];
  return (
    <>
      {FIELDS.map((spec) => (
        <ParticleField key={spec.seed} spec={spec} count={Math.max(1, Math.round(spec.count * k))} />
      ))}
      {butterflies > 0 && <Butterflies count={butterflies} seed={seed} shadows={quality === "cinematic"} />}
    </>
  );
}
