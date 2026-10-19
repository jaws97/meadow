"use client";
// The doe's coat, painted in the shader from each vertex's place on its part (loft.ts aCoat): no texture to download
// or hold in memory, crisp at any distance, and seeded, so every garden's doe has her own spots, different on each
// side, as a real chital's are.
//
// The colours and the pattern follow the coat reference gathered for this design (Blanford 1888-91, Lydekker 1898,
// Prater 1948, and colour samples normalised against the white hair in side-on photographs of chital does): base
// colours are albedo, restrained and mid-dark, so the warm low light and the tone mapping supply the glow; an orange
// coat is the cartoon tell. A dark chocolate stripe runs down the spine from the nape; a tidy row of small round spots
// hugs it and a second runs beside it; looser rows follow the back down the upper flank; the mid flank is scattered
// with oval spots, longer along the hair; a broken white line of merged spots runs low along the flank from behind
// the elbow to the stifle, with no spots below it; the spots thin out at the shoulder and none reach the neck, head,
// legs or belly. White beneath (a short soft edge with a buff fringe), a white bib on the throat, white inside the
// legs and a white band above the hooves. A grey-fawn face with a dusky forehead and nose bridge, a pale eye ring,
// a dark wet nose pad with a dusky band behind it, a white upper-lip band, chin and lower lip. Ears fawn-brown outside
// with a dark rim, white-haired over pink inside. The tail dark above with a white fringe. Large eyes, nearly black.
//
// The material is the garden's own kind (MeshPhysicalMaterial with a weak sheen for the short coat catching a low
// sun; the lite tier's MeshStandardMaterial without it), with the garden's golden-hour rim and the lite tier's lamp
// patch (withGardenLight), so she sits in the same light as the hedge she browses.
import * as THREE from "three";
import type { DoeLengths } from "@/components/deer/build";
import type { Quality } from "@/lib/garden/store";
import { withGardenLight } from "@/lib/garden/dressing";

/** The palette (sRGB hex, albedo). */
export const COAT = {
  stripe: "#4e3022",
  back: "#7e5036",
  nape: "#6a4632",
  upperFlank: "#8c5c40",
  lowerFlank: "#9a7052",
  fringe: "#b08c6e",
  haunch: "#87583c",
  neck: "#96806c",
  neckTop: "#7e6450",
  face: "#9d876c",
  forehead: "#5f4e4a",
  eyeRing: "#c4b6a4",
  earOut: "#8a715c",
  earRim: "#3a2a24",
  earSkin: "#c89a90",
  legUpper: "#a3876c",
  legLower: "#bba98f",
  white: "#e8e3d8",
  bib: "#ece8df",
  spot: "#e4ded2",
  tailTop: "#3e2a24",
  nose: "#2a2427",
  eye: "#1e120d",
  hoof: "#2e2a29",
} as const;

const GLSL = /* glsl */ `
#include <common>
varying vec4 vCoat;
uniform vec4 uLen;      // body, head, fore, hind lofts' lengths
uniform vec4 uMarks;    // neck start, elbow, stifle (along the body), thigh loft length
uniform float uSeed;
uniform vec3 cStripe, cBack, cNape, cUpper, cLower, cFringe, cHaunch, cNeck, cNeckTop, cFace, cForehead, cEyeRing,
  cEarOut, cEarRim, cEarSkin, cLegUp, cLegLow, cWhite, cBib, cSpot, cTail, cNose, cEye, cHoof;

float dh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
vec2 dh2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + uSeed) * 43758.5453); }
float dnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dh1(i), dh1(i + vec2(1.0, 0.0)), u.x), mix(dh1(i + vec2(0.0, 1.0)), dh1(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** A soft step about \`edge\`, at least a pixel wide wherever it is seen from, so nothing shimmers. */
float soft(float edge, float width, float x) { float w = max(width, fwidth(x)); return smoothstep(edge - w, edge + w, x); }

/**
 * One oval spot's coverage: q its offset from the spot's centre (along the hair, across), r its half-length; the edge
 * feathered along the hair by streak noise, as hair tips break it.
 */
float spot(vec2 q, float r, float aspect, float streak) {
  float d = length(vec2(q.x / aspect, q.y)) - r / aspect;
  return 1.0 - soft(0.0, r * 0.18 + 0.0015, d + streak * 0.0015);
}

/**
 * The body's spots. s along the body (m), d round from the spine (m), h the height above the belly's white edge (m),
 * side +-1 (each side seeded on its own).
 */
float spots(float s, float d, float h, float side, float streak) {
  float cover = 0.0;
  // the two tidy rows by the stripe: small, round, evenly spaced
  for (int row = 0; row < 2; row++) {
    float off = row == 0 ? 0.026 : 0.058;
    float gap = row == 0 ? 0.038 : 0.046;
    float shift = dh1(vec2(float(row), side * 5.0)) * gap;
    float c = floor((s - shift) / gap);
    for (int j = -1; j <= 1; j++) {
      vec2 id = vec2(c + float(j), float(row) + side * 11.0);
      vec2 h2 = dh2(id);
      if (h2.x < 0.1) continue;
      float cs = shift + (c + float(j) + 0.5 + (h2.y - 0.5) * 0.3) * gap;
      float cd = off + (dh1(id + 3.7) - 0.5) * 0.008;
      float r = (row == 0 ? 0.0055 : 0.0075) * (0.8 + 0.4 * dh1(id + 1.3));
      cover = max(cover, spot(vec2(s - cs, d - cd), r * (row == 0 ? 1.2 : 1.5), row == 0 ? 1.2 : 1.5, streak));
    }
  }
  // the flank: a jittered grid, about 550 spots a square metre, ovals along the hair, sloping down toward the rear
  vec2 g = vec2(s / 0.044, (d - 0.08) / 0.04);
  vec2 cell = floor(g);
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 id = cell + vec2(float(i), float(j)) + vec2(0.0, side * 31.0);
      if (id.y - side * 31.0 < 0.0) continue;
      vec2 h2 = dh2(id);
      if (dh1(id + 9.1) < 0.12) continue;
      vec2 c = (id - vec2(0.0, side * 31.0) + 0.06 + 0.88 * h2);
      float cs = c.x * 0.044;
      float cd = 0.08 + c.y * 0.04;
      float tilt = 0.25;
      vec2 q = vec2(s - cs, d - cd);
      q = vec2(q.x * cos(tilt) - q.y * sin(tilt) * side, q.x * sin(tilt) * side + q.y * cos(tilt));
      float r = (0.0085 + 0.004 * dh1(id + 6.6)) * (0.75 + 0.5 * dh1(id + 4.2));
      cover = max(cover, spot(q, r, 1.9, streak));
    }
  }
  // the broken white line low on the flank, 4-6 cm above the belly's edge, behind the elbow and ahead of the stifle
  float line = (1.0 - soft(0.0055, 0.002, abs(h - 0.05))) * step(0.42, dnoise(vec2(s * 26.0, side * 7.0)));
  line *= soft(uMarks.z + 0.02, 0.02, s) * (1.0 - soft(uMarks.y - 0.04, 0.02, s));
  // no spots between the line and the white belly
  cover *= soft(0.075, 0.008, h);
  return max(cover, line);
}

/**
 * The short coat's grain: fine streaks along the hair (along each part, round it a little), as a height for a bump.
 * Faded out wherever a pixel covers more than a few millimetres of coat, so at a distance it never shimmers.
 */
float furHeight(vec4 c) {
  float part = c.z + 0.5;
  if (part > 6.0 && part < 7.0) return 0.0;
  vec2 p = vec2(c.x * 260.0, c.y * 70.0);
  return dnoise(p) * 0.65 + dnoise(p * vec2(2.1, 2.7) + 5.0) * 0.35;
}
float furFade(vec4 c) { return 1.0 - smoothstep(0.0015, 0.0045, max(fwidth(c.x), fwidth(c.y))); }

vec3 deerCoat(vec4 c, out float rough) {
  float s = c.x;
  float a = c.y;
  float part = c.z + 0.5;
  float t = c.w;
  float d = abs(a);
  // 0 on the front line (spine, top of the head, front of a leg), 1 at the seam beneath (belly, back of a leg)
  float dn = abs(t - 0.5) * 2.0;
  float side = a >= 0.0 ? 1.0 : -1.0;
  float streak = dnoise(vec2(s * 220.0, a * 40.0)) - 0.5;
  // low blotching and fine streaks along the hair: no flat colour anywhere
  float hair = 1.0 + 0.045 * (dnoise(vec2(s * 9.0, a * 7.0)) - 0.5) + 0.05 * streak;
  rough = 0.92;
  vec3 col;
  if (part < 1.0) {
    // ---- body and neck ----
    float neck = smoothstep(uMarks.x - 0.05, uMarks.x + 0.06, s);
    float haunch = 1.0 - smoothstep(0.1, 0.22, s);
    col = mix(cBack, cUpper, smoothstep(0.1, 0.3, dn));
    col = mix(col, cLower, smoothstep(0.5, 0.72, dn));
    col = mix(col, cHaunch, haunch * 0.6);
    col = mix(col, cNape, smoothstep(uMarks.x - 0.18, uMarks.x, s) * (1.0 - smoothstep(0.08, 0.3, dn)) * 0.7);
    col = mix(col, mix(cNeckTop, cNeck, smoothstep(0.08, 0.4, dn)), neck);
    // the dark stripe down the spine
    float stripeW = mix(0.013, 0.009, neck) + 0.002 * (dnoise(vec2(s * 12.0, 1.0)) - 0.5);
    col = mix(col, cStripe, (1.0 - soft(stripeW, 0.004, d)) * smoothstep(0.02, 0.06, s));
    // where the belly's white edge is: a soft step with a buff fringe, and the height above it in metres
    float edge = 0.79 + 0.025 * (dnoise(vec2(s * 18.0, side)) - 0.5);
    float circ = d / max(dn, 1e-3);
    float above = (edge - dn) * circ;
    // the spots: from the haunch to the shoulder, thinning there, none on the neck
    float zone = smoothstep(0.015, 0.05, s) * (1.0 - smoothstep(uMarks.y + 0.02, uMarks.x - 0.02, s));
    float sp = spots(s, d, above, side, streak) * zone * step(0.017, d);
    col = mix(col, cSpot, sp * 0.82);
    col = mix(col, cFringe, (1.0 - soft(0.015, 0.006, above)) * (1.0 - neck));
    float belly = soft(edge, 0.012, dn) * (1.0 - neck * 0.7);
    // the throat: a white bib high under the jaw and a narrow strip down the underside of the neck
    float bib = soft(0.55, 0.03, dn) * smoothstep(uLen.x - 0.14, uLen.x - 0.08, s);
    float strip = soft(0.9, 0.02, dn) * smoothstep(uLen.x - 0.2, uLen.x - 0.12, s);
    col = mix(col, cWhite, max(belly, strip));
    col = mix(col, cBib, bib);
  } else if (part < 2.0) {
    // ---- head: s from behind the ears to the nose ----
    float hs = s / uLen.y;
    col = mix(cForehead, cFace, smoothstep(0.12, 0.42, dn));
    // the dusky line narrows down the bridge of the nose
    col = mix(col, cForehead, (1.0 - soft(mix(0.025, 0.01, hs), 0.004, d)) * smoothstep(0.35, 0.5, hs));
    // the pale ring round the eye, widest below and ahead of it
    float er = length(vec2((s - 0.13) * 0.9, (d - 0.047) * 1.25 + 0.004));
    col = mix(col, cEyeRing, (1.0 - soft(0.02, 0.004, er)) * 0.85);
    // the preorbital gland: a dark slit ahead of and below the eye
    float gl = length(vec2((s - 0.158) * 0.45, d - 0.055));
    col = mix(col, cNose, (1.0 - soft(0.006, 0.002, gl)) * 0.7);
    // white chin, lower lip and upper-lip band; the throat under the jaw
    col = mix(col, cWhite * 0.92, soft(0.7, 0.02, dn) * smoothstep(0.7, 0.8, hs));
    col = mix(col, cBib, soft(0.72, 0.02, dn) * (1.0 - smoothstep(0.3, 0.45, hs)));
    // a dusky band behind the nose pad, then the wet nose
    float band = smoothstep(0.84, 0.87, hs) * (1.0 - smoothstep(0.9, 0.92, hs)) * (1.0 - smoothstep(0.5, 0.7, dn));
    col = mix(col, cForehead * 0.8, band * 0.8);
    float lip = smoothstep(0.9, 0.92, hs) * soft(0.45, 0.04, dn) * (1.0 - soft(0.7, 0.04, dn));
    col = mix(col, cWhite, lip * 0.6);
    float nose = smoothstep(0.915, 0.94, hs) * (1.0 - soft(0.5, 0.05, dn));
    col = mix(col, cNose, nose);
    rough = mix(0.82, 0.3, nose);
  } else if (part < 4.0) {
    // ---- legs: s from the top; outside fawn to buff, inside and behind white; a white band above the hoof ----
    float len = part < 3.0 ? uLen.z : uLen.w;
    float down = s / len;
    col = mix(cLegUp, cLegLow, smoothstep(0.35, 0.7, down));
    // on the foreleg the shoulder and upper arm carry the body's colour
    if (part < 3.0) col = mix(cUpper, col, smoothstep(0.18, 0.32, down));
    float inside = soft(0.0, 0.006, -a) * 0.9 + soft(0.8, 0.04, dn) * 0.8;
    col = mix(col, cWhite, clamp(inside, 0.0, 1.0));
    float band = smoothstep(len - 0.07, len - 0.062, s) * (1.0 - smoothstep(len - 0.05, len - 0.044, s));
    col = mix(col, cWhite, band * 0.6);
    float hoof = smoothstep(len - 0.045, len - 0.038, s);
    col = mix(col, cHoof, hoof);
    rough = mix(0.8, 0.5, hoof);
  } else if (part < 5.0) {
    // ---- ears: t under 0.5 is the cupped inside ----
    float len = 0.13;
    float inside = 1.0 - soft(0.5, 0.01, t);
    vec3 inner = mix(cEarSkin, cWhite, 0.55 + 0.35 * dnoise(vec2(s * 120.0, t * 30.0)));
    col = mix(mix(cEarOut, cEarRim, smoothstep(0.06, 0.12, s)), inner, inside);
    float rim = max(1.0 - soft(0.06, 0.01, t), soft(0.94, 0.01, t)) + (1.0 - soft(0.06, 0.01, abs(t - 0.5)));
    col = mix(col, cEarRim, clamp(rim, 0.0, 1.0) * (0.55 + 0.4 * smoothstep(0.04, 0.1, s)));
    rough = 0.85;
  } else if (part < 6.0) {
    // ---- tail: fawn at the root turning dark; long white hair at the sides and beneath ----
    col = mix(cBack, cTail, smoothstep(0.02, 0.05, s));
    col = mix(col, cWhite, 1.0 - soft(0.55, 0.06, dn));
  } else if (part < 7.0) {
    // ---- eye ----
    col = cEye;
    rough = 0.06;
    hair = 1.0;
  } else {
    // ---- the thigh and gaskin: s down from the rump; the haunch spotted, the gaskin leg-coloured, a white margin
    //      along the back edge and inside ----
    col = mix(cHaunch, cUpper, smoothstep(0.0, 0.12, s));
    col = mix(col, cLegUp, smoothstep(0.16, 0.26, s));
    float sp = spots(s + 3.0, d + 0.02, 1.0, side, streak) * (1.0 - smoothstep(0.12, 0.2, s)) * soft(0.0, 0.01, a);
    col = mix(col, cSpot, sp * 0.9);
    float back = soft(0.9, 0.03, dn);
    col = mix(col, cWhite, max(back, soft(0.0, 0.008, -a) * 0.85));
  }
  return col * hair;
}
`;

/**
 * The fur grain as a bump on the shading normal (Mikkelsen's surface-gradient bump, as three's bump map does it),
 * from the coat's own coordinates, so it needs no texture.
 */
const FUR_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  float fade = furFade(vCoat);
  if (fade > 0.0) {
    float hh = furHeight(vCoat) * 0.0009 * fade;
    vec3 pos = -vViewPosition;
    vec3 dpx = dFdx(pos);
    vec3 dpy = dFdy(pos);
    vec3 r1 = cross(dpy, normal);
    vec3 r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2);
    normal = normalize(abs(det) * normal - grad);
  }
}
`;

/** The coat's material for a tier. */
export function coatMaterial(tier: Quality, lengths: DoeLengths, seed: number): THREE.MeshStandardMaterial {
  const params = { color: 0xffffff, roughness: 0.92, metalness: 0 };
  const m: THREE.MeshStandardMaterial =
    tier === "lite"
      ? new THREE.MeshStandardMaterial(params)
      : new THREE.MeshPhysicalMaterial({ ...params, specularIntensity: 0.35, sheen: 0.25, sheenRoughness: 0.75, sheenColor: new THREE.Color("#b88a62") });
  const colour = (hex: string) => ({ value: new THREE.Color(hex) });
  const uniforms: Record<string, THREE.IUniform> = {
    uLen: { value: new THREE.Vector4(lengths.body, lengths.head, lengths.fore, lengths.hind) },
    uMarks: { value: new THREE.Vector4(lengths.neckAt, lengths.elbowAt, lengths.stifleAt, lengths.thigh) },
    uSeed: { value: seed },
    cStripe: colour(COAT.stripe),
    cBack: colour(COAT.back),
    cNape: colour(COAT.nape),
    cUpper: colour(COAT.upperFlank),
    cLower: colour(COAT.lowerFlank),
    cFringe: colour(COAT.fringe),
    cHaunch: colour(COAT.haunch),
    cNeck: colour(COAT.neck),
    cNeckTop: colour(COAT.neckTop),
    cFace: colour(COAT.face),
    cForehead: colour(COAT.forehead),
    cEyeRing: colour(COAT.eyeRing),
    cEarOut: colour(COAT.earOut),
    cEarRim: colour(COAT.earRim),
    cEarSkin: colour(COAT.earSkin),
    cLegUp: colour(COAT.legUpper),
    cLegLow: colour(COAT.legLower),
    cWhite: colour(COAT.white),
    cBib: colour(COAT.bib),
    cSpot: colour(COAT.spot),
    cTail: colour(COAT.tailTop),
    cNose: colour(COAT.nose),
    cEye: colour(COAT.eye),
    cHoof: colour(COAT.hoof),
  };
  m.userData.coat = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aCoat;\nvarying vec4 vCoat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCoat = aCoat;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", GLSL)
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat coatRough;\ndiffuseColor.rgb *= deerCoat(vCoat, coatRough);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = coatRough;")
      .replace("#include <normal_fragment_maps>", FUR_BUMP);
  };
  m.customProgramCacheKey = () => `deer-coat|${tier}`;
  return withGardenLight(m, `deer-coat|${tier}`, true);
}
