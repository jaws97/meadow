// The seam between "what the player wants" and "how the body moves". Input,
// the autopilot and the camera only ever talk to a Mover, so the physics cart
// and the physics-free GlideMover are interchangeable, and a Meadow whose cart
// fails on some phones can fall back to gliding without touching anything else.
//
// A Command comes in one of two shapes. "wheel" is car-like (throttle, steer,
// brake), which is what the keyboard and the cart autopilot produce. "wish" is
// a world-space direction and strength, which is what drag-to-drive and the
// glide autopilot produce. Each mover accepts both and translates the other.
import * as THREE from "three";
import { wrapAngle, yawOf } from "@/components/meadow/layout";

export type MoverKind = "physics" | "glide";

/** One mutable record per frame; `kind` says which half the mover should read. */
export interface Command {
  kind: "wheel" | "wish";
  /** -1..1, positive forward */
  throttle: number;
  /** -1..1, positive to the left */
  steer: number;
  /** 0..1 */
  brake: number;
  /** world-space planar direction of a wish (need not be unit length) */
  x: number;
  z: number;
  /** 0..1 strength of a wish */
  power: number;
}

export interface MoverState {
  /** Where the body is drawn this frame (interpolated for the physics cart). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** world velocity, m/s */
  velocity: THREE.Vector3;
  /** heading about +y; the body faces (cos yaw, 0, -sin yaw) */
  yaw: number;
  /** planar speed, m/s */
  speed: number;
  /** signed speed along the heading, m/s */
  forwardSpeed: number;
}

export interface Mover {
  readonly kind: MoverKind;
  /** A holonomic mover can move in any direction; a wheeled one needs steering room. */
  readonly holonomic: boolean;
  readonly state: MoverState;
  /** Written by the controller every frame, read by the mover when it next steps. */
  command: Command;
  /** Tightest turning circle at the current speed, metres; 0 if it can turn on the spot. */
  minTurnRadius(): number;
  /** Steering lock at the current speed, radians (wheeled movers only). */
  steerLock(): number;
  /** Distance between the axles, metres (wheeled movers only). */
  readonly wheelbase: number;
  hop(): void;
  /** Teleport to a resting pose with every velocity zeroed. */
  respawn(x: number, z: number, yaw: number): void;
  /**
   * Turn on the spot to face a point, for movers that can (the glider, at
   * the end of a plot visit); a wheeled mover leaves this out and has to
   * manoeuvre instead.
   */
  face?(x: number, z: number): void;
}

export function createCommand(): Command {
  return { kind: "wheel", throttle: 0, steer: 0, brake: 0, x: 0, z: 0, power: 0 };
}

export function setWheel(c: Command, throttle: number, steer: number, brake: number): void {
  c.kind = "wheel";
  c.throttle = throttle;
  c.steer = steer;
  c.brake = brake;
}

export function setWish(c: Command, x: number, z: number, power: number): void {
  c.kind = "wish";
  c.x = x;
  c.z = z;
  c.power = power;
}

export function createMoverState(): MoverState {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    speed: 0,
    forwardSpeed: 0,
  };
}

/** Writes the planar heading, speeds and yaw of `s` from its quaternion and velocity. */
const fwd = new THREE.Vector3();
export function updateDerived(s: MoverState): void {
  fwd.set(1, 0, 0).applyQuaternion(s.quaternion);
  s.yaw = yawOf(fwd.x, fwd.z);
  s.speed = Math.hypot(s.velocity.x, s.velocity.z);
  const h = Math.hypot(fwd.x, fwd.z) || 1;
  s.forwardSpeed = (s.velocity.x * fwd.x + s.velocity.z * fwd.z) / h;
}

/**
 * Forward wedge for drive-toward-your-finger: a target within 120 degrees of
 * the nose drives forward, the remaining 120 degrees behind reverses.
 */
export const FORWARD_HALF_ANGLE = (120 * Math.PI) / 180;
/** Heading error at which the steering reaches full lock: half the reverse wedge. */
const FULL_LOCK_ERROR = Math.PI - FORWARD_HALF_ANGLE;

/**
 * Turns a world-space wish into car controls for a body with heading `yaw`.
 * The reverse branch mirrors the steering, because a car backing up turns its
 * tail, not its nose, toward the side the wheels point.
 * Approach adapted from Bruno Simon's folio-2025 (MIT): Player.js / Nipple.js.
 */
export function wishToWheel(yaw: number, x: number, z: number, power: number, out: { throttle: number; steer: number }): void {
  if (power <= 0 || (x === 0 && z === 0)) {
    out.throttle = 0;
    out.steer = 0;
    return;
  }
  const target = yawOf(x, z);
  let err = wrapAngle(target - yaw);
  const forward = Math.abs(err) < FORWARD_HALF_ANGLE;
  if (!forward) err = wrapAngle(target - (yaw + Math.PI));
  const steer = Math.max(-1, Math.min(1, err / FULL_LOCK_ERROR));
  out.throttle = forward ? power : -power;
  out.steer = forward ? steer : -steer;
}
