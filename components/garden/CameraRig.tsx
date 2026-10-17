"use client";
// The garden camera. It opens on the layout's framing for the screen's shape
// (LAYOUT.camera.framings, blended by aspect ratio): on a tall phone close
// enough that the bed fills the width, the lantern at the left edge and the
// bloom on the upper third line, low enough that the horizon sits behind the
// hedges; on an iPad in either orientation and on a laptop the
// composed garden round the hero; on 16:9 and wider the lens narrows
// vertically rather than letting the view run out past the hedges. The orbit
// target eases up the flower as it grows, and the
// camera dollies in and out with it at the same viewing angle, so a hand-high
// seedling fills about a third of the frame just as the full bloom fills its
// share: the owner's plant is the subject at every stage of its fortnight. A
// zoom by the viewer is kept as a share of that distance. Left alone, the camera drifts a
// little, as if handheld on a slow dolly; any touch of the controls pauses the
// drift, which eases back in a few seconds after the last gesture.
// OrbitControls stays live so the viewer can lean right in to the flower:
// a drag (mouse, trackpad or one finger) orbits, the wheel, a trackpad pinch
// or two fingers zoom.
// When the care layer covers part of the screen (its card along a phone's
// bottom edge, its narrow panel beside a phone held sideways; the store's
// dock), the lens shifts (setViewOffset) so the plant stands in the open part
// of the view, easing up as the card grows for a question and back as it
// shrinks. The framing itself is untouched, and with nothing docked there is
// no shift at all.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";
import { garden } from "@/lib/garden/store";
import { lerp, smoothstep } from "@/lib/plant/prng";

type Controls = ComponentRef<typeof OrbitControls>;

/** Aspect ratios are rounded to this step, so a window resize does not re-frame every pixel. */
const ASPECT_STEP = 0.02;

const TARGET = LAYOUT.camera.target;
const TARGET_MIN = 0.2;
const TARGET_MAX = 1.0;
const EASE_RATE = 1.5;
const MIN_DISTANCE = 0.8;
const MAX_DISTANCE = 7;
const MIN_POLAR = 0.75;
/**
 * The garden is dressed as a room for a camera on +z: hedges, the fence and
 * the trees close it off behind and to the sides. Past about 40 degrees
 * either way the view runs out past the hedges onto open lawn and the hills,
 * and the garden reads as a stage flat, so the orbit stops there.
 */
const MAX_AZIMUTH = 0.7;
/**
 * The dolly: the framing distances in LAYOUT.camera are for a plant this tall
 * (head above the mulch, metres). The distance scales as (height + pad), so
 * a 20 cm seedling is framed from about a quarter of the way in.
 */
const FULL_HEIGHT = 1.12;
const DOLLY_PAD = 0.12;
const DOLLY_MIN = 0.2;
const DOLLY_MAX = 1.1;
/** How quickly the dolly follows the plant, per second; slow, like a crane move. */
const DOLLY_RATE = 1.2;
/**
 * Close in on a young plant the camera also rises a little, to look down on
 * it in its bed (about 20 degrees) rather than across the mulch at stem
 * height; from about half height it is back on the layout's own angle. Only
 * until the viewer first moves the camera: after that their angle is kept.
 */
const CLOSE_ELEVATION = THREE.MathUtils.degToRad(20);
/** Lowest the camera may sit above the lawn, whatever the distance and target. */
const CAMERA_FLOOR = 0.12;
// The camera sits at target.y + distance * cos(polar), so the tilt may pass the
// horizon only as far as the lowest target and the longest distance allow;
// beyond that the camera drops under the single-sided ground disc.
const MAX_POLAR = Math.acos((CAMERA_FLOOR - TARGET_MIN) / MAX_DISTANCE);

/** Idle drift: a slow wander, in radians of orbit and metres of height. */
const DRIFT_YAW = 0.05;
const DRIFT_LIFT = 0.035;
/** seconds for one full wander */
const DRIFT_PERIOD = 28;
/** seconds after the last gesture before the drift eases back in */
const DRIFT_RESUME_AFTER = 5;
/** seconds the drift takes to ease back to full strength */
const DRIFT_EASE = 5;

/**
 * The lens shift for a docked care layer: the plant (head to foot) is centred
 * in the open part of the view, its head kept below the name pill, at this
 * rate per second; under half a pixel it is cleared.
 */
const LENS_RATE = 2.2;
const LENS_TOP = 0.11;
const LENS_TOP_MAX = 96;
const LENS_GAP = 12;

const UP = new THREE.Vector3(0, 1, 0);
const offset = new THREE.Vector3();
const prevTarget = new THREE.Vector3();
const driftLift = new THREE.Vector3();
const lensHead = new THREE.Vector3();
const lensFoot = new THREE.Vector3();

interface Drift {
  /** drift currently applied to the camera, so each frame moves it by the difference */
  yaw: number;
  lift: number;
  interacting: boolean;
  lastGesture: number;
  /** the viewer's own zoom, as a share of the dolly's distance for the plant's height */
  zoom: number;
}

/**
 * How far the framing has come from the close-up of a young plant (0) to
 * the layout's own composition round the full-grown one (1), by the dolly.
 */
function framingBlend(headY: number): number {
  return smoothstep(0.28, 0.62, dollyRatio(Math.max(0, headY - HERO_GROUND_Y)));
}

/**
 * The orbit target's height for a head at `headY` in framing `f`: the
 * layout's rule (a share of the head's height) for a grown plant, and about
 * two thirds of the way up the plant for a young one, so a seedling sits in
 * the middle of its close-up rather than at the foot of the frame.
 */
function targetY(headY: number, f: Framing): number {
  const young = HERO_GROUND_Y + 0.62 * Math.max(0, headY - HERO_GROUND_Y) + 0.03;
  const y = lerp(young, headY * f.targetRise + f.targetLift, framingBlend(headY));
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, y));
}

/**
 * The target's depth: the layout aims a little behind the hero (into the
 * bed) for the full composition; a close-up of a young plant aims at the plant.
 */
function targetZ(headY: number): number {
  return lerp(LAYOUT.hero[2], TARGET[2], framingBlend(headY));
}

/** The dolly's share of the framing distance for a plant whose head stands `h` above the mulch. */
function dollyRatio(h: number): number {
  return Math.min(DOLLY_MAX, Math.max(DOLLY_MIN, (h + DOLLY_PAD) / (FULL_HEIGHT + DOLLY_PAD)));
}

/** The camera's offset from the target for the full-grown plant in framing `f`. */
function framingOffset(f: Framing, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.cos(f.elevation) * f.distance;
  return out.set(Math.sin(f.azimuth) * flat, Math.sin(f.elevation) * f.distance, Math.cos(f.azimuth) * flat);
}

/**
 * Eases the lens shift (CSS px, content moved left and up) toward keeping the plant in the part of the view the care
 * layer leaves open: head to foot centred above a bottom card, the head kept clear of the name pill; centred left of
 * a narrow side panel. Nothing docked, and once the shift has eased away, the view offset is cleared.
 */
function shiftLens(camera: THREE.Camera, L: { x: number; y: number }, width: number, height: number, dt: number) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  const { dockBottom, dockRight } = garden.get();
  let wantX = 0;
  let wantY = 0;
  if ((dockBottom > 0 || dockRight > 0) && width > 0 && height > 0) {
    camera.updateMatrixWorld();
    // where the head and the plant's foot fall without the shift (it moves the picture by whole pixels: ndc + 2 px / size)
    lensHead.copy(env.headPos).project(camera);
    lensFoot.set(env.headPos.x, HERO_GROUND_Y, env.headPos.z).project(camera);
    const headY = ((1 - (lensHead.y - (2 * L.y) / height)) / 2) * height;
    const footY = ((1 - (lensFoot.y - (2 * L.y) / height)) / 2) * height;
    if (dockBottom > 0) {
      const top = Math.min(LENS_TOP_MAX, height * LENS_TOP);
      const open = (top + height - dockBottom - LENS_GAP) / 2;
      // up only, and never so far that the head goes under the name pill
      wantY = Math.min(Math.max(0, (headY + footY) / 2 - open), Math.max(0, headY - top));
    }
    if (dockRight > 0) {
      const plantX = ((lensHead.x + (2 * L.x) / width + 1) / 2) * width;
      wantX = Math.max(0, plantX - (width - dockRight) / 2);
    }
  }
  const k = 1 - Math.exp(-dt * LENS_RATE);
  L.x += (wantX - L.x) * k;
  L.y += (wantY - L.y) * k;
  if (wantX === 0 && wantY === 0 && Math.abs(L.x) < 0.5 && Math.abs(L.y) < 0.5) {
    L.x = 0;
    L.y = 0;
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(width, height, L.x, L.y, width, height);
}

export function CameraRig() {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const drift = useRef<Drift>({ yaw: 0, lift: 0, interacting: false, lastGesture: -Infinity, zoom: 1 });
  /** the lens shift now applied, CSS px: content moved left (x) and up (y) */
  const lens = useRef({ x: 0, y: 0 });
  const aspect = Math.round(width / Math.max(1, height) / ASPECT_STEP) * ASPECT_STEP;
  const framing = useMemo(() => framingFor(aspect), [aspect]);
  // Read by the frame loop; written here so a resize is picked up without a re-subscription.
  const live = useRef(framing);
  useLayoutEffect(() => {
    live.current = framing;
  }, [framing]);

  // Open on the framing for this screen's shape, and re-frame when the phone
  // turns or the window changes shape, unless the viewer has already moved
  // the camera themselves. The framing is a direction and distance from the
  // full-grown plant's target, applied to wherever the target now rides, so a
  // re-frame on a young plant keeps the authored angle; the dolly then sets the distance.
  useLayoutEffect(() => {
    if (drift.current.lastGesture !== -Infinity || drift.current.interacting) return;
    framingOffset(framing, offset);
    const c = controls.current;
    if (c) {
      camera.position.copy(c.target).add(offset);
      c.update();
    } else {
      const ty = targetY(HERO_GROUND_Y + FULL_HEIGHT, framing);
      camera.position.set(TARGET[0] + offset.x, ty + offset.y, TARGET[2] + offset.z);
      camera.lookAt(TARGET[0], ty, TARGET[2]);
    }
  }, [camera, framing]);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (Math.abs(camera.fov - framing.fov) > 0.01) {
      // eslint-disable-next-line react-hooks/immutability -- the camera is a three.js object, configured imperatively
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, framing]);

  // A gesture takes over the camera wherever the drift has left it: the drift
  // is forgotten rather than unwound, so nothing snaps under the hand.
  const onStart = useCallback(() => {
    const d = drift.current;
    d.yaw = 0;
    d.lift = 0;
    d.interacting = true;
  }, []);
  const onEnd = useCallback(() => {
    const d = drift.current;
    d.interacting = false;
    d.lastGesture = env.time;
    // Keep the viewer's zoom as a share of the dolly, so the plant keeps its size in frame as it grows.
    const c = controls.current;
    if (c) {
      const auto = live.current.distance * dollyRatio(Math.max(0, env.headPos.y - HERO_GROUND_Y));
      d.zoom = Math.min(3, Math.max(0.3, camera.position.distanceTo(c.target) / auto));
    }
  }, [camera]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * EASE_RATE);
    const f = live.current;
    const d = drift.current;
    prevTarget.copy(c.target);
    c.target.x += (lerp(LAYOUT.hero[0], TARGET[0], framingBlend(env.headPos.y)) - c.target.x) * k;
    c.target.z += (targetZ(env.headPos.y) - c.target.z) * k;
    c.target.y += (targetY(env.headPos.y, f) - c.target.y) * k;

    if (!d.interacting) {
      // Carry the camera with the target and ease its distance toward the
      // dolly's, keeping the direction it looks from: the framing angle holds
      // from seedling to bloom, and an orbit the viewer chose is respected.
      const h = Math.max(0, env.headPos.y - HERO_GROUND_Y);
      const ratio = dollyRatio(h);
      const want = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE + 0.05, f.distance * ratio * d.zoom));
      const ease = 1 - Math.exp(-dt * DOLLY_RATE);
      offset.copy(camera.position).sub(prevTarget).sub(driftLift.set(0, d.lift, 0));
      const dist = offset.length() || want;
      const next = dist + (want - dist) * ease;
      if (d.lastGesture === -Infinity) {
        const flat = Math.hypot(offset.x, offset.z) || 1e-6;
        const elev = Math.atan2(offset.y, flat);
        const goal = lerp(CLOSE_ELEVATION, f.elevation, smoothstep(0.28, 0.62, ratio));
        const e = elev + (goal - elev) * ease;
        const k = (Math.cos(e) * next) / flat;
        offset.set(offset.x * k, Math.sin(e) * next, offset.z * k);
      } else {
        offset.multiplyScalar(next / dist);
      }
      camera.position.copy(c.target).add(offset).add(driftLift);
    }

    const t = env.time;
    const idle = d.interacting ? 0 : smoothstep(DRIFT_RESUME_AFTER, DRIFT_RESUME_AFTER + DRIFT_EASE, t - d.lastGesture);
    const phase = (t / DRIFT_PERIOD) * Math.PI * 2;
    const wantYaw = Math.sin(phase) * DRIFT_YAW * idle;
    // the handheld bob shrinks with the dolly, so a close seedling shot does not bob out of frame
    const reach = Math.min(1, Math.max(0.3, camera.position.distanceTo(c.target) / f.distance));
    const wantLift = Math.sin(phase * 2 + 1.1) * DRIFT_LIFT * idle * reach;
    const dYaw = wantYaw - d.yaw;
    const dLift = wantLift - d.lift;
    d.yaw = wantYaw;
    d.lift = wantLift;
    if (dYaw !== 0 || dLift !== 0) {
      // OrbitControls rebuilds its spherical from the camera each update, so a
      // direct move of the camera about the target is kept, not fought.
      offset.copy(camera.position).sub(c.target);
      offset.applyAxisAngle(UP, dYaw);
      offset.y += dLift;
      camera.position.copy(c.target).add(offset);
    }

    shiftLens(camera, lens.current, width, height, dt);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[TARGET[0], targetY(HERO_GROUND_Y + FULL_HEIGHT, framing), TARGET[2]]}
      enablePan={false}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      minAzimuthAngle={-MAX_AZIMUTH}
      maxAzimuthAngle={MAX_AZIMUTH}
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.6}
      zoomSpeed={0.7}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}
