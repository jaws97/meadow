"use client";
// The /lotus-concepts stage: the garden's own canvas (components/party/PartyCanvas.tsx's settings: the same renderer,
// PCF shadows, the leaves' transmission at half resolution, the opening that compiles every shader behind a stopped
// frame loop, and the governor holding the frame rate) with the lotus scene inside, and the page's controls over it.
// Loaded in the browser only (LotusConcepts.tsx), so the address is read once at load, before the canvas mounts: the
// garden store gets the frame's hour, sky and staging first, so the opening compiles the right light set. The Meadow
// view (the lazy river) draws in the Meadow's own canvas instead (river/RiverStage.tsx); switching to or from it
// reloads the page with the new address, since the two canvases' openings differ.
// A default export because that is what next/dynamic's loader resolves.
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Opening, RenderGovernor } from "@/components/garden/RenderBudget";
import { env } from "@/lib/garden/env";
import { quality, useQuality, type Phase } from "@/lib/garden/quality";
import { garden } from "@/lib/garden/store";
import { weather } from "@/components/garden/garden/weather";
import { Controls } from "@/components/lotus/Controls";
import { LotusScene } from "@/components/lotus/LotusScene";
import { lookFor } from "@/components/lotus/look";
import { DEFAULTS, hourFor, parseParams, skyFor, toSearch, type ConceptParams } from "@/components/lotus/params";
import type { LotusStats } from "@/components/lotus/ReadyFlag";
import { riverSummary } from "@/components/lotus/river/RiverLotus";
import { RiverStage } from "@/components/lotus/river/RiverStage";

const TRANSMISSION_SCALE = 0.5;
const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 42, near: 0.05, far: 80, position: [0.3, 0.8, 2.4] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
// three r186 has no PCFSoftShadowMap; asking for it breaks the shadow samplers (see GardenCanvas).
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;

const stopped = (p: Phase) => p === "boot" || p === "compiling";
/**
 * Still captures (?still=1) draw at least this many device pixels per CSS pixel, so a screenshot taken on a 1x screen is
 * supersampled as a laptop's 1.5x screen draws it: the composer's SMAA alone leaves stair-steps on the coping's and the
 * leaves' edges at 1x. Live views keep the pixel budget's own ratio.
 */
const STILL_MIN_DPR = 1.5;

/** The garden store for a frame: the owner's garden dressing, the hour and sky, the companions staged by the lotus. */
function applyToStore(p: ConceptParams) {
  const look = lookFor(p);
  const sky = skyFor(p.time, p.rain);
  garden.set({
    // Atmosphere reads SPECIES[speciesId]; the lotus is not a species yet, so the store keeps the owner's rose
    // (its effects: no scent, sparks only when unwell)
    speciesId: "rose",
    seed: "Lijas",
    growth: look.growth,
    bloom: 1,
    health: 1,
    // (the pond has no mulch; the Meadow view's urli draws its mud from the look, never the mulch: art direction 10.6)
    moisture: 0.6,
    scorch: 0,
    droop: null,
    chlorosis: 0,
    rot: 0,
    pests: 0,
    mushrooms: 0,
    snails: 0,
    flowerSize: 1,
    glow: 0,
    shade: 0,
    cover: 0,
    dockBottom: 0,
    dockRight: 0,
    wind: 0.5,
    hour: hourFor(p),
    autoClock: false,
    cloud: sky.cloud,
    rain: sky.rain,
  });
}

const search = typeof window === "undefined" ? "" : window.location.search;
const initial = typeof window === "undefined" ? DEFAULTS : parseParams(search);
const showUi = new URLSearchParams(search).get("ui") !== "0";
const startOpen = typeof window !== "undefined" && window.innerWidth >= 768;
if (typeof window !== "undefined") {
  applyToStore(initial);
  // still frames hold the pixel budget too (as ?governor=off does)
  if (initial.still) quality.set({ auto: false });
  window.__lotusReady = false;
}

export default function LotusStage() {
  const [params, setParams] = useState<ConceptParams>(initial);
  const [nonce, setNonce] = useState(0);
  const [stats, setStats] = useState<LotusStats | null>(null);
  const [ready, setReady] = useState(false);
  const budgetDpr = useQuality((s) => s.dpr);
  const dpr = initial.still ? Math.max(budgetDpr, STILL_MIN_DPR) : budgetDpr;
  const phase = useQuality((s) => s.phase);
  const river = params.view === "meadow";
  const summary = useMemo(() => (params.view === "meadow" ? riverSummary(params) : lookFor(params).summary), [params]);

  useLayoutEffect(() => {
    if (quality.get().phase === "boot") quality.set({ phase: "compiling" });
  }, []);

  useEffect(() => {
    const onReady = (e: Event) => {
      setStats((e as CustomEvent<LotusStats>).detail);
      setReady(true);
    };
    window.addEventListener("lotus-ready", onReady);
    return () => window.removeEventListener("lotus-ready", onReady);
  }, []);

  const change = useCallback(
    (patch: Partial<ConceptParams>) => {
      const next = { ...params, ...patch };
      if ((next.view === "meadow") !== (params.view === "meadow")) {
        window.location.assign(window.location.pathname + toSearch(next, window.location.search));
        return;
      }
      applyToStore(next);
      // the near garden's weather primes itself afresh (wet stone, the lantern) instead of easing over seconds
      weather.primed = false;
      window.history.replaceState(null, "", toSearch(next, window.location.search));
      setReady(false);
      setParams(next);
    },
    [params],
  );

  return (
    <main className="fixed inset-0 bg-[#06080f]">
      {river ? <RiverStage params={params} nonce={nonce} /> : null}
      {river ? null : (
      <Canvas
        shadows={SHADOWS}
        dpr={dpr}
        frameloop={stopped(phase) ? "never" : "always"}
        gl={GL}
        camera={CAMERA}
        style={STYLE}
        onCreated={(state) => {
          state.gl.transmissionResolutionScale = TRANSMISSION_SCALE;
          // dev handles for probing from the console, named as on the garden page
          const w = window as unknown as { __garden?: unknown; __gardenStore?: unknown; __gardenEnv?: unknown };
          w.__garden = state;
          w.__gardenStore = garden;
          w.__gardenEnv = env;
        }}
      >
        <RenderGovernor />
        <Suspense fallback={null}>
          <LotusScene params={params} nonce={nonce} />
          <Opening />
        </Suspense>
      </Canvas>
      )}
      {river && !ready ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 text-center text-[12px] tracking-wide text-[rgba(246,234,214,0.6)]">Building the Meadow…</div>
      ) : null}
      {!river && stopped(phase) ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 text-center text-[12px] tracking-wide text-[rgba(246,234,214,0.6)]">Compiling the garden…</div>
      ) : null}
      {showUi ? (
        <Controls params={params} summary={summary} stats={stats} ready={ready} onChange={change} onReframe={() => setNonce((n) => n + 1)} startOpen={startOpen} />
      ) : null}
    </main>
  );
}
