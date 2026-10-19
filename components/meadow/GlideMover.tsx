"use client";
// The physics-free fallback, selected with ?mover=glide, or taken up
// automatically when the physics cart cannot start or cannot hold its frame
// rate (MeadowCanvas). It needs no WASM and no physics world, so Seed Day
// always has a way to explore the Meadow.
//
// It is a point that accelerates toward the wished velocity (10 m/s^2, at
// most 5 m/s), coasts to rest when let go, and is pushed out of the same
// walls, trunks and kerbs the cart collides with, as a disc about the
// trolley's width. What it draws is the same firefly trolley as the physics
// cart, rolling along the ground: the wheels turn with the distance covered,
// the front pair steer into its turns (from how fast it is turning at the
// speed it is going, as a cart's would), and the tub settles back a touch as
// it sets off, dips as it slows and leans out of a turn. So when the Meadow
// falls back to gliding, the cart simply carries on: the glider takes over in
// the commit that removes the physics cart, before another frame is drawn,
// from the cart's drawn spot, heading and rolling speed, and eases out of
// whatever pitch, roll and ride height the cart's springs were showing. It
// draws the quality tier MeadowCanvas hands it, as the cart did.
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLIDE_TOP_SPEED } from "@/components/meadow/autopilot";
import { DRIVE, WHEEL, WHEELBASE } from "@/components/meadow/cart";
import { GROUND_Y } from "@/components/meadow/concepts/kit";
import { FireflyTrolley } from "@/components/meadow/FireflyTrolley";
import { wrapAngle, yawOf } from "@/components/meadow/layout";
import { createCommand, createMoverState, type Mover } from "@/components/meadow/mover";
import { meadow } from "@/components/meadow/runtime";
import { pushOut, type P2 } from "@/components/meadow/space";

const ACCEL = 10;
const COAST = 3;
/** The trolley's half-width at its hubs: what the walls push against, so it never noses into a kerb. */
const RADIUS = 0.5;
/** The chassis' height over the ground with the trolley standing on its wheels. */
const RIDE_Y = -GROUND_Y;
/** Below this forward speed (m/s) the steering is worked out as if at this speed, so turning on the spot stays calm. */
const STEER_SPEED = 0.6;
/** Keyboard turning rate, rad/s. */
const TURN_RATE = 2.4;
/** Seconds to settle out of the cart's tilt and ride height after taking over from it. */
const SETTLE_IN = 0.4;
/** A cart tipped further than this (radians), or riding this far off its height (m), is set straight at once. */
const SETTLE_MAX_TILT = 0.5;
const SETTLE_MAX_LIFT = 0.8;
const UP = new THREE.Vector3(0, 1, 0);
const LEVEL = new THREE.Quaternion();
const tmpQ = new THREE.Quaternion();

/** The cart's drawn pose beyond its heading at the takeover: height over the glider's ride, and its pitch and roll. */
interface Settle {
  dy: number;
  tilt: THREE.Quaternion;
}

class Glider implements Mover {
  readonly kind = "glide" as const;
  readonly holonomic = true;
  readonly wheelbase = 0;
  readonly state = createMoverState();
  command = createCommand();
  /** Ground position; the drawn lantern floats above it. */
  readonly ground: P2 = { x: meadow.start.x, z: meadow.start.z };
  /** Hop lift, metres, and its velocity. */
  lift = 0;
  liftV = 0;
  /** Heading to turn toward while resting (after visiting a plot), or null. */
  private faceYaw: number | null = null;
  private tookOver = false;

  constructor() {
    this.respawn(meadow.start.x, meadow.start.z, meadow.start.yaw);
  }

  /**
   * Picks up from the physics cart, once: from the live cart if it is still the Mover (its drawn spot, heading and
   * planar velocity, so it keeps rolling and the camera's lead does not jump), else from the handoff it left (an
   * error unmounted it first), else nothing (gliding from the start). Returns the pose to settle out of, or null.
   */
  takeOver(): Settle | null {
    if (this.tookOver) return null;
    this.tookOver = true;
    const live = meadow.mover;
    const from = meadow.handoff;
    meadow.handoff = null;
    if (live && live !== this) {
      const s = live.state;
      this.respawn(s.position.x, s.position.z, s.yaw);
      this.state.velocity.set(s.velocity.x, 0, s.velocity.z);
      this.place();
      const tilt = new THREE.Quaternion().setFromAxisAngle(UP, -s.yaw).multiply(s.quaternion);
      const dy = s.position.y - RIDE_Y;
      if (tilt.angleTo(LEVEL) > SETTLE_MAX_TILT || Math.abs(dy) > SETTLE_MAX_LIFT) return null;
      return { dy, tilt };
    }
    if (from) this.respawn(from.x, from.z, from.yaw);
    return null;
  }

  steerLock(): number {
    return Math.PI / 2;
  }

  minTurnRadius(): number {
    return 0;
  }

  hop(): void {
    if (this.lift < 0.05) this.liftV = 3.2;
  }

  face(x: number, z: number): void {
    this.faceYaw = yawOf(x - this.ground.x, z - this.ground.z);
  }

  respawn(x: number, z: number, yaw: number): void {
    this.ground.x = x;
    this.ground.z = z;
    this.state.velocity.set(0, 0, 0);
    this.state.yaw = yaw;
    this.state.speed = 0;
    this.state.forwardSpeed = 0;
    this.lift = 0;
    this.liftV = 0;
    this.faceYaw = null;
    this.place();
  }

  step(dt: number): void {
    const s = this.state;
    const v = s.velocity;
    const c = this.command;
    let tx = 0;
    let tz = 0;
    let driving = false;
    if (c.kind === "wish" && c.power > 0) {
      const len = Math.hypot(c.x, c.z) || 1;
      tx = (c.x / len) * c.power * GLIDE_TOP_SPEED;
      tz = (c.z / len) * c.power * GLIDE_TOP_SPEED;
      driving = true;
    } else if (c.kind === "wheel") {
      s.yaw = wrapAngle(s.yaw + c.steer * TURN_RATE * dt);
      if (Math.abs(c.throttle) > 0.01) {
        tx = Math.cos(s.yaw) * c.throttle * GLIDE_TOP_SPEED;
        tz = -Math.sin(s.yaw) * c.throttle * GLIDE_TOP_SPEED;
        driving = true;
      }
      if (c.brake > 0) v.multiplyScalar(Math.exp(-6 * c.brake * dt));
    }
    if (driving) this.faceYaw = null;
    if (driving) {
      // Toward the wished velocity at no more than the glide acceleration.
      const dx = tx - v.x;
      const dz = tz - v.z;
      const d = Math.hypot(dx, dz);
      const k = d > ACCEL * dt ? (ACCEL * dt) / d : 1;
      v.x += dx * k;
      v.z += dz * k;
    } else {
      v.multiplyScalar(Math.exp(-COAST * dt));
    }

    const before = { x: this.ground.x, z: this.ground.z };
    const was = Math.hypot(v.x, v.z);
    this.ground.x += v.x * dt;
    this.ground.z += v.z * dt;
    if (pushOut(this.ground, RADIUS)) {
      // Keep only the velocity the walls allowed, so it slides instead of sticking (and never more than it had: a body
      // set down where it cannot be, say over the river, is lifted out onto the bank, not thrown across the Meadow).
      v.x = (this.ground.x - before.x) / dt;
      v.z = (this.ground.z - before.z) / dt;
      const now = Math.hypot(v.x, v.z);
      if (now > was) v.multiplyScalar(was / now);
    }

    // Face where it is going (a wish), or where it was steered (keys).
    const speed = Math.hypot(v.x, v.z);
    if (speed > 0.25 && c.kind === "wish") {
      const target = yawOf(v.x, v.z);
      s.yaw = wrapAngle(s.yaw + wrapAngle(target - s.yaw) * (1 - Math.exp(-8 * dt)));
    } else if (this.faceYaw !== null) {
      s.yaw = wrapAngle(s.yaw + wrapAngle(this.faceYaw - s.yaw) * (1 - Math.exp(-4 * dt)));
    }

    this.liftV -= 19.62 * dt;
    this.lift = Math.max(0, this.lift + this.liftV * dt);
    if (this.lift === 0) this.liftV = 0;
    this.place();
  }

  private place(): void {
    const s = this.state;
    s.position.set(this.ground.x, 0, this.ground.z);
    s.quaternion.setFromAxisAngle(UP, s.yaw);
    s.speed = Math.hypot(s.velocity.x, s.velocity.z);
    s.forwardSpeed = s.velocity.x * Math.cos(s.yaw) - s.velocity.z * Math.sin(s.yaw);
  }
}

/** `lite`: the trolley draws the lite tier (MeadowCanvas's QUALITY). */
export function GlideMover({ lite }: { lite: boolean }) {
  const glider = useMemo(() => new Glider(), []);
  const body = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const roll = useRef({ spin: 0, steer: 0, yaw: glider.state.yaw, forward: 0, pitch: 0, lean: 0 });
  /** Settling out of the cart's pose: `t` runs 0..1 over SETTLE_IN, and rests at 1. */
  const settle = useRef({ t: 1, dy: 0, tilt: new THREE.Quaternion() });
  // A layout effect, so the takeover lands in the commit that removes the cart, while the cart is still the live
  // Mover with this frame's pose, and before another frame is drawn (useFrame subscribes in this commit too).
  useLayoutEffect(() => {
    const from = glider.takeOver();
    if (from) settle.current = { t: 0, dy: from.dy, tilt: from.tilt };
    const r = roll.current;
    r.yaw = glider.state.yaw;
    r.forward = glider.state.forwardSpeed;
    meadow.mover = glider;
    meadow.stats.loading = false;
    return () => {
      if (meadow.mover === glider) meadow.mover = null;
    };
  }, [glider]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    glider.step(dt);
    const g = body.current;
    if (!g) return;
    const s = glider.state;
    const r = roll.current;
    // the wheels roll with the ground covered, and the front pair steer into the turn it is making
    r.spin += (s.forwardSpeed * dt) / WHEEL.radius;
    const yawRate = wrapAngle(s.yaw - r.yaw) / Math.max(dt, 1e-4);
    r.yaw = s.yaw;
    const speed = (s.forwardSpeed < 0 ? -1 : 1) * Math.max(Math.abs(s.forwardSpeed), STEER_SPEED);
    const lock = DRIVE.steerAtRest;
    const steer = THREE.MathUtils.clamp(Math.atan((yawRate * WHEELBASE) / speed), -lock, lock);
    r.steer += (steer - r.steer) * (1 - Math.exp(-10 * dt));
    for (let i = 0; i < 4; i++) {
      // as PhysicsCart poses them: steer about the upright, then roll about the axle
      wheels.current[i]?.rotation.set(0, i < 2 ? r.steer : 0, -r.spin, "YXZ");
    }
    // a little weight: back as it sets off, forward as it slows, out of a turn
    const accel = (s.forwardSpeed - r.forward) / Math.max(dt, 1e-4);
    r.forward = s.forwardSpeed;
    const k = 1 - Math.exp(-6 * dt);
    r.pitch += (THREE.MathUtils.clamp(accel * 0.006, -0.045, 0.045) - r.pitch) * k;
    r.lean += (THREE.MathUtils.clamp(yawRate * s.forwardSpeed * 0.008, -0.05, 0.05) - r.lean) * k;
    g.position.set(glider.ground.x, RIDE_Y + glider.lift, glider.ground.z);
    g.quaternion.copy(s.quaternion);
    const e = settle.current;
    if (e.t < 1) {
      e.t = Math.min(1, e.t + dt / SETTLE_IN);
      const k = e.t * e.t * (3 - 2 * e.t);
      g.position.y += e.dy * (1 - k);
      g.quaternion.multiply(tmpQ.copy(e.tilt).slerp(LEVEL, k));
    }
    g.rotateZ(r.pitch);
    g.rotateX(r.lean);
  }, -5);

  return (
    <group ref={body}>
      <FireflyTrolley wheels={wheels} lite={lite} />
    </group>
  );
}
