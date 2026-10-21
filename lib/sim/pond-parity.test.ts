// Parity with the frozen prototype: replays every scenario of golden-pond-v1.json (written by the scratch prototype's
// golden-pond.mjs from pond-v1.js, POND_VERSION 1) through the TypeScript port and compares every recorded state and
// visual field, every bloom forecast, the constants block and the table of visuals at fractional clock hours. Same
// comparison as parity.test.ts for the soil model: non-integer numbers are stored rounded to 1e-9, so a field passes when
// the port's value, rounded the same way, is within 1e-9; strings, booleans and integers must be exact, and the constants
// must be identical. The scenarios cover good care at the party in 2023-25 (one to four flowers and their pods), the koi
// never fed (the stall), a seed never touched, the jar cared for and then abandoned, a weekend away, the wet week with
// nobody and with two top-ups a day (the spill), green water, lotus food every 48 h, shade, friends only, Fairy Dust and a
// replant, a planting on 8 Dec (into the weather to 15 Jan), a visit every 3 days, broken weather rows, junk events, and a
// practice planting at h -600 that blooms before the party.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIM_T } from "./climate";
import { GAME_START, PLANT_OPEN_H } from "./model";
import type { HourWeather, SimEvent } from "./model";
import { createPlant, step, toVisual } from "./plant";
import { JAR, POND, POND_NONE, POND_SPECIES, POND_TWIN, POND_VERSION, createPond, expectBloomPond, stepPond, toVisualPond, type PondState } from "./pond";
import { catchUp, type TimedEvent } from "./replay";

type Col = (number | null)[];
interface GoldenWeather { h0?: number; T: Col; RH: Col; P: Col; SW: Col; ET0: Col; U: Col; Ts: Col; isDay: Col }
interface GoldenScenario {
  id: string;
  sp: "lotus";
  weatherKey: string;
  plantH: number;
  endH: number;
  /** [from, to] state hours with a snapshot every hour */
  hourly: [number, number][];
  events: Record<string, Record<string, unknown>[]>;
  snapshots: { h: number; state: Record<string, unknown>; visual: Record<string, unknown> }[];
  expectBloom: { h: number; e: Record<string, unknown> | null }[];
}
interface GoldenClock { scenario: string; what: string; h: number; state: Record<string, unknown>; visuals: { t: number; visual: Record<string, unknown> }[] }
interface Golden {
  pondVersion: number;
  gameStart: string;
  owner: string;
  constants: Record<string, unknown>;
  climT: number[];
  weather: Record<string, GoldenWeather>;
  scenarios: GoldenScenario[];
  clock: GoldenClock[];
}

const G = JSON.parse(fs.readFileSync(new URL("./__fixtures__/golden-pond-v1.json", import.meta.url), "utf8")) as Golden;

const R = 1e9;
const rnd = (x: number) => (Number.isFinite(x) && !Number.isInteger(x) ? Math.round(x * R) / R : x);
function same(a: unknown, b: unknown, exact = false): boolean {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && a.every((x, i) => same(x, b[i], exact));
  if (b && typeof b === "object") {
    if (!a || typeof a !== "object") return false;
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    return Object.keys(bo).length === Object.keys(ao).length && Object.keys(bo).every((k) => same(ao[k], bo[k], exact));
  }
  if (typeof b === "number") return typeof a === "number" && (exact ? a === b : Math.abs(rnd(a) - b) <= 1e-9);
  return a === b;
}

// the row exactly as golden-pond.mjs built it, nulls included (stepPond cleans it)
function wxAt(w: GoldenWeather, h: number): HourWeather | undefined {
  const i = h - (w.h0 ?? 0);
  if (i < 0 || i >= w.T.length) return undefined;
  return { T: w.T[i], RH: w.RH[i], P: w.P[i], SW: w.SW[i], ET0: w.ET0[i], U: w.U[i], Ts: w.Ts[i], isDay: w.isDay[i] } as unknown as HourWeather;
}
// the junk scenario's events go in exactly as recorded: stepPond must validate them itself
const eventsAt = (sc: GoldenScenario, h: number) => (sc.events[String(h)] ?? []) as unknown as SimEvent[];
const inWindow = (sc: GoldenScenario, h: number) => sc.hourly.some(([a, b]) => h >= a && h <= b);

function compareSnapshot(sc: GoldenScenario, want: GoldenScenario["snapshots"][number] | undefined, st: PondState, bad: string[]): number {
  if (!want || want.h !== st.h) { bad.push(`${sc.id}: snapshot expected at h ${want?.h}, got h ${st.h}`); return 0; }
  const got = { state: st as unknown as Record<string, unknown>, visual: toVisualPond(st, POND_SPECIES.lotus) as unknown as Record<string, unknown> };
  let n = 0;
  for (const part of ["state", "visual"] as const) {
    const keys = new Set([...Object.keys(want[part]), ...Object.keys(got[part])]);
    for (const key of keys) {
      n++;
      if (!same(got[part][key], want[part][key])) bad.push(`${sc.id} h ${st.h} ${part}.${key}: got ${JSON.stringify(got[part][key])}, want ${JSON.stringify(want[part][key])}`);
    }
  }
  return n;
}

describe("golden-pond-v1 parity with the prototype", () => {
  it("is the file this port targets", () => {
    expect(G.pondVersion).toBe(POND_VERSION);
    expect(G.gameStart).toBe(GAME_START);
    expect(G.scenarios.length).toBeGreaterThanOrEqual(20);
    expect(new Set(G.scenarios.map((s) => s.sp))).toEqual(new Set(["lotus"]));
  });

  it("carries exactly the prototype's constants", () => {
    const { truth, name, ...lotus } = POND_SPECIES.lotus; // the golden file leaves out the copy
    void truth; void name;
    const consts: Record<string, unknown> = {
      POND, JAR, SPECIES: { lotus }, TWIN: POND_TWIN, POND_VERSION, PLANT_OPEN_H, GAME_START, NONE: POND_NONE,
    };
    // planting never closes now (parity.test.ts): the golden file's closing hour has no counterpart here
    expect(G.constants.PLANT_CLOSE_H).toBe(744);
    expect(Object.keys(consts).sort()).toEqual(Object.keys(G.constants).filter((k) => k !== "PLANT_CLOSE_H").sort());
    for (const key of Object.keys(consts)) expect(same(consts[key], G.constants[key], true), `constants.${key}`).toBe(true);
    // the forecasts run on the app's own climate normal
    expect(same(CLIM_T, G.climT, true), "climT").toBe(true);
  });

  for (const sc of G.scenarios) {
    it(`replays ${sc.id}`, () => {
      const w = G.weather[sc.weatherKey], sp = POND_SPECIES.lotus, bad: string[] = [];
      let s = createPond("lotus", sc.plantH, G.owner), k = 0, e = 0, fields = 0;
      const checkExp = (st: PondState) => {
        const want = sc.expectBloom[e++];
        fields++;
        if (!want || want.h !== st.h) { bad.push(`${sc.id}: expectBloom expected at h ${want?.h}, got h ${st.h}`); return; }
        const got = expectBloomPond(st, sp, { h: st.h, climT: G.climT });
        if (!same(got, want.e)) bad.push(`${sc.id} h ${st.h} expectBloom: got ${JSON.stringify(got)}, want ${JSON.stringify(want.e)}`);
      };
      fields += compareSnapshot(sc, sc.snapshots[k++], s, bad);
      checkExp(s);
      for (let h = sc.plantH; h < sc.endH; h++) {
        s = stepPond(s, { h, wx: wxAt(w, h) as HourWeather }, eventsAt(sc, h), sp);
        if (s.h % 6 === 0 || h === sc.endH - 1 || inWindow(sc, s.h)) fields += compareSnapshot(sc, sc.snapshots[k++], s, bad);
        if ((s.h - sc.plantH) % 24 === 0) checkExp(s);
      }
      expect(k, "snapshots reached").toBe(sc.snapshots.length);
      expect(e, "forecasts reached").toBe(sc.expectBloom.length);
      expect(fields).toBeGreaterThan(1000);
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }

  it("the dispatching createPlant, step and toVisual give the same plant", () => {
    const sc = G.scenarios.find((x) => x.id === "good-care-party-2024") as GoldenScenario;
    const w = G.weather[sc.weatherKey];
    let a = createPond("lotus", sc.plantH, G.owner);
    let b = createPlant("lotus", sc.plantH, G.owner);
    for (let h = sc.plantH; h < sc.endH; h++) {
      a = stepPond(a, { h, wx: wxAt(w, h) as HourWeather }, eventsAt(sc, h));
      b = step(b, { h, wx: wxAt(w, h) as HourWeather }, eventsAt(sc, h));
    }
    expect(b).toEqual(a);
    expect(toVisual(b)).toEqual(toVisualPond(a));
  });

  it("agrees on the visuals at fractional clock hours", () => {
    expect(G.clock.length).toBeGreaterThanOrEqual(10);
    const bad: string[] = [];
    for (const c of G.clock) {
      for (const { t, visual } of c.visuals) {
        const got = toVisualPond(c.state as unknown as PondState, POND_SPECIES.lotus, t) as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(visual), ...Object.keys(got)])) {
          if (!same(got[key], visual[key])) bad.push(`${c.scenario} ${c.what} h ${c.h} t ${t} ${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(visual[key])}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("catchUp() over a whole scenario lands on the golden final state", () => {
    for (const sc of G.scenarios) {
      const w = G.weather[sc.weatherKey];
      const events: TimedEvent[] = Object.entries(sc.events).flatMap(([h, list]) => list.map((ev) => ({ ...ev, h: Number(h) }) as unknown as TimedEvent));
      const s = catchUp(createPlant("lotus", sc.plantH, G.owner), events, (h) => wxAt(w, h), sc.endH);
      const bad: string[] = [];
      compareSnapshot(sc, sc.snapshots[sc.snapshots.length - 1], s, bad);
      expect(bad, sc.id).toEqual([]);
    }
  });
});
