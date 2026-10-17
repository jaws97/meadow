"use client";
// The plant's circumstances at a glance, as soft chips, in the order they matter on a phone, where only the first two
// or three fit before the line has to be swiped: the soil in words, the plant's day with its bloom outlook in one chip
// ("Day 4 · about 10 days to bloom", from the server's expectBloom forecast, which assumes the care stays good), friends
// who sprinkled the plant today (thanked by name), and the weather at the Disney office right now. On a phone the
// chips ride one swipeable line; in the side panels they wrap.
import type { ReactNode } from "react";
import { FlowerIcon, HeartIcon, MoonIcon, RainIcon, SoftSkyIcon, SoilIcon, SproutIcon, SunIcon } from "@/components/care/icons";
import type { Sky } from "@/lib/client/plant";

const SKY_ICONS: Record<Sky, ReactNode> = {
  sun: <SunIcon />,
  moon: <MoonIcon />,
  rain: <RainIcon />,
  soft: <SoftSkyIcon />,
};

export interface ChipsModel {
  /** ask: the plant would like a drink and nothing else is saying so, so the chip takes the honey tone */
  soil: { word: string; level: number; ask: boolean };
  /** "Day 4 · about 10 days to bloom"; bloom: the outlook is part of it (the flower icon, the warm tone) */
  outlook: { text: string; spoken: string; bloom: boolean };
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

export function StatusChips({ model }: { model: ChipsModel }) {
  const { soil, outlook, friends, weather } = model;
  return (
    <ul className="care-chips" aria-label="How the plant is doing">
      <Chip icon={<SoilIcon level={soil.level} />} label={`Soil: ${soil.word}`} tone={soil.ask ? "ask" : "soil"}>
        Soil {soil.word}
      </Chip>
      <Chip icon={outlook.bloom ? <FlowerIcon /> : <SproutIcon />} label={outlook.spoken} tone={outlook.bloom ? "bloom" : undefined}>
        {outlook.text}
      </Chip>
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
