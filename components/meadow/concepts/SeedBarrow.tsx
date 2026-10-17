"use client";
/* eslint-disable react-hooks/immutability --
   Materials, uniforms and the fairy lights' colours are created once and written in the frame loop (see kit.tsx). */
// Lantern Cart concept B, the seed barrow: a teak barrow with painted seed drawers down both sides, sacks of seed and
// pots of seedlings inside, pushed from behind by two saffron-gripped handles. Four madder-red turned posts hold up a
// block-printed canopy (saffron stripes, little indigo flowers) with a scalloped valance and pompoms at its points,
// fairy lights swagged under it and wound down the posts. The guardian light is a paper star lantern of saffron and
// rose, the kind hung on Bangalore balconies at Diwali, turning slowly on a carved arm that reaches out ahead of the
// cart, so the light leads the way. The wheels are solid discs, painted indigo with a cream flower.
//
// Draw calls: body, canopy, valance, bulbs, their glow, the star, its halo, and two per wheel. About 6.9k triangles.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { liveGlowMaterial, merge, paint, seeded } from "@/components/meadow/parts";
import {
  axleLathe,
  canvasTexture,
  glowAt,
  glowTexture,
  Halo,
  lathe,
  place,
  spoke,
  swag,
  tube,
  useAssets,
  useSwing,
  v,
  Wheels,
  type ConceptProps,
} from "@/components/meadow/concepts/kit";

export const STAR_LIGHT = "#ffb36b";

const TEAK = ["#9a6a3c", "#8a5c33", "#a8774a", "#7f5430", "#93633a"];
const INDIGO = "#4f78b8";
const SAFFRON = "#e39a2f";
const MADDER = "#a8432f";
const CREAM = "#f3e3c0";
const ROSE = "#f0788f";
const LEAF = "#5e8a4a";
const IRON = "#33302c";
const BRASS = "#c9a058";
const WIRE = "#2b2925";
const BURLAP = "#b89a6a";
const TERRACOTTA = "#b8653f";
const SOIL = "#3d2c20";

/** The box: outer half-length, half-width, floor and top. */
const BOX = { hx: 0.58, hz: 0.33, floor: -0.335, top: 0.07 };
/** The canopy: half-sizes at the eaves, the eaves' height and how far the fabric rises to the ridge. */
const ROOF = { hx: 0.68, hz: 0.44, edge: 1.0, rise: 0.2 };
const POSTS: Array<[number, number]> = [
  [0.55, 0.305],
  [0.55, -0.305],
  [-0.55, 0.305],
  [-0.55, -0.305],
];
/** Where the star hangs from its arm. */
const HOOK = v(0.94, 1.2, 0);

function roofY(w: number): number {
  return ROOF.edge + ROOF.rise * w ** 1.5;
}

/** Block-printed cotton: a saffron stripe edged in madder, then cream with two columns of small indigo flowers. */
function fabricTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(77);
    ctx.fillStyle = "#f2e4c4";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e5a03a";
    ctx.fillRect(0, 0, 88, h);
    // the dye takes a little unevenly
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(255,210,140,0.18)" : "rgba(170,90,20,0.12)";
      ctx.fillRect(rand() * 88, rand() * h, 2 + rand() * 6, 1 + rand() * 3);
    }
    ctx.fillStyle = "#b0412e";
    ctx.fillRect(94, 0, 4, h);
    ctx.fillRect(246, 0, 4, h);
    for (const cx of [140, 204]) {
      for (let k = 0; k < 7; k++) {
        const x = cx + (rand() - 0.5) * 3;
        const y = k * (h / 6.4) + (cx === 204 ? 20 : 0) + (rand() - 0.5) * 3;
        ctx.globalAlpha = 0.82 + rand() * 0.18;
        ctx.fillStyle = "#2e4a7d";
        for (let p = 0; p < 4; p++) {
          const a = (p / 4) * Math.PI * 2 + Math.PI / 4;
          for (const oy of [-h, 0, h]) {
            ctx.beginPath();
            ctx.ellipse(x + Math.cos(a) * 6, y + oy + Math.sin(a) * 6, 5, 3, a, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = "#b0412e";
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.arc(x, y + oy, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  });
}

/** The valance: saffron, a cream line, a madder border with cream dots along the scalloped edge. */
function valanceTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = "#e39a2f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f6e7c6";
    ctx.fillRect(0, 26, w, 3);
    ctx.fillStyle = "#a8432f";
    ctx.fillRect(0, 36, w, 22);
    ctx.fillStyle = "#f6e7c6";
    for (let x = 4; x < w; x += 12) {
      ctx.beginPath();
      ctx.arc(x, 47, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#7c2c1f";
    ctx.fillRect(0, 58, w, 6);
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** The wheel's painted face: indigo with a saffron ring, cream dots and an eight-petalled flower. Original. */
function wheelFaceTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = "#2f4a78";
    ctx.fillRect(0, 0, w, w);
    // the grain of the planks shows faintly under the paint
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < w; y += 9) {
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(y) * 2);
      ctx.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + Math.cos(y) * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (const x of [c - 60, c + 60]) ctx.fillRect(x, 0, 2, w);
    const ring = (r0: number, r1: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c, c, r1, 0, Math.PI * 2);
      ctx.arc(c, c, r0, 0, Math.PI * 2, true);
      ctx.fill();
    };
    ring(c * 0.8, c * 0.9, "#e39a2f");
    ctx.fillStyle = "#f3e3c0";
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * c * 0.7, c + Math.sin(a) * c * 0.7, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.save();
      ctx.translate(c + Math.cos(a) * c * 0.42, c + Math.sin(a) * c * 0.42);
      ctx.rotate(a);
      ctx.fillStyle = "#f3e3c0";
      ctx.beginPath();
      ctx.ellipse(0, 0, c * 0.2, c * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f0788f";
      ctx.beginPath();
      ctx.ellipse(-c * 0.04, 0, c * 0.1, c * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ring(0, c * 0.22, "#e39a2f");
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** One face of the canopy, from its eave (e0..e1) up to the ridge (r0..r1), the fabric dishing like a chhatri. */
function roofFace(e0: THREE.Vector2, e1: THREE.Vector2, r0: THREE.Vector2, r1: THREE.Vector2, nu: number, nw: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const len = e0.distanceTo(e1);
  for (let j = 0; j <= nw; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const w = j / nw;
      const ex = e0.x + (e1.x - e0.x) * u;
      const ez = e0.y + (e1.y - e0.y) * u;
      const rx = r0.x + (r1.x - r0.x) * u;
      const rz = r0.y + (r1.y - r0.y) * u;
      pos.push(ex + (rx - ex) * w, roofY(w), ez + (rz - ez) * w);
      uv.push((u * len) / 0.34, w);
    }
  }
  for (let j = 0; j < nw; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const RR = ROOF.hx - ROOF.hz;
/** The four eaves, each with its ridge ends, scallop count and outward direction. */
const FACES = [
  { e0: new THREE.Vector2(-ROOF.hx, ROOF.hz), e1: new THREE.Vector2(ROOF.hx, ROOF.hz), r0: new THREE.Vector2(-RR, 0), r1: new THREE.Vector2(RR, 0), n: 6, out: v(0, 0, 1) },
  { e0: new THREE.Vector2(ROOF.hx, -ROOF.hz), e1: new THREE.Vector2(-ROOF.hx, -ROOF.hz), r0: new THREE.Vector2(RR, 0), r1: new THREE.Vector2(-RR, 0), n: 6, out: v(0, 0, -1) },
  { e0: new THREE.Vector2(ROOF.hx, ROOF.hz), e1: new THREE.Vector2(ROOF.hx, -ROOF.hz), r0: new THREE.Vector2(RR, 0), r1: new THREE.Vector2(RR, 0), n: 4, out: v(1, 0, 0) },
  { e0: new THREE.Vector2(-ROOF.hx, -ROOF.hz), e1: new THREE.Vector2(-ROOF.hx, ROOF.hz), r0: new THREE.Vector2(-RR, 0), r1: new THREE.Vector2(-RR, 0), n: 4, out: v(-1, 0, 0) },
];

function roofGeometry(): THREE.BufferGeometry {
  return merge(FACES.map((f) => roofFace(f.e0, f.e1, f.r0, f.r1, f.n * 2, 4)));
}

/** Scalloped valances hanging from the eaves, and where each scallop's point is (for its pompom). */
function valance(): { geo: THREE.BufferGeometry; tips: THREE.Vector3[] } {
  const pos: number[] = [];
  const uv: number[] = [];
  const tips: THREE.Vector3[] = [];
  const SUB = 6;
  for (const f of FACES) {
    const len = f.e0.distanceTo(f.e1);
    const steps = f.n * SUB;
    const top: THREE.Vector3[] = [];
    const bottom: THREE.Vector3[] = [];
    const us: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const frac = (t * f.n) % 1;
      const depth = 0.045 + 0.07 * Math.sin(Math.PI * (i === steps ? 0 : frac)) ** 0.7;
      const x = f.e0.x + (f.e1.x - f.e0.x) * t + f.out.x * 0.004;
      const z = f.e0.y + (f.e1.y - f.e0.y) * t + f.out.z * 0.004;
      top.push(v(x, ROOF.edge + 0.002, z));
      bottom.push(v(x + f.out.x * 0.018, ROOF.edge - depth, z + f.out.z * 0.018));
      us.push((t * len) / 0.25);
      if (i % SUB === SUB / 2) tips.push(v(x + f.out.x * 0.02, ROOF.edge - depth - 0.02, z + f.out.z * 0.02));
    }
    for (let i = 0; i < steps; i++) {
      const quad = [top[i], bottom[i], bottom[i + 1], top[i], bottom[i + 1], top[i + 1]];
      const quv = [us[i], 1, us[i], 0, us[i + 1], 0, us[i], 1, us[i + 1], 0, us[i + 1], 1];
      for (const p of quad) pos.push(p.x, p.y, p.z);
      uv.push(...quv);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return { geo, tips };
}

/** The fairy lights' strings: a swag along each side under the canopy, and a spiral down every post. */
function fairyStrings(): Array<{ wire: THREE.Vector3[]; bulbs: THREE.Vector3[] }> {
  const out: Array<{ wire: THREE.Vector3[]; bulbs: THREE.Vector3[] }> = [];
  const Y = 0.94;
  const sides: Array<[number, number, number]> = [
    [0, 2, 11],
    [1, 3, 11],
    [0, 1, 7],
    [2, 3, 7],
  ];
  for (const [a, b, n] of sides) {
    const pa = v(POSTS[a][0], Y, POSTS[a][1]);
    const pb = v(POSTS[b][0], Y, POSTS[b][1]);
    const sag = n > 8 ? 0.13 : 0.09;
    const bulbs = swag(pa, pb, sag, n + 2)
      .slice(1, -1)
      .map((p) => p.add(v(0, -0.014, 0)));
    out.push({ wire: swag(pa, pb, sag, 14), bulbs });
  }
  for (const [px, pz] of POSTS) {
    const wire: THREE.Vector3[] = [];
    const bulbs: THREE.Vector3[] = [];
    const phase = Math.atan2(pz, px);
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const a = phase + t * Math.PI * 5;
      wire.push(v(px + Math.cos(a) * 0.034, 0.94 - t * 0.74, pz + Math.sin(a) * 0.034));
    }
    for (let k = 0; k < 8; k++) {
      const t = (k + 0.5) / 8;
      const a = phase + t * Math.PI * 5;
      bulbs.push(v(px + Math.cos(a) * 0.046, 0.94 - t * 0.74 - 0.01, pz + Math.sin(a) * 0.046));
    }
    out.push({ wire, bulbs });
  }
  return out;
}

/** A small leaf, base at the origin pointing along +x. */
function leafGeometry(): THREE.BufferGeometry {
  const p = [0, 0, 0, 0.05, 0.012, 0.03, 0.11, 0, 0, 0, 0, 0, 0.11, 0, 0, 0.05, 0.012, -0.03];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

function bodyGeometry(strings: Array<{ wire: THREE.Vector3[] }>, tips: THREE.Vector3[]): THREE.BufferGeometry {
  const rand = seeded(1110);
  const parts: THREE.BufferGeometry[] = [];
  const teak = () => new THREE.Color(TEAK[Math.floor(rand() * TEAK.length)]);
  // planks: four to a side, a finger's gap between them
  const rows = [-0.284, -0.184, -0.084, 0.016];
  for (const y of rows) {
    for (const z of [-BOX.hz + 0.012, BOX.hz - 0.012]) parts.push(box(BOX.hx * 2, 0.092, 0.024, 0, y, z, teak()));
    for (const x of [-BOX.hx + 0.012, BOX.hx - 0.012]) parts.push(box(0.024, 0.092, BOX.hz * 2 - 0.05, x, y, 0, teak()));
  }
  parts.push(box(BOX.hx * 2 - 0.04, 0.02, BOX.hz * 2 - 0.04, 0, BOX.floor, 0, TEAK[3]));
  parts.push(box(BOX.hx * 2 - 0.05, 0.02, BOX.hz * 2 - 0.05, 0, -0.005, 0, TEAK[3]));
  for (const z of [-BOX.hz, BOX.hz]) parts.push(box(BOX.hx * 2 + 0.04, 0.035, 0.05, 0, BOX.top + 0.012, z, TEAK[1]));
  for (const x of [-BOX.hx, BOX.hx]) parts.push(box(0.05, 0.035, BOX.hz * 2 + 0.04, x, BOX.top + 0.012, 0, TEAK[1]));

  // seed drawers down both sides, each with a brass knob and a little cream label
  const fronts = [INDIGO, SAFFRON, LEAF];
  for (const side of [-1, 1]) {
    fronts.forEach((color, k) => {
      const x = (k - 1) * 0.34;
      const z = side * (BOX.hz + 0.01);
      parts.push(box(0.29, 0.15, 0.02, x, -0.05, z, color));
      parts.push(box(0.075, 0.032, 0.006, x, -0.005, z + side * 0.012, CREAM));
      const knob = lathe(
        [
          [0, 0],
          [0.008, 0],
          [0.008, 0.012],
          [0.017, 0.018],
          [0.012, 0.027],
          [0, 0.029],
        ],
        6,
      );
      knob.rotateX((side * Math.PI) / 2);
      knob.translate(x, -0.055, z + side * 0.01);
      parts.push(paint(knob, BRASS));
    });
  }

  // turned posts, painted madder red
  for (const [px, pz] of POSTS) {
    const post = lathe(
      [
        [0.024, -0.33],
        [0.024, 0.1],
        [0.032, 0.12],
        [0.02, 0.16],
        [0.017, 0.5],
        [0.023, 0.55],
        [0.017, 0.6],
        [0.017, 0.86],
        [0.03, 0.9],
        [0.022, 0.94],
        [0.022, 1.035],
      ],
      8,
    );
    post.translate(px, 0, pz);
    parts.push(paint(post, MADDER));
  }
  // the canopy's seams: a saffron cord along the ridge, madder down the hips, a finial on top
  parts.push(paint(spoke(v(-RR, ROOF.edge + ROOF.rise + 0.004, 0), v(RR, ROOF.edge + ROOF.rise + 0.004, 0), 0.008, 0.008, 5), SAFFRON));
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    parts.push(paint(spoke(v(sx * ROOF.hx, ROOF.edge + 0.004, sz * ROOF.hz), v(sx * RR, ROOF.edge + ROOF.rise + 0.004, 0), 0.006, 0.006, 4), MADDER));
  }
  const top = ROOF.edge + ROOF.rise;
  parts.push(
    paint(
      lathe(
        [
          [0.03, top - 0.01],
          [0.036, top + 0.02],
          [0.02, top + 0.05],
          [0.03, top + 0.08],
          [0.012, top + 0.115],
          [0, top + 0.14],
        ],
        8,
      ),
      BRASS,
    ),
  );
  for (let i = 0; i < tips.length; i++) {
    const pom = new THREE.IcosahedronGeometry(0.018, 0);
    pom.translate(tips[i].x, tips[i].y, tips[i].z);
    parts.push(paint(pom, [SAFFRON, ROSE, INDIGO][i % 3]));
  }

  // sacks of seed, lumpy, their tops rolled down
  const sacks: Array<[number, number, string]> = [
    [0.3, 0.15, "#3b3631"],
    [0.3, -0.15, "#8e2f2a"],
    [0.0, 0.0, "#c9a36a"],
  ];
  sacks.forEach(([sx, sz, seed], k) => {
    const sack = lathe(
      [
        [0, -0.325],
        [0.1, -0.325],
        [0.125, -0.29],
        [0.135, -0.18],
        [0.128, -0.05],
        [0.115, 0.06],
        [0.112, 0.1],
      ],
      10,
      k,
    );
    const p = sack.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const lump = 1 + 0.07 * Math.sin(3 * Math.atan2(z, x) + 7 * y + k * 2.1);
      p.setXYZ(i, x * lump, y, z * lump);
    }
    sack.computeVertexNormals();
    sack.translate(sx, 0, sz);
    parts.push(paint(sack, new THREE.Color(BURLAP).multiplyScalar(0.92 + k * 0.05)));
    const rim = lathe(
      [
        [0.112, 0.1],
        [0.136, 0.108],
        [0.14, 0.128],
        [0.118, 0.136],
      ],
      10,
      k,
    );
    rim.translate(sx, 0, sz);
    parts.push(paint(rim, "#cdb184"));
    const seeds = new THREE.CircleGeometry(0.116, 10);
    seeds.rotateX(-Math.PI / 2);
    seeds.translate(sx, 0.112, sz);
    parts.push(paint(seeds, seed));
  });
  // a wooden scoop left in the middle sack
  parts.push(paint(spoke(v(0.02, 0.1, 0.02), v(-0.06, 0.27, 0.07), 0.011, 0.009, 5), TEAK[2]));

  // pots of seedlings at the back, on a shelf inside the box
  const leaf = leafGeometry();
  for (const [px, pz, flowers] of [
    [-0.33, 0.15, 0],
    [-0.33, -0.15, 1],
  ] as Array<[number, number, number]>) {
    const pot = lathe(
      [
        [0, 0],
        [0.058, 0],
        [0.072, 0.12],
        [0.086, 0.125],
        [0.086, 0.158],
        [0.072, 0.16],
      ],
      10,
    );
    pot.translate(px, 0, pz);
    parts.push(paint(pot, TERRACOTTA));
    const soil = new THREE.CircleGeometry(0.073, 10);
    soil.rotateX(-Math.PI / 2);
    soil.translate(px, 0.148, pz);
    parts.push(paint(soil, SOIL));
    for (let s = 0; s < 3; s++) {
      const a = s * 2.1 + px;
      const bx = px + Math.cos(a) * 0.035;
      const bz = pz + Math.sin(a) * 0.035;
      const h = 0.06 + rand() * 0.04;
      parts.push(paint(spoke(v(bx, 0.148, bz), v(bx, 0.148 + h, bz), 0.004, 0.003, 3), "#557a3c"));
      for (const turn of [0, Math.PI]) {
        parts.push(paint(place(leaf.clone(), v(bx, 0.148 + h, bz), new THREE.Euler(0, a + turn, 0.5, "YXZ"), 0.7), LEAF));
      }
      if (flowers && s < 2) {
        const pom = new THREE.DodecahedronGeometry(0.026, 0);
        pom.translate(bx, 0.148 + h + 0.025, bz);
        parts.push(paint(pom, s === 0 ? SAFFRON : "#f6b52a"));
      }
    }
  }
  leaf.dispose();

  // push handles, running under the box and rising behind it to saffron grips
  for (const z of [-0.25, 0.25]) {
    parts.push(paint(spoke(v(-0.2, -0.36, z), v(-0.88, 0.02, z * 1.06), 0.016, 0.016, 6), TEAK[1]));
    parts.push(paint(spoke(v(-0.86, 0.01, z * 1.06), v(-0.98, 0.077, z * 1.08), 0.023, 0.021, 8), SAFFRON));
  }
  // the axles, and iron straps holding them under the box
  for (const x of [-0.45, 0.45]) {
    parts.push(paint(spoke(v(x, -0.54, -0.37), v(x, -0.54, 0.37), 0.017, 0.017, 6), IRON));
    for (const z of [-0.26, 0.26]) parts.push(box(0.05, 0.2, 0.012, x, -0.44, z, IRON));
  }
  // the arm the star hangs from, carved from teak, curling at its tip
  parts.push(
    paint(
      tube([v(0.2, 1.205, 0), v(0.42, 1.235, 0), v(0.72, 1.255, 0), v(0.96, 1.215, 0), v(1.03, 1.14, 0), v(0.995, 1.09, 0), v(0.945, 1.115, 0)], 0.017, 24, 6),
      TEAK[0],
    ),
  );
  parts.push(paint(spoke(v(HOOK.x, 1.232, 0), v(HOOK.x, HOOK.y, 0), 0.005, 0.005, 4), BRASS));
  // the fairy lights' wire
  for (const s of strings) parts.push(paint(tube(s.wire, 0.0035, s.wire.length > 20 ? 30 : 16, 3), WIRE));
  return merge(parts);
}

function bulbGeometry(strings: Array<{ bulbs: THREE.Vector3[] }>): { geo: THREE.BufferGeometry; points: THREE.Vector3[] } {
  const parts: THREE.BufferGeometry[] = [];
  const points: THREE.Vector3[] = [];
  const colors = ["#fff0c8", "#fff0c8", "#ffc46a", "#fff0c8", "#ff9db0"];
  let k = 0;
  for (const s of strings) {
    for (const p of s.bulbs) {
      const bulb = new THREE.IcosahedronGeometry(0.011, 0);
      bulb.scale(1, 1.4, 1);
      bulb.translate(p.x, p.y, p.z);
      parts.push(paint(bulb, colors[k++ % colors.length], 1));
      points.push(p);
    }
  }
  return { geo: merge(parts), points };
}

/** A five-pointed star of paper, two-toned on every point, with paper tails below, on a short cord from the hook. */
function starGeometry(): THREE.BufferGeometry {
  const R = 0.19;
  const r = 0.084;
  const d = 0.08;
  const cord = 0.08;
  const cy = -R - cord;
  const outline: THREE.Vector3[] = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 === 0 ? R : r;
    outline.push(v(Math.cos(a) * rad, cy + Math.sin(a) * rad, 0));
  }
  const front = v(0, cy, d);
  const back = v(0, cy, -d);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k < 10; k++) {
    const p0 = outline[k];
    const p1 = outline[(k + 1) % 10];
    c.set(k % 2 === 0 ? "#ffae3d" : "#ff6f8e");
    for (const p of [front, p0, p1, back, p1, p0]) {
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    }
  }
  const star = new THREE.BufferGeometry();
  star.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  star.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  star.computeVertexNormals();
  star.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  star.setAttribute("glow", new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(1), 1));
  const parts: THREE.BufferGeometry[] = [star];
  // tails of paper from the lower points
  const tails: Array<[number, number, string]> = [
    [-0.07, 0.24, "#ffae3d"],
    [-0.035, 0.28, "#ff6f8e"],
    [0, 0.31, "#fff1d6"],
    [0.035, 0.28, "#7fc06a"],
    [0.07, 0.24, "#ff6f8e"],
  ];
  for (const [x, len, color] of tails) {
    const strip = new THREE.PlaneGeometry(0.018, len);
    strip.translate(x, cy - 0.05 - len / 2, 0);
    parts.push(paint(strip, color, 0.7));
  }
  // the cord it hangs by, which does not glow
  parts.push(paint(spoke(v(0, 0.002, 0), v(0, -cord, 0), 0.003, 0.003, 3), WIRE, 0));
  return merge(parts);
}

function wheelRimGeometry(): THREE.BufferGeometry {
  return merge([
    paint(
      axleLathe(
        [
          [0.2, -0.024],
          [0.2, 0.024],
        ],
        24,
      ),
      IRON,
    ),
    paint(
      axleLathe(
        [
          [0.046, 0.024],
          [0.04, 0.04],
          [0.025, 0.05],
          [0, 0.054],
        ],
        8,
      ),
      BRASS,
    ),
  ]);
}

function wheelFaceGeometry(): THREE.BufferGeometry {
  const outer = new THREE.CircleGeometry(0.2, 24);
  outer.translate(0, 0, 0.024);
  const inner = new THREE.CircleGeometry(0.2, 24);
  inner.rotateY(Math.PI);
  inner.translate(0, 0, -0.024);
  return merge([outer, inner]);
}

function StarLantern() {
  const pivot = useSwing(0.4, 0.04);
  const turn = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const res = useAssets(() => {
    const { material, glow } = liveGlowMaterial({ roughness: 0.85, side: THREE.DoubleSide }, "concept-star");
    return { geo: starGeometry(), mat: material, glow };
  });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    res.glow.value = glowAt(0.5, 1.5, t, 0.06);
    if (turn.current) turn.current.rotation.y = t * 0.35;
    if (light.current) light.current.intensity = glowAt(0.5, 3.0, t, 0.06);
  });
  return (
    <group ref={pivot}>
      <group ref={turn}>
        <mesh geometry={res.geo} material={res.mat} castShadow />
      </group>
      <pointLight ref={light} position={[0, -0.27, 0]} color={STAR_LIGHT} distance={6} decay={2} />
      <Halo size={0.95} color={STAR_LIGHT} position={[0, -0.27, 0]} />
    </group>
  );
}

/** Concept B in chassis space; `wheels` receives the four wheel groups for the parent to pose. */
export function SeedBarrow({ wheels }: ConceptProps) {
  const res = useAssets(() => {
    const strings = fairyStrings();
    const val = valance();
    const bulbs = bulbGeometry(strings);
    const fabric = fabricTexture();
    const valTex = valanceTexture();
    const face = wheelFaceTexture();
    const lights = liveGlowMaterial({ roughness: 0.4 }, "concept-fairy");
    const glowPoints = new THREE.BufferGeometry().setFromPoints(bulbs.points);
    const base = new Float32Array(bulbs.points.length * 3);
    const c = new THREE.Color();
    for (let i = 0; i < bulbs.points.length; i++) {
      c.set(["#ffe7b0", "#ffe7b0", "#ffb860", "#ffe7b0", "#ff9aa8"][i % 5]);
      base.set([c.r, c.g, c.b], i * 3);
    }
    glowPoints.setAttribute("color", new THREE.BufferAttribute(base.slice(), 3));
    return {
      body: bodyGeometry(strings, val.tips),
      roof: roofGeometry(),
      valance: val.geo,
      bulbs: bulbs.geo,
      glowPoints,
      base,
      fabric,
      valTex,
      face,
      wheelRim: wheelRimGeometry(),
      wheelFace: wheelFaceGeometry(),
      painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74 }),
      fabricMat: new THREE.MeshStandardMaterial({ map: fabric, roughness: 0.92, side: THREE.DoubleSide }),
      valanceMat: new THREE.MeshStandardMaterial({ map: valTex, roughness: 0.92, side: THREE.DoubleSide }),
      faceMat: new THREE.MeshStandardMaterial({ map: face, roughness: 0.7 }),
      lightsMat: lights.material,
      lightsGlow: lights.glow,
      pointsMat: new THREE.PointsMaterial({
        map: glowTexture(),
        size: 0.075,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    };
  });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    res.lightsGlow.value = glowAt(0.3, 1.8, t, 0);
    res.pointsMat.opacity = glowAt(0.12, 0.9, t, 0);
    // a slow chase along the strings
    const attr = res.glowPoints.attributes.color as THREE.BufferAttribute;
    const base = res.base;
    for (let i = 0; i < attr.count; i++) {
      const k = 0.7 + 0.3 * Math.sin(t * 1.7 - i * 0.55);
      attr.setXYZ(i, base[i * 3] * k, base[i * 3 + 1] * k, base[i * 3 + 2] * k);
    }
    attr.needsUpdate = true;
  });
  return (
    <group>
      <mesh geometry={res.body} material={res.painted} castShadow receiveShadow />
      <mesh geometry={res.roof} material={res.fabricMat} castShadow receiveShadow />
      <mesh geometry={res.valance} material={res.valanceMat} castShadow />
      <mesh geometry={res.bulbs} material={res.lightsMat} />
      <points geometry={res.glowPoints} material={res.pointsMat} />
      <Wheels wheels={wheels}>
        <mesh geometry={res.wheelRim} material={res.painted} castShadow />
        <mesh geometry={res.wheelFace} material={res.faceMat} castShadow />
      </Wheels>
      <group position={HOOK}>
        <StarLantern />
      </group>
    </group>
  );
}
