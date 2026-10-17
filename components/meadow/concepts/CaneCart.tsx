"use client";
/* eslint-disable react-hooks/immutability --
   The lantern's material is created once and its glow written in the frame loop (see kit.tsx). */
// Lantern Cart concept A, the cane basket cart: a deep oval basket of honey-coloured cane, heaped with marigolds,
// roses and jasmine like a flower seller's basket at the morning market, a marigold garland swagged round its rim. It
// rides on bentwood runners that sweep up at the front into a pull handle, on four wooden spoked wheels with iron
// tyres and brass caps. A walnut pole curls up from the back and over the flowers like a shepherd's crook, and from
// it hangs the guardian light: a pierced brass lantern whose little flowers and stars of light come up as dusk falls.
//
// Draw calls: basket, rim, frame, blossoms, brass, lantern, halo, and one per wheel. About 12.6k triangles in all; the
// preview (/cart-concepts) counts them live.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { merge, paint, seeded } from "@/components/meadow/parts";
import {
  axleLathe,
  canvasTexture,
  crumple,
  glowAt,
  Halo,
  lathe,
  Loop,
  place,
  spoke,
  tube,
  tubeAlong,
  useAssets,
  useSwing,
  v,
  Wheels,
  WHEEL_Y,
  type ConceptProps,
} from "@/components/meadow/concepts/kit";

export const CANE_LIGHT = "#ffb766";

const WALNUT = "#6a4326";
const WOOD = "#a0703f";
const IRON = "#35302b";
const BRASS = "#c49a52";
const MOUND = "#2e4d24";
const MARIGOLD = ["#f08c1a", "#f6a823", "#e5701b", "#f7bc35"];
const ROSE = ["#e2576e", "#ef8aa0", "#c9445c"];
const JASMINE = "#fbf5e6";
const LEAF = ["#3e6b30", "#4d7c3a", "#5b8c43"];

/** The basket's outline, radius against height, bottom to top; the lathe is stretched OVAL times along x. */
const BASKET: Array<[number, number]> = [
  [0, -0.36],
  [0.27, -0.36],
  [0.3, -0.345],
  [0.33, -0.25],
  [0.355, -0.12],
  [0.38, 0],
  [0.4, 0.1],
];
const OVAL = 1.5;
const RIM_Y = 0.105;
/** The heap of flowers: a squashed dome filling the basket's mouth. */
const HEAP = { x: 0.565, z: 0.375, h: 0.17, y: 0.07 };
/** Where the lantern hangs from the crook. */
const HOOK = v(-0.24, 1.37, 0);
const LANTERN_SCALE = 1.2;

/** The lantern's outline, bottom to top, hanging below its hook at the origin. */
const LANTERN: Array<[number, number]> = [
  [0, -0.47],
  [0.011, -0.455],
  [0.019, -0.43],
  [0.011, -0.405],
  [0.05, -0.39],
  [0.096, -0.37],
  [0.092, -0.352],
  [0.074, -0.345],
  [0.088, -0.31],
  [0.09, -0.27],
  [0.088, -0.23],
  [0.074, -0.198],
  [0.094, -0.186],
  [0.102, -0.155],
  [0.088, -0.118],
  [0.052, -0.088],
  [0.016, -0.066],
  [0.021, -0.052],
  [0.006, -0.036],
  [0, -0.028],
];
/** Profile indices of the pierced body and of the dome's ring of stars, for the jaali texture. */
const BODY = [7, 11];
const DOME = [12, 15];

function basketRadius(y: number): number {
  for (let i = 1; i < BASKET.length; i++) {
    const [r0, y0] = BASKET[i - 1];
    const [r1, y1] = BASKET[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
  }
  return BASKET[BASKET.length - 1][0];
}

function heapY(x: number, z: number): number {
  return HEAP.y + HEAP.h * Math.sqrt(Math.max(0, 1 - (x / HEAP.x) ** 2 - (z / HEAP.z) ** 2));
}

/** A close basket weave of flat cane weavers over round uprights, glossy honey on a dark ground. */
function caneTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = "#4e3318";
    ctx.fillRect(0, 0, w, h);
    const cw = 16;
    const ch = 8;
    for (let row = 0; row < h / ch; row++) {
      const y = row * ch;
      const g = ctx.createLinearGradient(0, y, 0, y + ch);
      g.addColorStop(0, "#a8733c");
      g.addColorStop(0.35, "#f0c98a");
      g.addColorStop(0.6, "#dcae6c");
      g.addColorStop(1, "#94612f");
      ctx.fillStyle = g;
      ctx.fillRect(0, y + 0.5, w, ch - 1);
      ctx.fillStyle = "rgba(255,244,220,0.35)";
      ctx.fillRect(0, y + 2, w, 1);
      for (let col = 0; col < w / cw; col++) {
        if ((row + col) % 2 === 0) continue;
        // the upright shows here; the weaver dips under it, shadowed either side
        const x = col * cw + cw / 2 - 3;
        ctx.fillStyle = "rgba(60,36,14,0.45)";
        ctx.fillRect(x - 2, y, 10, ch);
        const s = ctx.createLinearGradient(x, 0, x + 6, 0);
        s.addColorStop(0, "#80552a");
        s.addColorStop(0.45, "#d9a764");
        s.addColorStop(1, "#714822");
        ctx.fillStyle = s;
        ctx.fillRect(x, y - 0.5, 6, ch + 1);
      }
    }
  });
  tex.repeat.set(16, 2.2);
  return tex;
}

/** Cane binding wrapped round the rim: diagonal turns, lighter on the crown of each. */
function bindingTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, 32, (ctx, w, h) => {
    ctx.fillStyle = "#c08848";
    ctx.fillRect(0, 0, w, h);
    for (let i = -h; i < w + h; i += 8) {
      ctx.strokeStyle = "#6e4720";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,236,200,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(i + 4, 0);
      ctx.lineTo(i + 4 + h, h);
      ctx.stroke();
    }
  });
  tex.repeat.set(28, 1);
  return tex;
}

/**
 * The lantern's pierced brass (jaali): `lit` false paints the metal with its openings dark, true paints only the
 * openings, for the emissive map. A ring of six-petalled flowers and diamonds round the body, small stars round the
 * dome. Original pattern.
 */
function jaaliTexture(lit: boolean): THREE.CanvasTexture {
  const H = 256;
  const W = 256;
  const n = LANTERN.length - 1;
  const yOf = (index: number) => (1 - index / n) * H;
  const tex = canvasTexture(W, H, (ctx) => {
    if (lit) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#e6c47a");
      g.addColorStop(0.5, "#c69c4c");
      g.addColorStop(1, "#9a7232");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // engraved lines where the body meets the eave and the tray
      ctx.fillStyle = "rgba(70,44,14,0.5)";
      for (const i of [BODY[0], BODY[1], DOME[0], 5]) ctx.fillRect(0, yOf(i) - 1, W, 2);
    }
    ctx.fillStyle = lit ? "#fff2d8" : "#1d1307";
    const dot = (x: number, y: number, rx: number, ry = rx) => {
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const top = yOf(BODY[1]);
    const bottom = yOf(BODY[0]);
    const mid = (top + bottom) / 2;
    const cell = W / 6;
    for (let k = 0; k < 6; k++) {
      const cx = (k + 0.5) * cell;
      // a six-petalled flower
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        for (const ox of [-W, 0, W]) {
          ctx.beginPath();
          ctx.ellipse(cx + ox + Math.cos(a) * 6.5, mid + Math.sin(a) * 6.5, 4.2, 1.9, a, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      dot(cx, mid, 2.2);
      // a diamond between flowers, and dots along the top and bottom of the band
      const dx = cx + cell / 2;
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        ctx.moveTo(dx + ox, mid - 6);
        ctx.lineTo(dx + ox + 3, mid);
        ctx.lineTo(dx + ox, mid + 6);
        ctx.lineTo(dx + ox - 3, mid);
        ctx.fill();
      }
      for (let d = 0; d < 4; d++) {
        dot(cx - cell / 2 + (d + 0.5) * (cell / 4), top + 5, 1.5);
        dot(cx - cell / 2 + (d + 0.5) * (cell / 4), bottom - 5, 1.5);
      }
    }
    // the dome: twelve small four-pointed stars, and dots between
    const dy = (yOf(DOME[0]) + yOf(DOME[1])) / 2;
    for (let k = 0; k < 12; k++) {
      const cx = (k + 0.5) * (W / 12);
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        for (let p = 0; p < 8; p++) {
          const a = (p / 8) * Math.PI * 2;
          const r = p % 2 === 0 ? 5 : 1.6;
          ctx.lineTo(cx + ox + Math.sin(a) * r, dy - Math.cos(a) * r);
        }
        ctx.fill();
      }
      dot(cx + W / 24, dy + 8, 1.3);
    }
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A small leaf, base at the origin pointing along +x, folded along its rib. */
function leafGeometry(): THREE.BufferGeometry {
  const p = [0, 0, 0, 0.05, 0.012, 0.03, 0.11, 0, 0, 0, 0, 0, 0.11, 0, 0, 0.05, 0.012, -0.03];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

function basketGeometry(): THREE.BufferGeometry {
  // the seam goes at the back, behind the pole
  const g = lathe(BASKET, 32, -Math.PI / 2);
  g.scale(OVAL, 1, 1);
  g.computeVertexNormals();
  return g;
}

function rimGeometry(): THREE.BufferGeometry {
  const r = basketRadius(RIM_Y);
  const rim = tubeAlong(new Loop(r * OVAL + 0.005, r + 0.005, 2, RIM_Y), 0.032, 48, 6, true);
  // a thinner braided band round the belly
  const rb = basketRadius(-0.13);
  const band = tubeAlong(new Loop(rb * OVAL + 0.006, rb + 0.006, 2, -0.13), 0.013, 48, 5, true);
  return merge([rim, band]);
}

function frameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // bentwood runners, curling up at the back and sweeping up at the front into the pull handle
  for (const z of [-0.22, 0.22]) {
    const pts = [
      v(-0.64, -0.27, z),
      v(-0.55, -0.39, z),
      v(-0.3, -0.425, z),
      v(0.3, -0.425, z),
      v(0.58, -0.39, z * 0.95),
      v(0.76, -0.22, z * 0.82),
      v(0.84, -0.02, z * 0.72),
      v(0.86, 0.06, z * 0.7),
    ];
    parts.push(paint(tube(pts, 0.02, 32, 6), WALNUT));
  }
  parts.push(paint(spoke(v(0.86, 0.06, -0.175), v(0.86, 0.06, 0.175), 0.024, 0.024, 8), WOOD));
  for (const x of [-0.25, 0.25]) parts.push(paint(spoke(v(x, -0.43, -0.23), v(x, -0.43, 0.23), 0.015, 0.015, 6), WALNUT));
  // the rear crossbar the pole stands on
  parts.push(paint(spoke(v(-0.62, -0.3, -0.23), v(-0.62, -0.3, 0.23), 0.018, 0.018, 6), WALNUT));
  // axles and their iron hangers
  for (const x of [-0.45, 0.45]) {
    parts.push(paint(spoke(v(x, WHEEL_Y, -0.36), v(x, WHEEL_Y, 0.36), 0.016, 0.016, 6), IRON));
    for (const z of [-0.22, 0.22]) {
      parts.push(paint(spoke(v(x - 0.05, -0.425, z), v(x, WHEEL_Y, z), 0.011, 0.011, 5), IRON));
      parts.push(paint(spoke(v(x + 0.05, -0.425, z), v(x, WHEEL_Y, z), 0.011, 0.011, 5), IRON));
    }
  }
  // the crook: up from the back and over the flowers, ending in a curl
  const crook = [
    v(-0.62, -0.3, 0),
    v(-0.655, -0.05, 0),
    v(-0.69, 0.35, 0),
    v(-0.67, 0.85, 0),
    v(-0.57, 1.22, 0),
    v(-0.4, 1.4, 0),
    v(-0.2, 1.44, 0),
    v(-0.04, 1.38, 0),
    v(0.02, 1.27, 0),
    v(-0.035, 1.185, 0),
    v(-0.11, 1.21, 0),
    v(-0.1, 1.28, 0),
  ];
  parts.push(paint(tube(crook, 0.022, 56, 6), WALNUT));
  return merge(parts);
}

function brassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // collars where the crook meets the basket, and a strap to the rim
  for (const y of [-0.06, 0.12]) {
    const collar = new THREE.TorusGeometry(0.026, 0.008, 4, 10);
    collar.rotateX(Math.PI / 2);
    collar.translate(y < 0 ? -0.657 : -0.684, y, 0);
    parts.push(paint(collar, BRASS));
  }
  parts.push(paint(spoke(v(-0.68, 0.12, 0), v(-0.63, RIM_Y, 0), 0.009, 0.009, 5), BRASS));
  // a ferrule at the curl's end, and the lantern's hook
  parts.push(paint(place(new THREE.SphereGeometry(0.03, 8, 6), v(-0.1, 1.28, 0), new THREE.Euler()), BRASS));
  parts.push(paint(spoke(v(HOOK.x, 1.425, 0), v(HOOK.x, HOOK.y, 0), 0.006, 0.006, 4), BRASS));
  const ring = new THREE.TorusGeometry(0.018, 0.005, 4, 10);
  ring.translate(HOOK.x, HOOK.y - 0.006, 0);
  parts.push(paint(ring, BRASS));
  return merge(parts);
}

/** The heap: a leafy dome crowded with marigolds, roses and jasmine, leaves spilling over the rim, and the garland. */
function blossomGeometry(): THREE.BufferGeometry {
  const rand = seeded(1027);
  const parts: THREE.BufferGeometry[] = [];
  const dome = new THREE.SphereGeometry(1, 18, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(HEAP.x, HEAP.h, HEAP.z);
  dome.translate(0, HEAP.y, 0);
  parts.push(paint(dome, MOUND));

  // flowers scattered over the dome, none too close to another
  const placed: Array<[number, number, number]> = [];
  const spot = (minGap: number, edge = 0.92): [number, number] | null => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * edge;
      const x = Math.cos(a) * r * HEAP.x;
      const z = Math.sin(a) * r * HEAP.z;
      if (placed.every(([px, pz, g]) => Math.hypot(px - x, pz - z) > Math.max(g, minGap))) {
        placed.push([x, z, minGap]);
        return [x, z];
      }
    }
    return null;
  };
  // roses first, so the marigolds crowd round them
  for (let i = 0; i < 13; i++) {
    const s = spot(0.11);
    if (!s) continue;
    const [x, z] = s;
    const size = 0.05 + rand() * 0.015;
    const tilt = new THREE.Euler((z / HEAP.z) * 0.5, rand() * 6, (-x / HEAP.x) * 0.5);
    const y = heapY(x, z) - 0.012;
    const color = new THREE.Color(ROSE[Math.floor(rand() * ROSE.length)]);
    // an open ring of outer petals, a tighter cup inside it, and a bud at the heart, each a little deeper in tone
    const layers: Array<[number, number, number]> = [
      [1, 0.75, 1],
      [0.66, 0.95, 0.86],
      [0.36, 1.05, 0.72],
    ];
    layers.forEach(([s, h, tone], li) => {
      const cup = lathe(
        [
          [0.12, 0],
          [0.6, 0.25],
          [0.95, 0.68],
          [0.88, 1],
        ],
        li === 2 ? 5 : 7,
        rand() * 6,
      );
      parts.push(paint(place(cup, v(x, y + li * size * 0.08, z), tilt, v(size * s, size * h * 0.8, size * s)), color.clone().multiplyScalar(tone)));
    });
  }
  for (let i = 0; i < 40; i++) {
    const s = spot(0.074, 0.96);
    if (!s) continue;
    const [x, z] = s;
    const size = 0.044 + rand() * 0.018;
    const pom = crumple(new THREE.IcosahedronGeometry(1, 1), 0.22, i);
    const color = new THREE.Color(MARIGOLD[Math.floor(rand() * MARIGOLD.length)]).multiplyScalar(0.92 + rand() * 0.14);
    parts.push(paint(place(pom, v(x, heapY(x, z) + size * 0.25, z), new THREE.Euler(rand() * 3, rand() * 3, rand() * 3), v(size, size * 0.72, size)), color));
  }
  // jasmine in little clusters, in the gaps
  for (let i = 0; i < 9; i++) {
    const s = spot(0.05, 0.9);
    if (!s) continue;
    const [x, z] = s;
    for (let k = 0; k < 4; k++) {
      const bx = x + (rand() - 0.5) * 0.04;
      const bz = z + (rand() - 0.5) * 0.04;
      const bud = new THREE.OctahedronGeometry(0.012, 0);
      parts.push(paint(place(bud, v(bx, heapY(bx, bz) + 0.02, bz), new THREE.Euler(0, rand() * 3, 0), v(1, 1.6, 1)), JASMINE));
    }
  }
  // leaves spilling over the rim
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
    const x = Math.cos(a) * HEAP.x * 0.93;
    const z = Math.sin(a) * HEAP.z * 0.93;
    const yaw = -Math.atan2(z / HEAP.z, x / HEAP.x);
    const leaf = leafGeometry();
    parts.push(paint(place(leaf, v(x, HEAP.y + 0.03, z), new THREE.Euler(0, yaw, -0.35 - rand() * 0.3, "YXZ"), 0.9 + rand() * 0.5), LEAF[i % LEAF.length]));
  }

  // the garland: six swags of marigold beads round the rim, a jasmine bead every fifth, a short drop at each join
  const joins = [-0.2, 0.2, 0.5, 0.8, 1.2, 1.5, 1.8].map((k) => k * Math.PI);
  const outer = (theta: number, y: number) => {
    const r = basketRadius(y) + 0.03;
    return v(Math.cos(theta) * r * OVAL, y, Math.sin(theta) * r);
  };
  for (let s = 0; s < joins.length - 1; s++) {
    const t0 = joins[s];
    const t1 = joins[s + 1];
    let len = 0;
    for (let k = 0; k < 16; k++) len += outer(t0 + ((t1 - t0) * k) / 16, 0.05).distanceTo(outer(t0 + ((t1 - t0) * (k + 1)) / 16, 0.05));
    const count = Math.max(6, Math.round(len / 0.04));
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const y = 0.085 - 0.075 * 4 * t * (1 - t);
      const p = outer(t0 + (t1 - t0) * t, y);
      const white = k % 5 === 2;
      const bead = new THREE.IcosahedronGeometry(white ? 0.016 : 0.022, 0);
      parts.push(paint(place(bead, p, new THREE.Euler(k, s, 0)), white ? JASMINE : MARIGOLD[k % 2 === 0 ? 0 : 1]));
    }
    for (let d = 1; d <= 3; d++) {
      const p = outer(t0, 0.085 - d * 0.04);
      const bead = new THREE.IcosahedronGeometry(d === 3 ? 0.016 : 0.02, 0);
      parts.push(paint(place(bead, p, new THREE.Euler(d, 0, s)), d === 3 ? JASMINE : MARIGOLD[2]));
    }
  }
  return merge(parts);
}

function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    paint(
      axleLathe(
        [
          [0.2, -0.022],
          [0.2, 0.022],
        ],
        24,
      ),
      IRON,
    ),
  );
  parts.push(paint(new THREE.TorusGeometry(0.183, 0.019, 4, 24), WOOD));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push(paint(spoke(v(c * 0.03, s * 0.03, 0), v(c * 0.168, s * 0.168, 0), 0.012, 0.008, 5), WOOD));
  }
  parts.push(
    paint(
      axleLathe(
        [
          [0, -0.05],
          [0.03, -0.05],
          [0.042, -0.03],
          [0.042, 0.03],
          [0.032, 0.046],
        ],
        10,
      ),
      WALNUT,
    ),
  );
  parts.push(
    paint(
      axleLathe(
        [
          [0.032, 0.046],
          [0.026, 0.058],
          [0.012, 0.066],
          [0, 0.068],
        ],
        10,
      ),
      BRASS,
    ),
  );
  return merge(parts);
}

function CaneLantern() {
  const pivot = useSwing(0.42);
  const res = useAssets(() => {
    const map = jaaliTexture(false);
    const lit = jaaliTexture(true);
    return {
      geo: lathe(LANTERN, 12),
      map,
      lit,
      mat: new THREE.MeshStandardMaterial({ map, emissiveMap: lit, emissive: CANE_LIGHT, metalness: 0.35, roughness: 0.4 }),
    };
  });
  const light = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    res.mat.emissiveIntensity = glowAt(0.45, 3.4, t, 0.08);
    if (light.current) light.current.intensity = glowAt(0.5, 3.2, t, 0.06);
  });
  return (
    <group ref={pivot}>
      <mesh geometry={res.geo} material={res.mat} castShadow />
      <pointLight
        ref={light}
        position={[0, -0.27, 0]}
        color={CANE_LIGHT}
        distance={6}
        decay={2}
      />
      <Halo size={0.75} color={CANE_LIGHT} position={[0, -0.27, 0]} />
    </group>
  );
}

/** Concept A in chassis space; `wheels` receives the four wheel groups for the parent to pose. */
export function CaneCart({ wheels }: ConceptProps) {
  const res = useAssets(() => {
    const cane = caneTexture();
    const binding = bindingTexture();
    return {
      cane,
      binding,
      basket: basketGeometry(),
      rim: rimGeometry(),
      frame: frameGeometry(),
      brass: brassGeometry(),
      blossom: blossomGeometry(),
      wheel: wheelGeometry(),
      caneMat: new THREE.MeshStandardMaterial({ map: cane, roughness: 0.62, side: THREE.DoubleSide }),
      rimMat: new THREE.MeshStandardMaterial({ map: binding, roughness: 0.6 }),
      painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }),
      petals: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.38 }),
    };
  });
  return (
    <group>
      <mesh geometry={res.basket} material={res.caneMat} castShadow receiveShadow />
      <mesh geometry={res.rim} material={res.rimMat} castShadow />
      <mesh geometry={res.frame} material={res.painted} castShadow />
      <mesh geometry={res.brass} material={res.metal} castShadow />
      <mesh geometry={res.blossom} material={res.petals} castShadow receiveShadow />
      <Wheels wheels={wheels}>
        <mesh geometry={res.wheel} material={res.painted} castShadow />
      </Wheels>
      <group position={HOOK} scale={LANTERN_SCALE}>
        <CaneLantern />
      </group>
    </group>
  );
}
