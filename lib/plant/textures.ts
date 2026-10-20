// Painted-on-the-fly textures. Everything is drawn on a canvas at runtime so
// the look can be tuned per species, per health band, without shipping assets.
// A petal gets three maps from one vein drawing: the albedo, a normal map
// (vein heights run through a Sobel filter) and an emissive mask that keeps
// the night glow in the veins and the base. Browser only: these touch `document`.
import * as THREE from "three";
import { Rng } from "./prng";

const cache = new Map<string, THREE.CanvasTexture>();

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const hsl = { h: 0, s: 0, l: 0 };
const shiftColor = new THREE.Color();

/** Nudges a hex colour by a hue turn and a lightness offset (both small). */
export function shiftHex(hex: string, dHue: number, dLight: number): string {
  shiftColor.set(hex).getHSL(hsl);
  shiftColor.setHSL((hsl.h + dHue + 1) % 1, hsl.s, Math.min(1, Math.max(0, hsl.l * (1 + dLight))));
  return "#" + shiftColor.getHexString();
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c: HTMLCanvasElement, repeat?: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.needsUpdate = true;
  return t;
}

/** Linear (non-colour) data texture, for normal maps. */
function toDataTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Turns a grayscale height canvas into a tangent-space normal map with a
 * Sobel filter. Canvas rows run top-down while uv v runs bottom-up, so the
 * green channel takes the raw canvas-y gradient.
 */
function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const W = height.width;
  const H = height.height;
  const src = height.getContext("2d")!.getImageData(0, 0, W, H).data;
  const out = makeCanvas(W, H);
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(W, H);
  const d = img.data;
  const h = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tl = h(x - 1, y - 1);
      const t = h(x, y - 1);
      const tr = h(x + 1, y - 1);
      const l = h(x - 1, y);
      const r = h(x + 1, y);
      const bl = h(x - 1, y + 1);
      const b = h(x, y + 1);
      const br = h(x + 1, y + 1);
      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * W + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (nz * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Petals

interface VeinBranch {
  s: number;
  dir: number;
  len: number;
}

interface Vein {
  x0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  branches: VeinBranch[];
}

/** Vein paths in unit canvas coordinates (y down, base at y = 1), deterministic from the seed. */
function petalVeins(count: number, seed: number): Vein[] {
  const rng = new Rng(seed * 7919 + 13);
  const veins: Vein[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x0 = 0.5 + (rng.next() - 0.5) * 0.04;
    const x1 = 0.06 + 0.88 * t + (rng.next() - 0.5) * 0.09;
    const y1 = 0.05 + rng.next() * 0.14;
    const cx = 0.5 + (x1 - 0.5) * 0.3;
    const cy = 0.5;
    const branches: VeinBranch[] = [];
    const nb = 3 + rng.int(0, 3);
    for (let b = 0; b < nb; b++) {
      branches.push({ s: 0.2 + 0.7 * rng.next(), dir: rng.sign(), len: 0.03 + rng.next() * 0.06 });
    }
    veins.push({ x0, cx, cy, x1, y1, branches });
  }
  return veins;
}

function strokeVeins(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  veins: Vein[],
  style: string,
  width: number,
  branchStyle: string,
  branchWidth: number,
) {
  ctx.lineCap = "round";
  for (const v of veins) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(v.x0 * W, H);
    ctx.quadraticCurveTo(v.cx * W, v.cy * H, v.x1 * W, v.y1 * H);
    ctx.stroke();
    ctx.strokeStyle = branchStyle;
    ctx.lineWidth = branchWidth;
    for (const b of v.branches) {
      const s = b.s;
      const px = ((1 - s) * (1 - s) * v.x0 + 2 * (1 - s) * s * v.cx + s * s * v.x1) * W;
      const py = ((1 - s) * (1 - s) * 1 + 2 * (1 - s) * s * v.cy + s * s * v.y1) * H;
      const len = b.len * H;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + b.dir * len * 0.5, py - len * 0.4, px + b.dir * len, py - len * 0.9);
      ctx.stroke();
    }
  }
}

export interface PetalTexOpts {
  base: string;
  mid: string;
  tip: string;
  vein: string;
  veins: number;
  seed: number;
  /** 0 lush .. 1 faded brown */
  fade: number;
  /** 0 none .. 1 scorched tip */
  burn: number;
  /** a lily's marks (lib/plant/species FlowerSpec marks): its throat, the streak up the middle and the freckles */
  marks?: { throat: string; streak: string; spots: string };
}

const PW = 384;
const PH = 768;

/**
 * A lily's marks on the blade: a green-yellow throat where the petal leaves the flower's heart, a deeper streak up the
 * middle of the lower blade fading out before the middle, and freckles scattered over the lower half, thickest near the
 * midline and the base, each a little longer than wide as on a real tepal. Drawn in the colour map alone, so the light
 * tier (which has no normal map) shows them too.
 */
function paintMarks(ctx: CanvasRenderingContext2D, W: number, H: number, m: { throat: string; streak: string; spots: string }, rng: Rng) {
  // the streak: soft layered bands up the midline, widest and strongest at the base
  for (let k = 0; k < 4; k++) {
    const w = W * (0.16 - 0.03 * k);
    const top = H * (0.38 + 0.06 * k);
    const g = ctx.createLinearGradient(0, H, 0, top);
    g.addColorStop(0, rgba(m.streak, 0.2));
    g.addColorStop(0.55, rgba(m.streak, 0.16));
    g.addColorStop(1, rgba(m.streak, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(W / 2 - w / 2, H);
    ctx.quadraticCurveTo(W / 2 - w * 0.45, H * 0.7, W / 2, top);
    ctx.quadraticCurveTo(W / 2 + w * 0.45, H * 0.7, W / 2 + w / 2, H);
    ctx.closePath();
    ctx.fill();
  }
  // the throat: green-yellow, a narrow star up the midline from the base
  const tg = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.34);
  tg.addColorStop(0, rgba(m.throat, 1));
  tg.addColorStop(0.4, rgba(m.throat, 0.75));
  tg.addColorStop(1, rgba(m.throat, 0));
  ctx.save();
  ctx.translate(W / 2, H);
  ctx.scale(0.42, 1);
  ctx.translate(-W / 2, -H);
  ctx.fillStyle = tg;
  ctx.fillRect(W / 2 - H * 0.34, H * 0.66, H * 0.68, H * 0.34);
  ctx.restore();
  // the freckles, deep pink, darker and denser toward the heart
  for (let i = 0; i < 90; i++) {
    const v = Math.pow(rng.next(), 1.6) * 0.5;
    const spread = 0.08 + 0.3 * (v / 0.5);
    const x = W * (0.5 + (rng.next() * 2 - 1) * spread);
    const y = H * (1 - 0.06 - v);
    const r = W * (0.006 + rng.next() * 0.01) * (1.2 - v);
    ctx.fillStyle = rgba(m.spots, 0.45 + 0.4 * rng.next() * (1 - v));
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (1.3 + rng.next() * 0.6), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function petalTexture(o: PetalTexOpts): THREE.CanvasTexture {
  const key = "petal:" + JSON.stringify(o);
  const hit = cache.get(key);
  if (hit) return hit;
  const W = PW;
  const H = PH;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(o.seed * 104729 + 31);
  const veins = petalVeins(o.veins, o.seed);

  // base-to-tip gradient; uv v=0 is the bottom row of the canvas. The deep
  // crimson stays in the claw, the saturated mid colour owns the blade.
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, o.base);
  g.addColorStop(0.1, o.base);
  g.addColorStop(0.34, o.mid);
  g.addColorStop(0.78, o.mid);
  g.addColorStop(1, o.tip);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // the claw: a darker throat right at the base
  const claw = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.18);
  claw.addColorStop(0, rgba(o.base, 0.85));
  claw.addColorStop(1, rgba(o.base, 0));
  ctx.fillStyle = claw;
  ctx.fillRect(0, 0, W, H);

  // velvet: broad soft patches a shade lighter and darker than the blade
  for (let i = 0; i < 12; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const r = 50 + rng.next() * 110;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rng.next() < 0.55;
    rg.addColorStop(0, rgba(light ? o.tip : o.base, light ? 0.1 : 0.14));
    rg.addColorStop(1, rgba(light ? o.tip : o.base, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // thinner, lighter, translucent margins
  const eg = ctx.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, rgba(o.tip, 0.85));
  eg.addColorStop(0.13, rgba(o.tip, 0));
  eg.addColorStop(0.87, rgba(o.tip, 0));
  eg.addColorStop(1, rgba(o.tip, 0.85));
  ctx.fillStyle = eg;
  ctx.fillRect(0, 0, W, H);
  // ... and the very tip
  const tg = ctx.createLinearGradient(0, 0, 0, H * 0.28);
  tg.addColorStop(0, rgba(o.tip, 0.6));
  tg.addColorStop(1, rgba(o.tip, 0));
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H);

  // fine fibrous striations running base to tip, barely there
  for (let i = 0; i < 90; i++) {
    const x0 = W * (0.42 + rng.next() * 0.16);
    const x1 = W * (rng.next() * 1.1 - 0.05);
    const dark = rng.next() < 0.5;
    ctx.strokeStyle = rgba(dark ? o.base : o.tip, 0.018 + rng.next() * 0.025);
    ctx.lineWidth = 0.6 + rng.next() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x0, H);
    ctx.quadraticCurveTo((x0 + x1) / 2, H * 0.5, x1, H * (0.02 + rng.next() * 0.1));
    ctx.stroke();
  }

  // faint lighter veins fanning from the base
  strokeVeins(ctx, W, H, veins, rgba(o.vein, 0.16), 2, rgba(o.vein, 0.09), 1);

  // a lily's throat, streak and freckles, from their own draws so a clean blade's grain is unchanged
  if (o.marks) paintMarks(ctx, W, H, o.marks, new Rng(o.seed * 7727 + 3));

  // grain
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.5 ? o.tip : o.base, 0.03 + rng.next() * 0.04);
    ctx.fillRect(rng.next() * W, rng.next() * H, 1.5, 1.5);
  }

  if (o.fade > 0) {
    ctx.fillStyle = rgba("#8a6a52", Math.min(1, o.fade) * 0.7);
    ctx.fillRect(0, 0, W, H);
  }
  if (o.burn > 0) {
    const bh = H * 0.5 * Math.min(1, o.burn);
    const bg = ctx.createLinearGradient(0, 0, 0, bh);
    bg.addColorStop(0, rgba("#3d2211", 0.92));
    bg.addColorStop(0.55, rgba("#7a4a22", 0.55));
    bg.addColorStop(1, rgba("#7a4a22", 0));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, bh);
  }
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Normal map from the same vein drawing: veins stand proud, striations ripple the surface. */
export function petalNormalTexture(veinsCount: number, seed: number): THREE.CanvasTexture {
  const key = `petalN:${veinsCount}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = PW / 2;
  const H = PH / 2;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 7919 + 101);
  const veins = petalVeins(veinsCount, seed);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, W, H);

  // broad soft swells so the blade is not a perfect sheet
  for (let i = 0; i < 16; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const r = 40 + rng.next() * 90;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const up = rng.next() < 0.5;
    rg.addColorStop(0, up ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)");
    rg.addColorStop(1, "rgba(128,128,128,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // velvet: a fine cellular grain
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    const s = 1 + rng.next() * 2;
    ctx.fillRect(rng.next() * W, rng.next() * H, s, s);
  }
  // fibrous striations: wide, faint undulations rather than lines
  for (let i = 0; i < 50; i++) {
    const x0 = W * (0.42 + rng.next() * 0.16);
    const x1 = W * (rng.next() * 1.1 - 0.05);
    ctx.strokeStyle = rng.next() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)";
    ctx.lineWidth = 2 + rng.next() * 2;
    ctx.beginPath();
    ctx.moveTo(x0, H);
    ctx.quadraticCurveTo((x0 + x1) / 2, H * 0.5, x1, H * (0.02 + rng.next() * 0.1));
    ctx.stroke();
  }
  // veins: a soft raised bed with a gentle ridge on top
  strokeVeins(ctx, W, H, veins, "rgba(255,255,255,0.14)", 5, "rgba(255,255,255,0.09)", 3);
  strokeVeins(ctx, W, H, veins, "rgba(255,255,255,0.32)", 1.6, "rgba(255,255,255,0.2)", 1);

  const tex = toDataTexture(heightToNormal(c, 1.7));
  cache.set(key, tex);
  return tex;
}

/** Emissive mask: dark everywhere except the glowing base and the veins. */
export function petalEmissiveTexture(emissive: string, veinsCount: number, seed: number): THREE.CanvasTexture {
  const key = `petalE:${emissive}:${veinsCount}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = PW / 2;
  const H = PH / 2;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const veins = petalVeins(veinsCount, seed);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  // the base glows brightest and fades out two thirds of the way up
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, rgba(emissive, 1));
  g.addColorStop(0.22, rgba(emissive, 0.7));
  g.addColorStop(0.62, rgba(emissive, 0.14));
  g.addColorStop(1, rgba(emissive, 0.1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // the thin margins let light through
  const eg = ctx.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, rgba(emissive, 0.4));
  eg.addColorStop(0.1, rgba(emissive, 0));
  eg.addColorStop(0.9, rgba(emissive, 0));
  eg.addColorStop(1, rgba(emissive, 0.4));
  ctx.fillStyle = eg;
  ctx.fillRect(0, 0, W, H);
  const tg = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  tg.addColorStop(0, rgba(emissive, 0.3));
  tg.addColorStop(1, rgba(emissive, 0));
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, W, H);
  // veins carry the light out toward the tip, as soft bands rather than lines
  strokeVeins(ctx, W, H, veins, rgba(emissive, 0.22), 9, rgba(emissive, 0.14), 5);
  strokeVeins(ctx, W, H, veins, rgba(emissive, 0.45), 3, rgba(emissive, 0.3), 1.8);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Stems

/**
 * Stem bark: the given colour with fine longitudinal streaks, a few paler
 * lenticels and a little grain, tiling along the stem. u runs around the
 * stem, v along it.
 */
export function stemTexture(color: string, seed: number): THREE.CanvasTexture {
  const key = `stem:${color}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 128;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 7001 + 17);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  const light = shiftHex(color, 0.01, 0.35);
  const dark = shiftHex(color, -0.01, -0.35);
  // streaks run the full height so the tile repeats cleanly along the stem
  for (let i = 0; i < 70; i++) {
    const x = rng.next() * W;
    const w = 0.6 + rng.next() * 1.8;
    const isLight = rng.next() < 0.5;
    ctx.strokeStyle = rgba(isLight ? light : dark, 0.06 + rng.next() * 0.12);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rng.next() - 0.5) * 6, H * 0.33, x + (rng.next() - 0.5) * 6, H * 0.66, x, H);
    ctx.stroke();
  }
  // lenticels: small pale ovals
  for (let i = 0; i < 9; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    ctx.fillStyle = rgba(light, 0.25 + rng.next() * 0.2);
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + rng.next() * 1.5, 2.5 + rng.next() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.5 ? light : dark, 0.04 + rng.next() * 0.06);
    ctx.fillRect(rng.next() * W, rng.next() * H, 1.5, 1.5);
  }
  const tex = toTexture(c, 1);
  tex.repeat.set(1, 3);
  cache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Leaves

export interface LeafTexOpts {
  base: string;
  tip: string;
  vein: string;
  seed: number;
  /** 0 lush .. 1 brown */
  fade: number;
  /** 0 none .. 1 scorched */
  burn: number;
}

const LW = 256;
const LH = 384;

interface LeafVein {
  y: number;
  jitter: number;
}

function leafVeins(seed: number): LeafVein[] {
  const rng = new Rng(seed * 104729 + 7);
  const out: LeafVein[] = [];
  for (let y = 0.93; y > 0.12; y -= 0.082) out.push({ y, jitter: (rng.next() - 0.5) * 0.02 });
  return out;
}

function strokeLeafVeins(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  veins: LeafVein[],
  midStyle: string,
  midWidth: number,
  sideStyle: string,
  sideWidth: number,
) {
  ctx.lineCap = "round";
  ctx.strokeStyle = midStyle;
  ctx.lineWidth = midWidth;
  ctx.beginPath();
  ctx.moveTo(W / 2, H);
  ctx.lineTo(W / 2, H * 0.03);
  ctx.stroke();
  ctx.strokeStyle = sideStyle;
  ctx.lineWidth = sideWidth;
  for (const v of veins) {
    const y = (v.y + v.jitter) * H;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.quadraticCurveTo(W / 2 + side * W * 0.2, y - H * 0.045, W / 2 + side * W * 0.48, y - H * 0.13);
      ctx.stroke();
    }
  }
}

export function leafTexture(o: LeafTexOpts): THREE.CanvasTexture {
  const key = "leaf:" + JSON.stringify(o);
  const hit = cache.get(key);
  if (hit) return hit;
  const W = LW;
  const H = LH;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(o.seed * 104729 + 7);
  const veins = leafVeins(o.seed);

  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, o.base);
  g.addColorStop(0.6, o.base);
  g.addColorStop(1, o.tip);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft mottling
  for (let i = 0; i < 30; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const r = 18 + rng.next() * 46;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rgba(rng.next() < 0.5 ? o.tip : o.base, 0.2));
    rg.addColorStop(1, rgba(o.base, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // the blade between veins is a shade lighter than the vein grooves
  for (const v of veins) {
    const y = (v.y + v.jitter - 0.04) * H;
    for (const side of [-1, 1]) {
      const rg = ctx.createRadialGradient(W / 2 + side * W * 0.22, y, 0, W / 2 + side * W * 0.22, y, W * 0.16);
      rg.addColorStop(0, rgba(o.tip, 0.14));
      rg.addColorStop(1, rgba(o.tip, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // slightly reddish, lighter margin, as on young rose leaves
  const eg = ctx.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, "rgba(120,70,50,0.35)");
  eg.addColorStop(0.07, "rgba(120,70,50,0)");
  eg.addColorStop(0.93, "rgba(120,70,50,0)");
  eg.addColorStop(1, "rgba(120,70,50,0.35)");
  ctx.fillStyle = eg;
  ctx.fillRect(0, 0, W, H);

  // vein shadow, then the lighter vein
  strokeLeafVeins(ctx, W, H, veins, "rgba(0,0,0,0.18)", 5, "rgba(0,0,0,0.12)", 2.6);
  strokeLeafVeins(ctx, W, H, veins, rgba(o.vein, 0.75), 2.6, rgba(o.vein, 0.4), 1.2);
  // tertiary veinlets
  ctx.strokeStyle = rgba(o.vein, 0.14);
  ctx.lineWidth = 0.7;
  for (const v of veins) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const s = 0.2 + 0.65 * rng.next();
        const px = W / 2 + side * W * 0.48 * s;
        const py = (v.y + v.jitter) * H - H * 0.13 * s;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + side * 8, py - 12 - rng.next() * 10);
        ctx.stroke();
      }
    }
  }

  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.5 ? o.tip : o.base, 0.05 + rng.next() * 0.05);
    ctx.fillRect(rng.next() * W, rng.next() * H, 1.5, 1.5);
  }

  if (o.fade > 0) {
    const f = Math.min(1, o.fade);
    ctx.fillStyle = rgba("#d8c23a", Math.min(0.6, f * 0.9));
    ctx.fillRect(0, 0, W, H);
    if (f > 0.55) {
      ctx.fillStyle = rgba("#6b4423", ((f - 0.55) / 0.45) * 0.85);
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (o.burn > 0) {
    const b = Math.min(1, o.burn);
    const bh = H * 0.45 * b;
    const bg = ctx.createLinearGradient(0, 0, 0, bh);
    bg.addColorStop(0, rgba("#3d2211", 0.95));
    bg.addColorStop(0.5, rgba("#7a4a22", 0.6));
    bg.addColorStop(1, rgba("#7a4a22", 0));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, bh);
    const ew = W * 0.2 * b;
    for (const [x0, x1] of [
      [0, ew],
      [W, W - ew],
    ]) {
      const sg = ctx.createLinearGradient(x0, 0, x1, 0);
      sg.addColorStop(0, rgba("#4a2a14", 0.85));
      sg.addColorStop(1, rgba("#4a2a14", 0));
      ctx.fillStyle = sg;
      ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
    }
  }
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

/** Leaf normal map: the midrib and side veins are grooves, the blade between them puffs up. */
export function leafNormalTexture(seed: number): THREE.CanvasTexture {
  const key = `leafN:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = LW;
  const H = LH;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 104729 + 7);
  const veins = leafVeins(seed);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, W, H);
  for (const v of veins) {
    const y = (v.y + v.jitter - 0.04) * H;
    for (const side of [-1, 1]) {
      const rg = ctx.createRadialGradient(W / 2 + side * W * 0.22, y, 0, W / 2 + side * W * 0.22, y, W * 0.17);
      rg.addColorStop(0, "rgba(255,255,255,0.22)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }
  // cell-scale grain
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(rng.next() * W, rng.next() * H, 2, 2);
  }
  strokeLeafVeins(ctx, W, H, veins, "rgba(0,0,0,0.3)", 7, "rgba(0,0,0,0.22)", 4);
  strokeLeafVeins(ctx, W, H, veins, "rgba(0,0,0,0.7)", 3, "rgba(0,0,0,0.5)", 1.6);
  const tex = toDataTexture(heightToNormal(c, 1.8));
  cache.set(key, tex);
  return tex;
}
