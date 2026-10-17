"use client";
// The physics-free fallback: a lantern that glides at hover height, selected
// with ?mover=glide, or taken up automatically when the physics cart cannot
// start or cannot hold its frame rate (MeadowCanvas). It needs no WASM and no
// physics world, so Seed Day always has a way to explore the Meadow.
//
// It is a point that accelerates toward the wished velocity (10 m/s^2, at
// most 5 m/s), coasts to rest when let go, and is pushed out of the same
// walls, trunks and kerbs the cart collides with, as a 0.35 m disc.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLIDE_TOP_SPEED } from "@/components/meadow/autopilot";
import { Lantern } from "@/components/meadow/LanternCart";
import { SPAWN, wrapAngle, yawOf } from "@/components/meadow/layout";
import { createCommand, createMoverState, type Mover } from "@/components/meadow/mover";
import { blobTexture } from "@/components/meadow/parts";
import { meadow } from "@/components/meadow/runtime";
import { pushOut, type P2 } from "@/components/meadow/space";

const ACCEL = 10;
const COAST = 3;
const HOVER = 1.6;
const RADIUS = 0.35;
/** Keyboard turning rate, rad/s. */
const TURN_RATE = 2.4;
const UP = new THREE.Vector3(0, 1, 0);

class Glider implements Mover {
  readonly kind = "glide" as const;
  readonly holonomic = true;
  readonly wheelbase = 0;
  readonly state = createMoverState();
  command = createCommand();
  /** Ground position; the drawn lantern floats above it. */
  readonly ground: P2 = { x: SPAWN.x, z: SPAWN.z };
  /** Hop lift, metres, and its velocity. */
  lift = 0;
  liftV = 0;
  /** Heading to turn toward while resting (after visiting a plot), or null. */
  private faceYaw: number | null = null;

  constructor() {
    // Taking over from the physics cart: start where it stood, facing its way.
    const from = meadow.handoff;
    meadow.handoff = null;
    if (from) this.respawn(from.x, from.z, from.yaw);
    else this.respawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
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
    this.ground.x += v.x * dt;
    this.ground.z += v.z * dt;
    if (pushOut(this.ground, RADIUS)) {
      // Keep only the velocity the walls allowed, so it slides instead of sticking.
      v.x = (this.ground.x - before.x) / dt;
      v.z = (this.ground.z - before.z) / dt;
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

export function GlideMover() {
  const glider = useMemo(() => new Glider(), []);
  const body = useRef<THREE.Group>(null);
  const shadow = useMemo(() => blobTexture(), []);
  useEffect(() => {
    meadow.mover = glider;
    meadow.stats.loading = false;
    return () => {
      if (meadow.mover === glider) meadow.mover = null;
      shadow.dispose();
    };
  }, [glider, shadow]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    glider.step(dt);
    const g = body.current;
    if (!g) return;
    const bob = Math.sin(state.clock.elapsedTime * 1.6) * 0.05;
    g.position.set(glider.ground.x, HOVER + bob + glider.lift, glider.ground.z);
    g.quaternion.copy(glider.state.quaternion);
  }, -5);

  return (
    <>
      <group ref={body}>
        {/* A larger lantern than the cart's, hung from nothing: the guardian light on its own. */}
        <group scale={2.2} position={[0, 0.55, 0]}>
          <Lantern hookLength={0.6} />
        </group>
      </group>
      <GroundShadow glider={glider} texture={shadow} />
    </>
  );
}

function GroundShadow({ glider, texture }: { glider: Glider; texture: THREE.Texture }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.position.set(glider.ground.x, 0.02, glider.ground.z);
    const s = 1.1 - Math.min(0.5, glider.lift * 0.4);
    m.scale.set(s, s, s);
  }, -4.9);
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[1.2, 1.2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
