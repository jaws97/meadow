"use client";
// The sound store: what the person has asked to hear in their own garden, and what the engine (lib/sound/engine) is
// doing about it. The sound panel reads it with useSound(selector) and changes it only through soundActions; the
// engine never sees the panel. A tiny external store in the garden's way (lib/garden/store): { get, subscribe } and a
// useSyncExternalStore hook whose server snapshot is the defaults, so the page renders the same on the server and on
// its first client pass, and the device's remembered choice (lib/sound/prefs) arrives once it has hydrated.
//
// Sound never starts by itself. It starts only from a tap: every action that can start it (toggle, start, chooseLive,
// toggleTile, applyMix, resume) is called by the panel synchronously inside a click, key press or pointerup, and
// calls unlockAudio (lib/sound/context) first, before anything is awaited, since that is the only moment iOS lets the
// audio wake. When the engine is already loaded the action also hands it the new state in that same moment, so a
// piece of music starts inside the tap that chose it. Sound that was on when the person last left is not resumed;
// the panel offers a gentle "tap to resume" (resumeHint) instead.
//
// The engine's code, the live garden (lib/sound/live) and its ears on the scene (lib/sound/scene, which brings
// three.js) are all loaded by dynamic import: at idle time once the sound button is on screen (preloadEngine), or on
// the first tap if that has not happened yet. This file stays small and free of three.js, as it rides in the page's
// own bundle. In the live garden the scene feed reports the sky and the weather every couple of seconds and each
// report becomes the engine's new Mixdown; in the person's own mix the engine plays their tiles. The feed rests while
// the engine is paused (the page hidden, without "keep playing"), so nothing is fetched for a sound nobody hears, and
// looks again at once when the page comes back, so the garden is heard as it is then, not as it was.
//
// When a sound file will not load the engine says so (failed()) and the panel's live region says "The sounds could
// not load just now"; the engine tries again by itself. When the browser stops the sound and a tap does not bring it
// back, a second tap within a minute closes the audio context and makes a fresh one in that same tap (resetAudio),
// the way out of WebKit's stuck contexts; the engine plays on with the buffers it has. Sound turned off before the
// engine's code has even loaded still lets the audio context rest (suspend), so a phone's own music is not held up.
//
// Everything the person chooses is remembered on this device (writePrefs) as they choose it, except the panel being
// open, the passing notice and the engine's status. A fade-out timer is set on the engine's audio clock, so it ends
// even while a locked phone throttles timers; when the engine reports idle at its end, the timer and the remembered
// "sound was on" are cleared, so a sleeper is not asked to resume in the morning. The phone's lock screen can pause and
// play the engine directly (Media Session); the store follows it either way, so the panel never says one thing while
// the garden does another.
import { useSyncExternalStore } from "react";
import { clamp01 } from "@/lib/plant/prng";
import { MAX_LAYERS, group, mix, tile } from "@/lib/sound/catalog";
import { audioContext, resetAudio, unlockAudio } from "@/lib/sound/context";
import { cleanLayers, DEFAULT_PREFS, readPrefs, TIMER_MINUTES, writePrefs, type TimerMinutes } from "@/lib/sound/prefs";
import type { Engine, EngineStatus, LiveInput, MixLayer, Mixdown } from "@/lib/sound/types";

/** The panel's lines, in the garden's calm voice. */
export const LIMIT_NOTICE = "Five sounds at once is the most. Remove one first.";
export const LOAD_NOTICE = "The sounds could not load just now. Try again in a moment.";
export const NO_AUDIO_NOTICE = "This browser cannot play the garden's sounds.";
/** What the live garden is called in the panel and on the lock screen. */
export const LIVE_TITLE = "Live garden";

/** How a picked or removed tile, or a newly applied mix, eases in or out (s, the engine's time constant). */
const MIX_TAU_S = 0.8;
/** How closely a layer follows its slider (s). */
const SLIDER_TAU_S = 0.15;
/** The first live state after sound starts, or after a switch to the live garden, eases in this fast (s); later ones
 * follow the sky slowly (lib/sound/live's LIVE_TAU_S). */
const SWITCH_TAU_S = 1.2;
/** How long a notice stays for its live region (ms). */
const NOTICE_MS = 4000;
/** A slider's last value is written to storage this long after it stops moving (ms). */
const PERSIST_SOON_MS = 400;
/** The longest fade at the end of a timer (s), and the share of the timer's length the fade takes when shorter. */
const SLEEP_FADE_MAX_S = 180;
const SLEEP_FADE_SHARE = 0.2;
/** The engine reporting idle this close to the timer's end (ms) is the timer ending (its audio clock may run apart
 * from Date.now() a little). */
const TIMER_SLACK_MS = 3000;
/** If the engine has not stopped by itself this long after the timer's end (ms), the store stops it: a page paused
 * while hidden may not reach the end on its audio clock. */
const SLEEP_GRACE_MS = 5000;
/** The engine's chunks load at idle time, or after this long at the latest (ms), or this long after the button mounts
 * where the browser has no idle callback (Safari). */
const PRELOAD_TIMEOUT_MS = 4000;
const PRELOAD_FALLBACK_MS = 1500;
/** Levels and call rates closer than this are the same to the ear, so the live feed does not resend them. */
const SAME_LEVEL = 0.002;
const SAME_CALLS_PER_MIN = 0.01;
/** A tap on resume this soon after the last one, with the sound still blocked, makes a fresh audio context (ms). */
const STUCK_WINDOW_MS = 60_000;

export interface SoundState {
  /** from the engine, as the panel shows it (shownStatus): "idle" before the first start and once stopped */
  status: EngineStatus;
  mode: "live" | "mix";
  /** the person's own mix (used when mode is "mix") */
  layers: MixLayer[];
  /** the ready-made mix last applied, while it is unchanged */
  mixId: string | null;
  /** the master volume, 0..1 */
  volume: number;
  /** the fade-out timer's length (min; 0 for none) */
  timerMin: TimerMinutes;
  /** when the timer ends (epoch ms), while sound plays under one */
  timerEndsAt: number | null;
  /** keep playing when hidden or locked */
  background: boolean;
  /** tile keys still loading */
  loading: string[];
  panelOpen: boolean;
  /** sound was on at the end of the last visit and is not on now */
  resumeHint: boolean;
  /** "Live garden: dawn birds and a light breeze", "Monsoon evening", "Light rain", "3 sounds"; "" when off */
  nowPlaying: string;
  /** a short polite message for a live region (the five-sound limit); clears itself after NOTICE_MS */
  notice: string | null;
}

const DEFAULT_STATE: SoundState = {
  status: "idle",
  mode: DEFAULT_PREFS.mode,
  layers: [],
  mixId: null,
  volume: DEFAULT_PREFS.volume,
  timerMin: 0,
  timerEndsAt: null,
  background: DEFAULT_PREFS.background,
  loading: [],
  panelOpen: false,
  resumeHint: false,
  nowPlaying: "",
  notice: null,
};

// ---- pure rules, tested in node (store.test.ts) ----

/**
 * A tile tapped in a mix: taken out if it is in, else added at its own level. A tile from an exclusive group (music)
 * takes the place of the one playing. Refused, with the mix unchanged, if the mix already has `max` tiles.
 */
export function toggleLayer(layers: readonly MixLayer[], key: string, max: number = MAX_LAYERS): { layers: MixLayer[]; refused: boolean } {
  const t = tile(key);
  if (!t) return { layers: [...layers], refused: false };
  if (layers.some((l) => l.key === key)) return { layers: layers.filter((l) => l.key !== key), refused: false };
  const added = { key, level: t.level };
  if (group(t.group).exclusive) {
    // in the rival's place, so the panel's sliders keep their order (a mix holds one tile of the group at most)
    const rival = layers.findIndex((l) => tile(l.key)?.group === t.group);
    if (rival >= 0) return { layers: layers.map((l, i) => (i === rival ? added : l)), refused: false };
  }
  if (layers.length >= max) return { layers: [...layers], refused: true };
  return { layers: [...layers, added], refused: false };
}

/** The name of a mix for the panel and the lock screen: the ready-made mix's, one tile's, or "3 sounds"; "" for none. */
export function mixTitle(layers: readonly MixLayer[], mixId: string | null): string {
  const ready = mixId ? mix(mixId) : undefined;
  if (ready) return ready.label;
  if (layers.length === 0) return "";
  if (layers.length === 1) return tile(layers[0].key)?.label ?? "1 sound";
  return `${layers.length} sounds`;
}

/**
 * The engine's status as the panel shows it: what the person asked for leads. Stopped is "idle" at once, though the
 * engine is still fading out; asked for and not yet sounding (the engine's code still loading) is "starting".
 */
export function shownStatus(on: boolean, engine: EngineStatus): EngineStatus {
  if (!on) return "idle";
  return engine === "idle" ? "starting" : engine;
}

/** Whether two Mixdowns sound the same (the same layers and calls within a hair); their easing is not compared. */
export function sameMixdown(a: Mixdown, b: Mixdown): boolean {
  if (a.layers.length !== b.layers.length) return false;
  for (const l of a.layers) {
    const m = b.layers.find((x) => x.key === l.key);
    if (!m || Math.abs(m.level - l.level) > SAME_LEVEL) return false;
  }
  if (!a.shots || !b.shots) return a.shots === b.shots;
  return (
    a.shots.sounds.join() === b.shots.sounds.join() &&
    Math.abs(a.shots.perMinute - b.shots.perMinute) <= SAME_CALLS_PER_MIN &&
    Math.abs(a.shots.level - b.shots.level) <= SAME_LEVEL
  );
}

/** The fade at the end of a timer of `min` minutes (s): a fifth of it, three minutes at most. */
export function sleepFadeS(min: number): number {
  return Math.min(SLEEP_FADE_MAX_S, SLEEP_FADE_SHARE * min * 60);
}

/** The person's mix as the engine plays it, eased over `tauS`. */
function mixdownOf(layers: readonly MixLayer[], tauS: number): Mixdown {
  return { layers: layers.map((l) => ({ key: l.key, level: l.level })), shots: null, tauS };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- the chunks loaded on demand ----

interface Chunk<T> {
  /** the module, once loaded */
  get(): T | null;
  /** loads it (once; again after a failure) */
  load(): Promise<T>;
}

function chunk<T>(importer: () => Promise<T>): Chunk<T> {
  let mod: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    get: () => mod,
    load() {
      pending ??= importer().then(
        (m) => (mod = m),
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
      return pending;
    },
  };
}

const engineChunk = chunk(() => import("@/lib/sound/engine"));
const liveChunk = chunk(() => import("@/lib/sound/live"));
const sceneChunk = chunk(() => import("@/lib/sound/scene"));

function ready(mode: SoundState["mode"]): boolean {
  return engineChunk.get() !== null && (mode === "mix" || (liveChunk.get() !== null && sceneChunk.get() !== null));
}

function loadFor(mode: SoundState["mode"]): Promise<unknown> {
  return Promise.all(mode === "live" ? [engineChunk.load(), liveChunk.load(), sceneChunk.load()] : [engineChunk.load()]);
}

// ---- the store ----

function fromPrefs(): SoundState {
  const p = readPrefs();
  return { ...DEFAULT_STATE, mode: p.mode, layers: p.layers, mixId: p.mixId, volume: p.volume, timerMin: p.timerMin, background: p.background, resumeHint: p.wasOn };
}

let state: SoundState = typeof window === "undefined" ? DEFAULT_STATE : fromPrefs();
const listeners = new Set<() => void>();

/** The person wants sound now (a tap started it and nothing has stopped it). */
let on = false;
/** Sound was on when last left, as remembered; true from a start until a stop. */
let wasOn = state.resumeHint;
/** Bumped by every start from silence and every stop, so a slow load cannot start sound the person has since stopped. */
let generation = 0;
let engine: Engine | null = null;
/** The engine's own status as last reported (the panel's is shownStatus). */
let engineStatus: EngineStatus = "idle";
let stopFeed: (() => void) | null = null;
/** The live Mixdown last sent, so a feed report that changes nothing to the ear is not resent. */
let lastLive: Mixdown | null = null;
/** The next live report is the first after a start or a switch, and eases in quickly. */
let quickNext = false;
/** The lock-screen title and the timer's end last handed to the engine, so each is sent once. */
let titleSent = "";
let sleepSentAt: number | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let preloadAsked = false;
/** The tiles the engine last said could not load, so each failure is told once. */
let failedSeen: readonly string[] = [];
/** When a tap last tried to bring blocked sound back (epoch ms). */
let blockedResumeAt = -Infinity;

function set(patch: Partial<SoundState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function persist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const { mode, layers, volume, background, timerMin, mixId } = state;
  writePrefs({ mode, layers, volume, background, timerMin, wasOn, mixId });
}

/** Persists after a slider settles rather than on every step of it. */
function persistSoon(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, PERSIST_SOON_MS);
}

if (typeof window !== "undefined") {
  // a slider let go just before the page closes is still remembered
  window.addEventListener("pagehide", () => {
    if (persistTimer !== null) persist();
  });
}

function notify(text: string): void {
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  set({ notice: text });
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    set({ notice: null });
  }, NOTICE_MS);
}

function showNowPlaying(text: string): void {
  if (text !== state.nowPlaying) set({ nowPlaying: text });
  if (text && engine && text !== titleSent) {
    titleSent = text;
    engine.setNowPlaying(text);
  }
}

/** The engine, made on first use (inside a tap, after the unlock, so it finds the context); null until its chunk loads. */
function engineNow(): Engine | null {
  if (engine) return engine;
  const m = engineChunk.get();
  if (!m) return null;
  const made: Engine = m.getEngine();
  engine = made;
  made.subscribe(syncEngine);
  return made;
}

function syncEngine(): void {
  if (!engine) return;
  const raw = engine.status();
  const was = engineStatus;
  engineStatus = raw;
  if (on && raw === "idle" && was !== "idle") {
    // The engine stopped by itself: at the timer's end, or from the lock screen's pause. The store follows; the
    // engine has already stopped, so it is not told again.
    if (state.timerEndsAt !== null && Date.now() >= state.timerEndsAt - TIMER_SLACK_MS) endTimer(false);
    else halt(false);
    return;
  }
  if (!on && raw !== "idle" && was === "idle") {
    // The lock screen's play brought the sound back: the store follows it, once this report is over, so the engine
    // is not re-entered from its own listener.
    queueMicrotask(() => {
      if (!on && engine && engine.status() !== "idle") rejoin();
    });
  }
  if (on && state.mode === "live") {
    if (raw === "paused" && !state.background) {
      // hidden and faded out: the feed rests too, so no file is fetched for a sound nobody hears
      stopFeedNow();
    } else if (was === "paused" && raw !== "paused" && !stopFeed) {
      // back: look at the garden at once, as it is now, and ease into it quickly (after this report, as above)
      queueMicrotask(() => {
        if (on && state.mode === "live" && engine && engine.status() !== "paused") startFeed();
      });
    }
  }
  const failed = engine.failed();
  if (on && failed.some((key) => !failedSeen.includes(key))) notify(LOAD_NOTICE);
  failedSeen = [...failed];
  const status = shownStatus(on, raw);
  const loading = engine.loading();
  const patch: Partial<SoundState> = {};
  if (status !== state.status) patch.status = status;
  if (!sameList(loading, state.loading)) patch.loading = [...loading];
  if (patch.status !== undefined || patch.loading !== undefined) set(patch);
}

function stopFeedNow(): void {
  const stop = stopFeed;
  stopFeed = null;
  lastLive = null;
  stop?.();
}

/** Starts listening to the garden, if not already; its first look (at once) eases in quickly. */
function startFeed(): void {
  const scene = sceneChunk.get();
  if (stopFeed || !scene) return;
  quickNext = true;
  lastLive = null;
  stopFeed = scene.startLiveFeed(onLive);
}

function onLive(input: LiveInput): void {
  const live = liveChunk.get();
  if (!on || state.mode !== "live" || !engine || !live) return;
  const next = live.liveMixdown(input);
  if (quickNext) {
    quickNext = false;
    lastLive = next;
    engine.set({ ...next, tauS: SWITCH_TAU_S });
  } else if (!lastLive || !sameMixdown(lastLive, next)) {
    lastLive = next;
    engine.set(next);
  }
  showNowPlaying(`${LIVE_TITLE}: ${live.describeLive(input)}`);
}

function clearSleepTimer(): void {
  if (sleepTimer !== null) clearTimeout(sleepTimer);
  sleepTimer = null;
}

/** Starts the timer from now (or cancels it, with no timer chosen or no sound on). */
function armTimer(): void {
  clearSleepTimer();
  if (!on || state.timerMin === 0) {
    if (state.timerEndsAt !== null) set({ timerEndsAt: null });
    engine?.sleepAt(null);
    return;
  }
  const at = Date.now() + state.timerMin * 60_000;
  set({ timerEndsAt: at });
  if (engine) {
    sleepSentAt = at;
    engine.sleepAt(at, sleepFadeS(state.timerMin));
  }
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (on && state.timerEndsAt !== null && Date.now() >= state.timerEndsAt) endTimer(true);
  }, at - Date.now() + SLEEP_GRACE_MS);
}

/** Plays the state as it is now. Synchronous: inside a tap, a piece of music starts in that tap. */
function play(): void {
  if (!ready(state.mode)) return;
  const e = engineNow();
  if (!e) return;
  e.setVolume(state.volume);
  e.setBackground(state.background);
  if (state.mode === "live") {
    // the feed looks at once, so the engine is set in this same moment
    startFeed();
  } else {
    stopFeedNow();
    e.set(mixdownOf(state.layers, MIX_TAU_S));
    showNowPlaying(mixTitle(state.layers, state.mixId));
  }
  if (state.timerEndsAt === null) {
    if (state.timerMin > 0) armTimer();
  } else if (sleepSentAt !== state.timerEndsAt) {
    // a timer chosen while the engine's code was still loading
    sleepSentAt = state.timerEndsAt;
    e.sleepAt(state.timerEndsAt, sleepFadeS(state.timerMin));
  }
  syncEngine();
}

/** Plays the state now if everything it needs has loaded, else as soon as it has (unless the person stops first). */
function apply(): void {
  if (ready(state.mode)) {
    play();
    return;
  }
  const gen = generation;
  if (state.status !== "starting") set({ status: "starting" });
  loadFor(state.mode).then(
    () => {
      if (on && gen === generation) play();
    },
    () => {
      if (on && gen === generation) {
        halt();
        notify(LOAD_NOTICE);
      }
    },
  );
}

/** An empty mix has nothing to play: the live garden plays instead. */
function liveIfEmpty(): void {
  if (state.mode === "mix" && state.layers.length === 0) set({ mode: "live", mixId: null });
}

/** Lets the audio context rest when there is no engine to do it (sound stopped before the engine's code loaded). */
function restContext(): void {
  try {
    void audioContext()
      ?.suspend()
      .catch(() => undefined);
  } catch {
    // already closed, or nothing to suspend
  }
}

function begin(): void {
  if (!unlockAudio()) {
    notify(NO_AUDIO_NOTICE);
    return;
  }
  liveIfEmpty();
  if (!on) {
    on = true;
    generation++;
  }
  wasOn = true;
  if (state.resumeHint) set({ resumeHint: false });
  persist();
  // a title at once, while the engine's code may still be loading; the live feed's first look adds its words
  if (state.mode === "mix") showNowPlaying(mixTitle(state.layers, state.mixId));
  else if (!state.nowPlaying.startsWith(LIVE_TITLE)) showNowPlaying(LIVE_TITLE);
  apply();
}

/**
 * Sound off, with nothing to resume next visit. The engine fades out (its stop also cancels a timer's fade, without
 * bringing the sound back up first); `tellEngine` is false when the engine stopped by itself.
 */
function halt(tellEngine = true): void {
  on = false;
  generation++;
  stopFeedNow();
  clearSleepTimer();
  sleepSentAt = null;
  wasOn = false;
  failedSeen = [];
  blockedResumeAt = -Infinity;
  if (tellEngine) {
    // the unlock in the tap that started it woke the context: with no engine yet, it is put back to rest here
    if (engine) engine.stop();
    else restContext();
  }
  set({ status: "idle", nowPlaying: "", timerEndsAt: null, resumeHint: false });
  persist();
}

/** The timer ran out: the sound has faded away. It stays off, with no timer and nothing to resume next time. */
function endTimer(tellEngine: boolean): void {
  set({ timerMin: 0 });
  halt(tellEngine);
}

/** Sound came back without the panel (the lock screen's play): on again, as the person last chose it. */
function rejoin(): void {
  liveIfEmpty();
  on = true;
  generation++;
  wasOn = true;
  if (state.resumeHint) set({ resumeHint: false });
  persist();
  apply();
}

/** After a change to what plays: hands it to the engine when sound is on (inside this tap), else starts sound. */
function changed(): void {
  if (on) {
    unlockAudio();
    persist();
    apply();
  } else {
    begin();
  }
}

export const sound = {
  get: (): SoundState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Reads the sound store in React; re-renders only when the selected value changes. The selector must return a stored
 * value or a primitive (not a new array or object on each call). The server, and the first client pass, see the
 * defaults.
 */
export function useSound<T>(selector: (s: SoundState) => T): T {
  return useSyncExternalStore(
    sound.subscribe,
    () => selector(state),
    () => selector(DEFAULT_STATE),
  );
}

/**
 * Everything the sound panel can do. Those marked GESTURE must be called synchronously inside a click, keydown or
 * pointerup handler: they wake the audio (unlockAudio) before anything else.
 */
export const soundActions = {
  /** GESTURE. Sound on (the live garden or the person's mix, as last chosen) or off. */
  toggle(): void {
    if (on) halt();
    else begin();
  },
  /** GESTURE. Sound on, as last chosen. */
  start(): void {
    begin();
  },
  /**
   * Sound off, fading out; nothing to resume next visit. When it is already off this only makes sure the engine, and
   * the phone's lock screen, have let go (the sound button calls it as it leaves the page), and keeps the resume offer.
   */
  stop(): void {
    if (on) halt();
    else engine?.stop();
  },
  /** GESTURE. The live garden, following the real sky and weather; starts sound if it is off. */
  chooseLive(): void {
    set({ mode: "live", mixId: null });
    changed();
  },
  /**
   * GESTURE. A tile in or out of the person's mix. From the live garden it starts a mix of just this tile. Music
   * replaces the music playing; a sixth tile is refused with a notice; taking out the last tile stops the sound (the
   * mode stays "mix"). Starts sound if it is off.
   */
  toggleTile(key: string): void {
    if (!tile(key)) return;
    const result = toggleLayer(state.mode === "live" ? [] : state.layers, key);
    if (result.refused) {
      notify(LIMIT_NOTICE);
      return;
    }
    set({ mode: "mix", layers: result.layers, mixId: null });
    if (result.layers.length > 0) changed();
    else if (on) halt();
    else persist();
  },
  /** GESTURE. A ready-made mix (lib/sound/catalog MIXES) in place of the person's; starts sound if it is off. */
  applyMix(id: string): void {
    const ready = mix(id);
    if (!ready) return;
    set({ mode: "mix", layers: cleanLayers(ready.layers), mixId: ready.id });
    changed();
  },
  /**
   * GESTURE. Brings sound back: after the browser blocked or paused it, or from the "tap to resume" hint. A second tap
   * within STUCK_WINDOW_MS, with the sound still blocked (and not for want of files), makes a fresh audio context.
   */
  resume(): void {
    const e = on ? engineNow() : null;
    const blocked = e !== null && e.status() === "blocked";
    if (blocked && e.failed().length === 0 && Date.now() - blockedResumeAt < STUCK_WINDOW_MS) resetAudio();
    unlockAudio();
    if (blocked) blockedResumeAt = Date.now();
    if (on) e?.resume();
    else begin();
  },
  /** A tile's level in the person's mix, 0..1; follows the finger. Forgets the ready-made mix's name. */
  setLevel(key: string, level: number): void {
    const i = state.layers.findIndex((l) => l.key === key);
    if (i < 0 || !Number.isFinite(level)) return;
    const v = clamp01(level);
    if (v === state.layers[i].level) return;
    const layers = state.layers.map((l, j) => (j === i ? { key: l.key, level: v } : l));
    set({ layers, mixId: null });
    persistSoon();
    if (on && state.mode === "mix" && engine) {
      engine.set(mixdownOf(layers, SLIDER_TAU_S));
      showNowPlaying(mixTitle(layers, null));
    }
  },
  /** The master volume, 0..1. */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = clamp01(volume);
    if (v === state.volume) return;
    set({ volume: v });
    persistSoon();
    engine?.setVolume(v);
  },
  /** The fade-out timer (min; 0 for none), counted from now while sound plays, or from the next start. */
  setTimer(min: TimerMinutes): void {
    if (!(TIMER_MINUTES as readonly number[]).includes(min)) return;
    set({ timerMin: min });
    persist();
    armTimer();
  },
  /** Keep playing when the page is hidden or the phone is locked. */
  setBackground(keep: boolean): void {
    if (keep === state.background) return;
    set({ background: keep });
    persist();
    engine?.setBackground(keep);
  },
  openPanel(): void {
    if (!state.panelOpen) set({ panelOpen: true });
  },
  closePanel(): void {
    if (state.panelOpen) set({ panelOpen: false });
  },
  togglePanel(): void {
    set({ panelOpen: !state.panelOpen });
  },
  /** "Not now" to the resume hint: it is not offered again until sound has been on once more. */
  dismissResumeHint(): void {
    if (state.resumeHint) set({ resumeHint: false });
    if (!on && wasOn) {
      wasOn = false;
      persist();
    }
  },
  /** Loads the engine, the live garden and its scene feed at idle time, so the first tap plays at once. */
  preloadEngine(): void {
    if (preloadAsked || typeof window === "undefined") return;
    preloadAsked = true;
    const go = () => {
      // each on its own, so one that fails does not hold back the others; a tap tries a failed one again
      void engineChunk.load().catch(() => undefined);
      void liveChunk.load().catch(() => undefined);
      void sceneChunk.load().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(go, { timeout: PRELOAD_TIMEOUT_MS });
    else window.setTimeout(go, PRELOAD_FALLBACK_MS);
  },
};
