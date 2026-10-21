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
//
// The party screen (PartyScene) also grades its trailer through this chain:
// with the static `trailerLook` prop, set from the screen's first frame and
// never toggled, the chain gains a channel mixer (a Sepia effect) straight
// after the tone mapping, and every lever the trailer moves is written each
// frame from the shared film look (lib/garden/look), behind equality guards:
// the exposure as a multiplier on what this file already writes, the bloom
// (mapped for lite), the vignette, saturation, contrast, grain, the chromatic
// aberration, the depth of field's range and bokeh, and the mixer. Only
// uniforms are written, never a constructor argument, a define or the effect
// list, so nothing recompiles mid-trailer, and while no trailer plays the look
// holds this file's own constants, so the screen draws as before. Without the
// prop (the personal garden, the lotus courtyard) the chain, its compile and
// its frame are exactly what they were.
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  Sepia,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import {
  BlendFunction,
  ToneMappingMode,
  type BloomEffect,
  type BrightnessContrastEffect,
  type ChromaticAberrationEffect,
  type DepthOfFieldEffect,
  type EffectComposer as EffectComposerImpl,
  type HueSaturationEffect,
  type NoiseEffect,
  type SepiaEffect,
  type VignetteEffect,
} from "postprocessing";
import { createRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import {
  filmLook,
  fullBloomThreshold,
  liteBloomIntensity,
  liteBloomThreshold,
  MIXER_IDENTITY,
} from "@/lib/garden/look";
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
const CA_AMOUNT = 0.0007;
const CA_OFFSET = new THREE.Vector2(CA_AMOUNT, CA_AMOUNT);
/** The depth of field's bokeh scale by tier: larger discs on the strongest GPUs. */
const BOKEH_SCALE = { balanced: 2.4, cinematic: 3.4 } as const;
/** The most the trailer's film look may lift the exposure by: a guard against a flash on a venue screen. */
const LOOK_EXPOSURE_MAX = 1.12;
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

/**
 * The effects the trailer's film look reaches each frame. Callback refs point
 * them at the live instances, so a tier rebuild (new effects) re-points them;
 * an effect the tier does not draw stays null.
 */
export interface LookTargets {
  bloom: BloomEffect | null;
  vignette: VignetteEffect | null;
  hue: HueSaturationEffect | null;
  contrast: BrightnessContrastEffect | null;
  noise: NoiseEffect | null;
  ca: ChromaticAberrationEffect | null;
  /** the channel mixer's three rows: the Sepia effect's weight uniforms */
  mixer: THREE.Vector3[] | null;
}

/** The Sepia effect's weight uniforms, one per output channel. */
const MIXER_WEIGHTS = ["weightsR", "weightsG", "weightsB"] as const;

/** A Sepia effect's weights, row by row (its typings leave out their getters), or null if one is missing. */
export function mixerRows(e: SepiaEffect): THREE.Vector3[] | null {
  const rows: THREE.Vector3[] = [];
  for (const name of MIXER_WEIGHTS) {
    const w = e.uniforms.get(name)?.value as THREE.Vector3 | undefined;
    if (!w) return null;
    rows.push(w);
  }
  return rows;
}

/** Writes the nine mixer weights (row-major) into the rows, each row only when it changed. */
export function setMixer(rows: THREE.Vector3[], m: readonly number[]) {
  for (let r = 0; r < rows.length; r++) {
    const w = rows[r];
    const i = r * 3;
    if (w.x !== m[i] || w.y !== m[i + 1] || w.z !== m[i + 2]) w.set(m[i], m[i + 1], m[i + 2]);
  }
}

/**
 * The film look's values onto the chain's effects (lib/garden/look), each
 * written only when it differs, and only as a uniform: the bloom's threshold
 * stays above 0, so its THRESHOLD define is never dropped, and the smoothing,
 * radius, levels, techniques and blend functions are never touched. Lite has
 * a gentler bloom of its own, so the look's full-tier values are mapped onto
 * it, floored so a phone still blooms only its true light sources.
 */
export function applyFilmLook(t: LookTargets, dof: DepthOfFieldEffect | null, lite: boolean, cinematic: boolean) {
  const look = filmLook;
  const bloom = t.bloom;
  if (bloom) {
    const intensity = lite ? liteBloomIntensity(look.bloomIntensity) : look.bloomIntensity;
    if (bloom.intensity !== intensity) bloom.intensity = intensity;
    const threshold = lite ? liteBloomThreshold(look.bloomThreshold) : fullBloomThreshold(look.bloomThreshold);
    const luminance = bloom.luminanceMaterial;
    if (luminance.threshold !== threshold) luminance.threshold = threshold;
  }
  const vignette = t.vignette;
  if (vignette) {
    if (vignette.darkness !== look.vignetteDarkness) vignette.darkness = look.vignetteDarkness;
    if (vignette.offset !== look.vignetteOffset) vignette.offset = look.vignetteOffset;
  }
  if (t.hue && t.hue.saturation !== look.saturation) t.hue.saturation = look.saturation;
  if (t.contrast && t.contrast.contrast !== look.contrast) t.contrast.contrast = look.contrast;
  const grain = t.noise?.blendMode.opacity;
  if (grain && grain.value !== look.grain) grain.value = look.grain;
  // in place on the effect's offset, which holds a copy of this chain's own vector (see Effects), never the shared one
  const ca = t.ca?.offset;
  const fringe = CA_AMOUNT * look.ca;
  if (ca && (ca.x !== fringe || ca.y !== fringe)) ca.set(fringe, fringe);
  if (t.mixer) setMixer(t.mixer, look.mixer);
  if (dof) {
    const coc = dof.cocMaterial;
    if (coc.focusRange !== look.dofRange) coc.focusRange = look.dofRange;
    const bokeh = BOKEH_SCALE[cinematic ? "cinematic" : "balanced"] * look.bokeh;
    if (dof.bokehScale !== bokeh) dof.bokehScale = bokeh;
  }
}

/**
 * `trailerLook`: the party screen's chain, graded by its trailer (see the
 * header). Static: set from the first render and never changed, since adding
 * or removing the mixer rebuilds and recompiles the composer.
 */
export function Effects({ trailerLook = false }: { trailerLook?: boolean }) {
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
  // The trailer's levers, reached through callback refs because a tier rebuild
  // re-creates the effects (the trailer's chain only; the garden's has none).
  const look = useRef<LookTargets>({ bloom: null, vignette: null, hue: null, contrast: null, noise: null, ca: null, mixer: null });
  const attachBloom = useCallback((e: BloomEffect | null) => {
    look.current.bloom = e;
  }, []);
  const attachVignette = useCallback((e: VignetteEffect | null) => {
    look.current.vignette = e;
  }, []);
  const attachHue = useCallback((e: HueSaturationEffect | null) => {
    look.current.hue = e;
  }, []);
  const attachContrast = useCallback((e: BrightnessContrastEffect | null) => {
    look.current.contrast = e;
  }, []);
  const attachNoise = useCallback((e: NoiseEffect | null) => {
    look.current.noise = e;
  }, []);
  const attachCa = useCallback((e: ChromaticAberrationEffect | null) => {
    look.current.ca = e;
  }, []);
  // A Sepia effect is built sepia-toned; the mixer starts as the identity the
  // moment it attaches, before the opening compiles and pre-draws the chain
  // (with the frame loop paused), and again whenever a rebuild makes a new one.
  const attachSepia = useCallback((e: SepiaEffect | null) => {
    const rows = e ? mixerRows(e) : null;
    look.current.mixer = rows;
    if (rows) setMixer(rows, MIXER_IDENTITY);
  }, []);
  // The trailer writes its fringe in place on the effect's offset, so its
  // chain hands the effect a vector of its own: nothing the trailer does can
  // reach the module's shared constant.
  const [caOffset] = useState(() => new THREE.Vector2(CA_AMOUNT, CA_AMOUNT));
  useExposure();

  // Ambient occlusion at half resolution is a good trade at a full pixel ratio;
  // under about 0.8 its buffer would fall to a quarter of the CSS size and
  // smear, so it runs at full resolution there. Chosen when the tier is built,
  // since switching it later recompiles the pass.
  const aoHalfRes = useMemo(() => budget.get().dpr >= 0.8 || quality === "lite", [quality]);

  useLayerFrame((state) => {
    // the renderer is three.js state, driven imperatively from the frame loop
    const exposure = quality === "lite" ? EXPOSURE + (LITE_NIGHT_EXPOSURE - EXPOSURE) * env.nightness : EXPOSURE;
    // The trailer's exposure is a multiplier on this one: written anywhere
    // else, it would be overwritten here the same frame. 1 when idle.
    state.gl.toneMappingExposure = trailerLook ? exposure * Math.min(LOOK_EXPOSURE_MAX, filmLook.exposure) : exposure;
    const d = dof.current;
    // The effect keeps a reference and reads it at render time, so assigning
    // the shared Vector3 once is enough; the guard keeps it cheap. The ref is
    // re-pointed by the reconciler whenever a quality change rebuilds the effect.
    const focus = env.focus ?? env.headPos;
    if (d && d.target !== focus) d.target = focus;
    if (d) {
      // The blur's buffer is sized from the drawing buffer, so a pixel ratio
      // under 1 would shrink it below DOF_SCALE of the CSS size and turn the
      // canopy to blocky mush; its scale grows to keep it there. Only a real
      // change resizes it.
      const want = Math.min(1, DOF_SCALE[quality === "cinematic" ? "cinematic" : "balanced"] / Math.min(1, state.gl.getPixelRatio()));
      if (Math.abs(d.resolution.scale - want) > 0.01) d.resolution.scale = want;
    }
    if (trailerLook) applyFilmLook(look.current, d, quality === "lite", quality === "cinematic");
  });

  if (quality === "lite") {
    // The canvas has MSAA off and the composer runs without multisampling, so
    // without an AA effect this tier would have no anti-aliasing at all.
    return (
      <EffectComposer ref={handle} enabled={live} multisampling={0}>
        <SMAA />
        <Bloom
          ref={trailerLook ? attachBloom : undefined}
          luminanceThreshold={LITE_BLOOM_THRESHOLD}
          luminanceSmoothing={0.3}
          intensity={0.65}
          mipmapBlur
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        {trailerLook ? <Sepia ref={attachSepia} /> : null}
        <Vignette ref={trailerLook ? attachVignette : undefined} offset={0.25} darkness={0.4} />
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
        bokehScale={BOKEH_SCALE[cinematic ? "cinematic" : "balanced"]}
        resolutionScale={DOF_SCALE[cinematic ? "cinematic" : "balanced"]}
      />
      <Bloom
        ref={trailerLook ? attachBloom : undefined}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.35}
        intensity={0.85}
        mipmapBlur
        radius={0.72}
        levels={7}
      />
      {cinematic ? (
        <ChromaticAberration
          ref={trailerLook ? attachCa : undefined}
          offset={trailerLook ? caOffset : CA_OFFSET}
          radialModulation
          modulationOffset={0.4}
        />
      ) : null}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {trailerLook ? <Sepia ref={attachSepia} /> : null}
      {/* barely any saturation lift: the greens are already rich, and more turns them to paint-box lime */}
      <HueSaturation ref={trailerLook ? attachHue : undefined} saturation={0.02} />
      <BrightnessContrast ref={trailerLook ? attachContrast : undefined} brightness={0.0} contrast={0.06} />
      <Vignette ref={trailerLook ? attachVignette : undefined} offset={0.25} darkness={0.4} />
      <Noise ref={trailerLook ? attachNoise : undefined} opacity={0.03} blendFunction={BlendFunction.SOFT_LIGHT} />
    </EffectComposer>
  );
}
