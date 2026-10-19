// How much decoded audio the garden keeps, and which to let go. A decoded AudioBuffer is 32-bit float per sample per
// channel at the context's rate, about 9.6 MB for one of the library's 50 s mono beds at 48 kHz, so a few beds cost
// more memory than the files they came from by thirty times over, and that memory is shared with the garden's WebGL.
// The budget is about 64 MB on a phone (a coarse pointer, or a device that says it has 4 GB or less) and 128 MB on a
// laptop or desktop: five beds and the three bird calls fit a phone's (lib/sound/catalog's MAX_LAYERS).
//
// The engine (lib/sound/engine) keeps its buffers in a `BufferCache`: a least-recently-used cache by byte size. A
// buffer that is playing is pinned and never evicted, even if that leaves the cache over its cap for a while; stopped
// buffers are evicted oldest first, so tiles the person comes back to soon still start at once. Pure apart from
// `deviceBudgetBytes()` and `isLightDevice()`, which read the browser; the rest is tested in node (budget.test.ts).

const MB = 1024 * 1024;

/** Decoded audio held on a phone or a device with little memory (bytes). */
export const PHONE_BUDGET_BYTES = 64 * MB;
/** Decoded audio held on a laptop, desktop or roomy tablet (bytes). */
export const DESKTOP_BUDGET_BYTES = 128 * MB;
/** At or under this much memory a device counts as light (GB, `navigator.deviceMemory`, Chromium only). */
export const LIGHT_MEMORY_GB = 4;

/** What the budget depends on. */
export interface DeviceTraits {
  /** the main pointer is a finger (`(pointer: coarse)`) */
  coarse: boolean;
  /** `navigator.deviceMemory` (GB), where the browser reports it */
  memoryGb?: number;
}

/** A phone, or anything with little memory: a smaller audio budget and a shorter reverb. */
export function isLight(traits: DeviceTraits): boolean {
  return traits.coarse || (traits.memoryGb !== undefined && traits.memoryGb <= LIGHT_MEMORY_GB);
}

/** The decoded-audio budget for a device (bytes). */
export function budgetFor(traits: DeviceTraits): number {
  return isLight(traits) ? PHONE_BUDGET_BYTES : DESKTOP_BUDGET_BYTES;
}

/** This device's traits, read from the browser (a laptop's in node). */
export function deviceTraits(): DeviceTraits {
  if (typeof window === "undefined") return { coarse: false };
  let coarse = false;
  try {
    coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  } catch {
    // no media queries: count it as a laptop
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { coarse, memoryGb: typeof memory === "number" ? memory : undefined };
}

/** This device is a phone or short of memory. */
export function isLightDevice(): boolean {
  return isLight(deviceTraits());
}

/** This device's decoded-audio budget (bytes). */
export function deviceBudgetBytes(): number {
  return budgetFor(deviceTraits());
}

/** The memory a decoded buffer takes: 4 bytes a sample a channel (bytes). */
export function decodedBytes(seconds: number, channels: number, sampleRate: number): number {
  return Math.ceil(seconds * sampleRate) * channels * 4;
}

interface Entry<T> {
  value: T;
  bytes: number;
  /** when it was last used, as a running count */
  used: number;
}

/**
 * Decoded buffers by key, within a byte cap. `pin` a key while its sound plays (pins count, so two users each pin and
 * unpin); a pinned key is never evicted. Eviction takes the least recently used unpinned entries first.
 */
export class BufferCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pins = new Map<string, number>();
  private clock = 0;
  private total = 0;

  /** @param capBytes the most it holds while nothing pinned forces it over (bytes) */
  constructor(readonly capBytes: number) {}

  /** The buffer for a key, marked as just used; undefined if it is not held. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.used = ++this.clock;
    return entry.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Holds a buffer, then evicts what it must to get back under the cap. Returns the keys evicted. */
  put(key: string, value: T, bytes: number): string[] {
    const old = this.entries.get(key);
    if (old) this.total -= old.bytes;
    this.entries.set(key, { value, bytes, used: ++this.clock });
    this.total += bytes;
    return this.evict(0, key);
  }

  /** Evicts what it can so that `bytes` more would fit under the cap, before a decode. Returns the keys evicted. */
  makeRoom(bytes: number): string[] {
    return this.evict(bytes, null);
  }

  /** Lets a buffer go now, unless it is pinned. Returns whether it went. */
  delete(key: string): boolean {
    if (this.isPinned(key)) return false;
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.total -= entry.bytes;
    return true;
  }

  /** The key's sound is playing (or about to): keep its buffer, whether or not it is held yet. */
  pin(key: string): void {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }

  /** One player of the key has stopped; once none is left its buffer may be evicted (it is marked as just used). */
  unpin(key: string): void {
    const n = (this.pins.get(key) ?? 0) - 1;
    if (n > 0) this.pins.set(key, n);
    else this.pins.delete(key);
    const entry = this.entries.get(key);
    if (entry) entry.used = ++this.clock;
  }

  isPinned(key: string): boolean {
    return (this.pins.get(key) ?? 0) > 0;
  }

  /** The bytes held. */
  bytes(): number {
    return this.total;
  }

  /** The keys held, least recently used first. */
  keys(): string[] {
    return [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used).map(([k]) => k);
  }

  private evict(extra: number, keep: string | null): string[] {
    const evicted: string[] = [];
    if (this.total + extra <= this.capBytes) return evicted;
    for (const key of this.keys()) {
      if (this.total + extra <= this.capBytes) break;
      if (key === keep || this.isPinned(key)) continue;
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.total -= entry.bytes;
      evicted.push(key);
    }
    return evicted;
  }
}
