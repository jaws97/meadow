"use client";
// The lotus being visited, drawn in full: its urli and its plant as the concepts page and the garden draw them
// (components/lotus Urli and LotusPlant), from the friend's own numbers (live/urliLook.ts: the stage, a pod or the
// flower's own opening and warmth, the urli running low when their pond has fallen below its pot), in the urli frame
// with its foot on the soil. VisitedPlant.tsx places it, rocks it in the breeze and hands over to it exactly as it does
// a flower. This mounts it hidden, dresses every part in its dissolving twin (flowerPlant.ts, so it shares its pixels
// with its light plant or picture through the handover), compiles it, and only then shows it and says it is ready.
//
// A lotus in a river pocket is drawn without its urli: the pond view's plant standing in the pocket on its
// pocket-length stalks (live/pocketLook.ts), its frame's water line on the river's surface (VisitedPlant stands it
// there), its floating leaves the very ones the Meadow's pads lay on the pocket (Plants.tsx), which it dissolves in over.
// The river is always full and clear, so its look is the friend's numbers with no low water and no algae: their own
// pond's level and green water belong to their personal pond.
//
// The lotus's parts animate themselves in their own frame loops, writing the garden's shared materials (the flower's
// warmth, the water's clarity) and reading the garden's environment (lib/garden/env: the hour, the sky, the wind),
// which nothing in the Meadow otherwise keeps. So while a lotus is visited, the environment is set from the Meadow's
// own hour and sky before those loops run, and after them each twin takes what was written into its material. The
// flower's warm point light is left off: a light coming and going would recompile every material in the Meadow. And no
// twin lets light through its blade (the standing leaves' transmission): one transmitting material makes the renderer
// draw the whole Meadow a second time every frame, as the full flowers' "lite" leaves avoid too.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Tier } from "@/components/lotus/geometry";
import { pocketLookFromVisual } from "@/components/lotus/live/pocketLook";
import { urliLookFromVisual, type MeadowBand } from "@/components/lotus/live/urliLook";
import { LOTUS_FOOT } from "@/components/lotus/lod";
import { LotusPlant } from "@/components/lotus/LotusPlant";
import { Urli } from "@/components/lotus/Urli";
import type { FriendGarden } from "@/components/meadow/data";
import { dissolveDepth, dissolveTwinOf } from "@/components/meadow/flowerPlant";
import { MEADOW_CLOUD } from "@/components/meadow/MeadowEnvironment";
import { meadow } from "@/components/meadow/runtime";
import { updateEnv } from "@/lib/garden/env";
import type { PondVisual } from "@/lib/sim";

/** The breeze the lotus's leaves bob and sway in (the garden's calm default). */
const WIND = 0.5;
/**
 * How much of the Meadow's plant environment the lotus takes, against what its materials take of the garden's: the
 * Meadow's studio is brighter and bluer overhead, and the bell-metal urli (all reflection) went pale cream in it.
 */
const ENV_SHARE = 0.5;

/** What a part's frame loop may write into its material, copied to its twin every frame. */
type Live = THREE.Material & {
  transmission?: number;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
};

interface Pair {
  src: Live;
  twin: Live;
  /** the source's version when the twin last followed it (a recompile asked of the source is asked of the twin) */
  version: number;
}

/** The lotus's materials and their twins: by source, and the twins themselves. */
interface Dressing {
  bySrc: Map<THREE.Material, Pair>;
  twins: Set<THREE.Material>;
}

/** Dresses every mesh under `g` not yet in its dissolving twin, and its shadow. */
function dress(g: THREE.Object3D, d: Dressing): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || d.twins.has(mesh.material)) return;
    const src = mesh.material as Live;
    let pair = d.bySrc.get(src);
    if (!pair) {
      pair = { src, twin: dissolveTwinOf(src), version: src.version };
      if (pair.twin.transmission) pair.twin.transmission = 0;
      d.bySrc.set(src, pair);
      d.twins.add(pair.twin);
      follow(pair);
    }
    mesh.material = pair.twin;
    mesh.customDepthMaterial = dissolveDepth();
  });
}

/** A twin takes what its source's frame loop wrote, and the Meadow's plant environment at this hour's strength. */
function follow(pair: Pair): void {
  const { src, twin } = pair;
  if (src.version !== pair.version) {
    pair.version = src.version;
    twin.needsUpdate = true;
  }
  if (src.color && twin.color) twin.color.copy(src.color);
  if (src.emissive && twin.emissive) twin.emissive.copy(src.emissive);
  if (src.emissiveIntensity !== undefined) twin.emissiveIntensity = src.emissiveIntensity;
  if (src.roughness !== undefined) twin.roughness = src.roughness;
  if (src.metalness !== undefined) twin.metalness = src.metalness;
  twin.opacity = src.opacity;
  twin.visible = src.visible;
  // the lotus is lit by the soft environment the Meadow's full plants take (its brass is all reflection)
  if (src.envMapIntensity !== undefined) {
    if (twin.envMap !== meadow.plantEnv) {
      twin.envMap = meadow.plantEnv;
      twin.needsUpdate = true;
    }
    twin.envMapIntensity = src.envMapIntensity * meadow.plantEnvStrength * ENV_SHARE;
  }
}

const pondOf = (f: FriendGarden): PondVisual | null => ((f.visual as Partial<PondVisual>).medium === "pond" ? (f.visual as PondVisual) : null);

/**
 * Draws the visited lotus: in its urli, or (`pocket`) standing in a river pocket, its frame turned `pocket.turn` from the
 * pocket's own (its floating leaves are laid out in the pocket's frame).
 */
export function VisitedLotus({ friend, tier, pocket, onReady }: { friend: FriendGarden; tier: Tier; pocket: { turn: number } | null; onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  // the look at the hour the visit began (it is not rebuilt as the hours pass during one visit)
  const turn = pocket ? pocket.turn : null;
  const look = useMemo(() => {
    const v = pondOf(friend);
    const band = friend.stage as MeadowBand;
    return turn === null ? urliLookFromVisual(v, band, meadow.hour, friend.seed) : pocketLookFromVisual(v, band, meadow.hour, friend.seed, { index: friend.plot, turn });
  }, [friend, turn]);
  const group = useRef<THREE.Group>(null);
  const dressing = useRef<Dressing>({ bySrc: new Map(), twins: new Set() });
  const ready = useRef(onReady);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);

  // mounted hidden: every part in its twin, compiled, then shown (once: a visit draws one lotus, its look held)
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    dress(g, dressing.current);
    let live = true;
    void gl
      .compileAsync(g, camera, scene)
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        setShown(true);
        ready.current();
      });
    return () => {
      live = false;
    };
  }, [gl, camera, scene]);

  // before the lotus's own frame loops: the garden's environment at the Meadow's hour and sky
  useFrame((state, dt) => {
    updateEnv(meadow.hour, MEADOW_CLOUD, 0, WIND, state.clock.elapsedTime, Math.min(dt, 0.1));
  }, -1);

  // after them (this subscribes after its children): any part made since in its twin, and every twin following its source
  useFrame(() => {
    const d = dressing.current;
    if (group.current) dress(group.current, d);
    for (const pair of d.bySrc.values()) follow(pair);
  });

  return (
    <group ref={group} visible={shown} position-y={pocket ? 0 : LOTUS_FOOT}>
      {pocket ? null : <Urli vessel="a" tier={tier} look={look} />}
      <LotusPlant look={look} tier={tier} colour="pink" rain={false} glowLight={false} />
    </group>
  );
}
