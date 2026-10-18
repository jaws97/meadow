"use client";
// The river preview's canvas: the Meadow's own renderer settings (components/meadow/MeadowCanvas.tsx: antialiased,
// PCF shadows, a 30-degree lens out to 400 m, three.js's own ACES tone mapping and no post-processing), so the river is
// judged as the Meadow draws, not as the personal garden does. Its pixel budget follows the page's tier (the Meadow's
// laptop budget on balanced, a phone's on lite, more for still captures on cinematic). The garden's opening and
// governor are not mounted: the scene's programs compile through the page's ready flag (quality phase "live" from
// the start), and window.__lotusReady goes up once a fully compiled frame has been drawn.
import { Canvas, useFrame, type CanvasProps } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useState, useEffect } from "react";
import * as THREE from "three";
import { dprForBudget, readDevice, MIN_DPR } from "@/lib/garden/device";
import { quality } from "@/lib/garden/quality";
import { useGarden } from "@/lib/garden/store";
import type { ConceptParams } from "@/components/lotus/params";
import { RiverScene } from "@/components/lotus/river/RiverScene";

const GL: CanvasProps["gl"] = { antialias: true, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 30, near: 0.1, far: 400, position: [20, 12, 20] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;
/** Megapixels per tier (the Meadow's laptop budget is 1.6, a phone's 1.0). */
const BUDGET = { cinematic: 3.2, balanced: 1.6, lite: 1.0 } as const;

/**
 * Draws the frame. The page's ready flag counts frames at a positive priority, which hands rendering over to the app
 * (as the garden's composer takes it at priority 1); with no composer here, this draws the scene plainly at 1.
 */
function Render() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1);
  return null;
}

function useDpr(tier: keyof typeof BUDGET): number {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const kind = readDevice().kind;
  return dprForBudget(BUDGET[tier], size.w, size.h, window.devicePixelRatio || 1, MIN_DPR[kind]);
}

export function RiverStage({ params, nonce }: { params: ConceptParams; nonce: number }) {
  const tier = useGarden((s) => s.quality);
  const dpr = useDpr(tier);
  // no opening here: the ready flag compiles the scene itself once the phase says the canvas is drawing
  useLayoutEffect(() => {
    quality.set({ phase: "live", veiled: false });
  }, []);
  return (
    <Canvas
      shadows={SHADOWS}
      dpr={dpr}
      gl={GL}
      camera={CAMERA}
      style={STYLE}
      onCreated={(state) => {
        state.gl.transmissionResolutionScale = 0.5;
        const w = window as unknown as { __river?: unknown };
        w.__river = state;
      }}
    >
      <Render />
      <Suspense fallback={null}>
        <RiverScene params={params} nonce={nonce} tier={tier} />
      </Suspense>
    </Canvas>
  );
}
