"use client";
// The garden's tier-dependent parts, drawn as a layer, and the second layer
// that a tier change on a showing garden is built in, out of sight.
//
// A quality tier changes the garden's content (counts, tessellation,
// materials, the post chain) and its lights (the lite tier has no sun shadow
// and no lantern light), so a new tier is new geometry and new shader
// programs. Built in place, behind a held still of the last frame, the
// rebuild and the compile froze the picture for a second and more, three
// and a half on a busy GPU. So once the garden is showing, the new tier is
// mounted as a second, hidden layer beside the live one: React builds it in a
// transition (a part at a time, between frames), RenderBudget's TierPreparer
// compiles its programs in parallel and pre-draws it, and only then is the
// swap made, behind a still held for a few frames: the live layer goes, the
// prepared one shows, and nothing is built or compiled in that moment. Under
// the loading veil (and without parallel compiling) a tier still changes in
// place, as it always has.
//
// Everything that depends on the tier lives in a layer (Scene.tsx), reads its
// tier with useTier() and runs its frame work through useLayerFrame(), which
// does nothing while its layer is hidden. What does not depend on it (the
// clock, the sky, the far woods, the environment map and fog, the camera) is
// shared. A hidden layer is an invisible group: the renderer never draws it
// nor counts its lights. Outside a layer (the party screen) both hooks fall
// back to the garden store's tier and an always-live frame.
import { useFrame, type RenderCallback } from "@react-three/fiber";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { Group, Scene } from "three";
import { TIER_LAYER, withStandIn } from "@/components/garden/warmup";
import { useGarden, type Quality } from "@/lib/garden/store";

interface Stage {
  /** The tier kept on screen while another is prepared; null when the store's tier is the one drawn. */
  hold: Quality | null;
  /** The tier being built in the hidden layer, and whether it is compiled and pre-drawn. */
  preparing: Quality | null;
  ready: boolean;
  /** The governor asked for it (it counts toward the session's tier changes); otherwise it was picked by hand. */
  byGovernor: boolean;
  /** Which of the two layer slots is live (the prepared layer takes the other, and keeps it when it goes live). */
  slot: 0 | 1;
}

let stage: Stage = { hold: null, preparing: null, ready: false, byGovernor: false, slot: 0 };
const listeners = new Set<() => void>();

function setStage(patch: Partial<Stage>) {
  stage = { ...stage, ...patch };
  listeners.forEach((l) => l());
}

export const tierStage = {
  get: () => stage,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /**
   * Builds `to` in the hidden layer while `from` (or the tier already held)
   * stays on screen; asking for the tier on screen drops the preparation.
   */
  prepare(from: Quality, to: Quality, byGovernor: boolean) {
    const shown = stage.hold ?? from;
    if (to === shown) {
      tierStage.cancel();
      return;
    }
    if (stage.preparing === to) return;
    setStage({ hold: shown, preparing: to, ready: false, byGovernor });
  },
  /** The hidden layer's programs are compiled and it has been pre-drawn. */
  markReady(tier: Quality) {
    if (stage.preparing === tier && !stage.ready) setStage({ ready: true });
  },
  /** The prepared layer is now the live one (the caller has set the store's tier to it). */
  swapped() {
    setStage({ hold: null, preparing: null, ready: false, byGovernor: false, slot: stage.slot === 0 ? 1 : 0 });
  },
  cancel() {
    if (stage.hold === null && stage.preparing === null) return;
    setStage({ hold: null, preparing: null, ready: false, byGovernor: false });
  },
};

/** The two layers' groups, by slot, for TierPreparer (RenderBudget) to compile and pre-draw the hidden one. */
export const tierLayerGroups: [Group | null, Group | null] = [null, null];

/**
 * Runs `f` on a stand-in for `scene` in which the hidden layer takes the live
 * one's place (warmup.withStandIn: the same objects, all but the live layer,
 * with the hidden layer shown), so compiles and draws in it see the hidden
 * tier's lights while the live scene's light state never changes. All in one
 * task, so no frame sees the hidden layer shown. False (and `f` not run) when
 * there is no hidden layer.
 */
export function withHiddenLayer(scene: Scene, f: (stand: Scene) => void): boolean {
  const live = tierLayerGroups[stage.slot];
  const hidden = tierLayerGroups[stage.slot === 0 ? 1 : 0];
  if (!live || !hidden || live.parent !== scene || hidden.parent !== scene) return false;
  hidden.visible = true;
  try {
    withStandIn(scene, f, live);
  } finally {
    hidden.visible = false;
  }
  return true;
}

interface LayerContext {
  tier: Quality;
  live: RefObject<boolean>;
}

const TierContext = createContext<LayerContext | null>(null);
const LiveContext = createContext(true);

/** The tier this part is built for: its layer's, or the store's outside a layer. */
export function useTier(): Quality {
  const layer = useContext(TierContext);
  // inside a layer the store's tier is not read at all, so a tier picked by hand re-renders nothing on screen
  const stored = useGarden((s) => (layer ? null : s.quality));
  return layer ? layer.tier : (stored ?? "balanced");
}

/** Whether this part's layer is the live one (always, outside a layer). */
export function useLayerLive(): boolean {
  return useContext(LiveContext);
}

/** useFrame for a layer's part: skipped while the layer is hidden, so a prepared tier never touches the shared state. */
export function useLayerFrame(callback: RenderCallback, priority = 0) {
  const live = useContext(TierContext)?.live;
  useFrame((state, delta, frame) => {
    if (!live || live.current) callback(state, delta, frame);
  }, priority);
}

function TierLayer({ slot, tier, active, children }: { slot: 0 | 1; tier: Quality; active: boolean; children: ReactNode }) {
  const live = useRef(active);
  useLayoutEffect(() => {
    live.current = active;
  }, [active]);
  const value = useMemo<LayerContext>(() => ({ tier, live }), [tier]);
  // marks the group, so the scene-wide warm-up walks (warmup.traverseShown) pass over it while it is hidden
  const userData = useMemo(() => ({ [TIER_LAYER]: true }), []);
  return (
    <group
      visible={active}
      userData={userData}
      ref={(g) => {
        tierLayerGroups[slot] = g;
        return () => {
          if (tierLayerGroups[slot] === g) tierLayerGroups[slot] = null;
        };
      }}
    >
      <TierContext value={value}>
        <LiveContext value={active}>{children}</LiveContext>
      </TierContext>
    </group>
  );
}

/**
 * The live layer, at the tier on screen, and while a tier change is being
 * prepared, the hidden one at the next tier. The live layer keeps its slot's
 * key, so a change made in place (under the veil) re-renders it as before;
 * the hidden one is mounted in a transition and, at the swap, keeps its key
 * and simply goes live.
 */
export function TierLayers({ children }: { children: ReactNode }) {
  const wanted = useGarden((s) => s.quality);
  const hold = useSyncExternalStore(tierStage.subscribe, () => stage.hold, () => null);
  const slot = useSyncExternalStore(tierStage.subscribe, () => stage.slot, () => 0 as const);
  const [building, setBuilding] = useState<Quality | null>(null);
  useEffect(() => {
    const follow = () => {
      const next = stage.preparing;
      // a swap or a cancel drops the hidden layer at once; a new one is built a part at a time
      if (next === null) setBuilding(null);
      else startTransition(() => setBuilding(next));
    };
    follow();
    return tierStage.subscribe(follow);
  }, []);
  const shown = hold ?? wanted;
  const hidden = building !== null && building !== shown ? building : null;
  const other = slot === 0 ? 1 : 0;
  return (
    <>
      <TierLayer key={slot} slot={slot} tier={shown} active>
        {children}
      </TierLayer>
      {hidden && (
        <TierLayer key={other} slot={other} tier={hidden} active={false}>
          {children}
        </TierLayer>
      )}
    </>
  );
}
