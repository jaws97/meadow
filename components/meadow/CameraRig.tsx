"use client";
// The follow camera: a fixed-yaw, high three-quarter view that trails the
// cart's drawn (interpolated) position on the ground, leaning a little ahead
// of where it is going so the player sees what is coming. It never rotates
// with the cart, which keeps the view calm and keeps "drag toward the finger"
// meaning the same thing on screen at all times. Pinch or wheel set the
// distance.
//
// The framing follows the screen's shape, blended smoothly from a tall phone
// to an ultrawide like the garden's (no jump at square): a tall screen gets a
// floor on the horizontal field of view (at a fixed 30 degrees vertical a
// tall phone saw a 4 m wide slot of lawn, too narrow to tap a neighbour's
// plot), a little more distance, and a slightly steeper look down so the
// long frame is lawn round the cart rather than a strip of distance; a screen
// wider than 16:9 gets a ceiling on the horizontal view instead, and steps
// back a touch, so the Meadow's edges stay out of shot and the cart keeps
// its size.
// Approach adapted from Bruno Simon's folio-2025 (MIT): View.js.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { SPAWN } from "@/components/meadow/layout";
import { meadow } from "@/components/meadow/runtime";

/** Elevation, measured from straight up (three's spherical phi). */
const PHI = 0.28 * Math.PI;
/** On a tall phone the camera looks down this much more steeply. */
const PORTRAIT_PHI = 0.03 * Math.PI;
/** Fixed compass bearing of the camera around its focus. */
const THETA = 0.25 * Math.PI;
export const ZOOM_MIN = 9;
export const ZOOM_MAX = 18;
const SMOOTHING = 10;
const LOOK_AHEAD_SECONDS = 0.35;
const LOOK_AHEAD_MAX = 3;
/** Vertical field of view on landscape screens, degrees. */
const FOV = 30;
/** Narrowest horizontal field of view allowed on tall screens, degrees. */
const MIN_HORIZONTAL_FOV = 24;
/** Widest horizontal field of view allowed on screens wider than 16:9, degrees. */
const MAX_HORIZONTAL_FOV = 60;
/** Aspect ratios where the portrait and the wide adjustments are complete. */
const TALL = 0.46;
const WIDE = 2.4;
const WIDE_FROM = 16 / 9;
/** Extra distance at full portrait and at full width. */
const PORTRAIT_GAIN = 0.32;
const WIDE_GAIN = 0.1;

const target = new THREE.Vector3();
const ahead = new THREE.Vector3();
const offset = new THREE.Vector3();

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** The vertical field of view that gives `horizontal` degrees across at this aspect. */
const verticalFor = (horizontal: number, aspect: number) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontal / 2)) / aspect));

export function CameraRig() {
  const rig = useRef({ distance: 13 });
  useFrame(({ camera, size }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const m = meadow.mover;
    if (m) {
      target.set(m.state.position.x, 0, m.state.position.z);
      ahead.set(m.state.velocity.x, 0, m.state.velocity.z).multiplyScalar(LOOK_AHEAD_SECONDS).clampLength(0, LOOK_AHEAD_MAX);
      target.add(ahead);
    } else {
      target.set(SPAWN.x, 0, SPAWN.z);
    }
    const aspect = size.width / Math.max(1, size.height);
    const portrait = smooth(1, TALL, aspect);
    const wide = smooth(WIDE_FROM, WIDE, aspect);
    if (camera instanceof THREE.PerspectiveCamera) {
      let fov = Math.max(FOV, verticalFor(MIN_HORIZONTAL_FOV, aspect));
      if (aspect > WIDE_FROM) fov = Math.min(fov, verticalFor(MAX_HORIZONTAL_FOV, aspect));
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    const want = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, meadow.zoom)) * (1 + PORTRAIT_GAIN * portrait + WIDE_GAIN * wide);
    const focus = meadow.focus;
    if (meadow.snapCamera) {
      focus.copy(target);
      rig.current.distance = want;
      meadow.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-SMOOTHING * dt);
      focus.lerp(target, k);
      rig.current.distance += (want - rig.current.distance) * k;
    }
    offset.setFromSphericalCoords(rig.current.distance, PHI - PORTRAIT_PHI * portrait, THETA);
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
  }, -1);
  return null;
}
