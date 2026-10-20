// The eight seed packets. Every number here is in metres and radians.
// Five are inspired by a film; the Island Bloom, the Pink Lily and the Lotus are our own; all art is original.
// The seven soil flowers grow in the garden bed (lib/sim/model.ts); the Lotus grows in its own koi pond (lib/sim/pond.ts)
// and is drawn by components/lotus, so its record below only stands in for code that reads every species.

/** The seven flowers of the garden bed, which the soil model (SIM_VERSION 7) grows. */
export type SoilSpeciesId = "rose" | "sundrop" | "magnolia" | "marigold" | "island" | "jasmine" | "lily";
export type SpeciesId = SoilSpeciesId | "lotus";

/** Every species in the seed picker's order, the lotus last. */
export const ALL_SPECIES: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"];

/** The lotus grows in a pond, not the bed: its model, care, scene and words differ. */
export function isLotus(id: SpeciesId): id is "lotus" {
  return id === "lotus";
}

export interface PetalLayer {
  /** petals in this whorl */
  count: number;
  length: number;
  width: number;
  /** radians from vertical when fully open */
  open: number;
  /** gentle backward recurve of the whole blade */
  bend: number;
  /** cupping across the width */
  cup: number;
  /** edge undulation amplitude */
  ruffle: number;
  /** 0 = round tip, 1 = pointed */
  tip: number;
  /** spiral twist about the petal axis, radians at the tip */
  twist?: number;
  /** rolls the margins inward around the petal axis (1 = a closed tube) */
  roll?: number;
  /** sideways lean of the whole petal, radians; gives a whorl its swirl */
  lean?: number;
  /** the reflexed lip: how sharply the top third curls backwards (0..1) */
  lip?: number;
  /**
   * The whorl's turn against the innermost one, radians, for a flower whose whorls interleave exactly (a lily's outer
   * three sit between its inner three); left out, each whorl turns on by half a golden angle and a little chance.
   */
  turn?: number;
}

export interface LeafSpec {
  count: [number, number];
  /** blade (or terminal leaflet) length */
  length: number;
  width: number;
  serration: number;
  fold: number;
  gloss: number;
  /** leaflets per leaf; 1 = simple leaf */
  compound: number;
  /** rachis length for compound leaves; defaults to a third of the blade */
  petiole?: number;
  petioleColor?: string;
  /** how far up the cane the hero's leaves run, as a share of it (0.88 when left out); a lily's stop under its flowers */
  top?: number;
  color: string;
  tipColor: string;
  veinColor: string;
}

export interface FlowerSpec {
  layers: PetalLayer[];
  colorBase: string;
  colorMid: string;
  colorTip: string;
  veinColor: string;
  veins: number;
  sheenColor: string;
  sheen: number;
  roughness: number;
  transmission: number;
  thickness: number;
  attenuationColor: string;
  emissive: string;
  emissiveDay: number;
  emissiveNight: number;
  center: {
    color: string;
    radius: number;
    stamens: number;
    stamenColor: string;
    /**
     * A lily's long stamens instead of the short tuft every other flower has: `stamens` of them on a ring round a
     * central style, leaning out of the throat, each filament `length` long in its own colour with a slim anther laid
     * across its tip, and the style a touch longer with a small stigma.
     */
    long?: { length: number; filament: string; stigma: string };
  };
  /**
   * Marks painted on every petal, for a lily: a green-yellow `throat` at the base, a deeper `streak` down the middle of
   * the lower blade and `spots` (freckles) scattered about it. Leave out for a clean blade.
   */
  marks?: { throat: string; streak: string; spots: string };
  sepals: { count: number; length: number; width: number; color: string };
  /** bud radius before the petals open */
  budRadius: number;
  /** how much longer than wide the bud's core is (a lily's is a long club); a round bud when left out */
  budAspect?: number;
  /** the bud core's own colour; the petals' base and mid colours mixed when left out */
  budColor?: string;
}

export interface Species {
  id: SpeciesId;
  name: string;
  /** the film that inspired it, or "Original" */
  film: string;
  tagline: string;
  stem: {
    height: number;
    radius: number;
    segments: number;
    lean: number;
    wobble: number;
    color: string;
    tipColor: string;
    /** small curved prickles along the stem */
    thorns: boolean;
    thornColor?: string;
  };
  leaves: LeafSpec;
  flower: FlowerSpec;
  /**
   * Several flowers up the top of one stem, for a lily (lib/plant/raceme): `flowers` of them, the lowest opening first,
   * each on a stalk `pedicel` metres long leaning `out` radians from the stem, spread over the top `span` of the cane,
   * with a bud at the tip. Left out, the one flower crowns the stem.
   */
  raceme?: { flowers: number; pedicel: number; out: number; span: number; scale: number };
  fx: { glowNight: boolean; pulse: boolean; sparks: boolean; scent: boolean; glowColor: string };
}

export const SPECIES: Record<SpeciesId, Species> = {
  rose: {
    id: "rose",
    name: "Enchanted Rose",
    film: "Beauty and the Beast",
    tagline: "A faint light lives inside every petal.",
    stem: {
      height: 1.0, radius: 0.016, segments: 4, lean: 0.14, wobble: 0.5,
      color: "#3f6b2a", tipColor: "#7a3b3a", thorns: true, thornColor: "#7a3a28",
    },
    leaves: {
      count: [6, 8], length: 0.135, width: 0.088, serration: 0.9, fold: 0.2, gloss: 0.9, compound: 5,
      petiole: 0.17, petioleColor: "#7a3f36",
      color: "#2a6230", tipColor: "#4a9448", veinColor: "#b4e39c",
    },
    flower: {
      layers: [
        // the eye: a few small petals rolled and twisted around each other into a spiral
        { count: 5, length: 0.1, width: 0.078, open: 0.04, bend: 0, cup: 1.3, ruffle: 0.05, tip: 0.3, twist: 1.4, roll: 0.8, lean: 0.5, lip: 0 },
        { count: 6, length: 0.14, width: 0.115, open: 0.28, bend: 0.03, cup: 1.15, ruffle: 0.1, tip: 0.25, twist: 0.55, roll: 0.3, lean: 0.2, lip: 0.18 },
        { count: 8, length: 0.19, width: 0.16, open: 0.6, bend: 0.12, cup: 0.9, ruffle: 0.2, tip: 0.25, twist: 0.2, lean: 0.08, lip: 0.5 },
        { count: 11, length: 0.235, width: 0.2, open: 0.95, bend: 0.28, cup: 0.65, ruffle: 0.3, tip: 0.3, lip: 0.82 },
        { count: 13, length: 0.26, width: 0.225, open: 1.25, bend: 0.42, cup: 0.45, ruffle: 0.4, tip: 0.3, lip: 1.0 },
      ],
      colorBase: "#5c0a1c", colorMid: "#d61224", colorTip: "#ff7088", veinColor: "#ff9eae", veins: 9,
      sheenColor: "#ff7a8a", sheen: 0.85, roughness: 0.48, transmission: 0.32, thickness: 0.1, attenuationColor: "#b4163a",
      emissive: "#ff3050", emissiveDay: 0.06, emissiveNight: 0.25,
      center: { color: "#ffd27a", radius: 0.02, stamens: 0, stamenColor: "#ffe9a8" },
      sepals: { count: 5, length: 0.17, width: 0.05, color: "#2b662c" },
      budRadius: 0.034,
    },
    fx: { glowNight: true, pulse: false, sparks: true, scent: false, glowColor: "#ff3b5c" },
  },
  sundrop: {
    id: "sundrop",
    name: "Sundrop",
    film: "Tangled",
    tagline: "Glows gold at night and heals a little faster.",
    stem: { height: 1.15, radius: 0.012, segments: 4, lean: 0.08, wobble: 0.3, color: "#4c7c3a", tipColor: "#7aa04a", thorns: false },
    leaves: {
      count: [4, 6], length: 0.24, width: 0.04, serration: 0, fold: 0.3, gloss: 0.6, compound: 1,
      color: "#2b6a33", tipColor: "#4f9a45", veinColor: "#9fd48a",
    },
    flower: {
      layers: [
        { count: 3, length: 0.3, width: 0.11, open: 1.1, bend: 0.6, cup: 0.35, ruffle: 0.08, tip: 0.95, lip: 0.35 },
        { count: 3, length: 0.3, width: 0.11, open: 1.2, bend: 0.7, cup: 0.3, ruffle: 0.08, tip: 0.95, lip: 0.4 },
      ],
      colorBase: "#ff9d00", colorMid: "#ffc63a", colorTip: "#fff0b0", veinColor: "#ffe27a", veins: 7,
      sheenColor: "#fff2b0", sheen: 0.8, roughness: 0.4, transmission: 0.4, thickness: 0.1, attenuationColor: "#ffb020",
      emissive: "#ffcc44", emissiveDay: 0.12, emissiveNight: 1.4,
      center: { color: "#ffea00", radius: 0.018, stamens: 6, stamenColor: "#fff6c0" },
      sepals: { count: 0, length: 0, width: 0, color: "#4c7c3a" },
      budRadius: 0.05,
    },
    fx: { glowNight: true, pulse: true, sparks: true, scent: false, glowColor: "#ffd34d" },
  },
  magnolia: {
    id: "magnolia",
    name: "Magnolia",
    film: "Mulan",
    tagline: "Blooms last, but biggest of all.",
    stem: { height: 0.9, radius: 0.02, segments: 3, lean: 0.2, wobble: 0.4, color: "#5a4a3a", tipColor: "#6f8a4a", thorns: false },
    leaves: {
      count: [5, 7], length: 0.2, width: 0.1, serration: 0, fold: 0.25, gloss: 0.9, compound: 1,
      color: "#1e4d2b", tipColor: "#2c6a3a", veinColor: "#8fc48f",
    },
    flower: {
      layers: [
        { count: 3, length: 0.3, width: 0.19, open: 0.42, bend: 0.06, cup: 1.05, ruffle: 0.08, tip: 0.5, lip: 0.08 },
        { count: 3, length: 0.34, width: 0.22, open: 0.72, bend: 0.12, cup: 0.95, ruffle: 0.08, tip: 0.5, lip: 0.12 },
        { count: 3, length: 0.35, width: 0.23, open: 1.0, bend: 0.25, cup: 0.85, ruffle: 0.12, tip: 0.5, lip: 0.2 },
      ],
      colorBase: "#e8a8bf", colorMid: "#fbeee4", colorTip: "#fffbf4", veinColor: "#f6d9c9", veins: 7,
      sheenColor: "#fff6ea", sheen: 0.4, roughness: 0.5, transmission: 0.4, thickness: 0.15, attenuationColor: "#f7cfd6",
      emissive: "#ffd6ea", emissiveDay: 0.02, emissiveNight: 0.3,
      center: { color: "#e7b86a", radius: 0.03, stamens: 30, stamenColor: "#f2d08a" },
      sepals: { count: 0, length: 0, width: 0, color: "#5a4a3a" },
      budRadius: 0.09,
    },
    fx: { glowNight: true, pulse: false, sparks: false, scent: true, glowColor: "#ffd6ea" },
  },
  marigold: {
    id: "marigold",
    name: "Marigold",
    film: "Coco",
    tagline: "Petals shimmer and draw fireflies at dusk.",
    stem: { height: 0.6, radius: 0.012, segments: 3, lean: 0.1, wobble: 0.6, color: "#3e7a2e", tipColor: "#5a9a3a", thorns: false },
    leaves: {
      count: [6, 10], length: 0.07, width: 0.025, serration: 1.0, fold: 0.2, gloss: 0.3, compound: 5,
      petiole: 0.09, color: "#2e6b2a", tipColor: "#4c8f3a", veinColor: "#9bd27f",
    },
    flower: {
      layers: [
        { count: 8, length: 0.06, width: 0.05, open: 0.25, bend: 0.2, cup: 0.6, ruffle: 1.0, tip: 0.1 },
        { count: 12, length: 0.08, width: 0.06, open: 0.5, bend: 0.25, cup: 0.6, ruffle: 1.0, tip: 0.1 },
        { count: 16, length: 0.1, width: 0.07, open: 0.75, bend: 0.3, cup: 0.6, ruffle: 1.0, tip: 0.1 },
        { count: 20, length: 0.115, width: 0.08, open: 1.0, bend: 0.35, cup: 0.6, ruffle: 1.0, tip: 0.1 },
        { count: 24, length: 0.13, width: 0.085, open: 1.25, bend: 0.4, cup: 0.6, ruffle: 1.0, tip: 0.1 },
        { count: 28, length: 0.14, width: 0.09, open: 1.45, bend: 0.5, cup: 0.6, ruffle: 1.0, tip: 0.1 },
      ],
      colorBase: "#b23a00", colorMid: "#ff8a00", colorTip: "#ffc233", veinColor: "#ffde7a", veins: 5,
      sheenColor: "#ffcf5a", sheen: 0.5, roughness: 0.6, transmission: 0.15, thickness: 0.1, attenuationColor: "#ff7a00",
      emissive: "#ff9a1f", emissiveDay: 0.03, emissiveNight: 0.35,
      center: { color: "#ffb300", radius: 0.02, stamens: 12, stamenColor: "#ffd45a" },
      sepals: { count: 5, length: 0.05, width: 0.02, color: "#3a7a2e" },
      budRadius: 0.045,
    },
    fx: { glowNight: true, pulse: false, sparks: true, scent: true, glowColor: "#ffb347" },
  },
  island: {
    id: "island",
    name: "Island Bloom",
    film: "Original",
    tagline: "A spiral bud that pulses green at night.",
    stem: { height: 0.7, radius: 0.02, segments: 3, lean: 0.1, wobble: 0.4, color: "#2f6a4a", tipColor: "#3f8a5a", thorns: false },
    leaves: {
      count: [3, 5], length: 0.3, width: 0.18, serration: 0, fold: 0.3, gloss: 0.8, compound: 1,
      color: "#1a5a3a", tipColor: "#2e8a55", veinColor: "#8fe0b0",
    },
    flower: {
      layers: [
        { count: 5, length: 0.18, width: 0.12, open: 0.3, bend: 0.2, cup: 1.0, ruffle: 0.2, tip: 0.6, twist: 0.6 },
        { count: 8, length: 0.24, width: 0.15, open: 0.7, bend: 0.5, cup: 0.8, ruffle: 0.25, tip: 0.6, twist: 0.5 },
        { count: 13, length: 0.28, width: 0.17, open: 1.1, bend: 0.8, cup: 0.5, ruffle: 0.3, tip: 0.6, twist: 0.4 },
      ],
      colorBase: "#0b4a3d", colorMid: "#1f9f78", colorTip: "#9ff2cf", veinColor: "#c9ffe9", veins: 7,
      sheenColor: "#b9ffe6", sheen: 0.6, roughness: 0.4, transmission: 0.35, thickness: 0.15, attenuationColor: "#13a07a",
      emissive: "#2ff0b0", emissiveDay: 0.08, emissiveNight: 1.1,
      center: { color: "#e6fff5", radius: 0.025, stamens: 10, stamenColor: "#ffffff" },
      sepals: { count: 3, length: 0.12, width: 0.05, color: "#1f6f4a" },
      budRadius: 0.08,
    },
    fx: { glowNight: true, pulse: true, sparks: true, scent: false, glowColor: "#3cf5b8" },
  },
  jasmine: {
    id: "jasmine",
    name: "Night Jasmine",
    film: "Aladdin",
    tagline: "Bangalore's own flower. Scent drifts out at sunset.",
    stem: { height: 0.8, radius: 0.01, segments: 4, lean: 0.25, wobble: 0.7, color: "#4a7a3a", tipColor: "#6a9a4a", thorns: false },
    leaves: {
      count: [6, 10], length: 0.12, width: 0.07, serration: 0, fold: 0.2, gloss: 0.8, compound: 1,
      color: "#245f2e", tipColor: "#3a8a42", veinColor: "#a8d8a0",
    },
    flower: {
      layers: [
        { count: 5, length: 0.14, width: 0.075, open: 1.35, bend: 0.15, cup: 0.3, ruffle: 0.1, tip: 0.6 },
        { count: 5, length: 0.14, width: 0.075, open: 1.25, bend: 0.1, cup: 0.3, ruffle: 0.1, tip: 0.6 },
      ],
      colorBase: "#f6f3ff", colorMid: "#ffffff", colorTip: "#ffffff", veinColor: "#efe9ff", veins: 5,
      sheenColor: "#ffffff", sheen: 0.7, roughness: 0.5, transmission: 0.4, thickness: 0.1, attenuationColor: "#f0e8ff",
      emissive: "#fff4d6", emissiveDay: 0.02, emissiveNight: 0.5,
      center: { color: "#ffe27a", radius: 0.012, stamens: 2, stamenColor: "#ffd36a" },
      sepals: { count: 5, length: 0.06, width: 0.012, color: "#3a7a3a" },
      budRadius: 0.03,
    },
    fx: { glowNight: true, pulse: false, sparks: false, scent: true, glowColor: "#fff1c9" },
  },
  lily: {
    // A pink Oriental lily, like a florist's 'Sorbonne': six tepals in two whorls of three, the inner ones broader,
    // recurving from a green-yellow throat freckled with deep pink, six long stamens with rust anthers round the style,
    // on one tall unbranched stem with narrow leaves all the way up.
    id: "lily",
    name: "Pink Lily",
    film: "Original",
    tagline: "Blush-pink petals curl back from a freckled heart, sweetly scented by evening.",
    stem: { height: 1.05, radius: 0.013, segments: 4, lean: 0.06, wobble: 0.25, color: "#557f43", tipColor: "#6f9a52", thorns: false },
    leaves: {
      count: [11, 14], length: 0.19, width: 0.04, serration: 0, fold: 0.38, gloss: 0.65, compound: 1, petiole: 0.012,
      petioleColor: "#5e8a4a", top: 0.7, color: "#2c6a3c", tipColor: "#46904f", veinColor: "#a6d69a",
    },
    // three flowers like a florist's stem, a little smaller than a single bloom so they share the top of the stem
    raceme: { flowers: 3, pedicel: 0.09, out: 0.9, span: 0.3, scale: 0.8 },
    flower: {
      layers: [
        { count: 3, length: 0.27, width: 0.14, open: 1.05, bend: 0.5, cup: 0.45, ruffle: 0.32, tip: 0.85, lip: 0.72 },
        { count: 3, length: 0.28, width: 0.105, open: 1.15, bend: 0.55, cup: 0.38, ruffle: 0.24, tip: 0.92, lip: 0.8, turn: Math.PI / 3 },
      ],
      colorBase: "#cf4e87", colorMid: "#f2a2c4", colorTip: "#fce6ee", veinColor: "#ffd3e4", veins: 5,
      // little transmission: the long tepals curl away from the eye, and through them the dark garden would show
      sheenColor: "#ffe8f1", sheen: 0.6, roughness: 0.45, transmission: 0.12, thickness: 0.1, attenuationColor: "#f6b3cf",
      emissive: "#ff9ccc", emissiveDay: 0.03, emissiveNight: 0.2,
      center: { color: "#2e1006", radius: 0.016, stamens: 6, stamenColor: "#86391d", long: { length: 0.15, filament: "#dfe6b4", stigma: "#b98aa4" } },
      marks: { throat: "#d7e39a", streak: "#b3275e", spots: "#a3204f" },
      sepals: { count: 0, length: 0, width: 0, color: "#557f43" },
      budRadius: 0.03,
      budAspect: 2.6,
      budColor: "#d9a7b9",
    },
    // a lily has no light of its own: a soft night glow in the petals, the small light at its heart kept low
    fx: { glowNight: false, pulse: false, sparks: false, scent: true, glowColor: "#f36fc8" },
  },
  lotus: {
    // A stand-in for everything that reads every species (names, the party feed's dot, the glow colour, the developer
    // panel, the Meadow's fallback heads, speciesHeight): the real lotus, pads, stalks, flower and pod are drawn by
    // components/lotus. Its colours are the lotus look's soft pink (components/lotus/materials.ts PETAL_SETS.pink, the
    // pads of textures.ts) and its petals the three whorls of build.ts, drawn at the soil flowers' scale.
    id: "lotus",
    name: "Lotus",
    film: "Original",
    tagline: "A soft pink lotus in its own koi pond, in a quiet courtyard.",
    stem: { height: 0.55, radius: 0.008, segments: 3, lean: 0.06, wobble: 0.3, color: "#6c8a4a", tipColor: "#7f9a52", thorns: true, thornColor: "#5d7440" },
    leaves: {
      count: [3, 5], length: 0.2, width: 0.2, serration: 0, fold: 0.12, gloss: 0.15, compound: 1,
      color: "#3f6d5c", tipColor: "#5b8659", veinColor: "#b3c08c",
    },
    flower: {
      layers: [
        { count: 5, length: 0.19, width: 0.12, open: 0.55, bend: 0.04, cup: 0.95, ruffle: 0.04, tip: 0.34 },
        { count: 6, length: 0.23, width: 0.145, open: 0.95, bend: 0.08, cup: 0.9, ruffle: 0.04, tip: 0.34 },
        { count: 7, length: 0.255, width: 0.16, open: 1.3, bend: 0.12, cup: 0.85, ruffle: 0.05, tip: 0.34 },
      ],
      colorBase: "#fdf6ea", colorMid: "#f8cdd7", colorTip: "#ee9db4", veinColor: "#de7898", veins: 9,
      sheenColor: "#fff0f3", sheen: 0.5, roughness: 0.5, transmission: 0.35, thickness: 0.12, attenuationColor: "#e8879f",
      emissive: "#ffb070", emissiveDay: 0.02, emissiveNight: 0.35,
      center: { color: "#e3cf6a", radius: 0.05, stamens: 40, stamenColor: "#f6d77a" },
      sepals: { count: 4, length: 0.06, width: 0.04, color: "#7f9a52" },
      budRadius: 0.07,
    },
    fx: { glowNight: true, pulse: false, sparks: false, scent: true, glowColor: "#ffb070" },
  },
};

export const SPECIES_LIST: Species[] = Object.values(SPECIES);
