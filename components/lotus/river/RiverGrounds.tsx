"use client";
/* eslint-disable react-hooks/immutability --
   Instanced meshes, materials and their glow uniforms are three.js objects written in layout effects and the frame
   loop; the React Compiler lint reads those writes as mutating a hook's value. Nothing they write feeds back into
   what React renders. */
// The Meadow's grounds on the river plan (plan.ts): components/meadow/MeadowScene.tsx's parts and palette (the sage
// lawn and the far fields under the haze, the sanded setts laid round the rings, across the avenues and in circles at
// the plazas, the raised beds of planted mulch with their warm stone kerbs, a carpet of low growth and a clipped box
// edging, the plaza lanterns brightening at night, the hedge and the trees), rebuilt here because MeadowScene draws
// the current plan (and asks layout.ts which points are in a bed). The towpaths' plazas stop at the copings.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AVENUE_HALF, BED, type Box2 } from "@/components/meadow/layout";
import { grainTexture, liveGlowMaterial, merge, paint, paverTexture, plantedBedTexture, seeded, worldUv } from "@/components/meadow/parts";
import { meadow } from "@/components/meadow/runtime";
import { inPlanBed, type RiverPlan } from "@/components/lotus/river/plan";

const GRASS = "#8fb276";
const FIELD = "#7f9e66";
const STONE = "#d2c4ab";
const HEDGE_GREEN = "#4b7346";
const BARK = "#6e5039";
const LEAF = "#5f8c4f";
const IRON = "#3b3631";
const LANTERN_GLOW = "#ffc77e";
const HEDGE_EDGE = { w: 0.2, h: 0.2 } as const;
const PAVE_TILE = 3.2;

function grassTexture(repeat: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, size, size);
  const rand = seeded(7);
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size, r = 30 + rand() * 60, light = rand() < 0.5;
    wrapped(x, y, (cx, cy) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, light ? "rgba(200,224,150,0.12)" : "rgba(70,100,55,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
  }
  ctx.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size, y = rand() * size, len = 1.5 + rand() * 3, a = -Math.PI / 2 + (rand() - 0.5) * 0.9, light = rand() < 0.5;
    ctx.strokeStyle = light ? `rgba(190,215,140,${0.18 + rand() * 0.2})` : `rgba(60,92,48,${0.16 + rand() * 0.2})`;
    ctx.lineWidth = 0.8 + rand() * 0.6;
    wrapped(x, y, (cx, cy) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** As MeadowScene's: uv from the upright parts' positions through `map`, merged, laid flat. */
function laidFlat(parts: THREE.BufferGeometry[], map: (x: number, y: number, part: number) => [number, number], wrapU?: (part: number) => number): THREE.BufferGeometry {
  const flat = parts.map((p, k) => {
    const g = p.toNonIndexed();
    p.dispose();
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = map(pos.getX(i), pos.getY(i), k);
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    const turn = wrapU?.(k);
    if (turn) {
      for (let t = 0; t + 2 < pos.count; t += 3) {
        const us = [uv[t * 2], uv[t * 2 + 2], uv[t * 2 + 4]];
        if (Math.max(...us) - Math.min(...us) < turn / 2) continue;
        for (let j = 0; j < 3; j++) if (us[j] < turn / 2) uv[(t + j) * 2] += turn;
      }
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return g;
  });
  const merged = mergeGeometries(flat, false)!;
  for (const g of flat) g.dispose();
  merged.rotateX(-Math.PI / 2);
  return merged;
}

function pavingGeometries(P: RiverPlan) {
  const ringParts = P.paths.map((p) => new THREE.RingGeometry(p.inner - 0.15, p.outer + 0.15, Math.max(64, Math.ceil((Math.PI * 2 * p.outer) / 0.6)), 1));
  const rings = laidFlat(
    ringParts,
    (x, y, k) => {
      const p = P.paths[k];
      const around = Math.round((Math.PI * 2 * p.r) / PAVE_TILE);
      const a = Math.atan2(-y, x);
      return [((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * around, Math.hypot(x, y) / PAVE_TILE];
    },
    (k) => Math.round((Math.PI * 2 * P.paths[k].r) / PAVE_TILE),
  );
  const avenueParts = P.avenues.map((av) => {
    const strip = new THREE.PlaneGeometry(av.to - av.from, AVENUE_HALF * 2 + 0.1, 1, 1);
    strip.translate((av.from + av.to) / 2, 0, 0);
    strip.rotateZ(-av.angle);
    return strip;
  });
  const avenues = laidFlat(avenueParts, (x, y, k) => {
    const a = P.avenues[k].angle;
    return [(x * Math.sin(a) + y * Math.cos(a)) / PAVE_TILE, (x * Math.cos(a) - y * Math.sin(a)) / PAVE_TILE];
  });
  // plazas as discs of rings; on a towpath the paving's points are drawn back to the coping (radially from the rose)
  const plazaParts = P.plazas.map((c) => {
    const disc = new THREE.RingGeometry(0.03, c.r, 48, 10);
    const pos = disc.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + c.x, z = -pos.getY(i) + c.z;
      const r = Math.hypot(x, z);
      const k = r > c.rMax ? c.rMax / r : r < c.rMin ? c.rMin / r : 1;
      pos.setXY(i, x * k, -z * k);
    }
    return disc;
  });
  const plazas = laidFlat(
    plazaParts,
    (x, y, k) => {
      const c = P.plazas[k];
      const dx = x - c.x, dy = y + c.z;
      const a = Math.atan2(dy, dx);
      return [((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * 4, Math.hypot(dx, dy) / PAVE_TILE];
    },
    () => 4,
  );
  return { rings, avenues, plazas };
}

function soilGeometry(P: RiverPlan): THREE.BufferGeometry {
  const parts = P.sectors.map((s) => new THREE.ShapeGeometry(new THREE.Shape(s.points.map((p) => new THREE.Vector2(p.x, -p.z))), 2).toNonIndexed());
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.rotateX(-Math.PI / 2);
  merged.translate(0, BED.soilH, 0);
  return worldUv(merged, 3);
}

function useBoxInstances(ref: React.RefObject<THREE.InstancedMesh | null>, boxes: readonly Box2[], lift = 0) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    boxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(new THREE.Vector3(b.x, b.h / 2 + lift, b.z), q, new THREE.Vector3(b.hx * 2, b.h, b.hz * 2));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, boxes, lift]);
}

function Kerbs({ boxes, shadows }: { boxes: readonly Box2[]; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useBoxInstances(ref, boxes);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, boxes.length]} castShadow={shadows} receiveShadow>
      <meshStandardMaterial color={STONE} roughness={0.9} />
    </instancedMesh>
  );
}

function Hedge({ boxes }: { boxes: readonly Box2[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.3), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useBoxInstances(ref, boxes);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, boxes.length]} castShadow receiveShadow>
      <meshStandardMaterial color={HEDGE_GREEN} roughness={0.95} />
    </instancedMesh>
  );
}

function Trees({ P }: { P: RiverPlan }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.2, 0.32, 1, 7).translate(0, 0.5, 0), []);
  const crownGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  useEffect(
    () => () => {
      trunkGeo.dispose();
      crownGeo.dispose();
    },
    [trunkGeo, crownGeo],
  );
  useLayoutEffect(() => {
    const t = trunks.current, c = crowns.current;
    if (!t || !c) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    P.trees.forEach((tree, i) => {
      m.compose(new THREE.Vector3(tree.x, 0, tree.z), q, new THREE.Vector3(1, tree.canopyY, 1));
      t.setMatrixAt(i, m);
      const R = tree.canopyR;
      m.compose(new THREE.Vector3(tree.x, tree.canopyY + R * 0.2, tree.z), q, new THREE.Vector3(R, R * 0.9, R));
      c.setMatrixAt(i * 2, m);
      const off = ((i * 53) % 7) / 7 - 0.5;
      m.compose(new THREE.Vector3(tree.x + off * R, tree.canopyY + R * 0.75, tree.z - off * R * 0.6), q, new THREE.Vector3(R * 0.68, R * 0.62, R * 0.68));
      c.setMatrixAt(i * 2 + 1, m);
      const tint = color.set(LEAF).offsetHSL(((i * 37) % 9) / 300 - 0.015, 0, ((i * 53) % 7) / 100 - 0.03);
      c.setColorAt(i * 2, tint);
      c.setColorAt(i * 2 + 1, tint.offsetHSL(0, 0, 0.03));
    });
    t.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    t.computeBoundingSphere();
    c.computeBoundingSphere();
  }, [P]);
  return (
    <>
      <instancedMesh ref={trunks} args={[trunkGeo, undefined, P.trees.length]} castShadow receiveShadow>
        <meshStandardMaterial color={BARK} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[crownGeo, undefined, P.trees.length * 2]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
    </>
  );
}

function FarWoods({ P }: { P: RiverPlan }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 80;
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rnd = seeded(99);
    for (let i = 0; i < count; i++) {
      const a = ((i + rnd() * 0.7) / count) * Math.PI * 2;
      const r = P.groundR + 12 + rnd() * 20;
      const R = 4 + rnd() * 4;
      m.compose(new THREE.Vector3(r * Math.cos(a), R * 0.55, r * Math.sin(a)), q, new THREE.Vector3(R * 1.3, R, R * 1.3));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [P]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, count]}>
      <meshStandardMaterial color="#557a4a" roughness={1} flatShading />
    </instancedMesh>
  );
}

function lanternGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 8).translate(0, 0.06, 0), STONE));
  parts.push(paint(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 6).translate(0, 0.85, 0), IRON));
  parts.push(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 6).translate(0, 1.6, 0), IRON));
  parts.push(paint(new THREE.CylinderGeometry(0.085, 0.07, 0.22, 6).translate(0, 1.73, 0), LANTERN_GLOW, 1));
  parts.push(paint(new THREE.ConeGeometry(0.12, 0.1, 6).translate(0, 1.89, 0), IRON));
  parts.push(paint(new THREE.SphereGeometry(0.022, 6, 4).translate(0, 1.96, 0), IRON));
  return merge(parts);
}

export function poolTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,200,130,0.9)");
  g.addColorStop(0.35, "rgba(255,170,90,0.35)");
  g.addColorStop(1, "rgba(255,150,70,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Lanterns({ P }: { P: RiverPlan }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => lanternGeometry(), []);
  const { material, glow } = useMemo(() => liveGlowMaterial({ roughness: 0.6, metalness: 0.2 }, "lantern"), []);
  const pool = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const tex = poolTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0 });
    return { g, tex, mat };
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      material.dispose();
      pool.g.dispose();
      pool.tex.dispose();
      pool.mat.dispose();
    },
    [geo, material, pool],
  );
  useLayoutEffect(() => {
    const mesh = ref.current, glows = pools.current;
    if (!mesh || !glows) return;
    const m = new THREE.Matrix4();
    P.lanterns.forEach((p, i) => {
      m.makeTranslation(p.x, BED.soilH, p.z);
      mesh.setMatrixAt(i, m);
      m.makeScale(4.4, 1, 4.4).setPosition(p.x, BED.kerbH + 0.01, p.z);
      glows.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    glows.computeBoundingSphere();
  }, [P]);
  useFrame((state) => {
    const breath = 0.94 + 0.06 * Math.sin(state.clock.elapsedTime * 1.3);
    glow.value = (0.35 + 2.4 * meadow.night) * breath;
    const g = pools.current;
    if (g) {
      pool.mat.opacity = Math.max(0, meadow.night - 0.2) * 0.75 * breath;
      g.visible = pool.mat.opacity > 0.01;
    }
  });
  return (
    <>
      <instancedMesh ref={ref} args={[geo, material, P.lanterns.length]} castShadow />
      <instancedMesh ref={pools} args={[pool.g, pool.mat, P.lanterns.length]} renderOrder={4} visible={false} />
    </>
  );
}

/** Points on the plan's beds for the carpet of low growth, clear of every plot (and the pockets' stakes do not matter). */
function carpetPoints(P: RiverPlan, density: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const rnd = seeded(4242);
  for (const bed of P.beds) {
    const n = Math.round(Math.PI * (bed.outer ** 2 - bed.inner ** 2) * density);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(bed.inner ** 2 + rnd() * (bed.outer ** 2 - bed.inner ** 2));
      const a = rnd() * Math.PI * 2;
      const x = r * Math.cos(a), z = r * Math.sin(a);
      if (!inPlanBed(P, x, z)) continue;
      let clear = true;
      for (const p of P.plots) {
        if (Math.abs(p.r - r) > 0.6) continue;
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < 0.2) {
          clear = false;
          break;
        }
      }
      if (clear) out.push([x, z, 0.8 + rnd() * 0.8]);
    }
  }
  return out;
}

function BedCarpet({ P, density }: { P: RiverPlan; density: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const blade = new THREE.ConeGeometry(0.035, 0.16 + (k % 3) * 0.04, 3, 1, true);
      blade.translate(0, 0.08, 0);
      blade.rotateZ(0.5);
      blade.rotateY((k / 5) * Math.PI * 2 + k * 0.4);
      parts.push(paint(blade, k % 2 ? "#6f9a52" : "#86ad62"));
    }
    return merge(parts);
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const points = useMemo(() => carpetPoints(P, density), [P, density]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    points.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
      m.compose(new THREE.Vector3(x, BED.soilH, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHSL(0.27 + ((i * 13) % 7) / 200, 0.35, 0.82 + ((i * 7) % 5) / 40));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [points]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, points.length]} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

function BoxHedging({ P, shadows }: { P: RiverPlan; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const leafy = useMemo(() => {
    const t = grainTexture("#456f3b", "#5e8c4c", "#2f4f2a", 41, 1);
    t.repeat.set(2, 1);
    return t;
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      leafy.dispose();
    },
    [geo, leafy],
  );
  const pieces = useMemo(() => {
    const out: Array<{ x: number; z: number; len: number; yaw: number }> = [];
    for (const s of P.sectors) {
      const poly = s.points;
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        area += a.x * b.z - b.x * a.z;
      }
      const inward = Math.sign(area) || 1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = (-dz / len) * inward, nz = (dx / len) * inward;
        const inset = BED.kerbT + HEDGE_EDGE.w / 2 + 0.01;
        out.push({ x: (a.x + b.x) / 2 + nx * inset, z: (a.z + b.z) / 2 + nz * inset, len: Math.max(0.05, len - 0.08), yaw: Math.atan2(-dz, dx) });
      }
    }
    return out;
  }, [P]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    pieces.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m.compose(new THREE.Vector3(p.x, BED.soilH, p.z), q, new THREE.Vector3(p.len, HEDGE_EDGE.h * (0.95 + ((i * 7) % 5) * 0.025), HEDGE_EDGE.w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setRGB(1, 1, 1).multiplyScalar(0.94 + ((i * 11) % 7) * 0.02));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [pieces]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, pieces.length]} castShadow={shadows} receiveShadow>
      <meshStandardMaterial map={leafy} roughness={0.95} />
    </instancedMesh>
  );
}

export function RiverGrounds({ P, shadows, carpet }: { P: RiverPlan; shadows: boolean; carpet: number }) {
  const grass = useMemo(() => grassTexture(Math.round(P.groundR / 1.4)), [P]);
  const stone = useMemo(() => paverTexture(11), []);
  const mulch = useMemo(() => plantedBedTexture(23), []);
  const paving = useMemo(() => pavingGeometries(P), [P]);
  const soil = useMemo(() => soilGeometry(P), [P]);
  const paveMat = useMemo(() => new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92 }), [stone]);
  useEffect(
    () => () => {
      grass.dispose();
      stone.dispose();
      mulch.dispose();
      paving.rings.dispose();
      paving.avenues.dispose();
      paving.plazas.dispose();
      soil.dispose();
      paveMat.dispose();
    },
    [grass, stone, mulch, paving, soil, paveMat],
  );
  const promenade = P.paths[P.paths.length - 1];
  return (
    <group name="river-grounds">
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03} renderOrder={2}>
        <ringGeometry args={[P.groundR - 0.5, P.groundR + 140, 64, 1]} />
        <meshStandardMaterial color={FIELD} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow renderOrder={1}>
        <ringGeometry args={[promenade.inner - 0.3, P.groundR, 128, 4]} />
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>
      <mesh geometry={paving.rings} material={paveMat} position-y={0.01} receiveShadow />
      <mesh geometry={paving.avenues} material={paveMat} position-y={0.016} receiveShadow />
      <mesh geometry={paving.plazas} material={paveMat} position-y={0.022} receiveShadow />
      <mesh geometry={soil} receiveShadow>
        <meshStandardMaterial map={mulch} roughness={1} />
      </mesh>
      <Kerbs boxes={P.kerbs} shadows={shadows} />
      <BedCarpet P={P} density={carpet} />
      <BoxHedging P={P} shadows={shadows} />
      <Lanterns P={P} />
      <Hedge boxes={P.hedge} />
      <Trees P={P} />
      <FarWoods P={P} />
    </group>
  );
}
