// The garden's procedural flower, posed once from its own numbers: the pose both the full plant (flowerPlant.ts, the
// rose on the dais and a visited plant) and the Meadow's lighter detail levels (bake.ts) are built from, so a plant
// seen across the rings is the same plant as the one drawn in full beside the cart.
//
// It is the personal garden hero's pose (components/garden/Plant.tsx) with the wind still: the hero's blueprint for the
// seed (lib/plant/blueprint) with its fuller run of leaves and sturdier cane, segment growth and girth, leaves
// unfurling as the cane reaches them, the bud swelling, petals opening (each petal's open shape baked from its morph
// target by the caller), the droop of a thirsty or poorly plant, a flower that opens smaller after stress, and a lily's
// flowers on their stalks up the top of its stem with the bud at its tip (lib/plant/raceme). What is
// left to the caller: the tessellation (`PoseDetail`) and what each part is made of (`PartMaterials`), so the full
// plant hangs the garden's cached materials on its parts while a detail level tags them for vertex colours.
//
// Pure: three.js maths and the plant library, no DOM, so the atlas script (scripts/bake-meadow-plants.mjs) runs it too.
import * as THREE from "three";
import { heroBudGrowth, heroLeafUnfurl, heroLeaves, heroSegmentGrowth, heroSepalPart, heroStemFraction, heroStemGirth } from "@/components/garden/garden/heroGrowth";
import { buildBlueprint, VARIANTS, type Blueprint } from "@/lib/plant/blueprint";
import {
  makeLeafGeometry,
  makePetalGeometry,
  makeSepalGeometry,
  makeStemGeometry,
  makeThornGeometry,
  receptacleShape,
  stemEndTransform,
  stemPointAt,
} from "@/lib/plant/geometry";
import { droopOf, leafDropped, leafHealth, petalOpen } from "@/lib/plant/growth";
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
import { SPECIES, type PetalLayer, type SpeciesId } from "@/lib/plant/species";

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
  /**
   * Hours since the flower opened, for a lily's later flowers (lib/plant/raceme racemeOpen): null while it has not;
   * left out, every flower is drawn open (the Meadow's pictures, the rose on the dais).
   */
  opened?: number | null;
}

/** How finely each part is built. */
export interface PoseDetail {
  /** a petal's grid [across, along] for whorl `l` (0 innermost) */
  petal(layer: PetalLayer, l: number): [number, number];
  leaf: [number, number];
  sepal: [number, number];
  /** a stem segment's tube [along, around] */
  stem: [number, number];
  /** a lily flower's stalk [along, around] */
  pedicel: [number, number];
  rachis: [number, number];
  /** a thorn's [around, along], or null to leave the thorns off */
  thorn: [number, number] | null;
  /** the receptacle the petals grow from, built for this plant (disposed with the pose) */
  receptacle(radius: number, height: number): THREE.BufferGeometry;
  /** a unit sphere for the bud's core and the anthers (shared: never disposed here) */
  sphere: THREE.BufferGeometry;
  /** a unit-length filament for the stamens along +y (shared), or null for the anthers alone */
  filament: THREE.BufferGeometry | null;
  /**
   * the most stamens drawn, shared among the open flowers (a lily's three); past it a share are drawn, a little larger,
   * so the eye stays as full
   */
  stamens: number;
  /** the most leaflets on a compound leaf (1, 3 or 5) */
  leaflets: number;
}

/** What each part is made of: the full plant answers with materials, a detail level with tags. */
export interface PartMaterials<M> {
  stem(i: number, n: number): M;
  /** a leaf at `order` (0 lowest .. 1 highest) up the cane */
  leaf(order: number): M;
  petiole(): M;
  thorn(): M;
  /** the sepals and the receptacle */
  sepal(): M;
  bud(): M;
  petal(variant: number): M;
  stamen(): M;
  /** a lily's pale filaments and style, and its stigma (lib/plant/stamens); the stamens' own when left out */
  filament?(): M;
  stigma?(): M;
}

export interface PosedPart<M> {
  /** the part's own geometry, in its own frame (shared between parts: never modify it) */
  geometry: THREE.BufferGeometry;
  /** where the part sits in the plant's frame */
  matrix: THREE.Matrix4;
  /** how far a petal has unfurled: its open morph target's influence, 0 for everything else */
  morph: number;
  material: M;
}

export interface PosedPlant<M> {
  parts: PosedPart<M>[];
  /** the flower head's position in the plant's frame: a lily's lead flower, or its growing tip before that flower's bud shows */
  head: THREE.Vector3;
  /** geometries the pose built for this plant alone: dispose them once the parts are baked */
  own: THREE.BufferGeometry[];
}

/** Radians a sideways leaf turns about its rachis toward the viewer (as in Plant.tsx). */
const LEAF_FACING = 0.5;

/** The hero's blueprint for a seed: a fuller run of leaves up the cane and a cane a touch sturdier under its bloom. */
function heroBlueprint(seed: string, id: SpeciesId): Blueprint {
  const sp = SPECIES[id];
  const base = buildBlueprint(seed, sp);
  const stem = base.stem.map((s) => ({ ...s, r0: s.r0 * 1.08, r1: s.r1 * 1.16 }));
  return { ...base, stem, leaves: heroLeaves(seed, sp, stem.length) };
}

/** Poses the plant for `look`: every part with its place in the plant's frame, built as finely as `detail` asks. */
export function posePlant<M>(look: PlantLook, detail: PoseDetail, mats: PartMaterials<M>): PosedPlant<M> {
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
  // a lily's flowers up the top of its stem and its tip bud (none for a flower that grows alone), every one open unless
  // the look says how long ago the first opened
  const raceme = racemeNodes(look.seed, sp, n);
  const opened = look.opened === undefined ? Infinity : look.opened;

  // ---- geometry, as Plant.tsx builds it ----
  const own: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(x: T) => {
    own.push(x);
    return x;
  };
  const stemGeo = bp.stem.map((seg) => keep(makeStemGeometry(seg.length, seg.r0, seg.r1, seg.dx, seg.dz, detail.stem[0], detail.stem[1])));
  const petalGeo = f.layers.map((layer, l) => {
    const [nu, nv] = detail.petal(layer, l);
    return Array.from({ length: VARIANTS }, (_, v) => keep(makePetalGeometry(layer, l * 10 + v + 1, nu, nv)));
  });
  const { length, width, serration, fold } = sp.leaves;
  const leafGeo = Array.from({ length: VARIANTS }, (_, v) => keep(makeLeafGeometry({ length, width, serration, fold }, v + 1, detail.leaf[0], detail.leaf[1])));
  const sepalGeo = f.sepals.count > 0 ? keep(makeSepalGeometry(f.sepals.length, f.sepals.width, 99, detail.sepal[0], detail.sepal[1])) : null;
  // the receptacle (or a jasmine's tube) and where it and the sepals sit
  const cup = receptacleShape(f);
  const receptacle = keep(detail.receptacle(cup.radius, cup.height));
  const rachisLength = sp.leaves.petiole ?? sp.leaves.length * 0.32;
  const rachis = keep(makeStemGeometry(rachisLength, sp.stem.radius * 0.22, sp.stem.radius * 0.12, 0, rachisLength * 0.22, detail.rachis[0], detail.rachis[1]));
  const thornGeo = sp.stem.thorns && detail.thorn ? keep(makeThornGeometry(detail.thorn[0], detail.thorn[1])) : null;
  const ends = bp.stem.map((seg) => stemEndTransform(seg.length, seg.dx, seg.dz));
  const pedicelGeo = raceme.map((node) => {
    if (node.tipBud) return null;
    const ps = pedicelShape(node, sp);
    return { geometry: keep(makeStemGeometry(ps.length, ps.r0, ps.r1, 0, ps.dz, detail.pedicel[0], detail.pedicel[1])), end: stemEndTransform(ps.length, 0, ps.dz) };
  });

  // ---- the pose: a scene graph shaped like Plant.tsx's, posed once ----
  const root = new THREE.Group();
  const nodes: Array<{ node: THREE.Object3D; geometry: THREE.BufferGeometry; morph: number; material: M }> = [];
  const part = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: M, morph = 0) => {
    const node = new THREE.Object3D();
    parent.add(node);
    nodes.push({ node, geometry, morph, material });
    return node;
  };
  const axis = new THREE.Vector3(Math.sin(bp.leanDir), 0, -Math.cos(bp.leanDir));
  const qTilt = new THREE.Quaternion();
  const leaflets = Math.max(1, detail.leaflets);

  const headShown = heroStemFraction(g) > 0.005;
  // the heads, the lead first (as Plant.tsx's refs): the one flower, or a lily's flowers on their stalks and its tip bud
  const heads: THREE.Group[] = [];
  const tipIndex = Math.max(0, raceme.length - 1);

  let parent: THREE.Object3D = root;
  for (let i = 0; i < n; i++) {
    const seg = bp.stem[i];
    const gi = heroSegmentGrowth(g, i, n);
    const sx = heroStemGirth(g, gi);
    const segGroup = new THREE.Group();
    const tilt = droop * (0.12 + 0.22 * i) * (0.5 + 0.5 * gi);
    segGroup.quaternion.copy(qTilt.setFromAxisAngle(axis, tilt));
    parent.add(segGroup);
    if (gi > 0.001) {
      const tube = part(segGroup, stemGeo[i], mats.stem(i, n));
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
      part(pitch, rachis, mats.petiole());
      const dz = rachisLength * 0.22;
      const place = (t: number, side: number, dr: number, scale: number) => {
        const p = stemPointAt(rachisLength, 0, dz, t);
        return { position: p.position, quaternion: p.quaternion, side, droop: dr, scale };
      };
      const count = Math.min(leaf.leaflets, leaflets);
      const blades = [place(1, 0, 0.3, 1)];
      if (count >= 3) {
        const t = count >= 5 ? 0.68 : 0.56;
        blades.push(place(t, 0.78, 0.28, 0.82), place(t, -0.78, 0.28, 0.82));
      }
      if (count >= 5) blades.push(place(0.38, 0.82, 0.25, 0.68), place(0.38, -0.82, 0.25, 0.68));
      const mat = mats.leaf(leaf.order);
      blades.forEach((b, k) => {
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
        part(out, thornGeo, mats.thorn()).scale.set(th.size * 0.55, th.size, th.size * 1.05);
      });
    }
    // a lily's flowers on their stalks, placed as its leaves are, grown out with their buds and spread as they open
    raceme.forEach((node, k) => {
      const pg = pedicelGeo[k];
      if (node.seg !== i || !pg) return;
      const open = look.bloom * smoothstep(0.8, 0.92, g) * racemeOpen(node, opened);
      const grow = racemeStalkGrowth(racemeBudGrowth(heroBudGrowth, g, node), open);
      const at = stemPointAt(seg.length, seg.dx, seg.dz, node.t);
      const outer = new THREE.Group();
      outer.position.set(at.position.x * sx, at.position.y * gi, at.position.z * sx);
      outer.quaternion.copy(at.quaternion);
      segGroup.add(outer);
      const yawG = new THREE.Group();
      yawG.rotation.y = node.yaw;
      outer.add(yawG);
      const lean = new THREE.Group();
      lean.rotation.x = racemeStalkLean(node, open) + droop * 0.5;
      yawG.add(lean);
      if (headShown && grow > 0) part(lean, pg.geometry, mats.stem(n - 1, n)).scale.setScalar(grow);
      const end = new THREE.Group();
      end.position.copy(pg.end.position).multiplyScalar(grow);
      end.quaternion.copy(pg.end.quaternion);
      lean.add(end);
      heads[k] = new THREE.Group();
      end.add(heads[k]);
    });
    // the mount for the next segment, or the flower head
    const mount = new THREE.Group();
    const ep = ends[i].position;
    const lean = sx * smoothstep(0, 0.15, gi);
    mount.position.set(ep.x * lean, ep.y * gi, ep.z * lean);
    mount.quaternion.copy(ends[i].quaternion);
    segGroup.add(mount);
    parent = mount;
    if (i === n - 1) {
      heads[tipIndex] = new THREE.Group();
      if (raceme.length > 0) {
        // a lily's tip bud, turned to the way it leans
        const lean = new THREE.Group();
        lean.rotation.y = raceme[tipIndex].yaw;
        mount.add(lean);
        lean.add(heads[tipIndex]);
      } else mount.add(heads[tipIndex]);
    }
  }

  // ---- the flower heads ----
  // the stamens' share each flower may draw (the most for a plant, among a lily's three flowers)
  const stamenCap = Math.max(1, detail.stamens / Math.max(1, raceme.filter((x) => !x.closed).length));
  const leadBud = heroBudGrowth(g);
  const leadEb = look.bloom * smoothstep(0.8, 0.92, g);
  // the head the garden follows: the lead, once its bud shows on its stalk; the growing tip before
  let followed = heads[0];
  /** Dresses one head: the one flower (`node` null), or a lily's flower or tip bud on its own bud and clock. */
  const dressHead = (head: THREE.Group, node: RacemeNode | null) => {
    const bud = node ? racemeBudGrowth(heroBudGrowth, g, node) : leadBud;
    const eb = node ? leadEb * racemeOpen(node, opened) : leadEb;
    const petalsShown = bud > BUD_SHOWN;
    const shown = headShown && (!node || node.tipBud || petalsShown);
    if (node?.order === 0 && !shown) followed = heads[tipIndex];
    head.rotation.set((node ? node.tilt : bp.headTilt) + droop * 0.9, node ? node.spin : bp.flowerYaw, 0);
    head.scale.setScalar((node ? racemeHeadScale(node, bud) : 0.3 + 0.7 * bud) * (0.6 + 0.4 * flowerSize));
    if (shown) {
      part(head, receptacle, mats.sepal()).position.y = cup.y;
      if (petalsShown && eb < 0.9) {
        const core = part(head, detail.sphere, mats.bud());
        const br = Math.max(0.0001, f.budRadius * (1 - eb) * (0.6 + 0.4 * bud));
        core.scale.set(br, br * (f.budAspect ?? 1), br);
        core.position.y = f.budRadius * 0.6 * (f.budAspect ?? 1);
      }
      if (sepalGeo) {
        const sepalRot = 0.06 + 0.32 * heroSepalPart(bud) + 1.4 * smoothstep(0, 0.6, eb) + droop * 0.2;
        const sepalScale = 0.75 + 0.25 * bud;
        for (let k = 0; k < f.sepals.count; k++) {
          const around = new THREE.Group();
          around.rotation.y = (k / f.sepals.count) * 2 * Math.PI + 0.3;
          head.add(around);
          const sg = new THREE.Group();
          sg.position.set(0, cup.sepalY, cup.sepalR);
          sg.rotation.x = sepalRot;
          sg.scale.setScalar(sepalScale);
          around.add(sg);
          part(sg, sepalGeo, mats.sepal());
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
          pg.rotation.set(o * p.openTarget - (1 - o) * (f.budClose ?? 0.18) + droop * 0.3 * (p.layer / layerDen), 0, f.layers[p.layer].lean ?? 0);
          pg.scale.setScalar(lerp(f.budLength ?? 0.55, 1, o) * p.scale);
          around.add(pg);
          part(pg, petalGeo[p.layer][p.variant], mats.petal(p.variant), smoothstep(0.05, 0.95, o)).scale.setScalar(p.scale);
        });
      }
      if (eb > 0.6 && c.long) {
        // a lily's long stamens round its style, as Plant.tsx draws them; the anthers alone where filaments are left off,
        // and past the cap every k-th, a little larger (the style always)
        const st = new THREE.Group();
        st.scale.setScalar(Math.max(0.001, eb));
        head.add(st);
        const every = Math.max(1, Math.ceil(c.stamens / stamenCap));
        const grow = Math.sqrt(every);
        for (const [k, s] of longStamens(bp.seed, c).entries()) {
          if (!s.style && k % every !== 0) continue;
          const around = new THREE.Group();
          around.rotation.y = s.yaw;
          st.add(around);
          const lean = new THREE.Group();
          lean.position.z = s.foot;
          lean.rotation.x = s.lean;
          around.add(lean);
          if (detail.filament) {
            const girth = s.style ? STYLE_GIRTH : FILAMENT_GIRTH;
            part(lean, detail.filament, mats.filament?.() ?? mats.stamen()).scale.set(girth, s.length, girth);
          }
          const [ax, ay, az] = s.style ? STIGMA : ANTHER;
          const size = s.style ? s.length : s.length * grow;
          const tip = part(lean, detail.sphere, s.style ? (mats.stigma?.() ?? mats.stamen()) : mats.stamen());
          tip.position.y = s.length;
          tip.scale.set(ax * size, ay * size, az * size);
        }
      } else if (eb > 0.6 && c.stamens > 0) {
        const st = new THREE.Group();
        st.scale.setScalar(Math.max(0.001, eb));
        head.add(st);
        const rng = new Rng(bp.seed + "|stamens");
        // past the cap every k-th stamen is drawn, a little larger, from the same draws as the full plant's
        const every = Math.max(1, Math.ceil(c.stamens / stamenCap));
        const grow = Math.sqrt(every);
        for (let k = 0; k < c.stamens; k++) {
          const a = rng.range(0, Math.PI * 2);
          const r = rng.range(0.15, 0.9) * c.radius;
          const h = rng.range(0.6, 1.3) * c.radius;
          const headSize = rng.range(0.12, 0.2) * c.radius;
          if (k % every !== 0) continue;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (detail.filament) {
            const filament = part(st, detail.filament, mats.stamen());
            filament.position.set(x, 0, z);
            filament.scale.set(0.6, h, 0.6);
          }
          const anther = part(st, detail.sphere, mats.stamen());
          anther.position.set(x, h, z);
          anther.scale.setScalar(headSize * grow);
        }
      }
    }
  };
  heads.forEach((head, k) => dressHead(head, raceme[k] ?? null));

  root.updateMatrixWorld(true);
  const headPos = new THREE.Vector3();
  followed.getWorldPosition(headPos);
  return {
    parts: nodes.map(({ node, geometry, morph, material }) => ({ geometry, matrix: node.matrixWorld.clone(), morph, material })),
    head: headPos,
    own,
  };
}

/** Bakes a petal's morph (the open bloom is morph target 0) into its positions and normals at `influence`. */
export function bakeMorph(geo: THREE.BufferGeometry, influence: number): THREE.BufferGeometry {
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
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    if (nrm && openN) {
      const v = new THREE.Vector3();
      for (let i = 0; i < nrm.count; i++) {
        v.set(
          nrm.getX(i) + (openN.getX(i) - nrm.getX(i)) * influence,
          nrm.getY(i) + (openN.getY(i) - nrm.getY(i)) * influence,
          nrm.getZ(i) + (openN.getZ(i) - nrm.getZ(i)) * influence,
        ).normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
    }
  }
  return g;
}
