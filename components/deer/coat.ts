"use client";
// The doe's coat, painted in the shader from each vertex's place on its part (loft.ts aCoat): no texture to download
// or hold in memory, crisp at any distance, and seeded, so every garden's doe has her own spots, different on each
// side, as a real chital's are.
//
// The colours and the pattern follow the coat reference gathered for this design (Blanford 1888-91, Lydekker 1898,
// Prater 1948, and colour samples from side-on photographs of chital does) and four independent critiques of the first
// renders against those photographs. One fawn-rufous tone runs over the body, neck and legs (a darker, saturated body
// with pale legs and a grey neck read as a toy in white socks); the white is only underneath, inside and behind the
// lower legs, a band above each hoof, a compact bib under the jaw, the chin and the lips. A dark chocolate stripe runs
// down the spine from the nape; two tidy rows of small round spots hug it up onto the nape; looser rows of larger ovals
// follow the back down the flank and over the shoulder; a near-continuous white line of merged spots runs low along
// the flank from behind the elbow onto the haunch, with no spots below it. The face is grey-fawn with a dusky forehead
// and nose bridge, a thin pale ring round a large dark eye, a dark wet nose pad with a dusky band behind it. Ears
// fawn-grey outside with a dark rim, pale inside and shaded; the tail dark on top and on its sides, white beneath.
//
// What keeps her from reading as a painted figure: tonal structure at the scales that survive at 4.5-8 m (hair tracts
// a few centimetres long running along the hair, low blotching), the same tracts as a faint bump on the shading normal
// (faded wherever a pixel covers more than a few millimetres, so nothing shimmers), occlusion baked into the creases
// (under the belly, the tops of the legs, inside the thighs and the ears), a weak sheen tinted by the coat, and a rim of
// her own: the garden's backlit rim, but softer and wider, on the faces toward the sun and the sky only, broken up by
// the hair tracts, with the thin ears glowing when the low sun is behind them.
//
// The material is the garden's own kind (MeshPhysicalMaterial on the richer tiers, MeshStandardMaterial on lite) and
// takes the garden's lamp patch for the lite tier (withGardenLight), so she sits in the same light as the hedge.
import * as THREE from "three";
import type { DoeLengths } from "@/components/deer/build";
import type { Quality } from "@/lib/garden/store";
import { withGardenLight } from "@/lib/garden/dressing";

/** The palette (sRGB hex, albedo). */
export const COAT = {
  stripe: "#43281a",
  back: "#7a5538",
  nape: "#6a4b35",
  upperFlank: "#946a4a",
  lowerFlank: "#9c7656",
  fringe: "#b08c6e",
  haunch: "#8c6447",
  neck: "#8f6d55",
  neckTop: "#77573f",
  face: "#94745a",
  forehead: "#5f4e4a",
  eyeRing: "#b8a38c",
  earOut: "#8c7462",
  earRim: "#3a2a24",
  earSkin: "#c89a90",
  legUpper: "#94704f",
  legLower: "#a07c5a",
  white: "#dcd5c8",
  bib: "#e2dccf",
  spot: "#e4ded2",
  tailTop: "#3e2a24",
  nose: "#3d3638",
  eye: "#1e120d",
  hoof: "#2e2a29",
} as const;

const GLSL = /* glsl */ `
#include <common>
varying vec4 vCoat;
uniform vec4 uLen;      // body, head, fore, hind lofts' lengths
uniform vec4 uMarks;    // neck start, elbow, stifle (along the body)
uniform vec4 uFore;     // along the foreleg: elbow, knee, fetlock; its length
uniform vec4 uHind;     // along the hind leg: stifle, hock, fetlock; its length
uniform vec2 uEye;      // the eye on the head's coat: along it, round from its top
uniform float uSeed;
uniform vec3 cStripe, cBack, cNape, cUpper, cLower, cFringe, cHaunch, cNeck, cNeckTop, cFace, cForehead, cEyeRing,
  cEarOut, cEarRim, cEarSkin, cLegUp, cLegLow, cWhite, cBib, cSpot, cTail, cNose, cEye, cHoof;

// set by deerCoat for the lighting further down the shader
float coatRimK = 1.0;
float coatEar = 0.0;
float coatAO = 1.0;
float coatH = 0.0;

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
  return 1.0 - soft(0.0, r * 0.18 + 0.0015, d + streak * 0.002);
}

/**
 * The body's spots. s along the body (m), d round from the spine (m), h the height above the belly's white edge (m),
 * side +-1 (each side seeded on its own), rows the zone of the two rows by the stripe, flank the zone of the rest.
 */
float spots(float s, float d, float h, float side, float streak, float rows, float flank) {
  float cover = 0.0;
  // the two tidy rows by the stripe: small, round, evenly spaced, running up onto the nape
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
      float r = (row == 0 ? 0.0065 : 0.0088) * (0.8 + 0.4 * dh1(id + 1.3));
      cover = max(cover, rows * spot(vec2(s - cs, d - cd), r * (row == 0 ? 1.2 : 1.4), row == 0 ? 1.2 : 1.4, streak));
    }
  }
  // the flank: loose rows of ovals, longer along the hair and sloping down toward the rear, jittered along them
  vec2 g = vec2(s / 0.05, (d - 0.08) / 0.046);
  vec2 cell = floor(g);
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 id = cell + vec2(float(i), float(j)) + vec2(0.0, side * 31.0);
      if (id.y - side * 31.0 < 0.0) continue;
      vec2 h2 = dh2(id);
      if (dh1(id + 9.1) < 0.16) continue;
      vec2 c = id - vec2(0.0, side * 31.0) + vec2(0.06 + 0.88 * h2.x, 0.25 + 0.5 * h2.y);
      float cs = c.x * 0.05;
      float cd = 0.08 + c.y * 0.046;
      float tilt = 0.25;
      vec2 q = vec2(s - cs, d - cd);
      q = vec2(q.x * cos(tilt) - q.y * sin(tilt) * side, q.x * sin(tilt) * side + q.y * cos(tilt));
      float r = (0.0115 + 0.005 * dh1(id + 6.6)) * (0.8 + 0.4 * dh1(id + 4.2));
      cover = max(cover, flank * spot(q, r, 1.5, streak));
    }
  }
  // the white line low on the flank, 4-6 cm above the belly's edge, from behind the elbow back onto the haunch, where
  // it lifts a little; long dashes, short gaps
  float lift = 0.45 * max(0.0, uMarks.z + 0.04 - s);
  float line = (1.0 - soft(0.0065, 0.002, abs(h - 0.05 - lift))) * step(0.2, dnoise(vec2(s * 14.0, side * 7.0)));
  line *= soft(uMarks.z - 0.03, 0.03, s) * (1.0 - soft(uMarks.y - 0.04, 0.02, s));
  // no spots between the line and the white belly
  cover *= soft(0.075, 0.008, h);
  return max(cover, line);
}

vec3 deerCoat(vec4 c, out float rough) {
  float s = c.x;
  float a = c.y;
  float part = c.z + 0.5;
  float t = c.w;
  float d = abs(a);
  // 0 on the front line (spine, top of the head, front of a leg), 1 at the seam beneath (belly, back of a leg)
  float dn = abs(t - 0.5) * 2.0;
  float side = a >= 0.0 ? 1.0 : -1.0;
  // hair tracts (a few cm long along the hair) and finer clumps, each faded before it reaches the pixel; low blotching
  vec2 pT = vec2(s * 20.0, a * 60.0);
  vec2 pS = vec2(s * 70.0, a * 300.0);
  vec2 wT = fwidth(pT);
  vec2 wS = fwidth(pS);
  float tract = (dnoise(pT) - 0.5) * (1.0 - smoothstep(0.3, 0.7, max(wT.x, wT.y)));
  float streak = (dnoise(pS) - 0.5) * (1.0 - smoothstep(0.3, 0.7, max(wS.x, wS.y)));
  float blotch = dnoise(vec2(s * 5.0, a * 6.0)) - 0.5;
  float seamFade = 1.0 - smoothstep(0.85, 0.97, dn);
  float hair = 1.0 + (0.16 * blotch + 0.14 * tract + 0.08 * streak) * seamFade;
  coatH = (0.0009 * tract + 0.00025 * streak) * seamFade;
  coatRimK = 0.55 * (0.6 + 0.8 * dnoise(vec2(s * 9.0, a * 25.0)));
  coatEar = 0.0;
  coatAO = 1.0;
  rough = 0.92;
  vec3 col;
  if (part < 1.0) {
    // ---- body and neck ----
    float neck = smoothstep(uMarks.x - 0.02, uMarks.x + 0.16, s);
    float haunch = 1.0 - smoothstep(0.1, 0.22, s);
    col = mix(cBack, cUpper, smoothstep(0.1, 0.3, dn));
    col = mix(col, cLower, smoothstep(0.5, 0.72, dn));
    col = mix(col, cHaunch, haunch * 0.6);
    col = mix(col, cNape, smoothstep(uMarks.x - 0.18, uMarks.x, s) * (1.0 - smoothstep(0.08, 0.3, dn)) * 0.7);
    col = mix(col, mix(cNeckTop, cNeck, smoothstep(0.08, 0.4, dn)), neck);
    // the dark stripe down the spine, on up the nape
    float stripeW = mix(0.013, 0.011, neck) + 0.002 * (dnoise(vec2(s * 12.0, 1.0)) - 0.5);
    col = mix(col, cStripe, (1.0 - soft(stripeW, 0.004, d)) * smoothstep(0.02, 0.06, s));
    // where the belly's white edge is, and the height above it in metres
    float edge = 0.79 + 0.025 * (dnoise(vec2(s * 18.0, side)) - 0.5);
    float circ = d / max(dn, 1e-3);
    float above = (edge - dn) * circ;
    // the spots: the rows by the stripe up onto the nape; the flank's over the shoulder, thinning at the neck's base
    float rows = smoothstep(0.015, 0.05, s) * (1.0 - smoothstep(uMarks.x + 0.06, uMarks.x + 0.15, s));
    float flank = smoothstep(0.015, 0.05, s) * (1.0 - smoothstep(uMarks.x - 0.04, uMarks.x + 0.05, s));
    float sp = spots(s, d, above, side, streak, rows, flank) * (1.0 - smoothstep(0.6, 0.72, dn)) * step(0.017, d);
    col = mix(col, cSpot, sp * 0.93);
    col = mix(col, cFringe, (1.0 - soft(0.008, 0.004, above)) * (1.0 - neck) * 0.4);
    float belly = soft(edge, 0.012, dn) * (1.0 - neck);
    // the throat: a compact bib under the jaw, a narrow strip below it on the upper neck
    float bib = soft(0.72, 0.03, dn) * smoothstep(uLen.x - 0.12, uLen.x - 0.07, s);
    float strip = soft(0.94, 0.02, dn) * smoothstep(uLen.x - 0.2, uLen.x - 0.12, s) * 0.7;
    col = mix(col, cWhite, max(belly, strip));
    col = mix(col, cBib, bib);
    // shadowed beneath her, and in the elbow pit, the flank fold and where the neck meets the chest
    col *= mix(1.0, 0.72, smoothstep(0.7, 1.0, dn) * (1.0 - neck));
    float g1 = (s - uMarks.y + 0.03) / 0.06;
    float g2 = (s - uMarks.z - 0.05) / 0.07;
    float g3 = (s - uMarks.x) / 0.08;
    coatAO = 1.0 - 0.45 * max(max(exp(-g1 * g1) * smoothstep(0.55, 0.85, dn), exp(-g2 * g2) * smoothstep(0.5, 0.85, dn)), exp(-g3 * g3) * smoothstep(0.65, 0.9, dn));
    coatRimK *= 1.0 - 0.5 * belly;
  } else if (part < 2.0) {
    // ---- head: s from behind the ears to the nose ----
    float hs = s / uLen.y;
    col = mix(cForehead, cFace, smoothstep(0.12, 0.42, dn));
    // the dusky line narrows down the bridge of the nose
    col = mix(col, cForehead, (1.0 - soft(mix(0.025, 0.01, hs), 0.004, d)) * smoothstep(0.35, 0.5, hs));
    // round the almond eye: its dark lids, then a pale ring, widest below and ahead of it
    vec2 eq = vec2((s - uEye.x) / 0.0185, (d - uEye.y) / 0.0125);
    float er = length(eq);
    col = mix(col, cEyeRing, (1.0 - soft(1.55, 0.2, length(eq - vec2(0.15, 0.22)))) * soft(1.12, 0.06, er) * 0.28);
    col = mix(col, cNose, (1.0 - soft(1.1, 0.05, er)) * 0.75);
    // the preorbital gland: a fine dark slit running forward and down from the eye's front corner
    vec2 g0 = vec2(uEye.x + 0.017, uEye.y + 0.004);
    vec2 gb = vec2(0.027, 0.012);
    vec2 gp = vec2(s, d) - g0;
    float gh = clamp(dot(gp, gb) / dot(gb, gb), 0.0, 1.0);
    col = mix(col, cNose, (1.0 - soft(0.0015 * (1.0 - 0.6 * gh), 0.0007, length(gp - gb * gh))) * 0.55);
    // the mouth: a fine dark line from under the nose back to its corner, the lower lip and chin white beneath it
    float halfC = d / max(dn, 1e-3);
    float mouthDn = 0.7 - 0.05 * smoothstep(0.84, 0.93, hs);
    float mouth = (1.0 - soft(0.0012, 0.0006, abs(dn - mouthDn) * halfC)) * smoothstep(0.73, 0.76, hs) * (1.0 - smoothstep(0.92, 0.94, hs));
    col = mix(col, cWhite * 0.95, soft(mouthDn + 0.015, 0.01, dn) * smoothstep(0.72, 0.8, hs));
    col = mix(col, cNose, mouth * 0.85);
    // the throat under the jaw
    col = mix(col, cBib, soft(0.74, 0.02, dn) * (1.0 - smoothstep(0.3, 0.45, hs)));
    // a dusky band behind the nose pad, then the wet nose and the white upper-lip band
    float band = smoothstep(0.84, 0.87, hs) * (1.0 - smoothstep(0.9, 0.92, hs)) * (1.0 - smoothstep(0.5, 0.7, dn));
    col = mix(col, cForehead * 0.8, band * 0.8);
    float lip = smoothstep(0.9, 0.92, hs) * soft(0.45, 0.04, dn) * (1.0 - soft(0.7, 0.04, dn));
    col = mix(col, cWhite, lip * 0.6);
    float nose = smoothstep(0.915, 0.94, hs) * (1.0 - soft(0.5, 0.05, dn));
    col = mix(col, cNose, nose);
    // the nostrils: comma-shaped openings on the front of the nose pad, either side
    float nos = length(vec2((s - 0.952 * uLen.y) / 0.0045, (d - 0.023) / 0.009));
    col = mix(col, cEye * 0.35, (1.0 - soft(1.0, 0.18, nos)) * nose);
    rough = mix(0.88, 0.3, nose);
    coatAO = mix(1.0, 0.8, soft(0.8, 0.05, dn) * (1.0 - smoothstep(0.25, 0.45, hs)));
  } else if (part < 4.0) {
    // ---- legs, each one loft from inside the body to the hoof: s down it, past the marks of its joints (uFore: the
    //      elbow, knee and fetlock; uHind: the stifle, hock and fetlock) to its length. Above the elbow or stifle the
    //      body's coat (the shoulder; the haunch with its spots); below it the flank's fawn, paler from the knee or
    //      hock down; a cream wash inside; white down the back from the elbow or the hock; a white band above the
    //      hoof, dark dewclaws behind the fetlock, the hind cannon's dark gland outside below the hock; the hoof. ----
    bool fore = part < 3.0;
    vec4 mk = fore ? uFore : uHind;
    float len = mk.w;
    float halfC = d / max(dn, 1e-3);
    vec3 body = fore ? cUpper : mix(cHaunch, cUpper, smoothstep(0.0, 0.12, s));
    col = mix(cLegUp, cLegLow, smoothstep(mk.y - 0.01, mk.y + 0.07, s));
    col = mix(col, body, 1.0 - smoothstep(mk.x - 0.03, mk.x + 0.03, s));
    if (!fore) {
      float sp = spots(s + 3.0, d + 0.02, 1.0, side, streak, 0.0, 1.0) * (1.0 - smoothstep(mk.x - 0.07, mk.x - 0.01, s)) * soft(0.0, 0.01, a);
      col = mix(col, cSpot, sp * 0.93);
    }
    float inner = soft(0.012, 0.006, -a) * smoothstep(mk.x - 0.02, mk.x + 0.04, s) * 0.6;
    float from = fore ? mk.x : mk.y - 0.02;
    float backEdge = soft(0.84, 0.04, dn) * smoothstep(from, from + 0.04, s) * 0.75;
    // the white margin up the back of the thigh
    if (!fore) backEdge = max(backEdge, soft(0.9, 0.03, dn) * (1.0 - smoothstep(mk.y - 0.03, mk.y + 0.01, s)) * 0.65);
    col = mix(col, mix(cWhite, cLegLow, 0.25), clamp(max(inner, backEdge), 0.0, 1.0));
    if (!fore) {
      float mg = length(vec2((s - mk.y - 0.075) / 0.014, (dn - 0.5) / 0.14));
      col = mix(col, cStripe, (1.0 - soft(1.0, 0.2, mg)) * step(0.0, a) * 0.7);
    }
    float band = smoothstep(len - 0.062, len - 0.055, s) * (1.0 - smoothstep(len - 0.042, len - 0.036, s));
    col = mix(col, cWhite, band * 0.75);
    float dew = 1.0 - soft(1.0, 0.2, length(vec2((s - mk.z + 0.008) / 0.008, (1.0 - dn) * halfC / 0.009)));
    col = mix(col, cHoof, dew * 0.9);
    float hoof = smoothstep(len - 0.038, len - 0.032, s);
    col = mix(col, cHoof, hoof);
    rough = mix(0.9, 0.45, max(hoof, dew));
    coatAO = mix(0.6, 1.0, smoothstep(mk.x - 0.05, mk.x + 0.04, s)) * mix(1.0, 0.85, soft(0.0, 0.01, -a));
    coatRimK *= 0.6;
  } else if (part < 5.0) {
    // ---- ears: t under 0.5 is the cupped inside, in shade; dark only at the rim and the tip ----
    float inside = (1.0 - soft(0.5, 0.01, t)) * smoothstep(0.015, 0.035, s);
    vec3 inner = mix(cEarSkin, cWhite, 0.3 + 0.25 * dnoise(vec2(s * 120.0, t * 30.0))) * 0.85;
    col = mix(mix(cEarOut, cEarRim, smoothstep(0.112, 0.13, s) * 0.8), inner, inside);
    float rim = max(1.0 - soft(0.06, 0.01, t), soft(0.94, 0.01, t)) + (1.0 - soft(0.06, 0.01, abs(t - 0.5)));
    col = mix(col, cEarRim, clamp(rim, 0.0, 1.0) * (0.55 + 0.4 * smoothstep(0.04, 0.1, s)));
    rough = 0.9;
    coatAO = mix(1.0, 0.55, inside * (1.0 - smoothstep(0.0, 0.07, s)));
    coatRimK *= 1.6;
    coatEar = 1.0;
  } else if (part < 6.0) {
    // ---- tail: fawn at the root turning dark; white only beneath ----
    col = mix(cBack, cTail, smoothstep(0.02, 0.05, s));
    col = mix(col, cWhite, 1.0 - soft(0.35, 0.06, dn));
  } else {
    // ---- eye ----
    col = cEye;
    rough = 0.06;
    hair = 1.0;
    coatH = 0.0;
    coatRimK = 0.0;
  }
  return col * hair;
}
`;

/**
 * The coat's grain as a bump on the shading normal: the hair tracts from deerCoat (coatH, in metres, already faded
 * where a pixel covers more than a few millimetres), by Mikkelsen's surface-gradient bump as three's bump map does it,
 * so it needs no texture and no tangents.
 */
const FUR_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dFdx(coatH) * r1 + dFdy(coatH) * r2));
}
`;

/** The garden's backlit-rim line (lib/garden/dressing.ts RIM), which the doe reshapes for herself. */
const GARDEN_RIM = "float rim = edge * behind * clamp(dot(normal, rL) * 0.6 + 0.5, 0.0, 1.0);";
/**
 * Her rim: softer and wider than the garden's, only on faces turned toward the sun and toward the sky (never the belly
 * or the fronts of the legs), broken up by the hair tracts; and the thin ears glowing warm when the low sun is behind.
 */
const DOE_RIM = /* glsl */ `
  float upV = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float rim = pow(1.0 - clamp(dot(normal, rV), 0.0, 1.0), 1.8) * behind * smoothstep(-0.05, 0.45, dot(normal, rL))
    * (0.25 + 0.75 * smoothstep(-0.35, 0.45, upV)) * coatRimK * 0.55;
  if (coatEar > 0.5) reflectedLight.directDiffuse += directionalLights[0].color * uRim * vec3(1.0, 0.45, 0.32) * 0.45
    * pow(max(0.0, dot(-rV, rL)), 3.0);`;

/** The coat's material for a tier. */
export function coatMaterial(tier: Quality, lengths: DoeLengths, seed: number): THREE.MeshStandardMaterial {
  const params = { color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 };
  const m: THREE.MeshStandardMaterial =
    tier === "lite"
      ? new THREE.MeshStandardMaterial(params)
      : new THREE.MeshPhysicalMaterial({ ...params, specularIntensity: 0.15, sheen: 0.2, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffffff") });
  const colour = (hex: string) => ({ value: new THREE.Color(hex) });
  const uniforms: Record<string, THREE.IUniform> = {
    uLen: { value: new THREE.Vector4(lengths.body, lengths.head, lengths.fore, lengths.hind) },
    uMarks: { value: new THREE.Vector4(lengths.neckAt, lengths.elbowAt, lengths.stifleAt, 0) },
    uFore: { value: new THREE.Vector4(...lengths.foreMarks, lengths.fore) },
    uHind: { value: new THREE.Vector4(...lengths.hindMarks, lengths.hind) },
    uEye: { value: new THREE.Vector2(lengths.eyeS, lengths.eyeD) },
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
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat coatRough;\ndiffuseColor.rgb *= deerCoat(vCoat, coatRough) * mix(1.0, coatAO, 0.35);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = coatRough;")
      .replace("#include <normal_fragment_maps>", FUR_BUMP)
      .replace(
        "#include <lights_physical_fragment>",
        "#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor *= 0.2 + 0.9 * diffuseColor.rgb;\n#endif",
      )
      .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= coatAO;\nreflectedLight.indirectSpecular *= coatAO;");
  };
  m.customProgramCacheKey = () => `deer-coat|${tier}`;
  // the garden's lamp patch and rim, then the rim reshaped for her
  const lit = withGardenLight(m, `deer-coat|${tier}`, true);
  const garden = lit.onBeforeCompile;
  lit.onBeforeCompile = (shader, renderer) => {
    garden.call(lit, shader, renderer);
    if (shader.fragmentShader.includes(GARDEN_RIM)) shader.fragmentShader = shader.fragmentShader.replace(GARDEN_RIM, DOE_RIM);
    else if (process.env.NODE_ENV !== "production") console.warn("deer coat: the garden's rim line has changed; her rim is the garden's");
  };
  return lit;
}
