// The doe's mesh builder: lofts (a chain of cross-section rings swept along an axis in the side plane), small
// ellipsoids, and the per-vertex data the coat and the skeleton need. Pure three.js with no DOM, so the counts and the
// weights can be checked in a unit test.
//
// A ring is drawn from the side, as the doe is designed: its centre (x forward, y up, z out to her right), how far the
// outline reaches above and below the centre (`up`, `down`, measured across the axis, so on a leg, whose axis runs
// down, `up` is the front edge and `down` the back), and its half-width. The section between is a superellipse,
// narrowing or widening toward the top by `taper`. The loft is resampled by arc length with Catmull-Rom curves through
// the rings, so a dozen authored rings give a smooth body; `capStart`/`capEnd` round the ends off over a share of the
// end ring's size.
//
// Every vertex carries `aCoat` for the coat shader: x, metres along its loft from the start; y, signed metres round
// the section from the front line (the dorsal line on the body and head, the front of a leg), positive toward +z (her
// right; a mirrored loft's outside); z, the part (PART); w, the share of the way round from the bottom seam (0 and 1) to the front line (0.5). The
// seam runs along the belly or the back of a leg, where the coat is plain, and its vertices are doubled so `y` can jump
// there; normals are taken on the closed grid first, so the seam does not show in the light.
import * as THREE from "three";

export const PART = {
  body: 0,
  head: 1,
  fore: 2,
  hind: 3,
  ear: 4,
  tail: 5,
  eye: 6,
  thigh: 7,
} as const;
export type Part = (typeof PART)[keyof typeof PART];

export interface Ring {
  x: number;
  y: number;
  /** out to her right (+z, with x forward and y up); legs and ears sit off the midline */
  z?: number;
  up: number;
  down: number;
  /** half-width */
  w: number;
  /** width multiplier toward the top: w * (1 + taper * v), v from -1 at the bottom to 1 at the top */
  taper?: number;
  /** superellipse exponent: 2 an ellipse, higher boxier, lower pinched */
  n?: number;
  /**
   * The direction `up` reaches, as an angle in the side plane (radians from +x), when the ring is drawn between two
   * outline points (the body's top and bottom) rather than square to the loft's axis; the section is then sheared to
   * span exactly those points, so the silhouette is the drawn one. Omitted: square to the axis.
   */
  a?: number;
}

/** Up to four bones and their weights; they need not sum to 1 (they are normalised). */
export type Weights = readonly (readonly [number, number])[];

export interface LoftSpec {
  rings: readonly Ring[];
  /** rings to resample along the axis, and segments round each */
  along: number;
  around: number;
  part: Part;
  /** rounded ends: the cap's length as a share of the end ring's mean radius (0 for an open end) */
  capStart?: number;
  capEnd?: number;
  /** the skin weights at a share `u` (0..1) of the way along the loft */
  weights: (u: number) => Weights;
  /** mirror the section's left and right: a right leg's outside faces -z */
  flip?: boolean;
  /**
   * A custom section: the point at angle th (0 at the front line, going round to her right) as [across the axis, out
   * of the side plane], in the ring's own units. Defaults to the superellipse.
   */
  section?: (th: number, ring: Ring) => readonly [number, number];
}

const sgnPow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

/** The default section: a superellipse with its own top and bottom reach and a taper of the width. */
export function superSection(th: number, r: Ring): readonly [number, number] {
  const n = r.n ?? 2;
  const c = sgnPow(Math.cos(th), 2 / n);
  const s = sgnPow(Math.sin(th), 2 / n);
  const across = c >= 0 ? c * r.up : c * r.down;
  const out = s * r.w * Math.max(0.05, 1 + (r.taper ?? 0) * c);
  return [across, out];
}

/** Catmull-Rom (uniform) through four values. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const KEYS = ["x", "y", "z", "up", "down", "w", "taper", "n", "a"] as const;
type Key = (typeof KEYS)[number];
const DEFAULTS: Record<Key, number> = { x: 0, y: 0, z: 0, up: 0, down: 0, w: 0, taper: 0, n: 2, a: NaN };

function ringAt(rings: readonly Ring[], f: number): Required<Ring> {
  const last = rings.length - 1;
  const i = Math.min(last - 1, Math.max(0, Math.floor(f)));
  const t = f - i;
  const g = (k: number) => rings[Math.min(last, Math.max(0, k))];
  const out = {} as Required<Ring>;
  for (const key of KEYS) {
    const v = (r: Ring) => (r[key] ?? DEFAULTS[key]) as number;
    // sizes never overshoot below zero between rings
    const raw = cr(v(g(i - 1)), v(g(i)), v(g(i + 1)), v(g(i + 2)), t);
    out[key] = key === "x" || key === "y" || key === "z" || key === "taper" || key === "a" ? raw : Math.max(0, raw);
  }
  return out;
}

/** The rings resampled evenly by arc length along the centre line, with each one's unit axis in the side plane. */
export function resample(rings: readonly Ring[], count: number): { ring: Required<Ring>; ax: number; ay: number; az: number; s: number }[] {
  const fine = (rings.length - 1) * 24;
  const pts: Required<Ring>[] = [];
  const len: number[] = [0];
  for (let k = 0; k <= fine; k++) {
    pts.push(ringAt(rings, (k / fine) * (rings.length - 1)));
    if (k > 0) {
      const a = pts[k - 1];
      const b = pts[k];
      len.push(len[k - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
  }
  const total = len[fine];
  const out: { ring: Required<Ring>; ax: number; ay: number; az: number; s: number }[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / (count - 1)) * total;
    while (j < fine - 1 && len[j + 1] < s) j++;
    const t = (s - len[j]) / Math.max(1e-9, len[j + 1] - len[j]);
    const f = (j + t) / fine;
    const ring = ringAt(rings, f * (rings.length - 1));
    const a = pts[Math.max(0, j - 1)];
    const b = pts[Math.min(fine, j + 2)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    out.push({ ring, ax: dx / l, ay: dy / l, az: dz / l, s });
  }
  return out;
}

/** Accumulates parts into one skinned geometry. */
export class DoeMesh {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly coat: number[] = [];
  readonly skinIndex: number[] = [];
  readonly skinWeight: number[] = [];
  readonly index: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  private pushVertex(p: THREE.Vector3, n: THREE.Vector3, coat: readonly [number, number, number, number], w: Weights) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.coat.push(coat[0], coat[1], coat[2], coat[3]);
    const top = [...w].filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, x]) => a + x, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.skinIndex.push(top[k]?.[0] ?? 0);
      this.skinWeight.push(top[k] ? top[k][1] / sum : 0);
    }
  }

  /** Sweeps a loft; returns the arc length of its centre line (m). */
  addLoft(spec: LoftSpec): number {
    const { along, around } = spec;
    const section = spec.section ?? superSection;
    const flip = spec.flip ? -1 : 1;
    const body = resample(spec.rings, along);
    // rounded caps: extra rings past each end, shrinking on a quarter circle
    type Station = { c: THREE.Vector3; ax: THREE.Vector3; ring: Required<Ring>; scale: number; s: number; u: number };
    const stations: Station[] = [];
    const meanR = (r: Required<Ring>) => (r.up + r.down + 2 * r.w) / 4;
    const capRings = Math.max(3, Math.round(around / 4));
    const total = body[body.length - 1].s;
    const addCap = (end: (typeof body)[number], dir: 1 | -1, share: number, atStart: boolean) => {
      const reach = meanR(end.ring) * share;
      const ax = new THREE.Vector3(end.ax, end.ay, end.az);
      const list: Station[] = [];
      for (let k = 1; k <= capRings; k++) {
        const a = (k / capRings) * (Math.PI / 2);
        const c = new THREE.Vector3(end.ring.x, end.ring.y, end.ring.z).addScaledVector(ax, dir * reach * Math.sin(a));
        list.push({ c, ax, ring: end.ring, scale: Math.max(0, Math.cos(a)), s: end.s + dir * reach * Math.sin(a), u: atStart ? 0 : 1 });
      }
      return list;
    };
    if (spec.capStart) stations.push(...addCap(body[0], -1, spec.capStart, true).reverse());
    for (const b of body) {
      stations.push({ c: new THREE.Vector3(b.ring.x, b.ring.y, b.ring.z), ax: new THREE.Vector3(b.ax, b.ay, b.az), ring: b.ring, scale: 1, s: b.s, u: b.s / total });
    }
    if (spec.capEnd) stations.push(...addCap(body[body.length - 1], 1, spec.capEnd, false));

    // the grid of points, closed round each ring
    const rows = stations.length;
    const grid: THREE.Vector3[][] = [];
    const across = new THREE.Vector3();
    const out = new THREE.Vector3(0, 0, 1);
    for (const st of stations) {
      // across the axis, in the side plane (toward the back on the body, the front on a leg), or as drawn
      if (Number.isFinite(st.ring.a)) across.set(Math.cos(st.ring.a), Math.sin(st.ring.a), 0);
      else across.set(-st.ax.y, st.ax.x, 0);
      if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
      across.normalize();
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < around; j++) {
        const th = (j / around) * Math.PI * 2;
        const [a, o] = section(th, st.ring);
        row.push(st.c.clone().addScaledVector(across, a * st.scale).addScaledVector(out, o * st.scale * flip));
      }
      grid.push(row);
    }
    // normals on the closed grid (central differences), pointing outward
    const normals: THREE.Vector3[][] = [];
    const du = new THREE.Vector3();
    const dv = new THREE.Vector3();
    for (let i = 0; i < rows; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < around; j++) {
        const ip = grid[Math.min(rows - 1, i + 1)][j];
        const im = grid[Math.max(0, i - 1)][j];
        du.subVectors(ip, im);
        dv.subVectors(grid[i][(j + 1) % around], grid[i][(j - 1 + around) % around]);
        const n = new THREE.Vector3().crossVectors(dv, du).multiplyScalar(flip);
        if (n.lengthSq() < 1e-14) {
          // a cap's tip: the axis itself
          n.copy(stations[i].ax).multiplyScalar(i < rows / 2 ? -1 : 1);
        }
        row.push(n.normalize());
      }
      normals.push(row);
    }
    // vertices, the seam column doubled; coat coordinates round from the front line
    const base = this.vertexCount;
    const cols = around + 1;
    const half = around / 2;
    for (let i = 0; i < rows; i++) {
      const st = stations[i];
      // arc length round this ring, from the front line (j = 0) both ways
      const ring = grid[i];
      const arc: number[] = [0];
      for (let j = 1; j <= around; j++) arc.push(arc[j - 1] + ring[j % around].distanceTo(ring[j - 1]));
      const circ = arc[around];
      const w = spec.weights(Math.min(1, Math.max(0, st.u)));
      for (let jj = 0; jj < cols; jj++) {
        // the seam is at the back (j = half): columns run from the seam round to the seam
        const j = (jj + half) % around;
        // the first column is the seam reached the other way round (-z), so nothing interpolates across the front line
        const signedArc = jj > 0 && j <= half ? arc[j] : arc[j] - circ;
        const t = jj / around;
        this.pushVertex(ring[j], normals[i][j], [st.s, signedArc, spec.part, t], w);
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let jj = 0; jj < around; jj++) {
        const a = base + i * cols + jj;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // counter-clockwise seen from outside (the mirrored loft runs round the other way)
        if (flip > 0) this.index.push(a, b, c, b, d, c);
        else this.index.push(a, c, b, b, c, d);
      }
    }
    return total;
  }

  /** A small ellipsoid (an eye): centre, radii along x, y, z, its weights, and a tilt about z (radians). */
  addEllipsoid(c: readonly [number, number, number], r: readonly [number, number, number], part: Part, weights: Weights, segs = 10, tilt = 0) {
    const base = this.vertexCount;
    const rows = Math.max(4, Math.round(segs / 2));
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    for (let i = 0; i <= rows; i++) {
      const phi = (i / rows) * Math.PI;
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const ux = Math.sin(phi) * Math.cos(th);
        const uy = Math.cos(phi);
        const uz = Math.sin(phi) * Math.sin(th);
        const lx = ux * r[0];
        const ly = uy * r[1];
        p.set(c[0] + lx * ct - ly * st, c[1] + lx * st + ly * ct, c[2] + uz * r[2]);
        const nx = ux / r[0];
        const ny = uy / r[1];
        n.set(nx * ct - ny * st, nx * st + ny * ct, uz / r[2]).normalize();
        this.pushVertex(p, n, [0, 0, part, j / segs], weights);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * (segs + 1) + j;
        const b = a + 1;
        const cc = a + segs + 1;
        const d = cc + 1;
        this.index.push(a, b, cc, b, d, cc);
      }
    }
  }

  /** Moves every vertex from `from` on (a part built in its own frame, an ear) by a matrix. */
  transform(from: number, m: THREE.Matrix4) {
    const p = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = from; i < this.vertexCount; i++) {
      p.fromArray(this.pos, i * 3).applyMatrix4(m).toArray(this.pos, i * 3);
      p.fromArray(this.nrm, i * 3).applyMatrix3(nm).normalize().toArray(this.nrm, i * 3);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("aCoat", new THREE.Float32BufferAttribute(this.coat, 4));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeight, 4));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}
