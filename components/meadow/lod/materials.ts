// The detail levels' materials, all the Meadow's ordinary MeshStandardMaterial underneath (so the sun, the sky light,
// the haze and the shadows treat them like everything else) with a few lines added:
//
// - near (L1): instanced vertex-coloured plants that rock in the breeze about their foot exactly as the visited plant
//   does (same clock, same phase by plot), a poorly plant's leaves paling toward straw while its flower keeps its
//   colour, the flower's own glow by night, and a dissolve (`aFade`) for the swap with its picture. Its shadow pass
//   rocks and dissolves with it, and leaves the flower out: a head held high threw a dark disc on the bed that read as
//   a hole (as Plants.tsx's heads never cast one either), while the stem and leaves still cast.
// - far (L2): one card per plant showing its cell of the atlas, turned to face the camera and bent at the plant's
//   foot: above the foot it stands upright where the stem stands, below it it lies on the soil toward the camera,
//   where the leaves that reach toward the camera are in the picture. So the picture sits at the plant's own depth
//   (its head where the head is, not flattened onto the foot's distance, which shifts it in perspective), stays the
//   right height as the camera tips up or down (the pictures were taken from 45 degrees), and never sinks into the
//   soil. Where the flower begins the card bends again: the flower lies back to face a camera looking down more
//   steeply than the picture was taken (the overview) and opens up by as much, so a bloom keeps its round face instead of
//   flattening, while the stem below keeps its true height so the head stays where the light plant holds it. A plant
//   only a few dozen pixels tall (across the rings, the overview) holds its flower up larger, as the Meadow's old
//   stand-ins did, so a bed of blooms still reads as flowers from across the Meadow; by the size its light plant takes
//   over it is true to size. The upright part leans and rocks like the plant. The colour atlas is premultiplied (its margins never filter in black) and un-premultiplied here;
//   the normal atlas lights each picture per pixel as the plant would be lit; its glow channel lights the flower by
//   night and tells flower from foliage for the tint. Its shadow is the same card turned to the sun (in the shadow
//   pass the camera is the sun), so a far plant casts the shadow its light plant casts; it takes its own shade from
//   its axis a little toward the sun, so it is shaded by everything round it but never by its own shadow card.
//
// The dissolves: a plant changing level, and the plant being visited handing over to its full plant
// (VisitedPlant.tsx), split the plant's pixels between the levels with one ordered 4x4 threshold, each level drawing
// its own share of the sixteen steps, so together they always cover the plant exactly once. The pattern is pinned to
// where the plant's foot falls on screen, so it travels with the plant instead of crawling over it as the cart moves.
import * as THREE from "three";
import { SPECIES, type SpeciesId } from "@/lib/plant/species";

export interface LodUniforms {
  uTime: { value: number };
  uNight: { value: number };
  /** the drawing buffer's size in pixels, for pinning the dissolve's pattern to each plant */
  uLodRes: { value: THREE.Vector2 };
  /** the sun's (or moon's) light, world position: a far plant's shade is looked up a little toward it */
  uLightPos: { value: THREE.Vector3 };
  /**
   * How much of the sun a picture's foliage takes: 1 where plants cast no shadows, less where they do, for the shade a
   * light plant's leaves cast on each other that a flat picture cannot (see SELF_SHADE).
   */
  uSelfShade: { value: number };
  /**
   * How much of the plant environment's soft light (meadow.plantEnv, the light the full plants' petals and leaves are
   * dressed in) the foliage (x) and the flower (y) take, at this hour's strength.
   */
  uEnvK: { value: THREE.Vector2 };
}

/** The drawing buffer's size, shared by every dissolving material (LodPlants.tsx keeps it current). */
export const LOD_SCREEN = { value: new THREE.Vector2(1, 1) };

export function lodUniforms(): LodUniforms {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uLodRes: LOD_SCREEN,
    uLightPos: { value: new THREE.Vector3(0, 100, 0) },
    uSelfShade: { value: 1 },
    uEnvK: { value: new THREE.Vector2(ENV_FOLIAGE, ENV_FLOWER) },
  };
}

/**
 * The plant environment's share for the detail levels' foliage and flowers, matched to the full plant's look (its
 * textured petals and leaves take 0.8 and 0.45 of it, and a sheen, flowerPlant.ts / garden materials): with them a
 * light plant is as bright as the full plant that dissolves in over it.
 */
export const ENV_FOLIAGE = 0.3;
export const ENV_FLOWER = 0.5;

/**
 * The share of the sun a picture's foliage takes where plants cast shadows: a light plant's upper leaves shade its
 * lower ones (more with the sun high), so its pictures, lit flat, take less direct sun to stay as bright as it is.
 * Measured against the light plants at noon, golden hour, dusk and night. The flower, held above the leaves, takes
 * all of it.
 */
export const SELF_SHADE = 0.3;

/**
 * A picture's foliage by night, against its light plant's: lit mostly by the sky then, a picture's leaves (their
 * normals averaged a pixel at a time lean toward the open sky) catch more of it than the leaves themselves do.
 */
export const NIGHT_FOLIAGE = 0.8;

// The plant environment's light, scaled per pixel: foliage and flower take different shares of it.
const ENV_SCALE = /* glsl */ `
#include <lights_fragment_maps>
float lodEnvK = mix(uEnvK.x, uEnvK.y, lodEnvFlower);
iblIrradiance *= lodEnvK;
radiance *= lodEnvK;`;

/** How brightly a species' flowers glow at this hour: the Meadow's flower heads' rule, never quite dark. */
export function flowerGlow(id: SpeciesId, night: number, time: number): number {
  const f = SPECIES[id].flower;
  const pulse = SPECIES[id].fx.pulse ? 0.8 + 0.2 * Math.sin(time * 1.4) : 1;
  return Math.max(0.24, (f.emissiveDay * 1.5 + (f.emissiveNight * 0.9 - f.emissiveDay * 1.5) * night) * pulse);
}

// The dissolve's threshold: a 4x4 ordered (Bayer) pattern, the most even split of a few pixels between two pictures
// (half and half is a fine checker), in sixteen steps.
const DITHER = /* glsl */ `
float lodDither(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[q.x + q.y * 4] + 0.5) / 16.0;
}
`;

// Where a plant's foot falls on screen, in whole pixels: the dissolve's pattern is pinned there.
const ANCHOR = /* glsl */ `
uniform vec2 uLodRes;
varying vec2 vLodAnchor;
vec2 lodAnchor(vec3 foot) {
  vec4 c = projectionMatrix * viewMatrix * vec4(foot, 1.0);
  return floor((c.xy / max(c.w, 1e-4) * 0.5 + 0.5) * uLodRes);
}
`;

// A poorly plant's leaves pale toward straw of the same lightness; a thriving one is a touch brighter; the flower keeps
// its colour.
const TINT = /* glsl */ `
vec3 lodTint(vec3 c, vec4 tint, float flower) {
  c *= mix(tint.rgb, vec3(1.0), flower);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, l * vec3(1.45, 1.25, 0.55), tint.a * (1.0 - flower));
}
`;

// The breeze: the plant rocks about its foot round the axis along its row, as VisitedPlant.tsx rocks the full plant.
const SWAY = /* glsl */ `
vec3 lodSway(vec3 d, vec2 sway, float t) {
  float ang = 0.02 * sin(t * 0.9 + sway.x) + 0.008 * sin(t * 2.1);
  vec3 ax = vec3(-sin(sway.y), 0.0, cos(sway.y));
  float c = cos(ang), s = sin(ang);
  return d * c + cross(ax, d) * s + ax * dot(ax, d) * (1.0 - c);
}
`;

const NEAR_PROJECT = /* glsl */ `
vec4 lodWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vec3 lodFoot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
lodWorld.xyz = lodFoot + lodSway(lodWorld.xyz - lodFoot, aSway, uTime);
vec4 mvPosition = viewMatrix * lodWorld;
gl_Position = projectionMatrix * mvPosition;
`;

/** The light plants' material for one species: `glow` is the species' flower glow, set each frame. */
export function nearMaterial(u: LodUniforms, glow: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uGlow = glow;
    shader.uniforms.uLodRes = u.uLodRes;
    shader.uniforms.uEnvK = u.uEnvK;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float glow;
attribute vec2 aFade;
attribute vec4 aTint;
attribute vec2 aSway;
uniform float uTime;
varying float vGlow;
varying vec2 vFade;
${ANCHOR}
${SWAY}
${TINT}`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
vColor.rgb = lodTint(vColor.rgb, aTint, step(0.01, glow));
vGlow = glow;
vFade = aFade;`,
      )
      .replace("#include <project_vertex>", `${NEAR_PROJECT}\nvLodAnchor = lodAnchor(lodFoot);`)
      .replace(
        "#include <worldpos_vertex>",
        `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = lodWorld;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uGlow;
uniform vec2 uEnvK;
varying float vGlow;
varying vec2 vFade;
varying vec2 vLodAnchor;
${DITHER}`,
      )
      .replace("#include <lights_fragment_maps>", `float lodEnvFlower = step(0.01, vGlow);\n${ENV_SCALE}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float lodN = lodDither(gl_FragCoord.xy - vLodAnchor);
if (lodN < vFade.x || lodN >= vFade.y) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * vGlow * uGlow;`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-lod-near";
  return mat;
}

/** The light plants' shadow: rocking and dissolving with them, the stem and leaves only. */
export function nearDepthMaterial(u: LodUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float glow;
attribute vec2 aFade;
attribute vec2 aSway;
uniform float uTime;
varying vec2 vFade;
varying float vLodGlow;
${SWAY}`,
      )
      .replace("#include <project_vertex>", `${NEAR_PROJECT}\nvFade = aFade;\nvLodGlow = glow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vFade;
varying float vLodGlow;
${DITHER}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
// the flower (every part of it glows a little) casts no shadow
if (vLodGlow > 0.01) discard;
float lodN = lodDither(gl_FragCoord.xy);
if (lodN < vFade.x || lodN >= vFade.y) discard;`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-lod-near-depth";
  return mat;
}

/**
 * The pictures' card: four rows of two (position.y 0 the front edge on the soil, 1 the foot, 2 where the flower
 * begins, 3 the top; x 0 left, 1 right), three quads.
 */
export function cardGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  for (let row = 0; row < 4; row++) pos.push(0, row, 0, 1, row, 0);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const idx: number[] = [];
  for (let row = 0; row < 3; row++) {
    const a = row * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  g.setIndex(idx);
  return g;
}

const FAR_ATTRIBUTES = /* glsl */ `
attribute vec3 aBase;
attribute vec3 aTilt;
attribute vec4 aCard;
attribute vec4 aUv;
attribute vec4 aTint;
attribute vec4 aMisc;
attribute vec3 aGlow;
attribute float aFade;
uniform float uTime;
uniform vec3 uBake;
varying float vFade;
// the card's lower part lies this far over the soil, clear of it in the depth buffer
#define LOD_LIFT 0.02
// how much larger a small plant's flower is held up, and between which heights on screen (pixels) it returns to size
#define LOD_GROW 1.5
#define LOD_GROW_PX vec2(24.0, 64.0)
${SWAY}
// turns v the way the plant leans: the rotation taking straight up to t
vec3 lodLean(vec3 v, vec3 t) {
  vec3 a = vec3(t.z, 0.0, -t.x);
  float s2 = dot(a, a);
  if (s2 < 1e-8) return v;
  return v * t.y + cross(a, v) + a * (dot(a, v) * (1.0 - t.y) / s2);
}`;

/**
 * The card laid out for one plant. In the shadow pass (`shadow`) the camera is the sun: the card turns to face it
 * and stands straight, and the part on the soil is folded away (it would only shade the soil it lies on).
 */
function farCard(shadow: boolean): string {
  return /* glsl */ `
float lodU = position.x;
// facing the camera (or the sun) across the ground
vec3 lodToCam = cameraPosition - aBase;
vec3 lodF = normalize(vec3(lodToCam.x, 0.0, lodToCam.z) + vec3(1e-4, 0.0, 0.0));
vec3 lodR = vec3(lodF.z, 0.0, -lodF.x);
float lodScale = aMisc.z;
// metres of upright card per unit of the picture's height (the picture saw the plant at uBake's elevation)
float lodH = aCard.y * lodScale / uBake.x;
vec3 lodOff = (lodU - aCard.z) * aCard.x * lodScale * lodR;
float lodV;
if (position.y < 0.5) {
  // the front edge, on the soil toward the camera: the picture saw this ground at 45 degrees
  lodV = 0.0;
  ${shadow ? "lodOff.y += LOD_LIFT;" : "lodOff += lodF * (aCard.w * aCard.y * lodScale / uBake.y) + vec3(0.0, LOD_LIFT, 0.0);"}
} else if (position.y < 1.5) {
  lodV = aCard.w;
  lodOff.y += LOD_LIFT;
} else {
  // upright over the foot as the stem stands, up to where the flower begins
  float lodBend = aMisc.w;
  lodV = position.y < 2.5 ? lodBend : 1.0;
  ${shadow ? "float lodGrow = 1.0;" : `// a plant small on screen holds its flower up larger (true to size by the time its light plant takes over)
  float lodDepth = max(0.1, -(viewMatrix * vec4(aBase, 1.0)).z);
  float lodPx = (1.0 - aCard.w) * lodH / lodDepth * projectionMatrix[1][1] * uLodRes.y * 0.5;
  float lodGrow = mix(LOD_GROW, 1.0, smoothstep(LOD_GROW_PX.x, LOD_GROW_PX.y, lodPx));`}
  lodOff *= lodGrow;
  lodOff.y += LOD_LIFT + (lodBend - aCard.w) * lodH;
  if (position.y > 2.5) {
    // the flower, lying back to face a camera looking down more steeply than the picture was taken (leaning forward
    // for a lower one), so it keeps its shape (a length turned so keeps its height on screen), and opening up (or
    // closing) as a face seen from higher (or lower) does
    float lodElev = atan(lodToCam.y, length(lodToCam.xz));
    float lodTurn = ${shadow ? "0.0" : "clamp(uBake.z - lodElev, -0.7, 0.35)"};
    float lodFace = ${shadow ? "1.0" : "clamp(sin(lodElev) / uBake.y, 0.85, 1.3)"};
    lodOff += (vec3(0.0, cos(lodTurn), 0.0) + lodF * sin(lodTurn)) * ((1.0 - lodBend) * lodH * lodGrow * lodFace);
  }
  // leaning and rocking with the plant
  lodOff = lodSway(lodLean(lodOff, aTilt), aMisc.xy, uTime);
}
vec3 transformed = aBase + lodOff;
// fully handed to its light plant (or its full plant): nothing to draw
if (aFade > 0.999) transformed = aBase;
#ifdef USE_MAP
vMapUv = aUv.xy + vec2(lodU, lodV) * aUv.zw;
#endif
vFade = aFade;`;
}

/** The bake elevation's cosine, sine and angle, for the cards' layout. */
const bakeUniform = (bake: number) => ({ value: new THREE.Vector3(Math.cos(bake), Math.sin(bake), bake) });

/** The pictures' material: `bake` is the elevation the atlas was drawn from, radians. */
export function farMaterial(u: LodUniforms, albedo: THREE.Texture, normals: THREE.Texture, bake: number): THREE.MeshStandardMaterial {
  // (its shadow card faces the sun, which the shadow pass would cull as a back face)
  const mat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.72, metalness: 0, alphaTest: 0.35, alphaToCoverage: true, shadowSide: THREE.DoubleSide });
  const bakeTrig = bakeUniform(bake);
  const normalMap = { value: normals };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uNight = u.uNight;
    shader.uniforms.uBake = bakeTrig;
    shader.uniforms.uNormalAtlas = normalMap;
    shader.uniforms.uLodRes = u.uLodRes;
    shader.uniforms.uLightPos = u.uLightPos;
    shader.uniforms.uSelfShade = u.uSelfShade;
    shader.uniforms.uEnvK = u.uEnvK;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${FAR_ATTRIBUTES}
uniform float uNight;
uniform vec3 uLightPos;
varying float vGlowI;
varying vec4 vTint;
${ANCHOR}`,
      )
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(cameraPosition - aBase);")
      .replace(
        "#include <begin_vertex>",
        `${farCard(false)}
vLodAnchor = lodAnchor(aBase);
vTint = aTint;
vGlowI = max(0.24, mix(aGlow.x * 1.5, aGlow.y * 0.9, uNight) * (aGlow.z > 0.5 ? 0.8 + 0.2 * sin(uTime * 1.4) : 1.0));`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
#ifdef USE_SHADOWMAP
// its shade, from its own axis at this height a hand's breadth toward the sun: shaded by everything round it, never by
// its own shadow card
vec3 lodSun = normalize(vec3(uLightPos.x - aBase.x, 0.0, uLightPos.z - aBase.z) + vec3(1e-4, 0.0, 0.0));
worldPosition = vec4(aBase.x, transformed.y, aBase.z, 1.0) + vec4(lodSun * 0.12, 0.0);
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uNormalAtlas;
uniform float uSelfShade;
uniform float uNight;
uniform vec2 uEnvK;
varying float vFade;
varying float vGlowI;
varying vec4 vTint;
varying vec2 vLodAnchor;
${DITHER}
${TINT}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (lodDither(gl_FragCoord.xy - vLodAnchor) < vFade) discard;`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 lodTexel = texture2D(map, vMapUv);
vec3 lodNG = texture2D(uNormalAtlas, vMapUv).xyz;
float lodFlower = smoothstep(0.02, 0.15, lodNG.z);
// the atlas is premultiplied sRGB: back to straight colour, then to linear light
vec3 lodColor = pow(lodTexel.rgb / max(lodTexel.a, 0.004), vec3(2.2));
diffuseColor.rgb *= lodTint(lodColor, vTint, lodFlower) * mix(1.0, ${NIGHT_FOLIAGE.toFixed(3)}, uNight * (1.0 - lodFlower));
diffuseColor.a *= lodTexel.a;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec2 lodNxy = lodNG.xy * 2.0 - 1.0;
normal = normalize(vec3(lodNxy, sqrt(max(0.0, 1.0 - dot(lodNxy, lodNxy)))));`,
      )
      .replace("#include <lights_fragment_maps>", `float lodEnvFlower = lodFlower;\n${ENV_SCALE}`)
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
float lodSun = mix(uSelfShade, 1.0, lodFlower);
reflectedLight.directDiffuse *= lodSun;
reflectedLight.directSpecular *= lodSun;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * lodNG.z * vGlowI;`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-lod-far";
  return mat;
}

/**
 * The pictures' shadow: each card turned to the sun, cut out by its picture's coverage (the shadow pass hands this
 * material the colour atlas and its alpha test from farMaterial), without the flower (as the light plants' shadows,
 * told by the normal atlas's glow, set into `normals` once it has loaded), and dissolving against its light plant's
 * shadow.
 */
export function farDepthMaterial(u: LodUniforms, bake: number, normals: { value: THREE.Texture | null }): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  const bakeTrig = bakeUniform(bake);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uBake = bakeTrig;
    shader.uniforms.uNormalAtlas = normals;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FAR_ATTRIBUTES}`)
      .replace("#include <begin_vertex>", farCard(true));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform sampler2D uNormalAtlas;\nvarying float vFade;\n${DITHER}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (lodDither(gl_FragCoord.xy) < vFade) discard;
#ifdef USE_MAP
if (texture2D(uNormalAtlas, vMapUv).z > 0.08) discard;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-lod-far-depth";
  return mat;
}

/**
 * The full plant's side of the visit's handover (VisitedPlant.tsx): its share of the dissolve and where its foot
 * stands, shared by every material of the one plant being visited.
 */
export const FULL_PLANT_DISSOLVE = {
  uLodShare: { value: 0 },
  uLodFoot: { value: new THREE.Vector3() },
};

/**
 * Adds the handover's dissolve to one of the full plant's materials as it compiles: it draws the first `uLodShare`
 * of the steps, where its light plant and its picture draw the rest (LodPlants.tsx).
 */
export function patchFullPlant(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uLodShare = FULL_PLANT_DISSOLVE.uLodShare;
  shader.uniforms.uLodFoot = FULL_PLANT_DISSOLVE.uLodFoot;
  shader.uniforms.uLodRes = LOD_SCREEN;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nuniform vec3 uLodFoot;\n${ANCHOR}`)
    .replace("#include <project_vertex>", "#include <project_vertex>\nvLodAnchor = lodAnchor(uLodFoot);");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nuniform float uLodShare;\nvarying vec2 vLodAnchor;\n${DITHER}`)
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
if (lodDither(gl_FragCoord.xy - vLodAnchor) >= uLodShare) discard;`,
    );
}

/** The full plant's shadow through the handover, dissolving against its light plant's shadow. */
export function fullPlantDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLodShare = FULL_PLANT_DISSOLVE.uLodShare;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uLodShare;\n${DITHER}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (lodDither(gl_FragCoord.xy) >= uLodShare) discard;`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-lod-full-depth";
  return mat;
}
