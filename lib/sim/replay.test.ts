// Replay, as the server will use it: catching up in arbitrary chunks (with the checkpoint stored as JSON in between)
// must give exactly the state of stepping hour by hour; events outside the window are ignored; a weather gap stops the
// replay without inventing weather; nothing is mutated.
import { describe, expect, it } from "vitest";
import { createPlant, type HourWeather, type PlantState, type SimEvent } from "./model";
import { catchUp, replayFromPlanting, type TimedEvent } from "./replay";
import { IDS, OWNER, PARTY, YEARS, goodCare, mulberry32, randomPolicy, rowsFor, simulate, type Run } from "./__fixtures__/harness";

const timed = (r: Run): TimedEvent[] => r.rec.flatMap((x) => x.ev.map((e) => ({ ...e, h: x.h - 1 }) as TimedEvent));

describe("catchUp", () => {
  it("in random chunks, with a JSON checkpoint between them, equals stepping hour by hour", () => {
    for (let k = 0; k < 24; k++) {
      const rnd = mulberry32(2026 + 101 * k), id = IDS[k % IDS.length], y = YEARS[k % 3], plantH = PARTY + Math.floor(rnd() * 200);
      const r = simulate({ spId: id, year: y, plantH, policy: randomPolicy(rnd), endH: 983 });
      const events = timed(r), rows = rowsFor(y), wx = (h: number) => rows[h];
      let s: PlantState = createPlant(id, plantH, OWNER);
      while (s.h < r.s.h) {
        const toH = Math.min(r.s.h, s.h + 1 + Math.floor(rnd() * 60));
        s = JSON.parse(JSON.stringify(catchUp(s, events, wx, toH))) as PlantState;
        expect(s.h).toBe(toH);
        expect(s).toEqual(r.rec[toH - plantH - 1].s);
      }
      expect(s).toEqual(r.s);
    }
  });

  it("ignores events before the checkpoint (already inside it) and leaves later ones for the next call", () => {
    const rows = rowsFor(2025), wx = (h: number) => rows[h];
    const s0 = catchUp(createPlant("rose", PARTY, OWNER), [], wx, 100);
    const ev: TimedEvent[] = [{ kind: "water", h: 99 }, { kind: "water", h: 130 }];
    const a = catchUp(s0, ev, wx, 120), b = catchUp(s0, [], wx, 120);
    expect(a).toEqual(b);
    expect(catchUp(a, ev, wx, 140).lastCanH).toBe(130);
  });

  it("stops at the first hour without weather, and resumes where it stopped once the hour is backfilled", () => {
    const rows = rowsFor(2024), full = (h: number) => rows[h];
    const gappy = (h: number): HourWeather | undefined => (h >= 200 && h < 210 ? undefined : rows[h]);
    const r = simulate({ spId: "marigold", year: 2024, policy: goodCare(), endH: 400 }), events = timed(r);
    const stopped = catchUp(createPlant("marigold", PARTY, OWNER), events, gappy, 400);
    expect(stopped.h).toBe(200);
    expect(catchUp(stopped, events, gappy, 400)).toEqual(stopped);
    expect(catchUp(stopped, events, full, 400)).toEqual(r.s);
  });

  it("returns the checkpoint itself when there is nothing to step, and never mutates its inputs", () => {
    const rows = rowsFor(2023), wx = (h: number) => rows[h];
    const s = Object.freeze(createPlant("jasmine", PARTY, OWNER));
    expect(catchUp(s, [], wx, PARTY)).toBe(s);
    const ev = Object.freeze([Object.freeze<SimEvent & { h: number }>({ kind: "water", h: 40, id: 1 })]);
    expect(() => catchUp(s, ev, wx, 80)).not.toThrow();
  });
});

describe("replayFromPlanting", () => {
  it("rebuilds a plant from its planting and its events, including a revive and a replant", () => {
    let found = false;
    for (let k = 0; k < 40 && !found; k++) {
      const rnd = mulberry32(77 + k), r = simulate({ spId: IDS[k % IDS.length], year: YEARS[k % 3], policy: randomPolicy(rnd), endH: 983 });
      if (r.s.gen < 2) continue;
      found = true;
      const rows = rowsFor(YEARS[k % 3]);
      expect(replayFromPlanting({ speciesId: IDS[k % IDS.length], plantedH: PARTY, owner: OWNER }, timed(r), (h) => rows[h], r.s.h)).toEqual(r.s);
    }
    expect(found).toBe(true);
  });
});
