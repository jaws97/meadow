// The per-frame brain of the spike, run before physics steps: it reads the
// input, turns taps into autopilot goals, decides which of keys, drag or
// autopilot is driving, and writes one Command for the Mover. It also owns
// the recoveries that are not the vehicle's own business: falling off the
// world, the "Unstuck" offer, and the fade that hides a respawn.
//
// Priority among inputs: keys, then a live drag, then the autopilot. Keys or
// a drag cancel the autopilot, so the player can always take over.
// The stuck test and drag mapping follow Bruno Simon's folio-2025 (MIT):
// approach adapted from PhysicsVehicle.js (stuck) and Player.js / Nipple.js (drag).
import * as THREE from "three";
import { Autopilot } from "@/components/meadow/autopilot";
import { MeadowInput } from "@/components/meadow/input";
import { BED, PLOTS, GROUND_HALF, nearestPathNode } from "@/components/meadow/layout";
import { setWheel, setWish, type Mover } from "@/components/meadow/mover";
import { meadow } from "@/components/meadow/runtime";

/** Drag: no pull inside this many pixels of the cart, full pull at the outer radius. */
export const DRAG_DEAD_PX = 32;
export const DRAG_FULL_PX = 150;
export const DRAG_CURVE = 1.6;
/** A tap this close to a plot marker (on screen) visits the plot instead of the ground. */
const PLOT_PICK_PX = 44;

const STUCK_WINDOW = 3;
const STUCK_DISTANCE = 0.5;
const FALL_Y = -2;
const FADE_OUT = 0.35;
const FADE_HOLD = 0.12;
const FADE_IN = 0.5;
/** A plot counts as "here" when the cart's nose is this close to it. */
const NEAR_PLOT = 2.4;

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
  private routeVersion = -1;
  /** Where the cart pulled up for a plot visit; the plot stays "here" until it leaves. */
  private parked = { plot: -1, x: 0, z: 0 };

  frame(camera: THREE.Camera, size: ViewSize, dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    const input = this.input;
    input.update(performance.now());
    if (input.zoomFactor !== 1) meadow.zoom = Math.min(18, Math.max(9, meadow.zoom * input.zoomFactor));

    const m = meadow.mover;
    if (!m) {
      input.endFrame();
      return;
    }

    if (input.respawnPressed || meadow.requests.respawn || meadow.requests.unstuck) this.beginRespawn();
    meadow.requests.respawn = false;
    meadow.requests.unstuck = false;
    if (m.state.position.y < FALL_Y) this.beginRespawn();

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
      this.autopilot.cancel();
      setWheel(cmd, this.keys.throttle, this.keys.steer, 0);
      meadow.mode = "keys";
    } else if (input.drag.active) {
      this.autopilot.cancel();
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

    this.trackStuck(m, dt);
    this.trackNearPlot(m);
    meadow.stats.speed = m.state.speed;
    this.publishRoute();
    input.endFrame();
  }

  private handleTap(x: number, y: number, camera: THREE.Camera, size: ViewSize, m: Mover): void {
    const from = { x: m.state.position.x, z: m.state.position.z };
    let best = -1;
    let bestD = PLOT_PICK_PX;
    for (const p of PLOTS) {
      proj.set(p.x, BED.soilH + 0.45, p.z).project(camera);
      if (proj.z > 1) continue;
      const d = Math.hypot((proj.x * 0.5 + 0.5) * size.width - x, (0.5 - proj.y * 0.5) * size.height - y);
      if (d < bestD) {
        bestD = d;
        best = p.index;
      }
    }
    if (best >= 0) {
      const nose = this.autopilot.visit(from, PLOTS[best]);
      meadow.targetPlot = best;
      meadow.goal = { active: true, x: nose.x, z: nose.z };
      return;
    }
    if (!this.groundUnder(x, y, 0, camera, size)) return;
    if (Math.abs(hit.x) > GROUND_HALF + 4 || Math.abs(hit.z) > GROUND_HALF + 4) return;
    const goal = this.autopilot.goTo(from, hit.x, hit.z);
    meadow.targetPlot = -1;
    meadow.goal = { active: true, x: goal.x, z: goal.z };
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
   * "Unstuck" is offered after three seconds of trying to move without
   * covering half a metre. Samples are only taken while the cart is being
   * asked to move, so a parked cart is never "stuck".
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

  private trackNearPlot(m: Mover): void {
    const s = m.state;
    // A finished visit owns the highlight while the cart stays put, even if
    // a neighbouring stake happens to be a little closer to its nose.
    const ap = this.autopilot;
    if (ap.arrivedAt >= 0) {
      this.parked = { plot: ap.arrivedAt, x: s.position.x, z: s.position.z };
      ap.arrivedAt = -1;
    }
    if (this.parked.plot >= 0) {
      if (Math.hypot(s.position.x - this.parked.x, s.position.z - this.parked.z) < 1 && !ap.active) {
        meadow.nearPlot = this.parked.plot;
        return;
      }
      this.parked.plot = -1;
    }
    const nx = s.position.x + Math.cos(s.yaw) * 0.6;
    const nz = s.position.z - Math.sin(s.yaw) * 0.6;
    let best = -1;
    let bestD = NEAR_PLOT;
    for (const p of PLOTS) {
      const d = Math.hypot(p.x - nx, p.z - nz);
      if (d < bestD) {
        bestD = d;
        best = p.index;
      }
    }
    meadow.nearPlot = s.speed < 0.6 ? best : -1;
  }

  private beginRespawn(): void {
    if (this.fadePhase !== "idle") return;
    this.fadePhase = "out";
    this.fadeT = 0;
    this.autopilot.cancel();
  }

  private runFade(m: Mover, dt: number): void {
    this.fadeT += dt;
    if (this.fadePhase === "out") {
      meadow.fade = Math.min(1, this.fadeT / FADE_OUT);
      if (this.fadeT >= FADE_OUT) {
        const node = nearestPathNode(m.state.position.x, m.state.position.z);
        m.respawn(node.x, node.z, node.yaw);
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
      }
    } else {
      meadow.fade = Math.max(0, 1 - this.fadeT / FADE_IN);
      if (this.fadeT >= FADE_IN) this.fadePhase = "idle";
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
