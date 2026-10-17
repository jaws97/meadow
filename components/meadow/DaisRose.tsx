"use client";
/* eslint-disable react-hooks/immutability --
   Three.js objects (materials, uniforms, instanced meshes, the scene's fog) are created once and then written in
   the frame loop, which is how an R3F scene animates without re-rendering; the React Compiler lint reads those
   writes as mutating a hook's value. They are intentional and never feed back into what React renders. */
// The centrepiece: the owner's Enchanted Rose, fully grown, on a stone dais at the heart of the Meadow. The rose is
// the garden's own procedural flower (flowerPlant.ts, the personal garden's hero for the seed "Lijas" in full bloom)
// standing larger than life, so it reads from every corner of the Meadow and from across the room on the big screen.
// The dais is two low tiers of warm stone with a rounded moulding on each, a soft mossy bed sprinkled with grass and
// small pale flowers, a ring of fieldstones, and a few motes of light drifting up round the rose; its petals' own
// light and a warm glow at its heart come up as night falls.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { applyPlantEnv, buildFlowerPlant, petalGlow } from "@/components/meadow/flowerPlant";
import { DAIS } from "@/components/meadow/layout";
import { grainTexture, merge, paint, seeded } from "@/components/meadow/parts";
import { OWNER_SEED, ROSE_SCALE } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import type { Quality } from "@/lib/garden/store";

const MOTES = 18;
/** The mossy bed on top of the dais: its radius and how high it domes. */
const BED_R = 2.35;
const BED_H = 0.26;
const STONE = "#e4d8c2";
const STONE_2 = "#ece3d1";

/** The bed's garnish, one mesh: a ring of fieldstones, tufts of grass and little pale flowers over the moss. */
function garnishGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = seeded(31);
  const domeY = (r: number) => BED_H * Math.sqrt(Math.max(0, 1 - (r / BED_R) ** 2));
  const strip = (g: THREE.BufferGeometry) => {
    if (g.attributes.uv) g.deleteAttribute("uv");
    return g;
  };
  // fieldstones round the bed's edge
  const stones = 30;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + rnd() * 0.08;
    const r = BED_R + 0.05 + rnd() * 0.06;
    const g = new THREE.DodecahedronGeometry(0.14 + rnd() * 0.06, 0);
    g.scale(1.25, 0.5, 0.95);
    g.rotateY(rnd() * 3);
    g.translate(r * Math.cos(a), 0.03, r * Math.sin(a));
    parts.push(strip(paint(g, rnd() < 0.5 ? "#d2c6b0" : "#c2b59e")));
  }
  // grass tufts and small flowers over the moss, kept off the rose's own foot
  for (let i = 0; i < 120; i++) {
    const r = 0.45 + Math.sqrt(rnd()) * (BED_R - 0.55);
    const a = rnd() * Math.PI * 2;
    const x = r * Math.cos(a), z = r * Math.sin(a), y = domeY(r) - 0.01;
    if (i % 3 === 0) {
      const petal = new THREE.CircleGeometry(0.035 + rnd() * 0.015, 5);
      petal.rotateX(-Math.PI / 2 + 0.25);
      petal.translate(x, y + 0.07 + rnd() * 0.05, z);
      parts.push(strip(paint(petal, rnd() < 0.5 ? "#fff6ec" : "#ffd9e4", 0.3)));
      const st = new THREE.CylinderGeometry(0.003, 0.004, 0.09, 4, 1, true);
      st.translate(x, y + 0.04, z);
      parts.push(strip(paint(st, "#6f9a52")));
    } else {
      for (let k = 0; k < 3; k++) {
        const blade = new THREE.ConeGeometry(0.025, 0.12 + rnd() * 0.06, 3, 1, true);
        blade.translate(0, 0.06, 0);
        blade.rotateZ(0.45);
        blade.rotateY(k * 2.1 + rnd());
        blade.translate(x, y, z);
        parts.push(strip(paint(blade, k % 2 ? "#5f8f4a" : "#7aa95c")));
      }
    }
  }
  return merge(parts);
}

function Motes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.SphereGeometry(0.03, 6, 4), []);
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffd9b8", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const seeds = useMemo(() => Array.from({ length: MOTES }, (_, i) => ({ a: (i / MOTES) * Math.PI * 2, r: 0.5 + ((i * 37) % 11) / 11, speed: 0.12 + ((i * 13) % 7) / 40, phase: (i * 0.61) % 1 })), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    seeds.forEach((sd, i) => {
      const life = (sd.phase + t * sd.speed) % 1;
      const a = sd.a + t * 0.15;
      const y = DAIS.h + 0.3 + life * 2.8;
      const s = Math.sin(life * Math.PI) * (0.6 + 0.6 * meadow.night) + 0.0001;
      m.makeScale(s, s, s).setPosition(Math.cos(a) * sd.r, y, Math.sin(a) * sd.r);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MOTES]} frustumCulled={false} renderOrder={3} />;
}

export function DaisRose({ quality }: { quality: Quality }) {
  const rose = useMemo(
    () =>
      buildFlowerPlant(
        { speciesId: "rose", seed: OWNER_SEED, growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0 },
        { petals: quality, leaves: "lite" },
      ),
    [quality],
  );
  const garnish = useMemo(() => garnishGeometry(), []);
  const grain = useMemo(() => {
    const t = grainTexture("#e6dac4", "#f4ecdc", "#cbbda4", 5, 1);
    t.repeat.set(3, 1);
    return t;
  }, []);
  const moss = useMemo(() => {
    const t = grainTexture("#4c7a42", "#6a9a55", "#36592f", 9, 1);
    t.repeat.set(3, 3);
    return t;
  }, []);
  useEffect(
    () => () => {
      rose.dispose();
      garnish.dispose();
      grain.dispose();
      moss.dispose();
    },
    [rose, garnish, grain, moss],
  );
  const sway = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = sway.current;
    if (g) {
      g.rotation.z = 0.012 * Math.sin(t * 0.7) + 0.006 * Math.sin(t * 1.9);
      g.rotation.x = 0.01 * Math.cos(t * 0.55);
    }
    applyPlantEnv(rose, meadow.plantEnv, meadow.plantEnvStrength);
    const ei = petalGlow("rose", meadow.night, 1, 1, t);
    for (const mat of rose.petalMats) mat.emissiveIntensity = ei;
    rose.budMat.emissiveIntensity = ei * 0.3;
    const l = glow.current;
    if (l) l.intensity = 0.4 + 5 * meadow.night;
  });

  const tierH = DAIS.h / 2;
  return (
    <group>
      {/* two tiers of warm stone, each with a rounded moulding at its edge */}
      <mesh position={[0, tierH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[DAIS.r, DAIS.r + 0.08, tierH, 72]} />
        <meshStandardMaterial color={STONE} map={grain} roughness={0.8} />
      </mesh>
      <mesh position={[0, tierH, 0]} rotation-x={Math.PI / 2} castShadow receiveShadow>
        <torusGeometry args={[DAIS.r - 0.04, 0.06, 6, 96]} />
        <meshStandardMaterial color={STONE_2} roughness={0.7} />
      </mesh>
      <mesh position={[0, tierH * 1.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[DAIS.r - 0.48, DAIS.r - 0.42, tierH, 72]} />
        <meshStandardMaterial color={STONE_2} map={grain} roughness={0.8} />
      </mesh>
      <mesh position={[0, DAIS.h, 0]} rotation-x={Math.PI / 2} castShadow receiveShadow>
        <torusGeometry args={[DAIS.r - 0.5, 0.055, 6, 96]} />
        <meshStandardMaterial color={STONE} roughness={0.7} />
      </mesh>
      {/* the mossy bed and its garnish */}
      <mesh position={[0, DAIS.h, 0]} scale={[BED_R, BED_H, BED_R]} receiveShadow>
        <sphereGeometry args={[1, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial map={moss} roughness={0.95} />
      </mesh>
      <mesh geometry={garnish} position={[0, DAIS.h, 0]} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <group ref={sway} position={[0, DAIS.h + BED_H - 0.06, 0]} scale={ROSE_SCALE}>
        <primitive object={rose.group} />
        <pointLight ref={glow} position={[rose.head.x, rose.head.y, rose.head.z]} color="#ff5d74" intensity={0.4} distance={6} decay={2} />
      </group>
      <Motes />
    </group>
  );
}
