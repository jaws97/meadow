// The sounds the engine makes in code rather than from files: the music box and its pad, with a small hall for them to
// ring in, and soft brown noise. The voices are the party trailer's (components/party/trailer/music.ts), copied here
// rather than shared so the garden never loads party code: a music-box note is four sine partials struck and ringing
// down, the upper ones sooner; a pad chord is two detuned triangles a note through a soft low-pass, slow to swell and to
// fade; the hall is a convolver over a burst of decaying noise, shorter on a phone, where long convolution costs
// battery. Making a hall is the costly part (the impulse, and above all handing it to the ConvolverNode, tens of
// milliseconds on the main thread), so the engine makes one per context (`makeHall`), ahead of time while the page is
// idle, and each music box sends into it (`boxBus`). The levels here are set so the music box comes out about as loud
// as the music files (-23 LUFS, worked out by synthesising an hour of it in node), and the brown noise about as loud
// as a bed (-24 LUFS).
//
// Brown noise is white noise through a leaky integrator: flat below a low corner and falling 6 dB an octave above it,
// the warm, waterfall-like hush people use to settle. `brownNoise()` makes the samples (pure, tested in
// engine-synth.test.ts); the engine loops a 12 s buffer of it with the same crossfading looper as the beds. It plays
// through a low-pass at 1.4 kHz, so the buffer is made at BROWN_RATE_HZ rather than the context's rate: a buffer
// source resamples as it plays, and the buffer costs about a third of the time and memory.

/** The music box's bus level and the pad's, in the trailer's proportion (lifted about 2 dB to meet the music files). */
export const BOX_BELL_GAIN = 0.36;
export const BOX_PAD_GAIN = 0.135;
/** How much of the bells and of the pad goes to the hall, and how loud the hall returns. */
const BELL_SEND = 0.5;
const PAD_SEND = 0.9;
export const BOX_HALL_GAIN = 0.55;
/** The hall's length (s): short on a phone, longer elsewhere (the trailer's was 3.4 s). */
export const HALL_LIGHT_S = 1.4;
export const HALL_FULL_S = 2.8;
/** A pad's swell and fade (s), as in the trailer. */
const PAD_IN_S = 2.2;
const PAD_OUT_S = 2.8;
/** Brown noise: flat below this corner (Hz), and its level (RMS, about -24 LUFS like a bed). */
export const BROWN_CORNER_HZ = 150;
export const BROWN_RMS = 0.075;
/** The brown-noise buffer's length (s), and the corner of the gentle low-pass it plays through (Hz). */
export const BROWN_S = 12;
export const BROWN_LOWPASS_HZ = 1400;
/** The brown-noise buffer's own sample rate (Hz): well above twice the low-pass, and one every browser accepts. */
export const BROWN_RATE_HZ = 22050;

/** The frequency of a MIDI note (Hz). */
export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** A hall's impulse: stereo noise decaying to nothing over `seconds`. */
export function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.8);
  }
  return buffer;
}

/**
 * Brown noise samples: white noise through a leaky integrator (flat below `cornerHz`, falling 6 dB an octave above),
 * with its mean taken out and its RMS set to `rms`. The integrator runs a moment first so the buffer starts settled.
 */
export function brownNoise(
  length: number,
  sampleRate: number,
  random: () => number,
  cornerHz = BROWN_CORNER_HZ,
  rms = BROWN_RMS,
): Float32Array {
  const out = new Float32Array(length);
  const a = Math.exp((-2 * Math.PI * cornerHz) / sampleRate);
  let y = 0;
  const settle = Math.ceil((sampleRate / cornerHz) * 10);
  for (let i = 0; i < settle; i++) y = a * y + (1 - a) * (random() * 2 - 1);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    y = a * y + (1 - a) * (random() * 2 - 1);
    out[i] = y;
    sum += y;
  }
  const mean = sum / Math.max(1, length);
  let power = 0;
  for (let i = 0; i < length; i++) {
    out[i] -= mean;
    power += out[i] * out[i];
  }
  const scale = power > 0 ? rms / Math.sqrt(power / length) : 0;
  for (let i = 0; i < length; i++) out[i] *= scale;
  return out;
}

/** A mono buffer of brown noise, BROWN_S long, at BROWN_RATE_HZ (or the context's rate where that is refused). */
export function brownNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let rate = Math.min(BROWN_RATE_HZ, ctx.sampleRate);
  let buffer: AudioBuffer;
  try {
    buffer = ctx.createBuffer(1, Math.floor(rate * BROWN_S), rate);
  } catch {
    rate = ctx.sampleRate;
    buffer = ctx.createBuffer(1, Math.floor(rate * BROWN_S), rate);
  }
  buffer.getChannelData(0).set(brownNoise(buffer.length, rate, Math.random));
  return buffer;
}

/** A StereoPannerNode at `pan`, or null where the browser has none (the sound then plays centred). */
export function panner(ctx: BaseAudioContext, pan: number): StereoPannerNode | null {
  try {
    if (typeof ctx.createStereoPanner !== "function") return null;
    const node = ctx.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    return node;
  } catch {
    return null;
  }
}

/** A small hall: what goes into `input` rings on and comes out of `output`, at BOX_HALL_GAIN. */
export interface Hall {
  input: AudioNode;
  output: AudioNode;
}

/** Makes a hall `seconds` long (the costly part: made once per context, while the page is idle). */
export function makeHall(ctx: BaseAudioContext, seconds: number): Hall {
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx, seconds);
  const wet = ctx.createGain();
  wet.gain.value = BOX_HALL_GAIN;
  convolver.connect(wet);
  return { input: convolver, output: wet };
}

/** The music box's buses: bells and pad into `out`, each with a send to the hall. */
export interface BoxBus {
  bells: GainNode;
  pads: GainNode;
  /** every node made, to disconnect when the tile goes (the hall is not among them: it is kept) */
  nodes: AudioNode[];
}

/** Builds the music box's buses into `out`, sending to `hallIn` (a hall's input) as well. */
export function boxBus(ctx: BaseAudioContext, out: AudioNode, hallIn: AudioNode): BoxBus {
  const nodes: AudioNode[] = [];
  const bus = (level: number, send: number) => {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(out);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(hallIn);
    nodes.push(g, s);
    return g;
  };
  return { bells: bus(BOX_BELL_GAIN, BELL_SEND), pads: bus(BOX_PAD_GAIN, PAD_SEND), nodes };
}

/** A struck music-box note at `when` (s, audio clock): a few partials, the upper ones ringing down sooner. */
export function strike(ctx: BaseAudioContext, dest: AudioNode, midi: number, when: number, vel: number, dur: number): void {
  const f = hz(midi);
  const ring = Math.min(4.5, 1.2 + dur * 0.9);
  const pan = panner(ctx, Math.max(-0.5, Math.min(0.5, (midi - 80) / 24)));
  const to = pan ?? dest;
  if (pan) pan.connect(dest);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2, 0.3, 0.5],
    [3, 0.11, 0.32],
    [4.16, 0.06, 0.2],
  ];
  let left = partials.length;
  for (const [ratio, amp, share] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const env = ctx.createGain();
    const end = when + ring * share;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel * amp, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(to);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      if (--left === 0) pan?.disconnect();
    };
    osc.start(when);
    osc.stop(end + 0.05);
  }
}

/** A pad chord at `when` (s, audio clock): two detuned triangles a note through a soft low-pass, swelling and fading. */
export function swell(ctx: BaseAudioContext, dest: AudioNode, midi: readonly number[], when: number, vel: number, dur: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 950;
  filter.Q.value = 0.4;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.setTargetAtTime(vel / Math.sqrt(midi.length), when, PAD_IN_S / 3);
  env.gain.setTargetAtTime(0, when + dur, PAD_OUT_S / 4);
  filter.connect(env).connect(dest);
  let left = midi.length * 2;
  for (const m of midi) {
    for (const cents of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz(m);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.onended = () => {
        osc.disconnect();
        if (--left === 0) {
          filter.disconnect();
          env.disconnect();
        }
      };
      osc.start(when);
      osc.stop(when + dur + PAD_OUT_S * 1.6);
    }
  }
}
