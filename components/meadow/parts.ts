// Small geometry helpers for the spike's placeholder props: paint a primitive
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
