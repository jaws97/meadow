"use client";
// The garden camera. It opens on the layout's framing for the screen's shape:
// on a landscape screen the hero just above the middle with the bed, path,
// lantern and arch round it; on a portrait phone closer in on a longer lens,
// the bloom on the upper third line and the bed and its kerb filling the
// lower half. The orbit target eases up the flower as it grows, and the
// camera dollies in and out with it at the same viewing angle, so a hand-high
// seedling fills about a third of the frame just as the full bloom fills its
// share: the owner's plant is the subject at every stage of its fortnight. A
// zoom by the viewer is kept as a share of that distance. Left alone, the camera drifts a
// little, as if handheld on a slow dolly; any touch of the controls pauses the
// drift, which eases back in a few seconds after the last gesture.
// OrbitControls stays live so the viewer can lean right in to the flower.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { lerp, smoothstep } from "@/lib/plant/prng";

type Controls = ComponentRef<typeof OrbitControls>;

/**
 * Vertical field of view on a landscape screen: at 42° a metre-high plant
 * fills a little under half the frame from three and a half metres, with the
 * bed at its feet and the hedges and the foot of the canopies behind it.
 */
const FOV = 42;
/**
 * On a portrait screen the lens opens only until this much shows from side
 * to side, and never past MAX_FOV vertically: widening further would push the
 * hero back into a sliver of a frame full of sky and lawn. The camera moves in
 * instead (LAYOUT.camera.portrait), so the bed is wider than the frame and
 * runs off both sides, the way a close garden photograph is cropped.
 */
const MIN_HFOV = THREE.MathUtils.degToRad(22);
const MAX_FOV = 50;
/** Aspect ratios across which the framing blends from portrait (below) to landscape (above). */
const PORTRAIT_ASPECT = 0.62;
const LANDSCAPE_ASPECT = 1.05;

const CAM = LAYOUT.camera;
const TARGET = CAM.target;
const TARGET_MIN = 0.2;
const TARGET_MAX = 1.0;
/** On a portrait screen the target sits a little toward the head's side, which centres the bloom. */
const PORTRAIT_TARGET_X = 0.1;
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

const UP = new THREE.Vector3(0, 1, 0);
const offset = new THREE.Vector3();
const prevTarget = new THREE.Vector3();
const driftLift = new THREE.Vector3();

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
 * The orbit target's height for a head at `headY`, on the framing blend `p`:
 * the layout's rule (a share of the head's height) for a grown plant, and
 * about two thirds of the way up the plant for a young one, so a seedling
 * sits in the middle of its close-up rather than at the foot of the frame.
 */
function targetY(headY: number, p: number): number {
  const rise = lerp(CAM.targetRise, CAM.portrait.targetRise, p);
  const lift = lerp(CAM.targetLift, CAM.portrait.targetLift, p);
  const young = HERO_GROUND_Y + 0.62 * Math.max(0, headY - HERO_GROUND_Y) + 0.03;
  const y = lerp(young, headY * rise + lift, framingBlend(headY));
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, y));
}

/**
 * The target's depth: the layout aims a little behind the hero (into the
 * bed) for the full composition; a close-up of a young plant aims at the plant.
 */
function targetZ(headY: number): number {
  return lerp(LAYOUT.hero[2], TARGET[2], framingBlend(headY));
}

/** The layout's camera distance on the framing blend `p`, for a full-grown plant. */
function framingDistance(p: number): number {
  const a = CAM.position;
  const b = CAM.portrait.position;
  const ty = targetY(HERO_GROUND_Y + FULL_HEIGHT, p);
  return Math.hypot(
    lerp(a[0], b[0], p) - (TARGET[0] + PORTRAIT_TARGET_X * p),
    lerp(a[1], b[1], p) - ty,
    lerp(a[2], b[2], p) - TARGET[2],
  );
}

/** The layout's own elevation angle of the camera above its target, on the framing blend `p`. */
function framingElevation(p: number): number {
  const a = CAM.position;
  const b = CAM.portrait.position;
  const ty = targetY(HERO_GROUND_Y + FULL_HEIGHT, p);
  const dx = lerp(a[0], b[0], p) - (TARGET[0] + PORTRAIT_TARGET_X * p);
  const dz = lerp(a[2], b[2], p) - TARGET[2];
  return Math.atan2(lerp(a[1], b[1], p) - ty, Math.hypot(dx, dz));
}

/** The dolly's share of the framing distance for a plant whose head stands `h` above the mulch. */
function dollyRatio(h: number): number {
  return Math.min(DOLLY_MAX, Math.max(DOLLY_MIN, (h + DOLLY_PAD) / (FULL_HEIGHT + DOLLY_PAD)));
}

/** 0 on a landscape screen .. 1 on a portrait phone, quantised so a resize does not re-frame every pixel. */
function portraitAmount(aspect: number): number {
  return Math.round((1 - smoothstep(PORTRAIT_ASPECT, LANDSCAPE_ASPECT, aspect)) * 20) / 20;
}

export function CameraRig() {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const drift = useRef<Drift>({ yaw: 0, lift: 0, interacting: false, lastGesture: -Infinity, zoom: 1 });
  const aspect = width / Math.max(1, height);
  const portrait = portraitAmount(aspect);
  // Read by the frame loop; written here so a resize is picked up without a re-subscription.
  const framing = useRef(portrait);
  useLayoutEffect(() => {
    framing.current = portrait;
  }, [portrait]);

  // Open on the framing for this screen's shape, and re-frame when the phone
  // turns, unless the viewer has already moved the camera themselves. The
  // layout's position is taken as a direction from the full-grown plant's
  // target, applied to wherever the target now rides, so a re-frame on a
  // young plant keeps the authored angle; the dolly then sets the distance.
  useLayoutEffect(() => {
    if (drift.current.lastGesture !== -Infinity || drift.current.interacting) return;
    const p = CAM.position;
    const q = CAM.portrait.position;
    const tx = TARGET[0] + PORTRAIT_TARGET_X * portrait;
    const ty = targetY(HERO_GROUND_Y + FULL_HEIGHT, portrait);
    offset.set(lerp(p[0], q[0], portrait) - tx, lerp(p[1], q[1], portrait) - ty, lerp(p[2], q[2], portrait) - TARGET[2]);
    const c = controls.current;
    if (c) {
      camera.position.copy(c.target).add(offset);
      c.update();
    } else {
      camera.position.set(tx + offset.x, ty + offset.y, TARGET[2] + offset.z);
      camera.lookAt(tx, ty, TARGET[2]);
    }
  }, [camera, portrait]);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const narrow = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(MIN_HFOV / 2) / aspect));
    const fov = Math.min(MAX_FOV, Math.max(FOV, narrow));
    if (Math.abs(camera.fov - fov) > 0.01) {
      // eslint-disable-next-line react-hooks/immutability -- the camera is a three.js object, configured imperatively
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, aspect]);

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
      const p = framing.current;
      const auto = framingDistance(p) * dollyRatio(Math.max(0, env.headPos.y - HERO_GROUND_Y));
      d.zoom = Math.min(3, Math.max(0.3, camera.position.distanceTo(c.target) / auto));
    }
  }, [camera]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * EASE_RATE);
    const p = framing.current;
    const d = drift.current;
    prevTarget.copy(c.target);
    // the portrait offset (which centres a full bloom) fades out on a close-up of a young plant
    c.target.x += (lerp(LAYOUT.hero[0], TARGET[0] + PORTRAIT_TARGET_X * p, framingBlend(env.headPos.y)) - c.target.x) * k;
    c.target.z += (targetZ(env.headPos.y) - c.target.z) * k;
    c.target.y += (targetY(env.headPos.y, p) - c.target.y) * k;

    if (!d.interacting) {
      // Carry the camera with the target and ease its distance toward the
      // dolly's, keeping the direction it looks from: the framing angle holds
      // from seedling to bloom, and an orbit the viewer chose is respected.
      const h = Math.max(0, env.headPos.y - HERO_GROUND_Y);
      const ratio = dollyRatio(h);
      const want = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE + 0.05, framingDistance(p) * ratio * d.zoom));
      const ease = 1 - Math.exp(-dt * DOLLY_RATE);
      offset.copy(camera.position).sub(prevTarget).sub(driftLift.set(0, d.lift, 0));
      const dist = offset.length() || want;
      const next = dist + (want - dist) * ease;
      if (d.lastGesture === -Infinity) {
        const flat = Math.hypot(offset.x, offset.z) || 1e-6;
        const elev = Math.atan2(offset.y, flat);
        const goal = lerp(CLOSE_ELEVATION, framingElevation(p), smoothstep(0.28, 0.62, ratio));
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
    const reach = Math.min(1, Math.max(0.3, camera.position.distanceTo(c.target) / framingDistance(p)));
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
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[TARGET[0], targetY(HERO_GROUND_Y + FULL_HEIGHT, 0), TARGET[2]]}
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
