// The far detail level's pictures: every light plant (bake.ts), in every band and at each of its three angles, drawn
// the way the Meadow camera sees it (raster.ts) and packed into one atlas of cells, with a matching atlas of normals
// and night glow so the pictures are lit by the Meadow's own sun and sky, hour by hour, exactly as the light plants
// are. Run by scripts/bake-meadow-plants.mjs, which encodes the two atlases as WebP into public/meadow/ and
// writes their measurements to atlasManifest.ts.
//
// Each cell holds its plant fitted to the cell with a few pixels of margin (so mipmaps of one plant do not bleed into
// the next). The card that shows it covers only the part of the cell the plant fills (a card's clear pixels still cost
// a phone's GPU their texture reads), and is told where in that part the plant's foot is, where its flower begins
// (the card stands upright below it and turns its flower toward a camera looking down more steeply than the picture
// was taken, materials.ts) and how many metres it spans.
//
// The second atlas has no alpha on purpose: it holds the normal's x and y (z is rebuilt facing the camera) and the glow
// in blue. Browsers that keep decoded images premultiplied (Safari) would wipe colour wherever alpha is zero, and the
// colour atlas is drawn premultiplied for the same reason (its margins then never filter in black).
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import { BAKE_ELEVATION, BANDS, cellIndex, CELL_COUNT, LOD_SPECIES, SPINS, VIEW_THETA, type Band } from "@/components/meadow/lod/bands";
import { dilate, project, rasterize, viewFor } from "@/components/meadow/lod/raster";
import type { SpeciesId } from "@/lib/plant/species";

export const CELL_W = 96;
export const CELL_H = 128;
export const COLUMNS = 12;
/** Pixels kept clear round each plant inside its cell. */
const MARGIN = 5;
/** Pixels of the clear margin a card keeps round its plant, for filtering. */
const CARD_PAD = 2;
/** Samples a side per pixel. */
const SS = 4;

/** Where a cell's picture is and how its card is laid out: uv rect (v from the bottom), card size (m), the foot (0..1). */
export interface CellLayout {
  u0: number;
  v0: number;
  du: number;
  dv: number;
  /** metres the cell spans, before the plant's own scale */
  width: number;
  height: number;
  /** the plant's foot within the cell, 0..1 from the left and from the bottom */
  footU: number;
  footV: number;
  /** where the flower begins, 0..1 from the bottom (between the foot and the top; halfway for a plant without one) */
  bendV: number;
}

export interface Atlas {
  width: number;
  height: number;
  /** sRGB albedo, alpha = coverage; rows top-down, as image files store them */
  albedo: Uint8Array;
  /** rgb: the view-space normal's x and y * 0.5 + 0.5, and the glow; rows top-down */
  normal: Uint8Array;
  cells: CellLayout[];
  /** plant heights (garden metres) per species and band */
  heights: Record<SpeciesId, Record<Band, number>>;
  triangles: Record<SpeciesId, Record<Band, number>>;
}

const toSrgb8 = (linear: number) => {
  const c = Math.max(0, Math.min(1, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
};
const to8 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);

export function bakeAtlas(): Atlas {
  const rows = Math.ceil(CELL_COUNT / COLUMNS);
  const width = COLUMNS * CELL_W;
  const height = rows * CELL_H;
  const albedo = new Uint8Array(width * height * 4);
  const normal = new Uint8Array(width * height * 3);
  // empty texels: a normal facing the camera, no glow
  for (let i = 0; i < width * height; i++) {
    normal[i * 3] = 128;
    normal[i * 3 + 1] = 128;
  }
  const cells: CellLayout[] = new Array(CELL_COUNT);
  const heights = {} as Record<SpeciesId, Record<Band, number>>;
  const triangles = {} as Record<SpeciesId, Record<Band, number>>;
  const view = viewFor(VIEW_THETA, BAKE_ELEVATION);

  for (const species of LOD_SPECIES) {
    heights[species] = {} as Record<Band, number>;
    triangles[species] = {} as Record<Band, number>;
    for (const band of BANDS) {
      const plant = bakeLodPlant(species, band);
      heights[species][band] = Math.round(plant.height * 1000) / 1000;
      triangles[species][band] = plant.triangles;
      SPINS.forEach((spin, s) => {
        const pr = project(plant.geometry, spin, view);
        const spanX = pr.max[0] - pr.min[0], spanY = pr.max[1] - pr.min[1];
        const scale = Math.min((CELL_W - 2 * MARGIN) / spanX, (CELL_H - 2 * MARGIN) / spanY);
        // centred in the cell
        const ox = (pr.min[0] + pr.max[0]) / 2 - CELL_W / 2 / scale;
        const oy = (pr.min[1] + pr.max[1]) / 2 - CELL_H / 2 / scale;
        const cell = rasterize(pr, CELL_W, CELL_H, ox, oy, scale, SS);
        // the part of the cell the plant fills, x0..x1 and y0..y1 (exclusive, rows from the bottom)
        let x0 = CELL_W, x1 = 0, y0 = CELL_H, y1 = 0;
        for (let y = 0; y < CELL_H; y++) {
          for (let x = 0; x < CELL_W; x++) {
            if (cell.alpha[y * CELL_W + x] <= 0) continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x + 1);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y + 1);
          }
        }
        x0 = Math.max(0, x0 - CARD_PAD);
        y0 = Math.max(0, y0 - CARD_PAD);
        x1 = Math.min(CELL_W, x1 + CARD_PAD);
        y1 = Math.min(CELL_H, y1 + CARD_PAD);
        dilate(cell, 5, 2);
        const i = cellIndex(species, band, s);
        const cx = (i % COLUMNS) * CELL_W, cy = Math.floor(i / COLUMNS) * CELL_H;
        for (let y = 0; y < CELL_H; y++) {
          // cell rows run bottom-up; the image's run top-down
          const row = cy + CELL_H - 1 - y;
          for (let x = 0; x < CELL_W; x++) {
            const p = y * CELL_W + x;
            const o = (row * width + cx + x) * 4;
            albedo[o] = toSrgb8(cell.albedo[p * 3]);
            albedo[o + 1] = toSrgb8(cell.albedo[p * 3 + 1]);
            albedo[o + 2] = toSrgb8(cell.albedo[p * 3 + 2]);
            albedo[o + 3] = to8(cell.alpha[p]);
            const n = (row * width + cx + x) * 3;
            normal[n] = to8(cell.normal[p * 3] * 0.5 + 0.5);
            normal[n + 1] = to8(cell.normal[p * 3 + 1] * 0.5 + 0.5);
            normal[n + 2] = to8(cell.glow[p]);
          }
        }
        // the lowest point of the flower (petals, stamens or bud: the parts that glow), in cell pixels from the bottom
        let flowerY = Infinity;
        for (let k = 0; k < pr.glow.length; k++) if (pr.glow[k] > 0.01) flowerY = Math.min(flowerY, (pr.xyz[k * 3 + 1] - oy) * scale);
        const footV = Math.min(1, Math.max(0, (-oy * scale - y0) / (y1 - y0)));
        const bendV = Number.isFinite(flowerY) ? Math.min(1, Math.max(footV, (flowerY - y0) / (y1 - y0))) : footV + 0.5 * (1 - footV);
        const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
        const vBottom = 1 - (cy + CELL_H) / height;
        cells[i] = {
          u0: r4((cx + x0) / width),
          v0: r4(vBottom + y0 / height),
          du: r4((x1 - x0) / width),
          dv: r4((y1 - y0) / height),
          width: r4((x1 - x0) / scale),
          height: r4((y1 - y0) / scale),
          footU: r4((-ox * scale - x0) / (x1 - x0)),
          footV: r4(footV),
          bendV: r4(bendV),
        };
      });
      plant.geometry.dispose();
    }
  }
  return { width, height, albedo, normal, cells, heights, triangles };
}

/** A short stable hash of the atlas pixels, for cache-busting its URLs. */
export function atlasVersion(a: Atlas): string {
  let h = 2166136261 >>> 0;
  for (const buf of [a.albedo, a.normal]) {
    for (let i = 0; i < buf.length; i += 7) {
      h ^= buf[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(36);
}

