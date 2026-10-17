// GET /api/weather/now: the latest completed hour of Bangalore weather at the Disney office, for the UI's weather
// chips, with upToDate and lagHours (hours the store is behind the last completed hour; plants wait at a gap, so an
// uptime monitor can watch lagHours), and the weather ahead (lib/server/forecast.ts): the next 24 hours of forecast
// from the hour in progress (nowH) and the model's heavy-rain hint over the next 12 (rainSoon). Forecast hours are held
// in memory, never stored. The same for everyone, so the CDN caches it for five minutes (one while the forecast is
// unavailable, so it returns soon). connection() keeps it out of build-time prerendering (it reads nothing from the
// request). Credit Open-Meteo wherever these numbers show.
import { connection } from "next/server";
import { WEATHER_CREDIT, hourIndexOf } from "@/lib/sim";
import { weatherAhead } from "@/lib/server/forecast";
import { errorResponse, json } from "@/lib/server/http";
import { hourIso } from "@/lib/server/rules";
import { latestWeather } from "@/lib/server/weather-store";

const CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const CACHE_NO_FORECAST = "public, max-age=0, s-maxage=60, stale-while-revalidate=120";

export async function GET() {
  await connection();
  try {
    const now = new Date();
    const nowH = hourIndexOf(now);
    // the forecast is fetched alongside the observed hour, never after it
    const [latest, ahead] = await Promise.all([latestWeather(now), weatherAhead(nowH)]);
    if (!latest) {
      return json({ error: "no_weather", message: "The weather report is on its way; please try again in a minute." }, { status: 503 });
    }
    const { h, wx } = latest;
    // the last completed hour is nowH - 1; anything older means plants are waiting for weather
    const lagHours = Math.max(0, nowH - 1 - h);
    return json(
      {
        h,
        from: hourIso(h),
        until: hourIso(h + 1),
        temperatureC: wx.T,
        humidityPct: wx.RH,
        rainMm: wx.P,
        raining: wx.P >= 0.1,
        sunWm2: wx.SW,
        windKmh: wx.U,
        soilTempC: wx.Ts,
        isDay: wx.isDay === 1,
        place: "Disney India office, RMZ Ecoworld, Bellandur, Bangalore",
        credit: WEATHER_CREDIT,
        upToDate: lagHours === 0,
        lagHours,
        nowH,
        forecast: ahead ? ahead.hours : [],
        rainSoon: ahead ? ahead.rainSoon : null,
      },
      { headers: { "Cache-Control": ahead ? CACHE : CACHE_NO_FORECAST } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
