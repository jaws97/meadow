"use client";
// The physics Lantern Cart: one dynamic chassis with a cuboid collider, the
// raycast vehicle that drives it (vehicle.ts), and the firefly trolley drawn
// on top (FireflyTrolley.tsx). It registers itself as the Meadow's Mover once
// Rapier has built it.
//
// Timing, per frame: the controller writes a command at priority -6; Rapier
// steps at -5, running the vehicle update before every fixed step; at -4.9
// this component reads the interpolated chassis transform (what is drawn, so
// the camera follows that, never the raw translation) and poses the wheel
// mounts, which the trolley's instanced wheels follow later in the frame.
// The component never re-renders after mount: a re-render would hand the
// RigidBody fresh props and it would re-apply its spawn transform.
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FireflyTrolley } from "@/components/meadow/FireflyTrolley";
import { createCommand, createMoverState, updateDerived, type Mover } from "@/components/meadow/mover";
import { meadow, perf } from "@/components/meadow/runtime";
import { CHASSIS, RIDE, SPAWN_HEIGHT, SUSPENSION, WHEELBASE } from "@/components/meadow/cart";
import { CART_GROUPS, PhysicsVehicle } from "@/components/meadow/vehicle";

const STEP = 1 / 60;

const MASS_PROPS = {
  mass: CHASSIS.mass,
  centerOfMass: CHASSIS.centerOfMass,
  principalAngularInertia: { x: CHASSIS.inertia, y: CHASSIS.inertia, z: CHASSIS.inertia },
  angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
};

class PhysicsMover implements Mover {
  readonly kind = "physics" as const;
  readonly holonomic = false;
  readonly wheelbase = WHEELBASE;
  readonly state = createMoverState();
  command = createCommand();

  constructor(readonly vehicle: PhysicsVehicle) {
    this.state.position.copy(vehicle.position);
    this.state.quaternion.copy(vehicle.quaternion);
    updateDerived(this.state);
  }

  steerLock(): number {
    return this.vehicle.steerLock();
  }

  minTurnRadius(): number {
    return this.wheelbase / Math.tan(this.steerLock());
  }

  hop(): void {
    this.vehicle.hop();
  }

  respawn(x: number, z: number, yaw: number): void {
    this.vehicle.moveTo(x, SPAWN_HEIGHT, z, yaw);
  }

  /** Copies the drawn (interpolated) pose and the simulated velocity. */
  sync(object: THREE.Object3D): void {
    this.state.position.copy(object.position);
    this.state.quaternion.copy(object.quaternion);
    this.state.velocity.copy(this.vehicle.velocity);
    updateDerived(this.state);
  }
}

export function PhysicsCart() {
  const { world, rapier } = useRapier();
  // where it starts: handed over by a glider, or the Meadow's start pose (meadow.start), read once
  const [spawn] = useState(() => {
    const s = meadow.start;
    return { position: [s.x, SPAWN_HEIGHT, s.z] as [number, number, number], rotation: [0, s.yaw, 0] as [number, number, number] };
  });
  const bodyRef = useRef<RapierRigidBody>(null);
  const anchorRef = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const rig = useRef<PhysicsMover | null>(null);
  const stepStart = useRef(0);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const vehicle = new PhysicsVehicle(world, rapier, body);
    const mover = new PhysicsMover(vehicle);
    rig.current = mover;
    meadow.mover = mover;
    meadow.stats.loading = false;
    return () => {
      if (meadow.mover === mover) meadow.mover = null;
      rig.current = null;
      vehicle.dispose(world);
    };
  }, [world, rapier]);

  useBeforePhysicsStep(() => {
    stepStart.current = performance.now();
    const mover = rig.current;
    if (mover) mover.vehicle.prePhysics(mover.command, STEP);
  });

  useAfterPhysicsStep(() => {
    const mover = rig.current;
    if (mover) mover.vehicle.postPhysics(STEP);
    perf.stepMs += performance.now() - stepStart.current;
    perf.steps++;
  });

  useFrame(() => {
    const mover = rig.current;
    const object = anchorRef.current?.parent;
    if (!mover || !object) return;
    mover.sync(object);
    const c = mover.vehicle.controller;
    const rest = SUSPENSION[RIDE].rest;
    for (let i = 0; i < 4; i++) {
      const g = wheels.current[i];
      if (!g) continue;
      const hp = mover.vehicle.hardPoints[i];
      g.position.set(hp.x, hp.y - (c.wheelSuspensionLength(i) ?? rest), hp.z);
      // Steer about the upright, then roll about the axle: Euler order YXZ.
      g.rotation.set(0, c.wheelSteering(i) ?? 0, -(c.wheelRotation(i) ?? 0), "YXZ");
    }
  }, -4.9);

  return (
    <RigidBody ref={bodyRef} colliders={false} canSleep={false} position={spawn.position} rotation={spawn.rotation}>
      <CuboidCollider args={CHASSIS.half} friction={CHASSIS.friction} massProperties={MASS_PROPS} collisionGroups={CART_GROUPS} />
      <group ref={anchorRef}>
        <FireflyTrolley wheels={wheels} />
      </group>
    </RigidBody>
  );
}
