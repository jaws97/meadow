"use client";
/* eslint-disable react-hooks/refs, react-hooks/immutability --
   As components/garden/Plant.tsx: ref callbacks write three.js objects into a plain registry, the single frame loop
   reads it and moves, sways and lights them without allocating. The React Compiler lint reads that mutable escape
   hatch as a violation; it is intentional and nothing it writes feeds back into what React renders. */
// The lotus plant, drawn from a LotusLook (look.ts): floating leaves on the water (or lying on the bare mud), standing
// leaves on prickly stalks, and the flower stalk carrying the bud, the flower or the seed pod, with fallen petals
// drifting on the water. All in the look's frame: the pot's in the pond (KoiPond places it), or the urli's (Meadow).
// In the pond the standing leaves and the flower are marked for the water's reflection, and the stalks' crossings of
// the surface are handed to the water for its meniscus. The geometry is rebuilt when the look changes (each
// frame of the concepts page is one look); the frame loop only sways, glows and reports the flower head (env.headPos:
// the depth of field, the butterflies and the camera rig all follow it).
//
// Emotion without faces (section 7): taut stalks and cupped blades when content; when the mud dries the stalks bow in
// their top third, the cups flatten and turn in, the floating leaves brown and curl; the flower's warmth (a real
// 30-36 degC flower) shows as a steady amber light in its heart, never a pulse, never on the pod.
//
// A live lotus (the product's courtyard, components/lotus/product) keeps one look while its shape holds and moves the
// rest every frame from the same look object, which it rewrites in place: the flower's opening (the petals' angle,
// their bud-to-open shape and the stamens' splay), its warmth and day 3's relaxing outer whorl. `live` adds what the
// look does not carry: the floating leaves riding the eased level, hungry koi nosing them, aphids on the bud and the
// stalk's top, and a kind word's glow. A leaf that is new since the last build grows in over a few seconds (a floating
// leaf spreading on the water, a standing leaf rising on its stalk and unrolling), so a count stepping up never pops; a
// first build draws every leaf as it is.
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { env } from "@/lib/garden/env";
import { lerp, smoothstep } from "@/lib/plant/prng";
import { BASE_EXPOSURE } from "@/components/garden/Effects";
import { OPTIONAL_LIGHT } from "@/components/garden/lightSets";
import { useLayerFrame } from "@/components/garden/TierLayers";
import type { Tier } from "@/components/lotus/geometry";
import { buildPlant, disposeBuilt, petalAngle, stamenMatrix, WHORLS } from "@/components/lotus/build";
import { padMaterial, petalMaterial, receptacleMaterial, stalkMaterial, stamenMaterial, tepalMaterial } from "@/components/lotus/materials";
import type { LotusLook } from "@/components/lotus/look";
import type { PetalColour } from "@/components/lotus/params";

/** The flower's warm light. */
const GLOW_COLOR = "#ffc27a";

// ---------------------------------------------------------------------------------------------------------------------
// The registry the frame loop reads

interface PetalRef {
  group: THREE.Group | null;
  mesh: THREE.Mesh | null;
  whorl: number;
  index: number;
  phase: number;
}

interface Refs {
  root: THREE.Group | null;
  body: THREE.Group | null;
  floats: (THREE.Group | null)[];
  stands: (THREE.Group | null)[];
  blades: (THREE.Group | null)[];
  flower: THREE.Group | null;
  head: THREE.Group | null;
  petals: PetalRef[];
  tepals: (THREE.Group | null)[];
  glow: THREE.PointLight | null;
  stamen: THREE.InstancedMesh | null;
  aphids: THREE.InstancedMesh | null;
}

const emptyRefs = (): Refs => ({ root: null, body: null, floats: [], stands: [], blades: [], flower: null, head: null, petals: [], tepals: [], glow: null, stamen: null, aphids: null });

/** What a live lotus adds to its look each frame (the product's courtyard). */
export interface PlantLive {
  /** the floating leaves' lift over the level they were built at (m): the eased level against the built one */
  floatLift: number;
  /** hungry koi nosing the floating leaves, 0..1: now and then a leaf twitches */
  nibble: number;
  /** aphids on the bud and the top of its stalk, 0..1 (the model's aphid pressure) */
  aphids: number;
  /** the soft extra glow for the hour after a kind word, 0..1 */
  glow: number;
  /** the plant shows (false while a planted seedling is still gliding to its pot: its leaves grow in once it lands) */
  show: boolean;
}

/** Seconds a new leaf takes to grow in: a floating leaf spreading, a standing leaf rising and unrolling. */
const GROW_IN = { float: 5, stand: 7 } as const;

/**
 * The aphids' places in the head's frame: a cluster on the stalk just under the head (they feed on the soft tissue
 * there) and a few on the outer petals' bases. Tiny (1.5-2.5 mm, as they are), so they read only in a close look.
 */
const APHIDS = (() => {
  const out: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 16; i++) {
    const onStalk = i < 11;
    const a = i * 2.39996 + 0.4;
    const r = onStalk ? 0.0049 : 0.019 + (0.004 * ((i * 7) % 3)) / 2;
    const y = onStalk ? -0.03 - 0.0042 * i : -0.016 + 0.004 * (i % 3);
    const s = 0.0009 + 0.0004 * ((i * 5) % 3);
    q.setFromAxisAngle(up, -a);
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.8, s * 1.5)));
  }
  return out;
})();
const aphidGeometry = new THREE.SphereGeometry(1, 6, 4);
const aphidMaterial = new THREE.MeshStandardMaterial({ color: "#9cb64a", roughness: 0.55, metalness: 0 });
const stamenScratch = new THREE.Matrix4();

/** Rain beads: mercury, not wet gloss (a bright point highlight, very smooth). */
const beadMaterial = new THREE.MeshStandardMaterial({ color: "#d6e0e4", roughness: 0.03, metalness: 0, envMapIntensity: 1.5, transparent: true, opacity: 0.85 });

/** Where the plant's stalks pass through the water's surface, for the pond's meniscus (written as the plant builds). */
export interface PlantMeniscus {
  pierce: THREE.Vector2[];
}

export function LotusPlant({
  look,
  tier,
  colour,
  rain,
  meniscus,
  glowLight = true,
  live,
}: {
  look: LotusLook;
  tier: Tier;
  colour: PetalColour;
  rain: boolean;
  meniscus?: RefObject<PlantMeniscus>;
  /** the flower's own warm point light (the Meadow's river draws many plants and lights only the one it visits) */
  glowLight?: boolean;
  /** a live lotus's extras (PlantLive), read every frame */
  live?: RefObject<PlantLive | null>;
}) {
  const built = useMemo(() => buildPlant(look, tier, rain), [look, tier, rain]);
  useEffect(() => () => disposeBuilt(built), [built]);
  useEffect(() => {
    if (meniscus?.current) meniscus.current.pierce = built.pierce;
  }, [meniscus, built]);

  // a fresh registry whenever the build changes, and the leaves that are new since the last one marked to grow in
  const refs = useRef<Refs>(emptyRefs());
  const lastBuilt = useRef(built);
  const born = useRef<{ floats: number[]; stands: number[] }>({ floats: [], stands: [] });
  if (lastBuilt.current !== built) {
    const was = lastBuilt.current;
    lastBuilt.current = built;
    refs.current = emptyRefs();
    const b = born.current;
    b.floats = built.floats.map((_, i) => (i >= was.floats.length ? env.time : (b.floats[i] ?? -Infinity)));
    b.stands = built.stands.map((_, i) => (i >= was.stands.length ? env.time : (b.stands[i] ?? -Infinity)));
  }
  const R = refs.current;
  const setAphids = useCallback(
    (m: THREE.InstancedMesh | null) => {
      R.aphids = m;
      if (!m) return;
      APHIDS.forEach((mat, i) => m.setMatrixAt(i, mat));
      m.instanceMatrix.needsUpdate = true;
      m.count = 0;
    },
    [R],
  );
  const lastStamenOpen = useRef(-1);

  const f = look.flower;
  const flowerMat = petalMaterial(f.kind === "bud" ? "bud" : colour, tier);
  const fallenMat = petalMaterial(colour, tier);
  const recMat = receptacleMaterial();
  const stamMat = stamenMaterial();
  const stalkMat = stalkMaterial();

  const setRoot = useCallback((g: THREE.Group | null) => void (R.root = g), [R]);
  const setBody = useCallback((g: THREE.Group | null) => void (R.body = g), [R]);
  const hidden = useRef(false);
  const setFlower = useCallback((g: THREE.Group | null) => void (R.flower = g), [R]);
  const setHead = useCallback((g: THREE.Group | null) => void (R.head = g), [R]);
  const setGlow = useCallback((l: THREE.PointLight | null) => void (R.glow = l), [R]);
  const stamenRef = useCallback(
    (m: THREE.InstancedMesh | null) => {
      R.stamen = m;
      lastStamenOpen.current = -1;
      if (!m || !built.flower) return;
      built.flower.stamenMatrices.forEach((mat, i) => m.setMatrixAt(i, mat));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    },
    [built, R],
  );
  const beadRef = useCallback(
    (beads: THREE.Matrix4[]) => (m: THREE.InstancedMesh | null) => {
      if (!m) return;
      beads.forEach((mat, i) => m.setMatrixAt(i, mat));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    },
    [],
  );

  // the petals' arrangement: whorl by whorl, outer first (so the first `fallen` petals are the outer ones)
  const petalSlots = useMemo(() => {
    const slots: { whorl: number; index: number; yaw: number; variant: number; jitter: number }[] = [];
    if (!built.flower || built.flower.petals.length === 0) return slots;
    WHORLS.forEach((w, wi) => {
      for (let k = 0; k < w.count; k++) slots.push({ whorl: wi, index: k, yaw: w.yaw0 + (k / w.count) * Math.PI * 2, variant: k % 2, jitter: Math.sin(k * 2.3 + wi) * 0.04 });
    });
    return slots;
  }, [built]);

  useLayerFrame((state) => {
    const t = env.time;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
    const wind = env.wind * (0.4 + 0.6 * gust);
    const lv = live?.current ?? null;
    const lift = lv ? lv.floatLift : 0;
    const nibble = lv ? lv.nibble : 0;
    // hidden while a planted seedling glides to its pot; when it lands every leaf grows in from there
    const show = lv ? lv.show : true;
    if (R.body) R.body.visible = show;
    if (show && hidden.current) {
      born.current.floats = born.current.floats.map(() => t);
      born.current.stands = born.current.stands.map(() => t);
    }
    hidden.current = !show;

    // floating leaves bob a millimetre and turn a few degrees on the ripples; a still dawn is glassy; a hungry koi's
    // nose now and then gives one a small knock from below
    for (let i = 0; i < R.floats.length; i++) {
      const g = R.floats[i];
      const b = built.floats[i];
      if (!g || !b) continue;
      if (b.leaf.onMud) continue;
      // (an inner group, so the leaf's own yaw and tilt are kept)
      const knock = nibble > 0 ? nibble * Math.max(0, Math.sin(t * 0.9 + i * 2.3) - 0.93) * 14 : 0;
      g.position.y = 0.001 * wind * Math.sin(t * 1.3 + i * 1.9) + lift + 0.0025 * knock;
      g.rotation.y = 0.05 * wind * Math.sin(t * 0.4 + i * 2.7) + 0.08 * knock * Math.sin(t * 7 + i);
      const k = smoothstep(0, GROW_IN.float, t - (born.current.floats[i] ?? -Infinity));
      g.scale.setScalar(0.3 + 0.7 * k);
    }
    // standing leaves sway like slow sails about their stalks' feet; the blades rock a little more; a new one rises
    // on its stalk and its blade unrolls (narrow to round)
    for (let i = 0; i < R.stands.length; i++) {
      const g = R.stands[i];
      const k = smoothstep(0, GROW_IN.stand, t - (born.current.stands[i] ?? -Infinity));
      if (g) {
        g.rotation.x = 0.012 * wind * Math.sin(t * 1.5 + i * 2.1);
        g.rotation.z = 0.01 * wind * Math.sin(t * 1.1 + i * 1.3);
        g.scale.setScalar(0.55 + 0.45 * k);
      }
      const blade = R.blades[i];
      if (blade) {
        blade.rotation.x = 0.04 * wind * Math.sin(t * 4.2 + i * 1.7);
        blade.rotation.z = 0.03 * wind * Math.sin(t * 3.8 + i * 0.9);
        blade.scale.set(0.3 + 0.7 * smoothstep(0.3, 1, k), 1, 0.6 + 0.4 * k);
      }
    }
    // the flower sways at half the leaves' strength
    if (R.flower) {
      R.flower.rotation.x = 0.006 * wind * Math.sin(t * 1.2 + 0.7);
      R.flower.rotation.z = 0.005 * wind * Math.sin(t * 0.9 + 2.1);
    }

    // petals: their pose is the look's (a live look moves it); only a breath of wind moves them
    for (const p of R.petals) {
      if (!p?.group) continue;
      const w = WHORLS[p.whorl];
      p.group.rotation.x = petalAngle(w, f.open, f.morph, f.relax, f.kind === "bud") + p.phase + wind * 0.012 * Math.sin(t * 2.2 + p.index) * (0.3 + 0.7 * f.open);
      const inf = p.mesh?.morphTargetInfluences;
      if (inf) inf[0] = f.morph;
    }
    // the stamens splay with the opening (moved only when it has changed)
    const stamen = R.stamen;
    if (stamen && f.kind === "flower" && Math.abs(f.open - lastStamenOpen.current) > 0.004) {
      lastStamenOpen.current = f.open;
      for (let i = 0; i < stamen.count; i++) stamen.setMatrixAt(i, stamenMatrix(i, f.open, stamenScratch));
      stamen.instanceMatrix.needsUpdate = true;
    }
    // aphids: as many as the pressure, only on a bud or a flower
    const aphids = R.aphids;
    if (aphids) aphids.count = f.kind === "bud" || f.kind === "flower" ? Math.round(APHIDS.length * Math.min(1, (lv?.aphids ?? 0) * 1.4)) : 0;

    // the warmth: a steady amber in the heart, held against the tone-mapping exposure like the garden's petals
    const night = env.nightness;
    const exposureLift = Math.max(1, state.gl.toneMappingExposure / BASE_EXPOSURE);
    const warm = f.kind === "flower" || f.kind === "bud" ? f.warmth : 0;
    // a kind word lifts the petals' own light a little for the hour that follows, as it does the soil flowers'
    const kind = lv ? lv.glow : 0;
    const ei = (lerp(0.02, 0.35 * warm, night) * (1 + 0.5 * kind) + 0.03 * kind) / exposureLift;
    flowerMat.emissiveIntensity = ei * (tier === "lite" ? 1.2 : 1);
    const heart = lerp(0.15, 1, night) / exposureLift;
    recMat.emissiveIntensity = f.kind === "flower" ? 0.6 * warm * heart : 0;
    stamMat.emissiveIntensity = 0.3 * warm * heart;
    const glow = R.glow;
    if (glow) {
      if (look.glowAt === "seed") {
        glow.position.set(...look.seedAt);
        glow.intensity = ((0.08 + 0.3 * night) * (0.4 + 0.6 * look.jar.clarity) * (1 + 0.6 * kind)) / exposureLift;
        glow.distance = 0.7;
      } else if (look.glowAt === "head" && R.head) {
        R.head.getWorldPosition(glow.position);
        glow.parent?.worldToLocal(glow.position);
        // (the pond's flower stands nearer its leaves than the urli's: a softer light)
        glow.intensity = ei * (tier === "lite" ? 0.66 : look.frame === "pond" ? 1.0 : 1.8) * Math.max(night, 0.35 * kind);
        glow.distance = 1.8;
      } else glow.intensity = 0;
    }

    // what the camera, the focus and the butterflies follow
    if ((f.kind === "flower" || f.kind === "bud" || f.kind === "pod") && R.head) R.head.getWorldPosition(env.headPos);
    else if (R.root) env.headPos.set(...look.focus).applyMatrix4(R.root.matrixWorld);
  });

  const fl = built.flower;
  const tepal = fl?.tepal ?? null;
  return (
    <group ref={setRoot} name="lotus">
      {/* everything but the light, so the plant can be hidden while its light (and the light count) stays */}
      <group ref={setBody}>
        {built.floats.map((b, i) => (
          <group key={`f${i}`}>
            <group position={[b.leaf.x, b.leaf.y, b.leaf.z]}>
              <group
                ref={(g) => {
                  R.floats[i] = g;
                }}
              >
                <mesh geometry={b.pad} material={padMaterial("float", b.leaf.pale, b.leaf.brown, 0, b.leaf.seed, tier)} quaternion={b.quat} castShadow receiveShadow />
              </group>
            </group>
            {b.stalk ? <mesh geometry={b.stalk} material={stalkMat} /> : null}
          </group>
        ))}
        {built.stands.map((b, i) => (
          <group
            key={`s${i}`}
            ref={(g) => {
              R.stands[i] = g;
            }}
            position={b.leaf.base}
            userData={{ pondReflect: true }}
          >
            <group position={[-b.leaf.base[0], -b.leaf.base[1], -b.leaf.base[2]]}>
              <mesh geometry={b.stalk} material={stalkMat} castShadow receiveShadow />
              <group position={b.leaf.top}>
                <group
                  ref={(g) => {
                    R.blades[i] = g;
                  }}
                >
                  <group quaternion={b.quat}>
                    <mesh geometry={b.pad} material={padMaterial("stand", b.leaf.pale, 0, b.leaf.crisp, b.leaf.seed, tier)} castShadow receiveShadow />
                    {built.bead && b.beads.length > 0 ? <instancedMesh ref={beadRef(b.beads)} args={[built.bead, beadMaterial, b.beads.length]} /> : null}
                  </group>
                </group>
              </group>
            </group>
          </group>
        ))}
        {built.rolled.map((r, i) => (
          <group key={`r${i}`} userData={{ pondReflect: true }}>
            <mesh geometry={r.stalk} material={stalkMat} castShadow receiveShadow />
            <mesh geometry={r.scroll} material={padMaterial("stand", 0, 0, 0, r.leaf.seed, tier)} castShadow receiveShadow />
          </group>
        ))}
        {fl ? (
          <group ref={setFlower} position={f.base} userData={{ pondReflect: true }}>
            <group position={[-f.base[0], -f.base[1], -f.base[2]]}>
              <mesh geometry={fl.stalk} material={stalkMat} castShadow receiveShadow />
              <group ref={setHead} position={fl.head} quaternion={fl.quat} scale={f.scale}>
                <mesh geometry={fl.base} material={stalkMat} castShadow />
                {fl.receptacle ? <mesh geometry={fl.receptacle} material={recMat} position-y={-0.002} castShadow /> : null}
                {fl.stamen ? <instancedMesh ref={stamenRef} args={[fl.stamen, stamMat, fl.stamenMatrices.length]} castShadow /> : null}
                {live ? <instancedMesh ref={setAphids} args={[aphidGeometry, aphidMaterial, APHIDS.length]} frustumCulled={false} /> : null}
                {petalSlots.map((s, i) => {
                  const w = WHORLS[s.whorl];
                  // the bud's innermost whorl is never seen; a fallen petal has left the head
                  const hidden = (f.kind === "bud" && s.whorl === 2) || i < f.fallen;
                  if (hidden) return null;
                  return (
                    <group key={`p${i}`} rotation-y={s.yaw}>
                      <group
                        ref={(g) => {
                          R.petals[i] = { group: g, mesh: R.petals[i]?.mesh ?? null, whorl: s.whorl, index: s.index, phase: s.jitter };
                        }}
                        position={[0, w.y, w.radius]}
                        rotation-x={petalAngle(w, f.open, f.morph, f.relax, f.kind === "bud") + s.jitter}
                      >
                        <mesh
                          ref={(m) => {
                            // (a child's ref comes before its group's: the slot is made here if need be, and kept there)
                            R.petals[i] = { ...(R.petals[i] ?? { group: null, whorl: s.whorl, index: s.index, phase: s.jitter }), mesh: m };
                            if (m) {
                              m.updateMorphTargets();
                              if (m.morphTargetInfluences) m.morphTargetInfluences[0] = f.morph;
                            }
                          }}
                          geometry={fl.petals[s.whorl][s.variant]}
                          material={flowerMat}
                          frustumCulled={false}
                          castShadow
                          receiveShadow
                        />
                      </group>
                    </group>
                  );
                })}
                {tepal
                  ? [0, 1, 2, 3].map((k) => (
                      <group key={`t${k}`} rotation-y={(k / 4) * Math.PI * 2 + 0.4}>
                        <group position={[0, -0.011, 0.031]} rotation-x={f.tepals === 0 ? -0.1 : 1.75}>
                          <mesh geometry={tepal} material={tepalMaterial()} castShadow />
                        </group>
                      </group>
                    ))
                  : null}
              </group>
            </group>
          </group>
        ) : null}
        {built.fallen
          ? look.fallen.map((p, i) => (
              <group key={`d${i}`} position={[p.x, p.y, p.z]} rotation-y={p.yaw}>
                <mesh
                  geometry={built.fallen!}
                  material={fallenMat}
                  position-z={-0.05}
                  rotation-x={Math.PI / 2 - 0.12}
                  ref={(m) => {
                    if (m) {
                      m.updateMorphTargets();
                      if (m.morphTargetInfluences) m.morphTargetInfluences[0] = 1;
                    }
                  }}
                  receiveShadow
                />
              </group>
            ))
          : null}
      </group>
      {glowLight ? <pointLight ref={setGlow} userData={OPTIONAL_LIGHT} color={GLOW_COLOR} intensity={0} distance={1.8} decay={2} /> : null}
    </group>
  );
}
