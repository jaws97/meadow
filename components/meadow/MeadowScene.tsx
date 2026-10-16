"use client";
// Placeholder art for the Meadow slice, built straight from layout.ts: the
// ground slab, the sanded ring paths and spokes, the raised beds with their
// stone kerbs, the rose dais, a hedge arc and a few trees. It is a test bed
// for driving, not final art, but it keeps to a calm palette (sage lawn,
// cream sand, warm stone, deep hedge green) and to a handful of draw calls:
// every repeated part is one instanced or merged mesh.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BED, DAIS, GROUND_HALF, HEDGE, KERBS, PATHS, SPOKES, TREES, type Box2 } from "@/components/meadow/layout";

const GRASS = "#8fb276";
const EARTH = "#6d543d";
const SAND = "#e8d8b8";
const SOIL = "#5b4330";
const STONE = "#cdbea6";
const HEDGE_GREEN = "#4e7748";
const BARK = "#6e5039";
const LEAF = "#6a9356";

function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, size, size);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Tileable: everything is drawn at its position and wrapped copies.
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(x + ox, y + oy);
  };
  // Broad, very soft light and dark drifts...
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 60;
    const light = rand() < 0.5;
    wrapped(x, y, (cx, cy) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, light ? "rgba(200,224,150,0.12)" : "rgba(70,100,55,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
  }
  // ...then a fine nap of short blade strokes, so up close it reads as turf.
  ctx.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 1.5 + rand() * 3;
    const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
    const light = rand() < 0.5;
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
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Ring bands and spoke strips, flat on the lawn, as one geometry. */
function pathGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const r of [PATHS.inner, PATHS.outer]) parts.push(new THREE.RingGeometry(r - PATHS.halfWidth, r + PATHS.halfWidth, 128, 1));
  const w = SPOKES.halfWidth - 0.25;
  for (const s of SPOKES.angles) {
    const r0 = PATHS.inner + PATHS.halfWidth - 0.1;
    const r1 = PATHS.outer - PATHS.halfWidth + 0.1;
    const strip = new THREE.PlaneGeometry(r1 - r0, w * 2);
    strip.translate((r0 + r1) / 2, 0, 0);
    // In the XY plane, angle -s, so that after laying flat it points along +s.
    strip.rotateZ(-s);
    parts.push(strip);
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  merged.rotateX(-Math.PI / 2);
  return merged;
}

/** Each bed's soil top, bounded exactly by the arc kerbs and the spoke walls. */
function soilGeometry(): THREE.BufferGeometry {
  const lateral = SPOKES.halfWidth + BED.kerbT;
  const parts: THREE.BufferGeometry[] = [];
  const n = SPOKES.angles.length;
  for (let k = 0; k < n; k++) {
    const s0 = SPOKES.angles[k];
    const s1 = k + 1 < n ? SPOKES.angles[k + 1] : SPOKES.angles[0] + Math.PI * 2;
    const shape = new THREE.Shape();
    const arc = (r: number, from: number, to: number, first: boolean) => {
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const a = from + ((to - from) * i) / steps;
        // Shape space is (x, -z): laying it flat maps y to -z.
        if (first && i === 0) shape.moveTo(r * Math.cos(a), -r * Math.sin(a));
        else shape.lineTo(r * Math.cos(a), -r * Math.sin(a));
      }
    };
    const rin = BED.inner + BED.kerbT * 0.5;
    const rout = BED.outer - BED.kerbT * 0.5;
    arc(rin, s0 + Math.asin(lateral / rin), s1 - Math.asin(lateral / rin), true);
    arc(rout, s1 - Math.asin(lateral / rout), s0 + Math.asin(lateral / rout), false);
    shape.closePath();
    parts.push(new THREE.ShapeGeometry(shape, 4));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.rotateX(-Math.PI / 2);
  merged.translate(0, BED.soilH, 0);
  return merged;
}

function useBoxInstances(ref: React.RefObject<THREE.InstancedMesh | null>, boxes: readonly Box2[]) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    boxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), q, new THREE.Vector3(b.hx * 2, b.h, b.hz * 2));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, boxes]);
}

function Kerbs() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 2, 0.06), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useBoxInstances(ref, KERBS);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, KERBS.length]} castShadow receiveShadow>
      <meshStandardMaterial color={STONE} roughness={0.92} />
    </instancedMesh>
  );
}

function Hedge() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, 0.3), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useBoxInstances(ref, HEDGE);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, HEDGE.length]} castShadow receiveShadow>
      <meshStandardMaterial color={HEDGE_GREEN} roughness={0.95} />
    </instancedMesh>
  );
}

function Trees() {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunkGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.22, 0.32, 1, 8);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const crownGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  useEffect(
    () => () => {
      trunkGeo.dispose();
      crownGeo.dispose();
    },
    [trunkGeo, crownGeo],
  );
  useLayoutEffect(() => {
    const t = trunks.current;
    const c = crowns.current;
    if (!t || !c) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    TREES.forEach((tree, i) => {
      m.compose(new THREE.Vector3(tree.x, 0, tree.z), q, new THREE.Vector3(1, tree.canopyY, 1));
      t.setMatrixAt(i, m);
      m.compose(
        new THREE.Vector3(tree.x, tree.canopyY + tree.canopyR * 0.25, tree.z),
        q,
        new THREE.Vector3(tree.canopyR, tree.canopyR * 0.9, tree.canopyR),
      );
      c.setMatrixAt(i, m);
      c.setColorAt(i, color.set(LEAF).offsetHSL(((i * 37) % 9) / 300 - 0.015, 0, ((i * 53) % 7) / 100 - 0.03));
    });
    t.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    t.computeBoundingSphere();
    c.computeBoundingSphere();
  }, []);
  return (
    <>
      <instancedMesh ref={trunks} args={[trunkGeo, undefined, TREES.length]} castShadow receiveShadow>
        <meshStandardMaterial color={BARK} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[crownGeo, undefined, TREES.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
    </>
  );
}

/** The dais and a stand-in for the birthday rose: a soft glowing bud above low greenery. */
function Dais() {
  return (
    <group>
      <mesh position={[0, DAIS.h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[DAIS.r, DAIS.r + 0.08, DAIS.h, 96]} />
        <meshStandardMaterial color="#e6ddcd" roughness={0.7} />
      </mesh>
      <mesh position={[0, DAIS.h + 0.015, 0]} receiveShadow>
        <cylinderGeometry args={[DAIS.r - 0.35, DAIS.r - 0.35, 0.03, 96]} />
        <meshStandardMaterial color="#d8ccb8" roughness={0.8} />
      </mesh>
      <mesh position={[0, DAIS.h, 0]} scale={[1.6, 0.55, 1.6]} castShadow receiveShadow>
        <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#4f7a45" roughness={0.9} />
      </mesh>
      <mesh position={[0, DAIS.h + 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 1.0, 8]} />
        <meshStandardMaterial color="#4b6e3a" roughness={0.8} />
      </mesh>
      <mesh position={[0, DAIS.h + 1.55, 0]} scale={[1, 1.15, 1]} castShadow>
        <sphereGeometry args={[0.28, 24, 16]} />
        <meshStandardMaterial color="#c9405a" emissive="#ff6f8a" emissiveIntensity={0.35} roughness={0.45} />
      </mesh>
    </group>
  );
}

export function MeadowScene() {
  const grass = useMemo(() => grassTexture(), []);
  const paths = useMemo(() => pathGeometry(), []);
  const soil = useMemo(() => soilGeometry(), []);
  const groundMaterials = useMemo(() => {
    const top = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
    const side = new THREE.MeshStandardMaterial({ color: EARTH, roughness: 1 });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    return [side, side, top, side, side, side];
  }, [grass]);
  useEffect(
    () => () => {
      grass.dispose();
      paths.dispose();
      soil.dispose();
      groundMaterials[0].dispose();
      groundMaterials[2].dispose();
    },
    [grass, paths, soil, groundMaterials],
  );

  return (
    <group>
      <mesh position={[0, -0.5, 0]} material={groundMaterials} receiveShadow>
        <boxGeometry args={[GROUND_HALF * 2, 1, GROUND_HALF * 2]} />
      </mesh>
      <mesh geometry={paths} position={[0, 0.012, 0]} receiveShadow>
        <meshStandardMaterial color={SAND} roughness={0.95} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh geometry={soil} receiveShadow>
        <meshStandardMaterial color={SOIL} roughness={1} />
      </mesh>
      <Kerbs />
      <Hedge />
      <Trees />
      <Dais />
    </group>
  );
}
