"use client";
// The forty placeholder plots: a two-leaf sprout at the foot of a slim stake
// with a warm glowing bulb, all one instanced mesh and so one draw call. The
// plot the cart is visiting breathes brighter, and the one it has pulled up
// beside glows steady, so arriving at someone's plant reads at a glance.
// The wheels never see these: their colliders (in PhysicsWorld) are sensors
// in a group the wheel rays filter out.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BED, PLOTS } from "@/components/meadow/layout";
import { glowMaterial, merge, paint } from "@/components/meadow/parts";
import { meadow } from "@/components/meadow/runtime";

function markerGeometry(): THREE.BufferGeometry {
  const stake = new THREE.CylinderGeometry(0.018, 0.024, 0.5, 6);
  stake.translate(0, 0.25, 0);
  const bulb = new THREE.SphereGeometry(0.055, 12, 8);
  bulb.translate(0, 0.55, 0);
  const leaf = (dir: number) => {
    const g = new THREE.SphereGeometry(0.07, 8, 6);
    g.scale(1, 0.25, 0.5);
    g.rotateZ(dir * 0.5);
    g.translate(dir * 0.07, 0.1, 0.05);
    return paint(g, "#7fb85e");
  };
  const stem = new THREE.CylinderGeometry(0.008, 0.01, 0.1, 5);
  stem.translate(0, 0.05, 0.05);
  return merge([paint(stake, "#8a6844"), paint(bulb, "#ffbf6a", 1), paint(stem, "#6aa04c"), leaf(1), leaf(-1)]);
}

const BASE = new THREE.Color(1, 1, 1);
const NEAR = new THREE.Color(1.5, 1.4, 1.2);
const tmp = new THREE.Color();

export function PlotMarkers() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => markerGeometry(), []);
  const material = useMemo(() => glowMaterial({ roughness: 0.7 }, 1.8), []);
  useEffect(
    () => () => {
      geo.dispose();
      material.dispose();
    },
    [geo, material],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const p of PLOTS) {
      // Sprouts face the nearest path, so a visiting cart sees their leaves.
      q.setFromAxisAngle(up, p.side === "inner" ? -p.a - Math.PI / 2 : -p.a + Math.PI / 2);
      m.compose(new THREE.Vector3(p.x, BED.soilH, p.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(p.index, m);
      mesh.setColorAt(p.index, BASE);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  const last = useRef({ near: -2, target: -2 });
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh || !mesh.instanceColor) return;
    const { nearPlot, targetPlot } = meadow;
    const l = last.current;
    if (nearPlot === l.near && targetPlot < 0 && l.target < 0) return;
    for (const i of [l.near, l.target]) if (i >= 0) mesh.setColorAt(i, BASE);
    if (nearPlot >= 0) mesh.setColorAt(nearPlot, NEAR);
    if (targetPlot >= 0) {
      const breathe = 1.25 + 0.35 * Math.sin(state.clock.elapsedTime * 3);
      mesh.setColorAt(targetPlot, tmp.setRGB(breathe, breathe * 0.95, breathe * 0.85));
    }
    l.near = nearPlot;
    l.target = targetPlot;
    mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, material, PLOTS.length]} castShadow />;
}
