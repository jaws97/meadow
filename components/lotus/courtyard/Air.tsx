"use client";
/* eslint-disable react-hooks/immutability --
   The fields' uniforms and the dragonflies' transforms are three.js objects written in the frame loop. */
// The courtyard's air, its own (the flower garden's has butterflies and pollen; here the koi are the living things,
// with dragonflies by day and fireflies at dusk):
//   mist       morning mist lying low over the tank and drifting up the steps before dawn, a breath of it at dusk and
//              at night: a few still sheets hugging the water and soft billows above it
//   fireflies  dusk and night: soft yellow-green glows wandering slow loops round the jasmine, the banana, over the
//              water and along the terraces, each blinking on its own unhurried rhythm
//   rain       thin streaks over the court when it rains (the water draws its own rings)
//   dragonflies by day: two, one hawking over the water from hover to hover, one resting on a lamp's finial and the
//              brass pot's lip between short flights
// Everything moves on the garden clock (env.time), so ?still=1 (the clock held at 37 s) holds the mist, the glows,
// the rain and the dragonflies where they are composed to be.
import { useLayerFrame } from "@/components/garden/TierLayers";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { Rng, smoothstep } from "@/lib/plant/prng";
import type { Tier } from "@/components/lotus/geometry";
import { POND } from "@/components/lotus/pond";
import { BANANA, COURT, JASMINE, KODAM, LAMP_H, LAMPS, LEVEL, TANK } from "@/components/lotus/courtyard/plan";
import { dragonflyBodyMaterial, wingMaterial } from "@/components/lotus/courtyard/materials";
import { KOI_STILL_TIME } from "@/components/lotus/koi";

export const COURT_AIR_NAME = "courtyard-air";

// ---------------------------------------------------------------------------------------------------------------------
// Billboard fields: one instanced quad each, faced to the camera in the vertex shader

const FIELD_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aP;
uniform float uTime;
uniform float uFall;
uniform vec3 uBox0;
uniform vec3 uBox1;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vDepth;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vUv = position.xy + 0.5;
  vSeed = aP.y;
  vAlpha = aP.z;
  float size = aP.x;
  vec3 c = aPos;
#if MODE == 0
  // mist: a slow drift and swell
  c += vec3(sin(uTime * 0.045 + aP.y * 6.0) * 0.09, sin(uTime * 0.06 + aP.y * 3.0) * 0.02, cos(uTime * 0.038 + aP.y * 5.0) * 0.06);
  size *= 1.0 + 0.12 * sin(uTime * 0.08 + aP.y * 9.0);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * vec2(size * aP.w, size);
#elif MODE == 1
  // a firefly: a lazy loop round its home, up and down a little
  float t = uTime * (0.16 + 0.1 * h1(aP.y * 7.1)) + aP.y * 40.0;
  c += vec3(sin(t) * 0.16 + sin(t * 2.3) * 0.05, sin(t * 0.7 + 1.0) * 0.08, cos(t * 0.9) * 0.14) * aP.w;
  // blink: on for a third of a 2.5-4.5 s cycle, rising and falling softly
  float period = 2.5 + 2.0 * h1(aP.y * 3.3);
  float ph = fract(uTime / period + h1(aP.y * 11.7));
  vAlpha = aP.z * smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.18, 0.36, ph));
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
#else
  // rain: falls through its box, wraps, and stands as a streak turned to the camera about the vertical
  vec3 span = uBox1 - uBox0;
  c.y = uBox0.y + mod(aPos.y - uTime * uFall - aP.y * span.y, span.y);
  vec3 toCam = normalize(cameraPosition - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 w = c + right * position.x * size * 0.035 + vec3(0.0, position.y * size * 1.8, 0.0);
  vec4 mv = viewMatrix * modelMatrix * vec4(w, 1.0);
  // fainter near the lens, where the depth of field would spread a drop into a broad bar
  vAlpha = aP.z * smoothstep(uBox0.y, uBox0.y + 0.15, c.y) * smoothstep(0.9, 2.6, -mv.z);
#endif
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
#if MODE == 0
  float base = pow(clamp(1.0 - r, 0.0, 1.0), 1.6);
  float n = fbm(vUv * 2.2 + vSeed * 13.0 + vec2(uTime * 0.012, -uTime * 0.008));
  float a = uOpacity * vAlpha * base * smoothstep(0.25, 0.75, n + 0.15) * smoothstep(0.35, 1.1, vDepth);
  gl_FragColor = vec4(uColor, a);
#elif MODE == 1
  float core = exp(-r * r * 60.0);
  float halo = exp(-r * r * 6.0) * 0.32;
  float a = uOpacity * vAlpha * (core + halo);
  gl_FragColor = vec4(uColor, a);
#else
  float a = uOpacity * vAlpha * (1.0 - smoothstep(0.0, 1.0, abs(d.x) * 2.0)) * (1.0 - abs(d.y) * 2.0);
  gl_FragColor = vec4(uColor, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type FieldUniforms = {
  uTime: { value: number };
  uOpacity: { value: number };
  uColor: { value: THREE.Color };
  uFall: { value: number };
  uBox0: { value: THREE.Vector3 };
  uBox1: { value: THREE.Vector3 };
};

interface FieldSpec {
  mode: 0 | 1 | 2;
  /** per instance: position, and size, seed, alpha, an extra (mist: aspect; fireflies: wander scale) */
  points: { p: THREE.Vector3; size: number; alpha: number; extra: number }[];
  blending: THREE.Blending;
  box?: [THREE.Vector3, THREE.Vector3];
}

function useField(spec: FieldSpec) {
  const { mesh, uniforms } = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    const n = spec.points.length;
    const pos = new Float32Array(n * 3);
    const par = new Float32Array(n * 4);
    spec.points.forEach((pt, i) => {
      pos.set([pt.p.x, pt.p.y, pt.p.z], i * 3);
      par.set([pt.size, (i * 0.618034) % 1, pt.alpha, pt.extra], i * 4);
    });
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute("aP", new THREE.InstancedBufferAttribute(par, 4));
    g.instanceCount = n;
    const u: FieldUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFall: { value: 6.5 },
      uBox0: { value: spec.box ? spec.box[0].clone() : new THREE.Vector3() },
      uBox1: { value: spec.box ? spec.box[1].clone() : new THREE.Vector3(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      defines: { MODE: spec.mode },
      transparent: true,
      depthWrite: false,
      blending: spec.blending,
      fog: false,
    });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = spec.mode === 0 ? 8 : 9;
    return { mesh: m, uniforms: u };
  }, [spec]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------------
// Where the mist, the fireflies and the rain are

function mistPoints(tier: Tier): FieldSpec["points"] {
  const rng = new Rng(31);
  const out: FieldSpec["points"] = [];
  const k = tier === "lite" ? 0.5 : tier === "balanced" ? 0.75 : 1;
  // sheets lying on the water: wide, flat (seen edge-on they read as a low band), just over the surface
  for (let i = 0; i < Math.round(26 * k); i++) {
    const x = TANK.x0 + 0.12 + rng.next() * (TANK.x1 - TANK.x0 - 0.24);
    const z = TANK.zBack + 0.08 + rng.next() * (TANK.zFront - TANK.zBack - 0.16);
    out.push({ p: new THREE.Vector3(x, POND.waterY + 0.05 + rng.next() * 0.06, z), size: 0.16 + rng.next() * 0.12, alpha: 0.55 + 0.4 * rng.next(), extra: 2.6 + rng.next() * 1.4 });
  }
  // billows rising over the tank and the back steps, thinning upward
  for (let i = 0; i < Math.round(22 * k); i++) {
    const x = TANK.x0 - 0.1 + rng.next() * (TANK.x1 - TANK.x0 + 0.2);
    const z = TANK.zBack - 0.35 + rng.next() * (TANK.zFront - TANK.zBack + 0.25);
    const y = POND.waterY + 0.16 + rng.next() * 0.42;
    out.push({ p: new THREE.Vector3(x, y, z), size: 0.42 + rng.next() * 0.42, alpha: (0.28 + 0.3 * rng.next()) * (1 - 0.5 * smoothstep(0.2, 0.6, y - POND.waterY)), extra: 1.5 + rng.next() * 0.5 });
  }
  // a thinner breath across the terraces toward the walls
  for (let i = 0; i < Math.round(12 * k); i++) {
    const x = (rng.next() - 0.5) * 3.6;
    const z = COURT.zBack + 0.3 + rng.next() * 1.4;
    out.push({ p: new THREE.Vector3(x, LEVEL.terrace + 0.15 + rng.next() * 0.4, z), size: 0.7 + rng.next() * 0.5, alpha: 0.18 + 0.15 * rng.next(), extra: 1.8 });
  }
  return out;
}

function fireflyPoints(tier: Tier): FieldSpec["points"] {
  const rng = new Rng(77);
  const n = tier === "lite" ? 16 : tier === "balanced" ? 28 : 40;
  const homes = [
    // the jasmine
    { c: new THREE.Vector3(JASMINE.x, LEVEL.terrace + 0.7, COURT.zBack + 0.35), r: new THREE.Vector3(0.55, 0.45, 0.25), w: 0.4 },
    // the banana's corner
    { c: new THREE.Vector3(BANANA.x + 0.2, LEVEL.terrace + 1.1, BANANA.z + 0.2), r: new THREE.Vector3(0.6, 0.7, 0.45), w: 0.5 },
    // low over the water
    { c: new THREE.Vector3(POND.cx, POND.waterY + 0.28, POND.cz - 0.1), r: new THREE.Vector3(0.55, 0.16, 0.35), w: 0.3 },
    // along the terraces and the steps
    { c: new THREE.Vector3(-1.5, LEVEL.terrace + 0.5, 0.2), r: new THREE.Vector3(0.6, 0.35, 1.2), w: 0.6 },
    { c: new THREE.Vector3(1.55, LEVEL.terrace + 0.6, -0.3), r: new THREE.Vector3(0.6, 0.4, 1.0), w: 0.6 },
  ];
  const share = [0.24, 0.24, 0.2, 0.16, 0.16];
  const out: FieldSpec["points"] = [];
  for (let i = 0; i < n; i++) {
    let x = rng.next();
    let h = 0;
    while (h < homes.length - 1 && x > share[h]) {
      x -= share[h];
      h++;
    }
    const home = homes[h];
    const p = new THREE.Vector3((rng.next() - 0.5) * 2, (rng.next() - 0.5) * 2, (rng.next() - 0.5) * 2).multiply(home.r).add(home.c);
    out.push({ p, size: 0.07 + 0.03 * rng.next(), alpha: 0.75 + 0.25 * rng.next(), extra: home.w });
  }
  return out;
}

const RAIN_BOX: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(COURT.xMin, 0.1, COURT.zBack), new THREE.Vector3(COURT.xMax, 3.4, 2.6)];

function rainPoints(tier: Tier): FieldSpec["points"] {
  const rng = new Rng(5);
  const n = tier === "lite" ? 500 : tier === "balanced" ? 1000 : 1600;
  const out: FieldSpec["points"] = [];
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(
      RAIN_BOX[0].x + rng.next() * (RAIN_BOX[1].x - RAIN_BOX[0].x),
      rng.next() * (RAIN_BOX[1].y - RAIN_BOX[0].y),
      RAIN_BOX[0].z + rng.next() * (RAIN_BOX[1].z - RAIN_BOX[0].z),
    );
    out.push({ p, size: 0.07 + 0.05 * rng.next(), alpha: 0.25 + 0.3 * rng.next(), extra: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dragonflies

interface Stop {
  /** where it is: hovering in the air or resting */
  at: THREE.Vector3;
  rest: boolean;
  /** how long it stays, s */
  stay: number;
  /** its heading while there (radians about y) */
  yaw: number;
}

/** A quick flight between two stops, s. */
const FLIGHT = 0.9;

/** The two dragonflies' rounds: stops joined by quick flights. Each round is phased so the still time (37 s) finds the
 *  red one hovering low over the open water at the front left and the blue one resting on the front coping. */
function rounds(): { colour: string; eye: string; stops: Stop[]; still: number }[] {
  const tall = LAMPS[1];
  const finial = new THREE.Vector3(tall.x, tall.y + LAMP_H.tall * (0.53 / 0.42) + 0.004, tall.z);
  const kodamLip = new THREE.Vector3(KODAM.x + 0.07, KODAM.y + 0.305, KODAM.z + 0.04);
  const W = POND.waterY;
  const front = TANK.zFront + 0.06;
  return [
    {
      colour: "#a8301f",
      eye: "#6e2216",
      still: 4,
      stops: [
        { at: new THREE.Vector3(-0.38, W + 0.2, -0.32), rest: false, stay: 3.2, yaw: 0.9 },
        { at: new THREE.Vector3(0.1, W + 0.32, -0.62), rest: false, stay: 2.4, yaw: 2.2 },
        { at: new THREE.Vector3(0.42, W + 0.18, -0.3), rest: false, stay: 2.8, yaw: -2.6 },
        { at: new THREE.Vector3(-0.1, W + 0.26, -0.15), rest: false, stay: 2.2, yaw: 1.4 },
        { at: new THREE.Vector3(-0.3, W + 0.14, -0.02), rest: false, stay: 3.6, yaw: 0.7 },
      ],
    },
    {
      colour: "#6f93b0",
      eye: "#3e5a70",
      still: 0,
      stops: [
        { at: new THREE.Vector3(0.22, LEVEL.coping + 0.002, front), rest: true, stay: 9.0, yaw: -1.2 },
        { at: new THREE.Vector3(0.3, W + 0.4, -0.4), rest: false, stay: 2.0, yaw: 2.6 },
        { at: finial, rest: true, stay: 7.0, yaw: -0.4 },
        { at: new THREE.Vector3(-0.2, W + 0.35, -0.6), rest: false, stay: 2.2, yaw: -1.0 },
        { at: kodamLip, rest: true, stay: 6.0, yaw: 0.8 },
        { at: new THREE.Vector3(0.1, W + 0.3, -0.2), rest: false, stay: 1.6, yaw: 1.8 },
      ],
    },
  ];
}

/** The phase that puts the still time in the middle of stop `k`'s stay. */
function stillPhase(stops: Stop[], k: number): number {
  let at = 0;
  for (let i = 0; i < k; i++) at += stops[i].stay + FLIGHT;
  return at + stops[k].stay / 2 - KOI_STILL_TIME;
}

/** Where a dragonfly is at time t on its round: position, heading, and whether it rests. */
function sampleRound(stops: Stop[], phase: number, t: number, out: THREE.Vector3): { yaw: number; rest: boolean; flying: number } {
  const total = stops.reduce((a, s) => a + s.stay + FLIGHT, 0);
  let tt = (((t + phase) % total) + total) % total;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (tt < s.stay) {
      // hovering drifts a little; resting holds still
      out.copy(s.at);
      if (!s.rest) out.add(new THREE.Vector3(Math.sin(t * 1.7 + i) * 0.012, Math.sin(t * 2.3 + i * 2) * 0.008, Math.cos(t * 1.3 + i) * 0.012));
      return { yaw: s.yaw, rest: s.rest, flying: 0 };
    }
    tt -= s.stay;
    if (tt < FLIGHT) {
      const n = stops[(i + 1) % stops.length];
      const k = smoothstep(0, 1, tt / FLIGHT);
      out.lerpVectors(s.at, n.at, k);
      out.y += Math.sin(Math.PI * k) * 0.06;
      const yaw = Math.atan2(n.at.x - s.at.x, n.at.z - s.at.z);
      return { yaw, rest: false, flying: 1 };
    }
    tt -= FLIGHT;
  }
  out.copy(stops[0].at);
  return { yaw: stops[0].yaw, rest: stops[0].rest, flying: 0 };
}

/** A dragonfly's thorax and long, slender abdomen, +z forward, about 5 cm long (the head is its own mesh). */
function makeDragonflyBody(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [
    [0.0, -0.038],
    [0.0009, -0.0372],
    [0.0012, -0.034],
    [0.001, -0.026],
    [0.0011, -0.016],
    [0.0012, -0.008],
    [0.0016, -0.004],
    [0.0024, -0.001],
    [0.0031, 0.002],
    [0.0033, 0.0055],
    [0.0028, 0.009],
    [0.0018, 0.0105],
    [0.0, 0.011],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 8);
  // the lathe runs along y: lay it along +z (head forward)
  g.rotateX(Math.PI / 2);
  return g;
}

/** The head: broad and rounded, nearly all eye (a darker shade of the body's colour, no features). */
function makeDragonflyHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.0026, 10, 8);
  g.scale(1.45, 0.95, 0.9);
  g.translate(0, 0.0004, 0.0128);
  return g;
}

/** One side's two wings (fore and hind), each a slim netted blade; uv.x along the wing (for the net). */
function makeWings(s: -1 | 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const blade = (side: number, root: number, len: number, width: number, sweep: number) => {
    const start = pos.length / 3;
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const w = width * Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88)) * (1 - 0.25 * u);
      const x = side * (0.002 + len * u);
      const z = root + sweep * u;
      pos.push(x, 0, z + w * 0.35, x, 0, z - w * 0.65);
      uv.push(u, 0, u, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  blade(s, 0.008, 0.031, 0.0085, -0.004);
  blade(s, 0.002, 0.029, 0.0105, -0.007);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Dragonflies() {
  const geo = useMemo(() => ({ body: makeDragonflyBody(), head: makeDragonflyHead(), left: makeWings(-1), right: makeWings(1) }), []);
  useEffect(
    () => () => {
      geo.body.dispose();
      geo.head.dispose();
      geo.left.dispose();
      geo.right.dispose();
    },
    [geo],
  );
  const flies = useMemo(() => rounds(), []);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  useLayerFrame(() => {
    // out by day only: the sun a few degrees up, and not in the rain
    const day = env.sun.altitude > THREE.MathUtils.degToRad(4) && env.rain < 0.3;
    const t = env.time;
    flies.forEach((f, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.visible = day;
      if (!day) return;
      const s = sampleRound(f.stops, stillPhase(f.stops, f.still), t, scratch);
      g.position.copy(scratch);
      g.rotation.set(s.rest ? 0.05 : -0.08 + 0.06 * Math.sin(t * 3 + i), s.yaw, 0);
      // at rest the wings lie flat out to the sides, a touch down; in flight they beat (a still frame catches them
      // part-way, as a fast shutter would)
      const flap = s.rest ? -0.06 : 0.55 * Math.sin(t * 2 * Math.PI * 9 + i * 1.3);
      const l = wingRefs.current[i * 2];
      const r = wingRefs.current[i * 2 + 1];
      if (l) l.rotation.z = -flap;
      if (r) r.rotation.z = flap;
    });
  });

  return (
    <group name="dragonflies">
      {flies.map((f, i) => (
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
          visible={false}
        >
          <mesh geometry={geo.body} material={dragonflyBodyMaterial(f.colour)} castShadow />
          <mesh geometry={geo.head} material={dragonflyBodyMaterial(f.eye)} />
          {[geo.left, geo.right].map((w, k) => (
            <mesh
              key={k}
              ref={(m) => {
                wingRefs.current[i * 2 + k] = m;
              }}
              geometry={w}
              material={wingMaterial()}
              position-y={0.0035}
              position-z={0.002}
              renderOrder={5}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The air

/** Mist's density by the hour: thick before dawn, a breath at dusk and at night, none by day; less in the rain. */
function mistDensity(hour: number, nightness: number, rain: number): number {
  const dawn = smoothstep(4.2, 5.4, hour) * (1 - smoothstep(6.5, 7.6, hour));
  const evening = smoothstep(17.9, 18.8, hour) * 0.32;
  const night = nightness * 0.28;
  return Math.max(dawn, evening, night) * (1 - 0.6 * rain);
}

const MIST_DAWN = new THREE.Color(0.8, 0.86, 0.96);
const MIST_NIGHT = new THREE.Color(0.06, 0.075, 0.11);
const FIREFLY = new THREE.Color(1.5, 1.9, 0.55);
const RAIN = new THREE.Color(0.8, 0.84, 0.9);

export function CourtyardAir({ tier }: { tier: Tier }) {
  const mistSpec = useMemo<FieldSpec>(() => ({ mode: 0, points: mistPoints(tier), blending: THREE.NormalBlending }), [tier]);
  const flySpec = useMemo<FieldSpec>(() => ({ mode: 1, points: fireflyPoints(tier), blending: THREE.AdditiveBlending }), [tier]);
  const rainSpec = useMemo<FieldSpec>(() => ({ mode: 2, points: rainPoints(tier), blending: THREE.NormalBlending, box: RAIN_BOX }), [tier]);
  const mist = useField(mistSpec);
  const flies = useField(flySpec);
  const rain = useField(rainSpec);
  const mistColour = useMemo(() => new THREE.Color(), []);

  useLayerFrame(() => {
    const t = env.time;
    // the mist takes the sky's light: pale and cool before dawn, blue-grey at night, warmed by the lamps a little
    const m = mist.uniforms;
    m.uTime.value = t;
    const dens = mistDensity(env.hour, env.nightness, env.rain);
    m.uOpacity.value = 0.42 * dens;
    mist.mesh.visible = dens > 0.01;
    // its colour: the sky's, cooled and paled (mist scatters every colour of the light about evenly), as bright as
    // the hour allows: luminous in the first light, a dim blue-grey breath at night
    const level = 0.07 + 0.55 * (1 - env.nightness);
    mistColour.copy(env.sky.horizon).lerp(env.sky.zenith, 0.5).lerp(MIST_DAWN, 0.6);
    const lum = mistColour.r * 0.2126 + mistColour.g * 0.7152 + mistColour.b * 0.0722;
    mistColour.multiplyScalar(level / Math.max(0.02, lum)).lerp(MIST_NIGHT, env.nightness * env.nightness * 0.5);
    m.uColor.value.copy(mistColour);
    // fireflies: from dusk through the night (not before dawn: the mist's hour)
    const f = flies.uniforms;
    f.uTime.value = t;
    const evening = env.hour >= 12 ? smoothstep(0.25, 0.6, env.nightness) : 0;
    f.uOpacity.value = evening * (1 - 0.8 * env.rain);
    f.uColor.value.copy(FIREFLY);
    flies.mesh.visible = f.uOpacity.value > 0.01;
    // rain
    const r = rain.uniforms;
    r.uTime.value = t;
    r.uOpacity.value = Math.min(1, env.rain * 1.2) * (0.34 + 0.3 * (1 - env.nightness));
    r.uColor.value.copy(RAIN).multiply(env.sky.horizon).multiplyScalar(1.3).addScalar(0.05);
    rain.mesh.visible = env.rain > 0.02;
  });

  return (
    <group name={COURT_AIR_NAME}>
      <primitive object={mist.mesh} />
      <primitive object={flies.mesh} />
      <primitive object={rain.mesh} />
      <Dragonflies />
    </group>
  );
}
