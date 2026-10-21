"use client";
// The party screen's camera: no hands on it, so no orbit controls, only a slow
// cinematic move. It rests on the garden's own composed shot for the screen's
// shape (LAYOUT.camera.framings, as the personal garden opens), aimed as the
// garden camera aims at a full-grown plant, and wanders round it on a few
// slow, unrelated sines (logic.ts drift), as if on a crane that never stops
// breathing. With the slow tour on (the hidden T key) it glides from shot to
// shot (logic.ts TourPlayer), holding each for a while, and glides home when
// the tour ends. Where a shot puts the camera is worked out from scratch each
// frame by logic.ts placeShot, a pure function the tests run too.
//
// The panel sits over the right of the screen, so the lens slides (an
// off-axis shift, camera.setViewOffset) to bring the rose into the open part
// of the frame without turning the camera: the perspective and the
// composition stay the garden's own, the picture just moves. The shift is
// eased, so when the panel is hidden the rose glides back to the middle.
//
// While the party trailer plays (components/party/trailer) the camera takes the
// trailer's shot instead of the tour's, frame by frame, still breathing on the
// same wander, with the trailer's wider limits (it looks up at a bloom from
// below and straight down into the bed) and its lens: a pan toward a point of
// its own (the can, the sky, the doe), its own lens shift, taken at once, and,
// for a shot that rides the growing stem, the flower head as it stands rather
// than eased. Under the trailer's black dips it takes a new flower's head at
// once. Once the trailer has put the garden back (still under its black) the
// lens takes the panel's shift, at once while the head snaps, so the rose the
// black lifts on stands exactly where the trailer's last seed stood.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ASPECT_STEP, drift, placed, placeShot, TourPlayer, type Drift, type Placed, type Shot } from "@/components/party/logic";
import { party } from "@/components/party/store";
import { trailer, trailerCam } from "@/components/party/trailer/store";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";

/** The full-grown rose's head above the mulch, metres (as CameraRig frames it). */
const FULL_HEIGHT = 1.12;
/** Per second: how quickly the aim follows the flower head, and the lens follows the panel (about three seconds). */
const HEAD_RATE = 1.5;
const SHIFT_RATE = 0.9;
/** The wander's strength, and its strength for a viewer who asks for reduced motion. */
const DRIFT_FULL = 1;
const DRIFT_REDUCED = 0.4;
/** A lens shift smaller than this (a share of the frame) is no shift: the view offset is cleared. */
const SHIFT_CLEAR = 1e-4;

/** Applies a placing to the camera: where it stands, what it looks at, and its lens angle. */
function apply(camera: THREE.PerspectiveCamera, at: Readonly<Placed>) {
  camera.position.set(at.position.x, at.position.y, at.position.z);
  camera.lookAt(at.look.x, at.look.y, at.look.z);
  if (Math.abs(camera.fov - at.fov) > 0.005) {
    camera.fov = at.fov;
    camera.updateProjectionMatrix();
  }
}

export function PartyCamera() {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = Math.round(width / Math.max(1, height) / ASPECT_STEP) * ASPECT_STEP;
  const framing = useMemo(() => framingFor(aspect), [aspect]);
  const live = useRef<Framing>(framing);
  const tour = useMemo(() => new TourPlayer(), []);
  const head = useMemo(() => new THREE.Vector3(LAYOUT.hero[0], HERO_GROUND_Y + FULL_HEIGHT, LAYOUT.hero[2]), []);
  const wander = useMemo<Drift>(() => ({ yaw: 0, lift: 0, dolly: 1 }), []);
  const at = useMemo(() => placed(), []);
  const shift = useRef({ x: 0, y: 0, primed: false });
  const amount = useMemo(
    () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? DRIFT_REDUCED : DRIFT_FULL),
    [],
  );

  // Frame the garden before the first frame (and the opening's shader compile) sees the camera.
  useLayoutEffect(() => {
    live.current = framing;
    if (camera instanceof THREE.PerspectiveCamera) apply(camera, placeShot(framing, head, tour.current, wander, at));
  }, [camera, framing, head, tour, wander, at]);

  // After the plant (which writes env.headPos and env.crownPos) and before the effects draw.
  useFrame((state, delta) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const dt = Math.min(delta, 0.1);
    const p = party.get();
    const active = trailerCam.active;
    let shot: Readonly<Shot>;
    if (active) shot = trailerCam.shot;
    else {
      tour.setOn(p.tour, env.time);
      shot = tour.step(env.time);
    }
    // the plant's crown: the flower head, or the tip of a jasmine's cluster, so its shots stand as they were composed
    const snapping = trailerCam.snapFrames > 0;
    if (snapping) trailerCam.snapFrames--;
    if (snapping || (active && trailerCam.lens.follow)) head.copy(env.crownPos);
    else head.lerp(env.crownPos, 1 - Math.exp(-dt * HEAD_RATE));
    drift(env.time, amount, wander);
    apply(camera, placeShot(live.current, head, shot, wander, at, active ? trailerCam.lens : null, active));

    // The lens: the trailer's own while it drives the camera, at once; otherwise the panel's, whenever the panel shows
    // or the trailer is still on and the panel will return (it has put the garden back under its black), eased as the
    // panel comes and goes, at once while the head snaps. The first frame takes it as it is.
    const s = shift.current;
    let wantX = 0;
    let wantY = 0;
    if (active) {
      wantX = trailerCam.lens.shiftX;
      wantY = trailerCam.lens.shiftY;
    } else if (p.panel || (trailer.get().phase !== "idle" && trailerCam.panelBack)) {
      wantX = p.shiftX;
      wantY = p.shiftY;
    }
    const k = s.primed && !active && !snapping ? 1 - Math.exp(-dt * SHIFT_RATE) : 1;
    s.primed = true;
    s.x += (wantX - s.x) * k;
    s.y += (wantY - s.y) * k;
    const w = state.size.width;
    const h = state.size.height;
    if (Math.abs(s.x) < SHIFT_CLEAR && Math.abs(s.y) < SHIFT_CLEAR) {
      if (camera.view?.enabled) camera.clearViewOffset();
    } else {
      const v = camera.view;
      const ox = s.x * w;
      const oy = s.y * h;
      if (!v || !v.enabled || v.fullWidth !== w || v.fullHeight !== h || Math.abs(v.offsetX - ox) > 0.05 || Math.abs(v.offsetY - oy) > 0.05) {
        camera.setViewOffset(w, h, ox, oy, w, h);
      }
    }
  });

  return null;
}
