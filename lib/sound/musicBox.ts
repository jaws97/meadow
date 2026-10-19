// The music box tile: the party trailer's music box and pad (components/party/trailer/music.ts) playing an endless
// piece that never repeats, written as it goes by a few gentle rules. This file holds the rules only, as plain numbers
// (tested in node, musicBox.test.ts); the engine (lib/sound/engine-layers) asks for the next few seconds of notes and
// plays them with the trailer's voices (lib/sound/engine-synth).
//
// Everything keeps to D major pentatonic (D, E, F#, A, B), which has no note that can clash with another, so the box
// and the pad always agree. The box walks up and down the scale in small steps, a note every one or two slow beats,
// in phrases of four to nine notes. Each phrase comes to rest on D or A, held a little longer, and a short breath
// follows before the next; now and then a note is struck with the one two steps below it, a soft third or fourth.
// Under it a pad (four notes of the same scale, swelling in and fading out) changes chord every 8 to 16 s, wandering
// between D, B minor, A and E without a third and coming home to D often. The bells stay between A4 and E6, the pad
// between A2 and A4, and the music never falls silent for longer than a breath.
//
// It is deterministic for a seed (lib/plant/prng), so a test can hear the same piece twice; the engine seeds it at
// random each time the tile starts.
import { Rng } from "@/lib/plant/prng";

/** D major pentatonic, as pitch classes: D, E, F#, A, B. */
export const PENTATONIC: readonly number[] = [2, 4, 6, 9, 11];
/** The tones a phrase comes to rest on: D and A. */
const RESTING: readonly number[] = [2, 9];
/** The music box's range (MIDI): A4 to E6, the trailer's register. */
export const BELL_LOW = 69;
export const BELL_HIGH = 88;
/** The pad's range (MIDI): A2 to A4. */
export const PAD_LOW = 45;
export const PAD_HIGH = 69;
/** The box's slow pulse (s a beat), about 80 a minute. */
export const BEAT_S = 0.75;
/** The longest the music may fall silent (s). */
export const MAX_SILENCE_S = 6;

const inScale = (midi: number) => PENTATONIC.includes(((midi % 12) + 12) % 12);

/** Every pitch the box plays, low to high. */
export const BELL_NOTES: readonly number[] = Array.from({ length: BELL_HIGH - BELL_LOW + 1 }, (_, i) => BELL_LOW + i).filter(inScale);

/** The pad's chords, every note inside the pentatonic, and where each likes to go next. */
const CHORDS = {
  Dadd9: { midi: [50, 57, 64, 66], next: ["Bm7", "Asus4", "Esus", "D69"] },
  D69: { midi: [50, 57, 59, 64], next: ["Bm7", "Asus4", "Esus"] },
  Bm7: { midi: [47, 54, 57, 62], next: ["Esus", "Asus4", "Dadd9"] },
  Esus: { midi: [52, 59, 62, 66], next: ["Asus4", "Dadd9", "Bm7"] },
  Asus4: { midi: [45, 52, 57, 62], next: ["Dadd9", "Dadd9", "D69", "Bm7"] },
} as const satisfies Record<string, { midi: readonly number[]; next: readonly string[] }>;
type ChordName = keyof typeof CHORDS;

/** A note of the piece: a music-box note (one or two pitches struck together) or a pad chord. */
export interface BoxNote {
  /** seconds from the start of the piece */
  t: number;
  voice: "bell" | "pad";
  /** MIDI note numbers, sounded together */
  midi: readonly number[];
  /** 0..1 */
  vel: number;
  /** how long it sounds (s): a bell rings on about this long, a pad holds this long and then fades */
  dur: number;
}

/** An endless piece: each call returns the notes from where the last left off up to (not including) `t`, in order. */
export interface Composer {
  until(t: number): BoxNote[];
}

/** Steps along the scale, and how often each is taken (a gentle walk, mostly to a neighbour). */
const STEPS: readonly [number, number][] = [
  [-3, 0.03],
  [-2, 0.12],
  [-1, 0.31],
  [0, 0.06],
  [1, 0.31],
  [2, 0.12],
  [3, 0.03],
];
/** A note's length in beats, as often as listed; a phrase's last note is held for 2 to 4. */
const BEATS: readonly number[] = [1, 1, 1, 1, 2, 2, 1.5, 0.5];

/** A new piece in D, the same piece for the same seed. */
export function createComposer(seed: number | string): Composer {
  const rng = new Rng(typeof seed === "number" ? `music-box:${seed}` : seed);

  // the box
  let bellAt = 1.2;
  let index = BELL_NOTES.indexOf(81);
  let left = 0;
  let first = true;

  // the pad
  let padAt = 0.1;
  let chord: ChordName = "Dadd9";

  let pendingBell: BoxNote | null = null;
  let pendingPad: BoxNote | null = null;

  const step = (): number => {
    // lean back towards the middle of the range near its ends
    const middle = (BELL_NOTES.length - 1) / 2;
    const lean = (index - middle) / middle;
    let u = rng.next();
    for (const [s, p] of STEPS) {
      const weight = p * (1 - 0.6 * lean * Math.sign(s));
      if (u < weight) return s;
      u -= weight;
    }
    return lean > 0 ? -1 : 1;
  };

  const restingNear = (i: number): number => {
    for (let d = 0; d < BELL_NOTES.length; d++)
      for (const j of [i - d, i + d]) if (j >= 0 && j < BELL_NOTES.length && RESTING.includes(BELL_NOTES[j] % 12)) return j;
    return i;
  };

  const nextBell = (): BoxNote => {
    if (left === 0) {
      left = rng.int(4, 9);
      first = true;
    }
    const last = left === 1;
    let i = index + step();
    if (i < 0) i = -i;
    if (i >= BELL_NOTES.length) i = 2 * (BELL_NOTES.length - 1) - i;
    if (last) i = restingNear(i);
    index = i;
    const beats = last ? rng.pick([2, 3, 4]) : rng.pick(BEATS);
    const dur = Math.max(1, beats) * BEAT_S;
    let vel = 0.3 + 0.08 * rng.next();
    if (first) vel += 0.06;
    if (last) vel -= 0.04;
    const midi = !first && index >= 2 && rng.next() < 0.14 ? [BELL_NOTES[index - 2], BELL_NOTES[index]] : [BELL_NOTES[index]];
    const note: BoxNote = { t: bellAt, voice: "bell", midi, vel, dur };
    bellAt += beats * BEAT_S;
    first = false;
    left--;
    // a breath between phrases
    if (left === 0) bellAt += rng.range(1.2, 4);
    return note;
  };

  const nextPad = (): BoxNote => {
    const gap = rng.range(8, 16);
    const note: BoxNote = { t: padAt, voice: "pad", midi: CHORDS[chord].midi, vel: rng.range(0.45, 0.62), dur: gap + rng.range(-1.5, 1) };
    padAt += gap;
    const options: readonly string[] = CHORDS[chord].next;
    chord = rng.pick(options) as ChordName;
    return note;
  };

  return {
    until(t: number): BoxNote[] {
      const out: BoxNote[] = [];
      for (;;) {
        pendingBell ??= nextBell();
        pendingPad ??= nextPad();
        const note = pendingBell.t <= pendingPad.t ? pendingBell : pendingPad;
        if (note.t >= t) return out;
        out.push(note);
        if (note === pendingBell) pendingBell = null;
        else pendingPad = null;
      }
    },
  };
}
