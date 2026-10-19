"use client";
// The woods beyond the garden: two rows of distant tree crowns standing all
// the way round it, so a wide screen (16:9, an ultrawide, the party screen)
// or a view turned round the flower, to the side or right round to look back
// over the garden's front, never runs out past the hedges onto open lawn. The
// view straight past the hero stays open, the band of pale sky and hazy hills
// under the canopies being part of the garden's depth, but the lawn gets an
// end: a low hedgerow across the gap, its foot in meadow grass, so the turf
// meets bushes and then hazy hills instead of running flat to a ruled
// horizon. Each row tapers into the lawn at its two ends, behind the big
// trees either side of that view, so nothing reads as a set piece. They are painted rather than modelled: at
// ten to thirteen metres the depth of field melts them into soft woodland,
// and on the lite tier a painted silhouette is all the eye can resolve at
// that distance. All of it carries aerial haze (haze.ts), thickest at the
// foot, so it sits back in the air rather than on top of the lawn.
//
// They cast no shadow and receive none. The evening sun comes in low from
// behind the garden's left, and anything solid on that bearing would lay its
// shadow across the bed at golden hour (see the sun corridor in LAYOUT.hedges);
// painted woods can stand there freely.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { withHaze, type HazeOptions } from "@/components/garden/haze";
import { Rng } from "@/lib/plant/prng";
import { makeCanvas, shiftHex, toTexture } from "@/lib/plant/textures";

interface Ring {
  radius: number;
  height: number;
  /** how many times the painted strip repeats round the ring */
  repeats: number;
  seed: number;
  /** turns the strip so the two rings' crowns do not line up */
  offset: number;
  tint: string;
}

/** The far row a little taller and hazier, the near row a touch darker and lower. */
const RINGS: readonly Ring[] = [
  { radius: 13.2, height: 3.0, repeats: 2.5, seed: 41, offset: 0.37, tint: "#d4dfdc" },
  { radius: 11.6, height: 2.3, repeats: 3, seed: 17, offset: 0, tint: "#bccbbf" },
];

/**
 * The arcs, as bearings round the garden measured from straight behind the
 * hero (radians, positive toward +x): from just behind the big trees that
 * flank the default view out to beside the camera. The open centre, a little
 * to the left because the camera stands a little to the right, is what the
 * garden camera looks through.
 */
const OPEN_LEFT = THREE.MathUtils.degToRad(26);
const OPEN_RIGHT = THREE.MathUtils.degToRad(17);
/** How far each of the two arcs the woods once were ran: their painted crowns keep that spacing now they are one. */
const ARC_END = THREE.MathUtils.degToRad(150);
/** The one arc round the garden, from the open view's left edge round behind the camera to its right edge. */
const WOODS_LENGTH = 2 * Math.PI - OPEN_LEFT - OPEN_RIGHT;
/** The strip's repeats along the one arc for the crowns' spacing one of the two arcs had (about ARC_END minus its open side). */
const WOODS_SPAN_SCALE = WOODS_LENGTH / (ARC_END - (OPEN_LEFT + OPEN_RIGHT) / 2);
/** Bearing over which each arc's crowns sink into the lawn at its ends. */
const TAPER = THREE.MathUtils.degToRad(14);

const STRIP_W = 1024;
const STRIP_H = 160;
/** Muted, blue-leaning greens: a dozen metres of air already lie between the woods and the eye. */
const CROWN_DARK = "#3a5747";
const CROWN_MID = "#4f6f58";
const CROWN_LIT = "#7c9878";

/** The woods' haze: a light veil, more at night, and their feet melting into the air. */
const WOODS_HAZE: HazeOptions = { day: 0.1, night: 0.4, foot: 0.28, from: -0.2, to: 1.0 };

/**
 * The hedgerow that ends the lawn: across the open view behind the arch, a
 * little in front of the woods, overlapping their tapered ends so the three
 * read as one boundary. Low enough that the hills still show over it.
 */
const HEDGEROW = {
  radius: 10.2,
  height: 1.25,
  /**
   * Past the open centre on the right, into the woods' taper; far round on
   * the left, where the woods sink low behind the fence and the misty foot
   * of the hills would otherwise meet the lawn on a line.
   */
  overlap: THREE.MathUtils.degToRad(10),
  overlapLeft: THREE.MathUtils.degToRad(48),
  taper: THREE.MathUtils.degToRad(9),
  repeats: 1,
  seed: 23,
  tint: "#d6dfd2",
} as const;
const HEDGEROW_HAZE: HazeOptions = { day: 0.05, night: 0.36, foot: 0, from: 0, to: 1 };
const ROW_W = 1024;
const ROW_H = 160;
/** The garden's own hedge greens, a little greyed by ten metres of air. */
const ROW_DARK = "#3d5f40";
const ROW_MID = "#567e4f";
const ROW_LIT = "#88aa6c";
/** The meadow grass at its foot, warmer than the turf, where nobody mows. */
const ROW_GRASS = "#6d8a50";
const ROW_GRASS_LIT = "#9db06a";

/**
 * A strip of overlapping round crowns, seamless left to right: their tops a
 * bumpy, uneven skyline, their lower parts one dark mass. Each crown is a few
 * smaller puffs, shaded lighter on top where the sky lights it.
 */
function paintStrip(seed: number): THREE.CanvasTexture {
  const c = makeCanvas(STRIP_W, STRIP_H);
  const ctx = c.getContext("2d");
  if (!ctx) return toTexture(c);
  const rng = new Rng(seed);
  // the understory: solid up to about the crowns' waists
  const base = ctx.createLinearGradient(0, STRIP_H * 0.5, 0, STRIP_H);
  base.addColorStop(0, CROWN_DARK);
  base.addColorStop(1, "#2c4337");
  ctx.fillStyle = base;
  ctx.fillRect(0, STRIP_H * 0.62, STRIP_W, STRIP_H * 0.38);
  let x = 0;
  while (x < STRIP_W + 60) {
    const r = rng.range(14, 38);
    const top = STRIP_H * rng.range(0.04, 0.5);
    const cy = top + r;
    const puffs = 4 + Math.floor(rng.next() * 4);
    for (let i = 0; i < puffs; i++) {
      const pr = r * rng.range(0.45, 0.8);
      const px = x + rng.range(-r * 0.7, r * 0.7);
      const py = cy + rng.range(-r * 0.35, r * 0.6);
      const g = ctx.createRadialGradient(px - pr * 0.25, py - pr * 0.45, pr * 0.1, px, py, pr);
      const lift = rng.range(-0.12, 0.12);
      g.addColorStop(0, shiftHex(CROWN_LIT, 0, lift));
      g.addColorStop(0.45, shiftHex(CROWN_MID, 0, lift));
      g.addColorStop(1, shiftHex(CROWN_DARK, 0, lift));
      ctx.fillStyle = g;
      // drawn twice where it crosses an edge, so the strip tiles
      for (const ox of [0, -STRIP_W, STRIP_W]) {
        ctx.beginPath();
        ctx.arc(px + ox, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the crown's body down into the understory
    ctx.fillStyle = shiftHex(CROWN_DARK, 0, rng.range(-0.1, 0.1));
    for (const ox of [0, -STRIP_W, STRIP_W]) ctx.fillRect(x - r * 0.6 + ox, cy, r * 1.2, STRIP_H - cy);
    x += r * rng.range(0.9, 1.4);
  }
  const tex = toTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * The hedgerow's strip: a long, clipped-looking run of bushes whose top
 * undulates gently (a hedge, not a skyline of shrubs), one dark mass below,
 * and a fringe of long meadow grass along the foot, seamless left to right.
 */
function paintHedgerow(seed: number): THREE.CanvasTexture {
  const c = makeCanvas(ROW_W, ROW_H);
  const ctx = c.getContext("2d");
  if (!ctx) return toTexture(c);
  const rng = new Rng(seed);
  const base = ctx.createLinearGradient(0, ROW_H * 0.55, 0, ROW_H);
  base.addColorStop(0, ROW_DARK);
  base.addColorStop(1, "#33493a");
  ctx.fillStyle = base;
  ctx.fillRect(0, ROW_H * 0.66, ROW_W, ROW_H * 0.34);
  let x = 0;
  while (x < ROW_W + 50) {
    // wide, low lobes: the top line rises and falls by a few centimetres, not metres
    const r = rng.range(22, 40);
    const top = ROW_H * (0.2 + 0.12 * Math.sin(x * 0.011 + seed) + rng.range(-0.05, 0.05));
    const cy = top + r * 0.75;
    const puffs = 4 + Math.floor(rng.next() * 4);
    for (let i = 0; i < puffs; i++) {
      const pr = r * rng.range(0.45, 0.75);
      const px = x + rng.range(-r * 0.9, r * 0.9);
      const py = cy + rng.range(-r * 0.15, r * 0.5);
      // lit softly from above, without a bright spot: at this distance a bush is a mass, not a ball
      const g = ctx.createLinearGradient(0, py - pr, 0, py + pr);
      const lift = rng.range(-0.08, 0.08);
      g.addColorStop(0, shiftHex(ROW_MID, 0, 0.12 + lift));
      g.addColorStop(0.55, shiftHex(ROW_MID, 0, lift));
      g.addColorStop(1, shiftHex(ROW_DARK, 0, lift));
      ctx.fillStyle = g;
      for (const ox of [0, -ROW_W, ROW_W]) {
        ctx.beginPath();
        ctx.arc(px + ox, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      // leaf dabs over it and round its upper edge, so the outline is leafy, not a cut circle
      for (let k = 0; k < 26; k++) {
        const a = rng.range(Math.PI * 1.05, Math.PI * 1.95);
        const rr = pr * (rng.next() < 0.55 ? rng.range(0.85, 1.08) : rng.range(0.2, 0.85));
        const dx = px + Math.cos(a) * rr;
        const dy = py + Math.sin(a) * rr * 0.9 + (rr < pr * 0.85 ? rng.range(0, pr) : 0);
        const t = rng.next();
        ctx.fillStyle = t < 0.35 ? shiftHex(ROW_DARK, 0, rng.range(-0.1, 0.05)) : t < 0.8 ? shiftHex(ROW_MID, 0, rng.range(-0.05, 0.15)) : shiftHex(ROW_LIT, 0, rng.range(-0.15, 0));
        for (const ox of [0, -ROW_W, ROW_W]) {
          ctx.beginPath();
          ctx.ellipse(dx + ox, dy, rng.range(2, 4.5), rng.range(1.5, 3), rng.range(0, Math.PI), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = shiftHex(ROW_DARK, 0, rng.range(-0.08, 0.08));
    for (const ox of [0, -ROW_W, ROW_W]) ctx.fillRect(x - r * 0.6 + ox, cy, r * 1.2, ROW_H - cy);
    x += r * rng.range(0.7, 1.1);
  }
  // long grass along the foot: thin blades leaning a little, lighter at their tips
  for (let i = 0; i < 900; i++) {
    const bx = rng.next() * ROW_W;
    const h = ROW_H * rng.range(0.08, 0.26);
    const lean = rng.range(-4, 4);
    const g = ctx.createLinearGradient(0, ROW_H, 0, ROW_H - h);
    g.addColorStop(0, ROW_GRASS);
    g.addColorStop(1, shiftHex(ROW_GRASS_LIT, 0, rng.range(-0.12, 0.08)));
    ctx.strokeStyle = g;
    ctx.lineWidth = rng.range(1.2, 2.4);
    for (const ox of [0, -ROW_W, ROW_W]) {
      ctx.beginPath();
      ctx.moveTo(bx + ox, ROW_H);
      ctx.quadraticCurveTo(bx + ox + lean * 0.3, ROW_H - h * 0.6, bx + ox + lean, ROW_H - h);
      ctx.stroke();
    }
  }
  const tex = toTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * One arc of a ring, seen from inside, its top edge pulled down toward the
 * lawn over `taper` at either end. Three's cylinder runs its angle from +z
 * toward +x.
 */
function taperedArc(radius: number, height: number, start: number, length: number, taper: number, segments: number) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true, start, length);
  g.translate(0, height / 2 - 0.25, 0);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    if (uv.getY(i) < 0.5) continue;
    const along = uv.getX(i) * length;
    const t = Math.min(1, Math.min(along, length - along) / taper);
    const k = t * t * (3 - 2 * t);
    pos.setY(i, -0.25 + height * (0.25 + 0.75 * k));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * Points a ring's normals up at the sky, leaning a little toward the garden,
 * so a painted strip lights like the tops of sunlit bushes rather than a wall
 * in its own shade (the camera sees each strip's side away from the
 * afternoon sun). Stored pointing down and outward because the strips are
 * drawn on their back faces, which flip the normal.
 */
function skyFacing(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z) || 1;
    nor.setXYZ(i, (x / r) * 0.35, -0.94, (z / r) * 0.35);
  }
  nor.needsUpdate = true;
}

/**
 * One row as one geometry. Three's cylinder runs its angle from +z toward +x,
 * so a bearing b from behind the hero (-z) is the angle pi - b. It used to be
 * two arcs that stopped short either side of the camera; with the view free
 * to turn all the way round the flower, the row runs on round the garden's
 * front behind the camera as one arc, from just behind the big trees on the
 * left to just behind them on the right, leaving only the open view past the
 * hero. Its top edge is pulled down toward the ground at those two ends.
 */
function woodsArc(ring: Ring): THREE.BufferGeometry {
  return taperedArc(ring.radius, ring.height, Math.PI + OPEN_LEFT, WOODS_LENGTH, TAPER, 96);
}

export function FarWoods() {
  const rings = useMemo(
    () =>
      RINGS.map((ring) => {
        const map = paintStrip(ring.seed);
        map.repeat.set(ring.repeats * WOODS_SPAN_SCALE, 1);
        map.offset.set(ring.offset, 0);
        // seen from inside: open cylinder arcs drawn on their back faces
        const geometry = woodsArc(ring);
        const material = withHaze(
          new THREE.MeshStandardMaterial({
            map,
            color: ring.tint,
            alphaTest: 0.5,
            side: THREE.BackSide,
            roughness: 1,
            metalness: 0,
          }),
          WOODS_HAZE,
        );
        return { geometry, material, map };
      }),
    [],
  );
  const hedgerow = useMemo(() => {
    const map = paintHedgerow(HEDGEROW.seed);
    // about the same leaf size whatever the arc's length
    map.repeat.set(HEDGEROW.repeats * ((OPEN_LEFT + OPEN_RIGHT + HEDGEROW.overlap + HEDGEROW.overlapLeft) / THREE.MathUtils.degToRad(63)), 1);
    const length = OPEN_LEFT + OPEN_RIGHT + HEDGEROW.overlap + HEDGEROW.overlapLeft;
    const geometry = taperedArc(HEDGEROW.radius, HEDGEROW.height, Math.PI - OPEN_RIGHT - HEDGEROW.overlap, length, HEDGEROW.taper, 40);
    skyFacing(geometry);
    const material = withHaze(
      new THREE.MeshStandardMaterial({ map, color: HEDGEROW.tint, alphaTest: 0.5, side: THREE.BackSide, roughness: 1, metalness: 0 }),
      HEDGEROW_HAZE,
    );
    return { geometry, material, map };
  }, []);
  useEffect(
    () => () => {
      hedgerow.geometry.dispose();
      hedgerow.material.dispose();
      hedgerow.map.dispose();
    },
    [hedgerow],
  );
  useEffect(
    () => () => {
      for (const r of rings) {
        r.geometry.dispose();
        r.material.dispose();
        r.map.dispose();
      }
    },
    [rings],
  );
  return (
    <group name="far-woods">
      {rings.map((r, i) => (
        <mesh key={i} geometry={r.geometry} material={r.material} />
      ))}
      <mesh geometry={hedgerow.geometry} material={hedgerow.material} />
    </group>
  );
}
