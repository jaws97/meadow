"use client";
/* eslint-disable react-hooks/immutability --
   The fish's skinned geometry, their places along their paths and the water's ring uniforms are three.js objects and
   plain records written in the frame loop, which is how an R3F part animates without re-rendering. */
// The product's three koi: the concepts page's fish (koi.ts: the same bodies, fins, colours and slow loops), swimming
// as the pond model and the owner's care ask (koiMoves.ts): up to the pellets after a pinch, round the pot when hungry,
// at the surface on a green dawn. Each keeps its own place along its path (its loop changes shape under it, so the
// place is carried forward rather than read off the clock) and now and then noses up and leaves a soft ring on the
// water: once in a long while when content, every second or two while taking pellets or gulping. In the pond frame
// (KoiPond.tsx places it); rings 0-2 of the water's are theirs.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { garden } from "@/lib/garden/store";
import { useLayerFrame } from "@/components/garden/TierLayers";
import type { Tier } from "@/components/lotus/geometry";
import { KOI, koiSnout, makeKoiBody, makeKoiFins, poseKoiAt, KOI_STILL_TIME } from "@/components/lotus/koi";
import { koiBodyMaterial, koiFinMaterial, pondWaterUniforms } from "@/components/lotus/materials";
import { koiMood, koiPace, morphPaths, ringGap, type KoiMood } from "@/components/lotus/product/koiMoves";

export const LIVE_KOI_NAME = "koi";

/** Seconds the school takes to settle into a new mood (the pinch's own crowd has its curve; this smooths the rest). */
const MOOD_EASE_S = 1.5;

const snout = new THREE.Vector3();

export function LiveKoi({ tier }: { tier: Tier }) {
  const fish = useMemo(() => {
    const paths = morphPaths();
    return KOI.map((spec, k) => {
      const path = paths[k];
      const total = path.getLength();
      const body = makeKoiBody(tier);
      const fins = makeKoiFins(tier);
      // where the page's still frame has it, so the first frame (and the opening's compile) sees it swimming there
      const u = (((spec.stillArc / total) % 1) + 1) % 1;
      poseKoiAt(spec, path, total, body, fins, u * total, KOI_STILL_TIME);
      return { spec, path, total, body, fins, u, ring: { x: 0, z: 0, at: -100 }, nextRing: 4 + k * 5.5 };
    });
  }, [tier]);
  const mood = useMemo<KoiMood>(() => ({ gather: 0, circle: 0, gasp: 0 }), []);
  useEffect(
    () => () => {
      for (const f of fish) {
        f.body.geometry.dispose();
        f.fins.geometry.dispose();
      }
      for (let i = 0; i < 3; i++) pondWaterUniforms.uRings.value[i].w = 0;
    },
    [fish],
  );

  useLayerFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = env.time;
    const p = garden.get().pond;
    const want = p ? koiMood(p, Date.now()) : null;
    const k = 1 - Math.exp(-dt / MOOD_EASE_S);
    mood.gather += ((want?.gather ?? 0) - mood.gather) * (want && want.gather > mood.gather ? Math.min(1, k * 2.5) : k);
    mood.circle += ((want?.circle ?? 0) - mood.circle) * k;
    mood.gasp += ((want?.gasp ?? 0) - mood.gasp) * k;
    const pace = koiPace(mood);
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      if (f.path.setMood(mood)) f.total = f.path.getLength();
      f.u = (f.u + (f.spec.speed * pace * dt) / f.total) % 1;
      poseKoiAt(f.spec, f.path, f.total, f.body, f.fins, f.u * f.total, t);
      // a ring where its snout comes up, then the next after the mood's gap (a little uneven, as fish are)
      if (t >= f.nextRing) {
        koiSnout(snout);
        f.ring.x = snout.x;
        f.ring.z = snout.z;
        f.ring.at = t;
        f.nextRing = t + ringGap(mood) * (0.7 + 0.6 * (0.5 + 0.5 * Math.sin(t * 12.9898 + i * 78.233)));
      }
      pondWaterUniforms.uRings.value[i].set(f.ring.x, f.ring.z, t - f.ring.at, 1);
    }
  });

  return (
    <group name={LIVE_KOI_NAME}>
      {fish.map((f, i) => (
        <group key={i} name={`koi-${f.spec.variety}`}>
          <mesh geometry={f.body.geometry} material={koiBodyMaterial(f.spec.variety, f.spec.seed, tier)} castShadow receiveShadow frustumCulled={false} />
          <mesh geometry={f.fins.geometry} material={koiFinMaterial(f.spec.variety)} renderOrder={1} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}
