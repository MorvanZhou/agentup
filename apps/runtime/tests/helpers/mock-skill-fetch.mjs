/**
 * 示例 skill 脚本子进程用：拦截实网 API，不打外网。
 * 用法：node --import ./mock-skill-fetch.mjs <script> …
 */
const realFetch = globalThis.fetch.bind(globalThis);

function json(body) {
  return Response.json(body);
}

globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  const parsed = new URL(url);

  // —— open-meteo（天气 / 世界时钟 geocode）——
  if (parsed.hostname === "geocoding-api.open-meteo.com") {
    const name = parsed.searchParams.get("name") || "杭州";
    return json({
      results: [{ name, latitude: 30.25, longitude: 120.17, timezone: "Asia/Shanghai" }],
    });
  }
  if (parsed.hostname === "api.open-meteo.com" && parsed.pathname.includes("/forecast")) {
    const hours = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, "0");
      return `2026-10-23T${h}:00`;
    });
    const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(23 + i).padStart(2, "0")}`);
    return json({
      current: {
        temperature_2m: 22,
        apparent_temperature: 21,
        relative_humidity_2m: 60,
        weather_code: 0,
        wind_speed_10m: 12,
        wind_direction_10m: 90,
        precipitation: 0,
        surface_pressure: 1013,
        visibility: 10000,
      },
      hourly: {
        time: hours,
        temperature_2m: hours.map(() => 22),
        weather_code: hours.map(() => 0),
        precipitation_probability: hours.map(() => 10),
        precipitation: hours.map(() => 0),
        wind_speed_10m: hours.map(() => 12),
        uv_index: hours.map(() => 3),
      },
      daily: {
        time: days,
        weather_code: days.map(() => 0),
        temperature_2m_max: days.map(() => 25),
        temperature_2m_min: days.map(() => 18),
        precipitation_probability_max: days.map(() => 20),
        sunrise: days.map((d) => `${d}T06:00`),
        sunset: days.map((d) => `${d}T18:00`),
        uv_index_max: days.map(() => 5),
      },
    });
  }
  if (parsed.hostname === "air-quality-api.open-meteo.com") {
    return json({
      current: { us_aqi: 42, european_aqi: 30, pm2_5: 8.5, pm10: 12.2 },
    });
  }
  if (parsed.hostname === "climate-api.open-meteo.com") {
    return json({ daily: { time: [], temperature_2m_mean: [], precipitation_sum: [] } });
  }

  // —— frankfurter（汇率）——
  if (parsed.hostname === "api.frankfurter.dev") {
    // /v2/rate/usd/cny?date=…
    const rateMatch = parsed.pathname.match(/\/v2\/rate\/([^/]+)\/([^/]+)/i);
    if (rateMatch) {
      const date = parsed.searchParams.get("date") || "2026-10-23";
      // 随日期略变，方便 change 窗口算出 pct
      const dayOffset = Math.max(0, (Date.parse("2026-10-23") - Date.parse(date)) / 86_400_000);
      const rate = Number((7.0 - dayOffset * 0.001).toFixed(4));
      return json({
        base: rateMatch[1].toUpperCase(),
        quote: rateMatch[2].toUpperCase(),
        rate,
        date,
      });
    }
    if (parsed.pathname.endsWith("/currencies")) {
      return json([
        { iso_code: "USD", name: "US Dollar", symbol: "$" },
        { iso_code: "CNY", name: "Chinese Yuan", symbol: "¥" },
      ]);
    }
    if (parsed.pathname.endsWith("/rates")) {
      return json([
        { base: "USD", quote: "CNY", rate: 7.0, date: "2026-10-23" },
      ]);
    }
  }

  // —— CoinGecko（加密价）——
  if (parsed.hostname === "api.coingecko.com") {
    const ids = (parsed.searchParams.get("ids") || "bitcoin").split(",")[0];
    return json({
      [ids]: { usd: 65000, cny: 470000, usd_24h_change: 1.23 },
    });
  }

  return realFetch(input, init);
};
