// The weather ahead at the Disney office: the next 24 hours of Open-Meteo's forecast for GET /api/weather/now, so the UI
// can show the hours to come and say "heavy rain tonight; skip the can" (the model's rainSoon) before the rain falls.
//
// Rules:
// - Forecast hours never go into meadow.weather_hours, which holds observed hours only (weather-store.ts). They live in
//   this instance's memory, and the route's CDN cache shares them with everyone.
// - Rows are lib/sim's normalised hours (parseHourly: row h covers [h, h + 1) and takes the row stamped at its end), with
//   Open-Meteo's cloud cover at the same stamp alongside, so the UI can tell a clear night from a cloudy one.
// - One request at a time per instance, reused for FRESH_MS (Open-Meteo refreshes its forecast about hourly). After a
//   failure the instance waits RETRY_MS before asking again and keeps serving the last forecast while it is younger than
//   STALE_MS (AHEAD_DAYS still reaches a day past that). Older than that there is no forecast rather than an old one.
// - Never throws: without a forecast the route still answers with the observed hour.
// - OPEN_METEO_API_KEY, when set, sends the request to Open-Meteo's customer server (open-meteo.ts); URLs are never logged.
//
// The fetch and the clock are injected (createForecastSource), so the tests run on fakes without a network.
import "server-only";
import {
  BED,
  GAME_START_MS,
  HOURLY_VARIABLES,
  HOUR_MS,
  buildForecastUrl,
  parseHourly,
  rainSoon,
  type FetchLike,
  type GameHourWeather,
  type RainSoon,
} from "@/lib/sim";
import { openMeteoFetch } from "./open-meteo";

/** Hours of forecast served, from the hour in progress. */
export const AHEAD_H = 24;
/**
 * Days in each request. Three, not two: before 05:30 IST Open-Meteo's "today" is still the day before (weather-store.ts),
 * and a two-day window would then end less than a day ahead; three still reach a day ahead of a copy STALE_MS old.
 */
export const AHEAD_DAYS = 3;
export const FRESH_MS = 30 * 60_000;
export const RETRY_MS = 60_000;
export const STALE_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 6_000;

/** A forecast hour as parsed: the model's weather row plus cloud cover. */
export interface AheadRow extends GameHourWeather {
  cloudPct: number | null;
}

/** One hour ahead, as GET /api/weather/now serves it. */
export interface ForecastHour {
  /** game hour; the row covers [h, h + 1) */
  h: number;
  temperatureC: number;
  rainMm: number;
  /** total cloud cover, 0-100 %, or null when Open-Meteo sent none for the hour */
  cloudPct: number | null;
  sunWm2: number;
  isDay: boolean;
}

export interface WeatherAhead {
  /** the hour in progress, where `hours` starts and rainSoon counts from */
  fromH: number;
  hours: ForecastHour[];
  /** the model's heavy-rain hint over the next BED.soonH (12) hours */
  rainSoon: RainSoon;
}

/**
 * The forecast request: today and the next two days (no past days), the model's hourly variables plus cloud_cover, with
 * Unix timestamps so cloud cover lines up with parseHourly's rows without parsing local times again.
 */
export function buildAheadUrl(): string {
  const url = buildForecastUrl({ pastDays: 0, forecastDays: AHEAD_DAYS });
  if (!url.endsWith(`&hourly=${HOURLY_VARIABLES.join(",")}`)) throw new Error("unexpected forecast URL shape");
  return `${url},cloud_cover&timeformat=unixtime`;
}

/** Normalised forecast rows (parseHourly) with each row's cloud cover, from the stamp at the end of its hour. */
export function parseAhead(body: unknown): AheadRow[] {
  const rows = parseHourly(body);
  const hourly = (body as { hourly?: { time?: unknown; cloud_cover?: unknown } }).hourly;
  const time = hourly?.time, cover = hourly?.cloud_cover;
  const cloud = new Map<number, number>();
  if (Array.isArray(time) && Array.isArray(cover)) {
    for (let i = 0; i < time.length; i++) {
      const t: unknown = time[i], c: unknown = cover[i];
      if (typeof t !== "number" || typeof c !== "number" || !Number.isFinite(c)) continue;
      const end = (t * 1000 - GAME_START_MS) / HOUR_MS;
      if (Number.isInteger(end)) cloud.set(end - 1, Math.round(Math.min(100, Math.max(0, c))));
    }
  }
  return rows.map((r) => ({ ...r, cloudPct: cloud.get(r.h) ?? null }));
}

// the API key (open-meteo.ts) and a timeout; never cached by Next's fetch
const timeoutFetch: FetchLike = openMeteoFetch(FETCH_TIMEOUT_MS, { cache: "no-store" });

/** The forecast rows. Errors name the status and Open-Meteo's reason, never the URL (it may carry the key). */
export async function fetchAheadRows(fetchImpl: FetchLike = timeoutFetch): Promise<AheadRow[]> {
  const res = await fetchImpl(buildAheadUrl());
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body && typeof body === "object" && "reason" in body ? String((body as { reason: unknown }).reason) : "";
    throw new Error(`Open-Meteo forecast: HTTP ${res.status}${reason ? `: ${reason}` : ""}`);
  }
  return parseAhead(body);
}

function toForecastHour(r: AheadRow): ForecastHour {
  return { h: r.h, temperatureC: r.wx.T, rainMm: r.wx.P, cloudPct: r.cloudPct, sunWm2: r.wx.SW, isDay: r.wx.isDay === 1 };
}

export interface ForecastDeps {
  now(): Date;
  /** Open-Meteo forecast rows from at most the hour in progress to at least a day ahead */
  fetchRows(): Promise<AheadRow[]>;
  log?(message: string): void;
}

export interface ForecastSource {
  /** The next AHEAD_H hours from game hour nowH, or null when no forecast is to hand. Never throws. */
  ahead(nowH: number): Promise<WeatherAhead | null>;
}

export function createForecastSource(deps: ForecastDeps): ForecastSource {
  let held: { rows: AheadRow[]; atMs: number } | null = null;
  let inflight: Promise<void> | null = null;
  let retryAtMs = -Infinity;

  async function refresh(): Promise<void> {
    try {
      const rows = await deps.fetchRows();
      if (rows.length === 0) throw new Error("the forecast had no complete hours");
      held = { rows, atMs: deps.now().getTime() };
    } catch (err) {
      retryAtMs = deps.now().getTime() + RETRY_MS;
      deps.log?.(`forecast fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    async ahead(nowH) {
      try {
        const nowMs = deps.now().getTime();
        const fresh = held !== null && nowMs - held.atMs < FRESH_MS;
        if (!fresh && (inflight || nowMs >= retryAtMs)) {
          // concurrent callers share one request
          inflight ??= refresh().finally(() => {
            inflight = null;
          });
          await inflight;
        }
        const copy = held;
        if (!copy || deps.now().getTime() - copy.atMs > STALE_MS) return null;
        const hours = copy.rows.filter((r) => r.h >= nowH && r.h < nowH + AHEAD_H);
        if (hours.length === 0) return null;
        return { fromH: nowH, hours: hours.map(toForecastHour), rainSoon: rainSoon(hours, nowH, BED.soonH) };
      } catch (err) {
        deps.log?.(`forecast unavailable: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}

let source: ForecastSource | null = null;

/** The next 24 hours of forecast from game hour nowH, with the heavy-rain hint, or null when none is to hand. */
export function weatherAhead(nowH: number): Promise<WeatherAhead | null> {
  source ??= createForecastSource({
    now: () => new Date(),
    fetchRows: () => fetchAheadRows(),
    log: (message) => console.warn(`[meadow weather] ${message}`),
  });
  return source.ahead(nowH);
}
