"use client";
// The lotus in the river's pockets, drawn with the pond's own plant (LotusPlant, its look unchanged) standing in each
// pocket's still shelf, and the overflow lotus in its brass urli on a bed plot (LotusPot, vessel A, the v1 design):
// - each pocket's plant is the pond view's look for its stage, at the Meadow's plant scale (1.3, as every Meadow plant),
//   turned so its front faces the open channel (its standing leaves backed by the wall), with the stalks lengthened as
//   a pocket of real mud allows: the flower about 0.9 m over the water (the write-up's figure) and the standing leaves
//   about half that, so both clear the coping (0.48 m over the water) as a pond-grown lotus's do. A pond plant holds
//   its 60 cm leaves on 1-2 m stalks (NParks Flora & Fauna Web); a potted small cultivar's are 11-26 cm (Jiang et al.
//   2023); this sits between;
// - stages are mixed as a Meadow about two weeks after the party would be (floating leaves, standing leaves, buds, open
//   flowers, the odd seed pod); the pocket nearest the near bridge's right side is the page's own (?stage, ?day);
// - the 54 pockets the party fills (18% of 300) are planted; the last two in sowing order are left as open water;
// - plants near the camera's subject are drawn at the page's tier, the rest at the lite tier, and only the page's own
//   plant carries the flower's warm light (one light, not 54).
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BED } from "@/components/meadow/layout";
import { PLANT_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import type { Tier } from "@/components/lotus/geometry";
import { LotusPlant } from "@/components/lotus/LotusPlant";
import { LotusPot } from "@/components/lotus/LotusPot";
import { lookFor, type FloatLeaf, type LotusLook, type V3 } from "@/components/lotus/look";
import type { ConceptParams, FlowerDay, Stage } from "@/components/lotus/params";
import { LEVEL, partyFill, pocketReach, type BedPlot, type Pocket, type RiverPlan } from "@/components/lotus/river/plan";

/** How much taller than the pond's the pocket's stalks grow: standing leaves, and the flower. */
const STAND_LIFT = 2.0;
const FLOWER_LIFT = 2.25;
/** The plant's middle stands this far out from the wall (the pocket's middle is 0.55): its spread fits the front. */
const PLANT_OUT = 0.62;

export const HERO = { bank: "in", arc: 3, place: 5 } as const;

/** Stages along each bank's quarter, from the lower-angle bridge to the higher (curated for the camera's side). */
const SEQUENCE: Record<string, readonly Stage[]> = {
  "in:3": ["bloom", "aerial", "bud", "bloom", "floating", "bloom"],
  "in:0": ["bud", "bloom", "aerial", "bloom", "pod", "floating"],
  "in:2": ["aerial", "bloom", "floating", "bud", "bloom", "bloom"],
  "out:3": ["floating", "bloom", "bud", "aerial", "bloom", "floating", "bud", "bloom"],
  "out:0": ["bloom", "bud", "floating", "aerial", "bloom", "bud", "pod", "bloom"],
  "out:2": ["bud", "bloom", "aerial", "floating", "bloom", "bud", "bloom", "aerial"],
};

const hash = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function isHero(pk: Pocket): boolean {
  return pk.bank === HERO.bank && pk.arc === HERO.arc && pk.place === HERO.place;
}

function stageOf(pk: Pocket): Stage {
  const seq = SEQUENCE[`${pk.bank}:${pk.arc}`];
  if (seq) return seq[pk.place];
  const h = hash(pk.index, 5);
  return h < 0.4 ? "bloom" : h < 0.6 ? "bud" : h < 0.8 ? "aerial" : h < 0.95 ? "floating" : "pod";
}

/** Pond-leaf seeds (look.ts uses 11 + 7i): reused so the pockets share the pond's eight floating-leaf textures. */
const FLOAT_SEEDS = [11, 18, 25, 32, 39, 46, 53, 60];

/**
 * Floating leaves filling a pocket's still shelf, in the plant's frame (pond-plant units, before the Meadow's 1.3; the
 * frame's +z points out from the wall to the open channel, its middle PLANT_OUT from the wall): each wholly on the
 * shelf inside the sill stones and clear of its neighbours, the larger first. A pond plant's leaves crowd its patch
 * of water; a pocket of mud carries a dozen or so by its second month.
 */
export function pocketFloats(stage: Stage, seed: number, lie: boolean): FloatLeaf[] {
  const count = stage === "floating" ? 8 : stage === "aerial" ? 11 : stage === "pod" ? 14 : 14;
  const [rMin, rMax] = stage === "floating" ? [0.055, 0.095] : [0.07, 0.135];
  let s = seed * 7919 + 101;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const k = PLANT_SCALE;
  const fits = (x: number, z: number, r: number) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const along = (x + Math.cos(a) * r) * k;
      const out = PLANT_OUT + (z + Math.sin(a) * r) * k;
      if (out < 0.06 || out > pocketReach(along) - 0.15) return false;
    }
    return true;
  };
  const out: FloatLeaf[] = [];
  for (let tries = 0; tries < 900 && out.length < count; tries++) {
    const t = out.length / Math.max(1, count - 1);
    const r = rMax - (rMax - rMin) * (t * 0.8 + 0.2 * rnd());
    const x = (rnd() * 2 - 1) * 0.8;
    const z = -0.45 + rnd() * 0.75;
    if (!fits(x, z, r)) continue;
    // crowding as a lotus patch does, a leaf's rim now and then lying over its neighbour's (they float at three heights)
    if (out.some((f) => Math.hypot(f.x - x, f.z - z) < (f.r + r) * 0.86)) continue;
    const i = out.length;
    out.push({ x, z, r, y: 0.0012 + (i % 3) * 0.0011, yaw: rnd() * Math.PI * 2, seed: FLOAT_SEEDS[i % FLOAT_SEEDS.length], onMud: lie, tilt: 0, brown: 0, pale: 0 });
  }
  return out;
}

/**
 * The pond look made a pocket's: the pocket's own floating leaves, three standing leaves (the pond's own three; a
 * floating-leaf plant has none yet), and the standing leaves and the flower raised on longer stalks.
 */
export function riverLook(l: LotusLook, seed: number, lie: boolean, threeStands: LotusLook["standing"] | null): LotusLook {
  const lift = (v: V3, k: number): V3 => [v[0], v[1] * k, v[2]];
  const stands = l.standing.length > 0 && threeStands ? threeStands : l.standing;
  return {
    ...l,
    floating: pocketFloats(l.stage, seed, lie),
    standing: stands.map((st, i) => ({ ...st, top: [st.top[0] * 1.15, st.top[1] * STAND_LIFT * (1 - 0.05 * i), st.top[2] * 1.1] as V3 })),
    flower: { ...l.flower, head: lift(l.flower.head, FLOWER_LIFT) },
    focus: lift(l.focus, l.flower.kind === "none" ? STAND_LIFT : FLOWER_LIFT),
  };
}

/** The pond's three standing leaves (as its seed-pod plant carries them), for every river plant past its floating leaves. */
function pondThreeStands(params: ConceptParams): LotusLook["standing"] {
  return lookFor({ ...params, view: "pond", stage: "pod", mood: "happy", overrides: {} }).standing;
}

/** Where a pocket's lotus stands: its frame on the water, turned to face the open channel. */
export function pocketFrame(pk: Pocket): { x: number; y: number; z: number; yaw: number } {
  const r = pk.face + pk.dir * PLANT_OUT;
  const dx = pk.dir * Math.cos(pk.a), dz = pk.dir * Math.sin(pk.a);
  const jitter = (hash(pk.index, 3) - 0.5) * 0.14;
  return { x: r * Math.cos(pk.a), y: LEVEL.water, z: r * Math.sin(pk.a), yaw: Math.atan2(dx, dz) + jitter };
}

/** The hero pocket's lotus middle, in the world (for the cameras). */
export function heroFocus(P: RiverPlan, params: ConceptParams): THREE.Vector3 {
  const pk = P.pockets.find(isHero)!;
  const f = pocketFrame(pk);
  const look = riverLook(lookFor({ ...params, view: "pond", mood: "happy", overrides: {} }), pk.index, false, pondThreeStands(params));
  const local = new THREE.Vector3(look.focus[0], look.focus[1] * 0.62, look.focus[2]).multiplyScalar(PLANT_SCALE);
  local.applyAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
  return new THREE.Vector3(f.x, f.y, f.z).add(local);
}

interface Placed {
  pk: Pocket;
  look: LotusLook;
  tier: Tier;
  frame: { x: number; y: number; z: number; yaw: number };
  hero: boolean;
  /** within the camera subject's reach (drawn at the page's tier, casting shadows) */
  near: boolean;
}

const PLANT_MATERIAL_BASE = "riverBaseEnv";

/** The pockets' lotus. `focus` and `detail` pick the plants drawn at the page's tier (within `detail` metres). */
export function RiverLotus({ P, params, tier, focus, detail }: { P: RiverPlan; params: ConceptParams; tier: Tier; focus: THREE.Vector3; detail: number }) {
  const fill = partyFill();
  const placed = useMemo<Placed[]>(() => {
    const out: Placed[] = [];
    const stands = pondThreeStands(params);
    for (const pk of P.pockets) {
      if (pk.order >= fill.inPockets) continue;
      const hero = isHero(pk);
      const stage = hero ? params.stage : stageOf(pk);
      if (stage === "jar") continue;
      let day: FlowerDay = params.day;
      if (!hero && stage === "bloom" && hash(pk.index, 7) < 0.34 && (params.time === "noon" || params.time === "golden")) day = "1";
      const frame = pocketFrame(pk);
      const near = hero || Math.hypot(frame.x - focus.x, frame.z - focus.z) < detail;
      // far plants' floating leaves are drawn without their stalks (under the opaque water either way, and half the draws)
      const look = riverLook(lookFor({ ...params, view: "pond", stage, day, mood: "happy", overrides: {} }), pk.index, !near, stands);
      out.push({ pk, look, tier: near ? tier : "lite", frame, hero, near });
    }
    // the page's own plant first, so the ready flag's "lotus" is it
    return out.sort((a, b) => Number(b.hero) - Number(a.hero));
  }, [P, params, tier, focus, detail, fill.inPockets]);

  // the Meadow's soft plant environment for the lotus's sheen, as the Meadow's full plants have it (flowerPlant.ts);
  // and the far plants cast no shadow (each plant is some thirty meshes, and a shadow draws them all again: the
  // product would draw them as the write-up's pad decal and atlas row instead)
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = root.current;
    const envMap = meadow.plantEnv;
    if (!g || !envMap) return;
    for (const plant of g.children) {
      if (plant.userData.far !== true) continue;
      plant.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
    }
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || Array.isArray(m) || !("envMapIntensity" in m)) return;
      if (m.userData[PLANT_MATERIAL_BASE] === undefined) m.userData[PLANT_MATERIAL_BASE] = m.envMapIntensity;
      if (m.envMap !== envMap) {
        m.envMap = envMap;
        m.needsUpdate = true;
      }
      m.envMapIntensity = (m.userData[PLANT_MATERIAL_BASE] as number) * meadow.plantEnvStrength;
    });
  });

  return (
    <group ref={root} name="river-lotus">
      {placed.map(({ pk, look, tier: t, frame, hero, near }) => (
        <group key={pk.index} position={[frame.x, frame.y, frame.z]} rotation-y={frame.yaw} scale={PLANT_SCALE} userData={{ far: !near }}>
          <LotusPlant look={look} tier={t} colour={params.colour} rain={params.rain} glowLight={hero} />
        </group>
      ))}
    </group>
  );
}

/** A line for the page: what the near bridge's pocket shows, in the river. */
export function riverSummary(params: ConceptParams): string {
  const s = lookFor({ ...params, view: "pond", mood: "happy", overrides: {} }).summary.replace(/ over the pond| on the pond| from the pot on the shelf|, petals drifting on the pond/g, "");
  return `Lazy river (Option A): ${s}, in the near bridge's pocket`;
}

/** The overflow lotus: the v1 brass urli (vessel A) on a bed plot, at the Meadow's plant scale, its look the page's. */
export function OverflowUrli({ plot, params, tier }: { plot: BedPlot; params: ConceptParams; tier: Tier }) {
  const look = useMemo(() => lookFor({ ...params, view: "meadow", stage: params.stage === "jar" ? "bloom" : params.stage, mood: "happy", vessel: "a", overrides: {} }), [params]);
  // turned so the urli's front (+z) faces the path the plot is visited from
  const toward = plot.side === "inner" ? -1 : 1;
  const yaw = Math.atan2(Math.cos(plot.a) * toward, Math.sin(plot.a) * toward);
  return (
    <group name="river-urli" position={[plot.x, BED.soilH + 0.005 * PLANT_SCALE, plot.z]} rotation-y={yaw} scale={PLANT_SCALE}>
      <LotusPot look={look} vessel="a" tier={tier} colour={params.colour} rain={params.rain} />
    </group>
  );
}
