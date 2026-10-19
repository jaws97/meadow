"use client";
// The doe in the scene: her skinned mesh (build.ts, coat.ts), the animator that moves her (motion.ts) under a scripted
// visit (tour.ts), and soft contact shadows on the lawn: one under her body and one under each hoof, which fade as a
// hoof lifts. The lite tier has no sun shadow at all, and the sun's shadow box covers little of the garden's edges,
// so the contact shadows are what set her on the ground on every device; on the richer tiers she also casts a real
// shadow where the sun's box reaches.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLayerFrame, useTier } from "@/components/garden/TierLayers";
import { buildDoe } from "@/components/deer/build";
import { coatMaterial } from "@/components/deer/coat";
import { DoeAnimator } from "@/components/deer/motion";
import { Tour, type Act } from "@/components/deer/tour";
import { env } from "@/lib/garden/env";
import { hashSeed } from "@/lib/plant/prng";

/** The live doe, for the stage's follow camera and the page's numbers. */
export const doeHandle: { anim: DoeAnimator | null; mesh: THREE.SkinnedMesh | null; triangles: number } = {
  anim: null,
  mesh: null,
  triangles: 0,
};

let blob: THREE.CanvasTexture | null = null;
/** A soft round falloff, white in the middle, for the contact shadows' alpha. */
function blobTexture(): THREE.CanvasTexture {
  if (blob) return blob;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blob = new THREE.CanvasTexture(c);
  return blob;
}

const v = new THREE.Vector3();
const m = new THREE.Matrix4();
const qy = new THREE.Quaternion();
const scl = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Lying flat on the lawn, a hair above it. */
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const BLOB_Y = 0.006;

export function Doe({ act, seed = "Lijas", lookAt }: { act: Act; seed?: string; lookAt: THREE.Vector3 }) {
  const tier = useTier();
  const doe = useMemo(() => {
    const b = buildDoe(tier);
    const material = coatMaterial(tier, b.lengths, (hashSeed(seed) % 997) * 0.37);
    const mesh = new THREE.SkinnedMesh(b.geometry, material);
    mesh.name = "doe";
    mesh.add(b.bones[0]);
    mesh.bind(new THREE.Skeleton(b.bones));
    mesh.castShadow = tier !== "lite";
    mesh.receiveShadow = true;
    // her pose reaches past the standing outline (the neck down to graze); the sphere is kept generous
    b.geometry.boundingSphere!.radius *= 1.3;
    const anim = new DoeAnimator(mesh, b.bones, hashSeed(seed));
    return { mesh, anim, material, geometry: b.geometry, triangles: b.triangles };
  }, [tier, seed]);

  const tall = useThree((st) => st.size.width / Math.max(1, st.size.height) < 0.8);
  const tour = useMemo(() => {
    const t = new Tour(act, lookAt, tall);
    t.start(doe.anim);
    return t;
  }, [act, lookAt, doe, tall]);

  useEffect(() => {
    doeHandle.anim = doe.anim;
    doeHandle.mesh = doe.mesh;
    doeHandle.triangles = doe.triangles;
    return () => {
      doe.geometry.dispose();
      doe.material.dispose();
      if (doeHandle.mesh === doe.mesh) {
        doeHandle.anim = null;
        doeHandle.mesh = null;
      }
    };
  }, [doe]);

  const shadowMat = useMemo(
    () =>
      ({
        body: new THREE.MeshBasicMaterial({ color: "#1b120a", alphaMap: blobTexture(), transparent: true, opacity: 0.42, depthWrite: false }),
        hoof: new THREE.MeshBasicMaterial({ color: "#140d07", alphaMap: blobTexture(), transparent: true, opacity: 0.55, depthWrite: false }),
      }) as const,
    [],
  );
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const body = useRef<THREE.Mesh>(null);
  const feet = useRef<THREE.InstancedMesh>(null);

  useLayerFrame((_, delta) => {
    tour.step(delta, doe.anim);
    doe.anim.update(delta, tour.intent, env.time);
    const b = body.current;
    if (b) {
      // under her barrel, a little behind the withers
      const h = doe.anim.heading;
      b.position.set(doe.anim.pos.x - 0.2 * Math.cos(h), BLOB_Y, doe.anim.pos.y + 0.2 * Math.sin(h));
      qy.setFromAxisAngle(UP, h);
      b.quaternion.copy(qy).multiply(FLAT);
      b.scale.set(1.05, 0.42, 1);
    }
    const f = feet.current;
    if (f) {
      for (let i = 0; i < doe.anim.feet; i++) {
        const lift = doe.anim.foot(i, v);
        const s = 0.11 * (1 + lift * 4);
        const fade = Math.max(0, 1 - lift / 0.08);
        v.y = BLOB_Y + 0.001;
        scl.set(s * fade + 1e-4, s * fade + 1e-4, 1);
        m.compose(v, FLAT, scl);
        f.setMatrixAt(i, m);
      }
      f.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="deer">
      <primitive object={doe.mesh} />
      <mesh ref={body} geometry={plane} material={shadowMat.body} renderOrder={1} />
      <instancedMesh ref={feet} args={[plane, shadowMat.hoof, 4]} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
