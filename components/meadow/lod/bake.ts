// The Meadow's light plants (the near detail level, L1): each species in each band (bands.ts) posed once from the
// garden's own procedural flower (pose.ts) at a fraction of the garden's tessellation, every part merged into one
// indexed mesh coloured per vertex, so a whole plant is one draw under one material and hundreds of them share it by
// instancing (LodPlants.tsx). The far detail level's pictures (the atlas, scripts/bake-meadow-plants.mjs) are taken
// of exactly these meshes, so the two always match.
//
// Colour: the garden paints its petals, leaves and stems with canvas textures; here the same recipes are laid on the
// vertices instead (the petal's base-to-tip gradient with its paler margins, the leaf darkening toward its stalk, the
// stem's colour by segment), with a soft occlusion toward the soil so the lower leaves sit in their own shade. What
// the full plant's materials add on top (the petals' sheen, the leaves' paler veins and sheen) is folded into the
// colours, measured against the full plant in the Meadow's light (materials.ts ENV_FLOWER, ENV_FOLIAGE), so the full
// plant dissolving in over its light plant on a visit keeps its colour. Each
// vertex also carries how much it glows at night (`glow`: the petals strongest at their base and never quite dark, the
// stamens, a little for the bud, nothing for the foliage), which also tells flower from foliage, so a poorly plant's
// leaves can pale while its flower keeps its colour.
//
// Pure (three.js maths and the plant library): the atlas script runs it in Node.
import * as THREE from "three";
import { BAND_LOOK, LOD_SEEDS, type Band } from "@/components/meadow/lod/bands";
import { bakeMorph, posePlant, type PartMaterials, type PoseDetail } from "@/components/meadow/lod/pose";
import { smoothstep } from "@/lib/plant/prng";
import { SPECIES, type Species, type SpeciesId } from "@/lib/plant/species";

type Tag =
  | { kind: "stem"; t: number }
  | { kind: "leaf"; order: number }
  | { kind: "petiole" }
  | { kind: "thorn" }
  | { kind: "sepal" }
  | { kind: "bud" }
  | { kind: "petal"; variant: number }
  | { kind: "stamen" };

export interface BakedPlant {
  /** indexed; position, normal, color (linear) and glow attributes, in the plant's frame (garden metres) */
  geometry: THREE.BufferGeometry;
  /** from the soil to the plant's top, metres (before the Meadow's PLANT_SCALE) */
  height: number;
  /** the flower head's position in the plant's frame */
  head: THREE.Vector3;
  triangles: number;
}

/** Hue turn and lightness offset for each petal colour variant (components/garden/materials VARIANT_JITTER). */
const VARIANT_JITTER: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.012, 0.09],
  [-0.01, -0.08],
];

// ---- tessellation ----------------------------------------------------------------------------------------------------

let unitSphere: THREE.BufferGeometry | null = null;
/** A coarse unit sphere for the bud's core and the anthers, shared by every light plant. */
function lodSphere(): THREE.BufferGeometry {
  if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 7, 5);
  return unitSphere;
}

/** The receptacle as a short urn of six facets: at this size its ribs and neck are a pixel at most. */
function lodReceptacle(radius: number, height: number): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.42, 0],
    [0.98, 0.45],
    [0.86, 0.85],
    [0.98, 1],
    [0, 1],
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r * radius, y * height)),
    6,
  );
}

/** How finely a light plant is built: petals coarser the more of them the flower has, no thorns, a few stamens. */
export function lodDetail(sp: Species): PoseDetail {
  const petals = sp.flower.layers.reduce((n, l) => n + l.count, 0);
  const grid: [number, number] = petals <= 12 ? [3, 6] : petals <= 30 ? [3, 4] : petals <= 60 ? [2, 3] : [2, 2];
  return {
    petal: () => grid,
    leaf: sp.leaves.compound > 1 ? [2, 2] : [2, 3],
    sepal: [2, 3],
    stem: [3, 4],
    rachis: [2, 3],
    thorn: null,
    receptacle: lodReceptacle,
    sphere: lodSphere(),
    filament: null,
    stamens: 8,
    leaflets: 5,
  };
}

// ---- colour ----------------------------------------------------------------------------------------------------------

type RGB = [number, number, number];
const tmp = new THREE.Color();
const hsl = { h: 0, s: 0, l: 0 };

/** A hex colour's sRGB channels, 0..1 (as a canvas mixes them). */
function srgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** shiftHex from lib/plant/textures, on sRGB channels. */
function shift(c: RGB, dHue: number, dLight: number): RGB {
  tmp.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
  tmp.setHSL((hsl.h + dHue + 1) % 1, hsl.s, Math.min(1, Math.max(0, hsl.l * (1 + dLight))), THREE.SRGBColorSpace);
  const out = { r: 0, g: 0, b: 0 };
  tmp.getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Piecewise-linear through [at, value] stops. */
function ramp(stops: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) {
      const [x0, y0] = stops[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-6, x1 - x0);
    }
  }
  return stops[stops.length - 1][1];
}

/** The petal texture's recipe (lib/plant/textures petalTexture) at uv: base in the claw, the mid colour over the blade, the tip and margins paler. */
function petalColor(base: RGB, midC: RGB, tip: RGB, u: number, v: number): RGB {
  let c: RGB = v < 0.1 ? base : v < 0.34 ? mix(base, midC, (v - 0.1) / 0.24) : v < 0.78 ? midC : mix(midC, tip, (v - 0.78) / 0.22);
  // the margins and the very tip, softer than the texture's thin bands since a vertex spreads them over a facet
  c = mix(c, tip, 0.45 * smoothstep(0.6, 1, Math.abs(u * 2 - 1)));
  c = mix(c, tip, 0.4 * smoothstep(0.75, 1, v));
  return c;
}

/**
 * The foliage is lifted a little over the garden's leaf colours, as the Meadow's plants have always been: from the
 * Meadow camera's height, without the garden's close light and sheen, the true greens read as dark gaps in the beds.
 */
const FOLIAGE_LIFT = 1.3;

/** How much of a petal's sheen colour (per unit of the species' sheen) and of a leaf's vein green go into their colours. */
const PETAL_SHEEN = 0.14;
const LEAF_VEINS = 0.22;

/** How brightly a petal glows at uv: the emissive map's base-to-tip fall (in linear light), never quite dark. */
const PETAL_GLOW: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.22, 0.62],
  [0.62, 0.3],
  [1, 0.24],
];

interface Painter {
  color(tag: Tag, u: number, v: number): RGB;
  glow(tag: Tag, v: number): number;
}

function painter(sp: Species): Painter {
  const f = sp.flower;
  const l = sp.leaves;
  // the petals' velvet sheen, a soft glaze of its colour over the whole petal as the Meadow camera sees it
  const sheen = srgb(f.sheenColor);
  const glaze = (c: RGB): RGB => mix(c, sheen, PETAL_SHEEN * f.sheen);
  const petals = VARIANT_JITTER.map(([dh, dl]) => ({
    base: glaze(shift(srgb(f.colorBase), dh, dl)),
    mid: glaze(shift(srgb(f.colorMid), dh, dl)),
    tip: glaze(shift(srgb(f.colorTip), dh * 0.5, dl * 0.6)),
  }));
  const leafBase = srgb(l.color), leafTip = srgb(l.tipColor), leafVein = srgb(l.veinColor);
  const stemBase = srgb(sp.stem.color), stemTip = srgb(sp.stem.tipColor);
  const sepal = srgb(f.sepals.color);
  const sepalTip = shift(sepal, 0.01, 0.3);
  const petiole = srgb(l.petioleColor ?? sp.stem.tipColor);
  const thorn = srgb(sp.stem.thornColor ?? "#7a3a28");
  const bud = mix(srgb(f.colorBase), srgb(f.colorMid), 0.5);
  const stamen = srgb(f.center.stamenColor);
  return {
    color(tag, u, v) {
      switch (tag.kind) {
        case "petal": {
          const p = petals[tag.variant] ?? petals[0];
          return petalColor(p.base, p.mid, p.tip, u, v);
        }
        case "leaf":
          // darker toward the stalk, lighter at the tip, the veins' paler green over all of it
          return mix(mix(leafBase, leafTip, 0.3 + 0.7 * smoothstep(0.3, 1, v)), leafVein, LEAF_VEINS);
        case "stem":
          return mix(stemBase, stemTip, tag.t * 0.8);
        case "petiole":
          return petiole;
        case "thorn":
          return thorn;
        case "sepal":
          return mix(sepal, sepalTip, smoothstep(0.6, 1, v));
        case "bud":
          return bud;
        case "stamen":
          return stamen;
      }
    },
    glow(tag, v) {
      if (tag.kind === "petal") return ramp(PETAL_GLOW, v);
      if (tag.kind === "stamen") return 0.8;
      if (tag.kind === "bud") return 0.35;
      return 0;
    },
  };
}

const TAGS: PartMaterials<Tag> = {
  stem: (i, n) => ({ kind: "stem", t: n <= 1 ? 1 : i / (n - 1) }),
  leaf: (order) => ({ kind: "leaf", order }),
  petiole: () => ({ kind: "petiole" }),
  thorn: () => ({ kind: "thorn" }),
  sepal: () => ({ kind: "sepal" }),
  bud: () => ({ kind: "bud" }),
  petal: (variant) => ({ kind: "petal", variant }),
  stamen: () => ({ kind: "stamen" }),
};

// ---- the bake --------------------------------------------------------------------------------------------------------

/** Poses `species` in `band` at the light tessellation and merges it into one vertex-coloured mesh. */
export function bakeLodPlant(species: SpeciesId, band: Band): BakedPlant {
  const sp = SPECIES[species];
  const look = BAND_LOOK[band];
  const posed = posePlant(
    { speciesId: species, seed: LOD_SEEDS[species], growth: look.growth, bloom: look.bloom, health: 1, moisture: 0.6, scorch: 0 },
    lodDetail(sp),
    TAGS,
  );
  const paint = painter(sp);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const glow: number[] = [];
  const flower: number[] = [];
  const idx: number[] = [];
  const uvOf = (g: THREE.BufferGeometry, i: number): [number, number] => {
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    return uv ? [uv.getX(i), uv.getY(i)] : [0.5, 0.5];
  };
  for (const part of posed.parts) {
    const g = part.morph > 0 ? bakeMorph(part.geometry, part.morph) : part.geometry.clone();
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(part.matrix);
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const first = pos.length / 3;
    const isFlower = part.material.kind === "petal" || part.material.kind === "stamen" || part.material.kind === "bud";
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      const [u, v] = uvOf(g, i);
      const c = paint.color(part.material, u, v);
      col.push(c[0], c[1], c[2]);
      glow.push(paint.glow(part.material, v));
      flower.push(isFlower ? 1 : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(first + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
    g.dispose();
  }
  for (const g of posed.own) g.dispose();

  // height and soft occlusion toward the soil (the flower is lit from within and darkens less)
  let height = 0;
  for (let i = 1; i < pos.length; i += 3) height = Math.max(height, pos[i]);
  const linear = new Float32Array(col.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1] / Math.max(0.05, height);
    const ao = flower[i] ? 0.82 + 0.18 * smoothstep(0, 0.8, y) : FOLIAGE_LIFT * (0.68 + 0.32 * smoothstep(0, 0.75, y));
    tmp.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2], THREE.SRGBColorSpace);
    linear[i * 3] = tmp.r * ao;
    linear[i * 3 + 1] = tmp.g * ao;
    linear[i * 3 + 2] = tmp.b * ao;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(linear, 3));
  geometry.setAttribute("glow", new THREE.Float32BufferAttribute(glow, 1));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, height, head: posed.head, triangles: idx.length / 3 };
}
