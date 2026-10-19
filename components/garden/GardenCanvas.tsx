"use client";
// The WebGL canvas that fills the garden page. The page loads it through
// next/dynamic with ssr:false, so this tree only ever runs in the browser.
// A default export because that is what next/dynamic's loader resolves.
//
// The canvas's cost is looked after by RenderBudget: its pixel ratio comes
// from the runtime pixel budget (lib/garden/quality), which the governor
// moves to hold the frame rate, and its frame loop stays stopped while the
// opening compiles the shaders behind the loading veil. R3F re-applies dpr
// when the prop changes and the effect composer re-sizes its buffers when it
// sees the renderer's pixel ratio move, so a budget change is live.
//
// On the garden page's opening (lib/garden/opening) the canvas comes into
// focus as the veil lifts, from a soft blur to sharp (a CSS filter on its
// wrapper, for a few seconds only), on a laptop or a big screen and not on
// the lite tier. Elsewhere the veil's longer fade carries the focus alone and
// the compositor does no filtering: a filter over a live canvas is not proven
// smooth on a phone's or a tablet's GPU, and the moment is worth more than
// the blur.
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect } from "react";
import * as THREE from "three";
import { useOpeningFocus } from "@/components/garden/OpeningMoment";
import { Opening, RenderGovernor, TierPreparer } from "@/components/garden/RenderBudget";
import { Scene } from "@/components/garden/Scene";
import { setShaderChecks } from "@/components/garden/warmup";
import { opening } from "@/lib/garden/opening";
import { garden, useGarden } from "@/lib/garden/store";
import { env } from "@/lib/garden/env";
import { quality, useQuality, type Phase } from "@/lib/garden/quality";

/**
 * The leaves' transmission (cinematic and balanced) draws the opaque garden a
 * second time into a buffer the leaves sample, blurred by their roughness.
 * At half resolution that pass costs a quarter as much and the blurred view
 * through a leaf is indistinguishable.
 */
const TRANSMISSION_SCALE = 0.5;

// Module scope so every render hands the Canvas the same option objects.
const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 32, near: 0.05, far: 80, position: [0, 0.95, 2.9] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;

/** Nothing is drawn until the shaders are ready: a half-compiled first frame is the long black screen. */
const stopped = (p: Phase) => p === "boot" || p === "compiling";

/** `deer`: the doe may visit this garden (the garden page alone: lib/garden/visitor). */
export default function GardenCanvas({ deer = false }: { deer?: boolean }) {
  const dpr = useQuality((s) => s.dpr);
  const phase = useQuality((s) => s.phase);
  const tier = useGarden((s) => s.quality);
  const roomy = useQuality((s) => s.device?.kind === "laptop" || s.device?.kind === "bigscreen");
  const focus = useOpeningFocus();
  // Mounting the canvas means the chunk has arrived: the opening starts compiling.
  useLayoutEffect(() => {
    if (quality.get().phase === "boot") quality.set({ phase: "compiling" });
  }, []);
  // The tier settled under the veil decides how the garden comes into focus.
  useEffect(() => opening.setSoft(tier !== "lite" && roomy), [tier, roomy]);
  return (
    // three r186 removed PCFSoftShadowMap; asking for it makes the first shadow
    // pass silently switch types after materials compiled, which leaves the
    // sampler2DShadow uniforms bound to a non-compare texture. Ask for PCF.
    <Canvas
      shadows={SHADOWS}
      dpr={dpr}
      frameloop={stopped(phase) ? "never" : "always"}
      gl={GL}
      camera={CAMERA}
      style={STYLE}
      className={focus}
      onCreated={(state) => {
        state.gl.transmissionResolutionScale = TRANSMISSION_SCALE;
        setShaderChecks(state.gl);
        // Dev-only handle for probing the live renderer from the console.
        if (process.env.NODE_ENV !== "production") {
          const w = window as unknown as { __garden?: unknown; __gardenStore?: unknown; __gardenEnv?: unknown };
          w.__garden = state;
          w.__gardenStore = garden;
          w.__gardenEnv = env;
        }
      }}
    >
      <RenderGovernor />
      <Suspense fallback={null}>
        <Scene deer={deer} />
        <Opening />
        <TierPreparer />
      </Suspense>
    </Canvas>
  );
}
