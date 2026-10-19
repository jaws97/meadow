// The doe's skeleton and skinned geometry, built from the side-view blueprint. Pure three.js, so the counts, the
// weights and the rest pose can be checked in a unit test; Doe.tsx makes the SkinnedMesh and poses it every frame.
//
// The bones sit at the blueprint's pivots with no rest rotation, so a bone's rest frame is the body's own (x toward
// her head, y up, z to her right) and every pose is a rotation away from standing square. The spine runs root (the
// ground under her withers) -> pelvis -> loin -> chest -> three neck bones -> head, with the ears on the head and two
// tail bones on the pelvis. Each foreleg hangs from the chest: shoulder blade, upper arm, forearm, cannon and pastern;
// each hind leg from the pelvis: thigh (femur), gaskin (tibia), cannon and pastern. Left legs stand at -z.
import * as THREE from "three";
import {
  BODY,
  EAR,
  EYE,
  FORE,
  FORE_PIVOTS,
  HEAD,
  HIND_LOWER,
  HIND_PIVOTS,
  LEG_SPREAD,
  SPINE,
  TAIL,
  THIGH,
  type LegJoint,
} from "@/components/deer/blueprint";
import { DoeMesh, PART, resample, type Ring } from "@/components/deer/loft";
import type { Quality } from "@/lib/garden/store";

export const SPINE_BONES = ["pelvis", "loin", "chest", "neck0", "neck1", "neck2", "head"] as const;
export const SIDES = ["L", "R"] as const;
export type Side = (typeof SIDES)[number];
/** z sign of a left or right leg (+z is her right). */
export const sideZ = (side: Side) => (side === "L" ? -1 : 1);

/** Every bone's name, in skeleton order. */
export const BONE_NAMES: readonly string[] = [
  "root",
  ...SPINE_BONES,
  "earL",
  "earR",
  "tail0",
  "tail1",
  ...SIDES.flatMap((s) => [0, 1, 2, 3, 4].map((k) => `fore${s}${k}`)),
  ...SIDES.flatMap((s) => [0, 1, 2, 3].map((k) => `hind${s}${k}`)),
];
const BONE = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<string, number>;
export const boneIndex = (name: string) => {
  const i = BONE[name];
  if (i === undefined) throw new Error(`no bone ${name}`);
  return i;
};

export const TESS = {
  cinematic: { body: [76, 32], head: [26, 24], leg: [40, 14], thigh: [20, 18], ear: [14, 12], tail: [12, 10], eye: 12 },
  balanced: { body: [60, 26], head: [20, 20], leg: [32, 12], thigh: [16, 14], ear: [12, 10], tail: [10, 8], eye: 10 },
  lite: { body: [44, 20], head: [16, 16], leg: [24, 10], thigh: [12, 12], ear: [10, 8], tail: [8, 8], eye: 8 },
} as const satisfies Record<Quality, unknown>;

/** Where every bone pivots in the rest pose (world = body frame, since nothing is rotated at rest). */
export function restPivots(): Record<string, THREE.Vector3> {
  const p: Record<string, THREE.Vector3> = { root: new THREE.Vector3(0, 0, 0) };
  for (const b of SPINE_BONES) p[b] = new THREE.Vector3(SPINE[b][0], SPINE[b][1], 0);
  for (const s of SIDES) {
    p[`ear${s}`] = new THREE.Vector3(EAR.base[0], EAR.base[1], EAR.base[2] * sideZ(s));
    for (let k = 0; k < 5; k++) p[`fore${s}${k}`] = new THREE.Vector3(FORE_PIVOTS[k][0], FORE_PIVOTS[k][1], LEG_SPREAD.fore * sideZ(s));
    for (let k = 0; k < 4; k++) p[`hind${s}${k}`] = new THREE.Vector3(HIND_PIVOTS[k][0], HIND_PIVOTS[k][1], LEG_SPREAD.hind * sideZ(s));
  }
  p.tail0 = new THREE.Vector3(TAIL.root[0], TAIL.root[1], 0);
  p.tail1 = new THREE.Vector3((TAIL.root[0] + TAIL.tip[0]) / 2, (TAIL.root[1] + TAIL.tip[1]) / 2, 0);
  return p;
}

/** A toe, where its hoof plants (body frame). */
export function restToe(kind: "fore" | "hind", side: Side): THREE.Vector3 {
  const t = kind === "fore" ? FORE_PIVOTS[5] : HIND_PIVOTS[4];
  return new THREE.Vector3(t[0], t[1], (kind === "fore" ? LEG_SPREAD.fore : LEG_SPREAD.hind) * sideZ(side));
}

/** Each bone's parent (root has none). */
export function parentOf(name: string): string | null {
  if (name === "root") return null;
  const spine = SPINE_BONES.indexOf(name as (typeof SPINE_BONES)[number]);
  if (spine === 0) return "root";
  if (spine > 0) return SPINE_BONES[spine - 1];
  if (name.startsWith("ear")) return "head";
  if (name === "tail0") return "pelvis";
  if (name === "tail1") return "tail0";
  const k = Number(name.slice(-1));
  const stem = name.slice(0, -1);
  if (k > 0) return `${stem}${k - 1}`;
  return name.startsWith("fore") ? "chest" : "pelvis";
}

/** The skeleton in its rest pose: bones at their pivots, unrotated. */
export function makeBones(): THREE.Bone[] {
  const pivots = restPivots();
  const bones = BONE_NAMES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  BONE_NAMES.forEach((name, i) => {
    const parent = parentOf(name);
    const b = bones[i];
    if (parent) {
      bones[BONE[parent]].add(b);
      b.position.subVectors(pivots[name], pivots[parent]);
    } else b.position.copy(pivots[name]);
  });
  bones[0].updateMatrixWorld(true);
  return bones;
}

/**
 * Weights along a chain: bone k owns the stretch from pivot k to pivot k+1 (as shares of the way along), blending into
 * its neighbour over `blend` of the shorter stretch either side of each pivot.
 */
export function chainWeights(at: readonly number[], bones: readonly number[], u: number, blend = 0.2): [number, number][] {
  const n = bones.length;
  let k = 0;
  while (k < n - 1 && u >= at[k + 1]) k++;
  const out: [number, number][] = [[bones[k], 1]];
  const seg = (i: number) => Math.max(1e-6, (at[i + 1] ?? 1) - at[i]);
  if (k > 0) {
    const b = blend * Math.min(seg(k - 1), seg(k));
    const d = u - at[k];
    if (d < b) {
      const t = 0.5 + 0.5 * (d / b);
      out[0][1] = t;
      out.push([bones[k - 1], 1 - t]);
    }
  }
  if (k < n - 1) {
    const b = blend * Math.min(seg(k), seg(k + 1));
    const d = at[k + 1] - u;
    if (d < b) {
      const t = 0.5 + 0.5 * (d / b);
      out[0][1] *= t;
      out.push([bones[k + 1], 1 - t]);
    }
  }
  return out;
}

/** Shares of the way along a polyline at which each of `points` lies nearest. */
export function sharesAlong(line: readonly THREE.Vector3[], points: readonly THREE.Vector3[]): number[] {
  const len = [0];
  for (let i = 1; i < line.length; i++) len.push(len[i - 1] + line[i].distanceTo(line[i - 1]));
  const total = len[len.length - 1];
  return points.map((p) => {
    let best = 0;
    let bestD = Infinity;
    line.forEach((q, i) => {
      const d = q.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return len[best] / total;
  });
}

function legRings(list: readonly LegJoint[], z: number): Ring[] {
  return list.map((j) => ({ x: j.at[0], y: j.at[1], z: j.z === undefined ? z : j.z * Math.sign(z), up: j.front, down: j.back, w: j.w }));
}

/** The ear's section: a thin curved blade, cupped toward +out (its opening). up = half thickness, down = cup depth. */
function earSection(th: number, r: Ring): readonly [number, number] {
  const x = r.w * Math.cos(th);
  const q = r.w > 1e-6 ? x / r.w : 0;
  const bend = -r.down * (1 - q * q);
  return [x, bend - r.up * Math.sin(th)];
}

/**
 * An ear's frame for a carriage: its long axis (y) at an elevation above horizontal and a bearing out from straight
 * ahead, its opening (z) facing out and forward (60 degrees ahead of that bearing, so from the side the ear shows
 * its broad oval, not its edge) and a little down, x across the ear.
 */
export function earBasis(side: Side, elevation: number, azimuth: number): THREE.Matrix4 {
  const z = sideZ(side);
  const el = THREE.MathUtils.degToRad(elevation);
  const az = THREE.MathUtils.degToRad(azimuth);
  const yAxis = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), z * Math.cos(el) * Math.sin(az)).normalize();
  const face = new THREE.Vector3(Math.cos(az - Math.PI / 3), -0.25, z * Math.sin(az - Math.PI / 3));
  const zAxis = face.addScaledVector(yAxis, -face.dot(yAxis)).normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
  return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
}

export interface DoeLengths {
  body: number;
  head: number;
  fore: number;
  hind: number;
  thigh: number;
  /** metres along the body loft where the neck begins, and level with the elbow and the stifle */
  neckAt: number;
  elbowAt: number;
  stifleAt: number;
  /** the eye's place on the head's coat: along the head, and round from its top line (m) */
  eyeS: number;
  eyeD: number;
}

export interface DoeBuild {
  geometry: THREE.BufferGeometry;
  bones: THREE.Bone[];
  triangles: number;
  lengths: DoeLengths;
}

export function buildDoe(tier: Quality): DoeBuild {
  const t = TESS[tier];
  const m = new DoeMesh();
  const pivots = restPivots();

  // body and neck: weights by the spine bones' places along the centre line
  const line = resample(BODY, 200).map((r) => new THREE.Vector3(r.ring.x, r.ring.y, 0));
  const spineAt = sharesAlong(line, SPINE_BONES.map((b) => pivots[b]));
  const spineIdx = SPINE_BONES.map((b) => boneIndex(b));
  const bodyLen = m.addLoft({
    rings: BODY,
    along: t.body[0],
    around: t.body[1],
    part: PART.body,
    capStart: 0.7,
    capEnd: 0.5,
    weights: (u) => chainWeights([0, ...spineAt.slice(1)], spineIdx, u, 0.45),
  });
  const along = (x: number) => sharesAlong(line, [new THREE.Vector3(x, 0.56, 0)])[0] * bodyLen;

  // head
  const headBone = boneIndex("head");
  const headFrom = m.vertexCount;
  const headLen = m.addLoft({ rings: HEAD, along: t.head[0], around: t.head[1], part: PART.head, capStart: 0.35, capEnd: 0.6, weights: () => [[headBone, 1]] });
  // where the eye sits in the head's coat coordinates, so the coat's eye ring is centred on it
  const eye = { s: 0, d: 0 };
  {
    let best = Infinity;
    for (let i = headFrom; i < m.vertexCount; i++) {
      const dx = m.pos[i * 3] - EYE.at[0];
      const dy = m.pos[i * 3 + 1] - EYE.at[1];
      const dz = m.pos[i * 3 + 2] - EYE.out;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        eye.s = m.coat[i * 4];
        eye.d = Math.abs(m.coat[i * 4 + 1]);
      }
    }
  }

  // legs
  let foreLen = 0;
  let hindLen = 0;
  let thighLen = 0;
  const chest = boneIndex("chest");
  const pelvis = boneIndex("pelvis");
  for (const s of SIDES) {
    const z = sideZ(s);
    // foreleg, along its bones
    const fore = legRings(FORE, LEG_SPREAD.fore * z);
    const foreAt = sharesAlong(
      fore.map((r) => new THREE.Vector3(r.x, r.y, r.z)),
      [0, 1, 2, 3, 4].map((k) => pivots[`fore${s}${k}`]),
    );
    const foreBones = [0, 1, 2, 3, 4].map((k) => boneIndex(`fore${s}${k}`));
    foreLen = m.addLoft({
      rings: fore,
      along: t.leg[0],
      around: t.leg[1],
      part: PART.fore,
      flip: s === "L",
      capStart: 0.4,
      capEnd: 0.4,
      weights: (u) => {
        const w = chainWeights(foreAt, foreBones, u);
        // the top of the shoulder blade stays with the chest
        const keep = Math.max(0, 1 - u / Math.max(1e-6, foreAt[1] * 0.7)) * 0.6;
        return keep > 0 ? [...w.map(([b, x]) => [b, x * (1 - keep)] as [number, number]), [chest, keep]] : w;
      },
    });

    // the thigh and gaskin: an upright loft, weighted by height (the thigh above the stifle, the gaskin below)
    const femur = boneIndex(`hind${s}0`);
    const tibia = boneIndex(`hind${s}1`);
    const meta = boneIndex(`hind${s}2`);
    const top = THIGH[0][0];
    const bottom = THIGH[THIGH.length - 1][0];
    const thigh: Ring[] = THIGH.map(([y, front, back, w], i) => ({
      x: (front + back) / 2,
      y,
      // from inside the rump out to the leg's line
      z: z * (0.045 + (LEG_SPREAD.hind - 0.045) * Math.min(1, i / 4)),
      up: (front - back) / 2,
      down: (front - back) / 2,
      w,
      n: 2.0,
    }));
    const stifleY = HIND_PIVOTS[1][1];
    thighLen = m.addLoft({
      rings: thigh,
      along: t.thigh[0],
      around: t.thigh[1],
      part: PART.thigh,
      flip: s === "L",
      capStart: 0.3,
      capEnd: 0.1,
      weights: (u) => {
        const y = top + (bottom - top) * u;
        const knee = THREE.MathUtils.smoothstep(y, stifleY - 0.06, stifleY + 0.06);
        const rump = THREE.MathUtils.smoothstep(y, 0.55, 0.64) * 0.55;
        const hock = 1 - THREE.MathUtils.smoothstep(y, 0.27, 0.32);
        return [
          [femur, knee * (1 - rump)],
          [pelvis, knee * rump],
          [tibia, (1 - knee) * (1 - hock * 0.5)],
          [meta, (1 - knee) * hock * 0.5],
        ];
      },
    });

    // the lower hind leg, along its bones from the hock
    const lower = legRings(HIND_LOWER, LEG_SPREAD.hind * z);
    const lowerAt = sharesAlong(
      lower.map((r) => new THREE.Vector3(r.x, r.y, r.z)),
      [2, 3].map((k) => pivots[`hind${s}${k}`]),
    );
    const pastern = boneIndex(`hind${s}3`);
    hindLen = m.addLoft({
      rings: lower,
      along: Math.round(t.leg[0] * 0.75),
      around: t.leg[1],
      part: PART.hind,
      flip: s === "L",
      capStart: 0.3,
      capEnd: 0.4,
      weights: (u) => {
        const w = chainWeights(lowerAt, [meta, pastern], u);
        // the point of the hock goes with the gaskin
        const keep = Math.max(0, 1 - u / 0.12) * 0.5;
        return keep > 0 ? [...w.map(([b, x]) => [b, x * (1 - keep)] as [number, number]), [tibia, keep]] : w;
      },
    });
  }

  // ears, each built upright in its own frame (axis +y, opening toward +z) and then set on the head
  const L = EAR.length;
  const W = EAR.width / 2;
  const earRings: Ring[] = [
    { x: 0, y: -0.01, up: 0.008, down: W * 0.62, w: W * 0.42 },
    { x: 0, y: L * 0.16, up: 0.0045, down: W * 0.55, w: W * 0.68 },
    { x: 0, y: L * 0.45, up: 0.003, down: W * EAR.cup, w: W },
    { x: 0, y: L * 0.72, up: 0.0024, down: W * EAR.cup * 0.7, w: W * 0.85 },
    { x: 0, y: L * 0.9, up: 0.0018, down: W * 0.14, w: W * 0.5 },
    { x: 0, y: L, up: 0.0012, down: 0.001, w: W * 0.08 },
  ];
  for (const s of SIDES) {
    const ear = boneIndex(`ear${s}`);
    const from = m.vertexCount;
    m.addLoft({
      rings: earRings,
      along: t.ear[0],
      around: t.ear[1],
      part: PART.ear,
      section: earSection,
      capEnd: 0.3,
      weights: (u) => (u < 0.12 ? [[ear, 0.5 + u * 4], [headBone, 0.5 - u * 4]] : [[ear, 1]]),
    });
    m.transform(from, earBasis(s, EAR.rest.elevation, EAR.rest.azimuth).setPosition(pivots[`ear${s}`]));
  }

  // tail: flat, hanging on the buttocks, dark above with a white fringe
  const tail0 = boneIndex("tail0");
  const tail1 = boneIndex("tail1");
  const [rx, ry] = TAIL.root;
  const [ex, ey] = TAIL.tip;
  const tailRings: Ring[] = [0, 0.3, 0.65, 1].map((f, i) => ({
    x: rx + (ex - rx) * f - 0.02 * Math.sin(Math.PI * f),
    y: ry + (ey - ry) * f,
    up: TAIL.depth * [0.95, 0.85, 0.7, 0.5][i],
    down: TAIL.depth * [0.95, 0.85, 0.7, 0.5][i],
    w: TAIL.width * [0.85, 0.95, 0.8, 0.55][i],
  }));
  m.addLoft({
    rings: tailRings,
    along: t.tail[0],
    around: t.tail[1],
    part: PART.tail,
    capStart: 0.6,
    capEnd: 0.8,
    weights: (u) => chainWeights([0, 0.5], [tail0, tail1], u, 0.5),
  });

  // eyes
  for (const s of SIDES) {
    m.addEllipsoid([EYE.at[0], EYE.at[1], EYE.out * sideZ(s)], [EYE.r * 1.12, EYE.r * 0.82, EYE.r * 0.72], PART.eye, [[headBone, 1]], t.eye);
  }

  const geometry = m.build();
  return {
    geometry,
    bones: makeBones(),
    triangles: m.index.length / 3,
    lengths: {
      body: bodyLen,
      head: headLen,
      fore: foreLen,
      hind: hindLen,
      thigh: thighLen,
      neckAt: spineAt[3] * bodyLen,
      elbowAt: along(FORE_PIVOTS[2][0] + 0.02),
      stifleAt: along(HIND_PIVOTS[1][0] + 0.03),
      eyeS: eye.s,
      eyeD: eye.d,
    },
  };
}
