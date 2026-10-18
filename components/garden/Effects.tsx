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
// trees melt into a soft blur (see softenFarBokeh). SMAA loads its lookup images asynchronously but never
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
import { useThree } from "@react-three/fiber";
import {
  BlendFunction,
  ToneMappingMode,
  type DepthOfFieldEffect,
  type EffectComposer as EffectComposerImpl,
} from "postprocessing";
import { createRef, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { useLayerFrame, useLayerLive, useTier } from "@/components/garden/TierLayers";
import { quality as budget } from "@/lib/garden/quality";

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
/** The depth-of-field blur's buffer as a share of the CSS size (see the frame loop). */
const DOF_SCALE = { balanced: 0.4, cinematic: 0.55 } as const;

/**
 * The live post-processing chain, for the opening (RenderBudget), which
 * compiles the scene into the composer's input buffer and waits for its
 * passes before the first frame.
 */
export const composerHandle = createRef<EffectComposerImpl>();
/**
 * The post chain of a tier being prepared out of sight (TierLayers): built,
 * never drawn, so TierPreparer (RenderBudget) can compile its passes before
 * the swap. At the swap it goes live and takes composerHandle.
 */
export const preparedComposer = createRef<EffectComposerImpl>();

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

/**
 * The far field's second bokeh pass is a highlight fill: a max filter that
 * grows every bright texel into a hard-edged disc. Behind the bloom that is
 * the sky seen through the tree crowns, and every gap between leaf cards
 * became its own bright ring, so each crown against the sky read as soap
 * lace. Run as a second averaging pass instead (the material carries both
 * kernels), the far garden melts into a soft, creamy blur; the near field
 * keeps its fill, where a leaf brushing the lens should bloom into a disc.
 */
function softenFarBokeh(effect: DepthOfFieldEffect) {
  const fill = (effect as unknown as { bokehFarFillPass?: { fullscreenMaterial?: THREE.ShaderMaterial } }).bokehFarFillPass;
  const m = fill?.fullscreenMaterial;
  if (!m || m.defines?.PASS !== "2") return;
  m.defines.PASS = "1";
  m.needsUpdate = true;
}

export function Effects() {
  const quality = useTier();
  // a tier prepared out of sight builds its chain but never draws it
  const live = useLayerLive();
  const handle = live ? composerHandle : preparedComposer;
  const dof = useRef<DepthOfFieldEffect>(null);
  // A callback ref: the effect is built only once the composer exists, and the
  // far fill must be changed before the opening compiles the post chain.
  const attachDof = useCallback((effect: DepthOfFieldEffect | null) => {
    dof.current = effect;
    if (effect) softenFarBokeh(effect);
  }, []);
  useExposure();

  // Ambient occlusion at half resolution is a good trade at a full pixel ratio;
  // under about 0.8 its buffer would fall to a quarter of the CSS size and
  // smear, so it runs at full resolution there. Chosen when the tier is built,
  // since switching it later recompiles the pass.
  const aoHalfRes = useMemo(() => budget.get().dpr >= 0.8 || quality === "lite", [quality]);

  useLayerFrame((state) => {
    // the renderer is three.js state, driven imperatively from the frame loop
    state.gl.toneMappingExposure =
      quality === "lite" ? EXPOSURE + (LITE_NIGHT_EXPOSURE - EXPOSURE) * env.nightness : EXPOSURE;
    const d = dof.current;
    // The effect keeps a reference and reads it at render time, so assigning
    // the shared Vector3 once is enough; the guard keeps it cheap. The ref is
    // re-pointed by the reconciler whenever a quality change rebuilds the effect.
    if (d && d.target !== env.headPos) d.target = env.headPos;
    if (d) {
      // The blur's buffer is sized from the drawing buffer, so a pixel ratio
      // under 1 would shrink it below DOF_SCALE of the CSS size and turn the
      // canopy to blocky mush; its scale grows to keep it there. Only a real
      // change resizes it.
      const want = Math.min(1, DOF_SCALE[quality === "cinematic" ? "cinematic" : "balanced"] / Math.min(1, state.gl.getPixelRatio()));
      if (Math.abs(d.resolution.scale - want) > 0.01) d.resolution.scale = want;
    }
  });

  if (quality === "lite") {
    // The canvas has MSAA off and the composer runs without multisampling, so
    // without an AA effect this tier would have no anti-aliasing at all.
    return (
      <EffectComposer ref={handle} enabled={live} multisampling={0}>
        <SMAA />
        <Bloom luminanceThreshold={LITE_BLOOM_THRESHOLD} luminanceSmoothing={0.3} intensity={0.65} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.25} darkness={0.4} />
      </EffectComposer>
    );
  }

  const cinematic = quality === "cinematic";
  return (
    <EffectComposer ref={handle} enabled={live} multisampling={0}>
      <N8AO
        halfRes={aoHalfRes}
        aoRadius={AO_RADIUS}
        distanceFalloff={1}
        intensity={cinematic ? 2.4 : 2}
        quality={cinematic ? "low" : "performance"}
        color={AO_COLOR}
        depthAwareUpsampling
      />
      <SMAA />
      <DepthOfField
        ref={attachDof}
        focusRange={FOCUS_RANGE}
        bokehScale={cinematic ? 3.4 : 2.4}
        resolutionScale={DOF_SCALE[cinematic ? "cinematic" : "balanced"]}
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
