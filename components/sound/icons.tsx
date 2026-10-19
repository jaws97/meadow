// The garden sounds' icons: original line drawings on a 24-unit grid, in the care layer's hand (components/care/icons):
// a 1.6 stroke with rounded caps and joins, drawn in currentColor so a button's state tints them, and all decorative
// (aria-hidden), because the button or tile around each one carries the words.
//
// The sound button's glyph is three soft rounded bars, drawn as plain HTML (three spans) rather than SVG, so that
// sound.css can let them breathe, slowly and by transform alone, while sound plays, and every browser runs that on the
// compositor (WebKit repaints a transform on an SVG child every frame). Each group of tiles in the sound panel has a
// glyph of its own (GroupGlyph):
// rain from a cloud, three ripples of water, a little bird on a branch, the moon and a star, a singing bowl with its
// resonance rising, and two beamed notes for music. The live garden's card has a sprout under a small sun.
import type { ReactNode, SVGProps } from "react";
import type { GroupKey } from "@/lib/sound/types";

function Icon({ children, size = 24, ...rest }: { children: ReactNode; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
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

/**
 * The sound button's glyph: three soft bars, short, tall and middling, that breathe while sound plays (sound.css
 * .sound-bars, 22 px tall, the size of the other glyphs).
 */
export function SoundGlyph() {
  return (
    <span className="sound-bars" aria-hidden="true">
      <span className="sound-bar sound-bar-1" />
      <span className="sound-bar sound-bar-2" />
      <span className="sound-bar sound-bar-3" />
    </span>
  );
}

/** The live garden: a sprout from the ground under a small sun, the garden's own sky and weather. */
export function LiveGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4.6 20.2h13.6" />
      <path d="M10.4 20.2v-6.6" />
      <path d="M10.4 15.4c-2.7 0-4.4-1.5-4.9-3.9 2.5 0 4.3 1.4 4.9 3.9Z" />
      <path d="M10.4 13.6c.3-3 2-4.9 4.7-5.2-.2 2.9-1.9 4.9-4.7 5.2Z" />
      <circle cx="18.4" cy="4.8" r="2" />
    </Icon>
  );
}

/** Rain: a soft cloud and three falling drops. */
export function RainGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M7.4 14.4a3.8 3.8 0 0 1-.3-7.6 5 5 0 0 1 9.5 1.2 3.2 3.2 0 0 1 .3 6.4H7.4Z" />
      <path d="m8.8 17.4-.9 1.9M12.4 17.4l-.9 1.9M16 17.4l-.9 1.9" />
    </Icon>
  );
}

/** Water: three ripples, each shorter than the one before. */
export function WaterGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3.6 8.8c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0 2.8-1.1 4.2 0 2.8 1.1 4.2 0" />
      <path d="M5.7 13c1.1-.9 2.3-.9 3.4 0s2.3.9 3.4 0 2.3-.9 3.4 0 2.3.9 3.4 0" />
      <path d="M8.4 17.2c.9-.7 1.8-.7 2.7 0s1.8.7 2.7 0 1.8-.7 2.7 0" />
    </Icon>
  );
}

/** Birds and breeze: a plump little bird on a branch, its tail cocked like a magpie-robin's. */
export function BirdGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 11.3c0-3 2.4-5.3 5.4-5.3 2.4 0 4.2 1.4 4.9 3.4l4.2-1.8c-.6 3.6-3.3 6.5-7.3 6.9H8.5c-2 0-3.5-1.3-3.5-3.2Z" />
      <path d="M5.1 10.1 3.3 10.6" />
      <path d="M10.6 10.2c1.3.4 2.6 1.3 3.4 2.6" />
      <path d="M9.4 14.5v4.1M12 14.5v4.1M5.2 18.8h13.6" />
      <path d="M7.6 9.1v.01" strokeWidth="2" />
    </Icon>
  );
}

/** Night: a crescent moon and a small star. */
export function NightGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M17.4 15.6A6.4 6.4 0 0 1 9 7.2a6.4 6.4 0 1 0 8.4 8.4Z" />
      <path d="M17.2 3.6v2.6M15.9 4.9h2.6" />
      <path d="M20.4 9.6v.01" strokeWidth="2" />
    </Icon>
  );
}

/** Calm tones: a singing bowl on its foot, its resonance rising in two soft arcs. */
export function ToneGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4.6 12h14.8c-.4 4.1-3.6 6.9-7.4 6.9s-7-2.8-7.4-6.9Z" />
      <path d="M9.6 20.6h4.8" />
      <path d="M9.2 8.6c1.8-1.1 3.8-1.1 5.6 0" />
      <path d="M7 5.6c3.2-2 6.8-2 10 0" />
    </Icon>
  );
}

/** Music: two beamed notes. */
export function MusicGlyph({ size = 24 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M9.2 17.2V6.8l9.2-2.2v10.4" />
      <path d="m9.2 9.8 9.2-2.2" />
      <circle cx="7.1" cy="17.2" r="2.1" />
      <circle cx="16.3" cy="15" r="2.1" />
    </Icon>
  );
}

export function CloseGlyph({ size = 20 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4" />
    </Icon>
  );
}

export function ChevronGlyph({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m6.6 9.4 5.4 5.4 5.4-5.4" />
    </Icon>
  );
}

/** The glyph drawn on every tile of a group. */
export function GroupGlyph({ group, size = 24 }: { group: GroupKey; size?: number }) {
  switch (group) {
    case "rain":
      return <RainGlyph size={size} />;
    case "water":
      return <WaterGlyph size={size} />;
    case "birds":
      return <BirdGlyph size={size} />;
    case "night":
      return <NightGlyph size={size} />;
    case "tones":
      return <ToneGlyph size={size} />;
    case "music":
      return <MusicGlyph size={size} />;
  }
}
