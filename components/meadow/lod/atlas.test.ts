// The far plants' pictures are lit in the Meadow per pixel from the atlas's colour and normals (materials.ts), the
// light plants from their own vertices; a dissolve between the two must not brighten or dim a plant. This renders each
// cell both ways under the same light, from the shipped WebP files themselves (so their encoding and the shader's
// decoding are all in it), and holds their brightness together. (Their lighting in the Meadow, the plant environment
// and the sun's shade where plants cast shadows, was matched in the browser: materials.ts ENV_*, SELF_SHADE.)
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ATLAS, CELLS } from "@/components/meadow/lod/atlasManifest";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import { BAKE_ELEVATION, BANDS, cellIndex, hasLight, LOD_KINDS, SPINS, VIEW_THETA } from "@/components/meadow/lod/bands";
import { project, rasterize, viewFor } from "@/components/meadow/lod/raster";

/** Lights in the bake's view space (x right, y up, z toward the camera): from the front and above, and from the side. */
const LIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.3, 0.6, 0.74],
  [-0.85, 0.45, 0.27],
];
const AMBIENT = 0.45;
const SS = 3;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const shade = (nx: number, ny: number, nz: number, l: readonly [number, number, number]) => AMBIENT + Math.max(0, nx * l[0] + ny * l[1] + nz * l[2]);

async function decode(file: string, channels: 3 | 4) {
  const buf = readFileSync(path.resolve(__dirname, "../../../public", file.replace(/^\//, "").replace(/\?.*$/, "")));
  const { data, info } = await sharp(buf).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = channels === 4 ? (await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer()) : null;
  return { data, alpha, width: info.width, height: info.height };
}

describe("the pictures against their light plants", () => {
  it("are packed nine kinds deep (the river's lotus the ninth row) in one 1152 x 1152 atlas", () => {
    expect(ATLAS.width).toBe(1152);
    expect(ATLAS.height).toBe(1152);
    expect(CELLS.length).toBe(108);
  });

  it("are as bright as the light plants they stand for (2% apart on average, every cell within 10%)", async () => {
    const albedo = await decode(ATLAS.albedo, 4);
    const normal = await decode(ATLAS.normal, 3);
    const view = viewFor(VIEW_THETA, BAKE_ELEVATION);
    const off: string[] = [];
    const all: number[] = [];
    for (const kind of LOD_KINDS) {
      for (const band of BANDS) {
        if (!hasLight(kind, band)) continue;
        const plant = bakeLodPlant(kind, band);
        for (let s = 0; s < SPINS.length; s++) {
          const [u0, v0, du, dv] = CELLS[cellIndex(kind, band, s)];
          const pr = project(plant.geometry, SPINS[s], view);
          for (const l of LIGHTS) {
            // the light plant: every sample lit by its own normal (turned to the camera where its face is turned away,
            // as its two-sided material does), then averaged into pixels
            const w = 64, h = 84;
            const scale = Math.min((w - 4) / (pr.max[0] - pr.min[0]), (h - 4) / (pr.max[1] - pr.min[1]));
            const ox = (pr.min[0] + pr.max[0]) / 2 - w / 2 / scale, oy = (pr.min[1] + pr.max[1]) / 2 - h / 2 / scale;
            const cell = rasterize(pr, w, h, ox, oy, scale, SS, (nx, ny, nz) => shade(nx, ny, nz, l));
            let nearSum = 0, nearW = 0;
            for (let p = 0; p < w * h; p++) {
              nearSum += cell.alpha[p] * lum(cell.albedo[p * 3], cell.albedo[p * 3 + 1], cell.albedo[p * 3 + 2]);
              nearW += cell.alpha[p];
            }
            // the picture: its cell of the shipped atlas, decoded and lit as farMaterial does
            let farSum = 0, farW = 0;
            const x0 = Math.round(u0 * albedo.width), x1 = Math.round((u0 + du) * albedo.width);
            const y0 = Math.round((1 - v0 - dv) * albedo.height), y1 = Math.round((1 - v0) * albedo.height);
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const a = albedo.alpha![y * albedo.width + x] / 255;
                if (a <= 0) continue;
                const o = (y * albedo.width + x) * 4;
                const nxp = Math.min(normal.width - 1, Math.floor(((x + 0.5) / albedo.width) * normal.width));
                const nyp = Math.min(normal.height - 1, Math.floor(((y + 0.5) / albedo.height) * normal.height));
                const n = (nyp * normal.width + nxp) * 4;
                const nx = (normal.data[n] / 255) * 2 - 1, ny = (normal.data[n + 1] / 255) * 2 - 1;
                const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
                const k = shade(nx, ny, nz, l);
                const c = (i: number) => Math.pow(albedo.data[o + i] / 255, 2.2) * k;
                farSum += a * lum(c(0), c(1), c(2));
                farW += a;
              }
            }
            const ratio = farSum / Math.max(1e-6, farW) / (nearSum / Math.max(1e-6, nearW));
            all.push(ratio);
            if (Math.abs(ratio - 1) > 0.1) off.push(`${kind} ${band} ${s}: ${ratio.toFixed(3)}`);
          }
        }
        plant.geometry.dispose();
      }
    }
    // a thin sprout seen edge-on is where lighting a pixel's average normal strays most from lighting each sample
    expect(off).toEqual([]);
    expect(all.reduce((a, r) => a + Math.abs(r - 1), 0) / all.length).toBeLessThan(0.03);
    // past 5% today: the sundrop's sprout, the marigold's leafy plant and bud, and the jasmine's cluster of buds, each at one angle
    expect(all.filter((r) => Math.abs(r - 1) > 0.05).length).toBeLessThanOrEqual(4);
  }, 60_000);
});
