// A blueprint is everything about a plant that never changes: how its stem
// leans, where each leaf and thorn sits, how every petal is arranged. It is
// derived purely from the owner's seed and the species, so it can be rebuilt anywhere.
import { Rng } from "./prng";
import type { Species } from "./species";

export interface StemSeg {
  length: number;
  dx: number;
  dz: number;
  r0: number;
  r1: number;
  phase: number;
}

export interface LeafNode {
  seg: number;
  t: number;
  yaw: number;
  pitch: number;
  roll: number;
  size: number;
  variant: number;
  /** 0 = lowest leaf, 1 = highest */
  order: number;
  leaflets: number;
  phase: number;
}

export interface ThornNode {
  seg: number;
  t: number;
  yaw: number;
  /** length in metres */
  size: number;
  /** extra downward tilt, radians */
  droop: number;
}

export interface PetalNode {
  layer: number;
  index: number;
  yaw: number;
  openTarget: number;
  scale: number;
  /** 0 opens first (outer whorls), up to ~0.85 (innermost) */
  stagger: number;
  variant: number;
  phase: number;
}

export interface Blueprint {
  seed: string;
  species: Species;
  stem: StemSeg[];
  leaves: LeafNode[];
  thorns: ThornNode[];
  petals: PetalNode[];
  flowerYaw: number;
  headTilt: number;
  leanDir: number;
}

export const VARIANTS = 3;
const GOLDEN = 2.399963;

export function buildBlueprint(seed: string, species: Species): Blueprint {
  const rng = new Rng(`${species.id}|${seed}`);
  const s = species.stem;
  const n = s.segments;
  const stem: StemSeg[] = [];
  const leanDir = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const length = (s.height / n) * rng.range(0.9, 1.1);
    const lean = s.lean * length * ((i + 1) / n);
    const wob = s.wobble * length * 0.12;
    const dx = Math.cos(leanDir) * lean + rng.gauss() * wob;
    const dz = Math.sin(leanDir) * lean + rng.gauss() * wob;
    const t0 = i / n;
    const t1 = (i + 1) / n;
    stem.push({
      length,
      dx,
      dz,
      r0: s.radius * (1.15 - 0.55 * t0),
      r1: s.radius * (1.15 - 0.55 * t1),
      phase: rng.range(0, 6.28),
    });
  }

  const count = rng.int(species.leaves.count[0], species.leaves.count[1]);
  const leaves: LeafNode[] = [];
  for (let i = 0; i < count; i++) {
    const order = count === 1 ? 0.5 : i / (count - 1);
    const along = Math.min(0.9, Math.max(0.08, 0.12 + 0.72 * order + rng.range(-0.03, 0.03)));
    const seg = Math.min(n - 1, Math.floor(along * n));
    const t = along * n - seg;
    leaves.push({
      seg,
      t: Math.min(0.98, Math.max(0.02, t)),
      yaw: i * GOLDEN + rng.range(-0.25, 0.25),
      pitch: rng.range(1.0, 1.3),
      roll: rng.range(-0.2, 0.2),
      size: (1.15 - 0.35 * order) * rng.range(0.9, 1.1),
      variant: rng.int(0, VARIANTS - 1),
      order,
      leaflets: species.leaves.compound,
      phase: rng.range(0, 6.28),
    });
  }

  const thorns: ThornNode[] = [];
  if (s.thorns) {
    const tc = rng.int(12, 18);
    for (let i = 0; i < tc; i++) {
      const along = 0.05 + 0.84 * ((i + rng.range(0.15, 0.85)) / tc);
      const seg = Math.min(n - 1, Math.floor(along * n));
      thorns.push({
        seg,
        t: Math.min(0.95, Math.max(0.05, along * n - seg)),
        yaw: rng.range(0, Math.PI * 2),
        size: s.radius * rng.range(1.9, 2.9),
        droop: rng.range(0.15, 0.45),
      });
    }
  }

  const petals: PetalNode[] = [];
  const L = species.flower.layers.length;
  species.flower.layers.forEach((layer, l) => {
    const offset = l * GOLDEN * 0.5 + rng.range(0, 0.3);
    for (let i = 0; i < layer.count; i++) {
      petals.push({
        layer: l,
        index: i,
        yaw: offset + (i / layer.count) * Math.PI * 2 + rng.range(-0.05, 0.05),
        openTarget: layer.open * rng.range(0.92, 1.08),
        scale: rng.range(0.93, 1.07),
        stagger: ((L - 1 - l) / Math.max(1, L - 1)) * 0.6 + rng.range(0, 0.25),
        variant: rng.int(0, VARIANTS - 1),
        phase: rng.range(0, 6.28),
      });
    }
  });

  return {
    seed,
    species,
    stem,
    leaves,
    thorns,
    petals,
    flowerYaw: rng.range(0, 6.28),
    headTilt: rng.range(0.08, 0.22),
    leanDir,
  };
}
