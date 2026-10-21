// The party screen's post chain under its trailer's film look (Effects.tsx, `trailerLook`). The chain is built here
// as the effects' JSX builds it (r3f constructs each effect bare and then sets its props), so the tests can show
// that the idle look writes nothing at all, that a playing look lands on every lever (mapped for lite) without
// touching a define, and that once the look is reset the chain is back on its own constants exactly, as a stop or
// the end of the trailer needs.
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  HueSaturationEffect,
  NoiseEffect,
  SepiaEffect,
  VignetteEffect,
} from "postprocessing";
import { applyFilmLook, mixerRows, setMixer, type LookTargets } from "@/components/garden/Effects";
import { applyLook, filmLook, liteBloomIntensity, liteBloomThreshold, LOOK_IDLE, MIXER_IDENTITY, type LookValues } from "@/lib/garden/look";
import { LAYOUT } from "@/lib/garden/layout";

type Tier = "lite" | "balanced" | "cinematic";

/** The chain's effects for a tier, with the values Effects.tsx's JSX gives them (the look's idle values). */
function chain(tier: Tier) {
  const lite = tier === "lite";
  const bloom = new BloomEffect({
    luminanceThreshold: lite ? liteBloomThreshold(LOOK_IDLE.bloomThreshold) : LOOK_IDLE.bloomThreshold,
    luminanceSmoothing: lite ? 0.3 : 0.35,
    mipmapBlur: true,
    ...(lite ? {} : { radius: 0.72, levels: 7 }),
  });
  bloom.intensity = lite ? liteBloomIntensity(LOOK_IDLE.bloomIntensity) : LOOK_IDLE.bloomIntensity;
  const vignette = new VignetteEffect();
  vignette.offset = LOOK_IDLE.vignetteOffset;
  vignette.darkness = LOOK_IDLE.vignetteDarkness;
  const sepia = new SepiaEffect();
  const mixer = mixerRows(sepia);
  if (mixer) setMixer(mixer, MIXER_IDENTITY);
  const t: LookTargets = { bloom, vignette, hue: null, contrast: null, noise: null, ca: null, mixer };
  let dof: DepthOfFieldEffect | null = null;
  if (!lite) {
    t.hue = new HueSaturationEffect();
    t.hue.saturation = LOOK_IDLE.saturation;
    t.contrast = new BrightnessContrastEffect();
    t.contrast.contrast = LOOK_IDLE.contrast;
    t.noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT });
    t.noise.blendMode.opacity.value = LOOK_IDLE.grain;
    dof = new DepthOfFieldEffect(new THREE.PerspectiveCamera());
    dof.cocMaterial.focusRange = LAYOUT.camera.focusRange;
    dof.bokehScale = tier === "cinematic" ? 3.4 : 2.4;
    if (tier === "cinematic") {
      t.ca = new ChromaticAberrationEffect({ radialModulation: true, modulationOffset: 0.4 });
      t.ca.offset.copy(new THREE.Vector2(0.0007, 0.0007));
    }
  }
  return { t, dof, sepia };
}

/** Every uniform the look reaches, and the defines it must never change, as plain values. */
function read(t: LookTargets, dof: DepthOfFieldEffect | null) {
  return {
    bloomIntensity: t.bloom?.intensity,
    bloomThreshold: t.bloom?.luminanceMaterial.threshold,
    bloomSmoothing: t.bloom?.luminanceMaterial.smoothing,
    thresholdDefine: t.bloom?.luminanceMaterial.defines.THRESHOLD,
    vignetteDarkness: t.vignette?.darkness,
    vignetteOffset: t.vignette?.offset,
    saturation: t.hue?.saturation,
    contrast: t.contrast?.contrast,
    grain: t.noise?.blendMode.opacity.value,
    ca: t.ca ? [t.ca.offset.x, t.ca.offset.y] : null,
    focusRange: dof?.cocMaterial.focusRange,
    bokeh: dof?.bokehScale,
    mixer: t.mixer?.flatMap((w) => w.toArray()),
  };
}

/** A look from deep in the trailer: the payoff's light and the golden grade, with the coda's narrow focus. */
const PLAYING: LookValues = {
  exposure: 1.1,
  bloomIntensity: 1.3,
  bloomThreshold: 0.74,
  vignetteDarkness: 0.6,
  vignetteOffset: 0.18,
  saturation: -0.08,
  contrast: 0.12,
  grain: 0.055,
  ca: 2,
  dofRange: 0.18,
  bokeh: 1.4,
  mixer: [1.07, 0, 0, 0, 1.01, 0, 0, 0, 0.88],
};

const TIERS: Tier[] = ["lite", "balanced", "cinematic"];

afterEach(() => filmLook.reset());

describe("the trailer's film look on the post chain", () => {
  test("the garden's own grade, bloom, vignette and grain are the ones it has always drawn with", () => {
    expect({ ...LOOK_IDLE, dofRange: undefined, mixer: undefined }).toEqual({
      exposure: 1,
      bloomIntensity: 0.85,
      bloomThreshold: 0.85,
      vignetteDarkness: 0.4,
      vignetteOffset: 0.25,
      saturation: 0.02,
      contrast: 0.06,
      grain: 0.03,
      ca: 1,
      dofRange: undefined,
      bokeh: 1,
      mixer: undefined,
    });
    expect(LOOK_IDLE.dofRange).toBe(LAYOUT.camera.focusRange);
    // a phone's gentler bloom, exactly
    expect(liteBloomIntensity(LOOK_IDLE.bloomIntensity)).toBe(0.65);
    expect(liteBloomThreshold(LOOK_IDLE.bloomThreshold)).toBe(1);
  });

  test("the idle look is the chain's own constants on every tier: nothing changes", () => {
    for (const tier of TIERS) {
      const { t, dof } = chain(tier);
      const before = read(t, dof);
      applyFilmLook(t, dof, tier === "lite", tier === "cinematic");
      expect(read(t, dof), tier).toEqual(before);
    }
  });

  test("the mixer starts as the identity, though a Sepia effect is built sepia-toned", () => {
    const sepia = new SepiaEffect();
    const rows = mixerRows(sepia);
    expect(rows).not.toBeNull();
    expect(rows!.flatMap((w) => w.toArray())).not.toEqual([...MIXER_IDENTITY]);
    setMixer(rows!, MIXER_IDENTITY);
    expect(rows!.flatMap((w) => w.toArray())).toEqual([...MIXER_IDENTITY]);
  });

  test("a playing look lands on every lever the tier has, and never drops the bloom's threshold define", () => {
    applyLook(PLAYING);
    for (const tier of TIERS) {
      const { t, dof } = chain(tier);
      const smoothing = t.bloom?.luminanceMaterial.smoothing;
      applyFilmLook(t, dof, tier === "lite", tier === "cinematic");
      const now = read(t, dof);
      expect(now.mixer, tier).toEqual(PLAYING.mixer);
      expect(now.vignetteDarkness).toBe(0.6);
      expect(now.vignetteOffset).toBe(0.18);
      expect(now.thresholdDefine).toBe("1");
      expect(now.bloomSmoothing).toBe(smoothing);
      if (tier === "lite") {
        // a phone keeps its gentler bloom: scaled by its own 0.65, and its threshold floored at 0.95
        expect(now.bloomIntensity).toBeCloseTo((0.65 * 1.3) / 0.85, 12);
        expect(now.bloomThreshold).toBe(0.95);
        expect(now.saturation).toBeUndefined();
        continue;
      }
      expect(now.bloomIntensity).toBe(1.3);
      expect(now.bloomThreshold).toBe(0.74);
      expect(now.saturation).toBe(-0.08);
      expect(now.contrast).toBe(0.12);
      expect(now.grain).toBe(0.055);
      expect(now.focusRange).toBe(0.18);
      expect(now.bokeh).toBeCloseTo((tier === "cinematic" ? 3.4 : 2.4) * 1.4, 12);
      if (tier === "cinematic") expect(now.ca).toEqual([0.0014, 0.0014]);
    }
  });

  test("the full tiers' bloom threshold never goes below 0.72", () => {
    applyLook({ ...PLAYING, bloomThreshold: 0.5 });
    const { t, dof } = chain("cinematic");
    applyFilmLook(t, dof, false, true);
    expect(t.bloom?.luminanceMaterial.threshold).toBe(0.72);
  });

  test("once the look is reset (a stop, or the end), the chain is back on its own constants exactly", () => {
    for (const tier of TIERS) {
      const { t, dof } = chain(tier);
      const before = read(t, dof);
      applyLook(PLAYING);
      applyFilmLook(t, dof, tier === "lite", tier === "cinematic");
      expect(read(t, dof), tier).not.toEqual(before);
      filmLook.reset();
      applyFilmLook(t, dof, tier === "lite", tier === "cinematic");
      expect(read(t, dof), tier).toEqual(before);
    }
  });

  test("the idle look is the one the trailer resets to", () => {
    applyLook(PLAYING);
    filmLook.reset();
    expect({ ...filmLook, reset: undefined }).toEqual({ ...LOOK_IDLE, mixer: [...MIXER_IDENTITY], reset: undefined });
  });
});
