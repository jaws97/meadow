// The party trailer's timeline (script.ts), checked without a browser: its beats and length, the can's slow-motion
// drink, the growth, the hours, the shower, the flowers and their gates, the black, the words, the doe, the focus
// pulls, every shot placed in the real garden (logic placeShot against lib/garden/room) at 16:9 and 16:10, the cuts,
// the scene's and the look's channels (in bounds, never flashing, neutral once the garden is the party's), the coda's
// match to the party's rose, and the reduced-motion and no-doe versions.
import { describe, expect, it } from "vitest";
import { CAN, varyOf } from "@/components/garden/garden/canMoment";
import { codaShift, DRIFT_REST, HOME, LENS_REST, placed, placeShot, project, type LensAim, type XYZ } from "@/components/party/logic";
import { framingFor, type Framing } from "@/lib/garden/layout";
import { LOOK_IDLE, MIXER_IDENTITY } from "@/lib/garden/look";
import { bulkAt, roomAlong, treeAt } from "@/lib/garden/room";
import { FX_NEUTRAL } from "@/lib/garden/trailerFx";
import { SPECIES } from "@/lib/plant/species";
import {
  BLOOM_AT,
  CODA,
  CODA_AT,
  DIP_HOLD_TO,
  DIP_IN,
  DOE_OFF,
  END_AT,
  FLOWER_S,
  FLOWERS_AT,
  GATES,
  GROW_AT,
  HEADLESS_GROWTH,
  HELLO_AT,
  HOME_AT,
  LINE_OUT_S,
  LINES,
  MONTAGE,
  NAME_IN,
  NIGHT_AT,
  pickCanPress,
  POINTS,
  PRESS_SEARCH_MS,
  RESTORE_AT,
  RETURN_AT,
  SEGMENTS,
  segmentAt,
  segmentsFor,
  slotAt,
  TAGLINE_AT,
  TAGLINE_FADE_S,
  TAGLINE_OUT,
  TITLE_AT,
  Track,
  TRAILER_S,
  trailerAt,
  VISIT_AT,
  WATER_AT,
  WATER_SLOWEST,
  WIND_REST,
  WORD_IN_S,
  type TrailerFrame,
  type TrailerOptions,
} from "@/components/party/trailer/script";

const GOLDEN = 17.45;
const STEP = 1 / 60;
const times = (from: number, to: number, step = STEP) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  return out;
};
const OPTIONS: readonly TrailerOptions[] = [
  { reduced: false, visitor: true },
  { reduced: true, visitor: true },
  { reduced: false, visitor: false },
  { reduced: true, visitor: false },
];
const label = (o: TrailerOptions) => `${o.reduced ? "reduced" : "full"} motion, ${o.visitor ? "with" : "without"} the doe`;

/** The first time (by bisection) a rising channel reaches `v`, between `a` and `b`. */
function reaches(f: (t: number) => number, v: number, a: number, b: number): number {
  let lo = a;
  let hi = b;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < v) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("a track", () => {
  it("passes through its keys and holds beyond them", () => {
    const tr = new Track([
      [0, 1],
      [2, 3],
      [5, 3],
      [6, 0],
    ]);
    expect(tr.at(-1)).toBe(1);
    expect(tr.at(0)).toBe(1);
    expect(tr.at(2)).toBeCloseTo(3, 9);
    expect(tr.at(5)).toBeCloseTo(3, 9);
    expect(tr.at(9)).toBe(0);
  });

  it("never overshoots a key, so a hold stays a hold", () => {
    const tr = new Track([
      [0, 0],
      [1, 1],
      [3, 1],
      [4, 0.2],
    ]);
    for (let t = 0; t <= 4; t += 0.01) {
      expect(tr.at(t)).toBeLessThanOrEqual(1 + 1e-9);
      expect(tr.at(t)).toBeGreaterThanOrEqual(-1e-9);
    }
    for (let t = 1; t <= 3; t += 0.05) expect(tr.at(t)).toBeCloseTo(1, 9);
  });

  it("moves without jumps", () => {
    const tr = new Track([
      [0, 0],
      [1, 2],
      [4, 3],
    ]);
    let last = tr.at(0);
    for (let t = 0.001; t <= 4; t += 0.001) {
      const v = tr.at(t);
      expect(Math.abs(v - last)).toBeLessThan(0.01);
      last = v;
    }
  });
});

describe("the trailer", () => {
  it("runs exactly seventy seconds, its beats in order", () => {
    const beats = [WATER_AT, GROW_AT, BLOOM_AT, VISIT_AT, DOE_OFF, NIGHT_AT, FLOWERS_AT, END_AT, TITLE_AT, RESTORE_AT, CODA_AT, HELLO_AT, HOME_AT, RETURN_AT, TRAILER_S];
    expect(beats).toEqual([...beats].sort((a, b) => a - b));
    expect(new Set(beats).size).toBe(beats.length);
    expect(Math.abs(TRAILER_S - 70)).toBeLessThan(1e-9);
    expect(TRAILER_S).toBeGreaterThan(64);
    expect(TRAILER_S).toBeLessThan(75);
  });

  it("gives the seed its first drink from the can in true slow motion, and dries it with the passing day", () => {
    const water = (t: number) => trailerAt(t, GOLDEN).water;
    expect(water(WATER_AT - 0.01)).toBe(-1);
    // real pace through the wake, the carry and the tip
    for (const t of times(WATER_AT, 8.7 - STEP)) expect(water(t + STEP) - water(t)).toBeCloseTo(STEP, 6);
    // never slower than the slow motion, never going back
    for (const t of times(WATER_AT, RESTORE_AT - STEP)) expect(water(t + STEP) - water(t)).toBeGreaterThanOrEqual(WATER_SLOWEST * STEP - 1e-9);
    // the first drops land in the slow motion
    const lands = reaches(water, CAN.lands, WATER_AT, GROW_AT);
    expect(lands).toBeGreaterThan(8.9);
    expect(lands).toBeLessThan(9.05);
    expect(water(9.5 + STEP) - water(9.5)).toBeCloseTo(WATER_SLOWEST * STEP, 6);
    // real pace again until the can is still, then hurried with the time-lapse
    const still = reaches(water, CAN.still, WATER_AT, BLOOM_AT);
    for (const t of times(10.7, still - STEP)) expect(water(t + STEP) - water(t)).toBeCloseTo(STEP, 6);
    for (const t of times(still + 0.01, still + 2)) expect(water(t + STEP) - water(t)).toBeCloseTo(8 * STEP, 6);
    // a seed in its mound through the whole drink
    for (const t of times(WATER_AT, GROW_AT)) expect(trailerAt(t, GOLDEN).growth).toBeLessThan(HEADLESS_GROWTH);
    expect(water(BLOOM_AT)).toBeGreaterThan(60);
    expect(water(RESTORE_AT)).toBe(-1);
  });

  it("picks a press that pours the cut's way with all four drips, at most 200 ms back", () => {
    for (const now of [1_793_000_000_000, 1_793_000_123_457, 1_800_000_000_999]) {
      const press = pickCanPress(now);
      expect(press.at).toBeLessThanOrEqual(now);
      expect(now - press.at).toBeLessThanOrEqual(PRESS_SEARCH_MS);
      const v = varyOf(press.at);
      expect(v.sweep).toBeGreaterThan(0);
      expect(v.drips).toHaveLength(4);
      expect(press.drips).toHaveLength(4);
      for (const d of press.drips) expect(Math.abs(d)).toBeLessThanOrEqual(0.08 + 1e-9);
    }
  });

  it("opens on the seed alone: no head before the growing beat", () => {
    for (const t of times(0, GROW_AT)) expect(trailerAt(t, GOLDEN).growth).toBeLessThan(HEADLESS_GROWTH);
    expect(trailerAt(0, GOLDEN).growth).toBe(0);
  });

  it("only ever grows (until the restore), and blooms in the golden hour", () => {
    let last = -1;
    for (const t of times(0, RESTORE_AT)) {
      const f = trailerAt(t, GOLDEN);
      expect(f.growth).toBeGreaterThanOrEqual(last - 1e-9);
      last = f.growth;
    }
    expect(trailerAt(BLOOM_AT - 1, GOLDEN).bloom).toBe(0);
    expect(trailerAt(BLOOM_AT + 12, GOLDEN).bloom).toBeCloseTo(1, 6);
    expect(trailerAt(BLOOM_AT + 12, GOLDEN).growth).toBeCloseTo(1, 6);
  });

  it("keeps the hour inside one day, from dawn through golden hour to night", () => {
    for (const t of times(0, TRAILER_S)) {
      const h = trailerAt(t, GOLDEN).hour;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
    expect(trailerAt(0, GOLDEN).hour).toBeLessThan(6.5);
    expect(Math.abs(trailerAt(VISIT_AT + 8, GOLDEN).hour - GOLDEN)).toBeLessThan(0.25);
    expect(trailerAt(FLOWERS_AT, GOLDEN).hour).toBeGreaterThan(GOLDEN + 1.5);
  });

  it("races the hour only under black", () => {
    for (const t of times(0, TRAILER_S - STEP)) {
      const a = trailerAt(t, GOLDEN);
      const speed = Math.abs(trailerAt(t + STEP, GOLDEN).hour - a.hour) / STEP;
      if (speed > 1.5) expect(Math.min(a.cover, trailerAt(t + STEP, GOLDEN).cover), `${t.toFixed(3)} s`).toBeGreaterThanOrEqual(0.98);
    }
  });

  it("rains for a while as the rose grows, and is dry for the bloom", () => {
    const rainy = times(GROW_AT, BLOOM_AT).filter((t) => trailerAt(t, GOLDEN).rain > 0.3);
    expect(rainy.length * STEP).toBeGreaterThan(3);
    for (const t of times(BLOOM_AT, TRAILER_S)) expect(trailerAt(t, GOLDEN).rain).toBe(0);
  });

  it("changes the flower only under black, at its gate", () => {
    let last = trailerAt(0, GOLDEN).species;
    for (const t of times(0, TRAILER_S)) {
      const f = trailerAt(t, GOLDEN);
      if (f.species !== last) {
        expect(f.cover).toBeCloseTo(1, 3);
        expect(GATES.some((g) => Math.abs(g - t) < 2 * STEP)).toBe(true);
      }
      last = f.species;
    }
    for (const g of GATES) expect(trailerAt(g, GOLDEN).cover).toBeCloseTo(1, 6);
  });

  it("has six gates, each montage gate inside its black with a fifth of a second of it still to come", () => {
    expect(GATES).toHaveLength(MONTAGE.length + 1);
    expect(GATES[GATES.length - 1]).toBe(RESTORE_AT);
    GATES.slice(0, MONTAGE.length).forEach((g) => {
      for (const t of times(g, g + 0.2, 1 / 240)) expect(trailerAt(t, GOLDEN).cover).toBeCloseTo(1, 6);
    });
  });

  it("shows each of the other flowers in turn, built to the sundrop, and the rose's seed again at the restore", () => {
    expect(MONTAGE).toEqual(["jasmine", "magnolia", "marigold", "island", "sundrop"]);
    expect(trailerAt(GATES[0] - 0.01, GOLDEN).species).toBe("rose");
    MONTAGE.forEach((id, i) => expect(trailerAt(slotAt(i) + FLOWER_S / 2, GOLDEN).species).toBe(id));
    for (const t of times(RESTORE_AT, TRAILER_S)) expect(trailerAt(t, GOLDEN).species).toBe("rose");
    for (const t of times(0, HOME_AT)) expect(trailerAt(t, GOLDEN).restored).toBe(false);
    for (const t of times(HOME_AT, TRAILER_S + 1)) expect(trailerAt(t, GOLDEN).restored).toBe(true);
  });

  it("names each flower on black over its gate, and keeps the name over its flower", () => {
    MONTAGE.forEach((id, i) => {
      const next = i + 1 < MONTAGE.length ? slotAt(i + 1) : END_AT;
      for (const t of times(slotAt(i) + NAME_IN, next)) {
        const f = trailerAt(t, GOLDEN);
        expect(f.text.name).toBe(SPECIES[id].name);
        expect(f.text.nameOn).toBe(true);
      }
      expect(trailerAt(slotAt(i) + NAME_IN - 0.01, GOLDEN).text.name).not.toBe(SPECIES[id].name);
      const gate = trailerAt(GATES[i], GOLDEN);
      expect(gate.text.name).toBe(SPECIES[id].name);
      expect(gate.text.nameOn).toBe(true);
      expect(gate.cover).toBeCloseTo(1, 6);
    });
    expect(trailerAt(END_AT, GOLDEN).text.nameOn).toBe(false);
  });

  it("opens and ends on black, with clear picture under every line, and the title on black", () => {
    expect(trailerAt(0, GOLDEN).cover).toBe(1);
    expect(trailerAt(TRAILER_S, GOLDEN).cover).toBe(0);
    for (const line of LINES) {
      // the montage's line rides above the dips on purpose
      if (line.ridesDips) continue;
      for (const t of times(line.groups[0].at, line.exit + LINE_OUT_S)) expect(trailerAt(t, GOLDEN).cover, `${line.id} at ${t.toFixed(2)}`).toBeLessThan(0.02);
    }
    for (const t of times(TITLE_AT, CODA_AT)) expect(trailerAt(t, GOLDEN).cover).toBeGreaterThan(0.98);
  });

  it("never shows two pieces of type at once, and leaves each long enough to read", () => {
    for (const o of OPTIONS)
      for (const t of times(0, TRAILER_S)) {
        const { text } = trailerAt(t, GOLDEN, undefined, o);
        expect([text.lineOn, text.title, text.tagline].filter(Boolean).length).toBeLessThanOrEqual(1);
        if (text.nameOn) expect(text.line === "L5" && text.lineOn).toBe(true);
      }
    for (const line of LINES) {
      expect(line.groups.flatMap((g) => g.words).length).toBeLessThanOrEqual(5);
      // fully readable once its last group has faded in
      expect(line.exit - (line.groups[line.groups.length - 1].at + WORD_IN_S)).toBeGreaterThanOrEqual(2.5 - 1e-9);
    }
    expect(TAGLINE_OUT - (TAGLINE_AT + TAGLINE_FADE_S)).toBeGreaterThanOrEqual(2.5 - 1e-9);
    expect(TAGLINE_OUT + TAGLINE_FADE_S).toBeLessThanOrEqual(RETURN_AT + 1.6 + 1e-9);
    // the words over the payoff and over her look: none
    for (const t of [...times(BLOOM_AT, VISIT_AT), ...times(41.8, 44.45)]) {
      const { text } = trailerAt(t, GOLDEN);
      expect(text.lineOn || text.title || text.tagline).toBe(false);
    }
  });

  it("brings the doe in for the golden hour only, and takes her away under black before she turns", () => {
    for (const t of times(0, TRAILER_S)) expect(trailerAt(t, GOLDEN).doe).toBe(t >= VISIT_AT && t < DOE_OFF);
    for (const t of times(DOE_OFF - 0.02, DOE_OFF + 0.02, 1 / 480)) expect(trailerAt(t, GOLDEN).cover).toBeGreaterThanOrEqual(0.98);
    expect(DOE_OFF).toBeLessThanOrEqual(VISIT_AT + 11.18 - 0.25);
  });

  it("pulls focus to her eyes as she looks at the rose, and away under black", () => {
    expect(trailerAt(VISIT_AT + 5, GOLDEN).dof.rack).toBe(0);
    expect(trailerAt(VISIT_AT + 9.5, GOLDEN).dof.rack).toBeCloseTo(1, 6);
    expect(trailerAt(VISIT_AT + 9.5, GOLDEN).dof.to).toBe("doeBone");
    expect(trailerAt(VISIT_AT + 12, GOLDEN).dof.rack).toBe(0);
  });

  it("hands the screen back: the bars go and the panel returns at the end", () => {
    expect(trailerAt(RETURN_AT - 0.1, GOLDEN).bars).toBe(true);
    expect(trailerAt(RETURN_AT - 0.1, GOLDEN).panel).toBe(false);
    expect(trailerAt(RETURN_AT, GOLDEN).bars).toBe(false);
    expect(trailerAt(RETURN_AT, GOLDEN).panel).toBe(true);
  });

  it("lights a rehearsal day as it will the party night", () => {
    const party = trailerAt(VISIT_AT + 8, 17.45);
    const october = trailerAt(VISIT_AT + 8, 17.58);
    expect(october.hour - party.hour).toBeCloseTo(0.13, 6);
  });
});

// ---- the cut --------------------------------------------------------------------------------------------------------

/** The rose's head along its growth (Plant: the stem's height grows on an eased curve), and each montage flower's. */
const SEED_Y = POINTS.seed[1];
const stem = (g: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, (g - 0.03) / 0.9)), 1.4);
function headOf(f: TrailerFrame): XYZ {
  if (f.species !== "rose") return { x: 0, y: SEED_Y + 1.09 * SPECIES[f.species].stem.height, z: 0 };
  return { x: 0, y: f.growth < 0.035 ? SEED_Y : SEED_Y + 1.09 * stem(f.growth), z: 0 };
}

const ASPECTS = [16 / 9, 16 / 10] as const;
const framing = (aspect: number): Framing => framingFor(Math.round(aspect / 0.02) * 0.02);

describe("the cut", () => {
  it("keeps every shot inside the trailer's limits", () => {
    for (const o of OPTIONS)
      for (const t of times(0, TRAILER_S)) {
        const f = trailerAt(t, GOLDEN, undefined, o);
        const s = f.shot;
        const at = `${label(o)}, ${f.events.shot} at ${t.toFixed(2)}`;
        expect(s.yaw, at).toBeGreaterThanOrEqual(-0.55);
        expect(s.yaw, at).toBeLessThanOrEqual(0.4);
        expect(s.lift, at).toBeGreaterThanOrEqual(-0.4);
        expect(s.lift, at).toBeLessThanOrEqual(0.85);
        expect(s.dolly, at).toBeGreaterThanOrEqual(0.1);
        expect(s.dolly, at).toBeLessThanOrEqual(1.3);
        expect(s.zoom, at).toBeGreaterThanOrEqual(0.45);
        expect(s.zoom, at).toBeLessThanOrEqual(1.1);
        expect(s.focus, at).toBeGreaterThanOrEqual(0);
        expect(s.focus, at).toBeLessThanOrEqual(1);
        expect(f.lens.look, at).toBeGreaterThanOrEqual(0);
        expect(f.lens.look, at).toBeLessThanOrEqual(1);
        expect(Math.hypot(f.lens.shiftX, f.lens.shiftY), at).toBeLessThanOrEqual(0.16);
      }
  });

  it("places every shot in the real garden at 16:9 and 16:10: room behind the lens, off the ground, clear of the flower", () => {
    const at = placed();
    const lens: LensAim = { ...LENS_REST, target: { x: 0, y: 0, z: 0 } };
    const bad: string[] = [];
    for (const aspect of ASPECTS) {
      const fr = framing(aspect);
      for (const o of OPTIONS)
        for (const t of times(0, HOME_AT)) {
          const f = trailerAt(t, GOLDEN, undefined, o);
          const head = headOf(f);
          lens.look = f.lens.look;
          lens.target = f.lens.target === "head" ? head : f.lens.point;
          placeShot(fr, head, f.shot, DRIFT_REST, at, lens, true);
          const c = at.position;
          const p = at.pivot;
          const L = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
          const room = roomAlong(p.x, p.y, p.z, (c.x - p.x) / L, (c.y - p.y) / L, (c.z - p.z) / L, L, 0.3);
          const where = `${aspect.toFixed(2)} ${label(o)} ${f.events.shot} ${t.toFixed(2)}`;
          if (room < L - 0.05) bad.push(`${where}: blocked at ${room.toFixed(2)} of ${L.toFixed(2)} m`);
          if (bulkAt(c.x, c.y, c.z) || treeAt(c.x, c.y, c.z)) bad.push(`${where}: inside the scenery`);
          if (c.y < 0.18) bad.push(`${where}: ${c.y.toFixed(2)} m high`);
          if (Math.hypot(c.x - head.x, c.y - head.y, c.z - head.z) < 0.3) bad.push(`${where}: on the flower`);
          if (at.elevation < 0 && at.look.y < 0.3) bad.push(`${where}: looking up from the ground`);
        }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("cuts only between segments, and never just after a gate", () => {
    for (const o of OPTIONS) {
      const list = segmentsFor(o);
      for (let i = 1; i < list.length; i++) expect(list[i].from).toBe(list[i - 1].to);
      expect(list[0].from).toBe(0);
      expect(list[list.length - 1].to).toBe(HOME_AT);
      for (const g of GATES) for (const s of list) expect(s.from > g && s.from <= g + 0.5, `${s.id} after the gate at ${g}`).toBe(false);
      for (const t of times(0, TRAILER_S - STEP)) {
        const a = trailerAt(t, GOLDEN, undefined, o);
        const shotA = { ...a.shot };
        const b = trailerAt(t + STEP, GOLDEN, undefined, o);
        if (a.events.shot !== b.events.shot) continue;
        for (const k of ["yaw", "lift", "dolly", "focus", "zoom"] as const)
          expect(Math.abs(b.shot[k] - shotA[k]), `${label(o)} ${a.events.shot} ${k} at ${t.toFixed(3)}`).toBeLessThan(0.02);
      }
    }
  });

  it("gives each flower one segment, from its black before the gate, the gate's frame held until the black lifts", () => {
    MONTAGE.forEach((_, i) => {
      const seg = segmentAt(GATES[i])!;
      expect(seg.id).toBe(`M${i + 1}`);
      expect(seg.from).toBeCloseTo(slotAt(i) + DIP_IN, 9);
      expect(seg.from).toBeLessThan(GATES[i]);
      expect(trailerAt(seg.from, GOLDEN).cover).toBeCloseTo(1, 6);
      const first = { ...trailerAt(seg.from, GOLDEN).shot };
      expect(trailerAt(slotAt(i) + DIP_HOLD_TO, GOLDEN).shot).toEqual(first);
      expect(segmentAt(slotAt(i) + DIP_HOLD_TO)!.id).toBe(seg.id);
      expect(seg.to).toBeGreaterThan(slotAt(i) + FLOWER_S);
    });
  });

  it("latches the can's pour from the overhead, whatever the options", () => {
    for (const o of OPTIONS) expect(segmentAt(5.99, o)!.id).toBe("S02");
  });

  it("swaps the care beat for reduced motion and the doe's shots for no doe, and nothing else", () => {
    const ids = (o: TrailerOptions) => segmentsFor(o).map((s) => s.id);
    const full = ids(OPTIONS[0]);
    expect(full).toEqual(SEGMENTS.map((s) => s.id));
    expect(ids({ reduced: true, visitor: true })).toEqual(full.flatMap((id) => (id === "S03" ? ["R1", "R2"] : id === "S04" || id === "S05" ? [] : [id])));
    expect(ids({ reduced: false, visitor: false })).toEqual(full.flatMap((id) => (id === "S15" ? ["V1", "V2"] : id === "S16" || id === "S17" ? [] : [id])));
    // without her: no pull to her, no line about her, and the rest of the timeline as it was
    for (const t of times(VISIT_AT, NIGHT_AT)) {
      const f = trailerAt(t, GOLDEN, undefined, { reduced: false, visitor: false });
      expect(f.dof.rack).toBe(0);
      expect(f.lens.look).toBe(0);
      expect(f.text.line).not.toBe("L4");
      expect(f.doe).toBe(false);
    }
    for (const t of [...times(0, WATER_AT), ...times(11.4, VISIT_AT), ...times(NIGHT_AT, TRAILER_S)]) {
      const a = trailerAt(t, GOLDEN);
      const b = { ...trailerAt(t, GOLDEN, undefined, { reduced: true, visitor: true }) };
      expect(b.events.shot).toBe(a.events.shot);
      expect(b.cover).toBe(a.cover);
    }
    // reduced motion: the seed's hops in its light only
    for (const t of times(RESTORE_AT, HOME_AT)) expect(trailerAt(t, GOLDEN, undefined, { reduced: true, visitor: true }).fx.seedBulge).toBe(0);
    expect(trailerAt(HELLO_AT + 0.15, GOLDEN).fx.seedBulge).toBeCloseTo(1, 6);
  });

  it("frames the coda's seed exactly where the party's camera shows its rose beside the panel", () => {
    const full: XYZ = { x: 0, y: 1.26, z: 0 };
    const seed: XYZ = { x: POINTS.seed[0], y: POINTS.seed[1], z: POINTS.seed[2] };
    const panel = { x: 0.143, y: 0 };
    for (const aspect of ASPECTS) {
      const fr = framing(aspect);
      const match = codaShift(fr, aspect, full, panel, { x: 0, y: 0, screenX: 0 });
      expect(Math.hypot(match.x, match.y)).toBeLessThanOrEqual(0.22);
      expect(match.screenX).toBeCloseTo(0.35, 2);
      const home = project(placeShot(fr, full, HOME, DRIFT_REST, placed()), full, aspect, { x: 0, y: 0 });
      const f = trailerAt(CODA_AT + 1, GOLDEN);
      expect(f.lens.coda).toBe(true);
      const coda = project(placeShot(fr, seed, f.shot, DRIFT_REST, placed(), LENS_REST, true), seed, aspect, { x: 0, y: 0 });
      expect(Math.abs(coda.x - 2 * match.x - (home.x - 2 * panel.x))).toBeLessThan(0.02);
      expect(Math.abs(coda.y + 2 * match.y - (home.y + 2 * panel.y))).toBeLessThan(0.02);
    }
    const sixteenNine = codaShift(framing(16 / 9), 16 / 9, full, panel, { x: 0, y: 0, screenX: 0 });
    expect(sixteenNine.x).toBeCloseTo(0.151, 2);
    expect(sixteenNine.y).toBeCloseTo(0.081, 2);
  });
});

// ---- the scene's and the look's channels ---------------------------------------------------------------------------

describe("the light and the look", () => {
  it("keeps every channel inside its bounds", () => {
    for (const o of OPTIONS)
      for (const t of times(0, TRAILER_S)) {
        const f = trailerAt(t, GOLDEN, undefined, o);
        const at = `${label(o)} at ${t.toFixed(2)}`;
        expect(f.look.exposure, at).toBeGreaterThanOrEqual(0.85);
        expect(f.look.exposure, at).toBeLessThanOrEqual(1.12);
        expect(f.look.bloomThreshold, at).toBeGreaterThanOrEqual(0.72);
        expect(f.look.grain, at).toBeLessThanOrEqual(0.06);
        expect(f.look.bokeh, at).toBeLessThanOrEqual(1.4);
        expect(f.look.ca, at).toBeLessThanOrEqual(2);
        expect(f.wind, at).toBeLessThanOrEqual(1.8);
        expect(f.fx.glow, at).toBeLessThanOrEqual(5);
        expect(f.fx.lamp, at).toBeLessThanOrEqual(1.15);
        for (const k of ["seedPulse", "seedBulge", "scent"] as const) {
          expect(f.fx[k], at).toBeGreaterThanOrEqual(0);
          expect(f.fx[k], at).toBeLessThanOrEqual(1);
        }
      }
  });

  it("never flashes: every light rising over the picture takes a quarter of a second from 10 % to 90 %", () => {
    const step = 1 / 240;
    const ts = times(0, TRAILER_S + step, step);
    const frames = ts.map((t) => {
      const f = trailerAt(t, GOLDEN);
      return { cover: f.cover, exposure: f.look.exposure, glow: f.fx.glow, lamp: f.fx.lamp, seedPulse: f.fx.seedPulse, bloom: f.look.bloomIntensity };
    });
    const bad: string[] = [];
    for (const k of ["exposure", "glow", "lamp", "seedPulse", "bloom"] as const) {
      let i = 0;
      while (i < ts.length - 1) {
        if (frames[i + 1][k] <= frames[i][k] + 1e-12) {
          i++;
          continue;
        }
        // a rise: from i to the end of the climb (holds included)
        let j = i;
        while (j < ts.length - 1 && frames[j + 1][k] >= frames[j][k] - 1e-12) j++;
        const v0 = frames[i][k];
        const rise = frames[j][k] - v0;
        if (rise > 1e-3) {
          // the crossing times, between samples
          const cross = (share: number) => {
            const v = v0 + share * rise;
            for (let n = i; n < j; n++)
              if (frames[n + 1][k] >= v) return ts[n] + (step * (v - frames[n][k])) / Math.max(1e-12, frames[n + 1][k] - frames[n][k]);
            return ts[j];
          };
          const t10 = cross(0.1);
          const t90 = cross(0.9);
          const seen = frames.slice(i, j + 1).some((f, n) => f.cover < 0.98 && ts[i + n] >= t10 - step && ts[i + n] <= t90 + step);
          if (seen && t90 - t10 < 0.25) bad.push(`${k} from ${ts[i].toFixed(2)}: ${(t90 - t10).toFixed(3)} s`);
        }
        i = j;
      }
    }
    expect(bad).toEqual([]);
  });

  it("is the party screen's own from HOME_AT, and between the restore and HOME_AT only the coda's channels move", () => {
    for (const t of times(HOME_AT, TRAILER_S + 1)) {
      const f = trailerAt(t, GOLDEN);
      expect(f.wind).toBe(WIND_REST);
      expect(f.fx).toEqual({ ...FX_NEUTRAL });
      expect(f.look).toEqual({ ...LOOK_IDLE, mixer: [...MIXER_IDENTITY] });
      expect(f.shot).toEqual({ ...HOME });
      expect([f.lens.look, f.lens.shiftX, f.lens.shiftY, f.lens.follow, f.lens.coda, f.lens.target]).toEqual([0, 0, 0, false, false, null]);
      expect([f.dof.from, f.dof.to, f.dof.rack]).toEqual(["head", null, 0]);
      expect(f.events.shot).toBe("HOME");
      expect(f.water).toBe(-1);
      expect(f.doe).toBe(false);
    }
    for (const o of OPTIONS)
      for (const t of times(RESTORE_AT, HOME_AT)) {
        const f = trailerAt(t, GOLDEN, undefined, o);
        expect(f.coda).toBe(true);
        expect([f.growth, f.bloom, f.rain, f.cloud, f.wind]).toEqual([CODA.growth, CODA.bloom, CODA.rain, CODA.cloud, CODA.wind]);
        expect(f.hour).toBeCloseTo(GOLDEN + CODA.afterGolden, 9);
        // not the coda's: neutral
        expect([f.fx.glow, f.fx.rim, f.fx.pollenSize, f.fx.scent, f.fx.lamp]).toEqual([1, 1, 1, 0, 1]);
        expect([f.look.exposure, f.look.ca]).toEqual([1, 1]);
        expect([f.lens.look, f.lens.shiftX, f.lens.shiftY, f.lens.follow, f.lens.coda]).toEqual([0, 0, 0, false, true]);
        expect(f.events.shot).toBe("C1");
        expect(f.dof.from).toBe("seed");
      }
  });
});
