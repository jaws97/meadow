// A small software rasteriser for the plant atlas (atlasBake.ts): draws one light plant (bake.ts) the way the Meadow
// camera sees it, orthographically from the camera's fixed bearing, into an albedo, a normal and a glow image. It
// runs in Node from scripts/bake-meadow-plants.mjs, where there is no WebGL, and it is deterministic, so the atlas
// only changes when the plants do.
//
// Each output pixel is the average of SS x SS samples: coverage becomes alpha (soft, anti-aliased edges), and colour,
// normal and glow are averaged over the covered samples only. Faces are two-sided, as the light plants' material
// draws them: a face turned away from the camera shows its other side, with the normal flipped (gl_FrontFacing).
import * as THREE from "three";

export interface View {
  /** toward the camera (unit) */
  back: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** The camera basis for a bearing `theta` (CameraRig's spherical theta) and an elevation above the horizon. */
export function viewFor(theta: number, elevation: number): View {
  const back = new THREE.Vector3(Math.cos(elevation) * Math.sin(theta), Math.sin(elevation), Math.cos(elevation) * Math.cos(theta));
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  return { back, right, up };
}

export interface Projected {
  /** per vertex: x, y in metres on the view plane, z toward the camera */
  xyz: Float32Array;
  /** per vertex: view-space normal */
  normal: Float32Array;
  color: Float32Array;
  glow: Float32Array;
  index: ArrayLike<number>;
  min: [number, number];
  max: [number, number];
}

/** The plant turned `spin` radians about its stem and seen from `view`. */
export function project(geo: THREE.BufferGeometry, spin: number, view: View): Projected {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const c = geo.attributes.color as THREE.BufferAttribute;
  const g = geo.attributes.glow as THREE.BufferAttribute;
  const count = p.count;
  const xyz = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // a turn about +y as three.js applies it
    v.set(p.getX(i) * cs + p.getZ(i) * sn, p.getY(i), -p.getX(i) * sn + p.getZ(i) * cs);
    const x = v.dot(view.right), y = v.dot(view.up), z = v.dot(view.back);
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    v.set(n.getX(i) * cs + n.getZ(i) * sn, n.getY(i), -n.getX(i) * sn + n.getZ(i) * cs);
    normal[i * 3] = v.dot(view.right);
    normal[i * 3 + 1] = v.dot(view.up);
    normal[i * 3 + 2] = v.dot(view.back);
  }
  return {
    xyz,
    normal,
    color: c.array as Float32Array,
    glow: g.array as Float32Array,
    index: geo.index ? geo.index.array : Array.from({ length: count }, (_, i) => i),
    min,
    max,
  };
}

export interface Cell {
  width: number;
  height: number;
  /** linear albedo, rgb per pixel (premultiplied by nothing: averaged over covered samples) */
  albedo: Float32Array;
  /** view-space normal per pixel, unit */
  normal: Float32Array;
  glow: Float32Array;
  /** 0..1 per pixel */
  alpha: Float32Array;
}

/**
 * Draws `pr` into a width x height cell, rows from the bottom up, where a view-plane point (x, y) lands at pixel
 * ((x - ox) * scale, (y - oy) * scale). `ss` samples a side per pixel. `light`, when given, lights each sample's colour
 * by its own normal before the samples are averaged (as a light plant is lit on screen), for checking the pictures.
 */
export function rasterize(
  pr: Projected,
  width: number,
  height: number,
  ox: number,
  oy: number,
  scale: number,
  ss: number,
  light?: (nx: number, ny: number, nz: number) => number,
): Cell {
  const W = width * ss, H = height * ss;
  const depth = new Float32Array(W * H).fill(-Infinity);
  const sCol = new Float32Array(W * H * 3);
  const sNrm = new Float32Array(W * H * 3);
  const sGlow = new Float32Array(W * H);
  const k = scale * ss;
  const sx = (i: number) => (pr.xyz[i * 3] - ox) * k;
  const sy = (i: number) => (pr.xyz[i * 3 + 1] - oy) * k;
  const idx = pr.index;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = sx(a), ay = sy(a), bx = sx(b), by = sy(b), cx = sx(c), cy = sy(c);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    // counter-clockwise on screen is the front face; a back face shows its other side
    const flip = area < 0 ? -1 : 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const za = pr.xyz[a * 3 + 2], zb = pr.xyz[b * 3 + 2], zc = pr.xyz[c * 3 + 2];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * za + w1 * zb + w2 * zc;
        const o = y * W + x;
        if (z <= depth[o]) continue;
        depth[o] = z;
        for (let ch = 0; ch < 3; ch++) {
          sCol[o * 3 + ch] = w0 * pr.color[a * 3 + ch] + w1 * pr.color[b * 3 + ch] + w2 * pr.color[c * 3 + ch];
          sNrm[o * 3 + ch] = flip * (w0 * pr.normal[a * 3 + ch] + w1 * pr.normal[b * 3 + ch] + w2 * pr.normal[c * 3 + ch]);
        }
        sGlow[o] = w0 * pr.glow[a] + w1 * pr.glow[b] + w2 * pr.glow[c];
        if (light) {
          const len = Math.hypot(sNrm[o * 3], sNrm[o * 3 + 1], sNrm[o * 3 + 2]) || 1;
          const k = light(sNrm[o * 3] / len, sNrm[o * 3 + 1] / len, sNrm[o * 3 + 2] / len);
          for (let ch = 0; ch < 3; ch++) sCol[o * 3 + ch] *= k;
        }
      }
    }
  }
  // resolve: average each pixel's covered samples
  const albedo = new Float32Array(width * height * 3);
  const normal = new Float32Array(width * height * 3);
  const glow = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0, r = 0, g = 0, b = 0, nx = 0, ny = 0, nz = 0, gl = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const o = (y * ss + j) * W + x * ss + i;
          if (depth[o] === -Infinity) continue;
          n++;
          r += sCol[o * 3];
          g += sCol[o * 3 + 1];
          b += sCol[o * 3 + 2];
          nx += sNrm[o * 3];
          ny += sNrm[o * 3 + 1];
          nz += sNrm[o * 3 + 2];
          gl += sGlow[o];
        }
      }
      const p = y * width + x;
      alpha[p] = n / (ss * ss);
      if (n === 0) {
        normal[p * 3 + 2] = 1;
        continue;
      }
      albedo[p * 3] = r / n;
      albedo[p * 3 + 1] = g / n;
      albedo[p * 3 + 2] = b / n;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal[p * 3] = nx / len;
      normal[p * 3 + 1] = ny / len;
      normal[p * 3 + 2] = nz / len;
      glow[p] = gl / n;
    }
  }
  return { width, height, albedo, normal, glow, alpha };
}

/**
 * Spreads the edge colours into the empty pixels round a plant for `passes` pixels (the normals and glow for the
 * first `normalPasses`), so filtering and the first mipmaps never pull in black, then lays the plant's average colour
 * and a plain normal over the rest of the cell, which keeps the image files small. Alpha is untouched.
 */
export function dilate(cell: Cell, passes: number, normalPasses: number): void {
  const { width: w, height: h } = cell;
  let filled = Uint8Array.from(cell.alpha, (a) => (a > 0 ? 1 : 0));
  const mean = [0, 0, 0];
  let covered = 0;
  for (let p = 0; p < w * h; p++) {
    if (!filled[p]) continue;
    covered++;
    for (let ch = 0; ch < 3; ch++) mean[ch] += cell.albedo[p * 3 + ch];
  }
  for (let ch = 0; ch < 3; ch++) mean[ch] /= Math.max(1, covered);
  for (let pass = 0; pass < passes; pass++) {
    const spreadNormals = pass < normalPasses;
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (filled[p]) continue;
        let n = 0, r = 0, g = 0, b = 0, nx = 0, ny = 0, nz = 0, gl = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (!filled[q]) continue;
            n++;
            r += cell.albedo[q * 3];
            g += cell.albedo[q * 3 + 1];
            b += cell.albedo[q * 3 + 2];
            nx += cell.normal[q * 3];
            ny += cell.normal[q * 3 + 1];
            nz += cell.normal[q * 3 + 2];
            gl += cell.glow[q];
          }
        }
        if (n === 0) continue;
        cell.albedo[p * 3] = r / n;
        cell.albedo[p * 3 + 1] = g / n;
        cell.albedo[p * 3 + 2] = b / n;
        const len = Math.hypot(nx, ny, nz) || 1;
        cell.normal[p * 3] = spreadNormals ? nx / len : 0;
        cell.normal[p * 3 + 1] = spreadNormals ? ny / len : 0;
        cell.normal[p * 3 + 2] = spreadNormals ? nz / len : 1;
        cell.glow[p] = spreadNormals ? gl / n : 0;
        next[p] = 1;
      }
    }
    filled = next;
  }
  for (let p = 0; p < w * h; p++) {
    if (filled[p]) continue;
    for (let ch = 0; ch < 3; ch++) cell.albedo[p * 3 + ch] = mean[ch];
    cell.normal[p * 3] = 0;
    cell.normal[p * 3 + 1] = 0;
    cell.normal[p * 3 + 2] = 1;
    cell.glow[p] = 0;
  }
}
