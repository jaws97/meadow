"use client";
// Gentle guides on the lawn: a dotted trail along the autopilot's route that
// is eaten up as the cart drives it, a slowly breathing ring where a tap sent
// it, and a small ring under a driving finger that widens with the pull.
// They tell the player what the cart is about to do without a word of UI. A
// find-a-friend journey has its fireflies instead, so the dots stand aside.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadow } from "@/components/meadow/runtime";

const MAX_DOTS = 96;
const SPACING = 0.55;
const DOT_Y = 0.03;
const GUIDE = "#fff1cf";
const mtx = new THREE.Matrix4();

export function GuideMarkers() {
  const dots = useRef<THREE.InstancedMesh>(null);
  const goal = useRef<THREE.Mesh>(null);
  const finger = useRef<THREE.Mesh>(null);
  const dotGeo = useMemo(() => {
    const g = new THREE.CircleGeometry(0.06, 10);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const ringGeo = useMemo(() => {
    const g = new THREE.RingGeometry(0.34, 0.42, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: GUIDE, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    [],
  );
  const goalMat = useMemo(() => mat.clone(), [mat]);
  const fingerMat = useMemo(() => mat.clone(), [mat]);
  useEffect(
    () => () => {
      dotGeo.dispose();
      ringGeo.dispose();
      mat.dispose();
      goalMat.dispose();
      fingerMat.dispose();
    },
    [dotGeo, ringGeo, mat, goalMat, fingerMat],
  );

  const trail = useRef({ version: -1, xs: new Float32Array(MAX_DOTS), zs: new Float32Array(MAX_DOTS), count: 0, eaten: 0 });

  useFrame((state) => {
    const t = trail.current;
    const r = meadow.route;
    const mesh = dots.current;
    if (!mesh) return;
    if (t.version !== r.version) {
      // Resample the polyline at even spacing, skipping the stretch under the cart.
      t.version = r.version;
      t.count = 0;
      t.eaten = 0;
      let carry = SPACING * 1.5;
      for (let i = 1; i < r.count && t.count < MAX_DOTS; i++) {
        const ax = r.points[(i - 1) * 2];
        const az = r.points[(i - 1) * 2 + 1];
        const bx = r.points[i * 2];
        const bz = r.points[i * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        let d = carry;
        while (d <= len && t.count < MAX_DOTS) {
          t.xs[t.count] = ax + ((bx - ax) * d) / len;
          t.zs[t.count] = az + ((bz - az) * d) / len;
          t.count++;
          d += SPACING;
        }
        carry = d - len;
      }
    }
    // Dots behind the nearest one to the cart have been driven over.
    const p = meadow.mover?.state.position;
    if (p && t.count > 0) {
      let best = t.eaten;
      let bestD = Infinity;
      for (let i = t.eaten; i < Math.min(t.count, t.eaten + 12); i++) {
        const d = Math.hypot(t.xs[i] - p.x, t.zs[i] - p.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < 0.9) t.eaten = best + 1;
    }
    let shown = 0;
    // a find-a-friend journey is lit by the fireflies instead (Fireflies.tsx)
    if (!meadow.journey) for (let i = t.eaten; i < t.count; i++) {
      mtx.makeTranslation(t.xs[i], DOT_Y, t.zs[i]);
      mesh.setMatrixAt(shown++, mtx);
    }
    mesh.count = shown;
    mesh.instanceMatrix.needsUpdate = true;

    const time = state.clock.elapsedTime;
    const g = goal.current;
    if (g) {
      g.visible = meadow.goal.active && !meadow.journey;
      g.position.set(meadow.goal.x, DOT_Y + 0.005, meadow.goal.z);
      const s = 1 + 0.08 * Math.sin(time * 2.2);
      g.scale.set(s, 1, s);
      (g.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(time * 2.2);
    }
    const f = finger.current;
    if (f) {
      f.visible = meadow.finger.active;
      f.position.set(meadow.finger.x, DOT_Y + 0.01, meadow.finger.z);
      const s = 0.6 + meadow.finger.power * 0.9;
      f.scale.set(s, 1, s);
      (f.material as THREE.MeshBasicMaterial).opacity = 0.35 + meadow.finger.power * 0.5;
    }
  }, -0.5);

  return (
    <>
      <instancedMesh ref={dots} args={[dotGeo, mat, MAX_DOTS]} frustumCulled={false} renderOrder={2} />
      <mesh ref={goal} geometry={ringGeo} material={goalMat} visible={false} renderOrder={2} />
      <mesh ref={finger} geometry={ringGeo} material={fingerMat} visible={false} renderOrder={2} />
    </>
  );
}
