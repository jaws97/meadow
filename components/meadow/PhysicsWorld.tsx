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
import { DAIS, layoutVersion, meadowLayout, type MeadowLayout } from "@/components/meadow/layout";
import { PhysicsCart } from "@/components/meadow/PhysicsCart";
import { perf } from "@/components/meadow/runtime";

const GRAVITY: [number, number, number] = [0, -19.62, 0];
/**
 * Kerbs and the dais collide higher than they are drawn. A hop lifts the
 * chassis floor to about 0.9 m, which clears a 0.62 m kerb, and the wheel
 * rays would then carry the cart into the bed over the sprouts. An unseen
 * barrier above the stone keeps the beds and the stage out of bounds.
 */
const BARRIER_H = 1.4;

/** The Meadow's walls: the ground, the dais, every kerb stone and the hedge ring (layout.ts). */
function MeadowColliders({ layout: L }: { layout: MeadowLayout }) {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[L.groundR, 0.5, L.groundR]} position={[0, -0.5, 0]} />
      <CylinderCollider args={[BARRIER_H / 2, DAIS.r]} position={[0, BARRIER_H / 2, 0]} />
      {L.kerbs.map((b, i) => (
        <CuboidCollider key={`k${i}`} args={[b.hx, BARRIER_H / 2, b.hz]} position={[b.x, BARRIER_H / 2, b.z]} rotation={[0, b.yaw, 0]} />
      ))}
      {L.hedge.map((b, i) => (
        <CuboidCollider key={`h${i}`} args={[b.hx, BARRIER_H / 2, b.hz]} position={[b.x, BARRIER_H / 2, b.z]} rotation={[0, b.yaw, 0]} />
      ))}
    </RigidBody>
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

/** `lite`: the trolley draws the lite tier, as MeadowCanvas picks it for the whole scene. */
export default function PhysicsWorld({ lite }: { lite: boolean }) {
  // the colliders follow the plan; a plan that grows (more rings) rebuilds them under a new key
  const layout = meadowLayout();
  return (
    <Physics timeStep={1 / 60} interpolate updatePriority={-5} gravity={GRAVITY} colliders={false}>
      <MeadowColliders key={layoutVersion()} layout={layout} />
      <PhysicsCart lite={lite} />
      <PhysicsTimer />
    </Physics>
  );
}
