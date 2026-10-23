/** 给 check-weather.mjs 子进程用：拦截 open-meteo，不打实网。`--import` 注入。 */
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);

  if (url.includes("geocoding-api.open-meteo.com")) {
    return Response.json({
      results: [{ name: "杭州", latitude: 30.25, longitude: 120.17 }],
    });
  }

  if (url.includes("api.open-meteo.com/v1/forecast")) {
    const hours = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, "0");
      return `2026-10-23T${h}:00`;
    });
    const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(23 + i).padStart(2, "0")}`);
    return Response.json({
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

  if (url.includes("air-quality-api.open-meteo.com")) {
    return Response.json({
      current: { us_aqi: 42, european_aqi: 30, pm2_5: 8.5, pm10: 12.2 },
    });
  }

  if (url.includes("climate-api.open-meteo.com")) {
    return Response.json({ daily: { time: [], temperature_2m_mean: [], precipitation_sum: [] } });
  }

  return realFetch(input, init);
};
