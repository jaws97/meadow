"use client";
/* eslint-disable react-hooks/immutability --
   Materials, uniforms and the swing state are created once and then written in the frame loop, which is how an R3F
   prop animates without re-rendering; the React Compiler lint reads those writes as mutating a hook's value. They
   never feed back into what React renders. */
// Shared parts for the three Lantern Cart concepts (CaneCart, SeedBarrow, FireflyTrolley): the swinging hook every
// lantern hangs from, the soft halo that makes a lantern read as a light from the follow camera, the four wheel
// mounts the physics poses, and a few geometry and canvas helpers. Each concept is drawn in chassis space exactly
// like the placeholder in ../LanternCart.tsx (+x forward, +y up, the chassis centre at the origin, the wheels'
// centres 0.54 below it at the default ride), takes the same `wheels` ref, and reads meadow.night for its glow, so
// whichever is chosen drops into PhysicsCart in place of the placeholder with one import changed. The chosen one, the
// firefly trolley, is built for the Meadow in ../FireflyTrolley.tsx from these same parts.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { WHEEL } from "@/components/meadow/cart";
import { meadow } from "@/components/meadow/runtime";

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Wheel centres below the chassis at the default ride, as the placeholder draws them. */
export const WHEEL_Y = -0.54;
/** The ground under a cart at rest, in chassis space. */
export const GROUND_Y = WHEEL_Y - WHEEL.radius;

export type WheelRefs = RefObject<Array<THREE.Group | null>>;
export interface ConceptProps {
  /** Receives the four wheel groups (front-right, front-left, rear-right, rear-left) for the parent to pose. */
  wheels: WheelRefs;
}

/** Creates a component's three.js objects once, and disposes every one that can be when the component goes. */
export function useAssets<T extends Record<string, unknown>>(make: () => T): T {
  const [assets] = useState(make);
  useEffect(
    () => () => {
      for (const a of Object.values(assets)) {
        const d = (a as { dispose?: unknown } | null)?.dispose;
        if (typeof d === "function") d.call(a);
      }
    },
    [assets],
  );
  return assets;
}

/** A lathe from [radius, height] pairs, listed bottom to top so the faces look outward. */
export function lathe(profile: Array<[number, number]>, segments: number, phase = 0): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
    phase,
  );
}

/** A lathe turned to lie in the wheel's plane (XY), its top pointing out along +z: hubs, caps, discs. */
export function axleLathe(profile: Array<[number, number]>, segments: number): THREE.BufferGeometry {
  const g = lathe(profile, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A smooth tube through `points`. */
export function tube(points: THREE.Vector3[], radius: number, tubular: number, radial: number, closed = false): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.5);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** A tube along any curve. */
export function tubeAlong(curve: THREE.Curve<THREE.Vector3>, radius: number, tubular: number, radial: number, closed = false): THREE.TubeGeometry {
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** A tapered, open-ended cylinder from a to b (spokes, stems): no caps, since nobody sees them. */
export function spoke(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segments = 5): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r1, r0, len, segments, 1, true);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geo.translate(mid.x, mid.y, mid.z);
  return geo;
}

/** A superellipse in the XZ plane: n = 2 is an ellipse, larger n squares it off toward a rounded rectangle. */
export function squirclePoint(theta: number, a: number, b: number, n: number, target = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const k = 2 / n;
  return target.set(a * Math.sign(c) * Math.abs(c) ** k, 0, b * Math.sign(s) * Math.abs(s) ** k);
}

/** A closed superellipse loop at height y, for rims and bands. */
export class Loop extends THREE.Curve<THREE.Vector3> {
  a: number;
  b: number;
  n: number;
  y: number;
  constructor(a: number, b: number, n: number, y: number) {
    super();
    this.a = a;
    this.b = b;
    this.n = n;
    this.y = y;
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    squirclePoint(t * Math.PI * 2, this.a, this.b, this.n, target);
    target.y = this.y;
    return target;
  }
}

/** Reshapes a lathe (or a disc in the XZ plane) from round to a superellipse a wide by b deep. */
export function squircle(geo: THREE.BufferGeometry, a: number, b: number, n: number): THREE.BufferGeometry {
  const p = geo.attributes.position;
  const k = 2 / n;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-7) continue;
    const c = x / r;
    const s = z / r;
    p.setXYZ(i, a * r * Math.sign(c) * Math.abs(c) ** k, p.getY(i), b * r * Math.sign(s) * Math.abs(s) ** k);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Pushes a polyhedron's vertices in and out by up to `amount` of its radius, the same for every copy of a vertex so
 * the faces stay joined, then flat-shades it: a crumpled, petal-ish ball for marigolds and leafy bushes.
 */
export function crumple(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 991) * 78.233 + Math.round(z * 983) * 37.719 + seed) * 43758.5453;
    const k = 1 + amount * ((h - Math.floor(h)) * 2 - 1);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Points along a hanging string from a to b that sags `sag` at its middle (a parabola is close enough). */
export function swag(a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}

/** Bakes a translation, rotation and scale into a geometry, for scattering painted parts before a merge. */
export function place(geo: THREE.BufferGeometry, pos: THREE.Vector3, rot: THREE.Euler, scale: THREE.Vector3 | number = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : scale);
  geo.applyMatrix4(m);
  return geo;
}

/** A canvas texture drawn once by `draw`. Original procedural art only. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let glowTex: THREE.CanvasTexture | null = null;
/** A soft round light, hot in the middle: lantern halos and fireflies. Shared and never disposed. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(64, 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.14, "rgba(255,244,214,0.85)");
    g.addColorStop(0.38, "rgba(255,214,150,0.28)");
    g.addColorStop(1, "rgba(255,190,110,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  glowTex.wrapS = THREE.ClampToEdgeWrapping;
  glowTex.wrapT = THREE.ClampToEdgeWrapping;
  return glowTex;
}

/** How strongly lights show at this hour: `day` in full daylight rising to `night` after dark, with a slow breath. */
export function glowAt(day: number, night: number, t: number, breath = 0.05): number {
  return (day + (night - day) * meadow.night) * (1 - breath + breath * Math.sin(t * 2.3) * Math.sin(t * 0.77 + 1.1));
}

/**
 * The soft glow round a lantern: a camera-facing card, additive, faint by day and full after dark. Without a bloom
 * pass in the Meadow this is what makes the guardian light read as a light from the follow camera's height.
 */
export function Halo({ size, color, day = 0.18, night = 0.95, position }: { size: number; color: string; day?: number; night?: number; position?: [number, number, number] }) {
  const material = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    material.opacity = glowAt(day, night, state.clock.elapsedTime);
  });
  return <sprite material={material} scale={size} position={position} />;
}

const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * A lantern's hook. The group the ref is put on swings as a damped pendulum fed by how its parent accelerates (the
 * same small-angle model as the placeholder's lantern), plus a breath of air so a cart standing still is never quite
 * still. `hookLength` sets the period: longer is slower and calmer. `priority` is when it runs in the frame: a lantern
 * whose position something else reads in the same frame (the built trolley's jar, for its light) swings early.
 */
export function useSwing(hookLength: number, air = 0.03, priority = 0): RefObject<THREE.Group | null> {
  const pivot = useRef<THREE.Group>(null);
  const swing = useRef({ ax: 0, az: 0, vx: 0, vz: 0, last: new THREE.Vector3(), lastV: new THREE.Vector3(), primed: false });
  useFrame((state, dtRaw) => {
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
    const vel = tmpV.subVectors(p, s.last).divideScalar(Math.max(dt, 1e-4));
    const acc = tmpA.subVectors(vel, s.lastV).divideScalar(Math.max(dt, 1e-4)).clampLength(0, 30);
    s.last.copy(p);
    s.lastV.copy(vel);
    parent.getWorldQuaternion(tmpQ).invert();
    acc.applyQuaternion(tmpQ);
    const w2 = 9.81 / hookLength;
    const damping = 3.2;
    s.vz += (-w2 * s.az - (acc.x / hookLength) * 0.5 - damping * s.vz) * dt;
    s.vx += (-w2 * s.ax + (acc.z / hookLength) * 0.5 - damping * s.vx) * dt;
    s.az = Math.max(-0.6, Math.min(0.6, s.az + s.vz * dt));
    s.ax = Math.max(-0.6, Math.min(0.6, s.ax + s.vx * dt));
    const t = state.clock.elapsedTime;
    g.rotation.set(s.ax + air * 0.6 * Math.sin(t * 0.83 + 1.3), 0, s.az + air * Math.sin(t * 0.61));
  }, priority);
  return pivot;
}

/**
 * The four wheel mounts, front-right, front-left, rear-right, rear-left, where the placeholder puts them. `children`
 * is one wheel drawn with its outer face toward +z; the left pair are mirrored so their hubs face outward too.
 */
export function Wheels({ wheels, children }: { wheels: WheelRefs; children: ReactNode }) {
  return [0, 1, 2, 3].map((i) => (
    <group
      key={i}
      ref={(el) => {
        wheels.current[i] = el;
      }}
      position={[i < 2 ? WHEEL.offset.x : -WHEEL.offset.x, WHEEL_Y, i % 2 === 0 ? WHEEL.offset.z : -WHEEL.offset.z]}
    >
      <group scale={[1, 1, i % 2 === 0 ? 1 : -1]}>{children}</group>
    </group>
  ));
}
