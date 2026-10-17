// Open-Meteo plumbing, offline: the historical-forecast request reuses the archive's parameters on the other service,
// and the API key goes only to Open-Meteo's customer servers without re-encoding the request.
import { describe, expect, it } from "vitest";
import { HISTORICAL_FORECAST_ENDPOINT, buildHistoricalForecastUrl, fetchHistoricalForecast, withOpenMeteoKey } from "./open-meteo";

describe("buildHistoricalForecastUrl", () => {
  it("asks the historical-forecast service for whole IST days, with the archive's variables", () => {
    const url = buildHistoricalForecastUrl("2026-11-16", "2026-11-17");
    expect(url.startsWith(`${HISTORICAL_FORECAST_ENDPOINT}?`)).toBe(true);
    expect(url).toMatch(/start_date=2026-11-16&end_date=2026-11-17/);
    expect(url).toMatch(/latitude=12\.9254/);
    expect(url).toMatch(/hourly=temperature_2m,/);
  });
});

describe("fetchHistoricalForecast", () => {
  it("names the status and Open-Meteo's reason on failure, never the URL (it may carry the key)", async () => {
    const refused = async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: "Invalid date" }) });
    const err = await fetchHistoricalForecast("2026-11-16", "2026-11-17", refused).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Open-Meteo historical forecast: HTTP 400: Invalid date");
    expect((err as Error).message).not.toMatch(/https?:/);
  });
});

describe("withOpenMeteoKey", () => {
  const forecast = "https://api.open-meteo.com/v1/forecast?latitude=12.9254&timezone=Asia%2FKolkata&hourly=temperature_2m,is_day";

  it("leaves every request alone without a key", () => {
    expect(withOpenMeteoKey(forecast, undefined)).toBe(forecast);
    expect(withOpenMeteoKey(forecast, "")).toBe(forecast);
  });

  it("sends each Open-Meteo service to its customer server with the key, keeping the query as it was", () => {
    expect(withOpenMeteoKey(forecast, "k3y/+=")).toBe(
      "https://customer-api.open-meteo.com/v1/forecast?latitude=12.9254&timezone=Asia%2FKolkata&hourly=temperature_2m,is_day&apikey=k3y%2F%2B%3D",
    );
    expect(withOpenMeteoKey("https://archive-api.open-meteo.com/v1/archive?a=1", "k"))
      .toBe("https://customer-archive-api.open-meteo.com/v1/archive?a=1&apikey=k");
    expect(withOpenMeteoKey(`${HISTORICAL_FORECAST_ENDPOINT}?a=1`, "k"))
      .toBe("https://customer-historical-forecast-api.open-meteo.com/v1/forecast?a=1&apikey=k");
    expect(withOpenMeteoKey("https://customer-api.open-meteo.com/v1/forecast?a=1", "k"))
      .toBe("https://customer-api.open-meteo.com/v1/forecast?a=1&apikey=k");
  });

  it("never sends the key anywhere but Open-Meteo", () => {
    expect(withOpenMeteoKey("https://example.com/v1/forecast?a=1", "k")).toBe("https://example.com/v1/forecast?a=1");
    expect(withOpenMeteoKey("https://api.open-meteo.com.evil.test/v1?a=1", "k")).toBe("https://api.open-meteo.com.evil.test/v1?a=1");
    expect(withOpenMeteoKey("http://api.open-meteo.com/v1/forecast?a=1", "k")).toBe("http://api.open-meteo.com/v1/forecast?a=1");
  });
});
