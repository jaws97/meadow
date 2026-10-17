// The shared weather store, on fakes (no network, no database): it stores only completed hours, never invents an hour
// Open-Meteo did not supply, serves concurrent callers with one fetch, backs off after a failed attempt, fills a gap
// from the historical-forecast service and an old one from the archive, and warns when plants are paused behind a gap.
import { describe, expect, it, vi } from "vitest";
import { dateOfHour, type GameHourWeather, type HourWeather } from "@/lib/sim";
import {
  ARCHIVE_AFTER_H,
  ARCHIVE_SOURCE,
  HISTORICAL_SOURCE,
  WEATHER_SOURCE,
  createWeatherStore,
  fetchArchiveHours,
  fetchHistoricalHours,
  type WeatherDeps,
} from "./weather-store";

// vi.mock is hoisted above the imports: the store module is server-only outside tests
vi.mock("server-only", () => ({}));

const WX: HourWeather = { T: 24.5, RH: 70, P: 0, SW: 400, ET0: 0.2, U: 6, Ts: 25, isDay: 1 };
const rows = (from: number, to: number, skip: (h: number) => boolean = () => false): GameHourWeather[] => {
  const out: GameHourWeather[] = [];
  for (let h = from; h < to; h++) if (!skip(h)) out.push({ h, wx: { ...WX, T: 20 + (h % 10) } });
  return out;
};

interface FakeOpts {
  nowH: number;
  have?: number[];
  served?: (pastDays: number) => GameHourWeather[];
  failFetch?: boolean;
  archive?: (fromH: number, toH: number) => GameHourWeather[];
  historical?: (fromH: number, toH: number) => GameHourWeather[];
}

function fake(opts: FakeOpts) {
  const stored = new Map<number, { wx: HourWeather; source: string }>();
  for (const h of opts.have ?? []) stored.set(h, { wx: WX, source: WEATHER_SOURCE });
  let clockMs = dateOfHour(opts.nowH).getTime() + 20 * 60_000; // 20 minutes into the hour
  const fetches: number[] = [];
  const archiveCalls: [number, number][] = [];
  const historicalCalls: [number, number][] = [];
  const logs: string[] = [];
  const deps: WeatherDeps = {
    now: () => new Date(clockMs),
    existingHours: async (fromH, toH) => [...stored.keys()].filter((h) => h >= fromH && h < toH),
    insertRows: async (rs, source) => {
      for (const r of rs) if (!stored.has(r.h)) stored.set(r.h, { wx: r.wx, source });   // insert-once
    },
    fetchRows: async (pastDays) => {
      fetches.push(pastDays);
      await new Promise((r) => setTimeout(r, 5));
      if (opts.failFetch) throw new Error("HTTP 503");
      return (opts.served ?? (() => rows(opts.nowH - pastDays * 24, opts.nowH + 24)))(pastDays);
    },
    fetchHistoricalRows: opts.historical
      ? async (fromH, toH) => {
        historicalCalls.push([fromH, toH]);
        return opts.historical!(fromH, toH);
      }
      : undefined,
    fetchArchiveRows: opts.archive
      ? async (fromH, toH) => {
        archiveCalls.push([fromH, toH]);
        return opts.archive!(fromH, toH);
      }
      : undefined,
    log: (m) => logs.push(m),
  };
  return { deps, stored, fetches, archiveCalls, historicalCalls, logs, advance: (ms: number) => { clockMs += ms; } };
}

describe("weather store", () => {
  it("stores only completed hours, never the hour in progress or the forecast ahead", async () => {
    const f = fake({ nowH: 100 });
    const store = createWeatherStore(f.deps);
    const missing = await store.ensure(90, 130);
    expect(missing).toEqual([]);
    expect([...f.stored.keys()].sort((a, b) => a - b)).toEqual(rows(90, 100).map((r) => r.h));
    expect(f.stored.has(100)).toBe(false);
    expect(f.stored.get(95)?.source).toBe(WEATHER_SOURCE);
  });

  it("does not fetch when the range is already covered", async () => {
    const f = fake({ nowH: 100, have: rows(80, 100).map((r) => r.h) });
    expect(await createWeatherStore(f.deps).ensure(80, 100)).toEqual([]);
    expect(f.fetches).toEqual([]);
  });

  it("never invents weather: an hour Open-Meteo leaves out stays missing", async () => {
    const f = fake({ nowH: 100, served: (pd) => rows(100 - pd * 24, 124, (h) => h === 95 || h === 96) });
    const missing = await createWeatherStore(f.deps).ensure(90, 100);
    expect(missing).toEqual([95, 96]);
    expect(f.stored.has(95)).toBe(false);
    expect(f.stored.has(94)).toBe(true);
  });

  it("asks for enough past days to reach the earliest missing hour", async () => {
    const f = fake({ nowH: 200 });
    await createWeatherStore(f.deps).ensure(17, 200);
    expect(f.fetches).toHaveLength(1);
    expect(f.fetches[0] * 24).toBeGreaterThanOrEqual(200 - 17);
    expect(f.stored.size).toBe(200 - 17);
  });

  it("serves a burst of concurrent visits with one fetch", async () => {
    const f = fake({ nowH: 300, have: rows(17, 299).map((r) => r.h) });
    const store = createWeatherStore(f.deps);
    const results = await Promise.all(Array.from({ length: 25 }, () => store.ensure(290, 300)));
    expect(f.fetches).toHaveLength(1);
    for (const r of results) expect(r).toEqual([]);
    expect(f.stored.has(299)).toBe(true);
  });

  it("is harmless when two instances fetch at once: the second insert changes nothing", async () => {
    const f = fake({ nowH: 100 });
    const a = createWeatherStore(f.deps), b = createWeatherStore(f.deps);
    await Promise.all([a.ensure(90, 100), b.ensure(90, 100)]);
    expect(f.stored.size).toBe(10);
  });

  it("backs off for a minute after a failed fetch, then tries again", async () => {
    const f = fake({ nowH: 100, failFetch: true });
    const store = createWeatherStore(f.deps);
    expect(await store.ensure(98, 100)).toEqual([98, 99]);
    expect(await store.ensure(98, 100)).toEqual([98, 99]);
    expect(f.fetches).toHaveLength(1);
    f.advance(61_000);
    await store.ensure(98, 100);
    expect(f.fetches).toHaveLength(2);
  });

  it("fills a gap the forecast cannot from the archive, once the hour is old enough", async () => {
    const gap = (h: number) => h === 150 || h === 151;
    const f = fake({
      nowH: 200,
      served: (pd) => rows(200 - pd * 24, 224, gap),
      archive: (from, to) => rows(from, to),
    });
    const missing = await createWeatherStore(f.deps).ensure(140, 200);
    expect(missing).toEqual([]);
    expect(f.archiveCalls).toEqual([[150, 152]]);
    expect(f.stored.get(150)?.source).toBe(ARCHIVE_SOURCE);
    expect(f.stored.get(149)?.source).toBe(WEATHER_SOURCE);
  });

  it("leaves a fresh gap to the forecast and asks the archive at most every half hour", async () => {
    const recent = 200 - ARCHIVE_AFTER_H + 1;
    const f = fake({ nowH: 200, served: (pd) => rows(200 - pd * 24, 224, (h) => h === recent || h === 150), archive: () => [] });
    const store = createWeatherStore(f.deps);
    expect(await store.ensure(140, 200)).toEqual([150, recent]);
    expect(f.archiveCalls).toEqual([[150, 151]]);
    f.advance(61_000);
    await store.ensure(140, 200);
    expect(f.fetches).toHaveLength(2);
    expect(f.archiveCalls).toHaveLength(1);
    f.advance(30 * 60_000);
    await store.ensure(140, 200);
    expect(f.archiveCalls).toHaveLength(2);
  });

  it("fills a fresh gap from the historical-forecast service, completed hours only", async () => {
    const f = fake({
      nowH: 200,
      served: (pd) => rows(200 - pd * 24, 224, (h) => h === 197 || h === 198),
      historical: (from, to) => rows(from, to + 24),
    });
    expect(await createWeatherStore(f.deps).ensure(190, 200)).toEqual([]);
    expect(f.historicalCalls).toEqual([[197, 199]]);
    expect(f.stored.get(197)?.source).toBe(HISTORICAL_SOURCE);
    expect(f.stored.get(196)?.source).toBe(WEATHER_SOURCE);
    expect(f.stored.has(200)).toBe(false);
  });

  it("keeps plants growing when the forecast API is down, asking the historical service at most every ten minutes", async () => {
    let served = true;
    const f = fake({ nowH: 300, failFetch: true, historical: (from, to) => (served ? rows(from, to) : []) });
    const store = createWeatherStore(f.deps);
    expect(await store.ensure(290, 300)).toEqual([]);
    expect(f.stored.get(299)?.source).toBe(HISTORICAL_SOURCE);
    served = false;
    f.advance(60 * 60_000); // the next hour completes: 300 is now missing
    expect(await store.ensure(290, 301)).toEqual([300]);
    f.advance(61_000);
    expect(await store.ensure(290, 301)).toEqual([300]);
    expect(f.historicalCalls).toHaveLength(2);
    f.advance(10 * 60_000);
    served = true;
    expect(await store.ensure(290, 301)).toEqual([]);
    expect(f.historicalCalls).toHaveLength(3);
  });

  it("still never invents an hour that neither service supplies", async () => {
    const f = fake({ nowH: 100, served: (pd) => rows(100 - pd * 24, 124, (h) => h === 95), historical: (from, to) => rows(from, to, (h) => h === 95) });
    expect(await createWeatherStore(f.deps).ensure(90, 100)).toEqual([95]);
    expect(f.stored.has(95)).toBe(false);
  });

  it("warns, at most every ten minutes, while plants wait behind a gap", async () => {
    const f = fake({ nowH: 200, served: (pd) => rows(200 - pd * 24, 224, (h) => h === 190) });
    const store = createWeatherStore(f.deps);
    await store.ensure(180, 200);
    expect(f.logs.filter((l) => l.startsWith("weather is behind"))).toHaveLength(1);
    expect(f.logs[0]).toContain("hour 190");
    await store.ensure(180, 200);
    expect(f.logs.filter((l) => l.startsWith("weather is behind"))).toHaveLength(1);
    f.advance(11 * 60_000);
    await store.ensure(180, 200);
    expect(f.logs.filter((l) => l.startsWith("weather is behind"))).toHaveLength(2);
  });

  it("does not warn about the hour that has only just completed", async () => {
    const f = fake({ nowH: 200, served: (pd) => rows(200 - pd * 24, 224, (h) => h === 199) });
    expect(await createWeatherStore(f.deps).ensure(190, 200)).toEqual([199]);
    expect(f.logs).toEqual([]);
  });

  it("asks the archive for whole IST days, never past yesterday (it refuses later dates)", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ hourly: { time: [] } }) };
    };
    const now = new Date(dateOfHour(200).getTime() + 20 * 60_000);   // 18 Nov, 08:20 IST
    await fetchArchiveHours(150, 152, now, fetchImpl);
    expect(urls.pop()).toMatch(/start_date=2026-11-16&end_date=2026-11-16/);
    await fetchArchiveHours(170, 199, now, fetchImpl);
    expect(urls.pop()).toMatch(/start_date=2026-11-17&end_date=2026-11-17/);
    // a gap entirely from today: nothing to ask yet
    expect(await fetchArchiveHours(196, 199, now, fetchImpl)).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("answers with no gaps rather than throwing when storage is down", async () => {
    const f = fake({ nowH: 100 });
    f.deps.existingHours = async () => {
      throw new Error("connection refused");
    };
    await expect(createWeatherStore(f.deps).ensure(90, 100)).resolves.toEqual([]);
  });
});

describe("historical forecast hours", () => {
  it("ask for the IST days the hours fall on, and report an Open-Meteo error by status and reason only", async () => {
    const urls: string[] = [];
    const ok = async (u: string) => {
      urls.push(u);
      return {
        ok: true, status: 200,
        json: async () => ({
          utc_offset_seconds: 19800,
          hourly: {
            time: ["2026-11-10T01:00", "2026-11-10T02:00"], temperature_2m: [21, 20.5], relative_humidity_2m: [80, 82],
            precipitation: [0, 0.2], shortwave_radiation: [0, 0], et0_fao_evapotranspiration: [0.01, 0.01],
            wind_speed_10m: [4, 5], soil_temperature_0_to_7cm: [22, 22], is_day: [0, 0],
          },
        }),
      };
    };
    const got = await fetchHistoricalHours(0, 2, ok);
    expect(got.map((r) => r.h)).toEqual([0, 1]);
    expect(urls[0]).toMatch(/start_date=2026-11-10&end_date=2026-11-10/);
    const refused = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: "Too many requests" }) });
    await expect(fetchHistoricalHours(0, 2, refused)).rejects.toThrow("Open-Meteo historical forecast: HTTP 429: Too many requests");
  });
});
