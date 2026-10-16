"use client";
// The follow camera: a fixed-yaw, high three-quarter view that trails the
// cart's drawn (interpolated) position on the ground, leaning a little ahead
// of where it is going so the player sees what is coming. It never rotates
// with the cart, which keeps the view calm and keeps "drag toward the finger"
// meaning the same thing on screen at all times. Pinch or wheel set the
// distance. A portrait phone gets a little extra distance and, more usefully,
// a floor on the horizontal field of view: at a fixed 30 degrees vertical a
// tall phone saw a 4 m wide slot of lawn, too narrow to tap a neighbour's plot.
// Approach adapted from Bruno Simon's folio-2025 (MIT): View.js.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { SPAWN } from "@/components/meadow/layout";
import { meadow } from "@/components/meadow/runtime";

/** Elevation, measured from straight up (three's spherical phi). */
const PHI = 0.28 * Math.PI;
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
/** Extra distance for tall screens, as a share of how far past square the aspect goes. */
const PORTRAIT_GAIN = 0.3;
const PORTRAIT_MAX = 1.4;

const target = new THREE.Vector3();
const ahead = new THREE.Vector3();
const offset = new THREE.Vector3();

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
    const portrait = aspect < 1 ? 1 + PORTRAIT_GAIN * Math.min(PORTRAIT_MAX, 1 / aspect - 1) : 1;
    if (camera instanceof THREE.PerspectiveCamera) {
      const floor = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(MIN_HORIZONTAL_FOV / 2)) / aspect));
      const fov = Math.max(FOV, floor);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    const want = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, meadow.zoom)) * portrait;
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
    offset.setFromSphericalCoords(rig.current.distance, PHI, THETA);
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
  }, -1);
  return null;
}
