"use client";
/* eslint-disable react-hooks/immutability --
   Instanced meshes, their attributes, the Meadow's level-of-detail uniforms and the plants' glow are three.js objects
   written in layout effects and the frame loop; the React Compiler lint reads those writes as mutating a hook's value. */
// The ordinary plants in the ring beds beside the river, as the party would leave them about two weeks on: the 246
// soil seeds of the party's 300 (18% went to the river) in the lowest bed plots (beds 0 and 1 full, bed 2's inner ring
// sown evenly), each grown to a sprout, a leafy plant, a bud or a bloom of one of the six species. They are the Meadow's
// own near light plants (components/meadow/lod: bake.ts's plant for each species and band, drawn with its own near
// material and shadow, standing as LodPlants.tsx stands them: leaning a touch toward their path, turned to one of three
// angles, at the Meadow's plant scale), with a name stake in front of each, and soft wildflowers in the plots nobody
// has planted. One plot is the overflow urli's (RiverLotus.tsx).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BED } from "@/components/meadow/layout";
import { bakeLodPlant } from "@/components/meadow/lod/bake";
import { BANDS, LOD_SPECIES, plotHash, plotTurn, type Band } from "@/components/meadow/lod/bands";
import { flowerGlow, lodUniforms, nearDepthMaterial, nearMaterial } from "@/components/meadow/lod/materials";
import { liveGlowMaterial, merge, paint } from "@/components/meadow/parts";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { stakeGeometry } from "@/components/meadow/sprouts";
import { env } from "@/lib/garden/env";
import type { SpeciesId } from "@/lib/plant/species";
import { partyFill, type BedPlot, type RiverPlan } from "@/components/lotus/river/plan";

const WILD = ["#fffaf2", "#eadcff", "#fff2b0", "#ffdbe4", "#dcecff", "#fffaf2"].map((c) => new THREE.Color(c));

/** The band a sown plot has reached about two weeks after the party (most in flower). */
function bandOf(index: number): Band {
  const h = plotHash(index, 11);
  return h < 0.55 ? "bloom" : h < 0.78 ? "bud" : h < 0.93 ? "leafy" : "sprout";
}
const speciesOf = (index: number): SpeciesId => LOD_SPECIES[Math.min(LOD_SPECIES.length - 1, Math.floor(plotHash(index, 9) * LOD_SPECIES.length))];

/** The Meadow's wildflowers for an empty plot (Plants.tsx's, copied: it keeps them private). */
function wildflowerGeometries(): { leaves: THREE.BufferGeometry; blossoms: THREE.BufferGeometry } {
  const leaves: THREE.BufferGeometry[] = [];
  const blossoms: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const blade = new THREE.ConeGeometry(0.03, 0.14, 3, 1, true);
    blade.translate(0, 0.07, 0);
    blade.rotateZ(0.6);
    blade.rotateY((k / 5) * Math.PI * 2 + 0.3);
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

interface Combo {
  species: SpeciesId;
  band: Band;
  plots: BedPlot[];
}

export function RiverPlants({ P, skip, shadows }: { P: RiverPlan; skip: number; shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const sown = partyFill().soil;
  const { combos, empty, planted } = useMemo(() => {
    const map = new Map<string, Combo>();
    const emptyPlots: BedPlot[] = [];
    const plantedPlots: BedPlot[] = [];
    for (const plot of P.plots) {
      if (plot.index === skip) continue;
      if (plot.index >= sown) {
        emptyPlots.push(plot);
        continue;
      }
      plantedPlots.push(plot);
      const species = speciesOf(plot.index), band = bandOf(plot.index);
      const key = `${species}:${band}`;
      let c = map.get(key);
      if (!c) map.set(key, (c = { species, band, plots: [] }));
      c.plots.push(plot);
    }
    const order = (c: Combo) => LOD_SPECIES.indexOf(c.species) * BANDS.length + BANDS.indexOf(c.band);
    return { combos: [...map.values()].sort((a, b) => order(a) - order(b)), empty: emptyPlots, planted: plantedPlots };
  }, [P, skip, sown]);

  const uniforms = useMemo(() => lodUniforms(), []);
  const glows = useMemo(() => Object.fromEntries(LOD_SPECIES.map((id) => [id, { value: 1 }])) as Record<SpeciesId, { value: number }>, []);
  const mats = useMemo(() => Object.fromEntries(LOD_SPECIES.map((id) => [id, nearMaterial(uniforms, glows[id])])) as Record<SpeciesId, THREE.MeshStandardMaterial>, [uniforms, glows]);
  const depth = useMemo(() => nearDepthMaterial(uniforms), [uniforms]);
  const built = useMemo(
    () =>
      combos.map((c) => {
        const plant = bakeLodPlant(c.species, c.band);
        const n = c.plots.length;
        const fade = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
        const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        const sway = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
        c.plots.forEach((plot, i) => {
          fade.setXY(i, 0, 1);
          const t = 1 + 0.06 * plotHash(plot.index, 12);
          tint.setXYZW(i, t, t, t, 0);
          sway.setXY(i, plotHash(plot.index, 2) * Math.PI * 2, plot.a);
        });
        plant.geometry.setAttribute("aFade", fade);
        plant.geometry.setAttribute("aTint", tint);
        plant.geometry.setAttribute("aSway", sway);
        return { ...c, geometry: plant.geometry, triangles: plant.triangles };
      }),
    [combos],
  );
  useEffect(
    () => () => {
      built.forEach((b) => b.geometry.dispose());
    },
    [built],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      depth.dispose();
    },
    [mats, depth],
  );

  const refs = useRef<Array<THREE.InstancedMesh | null>>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    built.forEach((b, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      b.plots.forEach((plot, i) => {
        plotTurn(plot.index, plot.a, plot.side === "inner", false, q);
        const s = PLANT_SCALE * (0.96 + 0.08 * plotHash(plot.index, 9));
        m.compose(pos.set(plot.x, BED.soilH, plot.z), q, scl.set(s, s, s));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.customDepthMaterial = depth;
    });
  }, [built, depth]);

  // stakes for every planted plot; wildflowers for every empty one
  const stake = useMemo(() => stakeGeometry(), []);
  const stakeMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  const wild = useMemo(() => wildflowerGeometries(), []);
  const wildMats = useMemo(() => ({ leaves: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), blossoms: liveGlowMaterial({ roughness: 0.8, side: THREE.DoubleSide }, "wild") }), []);
  useEffect(
    () => () => {
      stake.dispose();
      stakeMat.dispose();
      wild.leaves.dispose();
      wild.blossoms.dispose();
      wildMats.leaves.dispose();
      wildMats.blossoms.material.dispose();
    },
    [stake, stakeMat, wild, wildMats],
  );
  const stakeRef = useRef<THREE.InstancedMesh>(null);
  const leavesRef = useRef<THREE.InstancedMesh>(null);
  const blossomRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const s1 = stakeRef.current, s2 = leavesRef.current, s3 = blossomRef.current;
    if (s1) {
      planted.forEach((plot, i) => {
        m.compose(pos.set(plot.stake.x, BED.soilH, plot.stake.z), q.setFromAxisAngle(up, plot.stake.yaw), scl.set(1, 1, 1));
        s1.setMatrixAt(i, m);
      });
      s1.instanceMatrix.needsUpdate = true;
      s1.computeBoundingSphere();
    }
    if (s2 && s3) {
      empty.forEach((plot, i) => {
        const s = 0.85 + 0.4 * plotHash(plot.index, 6);
        m.compose(pos.set(plot.x, BED.soilH, plot.z), q.setFromAxisAngle(up, plotHash(plot.index, 7) * Math.PI * 2), scl.set(s, s, s));
        s2.setMatrixAt(i, m);
        s3.setMatrixAt(i, m);
        s3.setColorAt(i, WILD[Math.floor(plotHash(plot.index, 8) * WILD.length)]);
      });
      for (const mesh of [s2, s3]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }, [planted, empty]);

  useFrame(() => {
    gl.getDrawingBufferSize(uniforms.uLodRes.value);
    uniforms.uTime.value = env.time;
    uniforms.uNight.value = meadow.night;
    for (const id of LOD_SPECIES) glows[id].value = flowerGlow(id, meadow.night, env.time);
    const envMap = meadow.plantEnv;
    for (const mat of Object.values(mats)) {
      if (mat.envMap !== envMap) {
        mat.envMap = envMap;
        mat.needsUpdate = true;
      }
      mat.envMapIntensity = meadow.plantEnvStrength;
    }
    wildMats.blossoms.glow.value = 0.1 + 0.6 * meadow.night;
  });

  return (
    <group name="river-beds">
      {built.map((b, k) => (
        <instancedMesh
          key={`${b.species}:${b.band}`}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[b.geometry, mats[b.species], b.plots.length]}
          castShadow={shadows}
          receiveShadow
        />
      ))}
      <instancedMesh ref={stakeRef} args={[stake, stakeMat, planted.length]} castShadow={shadows} receiveShadow />
      <instancedMesh ref={leavesRef} args={[wild.leaves, wildMats.leaves, empty.length]} receiveShadow />
      <instancedMesh ref={blossomRef} args={[wild.blossoms, wildMats.blossoms.material, empty.length]} />
    </group>
  );
}
