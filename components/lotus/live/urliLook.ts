// The Meadow's lotus from the model: the lotus in its brass urli on its bed plot, as the concepts page's plot view draws
// it (look.ts), chosen by the plot's band from the Meadow snapshot and, on a visit, by the friend's PondVisual. In the urli
// frame (y = 0 at the bed's soil).
//
// The Meadow carries no pond level, so the urli's water stands at its fill line, unless a visit's visual says the pond
// has fallen under the pot's rim (the urli runs low) or the pot has dried (bare mud, as moist as the model's moisture).
// A resting lotus keeps its floating leaves, browned. The flower opens as bloom^1.6 on a visit (the model's own clock),
// or by the hour on the far plots, where only the band is known; its warmth is the model's on a visit.
// Pure: no three, no DOM.
import { URLI } from "@/components/lotus/frame";
import { lookFor, type LotusLook } from "@/components/lotus/look";
import { DEFAULTS, type FlowerDay, type Mood, type Overrides, type Stage, type TimeOfDay } from "@/components/lotus/params";
import type { PondVisual } from "@/lib/sim";

export type MeadowBand = "seed" | "sprout" | "leafy" | "bud" | "bloom" | "resting";

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** The page's time of day for an IST clock hour. */
export function timeOfDay(clock: number): TimeOfDay {
  const t = ((clock % 24) + 24) % 24;
  if (t >= 4 && t < 6.5) return "predawn";
  if (t >= 6.5 && t < 16.5) return "noon";
  if (t >= 16.5 && t < 18) return "golden";
  if (t >= 18 && t < 19.5) return "dusk";
  return "night";
}

/** The urli's stage: from the band, or from the visit's visual when there is one (it knows a pod from a bloom). */
export function urliStageOf(v: PondVisual | null, band: MeadowBand): Stage {
  if (v && v.alive) {
    if (v.stage === "jar") return "jar";
    if (v.flowerDay > 0) return "bloom";
    if (v.pods > 0) return v.bud2 >= 0.5 ? "bud" : "pod";
  }
  switch (band) {
    case "seed": return "jar";
    case "sprout": return "floating";
    case "leafy": return "aerial";
    case "bud": return "bud";
    case "bloom": return "bloom";
    case "resting": return "floating";
  }
}

/** The urli lotus's look for a Meadow plot at IST clock hour `clock` (v: the visit's PondVisual, or null on the far plots). */
export function urliLookFromVisual(v: PondVisual | null, band: MeadowBand, clock: number, seed: string): LotusLook {
  void seed; // the urli view's leaf places are fixed; the seed varies the leaves' own textures in the build
  const stage = urliStageOf(v, band);
  const resting = band === "resting" || (v !== null && !v.alive);
  const low = v !== null && v.potIsolated && !v.potDry;
  const dry = v !== null && v.potDry;
  const o: Overrides = {
    water: dry ? 0 : low ? 10 : URLI.fillMM,
    algae: v ? clamp(v.algae) : 0,
    moisture: dry && v ? clamp(v.moisture) : 0.6,
    droop: v ? clamp(v.droop) : resting ? 0.55 : 0,
  };
  let day: FlowerDay = "auto";
  if (v && stage === "bloom") {
    day = String(v.flowerDay) as FlowerDay;
    o.open = clamp(Math.pow(clamp(v.bloom), 1.6));
  }
  if (v) o.warmth = clamp(v.warmth);
  if (v && stage === "pod") o.podDry = clamp(v.podDry);
  const mood: Mood = dry || low ? "drying" : v && v.algae >= 0.45 ? "green" : "happy";
  const look = lookFor({ ...DEFAULTS, view: "plot", stage, time: timeOfDay(clock), mood, day, overrides: o });
  if (!resting) return look;
  // asleep: the leaves browned and curling, no flower, no light
  return {
    ...look,
    floating: look.floating.map((f) => ({ ...f, brown: Math.max(f.brown, 0.75) })),
    standing: look.standing.map((s) => ({ ...s, wilt: Math.max(s.wilt, 0.7), crisp: Math.max(s.crisp, 0.6) })),
    flower: { ...look.flower, kind: "none", warmth: 0 },
    glowAt: "none",
    summary: "Resting: the leaves browned, the lotus asleep",
  };
}
