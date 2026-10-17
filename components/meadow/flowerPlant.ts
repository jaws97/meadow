// The garden's procedural flower, built for the Meadow: the owner's rose on the dais and the full plant drawn in a
// plot while someone visits it. It is the same plant as the personal garden's hero (components/garden/Plant.tsx):
// the same blueprint from the seed and species (lib/plant/blueprint) re-dressed with the hero's leaves and sturdier
// cane, the same geometry builders (lib/plant/geometry), the same growth staging (garden/heroGrowth) and the same
// cached materials (components/garden/materials). What differs is how it is held: Plant.tsx reads the one global
// garden store and poses dozens of meshes every frame, which suits a scene with one plant. Here a plant is posed
// once from its own numbers and every part is baked into one mesh per material (about fifteen draw calls for a rose
// in full bloom instead of about two hundred), and the whole plant sways as one in the breeze.
//
// The pose follows Plant.tsx's frame pass with the wind still: segment growth and girth, leaves unfurling as the
// cane reaches them, the bud swelling, petals opening (each petal's open shape baked from its morph target), the
// droop of a thirsty or poorly plant, a flower that opens smaller after stress, and leaves yellowing from the
// bottom.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
import {
  heroBudGrowth,
  heroLeafUnfurl,
  heroLeaves,
  heroSegmentGrowth,
  heroSepalPart,
  heroStemFraction,
  heroStemGirth,
} from "@/components/garden/garden/heroGrowth";
import type { Quality } from "@/lib/garden/store";
import { buildBlueprint, VARIANTS, type Blueprint } from "@/lib/plant/blueprint";
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
import { droopOf, fadeOf, leafDropped, leafHealth, petalOpen, quantize } from "@/lib/plant/growth";
import { lerp, Rng, smoothstep } from "@/lib/plant/prng";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

/** What a plant looks like right now: its seed and species, and the model's numbers (lib/sim Visual). */
export interface PlantLook {
  speciesId: SpeciesId;
  seed: string;
  growth: number;
  bloom: number;
  health: number;
  moisture: number;
  scorch: number;
  /** the model's own droop; derived from moisture and health when left out */
  droop?: number;
  /** the flower against a full one (smaller after stress while budding, 0.7 for a second chance) */
  flower?: number;
  /** leaf yellowing 0..1, the lower leaves first */
  chlorosis?: number;
}

export interface BuiltPlant {
  group: THREE.Group;
  /** the flower head's position in the plant's own frame, and the plant's height */
  head: THREE.Vector3;
  height: number;
  /** the petal and bud materials, whose glow the caller drives with the night */
  petalMats: THREE.MeshPhysicalMaterial[];
  budMat: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

const PETAL_TESS: Record<Quality, [number, number]> = { cinematic: [16, 28], balanced: [12, 22], lite: [8, 14] };
/** Radians a sideways leaf turns about its rachis toward the viewer (as in Plant.tsx). */
const LEAF_FACING = 0.5;

/** The hero's blueprint for a seed: a fuller run of leaves up the cane and a cane a touch sturdier under its bloom. */
function heroBlueprint(seed: string, id: SpeciesId): Blueprint {
  const sp = SPECIES[id];
  const base = buildBlueprint(seed, sp);
  const stem = base.stem.map((s) => ({ ...s, r0: s.r0 * 1.08, r1: s.r1 * 1.16 }));
  return { ...base, stem, leaves: heroLeaves(seed, sp, stem.length) };
}

/** Bakes a petal's morph (the open bloom is morph target 0) into its positions and normals at `influence`. */
function bakeMorph(geo: THREE.BufferGeometry, influence: number): THREE.BufferGeometry {
  const g = geo.clone();
  const open = geo.morphAttributes.position?.[0];
  const openN = geo.morphAttributes.normal?.[0];
  g.morphAttributes = {};
  if (open && influence > 0) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(
        i,
        p.getX(i) + (open.getX(i) - p.getX(i)) * influence,
        p.getY(i) + (open.getY(i) - p.getY(i)) * influence,
        p.getZ(i) + (open.getZ(i) - p.getZ(i)) * influence,
      );
    }
    const n = g.attributes.normal as THREE.BufferAttribute | undefined;
    if (n && openN) {
      const v = new THREE.Vector3();
      for (let i = 0; i < n.count; i++) {
        v.set(
          n.getX(i) + (openN.getX(i) - n.getX(i)) * influence,
          n.getY(i) + (openN.getY(i) - n.getY(i)) * influence,
          n.getZ(i) + (openN.getZ(i) - n.getZ(i)) * influence,
        ).normalize();
        n.setXYZ(i, v.x, v.y, v.z);
      }
    }
  }
  return g;
}

/** A geometry reduced to position, normal and uv, non-indexed, so parts built different ways can merge. */
function mergeable(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}

/**
 * Poses the plant for `look` and bakes it. `quality` picks the petal tessellation and the material variants (the
 * Meadow passes "lite" leaves everywhere, so no leaf ever asks for a transmission pass).
 */
export function buildFlowerPlant(look: PlantLook, quality: { petals: Quality; leaves: Quality }): BuiltPlant {
  const sp = SPECIES[look.speciesId];
  const bp = heroBlueprint(look.seed, look.speciesId);
  const f = sp.flower;
  const c = f.center;
  const L = f.layers.length;
  const n = bp.stem.length;
  const g = look.growth;
  const base = { growth: g, bloom: look.bloom, health: look.health, moisture: look.moisture, scorch: look.scorch };
  const droop = look.droop ?? droopOf(base);
  const flowerSize = look.flower ?? 1;
  const chlorosis = look.chlorosis ?? 0;

  // ---- geometry, as Plant.tsx builds it ----
  const [nu, nv] = PETAL_TESS[quality.petals];
  const own: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(x: T) => {
    own.push(x);
    return x;
  };
  const stemGeo = bp.stem.map((seg) => keep(makeStemGeometry(seg.length, seg.r0, seg.r1, seg.dx, seg.dz)));
  const petalGeo = f.layers.map((layer, l) => Array.from({ length: VARIANTS }, (_, v) => keep(makePetalGeometry(layer, l * 10 + v + 1, nu, nv))));
  const { length, width, serration, fold } = sp.leaves;
  const leafGeo = Array.from({ length: VARIANTS }, (_, v) => keep(makeLeafGeometry({ length, width, serration, fold }, v + 1)));
  const sepalGeo = f.sepals.count > 0 ? keep(makeSepalGeometry(f.sepals.length, f.sepals.width, 99)) : null;
  const receptacle = keep(makeReceptacleGeometry(c.radius * 1.25, c.radius * 2.1, 3));
  const rachisLength = sp.leaves.petiole ?? sp.leaves.length * 0.32;
  const rachis = keep(makeStemGeometry(rachisLength, sp.stem.radius * 0.22, sp.stem.radius * 0.12, 0, rachisLength * 0.22, 6, 6));
  const thornGeo = sp.stem.thorns ? keep(makeThornGeometry()) : null;
  const ends = bp.stem.map((seg) => stemEndTransform(seg.length, seg.dx, seg.dz));

  // ---- the pose: a scene graph shaped like Plant.tsx's, posed once ----
  const root = new THREE.Group();
  const parts: Array<{ mesh: THREE.Mesh; morph: number }> = [];
  const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, morph = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    parts.push({ mesh, morph });
    return mesh;
  };
  const axis = new THREE.Vector3(Math.sin(bp.leanDir), 0, -Math.cos(bp.leanDir));
  const qTilt = new THREE.Quaternion();

  const leafMats = new Map<string, THREE.Material>();
  const leafMat = (order: number) => {
    let fade = fadeOf(leafHealth(base, order));
    // yellowing from the bottom up
    fade = Math.max(fade, chlorosis * (1 - 0.6 * order));
    const fb = quantize(fade, 4);
    const bb = quantize(look.scorch * (0.5 + 0.5 * order), 3);
    const key = `${fb}|${bb}`;
    let m = leafMats.get(key);
    if (!m) {
      m = leafMaterial(sp, fb, bb, quality.leaves);
      leafMats.set(key, m);
    }
    return m;
  };
  const petalFade = quantize(fadeOf(look.health) * 0.85, 4);
  const petalBurn = quantize(look.scorch, 3);
  const petalMats = Array.from({ length: VARIANTS }, (_, v) => petalMaterial(sp, petalFade, petalBurn, quality.petals, v));
  const budMat = budMaterial(sp);

  let parent: THREE.Object3D = root;
  let headGroup: THREE.Group | null = null;
  for (let i = 0; i < n; i++) {
    const seg = bp.stem[i];
    const gi = heroSegmentGrowth(g, i, n);
    const sx = heroStemGirth(g, gi);
    const segGroup = new THREE.Group();
    const tilt = droop * (0.12 + 0.22 * i) * (0.5 + 0.5 * gi);
    segGroup.quaternion.copy(qTilt.setFromAxisAngle(axis, tilt));
    parent.add(segGroup);
    if (gi > 0.001) {
      const tube = part(segGroup, stemGeo[i], stemMaterial(sp, i, n));
      tube.scale.set(sx, Math.max(gi, 0.001), sx);
    }
    // leaves on this segment
    bp.leaves.forEach((leaf) => {
      if (leaf.seg !== i) return;
      const lh = leafHealth(base, leaf.order);
      const unf = leafDropped(leaf.order, lh) ? 0 : heroLeafUnfurl(leaf, n, g);
      if (unf <= 0.001) return;
      const at = stemPointAt(seg.length, seg.dx, seg.dz, leaf.t);
      const outer = new THREE.Group();
      outer.position.set(at.position.x * sx, at.position.y * gi, at.position.z * sx);
      outer.quaternion.copy(at.quaternion);
      outer.scale.setScalar(Math.max(0.0001, unf * leaf.size));
      segGroup.add(outer);
      const yawG = new THREE.Group();
      yawG.rotation.y = leaf.yaw;
      outer.add(yawG);
      const pitch = new THREE.Group();
      pitch.rotation.set(leaf.pitch + droop * 0.85, LEAF_FACING * Math.sin(leaf.yaw), leaf.roll);
      yawG.add(pitch);
      part(pitch, rachis, petioleMaterial(sp));
      const dz = rachisLength * 0.22;
      const place = (t: number, side: number, dr: number, scale: number) => {
        const p = stemPointAt(rachisLength, 0, dz, t);
        return { position: p.position, quaternion: p.quaternion, side, droop: dr, scale };
      };
      const leaflets = [place(1, 0, 0.3, 1)];
      if (leaf.leaflets >= 3) {
        const t = leaf.leaflets >= 5 ? 0.68 : 0.56;
        leaflets.push(place(t, 0.78, 0.28, 0.82), place(t, -0.78, 0.28, 0.82));
      }
      if (leaf.leaflets >= 5) leaflets.push(place(0.38, 0.82, 0.25, 0.68), place(0.38, -0.82, 0.25, 0.68));
      const mat = leafMat(leaf.order);
      leaflets.forEach((b, k) => {
        const a = new THREE.Group();
        a.position.copy(b.position);
        a.quaternion.copy(b.quaternion);
        pitch.add(a);
        const s = new THREE.Group();
        s.rotation.z = b.side;
        a.add(s);
        const d = new THREE.Group();
        d.rotation.x = b.droop;
        s.add(d);
        const blade = part(d, leafGeo[(leaf.variant + k) % VARIANTS], mat);
        blade.rotation.y = Math.PI;
        blade.scale.setScalar(b.scale);
      });
    });
    // thorns ride their segment the same way
    if (thornGeo) {
      bp.thorns.forEach((th) => {
        if (th.seg !== i || gi <= 0.05) return;
        const at = stemPointAt(seg.length, seg.dx, seg.dz, th.t);
        const r = lerp(seg.r0, seg.r1, th.t);
        const gT = new THREE.Group();
        gT.position.set(at.position.x * sx, at.position.y * gi, at.position.z * sx);
        gT.quaternion.copy(at.quaternion);
        gT.scale.setScalar(Math.max(0.0001, gi * sx));
        segGroup.add(gT);
        const yawG = new THREE.Group();
        yawG.rotation.y = th.yaw;
        gT.add(yawG);
        const out = new THREE.Group();
        out.position.set(0, 0, r * 0.75);
        out.rotation.x = Math.PI / 2 + th.droop;
        yawG.add(out);
        const mesh = part(out, thornGeo, thornMaterial(sp));
        mesh.scale.set(th.size * 0.55, th.size, th.size * 1.05);
      });
    }
    // the mount for the next segment, or the flower head
    const mount = new THREE.Group();
    const ep = ends[i].position;
    const lean = sx * smoothstep(0, 0.15, gi);
    mount.position.set(ep.x * lean, ep.y * gi, ep.z * lean);
    mount.quaternion.copy(ends[i].quaternion);
    segGroup.add(mount);
    parent = mount;
    if (i === n - 1) {
      headGroup = new THREE.Group();
      mount.add(headGroup);
    }
  }

  // ---- the flower head ----
  const head = headGroup!;
  const bud = heroBudGrowth(g);
  const eb = look.bloom * smoothstep(0.8, 0.92, g);
  const petalsShown = bud > 0.04;
  const headShown = heroStemFraction(g) > 0.005;
  head.rotation.set(bp.headTilt + droop * 0.9, bp.flowerYaw, 0);
  head.scale.setScalar((0.3 + 0.7 * bud) * (0.6 + 0.4 * flowerSize));
  if (headShown) {
    part(head, receptacle, sepalMaterial(sp)).position.y = -c.radius * 2.0;
    if (petalsShown && eb < 0.9) {
      const core = part(head, sphereGeometry(), budMat);
      core.scale.setScalar(Math.max(0.0001, f.budRadius * (1 - eb) * (0.6 + 0.4 * bud)));
      core.position.y = f.budRadius * 0.6;
    }
    if (sepalGeo) {
      const sepalRot = 0.06 + 0.32 * heroSepalPart(bud) + 1.4 * smoothstep(0, 0.6, eb) + droop * 0.2;
      const sepalScale = 0.75 + 0.25 * bud;
      for (let k = 0; k < f.sepals.count; k++) {
        const around = new THREE.Group();
        around.rotation.y = (k / f.sepals.count) * 2 * Math.PI + 0.3;
        head.add(around);
        const sg = new THREE.Group();
        sg.position.set(0, -c.radius * 0.25, c.radius * 0.95);
        sg.rotation.x = sepalRot;
        sg.scale.setScalar(sepalScale);
        around.add(sg);
        part(sg, sepalGeo, sepalMaterial(sp));
      }
    }
    if (petalsShown) {
      const layerDen = Math.max(1, L - 1);
      bp.petals.forEach((p) => {
        const o = petalOpen(eb, p.stagger);
        const around = new THREE.Group();
        around.rotation.y = p.yaw;
        head.add(around);
        const pg = new THREE.Group();
        pg.position.set(0, (L - 1 - p.layer) * 0.006, c.radius * 0.35 + p.layer * 0.0055);
        pg.rotation.set(o * p.openTarget - (1 - o) * 0.18 + droop * 0.3 * (p.layer / layerDen), 0, f.layers[p.layer].lean ?? 0);
        pg.scale.setScalar(lerp(0.55, 1, o) * p.scale);
        around.add(pg);
        const mesh = part(pg, petalGeo[p.layer][p.variant], petalMats[p.variant], smoothstep(0.05, 0.95, o));
        mesh.scale.setScalar(p.scale);
      });
    }
    if (eb > 0.6 && c.stamens > 0) {
      const st = new THREE.Group();
      st.scale.setScalar(Math.max(0.001, eb));
      head.add(st);
      const rng = new Rng(bp.seed + "|stamens");
      for (let k = 0; k < c.stamens; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(0.15, 0.9) * c.radius;
        const h = rng.range(0.6, 1.3) * c.radius;
        const headSize = rng.range(0.12, 0.2) * c.radius;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const filament = part(st, petioleGeometry(), stamenMaterial(sp));
        filament.position.set(x, 0, z);
        filament.scale.set(0.6, h, 0.6);
        const anther = part(st, sphereGeometry(), stamenMaterial(sp));
        anther.position.set(x, h, z);
        anther.scale.setScalar(headSize);
      }
    }
  }

  // ---- bake: every part into the plant's frame, one merged mesh per material ----
  root.updateMatrixWorld(true);
  const headPos = new THREE.Vector3();
  head.getWorldPosition(headPos);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const { mesh, morph } of parts) {
    const geo = mergeable(morph > 0 ? bakeMorph(mesh.geometry, morph) : mesh.geometry);
    geo.applyMatrix4(mesh.matrixWorld);
    const list = byMat.get(mesh.material as THREE.Material);
    if (list) list.push(geo);
    else byMat.set(mesh.material as THREE.Material, [geo]);
  }
  for (const geo of own) geo.dispose();

  const group = new THREE.Group();
  const merged: THREE.BufferGeometry[] = [];
  const box = new THREE.Box3();
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
    merged.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    head: headPos,
    height: box.isEmpty() ? 0 : box.max.y,
    petalMats,
    budMat,
    dispose() {
      // the materials are the garden's shared cache and are never disposed
      for (const geo of merged) geo.dispose();
    },
  };
}

/**
 * Gives a built plant's materials the Meadow's environment map at this hour's strength (the garden's own
 * envMapIntensity per material, scaled). Cheap to call every frame: a material is only recompiled when its map
 * first arrives.
 */
export function applyPlantEnv(plant: BuiltPlant, env: THREE.Texture | null, strength: number): void {
  for (const child of plant.group.children) {
    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!mat || !("envMapIntensity" in mat)) continue;
    if (mat.userData.baseEnv === undefined) mat.userData.baseEnv = mat.envMapIntensity;
    if (mat.envMap !== env) {
      mat.envMap = env;
      mat.needsUpdate = true;
    }
    mat.envMapIntensity = (mat.userData.baseEnv as number) * strength;
  }
}

/** The petals' own light at this hour, as Plant.tsx sets it (without the garden's tone-mapping lift). */
export function petalGlow(speciesId: SpeciesId, night: number, health: number, bloom: number, time: number): number {
  const f = SPECIES[speciesId].flower;
  const pulse = SPECIES[speciesId].fx.pulse ? 0.75 + 0.25 * Math.sin(time * 1.4) : 1;
  return lerp(f.emissiveDay, f.emissiveNight, night) * (0.3 + 0.7 * health) * (0.2 + 0.8 * bloom) * pulse;
}
