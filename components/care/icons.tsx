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
