// Development only: a made-up Meadow for testing how the plants hold up, without touching the database. data.ts
// serves it in place of the real snapshot for /meadow?synthetic=400 in a development build (never in production):
// that many plants, in a mix of species, stages and health, or every one at one stage with &stage=bloom (or seed,
// sprout, leafy, bud, resting), each sown in turn into the plot the server would give it (plots.ts assignPlot): the
// first bed plots, inner rings first, and for a lotus the river's next pocket, or once all 56 are taken a bed plot's
// urli (?synthetic=300 sows 33 lotus, all in the river; 471 fills all 56 pockets; 486 puts the next lotus in an urli). A visit to a made-up plant is answered here as well, from
// numbers that match its stage, and its sprinkle is never sent. With &same=1 a visited plant grows from its detail
// levels' own seed (bands.ts LOD_SEEDS), so its full plant and its light plant are the same plant, for checking the
// visit's handover.
//
// A made-up lotus is answered with a lotus's numbers (lib/sim PondVisual): in its jar as a seed, its floating and
// standing leaves as it grows, a flower on its second day or (closed) a seed pod, the pond fallen below its pot when it
// is poorly, so a visit draws its urli as a real one would be drawn.
//
// Deterministic: the same count gives the same Meadow on every device, so measurements can be repeated.
import { LOD_SEEDS, LOD_SPECIES, plotHash } from "@/components/meadow/lod/bands";
import type { PondVisual, SoilVisual, Visual } from "@/lib/sim";
import type { FriendGarden, MeadowPlot, MeadowSnapshot } from "@/lib/server/meadow";
import { assignPlot } from "@/lib/server/plots";

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

/** The k-th made-up planting, in plot `plot` (its species, stage, health and bloom all from k). */
function plantAt(k: number, plot: number, opts: SyntheticOptions): MeadowPlot {
  const r = plotHash(k, 11);
  const stage = opts.stage ?? STAGE_MIX.find(([share]) => r < share)![1];
  const h = plotHash(k, 12);
  const health: MeadowPlot["health"] = stage === "resting" ? "resting" : h < 0.6 ? "thriving" : h < 0.88 ? "fine" : "poorly";
  const b = plotHash(k, 13);
  // most open flowers fully open, some opening, some closed for their hours
  const bloom: MeadowPlot["bloom"] = stage !== "bloom" ? 0 : opts.stage === "bloom" ? 3 : b < 0.7 ? 3 : b < 0.8 ? 2 : b < 0.85 ? 1 : 0;
  return {
    plot,
    species: speciesOf(k),
    name: `Synthetic ${plot}`,
    stage,
    health,
    bloom,
    generation: 1,
  };
}

const speciesOf = (k: number) => LOD_SPECIES[Math.floor(plotHash(k, 14) * LOD_SPECIES.length)];

/** The made-up plantings in sowing order, each in the plot the server would hand it (cached: they never change). */
const sown = new Map<string, MeadowPlot[]>();
function sowings(opts: SyntheticOptions): MeadowPlot[] {
  const key = `${opts.count}|${opts.stage ?? ""}`;
  const known = sown.get(key);
  if (known) return known;
  const taken = new Set<number>();
  const plots: MeadowPlot[] = [];
  for (let k = 0; k < opts.count; k++) {
    const plot = assignPlot(taken, { water: speciesOf(k) === "lotus" });
    if (plot === null) break;
    taken.add(plot);
    plots.push(plantAt(k, plot, opts));
  }
  sown.set(key, plots);
  return plots;
}

/** The made-up Meadow: its plantings in sowing order, as the server's snapshot lists them. */
export function syntheticSnapshot(opts: SyntheticOptions, now = Date.now()): MeadowSnapshot {
  const plots = sowings(opts).map((p) => ({ ...p }));
  const h = Math.floor(now / 3_600_000);
  return { v: 1, h, at: new Date(h * 3_600_000).toISOString(), count: plots.length, plots };
}

const GROWTH: Record<Stage, number> = { seed: 0.02, sprout: 0.19, leafy: 0.5, bud: 0.79, bloom: 1, resting: 0.6 };
const HEALTH: Record<MeadowPlot["health"], number> = { thriving: 0.9, fine: 0.62, poorly: 0.32, resting: 0 };

/** A made-up plant's visit, with the model's numbers for its stage and health; null for a plot nobody was sown in. */
export function syntheticFriend(plot: number, opts: SyntheticOptions): FriendGarden | null {
  const p = sowings(opts).find((q) => q.plot === plot);
  if (!p) return null;
  const alive = p.stage !== "resting";
  const poorly = p.health === "poorly";
  const soil: SoilVisual = {
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
  const visual: Visual = p.species === "lotus" ? lotusVisual(p, soil) : soil;
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

/** Floating and standing leaves at each stage, as the pond model grows them. */
const LEAVES: Record<Stage, [number, number]> = { seed: [0, 0], sprout: [3, 0], leafy: [5, 2], bud: [6, 3], bloom: [6, 3], resting: [5, 2] };

/** A made-up lotus's numbers for its stage and health, on top of the soil numbers its stage shares. */
function lotusVisual(p: MeadowPlot, base: SoilVisual): PondVisual {
  const jar = p.stage === "seed";
  const poorly = p.health === "poorly";
  const flowering = p.stage === "bloom" && p.bloom > 0;
  const pod = p.stage === "bloom" && !flowering;
  const [floatLeaves, aerialLeaves] = LEAVES[p.stage];
  const says: PondVisual["says"] = !base.alive
    ? "gone to sleep"
    : jar
      ? "a seed in clear water, waking up"
      : poorly
        ? "the pond has dropped below the rim of my pot; a top-up or two, please"
        : flowering
          ? "in bloom"
          : pod
            ? "my seed pod is ripening"
            : "happy";
  return {
    ...base,
    medium: "pond",
    says,
    feedAdvice: "ok",
    koiAdvice: "fed",
    stage: jar ? "jar" : "pond",
    moveReady: false,
    waterMM: poorly ? -60 : 0,
    pondMM: poorly ? -60 : 0,
    stonesMM: poorly ? 0 : 50,
    potIsolated: poorly,
    potDry: false,
    water: poorly ? 0 : 0.71,
    jarClarity: jar ? 0.9 : 1,
    algae: 0,
    floatLeaves,
    aerialLeaves,
    floatBrown: base.alive ? 0 : 0.8,
    nibbled: 0,
    koiHunger: 0,
    koiGather: 0,
    koiGasp: false,
    flowerDay: flowering ? 2 : 0,
    flowers: p.stage === "bloom" ? 1 : 0,
    pods: pod ? 1 : 0,
    pod: pod ? 1 : 0,
    bud2: 0,
    podDry: pod ? 0.3 : 0,
    warmth: flowering ? 0.4 : 0,
    waterT: 24,
  };
}
