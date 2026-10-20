"use client";
// The watering can's moment as it plays in this garden (its timings and geometry are canMoment.ts's), stepped once a
// frame from the garden's own frame callback (Garden.tsx), before the weather and the materials read it. The first
// frame it sees this page's own can in the store (canMoment, set by lib/client/plant sendCare) it latches it: where
// to pour, chosen once on the viewer's side; how the press varies; whether the can flies at all. From then on all of it
// is a function of the time since the press, so a tier swap, a remount or a tab brought back lands on the right beat.
//
// The can stays where it stands and only the soil answers when the press was first seen more than a second late (a
// hidden tab), under the loading veil, with reduced motion, when the closed rain cover stands over where it would pour,
// or with CAN_FLIES off (?can=still in the address): the soil-only version, should the moving can ever misbehave.
// A refusal from the server (the store's refusedAt) sends a can home without a snap; a cover going up or coming down
// mid-moment sends it home too, the water still reaching the plant. A press made while the can is still out waits until
// it is home, then plays from then. While the can moves, and until the wet it left has blended back into the bed, the
// render governor holds (momentHold). A cleared moment (another plant, a reset) puts the can straight back where it stands.
//
// What it leaves for the drawing: the can's pose (WateringCan), the water's rose, direction and landing, and the drips
// (CanShower), and the soil's answer (the bed's materials, the weather's moisture and standing water, the seed's light,
// the low leaves' shiver). Module state, written in place: nothing allocates per frame.
import * as THREE from "three";
import { HERO_GROUND_Y, bedRho, bedSurfaceY, planFieldstones, stoneTop, type Fieldstone } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { momentHold, quality, underVeil } from "@/lib/garden/quality";
import { garden, type CanSoil } from "@/lib/garden/store";
import { isLotus } from "@/lib/plant/species";
import {
  CAN,
  CAN_DRIP,
  CAN_ROSE,
  EXIT_SPEED,
  GRAVITY,
  canPoint,
  canPose,
  canStillAt,
  coverInTheWay,
  dripTimes,
  exitDir,
  flowOf,
  landsAt,
  momentOver,
  newPose,
  newSoil,
  POUR_FADE,
  pourEndOf,
  restPose,
  soilAt,
  stationFor,
  varyOf,
  type CanPlan,
} from "@/components/garden/garden/canMoment";

/** The moving can, on or off for everyone (off: the soil answers alone, the can stays where it stands). */
const CAN_FLIES = true;
/** A press first seen later than this (s) plays the soil's answer only. */
const LATE_S = 1;
/** How many of the last drops the shower can draw at once. */
export const DRIP_SLOTS = 4;
/** The drops swell on the rose's rim this long (s) before they fall. */
export const DRIP_SWELL = 0.3;

/** The moment's beats as they happen, for the garden's sounds (nothing listens yet: care actions are silent for now). */
export type CanBeat = "spit" | "shower" | "stop" | "drip";
const beatListeners = new Set<(beat: CanBeat) => void>();
export function onCanBeat(listener: (beat: CanBeat) => void): () => void {
  beatListeners.add(listener);
  return () => {
    beatListeners.delete(listener);
  };
}
const beat = (b: CanBeat) => beatListeners.forEach((l) => l(b));

/** Everything the drawing reads, written in place each frame. */
export const canLive = {
  /** seconds since the latched press, -1 when there is none */
  t: -1,
  /** the can's pose (at rest outside a moment) */
  pose: newPose(),
  /** the soil's answer (all quiet outside a moment) */
  soil: newSoil(),
  /** the drawn moisture when the press was seen: the weather holds it there until the water lands */
  before: 0.6,
  /** the water is in the air (the shower's parts are drawn) */
  showering: false,
  /** the water leaving the rose: where, which way (unit), how fast the rose itself moves (m/s), and its cone's sides */
  rose: new THREE.Vector3(),
  dir: new THREE.Vector3(1, 0, 0),
  roseVel: new THREE.Vector3(),
  side: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(0, 1, 0),
  /** where the shower lands now, and the height of the ground it lands on */
  land: new THREE.Vector3(),
  floorY: 0,
  /** the water from the rose, 0..1, as the shower's emitter reads it by each drop's birth */
  flowFrom: CAN.flowFrom as number,
  stopAt: -1,
  stopFade: POUR_FADE,
  /** the wet patch's centre (where the water landed), and the middle of the ring the wet runs round from (bearing) */
  patch: new THREE.Vector2(),
  ringBearing: 0,
  /** the last drops: each one's release (x, y, z where it left the rim, s from the press; w < 0 not yet), its ground */
  drips: Array.from({ length: DRIP_SLOTS }, () => new THREE.Vector4(0, 0, 0, -1)),
  dripTimes: new Float32Array(DRIP_SLOTS).fill(-1),
  dripFloor: new Float32Array(DRIP_SLOTS),
  /** each drop's velocity as it leaves the rim (m/s): the rose is still moving as the can is righted and carried */
  dripVel: Array.from({ length: DRIP_SLOTS }, () => new THREE.Vector3()),
  /** where the next drop hangs on the rose's rim now */
  hang: new THREE.Vector3(),
  /** the press now playing (epoch ms, 0 none), and its rose's height over the landing and its tip, for the veil */
  at: 0,
  fall: 0.2,
  tip: 1,
};

interface Latch {
  at: number;
  /** when its moment's clock started (epoch ms): the press, or for a press that waited for the can, its latching */
  origin: number;
  plan: CanPlan;
  soil: CanSoil;
  /** the covers as they stood at the press (a change sends the can home) */
  shade: boolean;
  cover: boolean;
  /** the beats already sent */
  sent: number;
  stones: Fieldstone[];
  release: (() => void) | null;
  /** the last frame's time and rose, for the rose's own speed */
  lastT: number;
}

let latch: Latch | null = null;
let lastSeen = 0;
/** A press made while the can was still out (it waits until the can is home), and when this page first saw it (ms). */
let waitingAt = 0;
let waitingSeen = 0;
let idle = true;
let stillParam: boolean | null = null;
/** Development only: the moment held at this many seconds from its press (for sign-off stills), or null to let it run. */
let heldAt: number | null = null;
/** The moment's time set by another clock (the party trailer's), or null to run on the wall clock. */
let drivenAt: number | null = null;

/**
 * Plays the moment on another clock: the party trailer (components/party/trailer) gives the seed its first drink on its
 * own clock, which slows on a struggling laptop rather than skipping, so the can keeps time with the picture. `t` is
 * seconds since the press; null hands the moment back to the wall clock.
 */
export function driveCan(t: number | null) {
  drivenAt = t;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** ?can=still in the address keeps the can where it stands (the soil-only version), for comparing and for safety. */
function canStillByUrl(): boolean {
  if (stillParam === null) {
    try {
      stillParam = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("can") === "still";
    } catch {
      stillParam = false;
    }
  }
  return stillParam;
}

const pt = { x: 0, y: 0, z: 0 };
const relA = newPose();
const relB = newPose();
const qa = { x: 0, y: 0, z: 0 };
const qb = { x: 0, y: 0, z: 0 };
const dirScratch = { x: 0, y: 0, z: 0 };
const prevRose = new THREE.Vector3();

/** The ground a drop falls onto at (x, z): a kerb stone's top, the bed's mulch, or the lawn. */
function groundAt(x: number, z: number, stones: readonly Fieldstone[]): number {
  let y = bedRho(x, z) < 1.02 ? Math.max(0, bedSurfaceY(x, z)) : 0;
  for (const st of stones) {
    const dx = x - st.x;
    const dz = z - st.z;
    const lx = dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw);
    const lz = dx * Math.sin(st.yaw) + dz * Math.cos(st.yaw);
    if (Math.abs(lx) < st.length * 0.45 && Math.abs(lz) < st.width * 0.45) y = Math.max(y, stoneTop(st));
  }
  return y;
}

/** The last drops' times for the plan as it stands now (a refusal mid-pour brings them forward; none if it never poured). */
function setDrips(plan: CanPlan) {
  const times = dripTimes(plan);
  for (let i = 0; i < DRIP_SLOTS; i++) {
    if (canLive.drips[i].w >= 0) continue;
    canLive.dripTimes[i] = i < times.length ? times[i] : -1;
  }
}

function toIdle() {
  if (idle) return;
  idle = true;
  canLive.t = -1;
  restPose(canLive.pose);
  const s = canLive.soil;
  s.holding = false;
  s.patch = s.ring = s.creep = s.pool = s.canWet = s.breath = s.shiver = 0;
  s.ringHalf = 0;
  s.poolHalf = Math.PI;
  canLive.showering = false;
  for (const d of canLive.drips) d.w = -1;
  for (const v of canLive.dripVel) v.set(0, 0, 0);
  canLive.dripTimes.fill(-1);
}

function drop() {
  latch?.release?.();
  latch = null;
  toIdle();
}

/** When the soil's wet has blended back into the bed for this plan (s), 0 when no water landed. */
function wetEnd(plan: CanPlan): number {
  const land = landsAt(plan);
  if (!Number.isFinite(land)) return 0;
  return plan.refusedAt >= 0 ? Math.min(land + 47, plan.refusedAt + 3) : land + 47;
}

/**
 * Latches press `m`: `seenLate` is how late after the press this page first saw it (s), `origin` when its moment's
 * clock starts (epoch ms).
 */
function begin(m: { at: number; refusedAt: number; soil: CanSoil }, camera: THREE.Camera, drawn: number, seenLate: number, origin: number): Latch {
  const s = garden.get();
  const t0 = seenLate;
  const vary = varyOf(m.at);
  const view = Math.atan2(camera.position.z, camera.position.x);
  const station = stationFor(s.growth, view, vary.sweep);
  const head = Math.max(0, env.headPos.y - HERO_GROUND_Y);
  const coverBlocks = s.cover > 0.5 && coverInTheWay(station, head);
  const still = !CAN_FLIES || canStillByUrl() || t0 > LATE_S || underVeil(quality.get()) || reducedMotion() || coverBlocks;
  const plan: CanPlan = { station, vary, still, refusedAt: m.refusedAt > 0 ? Math.max(0, (m.refusedAt - origin) / 1000) : -1, stoppedAt: -1 };
  canLive.before = drawn;
  for (const d of canLive.drips) d.w = -1;
  setDrips(plan);
  // the ring the wet runs round from: the middle of the sweep; the patch starts where the station lands
  canLive.ringBearing = station.bearing + station.sweep / 2;
  canLive.patch.set(station.r * Math.cos(canLive.ringBearing), station.r * Math.sin(canLive.ringBearing));
  canLive.floorY = station.y;
  canLive.at = m.at;
  canLive.fall = station.fall;
  canLive.tip = station.tip;
  idle = false;
  return {
    at: m.at,
    origin,
    plan,
    soil: m.soil,
    shade: s.shade > 0.5,
    cover: s.cover > 0.5,
    sent: 0,
    stones: still ? [] : planFieldstones(s.seed),
    // the governor holds while the can moves and until the wet it leaves on the soil has blended back
    release: momentHold.acquire((Math.max(canStillAt(plan) + 1, wetEnd(plan) + 1) || 1) * 1000),
    lastT: -1,
  };
}

/**
 * One frame of the moment, at wall-clock `nowMs`, seen from `camera`, with the weather's drawn moisture `drawn` (held
 * there until the water lands). Called by the garden before the weather and the materials step.
 */
export function stepCan(nowMs: number, camera: THREE.Camera, drawn: number) {
  const s = garden.get();
  const m = isLotus(s.speciesId) ? null : s.canMoment;
  if (latch && !m) drop();
  if (latch && m && m.at !== latch.at && latch.plan.still === false && canLive.t < canStillAt(latch.plan)) {
    // a newer press while the can is still out (a retry after a refusal): it waits until the can is home
    if (waitingAt !== m.at) {
      waitingAt = m.at;
      waitingSeen = nowMs;
    }
  } else if (latch && m && m.at !== latch.at) drop();
  if (!latch && m && m.at !== lastSeen) {
    lastSeen = m.at;
    // a press that waited plays from when it latches, judged late only by when this page first saw it
    const waited = waitingAt === m.at;
    latch = waited ? begin(m, camera, drawn, (waitingSeen - m.at) / 1000, nowMs) : begin(m, camera, drawn, (nowMs - m.at) / 1000, m.at);
  }
  const L = latch;
  if (!L) return toIdle();

  const t = heldAt ?? drivenAt ?? (nowMs - L.origin) / 1000;
  const plan = L.plan;
  // the server's refusal, as it arrives; a cover moved while the can is out: either brings the last drops forward
  if (m && m.at === L.at && m.refusedAt > 0 && plan.refusedAt < 0) {
    plan.refusedAt = Math.max(0, (m.refusedAt - L.origin) / 1000);
    setDrips(plan);
  }
  if (!plan.still && plan.stoppedAt < 0 && t < canStillAt(plan) && ((s.shade > 0.5) !== L.shade || (s.cover > 0.5) !== L.cover)) {
    plan.stoppedAt = Math.max(0, t);
    setDrips(plan);
  }
  if (t > momentOver(plan)) {
    drop();
    return;
  }
  if (L.release && t > Math.max(canStillAt(plan) + 0.5, wetEnd(plan))) {
    L.release();
    L.release = null;
  }

  canLive.t = t;
  const pose = canPose(plan, t, canLive.pose);
  soilAt(plan, L.soil, t, canLive.soil);

  // the water: from the rose's face along the spout's end
  canPoint(pose, CAN_ROSE.x, CAN_ROSE.y, pt);
  prevRose.copy(canLive.rose);
  canLive.rose.set(pt.x, pt.y, pt.z);
  const dt = L.lastT >= 0 ? t - L.lastT : 0;
  if (dt > 1e-4 && dt < 0.25) canLive.roseVel.subVectors(canLive.rose, prevRose).divideScalar(dt);
  else canLive.roseVel.set(0, 0, 0);
  L.lastT = t;
  exitDir(pose, dirScratch);
  canLive.dir.set(dirScratch.x, dirScratch.y, dirScratch.z);
  canLive.side.set(-canLive.dir.z, 0, canLive.dir.x).normalize();
  canLive.up.crossVectors(canLive.side, canLive.dir).normalize();
  // where a drop leaving the rose now lands on the station's ground
  const vy = EXIT_SPEED * canLive.dir.y;
  const fall = Math.max(0, canLive.rose.y - canLive.floorY);
  const ft = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * fall)) / GRAVITY;
  canLive.land.set(canLive.rose.x + EXIT_SPEED * canLive.dir.x * ft, canLive.floorY, canLive.rose.z + EXIT_SPEED * canLive.dir.z * ft);
  const flow = pose.flow;
  // the patch follows the water while it lands, and stays where it last fell
  if (flowOf(plan, t - ft) > 0.05) canLive.patch.set(canLive.land.x, canLive.land.z);
  canLive.stopAt = pourEndOf(plan);

  // the last drops: hanging on the rim, then let go from wherever the rose is at that moment
  canPoint(pose, CAN_DRIP.x, CAN_DRIP.y, pt);
  canLive.hang.set(pt.x, pt.y, pt.z);
  let dripping = false;
  for (let i = 0; i < DRIP_SLOTS; i++) {
    const at = canLive.dripTimes[i];
    if (at < 0) continue;
    const d = canLive.drips[i];
    if (t >= at && d.w < 0) {
      // let go where the rim was at its moment, moving as the rose was then (worked out from the pose, so the same at
      // any frame rate), and landing on whatever lies under its fall
      canPoint(canPose(plan, at, relA), CAN_DRIP.x, CAN_DRIP.y, qa);
      canPoint(canPose(plan, at + 0.01, relB), CAN_DRIP.x, CAN_DRIP.y, qb);
      d.set(qa.x, qa.y, qa.z, at);
      const v = canLive.dripVel[i].set((qb.x - qa.x) / 0.01, (qb.y - qa.y) / 0.01, (qb.z - qa.z) / 0.01);
      const g0 = groundAt(qa.x, qa.z, L.stones);
      const fl = (v.y + Math.sqrt(v.y * v.y + 2 * GRAVITY * Math.max(0, qa.y - g0))) / GRAVITY;
      canLive.dripFloor[i] = groundAt(qa.x + v.x * fl, qa.z + v.z * fl, L.stones);
      beat("drip");
    }
    if (t >= at - DRIP_SWELL && t < at + 0.9) dripping = true;
  }
  canLive.showering = !plan.still && (flow > 0.001 || flowOf(plan, t - 0.4) > 0.001 || dripping);

  // the beats, once each
  if (!plan.still) {
    if (L.sent === 0 && flow > 0) {
      L.sent = 1;
      beat("spit");
    }
    if (L.sent === 1 && flow > 0.9) {
      L.sent = 2;
      beat("shower");
    }
    if (L.sent >= 1 && L.sent < 3 && flow <= 0 && t > 2.7) {
      L.sent = 3;
      beat("stop");
    }
  }
}

/** Development only: play the moment on the plant as the store holds it, with the soil as it was (`soil`). */
function rehearse(soil: CanSoil = "ok") {
  garden.set({ canMoment: { at: Date.now(), refusedAt: 0, soil } });
}
/** Development only: refuse the moment playing now. */
function refuse() {
  const m = garden.get().canMoment;
  if (m && !m.refusedAt) garden.set({ canMoment: { ...m, refusedAt: Date.now() } });
}
/** Development only: hold the moment at `t` seconds from its press (null lets it run on). */
function hold(t: number | null) {
  heldAt = process.env.NODE_ENV !== "production" ? t : null;
}
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __canMoment?: unknown }).__canMoment = { rehearse, refuse, hold, live: canLive };
}
