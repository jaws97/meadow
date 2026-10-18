"use client";
// The concepts page's panel: one row of buttons per control (each mirrored in the address, params.ts), what the frame
// shows in a line, and the triangle counts once the frame is ready. The urli's vessel row shows only in the plot view
// (the pond has no urli, and the river's overflow urli is option A); the mood row only in the pond and the plot (the
// river is always full); the koi switch in the pond and the river (its twelve ambient koi), not on the plot.
// Collapsed to a button on a phone; ?ui=0 hides it for clean screenshots.
import { useState } from "react";
import { OPTIONS, type ConceptParams } from "@/components/lotus/params";
import type { LotusStats } from "@/components/lotus/ReadyFlag";

type Key = "vessel" | "stage" | "mood" | "time" | "view" | "cam" | "day" | "colour";

const ROWS: { key: Key; label: string }[] = [
  { key: "view", label: "View" },
  { key: "vessel", label: "Urli" },
  { key: "stage", label: "Stage" },
  { key: "mood", label: "Mood" },
  { key: "time", label: "Time" },
  { key: "cam", label: "Camera" },
  { key: "day", label: "Flower" },
  { key: "colour", label: "Colour" },
];

export function Controls({
  params,
  summary,
  stats,
  ready,
  onChange,
  onReframe,
  startOpen,
}: {
  params: ConceptParams;
  summary: string;
  stats: LotusStats | null;
  ready: boolean;
  onChange: (patch: Partial<ConceptParams>) => void;
  onReframe: () => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex justify-start p-3 sm:p-4">
      <div className="pointer-events-auto max-h-[calc(100dvh-24px)] w-full max-w-[460px] overflow-y-auto rounded-2xl border border-[rgba(255,236,200,0.14)] bg-[rgba(22,19,14,0.78)] text-[12px] text-[rgba(250,240,222,0.92)] shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-wide">Lotus concepts</p>
            <p className="truncate text-[11.5px] text-[rgba(246,234,214,0.72)]">{summary}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-[rgba(255,236,200,0.2)] px-3 py-1 text-[11.5px] hover:bg-[rgba(255,236,200,0.08)]"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Controls"}
          </button>
        </div>
        {open ? (
          <div className="space-y-2 border-t border-[rgba(255,236,200,0.1)] px-3.5 pb-3 pt-2.5">
            {ROWS.filter((row) => (row.key !== "vessel" || params.view === "plot") && (row.key !== "mood" || params.view !== "meadow")).map((row) => (
              <div key={row.key} className="flex flex-wrap items-center gap-1.5">
                <span className="w-[54px] shrink-0 text-[11px] uppercase tracking-wider text-[rgba(246,234,214,0.55)]">{row.label}</span>
                {OPTIONS[row.key].map(([id, label]) => {
                  const on = params[row.key] === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange({ [row.key]: id } as Partial<ConceptParams>)}
                      className={
                        "rounded-full px-2.5 py-1 text-[11.5px] transition-colors " +
                        (on ? "bg-[rgba(255,214,150,0.9)] text-[#24190c]" : "bg-[rgba(255,236,200,0.07)] hover:bg-[rgba(255,236,200,0.15)]")
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[54px] shrink-0 text-[11px] uppercase tracking-wider text-[rgba(246,234,214,0.55)]">Extras</span>
              {(
                [
                  ["rain", "Rain"],
                  ["still", "Still"],
                  ["koi", "Koi"],
                ] as const
              ).filter(([k]) => k !== "koi" || params.view !== "plot").map(([k, label]) => {
                const on = params[k];
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ [k]: !on } as Partial<ConceptParams>)}
                    className={
                      "rounded-full px-2.5 py-1 text-[11.5px] transition-colors " +
                      (on ? "bg-[rgba(255,214,150,0.9)] text-[#24190c]" : "bg-[rgba(255,236,200,0.07)] hover:bg-[rgba(255,236,200,0.15)]")
                    }
                  >
                    {label}
                  </button>
                );
              })}
              <button type="button" onClick={onReframe} className="rounded-full bg-[rgba(255,236,200,0.07)] px-2.5 py-1 text-[11.5px] hover:bg-[rgba(255,236,200,0.15)]">
                Reframe
              </button>
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-[rgba(246,234,214,0.6)]">
              {ready && stats && stats.extra && params.view === "pond"
                ? `Pond ${stats.lotus.toLocaleString()} triangles (plant ${stats.plant.toLocaleString()}${stats.koi ? `, koi ${stats.koi.toLocaleString()}` : ""}) · courtyard ${(stats.extra.court ?? 0).toLocaleString()} (plants ${(stats.extra.plants ?? 0).toLocaleString()}, lamps ${(stats.extra.lamps ?? 0).toLocaleString()}) · air ${(stats.extra.air ?? 0).toLocaleString()} · scene ${stats.scene.toLocaleString()} · ${stats.programs} programs · ${stats.tier}`
                : ready && stats && stats.extra
                ? `River lotus ${stats.lotus.toLocaleString()} triangles (near bridge's plant ${stats.plant.toLocaleString()}) · river ${(stats.extra.river ?? 0).toLocaleString()} · beds ${(stats.extra.beds ?? 0).toLocaleString()} · grounds ${(stats.extra.grounds ?? 0).toLocaleString()} · cart ${(stats.extra.cart ?? 0).toLocaleString()} · koi ${(stats.extra.koi ?? 0).toLocaleString()} · urli ${(stats.extra.urli ?? 0).toLocaleString()} · scene ${stats.scene.toLocaleString()} · ${stats.programs} programs · ${stats.tier}`
                : ready && stats
                ? `${params.view === "pond" ? "Pond" : "Lotus"} ${stats.lotus.toLocaleString()} triangles (plant ${stats.plant.toLocaleString()}${stats.koi ? `, koi ${stats.koi.toLocaleString()}` : ""})${stats.l1 ? ` · L1 ${stats.l1.toLocaleString()}` : ""} · scene ${stats.scene.toLocaleString()} · ${stats.programs} programs · ${stats.tier}`
                : "Building and compiling the frame…"}
            </p>
            <p className="text-[11px] leading-relaxed text-[rgba(246,234,214,0.45)]">
              Every control is in the address. Add quality=cinematic&amp;governor=off for repeatable captures, still=1 to hold the clock (and the koi), koi=0 to empty the pond or the river of fish, ui=0 to hide this panel.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
