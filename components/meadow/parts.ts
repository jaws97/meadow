// Small geometry helpers for the Meadow's props: paint a primitive
// with a vertex colour, then merge many primitives into one mesh, so a whole
// prop (a wheel, a lantern frame, a stake with its bulb) is a single draw call
// under one vertex-coloured material.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const tmpColor = new THREE.Color();

/**
 * Adds a flat `color` attribute (and an optional per-vertex `glow` weight),
 * converted to non-indexed so differently built primitives can merge.
 */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, glow = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes.position.count;
  tmpColor.set(color);
  const colors = new Float32Array(n * 3);
  const glows = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
    glows[i] = glow;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("glow", new THREE.BufferAttribute(glows, 1));
  return g;
}

/** Merges painted parts; the inputs are disposed. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("meadow: parts could not be merged");
  merged.computeBoundingSphere();
  return merged;
}

/** A thin cylinder from a to b. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(radius, radius, len, segments, 1);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  geo.applyQuaternion(q);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geo.translate(mid.x, mid.y, mid.z);
  return geo;
}

/** A tileable woven-willow pattern, drawn once; original procedural art. */
export function weaveTexture(): THREE.CanvasTexture {
  const size = 128;
  const cell = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5d4129";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size / cell; y++) {
    for (let x = 0; x < size / cell; x++) {
      const over = (x + y) % 2 === 0;
      const px = x * cell;
      const py = y * cell;
      // Each strand bulges in the middle: a soft gradient across its width.
      const g = over ? ctx.createLinearGradient(px, py, px, py + cell) : ctx.createLinearGradient(px, py, px + cell, py);
      g.addColorStop(0, "#8a6238");
      g.addColorStop(0.5, over ? "#e2b878" : "#d3a565");
      g.addColorStop(1, "#7e5832");
      ctx.fillStyle = g;
      if (over) ctx.fillRect(px - 1, py + 2, cell + 2, cell - 4);
      else ctx.fillRect(px + 2, py - 1, cell - 4, cell + 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft round shadow for things that hover, drawn once. */
export function blobTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(20,24,16,0.55)");
  g.addColorStop(1, "rgba(20,24,16,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A vertex-coloured standard material whose `glow` attribute adds emission in
 * the vertex colour, so one mesh can hold both a dull stake and a lit bulb.
 */
export function glowMaterial(params: THREE.MeshStandardMaterialParameters, strength: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ ...params, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow;");
  };
  mat.customProgramCacheKey = () => `meadow-glow-${strength}`;
  return mat;
}

/**
 * glowMaterial with a strength that can change while it runs (the lanterns brighten as night falls): the uniform
 * object is returned with it, and the shader reads it every frame.
 */
export function liveGlowMaterial(params: THREE.MeshStandardMaterialParameters, key: string): { material: THREE.MeshStandardMaterial; glow: { value: number } } {
  const glow = { value: 1 };
  const mat = new THREE.MeshStandardMaterial({ ...params, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow;");
  };
  mat.customProgramCacheKey = () => `meadow-live-glow-${key}`;
  return { material: mat, glow };
}

/** A tileable speckled texture (sand, mulch): a base colour, soft drifts and a fine grain, drawn once. */
export function grainTexture(base: string, light: string, dark: string, seed: number, repeat: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 22; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 60;
    const c = rand() < 0.5 ? light : dark;
    wrapped(x, y, (cx, cy) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, c);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 2400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.5 + rand() * 1.3;
    ctx.globalAlpha = 0.25 + rand() * 0.4;
    ctx.fillStyle = rand() < 0.5 ? light : dark;
    wrapped(x, y, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Garden paving, drawn once and tiled: rows of warm, slightly irregular stone setts in a running bond, each a touch
 * lighter or darker than its neighbours, with soft sandy joints and a little wear. Original procedural art.
 */
export function paverTexture(seed: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(seed);
  ctx.fillStyle = "#c9b48f";
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    // a running bond: every row starts half a stone along from the last, and stones vary in length
    let x = -(r % 2) * 40 - rand() * 20;
    while (x < size) {
      const w = 56 + rand() * 46;
      const tone = 0.9 + rand() * 0.16;
      const base = [236, 224, 199].map((c) => Math.round(Math.min(255, c * tone)));
      const inset = 3 + rand() * 1.5;
      const y = r * rowH;
      const draw = (ox: number) => {
        const g = ctx.createLinearGradient(0, y, 0, y + rowH);
        g.addColorStop(0, `rgb(${base.map((c) => Math.min(255, c + 10)).join(",")})`);
        g.addColorStop(1, `rgb(${base.map((c) => c - 12).join(",")})`);
        ctx.fillStyle = g;
        const rx = x + ox + inset, ry = y + inset, rw = w - inset * 2, rh = rowH - inset * 2, rad = 7;
        ctx.beginPath();
        ctx.moveTo(rx + rad, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rad);
        ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rad);
        ctx.arcTo(rx, ry + rh, rx, ry, rad);
        ctx.arcTo(rx, ry, rx + rw, ry, rad);
        ctx.fill();
      };
      // wrap across the tile's edge so it repeats seamlessly
      draw(0);
      if (x + w > size) draw(-size);
      x += w;
    }
  }
  // wear: soft lighter and darker patches, and a fine grain over everything
  for (let i = 0; i < 40; i++) {
    const cx = rand() * size, cy = rand() * size, rr = 20 + rand() * 60;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rr);
        g.addColorStop(0, rand() < 0.5 ? "rgba(255,250,235,0.10)" : "rgba(120,100,70,0.08)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx + ox - rr, cy + oy - rr, rr * 2, rr * 2);
      }
    }
  }
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.08)" : "rgba(90,70,45,0.08)";
    ctx.fillRect(rand() * size, rand() * size, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * A tended bed seen from above: dark crumbly mulch with low ground cover creeping over it in soft clumps of small
 * leaves, so the beds read as planted rather than bare earth. Drawn once and tiled; original procedural art.
 */
export function plantedBedTexture(seed: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(seed);
  ctx.fillStyle = "#5b4331";
  ctx.fillRect(0, 0, size, size);
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(x + ox, y + oy);
  };
  // crumbs of mulch, light and dark
  for (let i = 0; i < 3500; i++) {
    const x = rand() * size, y = rand() * size, r = 0.6 + rand() * 1.6;
    ctx.fillStyle = rand() < 0.5 ? "rgba(120,90,64,0.5)" : "rgba(40,28,20,0.45)";
    wrapped(x, y, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // clumps of ground cover: many small rounded leaves round a centre, darker beneath, lighter on top
  const greens = ["#3f6b35", "#4c7d3f", "#5b8f48", "#6fa457"];
  for (let c = 0; c < 70; c++) {
    const cx = rand() * size, cy = rand() * size, spread = 14 + rand() * 30;
    const leaves = 30 + Math.floor(rand() * 40);
    for (let k = 0; k < leaves; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * spread;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const r = 2.2 + rand() * 2.6, rot = rand() * Math.PI;
      const tone = greens[Math.min(greens.length - 1, Math.floor((1 - d / spread) * greens.length * 0.9 + rand() * 1.2))];
      wrapped(x, y, (lx, ly) => {
        ctx.fillStyle = "rgba(20,30,15,0.35)";
        ctx.beginPath();
        ctx.ellipse(lx + 0.8, ly + 1, r, r * 0.62, rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.ellipse(lx, ly, r, r * 0.62, rot, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Replaces a geometry's uv with its world x, z divided by `tile` (metres per texture repeat), for seamless paving. */
export function worldUv(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A small deterministic random sequence (Park-Miller), for scattering props the same way on every device. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
