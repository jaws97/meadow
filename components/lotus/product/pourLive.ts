"use client";
// The brass pot's pour as it plays in the courtyard (its timings are timings.ts's), stepped once a frame by the
// courtyard (LotusGarden, before the moments draw it). The first frame it sees this page's own top-up in the store (the
// pond's topUpAt, lib/client/plant pondStamps) it latches it, and from then on the pot's pose, the stream, the spill and
// the level waiting for the water are all a function of the time since that press, whatever the stamp does after: the
// stamp goes back to 0 when the top-up's hour folds into the server's state, and the pour plays on to its end. Only the
// store's refusal of that very press (topUpRefused, set by lib/client/plant sendCare when the server says no or the
// phone gives up offline) changes it: the pot never pours if the answer comes before the water, the stream fades if it
// comes mid-pour, and either way the pot eases home and the level never jumps. A press made while the pot is still out
// waits until it is home, then plays from then.
//
// One pour per page, in module state, so a tier swap's new layer lands on the right beat; a different plant starts
// afresh. Written in place: nothing allocates per frame.
import { garden } from "@/lib/garden/store";
import { newPourLatch, stepPour } from "@/components/lotus/product/timings";

/** What the moments read (Moments, and the courtyard's level), written in place each frame. */
export const pourLive = {
  /** seconds since the playing press, -1 when there is none */
  t: -1,
  /** the press playing (its topUpAt, epoch ms; 0 for none) */
  at: 0,
  /** when it was refused (s from its start), -1 for not refused */
  refused: -1,
};

const latch = newPourLatch();
let seed: string | null = null;
/** Development only: the pour held at this many seconds from its press (for sign-off stills), or null to let it run. */
let heldAt: number | null = null;

/** One frame of the pour at wall-clock `nowMs`; returns the seconds since the playing press (-1 for none). */
export function stepPourLive(nowMs: number): number {
  const s = garden.get();
  if (s.seed !== seed) {
    // a top-up poured for one plant is never played over the next
    seed = s.seed;
    latch.at = latch.origin = latch.seen = latch.waiting = 0;
    latch.refused = -1;
  }
  const t = stepPour(latch, s.pond?.topUpAt ?? 0, s.topUpRefused, nowMs);
  pourLive.t = heldAt !== null && latch.at > 0 ? heldAt : t;
  pourLive.at = latch.at;
  pourLive.refused = latch.refused;
  return pourLive.t;
}

/** Development only: hold the pour at `t` seconds from its press (null lets it run on). */
function hold(t: number | null) {
  heldAt = process.env.NODE_ENV !== "production" ? t : null;
}
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __pourMoment?: unknown }).__pourMoment = { hold, live: pourLive };
}
