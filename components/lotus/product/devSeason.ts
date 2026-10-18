// Development only: a lotus season run in the browser, so the developer panel can scrub a real pond model through its
// stages in the real product scene (and a scripted browser can capture every one) without a planted test lotus. The
// pond model (lib/sim/pond.ts) runs hour by hour from the party's planting on the 2025 weather fixtures (Open-Meteo, CC
// BY 4.0: the soil window and its continuation to 15 January), under one of a few ways of caring, the same ways the
// model was studied (lib/sim/__fixtures__/pond-harness.ts: visits at 08:00 and 18:00 acting on what the app shows).
// Loaded only by the developer panel in a development build (LotusDevControls), never in production.
import demo from "@/lib/sim/__fixtures__/demo-weather.json";
import late from "@/lib/sim/__fixtures__/weather-late-2025.json";
import { PLANT_OPEN_H, type HourWeather, type SimEvent } from "@/lib/sim/model";
import { createPond, stepPond, toVisualPond, type PondState, type PondVisual } from "@/lib/sim/pond";

interface Packed {
  n: number;
  T: number[];
  RH: number[];
  P: number[];
  SW: number[];
  ET0: number[];
  U: number[];
  Ts: number[];
  day: string;
}

/** The fixtures' scaled integers back to the model's hour (as the test harness unpacks them). */
function unpack(p: Packed): HourWeather[] {
  return Array.from({ length: p.n }, (_, i) => ({
    T: p.T[i] / 10,
    RH: p.RH[i],
    P: p.P[i] / 10,
    SW: p.SW[i],
    ET0: p.ET0[i] / 100,
    U: p.U[i] / 10,
    Ts: p.Ts[i] / 10,
    isDay: p.day[i] === "1" ? 1 : 0,
  }));
}

let rows: HourWeather[] | null = null;
const weather = () => (rows ??= unpack(demo as Packed).concat(unpack(late as Packed)));

export type SeasonKind = "good" | "none" | "hungry" | "green" | "drying";

export const SEASON_KINDS: readonly { id: SeasonKind; label: string }[] = [
  { id: "good", label: "Good care" },
  { id: "none", label: "Never touched" },
  { id: "hungry", label: "Koi never fed" },
  { id: "green", label: "Six pinches a day (green water)" },
  { id: "drying", label: "Cared for 8 days, then left (drying)" },
];

/** The last day the scrubber reaches (days after the party's planting). */
export const SEASON_DAYS = 40;

type Policy = (h: number, hod: number, s: PondState) => SimEvent[];

/** The test harness's good care (pond-harness.ts goodCare): what the app asks for, at 08:00 and 18:00. */
function goodCare({ koi = true, freshen = true }: { koi?: boolean; freshen?: boolean } = {}): Policy {
  return (_h, hod, s) => {
    const ev: SimEvent[] = [];
    if (!s.alive || (hod !== 8 && hod !== 18)) return ev;
    const v = toVisualPond(s);
    if (v.canAdvice === "ready" || v.canAdvice === "thirsty") ev.push({ kind: "water" });
    const greenNow = freshen && v.stage === "pond" && v.algae >= 0.45;
    const pinch = koi && (v.koiAdvice === "hungry" || (!greenNow && v.koiAdvice === "ready"));
    if (pinch || (koi && v.pests > 0.3)) ev.push({ kind: "tend" });
    if (v.feedAdvice === "hungry") ev.push({ kind: "feed" });
    return ev;
  };
}

const POLICIES: Record<SeasonKind, Policy> = {
  good: goodCare(),
  none: () => [],
  hungry: goodCare({ koi: false }),
  green: (h, hod, s) => {
    const ev: SimEvent[] = goodCare({ freshen: false })(h, hod, s).filter((e) => e.kind !== "tend");
    if (s.alive && hod % 4 === 0) ev.push({ kind: "tend" });
    return ev;
  },
  drying: (h, hod, s) => (h < PLANT_OPEN_H + 24 * 8 ? goodCare()(h, hod, s) : []),
};

const runs = new Map<SeasonKind, PondState[]>();

/** The season's states, one per hour from the planting (index 0) to SEASON_DAYS. */
export function season(kind: SeasonKind): PondState[] {
  const have = runs.get(kind);
  if (have) return have;
  const wx = weather();
  const policy = POLICIES[kind];
  let s = createPond("lotus", PLANT_OPEN_H, "me");
  const out: PondState[] = [s];
  const end = Math.min(wx.length, PLANT_OPEN_H + 24 * SEASON_DAYS);
  for (let h = PLANT_OPEN_H; h < end; h++) {
    s = stepPond(s, { h, wx: wx[h] }, policy(h, h % 24, s));
    out.push(s);
  }
  runs.set(kind, out);
  return out;
}

/** The lotus `day` days (fractional) after the party's planting under a season, drawn at its fractional clock hour. */
export function seasonAt(kind: SeasonKind, day: number): { state: PondState; visual: PondVisual; clock: number } {
  const all = season(kind);
  const at = Math.max(0, Math.min(all.length - 1, day * 24));
  const state = all[Math.floor(at)];
  const clock = (PLANT_OPEN_H + at) % 24;
  return { state, visual: toVisualPond(state, null, clock), clock };
}
