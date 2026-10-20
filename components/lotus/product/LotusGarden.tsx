"use client";
// A lotus owner's garden: the concepts page's courtyard (components/lotus/courtyard), its pond, the koi, the jar and the
// lotus in its pot, now drawn from the plant's real numbers (the garden store, eased by lib/client/plant) instead of the
// page's address. The garden's own clock, sky, lights, post-processing and camera are shared with the flower garden
// (Scene.tsx); everything here is in the tier's layer (TierLayers): each part reads useTier() and runs its frame work
// through useLayerFrame. No butterflies: the koi are the courtyard's living things.
//
// Frame order, as the flower garden's: the clock at -10 writes the shared env; at -5 this part steps the garden's
// weather (the lamps' flames read it), steps this page's pour (pourLive, which the moments read), eases what moves (the
// level, the green, the jar, the flower's opening and warmth) and writes it into the look, the pond's and the plant's
// live records and the camera's subject; the plant (which writes env.headPos for the focus and the camera) and the koi
// move at 0, the pond's reflection draws at 0.5.
//
// The plant's shape is rebuilt only when a step of its shape is crossed (liveLook.ts: a leaf more, the flower's next
// day, a fallen petal, a droop in twentieths, the level in 12 mm steps); the green water, the jar clouding and the
// flower's opening and closing all move without one, and a bucket's pour crosses one level step at most.
//
// When a soil flower gives way to a lotus behind the soft dim (lib/client/plant swapTo), the courtyard brings dozens of
// programs the flower garden never compiled. Drawn at once they would freeze the garden for seconds; so it mounts out
// of sight, compiles its programs in parallel a few objects a frame and pre-draws itself (warmup.ts, as a tier
// prepared out of sight is), and only then shows and tells the swap it may lift the dim (product/stage.ts). It never
// stays hidden under a lifting dim: its own preparation is capped (PREPARE_MAX_MS, within the swap's longer hold), and
// if the swap's time runs out first it shows itself at once (lib/garden/swapGate onSwapOverdue). Its code arriving late
// (a slow network, a development server compiling it) keeps the dim down a while longer, for it to mount and prepare;
// once the swap has given up on it, it is no longer expected and simply shows as it mounts. Under the loading veil (a
// returning lotus owner, a friend's courtyard) the opening compiles it with everything else.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { underVeil } from "@/lib/garden/quality";
import { garden, useGarden, type GardenState, type PondShown } from "@/lib/garden/store";
import { onSwapOverdue } from "@/lib/garden/swapGate";
import { composerHandle } from "@/components/garden/Effects";
import { canSwitchSets, lightSet, withSet } from "@/components/garden/lightSets";
import { useLayerFrame, useLayerLive, useTier } from "@/components/garden/TierLayers";
import { compileSliced, predraw, unchecked, withStandIn } from "@/components/garden/warmup";
import { stepWeather } from "@/components/garden/garden/weather";
import { CARD_BLOOM, cardShot } from "@/lib/garden/cardShot";
import { Pond, type PondLive } from "@/components/lotus/KoiPond";
import type { PlantLive } from "@/components/lotus/LotusPlant";
import { lotusDefaultLook, type LotusLookInput } from "@/components/lotus/live/pondLook";
import { pondJarInPotFrame, type LotusLook } from "@/components/lotus/look";
import { POT_FRAME } from "@/components/lotus/pond";
import { CourtyardAir } from "@/components/lotus/courtyard/Air";
import { Courtyard } from "@/components/lotus/courtyard/Courtyard";
import { LEAN } from "@/components/lotus/product/camera";
import { LiveKoi } from "@/components/lotus/product/LiveKoi";
import { aphidShare, applyLive, nibbleOf, shapeKey, shapeLook } from "@/components/lotus/product/liveLook";
import { claimGlide, GLIDE, pourLevel } from "@/components/lotus/product/timings";
import { Moments, type MomentsClock } from "@/components/lotus/product/Moments";
import { pourLive, stepPourLive } from "@/components/lotus/product/pourLive";
import { courtSubject, courtyardExpected, courtyardReady } from "@/components/lotus/product/stage";

export const LOTUS_GARDEN_NAME = "lotus-garden";

/** The look before any of the plant's numbers arrive (the developer panel's species switch, a first frame). */
const DEFAULT_KEY = "default";

/** Seconds the frame loop's easing takes over the store's 400 ms steps (so the level and the petals glide, never tick). */
const EASE_S = 0.6;

/**
 * A swap's preparation: its pre-draw in groups a frame or more apart, at most this long; and the longest it may hold,
 * from its mount (within the swap's own hold, lib/client/plant SWAP_HOLD_MS, which starts a moment before it).
 */
const PREDRAW_GROUPS = 8;
const PREDRAW_MAX_MS = 4000;
const PREPARE_MAX_MS = 7000;

/** The plant's numbers as the courtyard's look reads them (pondLook.ts), from the garden store. */
function inputOf(s: GardenState, pond: PondShown): LotusLookInput {
  return {
    pond,
    growth: s.growth,
    bloom: s.bloom,
    health: s.health,
    droop: s.droop ?? 0,
    chlorosis: s.chlorosis,
    flowerSize: s.flowerSize,
    glow: s.glow,
    // (a resting lotus reaches the store with its resting numbers, drooped and paled: lib/client/plant renderTarget)
    alive: s.health > 0,
  };
}

/** The shape's key for the store as it is (the store's selector: the courtyard re-renders only when it changes). */
const keyOf = (s: GardenState) => (s.pond ? shapeKey(inputOf(s, s.pond), s.hour) : DEFAULT_KEY);

/** The shape for a key, with the owner's jar spot: built from the store the key was just read from. */
function lookOfKey(key: string, seed: string): LotusLook {
  const s = garden.get();
  if (key === DEFAULT_KEY || !s.pond) return lotusDefaultLook();
  // (any hour with the same key builds the same shape: the key carries the dew and day 1's dawn bud)
  return shapeLook(inputOf(s, s.pond), s.hour, seed);
}

/**
 * Compiles the courtyard's programs and pre-draws it while it is hidden (group.visible false on screen), each step in
 * a stand-in for the scene where it is shown under the live light set (warmup.withStandIn, lightSets.withSet), in one
 * task, so no frame sees it. Without parallel compiling there is nothing to gain: it is simply shown, and compiles on
 * its first frame, behind the dim.
 */
async function prepareOutOfSight(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, group: THREE.Group, cancelled: () => boolean) {
  if (!canSwitchSets(gl)) return;
  mark("prepare-start");
  const target = composerHandle.current?.inputBuffer ?? null;
  const shown = (step: (stand: THREE.Scene) => void) => {
    withStandIn(scene, (stand) => {
      group.visible = true;
      try {
        withSet(stand, lightSet.full, () => step(stand));
      } finally {
        group.visible = false;
      }
    });
    return true;
  };
  if (!(await compileSliced(gl, camera, target, shown, cancelled)) || cancelled()) return;
  mark("compiled");
  const until = performance.now() + PREDRAW_MAX_MS;
  await predraw(gl, scene, camera, PREDRAW_GROUPS, () => cancelled() || performance.now() > until, (step) => {
    shown(unchecked(gl, step));
  });
  // the courtyard's materials are compiled for the live light set only: the other is prepared again before a switch
  lightSet.ready = lightSet.full ? { full: true, day: false } : { full: false, day: true };
  lightSet.generation++;
  mark("predrawn");
}

/** The courtyard's swap marks (garden:court-*), as the opening's are (RenderBudget): a measuring aid only. */
function mark(name: string) {
  try {
    performance.mark(`garden:court-${name}`);
  } catch {
    // marks are a measuring aid only
  }
}

const seedWorld = new THREE.Vector3();

export default function LotusGarden() {
  const tier = useTier();
  const live = useLayerLive();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const seed = useGarden((s) => s.seed);
  const rain = useGarden((s) => s.rain >= 0.25);
  const key = useGarden(keyOf);
  const look = useMemo(() => lookOfKey(key, seed), [key, seed]);
  const group = useRef<THREE.Group>(null);
  // a swap from a soil flower mounts it hidden from its very first frame (an effect would come a frame too late: that
  // frame would draw, and so compile, every program at once); a constant prop, so React never touches it again
  const [startHidden] = useState(() => live && courtyardExpected() && !underVeil());

  // what moves every frame: the pond's and the plant's live records, the moments' clock, and the eased numbers
  const pondLive = useRef<PondLive>({ levelMM: look.waterMM, algae: look.algae });
  const plantLive = useRef<PlantLive>({ floatLift: 0, nibble: 0, aphids: 0, glow: 0, show: true });
  const clock = useRef<MomentsClock>({ glideAt: -1 });
  const shown = useRef(0);
  const revealed = useRef(true);
  const eased = useRef({ primed: false, level: 0, algae: 0, clarity: 1, bloom: 0, warmth: 0, drop: 0, glow: 0 });
  const pour = useRef({ stamp: 0, before: 0 });
  const planted = useRef(0);
  /** the unrounded input the frame writes into the look (reused: the frame loop allocates nothing) */
  const liveIn = useRef<LotusLookInput | null>(null);

  // a swap from a soil flower: hidden until compiled and pre-drawn (the live layer's copy only, and never under the veil)
  useEffect(() => {
    const g = group.current;
    if (!live || !g) return;
    if (!courtyardExpected() || underVeil()) {
      // not (or no longer) awaited behind the dim: shown as it is (it may have rendered hidden for a swap that has given
      // up on it since)
      g.visible = true;
      courtyardReady();
      return;
    }
    g.visible = false;
    revealed.current = false;
    let done = false;
    const finish = (ready: boolean) => {
      if (done) return;
      done = true;
      g.visible = true;
      revealed.current = true;
      if (!ready) return;
      mark("shown");
      courtyardReady();
    };
    const timer = window.setTimeout(() => finish(true), PREPARE_MAX_MS);
    // the swap's time is up (or it has given up): shown now, what is left compiles under the dim's fade
    const off = onSwapOverdue(() => finish(true));
    void prepareOutOfSight(gl, scene, camera, g, () => done).finally(() => {
      window.clearTimeout(timer);
      off();
      finish(true);
    });
    // a cleanup leaves the swap waiting: a remount (React's development double run) prepares again, and a lotus that
    // is gone releases it from the scene (product/stage), or the swap's own timeout does
    return () => {
      window.clearTimeout(timer);
      off();
      finish(false);
    };
    // mounted once per courtyard: a tier swap's layer is prepared by TierPreparer, not here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayerFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    stepWeather(dt);
    if (revealed.current) shown.current++;
    const s = garden.get();
    const p = s.pond;
    const E = eased.current;
    const P = pondLive.current;
    const L = plantLive.current;
    if (!p) {
      P.levelMM = look.waterMM;
      P.algae = look.algae;
      L.floatLift = 0;
      L.nibble = 0;
      L.aphids = 0;
      L.glow = s.glow;
      L.show = true;
      courtSubject.kind = "plant";
      courtSubject.at.copy(env.headPos);
      courtSubject.lean = LEAN.plant;
      return;
    }
    const now = Date.now();
    // the store moves in 400 ms steps: glide between them
    const k = E.primed ? 1 - Math.exp(-dt / EASE_S) : 1;
    E.primed = true;
    E.level += (p.waterMM - E.level) * k;
    E.algae += (p.algae - E.algae) * k;
    E.clarity += (p.jarClarity - E.clarity) * k;
    E.bloom += (s.bloom - E.bloom) * k;
    E.warmth += (p.warmth - E.warmth) * k;
    E.drop += (p.petalDrop - E.drop) * k;
    E.glow += (s.glow - E.glow) * k;

    // a pour: the level waits for the stream to reach the water (the pour plays on from its press once its stamp has
    // gone, and a refused one rises only by what it poured: pourLive, which the moments read after this)
    const tp = stepPourLive(now);
    if (pourLive.at !== pour.current.stamp) {
      pour.current.stamp = pourLive.at;
      pour.current.before = P.levelMM;
    }
    const level = pourLevel(tp, pour.current.before, E.level, pourLive.refused);

    // the planting: once per plant on this device, decided here, before the plant is drawn this frame (with reduced
    // motion there is no flight: the plant is simply in its pot, its first leaf opening)
    if (p.plantedAt !== planted.current) {
      planted.current = p.plantedAt;
      if (claimGlide(seed, p.plantedAt, now, storage()) && !reducedMotion()) clock.current.glideAt = env.time;
    }
    const gliding = clock.current.glideAt >= 0 && env.time - clock.current.glideAt < GLIDE.fade;
    if (!gliding) clock.current.glideAt = -1;

    // what moves, into the look and the live records
    const I = (liveIn.current ??= inputOf(s, { ...p }));
    Object.assign(I.pond, p);
    I.pond.waterMM = level;
    I.pond.algae = E.algae;
    I.pond.jarClarity = E.clarity;
    I.pond.warmth = E.warmth;
    // the bloom card's frames draw the flower fully open, every petal on (lib/garden/cardShot)
    I.pond.petalDrop = cardShot.active ? 0 : E.drop;
    I.bloom = cardShot.active ? Math.max(E.bloom, CARD_BLOOM) : E.bloom;
    applyLive(look, I);
    P.levelMM = level;
    P.algae = E.algae;
    // the floating leaves ride the level (in the pot's own water, once the pond is under its rim, they stay)
    L.floatLift = p.potIsolated ? 0 : (level - look.waterMM) / 1000;
    L.nibble = nibbleOf(p);
    L.aphids = aphidShare(p.aphids);
    L.glow = E.glow;
    L.show = !gliding || env.time - clock.current.glideAt >= GLIDE.plantShows;

    // the camera's subject: the jar while the seed is in it, then the plant (the moments take it for the planting)
    if (p.stage === "jar") {
      const j = pondJarInPotFrame(seed);
      seedWorld.set(j[0] + POT_FRAME[0], j[1] + POT_FRAME[1] + 0.05, j[2] + POT_FRAME[2]);
      courtSubject.kind = "jar";
      courtSubject.at.copy(seedWorld);
      courtSubject.lean = LEAN.jar + (p.moveReady ? 0.06 : 0);
    } else {
      courtSubject.kind = "plant";
      courtSubject.at.copy(env.headPos);
      courtSubject.lean = look.flower.kind === "none" ? 0 : LEAN.plant;
    }
  }, -5);

  return (
    <group ref={group} name={LOTUS_GARDEN_NAME} visible={!startHidden}>
      <Courtyard tier={tier} />
      <Pond key={seed} look={look} tier={tier} colour="pink" rain={rain} koi live={pondLive} plantLive={plantLive} school={<LiveKoi tier={tier} />}>
        <Moments tier={tier} seed={seed} shown={shown} clock={clock} pond={pondLive} />
      </Pond>
      <CourtyardAir tier={tier} />
    </group>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** This device's storage for the planting's memory, or null where it is blocked. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
