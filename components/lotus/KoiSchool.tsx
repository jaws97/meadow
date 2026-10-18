"use client";
// The pond's three young koi (koi.ts): each swims its own slow loop through the pond, under and between the floating
// leaves, fading with depth (their materials sit under the water: materials.ts withUnderwater), now and then nosing
// up under the surface and leaving a soft ring on the water. Everything follows the garden clock, so in still mode
// (the clock held at 37 s) they hold their places and their rings. In the pond frame (KoiPond.tsx places the group).
import { useLayerFrame } from "@/components/garden/TierLayers";
import { useEffect, useMemo } from "react";
import { env } from "@/lib/garden/env";
import type { Tier } from "@/components/lotus/geometry";
import { KOI, koiCurve, koiRingAge, koiSurfaceArc, makeKoiBody, makeKoiFins, poseKoi, KOI_STILL_TIME } from "@/components/lotus/koi";
import { koiBodyMaterial, koiFinMaterial, POND_RINGS, pondWaterUniforms } from "@/components/lotus/materials";

export const KOI_NAME = "koi";

export function Koi({ tier }: { tier: Tier }) {
  const fish = useMemo(
    () =>
      KOI.map((spec) => {
        const curve = koiCurve(spec);
        const total = curve.getLength();
        const body = makeKoiBody(tier);
        const fins = makeKoiFins(tier);
        const surfaceArc = koiSurfaceArc(spec, curve, total);
        const ringAt = curve.points[spec.surfaceAt];
        // posed once now, so the first frame (and the opening's compile) sees them where they swim
        poseKoi(spec, curve, total, body, fins, KOI_STILL_TIME);
        return { spec, curve, total, body, fins, surfaceArc, ringAt };
      }),
    [tier],
  );
  useEffect(
    () => () => {
      for (const f of fish) {
        f.body.geometry.dispose();
        f.fins.geometry.dispose();
      }
      for (let i = 0; i < POND_RINGS; i++) pondWaterUniforms.uRings.value[i].w = 0;
    },
    [fish],
  );

  useLayerFrame(() => {
    const t = env.time;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      poseKoi(f.spec, f.curve, f.total, f.body, f.fins, t);
      if (i < POND_RINGS) {
        const age = koiRingAge(f.spec, f.total, f.surfaceArc, t);
        pondWaterUniforms.uRings.value[i].set(f.ringAt.x, f.ringAt.z, age, 1);
      }
    }
  });

  return (
    <group name={KOI_NAME}>
      {fish.map((f, i) => (
        <group key={i} name={`koi-${f.spec.variety}`}>
          <mesh geometry={f.body.geometry} material={koiBodyMaterial(f.spec.variety, f.spec.seed, tier)} castShadow receiveShadow frustumCulled={false} />
          <mesh geometry={f.fins.geometry} material={koiFinMaterial(f.spec.variety)} renderOrder={1} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}
