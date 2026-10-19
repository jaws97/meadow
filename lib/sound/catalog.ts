// What the sound panel offers: thirty tiles in six groups, eight ready-made mixes, and the live garden (lib/sound/live),
// which is the default. Each recorded tile plays one file from the library (lib/sound/library), the first choice of
// the 2026-10-19 audition. Two tiles are made in code: brown noise, and a music box in D that never repeats (the same
// voice as the party trailer's music). Music is exclusive: picking a piece replaces the one playing. At most
// MAX_LAYERS tiles play at once, which keeps a phone within its audio memory (lib/sound/engine).
import type { Group, GroupKey, Mix, Tile } from "@/lib/sound/types";

/** The most tiles that play at once. */
export const MAX_LAYERS = 5;

export const GROUPS: readonly Group[] = [
  { key: "rain", label: "Rain", exclusive: false },
  { key: "water", label: "Water", exclusive: false },
  { key: "birds", label: "Birds and breeze", exclusive: false },
  { key: "night", label: "Night", exclusive: false },
  { key: "tones", label: "Calm tones", exclusive: false },
  { key: "music", label: "Music", exclusive: true },
];

const BED = 0.6;
const TONE = 0.45;
const MUSIC = 0.5;

export const TILES: readonly Tile[] = [
  { key: "rain-light", label: "Light rain", hint: "Soft rain on banana leaves", group: "rain", sound: "rain-light", level: BED },
  { key: "rain-monsoon", label: "Monsoon", hint: "A steady, enveloping downpour", group: "rain", sound: "rain-monsoon", level: BED },
  { key: "rain-roof", label: "Veranda rain", hint: "Rain on a tin roof at dawn", group: "rain", sound: "rain-roof", level: BED },
  { key: "rain-thunder", label: "Far thunder", hint: "A gentle shower with distant rolls", group: "rain", sound: "rain-thunder", level: BED },
  { key: "rain-after", label: "After the rain", hint: "Drops falling from the trees", group: "rain", sound: "rain-after", level: BED },

  { key: "water-stream", label: "Garden stream", hint: "A small woodland brook", group: "water", sound: "water-stream", level: BED },
  { key: "water-fountain", label: "Courtyard fountain", hint: "Water trickling into a stone basin", group: "water", sound: "water-fountain", level: BED },
  { key: "water-fall", label: "Waterfall", hint: "A soft, steady hush", group: "water", sound: "water-fall", level: 0.45 },
  { key: "water-sea", label: "Ocean waves", hint: "Small waves on a quiet shore", group: "water", sound: "water-sea", level: BED },
  { key: "water-lake", label: "Lakeside", hint: "Water lapping at the edge", group: "water", sound: "water-lake", level: BED },

  { key: "birds-blr", label: "Indian morning", hint: "Koel, magpie-robin, barbet and oriole in a mango orchard", group: "birds", sound: "birds-blr", level: BED },
  { key: "birds-garden", label: "Garden birds", hint: "An oriole and friends in a quiet garden", group: "birds", sound: "birds-garden", level: BED },
  { key: "birds-forest", label: "Forest", hint: "Distant birds on a still summer day", group: "birds", sound: "birds-forest", level: BED },
  { key: "birds-meadow", label: "Summer meadow", hint: "Bees and birds in the grass", group: "birds", sound: "birds-meadow", level: BED },
  { key: "wind-leaves", label: "Wind in leaves", hint: "A soft rustle in broad-leaf trees", group: "birds", sound: "wind-leaves", level: BED },
  { key: "wind-grass", label: "Reeds and grass", hint: "A gentle breeze through reeds", group: "birds", sound: "wind-grass", level: BED },

  { key: "night-crickets", label: "Crickets", hint: "A tropical night chorus", group: "night", sound: "night-crickets", level: 0.5 },
  { key: "night-frogs", label: "Rain frogs", hint: "Frogs and toads in light night rain", group: "night", sound: "night-frogs", level: 0.5 },
  { key: "night-forest", label: "Night forest", hint: "Crickets, an owl and a nightjar", group: "night", sound: "night-forest", level: 0.5 },
  { key: "night-fire", label: "Campfire", hint: "A cosy crackle", group: "night", sound: "night-fire", level: 0.5 },
  { key: "night-dusk", label: "Dusk", hint: "Night falling, crickets and frogs joining in", group: "night", sound: "night-dusk", level: BED },

  { key: "tone-chimes", label: "Wind chimes", hint: "One chime set in a breeze", group: "tones", sound: "tone-chimes", level: TONE },
  { key: "tone-bowl", label: "Singing bowl", hint: "Long, resonant strikes", group: "tones", sound: "tone-bowl", level: TONE },
  { key: "tone-bells", label: "Small bells", hint: "Four little bells swinging in the wind", group: "tones", sound: "tone-bells", level: 0.35 },
  { key: "noise-brown", label: "Soft noise", hint: "Warm brown noise, made on your device", group: "tones", generated: "brown-noise", level: 0.35 },

  { key: "music-piano", label: "Soft piano", hint: "Meditation Impromptu, by Kevin MacLeod", group: "music", sound: "music-piano", level: MUSIC },
  { key: "music-pad", label: "Ambient", hint: "A slow pad over a drone", group: "music", sound: "music-pad", level: MUSIC },
  { key: "music-veena", label: "Veena", hint: "Raga Kiravani, slow and unaccompanied", group: "music", sound: "music-veena", level: MUSIC },
  { key: "music-kalimba", label: "Kalimba", hint: "Kalimba over a soft synth", group: "music", sound: "music-kalimba", level: MUSIC },
  { key: "music-box", label: "Music box", hint: "The party's music box, never the same twice", group: "music", generated: "music-box", level: 0.45 },
];

export const MIXES: readonly Mix[] = [
  { id: "monsoon-evening", label: "Monsoon evening", layers: [{ key: "rain-monsoon", level: 0.5 }, { key: "night-frogs", level: 0.3 }, { key: "rain-thunder", level: 0.22 }] },
  { id: "morning-stream", label: "Morning stream", layers: [{ key: "birds-blr", level: 0.55 }, { key: "wind-leaves", level: 0.3 }, { key: "water-stream", level: 0.2 }] },
  { id: "courtyard-calm", label: "Courtyard calm", layers: [{ key: "water-fountain", level: 0.45 }, { key: "tone-bells", level: 0.16 }, { key: "music-veena", level: 0.35 }] },
  { id: "veranda-nap", label: "Veranda nap", layers: [{ key: "rain-roof", level: 0.5 }, { key: "tone-chimes", level: 0.18 }, { key: "music-piano", level: 0.3 }] },
  { id: "sleepy-night", label: "Sleepy night", layers: [{ key: "night-crickets", level: 0.4 }, { key: "night-fire", level: 0.32 }, { key: "music-box", level: 0.3 }] },
  { id: "forest-walk", label: "Forest walk", layers: [{ key: "birds-forest", level: 0.5 }, { key: "water-stream", level: 0.3 }, { key: "wind-leaves", level: 0.28 }] },
  { id: "by-the-sea", label: "By the sea", layers: [{ key: "water-sea", level: 0.55 }, { key: "music-pad", level: 0.28 }] },
  { id: "deep-focus", label: "Deep focus", layers: [{ key: "noise-brown", level: 0.35 }, { key: "rain-light", level: 0.4 }] },
];

/** The bird calls the live garden drops in: Asian koel, red-whiskered bulbul (recorded in Bangalore), magpie-robin. */
export const BIRD_CALLS: readonly string[] = ["call-koel", "call-bulbul", "call-magpie-robin"];

const TILE_BY_KEY = new Map(TILES.map((t) => [t.key, t]));
const GROUP_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]));

export function tile(key: string): Tile | undefined {
  return TILE_BY_KEY.get(key);
}

export function group(key: GroupKey): Group {
  return GROUP_BY_KEY.get(key)!;
}

export function tilesIn(key: GroupKey): Tile[] {
  return TILES.filter((t) => t.group === key);
}

export function mix(id: string): Mix | undefined {
  return MIXES.find((m) => m.id === id);
}
