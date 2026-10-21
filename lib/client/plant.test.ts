// The care layer's pure helpers: the words it shows (soil, weather, bloom outlook, planting day, friends), what a
// resting plant offers, the optimistic effect of care before the server folds it in, and what the 3D plant is given.
import { describe, expect, it } from "vitest";
import { POND, createPlant, dateOfHour, stepPond, toVisual, toVisualPond, type PondState, type PondVisual, type SoilVisual as Visual } from "@/lib/sim";
import { garden } from "@/lib/garden/store";
import { isUuid } from "@/lib/server/validate";
import { isRetryable, newEventId, retryDelayMs } from "./api";
import {
  LOTUS_PICKER_LINE,
  POND_FULL_PROMPT,
  RAIN_POND_LINE,
  JAR_LINE,
  bloomText,
  canMomentFor,
  careKeysFor,
  careLabels,
  declinedText,
  easePond,
  easeToward,
  flowerSizeOf,
  friendsLine,
  friendsText,
  istWhen,
  isTopUp,
  notReadyText,
  koiLine,
  lineAsksForWater,
  outlookText,
  overlayEvents,
  plantLine,
  plantNoun,
  pondShownOf,
  pondStamps,
  pondWord,
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
  pending?: MeView["pending"]; bloomH?: number | null; flowerH?: number | null; forecastH?: number | null; shade?: boolean;
  visual?: Partial<MeView["visual"]> } = {}) {
  const nowH = over.nowH ?? 100;
  const iso = (h: number | null | undefined) => (h == null ? null : dateOfHour(h).toISOString());
  return {
    now: { h: nowH, at: dateOfHour(nowH).toISOString(), clock: 10 },
    state: {
      h: over.stateH ?? nowH, alive: over.alive ?? true, fairyUsed: over.fairyUsed ?? false, bloomH: over.bloomH ?? null,
      bloomedAt: iso(over.bloomH), flowerOpenedAt: iso(over.flowerH ?? over.bloomH),
    },
    visual: { ...over.visual },
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
    // flower after flower: the next bud between them, then the next flower
    expect(bloomText(view({ bloomH: 90, visual: { rebud: 0.3 } }))).toBe("New bud forming");
    expect(bloomText(view({ bloomH: 90, flowerH: 90 + 24 * 17, visual: { rebud: 0 } }))).toBe("In bloom again");
    // a lotus between its flowers keeps to "In bloom"
    expect(bloomText(view({ bloomH: 90, flowerH: 90 + 24 * 9, visual: { medium: "pond" } as Partial<MeView["visual"]> }))).toBe("In bloom");
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
    expect(friendsLine(["Meera"], "lily")).toBe("Meera left a sprinkle for your lily today.");
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
    const between = outlookText(
      { ...view({ nowH: 15 + 24 * 23, bloomH: 15 + 24 * 14, visual: { rebud: 0.4 } }), plant: { plantedAt: dateOfHour(15).toISOString() } } as MeView,
      dateOfHour(15 + 24 * 23).getTime(),
    );
    expect(between.text).toBe("Day 23 · new bud forming");
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

  it("offers the sprout at any hour, before the party and long after it: planting never closes", () => {
    expect(restingOf(view({ nowH: -200, alive: false, fairyUsed: true, replant: true }), [])).toEqual({ mode: "replant" });
    expect(restingOf(view({ nowH: 800, alive: false, fairyUsed: true, replant: true }), [])).toEqual({ mode: "replant" });
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
    const ev = [{ kind: "water" as const, on: null, t: t0, mine: true }];
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

  it("starts the watering can's moment for this page's own can on a living soil plant, read against the soil before it", () => {
    const me = (v: Partial<Visual>, alive = true) => ({ ...view({ stateH: h, alive }), visual: visual({ ...v, alive }) }) as unknown as MeView;
    expect(canMomentFor(me({ canAdvice: "ready", says: "ready for a drink", mood: "thirsty", moisture: 0.2 }), "water", [], t0)).toEqual({
      at: t0,
      refusedAt: 0,
      soil: "thirsty",
    });
    expect(canMomentFor(me({ canAdvice: "ok", moisture: 0.45 }), "water", [], t0)?.soil).toBe("ok");
    expect(canMomentFor(me({ canAdvice: "damp", moisture: 0.7 }), "water", [], t0)?.soil).toBe("damp");
    // a second can within the hour reads the soil the first one left: damp
    expect(canMomentFor(me({ canAdvice: "ok", moisture: 0.5 }), "water", [action("water", t0 - 60_000)], t0)?.soil).toBe("damp");
    // never for another kind of care, or for a resting plant
    expect(canMomentFor(me({}), "tend", [], t0)).toBeNull();
    expect(canMomentFor(me({}), "cover", [], t0)).toBeNull();
    expect(canMomentFor(me({}, false), "water", [], t0)).toBeNull();
  });

  it("clears pests when tended and glows after a kind word", () => {
    const base = visual({ pests: 0.5, snails: 2 });
    const tended = withCare(base, [{ kind: "tend", on: null, t: t0, mine: true }], t0 + 10_000);
    expect(tended.pests).toBeCloseTo(0.05, 5);
    expect(tended.snails).toBe(0);
    expect(withCare(base, [{ kind: "talk", on: null, t: t0, mine: true }], t0 + 5000).glow).toBe(1);
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

describe("the lotus", () => {
  const rows = (h: number) => ({ T: 25, RH: 70, P: 0, SW: h % 24 >= 7 && h % 24 <= 17 ? 500 : 0, ET0: 0.2, U: 6, Ts: 24, isDay: (h % 24 >= 7 && h % 24 <= 17 ? 1 : 0) as 0 | 1 });
  const lotusState = (over: Partial<PondState> = {}): PondState => ({ ...createPlant("lotus", 15, "me"), ...over });
  const pondV = (over: Partial<PondVisual> = {}, s: Partial<PondState> = {}): PondVisual => ({ ...toVisualPond(lotusState(s)), ...over });
  const water = (t: number, mine = true) => [{ kind: "water" as const, on: null, t, mine }];

  it("has four care buttons and its own words on two of them", () => {
    expect(careKeysFor("lotus")).toEqual(["water", "feed", "tend", "talk"]);
    expect(careKeysFor("rose")).toEqual(["water", "shade", "cover", "feed", "tend", "talk"]);
    expect(careLabels(pondV())).toEqual({ water: "Fresh water", tend: "Tend the pond" });
    expect(careLabels(pondV({ moveReady: true }))).toEqual({ water: "Plant in the pond", tend: "Tend the pond" });
    expect(careLabels(pondV({ stage: "pond" }))).toEqual({ water: "Top up the pond", tend: "Tend the pond" });
    expect(careLabels(visual())).toEqual({ water: "Water", tend: "Tend" });
    expect(plantNoun("lotus")).toBe("lotus");
    // the Pink Lily is a soil flower: the bed's six buttons, called by its own name
    expect(careKeysFor("lily")).toEqual(careKeysFor("rose"));
    expect(plantNoun("lily")).toBe("lily");
  });

  it("names the water in the Pond chip: the jar's clearness, then the pond's level against its line", () => {
    expect(pondWord(pondV({ jarClarity: 0.95 }))).toBe("clear");
    expect(pondWord(pondV({ jarClarity: 0.7 }))).toBe("clouding");
    expect(pondWord(pondV({ jarClarity: 0.3 }))).toBe("cloudy");
    const p = (waterMM: number, more: Partial<PondVisual> = {}) => pondWord(pondV({ stage: "pond", waterMM, potIsolated: waterMM < -25, potDry: false, ...more }));
    expect(p(2)).toBe("at its line");
    // from where a bucket would spill (and the top-up asks first), the chip has its own word
    expect(p(POND.fullMM)).toBe("full");
    expect(p(POND.fullMM - 0.5)).toBe("at its line");
    expect(p(-12)).toBe("could use a top-up");
    expect(p(-20)).toBe("low");
    expect(p(-40)).toBe("below the pot");
    expect(p(-80, { potDry: true })).toBe("the pot is drying");
  });

  it("shows fresh jar water, the planting and a bucket at once", () => {
    const t0 = Date.UTC(2026, 10, 12, 4);
    const cloudy = pondV({ jarClarity: 0.4, canAdvice: "ready", says: "time for fresh water" });
    const fresh = withCare(cloudy, water(t0), t0 + 1000);
    expect(fresh).toMatchObject({ medium: "pond", stage: "jar", canAdvice: "damp", says: "thank you for the fresh water" });
    expect((fresh as PondVisual).jarClarity).toBeGreaterThan(0.95);
    const ready = pondV({ moveReady: true, says: "my root and first leaf are out; plant me in my pot in the pond" });
    expect(withCare(ready, water(t0), t0 + 1000)).toMatchObject({ stage: "pond", moveReady: false, says: "I have settled into my pot in the pond" });
    const low = pondV({ stage: "pond", waterMM: -15, pondMM: -15, canAdvice: "ready", says: "the pond could use a top-up" });
    const topped = withCare(low, water(t0), t0 + 1000) as PondVisual;
    expect(topped.waterMM).toBeCloseTo(-15 + POND.can / 1.3038, 1);
    expect(topped.says).toBe("thank you for the top-up");
    // a full pond spills at the notch: never above +20 mm
    expect((withCare(pondV({ stage: "pond", waterMM: 15 }), water(t0), t0 + 1000) as PondVisual).waterMM).toBe(20);
    expect(withCare(pondV({ stage: "pond", waterMM: 15 }), water(t0), t0 + 1000).canAdvice).toBe("damp");
  });

  it("a tend feeds the koi and rinses the aphids", () => {
    const t0 = Date.UTC(2026, 10, 12, 4);
    const hungry = pondV({ stage: "pond", koiHunger: 0.8, koiGather: 0, koiAdvice: "hungry", aphids: 0.5, pests: 0.5, says: "the koi are hungry" });
    const fed = withCare(hungry, [{ kind: "tend", on: null, t: t0, mine: true }], t0 + 10_000) as PondVisual;
    expect(fed).toMatchObject({ koiGather: 1, koiAdvice: "fed", says: "the koi are fed" });
    expect(fed.koiHunger).toBe(0);
    expect(fed.aphids).toBeCloseTo(0.05, 5);
  });

  it("a tend inside the koi's four hours only rinses: no gathering, no fed koi, no pinch to play", () => {
    const t0 = Date.UTC(2026, 10, 12, 4);
    const v = pondV({ stage: "pond", koiHunger: 0.3, koiGather: 0, koiAdvice: "ready", aphids: 0.5, pests: 0.5, says: "aphids on my leaves; wash them into the pond for the koi" });
    const rinse = [{ kind: "tend" as const, on: null, t: t0, mine: true, pinch: false }];
    const rinsed = withCare(v, rinse, t0 + 10_000) as PondVisual;
    expect(rinsed).toMatchObject({ koiGather: 0, koiAdvice: "ready", koiHunger: 0.3, says: "the aphids are rinsed into the pond" });
    expect(rinsed.aphids).toBeCloseTo(0.05, 5);
    expect(pondStamps({ stage: "pond", moveReady: false }, rinse)).toEqual({ topUpAt: 0, pinchAt: 0, plantedAt: 0 });
    expect(thanksFor("tend", null, "lotus", 0.5, 0, false, v, false)).toMatch(/^The aphids rinsed into the pond/);
    expect(thanksFor("tend", null, "lotus", 0, 0, false, v, false)).toMatch(/koi had their pinch not long ago/);
  });

  it("marks which tends were the koi's pinch, as the server counts them", () => {
    const h = 300, at = (hh: number, min = 10) => dateOfHour(hh).getTime() + min * 60_000;
    const lotusView = (koi: MeView["care"]["koi"], pending: MeView["pending"] = []) =>
      ({ ...view({ nowH: h, stateH: h - 1, pending }), care: { ...view().care, koi } }) as unknown as MeView;
    const pinches = (me: MeView, local: LocalAction[]) => overlayEvents(me, local).filter((e) => e.kind === "tend").map((e) => e.pinch);
    // the koi were fed two hours ago: a tend now only rinses; one fed five hours ago: a tend now is their pinch
    expect(pinches(lotusView({ ready: false, nextAt: dateOfHour(h + 2).toISOString(), lastAt: dateOfHour(h - 2).toISOString() }), [action("tend", at(h))])).toEqual([false]);
    expect(pinches(lotusView({ ready: true, nextAt: null, lastAt: dateOfHour(h - 5).toISOString() }), [action("tend", at(h))])).toEqual([true]);
    expect(pinches(lotusView({ ready: true, nextAt: null, lastAt: null }), [action("tend", at(h))])).toEqual([true]);
    // a pending tend the server counted is the pinch; a second one an hour later is not
    const counted = lotusView({ ready: false, nextAt: dateOfHour(h + 3).toISOString(), lastAt: dateOfHour(h - 1).toISOString() }, [{ kind: "tend", h: h - 1, at: "", on: null }]);
    expect(pinches(counted, [action("tend", at(h))])).toEqual([true, false]);
    // a soil flower's view says nothing of koi: nothing is marked
    expect(overlayEvents(view({ stateH: h }), [action("tend", at(h))])[0].pinch).toBeUndefined();
  });

  it("thanks friends for a sprinkle by the pond as the kind thought it is", () => {
    expect(friendsLine(["Asha"], "lotus", true)).toBe("Asha left a sprinkle by your pond today, a kind thought for your lotus.");
    expect(friendsLine(["Asha", "A friend"], "lotus", true)).toBe("Asha and a friend left sprinkles by your pond today, kind thoughts for your lotus.");
    expect(friendsLine(["Asha"], "rose")).toBe("Asha left a sprinkle for your rose today.");
  });

  it("stamps this device's own top-up, pinch and planting, and nobody else's", () => {
    const t0 = Date.UTC(2026, 10, 12, 4);
    expect(pondStamps({ stage: "pond", moveReady: false }, [...water(t0), { kind: "tend", on: null, t: t0 + 5, mine: true }])).toEqual({ topUpAt: t0, pinchAt: t0 + 5, plantedAt: 0 });
    expect(pondStamps({ stage: "jar", moveReady: true }, water(t0))).toEqual({ topUpAt: 0, pinchAt: 0, plantedAt: t0 });
    expect(pondStamps({ stage: "jar", moveReady: false }, water(t0))).toEqual({ topUpAt: 0, pinchAt: 0, plantedAt: 0 });
    expect(pondStamps({ stage: "pond", moveReady: false }, water(t0, false))).toEqual({ topUpAt: 0, pinchAt: 0, plantedAt: 0 });
    // the brass pot has its own pour: the soil garden's watering can never plays for a lotus
    expect(canMomentFor({ ...view(), visual: pondV() } as unknown as MeView, "water", [], t0)).toBeNull();
  });

  it("knows a top-up, the press the brass pot pours for (a refused one is said outright, so the pot goes home)", () => {
    expect(isTopUp({ visual: pondV({ stage: "pond" }) }, "water")).toBe(true);
    // in the jar the water action freshens it or plants the seedling; tending the pond pours nothing
    expect(isTopUp({ visual: pondV({ stage: "jar" }) }, "water")).toBe(false);
    expect(isTopUp({ visual: pondV({ stage: "pond" }) }, "tend")).toBe(false);
    expect(isTopUp({ visual: visual() }, "water")).toBe(false);
  });

  it("gives the garden its pond, easing the levels and stepping the counts", () => {
    let s = lotusState({ stage: 1, movedH: 15, D: 0.3 });
    for (let h = 15; h < 40; h++) s = stepPond(s, { h, wx: rows(h) }, []);
    const v = toVisualPond(s);
    const a = pondShownOf(v);
    expect(a).toMatchObject({ stage: "pond", topUpAt: 0, pinchAt: 0, plantedAt: 0, floatLeaves: v.floatLeaves });
    const b = { ...a, waterMM: a.waterMM + 11.5, floatLeaves: a.floatLeaves + 1, topUpAt: 123 };
    const one = easePond(a, b, 0.4);
    expect(one.waterMM).toBeGreaterThan(a.waterMM);
    expect(one.waterMM).toBeLessThan(b.waterMM);
    expect(one.floatLeaves).toBe(b.floatLeaves);
    expect(one.topUpAt).toBe(123);
    let e = a;
    for (let i = 0; i < 60; i++) e = easePond(e, b, 0.4);
    expect(e.waterMM).toBe(b.waterMM);
    // a soil flower has none, and the store starts without one
    expect(garden.get().pond).toBeNull();
  });

  it("speaks for a calm seed in its jar, and lets the rain answer the pond's level but never the jar", () => {
    const me = view();
    const jar = pondV({ mood: "content", says: "a seed in clear water, waking up" });
    expect(plantLine(me, jar, null)).toEqual({ text: JAR_LINE, voice: "narrator", mood: "content" });
    expect(plantLine(me, pondV({ says: "time for fresh water" }), { when: "now", heavy: true, startsInH: 0 })?.text).toBe("Time for fresh water.");
    const low = pondV({ stage: "pond", mood: "content", says: "the pond could use a top-up" });
    expect(plantLine(me, low, { when: "now", heavy: true, startsInH: 0 })?.text).toBe(RAIN_POND_LINE);
    expect(lineAsksForWater("the pond is low")).toBe(true);
    expect(lineAsksForWater("time for fresh water")).toBe(true);
    expect(rainHintText({ when: "soon", heavy: true, startsInH: 3 }, 100, "lotus")).toMatch(/; it will top up the pond\.$/);
  });

  it("thanks and declines in a lotus's words", () => {
    expect(thanksFor("water", null, "lotus", 0, 0, true, pondV())).toBe("Fresh water for the jar. Your seed rests easy.");
    expect(thanksFor("water", null, "lotus", 0, 0, false, pondV({ stage: "pond" }))).toMatch(/^A bucket for the pond/);
    expect(thanksFor("water", null, "lotus", 0, 0, false, pondV({ stage: "pond", waterMM: -15 }))).toMatch(/rises a little toward its line/);
    expect(thanksFor("water", null, "lotus", 0, 0, false, pondV({ stage: "pond", waterMM: -4 }))).toMatch(/back at its line/);
    // at its line already (the chip says so) but short of full: no question, and it never claims the water came back
    expect(thanksFor("water", null, "lotus", 0, 0, false, pondV({ stage: "pond", waterMM: 0.3 }))).toBe("A bucket for the pond. It rises a little above its line.");
    // asked first (POND_FULL_PROMPT), a bucket on a full pond spills, and the words say so
    expect(thanksFor("water", null, "lotus", 0, 0, false, pondV({ stage: "pond", waterMM: 9.4 }))).toMatch(/spills through the notch/);
    expect(thanksFor("tend", null, "lotus", 0.5, 0, false, pondV({ stage: "pond" }))).toMatch(/aphids rinsed into the pond/);
    expect(thanksFor("talk", null, "lotus", 0, 1, true, pondV())).toBe("A kind word. Your seed rests easy in its jar.");
    expect(notReadyText("water", null, "lotus", 0, pondV({ stage: "pond" }))).toMatch(/^The pond had a bucket not long ago/);
    // the last water was the planting: no bucket yet
    expect(notReadyText("water", null, "lotus", 0, pondV({ stage: "pond" }), true)).toMatch(/^Your seedling is settling into its pot; the pond's first top-up is welcome from/);
    expect(notReadyText("water", null, "lotus", 0, pondV({ moveReady: true }), true)).toMatch(/^Your seedling is settling into its pot;/);
    expect(notReadyText("feed", null, "lotus", 0, pondV({ stage: "pond" }))).toMatch(/lotus tablet/);
    expect(declinedText("tend", { ok: false, status: 0, code: "offline", message: "", retryAt: null, extra: {} }, "lotus")).toMatch(/^The pinch for the koi did not reach/);
    expect(POND_FULL_PROMPT.title).toBe("The pond is at its line. Top up anyway?");
    expect(LOTUS_PICKER_LINE).toMatch(/needs you most in its first days/);
  });

  it("says when the koi were fed, or that they are hungry", () => {
    const nowMs = Date.parse("2026-11-12T06:30:00Z");
    const me = (koi: MeView["care"]["koi"], v: Partial<PondVisual> = {}) =>
      ({ state: { alive: true }, visual: pondV({ stage: "pond", ...v }), care: { koi } }) as unknown as MeView;
    expect(koiLine(me({ ready: false, nextAt: null, lastAt: "2026-11-12T02:30:00Z" }), nowMs)).toBe("Koi fed at 08:00");
    expect(koiLine(me({ ready: true, nextAt: null, lastAt: "2026-11-11T12:30:00Z" }), nowMs)).toBe("Koi fed yesterday at 18:00");
    expect(koiLine(me({ ready: true, nextAt: null, lastAt: null }, { koiAdvice: "hungry" }), nowMs)).toBe("The koi are hungry");
    expect(koiLine({ ...view(), visual: visual() } as unknown as MeView, nowMs)).toBeNull();
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
