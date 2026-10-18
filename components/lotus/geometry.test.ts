// The lotus concepts' budgets and rules, checked without a browser:
// - the triangles each tier draws at its peak: the urli (Meadow view) against the art direction's budgets (section
//   10.7: about 60-65k cinematic, 31k balanced, 12k lite), and the whole pond view (water, basin, pot, pebbles,
//   margins, plant and koi) against the v2 budgets below; the Meadow's near light plant against its 940;
// - the address round trip (the pond view, the koi switch, the view alias);
// - the urli's layout rules (every floating leaf on the water, no standing leaf between the flower and the camera, the
//   water's level on the model's cone);
// - the pond's rules (v2): the tank keeps the pond model's water area, shelf, depth and volume, the pot where the model
//   puts it, every floating leaf on open water and clear of its neighbours, stalk heights that read as a water
//   plant's, and the koi's paths clear of the walls, the pot and the shelf's floor;
// - the courtyard's (the lotus garden's own place): the steps' rises and the coping over the fill line, the lamps, the
//   clay lamps, the brass pot and the jar standing on real steps, and its triangles reported per tier.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { pondTriangles, potTriangles } from "@/components/lotus/build";
import { triangles, type Tier } from "@/components/lotus/geometry";
import { innerR, URLI, waterR, waterY } from "@/components/lotus/frame";
import { KOI, KOI_POT, koiCurve, koiTriangles } from "@/components/lotus/koi";
import { bandOf, makeLodLotus } from "@/components/lotus/lod";
import { lookFor, onOpenWater } from "@/components/lotus/look";
import { DEFAULTS, parseParams, toSearch, type ConceptParams, type Stage, type Vessel } from "@/components/lotus/params";
import { jarSpot, POND, POND_AREA, POND_DEEP_AREA, POND_SHELF_AREA, POND_VOLUME, pondFloorY, shelfEdgeZ } from "@/components/lotus/pond";
import { DIYAS, KODAM, LAMPS, LEVEL, STEP, stepAt, stepTopAt, TANK } from "@/components/lotus/courtyard/plan";
import { courtTriangles } from "@/components/lotus/courtyard/geometry";
import { plantTriangles } from "@/components/lotus/courtyard/plants";

const TIERS: Tier[] = ["cinematic", "balanced", "lite"];
const BUDGET: Record<Tier, number> = { cinematic: 65000, balanced: 35000, lite: 14000 };
/** The pond view's whole set piece (v2): the urli's budget plus the pond, its pot and pebbles, the margins and the koi. */
const POND_BUDGET: Record<Tier, number> = { cinematic: 65000, balanced: 34000, lite: 15000 };
const STAGES: Stage[] = ["jar", "floating", "aerial", "bud", "bloom", "pod"];
const VESSELS: Vessel[] = ["a", "b", "c"];
const MOODS = ["happy", "drying", "green"] as const;

const p = (over: Partial<ConceptParams>): ConceptParams => ({ ...DEFAULTS, ...over });

describe("lotus triangle budgets", () => {
  it("keeps the urli (Meadow view) inside each tier's budget at every stage, vessel and mood, rain included", () => {
    const table: Record<string, Record<string, number>> = {};
    for (const tier of TIERS) {
      let peak = 0;
      for (const stage of STAGES) {
        for (const vessel of VESSELS) {
          for (const mood of MOODS) {
            const n = potTriangles(lookFor(p({ view: "meadow", stage, vessel, mood, rain: true, day: "2" })), vessel, tier, true).total;
            peak = Math.max(peak, n);
          }
        }
      }
      expect(peak).toBeLessThanOrEqual(BUDGET[tier]);
      table[tier] = potTriangles(lookFor(p({ view: "meadow", stage: "bloom", vessel: "a", day: "2" })), "a", tier, false);
      table[tier].peakWithRain = peak;
    }
    console.table(table);
  });

  it("keeps the whole pond view inside its budget at every stage and mood, rain and koi included", () => {
    const table: Record<string, Record<string, number>> = {};
    for (const tier of TIERS) {
      let peak = 0;
      for (const stage of STAGES) {
        for (const mood of MOODS) {
          peak = Math.max(peak, pondTriangles(lookFor(p({ stage, mood, rain: true, day: "2" })), tier, true, true).total);
        }
      }
      expect(peak).toBeLessThanOrEqual(POND_BUDGET[tier]);
      table[tier] = pondTriangles(lookFor(p({ stage: "bloom", day: "2" })), tier, false, true);
      table[tier].peakWithRain = peak;
      table[tier].onekoi = koiTriangles(tier);
    }
    console.table(table);
  });

  it("keeps the Meadow's near light plant near 940 triangles", () => {
    const counts: Record<string, number> = {};
    for (const stage of STAGES) {
      const g = makeLodLotus(bandOf(stage));
      counts[bandOf(stage)] = triangles(g);
      g.dispose();
    }
    console.table(counts);
    for (const n of Object.values(counts)) expect(n).toBeLessThanOrEqual(1100);
    expect(counts.bloom).toBeGreaterThan(800);
  });
});

describe("lotus concepts address", () => {
  it("round-trips every control and keeps other parameters", () => {
    const params = p({ vessel: "b", stage: "pod", mood: "green", time: "golden", view: "meadow", cam: "close", day: "3", colour: "tipped", rain: true, still: true, koi: false, overrides: { water: 12, algae: 0.8 } });
    const search = toSearch(params, "?quality=cinematic&governor=off");
    expect(search).toContain("quality=cinematic");
    expect(search).toContain("governor=off");
    expect(parseParams(search)).toEqual(params);
    const pond = p({ stage: "bloom", time: "noon", still: true, overrides: { water: -60 } });
    expect(parseParams(toSearch(pond))).toEqual(pond);
  });

  it("opens the pond by default, takes the old garden view as the pond, and the koi switch", () => {
    expect(parseParams("").view).toBe("pond");
    expect(parseParams("?view=garden").view).toBe("pond");
    expect(parseParams("?view=meadow").view).toBe("meadow");
    expect(parseParams("").koi).toBe(true);
    expect(parseParams("?koi=0").koi).toBe(false);
    expect(toSearch(p({ koi: false }))).toContain("koi=0");
    expect(toSearch(p({}))).not.toContain("vessel");
  });

  it("accepts the task's example, aliases, and falls back on unknown values", () => {
    const q = parseParams("?vessel=b&stage=bloom&time=golden&mood=happy&view=meadow");
    expect([q.vessel, q.stage, q.time, q.mood, q.view]).toEqual(["b", "bloom", "golden", "happy", "meadow"]);
    expect(parseParams("?stage=open&time=evening&vessel=granite").stage).toBe("bloom");
    expect(parseParams("?stage=open&time=evening&vessel=granite").vessel).toBe("b");
    expect(parseParams("?vessel=z&stage=nope").vessel).toBe(DEFAULTS.vessel);
    expect(parseParams("?view=meadow&water=99").overrides.water).toBe(40);
    expect(parseParams("?water=99").overrides.water).toBe(20);
    expect(parseParams("?water=-500").overrides.water).toBe(-120);
  });
});

describe("urli layout (Meadow view)", () => {
  it("puts the water on the model's cone: 0.150 m on bare mud, 0.166 m at the fill line", () => {
    expect(waterR(0)).toBeCloseTo(0.15, 3);
    expect(waterR(25)).toBeCloseTo(0.1656, 3);
    expect(waterY(40)).toBeCloseTo(URLI.brimY, 6);
    expect(innerR(URLI.brimY)).toBeCloseTo(0.175, 3);
  });

  it("floats every leaf inside the water, or leans it on the wall", () => {
    for (const stage of STAGES) {
      for (const mood of MOODS) {
        const look = lookFor(p({ view: "meadow", stage, mood }));
        const room = look.waterMM > 0.5 ? waterR(look.waterMM) : innerR(URLI.mudY);
        for (const f of look.floating) {
          if (f.tilt > 0) continue;
          expect(Math.hypot(f.x, f.z) + f.r).toBeLessThanOrEqual(room);
        }
      }
    }
  });

  it("stands no leaf between the flower and the camera", () => {
    for (const stage of ["bud", "bloom", "pod"] as const) {
      const look = lookFor(p({ view: "meadow", stage }));
      for (const s of look.standing) {
        const inFront = s.top[2] > look.flower.head[2] && Math.abs(s.top[0] - look.flower.head[0]) < s.r;
        expect(inFront).toBe(false);
      }
    }
  });

  it("glows only from the ripe bud through the flower, never on the pod", () => {
    for (const view of ["meadow", "pond"] as const) {
      expect(lookFor(p({ view, stage: "pod", time: "night" })).flower.warmth).toBe(0);
      expect(lookFor(p({ view, stage: "bloom", time: "night" })).flower.warmth).toBeGreaterThan(0.9);
      expect(lookFor(p({ view, stage: "aerial", time: "night" })).glowAt).toBe("none");
    }
  });
});

describe("pond layout (v2)", () => {
  it("sets the pot as the pond model does: 40 cm across, its rim 2.5 cm and its pebbles 5 cm under the fill line, on the 25 cm shelf", () => {
    expect(POND.potR * 2).toBeCloseTo(0.4, 6);
    expect(POND.rimDepth).toBeCloseTo(0.025, 6);
    expect(POND.pebbleDepth).toBeCloseTo(0.05, 6);
    // the shelf's floor under the pot's foot
    expect(POND.waterY - pondFloorY(POND.potX, POND.potZ)).toBeCloseTo(POND.shelfDepth, 3);
    expect(POND.shelfDepth - POND.potH).toBeCloseTo(POND.rimDepth, 3);
    // and the pot wholly on the shelf, inside the water, behind the coping's lip
    const back = POND.potZ - POND.cz - POND.potR - POND.potWall;
    expect(back).toBeGreaterThan(shelfEdgeZ(0) + 0.035);
    expect(POND.potZ - POND.cz + POND.potR + POND.potWall).toBeLessThan(POND.rz - POND.lip);
    // its centre still 9 cm behind the hero mark
    expect(POND.potZ).toBeCloseTo(-0.09, 6);
  });

  it("keeps the pond model's water: 1.30 m2 of surface, a shelf of about 0.6 m2, a deep zone of about 0.7, 0.78 m3", () => {
    expect(POND_AREA).toBeGreaterThan(1.3 * 0.995);
    expect(POND_AREA).toBeLessThan(1.3 * 1.01);
    expect(POND_SHELF_AREA).toBeGreaterThan(0.58);
    expect(POND_SHELF_AREA).toBeLessThan(0.65);
    expect(POND_DEEP_AREA).toBeGreaterThan(0.66);
    expect(POND_DEEP_AREA).toBeLessThan(0.72);
    expect(POND.shelfDepth).toBeCloseTo(0.255, 6);
    expect(POND.deepDepth).toBeCloseTo(0.9, 6);
    expect(POND_VOLUME).toBeGreaterThan(0.78 * 0.98);
    expect(POND_VOLUME).toBeLessThan(0.78 * 1.02);
    // the coping (the lowest step) 5 cm over the fill line, the overflow notch 2 cm over it
    expect(POND.copingY - POND.waterY).toBeCloseTo(0.05, 6);
    expect(POND.overflowMM).toBe(20);
  });

  it("floats every leaf on open water, clear of the coping, and of each other but for a young leaf lying on an older one", () => {
    for (const stage of STAGES) {
      for (const mood of MOODS) {
        const look = lookFor(p({ stage, mood }));
        for (const f of look.floating) expect(onOpenWater(f)).toBe(true);
        let resting = 0;
        for (let i = 0; i < look.floating.length; i++) {
          for (let j = i + 1; j < look.floating.length; j++) {
            const a = look.floating[i];
            const b = look.floating[j];
            const gap = Math.hypot(a.x - b.x, a.z - b.z) - (a.r + b.r);
            if (gap > 0) continue;
            // an overlap only where the younger (later) leaf lies over the older one, raised and tilted onto it, and
            // by no more than two fifths of the smaller blade
            resting++;
            expect(b.y - a.y).toBeGreaterThanOrEqual(0.003);
            expect(b.tilt).toBeGreaterThan(0);
            expect(-gap).toBeLessThanOrEqual(0.4 * Math.min(a.r, b.r));
          }
        }
        expect(resting).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is mostly floating leaves, with one to three standing", () => {
    for (const stage of ["aerial", "bud", "bloom", "pod"] as const) {
      const look = lookFor(p({ stage }));
      expect(look.standing.length).toBeGreaterThanOrEqual(1);
      expect(look.standing.length).toBeLessThanOrEqual(3);
      expect(look.floating.length).toBeGreaterThan(look.standing.length);
    }
  });

  it("holds the leaves and the flower at a water plant's heights: leaves 15-26 cm over the water, the flower just above them", () => {
    for (const stage of ["bud", "bloom", "pod"] as const) {
      const look = lookFor(p({ stage }));
      const tallest = Math.max(...look.standing.map((s) => s.top[1]));
      for (const s of look.standing) {
        expect(s.top[1]).toBeGreaterThanOrEqual(0.15);
        expect(s.top[1]).toBeLessThanOrEqual(0.26);
      }
      expect(look.flower.head[1]).toBeGreaterThan(tallest);
      expect(look.flower.head[1]).toBeLessThanOrEqual(0.36);
    }
  });

  it("stands no leaf between the flower and the camera", () => {
    for (const stage of ["bud", "bloom", "pod"] as const) {
      const look = lookFor(p({ stage }));
      for (const s of look.standing) {
        const inFront = s.top[2] > look.flower.head[2] && Math.abs(s.top[0] - look.flower.head[0]) < s.r;
        expect(inFront).toBe(false);
      }
    }
  });

  it("keeps the pot full of its own water when the pond falls under its rim", () => {
    const low = lookFor(p({ stage: "bloom", mood: "drying" }));
    expect(low.waterMM).toBeLessThan(-POND.rimDepth * 1000);
    expect(low.potWaterMM).not.toBeNull();
    expect(lookFor(p({ stage: "bloom" })).potWaterMM).toBeNull();
  });

  it("swims three koi, clear of the tank's walls, the pot and the shelf's floor, under the surface", () => {
    expect(KOI.length).toBe(3);
    const v = new THREE.Vector3();
    for (const spec of KOI) {
      const c = koiCurve(spec);
      for (let i = 0; i <= 600; i++) {
        c.getPointAt(i / 600, v);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(POND.rx - 0.06);
        expect(Math.abs(v.z)).toBeLessThanOrEqual(POND.rz - 0.06);
        expect(Math.hypot(v.x - KOI_POT.x, v.z - KOI_POT.z)).toBeGreaterThanOrEqual(KOI_POT.clear);
        const floor = pondFloorY(v.x + POND.cx, v.z + POND.cz) - POND.waterY;
        expect(v.y - floor).toBeGreaterThanOrEqual(0.09);
        expect(v.y).toBeLessThanOrEqual(-0.04);
      }
    }
  });
});

describe("courtyard (the lotus garden's own place)", () => {
  it("brings three steps down to the water on the sides and the back, each rise a comfortable 11 cm, the landing level with the coping", () => {
    expect(STEP.count).toBe(3);
    expect(STEP.rise).toBeLessThanOrEqual(0.12);
    expect(LEVEL.terrace - LEVEL.coping).toBeCloseTo(STEP.count * STEP.rise, 6);
    // the water, the coping round it, the steps beside and behind, the landing in front
    expect(stepAt(POND.cx, POND.cz)).toBe(-1);
    expect(stepAt(TANK.x1 + 0.05, POND.cz)).toBe(0);
    expect(stepAt(TANK.x1 + 0.2, POND.cz)).toBe(1);
    expect(stepAt(TANK.x1 + 0.35, POND.cz)).toBe(2);
    expect(stepAt(TANK.x1 + 0.6, POND.cz)).toBe(3);
    expect(stepAt(POND.cx, TANK.zBack - 0.2)).toBe(1);
    expect(stepAt(POND.cx, TANK.zFront + 0.5)).toBe(0);
    expect(stepTopAt(POND.cx, TANK.zFront + 0.5)).toBeCloseTo(POND.copingY, 6);
  });

  it("stands the lamps, the clay lamps, the brass pot and the jar on real steps", () => {
    for (const l of LAMPS) {
      if (l.kind === "tall") expect(stepTopAt(l.x, l.z)).toBeCloseTo(l.y, 6);
    }
    for (const d of DIYAS) {
      expect(stepAt(d.x, d.z)).toBe(0);
      expect(d.y).toBeCloseTo(LEVEL.coping, 6);
    }
    expect(stepTopAt(KODAM.x, KODAM.z)).toBeCloseTo(KODAM.y, 6);
    const jar = jarSpot("Lijas");
    expect(stepAt(jar.at[0], jar.at[2])).toBe(0);
    expect(jar.at[1]).toBeCloseTo(POND.copingY, 6);
  });

  it("reports the courtyard's triangles per tier", () => {
    const table: Record<string, Record<string, number>> = {};
    for (const tier of TIERS) {
      table[tier] = { ...courtTriangles(tier), ...plantTriangles(tier) };
      const total = Object.values(table[tier]).reduce((a, n) => a + n, 0);
      table[tier].total = total;
      // the set round the pond stays lighter than the flower garden's own (about 300k triangles at cinematic)
      expect(total).toBeLessThan(tier === "cinematic" ? 80000 : tier === "balanced" ? 65000 : 30000);
    }
    console.table(table);
  });
});
