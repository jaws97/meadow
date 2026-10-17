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
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIM_VERSION, catchUp, createPlant, type HourWeather, type PlantState, type TimedEvent } from "@/lib/sim";
import { SPECIES_IDS } from "./validate";

const FINGERPRINTS: Record<number, string> = {
  4: "274d8b019681b13f00367613f6254d4565c44fba7646a399a2aff5ef549fb7ff",
  5: "21eacbfb9b2f30e37b6a75d29d8033f3fd5eecd7b303ea8aeefb768e2055c61b",
  6: "0ec8fe9b4900e8d449081d8ea104ff98430c3f77322fba29c8695a2e3e8bb001",
  // rename only: the "island" key in each state; with that key and v read back as 6's, the hash is 6's exactly
  7: "bc62cfb50ce85539441ed4448fae024d1d8eec6c5f9f59bb5e1c8cfb1582bc02",
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

function fingerprint(): string {
  const wx = season();
  const weather = (h: number) => wx.get(h);
  const hash = createHash("sha256");
  for (const sp of SPECIES_IDS) {
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
