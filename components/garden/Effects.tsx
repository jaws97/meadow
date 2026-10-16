"use client";
// Post-processing stack, scaled by the quality setting.
//
// Order matters twice over. The ambient-occlusion pass is a raw pass that
// darkens the beauty buffer from its own depth read, so it runs first, straight
// after the scene render. The composer then merges the effects that follow into
// as few full-screen passes as it can, and the anti-aliasing effects (SMAA,
// FXAA) resample the pass input directly on edge pixels, so they lead that
// chain: anything placed before them is skipped along every edge. The grade,
// the vignette and the grain come after the tone mapping so they shape display
// values rather than the open HDR range.
//
// Depth of field follows the flower head through the shared env so the bloom
// stays sharp as it grows, while the bed in front stays readable and the far
// trees melt into bokeh. SMAA loads its lookup images asynchronously but never
// suspends; the first few frames simply render without it. Every tier gets
// SMAA: on a phone the petals and leaf edges are the picture, and FXAA's blur
// softens them as much as it smooths them.
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from "postprocessing";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { useGarden } from "@/lib/garden/store";

/**
 * The ACES curve sits the mid-tones a touch dark at unit exposure; lifted
 * slightly. Exported so self-lit parts (the hero's petals) can hold their
 * brightness against the lite tier's night lift below.
 */
export const BASE_EXPOSURE = 1.12;
const EXPOSURE = BASE_EXPOSURE;
/**
 * A phone screen is small and viewed in a lit room, so lite opens its
 * exposure a little as night falls. Only a little: most of its night lift
 * comes from the sky bounce and fill in Lights.tsx, because a global lift
 * also multiplies every emissive and pushes the petals through the bloom.
 */
const LITE_NIGHT_EXPOSURE = 1.25;
/**
 * Lite's bloom threshold: above the brightest lit petal, so only the true
 * light sources (the candle, the halo, the fireflies) bloom on a phone.
 */
const LITE_BLOOM_THRESHOLD = 1.0;
/** World metres either side of the flower head that stay sharp. */
const FOCUS_RANGE = LAYOUT.camera.focusRange;
/** A hair of lens colour fringing, strongest toward the corners. */
const CA_OFFSET = new THREE.Vector2(0.0007, 0.0007);
/** Occlusion tinted toward the sky bounce rather than dead black. */
const AO_COLOR = new THREE.Color("#0b1020");
/** Contact occlusion reach in metres: the gap under a leaf, the crease of a petal. */
const AO_RADIUS = 0.25;

/** Three reads the exposure from the renderer for every program, the tone-mapping pass included. */
function useExposure() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const previous = gl.toneMappingExposure;
    // eslint-disable-next-line react-hooks/immutability -- the renderer is a three.js object, configured imperatively
    gl.toneMappingExposure = EXPOSURE;
    return () => {
      gl.toneMappingExposure = previous;
    };
  }, [gl]);
}

export function Effects() {
  const quality = useGarden((s) => s.quality);
  const dof = useRef<DepthOfFieldEffect>(null);
  useExposure();

  useFrame((state) => {
    // the renderer is three.js state, driven imperatively from the frame loop
    state.gl.toneMappingExposure =
      quality === "lite" ? EXPOSURE + (LITE_NIGHT_EXPOSURE - EXPOSURE) * env.nightness : EXPOSURE;
    const d = dof.current;
    // The effect keeps a reference and reads it at render time, so assigning
    // the shared Vector3 once is enough; the guard keeps it cheap. The ref is
    // re-pointed by the reconciler whenever a quality change rebuilds the effect.
    if (d && d.target !== env.headPos) d.target = env.headPos;
  });

  if (quality === "lite") {
    // The canvas has MSAA off and the composer runs without multisampling, so
    // without an AA effect this tier would have no anti-aliasing at all.
    return (
      <EffectComposer multisampling={0}>
        <SMAA />
        <Bloom luminanceThreshold={LITE_BLOOM_THRESHOLD} luminanceSmoothing={0.3} intensity={0.65} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.25} darkness={0.4} />
      </EffectComposer>
    );
  }

  const cinematic = quality === "cinematic";
  return (
    <EffectComposer multisampling={0}>
      <N8AO
        halfRes
        aoRadius={AO_RADIUS}
        distanceFalloff={1}
        intensity={cinematic ? 2.4 : 2}
        quality={cinematic ? "low" : "performance"}
        color={AO_COLOR}
        depthAwareUpsampling
      />
      <SMAA />
      <DepthOfField
        ref={dof}
        focusRange={FOCUS_RANGE}
        bokehScale={cinematic ? 3.4 : 2.4}
        resolutionScale={cinematic ? 0.55 : 0.4}
      />
      <Bloom
        luminanceThreshold={0.85}
        luminanceSmoothing={0.35}
        intensity={0.85}
        mipmapBlur
        radius={0.72}
        levels={7}
      />
      {cinematic ? <ChromaticAberration offset={CA_OFFSET} radialModulation modulationOffset={0.4} /> : null}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* barely any saturation lift: the greens are already rich, and more turns them to paint-box lime */}
      <HueSaturation saturation={0.02} />
      <BrightnessContrast brightness={0.0} contrast={0.06} />
      <Vignette offset={0.25} darkness={0.4} />
      <Noise opacity={0.03} blendFunction={BlendFunction.SOFT_LIGHT} />
    </EffectComposer>
  );
}
