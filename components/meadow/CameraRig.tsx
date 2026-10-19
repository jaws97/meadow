"use client";
// The follow camera: a fixed-yaw, high three-quarter view that trails the cart's drawn (interpolated) position on
// the ground, leaning a little ahead of where it is going so the player sees what is coming. It never rotates with
// the cart, which keeps the view calm and keeps "drag toward the finger" meaning the same thing on screen at all
// times. Pinch or wheel set the distance.
//
// Four things move it besides the cart, always by easing, never by a cut:
// - the opening view (openingView.ts): the Meadow first shows wide, centred on the rose's island with the whole river
//   ring and its bridges in frame (behind the quote moment's reveal, or the plain veil when the quote is skipped), and
//   the camera settles from there onto the cart over five and a half seconds, framing the rose with it until the cart
//   sets off. On the way in it looks down as pulling back does at each distance (the overview's steep look, tilting to
//   the follow view's angle over the last stretch), so whatever the visitor does to move the view stops it where it is:
//   their zoom carries on from the one it had come in to, and the little left of its own framing (where it looks, on
//   its straight way from the river's middle to the cart's) eases out over a moment;
// - pulling far back: past about twenty metres the focus drifts toward the dais and the view tilts down, so zooming
//   out turns into an overview of the whole Meadow rather than a long look along the ground; pulled right back, the
//   view no longer follows the cart at all but frames the ring of beds round the rose, centred on the screen;
// - a visit: once the cart has pulled up beside a plant whose card is open, the camera comes in on the plant and
//   keeps it in the part of the screen the card leaves clear (meadow.view); there, and only there, it leaves its
//   fixed bearing: a drag turns it round the plant, all the way round if the visitor likes, and a little higher or
//   lower (meadow.view's turn and tilt, the controller's), and as the visit ends it eases back to the bearing;
// - the opening's push-in (lib/garden/opening), for a /meadow?plot=N link, which opens beside its plant rather than on
//   the island: a few per cent farther back while the veil is up, easing in as the Meadow comes into focus behind it,
//   and stopped where it is the moment someone drives or zooms.
//
// The framing follows the screen's shape, blended smoothly from a tall phone to an ultrawide (no jump at square):
// a tall screen gets a floor on the horizontal field of view, a little more distance, and a slightly steeper look
// down; a screen wider than 16:9 gets a ceiling on the horizontal view instead, and steps back a touch (the fields of
// view are openingView.ts's fovFor, which the wide view is fitted with).
// Approach adapted from Bruno Simon's folio-2025 (MIT): View.js.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { meadowLayout } from "@/components/meadow/layout";
import {
  FOV,
  fovFor,
  releaseShare,
  ringFocus,
  settleDistance,
  settleProgressAfter,
  settleStartAt,
  stopsSettle,
  WIDE_FROM,
  WIDE_PHI,
  WIDE_RING,
  wideDistance,
} from "@/components/meadow/openingView";
import { meadow } from "@/components/meadow/runtime";
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
/** Slower easing for the gentle moves (into a visit). */
const GENTLE = 2.2;
/** The opening's settle is followed this closely, so the camera keeps to its curve. */
const SETTLE_SMOOTHING = 30;
const LOOK_AHEAD_SECONDS = 0.35;
const LOOK_AHEAD_MAX = 3;
/** Aspect ratios where the portrait and the wide adjustments are complete. */
const TALL = 0.46;
const WIDE = 2.4;
/** Extra distance at full portrait and at full width. */
const PORTRAIT_GAIN = 0.32;
const WIDE_GAIN = 0.1;
/** At the start, the view leans this share of the way from the cart toward the rose, from at least this far back. */
const HOME_SHARE = 0.55;
const HOME_DISTANCE = 24;
const HOME_RADIUS = 1.2;

/** Which way the camera stands from its focus, along the ground. */
const TOWARD_CAMERA = new THREE.Vector3(Math.sin(THETA), 0, Math.cos(THETA));

const target = new THREE.Vector3();
const ahead = new THREE.Vector3();
const offset = new THREE.Vector3();
const spot = new THREE.Vector3();
const want = new THREE.Vector3();

/** Where the camera looks, how far back it stands, and how steeply it looks down. */
interface Framing {
  want: THREE.Vector3;
  distance: number;
  phi: number;
}
const framing = (): Framing => ({ want: new THREE.Vector3(), distance: 0, phi: 0 });
/** The framing at the visitor's zoom; at the zoom before this frame's change; the opening's, settling or stopped. */
const view = framing();
const before = framing();
const here = framing();

/** What the framing reads besides the zoom and the target, written at the start of each frame. */
const ctx = { aspect: 1, fov: FOV, shape: 1, portrait: 0, visiting: false, visit: 0, trail: 0, home: 0, theta: THETA };

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The view framed at `zoomIn` round `target`: the follow view, the overview it turns into pulled back, a visit and the
 * fireflies' journey, and the start beside the dais (ctx holds how far each is in this frame).
 */
function compose(out: Framing, zoomIn: number): void {
  const { aspect, fov, shape, portrait, visiting, visit, trail, home, theta } = ctx;
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomIn));
  const overview = smooth(OVERVIEW_FROM, OVERVIEW_FULL, zoom);
  // from the overview's start to all the way back, the view leaves the cart for the ring of beds
  const whole = smooth(OVERVIEW_FULL, ZOOM_MAX, zoom);
  let distance = zoom * shape;
  let phi = THREE.MathUtils.lerp(PHI - PORTRAIT_PHI * portrait, OVERVIEW_PHI, overview);
  const w = out.want;
  // the overview drifts toward the dais, and pulled right back it frames the beds round the rose
  w.copy(target).multiplyScalar((1 - overview * 0.85) * (1 - whole));
  if (whole > 0) {
    const L = meadowLayout();
    w.addScaledVector(TOWARD_CAMERA, ringFocus(distance, phi, L.beds[L.beds.length - 1].outer) * whole);
  }
  if (visiting || visit > 0.001) {
    const v = meadow.view.target;
    if (v) {
      // keep the plant in the part of the screen the card leaves clear: shift the focus toward the camera
      const elev = Math.PI / 2 - VISIT_PHI;
      const d = Math.min(VISIT_DISTANCE, distance);
      const halfV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const lift = (meadow.view.cover * d * halfV) / Math.sin(elev);
      // a card standing at the side: move the plant into the middle of the part left clear
      const side = meadow.view.coverSide * d * halfV * aspect;
      // and look at the plant's middle, not the soil under it, so a tall flower is not pushed up the screen (all of it
      // from wherever the visitor has turned the view round to)
      spot.set(v.x + Math.sin(theta) * lift + Math.cos(theta) * side, v.y * 0.85, v.z + Math.cos(theta) * lift - Math.sin(theta) * side);
      w.lerp(spot, visit);
    }
    distance = THREE.MathUtils.lerp(distance, Math.min(VISIT_DISTANCE * shape, distance), visit);
    phi = THREE.MathUtils.lerp(phi, VISIT_PHI - PORTRAIT_PHI * portrait + meadow.view.tilt, visit);
  }
  // while the fireflies lead the way, the view stands back a little so more of their trail shows
  if (trail > 0.001) distance = THREE.MathUtils.lerp(distance, Math.max(distance, JOURNEY_DISTANCE * shape), trail);
  // where the cart starts, beside the dais, the view takes in the rose as well, until the cart sets off
  if (home > 0.001) {
    w.multiplyScalar(1 - HOME_SHARE * home * (1 - overview));
    distance = THREE.MathUtils.lerp(distance, Math.max(distance, HOME_DISTANCE * shape), home);
  }
  out.distance = distance;
  out.phi = phi;
}

/** The framing at the wide view's zoom and at the start view's, and the zoom the settle has come in to. */
const wideAt = framing();
const endAt = framing();
let settleZoom = 0;

/**
 * The opening view at progress `k` (openingView.ts), from the wide view `wide` metres back to the framing `end`. Its
 * distance and pitch are the rig's own at the zoom the settle has come in to (the overview's steep look, tilting to the
 * follow view's angle as it comes in), with the start view's own small difference at the end eased across on top (its
 * distance held back by the rose, at a nearer zoom), so a stop part-way leaves the visitor's zoom exactly there with no
 * tilt to undo. The focus goes straight across, from the wide view's centring on the river ring to the start's, rather
 * than drifting toward the dais and back as the overview's would.
 */
function settleFraming(out: Framing, end: Framing, k: number, wide: number): void {
  const shape = ctx.shape;
  compose(wideAt, wide / shape);
  compose(endAt, end.distance / shape);
  settleZoom = settleDistance(k, wide, end.distance) / shape;
  compose(out, settleZoom);
  out.phi += (WIDE_PHI - wideAt.phi) * (1 - k) + (end.phi - endAt.phi) * k;
  out.distance *= Math.pow(wide / wideAt.distance, 1 - k) * Math.pow(end.distance / endAt.distance, k);
  out.want.copy(TOWARD_CAMERA).multiplyScalar(ringFocus(wide, WIDE_PHI, WIDE_RING.radius)).lerp(end.want, k);
}

export function CameraRig() {
  const rig = useRef({
    distance: 13,
    phi: PHI,
    visit: 0,
    home: 1,
    trail: 0,
    zoom0: -1,
    /**
     * The opening view: how far it has settled, when the visitor stopped it (-1 while it runs) and what of its framing
     * was left then (eased out after), the wide view's distance for the screen's shape, and whether it is over.
     */
    settle: { k: 0, elapsed: 0, stoppedAt: -1, held: new THREE.Vector3(), heldLog: 0, heldPhi: 0, aspect: 0, wide: 0, over: false },
  });
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
    const fov = fovFor(aspect);
    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const shape = 1 + PORTRAIT_GAIN * portrait + WIDE_GAIN * wide;

    // a visit eases in and out on its own slow clock
    const visiting = meadow.view.target !== null;
    r.visit += ((visiting ? 1 : 0) - r.visit) * (1 - Math.exp(-GENTLE * dt));
    // the turn round a visited plant counts only as far as the visit does, so it eases away with it; once the visit is
    // over the next one starts from the usual bearing
    if (!visiting && r.visit < 0.002) {
      meadow.view.turn = 0;
      meadow.view.tilt = 0;
    }
    const theta = THETA + meadow.view.turn * r.visit;
    r.trail += ((meadow.journey ? 1 : 0) - r.trail) * (1 - Math.exp(-GENTLE * dt));
    // the start beside the dais holds until the cart sets off (held as it is until there is a cart, so the cart
    // arriving where the view already looks moves nothing: the opening's veil can lift moments after it appears)
    const home =
      m !== null && meadow.view.target === null && Math.hypot(m.state.position.x - meadow.start.x, m.state.position.z - meadow.start.z) < HOME_RADIUS;
    if (m) r.home += ((home ? 1 : 0) - r.home) * (1 - Math.exp(-GENTLE * dt));
    ctx.aspect = aspect;
    ctx.fov = fov;
    ctx.shape = shape;
    ctx.portrait = portrait;
    ctx.visiting = visiting;
    ctx.visit = r.visit;
    ctx.trail = r.trail;
    ctx.home = r.home;
    ctx.theta = theta;
    compose(view, meadow.zoom);
    want.copy(view.want);
    let distance = view.distance;
    let phi = view.phi;

    let settling = false;
    if (!meadow.opensWide) {
      // the opening's push-in (lib/garden/opening): a little farther back under the veil, easing in to the framing as
      // the Meadow comes into focus, and stopped where it is the moment someone drives (a drag or the keys) or zooms
      if (opening.get().revealAt === null) r.zoom0 = meadow.zoom;
      if (meadow.mode === "drag" || meadow.mode === "keys" || meadow.zoom !== r.zoom0) opening.stopPush();
      distance *= opening.push(performance.now());
    } else if (!r.settle.over) {
      // the opening view: wide on the island and the river ring, then settling onto the start
      const st = r.settle;
      const o = opening.get();
      const now = performance.now();
      if (aspect !== st.aspect) {
        st.aspect = aspect;
        st.wide = wideDistance(aspect);
      }
      if (st.stoppedAt < 0) {
        // a zoom under the veil is not the visitor taking over: it only moves where the settle will come to rest
        if (settleStartAt(o) === null) r.zoom0 = meadow.zoom;
        if (stopsSettle(o, { mode: meadow.mode, zoomed: meadow.zoom !== r.zoom0, tapped: meadow.tapped })) {
          // stopped where it is: the visitor's zoom carries on from the zoom it had come in to (times whatever they
          // just zoomed by), and the little left of its own framing on top of that zoom's is held, then eased out below
          compose(before, r.zoom0);
          settleFraming(here, before, st.k, st.wide);
          const reached = settleZoom;
          compose(view, reached);
          st.held.copy(here.want).sub(view.want);
          st.heldLog = Math.log(here.distance / view.distance);
          st.heldPhi = here.phi - view.phi;
          meadow.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (reached * meadow.zoom) / r.zoom0));
          compose(view, meadow.zoom);
          st.stoppedAt = now;
        } else {
          // the settle keeps its own clock of frame time, so a hidden tab or a stall pauses it rather than jumping
          const start = settleStartAt(o);
          if (start !== null && now >= start) st.elapsed += dt * 1000;
          st.k = settleProgressAfter(o, st.elapsed);
          settleFraming(here, view, st.k, st.wide);
          want.copy(here.want);
          distance = here.distance;
          phi = here.phi;
          settling = true;
          if (st.k >= 1) st.over = true;
        }
      }
      if (st.stoppedAt >= 0) {
        const share = releaseShare(now - st.stoppedAt);
        want.copy(view.want).addScaledVector(st.held, share);
        distance = view.distance * Math.exp(st.heldLog * share);
        phi = view.phi + st.heldPhi * share;
        if (share <= 0) st.over = true;
      }
    }

    const focus = meadow.focus;
    if (meadow.snapCamera) {
      focus.copy(want);
      r.distance = distance;
      r.phi = phi;
      meadow.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-(settling ? SETTLE_SMOOTHING : r.visit > 0.01 && r.visit < 0.99 ? GENTLE * 2 : SMOOTHING) * dt);
      focus.lerp(want, k);
      r.distance += (distance - r.distance) * k;
      r.phi += (phi - r.phi) * k;
    }
    offset.setFromSphericalCoords(r.distance, r.phi, theta);
    meadow.bearing = theta;
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
    // roughly how far the view reaches across the ground, for the shadow box
    meadow.viewReach = r.distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.max(1, aspect) * 1.6;
    meadow.cameraDistance = r.distance;
  }, -1);
  return null;
}
