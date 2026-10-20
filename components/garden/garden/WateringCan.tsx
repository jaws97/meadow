"use client";
/* eslint-disable react-hooks/immutability --
   The can's pivot group and its contact shadow are three.js objects moved in the frame loop from the moment's record
   (canLive), which is how an R3F part animates without re-rendering. */
// The owner's watering can, standing on the close-mown lawn at the bed's front right with its spout toward the hero:
// one story prop that says the garden is tended, and the can that does the tending. It stands just past the right edge
// of a phone's portrait frame while the plant is growing (in it for the seed's bed shot and the grown plant), and in
// the landscape frame it balances the lantern on the left. One mesh, one draw; it casts a shadow on the richer tiers
// and takes the golden-hour rim.
//
// When this page's own Water press reaches a soil flower, this is the can that waters it (canMoment, canLive): it
// hangs from a pivot at its handle's top, where a hand would hold it, so the moment's pose lifts it, carries it with a
// full can's lag, tips it to pour and sets it down about that point. While it is off the lawn on the lightest tier
// (no sun shadow) or by night, a soft dark patch on the ground under it keeps it from floating.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WATERING_CAN, bedRho, bedSurfaceY, makeWateringCan } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { quality as qualityStore, underVeil } from "@/lib/garden/quality";
import type { Quality } from "@/lib/garden/store";
import { smoothstep } from "@/lib/plant/prng";
import { gardenMaterials } from "@/components/garden/garden/materials";
import { canLive } from "@/components/garden/garden/canLive";
import { CAN_BODY, CAN_HAND, REST_HAND, REST_YAW, canPoint } from "@/components/garden/garden/canMoment";
import { useLayerFrame } from "@/components/garden/TierLayers";

/** A soft round shadow, dark at its heart and gone at its rim, drawn once. */
let shadowTex: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
  if (!shadowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "rgba(0,0,0,0.85)");
      r.addColorStop(0.45, "rgba(0,0,0,0.45)");
      r.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }
    shadowTex = new THREE.CanvasTexture(c);
  }
  return shadowTex;
}

const body = { x: 0, y: 0, z: 0 };

/** Frames the contact shadow is drawn (unseen) after the garden shows, so its first real draw costs nothing. */
const WARM_FRAMES = 90;

export function WateringCan({ quality }: { quality: Quality }) {
  const mats = gardenMaterials();
  const lite = quality === "lite";
  const geo = useMemo(() => makeWateringCan(lite ? 16 : 28), [lite]);
  useEffect(() => () => geo.dispose(), [geo]);
  const blob = useMemo(
    () => ({
      geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      mat: new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      blob.geo.dispose();
      blob.mat.dispose();
    },
    [blob],
  );

  const hand = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const shown = useRef(0);
  useLayerFrame(() => {
    const p = canLive.pose;
    const g = hand.current;
    if (g) {
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(p.roll, p.yaw, -p.tilt, "YXZ");
    }
    const sh = shadow.current;
    if (!sh) return;
    // grounded by the sun's own shadow on the richer tiers by day; otherwise by a soft dark patch under it
    const show = p.lift > 0.004 && (lite || env.sky.sunIntensity <= 0.01);
    if (!underVeil(qualityStore.get())) shown.current++;
    sh.visible = show || (shown.current > 0 && shown.current < WARM_FRAMES);
    if (!show) {
      blob.mat.opacity = 0;
      return;
    }
    canPoint(p, CAN_BODY.x, 0, body);
    const ground = bedRho(body.x, body.z) < 1 ? Math.max(0, bedSurfaceY(body.x, body.z)) : 0;
    const h = Math.max(0, body.y - ground);
    sh.position.set(body.x, ground + 0.003, body.z);
    const size = 0.2 + 0.5 * h;
    sh.scale.set(size, 1, size);
    blob.mat.opacity = 0.5 * smoothstep(0.004, 0.03, p.lift) * (1 - smoothstep(0.08, 0.7, h)) * (1 - 0.45 * env.nightness);
  });

  return (
    <>
      <group ref={hand} name="watering-can-hand" position={[REST_HAND.x, REST_HAND.y, REST_HAND.z]} rotation={[0, REST_YAW, 0, "YXZ"]}>
        <mesh
          name="watering-can"
          geometry={geo}
          material={mats.can}
          position={[-CAN_HAND.x, -CAN_HAND.y, 0]}
          scale={WATERING_CAN.scale}
          castShadow={!lite}
          receiveShadow
        />
      </group>
      <mesh ref={shadow} geometry={blob.geo} material={blob.mat} renderOrder={1} visible={false} />
    </>
  );
}
