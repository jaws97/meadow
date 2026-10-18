"use client";
// The Meadow plot view (art direction, section 9): a stretch of one of the Meadow's raised beds, built from its own
// numbers (components/meadow/layout BED: soil 0.3 m up, a stone kerb 0.36 m high and 0.2 m thick, the plant row 0.85 m
// inside the bed's face) and its own textures and colours (the planted mulch, the sanded paving, the warm kerb stone,
// the box hedging just inside the kerb, the name stake), with two lotus plots in the row:
// - the plant as a visit draws it, the same urli and plant at the Meadow's plant scale (PLANT_SCALE 1.3), on its soil;
// - beside it, at the next plot along, the near light plant (L1, about 940 triangles, lod.ts) for the same band.
// It is lit by the garden's sky and lights, not the Meadow's own environment (which this page does not mount), so its
// colours are close to the Meadow's but not identical.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BED } from "@/components/meadow/layout";
import { paverTexture, plantedBedTexture, worldUv } from "@/components/meadow/parts";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { stakeGeometry } from "@/components/meadow/sprouts";
import type { Tier } from "@/components/lotus/geometry";
import { bandOf, makeLodLotus } from "@/components/lotus/lod";
import { LotusPot } from "@/components/lotus/LotusPot";
import { vertexColourMaterial } from "@/components/lotus/materials";
import type { LotusLook } from "@/components/lotus/look";
import type { PetalColour, Stage, Vessel } from "@/components/lotus/params";

const STONE = "#d2c4ab";
const HEDGE_GREEN = "#4b7346";
/** The bed stretch: along x, the plant row at z = 0, the bed's face (and its kerb) toward the path at +z. */
const HALF_LENGTH = 3.2;
const BACK = -1.6;
const FACE = BED.margin;
/** The next plot along the row (about 1.4 m apart on the inner ring, lib/server/plots). */
export const NEIGHBOUR_X = -1.4;
/** The urli's foot stands on the soil: its frame's y = 0 is a hair above (the foot is 5 mm below the crown). */
export const POT_Y = BED.soilH + 0.005 * PLANT_SCALE;

export function MeadowPlot({ look, vessel, tier, colour, rain, stage }: { look: LotusLook; vessel: Vessel; tier: Tier; colour: PetalColour; rain: boolean; stage: Stage }) {
  const parts = useMemo(() => {
    const soil = worldUv(new THREE.PlaneGeometry(HALF_LENGTH * 2, FACE - BACK).rotateX(-Math.PI / 2).translate(0, BED.soilH, (FACE + BACK) / 2), 3);
    const side = new THREE.PlaneGeometry(HALF_LENGTH * 2, BED.soilH).translate(0, BED.soilH / 2, BACK);
    const kerb = new THREE.BoxGeometry(HALF_LENGTH * 2, BED.kerbH, BED.kerbT).translate(0, BED.kerbH / 2, FACE + BED.kerbT / 2);
    const path = worldUv(new THREE.PlaneGeometry(HALF_LENGTH * 2, 3).rotateX(-Math.PI / 2).translate(0, 0.01, FACE + BED.kerbT + 1.5), 2.5);
    const hedge = new RoundedBoxGeometry(HALF_LENGTH * 2, 0.2, 0.2, 1, 0.06).translate(0, BED.soilH + 0.1, FACE - 0.11);
    const stake = stakeGeometry();
    const lod = makeLodLotus(bandOf(stage));
    return { soil, side, kerb, path, hedge, stake, lod };
  }, [stage]);
  useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
  const tex = useMemo(() => ({ mulch: plantedBedTexture(23), paving: paverTexture(11) }), []);
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);
  const mats = useMemo(
    () => ({
      soil: new THREE.MeshStandardMaterial({ map: tex.mulch, roughness: 1 }),
      side: new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9 }),
      paving: new THREE.MeshStandardMaterial({ map: tex.paving, roughness: 0.92 }),
      hedge: new THREE.MeshStandardMaterial({ color: HEDGE_GREEN, roughness: 0.95 }),
    }),
    [tex],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group name="meadow-plot">
      <mesh geometry={parts.soil} material={mats.soil} receiveShadow />
      <mesh geometry={parts.side} material={mats.side} />
      <mesh geometry={parts.kerb} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={parts.path} material={mats.paving} receiveShadow />
      <mesh geometry={parts.hedge} material={mats.hedge} castShadow receiveShadow />
      {/* the name stake in front of the plant toward the path, a little to one side, its board facing the path */}
      <mesh geometry={parts.stake} material={vertexColourMaterial("stake", 0.85)} position={[0.34, BED.soilH, 0.46]} rotation-y={-Math.PI / 2} castShadow />
      <mesh geometry={parts.stake} material={vertexColourMaterial("stake", 0.85)} position={[NEIGHBOUR_X + 0.34, BED.soilH, 0.46]} rotation-y={-Math.PI / 2} castShadow />
      <group position={[0, POT_Y, 0]} scale={PLANT_SCALE}>
        <LotusPot look={look} vessel={vessel} tier={tier} colour={colour} rain={rain} jarGroundY={0.006} />
      </group>
      <mesh name="lotus-l1" geometry={parts.lod} material={vertexColourMaterial("lod", 0.75)} position={[NEIGHBOUR_X, POT_Y, 0]} scale={PLANT_SCALE} castShadow receiveShadow />
    </group>
  );
}
