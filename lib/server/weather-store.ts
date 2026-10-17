// The shared weather store: real Bangalore weather at the Disney office, one row per completed game hour, fetched from
// Open-Meteo (the forecast API with past_days, via lib/sim/weather.ts) and written once. Every plant replays against
// the same rows, so one fetch serves all 300 plants.
//
// Rules:
// - Only completed hours are stored (row h covers [h, h + 1), so it is stored once now >= the start of h + 1). The
//   forecast also returns hours ahead; those are never written.
// - Weather is never invented: an hour Open-Meteo does not supply stays missing, and replay waits there.
// - Insert-once: ON CONFLICT DO NOTHING, and a trigger refuses updates. Because of that, no lock is needed: two
//   instances that fetch at the same moment write the same rows, and the second insert does nothing. The HTTP fetch runs
//   outside any transaction, so no database connection is held while Open-Meteo answers.
// - One fetch at a time per instance: concurrent callers share the in-flight attempt, so a burst of visits at the top
//   of the hour costs one request. After an attempt that left gaps (Open-Meteo down), the instance waits a minute.
// - A gap the forecast leaves (Open-Meteo's forecast API down or rate-limited, or an hour returned without data) is
//   asked of the historical-forecast API next, at most every ten minutes: a separate Open-Meteo service archiving the
//   same weather models, current to the hour. A gap still open once the hour is a day old is asked of the archive (real
//   reanalysis data, published a few days later; it serves nothing newer than yesterday), at most every half hour. An
//   operator can also run scripts/backfill-weather.mjs. While any stored hour is missing more than two hours back,
//   every plant is paused there, so the store logs a warning (at most every ten minutes) for the Vercel log alerts.
// - OPEN_METEO_API_KEY, when set, sends every request to Open-Meteo's customer servers with the key (no shared-IP rate
//   limit, and the commercial licence). The key rides in the URL, which is never logged.
// - Outside production (env.ts) nothing is written: fetched rows are kept in this instance's memory and served
//   together with the stored ones, so the dev server and Preview cannot write rows normalised by a different build.
//
// The storage and the fetch are injected (createWeatherStore), so the tests run on fakes without a network or database.
import "server-only";
import {
  fetchArchive,
  fetchForecast,
  hourIndexOf,
  type FetchLike,
  type GameHourWeather,
  type HourWeather,
  type WeatherAt,
} from "@/lib/sim";
import { db, transaction } from "./db";
import { writesDerivedState } from "./env";
import { fetchHistoricalForecast, openMeteoFetch } from "./open-meteo";
import { hourIso, istDayOfHour } from "./rules";

export const WEATHER_SOURCE = "open-meteo-forecast";
export const ARCHIVE_SOURCE = "open-meteo-archive";
export const HISTORICAL_SOURCE = "open-meteo-historical-forecast";
const HISTORICAL_RETRY_MS = 10 * 60_000;
const HISTORICAL_MAX_DAYS = 31;
const MAX_PAST_DAYS = 92;
/** Days ahead in each forecast request; two so the window always reaches the current IST hour (see fetchRows). */
export const FORECAST_DAYS = 2;
const RETRY_AFTER_GAPS_MS = 60_000;
/** Hours a gap must age before the archive is asked: the archive refuses dates after yesterday, and lags days anyway. */
export const ARCHIVE_AFTER_H = 24;
const ARCHIVE_RETRY_MS = 30 * 60_000;
const ARCHIVE_MAX_DAYS = 31;
/** A missing hour older than this many hours means every plant is paused: worth a warning. */
export const BEHIND_WARN_H = 2;
const WARN_EVERY_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;

export interface WeatherDeps {
  now(): Date;
  /** the hours already stored within [fromH, toH) */
  existingHours(fromH: number, toH: number): Promise<number[]>;
  insertRows(rows: readonly GameHourWeather[], source: string): Promise<void>;
  /** Open-Meteo forecast rows covering at least the last pastDays days */
  fetchRows(pastDays: number): Promise<GameHourWeather[]>;
  /** Open-Meteo historical-forecast rows covering at least the hours [fromH, toH) */
  fetchHistoricalRows?(fromH: number, toH: number): Promise<GameHourWeather[]>;
  /** Open-Meteo archive rows covering at least the hours [fromH, toH) */
  fetchArchiveRows?(fromH: number, toH: number): Promise<GameHourWeather[]>;
  log?(message: string): void;
}

export interface WeatherStore {
  /** Fills [fromH, toH) as far as real data allows (completed hours only); resolves to the hours still missing. Never throws. */
  ensure(fromH: number, toH: number): Promise<number[]>;
}

export function createWeatherStore(deps: WeatherDeps): WeatherStore {
  let inflight: Promise<void> | null = null;
  let retryAtMs = -Infinity;
  let archiveRetryAtMs = -Infinity;
  let historicalRetryAtMs = -Infinity;
  let warnAtMs = -Infinity;

  async function missing(fromH: number, toH: number): Promise<number[]> {
    if (fromH >= toH) return [];
    const have = new Set(await deps.existingHours(fromH, toH));
    const out: number[] = [];
    for (let h = fromH; h < toH; h++) if (!have.has(h)) out.push(h);
    return out;
  }

  function warnIfBehind(gaps: readonly number[], nowH: number) {
    const nowMs = deps.now().getTime();
    if (gaps.length === 0 || gaps[0] >= nowH - BEHIND_WARN_H || nowMs < warnAtMs) return;
    warnAtMs = nowMs + WARN_EVERY_MS;
    deps.log?.(`weather is behind: no data for hour ${gaps[0]} (${hourIso(gaps[0])}), ${nowH - gaps[0]} hours ago; `
      + `every plant waits there. ${gaps.length} hour(s) missing in the range asked. Try scripts/backfill-weather.mjs.`);
  }

  async function attempt(fromH: number, toH: number, nowH: number): Promise<void> {
    let still = await missing(fromH, toH);
    if (still.length === 0) return;
    try {
      const pastDays = Math.min(MAX_PAST_DAYS, Math.max(1, Math.ceil((nowH - still[0]) / 24) + 1));
      const want = new Set(still);
      const rows = (await deps.fetchRows(pastDays)).filter((r) => want.has(r.h) && r.h < nowH);
      if (rows.length > 0) await deps.insertRows(rows, WEATHER_SOURCE);
    } catch (err) {
      deps.log?.(`weather fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    still = await missing(fromH, toH);
    if (still.length > 0 && deps.fetchHistoricalRows && deps.now().getTime() >= historicalRetryAtMs) {
      historicalRetryAtMs = deps.now().getTime() + HISTORICAL_RETRY_MS;
      try {
        const last = still[still.length - 1];
        const want = new Set(still);
        const rows = (await deps.fetchHistoricalRows(Math.max(still[0], last - HISTORICAL_MAX_DAYS * 24), last + 1))
          .filter((r) => want.has(r.h) && r.h < nowH);
        if (rows.length > 0) await deps.insertRows(rows, HISTORICAL_SOURCE);
      } catch (err) {
        deps.log?.(`weather historical-forecast fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      still = await missing(fromH, toH);
    }
    const old = still.filter((h) => h < nowH - ARCHIVE_AFTER_H);
    const nowMs = deps.now().getTime();
    if (old.length > 0 && deps.fetchArchiveRows && nowMs >= archiveRetryAtMs) {
      archiveRetryAtMs = nowMs + ARCHIVE_RETRY_MS;
      try {
        const from = Math.max(old[0], old[old.length - 1] - ARCHIVE_MAX_DAYS * 24);
        const want = new Set(old);
        const rows = (await deps.fetchArchiveRows(from, old[old.length - 1] + 1)).filter((r) => want.has(r.h) && r.h < nowH);
        if (rows.length > 0) await deps.insertRows(rows, ARCHIVE_SOURCE);
      } catch (err) {
        deps.log?.(`weather archive fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    async ensure(fromH, toH) {
      try {
        const nowH = hourIndexOf(deps.now());
        const to = Math.min(toH, nowH);
        let gaps = await missing(fromH, to);
        if (gaps.length === 0) return gaps;
        if (inflight) {
          await inflight;
          gaps = await missing(fromH, to);
          if (gaps.length === 0) return gaps;
        }
        if (deps.now().getTime() < retryAtMs) {
          warnIfBehind(gaps, nowH);
          return gaps;
        }
        const run = (async () => {
          await attempt(fromH, to, nowH);
          // set before anyone waiting on this attempt resumes, so they do not fetch straight again
          if ((await missing(fromH, to)).length > 0) retryAtMs = deps.now().getTime() + RETRY_AFTER_GAPS_MS;
        })();
        inflight = run;
        try {
          await run;
        } finally {
          if (inflight === run) inflight = null;
        }
        gaps = await missing(fromH, to);
        warnIfBehind(gaps, nowH);
        return gaps;
      } catch (err) {
        deps.log?.(`weather store unavailable: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
  };
}

// ---- Postgres wiring ----------------------------------------------------------------------------------------------

interface WeatherRow {
  h: number;
  t_c: number;
  rh_pct: number;
  precip_mm: number;
  sw_wm2: number;
  et0_mm: number;
  wind_kmh: number;
  soil_t_c: number;
  is_day: number;
  fetched_at: Date;
}

function toHourWeather(r: WeatherRow): HourWeather {
  return { T: r.t_c, RH: r.rh_pct, P: r.precip_mm, SW: r.sw_wm2, ET0: r.et0_mm, U: r.wind_kmh, Ts: r.soil_t_c, isDay: r.is_day ? 1 : 0 };
}

// the API key (open-meteo.ts) and a timeout; never cached by Next's fetch
const timeoutFetch: FetchLike = openMeteoFetch(FETCH_TIMEOUT_MS, { cache: "no-store" });

/**
 * Historical-forecast rows for [fromH, toH): whole IST days, from the day hour fromH starts on to the day the end stamp
 * of hour toH - 1 falls on (row h is Open-Meteo's row stamped at the end of the hour). Callers keep completed hours only.
 */
export function fetchHistoricalHours(fromH: number, toH: number, fetchImpl: FetchLike = timeoutFetch): Promise<GameHourWeather[]> {
  return fetchHistoricalForecast(istDayOfHour(fromH), istDayOfHour(toH), fetchImpl);
}

/**
 * Archive rows for [fromH, toH): whole IST days, from the day hour fromH starts on to the day the end stamp of hour
 * toH - 1 falls on (row h is Open-Meteo's row stamped at the end of the hour), but never past yesterday, which the
 * archive refuses with HTTP 400.
 */
export async function fetchArchiveHours(fromH: number, toH: number, now: Date = new Date(), fetchImpl: FetchLike = timeoutFetch): Promise<GameHourWeather[]> {
  const start = istDayOfHour(fromH);
  const lastAllowed = istDayOfHour(hourIndexOf(now) - 24);
  const end = istDayOfHour(toH) < lastAllowed ? istDayOfHour(toH) : lastAllowed;
  if (end < start) return [];
  return fetchArchive(start, end, { fetch: fetchImpl });
}

/** Rows fetched outside production: served from memory, never written (see the header). */
const memoryRows = new Map<number, { wx: HourWeather; fetchedAt: Date }>();

async function storedHours(fromH: number, toH: number): Promise<number[]> {
  const rows = await db()<{ h: number }[]>`select h from meadow.weather_hours where h >= ${fromH} and h < ${toH}`;
  return rows.map((r) => r.h);
}

const pgDeps: WeatherDeps = {
  now: () => new Date(),
  async existingHours(fromH, toH) {
    const stored = await storedHours(fromH, toH);
    if (writesDerivedState()) return stored;
    const all = new Set(stored);
    for (const h of memoryRows.keys()) if (h >= fromH && h < toH) all.add(h);
    return [...all];
  },
  async insertRows(rows, source) {
    if (!writesDerivedState()) {
      const at = new Date();
      for (const r of rows) if (!memoryRows.has(r.h)) memoryRows.set(r.h, { wx: r.wx, fetchedAt: at });
      return;
    }
    const values = rows.map((r) => ({
      h: r.h, t_c: r.wx.T, rh_pct: r.wx.RH, precip_mm: r.wx.P, sw_wm2: r.wx.SW, et0_mm: r.wx.ET0,
      wind_kmh: r.wx.U, soil_t_c: r.wx.Ts, is_day: r.wx.isDay, source,
    }));
    // through transaction() for its bounded lock wait: ON CONFLICT waits on a row another instance is inserting
    await transaction((tx) => tx`insert into meadow.weather_hours ${tx(values)} on conflict (h) do nothing`);
  },
  // forecast_days=2, not 1: Open-Meteo's "today" rolls over at UTC midnight, so between 00:00 and 05:30 IST a one-day
  // window ends at 23:00 the day before and the hours just completed are not in it (every plant would wait till dawn)
  fetchRows: (pastDays) => fetchForecast({ pastDays, forecastDays: FORECAST_DAYS, fetch: timeoutFetch }),
  fetchHistoricalRows: (fromH, toH) => fetchHistoricalHours(fromH, toH),
  fetchArchiveRows: (fromH, toH) => fetchArchiveHours(fromH, toH),
  log: (message) => console.warn(`[meadow weather] ${message}`),
};

let store: WeatherStore | null = null;

/** Makes the store cover [fromH, toH) with every completed hour Open-Meteo supplies; resolves to the hours still missing. */
export function ensureWeather(fromH: number, toH: number): Promise<number[]> {
  store ??= createWeatherStore(pgDeps);
  return store.ensure(fromH, toH);
}

/** The weather of [fromH, toH) as a lookup for catchUp(); hours not stored return undefined. */
export async function loadWeather(fromH: number, toH: number): Promise<WeatherAt> {
  const map = new Map<number, HourWeather>();
  if (fromH < toH) {
    const rows = await db()<WeatherRow[]>`
      select h, t_c, rh_pct, precip_mm, sw_wm2, et0_mm, wind_kmh, soil_t_c, is_day, fetched_at
      from meadow.weather_hours where h >= ${fromH} and h < ${toH}`;
    for (const r of rows) map.set(r.h, toHourWeather(r));
    // stored rows win: memory only fills hours this non-production instance could not write
    for (const [h, m] of memoryRows) if (h >= fromH && h < toH && !map.has(h)) map.set(h, m.wx);
  }
  return (h) => map.get(h);
}

/** The most recent completed hour of weather (filling the last few hours first), or null if none is available. */
export async function latestWeather(now: Date): Promise<{ h: number; wx: HourWeather; fetchedAt: Date } | null> {
  const nowH = hourIndexOf(now);
  await ensureWeather(nowH - 6, nowH);
  const rows = await db()<WeatherRow[]>`
    select h, t_c, rh_pct, precip_mm, sw_wm2, et0_mm, wind_kmh, soil_t_c, is_day, fetched_at
    from meadow.weather_hours where h < ${nowH} order by h desc limit 1`;
  let best = rows[0] ? { h: rows[0].h, wx: toHourWeather(rows[0]), fetchedAt: rows[0].fetched_at } : null;
  for (const [h, m] of memoryRows) if (h < nowH && (!best || h > best.h)) best = { h, wx: m.wx, fetchedAt: m.fetchedAt };
  return best;
}
