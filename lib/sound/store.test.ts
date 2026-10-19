import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LAYERS, tile } from "@/lib/sound/catalog";
import { mixTitle, sameMixdown, shownStatus, sleepFadeS, toggleLayer } from "@/lib/sound/store";
import type { EngineStatus, LiveInput, Mixdown } from "@/lib/sound/types";

// The store's world, faked: no Web Audio in node (a context that only counts its suspends, and is made again when the
// store resets it), an engine that records what it is asked, and a scene feed that reports whatever input the test sets.
const audio = vi.hoisted(() => ({
  unlocks: 0,
  available: true,
  resets: 0,
  suspends: 0,
  ctx: null as null | { suspend(): Promise<void> },
}));
vi.mock("@/lib/sound/context", () => ({
  unlockAudio: () => {
    audio.unlocks++;
    if (!audio.available) return null;
    audio.ctx ??= {
      suspend() {
        audio.suspends++;
        return Promise.resolve();
      },
    };
    return audio.ctx as unknown as AudioContext;
  },
  audioContext: () => audio.ctx as unknown as AudioContext | null,
  resetAudio: () => {
    audio.resets++;
    audio.ctx = null;
  },
}));

type FakeEngine = ReturnType<typeof makeEngine>;
const world = vi.hoisted(() => ({
  engine: null as unknown,
  input: null as unknown,
  feeds: 0,
  report: null as null | (() => void),
}));
vi.mock("@/lib/sound/engine", () => ({ getEngine: () => world.engine }));
vi.mock("@/lib/sound/scene", () => ({
  startLiveFeed: (onInput: (input: LiveInput) => void) => {
    world.feeds++;
    world.report = () => onInput(world.input as LiveInput);
    world.report();
    return () => {
      world.feeds--;
      world.report = null;
    };
  },
}));

function makeEngine() {
  const listeners = new Set<() => void>();
  let status: EngineStatus = "idle";
  const emit = () => listeners.forEach((l) => l());
  const e = {
    sets: [] as Mixdown[],
    volume: -1,
    background: null as boolean | null,
    sleeps: [] as [number | null, number | undefined][],
    stops: 0,
    resumes: 0,
    titles: [] as string[],
    failedKeys: [] as string[],
    set(m: Mixdown) {
      e.sets.push(m);
      if (status === "idle") {
        status = "playing";
        emit();
      }
    },
    setVolume(v: number) {
      e.volume = v;
    },
    sleepAt(at: number | null, fadeS?: number) {
      e.sleeps.push([at, fadeS]);
    },
    setBackground(keep: boolean) {
      e.background = keep;
    },
    stop() {
      e.stops++;
      status = "idle";
      emit();
    },
    resume() {
      e.resumes++;
    },
    setNowPlaying(title: string) {
      e.titles.push(title);
    },
    status: () => status,
    loading: () => [] as string[],
    failed: () => e.failedKeys,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** what the real engine does at a timer's end, or when the page hides */
    report(next: EngineStatus) {
      status = next;
      emit();
    },
    /** files the real engine could not load */
    fail(keys: string[]) {
      e.failedKeys = keys;
      emit();
    },
  };
  return e;
}

const NIGHT: LiveInput = { hour: 23, sunAltitudeDeg: -60, rain: 0, wet: 0, wind: 0.2, lotus: false, deer: false };
const DAWN: LiveInput = { hour: 6.2, sunAltitudeDeg: 1, rain: 0, wet: 0, wind: 0.5, lotus: false, deer: false };

/** A localStorage for the store to remember into, and the window around it. */
function stubStorage(initial?: object) {
  const kept = new Map<string, string>();
  if (initial) kept.set("garden-sound:v1", JSON.stringify(initial));
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) },
    addEventListener: () => {},
  });
  return () => JSON.parse(kept.get("garden-sound:v1") ?? "null") as Record<string, unknown> | null;
}

describe("a tile tapped in a mix", () => {
  const at = (...keys: string[]) => keys.map((key) => ({ key, level: tile(key)!.level }));

  it("comes in at its own level", () => {
    expect(toggleLayer([], "rain-light")).toEqual({ layers: [{ key: "rain-light", level: 0.6 }], refused: false });
  });

  it("goes out if it is in", () => {
    expect(toggleLayer(at("rain-light", "water-stream"), "rain-light").layers).toEqual(at("water-stream"));
  });

  it("takes the place of the music playing, since two pieces at once would clash", () => {
    const result = toggleLayer(at("music-piano", "rain-light"), "music-veena");
    expect(result.layers.map((l) => l.key)).toEqual(["music-veena", "rain-light"]);
    expect(result.refused).toBe(false);
  });

  it("is refused as a sixth, leaving the mix as it was", () => {
    const five = at("rain-light", "rain-roof", "water-stream", "birds-blr", "night-fire");
    expect(five).toHaveLength(MAX_LAYERS);
    expect(toggleLayer(five, "tone-bowl")).toEqual({ layers: five, refused: true });
  });

  it("may still swap the music in a full mix, which does not grow", () => {
    const five = at("rain-light", "rain-roof", "water-stream", "birds-blr", "music-pad");
    const result = toggleLayer(five, "music-box");
    expect(result.refused).toBe(false);
    expect(result.layers.map((l) => l.key)).toEqual(["rain-light", "rain-roof", "water-stream", "birds-blr", "music-box"]);
  });

  it("is ignored if there is no such tile", () => {
    expect(toggleLayer(at("rain-light"), "rain-of-frogs")).toEqual({ layers: at("rain-light"), refused: false });
  });
});

describe("the store's small rules", () => {
  it("names a mix by the ready-made mix, its one tile, or how many sounds", () => {
    expect(mixTitle([{ key: "rain-monsoon", level: 0.5 }], "monsoon-evening")).toBe("Monsoon evening");
    expect(mixTitle([{ key: "night-fire", level: 0.5 }], null)).toBe("Campfire");
    expect(mixTitle([{ key: "night-fire", level: 0.5 }, { key: "water-sea", level: 0.5 }, { key: "tone-bowl", level: 0.2 }], null)).toBe("3 sounds");
    expect(mixTitle([], null)).toBe("");
    expect(mixTitle([{ key: "night-fire", level: 0.5 }], "no-such-mix")).toBe("Campfire");
  });

  it("shows the person's wish first: stopped is idle at once, asked for and still loading is starting", () => {
    expect(shownStatus(false, "playing")).toBe("idle");
    expect(shownStatus(true, "idle")).toBe("starting");
    expect(shownStatus(true, "playing")).toBe("playing");
    expect(shownStatus(true, "blocked")).toBe("blocked");
    expect(shownStatus(true, "paused")).toBe("paused");
  });

  it("hears two mixdowns as the same when nothing in them differs to the ear", () => {
    const a: Mixdown = { layers: [{ key: "night-crickets", level: 0.4 }], shots: null, tauS: 8 };
    expect(sameMixdown(a, { ...a, tauS: 1 })).toBe(true);
    expect(sameMixdown(a, { ...a, layers: [{ key: "night-crickets", level: 0.4005 }] })).toBe(true);
    expect(sameMixdown(a, { ...a, layers: [{ key: "night-crickets", level: 0.41 }] })).toBe(false);
    expect(sameMixdown(a, { ...a, layers: [{ key: "night-frogs", level: 0.4 }] })).toBe(false);
    const calls = { sounds: ["call-koel"], perMinute: 2, level: 0.3 };
    expect(sameMixdown({ ...a, shots: calls }, { ...a, shots: { ...calls } })).toBe(true);
    expect(sameMixdown({ ...a, shots: calls }, a)).toBe(false);
    expect(sameMixdown({ ...a, shots: calls }, { ...a, shots: { ...calls, perMinute: 1 } })).toBe(false);
  });

  it("fades the last fifth of a timer, three minutes at most", () => {
    expect(sleepFadeS(15)).toBe(180);
    expect(sleepFadeS(60)).toBe(180);
    expect(sleepFadeS(5)).toBe(60);
  });
});

describe("the sound store", () => {
  let store: typeof import("@/lib/sound/store");
  let engine: FakeEngine;
  const load = async () => {
    await vi.dynamicImportSettled();
    await Promise.resolve();
  };

  beforeEach(async () => {
    vi.resetModules();
    audio.unlocks = 0;
    audio.available = true;
    audio.resets = 0;
    audio.suspends = 0;
    audio.ctx = null;
    engine = makeEngine();
    world.engine = engine;
    world.input = NIGHT;
    world.feeds = 0;
    store = await import("@/lib/sound/store");
  });

  afterEach(async () => {
    // a load still on its way must not start this store's sound during the next test
    store.soundActions.stop();
    await vi.dynamicImportSettled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts silent, on the live garden, with nothing to resume", () => {
    const s = store.sound.get();
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("live");
    expect(s.resumeHint).toBe(false);
    expect(s.nowPlaying).toBe("");
    expect(engine.sets).toHaveLength(0);
  });

  it("wakes the audio first thing in a tap, before anything is loaded", () => {
    store.soundActions.toggle();
    expect(audio.unlocks).toBe(1);
    expect(store.sound.get().status).toBe("starting");
    expect(store.sound.get().nowPlaying).toBe("Live garden");
  });

  it("plays the live garden from the scene, easing in quickly at first and then following the sky", async () => {
    store.soundActions.start();
    await load();
    expect(world.feeds).toBe(1);
    expect(engine.sets).toHaveLength(1);
    expect(engine.sets[0].tauS).toBeCloseTo(1.2);
    expect(engine.sets[0].layers.map((l) => l.key)).toContain("night-crickets");
    expect(store.sound.get().status).toBe("playing");
    expect(store.sound.get().nowPlaying).toBe("Live garden: crickets");
    expect(engine.titles.at(-1)).toBe("Live garden: crickets");
    expect(engine.volume).toBe(0.8);
    expect(engine.background).toBe(false);
    // the same sky again sends nothing new; a new sky eases in slowly
    world.report!();
    expect(engine.sets).toHaveLength(1);
    world.input = DAWN;
    world.report!();
    expect(engine.sets).toHaveLength(2);
    expect(engine.sets[1].tauS).toBe(8);
    expect(store.sound.get().nowPlaying).toBe("Live garden: dawn birds and a light breeze");
  });

  it("hands a tapped tile to the loaded engine inside the same tap", async () => {
    store.soundActions.start();
    await load();
    store.soundActions.toggleTile("music-piano");
    // no await: the music starts within the tap
    expect(engine.sets.at(-1)!.layers).toEqual([{ key: "music-piano", level: 0.5 }]);
    expect(store.sound.get().mode).toBe("mix");
    expect(store.sound.get().nowPlaying).toBe("Soft piano");
    expect(world.feeds).toBe(0);
    expect(audio.unlocks).toBe(2);
  });

  it("refuses a sixth sound with a notice that clears itself after about four seconds", () => {
    vi.useFakeTimers();
    for (const key of ["rain-light", "rain-roof", "water-stream", "birds-blr", "night-fire"]) store.soundActions.toggleTile(key);
    expect(store.sound.get().layers).toHaveLength(5);
    store.soundActions.toggleTile("tone-bowl");
    expect(store.sound.get().layers).toHaveLength(5);
    expect(store.sound.get().notice).toBe("Five sounds at once is the most. Remove one first.");
    vi.advanceTimersByTime(4000);
    expect(store.sound.get().notice).toBeNull();
  });

  it("lets a tapped piece of music replace the one playing", () => {
    store.soundActions.toggleTile("music-piano");
    store.soundActions.toggleTile("rain-light");
    store.soundActions.toggleTile("music-kalimba");
    expect(store.sound.get().layers.map((l) => l.key)).toEqual(["music-kalimba", "rain-light"]);
  });

  it("stops the sound when the last tile is taken out, staying with the person's own mix", async () => {
    store.soundActions.toggleTile("rain-light");
    await load();
    expect(store.sound.get().status).toBe("playing");
    store.soundActions.toggleTile("rain-light");
    const s = store.sound.get();
    expect(s.status).toBe("idle");
    expect(s.mode).toBe("mix");
    expect(s.layers).toEqual([]);
    expect(s.nowPlaying).toBe("");
    expect(engine.stops).toBe(1);
  });

  it("plays a ready-made mix under its name, and forgets the name once a level moves", async () => {
    store.soundActions.applyMix("monsoon-evening");
    await load();
    expect(store.sound.get().mixId).toBe("monsoon-evening");
    expect(store.sound.get().nowPlaying).toBe("Monsoon evening");
    store.soundActions.setLevel("rain-monsoon", 0.3);
    expect(store.sound.get().mixId).toBeNull();
    expect(store.sound.get().nowPlaying).toBe("3 sounds");
    expect(engine.sets.at(-1)!.tauS).toBe(0.15);
    expect(engine.sets.at(-1)!.layers.find((l) => l.key === "rain-monsoon")!.level).toBe(0.3);
  });

  it("goes back to the live garden from a mix, easing across quickly", async () => {
    store.soundActions.applyMix("by-the-sea");
    await load();
    store.soundActions.chooseLive();
    await load();
    expect(store.sound.get().mode).toBe("live");
    expect(store.sound.get().mixId).toBeNull();
    expect(engine.sets.at(-1)!.tauS).toBeCloseTo(1.2);
    expect(store.sound.get().nowPlaying).toBe("Live garden: crickets");
  });

  it("stays silent if the person stops before the engine has loaded", async () => {
    store.soundActions.start();
    store.soundActions.stop();
    await load();
    expect(engine.sets).toHaveLength(0);
    expect(store.sound.get().status).toBe("idle");
  });

  it("says so, and stays silent, where the browser has no Web Audio", () => {
    audio.available = false;
    store.soundActions.start();
    expect(store.sound.get().status).toBe("idle");
    expect(store.sound.get().notice).toBe(store.NO_AUDIO_NOTICE);
  });

  it("asks the engine to fade out at the timer's end, then clears the timer when the engine stops", async () => {
    store.soundActions.start();
    await load();
    vi.useFakeTimers({ now: Date.parse("2026-11-10T22:00:00+05:30") });
    store.soundActions.setTimer(15);
    const at = store.sound.get().timerEndsAt!;
    expect(at).toBe(Date.now() + 15 * 60_000);
    expect(engine.sleeps.at(-1)).toEqual([at, 180]);
    vi.setSystemTime(at);
    engine.report("idle");
    const s = store.sound.get();
    expect(s.status).toBe("idle");
    expect(s.timerMin).toBe(0);
    expect(s.timerEndsAt).toBeNull();
    expect(s.nowPlaying).toBe("");
  });

  it("still ends the sound at the timer if the engine misses its end", async () => {
    store.soundActions.start();
    await load();
    vi.useFakeTimers();
    store.soundActions.setTimer(30);
    vi.advanceTimersByTime(30 * 60_000 + 5_000);
    expect(store.sound.get().status).toBe("idle");
    expect(store.sound.get().timerMin).toBe(0);
    expect(engine.stops).toBeGreaterThan(0);
  });

  it("starts a chosen timer with the sound, and cancels it with 0", async () => {
    store.soundActions.setTimer(60);
    expect(store.sound.get().timerEndsAt).toBeNull();
    store.soundActions.start();
    await load();
    expect(store.sound.get().timerEndsAt).not.toBeNull();
    store.soundActions.setTimer(0);
    expect(store.sound.get().timerEndsAt).toBeNull();
    expect(engine.sleeps.at(-1)).toEqual([null, undefined]);
  });

  it("passes the volume and keep-playing to the engine", async () => {
    store.soundActions.start();
    await load();
    store.soundActions.setVolume(0.3);
    store.soundActions.setBackground(true);
    expect(engine.volume).toBe(0.3);
    expect(engine.background).toBe(true);
    store.soundActions.setVolume(7);
    expect(store.sound.get().volume).toBe(1);
  });

  it("tries to bring blocked sound back on a tap", async () => {
    store.soundActions.start();
    await load();
    engine.report("blocked");
    expect(store.sound.get().status).toBe("blocked");
    store.soundActions.resume();
    expect(engine.resumes).toBe(1);
  });

  it("follows a pause from the phone's lock screen", async () => {
    store.soundActions.start();
    await load();
    engine.report("idle");
    const s = store.sound.get();
    expect(s.status).toBe("idle");
    expect(s.nowPlaying).toBe("");
    expect(engine.stops).toBe(0);
    expect(world.feeds).toBe(0);
  });

  it("follows a play from the phone's lock screen", async () => {
    store.soundActions.start();
    await load();
    store.soundActions.stop();
    const sent = engine.sets.length;
    engine.report("playing");
    await Promise.resolve();
    expect(store.sound.get().status).toBe("playing");
    expect(store.sound.get().nowPlaying).toBe("Live garden: crickets");
    expect(engine.sets.length).toBeGreaterThan(sent);
    expect(world.feeds).toBe(1);
  });

  it("opens and closes the panel", () => {
    store.soundActions.openPanel();
    expect(store.sound.get().panelOpen).toBe(true);
    store.soundActions.togglePanel();
    expect(store.sound.get().panelOpen).toBe(false);
  });

  it("hands a timer chosen while the engine was loading to the engine once it has loaded", async () => {
    store.soundActions.start();
    store.soundActions.setTimer(15);
    const at = store.sound.get().timerEndsAt;
    expect(at).not.toBeNull();
    expect(engine.sleeps).toHaveLength(0);
    await load();
    expect(engine.sleeps.at(-1)).toEqual([at, 180]);
  });

  it("plays once, as last asked, after a start, a stop and a start before the engine has loaded", async () => {
    store.soundActions.start();
    store.soundActions.stop();
    store.soundActions.start();
    await load();
    expect(engine.sets).toHaveLength(1);
    expect(store.sound.get().status).toBe("playing");
    expect(world.feeds).toBe(1);
  });

  it("hands a tile picked before the engine has loaded to the engine once it has", async () => {
    store.soundActions.toggleTile("rain-light");
    expect(engine.sets).toHaveLength(0);
    await load();
    expect(engine.sets.at(-1)!.layers).toEqual([{ key: "rain-light", level: 0.6 }]);
    expect(world.feeds).toBe(0);
  });

  it("plays a ready-made mix picked before the engine has loaded", async () => {
    store.soundActions.applyMix("deep-focus");
    await load();
    expect(engine.sets.at(-1)!.layers.map((l) => l.key)).toEqual(["noise-brown", "rain-light"]);
    expect(store.sound.get().nowPlaying).toBe("Deep focus");
  });

  it("waits for the engine when resume is tapped while it is still loading", async () => {
    store.soundActions.start();
    store.soundActions.resume();
    await load();
    expect(engine.sets).toHaveLength(1);
    expect(engine.resumes).toBe(0);
    expect(store.sound.get().status).toBe("playing");
  });

  it("goes back to the live garden when the lock screen plays after the last tile was taken out", async () => {
    store.soundActions.toggleTile("night-fire");
    await load();
    store.soundActions.toggleTile("night-fire");
    expect(store.sound.get().layers).toEqual([]);
    engine.report("playing");
    await Promise.resolve();
    await load();
    const s = store.sound.get();
    expect(s.status).toBe("playing");
    expect(s.mode).toBe("live");
    expect(s.nowPlaying).toBe("Live garden: crickets");
    expect(engine.sets.at(-1)!.layers.map((l) => l.key)).toContain("night-crickets");
  });

  it("rests the live feed while the engine is paused, and looks again at once when it comes back", async () => {
    store.soundActions.start();
    await load();
    expect(world.feeds).toBe(1);
    engine.report("paused");
    expect(world.feeds).toBe(0);
    expect(store.sound.get().status).toBe("paused");
    world.input = DAWN;
    engine.report("playing");
    await Promise.resolve();
    expect(world.feeds).toBe(1);
    expect(engine.sets.at(-1)!.tauS).toBeCloseTo(1.2);
    expect(engine.sets.at(-1)!.layers.map((l) => l.key)).toContain("birds-blr");
  });

  it("keeps the live feed going while hidden when the person asked to keep playing", async () => {
    store.soundActions.start();
    await load();
    store.soundActions.setBackground(true);
    engine.report("paused");
    expect(world.feeds).toBe(1);
  });

  it("says once when a sound could not load", async () => {
    store.soundActions.start();
    await load();
    vi.useFakeTimers();
    engine.fail(["night-crickets"]);
    expect(store.sound.get().notice).toBe(store.LOAD_NOTICE);
    vi.advanceTimersByTime(4000);
    engine.fail(["night-crickets"]);
    expect(store.sound.get().notice).toBeNull();
  });

  it("lets the audio context rest when sound stops before the engine has loaded", async () => {
    store.soundActions.start();
    store.soundActions.stop();
    expect(audio.suspends).toBe(1);
    await load();
    expect(engine.sets).toHaveLength(0);
  });

  it("makes a fresh audio context when a second tap cannot bring blocked sound back", async () => {
    store.soundActions.start();
    await load();
    engine.report("blocked");
    store.soundActions.resume();
    expect(audio.resets).toBe(0);
    expect(engine.resumes).toBe(1);
    // still blocked: the context will not wake, so the next tap makes another, in the same tap
    store.soundActions.resume();
    expect(audio.resets).toBe(1);
    expect(audio.ctx).not.toBeNull();
    expect(engine.resumes).toBe(2);
  });

  it("keeps the audio context when the sound is blocked for want of its files", async () => {
    store.soundActions.start();
    await load();
    engine.failedKeys = ["night-crickets", "wind-leaves"];
    engine.report("blocked");
    store.soundActions.resume();
    store.soundActions.resume();
    expect(audio.resets).toBe(0);
    expect(engine.resumes).toBe(2);
  });

  it("only lets the engine go when stopped while already off", async () => {
    store.soundActions.start();
    await load();
    store.soundActions.stop();
    expect(engine.stops).toBe(1);
    store.soundActions.stop();
    expect(engine.stops).toBe(2);
    expect(store.sound.get().status).toBe("idle");
  });
});

describe("what the sound store remembers", () => {
  let engine: FakeEngine;
  let store: typeof import("@/lib/sound/store") | null = null;
  /** a fresh store, reading what `stubStorage` put in place */
  const open = async () => (store = await import("@/lib/sound/store"));

  beforeEach(() => {
    vi.resetModules();
    audio.available = true;
    engine = makeEngine();
    world.engine = engine;
    world.input = NIGHT;
  });

  afterEach(async () => {
    store?.soundActions.stop();
    store = null;
    await vi.dynamicImportSettled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers to resume sound that was on, without playing it", async () => {
    stubStorage({ mode: "mix", layers: [{ key: "night-fire", level: 0.4 }], wasOn: true, volume: 0.5 });
    const store = await open();
    const s = store.sound.get();
    expect(s.resumeHint).toBe(true);
    expect(s.mode).toBe("mix");
    expect(s.volume).toBe(0.5);
    expect(s.status).toBe("idle");
    expect(engine.sets).toHaveLength(0);
    store.soundActions.resume();
    await vi.dynamicImportSettled();
    expect(store.sound.get().resumeHint).toBe(false);
    expect(engine.sets.at(-1)!.layers).toEqual([{ key: "night-fire", level: 0.4 }]);
    expect(engine.volume).toBe(0.5);
  });

  it("keeps the offer when the sound button leaves the page while sound is off", async () => {
    const stored = stubStorage({ wasOn: true });
    const store = await open();
    store.soundActions.stop();
    expect(store.sound.get().resumeHint).toBe(true);
    expect(stored()!.wasOn).toBe(true);
  });

  it("forgets the offer when the person says not now", async () => {
    const stored = stubStorage({ wasOn: true });
    const store = await open();
    store.soundActions.dismissResumeHint();
    expect(store.sound.get().resumeHint).toBe(false);
    expect(stored()!.wasOn).toBe(false);
  });

  it("remembers that sound is on, and that it was stopped", async () => {
    const stored = stubStorage();
    const store = await open();
    store.soundActions.applyMix("sleepy-night");
    expect(stored()).toMatchObject({ mode: "mix", mixId: "sleepy-night", wasOn: true });
    store.soundActions.stop();
    expect(stored()!.wasOn).toBe(false);
  });

  it("does not ask a sleeper to resume after the timer has ended the sound", async () => {
    const stored = stubStorage();
    const store = await open();
    store.soundActions.start();
    await vi.dynamicImportSettled();
    vi.useFakeTimers();
    store.soundActions.setTimer(15);
    expect(stored()!.timerMin).toBe(15);
    vi.setSystemTime(store.sound.get().timerEndsAt!);
    engine.report("idle");
    expect(stored()).toMatchObject({ wasOn: false, timerMin: 0 });
  });

  it("keeps a slider's value once it settles", async () => {
    const stored = stubStorage();
    const store = await open();
    vi.useFakeTimers();
    store.soundActions.setVolume(0.42);
    vi.advanceTimersByTime(1000);
    expect(stored()!.volume).toBe(0.42);
  });
});
