"use client";
// The body of the hero plant: two or three short side canes rising from its
// crown, each carrying compound leaves of the hero's own species and, on one
// or two, a closed bud, and a skirt of the same leaves arching low round the
// foot of the main stem. On its own the procedural flower is one cane under a
// big bloom, which reads as a prop stuck in the soil; with a body it reads as
// a rose bush (or a sundrop clump, or a marigold) with a hero bloom.
//
// The bush grows with the plant (the skirt as a seedling leafs out, the side
// canes once it is well up), fades and drops its low leaves with the plant's
// health, droops when it is thirsty, and sways a little in the wind. Leaves
// and stems use the hero's own cached materials, so they match it in every
// health band. The side buds are proper rosebuds, a short plump teardrop held
// in a cup of sepals with only its tip coloured, in a plain unlit crimson:
// they appear as the hero's own bud forms and never glow at dusk, so they
// support the bloom instead of competing with it. Each cane is a handful of
// merged meshes; nothing is allocated per frame. A live plant's own droop and
// yellowing (lib/client/plant, through the store) reach the bush as they
// reach the hero. When the watering can pours over a grown bush (canLive), the
// skirt's leaves shiver a degree or so as the drops land on them.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GeoBuilder, HERO_GROUND_Y, makeBudGeometry } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { heroLeafFade } from "@/components/garden/garden/heroGrowth";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { makeLeafGeometry, makeSepalGeometry, makeStemGeometry, stemEndTransform, stemPointAt } from "@/lib/plant/geometry";
import { droopOf, fadeOf, leafDropped, leafHealth, quantize, type PlantVisual } from "@/lib/plant/growth";
import { Rng, clamp01, easeOutCubic, lerp, smoothstep } from "@/lib/plant/prng";
import { SPECIES, type Species, type SpeciesId } from "@/lib/plant/species";
import { leafMaterial, petioleMaterial, sepalMaterial, stemMaterial } from "@/components/garden/materials";
import { useLayerFrame } from "@/components/garden/TierLayers";
import { canLive } from "@/components/garden/garden/canLive";

/** One unlit-looking crimson per species for the side buds: no emissive, so they stay quiet at night. */
const sideBudMaterials = new Map<SpeciesId, THREE.MeshStandardMaterial>();
function sideBudMaterial(sp: Species): THREE.MeshStandardMaterial {
  let m = sideBudMaterials.get(sp.id);
  if (!m) {
    const c = new THREE.Color(sp.flower.colorBase).lerp(new THREE.Color(sp.flower.colorMid), 0.4);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
    sideBudMaterials.set(sp.id, m);
  }
  return m;
}

/** Matches the hero's own scale in Plant.tsx, so the bush's leaves are the bloom's leaves. */
const BUSH_SCALE = 1.12;
/** Leaf tessellation [nu, nv] per tier: the bush's leaves sit below the bloom and take fewer triangles. */
const LEAF_TESS: Record<Quality, [number, number]> = { cinematic: [8, 14], balanced: [6, 11], lite: [5, 8] };
/** The leaf order the bush's leaves count as: low on the plant, so they are first to yellow and fall. */
const BUSH_ORDER = 0.12;

interface CaneSpec {
  /** turn about the crown; the cane leans out along this bearing */
  yaw: number;
  lean: number;
  length: number;
  bend: number;
  bud: boolean;
  phase: number;
}

interface CaneParts {
  spec: CaneSpec;
  stem: THREE.BufferGeometry;
  leaflets: THREE.BufferGeometry;
  rachises: THREE.BufferGeometry;
  sepals: THREE.BufferGeometry | null;
  /** the bud's place at the cane's tip, in the cane's frame */
  budAt: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
  budRadius: number;
}

interface BushParts {
  canes: CaneParts[];
  skirtLeaflets: THREE.BufferGeometry;
  skirtRachises: THREE.BufferGeometry;
  /** the rosebud's body, a plump teardrop one unit tall */
  bud: THREE.BufferGeometry;
}

const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const m3 = new THREE.Matrix4();
const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
const va = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const WHITE = new THREE.Color(1, 1, 1);

/** The leaflets of one compound leaf, as in Plant.tsx: the terminal one and pairs down the rachis. */
function leafletLayout(sp: Species, rachisLen: number) {
  const dz = rachisLen * 0.22;
  const place = (t: number, side: number, droop: number, scale: number) => {
    const p = stemPointAt(rachisLen, 0, dz, t);
    return { position: p.position, quaternion: p.quaternion, side, droop, scale };
  };
  const out = [place(1, 0, 0.3, 1)];
  const n = sp.leaves.compound;
  if (n >= 3) {
    const t = n >= 5 ? 0.68 : 0.56;
    out.push(place(t, 0.78, 0.28, 0.82), place(t, -0.78, 0.28, 0.82));
  }
  if (n >= 5) out.push(place(0.38, 0.82, 0.25, 0.68), place(0.38, -0.82, 0.25, 0.68));
  return out;
}

/**
 * Appends one compound leaf, attached under `attach` and turned by yaw and
 * pitch, into the leaflet and rachis builders.
 */
function addLeaf(
  leaflets: GeoBuilder,
  rachises: GeoBuilder,
  attach: THREE.Matrix4,
  yaw: number,
  pitch: number,
  size: number,
  blades: THREE.BufferGeometry[],
  rachis: THREE.BufferGeometry,
  layout: ReturnType<typeof leafletLayout>,
  variant: number,
) {
  // attach, then yaw about the stem, then pitch out from it, then the leaf's size
  ea.set(0, yaw, 0);
  m1.makeRotationFromEuler(ea);
  ea.set(pitch, 0, 0);
  m2.makeRotationFromEuler(ea);
  const leafM = new THREE.Matrix4().multiplyMatrices(attach, m1).multiply(m2).multiply(m3.makeScale(size, size, size));
  rachises.add(rachis, leafM, WHITE);
  layout.forEach((b, k) => {
    // leaflet: its place on the rachis, swung out to its side, drooped, flipped face-up (as in Plant.tsx)
    m1.compose(b.position, b.quaternion, ONE);
    ea.set(0, 0, b.side);
    m2.makeRotationFromEuler(ea);
    m1.multiply(m2);
    ea.set(b.droop, 0, 0);
    m2.makeRotationFromEuler(ea);
    m1.multiply(m2);
    ea.set(0, Math.PI, 0);
    m2.makeRotationFromEuler(ea);
    m1.multiply(m2).multiply(m3.makeScale(b.scale, b.scale, b.scale));
    m1.premultiply(leafM);
    leaflets.add(blades[(variant + k) % blades.length], m1, WHITE);
  });
}

function buildBush(sp: Species, seed: string, quality: Quality): BushParts {
  const rng = new Rng(`${sp.id}|${seed}|bush`);
  const [nu, nv] = LEAF_TESS[quality];
  const { length, width, serration, fold } = sp.leaves;
  const blades = [1, 2, 3].map((v) => makeLeafGeometry({ length, width, serration, fold }, v + 10, nu, nv));
  const rachisLen = sp.leaves.petiole ?? sp.leaves.length * 0.32;
  const rachis = makeStemGeometry(rachisLen, sp.stem.radius * 0.22, sp.stem.radius * 0.12, 0, rachisLen * 0.22, 5, 5);
  const layout = leafletLayout(sp, rachisLen);
  const lite = quality === "lite";

  // Side canes lean out to the sides and back, never toward the camera on +z,
  // so the hero's own stem and the bed in front of it stay clear.
  const count = rng.int(2, 3);
  const bearings = [rng.range(1.4, 2.1), -rng.range(1.4, 2.1), Math.PI + rng.range(-0.5, 0.5)];
  const budsWanted = rng.int(1, 2);
  const canes: CaneParts[] = [];
  for (let c = 0; c < count; c++) {
    const spec: CaneSpec = {
      yaw: bearings[c],
      lean: rng.range(0.32, 0.55),
      length: rng.range(0.26, 0.4) * (sp.stem.height / 1.0),
      bend: rng.range(0.04, 0.09),
      bud: c < budsWanted,
      phase: rng.range(0, Math.PI * 2),
    };
    const L = spec.length;
    const r0 = sp.stem.radius * 0.72;
    const stem = makeStemGeometry(L, r0, r0 * 0.5, spec.bend, 0, lite ? 6 : 10, lite ? 5 : 7);
    const leaflets = new GeoBuilder();
    const rachises = new GeoBuilder();
    const nLeaves = rng.int(2, 3);
    for (let k = 0; k < nLeaves; k++) {
      const t = 0.32 + (0.55 * k) / Math.max(1, nLeaves - 1) + rng.range(-0.05, 0.05);
      const at = stemPointAt(L, spec.bend, 0, Math.min(0.92, t));
      const attach = new THREE.Matrix4().compose(at.position, at.quaternion, ONE);
      // alternate sides, mostly turned out from the bush (the cane leans toward its local +x)
      const yaw = Math.PI / 2 + (k % 2 === 0 ? 1 : -1) * rng.range(0.5, 1.3);
      addLeaf(leaflets, rachises, attach, yaw, rng.range(0.95, 1.25), rng.range(0.82, 1.0), blades, rachis, layout, k);
    }
    let sepals: THREE.BufferGeometry | null = null;
    let budAt: CaneParts["budAt"] = null;
    const budRadius = sp.flower.budRadius * 0.62;
    if (spec.bud) {
      budAt = stemEndTransform(L, spec.bend, 0);
      const sb = new GeoBuilder();
      // a cup of sepals wrapping the lower three quarters of the bud, tips just parting
      const sepal = makeSepalGeometry(budRadius * 2.5, budRadius * 1.25, 7 + c);
      const n = Math.max(3, sp.flower.sepals.count);
      for (let k = 0; k < n; k++) {
        ea.set(rng.range(-0.16, -0.04), (k / n) * Math.PI * 2 + rng.range(-0.15, 0.15), 0, "YXZ");
        qa.setFromEuler(ea);
        va.set(0, 0, budRadius * 0.5).applyQuaternion(qa);
        m1.compose(va, qa, ONE);
        sb.add(sepal, m1, WHITE);
      }
      sepal.dispose();
      sepals = sb.build();
    }
    canes.push({ spec, stem, leaflets: leaflets.build(), rachises: rachises.build(), sepals, budAt, budRadius });
  }

  // The skirt: leaves arching low out of the crown all the way round.
  const skirtLeaflets = new GeoBuilder();
  const skirtRachises = new GeoBuilder();
  const nSkirt = rng.int(5, 6);
  for (let k = 0; k < nSkirt; k++) {
    const a = (k / nSkirt) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const attach = new THREE.Matrix4().makeTranslation(Math.sin(a) * 0.01, rng.range(0.03, 0.11), Math.cos(a) * 0.01);
    addLeaf(skirtLeaflets, skirtRachises, attach, a, rng.range(1.3, 1.5), rng.range(0.85, 1.05), blades, rachis, layout, k + 1);
  }

  for (const b of blades) b.dispose();
  rachis.dispose();
  return {
    canes,
    skirtLeaflets: skirtLeaflets.build(),
    skirtRachises: skirtRachises.build(),
    bud: makeBudGeometry(lite ? 8 : 12),
  };
}

interface CaneRefs {
  outer: THREE.Group | null;
  lean: THREE.Group | null;
  bud: THREE.Group | null;
}

export function HeroBush({ speciesId, seed, quality }: { speciesId: SpeciesId; seed: string; quality: Quality }) {
  const sp = SPECIES[speciesId];
  const parts = useMemo(() => buildBush(sp, seed, quality), [sp, seed, quality]);
  useEffect(
    () => () => {
      for (const c of parts.canes) {
        c.stem.dispose();
        c.leaflets.dispose();
        c.rachises.dispose();
        c.sepals?.dispose();
      }
      parts.skirtLeaflets.dispose();
      parts.skirtRachises.dispose();
      parts.bud.dispose();
    },
    [parts],
  );

  // The same health bands as the hero's low leaves, so the bush yellows with it.
  const fade = useGarden((s) => quantize(heroLeafFade(fadeOf(leafHealth(s, BUSH_ORDER)), s.chlorosis, BUSH_ORDER), 4));
  const burn = useGarden((s) => quantize(s.scorch * (0.5 + 0.5 * BUSH_ORDER), 3));
  const leafMat = leafMaterial(sp, fade, burn, quality);
  const stemMat = stemMaterial(sp, 1, 4);
  const shadows = quality !== "lite";

  const canes = useRef<CaneRefs[]>([]);
  const skirt = useRef<THREE.Group>(null);
  const vis = useRef<(PlantVisual & { droop: number }) | null>(null);
  // a new plant starts from its own numbers, as the hero does (Plant.tsx)
  const plantKey = `${speciesId}|${seed}`;
  const visKey = useRef(plantKey);

  useLayerFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * 2.5);
    const s = garden.get();
    if (visKey.current !== plantKey) {
      visKey.current = plantKey;
      vis.current = null;
    }
    let v = vis.current;
    if (!v) {
      const base = { growth: s.growth, bloom: s.bloom, health: s.health, moisture: s.moisture, scorch: s.scorch };
      v = { ...base, droop: s.droop ?? droopOf(base) };
      vis.current = v;
    } else {
      v.growth += (s.growth - v.growth) * k;
      v.health += (s.health - v.health) * k;
      v.moisture += (s.moisture - v.moisture) * k;
      v.droop = s.droop === null ? droopOf(v) : v.droop + (s.droop - v.droop) * k;
    }
    const droop = v.droop;
    const lh = leafHealth(v, BUSH_ORDER);
    const dropped = leafDropped(BUSH_ORDER, lh);
    const t = env.time;
    const wind = env.wind;

    const caneGrow = easeOutCubic(smoothstep(0.38, 0.85, v.growth));
    // the side buds form a little after the hero's own (heroGrowth: from about 0.38)
    const budGrow = easeOutCubic(smoothstep(0.5, 0.82, v.growth));
    for (let i = 0; i < parts.canes.length; i++) {
      const r = canes.current[i];
      if (!r || !r.outer || !r.lean) continue;
      const spec = parts.canes[i].spec;
      r.outer.visible = caneGrow > 0.002;
      r.outer.scale.setScalar(Math.max(0.0001, caneGrow));
      const sway = wind * (0.035 * Math.sin(t * 1.3 + spec.phase) + 0.015 * Math.sin(t * 2.9 + spec.phase * 1.7));
      r.lean.rotation.z = -(spec.lean + droop * 0.45) + sway;
      r.lean.rotation.x = wind * 0.02 * Math.cos(t * 1.1 + spec.phase);
      if (r.bud) {
        r.bud.visible = budGrow > 0.01;
        r.bud.scale.setScalar(Math.max(0.0001, 0.35 + 0.65 * budGrow));
      }
    }
    const sk = skirt.current;
    if (sk) {
      // The skirt is the young plant's first foliage: a small rosette round the
      // shoot from the first days, so a seedling reads as a little rose bush
      // rather than a lone stalk, filling out to full size by mid-fortnight.
      const show = smoothstep(0.04, 0.1, v.growth) * (dropped ? 0 : clamp01(0.4 + lh));
      const g = show * lerp(0.42, 1, easeOutCubic(smoothstep(0.06, 0.6, v.growth)));
      sk.visible = g > 0.002;
      sk.scale.set(Math.max(0.0001, g), Math.max(0.0001, g * (1 - 0.35 * droop)), Math.max(0.0001, g));
      // the watering can's drops landing on the low leaves: a shiver of a degree or so, never the plant reviving
      const shiver = canLive.soil.shiver;
      sk.rotation.x = shiver * 0.022 * Math.sin(t * 23) * Math.sin(t * 7.1 + 0.6);
      sk.rotation.z = shiver * 0.018 * Math.sin(t * 19 + 1.3) * Math.sin(t * 5.3);
    }
  });

  const [hx, , hz] = LAYOUT.hero;
  return (
    <group name="hero-bush" position={[hx, HERO_GROUND_Y, hz]} scale={BUSH_SCALE}>
      <group ref={skirt}>
        <mesh geometry={parts.skirtLeaflets} material={leafMat} castShadow={shadows} receiveShadow />
        <mesh geometry={parts.skirtRachises} material={petioleMaterial(sp)} />
      </group>
      {parts.canes.map((c, i) => (
        <group
          key={i}
          rotation-y={c.spec.yaw - Math.PI / 2}
          ref={(g) => {
            (canes.current[i] ??= { outer: null, lean: null, bud: null }).outer = g;
          }}
        >
          <group
            ref={(g) => {
              (canes.current[i] ??= { outer: null, lean: null, bud: null }).lean = g;
            }}
          >
            <mesh geometry={c.stem} material={stemMat} castShadow={shadows} receiveShadow />
            <mesh geometry={c.leaflets} material={leafMat} castShadow={shadows} receiveShadow />
            <mesh geometry={c.rachises} material={petioleMaterial(sp)} />
            {c.budAt && c.sepals ? (
              <group position={c.budAt.position} quaternion={c.budAt.quaternion}>
                <group
                  ref={(g) => {
                    (canes.current[i] ??= { outer: null, lean: null, bud: null }).bud = g;
                  }}
                >
                  <mesh
                    geometry={parts.bud}
                    material={sideBudMaterial(sp)}
                    position-y={-c.budRadius * 0.15}
                    scale={[c.budRadius * 1.9, c.budRadius * 2.4, c.budRadius * 1.9]}
                    castShadow={shadows}
                  />
                  <mesh geometry={c.sepals} material={sepalMaterial(sp)} castShadow={shadows} />
                </group>
              </group>
            ) : null}
          </group>
        </group>
      ))}
    </group>
  );
}
