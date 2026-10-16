// The Lantern Cart's dimensions and tuning, kept apart from the Rapier code
// in vehicle.ts so that the placeholder body (and the glide fallback, which
// draws the same lantern) can read them without pulling the physics build
// into the main bundle. Values are the folio cart at half scale unless a
// comment says why they moved.
// Approach adapted from Bruno Simon's folio-2025 (MIT): Physics/PhysicsVehicle.js.

export const CHASSIS = {
  half: [0.65, 0.2, 0.43] as [number, number, number],
  mass: 2.5,
  /** Low centre of mass: the cart wants to land on its wheels. */
  centerOfMass: { x: 0, y: -0.25, z: 0 },
  inertia: 0.25,
  friction: 0.4,
} as const;

export const WHEEL = {
  radius: 0.2,
  offset: { x: 0.45, y: 0, z: 0.38 },
  frictionSlip: 0.9,
  sideFrictionStiffness: 3,
  suspensionCompression: 10,
  suspensionRelaxation: 2.7,
  maxSuspensionTravel: 1,
  maxSuspensionForce: 150,
} as const;

export type SuspensionState = "low" | "mid" | "hop";
export const SUSPENSION: Record<SuspensionState, { rest: number; stiffness: number }> = {
  low: { rest: 0.44, stiffness: 40 },
  mid: { rest: 0.62, stiffness: 60 },
  hop: { rest: 0.82, stiffness: 80 },
};
export const RIDE: SuspensionState = "mid";

/**
 * Per wheel, per fixed step. Measured on flat ground, a brake of b decelerates
 * the cart by about 96*b m/s^2 until the tyres saturate near 13 m/s^2.
 * The engine is 6 rather than the 10 of a straight half-scale port: at 10 the
 * cart reached 5 m/s in a third of a second, which reads as twitchy. The idle
 * brake is the folio's own 0.035 rather than 0.07: letting go at 5 m/s then
 * rolls out over about a metre and a half instead of stopping short.
 */
export const DRIVE = {
  engine: 6,
  brake: 1.17,
  idleBrake: 0.035,
  reverseBrake: 0.47,
  /** above this the engine force fades as force / (1 + overspeed), and to nothing 0.5 m/s later */
  topSpeed: 5,
  /** a cart backs up at a walking pace */
  reverseTopSpeed: 2.2,
  /** overspeed over which the engine fades out completely, m/s */
  limiterBand: 0.5,
  steerAtRest: 0.5,
  steerAtTop: 0.28,
  hopSeconds: 0.15,
} as const;

export const RECOVERY = {
  /** seconds upside down before the righting kick, repeated until it works */
  upsideDownAfter: 2,
  /** the up/down tilt (0 upright, 0.5 on its side, 1 on its roof) that counts as upside down */
  upsideDownRatio: 0.3,
  impulse: 5,
  /**
   * Roll kick per unit mass. 0.4 (the half-scale port) turned a cart on its
   * roof only about 115 degrees in the air, so it landed on its side and
   * needed two more kicks; 0.55 lands it on its wheels from the roof, and the
   * side case uses the full value rather than half so one kick rolls it back.
   */
  torque: 0.55,
  sideTorque: 0.4,
} as const;

export const WHEELBASE = WHEEL.offset.x * 2;
/** Chassis height when resting on the default ride, for spawning just above the ground. */
export const SPAWN_HEIGHT = SUSPENSION[RIDE].rest + WHEEL.radius + 0.12;
