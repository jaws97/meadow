// Tap-to-go. A tap becomes a route (route.ts), and the autopilot follows it
// with pure pursuit: aim at a point a speed-dependent distance down the route
// and steer the arc that passes through it. The speed is shaped so the cart
// eases off for bends and rolls to a stop on the spot instead of braking hard.
//
// Two things make a naive pursuit look silly, and both are handled here. A
// target beside the cart, inside its turning circle, makes it orbit forever;
// a target behind it makes the arc maths drive straight away from it. In both
// cases the cart backs up a little, swinging its nose round, then carries on.
// It also backs off and re-plans when it has pushed against a wall too long;
// the glider, which needs no room to turn, simply re-plans from where it is.
//
// A visit ends with the cart pulled up on the path beside the plant, side on,
// the way you would stop a garden cart to look at a flower: the ring paths are
// narrow, and a nose-to-the-kerb stop meant a three-point turn in front of
// every plant. The glider, which can turn on the spot, then faces the plant.
import { wrapAngle, yawOf } from "@/components/meadow/layout";
import { setWheel, setWish, type Command, type Mover } from "@/components/meadow/mover";
import { planRoute } from "@/components/meadow/route";
import { pointClear, reachableNear, type P2 } from "@/components/meadow/space";

/** Something the cart can visit: a plant (index >= 0) or the rose (ROSE), with where to pull up for it. */
export interface VisitTarget {
  index: number;
  x: number;
  z: number;
  park: P2;
}

/** The index a visit to the owner's rose on the dais goes by. */
export const ROSE = -2;
/** A visit that starts this close to its parking spot simply arrives. */
const ALREADY_THERE = 0.9;

/** Calm cruising, a little under the cart's soft top speed. */
const CRUISE = 3.8;
/** Comfortable braking into a stop, m/s^2 (the cart's idle roll-out is about 3.4). */
const DECEL = 2.5;
/** Comfortable pull-away, m/s^2; the commanded speed ramps up no faster. */
const ACCEL = 2.8;
/** Sideways acceleration allowed through a bend, m/s^2. */
const LATERAL = 2.6;
const ARRIVE = 0.35;
/** Speed below which a stop counts as done, m/s. */
const STOPPED = 0.08;
/**
 * Brake inputs stay small: on this cart a brake input of 0.05 already
 * decelerates at about 5.6 m/s^2, and anything much above it is a skid.
 */
const SOFT_BRAKE = 0.05;
const MAX_THROTTLE = 0.5;
/** Chassis footprint, for the bumper clearance checks. */
const CART_HALF_LENGTH = 0.65;
const CART_HALF_WIDTH = 0.43;
/** Glide mover's top speed, so a wish strength maps to m/s. */
export const GLIDE_TOP_SPEED = 5;
/** Seconds the glider may be held still against a wall before it plans its way again. */
const GLIDE_STALL = 1.5;

type Phase = "drive" | "reverse" | "stop";

function segDist(px: number, pz: number, a: P2, b: P2): number {
  const t = Math.min(1, Math.max(0, segT(px, pz, a, b)));
  return Math.hypot(a.x + (b.x - a.x) * t - px, a.z + (b.z - a.z) * t - pz);
}

function segT(px: number, pz: number, a: P2, b: P2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len = vx * vx + vz * vz;
  return len > 1e-9 ? ((px - a.x) * vx + (pz - a.z) * vz) / len : 1;
}

export class Autopilot {
  active = false;
  /** Bumped whenever the route changes, so the dotted guide knows to rebuild. */
  version = 0;
  points: P2[] = [];
  /** The plant (or the rose) being visited, if any. */
  plot: VisitTarget | null = null;
  /** The target the last finished visit pulled up at (a plot index or ROSE), or null; the controller clears it. */
  arrivedAt: number | null = null;

  private seg = 0;
  private phase: Phase = "drive";
  private phaseT = 0;
  private reverseFrom: P2 = { x: 0, z: 0 };
  private stallT = 0;
  private replanAfterReverse = false;
  private rampSpeed = 0;
  private goal: P2 = { x: 0, z: 0 };
  /** While backing up: the point the nose should swing toward. */
  private swingTarget: P2 | null = null;

  /** Drive to the reachable spot nearest (x, z); returns where it will stop. */
  goTo(from: P2, x: number, z: number): P2 {
    this.plot = null;
    // Clearance from walls is a little over half the cart's length, so it can arrive nose-on.
    const goal = reachableNear(x, z, 0.8);
    this.start(planRoute(from, goal));
    return goal;
  }

  /**
   * Drive to a plant and pull up on the path beside it. A cart already
   * standing at the spot just arrives (the glider still turns to face it).
   */
  visit(from: P2, target: VisitTarget, mover?: Mover): P2 {
    this.plot = target;
    if (Math.hypot(target.park.x - from.x, target.park.z - from.z) < ALREADY_THERE) {
      this.points = [];
      this.active = false;
      this.version++;
      mover?.face?.(target.x, target.z);
      this.arrivedAt = target.index;
      this.plot = null;
      return target.park;
    }
    this.start(planRoute(from, target.park));
    return target.park;
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.plot = null;
    this.points = [];
    this.version++;
  }

  /**
   * Writes this frame's command into `out` and returns true while driving.
   * `dt` is the frame time in seconds.
   */
  update(mover: Mover, dt: number, out: Command): boolean {
    if (!this.active || this.points.length < 2) return false;
    const s = mover.state;
    const px = s.position.x;
    const pz = s.position.z;
    const pts = this.points;
    const n = pts.length;

    // Advance along the route once past the end of this leg or close to its
    // end. (Not "nearer the next leg": a plot visit can loop out and back, so
    // its last leg may pass right by where the cart starts.) A waypoint that
    // is close but inside the turning circle is skipped rather than orbited.
    const rMin = mover.holonomic ? 0 : mover.minTurnRadius();
    while (this.seg < n - 2) {
      const a = pts[this.seg];
      const b = pts[this.seg + 1];
      const db = Math.hypot(b.x - px, b.z - pz);
      const unreachable = db < 2 && requiredRadius(db, wrapAngle(yawOf(b.x - px, b.z - pz) - s.yaw)) < rMin;
      // Already running along the next leg, near its start: the corner was cut.
      const cut = db < 1.5 && segDist(px, pz, b, pts[this.seg + 2]) + 0.05 < segDist(px, pz, a, b);
      if (segT(px, pz, a, b) >= 1 || db < 0.6 || unreachable || cut) this.seg++;
      else break;
    }
    const a = pts[this.seg];
    const b = pts[this.seg + 1];
    const t = Math.min(1, Math.max(0, segT(px, pz, a, b)));
    const projX = a.x + (b.x - a.x) * t;
    const projZ = a.z + (b.z - a.z) * t;
    let remaining = Math.hypot(b.x - projX, b.z - projZ);
    for (let i = this.seg + 2; i < n; i++) remaining += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const final = pts[n - 1];
    const dFinal = Math.hypot(final.x - px, final.z - pz);
    remaining = Math.max(remaining, dFinal * 0.5);

    const lookahead = Math.min(3, Math.max(1.2, 1.1 + 0.45 * Math.abs(s.forwardSpeed)));
    const look = this.pointAlong(projX, projZ, lookahead);

    if (mover.holonomic) return this.glide(mover, dt, look, remaining, dFinal, out);
    return this.drive(mover, dt, look, remaining, dFinal, final, out);
  }

  private start(points: P2[]): void {
    this.points = points;
    this.goal = points[points.length - 1];
    this.seg = 0;
    this.phase = "drive";
    this.phaseT = 0;
    this.stallT = 0;
    this.replanAfterReverse = false;
    this.swingTarget = null;
    this.active = points.length >= 2;
    this.version++;
  }

  private finish(): void {
    if (this.plot) this.arrivedAt = this.plot.index;
    this.active = false;
    this.points = [];
    this.version++;
  }

  private pointAlong(fromX: number, fromZ: number, dist: number): P2 {
    const pts = this.points;
    let x = fromX;
    let z = fromZ;
    let left = dist;
    for (let i = this.seg + 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - x, pts[i].z - z);
      if (d >= left) {
        const k = left / d;
        return { x: x + (pts[i].x - x) * k, z: z + (pts[i].z - z) * k };
      }
      left -= d;
      x = pts[i].x;
      z = pts[i].z;
    }
    return { x, z };
  }

  private glide(mover: Mover, dt: number, look: P2, remaining: number, dFinal: number, out: Command): boolean {
    if (remaining < 0.2 || (this.seg >= this.points.length - 2 && dFinal < 0.2)) {
      if (this.plot) mover.face?.(this.plot.x, this.plot.z);
      this.finish();
      return false;
    }
    const s = mover.state;
    const dx = look.x - s.position.x;
    const dz = look.z - s.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const v = Math.min(CRUISE, Math.sqrt(2 * DECEL * Math.max(0, remaining - 0.05)));
    setWish(out, dx / d, dz / d, v / GLIDE_TOP_SPEED);
    // held against a wall while it wants to be moving: plan the way again from here
    if (v > 0.6 && s.speed < 0.15) this.stallT += dt;
    else this.stallT = Math.max(0, this.stallT - dt);
    if (this.stallT > GLIDE_STALL) {
      this.stallT = 0;
      this.points = planRoute({ x: s.position.x, z: s.position.z }, this.goal);
      this.seg = 0;
      this.version++;
    }
    return true;
  }

  private drive(mover: Mover, dt: number, look: P2, remaining: number, dFinal: number, final: P2, out: Command): boolean {
    const s = mover.state;
    const v = s.forwardSpeed;
    const px = s.position.x;
    const pz = s.position.z;
    const lock = mover.steerLock();
    const rMin = mover.minTurnRadius();
    const alphaFinal = wrapAngle(yawOf(final.x - px, final.z - pz) - s.yaw);

    // Never ask for the other direction while still rolling: the vehicle would
    // answer with its reverse brake, a jolt. Settle gently first.
    const wheel = (throttle: number, steer: number, brake: number) => {
      if ((throttle > 0 && v < -0.3) || (throttle < 0 && v > 0.3)) setWheel(out, 0, steer, SOFT_BRAKE);
      else setWheel(out, throttle, steer, brake);
    };

    if (this.phase === "stop") {
      wheel(0, 0, SOFT_BRAKE);
      if (Math.abs(v) < STOPPED) this.finish();
      return true;
    }

    if (this.phase === "reverse") {
      this.phaseT += dt;
      const back = Math.hypot(px - this.reverseFrom.x, pz - this.reverseFrom.z);
      const aim = this.swingTarget ?? final;
      const alphaAim = wrapAngle(yawOf(aim.x - px, aim.z - pz) - s.yaw);
      const required = requiredRadius(dFinal, alphaFinal);
      const maxBack = 1.6;
      const tailBlocked = !cornersClear(px, pz, s.yaw, -CART_HALF_LENGTH - 0.15);
      const done = (Math.abs(alphaAim) < 0.5 && required > rMin * 1.15) || back > maxBack || this.phaseT > 2.6 || tailBlocked;
      if (!done) {
        // Backing up with the wheels turned away swings the nose toward the target.
        wheel(v < -0.9 ? 0 : -0.4, -Math.sign(alphaAim || 1), 0);
        return true;
      }
      this.swingTarget = null;
      this.phase = "drive";
      this.stallT = 0;
      this.rampSpeed = 0;
      if (this.replanAfterReverse) {
        this.replanAfterReverse = false;
        this.points = planRoute({ x: px, z: pz }, this.goal);
        this.seg = 0;
        this.version++;
      }
    }

    // Arrived, or close enough beside a target that only a fussy shuffle would reach.
    const lastLeg = this.seg >= this.points.length - 2;
    // Beside a plant, a metre either way is "here": a side-on stop needs no fussing.
    const close = this.plot ? 1.1 : 0.8;
    if (remaining < ARRIVE || (lastLeg && (dFinal < ARRIVE || (dFinal < close && Math.abs(v) < 0.4 && Math.abs(alphaFinal) > 0.9)))) {
      this.phase = "stop";
      wheel(0, 0, SOFT_BRAKE);
      return true;
    }

    // A target we cannot turn into from here: back up first rather than orbit it.
    if (dFinal < 2.6 && remaining < 3.2) {
      const required = requiredRadius(dFinal, alphaFinal);
      if (Math.abs(alphaFinal) > 1.75 || required < rMin * 0.95) {
        this.startReverse(px, pz, false);
        wheel(0, 0, SOFT_BRAKE);
        return true;
      }
    }

    const dx = look.x - px;
    const dz = look.z - pz;
    const ld = Math.max(0.4, Math.hypot(dx, dz));
    const alpha = wrapAngle(yawOf(dx, dz) - s.yaw);

    // The way on needs a real turn and the nose is at a wall (say, parked at a
    // kerb): back away first, or the turning front corner sweeps into the stone.
    if (Math.abs(alpha) > 0.8 && !cornersClear(px, pz, s.yaw, CART_HALF_LENGTH + 0.5)) {
      this.startReverse(px, pz, false);
      this.swingTarget = look;
      wheel(0, 0, SOFT_BRAKE);
      return true;
    }
    let steerAngle: number;
    let target: number;
    if (Math.abs(alpha) > Math.PI / 2) {
      // Pointing away from the route: turn round at full lock, slowly.
      steerAngle = Math.sign(alpha) * lock;
      target = 1.3;
    } else {
      const curvature = (2 * Math.sin(alpha)) / ld;
      steerAngle = Math.atan(curvature * mover.wheelbase);
      target = Math.min(CRUISE, Math.sqrt(LATERAL / Math.max(Math.abs(curvature), 1e-3)));
    }
    // Shaped to arrive at a walking crawl, so the final stop is a settle, not a brake.
    target = Math.min(target, Math.sqrt(2 * DECEL * Math.max(0, remaining - 0.25)));
    target = Math.max(target, remaining > 0.6 ? 0.45 : 0.3);
    // Pull away gently: the commanded speed climbs at a comfortable rate.
    this.rampSpeed = Math.min(target, Math.max(this.rampSpeed, Math.max(0, v)) + ACCEL * dt);

    // Half throttle at most: full throttle on this cart is close to 10 m/s^2.
    const err = this.rampSpeed - v;
    const throttle = Math.min(MAX_THROTTLE, Math.max(0, err * 0.8));
    const brake = err < -0.4 ? Math.min(SOFT_BRAKE, -err * 0.03) : 0;
    wheel(throttle, Math.max(-1, Math.min(1, steerAngle / lock)), brake);

    if (throttle > MAX_THROTTLE * 0.8 && Math.abs(v) < 0.12) this.stallT += dt;
    else this.stallT = Math.max(0, this.stallT - dt);
    if (this.stallT > 1.4) this.startReverse(px, pz, true);
    return true;
  }

  private startReverse(px: number, pz: number, replan: boolean): void {
    this.phase = "reverse";
    this.phaseT = 0;
    this.stallT = 0;
    this.reverseFrom = { x: px, z: pz };
    this.replanAfterReverse = replan;
  }
}

/** True when both corners of the bumper `along` metres ahead (negative: behind) are clear of walls. */
function cornersClear(x: number, z: number, yaw: number, along: number): boolean {
  const fx = Math.cos(yaw);
  const fz = -Math.sin(yaw);
  for (const side of [-1, 1]) {
    // Left of the heading (fx, fz) is (fz, -fx).
    const cx = x + fx * along + fz * CART_HALF_WIDTH * side;
    const cz = z + fz * along - fx * CART_HALF_WIDTH * side;
    if (!pointClear(cx, cz, 0.1)) return false;
  }
  return true;
}

/** Radius of the arc that leaves the current heading and passes through a point `d` away at bearing `alpha`. */
function requiredRadius(d: number, alpha: number): number {
  const s = Math.abs(Math.sin(alpha));
  return s < 1e-4 ? Infinity : d / (2 * s);
}
