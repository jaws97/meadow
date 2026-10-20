"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes, the scene's fog) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// Every planted plot in the Meadow: a seed of light in its mound (with a soft glow on the soil round it, so a ring of
// new seeds reads as a ring of little lights from across the room) or a plant resting after it died, and a name
// stake in front of every plant, facing the path, with the name painted on its board. Empty plots grow soft
// wildflowers. A plant that has just been planted rises out of the soil, and Bursts.tsx marks the moment with light.
//
// The growing plants (a sprout, a leafy young plant, a plant in bud or in bloom) are drawn at the detail each deserves
// by lod/LodPlants.tsx: the garden's own flower, lightly built, near the camera, and a picture of it farther off.
// Until its pictures have arrived (or if they never do) they are drawn here the old cheap way: the plant at its stage
// in its species' leaf colour with the species' own bud or flower on top (a closed flower drawn as its bud).
//
// A lotus is planted in the river, in one of its pockets (plots.ts), and floats on the pocket's water from the day it is
// planted: its seed of light over the water while the seed is in its jar, then its floating leaves, spread over the
// pocket's shelf inside the sill stones (live/pocketLook.ts), green as it grows and browned while it rests. They lie
// flat on the water, so they are drawn here at every distance (a picture taken at 45 degrees cannot show them from the
// overview), one instanced leaf apiece, all in one draw; the plant standing over them once it has standing leaves is
// the detail levels' (LodPlants.tsx, its own kind: lotusRiver). They are the visit's own floating leaves, laid out the
// same way, and dissolve into the full plant's as it takes over (lod/materials.ts POCKET_HANDOVER).
// A lotus planted once every pocket was taken stands in a brass urli on its bed plot instead (components/lotus/lod.ts
// makeLotusPlot): the seed of light hovers over the urli's water while the seed is in its jar, its floating leaves lie
// browned on the water while it rests, and until the pictures arrive a growing lotus is the urli with green floating
// leaves (never a stem and head). Either stands level, turned to its plot's angle, as its full plant stands.
//
// Cost: about twenty draw calls here, whatever the Meadow's size. Seeds, resting plants, the stakes, the signs (one
// texture of names, nameAtlas.ts) and the wildflowers are each one instanced mesh; instances are rewritten only when
// the snapshot changes (or a plant is visited), never per frame, apart from the few seconds a new plant takes to
// rise. On phones the plants cast no shadows. The plant being visited is left out here and drawn in full by
// VisitedPlant.
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { meadowData, useMeadowData } from "@/components/meadow/data";
import { BED, plotOf, type MeadowLayout } from "@/components/meadow/layout";
import { plotSpin, SPINS } from "@/components/meadow/lod/bands";
import { handover } from "@/components/meadow/lod/handover";
import { LodPlants, lodStatus } from "@/components/meadow/lod/LodPlants";
import { patchPocketPads, POCKET_HANDOVER } from "@/components/meadow/lod/materials";
import { NameAtlas, signMaterial, syncSignMaterial } from "@/components/meadow/nameAtlas";
import { liveGlowMaterial, merge, paint } from "@/components/meadow/parts";
import { PLANT_SCALE, speciesHeight, STAGE_SHARE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import {
  bloomHeadGeometry,
  budHeadGeometry,
  leafyGeometry,
  restingGeometry,
  seedGeometry,
  signFaceGeometry,
  sproutGeometry,
  stakeGeometry,
  tallGeometry,
} from "@/components/meadow/sprouts";
import { URLI, waterY } from "@/components/lotus/frame";
import { pocketPads } from "@/components/lotus/live/pocketLook";
import type { MeadowBand } from "@/components/lotus/live/urliLook";
import { LOTUS_FOOT, makeLotusPlot, pocketPadGeometry, type LotusPlotKind } from "@/components/lotus/lod";
import { lerp } from "@/lib/plant/prng";
import { isLotus, SPECIES, type SpeciesId } from "@/lib/plant/species";

const SPECIES_IDS: readonly SpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine", "lily", "lotus"];
type Foliage = "sprout" | "leafy" | "tall" | "resting";
const FOLIAGE: readonly Foliage[] = ["sprout", "leafy", "tall", "resting"];
/** The species drawn as a stem and a head here (the lotus is drawn in its urli instead). */
const HEADED = SPECIES_IDS.filter((id) => !isLotus(id));
const LOTUS_KINDS: readonly LotusPlotKind[] = ["seed", "pads", "resting"];
/** Where the urli's water stands above the soil in the Meadow (its seed's glow lies on it), metres. */
const LOTUS_WATER_Y = BED.soilH + (LOTUS_FOOT + waterY(URLI.fillMM)) * PLANT_SCALE;
/** How long a new plant takes to rise out of the soil, ms. */
const RISE_MS = 1600;
const UP = new THREE.Vector3(0, 1, 0);
const GOLD = new THREE.Color("#ffcf66");
const WHITE = new THREE.Color(1, 1, 1);
const POORLY = new THREE.Color("#b3a35e");
/** A river pocket's floating leaves: the pond's floating-leaf green (its textured blade's average) or browned. */
const PAD_GREEN = new THREE.Color("#447a64");
const PAD_BROWN = new THREE.Color("#8f7a55");
/** The most floating leaves a pocket carries (live/pocketLook.ts pocketFloats). */
const POCKET_PADS_MAX = 14;

/** A stable pseudo-random number in [0, 1) for plot i and channel k. */
const hash = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const easeOutBack = (t: number) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** The species' leaf colour as the instances wear it: between its leaf and tip greens, a little lifted. */
function leafTint(id: SpeciesId, out: THREE.Color): THREE.Color {
  const l = SPECIES[id].leaves;
  return out.set(l.color).lerp(new THREE.Color(l.tipColor), 0.55).multiplyScalar(1.3);
}

interface Rising {
  start: number;
  items: Array<{ mesh: THREE.InstancedMesh; i: number; base: THREE.Matrix4; at: THREE.Vector3 }>;
}

function wildflowerGeometries(): { leaves: THREE.BufferGeometry; blossoms: THREE.BufferGeometry } {
  const leaves: THREE.BufferGeometry[] = [];
  const blossoms: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const blade = new THREE.ConeGeometry(0.03, 0.14, 3, 1, true);
    blade.translate(0, 0.07, 0);
    blade.rotateZ(0.6);
    blade.rotateY(a);
    blade.deleteAttribute("uv");
    leaves.push(paint(blade, k % 2 ? "#79a35a" : "#8db86a"));
  }
  const heads: Array<[number, number, number]> = [
    [0.05, 0.16, 0.02],
    [-0.06, 0.12, 0.03],
    [0.01, 0.2, -0.05],
    [-0.02, 0.1, -0.07],
  ];
  heads.forEach(([x, y, z], k) => {
    const st = new THREE.CylinderGeometry(0.003, 0.004, y, 4, 1, true);
    st.translate(x * 0.6, y / 2, z * 0.6);
    st.deleteAttribute("uv");
    leaves.push(paint(st, "#6f9a52"));
    const flower = new THREE.CircleGeometry(0.03 + (k % 2) * 0.008, 5);
    flower.rotateX(-Math.PI / 2 + 0.3);
    flower.translate(x, y, z);
    flower.deleteAttribute("uv");
    blossoms.push(paint(flower, "#ffffff", 0.4));
    const eye = new THREE.CircleGeometry(0.009, 5);
    eye.rotateX(-Math.PI / 2 + 0.3);
    eye.translate(x, y + 0.002, z);
    eye.deleteAttribute("uv");
    blossoms.push(paint(eye, "#fff1a8", 0.6));
  });
  return { leaves: merge(leaves), blossoms: merge(blossoms) };
}

/** A flat disc lying on the soil, for a seed's glow. */
function haloGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** The glow round a seed of light: warm at the heart, gone by the edge. */
function haloTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,230,170,0.9)");
  g.addColorStop(0.3, "rgba(255,200,120,0.35)");
  g.addColorStop(1, "rgba(255,180,90,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WILD = ["#fffaf2", "#eadcff", "#fff2b0", "#ffdbe4", "#dcecff", "#fffaf2"].map((c) => new THREE.Color(c));

export function Plants({ layout: L, shadows }: { layout: MeadowLayout; shadows: boolean }) {
  const cap = L.plots.length;
  const version = useMeadowData((d) => d.version);

  const geos = useMemo(() => {
    const wild = wildflowerGeometries();
    return {
      seed: seedGeometry(),
      foliage: { sprout: sproutGeometry(), leafy: leafyGeometry(), tall: tallGeometry(), resting: restingGeometry() } as Record<Foliage, THREE.BufferGeometry>,
      bud: Object.fromEntries(HEADED.map((id) => [id, budHeadGeometry(id)])) as Partial<Record<SpeciesId, THREE.BufferGeometry>>,
      bloom: Object.fromEntries(HEADED.map((id) => [id, bloomHeadGeometry(id)])) as Partial<Record<SpeciesId, THREE.BufferGeometry>>,
      lotus: Object.fromEntries(LOTUS_KINDS.map((k) => [k, makeLotusPlot(k)])) as Record<LotusPlotKind, THREE.BufferGeometry>,
      pocketSeed: makeLotusPlot("seed", { vessel: false }),
      pad: pocketPadGeometry(),
      stake: stakeGeometry(),
      sign: signFaceGeometry(),
      wildLeaves: wild.leaves,
      wildBlossoms: wild.blossoms,
      halo: haloGeometry(),
    };
  }, []);
  const atlas = useMemo(() => new NameAtlas(), []);
  const padCap = L.river.pockets.length * POCKET_PADS_MAX;
  const mats = useMemo(() => {
    // the pockets' floating leaves, with their side of a visit's handover
    const pads = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
    pads.onBeforeCompile = patchPocketPads;
    pads.customProgramCacheKey = () => "meadow-pocket-pads";
    const seed = liveGlowMaterial({ roughness: 0.9 }, "seed");
    const heads = Object.fromEntries(HEADED.map((id) => [id, liveGlowMaterial({ roughness: 0.6, side: THREE.DoubleSide }, `head-${id}`)])) as Partial<
      Record<SpeciesId, ReturnType<typeof liveGlowMaterial>>
    >;
    const wild = liveGlowMaterial({ roughness: 0.8, side: THREE.DoubleSide }, "wild");
    return {
      seed,
      heads,
      wild,
      pads,
      foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }),
      stake: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      sign: signMaterial(atlas),
      wildLeaves: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      halo: new THREE.MeshBasicMaterial({ map: haloTexture(), color: "#ffd38a", transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0.4 }),
    };
  }, [atlas]);
  // each sign's cell in the name atlas, per instance
  const cellAttr = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2), [cap]);
  useLayoutEffect(() => {
    geos.sign.setAttribute("aCell", cellAttr);
  }, [geos, cellAttr]);
  useEffect(
    () => () => {
      geos.seed.dispose();
      for (const g of Object.values(geos.foliage)) g.dispose();
      for (const g of Object.values(geos.bud)) g.dispose();
      for (const g of Object.values(geos.bloom)) g.dispose();
      for (const g of Object.values(geos.lotus)) g.dispose();
      geos.pocketSeed.dispose();
      geos.pad.dispose();
      mats.pads.dispose();
      geos.stake.dispose();
      geos.sign.dispose();
      geos.wildLeaves.dispose();
      geos.wildBlossoms.dispose();
      mats.seed.material.dispose();
      for (const h of Object.values(mats.heads)) h.material.dispose();
      mats.wild.material.dispose();
      mats.foliage.dispose();
      mats.stake.dispose();
      mats.sign.dispose();
      mats.wildLeaves.dispose();
      geos.halo.dispose();
      mats.halo.map?.dispose();
      mats.halo.dispose();
      atlas.dispose();
    },
    [geos, mats, atlas],
  );

  const seedRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const foliageRefs = useRef<Partial<Record<Foliage, THREE.InstancedMesh | null>>>({});
  const budRefs = useRef<Partial<Record<SpeciesId, THREE.InstancedMesh | null>>>({});
  const bloomRefs = useRef<Partial<Record<SpeciesId, THREE.InstancedMesh | null>>>({});
  const lotusRefs = useRef<Partial<Record<LotusPlotKind, THREE.InstancedMesh | null>>>({});
  const pocketSeedRef = useRef<THREE.InstancedMesh>(null);
  const padRef = useRef<THREE.InstancedMesh>(null);
  const stakeRef = useRef<THREE.InstancedMesh>(null);
  const signRef = useRef<THREE.InstancedMesh>(null);
  const wildLeavesRef = useRef<THREE.InstancedMesh>(null);
  const wildBlossomsRef = useRef<THREE.InstancedMesh>(null);
  const rising = useRef<Rising[]>([]);
  const built = useRef({ version: -1, detail: -2, mine: -2, lod: false });

  const rebuild = useCallback(() => {
    const d = meadowData.get();
    const all: THREE.InstancedMesh[] = [];
    const counts = new Map<THREE.InstancedMesh, number>();
    const take = (mesh: THREE.InstancedMesh | null | undefined) => {
      if (!mesh) return -1;
      if (!counts.has(mesh)) {
        counts.set(mesh, 0);
        all.push(mesh);
      }
      const i = counts.get(mesh)!;
      counts.set(mesh, i + 1);
      return i;
    };
    for (const m of [seedRef.current, haloRef.current, stakeRef.current, signRef.current, wildLeavesRef.current, wildBlossomsRef.current, ...Object.values(foliageRefs.current), ...Object.values(budRefs.current), ...Object.values(bloomRefs.current), ...Object.values(lotusRefs.current), pocketSeedRef.current, padRef.current]) {
      if (m) {
        counts.set(m, 0);
        all.push(m);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qSpin = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tilt = new THREE.Vector3();
    const color = new THREE.Color();
    const qPad = new THREE.Quaternion();
    const leaf = new THREE.Vector3();
    const now = performance.now();
    const risingNow: Rising[] = [];
    const plots = [...d.byPlot.values()].sort((a, b) => a.plot - b.plot);
    // the growing plants are LodPlants' once its pictures are in
    const lod = lodStatus.ready;
    // every name a cell first, so a growing atlas never leaves a sign pointing at the old layout
    for (const p of plots) atlas.cellOf(p.name);
    syncSignMaterial(mats.sign, atlas);

    for (const p of plots) {
      const plot = plotOf(L, p.plot);
      if (!plot) continue;
      const appearedAt = d.appeared.get(p.plot);
      const rise: Rising | null = appearedAt !== undefined && now - appearedAt < RISE_MS ? { start: appearedAt, items: [] } : null;
      const place = (mesh: THREE.InstancedMesh | null | undefined, matrix: THREE.Matrix4, tint: THREE.Color | null) => {
        const i = take(mesh);
        if (!mesh || i < 0) return;
        mesh.setMatrixAt(i, matrix);
        if (tint) mesh.setColorAt(i, tint);
        if (rise) rise.items.push({ mesh, i, base: matrix.clone(), at: new THREE.Vector3(plot.x, plot.y, plot.z) });
      };
      // the path side, for leaning a bloom's face toward visitors
      const toward = plot.side === "inner" ? -1 : 1;
      const px = Math.cos(plot.a) * toward, pz = Math.sin(plot.a) * toward;
      const spin = hash(p.plot, 1) * Math.PI * 2;

      // the stake and its name, always (also for the plant being visited)
      q.setFromAxisAngle(UP, plot.stake.yaw);
      m.compose(pos.set(plot.stake.x, plot.stake.y, plot.stake.z), q, scl.set(1, 1, 1));
      const si = take(stakeRef.current);
      if (stakeRef.current && si >= 0) {
        stakeRef.current.setMatrixAt(si, m);
        stakeRef.current.setColorAt(si, p.plot === meadow.myPlot ? GOLD : WHITE);
      }
      const gi = take(signRef.current);
      if (signRef.current && gi >= 0) {
        signRef.current.setMatrixAt(gi, m);
        const [u, v] = atlas.cellOf(p.name);
        cellAttr.setXY(gi, u, v);
      }
      // a lotus in a river pocket: its seed of light on the water, or its floating leaves (drawn through a visit too: they
      // hand over to the full plant's own by the dissolve)
      if (isLotus(p.species) && plot.kind === "pocket") {
        if (p.stage === "seed") {
          m.compose(pos.set(plot.x, plot.y, plot.z), qSpin.identity(), scl.set(PLANT_SCALE, PLANT_SCALE, PLANT_SCALE));
          place(pocketSeedRef.current, m, null);
          m.compose(pos.set(plot.x, plot.y + 0.004, plot.z), qSpin.identity(), scl.set(0.62, 1, 0.62));
          place(haloRef.current, m, null);
        } else {
          // laid out in the pocket's frame (facing the channel), as the visit's full plant lays them
          const face = qSpin.setFromAxisAngle(UP, plot.yaw ?? 0);
          const tone = 0.94 + 0.12 * hash(p.plot, 9);
          for (const f of pocketPads(p.stage as MeadowBand, p.plot)) {
            const s = f.r * PLANT_SCALE;
            leaf.set(f.x, f.y, f.z).multiplyScalar(PLANT_SCALE).applyQuaternion(face);
            qPad.setFromAxisAngle(UP, f.yaw).premultiply(face);
            m.compose(pos.set(plot.x + leaf.x, plot.y + leaf.y, plot.z + leaf.z), qPad, scl.set(s, s, s));
            place(padRef.current, m, color.copy(f.brown > 0 ? PAD_BROWN : PAD_GREEN).multiplyScalar(tone * (0.96 + 0.08 * hash(p.plot * 31 + f.seed, 2))));
          }
        }
        if (rise) risingNow.push(rise);
        continue;
      }
      if (p.plot === meadow.detailPlot) continue;

      if (isLotus(p.species)) {
        // on a bed plot (every pocket was taken), the urli, level on the soil, turned to its plot's angle (as its detail
        // levels stand)
        const kind: LotusPlotKind | null = p.stage === "seed" ? "seed" : p.stage === "resting" ? "resting" : lod ? null : "pads";
        if (!kind) continue;
        m.compose(pos.set(plot.x, plot.y, plot.z), qSpin.setFromAxisAngle(UP, SPINS[plotSpin(p.plot)]), scl.set(PLANT_SCALE, PLANT_SCALE, PLANT_SCALE));
        place(lotusRefs.current[kind], m, null);
        // the seed's soft glow on the water, a little wider than the urli
        if (kind === "seed") {
          m.compose(pos.set(plot.x, LOTUS_WATER_Y + 0.004, plot.z), qSpin.identity(), scl.set(0.62, 1, 0.62));
          place(haloRef.current, m, null);
        }
        if (rise) risingNow.push(rise);
        continue;
      }

      const h = speciesHeight(p.species) * (0.92 + 0.16 * hash(p.plot, 2));
      // a poorly plant leans and pales a little; a thriving one stands bright
      const lean = p.health === "poorly" ? 0.22 : 0.04 * hash(p.plot, 3);
      tilt.set(px * Math.sin(lean) + hash(p.plot, 4) * 0.02, Math.cos(lean), pz * Math.sin(lean)).normalize();
      q.setFromUnitVectors(UP, tilt).multiply(qSpin.setFromAxisAngle(UP, spin));
      leafTint(p.species, color);
      if (p.health === "poorly") color.lerp(POORLY, 0.45);
      else if (p.health === "thriving") color.multiplyScalar(1.06);

      if (p.stage === "seed") {
        const s = (0.92 + 0.16 * hash(p.plot, 5)) * PLANT_SCALE;
        m.compose(pos.set(plot.x, plot.y - 0.01, plot.z), qSpin.setFromAxisAngle(UP, spin), scl.set(s, s, s));
        place(seedRef.current, m, null);
        // and its soft glow on the soil, so three hundred seeds read as a field of little lights from far away
        // (just above the mound's crown, so the light spreads over the mound rather than ringing a dark hole)
        m.compose(pos.set(plot.x, plot.y + 0.075, plot.z), qSpin.identity(), scl.set(1.15, 1, 1.15));
        place(haloRef.current, m, null);
        if (rise) risingNow.push(rise);
        continue;
      }
      if (lod && p.stage !== "resting") continue;
      const kind: Foliage = p.stage === "sprout" ? "sprout" : p.stage === "leafy" ? "leafy" : p.stage === "resting" ? "resting" : "tall";
      // the tall plant is built a metre high: a bud stands at its stage's share of the species' height
      const share = kind === "tall" ? STAGE_SHARE[p.stage] : 1;
      const s = h * share;
      m.compose(pos.set(plot.x, plot.y, plot.z), q, scl.set(s, s, s));
      place(foliageRefs.current[kind], m, kind === "resting" ? WHITE : color);

      if (p.stage === "bud" || p.stage === "bloom") {
        // the head rides the top of the stem, following the plant's lean
        const top = pos.set(plot.x, plot.y, plot.z).addScaledVector(tilt, s * 0.99);
        // a flower open now is drawn open, whatever its stage says
        const open = p.bloom > 0;
        if (open) {
          // an open flower turns its face a little toward the path, and opens wider as the hours go
          const faceLean = 0.3 + (p.health === "poorly" ? 0.3 : 0);
          tilt.set(px * Math.sin(faceLean), Math.cos(faceLean), pz * Math.sin(faceLean)).normalize();
          q.setFromUnitVectors(UP, tilt).multiply(qSpin.setFromAxisAngle(UP, spin));
          const o = [0.7, 0.72, 0.86, 1][p.bloom] * PLANT_SCALE;
          m.compose(top, q, scl.set(o, 0.92 * o, o));
          place(bloomRefs.current[p.species], m, null);
        } else {
          m.compose(top, q, scl.set(PLANT_SCALE, PLANT_SCALE, PLANT_SCALE));
          place(budRefs.current[p.species], m, null);
        }
      }
      if (rise) risingNow.push(rise);
    }

    // wildflowers in every bed plot nobody has planted yet (an empty pocket is open water)
    for (const plot of L.plots) {
      if (plot.kind !== "bed" || d.byPlot.has(plot.index)) continue;
      const s = 0.85 + 0.4 * hash(plot.index, 6);
      m.compose(pos.set(plot.x, BED.soilH, plot.z), qSpin.setFromAxisAngle(UP, hash(plot.index, 7) * Math.PI * 2), scl.set(s, s, s));
      const li = take(wildLeavesRef.current);
      if (wildLeavesRef.current && li >= 0) wildLeavesRef.current.setMatrixAt(li, m);
      const bi = take(wildBlossomsRef.current);
      if (wildBlossomsRef.current && bi >= 0) {
        wildBlossomsRef.current.setMatrixAt(bi, m);
        wildBlossomsRef.current.setColorAt(bi, WILD[Math.floor(hash(plot.index, 8) * WILD.length)]);
      }
    }

    for (const mesh of all) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    cellAttr.needsUpdate = true;
    rising.current = risingNow;
  }, [L, atlas, cellAttr, mats.sign]);

  // the instance colours must exist before the first rebuild writes them
  useLayoutEffect(() => {
    const meshes = [stakeRef.current, wildBlossomsRef.current, ...Object.values(foliageRefs.current)];
    for (const mesh of meshes) {
      if (mesh && !mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    }
    const pads = padRef.current;
    if (pads && !pads.instanceColor) pads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(padCap * 3).fill(1), 3);
  }, [cap, padCap]);

  useLayoutEffect(() => {
    rebuild();
    built.current = { version, detail: meadow.detailPlot, mine: meadow.myPlot, lod: lodStatus.ready };
  }, [version, rebuild]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), t: new THREE.Matrix4(), s: new THREE.Matrix4() }), []);
  useFrame((state) => {
    const b = built.current;
    if (b.detail !== meadow.detailPlot || b.mine !== meadow.myPlot || b.lod !== lodStatus.ready) {
      rebuild();
      b.detail = meadow.detailPlot;
      b.mine = meadow.myPlot;
      b.lod = lodStatus.ready;
    }
    // night: the seeds of light and the flowers' own glow come up
    const t = state.clock.elapsedTime;
    const night = meadow.night;
    mats.seed.glow.value = (0.6 + 1.9 * night) * (0.9 + 0.1 * Math.sin(t * 1.7));
    mats.halo.opacity = (0.5 + 0.45 * night) * (0.9 + 0.1 * Math.sin(t * 1.7));
    for (const id of HEADED) {
      const f = SPECIES[id].flower;
      const pulse = SPECIES[id].fx.pulse ? 0.8 + 0.2 * Math.sin(t * 1.4) : 1;
      // a floor of the petals' own colour, so a flower seen from behind (its face turned to the far path) is a soft
      // shade of itself rather than a dark shape
      mats.heads[id]!.glow.value = Math.max(0.24, lerp(f.emissiveDay * 1.5, f.emissiveNight * 0.9, night) * pulse);
    }
    mats.wild.glow.value = 0.1 + 0.6 * night;
    // a visited pocket's floating leaves hand over to its full plant's
    const handed = handover.plot >= 0 ? plotOf(L, handover.plot) : null;
    if (handed && handed.kind === "pocket") {
      POCKET_HANDOVER.uHandFoot.value.set(handed.x, handed.y, handed.z);
      POCKET_HANDOVER.uHandShare.value = handover.share;
    } else {
      POCKET_HANDOVER.uHandFoot.value.set(1e4, 0, 1e4);
      POCKET_HANDOVER.uHandShare.value = 0;
    }
    // new plants rise out of the soil
    if (rising.current.length === 0) return;
    const now = performance.now();
    const touched = new Set<THREE.InstancedMesh>();
    rising.current = rising.current.filter((r) => {
      const k = Math.min(1, Math.max(0, (now - r.start) / RISE_MS));
      const s = Math.max(0.0001, easeOutBack(k));
      for (const it of r.items) {
        tmp.t.makeTranslation(it.at.x, it.at.y, it.at.z);
        tmp.s.makeScale(s, s, s);
        tmp.m.makeTranslation(-it.at.x, -it.at.y, -it.at.z);
        tmp.m.premultiply(tmp.s).premultiply(tmp.t).multiply(it.base);
        it.mesh.setMatrixAt(it.i, tmp.m);
        touched.add(it.mesh);
      }
      return k < 1;
    });
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  });

  const plantShadows = shadows;
  return (
    <group>
      <instancedMesh ref={seedRef} args={[geos.seed, mats.seed.material, cap]} castShadow={plantShadows} frustumCulled={false} />
      <instancedMesh ref={haloRef} args={[geos.halo, mats.halo, cap]} frustumCulled={false} renderOrder={4} />
      {FOLIAGE.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(el) => {
            foliageRefs.current[kind] = el;
          }}
          args={[geos.foliage[kind], mats.foliage, cap]}
          castShadow={plantShadows}
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {/* the heads cast no shadow: a flower held high threw a dark disc onto the bed that read as a hole */}
      {HEADED.map((id) => (
        <group key={id}>
          <instancedMesh
            ref={(el) => {
              budRefs.current[id] = el;
            }}
            args={[geos.bud[id], mats.heads[id]!.material, cap]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={(el) => {
              bloomRefs.current[id] = el;
            }}
            args={[geos.bloom[id], mats.heads[id]!.material, cap]}
            frustumCulled={false}
          />
        </group>
      ))}
      {/* the lotus's urli: its seed of light glows with the other seeds; its leaves are foliage */}
      {LOTUS_KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(el) => {
            lotusRefs.current[kind] = el;
          }}
          args={[geos.lotus[kind], kind === "seed" ? mats.seed.material : mats.foliage, cap]}
          castShadow={plantShadows}
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {/* a lotus in a river pocket: its seed of light on the water, and every pocket's floating leaves */}
      <instancedMesh ref={pocketSeedRef} args={[geos.pocketSeed, mats.seed.material, L.river.pockets.length]} frustumCulled={false} />
      <instancedMesh ref={padRef} args={[geos.pad, mats.pads, padCap]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={stakeRef} args={[geos.stake, mats.stake, cap]} castShadow={plantShadows} frustumCulled={false} />
      <instancedMesh ref={signRef} args={[geos.sign, mats.sign, cap]} frustumCulled={false} />
      <instancedMesh ref={wildLeavesRef} args={[geos.wildLeaves, mats.wildLeaves, cap]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={wildBlossomsRef} args={[geos.wildBlossoms, mats.wild.material, cap]} frustumCulled={false} />
      <LodPlants layout={L} shadows={shadows} />
    </group>
  );
}
