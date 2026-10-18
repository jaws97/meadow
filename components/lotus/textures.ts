// Canvas painters for the lotus, in the style of lib/plant/textures (drawn at runtime, cached by their options, never
// disposed): the round leaf with its pale navel, 21 forking radial veins and glaucous bloom; the urli's mud, wet,
// drying and cracked; each vessel's surface painted in bands along its profile (tarnished bell metal with a
// burnished rim, salt-and-pepper granite, duck-egg glaze breaking to clay); the seed of light's halo. Browser only.
import * as THREE from "three";
import { makeCanvas, rgba, toTexture } from "@/lib/plant/textures";
import { Rng, smoothstep, vnoise2 } from "@/lib/plant/prng";
import type { UrliZones } from "@/components/lotus/geometry";
import type { Vessel } from "@/components/lotus/params";

const cache = new Map<string, THREE.CanvasTexture>();

function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** A linear colour (as the art direction's PBR tables give them) as an sRGB hex for the canvas. */
const lin = (r: number, g: number, b: number) => "#" + new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHexString();

function dataTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** A tangent-space normal map from a grey height canvas (the Sobel route lib/plant/textures uses for petals). */
function heightToNormal(height: HTMLCanvasElement, strength: number, wrapX: boolean): HTMLCanvasElement {
  const W = height.width;
  const H = height.height;
  const src = height.getContext("2d")!.getImageData(0, 0, W, H).data;
  const out = makeCanvas(W, H);
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(W, H);
  const d = img.data;
  const h = (x: number, y: number) => {
    const xx = wrapX ? (x + W) % W : Math.min(W - 1, Math.max(0, x));
    const yy = Math.min(H - 1, Math.max(0, y));
    return src[(yy * W + xx) * 4] / 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
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

// ---------------------------------------------------------------------------------------------------------------------
// The leaf

export interface PadTexOpts {
  /** standing leaves are the glaucous blue-green; floating leaves a touch yellower and flatter in tone */
  kind: "stand" | "float";
  /** even pale yellow-green paling (hunger) 0..1 */
  pale: number;
  /** a ragged brown band creeping in from the margin (floating leaves drying on the mud) 0..1 */
  brown: number;
  /** a thin dry brown margin with a paler line inside it (drought on standing leaves) 0..1 */
  crisp: number;
  seed: number;
}

const PAD_PX = 512;
/** The blade's edge on the canvas: the geometry maps its uv over 1.03 x (1 + asym) of the radius. */
const PAD_EDGE = PAD_PX / 2 / 1.07;
const PRIMARY_VEINS = 21;

interface VeinPath {
  pts: [number, number][];
  width: number;
}

/** 21 primary veins from the navel, each forking at about 0.6 and again at 0.85 of the radius (section 4.0). */
function padVeins(seed: number): VeinPath[] {
  const rng = new Rng(seed * 131 + 7);
  const out: VeinPath[] = [];
  const c = PAD_PX / 2;
  const step = (Math.PI * 2) / PRIMARY_VEINS;
  const walk = (a0: number, r0: number, r1: number, drift: number, w: number) => {
    const pts: [number, number][] = [];
    let a = a0;
    for (let k = 0; k <= 10; k++) {
      const r = r0 + (r1 - r0) * (k / 10);
      a += drift / 10 + (rng.next() - 0.5) * 0.012;
      pts.push([c + Math.cos(a) * r * PAD_EDGE, c + Math.sin(a) * r * PAD_EDGE]);
    }
    out.push({ pts, width: w });
    return a;
  };
  for (let i = 0; i < PRIMARY_VEINS; i++) {
    const a0 = i * step + (rng.next() - 0.5) * 0.08;
    const drift = (rng.next() - 0.5) * 0.06;
    const aFork = walk(a0, 0.07, 0.6, drift, 3.2);
    const spread = step * 0.28;
    for (const s of [-1, 1]) {
      const a2 = walk(aFork, 0.6, 0.86, s * spread, 2.0);
      for (const s2 of [-1, 1]) walk(a2, 0.86, 1.0, s2 * spread * 0.45, 1.2);
    }
  }
  return out;
}

function strokeVein(ctx: CanvasRenderingContext2D, v: VeinPath, scale: number) {
  ctx.lineWidth = v.width * scale;
  ctx.beginPath();
  ctx.moveTo(v.pts[0][0], v.pts[0][1]);
  for (let k = 1; k < v.pts.length; k++) ctx.lineTo(v.pts[k][0], v.pts[k][1]);
  ctx.stroke();
}

/** A ragged ring from the margin in to `depth` of the radius, filled brown with a paler line along its inner edge. */
function marginBand(ctx: CanvasRenderingContext2D, depth: number, seed: number, dark: string, light: string, line: string) {
  const c = PAD_PX / 2;
  const n = 180;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, PAD_PX, 0, Math.PI * 2);
  const inner: [number, number][] = [];
  for (let k = n; k >= 0; k--) {
    const a = (k / n) * Math.PI * 2;
    const r = PAD_EDGE * (1 - depth * (0.7 + 0.45 * (0.5 + 0.5 * vnoise2(a * 4 + seed, seed * 0.7)) + 0.12 * vnoise2(a * 19, seed)));
    inner.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  ctx.moveTo(inner[0][0], inner[0][1]);
  for (const p of inner) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  const g = ctx.createRadialGradient(c, c, PAD_EDGE * (1 - depth * 1.2), c, c, PAD_EDGE);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fill("evenodd");
  ctx.strokeStyle = line;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(inner[0][0], inner[0][1]);
  for (const p of inner) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * The upper face of a lotus leaf, planar over the blade: the pale raised navel (about a twelfth of the leaf's width),
 * the dull glaucous blue-green body with a yellower margin, 21 paler forking veins and a faint net between them,
 * soft waxy mottling; then hunger's even paling and drought's brown margins on top.
 */
export function padTexture(o: PadTexOpts): THREE.CanvasTexture {
  return cached("pad:" + JSON.stringify(o), () => {
    const c = makeCanvas(PAD_PX, PAD_PX);
    const ctx = c.getContext("2d")!;
    const mid = PAD_PX / 2;
    // v2: a deeper glaucous blue-green (the first renders' leaves read pale, the floating ones paper-white)
    const body = o.kind === "stand" ? "#3f6d5c" : "#3b6a52";
    const margin = o.kind === "stand" ? "#5b8659" : "#567f52";
    ctx.fillStyle = margin;
    ctx.fillRect(0, 0, PAD_PX, PAD_PX);
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, PAD_EDGE);
    g.addColorStop(0, "#b3c08c");
    g.addColorStop(0.055, "#98ad80");
    g.addColorStop(0.1, body);
    g.addColorStop(0.78, body);
    g.addColorStop(0.97, margin);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PAD_PX, PAD_PX);
    // the wax bloom: soft lighter clouds, a few darker
    const rng = new Rng(o.seed * 17 + 3);
    for (let i = 0; i < 70; i++) {
      const x = rng.next() * PAD_PX;
      const y = rng.next() * PAD_PX;
      const r = 20 + rng.next() * 60;
      const light = rng.next() < 0.7;
      const m = ctx.createRadialGradient(x, y, 0, x, y, r);
      m.addColorStop(0, light ? "rgba(214,232,226,0.07)" : "rgba(40,70,55,0.06)");
      m.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = m;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // the faint reticulate net between the veins
    ctx.strokeStyle = "rgba(205,225,195,0.05)";
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 900; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = (0.12 + 0.86 * Math.sqrt(rng.next())) * PAD_EDGE;
      const x = mid + Math.cos(a) * r;
      const y = mid + Math.sin(a) * r;
      const t = a + Math.PI / 2 + (rng.next() - 0.5) * 1.2;
      const l = 4 + rng.next() * 7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l);
      ctx.stroke();
    }
    // the veins: on the upper face only a faint paler radial pattern under the wax (the first renders' bright lines read
    // as a nasturtium's)
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(170,198,168,0.11)";
    for (const v of padVeins(o.seed)) strokeVein(ctx, v, 0.85);
    // the navel's raised rim
    ctx.strokeStyle = "rgba(200,212,160,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mid, mid, PAD_EDGE * 0.065, 0, Math.PI * 2);
    ctx.stroke();
    if (o.pale > 0) {
      ctx.fillStyle = `rgba(201,190,104,${0.55 * o.pale})`;
      ctx.fillRect(0, 0, PAD_PX, PAD_PX);
    }
    if (o.brown > 0) marginBand(ctx, 0.12 + 0.4 * o.brown, o.seed, "#4e3520", "#86663a", "rgba(196,172,112,0.7)");
    else if (o.crisp > 0) marginBand(ctx, 0.04 + 0.06 * o.crisp, o.seed + 5, "#5a3e22", "#7d6236", "rgba(214,204,140,0.85)");
    return toTexture(c);
  });
}

/** Vein relief for the leaf: raised veins and the navel's disc. */
export function padNormalTexture(seed: number): THREE.CanvasTexture {
  return cached("padN:" + seed, () => {
    const h = makeCanvas(PAD_PX, PAD_PX);
    const ctx = h.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PAD_PX, PAD_PX);
    ctx.filter = "blur(1.2px)";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    for (const v of padVeins(seed)) strokeVein(ctx, v, 1.4);
    const mid = PAD_PX / 2;
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, PAD_EDGE * 0.08);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PAD_PX, PAD_PX);
    ctx.filter = "none";
    return dataTexture(heightToNormal(h, 1.6, false));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The mud

export type MudState = "wet" | "drying" | "cracked";

/**
 * Heavy clay loam, planar over the mud's disc: smooth and dark under water and when freshly bared, matte and paler as
 * it dries, then a polygonal network of cracks 1-3 mm wide with slightly lighter shoulders (section 3.4). A few
 * pebbles at the edge.
 */
export function mudTexture(state: MudState): THREE.CanvasTexture {
  return cached("mud:" + state, () => {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext("2d")!;
    const base = state === "wet" ? [42, 34, 25] : state === "drying" ? [78, 66, 52] : [109, 94, 76];
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const rng = new Rng(state.length * 97 + 11);
    // Voronoi seeds for the cracks
    const seeds: [number, number][] = Array.from({ length: 34 }, () => [rng.next() * S, rng.next() * S]);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = 0.5 * vnoise2(x * 0.08, y * 0.08) + 0.3 * vnoise2(x * 0.3 + 5, y * 0.3) + 0.2 * (rng.next() - 0.5);
        let k = 1 + 0.12 * n;
        if (state === "cracked") {
          let d1 = 1e9;
          let d2 = 1e9;
          for (const [sx, sy] of seeds) {
            const dd = (x - sx) ** 2 + (y - sy) ** 2;
            if (dd < d1) {
              d2 = d1;
              d1 = dd;
            } else if (dd < d2) d2 = dd;
          }
          const edge = Math.sqrt(d2) - Math.sqrt(d1);
          const w = 1.3 + 0.9 * (0.5 + 0.5 * vnoise2(x * 0.05, y * 0.05));
          if (edge < w) k = 0.42;
          else if (edge < w + 2.2) k *= 1.12;
          // the plates curl a little: lighter toward their middles
          k *= 1 + 0.04 * smoothstep(4, 20, edge);
        } else if (state === "drying") {
          // the first fine cracks, sparse
          const v = Math.abs(vnoise2(x * 0.06 + 3, y * 0.06 - 1));
          if (v < 0.02) k *= 0.7;
        }
        const o = (y * S + x) * 4;
        d[o] = Math.min(255, base[0] * k);
        d[o + 1] = Math.min(255, base[1] * k);
        d[o + 2] = Math.min(255, base[2] * k);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // pebbles round the edge, a few
    for (let i = 0; i < 9; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = (0.8 + 0.16 * rng.next()) * (S / 2);
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      const pr = 3 + rng.next() * 5;
      const g = ctx.createRadialGradient(x - pr * 0.3, y - pr * 0.3, 0, x, y, pr);
      g.addColorStop(0, state === "wet" ? "#7d7464" : "#a39a88");
      g.addColorStop(1, state === "wet" ? "#4a4236" : "#6e6555");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, pr, pr * (0.6 + 0.3 * rng.next()), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The vessels

export interface UrliTextures {
  map: THREE.CanvasTexture;
  /** roughness in green, metalness in blue (three reads them from those channels) */
  orm: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

const UW = 512;
const UH = 256;

interface Band {
  /** v from, v to (0 the foot .. 1 the inner wall's bottom) */
  from: number;
  to: number;
}

/**
 * Each vessel's surface, u round the vessel and v along its profile by arc length (geometry.smoothLathe), painted in
 * the bands of the art direction's PBR tables (section 2). The three canvases are painted together.
 */
export function urliTextures(vessel: Vessel, z: UrliZones): UrliTextures {
  const key = "urli:" + vessel + ":" + JSON.stringify(z);
  const map = cache.get(key + ":map");
  if (map) return { map, orm: cache.get(key + ":orm")!, bump: cache.get(key + ":bump")! };
  const colour = makeCanvas(UW, UH);
  const rough = makeCanvas(UW, UH);
  const metal = makeCanvas(UW, UH);
  const bump = makeCanvas(UW, UH);
  const cc = colour.getContext("2d")!;
  const rc = rough.getContext("2d")!;
  const mc = metal.getContext("2d")!;
  const bc = bump.getContext("2d")!;
  // canvas rows run top-down while v runs bottom-up (CanvasTexture flips)
  const row = (v: number) => (1 - v) * UH;
  const band = (ctx: CanvasRenderingContext2D, b: Band, style: string) => {
    ctx.fillStyle = style;
    const y0 = row(b.to);
    const y1 = row(b.from);
    ctx.fillRect(0, Math.min(y0, y1), UW, Math.abs(y1 - y0) + 0.5);
  };
  const grey = (v: number) => {
    const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgb(${g},${g},${g})`;
  };
  const rng = new Rng(vessel.charCodeAt(0) * 31);
  const blotches = (ctx: CanvasRenderingContext2D, b: Band, n: number, style: (a: number) => string, size: number) => {
    for (let i = 0; i < n; i++) {
      const x = rng.next() * UW;
      const y = row(b.from + (b.to - b.from) * rng.next());
      const r = size * (0.5 + rng.next());
      for (const ox of [-UW, 0, UW]) {
        const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        g.addColorStop(0, style(0.5 + 0.5 * rng.next()));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y - r * 0.6, r * 2, r * 1.2);
      }
    }
  };
  const all: Band = { from: 0, to: 1 };
  const foot: Band = { from: 0, to: z.foot };
  const belly: Band = { from: z.foot, to: z.rimStart };
  const rim: Band = { from: z.rimStart, to: z.innerStart };
  const inner: Band = { from: z.innerStart, to: 1 };
  const wet: Band = { from: z.fill, to: 1 };
  const line = (v: number, h: number): Band => ({ from: v - h / 2, to: v + h / 2 });

  band(bc, all, "#808080");
  band(mc, all, vessel === "a" ? "#ffffff" : "#000000");

  if (vessel === "a") {
    // tarnished bell metal: the main read is the dark belly; the gold only on the crest and the lugs
    band(cc, all, lin(0.55, 0.42, 0.22));
    band(rc, all, grey(0.45));
    blotches(cc, belly, 70, (a) => `rgba(${hexRgb(lin(0.42, 0.31, 0.16))},${0.55 * a})`, 34);
    blotches(rc, belly, 70, (a) => `rgba(153,153,153,${0.5 * a})`, 34);
    band(cc, foot, lin(0.25, 0.18, 0.1));
    band(rc, foot, grey(0.7));
    // the step under the bead holds oxide too
    band(cc, line(z.rimStart, 0.012), lin(0.3, 0.22, 0.12));
    // burnished where hands polish: strongest on the crest
    const crestBand: Band = { from: z.rimStart + 0.004, to: z.innerStart - 0.002 };
    band(cc, crestBand, lin(0.78, 0.64, 0.33));
    band(rc, crestBand, grey(0.32));
    band(cc, line(z.crest, 0.02), lin(0.91, 0.78, 0.42));
    band(rc, line(z.crest, 0.02), grey(0.25));
    // inside: tarnish, darker and always wet below the fill line
    band(cc, inner, lin(0.48, 0.36, 0.19));
    band(cc, wet, lin(0.35, 0.26, 0.14));
    band(rc, wet, grey(0.35));
    // faint lathe-turning rings on the belly, and one incised double line under the rim
    for (let v = z.foot; v < z.rimStart; v += 0.006) {
      cc.fillStyle = rng.next() < 0.5 ? "rgba(255,230,180,0.05)" : "rgba(30,20,8,0.06)";
      cc.fillRect(0, row(v), UW, 1);
      bc.fillStyle = rng.next() < 0.5 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
      bc.fillRect(0, row(v), UW, 1);
    }
    for (const dv of [-0.004, 0.004]) {
      cc.fillStyle = "rgba(25,16,6,0.5)";
      cc.fillRect(0, row(z.band + dv), UW, 1.2);
      bc.fillStyle = "rgba(0,0,0,0.6)";
      bc.fillRect(0, row(z.band + dv), UW, 1.2);
    }
  } else if (vessel === "b") {
    // salt-and-pepper granite of the city's own grey rock, cooler than the kerb's buffs; pick-dressed outside, the rim
    // worn smooth, the inner wall polished by water
    const img = cc.createImageData(UW, UH);
    const d = img.data;
    for (let y = 0; y < UH; y += 1) {
      for (let x = 0; x < UW; x += 1) {
        const cell = vnoise2(Math.floor(x / 2) * 0.9, Math.floor(y / 2) * 0.9);
        const r = rng.next();
        let c: [number, number, number];
        if (cell > 0.55 || r < 0.05) c = [28, 28, 30];
        else if (cell < -0.35) c = [196, 192, 186];
        else c = [140 + 20 * cell, 142 + 20 * cell, 146 + 20 * cell];
        const o = (y * UW + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
    }
    cc.putImageData(img, 0, 0);
    band(rc, all, grey(0.85));
    band(rc, rim, grey(0.5));
    band(cc, rim, "rgba(40,40,44,0.12)");
    band(rc, inner, grey(0.4));
    band(cc, wet, "rgba(20,22,26,0.22)");
    // chisel strokes on the dressed outside
    bc.strokeStyle = "rgba(0,0,0,0.5)";
    bc.lineWidth = 1;
    for (let i = 0; i < 2600; i++) {
      const x = rng.next() * UW;
      const y = row(z.foot * 0.2 + (z.rimStart - z.foot * 0.2) * rng.next());
      const a = 0.9 + (rng.next() - 0.5) * 0.5;
      const l = 2 + rng.next() * 4;
      bc.beginPath();
      bc.moveTo(x, y);
      bc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      bc.stroke();
    }
    // a little moss at the foot, from the kerb's mosses, sparingly
    for (let i = 0; i < 90; i++) {
      const x = rng.next() * UW;
      const y = row(rng.next() * z.foot * 1.4 + 0.02);
      cc.fillStyle = rng.pick(["rgba(44,85,32,0.7)", "rgba(92,128,48,0.6)", "rgba(126,163,58,0.5)"]);
      cc.beginPath();
      cc.arc(x, y, 1 + rng.next() * 2.5, 0, Math.PI * 2);
      cc.fill();
    }
  } else {
    // duck-egg glaze over stoneware: pooling deeper in the inner curve, breaking to toasted clay on the rim's edge and
    // the foot ring, a hand-painted copper-lustre line under the rim, a fine crackle
    band(cc, all, "#8fc3b6");
    band(rc, all, grey(0.22));
    const pool = cc.createLinearGradient(0, row(z.innerStart), 0, row(1));
    pool.addColorStop(0, "rgba(91,153,139,0)");
    pool.addColorStop(0.5, "rgba(91,153,139,0.7)");
    pool.addColorStop(1, "rgba(80,140,126,1)");
    cc.fillStyle = pool;
    cc.fillRect(0, row(1) - 1, UW, row(z.innerStart) - row(1) + 2);
    band(cc, foot, "#a8744c");
    band(rc, foot, grey(0.85));
    band(cc, line(z.crest, 0.014), "#b07e56");
    band(rc, line(z.crest, 0.014), grey(0.8));
    const lustre = line(z.band, 0.012);
    band(cc, lustre, lin(0.93, 0.62, 0.52));
    band(rc, lustre, grey(0.35));
    band(mc, lustre, "#ffffff");
    cc.strokeStyle = "rgba(40,70,62,0.16)";
    bc.strokeStyle = "rgba(0,0,0,0.45)";
    for (let i = 0; i < 260; i++) {
      let x = rng.next() * UW;
      let y = row(z.foot + (1 - z.foot) * rng.next());
      cc.beginPath();
      bc.beginPath();
      cc.moveTo(x, y);
      bc.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rng.next() - 0.5) * 18;
        y += (rng.next() - 0.5) * 12;
        cc.lineTo(x, y);
        bc.lineTo(x, y);
      }
      cc.lineWidth = 0.8;
      bc.lineWidth = 0.8;
      cc.stroke();
      bc.stroke();
    }
  }

  // the fill line: a pale mineral ring 3 mm wide, faint repeats a few millimetres below (every option)
  const px = 1 / UH;
  band(cc, line(z.fill, 2.5 * px), vessel === "c" ? "rgba(214,226,214,0.6)" : lin(0.62, 0.58, 0.48));
  band(rc, line(z.fill, 2.5 * px), grey(0.8));
  band(cc, line(z.fill - 0.012, 1.4 * px), "rgba(200,190,160,0.25)");
  band(cc, line(z.fill - 0.022, 1.2 * px), "rgba(200,190,160,0.15)");
  if (vessel === "a") {
    // verdigris speckles at the inner waterline and in the foot's recess, almost no metal there
    for (const b of [line(z.fill + 0.004, 0.02), { from: 0, to: z.foot * 0.8 }]) {
      for (let i = 0; i < 160; i++) {
        const x = rng.next() * UW;
        const y = row(b.from + (b.to - b.from) * rng.next());
        const r = 0.8 + rng.next() * 1.8;
        cc.fillStyle = `rgba(${hexRgb(lin(0.2, 0.42, 0.33))},0.8)`;
        rc.fillStyle = grey(0.85);
        mc.fillStyle = grey(0.1);
        for (const ctx of [cc, rc, mc]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // roughness in green, metalness in blue, one texture for both maps
  const orm = makeCanvas(UW, UH);
  const oc = orm.getContext("2d")!;
  const rd = rc.getImageData(0, 0, UW, UH).data;
  const md = mc.getImageData(0, 0, UW, UH).data;
  const out = oc.createImageData(UW, UH);
  for (let i = 0; i < rd.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = rd[i];
    out.data[i + 2] = md[i];
    out.data[i + 3] = 255;
  }
  oc.putImageData(out, 0, 0);

  const mapT = toTexture(colour);
  mapT.wrapS = THREE.RepeatWrapping;
  const ormT = dataTexture(orm);
  ormT.wrapS = THREE.RepeatWrapping;
  const bumpT = dataTexture(bump);
  bumpT.wrapS = THREE.RepeatWrapping;
  cache.set(key + ":map", mapT);
  cache.set(key + ":orm", ormT);
  cache.set(key + ":bump", bumpT);
  return { map: mapT, orm: ormT, bump: bumpT };
}

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Light

/** A soft round glow, white at the centre, for the seed of light's halo. */
export function haloTexture(): THREE.CanvasTexture {
  return cached("halo", () => {
    const S = 64;
    const c = makeCanvas(S, S);
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.45)");
    g.addColorStop(0.6, "rgba(255,255,255,0.1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The lotus petal, v2

export interface LotusPetalPaint {
  /** the claw at the base */
  base: string;
  /** the lower body */
  low: string;
  /** the upper body */
  mid: string;
  /** the tip and the upper margins */
  tip: string;
  /** the fine veins, deepest toward the tip */
  vein: string;
}

const PETAL_W = 128;
const PETAL_H = 256;
/** Fine longitudinal veins per petal (the art direction's 15 primaries, with finer ones between). */
const PETAL_VEINS = 23;

/** The veins' paths across u (0..1 across the blade at every row, so they fan with the petal's width). */
function petalVeinXs(seed: number): { x0: number; x1: number; wob: number; w: number }[] {
  const rng = new Rng(seed * 71 + 5);
  const out: { x0: number; x1: number; wob: number; w: number }[] = [];
  for (let i = 0; i < PETAL_VEINS; i++) {
    const x1 = (i + 0.5) / PETAL_VEINS + (rng.next() - 0.5) * 0.012;
    // they gather toward the middle of the claw
    const x0 = 0.5 + (x1 - 0.5) * 0.55;
    out.push({ x0, x1, wob: rng.next() * 6.28, w: i % 2 === 0 ? 1.2 : 0.75 });
  }
  return out;
}

function strokePetalVeins(ctx: CanvasRenderingContext2D, seed: number, style: (v: number) => string, widthScale: number) {
  for (const vein of petalVeinXs(seed)) {
    const steps = 24;
    for (let k = 0; k < steps; k++) {
      const va = k / steps;
      const vb = (k + 1) / steps;
      const xa = vein.x0 + (vein.x1 - vein.x0) * Math.pow(va, 0.6) + 0.006 * Math.sin(va * 9 + vein.wob);
      const xb = vein.x0 + (vein.x1 - vein.x0) * Math.pow(vb, 0.6) + 0.006 * Math.sin(vb * 9 + vein.wob);
      ctx.strokeStyle = style((va + vb) / 2);
      ctx.lineWidth = vein.w * widthScale * (0.7 + 0.5 * va);
      ctx.beginPath();
      ctx.moveTo(xa * PETAL_W, (1 - va) * PETAL_H);
      ctx.lineTo(xb * PETAL_W, (1 - vb) * PETAL_H);
      ctx.stroke();
    }
  }
}

/**
 * A lotus petal painted for the v2 petal (geometry makeLotusPetalGeometry: u across the blade, v from the claw to the
 * tip): a cream-white claw, a pale blush body deepening to a soft rose at the tip and along the upper margins (never
 * the magenta of the first renders), and fine veins fanning from the base, a deeper pink toward the tip.
 */
export function lotusPetalTextureV2(c: LotusPetalPaint, seed = 3): THREE.CanvasTexture {
  return cached("petal2:" + JSON.stringify(c) + seed, () => {
    const cv = makeCanvas(PETAL_W, PETAL_H);
    const ctx = cv.getContext("2d")!;
    // rows run top-down: y = 0 is the tip
    const g = ctx.createLinearGradient(0, PETAL_H, 0, 0);
    g.addColorStop(0, c.base);
    g.addColorStop(0.1, c.base);
    g.addColorStop(0.3, c.low);
    g.addColorStop(0.62, c.mid);
    g.addColorStop(0.9, c.tip);
    g.addColorStop(1, c.tip);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PETAL_W, PETAL_H);
    // the upper margins flush deeper; the middle of the blade stays paler
    for (const [x0, x1, flip] of [
      [0, 0.22, false],
      [0.78, 1, true],
    ] as const) {
      const m = ctx.createLinearGradient(x0 * PETAL_W, 0, x1 * PETAL_W, 0);
      m.addColorStop(flip ? 1 : 0, rgba(c.tip, 0.55));
      m.addColorStop(flip ? 0 : 1, rgba(c.tip, 0));
      ctx.fillStyle = m;
      ctx.fillRect(x0 * PETAL_W, 0, (x1 - x0) * PETAL_W, PETAL_H * 0.55);
    }
    const mid = ctx.createLinearGradient(0.3 * PETAL_W, 0, 0.7 * PETAL_W, 0);
    mid.addColorStop(0, rgba(c.low, 0));
    mid.addColorStop(0.5, rgba(c.low, 0.35));
    mid.addColorStop(1, rgba(c.low, 0));
    ctx.fillStyle = mid;
    ctx.fillRect(0, PETAL_H * 0.25, PETAL_W, PETAL_H * 0.6);
    // a soft mottle, as real petals have
    const rng = new Rng(seed * 13 + 1);
    for (let i = 0; i < 60; i++) {
      const x = rng.next() * PETAL_W;
      const y = rng.next() * PETAL_H;
      const r = 6 + rng.next() * 16;
      const m = ctx.createRadialGradient(x, y, 0, x, y, r);
      m.addColorStop(0, rng.next() < 0.5 ? "rgba(255,255,255,0.06)" : rgba(c.tip, 0.05));
      m.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = m;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // the veins: faint low down, deeper pink toward the tip
    ctx.lineCap = "round";
    strokePetalVeins(ctx, seed, (v) => rgba(c.vein, 0.04 + 0.26 * Math.pow(v, 1.3)), 0.9);
    // the claw's faint yellow-green heart at the very base
    const claw = ctx.createLinearGradient(0, PETAL_H, 0, PETAL_H * 0.86);
    claw.addColorStop(0, "rgba(226,222,160,0.55)");
    claw.addColorStop(1, "rgba(226,222,160,0)");
    ctx.fillStyle = claw;
    ctx.fillRect(0, PETAL_H * 0.86, PETAL_W, PETAL_H * 0.14);
    return toTexture(cv);
  });
}

/** The v2 petal's vein relief. */
export function lotusPetalNormalV2(seed = 3): THREE.CanvasTexture {
  return cached("petal2N:" + seed, () => {
    const h = makeCanvas(PETAL_W, PETAL_H);
    const ctx = h.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PETAL_W, PETAL_H);
    ctx.filter = "blur(0.8px)";
    ctx.lineCap = "round";
    strokePetalVeins(ctx, seed, (v) => `rgba(255,255,255,${0.35 + 0.4 * v})`, 1.3);
    ctx.filter = "none";
    return dataTexture(heightToNormal(h, 1.2, false));
  });
}

/** The v2 petal's warm-glow mask: strongest at the claw and along the veins' lower halves. */
export function lotusPetalEmissiveV2(seed = 3): THREE.CanvasTexture {
  return cached("petal2E:" + seed, () => {
    const cv = makeCanvas(PETAL_W / 2, PETAL_H / 2);
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, cv.height, 0, 0);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, "#9a9a9a");
    g.addColorStop(1, "#303030");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
    return toTexture(cv);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The koi

export type KoiPaint = "kohaku" | "ogon" | "sanke";

const KOI_W = 512;
const KOI_H = 256;

interface Patch {
  /** along the body (u) and round it (v, 0.5 the back), half sizes, and a softness of the wobbling edge */
  u: number;
  v: number;
  hu: number;
  hv: number;
  wob: number;
}

/** A rounded patch's inside test with a wobbling (but crisp) edge: the koi keepers' kiwa. */
function inPatch(p: Patch, u: number, v: number, seed: number): number {
  const du = (u - p.u) / p.hu;
  const dv = (v - p.v) / p.hv;
  const d = Math.pow(Math.abs(du), 2.6) + Math.pow(Math.abs(dv), 2.2);
  const n = vnoise2(u * 18 + seed, v * 14 - seed) * p.wob + vnoise2(u * 45 - seed, v * 40) * p.wob * 0.35;
  return 1 - smoothstep(0.92, 1.0, d + n);
}

/**
 * A koi's skin, u along the body (snout 0 .. tail stalk 1) and v round it from the belly (0.5 the back): kohaku white
 * with a red head patch and two steps of red down the back; yamabuki ogon all metallic gold, paler under; sanke white
 * with red steps and small black marks on the back, none on the head. A faint net of scales over all; small dark eyes
 * low on the head's sides (a realistic fish, not a face).
 */
export function koiTexture(kind: KoiPaint, seed: number): THREE.CanvasTexture {
  return cached("koi:" + kind + seed, () => {
    const cv = makeCanvas(KOI_W, KOI_H);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(KOI_W, KOI_H);
    const d = img.data;
    const white: [number, number, number] = [244, 240, 231];
    const red: [number, number, number] = [214, 62, 30];
    const black: [number, number, number] = [26, 24, 26];
    const gold: [number, number, number] = [232, 178, 58];
    const reds: Patch[] =
      kind === "kohaku"
        ? [
            { u: 0.17, v: 0.5, hu: 0.1, hv: 0.22, wob: 0.18 },
            { u: 0.42, v: 0.5, hu: 0.13, hv: 0.27, wob: 0.25 },
            { u: 0.66, v: 0.49, hu: 0.09, hv: 0.22, wob: 0.25 },
          ]
        : kind === "sanke"
          ? [
              { u: 0.22, v: 0.53, hu: 0.12, hv: 0.24, wob: 0.22 },
              { u: 0.52, v: 0.47, hu: 0.13, hv: 0.25, wob: 0.28 },
            ]
          : [];
    const sumi: Patch[] =
      kind === "sanke"
        ? [
            { u: 0.36, v: 0.6, hu: 0.03, hv: 0.05, wob: 0.3 },
            { u: 0.58, v: 0.4, hu: 0.035, hv: 0.06, wob: 0.3 },
            { u: 0.7, v: 0.55, hu: 0.025, hv: 0.045, wob: 0.3 },
            { u: 0.47, v: 0.66, hu: 0.02, hv: 0.035, wob: 0.3 },
          ]
        : [];
    for (let y = 0; y < KOI_H; y++) {
      // canvas rows run top-down; v = 1 at the top row
      const v = 1 - (y + 0.5) / KOI_H;
      const back = 1 - Math.abs(v - 0.5) * 2;
      for (let x = 0; x < KOI_W; x++) {
        const u = (x + 0.5) / KOI_W;
        let c: [number, number, number];
        if (kind === "ogon") {
          // metallic gold, a darker line down the back, paler under
          const k = 0.86 + 0.18 * back - 0.1 * Math.exp(-(((v - 0.5) / 0.05) ** 2));
          c = [gold[0] * k + 18 * (1 - back), gold[1] * k + 24 * (1 - back), gold[2] * k + 30 * (1 - back)];
        } else {
          c = [white[0], white[1], white[2]];
          let r = 0;
          for (const p of reds) r = Math.max(r, inPatch(p, u, v, seed));
          // the nose and the tail stalk stay white
          r *= smoothstep(0.035, 0.07, u) * (1 - smoothstep(0.78, 0.86, u));
          if (r > 0) c = [c[0] + (red[0] - c[0]) * r, c[1] + (red[1] - c[1]) * r, c[2] + (red[2] - c[2]) * r];
          let k = 0;
          for (const p of sumi) k = Math.max(k, inPatch(p, u, v, seed + 3));
          if (k > 0) c = [c[0] + (black[0] - c[0]) * k, c[1] + (black[1] - c[1]) * k, c[2] + (black[2] - c[2]) * k];
          // the belly is a touch warmer and duller
          const belly = 1 - back;
          c = [c[0] * (1 - 0.05 * belly), c[1] * (1 - 0.06 * belly), c[2] * (1 - 0.1 * belly)];
        }
        // scales: a faint diamond net, finer toward the head and the belly
        const su = u * 46;
        const sv = v * 30 + (Math.floor(su) % 2) * 0.5;
        const fu = su - Math.floor(su);
        const fv = sv - Math.floor(sv);
        const edge = Math.min(fu, 1 - fu, Math.abs(fv - 0.5) * 2 * 0.6 + fu * 0.4);
        // (none on the head, which is smooth skin: it keeps its paint, not black)
        const scale = u > 0.12 ? 0.95 + 0.07 * smoothstep(0.0, 0.25, edge) : 1;
        // the eyes: small, dark, low on the sides of the head
        const ev = Math.min(Math.abs(v - 0.31), Math.abs(v - 0.69));
        const eye = 1 - smoothstep(0.012, 0.02, Math.hypot((u - 0.07) * 1.6, ev));
        const ring = 1 - smoothstep(0.02, 0.026, Math.hypot((u - 0.07) * 1.6, ev));
        const o = (y * KOI_W + x) * 4;
        const shade = scale * (1 - 0.12 * ring);
        d[o] = Math.min(255, c[0] * shade * (1 - 0.82 * eye));
        d[o + 1] = Math.min(255, c[1] * shade * (1 - 0.84 * eye));
        d[o + 2] = Math.min(255, c[2] * shade * (1 - 0.82 * eye));
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(cv);
  });
}

/** A koi's fins: fine rays from the root to the edge, opaque at the root, fading to a filmy edge (alpha in the map). */
export function koiFinTexture(kind: KoiPaint): THREE.CanvasTexture {
  return cached("koiFin:" + kind, () => {
    const S = 128;
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const base: [number, number, number] = kind === "ogon" ? [236, 190, 84] : [246, 242, 234];
    for (let y = 0; y < S; y++) {
      const v = 1 - (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S;
        // rays run along u, at intervals across v
        const ray = Math.pow(Math.abs(Math.sin(v * Math.PI * 22)), 10);
        const k = 1 - 0.18 * ray;
        // sanke's pectorals carry a few dark stripes; kohaku's a faint warm blush near the root
        let c: [number, number, number] = [base[0] * k, base[1] * k, base[2] * k];
        if (kind === "sanke" && u < 0.55 && Math.abs(Math.sin(v * Math.PI * 4 + 0.6)) > 0.93) c = [40, 36, 38];
        if (kind === "kohaku") c = [c[0], c[1] * (1 - 0.05 * (1 - u)), c[2] * (1 - 0.08 * (1 - u))];
        const o = (y * S + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = Math.round(255 * (0.9 - 0.55 * Math.pow(u, 1.3)) * (0.85 + 0.15 * ray));
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(cv);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The pond's hard surfaces

/** The lotus pot: dark fired clay under a film of algae, banded along its profile (u round, v up). */
export function potTexture(): THREE.CanvasTexture {
  return cached("pot", () => {
    const W = 256;
    const H = 128;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    // under a season's film of algae and silt the clay reads a dark olive silt, the tank floor's colour, rim and all
    ctx.fillStyle = "#4a4735";
    ctx.fillRect(0, 0, W, H);
    const rng = new Rng(41);
    for (let i = 0; i < 160; i++) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      const r = 4 + rng.next() * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rng.next() < 0.6 ? "rgba(84,96,52,0.4)" : "rgba(52,40,28,0.3)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      for (const ox of [-W, 0, W]) ctx.fillRect(x - r + ox, y - r, r * 2, r * 2);
    }
    const t = toTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}
