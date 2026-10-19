// The garden's sounds, as the parts of the feature speak of them. There are four parts:
// - the library (lib/sound/library): the files in public/garden/sounds and their credits
// - the catalogue (lib/sound/catalog): the tiles, groups and mixes shown in the sound panel
// - the engine (lib/sound/engine): Web Audio, loaded on the first tap. It plays a Mixdown, the whole wanted state, and
//   eases from whatever is playing towards it.
// - the live garden (lib/sound/live): turns the garden's real sky and weather into a Mixdown
// The sound store (lib/sound/store) sits between the panel and the engine. It remembers the person's choice on this
// device and decides what the engine plays.
//
// Levels are linear gains, 0..1, applied before the master volume; 0 means silent. Every file is levelled when it is
// made (scratchpad assets script, two-pass loudnorm: beds -24 LUFS mono, calls -22, music -23 stereo), so a level of
// 0.5 sounds about as loud on any tile.

/** How a file is played: a bed loops with crossfades, a shot is a single call dropped in now and then, music streams. */
export type SoundKind = "bed" | "shot" | "music";

export type LicenseName = "CC0 1.0" | "Public domain" | "CC BY 3.0" | "CC BY 4.0";

export interface SoundCredit {
  /** the recording's own title, as its page gives it */
  title: string;
  author: string;
  /** the page that states the licence */
  source: string;
  license: LicenseName;
  licenseUrl: string;
  /** where it was recorded, when the page says ("" if not) */
  where: string;
}

export interface SoundFile {
  key: string;
  kind: SoundKind;
  /** absolute path under public/, named with a content hash so it can be cached for good */
  url: string;
  /** length of the file (s) */
  seconds: number;
  bytes: number;
  /** beds and calls are mono (the engine spreads them); music is stereo */
  channels: 1 | 2;
  credit: SoundCredit;
}

/** The groups of tiles in the sound panel, in the order shown. */
export type GroupKey = "rain" | "water" | "birds" | "night" | "tones" | "music";

/** Layers made in code, with no file: soft brown noise, and an endless music box in D (the party trailer's voice). */
export type Generated = "brown-noise" | "music-box";

export interface Tile {
  /** also the key of its SoundFile, for a recorded tile */
  key: string;
  label: string;
  /** a short line for screen readers and the tile's title */
  hint: string;
  group: GroupKey;
  /** the file it plays (a SoundFile key), or what it makes in code */
  sound?: string;
  generated?: Generated;
  /** the level it starts at when picked, 0..1 */
  level: number;
}

export interface Group {
  key: GroupKey;
  label: string;
  /** only one tile of the group plays at a time (music: two pieces at once would clash) */
  exclusive: boolean;
}

export interface MixLayer {
  key: string;
  level: number;
}

/** A ready-made blend of tiles. */
export interface Mix {
  id: string;
  label: string;
  layers: MixLayer[];
}

/** Bird calls (or other shots) dropped in at random: which files, how often, how loud. */
export interface ShotPlan {
  /** SoundFile keys of kind "shot" */
  sounds: string[];
  /** average calls per minute (a Poisson process); 0 for none */
  perMinute: number;
  level: number;
}

/**
 * Everything the engine should be playing. Each `layers` entry is a tile key and its level. Layers not listed fade out
 * and stop. `tauS` is the time constant for moving to the new levels: short when the person moves a slider, long when
 * the live garden follows the sky.
 */
export interface Mixdown {
  layers: MixLayer[];
  shots: ShotPlan | null;
  tauS: number;
}

/**
 * Where the engine is. It reports this to the store:
 * - `idle`: no context yet, or stopped
 * - `starting`: unlocked, the first files are loading
 * - `playing`
 * - `paused`: page hidden, faded out and suspended
 * - `blocked`: the browser wants a tap before it plays again (an iOS interruption, a resume refused, music the phone
 *   paused), or nothing in the mix could load, and a tap tries again
 */
export type EngineStatus = "idle" | "starting" | "playing" | "paused" | "blocked";

/** What the live garden listens to, read from the scene a few times a second (lib/sound/scene). */
export interface LiveInput {
  /** Bangalore time, fractional hours 0..24 */
  hour: number;
  /** the sun's height above the horizon (degrees, negative below) */
  sunAltitudeDeg: number;
  /** rain falling now, 0..1 (the scene's env.rain: 0 dry, 0.3 light .. 0.95 heavy) */
  rain: number;
  /**
   * how wet the garden still is, 0..1: soaked (1) by any steady shower, drying over a few minutes after it, so it
   * carries the drips after the rain (lib/sound/live's nextWet)
   */
  wet: number;
  /** wind, 0..1 (0.2 still .. 0.9 gusty) */
  wind: number;
  /** a lotus garden: the South Indian courtyard with its water, not the flower bed */
  lotus: boolean;
  /** the doe is in the garden now */
  deer: boolean;
}

export interface Engine {
  /** Play this, easing from what plays now. Starts the context's sound if it is not already playing. */
  set(mix: Mixdown): void;
  /** The master volume, 0..1, eased over about 0.2 s. */
  setVolume(volume: number): void;
  /**
   * Fade everything out over the last `fadeS` seconds before `atMs` (epoch ms), then stop and report idle. `null`
   * cancels. Scheduled on the audio clock, so it still finishes while timers are throttled in a hidden tab.
   */
  sleepAt(atMs: number | null, fadeS?: number): void;
  /** Keep playing while the page is hidden or the phone is locked (true), or fade out and suspend on hide (false). */
  setBackground(keep: boolean): void;
  /** Fade out over `fadeS` and suspend; the files stay decoded for a quick return. */
  stop(fadeS?: number): void;
  /** Try to resume after a pause or block; call it inside a tap when the status is `blocked`. */
  resume(): void;
  /** The title the phone's lock screen shows while sound plays (Media Session), e.g. "Live garden" or a mix's name. */
  setNowPlaying(title: string): void;
  status(): EngineStatus;
  /** Tiles whose files are still loading, for a soft pulse on the tile. */
  loading(): string[];
  /**
   * Tiles of the current mix whose files could not load or play just now (the engine tries them again by itself a few
   * times, and at once on resume or when picked again). When nothing in the mix could load the status is `blocked`.
   */
  failed(): string[];
  subscribe(listener: () => void): () => void;
}
