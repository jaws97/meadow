// The Meadow's data, fetched in the browser: the shared snapshot (GET /api/meadow), polled politely; who this device
// belongs to (GET /api/session); a friend's plant for the visit card and the full plant drawn in its plot
// (GET /api/garden/[plot]); and the one sprinkle a day (POST /api/sprinkle). Kept in a tiny external store so the
// canvas reads the latest without re-rendering and React re-renders only where a value is selected.
//
// Polling: every POLL_MS while the page is visible, with If-None-Match so an unchanged Meadow costs a bodiless 304
// (the CDN holds the snapshot for five seconds anyway). Hidden tabs stop polling and catch up as soon as they are
// shown again; a failed poll backs off to a minute, quietly, keeping the last Meadow on screen.
//
// Retries (the backend's rules): a sprinkle is retried by itself only on 503 busy or unavailable, honouring
// Retry-After with a little jitter and resending the same body with the same clientEventId, so a retry can never
// count twice. Every other refusal is shown as the server's own message.
import { useSyncExternalStore } from "react";
import type { FriendGarden, MeadowPlot, MeadowSnapshot } from "@/lib/server/meadow";

export type { FriendGarden, MeadowPlot, MeadowSnapshot };

const POLL_MS = 10_000;
const BACKOFF_MS = [20_000, 40_000, 60_000];

export interface MeadowData {
  status: "loading" | "ready" | "error";
  snapshot: MeadowSnapshot | null;
  byPlot: ReadonlyMap<number, MeadowPlot>;
  /** the highest planted plot index, or -1 */
  highest: number;
  /** bumped whenever the snapshot's plants change */
  version: number;
  /** plots that appeared since the page opened, with when (performance.now() ms): they arrive with a burst of light */
  appeared: ReadonlyMap<number, number>;
}

let data: MeadowData = { status: "loading", snapshot: null, byPlot: new Map(), highest: -1, version: 0, appeared: new Map() };
const listeners = new Set<() => void>();

function set(patch: Partial<MeadowData>) {
  data = { ...data, ...patch };
  listeners.forEach((l) => l());
}

export const meadowData = {
  get: () => data,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useMeadowData<T>(selector: (d: MeadowData) => T): T {
  return useSyncExternalStore(
    meadowData.subscribe,
    () => selector(data),
    () => selector(data),
  );
}

/** Two plants are the same on screen when nothing the Meadow draws or says about them has changed. */
const samePlot = (a: MeadowPlot, b: MeadowPlot) =>
  a.species === b.species && a.name === b.name && a.stage === b.stage && a.health === b.health && a.bloom === b.bloom && a.generation === b.generation;

/**
 * Development only: `?demo=360` tops the real snapshot up with made-up plants (in this browser alone, nothing is
 * stored anywhere) to see how the Meadow holds up full, as it will be at the party.
 */
function withDemoPlants(snapshot: MeadowSnapshot): MeadowSnapshot {
  if (process.env.NODE_ENV === "production") return snapshot;
  const want = Number(new URLSearchParams(window.location.search).get("demo"));
  if (!Number.isInteger(want) || want <= snapshot.plots.length) return snapshot;
  const species = ["rose", "sundrop", "magnolia", "marigold", "tefiti", "jasmine"] as const;
  const stages = ["seed", "seed", "seed", "sprout", "sprout", "leafy", "leafy", "bud", "bloom"] as const;
  const taken = new Set(snapshot.plots.map((p) => p.plot));
  const plots = [...snapshot.plots];
  for (let i = 0; plots.length < want && i < 1152; i++) {
    if (taken.has(i)) continue;
    const stage = stages[(i * 7) % stages.length];
    plots.push({ plot: i, species: species[(i * 5) % species.length], name: `Demo ${i}`, stage, health: i % 11 === 0 ? "poorly" : "thriving", bloom: stage === "bloom" ? 3 : 0, generation: 1 });
  }
  return { ...snapshot, count: plots.length, plots };
}

function absorb(fresh: MeadowSnapshot) {
  const snapshot = withDemoPlants(fresh);
  const first = data.snapshot === null;
  const byPlot = new Map<number, MeadowPlot>();
  let highest = -1;
  let changed = first || snapshot.plots.length !== data.byPlot.size;
  const appeared = new Map(data.appeared);
  const now = performance.now();
  for (const p of snapshot.plots) {
    byPlot.set(p.plot, p);
    highest = Math.max(highest, p.plot);
    const before = data.byPlot.get(p.plot);
    if (!before) {
      changed = true;
      if (!first) appeared.set(p.plot, now);
    } else if (!samePlot(before, p)) changed = true;
  }
  // a burst is only news for a few seconds
  for (const [plot, at] of appeared) if (now - at > 20_000) appeared.delete(plot);
  set({ status: "ready", snapshot, byPlot, highest, appeared, version: changed ? data.version + 1 : data.version });
}

let etag: string | null = null;
let timer: number | null = null;
let failures = 0;
let lastPoll = 0;
let running = 0;
let inFlight: Promise<void> | null = null;

async function poll(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    lastPoll = Date.now();
    try {
      const res = await fetch("/api/meadow", {
        cache: "no-store",
        headers: etag ? { "If-None-Match": etag } : {},
      });
      if (res.status === 304) {
        failures = 0;
        if (data.status !== "ready") set({ status: "ready" });
        return;
      }
      if (!res.ok) throw new Error(`meadow ${res.status}`);
      const body = (await res.json()) as MeadowSnapshot;
      etag = res.headers.get("ETag");
      failures = 0;
      absorb(body);
    } catch {
      failures++;
      if (data.snapshot === null) set({ status: "error" });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function schedule() {
  if (timer !== null) window.clearTimeout(timer);
  if (running === 0 || document.hidden) {
    timer = null;
    return;
  }
  const wait = failures > 0 ? BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] : POLL_MS;
  timer = window.setTimeout(async () => {
    await poll();
    schedule();
  }, wait);
}

function onVisibility() {
  if (document.hidden) {
    schedule();
    return;
  }
  // back on screen: catch up at once if the last look is a while ago
  if (Date.now() - lastPoll > POLL_MS / 2) void poll().then(schedule);
  else schedule();
}

/** Starts polling (counted, so two users share one poll); returns the stop function. */
export function startPolling(): () => void {
  running++;
  if (running === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    void poll().then(schedule);
  }
  return () => {
    running = Math.max(0, running - 1);
    if (running === 0) {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    }
  };
}

/** Asks for a fresh snapshot now (after a sprinkle, say). */
export function pollNow(): void {
  void poll();
}

// ---- who is here -------------------------------------------------------------------------------------------------

export interface Me {
  signedIn: boolean;
  firstName: string | null;
  plot: number | null;
}

let me: Me | null = null;
const meListeners = new Set<() => void>();

export const session = {
  get: () => me,
  subscribe(l: () => void) {
    meListeners.add(l);
    return () => {
      meListeners.delete(l);
    };
  },
};

export function useMe(): Me | null {
  return useSyncExternalStore(session.subscribe, () => me, () => null);
}

/** Reads which garden this device holds; a failure reads as signed out (the Meadow works without a garden). */
export async function loadSession(): Promise<Me> {
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    const body = (await res.json()) as { signedIn?: boolean; person?: { firstName: string; plot: number | null } | null };
    me = { signedIn: Boolean(body.signedIn && body.person), firstName: body.person?.firstName ?? null, plot: body.person?.plot ?? null };
  } catch {
    me = { signedIn: false, firstName: null, plot: null };
  }
  meListeners.forEach((l) => l());
  return me;
}

// ---- a friend's plant ----------------------------------------------------------------------------------------------

export type Loaded<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const FRIEND_FRESH_MS = 60_000;
const friends = new Map<number, { at: number; etag: string | null; value: FriendGarden }>();
const friendRequests = new Map<number, Promise<Loaded<FriendGarden>>>();

/** A friend's plant, from a minute-fresh cache or the server; never throws. */
export function loadFriend(plot: number): Promise<Loaded<FriendGarden>> {
  const cached = friends.get(plot);
  if (cached && Date.now() - cached.at < FRIEND_FRESH_MS) return Promise.resolve({ ok: true, value: cached.value });
  const pending = friendRequests.get(plot);
  if (pending) return pending;
  const run = (async (): Promise<Loaded<FriendGarden>> => {
    try {
      const res = await fetch(`/api/garden/${plot}`, {
        cache: "no-store",
        headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
      });
      if (res.status === 304 && cached) {
        friends.set(plot, { ...cached, at: Date.now() });
        return { ok: true, value: cached.value };
      }
      const body = (await res.json()) as FriendGarden & { error?: string; message?: string };
      if (!res.ok) return { ok: false, code: body.error ?? "unavailable", message: body.message ?? "This flower is resting for a moment." };
      friends.set(plot, { at: Date.now(), etag: res.headers.get("ETag"), value: body });
      return { ok: true, value: body };
    } catch {
      return { ok: false, code: "offline", message: "This flower could not be reached just now. Please try again in a moment." };
    } finally {
      friendRequests.delete(plot);
    }
  })();
  friendRequests.set(plot, run);
  return run;
}

/** The cached friend's plant, if one is at hand (for drawing without waiting). */
export function cachedFriend(plot: number): FriendGarden | null {
  return friends.get(plot)?.value ?? null;
}

// ---- sprinkles ---------------------------------------------------------------------------------------------------

/** crypto.randomUUID where the page is a secure context, else the same shape from getRandomValues. */
export function newClientEventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export type SprinkleOutcome =
  | { ok: true; message: string; counts: boolean }
  | { ok: false; code: string; message: string };

/** Sends today's sprinkle to the plant in `plot` (see the header for the retry rules). */
export async function sendSprinkle(plot: number): Promise<SprinkleOutcome> {
  const body = JSON.stringify({ plot, clientEventId: newClientEventId() });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("/api/sprinkle", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; counts?: boolean };
      if (res.ok) return { ok: true, message: json.message ?? "Your sprinkle landed.", counts: json.counts !== false };
      const code = json.error ?? "unavailable";
      const retryable = res.status === 503 && (code === "busy" || code === "unavailable");
      if (!retryable || attempt === 3) return { ok: false, code, message: json.message ?? "The sprinkle could not be sent just now." };
      const after = Number(res.headers.get("Retry-After"));
      await sleep((Number.isFinite(after) && after > 0 ? after * 1000 : 4000) + Math.random() * 1500);
    } catch {
      if (attempt === 3) return { ok: false, code: "offline", message: "The sprinkle could not reach the garden. Please try again in a moment." };
      await sleep(2500 + Math.random() * 1500);
    }
  }
  return { ok: false, code: "unavailable", message: "The sprinkle could not be sent just now." };
}

// The sprinkle a person has already shared today, remembered on this device as a convenience only (the server is
// the judge): keyed by the IST date, so it resets at midnight in Bangalore.
const SPRINKLE_KEY = "meadow-sprinkled:v1";

export function istToday(at = Date.now()): string {
  return new Date(at + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function sprinkledToday(): boolean {
  try {
    return window.localStorage.getItem(SPRINKLE_KEY) === istToday();
  } catch {
    return false;
  }
}

export function rememberSprinkle(): void {
  try {
    window.localStorage.setItem(SPRINKLE_KEY, istToday());
  } catch {
    // storage blocked: the server still says no to a second one, kindly
  }
}
