"use client";
// The Lantern Cart, as an obviously placeholder silhouette built from
// primitives: a woven tub on a little frame, four spoked wheels, a short pull
// handle, and a warm lantern hanging from a pole at the back. The real cart is
// waiting for a concept sign-off; this one exists so the physics has a body.
//
// The parent owns the wheels' transforms (they follow the vehicle's wheel
// states every frame); the lantern swings on its own, a damped pendulum fed
// by how its hook accelerates, which is most of what makes the cart feel alive.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { merge, paint, rod, weaveTexture } from "@/components/meadow/parts";
import { WHEEL } from "@/components/meadow/cart";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const WOOD = "#7b5434";
const IRON = "#3d3833";
const BRASS = "#b48a4e";
export const LANTERN_LIGHT = "#ffc47a";

function wheelGeometry(): THREE.BufferGeometry {
  const r = WHEEL.radius;
  const parts: THREE.BufferGeometry[] = [];
  // Iron tyre and wooden felloe: a torus each, in the wheel's XY plane.
  parts.push(paint(new THREE.TorusGeometry(r - 0.012, 0.016, 6, 24), IRON));
  parts.push(paint(new THREE.TorusGeometry(r - 0.04, 0.018, 6, 24), WOOD));
  const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10);
  hub.rotateX(Math.PI / 2);
  parts.push(paint(hub, WOOD));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(paint(rod(v(0, 0, 0), v(Math.cos(a) * (r - 0.04), Math.sin(a) * (r - 0.04), 0), 0.011, 5), WOOD));
  }
  return merge(parts);
}

function frameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Rim of the tub, then two runners under it, then the pull handle.
  const top = 0.16;
  const hx = 0.6;
  const hz = 0.31;
  const corners = [v(hx, top, hz), v(hx, top, -hz), v(-hx, top, -hz), v(-hx, top, hz)];
  for (let i = 0; i < 4; i++) parts.push(paint(rod(corners[i], corners[(i + 1) % 4], 0.028, 6), "#9c7448"));
  for (const z of [-0.2, 0.2]) parts.push(paint(rod(v(-0.58, -0.37, z), v(0.58, -0.37, z), 0.03, 6), WOOD));
  for (const z of [-0.12, 0.12]) parts.push(paint(rod(v(0.55, 0.0, z), v(0.8, 0.1, z * 0.6), 0.016, 5), WOOD));
  parts.push(paint(rod(v(0.8, 0.1, -0.09), v(0.8, 0.1, 0.09), 0.02, 6), WOOD));
  // Lantern pole at the back and its arm.
  parts.push(paint(rod(v(-0.5, 0.1, 0), v(-0.5, 1.12, 0), 0.02, 6), WOOD));
  parts.push(paint(rod(v(-0.5, 1.1, 0), v(-0.26, 1.1, 0), 0.016, 6), BRASS));
  return merge(parts);
}

function tubGeometry(): THREE.BufferGeometry {
  // A four-sided open cylinder turned 45 degrees is a square tub; stretch it long.
  const geo = new THREE.CylinderGeometry(0.44, 0.37, 0.5, 4, 1, true, Math.PI / 4);
  geo.scale(1.94, 1, 1);
  geo.translate(0, -0.11, 0);
  return geo;
}

/** The lantern's metalwork, hanging below its hook at the origin. */
function lanternFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(rod(v(0, 0, 0), v(0, -0.05, 0), 0.006, 4), BRASS));
  const cap = new THREE.ConeGeometry(0.085, 0.06, 6);
  cap.translate(0, -0.075, 0);
  parts.push(paint(cap, BRASS));
  const base = new THREE.CylinderGeometry(0.075, 0.07, 0.018, 6);
  base.translate(0, -0.27, 0);
  parts.push(paint(base, BRASS));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.07;
    const z = Math.sin(a) * 0.07;
    parts.push(paint(rod(v(x, -0.1, z), v(x, -0.265, z), 0.006, 4), BRASS));
  }
  return merge(parts);
}

/** A swinging lantern. `hookLength` tunes the swing period: longer is slower and calmer. */
export function Lantern({ light = true, hookLength = 0.35 }: { light?: boolean; hookLength?: number }) {
  const pivot = useRef<THREE.Group>(null);
  const frame = useMemo(() => lanternFrameGeometry(), []);
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 }), []);
  const glass = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#fff1d6",
        emissive: LANTERN_LIGHT,
        emissiveIntensity: 1.6,
        transparent: true,
        opacity: 0.55,
        roughness: 0.2,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      frame.dispose();
      brass.dispose();
      glass.dispose();
    },
    [frame, brass, glass],
  );

  const swing = useRef({ ax: 0, az: 0, vx: 0, vz: 0, last: new THREE.Vector3(), lastV: new THREE.Vector3(), primed: false });
  useFrame((_, dtRaw) => {
    const g = pivot.current;
    const parent = g?.parent;
    if (!g || !parent) return;
    const dt = Math.min(dtRaw, 1 / 30);
    const s = swing.current;
    const p = parent.getWorldPosition(tmpP);
    if (!s.primed) {
      s.last.copy(p);
      s.lastV.set(0, 0, 0);
      s.primed = true;
      return;
    }
    // Acceleration of the hook, in the parent's frame, drives the pendulum.
    const vel = tmpV.subVectors(p, s.last).divideScalar(Math.max(dt, 1e-4));
    const acc = tmpA.subVectors(vel, s.lastV).divideScalar(Math.max(dt, 1e-4)).clampLength(0, 30);
    s.last.copy(p);
    s.lastV.copy(vel);
    parent.getWorldQuaternion(tmpQ).invert();
    acc.applyQuaternion(tmpQ);
    const w2 = 9.81 / hookLength;
    const damping = 3.2;
    // Small-angle pendulum: the lantern lags the hook, so its foot swings
    // against the acceleration (about z for forward, about x for sideways).
    s.vz += (-w2 * s.az - (acc.x / hookLength) * 0.5 - damping * s.vz) * dt;
    s.vx += (-w2 * s.ax + (acc.z / hookLength) * 0.5 - damping * s.vx) * dt;
    s.az = Math.max(-0.6, Math.min(0.6, s.az + s.vz * dt));
    s.ax = Math.max(-0.6, Math.min(0.6, s.ax + s.vx * dt));
    g.rotation.set(s.ax, 0, s.az);
  });

  return (
    <group ref={pivot}>
      <mesh geometry={frame} material={brass} castShadow />
      <mesh position={[0, -0.18, 0]} material={glass}>
        <cylinderGeometry args={[0.062, 0.062, 0.15, 6, 1, true]} />
      </mesh>
      <mesh position={[0, -0.19, 0]}>
        <sphereGeometry args={[0.032, 12, 8]} />
        <meshBasicMaterial color="#ffe2a8" toneMapped={false} />
      </mesh>
      {light && <pointLight position={[0, -0.19, 0]} color={LANTERN_LIGHT} intensity={2.2} distance={6} decay={2} />}
    </group>
  );
}

const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * The cart body in chassis space (+x forward, +y up). `wheels` receives the
 * four wheel groups, front-right, front-left, rear-right, rear-left, for the
 * parent to move each frame.
 */
export function LanternCart({ wheels }: { wheels: RefObject<Array<THREE.Group | null>> }) {
  const weave = useMemo(() => {
    const t = weaveTexture();
    t.repeat.set(7, 2);
    return t;
  }, []);
  const tub = useMemo(() => tubGeometry(), []);
  const frame = useMemo(() => frameGeometry(), []);
  const wheel = useMemo(() => wheelGeometry(), []);
  const woven = useMemo(() => new THREE.MeshStandardMaterial({ map: weave, roughness: 0.85, side: THREE.DoubleSide }), [weave]);
  const painted = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), []);
  useEffect(
    () => () => {
      weave.dispose();
      tub.dispose();
      frame.dispose();
      wheel.dispose();
      woven.dispose();
      painted.dispose();
    },
    [weave, tub, frame, wheel, woven, painted],
  );

  return (
    <group>
      <mesh geometry={tub} material={woven} castShadow receiveShadow />
      <mesh position={[0, -0.34, 0]} castShadow receiveShadow material={woven}>
        <boxGeometry args={[0.98, 0.03, 0.5]} />
      </mesh>
      <mesh geometry={frame} material={painted} castShadow />
      {[0, 1, 2, 3].map((i) => (
        <group
          key={i}
          ref={(el) => {
            wheels.current[i] = el;
          }}
          position={[i < 2 ? WHEEL.offset.x : -WHEEL.offset.x, -0.54, i % 2 === 0 ? WHEEL.offset.z : -WHEEL.offset.z]}
        >
          <mesh geometry={wheel} material={painted} castShadow />
        </group>
      ))}
      {/* Drawn a size up on the hook so the guardian light reads from the follow camera. */}
      <group position={[-0.26, 1.1, 0]} scale={1.5}>
        <Lantern />
      </group>
    </group>
  );
}
