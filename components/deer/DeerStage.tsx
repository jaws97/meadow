"use client";
// The /deer-concepts stage: the owner's own flower garden (the garden page's canvas settings, scene and post chain, a
// grown rose in the bed) with the doe visiting it, for sign-off before anything is built into the product. The address
// sets everything: ?act=tour (the visit: in through the left corridor, graze, look, browse, out under the arch),
// stand, graze, browse or walk; ?view=garden (the garden's own camera, as a visitor sees it), side (following her
// side-on from about 2.8 m) or close (three-quarters, 1.7 m); ?time=dawn, morning, noon, golden or dusk; and the
// garden's own ?quality=lite|balanced|cinematic; ?deer=0 leaves her out, to measure what she costs. In the side and
// close views the depth of field focuses on her.
// Loaded in the browser only (DeerConcepts.tsx), so the address is read once, before the canvas mounts, and the
// garden store gets the hour first so the opening compiles the right light set. A default export for next/dynamic.
import { Canvas, useFrame, type CanvasProps } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useState } from "react";
import * as THREE from "three";
import { Atmosphere } from "@/components/garden/Atmosphere";
import { Backdrop } from "@/components/garden/Backdrop";
import { CameraRig } from "@/components/garden/CameraRig";
import { Clock } from "@/components/garden/Clock";
import { Effects } from "@/components/garden/Effects";
import { FarWoods } from "@/components/garden/FarWoods";
import { Garden } from "@/components/garden/Garden";
import { Ground } from "@/components/garden/Ground";
import { SceneLighting, TierLights } from "@/components/garden/Lights";
import { Plant } from "@/components/garden/Plant";
import { Opening, RenderGovernor } from "@/components/garden/RenderBudget";
import { SkyDome } from "@/components/garden/SkyDome";
import { TierLayers } from "@/components/garden/TierLayers";
import { Doe, doeHandle } from "@/components/deer/Doe";
import type { Act } from "@/components/deer/tour";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { quality, useQuality, type Phase } from "@/lib/garden/quality";
import { garden, useGarden } from "@/lib/garden/store";

type View = "garden" | "side" | "close";
type Time = "dawn" | "morning" | "noon" | "golden" | "dusk";

const ACTS: readonly Act[] = ["tour", "stand", "graze", "browse", "walk"];
const VIEWS: readonly View[] = ["garden", "side", "close"];
const TIMES: readonly Time[] = ["dawn", "morning", "noon", "golden", "dusk"];
/** Bangalore hours (the development panel's golden hour and dusk). */
const HOURS: Record<Time, number> = { dawn: 6.45, morning: 8.0, noon: 12, golden: 17.6, dusk: 18.2 };

const TRANSMISSION_SCALE = 0.5;
const GL: CanvasProps["gl"] = { antialias: false, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 32, near: 0.05, far: 80, position: [0, 0.95, 2.9] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0 };
// three r186 has no PCFSoftShadowMap; asking for it breaks the shadow samplers (see GardenCanvas).
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;
const stopped = (p: Phase) => p === "boot" || p === "compiling";

function pick<T extends string>(value: string | null, list: readonly T[], fallback: T): T {
  return value && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

const search = typeof window === "undefined" ? "" : window.location.search;
const q = new URLSearchParams(search);
const PARAMS = {
  act: pick(q.get("act"), ACTS, "tour"),
  view: pick(q.get("view"), VIEWS, "garden"),
  time: pick(q.get("time"), TIMES, "golden"),
  ui: q.get("ui") !== "0",
  /** ?deer=0 leaves her out, to measure what she costs against the same garden */
  deer: q.get("deer") !== "0",
};

if (typeof window !== "undefined") {
  garden.set({
    speciesId: "rose",
    seed: "Lijas",
    growth: 1,
    bloom: 1,
    health: 1,
    moisture: 0.55,
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
    wind: 0.4,
    hour: HOURS[PARAMS.time],
    autoClock: false,
    cloud: 0.15,
    rain: 0,
  });
}

/** Where she looks when she lifts her head: toward the flower and the camera beyond it. */
const LOOK = new THREE.Vector3(0.2, 1.0, 1.5);

const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
const want = new THREE.Vector3();
const head = new THREE.Vector3();

/** Follows the doe: side-on from the front of the garden, or three-quarters from ahead of her; focus on her head. */
function FollowCam({ view }: { view: Exclude<View, "garden"> }) {
  useFrame((state, delta) => {
    const doe = doeHandle.anim;
    const mesh = doeHandle.mesh;
    if (!doe || !mesh) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const x = doe.pos.x;
    const z = doe.pos.y;
    const h = doe.heading;
    if (view === "side") {
      want.set(x - 0.1, 0.72, z + 2.8);
      camAim.set(x - 0.05, 0.55, z);
    } else {
      // three-quarters from ahead and to the camera's side of her
      const fx = Math.cos(h);
      const fz = -Math.sin(h);
      want.set(x + fx * 1.15 + 0.85, 0.78, z + fz * 1.15 + 1.25);
      camAim.set(x + fx * 0.25, 0.68, z + fz * 0.25);
    }
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.5);
    if (camPos.lengthSq() === 0) camPos.copy(want);
    else camPos.lerp(want, k);
    cam.position.copy(camPos);
    cam.lookAt(camAim);
    if (cam.fov !== 34) {
      cam.fov = 34;
      cam.updateProjectionMatrix();
    }
    // the depth of field focuses on her head
    const headBone = doe.bones[7];
    headBone.getWorldPosition(head);
    env.headPos.copy(head);
  });
  return null;
}

function DeerScene() {
  return (
    <>
      <Clock />
      <SkyDome />
      <SceneLighting />
      <TierLayers>
        <TierLights />
        <Ground />
        <Garden />
        <Backdrop />
        <group position-y={HERO_GROUND_Y}>
          <Plant />
        </group>
        <Atmosphere />
        {PARAMS.deer ? <Doe act={PARAMS.act} lookAt={LOOK} /> : null}
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      </TierLayers>
      <FarWoods />
      {PARAMS.view === "garden" ? <CameraRig /> : <FollowCam view={PARAMS.view} />}
    </>
  );
}

function link(patch: Partial<Record<"act" | "view" | "time" | "quality", string>>): string {
  const next = new URLSearchParams(search);
  for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
  return `?${next.toString()}`;
}

function Chips<T extends string>({ label, list, current, k }: { label: string; list: readonly T[]; current: string; k: "act" | "view" | "time" | "quality" }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-12 text-[rgba(246,234,214,0.55)]">{label}</span>
      {list.map((v) => (
        <a
          key={v}
          href={link({ [k]: v })}
          className={`rounded-full px-2 py-0.5 ${v === current ? "bg-[rgba(246,234,214,0.9)] text-[#1a130c]" : "bg-[rgba(246,234,214,0.12)] text-[rgba(246,234,214,0.85)]"}`}
        >
          {v}
        </a>
      ))}
    </div>
  );
}

export default function DeerStage() {
  const dpr = useQuality((s) => s.dpr);
  const phase = useQuality((s) => s.phase);
  const tier = useGarden((s) => s.quality);
  const [triangles, setTriangles] = useState(0);

  useLayoutEffect(() => {
    if (quality.get().phase === "boot") quality.set({ phase: "compiling" });
    const t = window.setInterval(() => setTriangles(doeHandle.triangles), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main className="fixed inset-0 bg-[#06080f]">
      <Canvas
        shadows={SHADOWS}
        dpr={dpr}
        frameloop={stopped(phase) ? "never" : "always"}
        gl={GL}
        camera={CAMERA}
        style={STYLE}
        onCreated={(state) => {
          state.gl.transmissionResolutionScale = TRANSMISSION_SCALE;
          const w = window as unknown as { __garden?: unknown; __gardenStore?: unknown; __gardenEnv?: unknown; __doe?: unknown };
          w.__garden = state;
          w.__gardenStore = garden;
          w.__gardenEnv = env;
          w.__doe = doeHandle;
        }}
      >
        <RenderGovernor />
        <Suspense fallback={null}>
          <DeerScene />
          <Opening />
        </Suspense>
      </Canvas>
      {stopped(phase) ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 text-center text-[12px] tracking-wide text-[rgba(246,234,214,0.6)]">Compiling the garden…</div>
      ) : null}
      {PARAMS.ui ? (
        <div className="fixed left-3 top-3 flex max-w-[calc(100vw-24px)] flex-col gap-1.5 rounded-xl bg-[rgba(10,8,6,0.55)] p-3 text-[11px] text-[rgba(246,234,214,0.9)] backdrop-blur-sm">
          <div className="text-[12px] font-medium">Chital doe · concept</div>
          <Chips label="act" list={ACTS} current={PARAMS.act} k="act" />
          <Chips label="view" list={VIEWS} current={PARAMS.view} k="view" />
          <Chips label="time" list={TIMES} current={PARAMS.time} k="time" />
          <Chips label="tier" list={["lite", "balanced", "cinematic"] as const} current={tier} k="quality" />
          <div className="text-[rgba(246,234,214,0.55)]">{triangles ? `${triangles.toLocaleString()} triangles` : ""}</div>
        </div>
      ) : null}
    </main>
  );
}
