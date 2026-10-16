"use client";
// The spike's developer readout and its few buttons, as plain HTML over the
// canvas. It polls the shared runtime four times a second, so it costs the
// render loop nothing. Also here: the fade veil that hides a respawn, which
// follows the runtime every animation frame so the fade is smooth.
import { useEffect, useRef, useState } from "react";
import { meadow } from "@/components/meadow/runtime";

interface Snapshot {
  fps: number;
  frameMs: number;
  frameMaxMs: number;
  physicsMs: number;
  stepMs: number;
  stepsPerFrame: number;
  speed: number;
  calls: number;
  triangles: number;
  dpr: number;
  loading: boolean;
  mover: string;
  mode: string;
  stuck: boolean;
}

function snapshot(): Snapshot {
  const s = meadow.stats;
  return { ...s, mover: meadow.moverKind, mode: meadow.mode, stuck: meadow.stuck };
}

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "-");

function switchMover(kind: "physics" | "glide") {
  const url = new URL(window.location.href);
  if (kind === "glide") url.searchParams.set("mover", "glide");
  else url.searchParams.delete("mover");
  window.location.assign(url.toString());
}

export function DevHud() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setSnap(snapshot()), 250);
    return () => window.clearInterval(id);
  }, []);

  const physics = snap?.mover !== "glide";
  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-10 select-none p-3 font-mono text-[11px] leading-[1.45] text-white/80"
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingLeft: "max(12px, env(safe-area-inset-left))" }}
    >
      <div className="pointer-events-auto rounded-lg bg-black/35 px-3 py-2 backdrop-blur-sm">
        <button type="button" className="mb-1 block text-white/90" onClick={() => setOpen((o) => !o)}>
          Meadow spike {open ? "-" : "+"}
        </button>
        {open && snap && (
          <div className="grid grid-cols-[auto_auto] gap-x-3">
            <span className="text-white/50">fps</span>
            <span>
              {fmt(snap.fps, 0)} ({fmt(snap.frameMs)} ms, max {fmt(snap.frameMaxMs, 0)})
            </span>
            <span className="text-white/50">physics</span>
            <span>
              {physics ? `${fmt(snap.physicsMs, 2)} ms/frame, ${fmt(snap.stepMs, 2)} ms/step x${fmt(snap.stepsPerFrame, 1)}` : "none"}
            </span>
            <span className="text-white/50">speed</span>
            <span>{fmt(snap.speed, 2)} m/s</span>
            <span className="text-white/50">mover</span>
            <span>
              {snap.loading ? "loading..." : snap.mover} / {snap.mode}
            </span>
            <span className="text-white/50">gpu</span>
            <span>
              {snap.calls} calls, {(snap.triangles / 1000).toFixed(0)}k tris, dpr {fmt(snap.dpr, 2)}
            </span>
          </div>
        )}
        {open && (
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => (meadow.requests.respawn = true)}>
              Respawn
            </button>
            <button type="button" className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => switchMover(physics ? "glide" : "physics")}>
              Use {physics ? "glide" : "physics"}
            </button>
          </div>
        )}
      </div>
      {snap?.stuck && (
        <button
          type="button"
          className="pointer-events-auto mt-3 rounded-full bg-[#fff1cf]/90 px-4 py-2 font-sans text-sm text-[#3b2f22] shadow-lg"
          onClick={() => (meadow.requests.unstuck = true)}
        >
          Unstuck
        </button>
      )}
    </div>
  );
}

/** A warm veil over everything while the cart is moved back to a path. */
export function FadeVeil() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const o = meadow.fade;
        el.style.opacity = String(o);
        el.style.visibility = o > 0.001 ? "visible" : "hidden";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} className="pointer-events-none fixed inset-0 z-20 bg-[#f3e6d2]" style={{ opacity: 0, visibility: "hidden" }} />;
}
