// Development only: a made-up Meadow for testing how the plants hold up, without touching the database. data.ts
// serves it in place of the real snapshot for /meadow?synthetic=400 in a development build (never in production):
// that many plants in the first plots, in a mix of species, stages and health, or every one at one stage with
// &stage=bloom (or seed, sprout, leafy, bud, resting). A visit to a made-up plant is answered here as well, from
// numbers that match its stage, and its sprinkle is never sent. With &same=1 a visited plant grows from its detail
// levels' own seed (bands.ts LOD_SEEDS), so its full plant and its light plant are the same plant, for checking the
// visit's handover.
//
// Deterministic: the same count gives the same Meadow on every device, so measurements can be repeated.
import { LOD_SEEDS, LOD_SPECIES, plotHash } from "@/components/meadow/lod/bands";
import type { Visual } from "@/lib/sim";
import type { FriendGarden, MeadowPlot, MeadowSnapshot } from "@/lib/server/meadow";

export type Stage = MeadowPlot["stage"];
const STAGES: readonly Stage[] = ["seed", "sprout", "leafy", "bud", "bloom", "resting"];
/** The mix of stages a few days after the party, cumulative shares. */
const STAGE_MIX: ReadonlyArray<readonly [number, Stage]> = [
  [0.1, "seed"],
  [0.3, "sprout"],
  [0.55, "leafy"],
  [0.75, "bud"],
  [0.95, "bloom"],
  [1, "resting"],
];
/** Synthetic Meadows stop at the planned rings' worth and then some, as the real one could. */
export const SYNTHETIC_MAX = 720;

export interface SyntheticOptions {
  count: number;
  /** every plant at this stage, or a mix when left out */
  stage?: Stage;
  /** visits grow from the detail levels' seed instead of each plant's own */
  same?: boolean;
}

/** Reads ?synthetic=N[&stage=...] from a query string; null when it is absent or not a whole number from 0. */
export function readSynthetic(search: string): SyntheticOptions | null {
  const q = new URLSearchParams(search);
  const raw = q.get("synthetic");
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  const stage = q.get("stage");
  const opts: SyntheticOptions = {
    count: Math.min(SYNTHETIC_MAX, Number(raw)),
    stage: STAGES.includes(stage as Stage) ? (stage as Stage) : undefined,
  };
  if (q.get("same") === "1") opts.same = true;
  return opts;
}

function plantAt(plot: number, opts: SyntheticOptions): MeadowPlot {
  const r = plotHash(plot, 11);
  const stage = opts.stage ?? STAGE_MIX.find(([share]) => r < share)![1];
  const h = plotHash(plot, 12);
  const health: MeadowPlot["health"] = stage === "resting" ? "resting" : h < 0.6 ? "thriving" : h < 0.88 ? "fine" : "poorly";
  const b = plotHash(plot, 13);
  // most open flowers fully open, some opening, some closed for their hours
  const bloom: MeadowPlot["bloom"] = stage !== "bloom" ? 0 : opts.stage === "bloom" ? 3 : b < 0.7 ? 3 : b < 0.8 ? 2 : b < 0.85 ? 1 : 0;
  return {
    plot,
    species: LOD_SPECIES[Math.floor(plotHash(plot, 14) * LOD_SPECIES.length)],
    name: `Synthetic ${plot}`,
    stage,
    health,
    bloom,
    generation: 1,
  };
}

/** The made-up Meadow: plots 0..count-1, as the server fills the inner rings first. */
export function syntheticSnapshot(opts: SyntheticOptions, now = Date.now()): MeadowSnapshot {
  const plots = Array.from({ length: opts.count }, (_, i) => plantAt(i, opts));
  const h = Math.floor(now / 3_600_000);
  return { v: 1, h, at: new Date(h * 3_600_000).toISOString(), count: plots.length, plots };
}

const GROWTH: Record<Stage, number> = { seed: 0.02, sprout: 0.19, leafy: 0.5, bud: 0.79, bloom: 1, resting: 0.6 };
const HEALTH: Record<MeadowPlot["health"], number> = { thriving: 0.9, fine: 0.62, poorly: 0.32, resting: 0 };

/** A made-up plant's visit, with the model's numbers for its stage and health; null for a plot past the Meadow. */
export function syntheticFriend(plot: number, opts: SyntheticOptions): FriendGarden | null {
  if (!Number.isInteger(plot) || plot < 0 || plot >= opts.count) return null;
  const p = plantAt(plot, opts);
  const alive = p.stage !== "resting";
  const poorly = p.health === "poorly";
  const visual: Visual = {
    growth: GROWTH[p.stage],
    bloom: p.bloom / 3,
    health: HEALTH[p.health],
    moisture: poorly ? 0.2 : 0.55,
    scorch: 0,
    droop: poorly ? 0.35 : 0,
    chlorosis: poorly ? 0.3 : 0,
    rot: 0,
    pests: 0,
    size: 1,
    turgor: poorly ? 0.6 : 1,
    flower: p.stage === "bud" || p.stage === "bloom" ? 1 : 0,
    puddle: 0,
    mushrooms: 0,
    snails: 0,
    aphids: 0,
    mites: 0,
    blackSpot: 0,
    headYaw: 0,
    petalDrop: 0,
    glow: 0,
    mood: !alive ? "resting" : poorly ? "thirsty" : p.stage === "bloom" ? "blooming" : "content",
    says: !alive ? "gone to sleep" : poorly ? "a little thirsty" : p.stage === "bloom" ? "in bloom" : "happy",
    alive,
    canAdvice: poorly ? "ready" : "ok",
    feedAdvice: "ok",
  };
  const snapshot = syntheticSnapshot(opts);
  return {
    v: 1,
    plot,
    name: p.name,
    species: p.species,
    seed: opts.same ? LOD_SEEDS[p.species] : `synthetic-${plot}`,
    generation: 1,
    day: 1 + Math.round(GROWTH[p.stage] * 13),
    stage: p.stage,
    health: p.health,
    bloom: p.bloom,
    visual,
    h: snapshot.h,
    at: snapshot.at,
  };
}
