// The weather ahead, on fakes (no network): the request asks for three days with cloud cover, rows line up with the
// model's hours (row h takes the stamp at the end of its hour), the source serves the next 24 hours from the hour in
// progress with the model's rainSoon, reuses one request per half hour across concurrent callers, backs off after a
// failure while serving the last forecast for a few hours, and never throws.
import { describe, expect, it, vi } from "vitest";
import { BED, GAME_START_MS, HOURLY_VARIABLES, HOUR_MS, dateOfHour, rainSoon, type HourWeather } from "@/lib/sim";
import {
  AHEAD_H,
  FRESH_MS,
  RETRY_MS,
  STALE_MS,
  buildAheadUrl,
  createForecastSource,
  fetchAheadRows,
  parseAhead,
  type AheadRow,
  type ForecastDeps,
} from "./forecast";

// vi.mock is hoisted above the imports: the module is server-only outside tests
vi.mock("server-only", () => ({}));

const WX: HourWeather = { T: 24.5, RH: 70, P: 0, SW: 400, ET0: 0.2, U: 6, Ts: 25, isDay: 1 };

/** An Open-Meteo payload (timeformat=unixtime) for the game hours [fromH, toH): each row stamped at the end of its hour. */
function payload(fromH: number, toH: number, at: (h: number) => { P?: number; T?: number; cloud?: number | null; SW?: number; day?: number } = () => ({})) {
  const hourly: Record<string, unknown[]> = { time: [], cloud_cover: [] };
  for (const v of HOURLY_VARIABLES) hourly[v] = [];
  for (let h = fromH; h < toH; h++) {
    const o = at(h);
    hourly.time.push((GAME_START_MS + (h + 1) * HOUR_MS) / 1000);
    hourly.temperature_2m.push(o.T ?? 22 + (h % 7));
    hourly.relative_humidity_2m.push(80);
    hourly.precipitation.push(o.P ?? 0);
    hourly.shortwave_radiation.push(o.SW ?? 300);
    hourly.et0_fao_evapotranspiration.push(0.15);
    hourly.wind_speed_10m.push(7);
    hourly.soil_temperature_0_to_7cm.push(23);
    hourly.is_day.push(o.day ?? 1);
    hourly.cloud_cover.push(o.cloud === undefined ? 40 : o.cloud);
  }
  return { utc_offset_seconds: 19800, hourly };
}

const rows = (fromH: number, toH: number, rainAt: (h: number) => number = () => 0): AheadRow[] => {
  const out: AheadRow[] = [];
  for (let h = fromH; h < toH; h++) out.push({ h, wx: { ...WX, P: rainAt(h), T: 20 + (h % 10) }, cloudPct: 50 });
  return out;
};

function fake(opts: { nowH: number; serve?: () => AheadRow[]; fail?: () => boolean; delayMs?: number }) {
  let clockMs = dateOfHour(opts.nowH).getTime() + 20 * 60_000; // 20 minutes into the hour
  let calls = 0;
  const logs: string[] = [];
  const deps: ForecastDeps = {
    now: () => new Date(clockMs),
    fetchRows: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 5));
      if (opts.fail?.()) throw new Error("Open-Meteo forecast: HTTP 503");
      return (opts.serve ?? (() => rows(opts.nowH - 20, opts.nowH + 52)))();
    },
    log: (m) => logs.push(m),
  };
  return { deps, logs, calls: () => calls, advance: (ms: number) => { clockMs += ms; } };
}

describe("buildAheadUrl", () => {
  it("asks the forecast service for three days ahead and no past, with cloud cover and Unix times", () => {
    const url = buildAheadUrl();
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true);
    expect(url).toMatch(/[?&]past_days=0&/);
    expect(url).toMatch(/[?&]forecast_days=3&/);
    expect(url).toMatch(/&hourly=temperature_2m,[a-z0-9_,]*,is_day,cloud_cover&timeformat=unixtime$/);
    expect(url).toMatch(/latitude=12\.9254/);
  });
});

describe("parseAhead", () => {
  it("lines rows up with the model's hours, cloud cover from the same stamp, rounded and clamped", () => {
    const body = payload(100, 104, (h) => ({ P: h === 101 ? 2.34 : 0, cloud: h === 102 ? 101.6 : h === 103 ? null : 37.4, day: h >= 102 ? 0 : 1, SW: h >= 102 ? 0 : 412.4 }));
    const r = parseAhead(body);
    expect(r.map((x) => x.h)).toEqual([100, 101, 102, 103]);
    expect(r[1].wx.P).toBe(2.3);
    expect(r[0].wx.SW).toBe(412);
    expect(r.map((x) => x.cloudPct)).toEqual([37, 37, 100, null]);
    expect(r.map((x) => x.wx.isDay)).toEqual([1, 1, 0, 0]);
  });

  it("keeps rows without cloud cover, and leaves out an hour the model could not use (a gap is never invented)", () => {
    const body = payload(10, 13);
    delete (body.hourly as Record<string, unknown>).cloud_cover;
    (body.hourly.precipitation as unknown[])[1] = null;
    const r = parseAhead(body);
    expect(r.map((x) => [x.h, x.cloudPct])).toEqual([[10, null], [12, null]]);
  });

  it("throws on an Open-Meteo error body", () => {
    expect(() => parseAhead({ error: true, reason: "Parameter is wrong" })).toThrow(/Parameter is wrong/);
  });
});

describe("fetchAheadRows", () => {
  it("parses a good answer and names the status and reason on failure, never the URL (it may carry the key)", async () => {
    const urls: string[] = [];
    const ok = async (url: string) => { urls.push(url); return { ok: true, status: 200, json: async () => payload(5, 8) }; };
    expect((await fetchAheadRows(ok)).map((r) => r.h)).toEqual([5, 6, 7]);
    expect(urls).toEqual([buildAheadUrl()]);
    const refused = async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: "Too many requests" }) });
    const err = await fetchAheadRows(refused).catch((e: Error) => e);
    expect((err as Error).message).toBe("Open-Meteo forecast: HTTP 429: Too many requests");
    expect((err as Error).message).not.toMatch(/https?:/);
  });
});

describe("forecast source", () => {
  it("serves the next 24 hours from the hour in progress, with the model's rainSoon over the next 12", async () => {
    const rain = (h: number) => (h === 107 ? 6 : h === 109 ? 5.5 : h === 115 ? 30 : 0);
    const f = fake({ nowH: 100, serve: () => rows(80, 160, rain) });
    const a = await createForecastSource(f.deps).ahead(100);
    expect(a).not.toBeNull();
    expect(a!.fromH).toBe(100);
    expect(a!.hours.map((x) => x.h)).toEqual(Array.from({ length: AHEAD_H }, (_, i) => 100 + i));
    expect(a!.hours[0]).toEqual({ h: 100, temperatureC: 20, rainMm: 0, cloudPct: 50, sunWm2: 400, isDay: true });
    expect(a!.rainSoon).toEqual({ heavy: true, mm: 11.5, startsInH: 7 });
    expect(a!.rainSoon).toEqual(rainSoon(rows(80, 160, rain), 100, BED.soonH));
    expect(BED.soonH).toBe(12); // the hint looks 12 hours ahead; the 30 mm at h 115 is beyond it
  });

  it("serves fewer hours when the forecast ends early, and none when it holds nothing ahead", async () => {
    const short = fake({ nowH: 100, serve: () => rows(90, 110) });
    expect((await createForecastSource(short.deps).ahead(100))!.hours.map((x) => x.h)).toEqual(Array.from({ length: 10 }, (_, i) => 100 + i));
    const past = fake({ nowH: 100, serve: () => rows(60, 100) });
    expect(await createForecastSource(past.deps).ahead(100)).toBeNull();
  });

  it("asks Open-Meteo once for concurrent callers, and again only after half an hour", async () => {
    const f = fake({ nowH: 100 });
    const src = createForecastSource(f.deps);
    const all = await Promise.all([src.ahead(100), src.ahead(100), src.ahead(100)]);
    expect(f.calls()).toBe(1);
    expect(all.every((a) => a !== null && a.hours.length === AHEAD_H)).toBe(true);
    f.advance(FRESH_MS - 60_000);
    await src.ahead(100);
    expect(f.calls()).toBe(1);
    f.advance(60_000);
    await src.ahead(100);
    expect(f.calls()).toBe(2);
  });

  it("moves the window with the hour without asking again", async () => {
    const f = fake({ nowH: 100 });
    const src = createForecastSource(f.deps);
    await src.ahead(100);
    const next = await src.ahead(101);
    expect(f.calls()).toBe(1);
    expect(next!.fromH).toBe(101);
    expect(next!.hours[0].h).toBe(101);
    expect(next!.hours.at(-1)!.h).toBe(124);
  });

  it("without any forecast it serves null, logs, and waits a minute before asking again", async () => {
    const f = fake({ nowH: 100, fail: () => true });
    const src = createForecastSource(f.deps);
    expect(await src.ahead(100)).toBeNull();
    expect(f.logs.some((m) => m.includes("forecast fetch failed") && m.includes("HTTP 503"))).toBe(true);
    expect(f.logs.join(" ")).not.toMatch(/https?:/);
    expect(await src.ahead(100)).toBeNull();
    expect(f.calls()).toBe(1);
    f.advance(RETRY_MS);
    await src.ahead(100);
    expect(f.calls()).toBe(2);
  });

  it("counts an answer with no usable hours as a failure", async () => {
    const f = fake({ nowH: 100, serve: () => [] });
    const src = createForecastSource(f.deps);
    expect(await src.ahead(100)).toBeNull();
    expect(f.logs.some((m) => m.includes("no complete hours"))).toBe(true);
  });

  it("keeps serving the last forecast while Open-Meteo is down, for up to six hours", async () => {
    let down = false;
    const f = fake({ nowH: 100, fail: () => down });
    const src = createForecastSource(f.deps);
    await src.ahead(100);
    down = true;
    f.advance(FRESH_MS + 1);
    const stale = await src.ahead(100);
    expect(stale!.hours).toHaveLength(AHEAD_H);
    expect(f.calls()).toBe(2);
    f.advance(STALE_MS - FRESH_MS - 2);
    expect((await src.ahead(105))!.hours[0].h).toBe(105);
    f.advance(2);
    expect(await src.ahead(106)).toBeNull();
    down = false;
    f.advance(RETRY_MS);
    expect(await src.ahead(106)).not.toBeNull();
  });

  it("never throws, even when the fetch throws outright or the clock breaks", async () => {
    const throwing = createForecastSource({ now: () => new Date(), fetchRows: () => { throw new Error("boom"); } });
    await expect(throwing.ahead(100)).resolves.toBeNull();
    const logs: string[] = [];
    const broken = createForecastSource({ now: () => { throw new Error("no clock"); }, fetchRows: async () => rows(90, 130), log: (m) => logs.push(m) });
    await expect(broken.ahead(100)).resolves.toBeNull();
    expect(logs[0]).toMatch(/forecast unavailable: no clock/);
  });
});
