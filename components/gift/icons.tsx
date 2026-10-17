// Small line icons for the gift flow, drawn for the garden (no icon font or library): 18 px on a 24 grid, stroked in
// currentColor so each sits in the colour of its text. Decorative, so hidden from screen readers.
import type { ReactNode, SVGProps } from "react";
import type { TraitKind } from "@/components/gift/species";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
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

export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5Z" fill="currentColor" stroke="none" />
    <path d="M18.5 15.5c.25 1.5.75 2 2.25 2.25-1.5.25-2 .75-2.25 2.25-.25-1.5-.75-2-2.25-2.25 1.5-.25 2-.75 2.25-2.25Z" fill="currentColor" stroke="none" opacity={0.7} />
  </Icon>
);

export const Leaf = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 19c0-8 5.5-13 14-14 0 8.5-5 14-13 14Z" />
    <path d="M5 19c3-4 6-6.5 9.5-8.5" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1" />
    <path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.2 4L19 7" />
  </Icon>
);

export const Share = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 15V4" />
    <path d="m8 8 4-4 4 4" />
    <path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12" />
  </Icon>
);

export const Chevron = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

export const ArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Icon>
);

export const Swap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 7h11l-3-3" />
    <path d="M17 17H6l3 3" />
  </Icon>
);

export const Drop = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c3 3.6 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.4 5.5-10Z" />
  </Icon>
);

export const Sun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.6" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </Icon>
);

export const Soil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 16.5c2.5-1.6 5.3-2.4 8.5-2.4s6 .8 8.5 2.4" />
    <path d="M6 19.5h12" />
    <path d="M12 14V9.5" />
    <path d="M12 11c-1.6-.1-3-1.2-3.4-3 1.8 0 3.2 1.2 3.4 3Zm0-.8c.2-1.9 1.6-3.1 3.6-3.2-.4 1.9-1.9 3.1-3.6 3.2Z" />
  </Icon>
);

export const Dawn = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 16a4.5 4.5 0 0 1 9 0" />
    <path d="M3 19.5h18" />
    <path d="M12 4.5v3M5.2 9.2l1.6 1.6M18.8 9.2l-1.6 1.6" />
  </Icon>
);

export const Moon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />
  </Icon>
);

export function TraitIcon({ kind, dusk }: { kind: TraitKind; dusk?: boolean }) {
  if (kind === "thirst") return <Drop size={16} />;
  if (kind === "heat") return <Sun size={16} />;
  if (kind === "wet") return <Soil size={16} />;
  return dusk ? <Moon size={16} /> : <Dawn size={16} />;
}
