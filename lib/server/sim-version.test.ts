// Guard for SIM_VERSION: the server trusts a stored checkpoint only when its sim_version equals the running model's
// SIM_VERSION, and rebuilds it from the event log otherwise. A change to how step() behaves without a version bump would
// let production keep stepping states written by the old model. This test replays a fixed, varied season for every
// species (sun, heavy rain, a dry heat spell; good care, neglect, shade and cover, feeding, pests tended, friends'
// sprinkles, a neglected plant that dies and is revived, an overwatered one that drowns) and hashes every state the
// model produces. The hash is recorded per SIM_VERSION, so a behaviour change fails here until SIM_VERSION is bumped and
// the new fingerprint recorded.
//
// When it fails: if you changed lib/sim on purpose, bump SIM_VERSION in lib/sim/model.ts (stored checkpoints are then
// rebuilt from their events) and add the printed fingerprint under the new version below. Never edit the entry of a
// version that has been deployed.
//
// The lotus has its own model and version (lib/sim/pond.ts, POND_VERSION) and its own fingerprint below, over a season of
// its own care (top-ups, tending the pond, feeds, talk, friends' sprinkles, a death, Fairy Dust and a replant). The soil
// fingerprint keeps hashing exactly the six soil species, by a literal list, so adding the lotus to the seed picker left
// SIM_VERSION 7's recorded hash as it was. The same rule holds for both: never edit a recorded entry.
//
// The Pink Lily joined the soil model after SIM_VERSION 7 was recorded: one more row of SIM_SPECIES and TWIN, with not
// one equation or shared constant changed, so the six's hash above still holds and SIM_VERSION stayed 7. The lily has a
// fingerprint of its own (LILY_FINGERPRINTS), over the same season and the same three kinds of care, recorded under the
// SIM_VERSION its numbers were fitted in. A later retune of the lily fails here until SIM_VERSION is bumped (its stored
// checkpoints are then rebuilt) and both hashes are recorded under the new version.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SoilSpeciesId } from "@/lib/plant/species";
import { POND_VERSION, SIM_SPECIES, SIM_VERSION, catchUp, createPlant, type HourWeather, type PlantState, type TimedEvent } from "@/lib/sim";

/** The six soil species, as SIM_VERSION 7's fingerprint was recorded over them (the seed picker's order). */
const SOIL_SPECIES: readonly SoilSpeciesId[] = ["rose", "sundrop", "magnolia", "marigold", "island", "jasmine"];
/** The soil species with a fingerprint of their own, added after SIM_VERSION 7's was recorded. */
const LILY_SPECIES: readonly SoilSpeciesId[] = ["lily"];

const FINGERPRINTS: Record<number, string> = {
  4: "274d8b019681b13f00367613f6254d4565c44fba7646a399a2aff5ef549fb7ff",
  5: "21eacbfb9b2f30e37b6a75d29d8033f3fd5eecd7b303ea8aeefb768e2055c61b",
  6: "0ec8fe9b4900e8d449081d8ea104ff98430c3f77322fba29c8695a2e3e8bb001",
  // rename only: the "island" key in each state; with that key and v read back as 6's, the hash is 6's exactly
  7: "bc62cfb50ce85539441ed4448fae024d1d8eec6c5f9f59bb5e1c8cfb1582bc02",
};

/** The Pink Lily's season, by SIM_VERSION (fitted under 7; see the header). */
const LILY_FINGERPRINTS: Record<number, string> = {
  7: "ca90a22262b654c3ba577c8a8edbdb1d4c1817fe7119828d7515307bec9d73d9",
};

const POND_FINGERPRINTS: Record<number, string> = {
  1: "d797cf8b6a4df83a0af34913e7f1924119b10c1291d822c34833bc6917581616",
};

// a small seeded generator, so the "random" season is the same on every machine
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = 20, END = START + 24 * 30;

function season(): Map<number, HourWeather> {
  const rnd = mulberry32(20261110);
  const out = new Map<number, HourWeather>();
  for (let h = START - 24; h < END; h++) {
    const hod = ((h % 24) + 24) % 24, day = Math.floor(h / 24), sunUp = hod >= 6 && hod < 18;
    const heat = day >= 12 && day < 17 ? 6 : 0;                 // a dry heat spell
    const storm = (day === 5 || day === 6 || day === 22) && hod >= 14 && hod < 20;
    const T = Math.round((21 + heat + 6 * Math.sin(((hod - 9) / 24) * 2 * Math.PI) + (rnd() - 0.5)) * 10) / 10;
    const SW = sunUp ? Math.round((storm ? 120 : 700) * Math.sin(((hod - 6) / 12) * Math.PI) * (0.8 + 0.2 * rnd())) : 0;
    out.set(h, {
      T,
      RH: Math.round(storm ? 95 : heat ? 35 + 10 * rnd() : 60 + 20 * rnd()),
      P: storm ? Math.round((4 + 20 * rnd()) * 10) / 10 : rnd() < 0.03 ? 0.4 : 0,
      SW,
      ET0: sunUp ? Math.round((0.15 + 0.25 * rnd() + heat * 0.03) * 1000) / 1000 : 0.02,
      U: Math.round((5 + 8 * rnd()) * 10) / 10,
      Ts: Math.round((T + 1) * 10) / 10,
      isDay: SW > 0 ? 1 : 0,
    });
  }
  return out;
}

type Care = "good" | "neglect" | "fussy";

function events(care: Care): TimedEvent[] {
  const out: TimedEvent[] = [];
  let id = 1;
  for (let day = 1; day < 30; day++) {
    const at = (hod: number) => day * 24 + hod;
    if (care === "neglect") {
      if (day === 25) out.push({ id: id++, h: at(9), kind: "revive" }, { id: id++, h: at(9), kind: "water" });
      continue;
    }
    out.push({ id: id++, h: at(8), kind: "water" });
    if (care === "fussy") out.push({ id: id++, h: at(19), kind: "water" });
    if (day % 3 === 0) out.push({ id: id++, h: at(9), kind: "feed" });
    if (day % 4 === 1) out.push({ id: id++, h: at(10), kind: "tend" });
    out.push({ id: id++, h: at(11), kind: "talk" });
    if (day >= 12 && day < 17) out.push({ id: id++, h: at(11), kind: "shade", amount: 1 }, { id: id++, h: at(17), kind: "shade", amount: 0 });
    if (day === 5 || day === 22) out.push({ id: id++, h: at(13), kind: "cover", amount: 1 }, { id: id++, h: at(21), kind: "cover", amount: 0 });
    if (day % 2 === 0) out.push({ id: id++, h: at(12), kind: "sprinkle", actor: `friend-${day % 5}` });
  }
  return out.filter((e) => e.h >= START);
}

const round = (_k: string, v: unknown) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);

/** The soil season hashed over the given species (the six's by default, as SIM_VERSION 7 recorded it). */
function fingerprint(species: readonly SoilSpeciesId[] = SOIL_SPECIES): string {
  const wx = season();
  const weather = (h: number) => wx.get(h);
  const hash = createHash("sha256");
  for (const sp of species) {
    for (const care of ["good", "neglect", "fussy"] as Care[]) {
      const evs = events(care);
      let s: PlantState = createPlant(sp, START, "owner-fingerprint");
      // in daily chunks (catch-up is chunk-invariant), hashing each day's state
      for (let h = START + 24; h <= END; h += 24) {
        s = catchUp(s, evs, weather, h);
        hash.update(JSON.stringify(s, round));
      }
    }
  }
  return hash.digest("hex");
}

// The lotus's season: in the jar it gets fresh water at 08:00 (the same action plants it once it is ready), then a top-up
// every other morning, "Tend the pond" twice a day (the koi's pinch and the aphid rinse), a feed now and then (too young
// at first, so it burns), talk, friends' sprinkles; one run is left alone until it dies, gets Fairy Dust, is left again,
// and is replanted.
function pondEvents(care: "good" | "neglect"): TimedEvent[] {
  const out: TimedEvent[] = [];
  let id = 1;
  for (let day = 1; day < 30; day++) {
    const at = (hod: number) => day * 24 + hod;
    if (care === "neglect") {
      if (day === 9) out.push({ id: id++, h: at(9), kind: "revive" });
      if (day === 20) out.push({ id: id++, h: at(9), kind: "replant" }, { id: id++, h: at(10), kind: "tend" });
      if (day > 20) out.push({ id: id++, h: at(8), kind: "tend" }, { id: id++, h: at(18), kind: "tend" });
      continue;
    }
    out.push({ id: id++, h: at(8), kind: "water" });
    if (day % 2 === 0) out.push({ id: id++, h: at(13), kind: "water" });
    out.push({ id: id++, h: at(8), kind: "tend" }, { id: id++, h: at(18), kind: "tend" }, { id: id++, h: at(19), kind: "tend" });
    if (day % 5 === 0) out.push({ id: id++, h: at(9), kind: "feed" });
    out.push({ id: id++, h: at(11), kind: "talk" });
    if (day === 12) out.push({ id: id++, h: at(11), kind: "shade", amount: 1 }, { id: id++, h: at(17), kind: "shade", amount: 0 });
    if (day % 2 === 0) out.push({ id: id++, h: at(12), kind: "sprinkle", actor: `friend-${day % 5}` });
  }
  return out.filter((e) => e.h >= START);
}

function pondFingerprint(): string {
  const wx = season();
  const weather = (h: number) => wx.get(h);
  const hash = createHash("sha256");
  for (const care of ["good", "neglect"] as const) {
    const evs = pondEvents(care);
    let s: PlantState = createPlant("lotus", START, "owner-fingerprint");
    for (let h = START + 24; h <= END; h += 24) {
      s = catchUp(s, evs, weather, h);
      hash.update(JSON.stringify(s, round));
    }
  }
  return hash.digest("hex");
}

describe("SIM_VERSION fingerprint", () => {
  it("matches the recorded behaviour of this SIM_VERSION", () => {
    const fp = fingerprint();
    const recorded = FINGERPRINTS[SIM_VERSION];
    expect(recorded, `No fingerprint is recorded for SIM_VERSION ${SIM_VERSION}. Add ${SIM_VERSION}: "${fp}".`).toBeDefined();
    expect(fp, `lib/sim behaves differently from SIM_VERSION ${SIM_VERSION}'s recorded fingerprint. Bump SIM_VERSION and record "${fp}" under it (see the header).`).toBe(recorded);
  });

  it("is deterministic", () => {
    expect(fingerprint()).toBe(fingerprint());
  });
});

describe("the Pink Lily's fingerprint", () => {
  it("matches the lily's recorded behaviour under this SIM_VERSION", () => {
    const fp = fingerprint(LILY_SPECIES);
    const recorded = LILY_FINGERPRINTS[SIM_VERSION];
    expect(recorded, `No lily fingerprint is recorded for SIM_VERSION ${SIM_VERSION}. Add ${SIM_VERSION}: "${fp}".`).toBeDefined();
    expect(fp, `The lily behaves differently from its recorded fingerprint under SIM_VERSION ${SIM_VERSION}. Bump SIM_VERSION and record "${fp}" under it (see the header).`).toBe(recorded);
  });

  it("is deterministic, and with the six's covers every soil species", () => {
    expect(fingerprint(LILY_SPECIES)).toBe(fingerprint(LILY_SPECIES));
    expect([...SOIL_SPECIES, ...LILY_SPECIES].sort()).toEqual(Object.keys(SIM_SPECIES).sort());
  });
});

describe("POND_VERSION fingerprint", () => {
  it("matches the recorded behaviour of this POND_VERSION", () => {
    const fp = pondFingerprint();
    const recorded = POND_FINGERPRINTS[POND_VERSION];
    expect(recorded, `No fingerprint is recorded for POND_VERSION ${POND_VERSION}. Add ${POND_VERSION}: "${fp}".`).toBeDefined();
    expect(fp, `lib/sim/pond.ts behaves differently from POND_VERSION ${POND_VERSION}'s recorded fingerprint. Bump POND_VERSION and record "${fp}" under it (see the header).`).toBe(recorded);
  });

  it("is deterministic, and the lotus's season does what it says", () => {
    expect(pondFingerprint()).toBe(pondFingerprint());
    const wx = season();
    const good = catchUp(createPlant("lotus", START, "o"), pondEvents("good"), (h) => wx.get(h), END);
    const left = catchUp(createPlant("lotus", START, "o"), pondEvents("neglect"), (h) => wx.get(h), END);
    expect(good.alive).toBe(true);
    expect(good.stage).toBe(1);
    expect(left.gen).toBe(2);
    expect(left.fairyUsed).toBe(true);
  });
});
