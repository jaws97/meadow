// Open-Meteo plumbing the server's weather store and the operator scripts share, on top of lib/sim/weather.ts's
// public API (its URL builders, normaliser and FetchLike):
// - the historical-forecast service, a second real-data source for hours the forecast API did not supply: a separate
//   Open-Meteo service archiving the same weather models, current to the hour, asked with the archive's parameters;
// - OPEN_METEO_API_KEY: when set, every request goes to Open-Meteo's customer servers with the key (no shared-IP rate
//   limit on Vercel's egress addresses, and the commercial licence). The key rides in the URL, so URLs are never logged.
//
// Pure apart from reading process.env and calling fetch when asked; no "server-only", so scripts can import it.
import { ARCHIVE_ENDPOINT, buildArchiveUrl, parseHourly, type FetchLike, type GameHourWeather } from "@/lib/sim";

export const HISTORICAL_FORECAST_ENDPOINT = "https://historical-forecast-api.open-meteo.com/v1/forecast";

/**
 * An Open-Meteo URL sent to the customer server with the API key (customer-api.open-meteo.com and so on), or unchanged
 * without a key. String edits rather than URL.searchParams, which would re-encode the commas Open-Meteo's variable
 * lists keep. Only *.open-meteo.com URLs ever get the key.
 */
export function withOpenMeteoKey(url: string, key: string | undefined): string {
  if (!key) return url;
  const m = /^https:\/\/([a-z0-9-]+)\.open-meteo\.com\//.exec(url);
  if (!m) return url;
  const host = m[1].startsWith("customer-") ? m[1] : `customer-${m[1]}`;
  const keyed = `https://${host}.open-meteo.com/${url.slice(m[0].length)}`;
  return `${keyed}${keyed.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(key)}`;
}

/** A FetchLike for Open-Meteo: the API key applied (when OPEN_METEO_API_KEY is set) and a timeout. */
export function openMeteoFetch(timeoutMs: number, init: RequestInit = {}): FetchLike {
  return (url) => fetch(withOpenMeteoKey(url, process.env.OPEN_METEO_API_KEY), { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** The historical-forecast request for whole IST days (YYYY-MM-DD): the archive request's parameters, other service. */
export function buildHistoricalForecastUrl(startDate: string, endDate: string): string {
  const archive = buildArchiveUrl(startDate, endDate);
  if (!archive.startsWith(ARCHIVE_ENDPOINT)) throw new Error("unexpected archive URL shape");
  return HISTORICAL_FORECAST_ENDPOINT + archive.slice(ARCHIVE_ENDPOINT.length);
}

/** Historical-forecast rows for whole IST days. Errors name the status and Open-Meteo's reason, never the URL. */
export async function fetchHistoricalForecast(startDate: string, endDate: string, fetchImpl: FetchLike): Promise<GameHourWeather[]> {
  const res = await fetchImpl(buildHistoricalForecastUrl(startDate, endDate));
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body && typeof body === "object" && "reason" in body ? String((body as { reason: unknown }).reason) : "";
    throw new Error(`Open-Meteo historical forecast: HTTP ${res.status}${reason ? `: ${reason}` : ""}`);
  }
  return parseHourly(body);
}
