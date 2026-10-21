"use client";
// A seed just planted: a small mound of freshly turned soil at the hero's place, with a soft light breathing up
// through it, the same seed of light the planting moment closes the soil over (components/gift/PlantingMoment). It
// keeps a newly planted bed from looking bare during the hours before the first shoot (the stem shows from growth
// 0.03, its first leaves from 0.04), and settles away as the shoot comes up through it. A grown plant never shows
// it, so the owner's rose is drawn exactly as before. When the watering can pours onto it (canLive), the soil darkens
// from where the water lands, as the bed's mulch does, and the seed's light takes one deeper breath as it drinks.
//
// The party trailer opens on this seed and closes on a new one, through lib/garden/trailerFx: a multiplier on the
// light (a brighter seed of light in the dawn close-ups), a pulse that swells it, and a bulge that lifts the mound, so
// the seed hops twice to the tune's last two notes. At neutral (×1, no pulse, no bulge) it draws exactly as above.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HERO_GROUND_Y, withGardenLight } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { LAYOUT } from "@/lib/garden/layout";
import { garden, type Quality } from "@/lib/garden/store";
import { trailerFx } from "@/lib/garden/trailerFx";
import { gardenMaterials, withCanWet } from "@/components/garden/garden/materials";
import { canLive } from "@/components/garden/garden/canLive";
import { smoothstep } from "@/lib/plant/prng";
import { useLayerFrame } from "@/components/garden/TierLayers";

/** Growth at which the mound starts to settle, and by which it is gone (the shoot is up through it by then). */
const SETTLE_FROM = 0.03;
const GONE_BY = 0.075;
const RADIUS = 0.06;
const HEIGHT = 0.022;
/** seconds per breath of the seed's light */
const BREATH = 5.5;
/** The glow sprite's height over the bed: inside the top of the mound, so the light seems to come up through it. */
const GLOW_Y = HEIGHT * 0.85;
/** The trailer's hop at full pulse and bulge: the light swells and grows, the mound rises and draws in a little. */
const PULSE_LIGHT = 1.2;
const PULSE_SIZE = 0.35;
const BULGE_RISE = 0.5;
const BULGE_NARROW = 0.05;

/** A soft round glow, drawn once: white at the heart, gone at the rim (tinted by the sprite's colour). */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.5)");
  g.addColorStop(0.55, "rgba(255,255,255,0.1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The mound: a soft bump of turned soil on a unit disc, (1 - r^2)^2 high, a little uneven round its edge, its rim
 * tucked just under the mulch so it rises out of the bed rather than sitting on it.
 */
function moundGeometry(rings: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  pos.push(0, 1, 0);
  uv.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const r = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const lump = 1 + 0.07 * Math.sin(a * 5 + 1.3) * r + 0.05 * Math.sin(a * 9 - 0.4) * r;
      const h = (1 - r * r) ** 2 + 0.05 * Math.sin(a * 7 + r * 9) * r * (1 - r) - 0.12 * r * r;
      pos.push(Math.cos(a) * r * lump, h, Math.sin(a) * r * lump);
      uv.push(0.5 + 0.5 * Math.cos(a) * r, 0.5 + 0.5 * Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs;
    const a1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function SeedMound({ quality }: { quality: Quality }) {
  const lite = quality === "lite";
  const parts = useMemo(() => {
    const mulch = gardenMaterials().mulch;
    const soil = withCanWet(
      withGardenLight(
        new THREE.MeshStandardMaterial({
          map: mulch.map,
          bumpMap: mulch.bumpMap,
          bumpScale: 0.8,
          // turned earth: darker and finer than the bark mulch round it, never a black hole in the bed
          color: new THREE.Color("#a68e7b"),
          roughness: 0.97,
          metalness: 0,
        }),
        "garden-seed-mound",
        false,
      ),
      "canwet",
    );
    const glow = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color("#ffd9a0"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { mound: moundGeometry(lite ? 6 : 10, lite ? 20 : 36), soil, glow };
  }, [lite]);
  useEffect(
    () => () => {
      parts.mound.dispose();
      parts.soil.dispose();
      parts.glow.map?.dispose();
      parts.glow.dispose();
    },
    [parts],
  );

  // the frame loop reaches the glow through a ref: a three.js material, changed in place every frame
  const live = useRef(parts);
  useEffect(() => {
    live.current = parts;
  }, [parts]);
  const group = useRef<THREE.Group>(null);
  const sprite = useRef<THREE.Sprite>(null);

  useLayerFrame(() => {
    const g = group.current;
    if (!g) return;
    const { growth } = garden.get();
    const here = 1 - smoothstep(SETTLE_FROM, GONE_BY, growth);
    const sp = sprite.current;
    g.visible = here > 0.01;
    if (sp) sp.visible = g.visible;
    if (!g.visible) return;
    // the trailer's hop (0 otherwise): the mound swells upward and draws in a little, and the light rides up with it
    const { seedLight, seedPulse: pulse, seedBulge: bulge } = trailerFx;
    const rise = 1 + BULGE_RISE * bulge;
    const narrow = 1 - BULGE_NARROW * bulge;
    // the mound sinks and spreads a little as the shoot pushes up through it
    const spread = RADIUS * (1 + 0.15 * (1 - here)) * narrow;
    g.scale.set(spread, HEIGHT * here * rise, spread);
    if (sp) {
      const breath = 0.5 + 0.5 * Math.sin((env.time / BREATH) * Math.PI * 2);
      // one deeper breath as the can's water reaches the seed
      const drink = canLive.soil.breath;
      live.current.glow.opacity = here * (0.2 + 0.26 * breath) * (1 + 0.4 * drink) * seedLight * (1 + PULSE_LIGHT * pulse);
      const r = (0.038 + 0.014 * breath) * (1 + 0.15 * drink) * (1 + PULSE_SIZE * pulse);
      sp.scale.set(r, r, r);
      const y = GLOW_Y * rise;
      if (sp.position.y !== y) sp.position.y = y;
    }
  });

  return (
    <group name="seed-mound" position={[LAYOUT.hero[0], HERO_GROUND_Y, LAYOUT.hero[2]]}>
      <group ref={group} visible={false}>
        <mesh geometry={parts.mound} material={parts.soil} receiveShadow />
      </group>
      <sprite ref={sprite} material={parts.glow} position={[0, GLOW_Y, 0]} renderOrder={2} visible={false} />
    </group>
  );
}
