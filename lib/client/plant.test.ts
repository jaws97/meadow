// The care layer's pure helpers: the words it shows (soil, weather, bloom outlook, planting day, friends), what a
// resting plant offers, the optimistic effect of care before the server folds it in, and what the 3D plant is given.
import { describe, expect, it } from "vitest";
import { createPlant, dateOfHour, toVisual, type Visual } from "@/lib/sim";
import { isUuid } from "@/lib/server/validate";
import { isRetryable, newEventId, retryDelayMs } from "./api";
import {
  bloomText,
  declinedText,
  easeToward,
  flowerSizeOf,
  friendsLine,
  friendsText,
  istWhen,
  notReadyText,
  outlookText,
  overlayEvents,
  plantLine,
  plantedText,
  rainHint,
  rainHintText,
  rainLead,
  renderTarget,
  restingOf,
  sayLine,
  soilWord,
  thanksFor,
  toggleShown,
  weatherWords,
  withCare,
  type LocalAction,
  type MeView,
  type WeatherNow,
} from "./plant";

const visual = (over: Partial<Visual> = {}): Visual => ({ ...toVisual(createPlant("marigold", 15, "me")), ...over });

const weather = (over: Partial<WeatherNow> = {}): WeatherNow => ({
  h: 100, from: "", until: "", temperatureC: 24.4, humidityPct: 70, rainMm: 0, raining: false, sunWm2: 520, windKmh: 9,
  soilTempC: 23, isDay: true, place: "office", credit: "Weather data by Open-Meteo.com (CC BY 4.0)", upToDate: true, lagHours: 0,
  ...over,
});

/** A view at hour nowH with the state at stateH, for the helpers that read only a few fields. */
function view(over: { nowH?: number; stateH?: number; alive?: boolean; fairyUsed?: boolean; revive?: boolean; replant?: boolean;
  pending?: MeView["pending"]; bloomH?: number | null; forecastH?: number | null; shade?: boolean } = {}) {
  const nowH = over.nowH ?? 100;
  return {
    now: { h: nowH, at: dateOfHour(nowH).toISOString(), clock: 10 },
    state: { h: over.stateH ?? nowH, alive: over.alive ?? true, fairyUsed: over.fairyUsed ?? false, bloomH: over.bloomH ?? null },
    care: {
      water: { ready: true, nextH: null, nextAt: null }, feed: { ready: true, nextH: null, nextAt: null },
      revive: over.revive ?? false, replant: over.replant ?? false, shade: over.shade ?? false, cover: false,
    },
    pending: over.pending ?? [],
    forecast: over.forecastH == null ? null : { bloomH: over.forecastH, bloomAt: dateOfHour(over.forecastH).toISOString(), days: 14 },
  } as unknown as MeView;
}

const action = (kind: LocalAction["kind"], at: number, more: Partial<LocalAction> = {}): LocalAction =>
  ({ id: `${kind}-${at}`, kind, on: null, at, status: "sent", confirmedAt: at + 500, ...more });

describe("words", () => {
  it("names the soil from the model's can advice, soaked past the anoxic point", () => {
    expect(soilWord(visual({ canAdvice: "thirsty", moisture: 0.3 }))).toBe("dry");
    expect(soilWord(visual({ canAdvice: "ready", moisture: 0.5 }))).toBe("ready for a drink");
    expect(soilWord(visual({ canAdvice: "ok", moisture: 0.6 }))).toBe("just right");
    expect(soilWord(visual({ canAdvice: "damp", moisture: 0.7 }))).toBe("damp");
    expect(soilWord(visual({ canAdvice: "damp", moisture: 0.86 }))).toBe("soaked");
    expect(soilWord(visual({ alive: false, canAdvice: "ok", moisture: 0.3 }))).toBe("dry");
  });

  it("words the weather at the office", () => {
    expect(weatherWords(weather()).words).toBe("sunny");
    expect(weatherWords(weather({ sunWm2: 200 })).words).toBe("bright");
    expect(weatherWords(weather({ isDay: false, sunWm2: 0 }))).toMatchObject({ temp: "24°", words: "night", sky: "moon" });
    expect(weatherWords(weather({ raining: true, rainMm: 0.4 })).words).toBe("light rain");
    expect(weatherWords(weather({ raining: true, rainMm: 6 })).spoken).toBe("At the Disney office: 24 degrees, heavy rain.");
  });

  it("hints at skipping the can for real rain now, or heavy rain due soon", () => {
    expect(rainHint(weather(), 100)).toBeNull();
    expect(rainHint(weather({ raining: true, rainMm: 0.5 }), 100)).toBeNull();
    expect(rainHint(weather({ raining: true, rainMm: 2 }), 100)).toEqual({ when: "now", heavy: false, startsInH: 0 });
    expect(rainHint(weather({ raining: true, rainMm: 5 }), 100)).toEqual({ when: "now", heavy: true, startsInH: 0 });
    expect(rainHint(weather({ raining: true, rainMm: 5, lagHours: 3 }), 100)).toBeNull();
    // hour 100 is 04:00 IST on 14 Nov; rain from 19:00 (hour 115) that would soak the bed by itself
    const evening = [115, 116, 117].map((h) => ({ h, rainMm: 4 }));
    expect(rainHint(weather({ forecast: evening }), 100)).toBeNull(); // beyond the next twelve hours
    const tonight = [106, 107, 108].map((h) => ({ h, wx: { P: 4 } }));
    const hint = rainHint(weather({ forecast: tonight }), 100);
    expect(hint).toEqual({ when: "soon", heavy: true, startsInH: 6 });
    expect(rainHintText(hint!, 100)).toBe("Heavy rain this morning; skip the can.");
    expect(rainHintText({ when: "soon", heavy: true, startsInH: 6 }, 110)).toBe("Heavy rain tonight; skip the can.");
    expect(rainHint(weather({ forecast: [{ h: 101, rainMm: 2 }] }), 100)).toBeNull();
  });

  it("says when heavy rain arrives by the first real rain, not a drizzle ahead of it", () => {
    // hour 107 is 11:00 IST; a trickle now, then the downpour from 16:00 (hour 112)
    const rows = [
      { h: 107, rainMm: 0.2 },
      { h: 108, rainMm: 0.1 },
      ...[112, 113, 114, 115].map((h) => ({ h, rainMm: 3 })),
    ];
    const hint = rainHint(weather({ nowH: 107, forecast: rows }), 107);
    expect(hint).toEqual({ when: "soon", heavy: true, startsInH: 5 });
    expect(rainHintText(hint!, 107)).toBe("Heavy rain this afternoon; skip the can.");
    // the same answer read an hour later (kept by the CDN) still counts from the page's own hour
    expect(rainHint(weather({ nowH: 107, forecast: rows }), 108)).toEqual({ when: "soon", heavy: true, startsInH: 4 });
  });

  it("falls back to the route's own rainSoon without forecast rows, and asks nothing of old weather", () => {
    const rainSoon = { heavy: true, mm: 12.4, startsInH: 6 };
    expect(rainHint(weather({ nowH: 107, forecast: [], rainSoon }), 107)).toEqual({ when: "soon", heavy: true, startsInH: 6 });
    expect(rainHint(weather({ nowH: 107, rainSoon }), 109)).toEqual({ when: "soon", heavy: true, startsInH: 4 });
    expect(rainHint(weather({ nowH: 107, rainSoon: { heavy: false, mm: 3, startsInH: 2 } }), 107)).toBeNull();
    expect(rainHint(weather({ nowH: 107, rainSoon: null }), 107)).toBeNull();
    expect(rainHint(weather({ lagHours: 3, rainSoon }), 107)).toBeNull();
  });

  it("names the part of the day the heavy rain comes in", () => {
    // hour 115 is 19:00 IST on 14 Nov
    expect(rainLead({ when: "soon", heavy: true, startsInH: 1 }, 115)).toBe("Heavy rain is on its way");
    expect(rainLead({ when: "soon", heavy: true, startsInH: 4 }, 115)).toBe("Heavy rain tonight");
    expect(rainLead({ when: "soon", heavy: true, startsInH: 11 }, 115)).toBe("Heavy rain tomorrow morning");
    expect(rainLead({ when: "soon", heavy: true, startsInH: 3 }, 103)).toBe("Heavy rain this morning");
    expect(rainLead({ when: "soon", heavy: true, startsInH: 6 }, 106)).toBe("Heavy rain this afternoon");
    expect(rainLead({ when: "now", heavy: false, startsInH: 0 }, 106)).toBe("It is raining at the office");
  });

  it("speaks the plant's line as a sentence", () => {
    expect(sayLine("a little thirsty")).toBe("A little thirsty.");
    expect(sayLine("in bloom; a smaller second-chance flower")).toBe("In bloom; a smaller second-chance flower.");
  });

  it("counts planting days on the IST calendar", () => {
    const planted = dateOfHour(15).toISOString(); // 10 Nov 15:00 IST
    expect(plantedText(planted, dateOfHour(23).getTime())).toBe("Planted today");
    expect(plantedText(planted, dateOfHour(24).getTime())).toBe("Planted yesterday");
    expect(plantedText(planted, dateOfHour(24 * 5 + 2).getTime())).toBe("Planted 5 days ago");
  });

  it("gives the bloom outlook from the forecast", () => {
    expect(bloomText(view({ forecastH: 100 + 24 * 9 + 5 }))).toBe("About 9 days to bloom");
    expect(bloomText(view({ forecastH: 130 }))).toBe("About a day to bloom");
    expect(bloomText(view({ forecastH: 110 }))).toBe("Blooming very soon");
    expect(bloomText(view({ bloomH: 90 }))).toBe("In bloom");
    expect(bloomText(view({ forecastH: null }))).toBeNull();
    expect(bloomText(view({ alive: false, forecastH: 300 }))).toBeNull();
  });

  it("thanks friends by name, and private ones as friends", () => {
    expect(friendsText([])).toBeNull();
    expect(friendsText(["Asha"])).toBe("A sprinkle from Asha today");
    expect(friendsText(["Asha", "A friend"])).toBe("Sprinkles from Asha and a friend today");
    expect(friendsText(["A friend", "Ravi", "A friend"])).toBe("Sprinkles from Ravi and 2 friends today");
  });

  it("thanks a friend's sprinkle as a warm line, by name", () => {
    expect(friendsLine([], "jasmine")).toBeNull();
    expect(friendsLine(["Asha"], "jasmine")).toBe("Asha left a sprinkle for your jasmine today.");
    expect(friendsLine(["A friend"], "rose")).toBe("A friend left a sprinkle for your rose today.");
    expect(friendsLine(["Asha", "Ravi"], "rose")).toBe("Asha and Ravi left sprinkles for your rose today.");
  });

  it("puts the plant's day and its bloom outlook in one chip", () => {
    const at = (nowH: number, plantedH: number, forecastH: number | null, bloomH: number | null = null) =>
      outlookText({ ...view({ nowH, forecastH, bloomH }), plant: { plantedAt: dateOfHour(plantedH).toISOString() } } as MeView, dateOfHour(nowH).getTime());
    expect(at(20, 15, null).text).toBe("Planted today");
    expect(at(20, 15, 15 + 24 * 14).text).toBe("Planted today · about 14 days to bloom");
    const day4 = at(15 + 24 * 4, 15, 15 + 24 * 14);
    expect(day4.text).toBe("Day 4 · about 10 days to bloom");
    expect(day4.spoken).toBe("Day 4 since planting, about 10 days to bloom");
    expect(at(15 + 24 * 15, 15, null, 15 + 24 * 14).text).toBe("Day 15 · in bloom");
  });

  it("lets one voice ask for water: the rain's, the seed's quiet line, else the plant's", () => {
    const me = (stage: string, alive = true) => ({ state: { stage, alive } }) as unknown as MeView;
    const thirsty = { growth: 0.5, mood: "thirsty" as const, alive: true, says: "ready for a drink" };
    expect(plantLine(me("leafy"), thirsty, null)).toEqual({ text: "Ready for a drink.", voice: "plant", mood: "thirsty" });
    const now = { when: "now" as const, heavy: true, startsInH: 0 };
    expect(plantLine(me("leafy"), thirsty, now)).toEqual({ text: "The rain is giving me a drink.", voice: "plant", mood: "content" });
    expect(plantLine(me("leafy"), thirsty, now, true)?.text).toBe("The cover is keeping the rain off me.");
    // heavy rain due later: the plant still says what it feels, and that the rain is coming
    expect(plantLine(me("leafy"), thirsty, { when: "soon", heavy: true, startsInH: 5 })?.text).toBe("Ready for a drink. The rain is on its way.");
    const seed = { growth: 0.01, mood: "content" as const, alive: true, says: "happy" };
    expect(plantLine(me("seed"), seed, null)).toMatchObject({ voice: "narrator", text: expect.stringContaining("settling into the bed") });
    expect(plantLine(me("resting", false), { ...seed, alive: false }, null)).toBeNull();
    expect(thanksFor("talk", null, "jasmine", 0, 0, true)).toBe("Your seed hears you.");
    expect(thanksFor("talk", null, "jasmine", 0, 0)).toBe("Your jasmine glows a little brighter.");
  });

  it("words times in IST the way the server does", () => {
    const now = Date.parse("2026-11-12T04:00:00Z"); // 09:30 IST
    expect(istWhen("2026-11-12T09:30:00Z", now)).toBe("15:00");
    expect(istWhen("2026-11-12T20:30:00Z", now)).toBe("tomorrow at 02:00");
    expect(istWhen("2026-11-14T03:30:00Z", now)).toBe("14 Nov, 09:00");
    expect(notReadyText("water", "2026-11-12T09:30:00Z", "rose", now)).toBe(
      "Your rose had a can of water not long ago; the next one is welcome from 15:00 IST.",
    );
  });

  it("shows the server's calm message, and a kind one when it could not be reached", () => {
    const fail = (code: string, message = "From the server.") => ({ ok: false as const, status: 0, code, message, retryAt: null, extra: {} });
    expect(declinedText("water", fail("too_soon"))).toBe("From the server.");
    expect(declinedText("cover", fail("offline"))).toBe("The rain cover did not reach the garden just now. Please try again in a moment.");
  });
});

describe("resting", () => {
  it("offers the Fairy Dust first, then a second-chance sprout", () => {
    expect(restingOf(view(), [])).toBeNull();
    expect(restingOf(view({ alive: false, revive: true }), [])).toEqual({ mode: "revive" });
    // the card promises a wake only once the server has said yes; until then it is on its way
    expect(restingOf(view({ alive: false, revive: true }), [action("revive", 0, { status: "sending", confirmedAt: 0 })])).toEqual({ mode: "sprinkling" });
    expect(restingOf(view({ alive: false, revive: true }), [action("revive", 0)])).toEqual({ mode: "waking" });
    expect(restingOf(view({ alive: false, fairyUsed: true, replant: true }), [action("replant", 0, { status: "sending", confirmedAt: 0 })]))
      .toEqual({ mode: "sprouting" });
    expect(restingOf(view({ alive: false, fairyUsed: true, replant: true }), [])).toEqual({ mode: "replant" });
    expect(restingOf(view({ alive: false, fairyUsed: true, pending: [{ kind: "replant", h: 100, at: "", on: null }] }), []))
      .toEqual({ mode: "replanting" });
  });

  it("waits for the party before the seeds are handed out, and says when planting has closed", () => {
    expect(restingOf(view({ nowH: -200, alive: false, fairyUsed: true }), [])).toEqual({ mode: "replant-later" });
    expect(restingOf(view({ nowH: 800, alive: false, fairyUsed: true }), [])).toEqual({ mode: "closed" });
  });
});

describe("optimistic care", () => {
  const h = 100;
  const t0 = dateOfHour(h).getTime() + 20 * 60_000;

  it("merges this page's actions with the server's pending list without counting one twice", () => {
    const me = view({ stateH: h, pending: [{ kind: "water", h, at: "", on: null }, { kind: "tend", h, at: "", on: null }] });
    const events = overlayEvents(me, [action("water", t0), action("talk", t0 + 1000)]);
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.kind === "water")?.t).toBe(t0);
    expect(events.find((e) => e.kind === "tend")?.t).toBe(dateOfHour(h).getTime());
    // an action whose hour is already inside the state is the server's truth now
    expect(overlayEvents(view({ stateH: h + 1 }), [action("water", t0)])).toHaveLength(0);
  });

  it("darkens the soil within seconds and firms the leaves over the hour", () => {
    const base = visual({ moisture: 0.5, droop: 0.6, canAdvice: "ready", says: "ready for a drink", mood: "thirsty" });
    const ev = [{ kind: "water" as const, on: null, t: t0 }];
    expect(withCare(base, ev, t0).moisture).toBeCloseTo(0.5, 5);
    const soon = withCare(base, ev, t0 + 8000);
    expect(soon.moisture).toBeGreaterThan(0.74);
    // a drink the plant asked for reads "just right", not damp
    expect(soon.canAdvice).toBe("ok");
    expect(soilWord(soon)).toBe("just right");
    // a can on soil that did not ask reads damp, honestly
    expect(withCare(visual({ moisture: 0.55, canAdvice: "ok" }), ev, t0 + 8000).canAdvice).toBe("damp");
    expect(soon.says).toBe("thank you for the drink");
    expect(soon.droop).toBeGreaterThan(0.55);
    const later = withCare(base, ev, t0 + 3_600_000);
    expect(later.droop).toBeCloseTo(0.6 * 0.15, 5);
    expect(later.moisture).toBeLessThan(soon.moisture);
    expect(later.moisture).toBeGreaterThan(base.moisture);
  });

  it("clears pests when tended and glows after a kind word", () => {
    const base = visual({ pests: 0.5, snails: 2 });
    const tended = withCare(base, [{ kind: "tend", on: null, t: t0 }], t0 + 10_000);
    expect(tended.pests).toBeCloseTo(0.05, 5);
    expect(tended.snails).toBe(0);
    expect(withCare(base, [{ kind: "talk", on: null, t: t0 }], t0 + 5000).glow).toBe(1);
  });

  it("shows a shade or cover change before the server has answered", () => {
    const me = view({ shade: false });
    expect(toggleShown({ me, meAt: t0, local: [action("shade", t0 + 10, { on: true, status: "sending", confirmedAt: 0 })] }, "shade")).toBe(true);
    // confirmed before this view was asked for: the view already knows
    expect(toggleShown({ me, meAt: t0 + 5000, local: [action("shade", t0, { on: true })] }, "shade")).toBe(false);
  });
});

describe("what the 3D plant is given", () => {
  it("measures the flower against a full one, capped for a second-chance sprout", () => {
    expect(flowerSizeOf({ growth: 1, flower: 1, alive: true }, 1)).toBeCloseTo(1, 5);
    expect(flowerSizeOf({ growth: 0.3, flower: 0, alive: true }, 2)).toBe(0.7);
    expect(flowerSizeOf({ growth: 1, flower: 0.6, alive: true }, 1)).toBeCloseTo(0.6, 5);
  });

  it("softens a resting plant to a sleeping one and puts the office's rain on the sky", () => {
    const t = renderTarget({ ...visual({ alive: false, health: 0, droop: 1, bloom: 0 }), glow: 0 }, 1, weather({ raining: true, rainMm: 3 }));
    expect(t).toMatchObject({ health: 0.45, droop: 0.55, bloom: 0 });
    expect(t.rain).toBeGreaterThan(0.5);
    expect(renderTarget({ ...visual(), glow: 0 }, 1, weather()).rain).toBe(0);
  });

  it("carries the shade cloth and the rain cover to the garden, folded away by default", () => {
    expect(renderTarget({ ...visual(), glow: 0 }, 1, null)).toMatchObject({ shade: 0, cover: 0 });
    expect(renderTarget({ ...visual(), glow: 0 }, 1, null, { shade: true, cover: false })).toMatchObject({ shade: 1, cover: 0 });
  });

  it("eases toward a new value without jumping, and steps whole counts", () => {
    const a = renderTarget({ ...visual({ growth: 0.2, mushrooms: 0 }), glow: 0 }, 1, null);
    const b = { ...a, growth: 0.4, mushrooms: 2 };
    const step = easeToward(a, b, 0.4);
    expect(step.growth).toBeGreaterThan(0.2);
    expect(step.growth).toBeLessThan(0.25);
    expect(step.mushrooms).toBe(2);
    let s = a;
    for (let i = 0; i < 100; i++) s = easeToward(s, b, 0.4);
    expect(s.growth).toBe(0.4);
  });
});

describe("api helpers", () => {
  it("retries only the planting throttle and a busy or resting database", () => {
    expect(isRetryable(429, "busy_planting")).toBe(true);
    expect(isRetryable(503, "busy")).toBe(true);
    expect(isRetryable(503, "unavailable")).toBe(true);
    for (const code of ["too_soon", "too_many_links", "too_many_devices", "too_many_changes"]) expect(isRetryable(429, code)).toBe(false);
    expect(isRetryable(503, "meadow_full")).toBe(false);
  });

  it("waits out Retry-After with jitter", () => {
    expect(retryDelayMs(5, 1, () => 0)).toBe(5000);
    expect(retryDelayMs(5, 1, () => 1)).toBe(8500);
    expect(retryDelayMs(null, 2, () => 0)).toBe(3000);
  });

  it("makes ids the server accepts as a clientEventId", () => {
    expect(isUuid(newEventId())).toBe(true);
  });
});
