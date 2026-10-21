// The watering can's moment in the owner's own flower garden, as timings and geometry (canLive steps it every frame;
// WateringCan, CanShower and the bed's materials draw it). When this page's own Water press reaches a living soil plant
// (lib/client/plant sendCare: the store's canMoment), the old sage can on the lawn lifts, is carried over the kerb to
// the bed's front right with a little of a full can's lag, turns its spout to the stem, tips about its handle and pours
// a fine shower from its rose onto the saucer; it rights itself, lets a last drop or two fall and goes home, lighter
// now, setting down with one small rock. About eight seconds, on the lotus brass pot's rhythm: the tip, the pour and the
// righting each take as long as POUR's (components/lotus/product/timings; a test keeps them matched, neither imports the
// other). The camera never moves for it.
//
// The soil answers when the water lands, not at the press: a dark patch where it falls, the wet running round the
// saucer's ring and creeping up the mound toward the stem, a thin sheet of water in the saucer, all fading into the
// bed's own colour over the next minute. How the soil was before the can is honest in it: thirsty mulch shows the
// darkest patch and drinks the saucer's water within seconds; on damp soil (a can given anyway) the patch is more
// gloss than colour and the water stands for half a minute. Nothing about the plant perks up at once: its leaves firm
// over the next hour, as the card says.
//
// A press the server refuses (or a phone that gives up offline) never pours if the answer comes before the water does
// (on the way out the can goes back the way it came; mid-tip it rights itself), stops the water gently if it comes
// mid-pour, and always eases home: the can never snaps. With reduced motion, on a page that was hidden before it saw the
// press, or with the rain cover over the saucer, the can stays where it is and only the soil answers. The can tips about its rose, as
// a gardener's hand raises the handle, so the spout stays at its pouring point and never reaches into the plant.
//
// Positions are metres in garden space (the hero's stem at the origin, +z toward the camera); a bearing is the angle
// round the stem from +x toward +z. Times are seconds from the press. No React, no DOM, nothing drawn or allocated per
// call: numbers in and out, so the whole moment is tested in node.
import { HERO_GROUND_Y, WATERING_CAN, bedSurfaceY } from "@/lib/garden/dressing";
import type { CanSoil } from "@/lib/garden/store";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Cubic smoothstep from a to b. */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Quintic smootherstep: no jerk at either end, for the carried legs. */
const smoother = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (6 * t - 15) + 10);
};

/**
 * The moment's beats (s from the press). The tip, the pour (flowFrom..flowTo) and the righting (flowTo..rightTo) take
 * exactly as long as the lotus pot's tip, pour and setting back.
 */
export const CAN = {
  /** it rises off the lawn to its carrying height, clear of the kerb's stones before it moves aside, highest by `risen` */
  liftFrom: 0.15,
  lifted: 0.72,
  risen: 1.2,
  /** carried aside over the kerb to where it pours */
  carryFrom: 0.6,
  carryTo: 1.85,
  /** it leans in toward the stem as it arrives (the lotus pot's 0.15 rad), then tips */
  leanFrom: 1.2,
  tipFrom: 1.8,
  tipTo: 2.7,
  /** the water: a few heavier drops first, the full shower, the last of it */
  flowFrom: 2.7,
  flowTo: 4.9,
  /** the first drops reach the soil */
  lands: 2.85,
  /** upright again */
  rightTo: 6.2,
  /** home, the carry in reverse, and set down */
  homeFrom: 6.0,
  homeTo: 7.4,
  downTo: 7.85,
  /** the set-down's one rock has died away */
  still: 8.3,
} as const;

/** How far the can tips to pour, about its handle's top (rad); a seed's mound gets a gentler pour. */
export const TIP = 1.0;
const SEED_TIP = 0.9;
/** The lean toward the stem as it arrives (rad), and how much further it tips as it empties. */
const LEAN_IN = 0.15;
const CREEP = 0.08;
/**
 * The hand's height over its resting place while carried (m): the can's foot then clears the kerb's stones (tops about
 * 0.10-0.14 m) with room to spare, so it rises toward it before it moves aside, and comes home at it before it is set
 * down. It arcs this much higher on the way out (m); the height varies a little from press to press (Vary.lift).
 */
const CRUISE = 0.16;
const ARC_OUT = 0.04;
/** The one rock as it is set down (rad), how soon it turns (s) and how fast it dies away (/s). */
const ROCK = 0.0175;
const ROCK_HALF = 0.16;
const ROCK_DECAY = 7;
/** The water leaves the rose at this speed (m/s); gravity (m/s^2). */
export const EXIT_SPEED = 0.7;
export const GRAVITY = 9.8;
/** The water stops being poured this long before the flow is gone (the lotus pour's last-of-it), s. */
const FADE_OUT = 0.35;

// ---------------------------------------------------------------------------------------------------------------------
// The can's own frame: its base at the origin, the spout toward +x, as WATERING_CAN scales it

const S = WATERING_CAN.scale;
/** Where a hand would hold it, the top of the handle's arch: the pivot it hangs, swings and tips about. */
export const CAN_HAND = { x: -0.018 * S, y: 0.215 * S } as const;
/** The rose's face (the spout's end, pointing out at 45 degrees up when the can stands). */
export const CAN_ROSE = { x: 0.247 * S, y: 0.197 * S } as const;
/** The lowest point of the rose's rim while it is tipped or righting, where the last drops swell and fall. */
export const CAN_DRIP = { x: CAN_ROSE.x + 0.019 * S * 0.62, y: CAN_ROSE.y - 0.019 * S * 0.62 } as const;
/** The middle of the can's body, for its contact shadow. */
export const CAN_BODY = { x: 0, y: 0.075 * S } as const;
/** The can's widest radius (m), for clearances. */
export const CAN_RADIUS = 0.076 * S;

/** The rose and the drip point measured from the hand. */
const RX = CAN_ROSE.x - CAN_HAND.x;
const RY = CAN_ROSE.y - CAN_HAND.y;

/** The hand where the can stands on the lawn, and its turn there. */
export const REST_YAW = WATERING_CAN.yaw;
export const REST_HAND = {
  x: WATERING_CAN.x + CAN_HAND.x * Math.cos(REST_YAW),
  y: CAN_HAND.y,
  z: WATERING_CAN.z - CAN_HAND.x * Math.sin(REST_YAW),
} as const;

export interface CanPose {
  /** the hand (the handle's top, the can's pivot), world */
  x: number;
  y: number;
  z: number;
  /** turn about the vertical (the spout along local +x), as three's rotation.y */
  yaw: number;
  /** tip about the hand, spout down (rad) */
  tilt: number;
  /** a sideways swing about the spout's line (rad; three's rotation.x, after the tip): a carried can's lag */
  roll: number;
  /** the water from the rose, 0 none .. 1 full */
  flow: number;
  /** how far the hand stands above its resting height (m): the can is off the lawn */
  lift: number;
}

export function restPose(out: CanPose): CanPose {
  out.x = REST_HAND.x;
  out.y = REST_HAND.y;
  out.z = REST_HAND.z;
  out.yaw = REST_YAW;
  out.tilt = 0;
  out.roll = 0;
  out.flow = 0;
  out.lift = 0;
  return out;
}

export const newPose = (): CanPose => restPose({ x: 0, y: 0, z: 0, yaw: 0, tilt: 0, roll: 0, flow: 0, lift: 0 });

/**
 * A point given in the can's frame (base at the origin, spout toward +x; `pz` across it) in world space, for a pose:
 * the tip about the hand, then the sideways swing, then the turn (three's Euler order YXZ: rotation (roll, yaw, -tilt)).
 */
export function canPoint(p: CanPose, px: number, py: number, out: { x: number; y: number; z: number }, pz = 0) {
  const c = Math.cos(p.tilt);
  const s = Math.sin(p.tilt);
  const dx = px - CAN_HAND.x;
  const dy = py - CAN_HAND.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  const ry = ly * cr - pz * sr;
  const rz = ly * sr + pz * cr;
  out.x = p.x + lx * Math.cos(p.yaw) + rz * Math.sin(p.yaw);
  out.y = p.y + ry;
  out.z = p.z - lx * Math.sin(p.yaw) + rz * Math.cos(p.yaw);
  return out;
}

/** The direction the water leaves the rose for a pose (unit): along the spout's end, 45 degrees up when standing. */
export function exitDir(p: CanPose, out: { x: number; y: number; z: number }) {
  const a = Math.PI / 4 - p.tilt;
  const h = Math.cos(a);
  out.x = h * Math.cos(p.yaw);
  out.y = Math.sin(a);
  out.z = -h * Math.sin(p.yaw);
  return out;
}

/** How far out (m, level) water leaving the rose at `tilt` lands, `fall` metres below it. */
export function reachOf(fall: number, tilt: number): number {
  const a = Math.PI / 4 - tilt;
  const vy = EXIT_SPEED * Math.sin(a);
  const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, fall))) / GRAVITY;
  return EXIT_SPEED * Math.cos(a) * t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Where it pours

/** The saucer's ring round the stem (m): where the water lands for a growing plant. */
export const SAUCER_RING = 0.17;
/** On a seed's mound the water lands just off its crown (m from the stem). */
const MOUND_LAND = 0.03;
/** The seed's mound: its height (m) and the growth by which it has settled away (SeedMound). */
const MOUND_HEIGHT = 0.022;
const MOUND_FROM = 0.03;
const MOUND_GONE = 0.075;
/** The rose's height over the landing (m), raised over a grown plant's skirt of low leaves. */
const FALL = 0.15;
const FALL_OVER_SKIRT = 0.17;
/**
 * The bearings the can may pour from: the bed's front-right quarter, which the side canes never lean into
 * (HeroBush leans them to the sides and back) and where the bed's front is narrow enough for the can to stand on the
 * lawn in front of it. Chosen once at the press on the viewer's side, this far round from the camera.
 */
const BEARING_MIN = 0.49;
const BEARING_MAX = 0.98;
const BEARING_FROM_VIEW = 0.77;

/** How far a grown plant's skirt of low leaves has spread (HeroBush), 0 a seedling .. 1 full. */
export function skirtOf(growth: number): number {
  const t = smooth(0.06, 0.6, growth);
  const ease = 1 - (1 - t) ** 3;
  return smooth(0.04, 0.1, growth) * lerp(0.42, 1, ease);
}

/** How much of the seed's mound still stands (SeedMound), 1 just planted .. 0 settled away. */
export const moundOf = (growth: number) => 1 - smooth(MOUND_FROM, MOUND_GONE, growth);

export interface Station {
  /** the landing's bearing as the shower starts, and how far round the saucer it sweeps while pouring (rad) */
  bearing: number;
  sweep: number;
  /** the landing's distance from the stem and its height (m) */
  r: number;
  y: number;
  /** the rose's height over the landing (m) */
  fall: number;
  /** the tip it pours at (rad) */
  tip: number;
  /** the water lands on a seed's mound (its light breathes as the water reaches it) */
  seed: boolean;
  /** how far the skirt has spread over the saucer, 0..1 (the leaves shiver as the drops land on them) */
  skirt: number;
}

/**
 * Where this press pours: the bearing on the viewer's side of the clear front-right quarter (`view`, the camera's own
 * bearing round the stem), kept so the whole sweep stays inside it; the landing on the saucer or, for a seed, on its
 * mound; the rose high enough to clear a grown plant's low leaves. Chosen once, at the press.
 */
export function stationFor(growth: number, view: number, sweep: number): Station {
  const lo = BEARING_MIN - Math.min(0, sweep);
  const hi = BEARING_MAX - Math.max(0, sweep);
  const bearing = Math.min(hi, Math.max(lo, normAngle(view - BEARING_FROM_VIEW)));
  const mound = moundOf(growth);
  const seed = mound > 0.5;
  const skirt = skirtOf(growth);
  const r = seed ? MOUND_LAND : SAUCER_RING;
  const mid = bearing + sweep / 2;
  const y = seed ? HERO_GROUND_Y + MOUND_HEIGHT * mound + 0.002 : bedSurfaceY(r * Math.cos(mid), r * Math.sin(mid));
  return { bearing, sweep, r, y, fall: FALL + FALL_OVER_SKIRT * skirt, tip: seed ? SEED_TIP : TIP, seed, skirt };
}

/** An angle folded into [-PI, PI). */
function normAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * The can's hand at bearing `b` tipped to `tilt`, with its rose at the pouring point: over the landing, a flight's reach
 * out from it, the station's fall above it. The can stands radially outside, spout in, and tips about its rose as a
 * gardener's hand does (the handle rises), so an upright can never reaches its spout into the plant. Into `out`.
 */
function stationHand(st: Station, b: number, tilt: number, out: { x: number; y: number; z: number }) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const rx = RX * c + RY * s;
  const ry = -RX * s + RY * c;
  const R = st.r + reachOf(st.fall, st.tip) + rx;
  out.x = R * Math.cos(b);
  out.z = R * Math.sin(b);
  // nearly upright (before the tip, as it is righted) the can stands over the kerb: its foot's lowest edge is held
  // clear of the stones and the leaves over them, and the rose rises with it; the floor eases away as it tips
  const floor = FOOT_CLEAR - FOOT_LOW.y * c + FOOT_LOW.x * s;
  const y = st.y + st.fall - ry;
  out.y = (y + floor + Math.sqrt((y - floor) * (y - floor) + 0.0009)) / 2;
}

/**
 * At the station the can's foot keeps this high over the ground (m): clear of the front-right kerb's stone tops (about
 * 0.10-0.14 m) and of the hosta and fern leaves that spill over them. FOOT_LOW is the front of its foot's rim from the
 * hand, the lowest point of the body as it tips.
 */
const FOOT_CLEAR = 0.28;
const FOOT_LOW = { x: -CAN_HAND.x + CAN_RADIUS, y: -CAN_HAND.y } as const;

/** The turn (rotation.y) that points the spout at the stem from bearing `b`. */
const yawAt = (b: number) => Math.PI - b;

// ---------------------------------------------------------------------------------------------------------------------
// One press: where, how it varies, and whether it was stopped

/** What changes a little from one press to the next, so no two waterings look quite alike. */
export interface Vary {
  /** the sweep round the saucer while pouring (rad, signed) */
  sweep: number;
  /** the carrying height, as a share of CRUISE */
  lift: number;
  /** a full can's lag as it sets off (rad); the empty can's is two thirds of it */
  trail: number;
  /** when the last drops fall (s, from the press, for a pour that ran to its end) */
  drips: readonly number[];
}

/** A press's own variation, from its time stamp: the same every time for the same press. */
export function varyOf(at: number): Vary {
  let x = (Math.floor(Math.abs(at)) % 2147483647) | 0 || 1;
  const next = () => {
    // mulberry32
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dir = next() < 0.5 ? -1 : 1;
  const sweep = dir * (0.3 + 0.08 * next());
  const lift = 0.9 + 0.2 * next();
  const trail = 0.046 + 0.008 * next();
  const count = 2 + Math.floor(next() * 3);
  const drips = [5.3, 5.8, 6.5, 7.05].slice(0, count).map((t) => t + (next() - 0.5) * 0.16);
  return { sweep, lift, trail, drips };
}

export interface CanPlan {
  station: Station;
  vary: Vary;
  /**
   * the can stays where it is and only the soil answers (reduced motion, a page hidden before it saw the press, the rain
   * cover over the saucer)
   */
  still: boolean;
  /** when the server refused the press (s), or -1: the water that landed fades and the can goes home */
  refusedAt: number;
  /** when the can was sent home early without refusal (s; the rain cover went up or came down), or -1 */
  stoppedAt: number;
}

/** When the can was told to stop (s), or -1. */
const stopOf = (p: CanPlan) => (p.refusedAt >= 0 ? (p.stoppedAt >= 0 ? Math.min(p.refusedAt, p.stoppedAt) : p.refusedAt) : p.stoppedAt);

/** Stopped before it tipped: the can goes back the way it came. */
function turnedBack(p: CanPlan): boolean {
  const s = stopOf(p);
  return s >= 0 && s < CAN.tipFrom;
}

/** Stopped before any water left the rose (on the way, or while it tipped): this press pours none and drips none. */
function dry(p: CanPlan): boolean {
  const s = stopOf(p);
  return s >= 0 && s < CAN.flowFrom;
}

/** When the water stops being poured (s): an early stop's moment, else the pour's own last-of-it. */
function pourStop(p: CanPlan): number {
  const s = stopOf(p);
  const own = CAN.flowTo - FADE_OUT;
  return s >= CAN.tipFrom && s < own ? s : own;
}

/** When the water stops being poured (s; it fades over FADE_OUT after), or -1 when this press pours none. */
export function pourEndOf(p: CanPlan): number {
  return p.still || dry(p) ? -1 : pourStop(p);
}

/** The water fades out over this long once it stops being poured (s). */
export const POUR_FADE = FADE_OUT;

/** The trip back after a stop before the tip (s): its way out played in reverse, unhurried. */
const backFor = (stop: number) => Math.max(0.4, 1.25 * (stop - CAN.liftFrom));

/** When the can starts home (s). */
function homeFrom(p: CanPlan): number {
  return pourStop(p) + FADE_OUT + (CAN.homeFrom - CAN.flowTo);
}

/** The moment the can touches the lawn again (s). */
function touchdown(p: CanPlan): number {
  if (turnedBack(p)) {
    const s = stopOf(p);
    return s + backFor(s);
  }
  return homeFrom(p) + (CAN.downTo - CAN.homeFrom);
}

/** When the can is still again on its own spot (s); 0 for a still moment. */
export function canStillAt(p: CanPlan): number {
  if (p.still) return 0;
  const s = stopOf(p);
  if (s >= 0 && s < CAN.liftFrom) return s;
  return touchdown(p) + (CAN.still - CAN.downTo);
}

/** A full can's lag through a carried leg (0 at both ends): its body trails as it sets off and swings on as it stops. */
function pendulum(p: number): number {
  const u = clamp01(p);
  // the acceleration of a quintic ease, which is what a hung weight answers: zero at both ends, peaks near a fifth in
  return (u * (1 - u) * (1 - 2 * u)) / 0.0962;
}

/** How far the can is tipped toward pouring at `x` s (before the righting): leaning in as it arrives, then tipping. */
const tipAt = (st: Station, x: number) => LEAN_IN * smooth(CAN.leanFrom, CAN.tipFrom, x) + (st.tip - LEAN_IN) * smooth(CAN.tipFrom, CAN.tipTo, x);

/** A full can's lag at `x` s on the way out. */
const carryLag = (trail: number, x: number) => trail * pendulum((x - CAN.carryFrom) / (CAN.carryTo - CAN.carryFrom));

/** Scratch for the station's hand (module level, so a pose allocates nothing). */
const hand = { x: 0, y: 0, z: 0 };

/**
 * The way out at time `x`: up off the lawn to its carrying height `cruise`, clear of the kerb, before it moves aside;
 * over the kerb to the bed, arcing to `peak` and settling onto the station's hand (sx, sy, sz). Into `out`.
 */
function outbound(out: CanPose, bearing: number, sx: number, sy: number, sz: number, cruise: number, peak: number, x: number) {
  const u = smoother(CAN.carryFrom, CAN.carryTo, x);
  out.x = lerp(REST_HAND.x, sx, u);
  out.z = lerp(REST_HAND.z, sz, u);
  out.y =
    REST_HAND.y +
    (cruise - REST_HAND.y) * smooth(CAN.liftFrom, CAN.lifted, x) +
    (peak - cruise) * smooth(CAN.carryFrom, CAN.risen, x) +
    (sy - peak) * smooth(CAN.risen, CAN.carryTo, x);
  out.yaw = lerp(REST_YAW, yawAt(bearing), u);
}

/** The landing's bearing at `t` (s): round the saucer with the sweep while pouring, held once the water stops. */
export function bearingAt(p: CanPlan, t: number): number {
  const st = p.station;
  return st.bearing + st.sweep * smooth(CAN.flowFrom + 0.1, CAN.flowTo - 0.1, Math.min(t, pourStop(p)));
}

/** The water from the rose `t` s after the press, 0..1. */
export function flowOf(p: CanPlan, t: number): number {
  if (p.still || dry(p) || !(t >= 0)) return 0;
  const stop = pourStop(p);
  return smooth(CAN.flowFrom, CAN.flowFrom + 0.25, t) * (1 - smooth(stop, stop + FADE_OUT, t));
}

/** The can's pose `t` s after the press (at rest outside the moment). Allocates nothing. */
export function canPose(p: CanPlan, t: number, out: CanPose): CanPose {
  if (p.still || !(t >= 0) || t >= canStillAt(p)) return restPose(out);
  const st = p.station;
  const v = p.vary;
  const cruise = REST_HAND.y + CRUISE * v.lift;
  // where the carry ends: the can almost upright at the station (it tips there about its rose)
  stationHand(st, st.bearing, tipAt(st, CAN.carryTo), hand);
  const sx = hand.x;
  const sy = hand.y;
  const sz = hand.z;
  const peak = Math.max(sy, cruise) + ARC_OUT;
  const home = v.trail * (2 / 3);

  let tilt: number;
  // a carried can's lag (rad) and the level direction it is being carried in (the body swings against it)
  let lag = 0;
  let dx = sx - REST_HAND.x;
  let dz = sz - REST_HAND.z;
  if (turnedBack(p)) {
    // stopped on the way out: its way out played back from wherever it had got, onto the lawn
    const s = stopOf(p);
    const x = t < s ? t : lerp(s, CAN.liftFrom, smooth(s, s + backFor(s), t));
    outbound(out, st.bearing, sx, sy, sz, cruise, peak, x);
    tilt = tipAt(st, x);
    // the lag it had eases away as it turns back
    lag = t < s ? carryLag(v.trail, t) : carryLag(v.trail, s) * (1 - smooth(s, s + 0.5, t));
  } else {
    const stop = pourStop(p);
    const h0 = homeFrom(p);
    const h1 = h0 + (CAN.homeTo - CAN.homeFrom);
    const right = 1 - smooth(stop + FADE_OUT, stop + FADE_OUT + (CAN.rightTo - CAN.flowTo), t);
    tilt = (tipAt(st, Math.min(t, stop)) + CREEP * smooth(CAN.flowFrom, CAN.flowTo, Math.min(t, stop))) * right;
    if (t < CAN.carryTo) {
      outbound(out, st.bearing, sx, sy, sz, cruise, peak, t);
      lag = carryLag(v.trail, t);
    } else if (t < h0) {
      // at the station: tipping about the rose, the hand following the landing round the saucer while it pours
      const b = bearingAt(p, t);
      stationHand(st, b, tilt, hand);
      out.x = hand.x;
      out.y = hand.y;
      out.z = hand.z;
      out.yaw = yawAt(b);
    } else {
      // home, lighter: up clear of the plant, aside at the carrying height over the kerb, then down onto the lawn
      const b = bearingAt(p, t);
      stationHand(st, b, tilt, hand);
      const ph = smoother(h0, h1, t);
      const down = h1 + (CAN.downTo - CAN.homeTo);
      const top = Math.max(hand.y, cruise) + ARC_OUT;
      out.x = lerp(hand.x, REST_HAND.x, ph);
      out.z = lerp(hand.z, REST_HAND.z, ph);
      out.y =
        hand.y +
        (top - hand.y) * smooth(h0, h0 + 0.5, t) +
        (cruise - top) * smooth(h0 + 0.5, h1 - 0.3, t) +
        (REST_HAND.y - cruise) * smooth(h1 - 0.3, down, t);
      out.yaw = lerp(yawAt(b), REST_YAW, ph);
      dx = REST_HAND.x - hand.x;
      dz = REST_HAND.z - hand.z;
      lag = home * pendulum((t - h0) / (h1 - h0));
    }
  }
  // The body hangs back against the carry: along the spout that is a dip of the spout (more tip), across it a sideways
  // swing about the spout's line. The can's local x (the spout) is (cos yaw, -sin yaw), its local z (sin yaw, cos yaw).
  const len = Math.hypot(dx, dz) || 1;
  const along = (dx * Math.cos(out.yaw) - dz * Math.sin(out.yaw)) / len;
  const across = (dx * Math.sin(out.yaw) + dz * Math.cos(out.yaw)) / len;
  // set down with one small rock, dying away
  const touch = touchdown(p);
  const rock = t > touch ? ROCK * Math.sin((Math.PI * (t - touch)) / ROCK_HALF) * Math.exp(-(t - touch) * ROCK_DECAY) : 0;
  out.tilt = tilt + lag * along + rock;
  out.roll = lag * across;
  out.flow = flowOf(p, t);
  out.lift = Math.max(0, out.y - REST_HAND.y);
  return out;
}

/** When each of the last drops is let go from the rose (s); none for a can that poured nothing. */
export function dripTimes(p: CanPlan): number[] {
  if (p.still || dry(p)) return [];
  const shift = pourStop(p) - (CAN.flowTo - FADE_OUT);
  return p.vary.drips.map((t) => t + shift);
}

// ---------------------------------------------------------------------------------------------------------------------
// The soil's answer

interface SoilLook {
  /** the dark patch where the water lands, and the wet in the saucer's ring (strength 0..1) */
  patch: number;
  ring: number;
  /** how much of the patch is colour (the rest is gloss): thirsty mulch darkens most, damp soil mostly shines */
  tone: number;
  gloss: number;
  /** the water standing in the saucer: its peak, when it is reached and when it drains (s after landing) */
  pool: number;
  rise: number;
  drainFrom: number;
  drainTo: number;
}

const SOIL: Record<CanSoil, SoilLook> = {
  thirsty: { patch: 1, ring: 0.75, tone: 1, gloss: 0.55, pool: 0.32, rise: 2, drainFrom: 2, drainTo: 7.2 },
  ok: { patch: 0.8, ring: 0.6, tone: 0.8, gloss: 0.75, pool: 0.62, rise: 3.15, drainFrom: 4.2, drainTo: 15.2 },
  damp: { patch: 0.6, ring: 0.45, tone: 0.35, gloss: 1, pool: 0.85, rise: 3.65, drainFrom: 27, drainTo: 42 },
};

/** When the water reaches the soil (s), or Infinity when none does (a press refused before any water left the can). */
export function landsAt(p: CanPlan): number {
  if (p.still) return 0.4;
  if (!dry(p)) return CAN.lands;
  // the can was sent home (a cover moved) before any water left it: the water is still the plant's, and the soil answers
  // as it does when the can stays home; a refusal that came only after that water landed lets it fade (soilAt)
  if (p.stoppedAt >= 0 && (p.refusedAt < 0 || p.refusedAt >= p.stoppedAt + 0.4)) return p.stoppedAt + 0.4;
  return Infinity;
}

export interface SoilAnswer {
  /** the drawn moisture is held where it was until the water lands */
  holding: boolean;
  /** the landing patch (strength 0..1), the wet in the saucer's ring (strength, and how far round it has run, rad) */
  patch: number;
  ring: number;
  ringHalf: number;
  /** the wet creeping up the mound toward the stem, 0..1 */
  creep: number;
  tone: number;
  gloss: number;
  /** water standing in the saucer, 0..1 (as the weather's puddle), and how far round it has run (rad) */
  pool: number;
  poolHalf: number;
  /** the can's own gloss where the water ran down it, 0..1 */
  canWet: number;
  /** the seed's light takes one deeper breath as the water reaches it, 0..1 */
  breath: number;
  /** the low leaves shiver as the drops land on them, 0..1 */
  shiver: number;
}

export const newSoil = (): SoilAnswer => ({
  holding: false, patch: 0, ring: 0, ringHalf: 0, creep: 0, tone: 0, gloss: 0, pool: 0, poolHalf: Math.PI, canWet: 0, breath: 0, shiver: 0,
});

/** The soil's answer `t` s after the press, for the soil as it was before the can (`soil`). */
export function soilAt(p: CanPlan, soil: CanSoil, t: number, out: SoilAnswer): SoilAnswer {
  const land = landsAt(p);
  const look = SOIL[soil];
  const refused = p.refusedAt >= 0;
  const fade = refused ? 1 - smooth(p.refusedAt, p.refusedAt + 3, t) : 1;
  out.holding = !refused && t >= 0 && t < land;
  if (!(t >= 0) || !Number.isFinite(land)) {
    out.patch = out.ring = out.creep = out.pool = out.canWet = out.breath = out.shiver = 0;
    out.ringHalf = 0;
    out.poolHalf = Math.PI;
    out.tone = look.tone;
    out.gloss = look.gloss;
    return out;
  }
  // the soil alone (the can stayed home, or was sent home dry): it answers sooner and quicker
  const quick = p.still || dry(p);
  const spread = quick ? 1.5 : CAN.flowTo - CAN.lands;
  const round = quick ? 1.2 : 3.5;
  // the patch and the ring blend into the bed's own colour over the next minute
  const blend = 1 - smooth(land + 27, land + 47, t);
  out.patch = look.patch * smooth(land, land + spread, t) * blend * fade;
  out.ring = look.ring * smooth(land, land + 0.4, t) * blend * fade;
  out.ringHalf = lerp(0.12, Math.PI, smooth(land + 0.15, land + round, t)) * smooth(land, land + 0.25, t);
  out.creep = (quick ? smooth(land + 0.6, land + 3, t) : smooth(land + 2.15, land + 7.15, t)) * blend * fade;
  out.tone = look.tone;
  out.gloss = look.gloss;
  const rise = quick ? 1.2 : look.rise;
  out.pool = look.pool * smooth(land + 0.15, land + rise, t) * (1 - smooth(land + look.drainFrom, land + look.drainTo, t)) * fade;
  out.poolHalf = out.ringHalf;
  // the can shines where its water ran down it; one that stayed home takes the look of a can just used, which a refusal
  // takes back
  out.canWet = (quick ? smooth(land, land + 0.6, t) * fade : smooth(CAN.flowFrom, CAN.flowFrom + 0.4, t)) * (1 - smooth(10, 60, t));
  out.breath = p.station.seed ? smooth(land, land + 0.6, t) * (1 - smooth(land + 0.6, land + 2.6, t)) * fade : 0;
  // the drops reach the leaves a flight after they leave the rose
  out.shiver = p.station.skirt * flowOf(p, t - 0.16);
  return out;
}

/** The moment is over (s from the press): the can is home and the soil has blended back into the bed. */
export function momentOver(p: CanPlan): number {
  const land = landsAt(p);
  return Math.max(canStillAt(p), Number.isFinite(land) ? land + 50 : 0, p.refusedAt >= 0 ? p.refusedAt + 3.5 : 0, 60);
}

// ---------------------------------------------------------------------------------------------------------------------
// The covers

/** The rain cover's tunnel (BedCovers): half-width and depth for a height of 1, centred this far behind the plant. */
const COVER_HALF_WIDTH = 0.44 * 1.07;
const COVER_FRONT = 0.62 * 0.5 * 1.07 - 0.16;
/** Its domed end panes bulge this far past the hoops (share of its height), and the clear margin the water needs (m). */
const COVER_DOME = 0.06;
const COVER_MARGIN = 0.015;

/** The tunnel's height for a plant whose head stands `head` metres over its mound (BedCovers). */
export const coverSize = (head: number) => Math.min(1.34, Math.max(0.26, head + 0.13));

/**
 * The closed rain cover stands over where the can would pour: the landing or the rose is inside its footprint. The
 * shade cloth never stops the can: it is open at the front and the spout reaches in under its hem.
 */
export function coverInTheWay(st: Station, head: number): boolean {
  const size = coverSize(head);
  const hw = COVER_HALF_WIDTH * size + COVER_MARGIN;
  const front = (COVER_FRONT + COVER_DOME) * size + COVER_MARGIN;
  const inside = (r: number, b: number) => Math.abs(r * Math.cos(b)) < hw && r * Math.sin(b) < front;
  const mid = st.bearing + st.sweep / 2;
  // the landing, and the rose a flight's reach further out (the spout and the can are further out still)
  return inside(st.r, mid) || inside(st.r + reachOf(st.fall, st.tip), mid);
}
