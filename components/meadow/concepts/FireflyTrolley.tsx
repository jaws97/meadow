"use client";
/* eslint-disable react-hooks/immutability --
   Materials and the fireflies' positions are created once and written in the frame loop (see kit.tsx). */
// Lantern Cart concept C, the firefly trolley: a rounded tin tub, painted duck-egg teal with a hand-painted band of
// coral flowers and cream daisies, worn a little at the edges, full of soil and rows of seedlings with two bushes of
// tulsi. It rides on copper wire-spoked wheels with cream tyres, and a copper hoop arches over it with a jasmine vine
// climbing one side. From the top of the hoop hangs the guardian light: a glass jar in a copper cage, full of
// fireflies drifting and blinking. As dusk falls the jar brightens and a few fireflies slip out to circle the cart.
// A copper watering can hangs from the push handle.
//
// Draw calls: tub, plants and grip, copper, jar copper, glass and its glint, fireflies (in the jar and out), halo,
// and two per wheel. About 7.5k triangles.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { merge, paint, seeded } from "@/components/meadow/parts";
import {
  axleLathe,
  canvasTexture,
  crumple,
  glowAt,
  glowTexture,
  Halo,
  lathe,
  Loop,
  place,
  spoke,
  squircle,
  tube,
  tubeAlong,
  useAssets,
  useSwing,
  v,
  Wheels,
  type ConceptProps,
} from "@/components/meadow/concepts/kit";
import { meadow } from "@/components/meadow/runtime";

export const JAR_LIGHT = "#ffe08a";

const COPPER = "#c47a4a";
const CREAM = "#ece2cc";
const WOOD = "#8a5e38";
const SOIL = "#3b2a1f";
const LEAF = ["#5f9a46", "#6dab50", "#4f8a3c"];
const TULSI = ["#4f8040", "#5c8f48", "#6a7a46"];
const JASMINE = "#fbf7ec";
const FIREFLY = ["#eaf56e", "#ffd96a", "#d8f070"];

/** The tub's outline, radius against height, bottom to top, with two pressed ribs; squared off into a rounded oblong. */
const TUB: Array<[number, number]> = [
  [0, -0.33],
  [0.27, -0.33],
  [0.288, -0.322],
  [0.296, -0.305],
  [0.31, -0.235],
  [0.323, -0.215],
  [0.319, -0.198],
  [0.335, -0.06],
  [0.348, -0.036],
  [0.344, -0.02],
  [0.36, 0.08],
  [0.366, 0.095],
];
const SHAPE = { a: 1.55, b: 1, n: 3.2 };
/** Profile indices bounding the painted flower band. */
const BAND = [6, 9];
const SOIL_Y = 0.055;
/** The hoop: half-span across the tub, the height of its top. */
const HOOP = { z: 0.4, y0: 0.0, h: 1.08 };
const HOOK = v(0, HOOP.y0 + HOOP.h - 0.016, 0);
const IN_JAR = 14;
const OUT_OF_JAR = 8;

/** Painted tin: duck-egg teal, a band of coral flowers and cream daisies on leafy sprigs, chipped at the edges. */
function tinTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const n = TUB.length - 1;
  const yOf = (i: number) => (1 - i / n) * H;
  return canvasTexture(W, H, (ctx) => {
    const rand = seeded(311);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#8cc4b7");
    g.addColorStop(0.55, "#77b2a5");
    g.addColorStop(1, "#5a9286");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // brush strokes in the paint
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(20,60,55,0.06)";
      ctx.fillRect(rand() * W, rand() * H, 1, 6 + rand() * 18);
    }
    const top = yOf(BAND[1]);
    const bottom = yOf(BAND[0]);
    const mid = (top + bottom) / 2;
    ctx.fillStyle = "#f4ead2";
    for (const y of [top + 2, bottom - 3, yOf(n) + 6]) ctx.fillRect(0, y, W, 1.6);
    const cell = W / 8;
    for (let k = 0; k < 8; k++) {
      const cx = (k + 0.5) * cell;
      // sprigs curving out either side
      ctx.strokeStyle = "#4c7f5c";
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, mid);
        ctx.quadraticCurveTo(cx + dir * 18, mid - 12, cx + dir * 30, mid - 2);
        ctx.stroke();
        ctx.fillStyle = "#4c7f5c";
        for (const t of [0.45, 0.8]) {
          ctx.beginPath();
          ctx.ellipse(cx + dir * 30 * t, mid - 9 * t + 4, 5, 2.2, dir * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // the coral flower
      ctx.fillStyle = "#ec8b72";
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 6.5, mid + Math.sin(a) * 6.5, 5.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#c9604c";
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.fillRect(cx + Math.cos(a) * 4 - 0.6, mid + Math.sin(a) * 4 - 0.6, 1.2, 1.2);
      }
      ctx.fillStyle = "#f6c453";
      ctx.beginPath();
      ctx.arc(cx, mid, 3.4, 0, Math.PI * 2);
      ctx.fill();
      // cream daisies between
      const dx = cx + cell / 2;
      ctx.fillStyle = "#f7eedb";
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(dx + Math.cos(a) * 4, mid + 3 + Math.sin(a) * 4, 3.4, 1.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#e8a64a";
      ctx.beginPath();
      ctx.arc(dx, mid + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // wear: the paint chipped back to tin near the rim and the foot
    for (let i = 0; i < 70; i++) {
      const nearTop = rand() < 0.6;
      const y = nearTop ? rand() * 9 : H - rand() * 14;
      ctx.fillStyle = rand() < 0.8 ? "rgba(170,172,165,0.85)" : "rgba(138,90,58,0.6)";
      ctx.beginPath();
      ctx.ellipse(rand() * W, y, 1 + rand() * 3, 0.8 + rand() * 1.5, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function tubGeometry(): THREE.BufferGeometry {
  // the seam goes at the back, under the push handle
  return squircle(lathe(TUB, 36, -Math.PI / 2), SHAPE.a, SHAPE.b, SHAPE.n);
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

/** The hoop over the tub, in the YZ plane, from its right foot (t = 0) to its left (t = 1). */
class Hoop extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI;
    return target.set(0, HOOP.y0 + HOOP.h * Math.sin(a), HOOP.z * Math.cos(a));
  }
}

/** A vine winding round the hoop from its right foot up and over the top. */
class Vine extends THREE.Curve<THREE.Vector3> {
  hoop = new Hoop();
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const s = 0.03 + t * 0.7;
    const c = this.hoop.getPoint(s);
    const tan = this.hoop.getTangent(s);
    const side = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(tan, side);
    const phi = t * Math.PI * 2 * 9;
    return target.copy(c).addScaledVector(normal, Math.cos(phi) * 0.024).addScaledVector(side, Math.sin(phi) * 0.024);
  }
}

/** Soil, seedlings, tulsi, a marigold, the vine and its leaves and flowers, and the push handle's grip. */
function plantsGeometry(): THREE.BufferGeometry {
  const rand = seeded(2026);
  const parts: THREE.BufferGeometry[] = [];
  const soil = new THREE.CircleGeometry(0.354, 36);
  soil.rotateX(-Math.PI / 2);
  squircle(soil, SHAPE.a, SHAPE.b, SHAPE.n);
  soil.translate(0, SOIL_Y, 0);
  parts.push(paint(soil, SOIL));
  const leaf = leafGeometry();
  // rows of seedlings, leaving the middle clear under the jar
  for (const z of [-0.17, 0, 0.17]) {
    for (const x of [-0.4, -0.27, -0.14, 0.14, 0.27, 0.4]) {
      if (x === 0.4 && z !== 0) continue;
      if (x === -0.4 && z === 0) continue;
      const px = x + (rand() - 0.5) * 0.03;
      const pz = z + (rand() - 0.5) * 0.03;
      const h = 0.04 + rand() * 0.05;
      parts.push(paint(spoke(v(px, SOIL_Y, pz), v(px, SOIL_Y + h, pz), 0.004, 0.003, 3), "#5a8a3e"));
      const yaw = rand() * Math.PI;
      for (const turn of [0, Math.PI]) {
        parts.push(paint(place(leaf.clone(), v(px, SOIL_Y + h, pz), new THREE.Euler(0, yaw + turn, 0.45, "YXZ"), 0.55 + rand() * 0.25), LEAF[Math.floor(rand() * 3)]));
      }
    }
  }
  // two bushes of tulsi at the front corners
  for (const z of [-0.17, 0.17]) {
    for (let k = 0; k < 6; k++) {
      const puff = crumple(new THREE.IcosahedronGeometry(1, 0), 0.2, k);
      const s = 0.036 + rand() * 0.016;
      const p = v(0.4 + (rand() - 0.5) * 0.08, SOIL_Y + 0.05 + rand() * 0.08, z + (rand() - 0.5) * 0.08);
      parts.push(paint(place(puff, p, new THREE.Euler(rand() * 3, rand() * 3, 0), v(s, s * 0.85, s)), TULSI[k % 3]));
    }
  }
  // a marigold in flower at the back
  parts.push(paint(spoke(v(-0.4, SOIL_Y, 0), v(-0.41, SOIL_Y + 0.17, 0.01), 0.005, 0.004, 3), "#4f7f36"));
  for (const [dx, dy, dz, s] of [
    [-0.41, 0.19, 0.01, 0.036],
    [-0.37, 0.14, -0.03, 0.028],
  ]) {
    parts.push(paint(place(new THREE.DodecahedronGeometry(1, 0), v(dx, SOIL_Y + dy, dz), new THREE.Euler(0.4, 0.3, 0), v(s, s * 0.7, s)), "#f29a1e"));
  }
  for (let k = 0; k < 4; k++) {
    parts.push(paint(place(leaf.clone(), v(-0.4, SOIL_Y + 0.05 + k * 0.03, 0), new THREE.Euler(0, k * 1.7, 0.3, "YXZ"), 0.7), LEAF[k % 3]));
  }
  // the jasmine vine, its leaves and its small white flowers
  const vine = new Vine();
  parts.push(paint(tubeAlong(vine, 0.0045, 80, 3), "#4a6e33"));
  for (let k = 0; k < 30; k++) {
    const t = (k + 0.5) / 30;
    const p = vine.getPoint(t);
    const c = vine.hoop.getPoint(0.03 + t * 0.7);
    const out = p.clone().sub(c).normalize();
    const yaw = Math.atan2(-out.z, out.x);
    parts.push(paint(place(leaf.clone(), p, new THREE.Euler(0, yaw, Math.asin(Math.max(-1, Math.min(1, out.y))) - 0.3, "YXZ"), 0.5), LEAF[k % 3]));
    if (k % 3 === 1) {
      const flower = new THREE.CircleGeometry(0.013, 5);
      flower.lookAt(out);
      flower.translate(p.x + out.x * 0.012, p.y + out.y * 0.012, p.z + out.z * 0.012);
      parts.push(paint(flower, JASMINE));
    }
  }
  leaf.dispose();
  // the push handle's wooden grip
  parts.push(paint(spoke(v(-0.8, 0.42, -0.275), v(-0.8, 0.42, 0.275), 0.021, 0.021, 8), WOOD));
  return merge(parts);
}

/** Everything copper on the trolley itself: the rim, the hoop, the frame and axles, the handles, the watering can. */
function copperGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = TUB[TUB.length - 1];
  parts.push(tubeAlong(new Loop(top[0] * SHAPE.a, top[0] * SHAPE.b, SHAPE.n, top[1] + 0.002), 0.014, 56, 5, true));
  parts.push(tubeAlong(new Hoop(), 0.016, 48, 6));
  for (const side of [-1, 1]) {
    const rosette = axleLathe(
      [
        [0, -0.004],
        [0.03, -0.004],
        [0.032, 0.002],
        [0.02, 0.008],
        [0, 0.011],
      ],
      10,
    );
    if (side < 0) rosette.rotateY(Math.PI);
    rosette.translate(0, HOOP.y0 + 0.02, side * (HOOP.z - 0.012));
    parts.push(rosette);
  }
  // the ring the jar's chain hangs from
  const ring = new THREE.TorusGeometry(0.014, 0.004, 4, 10);
  ring.rotateY(Math.PI / 2);
  ring.translate(HOOK.x, HOOK.y - 0.004, 0);
  parts.push(ring);
  // a carrying loop at the front end
  parts.push(tube([v(0.552, 0.03, -0.09), v(0.6, 0.035, -0.08), v(0.625, 0.04, 0), v(0.6, 0.035, 0.08), v(0.552, 0.03, 0.09)], 0.008, 12, 4));
  // frame and axles
  for (const z of [-0.24, 0.24]) parts.push(spoke(v(-0.47, -0.34, z), v(0.47, -0.34, z), 0.011, 0.011, 6));
  for (const x of [-0.45, 0.45]) {
    parts.push(spoke(v(x, -0.54, -0.37), v(x, -0.54, 0.37), 0.014, 0.014, 6));
    for (const z of [-1, 1]) {
      parts.push(spoke(v(x - 0.07, -0.34, z * 0.24), v(x, -0.54, z * 0.3), 0.01, 0.01, 5));
      parts.push(spoke(v(x + 0.07, -0.34, z * 0.24), v(x, -0.54, z * 0.3), 0.01, 0.01, 5));
    }
  }
  // the push handle, rising from the back of the tub
  for (const z of [-1, 1]) {
    parts.push(tube([v(-0.54, 0.02, z * 0.22), v(-0.66, 0.16, z * 0.235), v(-0.76, 0.33, z * 0.25), v(-0.8, 0.42, z * 0.25)], 0.012, 16, 5));
  }
  // the watering can, hung by its handle from the grip
  const can: THREE.BufferGeometry[] = [];
  can.push(
    lathe(
      [
        [0, -0.1],
        [0.055, -0.1],
        [0.06, -0.09],
        [0.06, 0],
        [0.045, 0.03],
        [0.02, 0.04],
        [0, 0.04],
      ],
      10,
    ),
  );
  can.push(spoke(v(0.05, -0.07, 0), v(0.14, 0.03, 0), 0.009, 0.006, 5));
  const rose = new THREE.ConeGeometry(0.018, 0.025, 8, 1, true);
  rose.rotateZ(-Math.PI / 4);
  rose.translate(0.148, 0.04, 0);
  can.push(rose);
  can.push(tube([v(0.0, 0.04, 0), v(-0.03, 0.09, 0), v(-0.07, 0.05, 0), v(-0.062, -0.01, 0)], 0.006, 10, 4));
  for (const g of can) {
    g.rotateY(Math.PI / 2);
    g.translate(-0.8, 0.3, -0.08);
    parts.push(g);
  }
  return merge(parts.map((g) => paint(g, COPPER)));
}

function jarCopperGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const link = new THREE.TorusGeometry(0.012, 0.003, 3, 8);
  link.translate(0, -0.012, 0);
  parts.push(link);
  const link2 = new THREE.TorusGeometry(0.012, 0.003, 3, 8);
  link2.rotateY(Math.PI / 2);
  link2.translate(0, -0.032, 0);
  parts.push(link2);
  // the bail, from the lid's sides up to the chain
  parts.push(tube([v(-0.072, -0.11, 0), v(-0.05, -0.068, 0), v(0, -0.044, 0), v(0.05, -0.068, 0), v(0.072, -0.11, 0)], 0.0028, 12, 3));
  parts.push(
    lathe(
      [
        [0, -0.122],
        [0.068, -0.122],
        [0.07, -0.112],
        [0.065, -0.097],
        [0.04, -0.089],
        [0.012, -0.084],
        [0.012, -0.076],
        [0, -0.073],
      ],
      12,
    ),
  );
  parts.push(
    lathe(
      [
        [0.07, -0.41],
        [0.104, -0.404],
        [0.108, -0.372],
        [0.1, -0.366],
      ],
      14,
    ),
  );
  // four straps of the cage, following the glass
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = (
      [
        [0.068, -0.12],
        [0.086, -0.146],
        [0.103, -0.19],
        [0.107, -0.25],
        [0.105, -0.36],
        [0.1, -0.395],
      ] as Array<[number, number]>
    ).map(([r, y]) => v(c * r, y, s * r));
    parts.push(tube(pts, 0.003, 10, 3));
  }
  return merge(parts.map((g) => paint(g, COPPER)));
}

const GLASS: Array<[number, number]> = [
  [0, -0.4],
  [0.075, -0.4],
  [0.092, -0.39],
  [0.1, -0.36],
  [0.102, -0.25],
  [0.098, -0.19],
  [0.08, -0.15],
  [0.064, -0.135],
  [0.062, -0.118],
];

function glassGeometry(): THREE.BufferGeometry {
  return lathe(GLASS, 14);
}

/** A narrow sliver just outside the glass where the sky catches it: the Meadow has no reflections to do this. */
function glintGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    GLASS.slice(2, -1).map(([r, y]) => new THREE.Vector2(r * 1.012, y)),
    2,
    -0.9,
    0.32,
  );
}

function wheelTyreGeometry(): THREE.BufferGeometry {
  return paint(new THREE.TorusGeometry(0.183, 0.017, 6, 24), CREAM);
}

function wheelCopperGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TorusGeometry(0.163, 0.008, 4, 24));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const z = i % 2 === 0 ? 0.022 : -0.022;
    parts.push(spoke(v(Math.cos(a) * 0.02, Math.sin(a) * 0.02, z), v(Math.cos(a + 0.2) * 0.158, Math.sin(a + 0.2) * 0.158, 0), 0.0035, 0.0035, 3));
  }
  parts.push(
    axleLathe(
      [
        [0, -0.045],
        [0.022, -0.045],
        [0.026, -0.02],
        [0.026, 0.02],
        [0.02, 0.04],
        [0.01, 0.05],
        [0, 0.052],
      ],
      8,
    ),
  );
  return merge(parts.map((g) => paint(g, COPPER)));
}

/** Fireflies as soft points: where each one wanders, how fast, and how it blinks. */
function fireflyPaths(count: number, seed: number) {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    f: [0.4 + rand() * 0.6, 0.3 + rand() * 0.5, 0.4 + rand() * 0.6],
    p: [rand() * 6.3, rand() * 6.3, rand() * 6.3],
    blink: 0.6 + rand() * 1.4,
    phase: rand() * 6.3,
    color: new THREE.Color(FIREFLY[Math.floor(rand() * FIREFLY.length)]),
  }));
}

function pointsGeometry(count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  return g;
}

function pointsMaterial(size: number): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    map: glowTexture(),
    size,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function JarLantern() {
  const pivot = useSwing(0.36);
  const light = useRef<THREE.PointLight>(null);
  const res = useAssets(() => ({
    copper: jarCopperGeometry(),
    glass: glassGeometry(),
    glint: glintGeometry(),
    glintMat: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    flies: pointsGeometry(IN_JAR),
    paths: fireflyPaths(IN_JAR, 51),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.36 }),
    glassMat: new THREE.MeshStandardMaterial({
      color: "#eef7ef",
      emissive: "#d6ec8a",
      transparent: true,
      opacity: 0.3,
      roughness: 0.06,
      depthWrite: false,
    }),
    fliesMat: pointsMaterial(0.07),
  }));
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    res.glassMat.emissiveIntensity = glowAt(0.08, 0.45, t, 0.1);
    res.fliesMat.opacity = glowAt(0.7, 1, t, 0);
    res.glintMat.opacity = 0.32 * (1 - 0.6 * meadow.night);
    if (light.current) light.current.intensity = glowAt(0.45, 2.8, t, 0.1);
    const pos = res.flies.attributes.position as THREE.BufferAttribute;
    const col = res.flies.attributes.color as THREE.BufferAttribute;
    res.paths.forEach((f, i) => {
      pos.setXYZ(i, Math.sin(t * f.f[0] + f.p[0]) * 0.06, -0.265 + Math.sin(t * f.f[1] + f.p[1]) * 0.095, Math.sin(t * f.f[2] + f.p[2]) * 0.06);
      const b = Math.max(0.12, Math.sin(t * f.blink + f.phase)) ** 1.5;
      col.setXYZ(i, f.color.r * b, f.color.g * b, f.color.b * b);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <group ref={pivot}>
      <mesh geometry={res.copper} material={res.metal} castShadow />
      <points geometry={res.flies} material={res.fliesMat} frustumCulled={false} />
      <mesh geometry={res.glass} material={res.glassMat} renderOrder={2} />
      <mesh geometry={res.glint} material={res.glintMat} renderOrder={3} />
      <pointLight ref={light} position={[0, -0.26, 0]} color={JAR_LIGHT} distance={6} decay={2} />
      <Halo size={0.8} color="#f4e78e" day={0.22} position={[0, -0.26, 0]} />
    </group>
  );
}

/** The few that slip out at dusk and circle the cart. */
function LooseFireflies() {
  const res = useAssets(() => ({ geo: pointsGeometry(OUT_OF_JAR), paths: fireflyPaths(OUT_OF_JAR, 97), mat: pointsMaterial(0.11) }));
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const out = Math.max(0, (meadow.night - 0.3) / 0.7);
    res.mat.opacity = out;
    const pos = res.geo.attributes.position as THREE.BufferAttribute;
    const col = res.geo.attributes.color as THREE.BufferAttribute;
    res.paths.forEach((f, i) => {
      const a = t * f.f[0] * 0.35 + f.p[0];
      const r = 0.55 + 0.25 * Math.sin(t * f.f[2] + f.p[2]);
      pos.setXYZ(i, Math.cos(a) * r * 1.3, 0.75 + 0.35 * Math.sin(t * f.f[1] + f.p[1]), Math.sin(a) * r);
      const b = Math.max(0.05, Math.sin(t * f.blink + f.phase)) ** 1.5;
      col.setXYZ(i, f.color.r * b, f.color.g * b, f.color.b * b);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return <points geometry={res.geo} material={res.mat} frustumCulled={false} />;
}

/** Concept C in chassis space; `wheels` receives the four wheel groups for the parent to pose. */
export function FireflyTrolley({ wheels }: ConceptProps) {
  const res = useAssets(() => {
    const tin = tinTexture();
    return {
      tin,
      tub: tubGeometry(),
      plants: plantsGeometry(),
      copper: copperGeometry(),
      tyre: wheelTyreGeometry(),
      wheelCopper: wheelCopperGeometry(),
      tinMat: new THREE.MeshStandardMaterial({ map: tin, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide }),
      painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
      tyreMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.36 }),
    };
  });
  return (
    <group>
      <mesh geometry={res.tub} material={res.tinMat} castShadow receiveShadow />
      <mesh geometry={res.plants} material={res.painted} castShadow receiveShadow />
      <mesh geometry={res.copper} material={res.metal} castShadow />
      <Wheels wheels={wheels}>
        <mesh geometry={res.tyre} material={res.tyreMat} castShadow />
        <mesh geometry={res.wheelCopper} material={res.metal} castShadow />
      </Wheels>
      {/* drawn a size up on the hook, so the guardian light reads from the follow camera */}
      <group position={HOOK} scale={1.25}>
        <JarLantern />
      </group>
      <LooseFireflies />
    </group>
  );
}
