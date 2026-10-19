import { afterEach, describe, expect, it, vi } from "vitest";
import { holdSwap, LATE_MS, onSwapOverdue, swapHolds, swapSettled } from "./swapGate";

/** A hold the test settles itself (every test leaves the gate empty, so none waits on another's). */
function hold() {
  let finish!: () => void;
  holdSwap(new Promise<void>((r) => (finish = r)));
  return () => finish();
}

describe("the swap gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("tells whoever is still preparing when its timeout passes, and nobody when everything settled in time", async () => {
    vi.useFakeTimers();
    const heard = vi.fn();
    const off = onSwapOverdue(heard);
    const inTime = hold();
    const first = swapSettled(1000);
    inTime();
    await first;
    await vi.advanceTimersByTimeAsync(2000 + LATE_MS);
    expect(heard).not.toHaveBeenCalled();
    // a courtyard preparing out of sight answers by showing itself: the swap lets the garden back at once
    const preparing = hold();
    const answer = onSwapOverdue((gaveUp) => {
      if (!gaveUp) preparing();
    });
    let done = false;
    const late = swapSettled(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    await late;
    expect(done).toBe(true);
    expect(heard.mock.calls).toEqual([[false]]);
    answer();
    off();
    await vi.advanceTimersByTimeAsync(LATE_MS);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("keeps the dim down past its timeout for a hold nobody could answer, then gives up and says so", async () => {
    vi.useFakeTimers();
    const heard = vi.fn();
    const off = onSwapOverdue(heard);
    const notThere = hold();
    let done = false;
    const settled = swapSettled(1000, 5000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard.mock.calls).toEqual([[false]]);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(done).toBe(true);
    expect(heard.mock.calls).toEqual([[false], [true]]);
    off();
    notThere();
    await Promise.resolve();
    expect(swapHolds()).toBe(0);
  });

  it("lets the garden back as soon as a late hold settles within that allowance, without giving up", async () => {
    vi.useFakeTimers();
    const heard = vi.fn();
    const off = onSwapOverdue(heard);
    const arriving = hold();
    let done = false;
    const settled = swapSettled(1000, 5000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(false);
    arriving();
    await settled;
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heard.mock.calls).toEqual([[false]]);
    off();
  });

  it("never waits longer than its timeout and the late allowance", async () => {
    vi.useFakeTimers();
    const stuck = hold();
    let done = false;
    const settled = swapSettled(6000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(6000 + LATE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(done).toBe(true);
    stuck();
  });
});
