"use client";
// The planting round the hero: hostas flanking it and filling the front
// corners, ferns behind and at the sides, lavender clumps along the back of
// the bed in a drift, tall cosmos in drifts at the back corners, daisies in
// drifts at the sides, green cushions of alyssum domed with rounded heads of
// white flowers spilling over the front kerb, mats of creeping
// groundcover through the open mulch, and clover creeping along the stones
// and onto the lawn. lib/garden/dressing plans every stem, floret, petal and
// leaf for the owner (colours from their seed, counts from the quality tier);
// here each kind of part becomes one InstancedMesh, so the whole bed is about
// fifteen draw calls.
//
// Every part shares one wind-sway program measured in world height, so a stem
// and the flower riding its tip bend together, and leaves glow when the sun
// stands behind them. The shadow pass uses the matching sway depth material,
// so the dappled shadows on the mulch move with the plants.
//
// The planting is staged by the hero's growth (Garden.tsx writes the shared
// uniforms): while the owner's flower is young the companions stand low and
// in leaf, their flowers closed to small green buds, and they come into
// flower as the hero's own bud swells, so they never upstage it.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  COMPANION_BUDGET,
  makeBudGeometry,
  makeCloverSprigGeometry,
  makeCushionGeometry,
  makeDiscGeometry,
  makeFloretGeometry,
  makeFlowerLeafGeometry,
  makeFrondGeometry,
  makeGroundcoverGeometry,
  makeHostaLeafGeometry,
  makeLavenderLeafGeometry,
  makeOpenPetalGeometry,
  makeSwayDepthMaterial,
  makeSwayMaterial,
  makeTinyFlowerGeometry,
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
/** Foliage and stems are squashed low while the hero is young; flowers also close. */
const SWAY_PLANT: SwayOptions = { ...SWAY, stage: "plant" };
const SWAY_FLOWER: SwayOptions = { ...SWAY, stage: "flower" };
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
  groundcover: THREE.MeshStandardMaterial;
  /** the alyssum's green cushions */
  cushion: THREE.MeshStandardMaterial;
  /** shadow twins: unstaged (groundcover, clover), plant-staged and flower-staged */
  depth: THREE.MeshDepthMaterial;
  depthPlant: THREE.MeshDepthMaterial;
  depthFlower: THREE.MeshDepthMaterial;
}

function leafMap(c: { base: string; tip: string; vein: string }, seed: number): THREE.Texture {
  return leafTexture({ base: c.base, tip: c.tip, vein: c.vein, seed, fade: 0, burn: 0 });
}

function makeMaterials(p: Palette): CompanionMaterials {
  // The sky's blue in the environment map would turn the greens teal; foliage takes little of it.
  const make = (o: SwayOptions) => (params: THREE.MeshStandardMaterialParameters) =>
    makeSwayMaterial(SWAY_KEY, o, { envMapIntensity: 0.45, ...params });
  const low = make(SWAY);
  const plant = make(SWAY_PLANT);
  const flower = make(SWAY_FLOWER);
  return {
    stem: plant({ roughness: 0.7 }),
    floret: flower({ vertexColors: true, roughness: 0.85 }),
    lavLeaf: plant({ map: leafMap(NEUTRAL_LEAF, 3), roughness: 0.8 }),
    petal: flower({ map: petalTexture(NEUTRAL_PETAL), roughness: 0.62, envMapIntensity: 0.7 }),
    disc: flower({ vertexColors: true, roughness: 0.9 }),
    bud: plant({ roughness: 0.6 }),
    flowerLeaf: plant({ map: leafMap(p.flowerLeaf, 5), roughness: 0.7 }),
    fern: plant({ map: leafMap(p.fern, 6), roughness: 0.68 }),
    hosta: plant({ map: leafMap(p.hosta, 7), roughness: 0.62 }),
    clover: low({ map: leafMap(p.clover, 8), roughness: 0.65 }),
    groundcover: low({ map: leafMap(p.groundcover, 9), roughness: 0.7 }),
    // plant-staged, not flower-staged: its florets sit on its surface, so it keeps its size and
    // reads as a green mound in leaf (the closed florets as small green buds on it) while the hero is young
    cushion: plant({ vertexColors: true, roughness: 0.9 }),
    depth: makeSwayDepthMaterial(SWAY_KEY, SWAY),
    depthPlant: makeSwayDepthMaterial(SWAY_KEY, SWAY_PLANT),
    depthFlower: makeSwayDepthMaterial(SWAY_KEY, SWAY_FLOWER),
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
      tinyFlower: makeTinyFlowerGeometry(),
      cushion: makeCushionGeometry(lite ? 2 : 3),
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
      groundcover: makeGroundcoverGeometry(Math.max(2, lu - 2), Math.max(3, lv - 3)),
    };
    return {
      plan,
      geo,
      stems: [...plan.lavStems, ...plan.flowerStems],
    };
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
      <Placed geometry={geo.stem} material={mats.stem} placements={stems} depth={mats.depthPlant} castShadow={shade} />
      <Placed geometry={geo.floret} material={mats.floret} placements={plan.lavFlorets} depth={mats.depthFlower} castShadow={shade} />
      <Placed geometry={geo.cushion} material={mats.cushion} placements={plan.alyssumDomes} depth={mats.depthPlant} castShadow={false} />
      <Placed geometry={geo.tinyFlower} material={mats.floret} placements={plan.alyssum} depth={mats.depthFlower} castShadow={false} />
      <Placed geometry={geo.lavLeaf} material={mats.lavLeaf} placements={plan.lavLeaves} depth={mats.depthPlant} castShadow={false} />
      <Placed geometry={geo.daisyPetal} material={mats.petal} placements={plan.daisyPetals} depth={mats.depthFlower} castShadow={shade} />
      <Placed geometry={geo.cosmosPetal} material={mats.petal} placements={plan.cosmosPetals} depth={mats.depthFlower} castShadow={shade} />
      <Placed geometry={geo.disc} material={mats.disc} placements={plan.discs} depth={mats.depthFlower} castShadow={false} />
      <Placed geometry={geo.bud} material={mats.bud} placements={plan.buds} depth={mats.depthPlant} castShadow={false} />
      <Placed geometry={geo.feathery} material={mats.flowerLeaf} placements={plan.feathery} depth={mats.depthPlant} castShadow={false} />
      <Placed geometry={geo.spoon} material={mats.flowerLeaf} placements={plan.spoon} depth={mats.depthPlant} castShadow={false} />
      <Placed geometry={geo.frondA} material={mats.fern} placements={plan.fronds[0]} depth={mats.depthPlant} castShadow={shade} />
      <Placed geometry={geo.frondB} material={mats.fern} placements={plan.fronds[1]} depth={mats.depthPlant} castShadow={shade} />
      <Placed geometry={geo.hosta} material={mats.hosta} placements={plan.hostaLeaves} depth={mats.depthPlant} castShadow={shade} />
      <Placed geometry={geo.clover} material={mats.clover} placements={plan.clover} depth={mats.depth} castShadow={false} />
      <Placed
        geometry={geo.groundcover}
        material={mats.groundcover}
        placements={plan.groundcover}
        depth={mats.depth}
        castShadow={false}
      />
    </group>
  );
}
