// The film look the party trailer grades the picture with: one plain mutable object (like env), holding a value for
// every post-processing lever the trailer moves. Idle, it holds exactly the constants components/garden/Effects.tsx
// draws with today, so a screen that writes it every frame draws as before whenever no trailer plays. The party
// trailer's director (components/party/trailer/Director.tsx) fills it every frame while the trailer plays, and the
// trailer's control (components/party/trailer/control.ts) resets it whenever the trailer stops or ends. Effects reads
// it only when PartyScene asks it to (its `trailerLook` prop), so the personal garden never sees it. It lives in
// lib/garden, beside env, so the garden never imports from the party.
//
// Every value is either a multiplier on what Effects already writes (exposure, chromatic aberration, bokeh) or the
// full tiers' own absolute value (bloom, vignette, saturation and contrast, grain, the depth of field's range, the
// channel mixer). The lite tier maps the bloom through liteBloomIntensity and liteBloomThreshold below, so a phone's
// bloom keeps catching only true light sources.
import { LAYOUT } from "@/lib/garden/layout";

/** The look's values, as the trailer's script keys them and Effects applies them. */
export interface LookValues {
  /** × on the exposure Effects writes (lite's night lift included); never above 1.12 */
  exposure: number;
  /** Bloom intensity, the full tiers' absolute value (lite: liteBloomIntensity) */
  bloomIntensity: number;
  /** Bloom luminance threshold, the full tiers' absolute value (fullBloomThreshold; lite: liteBloomThreshold) */
  bloomThreshold: number;
  /** Vignette darkness and offset, absolute, every tier */
  vignetteDarkness: number;
  vignetteOffset: number;
  /** HueSaturation saturation and BrightnessContrast contrast, absolute (balanced and cinematic) */
  saturation: number;
  contrast: number;
  /** the Noise effect's soft-light blend opacity, absolute, at most 0.06 (balanced and cinematic) */
  grain: number;
  /** × on the chromatic aberration's offset, 0.0007 (cinematic only) */
  ca: number;
  /** the depth of field's sharp range either side of its focus, metres (balanced and cinematic) */
  dofRange: number;
  /** × on the depth of field's bokeh scale, 3.4 cinematic and 2.4 balanced; at most 1.4 */
  bokeh: number;
  /**
   * The channel mixer (a Sepia effect's weightsR, weightsG and weightsB, mounted straight after tone mapping on every
   * tier): nine numbers, row by row, each output channel as weights of the input r, g and b. Identity when idle.
   */
  mixer: number[];
}

/** The identity mixer: each channel as it is. */
export const MIXER_IDENTITY: readonly number[] = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Today's constants (components/garden/Effects.tsx), which the look holds whenever no trailer plays. */
export const LOOK_IDLE: Readonly<Omit<LookValues, "mixer">> & { readonly mixer: readonly number[] } = Object.freeze({
  exposure: 1,
  bloomIntensity: 0.85,
  bloomThreshold: 0.85,
  vignetteDarkness: 0.4,
  vignetteOffset: 0.25,
  saturation: 0.02,
  contrast: 0.06,
  grain: 0.03,
  ca: 1,
  dofRange: LAYOUT.camera.focusRange,
  bokeh: 1,
  mixer: MIXER_IDENTITY,
});

/** The lowest bloom threshold a full tier is given, and the lowest lite is given (its true light sources only). */
export const FULL_THRESHOLD_MIN = 0.72;
export const LITE_THRESHOLD_MIN = 0.95;
/** Lite's own idle bloom (Effects.tsx): the intensity and threshold the full tiers' idle values map to. */
const LITE_INTENSITY = 0.65;
const LITE_THRESHOLD = 1.0;

/** The full tiers' bloom threshold for a look value: the value, never below FULL_THRESHOLD_MIN. */
export function fullBloomThreshold(v: number): number {
  return Math.max(FULL_THRESHOLD_MIN, v);
}

/** Lite's bloom intensity for a look value: scaled by lite's own idle 0.65 against the full tiers' 0.85. */
export function liteBloomIntensity(v: number): number {
  return (LITE_INTENSITY * v) / LOOK_IDLE.bloomIntensity;
}

/** Lite's bloom threshold for a look value: half as far below lite's 1.0 as the value is below 0.85, floored at 0.95. */
export function liteBloomThreshold(v: number): number {
  return Math.max(LITE_THRESHOLD_MIN, LITE_THRESHOLD - (LOOK_IDLE.bloomThreshold - v) / 2);
}

/** The look Effects draws with: the trailer's values while it plays, today's constants otherwise. */
export const filmLook: LookValues & { reset(): void } = {
  ...LOOK_IDLE,
  mixer: [...MIXER_IDENTITY],
  /** Back to today's constants (the trailer stopped or ended); Effects writes them on its next frame. */
  reset() {
    applyLook(LOOK_IDLE);
  },
};

/** Copies `v` into filmLook in place (the mixer included), so readers holding filmLook.mixer keep a live array. */
export function applyLook(v: Readonly<Omit<LookValues, "mixer">> & { readonly mixer: readonly number[] }) {
  filmLook.exposure = v.exposure;
  filmLook.bloomIntensity = v.bloomIntensity;
  filmLook.bloomThreshold = v.bloomThreshold;
  filmLook.vignetteDarkness = v.vignetteDarkness;
  filmLook.vignetteOffset = v.vignetteOffset;
  filmLook.saturation = v.saturation;
  filmLook.contrast = v.contrast;
  filmLook.grain = v.grain;
  filmLook.ca = v.ca;
  filmLook.dofRange = v.dofRange;
  filmLook.bokeh = v.bokeh;
  for (let i = 0; i < 9; i++) filmLook.mixer[i] = v.mixer[i];
}
