"use client";
// window.__lotusReady for screenshot scripts: false while a frame's look is being built and compiled, true once a
// frame with everything compiled has been drawn. On the first load the garden's own opening (RenderBudget.Opening)
// compiles every program in parallel and pre-draws the scene; the flag waits for its first drawn frame. After any
// change of the page's controls the scene's programs are compiled again (renderer.compileAsync, into the composer's
// input buffer as the opening does), then three frames are drawn before the flag goes up. Alongside it,
// window.__lotusStats carries the triangle counts (the lotus alone and the whole scene, instances counted, before
// culling) and the renderer's program count, and for the Meadow river view the river, beds, grounds, cart and urli.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { composerHandle } from "@/components/garden/Effects";
import { quality } from "@/lib/garden/quality";

export interface LotusStats {
  /** triangles in the lotus as drawn this frame: the urli, plant and jar (Meadow view), or the whole pond (pond view) */
  lotus: number;
  /** the plant alone */
  plant: number;
  /** the koi (pond view) */
  koi: number;
  /** the Meadow view's near light plant (L1) beside it, when shown */
  l1: number;
  /** triangles in the whole scene (every visible mesh, instances counted, shadow passes not counted) */
  scene: number;
  /** shader programs the renderer holds */
  programs: number;
  /** the quality tier the frame was built for */
  tier: string;
  /** further parts counted by name (the Meadow river view: the river, the beds, the grounds, the cart, the urli) */
  extra?: Record<string, number>;
}

declare global {
  interface Window {
    __lotusReady?: boolean;
    __lotusStats?: LotusStats;
  }
}

const SETTLE_FRAMES = 3;
/**
 * After a change made on the page (not a fresh load), the garden's eased weather (the lawn's wetness, the lantern
 * warming up) and a day/night light-set switch prepared in the background need a moment: at least this long (ms).
 * A fresh load of an address primes them at once, so scripts should load each frame by its address.
 */
const CHANGE_SETTLE_MS = 2500;

/** Visible triangles under `root`, instanced meshes counted per instance. */
export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
      n += tris * inst;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return Math.round(n);
}

export function ReadyFlag({ sceneKey, lotusName, tier, extra }: { sceneKey: string; lotusName: string; tier: string; extra?: Record<string, string> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const state = useRef({ compiled: false, frames: 0, key: "", loads: 0, since: 0 });

  useEffect(() => {
    window.__lotusReady = false;
    const s = state.current;
    s.compiled = false;
    s.frames = 0;
    s.key = sceneKey;
    s.loads++;
    s.since = performance.now();
    let cancelled = false;
    (async () => {
      // the opening's first frame comes first (its compile is the heavy one)
      while (!cancelled) {
        const p = quality.get().phase;
        if (p === "calibrating" || p === "revealing" || p === "live") break;
        await new Promise((r) => window.setTimeout(r, 50));
      }
      if (cancelled) return;
      const target = composerHandle.current?.inputBuffer ?? null;
      const previous = gl.getRenderTarget();
      try {
        gl.setRenderTarget(target);
        await gl.compileAsync(scene, camera);
      } catch {
        // whatever was missed compiles on the next frames, before the flag goes up
      } finally {
        gl.setRenderTarget(previous);
      }
      if (!cancelled && state.current.key === sceneKey) state.current.compiled = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [sceneKey, gl, scene, camera]);

  // after the composer has drawn (priority 1)
  useFrame(() => {
    const s = state.current;
    if (!s.compiled || window.__lotusReady) return;
    s.frames++;
    if (s.frames < SETTLE_FRAMES) return;
    if (s.loads > 1 && performance.now() - s.since < CHANGE_SETTLE_MS) return;
    const lotus = scene.getObjectByName(lotusName);
    const l1 = scene.getObjectByName("lotus-l1");
    const plant = scene.getObjectByName("lotus");
    const koi = scene.getObjectByName("koi");
    window.__lotusStats = {
      lotus: lotus ? countTriangles(lotus) : 0,
      plant: plant ? countTriangles(plant) : 0,
      koi: koi ? countTriangles(koi) : 0,
      l1: l1 ? countTriangles(l1) : 0,
      scene: countTriangles(scene),
      programs: gl.info.programs?.length ?? 0,
      tier,
    };
    if (extra) {
      const counts: Record<string, number> = {};
      for (const [k, name] of Object.entries(extra)) {
        const o = scene.getObjectByName(name);
        counts[k] = o ? countTriangles(o) : 0;
      }
      window.__lotusStats.extra = counts;
    }
    window.__lotusReady = true;
    window.dispatchEvent(new CustomEvent("lotus-ready", { detail: window.__lotusStats }));
  }, 3);

  return null;
}
