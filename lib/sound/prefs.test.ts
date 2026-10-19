import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LAYERS, MIXES, tile } from "@/lib/sound/catalog";
import { cleanLayers, DEFAULT_PREFS, parsePrefs, readPrefs, SOUND_PREFS_KEY, writePrefs, type SoundPrefs } from "@/lib/sound/prefs";

const DEFAULTS: SoundPrefs = { mode: "live", layers: [], volume: 0.8, background: false, timerMin: 0, wasOn: false, mixId: null };

describe("the remembered sound prefs", () => {
  it("start on the live garden at four-fifths volume, with no timer, nothing playing in the background and nothing to resume", () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULTS);
    expect({ ...DEFAULT_PREFS }).toEqual(DEFAULTS);
  });

  it("fall back to the defaults for anything that is not an object", () => {
    for (const junk of [null, undefined, 0, 42, NaN, true, "", "not json", "[1,2]", "null", [], [{ mode: "mix" }], () => 1, Symbol("x")]) {
      expect(parsePrefs(junk)).toEqual(DEFAULTS);
    }
  });

  it("read their own JSON back, field for field", () => {
    const saved: SoundPrefs = {
      mode: "mix",
      layers: [
        { key: "rain-light", level: 0.4 },
        { key: "music-veena", level: 0.3 },
      ],
      volume: 0.55,
      background: true,
      timerMin: 30,
      wasOn: true,
      mixId: null,
    };
    expect(parsePrefs(JSON.stringify(saved))).toEqual(saved);
    expect(parsePrefs(saved)).toEqual(saved);
  });

  it("replace every unusable field with its default", () => {
    const p = parsePrefs({
      mode: "party",
      layers: "rain",
      volume: "loud",
      background: "yes",
      timerMin: 45,
      wasOn: 1,
      mixId: 7,
    });
    expect(p).toEqual(DEFAULTS);
  });

  it("keep the volume and every level between 0 and 1", () => {
    expect(parsePrefs({ volume: 3 }).volume).toBe(1);
    expect(parsePrefs({ volume: -1 }).volume).toBe(0);
    expect(parsePrefs({ volume: 0 }).volume).toBe(0);
    expect(parsePrefs({ volume: NaN }).volume).toBe(0.8);
    expect(parsePrefs({ volume: Infinity }).volume).toBe(0.8);
    const p = parsePrefs({ layers: [{ key: "rain-light", level: 9 }, { key: "water-stream", level: -0.5 }] });
    expect(p.layers).toEqual([
      { key: "rain-light", level: 1 },
      { key: "water-stream", level: 0 },
    ]);
  });

  it("accept only the timer's own choices", () => {
    for (const m of [0, 15, 30, 60] as const) expect(parsePrefs({ timerMin: m }).timerMin).toBe(m);
    for (const m of [1, 20, 90, "30", null, -15]) expect(parsePrefs({ timerMin: m }).timerMin).toBe(0);
  });

  it("keep a ready-made mix's name only while its tiles are unchanged", () => {
    const monsoon = MIXES.find((m) => m.id === "monsoon-evening")!;
    expect(parsePrefs({ mode: "mix", layers: monsoon.layers, mixId: monsoon.id }).mixId).toBe("monsoon-evening");
    // the order the tiles were saved in does not matter
    const reordered = [...monsoon.layers].reverse();
    expect(parsePrefs({ mode: "mix", layers: reordered, mixId: monsoon.id }).mixId).toBe("monsoon-evening");
    expect(parsePrefs({ mode: "mix", layers: monsoon.layers.slice(1), mixId: monsoon.id }).mixId).toBeNull();
    expect(parsePrefs({ mode: "mix", layers: monsoon.layers, mixId: "no-such-mix" }).mixId).toBeNull();
  });
});

describe("a remembered mix", () => {
  it("drops tiles that do not exist and anything that is not a layer", () => {
    expect(
      cleanLayers([
        { key: "rain-light", level: 0.5 },
        { key: "rain-heavy-metal", level: 0.5 },
        { key: 12, level: 0.5 },
        "water-stream",
        null,
        { level: 0.2 },
        { key: "water-stream", level: 0.3 },
      ]),
    ).toEqual([
      { key: "rain-light", level: 0.5 },
      { key: "water-stream", level: 0.3 },
    ]);
    expect(cleanLayers("rain-light")).toEqual([]);
    expect(cleanLayers({ 0: { key: "rain-light", level: 1 } })).toEqual([]);
  });

  it("keeps each tile once, the first time it appears", () => {
    expect(
      cleanLayers([
        { key: "rain-light", level: 0.5 },
        { key: "rain-light", level: 0.9 },
      ]),
    ).toEqual([{ key: "rain-light", level: 0.5 }]);
  });

  it("keeps at most five tiles", () => {
    const many = ["rain-light", "rain-roof", "water-stream", "water-lake", "birds-blr", "night-fire", "tone-bowl"].map((key) => ({ key, level: 0.4 }));
    const kept = cleanLayers(many);
    expect(kept).toHaveLength(MAX_LAYERS);
    expect(kept.map((l) => l.key)).toEqual(["rain-light", "rain-roof", "water-stream", "water-lake", "birds-blr"]);
  });

  it("keeps one piece of music, the first, since two at once would clash", () => {
    const kept = cleanLayers([
      { key: "music-piano", level: 0.5 },
      { key: "rain-light", level: 0.4 },
      { key: "music-veena", level: 0.5 },
      { key: "music-box", level: 0.5 },
    ]);
    expect(kept.map((l) => l.key)).toEqual(["music-piano", "rain-light"]);
  });

  it("starts a tile without a usable level at its own level", () => {
    expect(cleanLayers([{ key: "water-fall" }, { key: "tone-bells", level: "soft" }, { key: "rain-light", level: NaN }])).toEqual([
      { key: "water-fall", level: tile("water-fall")!.level },
      { key: "tone-bells", level: tile("tone-bells")!.level },
      { key: "rain-light", level: tile("rain-light")!.level },
    ]);
  });

  it("accepts every ready-made mix as it is", () => {
    for (const m of MIXES) expect(cleanLayers(m.layers)).toEqual(m.layers);
  });
});

describe("storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the defaults on the server, where there is no window", () => {
    expect(readPrefs()).toEqual(DEFAULTS);
    expect(() => writePrefs(DEFAULTS)).not.toThrow();
  });

  it("writes under garden-sound:v1 and reads the same prefs back", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    const prefs: SoundPrefs = { ...DEFAULTS, mode: "mix", layers: [{ key: "night-fire", level: 0.32 }], wasOn: true, timerMin: 15 };
    writePrefs(prefs);
    expect(store.has(SOUND_PREFS_KEY)).toBe(true);
    expect(SOUND_PREFS_KEY).toBe("garden-sound:v1");
    expect(readPrefs()).toEqual(prefs);
  });

  it("carries on quietly when storage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("full");
        },
      },
    });
    expect(readPrefs()).toEqual(DEFAULTS);
    expect(() => writePrefs(DEFAULTS)).not.toThrow();
  });

  it("reads half-written or hand-edited text as the defaults", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => '{"mode":"mix","layers":[{"key":"rain-li', setItem: () => {} } });
    expect(readPrefs()).toEqual(DEFAULTS);
  });
});
