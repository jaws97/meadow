"use client";
/* eslint-disable react-hooks/immutability --
   The camera and the orbit controls are three.js objects, placed imperatively when the frame's settings change. */
// The river preview's cameras: the Meadow's own (components/meadow/CameraRig.tsx: the fixed compass bearing a quarter
// turn round, the 30-degree lens widened on tall screens to keep 24 degrees across, the portrait's extra distance and
// steeper look), settled at a pose for each preset so an address always gives the same picture:
// - product: the driving camera (50 degrees from straight up) one pinch in from its opening 17 m, at 13 m (the rig
//   zooms from 7 to 78), on the water between the parked cart and the near bridge, which the camera looks straight
//   along: the river with its pockets and koi across the middle of the frame, the towpath and the cart below it, the
//   bridge's lamps and the island behind (at 17 m the river was a minor band among the paving);
// - bridge: the bridge at the right of the ring (polar angle 7pi/4), which the fixed bearing sees side-on, from lower
//   down than the driving camera ever goes (22 degrees over the horizon, as a visitor standing on the outer towpath
//   would see it): its slabs, piers and cutwaters, parapets and four lamp posts over the water, the reach in front;
// - close: four and a half metres from the near bridge's lotus (the page's own stage), a little more from above;
// - overview: pulled right back (the write-up's 97 m zoom, which fits the hedge across the frame) and tilted down as
//   the rig does past 50 m, the whole Meadow round the rose.
// Orbit controls stay live for a look round; the sun's shadow box and the haze follow wherever the view is aimed.
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { meadow } from "@/components/meadow/runtime";
import type { Cam } from "@/components/lotus/params";

type Controls = ComponentRef<typeof OrbitControls>;

const THETA = 0.25 * Math.PI;
const PHI = 0.28 * Math.PI;
const PORTRAIT_PHI = 0.03 * Math.PI;
const OVERVIEW_PHI = 0.17 * Math.PI;
const BRIDGE_PHI = 0.375 * Math.PI;
const FOV = 30;
const MIN_HORIZONTAL_FOV = 24;
const MAX_HORIZONTAL_FOV = 60;
const TALL = 0.46;
const WIDE = 2.4;
const WIDE_FROM = 16 / 9;
const PORTRAIT_GAIN = 0.32;
const WIDE_GAIN = 0.1;
/** Distances for each preset (before the screen's shape), metres. */
export const RIVER_CAM = { product: 13, bridge: 12.5, close: 4.5, overview: 97 } as const;
/** How far round each preset's subject the plants are drawn at the page's tier. */
export const DETAIL_REACH: Record<Cam, number> = { product: 9.5, bridge: 9, close: 5, overview: 0 };

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const verticalFor = (horizontal: number, aspect: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontal / 2)) / aspect));

export interface RiverPose {
  target: THREE.Vector3;
  position: THREE.Vector3;
  fov: number;
}

/** The Meadow camera's pose for `cam` on its subject `focus`, on a screen of `aspect`. */
export function riverPose(cam: Cam, focus: THREE.Vector3, aspect: number): RiverPose {
  const portrait = smooth(1, TALL, aspect);
  const wide = smooth(WIDE_FROM, WIDE, aspect);
  let fov = Math.max(FOV, verticalFor(MIN_HORIZONTAL_FOV, aspect));
  if (aspect > WIDE_FROM) fov = Math.min(fov, verticalFor(MAX_HORIZONTAL_FOV, aspect));
  const shape = 1 + PORTRAIT_GAIN * portrait + WIDE_GAIN * wide;
  const distance = RIVER_CAM[cam] * shape;
  const phi =
    cam === "overview" ? OVERVIEW_PHI : cam === "close" ? 0.25 * Math.PI - PORTRAIT_PHI * portrait : cam === "bridge" ? BRIDGE_PHI - PORTRAIT_PHI * portrait : PHI - PORTRAIT_PHI * portrait;
  const offset = new THREE.Vector3().setFromSphericalCoords(distance, phi, THETA);
  return { target: focus.clone(), position: focus.clone().add(offset), fov };
}

export function RiverCamera({
  cam,
  focus,
  portraitFocus,
  frameKey,
  still,
}: {
  cam: Cam;
  focus: THREE.Vector3;
  /** where a tall screen aims instead (blended in as the screen narrows); the landscape focus when not given */
  portraitFocus?: THREE.Vector3;
  frameKey: string;
  still: boolean;
}) {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = width / Math.max(1, height);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const aim = portraitFocus ? focus.clone().lerp(portraitFocus, smooth(1, TALL, aspect)) : focus;
    const pose = riverPose(cam, aim, aspect);
    camera.position.copy(pose.position);
    camera.fov = pose.fov;
    camera.near = cam === "overview" ? 0.5 : 0.1;
    camera.far = 400;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.target);
    const c = controls.current;
    if (c) {
      c.target.copy(pose.target);
      c.update();
    }
    meadow.focus.copy(pose.target);
  }, [camera, cam, focus, portraitFocus, aspect, frameKey]);

  // the shadow box and the haze follow the view (as the rig keeps meadow.viewReach and cameraDistance)
  useFrame(() => {
    const c = controls.current;
    const target = c ? c.target : meadow.focus;
    meadow.focus.copy(target);
    const d = camera.position.distanceTo(target);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : FOV;
    meadow.cameraDistance = d;
    meadow.viewReach = d * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.max(1, aspect) * 1.6;
  }, -1);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping={!still}
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={1.5}
      maxDistance={140}
      maxPolarAngle={Math.PI * 0.47}
    />
  );
}
