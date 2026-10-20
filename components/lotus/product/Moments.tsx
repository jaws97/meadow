"use client";
/* eslint-disable react-hooks/immutability --
   The moments' meshes, materials, the brass pot's pose and the water's ring uniforms are three.js objects and plain
   records written in the frame loop, which is how an R3F part animates without re-rendering. */
// The courtyard's moments (their timings are timings.ts's), drawn from this device's own care as the garden store carries
// it (the pond's topUpAt, pinchAt and plantedAt): the brass pot's pour and, when the pond was full, the spill at the
// front coping's corner; the pellets of a pinch on the water at the front right (the koi come up for them: LiveKoi);
// the seedling's glide from its jar into the pot, with the jar fading from the coping. The pour plays from its press as
// the courtyard latched it (pourLive), on after its stamp has gone, and a refused one eases the pot home: it never snaps
// upright, and the stream fades rather than vanishing. With reduced motion the pot is not tipped (the rings and the
// level tell the top-up) and the seedling does not fly (the courtyard starts no glide). In world space (KoiPond's
// children); rings 3-5 of the water's are theirs. Nothing here adds a light (a light would change every program's
// light count): the seedling's light is a sprite.
//
// Every mesh is mounted from the start, so the opening and a swap's preparation compile its program with the rest of
// the courtyard, and drawn (fully transparent) for its first frames after the courtyard shows (\`warm\`), so its first
// real draw has nothing left to build; after that it is drawn only while its moment plays.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { garden } from "@/lib/garden/store";
import { useLayerFrame } from "@/components/garden/TierLayers";
import { makeJarGeometry, type Tier } from "@/components/lotus/geometry";
import { haloMaterial, jarGlassMaterial, jarWaterMaterial, padMaterial, pondWaterUniforms, rootMaterial, seedMaterial } from "@/components/lotus/materials";
import { pondJarInPotFrame } from "@/components/lotus/look";
import { jarSpot, POND, POT_FRAME } from "@/components/lotus/pond";
import { KODAM_FOOT, kodamPose } from "@/components/lotus/courtyard/Courtyard";
import { KODAM } from "@/components/lotus/courtyard/plan";
import { FEED_SPOT } from "@/components/lotus/product/koiMoves";
import type { PondLive } from "@/components/lotus/KoiPond";
import { glideState, GLIDE, PELLETS, pelletLeft, pourPose, since, spills, spillWet, type PourPose } from "@/components/lotus/product/timings";
import { pourLive } from "@/components/lotus/product/pourLive";
import { courtSubject } from "@/components/lotus/product/stage";
import { LEAN } from "@/components/lotus/product/camera";

/** The moments' clock, kept by the courtyard (it decides when the planting plays, before the plant is drawn). */
export interface MomentsClock {
  /** the garden clock's time (env.time) the planting's glide began, or -1 */
  glideAt: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// The rings (water slots 3-5): the newest three moments' rings, each fading out over its life before its slot is reused

interface Ring {
  x: number;
  z: number;
  at: number;
  life: number;
  strength: number;
}

const RING_SLOTS = [3, 4, 5] as const;

function ringPond(rings: Ring[], x: number, z: number, at: number, life = 2.4, strength = 1) {
  if (rings.length >= RING_SLOTS.length) rings.shift();
  rings.push({ x: x - POND.cx, z: z - POND.cz, at, life, strength });
}

function writeRings(rings: Ring[], t: number) {
  const u = pondWaterUniforms.uRings.value;
  for (let i = 0; i < RING_SLOTS.length; i++) {
    const r = rings[i];
    const slot = u[RING_SLOTS[i]];
    if (!r) {
      slot.w = 0;
      continue;
    }
    const age = t - r.at;
    const fade = 1 - THREE.MathUtils.smoothstep(age, r.life * 0.6, r.life);
    slot.set(r.x, r.z, age, age < r.life ? r.strength * fade : 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The pour's stream: from the tipped pot's lip to the water, a thin tube of falling water with streaks running down it

/** The pot's pivot (the foot of its base nearest the water) and its mouth's lower lip in the pot's own frame. */
const PIVOT = new THREE.Vector3(KODAM.x + KODAM_FOOT, KODAM.y, KODAM.z);
const LIP = new THREE.Vector2(0.088 - KODAM_FOOT, 0.3);

/** The lip in world space for a pose. */
function lipAt(p: PourPose, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(p.tilt);
  const s = Math.sin(p.tilt);
  return out.set(PIVOT.x + LIP.x * c + LIP.y * s, PIVOT.y + p.lift - LIP.x * s + LIP.y * c, PIVOT.z);
}

let streakTex: THREE.CanvasTexture | null = null;
/** Streaks running down the stream (its alpha), scrolled in the frame loop. */
function streakTexture(): THREE.CanvasTexture {
  if (!streakTex) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 32, 128);
      for (let i = 0; i < 70; i++) {
        const x = (i * 37) % 32;
        const y = (i * 53) % 128;
        const l = 10 + ((i * 29) % 30);
        const a = 0.35 + 0.65 * (((i * 13) % 7) / 6);
        g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
        g.fillRect(x, y, 2 + (i % 3), l);
        g.fillRect(x, y - 128, 2 + (i % 3), l);
      }
    }
    streakTex = new THREE.CanvasTexture(c);
    streakTex.wrapS = THREE.RepeatWrapping;
    streakTex.wrapT = THREE.RepeatWrapping;
    streakTex.repeat.set(1, 3);
  }
  return streakTex;
}

const streamMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: "#d9e6e8",
    transparent: true,
    opacity: 0,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 1.4,
    depthWrite: false,
    alphaMap: streakTexture(),
  });

/** The wet stone at the notch: dark and glossy, its edge an uneven blob (alpha). */
let blobTex: THREE.CanvasTexture | null = null;
function blobTexture(): THREE.CanvasTexture {
  if (!blobTex) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 9; i++) {
        const x = 20 + ((i * 17) % 26);
        const y = 6 + ((i * 23) % 40);
        const r = 12 + ((i * 7) % 10);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
      }
    }
    blobTex = new THREE.CanvasTexture(c);
  }
  return blobTex;
}

/** Where the extra runs out: the coping on the tank's left side, near its front corner, in clear view of every framing. */
const NOTCH = new THREE.Vector3(POND.cx - POND.rx - POND.lip - 0.065, POND.copingY + 0.004, POND.cz + POND.rz - 0.22);

// ---------------------------------------------------------------------------------------------------------------------
// The planting's flight: from the seed in its jar, up out of the jar's mouth, over the water to the pot and into it

const jarAt = (seed: string) => {
  const j = pondJarInPotFrame(seed);
  return new THREE.Vector3(j[0] + POT_FRAME[0] - 0.006, j[1] + POT_FRAME[1] + 0.016, j[2] + POT_FRAME[2] + 0.004);
};
const POT_IN = new THREE.Vector3(POND.potX, POND.waterY + 0.008, POND.potZ);
const POT_DOWN = new THREE.Vector3(POND.potX, POND.waterY - POND.pebbleDepth + 0.006, POND.potZ);

function flightOf(seed: string): THREE.CubicBezierCurve3 {
  const from = jarAt(seed);
  return new THREE.CubicBezierCurve3(from, from.clone().add(new THREE.Vector3(0, 0.16, 0)), POT_IN.clone().add(new THREE.Vector3(0.08, 0.17, 0.06)), POT_IN.clone());
}

/** The jar's glass, fading: the jar's own glass (its edges brighter than its face) with the fade on top. */
function fadingGlass(tier: Tier): THREE.MeshStandardMaterial {
  const m = jarGlassMaterial(tier).clone();
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "{ float jc = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);\n  diffuseColor.a = clamp(0.1 + 0.85 * pow(1.0 - jc, 4.0), 0.0, 1.0) * opacity; }\n#include <opaque_fragment>",
    );
  };
  m.customProgramCacheKey = () => "lotus-jar-glass-fade";
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Frames each moment's mesh is drawn (unseen) after the courtyard shows, so its first real draw is free. */
const WARM_FRAMES = 90;

const PELLET_SPOTS = Array.from({ length: PELLETS.count }, (_, i) => {
  const a = i * 2.39996;
  const r = 0.012 + 0.05 * Math.sqrt((i + 0.5) / PELLETS.count);
  return { x: FEED_SPOT.x + Math.cos(a) * r, z: FEED_SPOT.z + Math.sin(a) * r * 0.8, drift: 0.4 + 0.6 * ((i * 7) % 5) / 4 };
});

const pelletMat = new THREE.Matrix4();
const pelletPos = new THREE.Vector3();
const pelletQuat = new THREE.Quaternion();
const pelletScale = new THREE.Vector3();
const flight = new THREE.Vector3();

export function Moments({
  tier,
  seed,
  shown,
  clock,
  pond,
}: {
  tier: Tier;
  seed: string;
  /** frames since the courtyard was first shown (counted by the courtyard; 0 while it is being prepared) */
  shown: RefObject<number>;
  clock: RefObject<MomentsClock>;
  /** the level the pond is drawn at (the pellets float on it) */
  pond: RefObject<PondLive | null>;
}) {
  const geo = useMemo(() => {
    const jar = makeJarGeometry(tier);
    const flightCurve = flightOf(seed);
    // the stream at full flow: from the lip of the tipped pot to the water below it
    const full = lipAt(pourPose(2.5), new THREE.Vector3());
    const land = new THREE.Vector3(full.x + 0.028, POND.waterY + 0.004, full.z);
    const curve = new THREE.QuadraticBezierCurve3(full.clone(), new THREE.Vector3(full.x + 0.022, full.y - 0.06, full.z), land);
    const stream = new THREE.TubeGeometry(curve, 20, 0.0105, 10, false);
    return {
      jar,
      flightCurve,
      stream,
      land,
      film: new THREE.PlaneGeometry(0.13, 0.3).rotateX(-Math.PI / 2),
      pellet: new THREE.SphereGeometry(0.0026, 6, 4).scale(1, 0.55, 1),
      leaf: new THREE.CircleGeometry(0.011, 12).rotateX(-Math.PI / 2),
    };
  }, [tier, seed]);
  useEffect(
    () => () => {
      for (const g of [geo.jar.glass, geo.jar.water, geo.jar.seed, geo.jar.root, geo.jar.stone, geo.stream, geo.film, geo.pellet, geo.leaf]) g.dispose();
    },
    [geo],
  );
  const mats = useMemo(
    () => ({
      stream: streamMaterial(),
      film: new THREE.MeshStandardMaterial({ color: "#100e0b", transparent: true, opacity: 0, roughness: 0.05, metalness: 0, envMapIntensity: 1.6, depthWrite: false, alphaMap: blobTexture() }),
      pellet: new THREE.MeshStandardMaterial({ color: "#6e4b2b", roughness: 0.62, metalness: 0 }),
      glass: fadingGlass(tier),
      water: jarWaterMaterial(1).clone(),
      halo: haloMaterial().clone(),
    }),
    [tier],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
      kodamPose.tilt = 0;
      kodamPose.lift = 0;
      for (const s of [3, 4, 5]) pondWaterUniforms.uRings.value[s].w = 0;
    },
    [mats],
  );

  const stream = useRef<THREE.Mesh>(null);
  const film = useRef<THREE.Mesh>(null);
  const pellets = useRef<THREE.InstancedMesh>(null);
  const glide = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const fadeJar = useRef<THREE.Group>(null);
  const state = useRef({
    rings: [] as Ring[],
    pose: { tilt: 0, lift: 0, flow: 0 } as PourPose,
    /** the stamps already seen, and when each moment began on the garden clock */
    topUp: 0,
    pourRing: 0,
    spilled: false,
    spillRung: false,
    pinch: 0,
    pinchRung: false,
    glideAt: -1,
    glideRung: false,
  });
  const jar = useMemo(() => jarSpot(seed), [seed]);

  useLayerFrame(() => {
    const S = state.current;
    const t = env.time;
    const now = Date.now();
    const p = garden.get().pond;
    const warm = shown.current < WARM_FRAMES;
    const levelMM = pond.current?.levelMM ?? 0;
    if (!p) {
      kodamPose.tilt = 0;
      kodamPose.lift = 0;
      writeRings(S.rings, t);
      return;
    }

    // the pour (and the spill when the bucket brought the pond to its notch), as the courtyard latched it this frame
    // (pourLive: played from its press whatever its stamp does after, and eased home if it is refused)
    const tp = pourLive.t;
    const refused = pourLive.refused;
    if (pourLive.at !== S.topUp) {
      S.topUp = pourLive.at;
      S.spilled = pourLive.at > 0 && spills(p.waterMM);
      S.spillRung = false;
      S.pourRing = 0;
    }
    // with reduced motion the pot stays on its step: the rings and the rising level tell the top-up
    pourPose(reducedMotion() ? -1 : tp, S.pose, refused);
    kodamPose.tilt = S.pose.tilt;
    kodamPose.lift = S.pose.lift;
    const s = stream.current;
    if (s) {
      s.visible = warm || S.pose.flow > 0.01;
      mats.stream.opacity = 0.75 * S.pose.flow;
      mats.stream.alphaMap!.offset.y = t * 2.2;
    }
    if ((S.pose.flow > 0.3 || (reducedMotion() && tp >= 0.4 && tp < 2.5 && !(refused >= 0 && tp >= refused))) && tp >= S.pourRing) {
      S.pourRing = tp + 0.45;
      ringPond(S.rings, geo.land.x, geo.land.z, t, 1.8, 0.8);
    }
    const wetNow = S.spilled ? spillWet(tp, refused) : { spread: 0, wet: 0 };
    const f = film.current;
    if (f) {
      f.visible = warm || wetNow.wet > 0.01;
      f.scale.set(0.35 + 0.65 * wetNow.spread, 1, 0.35 + 0.65 * wetNow.spread);
      mats.film.opacity = 0.7 * wetNow.wet;
    }
    if (S.spilled && !S.spillRung && wetNow.spread > 0.2) {
      S.spillRung = true;
      ringPond(S.rings, POND.cx - POND.rx + 0.07, NOTCH.z, t, 3, 0.7);
    }

    // the pinch: pellets on the water, taken one by one
    const pt = since(p.pinchAt, now);
    if (p.pinchAt !== S.pinch) {
      S.pinch = p.pinchAt;
      S.pinchRung = false;
    }
    const pm = pellets.current;
    if (pm) {
      const any = pt >= 0 && pt < PELLETS.gone;
      pm.visible = warm || any;
      const y = POND.waterY + levelMM / 1000 + 0.0012;
      for (let i = 0; i < PELLET_SPOTS.length; i++) {
        const q = PELLET_SPOTS[i];
        const left = warm && !any ? 0.001 : pelletLeft(i, pt);
        const drift = Math.max(0, pt) * 0.0009 * q.drift;
        pelletPos.set(q.x + POND.cx + drift, y - 0.04 * (1 - Math.min(1, left * 4)), q.z + POND.cz + drift * 0.5);
        pelletScale.setScalar(Math.max(0.001, left));
        pm.setMatrixAt(i, pelletMat.compose(pelletPos, pelletQuat, pelletScale));
      }
      pm.instanceMatrix.needsUpdate = true;
    }
    if (pt >= PELLETS.land && pt < PELLETS.land + 1 && !S.pinchRung) {
      S.pinchRung = true;
      ringPond(S.rings, FEED_SPOT.x + POND.cx, FEED_SPOT.z + POND.cz, t, 2.6, 0.6);
    }

    // the planting (the courtyard starts it, once per plant on this device)
    if (clock.current.glideAt !== S.glideAt) {
      S.glideAt = clock.current.glideAt;
      S.glideRung = false;
    }
    const g = S.glideAt >= 0 ? glideState(t - S.glideAt) : null;
    const gl = glide.current;
    if (gl) {
      gl.visible = warm || !!g;
      if (g) {
        geo.flightCurve.getPoint(g.along, flight);
        flight.y += (POT_DOWN.y - POT_IN.y) * g.sink;
        gl.position.copy(flight);
        gl.rotation.set(0.3 * Math.sin(g.along * Math.PI), g.along * 2.2, 0);
        courtSubject.kind = "glide";
        courtSubject.at.copy(flight);
        courtSubject.lean = LEAN.glide * (1 - THREE.MathUtils.smoothstep(t - S.glideAt, GLIDE.under, GLIDE.fade));
        if (!S.glideRung && t - S.glideAt >= GLIDE.ring) {
          S.glideRung = true;
          ringPond(S.rings, POT_IN.x, POT_IN.z, t, 4.5, 1);
        }
      }
    }
    const h = halo.current;
    if (h) {
      const breath = 0.85 + 0.15 * Math.sin((t / 5.5) * Math.PI * 2);
      const light = g ? g.light : 0;
      h.scale.setScalar(0.065 * breath);
      mats.halo.opacity = (0.75 + 0.25 * env.nightness) * light * breath;
    }
    const fj = fadeJar.current;
    if (fj) {
      const jarShow = g ? g.jar : 0;
      fj.visible = warm || jarShow > 0.01;
      mats.glass.opacity = jarShow;
      mats.water.opacity = 0.08 * jarShow;
    }
    writeRings(S.rings, t);
  });

  return (
    <group name="lotus-moments">
      <mesh ref={stream} geometry={geo.stream} material={mats.stream} renderOrder={3} visible={false} frustumCulled={false} />
      <mesh ref={film} geometry={geo.film} material={mats.film} position={NOTCH} renderOrder={1} visible={false} />
      <instancedMesh ref={pellets} args={[geo.pellet, mats.pellet, PELLETS.count]} visible={false} frustumCulled={false} />
      <group ref={glide} visible={false}>
        <mesh geometry={geo.jar.seed} material={seedMaterial()} />
        <mesh geometry={geo.jar.root} material={rootMaterial()} scale={1.2} />
        <mesh geometry={geo.leaf} material={padMaterial("float", 0, 0, 0, 11, tier)} position-y={0.008} />
        <sprite ref={halo} material={mats.halo} renderOrder={4} />
      </group>
      <group ref={fadeJar} position={jar.at} rotation-y={jar.yaw + 0.4} visible={false}>
        <group rotation-y={0.4}>
          <mesh geometry={geo.jar.water} material={mats.water} renderOrder={3} />
          <mesh geometry={geo.jar.glass} material={mats.glass} renderOrder={5} />
        </group>
      </group>
    </group>
  );
}

