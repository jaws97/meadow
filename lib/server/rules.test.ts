// The rules around the model: the planting window, when a retried planting gets the original, idempotent retries and
// rate limits for care, shade and cover changes, the conditions for Fairy Dust and replanting, how stored rows become
// the model's events, the IST clock helpers, and the Meadow's bands.
import { describe, expect, it } from "vitest";
import { BED, PLANT_OPEN_H, createPlant, dateOfHour, toVisual, type PlantState } from "@/lib/sim";
import {
  bloomBand,
  careStatus,
  decideCare,
  decideSeedReplay,
  formatIstHour,
  healthBand,
  istClock,
  istDayOfHour,
  plantingOpensText,
  plantingWindow,
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
