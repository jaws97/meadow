"use client";
// The party screen's camera: no hands on it, so no orbit controls, only a slow
// cinematic move. It rests on the garden's own composed shot for the screen's
// shape (LAYOUT.camera.framings, as the personal garden opens), aimed as the
// garden camera aims at a full-grown plant, and wanders round it on a few
// slow, unrelated sines (logic.ts drift), as if on a crane that never stops
// breathing. With the slow tour on (the hidden T key) it glides from shot to
// shot (logic.ts TourPlayer), holding each for a while, and glides home when
// the tour ends.
//
// The panel sits over the right of the screen, so the lens slides (an
// off-axis shift, camera.setViewOffset) to bring the rose into the open part
// of the frame without turning the camera: the perspective and the
// composition stay the garden's own, the picture just moves. The shift is
// eased, so when the panel is hidden the rose glides back to the middle.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { drift, TourPlayer, type Drift, type Shot } from "@/components/party/logic";
import { party } from "@/components/party/store";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { framingFor, LAYOUT, type Framing } from "@/lib/garden/layout";

/** Aspect ratios are rounded to this step, so a window resize does not re-frame every pixel. */
const ASPECT_STEP = 0.02;
const TARGET = LAYOUT.camera.target;
const TARGET_MIN = 0.2;
const TARGET_MAX = 1.05;
/** The full-grown rose's head above the mulch, metres (as CameraRig frames it). */
const FULL_HEIGHT = 1.12;
/** Inside the dressed room: past about 0.7 rad the view runs out past the hedges (CameraRig MAX_AZIMUTH). */
const MAX_AZIMUTH = 0.68;
const MIN_ELEVATION = 0.06;
const MAX_ELEVATION = 0.6;
const CAMERA_FLOOR = 0.12;
/** Per second: how quickly the aim follows the flower head, and the lens follows the panel (about three seconds). */
const HEAD_RATE = 1.5;
const SHIFT_RATE = 0.9;
/** The wander's strength, and its strength for a viewer who asks for reduced motion. */
const DRIFT_FULL = 1;
const DRIFT_REDUCED = 0.4;

const aim = new THREE.Vector3();
const gardenAim = new THREE.Vector3();
const offset = new THREE.Vector3();

/** Places the camera for shot `s` (with wander `d`) in framing `f`, round a flower head at `head`. */
function place(camera: THREE.PerspectiveCamera, f: Framing, head: THREE.Vector3, s: Readonly<Shot>, d: Readonly<Drift>) {
  const aimY = Math.min(TARGET_MAX, Math.max(TARGET_MIN, head.y * f.targetRise + f.targetLift));
  gardenAim.set(TARGET[0], aimY, TARGET[2]);
  aim.copy(gardenAim).lerp(head, s.focus);
  const azimuth = Math.min(MAX_AZIMUTH, Math.max(-MAX_AZIMUTH, f.azimuth + s.yaw + d.yaw));
  const elevation = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, f.elevation + s.lift + d.lift));
  const distance = f.distance * s.dolly * d.dolly;
  const flat = Math.cos(elevation) * distance;
  offset.set(Math.sin(azimuth) * flat, Math.sin(elevation) * distance, Math.cos(azimuth) * flat);
  camera.position.copy(aim).add(offset);
  if (camera.position.y < CAMERA_FLOOR) camera.position.y = CAMERA_FLOOR;
  camera.lookAt(aim);
  const fov = f.fov * s.zoom;
  if (Math.abs(camera.fov - fov) > 0.005) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

export function PartyCamera() {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const aspect = Math.round(width / Math.max(1, height) / ASPECT_STEP) * ASPECT_STEP;
  const framing = useMemo(() => framingFor(aspect), [aspect]);
  const live = useRef(framing);
  const tour = useMemo(() => new TourPlayer(), []);
  const head = useMemo(() => new THREE.Vector3(LAYOUT.hero[0], HERO_GROUND_Y + FULL_HEIGHT, LAYOUT.hero[2]), []);
  const wander = useMemo<Drift>(() => ({ yaw: 0, lift: 0, dolly: 1 }), []);
  const shift = useRef({ x: 0, y: 0, primed: false });
  const amount = useMemo(
    () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? DRIFT_REDUCED : DRIFT_FULL),
    [],
  );

  // Frame the garden before the first frame (and the opening's shader compile) sees the camera.
  useLayoutEffect(() => {
    live.current = framing;
    if (camera instanceof THREE.PerspectiveCamera) place(camera, framing, head, tour.current, wander);
  }, [camera, framing, head, tour, wander]);

  // After the plant (which writes env.headPos) and before the effects draw.
  useFrame((state, delta) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const dt = Math.min(delta, 0.1);
    const p = party.get();
    tour.setOn(p.tour, env.time);
    const shot = tour.step(env.time);
    head.lerp(env.headPos, 1 - Math.exp(-dt * HEAD_RATE));
    drift(env.time, amount, wander);
    place(camera, live.current, head, shot, wander);

    // The lens slides toward where the panel wants the rose; the first frame takes it as it is.
    const wantX = p.panel ? p.shiftX : 0;
    const wantY = p.panel ? p.shiftY : 0;
    const s = shift.current;
    const k = s.primed ? 1 - Math.exp(-dt * SHIFT_RATE) : 1;
    s.primed = true;
    s.x += (wantX - s.x) * k;
    s.y += (wantY - s.y) * k;
    const w = state.size.width;
    const h = state.size.height;
    if (Math.abs(s.x) < 1e-4 && Math.abs(s.y) < 1e-4) {
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
