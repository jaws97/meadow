// Maps the simulation's numbers (growth, bloom, health, moisture, scorch)
// onto what the renderer needs: how long each stem segment is, how far each
// leaf has unfurled, how open each petal is, how much everything droops.
import { clamp01, easeOutBack, easeOutCubic, smoothstep } from "./prng";

export interface PlantVisual {
  /** 0 seed .. 1 fully grown */
  growth: number;
  /** 0 closed bud .. 1 fully open */
  bloom: number;
  /** 0 dead .. 1 thriving */
  health: number;
  /** soil water 0 .. 1 */
  moisture: number;
  /** sun damage 0 .. 1 */
  scorch: number;
}

export const STAGES = [
  { id: "seed", at: 0, label: "Seed" },
  { id: "sprout", at: 0.08, label: "Sprout" },
  { id: "seedling", at: 0.2, label: "Seedling" },
  { id: "growing", at: 0.42, label: "Growing" },
  { id: "budding", at: 0.68, label: "Budding" },
  { id: "bloom", at: 0.9, label: "In bloom" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export function stageOf(growth: number): StageId {
  let s: StageId = "seed";
  for (const st of STAGES) if (growth >= st.at) s = st.id;
  return s;
}

/** Total stem length as a fraction of the species height. */
export function stemGrowth(g: number): number {
  return easeOutCubic(smoothstep(0.06, 0.78, g));
}

/** Each segment's own 0..1 extension; segments grow bottom-up with overlap. */
export function segmentGrowth(g: number, i: number, n: number): number {
  const total = stemGrowth(g) * n;
  return clamp01(total - i * 0.85);
}

export function leafUnfurl(order: number, g: number): number {
  const start = 0.1 + order * 0.52;
  return easeOutBack(smoothstep(start, start + 0.14, g));
}

export function budGrowth(g: number): number {
  return easeOutCubic(smoothstep(0.6, 0.9, g));
}

export function petalOpen(bloom: number, stagger: number): number {
  return easeOutBack(clamp01((bloom - stagger * 0.35) / 0.65));
}

/**
 * Whether a petal has let go of its flower by `shed` (the share of its petals gone from the head through its last
 * evening, 0..1): here and there round the head, the outer petals a little sooner (`phase`, `stagger`: the petal's own).
 */
export function petalFallen(shed: number, phase: number, stagger: number): boolean {
  return shed > 0.001 && shed > 0.05 + 0.9 * (0.7 * ((phase / 6.2832) % 1) + 0.3 * Math.min(1, stagger / 0.85));
}

/** How far a petal of a flower on its last day loosens outward (radians): with its `open`, the outer whorls the most (`out` 0..1). */
export function petalLoosen(wither: number, open: number, out: number): number {
  return wither * 0.4 * open * (0.5 + 0.5 * out);
}

/** 0 upright .. 1 fully wilted. Thirst and sickness both drag the plant down. */
export function droopOf(v: PlantVisual): number {
  const thirst = 1 - smoothstep(0.08, 0.42, v.moisture);
  const sick = 1 - smoothstep(0.1, 0.45, v.health);
  return clamp01(Math.max(thirst * 0.9, sick * 0.75));
}

/** Effective health of one leaf. Lower leaves suffer first, and soggy soil rots from the bottom. */
export function leafHealth(v: PlantVisual, order: number): number {
  const soggy = Math.max(0, v.moisture - 0.82) / 0.18;
  return clamp01(v.health + (order - 0.5) * 0.22 - soggy * 0.5 * (1 - order));
}

/** 0 lush .. 1 brown. */
export function fadeOf(h: number): number {
  return 1 - smoothstep(0.25, 0.8, h);
}

export function leafDropped(order: number, health: number): boolean {
  return health < 0.28 * (1 - order) + 0.02;
}

export function quantize(x: number, steps: number): number {
  return Math.round(clamp01(x) * steps) / steps;
}
