import { describe, expect, it, vi } from "vitest";
import { holdSwap, onSwapOverdue, swapHolds, swapSettled } from "./swapGate";

describe("the swap gate", () => {
  it("lets the swap through at once when nothing holds it", async () => {
    expect(swapHolds()).toBe(0);
    await expect(swapSettled(10)).resolves.toBeUndefined();
  });

  it("waits for every held preparation, and a failed one releases it too", async () => {
    let finish!: () => void;
    let fail!: (e: Error) => void;
    holdSwap(new Promise<void>((r) => (finish = r)));
    holdSwap(new Promise<void>((_, j) => (fail = j)));
    expect(swapHolds()).toBe(2);
    let done = false;
    const settled = swapSettled(60_000).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    fail(new Error("compile failed"));
    await settled;
    expect(done).toBe(true);
    expect(swapHolds()).toBe(0);
  });

  it("tells whoever is still preparing when its timeout wins, and nobody when everything settled in time", async () => {
    vi.useFakeTimers();
    try {
      const heard = vi.fn();
      const off = onSwapOverdue(heard);
      let finish!: () => void;
      holdSwap(new Promise<void>((r) => (finish = r)));
      const inTime = swapSettled(1000);
      finish();
      await inTime;
      await vi.advanceTimersByTimeAsync(2000);
      expect(heard).not.toHaveBeenCalled();
      holdSwap(new Promise<void>(() => {}));
      const late = swapSettled(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await late;
      expect(heard).toHaveBeenCalledTimes(1);
      off();
      const after = swapSettled(10);
      await vi.advanceTimersByTimeAsync(10);
      await after;
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits longer than its timeout", async () => {
    vi.useFakeTimers();
    try {
      holdSwap(new Promise<void>(() => {}));
      let done = false;
      const settled = swapSettled(6000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(5999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await settled;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
