// Parity with the locked prototype: replays every scenario of golden-v4.json (written by the prototype's run.mjs from
// model.js) through the TypeScript port and compares every recorded state and visual field, every bloom forecast, the
// constants block and the planting-window table. The golden file stores non-integer numbers rounded to 1e-9, so a field
// passes when the port's value, rounded the same way, is within 1e-9; strings, booleans and integers must be exact, and
// the constants must be identical. The prototype's golden-check.mjs runs the same comparison against model.js.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { SpeciesId } from "@/lib/plant/species";
import { CLIM_T } from "./climate";
import { BED, GAME_START, PLANT_CLOSE_H, PLANT_OPEN_H, SIM_SPECIES, SIM_VERSION, TWIN, canPlant, createPlant, expectBloom, step, toVisual } from "./model";
import type { HourWeather, PlantState, SimEvent } from "./model";
import { catchUp, type TimedEvent } from "./replay";

interface GoldenWeather { T: number[]; RH: number[]; P: number[]; SW: number[]; ET0: number[]; U: number[]; Ts: number[]; isDay: number[] }
interface GoldenScenario {
  id: string;
  sp: SpeciesId;
  weatherKey: string;
  plantH: number;
  endH: number;
  events: Record<string, Record<string, unknown>[]>;
  snapshots: { h: number; state: Record<string, unknown>; visual: Record<string, unknown> }[];
  expectBloom: { h: number; e: Record<string, unknown> | null }[];
}
interface Golden {
  simVersion: number;
  gameStart: string;
  owner: string;
  constants: Record<string, unknown>;
  canPlant: [number, boolean][];
  climT: number[];
  weather: Record<string, GoldenWeather>;
  scenarios: GoldenScenario[];
}

const G = JSON.parse(fs.readFileSync(new URL("./__fixtures__/golden-v4.json", import.meta.url), "utf8")) as Golden;

const R = 1e9;
const rnd = (x: number) => (Number.isFinite(x) && !Number.isInteger(x) ? Math.round(x * R) / R : x);
// golden-check.mjs's comparison: arrays and objects key by key, numbers after rounding (or exactly), the rest strictly
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

function wxAt(w: GoldenWeather, h: number): HourWeather {
  return { T: w.T[h], RH: w.RH[h], P: w.P[h], SW: w.SW[h], ET0: w.ET0[h], U: w.U[h], Ts: w.Ts[h], isDay: w.isDay[h] ? 1 : 0 };
}
// the golden events include deliberate junk (a can with amount -5, sprinkles without an actor, kind "nuke"): step() must
// validate them itself, so they go in exactly as recorded
const eventsAt = (sc: GoldenScenario, h: number) => (sc.events[String(h)] ?? []) as unknown as SimEvent[];

function compareSnapshot(sc: GoldenScenario, want: GoldenScenario["snapshots"][number] | undefined, st: PlantState, bad: string[]): number {
  if (!want || want.h !== st.h) { bad.push(`${sc.id}: snapshot expected at h ${want?.h}, got h ${st.h}`); return 0; }
  const got = { state: st as unknown as Record<string, unknown>, visual: toVisual(st, SIM_SPECIES[sc.sp]) as unknown as Record<string, unknown> };
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

describe("golden-v4 parity with the prototype", () => {
  it("is the file this port targets", () => {
    expect(G.simVersion).toBe(SIM_VERSION);
    expect(G.gameStart).toBe(GAME_START);
    expect(G.scenarios).toHaveLength(14);
    expect(new Set(G.scenarios.map((s) => s.sp))).toEqual(new Set(Object.keys(SIM_SPECIES)));
  });

  it("carries exactly the prototype's constants", () => {
    const species = Object.fromEntries(Object.entries(SIM_SPECIES).map(([id, sp]) => {
      const { truth, name, ...k } = sp; // the golden file leaves out the copy
      void truth; void name;
      return [id, k];
    }));
    const consts: Record<string, unknown> = { BED, SPECIES: species, TWIN, PLANT_OPEN_H, PLANT_CLOSE_H, GAME_START };
    expect(Object.keys(consts).sort()).toEqual(Object.keys(G.constants).sort());
    for (const key of Object.keys(G.constants)) expect(same(consts[key], G.constants[key], true), `constants.${key}`).toBe(true);
    expect(same(CLIM_T, G.climT, true), "climT").toBe(true);
  });

  it("agrees on the planting window", () => {
    for (const [h, ok] of G.canPlant) expect(canPlant(h), `canPlant(${h})`).toBe(ok);
  });

  for (const sc of G.scenarios) {
    it(`replays ${sc.id}`, () => {
      const w = G.weather[sc.weatherKey], sp = SIM_SPECIES[sc.sp], bad: string[] = [];
      let s = createPlant(sc.sp, sc.plantH, G.owner), k = 0, e = 0, fields = 0;
      const checkExp = (st: PlantState) => {
        const want = sc.expectBloom[e++];
        fields++;
        if (!want || want.h !== st.h) { bad.push(`${sc.id}: expectBloom expected at h ${want?.h}, got h ${st.h}`); return; }
        const got = expectBloom(st, sp, { h: st.h, climT: G.climT });
        if (!same(got, want.e)) bad.push(`${sc.id} h ${st.h} expectBloom: got ${JSON.stringify(got)}, want ${JSON.stringify(want.e)}`);
      };
      fields += compareSnapshot(sc, sc.snapshots[k++], s, bad);
      checkExp(s);
      for (let h = sc.plantH; h < sc.endH; h++) {
        s = step(s, { h, wx: wxAt(w, h) }, eventsAt(sc, h), sp);
        if (s.h % 6 === 0 || h === sc.endH - 1) fields += compareSnapshot(sc, sc.snapshots[k++], s, bad);
        if ((s.h - sc.plantH) % 24 === 0) checkExp(s);
      }
      expect(k, "snapshots reached").toBe(sc.snapshots.length);
      expect(e, "forecasts reached").toBe(sc.expectBloom.length);
      expect(fields).toBeGreaterThan(1000);
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }

  it("catchUp() over a whole scenario lands on the golden final state", () => {
    for (const sc of G.scenarios) {
      const w = G.weather[sc.weatherKey];
      const events: TimedEvent[] = Object.entries(sc.events).flatMap(([h, list]) => list.map((ev) => ({ ...ev, h: Number(h) }) as unknown as TimedEvent));
      const s = catchUp(createPlant(sc.sp, sc.plantH, G.owner), events, (h) => (h < w.T.length ? wxAt(w, h) : undefined), sc.endH);
      const bad: string[] = [];
      compareSnapshot(sc, sc.snapshots[sc.snapshots.length - 1], s, bad);
      expect(bad, sc.id).toEqual([]);
    }
  });
});
