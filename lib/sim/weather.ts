// Open-Meteo client and normaliser: real Bangalore weather, hour by hour, in the shape step() eats.
// Weather data by Open-Meteo.com (CC BY 4.0), https://open-meteo.com: credit it wherever the weather shows.
//
// Alignment, exactly as the prototype: game row h covers [h, h + 1) and takes the Open-Meteo row stamped at the END of
// that hour, because Open-Meteo stamps precipitation, radiation and ET0 with the hour they were summed over (the hour
// before the stamp). So row h = 0 (10 Nov 00:00-01:00 IST) is the row stamped "2026-11-10T01:00". Values are rounded to the
// precision of the files the model was calibrated on (T, P, wind and soil temperature to 0.1, SW to 1 W/m2, ET0 to
// 0.001 mm), a no-op for what Open-Meteo sends today.
//
// Missing data is never invented for the water balance: an hour without temperature, humidity, precipitation, radiation
// or ET0 is left out, and replay stops there until it is backfilled. Only the three inputs the prototype itself defaulted
// get a fallback: wind 5 km/h, soil temperature = air temperature (the forecast's last hours carry no soil temperature),
// and isDay from the sun (SW > 0).
//
// Soil temperature is the 0-7 cm layer, the layer the model was calibrated on (ERA5-Land in the archive); the forecast API
// serves the same variable. The 0 cm skin temperature runs several degrees hotter at noon and would quicken the rot clock,
// so it is only a fallback. Fetching is injectable, so tests never touch the network.
import { GAME_START_MS, HOUR_MS } from "./calendar";
import type { HourWeather } from "./model";

export const WEATHER_CREDIT = "Weather data by Open-Meteo.com (CC BY 4.0)";

/**
 * The Disney India office at RMZ Ecoworld, Bellandur (Outer Ring Road), so the garden shares the weather colleagues see
 * from their desks. Open-Meteo snaps this to its nearest grid cell (12.90 N, 77.66 E). The climate table and the model's
 * calibration used the city-centre cell 9 km away; the two differ by about a millimetre of rain a day.
 */
export const BLR = Object.freeze({ latitude: 12.9254, longitude: 77.6848, timezone: "Asia/Kolkata" });

export const HOURLY_VARIABLES = Object.freeze([
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "shortwave_radiation",
  "et0_fao_evapotranspiration",
  "wind_speed_10m",
  "soil_temperature_0_to_7cm",
  "is_day",
] as const);

// Preferred soil temperature first; the others are accepted if a payload carries them instead.
const SOIL_T_KEYS = ["soil_temperature_0_to_7cm", "soil_temperature_6cm", "soil_temperature_0cm"] as const;

export const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";

function query(params: Record<string, string | number>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}
function base(): Record<string, string | number> {
  // the variable list keeps its commas unescaped, as Open-Meteo documents it
  return { latitude: BLR.latitude, longitude: BLR.longitude, timezone: BLR.timezone };
}

export interface ForecastOptions {
  /** days of recent past included (0..92); the server backfills completed hours from these */
  pastDays?: number;
  /** days ahead (1..16) */
  forecastDays?: number;
}

/** The forecast request: recent past (past_days) plus the days ahead, hourly, in IST. */
export function buildForecastUrl({ pastDays = 7, forecastDays = 16 }: ForecastOptions = {}): string {
  return `${FORECAST_ENDPOINT}?${query({ ...base(), past_days: pastDays, forecast_days: forecastDays })}&hourly=${HOURLY_VARIABLES.join(",")}`;
}

/** The archive request for whole IST days, dates as YYYY-MM-DD (the archive lags real time by a few days). */
export function buildArchiveUrl(startDate: string, endDate: string): string {
  return `${ARCHIVE_ENDPOINT}?${query({ ...base(), start_date: startDate, end_date: endDate })}&hourly=${HOURLY_VARIABLES.join(",")}&models=best_match`;
}

/** One game hour of weather. */
export interface GameHourWeather {
  h: number;
  wx: HourWeather;
}

export interface ParseOptions {
  /** epoch ms counted as h = 0; defaults to GAME_START_MS. Pass another year's 10 Nov 00:00 IST to replay its weather. */
  startMs?: number;
}

type Column = readonly unknown[] | undefined;
function num(col: Column, i: number): number | null {
  const v = col ? col[i] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
// The prototype's compact() rounding, so live rows have the calibration files' precision.
function r2(x: number, d: number): number { return Math.round(x * Math.pow(10, d)) / Math.pow(10, d); }
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
function stampMs(t: unknown, offsetSec: number): number | null {
  if (typeof t === "number" && Number.isFinite(t)) return t * 1000;              // timeformat=unixtime
  if (typeof t !== "string") return null;
  const m = LOCAL_TIME.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) - offsetSec * 1000;
  const ms = Date.parse(t);                                                      // an explicit offset or Z
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalises an Open-Meteo hourly payload (forecast or archive) into game-hour rows, sorted by h, one per hour. Rows are
 * kept for every complete hour the payload covers, including hours before h = 0 (callers filter). Throws on an
 * Open-Meteo error body or a payload without hourly.time.
 */
export function parseHourly(json: unknown, { startMs = GAME_START_MS }: ParseOptions = {}): GameHourWeather[] {
  if (!json || typeof json !== "object") throw new Error("Open-Meteo: not a JSON object");
  const body = json as { error?: unknown; reason?: unknown; utc_offset_seconds?: unknown; hourly?: unknown };
  if (body.error) throw new Error(`Open-Meteo: ${typeof body.reason === "string" ? body.reason : "error"}`);
  const hourly = body.hourly as Record<string, Column> | undefined;
  const time = hourly?.time;
  if (!hourly || !Array.isArray(time)) throw new Error("Open-Meteo: payload has no hourly.time");
  const offsetSec = typeof body.utc_offset_seconds === "number" ? body.utc_offset_seconds : 0;
  const byH = new Map<number, HourWeather>();
  for (let i = 0; i < time.length; i++) {
    const ms = stampMs(time[i], offsetSec);
    if (ms === null) continue;
    const end = (ms - startMs) / HOUR_MS;
    if (!Number.isInteger(end)) continue;                                        // not on the hour (sub-hourly data)
    const T = num(hourly.temperature_2m, i), RH = num(hourly.relative_humidity_2m, i), P = num(hourly.precipitation, i);
    const SW = num(hourly.shortwave_radiation, i), ET0 = num(hourly.et0_fao_evapotranspiration, i);
    if (T === null || RH === null || P === null || SW === null || ET0 === null) continue;   // a gap: never invented
    const U = num(hourly.wind_speed_10m, i);
    let Ts: number | null = null;
    for (const k of SOIL_T_KEYS) { Ts = num(hourly[k], i); if (Ts !== null) break; }
    const day = num(hourly.is_day, i);
    const Tr = r2(T, 1), SWr = r2(SW, 0);
    byH.set(end - 1, {
      T: Tr, RH, P: r2(P, 1), SW: SWr, ET0: r2(ET0, 3),
      U: U === null ? 5 : r2(U, 1),
      Ts: Ts === null ? Tr : r2(Ts, 1),
      isDay: day === null ? (SWr > 0 ? 1 : 0) : day ? 1 : 0,
    });
  }
  return [...byH.entries()].sort((a, b) => a[0] - b[0]).map(([h, wx]) => ({ h, wx }));
}

/** A lookup for catchUp(): the weather of game hour h, or undefined where the rows have a gap. */
export function weatherLookup(rows: readonly GameHourWeather[]): (h: number) => HourWeather | undefined {
  const m = new Map<number, HourWeather>();
  for (const r of rows) m.set(r.h, r.wx);
  return (h) => m.get(h);
}

/** The part of fetch() the client uses, so tests (and the server's caching wrapper) can inject their own. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function getJson(url: string, fetchImpl: FetchLike | undefined): Promise<unknown> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!f) throw new Error("Open-Meteo: no fetch available");
  const res = await f(url);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body && typeof body === "object" && "reason" in body ? String((body as { reason: unknown }).reason) : "";
    throw new Error(`Open-Meteo: HTTP ${res.status}${reason ? `: ${reason}` : ""}`);
  }
  return body;
}

/** Fetches the forecast (with past_days) and returns game-hour rows. */
export async function fetchForecast(opts: ForecastOptions & ParseOptions & { fetch?: FetchLike } = {}): Promise<GameHourWeather[]> {
  return parseHourly(await getJson(buildForecastUrl(opts), opts.fetch), opts);
}

/** Fetches archive days (YYYY-MM-DD, IST) and returns game-hour rows. */
export async function fetchArchive(startDate: string, endDate: string, opts: ParseOptions & { fetch?: FetchLike } = {}): Promise<GameHourWeather[]> {
  return parseHourly(await getJson(buildArchiveUrl(startDate, endDate), opts.fetch), opts);
}
