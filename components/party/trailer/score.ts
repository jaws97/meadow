// The party trailer's music, written to its timeline (script.ts): one music-box theme in D major, in 6/8 (an eighth
// is EIGHTH_S), that gathers the ensemble act by act. Phrase A (F#5 A5 B5 | A5 F#5 E5) is left hanging on its E over
// the seed at dawn; the can wakes over a tiptoe bass, the music holds its breath before the first drop lands in slow
// motion, and each drop is a note; the 6/8 groove starts with the shoot, hushes for the shower, and quickens, doubled
// in octaves, once the sun breaks; at golden hour an A pedal holds through the still, two lone bells, a reversed
// swell and a short suck-out, and the home chord lands on the cut to the opening petals with one soft boom and phrase
// A in full; the doe gets the theme solo over a high pad, its long-awaited high D on her eyes as the garden falls
// quiet for a magpie-robin; night comes in B minor with the lantern's strike and a heartbeat pulse; each flower's
// name chimes into the black of its gate and its chord returns with the picture, the theme spread across the five,
// with one borrowed cadence (B flat, C) under the sundrop; then real silence, the title's sting as one event, and
// the theme's last two notes, A then D, as the new seed hops: "hel-lo", which answers the E it began on.
//
// Under the music: recorded beds and calls (beds.ts), each keyed in trailer time here (BED_CUES, CALLS), so the live
// player and the offline preview share them. Pure data, read by components/party/trailer/music.ts.
import type { BedKey } from "@/components/party/trailer/beds";
import {
  BLOOM_AT,
  CODA_AT,
  END_AT,
  FLOWERS_AT,
  GATES,
  GROW_AT,
  HELLO_AT,
  HELLO_GAP_S,
  HOME_AT,
  MONTAGE,
  NIGHT_AT,
  TITLE_AT,
  VISIT_AT,
  WATER_AT,
  linear,
  type Key,
} from "@/components/party/trailer/script";

/**
 * What sounds. Pitched: a music-box note (bell), a pad chord, a bass note, a reversed swell into a chord, the title's
 * glass shimmer. Unpitched: a soft sub boom, a heartbeat pulse (lub and dub), a noise whoosh into a dip, a riser driven
 * from the trailer's clock frame by frame, a wind-up click, the lantern's fwoomp, a hop's pft. And two that only move
 * levels: a choke (everything, halls included, to `vel` as a linear gain) and a duck (some buses, by `duck`).
 */
export type Voice =
  | "bell"
  | "pad"
  | "bass"
  | "swell"
  | "shimmer"
  | "boom"
  | "pulse"
  | "whoosh"
  | "riser"
  | "click"
  | "fwoomp"
  | "pft"
  | "choke"
  | "duck";

/** The voices with a pitch (their `midi` is what sounds); the rest have none (`midi` is empty). */
export const PITCHED: ReadonlySet<Voice> = new Set<Voice>(["bell", "pad", "bass", "swell", "shimmer"]);
/** The struck voices, whose attacks are summed for the level guard (score.test.ts). */
export const STRUCK: ReadonlySet<Voice> = new Set<Voice>(["bell", "boom", "pulse"]);
/** The voices that only move a level. */
export const LEVELS: ReadonlySet<Voice> = new Set<Voice>(["choke", "duck"]);

/** A duck: buses dipped by these many dB, reached with time constant `tauIn` (s), back after `dur` with `tauOut`. */
export interface Duck {
  music?: number;
  beds?: number;
  tauIn: number;
  tauOut: number;
}

export interface Note {
  /** trailer seconds */
  t: number;
  voice: Voice;
  /** MIDI note numbers (a pad or a swell sounds them together); empty for an unpitched voice */
  midi: readonly number[];
  /** seconds the note is held (a bell rings on past it, a pad and a bass fade after it); a duck's length */
  dur: number;
  /** 0..1; for a choke, the level everything goes to (linear, 1 is back to full) */
  vel: number;
  /** one of the can's last drips (0..3): the note moves with the run's own drip (music.drips) */
  drip?: number;
  /** a duck's buses and times */
  duck?: Duck;
}

/** One eighth of the 6/8 theme (s). */
export const EIGHTH_S = 0.467;

/** dB to a linear gain. */
export const dbToGain = (db: number) => Math.pow(10, db / 20);

// ---- the harmony (D major, with one borrowed cadence) ---------------------------------------------------------------

/** Pad voicings, around middle C, and their roots for the bass. */
const CHORD = {
  Dadd9: { pad: [50, 57, 64, 66], root: 38 },
  D: { pad: [50, 54, 57, 62, 66, 69], root: 38 },
  Dwide: { pad: [38, 45, 50, 54, 57, 62, 66, 69], root: 26 },
  Gmaj9: { pad: [55, 62, 66, 69], root: 43 },
  Gmaj7: { pad: [55, 59, 62, 66], root: 43 },
  Gmaj7wide: { pad: [43, 50, 55, 59, 62, 66, 74], root: 43 },
  DoverFs: { pad: [54, 57, 62, 69], root: 42 },
  Em7: { pad: [52, 59, 62, 67], root: 40 },
  Bm7: { pad: [47, 54, 57, 62], root: 35 },
  Bmadd9: { pad: [47, 54, 61, 62], root: 35 },
  Asus4: { pad: [45, 52, 57, 62], root: 33 },
  A: { pad: [45, 52, 57, 61], root: 33 },
  Fsm7: { pad: [54, 57, 61, 64], root: 42 },
  // the borrowed cadence under the sundrop: bVI and bVII
  Bb: { pad: [46, 50, 53, 58], root: 34 },
  C: { pad: [48, 52, 55, 60], root: 36 },
} as const;
type ChordName = keyof typeof CHORD;

/**
 * The music box's tones over each chord, low to high. Where the arpeggio is doubled an octave below, its tones sit high
 * enough that the lower copy stays in the music box's range.
 */
const ARP = {
  Gmaj9: [74, 79, 81, 83],
  DoverFs: [74, 78, 81, 86],
  Em7: [76, 79, 83, 86],
  Gmaj7: [78, 79, 83, 86],
  Asus4: [76, 81, 86, 88],
  A: [76, 81, 85, 88],
} as const satisfies Partial<Record<ChordName, readonly number[]>>;

/** The scale every note keeps to (pitch classes of D major). */
export const D_MAJOR: readonly number[] = [2, 4, 6, 7, 9, 11, 1];
/** The borrowed pitch classes (C, F, B flat), heard only under the sundrop and its cadence. */
export const BORROWED: readonly number[] = [0, 5, 10];

/** Each voice's range (MIDI), for the tests: a bass down to D1, pads from B flat 1, the music box from E4 to F#6. */
export const RANGE: Readonly<Partial<Record<Voice, readonly [number, number]>>> = {
  bass: [26, 50],
  pad: [34, 81],
  bell: [64, 90],
};

/** An arpeggio's last note keeps at least this far (s) from where the next one starts, so two never strike as one. */
const ARP_GAP_S = 0.06;

function compose(): Note[] {
  const n: Note[] = [];
  const bell = (t: number, midi: number, vel: number, dur: number) => n.push({ t, voice: "bell", midi: [midi], dur, vel });
  /** a bell with its octave below at half its velocity */
  const octave = (t: number, midi: number, vel: number, dur: number) => {
    bell(t, midi, vel, dur);
    bell(t, midi - 12, vel / 2, dur);
  };
  const pad = (t: number, midi: readonly number[], vel: number, dur: number) => n.push({ t, voice: "pad", midi, dur, vel });
  const bass = (t: number, midi: number, vel: number, dur: number) => n.push({ t, voice: "bass", midi: [midi], dur, vel });
  const chord = (t: number, name: ChordName, vel: number, dur: number, bassVel: number) => {
    pad(t, CHORD[name].pad, vel, dur);
    bass(t, CHORD[name].root, bassVel, dur);
  };
  const event = (t: number, voice: Voice, vel: number, dur: number, midi: readonly number[] = []) => n.push({ t, voice, midi, dur, vel });
  const choke = (t: number, db: number) => event(t, "choke", dbToGain(db), 0.01);
  const duck = (t: number, back: number, d: Duck) => n.push({ t, voice: "duck", midi: [], dur: back - t, vel: 1, duck: d });
  /** An up-and-down arpeggio from `from` until `to`, a note each `step`, its velocity ramping a to b; doubled below if asked. */
  const arpeggio = (name: keyof typeof ARP, from: number, to: number, step: number, a: number, b: number, doubled = false) => {
    const tones = ARP[name];
    const cycle = [0, 1, 2, 3, 2, 1];
    for (let k = 0, t = from; t < to - ARP_GAP_S; k++, t = from + k * step) {
      const vel = a + ((b - a) * (t - from)) / (to - from);
      const midi = tones[cycle[k % cycle.length]];
      if (doubled) octave(t, midi, vel, step * 2);
      else bell(t, midi, vel, step * 2);
    }
  };

  // the seed, at dawn: phrase A over a soft Dadd9, left on its E (the question the end answers)
  chord(0, "Dadd9", 0.45, WATER_AT, 0.25);
  bell(0.4, 78, 0.4, 2);
  bell(1.0, 81, 0.38, 1.2); // "One"
  bell(1.7, 83, 0.42, 2.4); // "seed."
  bell(3.4, 81, 0.34, 1.2);
  bell(4.1, 78, 0.32, 1.2);
  bell(4.8, 76, 0.36, 2.6);

  // the can wakes and tips; the music holds its breath; the first drop lands in slow motion; warmth with the drink
  pad(WATER_AT, CHORD.Em7.pad, 0.45, 3);
  bass(6.6, 38, 0.3, 0.3);
  bass(7.0, 45, 0.3, 0.3);
  bass(7.4, 38, 0.3, 0.3);
  bell(7.9, 76, 0.28, 1.4);
  duck(8.6, 8.97, { music: -10, beds: -4, tauIn: 0.03, tauOut: 0.5 });
  bell(8.97, 86, 0.4, 1.6);
  chord(9.2, "Dadd9", 0.55, 3.6, 0.3);
  bell(9.6, 83, 0.34, 1.2); // "A little water,"
  bell(10.4, 81, 0.32, 1.6); // "each day."
  bell(10.9, 88, 0.22, 1);

  // the shoot, in 6/8; each of the can's last drips as it lands
  chord(GROW_AT, "Gmaj9", 0.7, 2.8, 0.35);
  arpeggio("Gmaj9", GROW_AT, 14.6, EIGHTH_S, 0.28, 0.36);
  [90, 88, 86, 86].forEach((midi, i) =>
    n.push({ t: [12.7, 13.2, 13.9, 14.45][i], voice: "bell", midi: [midi], dur: 1, vel: [0.24, 0.22, 0.18, 0.14][i], drip: i }),
  );
  // the sky races; the first raindrops; a hush for the shower
  chord(14.6, "DoverFs", 0.75, 2.2, 0.375);
  arpeggio("DoverFs", 14.6, 16.8, EIGHTH_S, 0.36, 0.42);
  bell(16.35, 88, 0.26, 0.8);
  bell(16.6, 86, 0.26, 0.8);
  bell(16.9, 90, 0.26, 0.8);
  chord(16.8, "Em7", 0.55, 2.4, 0.3);
  arpeggio("Em7", 16.8, 19.0, 2 * EIGHTH_S, 0.26, 0.22);
  bell(17.2, 83, 0.3, 1.4); // "The real"
  bell(17.9, 81, 0.28, 1.4); // "Bangalore"
  bell(18.6, 78, 0.3, 2); // "sky."
  pad(19.0, CHORD.Bm7.pad, 0.5, 1.6);
  // the sun breaks: the first growth, wide, the arpeggio quickening and doubled in octaves into the bud
  chord(20.3, "Gmaj7wide", 0.8, 2.6, 0.35);
  arpeggio("Gmaj7", 20.3, 22.6, EIGHTH_S * (2 / 3), 0.32, 0.44, true);
  pad(22.6, CHORD.Asus4.pad, 0.7, 1.2);
  arpeggio("Asus4", 22.6, 23.8, EIGHTH_S / 2, 0.44, 0.5, true);
  // the dominant, its bass held as a pedal through the held breath
  pad(23.8, CHORD.A.pad, 0.75, 1.4);
  bass(23.8, CHORD.A.root, 0.4, 5.4);
  arpeggio("A", 23.8, BLOOM_AT, EIGHTH_S / 2, 0.5, 0.3, true);

  // the held breath: a floor of A, two lone bells as the cloud slides, an intake of breath, a suck-out
  pad(BLOOM_AT, CHORD.A.pad, 0.4, 4.2);
  bell(25.6, 76, 0.3, 3.2);
  bell(27.9, 83, 0.3, 1.6);
  event(27.95, "swell", 0.3, 1.0, [62, 66, 69]);
  bell(28.7, 85, 0.32, 1.2); // the sepals part on C#6
  choke(28.95, -18);
  choke(29.39, 0);

  // the payoff, on the cut to the opening petals: home, wide, with the low D, one soft boom and phrase A in octaves;
  // the chord gives way as the rhyme's own comes in, so the bloom is a swell and the title stays the loudest moment
  pad(29.4, CHORD.D.pad, 1, 2.6);
  pad(29.4, [69, 74, 78], 0.38, 2.6);
  bass(29.4, 26, 0.6, 2.6);
  event(29.4, "boom", 0.3, 2.2);
  octave(29.4, 78, 0.6, 5);
  duck(29.4, 29.55, { beds: -6, tauIn: 0.01, tauOut: 0.8 });
  octave(29.9, 81, 0.55, 0.9);
  octave(30.4, 83, 0.58, 1.8);
  pad(31.6, CHORD.Gmaj7.pad, 0.55, 1.2);
  octave(31.6, 81, 0.48, 1.4);
  octave(32.1, 78, 0.45, 0.9);
  octave(32.6, 76, 0.44, 2.4);
  pad(32.6, CHORD.Asus4.pad, 0.5, 1);

  // the visitor: the theme solo over a high pad, no bass; phrase A slower, phrase B as she arrives
  pad(VISIT_AT, CHORD.DoverFs.pad, 0.4, 6);
  pad(VISIT_AT, [74, 78, 81], 0.2, 6);
  bell(33.65, 78, 0.42, 0.9); // "Sometimes,"
  bell(34.3, 81, 0.42, 0.9); // "a visitor."
  bell(34.9, 83, 0.44, 1.6);
  bell(36.2, 81, 0.4, 0.9);
  bell(36.9, 78, 0.4, 0.9);
  bell(37.6, 76, 0.42, 2.2);
  bell(39.25, 74, 0.4, 1.2);
  bell(39.8, 76, 0.38, 0.9);
  pad(39.8, CHORD.Em7.pad, 0.35, 2.2);
  bell(40.3, 78, 0.4, 2.6);
  bell(41.8, 81, 0.34, 1); // her head lifts
  // the peak: the high D the tune has reached for since the first note, as the focus arrives on her eyes
  octave(42.85, 86, 0.6, 3.2);
  pad(42.85, CHORD.D.pad, 0.45, 3);
  duck(42.95, 44.2, { music: -8, beds: -8, tauIn: 0.2, tauOut: 0.8 });
  bass(44.0, 38, 0.25, 1.6);

  // night: B minor, the lantern strikes, descending night notes, the call to choose, and a heartbeat
  chord(NIGHT_AT, "Bmadd9", 0.55, 2.6, 0.35);
  bell(45.6, 90, 0.3, 2.4);
  event(45.6, "fwoomp", 0.1, 0.4);
  bell(46.0, 74, 0.3, 2);
  bell(46.45, 71, 0.28, 2);
  chord(46.9, "Gmaj7", 0.5, 2.6, 0.3);
  bell(46.9, 69, 0.24, 2);
  bell(47.0, 81, 0.36, 1.2); // "Choose"
  event(47.4, "pulse", 0.22, 0.22);
  bell(47.6, 86, 0.4, 1.6); // "your flower"
  event(47.9, "swell", 0.25, 0.85, [55, 59, 62, 66, 69]);
  event(48.1, "pulse", 0.22, 0.22);

  // the flowers: each name chimes into the black of its gate (the hall rings through the hold); the flower's chord
  // and the picture come back together after it, with a pulse and the theme spread across the five
  const montage: { chime: readonly [number, number]; chord: ChordName; bells: readonly number[] }[] = [
    { chime: [74, 86], chord: "Gmaj9", bells: [88, 86, 81] },
    { chime: [76, 88], chord: "A", bells: [81, 78, 76] },
    { chime: [73, 85], chord: "Fsm7", bells: [74, 76, 78] },
    { chime: [78, 90], chord: "Bm7", bells: [81, 86] },
    { chime: [74, 86], chord: "Bb", bells: [86, 77, 82] },
  ];
  MONTAGE.forEach((_, i) => {
    const gate = GATES[i];
    const m = montage[i];
    const last = i === MONTAGE.length - 1;
    bell(gate - 0.3, m.chime[0], 0.3, 2.4);
    bell(gate - 0.3, m.chime[1], 0.22, 2.4);
    chord(gate + 0.22, m.chord, last ? 0.7 : 0.6, last ? 1.4 : 3.2, last ? 0.45 : 0.42);
    const pulse = 0.22 + 0.025 * i;
    event(gate + 0.22, "pulse", pulse, 0.22);
    event(gate + 1.62, "pulse", pulse, 0.22);
    const vel = 0.46 + (0.1 * i) / (MONTAGE.length - 1);
    m.bells.forEach((midi, k) => bell(gate + [0.3, 0.77, 1.23][k], midi, vel, k === m.bells.length - 1 ? 2.2 : 0.8));
  });
  event(53.4, "whoosh", 0.18, 0.95);
  event(61.0, "riser", 0.22, END_AT + 0.4 - 61.0);
  chord(61.6, "C", 0.8, 1.2, 0.5);
  bell(61.6, 79, 0.44, 1.2);
  bell(61.9, 84, 0.47, 1.2);
  bell(62.2, 88, 0.5, 1.2);

  // true silence, then the title's sting as one event, before the restore gate can split it; its chord is held only
  // while the title shows, so the coda's music box has the room to itself
  choke(END_AT + 0.4, -40);
  choke(TITLE_AT - 0.01, 0);
  pad(TITLE_AT, CHORD.Dwide.pad, 1, CODA_AT - TITLE_AT);
  bass(TITLE_AT, CHORD.Dwide.root, 0.6, CODA_AT - TITLE_AT);
  event(TITLE_AT, "boom", 0.35, 2.2);
  for (const midi of [74, 78, 81, 86]) bell(TITLE_AT, midi, 0.3, 3);
  event(TITLE_AT, "shimmer", 0.12, 4, [86]);
  duck(TITLE_AT, TITLE_AT + 2, { beds: -6, tauIn: 0.05, tauOut: 0.8 });

  // the button: the tagline, then "hel-lo" as the seed hops, A then D, each with a tiny hop
  bell(65.5, 78, 0.24, 2.4);
  bell(HELLO_AT, 81, 0.42, 1);
  event(HELLO_AT, "pft", 0.2, 0.025);
  bell(HELLO_AT + HELLO_GAP_S, 86, 0.48, 1.4);
  event(HELLO_AT + HELLO_GAP_S, "pft", 0.24, 0.025);

  // stable: notes at one time keep the order written (a chord's pad before its bass)
  return n.sort((a, b) => a.t - b.t);
}

/** The whole score, in time order. */
export const SCORE: readonly Note[] = compose();

/** The music fades from just before the garden is put back (trailer seconds), over the return to the party screen. */
export const FADE_FROM = HOME_AT - 0.25;
export const FADE_S = 2.8;

/**
 * Under the trailer's first black, before its clock starts (seconds from the click): the music box being wound (eight
 * clicks and a catch), a soft Dadd9 that waits open-ended for the first frame, and the dawn birds coming in.
 */
export const INTRO: {
  pad: readonly number[];
  padVel: number;
  clicks: readonly { at: number; vel: number }[];
  birds: { to: number; over: number };
} = {
  pad: CHORD.Dadd9.pad,
  padVel: 0.35,
  clicks: [...Array.from({ length: 8 }, (_, i) => ({ at: 0.3 + i * 0.11, vel: 0.1 })), { at: 1.25, vel: 0.07 }],
  birds: { to: 0.1, over: 4 },
};

/** Each flower's gate, where its name stands on black (re-exported for tests). */
export const CHIMES: readonly number[] = GATES.slice(0, MONTAGE.length);

// ---- the recordings under the music (beds.ts) -------------------------------------------------------------------------

/**
 * A long bed's level in trailer time: `keys` on straight lines, plus `perWind`, `perRain` and `perNight` (also straight
 * lines) times the frame's wind, its rain and smoothstep(NIGHT_FROM, NIGHT_TO, nightness). Every level is a linear
 * gain before the beds bus; each file measures about -24 LUFS, so these sit 10 to 16 dB under the music.
 */
export interface BedCue {
  key: BedKey;
  keys?: readonly Key[];
  perWind?: readonly Key[];
  perRain?: readonly Key[];
  perNight?: readonly Key[];
  /** the playback rate (straight lines), for the can's slow motion */
  rate?: readonly Key[];
  /** a low-pass on the bed (Hz) */
  lowpass?: number;
}

/** The night's crickets come in between these nightnesses. */
export const NIGHT_FROM = 0.55;
export const NIGHT_TO = 0.9;

/** The long beds. Every one is silent under the two chokes (28.95 to 29.39 and 62.8 to 63.39). */
export const BED_CUES: readonly BedCue[] = [
  {
    // dawn birds (they came in under the first black: INTRO), a little more as the shoot comes, gone for the rain,
    // back after it, quieter for the held breath, out with the suck-out, back for the payoff and the doe (the duck at
    // her look takes them down), gone as the chapter's black falls
    key: "birds-garden",
    keys: [
      [0, 0.14],
      [12.0, 0.14],
      [12.6, 0.16],
      [16.2, 0.16],
      [16.8, 0],
      [20.4, 0],
      [21.2, 0.18],
      [25.0, 0.18],
      [25.8, 0.08],
      [28.9, 0.08],
      [28.95, 0],
      [29.39, 0],
      [29.4, 0.1],
      [43.6, 0.1],
      [44.45, 0],
    ],
  },
  {
    // the can's pour, in slow motion while the picture is
    key: "water-fountain",
    keys: [
      [8.7, 0],
      [8.8, 0.3],
      [12.09, 0.3],
      [12.44, 0],
    ],
    rate: [
      [8.7, 1],
      [8.9, 0.72],
      [10.3, 0.72],
      [10.7, 1],
    ],
    lowpass: 4500,
  },
  {
    // the leaves follow the wind through the time-lapse, still for the held breath; the exhale after the payoff; a
    // breath under the doe
    key: "wind-leaves",
    perWind: [
      [11.0, 0],
      [11.4, 0.1],
      [26.4, 0.1],
      [26.8, 0],
    ],
    keys: [
      [30.8, 0],
      [31.4, 0.14],
      [33.6, 0.06],
      [44.2, 0.06],
      [44.45, 0],
    ],
  },
  {
    // the shower
    key: "rain-light",
    perRain: [
      [16.0, 0],
      [16.2, 0.5],
      [20.2, 0.5],
      [20.4, 0],
    ],
  },
  {
    // the drips after it, dying away under the sun
    key: "rain-after",
    keys: [
      [19.4, 0],
      [19.8, 0.25],
      [24.5, 0],
    ],
  },
  {
    // crickets as the night comes, a little lower under the montage, out for the silence, softly under the title, and
    // round the new seed
    key: "night-crickets",
    perNight: [
      [44.4, 0],
      [44.5, 0.24],
      [FLOWERS_AT, 0.24],
      [FLOWERS_AT + 0.4, 0.2],
      [END_AT, 0.2],
      [END_AT + 0.4, 0],
      [TITLE_AT - 0.01, 0],
      [TITLE_AT, 0.12],
      [TITLE_AT + 2, 0.12],
      [TITLE_AT + 2.5, 0.22],
    ],
  },
];

/** A call played once: `from` to `to` (s) of its file at trailer time `t`, at `vel`, panned. */
export interface Call {
  t: number;
  key: BedKey;
  from: number;
  to: number;
  vel: number;
  pan: number;
}

/** The calls: a robin at dawn, a koel after the rain (under "the real Bangalore sky"), the robin answering the doe. */
export const CALLS: readonly Call[] = [
  { t: 2.6, key: "call-magpie-robin", from: 0.15, to: 2.66, vel: 0.2, pan: 0 },
  { t: 20.6, key: "call-koel", from: 0, to: 0.74, vel: 0.3, pan: 0 },
  // she is screen left; it sings over the garden's hush (calls are never ducked)
  { t: 43.05, key: "call-magpie-robin", from: 0.15, to: 2.66, vel: 0.55, pan: -0.35 },
];

const smoothstep = (a: number, b: number, x: number) => {
  const s = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return s * s * (3 - 2 * s);
};

/** A long bed's level at trailer time t, for the frame's wind and rain and the sky's nightness. */
export function bedGain(cue: BedCue, t: number, wind: number, rain: number, nightness: number): number {
  let g = 0;
  if (cue.keys) g += linear(cue.keys, t);
  if (cue.perWind) g += linear(cue.perWind, t) * wind;
  if (cue.perRain) g += linear(cue.perRain, t) * rain;
  if (cue.perNight) g += linear(cue.perNight, t) * smoothstep(NIGHT_FROM, NIGHT_TO, nightness);
  return g;
}
