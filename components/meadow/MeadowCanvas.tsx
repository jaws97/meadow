"use client";
// The Meadow's WebGL canvas. The page loads it through next/dynamic with ssr:false, so everything here runs only in
// the browser; a default export because that is what next/dynamic's loader resolves.
//
// Movers. The physics Lantern Cart is the default; `?mover=glide` chooses the physics-free glider from the start.
// The physics side lives in its own lazily imported chunk, so the glide path never fetches or boots Rapier. The
// Meadow also falls back to gliding by itself, with a gentle notice and never an error: if Rapier fails to load or
// start (an error boundary round the physics world, and a start-up timeout), if the physics chunk itself fails to
// download (the lazy import catches it and stands in a component that reports the failure, so React never sees a
// ChunkLoadError), or if the frame rate stays under 30 fps for a few seconds with the cart running. The glider takes
// over where the cart stood, with the same controls, behind a short warm fade. `?mover=physics` pins the cart for
// testing: no frame-rate or start-up fallback, only a hard failure. The scene, plants, guides and camera are shared
// and only ever talk to whichever Mover is live.
//
// Pixels. The canvas's pixel ratio spends a budget per device class (lib/garden/device), so a high-density laptop
// does not draw four million pixels and a phone keeps its battery; and if the frame rate still sags for a while
// (with the glider, or with the cart pinned) the ratio steps down calmly, never below the class's floor, at a still
// moment and behind a held copy of the last frame, so the picture never blinks or turns soft in front of anyone.
// The party screen (the "bigscreen" class) opens a little further back, so the room sees more of the Meadow.
//
// The plan. The ground plan follows the rings in use (layout.ts): six planned rings, and whole beds more only if
// the Meadow outgrows them, rebuilt under a new key when that happens.
//
// Frame order, by useFrame priority: perf probe (-10), controller (-6), Rapier's stepper and its timer
// (-5.01..-4.99), cart and glider sync (-5..-4.9), camera (-1), guides, sky and sun (-0.5), then R3F renders.
import { addAfterEffect, Canvas, useFrame, useThree, type CanvasProps } from "@react-three/fiber";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import * as THREE from "three";
import { holdFrame, releaseFrame, RESIZE_HOLD } from "@/components/garden/frameHold";
import { Bursts } from "@/components/meadow/Bursts";
import { CameraRig } from "@/components/meadow/CameraRig";
import { MeadowController } from "@/components/meadow/controller";
import { DaisRose } from "@/components/meadow/DaisRose";
import { meadowData } from "@/components/meadow/data";
import { Fireflies } from "@/components/meadow/Fireflies";
import { GlideMover } from "@/components/meadow/GlideMover";
import { GuideMarkers } from "@/components/meadow/GuideMarkers";
import { layoutVersion, meadowLayout, plotAt, setLayoutRings, tangentYaw } from "@/components/meadow/layout";
import { MeadowEnvironment } from "@/components/meadow/MeadowEnvironment";
import { MeadowScene } from "@/components/meadow/MeadowScene";
import type { MoverKind } from "@/components/meadow/mover";
import { Plants } from "@/components/meadow/Plants";
import { meadow, perf, resetMeadow, setStart, setZoom } from "@/components/meadow/runtime";
import { ui } from "@/components/meadow/ui";
import { VisitedPlant } from "@/components/meadow/VisitedPlant";
import { dprForBudget, MIN_DPR, readDevice, type DeviceKind } from "@/lib/garden/device";
import { ringsToDraw } from "@/lib/server/plots";

interface PhysicsProps {
  onFail: () => void;
}

/** Stands in for the physics world when its chunk could not be fetched: reports it, draws nothing. */
function PhysicsUnavailable({ onFail }: PhysicsProps) {
  useEffect(() => onFail(), [onFail]);
  return null;
}

// A failed download (a flaky network, a deploy that replaced the chunk) is caught here, inside the lazy factory:
// React then never sees the error, which no boundary inside the canvas can catch.
const PhysicsWorld = lazy<ComponentType<PhysicsProps>>(() =>
  import("@/components/meadow/PhysicsWorld").then(
    (m) => ({ default: m.default as ComponentType<PhysicsProps> }),
    () => ({ default: PhysicsUnavailable }),
  ),
);

const GL: CanvasProps["gl"] = { antialias: true, powerPreference: "high-performance", alpha: false, stencil: false };
const CAMERA: CanvasProps["camera"] = { fov: 30, near: 0.1, far: 400, position: [20, 12, 20] };
const STYLE: CanvasProps["style"] = { position: "absolute", inset: 0, touchAction: "none" };
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap } as const;
const PUBLISH_EVERY = 0.5;

/**
 * Megapixels of canvas per device class. The Meadow is mostly ground seen from above, so almost all of its cost is
 * per pixel; these hold 60 fps on an office laptop's integrated graphics and keep a phone cool.
 */
const BUDGET: Record<DeviceKind, number> = { phone: 1.0, tablet: 1.5, laptop: 1.6, bigscreen: 2.0 };
/** Under this many frames per second the cart counts as struggling... */
const SLOW_FPS = 30;
/** ...and over this it has recovered (a gap, so a borderline device does not flip on noise). */
const RECOVERED_FPS = 34;
/** Half-second readings in a row under SLOW_FPS before the glider takes over: four seconds. */
const SLOW_WINDOWS = 8;
/** Readings ignored after the cart appears, while shaders and the first physics steps settle. */
const SETTLE_WINDOWS = 6;
/** With no cart left to drop, readings under this for eight seconds step the pixel ratio down. */
const SAG_FPS = 40;
const SAG_WINDOWS = 16;
const DPR_STEPS = [1, 0.85, 0.72] as const;
/**
 * A step waits for the camera to rest this long (moving under STILL_MOVE metres and STILL_TURN radians a frame), or
 * at most STEP_WAIT_MAX_MS for a visitor who never stops; and never comes within STEP_GAP_MS of the last (ms).
 */
const STEP_CALM_MS = 600;
const STILL_MOVE = 0.002;
const STILL_TURN = 0.0005;
const STEP_WAIT_MAX_MS = 45000;
const STEP_GAP_MS = 30000;
/** A physics world that has not produced a cart in this long is treated as failed. */
const START_TIMEOUT_MS = 12000;
/** The warm fade round the cart-to-glider swap: out, then back in once the glider is live (ms). */
const SWAP_FADE_OUT_MS = 160;
const SWAP_FADE_IN_MS = 320;
const SWAP_FADE_MAX_HOLD_MS = 1500;

type FallbackReason = "failed" | "slow";
const NOTICE: Record<FallbackReason, string> = {
  failed: "Gliding today, the cart is resting",
  slow: "Gliding for a smoother ride",
};

function readMoverParam(): MoverKind | "pinned-physics" {
  const p = new URLSearchParams(window.location.search).get("mover");
  return p === "glide" ? "glide" : p === "physics" ? "pinned-physics" : "physics";
}

/** A plot asked for in the address (/meadow?plot=N), the start of a visit. */
function readPlotParam(): number | null {
  const raw = new URLSearchParams(window.location.search).get("plot");
  return raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : null;
}

/**
 * Where the Meadow opens: beside a plant for a /meadow?plot=N link, else on the inner path with the rose behind the
 * cart, after the opening shot. The party screen starts a little further back.
 */
function prepareStart(plot: number | null, device: DeviceKind): void {
  const p = plot === null ? null : plotAt(plot);
  if (p) {
    setStart(p.park.x, p.park.z, tangentYaw(Math.atan2(p.park.z, p.park.x)), false);
    // the cart starts beside it, so this visit simply arrives and the camera comes in on the plant
    meadow.requests.visit = { index: p.index, journey: false };
  } else {
    const s = meadowLayout().spawn;
    setStart(s.x, s.z, s.yaw, true);
  }
  if (device === "bigscreen") setZoom(23);
}

/** Catches Rapier failing to load or initialise, inside the canvas, and hands over to the glider. */
class PhysicsBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Wires the controller to the canvas and runs it before physics each frame. */
function Controls({ controller }: { controller: MeadowController }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  useEffect(() => {
    controller.input.attach(gl.domElement);
    // Dev-only handle for probing the live Meadow from the console.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __meadow?: unknown }).__meadow = { state: get(), get, meadow, controller, data: meadowData, plotAt, ui };
    }
    return () => controller.input.detach();
  }, [gl, get, controller]);
  useFrame((state, dt) => controller.frame(state.camera, state.size, dt), -6);
  return null;
}

/**
 * Frame timing, published twice a second for the HUD; the watch on the physics cart (a reading under 30 fps for
 * four seconds running hands the Meadow to the glider); and, with no cart to drop, the ask for a calm pixel
 * step-down (PixelStep carries it out).
 */
function PerfProbe({ watch, onSlow, onSag }: { watch: boolean; onSlow: () => void; onSag: () => void }) {
  const accRef = useRef({ frames: 0, time: 0, max: 0, first: true, slow: 0, sag: 0, settle: SETTLE_WINDOWS });
  useFrame(({ gl }, dt) => {
    const acc = accRef.current;
    if (acc.first) {
      acc.first = false;
      try {
        performance.mark("meadow:first-frame");
      } catch {
        // marks are a measuring aid only
      }
    }
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
    // A hidden tab, a Meadow still loading, or the first seconds say nothing about the device.
    if (s.loading || document.hidden) {
      acc.slow = 0;
      acc.sag = 0;
      return;
    }
    if (acc.settle > 0) {
      acc.settle--;
      return;
    }
    if (watch) {
      if (s.fps < SLOW_FPS) acc.slow++;
      else if (s.fps > RECOVERED_FPS) acc.slow = 0;
      if (acc.slow >= SLOW_WINDOWS) {
        acc.slow = 0;
        onSlow();
      }
      return;
    }
    if (s.fps < SAG_FPS) acc.sag++;
    else acc.sag = 0;
    if (acc.sag >= SAG_WINDOWS) {
      acc.sag = 0;
      onSag();
    }
  }, -10);
  return null;
}

/**
 * The pixel step-down, out of sight. A new pixel ratio resizes the canvas, which clears its drawing buffer, and
 * drawn in the open it softens the whole picture at once; so a step asked for (`askRef`) waits for the camera to rest,
 * copies the frame just drawn over the canvas (components/garden/frameHold), steps underneath, and dissolves the
 * copy once a few frames are drawn at the new ratio. An ask that would change nothing (the class's floor already
 * reached) or comes within the gap of the last step is dropped; PerfProbe asks again if the sag goes on.
 */
function PixelStep({ askRef, dpr, next, onStep }: { askRef: RefObject<boolean>; dpr: number; next: number; onStep: () => void }) {
  const ref = useRef({
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    restFrom: -1,
    askedAt: -1,
    stepAt: -Infinity,
    /** The step being drawn behind the still: the ratio it waits for, since when, and frames drawn at it. */
    hold: null as { dpr: number; at: number; frames: number } | null,
  });
  useFrame(({ gl, camera }) => {
    const s = ref.current;
    const now = performance.now();
    const moved = s.pos.distanceTo(camera.position) > STILL_MOVE || s.quat.angleTo(camera.quaternion) > STILL_TURN;
    s.pos.copy(camera.position);
    s.quat.copy(camera.quaternion);
    if (moved) s.restFrom = -1;
    else if (s.restFrom < 0) s.restFrom = now;

    const h = s.hold;
    if (h) {
      if (Math.abs(gl.getPixelRatio() - h.dpr) < 1e-6) h.frames++;
      if (h.frames >= RESIZE_HOLD.frames || now - h.at > RESIZE_HOLD.maxMs) {
        s.hold = null;
        releaseFrame(RESIZE_HOLD.dissolveMs);
      }
      return;
    }
    if (!askRef.current) {
      s.askedAt = -1;
      return;
    }
    if (next >= dpr || now - s.stepAt < STEP_GAP_MS) {
      askRef.current = false;
      return;
    }
    if (s.askedAt < 0) s.askedAt = now;
    const resting = s.restFrom >= 0 && now - s.restFrom >= STEP_CALM_MS;
    if (!resting && now - s.askedAt < STEP_WAIT_MAX_MS) return;
    askRef.current = false;
    s.stepAt = now;
    // Once this frame is drawn (the still is copied in the task that drew it), React applies the new ratio before
    // the next frame.
    const off = addAfterEffect(() => {
      off();
      if (holdFrame(gl.domElement)) ref.current.hold = { dpr: next, at: performance.now(), frames: 0 };
      onStep();
    });
  }, -10);
  return null;
}

/**
 * Runs the warm veil (meadow.fade, drawn by DevHud's FadeVeil) round a swap: a quick fade out, the swap, then a
 * fade back in once the new mover is live (or after a short wait, whatever happens).
 */
function fadeAround(swap: () => void) {
  const start = performance.now();
  let swappedAt = -1;
  let inFrom = -1;
  const tick = () => {
    const now = performance.now();
    if (swappedAt < 0) {
      meadow.fade = Math.min(1, (now - start) / SWAP_FADE_OUT_MS);
      if (meadow.fade >= 1) {
        swap();
        swappedAt = now;
      }
    } else if (inFrom < 0) {
      meadow.fade = 1;
      if ((meadow.mover && !meadow.stats.loading) || now - swappedAt > SWAP_FADE_MAX_HOLD_MS) inFrom = now;
    } else {
      meadow.fade = Math.max(0, 1 - (now - inFrom) / SWAP_FADE_IN_MS);
      if (meadow.fade <= 0) return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The pixel ratio that spends this device's budget on the window at step `step`, and the one the next step down
 * would give, kept current through resizes and rotation.
 */
function useBudgetDpr(step: number): { dpr: number; next: number; kind: DeviceKind } {
  const device = useMemo(() => readDevice(), []);
  const read = useCallback(
    (s: number) =>
      dprForBudget(
        BUDGET[device.kind] * DPR_STEPS[Math.min(DPR_STEPS.length - 1, s)] ** 2,
        window.innerWidth,
        window.innerHeight,
        window.devicePixelRatio || 1,
        MIN_DPR[device.kind],
      ),
    [device],
  );
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // re-read on every resize (and rotation) and every step down
  const dpr = useMemo(() => (resized >= 0 ? read(step) : 1), [read, resized, step]);
  const next = useMemo(() => (resized >= 0 ? read(step + 1) : 1), [read, resized, step]);
  return { dpr, next, kind: device.kind };
}

/** Grows the plan when the snapshot reaches past the rings drawn; returns the plan's version for keys. */
function useLayoutVersion(): number {
  const [version, setVersion] = useState(layoutVersion);
  useEffect(() => {
    const check = () => {
      if (setLayoutRings(ringsToDraw(meadowData.get().highest))) setVersion(layoutVersion());
    };
    check();
    return meadowData.subscribe(check);
  }, []);
  return version;
}

export default function MeadowCanvas() {
  const [param] = useState(readMoverParam);
  const [kind, setKind] = useState<MoverKind>(param === "glide" ? "glide" : "physics");
  const kindRef = useRef(kind);
  const [dprStep, setDprStep] = useState(0);
  const { dpr, next: nextDpr, kind: deviceKind } = useBudgetDpr(dprStep);
  const stepAsk = useRef(false);
  const phone = deviceKind === "phone";
  const layoutKey = useLayoutVersion();
  const layout = meadowLayout();
  const controller = useMemo(() => {
    resetMeadow(param === "glide" ? "glide" : "physics");
    prepareStart(readPlotParam(), deviceKind);
    return new MeadowController();
  }, [param, deviceKind]);

  const fallBack = useCallback(
    (reason: FallbackReason) => {
      if (kindRef.current === "glide") return;
      kindRef.current = "glide";
      const swap = () => {
        const m = meadow.mover;
        if (m) meadow.handoff = { x: m.state.position.x, z: m.state.position.z, yaw: m.state.yaw };
        controller.autopilot.cancel();
        meadow.mover = null;
        meadow.moverKind = "glide";
        meadow.mode = "idle";
        meadow.journey = false;
        meadow.stats.loading = true;
        meadow.notice = { text: NOTICE[reason], at: performance.now() };
        setKind("glide");
      };
      // A cart on screen fades out and the glider fades in where it stood; with no cart yet there is nothing to hide.
      if (meadow.mover) fadeAround(swap);
      else swap();
    },
    [controller],
  );
  const onFail = useCallback(() => fallBack("failed"), [fallBack]);
  const onSlow = useCallback(() => fallBack("slow"), [fallBack]);
  const onSag = useCallback(() => {
    stepAsk.current = true;
  }, []);
  const onStep = useCallback(() => setDprStep((s) => Math.min(DPR_STEPS.length - 1, s + 1)), []);
  const auto = param === "physics";

  // Rapier that never finishes starting (a stalled WASM fetch) counts as failed.
  useEffect(() => {
    if (kind !== "physics" || !auto) return;
    const id = window.setTimeout(() => {
      if (!meadow.mover) onFail();
    }, START_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [kind, auto, onFail]);

  const plantQuality = phone ? "lite" : "balanced";
  return (
    <Canvas shadows={SHADOWS} dpr={dpr} gl={GL} camera={CAMERA} style={STYLE}>
      <PerfProbe watch={kind === "physics" && auto} onSlow={onSlow} onSag={onSag} />
      <PixelStep askRef={stepAsk} dpr={dpr} next={nextDpr} onStep={onStep} />
      <Controls controller={controller} />
      <MeadowEnvironment shadowSize={phone ? 1024 : 2048} />
      <group key={layoutKey}>
        <MeadowScene layout={layout} shadows={!phone} />
        <Plants layout={layout} shadows={!phone} />
      </group>
      <DaisRose quality={plantQuality} />
      <VisitedPlant quality={plantQuality} />
      <Bursts />
      <Fireflies />
      <GuideMarkers />
      {kind === "glide" ? (
        <GlideMover />
      ) : (
        <PhysicsBoundary onFail={onFail}>
          <Suspense fallback={null}>
            <PhysicsWorld onFail={onFail} />
          </Suspense>
        </PhysicsBoundary>
      )}
      <CameraRig />
    </Canvas>
  );
}
