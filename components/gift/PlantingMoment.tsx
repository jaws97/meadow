"use client";
// The planting moment, drawn for the garden: the same seed of light as the loading veil drifts down and waits above a
// small bed of soil while the garden answers; once the seed is planted it settles in, the soil closes over it, three
// drops of first water fall, and a glow breathes up through the soil. The seed only goes into the soil after the
// server has said yes, so the picture never shows a planting that did not happen.
//
// A lotus seed goes into a glass of water instead (design 2.3: it starts in a jar on the pond's edge stone): the seed
// of light waits above a small glass jar on the granite edge stone, then drops in with a ring on the water, sinks
// slowly to the bottom and rests there glowing, with a few bubbles rising past it.
//
// CSS animations on SVG elements (gift.css, the gp- and gpj- classes): transform and opacity only. With reduced motion
// the moment is a quiet cross-fade: nothing falls, the soil simply closes and darkens with water (or the seed is simply
// there, resting in its jar, and its glow comes up).
import type { CSSProperties } from "react";

const DROPS: ReadonlyArray<[x: number, delay: string]> = [
  [101, "1.15s"],
  [113, "1.45s"],
  [106, "1.75s"],
];

const MOTES: ReadonlyArray<[x: number, dx: string, delay: string]> = [
  [104, "-14px", "0s"],
  [114, "10px", "0.7s"],
  [109, "-4px", "1.4s"],
  [118, "18px", "2.1s"],
];

const v = (vars: Record<string, string>) => vars as CSSProperties;

/** The jar's glass, open at the rim, standing on the edge stone (its foot at y 144), and its inside for the water. */
const JAR_GLASS = "M88.6 74.4 C88.6 80.6, 83 82.4, 83 90.6 L83 136 C83 141.4, 86.4 144, 92 144 L128 144 C133.6 144, 137 141.4, 137 136 L137 90.6 C137 82.4, 131.4 80.6, 131.4 74.4";
const JAR_INSIDE = "M89.8 75 C89.8 81.2, 84.4 83.2, 84.4 90.8 L84.4 135.6 C84.4 140.4, 87.4 142.6, 92.4 142.6 L127.6 142.6 C132.6 142.6, 135.6 140.4, 135.6 135.6 L135.6 90.8 C135.6 83.2, 130.2 81.2, 130.2 75 Z";

const BUBBLES: ReadonlyArray<[x: number, dx: string, delay: string]> = [
  [106, "-2px", "0s"],
  [113, "2px", "0.9s"],
  [109, "-1px", "1.7s"],
];

const SPLASH: ReadonlyArray<[x: number, dx: string, delay: string]> = [
  [104, "-7px", "0.5s"],
  [116, "8px", "0.54s"],
];

/** Where a seed goes in: the garden bed (the seven flowers) or a glass jar of water by the pond (the lotus). */
export type PlantingVessel = "bed" | "jar";

export function PlantingMoment({ planted, small = false, vessel = "bed" }: { planted: boolean; small?: boolean; vessel?: PlantingVessel }) {
  const stage = `gift-plant-stage ${planted ? "is-planted" : "is-waiting"}${small ? " is-small" : ""}`;
  if (vessel === "jar") {
    return (
      <div className={`${stage} is-jar`} aria-hidden="true">
        <JarMoment />
      </div>
    );
  }
  return (
    <div className={stage} aria-hidden="true">
      <svg viewBox="0 0 220 168" width="220" height="168">
        <defs>
          <radialGradient id="gp-seedg" cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#fff2c8" />
            <stop offset="55%" stopColor="#ffc56e" />
            <stop offset="100%" stopColor="#d9893c" />
          </radialGradient>
          <radialGradient id="gp-glowg">
            <stop offset="0%" stopColor="rgba(255,214,140,0.65)" />
            <stop offset="45%" stopColor="rgba(255,178,92,0.2)" />
            <stop offset="100%" stopColor="rgba(255,160,80,0)" />
          </radialGradient>
          <radialGradient id="gp-ambient">
            <stop offset="0%" stopColor="rgba(255,190,110,0.16)" />
            <stop offset="100%" stopColor="rgba(255,190,110,0)" />
          </radialGradient>
          <linearGradient id="gp-soilg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a3c27" />
            <stop offset="60%" stopColor="#3b2617" />
            <stop offset="100%" stopColor="#24170d" />
          </linearGradient>
          <linearGradient id="gp-capg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6a4830" />
            <stop offset="100%" stopColor="#3f2919" />
          </linearGradient>
          <radialGradient id="gp-wetg">
            <stop offset="0%" stopColor="rgba(18,10,4,0.62)" />
            <stop offset="70%" stopColor="rgba(18,10,4,0.38)" />
            <stop offset="100%" stopColor="rgba(18,10,4,0)" />
          </radialGradient>
          <linearGradient id="gp-dropg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(235,246,255,0.95)" />
            <stop offset="100%" stopColor="rgba(150,200,255,0.8)" />
          </linearGradient>
        </defs>

        {/* warm light pooled on the bed */}
        <ellipse cx="110" cy="134" rx="96" ry="30" fill="url(#gp-ambient)" />
        {/* the bed of soil, its lit rim and a few pebbles */}
        <path d="M18 141 C 48 119, 172 119, 202 141 C 172 154, 48 154, 18 141 Z" fill="url(#gp-soilg)" />
        <path d="M28 137.5 C 62 123, 158 123, 192 137.5" fill="none" stroke="rgba(246,234,214,0.17)" strokeWidth="1.2" strokeLinecap="round" />
        <ellipse cx="62" cy="139" rx="3.4" ry="2" fill="#6f5846" opacity="0.75" />
        <ellipse cx="152" cy="137" rx="2.6" ry="1.6" fill="#7a6250" opacity="0.7" />
        <ellipse cx="170" cy="142" rx="2" ry="1.2" fill="#6f5846" opacity="0.6" />
        <ellipse cx="46" cy="144" rx="1.8" ry="1.1" fill="#7a6250" opacity="0.55" />
        {/* the little hole waiting for the seed */}
        <ellipse className="gp-hole" cx="110" cy="131" rx="12" ry="3.8" fill="#140b05" />
        {/* soil darkened by the first water */}
        <ellipse className="gp-wet" cx="110" cy="134" rx="48" ry="9.5" fill="url(#gp-wetg)" />
        {/* the soil closed over the seed */}
        <path className="gp-cap" d="M95.5 132.2 C 99 125.2, 121 125.2, 124.5 132.2 C 117 134.4, 103 134.4, 95.5 132.2 Z" fill="url(#gp-capg)" />
        {/* the seed's light, breathing up through the soil */}
        <circle className="gp-glow" cx="110" cy="129" r="26" fill="url(#gp-glowg)" />
        <circle className="gp-bloom" cx="110" cy="127" r="44" fill="url(#gp-glowg)" />

        {/* the seed of light */}
        <g className="gp-seed">
          <circle cx="110" cy="128" r="22" fill="url(#gp-glowg)" />
          <ellipse cx="110" cy="128" rx="7.5" ry="5" fill="url(#gp-seedg)" />
          <ellipse cx="108" cy="126.4" rx="2.6" ry="1.4" fill="rgba(255,255,240,0.8)" />
        </g>

        {/* first water */}
        {DROPS.map(([x, d]) => (
          <g key={x} transform={`translate(${x} 22)`}>
            <path className="gp-drop" style={v({ "--d": d })} d="M0 -7 C 3 -2.2, 4.4 0.8, 4.4 2.8 A 4.4 4.4 0 1 1 -4.4 2.8 C -4.4 0.8, -3 -2.2, 0 -7 Z" fill="url(#gp-dropg)" />
          </g>
        ))}
        {DROPS.map(([x, d]) => (
          <ellipse key={`r${x}`} className="gp-ripple" style={v({ "--d": d })} cx={x} cy="131" rx="11" ry="3.2" fill="none" stroke="rgba(214,236,255,0.7)" strokeWidth="1" />
        ))}

        {/* motes of light rising once it is in */}
        {MOTES.map(([x, dx, d]) => (
          <circle key={x} className="gp-mote" style={v({ "--dx": dx, "--d": d })} cx={x} cy="126" r="1.8" fill="#ffe9b8" />
        ))}
      </svg>
    </div>
  );
}

/** The lotus's moment: a small glass jar of water on the pond's granite edge stone, the seed of light falling into it. */
function JarMoment() {
  return (
    <svg viewBox="0 0 220 168" width="220" height="168">
      <defs>
        <radialGradient id="gpj-seedg" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#fff2c8" />
          <stop offset="55%" stopColor="#ffc56e" />
          <stop offset="100%" stopColor="#d9893c" />
        </radialGradient>
        <radialGradient id="gpj-glowg">
          <stop offset="0%" stopColor="rgba(255,214,140,0.65)" />
          <stop offset="45%" stopColor="rgba(255,178,92,0.2)" />
          <stop offset="100%" stopColor="rgba(255,160,80,0)" />
        </radialGradient>
        <radialGradient id="gpj-ambient">
          <stop offset="0%" stopColor="rgba(255,190,110,0.15)" />
          <stop offset="100%" stopColor="rgba(255,190,110,0)" />
        </radialGradient>
        <linearGradient id="gpj-stoneg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#77757c" />
          <stop offset="100%" stopColor="#4b4a50" />
        </linearGradient>
        <linearGradient id="gpj-pondg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(26,48,46,0.9)" />
          <stop offset="100%" stopColor="rgba(14,28,28,0)" />
        </linearGradient>
        <linearGradient id="gpj-waterg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(168,214,228,0.3)" />
          <stop offset="100%" stopColor="rgba(80,138,150,0.42)" />
        </linearGradient>
        <linearGradient id="gpj-glassg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(220,238,248,0.14)" />
          <stop offset="45%" stopColor="rgba(220,238,248,0.03)" />
          <stop offset="100%" stopColor="rgba(220,238,248,0.1)" />
        </linearGradient>
        <clipPath id="gpj-inside">
          <path d={JAR_INSIDE} />
        </clipPath>
      </defs>

      {/* warm light pooled on the stone */}
      <ellipse cx="110" cy="146" rx="98" ry="26" fill="url(#gpj-ambient)" />
      {/* the pond beyond the edge stone, and its sheen */}
      <path d="M10 155 H210 V168 H10 Z" fill="url(#gpj-pondg)" />
      <path d="M40 159.5 C 80 158, 140 158, 180 159.5" fill="none" stroke="rgba(214,236,255,0.16)" strokeWidth="1" strokeLinecap="round" />
      {/* the granite edge stone, its lit top edge and a few flecks */}
      <path d="M16 144 H204 L208 155 H12 Z" fill="url(#gpj-stoneg)" />
      <path d="M17 144.6 H203" stroke="rgba(255,248,238,0.22)" strokeWidth="1" strokeLinecap="round" />
      <circle cx="44" cy="149" r="0.9" fill="rgba(20,20,24,0.55)" />
      <circle cx="62" cy="151.5" r="0.7" fill="rgba(240,232,226,0.4)" />
      <circle cx="158" cy="148.5" r="0.9" fill="rgba(20,20,24,0.5)" />
      <circle cx="176" cy="151" r="0.7" fill="rgba(240,232,226,0.38)" />
      <circle cx="31" cy="152" r="0.6" fill="rgba(20,20,24,0.45)" />
      <circle cx="190" cy="147.5" r="0.6" fill="rgba(240,232,226,0.32)" />
      {/* the jar's soft shadow */}
      <ellipse cx="111" cy="144.6" rx="33" ry="2.6" fill="rgba(0,0,0,0.38)" />

      {/* the water in the jar, with the seed's glow in it once the seed is resting there */}
      <g clipPath="url(#gpj-inside)">
        <rect x="80" y="96" width="60" height="50" fill="url(#gpj-waterg)" />
        <circle className="gpj-glow" cx="110" cy="134" r="26" fill="url(#gpj-glowg)" />
        <circle className="gpj-bloom" cx="110" cy="132" r="40" fill="url(#gpj-glowg)" />
        {BUBBLES.map(([x, dx, d]) => (
          <circle key={x} className="gpj-bubble" style={v({ "--dx": dx, "--d": d })} cx={x} cy="130" r="1.4" fill="none" stroke="rgba(226,244,252,0.75)" strokeWidth="0.7" />
        ))}
        {/* rings where the seed meets the water */}
        <ellipse className="gpj-ripple" style={v({ "--d": "0.48s" })} cx="110" cy="96" rx="9" ry="1.5" fill="none" stroke="rgba(226,244,252,0.8)" strokeWidth="0.9" />
        <ellipse className="gpj-ripple" style={v({ "--d": "0.78s" })} cx="110" cy="96" rx="9" ry="1.5" fill="none" stroke="rgba(226,244,252,0.6)" strokeWidth="0.8" />
      </g>

      {/* the seed of light, drawn where it comes to rest on the floor of the jar */}
      <g className="gpj-seed">
        <circle cx="110" cy="137" r="20" fill="url(#gpj-glowg)" />
        <ellipse cx="110" cy="137" rx="7" ry="4.6" fill="url(#gpj-seedg)" />
        <ellipse cx="108.2" cy="135.6" rx="2.4" ry="1.3" fill="rgba(255,255,240,0.8)" />
      </g>

      {/* the water's surface, and two drops thrown up as the seed goes in */}
      <ellipse cx="110" cy="96" rx="24.2" ry="2.8" fill="rgba(206,236,246,0.14)" stroke="rgba(226,244,252,0.5)" strokeWidth="0.8" />
      {SPLASH.map(([x, dx, d]) => (
        <circle key={x} className="gpj-splash" style={v({ "--dx": dx, "--d": d })} cx={x} cy="95" r="1.2" fill="rgba(232,246,255,0.9)" />
      ))}

      {/* the glass: its body, the rim, and the light down its sides */}
      <path d={`${JAR_GLASS} Z`} fill="url(#gpj-glassg)" stroke="none" />
      <path d={JAR_GLASS} fill="none" stroke="rgba(228,242,250,0.5)" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="110" cy="74.4" rx="21.4" ry="3" fill="none" stroke="rgba(236,247,253,0.62)" strokeWidth="1.1" />
      <path d="M88.4 92 V132" stroke="rgba(255,255,255,0.26)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M132.6 96 V118" stroke="rgba(255,255,255,0.14)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
