"use client";
// The near garden's slow-moving state, eased once per frame from the shared
// env and the store, then read by every part: how wet the stones and mulch
// are, how soaked the bed is from watering, how much water stands in the
// saucer, and how brightly the lantern burns. Surfaces wet quickly in rain
// and dry slowly after it; the lantern warms up over a couple of seconds.
// One mutable object, rewritten in place, so nothing allocates per frame.
import { env } from "@/lib/garden/env";
import { garden } from "@/lib/garden/store";
import { clamp01, smoothstep } from "@/lib/plant/prng";

export const weather = {
  primed: false,
  /** 0 dry .. 1 rain-soaked surfaces */
  wet: 0,
  /** the owner's soil moisture, eased: darkens the mulch when watered */
  moisture: 0.6,
  /** 0 .. 1 standing water in the saucer */
  puddle: 0,
  /** 0 out .. 1 the lantern fully lit */
  lit: 0,
  /** the candle's slow breathing, around 1 */
  flicker: 1,
};

export type Weather = typeof weather;

/** Approach `target` at `up` per second when rising and `down` when falling. */
function ease(value: number, target: number, up: number, down: number, dt: number): number {
  const rate = target > value ? up : down;
  return value + (target - value) * (1 - Math.exp(-dt * rate));
}

export function stepWeather(dt: number) {
  const s = garden.get();
  // The lantern is lit as the light goes, and on a dark, rainy afternoon.
  const dusk = smoothstep(0.06, 0.5, env.nightness + 0.3 * env.rain * env.cloud);
  // A drowned bed holds water in the saucer even without rain.
  const pooled = Math.max(clamp01(env.rain * 1.4), smoothstep(0.9, 1, s.moisture) * 0.8);
  const w = weather;
  if (!w.primed) {
    w.primed = true;
    w.wet = env.rain;
    w.moisture = s.moisture;
    w.puddle = pooled;
    w.lit = dusk;
  } else {
    w.wet = ease(w.wet, env.rain, 1.2, 0.12, dt);
    w.moisture = ease(w.moisture, s.moisture, 1, 1, dt);
    w.puddle = ease(w.puddle, pooled, 0.25, 0.06, dt);
    w.lit = ease(w.lit, dusk, 0.9, 0.9, dt);
  }
  // A candle in still air: a slow swell with a faint quicker shiver, never a strobe.
  const t = env.time;
  w.flicker = 1 + 0.05 * Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1.3) + 0.025 * Math.sin(t * 9.1 + Math.sin(t * 3.7));
}
