"use client";
// The party screen's WebGL canvas: the garden canvas (components/garden/
// GardenCanvas.tsx) with the party scene inside. Same renderer settings,
// same opening (shaders compiled behind the veil, frame loop stopped until
// they are ready) and the same governor holding the frame rate, so a laptop
// driving a 1080p or 4K venue screen gets the large-screen budget the garden
// already plans for (lib/garden/device "bigscreen"). A default export because
// that is what next/dynamic's loader resolves.
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, useLayoutEffect } from "react";
import * as THREE from "three";
import { PartyScene } from "@/components/party/PartyScene";
import { Opening, RenderGovernor } from "@/components/garden/RenderBudget";
import { env } from "@/lib/garden/env";
import { quality, useQuality, type Phase } from "@/lib/garden/quality";
import { garden } from "@/lib/garden/store";

/** As the garden canvas: the leaves' transmission pass at half resolution. */
const TRANSMISSION_SCALE = 0.5;

const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 32, near: 0.05, far: 80, position: [0, 0.95, 2.9] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
// three r186 has no PCFSoftShadowMap; asking for it breaks the shadow samplers (see GardenCanvas).
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;

const stopped = (p: Phase) => p === "boot" || p === "compiling";

export default function PartyCanvas() {
  const dpr = useQuality((s) => s.dpr);
  const phase = useQuality((s) => s.phase);
  useLayoutEffect(() => {
    if (quality.get().phase === "boot") quality.set({ phase: "compiling" });
  }, []);
  return (
    <Canvas
      shadows={SHADOWS}
      dpr={dpr}
      frameloop={stopped(phase) ? "never" : "always"}
      gl={GL}
      camera={CAMERA}
      style={STYLE}
      onCreated={(state) => {
        state.gl.transmissionResolutionScale = TRANSMISSION_SCALE;
        // Dev-only handles for probing the live renderer from the console, named as on the garden page.
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
        <PartyScene />
        <Opening />
      </Suspense>
    </Canvas>
  );
}
