// What the doe does on the concept page: a scripted visit, step by step, turned into the animator's intent every
// frame. The garden visit is the design discussed for the product: she comes in through the low corridor on the left
// at the evening sun's bearing, walks along the back of the garden side-on to the camera, grazes, lifts her head to
// look toward the flower, browses the hedge, and walks on behind the bed and out under the arch. A portrait phone's frame
// is only about 2.3 m wide back there, so on a tall screen she comes in only as far as its left edge, turned three-
// quarters toward the viewer, and leaves the way she came. Everything here is in the garden's plan
// (lib/garden/layout.ts: metres, the hero at the origin, the default camera toward -z).
import * as THREE from "three";
import type { DoeAnimator, DoeIntent } from "@/components/deer/motion";
import type { DeerStation } from "@/components/deer/stations";

export type Act = "visit" | "arrive" | "tour" | "stand" | "graze" | "walk" | "browse";

type Step =
  | { kind: "walk"; to: readonly [number, number]; speed?: number }
  | { kind: "stand"; secs: number }
  | { kind: "graze"; secs: number }
  | { kind: "look"; secs: number }
  | { kind: "browse"; secs: number; face: number };

/**
 * Off frame in the west corridor, and the station on the back lawn where she grazes, side-on to the camera: in open
 * view against the dark hedge, clear of the lantern post (which, from the garden's own camera, would otherwise stand
 * across her shoulder with the lamp on her head).
 */
export const ENTRY = [-4.7, -1.1] as const;
export const STATION = [-2.1, -1.75] as const;
/** On a tall screen: just inside the frame's left edge, beside the lantern, never behind the bloom. */
export const STATION_TALL = [-0.95, -1.95] as const;
/** Turned three-quarters toward the viewer (heading toward +z is negative). */
const TO_VIEWER = -0.6;
/** Three-quarters toward the left-back hedge's face to browse it, her neck and ears still in profile (she faces +x at 0, turning toward -z as it grows). */
const TO_HEDGE = 0.9;

interface Plan {
  start: readonly [number, number];
  heading: number;
  steps: Step[];
  /** A visit's other way out: on behind the bed and out under the arch, for when the camera has come round west. */
  back?: Step[];
}
type Tours = Record<Act, Plan>;

/**
 * The visit as the garden shows it (lib/garden/deerDays decides the day): she is already there, grazing at the edge of
 * the garden, when it comes into focus; she grazes, lifts her head to look toward the flower, grazes on and browses the
 * hedge, looks once more, and walks out through the corridor she came by. About a minute; it does not loop.
 */
const VISIT: Step[] = [
  { kind: "graze", secs: 18 },
  { kind: "look", secs: 4.5 },
  { kind: "graze", secs: 14 },
  { kind: "browse", secs: 6, face: TO_HEDGE },
  { kind: "look", secs: 3 },
  { kind: "walk", to: [-3.2, -1.62] },
  { kind: "walk", to: ENTRY },
];
/** Away from the hedge: grazing and looking only. */
const visitInTheOpen = (out: readonly [number, number]): Step[] => [
  { kind: "graze", secs: 16 },
  { kind: "look", secs: 4.5 },
  { kind: "graze", secs: 12 },
  { kind: "look", secs: 3 },
  { kind: "walk", to: out },
  { kind: "walk", to: ENTRY },
];
/** Behind the bed and out under the arch (the concept tour's way out). */
const UNDER_ARCH: Step[] = [
  { kind: "walk", to: [-0.45, -2.1] },
  { kind: "walk", to: [0.55, -2.35] },
  { kind: "walk", to: [1.35, -3.4] },
  { kind: "walk", to: [1.9, -4.6] },
];

/** Each station of the garden's visit (components/deer/stations decides which). */
const VISITS: Record<DeerStation, Plan> = {
  // a little toward the viewer, so her four legs read apart and a little of her face shows
  back: { start: STATION, heading: -0.2, steps: VISIT, back: UNDER_ARCH },
  backLeft: { start: [-2.25, -1.65], heading: -0.2, steps: VISIT, back: UNDER_ARCH },
  backNear: { start: [-2.25, -1.45], heading: -0.6, steps: VISIT, back: UNDER_ARCH },
  // back from the lantern before she turns east, clear of the bed's corner
  lawn: { start: [-1.75, -1.05], heading: -0.9, steps: visitInTheOpen([-3.1, -1.35]), back: [{ kind: "walk", to: [-2.0, -1.9] }, ...UNDER_ARCH] },
  portrait: { start: [-0.8, -1.95], heading: -1.2, steps: visitInTheOpen([-3.0, -1.6]), back: UNDER_ARCH },
};

/** The tall screens' visit: in and out through the corridor, so she never crosses behind the bloom. */
const TALL: Partial<Tours> = {
  visit: {
    start: STATION_TALL,
    heading: TO_VIEWER,
    steps: [
      { kind: "graze", secs: 16 },
      { kind: "look", secs: 4.5 },
      { kind: "graze", secs: 12 },
      { kind: "look", secs: 3 },
      { kind: "walk", to: [-3.0, -1.6] },
      { kind: "walk", to: ENTRY },
    ],
  },
  tour: {
    start: ENTRY,
    heading: -0.25,
    steps: [
      { kind: "walk", to: [-3.0, -1.6] },
      { kind: "walk", to: STATION_TALL },
      { kind: "stand", secs: 1.5 },
      { kind: "graze", secs: 9 },
      { kind: "browse", secs: 3, face: TO_VIEWER },
      { kind: "look", secs: 4.5 },
      { kind: "graze", secs: 6 },
      { kind: "walk", to: [-3.0, -1.6] },
      { kind: "walk", to: ENTRY },
    ],
  },
  stand: { start: STATION_TALL, heading: TO_VIEWER, steps: [{ kind: "stand", secs: 8 }, { kind: "look", secs: 4 }] },
  graze: { start: STATION_TALL, heading: TO_VIEWER, steps: [{ kind: "graze", secs: 10 }, { kind: "stand", secs: 3 }] },
};

/**
 * The party trailer's visitor (components/party/trailer): in from the corridor on camera, a short graze and two looks
 * toward the flower, and out the way she came. Each graze is short, so her own glance up while grazing never comes.
 */
const ARRIVE: Plan = {
  start: ENTRY,
  heading: -0.25,
  steps: [
    { kind: "walk", to: [-3.2, -1.62] },
    { kind: "walk", to: STATION },
    { kind: "stand", secs: 0.8 },
    { kind: "graze", secs: 4 },
    { kind: "look", secs: 4.5 },
    { kind: "graze", secs: 3 },
    { kind: "look", secs: 3 },
    { kind: "walk", to: [-3.2, -1.62] },
    { kind: "walk", to: ENTRY },
  ],
};

const TOURS: Tours = {
  visit: VISITS.back,
  arrive: ARRIVE,
  tour: {
    start: ENTRY,
    heading: -0.25,
    steps: [
      { kind: "walk", to: [-3.2, -1.62] },
      { kind: "walk", to: STATION },
      { kind: "stand", secs: 1.5 },
      { kind: "graze", secs: 9 },
      { kind: "look", secs: 4.5 },
      { kind: "graze", secs: 6 },
      { kind: "browse", secs: 6, face: TO_HEDGE },
      { kind: "stand", secs: 1.2 },
      { kind: "walk", to: [-0.45, -2.1] },
      { kind: "walk", to: [0.55, -2.35] },
      { kind: "walk", to: [1.35, -3.4] },
      { kind: "walk", to: [1.9, -4.6] },
    ],
  },
  stand: { start: STATION, heading: 0, steps: [{ kind: "stand", secs: 8 }, { kind: "look", secs: 4 }] },
  graze: { start: STATION, heading: 0, steps: [{ kind: "graze", secs: 10 }, { kind: "stand", secs: 3 }] },
  browse: { start: STATION, heading: TO_HEDGE, steps: [{ kind: "browse", secs: 10, face: TO_HEDGE }, { kind: "stand", secs: 3 }] },
  walk: {
    start: [-3.4, -1.55],
    heading: -0.2,
    steps: [
      { kind: "walk", to: [-0.5, -2.05] },
      { kind: "stand", secs: 2 },
      { kind: "walk", to: [-3.4, -1.55] },
      { kind: "stand", secs: 2 },
    ],
  },
};

/** The camera this far west (m) when she sets off, and she leaves under the arch rather than walking toward it. */
const WEST_X = -1.0;

export class Tour {
  private i = 0;
  private t = 0;
  /** The visit is over: she has walked out of the garden (a visit does not loop). */
  finished = false;
  private readonly target = new THREE.Vector2();
  readonly intent: DoeIntent = { target: null, speed: 0.55, face: null, graze: 0, browse: 0, look: null };
  /** Where the viewer's camera stands across the garden (x): her way out keeps away from it. */
  private viewerX = 0;

  private readonly plan: Plan;
  /** This run's steps: the plan's, with the way out swapped once she sets off (chooseOut). */
  private steps: Step[];
  private outChosen = false;

  /**
   * `tall`: a portrait screen (aspect under 0.8), whose frame is narrow at the back of the garden; `station`: where the
   * garden's visit stands (components/deer/stations), which decides the visit instead.
   */
  constructor(
    private readonly act: Act,
    private readonly lookAt: THREE.Vector3,
    tall = false,
    station?: DeerStation,
  ) {
    this.plan = act === "visit" && station ? VISITS[station] : (tall ? { ...TOURS, ...TALL } : TOURS)[act];
    this.steps = this.plan.steps;
  }

  start(doe: DoeAnimator) {
    doe.place(this.plan.start[0], this.plan.start[1], this.plan.heading);
    this.steps = this.plan.steps;
    this.outChosen = false;
    this.i = 0;
    this.t = 0;
    this.finished = false;
  }

  /** Whether she is on her way out already. */
  get leaving(): boolean {
    return this.steps.slice(this.i).every((s) => s.kind === "walk");
  }

  /** Told each frame where the viewer's camera stands across the garden (x). */
  seeViewer(x: number) {
    this.viewerX = x;
  }

  /** Skips to her walk out (someone came too close, or the screen turned): calmly, never a flight. */
  leave() {
    if (this.leaving) return;
    const steps = this.steps;
    const out = steps.findIndex((_, k) => steps.slice(k).every((s) => s.kind === "walk"));
    if (out >= 0) {
      this.i = out;
      this.t = 0;
    }
  }

  /** As she sets off: the way out that keeps away from the viewer (the corridor, or under the arch with the camera west). */
  private chooseOut() {
    if (this.outChosen || !this.plan.back || !this.leaving) return;
    this.outChosen = true;
    if (this.viewerX < WEST_X) {
      this.steps = [...this.steps.slice(0, this.i), ...this.plan.back];
      this.t = 0;
    }
  }

  step(dt: number, doe: DoeAnimator) {
    this.chooseOut();
    const tour = { steps: this.steps };
    let step = tour.steps[this.i];
    this.t += dt;
    const done =
      step.kind === "walk"
        ? doe.pos.distanceTo(this.target.set(step.to[0], step.to[1])) < 0.08 && doe.speed < 0.2
        : this.t >= step.secs;
    if (done) {
      this.i++;
      this.t = 0;
      if (this.i >= tour.steps.length) {
        if (this.act === "visit" || this.act === "arrive") {
          // she has gone; she stands out of sight in the corridor until she is taken away
          this.finished = true;
          this.i = tour.steps.length - 1;
        } else {
          // the walk-through loops: she is back in the corridor, out of sight
          if (this.act === "tour") this.start(doe);
          this.i = 0;
        }
      }
      step = tour.steps[this.i];
    }
    const it = this.intent;
    it.target = null;
    it.face = null;
    it.graze = 0;
    it.browse = 0;
    it.look = null;
    // the next stop is close: she does not stop between waypoints of one walk
    if (step.kind === "walk") {
      const next = tour.steps[this.i + 1];
      const through = next?.kind === "walk";
      it.target = this.target.set(step.to[0], step.to[1]);
      it.speed = step.speed ?? 0.55;
      if (through && doe.pos.distanceTo(it.target) < 0.5) {
        this.i++;
        this.t = 0;
      }
    } else if (step.kind === "graze") it.graze = 1;
    else if (step.kind === "look") it.look = this.lookAt;
    else if (step.kind === "browse") {
      it.browse = 1;
      it.face = step.face;
    }
  }
}
