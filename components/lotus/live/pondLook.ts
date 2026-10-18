// The courtyard's lotus from the model's live numbers: the same leaf places, stalks and flower clock as the concepts page
// (look.ts), chosen by the lotus's real state (lib/sim/pond.ts, eased into the garden store as PondShown by
// lib/client/plant) instead of by the page's address. In the pond frame (the pot's centre at the fill line).
//
// What follows the model:
// - the stage: the jar, then floating leaves, standing leaves, the bud, the flower's three days and the pod;
// - the leaves: as many floating leaves as the model has (floatLeaves) and as many standing ones (aerialLeaves, on the
//   pond view's low stalks); browning floating leaves on a drying pot (floatBrown), paling and crisp edges with the
//   model's chlorosis, the stalks bowing with its droop;
// - the flower: open fraction bloom^1.6 (section 5, so day 1 peaks at a goblet, day 2 at a wide cup, day 3 widest), the
//   bud-to-open morph and the re-closed cup of look.ts, day 3's petals falling (petalDrop), the inner glow only as the
//   model's warmth gives it, the pod swelling and drying (podDry); two readings of the model's numbers are the look's
//   own: on day 1's dawn the flower stays the ripe bud until its petals have parted (an open flower's petals folded that
//   far in crumple), and on day 3 the model's bloom falls with the petals (bloom x (1 - petalDrop)), which the look
//   draws as the petals that remain still held wide while the others drop, never a closing cup;
// - the water: the level against the fill line, the pot's own water once the pond has left its rim (from the water
//   over its pebbles), green water (algae), the jar's clearness (jarClarity) and the seedling's root once it is ready.
// Pure: no three, no DOM.
import {
  CLOSED_OPEN,
  POND_FLOAT_SPOTS,
  POND_FLOWER,
  POND_MUD_Y,
  POND_ROLLED,
  POND_STANDS,
  RECLOSED_MORPH,
  lookFor,
  pondFallenPetals,
  pondFloatingLeaves,
  pondJarInPotFrame,
  pondStandingLeaves,
  type FlowerLook,
  type JarLook,
  type LotusLook,
  type V3,
} from "@/components/lotus/look";
import { DEFAULTS, type Stage } from "@/components/lotus/params";
import type { PondShown } from "@/lib/garden/store";

/** What the courtyard's lotus is drawn from: the eased pond and the plant numbers the garden store already carries. */
export interface LotusLookInput {
  pond: PondShown;
  growth: number;
  /** the model's bloom (how open the flower is now, after turgor and bud stress) */
  bloom: number;
  health: number;
  droop: number;
  chlorosis: number;
  flowerSize: number;
  glow: number;
  alive: boolean;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

/** growth at D 0.64, where the model's bud forms (toVisual: 0.9 * D / 0.85) */
export const BUD_GROWTH = (0.9 * 0.64) / 0.85;
/** growth once the seedling's root and first leaf are out (D 0.10), and when the first root shows (D 0.06) */
const READY_GROWTH = (0.9 * 0.1) / 0.85;
const ROOT_GROWTH = (0.9 * 0.06) / 0.85;
/** the pebbles' top against the fill line, mm (the pot's own water stands on them) */
const PEBBLES_MM = -1000 * -POND_MUD_Y;
/**
 * The floating leaves from the planting (the seedling's coin leaves, a quarter of a grown leaf's size and drawn in to
 * lie over the pot) to the floating-leaf stage (full size, in the pond's places), by growth: at the planting the model
 * sets D to 0.10 (growth 0.106), and its floating leaves are spread by D 0.42 or so.
 */
const COIN_GROWTH = READY_GROWTH;
const SPREAD_GROWTH = 0.45;
const COIN_SCALE = 0.25;
const COIN_REACH = 0.35;

/** Day 1's dawn: the open fraction the petals must reach before the flower is drawn as a flower rather than the bud. */
export const BUD_HOLD_OPEN = 0.1;

/** Day 1 before its petals have parted (the morning only: a re-closed cup in the afternoon is a flower's). */
export function holdsBud(i: Pick<LotusLookInput, "pond" | "bloom">, clock: number): boolean {
  const t = ((clock % 24) + 24) % 24;
  return i.pond.flowerDay === 1 && t < 10 && flowerOpen(i.bloom, 1).open < BUD_HOLD_OPEN;
}

/**
 * The bloom the flower's opening is drawn from: the model's, with day 3's falling petals taken back out of it (the
 * model lowers bloom as they fall; the petals that remain stay wide).
 */
export function drawnBloom(bloom: number, day: number, petalDrop: number): number {
  return day === 3 ? Math.min(1, bloom / Math.max(0.05, 1 - clamp(petalDrop))) : bloom;
}

/** Which of the page's stages the lotus is at, from the model (with `clock`, day 1's dawn bud: holdsBud). */
export function pondStageOf(i: Pick<LotusLookInput, "pond" | "growth"> & Partial<Pick<LotusLookInput, "bloom">>, clock?: number): Stage {
  const p = i.pond;
  if (p.stage === "jar") return "jar";
  if (clock !== undefined && i.bloom !== undefined && holdsBud({ pond: p, bloom: i.bloom }, clock)) return "bud";
  if (p.flowerDay > 0) return "bloom";
  if (p.pods > 0) return p.bud2 >= 0.5 ? "bud" : "pod";
  if (i.growth >= BUD_GROWTH) return "bud";
  return p.aerialLeaves >= 1 ? "aerial" : "floating";
}

/** The flower's open fraction (o = bloom^1.6) and its shape: the bud-to-open morph and a re-closed flower's looser cup. */
export function flowerOpen(bloom: number, day: number): { open: number; morph: number } {
  const open = clamp(Math.pow(clamp(bloom), 1.6));
  const reclosed = day >= 1 && open <= CLOSED_OPEN + 0.05;
  return { open, morph: Math.max(smooth(open / 0.6), reclosed || day >= 2 ? RECLOSED_MORPH : 0) };
}

/** The courtyard lotus's look at IST clock hour `clock`, from the model; seed places the jar on its coping slab. */
export function pondLookFromShown(i: LotusLookInput, clock: number, seed: string): LotusLook {
  const p = i.pond;
  const stage = pondStageOf(i, clock);
  const levelMM = p.waterMM;
  const surface = levelMM / 1000;
  // the pot's own water once the pond is under its rim: on its pebbles, until it is gone
  const potWaterMM = p.potIsolated ? (p.potDry ? null : PEBBLES_MM + Math.max(0, p.stonesMM)) : null;
  const droop = i.alive ? clamp(i.droop) : 0.55;
  const crisp = clamp(i.chlorosis * 0.8 + (p.potDry ? 0.2 : 0));
  const pale = clamp(i.chlorosis);

  const jarAt = pondJarInPotFrame(seed);
  const seedAt: V3 = [jarAt[0] - 0.006, jarAt[1] + 0.027, jarAt[2] + 0.004];
  const jar: JarLook = {
    show: stage === "jar",
    clarity: clamp(p.jarClarity),
    root: p.moveReady ? 1 : 0.8 * clamp((i.growth - ROOT_GROWTH) / (READY_GROWTH - ROOT_GROWTH)),
  };

  // a seedling just settled in its pot has a coin leaf or two on the water over the pot; they spread to the pond's
  // leaves as it grows, full size and in their places by the floating-leaf stage
  const floatCount = stage === "jar" ? 0 : Math.min(POND_FLOAT_SPOTS, Math.max(1, Math.round(p.floatLeaves)));
  const spread = smooth((i.growth - COIN_GROWTH) / (SPREAD_GROWTH - COIN_GROWTH));
  const floatScale = COIN_SCALE + (1 - COIN_SCALE) * spread;
  const reach = COIN_REACH + (1 - COIN_REACH) * spread;
  const floating = floatCount === 0 ? [] : pondFloatingLeaves(floatCount, floatScale, levelMM, potWaterMM, clamp(p.floatBrown), reach)
    .map((f, k) => ({ ...f, pale: clamp(pale * (0.4 + 0.8 * (1 - k / Math.max(1, floatCount)))) }));
  const standCount = stage === "jar" ? 0 : Math.min(POND_STANDS.length, Math.max(0, Math.round(p.aerialLeaves)));
  const standing = pondStandingLeaves(standCount, droop, crisp).map((s, k) => ({ ...s, pale: clamp(pale * (k === 0 ? 1 : 0.5)) }));

  const flower: FlowerLook = {
    kind: "none",
    base: [...POND_FLOWER.base],
    head: [...POND_FLOWER.flower.head],
    leanX: POND_FLOWER.flower.leanX,
    leanZ: POND_FLOWER.flower.leanZ,
    open: 0,
    morph: 0,
    day: 0,
    relax: 0,
    blush: 0,
    warmth: 0,
    tepals: 0,
    stigmaWet: 0,
    pollen: 0,
    fallen: 0,
    podSwell: 0,
    podDry: 0,
    neck: 0.28 * clamp((droop - 0.2) / 0.6),
    scale: 1.2 * clamp(i.flowerSize, 0.4, 1.1),
  };
  let fallen = pondFallenPetals(0, levelMM);
  let summary: string;
  if (stage === "bud") {
    flower.kind = "bud";
    flower.head = [...POND_FLOWER.bud.head];
    flower.leanX = POND_FLOWER.bud.leanX;
    flower.blush = p.flowerDay === 1 ? 1 : clamp((i.growth - 0.85) / 0.15);
    flower.warmth = clamp(p.warmth);
    summary = flower.warmth > 0 ? "Ripe bud over the pond, warm from the night before it opens" : "A bud rising over the pond";
  } else if (stage === "bloom") {
    const day = p.flowerDay;
    const { open, morph } = flowerOpen(drawnBloom(i.bloom, day, p.petalDrop), day);
    flower.kind = "flower";
    flower.day = day;
    flower.open = open;
    flower.morph = morph;
    flower.relax = day === 3 ? 0.15 + 0.25 * clamp(p.petalDrop) : 0;
    flower.warmth = clamp(p.warmth);
    flower.tepals = day >= 2 ? 2 : 1;
    flower.stigmaWet = day === 1 ? 1 : 0;
    flower.pollen = day >= 2 ? 1 : 0;
    flower.fallen = day === 3 ? Math.round(18 * clamp(p.petalDrop)) : 0;
    if (flower.fallen > 0) fallen = pondFallenPetals(Math.ceil(5 * clamp(p.petalDrop)), levelMM);
    summary = day === 3 ? (flower.fallen > 0 ? `Day 3, widest, ${flower.fallen} petals fallen` : "Day 3, widest") : open <= CLOSED_OPEN + 0.05 ? `Day ${day}, closed, warm inside` : day === 1 ? "Day 1, a goblet" : "Day 2, a wide cup";
  } else if (stage === "pod") {
    flower.kind = "pod";
    flower.head = [...POND_FLOWER.pod.head];
    flower.leanX = POND_FLOWER.pod.leanX;
    flower.podSwell = clamp(0.5 + 0.5 * (p.podDry / 0.25));
    flower.podDry = clamp(p.podDry);
    flower.tepals = 2;
    flower.neck += 0.9 * flower.podDry;
    // the fallen petals drift and sink within about three days of the pod's forming
    fallen = pondFallenPetals(Math.max(0, Math.round(4 * (1 - clamp(p.podDry) / 0.15))), levelMM);
    summary = flower.podDry > 0.5 ? "Seed pod, browning and nodding" : "Green seed pod, petals drifting on the pond";
  } else if (stage === "aerial") {
    summary = `${standCount} standing leaves over the pond, ${floatCount} floating`;
  } else if (stage === "floating") {
    summary = `${floatCount} floating leaves on the pond, from the pot on the shelf`;
  } else {
    summary = p.moveReady ? "Seed in its jar, its root and first leaf out: ready for its pot" : jar.clarity < 0.6 ? "Seed in its jar, the water gone cloudy" : "Seed in its jar, waking";
  }

  let focus: V3;
  if (stage === "jar") focus = seedAt;
  else if (stage === "floating") focus = [0, surface + 0.08, -0.05];
  else if (stage === "aerial" && standing.length > 0) focus = [standing[0].top[0], standing[0].top[1], standing[0].top[2]];
  else focus = flower.head;

  // a young leaf still rolled while the plant makes its standing leaves (not while the pot dries: it waits)
  const rolled = standCount >= 1 && standCount < POND_STANDS.length && !p.potIsolated
    ? [{ base: POND_ROLLED.base, foot: [POND_ROLLED.foot[0], POND_ROLLED.foot[1] + surface, POND_ROLLED.foot[2]] as V3, tip: [POND_ROLLED.tip[0], POND_ROLLED.tip[1] + surface, POND_ROLLED.tip[2]] as V3, r: POND_ROLLED.r, seed: POND_ROLLED.seed }]
    : [];
  const t = ((clock % 24) + 24) % 24;
  const dew = standing.length === 0 ? 0 : t >= 4 && t < 6.5 ? 9 : 3;
  const note = p.potDry ? " · the pot drying" : p.potIsolated ? ` · the pond ${Math.round(Math.abs(levelMM))} mm down, under the pot's rim` : p.algae >= 0.2 ? ` · green water (${p.algae.toFixed(2)})` : "";

  return {
    frame: "pond",
    stage,
    jar,
    waterMM: levelMM,
    algae: clamp(p.algae),
    mudMoisture: p.potDry ? 0.3 : 0.6,
    floating,
    standing,
    flower,
    fallen,
    growth: clamp(i.growth),
    focus,
    glowAt: stage === "jar" ? "seed" : flower.kind === "bud" || flower.kind === "flower" ? "head" : "none",
    seedAt,
    mudY: POND_MUD_Y,
    surfaceY: surface,
    potWaterMM,
    rolled,
    dew,
    summary: summary + note,
  };
}

/** The lotus at its best, as the concepts page opens on it (in bloom at noon, in the pond): before any model numbers arrive. */
export function lotusDefaultLook(): LotusLook {
  return lookFor({ ...DEFAULTS, view: "pond", stage: "bloom", time: "noon" });
}
