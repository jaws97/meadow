// What the care layer shows for a lotus (careStates.ts) and the resting card's words (RestingCard copyFor): the Pond
// chip and the jar's, the koi chip, the four buttons' small words and cues, the questions before food that would do
// harm, and when a tend explains instead of feeding nobody. The lotus is the model's own (lib/sim/pond.ts), with a
// field or two set for each case.
import { describe, expect, it } from "vitest";
import { copyFor } from "@/components/care/RestingCard";
import {
  koiChip,
  koiWaitText,
  lotusFeedQuestion,
  lotusFeedState,
  lotusTendState,
  lotusWaterState,
  pondChip,
  saysKoiHungry,
  shortWhen,
  tabWords,
  tendWouldWait,
} from "@/components/care/careStates";
import type { MeView, RainHint, ShownPondVisual } from "@/lib/client/plant";
import { POND, createPlant, dateOfHour, toVisualPond, type PondState, type PondVisual } from "@/lib/sim";

const NOW_H = 24 * 3 + 10; // 13 Nov, 10:00 IST (game hour 0 is midnight IST on 10 Nov)
const NOW = dateOfHour(NOW_H).getTime();
const iso = (h: number) => dateOfHour(h).toISOString();

const lotus = (over: Partial<PondState> = {}): PondState => ({ ...createPlant("lotus", 15, "me"), ...over });
/** The model's visual for a new lotus seed, with a few fields set, as the care layer shows it. */
const shown = (over: Partial<ShownPondVisual> = {}): ShownPondVisual => {
  const v = toVisualPond(lotus());
  return { ...v, glow: 0, says: v.says, ...over };
};
const inPond = (over: Partial<ShownPondVisual> = {}) => shown({ stage: "pond", moveReady: false, jarClarity: 1, ...over });

const ready = { ready: true, nextH: null, nextAt: null };
const waiting = (h: number) => ({ ready: false, nextH: h, nextAt: iso(h) });
const koiFed = (lastH: number, nextH: number | null) => ({ ready: nextH === null, nextAt: nextH === null ? null : iso(nextH), lastAt: iso(lastH) });
const view = (koi: MeView["care"]["koi"], v: Partial<PondVisual> = {}) =>
  ({ state: { alive: true }, visual: { ...toVisualPond(lotus()), stage: "pond", ...v }, care: { koi } }) as unknown as MeView;

const rainNow: RainHint = { when: "now", heavy: false, startsInH: 0 };

describe("the pond chip", () => {
  const calm = { lineAsks: false, rain: false, resting: false };

  it("reads the jar's water while the seed is in it, and asks when it clouds", () => {
    expect(pondChip(shown({ jarClarity: 1 }), calm)).toMatchObject({ kind: "jar", text: "Jar water clear", ask: false, clarity: 1 });
    expect(pondChip(shown({ jarClarity: 0.6 }), calm)).toMatchObject({ kind: "jar", text: "Jar water clouding", ask: true });
    expect(pondChip(shown({ jarClarity: 0.1 }), calm).text).toBe("Jar water cloudy");
    // the plant's own line already asks for fresh water: said once
    expect(pondChip(shown({ jarClarity: 0.6 }), { ...calm, lineAsks: true }).ask).toBe(false);
    // rain never freshens a jar, so it does not quiet the chip
    expect(pondChip(shown({ jarClarity: 0.6 }), { ...calm, rain: true }).ask).toBe(true);
  });

  it("reads the pond's level against its fill line once planted", () => {
    expect(pondChip(inPond({ waterMM: 0 }), calm)).toMatchObject({ kind: "pond", text: "Pond at its line", ask: false, levelMM: 0 });
    // full from where a bucket would spill: the level at which the top-up asks first
    expect(pondChip(inPond({ waterMM: 11.3 }), calm)).toMatchObject({ text: "Pond full", ask: false });
    expect(pondChip(inPond({ waterMM: -12 }), calm)).toMatchObject({ text: "Pond could use a top-up", ask: true });
    expect(pondChip(inPond({ waterMM: -20 }), calm)).toMatchObject({ text: "Pond low", ask: true });
    expect(pondChip(inPond({ waterMM: -40, potIsolated: true }), calm).text).toBe("Pond below the pot");
    expect(pondChip(inPond({ waterMM: -60, potIsolated: true, potDry: true }), calm).text).toBe("Pot drying");
  });

  it("describes rather than asks when the plant's line or the rain already speaks for the pond", () => {
    expect(pondChip(inPond({ waterMM: -12 }), { ...calm, lineAsks: true })).toMatchObject({ text: "Pond a little down", ask: false });
    expect(pondChip(inPond({ waterMM: -12 }), { ...calm, rain: true })).toMatchObject({ text: "Pond a little down", ask: false });
    expect(pondChip(inPond({ waterMM: -20 }), { ...calm, resting: true }).ask).toBe(false);
  });
});

describe("the koi chip", () => {
  it("says when the koi were last fed, or that they are hungry", () => {
    const fed = koiChip(view(koiFed(NOW_H - 2, NOW_H + 2), { koiAdvice: "fed" }), inPond({ koiAdvice: "fed" }), NOW);
    expect(fed).toEqual({ text: "Koi fed at 08:00", ask: false });
    expect(koiChip(view(koiFed(NOW_H - 30, null), { koiAdvice: "hungry" }), inPond({ koiAdvice: "hungry" }), NOW)).toEqual({ text: "The koi are hungry", ask: true });
  });

  it("never says hungry just after this page's own pinch, nor twice beside the plant's own line", () => {
    // the server's visual is from the top of the hour; the shown one carries the pinch given a moment ago
    expect(koiChip(view(koiFed(NOW_H - 30, null), { koiAdvice: "hungry" }), inPond({ koiAdvice: "fed" }), NOW)?.ask).toBe(false);
    const says = "the koi are nibbling my young leaves; they are hungry";
    expect(saysKoiHungry(says)).toBe(true);
    expect(saysKoiHungry("the koi have had plenty today; leftover food clouds the water")).toBe(false);
    expect(koiChip(view(koiFed(NOW_H - 30, null), { koiAdvice: "hungry" }), inPond({ koiAdvice: "hungry", says }), NOW)?.text).toMatch(/^Koi fed/);
  });

  it("is not shown for a flower of the bed", () => {
    const soil = { state: { alive: true }, visual: { says: "happy" }, care: { koi: null } } as unknown as MeView;
    expect(koiChip(soil, inPond(), NOW)).toBeNull();
  });
});

describe("the four buttons", () => {
  it("water: breathes for the jar, the planting and a thirsty pond; waits on rain only in the pond", () => {
    expect(lotusWaterState(shown({ canAdvice: "ready" }), ready, null, NOW)).toMatchObject({ cue: "ready", srHint: "your seed would like fresh water" });
    expect(lotusWaterState(shown({ canAdvice: "ready", moveReady: true }), ready, null, NOW).srHint).toBe("your seedling is ready to go into its pot");
    expect(lotusWaterState(inPond({ canAdvice: "thirsty" }), ready, null, NOW)).toMatchObject({ cue: "thirsty", srHint: "the pond would like a top-up" });
    expect(lotusWaterState(inPond({ canAdvice: "damp" }), ready, null, NOW)).toEqual({ sub: null, cue: null });
    // rain tops up the pond: no cue, the reason under the button
    expect(lotusWaterState(inPond({ canAdvice: "thirsty" }), ready, rainNow, NOW)).toMatchObject({ sub: "raining", subTone: "rain", cue: null });
    // but it does nothing for a jar
    expect(lotusWaterState(shown({ canAdvice: "ready" }), ready, rainNow, NOW).cue).toBe("ready");
    // inside its four hours it says from when
    expect(lotusWaterState(inPond(), waiting(NOW_H + 3), null, NOW)).toMatchObject({ sub: shortWhen(iso(NOW_H + 3), NOW), resting: true });
  });

  it("feed: the model's warning on the button itself", () => {
    expect(lotusFeedState(shown({ feedAdvice: "young" }), ready, NOW).sub).toBe("too young");
    expect(lotusFeedState(inPond({ feedAdvice: "rich" }), ready, NOW).sub).toBe("already rich");
    expect(lotusFeedState(inPond({ feedAdvice: "hungry" }), ready, NOW)).toMatchObject({ sub: "asking for food", cue: "ready" });
    expect(lotusFeedState(inPond({ feedAdvice: "ok" }), ready, NOW)).toEqual({ sub: null, cue: null });
    expect(lotusFeedState(inPond({ feedAdvice: "young" }), waiting(NOW_H + 30), NOW).resting).toBe(true);
  });

  it("tend: the koi's hunger, the aphids, and from when the next pinch counts", () => {
    expect(lotusTendState(inPond({ koiAdvice: "hungry" }), koiFed(NOW_H - 30, null), NOW)).toMatchObject({ sub: "koi hungry", cue: "ready" });
    expect(lotusTendState(inPond({ koiAdvice: "ready", aphids: 0.5 }), koiFed(NOW_H - 12, null), NOW).sub).toBe("aphids");
    const soon = lotusTendState(inPond({ koiAdvice: "fed", aphids: 0 }), koiFed(NOW_H - 1, NOW_H + 3), NOW);
    expect(soon).toMatchObject({ sub: shortWhen(iso(NOW_H + 3), NOW), resting: true });
    expect(lotusTendState(inPond({ koiAdvice: "ready" }), koiFed(NOW_H - 12, null), NOW)).toEqual({ sub: null, cue: null });
  });

  it("a tend waits (and explains) only when it would feed nobody and rinse nothing", () => {
    expect(tendWouldWait(inPond({ aphids: 0 }), koiFed(NOW_H - 1, NOW_H + 3))).toBe(true);
    expect(tendWouldWait(inPond({ aphids: 0.6 }), koiFed(NOW_H - 1, NOW_H + 3))).toBe(false);
    expect(tendWouldWait(inPond({ aphids: 0 }), koiFed(NOW_H - 5, null))).toBe(false);
    expect(tendWouldWait(inPond(), null)).toBe(false);
    const text = koiWaitText(koiFed(NOW_H - 1, NOW_H + 3), NOW);
    expect(text).toMatch(/^The koi had a pinch at \d\d:\d\d\. The next is welcome from \d\d:\d\d IST; food they cannot finish clouds the water\.$/);
  });
});

describe("the questions before lotus food", () => {
  it("asks in the jar, before the second standing leaf, and on a rich mud; not when food is welcome", () => {
    expect(lotusFeedQuestion({ stage: "jar", feedAdvice: "young" })?.title).toBe("A seed in its jar needs no food. Feed anyway?");
    expect(lotusFeedQuestion({ stage: "pond", feedAdvice: "young" })?.body).toMatch(/second standing leaf/);
    expect(lotusFeedQuestion({ stage: "pond", feedAdvice: "rich" })?.title).toBe("The mud is already rich. Feed anyway?");
    expect(lotusFeedQuestion({ stage: "pond", feedAdvice: "hungry" })).toBeNull();
    expect(lotusFeedQuestion({ stage: "pond", feedAdvice: "ok" })).toBeNull();
  });

  it("matches the model: food is young through the jar and until the standing leaves are up", () => {
    expect(toVisualPond(lotus()).feedAdvice).toBe("young");
    expect(POND.feedGapH).toBe(48);
  });
});

describe("the resting card's words", () => {
  it("speaks of the pond and a second-chance seedling for a lotus, the bed and a sprout otherwise", () => {
    expect(copyFor({ mode: "revive" }, "lotus", "pond").body).toBe("A pinch of Fairy Dust can wake it, once, and bring the pond back to its line.");
    expect(copyFor({ mode: "revive" }, "lotus", "jar").body).toMatch(/fresh water in its jar/);
    expect(copyFor({ mode: "replant" }, "lotus", "pond")).toMatchObject({
      body: expect.stringContaining("same pond"),
      action: { label: "Plant a second-chance seedling", kind: "replant" },
    });
    expect(copyFor({ mode: "replant" }, "rose").body).toMatch(/same bed/);
    for (const mode of ["sprinkling", "waking", "sprouting", "replanting", "closed"] as const) {
      expect(copyFor({ mode }, "lotus", "pond").title.length).toBeGreaterThan(0);
      expect(copyFor({ mode }, "lotus", "pond").body).not.toMatch(/\bbed\b|sprout\b/);
    }
  });
});

describe("the tucked-away card's tab", () => {
  const bed = { resting: false, pond: false };
  const plant = (mood: "content" | "blooming" | "thirsty" | "soggy" | "unwell" | "resting") => ({ voice: "plant" as const, mood });

  it("says how the plant is in a few words", () => {
    expect(tabWords({ voice: "narrator", mood: "content" }, bed)).toEqual({ words: "Settling in", mood: "content", asks: false });
    expect(tabWords(plant("content"), bed)).toEqual({ words: "Growing well", mood: "content", asks: false });
    expect(tabWords(plant("blooming"), bed)).toEqual({ words: "In bloom", mood: "blooming", asks: false });
    expect(tabWords(plant("resting"), bed).words).toBe("Resting");
    expect(tabWords(null, bed).words).toBe("Your garden");
  });

  it("asks, in the plant's own terms, when its mood asks for something", () => {
    expect(tabWords(plant("thirsty"), bed)).toEqual({ words: "Ready for a drink", mood: "thirsty", asks: true });
    expect(tabWords(plant("thirsty"), { resting: false, pond: true }).words).toBe("Ready for a top-up");
    expect(tabWords(plant("soggy"), bed)).toMatchObject({ words: "Roots too wet", asks: true });
    expect(tabWords(plant("unwell"), bed)).toMatchObject({ words: "Needs some care", asks: true });
  });

  it("calls a plant that has gone to sleep resting, whatever its line", () => {
    expect(tabWords(plant("unwell"), { resting: true, pond: false })).toEqual({ words: "Resting", mood: "resting", asks: false });
  });
});
