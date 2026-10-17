// Polls the shared Meadow snapshot (GET /api/meadow) for the party screen's
// counter and feed. The snapshot is the same for everyone and the CDN keeps
// it for five seconds, so the screen asks every six (logic.ts POLL_MS) and
// sends the last ETag back: an unchanged Meadow costs a bodiless 304. A
// failed poll is never shown on the big screen; the counter simply holds its
// last number while the polls back off to a minute and recover by themselves.
// Browser only: started from an effect.
import { nextPollDelay, parseSnapshot, type FeedSnapshot } from "@/components/party/logic";

/** A poll that has not answered in this long is given up and tried again later. */
const TIMEOUT_MS = 15_000;

/** Starts polling; `onSnapshot` hears each new snapshot. Returns a function that stops it. */
export function pollMeadow(onSnapshot: (snapshot: FeedSnapshot) => void): () => void {
  let etag: string | null = null;
  let failures = 0;
  let stopped = false;
  let timer: number | undefined;
  let inFlight: AbortController | null = null;

  async function tick() {
    const controller = new AbortController();
    inFlight = controller;
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("/api/meadow", {
        cache: "no-store",
        headers: etag ? { "If-None-Match": etag } : undefined,
        signal: controller.signal,
      });
      if (res.status === 304) {
        failures = 0;
      } else if (res.ok) {
        const snapshot = parseSnapshot(await res.json());
        if (!snapshot) throw new Error("unexpected Meadow snapshot");
        etag = res.headers.get("ETag");
        failures = 0;
        if (!stopped) onSnapshot(snapshot);
      } else {
        throw new Error(`Meadow snapshot answered ${res.status}`);
      }
    } catch (err) {
      if (stopped) return;
      failures++;
      if (failures === 1 || failures % 10 === 0) console.warn("[party] the Meadow snapshot is not answering; the counter holds its last number", err);
    } finally {
      window.clearTimeout(timeout);
      if (inFlight === controller) inFlight = null;
    }
    if (!stopped) timer = window.setTimeout(tick, nextPollDelay(failures, Math.random()));
  }

  void tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    inFlight?.abort();
  };
}
