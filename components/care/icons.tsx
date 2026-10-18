// The care layer's icons: original line drawings on a 24-unit grid, drawn in currentColor so a button's state tints
// them. Rounded caps and joins at a 1.6 stroke, to sit with the loading veil's soft sprout. All decorative: the button
// or chip around each one carries the words.
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...rest }: { children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function WaterIcon() {
  return (
    <Icon>
      <path d="M5.2 10.2h8.6l-1 8.2a1.6 1.6 0 0 1-1.6 1.4H7.8a1.6 1.6 0 0 1-1.6-1.4l-1-8.2Z" />
      <path d="M7.4 10.2V8.9a2.1 2.1 0 0 1 4.2 0v1.3" />
      <path d="m13.5 12.6 4.6-3.7" />
      <path d="m17.4 7.6 1.9 2.4" />
      <path d="M20.6 12.4v.01M19.4 14.6v.01M21.6 15v.01" strokeWidth="2" />
    </Icon>
  );
}

export function ShadeIcon() {
  return (
    <Icon>
      <path d="M3.5 11.2c2.6-2.1 5.4-3.1 8.5-3.1s5.9 1 8.5 3.1" />
      <path d="M3.5 11.2c1.4.9 2.8.9 4.2 0 1.4.9 2.9.9 4.3 0 1.4.9 2.9.9 4.3 0 1.4.9 2.8.9 4.2 0" />
      <path d="M5.4 11.9V20M18.6 11.9V20" />
      <path d="M12 20v-3.4" />
      <path d="M12 17.6c-1.5 0-2.4-.8-2.7-2 1.4 0 2.4.7 2.7 2Zm0-.3c1.3-.1 2.2-.9 2.5-2.1-1.3.1-2.3.8-2.5 2.1Z" />
      <path d="M12 2.8v1.4M16.6 4.2l-.8 1M7.4 4.2l.8 1" />
    </Icon>
  );
}

export function CoverIcon() {
  return (
    <Icon>
      <path d="M4.5 19.8h15" />
      <path d="M6.4 19.8v-3.6a5.6 5.6 0 0 1 11.2 0v3.6" />
      <path d="M12 10.6V9.4" />
      <path d="M12 19.8v-2.6m0 1c-1-.1-1.7-.7-1.9-1.6 1 .1 1.7.6 1.9 1.6Zm0-.2c.9-.1 1.6-.7 1.8-1.6-.9.1-1.6.6-1.8 1.6Z" />
      <path d="m7.6 3.6-.9 1.7M12.4 2.8l-.9 1.7M17.2 3.6l-.9 1.7" />
    </Icon>
  );
}

export function FeedIcon() {
  return (
    <Icon>
      <path d="M6.6 8.4h10.8l-1.1 10.7a1.2 1.2 0 0 1-1.2 1.1H8.9a1.2 1.2 0 0 1-1.2-1.1L6.6 8.4Z" />
      <path d="m7.6 8.4 1.1-3.6h6.6l1.1 3.6" />
      <path d="M12 17.4c.1-2.2 1.4-3.6 3.3-3.8-.1 2.1-1.4 3.6-3.3 3.8Zm0 0c-.2-1.4-1-2.3-2.3-2.5.1 1.4.9 2.3 2.3 2.5Z" />
    </Icon>
  );
}

export function TendIcon() {
  return (
    <Icon>
      <path d="M5 19.2C5.2 11.8 9.6 6.6 18.8 5.4c-.6 8.6-5.2 13.6-12.6 13.8" />
      <path d="M5 19.2 13.2 11" />
      <path d="m9.6 14.6-2.2-.4M12 12.2l-1.6-1.2M11 15.4l.5 2" />
      <path d="M18.8 15.6l1.6.8M17.2 18.6l1.4 1.2" />
    </Icon>
  );
}

export function TalkIcon() {
  return (
    <Icon>
      <path d="M20 11.4c0 4-3.6 7-8 7-1.1 0-2.2-.2-3.2-.6l-4.1 1.6 1.2-3.3C4.7 14.8 4 13.2 4 11.4c0-4 3.6-7 8-7s8 3 8 7Z" />
      <path d="M12 14.4s-2.6-1.5-2.6-3.3a1.4 1.4 0 0 1 2.6-.7 1.4 1.4 0 0 1 2.6.7c0 1.8-2.6 3.3-2.6 3.3Z" />
    </Icon>
  );
}

export function SparkleIcon() {
  return (
    <Icon>
      <path d="M11 3.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5Z" />
      <path d="M17.8 13.8c.3 1.8 1 2.5 2.7 2.7-1.7.3-2.4 1-2.7 2.7-.3-1.7-1-2.4-2.7-2.7 1.7-.2 2.4-.9 2.7-2.7Z" />
      <path d="M6 16.8v.01M8.4 20v.01" strokeWidth="2" />
    </Icon>
  );
}

export function SproutIcon() {
  return (
    <Icon>
      <path d="M12 20.4v-7.6" />
      <path d="M12 14.6c-3.2 0-5.2-1.8-5.8-4.6 3 0 5.1 1.6 5.8 4.6Z" />
      <path d="M12 12.8c.3-3.6 2.4-5.8 5.6-6.2-.2 3.4-2.3 5.8-5.6 6.2Z" />
      <path d="M7.6 20.4h8.8" />
    </Icon>
  );
}

export function FlowerIcon() {
  return (
    <Icon>
      <circle cx="12" cy="9.4" r="1.7" />
      <path d="M12 7.7c-1.3-2.6.1-4.2 0-4.2s1.3 1.6 0 4.2Zm1.6 1.1c2.6-1.1 4.1.4 4.1.3s-1.5 1.4-4.1.3Zm-.6 2.1c1.5 2.5.3 4.2.3 4.2s-1.9-1.3-.3-4.2Zm-2-.1c-1.6 2.4-3.4 1.6-3.4 1.6s.7-1.9 3.4-1.6Zm-.6-2c-2.7-.7-2.7-2.7-2.7-2.7s1.9-.5 2.7 2.7Z" />
      <path d="M12 11.2v9.2M12 17c1.6 0 2.8-.9 3.3-2.4-1.6 0-2.8.8-3.3 2.4Z" />
    </Icon>
  );
}

export function SoilIcon({ level }: { level: number }) {
  // the drop fills with the soil's moisture
  const y = 20 - 12.5 * Math.max(0, Math.min(1, level));
  return (
    <Icon>
      <defs>
        <clipPath id="care-soil-drop">
          <path d="M12 3.6c3 3.6 5.4 6.6 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-3.2 2.4-6.2 5.4-9.8Z" />
        </clipPath>
      </defs>
      <rect x="5" y={y} width="14" height={20 - y + 1} fill="currentColor" stroke="none" opacity="0.45" clipPath="url(#care-soil-drop)" />
      <path d="M12 3.6c3 3.6 5.4 6.6 5.4 9.8a5.4 5.4 0 0 1-10.8 0c0-3.2 2.4-6.2 5.4-9.8Z" />
    </Icon>
  );
}

// ---- the lotus: its jar, its pond and its koi ------------------------------------------------------------------------

/** Fresh water for the seed's glass jar: the jar, its water line, the seed resting on the bottom and two bubbles. */
export function JarIcon() {
  return (
    <Icon>
      <path d="M8.6 3.8h6.8" />
      <path d="M9.2 3.8v2.4c-2.1.9-3.4 2.6-3.4 4.9v6.7a2.4 2.4 0 0 0 2.4 2.4h7.6a2.4 2.4 0 0 0 2.4-2.4v-6.7c0-2.3-1.3-4-3.4-4.9V3.8" />
      <path d="M5.8 12.4c2.1.9 4.1.9 6.2 0s4.1-.9 6.2 0" />
      <path d="M10.6 17.4c0-.8.6-1.3 1.4-1.3s1.4.5 1.4 1.3-.6 1.2-1.4 1.2-1.4-.4-1.4-1.2Z" />
      <path d="M10.2 14.6v.01M13.6 13.9v.01" strokeWidth="1.8" />
    </Icon>
  );
}

/** The seedling going into its pot in the pond: a round first leaf on its stalk, the water line, the pot under it. */
export function PlantPondIcon() {
  return (
    <Icon>
      <path d="M12 8.2c2.5 0 4.3-1 4.3-2.3S14.5 3.6 12 3.6 7.7 4.6 7.7 5.9 9.5 8.2 12 8.2Z" />
      <path d="M12 6v10.2" />
      <path d="M3.4 13.4c2.9 1 5.7 1 8.6 0s5.7-1 8.6 0" />
      <path d="M7.4 16.2h9.2l-1.1 4h-7Z" />
    </Icon>
  );
}

/** A 15 L bucket for the pond, its water swaying at the brim. */
export function BucketIcon() {
  return (
    <Icon>
      <path d="M5.4 9.6h13.2l-1.7 9.4a1.6 1.6 0 0 1-1.6 1.3H8.7a1.6 1.6 0 0 1-1.6-1.3L5.4 9.6Z" />
      <path d="M5.4 9.6C5.8 5 18.2 5 18.6 9.6" />
      <path d="M6.6 12.6c1.8.8 3.6.8 5.4 0s3.6-.8 5.4 0" />
      <path d="M12 2.8v1.6M9 3.4l.5 1.3M15 3.4l-.5 1.3" />
    </Icon>
  );
}

/** "Tend the pond": a pinch of food falling to a koi. */
export function KoiIcon() {
  return (
    <Icon>
      <path d="M4.4 15.2c1.9-2.7 4.7-4 7.6-4 1.9 0 3.4.7 4.6 1.8l2.9-2.2v8.8l-2.9-2.2c-1.2 1.1-2.7 1.8-4.6 1.8-2.9 0-5.7-1.3-7.6-4Z" />
      <path d="M11.4 11.4c.5-1.2 1.6-1.9 3-2.1" />
      <path d="M8.2 14.6v.01" strokeWidth="2" />
      <path d="M9.6 4.4v.01M12.8 3.6v.01M11.6 6.8v.01" strokeWidth="2.1" />
    </Icon>
  );
}

/**
 * The pond chip: the tank in section, the fill line marked at its walls, and the water standing at its level (mm
 * against the fill line: the notch's +20 at the brim, -70 near the floor).
 */
export function PondIcon({ levelMM }: { levelMM: number }) {
  const y = 9.6 - 0.1 * Math.max(-75, Math.min(20, levelMM));
  return (
    <Icon>
      <defs>
        <clipPath id="care-pond-tank">
          <path d="M5.4 5.6v10.6a2.6 2.6 0 0 0 2.6 2.6h8a2.6 2.6 0 0 0 2.6-2.6V5.6Z" />
        </clipPath>
      </defs>
      <rect x="4" y={y} width="16" height={20 - y} fill="currentColor" stroke="none" opacity="0.45" clipPath="url(#care-pond-tank)" />
      <path d={`M5.4 ${y.toFixed(2)}h13.2`} strokeWidth="1.1" clipPath="url(#care-pond-tank)" />
      <path d="M5.4 5.6v10.6a2.6 2.6 0 0 0 2.6 2.6h8a2.6 2.6 0 0 0 2.6-2.6V5.6" />
      <path d="M2.6 9.6h1.6M19.8 9.6h1.6" />
    </Icon>
  );
}

/** The jar chip: the jar's water, clear (a light wash) or clouding (denser). */
export function JarWaterIcon({ clarity }: { clarity: number }) {
  const murk = 1 - Math.max(0, Math.min(1, clarity));
  return (
    <Icon>
      <defs>
        <clipPath id="care-jar-water">
          <path d="M5.8 12.4c2.1.9 4.1.9 6.2 0s4.1-.9 6.2 0v5.4a2.4 2.4 0 0 1-2.4 2.4H8.2a2.4 2.4 0 0 1-2.4-2.4Z" />
        </clipPath>
      </defs>
      <rect x="5" y="11" width="14" height="10" fill="currentColor" stroke="none" opacity={0.18 + 0.5 * murk} clipPath="url(#care-jar-water)" />
      <path d="M8.6 3.8h6.8" />
      <path d="M9.2 3.8v2.4c-2.1.9-3.4 2.6-3.4 4.9v6.7a2.4 2.4 0 0 0 2.4 2.4h7.6a2.4 2.4 0 0 0 2.4-2.4v-6.7c0-2.3-1.3-4-3.4-4.9V3.8" />
      <path d="M5.8 12.4c2.1.9 4.1.9 6.2 0s4.1-.9 6.2 0" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M19 14.6A7.4 7.4 0 0 1 9.4 5a7.4 7.4 0 1 0 9.6 9.6Z" />
    </Icon>
  );
}

export function RainIcon() {
  return (
    <Icon>
      <path d="M7.4 15.2a4 4 0 0 1-.4-8 5.2 5.2 0 0 1 9.9 1.3 3.4 3.4 0 0 1 .3 6.7H7.4Z" />
      <path d="m8.6 18-1 2M12.4 18l-1 2M16.2 18l-1 2" />
    </Icon>
  );
}

export function SoftSkyIcon() {
  return (
    <Icon>
      <path d="M7 17.6a4 4 0 0 1-.4-8 5.2 5.2 0 0 1 9.9 1.3 3.4 3.4 0 0 1 .3 6.7H7Z" />
      <path d="M15.2 6.2a3.2 3.2 0 0 1 4.6 3.4" />
    </Icon>
  );
}

export function HeartIcon() {
  return (
    <Icon>
      <path d="M12 19s-7-4.2-7-9a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 4.8-7 9-7 9Z" />
    </Icon>
  );
}

export function LeafIcon() {
  return (
    <Icon>
      <path d="M5.4 18.6C5.6 11.6 9.8 6.6 18.6 5.4c-.6 8.2-5 13-12 13.2" />
      <path d="M5.4 18.6 12.8 11.2" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="m7 7 10 10M17 7 7 17" />
    </Icon>
  );
}
