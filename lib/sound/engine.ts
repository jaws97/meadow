// The garden's sound engine: Web Audio, loaded by a dynamic import once the person reaches for sound, and driven by the
// sound store (lib/sound/store). The store hands it a Mixdown, the whole wanted state (tiles and levels, bird calls,
// how quickly to move), and the engine eases from whatever plays now towards it: new tiles come in from silence, tiles
// no longer listed fade away, changed levels glide. The rest of the feature never touches an AudioNode.
//
// The graph: each tile's layer (lib/sound/engine-layers) -> a master gain (the volume, and every fade in and out) -> a
// sleep gain (the fade-out timer's long ramp) -> a gentle compressor, a safety net when five layers meet -> speakers.
// Recorded beds play dry: the recordings carry their own space; the music box rings in a small hall, made once per
// context while the page is idle after the first tap (with the brown noise's buffer), so a later tap never waits on
// it. The one context comes from lib/sound/context, made and resumed inside the tap that turned sound on; on a machine
// with no Web Audio the engine stays idle and silent. If the context is replaced (the store recreates a context that a
// tap could not revive), the engine builds its graph again on the new one and plays the last mix, keeping the decoded
// buffers.
//
// It reports a status the panel can show: idle (off) -> starting (the first files loading) -> playing; paused (the page
// is hidden, faded out and suspended); blocked (the browser wants a tap: an iPhone interruption, a resume refused,
// music that may only start from a tap, a music element the phone paused, or nothing in the mix could load). It never
// throws. A file that will not load is reported (`failed()`) and tried again by itself a few times, RETRY_FAILED_MS
// apart, while the mix still lists it; picking it again, or a tap on resume, tries at once. When the phone pauses a
// piece of music (headphones taken out, another app's sound, a battery alert) everything else hushes with it, so rain
// never carries on out of a loudspeaker, until a tap brings it all back.
//
// Leaving the page fades out over half a second and suspends, unless the person asked to keep listening with the
// screen locked (iOS 17.5+ with the "playback" session, Chrome on Android), when it keeps scheduling twenty seconds
// ahead so throttled timers never leave a gap. The sleep timer is a ramp on the audio clock, so it finishes on a
// locked phone; a ConstantSourceNode that ends at the same moment tells the engine to stop. While sound plays, the
// phone's lock screen shows what is playing (Media Session), and its play and pause buttons resume and stop it. Sound
// stopped there can be played again from there; sound turned off in the garden lets go of the lock screen altogether
// (no title, no play button, the music elements unloaded), so a headset's play button never starts it again unseen.
//
// For tests and the console, outside production or with ?dev: `window.__gardenSound` = { engine, context, layers() }.
// This module imports no three.js and nothing from lib/garden, so it stays a small chunk of its own.
import { tile } from "@/lib/sound/catalog";
import { audioContext } from "@/lib/sound/context";
import { isLightDevice } from "@/lib/sound/budget";
import { Loader } from "@/lib/sound/engine-loader";
import { BedLayer, BoxLayer, MusicLayer, Shots, type Layer, type LayerHost } from "@/lib/sound/engine-layers";
import { brownNoiseBuffer, HALL_FULL_S, HALL_LIGHT_S, makeHall, type Hall } from "@/lib/sound/engine-synth";
import { soundFile } from "@/lib/sound/library";
import type { Engine, EngineStatus, Mixdown, SoundFile } from "@/lib/sound/types";

/** The first fade in when sound starts (s), and the fade back after the page was hidden or a block cleared. */
const START_FADE_S = 2;
const RETURN_FADE_S = 1;
/** The fade out before suspending when the page is hidden, and when the phone pauses a piece of music (s). */
const HIDE_FADE_S = 0.5;
/** stop()'s fade when none is given (s). */
const STOP_FADE_S = 1.2;
/** The volume's glide (time constant, s): about 0.2 s to settle. */
const VOLUME_TAU_S = 0.06;
/** The sleep timer's fade when none is given (s), and the quick fade when its moment has already passed. */
const SLEEP_FADE_S = 120;
const SLEEP_LATE_FADE_S = 2;
/**
 * After a resume the context is looked at every CHECK_MS, and reported as blocked if after RUN_CHECKS looks it still is
 * not running, or says "running" while its clock stands still (WebKit's silent "running"). An output can take a
 * second or more to start, and a "blocked" that flickers would show the tap hint for nothing.
 */
const CHECK_MS = 600;
const RUN_CHECKS = 3;
/** How often the pump schedules ahead (ms), and how far: visible, and hidden but still playing (s). */
const PUMP_MS = 500;
const LOOKAHEAD_S = 2.5;
const HIDDEN_LOOKAHEAD_S = 20;
/**
 * The compressor: only touches the loudest moments, gently. Web Audio's compressor always adds its own makeup gain;
 * with these settings everything comes out about 3 dB louder (measured in Chrome), the same for every layer.
 */
const COMPRESSOR = { threshold: -14, knee: 12, ratio: 2.5, attack: 0.02, release: 0.4 } as const;
/**
 * A tile whose file would not load or play is not tried again for this long, however often the mix lists it (ms);
 * then the engine tries it again by itself, while the mix still lists it, up to MAX_AUTO_RETRIES times. Picking it
 * again, a fresh start or a tap on resume tries at once.
 */
const RETRY_FAILED_MS = 30_000;
const MAX_AUTO_RETRIES = 3;
/** The hall and the brown noise are made while the page is idle after the first tap, at the latest after this long
 * (ms), or after the fallback where the browser has no idle callback (Safari). */
const PREWARM_TIMEOUT_MS = 5000;
const PREWARM_FALLBACK_MS = 1500;
/** The lock screen's line under the title. */
const ARTIST = "Your garden";
const DEFAULT_TITLE = "Garden sounds";

interface Graph {
  ctx: AudioContext;
  host: LayerHost;
  master: GainNode;
  sleep: GainNode;
  compressor: DynamicsCompressorNode;
  shots: Shots;
  noise: AudioBuffer | null;
  hall: Hall | null;
  media: Map<string, { el: HTMLAudioElement; node: MediaElementAudioSourceNode }>;
}

type Timer = ReturnType<typeof setTimeout>;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Freezes a param where it is now, so a ramp can start from there. */
function holdAt(param: AudioParam, now: number): void {
  if (typeof param.cancelAndHoldAtTime === "function") {
    try {
      param.cancelAndHoldAtTime(now);
      return;
    } catch {
      // fall through to the older way
    }
  }
  const value = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
}

/** Runs `fn`, and logs rather than throws if Web Audio refuses something. */
function safely(what: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.warn(`[garden-sound] ${what} failed`, error);
  }
}

/** Lets an <audio> element drop its file, so the phone no longer counts the page as playing anything. */
function unload(el: HTMLAudioElement): void {
  try {
    el.pause();
    if (el.getAttribute("src") === null) return;
    el.removeAttribute("src");
    el.load();
  } catch {
    // nothing to let go
  }
}

class GardenEngine implements Engine {
  private g: Graph | null = null;
  readonly loader = new Loader();
  private readonly layers = new Map<string, Layer>();
  private readonly listeners = new Set<() => void>();
  private readonly warned = new Set<string>();
  /** when each tile last failed to load or play (epoch ms), and how many times in a row */
  private readonly failedAt = new Map<string, number>();
  private readonly failCount = new Map<string, number>();
  private lastMix: Mixdown | null = null;

  /** the person wants sound now (set since the last stop) */
  private on = false;
  /** faded out and suspended because the page is hidden */
  private paused = false;
  /** the context will not run without a tap */
  private blocked = false;
  /** music layers whose play() the browser refused, or whose element the phone paused */
  private readonly refusals = new Set<Layer>();
  /** the master is faded out because the phone paused a piece of music */
  private hushed = false;
  /** the last stop came from the lock screen's pause, so its play may bring the sound back */
  private lockScreenPaused = false;
  private volume = 1;
  private background = false;
  private title = DEFAULT_TITLE;
  private current: EngineStatus = "idle";
  private loadingKeys: string[] = [];
  private failedKeys: string[] = [];

  private sleepAtMs: number | null = null;
  private sleepFadeS = SLEEP_FADE_S;
  private sleepNode: ConstantSourceNode | null = null;
  private sleepTimer: Timer | null = null;
  private sleepToken = 0;

  private stopTimer: Timer | null = null;
  private pauseTimer: Timer | null = null;
  private checkTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  /** the audio clock at the last pump (s) */
  private lastClock = 0;
  private mediaSessionReady = false;
  private shownTitle: string | null = null;

  constructor() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => (document.hidden ? this.onHidden() : this.onVisible()));
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && !document.hidden) this.onVisible();
    });
  }

  // ---- the Engine API ------------------------------------------------------------------------------------------------

  set(mix: Mixdown): void {
    safely("set", () => {
      const g = this.bind();
      if (!g) return;
      const tau = Math.max(0.02, Number.isFinite(mix.tauS) ? mix.tauS : 1);
      const before = this.lastMix;
      this.lastMix = mix;
      this.clearTimer("stop");
      let woke = false;
      if (!this.on) {
        this.on = true;
        this.lockScreenPaused = false;
        this.blocked = false;
        this.hushed = false;
        this.refusals.clear();
        // a fresh start (a tap, or the lock screen's play) tries every file again
        this.forgetFailures();
        this.paused = typeof document !== "undefined" && document.hidden && !this.background;
        if (!this.paused) woke = this.wake(START_FADE_S);
      } else {
        // a tile listed again after the mix had left it out was picked on purpose: try it now, even if it just failed
        const listed = new Set(before?.layers.map((l) => l.key) ?? []);
        for (const l of mix.layers) if (!listed.has(l.key)) this.forgetFailure(l.key);
        if (!this.paused && g.ctx.state !== "running") woke = this.wake(RETURN_FADE_S);
      }

      const wanted = new Map<string, number>();
      for (const layer of mix.layers) wanted.set(layer.key, clamp01(layer.level));
      for (const [key, layer] of this.layers) if (!wanted.has(key)) layer.leave(tau);
      for (const [key, level] of wanted) {
        const layer = this.layers.get(key);
        if (layer && layer.state === "leaving") layer.revive(level, tau);
        else if (layer && layer.state !== "gone") layer.setLevel(level, tau);
        else this.add(key, level, tau);
      }
      // a tap may let refused or paused music start now
      if (!this.paused) for (const layer of this.refusals) layer.playMedia();
      g.shots.update(mix.shots, tau);
      if (!this.paused) this.startPump();
      this.pump();
      this.refresh();
      if (woke) this.syncSleep();
    });
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    const g = this.g;
    if (!g || !this.on || this.paused || this.hushed) return;
    safely("volume", () => {
      const now = g.ctx.currentTime;
      holdAt(g.master.gain, now);
      g.master.gain.setTargetAtTime(this.masterGain(), now, VOLUME_TAU_S);
    });
  }

  sleepAt(atMs: number | null, fadeS = SLEEP_FADE_S): void {
    safely("sleep timer", () => {
      if (atMs === null || !Number.isFinite(atMs)) {
        this.sleepAtMs = null;
        this.cancelSleep();
        this.restoreSleepGain(1);
        return;
      }
      this.sleepAtMs = atMs;
      this.sleepFadeS = Math.max(1, Number.isFinite(fadeS) ? fadeS : SLEEP_FADE_S);
      this.applySleep();
    });
  }

  setBackground(keep: boolean): void {
    this.background = !!keep;
    safely("background", () => {
      if (typeof document === "undefined" || !document.hidden) return;
      if (keep) this.pump();
      else this.onHidden();
    });
  }

  stop(fadeS = STOP_FADE_S): void {
    // turned off in the garden (or by the timer): the lock screen lets go too
    this.lockScreenPaused = false;
    this.halt(fadeS);
  }

  resume(): void {
    safely("resume", () => {
      const g = this.bind();
      if (!g) return;
      if (!this.on) {
        if (this.lastMix) this.set(this.lastMix);
        return;
      }
      this.blocked = false;
      this.paused = false;
      this.clearTimer("pause");
      // a tap: everything that failed is worth another go
      this.forgetFailures();
      for (const layer of this.layers.values()) layer.playMedia();
      this.wake(RETURN_FADE_S);
      this.restoreMissing();
      this.startPump();
      this.pump();
      this.refresh();
      this.syncSleep();
    });
  }

  setNowPlaying(title: string): void {
    this.title = (typeof title === "string" ? title.trim() : "") || DEFAULT_TITLE;
    this.showMediaSession();
  }

  status(): EngineStatus {
    return this.current;
  }

  loading(): string[] {
    return this.loadingKeys;
  }

  failed(): string[] {
    return this.failedKeys;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** What plays now, for tests and the console. */
  describe(): { key: string; level: number; kind: string; state: string }[] {
    return [...this.layers.values()].map((l) => ({ key: l.key, level: l.level, kind: l.kind, state: l.state }));
  }

  // ---- the graph -----------------------------------------------------------------------------------------------------

  /** The graph on the current context, built the first time (or again if the context was replaced). */
  private bind(): Graph | null {
    const ctx = audioContext();
    if (!ctx) return null;
    if (this.g && this.g.ctx === ctx) return this.g;
    if (this.g) this.unbind();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = COMPRESSOR.threshold;
    compressor.knee.value = COMPRESSOR.knee;
    compressor.ratio.value = COMPRESSOR.ratio;
    compressor.attack.value = COMPRESSOR.attack;
    compressor.release.value = COMPRESSOR.release;
    compressor.connect(ctx.destination);
    const sleep = ctx.createGain();
    sleep.gain.value = 1;
    sleep.connect(compressor);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(sleep);
    const host = this.host(ctx, master);
    const shots = new Shots(host, soundFile, (key, error) => this.warnOnce(key, `the bird call ${key} could not load`, error));
    const g: Graph = { ctx, host, master, sleep, compressor, shots, noise: null, hall: null, media: new Map() };
    this.g = g;
    ctx.addEventListener("statechange", () => this.onStateChange(ctx));
    this.prewarm(g);
    return g;
  }

  /**
   * Lets go of a graph whose context has been replaced; decoded buffers are kept. Sound counts as off until the next
   * set(), or resume(), which plays the last mix again on the new context.
   */
  private unbind(): void {
    const g = this.g;
    if (!g) return;
    this.on = false;
    this.paused = false;
    this.hushed = false;
    this.refusals.clear();
    this.cancelSleep();
    this.stopPump();
    this.clearTimer("retry");
    for (const layer of [...this.layers.values()]) layer.dispose();
    this.layers.clear();
    g.shots.dispose();
    // an element belongs to the context its source node was made on: the new graph makes its own
    for (const { el } of g.media.values()) unload(el);
    g.master.disconnect();
    this.g = null;
  }

  /** Makes the hall and the brown noise while the page is idle, so a later tap that wants them never waits. */
  private prewarm(g: Graph): void {
    const go = () => {
      if (this.g !== g) return;
      safely("prewarm", () => {
        g.host.hall();
        g.host.brownNoise();
      });
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(go, { timeout: PREWARM_TIMEOUT_MS });
    } else {
      setTimeout(go, PREWARM_FALLBACK_MS);
    }
  }

  private host(ctx: AudioContext, master: GainNode): LayerHost {
    const hallS = isLightDevice() ? HALL_LIGHT_S : HALL_FULL_S;
    return {
      ctx,
      out: master,
      loader: this.loader,
      lookahead: () => (typeof document !== "undefined" && document.hidden ? HIDDEN_LOOKAHEAD_S : LOOKAHEAD_S),
      brownNoise: () => {
        const g = this.g!;
        g.noise ??= brownNoiseBuffer(ctx);
        return g.noise;
      },
      hall: () => {
        const g = this.g!;
        g.hall ??= makeHall(ctx, hallS);
        return g.hall;
      },
      media: (file) => {
        const g = this.g!;
        let media = g.media.get(file.key);
        if (!media) {
          const el = new Audio();
          el.preload = "auto";
          el.loop = true;
          el.src = file.url;
          media = { el, node: ctx.createMediaElementSource(el) };
          g.media.set(file.key, media);
        } else if (media.el.getAttribute("src") === null || media.el.error) {
          // let go when sound was last turned off, or its stream failed: load it afresh
          media.el.src = file.url;
        }
        return media;
      },
      started: (layer) => {
        this.forgetFailure(layer.key);
        this.refresh();
      },
      failed: (layer, error) => {
        this.warnOnce(layer.key, `${layer.key} could not play`, error);
        this.failedAt.set(layer.key, Date.now());
        this.failCount.set(layer.key, (this.failCount.get(layer.key) ?? 0) + 1);
        this.refusals.delete(layer);
        layer.dispose();
        this.unhushIfClear();
        this.scheduleRetry();
        this.refresh();
      },
      refused: (layer, refused) => {
        if (refused) this.refusals.add(layer);
        else this.refusals.delete(layer);
        if (!refused) this.unhushIfClear();
        this.refresh();
      },
      interrupted: (layer) => {
        if (!this.on || this.paused || this.layers.get(layer.key) !== layer) return;
        // headphones out, another app's sound: everything goes quiet with the music, and a tap brings it all back
        this.refusals.add(layer);
        this.hush();
        this.refresh();
      },
      gone: (layer) => {
        this.refusals.delete(layer);
        if (this.layers.get(layer.key) === layer) this.layers.delete(layer.key);
      },
      loadingChanged: () => this.refresh(),
    };
  }

  /**
   * Makes and starts the layer for a tile key (or a library key), or warns once if there is no such sound. A tile that
   * failed in the last RETRY_FAILED_MS, or more than MAX_AUTO_RETRIES times in a row, is left out quietly (failed()).
   */
  private add(key: string, level: number, tau: number): void {
    const failed = this.failedAt.get(key);
    if (failed !== undefined && (Date.now() - failed < RETRY_FAILED_MS || (this.failCount.get(key) ?? 0) > MAX_AUTO_RETRIES)) return;
    const host = this.g!.host;
    const t = tile(key);
    let layer: Layer | null = null;
    if (t?.generated === "brown-noise") layer = new BedLayer(key, host, level, tau, null);
    else if (t?.generated === "music-box") layer = new BoxLayer(key, host, level, tau);
    else {
      const file: SoundFile | undefined = soundFile(t?.sound ?? key);
      if (file?.kind === "bed") layer = new BedLayer(key, host, level, tau, file);
      else if (file?.kind === "music") layer = new MusicLayer(key, host, level, tau, file);
    }
    if (!layer) {
      this.warnOnce(key, `no sound to play for "${key}"`);
      return;
    }
    this.layers.set(key, layer);
    layer.begin();
  }

  /** Whether a tile has a layer that is loading or sounding. */
  private alive(key: string): boolean {
    const layer = this.layers.get(key);
    return layer !== undefined && layer.state !== "gone";
  }

  /** Starts again every tile the current mix lists that has no layer (it failed), as far as `add` allows. */
  private restoreMissing(): void {
    const mix = this.lastMix;
    if (!this.g || !this.on || !mix) return;
    const tau = Math.max(0.02, Number.isFinite(mix.tauS) ? mix.tauS : 1);
    for (const l of mix.layers) if (!this.alive(l.key)) this.add(l.key, clamp01(l.level), tau);
  }

  private forgetFailure(key: string): void {
    this.failedAt.delete(key);
    this.failCount.delete(key);
  }

  private forgetFailures(): void {
    this.failedAt.clear();
    this.failCount.clear();
  }

  /** The tiles of the current mix that failed and have not come back. */
  private failedNow(): string[] {
    const mix = this.lastMix;
    if (!this.on || !mix) return [];
    return mix.layers.map((l) => l.key).filter((key) => this.failedAt.has(key) && !this.alive(key));
  }

  /** Sets a timer for the next failed tile whose wait is over and that may still be tried by itself. */
  private scheduleRetry(): void {
    this.clearTimer("retry");
    if (!this.on || this.paused) return;
    let due = Infinity;
    for (const key of this.failedNow()) {
      if ((this.failCount.get(key) ?? 0) > MAX_AUTO_RETRIES) continue;
      due = Math.min(due, (this.failedAt.get(key) ?? 0) + RETRY_FAILED_MS);
    }
    if (due === Infinity) return;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        if (!this.on || this.paused) return;
        safely("retry", () => {
          this.restoreMissing();
          this.pump();
          this.refresh();
        });
        this.scheduleRetry();
      },
      Math.max(0, due - Date.now()) + 50,
    );
  }

  // ---- waking, pausing, settling -------------------------------------------------------------------------------------

  /**
   * Resumes the context (inside a tap this is allowed) and brings the master up to the volume over `fadeS`. Returns
   * whether there was a graph to wake; the caller then puts the sleep timer back on the clock (`syncSleep`).
   */
  private wake(fadeS: number): boolean {
    const g = this.g;
    if (!g) return false;
    const ctx = g.ctx;
    try {
      if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    } catch {
      // checked below
    }
    this.hushed = false;
    const now = ctx.currentTime;
    holdAt(g.master.gain, now);
    g.master.gain.linearRampToValueAtTime(this.masterGain(), now + fadeS);
    this.checkRunning();
    return true;
  }

  /** Fades everything out while the phone holds a piece of music paused; a tap (resume) brings it back. */
  private hush(): void {
    const g = this.g;
    if (!g || this.hushed) return;
    this.hushed = true;
    safely("hush", () => {
      const now = g.ctx.currentTime;
      holdAt(g.master.gain, now);
      g.master.gain.linearRampToValueAtTime(0, now + HIDE_FADE_S);
    });
  }

  /** The music the phone paused plays again (or is gone): the rest comes back up with it. */
  private unhushIfClear(): void {
    const g = this.g;
    if (!this.hushed || this.refusals.size > 0) return;
    this.hushed = false;
    if (!g || !this.on || this.paused) return;
    safely("unhush", () => {
      const now = g.ctx.currentTime;
      holdAt(g.master.gain, now);
      g.master.gain.linearRampToValueAtTime(this.masterGain(), now + RETURN_FADE_S);
    });
  }

  /** The sleep timer, as it stands by the wall clock, placed back on the audio clock; or the sleep gain back at full. */
  private syncSleep(): void {
    if (this.sleepAtMs === null) this.restoreSleepGain(0.3);
    else this.applySleep();
  }

  /** Fades out over `fadeS` and then settles: off, with the lock screen kept only if its pause asked for this. */
  private halt(fadeS: number): void {
    safely("stop", () => {
      this.on = false;
      this.paused = false;
      this.blocked = false;
      this.hushed = false;
      this.refusals.clear();
      this.sleepAtMs = null;
      this.cancelSleep();
      this.clearTimer("pause");
      this.clearTimer("check");
      this.clearTimer("stop");
      this.clearTimer("retry");
      const g = this.g;
      if (g) {
        // layers still loading have made no sound: let them go now, so they never start later
        for (const layer of [...this.layers.values()]) if (layer.state === "loading") layer.dispose();
        g.shots.update(null, 0.3);
        const fade = Math.max(0.05, Number.isFinite(fadeS) ? fadeS : STOP_FADE_S);
        const now = g.ctx.currentTime;
        holdAt(g.master.gain, now);
        g.master.gain.linearRampToValueAtTime(0, now + fade);
        this.stopTimer = setTimeout(() => this.settle(), (fade + 0.1) * 1000);
      }
      this.refresh();
    });
  }

  /**
   * After a stop's fade: every layer let go, the bird calls cleared, the context suspended. Buffers are kept. The music
   * elements let go of their files too, unless the lock screen paused the sound and may play it again.
   */
  private settle(): void {
    this.stopTimer = null;
    if (this.on) return;
    const g = this.g;
    if (!g) return;
    for (const layer of [...this.layers.values()]) layer.dispose();
    this.layers.clear();
    g.shots.reset();
    for (const { el } of g.media.values()) {
      if (this.lockScreenPaused) el.pause();
      else unload(el);
    }
    g.sleep.gain.cancelScheduledValues(0);
    g.sleep.gain.value = 1;
    this.stopPump();
    try {
      if (g.ctx.state === "running") void g.ctx.suspend().catch(() => undefined);
    } catch {
      // nothing to suspend
    }
    this.refresh();
  }

  private onHidden(): void {
    const g = this.g;
    if (!g || !this.on) return;
    if (this.background || this.paused) {
      // keep playing: schedule well ahead before the timers slow down
      this.pump();
      return;
    }
    this.paused = true;
    this.clearTimer("check");
    this.clearTimer("retry");
    safely("pause", () => {
      const now = g.ctx.currentTime;
      holdAt(g.master.gain, now);
      g.master.gain.linearRampToValueAtTime(0, now + HIDE_FADE_S);
    });
    this.clearTimer("pause");
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      if (!this.paused) return;
      for (const layer of this.layers.values()) layer.pauseMedia();
      try {
        void g.ctx.suspend().catch(() => undefined);
      } catch {
        // already suspended
      }
      this.stopPump();
    }, HIDE_FADE_S * 1000 + 50);
    this.refresh();
  }

  private onVisible(): void {
    const g = this.g;
    if (!g || !this.on) return;
    safely("return", () => {
      if (this.paused) {
        this.paused = false;
        this.clearTimer("pause");
        for (const layer of this.layers.values()) layer.playMedia();
        this.wake(RETURN_FADE_S);
        this.startPump();
      } else if (g.ctx.state !== "running") {
        // it played on while hidden, but the phone may have interrupted it
        this.wake(RETURN_FADE_S);
      }
      this.pump();
      this.refresh();
      this.scheduleRetry();
      if (this.sleepAtMs !== null) this.applySleep();
    });
  }

  private onStateChange(ctx: AudioContext): void {
    if (this.g?.ctx !== ctx || !this.on || this.paused) return;
    const state = ctx.state as string;
    if (state === "running") {
      if (this.blocked) {
        this.blocked = false;
        this.refresh();
      }
    } else if (state === "interrupted") {
      this.blocked = true;
      this.refresh();
    } else if (state === "suspended") {
      // suspended by the browser, not by the engine (it only suspends when off or paused): try to come back
      try {
        void ctx.resume().catch(() => undefined);
      } catch {
        // checked below
      }
      this.checkRunning();
    }
  }

  /** In a moment, if the context still is not running (or its clock stands still), ask for a tap. */
  private checkRunning(attempt = 1): void {
    const g = this.g;
    if (!g) return;
    this.clearTimer("check");
    const from = g.ctx.currentTime;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (!this.on || this.paused || this.g !== g) return;
      const running = g.ctx.state === "running";
      const stalled = running && g.ctx.currentTime === from && typeof document !== "undefined" && !document.hidden;
      if ((stalled || !running) && attempt < RUN_CHECKS) {
        this.checkRunning(attempt + 1);
        return;
      }
      const blocked = !running || stalled;
      if (blocked !== this.blocked) {
        this.blocked = blocked;
        this.refresh();
      }
    }, CHECK_MS);
  }

  // ---- the sleep timer -----------------------------------------------------------------------------------------------

  /** Places the sleep ramp and its end on the audio clock, from the wall-clock time asked for. */
  private applySleep(): void {
    const g = this.g;
    const atMs = this.sleepAtMs;
    if (!g || atMs === null || !this.on) return;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    const remaining = (atMs - Date.now()) / 1000;
    if (remaining <= 0.05) {
      this.stop(SLEEP_LATE_FADE_S);
      return;
    }
    const at = now + remaining;
    const fade = this.sleepFadeS;
    const level = (t: number) => clamp01((at - t) / fade);
    const p = g.sleep.gain;
    holdAt(p, now);
    const settle = Math.min(now + 0.5, at);
    p.linearRampToValueAtTime(level(settle), settle);
    if (at - fade > settle) p.setValueAtTime(1, at - fade);
    if (at > settle) p.linearRampToValueAtTime(0, at);

    this.cancelSleep();
    const token = ++this.sleepToken;
    const end = () => {
      if (token !== this.sleepToken) return;
      this.sleepNode = null;
      this.sleepTimer = null;
      if (this.on) this.stop(0.2);
    };
    if (typeof ctx.createConstantSource === "function") {
      const node = ctx.createConstantSource();
      node.offset.value = 0;
      node.connect(g.sleep);
      node.onended = () => {
        node.disconnect();
        end();
      };
      node.start(now);
      node.stop(at);
      this.sleepNode = node;
    } else {
      this.sleepTimer = setTimeout(end, remaining * 1000);
    }
  }

  private cancelSleep(): void {
    this.sleepToken++;
    const node = this.sleepNode;
    this.sleepNode = null;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already ended
      }
      node.disconnect();
    }
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
  }

  /** Brings the sleep gain back to full over `seconds`. */
  private restoreSleepGain(seconds: number): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    holdAt(g.sleep.gain, now);
    g.sleep.gain.linearRampToValueAtTime(1, now + Math.max(0.01, seconds));
  }

  // ---- scheduling ahead ----------------------------------------------------------------------------------------------

  private startPump(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
  }

  private stopPump(): void {
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
  }

  private pump(): void {
    const g = this.g;
    if (!g) return;
    try {
      const now = g.ctx.currentTime;
      // a block the browser lifted without telling us (the clock is moving again): the sound is back
      if (this.blocked && this.on && !this.paused && g.ctx.state === "running" && now > this.lastClock) {
        this.blocked = false;
        this.refresh();
      }
      this.lastClock = now;
      const horizon = typeof document !== "undefined" && document.hidden ? HIDDEN_LOOKAHEAD_S : LOOKAHEAD_S;
      for (const layer of this.layers.values()) layer.pump(now, horizon);
      g.shots.pump(now, horizon);
    } catch (error) {
      this.warnOnce("pump", "scheduling failed", error);
    }
  }

  // ---- status ------------------------------------------------------------------------------------------------------

  private refresh(): void {
    const loading: string[] = [];
    let sounding = false;
    for (const layer of this.layers.values()) {
      if (layer.state === "loading") loading.push(layer.key);
      else if (layer.state === "playing" || layer.state === "leaving") sounding = true;
    }
    const failed = this.failedNow();
    let status: EngineStatus;
    if (!this.on) status = "idle";
    else if (this.paused) status = "paused";
    else if (this.blocked || this.refusals.size > 0) status = "blocked";
    else if (!sounding && loading.length > 0) status = "starting";
    // nothing in the mix could load: say so, so a tap can try again, rather than "playing" over silence
    else if (!sounding && failed.length > 0) status = "blocked";
    else status = "playing";
    const loadingChanged = !sameList(loading, this.loadingKeys);
    const failedChanged = !sameList(failed, this.failedKeys);
    if (loadingChanged) this.loadingKeys = loading;
    if (failedChanged) this.failedKeys = failed;
    const statusChanged = status !== this.current;
    if (!statusChanged && !loadingChanged && !failedChanged) return;
    this.current = status;
    if (statusChanged) this.showMediaSession();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("[garden-sound] a listener failed", error);
      }
    }
  }

  private showMediaSession(): void {
    try {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
      const session = navigator.mediaSession;
      if (!this.mediaSessionReady) {
        this.mediaSessionReady = true;
        const handlers: [MediaSessionAction, () => void][] = [
          ["play", () => this.fromLockScreen("play")],
          ["pause", () => this.fromLockScreen("stop")],
          ["stop", () => this.fromLockScreen("stop")],
        ];
        for (const [action, handler] of handlers) {
          try {
            session.setActionHandler(action, handler);
          } catch {
            // an action this browser does not know
          }
        }
      }
      const status = this.current;
      if (status === "idle" && !this.lockScreenPaused) {
        // turned off in the garden: the garden is no longer what the phone is playing
        session.metadata = null;
        this.shownTitle = null;
        session.playbackState = "none";
        return;
      }
      const on = status === "playing" || status === "starting";
      if (on && this.shownTitle !== this.title && typeof MediaMetadata !== "undefined") {
        session.metadata = new MediaMetadata({ title: this.title, artist: ARTIST });
        this.shownTitle = this.title;
      }
      session.playbackState = on ? "playing" : "paused";
    } catch {
      // the lock screen is a nicety
    }
  }

  /**
   * The lock screen's (or a headset's) buttons. Pause and stop turn the sound off and keep the lock screen's card, so
   * its play can bring the sound back; play does nothing unless the sound is on or the lock screen paused it.
   */
  private fromLockScreen(action: "play" | "stop"): void {
    safely("lock screen", () => {
      if (action === "play") {
        if (this.on || this.lockScreenPaused) this.resume();
        return;
      }
      if (!this.on) return;
      this.lockScreenPaused = true;
      this.halt(STOP_FADE_S);
    });
  }

  // ---- small things ------------------------------------------------------------------------------------------------

  private masterGain(): number {
    // squared, so the slider feels even: half way is about a quarter of the power, as ears expect
    return this.volume * this.volume;
  }

  private clearTimer(which: "stop" | "pause" | "check" | "retry"): void {
    const timers = { stop: this.stopTimer, pause: this.pauseTimer, check: this.checkTimer, retry: this.retryTimer };
    const timer = timers[which];
    if (timer) clearTimeout(timer);
    if (which === "stop") this.stopTimer = null;
    if (which === "pause") this.pauseTimer = null;
    if (which === "check") this.checkTimer = null;
    if (which === "retry") this.retryTimer = null;
  }

  private warnOnce(key: string, message: string, error?: unknown): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[garden-sound] ${message}`, error ?? "");
  }
}

let engine: GardenEngine | null = null;

/** The garden's one sound engine. Without a context (no tap yet, or no Web Audio) it stays idle and does nothing. */
export function getEngine(): Engine {
  if (!engine) {
    engine = new GardenEngine();
    expose(engine);
  }
  return engine;
}

/** A handle for tests and the console, outside production or with ?dev. */
function expose(e: GardenEngine): void {
  if (typeof window === "undefined") return;
  try {
    const dev = process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("dev");
    if (!dev) return;
    (window as unknown as { __gardenSound?: unknown }).__gardenSound = {
      engine: e,
      get context() {
        return audioContext();
      },
      layers: () => e.describe(),
      loader: e.loader,
    };
  } catch {
    // a convenience only
  }
}
