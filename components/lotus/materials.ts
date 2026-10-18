"use client";
// The lotus's materials (art direction 10.5), cached by key and never disposed, like components/garden/materials.
// The leaves, stalks, mud and urli take the garden's light patch (lib/garden/dressing withGardenLight): the lite
// tier's stand-in for the lantern, and on the urli the golden-hour rim. Two are shaders of their own:
// - the water: a standard material (so it takes the sun, its shadows and the lamp) whose reflection is a faked
//   environment chosen by the reflected ray's elevation, because from the garden's cameras the plant, the lantern
//   and the sun all mirror to points in front of the bowl (section 3.1): the hedge low, canopy and sky gaps higher.
//   Ripples follow the wind, rain draws rings, a dark meniscus edges the wall and every floating leaf, and green
//   water thickens toward pea soup without ever turning murky brown (3.3);
// - the light play on the far inner wall: sunlight thrown up off the rippled water (3.5), additive.
// v2 adds the pond's: its surface (a planar reflection over a faked courtyard surround, the breeze's ripples, rain and
// koi rings, the meniscus round the leaves and stalks), the underwater patch every submerged part shares (depth fade,
// caustics, the refraction lift), the pot and its pebbles, the koi's skins and fins, and the marginal sweet flag (the
// river's reeds). The tank's basin and the rest of the courtyard are courtyard/materials.ts's.
import * as THREE from "three";
import { withGardenLight } from "@/lib/garden/dressing";
import { leafNormalTexture, leafTexture, shiftHex, stemTexture } from "@/lib/plant/textures";
import {
  haloTexture,
  koiFinTexture,
  koiTexture,
  lotusPetalEmissiveV2,
  lotusPetalNormalV2,
  lotusPetalTextureV2,
  mudTexture,
  padNormalTexture,
  padTexture,
  potTexture,
  urliTextures,
  type KoiPaint,
  type LotusPetalPaint,
  type MudState,
} from "@/components/lotus/textures";
import { urliProfile, type Tier } from "@/components/lotus/geometry";
import type { PetalColour, Vessel } from "@/components/lotus/params";

const cache = new Map<string, THREE.Material>();

function get<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Quantised so a slider does not mint a material per value. */
export const band = (x: number, steps = 8) => Math.round(Math.min(1, Math.max(0, x)) * steps) / steps;

// ---------------------------------------------------------------------------------------------------------------------
// The vessel

/**
 * A: tarnished bell metal, gold only where hands polish (metalness 1, the PBR table's linear colours); B: dressed
 * granite (metalness 0); C: glaze with a clear coat over its teal, bare clay at the foot and the rim's edge.
 */
export function urliMaterial(vessel: Vessel, tier: Tier): THREE.MeshStandardMaterial {
  return get(`urli|${vessel}|${tier}`, () => {
    const { zones } = urliProfile(vessel);
    const t = urliTextures(vessel, zones);
    const lite = tier === "lite";
    let m: THREE.MeshStandardMaterial;
    if (vessel === "a") {
      m = new THREE.MeshStandardMaterial({
        map: t.map,
        roughnessMap: t.orm,
        metalnessMap: t.orm,
        roughness: 1,
        metalness: 1,
        bumpMap: lite ? null : t.bump,
        bumpScale: 0.6,
        envMapIntensity: 0.9,
      });
    } else if (vessel === "b") {
      m = new THREE.MeshStandardMaterial({
        map: t.map,
        roughnessMap: t.orm,
        roughness: 1,
        metalness: 0,
        bumpMap: lite ? null : t.bump,
        bumpScale: 1.4,
        envMapIntensity: 0.6,
      });
    } else {
      m = new THREE.MeshPhysicalMaterial({
        map: t.map,
        roughnessMap: t.orm,
        metalnessMap: t.orm,
        roughness: 1,
        metalness: 1,
        clearcoat: lite ? 0 : 1,
        clearcoatRoughness: 0.06,
        bumpMap: lite ? null : t.bump,
        bumpScale: 0.35,
        envMapIntensity: 0.9,
      });
    }
    return withGardenLight(m, `lotus-urli-${vessel}`, true);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Mud and water

export function mudMaterial(state: MudState): THREE.MeshStandardMaterial {
  return get(`mud|${state}`, () =>
    withGardenLight(
      new THREE.MeshStandardMaterial({
        map: mudTexture(state),
        roughness: state === "wet" ? 0.25 : state === "drying" ? 0.72 : 0.92,
        metalness: 0,
        envMapIntensity: state === "wet" ? 0.7 : 0.3,
      }),
      `lotus-mud-${state}`,
      false,
    ),
  );
}

export const waterUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  uRain: { value: 0 },
  uAlgae: { value: 0 },
  /** the surface's radius in the urli frame, m (the mesh is a unit disc scaled to it) */
  uRadius: { value: 0.166 },
  /** floating leaves for the meniscus: x, z, radius in the urli frame (radius 0 = unused) */
  uLeaves: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uSkyHorizon: { value: new THREE.Color("#a9c7e6") },
  uSkyZenith: { value: new THREE.Color("#5f8fd0") },
  uNight: { value: 0 },
};

/** The clarity states of section 3.3, by algae: colour (sRGB), opacity over the mud, roughness. */
const CLARITY = [
  { at: 0, color: new THREE.Color("#1d2219"), opacity: 0.35, roughness: 0.04 },
  { at: 0.2, color: new THREE.Color("#2c3d22"), opacity: 0.55, roughness: 0.06 },
  { at: 0.45, color: new THREE.Color("#3f5a24"), opacity: 0.8, roughness: 0.1 },
  { at: 0.75, color: new THREE.Color("#6f8a2e"), opacity: 0.95, roughness: 0.18 },
];

/** Sets the water's colour, opacity and roughness for `algae` (0 clear .. 1 pea soup). */
export function setClarity(m: THREE.MeshStandardMaterial, algae: number) {
  let i = 0;
  while (i < CLARITY.length - 2 && algae > CLARITY[i + 1].at) i++;
  const a = CLARITY[i];
  const b = CLARITY[i + 1];
  const t = Math.min(1, Math.max(0, (algae - a.at) / (b.at - a.at)));
  m.color.copy(a.color).lerp(b.color, t);
  m.opacity = a.opacity + (b.opacity - a.opacity) * t;
  m.roughness = a.roughness + (b.roughness - a.roughness) * t;
  waterUniforms.uAlgae.value = algae;
}

const WATER_COMMON = /* glsl */ `#include <common>
uniform float uTime;
uniform float uWind;
uniform float uRain;
uniform float uAlgae;
uniform float uRadius;
uniform float uNight;
uniform vec3 uLeaves[8];
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
varying vec2 vWaterXZ;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// two scrolling layers, wavelengths of about 2 and 5 cm
float wHeight(vec2 p) {
  float t = uTime;
  return wNoise(p * 50.0 + vec2(t * 0.6, t * 0.35)) * 0.6 + wNoise(p * 20.0 - vec2(t * 0.25, -t * 0.4)) * 0.4;
}
// rain rings: one per cell at most, each ring 0.6 s, density by the rain
vec2 wRings(vec2 p) {
  vec2 g = vec2(0.0);
  if (uRain <= 0.0) return g;
  float cell = 0.035;
  vec2 c = floor(p / cell);
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec2 id = c + vec2(float(dx), float(dy));
      float h1 = wHash(id);
      if (wHash(id + 17.3) > uRain * 0.8) continue;
      vec2 centre = (id + vec2(h1, fract(h1 * 7.13))) * cell;
      float age = fract(uTime / 0.6 + h1 * 5.0);
      float radius = age * 0.022;
      vec2 d = p - centre;
      float dist = length(d);
      float q = (dist - radius) / 0.0022;
      float ring = exp(-q * q) * (1.0 - age);
      g += (d / max(dist, 1e-4)) * ring * cos((dist - radius) * 900.0);
    }
  }
  return g;
}`;

const WATER_NORMAL = /* glsl */ `#include <normal_fragment_maps>
vec2 wp = vWaterXZ * uRadius;
{
  float e = 0.0015;
  float amp = 0.0016 * (0.2 + uWind);
  float hx = (wHeight(wp + vec2(e, 0.0)) - wHeight(wp - vec2(e, 0.0))) / (2.0 * e);
  float hz = (wHeight(wp + vec2(0.0, e)) - wHeight(wp - vec2(0.0, e))) / (2.0 * e);
  vec2 grad = vec2(hx, hz) * amp + wRings(wp) * 0.35 * uRain;
  // thick green water stills the surface
  grad *= 1.0 - 0.5 * smoothstep(0.4, 0.9, uAlgae);
  vec3 nW = normalize(vec3(-grad.x, 1.0, -grad.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`;

const WATER_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
{
  // the meniscus: a dark line a few millimetres wide where the water meets the wall and each leaf
  float rimD = uRadius - length(wp);
  float men = 1.0 - smoothstep(0.0, 0.0035, rimD);
  float scum = 1.0 - smoothstep(0.0, 0.012, rimD);
  for (int i = 0; i < 8; i++) {
    vec3 L = uLeaves[i];
    if (L.z <= 0.0) continue;
    float d = length(wp - L.xy) - L.z;
    men = max(men, 1.0 - smoothstep(0.0, 0.003, d));
    scum = max(scum, 1.0 - smoothstep(0.0, 0.009, d));
  }
  // the reflection, faked by the reflected ray's elevation: the hedge's dark body low, canopy with sky gaps above
  // 16 degrees, the sky above 30
  vec3 V = normalize(vViewPosition);
  vec3 Rw = inverseTransformDirection(reflect(-V, normal), viewMatrix);
  float deg = degrees(asin(clamp(Rw.y, -1.0, 1.0)));
  float day = dot(uSkyHorizon, vec3(0.2126, 0.7152, 0.0722));
  vec3 hedge = vec3(0.045, 0.07, 0.04) * (0.25 + 1.2 * day);
  float gaps = smoothstep(0.55, 0.75, wNoise(Rw.xz / max(Rw.y, 0.25) * 5.0));
  vec3 canopy = mix(hedge * 0.8, uSkyHorizon * 0.85, gaps * 0.6);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(30.0, 75.0, deg)) * 0.9;
  vec3 refl = deg < 16.0 ? hedge : (deg < 30.0 ? mix(hedge, canopy, smoothstep(16.0, 21.0, deg)) : mix(canopy, sky, smoothstep(30.0, 37.0, deg)));
  // a faint glow of night sky stays, as on the bed's puddle
  refl = mix(refl, uSkyZenith * 0.25 + vec3(0.004, 0.006, 0.012), uNight * 0.7);
  float cosT = clamp(dot(normal, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  float mirror = 1.0 - 0.85 * smoothstep(0.3, 0.85, uAlgae);
  // a paler scum band at the edges and round the leaves once the water is green
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.4 + vec3(0.02, 0.025, 0.0), scum * smoothstep(0.35, 0.6, uAlgae));
  diffuseColor.rgb *= 1.0 - 0.6 * men;
  float wAlpha = clamp(mix(diffuseColor.a, 1.0, F * 0.8 * mirror) + men * 0.45, 0.0, 1.0);
  diffuseColor.a = wAlpha;
  // the blend multiplies everything by the alpha; the reflection is light added on top of what shows through, so it
  // is divided back out
  totalEmissiveRadiance += refl * F * mirror * (1.0 - men) / max(wAlpha, 0.2);
}`;

export function waterMaterial(): THREE.MeshStandardMaterial {
  return get("water", () => {
    const m = new THREE.MeshStandardMaterial({
      color: "#1d2219",
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      // the scene's environment is a studio of light panels, not the sky; the water makes its own reflection
      envMapIntensity: 0,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, waterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterXZ = position.xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", WATER_COMMON)
        .replace("#include <normal_fragment_maps>", WATER_NORMAL)
        .replace("#include <emissivemap_fragment>", WATER_EMISSIVE);
    };
    m.customProgramCacheKey = () => "lotus-water-1";
    return m;
  });
}

export const causticUniforms = {
  uTime: { value: 0 },
  uStrength: { value: 0 },
  uColor: { value: new THREE.Color(1, 0.9, 0.7) },
  /** the sun's horizontal direction (world) */
  uSun: { value: new THREE.Vector2(0, 1) },
  uTop: { value: 0.135 },
  uBottom: { value: 0.12 },
};

/**
 * Light lines on the far inner wall between the waterline and the rim: sunlight reflected off the rippled water. The
 * reflected rays travel away from the sun, so they land on the stretch of wall whose inward face looks toward it.
 */
export function causticMaterial(): THREE.ShaderMaterial {
  return get(
    "caustic",
    () =>
      new THREE.ShaderMaterial({
        uniforms: causticUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          varying vec3 vN;
          void main() {
            vPos = position;
            vN = normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uStrength;
          uniform vec3 uColor;
          uniform vec2 uSun;
          uniform float uTop;
          uniform float uBottom;
          varying vec3 vPos;
          varying vec3 vN;
          void main() {
            float ang = atan(vPos.z, vPos.x);
            vec2 p = vec2(ang * 7.0, vPos.y * 60.0);
            float t = uTime;
            float w = sin(p.x * 1.7 + sin(p.y * 2.3 + t * 1.3) * 1.2 + t * 0.9) * sin(p.x * 1.1 - t * 0.7 + sin(p.y * 1.7 - t) * 1.4);
            float lines = pow(1.0 - abs(w), 7.0);
            float edge = smoothstep(uBottom, uBottom + 0.003, vPos.y) * (1.0 - smoothstep(uTop - 0.005, uTop, vPos.y));
            float facing = clamp(dot(normalize(vN.xz), normalize(uSun)), 0.0, 1.0);
            gl_FragColor = vec4(uColor * lines * edge * facing * uStrength, 1.0);
          }`,
      }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Leaves and stalks

/** The underside: paler and yellower than the top, smooth, its veins raised (seen when a blade tips away or is backlit). */
const PAD_UNDER = new THREE.Color("#b9c99a");

/**
 * The leaf: matte and velvety on top (the wax), the glaucous bloom as a cool sheen; paler and smoother underneath,
 * picked by the face (the underside shows when the blade is backlit or seen from below). It never looks wet: its
 * roughness and colour do not follow the rain (the lotus effect, section 7.7).
 */
export function padMaterial(kind: "stand" | "float", pale: number, brown: number, crisp: number, seed: number, tier: Tier): THREE.MeshPhysicalMaterial {
  const p = band(pale, 4);
  const b = band(brown, 4);
  const c = band(crisp, 4);
  return get(`pad|${kind}|${p}|${b}|${c}|${seed}|${tier}`, () => {
    const m = new THREE.MeshPhysicalMaterial({
      map: padTexture({ kind, pale: p, brown: b, crisp: c, seed }),
      normalMap: tier === "lite" ? null : padNormalTexture(seed),
      normalScale: new THREE.Vector2(0.22, 0.22),
      // matte: the wax's papillae scatter the light (the lotus effect)
      roughness: (kind === "float" ? 0.74 : 0.86) + 0.1 * b,
      metalness: 0,
      // the glaucous bloom as a cool silvery sheen that pales the blade at grazing angles; kept lower on the floating
      // leaves, which the camera always sees at a grazing angle (the first renders' floats read as paper-white coins)
      sheen: (kind === "float" ? 0.16 : 0.5) * (1 - b),
      sheenColor: new THREE.Color("#cfe2de"),
      sheenRoughness: 0.42,
      // light through the blade for the standing leaves; a floating leaf lies on the water, and the transmission pass
      // (which sees only opaque things) would show the mud through it as if the water were not there
      transmission: kind === "float" ? 0 : tier === "cinematic" ? 0.22 * (1 - b) : tier === "balanced" ? 0.12 * (1 - b) : 0,
      thickness: 0.02,
      attenuationColor: new THREE.Color("#9fbf7a"),
      attenuationDistance: 0.12,
      envMapIntensity: 0.45,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPadUnder = { value: PAD_UNDER };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uPadUnder;")
        .replace("#include <map_fragment>", "#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, uPadUnder * (0.7 + 0.5 * diffuseColor.g), 0.7);")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (!gl_FrontFacing) roughnessFactor = 0.6;");
    };
    m.customProgramCacheKey = () => "lotus-pad-under-2";
    return withGardenLight(m, "lotus-pad", false);
  });
}

/** The stalks: green with a darker speckle (lib/plant stemTexture), a soft sheen; the prickles share it. Under the pond's water they fade with depth. */
export function stalkMaterial(): THREE.MeshPhysicalMaterial {
  return get("stalk", () =>
    withUnderwater(
      withLampFill(
        withGardenLight(
          new THREE.MeshPhysicalMaterial({
            map: stemTexture("#6c8a4a", 7),
            roughness: 0.6,
            metalness: 0,
            sheen: 0.3,
            sheenColor: new THREE.Color("#b8d89a"),
            sheenRoughness: 0.8,
            envMapIntensity: 0.5,
          }),
          "lotus-stalk",
          false,
        ),
        "lotus-stalk",
      ),
      "lotus-stalk",
    ),
  );
}

/** Adds the pond lamps' warm bounce (petalUniforms.uPetalFill) to a material's light, for the stalks after dark. */
function withLampFill<T extends THREE.Material>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, petalUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPetalFill;")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += uPetalFill * BRDF_Lambert(diffuseColor.rgb);");
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|fill-" + key;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// The flower

interface PetalSet extends LotusPetalPaint {
  sheen: string;
  attenuation: string;
}

/**
 * The colour options of section 6, repainted for v2 (pink recommended): soft pink, paler to a cream-white claw, deeper
 * at the tips, with fine deeper-pink veins toward them. The first renders' rose (#d94f80) read magenta at noon; the
 * tip is now a soft rose (#e98aa6) and the body a blush (#f6c1cd).
 */
export const PETAL_SETS: Record<PetalColour, PetalSet> = {
  pink: { base: "#fdf6ea", low: "#fce9ec", mid: "#f8cdd7", tip: "#ee9db4", vein: "#de7898", sheen: "#fff0f3", attenuation: "#e8879f" },
  white: { base: "#f6f1dc", low: "#fbf9f1", mid: "#fdfcf7", tip: "#ffffff", vein: "#e6e0cc", sheen: "#ffffff", attenuation: "#f4eedc" },
  tipped: { base: "#f7f1dd", low: "#fdfaf2", mid: "#fcf1f0", tip: "#ec97ad", vein: "#e3a0b4", sheen: "#fff0f3", attenuation: "#f2c9d4" },
};

/**
 * The ripe bud (section 4.5): the outer petals' faces, green only at the base, cream low down, flushing to a deeper pink
 * over the top third, whatever the open flower's colour.
 */
const BUD_SET: PetalSet = { base: "#b7cc8e", low: "#ece0cc", mid: "#f4c9d2", tip: "#e2829f", vein: "#d98ea6", sheen: "#fff2f4", attenuation: "#e8a2b4" };

export const PETAL_EMISSIVE = "#ffb070";

/**
 * Warm light thrown back onto the petals from the lamp-lit stone round the pond after dark (the pond writes it each
 * frame from the lamps; nothing elsewhere): without it a petal's back, lit only by the cooled night sky, turned plum.
 */
export const petalUniforms = { uPetalFill: { value: new THREE.Color(0, 0, 0) } };

/**
 * Thin-petal translucency: sunlight striking a petal's far face comes through it, softened, so a petal seen against
 * the light glows (the art direction's golden-hour image) and the shaded outer faces of a noon cup stay pink rather
 * than mauve. A wrap of the sun's light onto the face away from it, tinted by the petal but not wholly: light through a
 * thin petal keeps much of its own colour, so a low warm sun does not burn the backs to burgundy.
 */
const PETAL_TRANSLUCENT = /* glsl */ `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  float tBack = max(0.0, -dot(normal, directionalLights[0].direction));
  vec3 tTint = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, 0.6);
  reflectedLight.directDiffuse += directionalLights[0].color * BRDF_Lambert(tTint) * (0.25 + 0.9 * tBack) * 0.75;
}
#endif
reflectedLight.indirectDiffuse += uPetalFill * BRDF_Lambert(diffuseColor.rgb);`;

/** The petals (and the bud's closed petals): fine veins, sheen, translucency, a little transmission on cinematic, a warm emissive mask. */
export function petalMaterial(colour: PetalColour | "bud", tier: Tier): THREE.MeshPhysicalMaterial {
  return get(`petal|${colour}|${tier}`, () => {
    const s = colour === "bud" ? BUD_SET : PETAL_SETS[colour];
    const m = new THREE.MeshPhysicalMaterial({
      map: lotusPetalTextureV2(s),
      normalMap: tier === "lite" ? null : lotusPetalNormalV2(),
      normalScale: new THREE.Vector2(0.3, 0.3),
      emissiveMap: lotusPetalEmissiveV2(),
      emissive: new THREE.Color(PETAL_EMISSIVE),
      emissiveIntensity: 0.02,
      side: THREE.DoubleSide,
      roughness: 0.5,
      metalness: 0,
      sheen: 0.6,
      sheenColor: new THREE.Color(s.sheen),
      sheenRoughness: 0.45,
      transmission: tier === "cinematic" ? 0.1 : 0,
      thickness: 0.06,
      attenuationColor: new THREE.Color(s.attenuation),
      attenuationDistance: 0.25,
      ior: 1.35,
      envMapIntensity: 0.7,
      shadowSide: THREE.DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, petalUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uPetalFill;")
        .replace("#include <lights_fragment_end>", PETAL_TRANSLUCENT);
    };
    m.customProgramCacheKey = () => "lotus-petal-translucent-2";
    return m;
  });
}

/** The four small green outer tepals: a small leaf's texture in the tepal green. */
export function tepalMaterial(): THREE.MeshPhysicalMaterial {
  return get("tepal", () => {
    const base = "#6f8f4c";
    return withLampFill(new THREE.MeshPhysicalMaterial({
      map: leafTexture({ base, tip: shiftHex(base, 0.01, 0.3), vein: shiftHex(base, 0.02, 0.8), seed: 4, fade: 0, burn: 0 }),
      normalMap: leafNormalTexture(4),
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.6,
      sheen: 0.3,
      sheenColor: new THREE.Color("#b8d89a"),
      sheenRoughness: 0.8,
      envMapIntensity: 0.45,
      side: THREE.DoubleSide,
    }), "tepal");
  });
}

/** Receptacle and pod (vertex colours carry the stage's colours), with the warmth's amber in its heart. */
export function receptacleMaterial(): THREE.MeshStandardMaterial {
  return get(
    "receptacle",
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0,
        emissive: new THREE.Color("#ffb36b"),
        emissiveIntensity: 0,
      }),
  );
}

export function stamenMaterial(): THREE.MeshStandardMaterial {
  return get(
    "stamen",
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0,
        emissive: new THREE.Color("#ffb36b"),
        emissiveIntensity: 0,
      }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The jar

/**
 * Kitchen glass: clear, a thin shell that is all reflection, nearly invisible face-on and bright at its edges
 * (Fresnel, glass's 0.04 at normal incidence), so the water, the seed and its light show through it. (Transmission drew
 * the dark pond behind it through the glass, and the jar read as a green tumbler.)
 */
export function jarGlassMaterial(tier: Tier): THREE.MeshStandardMaterial {
  return get(`jarGlass2|${tier}`, () => {
    const m = new THREE.MeshStandardMaterial({
      color: "#1a1e1d",
      transparent: true,
      roughness: 0.03,
      metalness: 0,
      envMapIntensity: tier === "lite" ? 1.2 : 1.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "{ float jc = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);\n  diffuseColor.a = clamp(0.1 + 0.85 * pow(1.0 - jc, 4.0), 0.0, 1.0); }\n#include <opaque_fragment>",
      );
    };
    m.customProgramCacheKey = () => "lotus-jar-glass-2";
    return m;
  });
}

/** The scarified seed's filed spot, where its pale cream heart shows through the dark coat. */
export function seedSpotMaterial(): THREE.MeshStandardMaterial {
  return get("seedSpot", () => new THREE.MeshStandardMaterial({ color: "#eadcbc", roughness: 0.75, metalness: 0 }));
}

/** The jar's water, a faint tea tint when clear, milky tan when cloudy. */
export function jarWaterMaterial(clarity: number): THREE.MeshStandardMaterial {
  const c = band(clarity, 4);
  return get(`jarWater|${c}`, () => {
    const clear = new THREE.Color("#e9dcc0");
    const cloudy = new THREE.Color("#d9cfb4");
    return new THREE.MeshStandardMaterial({
      color: clear.lerp(cloudy, 1 - c),
      transparent: true,
      opacity: 0.08 + 0.57 * (1 - c),
      roughness: 0.15,
      metalness: 0,
      depthWrite: false,
      envMapIntensity: 0.6,
    });
  });
}

export function seedMaterial(): THREE.MeshPhysicalMaterial {
  return get(
    "seed",
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#2a1d14",
        roughness: 0.25,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        emissive: new THREE.Color("#ffb45e"),
        emissiveIntensity: 0.05,
      }),
  );
}

export function rootMaterial(): THREE.MeshStandardMaterial {
  return get("root", () => new THREE.MeshStandardMaterial({ color: "#f1ede0", roughness: 0.55 }));
}

/** The seed of light's halo: crisp in clear water, a milky spread when the water clouds. */
export function haloMaterial(): THREE.SpriteMaterial {
  return get(
    "halo",
    () =>
      new THREE.SpriteMaterial({
        map: haloTexture(),
        color: new THREE.Color(2.2, 1.5, 0.75),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
  );
}

/** The Meadow's near light plant and any other vertex-coloured part. */
export function vertexColourMaterial(key: string, roughness = 0.7): THREE.MeshStandardMaterial {
  return get(`vc|${key}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Under the pond's water (v2)

/**
 * Shared by every material that can sit under the pond's surface (the basin, the pot, its pebbles, the stalks, the
 * koi): the level (world y; far below everything when no pond is drawn), the water's absorption per metre (red goes
 * first, so depth turns things teal-green and dark), the colour light scattered in the water brings back, and the
 * caustics' strength. The pond writes them every frame.
 */
export const underwaterUniforms = {
  uUwLevel: { value: -100 },
  uUwSigma: { value: new THREE.Vector3(1.4, 0.65, 0.55) },
  uUwDeep: { value: new THREE.Color(0.012, 0.03, 0.026) },
  uUwCaustic: { value: 0 },
  uUwTime: { value: 0 },
};

const UW_VERT_COMMON = "#include <common>\nvarying vec3 vUwWorld;\nuniform float uUwLevel;\nuniform float uUwTime;";
// Seen through the surface, what lies under it looks shallower (about three quarters of its depth near the normal,
// Snell's law with water's 1.33) and wavers with the ripples: a small lift and sway of the vertices under the level,
// so a stalk bends where it enters the water and the pebbles and koi swim in a slightly living image. (Scale-free
// transforms only, as everything in the pond is.)
const UW_BEGIN =
  "#include <begin_vertex>\n" +
  "{ vec4 uwP = modelMatrix * vec4(transformed, 1.0);\n" +
  "  float uwD = uUwLevel - uwP.y;\n" +
  "  if (uwD > 0.0) {\n" +
  // the sway grows with the depth of water the point is seen through (about 4 mm at 5 cm), two crossing ripples
  "    float uwK = min(uwD * 0.08, 0.0045);\n" +
  "    vec3 uwDelta = vec3((sin(uUwTime * 1.3 + uwP.z * 37.0 + uwP.x * 11.0) + 0.6 * sin(uUwTime * 0.7 + uwP.z * 13.0 - uwP.x * 7.0)) * uwK, uwD * 0.25, (cos(uUwTime * 1.1 + uwP.x * 31.0 - uwP.z * 9.0) + 0.6 * cos(uUwTime * 0.9 - uwP.x * 15.0 + uwP.z * 6.0)) * uwK);\n" +
  "    transformed += transpose(mat3(modelMatrix)) * uwDelta;\n" +
  "  } }";
const UW_VERT =
  "#include <worldpos_vertex>\n" +
  "{ vec4 uw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n uw = instanceMatrix * uw;\n#endif\n" +
  "  vUwWorld = (modelMatrix * uw).xyz; }";
const UW_FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vUwWorld;
uniform float uUwLevel;
uniform vec3 uUwSigma;
uniform vec3 uUwDeep;
uniform float uUwCaustic;
uniform float uUwTime;
// sunlight focused by the rippled surface: two drifting layers of warped cells, bright where the cells' walls meet
float uwCaustic(vec2 p, float t) {
  vec2 q = p * 10.0;
  vec2 a = q + vec2(sin(q.y * 1.3 + t * 0.8), cos(q.x * 1.1 - t * 0.7)) * 0.65;
  vec2 b = q * 1.63 + vec2(cos(q.y * 0.9 - t * 0.6), sin(q.x * 1.4 + t * 0.9)) * 0.7;
  float v = sin(a.x) * sin(a.y);
  float w = sin(b.x + 1.3) * sin(b.y - 0.7);
  return pow(1.0 - abs(v), 5.0) + 0.7 * pow(1.0 - abs(w), 5.0);
}`;
// Under the water a surface loses its own shine: stone, clay or a koi's wet skin against water (n 1.33) reflects about a
// tenth of what it does against air (Fresnel at normal incidence, ((1.5 - 1.33) / 2.83)^2 = 0.004 against
// ((1.5 - 1) / 2.5)^2 = 0.04), so the specular, the clear coat and the sheen go, and pebbles under water read matte
// rather than glossy as wet ones in the sun do. The caustics: on the direct light only, so they keep to sunlit surfaces
// and vanish in shadow and under cloud.
const UW_LIGHT = /* glsl */ `#include <lights_fragment_end>
{
  float uwDepth = uUwLevel - vUwWorld.y;
  if (uwDepth > 0.0) {
    float uwKeep = 1.0 - 0.9 * smoothstep(0.0, 0.006, uwDepth);
    reflectedLight.directSpecular *= uwKeep;
    reflectedLight.indirectSpecular *= uwKeep;
    clearcoatSpecularDirect *= uwKeep;
    clearcoatSpecularIndirect *= uwKeep;
    sheenSpecularDirect *= uwKeep;
    sheenSpecularIndirect *= uwKeep;
    if (uUwCaustic > 0.0) {
      vec3 uwN = inverseTransformDirection(normal, viewMatrix);
      // (the walls catch them too, as the refracted light reaches them: a fainter net on the upright faces)
      float uwUp = clamp(uwN.y * 0.6 + 0.4, 0.0, 1.0);
      float uwC = uwCaustic(vUwWorld.xz + vec2(vUwWorld.y * 0.7), uUwTime);
      reflectedLight.directDiffuse *= 1.0 + uUwCaustic * uwC * uwUp * exp(-uwDepth * 2.5) * smoothstep(0.0, 0.012, uwDepth);
    }
  }
}`;
// The light's path through the water: down from the surface to the point, and back up to the eye along the refracted
// ray (Snell's law: seen from 18.5 degrees over the water the ray runs about 45 degrees from the vertical under it, so
// the way back up is 1.4 times the depth, not the 3.2 times the air's angle would give). The water's absorption and its
// suspended silt (uUwSigma, per metre) fade what lies under it toward the light the water itself scatters back (uUwDeep).
const UW_FOG = /* glsl */ `{
  float uwDepth = uUwLevel - vUwWorld.y;
  if (uwDepth > 0.0) {
    vec3 uwV = normalize(cameraPosition - vUwWorld);
    float uwSin = sqrt(max(0.0, 1.0 - uwV.y * uwV.y)) / 1.333;
    float uwCos = sqrt(max(0.04, 1.0 - uwSin * uwSin));
    // the true depth (the vertices were lifted to a quarter less)
    float uwPath = uwDepth / 0.75 * (1.0 + 1.0 / uwCos);
    vec3 uwT = exp(-uUwSigma * uwPath);
    outgoingLight = outgoingLight * uwT + uUwDeep * (1.0 - uwT);
  }
}
#include <opaque_fragment>`;

/**
 * Lets a lit material sit under the pond's water: below the level it fades with the depth of water between it and the
 * eye, toward the water's own colour, and its sunlit faces carry caustics. Above the level it is untouched, so the
 * same material serves a stalk that rises out of the water. Chains any onBeforeCompile already set.
 */
export function withUnderwater<T extends THREE.Material>(m: T, key: string): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, underwaterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", UW_VERT_COMMON)
      .replace("#include <begin_vertex>", UW_BEGIN)
      .replace("#include <worldpos_vertex>", UW_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", UW_FRAG_COMMON)
      .replace("#include <lights_fragment_end>", UW_LIGHT)
      .replace("#include <opaque_fragment>", UW_FOG);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|uw-" + key;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pond's surface

export const POND_LEAVES = 12;
/** Soft rings on the water: the first three are the koi's, the rest the moments' (a pour, a spill, a planting, a pinch). */
export const POND_RINGS = 6;

export const pondWaterUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  uRain: { value: 0 },
  uAlgae: { value: 0 },
  uNight: { value: 0 },
  uSkyHorizon: { value: new THREE.Color("#a9c7e6") },
  uSkyZenith: { value: new THREE.Color("#5f8fd0") },
  /** the water's rectangle, half-extents in metres (pond frame) */
  uPondR: { value: new THREE.Vector2(0.64, 0.51) },
  /** the faked surround's colour low in the reflection (the courtyard's walls and steps), lit for the hour */
  uFakeWall: { value: new THREE.Color(0.05, 0.035, 0.025) },
  /** floating leaves for the meniscus: x, z, radius in the pond frame (radius 0 = unused) */
  uLeaves: { value: Array.from({ length: POND_LEAVES }, () => new THREE.Vector3()) },
  /** soft rings where a koi noses up: x, z (pond frame), age in seconds, strength (0 = unused) */
  uRings: { value: Array.from({ length: POND_RINGS }, () => new THREE.Vector4()) },
  /** the planar reflection (its alpha marks where something was drawn) and its projection, or off */
  uRefl: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
};

/** The water's clarity by algae (the pond model's green index: faint tint 0.15, green 0.40, pea soup 0.70). */
const POND_CLARITY = [
  { at: 0, color: new THREE.Color("#122219"), opacity: 0.2, roughness: 0.035 },
  { at: 0.15, color: new THREE.Color("#16261a"), opacity: 0.32, roughness: 0.045 },
  { at: 0.4, color: new THREE.Color("#203619"), opacity: 0.7, roughness: 0.08 },
  { at: 0.7, color: new THREE.Color("#34491c"), opacity: 0.9, roughness: 0.16 },
];

export function setPondClarity(m: THREE.MeshStandardMaterial, algae: number) {
  let i = 0;
  while (i < POND_CLARITY.length - 2 && algae > POND_CLARITY[i + 1].at) i++;
  const a = POND_CLARITY[i];
  const b = POND_CLARITY[i + 1];
  const t = Math.min(1, Math.max(0, (algae - a.at) / (b.at - a.at)));
  m.color.copy(a.color).lerp(b.color, t);
  m.opacity = a.opacity + (b.opacity - a.opacity) * t;
  m.roughness = a.roughness + (b.roughness - a.roughness) * t;
  pondWaterUniforms.uAlgae.value = algae;
}

const POND_COMMON = /* glsl */ `#include <common>
uniform float uTime;
uniform float uWind;
uniform float uRain;
uniform float uAlgae;
uniform float uNight;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec2 uPondR;
uniform vec3 uFakeWall;
uniform vec3 uLeaves[${POND_LEAVES}];
uniform vec4 uRings[${POND_RINGS}];
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
uniform vec2 uReflTexel;
varying vec2 vPondXZ;
varying vec3 vPondWorld;
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the breeze's ripples: two drifting layers, wavelengths of about 4 and 10 cm
float pHeight(vec2 p) {
  float t = uTime;
  return pNoise(p * 26.0 + vec2(t * 0.45, t * 0.3)) * 0.6 + pNoise(p * 10.0 - vec2(t * 0.18, -t * 0.3)) * 0.4;
}
vec2 pRain(vec2 p) {
  vec2 g = vec2(0.0);
  if (uRain <= 0.0) return g;
  float cell = 0.05;
  vec2 c = floor(p / cell);
  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec2 id = c + vec2(float(dx), float(dy));
      float h1 = pHash(id);
      if (pHash(id + 17.3) > uRain * 0.8) continue;
      vec2 centre = (id + vec2(h1, fract(h1 * 7.13))) * cell;
      float age = fract(uTime / 0.7 + h1 * 5.0);
      float radius = age * 0.03;
      vec2 d = p - centre;
      float dist = length(d);
      float q = (dist - radius) / 0.0028;
      g += (d / max(dist, 1e-4)) * exp(-q * q) * (1.0 - age) * cos((dist - radius) * 700.0);
    }
  }
  return g;
}
// a koi's ring: a soft packet of two or three crests spreading at about 12 cm a second, fading over four seconds
vec2 pRings(vec2 p) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${POND_RINGS}; i++) {
    vec4 r = uRings[i];
    if (r.w <= 0.0 || r.z > 5.0) continue;
    float radius = 0.02 + r.z * 0.12;
    vec2 d = p - r.xy;
    float dist = length(d);
    float q = (dist - radius) / 0.018;
    float fade = (1.0 - smoothstep(0.0, 5.0, r.z)) * smoothstep(0.0, 0.25, r.z) / (1.0 + radius * 6.0);
    g += (d / max(dist, 1e-4)) * exp(-q * q) * sin((dist - radius) * 420.0) * fade * r.w;
  }
  return g;
}`;

const POND_NORMAL = /* glsl */ `#include <normal_fragment_maps>
vec2 wp = vPondXZ;
vec2 grad;
{
  float e = 0.002;
  float amp = 0.0011 * (0.25 + uWind);
  float hx = (pHeight(wp + vec2(e, 0.0)) - pHeight(wp - vec2(e, 0.0))) / (2.0 * e);
  float hz = (pHeight(wp + vec2(0.0, e)) - pHeight(wp - vec2(0.0, e))) / (2.0 * e);
  grad = vec2(hx, hz) * amp + pRain(wp) * 0.3 * uRain + pRings(wp) * 0.22;
  // thick green water stills the surface
  grad *= 1.0 - 0.5 * smoothstep(0.4, 0.9, uAlgae);
  vec3 nW = normalize(vec3(-grad.x, 1.0, -grad.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`;

const POND_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
{
  // the meniscus: a fine dark line where the water meets each floating leaf; a scum band round them when green
  float men = 0.0;
  vec2 edgeD = uPondR - abs(wp);
  float scum = 1.0 - smoothstep(0.0, 0.03, min(edgeD.x, edgeD.y));
  for (int i = 0; i < ${POND_LEAVES}; i++) {
    vec3 L = uLeaves[i];
    if (L.z <= 0.0) continue;
    float d = length(wp - L.xy) - L.z;
    men = max(men, (1.0 - smoothstep(0.0, 0.0024, d)) * 0.8);
    scum = max(scum, 1.0 - smoothstep(0.0, 0.012, d));
  }
  // the reflection: what the planar pass drew (the plant, the courtyard's steps, walls, lamps and palms), over a faked
  // surround chosen by the reflected ray's elevation (the walls and steps low, the sky over them)
  vec3 V = normalize(vViewPosition);
  vec3 Rw = inverseTransformDirection(reflect(-V, normal), viewMatrix);
  float deg = degrees(asin(clamp(Rw.y, -1.0, 1.0)));
  float day = dot(uSkyHorizon, vec3(0.2126, 0.7152, 0.0722));
  vec3 wall = uFakeWall;
  float gaps = smoothstep(0.45, 0.85, pNoise(Rw.xz / max(Rw.y, 0.25) * 7.0 + 3.0)) * 0.8;
  vec3 fronds = mix(vec3(0.03, 0.05, 0.03) * (0.25 + 1.2 * day), uSkyHorizon * 0.85, gaps * 0.7);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(30.0, 75.0, deg)) * 0.9;
  vec3 refl = deg < 22.0 ? wall : (deg < 34.0 ? mix(wall, fronds, smoothstep(22.0, 27.0, deg)) : mix(fronds, sky, smoothstep(34.0, 44.0, deg)));
  refl = mix(refl, uSkyZenith * 0.25 + vec3(0.004, 0.006, 0.012), uNight * 0.7);
  if (uReflOn > 0.5) {
    vec4 rp = uReflMatrix * vec4(vPondWorld, 1.0);
    vec2 ruv = rp.xy / rp.w + grad * 0.9;
    vec2 o = uReflTexel * 1.6;
    vec4 rc = texture2D(uRefl, ruv) * 0.4 + (texture2D(uRefl, ruv + vec2(o.x, o.y)) + texture2D(uRefl, ruv + vec2(-o.x, o.y)) + texture2D(uRefl, ruv + vec2(o.x, -o.y)) + texture2D(uRefl, ruv - o)) * 0.15;
    refl = mix(refl, rc.rgb / max(rc.a, 1e-3), clamp(rc.a, 0.0, 1.0));
  }
  float cosT = clamp(dot(normal, V), 0.0, 1.0);
  // Fresnel (Schlick, water's 0.02 at normal incidence): about 0.15 from the product camera's 18.5 degrees over the
  // water, 0.02 looking straight down, so the shallow shelf over the pot carries the courtyard's reflection
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  float mirror = 1.0 - 0.85 * smoothstep(0.3, 0.85, uAlgae);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.4 + vec3(0.02, 0.025, 0.0), scum * smoothstep(0.35, 0.6, uAlgae));
  diffuseColor.rgb *= 1.0 - 0.6 * men;
  float wAlpha = clamp(mix(diffuseColor.a, 1.0, F * 0.85 * mirror) + men * 0.5, 0.0, 1.0);
  diffuseColor.a = wAlpha;
  // the blend multiplies everything by the alpha; the reflection is light added over what shows through, so it is
  // divided back out
  totalEmissiveRadiance += refl * F * mirror * (1.0 - men) / max(wAlpha, 0.15);
}`;

/** The pond's surface: dark clear water with soft reflections, the breeze's ripples, rain and koi rings. */
export function pondWaterMaterial(): THREE.MeshStandardMaterial {
  return get("pondWater", () => {
    const m = new THREE.MeshStandardMaterial({
      color: "#0b1713",
      roughness: 0.035,
      metalness: 0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      envMapIntensity: 0,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, pondWaterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vPondXZ;\nvarying vec3 vPondWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPondXZ = uv;\nvPondWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", POND_COMMON)
        .replace("#include <normal_fragment_maps>", POND_NORMAL)
        .replace("#include <emissivemap_fragment>", POND_EMISSIVE);
    };
    m.customProgramCacheKey = () => "lotus-pond-water-4";
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The pond's parts

export function potMaterial(): THREE.MeshStandardMaterial {
  return get("pot", () => withUnderwater(new THREE.MeshStandardMaterial({ map: potTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.2 }), "pot"));
}

/**
 * The pot's pebbles: under a film of silt and algae (the tank floor's colour) within weeks in a pond with fish, matte
 * under the water (withUnderwater); paler and dusty once the water has fallen away from them.
 */
export function pebbleMaterial(dry: boolean): THREE.MeshStandardMaterial {
  return get(`pebbles|${dry}`, () =>
    withUnderwater(
      new THREE.MeshStandardMaterial({ vertexColors: true, color: dry ? "#d8d2c4" : "#8a8462", roughness: dry ? 0.92 : 0.7, metalness: 0, envMapIntensity: 0.2 }),
      "pebbles",
    ),
  );
}

export function potMudMaterial(): THREE.MeshStandardMaterial {
  return get("potMud", () => withUnderwater(new THREE.MeshStandardMaterial({ color: "#4d4935", roughness: 0.92, metalness: 0 }), "pot-mud"));
}

/** The koi's skin: its pattern, a wet clear coat; the ogon's gold a little metallic. */
export function koiBodyMaterial(kind: KoiPaint, seed: number, tier: Tier): THREE.MeshPhysicalMaterial {
  return get(`koi|${kind}|${seed}|${tier}`, () =>
    withUnderwater(
      new THREE.MeshPhysicalMaterial({
        map: koiTexture(kind, seed),
        roughness: kind === "ogon" ? 0.3 : 0.4,
        metalness: kind === "ogon" ? 0.45 : 0,
        clearcoat: tier === "lite" ? 0 : 0.55,
        clearcoatRoughness: 0.25,
        envMapIntensity: kind === "ogon" ? 0.9 : 0.55,
      }),
      "koi",
    ),
  );
}

/** The koi's fins: filmy, translucent toward the edge, both sides. */
export function koiFinMaterial(kind: KoiPaint): THREE.MeshStandardMaterial {
  return get(`koiFin|${kind}`, () =>
    withUnderwater(
      new THREE.MeshStandardMaterial({
        map: koiFinTexture(kind),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.45,
        metalness: kind === "ogon" ? 0.3 : 0,
        envMapIntensity: 0.5,
      }),
      "koi-fin",
    ),
  );
}

export const marginUniforms = { uMarginTime: { value: 0 }, uMarginWind: { value: 0.5 } };

/** The marginal sweet flag: vertex-coloured, both sides, swaying a little toward its tips. */
export function marginMaterial(): THREE.MeshStandardMaterial {
  return get("margin", () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, envMapIntensity: 0.4 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, marginUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uMarginTime;\nuniform float uMarginWind;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n{ float h = uv.y * uv.y; float ph = position.x * 9.0 + position.z * 7.0;\n" +
            "  transformed.x += h * 0.018 * uMarginWind * sin(uMarginTime * 1.4 + ph);\n" +
            "  transformed.z += h * 0.012 * uMarginWind * sin(uMarginTime * 1.1 + ph * 1.3); }",
        );
    };
    m.customProgramCacheKey = () => "lotus-margin-1";
    return withGardenLight(m, "lotus-margin", true);
  });
}
