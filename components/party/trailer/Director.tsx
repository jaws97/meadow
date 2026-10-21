"use client";
// The party trailer, played in the canvas (components/party/PartyScene). Before the clock runs (priority -11, ahead of
// the garden's clock at -10) it writes the trailer's frame (script trailerAt) everywhere it goes: the garden's store
// (the hour, growth, bloom, rain, cloud and wind), the scene's trailer multipliers (lib/garden/trailerFx) and the film
// look (lib/garden/look), the party camera's shot and lens with its named points made real (the flower head as it
// stands, the doe's head as she moves), the depth of field's focus, the black over the picture, and the words, the
// title and the tagline over it; and it tells the doe, the watering can and the music where the trailer is.
//
// When the trailer is asked for, the page dips to black (control.ts); under it the director reads how to play it (the
// operator's reduced motion, and whether the doe was built), lets the garden draw what the opening never drew (a seed
// in its mound at night in the rain: the mound, the saucer's puddle, the moon, the lantern's flame) and draws all of it
// once with culling off, then sets the dawn the trailer opens on, waits for the plant to sink to its seed and the frame
// rate to settle, and only then starts the clock. The clock advances by the frame's time, capped, so a slow frame reads
// as a pause, never a jump, and the director measures that pace for the music. At each gate (a flower changed, or the
// rose's seed staged for the coda, always under black) it waits for the garden to settle again; at the restore gate it
// also works out the lens shift that puts the coda's seed exactly where the party's rose will stand. Under the last
// black (HOME_AT) it puts the garden back (control putBack, the same as a stop) and, two frames later, draws the party's
// garden once with culling off, so the tour never meets a first draw. Anything that throws here stops the trailer and
// brings the panel back, rather than freezing the screen.
import { useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Doe, doeHandle, type DoeStage } from "@/components/deer/Doe";
import { lightSet } from "@/components/garden/lightSets";
import { predraw } from "@/components/garden/warmup";
import { weather } from "@/components/garden/garden/weather";
import { driveCan } from "@/components/garden/garden/canLive";
import { codaShift, framingOf, goldenHour, type CodaMatch, type XYZ } from "@/components/party/logic";
import { party } from "@/components/party/store";
import { finishTrailer, OPEN_S, PREPARE_MAX_S, putBack, returnPanel, run, stageCoda, stopTrailer } from "@/components/party/trailer/control";
import {
  blankFrame,
  DEFAULT_OPTIONS,
  GATES,
  HOME_AT,
  MONTAGE,
  pickCanPress,
  RESTORE_AT,
  RETURN_AT,
  TRAILER_S,
  trailerAt,
  type PointName,
  type TrailerOptions,
} from "@/components/party/trailer/script";
import { music, renderPreview, type PreviewOptions } from "@/components/party/trailer/music";
import { cover, overlayRoot, trailer, trailerCam, trailerCues } from "@/components/party/trailer/store";
import { istDateAt, skyState, sunInfo } from "@/lib/sky/sun";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { applyLook } from "@/lib/garden/look";
import { garden } from "@/lib/garden/store";
import { applyFx, trailerFx } from "@/lib/garden/trailerFx";

/** The clock's longest step (s): below about 20 frames a second the trailer slows rather than skips. */
const MAX_STEP = 0.05;
/** Under black before the trailer: the night-and-rain look shown first (s), then the dawn held at least this long. */
const PRIME_S = 0.6;
const SETTLE_S = 2.4;
/**
 * The garden has settled when this many frames in a row came in no slower than the device's usual frame by this much
 * (or under `CALM_DT`), and at least `GATE_MIN_S` has passed; a gate never waits longer than `GATE_MAX_S`, so a slow
 * device plays on rather than stopping in the black.
 */
const CALM_FRAMES = 6;
const CALM_DT = 1 / 24;
const CALM_OVER = 1.6;
const GATE_MIN_S = 0.35;
const GATE_MAX_S = 3;
/** The usual frame (s), learned as the trailer plays, from frames under this. */
const USUAL_MAX = 0.25;
/** The doe's head bone (components/deer/build BONE_NAMES). */
const HEAD_BONE = 7;
/** The garden drawn once with culling off (warmup predraw): in one group, under black. */
const PREDRAW_GROUPS = 1;
/** Frames after putting the garden back before the party's garden is drawn so (its state applied, the flower whole). */
const HOME_PREDRAW_FRAMES = 2;
/**
 * The trailer's pace against the wall clock (the clock's steps over the frames' time) is measured over about this long
 * (s), and taken as no slower than RATE_MIN, for the music's scheduling.
 */
const RATE_WINDOW_S = 0.5;
const RATE_MIN = 0.5;
/** The full-grown rose's head until the trailer has seen its own (as the party camera starts it). */
const FULL_HEAD_Y = HERO_GROUND_Y + 1.12;
/** The offline preview's slow profile (dev only): every gate held this long (s) and the clock at this pace. */
const PREVIEW_SLOW: PreviewOptions = { holds: 1.5, rate: 0.7 };

type Prep = "dip" | "prime" | "dawn";

/** ...and over at least this many frames, so a device drawing a few frames a second still has a median to take. */
const RATE_FRAMES = 9;
const ascending = (a: number, b: number) => a - b;

/**
 * The clock's pace: the median, over its last frames, of each frame's step against that frame's own time. One long
 * frame (a gate's first draw, a hitch) never moves a median, so the music is not slowed for the half second after it,
 * while a device that is slow all along reads slow. It starts as if the last frames had all kept time.
 */
class Pace {
  private readonly ratios: number[] = [];
  private readonly deltas: number[] = [];
  private readonly sorted: number[] = [];
  private span = 0;
  rate = 1;

  reset() {
    this.ratios.length = 0;
    this.deltas.length = 0;
    this.span = 0;
    for (let i = 0; i < RATE_FRAMES; i++) {
      this.ratios.push(1);
      this.deltas.push(RATE_WINDOW_S / RATE_FRAMES);
    }
    this.span = RATE_WINDOW_S;
    this.rate = 1;
  }

  add(step: number, delta: number) {
    if (!(delta > 0)) return;
    this.ratios.push(step / delta);
    this.deltas.push(delta);
    this.span += delta;
    while (this.ratios.length > RATE_FRAMES && this.span - this.deltas[0] >= RATE_WINDOW_S) {
      this.span -= this.deltas.shift()!;
      this.ratios.shift();
    }
    const s = this.sorted;
    s.length = 0;
    for (const r of this.ratios) s.push(r);
    s.sort(ascending);
    const n = s.length;
    const median = n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    this.rate = Math.min(1, Math.max(RATE_MIN, median));
  }
}

interface Run {
  prep: Prep;
  prepAt: number;
  t: number;
  golden: number;
  /** how this run plays (read once as it starts) */
  options: TrailerOptions;
  /** the garden drawn once with culling off under the prime's black */
  primeDrawn: boolean;
  /** a gate the clock waits at: since when, and frames in a row that came in calm */
  gate: number | null;
  gateAt: number;
  calm: number;
  /** the device's usual frame time (s), eased */
  usual: number;
  /** the shot playing (script events.shot): a change is a cut */
  shot: string;
  /** the night's weather snap made, the garden put back at HOME_AT, frames until the party's garden is drawn */
  snapped: boolean;
  home: boolean;
  predrawIn: number;
  returned: boolean;
  /** the full-grown rose's head as the trailer last saw it before the montage, and the coda's match to the party */
  fullHead: THREE.Vector3;
  coda: CodaMatch;
  pace: Pace;
  /** how dark it is for the music (the night's crickets hold through the end, after the garden is put back at HOME_AT) */
  night: number;
}

const frame = blankFrame();
const focus = new THREE.Vector3();
const focusTo = new THREE.Vector3();
const point = new THREE.Vector3();

/**
 * The doe's cue: she is in the garden while the trailer's frame says so, shown off stage while the trailer prepares
 * (so a light set prepared then draws her too), and on the trailer's own clock.
 */
const DOE_STAGE: DoeStage = { on: () => trailerCues.doe, primed: () => trailer.get().phase === "opening", maxStep: MAX_STEP };

/** Whether the trailer is still running (a predraw stops between its groups once it is not). */
const stopped = () => {
  const phase = trailer.get().phase;
  return phase !== "opening" && phase !== "playing";
};

/** Draws the whole garden once with culling off, under black (best effort: a part it misses is drawn first later). */
function drawAll(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  predraw(gl, scene, camera, PREDRAW_GROUPS, stopped).catch((error: unknown) => console.warn("[party] the trailer's predraw failed", error));
}

/**
 * A named point made real, into `out`: the flower head as it stands, the doe's head as she moves (where she stands to
 * look if she is not there), or the script's own point.
 */
function resolve(name: PointName, scripted: Readonly<XYZ>, out: THREE.Vector3): THREE.Vector3 {
  if (name === "head") return out.copy(env.headPos);
  if (name === "doeBone") {
    const bone = doeHandle.anim?.bones[HEAD_BONE];
    if (bone) return bone.getWorldPosition(out);
  }
  return out.set(scripted.x, scripted.y, scripted.z);
}

/** The camera's shot and lens from the frame (the coda's lens shift is the run's match to the party). */
function aim(r: Run) {
  Object.assign(trailerCam.shot, frame.shot);
  const l = trailerCam.lens;
  const fl = frame.lens;
  l.look = fl.look;
  if (fl.target) {
    resolve(fl.target, fl.point, point);
    l.target.x = point.x;
    l.target.y = point.y;
    l.target.z = point.z;
  }
  l.shiftX = fl.coda ? r.coda.x : fl.shiftX;
  l.shiftY = fl.coda ? r.coda.y : fl.shiftY;
  l.follow = fl.follow;
}

function write(r: Run) {
  trailerAt(r.t, r.golden, frame, r.options);
  // until HOME_AT: from then on the garden, the camera and the look are the party's own (putBack)
  if (!frame.restored) {
    garden.set({ hour: frame.hour, growth: frame.growth, bloom: frame.bloom, rain: frame.rain, cloud: frame.cloud, wind: frame.wind });
    applyFx(frame.fx);
    applyLook(frame.look);
    aim(r);
    // a cut: the aim takes the flower head as it stands
    if (frame.events.shot !== r.shot) {
      r.shot = frame.events.shot;
      trailerCam.snapFrames = Math.max(trailerCam.snapFrames, 1);
    }
    const d = frame.dof;
    if (d.to && d.rack > 0.001) {
      resolve(d.from, d.fromPoint, focus);
      env.focus = focus.lerp(resolve(d.to, d.toPoint, focusTo), d.rack);
    } else env.focus = d.from === "head" ? null : resolve(d.from, d.fromPoint, focus);
    // the motes and the backdrop's glints focus where the depth of field does
    trailerFx.focus = env.focus;
  }
  trailerCues.doe = frame.doe;
  // the seed's first drink: the can's moment, played on the trailer's clock (components/garden/garden/canLive), from a
  // press that pours the way the cut was framed
  if (frame.water >= 0) {
    if (!garden.get().canMoment) {
      const press = pickCanPress(Date.now());
      garden.set({ canMoment: { at: press.at, refusedAt: 0, soil: "ok" } });
      music.drips(press.drips);
    }
    driveCan(frame.water);
  } else driveCan(null);
  // the night's lantern and dry stones at once, under the chapter's black
  if (frame.events.weatherSnap && !r.snapped) {
    r.snapped = true;
    weather.primed = false;
  }
  cover.set(frame.cover);
  const text = frame.text;
  trailer.set({
    line: text.line,
    lineGroups: text.lineGroups,
    lineOn: text.lineOn,
    ...(text.name !== null && { name: text.name }),
    nameOn: text.nameOn,
    title: text.title,
    tagline: text.tagline,
  });
}

export function TrailerDirector() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const state = useRef<Run>({
    prep: "dip",
    prepAt: 0,
    t: 0,
    golden: 17.5,
    options: { ...DEFAULT_OPTIONS },
    primeDrawn: false,
    gate: null,
    gateAt: 0,
    calm: 0,
    usual: 1 / 60,
    shot: "",
    snapped: false,
    home: false,
    predrawIn: 0,
    returned: false,
    fullHead: new THREE.Vector3(0, FULL_HEAD_Y, 0),
    coda: { x: 0, y: 0, screenX: 0.5 },
    pace: new Pace(),
    night: 0,
  });

  // Dev-only: the trailer's clock, and its music rendered to a WAV, for checking them from the console.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const preview = (options: PreviewOptions = {}) => {
      const golden = goldenHour(new Date());
      const f = blankFrame();
      return renderPreview(
        (t) => {
          // the coda's night carries on under the fade after the garden is put back, as it does live
          trailerAt(Math.min(t, HOME_AT - 1e-6), golden, f);
          const night = skyState(sunInfo(istDateAt(f.hour)).altitude, f.cloud, f.hour, f.rain).nightness;
          return { rain: f.rain, night };
        },
        TRAILER_S,
        options,
      );
    };
    (window as unknown as { __trailer?: unknown; __trailerMusic?: unknown }).__trailer = state;
    (window as unknown as { __trailerMusic?: unknown }).__trailerMusic = { preview, slow: () => preview(PREVIEW_SLOW) };
  }, []);

  // A lost GPU context leaves a frozen picture: the trailer stops and the panel comes back, and no trailer starts until
  // the context is back.
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = () => {
      run.lost = true;
      stopTrailer();
    };
    const restored = () => {
      run.lost = false;
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const r = state.current;
    const phase = trailer.get().phase;
    if (phase !== "opening" && phase !== "playing") {
      r.prep = "dip";
      return;
    }
    // the page's watchdog: the garden is still drawing (a lost context draws nothing, so it lets the watchdog act)
    if (!run.lost) run.beat = performance.now();
    try {
      const now = performance.now();
      const calm = delta < Math.max(CALM_DT, r.usual * CALM_OVER) ? r.calm + 1 : 0;
      r.calm = calm;
      if (delta < USUAL_MAX) r.usual += (delta - r.usual) * 0.05;
      if (phase === "opening") {
        if (r.prep === "dip") {
          // wait for the black, and for the full light set (a rehearsal opened at noon prepares it first, the doe and
          // the showcase garden drawn under it)
          if (now - run.openedAt < OPEN_S * 1000) return;
          if (!lightSet.full && now - run.openedAt < (OPEN_S + PREPARE_MAX_S) * 1000) return;
          r.golden = goldenHour(new Date());
          // how this run plays: the operator's reduced motion (never overridden), and the doe if she was built
          r.options = {
            reduced: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
            visitor: doeHandle.anim !== null,
          };
          r.primeDrawn = false;
          // first draws the opening never made: the seed's mound, the moon, and the saucer's puddle in the rain
          garden.set({ growth: 0, bloom: 0, hour: r.golden + 2, rain: 0.6, cloud: 0.8 });
          trailerCam.active = true;
          trailerAt(0, r.golden, frame, r.options);
          aim(r);
          r.prep = "prime";
          r.prepAt = now;
          return;
        }
        if (r.prep === "prime") {
          // the frame after the prime's state applied: everything it shows drawn once, culling off, whatever the
          // first shot's narrow view sees (the mound, the puddle, the rain, the fireflies, the flame and the moon)
          if (!r.primeDrawn) {
            r.primeDrawn = true;
            drawAll(gl, scene, camera);
            return;
          }
          if (now - r.prepAt < PRIME_S * 1000) return;
          trailerAt(0, r.golden, frame, r.options);
          garden.set({ hour: frame.hour, growth: 0, bloom: 0, rain: 0, cloud: frame.cloud, wind: frame.wind });
          // dry stones and the dawn's lantern at once
          weather.primed = false;
          r.prep = "dawn";
          r.prepAt = now;
          return;
        }
        // the plant sunk to its seed, the full light set live, calm frames
        const waited = now - r.prepAt;
        const lit = lightSet.full || now - run.openedAt > (OPEN_S + PREPARE_MAX_S) * 1000;
        const settled = calm >= CALM_FRAMES || waited > (SETTLE_S + GATE_MAX_S) * 1000;
        if (waited < SETTLE_S * 1000 || !lit || !settled) return;
        r.t = 0;
        r.gate = null;
        r.shot = "";
        r.snapped = false;
        r.home = false;
        r.predrawIn = 0;
        r.returned = false;
        r.fullHead.set(0, FULL_HEAD_Y, 0);
        r.pace.reset();
        trailerCam.snapFrames = 2;
        trailer.set({ phase: "playing" });
        write(r);
        return;
      }

      // playing
      if (r.gate !== null) {
        const waited = now - r.gateAt;
        if (waited < GATE_MIN_S * 1000 || (calm < CALM_FRAMES && waited < GATE_MAX_S * 1000)) return;
        r.gate = null;
        trailerCam.snapFrames = Math.max(trailerCam.snapFrames, 3);
      } else {
        const step = Math.min(delta, MAX_STEP);
        r.pace.add(step, delta);
        const t = r.t + step;
        const crossed = GATES.find((g) => r.t < g && t >= g);
        if (crossed !== undefined) {
          r.t = crossed;
          if (crossed >= RESTORE_AT) {
            // the coda: the rose's own seed under the title, framed where the party's rose will stand
            // (beside the panel, or centred when the operator hid it and it will not come back)
            const p = party.get();
            const panel = trailerCam.panelBack ? { x: p.shiftX, y: p.shiftY } : { x: 0, y: 0 };
            codaShift(framingOf(size.width, size.height), size.width / Math.max(1, size.height), r.fullHead, panel, r.coda);
            overlayRoot.setCodaX(r.coda.screenX);
            stageCoda(r.golden);
            write(r);
          } else {
            write(r);
            garden.set({ speciesId: MONTAGE[GATES.indexOf(crossed)] });
          }
          r.gate = crossed;
          r.gateAt = now;
          r.calm = 0;
          return;
        }
        r.t = t;
      }
      // the full-grown rose's head, as it stands before the montage, for the coda's match
      if (r.t < GATES[0]) r.fullHead.copy(env.headPos);
      write(r);
      if (!r.home && r.t >= HOME_AT) {
        // under the last black: the garden as the party shows it, the flower whole at once
        r.home = true;
        putBack();
        r.predrawIn = HOME_PREDRAW_FRAMES;
      } else if (r.predrawIn > 0 && --r.predrawIn === 0) drawAll(gl, scene, camera);
      if (!frame.restored) r.night = env.nightness;
      music.play(r.t, frame, r.night, GATES.find((g) => g > r.t) ?? Infinity, r.pace.rate);
      if (!r.returned && r.t >= RETURN_AT) {
        r.returned = true;
        returnPanel();
      }
      if (r.t >= TRAILER_S) finishTrailer();
    } catch (error) {
      console.error("[party] the trailer stopped", error);
      stopTrailer();
    }
  }, -11);

  return null;
}

/** Catches the doe failing to build, inside the canvas, so the party screen carries on without her. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[party] the trailer's doe could not be built", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The trailer's visitor: built and prepared with the garden, waiting off stage for her cue. */
export function TrailerDoe() {
  return (
    <QuietBoundary>
      <Doe act="arrive" lookAt={env.headPos} stage={DOE_STAGE} />
    </QuietBoundary>
  );
}
