import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shots } from "@/lib/sound/engine-layers";
import type { Loader } from "@/lib/sound/engine-loader";
import { soundFile } from "@/lib/sound/library";
import type { Engine, Mixdown, ShotPlan } from "@/lib/sound/types";

// ---- a small Web Audio, faked for node --------------------------------------------------------------------------------
// Enough of an AudioContext for the engine to build its graph and play: every node remembers what it is connected to,
// every AudioParam records what it was asked and holds the value it was last sent towards, sources record when they
// were started and stopped, and the context's clock moves only when a test moves it. An <audio> element plays (or is
// refused) as the test says, and fires "pause" a moment after it pauses, as a browser does.

interface ParamEvent {
  type: "set" | "ramp" | "target" | "curve" | "cancel" | "hold";
  v?: number;
  t: number;
  tau?: number;
}

class FakeParam {
  readonly events: ParamEvent[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) {
    this.events.push({ type: "set", v, t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: "ramp", v, t });
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: "ramp", v, t });
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.events.push({ type: "target", v, t, tau });
    this.value = v;
    return this;
  }
  setValueCurveAtTime(curve: ArrayLike<number>, t: number) {
    this.events.push({ type: "curve", v: curve[curve.length - 1], t });
    this.value = curve[curve.length - 1];
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push({ type: "cancel", t });
    return this;
  }
  cancelAndHoldAtTime(t: number) {
    this.events.push({ type: "hold", t });
    return this;
  }
}

class FakeNode {
  readonly outs = new Set<FakeNode>();
  constructor(readonly kind: string) {}
  connect<T>(dest: T): T {
    this.outs.add(dest as unknown as FakeNode);
    return dest;
  }
  disconnect(dest?: unknown) {
    if (dest) this.outs.delete(dest as FakeNode);
    else this.outs.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeScheduled extends FakeNode {
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(at = 0) {
    this.startedAt = at;
  }
  stop(at = 0) {
    this.stoppedAt = at;
  }
}

interface FakeBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

function fakeBuffer(channels: number, length: number, sampleRate: number, data = true): FakeBuffer {
  const channelData = Array.from({ length: channels }, () => new Float32Array(data ? length : 0));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => channelData[c] };
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state = "running";
  readonly destination = new FakeNode("destination");
  readonly made: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  private readonly listeners = new Set<() => void>();

  private make<T extends FakeNode>(node: T): T {
    this.made.push(node);
    return node;
  }
  count(kind: string): number {
    return this.made.filter((n) => n.kind === kind).length;
  }
  createGain() {
    return this.make(new FakeGain("gain"));
  }
  createDynamicsCompressor() {
    return this.make(
      Object.assign(new FakeNode("compressor"), {
        threshold: new FakeParam(0),
        knee: new FakeParam(0),
        ratio: new FakeParam(1),
        attack: new FakeParam(0),
        release: new FakeParam(0),
      }),
    );
  }
  createStereoPanner() {
    return this.make(Object.assign(new FakeNode("panner"), { pan: new FakeParam(0) }));
  }
  createBiquadFilter() {
    return this.make(Object.assign(new FakeNode("filter"), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1) }));
  }
  createConvolver() {
    return this.make(Object.assign(new FakeNode("convolver"), { buffer: null as FakeBuffer | null }));
  }
  createBufferSource() {
    return this.make(Object.assign(new FakeScheduled("source"), { buffer: null as FakeBuffer | null, playbackRate: new FakeParam(1) }));
  }
  createOscillator() {
    return this.make(Object.assign(new FakeScheduled("oscillator"), { type: "sine", frequency: new FakeParam(440), detune: new FakeParam(0) }));
  }
  createConstantSource() {
    return this.make(Object.assign(new FakeScheduled("constant"), { offset: new FakeParam(1) }));
  }
  createMediaElementSource(el: FakeAudio) {
    return this.make(Object.assign(new FakeNode("media"), { mediaElement: el }));
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const buffer = fakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }
  decodeAudioData(): Promise<FakeBuffer> {
    // a 50 s mono bed, without its samples (nothing here listens to them)
    return Promise.resolve(fakeBuffer(1, 48000 * 50, 48000, false));
  }
  addEventListener(_type: string, listener: () => void) {
    this.listeners.add(listener);
  }
  private moveTo(state: string) {
    if (this.state === state) return;
    this.state = state;
    queueMicrotask(() => this.listeners.forEach((l) => l()));
  }
  resume() {
    this.moveTo("running");
    return Promise.resolve();
  }
  suspend() {
    this.moveTo("suspended");
    return Promise.resolve();
  }
  close() {
    this.moveTo("closed");
    return Promise.resolve();
  }
}

class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  /** play() is refused (as without a tap) while this is set */
  static refuse = false;
  preload = "";
  loop = false;
  paused = true;
  error: { code: number } | null = null;
  plays = 0;
  private readonly attrs = new Map<string, string>();
  constructor() {
    super();
    FakeAudio.all.push(this);
  }
  set src(url: string) {
    this.attrs.set("src", url);
    this.error = null;
  }
  get src() {
    return this.attrs.get("src") ?? "";
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  load() {}
  play(): Promise<void> {
    this.plays++;
    if (FakeAudio.refuse) return Promise.reject(new DOMException("needs a tap", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event("pause")));
  }
  /** what a phone does when the headphones come out */
  pausedByPhone() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

// ---- the world the engine lives in --------------------------------------------------------------------------------------

const world = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/sound/context", () => ({ audioContext: () => world.ctx }));

interface Download {
  url: string;
  arrive(): void;
  fail(): void;
}
let downloads: Download[];

const urlOf = (key: string) => soundFile(key)!.url;
const fetchesOf = (key: string) => downloads.filter((d) => d.url === urlOf(key));
/** Lets every download of a file still waiting arrive (or fail). */
const arrive = (key: string) => fetchesOf(key).forEach((d) => d.arrive());
const fail = (key: string) => fetchesOf(key).forEach((d) => d.fail());

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const mixOf = (layers: Record<string, number>, tauS = 0.8): Mixdown => ({
  layers: Object.entries(layers).map(([key, level]) => ({ key, level })),
  shots: null,
  tauS,
});

type TestEngine = Engine & { describe(): { key: string; level: number; kind: string; state: string }[] };

let ctx: FakeContext;
let engine: TestEngine;

/** The master gain: the gain that feeds the sleep gain, which feeds the compressor. */
function master(): FakeGain {
  const compressor = ctx.made.find((n) => n.kind === "compressor")!;
  const sleep = ctx.made.find((n) => n instanceof FakeGain && n.outs.has(compressor))!;
  return ctx.made.find((n) => n instanceof FakeGain && n.outs.has(sleep)) as FakeGain;
}

const state = (key: string) => engine.describe().find((l) => l.key === key)?.state ?? "none";

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  ctx = new FakeContext();
  world.ctx = ctx;
  downloads = [];
  FakeAudio.all = [];
  FakeAudio.refuse = false;
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", (url: string) => {
    return new Promise((resolve, reject) => {
      downloads.push({
        url,
        arrive: () => resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }),
        fail: () => reject(new Error(`${url}: offline`)),
      });
    });
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  engine = (await import("@/lib/sound/engine")).getEngine() as TestEngine;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- the tests ----------------------------------------------------------------------------------------------------------

describe("the engine's layers", () => {
  it("start loading, say so, and come in from silence once the file is there", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    expect(engine.status()).toBe("starting");
    expect(engine.loading()).toEqual(["rain-light"]);
    expect(state("rain-light")).toBe("loading");
    arrive("rain-light");
    await flush();
    expect(engine.status()).toBe("playing");
    expect(engine.loading()).toEqual([]);
    expect(state("rain-light")).toBe("playing");
    expect(ctx.made.some((n) => n instanceof FakeScheduled && n.kind === "source" && n.startedAt !== null)).toBe(true);
    expect(master().gain.value).toBe(1);
  });

  it("let a tile still loading go at once when the mix drops it, so it never starts later", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    engine.set(mixOf({}));
    expect(state("rain-light")).toBe("none");
    arrive("rain-light");
    await flush();
    expect(state("rain-light")).toBe("none");
    expect(ctx.count("source")).toBe(0);
  });

  it("fade a tile the mix drops, and bring it back if the mix lists it again before it has gone", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    arrive("rain-light");
    await flush();
    engine.set(mixOf({}));
    expect(state("rain-light")).toBe("leaving");
    engine.set(mixOf({ "rain-light": 0.4 }));
    expect(state("rain-light")).toBe("playing");
    expect(engine.describe()[0].level).toBe(0.4);
    vi.advanceTimersByTime(10_000);
    expect(state("rain-light")).toBe("playing");
  });

  it("let a tile go a few time constants after the mix drops it", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    arrive("rain-light");
    await flush();
    engine.set(mixOf({}, 0.8));
    vi.advanceTimersByTime(4100);
    expect(state("rain-light")).toBe("none");
  });

  it("come in at the level last asked for while the file was loading, at the speed asked for", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    engine.set(mixOf({ "rain-light": 0.3 }, 0.15));
    arrive("rain-light");
    await flush();
    const gains = ctx.made.filter((n): n is FakeGain => n instanceof FakeGain && n.outs.has(master()));
    expect(gains.some((g) => g.gain.events.some((e) => e.type === "target" && e.v === 0.3 && e.tau === 0.15))).toBe(true);
    expect(engine.describe()[0].level).toBe(0.3);
  });

  it("let every tile still loading go when sound stops", async () => {
    engine.set(mixOf({ "rain-light": 0.6, "water-stream": 0.5 }));
    engine.stop();
    expect(engine.status()).toBe("idle");
    expect(engine.describe()).toEqual([]);
    arrive("rain-light");
    arrive("water-stream");
    await flush();
    expect(ctx.count("source")).toBe(0);
  });
});

describe("files that will not load", () => {
  it("are reported, and with nothing else to play the engine asks for a tap rather than playing silence", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    fail("rain-light");
    await flush();
    expect(engine.failed()).toEqual(["rain-light"]);
    expect(engine.status()).toBe("blocked");
    // the tap: tried again at once
    engine.resume();
    expect(fetchesOf("rain-light")).toHaveLength(2);
    expect(engine.status()).toBe("starting");
    arrive("rain-light");
    await flush();
    expect(engine.status()).toBe("playing");
    expect(engine.failed()).toEqual([]);
  });

  it("still play the rest, and are reported, when only some fail", async () => {
    engine.set(mixOf({ "rain-light": 0.6, "water-stream": 0.5 }));
    fail("rain-light");
    arrive("water-stream");
    await flush();
    expect(engine.status()).toBe("playing");
    expect(engine.failed()).toEqual(["rain-light"]);
  });

  it("are not fetched again for every resend of the same mix, but are tried again by themselves a while later", async () => {
    engine.set(mixOf({ "night-crickets": 0.4 }, 8));
    fail("night-crickets");
    await flush();
    engine.set(mixOf({ "night-crickets": 0.41 }, 8));
    expect(fetchesOf("night-crickets")).toHaveLength(1);
    vi.advanceTimersByTime(30_100);
    expect(fetchesOf("night-crickets")).toHaveLength(2);
    arrive("night-crickets");
    await flush();
    expect(engine.status()).toBe("playing");
    expect(engine.failed()).toEqual([]);
  });

  it("stop trying by themselves after a few attempts", async () => {
    engine.set(mixOf({ "night-crickets": 0.4 }, 8));
    for (let i = 0; i < 8; i++) {
      fail("night-crickets");
      await flush();
      vi.advanceTimersByTime(30_100);
    }
    expect(fetchesOf("night-crickets")).toHaveLength(4);
    expect(engine.status()).toBe("blocked");
  });

  it("are tried again at once when the person picks them again", async () => {
    engine.set(mixOf({ "rain-light": 0.6, "water-stream": 0.5 }));
    fail("rain-light");
    arrive("water-stream");
    await flush();
    engine.set(mixOf({ "water-stream": 0.5 }));
    engine.set(mixOf({ "water-stream": 0.5, "rain-light": 0.6 }));
    expect(fetchesOf("rain-light")).toHaveLength(2);
  });
});

describe("music", () => {
  it("that the browser will not start without a tap asks for one, and starts from it", async () => {
    FakeAudio.refuse = true;
    engine.set(mixOf({ "music-piano": 0.5 }));
    await flush();
    expect(engine.status()).toBe("blocked");
    FakeAudio.refuse = false;
    engine.resume();
    await flush();
    expect(engine.status()).toBe("playing");
    expect(FakeAudio.all[0].paused).toBe(false);
  });

  it("paused by the phone (headphones out) hushes everything, and a tap brings it all back", async () => {
    engine.set(mixOf({ "music-piano": 0.5, "rain-roof": 0.5 }));
    arrive("rain-roof");
    await flush();
    expect(engine.status()).toBe("playing");
    FakeAudio.all[0].pausedByPhone();
    expect(engine.status()).toBe("blocked");
    expect(master().gain.value).toBe(0);
    // the volume waits while it is hushed
    engine.setVolume(0.5);
    expect(master().gain.value).toBe(0);
    engine.resume();
    await flush();
    expect(engine.status()).toBe("playing");
    expect(FakeAudio.all[0].paused).toBe(false);
    expect(master().gain.value).toBeCloseTo(0.25);
  });

  it("paused by the engine itself is not taken for the phone's doing", async () => {
    engine.set(mixOf({ "music-piano": 0.5, "rain-roof": 0.5 }));
    arrive("rain-roof");
    await flush();
    engine.set(mixOf({ "rain-roof": 0.5 }));
    vi.advanceTimersByTime(5000);
    await flush();
    expect(FakeAudio.all[0].paused).toBe(true);
    expect(engine.status()).toBe("playing");
  });

  it("whose stream fails part way is reported as a failure", async () => {
    engine.set(mixOf({ "music-veena": 0.5 }));
    await flush();
    expect(engine.status()).toBe("playing");
    const el = FakeAudio.all[0];
    el.error = { code: 2 };
    el.dispatchEvent(new Event("error"));
    expect(engine.failed()).toEqual(["music-veena"]);
    expect(engine.status()).toBe("blocked");
  });

  it("lets its element go when sound is turned off, and loads it afresh when the piece is picked again", async () => {
    engine.set(mixOf({ "music-piano": 0.5 }));
    await flush();
    engine.stop();
    vi.advanceTimersByTime(2000);
    const el = FakeAudio.all[0];
    expect(el.getAttribute("src")).toBeNull();
    engine.set(mixOf({ "music-piano": 0.5 }));
    await flush();
    expect(FakeAudio.all).toHaveLength(1);
    expect(el.getAttribute("src")).toBe(urlOf("music-piano"));
    expect(engine.status()).toBe("playing");
  });
});

describe("the music box's hall and the soft noise", () => {
  it("are made once per context, ahead of time while the page is idle", async () => {
    engine.set(mixOf({ "rain-light": 0.6 }));
    expect(ctx.count("convolver")).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(ctx.count("convolver")).toBe(1);
    expect(ctx.buffers.some((b) => b.sampleRate === 22050 && b.duration === 12)).toBe(true);
    engine.set(mixOf({ "music-box": 0.45 }));
    engine.set(mixOf({}));
    vi.advanceTimersByTime(10_000);
    engine.set(mixOf({ "music-box": 0.45 }));
    expect(ctx.count("convolver")).toBe(1);
    expect(state("music-box")).toBe("playing");
  });
});

describe("the phone's lock screen", () => {
  let session: { metadata: unknown; playbackState: string; handlers: Record<string, () => void> };

  beforeEach(() => {
    session = { metadata: null, playbackState: "none", handlers: {} };
    vi.stubGlobal("navigator", {
      mediaSession: Object.assign(session, {
        setActionHandler: (action: string, handler: () => void) => (session.handlers[action] = handler),
      }),
    });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(readonly init: { title: string }) {}
      },
    );
  });

  it("shows what plays, and lets go altogether when sound is turned off in the garden", async () => {
    engine.setNowPlaying("Veranda nap");
    engine.set(mixOf({ "music-piano": 0.3 }));
    await flush();
    expect(session.playbackState).toBe("playing");
    expect(session.metadata).toMatchObject({ init: { title: "Veranda nap" } });
    engine.stop();
    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
    // a headset's play button now does nothing
    session.handlers.play();
    expect(engine.status()).toBe("idle");
  });

  it("keeps its card after its own pause, so its play brings the sound back", async () => {
    engine.setNowPlaying("Veranda nap");
    engine.set(mixOf({ "music-piano": 0.3 }));
    await flush();
    session.handlers.pause();
    expect(engine.status()).toBe("idle");
    expect(session.playbackState).toBe("paused");
    expect(session.metadata).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(FakeAudio.all[0].getAttribute("src")).not.toBeNull();
    session.handlers.play();
    await flush();
    expect(engine.status()).toBe("playing");
    expect(session.playbackState).toBe("playing");
  });
});

describe("the bird calls", () => {
  const calls: ShotPlan = { sounds: ["call-koel"], perMinute: 2, level: 0.3 };
  const buffer = fakeBuffer(1, 48000, 48000, false);
  const loader = { ready: () => buffer, load: () => Promise.resolve(buffer), pin: () => {}, unpin: () => {} } as unknown as Loader;

  function shots() {
    const out = ctx.createGain();
    const s = new Shots({ ctx: ctx as unknown as AudioContext, out: out as unknown as AudioNode, loader }, soundFile, () => {});
    const started = () =>
      ctx.made.filter((n): n is FakeScheduled => n instanceof FakeScheduled && n.kind === "source" && n.startedAt !== null).map((n) => n.startedAt!);
    return { s, started };
  }

  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("keep the next call where it is when the rate drifts a little", () => {
    const { s, started } = shots();
    s.update(calls, 1);
    // drawn at 2 a minute: a 2 s rest and an exponential wait, at its median
    const first = 2 + Math.LN2 * 28;
    ctx.currentTime = 10;
    s.update({ ...calls, perMinute: 2.05 }, 8);
    s.pump(10, 15);
    expect(started()).toHaveLength(1);
    expect(started()[0]).toBeCloseTo(first, 6);
  });

  it("bring the next call nearer when the rate rises a lot, keeping what is already placed", () => {
    const { s, started } = shots();
    s.update(calls, 1);
    const first = 2 + Math.LN2 * 28;
    ctx.currentTime = 10;
    s.update({ ...calls, perMinute: 4 }, 8);
    s.pump(10, 15);
    expect(started()[0]).toBeCloseTo(10 + ((first - 10) * 2) / 4, 6);
  });

  it("draw the next call afresh when the calls themselves change", () => {
    const { s, started } = shots();
    s.update(calls, 1);
    ctx.currentTime = 10;
    s.update({ ...calls, sounds: ["call-bulbul"] }, 8);
    s.pump(10, 30);
    expect(started()[0]).toBeCloseTo(10 + 2 + Math.LN2 * 28, 6);
  });
});
