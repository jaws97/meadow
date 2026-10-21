"use client";
// The party trailer's music (score.ts), played with Web Audio: synthesised as it plays, over recorded beds (beds.ts).
// The music box (a few sine partials, struck and ringing down), the pad (detuned triangles through a soft low-pass,
// slow to swell and to fade) and the bass go into a `music` bus at the levels the garden's music box shares; the
// trailer's own voices (a soft sub boom with tanh harmonics, a heartbeat pulse, a reversed swell, a whoosh and a riser
// of filtered noise, the title's glass shimmer, the wind-up clicks, the lantern's fwoomp, the seed's pft) go into an
// `fx` bus, and the recordings into a `beds` bus. Two halls are made on the spot from seeded noise (today's 3.4 s and
// a 5.5 s long hall for the title). Every bus and both halls feed one `choke`, so a silence in the score silences the
// tails too; then `master`, which M, the closing fade and a stop act on, so they cover everything; then a gentle glue
// compressor, a limiter and a tanh safety clipper before the speakers, so the venue's PA never hears a clip.
//
// The trailer's clock leads and the music follows: each frame the director tells it where the trailer is and how fast
// its clock is running against the wall clock, and the notes due in the next moment are scheduled from there, spaced
// to that pace and started early by the output's own latency, so a pause at a gate or a slow laptop never puts them
// out of step with the picture (nothing past the next gate is scheduled until the clock moves on). The beds' levels,
// the can's slow-motion water, the riser into the last black and the crickets come from one `mix` of the trailer's
// frame, applied at most every MIX_S. A recording that has not arrived is left out (rain and crickets have a synth
// stand-in, never played on top of the recording). It starts in the click or key press that starts the trailer
// (browsers allow sound only from one): the music box is wound, a soft Dadd9 and the dawn birds come in under the
// first black, and it fades out over the return to the party screen, or within a second when the trailer is stopped.
// M mutes it, `?music=off` leaves it out. The same graph, voices and mix render the whole trailer offline, beds and
// gate holds included, for a preview to listen to away from the screen.
import { bedBuffer, prefetchBeds, type BedKey } from "@/components/party/trailer/beds";
import {
  BED_CUES,
  bedGain,
  CALLS,
  dbToGain,
  FADE_FROM,
  FADE_S,
  INTRO,
  SCORE,
  type BedCue,
  type Call,
  type Duck,
  type Note,
} from "@/components/party/trailer/score";
import { blankFrame, GATES, linear, trailerAt, type TrailerFrame } from "@/components/party/trailer/script";
import { Rng } from "@/lib/plant/prng";

/** The offline preview's options: the first black's length (s), each gate's hold (s, one for all or one per gate), and the trailer's pace. */
export interface PreviewOptions {
  intro?: number;
  holds?: number | readonly number[];
  rate?: number;
}

/** What the offline preview made: the WAV, and how loud it got before the WAV's clamp. */
export interface PreviewResult {
  wav: Blob;
  /** the render's length (s) */
  seconds: number;
  /** the highest sample out of the safety clipper, linear and in dBFS, and how many samples went past 1 */
  peak: number;
  peakDb: number;
  clipped: number;
  /** the highest sample out of the limiter, before the safety clipper (dBFS) */
  limiterPeakDb: number;
}

/** How far ahead of the trailer's clock notes are scheduled (s of audio). */
const LOOKAHEAD = 0.2;
/** A note due this long before the trailer's clock (s) is dropped rather than played out of time (a dev seek). */
const LATE_S = 0.25;
/** The level into the master chain. */
const MASTER = 0.9;
/** Each part's level: the music's voices (as the garden's music box has them), the buses, the halls' wet levels. */
const LEVEL = { bell: 0.2, pad: 0.075, bass: 0.15, fx: 0.25, beds: 0.8, hall: 0.55, longHall: 0.5 } as const;
/** Each music voice's send to the hall. */
const SEND = { bell: 0.5, pad: 0.9, bass: 0.3 } as const;
/** The halls' lengths (s), and the seconds of noise the voices draw on. */
const HALL_S = 3.4;
const LONG_HALL_S = 5.5;
const NOISE_S = 2.5;
/** A pad's swell and fade (s). */
const PAD_IN = 2.2;
const PAD_OUT = 2.8;
/** The first black's pad is held open this long (s) at most; the first frame fades it. */
const INTRO_HOLD_S = 600;
/** The black at the start of the trailer is about this long before its clock starts (s), and each gate holds this long, for the offline preview. */
const PREVIEW_INTRO_S = 5;
const PREVIEW_HOLD_S = 0.35;
/** The offline preview renders at the recordings' own rate (Hz), and lights its frames for a golden hour about this (h). */
const PREVIEW_RATE = 48000;
const PREVIEW_GOLDEN = 17.45;
/** The slowest pace the scheduling follows (the director's measure is clamped to 0.5..1). */
const RATE_MIN = 0.5;
/** Everything scheduled starts earlier by the output's latency, up to this (s), so it meets the picture. */
const LATENCY_MAX = 0.15;
/** The beds, the riser and the crickets are set at most this often (s of audio), each level easing with its own time constant. */
const MIX_S = 0.1;
const BED_TAU = 0.12;
const RISER_TAU = MIX_S / 3;
/** A level under this is silent (a bed not yet cued). */
const SILENT = 1e-3;
/** A riser holds its peak this long after its end (s of trailer time), under the choke that ends it, then stops. */
const RISER_TAIL = 0.3;
/** A choke falls with this time constant (s) and comes back over this ramp (s). */
const CHOKE_TAU = 0.012;
const CHOKE_BACK_S = 0.005;
/** The glue compressor and the limiter after master. */
const GLUE = { threshold: -20, knee: 10, ratio: 2, attack: 0.03, release: 0.3 } as const;
const LIMIT = { threshold: -6, knee: 1, ratio: 20, attack: 0.002, release: 0.15 } as const;
/**
 * The safety clipper: straight up to SAFE_KNEE (about -2 dBFS, where the limiter leaves the peaks), then soft (tanh)
 * toward SAFE_CEILING (about -1 dBFS), for input up to SAFE_RANGE.
 */
const SAFE_KNEE = 0.8;
const SAFE_CEILING = 0.89;
const SAFE_RANGE = 2;
/** The tanh drive that gives the boom and the pulse their audible harmonics. */
const DRIVE = 2;
/** A recorded bed plays as two copies, panned apart and kept half its loop apart, each at 1/√2 so the pair sounds as loud as the file. */
const SPREAD = [-0.45, 0.45] as const;
const COPY = Math.SQRT1_2;
/**
 * The synth stand-ins' level per unit of their bed's level (rain-light 0.5 × rain gives the garden's old hiss at 0.05 ×
 * rain; the crickets' 0.24 their old 0.014), after the beds bus.
 */
const STAND_IN: Partial<Record<BedKey, number>> = { "rain-light": 0.05 / 0.5 / LEVEL.beds, "night-crickets": 0.014 / 0.24 / LEVEL.beds };
/** The seed of every random number the trailer's sound draws (noise, halls, crickets, where a bed starts), so renders repeat. */
const SEED = "party-trailer";

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

interface BedPlayer {
  cue: BedCue;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  /** its last cue is over and its sources are stopping */
  done: boolean;
}

interface RiserVoice {
  band: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode;
}

interface Graph {
  ctx: BaseAudioContext;
  rng: Rng;
  master: GainNode;
  /** the glue compressor, the limiter, the clipper's input gain and the clipper, in order */
  chain: AudioNode[];
  limiter: DynamicsCompressorNode;
  choke: GainNode;
  /** the level the choke was last sent to */
  chokeLevel: number;
  music: GainNode;
  musicSend: GainNode;
  bells: GainNode;
  pads: GainNode;
  bass: GainNode;
  fx: GainNode;
  hall: ConvolverNode;
  longHall: ConvolverNode;
  beds: GainNode;
  /** the long beds pass through this, which the score's ducks dip; calls go round it */
  bedDuck: GainNode;
  /** the stand-ins: a soft hiss for the rain and two crickets */
  rain: GainNode;
  crickets: GainNode;
  chirps: GainNode[];
  nextChirp: number[];
  noise: AudioBuffer;
  /** every long-running source, which teardown stops */
  sources: AudioScheduledSourceNode[];
  /** each long bed this run: playing its recording, standing in with a synth, or not decided until its first cue */
  bedState: Map<BedKey, BedPlayer | "synth">;
  /** each riser of the score: playing, or over */
  risers: Map<number, RiserVoice | "done">;
  /** when the mix was last applied (s of audio) */
  lastMix: number;
}

// ---- buffers and curves, made once ------------------------------------------------------------------------------------

const buffers = new Map<string, AudioBuffer>();

/** A hall's impulse: seeded noise decaying over `seconds`, kept per sample rate (a convolver needs its context's). */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const key = `hall:${ctx.sampleRate}:${seconds}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    const rng = new Rng(`${SEED}:hall:${seconds}`);
    const length = Math.floor(ctx.sampleRate * seconds);
    buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (rng.next() * 2 - 1) * Math.pow(1 - i / length, 2.8);
    }
    buffers.set(key, buffer);
  }
  return buffer;
}

/** Seeded white noise for the voices that need it. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const key = `noise:${ctx.sampleRate}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    const rng = new Rng(`${SEED}:noise`);
    const length = Math.floor(ctx.sampleRate * NOISE_S);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = rng.next() * 2 - 1;
    buffers.set(key, buffer);
  }
  return buffer;
}

/** A WaveShaper curve over -1..1 of `f`. */
function curve(points: number, f: (x: number) => number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) out[i] = f((i / (points - 1)) * 2 - 1);
  return out;
}

/** The boom's and pulse's saturation: tanh at DRIVE, normalised so full scale stays full scale. */
const DRIVE_CURVE = curve(1025, (x) => Math.tanh(DRIVE * x) / Math.tanh(DRIVE));
/** The safety clipper (its input is scaled down by SAFE_RANGE first): straight, then a tanh knee to the ceiling. */
const SAFETY_CURVE = curve(4097, (x) => {
  const v = x * SAFE_RANGE;
  const a = Math.abs(v);
  if (a <= SAFE_KNEE) return v;
  return Math.sign(v) * (SAFE_KNEE + (SAFE_CEILING - SAFE_KNEE) * Math.tanh((a - SAFE_KNEE) / (SAFE_CEILING - SAFE_KNEE)));
});

// ---- the graph ---------------------------------------------------------------------------------------------------------

function gainNode(ctx: BaseAudioContext, value: number, to?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  if (to) g.connect(to);
  return g;
}

function compressor(ctx: BaseAudioContext, p: typeof GLUE | typeof LIMIT): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = p.threshold;
  c.knee.value = p.knee;
  c.ratio.value = p.ratio;
  c.attack.value = p.attack;
  c.release.value = p.release;
  return c;
}

function build(ctx: BaseAudioContext, out: AudioNode): Graph {
  const rng = new Rng(SEED);
  // master, then the glue compressor, the limiter and the safety clipper
  const glue = compressor(ctx, GLUE);
  const limiter = compressor(ctx, LIMIT);
  const safeIn = gainNode(ctx, 1 / SAFE_RANGE);
  const safety = ctx.createWaveShaper();
  safety.curve = SAFETY_CURVE;
  safety.oversample = "4x";
  glue.connect(limiter).connect(safeIn).connect(safety).connect(out);
  const master = gainNode(ctx, 0, glue);
  const choke = gainNode(ctx, 1, master);

  const hall = ctx.createConvolver();
  hall.buffer = impulse(ctx, HALL_S);
  hall.connect(gainNode(ctx, LEVEL.hall, choke));
  const longHall = ctx.createConvolver();
  longHall.buffer = impulse(ctx, LONG_HALL_S);
  longHall.connect(gainNode(ctx, LEVEL.longHall, choke));

  // the music: each voice's bus into `music`, its hall send into `musicSend`, which a duck dips with it
  const music = gainNode(ctx, 1, choke);
  const musicSend = gainNode(ctx, 1, hall);
  const voiceBus = (level: number, send: number) => {
    const g = gainNode(ctx, level, music);
    g.connect(gainNode(ctx, send, musicSend));
    return g;
  };
  const bells = voiceBus(LEVEL.bell, SEND.bell);
  const pads = voiceBus(LEVEL.pad, SEND.pad);
  const bass = voiceBus(LEVEL.bass, SEND.bass);
  const fx = gainNode(ctx, LEVEL.fx, choke);
  const beds = gainNode(ctx, LEVEL.beds, choke);
  const bedDuck = gainNode(ctx, 1, beds);

  // the rain's stand-in: noise between a high-pass and a low-pass
  const noise = noiseBuffer(ctx);
  const sources: AudioScheduledSourceNode[] = [];
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6500;
  const rain = gainNode(ctx, 0, bedDuck);
  hiss.connect(hp).connect(lp).connect(rain);
  hiss.start();
  sources.push(hiss);

  // the crickets' stand-in, left and right: a steady tone each, pulsed by its own gain
  const crickets = gainNode(ctx, 0, bedDuck);
  const chirps = [4400, 4950].map((f, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = gainNode(ctx, 0);
    const pan = ctx.createStereoPanner();
    pan.pan.value = i === 0 ? -0.6 : 0.55;
    osc.connect(g).connect(pan).connect(crickets);
    osc.start();
    sources.push(osc);
    return g;
  });

  return {
    ctx,
    rng,
    master,
    chain: [glue, limiter, safeIn, safety],
    limiter,
    choke,
    chokeLevel: 1,
    music,
    musicSend,
    bells,
    pads,
    bass,
    fx,
    hall,
    longHall,
    beds,
    bedDuck,
    rain,
    crickets,
    chirps,
    nextChirp: [0, 0],
    noise,
    sources,
    bedState: new Map(),
    risers: new Map(),
    lastMix: -Infinity,
  };
}

/** Disconnects `nodes` (and the sources) once every one of `sources` has ended. */
function release(sources: readonly AudioScheduledSourceNode[], nodes: readonly AudioNode[]) {
  let left = sources.length;
  for (const s of sources)
    s.onended = () => {
      if (--left > 0) return;
      for (const src of sources) src.disconnect();
      for (const n of nodes) n.disconnect();
    };
}

/** An fx voice's output: into the fx bus, with a send (at the bus's level) into a hall. */
function fxOut(g: Graph, send: number, hall: AudioNode = g.hall): GainNode[] {
  const out = gainNode(g.ctx, 1, g.fx);
  if (send <= 0) return [out];
  const s = gainNode(g.ctx, send * LEVEL.fx, hall);
  out.connect(s);
  return [out, s];
}

/** A stretch of the noise buffer, from a seeded place in it. */
function noiseSource(g: Graph, loop = false): AudioBufferSourceNode {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = loop;
  return src;
}
const noiseAt = (g: Graph) => g.rng.next() * (NOISE_S - 0.5);

// ---- the voices ----------------------------------------------------------------------------------------------------

/** A struck music-box note: a few partials, the upper ones ringing down sooner. */
function strike(g: Graph, midi: number, when: number, vel: number, dur: number) {
  const { ctx } = g;
  const f = hz(midi);
  const ring = Math.min(4.5, 1.2 + dur * 0.9);
  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp((midi - 80) / 24, -0.5, 0.5);
  pan.connect(g.bells);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2, 0.3, 0.5],
    [3, 0.11, 0.32],
    [4.16, 0.06, 0.2],
  ];
  const oscs: OscillatorNode[] = [];
  const nodes: AudioNode[] = [pan];
  for (const [ratio, amp, share] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const env = ctx.createGain();
    const end = when + ring * share;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel * amp, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(pan);
    osc.start(when);
    osc.stop(end + 0.05);
    oscs.push(osc);
    nodes.push(env);
  }
  release(oscs, nodes);
}

/** A pad chord (up to eight notes): two detuned triangles a note through a soft low-pass, swelling in and fading out. Returns its fade. */
function pad(g: Graph, midi: readonly number[], when: number, vel: number, dur: number): (at: number) => void {
  const { ctx } = g;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 950;
  filter.Q.value = 0.4;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.setTargetAtTime(vel / Math.sqrt(midi.length), when, PAD_IN / 3);
  filter.connect(env).connect(g.pads);
  const oscs: OscillatorNode[] = [];
  for (const m of midi) {
    for (const cents of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz(m);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(when);
      oscs.push(osc);
    }
  }
  release(oscs, [filter, env]);
  const fade = (at: number) => {
    env.gain.cancelScheduledValues(at);
    env.gain.setTargetAtTime(0, at, PAD_OUT / 4);
    for (const o of oscs) {
      try {
        o.stop(at + PAD_OUT * 1.6);
      } catch {
        // an earlier stop stands
      }
    }
  };
  fade(when + dur);
  return fade;
}

/** A bass note: a sine, swelling in and fading. */
function low(g: Graph, midi: number, when: number, vel: number, dur: number) {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.frequency.value = hz(midi);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.setTargetAtTime(vel, when, 0.2);
  env.gain.setTargetAtTime(0, when + dur, 0.7);
  osc.connect(env).connect(g.bass);
  osc.start(when);
  osc.stop(when + dur + 3.5);
  release([osc], [env]);
}

/** Noise and a chord's tones each feed the swell this much (the tones shared between them by √n). */
const SWELL_NOISE = 0.35;
const SWELL_TONES = 0.6;

/** A reversed swell: noise and the chord's tones through a low-pass opening up, growing to `vel` at its end, then cut. */
function swell(g: Graph, midi: readonly number[], when: number, vel: number, dur: number) {
  const { ctx } = g;
  const end = when + dur;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(300, when);
  filter.frequency.exponentialRampToValueAtTime(4000, end);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(vel, end);
  env.gain.linearRampToValueAtTime(0, end + 0.03);
  const outs = fxOut(g, 0.9);
  filter.connect(env).connect(outs[0]);
  const src = noiseSource(g, true);
  const n = gainNode(ctx, SWELL_NOISE, filter);
  src.connect(n);
  src.start(when, noiseAt(g));
  src.stop(end + 0.05);
  const sources: AudioScheduledSourceNode[] = [src];
  const nodes: AudioNode[] = [filter, env, n, ...outs];
  const tones = gainNode(ctx, SWELL_TONES / Math.sqrt(Math.max(1, midi.length)), filter);
  nodes.push(tones);
  for (const m of midi) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz(m);
    osc.connect(tones);
    osc.start(when);
    osc.stop(end + 0.05);
    sources.push(osc);
  }
  release(sources, nodes);
}

/** A whoosh into a dip: noise through a band-pass sweeping up, growing to `vel` as it crosses the stereo field, then cut. */
function whoosh(g: Graph, when: number, vel: number, dur: number) {
  const { ctx } = g;
  const end = when + dur;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 2;
  band.frequency.setValueAtTime(350, when);
  band.frequency.exponentialRampToValueAtTime(6000, end);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(vel, end);
  env.gain.setTargetAtTime(0, end, 0.03);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(-0.6, when);
  pan.pan.linearRampToValueAtTime(0.6, end);
  const outs = fxOut(g, 0.6);
  const src = noiseSource(g, true);
  src.connect(band).connect(env).connect(pan).connect(outs[0]);
  src.start(when, noiseAt(g));
  src.stop(end + 0.25);
  release([src], [band, env, pan, ...outs]);
}

/** The riser: the whoosh's graph, but set from the trailer's clock by the mix (setRiser), so a slow laptop cannot land it early. */
function riserVoice(g: Graph, when: number): RiserVoice {
  const { ctx } = g;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 2;
  band.frequency.value = 350;
  const gain = gainNode(ctx, 0.0001);
  const pan = ctx.createStereoPanner();
  pan.pan.value = -0.6;
  const outs = fxOut(g, 0.6);
  const src = noiseSource(g, true);
  src.connect(band).connect(gain).connect(pan).connect(outs[0]);
  src.start(when, noiseAt(g));
  g.sources.push(src);
  release([src], [band, gain, pan, ...outs]);
  return { band, gain, pan, src };
}

/** The boom's noise transient, against its body. */
const BOOM_CLICK = 0.4;

/** A soft sub boom: a falling sine through tanh for harmonics a laptop can play, low-passed, with a little noise on the hit. */
function boom(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(110, when);
  osc.frequency.exponentialRampToValueAtTime(42, when + 0.35);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(1, when + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
  const shaper = ctx.createWaveShaper();
  shaper.curve = DRIVE_CURVE;
  shaper.oversample = "2x";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 180;
  const amp = gainNode(ctx, vel);
  const outs = fxOut(g, 0.2);
  osc.connect(env).connect(shaper).connect(lp).connect(amp).connect(outs[0]);
  osc.start(when);
  osc.stop(when + 2.3);
  // the transient
  const src = noiseSource(g);
  const nlp = ctx.createBiquadFilter();
  nlp.type = "lowpass";
  nlp.frequency.value = 1200;
  const nenv = ctx.createGain();
  nenv.gain.setValueAtTime(0, when);
  nenv.gain.linearRampToValueAtTime(BOOM_CLICK, when + 0.002);
  nenv.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  src.connect(nlp).connect(nenv).connect(amp);
  src.start(when, noiseAt(g), 0.06);
  release([osc, src], [env, shaper, lp, amp, nlp, nenv, ...outs]);
}

/** The pulse's noise thump, against its body, and the dub's delay and level after the lub. */
const PULSE_THUMP = 0.35;
const DUB_S = 0.22;
const DUB_VEL = 0.7;

/** One beat of the heartbeat: a sine falling from 95 to 48 Hz through tanh, with a soft noise thump. */
function thump(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(95, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(1, when + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.45);
  const shaper = ctx.createWaveShaper();
  shaper.curve = DRIVE_CURVE;
  shaper.oversample = "2x";
  const amp = gainNode(ctx, vel);
  const outs = fxOut(g, 0.15);
  osc.connect(env).connect(shaper).connect(amp).connect(outs[0]);
  osc.start(when);
  osc.stop(when + 0.5);
  const src = noiseSource(g);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 300;
  const nenv = ctx.createGain();
  nenv.gain.setValueAtTime(0, when);
  nenv.gain.linearRampToValueAtTime(PULSE_THUMP, when + 0.001);
  nenv.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
  src.connect(lp).connect(nenv).connect(amp);
  src.start(when, noiseAt(g), 0.03);
  release([osc, src], [env, shaper, amp, lp, nenv, ...outs]);
}

/** A heartbeat: lub, then dub. */
function pulse(g: Graph, when: number, vel: number) {
  thump(g, when, vel);
  thump(g, when + DUB_S, vel * DUB_VEL);
}

/** The title's glass: inharmonic partials over the note, ringing `dur`, the upper ones sooner, into the long hall. */
function shimmer(g: Graph, midi: number, when: number, vel: number, dur: number) {
  const { ctx } = g;
  const outs = fxOut(g, 0.8, g.longHall);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.76, 0.4, 0.7],
    [5.4, 0.2, 0.5],
    [8.93, 0.1, 0.35],
  ];
  const oscs: OscillatorNode[] = [];
  const nodes: AudioNode[] = [...outs];
  for (const [ratio, amp, share] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = hz(midi) * ratio;
    const env = ctx.createGain();
    const end = when + dur * share;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel * amp, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(outs[0]);
    osc.start(when);
    osc.stop(end + 0.05);
    oscs.push(osc);
    nodes.push(env);
  }
  release(oscs, nodes);
}

/** A burst of noise through a filter, rising over `attack` and falling to nothing by `length` (s): the click, fwoomp and pft. */
function burst(g: Graph, when: number, vel: number, type: BiquadFilterType, freq: number, q: number, attack: number, length: number) {
  const { ctx } = g;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(vel, when + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, when + length);
  const outs = fxOut(g, 0);
  const src = noiseSource(g);
  src.connect(filter).connect(env).connect(outs[0]);
  src.start(when, noiseAt(g), length + 0.02);
  release([src], [filter, env, ...outs]);
}

/** The music box being wound: a tick of band-passed noise. */
const click = (g: Graph, when: number, vel: number) => burst(g, when, vel, "bandpass", 3200, 4, 0.001, 0.006);
/** The lantern catching: a soft low whisper of noise. */
const fwoomp = (g: Graph, when: number, vel: number) => burst(g, when, vel, "lowpass", 600, 0.7, 0.12, 0.42);
/** A seed's hop: the smallest puff. */
const pft = (g: Graph, when: number, vel: number) => burst(g, when, vel, "lowpass", 1500, 0.7, 0.002, 0.025);

/** Everything, halls included, to `level` (linear): down at once (a suck-out, the silence), back in a few milliseconds. */
function choke(g: Graph, when: number, level: number) {
  const p = g.choke.gain;
  p.cancelScheduledValues(when);
  if (level < g.chokeLevel) p.setTargetAtTime(level, when, CHOKE_TAU);
  else {
    p.setValueAtTime(g.chokeLevel, when);
    p.linearRampToValueAtTime(level, when + CHOKE_BACK_S);
  }
  g.chokeLevel = level;
}

/** The score's ducks: the music (and its hall send) and the long beds dipped, and back after `dur`. */
function duck(g: Graph, when: number, d: Duck, dur: number) {
  const dip = (p: AudioParam, db: number) => {
    p.cancelScheduledValues(when);
    p.setTargetAtTime(dbToGain(db), when, d.tauIn);
    p.setTargetAtTime(1, when + dur, d.tauOut);
  };
  if (d.music !== undefined) {
    dip(g.music.gain, d.music);
    dip(g.musicSend.gain, d.music);
  }
  if (d.beds !== undefined) dip(g.bedDuck.gain, d.beds);
}

/** One note of the score at `when` (s, audio clock), its held times stretched by `stretch` (1 / the trailer's pace). */
function sound(g: Graph, note: Note, when: number, stretch: number) {
  const v = note.vel;
  const dur = note.dur * stretch;
  switch (note.voice) {
    case "bell":
      return strike(g, note.midi[0], when, v, dur);
    case "pad":
      pad(g, note.midi, when, v, dur);
      return;
    case "bass":
      return low(g, note.midi[0], when, v, dur);
    case "swell":
      return swell(g, note.midi, when, v, dur);
    case "shimmer":
      return shimmer(g, note.midi[0], when, v, note.dur);
    case "boom":
      return boom(g, when, v);
    case "pulse":
      return pulse(g, when, v);
    case "whoosh":
      return whoosh(g, when, v, dur);
    case "riser":
      // played from the trailer's clock frame by frame (mix, setRiser): its note only marks its span
      return;
    case "click":
      return click(g, when, v);
    case "fwoomp":
      return fwoomp(g, when, v);
    case "pft":
      return pft(g, when, v);
    case "choke":
      return choke(g, when, v);
    case "duck":
      if (note.duck) duck(g, when, note.duck, dur);
      return;
    default: {
      const never: never = note.voice;
      throw new Error(`no voice ${String(never)}`);
    }
  }
}

/** A recorded call, once, at `when`: round the beds' duck, so it sings over a hush. */
function call(g: Graph, c: Call, when: number) {
  const buffer = bedBuffer(c.key);
  if (!buffer) return;
  const { ctx } = g;
  const length = c.to - c.from;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const env = ctx.createGain();
  env.gain.setValueAtTime(c.vel, when);
  env.gain.setTargetAtTime(0, when + length - 0.12, 0.04);
  const pan = ctx.createStereoPanner();
  pan.pan.value = c.pan;
  src.connect(env).connect(pan).connect(g.beds);
  src.start(when, c.from, Math.min(length + 0.15, buffer.duration - c.from));
  release([src], [env, pan]);
}

/** One chirping: three quick pulses on a cricket's gain. */
function chirp(gain: GainNode, at: number) {
  for (let k = 0; k < 3; k++) {
    const t = at + k * 0.065;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.012);
    gain.gain.linearRampToValueAtTime(0, t + 0.035);
  }
}

// ---- the mix: the beds, the riser and the crickets from the trailer's frame ------------------------------------------

/** What the mix sets at a moment of the trailer. */
export interface Mix {
  /** each long bed's level (BED_CUES order, linear before the beds bus) and playback rate */
  beds: number[];
  rates: number[];
  /** the riser sounding (its index in RISERS, or -1), and how far through it is (0..1) */
  riser: number;
  riserS: number;
}

/** The score's risers, which the mix plays. */
const RISERS: readonly Note[] = SCORE.filter((n) => n.voice === "riser");
/** When each long bed's last cue is over (trailer s). */
const BED_ENDS: readonly number[] = BED_CUES.map((cue) =>
  Math.max(...[cue.keys, cue.perWind, cue.perRain, cue.perNight].map((k) => (k && k.length > 0 ? k[k.length - 1][0] : -Infinity))),
);

export function blankMix(): Mix {
  return { beds: BED_CUES.map(() => 0), rates: BED_CUES.map(() => 1), riser: -1, riserS: 0 };
}

/** The trailer's beds, riser and crickets at time t, for its frame and the sky's nightness. Shared by the player and the preview. */
export function mix(t: number, frame: Readonly<Pick<TrailerFrame, "wind" | "rain">>, nightness: number, out: Mix = blankMix()): Mix {
  BED_CUES.forEach((cue, i) => {
    out.beds[i] = bedGain(cue, t, frame.wind, frame.rain, nightness);
    out.rates[i] = cue.rate ? linear(cue.rate, t) : 1;
  });
  out.riser = RISERS.findIndex((n) => t >= n.t && t < n.t + n.dur + RISER_TAIL);
  out.riserS = out.riser < 0 ? 0 : clamp((t - RISERS[out.riser].t) / RISERS[out.riser].dur, 0, 1);
  return out;
}

/** Eases a level to `value` from `now` (cancelling what was set before, so nothing piles up). */
function ease(p: AudioParam, value: number, now: number, tau: number) {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(value, now, tau);
}

/** Starts a recorded bed (silent until the mix brings it in): two looping copies, half its loop apart, panned apart. */
function startBed(g: Graph, cue: BedCue, buffer: AudioBuffer, now: number): BedPlayer {
  const { ctx } = g;
  const gain = gainNode(ctx, 0);
  const nodes: AudioNode[] = [gain];
  if (cue.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cue.lowpass;
    gain.connect(lp).connect(g.bedDuck);
    nodes.push(lp);
  } else gain.connect(g.bedDuck);
  const first = g.rng.next() * buffer.duration;
  const sources = SPREAD.map((p, i) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p;
    src.connect(pan).connect(gain);
    nodes.push(pan);
    src.start(now, (first + (i * buffer.duration) / 2) % buffer.duration);
    g.sources.push(src);
    return src;
  });
  release(sources, nodes);
  return { cue, gain, sources, done: false };
}

/** The riser at `s` (0..1) through its span: up from 350 Hz to 6 kHz, from nothing to `vel`, left to right. */
function setRiser(voice: RiserVoice, s: number, vel: number, now: number) {
  ease(voice.band.frequency, 350 * Math.pow(6000 / 350, s), now, RISER_TAU);
  ease(voice.gain.gain, 0.0001 * Math.pow(vel / 0.0001, s), now, RISER_TAU);
  ease(voice.pan.pan, -0.6 + 1.2 * s, now, RISER_TAU);
}

/** Applies a mix at `now` (s, audio clock), at trailer time `t`. */
function applyMix(g: Graph, m: Mix, now: number, t: number) {
  let rain = 0;
  let crickets = 0;
  BED_CUES.forEach((cue, i) => {
    const level = m.beds[i];
    let state = g.bedState.get(cue.key);
    if (state === undefined) {
      if (level <= SILENT) return;
      // its first cue: the recording if it has arrived; else its stand-in for the whole run (never both), or, with no
      // stand-in, nothing until it arrives
      const buffer = bedBuffer(cue.key);
      if (buffer) state = startBed(g, cue, buffer, now);
      else if (STAND_IN[cue.key] !== undefined) state = "synth";
      else return;
      g.bedState.set(cue.key, state);
    }
    if (state === "synth") {
      const v = level * (STAND_IN[cue.key] ?? 0);
      if (cue.key === "rain-light") rain = v;
      else crickets = v;
      return;
    }
    if (state.done) return;
    ease(state.gain.gain, level * COPY, now, BED_TAU);
    if (cue.rate) for (const src of state.sources) ease(src.playbackRate, m.rates[i], now, BED_TAU);
    if (t > BED_ENDS[i] + 1 && level <= SILENT) {
      state.done = true;
      for (const src of state.sources) src.stop(now + BED_TAU * 5);
    }
  });
  ease(g.rain.gain, rain, now, 0.4);
  ease(g.crickets.gain, crickets, now, 0.8);
  if (crickets > SILENT)
    g.chirps.forEach((gain, i) => {
      if (g.nextChirp[i] < now) g.nextChirp[i] = now + g.rng.next() * 0.6;
      while (g.nextChirp[i] < now + MIX_S + LOOKAHEAD) {
        chirp(gain, g.nextChirp[i]);
        g.nextChirp[i] += 0.7 + g.rng.next() * 0.7;
      }
    });
  // the riser: made on its first frame, set from the clock, stopped once its span (and the choke after it) is over
  for (const [i, voice] of g.risers)
    if (voice !== "done" && i !== m.riser) {
      ease(voice.gain.gain, 0, now, 0.03);
      voice.src.stop(now + 0.2);
      g.risers.set(i, "done");
    }
  if (m.riser >= 0 && g.risers.get(m.riser) !== "done") {
    let voice = g.risers.get(m.riser);
    if (voice === undefined || voice === "done") {
      voice = riserVoice(g, now);
      g.risers.set(m.riser, voice);
    }
    setRiser(voice, m.riserS, RISERS[m.riser].vel, now);
  }
}

// ---- the live player -----------------------------------------------------------------------------------------------

let context: AudioContext | null = null;
let graph: Graph | null = null;
let next = 0;
let nextCall = 0;
let introFade: ((at: number) => void) | null = null;
let fading = false;
let enabled = true;
let muted = false;
/** This run's can's last drips (s, from their nominal times; script pickCanPress), or null until the can is pressed. */
let dripOffsets: readonly number[] | null = null;
const mixed = blankMix();

const level = () => (muted ? 0 : MASTER);

/** The output's latency (s) where the browser reports it, up to LATENCY_MAX. */
function latency(ctx: BaseAudioContext): number {
  // an offline context has neither
  const c = ctx as BaseAudioContext & { outputLatency?: number; baseLatency?: number };
  return Math.min(LATENCY_MAX, (c.outputLatency || 0) + (c.baseLatency || 0));
}

/**
 * How far (s) a note is moved from its written time: a drip moves with this run's own drip, or is left out (null) if
 * that drip does not fall; with no drips set (the preview) it plays as written.
 */
function shiftOf(note: Note, offsets: readonly number[] | null): number | null {
  if (note.drip === undefined || offsets === null) return 0;
  return note.drip < offsets.length ? offsets[note.drip] : null;
}

function teardown(g: Graph, after: number) {
  window.setTimeout(() => {
    for (const s of g.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    g.master.disconnect();
    for (const n of g.chain) n.disconnect();
    if (graph === null && context?.state === "running") void context.suspend();
  }, after * 1000);
}

export const music = {
  /** `?music=off`: the trailer plays silent. */
  setEnabled(on: boolean) {
    enabled = on;
  },
  get enabled() {
    return enabled;
  },
  get muted() {
    return muted;
  },
  /** M: the music's level to nothing, or back. */
  setMuted(on: boolean) {
    muted = on;
    if (graph && !fading) graph.master.gain.setTargetAtTime(level(), graph.ctx.currentTime, 0.3);
  },

  /**
   * In the click or key press that starts the trailer: the music box is wound, a soft Dadd9 and the dawn birds come in
   * under the first black.
   */
  begin() {
    if (!enabled) return;
    // in case the party screen's idle fetch has not run (or failed): anything that arrives in time is played
    void prefetchBeds();
    try {
      context ??= new AudioContext({ latencyHint: "playback" });
      if (context.state === "suspended") void context.resume();
      if (graph) teardown(graph, 0);
      const g = build(context, context.destination);
      graph = g;
      next = 0;
      nextCall = 0;
      fading = false;
      dripOffsets = null;
      const now = context.currentTime;
      g.master.gain.setValueAtTime(0, now);
      g.master.gain.linearRampToValueAtTime(level(), now + 0.05);
      introFade = pad(g, INTRO.pad, now + 0.05, INTRO.padVel, INTRO_HOLD_S);
      for (const c of INTRO.clicks) click(g, now + c.at, c.vel);
      startBirds(g, now);
    } catch (error) {
      // no sound on this machine: the trailer plays silent
      console.warn("[party] the trailer's music could not start", error);
      graph = null;
    }
  },

  /**
   * The can's last drips for this run, as offsets (s) from their nominal times (script DRIP_NOMINAL), one per drip
   * that falls; set by the director as the can's press is chosen. Each drip's note moves with it.
   */
  drips(offsets: readonly number[]) {
    dripOffsets = offsets;
  },
  /** The drip offsets last set (empty until the can is pressed). */
  get dripOffsets(): readonly number[] {
    return dripOffsets ?? [];
  },

  /**
   * Each frame while the trailer plays: where its clock is (s), its frame (script trailerAt), how dark it is (0..1),
   * the next gate, where the clock may wait (nothing past it is scheduled until the clock has moved on), and the
   * clock's pace against the wall clock (0.5..1; below 1 a slow device is stretching it).
   */
  play(t: number, frame: Readonly<TrailerFrame>, night: number, gate: number, rate: number) {
    const g = graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    if (introFade) {
      introFade(now + 0.5);
      introFade = null;
    }
    // a slow device stretches the trailer's clock: the notes ahead are spaced to its pace, and everything starts early
    // by the output's latency so it is heard with the picture
    const r = clamp(rate, RATE_MIN, 1);
    const lead = latency(g.ctx);
    const upTo = Math.min(t + (LOOKAHEAD + lead) * r, gate - 1e-3);
    while (next < SCORE.length) {
      const note = SCORE[next];
      const shift = shiftOf(note, dripOffsets);
      if (note.t + (shift ?? 0) > upTo) break;
      next++;
      if (shift === null || note.t + shift < t - LATE_S) continue;
      sound(g, note, now + Math.max(0, (note.t + shift - t) / r - lead), 1 / r);
    }
    while (nextCall < CALLS.length && CALLS[nextCall].t <= upTo) {
      const c = CALLS[nextCall++];
      if (c.t >= t - LATE_S) call(g, c, now + Math.max(0, (c.t - t) / r - lead));
    }
    if (now - g.lastMix >= MIX_S - 1e-4) {
      g.lastMix = now;
      // set to what is due as the next mix lands, so the riser meets the picture rather than trailing it
      applyMix(g, mix(t + (lead + MIX_S) * r, frame, night, mixed), now, t);
    }
    if (!fading && t >= FADE_FROM) {
      fading = true;
      g.master.gain.cancelScheduledValues(now);
      g.master.gain.setTargetAtTime(0, now, FADE_S / 4);
    }
  },

  /** The trailer is over or stopped: fade within `seconds`, then let the sound go. */
  end(seconds: number) {
    const g = graph;
    if (!g) return;
    graph = null;
    introFade = null;
    const now = g.ctx.currentTime;
    g.master.gain.cancelScheduledValues(now);
    g.master.gain.setTargetAtTime(0, now, Math.max(0.05, seconds / 4));
    teardown(g, seconds + 0.3);
  },
};

/** The dawn birds under the first black, coming in over INTRO.birds.over, if their recording has arrived. */
function startBirds(g: Graph, now: number) {
  const cue = BED_CUES.find((c) => c.key === "birds-garden");
  const buffer = bedBuffer("birds-garden");
  if (!cue || !buffer) return;
  const birds = startBed(g, cue, buffer, now);
  g.bedState.set(cue.key, birds);
  birds.gain.gain.setValueAtTime(0, now);
  birds.gain.gain.linearRampToValueAtTime(INTRO.birds.to * COPY, now + INTRO.birds.over);
}

// ---- the offline preview ---------------------------------------------------------------------------------------------

/**
 * The whole trailer's sound rendered offline at 48 kHz, as the trailer plays it, through the live player's graph,
 * voices and mix: the first black (`options.intro`, PREVIEW_INTRO_S by default) with the wind-up and the dawn birds,
 * then the trailer from its first frame at `options.rate` (1 by default) with each gate held `options.holds`
 * (PREVIEW_HOLD_S by default), the recordings included (fetched and decoded first if they have not been) and the
 * sky's nightness from `sky(t)`. Every random number is seeded, so two renders are the same. Returns the 16-bit
 * stereo WAV with its peak before the WAV's clamp (and the limiter's, before the safety clipper).
 */
export async function renderPreview(
  sky: (t: number) => { rain: number; night: number },
  length: number,
  options: PreviewOptions = {},
): Promise<PreviewResult> {
  await prefetchBeds();
  const intro = options.intro ?? PREVIEW_INTRO_S;
  const rate = clamp(options.rate ?? 1, RATE_MIN, 1);
  const holds = GATES.map((_, i) => (typeof options.holds === "number" ? options.holds : (options.holds?.[i] ?? PREVIEW_HOLD_S)));
  /** trailer time to audio time: the first black, the pace, and every gate held before it */
  const at = (t: number) => intro + t / rate + GATES.reduce((sum, gate, i) => (gate <= t ? sum + holds[i] : sum), 0);
  const seconds = at(length) + 1;
  // four channels: the mix (0, 1), and the limiter's output before the safety clipper (2, 3) to measure it
  const ctx = new OfflineAudioContext(4, Math.ceil(PREVIEW_RATE * seconds), PREVIEW_RATE);
  ctx.destination.channelInterpretation = "discrete";
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);
  const out = ctx.createChannelSplitter(2);
  out.connect(merger, 0, 0);
  out.connect(merger, 1, 1);
  const g = build(ctx, out);
  const tap = ctx.createChannelSplitter(2);
  g.limiter.connect(tap);
  tap.connect(merger, 0, 2);
  tap.connect(merger, 1, 3);

  g.master.gain.setValueAtTime(MASTER, 0);
  pad(g, INTRO.pad, 0.05, INTRO.padVel, intro + 0.45);
  for (const c of INTRO.clicks) click(g, c.at, c.vel);
  startBirds(g, 0);
  for (const note of SCORE) sound(g, note, at(note.t), 1 / rate);
  for (const c of CALLS) call(g, c, at(c.t));
  const frame = blankFrame();
  const m = blankMix();
  for (let t = 0; t < length; t += MIX_S * rate) {
    trailerAt(t, PREVIEW_GOLDEN, frame);
    applyMix(g, mix(t + MIX_S * rate, frame, sky(t).night, m), at(t), t);
  }
  g.master.gain.setTargetAtTime(0, at(FADE_FROM), FADE_S / 4);

  const audio = await ctx.startRendering();
  const peakOf = (channels: Float32Array[]) => {
    let peak = 0;
    let clipped = 0;
    for (const data of channels)
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
        if (a > 1) clipped++;
      }
    return { peak, clipped };
  };
  const mixData = [audio.getChannelData(0), audio.getChannelData(1)];
  const final = peakOf(mixData);
  const limited = peakOf([audio.getChannelData(2), audio.getChannelData(3)]);
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const result: PreviewResult = {
    wav: wav(mixData, audio.sampleRate),
    seconds,
    peak: final.peak,
    peakDb: db(final.peak),
    clipped: final.clipped,
    limiterPeakDb: db(limited.peak),
  };
  console.info(
    `[party] trailer preview: ${seconds.toFixed(1)} s, peak ${result.peakDb.toFixed(2)} dBFS (${result.clipped} samples past full scale), limiter ${result.limiterPeakDb.toFixed(2)} dBFS`,
  );
  return result;
}

function wav(data: readonly Float32Array[], sampleRate: number): Blob {
  const channels = data.length;
  const frames = data[0].length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  return new Blob([view.buffer], { type: "audio/wav" });
}
