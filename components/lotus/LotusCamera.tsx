"use client";
/* eslint-disable react-hooks/immutability --
   The camera and the orbit controls are three.js objects, placed imperatively when the frame's settings change. */
// The concepts page's camera. It frames each look without easing or the idle drift, so a given address always gives
// the same picture:
// - the pond view frames the courtyard's tank from the landing at its front, on the garden camera's bearing, high
//   enough (about 17 degrees on a wide screen, 30 on a phone) that the water reads as a surface you look into, with
//   the koi, and wide enough for the steps, the lamps and the walled niche behind; the close framing comes in on the
//   subject;
// - the garden framing below (the urli's, from v1) is kept for reference:
// - the product framing is the garden camera's own (components/garden/CameraRig: the layout's framing for the
//   screen's shape, the dolly by the subject's height above the mound, the bed shot for a seed, the close look-down on
//   a young plant), plus the art direction's lotus-only change (section 0, point 4): about five degrees more
//   elevation on wide screens, so a laptop sees the water as more than a sliver; the floating-leaf days frame a point
//   14 cm above the water's centre, so the urli is the subject;
// - the close framing comes in on the subject at half the distance, a little higher;
// - the Meadow plot view (view=plot) uses the Meadow's visit camera (components/meadow/CameraRig: ten metres off, 41 degrees
//   from straight up, a quarter turn of the compass, a 30-degree lens), or four metres for the close framing.
// The orbit controls stay live for a look round; any change of the page's controls frames afresh.
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";
import { lerp, smoothstep } from "@/lib/plant/prng";
import type { Cam, Stage, View } from "@/components/lotus/params";
import { POND } from "@/components/lotus/pond";
import { pondFraming } from "@/components/lotus/product/camera";

type Controls = ComponentRef<typeof OrbitControls>;

// The garden camera's constants (components/garden/CameraRig.tsx), copied: that file keeps them private.
const TARGET = LAYOUT.camera.target;
const TARGET_MIN = 0.2;
const TARGET_MAX = 1.0;
const FULL_HEIGHT = 1.12;
const DOLLY_PAD = 0.12;
const DOLLY_MIN = 0.2;
const DOLLY_MAX = 1.1;
const CLOSE_ELEVATION = THREE.MathUtils.degToRad(20);
const BED_FROM = 0.03;
const BED_TO = 0.24;
const BED_HALF_WIDTH = 1.16;
const BED_REACH_MIN = { tall: 0.5, wide: 0.72 };
const BED_REACH_MAX = 1.08;
const BED_ELEVATION_TALL = THREE.MathUtils.degToRad(27);
const BED_AIM_TALL = new THREE.Vector3(-0.08, HERO_GROUND_Y + 0.12, LAYOUT.bed.center[2] + 0.08);
const BED_AIM_WIDE_Y = HERO_GROUND_Y + 0.26;

/** The lotus-only lift on wide screens (art direction, section 0 point 4). */
const LOTUS_LIFT = THREE.MathUtils.degToRad(5);

// The Meadow's visit camera (components/meadow/CameraRig.tsx).
const MEADOW_PHI = 0.23 * Math.PI;
const MEADOW_THETA = 0.25 * Math.PI;
const MEADOW_FOV = 30;
const MEADOW_MIN_HFOV = 24;
const MEADOW_DISTANCE = { product: 10, close: 4 } as const;

const dollyRatio = (h: number) => Math.min(DOLLY_MAX, Math.max(DOLLY_MIN, (h + DOLLY_PAD) / (FULL_HEIGHT + DOLLY_PAD)));
const framingBlend = (headY: number) => smoothstep(0.28, 0.62, dollyRatio(Math.max(0, headY - HERO_GROUND_Y)));
const bedShare = (headY: number) => 1 - smoothstep(BED_FROM, BED_TO, Math.max(0, headY - HERO_GROUND_Y));
const wideness = (aspect: number) => smoothstep(1.0, 1.4, aspect);

function targetY(headY: number, f: Framing): number {
  const young = HERO_GROUND_Y + 0.62 * Math.max(0, headY - HERO_GROUND_Y) + 0.03;
  const y = lerp(young, headY * f.targetRise + f.targetLift, framingBlend(headY));
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, y));
}

function bedDistance(f: Framing, aspect: number): number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(f.fov) / 2) * Math.max(0.2, aspect);
  const least = lerp(BED_REACH_MIN.tall, BED_REACH_MIN.wide, wideness(aspect));
  return f.distance * Math.min(BED_REACH_MAX, Math.max(least, BED_HALF_WIDTH / tanHalf / f.distance));
}

export interface Pose {
  target: THREE.Vector3;
  position: THREE.Vector3;
  fov: number;
}

/**
 * The garden framing for a subject at `focus` (world), on a screen of `aspect`: the garden camera's settled pose, with
 * the lotus's lift.
 */
export function gardenPose(focus: THREE.Vector3, aspect: number, cam: Cam): Pose {
  const f = framingFor(aspect);
  const headY = focus.y;
  const bed = bedShare(headY);
  const blend = framingBlend(headY);
  const landscape = wideness(aspect);
  const aim = new THREE.Vector3(BED_AIM_TALL.x, lerp(BED_AIM_TALL.y, BED_AIM_WIDE_Y, landscape), BED_AIM_TALL.z);
  const target = new THREE.Vector3(
    lerp(lerp(focus.x, TARGET[0], blend), aim.x, bed),
    lerp(targetY(headY, f), aim.y, bed),
    lerp(lerp(focus.z, TARGET[2], blend), aim.z, bed),
  );
  const ratio = dollyRatio(Math.max(0, headY - HERO_GROUND_Y));
  let distance = lerp(f.distance * ratio, bedDistance(f, aspect), bed);
  let elevation = lerp(lerp(CLOSE_ELEVATION, f.elevation, smoothstep(0.28, 0.62, ratio)), BED_ELEVATION_TALL, bed) + LOTUS_LIFT * landscape;
  if (cam === "close") {
    target.copy(focus);
    target.y -= 0.04;
    distance *= bed > 0.5 ? 0.42 : 0.5;
    elevation += THREE.MathUtils.degToRad(6);
  }
  const flat = Math.cos(elevation) * distance;
  const position = new THREE.Vector3(Math.sin(f.azimuth) * flat, Math.sin(elevation) * distance, Math.cos(f.azimuth) * flat).add(target);
  return { target, position, fov: f.fov };
}

/**
 * The pond view's framing: the whole pond from the garden camera's bearing, aimed a little behind the lotus pot and
 * over the water. The close framings come in on the subject:
 * - the flower, the bud, the pod or the standing leaves: under a metre away (1.25 m on a phone), from a little lower;
 * - the floating leaves (the koi's frame): looking down into the water from 52 degrees, the tank filling the frame from
 *   the front coping to the back step, so the koi are the picture (water at least 60% of the frame);
 * - the seed's jar: from 55 cm and 50 degrees, looking down on the jar against the water rather than the landing's slab.
 */
export function pondPose(focus: THREE.Vector3, aspect: number, cam: Cam, stage: Stage): Pose {
  const f = framingFor(aspect);
  const p = pondFraming(aspect);
  const target = new THREE.Vector3(POND.cx + 0.02, POND.waterY + p.lift, POND.cz - p.back);
  let distance = p.distance;
  let elevation = p.elevation;
  let fov = p.fov;
  const wide = smoothstep(0.46, 1.33, aspect);
  if (cam === "close") {
    if (stage === "jar") {
      // aimed a little past the jar, so it stands low in the frame against the water rather than on bare slab
      target.copy(focus);
      target.y += 0.0;
      target.z -= 0.1;
      distance = lerp(0.75, 0.55, wide);
      elevation = THREE.MathUtils.degToRad(50);
    } else if (stage === "floating") {
      target.set(POND.cx, POND.waterY - 0.02, POND.cz + 0.03);
      distance = lerp(2.3, 1.5, wide);
      elevation = THREE.MathUtils.degToRad(52);
      fov = p.fov - 2;
    } else {
      target.copy(focus);
      target.y -= 0.05;
      distance = lerp(1.25, 0.95, wide);
      elevation -= THREE.MathUtils.degToRad(1);
    }
  }
  const flat = Math.cos(elevation) * distance;
  const position = new THREE.Vector3(Math.sin(f.azimuth) * flat, Math.sin(elevation) * distance, Math.cos(f.azimuth) * flat).add(target);
  return { target, position, fov };
}

/** The Meadow's visit camera on a plant whose middle is at `focus` (world); the plot view has only its two framings. */
export function meadowPose(focus: THREE.Vector3, aspect: number, cam: Cam): Pose {
  const offset = new THREE.Vector3().setFromSphericalCoords(MEADOW_DISTANCE[cam === "close" ? "close" : "product"], MEADOW_PHI, MEADOW_THETA);
  const minV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(MEADOW_MIN_HFOV) / 2) / Math.max(0.2, aspect)));
  return { target: focus.clone(), position: focus.clone().add(offset), fov: Math.max(MEADOW_FOV, minV) };
}

export function LotusCamera({
  view,
  cam,
  stage,
  focus,
  frameKey,
  still,
}: {
  view: View;
  cam: Cam;
  stage: Stage;
  focus: THREE.Vector3;
  frameKey: string;
  still: boolean;
}) {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = width / Math.max(1, height);

  // Frame afresh whenever the look, the view or the screen's shape changes (before the frame is drawn).
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const pose = view === "plot" ? meadowPose(focus, aspect, cam) : pondPose(focus, aspect, cam, stage);
    camera.position.copy(pose.position);
    camera.fov = pose.fov;
    camera.near = view === "plot" ? 0.1 : 0.05;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.target);
    const c = controls.current;
    if (c) {
      c.target.copy(pose.target);
      c.update();
      // a dev handle for probing a view from the console (or a script): move the camera and the target, then update()
      (window as unknown as { __lotusControls?: Controls }).__lotusControls = c;
    }
  }, [camera, view, cam, stage, focus, aspect, frameKey]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping={!still}
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.7}
      minDistance={0.2}
      maxDistance={view === "plot" ? 20 : 7}
      maxPolarAngle={Math.PI * 0.49}
    />
  );
}
