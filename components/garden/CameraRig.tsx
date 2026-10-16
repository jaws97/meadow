"use client";
// The garden camera. It opens on the layout's framing (the hero in the lower
// middle third, the bed, path and arch in view, trees framing above) and the
// orbit target eases up the flower as it grows, so a seedling is viewed low and
// a tall bloom higher. Left alone, the camera drifts a little, as if handheld
// on a slow dolly; any touch of the controls pauses the drift, which eases back
// in a few seconds after the last gesture. OrbitControls stays live so the
// viewer can lean right in to the flower.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { smoothstep } from "@/lib/plant/prng";

type Controls = ComponentRef<typeof OrbitControls>;

/**
 * Vertical field of view. The canvas opens with a longer lens, but a garden
 * wants room for the bed in front of the hero and the canopies above it: at
 * 42° a metre-high plant fills a little under half the frame from three and a
 * half metres, with the lawn apron at its feet and the trees along the top.
 */
const FOV = 42;
/** A touch above and behind the layout's point, so the lens looks down over the bed. */
const START: readonly [number, number, number] = [
  LAYOUT.camera.position[0] + 0.05,
  LAYOUT.camera.position[1] + 0.3,
  LAYOUT.camera.position[2] + 0.35,
];
const TARGET = LAYOUT.camera.target;
const TARGET_MIN = 0.3;
const TARGET_MAX = 1.0;
/** The orbit target rides up the plant: a little under the head, so the bloom sits above centre. */
const TARGET_RISE = 0.72;
const TARGET_LIFT = 0.1;
const EASE_RATE = 1.5;
const MIN_DISTANCE = 0.8;
const MAX_DISTANCE = 7;
const MIN_POLAR = 0.75;
/** The garden is dressed for a camera on +z; the orbit may swing this far round either side. */
const MAX_AZIMUTH = 1.25;
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

interface Drift {
  /** drift currently applied to the camera, so each frame moves it by the difference */
  yaw: number;
  lift: number;
  interacting: boolean;
  lastGesture: number;
}

export function CameraRig() {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const drift = useRef<Drift>({ yaw: 0, lift: 0, interacting: false, lastGesture: -Infinity });

  useLayoutEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== FOV) {
      camera.fov = FOV;
      camera.updateProjectionMatrix();
    }
    camera.position.set(START[0], START[1], START[2]);
    camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
  }, [camera]);

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
  }, []);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * EASE_RATE);
    const goal = Math.min(TARGET_MAX, Math.max(TARGET_MIN, env.headPos.y * TARGET_RISE + TARGET_LIFT));
    c.target.x = TARGET[0];
    c.target.z = TARGET[2];
    c.target.y += (goal - c.target.y) * k;

    const d = drift.current;
    const t = env.time;
    const idle = d.interacting ? 0 : smoothstep(DRIFT_RESUME_AFTER, DRIFT_RESUME_AFTER + DRIFT_EASE, t - d.lastGesture);
    const phase = (t / DRIFT_PERIOD) * Math.PI * 2;
    const wantYaw = Math.sin(phase) * DRIFT_YAW * idle;
    const wantLift = Math.sin(phase * 2 + 1.1) * DRIFT_LIFT * idle;
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
      target={[TARGET[0], TARGET[1] + TARGET_LIFT, TARGET[2]]}
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
