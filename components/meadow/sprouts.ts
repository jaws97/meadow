// Cheap plant shapes for the Meadow's three hundred or so plants, one shape per stage, drawn instanced (Plants.tsx):
// a soil mound with a seed of light and two seed leaves; a sprout; a leafy young plant; a tall plant carrying a bud or
// a bloom; and a plant resting after it has died. Each is a few dozen triangles of vertex-coloured leaves and stem
// (the species' leaf colour is laid on per instance), built for a species one metre tall and scaled per plant.
//
// The flower heads are per species, so a rose, a marigold and a magnolia read as themselves from across the Meadow:
// the bloom's outer whorls are built from the species' own petal counts, lengths, widths and opening angles
// (lib/plant/species), shaded from the petal base colour to the tip colour, round its centre; the bud is a teardrop
// in the bud's colours inside its sepals. The full procedural plant (flowerPlant.ts) is drawn only for the plant
// being visited.
import * as THREE from "three";
import { merge, paint } from "@/components/meadow/parts";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

const LEAF = "#ffffff";
const STEM = "#d4e3bc";
const SOIL = "#5a4130";
const SEED_LIGHT = "#ffd27a";
const COTYLEDON = "#8cc46a";
const RESTING_STEM = "#8a7356";
const RESTING_LEAF = "#9b8461";
const SEPAL = "#3f7a3a";

/** Merges painted parts after dropping their uvs (the leaves have none, and nothing here is textured). */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) if (p.attributes.uv) p.deleteAttribute("uv");
  return merge(parts);
}

/**
 * A leaf as a folded diamond, base at the origin, growing along +z with its midrib raised, then tipped up by
 * `pitch` (radians above horizontal), turned to `yaw` round the stem and moved to height `y`.
 */
function leaf(len: number, wid: number, pitch: number, yaw: number, y: number, color: string, droop = 0.08): THREE.BufferGeometry {
  const w = wid / 2;
  const B = [0, 0, 0], Lp = [-w, 0.01 * len, 0.42 * len], T = [0, -droop * len, len], R = [w, 0.01 * len, 0.42 * len], M = [0, 0.06 * len, 0.46 * len];
  const tris = [B, M, Lp, B, R, M, Lp, M, T, M, R, T];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  g.rotateX(-pitch);
  g.rotateY(yaw);
  g.translate(0, y, 0);
  return paint(g, color);
}

function stem(h: number, r0: number, r1: number, color: string): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true);
  g.translate(0, h / 2, 0);
  return paint(g, color);
}

/** Leaves alternating up a stem from `from` to `to` (shares of h), largest low down. */
function leafRun(count: number, h: number, from: number, to: number, len0: number, len1: number, color = LEAF): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const len = len0 + (len1 - len0) * t;
    out.push(leaf(len, len * 0.55, 0.35 + 0.35 * t, i * 2.4, h * (from + (to - from) * t), color));
  }
  return out;
}

export function seedGeometry(): THREE.BufferGeometry {
  const mound = new THREE.SphereGeometry(0.13, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.38, 1);
  const seed = new THREE.SphereGeometry(0.026, 8, 6);
  seed.scale(1, 0.8, 1);
  seed.translate(0, 0.052, 0);
  const shoot = stem(0.05, 0.004, 0.003, COTYLEDON);
  shoot.translate(0, 0.04, 0);
  return mergeParts([
    paint(mound, SOIL),
    paint(seed, SEED_LIGHT, 1),
    shoot,
    leaf(0.045, 0.03, 0.5, 0, 0.088, COTYLEDON, 0.02),
    leaf(0.045, 0.03, 0.5, Math.PI, 0.088, COTYLEDON, 0.02),
  ]);
}

export function sproutGeometry(): THREE.BufferGeometry {
  const h = 0.2;
  return mergeParts([stem(h, 0.007, 0.004, STEM), leaf(0.07, 0.045, 0.4, 0.3, h * 0.55, LEAF), leaf(0.07, 0.045, 0.4, 0.3 + Math.PI, h * 0.55, LEAF), leaf(0.05, 0.032, 0.7, 1.9, h * 0.95, LEAF), leaf(0.05, 0.032, 0.7, 1.9 + Math.PI, h * 0.95, LEAF)]);
}

export function leafyGeometry(): THREE.BufferGeometry {
  const h = 0.5;
  return mergeParts([stem(h, 0.01, 0.005, STEM), ...leafRun(8, h, 0.14, 0.97, 0.13, 0.07)]);
}

/** A grown plant one metre tall, its head left off (the heads are drawn per species). */
export function tallGeometry(): THREE.BufferGeometry {
  const h = 1;
  return mergeParts([stem(h, 0.013, 0.006, STEM), ...leafRun(10, h, 0.1, 0.78, 0.15, 0.08)]);
}

/** A plant that has died back: a stem bowed over, a few curled leaves in autumn colours. */
export function restingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pts = [0, 0.15, 0.28, 0.36, 0.4].map((y, i) => new THREE.Vector3(i * i * 0.012, y, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 6, 0.006, 4, false);
  parts.push(paint(tube, RESTING_STEM));
  parts.push(leaf(0.07, 0.04, -0.3, 0.4, 0.1, RESTING_LEAF, 0.3), leaf(0.06, 0.035, -0.4, 2.8, 0.2, RESTING_LEAF, 0.3), leaf(0.05, 0.03, -0.5, 4.6, 0.3, RESTING_LEAF, 0.3));
  return mergeParts(parts);
}

/** The species' bud: a teardrop in its colours, inside its sepals. Base at the origin. */
export function budHeadGeometry(id: SpeciesId): THREE.BufferGeometry {
  const f = SPECIES[id].flower;
  const r = Math.max(0.025, f.budRadius * 0.9);
  const color = new THREE.Color(f.colorBase).lerp(new THREE.Color(f.colorMid), 0.55);
  const bud = new THREE.SphereGeometry(r, 9, 7);
  bud.scale(1, 1.55, 1);
  bud.translate(0, r * 1.4, 0);
  const parts = [paint(bud, color, 0.6)];
  for (let k = 0; k < 4; k++) parts.push(leaf(r * 1.9, r * 0.9, 1.15, (k / 4) * Math.PI * 2, r * 0.15, SEPAL, -0.1));
  return mergeParts(parts);
}

/**
 * The species' open flower, facing up, base at the origin: its outer whorls (up to three) from the species' own
 * petals, each petal a cupped strip shaded base to tip, round a centre in the species' centre colour.
 */
export function bloomHeadGeometry(id: SpeciesId): THREE.BufferGeometry {
  const f = SPECIES[id].flower;
  const parts: THREE.BufferGeometry[] = [];
  const cBase = new THREE.Color(f.colorBase), cMid = new THREE.Color(f.colorMid), cTip = new THREE.Color(f.colorTip);
  const layers = f.layers.slice(-3);
  const offset = f.layers.length - layers.length;
  layers.forEach((layer, li) => {
    const l = li + offset;
    // a strip of four rows along the petal: half-widths and colours from base to tip
    const rows = [0, 0.3, 0.68, 1];
    const half = [0.18, 0.5, 0.5 * (1 - 0.3 * layer.tip), 0.12 + 0.2 * (1 - layer.tip)];
    const colors = [cBase, cBase.clone().lerp(cMid, 0.8), cMid.clone().lerp(cTip, 0.5), cTip];
    for (let i = 0; i < layer.count; i++) {
      const yaw = (i / layer.count) * Math.PI * 2 + l * 0.6;
      const pos: number[] = [];
      const col: number[] = [];
      const vert = (row: number, side: number) => {
        const t = rows[row];
        const w = half[row] * layer.width * side;
        // cupped across the width and bent back toward the tip
        const cup = -Math.abs(side) * layer.cup * layer.width * 0.18 * Math.sin(Math.PI * Math.min(1, t + 0.2));
        const bend = layer.bend * layer.length * 0.25 * t * t;
        pos.push(w, t * layer.length, cup - bend);
        const c = colors[row];
        col.push(c.r, c.g, c.b);
      };
      for (let r = 0; r < rows.length - 1; r++) {
        // two triangles per row, both faces drawn by the material
        vert(r, -1);
        vert(r + 1, -1);
        vert(r + 1, 1);
        vert(r, -1);
        vert(r + 1, 1);
        vert(r, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
      g.setAttribute("glow", new THREE.BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
      g.computeVertexNormals();
      // open outward from upright by the layer's angle, inner whorls a touch higher
      g.rotateX(layer.open * 0.92);
      g.translate(0, (layers.length - 1 - li) * 0.008, 0);
      g.rotateY(yaw);
      parts.push(g);
    }
  });
  // the centre: the species' eye, or for a rose the tight spiral of its inner petals
  const rose = f.center.stamens === 0;
  const cr = rose ? f.budRadius * 1.25 : f.center.radius * 1.7;
  const centre = new THREE.SphereGeometry(cr, 10, 7);
  centre.scale(1, rose ? 0.85 : 0.55, 1);
  centre.translate(0, cr * 0.35, 0);
  parts.push(paint(centre, rose ? cBase.clone().lerp(cMid, 0.6) : f.center.color, 1));
  return mergeParts(parts);
}

/** The name stake: a slim wooden post and a small board leaning back a little, its face toward local +x. */
export function stakeGeometry(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.026, 0.4, 0.026);
  post.translate(0, 0.15, 0);
  const board = new THREE.BoxGeometry(0.018, 0.13, 0.46);
  board.translate(0, 0.0, 0);
  board.rotateZ(-0.22);
  board.translate(-0.012, 0.36, 0);
  return mergeParts([paint(post, "#7a5a3c"), paint(board, "#8a6844")]);
}

/** The board's painted face (the name atlas is laid on it), just in front of the board, facing local +x. */
export function signFaceGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.43, 0.115);
  g.rotateY(Math.PI / 2);
  g.translate(0.0105, 0, 0);
  g.rotateZ(-0.22);
  g.translate(-0.012, 0.36, 0);
  return g;
}
