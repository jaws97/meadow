// The urli's water shape, shared by the art and (in the build) the bowl model: the model's vessel U35, a cone
// frustum 0.175 m across at the rim, 0.10 m at the base, 0.12 m deep inside, with 8 cm of mud and the fill line
// 2.5 cm over it (art direction, section 1.2). Every vessel option keeps this inner shape, so the water arithmetic
// and the picture agree; only the outside differs.
//
// Heights are in the urli's own frame: y = 0 is the crown of the hero's mound (HERO_GROUND_Y in the garden, the
// bed's soil in the Meadow). In world terms (garden): foot 0.135, inner floor 0.155, mud 0.235, fill 0.26, rim
// crest 0.278. Pure numbers: no three, no DOM.

export const URLI = {
  /** the inner floor (never seen: the mud covers it) */
  floorY: 0.015,
  /** the mud's top */
  mudY: 0.095,
  /** the fill line, 25 mm of water over the mud */
  fillY: 0.12,
  /** the brim: 40 mm of water over the mud, where the extra spills over */
  brimY: 0.135,
  /** the inner radius at the floor, and how fast it widens per metre of height (0.075 over 0.12) */
  rFloor: 0.1,
  slope: 0.625,
  brimMM: 40,
  fillMM: 25,
} as const;

/** The inner wall's radius at height y. */
export const innerR = (y: number) => URLI.rFloor + URLI.slope * (y - URLI.floorY);
/** The water's surface height for `mm` of water over the mud. */
export const waterY = (mm: number) => URLI.mudY + Math.min(URLI.brimMM, Math.max(0, mm)) / 1000;
/** The water's surface radius for `mm` of water (0.150 m on bare mud, 0.166 m at the fill line). */
export const waterR = (mm: number) => innerR(waterY(mm));

/** The outside of each vessel option, for placement and the camera: its rim crest and outer radius (section 2). */
export const VESSEL_OUTER = {
  a: { rimY: 0.1375, outerR: 0.195, footY: -0.005, label: "Bell-metal urli" },
  b: { rimY: 0.138, outerR: 0.215, footY: -0.02, label: "Granite urli" },
  c: { rimY: 0.1385, outerR: 0.193, footY: -0.004, label: "Duck-egg glazed bowl" },
} as const;
