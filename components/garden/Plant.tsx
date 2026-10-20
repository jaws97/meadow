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
// For a signed-in visitor the store carries the model's live numbers
// (lib/client/plant): its own droop, the leaves' yellowing, the flower's
// size, the stem base darkening with rot and a soft glow after a kind word;
// with the defaults (the owner's rose) every one of them leaves the look as
// it was.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
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
  receptacleShape,
  makeSepalGeometry,
  makeStemGeometry,
  makeThornGeometry,
  stemEndTransform,
  stemPointAt,
} from "@/lib/plant/geometry";
import { droopOf, fadeOf, leafDropped, leafHealth, petalOpen, quantize, type PlantVisual } from "@/lib/plant/growth";
import { lerp, Rng, smoothstep } from "@/lib/plant/prng";
import {
  BUD_SHOWN,
  pedicelShape,
  racemeBudGrowth,
  racemeHeadScale,
  racemeNodes,
  racemeOpen,
  racemeStalkGrowth,
  racemeStalkLean,
  type RacemeNode,
} from "@/lib/plant/raceme";
import { ANTHER, FILAMENT_GIRTH, longStamens, STIGMA, STYLE_GIRTH } from "@/lib/plant/stamens";
import { garden, useGarden, type Quality } from "@/lib/garden/store";
import { env } from "@/lib/garden/env";
import { CARD_BLOOM, CARD_DROOP, cardShot } from "@/lib/garden/cardShot";
import {
  budMaterial,
  filamentMaterial,
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
  heroLeafFade,
  heroLeafUnfurl,
  heroLeaves,
  heroSegmentGrowth,
  heroSepalPart,
  heroStemFraction,
  heroStemGirth,
} from "@/components/garden/garden/heroGrowth";
import { useLayerFrame, useTier } from "@/components/garden/TierLayers";

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
  /** a lily's flower stalks, by raceme node (none for the tip bud, which sits on the cane, or a lone flower) */
  pedicels: ({ geometry: THREE.BufferGeometry; end: EndTransform } | null)[];
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

/** One flower head: the one flower that crowns a stem, or one of a lily's flowers or its tip bud. */
interface HeadRefs {
  /** its place on a lily's stem (lib/plant/raceme), or null for the one flower that crowns any other stem */
  node: RacemeNode | null;
  head: THREE.Group | null;
  /** the head's parts, hidden while the cane is too short to carry them (the head itself, and its glow light, never are) */
  headBody: THREE.Group | null;
  bud: THREE.Mesh | null;
  stamens: THREE.Group | null;
  petals: PetalRefs[];
  sepals: (THREE.Group | null)[];
  /**
   * A lily flower's stalk: the group that rides its segment as a leaf does (with its rest point there), the group that
   * leans it out, its tube, and the group at its end that carries the flower. The stalk's groups are never hidden,
   * since the lead's glow light rides in them.
   */
  pedicel: THREE.Group | null;
  pedicelBase: THREE.Vector3 | null;
  pedicelLean: THREE.Group | null;
  pedicelTube: THREE.Mesh | null;
  pedicelEnd: THREE.Group | null;
}

interface PlantRefs {
  segs: (THREE.Group | null)[];
  tubes: (THREE.Mesh | null)[];
  mounts: (THREE.Group | null)[];
  leaves: LeafRefs[];
  thorns: ThornRefs[];
  /** the flower heads, the lead first: the one flower, or a lily's lowest; then its later flowers and its tip bud */
  heads: HeadRefs[];
  /** the lead's glow (the one light a plant has, whatever it carries) */
  glow: THREE.PointLight | null;
  /** the petal materials (one per colour variant) in use, so the frame loop can drive their emissive */
  petalMats: THREE.MeshPhysicalMaterial[];
}

interface PlantContextValue {
  bp: Blueprint;
  geo: PlantGeometry;
  refs: PlantRefs;
  quality: Quality;
  /** a lily's flowers bottom-up and its tip bud (lib/plant/raceme), the heads' indices; empty for a lone flower */
  raceme: RacemeNode[];
}

/** The store's numbers as the frame loop eases them. */
interface HeroVisual extends PlantVisual {
  droop: number;
  flower: number;
  glow: number;
  rot: number;
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
const qHead = new THREE.Quaternion();
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
    heads: [],
    glow: null,
    petalMats: [],
  };
}

function headEntry(refs: PlantRefs, index: number, node: RacemeNode | null): HeadRefs {
  let e = refs.heads[index];
  if (!e) {
    e = {
      node,
      head: null,
      headBody: null,
      bud: null,
      stamens: null,
      petals: [],
      sepals: [],
      pedicel: null,
      pedicelBase: null,
      pedicelLean: null,
      pedicelTube: null,
      pedicelEnd: null,
    };
    refs.heads[index] = e;
  }
  return e;
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

function petalEntry(head: HeadRefs, index: number, node: PetalNode): PetalRefs {
  let e = head.petals[index];
  if (!e) {
    e = { group: null, mesh: null, node };
    head.petals[index] = e;
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

  const fadeBand = useGarden((s) => quantize(heroLeafFade(fadeOf(leafHealth(s, leaf.order)), s.chlorosis, leaf.order), 4));
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

/**
 * A flower head: `index` 0 is the lead (the one flower that crowns a stem, or a lily's lowest), which alone carries the
 * glow light; a lily's others are its later flowers and, last, its tip bud (PlantContextValue raceme).
 */
function FlowerHead({ index }: { index: number }) {
  const { bp, geo, refs, quality, raceme } = usePlant();
  const sp = bp.species;
  const f = sp.flower;
  const c = f.center;
  const L = f.layers.length;
  const node = raceme[index] ?? null;
  const lead = index === 0;
  // where the receptacle (or a jasmine's tube) and the sepals sit
  const base = receptacleShape(f);

  const petalFade = useGarden((s) => quantize(fadeOf(s.health) * 0.85, 4));
  const petalBurn = useGarden((s) => quantize(s.scorch, 3));
  // the cached materials, so every head of a lily or a jasmine wears the same ones
  const petalMats = useMemo(
    () => Array.from({ length: VARIANTS }, (_, v) => petalMaterial(sp, petalFade, petalBurn, quality, v)),
    [sp, petalFade, petalBurn, quality],
  );

  useEffect(() => {
    if (lead) refs.petalMats = petalMats;
  }, [refs, petalMats, lead]);

  // a lily's long stamens round its style (lib/plant/stamens), or every other flower's short tuft
  const long = useMemo(() => longStamens(bp.seed, c), [bp.seed, c]);
  const stamens = useMemo<Stamen[]>(() => {
    if (c.long) return [];
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
        headEntry(refs, index, node).sepals[k] = g;
      }),
    [refs, index, node, sepalCount],
  );
  const petalSetters = useMemo(
    () =>
      bp.petals.map((p, i) => ({
        group: (g: THREE.Group | null) => {
          petalEntry(headEntry(refs, index, node), i, p).group = g;
        },
        mesh: (m: THREE.Mesh | null) => {
          if (m) m.updateMorphTargets();
          petalEntry(headEntry(refs, index, node), i, p).mesh = m;
        },
      })),
    [refs, index, node, bp.petals],
  );

  const setHead = useCallback(
    (g: THREE.Group | null) => {
      headEntry(refs, index, node).head = g;
    },
    [refs, index, node],
  );
  const setHeadBody = useCallback(
    (g: THREE.Group | null) => {
      headEntry(refs, index, node).headBody = g;
    },
    [refs, index, node],
  );
  const setBud = useCallback(
    (m: THREE.Mesh | null) => {
      headEntry(refs, index, node).bud = m;
    },
    [refs, index, node],
  );
  const setStamens = useCallback(
    (g: THREE.Group | null) => {
      headEntry(refs, index, node).stamens = g;
    },
    [refs, index, node],
  );
  const setGlow = useCallback(
    (l: THREE.PointLight | null) => {
      refs.glow = l;
    },
    [refs],
  );

  return (
    // a lily's flower turns about its own axis by its spin, so the three are not copies of each other
    <group ref={setHead} rotation-y={node ? node.spin : bp.flowerYaw}>
      {/* the head's parts in a group of their own: hiding them must never hide the glow light, since a light leaving
          the scene changes every lit material's program (see lightSets.ts) */}
      <group ref={setHeadBody}>
        {/* receptacle: its rim sits just under the petal bases (a jasmine's: its slender tube) */}
        <mesh geometry={geo.receptacle} material={sepalMaterial(sp)} position-y={base.y} castShadow />
        {/* bud core */}
        <mesh
          ref={setBud}
          geometry={sphereGeometry()}
          material={budMaterial(sp)}
          scale={[f.budRadius, f.budRadius * (f.budAspect ?? 1), f.budRadius]}
          position-y={f.budRadius * 0.6 * (f.budAspect ?? 1)}
          castShadow
        />
        {/* sepals */}
        {sepalGeo
          ? sepalSetters.map((setSepal, k) => (
              <group key={k} rotation-y={(k / sepalCount) * 2 * Math.PI + 0.3}>
                <group ref={setSepal} position={[0, base.sepalY, base.sepalR]} rotation-x={0.2}>
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
          {long.map((s, k) => (
            <group key={`long${k}`} rotation-y={s.yaw}>
              {/* leaning out of the throat toward +z; the anther lies across the tip, along x */}
              <group position-z={s.foot} rotation-x={s.lean}>
                <mesh
                  geometry={petioleGeometry()}
                  material={filamentMaterial(sp, "filament")}
                  scale={[s.style ? STYLE_GIRTH : FILAMENT_GIRTH, s.length, s.style ? STYLE_GIRTH : FILAMENT_GIRTH]}
                />
                <mesh
                  geometry={sphereGeometry()}
                  material={s.style ? filamentMaterial(sp, "stigma") : stamenMaterial(sp)}
                  position-y={s.length}
                  scale={(s.style ? STIGMA : ANTHER).map((a) => a * s.length) as [number, number, number]}
                />
              </group>
            </group>
          ))}
        </group>
      </group>
      {/* glow: the lead's alone, so a lily's stem of flowers has the one light a plant has always had (lightSets.ts) */}
      {lead ? (
        <pointLight
          ref={setGlow}
          userData={OPTIONAL_LIGHT}
          color={sp.fx.glowColor}
          intensity={0}
          distance={1.8}
          decay={2}
          position={[0, 0.05, 0]}
        />
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------
// A lily flower's stalk

/**
 * A stalk off the cane, placed as a leaf is (riding its segment's growth and girth in the frame loop): turned to its
 * bearing round the stem, leant out from it, a slim tube curving back up, and the flower at its end. The frame loop
 * grows the tube and carries the flower out along it (lib/plant/raceme racemeStalkGrowth).
 */
function Pedicel({ index }: { index: number }) {
  const { bp, geo, refs, raceme } = usePlant();
  const sp = bp.species;
  const n = bp.stem.length;
  const node = raceme[index];
  const seg = bp.stem[node.seg];
  const shape = geo.pedicels[index];

  const at = useMemo(() => stemPointAt(seg.length, seg.dx, seg.dz, node.t), [seg, node.t]);

  const setOuter = useCallback(
    (g: THREE.Group | null) => {
      const e = headEntry(refs, index, node);
      e.pedicel = g;
      // R3F copies `at.position` into the group, so this stays the untouched rest point.
      e.pedicelBase = at.position;
    },
    [refs, index, node, at],
  );
  const setLean = useCallback(
    (g: THREE.Group | null) => {
      headEntry(refs, index, node).pedicelLean = g;
    },
    [refs, index, node],
  );
  const setTube = useCallback(
    (m: THREE.Mesh | null) => {
      headEntry(refs, index, node).pedicelTube = m;
    },
    [refs, index, node],
  );
  const setEnd = useCallback(
    (g: THREE.Group | null) => {
      headEntry(refs, index, node).pedicelEnd = g;
    },
    [refs, index, node],
  );

  if (!shape) return null;
  return (
    <group ref={setOuter} position={at.position} quaternion={at.quaternion}>
      <group rotation-y={node.yaw}>
        <group ref={setLean} rotation-x={node.out}>
          {/* the cane's own top segment's material: a stalk is the stem's green, no new material */}
          <mesh ref={setTube} geometry={shape.geometry} material={stemMaterial(sp, n - 1, n)} castShadow receiveShadow />
          {/* (R3F copies the end's position, so geo keeps the full-length rest point the frame loop scales) */}
          <group ref={setEnd} position={shape.end.position} quaternion={shape.end.quaternion}>
            <FlowerHead index={index} />
          </group>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Stem segment (recursive)

function Segment({ i }: { i: number }) {
  const { bp, geo, refs, raceme } = usePlant();
  const sp = bp.species;
  const n = bp.stem.length;
  const end = geo.ends[i];
  // the head on the cane's tip: the one flower, or a lily's tip bud (its last raceme node)
  const tip = Math.max(0, raceme.length - 1);

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
      {raceme.map((node, idx) => (node.seg === i && !node.tipBud ? <Pedicel key={`p${idx}`} index={idx} /> : null))}
      <group ref={setMount} position={end.position} quaternion={end.quaternion}>
        {i + 1 < n ? (
          <Segment i={i + 1} />
        ) : raceme.length > 0 ? (
          // a lily's tip bud, turned to the way it leans
          <group rotation-y={raceme[tip].yaw}>
            <FlowerHead index={tip} />
          </group>
        ) : (
          <FlowerHead index={tip} />
        )}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Plant

export function Plant() {
  const speciesId = useGarden((s) => s.speciesId);
  const seed = useGarden((s) => s.seed);
  const quality = useTier();
  const sp = SPECIES[speciesId];
  // The species blueprint, re-dressed for the hero: a fuller run of leaves up
  // the cane (see heroGrowth) and a cane a touch sturdier under its bloom.
  const bp = useMemo<Blueprint>(() => {
    const base = buildBlueprint(seed, sp);
    const stem = base.stem.map((s) => ({ ...s, r0: s.r0 * 1.08, r1: s.r1 * 1.16 }));
    return { ...base, stem, leaves: heroLeaves(seed, sp, stem.length) };
  }, [seed, sp]);
  // a lily's flowers up the top of its stem and its tip bud (none for a flower that grows alone)
  const raceme = useMemo(() => racemeNodes(seed, sp, bp.stem.length), [seed, sp, bp.stem.length]);
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
    const shape = receptacleShape(species.flower);
    const receptacle = makeReceptacleGeometry(shape.radius, shape.height, 3);
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
    const pedicels = raceme.map((node) => {
      if (node.tipBud) return null;
      const s = pedicelShape(node, species);
      return { geometry: makeStemGeometry(s.length, s.r0, s.r1, 0, s.dz, 8, 8), end: stemEndTransform(s.length, 0, s.dz) };
    });
    return { stem, petals, leaves, sepal, receptacle, rachis, rachisLength, thorn, ends, pedicels };
  }, [bp, raceme, quality]);

  useEffect(
    () => () => {
      for (const g of geo.stem) g.dispose();
      for (const layer of geo.petals) for (const g of layer) g.dispose();
      for (const g of geo.leaves) g.dispose();
      geo.sepal?.dispose();
      geo.receptacle.dispose();
      geo.rachis.dispose();
      geo.thorn?.dispose();
      for (const p of geo.pedicels) p?.geometry.dispose();
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

  const ctx = useMemo<PlantContextValue>(() => ({ bp, geo, refs: R, quality, raceme }), [bp, geo, R, quality, raceme]);

  const budMat = budMaterial(sp);
  const vis = useRef<HeroVisual | null>(null);
  // A different plant (a colleague's seed replacing the owner's rose) starts from its own numbers, not eased from the last one's.
  const visKey = useRef(key);

  useLayerFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * 2.5);
    const s = garden.get();
    if (visKey.current !== key) {
      visKey.current = key;
      vis.current = null;
    }
    let v = vis.current;
    if (!v) {
      const base = { growth: s.growth, bloom: s.bloom, health: s.health, moisture: s.moisture, scorch: s.scorch };
      v = { ...base, droop: s.droop ?? droopOf(base), flower: s.flowerSize, glow: s.glow, rot: s.rot };
      vis.current = v;
    } else {
      v.growth += (s.growth - v.growth) * k;
      v.bloom += (s.bloom - v.bloom) * k;
      v.health += (s.health - v.health) * k;
      v.moisture += (s.moisture - v.moisture) * k;
      v.scorch += (s.scorch - v.scorch) * k;
      // without a live droop the plant droops from its eased moisture and health, as it always has
      v.droop = s.droop === null ? droopOf(v) : v.droop + (s.droop - v.droop) * k;
      v.flower += (s.flowerSize - v.flower) * k;
      v.glow += (s.glow - v.glow) * k;
      v.rot += (s.rot - v.rot) * k;
    }

    const t = env.time;
    // the bloom card's frames draw the flower fully open and standing (lib/garden/cardShot); the eased numbers go on
    const card = cardShot.active;
    const droop = card ? Math.min(v.droop, CARD_DROOP) : v.droop;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
    const windAmp = env.wind * (0.4 + 0.6 * gust);
    axis.set(Math.sin(bp.leanDir), 0, -Math.cos(bp.leanDir));

    // stem segments
    const n = bp.stem.length;
    // Rot darkens the cane where it meets the mulch: the base segment's material is the hero's alone (stemMaterial keys it by position).
    const baseMat = R.tubes[0]?.material;
    if (baseMat instanceof THREE.MeshPhysicalMaterial) baseMat.color.setRGB(1 - 0.42 * v.rot, 1 - 0.5 * v.rot, 1 - 0.56 * v.rot);
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

    // flower heads
    const f = sp.flower;
    const L = f.layers.length;
    const layerDen = Math.max(1, L - 1);
    // Before the bud forms, the head is the cane's growing tip: the closed
    // sepals alone, a small pointed green shoot, so the stem never ends in a
    // cut-off tube. The petals and bud core show once the bud starts to swell.
    // A lily's flowers each swell on their own bud and open on their own
    // morning (lib/plant/raceme), from the hours since its lead opened.
    const leadBud = heroBudGrowth(v.growth);
    const eb = (card ? Math.max(v.bloom, CARD_BLOOM) : v.bloom) * smoothstep(0.8, 0.92, v.growth);
    const headShown = heroStemFraction(v.growth) > 0.005;
    const opened = s.opened;
    const heads = R.heads;
    const tipHead = heads[heads.length - 1];
    // the head the camera, the card and the butterflies follow: the lead, once its bud shows on its stalk
    let followed: HeadRefs | undefined = heads[0];
    // the lead's glow lights only while the lead itself is drawn
    let leadShown = false;
    cardShot.bodies.length = 0;
    for (let h = 0; h < heads.length; h++) {
      const e = heads[h];
      if (!e) continue;
      const node = e.node;
      const bud = node ? racemeBudGrowth(heroBudGrowth, v.growth, node) : leadBud;
      const ebH = node ? eb * racemeOpen(node, opened) : eb;
      const petalsShown = bud > BUD_SHOWN;
      let shown = headShown;
      if (node && !node.tipBud) {
        // a flower's stalk rides its segment as a leaf does, grows out with its bud and spreads as its flower opens
        const grow = racemeStalkGrowth(bud, ebH);
        shown = headShown && petalsShown;
        if (e.pedicel && e.pedicelBase) {
          const gi = heroSegmentGrowth(v.growth, node.seg, n);
          const sx = heroStemGirth(v.growth, gi);
          e.pedicel.position.set(e.pedicelBase.x * sx, e.pedicelBase.y * gi, e.pedicelBase.z * sx);
        }
        if (e.pedicelTube) {
          e.pedicelTube.scale.setScalar(Math.max(0.0001, grow));
          e.pedicelTube.visible = shown;
        }
        const end = geo.pedicels[h]?.end.position;
        if (e.pedicelEnd && end) e.pedicelEnd.position.set(end.x * grow, end.y * grow, end.z * grow);
        // a thirsty lily's flowers hang a little on their stalks
        if (e.pedicelLean) e.pedicelLean.rotation.x = racemeStalkLean(node, ebH) + droop * 0.5 + windAmp * 0.05 * Math.sin(t * 1.9 + node.yaw);
      }
      if (h === 0) {
        leadShown = shown;
        if (!shown && tipHead) followed = tipHead;
      }
      if (e.headBody) {
        e.headBody.visible = shown;
        if (shown) cardShot.bodies.push(e.headBody);
      }
      const head = e.head;
      if (head) {
        // a flower that budded under stress, or a second-chance sprout's, opens smaller
        head.scale.setScalar((node ? racemeHeadScale(node, bud) : 0.3 + 0.7 * bud) * (0.6 + 0.4 * v.flower));
        head.rotation.x = (node ? node.tilt : bp.headTilt) + droop * 0.9 + windAmp * 0.03 * Math.sin(t * 1.7 + (node ? node.yaw : 0));
      }

      const petals = e.petals;
      for (let j = 0; j < petals.length; j++) {
        const pe = petals[j];
        if (!pe || !pe.group) continue;
        pe.group.visible = petalsShown;
        const p = pe.node;
        const o = petalOpen(ebH, p.stagger);
        // Closed petals lean a little inward so the bud closes to a teardrop.
        pe.group.rotation.x =
          o * p.openTarget -
          (1 - o) * (f.budClose ?? 0.18) +
          droop * 0.3 * (p.layer / layerDen) +
          windAmp * 0.04 * Math.sin(t * 2.2 + p.phase) * (0.3 + 0.7 * o);
        pe.group.scale.setScalar(lerp(f.budLength ?? 0.55, 1, o) * p.scale);
        const inf = pe.mesh ? pe.mesh.morphTargetInfluences : undefined;
        if (inf) inf[0] = smoothstep(0.05, 0.95, o);
      }

      const budMesh = e.bud;
      if (budMesh) {
        const br = Math.max(0.0001, f.budRadius * (1 - ebH) * (0.6 + 0.4 * bud));
        budMesh.scale.set(br, br * (f.budAspect ?? 1), br);
        budMesh.visible = petalsShown && ebH < 0.9;
      }

      const sepals = e.sepals;
      // Closed round the young bud, parting a little as it swells to show its colour, then folding back as it opens.
      const sepalRot = 0.06 + 0.32 * heroSepalPart(bud) + 1.4 * smoothstep(0, 0.6, ebH) + droop * 0.2;
      const sepalScale = 0.75 + 0.25 * bud;
      for (let j = 0; j < sepals.length; j++) {
        const sg = sepals[j];
        if (!sg) continue;
        sg.rotation.x = sepalRot;
        sg.scale.setScalar(sepalScale);
      }

      const stamens = e.stamens;
      if (stamens) {
        stamens.visible = ebH > 0.6;
        stamens.scale.setScalar(Math.max(0.001, ebH));
      }
    }

    // emissive and glow, held against the tone-mapping exposure: the lite tier
    // opens its exposure as night falls to keep the bed readable, and the
    // petals' own light must not ride that lift up through the bloom threshold
    const night = env.nightness;
    const pulse = sp.fx.pulse ? 0.75 + 0.25 * Math.sin(t * 1.4) : 1;
    const lift = Math.max(1, state.gl.toneMappingExposure / BASE_EXPOSURE);
    // lite's petals have no transmission to spread their light, so it reads stronger there
    const tierGlow = quality === "lite" ? 0.75 : 1;
    // a kind word lifts the petals' own light a little for the hour that follows
    const kind = 1 + 0.5 * v.glow;
    const ei =
      (lerp(f.emissiveDay, f.emissiveNight, night) * (0.3 + 0.7 * v.health) * (0.2 + 0.8 * eb) * pulse * tierGlow * kind) / lift;
    const mats = R.petalMats;
    for (let j = 0; j < mats.length; j++) mats[j].emissiveIntensity = ei;
    budMat.emissiveIntensity = ei * 0.3;
    const glow = R.glow;
    // The glow sits in the heart of the bloom, centimetres from the inner petals; on lite,
    // with nothing to soften it, it burns a white spot there, so it is kept low.
    // (it stays in the scene while the head is not yet shown, so the light count never changes, but gives no light)
    if (glow) glow.intensity = leadShown ? ei * (quality === "lite" ? 1.1 : 3) * night * (sp.fx.glowNight ? 1 : 0.2) : 0;

    const head = followed?.head ?? null;
    if (head) {
      head.getWorldPosition(env.headPos);
      env.headUp.set(0, 1, 0).applyQuaternion(head.getWorldQuaternion(qHead));
    }
    // the crown is the tip's head: the one flower itself, or a lily's tip bud on the mount its one flower had
    const crown = tipHead?.head ?? null;
    if (crown === head) env.crownPos.copy(env.headPos);
    else if (crown) crown.getWorldPosition(env.crownPos);
    cardShot.head = head;
    cardShot.headBody = followed?.headBody ?? null;
  });

  return (
    <group key={key} scale={HERO_SCALE}>
      <PlantCtx value={ctx}>
        <Segment i={0} />
      </PlantCtx>
    </group>
  );
}
