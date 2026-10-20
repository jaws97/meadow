"use client";
// Development only: the developer panel's lotus controls (components/garden/DevPanel loads this in a development build
// only). A day-and-hour scrubber runs the pond model in the browser (devSeason.ts) under a chosen way of caring and hands
// its PondVisual to the garden store exactly as lib/client/plant does for a real plant, so every stage can be seen (and
// captured by a scripted browser) in the real courtyard; the stage buttons jump to the moments worth checking; the
// moment buttons play this device's own care as a press would (the pinch for the koi, a top-up, the planting, a word),
// and refuse the top-up playing as the server would.
import { useCallback, useMemo, useState } from "react";
import { flowerSizeOf, pondShownOf } from "@/lib/client/plantShown";
import { garden, useGarden, type PondShown } from "@/lib/garden/store";
import type { PondVisual } from "@/lib/sim/pond";
import { season, seasonAt, SEASON_DAYS, SEASON_KINDS, type SeasonKind } from "@/components/lotus/product/devSeason";

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
const clockText = (h: number) => {
  const m = Math.round(h * 60) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

/** The stages worth checking: the first hour of the season where each holds, and how long after it to look (hours). */
const STAGES: readonly { label: string; kind: SeasonKind; find: (v: PondVisual) => boolean; after: number; hod?: number }[] = [
  { label: "Jar", kind: "good", find: (v) => v.stage === "jar", after: 8 },
  { label: "Ready", kind: "none", find: (v) => v.moveReady, after: 1 },
  { label: "Coin", kind: "good", find: (v) => v.stage === "pond", after: 18 },
  { label: "Floating", kind: "good", find: (v) => v.floatLeaves >= 4, after: 6 },
  { label: "Standing", kind: "good", find: (v) => v.aerialLeaves >= 1, after: 12 },
  { label: "Bud", kind: "good", find: (v) => v.growth >= 0.86, after: 10 },
  { label: "Day 1 dawn", kind: "good", find: (v) => v.flowerDay === 1, after: 0.6 },
  { label: "Day 1 08:30", kind: "good", find: (v) => v.flowerDay === 1, after: 2.5 },
  { label: "Day 2 noon", kind: "good", find: (v) => v.flowerDay === 2, after: 0, hod: 12 },
  { label: "Day 2 16:30", kind: "good", find: (v) => v.flowerDay === 2, after: 0.5, hod: 16 },
  { label: "Day 3 noon", kind: "good", find: (v) => v.flowerDay === 3, after: 0, hod: 12 },
  { label: "Petals falling", kind: "good", find: (v) => v.flowerDay === 3, after: 0, hod: 21 },
  { label: "Pod", kind: "good", find: (v) => v.pods >= 1 && v.flowerDay === 0, after: 30 },
  { label: "Night bud", kind: "good", find: (v) => v.growth >= 0.95 && v.flowerDay === 0, after: 0, hod: 2 },
];

/** The day (after the planting) a stage button jumps to, or null if the season never gets there. */
function stageDay(s: (typeof STAGES)[number]): number | null {
  const all = season(s.kind);
  for (let i = 0; i < all.length; i++) {
    const v = seasonAt(s.kind, i / 24).visual;
    if (!s.find(v)) continue;
    if (s.hod === undefined) return (i + s.after) / 24;
    for (let j = i; j < Math.min(all.length, i + 30); j++) if (all[j].hod === s.hod) return (j + s.after) / 24;
  }
  return null;
}

/** The season's lotus at `day` into the garden store, as the plant bridge would put it, keeping this device's moments. */
function push(kind: SeasonKind, day: number) {
  const { state, visual, clock } = seasonAt(kind, day);
  const was = garden.get().pond;
  garden.set({
    speciesId: "lotus",
    growth: visual.growth,
    bloom: visual.bloom,
    health: visual.health,
    moisture: visual.moisture,
    scorch: visual.scorch,
    droop: visual.droop,
    chlorosis: visual.chlorosis,
    rot: visual.rot,
    pests: visual.pests,
    flowerSize: flowerSizeOf(visual, state.gen),
    hour: clock,
    autoClock: false,
    pond: pondShownOf(visual, { topUpAt: was?.topUpAt ?? 0, pinchAt: was?.pinchAt ?? 0, plantedAt: was?.plantedAt ?? 0 }),
  });
}

/** The pond as it stood before the top-up playing now, put back if that top-up is refused. */
let beforeTopUp: Pick<PondShown, "waterMM" | "stonesMM" | "potIsolated" | "potDry"> | null = null;

/** This device's care, played as a press would play it. */
function play(kind: "pinch" | "topUp" | "plant" | "talk") {
  const p = garden.get().pond;
  const now = Date.now();
  if (kind === "talk") {
    garden.set({ glow: 1 });
    return;
  }
  if (!p) return;
  let next: PondShown = p;
  if (kind === "pinch") next = { ...p, pinchAt: now, koiGather: 1, koiHunger: 0, aphids: p.aphids * 0.1 };
  else if (kind === "topUp" && p.stage === "pond") {
    beforeTopUp = { waterMM: p.waterMM, stonesMM: p.stonesMM, potIsolated: p.potIsolated, potDry: p.potDry };
    const level = Math.min(20, p.waterMM + 11.5);
    next = { ...p, waterMM: level, stonesMM: level + 50, potIsolated: level < -25 ? p.potIsolated : false, potDry: level < -25 && p.potDry, topUpAt: now };
  } else if (kind === "plant" && p.stage === "jar") next = { ...p, stage: "pond", moveReady: false, jarClarity: 1, floatLeaves: Math.max(1, p.floatLeaves), plantedAt: now };
  garden.set({ pond: next });
}

/**
 * The top-up playing now, refused as the server would refuse it (lib/client/plant sendCare): its stamp and its water
 * withdrawn and the refusal said, so the brass pot goes home.
 */
function refuse() {
  const p = garden.get().pond;
  if (!p || !(p.topUpAt > 0)) return;
  garden.set({ pond: { ...p, ...beforeTopUp, topUpAt: 0 }, topUpRefused: { at: p.topUpAt, refusedAt: Date.now() } });
  beforeTopUp = null;
}

const button =
  "rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] leading-tight text-white/85 transition-colors hover:bg-white/20 active:bg-white/25";

export default function LotusDevControls() {
  const lotus = useGarden((s) => s.speciesId === "lotus");
  const [kind, setKind] = useState<SeasonKind>("good");
  const [day, setDay] = useState(13.65);
  const hour = useGarden((s) => s.hour);
  const pond = useGarden((s) => s.pond);
  const go = useCallback((k: SeasonKind, d: number) => {
    setKind(k);
    setDay(d);
    push(k, d);
  }, []);
  const stages = useMemo(() => (lotus ? STAGES.map((s) => ({ s, day: stageDay(s) })) : []), [lotus]);
  if (!lotus) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-medium tracking-wider text-white/40 uppercase select-none">Lotus season (development)</h3>
      <label className="block">
        <span>Care</span>
        <select
          value={kind}
          onChange={(e) => go(e.currentTarget.value as SeasonKind, day)}
          className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white/85 outline-none focus:border-white/30"
        >
          {SEASON_KINDS.map((k) => (
            <option key={k.id} value={k.id} className="bg-neutral-900 text-white">
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="flex items-baseline justify-between">
          <span>Day and hour</span>
          <span className="text-white/55 tabular-nums">
            day {day.toFixed(2)} · {clockText(hour)}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={SEASON_DAYS}
          step={1 / 96}
          value={day}
          onChange={(e) => go(kind, e.currentTarget.valueAsNumber)}
          className="mt-1 block w-full accent-pink-300"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {stages.map(({ s, day: d }) =>
          d === null ? null : (
            <button key={s.label} type="button" className={button} onClick={() => go(s.kind, d)}>
              {s.label}
            </button>
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={button} onClick={() => play("pinch")}>
          Pinch for the koi
        </button>
        <button type="button" className={button} disabled={pond?.stage !== "pond"} onClick={() => play("topUp")}>
          Top up
        </button>
        <button type="button" className={button} disabled={!pond?.topUpAt} onClick={refuse}>
          Refuse top-up
        </button>
        <button type="button" className={button} disabled={pond?.stage !== "jar"} onClick={() => play("plant")}>
          Plant
        </button>
        <button type="button" className={button} onClick={() => play("talk")}>
          Talk
        </button>
      </div>
    </section>
  );
}

/** For scripted captures (development builds): jump to a season's day or a stage, play a press, or refuse a top-up. */
export const lotusDev = {
  push,
  play,
  refuse,
  stage(label: string): number | null {
    const s = STAGES.find((x) => x.label === label);
    const d = s ? stageDay(s) : null;
    if (s && d !== null) push(s.kind, d);
    return d;
  },
};
if (typeof window !== "undefined") (window as unknown as { __lotusDev?: typeof lotusDev }).__lotusDev = lotusDev;
