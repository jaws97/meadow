// What the doe does on the concept page: a scripted visit, step by step, turned into the animator's intent every
// frame. The garden visit is the design discussed for the product: she comes in through the low corridor on the left
// at the evening sun's bearing, walks along the back of the garden side-on to the camera, grazes, lifts her head to
// look toward the flower, browses the hedge, and walks on behind the bed and out under the arch. A portrait phone's frame
// is only about 2.3 m wide back there, so on a tall screen she comes in only as far as its left edge, turned three-
// quarters toward the viewer, and leaves the way she came. Everything here is in the garden's plan
// (lib/garden/layout.ts: metres, the hero at the origin, the default camera toward -z).
import * as THREE from "three";
import type { DoeAnimator, DoeIntent } from "@/components/deer/motion";

export type Act = "tour" | "stand" | "graze" | "walk" | "browse";

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

type Tours = Record<Act, { start: readonly [number, number]; heading: number; steps: Step[] }>;

/** The tall screens' visit: in and out through the corridor, so she never crosses behind the bloom. */
const TALL: Partial<Tours> = {
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

const TOURS: Tours = {
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

export class Tour {
  private i = 0;
  private t = 0;
  private readonly target = new THREE.Vector2();
  readonly intent: DoeIntent = { target: null, speed: 0.55, face: null, graze: 0, browse: 0, look: null };

  private readonly tours: Tours;

  /** `tall`: a portrait screen (aspect under 0.8), whose frame is narrow at the back of the garden. */
  constructor(
    private readonly act: Act,
    private readonly lookAt: THREE.Vector3,
    tall = false,
  ) {
    this.tours = tall ? { ...TOURS, ...TALL } : TOURS;
  }

  start(doe: DoeAnimator) {
    const tour = this.tours[this.act];
    doe.place(tour.start[0], tour.start[1], tour.heading);
    this.i = 0;
    this.t = 0;
  }

  step(dt: number, doe: DoeAnimator) {
    const tour = this.tours[this.act];
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
        // the walk-through loops: she is back in the corridor, out of sight
        if (this.act === "tour") this.start(doe);
        this.i = 0;
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
