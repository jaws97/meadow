// Canvas painters for the courtyard (browser only, drawn once and cached, never disposed), in the style of
// components/lotus/textures.ts: granite's salt and pepper; laterite's porous rust-brown blocks in courses with their
// pitted, worm-holed faces and recessed joints; brass's tarnish; the banana's leaf with its pale midrib and fine
// parallel veins; the areca's ringed trunk; terracotta roof tiles; a dragonfly's netted wing. Original painting, no
// photographs.
import * as THREE from "three";
import { makeCanvas } from "@/lib/plant/textures";
import { Rng, smoothstep, vnoise2 } from "@/lib/plant/prng";

const cache = new Map<string, THREE.Texture>();

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

export interface MapPair {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

const pairs = new Map<string, MapPair>();

function cachedPair(key: string, make: () => MapPair): MapPair {
  let p = pairs.get(key);
  if (!p) {
    p = make();
    pairs.set(key, p);
  }
  return p;
}

function colourTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function dataTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Tiling value noise on a torus: wraps at the canvas's edges. */
function tnoise(x: number, y: number, W: number, H: number, freq: number, seed: number): number {
  const a = (x / W) * Math.PI * 2;
  const b = (y / H) * Math.PI * 2;
  const r = freq / (Math.PI * 2);
  return vnoise2(Math.cos(a) * r + seed + Math.sin(b) * r * 0.37, Math.sin(a) * r + Math.cos(b) * r + seed * 0.7) * 0.6 + vnoise2(Math.cos(b) * r * 1.9 + seed * 1.3, Math.sin(b) * r * 1.9 + Math.cos(a) * r * 0.9) * 0.4;
}

/** A tangent-space normal map from a grey height canvas (Sobel), wrapping both ways. */
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
// Granite

/** Metres one granite tile covers. */
export const GRANITE_TILE = 0.6;

/** Grey granite: a soft mottle, black mica flecks, white feldspar specks, a few quartz glints; and its fine grain. */
export function graniteTextures(): MapPair {
  return cachedPair("granite", () => {
    const S = 512;
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext("2d")!;
    const hv = makeCanvas(S, S);
    const hctx = hv.getContext("2d")!;
    const img = ctx.createImageData(S, S);
    const himg = hctx.createImageData(S, S);
    const d = img.data;
    const hd = himg.data;
    const rng = new Rng(611);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const m = tnoise(x, y, S, S, 5, 3) * 0.5 + 0.5;
        const m2 = tnoise(x, y, S, S, 23, 9) * 0.5 + 0.5;
        const k = 0.9 + 0.1 * m + 0.06 * m2 + (rng.next() - 0.5) * 0.08;
        const o = (y * S + x) * 4;
        d[o] = 186 * k;
        d[o + 1] = 183 * k;
        d[o + 2] = 179 * k;
        d[o + 3] = 255;
        const hh = 128 + (m2 - 0.5) * 50 + (rng.next() - 0.5) * 40;
        hd[o] = hd[o + 1] = hd[o + 2] = hh;
        hd[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    hctx.putImageData(himg, 0, 0);
    const fleck = (n: number, colours: string[], r0: number, r1: number, h: string) => {
      for (let i = 0; i < n; i++) {
        const x = rng.next() * S;
        const y = rng.next() * S;
        const r = r0 + rng.next() * (r1 - r0);
        const c = rng.pick(colours);
        const a = rng.next() * Math.PI;
        for (const ox of [-S, 0, S]) {
          for (const oy of [-S, 0, S]) {
            if (x + ox < -r1 * 2 || x + ox > S + r1 * 2 || y + oy < -r1 * 2 || y + oy > S + r1 * 2) continue;
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.ellipse(x + ox, y + oy, r, r * (0.45 + 0.5 * rng.next()), a, 0, Math.PI * 2);
            ctx.fill();
            hctx.fillStyle = h;
            hctx.beginPath();
            hctx.ellipse(x + ox, y + oy, r, r * 0.7, a, 0, Math.PI * 2);
            hctx.fill();
          }
        }
      }
    };
    // black mica and hornblende, crisp, mostly fine with a few larger crystals; white feldspar and quartz; a faint pink
    // of potash feldspar here and there
    fleck(5200, ["rgba(30,29,28,0.7)", "rgba(44,42,40,0.6)", "rgba(60,58,55,0.55)"], 0.4, 1.1, "rgba(96,96,96,0.5)");
    fleck(900, ["rgba(22,22,22,0.85)", "rgba(34,32,30,0.8)"], 1.2, 2.6, "rgba(90,90,90,0.55)");
    fleck(2600, ["rgba(236,234,230,0.55)", "rgba(222,219,212,0.5)", "rgba(246,244,240,0.45)"], 0.6, 2.0, "rgba(170,170,170,0.45)");
    fleck(700, ["rgba(206,160,150,0.4)", "rgba(190,150,142,0.36)", "rgba(214,176,166,0.32)"], 1.0, 2.8, "rgba(140,140,140,0.3)");
    // weathering over the grain: soft dark stains and paler worn patches, a few centimetres to a hand across
    for (let i = 0; i < 70; i++) {
      const x = rng.next() * S;
      const y = rng.next() * S;
      const r = 20 + rng.next() * 70;
      const dark = rng.next() < 0.6;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, dark ? "rgba(40,42,36,0.09)" : "rgba(226,222,214,0.08)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    const map = colourTexture(cv);
    const normal = dataTexture(heightToNormal(hv, 1.1));
    return { map, normal };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Laterite

/** Metres the laterite texture covers along the wall and up it. */
export const LATERITE_TILE: readonly [number, number] = [2.4, 1.2];

/**
 * Laterite blocks in courses (about 40 x 20 cm faces, the size cut from the quarries' beds, in mortar a little
 * recessed): each block its own rust, ochre or brown, its face pitted with the stone's worm-like cavities (dark holes
 * with paler ochre rims), weathered grey-dark in patches. And the height for its normal map: joints and pits low.
 */
export function lateriteTextures(): MapPair {
  return cachedPair("laterite", () => {
    const W = 1024;
    const H = 512;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    const hv = makeCanvas(W, H);
    const hctx = hv.getContext("2d")!;
    const rng = new Rng(907);
    // mortar first
    ctx.fillStyle = "#6b5747";
    ctx.fillRect(0, 0, W, H);
    hctx.fillStyle = "#5a5a5a";
    hctx.fillRect(0, 0, W, H);
    // five courses of slightly different heights (18-23 cm), summing to the tile's metre
    const courseH = [0.2, 0.18, 0.23, 0.19, 0.2].map((c) => c * H);
    const joint = 4;
    const BLOCKS = ["#8a4a30", "#93583a", "#7a4632", "#9c6440", "#86503a", "#946a46", "#6e4434", "#985a3c", "#a2754e", "#7c4e3c"];
    let cy = 0;
    for (let r = 0; r < 5; r++) {
      const course = courseH[r];
      const start = -rng.next() * 200;
      const end = start + W;
      let x = start;
      while (x < end - 1) {
        let len = 170 + rng.next() * 150;
        if (end - (x + len) < 80) len = end - x;
        const y0 = cy + joint / 2;
        const bw = len - joint;
        const bh = course - joint;
        const base = rng.pick(BLOCKS);
        const copies = [0];
        if (x < 0) copies.push(W);
        if (x + len > W) copies.push(-W);
        // a block's face: its edges a little ragged, its corners worn round
        const outline: [number, number][] = [];
        const edge = (x0: number, y1: number, x1: number, y2: number, n: number) => {
          for (let k = 0; k < n; k++) {
            const t = k / n;
            outline.push([x0 + (x1 - x0) * t + (rng.next() - 0.5) * 2.2, y1 + (y2 - y1) * t + (rng.next() - 0.5) * 2.2]);
          }
        };
        const c = 5 + rng.next() * 5;
        edge(c, 0, bw - c, 0, 8);
        edge(bw, c, bw, bh - c, 3);
        edge(bw - c, bh, c, bh, 8);
        edge(0, bh - c, 0, c, 3);
        for (const ox of copies) {
          const bx = x + ox + joint / 2;
          for (const [c2, col] of [
            [ctx, base],
            [hctx, "#b4b4b4"],
          ] as const) {
            c2.fillStyle = col;
            c2.beginPath();
            outline.forEach(([px, py], k) => (k === 0 ? c2.moveTo(bx + px, y0 + py) : c2.lineTo(bx + px, y0 + py)));
            c2.closePath();
            c2.fill();
          }
        }
        x += len;
      }
      cy += course;
    }
    // per pixel over the blocks: mottle, ochre streaks, the grey-black weathering crust, and the stone's own pores: the
    // zero lines of a warped noise make meandering tubes (laterite's vermiform cavities), dark and low, some of them
    // filled with pale clay; denser in some blocks than others
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const himg = hctx.getImageData(0, 0, W, H);
    const hd = himg.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const onBlock = hd[o] > 120;
        const n1 = tnoise(x, y, W, H, 9, 2) * 0.5 + 0.5;
        const n2 = tnoise(x, y, W, H, 40, 5) * 0.5 + 0.5;
        const patina = smoothstep(0.45, 0.85, tnoise(x, y, W, H, 4, 11) * 0.5 + 0.5);
        const ochre = smoothstep(0.55, 0.9, tnoise(x, y, W, H, 14, 17) * 0.5 + 0.5);
        const grit = (rng.next() - 0.5) * 18;
        let r = d[o] * (0.88 + 0.22 * n1) + grit;
        let g = d[o + 1] * (0.88 + 0.2 * n1) + grit * 0.8;
        let b = d[o + 2] * (0.9 + 0.18 * n1) + grit * 0.6;
        r += 30 * ochre;
        g += 22 * ochre;
        b += 4 * ochre;
        let h = hd[o] * (0.92 + 0.16 * n2);
        if (onBlock) {
          const wx = x + 5 * tnoise(x, y, W, H, 20, 21);
          const wy = y + 5 * tnoise(x, y, W, H, 20, 23);
          const density = smoothstep(0.2, 0.8, tnoise(x, y, W, H, 5, 29) * 0.5 + 0.5);
          // tubes a few millimetres wide, broken up by a second noise so they read as pits and short channels
          const tube = Math.abs(tnoise(wx, wy, W, H, 64, 31));
          const breakUp = smoothstep(0.35, 0.6, tnoise(x, y, W, H, 60, 33) * 0.5 + 0.5);
          const fine = Math.abs(tnoise(wx, wy, W, H, 240, 37));
          const pore = Math.max((1 - smoothstep(0.02, 0.06 + 0.05 * density, tube)) * breakUp, 0.7 * (1 - smoothstep(0.014, 0.05, fine)) * density);
          const clay = smoothstep(0.62, 0.8, tnoise(x, y, W, H, 11, 41) * 0.5 + 0.5);
          // a pore: dark and deep, its walls stained black-brown with iron, or (fewer) filled with pale yellow clay
          const fill = clay * 0.45;
          r = r * (1 - pore) + (fill * 196 + (1 - fill) * 30) * pore;
          g = g * (1 - pore) + (fill * 170 + (1 - fill) * 17) * pore;
          b = b * (1 - pore) + (fill * 116 + (1 - fill) * 12) * pore;
          h -= pore * (1 - fill) * 90;
        }
        const crust = 0.48 * patina;
        r = r * (1 - crust) + 58 * crust;
        g = g * (1 - crust) + 52 * crust;
        b = b * (1 - crust) + 46 * crust;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        hd[o] = hd[o + 1] = hd[o + 2] = Math.max(0, Math.min(255, h));
      }
    }
    ctx.putImageData(img, 0, 0);
    hctx.putImageData(himg, 0, 0);
    // the stone's open vesicles, a few millimetres to a centimetre and a half across: dark iron-stained holes with a
    // paler ochre lip, deep in the height map, wrapping at the tile's edges
    for (let i = 0; i < 1400; i++) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      // in drifts, as the stone's vesicles gather in some beds and not others; mostly small, now and then a big one
      if (tnoise(x, y, W, H, 6, 47) * 0.5 + 0.5 < 0.55 + 0.3 * rng.next()) continue;
      const r = 0.9 + Math.pow(rng.next(), 3) * 6;
      const a = rng.next() * Math.PI;
      const e = 0.55 + 0.45 * rng.next();
      for (const ox of [-W, 0, W]) {
        if (x + ox < -10 || x + ox > W + 10) continue;
        ctx.fillStyle = "rgba(196,150,96,0.35)";
        ctx.beginPath();
        ctx.ellipse(x + ox, y, r * 1.35, r * 1.35 * e, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rng.next() < 0.75 ? "rgba(28,16,12,0.9)" : "rgba(58,30,20,0.85)";
        ctx.beginPath();
        ctx.ellipse(x + ox, y, r, r * e, a, 0, Math.PI * 2);
        ctx.fill();
        hctx.fillStyle = "rgba(20,20,20,0.9)";
        hctx.beginPath();
        hctx.ellipse(x + ox, y, r, r * e, a, 0, Math.PI * 2);
        hctx.fill();
      }
    }
    const map = colourTexture(cv);
    const normal = dataTexture(heightToNormal(hv, 1.1));
    return { map, normal };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Brass, wood, tiles

/** Brass's tarnish: warm and bright where polished, browner and duller in patches (a colour multiplier). */
export function brassTexture(): THREE.CanvasTexture {
  return cached("brass", () => {
    const S = 256;
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = tnoise(x, y, S, S, 6, 4) * 0.5 + 0.5;
        const f = tnoise(x, y, S, S, 30, 8) * 0.5 + 0.5;
        const tarnish = smoothstep(0.5, 0.9, n);
        const o = (y * S + x) * 4;
        d[o] = 255 * (1 - 0.35 * tarnish) * (0.94 + 0.06 * f);
        d[o + 1] = 255 * (1 - 0.42 * tarnish) * (0.94 + 0.06 * f);
        d[o + 2] = 255 * (1 - 0.55 * tarnish) * (0.94 + 0.06 * f);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return colourTexture(cv);
  });
}

/** Old teak: dark brown with a long grain (for the veranda's pillars). */
export function teakTexture(): THREE.CanvasTexture {
  return cached("teak", () => {
    const W = 128;
    const H = 512;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const grain = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 9 + tnoise(x, y, W, H, 3, 2) * 3);
        const k = 0.75 + 0.25 * grain;
        const o = (y * W + x) * 4;
        d[o] = 92 * k;
        d[o + 1] = 58 * k;
        d[o + 2] = 36 * k;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return colourTexture(cv);
  });
}

/** Terracotta roof tiles in rows (half-round over-and-under), weathered dark, for the veranda's eave. */
export function tileTexture(): THREE.CanvasTexture {
  return cached("tiles", () => {
    const S = 256;
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#5e2f1e";
    ctx.fillRect(0, 0, S, S);
    const rng = new Rng(77);
    const cols = 8;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c / cols) * S;
        const y = (r / rows) * S;
        const w = S / cols;
        const h = S / rows;
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        const base = rng.pick(["#9a4a2c", "#8c4228", "#a65634", "#7e3c26"]);
        g.addColorStop(0, "#3c1e14");
        g.addColorStop(0.3, base);
        g.addColorStop(0.6, base);
        g.addColorStop(1, "#3c1e14");
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y, w - 2, h - 3);
        ctx.fillStyle = "rgba(30,20,16,0.35)";
        ctx.fillRect(x, y + h - 6, w, 6);
      }
    }
    return colourTexture(cv);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Plants

/**
 * The banana's leaf, u across (0 one edge, 0.5 the midrib, 1 the other), v from the stalk to the tip: a fresh
 * yellow-green, darker toward the margins, the pale midrib, fine parallel veins running out from it at a slant, the
 * margins browning and frayed. Alpha is solid (the tears are cut in the geometry).
 */
export function bananaLeafTexture(): THREE.CanvasTexture {
  return cached("banana", () => {
    const W = 256;
    const H = 512;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const rng = new Rng(12);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1);
        const v = y / (H - 1);
        const across = Math.abs(u - 0.5) * 2;
        // veins slanting out from the midrib toward the tip
        const vein = Math.pow(0.5 + 0.5 * Math.cos((v * 180 - across * 18) * Math.PI), 6);
        const mid = Math.exp(-((across / 0.045) ** 2));
        const edge = smoothstep(0.86, 1, across);
        const mot = tnoise(x, y, W, H, 8, 3) * 0.5 + 0.5;
        let r = 92 + 26 * mot - 22 * edge;
        let g = 138 + 28 * mot - 18 * edge;
        let b = 52 + 10 * mot - 10 * edge;
        r += 18 * vein;
        g += 16 * vein;
        b += 6 * vein;
        r = r * (1 - mid) + 196 * mid;
        g = g * (1 - mid) + 206 * mid;
        b = b * (1 - mid) + 128 * mid;
        // the margin dries brown
        const dry = edge * (0.5 + 0.5 * smoothstep(0.3, 0.8, tnoise(x, y, W, H, 20, 7) * 0.5 + 0.5));
        r = r * (1 - dry) + 142 * dry;
        g = g * (1 - dry) + 116 * dry;
        b = b * (1 - dry) + 62 * dry;
        const o = (y * W + x) * 4;
        const grit = (rng.next() - 0.5) * 6;
        d[o] = r + grit;
        d[o + 1] = g + grit;
        d[o + 2] = b + grit;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = colourTexture(cv, false);
    return t;
  });
}

/** The banana's pseudostem: green with brown-purple blotches and dry sheath streaks (u round, v up). */
export function bananaStemTexture(): THREE.CanvasTexture {
  return cached("bananaStem", () => {
    const W = 128;
    const H = 512;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const blot = smoothstep(0.55, 0.8, tnoise(x, y * 0.5, W, H, 10, 5) * 0.5 + 0.5);
        const streak = Math.pow(0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 14 + tnoise(x, y, W, H, 2, 1) * 2), 8);
        const dry = smoothstep(0.6, 0.85, tnoise(x, y, W, H, 3, 9) * 0.5 + 0.5) * (1 - y / H) * 0.9;
        let r = 108 - 30 * blot + 6 * streak;
        let g = 132 - 50 * blot + 5 * streak;
        let b = 64 - 10 * blot;
        r = r * (1 - dry) + 128 * dry;
        g = g * (1 - dry) + 104 * dry;
        b = b * (1 - dry) + 70 * dry;
        const o = (y * W + x) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return colourTexture(cv);
  });
}

/** The areca's trunk: grey-green with pale ring scars every ten centimetres or so (u round, v = metres up / 2). */
export function arecaTrunkTexture(): THREE.CanvasTexture {
  return cached("areca", () => {
    const W = 64;
    const H = 512;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    // 2 m per tile, a leaf scar every ~7 cm: thin, a little paler than the bark, not quite level
    const rings = 28;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = (y / H) * rings + 0.15 * Math.sin((x / W) * Math.PI * 2);
        const f = v - Math.floor(v);
        const ring = Math.exp(-(((f - 0.5) / 0.03) ** 2));
        const n = tnoise(x, y, W, H, 12, 3) * 0.5 + 0.5;
        const lichen = smoothstep(0.6, 0.85, tnoise(x, y, W, H, 5, 8) * 0.5 + 0.5);
        let r = 112 + 22 * n + 18 * ring;
        let g = 112 + 20 * n + 17 * ring;
        let b = 100 + 16 * n + 13 * ring;
        r = r * (1 - 0.3 * lichen) + 150 * 0.3 * lichen;
        g = g * (1 - 0.3 * lichen) + 156 * 0.3 * lichen;
        b = b * (1 - 0.3 * lichen) + 120 * 0.3 * lichen;
        const o = (y * W + x) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return colourTexture(cv);
  });
}

/** A dragonfly's wing: a fine dark net over clear film, a darker stigma spot near the tip (u along, v across). */
export function wingTexture(): THREE.CanvasTexture {
  return cached("wing", () => {
    const W = 256;
    const H = 64;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(220,230,236,0.16)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(40,38,34,0.55)";
    ctx.lineWidth = 1.2;
    // long veins
    for (let i = 0; i < 6; i++) {
      const y = 6 + i * 10;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5 + (y - H * 0.5) * 0.3);
      ctx.quadraticCurveTo(W * 0.5, y, W, y * 0.9 + 3);
      ctx.stroke();
    }
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "rgba(40,38,34,0.35)";
    const rng = new Rng(5);
    for (let x = 6; x < W; x += 5 + rng.next() * 4) {
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x + (rng.next() - 0.5) * 4, H - 2);
      ctx.stroke();
    }
    // the stigma near the leading edge's tip
    ctx.fillStyle = "rgba(70,40,30,0.85)";
    ctx.fillRect(W * 0.84, 4, W * 0.06, 6);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}
