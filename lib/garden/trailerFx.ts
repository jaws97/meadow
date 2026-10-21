// The party trailer's hand on the shared scene: a plain mutable object (like env and lib/garden/look), holding a
// multiplier or a small cue for each scene part the trailer leans on, the flower's glow, the golden-hour rim light, the
// seed's light and its two hops, the motes, the dandelion fluff, the fireflies, the scent sparkles and the lantern.
// Every value's neutral is today's behaviour (a multiplier of 1, a cue of 0), so the personal garden and the idle party
// screen draw exactly as before: only the trailer's director (components/party/trailer/Director.tsx) ever writes it,
// every frame while the trailer plays, and the trailer's control (components/party/trailer/control.ts) puts it back
// whenever the trailer stops or ends. The scene reads it inside its own frame loops (never through React).
//
// Two fields are not multipliers. `heroHex` holds the Backdrop's flower colour for the whole trailer, so the gates
// that change the flower under black never rebuild the backdrop (it is the rose's own colour, so releasing it rebuilds
// nothing either). `snap` is a counter the trailer bumps once when it puts the garden back under black: the flower and
// its companions take the store's values at once instead of easing toward them, so the showcase rose is whole when the
// black lifts.

/** The scene multipliers and cues, as the trailer's script keys them. */
export interface SceneFx {
  /** × on the hero flower's petal and bud emissive (Plant); capped at GLOW_CAP for the tier */
  glow: number;
  /** × on the golden-hour rim kicker's intensity (Lights) */
  rim: number;
  /** × on the seed mound's glow opacity (SeedMound) */
  seedLight: number;
  /** 0..1, the seed's light swelling (SeedMound: glow opacity × (1 + 1.2 pulse), sprite scale × (1 + 0.35 pulse)) */
  seedPulse: number;
  /** 0..1, the mound's hop (SeedMound: scale y × (1 + 0.5 bulge), x and z × (1 − 0.05 bulge)) */
  seedBulge: number;
  /** × on the pollen motes' opacity, and on their size uniform (Atmosphere POLLEN) */
  pollen: number;
  pollenSize: number;
  /** × on the dandelion fluff's opacity (Atmosphere FLUFF) */
  fluff: number;
  /** × on the fireflies' opacity (Atmosphere FIREFLIES) */
  fireflies: number;
  /** 0..1, scent sparkles from the flower head, added to the field's own (Atmosphere SCENT: scent × bloom × growth × (1 − rain)) */
  scent: number;
  /** × on the lantern's light, halo and lite lamp; its flame scales by 0.6 + 0.4 min(1, lamp) (Lantern) */
  lamp: number;
}

/** Each multiplier and cue at rest: today's scene. */
export const FX_NEUTRAL: Readonly<SceneFx> = Object.freeze({
  glow: 1,
  rim: 1,
  seedLight: 1,
  seedPulse: 0,
  seedBulge: 0,
  pollen: 1,
  pollenSize: 1,
  fluff: 1,
  fireflies: 1,
  scent: 0,
  lamp: 1,
});

/** The most the glow multiplier is taken as, by tier: lite's heart light would burn a white spot past this. */
export const GLOW_CAP = Object.freeze({ lite: 2.5, full: 5 });

/** The trailer's scene multipliers, the Backdrop's held flower colour, and the snap counter. */
export const trailerFx: SceneFx & {
  /** the Backdrop's flower colour while the trailer plays (the rose's colorMid), or null for the flower's own */
  heroHex: string | null;
  /** bumped once when the garden is put back under black: the flower and its companions take the store's values at once */
  snap: number;
  /** every multiplier and cue back to neutral (heroHex and snap are left as they are) */
  reset(): void;
} = {
  ...FX_NEUTRAL,
  heroHex: null,
  snap: 0,
  reset() {
    applyFx(FX_NEUTRAL);
  },
};

/** Copies the multipliers and cues of `v` into trailerFx (heroHex and snap untouched). */
export function applyFx(v: Readonly<SceneFx>) {
  trailerFx.glow = v.glow;
  trailerFx.rim = v.rim;
  trailerFx.seedLight = v.seedLight;
  trailerFx.seedPulse = v.seedPulse;
  trailerFx.seedBulge = v.seedBulge;
  trailerFx.pollen = v.pollen;
  trailerFx.pollenSize = v.pollenSize;
  trailerFx.fluff = v.fluff;
  trailerFx.fireflies = v.fireflies;
  trailerFx.scent = v.scent;
  trailerFx.lamp = v.lamp;
}
