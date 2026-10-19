"use client";
// A gentle burst of light where a seed has just been planted: a soft column of warm light rises from the plot and
// fades, a ring of light spreads over the soil, and a few motes drift up, all over about three seconds, while the
// new plant itself rises out of the soil (Plants.tsx). On the big screen at the party, every new planting round
// the rose is marked this way within seconds of someone tapping "Plant". Additive light, a small pool reused, and
// nothing drawn while no burst is running.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadowData } from "@/components/meadow/data";
import { plotAt } from "@/components/meadow/layout";

const POOL = 12;
const MOTES = 10;
const LIFE = 3.2;
const GOLD = new THREE.Color("#ffd28a");
const WATER = new THREE.Color("#a8dcff");

interface Burst {
  x: number;
  /** the plot's foot: a bed's soil, or the river's water in a pocket */
  y: number;
  z: number;
  start: number;
  /** a planting rises in gold; a friend's sprinkle falls as a soft shower of blue-white motes */
  kind: "plant" | "sprinkle";
}

const asked: Array<{ plot: number; at: number }> = [];

/** A sprinkle's little shower of light over a plant (the visit card calls this when one lands). */
export function sprinkleAt(plot: number): void {
  asked.push({ plot, at: performance.now() });
}

/** A vertical gradient, bright at the foot and gone at the top, for the column and the motes' glow. */
function gradientTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(160,160,160,1)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.75, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function Bursts() {
  const bursts = useRef<Burst[]>([]);
  const seen = useRef(new Set<number>());
  const columns = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const motes = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const column = new THREE.CylinderGeometry(0.32, 0.42, 3.2, 16, 1, true);
    column.translate(0, 1.6, 0);
    const ring = new THREE.PlaneGeometry(1, 1);
    ring.rotateX(-Math.PI / 2);
    const mote = new THREE.SphereGeometry(0.035, 6, 4);
    const base = { transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;
    const grad = gradientTexture();
    const ringTex = ringTexture();
    return {
      column,
      ring,
      mote,
      grad,
      ringTex,
      columnMat: new THREE.MeshBasicMaterial({ ...base, map: grad }),
      ringMat: new THREE.MeshBasicMaterial({ ...base, map: ringTex }),
      moteMat: new THREE.MeshBasicMaterial({ ...base }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const v of Object.values(res)) (v as { dispose(): void }).dispose();
    },
    [res],
  );

  // new plots from the snapshot become bursts (the first snapshot marks nothing: those plants were already there)
  useEffect(() => {
    const take = () => {
      const now = performance.now();
      for (const [plot, at] of meadowData.get().appeared) {
        if (seen.current.has(plot) || now - at > 5000) continue;
        seen.current.add(plot);
        const p = plotAt(plot);
        if (!p) continue;
        bursts.current.push({ x: p.x, y: p.y, z: p.z, start: at / 1000, kind: "plant" });
        if (bursts.current.length > POOL) bursts.current.shift();
      }
    };
    take();
    return meadowData.subscribe(take);
  }, []);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() }), []);
  useFrame(() => {
    const now = performance.now() / 1000;
    while (asked.length > 0) {
      const a = asked.shift()!;
      const p = plotAt(a.plot);
      if (p) bursts.current.push({ x: p.x, y: p.y, z: p.z, start: a.at / 1000, kind: "sprinkle" });
      if (bursts.current.length > POOL) bursts.current.shift();
    }
    bursts.current = bursts.current.filter((b) => now - b.start < LIFE);
    const col = columns.current, ring = rings.current, mote = motes.current;
    if (!col || !ring || !mote) return;
    let n = 0;
    let k = 0;
    for (const b of bursts.current) {
      const t = (now - b.start) / LIFE;
      // swells in quickly, fades out slowly
      const fade = Math.min(1, t * 6) * Math.pow(1 - t, 1.6);
      const sprinkle = b.kind === "sprinkle";
      const tone = sprinkle ? WATER : GOLD;
      const columnK = sprinkle ? 0.12 : 0.55;
      tmp.m.compose(tmp.p.set(b.x, b.y, b.z), tmp.q.identity(), tmp.s.set(1 + t * 0.4, 0.4 + t * 0.9, 1 + t * 0.4));
      col.setMatrixAt(n, tmp.m);
      col.setColorAt(n, tmp.c.copy(tone).multiplyScalar(fade * columnK));
      const r = (sprinkle ? 0.3 : 0.5) + t * (sprinkle ? 1.4 : 2.6);
      tmp.m.compose(tmp.p.set(b.x, b.y + 0.02, b.z), tmp.q.identity(), tmp.s.set(r, 1, r));
      ring.setMatrixAt(n, tmp.m);
      ring.setColorAt(n, tmp.c.copy(tone).multiplyScalar(fade * 0.8));
      n++;
      for (let i = 0; i < MOTES; i++) {
        const a = (i / MOTES) * Math.PI * 2 + t * 2.2;
        const rr = sprinkle ? 0.12 + (i % 4) * 0.07 : 0.18 + 0.35 * t + (i % 3) * 0.05;
        // a planting's motes drift up; a sprinkle's fall softly onto the plant
        const y = sprinkle ? b.y + 1.6 - ((t * 1.6 + (i % 5) * 0.21) % 1) * 1.5 : b.y + 0.2 + t * (1.6 + (i % 4) * 0.35);
        const s = (0.7 + (i % 3) * 0.3) * (1 - t * 0.6);
        tmp.m.compose(tmp.p.set(b.x + Math.cos(a) * rr, y, b.z + Math.sin(a) * rr), tmp.q.identity(), tmp.s.set(s, s, s));
        mote.setMatrixAt(k, tmp.m);
        mote.setColorAt(k, tmp.c.copy(tone).multiplyScalar(fade * 1.4));
        k++;
      }
    }
    col.count = n;
    ring.count = n;
    mote.count = k;
    for (const m of [col, ring, mote]) {
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={columns} args={[res.column, res.columnMat, POOL]} frustumCulled={false} renderOrder={4} visible={false} />
      <instancedMesh ref={rings} args={[res.ring, res.ringMat, POOL]} frustumCulled={false} renderOrder={4} visible={false} />
      <instancedMesh ref={motes} args={[res.mote, res.moteMat, POOL * MOTES]} frustumCulled={false} renderOrder={4} visible={false} />
    </>
  );
}
