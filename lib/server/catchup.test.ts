// Catching a stored plant up with optimistic concurrency, against an in-memory fake of the checkpoint, event and weather
// stores: the result always equals a straight replay from planting, an event recorded mid-catch-up is never lost, a
// weather gap pauses without inventing anything, and a checkpoint from another model version is rebuilt.
import { describe, expect, it } from "vitest";
import {
  POND_NONE,
  POND_VERSION,
  SIM_VERSION,
  catchUp,
  createPlant,
  modelVersionOf,
  modelVersionOfState,
  replayFromPlanting,
  type HourWeather,
  type PlantState,
  type Planting,
  type TimedEvent,
} from "@/lib/sim";
import { advanceCheckpoint, baseState, seedState, type AdvanceDeps, type CheckpointRecord } from "./catchup";

const OWNER = "5b0c9f1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const PLANTING: Planting = { speciesId: "marigold", plantedH: 17, owner: OWNER };

// a plausible clear Bangalore day: cool nights, warm afternoons, sun from 06:00 to 18:00
function wx(h: number): HourWeather {
  const hod = ((h % 24) + 24) % 24, day = hod >= 6 && hod < 18;
  return {
    T: Math.round((21 + 6 * Math.sin(((hod - 9) / 24) * 2 * Math.PI)) * 10) / 10,
    RH: 70,
    P: 0,
    SW: day ? Math.round(650 * Math.sin(((hod - 6) / 12) * Math.PI)) : 0,
    ET0: day ? 0.25 : 0.02,
    U: 6,
    Ts: 22,
    isDay: day ? 1 : 0,
  };
}

interface Fake {
  deps: AdvanceDeps;
  cp: CheckpointRecord;
  events: TimedEvent[];
  saves: number;
  ensured: [number, number][];
}

function fake(opts: { hasWeather?: (h: number) => boolean; onSave?: (f: Fake) => boolean | void; checkpoint?: CheckpointRecord } = {}): Fake {
  const seed = createPlant(PLANTING.speciesId, PLANTING.plantedH, PLANTING.owner);
  const f: Fake = {
    cp: opts.checkpoint ?? { h: seed.h, state: seed, simVersion: SIM_VERSION, version: 0 },
    events: [],
    saves: 0,
    ensured: [],
    deps: null as unknown as AdvanceDeps,
  };
  const has = opts.hasWeather ?? (() => true);
  f.deps = {
    planting: PLANTING,
    loadCheckpoint: async () => JSON.parse(JSON.stringify(f.cp)) as CheckpointRecord,
    loadEvents: async (fromH, toH) => f.events.filter((e) => e.h >= fromH && e.h < toH),
    ensureWeather: async (fromH, toH) => {
      f.ensured.push([fromH, toH]);
    },
    loadWeather: async (fromH, toH) => (h) => (h >= fromH && h < toH && has(h) ? wx(h) : undefined),
    saveCheckpoint: async (expected, state) => {
      f.saves++;
      if (opts.onSave?.(f) === false) return false;
      if (f.cp.version !== expected) return false;
      // stored as JSON, exactly as jsonb would
      f.cp = { h: state.h, state: JSON.parse(JSON.stringify(state)) as PlantState, simVersion: state.v, version: expected + 1 };
      return true;
    },
  };
  return f;
}

const replay = (events: TimedEvent[], toH: number, has: (h: number) => boolean = () => true) =>
  replayFromPlanting(PLANTING, events, (h) => (has(h) ? wx(h) : undefined), toH);

describe("advanceCheckpoint", () => {
  it("steps every completed hour, saves once, and equals a straight replay", async () => {
    const f = fake();
    f.events.push({ id: 1, h: 20, kind: "water" }, { id: 2, h: 44, kind: "water" }, { id: 3, h: 50, kind: "shade", amount: 1 });
    const r = await advanceCheckpoint(f.deps, 80);
    expect(r.state.h).toBe(80);
    expect(r).toMatchObject({ saved: true, version: 1, weatherWaitingFromH: null });
    expect(r.state).toEqual(replay(f.events, 80));
    expect(f.cp.state).toEqual(r.state);
    expect(f.ensured).toEqual([[17, 80]]);
  });

  it("catches up in chunks to exactly the same plant", async () => {
    const f = fake();
    f.events.push({ id: 1, h: 30, kind: "water" }, { id: 2, h: 70, kind: "feed" }, { id: 3, h: 75, kind: "talk" });
    await advanceCheckpoint(f.deps, 40);
    await advanceCheckpoint(f.deps, 41);
    const r = await advanceCheckpoint(f.deps, 120);
    expect(r.state).toEqual(replay(f.events, 120));
    expect(f.cp.version).toBe(3);
  });

  it("does nothing when the plant is already up to date", async () => {
    const f = fake();
    await advanceCheckpoint(f.deps, 60);
    const r = await advanceCheckpoint(f.deps, 60);
    expect(r).toMatchObject({ saved: false, version: 1 });
    expect(f.saves).toBe(1);
  });

  it("never saves a catch-up that missed an event recorded meanwhile; the retry folds it in", async () => {
    let raced = false;
    const f = fake({
      onSave: (ff) => {
        if (raced) return;
        raced = true;
        // another request records a can at hour 50 and bumps the version, as recordCare does
        ff.events.push({ id: 9, h: 50, kind: "water" });
        ff.cp = { ...ff.cp, version: ff.cp.version + 1 };
      },
    });
    const r = await advanceCheckpoint(f.deps, 90);
    expect(f.saves).toBe(2);
    expect(r.saved).toBe(true);
    expect(r.state.lastCanH).toBe(50);
    expect(r.state).toEqual(replay(f.events, 90));
  });

  it("returns the computed plant unsaved after losing every race", async () => {
    const f = fake({ onSave: () => false });
    const r = await advanceCheckpoint(f.deps, 60, 3);
    expect(f.saves).toBe(3);
    expect(r.saved).toBe(false);
    expect(r.state).toEqual(replay([], 60));
    expect(f.cp.h).toBe(17);
  });

  it("pauses at the first hour without weather, keeps the progress, and resumes once it arrives", async () => {
    let gapFrom = 45;
    const f = fake({ hasWeather: (h) => h < gapFrom });
    f.events.push({ id: 1, h: 30, kind: "water" }, { id: 2, h: 60, kind: "water" });
    const paused = await advanceCheckpoint(f.deps, 100);
    expect(paused.state.h).toBe(45);
    expect(paused).toMatchObject({ saved: true, weatherWaitingFromH: 45 });
    // still missing: nothing new to save
    const again = await advanceCheckpoint(f.deps, 100);
    expect(again).toMatchObject({ saved: false, weatherWaitingFromH: 45 });
    gapFrom = Infinity;
    const resumed = await advanceCheckpoint(f.deps, 100);
    expect(resumed).toMatchObject({ saved: true, weatherWaitingFromH: null });
    expect(resumed.state).toEqual(replay(f.events, 100));
  });

  it("on a deployment that must not write checkpoints, computes once and saves nothing", async () => {
    const f = fake();
    f.events.push({ id: 1, h: 20, kind: "water" });
    const readOnly = { ...f.deps, saveCheckpoint: undefined };
    let loads = 0;
    readOnly.loadCheckpoint = async () => {
      loads++;
      return f.deps.loadCheckpoint();
    };
    const r = await advanceCheckpoint(readOnly, 60);
    expect(r).toMatchObject({ saved: false, version: 0, weatherWaitingFromH: null });
    expect(r.state).toEqual(replay(f.events, 60));
    expect(loads).toBe(1);
    expect(f.cp.h).toBe(17);
  });

  it("rebuilds from the planting when the checkpoint came from another model version", async () => {
    const stale = { ...createPlant("marigold", 17, OWNER), v: SIM_VERSION - 1, h: 70, D: 0.9 };
    const f = fake({ checkpoint: { h: 70, state: stale, simVersion: SIM_VERSION - 1, version: 4 } });
    f.events.push({ id: 1, h: 25, kind: "water" });
    const r = await advanceCheckpoint(f.deps, 70);
    expect(r.saved).toBe(true);
    expect(r.state).toEqual(replay(f.events, 70));
    expect(f.cp).toMatchObject({ simVersion: SIM_VERSION, version: 5 });
  });
});

describe("baseState", () => {
  it("rebuilds a checkpoint saved under a species key the model no longer knows from its planting", () => {
    // SIM_VERSION 7 renamed a key: a SIM_VERSION 6 state still names the old one, the planting row the new one
    const planting: Planting = { speciesId: "island", plantedH: 17, owner: OWNER };
    const old = { ...createPlant("island", 17, OWNER), v: 6, h: 70, sp: "retired" } as unknown as PlantState;
    const { state, rebuilt } = baseState({ h: 70, state: old, simVersion: 6, version: 3 }, planting);
    expect(rebuilt).toBe(true);
    expect(state).toEqual(seedState(planting));
    expect(catchUp(state, [{ id: 1, h: 25, kind: "water" }], wx, 70)).toMatchObject({ sp: "island", v: SIM_VERSION, h: 70, alive: true });
  });
});

describe("a lotus checkpoint", () => {
  const LOTUS: Planting = { speciesId: "lotus", plantedH: 17, owner: OWNER };
  const lotusAt = (h: number, events: TimedEvent[] = []) => replayFromPlanting(LOTUS, events, wx, h);

  it("is stored under 1001 (1000 + POND_VERSION), apart from the soil versions", () => {
    expect(modelVersionOf("lotus")).toBe(1000 + POND_VERSION);
    expect(modelVersionOf("rose")).toBe(SIM_VERSION);
    expect(modelVersionOfState(createPlant("lotus", 17, OWNER))).toBe(1001);
    expect(modelVersionOfState(createPlant("rose", 17, OWNER))).toBe(SIM_VERSION);
  });

  it("is trusted only when its version, its state's mark and its species all match the planting", () => {
    const s = lotusAt(60, [{ id: 1, h: 20, kind: "water" }, { id: 2, h: 21, kind: "tend" }]);
    expect(baseState({ h: 60, state: s, simVersion: 1001, version: 2 }, LOTUS)).toEqual({ state: s, rebuilt: false });
    // the soil version in the column, a pond state from another POND_VERSION, a soil state under a lotus planting, a lotus
    // state under a soil planting: each is rebuilt from the planting
    expect(baseState({ h: 60, state: s, simVersion: SIM_VERSION, version: 2 }, LOTUS).rebuilt).toBe(true);
    expect(baseState({ h: 60, state: { ...s, v: POND_VERSION + 1 }, simVersion: 1001, version: 2 }, LOTUS).rebuilt).toBe(true);
    const soil = createPlant("rose", 17, OWNER);
    expect(baseState({ h: 17, state: soil, simVersion: 1001, version: 0 }, LOTUS).rebuilt).toBe(true);
    expect(baseState({ h: 60, state: s, simVersion: SIM_VERSION, version: 2 }, { ...LOTUS, speciesId: "rose" }).rebuilt).toBe(true);
    expect(baseState({ h: 60, state: s, simVersion: 1001, version: 2 }, { ...LOTUS, speciesId: "rose" }).rebuilt).toBe(true);
  });

  it("catches up in its own model and saves under its own version", async () => {
    const seed = seedState(LOTUS);
    let cp: CheckpointRecord = { h: seed.h, state: seed, simVersion: modelVersionOf("lotus"), version: 0 };
    const events: TimedEvent[] = [{ id: 1, h: 20, kind: "water" }, { id: 2, h: 40, kind: "tend" }, { id: 3, h: 66, kind: "water" }];
    const deps: AdvanceDeps = {
      planting: LOTUS,
      loadCheckpoint: async () => JSON.parse(JSON.stringify(cp)) as CheckpointRecord,
      loadEvents: async (fromH, toH) => events.filter((e) => e.h >= fromH && e.h < toH),
      ensureWeather: async () => {},
      loadWeather: async () => wx,
      saveCheckpoint: async (expected, state) => {
        if (cp.version !== expected) return false;
        cp = { h: state.h, state: JSON.parse(JSON.stringify(state)) as PlantState, simVersion: modelVersionOfState(state), version: expected + 1 };
        return true;
      },
    };
    await advanceCheckpoint(deps, 50);
    const r = await advanceCheckpoint(deps, 90);
    expect(r.state).toEqual(lotusAt(90, events));
    expect(cp.simVersion).toBe(1001);
    expect(r.state).toMatchObject({ medium: "pond", sp: "lotus", v: POND_VERSION });
  });

  it("needs no rehearsal shift before the party: its \"not yet\" marks are POND_NONE", () => {
    const rehearsal: Planting = { ...LOTUS, plantedH: -577 };
    expect(seedState(rehearsal)).toEqual(createPlant("lotus", -577, OWNER));
    const s = catchUp(seedState(rehearsal), [{ id: 1, h: -577, kind: "water" }, { id: 2, h: -577, kind: "tend" }], wx, -570);
    expect(s.lastCanH).toBe(-577);
    expect(s).toMatchObject({ lastKoiH: -577, lastFeedH: POND_NONE, bloomH: POND_NONE });
  });
});

describe("seedState", () => {
  it("is exactly createPlant() for a real planting", () => {
    expect(seedState(PLANTING)).toEqual(createPlant(PLANTING.speciesId, PLANTING.plantedH, PLANTING.owner));
    expect(seedState({ ...PLANTING, plantedH: 400 })).toEqual(createPlant(PLANTING.speciesId, 400, PLANTING.owner));
  });

  it("lets a rehearsal plant at a negative hour take a can and a feed straight away", () => {
    const rehearsal: Planting = { ...PLANTING, plantedH: -577 };
    const events: TimedEvent[] = [{ id: 1, h: -577, kind: "water" }, { id: 2, h: -577, kind: "feed" }];
    const s = catchUp(seedState(rehearsal), events, wx, -570);
    expect(s.lastCanH).toBe(-577);
    expect(s.lastFeedH).toBe(-577);
    // the model's own seed would have ignored both
    const raw = catchUp(createPlant(rehearsal.speciesId, -577, OWNER), events, wx, -570);
    expect(raw.lastCanH).toBe(-99);
  });
});
