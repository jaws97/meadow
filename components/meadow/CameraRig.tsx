"use client";
// The follow camera: a fixed-yaw, high three-quarter view that trails the cart's drawn (interpolated) position on
// the ground, leaning a little ahead of where it is going so the player sees what is coming. It never rotates with
// the cart, which keeps the view calm and keeps "drag toward the finger" meaning the same thing on screen at all
// times. Pinch or wheel set the distance.
//
// Four things move it besides the cart, always by easing, never by a cut:
// - the opening shot: the Meadow first appears from high above, the rings round the rose, and the camera settles
//   onto the cart over a few seconds (meadow.intro), framing the rose with it until the cart sets off (not behind the
//   opening's quote moment, where the push-in below is the one move);
// - pulling far back: past about twenty metres the focus drifts toward the dais and the view tilts down, so zooming
//   out turns into an overview of the whole Meadow rather than a long look along the ground; pulled right back, the
//   view no longer follows the cart at all but frames the ring of beds round the rose, centred on the screen;
// - a visit: once the cart has pulled up beside a plant whose card is open, the camera comes in on the plant and
//   keeps it in the part of the screen the card leaves clear (meadow.view);
// - the opening's push-in (lib/garden/opening): a few per cent farther back while the veil is up, easing in as the
//   Meadow comes into focus behind it, and stopped where it is the moment someone drives or zooms.
//
// The framing follows the screen's shape, blended smoothly from a tall phone to an ultrawide (no jump at square):
// a tall screen gets a floor on the horizontal field of view, a little more distance, and a slightly steeper look
// down; a screen wider than 16:9 gets a ceiling on the horizontal view instead, and steps back a touch.
// Approach adapted from Bruno Simon's folio-2025 (MIT): View.js.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { meadowLayout } from "@/components/meadow/layout";
import { INTRO_SECONDS, meadow } from "@/components/meadow/runtime";
import { opening } from "@/lib/garden/opening";

/** Elevation, measured from straight up (three's spherical phi). */
const PHI = 0.28 * Math.PI;
/** On a tall phone the camera looks down this much more steeply. */
const PORTRAIT_PHI = 0.03 * Math.PI;
/** Pulled right back for the overview, it looks down this steeply. */
const OVERVIEW_PHI = 0.17 * Math.PI;
/** Coming in on a plant, a little more from above, so the cart beside it does not stand in the way. */
const VISIT_PHI = 0.23 * Math.PI;
/** Fixed compass bearing of the camera around its focus. */
const THETA = 0.25 * Math.PI;
export const ZOOM_MIN = 7;
/**
 * Pulled all the way back, every bed fits a landscape screen (the party's 16:9 among them), the river's ring and the
 * beds beyond it with a little room above the far ones' flowers; the hedge's nearest and farthest stretches fall just
 * outside. (A tall screen keeps its narrow width: it shows the river's ring and the beds' near and far reaches.)
 */
export const ZOOM_MAX = 108;
/** The zoom where the overview starts to take over, and where it is complete. */
const OVERVIEW_FROM = 20;
const OVERVIEW_FULL = 50;
/** How close the camera comes for a visit, and how far it stands back while fireflies lead the way. */
const VISIT_DISTANCE = 10;
const JOURNEY_DISTANCE = 23;
const SMOOTHING = 10;
/** Slower easing for the gentle moves (into a visit, out of the opening shot). */
const GENTLE = 2.2;
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
/** At the start, the view leans this share of the way from the cart toward the rose, from at least this far back. */
const HOME_SHARE = 0.55;
const HOME_DISTANCE = 24;
const HOME_RADIUS = 1.2;
/** The opening shot's height (its length is runtime's INTRO_SECONDS): far enough back to hold the whole ring. */
const INTRO_DISTANCE = 75;

/** Which way the camera stands from its focus, along the ground. */
const TOWARD_CAMERA = new THREE.Vector3(Math.sin(THETA), 0, Math.cos(THETA));

const target = new THREE.Vector3();
const ahead = new THREE.Vector3();
const offset = new THREE.Vector3();
const want = new THREE.Vector3();

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** The vertical field of view that gives `horizontal` degrees across at this aspect. */
const verticalFor = (horizontal: number, aspect: number) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontal / 2)) / aspect));

/**
 * How far toward the camera to set the focus, `distance` back and `phi` from straight up, so a ring of radius `r` round
 * the rose sits centred on the screen: its nearest and farthest points as far below and above the middle (seen from
 * above at a slant, the near half of a ring looms larger than the far half). Whatever the field of view.
 */
function ringFocus(distance: number, phi: number, r: number): number {
  const h = distance * Math.cos(phi);
  // where the view's two lines to the ring's near and far points make equal angles with its middle line
  const a = (-h * Math.cos(2 * phi)) / Math.sin(2 * phi);
  return a + Math.sqrt(a * a + r * r + h * h) - distance * Math.sin(phi);
}

export function CameraRig() {
  const rig = useRef({ distance: 13, phi: PHI, visit: 0, home: 1, trail: 0, zoom0: -1 });
  useFrame(({ camera, size }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const r = rig.current;
    const m = meadow.mover;
    if (m) {
      target.set(m.state.position.x, 0, m.state.position.z);
      ahead.set(m.state.velocity.x, 0, m.state.velocity.z).multiplyScalar(LOOK_AHEAD_SECONDS).clampLength(0, LOOK_AHEAD_MAX);
      target.add(ahead);
    } else {
      const s = meadowLayout().spawn;
      target.set(s.x, 0, s.z);
    }
    const aspect = size.width / Math.max(1, size.height);
    const portrait = smooth(1, TALL, aspect);
    const wide = smooth(WIDE_FROM, WIDE, aspect);
    let fov = FOV;
    if (camera instanceof THREE.PerspectiveCamera) {
      fov = Math.max(FOV, verticalFor(MIN_HORIZONTAL_FOV, aspect));
      if (aspect > WIDE_FROM) fov = Math.min(fov, verticalFor(MAX_HORIZONTAL_FOV, aspect));
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    const shape = 1 + PORTRAIT_GAIN * portrait + WIDE_GAIN * wide;
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, meadow.zoom));
    const overview = smooth(OVERVIEW_FROM, OVERVIEW_FULL, zoom);
    // from the overview's start to all the way back, the view leaves the cart for the ring of beds
    const whole = smooth(OVERVIEW_FULL, ZOOM_MAX, zoom);

    // a visit eases in and out on its own slow clock
    const visiting = meadow.view.target !== null && meadow.intro <= 0;
    r.visit += ((visiting ? 1 : 0) - r.visit) * (1 - Math.exp(-GENTLE * dt));
    let distance = zoom * shape;
    let phi = THREE.MathUtils.lerp(PHI - PORTRAIT_PHI * portrait, OVERVIEW_PHI, overview);
    // the overview drifts toward the dais, and pulled right back it frames the beds round the rose
    want.copy(target).multiplyScalar((1 - overview * 0.85) * (1 - whole));
    if (whole > 0) {
      const L = meadowLayout();
      want.addScaledVector(TOWARD_CAMERA, ringFocus(distance, phi, L.beds[L.beds.length - 1].outer) * whole);
    }
    if (visiting || r.visit > 0.001) {
      const v = meadow.view.target;
      if (v) {
        // keep the plant in the part of the screen the card leaves clear: shift the focus toward the camera
        const elev = Math.PI / 2 - VISIT_PHI;
        const d = Math.min(VISIT_DISTANCE, distance);
        const halfV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
        const lift = (meadow.view.cover * d * halfV) / Math.sin(elev);
        // a card standing at the side: move the plant into the middle of the part left clear
        const side = meadow.view.coverSide * d * halfV * aspect;
        // and look at the plant's middle, not the soil under it, so a tall flower is not pushed up the screen
        offset.set(v.x + Math.sin(THETA) * lift + Math.cos(THETA) * side, v.y * 0.85, v.z + Math.cos(THETA) * lift - Math.sin(THETA) * side);
        want.lerp(offset, r.visit);
      }
      distance = THREE.MathUtils.lerp(distance, Math.min(VISIT_DISTANCE * shape, distance), r.visit);
      phi = THREE.MathUtils.lerp(phi, VISIT_PHI - PORTRAIT_PHI * portrait, r.visit);
    }
    // while the fireflies lead the way, the view stands back a little so more of their trail shows
    r.trail += ((meadow.journey ? 1 : 0) - r.trail) * (1 - Math.exp(-GENTLE * dt));
    if (r.trail > 0.001) distance = THREE.MathUtils.lerp(distance, Math.max(distance, JOURNEY_DISTANCE * shape), r.trail);
    // where the cart starts, beside the dais, the view takes in the rose as well, until the cart sets off
    // (held as it is until there is a cart, so the cart arriving where the view already looks moves nothing: the opening's
    // veil can lift moments after it appears)
    const home =
      m !== null && meadow.view.target === null && Math.hypot(m.state.position.x - meadow.start.x, m.state.position.z - meadow.start.z) < HOME_RADIUS;
    if (m) r.home += ((home ? 1 : 0) - r.home) * (1 - Math.exp(-GENTLE * dt));
    if (r.home > 0.001) {
      want.multiplyScalar(1 - HOME_SHARE * r.home * (1 - overview));
      distance = THREE.MathUtils.lerp(distance, Math.max(distance, HOME_DISTANCE * shape), r.home);
    }
    // the opening's push-in (lib/garden/opening): a little farther back under the veil, easing in to the framing as the
    // Meadow comes into focus, and stopped where it is the moment someone drives (a drag or the keys) or zooms
    if (opening.get().revealAt === null) r.zoom0 = meadow.zoom;
    if (meadow.mode === "drag" || meadow.mode === "keys" || meadow.zoom !== r.zoom0) opening.stopPush();
    distance *= opening.push(performance.now());
    // the opening shot: high over the dais, settling onto the cart
    if (meadow.intro > 0) {
      meadow.intro = Math.max(0, meadow.intro - dt);
      const k = smooth(0, INTRO_SECONDS, INTRO_SECONDS - meadow.intro);
      want.multiplyScalar(k);
      distance = THREE.MathUtils.lerp(INTRO_DISTANCE * shape, distance, k);
      phi = THREE.MathUtils.lerp(OVERVIEW_PHI * 0.8, phi, k);
    }

    const focus = meadow.focus;
    if (meadow.snapCamera) {
      focus.copy(want);
      r.distance = distance;
      r.phi = phi;
      meadow.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-(meadow.intro > 0 ? 30 : r.visit > 0.01 && r.visit < 0.99 ? GENTLE * 2 : SMOOTHING) * dt);
      focus.lerp(want, k);
      r.distance += (distance - r.distance) * k;
      r.phi += (phi - r.phi) * k;
    }
    offset.setFromSphericalCoords(r.distance, r.phi, THETA);
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
    // roughly how far the view reaches across the ground, for the shadow box
    meadow.viewReach = r.distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.max(1, aspect) * 1.6;
    meadow.cameraDistance = r.distance;
  }, -1);
  return null;
}
