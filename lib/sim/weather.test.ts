// The Open-Meteo normaliser: request URLs, the end-of-hour alignment (game row h takes the row stamped h + 1), gaps,
// the prototype's fallbacks, and a real archive slice that must reproduce the prototype's own 2025 weather rows. No
// test touches the network: fetching goes through an injected fetch.
import { describe, expect, it } from "vitest";
import { GAME_START_MS, IST_OFFSET_MIN } from "./calendar";
import { BLR, buildArchiveUrl, buildForecastUrl, fetchArchive, fetchForecast, parseHourly, weatherLookup, type FetchLike } from "./weather";
import { readFixture, unpack, type PackedWeather } from "./__fixtures__/harness";

const IST = 19800;
// a small synthetic payload: six IST-stamped rows around the start of the game, one value per row so alignment shows
function payload(over: Record<string, unknown[]> = {}) {
  return {
    latitude: 12.97, longitude: 77.56, utc_offset_seconds: IST, timezone: "Asia/Kolkata",
    hourly: {
      time: ["2026-11-09T23:00", "2026-11-10T00:00", "2026-11-10T01:00", "2026-11-10T02:00", "2026-11-10T03:00", "2026-11-10T04:00"],
      temperature_2m: [20.0, 20.1, 20.2, 20.349, 20.4, 20.5],
      relative_humidity_2m: [80, 81, 82, 83, 84, 85],
      precipitation: [0, 0.1, 0.2, null, 0.4, 0.5],
      shortwave_radiation: [0, 0, 0, 0, 0, 12.4],
      et0_fao_evapotranspiration: [0.01, 0.02, 0.03, 0.04, 0.05, 0.12345],
      wind_speed_10m: [5.1, 5.2, null, 5.4, 5.5, 5.6],
      soil_temperature_0_to_7cm: [22.1, 22.2, 22.3, 22.4, null, 22.6],
      is_day: [0, 0, 0, 0, 0, null],
      ...over,
    },
  };
}

describe("request URLs", () => {
  it("ask Open-Meteo for Bangalore in IST, with every variable the model uses", () => {
    const f = new URL(buildForecastUrl({ pastDays: 5, forecastDays: 3 }));
    expect(f.origin + f.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(f.searchParams.get("latitude")).toBe(String(BLR.latitude));
    expect(f.searchParams.get("longitude")).toBe(String(BLR.longitude));
    expect(f.searchParams.get("timezone")).toBe("Asia/Kolkata");
    expect(f.searchParams.get("past_days")).toBe("5");
    expect(f.searchParams.get("forecast_days")).toBe("3");
    expect(f.searchParams.get("hourly")?.split(",")).toEqual([
      "temperature_2m", "relative_humidity_2m", "precipitation", "shortwave_radiation", "et0_fao_evapotranspiration",
      "wind_speed_10m", "soil_temperature_0_to_7cm", "is_day",
    ]);
    const a = new URL(buildArchiveUrl("2025-11-03", "2025-12-20"));
    expect(a.origin + a.pathname).toBe("https://archive-api.open-meteo.com/v1/archive");
    expect(a.searchParams.get("start_date")).toBe("2025-11-03");
    expect(a.searchParams.get("end_date")).toBe("2025-12-20");
    expect(a.searchParams.get("models")).toBe("best_match");
  });
});

describe("parseHourly", () => {
  const rows = parseHourly(payload());
  const at = weatherLookup(rows);

  it("gives game row h the Open-Meteo row stamped at the end of the hour", () => {
    expect(at(0)?.T).toBe(20.2);     // 10 Nov 00:00-01:00 IST <- the row stamped 01:00
    expect(at(-1)?.T).toBe(20.1);    // the row stamped 00:00 covers 9 Nov 23:00-24:00
    expect(at(-2)?.T).toBe(20.0);
    expect(at(2)?.T).toBe(20.4);
    expect(at(0)?.P).toBe(0.2);
  });

  it("leaves a gap where a water-balance input is missing instead of inventing it", () => {
    expect(at(1)).toBeUndefined();   // precipitation null at the 02:00 stamp
    expect(rows.map((r) => r.h)).toEqual([-2, -1, 0, 2, 3]);
  });

  it("falls back like the prototype for wind, soil temperature and daylight, and rounds to the calibration precision", () => {
    expect(at(0)?.U).toBe(5);                                   // wind missing -> 5 km/h
    expect(at(2)?.Ts).toBe(20.4);                               // soil temperature missing -> air temperature
    expect(at(3)?.isDay).toBe(1);                               // is_day missing -> sun up (SW 12 W/m2)
    expect(at(3)?.SW).toBe(12);
    expect(at(3)?.ET0).toBe(0.123);
    expect(weatherLookup(parseHourly(payload({ temperature_2m: [20, 20, 20, 20, 21.349, 20] })))(2)?.T).toBe(21.3);
  });

  it("accepts unix-time stamps and other soil layers", () => {
    const t0 = GAME_START_MS / 1000;
    const p = payload({ time: [-1, 0, 1, 2, 3, 4].map((k) => t0 + 3600 * k), soil_temperature_0_to_7cm: [], soil_temperature_6cm: [1, 2, 3, 4, 5, 6] });
    const r = parseHourly(p);
    expect(r.map((x) => x.h)).toEqual([-2, -1, 0, 2, 3]);
    expect(r[2].wx.Ts).toBe(3);
  });

  it("throws on an Open-Meteo error body or a payload without hourly data", () => {
    expect(() => parseHourly({ error: true, reason: "Parameter 'hourly' is invalid" })).toThrow(/hourly' is invalid/);
    expect(() => parseHourly({ latitude: 1 })).toThrow(/hourly.time/);
    expect(() => parseHourly(null)).toThrow();
  });

  it("reproduces the prototype's 2025 game rows from a raw Open-Meteo archive slice", () => {
    const raw = readFixture<unknown>("openmeteo-archive-2025-slice.json");
    const start2025 = Date.UTC(2025, 10, 10) - IST_OFFSET_MIN * 60_000;
    const got = parseHourly(raw, { startMs: start2025 });
    const want = unpack(readFixture<PackedWeather>("demo-weather.json"));
    expect(got[0].h).toBe(-5);                                  // stamped 9 Nov 20:00
    const inGame = got.filter((r) => r.h >= 0);
    expect(inGame.map((r) => r.h)).toEqual(Array.from({ length: 26 }, (_, h) => h));
    for (const r of inGame) expect(r.wx, `h ${r.h}`).toEqual(want[r.h]);
  });
});

describe("fetching", () => {
  it("uses the injected fetch and parses the reply", async () => {
    const urls: string[] = [];
    const fake: FetchLike = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => payload() }; };
    const rows = await fetchForecast({ fetch: fake, pastDays: 2 });
    expect(urls).toEqual([buildForecastUrl({ pastDays: 2 })]);
    expect(rows).toHaveLength(5);
    expect((await fetchArchive("2026-11-09", "2026-11-10", { fetch: fake })).map((r) => r.h)).toEqual([-2, -1, 0, 2, 3]);
    expect(urls[1]).toBe(buildArchiveUrl("2026-11-09", "2026-11-10"));
  });

  it("reports an HTTP error with Open-Meteo's reason", async () => {
    const fake: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: "Latitude must be in range" }) });
    await expect(fetchForecast({ fetch: fake })).rejects.toThrow(/HTTP 400: Latitude must be in range/);
  });
});
