// Vercel serverless proxy for NOAA tide predictions.
//
// Why this exists: NOAA's API is intermittently down and can't be cached by the
// browser. This function fetches NOAA once server-side, and Vercel's CDN caches
// the result (via Cache-Control below) and keeps serving it — even while NOAA is
// down — so every visitor gets the last good forecast, not an error. It also
// removes any browser CORS dependency on NOAA.

const NOAA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const STATION_ID = "8446613";
const ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Best-effort warm cache within a single function instance.
let lastGood = null; // { predictions, savedAt }

export default async function handler(req, res) {
  const { begin_date, end_date } = req.query;

  if (!/^\d{8}$/.test(begin_date || "") || !/^\d{8}$/.test(end_date || "")) {
    res
      .status(400)
      .json({ error: "begin_date and end_date (yyyymmdd) are required" });
    return;
  }

  const params = new URLSearchParams({
    product: "predictions",
    datum: "MLLW",
    interval: "hilo",
    time_zone: "lst_ldt",
    units: "english",
    format: "json",
    station: STATION_ID,
    begin_date,
    end_date,
  });
  const url = `${NOAA_URL}?${params}`;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await fetch(url);
      const text = await r.text();

      let json;
      try {
        json = JSON.parse(text); // NOAA 504/500 returns HTML, not JSON
      } catch {
        throw new Error("NOAA returned a non-JSON response");
      }
      if (json.error) throw new Error(json.error.message || "NOAA API error");
      if (!Array.isArray(json.predictions)) throw new Error("No predictions");

      lastGood = { predictions: json.predictions, savedAt: Date.now() };

      // Fresh for 30 min at the CDN; serve stale for up to 7 days while
      // revalidating in the background — this is what survives NOAA outages.
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=1800, stale-while-revalidate=604800"
      );
      res.status(200).json({
        predictions: json.predictions,
        savedAt: lastGood.savedAt,
        stale: false,
      });
      return;
    } catch {
      if (attempt < ATTEMPTS) await sleep(attempt * 500);
    }
  }

  // Every attempt failed. Serve the warm-instance copy if we have one so the
  // CDN keeps a good response cached; otherwise signal failure.
  if (lastGood) {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=604800"
    );
    res.status(200).json({
      predictions: lastGood.predictions,
      savedAt: lastGood.savedAt,
      stale: true,
    });
    return;
  }

  res.status(502).json({ error: "NOAA is unavailable and no cached data yet" });
}
