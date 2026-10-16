"use client";
// The mid and far garden: hedges and shrubs, the vine-covered bentwood arch,
// the weathered fence, the trees and the bokeh glints behind them. Everything
// is placed once per owner by lib/garden/backdropGeometry from LAYOUT and the
// owner's seed; this file turns those assets into meshes, drives the foliage
// shader and the glints from the shared env each frame, and disposes it all.
//
// Foliage (canopy cards, hedge cards and leaves, vine leaves) shares one
// material patch: a per-instance "mass normal" blended into the shading normal
// so a cloud of flat cards lights like a rounded mass instead of a flicker of
// planes; a gentle wind sway in object space after the instance transform;
// no normal flip on back faces (leaves are thin); and the sun glowing through
// the foliage when it stands behind it. A depth twin with the same sway casts
// alpha-tested, moving shadows, so the dappled light under the trees drifts.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { env } from "@/lib/garden/env";
import { useGarden, type Quality } from "@/lib/garden/store";
import { SPECIES } from "@/lib/plant/species";
import { clamp01, smoothstep } from "@/lib/plant/prng";
import { leafTexture, petalTexture } from "@/lib/plant/textures";
import {
  applyInstances,
  barkBumpTexture,
  barkTexture,
  buildBackdrop,
  foliageFillTexture,
  leafClusterTexture,
  woodTexture,
  type BloomPalette,
  type Instanced,
} from "@/lib/garden/backdropGeometry";

// ---------------------------------------------------------------------------
// Foliage shader patch

/** Shared by every foliage program; written once per frame from env. */
const wind = { uTime: { value: 0 }, uWind: { value: 0.5 } };

const VERT_COMMON =
  "#include <common>\nuniform float uTime; uniform float uWind; uniform float uSway; uniform float uMass;\nattribute vec3 aMassNormal;";

// The mass normal is already in the mesh's object space, so the instance
// matrix must not be applied to it again: beginnormal computes the geometric
// instanced normal itself and defaultnormal is reduced to the normal matrix.
const BEGIN_NORMAL =
  "vec3 objectNormal = vec3( normal );\n" +
  "#ifdef USE_INSTANCING\n" +
  "{ vec3 gN = normalize( mat3( instanceMatrix ) * normal );\n" +
  "  objectNormal = normalize( mix( gN, aMassNormal, uMass ) ); }\n" +
  "#endif\n" +
  "#ifdef USE_TANGENT\n vec3 objectTangent = vec3( tangent.xyz );\n#endif";

const DEFAULT_NORMAL =
  "vec3 transformedNormal = normalMatrix * objectNormal;\n" +
  "#ifdef FLIP_SIDED\n transformedNormal = - transformedNormal;\n#endif\n" +
  "#ifdef USE_TANGENT\n vec3 transformedTangent = ( modelViewMatrix * vec4( objectTangent, 0.0 ) ).xyz;\n#endif";

// Sway after the instance transform (object space), phased by where the
// instance stands so neighbours move together but the mass ripples.
const SWAY_PROJECT = THREE.ShaderChunk.project_vertex.replace(
  "mvPosition = instanceMatrix * mvPosition;",
  "mvPosition = instanceMatrix * mvPosition;\n" +
    "{ vec3 ip = instanceMatrix[3].xyz;\n" +
    "  float ph = ip.x * 1.3 + ip.z * 0.9 + ip.y * 0.7;\n" +
    "  float gust = 0.55 + 0.45 * sin(uTime * 0.43 + ph * 0.5);\n" +
    "  float sx = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25;\n" +
    "  float sz = cos(uTime * 0.9 + ph * 1.3) * 0.5;\n" +
    "  float sy = sin(uTime * 1.7 + ph * 2.1) * 0.18;\n" +
    "  mvPosition.xyz += vec3(sx * 0.85, sy, sz) * gust * uWind * uSway; }",
);

const FRAG_COMMON = "#include <common>\nuniform float uBacklight;";
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "");
// The sun stands at directionalLights[0] (first in the scene): light shining
// through thin foliage toward the camera lifts the diffuse by a view-dependent
// term, strongest when the sun is low and straight behind the leaves.
const BACKLIGHT =
  "#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n" +
  "{ vec3 bV = normalize(vViewPosition); vec3 bL = directionalLights[0].direction;\n" +
  "  float back = pow(max(0.0, dot(-bV, bL)), 5.0);\n" +
  "  reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * back * uBacklight; }\n#endif";

interface FoliageOpts {
  map: THREE.Texture;
  /** 0 geometric normals .. 1 the mass normal */
  mass: number;
  /** sway amplitude in metres at wind 1 */
  sway: number;
  backlight: number;
  roughness: number;
  alphaTest: number;
}

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, sway: number, mass: number) {
  shader.uniforms.uTime = wind.uTime;
  shader.uniforms.uWind = wind.uWind;
  shader.uniforms.uSway = { value: sway };
  shader.uniforms.uMass = { value: mass };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", VERT_COMMON)
    .replace("#include <beginnormal_vertex>", BEGIN_NORMAL)
    .replace("#include <defaultnormal_vertex>", DEFAULT_NORMAL)
    .replace("#include <project_vertex>", SWAY_PROJECT);
}

function makeFoliageMaterial(o: FoliageOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: o.map,
    alphaTest: o.alphaTest,
    side: THREE.DoubleSide,
    roughness: o.roughness,
    metalness: 0,
    color: 0xffffff,
    shadowSide: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, o.sway, o.mass);
    shader.uniforms.uBacklight = { value: o.backlight };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FRAG_COMMON)
      .replace("#include <normal_fragment_begin>", NORMAL_NO_FLIP)
      .replace("#include <lights_fragment_end>", BACKLIGHT);
  };
  m.customProgramCacheKey = () => "backdrop-foliage";
  return m;
}

/** Shadow-pass twin: the same sway, alpha-tested against the same map. */
function makeFoliageDepthMaterial(map: THREE.Texture, alphaTest: number, sway: number): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => patchVertex(shader, sway, 0);
  m.customProgramCacheKey = () => "backdrop-foliage-depth";
  return m;
}

// ---------------------------------------------------------------------------
// Bokeh glints

type BokehUniforms = {
  uTime: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uFocus: THREE.IUniform<number>;
  uDay: THREE.IUniform<number>;
  uNight: THREE.IUniform<number>;
  uSize: THREE.IUniform<number>;
  uMaxSize: THREE.IUniform<number>;
  uDayColor: THREE.IUniform<THREE.Color>;
  uNightColor: THREE.IUniform<THREE.Color>;
};

// Each glint is a bright point deep in the backdrop. Its sprite grows with its
// thin-lens circle of confusion against the flower head's focus distance, so
// the far points draw as the rimmed discs a macro lens makes of them.
const BOKEH_VERTEX = /* glsl */ `
  uniform float uTime; uniform float uPixelRatio; uniform float uFocus;
  uniform float uDay; uniform float uNight; uniform float uSize; uniform float uMaxSize;
  attribute float aSize; attribute float aKind; attribute float aSeed;
  varying float vAlpha; varying float vKind; varying float vCoc;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = max(0.1, -mv.z);
    float coc = clamp(abs(depth - uFocus) / depth * 2.0, 0.0, 1.0);
    float tw = 0.7 + 0.3 * sin(uTime * (0.5 + aSeed * 1.1) + aSeed * 37.0);
    float strength = mix(uDay, uNight, aKind) * tw;
    float px = uSize * aSize * uPixelRatio / depth * (1.0 + coc * 10.0);
    gl_PointSize = clamp(px, 1.0, uMaxSize * uPixelRatio);
    vAlpha = strength / (1.0 + coc * 1.6);
    vCoc = coc;
    vKind = aKind;
    gl_Position = projectionMatrix * mv;
  }
`;

const BOKEH_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uDayColor; uniform vec3 uNightColor;
  varying float vAlpha; varying float vKind; varying float vCoc;
  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float r = length(c);
    float disc = smoothstep(1.0, 0.86, r) * (0.5 + 0.5 * smoothstep(0.4, 0.95, r));
    float core = exp(-r * r * 4.0);
    float a = mix(core, disc, vCoc) * (1.0 - smoothstep(0.92, 1.0, r));
    vec3 col = mix(uDayColor, uNightColor, vKind) * 2.2;
    gl_FragColor = vec4(col, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLINT_WARM = new THREE.Color("#fff1c8");
const GLINT_NIGHT = new THREE.Color("#ffb45a");
const focusScratch = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Pieces

interface SetProps {
  of: Instanced;
  material: THREE.Material;
  depth?: THREE.Material;
  castShadow: boolean;
}

/** One InstancedMesh filled from an instance set. */
function Instances({ of, material, depth, castShadow }: SetProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { set, geometry } = of;
  useLayoutEffect(() => {
    if (ref.current) applyInstances(ref.current, set);
  }, [set]);
  if (set.count === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, set.count]}
      customDepthMaterial={depth}
      castShadow={castShadow}
      receiveShadow
    />
  );
}

function bloomMaterial(p: BloomPalette, emissive: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: petalTexture({ base: p.base, mid: p.mid, tip: p.tip, vein: p.vein, veins: 5, seed: 2, fade: 0, burn: 0 }),
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: 0.08,
  });
}

// ---------------------------------------------------------------------------

const SWAY: Record<Quality, number> = { cinematic: 1, balanced: 1, lite: 0.6 };
/** The hedge cores show more between the cards on lite, so they are lifted toward the card greens. */
const CORE_TINT: Record<Quality, THREE.Color> = {
  cinematic: new THREE.Color(1, 1, 1),
  balanced: new THREE.Color(1.15, 1.15, 1.05),
  lite: new THREE.Color(1.7, 1.75, 1.3),
};

export function Backdrop() {
  const seed = useGarden((s) => s.seed);
  const quality = useGarden((s) => s.quality);
  const speciesId = useGarden((s) => s.speciesId);
  const heroHex = SPECIES[speciesId].flower.colorMid;

  const assets = useMemo(() => buildBackdrop(seed, quality, heroHex), [seed, quality, heroHex]);
  useEffect(() => () => assets.dispose(), [assets]);
  const shadows = assets.budget.shadows;

  const mats = useMemo(() => {
    const sway = SWAY[quality];
    const tree0 = leafClusterTexture("tree", 1);
    const tree1 = leafClusterTexture("tree", 2);
    const hedge = leafClusterTexture("hedge", 1);
    const leaf = leafTexture({ base: "#2d6a2a", tip: "#7cc050", vein: "#a8d884", seed: 2, fade: 0, burn: 0 });
    const canopyOpts = { mass: 0.85, sway: 0.05 * sway, backlight: 0.4, roughness: 0.78, alphaTest: 0.45 };
    const hedgeOpts = { mass: 0.72, sway: 0.012 * sway, backlight: 0.3, roughness: 0.72, alphaTest: 0.45 };
    return {
      canopy: [makeFoliageMaterial({ map: tree0, ...canopyOpts }), makeFoliageMaterial({ map: tree1, ...canopyOpts })],
      canopyDepth: [
        makeFoliageDepthMaterial(tree0, 0.45, canopyOpts.sway),
        makeFoliageDepthMaterial(tree1, 0.45, canopyOpts.sway),
      ],
      hedgeCard: makeFoliageMaterial({ map: hedge, ...hedgeOpts }),
      hedgeCardDepth: makeFoliageDepthMaterial(hedge, 0.45, hedgeOpts.sway),
      hedgeLeaf: makeFoliageMaterial({ map: leaf, mass: 0.6, sway: 0.014 * sway, backlight: 0.35, roughness: 0.6, alphaTest: 0 }),
      vineLeaf: makeFoliageMaterial({ map: leaf, mass: 0.35, sway: 0.02 * sway, backlight: 0.45, roughness: 0.55, alphaTest: 0 }),
      core: new THREE.MeshStandardMaterial({
        map: foliageFillTexture(1),
        roughness: 0.95,
        metalness: 0,
        color: CORE_TINT[quality],
      }),
      bark: new THREE.MeshStandardMaterial({
        map: barkTexture(1),
        bumpMap: barkBumpTexture(1),
        bumpScale: 0.6,
        roughness: 0.92,
        metalness: 0,
      }),
      wood: new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 0.88, metalness: 0, color: 0xffffff }),
      vine: new THREE.MeshStandardMaterial({ color: "#4a5a2a", roughness: 0.75, metalness: 0 }),
      shrubFloret: bloomMaterial(assets.shrubFloretPalette, "#fff3d0"),
      archBloom: bloomMaterial(assets.arch.bloomPalette, assets.arch.bloomPalette.mid),
    };
  }, [quality, assets.shrubFloretPalette, assets.arch.bloomPalette]);

  useEffect(
    () => () => {
      for (const m of mats.canopy) m.dispose();
      for (const m of mats.canopyDepth) m.dispose();
      mats.hedgeCard.dispose();
      mats.hedgeCardDepth.dispose();
      mats.hedgeLeaf.dispose();
      mats.vineLeaf.dispose();
      mats.core.dispose();
      mats.bark.dispose();
      mats.wood.dispose();
      mats.vine.dispose();
      mats.shrubFloret.dispose();
      mats.archBloom.dispose();
    },
    [mats],
  );

  const bokeh = useMemo(() => {
    const uniforms: BokehUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uFocus: { value: 3 },
      uDay: { value: 0 },
      uNight: { value: 0 },
      uSize: { value: 26 },
      uMaxSize: { value: 120 },
      uDayColor: { value: new THREE.Color("#fff1c8") },
      uNightColor: { value: GLINT_NIGHT.clone() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: BOKEH_VERTEX,
      fragmentShader: BOKEH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { uniforms, material };
  }, []);
  useEffect(() => () => bokeh.material.dispose(), [bokeh]);
  const pointsRef = useRef<THREE.Points>(null);

  /* eslint-disable react-hooks/immutability -- the memoised uniforms are three.js
     objects the frame loop drives imperatively; React never re-renders on them. */
  useFrame((state) => {
    wind.uTime.value = env.time;
    wind.uWind.value = env.wind;

    const u = bokeh.uniforms;
    const day = (1 - env.nightness) * clamp01(env.sky.sunIntensity / 2.4) * (1 - 0.85 * env.cloud) * (1 - 0.7 * env.rain);
    const night = smoothstep(0.45, 0.9, env.nightness) * (1 - 0.5 * env.rain);
    const points = pointsRef.current;
    const visible = day + night > 0.01;
    if (points) points.visible = visible;
    if (!visible) return;
    u.uTime.value = env.time;
    u.uDay.value = day;
    u.uNight.value = night;
    u.uDayColor.value.copy(env.sky.sun).lerp(GLINT_WARM, 0.35);
    u.uPixelRatio.value = state.gl.getPixelRatio();
    focusScratch.copy(env.headPos).applyMatrix4(state.camera.matrixWorldInverse);
    u.uFocus.value = Math.max(0.2, -focusScratch.z);
  });
  /* eslint-enable react-hooks/immutability */

  const arch = assets.arch;
  const fence = assets.fence;
  const legs: Instanced = { set: arch.legs, geometry: arch.leg };
  const rungs: Instanced = { set: arch.rungs, geometry: arch.rung };
  const pickets: Instanced = { set: fence.pickets, geometry: fence.picket };
  const posts: Instanced = { set: fence.posts, geometry: fence.post };
  const rails: Instanced = { set: fence.rails, geometry: fence.rail };

  return (
    <group name="backdrop">
      {/* trees: every trunk and branch in one mesh, the canopies in one InstancedMesh per cluster texture */}
      <mesh geometry={assets.wood} material={mats.bark} castShadow={shadows} receiveShadow />
      {assets.canopies.map((c, k) => (
        <Instances key={k} of={c} material={mats.canopy[k]} depth={mats.canopyDepth[k]} castShadow={shadows} />
      ))}

      {/* hedges and shrubs */}
      <mesh geometry={assets.hedgeCores} material={mats.core} castShadow={shadows} receiveShadow />
      <Instances of={assets.hedgeCards} material={mats.hedgeCard} depth={mats.hedgeCardDepth} castShadow={shadows} />
      {/* The cards and cores already cast the hedges' shadows; the single leaves only fuzz the silhouette. */}
      <Instances of={assets.hedgeLeaves} material={mats.hedgeLeaf} castShadow={false} />
      <Instances of={assets.shrubFlorets} material={mats.shrubFloret} castShadow={false} />

      <group position={arch.center} rotation-y={arch.yaw}>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            geometry={arch.hoop}
            material={mats.wood}
            position={[0, arch.legHeight, (side * arch.depth) / 2]}
            castShadow={shadows}
            receiveShadow
          />
        ))}
        <Instances of={legs} material={mats.wood} castShadow={shadows} />
        <Instances of={rungs} material={mats.wood} castShadow={shadows} />
        <mesh geometry={arch.vines} material={mats.vine} castShadow={shadows} receiveShadow />
        <Instances of={arch.leaves} material={mats.vineLeaf} castShadow={false} />
        <Instances of={arch.blooms} material={mats.archBloom} castShadow={false} />
      </group>

      <Instances of={pickets} material={mats.wood} castShadow={shadows} />
      <Instances of={posts} material={mats.wood} castShadow={shadows} />
      <Instances of={rails} material={mats.wood} castShadow={shadows} />

      <points ref={pointsRef} geometry={assets.bokeh} material={bokeh.material} frustumCulled={false} />
    </group>
  );
}
