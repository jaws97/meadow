// The engine's layers: one per tile that plays, each with its own gain into the engine's master (lib/sound/engine),
// plus the bird calls, which are not a tile but a plan of calls dropped in now and then. A layer is made when the mix
// first lists its tile, comes in from silence once it has something to play, eases to each new level it is given, and
// fades away and is let go a few time constants after the mix stops listing it (or comes back if the mix lists it
// again before then). Four kinds:
// - a recorded bed (lib/sound/library, kind "bed"): fetched and decoded by the engine's loader (lib/sound/engine-loader),
//   then played by a `Looper` as two endless chains of crossfading segments from the same mono buffer, panned a little
//   left and a little right, so a mono file sounds wide and its seams never repeat (the timing is lib/sound/loopPlan's)
// - brown noise (generated "brown-noise"): the same looper over a 12 s buffer made on the spot, through a gentle
//   low-pass (lib/sound/engine-synth)
// - music (kind "music"): a long stereo piece streamed by an <audio> element into Web Audio, so it is not decoded whole
//   and its level is a gain node like any other layer's (an iPhone will not let a page set an element's volume). The
//   layer listens to its element: a pause it did not ask for (headphones taken out, another app taking the sound, a
//   battery alert) is reported to the engine, which hushes everything and asks for a tap; a stream that fails part
//   way through is reported as a failure, and tried again later
// - the music box (generated "music-box"): an endless piece written as it goes (lib/sound/musicBox), played with the
//   party trailer's voices into the engine's small hall, which is made once per context and kept
//
// Everything is scheduled on the audio clock ahead of time: a bed's next segment is placed while the current one still
// has twenty seconds or more to run, and the music box and the calls look a few seconds ahead (twenty while the page is
// hidden), so throttled timers in a hidden tab or on a locked phone never leave a gap. The engine's pump calls `pump`
// on each layer twice a second, and a bed also tops itself up each time one of its segments ends.
import { createComposer } from "@/lib/sound/musicBox";
import {
  BED_LOOP,
  equalPowerCurve,
  FIRST_FADE_S,
  NOISE_LOOP,
  nextSegment,
  shotGap,
  type LoopOptions,
  type Segment,
} from "@/lib/sound/loopPlan";
import type { Loader } from "@/lib/sound/engine-loader";
import { boxBus, BROWN_LOWPASS_HZ, panner, strike, swell, type BoxBus, type Hall } from "@/lib/sound/engine-synth";
import type { ShotPlan, SoundFile } from "@/lib/sound/types";

/** Where the two chains of a pseudo-stereo bed sit, left and right (-1..1). */
const SPREAD = [-0.45, 0.45] as const;
/** A layer is let go this many time constants after it starts fading out, and never sooner than RELEASE_MIN_S (s). */
const RELEASE_TAUS = 5;
const RELEASE_MIN_S = 1.5;
/** The shortest time constant any level change uses (s). */
const MIN_TAU_S = 0.02;
/** How far ahead a new sound starts, so its first sample is never in the past (s). */
const START_AHEAD_S = 0.05;
/** A music-box note this late is dropped rather than played out of time (s). */
const LATE_NOTE_S = 0.25;
/** A bird call's spread: pan within ±SHOT_PAN, gain SHOT_GAIN_MIN..1 of the plan's level, rate 1 ± SHOT_RATE. */
const SHOT_PAN = 0.6;
const SHOT_GAIN_MIN = 0.6;
const SHOT_RATE = 0.03;
/**
 * A new plan's call rate this far from the rate the next call was drawn at (as a share of it) moves the next call;
 * nearer than that, the call already drawn stands. The live garden's rate follows the sun's height, so nearly every
 * resend changes it by a hair, and redrawing each time would keep putting the next call off.
 */
const SHOT_RATE_CHANGE = 0.2;

const IN_CURVE = equalPowerCurve("in");
const OUT_CURVE = equalPowerCurve("out");

/** What a layer needs from the engine. */
export interface LayerHost {
  readonly ctx: AudioContext;
  /** the master gain's input */
  readonly out: AudioNode;
  readonly loader: Loader;
  /** how far ahead to schedule now (s): a few seconds, or more while the page is hidden */
  lookahead(): number;
  /** the brown-noise buffer, made once per context */
  brownNoise(): AudioBuffer;
  /** the music box's hall, made once per context (shorter on a phone) */
  hall(): Hall;
  /** the <audio> element and its source node for a music file, made once per context */
  media(file: SoundFile): { el: HTMLAudioElement; node: MediaElementAudioSourceNode };
  /** the layer has begun to sound */
  started(layer: Layer): void;
  /** the layer could not load or play: drop it */
  failed(layer: Layer, error: unknown): void;
  /** the browser refused to start a music element without a tap, or it has started after all */
  refused(layer: Layer, refused: boolean): void;
  /** the browser or the phone paused a music element the layer was playing (headphones out, another app's sound) */
  interrupted(layer: Layer): void;
  /** the layer has been let go */
  gone(layer: Layer): void;
  /** a layer started or stopped loading */
  loadingChanged(): void;
}

export type LayerKind = "bed" | "noise" | "music" | "box";
/** loading: waiting for its file; playing; leaving: fading out before it is let go; gone: let go. */
export type LayerState = "loading" | "playing" | "leaving" | "gone";

/** Moves a gain towards `target` with time constant `tau` from `now`, dropping any later plans for it. */
export function ease(param: AudioParam, target: number, now: number, tau: number): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(target, now, Math.max(MIN_TAU_S, tau));
}

/** One tile playing: a gain into the master, and whatever feeds it. */
export abstract class Layer {
  readonly gain: GainNode;
  state: LayerState = "loading";
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly key: string,
    readonly kind: LayerKind,
    protected readonly host: LayerHost,
    public level: number,
    protected tau: number,
  ) {
    this.gain = host.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(host.out);
  }

  /** Starts loading, or playing if there is nothing to wait for. */
  abstract begin(): void;
  /** Schedules what is due before `now + horizon` (s, audio clock). Streamed music has nothing to schedule. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature the layers that schedule ahead override
  pump(now: number, horizon: number): void {}
  /** Pauses a streamed element (the context is about to be suspended). */
  pauseMedia(): void {}
  /** Plays a streamed element again; call inside a tap where the browser asks for one. */
  playMedia(): void {}
  /** Stops and disconnects everything the layer made. */
  protected abstract release(): void;

  /** Eases to a new level. */
  setLevel(level: number, tau: number): void {
    this.level = level;
    this.tau = tau;
    if (this.state === "playing") ease(this.gain.gain, level, this.host.ctx.currentTime, tau);
  }

  /** The mix no longer lists this tile: fade out, then let go. A layer still loading goes at once. */
  leave(tau: number): void {
    if (this.state === "gone" || this.state === "leaving") return;
    if (this.state === "loading") {
      this.dispose();
      return;
    }
    this.state = "leaving";
    ease(this.gain.gain, 0, this.host.ctx.currentTime, tau);
    this.releaseTimer = setTimeout(() => this.dispose(), Math.max(RELEASE_MIN_S, RELEASE_TAUS * tau) * 1000);
  }

  /** The mix lists this tile again while it fades out: bring it back. */
  revive(level: number, tau: number): void {
    if (this.state !== "leaving") return;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.state = "playing";
    this.setLevel(level, tau);
  }

  /** Stops now and lets go. Safe to call more than once. */
  dispose(): void {
    if (this.state === "gone") return;
    const wasLoading = this.state === "loading";
    this.state = "gone";
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    try {
      this.release();
    } catch {
      // already stopped
    }
    try {
      this.gain.disconnect();
    } catch {
      // already disconnected
    }
    this.host.gone(this);
    if (wasLoading) this.host.loadingChanged();
  }

  /** The first sound: come in from silence to the level. */
  protected sounding(): void {
    if (this.state !== "loading") return;
    this.state = "playing";
    ease(this.gain.gain, this.level, this.host.ctx.currentTime, this.tau);
    this.host.loadingChanged();
    this.host.started(this);
  }
}

// ---- beds and brown noise ------------------------------------------------------------------------------------------

interface Voice {
  seg: Segment;
  src: AudioBufferSourceNode;
  env: GainNode;
}

interface Chain {
  /** where its segments go: a panner, or a gain that keeps two centred chains as loud as two panned ones */
  input: AudioNode;
  voices: Voice[];
  last: Segment | null;
}

/**
 * A buffer played without end as chains of overlapping segments, crossfaded with equal power, one chain a little left
 * and one a little right (or both centred where there is no StereoPannerNode).
 */
export class Looper {
  private readonly chains: Chain[];
  private stopped = false;
  private readonly options: LoopOptions;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    loop: Omit<LoopOptions, "fileS">,
    out: AudioNode,
    private readonly onEnded: () => void,
  ) {
    this.options = { ...loop, fileS: buffer.duration };
    this.chains = SPREAD.map((pan) => {
      const node = panner(ctx, pan);
      let input: AudioNode;
      if (node) input = node;
      else {
        // two unrelated chains, both centred, would be 3 dB louder than one; panned, each side carries one's power
        const g = ctx.createGain();
        g.gain.value = Math.SQRT1_2;
        input = g;
      }
      input.connect(out);
      return { input, voices: [], last: null };
    });
  }

  /** Starts both chains at `at` (s, audio clock) and schedules their next segments. */
  start(at: number, horizon: number): void {
    for (const chain of this.chains) {
      const seg = nextSegment(this.options, Math.random, null, this.othersOf(chain), at);
      this.play(chain, seg);
    }
    this.pump(this.ctx.currentTime, horizon);
  }

  /** Places each chain's next segment once its latest has started or is about to (within `horizon` s). */
  pump(now: number, horizon: number): void {
    if (this.stopped) return;
    for (const chain of this.chains) {
      let guard = 0;
      while (chain.last && chain.last.at <= now + horizon && guard++ < 8) {
        let seg = nextSegment(this.options, Math.random, chain.last, this.othersOf(chain));
        if (seg.at < now + START_AHEAD_S / 2) seg = this.catchUp(chain, now);
        this.play(chain, seg);
      }
    }
  }

  /** Stops every segment now and disconnects. */
  dispose(): void {
    this.stopped = true;
    for (const chain of this.chains) {
      for (const v of chain.voices) {
        v.src.onended = null;
        try {
          v.src.stop();
        } catch {
          // never started, or already stopped
        }
        v.src.disconnect();
        v.env.disconnect();
      }
      chain.voices = [];
      chain.input.disconnect();
    }
  }

  /**
   * The pump fell behind (timers held back for longer than a segment): start afresh from now, fading in over what
   * remains of the last segment's fade out, or a second if it has already ended.
   */
  private catchUp(chain: Chain, now: number): Segment {
    const at = now + START_AHEAD_S;
    const fresh = nextSegment(this.options, Math.random, null, this.othersOf(chain), at);
    const last = chain.last;
    const remaining = last ? last.at + last.duration - at : 0;
    const fadeIn = Math.min(fresh.duration / 4, Math.max(remaining > 0.1 ? remaining : 1, FIRST_FADE_S));
    return { ...fresh, fadeIn };
  }

  private othersOf(chain: Chain): Segment[] {
    const out: Segment[] = [];
    for (const c of this.chains) if (c !== chain) for (const v of c.voices) out.push(v.seg);
    return out;
  }

  private play(chain: Chain, seg: Segment): void {
    chain.last = seg;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    const env = this.ctx.createGain();
    env.gain.value = 0;
    const g = env.gain;
    if (seg.fadeIn <= FIRST_FADE_S + 1e-6) {
      g.setValueAtTime(0, seg.at);
      g.linearRampToValueAtTime(1, seg.at + seg.fadeIn);
    } else {
      g.setValueCurveAtTime(IN_CURVE, seg.at, seg.fadeIn);
    }
    g.setValueCurveAtTime(OUT_CURVE, seg.at + seg.duration - seg.fadeOut, seg.fadeOut);
    src.connect(env).connect(chain.input);
    const voice: Voice = { seg, src, env };
    chain.voices.push(voice);
    src.onended = () => {
      src.disconnect();
      env.disconnect();
      chain.voices = chain.voices.filter((v) => v !== voice);
      if (!this.stopped) this.onEnded();
    };
    src.start(seg.at, seg.offset, seg.duration);
  }
}

/** A recorded bed (file) or brown noise (no file): a looper into the layer's gain. */
export class BedLayer extends Layer {
  private looper: Looper | null = null;
  private filter: BiquadFilterNode | null = null;
  private pinned = false;

  constructor(key: string, host: LayerHost, level: number, tau: number, private readonly file: SoundFile | null) {
    super(key, file ? "bed" : "noise", host, level, tau);
  }

  begin(): void {
    if (!this.file) {
      this.play(this.host.brownNoise());
      return;
    }
    const { loader, ctx } = this.host;
    loader.pin(this.file.key);
    this.pinned = true;
    const held = loader.ready(this.file.key);
    if (held) {
      this.play(held);
      return;
    }
    this.host.loadingChanged();
    loader.load(this.file, ctx).then(
      (buffer) => {
        if (this.state === "loading") this.play(buffer);
      },
      (error) => {
        if (this.state === "loading") this.host.failed(this, error);
      },
    );
  }

  pump(now: number, horizon: number): void {
    this.looper?.pump(now, horizon);
  }

  protected release(): void {
    this.looper?.dispose();
    this.looper = null;
    this.filter?.disconnect();
    if (this.pinned && this.file) this.host.loader.unpin(this.file.key);
    this.pinned = false;
  }

  private play(buffer: AudioBuffer): void {
    const { ctx } = this.host;
    let out: AudioNode = this.gain;
    if (!this.file) {
      // brown noise, softened a little more at the top
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = BROWN_LOWPASS_HZ;
      this.filter.Q.value = 0.5;
      this.filter.connect(this.gain);
      out = this.filter;
    }
    const looper = new Looper(ctx, buffer, this.file ? BED_LOOP : NOISE_LOOP, out, () => {
      if (this.state !== "gone") looper.pump(ctx.currentTime, this.host.lookahead());
    });
    this.looper = looper;
    looper.start(ctx.currentTime + START_AHEAD_S, this.host.lookahead());
    this.sounding();
  }
}

// ---- music ---------------------------------------------------------------------------------------------------------

/** A music file streamed through an <audio> element (looping) into the layer's gain. */
export class MusicLayer extends Layer {
  private media: { el: HTMLAudioElement; node: MediaElementAudioSourceNode } | null = null;
  /** the layer wants its element playing: a pause while this holds was not the engine's */
  private wanted = false;
  private readonly onPause = () => {
    const el = this.media?.el;
    // the event comes a moment after the pause: a play() since then, or a pause the engine asked for, is not news
    if (!el || !this.wanted || !el.paused || this.state === "gone") return;
    this.host.interrupted(this);
  };
  private readonly onError = () => {
    const el = this.media?.el;
    if (!el || this.state === "gone") return;
    this.host.failed(this, el.error ?? new Error(`${this.file.key}: the stream failed`));
  };

  constructor(key: string, host: LayerHost, level: number, tau: number, private readonly file: SoundFile) {
    super(key, "music", host, level, tau);
  }

  begin(): void {
    try {
      this.media = this.host.media(this.file);
      this.media.node.connect(this.gain);
      this.media.el.addEventListener("pause", this.onPause);
      this.media.el.addEventListener("error", this.onError);
    } catch (error) {
      this.host.failed(this, error);
      return;
    }
    this.host.loadingChanged();
    this.playMedia();
  }

  /** Calls play() on the element at once, so that inside a tap the browser allows it. */
  playMedia(): void {
    const el = this.media?.el;
    if (!el || this.state === "gone") return;
    this.wanted = true;
    let attempt: Promise<void> | undefined;
    try {
      attempt = el.play();
    } catch (error) {
      this.host.failed(this, error);
      return;
    }
    const ok = () => {
      if (this.state === "gone") return;
      this.host.refused(this, false);
      this.sounding();
    };
    if (!attempt) {
      ok();
      return;
    }
    attempt.then(ok, (error: unknown) => {
      if (this.state === "gone") return;
      const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
      if (name === "NotAllowedError") this.host.refused(this, true);
      else if (name !== "AbortError") this.host.failed(this, error);
    });
  }

  pauseMedia(): void {
    this.wanted = false;
    try {
      this.media?.el.pause();
    } catch {
      // nothing to pause
    }
  }

  protected release(): void {
    if (!this.media) return;
    this.pauseMedia();
    this.media.el.removeEventListener("pause", this.onPause);
    this.media.el.removeEventListener("error", this.onError);
    this.media.node.disconnect();
    this.media = null;
  }
}

// ---- the music box -------------------------------------------------------------------------------------------------

/**
 * The endless music box and pad, written as it plays, into the engine's hall, whose ringing comes back into this
 * layer's gain. Music is one piece at a time, so one music box at most uses the hall.
 */
export class BoxLayer extends Layer {
  private bus: BoxBus | null = null;
  private hall: Hall | null = null;
  private composer = createComposer(Math.floor(Math.random() * 2 ** 31));
  private startAt = 0;

  constructor(key: string, host: LayerHost, level: number, tau: number) {
    super(key, "box", host, level, tau);
  }

  begin(): void {
    const { ctx } = this.host;
    this.hall = this.host.hall();
    this.hall.output.connect(this.gain);
    this.bus = boxBus(ctx, this.gain, this.hall.input);
    this.startAt = ctx.currentTime + START_AHEAD_S;
    this.sounding();
    this.pump(ctx.currentTime, this.host.lookahead());
  }

  pump(now: number, horizon: number): void {
    const bus = this.bus;
    if (!bus || this.state === "gone") return;
    const { ctx } = this.host;
    for (const note of this.composer.until(now + horizon - this.startAt)) {
      const when = this.startAt + note.t;
      if (when < now - LATE_NOTE_S) continue;
      const at = Math.max(when, now + 0.01);
      if (note.voice === "bell") for (const m of note.midi) strike(ctx, bus.bells, m, at, note.vel / Math.sqrt(note.midi.length), note.dur);
      else swell(ctx, bus.pads, note.midi, at, note.vel, note.dur);
    }
  }

  protected release(): void {
    // notes already placed play on into nothing and tidy themselves away; the hall is kept for the next music box
    for (const node of this.bus?.nodes ?? []) node.disconnect();
    this.bus = null;
    try {
      this.hall?.output.disconnect(this.gain);
    } catch {
      // not connected
    }
    this.hall = null;
  }
}

// ---- bird calls ----------------------------------------------------------------------------------------------------

interface Call {
  src: AudioBufferSourceNode;
  nodes: AudioNode[];
  at: number;
}

/** The bird calls of a ShotPlan: one at a time, at random, each placed a little differently. */
export class Shots {
  private readonly bus: GainNode;
  private plan: ShotPlan | null = null;
  private nextAt = Infinity;
  /** the call rate the next call was drawn at (per minute) */
  private drawnRate = 0;
  private busyUntil = 0;
  private lastKey: string | null = null;
  private calls: Call[] = [];
  private pinned: string[] = [];
  /** calls whose file would not load, left out from then on */
  private readonly failed = new Set<string>();

  constructor(
    private readonly host: Pick<LayerHost, "ctx" | "out" | "loader">,
    private readonly files: (key: string) => SoundFile | undefined,
    private readonly warn: (key: string, error: unknown) => void,
  ) {
    this.bus = host.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(host.out);
  }

  /**
   * Follows a new plan (null for none): loads its calls. A new set of calls redraws the next one; a call rate that has
   * moved by more than SHOT_RATE_CHANGE stretches or shrinks the wait for it, keeping the calls already placed; the
   * small drift of the live garden's rate leaves the next call where it is.
   */
  update(plan: ShotPlan | null, tau: number): void {
    const now = this.host.ctx.currentTime;
    const keys = plan && plan.perMinute > 0 ? plan.sounds.filter((k) => this.files(k)?.kind === "shot" && !this.failed.has(k)) : [];
    const next = plan && keys.length ? { ...plan, sounds: keys } : null;
    const changed =
      !next || !this.plan || next.sounds.length !== this.plan.sounds.length || next.sounds.some((k, i) => k !== this.plan!.sounds[i]);
    for (const k of keys) if (!this.pinned.includes(k)) this.host.loader.pin(k);
    for (const k of this.pinned) if (!keys.includes(k)) this.host.loader.unpin(k);
    this.pinned = keys;
    for (const k of keys) {
      if (this.host.loader.ready(k)) continue;
      this.host.loader.load(this.files(k)!, this.host.ctx).catch((error: unknown) => {
        if (this.failed.has(k)) return;
        this.failed.add(k);
        this.warn(k, error);
      });
    }
    this.plan = next;
    if (!this.plan) {
      this.cancelFuture(now);
      this.nextAt = Infinity;
      ease(this.bus.gain, 0, now, tau);
      return;
    }
    ease(this.bus.gain, 1, now, tau);
    const rate = this.plan.perMinute;
    if (changed || this.nextAt === Infinity) {
      this.cancelFuture(now);
      this.nextAt = Math.max(now, this.busyUntil) + shotGap(rate, 0, Math.random);
      this.drawnRate = rate;
    } else if (Math.abs(rate - this.drawnRate) > SHOT_RATE_CHANGE * this.drawnRate) {
      // the same calls, much more or less often: the wait still to run scales with the rate (a Poisson process's wait
      // is memoryless, so this is as if it had been drawn at the new rate)
      if (this.nextAt > now) this.nextAt = now + ((this.nextAt - now) * this.drawnRate) / rate;
      this.drawnRate = rate;
    }
  }

  /** Places the calls due before `now + horizon`, one after another. */
  pump(now: number, horizon: number): void {
    const plan = this.plan;
    if (!plan) return;
    let guard = 0;
    while (this.nextAt < now + horizon && guard++ < 16) {
      if (this.nextAt < now) this.nextAt = now + START_AHEAD_S;
      const ready = plan.sounds.flatMap((k) => {
        const buffer = this.host.loader.ready(k);
        return buffer ? [{ k, buffer }] : [];
      });
      if (!ready.length) {
        // nothing decoded yet: look again in a moment
        this.nextAt = now + 1;
        return;
      }
      const choices = ready.length > 1 ? ready.filter((r) => r.k !== this.lastKey) : ready;
      const { k, buffer } = choices[Math.floor(Math.random() * choices.length)];
      const rate = 1 + (Math.random() * 2 - 1) * SHOT_RATE;
      const at = this.nextAt;
      this.place(buffer, at, rate, (SHOT_GAIN_MIN + (1 - SHOT_GAIN_MIN) * Math.random()) * plan.level);
      this.lastKey = k;
      const length = buffer.duration / rate;
      this.busyUntil = at + length;
      this.nextAt = this.busyUntil + shotGap(plan.perMinute, length, Math.random);
      this.drawnRate = plan.perMinute;
    }
  }

  /** Stops every call and forgets the plan; the buffers are kept by the loader. */
  reset(): void {
    for (const call of this.calls) this.silence(call);
    this.calls = [];
    for (const k of this.pinned) this.host.loader.unpin(k);
    this.pinned = [];
    this.plan = null;
    this.nextAt = Infinity;
    this.busyUntil = 0;
    this.bus.gain.cancelScheduledValues(0);
    this.bus.gain.value = 1;
  }

  /** Disconnects for good (the context is being replaced). */
  dispose(): void {
    this.reset();
    this.bus.disconnect();
  }

  private place(buffer: AudioBuffer, at: number, rate: number, gain: number): void {
    const { ctx } = this.host;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = panner(ctx, (Math.random() * 2 - 1) * SHOT_PAN);
    src.connect(g);
    if (pan) g.connect(pan).connect(this.bus);
    else g.connect(this.bus);
    const call: Call = { src, nodes: pan ? [src, g, pan] : [src, g], at };
    this.calls.push(call);
    src.onended = () => {
      for (const n of call.nodes) n.disconnect();
      this.calls = this.calls.filter((c) => c !== call);
    };
    src.start(at);
  }

  private cancelFuture(now: number): void {
    const keep: Call[] = [];
    for (const call of this.calls) {
      if (call.at > now + 0.01) this.silence(call);
      else keep.push(call);
    }
    this.calls = keep;
    if (this.busyUntil > now && keep.length === 0) this.busyUntil = now;
  }

  private silence(call: Call): void {
    call.src.onended = null;
    try {
      call.src.stop();
    } catch {
      // already stopped
    }
    for (const n of call.nodes) n.disconnect();
  }
}
