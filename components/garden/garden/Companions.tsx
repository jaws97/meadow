"use client";
// The planting round the hero: lavender clumps along the back of the bed,
// tall cosmos at the back corners, low daisies at the sides and front
// corners, ferns and hostas behind, and clover creeping along the stones and
// spilling onto the lawn. lib/garden/dressing plans every stem, floret, petal
// and leaf for the owner (colours from their seed, counts from the quality
// tier); here each kind of part becomes one InstancedMesh, so the whole bed
// is about a dozen draw calls.
//
// Every part shares one wind-sway program measured in world height, so a stem
// and the flower riding its tip bend together, and leaves glow when the sun
// stands behind them. The shadow pass uses the matching sway depth material,
// so the dappled shadows on the mulch move with the plants.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  COMPANION_BUDGET,
  makeBudGeometry,
  makeCloverSprigGeometry,
  makeDiscGeometry,
  makeFloretGeometry,
  makeFlowerLeafGeometry,
  makeFrondGeometry,
  makeHostaLeafGeometry,
  makeLavenderLeafGeometry,
  makeOpenPetalGeometry,
  makeSwayDepthMaterial,
  makeSwayMaterial,
  makeUnitStem,
  planCompanions,
  type Palette,
  type Placement,
  type SwayOptions,
} from "@/lib/garden/dressing";
import type { Quality } from "@/lib/garden/store";
import { leafTexture, petalTexture } from "@/lib/plant/textures";

/** One sway program for every companion part: full bend at half a metre of world height. */
const SWAY: SwayOptions = { height: 0.5, amount: 1.4, world: true };
const SWAY_KEY = "garden-companion-sway";

// Parts whose colour comes from the instance get near-white maps, so the
// owner's lavender, cosmos and daisy colours land true instead of doubled.
const NEUTRAL_LEAF = { base: "#d7dccf", tip: "#f1f3ec", vein: "#ffffff", seed: 3, fade: 0, burn: 0 };
const NEUTRAL_PETAL = { base: "#eee8df", mid: "#ffffff", tip: "#fffaf3", vein: "#e6dad2", veins: 9, seed: 4, fade: 0, burn: 0 };

interface CompanionMaterials {
  stem: THREE.MeshStandardMaterial;
  floret: THREE.MeshStandardMaterial;
  lavLeaf: THREE.MeshStandardMaterial;
  petal: THREE.MeshStandardMaterial;
  disc: THREE.MeshStandardMaterial;
  bud: THREE.MeshStandardMaterial;
  flowerLeaf: THREE.MeshStandardMaterial;
  fern: THREE.MeshStandardMaterial;
  hosta: THREE.MeshStandardMaterial;
  clover: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
}

function leafMap(c: { base: string; tip: string; vein: string }, seed: number): THREE.Texture {
  return leafTexture({ base: c.base, tip: c.tip, vein: c.vein, seed, fade: 0, burn: 0 });
}

function makeMaterials(p: Palette): CompanionMaterials {
  const sway = (params: THREE.MeshStandardMaterialParameters) => makeSwayMaterial(SWAY_KEY, SWAY, params);
  return {
    stem: sway({ roughness: 0.7 }),
    floret: sway({ vertexColors: true, roughness: 0.85 }),
    lavLeaf: sway({ map: leafMap(NEUTRAL_LEAF, 3), roughness: 0.8 }),
    petal: sway({ map: petalTexture(NEUTRAL_PETAL), roughness: 0.62 }),
    disc: sway({ vertexColors: true, roughness: 0.9 }),
    bud: sway({ roughness: 0.6 }),
    flowerLeaf: sway({ map: leafMap(p.flowerLeaf, 5), roughness: 0.7 }),
    fern: sway({ map: leafMap(p.fern, 6), roughness: 0.68 }),
    hosta: sway({ map: leafMap(p.hosta, 7), roughness: 0.45 }),
    clover: sway({ map: leafMap(p.clover, 8), roughness: 0.65 }),
    depth: makeSwayDepthMaterial(SWAY_KEY, SWAY),
  };
}

interface PlacedProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  placements: Placement[];
  depth: THREE.Material;
  castShadow: boolean;
}

/** One InstancedMesh filled from a list of placements. */
function Placed({ geometry, material, placements, depth, castShadow }: PlacedProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < placements.length; i++) {
      mesh.setMatrixAt(i, placements[i].m);
      mesh.setColorAt(i, placements[i].c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The bounds from the real instances, so the bed culls when the orbit turns away.
    mesh.computeBoundingSphere();
  }, [placements, geometry]);
  if (placements.length === 0) return null;
  return (
    <instancedMesh
      key={placements.length}
      ref={ref}
      args={[geometry, material, placements.length]}
      customDepthMaterial={depth}
      castShadow={castShadow}
      receiveShadow
    />
  );
}

export function Companions({ seed, quality }: { seed: string; quality: Quality }) {
  const lite = quality === "lite";
  const built = useMemo(() => {
    const b = COMPANION_BUDGET[quality];
    const plan = planCompanions(seed, b);
    const [pu, pv] = b.petalTess;
    const [lu, lv] = b.leafTess;
    const [nu, nv] = b.pinnaTess;
    const geo = {
      stem: makeUnitStem(lite ? 4 : 6, lite ? 3 : 5),
      floret: makeFloretGeometry(),
      lavLeaf: makeLavenderLeafGeometry(2, lv),
      daisyPetal: makeOpenPetalGeometry(plan.daisyPetal, 3, pu, pv),
      cosmosPetal: makeOpenPetalGeometry(plan.cosmosPetal, 5, pu, pv),
      disc: makeDiscGeometry(b.discDetail),
      bud: makeBudGeometry(lite ? 6 : 8),
      feathery: makeFlowerLeafGeometry("feathery", lu, lv),
      spoon: makeFlowerLeafGeometry("spoon", lu, lv),
      frondA: makeFrondGeometry({ length: plan.frondLength, pinnae: b.pinnae, nu, nv, seed: 1 }),
      frondB: makeFrondGeometry({ length: plan.frondLength * 0.86, pinnae: Math.max(5, b.pinnae - 2), nu, nv, seed: 2 }),
      hosta: makeHostaLeafGeometry(lu, lv),
      clover: makeCloverSprigGeometry(Math.max(2, lu - 1), Math.max(3, lv - 2)),
    };
    return { plan, geo, stems: [...plan.lavStems, ...plan.flowerStems] };
  }, [seed, quality, lite]);
  useEffect(
    () => () => {
      for (const g of Object.values(built.geo)) g.dispose();
    },
    [built],
  );

  const palette = built.plan.palette;
  const mats = useMemo(() => makeMaterials(palette), [palette]);
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );

  const { plan, geo, stems } = built;
  // Low parts (clover, crown foliage, flower centres) add little to the shadows
  // but plenty to the shadow pass, so only the tall ones cast.
  const shade = !lite;
  return (
    <group name="companions">
      <Placed geometry={geo.stem} material={mats.stem} placements={stems} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.floret} material={mats.floret} placements={plan.lavFlorets} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.lavLeaf} material={mats.lavLeaf} placements={plan.lavLeaves} depth={mats.depth} castShadow={false} />
      <Placed geometry={geo.daisyPetal} material={mats.petal} placements={plan.daisyPetals} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.cosmosPetal} material={mats.petal} placements={plan.cosmosPetals} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.disc} material={mats.disc} placements={plan.discs} depth={mats.depth} castShadow={false} />
      <Placed geometry={geo.bud} material={mats.bud} placements={plan.buds} depth={mats.depth} castShadow={false} />
      <Placed geometry={geo.feathery} material={mats.flowerLeaf} placements={plan.feathery} depth={mats.depth} castShadow={false} />
      <Placed geometry={geo.spoon} material={mats.flowerLeaf} placements={plan.spoon} depth={mats.depth} castShadow={false} />
      <Placed geometry={geo.frondA} material={mats.fern} placements={plan.fronds[0]} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.frondB} material={mats.fern} placements={plan.fronds[1]} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.hosta} material={mats.hosta} placements={plan.hostaLeaves} depth={mats.depth} castShadow={shade} />
      <Placed geometry={geo.clover} material={mats.clover} placements={plan.clover} depth={mats.depth} castShadow={false} />
    </group>
  );
}
