"use client";
// The live garden's ears: reads the garden's sky and weather every couple of seconds and hands them to the sound store
// as a LiveInput, which lib/sound/live turns into what plays. It reads what the picture is drawn from, so the sound
// follows the same clock and the same rain: the per-frame environment (lib/garden/env: the Bangalore hour, the sun's
// height, rain and wind), whether this is the lotus courtyard (lib/plant/species), and whether the doe is in the garden
// now (lib/garden/quality's visitorHold).
//
// The environment only moves while the canvas draws. Before its first frame it says noon, and while the page is hidden
// or the phone is locked it stands still; a sound that goes on playing then (keep playing when my screen locks) must
// still follow the evening into night. So whenever no frame has run since the last look, the feed works the time out
// itself: the real Bangalore time (lib/sky/sun's istNow), or the store's hour when the development panel holds the
// clock (autoClock off), the sun from that, and rain and wind from the garden store, which the plant's weather
// (lib/client/plant) keeps easing on its own timer.
//
// How wet the garden still is after rain is the feed's own, eased at every look by the wall clock whether or not a
// frame has run (lib/sound/live's nextWet: soaked by any steady shower, dry again after a few minutes). The picture's
// wetness (components/garden/garden/weather) dries its stones in seconds and only ever reaches the rain's level, which
// would let the drips after a shower come and go in ten seconds; it only seeds the feed's memory when it starts.
//
// Browser only, and loaded by dynamic import only: lib/garden/env brings three.js with it, and the sound store must
// stay small in the page's own bundle. It never imports lib/client/plant (which writes this device's remembered plant
// into the store when it loads); the store's rain and wind are enough.
import { weather } from "@/components/garden/garden/weather";
import { env } from "@/lib/garden/env";
import { visitorHold } from "@/lib/garden/quality";
import { garden } from "@/lib/garden/store";
import { isLotus } from "@/lib/plant/species";
import { istDateAt, istNow, sunInfo } from "@/lib/sky/sun";
import { nextWet, soakedBy } from "@/lib/sound/live";
import type { LiveInput } from "@/lib/sound/types";

/** How often the feed looks at the garden (ms). The engine eases over seconds, so more often would add nothing. */
export const LIVE_FEED_MS = 2000;

const DEG_PER_RAD = 180 / Math.PI;

/**
 * Starts listening to the garden: calls `onInput` at once, then every `everyMs`. Returns the function that stops it.
 * Browser only.
 */
export function startLiveFeed(onInput: (input: LiveInput) => void, everyMs: number = LIVE_FEED_MS): () => void {
  /** env.time at the last look: unchanged means no frame has run since (the canvas is not drawing) */
  let lastFrameTime = -1;
  /** how wet the garden still is, as the sound hears it, and when it was last eased (ms) */
  let wet = soakedBy(Math.max(garden.get().rain, weather.primed ? weather.wet : 0));
  let wetAt = Date.now();
  let stopped = false;

  const look = (): LiveInput => {
    const g = garden.get();
    const now = Date.now();
    const drawing = env.time > 0 && env.time !== lastFrameTime;
    lastFrameTime = env.time;

    let hour: number;
    let sunAltitudeDeg: number;
    let rain: number;
    let wind: number;
    if (drawing) {
      // the frame's own values (the clock there already follows the store's hour when autoClock is off)
      hour = env.hour;
      sunAltitudeDeg = env.sun.altitude * DEG_PER_RAD;
      rain = env.rain;
      wind = env.wind;
    } else {
      hour = g.autoClock ? istNow() : g.hour;
      // read at once: sunInfo fills one shared result (lib/sky/sun), which the next frame rewrites before anything
      // in the scene reads it
      sunAltitudeDeg = sunInfo(istDateAt(hour)).altitude * DEG_PER_RAD;
      rain = g.rain;
      wind = g.wind;
    }
    wet = nextWet(wet, rain, Math.max(0, now - wetAt) / 1000);
    wetAt = now;

    return { hour, sunAltitudeDeg, rain, wet, wind, lotus: isLotus(g.speciesId), deer: visitorHold.active() };
  };

  const tick = () => {
    if (!stopped) onInput(look());
  };
  tick();
  const id = window.setInterval(tick, everyMs);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}
