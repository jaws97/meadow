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
// share: the owner's plant is the subject at every stage of its fortnight.
// Before that, a seed and a shoot only a few centimetres high are framed by
// their bed instead (the bed shot): the whole raised bed with its kerb, the
// lantern and the seed's mound, from a little higher, so a new garden opens on
// a garden rather than on bare mulch and big stones; as the shoot rises toward
// a hand high the camera eases into the plant's own framing. A
// zoom by the viewer is kept as a share of that distance. Left alone, the camera drifts a
// little, as if handheld on a slow dolly; any touch of the controls pauses the
// drift, which eases back in a few seconds after the last gesture.
// On the garden page's opening (lib/garden/opening) the camera waits under
// the veil a little farther back and pushes gently in to its framing as the
// garden comes into focus; the first drag or zoom ends the push where it is
// (a tap, which only brings the UI in, does not).
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
import { sidePanel } from "@/lib/client/dock";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";
import { opening } from "@/lib/garden/opening";
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
/**
 * The bed shot for a seed and a very young shoot (see the header). It holds fully until the head is BED_FROM above the
 * mulch (the first shoot) and gives way to the plant's own framing by BED_TO (about a hand high). The distance fits
 * the bed and its kerb across the screen's width (BED_HALF_WIDTH, a little air included), between a share of the
 * full-grown framing's distance (BED_REACH_MIN, so a wide screen keeps the garden round the bed and the lantern's
 * lamp in frame) and BED_REACH_MAX of it (on a tall phone, the signed-off phone shot's own reach: the lantern at the
 * left edge). The camera looks down at BED_ELEVATION.tall so the mulch reads as an oval with the mound in it; on a
 * landscape screen with the care panel at the right (an iPad held sideways, a laptop) it stands lower and aims a little
 * right of the bed, so the bed sits clear of the panel. Without a panel (a friend's seed garden seen from the Meadow)
 * the bed stays centred.
 */
const BED_FROM = 0.03;
const BED_TO = 0.24;
const BED_HALF_WIDTH = 1.16;
const BED_REACH_MIN = { tall: 0.5, wide: 0.72 };
const BED_REACH_MAX = 1.08;
const BED_ELEVATION = { tall: THREE.MathUtils.degToRad(27), wide: THREE.MathUtils.degToRad(17) };
const BED_AIM = {
  tall: new THREE.Vector3(-0.08, HERO_GROUND_Y + 0.12, LAYOUT.bed.center[2] + 0.08),
  wide: new THREE.Vector3(0.3, HERO_GROUND_Y + 0.26, LAYOUT.bed.center[2] + 0.08),
};
/**
 * What the lens shift keeps in the open part of the view for the bed shot: from the lantern's lamp (its height, at
 * the back of the bed) down to the front kerb. When the open part is shorter than that (a phone's card grown for a
 * question), the front kerb comes first and the lamp may go behind the name pill; the back kerb (BED_BACK) never does.
 */
const BED_TOP = new THREE.Vector3(0, LAYOUT.lantern.lampHeight, LAYOUT.lantern.position[2]);
const BED_BACK = new THREE.Vector3(0, LAYOUT.bed.height + 0.06, LAYOUT.bed.center[2] - LAYOUT.bed.rz - LAYOUT.bed.lipWidth);
const BED_FOOT = new THREE.Vector3(0, 0, LAYOUT.bed.center[2] + LAYOUT.bed.rz + LAYOUT.bed.lipWidth);
const bedAim = new THREE.Vector3();
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
/** A gesture moved the camera (and so ends the opening's push-in) past this turn (radians) or change of distance (a share). */
const MOVED_ANGLE = 0.002;
const MOVED_SHARE = 0.002;

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
const released = new THREE.Vector3();
const lensHead = new THREE.Vector3();
const lensFoot = new THREE.Vector3();
const lensCap = new THREE.Vector3();

interface Drift {
  /** drift currently applied to the camera, so each frame moves it by the difference */
  yaw: number;
  lift: number;
  interacting: boolean;
  lastGesture: number;
  /** the viewer's own zoom, as a share of the dolly's distance for the plant's height */
  zoom: number;
  /** the opening's push-in currently applied to the camera's distance (a factor), and whether a gesture has ended it */
  push: number;
  pushOff: boolean;
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

/** How much of the bed shot is in the framing for a head at `headY`: 1 for a seed, 0 from about a hand high. */
function bedShare(headY: number): number {
  return 1 - smoothstep(BED_FROM, BED_TO, Math.max(0, headY - HERO_GROUND_Y));
}

/** 0 on a tall or square screen, 1 on a landscape one, for the bed shot. */
const wideness = (aspect: number) => smoothstep(1.0, 1.4, aspect);

/** The bed shot's distance in framing `f` on a screen of this aspect ratio (see BED_HALF_WIDTH). */
function bedDistance(f: Framing, aspect: number): number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(f.fov) / 2) * Math.max(0.2, aspect);
  const least = lerp(BED_REACH_MIN.tall, BED_REACH_MIN.wide, wideness(aspect));
  return f.distance * Math.min(BED_REACH_MAX, Math.max(least, BED_HALF_WIDTH / tanHalf / f.distance));
}

/** The dolly's distance for a head at `headY`, before the viewer's zoom: the bed shot easing into the plant's own. */
function autoDistance(f: Framing, aspect: number, headY: number): number {
  const own = f.distance * dollyRatio(Math.max(0, headY - HERO_GROUND_Y));
  return lerp(own, bedDistance(f, aspect), bedShare(headY));
}

/** The camera's offset from the target for the full-grown plant in framing `f`. */
function framingOffset(f: Framing, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.cos(f.elevation) * f.distance;
  return out.set(Math.sin(f.azimuth) * flat, Math.sin(f.elevation) * f.distance, Math.cos(f.azimuth) * flat);
}

/**
 * Eases the lens shift (CSS px, content moved left and up) toward keeping the plant in the part of the view the care
 * layer leaves open: head to foot centred above a bottom card, the head kept clear of the name pill; centred left of
 * a narrow side panel. Nothing docked, and once the shift has eased away, the view offset is cleared. For the bed
 * shot (`bed`, its share) the subject is the bed, from the lantern's lamp down to the front kerb, and what must stay
 * clear of the name pill is its back kerb.
 */
function shiftLens(camera: THREE.Camera, L: { x: number; y: number }, width: number, height: number, dt: number, bed: number) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  const { dockBottom, dockRight } = garden.get();
  let wantX = 0;
  let wantY = 0;
  if ((dockBottom > 0 || dockRight > 0) && width > 0 && height > 0) {
    camera.updateMatrixWorld();
    // where the head and the plant's foot fall without the shift (it moves the picture by whole pixels: ndc + 2 px / size)
    lensHead.copy(env.headPos).lerp(BED_TOP, bed).project(camera);
    lensFoot.set(env.headPos.x, HERO_GROUND_Y, env.headPos.z).lerp(BED_FOOT, bed).project(camera);
    lensCap.copy(env.headPos).lerp(BED_BACK, bed).project(camera);
    const headY = ((1 - (lensHead.y - (2 * L.y) / height)) / 2) * height;
    const footY = ((1 - (lensFoot.y - (2 * L.y) / height)) / 2) * height;
    const capY = ((1 - (lensCap.y - (2 * L.y) / height)) / 2) * height;
    if (dockBottom > 0) {
      const top = Math.min(LENS_TOP_MAX, height * LENS_TOP);
      const bottom = height - dockBottom - LENS_GAP;
      // up only: head to foot centred in the open part or, when that is too short for them, the foot just clear of
      // the card; never so far that the head (the bed's back kerb, for the bed shot) goes under the name pill
      wantY = Math.min(Math.max(0, (headY + footY - top - bottom) / 2, footY - bottom), Math.max(0, capY - top));
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
  const drift = useRef<Drift>({ yaw: 0, lift: 0, interacting: false, lastGesture: -Infinity, zoom: 1, push: 1, pushOff: false });
  /** the lens shift now applied, CSS px: content moved left (x) and up (y) */
  const lens = useRef({ x: 0, y: 0 });
  const aspect = Math.round(width / Math.max(1, height) / ASPECT_STEP) * ASPECT_STEP;
  const framing = useMemo(() => framingFor(aspect), [aspect]);
  // Read by the frame loop; written here so a resize is picked up without a re-subscription.
  const live = useRef(framing);
  const liveAspect = useRef(aspect);
  useLayoutEffect(() => {
    live.current = framing;
    liveAspect.current = aspect;
  }, [framing, aspect]);

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
  // The opening's push-in ends with a gesture that moved the camera (a drag,
  // a pinch or the wheel), the same way: the distance it had reached becomes
  // the camera's own. A tap that moves nothing leaves it running.
  const pressed = useRef(new THREE.Vector3());
  const onStart = useCallback(() => {
    const d = drift.current;
    d.yaw = 0;
    d.lift = 0;
    d.interacting = true;
    const c = controls.current;
    if (c) pressed.current.copy(camera.position).sub(c.target);
  }, [camera]);
  const onEnd = useCallback(() => {
    const d = drift.current;
    d.interacting = false;
    d.lastGesture = env.time;
    const c = controls.current;
    if (c) {
      const off = released.copy(camera.position).sub(c.target);
      const from = pressed.current;
      const moved = off.angleTo(from) > MOVED_ANGLE || Math.abs(off.length() / Math.max(1e-6, from.length()) - 1) > MOVED_SHARE;
      if (moved && !d.pushOff) {
        d.push = 1;
        d.pushOff = true;
        opening.stopPush();
      }
      // Keep the viewer's zoom as a share of the dolly, so the plant keeps its size in frame as it grows (without the
      // push-in, while that is still running).
      const auto = autoDistance(live.current, liveAspect.current, env.headPos.y);
      d.zoom = Math.min(3, Math.max(0.3, off.length() / d.push / auto));
    }
  }, [camera]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * EASE_RATE);
    const f = live.current;
    const d = drift.current;
    const headY = env.headPos.y;
    const bed = bedShare(headY);
    // the bed shot's lower look from the left is for a landscape screen with a panel actually at the right; without
    // one the bed stays centred and seen from above, the aim only a little higher so the lamp stays in frame
    const panelRight = garden.get().dockRight > 0 || sidePanel.width > 0;
    const landscape = wideness(liveAspect.current);
    const wide = panelRight ? landscape : 0;
    bedAim.lerpVectors(BED_AIM.tall, BED_AIM.wide, wide).setY(lerp(BED_AIM.tall.y, BED_AIM.wide.y, landscape));
    prevTarget.copy(c.target);
    c.target.x += (lerp(lerp(LAYOUT.hero[0], TARGET[0], framingBlend(headY)), bedAim.x, bed) - c.target.x) * k;
    c.target.z += (lerp(targetZ(headY), bedAim.z, bed) - c.target.z) * k;
    c.target.y += (lerp(targetY(headY, f), bedAim.y, bed) - c.target.y) * k;

    if (!d.interacting) {
      // Carry the camera with the target and ease its distance toward the
      // dolly's, keeping the direction it looks from: the framing angle holds
      // from seedling to bloom, and an orbit the viewer chose is respected.
      // The opening's push-in (lib/garden/opening) rides on top, applied
      // straight to the distance rather than eased, so it keeps its own slow
      // curve: from a little farther back under the veil to the framing.
      const ratio = dollyRatio(Math.max(0, headY - HERO_GROUND_Y));
      const want = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE + 0.05, autoDistance(f, liveAspect.current, headY) * d.zoom));
      const ease = 1 - Math.exp(-dt * DOLLY_RATE);
      const push = d.pushOff ? 1 : opening.push(performance.now());
      offset.copy(camera.position).sub(prevTarget).sub(driftLift.set(0, d.lift, 0));
      const dist = offset.length() / d.push || want;
      const next = dist + (want - dist) * ease;
      if (d.lastGesture === -Infinity) {
        const flat = Math.hypot(offset.x, offset.z) || 1e-6;
        const elev = Math.atan2(offset.y, flat);
        const bedElevation = lerp(BED_ELEVATION.tall, BED_ELEVATION.wide, wide);
        const goal = lerp(lerp(CLOSE_ELEVATION, f.elevation, smoothstep(0.28, 0.62, ratio)), bedElevation, bed);
        const e = elev + (goal - elev) * ease;
        const k = (Math.cos(e) * next * push) / flat;
        offset.set(offset.x * k, Math.sin(e) * next * push, offset.z * k);
      } else {
        offset.setLength(next * push);
      }
      d.push = push;
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

    shiftLens(camera, lens.current, width, height, dt, bed);
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
