"use client";
// The doe in the scene: her skinned mesh (build.ts, coat.ts), the animator that moves her (motion.ts) under a scripted
// visit (tour.ts), and soft contact shadows on the lawn: one under her body and one under each hoof, which fade as a
// hoof lifts. The lite tier has no sun shadow at all, and the sun's shadow box covers little of the garden's edges,
// so the contact shadows are what set her on the ground on every device; on the richer tiers she also casts a real
// shadow where the sun's box reaches.
//
// In the garden (components/deer/DeerVisit) she is a visit: there from the first frame the opening compiles and
// pre-draws, grazing in place while the loading veil is up and out of the governor's calibration under it (so the tier
// the device settles on, and remembers, is the garden's own), and her visit begins as the garden is revealed. While
// she is in the showing garden the governor holds (lib/garden/quality visitorHold); when someone comes close (the
// camera as drawn, so mount her after the camera rig) or her station stops fitting the screen, she walks out early,
// calmly, by the way that keeps away from the viewer; once she has walked out she is hidden and costs nothing more.
// If her station does not fit by the time the garden is revealed she never shows at all: she is still mounted (and
// compiled) under the veil, so a station that comes to fit as the garden's plant arrives costs no first draw.
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLayerFrame, useTier } from "@/components/garden/TierLayers";
import { buildDoe } from "@/components/deer/build";
import { coatMaterial } from "@/components/deer/coat";
import { DoeAnimator } from "@/components/deer/motion";
import type { DeerStation } from "@/components/deer/stations";
import { Tour, type Act } from "@/components/deer/tour";
import { env } from "@/lib/garden/env";
import { quality, underVeil, visitorHold } from "@/lib/garden/quality";
import type { Quality } from "@/lib/garden/store";
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
/** A frame's step is never longer than this (s): after a stall she carries on rather than leaping. */
const MAX_STEP = 0.1;
/** The camera this close to her body (m) and she makes her way out. */
const YIELD_M = 2.0;
/** Her body, for that distance: a line from the chest to the rump (m along her heading from the withers), at barrel height. */
const CHEST = 0.25;
const RUMP = -0.55;
const BARREL_Y = 0.7;

/** The garden's visit: told when she is first seen and when she has gone. */
export interface VisitHooks {
  shown(): void;
  gone(): void;
}

interface DoeProps {
  act: Act;
  seed?: string;
  lookAt: THREE.Vector3;
  /** Her build's tier, when it is not her layer's or the store's (the garden's visit keeps the one she was shown in). */
  tier?: Quality;
  /** A portrait screen's tour, when it is not to follow the canvas (the garden's visit keeps the one she was shown in). */
  tall?: boolean;
  /** The garden's visit (see the head of this file). */
  visit?: VisitHooks;
  /** Where the garden's visit stands (components/deer/stations). */
  station?: DeerStation;
  /** False: her station no longer fits the screen; she does not show, or, already shown, makes her way out. */
  stay?: boolean;
}

/** The camera's distance to her body (m). */
function distanceToBody(cam: THREE.Vector3, x: number, z: number, heading: number): number {
  const fx = Math.cos(heading);
  const fz = -Math.sin(heading);
  // the closest point of the chest-to-rump line
  const along = Math.min(CHEST, Math.max(RUMP, (cam.x - x) * fx + (cam.z - z) * fz));
  return Math.hypot(cam.x - (x + along * fx), cam.y - BARREL_Y, cam.z - (z + along * fz));
}

export function Doe({ act, seed = "Lijas", lookAt, tier: fixedTier, tall: fixedTall, visit, station, stay = true }: DoeProps) {
  const layerTier = useTier();
  const tier = fixedTier ?? layerTier;
  const doe = useMemo(() => {
    const b = buildDoe(tier);
    const material = coatMaterial(tier, b.lengths, (hashSeed(seed) % 997) * 0.37);
    const mesh = new THREE.SkinnedMesh(b.geometry, material);
    mesh.name = "doe";
    mesh.add(b.bones[0]);
    mesh.bind(new THREE.Skeleton(b.bones));
    mesh.castShadow = tier !== "lite";
    mesh.receiveShadow = true;
    // her pose reaches past the standing outline (the neck down to graze); the sphere is kept generous, and given to
    // the mesh itself, which a skinned mesh is culled by (otherwise worked out once, from whatever pose it first had)
    b.geometry.boundingSphere!.radius *= 1.3;
    mesh.boundingSphere = b.geometry.boundingSphere!.clone();
    const anim = new DoeAnimator(mesh, b.bones, hashSeed(seed));
    return { mesh, anim, material, geometry: b.geometry, triangles: b.triangles };
  }, [tier, seed]);

  const canvasTall = useThree((st) => st.size.width / Math.max(1, st.size.height) < 0.8);
  const tall = fixedTall ?? canvasTall;
  const tour = useMemo(() => {
    const t = new Tour(act, lookAt, tall, station);
    t.start(doe.anim);
    return t;
  }, [act, lookAt, doe, tall, station]);
  const staying = useRef(stay);
  useLayoutEffect(() => {
    staying.current = stay;
  });

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
  useEffect(
    () => () => {
      shadowMat.body.dispose();
      shadowMat.hoof.dispose();
      plane.dispose();
    },
    [shadowMat, plane],
  );
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const feet = useRef<THREE.InstancedMesh>(null);

  // A visit's course: whether she has been shown, the governor's hold while she is there, and whether she has gone.
  const life = useRef<{ shown: boolean; gone: boolean; release: (() => void) | null }>({ shown: false, gone: false, release: null });
  const hooks = useRef(visit);
  useLayoutEffect(() => {
    hooks.current = visit;
  });
  const visiting = visit !== undefined;
  useLayoutEffect(() => {
    if (!visiting) return;
    // Set as the phase changes, not from the frame loop: the opening compiles with the loop stopped, and must see her.
    const apply = () => {
      const g = group.current;
      if (!g) return;
      const q = quality.get();
      g.visible = !life.current.gone && !(underVeil(q) && q.phase === "calibrating");
    };
    apply();
    return quality.subscribe(apply);
  }, [visiting]);
  useEffect(
    () => () => {
      life.current.release?.();
      life.current.release = null;
    },
    [],
  );

  useLayerFrame((state, frameDelta) => {
    const delta = Math.min(frameDelta, MAX_STEP);
    let dt = delta;
    if (visiting) {
      const l = life.current;
      if (l.gone) return;
      if (underVeil()) {
        // the garden is not shown yet: she grazes where she stands, her visit not begun
        dt = 0;
      } else {
        if (!l.shown) {
          if (!staying.current) {
            // her station does not fit this screen and flower: she is not here today
            l.gone = true;
            if (group.current) group.current.visible = false;
            return;
          }
          l.shown = true;
          l.release = visitorHold.acquire();
          hooks.current?.shown();
        }
        const cam = state.camera.position;
        tour.seeViewer(cam.x);
        if (!tour.leaving && (!staying.current || distanceToBody(cam, doe.anim.pos.x, doe.anim.pos.y, doe.anim.heading) < YIELD_M)) tour.leave();
      }
    }
    tour.step(dt, doe.anim);
    if (visiting && tour.finished) {
      const l = life.current;
      l.gone = true;
      if (group.current) group.current.visible = false;
      l.release?.();
      l.release = null;
      hooks.current?.gone();
      return;
    }
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
    <group ref={group} name="deer">
      <primitive object={doe.mesh} />
      <mesh ref={body} geometry={plane} material={shadowMat.body} renderOrder={1} />
      <instancedMesh ref={feet} args={[plane, shadowMat.hoof, 4]} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
