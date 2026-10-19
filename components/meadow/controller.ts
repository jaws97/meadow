// The per-frame brain of the Meadow, run before physics steps: it reads the input, turns taps into visits or
// autopilot goals, answers the overlay's requests (a visit from the find panel, "Skip", closing a card), decides which
// of keys, drag or autopilot is driving, and writes one Command for the Mover. It also owns the recoveries that are
// not the vehicle's own business: falling off the world, the "Unstuck" offer, and the fade that hides a respawn or a
// skip to the end of a journey.
//
// Priority among inputs: keys, then a live drag, then the autopilot. Keys or a drag cancel the autopilot (and any
// journey), so the player can always take over.
// The stuck test and drag mapping follow Bruno Simon's folio-2025 (MIT):
// approach adapted from PhysicsVehicle.js (stuck) and Player.js / Nipple.js (drag).
import * as THREE from "three";
import { Autopilot, ROSE, type VisitTarget } from "@/components/meadow/autopilot";
import { ZOOM_MAX, ZOOM_MIN } from "@/components/meadow/CameraRig";
import { meadowData } from "@/components/meadow/data";
import { MeadowInput } from "@/components/meadow/input";
import { DAIS, inWater, meadowLayout, nearestPathNode, tangentYaw } from "@/components/meadow/layout";
import { setWheel, setWish, type Mover } from "@/components/meadow/mover";
import { plantCentre, plotTarget, roseTarget, ROSE_HEAD_Y } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { ui } from "@/components/meadow/ui";

/** Drag: no pull inside this many pixels of the cart, full pull at the outer radius. */
export const DRAG_DEAD_PX = 32;
export const DRAG_FULL_PX = 150;
export const DRAG_CURVE = 1.6;
/** A tap this close to a plant (on screen) visits it instead of driving to the ground. */
const PLOT_PICK_PX = 40;

const STUCK_WINDOW = 3;
const STUCK_DISTANCE = 0.5;
const FALL_Y = -2;
const FADE_OUT = 0.35;
const FADE_HOLD = 0.12;
const FADE_IN = 0.5;
/** A parked visit stays "here" until the cart has moved this far. */
const LEAVE_PARK = 1.2;

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const proj = new THREE.Vector3();

export interface ViewSize {
  width: number;
  height: number;
}

export class MeadowController {
  readonly input = new MeadowInput();
  readonly autopilot = new Autopilot();

  private keys = { throttle: 0, steer: 0 };
  private stuckSamples: Array<[number, number]> = [];
  private lastPos = new THREE.Vector3();
  private lastPosValid = false;
  private fadePhase: "idle" | "out" | "hold" | "in" = "idle";
  private fadeT = 0;
  /** Where a fade lands the body: a path node (respawn) or the end of a journey (skip). */
  private fadeTo: { x: number; z: number; yaw: number; target: VisitTarget | null } | null = null;
  private routeVersion = -1;
  /** The visit the cart is on or has pulled up for, and where it stopped. */
  private visiting: VisitTarget | null = null;
  private parked: { index: number; x: number; z: number } | null = null;

  frame(camera: THREE.Camera, size: ViewSize, dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    const input = this.input;
    input.update(performance.now());
    if (input.zoomFactor !== 1) meadow.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, meadow.zoom * input.zoomFactor));

    const m = meadow.mover;
    if (!m) {
      input.endFrame();
      return;
    }

    if (input.respawnPressed || meadow.requests.respawn || meadow.requests.unstuck) this.beginFade(null);
    meadow.requests.respawn = false;
    meadow.requests.unstuck = false;
    // off the world, or (should anything ever find a way past the copings) in the river: back to the nearest path
    if (m.state.position.y < FALL_Y || inWater(m.state.position.x, m.state.position.z)) this.beginFade(null);
    this.answerRequests(m);

    if (this.fadePhase !== "idle") {
      this.runFade(m, dt);
      setWheel(m.command, 0, 0, 1);
      meadow.mode = "idle";
      meadow.finger.active = false;
      input.endFrame();
      this.publishRoute();
      return;
    }

    if (input.hopPressed) m.hop();
    for (const tap of input.taps) this.handleTap(tap.x, tap.y, camera, size, m);

    const cmd = m.command;
    meadow.finger.active = false;
    if (input.keyAxes(this.keys)) {
      this.takeOver();
      setWheel(cmd, this.keys.throttle, this.keys.steer, 0);
      meadow.mode = "keys";
    } else if (input.drag.active) {
      this.takeOver();
      this.dragDrive(m, camera, size);
      meadow.mode = "drag";
    } else if (this.autopilot.update(m, dt, cmd)) {
      meadow.mode = "autopilot";
    } else {
      setWheel(cmd, 0, 0, 0);
      meadow.mode = "idle";
    }
    if (!this.autopilot.active) {
      meadow.goal.active = false;
      meadow.targetPlot = -1;
    }

    this.trackArrival(m);
    this.trackStuck(m, dt);
    this.publishView();
    meadow.stats.speed = m.state.speed;
    this.publishRoute();
    input.endFrame();
  }

  /** Starts a visit to a plant or the rose: the cart drives there; a journey lights the way with fireflies. */
  private visit(target: VisitTarget, m: Mover, journey: boolean): void {
    const from = { x: m.state.position.x, z: m.state.position.z };
    this.visiting = target;
    this.parked = null;
    const park = this.autopilot.visit(from, target, m);
    meadow.targetPlot = target.index;
    meadow.journey = journey && this.autopilot.active;
    meadow.goal = { active: this.autopilot.active, x: park.x, z: park.z };
  }

  private answerRequests(m: Mover): void {
    const r = meadow.requests;
    if (r.visit) {
      const { index, journey } = r.visit;
      r.visit = null;
      const target = index === ROSE ? roseTarget(m.state.position) : plotTarget(index);
      if (target) this.visit(target, m, journey);
    }
    if (r.teleport) {
      r.teleport = false;
      const t = this.visiting;
      if (t && this.autopilot.active) {
        const yaw = tangentYaw(Math.atan2(t.park.z, t.park.x));
        this.beginFade({ x: t.park.x, z: t.park.z, yaw, target: t });
      }
    }
    if (r.cancel) {
      r.cancel = false;
      this.autopilot.cancel();
      this.visiting = null;
      meadow.journey = false;
    }
  }

  /** The player has the wheel: no autopilot, no journey. A card for a plant already reached stays open. */
  private takeOver(): void {
    if (!this.autopilot.active) return;
    this.autopilot.cancel();
    this.visiting = null;
    meadow.journey = false;
    if (ui.get().journey) ui.set({ journey: null });
  }

  private handleTap(x: number, y: number, camera: THREE.Camera, size: ViewSize, m: Mover): void {
    // a plant: the nearest on screen within reach of the finger
    let best = -1;
    let bestD = PLOT_PICK_PX;
    for (const p of meadowData.get().byPlot.values()) {
      const c = plantCentre(p);
      if (!c) continue;
      proj.set(c.x, c.y, c.z).project(camera);
      if (proj.z > 1) continue;
      const d = Math.hypot((proj.x * 0.5 + 0.5) * size.width - x, (0.5 - proj.y * 0.5) * size.height - y);
      if (d < bestD) {
        bestD = d;
        best = p.plot;
      }
    }
    if (best >= 0) {
      const target = plotTarget(best);
      if (target) {
        this.visit(target, m, false);
        ui.set({ card: best, journey: null, findOpen: false });
      }
      return;
    }
    // the rose: a tap on the dais, or on the rose standing above it
    proj.set(0, ROSE_HEAD_Y * 0.7, 0).project(camera);
    const roseD = Math.hypot((proj.x * 0.5 + 0.5) * size.width - x, (0.5 - proj.y * 0.5) * size.height - y);
    const onDais = this.groundUnder(x, y, DAIS.h, camera, size) && Math.hypot(hit.x, hit.z) < DAIS.r;
    if (onDais || roseD < PLOT_PICK_PX * 1.6) {
      this.visit(roseTarget(m.state.position), m, false);
      ui.set({ card: ROSE, journey: null, findOpen: false });
      return;
    }
    if (!this.groundUnder(x, y, 0, camera, size)) return;
    if (Math.hypot(hit.x, hit.z) > meadowLayout().hedgeR + 4) return;
    const goal = this.autopilot.goTo({ x: m.state.position.x, z: m.state.position.z }, hit.x, hit.z);
    this.visiting = null;
    this.parked = null;
    meadow.journey = false;
    meadow.targetPlot = -1;
    meadow.goal = { active: true, x: goal.x, z: goal.z };
    // driving off closes the card
    if (ui.get().card !== null || ui.get().journey) ui.set({ card: null, journey: null });
  }

  /** A finished visit: the cart is parked beside the plant; a journey's card opens now. */
  private trackArrival(m: Mover): void {
    const ap = this.autopilot;
    const s = m.state;
    if (ap.arrivedAt !== null) {
      const index = ap.arrivedAt;
      ap.arrivedAt = null;
      this.parked = { index, x: s.position.x, z: s.position.z };
      this.visiting = null;
      meadow.journey = false;
      const u = ui.get();
      if (u.journey && u.journey.index === index) ui.set({ card: index, journey: null });
    }
    if (this.parked && (ap.active || Math.hypot(s.position.x - this.parked.x, s.position.z - this.parked.z) > LEAVE_PARK)) {
      this.parked = null;
    }
    meadow.nearPlot = this.parked ? this.parked.index : -1;
  }

  /** The camera frames the plant whose card is open once the cart has pulled up beside it. */
  private publishView(): void {
    const card = ui.get().card;
    const parkedHere = this.parked !== null && this.parked.index === card;
    if (card === null || !parkedHere) {
      meadow.view.target = null;
      return;
    }
    if (card === ROSE) {
      meadow.view.target = { x: 0, y: ROSE_HEAD_Y * 0.75, z: 0 };
      return;
    }
    const p = meadowData.get().byPlot.get(card);
    const c = p ? plantCentre(p) : null;
    meadow.view.target = c;
  }

  /** Drive toward the finger: the pull grows with its on-screen distance from the cart. */
  private dragDrive(m: Mover, camera: THREE.Camera, size: ViewSize): void {
    const s = m.state;
    const cmd = m.command;
    proj.copy(s.position).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * size.width;
    const sy = (0.5 - proj.y * 0.5) * size.height;
    const px = Math.hypot(this.input.drag.x - sx, this.input.drag.y - sy);
    const progress = Math.min(1, Math.max(0, (px - DRAG_DEAD_PX) / (DRAG_FULL_PX - DRAG_DEAD_PX)));
    const power = Math.pow(progress, DRAG_CURVE);
    // Intersect at the body's own height so the direction matches what the eye sees.
    const h = Math.min(1.2, Math.max(0, s.position.y));
    if (!this.groundUnder(this.input.drag.x, this.input.drag.y, h, camera, size)) {
      setWheel(cmd, 0, 0, 0);
      return;
    }
    const dx = hit.x - s.position.x;
    const dz = hit.z - s.position.z;
    if (power > 0) setWish(cmd, dx, dz, power);
    else setWheel(cmd, 0, 0, 0);
    meadow.finger.active = true;
    meadow.finger.x = hit.x;
    meadow.finger.z = hit.z;
    meadow.finger.power = power;
  }

  private groundUnder(x: number, y: number, height: number, camera: THREE.Camera, size: ViewSize): boolean {
    ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -height;
    return ray.ray.intersectPlane(plane, hit) !== null;
  }

  /**
   * "Unstuck" is offered after three seconds of trying to move without covering half a metre. Samples are only
   * taken while the cart is being asked to move, so a parked cart is never "stuck".
   */
  private trackStuck(m: Mover, dt: number): void {
    const p = m.state.position;
    const moved = this.lastPosValid ? Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) : 0;
    this.lastPos.copy(p);
    this.lastPosValid = true;
    const c = m.command;
    // The autopilot never asks for more than half throttle, so its "trying" counts from 0.45.
    const trying = c.kind === "wheel" ? Math.abs(c.throttle) >= 0.45 : c.power > 0.5;
    if (trying) {
      this.stuckSamples.unshift([moved, dt]);
      let time = 0;
      for (let i = 0; i < this.stuckSamples.length; i++) {
        if (time >= STUCK_WINDOW) {
          this.stuckSamples.length = i;
          break;
        }
        time += this.stuckSamples[i][1];
      }
    }
    let distance = 0;
    let duration = 0;
    for (const [d, t] of this.stuckSamples) {
      distance += d;
      duration += t;
    }
    meadow.stuck = duration >= STUCK_WINDOW && distance < STUCK_DISTANCE;
  }

  /** Fades out, moves the body (to the nearest path node, or to the end of a journey), and fades back in. */
  private beginFade(to: { x: number; z: number; yaw: number; target: VisitTarget | null } | null): void {
    if (this.fadePhase !== "idle") return;
    this.fadePhase = "out";
    this.fadeT = 0;
    this.fadeTo = to;
    this.autopilot.cancel();
    meadow.journey = false;
  }

  private runFade(m: Mover, dt: number): void {
    this.fadeT += dt;
    if (this.fadePhase === "out") {
      meadow.fade = Math.min(1, this.fadeT / FADE_OUT);
      if (this.fadeT >= FADE_OUT) {
        const to = this.fadeTo;
        if (to) {
          m.respawn(to.x, to.z, to.yaw);
          if (to.target) {
            m.face?.(to.target.x, to.target.z);
            this.autopilot.arrivedAt = to.target.index;
          }
        } else {
          const node = nearestPathNode(m.state.position.x, m.state.position.z);
          m.respawn(node.x, node.z, node.yaw);
        }
        meadow.snapCamera = true;
        this.stuckSamples.length = 0;
        this.lastPosValid = false;
        meadow.stuck = false;
        this.fadePhase = "hold";
        this.fadeT = 0;
      }
    } else if (this.fadePhase === "hold") {
      meadow.fade = 1;
      if (this.fadeT >= FADE_HOLD) {
        this.fadePhase = "in";
        this.fadeT = 0;
        // the arrival a skip set up is read now, with the body already in place
        if (this.fadeTo?.target) this.trackArrival(m);
      }
    } else {
      meadow.fade = Math.max(0, 1 - this.fadeT / FADE_IN);
      if (this.fadeT >= FADE_IN) {
        this.fadePhase = "idle";
        this.fadeTo = null;
      }
    }
  }

  private publishRoute(): void {
    if (this.routeVersion === this.autopilot.version) return;
    this.routeVersion = this.autopilot.version;
    const r = meadow.route;
    const pts = this.autopilot.points;
    const n = Math.min(pts.length, r.points.length / 2);
    for (let i = 0; i < n; i++) {
      r.points[i * 2] = pts[i].x;
      r.points[i * 2 + 1] = pts[i].z;
    }
    r.count = n;
    r.version++;
  }
}
