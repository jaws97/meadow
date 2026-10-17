"use client";
// The planting moment, drawn for the garden: the same seed of light as the loading veil drifts down and waits above a
// small bed of soil while the garden answers; once the seed is planted it settles in, the soil closes over it, three
// drops of first water fall, and a glow breathes up through the soil. The seed only goes into the soil after the
// server has said yes, so the picture never shows a planting that did not happen.
//
// CSS animations on SVG elements (gift.css, the gp- classes): transform and opacity only. With reduced motion the
// moment is a quiet cross-fade: nothing falls, the soil simply closes and darkens with water.
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

export function PlantingMoment({ planted, small = false }: { planted: boolean; small?: boolean }) {
  return (
    <div className={`gift-plant-stage ${planted ? "is-planted" : "is-waiting"}${small ? " is-small" : ""}`} aria-hidden="true">
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
