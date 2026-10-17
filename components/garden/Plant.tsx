"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability --
   This component keeps an imperative registry of three.js objects: ref callbacks
   write into a plain container, the single useFrame reads it, and the container is
   swapped for a fresh one during render whenever species|seed remounts the tree.
   The React Compiler lint treats that mutable escape hatch as a violation; it is
   intentional and the per-frame path depends on it. */
// One procedurally grown flower. The blueprint (what never changes) comes from
// the seed and species; the per-frame pass reads the mutable store and env and
// bends, grows, opens and glows the scene graph without allocating. In the
// personal garden the hero runs on its own schedule (garden/heroGrowth): the
// cane lengthens across the whole fortnight, leaves run up it as it reaches
// them, and a growing tip, then a swelling bud, crowns it from the first day.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SPECIES } from "@/lib/plant/species";
import {
  buildBlueprint,
  VARIANTS,
  type Blueprint,
  type LeafNode,
  type PetalNode,
  type ThornNode,
} from "@/lib/plant/blueprint";
import {
  makeLeafGeometry,
  makePetalGeometry,
  makeReceptacleGeometry,
  makeSepalGeometry,
  makeStemGeometry,
  makeThornGeometry,
  stemEndTransform,
  stemPointAt,
} from "@/lib/plant/geometry";
import { droopOf, fadeOf, leafDropped, leafHealth, petalOpen, quantize, type PlantVisual } from "@/lib/plant/growth";
import { lerp, Rng, smoothstep } from "@/lib/plant/prng";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { env } from "@/lib/garden/env";
import {
  budMaterial,
  leafMaterial,
  petalMaterial,
  petioleGeometry,
  petioleMaterial,
  sepalMaterial,
  sphereGeometry,
  stamenMaterial,
  stemMaterial,
  thornMaterial,
} from "@/components/garden/materials";
import { BASE_EXPOSURE } from "@/components/garden/Effects";
import { OPTIONAL_LIGHT } from "@/components/garden/lightSets";
import {
  heroBudGrowth,
  heroLeafUnfurl,
  heroLeaves,
  heroSegmentGrowth,
  heroSepalPart,
  heroStemFraction,
  heroStemGirth,
} from "@/components/garden/garden/heroGrowth";

// ---------------------------------------------------------------------------
// Types

interface EndTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

interface PlantGeometry {
  stem: THREE.BufferGeometry[];
  petals: THREE.BufferGeometry[][];
  leaves: THREE.BufferGeometry[];
  sepal: THREE.BufferGeometry | null;
  /** the urn the petals grow from */
  receptacle: THREE.BufferGeometry;
  /** the leaf rachis, a gently drooping tube */
  rachis: THREE.BufferGeometry;
  rachisLength: number;
  thorn: THREE.BufferGeometry | null;
  ends: EndTransform[];
}

interface LeafRefs {
  outer: THREE.Group | null;
  pitch: THREE.Group | null;
  /** rest attachment point on the fully grown segment, in the segment's frame */
  base: THREE.Vector3 | null;
  node: LeafNode;
}

interface ThornRefs {
  group: THREE.Group | null;
  base: THREE.Vector3 | null;
  node: ThornNode;
}

interface PetalRefs {
  group: THREE.Group | null;
  mesh: THREE.Mesh | null;
  node: PetalNode;
}

interface PlantRefs {
  segs: (THREE.Group | null)[];
  tubes: (THREE.Mesh | null)[];
  mounts: (THREE.Group | null)[];
  leaves: LeafRefs[];
  thorns: ThornRefs[];
  petals: PetalRefs[];
  sepals: (THREE.Group | null)[];
  head: THREE.Group | null;
  bud: THREE.Mesh | null;
  stamens: THREE.Group | null;
  glow: THREE.PointLight | null;
  /** the petal materials (one per colour variant) in use, so the frame loop can drive their emissive */
  petalMats: THREE.MeshPhysicalMaterial[];
}

interface PlantContextValue {
  bp: Blueprint;
  geo: PlantGeometry;
  refs: PlantRefs;
  quality: Quality;
}

interface Stamen {
  x: number;
  z: number;
  h: number;
  headSize: number;
}

interface Leaflet {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** sideways angle from the rachis, radians */
  side: number;
  droop: number;
  scale: number;
}

// ---------------------------------------------------------------------------
// Module-scope temporaries for the frame loop (never allocate per frame)

const axis = new THREE.Vector3();
const qTilt = new THREE.Quaternion();
const qSway = new THREE.Quaternion();
const euler = new THREE.Euler();

const PETAL_TESS: Record<Quality, [number, number]> = {
  cinematic: [16, 28],
  balanced: [12, 22],
  lite: [8, 14],
};

/** The hero stands a little larger than life so it owns the frame from the default camera. */
const HERO_SCALE = 1.12;
/** Radians a sideways leaf turns about its rachis toward the camera. */
const LEAF_FACING = 0.5;

function emptyRefs(): PlantRefs {
  return {
    segs: [],
    tubes: [],
    mounts: [],
    leaves: [],
    thorns: [],
    petals: [],
    sepals: [],
    head: null,
    bud: null,
    stamens: null,
    glow: null,
    petalMats: [],
  };
}

function leafEntry(refs: PlantRefs, index: number, node: LeafNode): LeafRefs {
  let e = refs.leaves[index];
  if (!e) {
    e = { outer: null, pitch: null, base: null, node };
    refs.leaves[index] = e;
  }
  return e;
}

function thornEntry(refs: PlantRefs, index: number, node: ThornNode): ThornRefs {
  let e = refs.thorns[index];
  if (!e) {
    e = { group: null, base: null, node };
    refs.thorns[index] = e;
  }
  return e;
}

function petalEntry(refs: PlantRefs, index: number, node: PetalNode): PetalRefs {
  let e = refs.petals[index];
  if (!e) {
    e = { group: null, mesh: null, node };
    refs.petals[index] = e;
  }
  return e;
}

const PlantCtx = createContext<PlantContextValue | null>(null);

function usePlant(): PlantContextValue {
  const ctx = useContext(PlantCtx);
  if (!ctx) throw new Error("Plant parts must be rendered inside <Plant/>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Leaf

function Leaf({ index }: { index: number }) {
  const { bp, geo, refs, quality } = usePlant();
  const sp = bp.species;
  const leaf = bp.leaves[index];
  const seg = bp.stem[leaf.seg];

  const at = useMemo(() => stemPointAt(seg.length, seg.dx, seg.dz, leaf.t), [seg, leaf.t]);

  const fadeBand = useGarden((s) => quantize(fadeOf(leafHealth(s, leaf.order)), 4));
  const burnBand = useGarden((s) => quantize(s.scorch * (0.5 + 0.5 * leaf.order), 3));
  const leafMat = leafMaterial(sp, fadeBand, burnBand, quality);

  const rachisLen = geo.rachisLength;
  const leaflets = useMemo<Leaflet[]>(() => {
    const dz = rachisLen * 0.22;
    const place = (t: number, side: number, droop: number, scale: number): Leaflet => {
      const p = stemPointAt(rachisLen, 0, dz, t);
      return { position: p.position, quaternion: p.quaternion, side, droop, scale };
    };
    // terminal leaflet largest, pairs angled forward and drooping a little
    const out: Leaflet[] = [place(1, 0, 0.3, 1)];
    if (leaf.leaflets >= 3) {
      const t = leaf.leaflets >= 5 ? 0.68 : 0.56;
      out.push(place(t, 0.78, 0.28, 0.82), place(t, -0.78, 0.28, 0.82));
    }
    if (leaf.leaflets >= 5) {
      out.push(place(0.38, 0.82, 0.25, 0.68), place(0.38, -0.82, 0.25, 0.68));
    }
    return out;
  }, [leaf.leaflets, rachisLen]);

  const setOuter = useCallback(
    (g: THREE.Group | null) => {
      const e = leafEntry(refs, index, leaf);
      e.outer = g;
      // R3F copies `at.position` into the group, so this stays the untouched rest point.
      e.base = at.position;
    },
    [refs, index, leaf, at],
  );
  const setPitch = useCallback(
    (g: THREE.Group | null) => {
      leafEntry(refs, index, leaf).pitch = g;
    },
    [refs, index, leaf],
  );

  return (
    <group ref={setOuter} position={at.position} quaternion={at.quaternion}>
      <group rotation-y={leaf.yaw}>
        <group ref={setPitch} rotation-x={leaf.pitch}>
          <mesh geometry={geo.rachis} material={petioleMaterial(sp)} castShadow />
          {leaflets.map((b, k) => (
            <group key={k} position={b.position} quaternion={b.quaternion}>
              <group rotation-z={b.side}>
                <group rotation-x={b.droop}>
                  {/* rotation-y of PI flips the blade so its upper face points at the sky after the pitch rotation */}
                  <mesh
                    geometry={geo.leaves[(leaf.variant + k) % VARIANTS]}
                    material={leafMat}
                    rotation-y={Math.PI}
                    scale={b.scale}
                    castShadow
                    receiveShadow
                  />
                </group>
              </group>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Thorn

function Thorn({ index }: { index: number }) {
  const { bp, geo, refs } = usePlant();
  const sp = bp.species;
  const th = bp.thorns[index];
  const seg = bp.stem[th.seg];
  const at = useMemo(() => stemPointAt(seg.length, seg.dx, seg.dz, th.t), [seg, th.t]);
  const r = lerp(seg.r0, seg.r1, th.t);

  const setGroup = useCallback(
    (g: THREE.Group | null) => {
      const e = thornEntry(refs, index, th);
      e.group = g;
      e.base = at.position;
    },
    [refs, index, th, at],
  );

  if (!geo.thorn) return null;
  return (
    <group ref={setGroup} position={at.position} quaternion={at.quaternion}>
      <group rotation-y={th.yaw}>
        {/* +y of the thorn points out of the stem and a little down; its hook then curls further down */}
        <group position={[0, 0, r * 0.75]} rotation-x={Math.PI / 2 + th.droop}>
          {/* a prickle is a flattened blade: wide along the stem (local z), thin around it (local x) */}
          <mesh
            geometry={geo.thorn}
            material={thornMaterial(sp)}
            scale={[th.size * 0.55, th.size, th.size * 1.05]}
            castShadow
          />
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Flower head

function FlowerHead() {
  const { bp, geo, refs, quality } = usePlant();
  const sp = bp.species;
  const f = sp.flower;
  const c = f.center;
  const L = f.layers.length;

  const petalFade = useGarden((s) => quantize(fadeOf(s.health) * 0.85, 4));
  const petalBurn = useGarden((s) => quantize(s.scorch, 3));
  const petalMats = useMemo(
    () => Array.from({ length: VARIANTS }, (_, v) => petalMaterial(sp, petalFade, petalBurn, quality, v)),
    [sp, petalFade, petalBurn, quality],
  );

  useEffect(() => {
    refs.petalMats = petalMats;
  }, [refs, petalMats]);

  const stamens = useMemo<Stamen[]>(() => {
    const rng = new Rng(bp.seed + "|stamens");
    const out: Stamen[] = [];
    for (let k = 0; k < c.stamens; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.15, 0.9) * c.radius;
      const h = rng.range(0.6, 1.3) * c.radius;
      const headSize = rng.range(0.12, 0.2) * c.radius;
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h, headSize });
    }
    return out;
  }, [bp.seed, c]);

  const sepalCount = f.sepals.count;
  const sepalGeo = geo.sepal;
  const sepalSetters = useMemo(
    () =>
      Array.from({ length: sepalCount }, (_, k) => (g: THREE.Group | null) => {
        refs.sepals[k] = g;
      }),
    [refs, sepalCount],
  );
  const petalSetters = useMemo(
    () =>
      bp.petals.map((p, i) => ({
        group: (g: THREE.Group | null) => {
          petalEntry(refs, i, p).group = g;
        },
        mesh: (m: THREE.Mesh | null) => {
          if (m) m.updateMorphTargets();
          petalEntry(refs, i, p).mesh = m;
        },
      })),
    [refs, bp.petals],
  );

  const setHead = useCallback(
    (g: THREE.Group | null) => {
      refs.head = g;
    },
    [refs],
  );
  const setBud = useCallback(
    (m: THREE.Mesh | null) => {
      refs.bud = m;
    },
    [refs],
  );
  const setStamens = useCallback(
    (g: THREE.Group | null) => {
      refs.stamens = g;
    },
    [refs],
  );
  const setGlow = useCallback(
    (l: THREE.PointLight | null) => {
      refs.glow = l;
    },
    [refs],
  );

  return (
    <group ref={setHead} rotation-y={bp.flowerYaw}>
      {/* receptacle: its rim sits just under the petal bases */}
      <mesh geometry={geo.receptacle} material={sepalMaterial(sp)} position-y={-c.radius * 2.0} castShadow />
      {/* bud core */}
      <mesh
        ref={setBud}
        geometry={sphereGeometry()}
        material={budMaterial(sp)}
        scale={f.budRadius}
        position-y={f.budRadius * 0.6}
        castShadow
      />
      {/* sepals */}
      {sepalGeo
        ? sepalSetters.map((setSepal, k) => (
            <group key={k} rotation-y={(k / sepalCount) * 2 * Math.PI + 0.3}>
              <group ref={setSepal} position={[0, -c.radius * 0.25, c.radius * 0.95]} rotation-x={0.2}>
                <mesh geometry={sepalGeo} material={sepalMaterial(sp)} castShadow />
              </group>
            </group>
          ))
        : null}
      {/* petals: inner whorls sit nearer the axis and a touch higher */}
      {bp.petals.map((p, i) => (
        <group key={i} rotation-y={p.yaw}>
          <group
            ref={petalSetters[i].group}
            position={[0, (L - 1 - p.layer) * 0.006, c.radius * 0.35 + p.layer * 0.0055]}
            rotation-z={f.layers[p.layer].lean ?? 0}
          >
            <mesh
              ref={petalSetters[i].mesh}
              geometry={geo.petals[p.layer][p.variant]}
              material={petalMats[p.variant]}
              scale={p.scale}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
          </group>
        </group>
      ))}
      {/* stamens */}
      <group ref={setStamens}>
        {stamens.map((s, k) => (
          <group key={k}>
            <mesh
              geometry={petioleGeometry()}
              material={stamenMaterial(sp)}
              position={[s.x, 0, s.z]}
              scale={[0.6, s.h, 0.6]}
            />
            <mesh
              geometry={sphereGeometry()}
              material={stamenMaterial(sp)}
              position={[s.x, s.h, s.z]}
              scale={s.headSize}
            />
          </group>
        ))}
      </group>
      {/* glow */}
      <pointLight
        ref={setGlow}
        userData={OPTIONAL_LIGHT}
        color={sp.fx.glowColor}
        intensity={0}
        distance={1.8}
        decay={2}
        position={[0, 0.05, 0]}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Stem segment (recursive)

function Segment({ i }: { i: number }) {
  const { bp, geo, refs } = usePlant();
  const sp = bp.species;
  const n = bp.stem.length;
  const end = geo.ends[i];

  const setSeg = useCallback(
    (g: THREE.Group | null) => {
      refs.segs[i] = g;
    },
    [refs, i],
  );
  const setTube = useCallback(
    (m: THREE.Mesh | null) => {
      refs.tubes[i] = m;
    },
    [refs, i],
  );
  const setMount = useCallback(
    (g: THREE.Group | null) => {
      refs.mounts[i] = g;
    },
    [refs, i],
  );

  return (
    <group ref={setSeg}>
      <mesh ref={setTube} geometry={geo.stem[i]} material={stemMaterial(sp, i, n)} castShadow receiveShadow />
      {bp.leaves.map((leaf, idx) => (leaf.seg === i ? <Leaf key={idx} index={idx} /> : null))}
      {bp.thorns.map((th, idx) => (th.seg === i ? <Thorn key={idx} index={idx} /> : null))}
      <group ref={setMount} position={end.position} quaternion={end.quaternion}>
        {i + 1 < n ? <Segment i={i + 1} /> : <FlowerHead />}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Plant

export function Plant() {
  const speciesId = useGarden((s) => s.speciesId);
  const seed = useGarden((s) => s.seed);
  const quality = useGarden((s) => s.quality);
  const sp = SPECIES[speciesId];
  // The species blueprint, re-dressed for the hero: a fuller run of leaves up
  // the cane (see heroGrowth) and a cane a touch sturdier under its bloom.
  const bp = useMemo<Blueprint>(() => {
    const base = buildBlueprint(seed, sp);
    const stem = base.stem.map((s) => ({ ...s, r0: s.r0 * 1.08, r1: s.r1 * 1.16 }));
    return { ...base, stem, leaves: heroLeaves(seed, sp, stem.length) };
  }, [seed, sp]);
  const key = sp.id + "|" + seed;

  const geo = useMemo<PlantGeometry>(() => {
    const species = bp.species;
    const [nu, nv] = PETAL_TESS[quality];
    const stem = bp.stem.map((seg) => makeStemGeometry(seg.length, seg.r0, seg.r1, seg.dx, seg.dz));
    const petals = species.flower.layers.map((layer, l) =>
      Array.from({ length: VARIANTS }, (_, v) => makePetalGeometry(layer, l * 10 + v + 1, nu, nv)),
    );
    const { length, width, serration, fold } = species.leaves;
    const leaves = Array.from({ length: VARIANTS }, (_, v) =>
      makeLeafGeometry({ length, width, serration, fold }, v + 1),
    );
    const sepals = species.flower.sepals;
    const sepal = sepals.count > 0 ? makeSepalGeometry(sepals.length, sepals.width, 99) : null;
    const cr = species.flower.center.radius;
    const receptacle = makeReceptacleGeometry(cr * 1.25, cr * 2.1, 3);
    const rachisLength = species.leaves.petiole ?? species.leaves.length * 0.32;
    const rachis = makeStemGeometry(
      rachisLength,
      species.stem.radius * 0.22,
      species.stem.radius * 0.12,
      0,
      rachisLength * 0.22,
      6,
      6,
    );
    const thorn = species.stem.thorns ? makeThornGeometry() : null;
    const ends = bp.stem.map((seg) => stemEndTransform(seg.length, seg.dx, seg.dz));
    return { stem, petals, leaves, sepal, receptacle, rachis, rachisLength, thorn, ends };
  }, [bp, quality]);

  useEffect(
    () => () => {
      for (const g of geo.stem) g.dispose();
      for (const layer of geo.petals) for (const g of layer) g.dispose();
      for (const g of geo.leaves) g.dispose();
      geo.sepal?.dispose();
      geo.receptacle.dispose();
      geo.rachis.dispose();
      geo.thorn?.dispose();
    },
    [geo],
  );

  // Fresh ref container whenever the plant remounts (species or seed change).
  const refs = useRef<PlantRefs>(emptyRefs());
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    refs.current = emptyRefs();
  }
  const R = refs.current;

  const ctx = useMemo<PlantContextValue>(() => ({ bp, geo, refs: R, quality }), [bp, geo, R, quality]);

  const budMat = budMaterial(sp);
  const vis = useRef<PlantVisual | null>(null);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * 2.5);
    const s = garden.get();
    let v = vis.current;
    if (!v) {
      v = { growth: s.growth, bloom: s.bloom, health: s.health, moisture: s.moisture, scorch: s.scorch };
      vis.current = v;
    } else {
      v.growth += (s.growth - v.growth) * k;
      v.bloom += (s.bloom - v.bloom) * k;
      v.health += (s.health - v.health) * k;
      v.moisture += (s.moisture - v.moisture) * k;
      v.scorch += (s.scorch - v.scorch) * k;
    }

    const t = env.time;
    const droop = droopOf(v);
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
    const windAmp = env.wind * (0.4 + 0.6 * gust);
    axis.set(Math.sin(bp.leanDir), 0, -Math.cos(bp.leanDir));

    // stem segments
    const n = bp.stem.length;
    for (let i = 0; i < n; i++) {
      const seg = bp.stem[i];
      const gi = heroSegmentGrowth(v.growth, i, n);
      // The tube thickens as the plant matures, so its end lands at (dx*sx, length*gi, dz*sx):
      // anything attached to the segment has to follow that same non-uniform scale.
      const sx = heroStemGirth(v.growth, gi);
      const tube = R.tubes[i];
      if (tube) {
        tube.scale.set(sx, Math.max(gi, 0.001), sx);
        tube.visible = gi > 0.001;
      }
      const mount = R.mounts[i];
      if (mount) {
        // A segment that has not started yet must not shift what rides above
        // it sideways by its lean, or the young cane's tip floats off its top;
        // the lean comes in over the first few centimetres of its growth.
        const ep = geo.ends[i].position;
        const lean = sx * smoothstep(0, 0.15, gi);
        mount.position.set(ep.x * lean, ep.y * gi, ep.z * lean);
      }
      const sway =
        windAmp *
        (0.012 + 0.02 * i) *
        (Math.sin(t * 1.1 + seg.phase) + 0.5 * Math.sin(t * 2.3 + seg.phase * 1.7));
      const sway2 = windAmp * (0.008 + 0.012 * i) * Math.cos(t * 0.9 + seg.phase);
      const tilt = droop * (0.12 + 0.22 * i) * (0.5 + 0.5 * gi);
      const sg = R.segs[i];
      if (sg) {
        sg.quaternion
          .copy(qTilt.setFromAxisAngle(axis, tilt))
          .multiply(qSway.setFromEuler(euler.set(sway2, 0, sway)));
      }
    }

    // leaves
    const leaves = R.leaves;
    for (let j = 0; j < leaves.length; j++) {
      const e = leaves[j];
      if (!e) continue;
      const leaf = e.node;
      const lh = leafHealth(v, leaf.order);
      const unf = leafDropped(leaf.order, lh) ? 0 : heroLeafUnfurl(leaf, n, v.growth);
      if (e.outer) {
        // Ride the stretching segment exactly like the tube does, so a leaf that
        // unfurls while its segment is still short never floats above the stem tip.
        if (e.base) {
          const gi = heroSegmentGrowth(v.growth, leaf.seg, n);
          const sx = heroStemGirth(v.growth, gi);
          e.outer.position.set(e.base.x * sx, e.base.y * gi, e.base.z * sx);
        }
        e.outer.scale.setScalar(Math.max(0.0001, unf * leaf.size));
        e.outer.visible = unf > 0.001;
      }
      if (e.pitch) {
        e.pitch.rotation.x = leaf.pitch + droop * 0.85 + windAmp * 0.05 * Math.sin(t * 2.6 + leaf.phase);
        // turned about its own rachis toward the camera (on +z), so a leaf held
        // out sideways shows the faces of its leaflets instead of their edges
        e.pitch.rotation.y = LEAF_FACING * Math.sin(leaf.yaw);
        e.pitch.rotation.z = leaf.roll + windAmp * 0.03 * Math.sin(t * 1.9 + leaf.phase);
      }
    }

    // thorns ride their segment the same way
    const thorns = R.thorns;
    for (let j = 0; j < thorns.length; j++) {
      const e = thorns[j];
      if (!e || !e.group) continue;
      const gi = heroSegmentGrowth(v.growth, e.node.seg, n);
      const sx = heroStemGirth(v.growth, gi);
      if (e.base) e.group.position.set(e.base.x * sx, e.base.y * gi, e.base.z * sx);
      e.group.scale.setScalar(Math.max(0.0001, gi * sx));
      e.group.visible = gi > 0.05;
    }

    // flower head
    const f = sp.flower;
    const L = f.layers.length;
    // Before the bud forms, the head is the cane's growing tip: the closed
    // sepals alone, a small pointed green shoot, so the stem never ends in a
    // cut-off tube. The petals and bud core show once the bud starts to swell.
    const bud = heroBudGrowth(v.growth);
    const eb = v.bloom * smoothstep(0.8, 0.92, v.growth);
    const head = R.head;
    const petalsShown = bud > 0.04;
    if (head) {
      head.visible = heroStemFraction(v.growth) > 0.005;
      head.scale.setScalar(0.3 + 0.7 * bud);
      head.rotation.x = bp.headTilt + droop * 0.9 + windAmp * 0.03 * Math.sin(t * 1.7);
    }

    const petals = R.petals;
    const layerDen = Math.max(1, L - 1);
    for (let j = 0; j < petals.length; j++) {
      const e = petals[j];
      if (!e || !e.group) continue;
      e.group.visible = petalsShown;
      const p = e.node;
      const o = petalOpen(eb, p.stagger);
      // Closed petals lean a little inward so the bud closes to a teardrop.
      e.group.rotation.x =
        o * p.openTarget -
        (1 - o) * 0.18 +
        droop * 0.3 * (p.layer / layerDen) +
        windAmp * 0.04 * Math.sin(t * 2.2 + p.phase) * (0.3 + 0.7 * o);
      e.group.scale.setScalar(lerp(0.55, 1, o) * p.scale);
      const inf = e.mesh ? e.mesh.morphTargetInfluences : undefined;
      if (inf) inf[0] = smoothstep(0.05, 0.95, o);
    }

    const budMesh = R.bud;
    if (budMesh) {
      budMesh.scale.setScalar(Math.max(0.0001, f.budRadius * (1 - eb) * (0.6 + 0.4 * bud)));
      budMesh.visible = petalsShown && eb < 0.9;
    }

    const sepals = R.sepals;
    // Closed round the young bud, parting a little as it swells to show its colour, then folding back as it opens.
    const sepalRot = 0.06 + 0.32 * heroSepalPart(bud) + 1.4 * smoothstep(0, 0.6, eb) + droop * 0.2;
    const sepalScale = 0.75 + 0.25 * bud;
    for (let j = 0; j < sepals.length; j++) {
      const sg = sepals[j];
      if (!sg) continue;
      sg.rotation.x = sepalRot;
      sg.scale.setScalar(sepalScale);
    }

    const stamens = R.stamens;
    if (stamens) {
      stamens.visible = eb > 0.6;
      stamens.scale.setScalar(Math.max(0.001, eb));
    }

    // emissive and glow, held against the tone-mapping exposure: the lite tier
    // opens its exposure as night falls to keep the bed readable, and the
    // petals' own light must not ride that lift up through the bloom threshold
    const night = env.nightness;
    const pulse = sp.fx.pulse ? 0.75 + 0.25 * Math.sin(t * 1.4) : 1;
    const lift = Math.max(1, state.gl.toneMappingExposure / BASE_EXPOSURE);
    // lite's petals have no transmission to spread their light, so it reads stronger there
    const tierGlow = quality === "lite" ? 0.75 : 1;
    const ei =
      (lerp(f.emissiveDay, f.emissiveNight, night) * (0.3 + 0.7 * v.health) * (0.2 + 0.8 * eb) * pulse * tierGlow) / lift;
    const mats = R.petalMats;
    for (let j = 0; j < mats.length; j++) mats[j].emissiveIntensity = ei;
    budMat.emissiveIntensity = ei * 0.3;
    const glow = R.glow;
    // The glow sits in the heart of the bloom, centimetres from the inner petals; on lite,
    // with nothing to soften it, it burns a white spot there, so it is kept low.
    if (glow) glow.intensity = ei * (quality === "lite" ? 1.1 : 3) * night * (sp.fx.glowNight ? 1 : 0.2);

    if (head) head.getWorldPosition(env.headPos);
  });

  return (
    <group key={key} scale={HERO_SCALE}>
      <PlantCtx value={ctx}>
        <Segment i={0} />
      </PlantCtx>
    </group>
  );
}
