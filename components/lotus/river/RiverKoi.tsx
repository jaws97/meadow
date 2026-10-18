"use client";
/* eslint-disable react-hooks/immutability --
   The koi's skinned geometry and their materials' uniforms are three.js objects written in the frame loop, which is
   how an R3F part animates without re-rendering; the React Compiler lint reads those writes as mutating a hook's
   value. Nothing they write feeds back into what React renders. */
// The lazy river's twelve ambient koi (koiLanes.ts): the pond's own fish (koi.ts: body, fins, paint and swimming, their
// look unchanged) grown to a garden canal's size, each cruising its lap of the ring.
//
// The river's water is opaque (one mesh, no extra pass: water.ts), so the fish cannot lie under it. They are drawn as
// the write-up planned, just under the surface in look but not in fact: each fish's skinned mesh is flattened to a
// tenth of its height and laid a centimetre over the water plane, then blended over the water already drawn as light
// through water would be: its colour fades by the water's absorption over the path down to the fish's depth and back
// up to the eye (red first, so a kohaku's red goes rusty and a deep fish goes green), its weight falls with that and
// with the surface's Fresnel reflection (so the far reach and a low camera show mostly sky and ripples over them), and
// its outline wavers a little with the ripples. The stones, sills, piers and bridges still hide them as solid things.
// Everything follows the garden clock: in still mode they hold their places.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { meadow } from "@/components/meadow/runtime";
import type { Tier } from "@/components/lotus/geometry";
import { koiCurve, makeKoiBody, makeKoiFins, poseKoi, KOI_STILL_TIME, type KoiTier } from "@/components/lotus/koi";
import { koiFinTexture, koiTexture } from "@/components/lotus/textures";
import { LEVEL } from "@/components/lotus/river/plan";
import { koiDepth, RIVER_KOI, riverKoiSpec } from "@/components/lotus/river/koiLanes";

export const RIVER_KOI_NAME = "river-koi";
/** The fish are flattened to this share of their height and laid this far over the water plane (metres). */
const FLATTEN = 0.1;
const LIFT = 0.011;
/** The canal's absorption per metre (red first, then blue: a green-teal water, murkier than the pond's 1.4/0.65/0.55). */
const SIGMA = new THREE.Vector3(1.7, 0.78, 0.95);

const shared = {
  uKoiTime: { value: 0 },
  uKoiSigma: { value: SIGMA },
  uKoiDay: { value: 1 },
};

const VERT_COMMON = "#include <common>\nvarying vec3 vKoiW;\nuniform float uKoiTime;";
// the ripples' sway, a centimetre or so in the world (the group only lifts and flattens, so local xz is world xz)
const VERT_BEGIN =
  "#include <begin_vertex>\n" +
  "transformed.x += sin(uKoiTime * 1.3 + transformed.z * 3.7 + transformed.x * 1.9) * 0.008;\n" +
  "transformed.z += cos(uKoiTime * 1.1 + transformed.x * 3.1 - transformed.z * 1.3) * 0.008;";
const VERT_WORLD = "#include <worldpos_vertex>\nvKoiW = (modelMatrix * vec4(transformed, 1.0)).xyz;";
const FRAG_COMMON = "#include <common>\nvarying vec3 vKoiW;\nuniform vec3 uKoiSigma;\nuniform float uKoiDepth;\nuniform float uKoiDay;";
// seen through the surface, a fish is lit by light the water has already spread: its shading is soft and from
// above (the flattened mesh's own normals would light its outline from the side)
const FRAG_NORMAL = "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.75));";
const FRAG_OUT = /* glsl */ `{
  vec3 kV = normalize(cameraPosition - vKoiW);
  float kCos = clamp(kV.y, 0.0, 1.0);
  // down to the fish and back up to the eye, the depth seen about three quarters as deep (Snell, water's 1.33)
  float kPath = uKoiDepth / 0.75 * (1.0 + 1.0 / max(kCos, 0.18));
  vec3 kT = exp(-uKoiSigma * kPath);
  float kMean = (kT.r + kT.g + kT.b) / 3.0;
  // the surface's reflection (Schlick, base 0.02, boosted as the river's own is) covers the fish as it covers the water
  float kF = clamp((0.02 + 0.98 * pow(1.0 - kCos, 5.0)) * 1.9, 0.0, 0.6);
  outgoingLight *= kT / max(kMean, 1e-3);
  diffuseColor.a *= clamp(kMean * 1.25, 0.0, 0.9) * (1.0 - kF) * uKoiDay;
}
#include <opaque_fragment>`;

function riverKoiMaterial(map: THREE.Texture, fin: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: fin ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: 0,
  });
  const depth = { value: 0.15 };
  m.userData.depth = depth;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uKoiDepth: depth });
    shader.vertexShader = shader.vertexShader.replace("#include <common>", VERT_COMMON).replace("#include <begin_vertex>", VERT_BEGIN).replace("#include <worldpos_vertex>", VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", FRAG_COMMON).replace("#include <normal_fragment_maps>", FRAG_NORMAL).replace("#include <opaque_fragment>", FRAG_OUT);
  };
  m.customProgramCacheKey = () => "lotus-river-koi-2" + (fin ? "-fin" : "");
  return m;
}

export function RiverKoi({ tier }: { tier: Tier }) {
  const koiTier: KoiTier = tier === "lite" ? "lite" : "balanced";
  const fish = useMemo(
    () =>
      RIVER_KOI.map((def) => {
        const spec = riverKoiSpec(def);
        const curve = koiCurve(spec);
        curve.arcLengthDivisions = 3000;
        curve.updateArcLengths();
        const total = curve.getLength();
        const body = makeKoiBody(koiTier);
        const fins = makeKoiFins(koiTier);
        const bodyMat = riverKoiMaterial(koiTexture(def.variety, spec.seed), false);
        const finMat = riverKoiMaterial(koiFinTexture(def.variety), true);
        // posed once now, so the first frame (and the compile) sees them where they swim
        poseKoi(spec, curve, total, body, fins, KOI_STILL_TIME);
        return { def, spec, curve, total, body, fins, bodyMat, finMat };
      }),
    [koiTier],
  );
  useEffect(
    () => () => {
      for (const f of fish) {
        f.body.geometry.dispose();
        f.fins.geometry.dispose();
        f.bodyMat.dispose();
        f.finMat.dispose();
      }
    },
    [fish],
  );

  const last = useRef(Number.NaN);
  const head = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = env.time;
    shared.uKoiTime.value = t;
    shared.uKoiDay.value = 1 - 0.75 * meadow.night;
    if (t === last.current) return;
    last.current = t;
    for (const f of fish) {
      poseKoi(f.spec, f.curve, f.total, f.body, f.fins, t);
      // the depth where the snout is now
      const arc = (((f.spec.stillArc + f.spec.speed * (t - KOI_STILL_TIME)) % f.total) + f.total) % f.total;
      f.curve.getPointAt(arc / f.total, head);
      const d = koiDepth(f.def, Math.atan2(head.z, head.x));
      (f.bodyMat.userData.depth as { value: number }).value = d;
      (f.finMat.userData.depth as { value: number }).value = d;
    }
  });

  return (
    <group name={RIVER_KOI_NAME} position-y={LEVEL.water + LIFT} scale={[1, FLATTEN, 1]}>
      {fish.map((f, i) => (
        <group key={i} name={`river-koi-${f.def.variety}`}>
          <mesh geometry={f.body.geometry} material={f.bodyMat} receiveShadow renderOrder={5} frustumCulled={false} />
          <mesh geometry={f.fins.geometry} material={f.finMat} receiveShadow renderOrder={6} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}
