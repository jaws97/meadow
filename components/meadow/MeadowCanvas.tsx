"use client";
// The Meadow spike's WebGL canvas. The page loads it through next/dynamic with
// ssr:false, so everything here runs only in the browser; a default export
// because that is what next/dynamic's loader resolves.
//
// `?mover=glide` swaps the physics cart for the physics-free glider. The
// physics side lives in its own lazily imported chunk, so the glide path
// never fetches or boots Rapier. The scene, plots, guides and camera are
// shared and only ever talk to whichever Mover is live.
//
// Frame order, by useFrame priority: perf probe (-10), controller (-6),
// Rapier's stepper and its timer (-5.01..-4.99), cart and glider sync
// (-5..-4.9), camera (-1), guides and sun (-0.5), then R3F renders.
import { Canvas, useFrame, useThree, type CanvasProps } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CameraRig } from "@/components/meadow/CameraRig";
import { MeadowController } from "@/components/meadow/controller";
import { GlideMover } from "@/components/meadow/GlideMover";
import { GuideMarkers } from "@/components/meadow/GuideMarkers";
import { MeadowEnvironment } from "@/components/meadow/MeadowEnvironment";
import { MeadowScene } from "@/components/meadow/MeadowScene";
import type { MoverKind } from "@/components/meadow/mover";
import { PlotMarkers } from "@/components/meadow/PlotMarkers";
import { meadow, perf, resetMeadow } from "@/components/meadow/runtime";

const PhysicsWorld = lazy(() => import("@/components/meadow/PhysicsWorld"));

const GL: CanvasProps["gl"] = { antialias: true, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 30, near: 0.1, far: 220, position: [20, 12, 20] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0, touchAction: "none" };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;
const PUBLISH_EVERY = 0.5;

/** Phones get a lighter shadow map and a lower pixel-ratio cap. */
function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function readMoverKind(): MoverKind {
  const p = new URLSearchParams(window.location.search).get("mover");
  return p === "glide" ? "glide" : "physics";
}

/** Wires the controller to the canvas and runs it before physics each frame. */
function Controls({ controller }: { controller: MeadowController }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  useEffect(() => {
    controller.input.attach(gl.domElement);
    // Dev-only handle for probing the live spike from the console.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __meadow?: unknown }).__meadow = { state: get(), get, meadow, controller };
    }
    return () => controller.input.detach();
  }, [gl, get, controller]);
  useFrame((state, dt) => controller.frame(state.camera, state.size, dt), -6);
  return null;
}

/** Frame timing, published twice a second for the HUD. */
function PerfProbe() {
  const accRef = useRef({ frames: 0, time: 0, max: 0 });
  useFrame(({ gl }, dt) => {
    const acc = accRef.current;
    acc.frames++;
    acc.time += dt;
    acc.max = Math.max(acc.max, dt);
    if (acc.time < PUBLISH_EVERY) return;
    const s = meadow.stats;
    s.fps = acc.frames / acc.time;
    s.frameMs = (acc.time / acc.frames) * 1000;
    s.frameMaxMs = acc.max * 1000;
    s.physicsMs = perf.physicsMs / acc.frames;
    s.stepMs = perf.steps > 0 ? perf.stepMs / perf.steps : 0;
    s.stepsPerFrame = perf.steps / acc.frames;
    s.calls = gl.info.render.calls;
    s.triangles = gl.info.render.triangles;
    s.dpr = gl.getPixelRatio();
    perf.physicsMs = 0;
    perf.stepMs = 0;
    perf.steps = 0;
    acc.frames = 0;
    acc.time = 0;
    acc.max = 0;
  }, -10);
  return null;
}

export default function MeadowCanvas() {
  const [kind] = useState(readMoverKind);
  const [coarse] = useState(isCoarsePointer);
  const controller = useMemo(() => {
    resetMeadow(kind);
    return new MeadowController();
  }, [kind]);

  return (
    <Canvas
      shadows={SHADOWS}
      dpr={coarse ? [1, 1.75] : [1, 2]}
      gl={GL}
      camera={CAMERA}
      style={STYLE}
    >
      <PerfProbe />
      <Controls controller={controller} />
      <MeadowEnvironment shadowSize={coarse ? 1024 : 2048} />
      <MeadowScene />
      <PlotMarkers />
      <GuideMarkers />
      {kind === "glide" ? (
        <GlideMover />
      ) : (
        <Suspense fallback={null}>
          <PhysicsWorld />
        </Suspense>
      )}
      <CameraRig />
    </Canvas>
  );
}
