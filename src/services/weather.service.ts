// Free, keyless Nairobi weather via Open-Meteo, cached so we don't
// hammer the API on every recommendations request.
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const NAIROBI_LAT = -1.2921;
const NAIROBI_LON = 36.8219;
const CACHE_TTL_MS = 30 * 60 * 1000;

let cached: { temperature: number | null; fetchedAt: number } | null = null;

export const WeatherService = {
  async getNairobiTemperature(): Promise<number | null> {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.temperature;
    }
    try {
      const url = `${OPEN_METEO_URL}?latitude=${NAIROBI_LAT}&longitude=${NAIROBI_LON}&current=temperature_2m&timezone=Africa%2FNairobi`;
      const res = await fetch(url);
      if (!res.ok) return cached?.temperature ?? null;
      const json: any = await res.json();
      const temp = json?.current?.temperature_2m;
      const value = typeof temp === 'number' ? temp : null;
      cached = { temperature: value, fetchedAt: Date.now() };
      return value;
    } catch {
      return cached?.temperature ?? null;
    }
  },
};

export default WeatherService;
