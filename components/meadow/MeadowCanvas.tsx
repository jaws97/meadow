"use client";
// The Meadow's WebGL canvas. The page loads it through next/dynamic with ssr:false, so everything here runs only in
// the browser; a default export because that is what next/dynamic's loader resolves.
//
// Movers. The physics Lantern Cart is the default; `?mover=glide` chooses the physics-free glider from the start.
// The physics side lives in its own lazily imported chunk, so the glide path never fetches or boots Rapier. The
// Meadow also falls back to gliding by itself, with a gentle notice and never an error: if Rapier fails to load or
// start (an error boundary round the physics world, and a start-up timeout), if the physics chunk itself fails to
// download (the lazy import catches it and stands in a component that reports the failure, so React never sees a
// ChunkLoadError), or if the frame rate stays under 30 fps for a few seconds with the cart running. The glider draws
// the same Firefly Trolley, so the swap is made in plain sight with nothing to hide: it takes over in the same commit
// that hides the cart, where the cart stands, facing and rolling its way and easing out of its tilt, still on its
// visit or journey if it was on one, and the camera, which only ever follows the live Mover, never jumps. The hidden
// physics world is let go a few frames later, once the glider's trolley has drawn: its materials share the cart's
// shader programs, which unmounting the cart first would have deleted and recompiled mid-ride. One gentle notice says
// the ride is smoother now; a cart that failed before anyone saw it needs none. `?mover=physics` pins the cart for
// testing: no frame-rate or start-up fallback, only a hard failure. The scene, plants, guides and camera are shared
// and only ever talk to whichever Mover is live.
//
// Pixels. The canvas's pixel ratio spends a budget per device class (lib/garden/device), so a high-density laptop
// does not draw four million pixels and a phone keeps its battery; and if the frame rate still sags for a while
// (with the glider, or with the cart pinned) the ratio steps down calmly, never below the class's floor, at a still
// moment and behind a held copy of the last frame, so the picture never blinks or turns soft in front of anyone.
// The party screen (the "bigscreen" class) opens a little further back, so the room sees more of the Meadow.
//
// Quality. One tier per device class (QUALITY): a phone draws the rose, the visited plant and the trolley lite, every
// other class balanced. The movers are handed it, so the cart, and the glider that may replace it, draw the same tier
// as the rest of the scene instead of each guessing from the device.
//
// The plan. The ground plan follows the rings in use (layout.ts): six planned rings, and whole beds more only if
// the Meadow outgrows them, rebuilt under a new key when that happens. The lazy river round the rose's island is drawn
// with the grounds (components/lotus/river/River.tsx, from the plan's river parts), at the device's tier, keeping its
// own clock.
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
import { useOpeningFocus } from "@/components/garden/OpeningMoment";
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
import { GLIDE_NOTICE } from "@/components/meadow/words";
import { River } from "@/components/lotus/river/River";
import { dprForBudget, MIN_DPR, readDevice, type DeviceKind } from "@/lib/garden/device";
import { opening } from "@/lib/garden/opening";
import { ringsToDraw } from "@/lib/server/plots";

interface PhysicsProps {
  onFail: () => void;
  /** The trolley draws the lite tier (see QUALITY). */
  lite: boolean;
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
/** The drawing tier per device class, for the full plants and the trolley. */
type MeadowQuality = "lite" | "balanced";
const QUALITY: Record<DeviceKind, MeadowQuality> = { phone: "lite", tablet: "balanced", laptop: "balanced", bigscreen: "balanced" };
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
/** Frames the glider draws before the hidden physics world (and with it the cart's trolley) is unmounted. */
const RETIRE_FRAMES = 3;

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
 * cart, settling there from the wide view of the island and the river ring. The party screen starts a little further back.
 */
function prepareStart(plot: number | null, device: DeviceKind): void {
  const p = plot === null ? null : plotAt(plot);
  if (p) {
    setStart(p.park.x, p.park.z, tangentYaw(Math.atan2(p.park.z, p.park.x)), false);
    // the cart starts beside it, so this visit simply arrives and the camera comes in on the plant
    meadow.requests.visit = { index: p.index, journey: false };
  } else {
    const s = meadowLayout().spawn;
    // the opening view (CameraRig, openingView.ts): wide on the rose's island and the river ring as the Meadow first
    // shows, behind the quote moment or the plain veil, then settling onto the cart (no glide for reduced motion)
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
function Controls({ controller, fallBack }: { controller: MeadowController; fallBack: () => void }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  useEffect(() => {
    controller.input.attach(gl.domElement);
    // Dev-only handle for probing the live Meadow from the console; `__meadow.fallBack()` rehearses the glide swap.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __meadow?: unknown }).__meadow = { state: get(), get, meadow, controller, data: meadowData, plotAt, ui, fallBack };
    }
    return () => controller.input.detach();
  }, [gl, get, controller, fallBack]);
  useFrame((state, dt) => controller.frame(state.camera, state.size, dt), -6);
  return null;
}

/** Calls `onDone` once, when `frames` frames have been drawn since it mounted. */
function AfterFrames({ frames, onDone }: { frames: number; onDone: () => void }) {
  const left = useRef(frames);
  useFrame(() => {
    if (left.current <= 0) return;
    left.current--;
    if (left.current === 0) onDone();
  });
  return null;
}

/**
 * Frame timing, published twice a second for the HUD; the watch on the physics cart (a reading under 30 fps for
 * four seconds running hands the Meadow to the glider); and, with no cart to drop, the ask for a calm pixel
 * step-down (PixelStep carries it out).
 */
function PerfProbe({ watch, onSlow, onSag }: { watch: boolean; onSlow: () => void; onSag: () => void }) {
  const accRef = useRef({ frames: 0, time: 0, max: 0, first: true, slow: 0, sag: 0, settle: SETTLE_WINDOWS, watch });
  useFrame(({ gl }, dt) => {
    const acc = accRef.current;
    // the glider taking over starts the readings afresh: its first seconds say little about how it will hold up
    if (acc.watch !== watch) {
      acc.watch = watch;
      acc.slow = 0;
      acc.sag = 0;
      acc.settle = SETTLE_WINDOWS;
    }
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
  /** The physics world is mounted: from the start unless gliding, and hidden for RETIRE_FRAMES after a swap. */
  const [physics, setPhysics] = useState(param !== "glide");
  const retire = useCallback(() => setPhysics(false), []);
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

  // The swap in plain sight. The cart stays the live Mover, still driven and still followed by the camera, until the
  // glider replaces it in the commit that hides it (GlideMover picks up the cart's pose and speed then, so nothing
  // goes stale while React renders). The autopilot and any journey carry on: a route is only points, and the
  // autopilot drives whichever Mover it is handed. The handoff is for a cart already gone (an error unmounted it).
  // A failure and a struggling frame rate end the same way: the visitor only feels a gentler ride.
  const fallBack = useCallback(() => {
    if (kindRef.current === "glide") return;
    kindRef.current = "glide";
    const m = meadow.mover;
    if (m) meadow.handoff = { x: m.state.position.x, z: m.state.position.z, yaw: m.state.yaw };
    meadow.moverKind = "glide";
    // a cart that failed before it ever appeared changes nothing for the visitor, and says nothing
    if (m) meadow.notice = { text: GLIDE_NOTICE, at: performance.now() };
    setKind("glide");
  }, []);
  const onFail = fallBack;
  const onSlow = fallBack;
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

  const quality = QUALITY[deviceKind];
  const lite = quality === "lite";
  // the opening (lib/garden/opening): the Meadow comes into focus from a soft blur as the veil lifts on a laptop or a
  // big screen; on a phone (the lite tier) or a tablet the veil's longer fade carries it alone and the compositor does
  // no filtering (a full-screen filter over the live canvas is not measured smooth on their GPUs)
  const focus = useOpeningFocus();
  const roomy = deviceKind === "laptop" || deviceKind === "bigscreen";
  useEffect(() => opening.setSoft(roomy), [roomy]);
  // The Meadow and the physics world do not change with the mover, so their elements are kept: the swap (and the
  // retiring of the physics world three frames later) re-renders only the movers. Re-rendered, the whole Meadow and
  // every collider went through React again, most of a long frame at the swap.
  const scenery = useMemo(
    () => (
      <>
        <MeadowEnvironment shadowSize={phone ? 1024 : 2048} />
        <group key={layoutKey}>
          <MeadowScene layout={layout} shadows={!phone} />
          <River P={layout.river} tier={quality} still={false} shadows={!phone} clock="frame" />
          <Plants layout={layout} shadows={!phone} />
        </group>
        <DaisRose quality={quality} />
        <VisitedPlant quality={quality} />
        <Bursts />
        <Fireflies />
        <GuideMarkers />
      </>
    ),
    [phone, layoutKey, layout, quality],
  );
  const physicsWorld = useMemo(
    () => (
      <PhysicsBoundary onFail={onFail}>
        <Suspense fallback={null}>
          <PhysicsWorld onFail={onFail} lite={lite} />
        </Suspense>
      </PhysicsBoundary>
    ),
    // layoutKey: PhysicsWorld reads the plan as it renders, so a grown Meadow must re-render it for fresh colliders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onFail, lite, layoutKey],
  );
  return (
    <Canvas shadows={SHADOWS} dpr={dpr} gl={GL} camera={CAMERA} style={STYLE} className={focus}>
      <PerfProbe watch={kind === "physics" && auto} onSlow={onSlow} onSag={onSag} />
      <PixelStep askRef={stepAsk} dpr={dpr} next={nextDpr} onStep={onStep} />
      <Controls controller={controller} fallBack={fallBack} />
      {scenery}
      {kind === "glide" && <GlideMover lite={lite} />}
      {physics && <group visible={kind === "physics"}>{physicsWorld}</group>}
      {physics && kind === "glide" && <AfterFrames frames={RETIRE_FRAMES} onDone={retire} />}
      <CameraRig />
    </Canvas>
  );
}
