"use client";
// The shade cloth and the rain cover over the hero, for a signed-in visitor's plant (the store's shade and cover, set
// by lib/client/plant from the care layer): slim green hoops across the bed, open toward the camera so the plant is
// seen through the tunnel's mouth, with a soft ivory cloth (shade) or a clear sheet (the rain cover) drawn over them.
// They ease in when put up (the hoops rise out of the mulch as the cloth settles onto them) and out when folded away,
// size themselves to the plant as it grows (a little cloche over a seedling, a tunnel over a grown bush), and are not
// drawn at all while both are down, so the owner's rose, which never has either, looks exactly as it did.
//
// The tunnel is built once at unit size and scaled uniformly, so the hoops keep their thickness at every size. The
// cloth leaves the lowest part of each side open (as a cloth thrown over hoops does) and hangs a short scalloped hem
// across the top of each end, so the camera, looking in at the open front, sees the fabric itself and not just its edge.
// The clear cover reaches the mulch and is closed at its ends with gently domed panes, a cloche the plant is seen
// through. When both are up the cover stands just outside the cloth. The tunnel stands a little behind the plant, so
// its legs stay inside the bed's kerb.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HERO_GROUND_Y } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { garden, type Quality } from "@/lib/garden/store";
import { useLayerFrame, useLayerLive } from "@/components/garden/TierLayers";

/** The unit tunnel: a half-ellipse arch this wide either side for a height of 1, and this deep front to back. */
const HALF_WIDTH = 0.44;
const DEPTH = 0.62;
/** The tunnel's centre stands this far behind the plant, as a share of its height. */
const BACK = 0.16;
const HOOP_RADIUS = 0.0055;
/** Height over the plant's head, and the smallest and largest tunnel (m). */
const HEADROOM = 0.13;
const MIN_H = 0.26;
const MAX_H = 1.34;
/** Per second: how fast a cover goes up or comes down, and how fast it follows the plant's height. */
const RISE_RATE = 1.3;
const SIZE_RATE = 0.6;
/** The legs stand this far into the mulch, so they read as pushed in wherever the bed dips. */
const SINK = 0.04;
/** The rain cover stands this much wider than the shade cloth, so both can be up at once. */
const COVER_OVER = 1.07;

const SHADE_COLOR = new THREE.Color("#ece4d0");
const COVER_COLOR = new THREE.Color("#e6f2fb");
const HOOP_COLOR = new THREE.Color("#3f4c37");
const SHADE_OPACITY = 0.6;
const COVER_OPACITY = 0.1;

/** A point on the unit arch at angle theta (0 the right leg, PI the left), at depth z. */
function arch(theta: number, z: number, inset: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(theta) * HALF_WIDTH * (1 - inset), Math.sin(theta) * (1 - inset), z);
}

/** One hoop at depth z: the arch, its legs carried on straight down a little below the ground line. */
function hoopGeometry(z: number, radial: number, segs: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [new THREE.Vector3(HALF_WIDTH, -0.06, z)];
  for (let i = 0; i <= 24; i++) pts.push(arch((i / 24) * Math.PI, z, 0, new THREE.Vector3()));
  pts.push(new THREE.Vector3(-HALF_WIDTH, -0.06, z));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), segs, HOOP_RADIUS, radial, false);
}

/**
 * The cloth over the arch from theta0 to PI - theta0, a touch past the end hoops, sagging between the hoops and laid in
 * soft folds, so the light catches it like fabric rather than a shell.
 */
function clothGeometry(theta0: number, sag: number, folds: number, nu: number, nv: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const z0 = -DEPTH / 2 - 0.012;
  const z1 = DEPTH / 2 + 0.012;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const z = z0 + (z1 - z0) * v;
    // two bays between three hoops: the cloth dips between them, not at them
    const bay = Math.abs(Math.sin(v * Math.PI * 2));
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const theta = theta0 + (Math.PI - 2 * theta0) * u;
      const fold = folds > 0 ? 0.006 * Math.sin(u * Math.PI * folds) * (0.6 + 0.4 * bay) : 0;
      arch(theta, z, -0.012 + sag * bay * Math.sin(theta) + fold, p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The shade cloth's hem across one end (z), hanging from the arch: longest at the top, nothing down the sides where the
 * cloth falls along the hoop, its lower edge in soft scallops.
 */
function hemGeometry(theta0: number, z: number, nu: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const out = Math.sign(z) * 0.006;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const theta = theta0 + (Math.PI - 2 * theta0) * u;
    arch(theta, z + out, -0.012, p);
    const s = Math.sin(theta);
    const len = 0.1 * s * s * (0.78 + 0.22 * Math.abs(Math.cos(u * Math.PI * 9)));
    pos.push(p.x, p.y, p.z, p.x * (1 - 0.04 * s), p.y - len, p.z + out);
  }
  for (let i = 0; i < nu; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One end of the clear cover: a pane filling the arch at z, domed outward a little so the light moves across it. */
function paneGeometry(z: number, nu: number, nr: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const dir = Math.sign(z);
  for (let r = 0; r <= nr; r++) {
    const s = r / nr;
    for (let i = 0; i <= nu; i++) {
      const theta = (i / nu) * Math.PI;
      arch(theta, z, -0.012, p);
      pos.push(p.x * s, p.y * s, z + dir * 0.07 * (1 - s * s));
    }
  }
  for (let r = 0; r < nr; r++) {
    for (let i = 0; i < nu; i++) {
      const a = r * (nu + 1) + i;
      const b = a + nu + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Cover {
  group: THREE.Group | null;
  cloth: THREE.Mesh | null;
  /** how far up it is, 0..1 */
  up: number;
}

function useCoverParts(quality: Quality) {
  const lite = quality === "lite";
  return useMemo(() => {
    const radial = lite ? 5 : 7;
    const segs = lite ? 40 : 64;
    const hoops = [-DEPTH / 2, 0, DEPTH / 2].map((z) => hoopGeometry(z, radial, segs));
    const shadeFrom = Math.asin(0.24);
    const shadeCloth = clothGeometry(shadeFrom, 0.035, lite ? 0 : 18, lite ? 28 : 56, lite ? 8 : 16);
    const hems = [DEPTH / 2 + 0.012, -DEPTH / 2 - 0.012].map((z) => hemGeometry(shadeFrom, z, lite ? 28 : 56));
    const coverSheet = clothGeometry(0.02, 0.012, 0, lite ? 28 : 48, lite ? 6 : 10);
    const panes = [DEPTH / 2 + 0.012, -DEPTH / 2 - 0.012].map((z) => paneGeometry(z, lite ? 20 : 32, lite ? 4 : 6));
    const hoopMat = new THREE.MeshStandardMaterial({ color: HOOP_COLOR, roughness: 0.55, metalness: 0.25, transparent: true });
    const shadeMat = new THREE.MeshStandardMaterial({
      color: SHADE_COLOR,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const coverMat = new THREE.MeshStandardMaterial({
      color: COVER_COLOR,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.4,
    });
    return { hoops, shadeCloth, hems, coverSheet, panes, hoopMat, shadeMat, coverMat };
  }, [lite]);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function BedCovers({ quality }: { quality: Quality }) {
  const parts = useCoverParts(quality);
  useEffect(
    () => () => {
      parts.hoops.forEach((g) => g.dispose());
      parts.shadeCloth.dispose();
      parts.hems.forEach((g) => g.dispose());
      parts.coverSheet.dispose();
      parts.panes.forEach((g) => g.dispose());
      parts.hoopMat.dispose();
      parts.shadeMat.dispose();
      parts.coverMat.dispose();
    },
    [parts],
  );

  // the frame loop reaches the materials through a ref: they are three.js objects, changed in place every frame
  const live = useRef(parts);
  useEffect(() => {
    live.current = parts;
  }, [parts]);
  const shade = useRef<Cover>({ group: null, cloth: null, up: 0 });
  const cover = useRef<Cover>({ group: null, cloth: null, up: 0 });
  const size = useRef(0);
  const quick = useRef(false);
  // built out of sight for a tier change (TierLayers): it goes live already standing as the store has it, as the
  // covers it replaces did, rather than rising again from the mulch
  const builtHidden = !useLayerLive();
  const snap = useRef(builtHidden);
  useEffect(() => {
    quick.current = reducedMotion();
  }, []);

  useLayerFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = garden.get();
    const mats = live.current;
    const head = Math.max(0, env.headPos.y - HERO_GROUND_Y);
    const want = Math.min(MAX_H, Math.max(MIN_H, head + HEADROOM));
    const shown = shade.current.up > 0.001 || cover.current.up > 0.001;
    // a cover going up for the first time takes the plant's size at once; after that it follows the plant slowly
    size.current = shown && size.current > 0 ? size.current + (want - size.current) * (1 - Math.exp(-dt * SIZE_RATE)) : want;
    const rise = 1 - Math.exp(-dt * (quick.current ? 10 : RISE_RATE));
    const step = (c: Cover, target: number, scale: number, opacity: number, mat: THREE.MeshStandardMaterial) => {
      c.up += (target - c.up) * rise;
      if (Math.abs(target - c.up) < 0.002) c.up = target;
      const g = c.group;
      if (!g) return;
      g.visible = c.up > 0.001;
      if (!g.visible) return;
      const e = c.up * c.up * (3 - 2 * c.up);
      const k = size.current * scale;
      g.position.set(LAYOUT.hero[0], HERO_GROUND_Y - SINK, LAYOUT.hero[2] - BACK * size.current);
      // the hoops rise out of the mulch, the cloth settles onto them as it fades in
      g.scale.set(k, k * (0.55 + 0.45 * e), k);
      mat.opacity = opacity * e * e;
    };
    if (snap.current) {
      snap.current = false;
      shade.current.up = s.shade > 0.5 ? 1 : 0;
      cover.current.up = s.cover > 0.5 ? 1 : 0;
    }
    step(shade.current, s.shade > 0.5 ? 1 : 0, 1, SHADE_OPACITY, mats.shadeMat);
    step(cover.current, s.cover > 0.5 ? 1 : 0, COVER_OVER, COVER_OPACITY, mats.coverMat);
    // the hoops fade in over the first half of the rise and out over the last half of the fall
    mats.hoopMat.opacity = Math.min(1, 2 * Math.max(shade.current.up, cover.current.up));
    // with both up, the cover's own hoops would double the shade's: the cover keeps only its sheet
    const both = shade.current.up > 0.5 && cover.current.up > 0.5;
    const ch = cover.current.group?.children;
    if (ch) for (let i = 0; i < ch.length; i++) if (ch[i].name === "hoop") ch[i].visible = !both;
  });

  return (
    <group name="bed-covers">
      <group
        ref={(g) => {
          shade.current.group = g;
        }}
        visible={false}
      >
        {parts.hoops.map((g, i) => (
          <mesh key={i} name="hoop" geometry={g} material={parts.hoopMat} />
        ))}
        <mesh
          ref={(m) => {
            shade.current.cloth = m;
          }}
          geometry={parts.shadeCloth}
          material={parts.shadeMat}
          renderOrder={2}
        />
        {parts.hems.map((g, i) => (
          <mesh key={i} geometry={g} material={parts.shadeMat} renderOrder={2} />
        ))}
      </group>
      <group
        ref={(g) => {
          cover.current.group = g;
        }}
        visible={false}
      >
        {parts.hoops.map((g, i) => (
          <mesh key={i} name="hoop" geometry={g} material={parts.hoopMat} />
        ))}
        <mesh
          ref={(m) => {
            cover.current.cloth = m;
          }}
          geometry={parts.coverSheet}
          material={parts.coverMat}
          renderOrder={3}
        />
        {parts.panes.map((g, i) => (
          <mesh key={i} geometry={g} material={parts.coverMat} renderOrder={3} />
        ))}
      </group>
    </group>
  );
}
