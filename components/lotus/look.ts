// From the page's controls to the lotus's look: the numbers the bowl model's Visual would hand the art (art
// direction, section 11), chosen for each named stage, mood and hour, with the leaf and flower layout that goes with
// them. The concepts page draws from this alone, so a frame is fully decided by its address. Pure: no three, no DOM.
//
// What it follows from the art direction:
// - Stages (section 4): the seed in its jar; floating leaves (5 of 8-12 cm); standing leaves (2 of 24-26 cm, one
//   behind the flower's place, one over the right rim, none between the flower and the camera); the ripe bud with its
//   pink tip; the flower; the green seed pod with fallen petals on the water.
// - The flower's clock (section 5): open fraction o = bloom^1.6, the outer whorl leading, a re-closed flower keeping
//   a looser cup (morph at least 0.3), day 3's outer petals relaxing and falling from 17:00.
// - Moods (section 7): happy; mud drying (the water gone, matte mud with the first cracks, floating leaves browning
//   and curling on the mud, standing leaves drooping with crisp margins); green water (cosmetic, never murky brown).
// - Warmth (7.4): only from the ripe bud through flower days 1-2, fading on day 3, never on the pod; stronger at
//   night and before dawn.
//
// The pond view (v2) draws the same plant in its pot on the pond's shelf (pond.ts): its frame has the pot's centre at
// the fill line, so the floating leaves lie on the pond (spread round the pot, inside the coping), the stalks rise
// from the pot's pebbles 5 cm under the water, and the standing leaves (15-28 cm over the water) and the flower (about
// 30-33 cm, just above them) read as a water plant's, not a stem plant's (Jiang et al. 2023 via the biology brief:
// standing leaves 11-26 cm, flower stalks 21-43 cm in bowl lotus).
//
// The product draws the same tables from the model's live numbers instead of the page's address
// (components/lotus/live: pondLook.ts for the courtyard, urliLook.ts for the Meadow), so the leaf places, the flower's
// clock and the stalks below are exported for them.
import type { ConceptParams, Stage, TimeOfDay } from "@/components/lotus/params";
import { innerR, URLI, waterR, waterY } from "@/components/lotus/frame";
import { jarSpot, POND, POT_FRAME, pondRho } from "@/components/lotus/pond";

export type V3 = readonly [number, number, number];

export interface FloatLeaf {
  x: number;
  z: number;
  /** blade radius, m */
  r: number;
  /** height of the blade's centre in the urli frame */
  y: number;
  yaw: number;
  seed: number;
  /** lying on the bare mud rather than floating */
  onMud: boolean;
  /** tipped up against the wall (radians), when the shrinking water is too small for it */
  tilt: number;
  /**
   * the direction (plan angle, radians, from +x toward +z) the tilt raises the blade toward, when it is not the wall
   * (a young leaf lying with one edge up on an older one); undefined: away from the pot, as against the wall
   */
  tiltDir?: number;
  /** 0 green .. 1 brown, curled like drying paper */
  brown: number;
  /** pale yellow-green paling (hunger), oldest first */
  pale: number;
}

/** A young leaf still rolled into a scroll (both halves rolled in toward the midrib), held up on its stalk to unroll. */
export interface RolledLeaf {
  /** where its stalk leaves the mud, and the scroll's foot and tip */
  base: V3;
  foot: V3;
  tip: V3;
  /** the scroll's greatest radius, m */
  r: number;
  seed: number;
}

export interface StandLeaf {
  /** where the stalk leaves the mud */
  base: V3;
  /** the navel, where the stalk meets the blade */
  top: V3;
  r: number;
  /** the blade's tilt, radians: toward +z (the camera) and toward +x */
  tiltZ: number;
  tiltX: number;
  /** cup depth as a share of the radius (0.24-0.36 is a 0.12-0.18 diameter bowl) */
  cup: number;
  /** 0 cupped to the sky .. 1 turned in like an umbrella */
  wilt: number;
  /** a dry brown margin with a paler line inside it */
  crisp: number;
  pale: number;
  seed: number;
  yaw: number;
  /** how far the top third of the stalk bows, radians */
  bow: number;
}

export type FlowerKind = "none" | "bud" | "flower" | "pod";

export interface FlowerLook {
  kind: FlowerKind;
  base: V3;
  head: V3;
  /** the head's lean toward the camera (radians about x) and sideways (about z) */
  leanX: number;
  leanZ: number;
  /** open fraction 0..1 (o in section 5) and the bud-to-open shape morph */
  open: number;
  morph: number;
  /** flower day 1-3 (0 for a bud or a pod) */
  day: number;
  /** day 3's outer whorl relaxing below horizontal */
  relax: number;
  /** the bud's pink tip 0 green .. 1 the top third rose */
  blush: number;
  /** 0..1: the inner glow (warmth) */
  warmth: number;
  /** outer tepals: hugging the bud (0), folded back (1), shed (2) */
  tepals: 0 | 1 | 2;
  /** day-1 stigmas glisten, day-2 pollen dusts the petal bases, day-3 stigmas brown */
  stigmaWet: number;
  pollen: number;
  /** petals already fallen from the head (0..18), outer whorl first */
  fallen: number;
  /** the pod: swelling 0 (4 cm) .. 1 (7 cm), drying 0 green .. 1 dark brown */
  podSwell: number;
  podDry: number;
  /** the neck's bend under drought, radians */
  neck: number;
  /** the head's size against the art direction's hero metres (the pond view draws it a fifth larger, about 24 cm on day 2) */
  scale: number;
}

export interface FallenPetal {
  x: number;
  z: number;
  yaw: number;
  /** 0 inner, 1 middle, 2 outer whorl */
  whorl: number;
  /** lying on a floating leaf rather than the water */
  y: number;
}

export interface JarLook {
  show: boolean;
  /** 1 clear .. 0 cloudy (the model's jarClarity) */
  clarity: number;
  /** the white root, 0 none .. 1 three centimetres */
  root: number;
}

export interface LotusLook {
  /** which frame the positions are in: the urli's (Meadow view) or the pot in the pond (pond view) */
  frame: "urli" | "pond";
  stage: Stage;
  jar: JarLook;
  waterMM: number;
  algae: number;
  /** the urli's mud only (never the bed's mulch): 0.6 wet .. 0 dry and cracked */
  mudMoisture: number;
  floating: FloatLeaf[];
  standing: StandLeaf[];
  flower: FlowerLook;
  fallen: FallenPetal[];
  /** the hero's growth for the companions' staging (garden/heroGrowth) */
  growth: number;
  /** what the camera frames, in the urli frame (section 10.6) */
  focus: V3;
  /** where the one warm point light sits: the seed in its jar, the flower head, or nowhere */
  glowAt: "seed" | "head" | "none";
  /** the seed in its jar, in this frame (for the warm light) */
  seedAt: V3;
  /** where the stalks leave the mud (the urli's mud, or the pot's pebbles), and the water's surface, in this frame */
  mudY: number;
  surfaceY: number;
  /**
   * pond view: the pot's own water, mm against the fill line, once the pond has fallen under the pot's rim (the pot has
   * no holes, so it keeps its 4.65 L: the pond model, section 1.2); null while the pond covers the rim
   */
  potWaterMM: number | null;
  /** young leaves still rolled, rising to unroll (pond view, once the plant has standing leaves) */
  rolled: RolledLeaf[];
  /**
   * water beads on the first standing leaf when it is not raining: dew before sunrise, and a splash's worth gathered at
   * the navel otherwise (the leaf is superhydrophobic, so water stands on it in beads, never as a wet film)
   */
  dew: number;
  /** a line for the page saying what the frame shows */
  summary: string;
}

/**
 * Where the jar's stone stands, at the urli's front right foot, in the urli frame (section 4.1). Its height is the
 * garden bed's there (the mulch falls about 3 cm from the mound's crown toward the kerb); the Meadow's flat soil
 * passes its own.
 */
export const JAR_SPOT: V3 = [0.235, -0.022, 0.17];
/** The seed inside it, on the glass bottom (for the warm light and the camera's bed shot). */
export const SEED_IN_JAR: V3 = [JAR_SPOT[0] - 0.006, JAR_SPOT[1] + 0.027, JAR_SPOT[2] + 0.004];

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** The floating leaves, packed toward the back and sides where the rim does not hide them (section 3.1). */
const FLOATS = [
  { x: -0.07, z: -0.07, r: 0.058, yaw: 0.4 },
  { x: 0.083, z: -0.058, r: 0.052, yaw: 2.1 },
  { x: -0.104, z: 0.034, r: 0.045, yaw: 4.0 },
  { x: 0.1, z: 0.05, r: 0.047, yaw: 5.3 },
  { x: 0.018, z: -0.122, r: 0.038, yaw: 1.2 },
  { x: -0.02, z: 0.075, r: 0.034, yaw: 3.1 },
] as const;

export function floatingLeaves(count: number, scale: number, waterMM: number, brown: number, pale: number): FloatLeaf[] {
  const onMud = waterMM <= 0.5;
  // On bare mud the leaves lie on the mud's top; a leaf too wide for what is left tips up against the wall.
  const yBase = onMud ? URLI.mudY + 0.002 : waterY(waterMM) + 0.0012;
  const room = onMud ? innerR(URLI.mudY) - 0.004 : waterR(waterMM) - 0.003;
  const out: FloatLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const f = FLOATS[i];
    const r = f.r * scale;
    let x = f.x;
    let z = f.z;
    const d = Math.hypot(x, z);
    let tilt = 0;
    const over = d + r - room;
    if (over > 0) {
      // drift inward as far as the stalks allow, then lean on the wall
      const pull = Math.min(over, 0.012);
      const k = (d - pull) / Math.max(1e-6, d);
      x *= k;
      z *= k;
      tilt = clamp((over - pull) / r, 0, 1) * 0.5;
    }
    // older leaves (first in the list) brown and pale first, as the model has it
    const age = 1 - i / Math.max(1, count);
    out.push({
      x,
      z,
      r,
      y: yBase + (i % 3) * 0.0011 + tilt * r * 0.4,
      yaw: f.yaw,
      seed: 11 + i * 7,
      onMud,
      tilt,
      brown: clamp(brown * (0.55 + 0.6 * age)),
      pale: clamp(pale * (0.4 + 0.8 * age)),
    });
  }
  return out;
}

const STANDS = [
  // behind the flower's place, a backdrop against the hedge
  { base: [-0.014, URLI.mudY, -0.018], top: [-0.04, 0.33, -0.125], r: 0.125, tiltZ: 0.34, tiltX: -0.08, cup: 0.3, yaw: 0.7 },
  // over the right rim
  { base: [0.022, URLI.mudY, 0.004], top: [0.178, 0.275, -0.012], r: 0.118, tiltZ: 0.16, tiltX: 0.32, cup: 0.27, yaw: 2.4 },
  // a later leaf over the left rim, behind
  { base: [-0.03, URLI.mudY, 0.012], top: [-0.165, 0.305, -0.06], r: 0.11, tiltZ: 0.22, tiltX: -0.3, cup: 0.28, yaw: 4.6 },
] as const;

export function standingLeaves(count: number, droop: number, crisp: number, pale: number): StandLeaf[] {
  // heights are above the water as it stands at the fill line; the stalks do not follow the level
  const w = waterY(URLI.fillMM);
  const out: StandLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const s = STANDS[i];
    const bow = droop * 0.9 * (0.85 + 0.15 * i);
    // a drooping leaf sinks as its stalk bows, and its cup flattens and turns in
    const drop = 0.33 * (1 - Math.cos(bow)) * s.top[1];
    out.push({
      base: [s.base[0], s.base[1], s.base[2]],
      top: [s.top[0], w + s.top[1] - drop, s.top[2]],
      r: s.r,
      tiltZ: s.tiltZ + bow * 0.5,
      tiltX: s.tiltX * (1 + droop),
      cup: s.cup,
      wilt: clamp((droop - 0.2) / 0.8),
      crisp: clamp(crisp),
      pale: clamp(pale * (i === 0 ? 1 : 0.5)),
      seed: 101 + i * 13,
      yaw: s.yaw,
      bow,
    });
  }
  return out;
}

/** The flower's open fraction for each of its days at its peak (section 5: o = bloom^1.6). */
export const DAY_OPEN = { 1: 0.38, 2: 0.7, 3: 1 } as const;
/** A closed flower (bloom 0.12) and its looser re-closed cup. */
export const CLOSED_OPEN = Math.pow(0.12, 1.6);
export const RECLOSED_MORPH = 0.3;

interface Clock {
  day: 0 | 1 | 2 | 3;
  open: number;
  relax: number;
  fallen: number;
  label: string;
}

/** The honest flower for each time of day (section 5's table), when the day is left on auto. */
function autoClock(time: TimeOfDay): Clock {
  switch (time) {
    case "predawn":
      return { day: 1, open: 0.26, relax: 0, fallen: 0, label: "Day 1, opening to a goblet by lantern light" };
    case "noon":
      return { day: 2, open: 0.62, relax: 0, fallen: 0, label: "Day 2, a wide cup, slowly closing after 10:00" };
    case "golden":
      return { day: 3, open: 1, relax: 0.15, fallen: 2, label: "Day 3, held wide; the first petals let go after 17:00" };
    case "dusk":
      return { day: 2, open: CLOSED_OPEN, relax: 0, fallen: 0, label: "Day 2, closed for the evening, warm inside" };
    case "night":
      return { day: 2, open: CLOSED_OPEN, relax: 0, fallen: 0, label: "Day 2, closed for the night, warm inside" };
  }
}

function dayClock(day: "1" | "2" | "3" | "closed", time: TimeOfDay): Clock {
  if (day === "closed") return { day: 2, open: CLOSED_OPEN, relax: 0, fallen: 0, label: "Re-closed cup" };
  const d = Number(day) as 1 | 2 | 3;
  // Days 1 and 2 shut in the afternoon: Teng et al. 2012 (BMC Plant Biology 12:82) saw the first day's flower fully
  // open by about 05:30, held to about 09:00 and completely closed by about 15:00, with sunrise at about 05:00, and the
  // second day's opening "very similar"; with Bangalore's November sunrise at about 06:15 that is closed by about 16:15
  // [E: the shift]. So from golden hour on, a day-1 or day-2 flower is a closed cup, warm inside.
  if (d !== 3 && (time === "golden" || time === "dusk" || time === "night")) {
    return { day: d, open: CLOSED_OPEN, relax: 0, fallen: 0, label: `Day ${d}, closed since mid-afternoon, warm inside` };
  }
  // day 3's petals fall from 17:00, one by one through the evening (petalDrop 0 to 1 by midnight)
  const shed = d === 3 ? (time === "golden" ? 2 : time === "dusk" ? 3 : time === "night" ? 9 : 0) : 0;
  const label = d === 1 ? "Day 1, a goblet" : d === 2 ? "Day 2, a wide cup" : shed ? `Day 3, widest, ${shed} petals fallen` : "Day 3, widest";
  return { day: d, open: DAY_OPEN[d], relax: d === 3 ? 0.15 : 0, fallen: shed, label };
}

/** Warmth is stronger in the cool of the night and before dawn (7.4), and fades through day 3. */
function warmthFor(time: TimeOfDay, day: number): number {
  const byHour: Record<TimeOfDay, number> = { predawn: 1, night: 1, dusk: 0.85, golden: 0.55, noon: 0.3 };
  return byHour[time] * (day === 3 ? 0.4 : 1);
}

const GROWTH: Record<Stage, number> = { jar: 0.04, floating: 0.3, aerial: 0.55, bud: 0.85, bloom: 1, pod: 1 };

/** The look for one frame of the concepts page. */
export function lookFor(p: ConceptParams): LotusLook {
  return p.view === "pond" ? pondLookFor(p) : urliLookFor(p);
}

function urliLookFor(p: ConceptParams): LotusLook {
  const o = p.overrides;
  const stage = p.stage;
  const drying = p.mood === "drying";
  const green = p.mood === "green";

  // The water book: at the fill line when happy or green; gone (bare mud) when drying. The jar stage's urli is
  // already filled at the party; drying shows its level fallen.
  let waterMM = drying ? (stage === "jar" ? 10 : 0) : URLI.fillMM;
  if (o.water !== undefined) waterMM = o.water;
  let algae = green ? 0.6 : 0;
  if (o.algae !== undefined) algae = o.algae;
  let mudMoisture = waterMM > 0.5 ? 0.6 : 0.22;
  if (o.moisture !== undefined) mudMoisture = o.moisture;
  let droop = drying && stage !== "jar" && stage !== "floating" ? 0.45 : 0;
  if (o.droop !== undefined) droop = o.droop;
  const floatBrown = drying && waterMM <= 0.5 ? 0.75 : 0;
  const crisp = drying ? 0.35 : 0;

  const jar: JarLook = {
    show: stage === "jar",
    clarity: green ? 0.45 : drying ? 0.75 : 1,
    root: 0.5,
  };

  let floating: FloatLeaf[] = [];
  let standing: StandLeaf[] = [];
  if (stage === "floating") floating = floatingLeaves(5, 1, waterMM, floatBrown, 0);
  else if (stage !== "jar") floating = floatingLeaves(stage === "pod" ? 6 : 5, 1.05, waterMM, floatBrown, 0);
  if (stage === "aerial" || stage === "bud" || stage === "bloom") standing = standingLeaves(2, droop, crisp, 0);
  else if (stage === "pod") standing = standingLeaves(3, droop, crisp, 0);

  const w = waterY(URLI.fillMM);
  const flowerBase: V3 = [0.012, URLI.mudY, 0.006];
  const flower: FlowerLook = {
    kind: "none",
    base: flowerBase,
    head: [0, w + 0.46, 0.05],
    leanX: 0.25,
    leanZ: -0.04,
    open: 0,
    morph: 0,
    day: 0,
    relax: 0,
    blush: 0,
    warmth: 0,
    tepals: 0,
    stigmaWet: 0,
    pollen: 0,
    fallen: 0,
    podSwell: 0,
    podDry: 0,
    neck: drying ? 0.28 : 0,
    scale: 1,
  };
  let summary = "";
  let fallen: FallenPetal[] = [];

  if (stage === "bud") {
    flower.kind = "bud";
    flower.head = [0, w + 0.44, 0.04];
    flower.leanX = 0.15;
    flower.blush = 1;
    // the ripe bud (D 0.97): warm from the night before it opens
    flower.warmth = o.warmth ?? warmthFor(p.time, 1) * 0.9;
    summary = "Ripe bud, its tip flushed rose; warm from the night before it opens";
  } else if (stage === "bloom") {
    const c = p.day === "auto" ? autoClock(p.time) : dayClock(p.day, p.time);
    flower.kind = "flower";
    flower.day = c.day;
    // drought takes the petals' spring: the model already scales bloom by turgor
    const open = (o.open ?? c.open) * (drying ? 0.82 : 1);
    flower.open = clamp(open);
    const reclosed = c.day >= 1 && flower.open <= 0.06;
    // the bud-to-open shape follows smoothstep(0, 0.6, o); a flower that has opened once keeps a looser cup
    const t = clamp(flower.open / 0.6);
    flower.morph = Math.max(t * t * (3 - 2 * t), reclosed || c.day >= 2 ? RECLOSED_MORPH : 0);
    flower.relax = c.relax;
    flower.warmth = o.warmth ?? warmthFor(p.time, c.day);
    flower.tepals = c.day >= 2 ? 2 : 1;
    flower.stigmaWet = c.day === 1 ? 1 : 0;
    flower.pollen = c.day >= 2 ? 1 : 0;
    flower.fallen = c.fallen;
    summary = c.label;
    if (c.fallen > 0) fallen = fallenPetals(c.fallen, waterMM);
  } else if (stage === "pod") {
    flower.kind = "pod";
    flower.head = [0, w + 0.43, 0.035];
    flower.leanX = 0.12;
    flower.podSwell = 0.6;
    flower.podDry = o.podDry ?? 0;
    flower.warmth = 0;
    flower.tepals = 2;
    summary = flower.podDry > 0.5 ? "Seed pod, browning and nodding" : "Green seed pod (about day 5), petals on the water";
    fallen = fallenPetals(4, waterMM);
  } else if (stage === "aerial") {
    summary = "Two standing leaves, five floating";
  } else if (stage === "floating") {
    summary = "Five floating leaves on the water";
  } else {
    summary = jar.clarity < 0.6 ? "Seed in its jar, the water gone cloudy: time for fresh water" : "Seed in its jar, its seed of light glowing";
  }
  if (stage === "pod" && flower.podDry > 0) {
    // the dry pod nods as the top of its stalk bows (E: the timing)
    flower.neck += 0.9 * flower.podDry;
  }

  // The camera's subject (section 10.6): the seed in its jar, a point above the water while the leaves float, the
  // tallest standing leaf, then the flower head.
  let focus: V3;
  if (stage === "jar") focus = SEED_IN_JAR;
  else if (stage === "floating") focus = [0, waterY(Math.max(waterMM, 0)) + 0.14, 0];
  else if (stage === "aerial") focus = [standing[0].top[0], standing[0].top[1], standing[0].top[2]];
  else focus = flower.head;

  const moodNote = drying ? (waterMM <= 0.5 ? " · mud bare and drying" : ` · water low (${waterMM} mm)`) : green ? ` · green water (${algae.toFixed(2)})` : "";
  return {
    frame: "urli",
    stage,
    jar,
    waterMM,
    algae,
    mudMoisture,
    floating,
    standing,
    flower,
    fallen,
    growth: GROWTH[stage],
    focus,
    glowAt: stage === "jar" ? "seed" : flower.kind === "bud" || flower.kind === "flower" ? "head" : "none",
    seedAt: SEED_IN_JAR,
    mudY: URLI.mudY,
    surfaceY: waterY(waterMM),
    potWaterMM: null,
    rolled: [],
    dew: 0,
    summary: summary + moodNote,
  };
}

/**
 * Fallen petals drift on the water (or lie on the mud), boat-side up, outer whorl first; each lies roughly along the
 * rim so its 10 cm stays inside the water (centres within 11 cm of the middle).
 */
export function fallenPetals(n: number, waterMM: number): FallenPetal[] {
  const spots = [
    { x: 0.05, z: 0.095, turn: 0.3 },
    { x: -0.075, z: 0.08, turn: -0.25 },
    { x: 0.105, z: -0.02, turn: 0.2 },
    { x: -0.02, z: 0.108, turn: -0.4 },
    { x: 0.085, z: 0.06, turn: 0.5 },
  ];
  const y = waterMM > 0.5 ? waterY(waterMM) + 0.004 : URLI.mudY + 0.004;
  return spots.slice(0, Math.min(n, spots.length)).map((s, i) => ({
    x: s.x,
    z: s.z,
    // along the rim (a tangent), turned a little
    yaw: -Math.atan2(s.z, s.x) + s.turn,
    whorl: 2 - Math.floor(i / 7),
    y: y + i * 0.0015,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The pond view (v2): the plant in its pot on the pond's shelf, in the pot frame (pond.ts POT_FRAME: the pot's centre
// at the fill line, so the water's surface is y = level / 1000 and the pebbles are at y = -0.05)

/** The pot's pebbles, where the stalks leave the mud, in the pot frame. */
export const POND_MUD_Y = -POND.pebbleDepth;

interface FloatSpot {
  x: number;
  z: number;
  r: number;
  yaw: number;
  /** a young leaf lying with one edge up on an older one: how far it sits over the water (m), its tilt and its lift's direction */
  rest?: number;
  tilt?: number;
  tiltDir?: number;
}

/**
 * The floating leaves on the pond, oldest first: no ring round the pot but an uneven spread, as the stalks of different
 * lengths carry them, 12-24 cm across. The big old leaves lie to the left and behind; one lies over the pot's crown and
 * hides most of it, as the young leaves do; the youngest (the sixth) has come up under the edge of the one over the
 * crown and lies on it with an edge lifted. Each is clear of the coping's lip; only that pair overlaps, a few
 * millimetres apart in height so they never z-fight.
 */
const POND_FLOATS: readonly FloatSpot[] = [
  { x: -0.24, z: -0.06, r: 0.118, yaw: 0.4 },
  { x: 0.19, z: -0.2, r: 0.1, yaw: 2.1 },
  // over the pot's crown
  { x: 0.04, z: 0.09, r: 0.085, yaw: 2.8 },
  { x: 0.29, z: 0.07, r: 0.068, yaw: 5.3 },
  { x: -0.08, z: -0.33, r: 0.092, yaw: 1.2 },
  // the youngest, half on the crown's leaf, its edge lifted onto it
  { x: -0.075, z: 0.135, r: 0.06, yaw: 4.0, rest: 0.0045, tilt: 0.09, tiltDir: Math.atan2(0.09 - 0.135, 0.04 + 0.075) },
  { x: -0.45, z: 0.02, r: 0.058, yaw: 3.1 },
  { x: 0.46, z: -0.13, r: 0.066, yaw: 0.9 },
];

/**
 * With the pond under the pot's rim, the leaves have drifted on their long stalks so none lies across the rim: each
 * floats either on the pond, clear of the rim, or (the one over the crown) on the pot's own water.
 */
const POND_FLOATS_LOW: readonly FloatSpot[] = [
  { x: -0.34, z: -0.06, r: 0.118, yaw: 0.4 },
  { x: 0.22, z: -0.24, r: 0.1, yaw: 2.1 },
  { x: 0.02, z: 0.06, r: 0.07, yaw: 2.8 },
  { x: 0.31, z: 0.05, r: 0.068, yaw: 5.3 },
  { x: -0.08, z: -0.36, r: 0.092, yaw: 1.2 },
  { x: -0.26, z: 0.14, r: 0.06, yaw: 4.0 },
  { x: -0.5, z: -0.17, r: 0.058, yaw: 3.1 },
  { x: 0.47, z: -0.12, r: 0.066, yaw: 0.9 },
];

/** The pot frame's origin in the pond's own frame (z only: both are centred on x = 0). */
const POT_IN_POND_Z = POND.potZ - POND.cz;

/** The most floating leaves the pond view has places for. */
export const POND_FLOAT_SPOTS = POND_FLOATS.length;

/**
 * The first `count` floating leaves at `scale` of their size; `reach` draws them in toward the pot's crown (a seedling's
 * coin leaves lie over its pot, product/live pondLook), 1 leaving them in their places.
 */
export function pondFloatingLeaves(count: number, scale: number, levelMM: number, potWaterMM: number | null, brown: number, reach = 1): FloatLeaf[] {
  const surface = levelMM / 1000;
  const rimExposed = levelMM < -POND.rimDepth * 1000 + 2;
  const table = rimExposed ? POND_FLOATS_LOW : POND_FLOATS;
  const out: FloatLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const f = table[i];
    const r = f.r * scale;
    const x = f.x * reach;
    const z = f.z * reach;
    const inPot = rimExposed && Math.hypot(x, z) + r < POND.potR;
    const level = inPot ? (potWaterMM ?? -POND.pebbleDepth * 1000 + 6) / 1000 : surface;
    const age = 1 - i / Math.max(1, count);
    // a resting leaf sits over its neighbour only while both float on the same water
    const rest = f.rest !== undefined && !rimExposed ? f.rest : 0;
    out.push({
      x,
      z,
      r,
      y: level + 0.0012 + (i % 3) * 0.0011 + rest,
      yaw: f.yaw,
      seed: 11 + i * 7,
      onMud: false,
      tilt: rest > 0 ? (f.tilt ?? 0) : 0,
      tiltDir: rest > 0 ? f.tiltDir : undefined,
      brown: clamp(brown * (0.55 + 0.6 * age)),
      pale: 0,
    });
  }
  return out;
}

/**
 * The standing leaves rise from the pot's pebbles to 16-24 cm over the fill line, none between the flower and the
 * camera: the first behind the flower and to its left, framing it; the second to the right, its cup turned to the
 * camera (tipped sideways it showed its dark ribbed underside); the third (the pod's) further left. Their stalks leave
 * the pot from points spread round the crown and lean away from the flower's, so no two run parallel beside it.
 */
/** The standing leaves' places, low over the water (the most the pond view draws is their number). */
export const POND_STANDS = [
  { top: [-0.16, 0.235, -0.19], r: 0.13, tiltZ: 0.38, tiltX: -0.12, cup: 0.42, yaw: 0.7 },
  { top: [0.25, 0.185, -0.08], r: 0.118, tiltZ: 0.4, tiltX: 0.14, cup: 0.4, yaw: 2.4 },
  { top: [-0.29, 0.16, 0.0], r: 0.11, tiltZ: 0.28, tiltX: -0.3, cup: 0.4, yaw: 4.6 },
] as const;
const POND_STAND_BASES = [
  [-0.07, POND_MUD_Y, -0.06],
  [0.07, POND_MUD_Y, -0.03],
  [-0.07, POND_MUD_Y, 0.03],
] as const;

/** The young rolled leaf: from the crown's right, its scroll held up a hand over the water, leaning out (pot frame). */
export const POND_ROLLED = { base: [0.06, POND_MUD_Y, 0.0], foot: [0.125, 0.03, -0.035], tip: [0.16, 0.125, -0.015], r: 0.0062, seed: 5 } as const;

export function pondStandingLeaves(count: number, droop: number, crisp: number): StandLeaf[] {
  const out: StandLeaf[] = [];
  for (let i = 0; i < count; i++) {
    const s = POND_STANDS[i];
    const b = POND_STAND_BASES[i];
    const bow = droop * 0.9 * (0.85 + 0.15 * i);
    const drop = 0.33 * (1 - Math.cos(bow)) * s.top[1];
    out.push({
      base: [b[0], b[1], b[2]],
      top: [s.top[0], s.top[1] - drop, s.top[2]],
      r: s.r,
      tiltZ: s.tiltZ + bow * 0.5,
      tiltX: s.tiltX * (1 + droop),
      cup: s.cup,
      wilt: clamp((droop - 0.2) / 0.8),
      crisp: clamp(crisp),
      pale: 0,
      seed: 101 + i * 13,
      yaw: s.yaw,
      bow,
    });
  }
  return out;
}

/** Fallen petals drifting on open water round the pot (the pod stage, day 3's evening). */
const POND_FALLEN = [
  { x: 0.12, z: 0.14, turn: 0.3 },
  { x: -0.13, z: 0.17, turn: -0.25 },
  { x: 0.36, z: 0.08, turn: 0.2 },
  { x: -0.36, z: 0.12, turn: -0.4 },
  { x: 0.05, z: 0.2, turn: 0.5 },
] as const;

export function pondFallenPetals(n: number, levelMM: number): FallenPetal[] {
  const y = levelMM / 1000 + 0.004;
  return POND_FALLEN.slice(0, Math.min(n, POND_FALLEN.length)).map((s, i) => ({
    x: s.x,
    z: s.z,
    yaw: -Math.atan2(s.z + POT_IN_POND_Z, s.x) + s.turn,
    whorl: 2,
    y: y + i * 0.0015,
  }));
}

/**
 * The pond view's one flower stalk, leaving the pot right of the crown and leaning a little left as it rises (build.ts
 * gives it a gentle S), the head just above the standing leaves and in front of the first, which frames it; the ripe bud
 * and the pod stand a little lower and lean less (pot frame).
 */
export const POND_FLOWER = {
  base: [0.035, POND_MUD_Y, 0.0],
  flower: { head: [-0.02, 0.315, 0.06], leanX: 0.25, leanZ: 0.06 },
  bud: { head: [-0.015, 0.3, 0.055], leanX: 0.15 },
  pod: { head: [-0.015, 0.31, 0.05], leanX: 0.12 },
} as const;

/** The seed's jar on the front coping slab, in the pot frame (the garden's seed is the owner's, "Lijas", as on the page). */
export function pondJarInPotFrame(seed = "Lijas"): V3 {
  const j = jarSpot(seed);
  return [j.at[0] - POT_FRAME[0], j.at[1] - POT_FRAME[1], j.at[2] - POT_FRAME[2]];
}

function pondLookFor(p: ConceptParams): LotusLook {
  const o = p.overrides;
  const stage = p.stage;
  const drying = p.mood === "drying";
  const green = p.mood === "green";

  // The pond's level: at the fill line when happy or green; well under the pot's rim when the water is low (the model:
  // a pond left alone falls below the rim in 4.6-8.3 days, about 33 L down)
  let levelMM = drying ? -60 : 0;
  if (o.water !== undefined) levelMM = Math.min(POND.overflowMM, Math.max(POND.lowestMM, o.water));
  let algae = green ? 0.6 : 0;
  if (o.algae !== undefined) algae = o.algae;
  let mudMoisture = drying ? 0.3 : 0.6;
  if (o.moisture !== undefined) mudMoisture = o.moisture;
  let droop = drying && stage !== "jar" && stage !== "floating" ? 0.45 : 0;
  if (o.droop !== undefined) droop = o.droop;
  const crisp = drying ? 0.35 : 0;
  const surface = levelMM / 1000;
  // under the rim the pot holds its own water a few millimetres down from the brim (the "water low" mood: the pond 60
  // mm down, the pot still full); with the pond as low as the pebbles' tops, the pot is taken as dried too
  const rimMM = -POND.rimDepth * 1000;
  const potWaterMM = levelMM < rimMM - 2 ? (levelMM > -POND.pebbleDepth * 1000 - 40 ? rimMM - 3 : null) : null;

  const jar: JarLook = { show: stage === "jar", clarity: green ? 0.45 : drying ? 0.75 : 1, root: 0.5 };
  const jarAt = pondJarInPotFrame();
  const seedAt: V3 = [jarAt[0] - 0.006, jarAt[1] + 0.027, jarAt[2] + 0.004];

  let floating: FloatLeaf[] = [];
  let standing: StandLeaf[] = [];
  if (stage === "floating") floating = pondFloatingLeaves(5, 0.8, levelMM, potWaterMM, 0);
  else if (stage === "pod") floating = pondFloatingLeaves(8, 1, levelMM, potWaterMM, 0);
  else if (stage !== "jar") floating = pondFloatingLeaves(6, 1, levelMM, potWaterMM, 0);
  if (stage === "aerial" || stage === "bud" || stage === "bloom") standing = pondStandingLeaves(2, droop, crisp);
  else if (stage === "pod") standing = pondStandingLeaves(3, droop, crisp);

  const flower: FlowerLook = {
    kind: "none",
    base: [...POND_FLOWER.base],
    head: [...POND_FLOWER.flower.head],
    leanX: POND_FLOWER.flower.leanX,
    leanZ: POND_FLOWER.flower.leanZ,
    open: 0,
    morph: 0,
    day: 0,
    relax: 0,
    blush: 0,
    warmth: 0,
    tepals: 0,
    stigmaWet: 0,
    pollen: 0,
    fallen: 0,
    podSwell: 0,
    podDry: 0,
    neck: drying ? 0.28 : 0,
    scale: 1.2,
  };
  let summary = "";
  let fallen: FallenPetal[] = [];
  if (stage === "bud") {
    flower.kind = "bud";
    flower.head = [...POND_FLOWER.bud.head];
    flower.leanX = POND_FLOWER.bud.leanX;
    flower.blush = 1;
    flower.warmth = o.warmth ?? warmthFor(p.time, 1) * 0.9;
    summary = "Ripe bud over the pond, its tip flushed rose; warm from the night before it opens";
  } else if (stage === "bloom") {
    const c = p.day === "auto" ? autoClock(p.time) : dayClock(p.day, p.time);
    flower.kind = "flower";
    flower.day = c.day;
    flower.open = clamp((o.open ?? c.open) * (drying ? 0.82 : 1));
    const reclosed = c.day >= 1 && flower.open <= 0.06;
    const t = clamp(flower.open / 0.6);
    flower.morph = Math.max(t * t * (3 - 2 * t), reclosed || c.day >= 2 ? RECLOSED_MORPH : 0);
    flower.relax = c.relax;
    flower.warmth = o.warmth ?? warmthFor(p.time, c.day);
    flower.tepals = c.day >= 2 ? 2 : 1;
    flower.stigmaWet = c.day === 1 ? 1 : 0;
    flower.pollen = c.day >= 2 ? 1 : 0;
    flower.fallen = c.fallen;
    summary = c.label;
    if (c.fallen > 0) fallen = pondFallenPetals(c.fallen, levelMM);
  } else if (stage === "pod") {
    flower.kind = "pod";
    flower.head = [...POND_FLOWER.pod.head];
    flower.leanX = POND_FLOWER.pod.leanX;
    flower.podSwell = 0.6;
    flower.podDry = o.podDry ?? 0;
    flower.tepals = 2;
    summary = flower.podDry > 0.5 ? "Seed pod, browning and nodding" : "Green seed pod (about day 5), petals drifting on the pond";
    fallen = pondFallenPetals(4, levelMM);
  } else if (stage === "aerial") {
    summary = "Two standing leaves over the pond, six floating";
  } else if (stage === "floating") {
    summary = "Five floating leaves on the pond, from the pot on the shelf";
  } else {
    summary = jar.clarity < 0.6 ? "Seed in its jar on the coping, the water gone cloudy: time for fresh water" : "Seed in its jar on the coping, its seed of light glowing";
  }
  if (stage === "pod" && flower.podDry > 0) flower.neck += 0.9 * flower.podDry;

  let focus: V3;
  if (stage === "jar") focus = seedAt;
  else if (stage === "floating") focus = [0, surface + 0.08, -0.05];
  else if (stage === "aerial") focus = [standing[0].top[0], standing[0].top[1], standing[0].top[2]];
  else focus = flower.head;

  // a young leaf still rolled, once the plant is making standing leaves (not while the water is low: it waits)
  const rolled: RolledLeaf[] =
    (stage === "aerial" || stage === "bud" || stage === "bloom" || stage === "pod") && !drying
      ? [{ base: POND_ROLLED.base, foot: [POND_ROLLED.foot[0], POND_ROLLED.foot[1] + surface, POND_ROLLED.foot[2]], tip: [POND_ROLLED.tip[0], POND_ROLLED.tip[1] + surface, POND_ROLLED.tip[2]], r: POND_ROLLED.r, seed: POND_ROLLED.seed }]
      : [];
  // dew before sunrise; otherwise a splash's few beads gathered at the navel (from the koi's rings and the top-up)
  const dew = standing.length === 0 ? 0 : p.time === "predawn" ? 9 : 3;

  const moodNote = drying ? ` · the pond ${Math.abs(levelMM)} mm down, the pot's rim out of the water` : green ? ` · green water (${algae.toFixed(2)})` : "";
  return {
    frame: "pond",
    stage,
    jar,
    waterMM: levelMM,
    algae,
    mudMoisture,
    floating,
    standing,
    flower,
    fallen,
    growth: GROWTH[stage],
    focus,
    glowAt: stage === "jar" ? "seed" : flower.kind === "bud" || flower.kind === "flower" ? "head" : "none",
    seedAt,
    mudY: POND_MUD_Y,
    surfaceY: surface,
    potWaterMM,
    rolled,
    dew,
    summary: summary + moodNote,
  };
}

/** True when a floating leaf (pot frame) lies wholly on open water, clear of the coping's lip by `margin`. */
export function onOpenWater(f: FloatLeaf, margin = 0.01): boolean {
  const x = f.x + POND.potX - POND.cx;
  const z = f.z + POND.potZ - POND.cz;
  // the coping's chamfered lip overhangs the tank's walls by POND.lip
  const ax = POND.rx - POND.lip - margin - f.r;
  const az = POND.rz - POND.lip - margin - f.r;
  return Math.abs(x) <= ax && Math.abs(z) <= az && pondRho(x + POND.cx, z + POND.cz) < 1;
}
