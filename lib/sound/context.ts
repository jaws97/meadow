// The one AudioContext the garden's sounds play through, and the unlock that wakes it. A browser lets sound start only
// inside a tap, a click or a key press, and iOS only if the context is resumed in that same moment, before any await,
// timer or promise: so `unlockAudio()` is synchronous, and every control that turns sound on calls it first, in its
// handler. It also asks iOS for a "playback" audio session (Safari 16.4+), so the garden is heard with the phone on
// silent and can keep playing with the screen locked; without it Web Audio counts as "ambient", the silent switch mutes
// it and locking stops it. Then it plays a single silent sample, the old iOS way of making sure the output is awake.
// A context that taps no longer wake can be closed and made again (`resetAudio`, then `unlockAudio` in the same tap).
//
// This file is tiny on purpose, with no other imports: page-level code can call it in a tap without pulling in the
// engine (lib/sound/engine, loaded by a dynamic import), which picks the context up with `audioContext()`. Nothing
// here throws: on a machine with no Web Audio the garden is simply silent.

/** The context's sample timing: favour battery over latency, since nothing here is played live. */
const LATENCY_HINT: AudioContextLatencyCategory = "playback";

let context: AudioContext | null = null;

/** iOS's audio session (Safari 16.4+), not yet in TypeScript's DOM types. */
type SessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Wakes the garden's audio. Call it first thing, synchronously, inside a click, keydown or pointerup handler: it asks
 * for a "playback" audio session where the browser has one, creates the context if there is none, resumes it and
 * primes it with one silent sample. Never throws.
 * @returns the context, or null where Web Audio is unavailable
 */
export function unlockAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const session = (navigator as SessionNavigator).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    // an older Safari, or a session that will not change: the context still plays, as "ambient"
  }
  try {
    if (!context || context.state === "closed") {
      if (typeof AudioContext === "undefined") return null;
      context = new AudioContext({ latencyHint: LATENCY_HINT });
    }
  } catch {
    context = null;
    return null;
  }
  const ctx = context;
  try {
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  } catch {
    // resume refused: the engine notices the context is not running and asks for another tap
  }
  try {
    const prime = ctx.createBufferSource();
    prime.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    prime.connect(ctx.destination);
    prime.onended = () => prime.disconnect();
    prime.start();
  } catch {
    // priming is a nicety
  }
  return ctx;
}

/** The garden's AudioContext if a tap has made it, otherwise null. */
export function audioContext(): AudioContext | null {
  return context;
}

/**
 * Closes the garden's context and forgets it, for one that a tap cannot wake (WebKit 276016: after Safari loses focus
 * on iOS 17.4.1 to 17.6 a context can stay silent for the rest of the visit). Call `unlockAudio()` straight after, in
 * the same tap, to make a fresh one; the engine notices the new context, builds its graph on it and plays the last mix
 * again with the buffers it already decoded. Never throws.
 */
export function resetAudio(): void {
  const old = context;
  context = null;
  if (!old) return;
  try {
    void old.close().catch(() => undefined);
  } catch {
    // already closed
  }
}
