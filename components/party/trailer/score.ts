// The party trailer's music, written to its timeline (script.ts): a music box over a warm pad and a soft bass, in D
// major, quiet and slow, as calm as the garden. Every note is placed on the trailer's own clock, so it lands with the
// picture whatever the laptop does: a twinkle or two over the seed at dawn; an arpeggio that climbs and quickens as the
// rose grows, thinning to a hush for the shower; a swell into D as the bloom opens; a little theme for the doe, its
// last note as she lifts her head to the rose; low, sparse notes as night falls; a chime as each flower comes up out
// of the black; and the home chord under "Your seed is waiting". Pure data, read by components/party/trailer/music.ts.
import { BLOOM_AT, CARD, END_AT, FLOWER_S, FLOWERS_AT, GATES, GROW_AT, MONTAGE, NIGHT_AT, VISIT_AT } from "@/components/party/trailer/script";

/** A music-box note, a pad chord (several notes, slow to swell and fade), or a bass note. */
export type Voice = "bell" | "pad" | "bass";

export interface Note {
  /** trailer seconds */
  t: number;
  voice: Voice;
  /** MIDI note numbers (a pad sounds them together) */
  midi: readonly number[];
  /** seconds the note is held (a bell rings on past it, a pad and a bass fade after it) */
  dur: number;
  /** 0..1 */
  vel: number;
}

// ---- the harmony (D major) ------------------------------------------------------------------------------------------

/** Pad voicings, around middle C, and their roots for the bass. */
const CHORD = {
  Dadd9: { pad: [50, 57, 64, 66], root: 38 },
  D: { pad: [50, 54, 57, 62, 66, 69], root: 38 },
  Gmaj9: { pad: [55, 62, 66, 69], root: 43 },
  Gmaj7: { pad: [55, 59, 62, 66], root: 43 },
  DoverFs: { pad: [54, 57, 62, 69], root: 42 },
  Em7: { pad: [52, 59, 62, 67], root: 40 },
  Bm7: { pad: [47, 54, 57, 62], root: 35 },
  Bmadd9: { pad: [47, 54, 61, 62], root: 35 },
  Asus4: { pad: [45, 52, 57, 62], root: 33 },
  A: { pad: [45, 52, 57, 61], root: 33 },
  Fsm7: { pad: [54, 57, 61, 64], root: 42 },
} as const;
type ChordName = keyof typeof CHORD;

/** The music box's tones over each chord, low to high (the 5th and 6th octaves). */
const ARP: Record<ChordName, readonly number[]> = {
  Dadd9: [74, 76, 78, 81],
  D: [74, 78, 81, 86],
  Gmaj9: [74, 79, 81, 83],
  Gmaj7: [74, 78, 79, 83],
  DoverFs: [74, 78, 81, 86],
  Em7: [76, 79, 83, 86],
  Bm7: [74, 78, 81, 83],
  Bmadd9: [73, 74, 78, 83],
  Asus4: [74, 76, 81, 86],
  A: [73, 76, 81, 85],
  Fsm7: [73, 76, 78, 81],
};

/** The scale every note keeps to (pitch classes of D major). */
export const D_MAJOR: readonly number[] = [2, 4, 6, 7, 9, 11, 1];

function chord(out: Note[], t: number, name: ChordName, dur: number, vel = 0.8, bass = true) {
  out.push({ t, voice: "pad", midi: CHORD[name].pad, dur, vel });
  if (bass) out.push({ t, voice: "bass", midi: [CHORD[name].root], dur, vel: vel * 0.7 });
}

function bell(out: Note[], t: number, midi: number, vel: number, dur = 1.6) {
  out.push({ t, voice: "bell", midi: [midi], dur, vel });
}

/** An up-and-down arpeggio over `name` from `from` to `to`, a note every `step` seconds, at a velocity ramping a to b. */
function arpeggio(out: Note[], name: ChordName, from: number, to: number, step: number, a: number, b: number) {
  const tones = ARP[name];
  const cycle = [0, 1, 2, 3, 2, 1];
  let k = 0;
  for (let t = from; t < to - 1e-6; t += step, k++) {
    const s = (t - from) / Math.max(1e-6, to - from);
    bell(out, t, tones[cycle[k % cycle.length]], a + (b - a) * s, step * 2);
  }
}

// ---- the score ------------------------------------------------------------------------------------------------------

function compose(): Note[] {
  const n: Note[] = [];

  // the seed, at dawn: the home chord with an added ninth, and a few twinkles over the mound's glow
  chord(n, 0, "Dadd9", GROW_AT + 1.2, 0.7);
  bell(n, 1.6, 81, 0.42, 2.4);
  bell(n, 3.4, 78, 0.36, 2.4);
  bell(n, 5.2, 76, 0.32, 2.4);
  bell(n, 7.4, 81, 0.38, 1.2);
  bell(n, 8.2, 86, 0.42, 2.4);

  // the rose grows: a chord every bar of 3.2 s, the music box climbing; a hush for the shower; quickening to the bud
  const grow: [number, ChordName][] = [
    [GROW_AT, "Gmaj9"],
    [GROW_AT + 3.2, "DoverFs"],
    [GROW_AT + 6.4, "Em7"],
    [GROW_AT + 9.6, "Bm7"],
    [GROW_AT + 12.8, "Gmaj7"],
    [GROW_AT + 16, "Asus4"],
    [GROW_AT + 17.6, "A"],
  ];
  grow.forEach(([t, name], i) => chord(n, t, name, (grow[i + 1]?.[0] ?? BLOOM_AT) - t + 1, i === 3 ? 0.55 : 0.8));
  arpeggio(n, "Gmaj9", GROW_AT, GROW_AT + 3.2, 0.8, 0.34, 0.4);
  arpeggio(n, "DoverFs", GROW_AT + 3.2, GROW_AT + 6.4, 0.8, 0.4, 0.42);
  // the shower (script RAIN, GROW_AT + 7 to + 14.5): fewer and softer notes
  arpeggio(n, "Em7", GROW_AT + 6.4, GROW_AT + 9.6, 1.6, 0.32, 0.28);
  arpeggio(n, "Bm7", GROW_AT + 9.6, GROW_AT + 12.8, 1.6, 0.26, 0.3);
  // after the rain, quickening as the bud forms
  arpeggio(n, "Gmaj7", GROW_AT + 12.8, GROW_AT + 16, 0.4, 0.32, 0.44);
  arpeggio(n, "Asus4", GROW_AT + 16, GROW_AT + 17.6, 0.4, 0.44, 0.5);
  arpeggio(n, "A", GROW_AT + 17.6, BLOOM_AT, 0.4, 0.5, 0.56);

  // the bloom: the dominant held, a rising run, and the swell home into D as the petals open (script BLOOM, + 3 to + 10)
  chord(n, BLOOM_AT, "A", 4.8, 0.85);
  bell(n, BLOOM_AT + 2.2, 81, 0.5, 0.6);
  bell(n, BLOOM_AT + 2.6, 83, 0.52, 0.6);
  bell(n, BLOOM_AT + 3.0, 85, 0.55, 1.2);
  chord(n, BLOOM_AT + 4.5, "D", 7.2, 1);
  bell(n, BLOOM_AT + 5.0, 78, 0.6, 1.2);
  bell(n, BLOOM_AT + 5.4, 81, 0.62, 1.2);
  bell(n, BLOOM_AT + 5.8, 86, 0.66, 2.4);
  bell(n, BLOOM_AT + 7.4, 88, 0.5, 1.6);
  bell(n, BLOOM_AT + 8.2, 86, 0.5, 3.2);
  bell(n, BLOOM_AT + 10.2, 90, 0.36, 3.2);

  // the visitor: a little theme for the doe; its last note as she lifts her head toward the rose (tour.ts arrive)
  chord(n, VISIT_AT - 0.6, "Gmaj7", 4.2, 0.7);
  chord(n, VISIT_AT + 3.6, "Fsm7", 3.4, 0.65);
  chord(n, VISIT_AT + 7, "Em7", 3, 0.65);
  chord(n, VISIT_AT + 10, "Asus4", 1.6, 0.6);
  chord(n, VISIT_AT + 11.6, "D", NIGHT_AT - VISIT_AT - 11.6 + 1.4, 0.7);
  const theme: [number, number, number][] = [
    [1, 78, 0.8],
    [1.8, 81, 0.8],
    [2.6, 83, 1.6],
    [4.2, 81, 0.8],
    [5, 78, 0.8],
    [5.8, 76, 1.6],
    [7.4, 74, 0.8],
    [8.2, 76, 0.8],
    [9, 78, 1.6],
    [10.6, 81, 0.8],
    [11.4, 86, 3.2],
  ];
  for (const [dt, midi, dur] of theme) bell(n, VISIT_AT + dt, midi, 0.46, dur);

  // night falls: a darker colour of the home key, low and sparse (crickets come in under it: music.ts)
  chord(n, NIGHT_AT, "Bmadd9", 4.8, 0.6);
  chord(n, NIGHT_AT + 4.5, "Gmaj7", FLOWERS_AT - NIGHT_AT - 4.5 + 1.4, 0.55);
  bell(n, NIGHT_AT + 1, 78, 0.34, 2.4);
  bell(n, NIGHT_AT + 2.6, 74, 0.3, 2.4);
  bell(n, NIGHT_AT + 5, 71, 0.3, 2.4);
  bell(n, NIGHT_AT + 6.6, 69, 0.28, 2.4);
  bell(n, NIGHT_AT + 7.8, 74, 0.26, 3.2);

  // the flowers: each comes up out of the black with a chime of its own chord
  const flowers: ChordName[] = ["Gmaj7", "A", "Fsm7", "Bm7", "Gmaj9"];
  MONTAGE.forEach((_, i) => {
    const gate = GATES[i];
    const name = flowers[i];
    chord(n, gate, name, FLOWER_S + 0.6, 0.6);
    const [a, b, c, d] = ARP[name];
    bell(n, gate + 0.2, a, 0.46, 0.8);
    bell(n, gate + 0.34, b, 0.48, 0.8);
    bell(n, gate + 0.48, c, 0.5, 2.4);
    bell(n, gate + 1.9, d, 0.34, 2.4);
  });

  // the end: the dominant under the dip to black, then home, ringing down under the closing card
  chord(n, END_AT, "Asus4", CARD.from - END_AT, 0.6);
  chord(n, CARD.from - 0.2, "D", 6, 0.8);
  bell(n, CARD.from, 86, 0.56, 1.6);
  bell(n, CARD.from + 0.8, 81, 0.46, 1.6);
  bell(n, CARD.from + 1.6, 78, 0.4, 2.4);
  bell(n, CARD.from + 2.8, 74, 0.34, 4);

  return n.sort((a, b) => a.t - b.t);
}

/** The whole score, in time order. */
export const SCORE: readonly Note[] = compose();

/** The music fades from as the closing card goes (trailer seconds), over the return to the party screen. */
export const FADE_FROM = CARD.to - 0.4;
export const FADE_S = 3.2;

/** Under the trailer's first black, before its clock starts: the home chord swelling in, and a first note. */
export const INTRO: { pad: readonly number[]; bell: number; bellAt: number } = { pad: CHORD.Dadd9.pad, bell: 81, bellAt: 1.2 };

/** Each flower's gate, when its chime sounds (re-exported for tests). */
export const CHIMES: readonly number[] = MONTAGE.map((_, i) => GATES[i]);

