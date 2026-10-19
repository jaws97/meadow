import { describe, expect, it } from "vitest";
import {
  BufferCache,
  budgetFor,
  decodedBytes,
  DESKTOP_BUDGET_BYTES,
  isLight,
  PHONE_BUDGET_BYTES,
} from "@/lib/sound/budget";
import { BIRD_CALLS, MAX_LAYERS } from "@/lib/sound/catalog";
import { SOUNDS, soundFile } from "@/lib/sound/library";

const MB = 1024 * 1024;

describe("the decoded-audio budget", () => {
  it("is smaller on a phone or a device short of memory", () => {
    expect(budgetFor({ coarse: true })).toBe(PHONE_BUDGET_BYTES);
    expect(budgetFor({ coarse: false, memoryGb: 4 })).toBe(PHONE_BUDGET_BYTES);
    expect(budgetFor({ coarse: false, memoryGb: 2 })).toBe(PHONE_BUDGET_BYTES);
    expect(budgetFor({ coarse: false, memoryGb: 8 })).toBe(DESKTOP_BUDGET_BYTES);
    expect(budgetFor({ coarse: false })).toBe(DESKTOP_BUDGET_BYTES);
    expect(isLight({ coarse: true, memoryGb: 16 })).toBe(true);
  });

  it("holds the most beds that play at once and the bird calls on a phone, at 48 kHz", () => {
    const beds = SOUNDS.filter((s) => s.kind === "bed").map((s) => decodedBytes(s.seconds, s.channels, 48000));
    const biggest = beds.sort((a, b) => b - a).slice(0, MAX_LAYERS).reduce((a, b) => a + b, 0);
    const calls = BIRD_CALLS.map((k) => soundFile(k)!).reduce((a, s) => a + decodedBytes(s.seconds, s.channels, 48000), 0);
    expect(biggest + calls).toBeLessThanOrEqual(PHONE_BUDGET_BYTES);
  });

  it("counts four bytes a sample a channel", () => {
    expect(decodedBytes(1, 1, 48000)).toBe(192000);
    expect(decodedBytes(50, 2, 44100)).toBe(50 * 44100 * 2 * 4);
  });
});

describe("the buffer cache", () => {
  it("evicts the least recently used buffer to stay under its cap", () => {
    const cache = new BufferCache<string>(30 * MB);
    cache.put("a", "A", 10 * MB);
    cache.put("b", "B", 10 * MB);
    cache.put("c", "C", 10 * MB);
    cache.get("a");
    const evicted = cache.put("d", "D", 10 * MB);
    expect(evicted).toEqual(["b"]);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.bytes()).toBe(30 * MB);
  });

  it("never evicts a buffer that is playing, even over its cap", () => {
    const cache = new BufferCache<string>(20 * MB);
    cache.pin("a");
    cache.put("a", "A", 10 * MB);
    cache.pin("b");
    cache.put("b", "B", 10 * MB);
    cache.pin("c");
    const evicted = cache.put("c", "C", 10 * MB);
    expect(evicted).toEqual([]);
    expect(cache.keys().sort()).toEqual(["a", "b", "c"]);
    expect(cache.bytes()).toBe(30 * MB);
    expect(cache.delete("a")).toBe(false);
  });

  it("lets a stopped buffer go once the last of its players unpins it", () => {
    const cache = new BufferCache<string>(20 * MB);
    cache.pin("a");
    cache.pin("a");
    cache.put("a", "A", 10 * MB);
    cache.put("b", "B", 10 * MB);
    cache.unpin("a");
    expect(cache.isPinned("a")).toBe(true);
    expect(cache.put("c", "C", 10 * MB)).toEqual(["b"]);
    cache.unpin("a");
    expect(cache.isPinned("a")).toBe(false);
    // just stopped counts as just used, so the older "c" goes first, then "a"
    expect(cache.put("d", "D", 10 * MB)).toEqual(["c"]);
    expect(cache.makeRoom(10 * MB)).toEqual(["a"]);
    expect(cache.bytes()).toBe(10 * MB);
  });

  it("makes room before a decode, oldest first, and never the key just put", () => {
    const cache = new BufferCache<string>(25 * MB);
    cache.put("a", "A", 10 * MB);
    cache.put("b", "B", 10 * MB);
    expect(cache.makeRoom(10 * MB)).toEqual(["a"]);
    expect(cache.put("big", "BIG", 40 * MB)).toEqual(["b"]);
    expect(cache.keys()).toEqual(["big"]);
  });

  it("respects its cap over a long run of picks with a few playing", () => {
    const cache = new BufferCache<number>(64 * MB);
    const playing: string[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const key = `bed-${Math.floor(rand() * 24)}`;
      if (playing.length >= 5) cache.unpin(playing.shift()!);
      cache.pin(key);
      playing.push(key);
      if (!cache.has(key)) cache.put(key, i, 9.6 * MB);
      else cache.get(key);
      for (const k of playing) if (cache.has(k) === false) throw new Error(`evicted a playing buffer ${k}`);
      const pinnedBytes = new Set(playing).size * 9.6 * MB;
      expect(cache.bytes()).toBeLessThanOrEqual(Math.max(64 * MB, pinnedBytes) + 1);
    }
  });
});
