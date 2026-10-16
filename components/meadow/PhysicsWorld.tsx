"use client";
// Everything that needs Rapier, in one lazily loaded chunk: the world, the
// Meadow's colliders and the physics cart. The canvas imports this file with
// React.lazy only when the physics mover is chosen, so `?mover=glide` never
// downloads or initialises the WASM build. A default export because that is
// what React.lazy resolves.
//
// Gravity is doubled, as in the folio cart: at true gravity a 1.3 m cart
// floats through its hops and bumps like a toy on the moon.
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, Physics, RigidBody } from "@react-three/rapier";
import { useRef } from "react";
import { BED, DAIS, GROUND_HALF, HEDGE, KERBS, PLOTS, TREES } from "@/components/meadow/layout";
import { PhysicsCart } from "@/components/meadow/PhysicsCart";
import { perf } from "@/components/meadow/runtime";
import { PLOT_GROUPS } from "@/components/meadow/vehicle";

const GRAVITY: [number, number, number] = [0, -19.62, 0];
/**
 * Kerbs and the dais collide higher than they are drawn. A hop lifts the
 * chassis floor to about 0.9 m, which clears a 0.62 m kerb, and the wheel
 * rays would then carry the cart into the bed over the sprouts. An unseen
 * barrier above the stone keeps the beds and the stage out of bounds.
 */
const BARRIER_H = 1.4;

function MeadowColliders() {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[GROUND_HALF, 0.5, GROUND_HALF]} position={[0, -0.5, 0]} />
        <CylinderCollider args={[BARRIER_H / 2, DAIS.r]} position={[0, BARRIER_H / 2, 0]} />
        {KERBS.map((b, i) => (
          <CuboidCollider key={`k${i}`} args={[b.hx, BARRIER_H / 2, b.hz]} position={[b.x, BARRIER_H / 2, b.z]} rotation={[0, b.yaw, 0]} />
        ))}
        {HEDGE.map((b, i) => (
          <CuboidCollider key={`h${i}`} args={[b.hx, b.h / 2, b.hz]} position={[b.x, b.h / 2, b.z]} rotation={[0, b.yaw, 0]} />
        ))}
        {TREES.map((t, i) => (
          <CylinderCollider key={`t${i}`} args={[t.h / 2, t.r]} position={[t.x, t.h / 2, t.z]} />
        ))}
      </RigidBody>
      {/* The plots' volumes, for later proximity checks. They are sensors in
          their own group, so the chassis never touches them and the wheel rays
          (which skip sensors and only see the world group) never land on them. */}
      <RigidBody type="fixed" colliders={false}>
        {PLOTS.map((p) => (
          <CylinderCollider
            key={p.index}
            sensor
            args={[0.4, 0.3]}
            position={[p.x, BED.soilH + 0.4, p.z]}
            collisionGroups={PLOT_GROUPS}
          />
        ))}
      </RigidBody>
    </>
  );
}

/** Brackets Rapier's stepper (priority -5) to time the whole physics stage of a frame. */
function PhysicsTimer() {
  const start = useRef(0);
  useFrame(() => {
    start.current = performance.now();
  }, -5.01);
  useFrame(() => {
    perf.physicsMs += performance.now() - start.current;
  }, -4.99);
  return null;
}

export default function PhysicsWorld() {
  return (
    <Physics timeStep={1 / 60} interpolate updatePriority={-5} gravity={GRAVITY} colliders={false}>
      <MeadowColliders />
      <PhysicsCart />
      <PhysicsTimer />
    </Physics>
  );
}
