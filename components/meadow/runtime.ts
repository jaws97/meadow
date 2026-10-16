// Mutable state shared by the parts of the Meadow spike, in the same spirit as
// the garden's `env`: written inside the render loop, read by whoever needs it
// the same frame, and never routed through React, so nothing re-renders at
// 60 Hz. The HTML overlays poll it a few times a second.
import * as THREE from "three";
import type { Mover, MoverKind } from "@/components/meadow/mover";

export type DriveMode = "idle" | "keys" | "drag" | "autopilot";

export const meadow = {
  moverKind: "physics" as MoverKind,
  /** The live body, once its world has loaded. */
  mover: null as Mover | null,

  /** Camera distance the player asked for (pinch and wheel), metres. */
  zoom: 13,
  /** The camera's smoothed focus on the ground; the sun's shadow box follows it. */
  focus: new THREE.Vector3(),
  /** Set after a teleport so the camera cuts instead of gliding across the Meadow. */
  snapCamera: true,
  /** 0 clear .. 1 fully faded, for respawns. */
  fade: 0,
  /** "Unstuck" is offered when the cart has tried to move for 3 s without getting anywhere. */
  stuck: false,
  requests: { respawn: false, unstuck: false },

  mode: "idle" as DriveMode,
  /** Plot the autopilot is visiting, or -1. */
  targetPlot: -1,
  /** Plot the body is parked beside, or -1. */
  nearPlot: -1,

  /** Planned route for the dotted guide, flattened x,z pairs; `count` points are live. */
  route: { points: new Float32Array(128), count: 0, version: 0 },
  /** Where a tap sent the body, for the ground ring. */
  goal: { active: false, x: 0, z: 0 },
  /** The ground point under a driving finger, and how hard it is pulling. */
  finger: { active: false, x: 0, z: 0, power: 0 },

  stats: {
    fps: 0,
    frameMs: 0,
    frameMaxMs: 0,
    /** whole physics stage per frame: the stepper, vehicle updates and mesh interpolation */
    physicsMs: 0,
    /** world.step plus the vehicle update, per fixed step */
    stepMs: 0,
    stepsPerFrame: 0,
    speed: 0,
    calls: 0,
    triangles: 0,
    dpr: 1,
    loading: true,
  },
};

export type MeadowRuntime = typeof meadow;

/** Raw timing sums between HUD refreshes; PerfProbe turns them into `meadow.stats`. */
export const perf = { physicsMs: 0, stepMs: 0, steps: 0 };

/** Back to a fresh session, for a remount (route change or fast refresh). */
export function resetMeadow(kind: MoverKind): void {
  meadow.moverKind = kind;
  meadow.mover = null;
  meadow.zoom = 13;
  meadow.snapCamera = true;
  meadow.fade = 0;
  meadow.stuck = false;
  meadow.requests.respawn = false;
  meadow.requests.unstuck = false;
  meadow.mode = "idle";
  meadow.targetPlot = -1;
  meadow.nearPlot = -1;
  meadow.route.count = 0;
  meadow.route.version++;
  meadow.goal.active = false;
  meadow.finger.active = false;
  meadow.stats.loading = true;
}
