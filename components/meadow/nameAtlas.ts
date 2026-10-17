// The names on the stakes, painted into one texture: every distinct name gets a cell (a cream board with a soft
// painted edge and the name lettered in warm brown), and each stake's face samples its cell, so three hundred
// signs are one draw call. Cells are handed out as names first appear and kept, so a new planting only paints its
// own cell. Names of any script are lettered by the browser's own fonts.
import * as THREE from "three";

const CELL_W = 256;
const CELL_H = 64;
const COLS = 8;
const WIDTH = CELL_W * COLS;
/** Rows of the first atlas; it doubles in height when the names outgrow it. */
const FIRST_ROWS = 16;
const MAX_ROWS = 64;

const FONT_STACK = `Georgia, "Iowan Old Style", "Palatino Linotype", "Noto Serif", serif`;

export class NameAtlas {
  /** Replaced (never resized: WebGL texture storage is fixed once uploaded) when the atlas grows; see `version`. */
  texture: THREE.CanvasTexture;
  version = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rows: number;
  private cells = new Map<string, number>();

  constructor() {
    this.rows = FIRST_ROWS;
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = CELL_H * this.rows;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = NameAtlas.textureOf(this.canvas);
  }

  private static textureOf(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  /** The uv size of one cell, for the sign shader. */
  cellSize(): [number, number] {
    return [CELL_W / WIDTH, CELL_H / (CELL_H * this.rows)];
  }

  /** The uv offset (bottom-left) of a name's cell, painting it the first time the name is seen. */
  cellOf(name: string): [number, number] {
    let index = this.cells.get(name);
    if (index === undefined) {
      index = this.cells.size;
      if (index >= this.rows * COLS) {
        if (this.rows >= MAX_ROWS) index = 0;
        else this.grow();
      }
      if (index < this.rows * COLS) {
        this.cells.set(name, index);
        this.paint(name, index);
        this.texture.needsUpdate = true;
      }
    }
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    // the texture is flipped (v = 1 at the canvas top), so a row counts down from the top
    return [(col * CELL_W) / WIDTH, 1 - ((row + 1) * CELL_H) / (CELL_H * this.rows)];
  }

  dispose(): void {
    this.texture.dispose();
  }

  private grow(): void {
    const old = this.canvas;
    const rows = Math.min(MAX_ROWS, this.rows * 2);
    const next = document.createElement("canvas");
    next.width = WIDTH;
    next.height = CELL_H * rows;
    const ctx = next.getContext("2d")!;
    ctx.drawImage(old, 0, 0);
    this.canvas = next;
    this.ctx = ctx;
    this.rows = rows;
    this.texture.dispose();
    this.texture = NameAtlas.textureOf(next);
    this.version++;
  }

  private paint(name: string, index: number): void {
    const ctx = this.ctx;
    const x = (index % COLS) * CELL_W;
    const y = Math.floor(index / COLS) * CELL_H;
    // the board: cream paint, a little darker toward the edges, with a few strokes of grain showing through
    const g = ctx.createLinearGradient(x, y, x, y + CELL_H);
    g.addColorStop(0, "#f6ead2");
    g.addColorStop(1, "#e9d7b6");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CELL_W, CELL_H);
    ctx.strokeStyle = "rgba(150,110,70,0.12)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const yy = y + 8 + k * 12 + ((index * 7 + k * 3) % 5);
      ctx.beginPath();
      ctx.moveTo(x + 4, yy);
      ctx.bezierCurveTo(x + 80, yy - 2, x + 170, yy + 2, x + CELL_W - 4, yy);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(120,84,50,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2.5, y + 2.5, CELL_W - 5, CELL_H - 5);
    // the name, shrunk to fit the board
    ctx.fillStyle = "#4a3221";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 38;
    ctx.font = `italic 600 ${size}px ${FONT_STACK}`;
    while (size > 16 && ctx.measureText(name).width > CELL_W - 26) {
      size -= 2;
      ctx.font = `italic 600 ${size}px ${FONT_STACK}`;
    }
    ctx.fillText(name, x + CELL_W / 2, y + CELL_H / 2 + 2);
  }
}

/**
 * A lit material that reads its map from one cell of the atlas per instance: each instance's `aCell` attribute
 * moves the face's uvs onto its name.
 */
export function signMaterial(atlas: NameAtlas): THREE.MeshStandardMaterial {
  const cell = { value: new THREE.Vector2(...atlas.cellSize()) };
  const mat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCellSize = cell;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aCell;\nuniform vec2 uCellSize;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = uv * uCellSize + aCell;");
  };
  mat.customProgramCacheKey = () => "meadow-sign";
  mat.userData.cell = cell;
  return mat;
}

/** Keeps the material's texture and cell size in step after the atlas has grown. */
export function syncSignMaterial(mat: THREE.MeshStandardMaterial, atlas: NameAtlas): void {
  (mat.userData.cell as { value: THREE.Vector2 }).value.set(...atlas.cellSize());
  if (mat.map !== atlas.texture) {
    mat.map = atlas.texture;
    mat.needsUpdate = true;
  }
}
