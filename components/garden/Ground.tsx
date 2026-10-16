"use client";
// The lawn. A wide disc whose vertex colours carry patches of lighter and
// darker turf, a shadow where it meets the bed's stones and the path, and a
// fall-off into the distance; and the grass itself: three blade shapes
// (bowed, upright, twisted) scattered in clumps with a dark-to-light gradient
// up every blade, densest at the foot of the stone ring and along the path's
// edges, kept off the flagstones and out of the bed, plus a low layer of
// clover and broadleaf weeds and a few fallen leaves. Rain wets the turf and
// the blades. The bed, its mulch and the puddle live in Garden.tsx.
import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { grassTexture } from "@/lib/garden/groundTextures";
import {
  bedRho,
  makeSwayDepthMaterial,
  makeSwayMaterial,
  pathPlan,
  swayUniforms,
  type PathPlan,
} from "@/lib/garden/dressing";
import { LAYOUT } from "@/lib/garden/layout";
import { Rng, clamp01, lerp, smoothstep, vnoise2 } from "@/lib/plant/prng";
import { env } from "@/lib/garden/env";
import { useGarden, type Quality } from "@/lib/garden/store";

/** Instances per tier. Blades split 45/35/20 across the three shapes. */
interface Budget {
  blades: number;
  clover: number;
  weeds: number;
}
const BUDGET: Record<Quality, Budget> = {
  cinematic: { blades: 6400, clover: 520, weeds: 220 },
  balanced: { blades: 3200, clover: 260, weeds: 110 },
  lite: { blades: 1100, clover: 90, weeds: 40 },
};
const BLADE_SPLIT = [0.45, 0.35, 0.2] as const;

const BLADE_HEIGHT = 0.16;
const LOW_HEIGHT = 0.03;
const LAWN_R = 14;
const CLUMP_COUNT = 340;
const FALLEN_LEAVES = 14;
/** Grass keeps outside this many oval units: just past the stone ring. */
const BED_CLEAR = 1.02;
const LANTERN_XZ = [LAYOUT.lantern.position[0], LAYOUT.lantern.position[2]] as const;

/* ---------- geometry builders (all deterministic, built once) ---------- */

interface Builder {
  pos: number[];
  nor: number[];
  col: number[];
  idx: number[];
}
const newBuilder = (): Builder => ({ pos: [], nor: [], col: [], idx: [] });

function finishBuilder(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

const tv = new THREE.Vector3();
const tn = new THREE.Vector3();
const tc = new THREE.Color();
const tc2 = new THREE.Color();

function pushVertex(b: Builder, m: THREE.Matrix4, x: number, y: number, z: number, n: THREE.Vector3, c: THREE.Color) {
  tv.set(x, y, z).applyMatrix4(m);
  tn.copy(n).transformDirection(m);
  b.pos.push(tv.x, tv.y, tv.z);
  b.nor.push(tn.x, tn.y, tn.z);
  b.col.push(c.r, c.g, c.b);
}

/**
 * A leaf-shaped fan: base at the origin, growing along +y, face toward +z.
 * `point` 0 is a rounded ellipse, 1 a pointed tip. `fold` lifts the margins
 * (z) so the leaf cups; `droop` bends the tip down.
 */
function addLeafFan(
  b: Builder,
  m: THREE.Matrix4,
  length: number,
  width: number,
  point: number,
  fold: number,
  droop: number,
  cBase: THREE.Color,
  cEdge: THREE.Color,
  cTip: THREE.Color,
  sides = 8,
) {
  const start = b.pos.length / 3;
  const n = tn.set(0, 0.2, 1).normalize().clone();
  pushVertex(b, m, 0, length * 0.5, 0, n, cBase);
  const outline: [number, number][] = [];
  outline.push([0, 0]);
  for (let k = 0; k < sides; k++) outline.push([(k + 0.5) / sides, 1]);
  outline.push([1, 0]);
  for (let k = sides - 1; k >= 0; k--) outline.push([(k + 0.5) / sides, -1]);
  for (const [s, side] of outline) {
    const pointed = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 0.85);
    const round = Math.sqrt(Math.max(0, 1 - Math.pow(2 * s - 1, 2)));
    const hw = (width / 2) * lerp(round, pointed, point);
    const x = side * hw;
    const z = fold * hw * 0.8 - droop * length * s * s;
    tc.copy(cEdge).lerp(cTip, smoothstep(0.45, 1, s));
    pushVertex(b, m, x, s * length, z, n, tc);
  }
  const count = outline.length;
  for (let i = 0; i < count; i++) {
    const a = start + 1 + i;
    const c = start + 1 + ((i + 1) % count);
    b.idx.push(start, a, c);
  }
}

const BLADE_ROOT = new THREE.Color("#1f4a1a");
const BLADE_TIP = new THREE.Color("#9ad15a");

type BladeKind = "bowed" | "upright" | "twisted";
const BLADE_KINDS: readonly BladeKind[] = ["bowed", "upright", "twisted"];
const BLADE_SHAPE: Record<BladeKind, { bow: number; twist: number; width: number }> = {
  bowed: { bow: 0.5, twist: 0.35, width: 0.013 },
  upright: { bow: 0.12, twist: 0.2, width: 0.011 },
  twisted: { bow: 0.28, twist: 1.7, width: 0.014 },
};

/**
 * One blade: a two-column strip up +y, tapering with a slight twist, bowed
 * toward +z. Vertex colour runs dark root to light tip; normals lean toward
 * +y so a lawn of randomly turned blades shades like one soft surface.
 */
function makeBladeGeometry(kind: BladeKind): THREE.BufferGeometry {
  const { bow, twist, width } = BLADE_SHAPE[kind];
  const rows = 7;
  const b = newBuilder();
  const id = new THREE.Matrix4();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const hw = (width / 2) * (1 - Math.pow(t, 1.4) * 0.95) * (1 + 0.2 * Math.sin(Math.PI * t));
    const a = twist * t;
    const bz = bow * BLADE_HEIGHT * t * t;
    tc.copy(BLADE_ROOT).lerp(BLADE_TIP, Math.pow(t, 1.15));
    tn.set(Math.sin(a) * 0.65, 0.75, Math.cos(a) * 0.65).normalize();
    for (const u of [-1, 1]) {
      pushVertex(b, id, Math.cos(a) * u * hw, t * BLADE_HEIGHT, Math.sin(a) * u * hw + bz, tn, tc);
    }
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    b.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return finishBuilder(b);
}

const CLOVER_BASE = new THREE.Color("#5f9a46");
const CLOVER_EDGE = new THREE.Color("#2a5a22");
const CLOVER_TIP = new THREE.Color("#3f7a30");
const STALK = new THREE.Color("#2f5a26");

/** Three round lobes on a short stalk, about three centimetres tall. */
function makeCloverGeometry(): THREE.BufferGeometry {
  const b = newBuilder();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3(1, 1, 1);
  m.identity();
  tn.set(0, 0.3, 1).normalize();
  pushVertex(b, m, -0.0012, 0, 0, tn, STALK);
  pushVertex(b, m, 0.0012, 0, 0, tn, STALK);
  pushVertex(b, m, -0.0008, LOW_HEIGHT * 0.9, 0, tn, STALK);
  pushVertex(b, m, 0.0008, LOW_HEIGHT * 0.9, 0, tn, STALK);
  b.idx.push(0, 2, 1, 1, 2, 3);
  for (let k = 0; k < 3; k++) {
    const yaw = (k / 3) * Math.PI * 2;
    e.set(-1.15, yaw, 0, "YXZ");
    q.setFromEuler(e);
    m.compose(tv.set(Math.sin(yaw) * 0.003, LOW_HEIGHT * 0.88, Math.cos(yaw) * 0.003), q, s);
    addLeafFan(b, m, 0.022, 0.02, 0.05, 0.25, 0.1, CLOVER_BASE, CLOVER_EDGE, CLOVER_TIP, 6);
  }
  return finishBuilder(b);
}

const WEED_BASE = new THREE.Color("#6aa44a");
const WEED_EDGE = new THREE.Color("#24521c");
const WEED_TIP = new THREE.Color("#3b7a2c");

/** A broadleaf rosette: four ovate leaves radiating low from one point. */
function makeWeedGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = newBuilder();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3(1, 1, 1);
  const n = 4 + rng.int(0, 1);
  for (let k = 0; k < n; k++) {
    const yaw = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    e.set(-rng.range(0.95, 1.3), yaw, rng.range(-0.2, 0.2), "YXZ");
    q.setFromEuler(e);
    m.compose(tv.set(0, 0.004, 0), q, s);
    addLeafFan(b, m, rng.range(0.045, 0.07), rng.range(0.022, 0.034), 0.55, 0.35, 0.25, WEED_BASE, WEED_EDGE, WEED_TIP, 7);
  }
  return finishBuilder(b);
}

const FALLEN_BASE = new THREE.Color("#5a3416");
const FALLEN_EDGE = new THREE.Color("#a86f2e");
const FALLEN_TIP = new THREE.Color("#c48a3c");

/** One dry leaf lying flat, used for every fallen leaf via instance colour. */
function makeFallenLeafGeometry(): THREE.BufferGeometry {
  const b = newBuilder();
  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  addLeafFan(b, m, 0.075, 0.04, 0.7, 0.3, -0.12, FALLEN_BASE, FALLEN_EDGE, FALLEN_TIP, 9);
  return finishBuilder(b);
}

/**
 * The lawn: a disc built as rings (dense near the centre) so it can carry a
 * colour per vertex: patches of warmer and cooler turf, a shadow where the
 * blades crowd the stone ring and the path, and a slow darkening toward the
 * horizon.
 */
function makeLawnGeometry(plan: PathPlan): THREE.BufferGeometry {
  const rings = 52;
  const segs = 112;
  const b = newBuilder();
  const uv: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const id = new THREE.Matrix4();
  const warm = new THREE.Color(1.08, 1.03, 0.78);
  const cool = new THREE.Color(0.62, 0.74, 0.6);
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0.01 : LAWN_R * Math.pow(i / rings, 2.1);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const n1 = vnoise2(x * 0.42 + 3.1, z * 0.42 - 1.7);
      const n2 = vnoise2(x * 1.35 - 5.2, z * 1.35 + 2.4);
      const patch = clamp01(0.5 + 0.38 * n1 + 0.18 * n2);
      tc.copy(cool).lerp(warm, patch);
      const atBed = lerp(0.42, 1, smoothstep(0.98, 1.5, bedRho(x, z)));
      const atPath = r < 4 ? lerp(0.6, 1, smoothstep(0.22, 0.6, plan.distance(x, z))) : 1;
      const far = lerp(1, 0.55, smoothstep(4.5, LAWN_R, r));
      tc.multiplyScalar(atBed * atPath * far);
      pushVertex(b, id, x, 0, z, up, tc);
      uv.push((x / LAWN_R + 1) * 0.5, (z / LAWN_R + 1) * 0.5);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const c = a + segs + 1;
      b.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const g = finishBuilder(b);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/* ---------- scatter ---------- */

interface Clump {
  x: number;
  z: number;
  r: number;
  h: number;
  tint: THREE.Color;
}

const CLUMP_WARM = new THREE.Color(1.12, 1.05, 0.72);
const CLUMP_COOL = new THREE.Color(0.78, 0.98, 0.9);

/** Where grass may not stand: in the bed, on a flagstone, at the post's foot. */
function blocked(x: number, z: number, plan: PathPlan): boolean {
  if (bedRho(x, z) < BED_CLEAR) return true;
  if (Math.hypot(x - LANTERN_XZ[0], z - LANTERN_XZ[1]) < 0.12) return true;
  return plan.onStone(x, z);
}

/** Clump centres: dense near the bed, thinning with distance, never inside it. */
function makeClumps(plan: PathPlan): Clump[] {
  const rng = new Rng("clumps");
  const out: Clump[] = [];
  let guard = 0;
  while (out.length < CLUMP_COUNT && guard++ < 20000) {
    const r = 0.5 + Math.pow(rng.next(), 0.75) * 3.2;
    if (rng.next() < 0.78 * smoothstep(1.6, 3.6, r)) continue;
    const a = rng.range(0, Math.PI * 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (bedRho(x, z) < BED_CLEAR + 0.04) continue;
    if (plan.distance(x, z) < 0.2) continue;
    out.push({
      x,
      z,
      r: rng.range(0.07, 0.22),
      h: rng.range(0.72, 1.28),
      tint: new THREE.Color().copy(CLUMP_COOL).lerp(CLUMP_WARM, rng.next()),
    });
  }
  return out;
}

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpAxis = new THREE.Vector3();
const DRY = new THREE.Color(1.1, 0.95, 0.6);
const [bcx, , bcz] = LAYOUT.bed.center;

/** Lean the dummy over by `lean` radians, tipping away from (dx, dz). */
function tip(dx: number, dz: number, lean: number) {
  const l = Math.hypot(dx, dz) || 1;
  tmpAxis.set(-dz / l, 0, dx / l);
  dummy.rotateOnWorldAxis(tmpAxis, lean);
}

/** A point along the path's centreline by fraction, with its side normal. */
function alongPath(plan: PathPlan, t: number, out: { x: number; z: number; nx: number; nz: number }) {
  const line = plan.line;
  const f = t * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(f));
  const u = f - i;
  const p0 = line[i];
  const p1 = line[i + 1];
  out.x = lerp(p0.x, p1.x, u);
  out.z = lerp(p0.z, p1.z, u);
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const l = Math.hypot(dx, dz) || 1;
  out.nx = -dz / l;
  out.nz = dx / l;
}

const pathPt = { x: 0, z: 0, nx: 0, nz: 0 };

function scatterBlades(mesh: THREE.InstancedMesh, kind: BladeKind, count: number, clumps: Clump[], plan: PathPlan) {
  const rng = new Rng("grass:" + kind);
  const leanBias = kind === "bowed" ? 0.1 : 0;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let h = 0.1;
    let dx = 0;
    let dz = 0;
    let clumpTint: THREE.Color | null = null;
    let shade = 1;
    let placed = false;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const pick = rng.next();
      if (pick < 0.12) {
        // The crowd of short, dark grass at the foot of the stone ring.
        const a = rng.range(0, Math.PI * 2);
        const rr = BED_CLEAR + Math.abs(rng.gauss()) * 0.06;
        x = bcx + Math.cos(a) * LAYOUT.bed.rx * rr;
        z = bcz + Math.sin(a) * LAYOUT.bed.rz * rr;
        h = rng.range(0.05, 0.11);
        shade = 0.62;
        dx = x - bcx;
        dz = z - bcz;
      } else if (pick < 0.3) {
        // Along the path's edges, leaning over the stones.
        alongPath(plan, rng.next(), pathPt);
        const side = rng.sign();
        const off = LAYOUT.pathWidth * 0.5 + Math.abs(rng.gauss()) * 0.1 - 0.04;
        x = pathPt.x + pathPt.nx * side * off;
        z = pathPt.z + pathPt.nz * side * off;
        h = rng.range(0.06, 0.15);
        shade = 0.8;
        dx = pathPt.nx * side * -1;
        dz = pathPt.nz * side * -1;
      } else if (pick < 0.84) {
        const c = clumps[rng.int(0, clumps.length - 1)];
        dx = rng.gauss() * c.r;
        dz = rng.gauss() * c.r;
        x = c.x + dx;
        z = c.z + dz;
        h = lerp(0.06, 0.22, Math.pow(rng.next(), 1.4)) * c.h;
        clumpTint = c.tint;
        shade = 1;
      } else {
        const r = 0.5 + Math.pow(rng.next(), 0.6) * 3.2;
        const a = rng.range(0, Math.PI * 2);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        h = lerp(0.06, 0.2, Math.pow(rng.next(), 1.3));
        dx = rng.gauss();
        dz = rng.gauss();
        shade = 1;
      }
      if (blocked(x, z, plan)) continue;
      // In the path's gaps only short, dark grass survives the feet.
      const d = plan.distance(x, z);
      if (d < 0.22) {
        if (rng.next() > 0.3) continue;
        h = rng.range(0.03, 0.06);
        shade *= 0.7;
      } else if (d < 0.4) {
        h *= lerp(0.6, 1, (d - 0.22) / 0.18);
      }
      placed = true;
    }
    if (!placed) {
      // Hide the instance under the lawn rather than leave stale data.
      dummy.position.set(0, -1, 0);
      dummy.scale.setScalar(0.0001);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor.setScalar(1));
      continue;
    }
    h = Math.min(0.24, Math.max(0.03, h));
    const w = rng.range(0.75, 1.3) * (0.85 + 0.3 * (h / 0.22));
    dummy.position.set(x, 0, z);
    dummy.scale.set(w, h / BLADE_HEIGHT, w);
    dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
    tip(dx, dz, rng.range(0.04, 0.32) + leanBias);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tmpColor.setScalar(rng.range(0.72, 1.15) * shade);
    if (clumpTint) tmpColor.multiply(clumpTint);
    if (rng.next() < 0.05) tmpColor.multiply(DRY);
    mesh.setColorAt(i, tmpColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function scatterLow(mesh: THREE.InstancedMesh, label: string, count: number, nearBias: number, plan: PathPlan) {
  const rng = new Rng(label);
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      const r = 0.6 + Math.pow(rng.next(), nearBias) * 1.8;
      const a = rng.range(0, Math.PI * 2);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      ok = !blocked(x, z, plan) && plan.distance(x, z) > 0.18;
    }
    const s = ok ? rng.range(0.8, 1.6) : 0.0001;
    dummy.position.set(x, ok ? 0 : -1, z);
    dummy.scale.setScalar(s);
    dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tmpColor.setScalar(rng.range(0.8, 1.12)).multiply(tc2.copy(CLUMP_COOL).lerp(CLUMP_WARM, rng.next()));
    mesh.setColorAt(i, tmpColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

const FALLEN_TINTS = ["#8a5a2a", "#a86f2e", "#7a4a26", "#b58a3c", "#6b3f1e", "#946238"] as const;

/** A few dry leaves on the lawn at the foot of the stones and on the path. */
function scatterFallen(mesh: THREE.InstancedMesh, plan: PathPlan) {
  const rng = new Rng("fallen");
  for (let i = 0; i < FALLEN_LEAVES; i++) {
    let x: number;
    let z: number;
    let y = 0.004;
    if (i < FALLEN_LEAVES * 0.65) {
      const a = rng.range(0, Math.PI * 2);
      const rr = 1.04 + Math.abs(rng.gauss()) * 0.12;
      x = bcx + Math.cos(a) * LAYOUT.bed.rx * rr;
      z = bcz + Math.sin(a) * LAYOUT.bed.rz * rr;
    } else {
      alongPath(plan, rng.range(0.05, 0.6), pathPt);
      const off = rng.range(-0.18, 0.18);
      x = pathPt.x + pathPt.nx * off;
      z = pathPt.z + pathPt.nz * off;
      y = plan.onStone(x, z) ? 0.024 : 0.006;
    }
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(rng.range(0.8, 1.4));
    dummy.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tmpColor.set(rng.pick(FALLEN_TINTS)).multiplyScalar(rng.range(0.85, 1.1));
    mesh.setColorAt(i, tmpColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/* ---------- component ---------- */

const WHITE = new THREE.Color("#ffffff");
const WET_GRASS = new THREE.Color("#8d9a86");
const WET_LEAF = new THREE.Color("#6a5a4c");

const GRASS_SWAY = { height: BLADE_HEIGHT, amount: 1, world: false };
const LOW_SWAY = { height: LOW_HEIGHT, amount: 0.25, world: false };

interface Smoothed {
  primed: boolean;
  wetness: number;
}

export function Ground() {
  const quality = useGarden((s) => s.quality);
  const seed = useGarden((s) => s.seed);
  const budget = BUDGET[quality];
  const bladeCounts = useMemo(() => BLADE_SPLIT.map((f) => Math.round(budget.blades * f)), [budget]);
  const bladesCastShadow = quality !== "lite";

  const bladeRefs = [
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
    useRef<THREE.InstancedMesh | null>(null),
  ];
  const cloverRef = useRef<THREE.InstancedMesh | null>(null);
  const weedRef = useRef<THREE.InstancedMesh | null>(null);
  const fallenRef = useRef<THREE.InstancedMesh | null>(null);
  const smooth = useRef<Smoothed>({ primed: false, wetness: 0 });

  // The owner's path decides where the lawn darkens and where blades may stand.
  const plan = useMemo(() => pathPlan(seed), [seed]);
  const clumps = useMemo(() => makeClumps(plan), [plan]);

  const lawnGeo = useMemo(() => makeLawnGeometry(plan), [plan]);
  const lawnMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, color: 0xffffff, vertexColors: true }),
    [],
  );
  const bladeGeos = useMemo(() => BLADE_KINDS.map(makeBladeGeometry), []);
  const cloverGeo = useMemo(makeCloverGeometry, []);
  const weedGeo = useMemo(() => makeWeedGeometry(7), []);
  const fallenGeo = useMemo(makeFallenLeafGeometry, []);

  const grassMat = useMemo(
    () => makeSwayMaterial("garden-grass-sway", GRASS_SWAY, { color: 0xffffff, roughness: 0.8, vertexColors: true }),
    [],
  );
  const grassDepth = useMemo(() => makeSwayDepthMaterial("garden-grass-sway", GRASS_SWAY), []);
  const lowMat = useMemo(
    () => makeSwayMaterial("garden-low-sway", LOW_SWAY, { color: 0xffffff, roughness: 0.75, vertexColors: true }),
    [],
  );
  const fallenMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }),
    [],
  );

  // Everything created above is ours; the textures come from the shared cache and stay.
  useEffect(() => {
    return () => {
      lawnGeo.dispose();
    };
  }, [lawnGeo]);
  useEffect(() => {
    return () => {
      lawnMat.dispose();
      for (const g of bladeGeos) g.dispose();
      cloverGeo.dispose();
      weedGeo.dispose();
      fallenGeo.dispose();
      grassMat.dispose();
      grassDepth.dispose();
      lowMat.dispose();
      fallenMat.dispose();
    };
  }, [lawnMat, bladeGeos, cloverGeo, weedGeo, fallenGeo, grassMat, grassDepth, lowMat, fallenMat]);

  // Scatter everything. Deterministic, so the lawn is identical on every visit.
  const [bowedRef, uprightRef, twistedRef] = bladeRefs;
  useLayoutEffect(() => {
    const meshes = [bowedRef.current, uprightRef.current, twistedRef.current];
    meshes.forEach((mesh, k) => {
      if (mesh) scatterBlades(mesh, BLADE_KINDS[k], bladeCounts[k], clumps, plan);
    });
    if (cloverRef.current) scatterLow(cloverRef.current, "clover", budget.clover, 1.3, plan);
    if (weedRef.current) scatterLow(weedRef.current, "weeds", budget.weeds, 1.6, plan);
    if (fallenRef.current) scatterFallen(fallenRef.current, plan);
  }, [bladeCounts, budget, clumps, plan, bowedRef, uprightRef, twistedRef]);

  /* eslint-disable react-hooks/immutability -- the memoised materials are three.js
     objects the frame loop drives imperatively; React never re-renders on them. */
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = smooth.current;
    if (!s.primed) {
      s.primed = true;
      s.wetness = env.rain;
    } else {
      s.wetness += (env.rain - s.wetness) * (1 - Math.exp(-dt * 1.5));
    }

    lawnMat.color.copy(WHITE).lerp(WET_GRASS, s.wetness);
    lawnMat.roughness = lerp(1, 0.6, s.wetness);
    // The blades are the grass too: tint and gloss them with the turf so they do
    // not float bright over a darkened lawn in the rain.
    grassMat.color.copy(WHITE).lerp(WET_GRASS, s.wetness);
    grassMat.roughness = lerp(0.8, 0.5, s.wetness);
    lowMat.color.copy(WHITE).lerp(WET_GRASS, s.wetness);
    lowMat.roughness = lerp(0.75, 0.45, s.wetness);
    fallenMat.color.copy(WHITE).lerp(WET_LEAF, s.wetness);
    fallenMat.roughness = lerp(0.9, 0.5, s.wetness);

    swayUniforms.uTime.value = env.time;
    swayUniforms.uWind.value = env.wind;
    swayUniforms.uBacklight.value = 0.3 * (1 - 0.4 * s.wetness);
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      <mesh geometry={lawnGeo} material={lawnMat} position-y={-0.002} receiveShadow />

      <instancedMesh
        key={"fallen" + seed}
        ref={fallenRef}
        args={[fallenGeo, fallenMat, FALLEN_LEAVES]}
        frustumCulled={false}
        receiveShadow
      />

      {BLADE_KINDS.map((kind, k) => (
        <instancedMesh
          key={kind + bladeCounts[k] + seed}
          ref={bladeRefs[k]}
          args={[bladeGeos[k], grassMat, bladeCounts[k]]}
          customDepthMaterial={grassDepth}
          frustumCulled={false}
          castShadow={bladesCastShadow}
          receiveShadow
        />
      ))}
      <instancedMesh
        key={"clover" + budget.clover + seed}
        ref={cloverRef}
        args={[cloverGeo, lowMat, budget.clover]}
        frustumCulled={false}
        receiveShadow
      />
      <instancedMesh
        key={"weeds" + budget.weeds + seed}
        ref={weedRef}
        args={[weedGeo, lowMat, budget.weeds]}
        frustumCulled={false}
        receiveShadow
      />
    </group>
  );
}
