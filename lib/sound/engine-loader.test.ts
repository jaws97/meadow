import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS, Loader } from "@/lib/sound/engine-loader";
import { soundFile } from "@/lib/sound/library";
import type { SoundFile } from "@/lib/sound/types";

// The network and the decoder, faked: each fetch waits until the test lets its file arrive (or fail), and listens to
// its abort signal as a real one does; each decode is recorded, and waits until the test lets it finish.
interface Download {
  url: string;
  arrive(): void;
  fail(error: unknown): void;
}

let downloads: Download[];
let decodes: { bytes: ArrayBuffer; finish(): void }[];

const ctx = {
  sampleRate: 48000,
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve) => {
      decodes.push({
        bytes,
        finish: () => resolve({ length: 48000, numberOfChannels: 1, duration: 1, sampleRate: 48000 } as AudioBuffer),
      });
    });
  },
} as unknown as BaseAudioContext;

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

const file = (key: string): SoundFile => soundFile(key)!;

describe("the engine's loader", () => {
  beforeEach(() => {
    downloads = [];
    decodes = [];
    vi.stubGlobal("fetch", (url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        const bytes = new ArrayBuffer(16);
        downloads.push({
          url,
          arrive: () => resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) }),
          fail: reject,
        });
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new Error("aborted")));
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("decodes a file whose bytes have come while another is still on its way", async () => {
    const loader = new Loader();
    const slow = loader.load(file("wind-leaves"), ctx);
    const quick = loader.load(file("night-crickets"), ctx);
    expect(downloads.map((d) => d.url)).toEqual([file("wind-leaves").url, file("night-crickets").url]);
    downloads[1].arrive();
    await flush();
    expect(decodes).toHaveLength(1);
    decodes[0].finish();
    await expect(quick).resolves.toMatchObject({ duration: 1 });
    expect(loader.ready("night-crickets")).toBeDefined();
    downloads[0].arrive();
    await flush();
    decodes[1].finish();
    await expect(slow).resolves.toMatchObject({ duration: 1 });
  });

  it("decodes one file at a time", async () => {
    const loader = new Loader();
    void loader.load(file("wind-leaves"), ctx);
    void loader.load(file("night-crickets"), ctx);
    downloads[0].arrive();
    downloads[1].arrive();
    await flush();
    expect(decodes).toHaveLength(1);
    decodes[0].finish();
    await flush();
    expect(decodes).toHaveLength(2);
  });

  it("loads a file wanted twice while it loads only once", () => {
    const loader = new Loader();
    const a = loader.load(file("wind-leaves"), ctx);
    const b = loader.load(file("wind-leaves"), ctx);
    expect(a).toBe(b);
    expect(downloads).toHaveLength(1);
  });

  it("gives up a download that stalls, and tries again when asked after that", async () => {
    vi.useFakeTimers();
    const loader = new Loader();
    const stalled = loader.load(file("wind-leaves"), ctx);
    const failed = expect(stalled).rejects.toBeDefined();
    vi.advanceTimersByTime(FETCH_TIMEOUT_MS + 1);
    await failed;
    void loader.load(file("wind-leaves"), ctx);
    expect(downloads).toHaveLength(2);
  });

  it("reports a file the server will not give", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }));
    const loader = new Loader();
    await expect(loader.load(file("wind-leaves"), ctx)).rejects.toThrow(/404/);
  });
});
