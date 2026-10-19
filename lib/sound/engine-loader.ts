// Fetches and decodes the garden's recorded beds and bird calls (lib/sound/library) for the engine, and keeps them.
// Files are fetched as soon as they are wanted, side by side, but decoded strictly one at a time: decoding a 50 s file
// is a burst of work and memory, and two at once on a phone, beside the garden's WebGL, is the kind of spike that makes
// the frame rate stumble. A file joins the decode queue only once its bytes have arrived, so a slow or stalled download
// holds back only itself, never the files behind it; and a download that has not finished after FETCH_TIMEOUT_MS is
// given up, so a stall on a phone moving between networks becomes a failure the engine can report and try again.
// Each buffer goes into a `BufferCache` (lib/sound/budget) sized for the device, pinned while a layer plays it, so a
// tile the person turns off and on again starts at once and a phone never holds more decoded audio than it can spare.
// A file wanted twice while it loads is loaded once. A failure is reported to the caller and forgotten, so a later pick
// tries again.
import { BufferCache, decodedBytes, deviceBudgetBytes } from "@/lib/sound/budget";
import type { SoundFile } from "@/lib/sound/types";

/** A file's download is given up after this long (ms): a 50 s mono bed is about half a megabyte. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Fetches a file's bytes, giving up after `timeoutMs`. */
async function fetchBytes(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const abort = typeof AbortController === "function" ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(new Error(`${url}: no answer in ${timeoutMs} ms`)), timeoutMs) : null;
  try {
    const response = await fetch(url, abort ? { signal: abort.signal } : undefined);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return await response.arrayBuffer();
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export class Loader {
  readonly cache = new BufferCache<AudioBuffer>(deviceBudgetBytes());
  private readonly inflight = new Map<string, Promise<AudioBuffer>>();
  /** the decode queue's tail: each decode waits for the one before */
  private queue: Promise<unknown> = Promise.resolve();

  /** The decoded buffer for a file if it is held now (marked as just used). */
  ready(key: string): AudioBuffer | undefined {
    return this.cache.get(key);
  }

  /** The file's decoded buffer: held, already on its way, or fetched now and decoded when the queue reaches it. */
  load(file: SoundFile, ctx: BaseAudioContext): Promise<AudioBuffer> {
    const held = this.cache.get(file.key);
    if (held) return Promise.resolve(held);
    const pending = this.inflight.get(file.key);
    if (pending) return pending;
    const decoded = fetchBytes(file.url, FETCH_TIMEOUT_MS).then((data) =>
      this.enqueue(async () => {
        this.cache.makeRoom(decodedBytes(file.seconds, file.channels, ctx.sampleRate));
        const buffer = await ctx.decodeAudioData(data);
        this.cache.put(file.key, buffer, buffer.length * buffer.numberOfChannels * 4);
        return buffer;
      }),
    );
    this.inflight.set(file.key, decoded);
    const forget = () => {
      if (this.inflight.get(file.key) === decoded) this.inflight.delete(file.key);
    };
    decoded.then(forget, forget);
    return decoded;
  }

  /** A layer plays this file now (or will once it loads): keep its buffer. */
  pin(key: string): void {
    this.cache.pin(key);
  }

  /** A layer that played this file has stopped. */
  unpin(key: string): void {
    this.cache.unpin(key);
  }

  /** Runs `job` once every decode queued before it has finished (or failed). */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
