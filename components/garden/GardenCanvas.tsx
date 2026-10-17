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
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, useLayoutEffect } from "react";
import * as THREE from "three";
import { Opening, RenderGovernor } from "@/components/garden/RenderBudget";
import { Scene } from "@/components/garden/Scene";
import { garden } from "@/lib/garden/store";
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

export default function GardenCanvas() {
  const dpr = useQuality((s) => s.dpr);
  const phase = useQuality((s) => s.phase);
  // Mounting the canvas means the chunk has arrived: the opening starts compiling.
  useLayoutEffect(() => {
    if (quality.get().phase === "boot") quality.set({ phase: "compiling" });
  }, []);
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
      onCreated={(state) => {
        state.gl.transmissionResolutionScale = TRANSMISSION_SCALE;
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
        <Scene />
        <Opening />
      </Suspense>
    </Canvas>
  );
}
