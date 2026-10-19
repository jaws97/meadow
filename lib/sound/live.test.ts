import { describe, expect, it } from "vitest";
import { BIRD_CALLS, MAX_LAYERS, tile } from "@/lib/sound/catalog";
import { soundFile } from "@/lib/sound/library";
import { describeLive, LEVEL_FLOOR, LIVE_TAU_S, liveMixdown, nextWet } from "@/lib/sound/live";
import type { LiveInput, Mixdown } from "@/lib/sound/types";

/** A still, dry night in the flower garden, changed by `patch`. */
const at = (patch: Partial<LiveInput>): LiveInput => ({
  hour: 23,
  sunAltitudeDeg: -60,
  rain: 0,
  wet: 0,
  wind: 0.2,
  lotus: false,
  deer: false,
  ...patch,
});

const level = (m: Mixdown, key: string) => m.layers.find((l) => l.key === key)?.level ?? 0;

const DAWN = { hour: 6.2, sunAltitudeDeg: 1 };
const MORNING = { hour: 10, sunAltitudeDeg: 40 };
const NOON = { hour: 12.2, sunAltitudeDeg: 75 };
const DUSK = { hour: 18.2, sunAltitudeDeg: -3 };
const NIGHT = { hour: 23, sunAltitudeDeg: -60 };

/**
 * How long a sweep over the whole grid may take (ms). About two seconds on its own, but the full suite runs every file at
 * once and a busy machine can take five times that; vitest's default of 5 s then fails a test that is only slow.
 */
const GRID_TIMEOUT_MS = 60_000;

/** Every combination of a few values for each input, with the hour and the sun's height varied independently. */
function* grid(): Generator<LiveInput> {
  const hours = [0, 1.5, 3, 4.5, 5.5, 6, 6.5, 7.5, 9, 11.9, 12, 12.1, 15, 17, 17.8, 18.3, 19, 20.5, 22, 23.99];
  const alts: number[] = [];
  for (let a = -70; a <= 88; a += 4) alts.push(a);
  for (const a of [-14, -10, -9, -6, -1, 0, 3, 4, 12, 13]) alts.push(a);
  const rains = [0, 0.03, 0.05, 0.08, 0.15, 0.3, 0.5, 0.62, 0.8, 0.95, 1];
  const wets = [0, 0.2, 0.6, 1];
  const winds = [0, 0.5, 1];
  for (const hour of hours)
    for (const sunAltitudeDeg of alts)
      for (const rain of rains)
        for (const wet of wets)
          for (const wind of winds)
            for (const lotus of [false, true])
              for (const deer of [false, true]) yield { hour, sunAltitudeDeg, rain, wet, wind, lotus, deer };
}

describe("the live garden's mixdown", () => {
  it("never asks for more than five layers, and only for real tiles at levels between 0 and 1", () => {
    // checked by hand and gathered, since an expect per value over this many inputs takes minutes
    const problems: string[] = [];
    const callKeys = JSON.stringify([...BIRD_CALLS]);
    let most = 0;
    for (const input of grid()) {
      const m = liveMixdown(input);
      const where = JSON.stringify(input);
      most = Math.max(most, m.layers.length);
      if (m.layers.length > MAX_LAYERS) problems.push(`${m.layers.length} layers at ${where}`);
      if (new Set(m.layers.map((l) => l.key)).size !== m.layers.length) problems.push(`a key twice at ${where}`);
      if (m.tauS !== LIVE_TAU_S) problems.push(`tauS ${m.tauS} at ${where}`);
      for (const l of m.layers) {
        const t = tile(l.key);
        if (!t || soundFile(t.sound ?? "")?.kind !== "bed") problems.push(`${l.key} is not a recorded bed`);
        if (!(l.level > LEVEL_FLOOR && l.level <= 1)) problems.push(`${l.key} at ${l.level} at ${where}`);
      }
      const s = m.shots;
      if (s && (JSON.stringify(s.sounds) !== callKeys || !(s.perMinute > 0 && s.perMinute <= 2.5) || !(s.level > 0 && s.level <= 1))) {
        problems.push(`calls ${JSON.stringify(s)} at ${where}`);
      }
      if (problems.length > 5) break;
    }
    expect(problems).toEqual([]);
    for (const key of BIRD_CALLS) expect(soundFile(key)?.kind).toBe("shot");
    // the grid does reach the cap, so the test is not empty
    expect(most).toBe(MAX_LAYERS);
  }, GRID_TIMEOUT_MS);

  it("keeps the courtyard at night in a gusty downpour to five layers, with its water and the rain in them", () => {
    const m = liveMixdown(at({ ...NIGHT, lotus: true, rain: 0.95, wet: 1, wind: 1 }));
    expect(m.layers.length).toBeLessThanOrEqual(MAX_LAYERS);
    expect(level(m, "water-fountain")).toBeGreaterThan(0.2);
    expect(level(m, "rain-light")).toBeGreaterThan(0.5);
    expect(level(m, "rain-monsoon")).toBeGreaterThan(0.3);
    expect(level(m, "night-forest")).toBe(0);
  });

  it("moves a little when the sky or the weather moves a little (no switches)", () => {
    const keysOf = (m: Mixdown) => new Set(m.layers.map((l) => l.key));
    const steps: Partial<Record<keyof LiveInput, number>> = { hour: 0.01, sunAltitudeDeg: 0.1, rain: 0.002, wet: 0.002, wind: 0.002 };
    let worst = 0;
    let worstCalls = 0;
    let n = 0;
    for (const input of grid()) {
      if (n++ % 7 !== 0) continue; // a seventh of the grid is plenty here
      const base = liveMixdown(input);
      for (const [field, step] of Object.entries(steps) as [keyof LiveInput, number][]) {
        const moved = liveMixdown({ ...input, [field]: (input[field] as number) + step });
        for (const key of new Set([...keysOf(base), ...keysOf(moved)])) {
          worst = Math.max(worst, Math.abs(level(base, key) - level(moved, key)));
        }
        const calls = (m: Mixdown) => m.shots?.perMinute ?? 0;
        worstCalls = Math.max(worstCalls, Math.abs(calls(base) - calls(moved)));
      }
    }
    // the beds alone move at most about 0.03 for these steps; where the five-layer cap is easing the faintest out,
    // up to about twice that
    expect(worst).toBeLessThan(0.08);
    expect(worstCalls).toBeLessThan(0.1);
  }, GRID_TIMEOUT_MS);

  it("sweeps through a whole day and night with no jump between neighbouring minutes", () => {
    // About 0.025 a minute at most from the sky alone; up to about 0.1 in the half hour of dusk in a courtyard in the
    // rain, where the cap eases the dusk chorus out a little faster. The engine eases every change over eight seconds.
    // The sun's height over Bangalore in October, roughly: up at 6:05, highest (67 degrees) at 12:05, down at 18:05.
    const altitudeAt = (h: number) => 67 * Math.sin(((h - 6.08) / 12) * Math.PI) * (h > 6.08 && h < 18.08 ? 1 : 0.9);
    const weathers = [{}, { rain: 0.6, wet: 1 }, { wet: 0.5 }, { lotus: true }, { deer: true, wind: 0.8 }, { lotus: true, rain: 0.95, wet: 1, wind: 1 }];
    const problems: string[] = [];
    for (const weather of weathers) {
      let previous = liveMixdown(at({ hour: 0, sunAltitudeDeg: altitudeAt(0), ...weather }));
      for (let minute = 1; minute <= 24 * 60; minute++) {
        const hour = minute / 60;
        const next = liveMixdown(at({ hour: hour % 24, sunAltitudeDeg: altitudeAt(hour), ...weather }));
        for (const key of new Set([...previous.layers, ...next.layers].map((l) => l.key))) {
          const step = Math.abs(level(previous, key) - level(next, key));
          if (step >= 0.12) problems.push(`${key} moved ${step.toFixed(3)} at ${hour.toFixed(2)} h in ${JSON.stringify(weather)}`);
        }
        previous = next;
      }
    }
    expect(problems).toEqual([]);
  });

  it("eases each new state in over about eight seconds", () => {
    expect(liveMixdown(at(DAWN)).tauS).toBe(8);
  });
});

describe("the day as the live garden hears it", () => {
  it("opens with the Indian morning chorus and its calls around sunrise", () => {
    const m = liveMixdown(at({ ...DAWN, wind: 0.5 }));
    expect(level(m, "birds-blr")).toBeCloseTo(0.5, 2);
    expect(level(m, "night-crickets")).toBe(0);
    expect(level(m, "night-dusk")).toBe(0);
    expect(m.shots?.perMinute).toBeCloseTo(2.5, 1);
  });

  it("hears garden birds and bees by day, a little quieter at noon, with a call now and then", () => {
    const m = liveMixdown(at(MORNING));
    expect(level(m, "birds-garden")).toBeCloseTo(0.28, 2);
    expect(level(m, "birds-meadow")).toBeCloseTo(0.25, 2);
    expect(level(m, "birds-blr")).toBe(0);
    expect(level(m, "night-crickets")).toBe(0);
    expect(m.shots?.perMinute).toBeCloseTo(0.8, 2);
    const noon = liveMixdown(at(NOON));
    expect(level(noon, "birds-garden")).toBeLessThan(level(m, "birds-garden") * 0.8);
    expect(level(noon, "birds-garden")).toBeGreaterThan(0.1);
  });

  it("brings night falling at dusk, and only in the evening", () => {
    const dusk = liveMixdown(at(DUSK));
    expect(level(dusk, "night-dusk")).toBeCloseTo(0.45, 2);
    expect(level(dusk, "birds-blr")).toBe(0);
    // the same sun in the morning is dawn, not dusk
    const dawn = liveMixdown(at({ hour: 6, sunAltitudeDeg: -3 }));
    expect(level(dawn, "night-dusk")).toBe(0);
    expect(level(dawn, "birds-blr")).toBeGreaterThan(0.2);
  });

  it("sings crickets, a far forest and a few frogs at night, with no bird calls", () => {
    const m = liveMixdown(at(NIGHT));
    expect(level(m, "night-crickets")).toBeCloseTo(0.4, 3);
    expect(level(m, "night-forest")).toBeCloseTo(0.15, 3);
    expect(level(m, "night-frogs")).toBeCloseTo(0.08, 3);
    expect(level(m, "birds-garden")).toBe(0);
    expect(m.shots).toBeNull();
  });

  it("always has wind in the leaves, as strong as the garden's wind", () => {
    for (const wind of [0, 0.2, 0.5, 0.9]) {
      expect(level(liveMixdown(at({ ...MORNING, wind })), "wind-leaves")).toBeCloseTo(0.06 + 0.3 * wind, 3);
    }
  });
});

describe("rain, and the garden after it", () => {
  it("lays light rain on the leaves and hushes the birds, bees and calls", () => {
    const m = liveMixdown(at({ ...MORNING, rain: 0.5, wet: 1 }));
    expect(level(m, "rain-light")).toBeCloseTo(0.5, 2);
    expect(level(m, "rain-monsoon")).toBe(0);
    expect(level(m, "birds-garden")).toBeCloseTo(0.14, 2);
    expect(level(m, "birds-meadow")).toBe(0);
    expect(m.shots).toBeNull();
  });

  it("adds the monsoon under heavy rain", () => {
    const m = liveMixdown(at({ ...MORNING, rain: 0.9, wet: 1 }));
    expect(level(m, "rain-monsoon")).toBeCloseTo(0.36, 2);
    expect(level(m, "rain-light")).toBeCloseTo(0.7, 2);
  });

  it("quietens the crickets, sends the night forest away and brings frogs out in rain at night", () => {
    const m = liveMixdown(at({ ...NIGHT, rain: 0.5, wet: 1 }));
    expect(level(m, "night-crickets")).toBeCloseTo(0.4 * 0.7, 2);
    expect(level(m, "night-forest")).toBe(0);
    expect(level(m, "night-frogs")).toBeCloseTo(0.43, 2);
  });

  it("lets the drips go on while the garden is still wet, and fades them as it dries", () => {
    const wet = liveMixdown(at({ ...MORNING, wet: 0.8 }));
    expect(level(wet, "rain-after")).toBeCloseTo(0.36, 2);
    expect(level(wet, "rain-light")).toBe(0);
    expect(level(liveMixdown(at({ ...MORNING, wet: 0.2 })), "rain-after")).toBeCloseTo(0.09, 2);
    expect(level(liveMixdown(at({ ...MORNING, wet: 0 })), "rain-after")).toBe(0);
    // steady rain covers the drips
    expect(level(liveMixdown(at({ ...MORNING, rain: 0.6, wet: 1 })), "rain-after")).toBe(0);
  });

  it("is soaked by a light shower as by a heavy one, dries over minutes, and copes with nonsense", () => {
    expect(nextWet(0, 0.3, 60)).toBeGreaterThan(0.99);
    expect(nextWet(0, 0.95, 60)).toBeGreaterThan(0.99);
    expect(nextWet(0, 0, 60)).toBe(0);
    expect(nextWet(1, 0, 150)).toBeCloseTo(Math.exp(-1), 3);
    expect(nextWet(0.5, 0, 0)).toBe(0.5);
    expect(nextWet(Number.NaN, Number.NaN, Number.NaN)).toBe(0);
    expect(nextWet(7, 0, -3)).toBe(1);
  });

  it("keeps the drips going for minutes after a shower ends, then lets them fade away", () => {
    // the feed looks every two seconds; two minutes of a moderate shower soak the garden
    const STEP_S = 2;
    let rain = 0.5;
    let wet = 0;
    for (let t = 0; t < 120; t += STEP_S) wet = nextWet(wet, rain, STEP_S);
    expect(wet).toBeGreaterThan(0.99);
    // then the garden's rain eases away (a time constant of two seconds) while the feed keeps looking
    let heardS = 0;
    let saidS = 0;
    for (let t = 0; t < 600; t += STEP_S) {
      rain *= Math.exp(-STEP_S / 2);
      wet = nextWet(wet, rain, STEP_S);
      const input = at({ ...MORNING, rain, wet });
      if (level(liveMixdown(input), "rain-after") > 0.1) heardS += STEP_S;
      if (describeLive(input).includes("drops falling after the rain")) saidS += STEP_S;
    }
    expect(heardS).toBeGreaterThanOrEqual(60);
    expect(saidS).toBeGreaterThanOrEqual(60);
    expect(level(liveMixdown(at({ ...MORNING, wet })), "rain-after")).toBeLessThan(0.02);
  });

  it("never drops a bird call in at night or in rain", () => {
    const heard: string[] = [];
    for (const input of grid()) {
      if (input.sunAltitudeDeg > -10 && input.rain < 0.2) continue;
      const shots = liveMixdown(input).shots;
      if (shots && shots.perMinute > 0) heard.push(JSON.stringify(input));
      if (heard.length > 5) break;
    }
    expect(heard).toEqual([]);
  }, GRID_TIMEOUT_MS);
});

describe("the courtyard and the doe", () => {
  it("keeps the courtyard's water running, with more frogs and no night forest", () => {
    const night = liveMixdown(at({ ...NIGHT, lotus: true }));
    expect(level(night, "water-fountain")).toBeCloseTo(0.3, 3);
    expect(level(night, "night-forest")).toBe(0);
    expect(level(night, "night-frogs")).toBeCloseTo(0.18, 3);
    expect(level(liveMixdown(at({ ...MORNING, lotus: true })), "water-fountain")).toBeCloseTo(0.3, 3);
    expect(level(liveMixdown(at({ ...MORNING })), "water-fountain")).toBe(0);
  });

  it("hushes the birds and their calls a little while the doe is in the garden", () => {
    const without = liveMixdown(at(DAWN));
    const withHer = liveMixdown(at({ ...DAWN, deer: true }));
    expect(level(withHer, "birds-blr")).toBeCloseTo(level(without, "birds-blr") * 0.8, 3);
    expect(withHer.shots!.level).toBeCloseTo(without.shots!.level * 0.8, 3);
    expect(level(withHer, "wind-leaves")).toBeCloseTo(level(without, "wind-leaves"), 6);
  });

  it("copes with nonsense in the input without leaving the range", () => {
    const m = liveMixdown({ hour: NaN, sunAltitudeDeg: Infinity, rain: 7, wet: -2, wind: NaN, lotus: false, deer: false });
    for (const l of m.layers) {
      expect(l.level).toBeGreaterThan(0);
      expect(l.level).toBeLessThanOrEqual(1);
    }
  });
});

describe("the live garden in words", () => {
  it("names what plays now in calm, plain words", () => {
    expect(describeLive(at({ ...DAWN, wind: 0.5 }))).toBe("dawn birds and a light breeze");
    expect(describeLive(at({ ...MORNING, wind: 0.5 }))).toBe("birds and bees, a light breeze");
    expect(describeLive(at({ ...MORNING, wind: 0.2 }))).toBe("birds and bees");
    expect(describeLive(at({ ...MORNING, rain: 0.4, wet: 1, wind: 0.5 }))).toBe("rain on the leaves");
    expect(describeLive(at({ ...MORNING, rain: 0.9, wet: 1 }))).toBe("heavy rain");
    expect(describeLive(at({ ...NIGHT, rain: 0.9, wet: 1 }))).toBe("heavy rain and frogs");
    expect(describeLive(at({ ...MORNING, wet: 0.6 }))).toBe("birds and bees, drops falling after the rain");
    expect(describeLive(at({ ...NIGHT }))).toBe("crickets");
    expect(describeLive(at({ ...NIGHT, wet: 0.5, wind: 0.8 }))).toBe("crickets and frogs, drops falling after the rain");
    expect(describeLive(at({ ...NIGHT, lotus: true, wind: 0.5 }))).toBe("the courtyard fountain and crickets");
    expect(describeLive(at({ ...DUSK, wind: 0.9 }))).toBe("the dusk chorus and wind in the leaves");
    expect(describeLive(at({ ...MORNING, lotus: true, rain: 0.5, wet: 1 }))).toBe("rain on the leaves and the courtyard fountain");
  });

  it("always says something short, in lower case, without a full stop", () => {
    const odd: string[] = [];
    let n = 0;
    for (const input of grid()) {
      if (n++ % 5 !== 0) continue;
      const words = describeLive(input);
      if (words.length === 0 || words.length > 60 || words !== words.toLowerCase() || words.endsWith(".")) odd.push(words);
      if (odd.length > 5) break;
    }
    expect(odd).toEqual([]);
  }, GRID_TIMEOUT_MS);
});
