// The swap's wait for a lotus's courtyard (product/stage.ts with lib/garden/swapGate), as the scene and the plant's swap
// run it: the scene holds the swap on courtyardPending when the store names a lotus on a showing garden, the courtyard
// says courtyardReady once it is compiled and pre-drawn, and the swap (lib/client/plant swapTo) lifts the dim once
// swapSettled resolves. The dim must never lift over a courtyard that is hidden or not there yet, and a courtyard must
// never start hidden once nothing holds the dim for it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { courtyardExpected, courtyardPending, courtyardReady } from "@/components/lotus/product/stage";
import { holdSwap, LATE_MS, onSwapOverdue, swapHolds, swapSettled } from "@/lib/garden/swapGate";

/** lib/client/plant's swap: the dim waits this long (from a moment after the plant is swapped) before its time is up. */
const TIMEOUT_MS = 7700;

/** The scene on a swap to a lotus: the courtyard is expected and the swap is held on it. */
function swapToLotus() {
  holdSwap(courtyardPending());
  let lifted = false;
  const dim = swapSettled(TIMEOUT_MS).then(() => (lifted = true));
  return { dim, lifted: () => lifted };
}

describe("the swap's wait for the courtyard", () => {
  afterEach(() => {
    courtyardReady();
    vi.useRealTimers();
  });

  it("lifts the dim once the courtyard says it is ready, and not before", async () => {
    vi.useFakeTimers();
    const swap = swapToLotus();
    expect(courtyardExpected()).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(swap.lifted()).toBe(false);
    courtyardReady();
    await swap.dim;
    expect(swap.lifted()).toBe(true);
    expect(courtyardExpected()).toBe(false);
    expect(swapHolds()).toBe(0);
  });

  it("keeps the dim down when the courtyard's code arrives after the swap's time is up, until it has prepared and shown", async () => {
    vi.useFakeTimers();
    const swap = swapToLotus();
    // the swap's time runs out with nothing mounted to hear it (the chunk is still on its way)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(swap.lifted()).toBe(false);
    // so a courtyard mounting now is still expected: it starts hidden and prepares out of sight, behind the dim
    expect(courtyardExpected()).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(swap.lifted()).toBe(false);
    courtyardReady();
    await swap.dim;
    expect(swap.lifted()).toBe(true);
  });

  it("shows a courtyard that is still preparing when the swap's time is up", async () => {
    vi.useFakeTimers();
    const swap = swapToLotus();
    // a mounted courtyard listens (LotusGarden) and shows itself at once
    const off = onSwapOverdue(() => courtyardReady());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await swap.dim;
    expect(swap.lifted()).toBe(true);
    expect(courtyardExpected()).toBe(false);
    off();
  });

  it("gives up after the late allowance, and a courtyard arriving after that is no longer expected (it shows as it mounts)", async () => {
    vi.useFakeTimers();
    const swap = swapToLotus();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + LATE_MS - 1);
    expect(swap.lifted()).toBe(false);
    expect(courtyardExpected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await swap.dim;
    expect(swap.lifted()).toBe(true);
    expect(courtyardExpected()).toBe(false);
    expect(swapHolds()).toBe(0);
  });

  it("asks for a fresh wait on the next swap to a lotus after one was given up", async () => {
    vi.useFakeTimers();
    const first = swapToLotus();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + LATE_MS);
    await first.dim;
    const second = swapToLotus();
    expect(courtyardExpected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.lifted()).toBe(false);
    courtyardReady();
    await second.dim;
    expect(second.lifted()).toBe(true);
  });
});
