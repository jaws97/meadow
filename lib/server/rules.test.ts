// The rules around the model: the planting window, when a retried planting gets the original, idempotent retries and
// rate limits for care, shade and cover changes, the conditions for Fairy Dust and replanting, how stored rows become
// the model's events, the IST clock helpers, and the Meadow's bands.
import { describe, expect, it } from "vitest";
import {
  BED,
  PLANT_OPEN_H,
  POND,
  POND_NONE,
  createPlant,
  dateOfHour,
  step,
  toVisual,
  type HourWeather,
  type PondState,
  type SimEvent,
  type SoilState as PlantState,
} from "@/lib/sim";
import {
  bloomBand,
  careStatus,
  decideCare,
  decideSeedReplay,
  formatIstHour,
  healthBand,
  istClock,
  istDayOfHour,
  lastPinchH,
  plantingOpensText,
  plantingWindow,
  sprinkleMessage,
  stageOf,
  toRecordedEvent,
  toTimedEvent,
  SEED_REPLAY_WINDOW_MS,
  TOGGLES_PER_HOUR,
  type CareContext,
  type RecordedEvent,
} from "./rules";

const OWNER = "8d1f6a52-0d5c-4bb4-9f25-3d0e5b8f1a01";
const fresh = (over: Partial<PlantState> = {}): PlantState => ({ ...createPlant("rose", 17, OWNER), ...over });
const asleep = (over: Partial<PlantState> = {}) => fresh({ alive: false, diedH: 90, ...over });

let nextId = 1;
function ev(kind: RecordedEvent["kind"], h: number, extra: Partial<RecordedEvent> = {}): RecordedEvent {
  const id = nextId++;
  return { id, h, kind, on: null, actorId: null, clientEventId: `client-${id}-event`, ...extra };
}
function ctx(over: Partial<CareContext> = {}): CareContext {
  return { state: fresh(), pending: [], existing: null, nowH: 100, checkpointH: 100, ...over };
}

describe("planting window", () => {
  // from the model's PLANT_OPEN_H, so choosing another opening hour in lib/sim needs no change here
  it("opens at the party (PLANT_OPEN_H on 10 Nov) and closes after 10 Dec", () => {
    expect(plantingWindow(PLANT_OPEN_H, false)).toBe("open");
    expect(plantingWindow(743, false)).toBe("open");
    expect(plantingWindow(744, false)).toBe("closed");
    expect(plantingWindow(PLANT_OPEN_H - 1, false)).toBe("early");
    expect(plantingWindow(-600, false)).toBe("early");
  });

  it("names the opening moment from the model's PLANT_OPEN_H", () => {
    expect(plantingOpensText()).toMatch(/^\d{1,2} Nov at \d{2}:00 IST$/);
  });

  it("allows rehearsals before the party only when enabled, never after the close", () => {
    expect(plantingWindow(PLANT_OPEN_H - 1, true)).toBe("rehearsal");
    expect(plantingWindow(-600, true)).toBe("rehearsal");
    expect(plantingWindow(744, true)).toBe("closed");
  });
});

describe("IST helpers", () => {
  it("dates sprinkles by the IST calendar day", () => {
    expect(istDayOfHour(0)).toBe("2026-11-10");
    expect(istDayOfHour(23)).toBe("2026-11-10");
    expect(istDayOfHour(24)).toBe("2026-11-11");
    expect(istDayOfHour(-1)).toBe("2026-11-09");
  });

  it("reads the fractional IST clock of a moment", () => {
    const halfPastTwo = new Date(dateOfHour(14).getTime() + 30 * 60_000);
    expect(istClock(halfPastTwo)).toBeCloseTo(14.5, 9);
    expect(istClock(dateOfHour(-1))).toBeCloseTo(23, 9);
  });

  it("formats an hour relative to now", () => {
    expect(formatIstHour(15, 10)).toBe("15:00");
    expect(formatIstHour(27, 10)).toBe("tomorrow at 03:00");
    expect(formatIstHour(24 * 3 + 9, 10)).toBe("13 Nov, 09:00");
  });
});

describe("event rows to model events", () => {
  it("maps each kind with its payload and a numeric id", () => {
    const row = { id: "42", h: 120, kind: "shade", amount: 1, actor_id: null, client_event_id: "abcdefgh" };
    const rec = toRecordedEvent(row);
    expect(rec).toEqual({ id: 42, h: 120, kind: "shade", on: true, actorId: null, clientEventId: "abcdefgh" });
    expect(toTimedEvent(rec)).toEqual({ id: 42, h: 120, kind: "shade", amount: 1 });
    expect(toTimedEvent(ev("cover", 5, { id: 7, on: false }))).toEqual({ id: 7, h: 5, kind: "cover", amount: 0 });
    expect(toTimedEvent(ev("water", 5, { id: 8 }))).toEqual({ id: 8, h: 5, kind: "water" });
    expect(toTimedEvent(ev("sprinkle", 5, { id: 9, actorId: "giver-a" }))).toEqual({ id: 9, h: 5, kind: "sprinkle", actor: "giver-a" });
  });

  it("keeps a sprinkle from a removed giver distinct, and drops unknown kinds", () => {
    expect(toTimedEvent(ev("sprinkle", 5, { id: 10 }))).toEqual({ id: 10, h: 5, kind: "sprinkle", actor: "giver:10" });
    expect(toTimedEvent({ ...ev("water", 5), kind: "prune" as RecordedEvent["kind"] })).toBeNull();
  });
});

describe("decideCare: idempotency", () => {
  it("answers a retry with the event already recorded, however old", () => {
    const old = ev("water", 40);
    expect(decideCare({ kind: "water", on: null }, ctx({ existing: old }))).toEqual({ action: "duplicate", event: old });
  });

  it("declines a clientEventId reused for a different action", () => {
    const d = decideCare({ kind: "feed", on: null }, ctx({ existing: ev("water", 40) }));
    expect(d).toMatchObject({ action: "reject", status: 409, code: "client_event_id_reused" });
  });

  it("treats a second tend or talk in the same hour as the first", () => {
    const tend = ev("tend", 100);
    expect(decideCare({ kind: "tend", on: null }, ctx({ pending: [tend] }))).toEqual({ action: "duplicate", event: tend });
    expect(decideCare({ kind: "tend", on: null }, ctx({ pending: [tend], nowH: 101 }))).toMatchObject({ action: "insert", h: 101 });
    const talk = ev("talk", 100);
    expect(decideCare({ kind: "talk", on: null }, ctx({ pending: [talk] }))).toEqual({ action: "duplicate", event: talk });
  });

  it("never files an event behind the checkpoint", () => {
    expect(decideCare({ kind: "talk", on: null }, ctx({ nowH: 100, checkpointH: 101 }))).toMatchObject({ action: "insert", h: 101 });
  });
});

describe("decideCare: rate limits follow the model", () => {
  it(`allows a can every ${BED.canGapH} hours, counting cans recorded this hour`, () => {
    expect(decideCare({ kind: "water", on: null }, ctx())).toEqual({ action: "insert", h: 100, amount: null });
    const recent = decideCare({ kind: "water", on: null }, ctx({ state: fresh({ lastCanH: 98 }) }));
    expect(recent).toMatchObject({ action: "reject", status: 429, code: "too_soon", retryH: 98 + BED.canGapH });
    const pending = decideCare({ kind: "water", on: null }, ctx({ state: fresh({ lastCanH: 90 }), pending: [ev("water", 99)] }));
    expect(pending).toMatchObject({ action: "reject", retryH: 99 + BED.canGapH });
    expect(decideCare({ kind: "water", on: null }, ctx({ state: fresh({ lastCanH: 96 }) }))).toMatchObject({ action: "insert" });
  });

  it(`feeds an awake plant every ${BED.feedGapH} hours`, () => {
    expect(decideCare({ kind: "feed", on: null }, ctx())).toMatchObject({ action: "insert" });
    const soon = decideCare({ kind: "feed", on: null }, ctx({ state: fresh({ lastFeedH: 80 }) }));
    expect(soon).toMatchObject({ action: "reject", status: 429, retryH: 80 + BED.feedGapH });
    expect(decideCare({ kind: "feed", on: null }, ctx({ state: asleep() }))).toMatchObject({ action: "reject", code: "resting" });
  });

  it("records shade and cover changes with their on/off", () => {
    expect(decideCare({ kind: "shade", on: true }, ctx())).toEqual({ action: "insert", h: 100, amount: 1 });
    expect(decideCare({ kind: "cover", on: false }, ctx({ state: fresh({ cover: true }) }))).toEqual({ action: "insert", h: 100, amount: 0 });
  });
});

describe("decideCare: shade and cover cannot flood the event log", () => {
  it("records nothing when the cloth or cover is already as asked", () => {
    expect(decideCare({ kind: "cover", on: false }, ctx())).toEqual({ action: "unchanged", h: 100, on: false });
    expect(decideCare({ kind: "shade", on: true }, ctx({ state: fresh({ shade: true }) }))).toEqual({ action: "unchanged", h: 100, on: true });
    // this hour's pending change counts: on, then on again, is one change
    const on = ev("shade", 100, { on: true });
    expect(decideCare({ kind: "shade", on: true }, ctx({ pending: [on] }))).toEqual({ action: "unchanged", h: 100, on: true });
    expect(decideCare({ kind: "shade", on: false }, ctx({ pending: [on] }))).toEqual({ action: "insert", h: 100, amount: 0 });
  });

  it(`allows ${TOGGLES_PER_HOUR} changes per kind per hour, then asks to wait for the next hour`, () => {
    const pending: RecordedEvent[] = [];
    for (let i = 0; i < TOGGLES_PER_HOUR; i++) pending.push(ev("cover", 100, { on: i % 2 === 0 }));
    const last = pending[pending.length - 1].on;
    const d = decideCare({ kind: "cover", on: !last }, ctx({ pending }));
    expect(d).toMatchObject({ action: "reject", status: 429, code: "too_many_changes", retryH: 101 });
    // the other kind and the next hour are unaffected
    expect(decideCare({ kind: "shade", on: true }, ctx({ pending }))).toMatchObject({ action: "insert" });
    expect(decideCare({ kind: "cover", on: !last }, ctx({ pending, nowH: 101, checkpointH: 101 }))).toMatchObject({ action: "insert", h: 101 });
  });
});

describe("shade and cover after a replant still waiting for its hour", () => {
  // a sleeping plant whose Fairy Dust is used, with the shade cloth and rain cover left on
  const bed = () => asleep({ fairyUsed: true, shade: true, shadeH: 30, cover: true });

  it("shows a fresh bed: both off, as step() will leave them", () => {
    const replant = ev("replant", 100);
    expect(careStatus(bed(), [replant], 100)).toMatchObject({ shade: false, shadeSinceH: null, cover: false });
    // that hour's changes count after the replant whatever their ids; earlier hours' do not
    expect(careStatus(bed(), [ev("shade", 100, { on: true }), replant], 100)).toMatchObject({ shade: true, shadeSinceH: 100 });
    expect(careStatus(bed(), [ev("cover", 99, { on: true }), ev("replant", 99), ev("cover", 98, { on: false })], 100).cover).toBe(true);
  });

  it("records the cloth going on again rather than calling it unchanged", () => {
    expect(decideCare({ kind: "shade", on: true }, ctx({ state: bed(), pending: [ev("replant", 100)] })))
      .toEqual({ action: "insert", h: 100, amount: 1 });
    expect(decideCare({ kind: "cover", on: false }, ctx({ state: bed(), pending: [ev("replant", 100)] })))
      .toEqual({ action: "unchanged", h: 100, on: false });
  });

  it("agrees with the model", () => {
    const wx: HourWeather = { T: 24, RH: 70, P: 0, SW: 300, ET0: 0.2, U: 6, Ts: 24, isDay: 1 };
    const after = (events: SimEvent[]) => step({ ...bed(), h: 100 }, { h: 100, wx }, events);
    expect(after([{ id: 1, kind: "replant" }])).toMatchObject({ alive: true, shade: false, cover: false });
    expect(after([{ id: 1, kind: "shade", amount: 1 }, { id: 2, kind: "replant" }])).toMatchObject({ alive: true, shade: true });
  });
});

describe("decideCare: Fairy Dust and replanting", () => {
  it("revives a sleeping plant once", () => {
    expect(decideCare({ kind: "revive", on: null }, ctx({ state: asleep() }))).toMatchObject({ action: "insert" });
    expect(decideCare({ kind: "revive", on: null }, ctx())).toMatchObject({ action: "reject", code: "not_needed" });
    expect(decideCare({ kind: "revive", on: null }, ctx({ state: asleep({ fairyUsed: true }) }))).toMatchObject({ action: "reject", code: "fairy_used" });
    const pending = ev("revive", 100);
    expect(decideCare({ kind: "revive", on: null }, ctx({ state: asleep(), pending: [pending] }))).toEqual({ action: "duplicate", event: pending });
  });

  it("replants only after the dust is spent, while planting is open", () => {
    const spent = asleep({ fairyUsed: true });
    expect(decideCare({ kind: "replant", on: null }, ctx({ state: spent }))).toMatchObject({ action: "insert", h: 100 });
    expect(decideCare({ kind: "replant", on: null }, ctx())).toMatchObject({ action: "reject", code: "not_needed" });
    expect(decideCare({ kind: "replant", on: null }, ctx({ state: asleep() }))).toMatchObject({ action: "reject", code: "revive_first" });
    expect(decideCare({ kind: "replant", on: null }, ctx({ state: spent, nowH: 800, checkpointH: 800 }))).toMatchObject({ code: "planting_closed" });
    expect(decideCare({ kind: "replant", on: null }, ctx({ state: spent, nowH: 5, checkpointH: 5 }))).toMatchObject({ code: "not_yet" });
  });
});

describe("careStatus", () => {
  it("says when the next can and feed are welcome", () => {
    const s = careStatus(fresh({ lastCanH: 98, lastFeedH: 90 }), [], 100);
    expect(s.water).toEqual({ ready: false, nextH: 98 + BED.canGapH });
    expect(s.feed).toEqual({ ready: false, nextH: 90 + BED.feedGapH });
    expect(careStatus(fresh(), [], 100).water).toEqual({ ready: true, nextH: null });
  });

  it("shows this hour's shade and cover choices, the latest winning", () => {
    const pending = [ev("shade", 100, { on: true }), ev("cover", 100, { on: true }), ev("shade", 100, { on: false })];
    const s = careStatus(fresh(), pending, 100);
    expect(s.shade).toBe(false);
    expect(s.cover).toBe(true);
  });

  it("says when the shade cloth went on: the pending change that put it on, or else the replayed state's", () => {
    expect(careStatus(fresh(), [], 100).shadeSinceH).toBeNull();
    expect(careStatus(fresh(), [ev("shade", 100, { on: true })], 100)).toMatchObject({ shade: true, shadeSinceH: 100 });
    // the state at hour 60 has had the cloth on for 30 hours: it went on at hour 30
    expect(careStatus(fresh({ h: 60, shade: true, shadeH: 30 }), [], 100)).toMatchObject({ shade: true, shadeSinceH: 30 });
    // a pending change off clears it; on again starts from that change's hour
    const off = ev("shade", 60, { on: false });
    expect(careStatus(fresh({ h: 60, shade: true, shadeH: 30 }), [off], 100)).toMatchObject({ shade: false, shadeSinceH: null });
    expect(careStatus(fresh({ h: 60, shade: true, shadeH: 30 }), [off, ev("shade", 61, { on: true })], 100).shadeSinceH).toBe(61);
    // the cover never moves it
    expect(careStatus(fresh({ h: 60, shade: true, shadeH: 30 }), [ev("cover", 60, { on: true })], 100).shadeSinceH).toBe(30);
  });

  it("finds the hour the shade went on from a state the model replayed", () => {
    const wx: HourWeather = { T: 30, RH: 50, P: 0, SW: 700, ET0: 0.4, U: 6, Ts: 30, isDay: 1 };
    const events: Record<number, SimEvent[]> = {
      30: [{ id: 1, kind: "shade", amount: 1 }],
      40: [{ id: 2, kind: "shade", amount: 0 }],
      44: [{ id: 3, kind: "shade", amount: 1 }],
    };
    let s = fresh();
    for (let h = s.h; h < 70; h++) {
      s = step(s, { h, wx }, events[h] ?? []);
      if (h === 35) expect(careStatus(s, [], 36).shadeSinceH).toBe(30);
      if (h === 41) expect(careStatus(s, [], 42).shadeSinceH).toBeNull();
    }
    expect(s.h).toBe(70);
    expect(careStatus(s, [], 70)).toMatchObject({ shade: true, shadeSinceH: 44 });
  });

  it("offers Fairy Dust, then a replant, to a sleeping plant", () => {
    expect(careStatus(asleep(), [], 100)).toMatchObject({ revive: true, replant: false, feed: { ready: false } });
    expect(careStatus(asleep({ fairyUsed: true }), [], 100)).toMatchObject({ revive: false, replant: true });
    expect(careStatus(asleep(), [ev("revive", 100)], 100).revive).toBe(false);
  });
});

describe("Meadow bands", () => {
  it("stages a plant by its development", () => {
    expect(stageOf(fresh())).toBe("seed");
    expect(stageOf(fresh({ D: 0.1 }))).toBe("sprout");
    expect(stageOf(fresh({ D: 0.4 }))).toBe("leafy");
    expect(stageOf(fresh({ D: 0.8 }))).toBe("bud");
    expect(stageOf(fresh({ D: 1, bloomH: 300 }))).toBe("bloom");
    expect(stageOf(asleep())).toBe("resting");
  });

  it("bands health and bloom from the visual", () => {
    const v = toVisual(fresh());
    expect(healthBand(v)).toBe("thriving");
    expect(healthBand({ ...v, health: 0.5 })).toBe("fine");
    expect(healthBand({ ...v, health: 0.2 })).toBe("poorly");
    expect(healthBand(toVisual(asleep()))).toBe("resting");
    expect(bloomBand({ ...v, bloom: 0 })).toBe(0);
    expect(bloomBand({ ...v, bloom: 0.5 })).toBe(2);
    expect(bloomBand({ ...v, bloom: 1 })).toBe(3);
  });
});

describe("the lotus", () => {
  const lotus = (over: Partial<PondState> = {}): PondState => ({ ...createPlant("lotus", 17, OWNER), ...over });
  const lctx = (state: PondState, over: Partial<CareContext> = {}): CareContext => ({ state, pending: [], existing: null, nowH: 100, checkpointH: 100, ...over });

  it("has no shade cloth and no rain cover: both are declined calmly, on or off", () => {
    for (const kind of ["shade", "cover"] as const) for (const on of [true, false]) {
      const d = decideCare({ kind, on }, lctx(lotus()));
      expect(d.action).toBe("reject");
      if (d.action !== "reject") continue;
      expect([d.status, d.code]).toEqual([409, "not_for_lotus"]);
      expect(d.message).toBe(kind === "shade" ? "A lotus loves full sun, so the pond has no shade cloth." : "Rain only helps a pond, so there is no rain cover.");
    }
  });

  it("says what the water action was when it comes too soon: fresh jar water, the planting, or a bucket", () => {
    const too = (s: PondState) => {
      const d = decideCare({ kind: "water", on: null }, lctx(s, { nowH: 100 }));
      return d.action === "reject" ? d.message : "";
    };
    expect(too(lotus({ lastCanH: 98 }))).toMatch(/^Your seed had fresh water not long ago; the next fresh water is welcome from 06:00 IST.$/);
    expect(too(lotus({ lastCanH: 98, D: POND.Djar }))).toMatch(/^Your seedling had fresh water not long ago; it can go into its pot in the pond from/);
    expect(too(lotus({ lastCanH: 98, stage: 1, movedH: 60 }))).toMatch(/^The pond had a bucket not long ago; the next top-up is welcome from/);
    expect(decideCare({ kind: "water", on: null }, lctx(lotus({ lastCanH: 96 })))).toEqual({ action: "insert", h: 100, amount: null });
  });

  it("never calls the planting a bucket: pending, or just done, the next water is the pond's first top-up", () => {
    const planting: RecordedEvent = { id: 1, h: 100, kind: "water", on: null, actorId: null, clientEventId: "p" };
    const ready = lotus({ lastCanH: 80, D: POND.Djar + 0.01 });
    const pendingNow = decideCare({ kind: "water", on: null }, lctx(ready, { pending: [planting] }));
    expect(pendingNow.action === "reject" && pendingNow.message).toMatch(/^Your seedling is settling into its pot; the pond's first top-up is welcome from/);
    expect(careStatus(ready, [planting], 100).water).toEqual({ ready: false, nextH: 100 + BED.canGapH, planted: true });
    const planted = lotus({ lastCanH: 100, stage: 1, movedH: 100, D: POND.Djar });
    const after = decideCare({ kind: "water", on: null }, lctx(planted, { nowH: 102, checkpointH: 102 }));
    expect(after.action === "reject" && after.message).toMatch(/^Your seedling is settling into its pot;/);
    expect(careStatus(planted, [], 102).water.planted).toBe(true);
    // a bucket since: the pond's own words again
    expect(careStatus(lotus({ lastCanH: 106, stage: 1, movedH: 100 }), [], 108).water.planted).toBe(false);
    // a soil flower's water status carries no such flag
    expect(careStatus(fresh(), [], 100).water).not.toHaveProperty("planted");
  });

  it("calls the food lotus tablets", () => {
    const d = decideCare({ kind: "feed", on: null }, lctx(lotus({ lastFeedH: 90 })));
    expect(d.action === "reject" && d.message).toMatch(/lotus tablet/);
    const r = decideCare({ kind: "feed", on: null }, lctx(lotus({ alive: false })));
    expect(r.action === "reject" && r.message).toBe("Your lotus is resting; lotus tablets can wait until it wakes.");
  });

  it("tends once an hour; the koi's pinch counts once every 4 h, pending tends included", () => {
    const first = decideCare({ kind: "tend", on: null }, lctx(lotus()));
    expect(first).toEqual({ action: "insert", h: 100, amount: null });
    const pending = [ev("tend", 100)];
    expect(decideCare({ kind: "tend", on: null }, lctx(lotus(), { pending })).action).toBe("duplicate");
    // the koi: fed at 97 in the state, then tends at 99 (inside 4 h: a rinse only) and 101 (a pinch)
    expect(lastPinchH(97, [ev("tend", 99), ev("tend", 101)])).toBe(101);
    expect(lastPinchH(97, [ev("tend", 99)])).toBe(97);
    expect(lastPinchH(POND_NONE, [])).toBe(POND_NONE);
    const s = careStatus(lotus({ lastKoiH: 97 }), [ev("tend", 99)], 100);
    expect(s.koi).toEqual({ ready: false, nextH: 101, lastH: 97 });
    expect(careStatus(lotus(), [], 100).koi).toEqual({ ready: true, nextH: null, lastH: null });
    // the six soil flowers have no koi
    expect(careStatus(fresh(), [], 100).koi).toBeNull();
  });

  it("offers Fairy Dust and a replant in the same pond", () => {
    const used = decideCare({ kind: "revive", on: null }, lctx(lotus({ alive: false, fairyUsed: true })));
    expect(used.action === "reject" && used.message).toBe("The Fairy Dust has been used; you can plant a fresh seed in the same pond instead.");
    const awake = decideCare({ kind: "replant", on: null }, lctx(lotus()));
    expect(awake.action === "reject" && awake.message).toMatch(/a pond whose lotus has gone to sleep/);
    expect(decideCare({ kind: "revive", on: null }, lctx(lotus({ alive: false })))).toEqual({ action: "insert", h: 100, amount: null });
  });

  it("maps the pond model's stages onto the Meadow's", () => {
    expect(stageOf(lotus())).toBe("seed");
    expect(stageOf(lotus({ stage: 1, D: 0.2 }))).toBe("sprout");
    expect(stageOf(lotus({ stage: 1, D: POND.Daer }))).toBe("leafy");
    expect(stageOf(lotus({ stage: 1, D: POND.Dbud }))).toBe("bud");
    expect(stageOf(lotus({ stage: 1, D: 1, bloomH: 340 }))).toBe("bloom");
    // a practice lotus that bloomed before the party (a negative hour) has bloomed
    expect(stageOf(lotus({ stage: 1, D: 1, bloomH: -280 }))).toBe("bloom");
    expect(stageOf(lotus({ alive: false }))).toBe("resting");
  });

  it("tells a friend that a sprinkle is a kindness a pond does not need", () => {
    expect(sprinkleMessage("Asha", true, "lotus")).toBe("Your sprinkle landed by Asha's lotus. A lotus lives in a pond, so a sprinkle cannot top it up; your kindness still counts.");
    expect(sprinkleMessage("A friend", false, "lotus")).toMatch(/^Two friends have already sprinkled your friend's lotus today/);
    expect(sprinkleMessage("Asha", true, "rose")).toBe("Your sprinkle landed on Asha's flower; it will feel it within the hour.");
  });
});

describe("decideSeedReplay", () => {
  const prior = { personId: "p-1", firstName: "Asha", species: "rose", createdAt: new Date("2026-11-10T09:31:00Z") };
  const soon = new Date(prior.createdAt.getTime() + 60_000);

  it("answers the same request again with the original planting", () => {
    expect(decideSeedReplay(prior, { firstName: "Asha", species: "rose" }, null, soon)).toBe("replay");
    expect(decideSeedReplay(prior, { firstName: "Asha", species: "rose" }, "p-1", soon)).toBe("replay");
  });

  it("refuses different details or a device holding another garden, so the id is not a key to someone's garden", () => {
    expect(decideSeedReplay(prior, { firstName: "Someone Else", species: "rose" }, null, soon)).toBe("mismatch");
    expect(decideSeedReplay(prior, { firstName: "Asha", species: "jasmine" }, null, soon)).toBe("mismatch");
    expect(decideSeedReplay(prior, { firstName: "Asha", species: "rose" }, "p-2", soon)).toBe("mismatch");
  });

  it("stops answering after the window; the garden link is the way back", () => {
    const late = new Date(prior.createdAt.getTime() + SEED_REPLAY_WINDOW_MS + 1);
    expect(decideSeedReplay(prior, { firstName: "Asha", species: "rose" }, null, late)).toBe("expired");
  });
});
