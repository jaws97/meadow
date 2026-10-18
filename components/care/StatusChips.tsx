"use client";
// The plant's circumstances at a glance, as soft chips, in the order they matter on a phone, where only the first two
// or three fit before the line has to be swiped: the soil in words (for a lotus, the pond's level against its fill
// line, or while the seed is in its jar, how clear the jar's water is), the plant's day with its bloom outlook in one
// chip ("Day 4 · about 10 days to bloom", from the server's expectBloom forecast, which assumes the care stays good), a
// lotus's koi and their last pinch ("Koi fed at 08:00"), friends who sprinkled the plant today (thanked by name), and
// the weather at the Disney office right now. On a phone the chips ride one swipeable line (not a tab stop: there is
// nothing in it to act on); in the side panels they wrap.
import type { ReactNode } from "react";
import {
  FlowerIcon,
  HeartIcon,
  JarWaterIcon,
  KoiIcon,
  MoonIcon,
  PondIcon,
  RainIcon,
  SoftSkyIcon,
  SoilIcon,
  SproutIcon,
  SunIcon,
} from "@/components/care/icons";
import type { Sky } from "@/lib/client/plant";

const SKY_ICONS: Record<Sky, ReactNode> = {
  sun: <SunIcon />,
  moon: <MoonIcon />,
  rain: <RainIcon />,
  soft: <SoftSkyIcon />,
};

/**
 * The first chip: what the roots stand in. Soil: "Soil just right", its drop filling with the soil's moisture. A
 * lotus's pond: "Pond at its line", the tank's water at its level in mm against the fill line. A seed in its jar: "Jar
 * water clear", the jar's water hazing as it clouds (clarity 1 clear .. 0 murky).
 */
export type GroundChip =
  | { kind: "soil"; text: string; spoken: string; level: number }
  | { kind: "pond"; text: string; spoken: string; levelMM: number }
  | { kind: "jar"; text: string; spoken: string; clarity: number };

export interface ChipsModel {
  /** ask: the plant would like a drink (a top-up, fresh jar water) and nothing else is saying so: the honey tone */
  ground: GroundChip & { ask: boolean };
  /** "Day 4 · about 10 days to bloom"; bloom: the outlook is part of it (the flower icon, the warm tone) */
  outlook: { text: string; spoken: string; bloom: boolean };
  /** a lotus's koi: "Koi fed at 08:00", "The koi are hungry" (ask: the honey tone); null for a flower of the bed */
  koi: { text: string; ask: boolean } | null;
  friends: string | null;
  weather: { temp: string; words: string; sky: Sky; spoken: string } | null;
}

function Chip({ icon, children, label, tone }: { icon: ReactNode; children: ReactNode; label?: string; tone?: string }) {
  return (
    <li className="care-chip" data-tone={tone} aria-label={label}>
      <span className="care-chip-icon">{icon}</span>
      <span aria-hidden={label ? true : undefined}>{children}</span>
    </li>
  );
}

function groundIcon(g: GroundChip): ReactNode {
  if (g.kind === "pond") return <PondIcon levelMM={g.levelMM} />;
  if (g.kind === "jar") return <JarWaterIcon clarity={g.clarity} />;
  return <SoilIcon level={g.level} />;
}

export function StatusChips({ model }: { model: ChipsModel }) {
  const { ground, outlook, koi, friends, weather } = model;
  return (
    // tabIndex -1: on a phone the line scrolls sideways, and a browser would otherwise make it a tab stop of its own
    // (its words reach screen readers as the list they are)
    <ul className="care-chips" aria-label="How the plant is doing" tabIndex={-1}>
      <Chip icon={groundIcon(ground)} label={ground.spoken} tone={ground.ask ? "ask" : ground.kind === "soil" ? "soil" : "pond"}>
        {ground.text}
      </Chip>
      <Chip icon={outlook.bloom ? <FlowerIcon /> : <SproutIcon />} label={outlook.spoken} tone={outlook.bloom ? "bloom" : undefined}>
        {outlook.text}
      </Chip>
      {koi && (
        <Chip icon={<KoiIcon />} tone={koi.ask ? "ask" : "koi"}>
          {koi.text}
        </Chip>
      )}
      {friends && (
        <Chip icon={<HeartIcon />} tone="friends">
          {friends}
        </Chip>
      )}
      {weather && (
        <Chip icon={SKY_ICONS[weather.sky]} label={weather.spoken} tone={weather.sky}>
          <span className="care-chip-strong">{weather.temp}</span> {weather.words}
        </Chip>
      )}
    </ul>
  );
}
