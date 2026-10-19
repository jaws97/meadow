"use client";
// The golden firefly trail of "Find a friend": while a journey is on, a stream of fireflies drifts along the planned
// route (the path graph's way round the rings and down the avenues, route.ts) from the cart to the friend's plant,
// bobbing and weaving a little as fireflies do, and a ring of gold breathes round the plant waiting at the end. The
// trail is eaten up from the cart's end as the cart drives it. Each firefly is a soft glow that always faces the
// camera; additive light, one instanced mesh for the fireflies and one ring; nothing is drawn when no journey is on.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { plotAt } from "@/components/meadow/layout";
import { meadow } from "@/components/meadow/runtime";

const COUNT = 72;
const GOLD = new THREE.Color("#ffbf4d");
const MAX_POINTS = 256;
/** A firefly's glow, metres across (a bright core inside a soft halo, always facing the camera). */
const GLOW = 0.42;

/** A firefly's light: a hot core and a soft golden halo, drawn once. */
function glowTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,240,200,0.95)");
  g.addColorStop(0.3, "rgba(255,200,110,0.35)");
  g.addColorStop(1, "rgba(255,170,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Fireflies() {
  const flies = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const res = useMemo(() => {
    const base = { transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending } as const;
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const glow = glowTexture();
    return {
      fly: new THREE.PlaneGeometry(1, 1),
      glow,
      flyMat: new THREE.MeshBasicMaterial({ ...base, map: glow, color: GOLD }),
      ringGeo,
      ringMat: new THREE.MeshBasicMaterial({ ...base, color: GOLD, side: THREE.DoubleSide }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(res)) v.dispose();
    },
    [res],
  );
  const path = useRef({ version: -1, xs: new Float32Array(MAX_POINTS), zs: new Float32Array(MAX_POINTS), cum: new Float32Array(MAX_POINTS), n: 0 });
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);

  useFrame((state) => {
    const mesh = flies.current;
    const r = ring.current;
    if (!mesh || !r) return;
    const on = meadow.journey && meadow.route.count >= 2;
    mesh.visible = on;
    const target = meadow.targetPlot >= 0 ? plotAt(meadow.targetPlot) : null;
    r.visible = on && target !== null;
    if (!on) return;
    const t = state.clock.elapsedTime;
    if (target) {
      r.position.set(target.x, target.y + 0.03, target.z);
      const s = 1 + 0.12 * Math.sin(t * 2.4);
      r.scale.set(s, 1, s);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2.4);
    }
    // the remaining route: from the cart's nearest point on it to the end
    const P = path.current;
    const route = meadow.route;
    const cart = meadow.mover?.state.position;
    P.n = 0;
    let best = 0;
    let bestD = Infinity;
    let bestT = 0;
    for (let i = 1; i < route.count; i++) {
      const ax = route.points[(i - 1) * 2], az = route.points[(i - 1) * 2 + 1];
      const bx = route.points[i * 2], bz = route.points[i * 2 + 1];
      if (!cart) break;
      const vx = bx - ax, vz = bz - az;
      const len = vx * vx + vz * vz || 1;
      const u = Math.min(1, Math.max(0, ((cart.x - ax) * vx + (cart.z - az) * vz) / len));
      const d = Math.hypot(ax + vx * u - cart.x, az + vz * u - cart.z);
      if (d < bestD) {
        bestD = d;
        best = i;
        bestT = u;
      }
    }
    const ax = route.points[(best - 1) * 2] ?? 0, az = route.points[(best - 1) * 2 + 1] ?? 0;
    const bx = route.points[best * 2] ?? 0, bz = route.points[best * 2 + 1] ?? 0;
    P.xs[0] = cart ? ax + (bx - ax) * bestT : route.points[0];
    P.zs[0] = cart ? az + (bz - az) * bestT : route.points[1];
    P.cum[0] = 0;
    P.n = 1;
    for (let i = best; i < route.count && P.n < MAX_POINTS; i++) {
      P.xs[P.n] = route.points[i * 2];
      P.zs[P.n] = route.points[i * 2 + 1];
      P.cum[P.n] = P.cum[P.n - 1] + Math.hypot(P.xs[P.n] - P.xs[P.n - 1], P.zs[P.n] - P.zs[P.n - 1]);
      P.n++;
    }
    const L = P.cum[P.n - 1];
    if (L < 0.3) {
      mesh.count = 0;
      return;
    }
    const face = state.camera.quaternion;
    for (let i = 0; i < COUNT; i++) {
      // each firefly drifts down the route at an easy pace and starts again at the cart
      const s = ((i / COUNT + t * (1.4 / Math.max(6, L))) % 1) * L;
      let seg = 1;
      while (seg < P.n - 1 && P.cum[seg] < s) seg++;
      const s0 = P.cum[seg - 1], s1 = P.cum[seg];
      const u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
      const x = P.xs[seg - 1] + (P.xs[seg] - P.xs[seg - 1]) * u;
      const z = P.zs[seg - 1] + (P.zs[seg] - P.zs[seg - 1]) * u;
      // a firefly's own bob and weave, and a twinkle
      const k = i * 1.7;
      const wob = 0.22 * Math.sin(t * 1.3 + k);
      const dx = P.xs[seg] - P.xs[seg - 1], dz = P.zs[seg] - P.zs[seg - 1];
      const dl = Math.hypot(dx, dz) || 1;
      const y = 0.55 + 0.22 * Math.sin(t * 2.1 + k * 1.3) + 0.1 * Math.sin(t * 0.7 + k);
      const ends = Math.min(1, s / 1.2, (L - s) / 0.8);
      const twinkle = 0.55 + 0.45 * Math.sin(t * 5 + k * 2.3);
      const size = Math.max(0.0001, ends * (0.7 + 0.5 * twinkle)) * GLOW;
      tmp.p.set(x - (dz / dl) * wob, y, z + (dx / dl) * wob);
      tmp.m.compose(tmp.p, face, tmp.s.set(size, size, size));
      mesh.setMatrixAt(i, tmp.m);
      mesh.setColorAt(i, tmp.c.copy(GOLD).multiplyScalar(0.6 + 0.8 * twinkle));
    }
    mesh.count = COUNT;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={flies} args={[res.fly, res.flyMat, COUNT]} frustumCulled={false} renderOrder={5} visible={false} />
      <mesh ref={ring} geometry={res.ringGeo} material={res.ringMat} visible={false} renderOrder={5} />
    </>
  );
}
