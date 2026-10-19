// What this device remembers of the person's sound (lib/sound/store): the live garden or their own mix, the mix's
// tiles and levels, the volume, the fade-out timer, whether to keep playing when the screen locks, and whether sound
// was on when they last left, so the next visit can offer a gentle "tap to resume" (sound never starts by itself).
//
// In localStorage under "garden-sound:v1", a convenience only: without it the panel opens on the live garden at the
// default volume. Everything read back is checked as if it were junk (an older build, a hand edit, another tab
// half-way through a write): unknown tiles are dropped, a mix keeps to MAX_LAYERS tiles and to one piece of music
// (lib/sound/catalog's exclusive groups), levels and the volume are clamped to 0..1, and anything else falls back to
// its default. The same rules for a mix (cleanLayers) serve the store when it reads a ready-made mix.
import { clamp01 } from "@/lib/plant/prng";
import { MAX_LAYERS, group, mix, tile } from "@/lib/sound/catalog";
import type { MixLayer } from "@/lib/sound/types";

/** The localStorage key. */
export const SOUND_PREFS_KEY = "garden-sound:v1";

/** The fade-out timer's choices (minutes; 0 is no timer). */
export const TIMER_MINUTES = [0, 15, 30, 60] as const;
export type TimerMinutes = (typeof TIMER_MINUTES)[number];

export interface SoundPrefs {
  /** the live garden (the default), or the person's own mix */
  mode: "live" | "mix";
  /** the person's own mix: tile keys and levels (0..1), at most MAX_LAYERS, one piece of music at most */
  layers: MixLayer[];
  /** the master volume, 0..1 */
  volume: number;
  /** keep playing while the page is hidden or the phone is locked */
  background: boolean;
  /** fade out and stop after this many minutes (0 for never) */
  timerMin: TimerMinutes;
  /** sound was on when the person last left the garden */
  wasOn: boolean;
  /** the ready-made mix (lib/sound/catalog MIXES) the layers came from, while they are unchanged; else null */
  mixId: string | null;
}

/** The master volume on a first visit, 0..1. */
export const DEFAULT_VOLUME = 0.8;

export const DEFAULT_PREFS: Readonly<SoundPrefs> = Object.freeze({
  mode: "live",
  layers: [],
  volume: DEFAULT_VOLUME,
  background: false,
  timerMin: 0,
  wasOn: false,
  mixId: null,
});

/**
 * A mix as the panel allows it, from anything: real tiles only, each once, at most one tile from an exclusive group
 * (music), at most MAX_LAYERS, in the order given (the first of each wins); levels clamped to 0..1, and a tile without
 * a usable level starts at its own (Tile.level).
 */
export function cleanLayers(raw: unknown): MixLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: MixLayer[] = [];
  const seen = new Set<string>();
  const exclusiveTaken = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_LAYERS) break;
    if (!item || typeof item !== "object") continue;
    const { key, level } = item as { key?: unknown; level?: unknown };
    if (typeof key !== "string") continue;
    const t = tile(key);
    if (!t || seen.has(key)) continue;
    if (group(t.group).exclusive) {
      if (exclusiveTaken.has(t.group)) continue;
      exclusiveTaken.add(t.group);
    }
    seen.add(key);
    out.push({ key, level: typeof level === "number" && Number.isFinite(level) ? clamp01(level) : t.level });
  }
  return out;
}

/** The same tiles, in any order (levels aside). */
function sameTiles(a: readonly MixLayer[], b: readonly MixLayer[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((l) => l.key));
  return b.every((l) => keys.has(l.key));
}

/**
 * Prefs from whatever was stored (an object, or its JSON text): every field checked, anything unusable replaced by its
 * default. Never throws.
 */
export function parsePrefs(raw: unknown): SoundPrefs {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PREFS, layers: [] };
  const r = value as Record<string, unknown>;
  const layers = cleanLayers(r.layers);
  const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? clamp01(r.volume) : DEFAULT_VOLUME;
  const timerMin = (TIMER_MINUTES as readonly unknown[]).includes(r.timerMin) ? (r.timerMin as TimerMinutes) : 0;
  const ready = typeof r.mixId === "string" ? mix(r.mixId) : undefined;
  return {
    mode: r.mode === "mix" ? "mix" : "live",
    layers,
    volume,
    background: r.background === true,
    timerMin,
    wasOn: r.wasOn === true,
    // a mix's name stays only while the remembered tiles are still that mix's
    mixId: ready && sameTiles(ready.layers, layers) ? ready.id : null,
  };
}

/** This device's remembered prefs, or the defaults (on the server, without storage, or with nothing stored). */
export function readPrefs(): SoundPrefs {
  try {
    const stored = window.localStorage.getItem(SOUND_PREFS_KEY);
    return stored === null ? parsePrefs(null) : parsePrefs(stored);
  } catch {
    // no window (the server), or storage blocked (private browsing): the defaults
    return parsePrefs(null);
  }
}

/** Remembers the prefs on this device; quietly does nothing where storage is unavailable or full. */
export function writePrefs(prefs: SoundPrefs): void {
  try {
    window.localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private browsing or full storage: the choice lasts this visit only
  }
}
