// Near-garden textures: the turf under the grass blades, the mulch on the
// bed with its bump map, the mineral grain of the stones and the weathered
// wood of the lantern post. Browser only: these draw on a canvas. Each is
// painted once per seed and cached; nothing here is ever disposed.
import * as THREE from "three";
import { Rng } from "@/lib/plant/prng";
import { makeCanvas, rgba, toTexture } from "@/lib/plant/textures";

const cache = new Map<string, THREE.CanvasTexture>();

/** Soft radial smudge, for mottling and shadow pockets. */
function smudge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string) {
  const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, inner);
  rg.addColorStop(1, outer);
  ctx.fillStyle = rg;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Linear (non-colour) data texture, for bump maps. */
function toDataTexture(c: HTMLCanvasElement, repeat?: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.needsUpdate = true;
  return t;
}

/**
 * Turf: a dark, dense mat of short strokes, each darker at its root and lighter
 * at its tip, with soft mottling and shadow pockets. It is the ground the
 * blades stand on, so it stays dark: the blades carry the light. It tiles 14
 * times over the lawn, so every tile is about two metres and the blades above
 * it hide the seam.
 */
export function grassTexture(seed = 1): THREE.CanvasTexture {
  const key = "grass:" + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512;
  const c = makeCanvas(W, W);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 31 + 5);
  ctx.fillStyle = "#17300f";
  ctx.fillRect(0, 0, W, W);

  // Large soft mottling: yellower and bluer greens drifting across the tile.
  for (let i = 0; i < 70; i++) {
    const warm = rng.next() < 0.5;
    smudge(
      ctx,
      rng.next() * W,
      rng.next() * W,
      40 + rng.next() * 110,
      rgba(warm ? "#44702a" : "#1a4226", 0.22),
      rgba(warm ? "#44702a" : "#1a4226", 0),
    );
  }

  const roots = ["#15300f", "#1c3e15", "#163719", "#214618"];
  const tips = ["#376c26", "#45852f", "#539338", "#62a042", "#356a2a", "#78b04e", "#427e2d"];
  ctx.lineCap = "round";
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * W;
    const y = rng.next() * W;
    const len = 5 + rng.next() * 13;
    const ang = -Math.PI / 2 + (rng.next() - 0.5) * 1.5;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const w = 0.9 + rng.next() * 1.4;
    // root half, dark
    ctx.strokeStyle = rgba(rng.pick(roots), 0.5 + rng.next() * 0.3);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * 0.55, y + dy * 0.55);
    ctx.stroke();
    // tip half, lighter and thinner
    ctx.strokeStyle = rgba(rng.pick(tips), 0.3 + rng.next() * 0.3);
    ctx.lineWidth = w * 0.7;
    ctx.beginPath();
    ctx.moveTo(x + dx * 0.45, y + dy * 0.45);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  // Shadow pockets between the tufts.
  for (let i = 0; i < 80; i++) {
    smudge(ctx, rng.next() * W, rng.next() * W, 14 + rng.next() * 50, "rgba(0,0,0,0.32)", "rgba(0,0,0,0)");
  }
  // Tiny bright flecks where a tip catches the light.
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.7 ? "#86bf4e" : "#b5d47c", 0.14 + rng.next() * 0.18);
    ctx.fillRect(rng.next() * W, rng.next() * W, 1.2, 1.2);
  }
  const tex = toTexture(c, 14);
  cache.set(key, tex);
  return tex;
}

interface MulchLayout {
  bark: { x: number; y: number; len: number; th: number; a: number; tone: number }[];
  stones: { x: number; y: number; r: number; ry: number; rot: number; tone: number }[];
}

/** Where the bark chips and small stones lie, shared by the colour and bump maps. */
function mulchLayout(seed: number, W: number): MulchLayout {
  const rng = new Rng(seed * 17 + 3);
  const bark: MulchLayout["bark"] = [];
  for (let i = 0; i < 420; i++) {
    bark.push({
      x: rng.next() * W,
      y: rng.next() * W,
      len: 9 + rng.next() * 30,
      th: 3.5 + rng.next() * 6,
      a: rng.next() * Math.PI,
      tone: rng.next(),
    });
  }
  const stones: MulchLayout["stones"] = [];
  for (let i = 0; i < 90; i++) {
    const r = 2 + rng.next() * 5.5;
    stones.push({ x: rng.next() * W, y: rng.next() * W, r, ry: r * (0.55 + rng.next() * 0.45), rot: rng.next() * 3, tone: rng.next() });
  }
  return { bark, stones };
}

/** The bark chip drawn in `ctx` at the current transform; `top`, `body`, `under` paint its three bands. */
function barkChip(ctx: CanvasRenderingContext2D, len: number, th: number, body: string, top: string, under: string) {
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-len / 2, -th / 2, len, th, th / 2);
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.roundRect(-len / 2, -th / 2, len, th * 0.35, th / 3);
  ctx.fill();
  ctx.fillStyle = under;
  ctx.beginPath();
  ctx.roundRect(-len / 2, th * 0.25, len, th * 0.3, th / 3);
  ctx.fill();
}

/**
 * Mulch: dark varied grain, chips of bark lying every which way, small stones
 * with a shadow under each, and dark pockets between the lumps. Tiled three
 * times over the bed's world-space UVs, so a chip is one to five centimetres.
 */
export function soilTexture(seed = 1): THREE.CanvasTexture {
  const key = "soil:" + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512;
  const c = makeCanvas(W, W);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 17 + 3);
  const layout = mulchLayout(seed, W);
  ctx.fillStyle = "#24150c";
  ctx.fillRect(0, 0, W, W);

  const grains = ["#1a0e06", "#33200f", "#45301c", "#2b1a0d", "#5a4129", "#140b05", "#3e2a18", "#4d3824"];
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = rgba(rng.pick(grains), 0.55 + rng.next() * 0.45);
    const s = 1 + rng.next() * 2.6;
    ctx.fillRect(rng.next() * W, rng.next() * W, s, s);
  }
  // Soft lumps and pockets.
  for (let i = 0; i < 90; i++) {
    const dark = rng.next() < 0.6;
    smudge(
      ctx,
      rng.next() * W,
      rng.next() * W,
      10 + rng.next() * 40,
      dark ? "rgba(0,0,0,0.3)" : "rgba(120,86,56,0.18)",
      dark ? "rgba(0,0,0,0)" : "rgba(120,86,56,0)",
    );
  }
  // Bark chips: elongated, rounded, with a lit top edge and a shadow beneath.
  const bark = ["#4a331d", "#5a4026", "#3a2813", "#684a2e", "#2f1f10", "#7a5a38"];
  for (const b of layout.bark) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(-b.len / 2 + 1, -b.th / 2 + 2.5, b.len, b.th, b.th / 2);
    ctx.fill();
    barkChip(
      ctx,
      b.len,
      b.th,
      rgba(bark[Math.floor(b.tone * bark.length)], 0.85 + b.tone * 0.15),
      "rgba(160,118,76,0.3)",
      "rgba(0,0,0,0.38)",
    );
    ctx.restore();
  }
  // Small stones, each with a shadow below and a highlight above.
  const stones = ["#6e6358", "#857868", "#5b5249", "#948877", "#7d7266", "#a39584"];
  for (const s of layout.stones) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(s.x + 0.8, s.y + 1.4, s.r, s.ry, s.rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(stones[Math.floor(s.tone * stones.length)], 0.92);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r, s.ry, s.rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,245,230,0.25)";
    ctx.beginPath();
    ctx.ellipse(s.x - s.r * 0.2, s.y - s.ry * 0.3, s.r * 0.45, s.ry * 0.35, s.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dry specks on top.
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = rgba(rng.next() < 0.5 ? "#8a7a60" : "#6b5a44", 0.25 + rng.next() * 0.25);
    ctx.fillRect(rng.next() * W, rng.next() * W, 1, 1);
  }
  const tex = toTexture(c, 3);
  cache.set(key, tex);
  return tex;
}

/**
 * Height map that matches soilTexture: chips and stones stand proud of the
 * grain, pockets sink. Used as a bump map so the mulch catches raking light.
 */
export function soilBumpTexture(seed = 1): THREE.CanvasTexture {
  const key = "soilbump:" + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512;
  const c = makeCanvas(W, W);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 17 + 3);
  const layout = mulchLayout(seed, W);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 9000; i++) {
    const up = rng.next() < 0.5;
    ctx.fillStyle = up ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";
    const s = 1 + rng.next() * 2.4;
    ctx.fillRect(rng.next() * W, rng.next() * W, s, s);
  }
  for (let i = 0; i < 90; i++) {
    const dark = rng.next() < 0.6;
    smudge(
      ctx,
      rng.next() * W,
      rng.next() * W,
      10 + rng.next() * 40,
      dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.2)",
      dark ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)",
    );
  }
  for (const b of layout.bark) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    barkChip(ctx, b.len, b.th, "rgba(255,255,255,0.5)", "rgba(255,255,255,0.35)", "rgba(0,0,0,0.3)");
    ctx.restore();
  }
  for (const s of layout.stones) {
    const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
    rg.addColorStop(0, "rgba(255,255,255,0.8)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r, s.ry, s.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = toDataTexture(c, 3);
  cache.set(key, tex);
  return tex;
}

/**
 * Mineral grain for the fieldstones and flagstones: a pale speckled base the
 * per-vertex tint and moss multiply, with faint veins and darker inclusions.
 */
export function stoneTexture(seed = 1): THREE.CanvasTexture {
  const key = "stone:" + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 256;
  const c = makeCanvas(W, W);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 53 + 9);
  ctx.fillStyle = "#cfcac0";
  ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 40; i++) {
    const light = rng.next() < 0.5;
    smudge(ctx, rng.next() * W, rng.next() * W, 20 + rng.next() * 60, light ? "rgba(255,255,255,0.18)" : "rgba(60,55,50,0.2)", "rgba(0,0,0,0)");
  }
  for (let i = 0; i < 9000; i++) {
    const dark = rng.next() < 0.55;
    ctx.fillStyle = dark ? rgba("#4a4640", 0.2 + rng.next() * 0.3) : rgba("#ffffff", 0.15 + rng.next() * 0.3);
    const s = 0.8 + rng.next() * 1.8;
    ctx.fillRect(rng.next() * W, rng.next() * W, s, s);
  }
  // quartz veins
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const x0 = rng.next() * W;
    const y0 = rng.next() * W;
    ctx.strokeStyle = rgba("#ebe7df", 0.25 + rng.next() * 0.25);
    ctx.lineWidth = 0.8 + rng.next() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + rng.range(-60, 60), y0 + rng.range(-60, 60), x0 + rng.range(-90, 90), y0 + rng.range(-90, 90));
    ctx.stroke();
  }
  // dark inclusions
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = rgba("#3a3632", 0.3 + rng.next() * 0.4);
    ctx.beginPath();
    ctx.ellipse(rng.next() * W, rng.next() * W, 1 + rng.next() * 2.5, 0.8 + rng.next() * 1.5, rng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = toTexture(c, 1);
  cache.set(key, tex);
  return tex;
}

/**
 * Weathered oak for the lantern post: long grain running up the post, silvered
 * ridges, dark checks and a knot or two. V runs along the post.
 */
export function woodTexture(seed = 1): THREE.CanvasTexture {
  const key = "wood:" + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 128;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d")!;
  const rng = new Rng(seed * 71 + 13);
  ctx.fillStyle = "#b7ab9a";
  ctx.fillRect(0, 0, W, H);
  // grain lines, each wandering a little
  for (let i = 0; i < 160; i++) {
    const x = rng.next() * W;
    const dark = rng.next() < 0.6;
    ctx.strokeStyle = dark ? rgba("#5c4b3a", 0.25 + rng.next() * 0.35) : rgba("#e9e0d0", 0.2 + rng.next() * 0.25);
    ctx.lineWidth = 0.6 + rng.next() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let px = x;
    for (let y = 0; y <= H; y += 32) {
      px += rng.range(-2.5, 2.5);
      ctx.lineTo(px, y);
    }
    ctx.stroke();
  }
  // checks: short dark splits along the grain
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    ctx.strokeStyle = rgba("#2a2018", 0.5 + rng.next() * 0.4);
    ctx.lineWidth = 0.8 + rng.next() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1.5, 1.5), y + 10 + rng.next() * 40);
    ctx.stroke();
  }
  // a couple of knots
  for (let i = 0; i < 2; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    for (let r = 9; r > 1; r -= 1.6) {
      ctx.strokeStyle = rgba(r % 3 < 1.6 ? "#4a3a2a" : "#8a7a66", 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.7, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // silvering: a soft pale wash with grey speckle
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rng.next() < 0.5 ? "rgba(255,255,255,0.12)" : "rgba(40,36,32,0.12)";
    ctx.fillRect(rng.next() * W, rng.next() * H, 1.2, 1.2 + rng.next() * 2);
  }
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  cache.set(key, tex);
  return tex;
}
