// Mutable state shared by the parts of the Meadow, in the same spirit as the
// garden's `env`: written inside the render loop, read by whoever needs it the
// same frame, and never routed through React, so nothing re-renders at 60 Hz.
// The HTML overlays poll it a few times a second, and ask the canvas for
// things (a visit, a teleport) through `requests`, which the controller
// answers on its next frame.
import * as THREE from "three";
import type { Mover, MoverKind } from "@/components/meadow/mover";

/** A visit the overlay asks for: a plant by plot index (or the rose), led by fireflies when `journey` is set. */
export interface VisitRequest {
  index: number;
  journey: boolean;
}

export type DriveMode = "idle" | "keys" | "drag" | "autopilot";

export const meadow = {
  moverKind: "physics" as MoverKind,
  /** The live body, once its world has loaded. */
  mover: null as Mover | null,
  /** Where a new body starts: beside the dais by default, beside a plant for a /meadow?plot=N link. */
  start: { x: 0, z: 0, yaw: 0 },

  /** Camera distance the player asked for (pinch and wheel), metres. */
  zoom: 17,
  /**
   * Seconds left of the opening shot: the camera starts high over the whole
   * Meadow and settles onto the cart, so the first thing anyone sees is the
   * rings round the rose.
   */
  intro: 0,
  /**
   * What the camera should frame besides the cart: the plant being visited
   * (once the cart has pulled up), and how much of the screen's bottom (or,
   * on a landscape screen, its right side) the visit card covers (0..1), so
   * the plant sits in the part left clear.
   */
  view: { target: null as { x: number; z: number; y: number } | null, cover: 0, coverSide: 0 },
  /** The camera's smoothed focus on the ground; the sun's shadow box follows it. */
  focus: new THREE.Vector3(),
  /** Roughly how far the view reaches across the ground from the focus, metres: the shadow box covers it. */
  viewReach: 16,
  /** How far the camera stands from its focus, metres: the haze begins beyond it. */
  cameraDistance: 17,
  /** 0 full day .. 1 deep night, by the sun over Bangalore (MeadowEnvironment): lanterns and petals glow with it. */
  night: 0,
  /**
   * The cart's guardian light, the jar of fireflies: where its heart is in the world and how bright its light, written
   * by the live trolley every frame (FireflyTrolley). The scene's one point light for it (GuardianLight) follows this,
   * and is dark while no cart is live, so the cart coming and going never changes the Meadow's light count.
   */
  guardian: { position: new THREE.Vector3(), light: 0, live: false },
  /** The soft environment map for the full plants' sheen (MeadowEnvironment), and how strongly it shows at this hour. */
  plantEnv: null as THREE.Texture | null,
  plantEnvStrength: 1,
  /** Set after a teleport so the camera cuts instead of gliding across the Meadow. */
  snapCamera: true,
  /** 0 clear .. 1 fully faded, for respawns. */
  fade: 0,
  /** "Unstuck" is offered when the cart has tried to move for 3 s without getting anywhere. */
  stuck: false,
  requests: {
    respawn: false,
    unstuck: false,
    visit: null as VisitRequest | null,
    /** "Skip": jump straight to the end of the current journey */
    teleport: false,
    /** stop driving and drop the current journey (the card was closed) */
    cancel: false,
  },

  mode: "idle" as DriveMode,
  /** Plot the autopilot is visiting, or -1. */
  targetPlot: -1,
  /** Plot the body is parked beside, or -1. */
  nearPlot: -1,
  /** The firefly trail is lighting the route (a find-a-friend journey). */
  journey: false,
  /** The plot whose cheap instanced plant is hidden because its full plant is drawn in its place, or -1. */
  detailPlot: -1,
  /** The plot of the person on this device, for the gold ribbon on their stake, or -1. */
  myPlot: -1,

  /**
   * Where the physics cart stood when the Meadow fell back to gliding (Rapier
   * failed to start, or the frame rate stayed low), so the glider picks up
   * from the same spot instead of jumping back to the spawn. Consumed once.
   */
  handoff: null as { x: number; z: number; yaw: number } | null,
  /** A gentle line for the overlay (never an error), with when it was set, in performance.now() ms. */
  notice: null as { text: string; at: number } | null,

  /** Planned route for the dotted guide, flattened x,z pairs; `count` points are live. */
  route: { points: new Float32Array(512), count: 0, version: 0 },
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
  meadow.zoom = 17;
  meadow.intro = 0;
  meadow.view.target = null;
  meadow.view.cover = 0;
  meadow.view.coverSide = 0;
  meadow.requests.visit = null;
  meadow.requests.teleport = false;
  meadow.requests.cancel = false;
  meadow.journey = false;
  meadow.detailPlot = -1;
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
  meadow.handoff = null;
  meadow.notice = null;
  meadow.guardian.live = false;
  meadow.stats.loading = true;
}

/** Seconds of the opening shot (CameraRig): high over the Meadow, settling onto the cart. */
export const INTRO_SECONDS = 4.2;

/** Where a new body starts, and whether the opening shot plays first. */
export function setStart(x: number, z: number, yaw: number, intro: boolean): void {
  meadow.start = { x, z, yaw };
  meadow.intro = intro ? INTRO_SECONDS : 0;
}

export function setZoom(zoom: number): void {
  meadow.zoom = zoom;
}
