// The visitor's own choice of picture: the quality tier the garden is drawn at. Auto, the default, leaves it to the
// device and the governor, as before (lib/garden/device, lib/garden/quality). Cinematic, Balanced or Light is a choice
// made by hand in the name pill's menu (components/gift/PicturePicker). Light is the "lite" tier; only the words
// differ.
//
// A choice belongs to the device (browser storage), so every garden this device opens is drawn at it: its own, and a
// friend's from the Meadow. The Meadow keeps its own tier per device class (components/meadow/MeadowCanvas), and the
// party screen keeps its `&quality=` address, so the choice is not read there. A `?quality=` in the address still
// pins that tier for the visit, for testing. A choice made by hand is pinned: the governor leaves the tier alone (it
// still moves the pixel budget) and does not remember it as the tier Auto settled on (device.rememberTier).
//
// A tier above what Auto picks can be too much for a device: a phone's browser may kill the page, or the graphics
// may be lost. So while such a choice is on screen, and the page is in front, a guard mark sits in storage; it is
// lifted when the page goes to the background or away. A visit that finds the mark still there (the last page died
// in front) opens on Auto, with a note under the pill saying so. A WebGL context lost in front on such a choice falls
// back the same way, and the page reloads at once, since the garden it was drawing is gone; lost in the background
// (a browser freeing memory), the choice stays and the page reloads once it is in front.
//
// This module holds no reference to the garden store: the store calls startPicture as it picks the opening tier, and
// the picker applies a choice to the garden itself. Browser storage is a convenience; without it the garden is
// simply on Auto.
import { useSyncExternalStore } from "react";
import { TIERS, type DeviceKind } from "@/lib/garden/device";
import type { Quality } from "@/lib/garden/store";

export type PictureChoice = "auto" | Quality;

/** The menu's order: Auto first, then richest to lightest. */
export const PICTURE_CHOICES: readonly PictureChoice[] = ["auto", "cinematic", "balanced", "lite"];

export const PICTURE_NAME: Record<PictureChoice, string> = { auto: "Auto", cinematic: "Cinematic", balanced: "Balanced", lite: "Light" };

/** What each tier gives, under its name in the menu (Auto's line names the tier it picked instead). */
export const PICTURE_LINE: Record<Quality, string> = {
  cinematic: "Sunlight through the petals, softest depth",
  balanced: "Rich light, soft shadows",
  lite: "Cooler, and easier on the battery",
};

export interface PictureState {
  choice: PictureChoice;
  /** The tier Auto picks on this device: the opening's own (remembered or planned), then the last one Auto drew. */
  auto: Quality;
  /** The choice is drawn on this page (not the party screen, not a `?quality=` pin), so the guard watches it. */
  applies: boolean;
  /** A choice above Auto fell back to Auto (the tier it was), until the pill has said so. */
  fellBack: Quality | null;
}

/** Browser storage as this module uses it; a stand-in for tests. */
export type PictureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CHOICE_KEY = "garden-picture:v1";
const GUARD_KEY = "garden-picture-guard:v1";
const FELL_BACK_KEY = "garden-picture-fell-back:v1";
/** A fall-back note not yet seen is dropped after a week. */
const FELL_BACK_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const isTier = (v: unknown): v is Quality => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** `tier` is richer than `auto`. */
export const above = (tier: Quality, auto: Quality): boolean => TIERS.indexOf(tier) > TIERS.indexOf(auto);

function local(): PictureStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(s: PictureStorage | null, key: string): Record<string, unknown> | null {
  try {
    const raw = s?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function write(s: PictureStorage | null, key: string, value: object | null) {
  try {
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the next visit is on Auto
  }
}

const readTier = (s: PictureStorage | null, key: string): Quality | null => {
  const t = read(s, key)?.tier;
  return isTier(t) ? t : null;
};

let state: PictureState = { choice: "auto", auto: "balanced", applies: false, fellBack: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PictureState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const picture = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePicture<T>(selector: (s: PictureState) => T): T {
  return useSyncExternalStore(
    picture.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/**
 * Called once as the page picks its opening tier (lib/garden/store), with the tier Auto would open on. Returns the
 * tier chosen by hand to open on instead, or null for Auto. A guard mark left by the last page on a choice above Auto
 * means that page died in front: the choice is dropped, and the pill will say so.
 */
export function startPicture(auto: Quality, opts: { party: boolean; pinnedByUrl: boolean }, s: PictureStorage | null = local()): Quality | null {
  if (opts.party) {
    set({ choice: "auto", auto, applies: false, fellBack: null });
    return null;
  }
  let chosen = readTier(s, CHOICE_KEY);
  const guarded = readTier(s, GUARD_KEY);
  if (guarded !== null) {
    write(s, GUARD_KEY, null);
    if (chosen !== null && guarded === chosen && above(chosen, auto)) {
      write(s, CHOICE_KEY, null);
      write(s, FELL_BACK_KEY, { tier: chosen, at: Date.now() });
      chosen = null;
    }
  }
  const note = read(s, FELL_BACK_KEY);
  const fresh = note !== null && typeof note.at === "number" && Date.now() - note.at < FELL_BACK_MAX_AGE_MS;
  if (note !== null && !fresh) write(s, FELL_BACK_KEY, null);
  set({ choice: chosen ?? "auto", auto, applies: !opts.pinnedByUrl, fellBack: fresh && isTier(note.tier) ? note.tier : null });
  return opts.pinnedByUrl ? null : chosen;
}

/**
 * The visitor picked `choice` in the menu; `shown` is the tier on screen now. Leaving Auto, that tier is what Auto
 * comes back to. Storage and this store only: the picker applies it to the garden.
 */
export function setPictureChoice(choice: PictureChoice, shown: Quality, s: PictureStorage | null = local()) {
  const auto = state.choice === "auto" ? shown : state.auto;
  write(s, CHOICE_KEY, choice === "auto" ? null : { tier: choice, at: Date.now() });
  set({ choice, auto, applies: true });
}

/** The pill has said the choice fell back to Auto. */
export function clearFellBack(s: PictureStorage | null = local()) {
  write(s, FELL_BACK_KEY, null);
  if (state.fellBack !== null) set({ fellBack: null });
}

/** A choice above Auto is drawn on this page: the one case the guard watches. */
export const guarded = (p: PictureState = state): boolean => p.applies && p.choice !== "auto" && above(p.choice, p.auto);

/** The choice drops to Auto after the graphics were lost on it (the page reloads next). */
export function fallBack(s: PictureStorage | null = local()) {
  if (state.choice === "auto") return;
  const tier = state.choice;
  write(s, CHOICE_KEY, null);
  write(s, GUARD_KEY, null);
  write(s, FELL_BACK_KEY, { tier, at: Date.now() });
  set({ choice: "auto", fellBack: tier });
}

/**
 * Keeps the guard mark while a choice above Auto is drawn on the canvas and the page is in front, and falls back to
 * Auto (then reloads) if the canvas loses its graphics on such a choice. Returns the cleanup.
 */
export function watchPicture(canvas: HTMLCanvasElement, s: PictureStorage | null = local()): () => void {
  let lost = false;
  const sync = () => {
    if (!lost && guarded() && document.visibilityState === "visible") write(s, GUARD_KEY, { tier: state.choice, at: Date.now() });
    else write(s, GUARD_KEY, null);
  };
  const leave = () => write(s, GUARD_KEY, null);
  const reloadInFront = () => {
    if (document.visibilityState === "visible") window.location.reload();
  };
  const onLost = () => {
    if (lost || !guarded()) return;
    lost = true;
    // lost in the background, a browser freeing memory: the choice stays, and the page reloads once it is in front
    if (document.visibilityState === "visible") fallBack(s);
    else write(s, GUARD_KEY, null);
    document.addEventListener("visibilitychange", reloadInFront);
    reloadInFront();
  };
  const off = picture.subscribe(sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", sync);
  canvas.addEventListener("webglcontextlost", onLost);
  sync();
  return () => {
    off();
    document.removeEventListener("visibilitychange", sync);
    document.removeEventListener("visibilitychange", reloadInFront);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", sync);
    canvas.removeEventListener("webglcontextlost", onLost);
    leave();
  };
}

/** The device in the menu's words: "this phone", "this laptop". */
export function deviceWord(kind: DeviceKind | undefined): string {
  return kind === "bigscreen" ? "screen" : (kind ?? "device");
}

/** Said under a tier richer than Auto's: held in the hand, a device runs warm; on a desk, it may stutter. */
export function pictureWarning(kind: DeviceKind | undefined): string {
  const word = deviceWord(kind);
  return kind === "phone" || kind === "tablet" ? `May run warm on this ${word}` : `May be less smooth on this ${word}`;
}

/** The pill's note after a choice fell back to Auto. */
export function fellBackNote(tier: Quality, kind: DeviceKind | undefined): string {
  return `Back on Auto. ${PICTURE_NAME[tier]} was too much for this ${deviceWord(kind)} last time.`;
}

/** The Picture row's summary: "Auto · Light", or the tier chosen by hand. */
export function pictureSummary(choice: PictureChoice, autoTier: Quality): string {
  return choice === "auto" ? `Auto · ${PICTURE_NAME[autoTier]}` : PICTURE_NAME[choice];
}
