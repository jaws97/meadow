"use client";
// The WebGL canvas that fills the garden page. The page loads it through
// next/dynamic with ssr:false, so this tree only ever runs in the browser.
// A default export because that is what next/dynamic's loader resolves.
//
// The pixel-ratio cap follows the quality setting: every post-processing pass
// costs per pixel, so a phone on "lite" renders at 1x instead of 2x. R3F
// re-applies dpr when the prop changes and the effect composer re-sizes its
// buffers when it sees the renderer's pixel ratio move, so this is live.
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";
import { Scene } from "@/components/garden/Scene";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { env } from "@/lib/garden/env";

const DPR: Record<Quality, [number, number]> = {
  cinematic: [1, 2],
  balanced: [1, 1.5],
  lite: [1, 1],
};

// Module scope so every render hands the Canvas the same option objects.
const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 32, near: 0.05, far: 80, position: [0, 0.95, 2.9] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;

export default function GardenCanvas() {
  const quality = useGarden((s) => s.quality);
  return (
    // three r186 removed PCFSoftShadowMap; asking for it makes the first shadow
    // pass silently switch types after materials compiled, which leaves the
    // sampler2DShadow uniforms bound to a non-compare texture. Ask for PCF.
    <Canvas
      shadows={SHADOWS}
      dpr={DPR[quality]}
      gl={GL}
      camera={CAMERA}
      style={STYLE}
      onCreated={(state) => {
        // Dev-only handle for probing the live renderer from the console.
        if (process.env.NODE_ENV !== "production") {
          const w = window as unknown as { __garden?: unknown; __gardenStore?: unknown; __gardenEnv?: unknown };
          w.__garden = state;
          w.__gardenStore = garden;
          w.__gardenEnv = env;
        }
      }}
    >
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
