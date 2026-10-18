"use client";
/* eslint-disable react-hooks/immutability --
   Materials, uniforms, the wheel instances and the fireflies' buffers are created once and written in the frame loop
   (see concepts/kit.tsx); they never feed back into what React renders. */
// The Lantern Cart as built: the firefly trolley the owner chose (concepts/FireflyTrolley.tsx), with the seed barrow's
// terracotta pots of seedlings set into its tub. A rounded tin tub painted duck-egg teal with a band of coral flowers
// and cream daisies, worn at the edges, full of soil: rows of seedlings, three clay pots sunk to different depths
// among them (one in saffron flower), two bushes of tulsi at the front and a marigold at the back. It rides on copper
// wire-spoked wheels with a painted flower on every hub, and two bold cream spokes ending in coral bands on every tyre,
// so their turning reads even from a phone's follow camera. A copper hoop, clamped to the rim and bolted to the wall,
// arches over the tub with a jasmine vine climbing it from the soil, and from a short crook at its top hangs the
// guardian light, held out a hand's width in front of the hoop so the hoop does not cut across it: a glass jar of
// fireflies in a copper cage, brightening as night falls, while a few fireflies slip out at dusk and circle the cart,
// trailing it a little as it moves. A copper watering can hangs from the push handle.
//
// Drawn in chassis space like every concept (+x forward, +y up, wheel centres 0.54 below the chassis at the default
// ride). `wheels` receives four empty mounts that the parent poses (PhysicsCart from the vehicle's wheel states, the
// glider from its own motion), and one instanced mesh draws the four wheels wherever the mounts are.
//
// Draw calls: the trolley (tub, soil, plants, pots and copper in one mesh), the wheels (instanced), the jar's copper,
// its glass, the glass's glint, the fireflies (in the jar and out, one set of points) and the halo: seven, with three
// shadow casters; on the lite tier the ground's pool of light makes eight after dark. About 9.2k triangles.
//
// Light. The jar's real point light never lives here: in the Meadow the scene holds it from the first frame
// (GuardianLight, mounted by MeadowEnvironment) and it only follows the jar this cart publishes in meadow.guardian,
// so the cart arriving, or the glider taking over, never changes the light count (which would recompile every
// material in the Meadow). The jar is published after the cart and the camera have moved and before the light reads
// it (frame priority -0.45), so the light never trails the jar. The light is kept soft (a gentle peak, a slow
// falloff), so it spreads over the tub rather than burning the soil under it. On the lite tier (phones) there is no
// point light at all: the jar's glow is painted onto the trolley in its own shader, and a soft pool of warm light is
// laid on the ground under it after dark. Every tier also paints a little of the jar's glow onto the tin and copper
// that face away from it (the tub's outer wall, which the jar inside the rim cannot reach), and lifts the painted tin
// a touch after dark, so the duck-egg tub and its flower band still read at dusk. With reduced motion fewer fireflies
// leave the jar, and every firefly drifts and blinks more slowly.
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { merge, seeded } from "@/components/meadow/parts";
import {
  axleLathe,
  canvasTexture,
  crumple,
  glowAt,
  glowTexture,
  Halo,
  lathe,
  Loop,
  place,
  spoke,
  squircle,
  tube,
  tubeAlong,
  useAssets,
  useSwing,
  v,
  WHEEL_Y,
  type ConceptProps,
} from "@/components/meadow/concepts/kit";
import { WHEEL } from "@/components/meadow/cart";
import { meadow } from "@/components/meadow/runtime";
import { readDevice } from "@/lib/garden/device";

export const JAR_LIGHT = "#ffe08a";

const COPPER = "#c47a4a";
const TYRE = "#ece2cc";
const WOOD = "#8a5e38";
const SOIL = "#3b2a1f";
const POT_SOIL = "#3d2c20";
const STEM = "#5a8a3e";
const LEAF = ["#5f9a46", "#6dab50", "#4f8a3c"];
const TULSI = ["#4f8040", "#5c8f48", "#6a7a46"];
const JASMINE = "#fbf7ec";
const SAFFRON = ["#e39a2f", "#f6b52a"];
const TEAL = "#5f9d90";
const CORAL = "#ec8b72";
/** The tyres' painted bands: a deeper coral, so they stand out from the cream tyre at a glance. */
const BAND_CORAL = "#dc6248";
const BUTTER = "#f6c453";
const FIREFLY = ["#eaf56e", "#ffd96a", "#d8f070"];

/**
 * Roughness, metalness and "lift", per vertex, so tin, paint, clay and copper share one material and one draw. Lift
 * is how much a surface takes the jar's glow on the side facing away from it and the small brightening after dark
 * (trolleyMaterial): the tin fully, the copper and tyres partly, the soil, plants and pots not at all, since the
 * jar's own light already falls on them from above.
 */
type Surface = readonly [number, number, number];
const TIN: Surface = [0.55, 0.08, 1];
const PAINTED: Surface = [0.8, 0, 0];
const CLAY: Surface = [0.92, 0, 0];
const RUBBER: Surface = [0.85, 0, 0.6];
const METAL: Surface = [0.36, 0.6, 0.45];
/** Paint on the wheels (the hub caps, the bold spokes), lifted like the tin so the turning still reads after dark. */
const WHEEL_PAINT: Surface = [0.8, 0, 0.8];

/** The tub's outline, radius against height, bottom to top, with two pressed ribs; squared off into a rounded oblong. */
const TUB: Array<[number, number]> = [
  [0, -0.33],
  [0.27, -0.33],
  [0.288, -0.322],
  [0.296, -0.305],
  [0.31, -0.235],
  [0.323, -0.215],
  [0.319, -0.198],
  [0.335, -0.06],
  [0.348, -0.036],
  [0.344, -0.02],
  [0.36, 0.08],
  [0.366, 0.095],
];
const SHAPE = { a: 1.55, b: 1, n: 3.2 };
/** Profile indices bounding the painted flower band. */
const BAND = [6, 9];
const SOIL_Y = 0.055;
/** The soil's half-length and half-width inside the tub's wall. */
const SOIL_R = 0.354;
/**
 * The hoop: half-span across the tub (its feet just outside the wall, its tube touching the copper rim, where a clamp
 * holds the two together), the height of its foot and of its top.
 */
const HOOP = { z: 0.372, y0: 0.0, h: 1.08 };
/** The tub's wall at height y on the hoop's line (x = 0), and how far it leans out, for the feet's brackets. */
const WALL = { at: (y: number) => 0.344 + (y + 0.02) * 0.16, lean: Math.atan(0.16) };
/** Where the hoop's feet are bolted to the wall: the bracket's centre height. */
const FOOT_Y = 0.02;
/** The stretch of hoop the jasmine winds round, as shares of it from its right foot: clear of the rim, over the top. */
const VINE = { from: 0.06, to: 0.73 };
/**
 * The shepherd's crook at the hoop's top that holds the jar out a hand's width in front of the hoop, lighting the
 * way: its line in the cart's middle plane, from inside the hoop's tube, up and forward, then down and curling under
 * to where the jar's ring hangs, its tip turned up. Hung in the hoop's own plane, the jar was cut in two by the hoop
 * whenever the cart stood side-on to the follow camera (the hoop seen edge-on, a stroke straight down the glass).
 * Out in front, side-on the hoop passes clear behind it; from the front and the front three-quarters (how the cart is
 * first seen, and on the concept stage) the arch stands behind the jar and frames it; only from behind does a leg of
 * the hoop come between the camera and the glass. The jar hangs a little lower than it did, so seen from behind, the
 * arch's crown passes above it.
 */
const CROOK: Array<[number, number]> = [
  [-0.006, 1.078],
  [0.04, 1.108],
  [0.11, 1.124],
  [0.172, 1.11],
  [0.215, 1.07],
  [0.228, 1.02],
  [0.221, 0.988],
  [0.202, 0.974],
  [0.183, 0.98],
  [0.174, 0.996],
];
/** The ring in the crook's curl, and below it the hook the jar swings from. */
const RING = { x: 0.2, y: 0.968, r: 0.018 };
const HOOK = v(RING.x, RING.y - 0.006, 0);
/** The jar is drawn a size up on its hook, so the guardian light reads from the follow camera. */
const JAR_SCALE = 1.25;
/** The middle of the jar, in the jar's own (unscaled) space: where its light comes from. */
const JAR_HEART = v(0, -0.26, 0);
const TULSI_AT: Array<[number, number]> = [
  [0.4, -0.17],
  [0.4, 0.17],
];
const MARIGOLD_AT: [number, number] = [-0.4, 0];

/**
 * The clay pots from the seed barrow, sunk into the tub's soil to different depths among the seedlings: where each
 * stands, its size, how deep it is sunk, its clay, what grows in it, and a slight lean.
 */
const POTS: Array<{ x: number; z: number; s: number; sink: number; clay: string; grows: "flowers" | "sapling" | "sprouts"; lean: number }> = [
  { x: -0.235, z: 0.125, s: 1.12, sink: 0.03, clay: "#b8653f", grows: "flowers", lean: 0 },
  { x: 0.2, z: -0.135, s: 0.95, sink: 0.05, clay: "#c47a52", grows: "sapling", lean: 0.05 },
  { x: 0.045, z: 0.2, s: 0.74, sink: 0.035, clay: "#a95a38", grows: "sprouts", lean: -0.08 },
];
const POT_PROFILE: Array<[number, number]> = [
  [0, 0],
  [0.058, 0],
  [0.072, 0.12],
  [0.086, 0.125],
  [0.086, 0.158],
  [0.072, 0.16],
];
const POT_RIM = 0.086;
const POT_SOIL_Y = 0.148;

/** Fireflies in the jar and loose round the cart, per tier; reduced motion sends fewer out and keeps fewer in. */
const FLIES = { full: { jar: 14, loose: 8 }, lite: { jar: 9, loose: 5 } } as const;
/**
 * A firefly's glow: metres across, and the smallest it may draw as a share of the canvas's half-height, so the loose
 * ones still read from the follow camera (a glow about fourteen pixels across on a laptop) without swelling up close.
 */
const FLY_SIZE = { jar: [0.03, 0.006], loose: [0.075, 0.032] } as const;
/** The loose fireflies trail the cart by about this long, and never by more than this far (metres). */
const TRAIL = { seconds: 0.35, reach: 0.7 };

/**
 * The jar's point light (GuardianLight, not on the lite tier): its strength by day and after dark, with a gentle peak
 * and a slow falloff, so it spreads over the tub, the cart and the paving round it instead of burning the soil and
 * seedlings half a metre under the jar.
 */
const JAR_POINT = { day: 0.35, night: 1.9, decay: 1.2, distance: 6 };
/**
 * The jar's glow painted onto the trolley, by day and after dark: onto everything on the lite tier, on the others only
 * onto what faces away from the jar.
 */
const JAR_PAINT = { lite: [0.16, 0.95], full: [0.05, 0.7] } as const;
/** The painted tin's small brightening, by day and after dark. */
const TIN_LIFT = [0.03, 0.1] as const;
/**
 * When the jar is published each frame: after the cart and the glider have moved (-5 to -4.9) and the camera (-1),
 * and before GuardianLight reads it (-0.4), so the light stands exactly where the jar is drawn this frame. The jar's
 * swing runs just before.
 */
const JAR_PRIORITY = -0.45;

/** The tin texture: the painted art, then a strip of plain white that every other part samples (an atlas of one). */
const ART_H = 120;
const PLAIN_H = 8;
const TEX_H = ART_H + PLAIN_H;
const PLAIN_V = PLAIN_H / 2 / TEX_H;

let liteTier: boolean | null = null;
/**
 * The Meadow's lightest tier, picked as MeadowCanvas picks it for the plants (a phone draws "lite", every other class
 * "balanced"), read once. `?device=phone` on a desktop tries it.
 */
export function meadowLite(): boolean {
  if (liteTier === null) liteTier = readDevice().kind === "phone";
  return liteTier;
}

function prefersCalm(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const tmpColor = new THREE.Color();

/**
 * Colours a part, gives it its surface, and points its uvs at the texture's plain strip (unless it keeps its own, as
 * the tub does): non-indexed, with exactly the attributes every part shares, so all of them can merge.
 */
function coat(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, surface: Surface, keepUv = false): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  const n = g.attributes.position.count;
  tmpColor.set(color);
  const col = new Float32Array(n * 3);
  const rm = new Float32Array(n * 3);
  const uv = keepUv && g.attributes.uv ? null : new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r;
    col[i * 3 + 1] = tmpColor.g;
    col[i * 3 + 2] = tmpColor.b;
    rm[i * 3] = surface[0];
    rm[i * 3 + 1] = surface[1];
    rm[i * 3 + 2] = surface[2];
    if (uv) {
      uv[i * 2] = 0.5;
      uv[i * 2 + 1] = PLAIN_V;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("rm", new THREE.BufferAttribute(rm, 3));
  if (uv) g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Painted tin: duck-egg teal, a band of coral flowers and cream daisies on leafy sprigs, chipped at the edges. */
function tinTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = ART_H;
  const n = TUB.length - 1;
  const yOf = (i: number) => (1 - i / n) * H;
  const tex = canvasTexture(W, TEX_H, (ctx) => {
    const rand = seeded(311);
    // a light duck-egg, so the tub still reads as teal in the shade and at dusk
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#9bcdc1");
    g.addColorStop(0.55, "#88bdb1");
    g.addColorStop(1, "#6ea295");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // brush strokes in the paint
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(20,60,55,0.06)";
      ctx.fillRect(rand() * W, rand() * H, 1, 6 + rand() * 18);
    }
    const top = yOf(BAND[1]);
    const bottom = yOf(BAND[0]);
    const mid = (top + bottom) / 2;
    ctx.fillStyle = "#f4ead2";
    for (const y of [top + 2, bottom - 3, yOf(n) + 6]) ctx.fillRect(0, y, W, 1.6);
    const cell = W / 8;
    for (let k = 0; k < 8; k++) {
      const cx = (k + 0.5) * cell;
      // sprigs curving out either side
      ctx.strokeStyle = "#4c7f5c";
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, mid);
        ctx.quadraticCurveTo(cx + dir * 18, mid - 12, cx + dir * 30, mid - 2);
        ctx.stroke();
        ctx.fillStyle = "#4c7f5c";
        for (const t of [0.45, 0.8]) {
          ctx.beginPath();
          ctx.ellipse(cx + dir * 30 * t, mid - 9 * t + 4, 5, 2.2, dir * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // the coral flower
      ctx.fillStyle = CORAL;
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 6.5, mid + Math.sin(a) * 6.5, 5.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#c9604c";
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.fillRect(cx + Math.cos(a) * 4 - 0.6, mid + Math.sin(a) * 4 - 0.6, 1.2, 1.2);
      }
      ctx.fillStyle = BUTTER;
      ctx.beginPath();
      ctx.arc(cx, mid, 3.4, 0, Math.PI * 2);
      ctx.fill();
      // cream daisies between
      const dx = cx + cell / 2;
      ctx.fillStyle = "#f7eedb";
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(dx + Math.cos(a) * 4, mid + 3 + Math.sin(a) * 4, 3.4, 1.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#e8a64a";
      ctx.beginPath();
      ctx.arc(dx, mid + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // wear: the paint chipped back to tin near the rim and the foot
    for (let i = 0; i < 70; i++) {
      const nearTop = rand() < 0.6;
      const y = nearTop ? rand() * 9 : H - rand() * 14;
      ctx.fillStyle = rand() < 0.8 ? "rgba(170,172,165,0.85)" : "rgba(138,90,58,0.6)";
      ctx.beginPath();
      ctx.ellipse(rand() * W, y, 1 + rand() * 3, 0.8 + rand() * 1.5, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // the plain strip the rest of the trolley samples, multiplied by its own vertex colours
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, H, W, PLAIN_H);
  });
  // the strip and the art must not bleed into each other up and down
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** The tub, its uvs moved into the art above the plain strip; the seam goes at the back, under the push handle. */
function tubGeometry(): THREE.BufferGeometry {
  const g = squircle(lathe(TUB, 36, -Math.PI / 2), SHAPE.a, SHAPE.b, SHAPE.n);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (PLAIN_H + uv.getY(i) * ART_H) / TEX_H);
  return coat(g, "#ffffff", TIN, true);
}

/** A small leaf, base at the origin pointing along +x. */
function leafGeometry(): THREE.BufferGeometry {
  const p = [0, 0, 0, 0.05, 0.012, 0.03, 0.11, 0, 0, 0, 0, 0, 0.11, 0, 0, 0.05, 0.012, -0.03];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** The hoop over the tub, in the YZ plane, from its right foot (t = 0) to its left (t = 1). */
class Hoop extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI;
    return target.set(0, HOOP.y0 + HOOP.h * Math.sin(a), HOOP.z * Math.cos(a));
  }
}

/** A vine winding round the hoop from its right foot up and over the top. */
class Vine extends THREE.Curve<THREE.Vector3> {
  hoop = new Hoop();
  constructor() {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const s = VINE.from + t * (VINE.to - VINE.from);
    const c = this.hoop.getPoint(s);
    const tan = this.hoop.getTangent(s);
    const side = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(tan, side);
    const phi = t * Math.PI * 2 * 9;
    return target.copy(c).addScaledVector(normal, Math.cos(phi) * 0.024).addScaledVector(side, Math.sin(phi) * 0.024);
  }
}

/** Inside the soil's squircle, shrunk by `kx` along and `kz` across, so a plant's leaves stay off the wall. */
function inSoil(x: number, z: number, kx: number, kz: number): boolean {
  return (Math.abs(x) / (SOIL_R * SHAPE.a * kx)) ** SHAPE.n + (Math.abs(z) / (SOIL_R * SHAPE.b * kz)) ** SHAPE.n < 1;
}

/** A seedling: a stem and a pair (or two) of leaves at its top, standing on `y`. */
function seedling(parts: THREE.BufferGeometry[], leaf: THREE.BufferGeometry, x: number, y: number, z: number, h: number, yaw: number, size: number, rand: () => number, pairs = 1) {
  parts.push(coat(spoke(v(x, y, z), v(x, y + h, z), 0.004, 0.003, 3), STEM, PAINTED));
  for (let p = 0; p < pairs; p++) {
    const at = y + h * (1 - p * 0.42);
    const k = size * (1 - p * 0.25);
    for (const turn of [0, Math.PI]) {
      parts.push(coat(place(leaf.clone(), v(x, at, z), new THREE.Euler(0, yaw + turn + p * 1.4, 0.45, "YXZ"), k), LEAF[Math.floor(rand() * 3)], PAINTED));
    }
  }
}

/** A clay pot from the seed barrow, sunk into the soil, with its own soil and what grows in it. */
function potGeometry(parts: THREE.BufferGeometry[], leaf: THREE.BufferGeometry, pot: (typeof POTS)[number], rand: () => number) {
  const base = SOIL_Y - pot.sink;
  // a pot's own frame: it stands at its spot, sunk a little, leaning a touch
  const frame = new THREE.Matrix4().compose(v(pot.x, base, pot.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pot.lean, rand() * 6, pot.lean * 0.6)), v(pot.s, pot.s, pot.s));
  const own: THREE.BufferGeometry[] = [];
  own.push(coat(lathe(POT_PROFILE, 12), pot.clay, CLAY));
  const soil = new THREE.CircleGeometry(0.073, 12);
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, POT_SOIL_Y, 0);
  own.push(coat(soil, POT_SOIL, PAINTED));
  if (pot.grows === "sapling") {
    // one young plant, taller than the seedlings round it, with two pairs of leaves
    seedling(own, leaf, 0, POT_SOIL_Y, 0, 0.15, rand() * 3, 0.85, rand, 2);
  } else {
    const n = pot.grows === "flowers" ? 3 : 2;
    for (let s = 0; s < n; s++) {
      const a = s * 2.1 + rand();
      const bx = Math.cos(a) * 0.033;
      const bz = Math.sin(a) * 0.033;
      const h = pot.grows === "flowers" ? 0.07 + rand() * 0.04 : 0.035 + rand() * 0.025;
      seedling(own, leaf, bx, POT_SOIL_Y, bz, h, a, pot.grows === "flowers" ? 0.7 : 0.5, rand);
      if (pot.grows === "flowers" && s < 2) {
        own.push(coat(place(new THREE.DodecahedronGeometry(0.026, 0), v(bx, POT_SOIL_Y + h + 0.024, bz), new THREE.Euler(rand(), rand(), 0)), SAFFRON[s], PAINTED));
      }
    }
  }
  for (const g of own) {
    g.applyMatrix4(frame);
    parts.push(g);
  }
}

/** Soil, seedlings, the pots among them, tulsi, a marigold, the vine with its leaves and flowers, and the grip. */
function plantsGeometry(parts: THREE.BufferGeometry[]) {
  const rand = seeded(2026);
  const soil = new THREE.CircleGeometry(SOIL_R, 36);
  soil.rotateX(-Math.PI / 2);
  squircle(soil, SHAPE.a, SHAPE.b, SHAPE.n);
  soil.translate(0, SOIL_Y, 0);
  parts.push(coat(soil, SOIL, PAINTED));
  const leaf = leafGeometry();

  // staggered rows of seedlings across the soil, leaving room round the pots, the tulsi, the marigold and the vine
  const clear = (x: number, z: number) => {
    for (const p of POTS) if (Math.hypot(x - p.x, z - p.z) < POT_RIM * p.s + 0.085) return false;
    for (const [tx, tz] of TULSI_AT) if (Math.hypot(x - tx, z - tz) < 0.12) return false;
    if (Math.hypot(x - MARIGOLD_AT[0], z - MARIGOLD_AT[1]) < 0.1) return false;
    // the vine climbs from the hoop's right foot
    if (Math.abs(x) < 0.09 && z > 0.24) return false;
    return inSoil(x, z, 0.86, 0.78);
  };
  const ROWS = [-0.2, -0.1, 0, 0.1, 0.2];
  ROWS.forEach((z, r) => {
    for (let x = -0.48 + (r % 2) * 0.055; x < 0.5; x += 0.11) {
      const px = x + (rand() - 0.5) * 0.025;
      const pz = z + (rand() - 0.5) * 0.025;
      if (!clear(px, pz)) continue;
      seedling(parts, leaf, px, SOIL_Y, pz, 0.035 + rand() * 0.05, rand() * Math.PI, 0.5 + rand() * 0.25, rand, rand() < 0.25 ? 2 : 1);
    }
  });
  for (const pot of POTS) potGeometry(parts, leaf, pot, rand);

  // two bushes of tulsi at the front corners
  for (const [tx, tz] of TULSI_AT) {
    for (let k = 0; k < 6; k++) {
      const puff = crumple(new THREE.IcosahedronGeometry(1, 0), 0.2, k + tz * 10);
      const s = 0.036 + rand() * 0.016;
      const p = v(tx + (rand() - 0.5) * 0.08, SOIL_Y + 0.05 + rand() * 0.08, tz + (rand() - 0.5) * 0.08);
      parts.push(coat(place(puff, p, new THREE.Euler(rand() * 3, rand() * 3, 0), v(s, s * 0.85, s)), TULSI[k % 3], PAINTED));
    }
  }
  // a marigold in flower at the back
  const [mx, mz] = MARIGOLD_AT;
  parts.push(coat(spoke(v(mx, SOIL_Y, mz), v(mx - 0.01, SOIL_Y + 0.17, mz + 0.01), 0.005, 0.004, 3), "#4f7f36", PAINTED));
  for (const [dx, dy, dz, s] of [
    [-0.01, 0.19, 0.01, 0.036],
    [0.03, 0.14, -0.03, 0.028],
  ]) {
    parts.push(coat(place(new THREE.DodecahedronGeometry(1, 0), v(mx + dx, SOIL_Y + dy, mz + dz), new THREE.Euler(0.4, 0.3, 0), v(s, s * 0.7, s)), "#f29a1e", PAINTED));
  }
  for (let k = 0; k < 4; k++) {
    parts.push(coat(place(leaf.clone(), v(mx, SOIL_Y + 0.05 + k * 0.03, mz), new THREE.Euler(0, k * 1.7, 0.3, "YXZ"), 0.7), LEAF[k % 3], PAINTED));
  }
  // the jasmine vine, its leaves and its small white flowers; it rises from the soil inside the rim to meet the hoop
  const vine = new Vine();
  parts.push(coat(tubeAlong(vine, 0.0045, 80, 3), "#4a6e33", PAINTED));
  const reach = vine.getPoint(0);
  const into = vine.getTangent(0);
  parts.push(
    coat(
      tube([v(0.03, SOIL_Y - 0.01, 0.285), v(0.026, SOIL_Y + 0.05, 0.31), v(0.012, 0.15, 0.332), reach.clone().addScaledVector(into, -0.012), reach], 0.0045, 14, 3),
      "#4a6e33",
      PAINTED,
    ),
  );
  for (let k = 0; k < 30; k++) {
    const t = (k + 0.5) / 30;
    const p = vine.getPoint(t);
    const c = vine.hoop.getPoint(VINE.from + t * (VINE.to - VINE.from));
    const out = p.clone().sub(c).normalize();
    const yaw = Math.atan2(-out.z, out.x);
    parts.push(coat(place(leaf.clone(), p, new THREE.Euler(0, yaw, Math.asin(Math.max(-1, Math.min(1, out.y))) - 0.3, "YXZ"), 0.5), LEAF[k % 3], PAINTED));
    if (k % 3 === 1) {
      const flower = new THREE.CircleGeometry(0.013, 5);
      flower.lookAt(out);
      flower.translate(p.x + out.x * 0.012, p.y + out.y * 0.012, p.z + out.z * 0.012);
      parts.push(coat(flower, JASMINE, PAINTED));
    }
  }
  leaf.dispose();
  // the push handle's wooden grip
  parts.push(coat(spoke(v(-0.8, 0.42, -0.275), v(-0.8, 0.42, 0.275), 0.021, 0.021, 8), WOOD, PAINTED));
}

/** Everything copper on the trolley itself: the rim, the hoop, the frame and axles, the handles, the watering can. */
function copperGeometry(parts: THREE.BufferGeometry[]) {
  const copper: THREE.BufferGeometry[] = [];
  const top = TUB[TUB.length - 1];
  copper.push(tubeAlong(new Loop(top[0] * SHAPE.a, top[0] * SHAPE.b, SHAPE.n, top[1] + 0.002), 0.014, 56, 5, true));
  copper.push(tubeAlong(new Hoop(), 0.016, 48, 6));
  for (const side of [-1, 1]) {
    // each foot sits in a socket, backed by a domed plate bolted flat to the wall and leaning out with it
    const socket = new THREE.CylinderGeometry(0.021, 0.023, 0.05, 8, 1);
    socket.translate(0, FOOT_Y, side * HOOP.z);
    copper.push(socket);
    const bracket = axleLathe(
      [
        [0, 0],
        [0.027, 0],
        [0.029, 0.004],
        [0.019, 0.009],
        [0, 0.011],
      ],
      10,
    );
    bracket.rotateX(WALL.lean);
    if (side < 0) bracket.rotateY(Math.PI);
    bracket.translate(0, FOOT_Y, side * WALL.at(FOOT_Y));
    copper.push(bracket);
    // and a clamp holds the hoop to the rim where it passes it
    const clamp = new THREE.CylinderGeometry(0.021, 0.021, 0.044, 8, 1);
    clamp.rotateZ(Math.PI / 2);
    clamp.translate(0, top[1] + 0.002, side * (top[0] + 0.002));
    copper.push(clamp);
  }
  // the crook at the hoop's top, and the ring on its curl that the jar's chain hangs from
  copper.push(tube(CROOK.map(([x, y]) => v(x, y, 0)), 0.008, 20, 5));
  const ring = new THREE.TorusGeometry(RING.r, 0.004, 4, 10);
  ring.rotateY(Math.PI / 2);
  ring.translate(RING.x, RING.y, 0);
  copper.push(ring);
  // a carrying loop at the front end
  copper.push(tube([v(0.552, 0.03, -0.09), v(0.6, 0.035, -0.08), v(0.625, 0.04, 0), v(0.6, 0.035, 0.08), v(0.552, 0.03, 0.09)], 0.008, 12, 4));
  // frame and axles
  for (const z of [-0.24, 0.24]) copper.push(spoke(v(-0.47, -0.34, z), v(0.47, -0.34, z), 0.011, 0.011, 6));
  for (const x of [-WHEEL.offset.x, WHEEL.offset.x]) {
    copper.push(spoke(v(x, WHEEL_Y, -0.37), v(x, WHEEL_Y, 0.37), 0.014, 0.014, 6));
    for (const z of [-1, 1]) {
      copper.push(spoke(v(x - 0.07, -0.34, z * 0.24), v(x, WHEEL_Y, z * 0.3), 0.01, 0.01, 5));
      copper.push(spoke(v(x + 0.07, -0.34, z * 0.24), v(x, WHEEL_Y, z * 0.3), 0.01, 0.01, 5));
    }
  }
  // the push handle, rising from the back of the tub
  for (const z of [-1, 1]) {
    copper.push(tube([v(-0.54, 0.02, z * 0.22), v(-0.66, 0.16, z * 0.235), v(-0.76, 0.33, z * 0.25), v(-0.8, 0.42, z * 0.25)], 0.012, 16, 5));
  }
  // the watering can, hung by its handle from the grip
  const can: THREE.BufferGeometry[] = [];
  can.push(
    lathe(
      [
        [0, -0.1],
        [0.055, -0.1],
        [0.06, -0.09],
        [0.06, 0],
        [0.045, 0.03],
        [0.02, 0.04],
        [0, 0.04],
      ],
      10,
    ),
  );
  can.push(spoke(v(0.05, -0.07, 0), v(0.14, 0.03, 0), 0.009, 0.006, 5));
  const rose = new THREE.ConeGeometry(0.018, 0.025, 8, 1, true);
  rose.rotateZ(-Math.PI / 4);
  rose.translate(0.148, 0.04, 0);
  can.push(rose);
  can.push(tube([v(0.0, 0.04, 0), v(-0.03, 0.09, 0), v(-0.07, 0.05, 0), v(-0.062, -0.01, 0)], 0.006, 10, 4));
  for (const g of can) {
    g.rotateY(Math.PI / 2);
    g.translate(-0.8, 0.3, -0.08);
    copper.push(g);
  }
  for (const g of copper) parts.push(coat(g, COPPER, METAL));
}

/** The whole trolley but its wheels and its jar, as one mesh. */
function bodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [tubGeometry()];
  plantsGeometry(parts);
  copperGeometry(parts);
  return merge(parts);
}

/** The jar's copper: its chain, bail and lid, the base ring and the four straps of the cage. */
function jarCopperGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const link = new THREE.TorusGeometry(0.012, 0.003, 3, 8);
  link.translate(0, -0.012, 0);
  parts.push(link);
  const link2 = new THREE.TorusGeometry(0.012, 0.003, 3, 8);
  link2.rotateY(Math.PI / 2);
  link2.translate(0, -0.032, 0);
  parts.push(link2);
  // the bail, from the lid's sides up to the chain
  parts.push(tube([v(-0.072, -0.11, 0), v(-0.05, -0.068, 0), v(0, -0.044, 0), v(0.05, -0.068, 0), v(0.072, -0.11, 0)], 0.0028, 12, 3));
  parts.push(
    lathe(
      [
        [0, -0.122],
        [0.068, -0.122],
        [0.07, -0.112],
        [0.065, -0.097],
        [0.04, -0.089],
        [0.012, -0.084],
        [0.012, -0.076],
        [0, -0.073],
      ],
      12,
    ),
  );
  parts.push(
    lathe(
      [
        [0.07, -0.41],
        [0.104, -0.404],
        [0.108, -0.372],
        [0.1, -0.366],
      ],
      14,
    ),
  );
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = (
      [
        [0.068, -0.12],
        [0.086, -0.146],
        [0.103, -0.19],
        [0.107, -0.25],
        [0.105, -0.36],
        [0.1, -0.395],
      ] as Array<[number, number]>
    ).map(([r, y]) => v(c * r, y, s * r));
    parts.push(tube(pts, 0.003, 10, 3));
  }
  return merge(parts.map((g) => coat(g, COPPER, METAL)));
}

const GLASS: Array<[number, number]> = [
  [0, -0.4],
  [0.075, -0.4],
  [0.092, -0.39],
  [0.1, -0.36],
  [0.102, -0.25],
  [0.098, -0.19],
  [0.08, -0.15],
  [0.064, -0.135],
  [0.062, -0.118],
];

/** A narrow sliver just outside the glass where the sky catches it: the Meadow has no reflections to do this. */
function glintGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    GLASS.slice(2, -1).map(([r, y]) => new THREE.Vector2(r * 1.012, y)),
    2,
    -0.9,
    0.32,
  );
}

/** The share of the tyre's turn painted coral at each end of the bold spokes. */
const TYRE_BAND = (52 / 360) * Math.PI * 2;

/**
 * One wheel, its outer face toward +z: a cream tyre on a copper rim, wire spokes, a copper hub, and on the hub a
 * painted cap, a teal disc with five coral petals round a butter-yellow eye. The cap is centred and five-fold, so on
 * its own it shows no turning from a phone's follow camera, where a whole wheel is about fifteen pixels across; so two
 * opposite spokes are painted cream and drawn three times as thick, and the tyre is banded coral where they meet it:
 * one bold bar across the wheel that sweeps round as it rolls. Its two-fold turn also keeps the fine spokes from
 * seeming to run backwards at gliding speed.
 */
function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tyre = (arc: number, from: number, color: string, segments: number) => {
    const g = new THREE.TorusGeometry(WHEEL.radius - 0.017, 0.017, 6, segments, arc);
    g.rotateZ(from);
    parts.push(coat(g, color, RUBBER));
  };
  // each bold spoke meets the tyre 0.2 rad round from where it leaves the hub; the coral bands are centred there
  for (const end of [0.2, 0.2 + Math.PI]) {
    tyre(TYRE_BAND, end - TYRE_BAND / 2, BAND_CORAL, 5);
    tyre(Math.PI - TYRE_BAND, end + TYRE_BAND / 2, TYRE, 11);
  }
  parts.push(coat(new THREE.TorusGeometry(0.163, 0.008, 4, 24), COPPER, METAL));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const z = i % 2 === 0 ? 0.022 : -0.022;
    const bold = i % 6 === 0;
    parts.push(
      coat(
        spoke(v(Math.cos(a) * 0.02, Math.sin(a) * 0.02, bold ? 0.012 : z), v(Math.cos(a + 0.2) * 0.158, Math.sin(a + 0.2) * 0.158, 0), bold ? 0.013 : 0.0045, bold ? 0.012 : 0.0045, bold ? 6 : 3),
        bold ? TYRE : COPPER,
        bold ? WHEEL_PAINT : METAL,
      ),
    );
  }
  parts.push(
    coat(
      axleLathe(
        [
          [0, -0.045],
          [0.022, -0.045],
          [0.026, -0.02],
          [0.026, 0.02],
          [0.02, 0.04],
          [0.01, 0.05],
          [0, 0.052],
        ],
        8,
      ),
      COPPER,
      METAL,
    ),
  );
  const cap = new THREE.CircleGeometry(0.064, 16);
  cap.translate(0, 0, 0.036);
  parts.push(coat(cap, TEAL, WHEEL_PAINT));
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2;
    const petal = new THREE.CircleGeometry(1, 8);
    petal.scale(0.022, 0.0135, 1);
    petal.translate(0.037, 0, 0);
    petal.rotateZ(a);
    petal.translate(0, 0, 0.0375);
    parts.push(coat(petal, CORAL, WHEEL_PAINT));
  }
  const eye = new THREE.CircleGeometry(0.017, 10);
  eye.translate(0, 0, 0.038);
  parts.push(coat(eye, BUTTER, WHEEL_PAINT));
  return merge(parts);
}

/** A warm pool of light on the ground, soft to its edge, for the lite tier's guardian light after dark. */
function poolTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,226,150,0.85)");
    g.addColorStop(0.3, "rgba(255,206,120,0.42)");
    g.addColorStop(0.65, "rgba(255,190,100,0.12)");
    g.addColorStop(1, "rgba(255,180,90,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

interface JarLight {
  position: { value: THREE.Vector3 };
  glow: { value: number };
  color: { value: THREE.Color };
  /** The painted tin's brightening after dark. */
  lift: { value: number };
}

/**
 * The trolley's one material: vertex-coloured, its roughness and metalness read per vertex (the `rm` attribute), the
 * tin's painted texture sampled through the plain strip everywhere else. It also paints some of the jar's light on, as
 * a warm glow that falls off with distance from the jar:
 * - on the lite tier, where there is no point light, onto everything, wrapping a little round each surface, and onto
 *   the tin, copper and wheels on the side away from the jar as well;
 * - on the others, where the point light already lights what faces the jar, only onto what faces away from it, and
 *   only where the surface takes a lift (the tin, and partly the copper and wheels): the tub's outer wall, which the
 *   jar inside the rim can never reach, so after dark it stays a lit duck-egg instead of a dark hole under the light.
 * And after dark it lifts the painted tin a touch on every tier, so the flower band still reads in the blue of dusk.
 */
function trolleyMaterial(map: THREE.Texture, jar: JarLight, lite: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uJar = jar.position;
    shader.uniforms.uJarGlow = jar.glow;
    shader.uniforms.uJarColor = jar.color;
    shader.uniforms.uLift = jar.lift;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 rm;\nvarying vec3 vRm;\nvarying vec3 vJarP;\nvarying vec3 vJarN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRm = rm;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 jarP = vec4( transformed, 1.0 );
        vec3 jarN = objectNormal;
        #ifdef USE_INSTANCING
          jarP = instanceMatrix * jarP;
          jarN = mat3( instanceMatrix ) * jarN;
        #endif
        vJarP = ( modelMatrix * jarP ).xyz;
        vJarN = normalize( mat3( modelMatrix ) * jarN );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vRm;\nuniform vec3 uJar;\nuniform float uJarGlow;\nuniform vec3 uJarColor;\nuniform float uLift;\nvarying vec3 vJarP;\nvarying vec3 vJarN;",
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vRm.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vRm.y;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec3 jarL = uJar - vJarP;
        float jarD = length( jarL );
        vec3 jarN = normalize( vJarN ) * ( gl_FrontFacing ? 1.0 : -1.0 );
        float jarFacing = dot( jarN, jarL / max( jarD, 1e-3 ) );
        float jarAway = clamp( 0.5 - 0.5 * jarFacing, 0.0, 1.0 ) * vRm.z;
        ${lite ? "float jarWrap = max( clamp( jarFacing * 0.6 + 0.4, 0.0, 1.0 ), jarAway );" : "float jarWrap = jarAway;"}
        float jarFall = smoothstep( 2.4, 0.0, jarD ) / ( 1.0 + 3.0 * jarD * jarD );
        totalEmissiveRadiance += diffuseColor.rgb * ( uJarColor * ( uJarGlow * jarFall * jarWrap ) + uLift * vRm.z );`,
      );
  };
  mat.customProgramCacheKey = () => `firefly-trolley-${lite ? "lite" : "full"}`;
  return mat;
}

/**
 * Soft additive points, each carrying its own size (the `flySize` attribute), so the jar's fireflies and the loose
 * ones share one draw. The size is in true metres: three's own attenuation leaves out the lens, which at the Meadow's
 * narrow 30 degree lens draws every point nearly four times too small. Each point also keeps a smallest size on
 * screen, as a share of the canvas's half-height, so a firefly still reads as a point of light from the follow camera.
 */
function fireflyMaterial(): THREE.PointsMaterial {
  const mat = new THREE.PointsMaterial({
    map: glowTexture(),
    size: 1,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 flySize;")
      .replace("gl_PointSize = size;", "gl_PointSize = max( size * flySize.x * projectionMatrix[ 1 ][ 1 ] * scale / - mvPosition.z, flySize.y * scale );");
  };
  mat.customProgramCacheKey = () => "firefly-trolley-points";
  return mat;
}

/** Where each firefly wanders, how fast, and how it blinks. */
function fireflyPaths(count: number, seed: number) {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    f: [0.4 + rand() * 0.6, 0.3 + rand() * 0.5, 0.4 + rand() * 0.6],
    p: [rand() * 6.3, rand() * 6.3, rand() * 6.3],
    blink: 0.6 + rand() * 1.4,
    phase: rand() * 6.3,
    color: new THREE.Color(FIREFLY[Math.floor(rand() * FIREFLY.length)]),
  }));
}

/**
 * The trolley's geometry, textures and materials, built once per tier and kept for the page: the glider's trolley
 * mounts while the cart's is still drawn (MeadowCanvas swaps them in plain sight), and building these again then was
 * one long frame (about a tenth of a second on an office laptop). Never disposed; they are small (one 512 px texture,
 * about 9.2k triangles). Only one trolley is live at a time, so they share the jar's uniforms too: each writes them
 * every frame, the one mounted last (the live one) last.
 */
interface TrolleyParts {
  tin: THREE.CanvasTexture;
  jar: JarLight;
  body: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  jarCopper: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  glint: THREE.BufferGeometry;
  poolGeo: THREE.BufferGeometry;
  poolMat: THREE.MeshBasicMaterial;
  painted: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  glintMat: THREE.MeshBasicMaterial;
  fliesMat: THREE.PointsMaterial;
}

const built: { lite?: TrolleyParts; full?: TrolleyParts } = {};

function trolleyParts(lite: boolean): TrolleyParts {
  const key = lite ? "lite" : "full";
  const cached = built[key];
  if (cached) return cached;
  const tin = tinTexture();
  const jar: JarLight = { position: { value: new THREE.Vector3() }, glow: { value: 0 }, color: { value: new THREE.Color(JAR_LIGHT) }, lift: { value: 0 } };
  const made: TrolleyParts = {
    tin,
    jar,
    body: bodyGeometry(),
    wheel: wheelGeometry(),
    jarCopper: jarCopperGeometry(),
    glass: lathe(GLASS, 14),
    glint: glintGeometry(),
    poolGeo: new THREE.PlaneGeometry(1, 1),
    poolMat: new THREE.MeshBasicMaterial({
      map: lite ? poolTexture() : null,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    }),
    painted: trolleyMaterial(tin, jar, lite),
    glassMat: new THREE.MeshStandardMaterial({ color: "#eef7ef", emissive: "#d6ec8a", transparent: true, opacity: 0.3, roughness: 0.06, depthWrite: false }),
    glintMat: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    fliesMat: fireflyMaterial(),
  };
  built[key] = made;
  return made;
}

/**
 * The scene's light for the guardian jar, mounted once for the whole visit (MeadowEnvironment, and the concept stage)
 * so the light count never changes: it stands wherever the live trolley last published its jar, and is dark while
 * there is none. Never mounted on the lite tier.
 */
export function GuardianLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    const g = meadow.guardian;
    l.position.copy(g.position);
    l.intensity = g.live ? g.light : 0;
  }, -0.4);
  return <pointLight ref={ref} color={JAR_LIGHT} intensity={0} distance={JAR_POINT.distance} decay={JAR_POINT.decay} />;
}

const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
const tmpM = new THREE.Matrix4();
const tmpInv = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

export interface TrolleyProps extends ConceptProps {
  /** The lightest tier: fewer fireflies, the jar's light painted on rather than a real light. Read from the device if left out. */
  lite?: boolean;
  /** The ground's height in the world, for the lite tier's pool of light (the Meadow's paths sit just under 0.03). */
  groundY?: number;
}

/** The Lantern Cart in chassis space; `wheels` receives the four wheel mounts for the parent to pose. */
export function FireflyTrolley({ wheels, lite: liteProp, groundY = 0.03 }: TrolleyProps) {
  const [lite] = useState(() => liteProp ?? meadowLite());
  const [calm] = useState(prefersCalm);
  const root = useRef<THREE.Group>(null);
  const wheelMesh = useRef<THREE.InstancedMesh>(null);
  const pool = useRef<THREE.Mesh>(null);
  const pivot = useSwing(0.36, calm ? 0.012 : 0.03, JAR_PRIORITY - 0.01);
  const shared = trolleyParts(lite);
  // the fireflies' buffer is rewritten by this trolley every frame, so it is its own; the rest is shared (trolleyParts)
  const own = useAssets(() => {
    const counts = FLIES[lite ? "lite" : "full"];
    const inJar = calm ? Math.round(counts.jar * 0.7) : counts.jar;
    const loose = calm ? Math.ceil(counts.loose / 2) : counts.loose;
    const n = inJar + loose;
    const fliesGeo = new THREE.BufferGeometry();
    fliesGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    fliesGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const sizes = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) sizes.set(i < inJar ? FLY_SIZE.jar : FLY_SIZE.loose, i * 2);
    fliesGeo.setAttribute("flySize", new THREE.BufferAttribute(sizes, 2));
    return {
      inJar,
      loose,
      fliesGeo,
      jarPaths: fireflyPaths(inJar, 51),
      loosePaths: fireflyPaths(loose, 97),
      // where the loose fireflies are circling, trailing the cart a little (world space), once it is known
      trail: { centre: new THREE.Vector3(), primed: false },
    };
  });
  const res = { ...shared, ...own };

  useEffect(
    () => () => {
      meadow.guardian.live = false;
    },
    [],
  );

  // the jar, as it hangs and swings this frame: its heart in the world, for its light (see JAR_PRIORITY)
  useFrame((state) => {
    const p = pivot.current;
    if (!p) return;
    const t = state.clock.elapsedTime;
    p.updateWorldMatrix(true, false);
    const heart = tmpW.copy(JAR_HEART).applyMatrix4(p.matrixWorld);
    const guardian = meadow.guardian;
    guardian.position.copy(heart);
    guardian.light = glowAt(JAR_POINT.day, JAR_POINT.night, t, 0.1);
    guardian.live = true;
    res.jar.position.value.copy(heart);
    const paint = JAR_PAINT[lite ? "lite" : "full"];
    res.jar.glow.value = glowAt(paint[0], paint[1], t, 0.1);
    res.jar.lift.value = TIN_LIFT[0] + (TIN_LIFT[1] - TIN_LIFT[0]) * meadow.night;
  }, JAR_PRIORITY);

  useFrame((state, dtRaw) => {
    const g = root.current;
    const p = pivot.current;
    if (!g || !p) return;
    const dt = Math.min(dtRaw, 0.1);
    const t = state.clock.elapsedTime;
    const pace = calm ? 0.45 : 1;
    const tp = t * pace;

    // the wheels: one instance at each mount, wherever the parent has posed it this frame
    const wm = wheelMesh.current;
    if (wm) {
      for (let i = 0; i < 4; i++) {
        const w = wheels.current[i];
        if (!w) continue;
        w.updateMatrix();
        // the left pair turned round so their hubs face outward too (a turn, not a mirror, so the faces stay the right way out)
        wm.setMatrixAt(i, i % 2 === 0 ? w.matrix : tmpM.multiplyMatrices(w.matrix, FLIP));
      }
      wm.instanceMatrix.needsUpdate = true;
    }

    // the cart's frame, and the jar's as it hangs this frame (published above)
    p.updateWorldMatrix(true, false);
    tmpInv.copy(g.matrixWorld).invert();
    const heart = res.jar.position.value;

    res.glassMat.emissiveIntensity = glowAt(0.08, 0.45, t, 0.1);
    res.glintMat.opacity = 0.32 * (1 - 0.6 * meadow.night);

    // fireflies in the jar, carried into the cart's frame by the jar's swing
    const pos = res.fliesGeo.attributes.position as THREE.BufferAttribute;
    const col = res.fliesGeo.attributes.color as THREE.BufferAttribute;
    tmpM.multiplyMatrices(tmpInv, p.matrixWorld);
    const inside = glowAt(0.7, 1, t, 0);
    res.jarPaths.forEach((f, i) => {
      tmpV.set(Math.sin(tp * f.f[0] + f.p[0]) * 0.06, -0.265 + Math.sin(tp * f.f[1] + f.p[1]) * 0.095, Math.sin(tp * f.f[2] + f.p[2]) * 0.06).applyMatrix4(tmpM);
      pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
      const b = inside * Math.max(0.12, Math.sin(tp * f.blink + f.phase)) ** 1.5;
      col.setXYZ(i, f.color.r * b, f.color.g * b, f.color.b * b);
    });

    // and the few that slip out at dusk, circling a point that trails the cart a little, upright whatever the cart does
    const out = THREE.MathUtils.smoothstep(meadow.night, 0.3, 0.95);
    const trail = res.trail;
    g.matrixWorld.decompose(tmpS, tmpQ, tmpV);
    const centre = tmpS;
    if (!trail.primed) {
      trail.centre.copy(centre);
      trail.primed = true;
    }
    trail.centre.lerp(centre, 1 - Math.exp(-dt / TRAIL.seconds));
    const lag = trail.centre.distanceTo(centre);
    if (lag > TRAIL.reach) trail.centre.lerp(centre, 1 - TRAIL.reach / lag);
    // the cart's heading on the ground, so the circle stays long and narrow like the cart
    const fx = 1 - 2 * (tmpQ.y * tmpQ.y + tmpQ.z * tmpQ.z);
    const fz = 2 * (tmpQ.x * tmpQ.z - tmpQ.w * tmpQ.y);
    const fl = Math.hypot(fx, fz) || 1;
    const cx = fx / fl;
    const cz = fz / fl;
    const n = res.inJar;
    res.loosePaths.forEach((f, i) => {
      const a = tp * f.f[0] * 0.28 + f.p[0];
      const r = 0.58 + 0.22 * Math.sin(tp * f.f[2] * 0.7 + f.p[2]);
      const along = Math.cos(a) * r * 1.3;
      const across = Math.sin(a) * r;
      tmpV
        .set(trail.centre.x + cx * along - cz * across, trail.centre.y + 0.75 + 0.3 * Math.sin(tp * f.f[1] * 0.8 + f.p[1]), trail.centre.z + cz * along + cx * across)
        .applyMatrix4(tmpInv);
      pos.setXYZ(n + i, tmpV.x, tmpV.y, tmpV.z);
      // they pulse rather than go dark, so the ring round the cart never thins to nothing
      const b = out * (0.28 + 0.72 * Math.max(0, Math.sin(tp * f.blink + f.phase)) ** 2);
      col.setXYZ(n + i, f.color.r * b, f.color.g * b, f.color.b * b);
    });
    // nobody out yet: draw only the jar's
    res.fliesGeo.setDrawRange(0, out > 0.002 ? n + res.loose : n);
    pos.needsUpdate = true;
    col.needsUpdate = true;

    // the lite tier's pool of light, flat on the ground under the jar
    const pm = pool.current;
    if (pm) {
      const o = Math.max(0, meadow.night - 0.15) * 0.8 * (0.94 + 0.06 * Math.sin(t * 2.3));
      res.poolMat.opacity = o;
      pm.visible = o > 0.01;
      if (pm.visible) {
        const s = 3.2;
        tmpM.compose(tmpV.set(heart.x, groundY + 0.005, heart.z), FLAT, tmpS.set(s, s, s));
        pm.matrix.multiplyMatrices(tmpInv, tmpM);
      }
    }
  });

  return (
    <group ref={root}>
      <mesh geometry={res.body} material={res.painted} castShadow receiveShadow />
      {[0, 1, 2, 3].map((i) => (
        <group
          key={i}
          ref={(el) => {
            wheels.current[i] = el;
          }}
          position={[i < 2 ? WHEEL.offset.x : -WHEEL.offset.x, WHEEL_Y, i % 2 === 0 ? WHEEL.offset.z : -WHEEL.offset.z]}
        />
      ))}
      {/* the wheels move with their mounts, so the bounds are never left behind */}
      <instancedMesh ref={wheelMesh} args={[res.wheel, res.painted, 4]} castShadow receiveShadow frustumCulled={false} />
      <group position={HOOK} scale={JAR_SCALE}>
        <group ref={pivot}>
          <mesh geometry={res.jarCopper} material={res.painted} castShadow />
          <mesh geometry={res.glass} material={res.glassMat} renderOrder={2} />
          <mesh geometry={res.glint} material={res.glintMat} renderOrder={3} />
          <Halo size={0.8} color="#f4e78e" day={0.22} position={[JAR_HEART.x, JAR_HEART.y, JAR_HEART.z]} />
        </group>
      </group>
      {/* the fireflies are placed in the cart's frame every frame, wherever they wander */}
      <points geometry={res.fliesGeo} material={res.fliesMat} renderOrder={1} frustumCulled={false} />
      {lite && <mesh ref={pool} geometry={res.poolGeo} material={res.poolMat} matrixAutoUpdate={false} renderOrder={4} visible={false} />}
    </group>
  );
}
