// Small line icons for the Meadow's overlay, drawn here (no icon font or library): 18 px on a 24 grid, stroked in
// currentColor so each sits in the colour of its text. Decorative, so hidden from screen readers.
import type { ReactNode, SVGProps } from "react";

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

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="m20 20-4.4-4.4" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

/** A drop of water with a glint: the sprinkle. */
export const DropIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.8c3.2 4 5.2 6.9 5.2 9.6a5.2 5.2 0 0 1-10.4 0c0-2.7 2-5.6 5.2-9.6Z" />
    <path d="M9.8 14.2a2.4 2.4 0 0 0 2.2 2.2" />
  </Icon>
);

/** A little garden gate: their garden. */
export const GateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20V9.5a7 7 0 0 1 14 0V20" />
    <path d="M9 20v-8M12 20v-9.5M15 20v-8M5 14h14" />
  </Icon>
);

export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5Z" fill="currentColor" stroke="none" />
    <path d="M18.5 15.5c.25 1.5.75 2 2.25 2.25-1.5.25-2 .75-2.25 2.25-.25-1.5-.75-2-2.25-2.25 1.5-.25 2-.75 2.25-2.25Z" fill="currentColor" stroke="none" opacity={0.7} />
  </Icon>
);

export const LeafIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 19c0-8 5.5-13 14-14 0 8.5-5 14-13 14Z" />
    <path d="M5 19c3-4 6-6.5 9.5-8.5" />
  </Icon>
);
