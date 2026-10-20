"use client";
// Photographs the colleague's own flower for the bloom card (components/care/BloomSheet): the garden as it would look at
// golden hour, the flower fully open, framed for the card by the flower's own face (lib/garden/cardAim). It happens in
// the garden's frame loop, behind a still of the frame on screen, in a few frames:
//
//   light   the full light set is pinned (the low sun's leak and the rim on the bloom need it) and, at midday when the
//           day set is live, given up to eight seconds to be prepared in the background;
//   hold    the frame just drawn is held over the canvas (frameHold), the camera's pose and the canvas's size are kept,
//           the canvas takes the card's shape with no more pixels than it had, and the card's light, the open flower
//           and the empty bed (no doe, no covers) begin (lib/garden/cardShot);
//   open    the flower has been drawn open: the shot is solved from its head and the rig hands the camera to it;
//   draw    three frames on the card's shot (the first may compile), the last read straight after the composer, while
//           its drawing buffer still holds it, into the card's 1080 x 1350 photograph; then everything is put back as
//           it was, in the same callback;
//   settle  three ordinary frames behind the still, which then dissolves into a garden that never moved.
//
// The render governor is held throughout (momentHold), and a tier prepared out of sight waits (cardShot.busy). A page
// timer watches the frames: a hidden tab or a lost context puts everything back and the request fails, calmly.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { holdFrame, isHolding, releaseFrame } from "@/components/garden/frameHold";
import { canSwitchSets, lightSet } from "@/components/garden/lightSets";
import { tierStage } from "@/components/garden/TierLayers";
import { weather } from "@/components/garden/garden/weather";
import { aimLotus, CARD_ASPECT, cardDirectionFor, cardDistance, cardPoseFrom, silhouette, type CardPose, type Silhouette } from "@/lib/garden/cardAim";
import { cardShot, type CardLight } from "@/lib/garden/cardShot";
import { env } from "@/lib/garden/env";
import { momentHold, quality, underVeil } from "@/lib/garden/quality";
import { lanternAlong, roomAlong } from "@/lib/garden/room";
import { garden } from "@/lib/garden/store";
import { isLotus } from "@/lib/plant/species";
import { goldenHour } from "@/lib/sky/sun";

export const CARD_W = 1080;
export const CARD_H = 1350;
/** The longest wait for the full light set; after it the card is taken anyway (golden, without the leak and the rim). */
const LIGHT_WAIT_MS = 8000;
const DRAW_FRAMES = 3;
const SETTLE_FRAMES = 3;
const DISSOLVE_MS = 450;
/** No frame for this long (a hidden tab), or the whole capture this long: everything is put back. */
const STALL_MS = 3000;
const MAX_MS = 16_000;
/** What steps out of the card's picture: the doe (components/deer/Doe) and the shade cloth or rain cover (BedCovers). */
const HIDDEN = new Set(["deer", "bed-covers"]);
/** A view whose room (lib/garden/room) falls this far short of the camera's distance is passed over for another. */
const ROOM_SHARE = 0.85;

type Stage = "light" | "hold" | "open" | "draw" | "settle";

interface Saved {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  aspect: number;
  zoom: number;
  view: THREE.PerspectiveCamera["view"];
  dpr: number;
  width: number;
  height: number;
  focus: THREE.Vector3 | null;
  /** the weather's eased surfaces as they were: given back as they were, not re-primed to where they are heading */
  weather: Pick<typeof weather, "wet" | "moisture" | "standing" | "lit">;
}

interface Job {
  stage: Stage;
  frames: number;
  started: number;
  lastFrame: number;
  out: HTMLCanvasElement;
  resolve: (c: HTMLCanvasElement) => void;
  reject: (e: Error) => void;
  release: () => void;
  saved: Saved | null;
  /** the light set's pin before this capture pinned the full set */
  pinBefore: boolean | null;
  hidden: THREE.Object3D[];
  restore: (() => void) | null;
}

let job: Job | null = null;
let mounted = 0;
const focus = new THREE.Vector3();
const pose: CardPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 };
const sil: Silhouette = { centre: new THREE.Vector3(), width: 0, height: 0 };
const axis = new THREE.Vector3();
const view = new THREE.Vector3();
const point = new THREE.Vector3();
const quat = new THREE.Quaternion();
const cssSize = new THREE.Vector2();

/** The card's light: today's golden hour, a fair sky, no rain, no more than a breath of wind. */
export function cardLight(now = new Date(), wind = garden.get().wind): CardLight {
  return { hour: goldenHour(now), cloud: 0.15, rain: 0, wind: Math.min(wind, 0.3) };
}

/** Why a photograph cannot be taken just now (null: it can). */
export function cardBlocked(): string | null {
  if (mounted === 0) return "no-garden";
  if (job) return "busy";
  const q = quality.get();
  if (q.phase !== "live" || underVeil(q)) return "not-showing";
  if (document.visibilityState !== "visible") return "hidden";
  if (isHolding() || momentHold.active() || tierStage.get().preparing !== null) return "busy";
  return null;
}

/**
 * Photographs the flower for the card into `out` (made 1080 x 1350). Fails (an Error whose message is the reason) when
 * the garden is not showing, is busy with a moment or a change of picture, or stops drawing midway.
 */
export function requestCardPhoto(out: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const blocked = cardBlocked();
  if (blocked) return Promise.reject(new Error(blocked));
  return new Promise((resolve, reject) => {
    const now = performance.now();
    job = {
      stage: "light",
      frames: 0,
      started: now,
      lastFrame: now,
      out,
      resolve,
      reject,
      release: momentHold.acquire(MAX_MS + 4000),
      saved: null,
      pinBefore: lightSet.pin,
      hidden: [],
      restore: null,
    };
    cardShot.busy = true;
  });
}

function finish(j: Job, error: Error | null) {
  j.restore?.();
  j.restore = null;
  lightSet.pin = j.pinBefore;
  j.release();
  cardShot.busy = false;
  if (job === j) job = null;
  if (error) j.reject(error);
  else j.resolve(j.out);
}

/**
 * Every point of the head's visible parts as drawn, in world space (the petals' open shape is a morph, which the
 * geometry's own bounds do not know). Once per card, a few thousand points.
 */
function eachPoint(body: THREE.Object3D, visit: (pt: THREE.Vector3) => void) {
  body.updateWorldMatrix(true, true);
  body.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) visit(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld));
  });
}

/** Copies the centred card-shaped part of what the canvas holds into the photograph. */
function readPhoto(src: HTMLCanvasElement, out: HTMLCanvasElement): boolean {
  const ctx = out.getContext("2d");
  if (!ctx || src.width === 0 || src.height === 0) return false;
  out.width = CARD_W;
  out.height = CARD_H;
  const wide = src.width / src.height > CARD_ASPECT;
  const sw = wide ? src.height * CARD_ASPECT : src.width;
  const sh = wide ? src.height : src.width / CARD_ASPECT;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, CARD_W, CARD_H);
  return true;
}

export function CardCamera() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);

  useEffect(() => {
    mounted++;
    // a page timer, not the frame loop: a hidden tab stops the frames, and the garden must still be put back
    const watch = window.setInterval(() => {
      const j = job;
      if (!j) return;
      const now = performance.now();
      if (now - j.lastFrame > STALL_MS || now - j.started > MAX_MS) {
        finish(j, new Error("stalled"));
        if (isHolding()) releaseFrame(0);
      }
    }, 500);
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __cardPhoto?: () => Promise<string> }).__cardPhoto = () =>
        requestCardPhoto(document.createElement("canvas")).then((c) => c.toDataURL("image/jpeg", 0.92));
    }
    return () => {
      mounted--;
      window.clearInterval(watch);
      if (job) finish(job, new Error("no-garden"));
    };
  }, []);

  // before the composer: whatever stepped out of the picture stays out (the doe's own visibility is re-applied on any
  // change of the quality store, the covers' each frame)
  useFrame(() => {
    const j = job;
    if (!j || !cardShot.active) return;
    scene.traverse((o) => {
      if (HIDDEN.has(o.name) && o.visible) {
        o.visible = false;
        if (!j.hidden.includes(o)) j.hidden.push(o);
      }
    });
  }, 0.5);

  // straight after the composer, while the frame is still in the drawing buffer
  useFrame(() => {
    const j = job;
    if (!j) return;
    const now = performance.now();
    j.lastFrame = now;
    const canvas = gl.domElement;

    if (j.stage === "light") {
      lightSet.pin = true;
      if (lightSet.full || !canSwitchSets(gl) || now - j.started > LIGHT_WAIT_MS) j.stage = "hold";
      return;
    }

    if (j.stage === "hold") {
      if (gl.getContext().isContextLost() || !holdFrame(canvas)) return finish(j, new Error("no-still"));
      const cam = camera as THREE.PerspectiveCamera;
      gl.getSize(cssSize);
      const saved: Saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fov: cam.fov,
        aspect: cam.aspect,
        zoom: cam.zoom,
        view: cam.view ? { ...cam.view } : null,
        dpr: gl.getPixelRatio(),
        width: cssSize.x,
        height: cssSize.y,
        focus: env.focus,
        weather: { wet: weather.wet, moisture: weather.moisture, standing: weather.standing, lit: weather.lit },
      };
      j.saved = saved;
      j.restore = () => {
        cardShot.active = false;
        cardShot.aimed = false;
        cardShot.light = null;
        for (const o of j.hidden) o.visible = true;
        j.hidden.length = 0;
        // the canvas's size and pixel ratio as the page has them now (a turn of the phone mid-capture is R3F's to
        // apply, and it may have), not as they were when the capture began
        const now = get();
        const resized = now.size.width !== saved.width || now.size.height !== saved.height;
        gl.setPixelRatio(now.viewport.dpr);
        gl.setSize(now.size.width, now.size.height, false);
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        cam.fov = saved.fov;
        cam.aspect = resized ? now.size.width / Math.max(1, now.size.height) : saved.aspect;
        cam.zoom = saved.zoom;
        // (the rig lays its lens shift again each frame, at whatever size the page is)
        const v = saved.view;
        if (v && v.enabled && !resized) cam.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
        else cam.clearViewOffset();
        cam.updateProjectionMatrix();
        camera.updateMatrixWorld();
        env.focus = saved.focus;
        Object.assign(weather, saved.weather);
        weather.primed = true;
        lightSet.pin = j.pinBefore;
      };
      // the card's shape, with no more pixels than the canvas has now (so no more memory than the device already uses)
      const pixels = Math.min(CARD_W * CARD_H, canvas.width * canvas.height);
      const cw = Math.round(Math.sqrt(pixels * CARD_ASPECT));
      const ch = Math.round(cw / CARD_ASPECT);
      const ratio = ch / Math.max(1, saved.height);
      gl.setPixelRatio(ratio);
      gl.setSize(cw / ratio, saved.height, false);
      cardShot.light = cardLight();
      cardShot.aimed = false;
      cardShot.active = true;
      // the lantern's glow, the wet and the soil's colour answer the card's light at once, not over seconds
      weather.primed = false;
      j.stage = "open";
      j.frames = 0;
      return;
    }

    if (j.stage === "open") {
      // where the visitor's camera stands, kept now rather than with the rest: the frame before, the scenery may have
      // drawn it from nearer than they put it (CameraRig keepRoom), and has since put it back
      j.saved?.position.copy(camera.position);
      j.saved?.quaternion.copy(camera.quaternion);
      // the flower has been drawn open and standing: aim at it as it now is
      const lotus = isLotus(garden.get().speciesId);
      const head = cardShot.head;
      const body = cardShot.headBody;
      if (!lotus && head && body) {
        const species = garden.get().speciesId;
        head.getWorldQuaternion(quat);
        axis.set(0, 1, 0).applyQuaternion(quat);
        cardDirectionFor(species, axis, view);
        silhouette((visit) => eachPoint(body, visit), view, sil);
        if (sil.width <= 0) {
          sil.centre.copy(env.headPos);
          sil.width = 0.4;
          sil.height = 0.3;
        }
        // the scenery: a view with no room to stand back that far (a hedge, the arch, a tree), or that would look at the
        // flower past the lantern, is passed over
        const { x: cx, y: cy, z: cz } = sil.centre;
        const want = cardDistance(sil);
        const roomOk = (d: THREE.Vector3) =>
          roomAlong(cx, cy, cz, d.x, d.y, d.z, want) >= want * ROOM_SHARE && lanternAlong(cx, cy, cz, d.x, d.y, d.z, want) >= want * ROOM_SHARE;
        if (!roomOk(view)) {
          cardDirectionFor(species, axis, view, roomOk);
          const { width, height } = sil;
          silhouette((visit) => eachPoint(body, visit), view, sil);
          if (sil.width <= 0) Object.assign(sil, { width, height }).centre.set(cx, cy, cz);
        }
        focus.copy(sil.centre);
        cardPoseFrom(sil, view, pose, (d) =>
          Math.min(roomAlong(focus.x, focus.y, focus.z, view.x, view.y, view.z, d), lanternAlong(focus.x, focus.y, focus.z, view.x, view.y, view.z, d)),
        );
      } else {
        focus.copy(env.headPos);
        aimLotus(focus, pose);
      }
      cardShot.position.copy(pose.position);
      cardShot.target.copy(pose.target);
      cardShot.fov = pose.fov;
      cardShot.aspect = canvas.width / Math.max(1, canvas.height);
      cardShot.aimed = true;
      env.focus = focus;
      j.stage = "draw";
      j.frames = 0;
      return;
    }

    if (j.stage === "draw") {
      if (++j.frames < DRAW_FRAMES) return;
      // a page resized mid-capture has been drawn at its new shape, not the card's: asked again in a moment
      const size = get().size;
      const resized = j.saved !== null && (size.width !== j.saved.width || size.height !== j.saved.height);
      const ok = !resized && !gl.getContext().isContextLost() && readPhoto(canvas, j.out);
      j.restore?.();
      j.restore = null;
      if (!ok) {
        releaseFrame(0);
        return finish(j, new Error(resized ? "resized" : "unreadable"));
      }
      j.stage = "settle";
      j.frames = 0;
      return;
    }

    // settle: ordinary frames behind the still, then it dissolves
    if (++j.frames < SETTLE_FRAMES) return;
    releaseFrame(DISSOLVE_MS);
    finish(j, null);
  }, 1.5);

  return null;
}
