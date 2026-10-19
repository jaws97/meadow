"use client";
// The party trailer's music (score.ts), played with Web Audio: no files, synthesised as it plays. A music box (a few
// sine partials, struck and ringing down), a pad (detuned triangles through a soft low-pass, slow to swell and to
// fade) and a bass, into a hall made on the spot (a convolver over a decaying noise burst); and under them, from the
// trailer's own frame, soft rain while the shower falls and two crickets once it is night.
//
// The trailer's clock leads and the music follows: each frame the director tells it where the trailer is, and the
// notes due in the next moment are scheduled from there, so a pause at a gate or a slow laptop never puts them out of
// step with the picture (at a gate nothing is scheduled ahead until the clock moves again). It starts in the click or
// key press that starts the trailer (browsers allow sound only from one), swelling in under the first black, and it
// fades out over the closing card, or within a second when the trailer is stopped. M mutes it, `?music=off` leaves
// it out. The same graph renders the whole score offline, for a preview to listen to away from the screen.
import { FADE_FROM, FADE_S, INTRO, SCORE, type Note } from "@/components/party/trailer/score";

/** How far ahead of the trailer's clock notes are scheduled (s). */
const LOOKAHEAD = 0.3;
/** The overall level, and each part's. */
const MASTER = 1.4;
const LEVEL = { bell: 0.2, pad: 0.075, bass: 0.15, rain: 0.05, crickets: 0.014, reverb: 0.55 } as const;
/** A pad's swell and fade (s). */
const PAD_IN = 2.2;
const PAD_OUT = 2.8;
/** The black at the start of the trailer is about this long before its clock starts (s), for the offline preview. */
const PREVIEW_INTRO_S = 5;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  bells: GainNode;
  pads: GainNode;
  bass: GainNode;
  rain: GainNode;
  crickets: GainNode;
  chirps: GainNode[];
  sources: AudioScheduledSourceNode[];
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.8);
  }
  return buffer;
}

function noise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function build(ctx: BaseAudioContext): Graph {
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -16;
  out.ratio.value = 3;
  out.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(out);

  const hall = ctx.createConvolver();
  hall.buffer = impulse(ctx, 3.4);
  const wet = ctx.createGain();
  wet.gain.value = LEVEL.reverb;
  hall.connect(wet).connect(master);

  const bus = (level: number, send: number) => {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(master);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(hall);
    return g;
  };
  const bells = bus(LEVEL.bell, 0.5);
  const pads = bus(LEVEL.pad, 0.9);
  const bass = bus(LEVEL.bass, 0.3);

  // soft rain: noise between a high-pass and a low-pass, its level following the trailer's shower
  const sources: AudioScheduledSourceNode[] = [];
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise(ctx, 2.5);
  hiss.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6500;
  const rain = ctx.createGain();
  rain.gain.value = 0;
  hiss.connect(hp).connect(lp).connect(rain).connect(master);
  hiss.start();
  sources.push(hiss);

  // two crickets, left and right: a steady tone each, pulsed by its own gain
  const crickets = ctx.createGain();
  crickets.gain.value = 0;
  crickets.connect(master);
  const chirps = [4400, 4950].map((f, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = i === 0 ? -0.6 : 0.55;
    osc.connect(g).connect(pan).connect(crickets);
    osc.start();
    sources.push(osc);
    return g;
  });

  return { ctx, master, bells, pads, bass, rain, crickets, chirps, sources };
}

/** A struck music-box note: a few partials, the upper ones ringing down sooner. */
function strike(g: Graph, midi: number, when: number, vel: number, dur: number) {
  const { ctx } = g;
  const f = hz(midi);
  const ring = Math.min(4.5, 1.2 + dur * 0.9);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-0.5, Math.min(0.5, (midi - 80) / 24));
  pan.connect(g.bells);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2, 0.3, 0.5],
    [3, 0.11, 0.32],
    [4.16, 0.06, 0.2],
  ];
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
  }
}

/** A pad chord: two detuned triangles a note through a soft low-pass, swelling in and fading out. Returns its fade. */
function swell(g: Graph, midi: readonly number[], when: number, vel: number, dur: number): (at: number) => void {
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
}

function sound(g: Graph, note: Note, when: number) {
  if (note.voice === "bell") strike(g, note.midi[0], when, note.vel, note.dur);
  else if (note.voice === "pad") swell(g, note.midi, when, note.vel, note.dur);
  else low(g, note.midi[0], when, note.vel, note.dur);
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

// ---- the live player -----------------------------------------------------------------------------------------------

let context: AudioContext | null = null;
let graph: Graph | null = null;
let next = 0;
let introFade: ((at: number) => void) | null = null;
let fading = false;
let nextChirp = [0, 0];
let enabled = true;
let muted = false;

const level = () => (muted ? 0 : MASTER);

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
    if (graph === null && context?.state === "running") void context.suspend();
  }, after * 1000);
}

export const music = {
  /** `?music=off`: the trailer plays silent. */
  setEnabled(on: boolean) {
    enabled = on;
  },
  get muted() {
    return muted;
  },
  /** M: the music's level to nothing, or back. */
  setMuted(on: boolean) {
    muted = on;
    if (graph && !fading) graph.master.gain.setTargetAtTime(level(), graph.ctx.currentTime, 0.3);
  },

  /** In the click or key press that starts the trailer: the home chord swells in under the first black. */
  begin() {
    if (!enabled) return;
    try {
      context ??= new AudioContext({ latencyHint: "playback" });
      if (context.state === "suspended") void context.resume();
      if (graph) teardown(graph, 0);
      const g = build(context);
      graph = g;
      next = 0;
      fading = false;
      nextChirp = [0, 0];
      const now = context.currentTime;
      g.master.gain.setValueAtTime(0, now);
      g.master.gain.linearRampToValueAtTime(level(), now + 2.5);
      introFade = swell(g, INTRO.pad, now + 0.05, 0.6, 600);
      strike(g, INTRO.bell, now + INTRO.bellAt, 0.34, 2.4);
    } catch (error) {
      // no sound on this machine: the trailer plays silent
      console.warn("[party] the trailer's music could not start", error);
      graph = null;
    }
  },

  /**
   * Each frame while the trailer plays: where its clock is (s), how hard it rains and how dark it is (0..1), and the
   * next gate, where the clock may wait (nothing past it is scheduled until the clock has moved on).
   */
  play(t: number, rain: number, night: number, gate: number) {
    const g = graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    if (introFade) {
      introFade(now + 0.5);
      introFade = null;
    }
    const upTo = Math.min(t + LOOKAHEAD, gate - 1e-3);
    while (next < SCORE.length && SCORE[next].t <= upTo) {
      const note = SCORE[next++];
      sound(g, note, now + Math.max(0, note.t - t));
    }
    g.rain.gain.setTargetAtTime(LEVEL.rain * rain, now, 0.4);
    const crickets = Math.min(1, Math.max(0, (night - 0.55) / 0.35));
    g.crickets.gain.setTargetAtTime(LEVEL.crickets * crickets, now, 0.8);
    if (crickets > 0.02) {
      g.chirps.forEach((gain, i) => {
        if (nextChirp[i] < now) nextChirp[i] = now + Math.random() * 0.6;
        if (nextChirp[i] < now + LOOKAHEAD) {
          chirp(gain, nextChirp[i]);
          nextChirp[i] += 0.7 + Math.random() * 0.7;
        }
      });
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

// ---- the offline preview ---------------------------------------------------------------------------------------------

/**
 * The whole score rendered offline, as the trailer plays it: the first black (`PREVIEW_INTRO_S`), then the trailer
 * from its first frame, with the rain and the night from `beds(t)`. Returns a 16-bit stereo WAV.
 */
export async function renderPreview(beds: (t: number) => { rain: number; night: number }, length: number): Promise<Blob> {
  const rate = 44100;
  const total = PREVIEW_INTRO_S + length + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * total), rate);
  const g = build(ctx);
  g.master.gain.setValueAtTime(0, 0);
  g.master.gain.linearRampToValueAtTime(MASTER, 2.5);
  swell(g, INTRO.pad, 0.05, 0.6, PREVIEW_INTRO_S + 0.5);
  strike(g, INTRO.bell, INTRO.bellAt, 0.34, 2.4);
  for (const note of SCORE) sound(g, note, PREVIEW_INTRO_S + note.t);
  const chirpAt = [0, 0.4];
  for (let t = 0; t < length; t += 0.25) {
    const { rain, night } = beds(t);
    const at = PREVIEW_INTRO_S + t;
    g.rain.gain.setTargetAtTime(LEVEL.rain * rain, at, 0.4);
    const c = Math.min(1, Math.max(0, (night - 0.55) / 0.35));
    g.crickets.gain.setTargetAtTime(LEVEL.crickets * c, at, 0.8);
    if (c > 0.02)
      g.chirps.forEach((gain, i) => {
        while (chirpAt[i] < at + 0.25) {
          if (chirpAt[i] >= at) chirp(gain, chirpAt[i]);
          chirpAt[i] += 0.7 + Math.random() * 0.7;
        }
      });
    else chirpAt[0] = chirpAt[1] = at + 0.25;
  }
  g.master.gain.setTargetAtTime(0, PREVIEW_INTRO_S + FADE_FROM, FADE_S / 4);
  const audio = await ctx.startRendering();
  return wav(audio);
}

function wav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
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
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  return new Blob([view.buffer], { type: "audio/wav" });
}
