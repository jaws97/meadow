// Finds and fills gaps in the shared weather store. Every plant waits at the first missing hour (weather is never
// invented), so one gap pauses the whole Meadow until it is filled. The server retries by itself (the forecast's
// past_days, then Open-Meteo's historical-forecast service, then the archive once a gap is a day old, and it logs
// "weather is behind" while plants wait); this is the operator's manual lever, using the same fetchers and normaliser
// as the server (lib/sim, lib/server/open-meteo.ts, OPEN_METEO_API_KEY when set), and writing rows once (insert, never
// update) exactly as the server does. Only completed hours are written.
//
//   node --env-file=.env.local scripts/backfill-weather.mjs                 list gaps from the earliest planting to now
//   node --env-file=.env.local scripts/backfill-weather.mjs --from 17       start the scan at game hour 17 instead
//   node --env-file=.env.local scripts/backfill-weather.mjs --fill          fill them: forecast, historical forecast, archive
//
// The archive publishes reanalysis a few days late, so a gap from the last few days may have to wait for it.
import { connect } from "./db-connect.mjs";
import { ensureTypeScript, importProject, importSim } from "./lib/load-sim.mjs";

ensureTypeScript();

const FORECAST_SOURCE = "open-meteo-forecast";
const ARCHIVE_SOURCE = "open-meteo-archive";
const HISTORICAL_SOURCE = "open-meteo-historical-forecast";
const FETCH_TIMEOUT_MS = 20_000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Runs of consecutive hours, for a readable listing: [[from, to], ...] with to inclusive. */
function runs(hours) {
  const out = [];
  for (const h of hours) {
    const last = out[out.length - 1];
    if (last && last[1] === h - 1) last[1] = h;
    else out.push([h, h]);
  }
  return out;
}

async function missingHours(sql, fromH, toH) {
  const rows = await sql`
    select g.h::int as h from generate_series(${fromH}::int, ${toH - 1}::int) as g(h)
    where not exists (select 1 from meadow.weather_hours w where w.h = g.h)
    order by g.h`;
  return rows.map((r) => r.h);
}

async function insert(sql, rows, source) {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ({
    h: r.h, t_c: r.wx.T, rh_pct: r.wx.RH, precip_mm: r.wx.P, sw_wm2: r.wx.SW, et0_mm: r.wx.ET0,
    wind_kmh: r.wx.U, soil_t_c: r.wx.Ts, is_day: r.wx.isDay, source,
  }));
  const written = await sql`insert into meadow.weather_hours ${sql(values)} on conflict (h) do nothing returning h`;
  return written.length;
}

async function main() {
  const sim = await importSim();
  const { istDayOfHour, hourIso } = await importProject("lib/server/rules.ts");
  const { fetchHistoricalForecast, openMeteoFetch } = await importProject("lib/server/open-meteo.ts");
  const meteoFetch = openMeteoFetch(FETCH_TIMEOUT_MS);
  const nowH = sim.hourIndexOf(new Date());
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    let fromH = arg("--from") === undefined ? null : Number(arg("--from"));
    if (fromH !== null && !Number.isInteger(fromH)) throw new Error("--from takes a game hour (a whole number)");
    if (fromH === null) {
      const [r] = await sql`select min(planted_h)::int as h from meadow.plants where not rehearsal`;
      fromH = r.h ?? nowH - 24;
    }
    const gaps = await missingHours(sql, fromH, nowH);
    console.log(`scanning completed hours ${fromH} (${hourIso(fromH)}) to ${nowH - 1}: ${gaps.length} missing`);
    for (const [a, b] of runs(gaps)) console.log(`  ${a}${b > a ? `..${b}` : ""}  ${hourIso(a)}${b > a ? ` to ${hourIso(b + 1)}` : ""}`);
    if (!process.argv.includes("--fill") || gaps.length === 0) {
      if (gaps.length) console.log("dry run: add --fill to fetch and write them");
      return;
    }

    const want = new Set(gaps);
    const pastDays = Math.min(92, Math.max(1, Math.ceil((nowH - gaps[0]) / 24) + 1));
    try {
      // two days ahead, as the server asks: Open-Meteo's "today" turns at UTC midnight, 05:30 IST
      const rows = (await sim.fetchForecast({ pastDays, forecastDays: 2, fetch: meteoFetch })).filter((r) => want.has(r.h) && r.h < nowH);
      console.log(`forecast (past_days=${pastDays}): wrote ${await insert(sql, rows, FORECAST_SOURCE)} hours`);
    } catch (err) {
      console.log(`forecast fetch failed: ${err.message}`);
    }
    const afterForecast = await missingHours(sql, fromH, nowH);
    if (afterForecast.length > 0) {
      try {
        // the same weather models, archived to the hour, from a separate Open-Meteo service
        const start = istDayOfHour(afterForecast[0]), end = istDayOfHour(afterForecast[afterForecast.length - 1] + 1);
        const rows = (await fetchHistoricalForecast(start, end, meteoFetch)).filter((r) => afterForecast.includes(r.h) && r.h < nowH);
        console.log(`historical forecast (${start} to ${end}): wrote ${await insert(sql, rows, HISTORICAL_SOURCE)} hours`);
      } catch (err) {
        console.log(`historical forecast fetch failed: ${err.message}`);
      }
    }
    const still = await missingHours(sql, fromH, nowH);
    if (still.length > 0) {
      try {
        // whole IST days, never past yesterday (the archive refuses later dates)
        const start = istDayOfHour(still[0]);
        const wanted = istDayOfHour(still[still.length - 1] + 1), lastAllowed = istDayOfHour(nowH - 24);
        const end = wanted < lastAllowed ? wanted : lastAllowed;
        if (end < start) {
          console.log(`archive: nothing to ask yet (it serves dates up to ${lastAllowed}; the gaps start on ${start})`);
        } else {
          const rows = (await sim.fetchArchive(start, end, { fetch: meteoFetch })).filter((r) => still.includes(r.h) && r.h < nowH);
          console.log(`archive (${start} to ${end}): wrote ${await insert(sql, rows, ARCHIVE_SOURCE)} hours`);
        }
      } catch (err) {
        console.log(`archive fetch failed: ${err.message}`);
      }
    }
    const left = await missingHours(sql, fromH, nowH);
    console.log(left.length === 0 ? "no gaps left" : `still missing ${left.length} hours (Open-Meteo has no data for them yet)`);
    if (left.length) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`backfill-weather failed: ${err.message}`);
  process.exitCode = 1;
});
