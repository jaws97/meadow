"use client";
// The WebGL canvas that fills the garden page. The page loads it through
// next/dynamic with ssr:false, so this tree only ever runs in the browser.
// A default export because that is what next/dynamic's loader resolves.
//
// The pixel-ratio cap follows the quality setting: every post-processing pass
// costs per pixel, so a phone on "lite" starts at 1x instead of 2x or 3x. On
// lite a performance monitor then lets it climb toward 1.5x while the frame
// rate holds at the display's refresh, and drops it back if it falls, so a
// phone with headroom gets crisper petals and one without keeps its frame
// rate. R3F re-applies dpr when the prop changes and the effect composer
// re-sizes its buffers when it sees the renderer's pixel ratio move, so this
// is live.
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, useCallback, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "@/components/garden/Scene";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { env } from "@/lib/garden/env";

const DPR: Record<Quality, [number, number]> = {
  cinematic: [1, 2],
  balanced: [1, 1.5],
  lite: [1, 1],
};
/** Lite's adaptive pixel-ratio ceiling and the step it moves by. */
const LITE_DPR_MAX = 1.5;
const LITE_DPR_STEP = 0.25;
/**
 * After this many changes of direction the pixel ratio settles on the lower
 * of the two steps it was swinging between: every change re-allocates the
 * effect buffers, a visible hitch, so a borderline phone must not hunt.
 */
const LITE_DPR_SWINGS = 3;
/**
 * Climb while nearly every sample holds 58 fps or more, back off when they
 * sag under 45. Fixed numbers rather than fractions of the refresh rate: the
 * monitor takes the fastest rate it has ever seen as the refresh rate, so a
 * single burst would otherwise set a bar the phone can never clear again.
 */
const liteBounds = (): [number, number] => [45, 58];

// Module scope so every render hands the Canvas the same option objects.
const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 32, near: 0.05, far: 80, position: [0, 0.95, 2.9] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;

export default function GardenCanvas() {
  const quality = useGarden((s) => s.quality);
  const [liteDpr, setLiteDpr] = useState(1);
  const adapt = useRef({ last: 0, swings: 0 });
  const step = useCallback((dir: 1 | -1) => {
    const a = adapt.current;
    if (a.swings >= LITE_DPR_SWINGS) return;
    if (a.last !== 0 && a.last !== dir) a.swings++;
    a.last = dir;
    setLiteDpr((d) => {
      // settled: the lower step of the swing, and no further changes
      if (a.swings >= LITE_DPR_SWINGS) return Math.max(1, Math.min(d, d - (dir > 0 ? 0 : LITE_DPR_STEP)));
      return Math.min(LITE_DPR_MAX, Math.max(1, d + dir * LITE_DPR_STEP));
    });
  }, []);
  const incline = useCallback(() => step(1), [step]);
  const decline = useCallback(() => step(-1), [step]);
  const dpr: [number, number] = quality === "lite" ? [1, liteDpr] : DPR[quality];
  return (
    // three r186 removed PCFSoftShadowMap; asking for it makes the first shadow
    // pass silently switch types after materials compiled, which leaves the
    // sampler2DShadow uniforms bound to a non-compare texture. Ask for PCF.
    <Canvas
      shadows={SHADOWS}
      dpr={dpr}
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
      {quality === "lite" ? (
        <PerformanceMonitor bounds={liteBounds} onIncline={incline} onDecline={decline} />
      ) : null}
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
