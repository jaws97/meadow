// The mid and far garden, built once per owner. Painted textures (leaf
// clusters for the canopies and hedges, bark, weathered wood), the geometry of
// trunks, branches, hedge cores, florets, hoops, vines and fence boards, and
// the deterministic placement of every instance from LAYOUT and
// Rng(seed + "|garden"). Everything repeated is handed back as an InstanceSet
// (matrices, colours and a per-instance "volume normal" the foliage shader
// blends in so a cloud of flat cards shades like a rounded mass). Browser
// only: the textures draw on a canvas.
import * as THREE from "three";
import { LAYOUT, type Vec3 } from "@/lib/garden/layout";
import type { Quality } from "@/lib/garden/store";
import { makeLeafGeometry, makePetalGeometry, makeStemGeometry, stemCurve, type PetalShape } from "@/lib/plant/geometry";
import { makeCanvas, rgba, shiftHex, toTexture } from "@/lib/plant/textures";
import { Rng, clamp01, lerp, smoothstep, vnoise2 } from "@/lib/plant/prng";

// ---------------------------------------------------------------------------
// Budget

export interface BackdropBudget {
  /** leaf-cluster cards per tree canopy */
  canopyCards: number;
  /** card size against the canopy radius: fewer, larger cards on lite still close the crown over its core */
  canopyCardScale: number;
  /** segments round each canopy core lobe */
  coreSegments: number;
  /** cluster cards per square metre of hedge shell */
  hedgeCards: number;
  /** single leaves per square metre of hedge shell */
  hedgeLeaves: number;
  /** florets per flowering shrub */
  florets: number;
  /** leaves along the arch vines */
  vineLeaves: number;
  /** bloom clusters on the arch */
  bloomClusters: number;
  /** bokeh glints */
  bokeh: number;
  /** leaf tessellation [nu, nv] for the single leaves */
  leafTess: [number, number];
  /** the backdrop casts shadows (canopies, hedges, trunks, arch, fence) */
  shadows: boolean;
}

export const BACKDROP_BUDGET: Record<Quality, BackdropBudget> = {
  cinematic: {
    canopyCards: 320,
    canopyCardScale: 1,
    coreSegments: 18,
    hedgeCards: 44,
    hedgeLeaves: 64,
    florets: 56,
    vineLeaves: 240,
    bloomClusters: 9,
    bokeh: 36,
    leafTess: [3, 4],
    shadows: true,
  },
  balanced: {
    canopyCards: 210,
    canopyCardScale: 1.12,
    coreSegments: 16,
    hedgeCards: 30,
    hedgeLeaves: 30,
    florets: 36,
    vineLeaves: 140,
    bloomClusters: 7,
    bokeh: 30,
    leafTess: [2, 3],
    shadows: true,
  },
  lite: {
    canopyCards: 90,
    canopyCardScale: 1.6,
    coreSegments: 14,
    hedgeCards: 24,
    hedgeLeaves: 8,
    florets: 20,
    vineLeaves: 70,
    bloomClusters: 5,
    bokeh: 22,
    leafTess: [2, 3],
    shadows: false,
  },
};

// ---------------------------------------------------------------------------
// Instance sets

export interface InstanceSet {
  count: number;
  /** 16 floats per instance, column major */
  matrices: Float32Array;
  /** 3 floats per instance, linear rgb, multiplied into the material */
  colors: Float32Array;
  /** 3 floats per instance: the normal of the mass the instance belongs to, in the mesh's local space */
  normals: Float32Array;
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();
const tmpN = new THREE.Vector3();
const tmpX = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const WHITE = new THREE.Color(1, 1, 1);

class InstanceBuilder {
  private m: number[] = [];
  private c: number[] = [];
  private n: number[] = [];
  count = 0;

  push(position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3, color: THREE.Color, normal: THREE.Vector3) {
    tmpM.compose(position, quaternion, scale);
    const e = tmpM.elements;
    for (let i = 0; i < 16; i++) this.m.push(e[i]);
    this.c.push(color.r, color.g, color.b);
    this.n.push(normal.x, normal.y, normal.z);
    this.count++;
  }

  finish(): InstanceSet {
    return {
      count: this.count,
      matrices: new Float32Array(this.m),
      colors: new Float32Array(this.c),
      normals: new Float32Array(this.n),
    };
  }
}

/** Writes an InstanceSet into an InstancedMesh created with its count. */
export function applyInstances(mesh: THREE.InstancedMesh, set: InstanceSet) {
  const n = Math.min(mesh.instanceMatrix.count, set.count);
  for (let i = 0; i < n; i++) {
    tmpM.fromArray(set.matrices, i * 16);
    mesh.setMatrixAt(i, tmpM);
    tmpC.fromArray(set.colors, i * 3);
    mesh.setColorAt(i, tmpC);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/** A copy of `base` carrying the set's per-instance normals, for one InstancedMesh. */
function withInstanceNormals(base: THREE.BufferGeometry, set: InstanceSet): THREE.BufferGeometry {
  const g = base.clone();
  g.setAttribute("aMassNormal", new THREE.InstancedBufferAttribute(set.normals, 3));
  return g;
}

/** Quaternion turning +y onto `dir`, then rolled about that axis. */
function aimY(out: THREE.Quaternion, dir: THREE.Vector3, roll: number): THREE.Quaternion {
  out.setFromUnitVectors(UP, dir);
  tmpQ2.setFromAxisAngle(UP, roll);
  return out.multiply(tmpQ2);
}

/** Quaternion turning +z (a card's face) onto `dir`, then rolled about that axis. */
function aimZ(out: THREE.Quaternion, dir: THREE.Vector3, roll: number): THREE.Quaternion {
  out.setFromUnitVectors(FORWARD, dir);
  tmpQ2.setFromAxisAngle(FORWARD, roll);
  return out.multiply(tmpQ2);
}

/** Uniform direction on the unit sphere. */
function randomDir(rng: Rng, out: THREE.Vector3): THREE.Vector3 {
  const y = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

function jitterDir(rng: Rng, dir: THREE.Vector3, amount: number): THREE.Vector3 {
  randomDir(rng, tmpD);
  return dir.addScaledVector(tmpD, amount).normalize();
}

// ---------------------------------------------------------------------------
// Textures (painted once, cached for the life of the page like the ground's)

const texCache = new Map<string, THREE.CanvasTexture>();

function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const t = make();
  texCache.set(key, t);
  return t;
}

/** Linear (non-colour) data texture for bump maps, tiling. */
function toBumpTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

interface LeafPalette {
  dark: string;
  base: string;
  tip: string;
  lit: string;
  vein: string;
}

// Held a little below full saturation: real foliage is greyer than a paint-box green.
// Four tree palettes (a deep summer green, an olive, a cooler blue-green, a
// fresher light green) so no two neighbouring clusters print the same.
const TREE_LEAVES: readonly LeafPalette[] = [
  { dark: "#12301a", base: "#2b572d", tip: "#4e853b", lit: "#9ac35e", vein: "#79a857" },
  { dark: "#1a2f14", base: "#3a5626", tip: "#5f8238", lit: "#a8bf62", vein: "#8aa65a" },
  { dark: "#102c20", base: "#264f36", tip: "#45784a", lit: "#8fb978", vein: "#73a36a" },
  { dark: "#173514", base: "#336329", tip: "#5a9540", lit: "#a9cf6a", vein: "#88b85e" },
];
const HEDGE_LEAVES: readonly LeafPalette[] = [
  { dark: "#1f461e", base: "#377430", tip: "#6aaa4c", lit: "#abd067", vein: "#a0cc72" },
  { dark: "#1b3f1f", base: "#2f6a34", tip: "#5c9a4f", lit: "#9cc56c", vein: "#8fbf74" },
];
/** Canopy cards come in this many cluster prints, hedge cards in HEDGE_VARIANTS. */
export const CANOPY_VARIANTS = 4;
export const HEDGE_VARIANTS = 2;

/**
 * One painted leaf: base at (x, y), growing along `angle`, `round` 0 a
 * pointed lance, 1 a rounded boxwood leaf. Gradient dark base to lit tip, a
 * lighter upper margin and a midrib with side veins.
 */
function paintLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  wid: number,
  round: number,
  c0: string,
  c1: string,
  vein: string,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const ax = lerp(0.18, 0.1, round);
  const bx = lerp(0.62, 0.72, round);
  const ay = lerp(0.62, 0.74, round);
  const by = lerp(0.56, 0.72, round);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, rgba(c0, alpha));
  g.addColorStop(0.55, rgba(c0, alpha));
  g.addColorStop(1, rgba(c1, alpha));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * ax, -wid * ay, len * bx, -wid * by, len, 0);
  ctx.bezierCurveTo(len * bx, wid * by, len * ax, wid * ay, 0, 0);
  ctx.closePath();
  ctx.fill();
  // lit upper margin
  ctx.strokeStyle = rgba(c1, 0.45 * alpha);
  ctx.lineWidth = Math.max(1, wid * 0.07);
  ctx.beginPath();
  ctx.moveTo(len * 0.05, -wid * 0.08);
  ctx.bezierCurveTo(len * ax, -wid * ay * 0.92, len * bx, -wid * by * 0.9, len * 0.97, 0);
  ctx.stroke();
  // shaded lower margin
  ctx.strokeStyle = rgba("#0b1a0a", 0.35 * alpha);
  ctx.beginPath();
  ctx.moveTo(len * 0.05, wid * 0.08);
  ctx.bezierCurveTo(len * ax, wid * ay * 0.92, len * bx, wid * by * 0.9, len * 0.97, 0);
  ctx.stroke();
  // midrib and side veins
  ctx.strokeStyle = rgba(vein, 0.55 * alpha);
  ctx.lineWidth = Math.max(0.8, wid * 0.05);
  ctx.beginPath();
  ctx.moveTo(len * 0.03, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.stroke();
  ctx.strokeStyle = rgba(vein, 0.28 * alpha);
  ctx.lineWidth = Math.max(0.6, wid * 0.03);
  for (let k = 0; k < 4; k++) {
    const s = 0.18 + k * 0.17;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(len * s, 0);
      ctx.quadraticCurveTo(len * (s + 0.09), side * wid * 0.22, len * (s + 0.17), side * wid * 0.4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export type ClusterKind = "tree" | "hedge";

/**
 * A cluster of leaves on a transparent square, for the canopy and hedge
 * cards: a back layer of darker leaves, then lit ones over them, all growing
 * outward from the middle so the card has no hard edge. The leaves are small
 * and many, each a slightly different value, so a crown made of these cards
 * reads as foliage rather than as a print of a few large cut-out leaves.
 * `seed` picks the palette as well as the layout.
 */
export function leafClusterTexture(kind: ClusterKind, seed: number): THREE.CanvasTexture {
  return cached(`cluster:${kind}:${seed}`, () => {
    const W = 512;
    const c = makeCanvas(W, W);
    const ctx = c.getContext("2d")!;
    const rng = new Rng(seed * 7919 + (kind === "tree" ? 11 : 29));
    const pals = kind === "tree" ? TREE_LEAVES : HEDGE_LEAVES;
    const pal = pals[(seed - 1 + pals.length) % pals.length];
    // Trees: many small leaves in a loose patch, the ones at the rim pointing
    // outward; hedges: a tighter mat of small leaves, some rounded, some pointed.
    const n = kind === "tree" ? 185 : 120;
    const lenR: [number, number] = kind === "tree" ? [0.058, 0.092] : [0.06, 0.09];
    const baseR = kind === "tree" ? 0.34 : 0.36;
    const widK = kind === "tree" ? 0.55 : 0.62;
    const round = kind === "tree" ? 0.45 + 0.1 * (seed % 2) : 0.55 + 0.25 * (seed % 2);
    const cx = W / 2;
    const cy = W / 2;
    for (let layer = 0; layer < 3; layer++) {
      const count = Math.round(n * (layer === 0 ? 0.4 : layer === 1 ? 0.35 : 0.25));
      for (let i = 0; i < count; i++) {
        const ang = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * baseR * W;
        const off = rng.range(-1.1, 1.1) * (kind === "tree" ? 1.2 : 1);
        const bx = cx + Math.cos(ang + off) * r;
        const by = cy + Math.sin(ang + off) * r;
        const len = rng.range(lenR[0], lenR[1]) * W;
        const wid = len * widK * rng.range(0.85, 1.15);
        const t = rng.next();
        const lit = layer === 2 && t < 0.5;
        const c0 = layer === 0 ? pal.dark : layer === 1 ? pal.base : pal.base;
        const c1 = layer === 0 ? pal.base : layer === 1 ? pal.tip : lit ? pal.lit : pal.tip;
        // each leaf a touch lighter or darker than its neighbours
        const v = rng.range(-0.14, 0.14);
        paintLeaf(ctx, bx, by, ang, len, wid, round, shiftHex(c0, 0, v), shiftHex(c1, 0, v), pal.vein, layer === 0 ? 0.92 : 1);
      }
    }
    const tex = toTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Opaque, tiling mat of dark leaves for the hedge cores under the cards. */
export function foliageFillTexture(seed: number): THREE.CanvasTexture {
  return cached(`fill:${seed}`, () => {
    const W = 256;
    const c = makeCanvas(W, W);
    const ctx = c.getContext("2d")!;
    const rng = new Rng(seed * 104729 + 3);
    ctx.fillStyle = "#0f2a10";
    ctx.fillRect(0, 0, W, W);
    for (let i = 0; i < 150; i++) {
      const x = rng.next() * W;
      const y = rng.next() * W;
      const ang = rng.range(0, Math.PI * 2);
      const len = rng.range(0.08, 0.14) * W;
      const wid = len * 0.62;
      const t = rng.next();
      const c0 = t < 0.6 ? "#133512" : "#1d4a1b";
      const c1 = t < 0.6 ? "#235a22" : "#2f7a2a";
      for (const ox of [-W, 0, W]) {
        for (const oy of [-W, 0, W]) {
          paintLeaf(ctx, x + ox, y + oy, ang, len, wid, 0.8, c0, c1, "#4f8a3f", 1);
        }
      }
    }
    // shadow pockets
    for (let i = 0; i < 40; i++) {
      const x = rng.next() * W;
      const y = rng.next() * W;
      const r = 12 + rng.next() * 30;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(0,0,0,0.5)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return toTexture(c, 1);
  });
}

/**
 * Bark: vertical streaks with a wobble, cracks, and flecks of lichen. The
 * same strokes drawn as a height map give the bump. Tiles both ways; a tile
 * is about half a metre around and 1.3 m tall on the trunks.
 */
function paintBark(ctx: CanvasRenderingContext2D, W: number, H: number, seed: number, bump: boolean) {
  const rng = new Rng(seed * 2141 + 17);
  ctx.fillStyle = bump ? "#808080" : "#5a4b3d";
  ctx.fillRect(0, 0, W, H);
  if (!bump) {
    for (let i = 0; i < 40; i++) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      const r = 20 + rng.next() * 60;
      const warm = rng.next() < 0.5;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(warm ? "#7a6248" : "#3f3a36", 0.3));
      rg.addColorStop(1, rgba(warm ? "#7a6248" : "#3f3a36", 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else {
    // keep the random sequence in step with the albedo pass
    for (let i = 0; i < 40; i++) {
      rng.next();
      rng.next();
      rng.next();
      rng.next();
    }
  }
  ctx.lineCap = "round";
  // ridges and grooves running up the trunk, wrapping top to bottom
  for (let i = 0; i < 170; i++) {
    const x0 = rng.next() * W;
    const w = 1 + rng.next() * 3.5;
    const groove = rng.next() < 0.55;
    const alpha = 0.2 + rng.next() * 0.35;
    const albedo = groove ? rgba(rng.next() < 0.5 ? "#2c231b" : "#3a2e24", alpha) : rgba(rng.next() < 0.5 ? "#8a7762" : "#a08a70", alpha * 0.8);
    ctx.strokeStyle = bump ? (groove ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.9})`) : albedo;
    ctx.lineWidth = w;
    for (const oy of [-H, 0]) {
      ctx.beginPath();
      ctx.moveTo(x0, oy);
      const steps = 8;
      let x = x0;
      for (let s = 1; s <= steps; s++) {
        x += (rng.next() - 0.5) * 7;
        ctx.lineTo(x, oy + (H * s) / steps);
      }
      ctx.stroke();
    }
  }
  // cracks: short, dark, jagged
  for (let i = 0; i < 36; i++) {
    const x0 = rng.next() * W;
    const y0 = rng.next() * H;
    const len = 30 + rng.next() * 120;
    const alpha = 0.5 + rng.next() * 0.4;
    ctx.strokeStyle = bump ? `rgba(0,0,0,${alpha})` : rgba("#1a130d", alpha);
    ctx.lineWidth = 1 + rng.next() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    let x = x0;
    let y = y0;
    const steps = 5;
    for (let s = 0; s < steps; s++) {
      x += (rng.next() - 0.5) * 10;
      y += len / steps;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // lichen and moss flecks
  for (let i = 0; i < 160; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const r = 1 + rng.next() * 3.5;
    const moss = rng.next() < 0.35;
    const alpha = 0.18 + rng.next() * 0.3;
    ctx.fillStyle = bump ? `rgba(255,255,255,${alpha * 0.5})` : rgba(moss ? "#5c7a33" : "#a8b092", alpha);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r, rng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function barkTexture(seed: number): THREE.CanvasTexture {
  return cached(`bark:${seed}`, () => {
    const c = makeCanvas(256, 512);
    paintBark(c.getContext("2d")!, 256, 512, seed, false);
    return toTexture(c, 1);
  });
}

export function barkBumpTexture(seed: number): THREE.CanvasTexture {
  return cached(`barkBump:${seed}`, () => {
    const c = makeCanvas(256, 512);
    paintBark(c.getContext("2d")!, 256, 512, seed, true);
    return toBumpTexture(c);
  });
}

/** Weathered wood: silvered grey with the warm grain showing through, knots and checks. Tiles. */
export function woodTexture(seed: number): THREE.CanvasTexture {
  return cached(`wood:${seed}`, () => {
    const W = 256;
    const c = makeCanvas(W, W);
    const ctx = c.getContext("2d")!;
    const rng = new Rng(seed * 331 + 7);
    ctx.fillStyle = "#b5ada0";
    ctx.fillRect(0, 0, W, W);
    for (let i = 0; i < 30; i++) {
      const x = rng.next() * W;
      const y = rng.next() * W;
      const r = 20 + rng.next() * 70;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      const warm = rng.next() < 0.5;
      rg.addColorStop(0, rgba(warm ? "#8a6f52" : "#6f7570", 0.3));
      rg.addColorStop(1, rgba(warm ? "#8a6f52" : "#6f7570", 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.lineCap = "round";
    for (let i = 0; i < 120; i++) {
      const x0 = rng.next() * W;
      const dark = rng.next() < 0.7;
      ctx.strokeStyle = rgba(dark ? "#5a4c3e" : "#c9c0b0", 0.15 + rng.next() * 0.3);
      ctx.lineWidth = 0.7 + rng.next() * 1.8;
      for (const oy of [-W, 0]) {
        ctx.beginPath();
        ctx.moveTo(x0, oy);
        let x = x0;
        for (let s = 1; s <= 6; s++) {
          x += (rng.next() - 0.5) * 4;
          ctx.lineTo(x, oy + (W * s) / 6);
        }
        ctx.stroke();
      }
    }
    // a couple of knots
    for (let i = 0; i < 2; i++) {
      const x = rng.next() * W;
      const y = rng.next() * W;
      for (let k = 5; k >= 1; k--) {
        ctx.strokeStyle = rgba("#4a3a2c", 0.25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x, y, k * 3.5, k * 6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = rgba("#3d2f23", 0.6);
      ctx.beginPath();
      ctx.ellipse(x, y, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // checks and weathering specks
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rgba(rng.next() < 0.5 ? "#4f463c" : "#d6cfc2", 0.12 + rng.next() * 0.2);
      ctx.fillRect(rng.next() * W, rng.next() * W, 1, 2 + rng.next() * 6);
    }
    return toTexture(c, 1);
  });
}

// ---------------------------------------------------------------------------
// Geometry

/** A slightly cupped square card, unit size, face toward +z. */
export function makeCardGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, 0.06 - 0.28 * (x * x + y * y));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * Lumps and a root flare on a stem tube from makeStemGeometry, and UVs
 * rescaled so a bark tile is ~0.5 m around and `tileHeight` m tall.
 */
function roughenTube(
  g: THREE.BufferGeometry,
  tubular: number,
  radial: number,
  r0: number,
  r1: number,
  length: number,
  seed: number,
  lump: number,
  flare: number,
  tileHeight: number,
) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const around = Math.PI * (r0 + r1);
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const r = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const n1 = vnoise2(ca * 2.2 + seed, sa * 2.2 + t * 7);
      const n2 = vnoise2(ca * 5 + seed * 2.3, sa * 5 + t * 28);
      let d = r * lump * (n1 + 0.4 * n2);
      d += r * flare * Math.exp(-t * 11) * (0.55 + 0.45 * Math.cos(a * 3 + seed));
      pos.setXYZ(k, pos.getX(k) + nor.getX(k) * d, pos.getY(k) + nor.getY(k) * d, pos.getZ(k) + nor.getZ(k) * d);
      uv.setXY(k, (j / radial) * Math.max(1, Math.round(around / 0.5)), (t * length) / tileHeight);
    }
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

export function makeTrunkGeometry(height: number, r0: number, r1: number, dx: number, dz: number, seed: number): THREE.BufferGeometry {
  const tubular = 22;
  const radial = 12;
  const g = makeStemGeometry(height, r0, r1, dx, dz, tubular, radial);
  roughenTube(g, tubular, radial, r0, r1, height, seed, 0.11, 0.9, 1.3);
  return g;
}

export function makeBranchGeometry(length: number, r0: number, r1: number, dx: number, dz: number, seed: number): THREE.BufferGeometry {
  const tubular = 8;
  const radial = 7;
  const g = makeStemGeometry(length, r0, r1, dx, dz, tubular, radial);
  roughenTube(g, tubular, radial, r0, r1, length, seed, 0.08, 0.3, 0.8);
  return g;
}

/** Lumpiness of a hedge shell in a given unit direction; shared by the core and the cards on it. */
function lumpAt(dir: THREE.Vector3, seed: number): number {
  return 1 + 0.09 * vnoise2(dir.x * 2.4 + seed, dir.z * 2.4 + dir.y * 2.1) + 0.035 * vnoise2(dir.x * 6 + seed * 3, dir.z * 6 + dir.y * 5);
}

/** The dark heart of a hedge: a lumpy half ellipsoid, sunk a little below the lawn. */
export function makeHedgeCoreGeometry(rx: number, h: number, rz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2 + 0.3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    tmpD.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const l = lumpAt(tmpD, seed) * 0.97;
    p.setXYZ(i, tmpD.x * l * rx, tmpD.y * l * h, tmpD.z * l * rz);
  }
  p.needsUpdate = true;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const around = Math.PI * (rx + rz);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(2, Math.round(around / 0.3)), uv.getY(i) * Math.max(1, Math.round(h / 0.3)));
  uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The open form of a petal from makePetalGeometry as plain geometry. */
function openPetalGeometry(shape: PetalShape, seed: number, nu: number, nv: number): THREE.BufferGeometry {
  const bud = makePetalGeometry(shape, seed, nu, nv);
  const g = new THREE.BufferGeometry();
  // makePetalGeometry always stores the open form as morph target 0
  const open = bud.morphAttributes.position?.[0] ?? bud.getAttribute("position");
  const openNormal = bud.morphAttributes.normal?.[0] ?? bud.getAttribute("normal");
  g.setAttribute("position", open.clone());
  g.setAttribute("normal", openNormal.clone());
  g.setAttribute("uv", bud.getAttribute("uv").clone());
  const idx = bud.getIndex();
  if (idx) g.setIndex(idx.clone());
  bud.dispose();
  return g;
}

/** Concatenates indexed geometries that share position, normal and uv attributes. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const part of parts) {
    const base = pos.length / 3;
    const p = part.getAttribute("position");
    const n = part.getAttribute("normal");
    const u = part.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const index = part.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    part.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A small open flower: `petals` open petals around +y, base at the origin. */
export function makeFloretGeometry(shape: PetalShape, petals: number, open: number, seed: number, nu = 3, nv = 4): THREE.BufferGeometry {
  const rng = new Rng(seed * 61 + 5);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < petals; k++) {
    const g = openPetalGeometry(shape, seed * 3 + k, nu, nv);
    tmpQ.setFromAxisAngle(UP, (k / petals) * Math.PI * 2 + rng.range(-0.12, 0.12));
    tmpQ2.setFromAxisAngle(tmpX.set(1, 0, 0), open + rng.range(-0.1, 0.1));
    tmpQ.multiply(tmpQ2);
    tmpM.makeRotationFromQuaternion(tmpQ);
    g.applyMatrix4(tmpM);
    parts.push(g);
  }
  // a tiny raised centre
  const centre = new THREE.SphereGeometry(shape.width * 0.22, 5, 4);
  centre.translate(0, shape.width * 0.08, 0);
  const uvC = centre.getAttribute("uv") as THREE.BufferAttribute;
  // the centre samples the petal texture's dark base
  for (let i = 0; i < uvC.count; i++) uvC.setXY(i, 0.5, 0.02);
  parts.push(centre);
  return mergeGeometries(parts);
}

/**
 * A board: a convex profile (CCW, in the x-y plane, metres) extruded along z.
 * Wood grain runs along y unless `grainAlongX`; a grain tile is 0.3 m.
 */
export function makeBoardGeometry(profile: ReadonlyArray<readonly [number, number]>, depth: number, grainAlongX = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const TILE = 0.3;
  const hz = depth / 2;
  const n = profile.length;
  const capUv = (x: number, y: number) => (grainAlongX ? uv.push(y / TILE, x / TILE) : uv.push(x / TILE, y / TILE));
  // front cap (+z) and back cap (-z)
  for (const side of [1, -1]) {
    const start = pos.length / 3;
    for (const [x, y] of profile) {
      pos.push(x, y, side * hz);
      nor.push(0, 0, side);
      capUv(x, y);
    }
    for (let i = 1; i < n - 1; i++) {
      if (side > 0) idx.push(start, start + i, start + i + 1);
      else idx.push(start, start + i + 1, start + i);
    }
  }
  // sides
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = profile[i];
    const [x1, y1] = profile[(i + 1) % n];
    const ex = x1 - x0;
    const ey = y1 - y0;
    const el = Math.hypot(ex, ey) || 1;
    const nx = ey / el;
    const ny = -ex / el;
    const start = pos.length / 3;
    const corners: [number, number, number, number][] = [
      [x0, y0, -hz, s],
      [x1, y1, -hz, s + el],
      [x1, y1, hz, s + el],
      [x0, y0, hz, s],
    ];
    for (const [x, y, z, along] of corners) {
      pos.push(x, y, z);
      nor.push(nx, ny, 0);
      if (grainAlongX) uv.push(along / TILE, (z + hz) / TILE);
      else uv.push((z + hz) / TILE, along / TILE);
    }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    s += el;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Picket or post profile: a house shape, unit height, pointed top. */
function picketProfile(w: number, tip: number): [number, number][] {
  return [
    [-w / 2, 0],
    [w / 2, 0],
    [w / 2, 1 - tip],
    [0, 1],
    [-w / 2, 1 - tip],
  ];
}

/** A bentwood hoop: half a torus in the x-y plane, knobbly, from +x over the top to -x. */
export function makeHoopGeometry(radius: number, tube: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 7, 44, Math.PI);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const d = tube * (0.2 * vnoise2(u * 18 + seed, v * 3) + 0.08 * vnoise2(u * 50, v * 6 + seed));
    p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
    uv.setXY(i, v, (u * Math.PI * radius) / 0.3);
  }
  p.needsUpdate = true;
  uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Palettes

export interface BloomPalette {
  base: string;
  mid: string;
  tip: string;
  vein: string;
}

const hsl = { h: 0, s: 0, l: 0 };

/**
 * The climbing blooms on the arch go with the hero: wisteria lilac beside a
 * warm red, gold or orange flower; apricot and shell pink beside a white or
 * cool one. The owner's seed picks between the two candidates of each pair.
 */
export function climbingBloomPalette(heroHex: string, rng: Rng): BloomPalette {
  tmpC.set(heroHex).getHSL(hsl);
  const pale = hsl.s < 0.3 || hsl.l > 0.85;
  const warm = hsl.h < 0.17 || hsl.h > 0.83;
  const lilac: BloomPalette[] = [
    { base: "#6e4fa8", mid: "#b79be0", tip: "#ece2f8", vein: "#d7c6ee" },
    { base: "#5a4a9c", mid: "#9f90d6", tip: "#e4e0f6", vein: "#cfc8ec" },
  ];
  const apricot: BloomPalette[] = [
    { base: "#d8743f", mid: "#ffb088", tip: "#fff0e0", vein: "#ffd3b8" },
    { base: "#d26a7e", mid: "#f7a8bd", tip: "#fff2f4", vein: "#fbd0da" },
  ];
  return rng.pick(pale || !warm ? apricot : lilac);
}

/** The small pale flowers on the shrubs: cream, shell or primrose. */
export function shrubFloretPalette(rng: Rng): BloomPalette {
  return rng.pick<BloomPalette>([
    { base: "#e8d6a8", mid: "#fff6e6", tip: "#ffffff", vein: "#f2e6cc" },
    { base: "#e6b8c0", mid: "#fde7ec", tip: "#ffffff", vein: "#f6d8de" },
    { base: "#e3cf78", mid: "#fff3b8", tip: "#fffbe8", vein: "#f4e8a8" },
  ]);
}

/** A near-white tint, warm (yellowish) for t > 0 and cool (bluish) for t < 0. */
function foliageTint(out: THREE.Color, t: number): THREE.Color {
  out.copy(WHITE);
  if (t > 0) out.lerp(tmpC2.set("#c8d27a"), t);
  else out.lerp(tmpC2.set("#9cc4c4"), -t);
  return out;
}

// ---------------------------------------------------------------------------
// Assets
//
// Everything repeated across the garden is gathered into one draw per kind:
// one mesh for every trunk and branch, one for every hedge core, one
// InstancedMesh per foliage kind (canopy cards per texture, hedge cards, hedge
// leaves, shrub florets) with world-space instances. The shadow pass then
// costs as little as the colour pass.

export interface Instanced {
  set: InstanceSet;
  /** the base geometry with this set's per-instance mass normals attached */
  geometry: THREE.BufferGeometry;
}

export interface Canopy {
  center: THREE.Vector3;
  radius: number;
}

export interface ArchAssets {
  center: THREE.Vector3;
  yaw: number;
  legHeight: number;
  /** spacing between the two hoops */
  depth: number;
  hoop: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  legs: InstanceSet;
  rung: THREE.BufferGeometry;
  rungs: InstanceSet;
  /** every vine, one tube geometry */
  vines: THREE.BufferGeometry;
  leaves: Instanced;
  blooms: Instanced;
  bloomPalette: BloomPalette;
}

export interface FenceAssets {
  picket: THREE.BufferGeometry;
  pickets: InstanceSet;
  post: THREE.BufferGeometry;
  posts: InstanceSet;
  rail: THREE.BufferGeometry;
  rails: InstanceSet;
}

export interface BackdropAssets {
  /** every trunk and branch, world space */
  wood: THREE.BufferGeometry;
  /** the opaque inner volume of every canopy, world space */
  canopyCores: THREE.BufferGeometry;
  /** canopy cards, one set per cluster print (texture seeds 1..CANOPY_VARIANTS) */
  canopies: Instanced[];
  canopyShapes: Canopy[];
  /** every hedge and shrub core, world space */
  hedgeCores: THREE.BufferGeometry;
  /** hedge cards, one set per cluster print (texture seeds 1..HEDGE_VARIANTS) */
  hedgeCards: Instanced[];
  hedgeLeaves: Instanced;
  shrubFlorets: Instanced;
  shrubFloretPalette: BloomPalette;
  arch: ArchAssets;
  fence: FenceAssets;
  /** bokeh glints: position, size, kind (0 day, 1 night) and seed per point */
  bokeh: THREE.BufferGeometry;
  budget: BackdropBudget;
  dispose(): void;
}

function instanced(base: THREE.BufferGeometry, set: InstanceSet): Instanced {
  return { set, geometry: withInstanceNormals(base, set) };
}

// --- trees ------------------------------------------------------------------

interface Lobe {
  c: THREE.Vector3;
  r: number;
}

/** A lumpy ball for a canopy core lobe, unit radius before scaling. */
function makeCoreLobeGeometry(segments: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, segments, Math.max(6, Math.round(segments * 0.7)));
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    tmpD.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const l =
      1 +
      0.2 * vnoise2(tmpD.x * 2.1 + seed, tmpD.z * 2.1 + tmpD.y * 1.7) +
      0.08 * vnoise2(tmpD.x * 5 + seed * 2, tmpD.y * 5 - tmpD.z * 3);
    p.setXYZ(i, tmpD.x * l, tmpD.y * l, tmpD.z * l);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * One tree: a leaning, lumpy trunk with branches reaching out and up into the
 * canopy, appended to `wood` in world space. The crown is built on those
 * branches: a lobe of foliage at the tip of each, more at the crown's top and
 * in its lower skirt, so the leaves are carried by the tree instead of
 * floating round it. Each lobe has an opaque, dark core (appended to
 * `cores`), the way a real crown is dense inside, and leaf-cluster cards on
 * its shell (appended to the canopy builder of its texture), so the only
 * places the sky shows through are the two deliberate holes. The upper crown
 * is thinned a little so more cards dress the underside, which the camera
 * looks up at.
 */
function buildTree(
  spec: (typeof LAYOUT.trees)[number],
  rng: Rng,
  budget: BackdropBudget,
  wood: THREE.BufferGeometry[],
  cores: THREE.BufferGeometry[],
  cards: InstanceBuilder[],
): Canopy {
  const position = new THREE.Vector3(...spec.position);
  const scale = spec.height / 5.2;
  const r0 = rng.range(0.17, 0.23) * scale;
  const r1 = rng.range(0.06, 0.08) * scale;
  const dx = rng.range(-0.3, 0.3) * scale;
  const dz = rng.range(-0.25, 0.25) * scale;
  const seed = rng.range(0, 100);
  const trunkLength = spec.height * 0.78;
  const trunk = makeTrunkGeometry(trunkLength, r0, r1, dx, dz, seed);
  trunk.translate(position.x, position.y, position.z);
  wood.push(trunk);
  const curve = stemCurve(trunkLength, dx, dz);

  const R = spec.canopyR;
  const center = new THREE.Vector3(position.x + dx * 0.6, spec.canopyY, position.z + dz * 0.6);
  const lobes: Lobe[] = [];
  /** Adds a lobe round a world point, pulled inside the crown's sphere. */
  const addLobe = (world: THREE.Vector3, r: number) => {
    const c = world.clone().sub(center);
    const reach = R * 1.05 - r;
    if (c.length() > reach) c.setLength(Math.max(0, reach));
    lobes.push({ c, r });
  };

  const nBranches = rng.int(5, 7);
  const tip = new THREE.Vector3();
  for (let b = 0; b < nBranches; b++) {
    const t = rng.range(0.38, 0.9);
    const at = curve.getPoint(t);
    const rAt = lerp(r0, r1, t);
    const yaw = (b / nBranches) * Math.PI * 2 + rng.range(-0.5, 0.5);
    // the lower limbs reach out wider, the upper ones climb
    const pitch = lerp(0.42, 1.0, (t - 0.38) / 0.52) + rng.range(-0.12, 0.12);
    const dir = tmpD.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).normalize();
    const length = rng.range(1.0, 1.8) * scale;
    const bdx = rng.range(-0.15, 0.15);
    const bdz = rng.range(-0.1, 0.25);
    const branch = makeBranchGeometry(length, rAt * 0.6, 0.02 * scale, bdx, bdz, seed + b);
    aimY(tmpQ, dir, rng.range(0, Math.PI * 2));
    tmpP.copy(position).add(at).addScaledVector(dir, rAt * 0.35);
    tmpM.compose(tmpP, tmpQ, tmpS.setScalar(1));
    branch.applyMatrix4(tmpM);
    wood.push(branch);
    // a big lobe of foliage round the branch's tip; neighbouring lobes
    // overlap, so the crown is one mass with a billowing outline
    tip.set(bdx, length, bdz).applyQuaternion(tmpQ).add(tmpP);
    addLobe(tip, rng.range(0.46, 0.6) * R);
  }
  // the crown's top over the trunk, and a low skirt that brings the leaves down round it
  tip.copy(position).add(curve.getPoint(1));
  addLobe(tip, rng.range(0.52, 0.64) * R);
  const skirt = 2;
  for (let l = 0; l < skirt; l++) {
    const a = rng.range(0, Math.PI * 2) + l * Math.PI;
    tip.set(Math.cos(a) * R * 0.45, -R * rng.range(0.3, 0.45), Math.sin(a) * R * 0.45).add(center);
    addLobe(tip, rng.range(0.42, 0.52) * R);
  }

  // Two thin places near the crown's rim, where the core gives way and the
  // cards thin out, so the sky glints through and the sun gets to the lawn.
  // The cards are thinned there rather than removed, so no core is ever bared.
  const holes: Lobe[] = [];
  for (let h = 0; h < 2; h++) {
    randomDir(rng, tmpD);
    tmpD.y = Math.abs(tmpD.y) * 0.6 + 0.1;
    tmpD.normalize();
    holes.push({ c: tmpD.clone().multiplyScalar(rng.range(0.6, 0.85) * R), r: rng.range(0.22, 0.3) * R });
  }

  // The cores: each lobe's dark heart, shrunk clear of the holes and well inside the cards.
  // Cores fill most of each lobe, so the crown is dense inside and the sky
  // shows only at its deliberate holes and its rim, not as lace all through it.
  lobes.forEach((lobe, i) => {
    let rc = lobe.r * 0.82;
    for (const hole of holes) rc = Math.min(rc, lobe.c.distanceTo(hole.c) - hole.r);
    if (rc < lobe.r * 0.3) return;
    const g = makeCoreLobeGeometry(budget.coreSegments, seed + i * 3.1);
    g.scale(rc, rc * 0.86, rc);
    g.translate(center.x + lobe.c.x, center.y + lobe.c.y, center.z + lobe.c.z);
    cores.push(g);
  });

  const tint = foliageTint(new THREE.Color(), rng.range(-0.32, 0.35));
  const n = Math.round(budget.canopyCards * ("density" in spec ? spec.density : 1));
  const cardScale = budget.canopyCardScale;
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 4; tries++) {
    const lobe = lobes[rng.int(0, lobes.length - 1)];
    randomDir(rng, tmpD);
    const rr = rng.range(0.8, 1.06);
    tmpP.copy(lobe.c).addScaledVector(tmpD, rr * lobe.r);
    if (tmpP.y > R * 0.25 && rng.next() < 0.3) continue;
    if (holes.some((hole) => tmpP.distanceTo(hole.c) < hole.r) && rng.next() < 0.65) continue;
    // a card buried deep inside a neighbouring lobe is never seen: spend it on the surface
    if (lobes.some((o) => o !== lobe && tmpP.distanceTo(o.c) < o.r * 0.7)) continue;
    placed++;
    // face outward from its lobe, leaning toward the canopy's own outward direction
    tmpN.copy(tmpP).normalize();
    const face = tmpD.multiplyScalar(0.65).addScaledVector(tmpN, 0.35).normalize();
    jitterDir(rng, face, 0.35);
    aimZ(tmpQ, face, rng.range(0, Math.PI * 2));
    const s = R * rng.range(0.22, 0.34) * cardScale;
    tmpS.set(rng.next() < 0.5 ? -s : s, s, s);
    const depthShade = lerp(0.62, 1.08, smoothstep(0.8, 1.06, rr));
    const heightShade = lerp(0.78, 1.15, smoothstep(-R, R, tmpP.y));
    // each cluster its own small shift of hue and value, as sun and age vary a real crown
    tmpC.copy(tint).multiply(foliageTint(tmpC2, rng.range(-0.18, 0.18)));
    tmpC.multiplyScalar(depthShade * heightShade * rng.range(0.86, 1.1));
    // the volume normal blends the lobe's and the whole canopy's outward directions
    tmpN.multiplyScalar(0.45).addScaledVector(tmpD, 0.55).normalize();
    cards[rng.int(0, cards.length - 1)].push(tmpP.add(center), tmpQ, tmpS, tmpC, tmpN);
  }
  return { center, radius: R };
}

// --- hedges and shrubs ------------------------------------------------------

interface MassSpec {
  center: Vec3;
  rx: number;
  rz: number;
  height: number;
  /** carries small pale flowers */
  flowers: boolean;
  /** 0..1 density scale against the budget */
  density: number;
}

/** Surface of the upper half of an ellipsoid with semi-axes a, b, c (Thomsen). */
function halfEllipsoidArea(a: number, b: number, c: number): number {
  const p = 1.6075;
  const ab = Math.pow(a * b, p);
  const ac = Math.pow(a * c, p);
  const bc = Math.pow(b * c, p);
  return (4 * Math.PI * Math.pow((ab + ac + bc) / 3, 1 / p)) / 2;
}

interface MassBuilders {
  cores: THREE.BufferGeometry[];
  cards: InstanceBuilder[];
  leaves: InstanceBuilder;
  florets: InstanceBuilder;
}

/**
 * One hedge or shrub: a lumpy dark core with leaf-cluster cards on its shell,
 * single leaves fuzzing the silhouette and, when it flowers, small pale
 * florets over its top. Everything is appended in world space.
 */
function buildMass(spec: MassSpec, rng: Rng, budget: BackdropBudget, out: MassBuilders) {
  const { rx, rz, height: h } = spec;
  const seed = rng.range(0, 100);
  const center = new THREE.Vector3(...spec.center);
  const core = makeHedgeCoreGeometry(rx, h, rz, seed);
  core.translate(center.x, center.y, center.z);
  out.cores.push(core);
  const area = halfEllipsoidArea(rx, h, rz);
  // each hedge its own green, from a yellowish privet to a blue-green yew
  const tint = foliageTint(new THREE.Color(), rng.range(-0.42, 0.34));
  const cardSize = clamp01(0.24 * Math.sqrt(h / 0.9)) + 0.02;

  const sample = (lift: number) => {
    const y = rng.range(-0.04, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    tmpD.set(Math.cos(a) * r, y, Math.sin(a) * r);
    const l = lumpAt(tmpD, seed) * lift;
    tmpP.set(tmpD.x * l * rx, tmpD.y * l * h, tmpD.z * l * rz);
    tmpN.set(tmpD.x / rx, tmpD.y / h, tmpD.z / rz).normalize();
  };

  const nCards = Math.round(area * budget.hedgeCards * spec.density);
  for (let i = 0; i < nCards; i++) {
    sample(rng.range(0.9, 1.04));
    const face = tmpX.copy(tmpN);
    jitterDir(rng, face, 0.45);
    aimZ(tmpQ, face, rng.range(0, Math.PI * 2));
    const s = cardSize * rng.range(0.8, 1.25);
    tmpS.set(rng.next() < 0.5 ? -s : s, s, s);
    const shade = lerp(0.72, 1.12, smoothstep(0.05, 1, tmpP.y / h)) * rng.range(0.88, 1.08);
    tmpC.copy(tint).multiplyScalar(shade);
    out.cards[rng.int(0, out.cards.length - 1)].push(tmpP.add(center), tmpQ, tmpS, tmpC, tmpN);
  }

  const nLeaves = Math.round(area * budget.hedgeLeaves * spec.density);
  for (let i = 0; i < nLeaves; i++) {
    sample(rng.range(0.98, 1.08));
    const grow = tmpX.copy(tmpN);
    jitterDir(rng, grow, 0.7);
    aimY(tmpQ, grow, rng.range(0, Math.PI * 2));
    const s = rng.range(0.75, 1.3);
    tmpS.set(s, s, s);
    const top = smoothstep(0.1, 1, tmpP.y / h);
    const shade = lerp(0.7, 1.15, top) * rng.range(0.85, 1.1);
    tmpC.copy(tint).multiplyScalar(shade);
    if (rng.next() < 0.18) tmpC.lerp(tmpC2.set("#d8e06a"), 0.35 * top);
    out.leaves.push(tmpP.add(center), tmpQ, tmpS, tmpC, tmpN);
  }

  if (spec.flowers) {
    const n = Math.round(budget.florets * spec.density);
    for (let i = 0; i < n; i++) {
      sample(rng.range(1.03, 1.08));
      if (tmpP.y < h * 0.25) continue;
      const grow = tmpX.copy(tmpN);
      jitterDir(rng, grow, 0.5);
      aimY(tmpQ, grow, rng.range(0, Math.PI * 2));
      const s = rng.range(0.8, 1.25);
      tmpS.set(s, s, s);
      tmpC.setScalar(rng.range(0.85, 1));
      out.florets.push(tmpP.add(center), tmpQ, tmpS, tmpC, tmpN);
    }
  }
}

// --- arch -------------------------------------------------------------------

interface VineSpec {
  /** which hoop (0 back, 1 front) the vine climbs */
  hoop: number;
  s0: number;
  s1: number;
  turns: number;
  radius: number;
  /** how far from the hoop the spiral sits */
  loose: number;
}

const VINES: readonly VineSpec[] = [
  { hoop: 0, s0: 0, s1: 0.82, turns: 7, radius: 0.011, loose: 0.012 },
  { hoop: 1, s0: 0.18, s1: 1, turns: 6, radius: 0.01, loose: 0.014 },
  { hoop: 0, s0: 0.5, s1: 1, turns: 5, radius: 0.008, loose: 0.03 },
  { hoop: 1, s0: 0, s1: 0.45, turns: 5, radius: 0.008, loose: 0.028 },
];

/**
 * Position on the arch frame at `s`: up the +x leg (s 0..L), over the hoop
 * and down the -x leg (s 1-L..1). Fills `out` and the outward radial in `rad`.
 */
function archPoint(s: number, R: number, legH: number, out: THREE.Vector3, rad: THREE.Vector3) {
  const L = legH / (2 * legH + Math.PI * R);
  if (s < L) {
    out.set(R, (legH * s) / L, 0);
    rad.set(1, 0, 0);
  } else if (s > 1 - L) {
    out.set(-R, (legH * (1 - s)) / L, 0);
    rad.set(-1, 0, 0);
  } else {
    const a = ((s - L) / (1 - 2 * L)) * Math.PI;
    out.set(R * Math.cos(a), legH + R * Math.sin(a), 0);
    rad.set(Math.cos(a), Math.sin(a), 0);
  }
}

function buildArch(
  rng: Rng,
  budget: BackdropBudget,
  leaf: THREE.BufferGeometry,
  bloom: THREE.BufferGeometry,
  bloomPalette: BloomPalette,
): ArchAssets {
  const a = LAYOUT.arch;
  const R = a.radius;
  const tube = a.thickness * 0.6;
  const legHeight = 0.55;
  const depth = 0.32;
  const seed = rng.range(0, 100);
  const hoop = makeHoopGeometry(R, tube, seed);
  const leg = new THREE.CylinderGeometry(tube * 1.05, tube * 1.3, legHeight + 0.02, 7, 1);
  leg.translate(0, legHeight / 2, 0);
  const rung = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1);
  rung.translate(0, 0.5, 0);

  const woodTint = (out: THREE.Color) => out.setHSL(0.08, rng.range(0.08, 0.22), rng.range(0.6, 0.85));

  const legs = new InstanceBuilder();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      tmpP.set(sx * R, 0, (sz * depth) / 2);
      tmpQ.setFromAxisAngle(UP, rng.range(0, 6.28));
      tmpS.setScalar(1);
      legs.push(tmpP, tmpQ, tmpS, woodTint(tmpC), UP);
    }
  }

  // The lattice: straight rungs across the two hoops with a woven pair of
  // diagonals between each, and a few across each leg pair.
  const rungs = new InstanceBuilder();
  const rungLen = depth + tube * 2;
  const hoopPoint = (out: THREE.Vector3, ang: number, side: number) =>
    out.set(R * Math.cos(ang), legHeight + R * Math.sin(ang), (side * depth) / 2);
  const stick = (from: THREE.Vector3, to: THREE.Vector3, thick: number) => {
    tmpD.copy(to).sub(from);
    const len = tmpD.length();
    tmpD.normalize();
    aimY(tmpQ, tmpD, 0);
    tmpS.set(thick, len, thick);
    rungs.push(from, tmpQ, tmpS, woodTint(tmpC), UP);
  };
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const STEP = 17;
  for (let k = 0; k * STEP + 8 < 180; k++) {
    const a0 = (8 + k * STEP) * (Math.PI / 180);
    const a1 = (8 + (k + 1) * STEP) * (Math.PI / 180);
    if (k % 2 === 0) {
      hoopPoint(p0, a0, -1).z -= tube;
      hoopPoint(p1, a0, 1).z += tube;
      p0.x += rng.range(-0.01, 0.01);
      stick(p0, p1, rng.range(0.85, 1.15));
    }
    if (a1 < Math.PI) {
      hoopPoint(p0, a0, -1);
      hoopPoint(p1, a1, 1);
      stick(p0, p1, 0.75);
      hoopPoint(p0, a0, 1);
      hoopPoint(p1, a1, -1);
      stick(p0, p1, 0.75);
    }
  }
  for (const sx of [-1, 1]) {
    for (const y of [0.16, 0.38]) {
      p0.set(sx * R, y + rng.range(-0.015, 0.015), -rungLen / 2);
      p1.copy(p0).setZ(rungLen / 2);
      stick(p0, p1, 1);
    }
    p0.set(sx * R, 0.1, -depth / 2);
    p1.set(sx * R, 0.46, depth / 2);
    stick(p0, p1, 0.75);
    p0.set(sx * R, 0.1, depth / 2);
    p1.set(sx * R, 0.46, -depth / 2);
    stick(p0, p1, 0.75);
  }

  // vines: spirals around the hoops along noisy paths
  const tubes: THREE.BufferGeometry[] = [];
  const curves: { curve: THREE.CatmullRomCurve3; length: number }[] = [];
  const pt = new THREE.Vector3();
  const rad = new THREE.Vector3();
  for (const spec of VINES) {
    const pts: THREE.Vector3[] = [];
    const steps = 90;
    const phase = rng.range(0, Math.PI * 2);
    const vSeed = rng.range(0, 50);
    for (let i = 0; i <= steps; i++) {
      const s = lerp(spec.s0, spec.s1, i / steps);
      archPoint(s, R, legHeight, pt, rad);
      const th = spec.turns * Math.PI * 2 * s + phase;
      const rho = tube + spec.loose + 0.012 * vnoise2(s * 9 + vSeed, 0.5);
      const z = (spec.hoop === 0 ? -1 : 1) * (depth / 2);
      pts.push(
        new THREE.Vector3(
          pt.x + rad.x * Math.cos(th) * rho + 0.012 * vnoise2(s * 14 + vSeed, 1.5),
          pt.y + rad.y * Math.cos(th) * rho + 0.01 * vnoise2(s * 14 + vSeed, 2.5),
          z + Math.sin(th) * rho + 0.012 * vnoise2(s * 14 + vSeed, 3.5),
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    tubes.push(new THREE.TubeGeometry(curve, 110, spec.radius, 5, false));
    curves.push({ curve, length: curve.getLength() });
  }
  const totalLength = curves.reduce((acc, c) => acc + c.length, 0);

  // outward from the frame: away from the hoop's centre line over the arc,
  // from the leg's axis below it
  const out = new THREE.Vector3();
  const outward = (p: THREE.Vector3) => {
    if (p.y > legHeight) out.set(p.x, p.y - legHeight, 0);
    else out.set(p.x - Math.sign(p.x) * R, 0, p.z - (Math.abs(p.z) > 0.05 ? Math.sign(p.z) * depth * 0.5 : 0));
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    return out.normalize();
  };

  const leafTint = foliageTint(new THREE.Color(), 0.2);
  const leaves = new InstanceBuilder();
  for (const { curve, length } of curves) {
    const n = Math.round((budget.vineLeaves * length) / totalLength);
    for (let i = 0; i < n; i++) {
      curve.getPointAt(rng.next(), pt);
      outward(pt);
      tmpN.copy(out);
      const grow = tmpX.copy(out).addScaledVector(UP, -0.5);
      jitterDir(rng, grow, 0.6);
      aimY(tmpQ, grow, rng.range(0, Math.PI * 2));
      const s = rng.range(0.7, 1.25);
      tmpS.set(s, s, s);
      tmpC.copy(leafTint).multiplyScalar(rng.range(0.75, 1.12));
      leaves.push(tmpP.copy(pt).addScaledVector(out, 0.006), tmpQ, tmpS, tmpC, tmpN);
    }
  }

  const blooms = new InstanceBuilder();
  for (let k = 0; k < budget.bloomClusters; k++) {
    const { curve } = curves[k % curves.length];
    curve.getPointAt(rng.range(0.15, 0.95), pt);
    outward(pt);
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      randomDir(rng, tmpD);
      tmpP.copy(pt).addScaledVector(out, 0.035).addScaledVector(tmpD, 0.035);
      const grow = tmpX.copy(out).addScaledVector(tmpD, 0.5).normalize();
      aimY(tmpQ, grow, rng.range(0, Math.PI * 2));
      const s = rng.range(0.85, 1.25);
      tmpS.set(s, s, s);
      tmpC.setScalar(rng.range(0.88, 1));
      blooms.push(tmpP, tmpQ, tmpS, tmpC, tmpN.copy(out));
    }
  }

  return {
    center: new THREE.Vector3(...a.center),
    yaw: a.yaw,
    legHeight,
    depth,
    hoop,
    leg,
    legs: legs.finish(),
    rung,
    rungs: rungs.finish(),
    vines: mergeGeometries(tubes),
    leaves: instanced(leaf, leaves.finish()),
    blooms: instanced(bloom, blooms.finish()),
    bloomPalette,
  };
}

// --- fence ------------------------------------------------------------------

function buildFence(rng: Rng): FenceAssets {
  const f = LAYOUT.fence;
  const from = new THREE.Vector3(...f.from);
  const to = new THREE.Vector3(...f.to);
  const dir = to.clone().sub(from);
  const length = dir.length();
  dir.normalize();
  const normal = new THREE.Vector3(-dir.z, 0, dir.x);
  // fence frame: x along the run, y up, z toward the garden
  tmpM.makeBasis(dir, UP, normal);
  const frame = new THREE.Quaternion().setFromRotationMatrix(tmpM);
  const euler = new THREE.Euler();

  const picket = makeBoardGeometry(picketProfile(0.08, 0.06), 0.02);
  const post = makeBoardGeometry(picketProfile(0.09, 0.07), 0.09);
  const railH = 0.075;
  const rail = makeBoardGeometry(
    [
      [-0.5, 0],
      [0.5, 0],
      [0.5, railH],
      [-0.5, railH],
    ],
    0.03,
    true,
  );

  const place = (along: number, y: number, back: number) => tmpP.copy(from).addScaledVector(dir, along).addScaledVector(normal, -back).setY(y);
  const tint = (out: THREE.Color, dark = 0) => out.setHSL(0.08, rng.range(0.04, 0.2), rng.range(0.62, 0.9) * (1 - dark));

  const pickets = new InstanceBuilder();
  const gap = 0.135;
  const count = Math.floor((length - 0.12) / gap);
  for (let i = 0; i < count; i++) {
    if (rng.next() < 0.05) continue;
    const broken = rng.next() < 0.08;
    const h = broken ? rng.range(0.45, 0.68) : f.height * rng.range(0.9, 1.02);
    place(0.08 + i * gap + rng.range(-0.008, 0.008), 0.035 + rng.range(-0.01, 0.015), 0);
    euler.set(rng.range(-0.02, 0.02), 0, rng.range(-0.04, 0.04));
    tmpQ.copy(frame).multiply(tmpQ2.setFromEuler(euler));
    tmpS.set(rng.range(0.92, 1.06), h, 1);
    pickets.push(tmpP, tmpQ, tmpS, tint(tmpC, broken ? 0.15 : 0), normal);
  }

  const posts = new InstanceBuilder();
  for (const along of [0.04, length / 3, (2 * length) / 3, length - 0.04]) {
    place(along, 0, 0.065);
    euler.set(rng.range(-0.015, 0.015), 0, rng.range(-0.02, 0.02));
    tmpQ.copy(frame).multiply(tmpQ2.setFromEuler(euler));
    tmpS.set(1, f.height * 1.12, 1);
    posts.push(tmpP, tmpQ, tmpS, tint(tmpC, 0.1), normal);
  }

  const rails = new InstanceBuilder();
  for (const y of [0.3, 0.68]) {
    place(length / 2, y + rng.range(-0.01, 0.01), 0.035);
    tmpQ.copy(frame);
    tmpS.set(length - 0.02, 1, 1);
    rails.push(tmpP, tmpQ, tmpS, tint(tmpC, 0.08), normal);
  }

  return { picket, pickets: pickets.finish(), post, posts: posts.finish(), rail, rails: rails.finish() };
}

// --- bokeh ------------------------------------------------------------------

function buildBokeh(rng: Rng, canopies: Canopy[], budget: BackdropBudget): THREE.BufferGeometry {
  const n = budget.bokeh;
  const nightCount = Math.round(n * 0.28);
  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const kinds = new Float32Array(n);
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const night = i < nightCount;
    if (night) {
      // warm points low among the far shrubs on the lantern's side, kept under
      // the hedge line so they glow in the undergrowth rather than hang in the sky
      tmpP.set(rng.range(-6, -1.4), rng.range(0.22, 0.7), rng.range(-9.5, -4.6));
    } else {
      // sun catching leaves on the camera-facing shell of a canopy
      const canopy = canopies[rng.int(0, canopies.length - 1)];
      randomDir(rng, tmpD);
      tmpD.z = Math.abs(tmpD.z) + 0.2;
      tmpD.y = Math.abs(tmpD.y) * 0.9 - 0.15;
      tmpD.normalize();
      tmpP.copy(canopy.center).addScaledVector(tmpD, canopy.radius * 1.02);
    }
    positions[i * 3] = tmpP.x;
    positions[i * 3 + 1] = tmpP.y;
    positions[i * 3 + 2] = tmpP.z;
    sizes[i] = night ? rng.range(0.4, 1.1) : rng.range(0.6, 1.4);
    kinds[i] = night ? 1 : 0;
    seeds[i] = rng.next();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  g.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  return g;
}

// --- everything -------------------------------------------------------------

const HEDGE_LEAF_SHAPE = { length: 0.052, width: 0.034, serration: 0.15, fold: 0.3, tip: 0.5 };
const VINE_LEAF_SHAPE = { length: 0.07, width: 0.064, serration: 0, fold: 0.15, tip: 0.3 };
const SHRUB_FLORET: PetalShape = { length: 0.017, width: 0.013, bend: 0.2, cup: 0.5, ruffle: 0.1, tip: 0.2 };
const ARCH_FLORET: PetalShape = { length: 0.038, width: 0.026, bend: 0.3, cup: 0.4, ruffle: 0.25, tip: 0.65 };

/**
 * Builds the whole backdrop for one owner. `heroHex` is the hero flower's
 * mid colour, which the arch blooms are chosen to go with. Everything random
 * comes from Rng(seed + "|garden"), so the same owner always gets the same
 * garden; the quality tier only changes the counts.
 */
export function buildBackdrop(seed: string, quality: Quality, heroHex: string): BackdropAssets {
  const rng = new Rng(seed + "|garden");
  const budget = BACKDROP_BUDGET[quality];
  const [nu, nv] = budget.leafTess;

  const card = makeCardGeometry();
  const hedgeLeaf = makeLeafGeometry(HEDGE_LEAF_SHAPE, 3, nu, nv);
  const vineLeaf = makeLeafGeometry(VINE_LEAF_SHAPE, 5, nu, nv);
  const shrubFloret = makeFloretGeometry(SHRUB_FLORET, 5, 1.15, 2);
  const archFloret = makeFloretGeometry(ARCH_FLORET, 5, 1.3, 4);

  const floretPalette = shrubFloretPalette(rng.fork("shrub-florets"));
  const bloomPalette = climbingBloomPalette(heroHex, rng.fork("arch-blooms"));

  const treeRng = rng.fork("trees");
  const wood: THREE.BufferGeometry[] = [];
  const cores: THREE.BufferGeometry[] = [];
  const canopyBuilders = Array.from({ length: CANOPY_VARIANTS }, () => new InstanceBuilder());
  const canopyShapes = LAYOUT.trees.map((t) => buildTree(t, treeRng, budget, wood, cores, canopyBuilders));

  // The layout's hedges, two of them (the owner's pick) in flower, plus a few
  // understory shrubs at the feet of the trees so the far garden is not bare lawn.
  const massRng = rng.fork("masses");
  const flowering = new Set<number>();
  while (flowering.size < 2) flowering.add(massRng.int(0, LAYOUT.hedges.length - 1));
  const specs: MassSpec[] = LAYOUT.hedges.map((h, i) => ({
    center: h.center,
    rx: h.rx,
    rz: h.rz,
    height: h.height,
    flowers: flowering.has(i),
    density: "density" in h ? h.density : 1,
  }));
  for (const t of LAYOUT.trees) {
    const n = massRng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const ang = massRng.range(-0.9, 0.9) + (k === 0 ? 0 : Math.PI * 0.6);
      const d = massRng.range(1.0, 2.0);
      specs.push({
        center: [t.position[0] + Math.sin(ang) * d, 0, t.position[2] + Math.cos(ang) * d * 0.8],
        rx: massRng.range(0.55, 0.95),
        rz: massRng.range(0.45, 0.8),
        height: massRng.range(0.45, 0.8),
        flowers: false,
        density: 0.7,
      });
    }
  }
  const masses: MassBuilders = {
    cores: [],
    cards: Array.from({ length: HEDGE_VARIANTS }, () => new InstanceBuilder()),
    leaves: new InstanceBuilder(),
    florets: new InstanceBuilder(),
  };
  for (const s of specs) buildMass(s, massRng, budget, masses);

  const arch = buildArch(rng.fork("arch"), budget, vineLeaf, archFloret, bloomPalette);
  const fence = buildFence(rng.fork("fence"));
  const bokeh = buildBokeh(rng.fork("bokeh"), canopyShapes, budget);

  const canopies = canopyBuilders.map((b) => instanced(card, b.finish()));
  const hedgeCards = masses.cards.map((b) => instanced(card, b.finish()));
  const hedgeLeaves = instanced(hedgeLeaf, masses.leaves.finish());
  const shrubFlorets = instanced(shrubFloret, masses.florets.finish());
  const woodGeometry = mergeGeometries(wood);
  const canopyCores = mergeGeometries(cores);
  const hedgeCores = mergeGeometries(masses.cores);

  return {
    wood: woodGeometry,
    canopyCores,
    canopies,
    canopyShapes,
    hedgeCores,
    hedgeCards,
    hedgeLeaves,
    shrubFlorets,
    shrubFloretPalette: floretPalette,
    arch,
    fence,
    bokeh,
    budget,
    dispose() {
      card.dispose();
      hedgeLeaf.dispose();
      vineLeaf.dispose();
      shrubFloret.dispose();
      archFloret.dispose();
      woodGeometry.dispose();
      canopyCores.dispose();
      for (const c of canopies) c.geometry.dispose();
      hedgeCores.dispose();
      for (const c of hedgeCards) c.geometry.dispose();
      hedgeLeaves.geometry.dispose();
      shrubFlorets.geometry.dispose();
      arch.hoop.dispose();
      arch.leg.dispose();
      arch.rung.dispose();
      arch.vines.dispose();
      arch.leaves.geometry.dispose();
      arch.blooms.geometry.dispose();
      fence.picket.dispose();
      fence.post.dispose();
      fence.rail.dispose();
      bokeh.dispose();
    },
  };
}
