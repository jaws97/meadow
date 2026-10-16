// The Lantern Cart's physics: Rapier's raycast vehicle controller on a single
// dynamic chassis, driven once per fixed step. The tuning is the folio cart at
// half scale (a 1.3 m cart instead of a 2.6 m car): four driven wheels, two
// steering, springy suspension with three heights, a soft speed limit, and a
// self-righting kick when it has been upside down for two seconds.
// Approach adapted from Bruno Simon's folio-2025 (MIT): Physics/PhysicsVehicle.js
// and Player.js. Only the mechanisms are ported; no art, model or sound.
//
// Nothing here imports the Rapier package directly: the module object and the
// world come from useRapier(), so there is exactly one Rapier build in play.
// The tuning numbers live in cart.ts.
import * as THREE from "three";
import { interactionGroups, type RapierRigidBody, type useRapier } from "@react-three/rapier";
import { CHASSIS, DRIVE, RECOVERY, RIDE, SUSPENSION, WHEEL } from "@/components/meadow/cart";
import { wishToWheel, type Command } from "@/components/meadow/mover";

type RapierContext = ReturnType<typeof useRapier>;
type RapierModule = RapierContext["rapier"];
type RapierWorld = RapierContext["world"];
type VehicleController = ReturnType<RapierWorld["createVehicleController"]>;

/** Collision groups: the world, the cart, and the plots (which nothing solid touches). */
export const GROUP = { world: 0, cart: 1, plots: 2 } as const;
export const CART_GROUPS = interactionGroups([GROUP.cart], [GROUP.world]);
/** Wheel rays only see the world: never the cart itself, never a plot. */
export const WHEEL_GROUPS = interactionGroups([GROUP.cart], [GROUP.world]);
/** Plots sit in their own group and only list the cart, which does not list them back, so they never interact. */
export const PLOT_GROUPS = interactionGroups([GROUP.plots], [GROUP.cart]);

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const wheelInput = { throttle: 0, steer: 0 };

export class PhysicsVehicle {
  readonly controller: VehicleController;
  readonly body: RapierRigidBody;
  /** Chassis-space hard points, front-right, front-left, rear-right, rear-left. */
  readonly hardPoints: THREE.Vector3[] = [
    new THREE.Vector3(WHEEL.offset.x, WHEEL.offset.y, WHEEL.offset.z),
    new THREE.Vector3(WHEEL.offset.x, WHEEL.offset.y, -WHEEL.offset.z),
    new THREE.Vector3(-WHEEL.offset.x, WHEEL.offset.y, WHEEL.offset.z),
    new THREE.Vector3(-WHEEL.offset.x, WHEEL.offset.y, -WHEEL.offset.z),
  ];

  // Measured after every step, from the simulated (not interpolated) body.
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(1, 0, 0);
  readonly upward = new THREE.Vector3(0, 1, 0);
  readonly sideward = new THREE.Vector3(0, 0, 1);
  speed = 0;
  goingForward = true;
  wheelsInContact = 0;
  upsideDown = false;
  /** Number of righting kicks so far, for the HUD and tests. */
  flips = 0;

  private readonly filterFlags: number;
  private hopLeft = 0;
  private upsideDownTime = 0;

  constructor(world: RapierWorld, rapier: RapierModule, body: RapierRigidBody) {
    this.body = body;
    this.filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
    const c = world.createVehicleController(body);
    this.controller = c;
    // The default axes are what we want: +y up, +x forward.
    const ride = SUSPENSION[RIDE];
    for (let i = 0; i < 4; i++) {
      c.addWheel(this.hardPoints[i], { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, ride.rest, WHEEL.radius);
      c.setWheelSuspensionStiffness(i, ride.stiffness);
      c.setWheelFrictionSlip(i, WHEEL.frictionSlip);
      c.setWheelSideFrictionStiffness(i, WHEEL.sideFrictionStiffness);
      c.setWheelSuspensionCompression(i, WHEEL.suspensionCompression);
      c.setWheelSuspensionRelaxation(i, WHEEL.suspensionRelaxation);
      c.setWheelMaxSuspensionTravel(i, WHEEL.maxSuspensionTravel);
      c.setWheelMaxSuspensionForce(i, WHEEL.maxSuspensionForce);
    }
    this.measure();
  }

  dispose(world: RapierWorld): void {
    try {
      world.removeVehicleController(this.controller);
    } catch {
      // The world may already be freed when the Physics tree unmounts first.
    }
  }

  steerLock(): number {
    const k = Math.min(1, this.speed / DRIVE.topSpeed);
    return DRIVE.steerAtRest + (DRIVE.steerAtTop - DRIVE.steerAtRest) * k;
  }

  hop(): void {
    this.hopLeft = DRIVE.hopSeconds;
  }

  /** Before each fixed step: turn the command into wheel forces and update the rays. */
  prePhysics(cmd: Command, dt: number): void {
    let throttle: number;
    let steering: number;
    let braking: number;
    if (cmd.kind === "wish") {
      wishToWheel(Math.atan2(-this.forward.z, this.forward.x), cmd.x, cmd.z, cmd.power, wheelInput);
      throttle = wheelInput.throttle;
      steering = wheelInput.steer;
      braking = 0;
    } else {
      throttle = cmd.throttle;
      steering = cmd.steer;
      braking = cmd.brake;
    }

    // The folio's soft limit alone never caps the speed on flat ground (nothing
    // else drags), so the force also fades to zero across a narrow band above it.
    const top = throttle < 0 && !this.goingForward ? DRIVE.reverseTopSpeed : DRIVE.topSpeed;
    const overspeed = Math.max(0, this.speed - top);
    const taper = Math.max(0, 1 - overspeed / DRIVE.limiterBand);
    let engine = ((throttle * DRIVE.engine) / (1 + overspeed)) * taper;
    let brake = braking * DRIVE.brake;
    if (braking === 0 && Math.abs(throttle) < 0.1) brake = DRIVE.idleBrake;
    // Asking for the other direction while still rolling brakes first.
    if (this.speed > 0.5 && ((throttle > 0 && !this.goingForward) || (throttle < 0 && this.goingForward))) {
      brake = DRIVE.reverseBrake;
      engine = 0;
    }
    const steer = steering * this.steerLock();

    this.hopLeft = Math.max(0, this.hopLeft - dt);
    const susp = SUSPENSION[this.hopLeft > 0 ? "hop" : RIDE];
    const c = this.controller;
    c.setWheelSteering(0, steer);
    c.setWheelSteering(1, steer);
    for (let i = 0; i < 4; i++) {
      c.setWheelBrake(i, brake);
      c.setWheelEngineForce(i, engine);
      c.setWheelSuspensionRestLength(i, susp.rest);
      c.setWheelSuspensionStiffness(i, susp.stiffness);
    }
    c.updateVehicle(dt, this.filterFlags, WHEEL_GROUPS);
  }

  /** After each fixed step: measure, and right the cart if it has stayed on its roof. */
  postPhysics(dt: number): void {
    this.measure();
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) contacts++;
    this.wheelsInContact = contacts;

    const ratio = this.upward.dot(UP) * -0.5 + 0.5;
    this.upsideDown = ratio > RECOVERY.upsideDownRatio;
    if (this.upsideDown) {
      this.upsideDownTime += dt;
      if (this.upsideDownTime >= RECOVERY.upsideDownAfter) {
        this.upsideDownTime = 0;
        this.flip();
      }
    } else {
      this.upsideDownTime = 0;
    }
  }

  /**
   * Read live: when the vehicle is built the collider's mass properties may
   * not be applied yet, and the body still reports the density-based mass.
   */
  get mass(): number {
    return this.body.mass() || CHASSIS.mass;
  }

  /** An upward kick plus a roll back toward the wheels; on its side it rolls the short way. */
  flip(): void {
    const m = this.mass;
    this.body.applyImpulse({ x: 0, y: RECOVERY.impulse * m, z: 0 }, true);
    const side = UP.dot(this.sideward);
    const fwd = UP.dot(this.forward);
    const up = UP.dot(this.upward);
    if (Math.abs(up) > Math.abs(side) && Math.abs(up) > Math.abs(fwd)) tmpV.set(RECOVERY.torque * m, 0, 0);
    else tmpV.set(side * RECOVERY.sideTorque * m, 0, -fwd * RECOVERY.sideTorque * m);
    tmpV.applyQuaternion(this.quaternion);
    this.body.applyTorqueImpulse({ x: tmpV.x, y: tmpV.y, z: tmpV.z }, true);
    this.flips++;
  }

  /** Teleport to a resting pose with every velocity zeroed. */
  moveTo(x: number, y: number, z: number, yaw: number): void {
    tmpQ.setFromAxisAngle(UP, yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.hopLeft = 0;
    this.upsideDownTime = 0;
    this.measure();
  }

  private measure(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);
    this.forward.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.upward.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.sideward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.speed = this.velocity.length();
    this.goingForward = this.speed < 1e-3 || this.velocity.dot(this.forward) / this.speed > 0.5;
  }
}
