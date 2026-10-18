"use client";
/* eslint-disable react-hooks/immutability --
   The water's uniforms, the lamps' glow uniform and the instanced meshes are three.js objects written in layout
   effects and the frame loop, which is how an R3F part animates without re-rendering; the React Compiler lint reads
   those writes as mutating a hook's value. Nothing they write feeds back into what React renders. */
// The lazy river itself (Option A, plan.ts): the water (water.ts), the granite copings in blocks overhanging the water
// a little, the stone walls with their damp band, the four flat granite slab bridges (three slabs on two piers with
// pointed cutwaters upstream, parapets flaring to the mouths, an end post at each parapet end carrying a 2.2 m lamp
// post), the 56 pockets' sill stones, the stones and reed clumps at the bridge mouths and between the pockets, and by
// night a soft streak on the water under each lamp. Every repeated part is one merged or instanced mesh: water,
// walls, copings, bridges, lamps, sills, stones, reeds, streaks and the lamps' pools, ten draw calls (plus shadows).
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { liveGlowMaterial, seeded } from "@/components/meadow/parts";
import { meadow } from "@/components/meadow/runtime";
import { env } from "@/lib/garden/env";
import { marginMaterial, marginUniforms } from "@/components/lotus/materials";
import { BRIDGE, LEVEL, POCKET, pocketOutline, polar, type Bridge, type RiverPlan } from "@/components/lotus/river/plan";
import { bevelPrism, copingGeometry, lampGeometry, mergeAll, prism, reedClumpGeometry, rockGeometry, Tris, wallGeometry } from "@/components/lotus/river/riverGeometry";
import { MAX_OBSTACLES, riverWaterMaterial, waterUniforms } from "@/components/lotus/river/water";
import { poolTexture } from "@/components/lotus/river/RiverGrounds";
import type { P2 } from "@/components/meadow/layout";

const TAU = Math.PI * 2;
/** The walls' face runs from just under the coping down below the waterline (the water is opaque). */
const WALL_TOP = LEVEL.copingBase + 0.005;
const WALL_BOTTOM = -0.62;
/** Parapet end posts and their caps. */
const POST = { half: 0.21, top: 0.6, cap: 0.06, capHalf: 0.24 } as const;
/** Lamp foot (the end post's cap) and how tall the lamp stands from the paving. */
const LAMP_FOOT = POST.top + POST.cap;
/** The follow camera's elevation (CameraRig PHI), for where a lamp's reflection lies on the water. */
const FOLLOW_ELEVATION = Math.PI / 2 - 0.28 * Math.PI;
/** The Meadow camera's fixed bearing (CameraRig THETA): from a point toward the camera on the ground. */
const TOWARD_CAMERA = { x: Math.SQRT1_2, z: Math.SQRT1_2 };

/**
 * Light thrown back onto the stonework's upright faces by the sunlit paving and water round it. The Meadow's lights
 * are a sun and a sky (hemisphere) only, so an upright face in shade gets the sky's blue and nothing else and reads as
 * slate; real stone beside a sunlit pavement is lit warm from below and the side. Faded out by night.
 */
const bounceUniforms = { uBounce: { value: new THREE.Color(0, 0, 0) } };
const BOUNCE = new THREE.Color(1, 0.86, 0.68);
function withBounce<T extends THREE.MeshStandardMaterial>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, bounceUniforms);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uBounce;").replace(
      "#include <lights_fragment_end>",
      "#include <lights_fragment_end>\n{ vec3 bN = inverseTransformDirection(normal, viewMatrix);\n" +
        "  reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * (1.0 - 0.8 * clamp(bN.y, 0.0, 1.0)); }",
    );
  };
  m.customProgramCacheKey = () => "lotus-river-bounce-" + key;
  return m;
}

/** A line break for the shader patches. */
const NL = String.fromCharCode(10);

/**
 * The waterline on the stone that stands in the river (the piers, the cutwaters, the ledge and sill stones): darker and
 * glossier for a hand's width over the water, where the ripples keep it wet, and filmed green right at the line, so
 * a pier or a stone meets the water instead of resting on it. Chains any onBeforeCompile already set.
 */
function withWetBand<T extends THREE.MeshStandardMaterial>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>" + NL + "varying float vWetY;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>" + NL + "{ vec4 wp = vec4(transformed, 1.0);" + NL + "#ifdef USE_INSTANCING" + NL + " wp = instanceMatrix * wp;" + NL + "#endif" + NL + " vWetY = (modelMatrix * wp).y; }",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>" + NL + "varying float vWetY;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>" + NL +
          "float wetH = vWetY - (" + LEVEL.water.toFixed(3) + ");" + NL +
          "float wetK = 1.0 - smoothstep(0.0, 0.08, wetH);" + NL +
          "diffuseColor.rgb *= 1.0 - 0.42 * wetK;" + NL +
          "diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 1.0, 0.72), 0.6 * (1.0 - smoothstep(0.0, 0.025, wetH)));",
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>" + NL + "roughnessFactor *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.08, vWetY - (" + LEVEL.water.toFixed(3) + ")));");
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|wet-" + key;
  return m;
}

/**
 * Dressed grey granite for the copings and the bridges: a warm silver-grey ground of fine grains, salt and pepper
 * (dark mica, white feldspar and quartz, a few warm grains), with only a faint drift of tone across a block, so a
 * slab reads as stone close to and as an even warm grey from the party screen, not as blotchy concrete. Tileable.
 */
function graniteTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const rnd = seeded(4711);
  // a soft, tileable drift of tone: a few whole-number waves across the tile
  const waves = Array.from({ length: 6 }, () => ({ kx: 1 + Math.floor(rnd() * 3), ky: 1 + Math.floor(rnd() * 3), ph: rnd() * TAU, a: 0.004 + rnd() * 0.004 }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * TAU, v = (y / N) * TAU;
      let drift = 1;
      for (const w of waves) drift += w.a * Math.sin(w.kx * u + w.ky * v + w.ph);
      const g = 0.94 + rnd() * 0.12;
      let r = 196 * g * drift, gg = 189 * g * drift, b = 177 * g * drift;
      const k = rnd();
      if (k < 0.07) {
        const t = 0.25 + rnd() * 0.3;
        r *= t;
        gg *= t;
        b *= t * 1.02;
      } else if (k < 0.15) {
        r = Math.min(255, r * 1.16 + 10);
        gg = Math.min(255, gg * 1.16 + 10);
        b = Math.min(255, b * 1.16 + 12);
      } else if (k < 0.18) {
        r *= 1.04;
        gg *= 0.9;
        b *= 0.84;
      }
      const i = (y * N + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The stone walls: dressed granite courses, joints, a damp band 5 cm over the waterline and a dark, weedy foot. */
function wallTexture(): THREE.CanvasTexture {
  const W = 512, H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const rnd = seeded(77);
  // v = 0 at WALL_BOTTOM, 1 at WALL_TOP (the canvas's top row is v = 1)
  const yOf = (y: number) => H * (1 - (y - WALL_BOTTOM) / (WALL_TOP - WALL_BOTTOM));
  ctx.fillStyle = "#a69c88";
  ctx.fillRect(0, 0, W, H);
  const courses = [WALL_TOP, -0.25, -0.44, WALL_BOTTOM];
  for (let k = 0; k < courses.length - 1; k++) {
    const y0 = yOf(courses[k]), y1 = yOf(courses[k + 1]);
    let x = -rnd() * 80 - (k % 2) * 60;
    while (x < W) {
      const w = 110 + rnd() * 120;
      const tone = 0.9 + rnd() * 0.18;
      const base = [214, 202, 180].map((v) => Math.round(Math.min(255, v * tone)));
      for (const ox of [0, -W, W]) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, `rgb(${base.map((v) => v + 8).join(",")})`);
        g.addColorStop(1, `rgb(${base.map((v) => v - 14).join(",")})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox + 2, y0 + 2, w - 4, y1 - y0 - 4);
      }
      x += w;
    }
  }
  // granite speckle
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(40,36,30,0.12)";
    ctx.fillRect(rnd() * W, rnd() * H, 1.3, 1.3);
  }
  // the damp band over the waterline, darkest at the water, and the weedy foot under it
  const wl = yOf(LEVEL.water);
  const damp = ctx.createLinearGradient(0, yOf(LEVEL.water + 0.07), 0, wl);
  damp.addColorStop(0, "rgba(40,44,32,0)");
  damp.addColorStop(1, "rgba(52,54,38,0.5)");
  ctx.fillStyle = damp;
  ctx.fillRect(0, yOf(LEVEL.water + 0.07), W, wl - yOf(LEVEL.water + 0.07));
  ctx.fillStyle = "rgba(36,48,30,0.7)";
  ctx.fillRect(0, wl, W, H - wl);
  // a few weeping stains under the copings' joints
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, len = 20 + rnd() * 60;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, "rgba(60,58,48,0.25)");
    g.addColorStop(1, "rgba(60,58,48,0)");
    ctx.fillStyle = g;
    for (const ox of [0, -W, W]) ctx.fillRect(x + ox, 0, 3 + rnd() * 6, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The parapets' inner face at u: half the width between them (piecewise linear between the plan's breakpoints). */
function faceAt(b: Bridge, u: number): number {
  const f = b.face;
  if (u <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) {
    if (u <= f[i][0]) {
      const t = (u - f[i - 1][0]) / (f[i][0] - f[i - 1][0]);
      return f[i - 1][1] + (f[i][1] - f[i - 1][1]) * t;
    }
  }
  return f[f.length - 1][1];
}

const pt3 = (p: P2, y: number): [number, number, number] => [p.x, y, p.z];

/** The plan point at (u along the bridge's diagonal, v across it). */
function bw(b: Bridge, u: number, v: number): P2 {
  const ux = Math.cos(b.a), uz = Math.sin(b.a);
  return { x: ux * u - uz * v, z: uz * u + ux * v };
}

/** A band of the bridge between u0 and u1, from v = inner(u) to v = outer(u) on side s (+1 or -1), as a plan polygon. */
function band(b: Bridge, u0: number, u1: number, inner: (u: number) => number, outer: (u: number) => number, s: number): P2[] {
  const us = [u0, ...b.face.map(([u]) => u).filter((u) => u > u0 + 1e-4 && u < u1 - 1e-4), u1];
  return [...us.map((u) => bw(b, u, s * inner(u))), ...us.slice().reverse().map((u) => bw(b, u, s * outer(u)))];
}

/** One bridge, merged: its five slabs, both parapets with their caps, four end posts with caps, and two piers. */
function bridgeTris(b: Bridge, P: RiverPlan, out: Tris, rnd: () => number) {
  const { c0, wIn, wOut, c1 } = P.river;
  const B = BRIDGE;
  const tone = () => {
    const t = 0.82 + rnd() * 0.16;
    return new THREE.Color(t, t * 0.985, t * 0.965);
  };
  const outerV = (u: number) => faceAt(b, u) + B.parT;
  // the slabs: an abutment slab over each coping, three spans over the water meeting on the piers; 8 mm joints
  const cuts = [c0, wIn, b.piers[0], b.piers[1], wOut, c1];
  for (let i = 0; i < cuts.length - 1; i++) {
    const u0 = cuts[i] + (i === 0 ? 0 : 0.008), u1 = cuts[i + 1] - (i === cuts.length - 2 ? 0 : 0.008);
    const over = i === 0 || i === cuts.length - 2;
    const poly = band(b, u0, u1, (u) => -outerV(u), outerV, 1);
    bevelPrism(poly, over ? LEVEL.copingBase : LEVEL.soffit, LEVEL.deck, 0.018, 1.6, tone(), out);
  }
  // open parapets (a solid wall read as a heavy slab): a low kerb along the deck's edge, square granite posts about
  // 0.8 m apart and a slim granite rail on them, so the water shows through under the rail
  const pu0 = c0 + 0.12 + POST.half, pu1 = c1 - 0.12 - POST.half;
  const railIn = (u: number) => faceAt(b, u) + 0.07;
  const railOut = (u: number) => outerV(u) - 0.07;
  for (const s of [1, -1]) {
    prism(band(b, pu0, pu1, (u) => faceAt(b, u) + 0.03, (u) => outerV(u) - 0.03, s), LEVEL.deck, LEVEL.deck + 0.1, 1.2, tone(), out);
    bevelPrism(band(b, pu0, pu1, railIn, railOut, s), LEVEL.parapet - 0.075, LEVEL.parapet, 0.01, 1.2, tone(), out);
    const n = Math.max(2, Math.round((pu1 - pu0) / 0.8));
    for (let k = 1; k < n; k++) {
      const u = pu0 + ((pu1 - pu0) * k) / n;
      const v = s * (faceAt(b, u) + B.parT / 2);
      const h = 0.065;
      prism([bw(b, u - h, v - h), bw(b, u + h, v - h), bw(b, u + h, v + h), bw(b, u - h, v + h)], LEVEL.deck + 0.1, LEVEL.parapet - 0.075, 1.2, tone(), out);
    }
  }
  // end posts at each parapet end (the lamps stand on them)
  for (const u of [c0 + 0.12, c1 - 0.12]) {
    for (const s of [1, -1]) {
      const v = s * (B.mouthHalf + B.parT / 2);
      const sq = (h: number) => [bw(b, u - h, v - h), bw(b, u + h, v - h), bw(b, u + h, v + h), bw(b, u - h, v + h)];
      prism(sq(POST.half), LEVEL.copingBase, POST.top, 1.2, tone(), out);
      bevelPrism(sq(POST.capHalf), POST.top, POST.top + POST.cap, 0.015, 1.2, tone(), out);
    }
  }
  // piers: along the current under the deck, with a pointed cutwater upstream (+v: the water runs toward decreasing
  // polar angle, -v) standing proud of the slab's face and rising almost to the deck, capped with a low stone pyramid,
  // as an old stone bridge's pier noses do; the downstream end squared off under the deck
  for (const u of b.piers) {
    const h = B.pierT / 2, end = B.deckHalf + 0.12;
    prism([bw(b, u - h, -end), bw(b, u + h, -end), bw(b, u + h, end), bw(b, u - h, end)], WALL_BOTTOM, LEVEL.soffit, 1.2, tone(), out);
    const face = outerV(u) - 0.02, nose = face + 0.34;
    const top = LEVEL.deck - 0.05;
    const nt = tone();
    prism([bw(b, u - h, end - 0.1), bw(b, u + h, end - 0.1), bw(b, u + h, face), bw(b, u, nose), bw(b, u - h, face)], WALL_BOTTOM, top, 1.2, nt, out);
    // the cap: a low pyramid over the nose's triangle and the band behind it, from the slab's face out
    const apex = new THREE.Vector3(...pt3(bw(b, u, face + 0.12), top + 0.1));
    const ring = [bw(b, u - h - 0.02, face), bw(b, u, nose + 0.03), bw(b, u + h + 0.02, face)];
    for (let i = 0; i < ring.length; i++) {
      const p0 = new THREE.Vector3(...pt3(ring[i], top)), p1 = new THREE.Vector3(...pt3(ring[(i + 1) % ring.length], top));
      const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(apex, p0)).normalize();
      if (n.y < 0) n.negate();
      out.tri(p0, p1, apex, n, n, n, [0, 0], [0.3, 0], [0.15, 0.1], nt);
    }
  }
}

/** Stones as instances of three rock shapes: the pockets' sills and the pairs on the wall ledges. */
interface Stone {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tone: number;
  /** 0 clean .. 1 filmed with green */
  moss: number;
  shape: number;
}

function stonesOf(P: RiverPlan): { stones: Stone[]; obstacles: Array<{ a: P2; b: P2; r: number }> } {
  const rnd = seeded(2024);
  const stones: Stone[] = [];
  const obstacles: Array<{ a: P2; b: P2; r: number }> = [];
  // the sills: stones round each pocket's rounded front, tops 4 cm over the water
  for (const pk of P.pockets) {
    const line = pocketOutline(pk, 64);
    let acc = 0;
    let next = 0.02;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      while (acc + seg >= next) {
        const t = (next - acc) / seg;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        // a mix of sizes, rounded and chunky, some barely awash, with gaps where the current has rolled one away: a
        // laid edge, not a necklace
        const big = rnd() < 0.3;
        const size = big ? 0.12 + rnd() * 0.06 : 0.06 + rnd() * 0.05;
        const sy = size * (0.75 + rnd() * 0.3);
        const top = LEVEL.sill + (rnd() - 0.55) * 0.08;
        const jx = (rnd() - 0.5) * 0.05, jz = (rnd() - 0.5) * 0.05;
        // wet and darker than the copings, some barely awash
        stones.push({ x: x + jx, y: top - 0.79 * sy, z: z + jz, sx: size * (1 + rnd() * 0.45), sy, sz: size, yaw: rnd() * TAU, tone: 0.42 + rnd() * 0.3, moss: rnd() < 0.35 ? 0.4 + rnd() * 0.6 : 0, shape: Math.floor(rnd() * 3) });
        next += size * (1.3 + rnd() * 0.6) + (rnd() < 0.12 ? 0.12 + rnd() * 0.2 : 0);
      }
      acc += seg;
    }
  }
  // the ledge stones, in pairs, and their foam
  for (const d of P.dressing) {
    if (d.kind !== "stones") continue;
    const r = Math.hypot(d.x, d.z);
    const a = Math.atan2(d.z, d.x);
    for (const [k, off, size] of [
      [0, -0.2, 0.26],
      [1, 0.22, 0.17],
    ] as const) {
      const s = size * (0.9 + rnd() * 0.25);
      const p = polar(r + d.dir * k * 0.12, a + off / r);
      const sy = s * 0.95;
      stones.push({ x: p.x, y: LEVEL.water + 0.1 + rnd() * 0.07 - 0.79 * sy, z: p.z, sx: s * 1.25, sy, sz: s, yaw: rnd() * TAU, tone: 0.55 + rnd() * 0.25, moss: rnd() < 0.5 ? 0.3 + rnd() * 0.5 : 0, shape: Math.floor(rnd() * 3) });
      obstacles.push({ a: p, b: p, r: s * 1.05 });
    }
  }
  // the piers
  for (const b of P.bridges) {
    for (const u of b.piers) {
      const end = BRIDGE.deckHalf + 0.12;
      obstacles.push({ a: bw(b, u, -end), b: bw(b, u, end + 0.2), r: BRIDGE.pierT / 2 });
    }
  }
  return { stones, obstacles };
}

function Stones({ stones }: { stones: Stone[] }) {
  const shapes = useMemo(() => [rockGeometry(1), rockGeometry(2), rockGeometry(3)], []);
  useEffect(() => () => shapes.forEach((g) => g.dispose()), [shapes]);
  const material = useMemo(() => withWetBand(withBounce(new THREE.MeshStandardMaterial({ color: "#9a9284", roughness: 0.7, metalness: 0 }), "stones"), "stones"), []);
  useEffect(() => () => material.dispose(), [material]);
  const refs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const groups = useMemo(() => [0, 1, 2].map((k) => stones.filter((s) => s.shape === k)), [stones]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    groups.forEach((list, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      list.forEach((s, i) => {
        q.setFromAxisAngle(up, s.yaw);
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sx, s.sy, s.sz));
        mesh.setMatrixAt(i, m);
        // warm grey granite, the darker the wetter (the sills sit low), a few with a green film of algae
        const moss = s.moss;
        mesh.setColorAt(i, c.setRGB(s.tone * (1 - 0.3 * moss), s.tone * (0.985 - 0.05 * moss), s.tone * (0.94 - 0.35 * moss)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [groups]);
  return (
    <group name="river-stones">
      {groups.map((list, k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[shapes[k], material, list.length]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

function Reeds({ P, tier }: { P: RiverPlan; tier: "cinematic" | "balanced" | "lite" }) {
  const geo = useMemo(() => {
    const blades = tier === "lite" ? 18 : tier === "balanced" ? 30 : 42;
    const segs = tier === "lite" ? 3 : 5;
    const parts: THREE.BufferGeometry[] = [];
    for (const d of P.dressing) {
      if (d.kind !== "reeds") continue;
      const g = reedClumpGeometry(blades, 1.25 + (d.seed % 5) * 0.06, d.seed, segs);
      g.rotateY(d.seed * 1.37);
      g.translate(d.x, LEVEL.ledge, d.z);
      parts.push(g);
    }
    return mergeAll(parts);
  }, [P, tier]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh name="river-reeds" geometry={geo} material={marginMaterial()} castShadow receiveShadow />;
}


/**
 * The planted margins that make a moat a lazy river: low fans of sweet flag (Acorus gramineus, a common marginal for
 * shallow water: grown in baskets on the ledge, their crowns a hand under the water) in loose, uneven drifts along both
 * banks wherever no pocket or bridge stands, in the gaps between the pockets and beside the bridges' mouths, now one
 * clump, now two together, now a gap, so the hard granite channel reads softened and planted rather than as a moat.
 * Tufts are also set on a few pockets' sills.
 */
function Margins({ P, tier }: { P: RiverPlan; tier: "cinematic" | "balanced" | "lite" }) {
  const geo = useMemo(() => {
    const blades = tier === "lite" ? 12 : tier === "balanced" ? 18 : 24;
    const segs = tier === "lite" ? 3 : 4;
    const rnd = seeded(5150);
    const parts: THREE.BufferGeometry[] = [];
    const crown = LEVEL.water - 0.1;
    let seed = 400;
    for (const bank of ["in", "out"] as const) {
      const face = bank === "in" ? P.river.wIn : P.river.wOut;
      const dir = bank === "in" ? 1 : -1;
      const pocketsHere = P.pockets.filter((p) => p.bank === bank);
      const step = 0.45 / face;
      for (let a = 0; a < TAU; a += step * (0.7 + 0.8 * rnd())) {
        const along = (q: number) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))) * face;
        // (in the gaps between the pockets too, and right up to the bridges' mouths)
        if (pocketsHere.some((p) => along(p.a) < POCKET.len / 2 + 0.05)) continue;
        if (P.bridges.some((b) => along(b.a) < BRIDGE.mouthHalf + 0.35)) continue;
        // drifts: a slow noise along the bank decides where they gather
        const drift = 0.5 + 0.5 * Math.sin(a * 7.3 + Math.sin(a * 2.1) * 2.0);
        if (rnd() > 0.35 + 0.6 * drift) continue;
        const r = face + dir * (0.16 + 0.12 * rnd());
        const p = polar(r, a);
        const g = reedClumpGeometry(blades, 0.42 + 0.18 * rnd(), seed++, segs);
        g.scale(1.25, 1, 1.25);
        g.rotateY(rnd() * TAU);
        g.translate(p.x, crown, p.z);
        parts.push(g);
      }
    }
    // a few tufts on the pockets' sills
    for (const pk of P.pockets) {
      if (rnd() > 0.3) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const p = polar(pk.face + pk.dir * 0.2, pk.a + (side * (POCKET.len / 2 - 0.15)) / pk.face);
      const g = reedClumpGeometry(Math.round(blades * 0.7), 0.36 + 0.12 * rnd(), seed++, segs);
      g.rotateY(rnd() * TAU);
      g.translate(p.x, LEVEL.sill - 0.08, p.z);
      parts.push(g);
    }
    return mergeAll(parts);
  }, [P, tier]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh name="river-margins" geometry={geo} material={marginMaterial()} castShadow receiveShadow />;
}

/** Soft streaks of lamplight on the water under each lamp whose reflection falls on open water (night only). */
function streakTexture(): THREE.CanvasTexture {
  const w = 64, h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1, v = (y / (h - 1)) * 2 - 1;
      const across = Math.exp(-u * u * 6);
      const along = Math.max(0, 1 - Math.abs(v)) ** 1.2;
      const ripple = 0.65 + 0.35 * Math.sin(y * 0.55 + Math.sin(y * 0.13) * 3);
      const a = across * along * ripple;
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 196;
      img.data[i + 2] = 120;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function onOpenWater(P: RiverPlan, p: P2): boolean {
  const r = Math.hypot(p.x, p.z);
  if (r < P.river.wIn + 0.3 || r > P.river.wOut - 0.3) return false;
  const a = Math.atan2(p.z, p.x);
  return P.bridges.every((b) => {
    let d = a - b.a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    // clear of the deck's outline there (its parapets' outer line, flaring toward each bank) and a hand's width more
    return Math.abs(d * r) > faceAt(b, r) + BRIDGE.parT + 0.25;
  });
}

export function River({ P, tier, still, shadows }: { P: RiverPlan; tier: "cinematic" | "balanced" | "lite"; still: boolean; shadows: boolean }) {
  const lite = tier === "lite";
  const { c0, wIn, wOut, c1 } = P.river;
  const water = useMemo(() => new THREE.RingGeometry(wIn - 0.03, wOut + 0.03, 720, 4).rotateX(-Math.PI / 2).translate(0, LEVEL.water, 0), [wIn, wOut]);
  const waterMat = useMemo(() => riverWaterMaterial(lite), [lite]);
  const granite = useMemo(() => graniteTexture(), []);
  const stoneMat = useMemo(() => withWetBand(withBounce(new THREE.MeshStandardMaterial({ map: granite, vertexColors: true, roughness: 0.82, metalness: 0 }), "granite"), "granite"), [granite]);
  const wallTex = useMemo(() => wallTexture(), []);
  // the walls face the water and mostly the shade: a warm, light stone so they read as stone, not slate
  // (with a little warm light thrown back onto them from the sunlit paving and water, faded out by night)
  const wallMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: wallTex, color: new THREE.Color(1.25, 1.17, 1.04), emissive: new THREE.Color(0.2, 0.16, 0.11), emissiveMap: wallTex, roughness: 0.9, metalness: 0 }),
    [wallTex],
  );

  const walls = useMemo(() => mergeAll([wallGeometry(wIn, 1, WALL_BOTTOM, WALL_TOP, 1.6), wallGeometry(wOut, -1, WALL_BOTTOM, WALL_TOP, 1.6)]), [wIn, wOut]);
  const copings = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const deckHalf = BRIDGE.mouthHalf + BRIDGE.parT;
    for (const [r0, r1, seed] of [
      [c0, wIn + 0.04, 5],
      [wOut - 0.04, c1, 9],
    ] as const) {
      const inner = Math.min(r0, r1);
      const ha = Math.asin(deckHalf / inner);
      const stretches: Array<[number, number]> = P.bridges.map((b, k) => {
        const next = P.bridges[(k + 1) % P.bridges.length].a + (k === P.bridges.length - 1 ? TAU : 0);
        return [b.a + ha, next - ha];
      });
      parts.push(copingGeometry(stretches, r0, r1, LEVEL.copingBase, LEVEL.coping, 0.9, seed));
    }
    return mergeAll(parts);
  }, [P, c0, wIn, wOut, c1]);
  const bridges = useMemo(() => {
    const out = new Tris();
    const rnd = seeded(31);
    for (const b of P.bridges) bridgeTris(b, P, out, rnd);
    return out.geometry();
  }, [P]);
  const lamps = useMemo(() => lampGeometry(LAMP_FOOT, LEVEL.lamp), []);
  const lampPoints = useMemo(() => P.bridges.flatMap((b) => b.lamps), [P]);
  const { material: lampMat, glow } = useMemo(() => liveGlowMaterial({ roughness: 0.55, metalness: 0.25 }, "river-lamp"), []);
  const { stones, obstacles } = useMemo(() => stonesOf(P), [P]);

  // the lamps' reflections: from each lamp's mirror image (as far under the water as the lamp stands over it) toward
  // the camera's fixed bearing, the surface point the follow camera sees it at
  const streaks = useMemo(() => {
    const h = LEVEL.lamp - 0.18 - LEVEL.water;
    const shift = h / Math.tan(FOLLOW_ELEVATION);
    return lampPoints.map((p) => ({ x: p.x + TOWARD_CAMERA.x * shift, z: p.z + TOWARD_CAMERA.z * shift })).filter((p) => onOpenWater(P, p));
  }, [P, lampPoints]);
  const streakAssets = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.42, 2.6).rotateX(-Math.PI / 2);
    const tex = streakTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pool = poolTexture();
    const poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    return { g, tex, mat, pool, poolMat, poolGeo };
  }, []);

  useEffect(
    () => () => {
      water.dispose();
      waterMat.dispose();
      granite.dispose();
      stoneMat.dispose();
      wallTex.dispose();
      wallMat.dispose();
      walls.dispose();
      copings.dispose();
      bridges.dispose();
      lamps.dispose();
      lampMat.dispose();
      streakAssets.g.dispose();
      streakAssets.tex.dispose();
      streakAssets.mat.dispose();
      streakAssets.pool.dispose();
      streakAssets.poolMat.dispose();
      streakAssets.poolGeo.dispose();
    },
    [water, waterMat, granite, stoneMat, wallTex, wallMat, walls, copings, bridges, lamps, lampMat, streakAssets],
  );

  // the water's stones and piers, nearest the Meadow's camera side first (the shader takes MAX_OBSTACLES)
  useLayoutEffect(() => {
    const list = obstacles.slice().sort((p, q) => Math.hypot(p.a.x - 12, p.a.z - 12) - Math.hypot(q.a.x - 12, q.a.z - 12)).slice(0, MAX_OBSTACLES);
    list.forEach((o, i) => {
      waterUniforms.uObs.value[i].set(o.a.x, o.a.z, o.b.x, o.b.z);
      waterUniforms.uObsR.value[i] = o.r;
    });
    waterUniforms.uObsCount.value = list.length;
  }, [obstacles]);

  const lampRef = useRef<THREE.InstancedMesh>(null);
  const streakRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const lampMesh = lampRef.current, poolMesh = poolRef.current, streakMesh = streakRef.current;
    if (lampMesh && poolMesh) {
      lampPoints.forEach((p, i) => {
        m.makeTranslation(p.x, 0, p.z);
        lampMesh.setMatrixAt(i, m);
        m.makeScale(4.6, 1, 4.6).setPosition(p.x, LEVEL.deck + 0.01, p.z);
        poolMesh.setMatrixAt(i, m);
      });
      lampMesh.instanceMatrix.needsUpdate = true;
      poolMesh.instanceMatrix.needsUpdate = true;
      lampMesh.computeBoundingSphere();
      poolMesh.computeBoundingSphere();
    }
    if (streakMesh) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(TOWARD_CAMERA.x, TOWARD_CAMERA.z));
      streaks.forEach((p, i) => {
        m.compose(new THREE.Vector3(p.x, LEVEL.water + 0.004, p.z), q, new THREE.Vector3(1, 1, 1));
        streakMesh.setMatrixAt(i, m);
      });
      streakMesh.instanceMatrix.needsUpdate = true;
      streakMesh.computeBoundingSphere();
    }
  }, [lampPoints, streaks]);

  useFrame((state) => {
    waterUniforms.uTime.value = env.time;
    waterUniforms.uRipple.value = 1;
    marginUniforms.uMarginTime.value = env.time;
    marginUniforms.uMarginWind.value = env.wind;
    const breath = still ? 1 : 0.94 + 0.06 * Math.sin(state.clock.elapsedTime * 1.3);
    glow.value = (0.4 + 2.6 * meadow.night) * breath;
    wallMat.emissiveIntensity = 1 - meadow.night;
    bounceUniforms.uBounce.value.copy(BOUNCE).multiplyScalar(0.3 * (1 - meadow.night));
    const night = Math.max(0, meadow.night - 0.2);
    streakAssets.mat.opacity = night * 0.7 * breath;
    streakAssets.poolMat.opacity = night * 0.7 * breath;
    if (streakRef.current) streakRef.current.visible = streakAssets.mat.opacity > 0.01;
    if (poolRef.current) poolRef.current.visible = streakAssets.poolMat.opacity > 0.01;
  });

  return (
    <group name="river">
      <mesh name="river-water" geometry={water} material={waterMat} receiveShadow />
      <mesh name="river-walls" geometry={walls} material={wallMat} receiveShadow />
      <mesh name="river-copings" geometry={copings} material={stoneMat} castShadow={shadows} receiveShadow />
      <mesh name="river-bridges" geometry={bridges} material={stoneMat} castShadow receiveShadow />
      <instancedMesh name="river-lamps" ref={lampRef} args={[lamps, lampMat, lampPoints.length]} castShadow />
      <instancedMesh ref={poolRef} args={[streakAssets.poolGeo, streakAssets.poolMat, lampPoints.length]} renderOrder={4} visible={false} />
      {streaks.length > 0 ? <instancedMesh ref={streakRef} args={[streakAssets.g, streakAssets.mat, streaks.length]} renderOrder={4} visible={false} /> : null}
      <Stones stones={stones} />
      <Reeds P={P} tier={tier} />
      <Margins P={P} tier={tier} />
    </group>
  );
}
