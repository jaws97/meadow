// The party trailer's recorded beds and calls: real birds at dawn, the can's water, wind in the leaves, the shower and
// the drips after it, a magpie-robin and a koel, and crickets at night, under the music (components/party/trailer/
// music, which plays them on the cues in score.ts). Every file is CC0 (lib/sound/library), so the trailer needs no
// credit for them.
//
// The party screen asks for them once it is live, at idle (PartyScreen), long before anyone presses D: the eight files
// (about 3.4 MB, cached for good under their hashed names) are fetched side by side and decoded one at a time by the
// garden's own loader (lib/sound/engine-loader) into a one-sample OfflineAudioContext at the files' own 48 kHz, so no
// AudioContext is opened before the click. Each decoded file is cut down at once to the stretch the trailer plays
// (TRIMS), about 23 MB for the set instead of 77, and the full decode is let go. A bed's stretch is made to loop
// without a seam: its last second is crossfaded (equal power) into its first, so it can run as long as a slow laptop
// and the gate holds stretch the trailer. The trimmed buffers are kept here, at module level, so they outlive the
// trailer's audio graph and serve every later run and the offline preview; a file that failed to arrive is simply
// missing (the music skips its cues, or plays its synth stand-in) and is asked for again the next time.
import { Loader } from "@/lib/sound/engine-loader";
import { soundFile } from "@/lib/sound/library";

/** The trailer's recordings, by their keys in lib/sound/library (all CC0). */
export type BedKey =
  | "birds-garden"
  | "call-magpie-robin"
  | "call-koel"
  | "water-fountain"
  | "wind-leaves"
  | "rain-light"
  | "rain-after"
  | "night-crickets";

/** A recording's stretch kept in memory: from `from` (s into the file), `seconds` long, made to loop or not. */
export interface Trim {
  from: number;
  seconds: number;
  loop: boolean;
}

/**
 * What the trailer keeps of each file. A bed starts at least 0.6 s in, past the fade the file was made with, and loops
 * over its stretch; a call keeps only its first phrase or two, which it plays once.
 */
export const TRIMS: Readonly<Record<BedKey, Trim>> = {
  // the whole file, less its faded ends and the second the loop's crossfade takes
  "birds-garden": { from: 0.6, seconds: 47.8, loop: true },
  "call-magpie-robin": { from: 0, seconds: 3, loop: false },
  "call-koel": { from: 0, seconds: 1, loop: false },
  "water-fountain": { from: 0.6, seconds: 6, loop: true },
  "wind-leaves": { from: 0.6, seconds: 17, loop: true },
  "rain-light": { from: 0.6, seconds: 6, loop: true },
  "rain-after": { from: 0.6, seconds: 5, loop: true },
  "night-crickets": { from: 0.6, seconds: 30, loop: true },
};

export const BED_KEYS = Object.keys(TRIMS) as readonly BedKey[];

/** The rate the files were made at, and the rate they are decoded and kept at (Hz). */
export const BED_RATE = 48000;
/** A looping bed's tail is crossfaded into its head over this long (s), so the loop has no seam. */
export const LOOP_FADE_S = 1;

const buffers = new Map<BedKey, AudioBuffer>();
let loading: Promise<void> | null = null;

/** A bed's trimmed buffer, if it has arrived. */
export function bedBuffer(key: BedKey): AudioBuffer | undefined {
  return buffers.get(key);
}

/**
 * Cuts `trim` out of a decoded file into a new mono buffer. A looping trim takes LOOP_FADE_S more from the file and
 * folds it over the start: the head fades in under the tail of what follows the stretch, so the last sample runs on
 * into the first exactly as the file did.
 */
function cut(ctx: BaseAudioContext, file: AudioBuffer, trim: Trim): AudioBuffer {
  const rate = file.sampleRate;
  const source = file.getChannelData(0);
  const start = Math.min(source.length, Math.round(trim.from * rate));
  const fade = trim.loop ? Math.round(LOOP_FADE_S * rate) : 0;
  const length = Math.max(1, Math.min(Math.round(trim.seconds * rate), source.length - start - fade));
  const data = new Float32Array(length);
  data.set(source.subarray(start, start + length));
  for (let i = 0; i < fade && i < length; i++) {
    const s = (i / fade) * (Math.PI / 2);
    data[i] = source[start + i] * Math.sin(s) + source[start + length + i] * Math.cos(s);
  }
  const out = ctx.createBuffer(1, length, rate);
  out.copyToChannel(data, 0);
  return out;
}

/**
 * Fetches and decodes every bed not yet held, one decode at a time, and keeps each one's trim. Safe to call again: a
 * load in progress is shared, and a later call asks again only for what failed. Never rejects.
 */
export function prefetchBeds(): Promise<void> {
  if (loading) return loading;
  const wanted = BED_KEYS.filter((key) => !buffers.has(key));
  if (wanted.length === 0) return Promise.resolve();
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(1, 1, BED_RATE);
  } catch {
    // no Web Audio here: the trailer plays its synth stand-ins
    return Promise.resolve();
  }
  // a loader of its own, let go with its full decodes once the trims are kept
  const loader = new Loader();
  const failed: string[] = [];
  loading = Promise.all(
    wanted.map((key) => {
      const file = soundFile(key);
      if (!file) {
        failed.push(key);
        return Promise.resolve();
      }
      return loader.load(file, ctx).then(
        (decoded) => {
          buffers.set(key, cut(ctx, decoded, TRIMS[key]));
          loader.cache.delete(key);
        },
        () => {
          failed.push(key);
        },
      );
    }),
  ).then(() => {
    loading = null;
    if (failed.length > 0) console.warn(`[party] the trailer's recordings did not all arrive (${failed.join(", ")}); their cues are left out`);
  });
  return loading;
}
