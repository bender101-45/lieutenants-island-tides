// ─── Constants ───────────────────────────────────────────────────────────────
export const FLOOD_THRESHOLD_FT = 9.8;
const STATION_ID = "8446613";
const SAMPLE_INTERVAL_MIN = 2;

// ─── NOAA fetch ──────────────────────────────────────────────────────────────
export async function fetchTidePredictions(beginDate, endDate) {
  const params = new URLSearchParams({
    product: "predictions",
    datum: "MLLW",
    interval: "hilo",
    time_zone: "lst_ldt",
    units: "english",
    format: "json",
    station: STATION_ID,
    begin_date: beginDate, // "yyyymmdd"
    end_date: endDate,
  });
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "NOAA API error");
  // Parse predictions into { t: Date, v: number, type: "H"|"L" }
  return json.predictions.map((p) => ({
    t: parseLocalTime(p.t),
    v: parseFloat(p.v),
    type: p.type,
  }));
}

// Parse "2026-06-09 19:02" as a local Date (no UTC conversion)
function parseLocalTime(str) {
  const [datePart, timePart] = str.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// ─── Cosine interpolation between two extremes ───────────────────────────────
function interpolateHeight(h1, t1, h2, t2, t) {
  const span = t2 - t1; // ms
  const elapsed = t - t1; // ms
  return (h1 + h2) / 2 + ((h1 - h2) / 2) * Math.cos(Math.PI * (elapsed / span));
}

// ─── Sample the reconstructed curve across a day ─────────────────────────────
// extremes: full sorted array of {t, v, type} (may span multiple days)
// dayStart/dayEnd: Date objects for midnight boundaries of the target day
export function sampleDay(extremes, dayStart, dayEnd) {
  const samples = [];
  const stepMs = SAMPLE_INTERVAL_MIN * 60 * 1000;

  for (let t = dayStart.getTime(); t <= dayEnd.getTime(); t += stepMs) {
    // Find the surrounding extremes
    let iLeft = -1;
    for (let i = 0; i < extremes.length - 1; i++) {
      if (extremes[i].t.getTime() <= t && extremes[i + 1].t.getTime() >= t) {
        iLeft = i;
        break;
      }
    }
    if (iLeft === -1) continue; // outside the available data range

    const left = extremes[iLeft];
    const right = extremes[iLeft + 1];
    const h = interpolateHeight(left.v, left.t.getTime(), right.v, right.t.getTime(), t);
    samples.push({ t: new Date(t), h });
  }
  return samples;
}

// ─── Find closure windows from samples ───────────────────────────────────────
// Returns array of { start: Date, end: Date }
export function findClosureWindows(samples) {
  const windows = [];
  let inClosure = false;
  let windowStart = null;

  for (let i = 0; i < samples.length; i++) {
    const above = samples[i].h >= FLOOD_THRESHOLD_FT;

    if (above && !inClosure) {
      // Upward crossing — interpolate precise time
      if (i > 0) {
        windowStart = interpolateCrossing(samples[i - 1], samples[i]);
      } else {
        windowStart = samples[i].t;
      }
      inClosure = true;
    } else if (!above && inClosure) {
      // Downward crossing — interpolate precise time
      const windowEnd =
        i > 0 ? interpolateCrossing(samples[i - 1], samples[i]) : samples[i].t;
      windows.push({ start: windowStart, end: windowEnd });
      inClosure = false;
      windowStart = null;
    }
  }

  // If still in closure at end of samples (e.g. spans midnight)
  if (inClosure && windowStart) {
    windows.push({ start: windowStart, end: samples[samples.length - 1].t });
  }

  return windows;
}

// Linear interpolation for exact crossing time
function interpolateCrossing(s0, s1) {
  const frac = (FLOOD_THRESHOLD_FT - s0.h) / (s1.h - s0.h);
  const ms = s0.t.getTime() + frac * (s1.t.getTime() - s0.t.getTime());
  return new Date(ms);
}

// ─── Compute closures for N days starting from today ─────────────────────────
export function computeDailyClosures(extremes, startDate, numDays) {
  const results = [];
  for (let i = 0; i < numDays; i++) {
    const dayStart = new Date(startDate);
    dayStart.setDate(startDate.getDate() + i);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const samples = sampleDay(extremes, dayStart, dayEnd);
    const windows = findClosureWindows(samples);
    results.push({ date: new Date(dayStart), windows });
  }
  return results;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
export function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDuration(start, end) {
  const totalMin = Math.round((end - start) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatShortDate(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── ICS generation ──────────────────────────────────────────────────────────
function toICSDate(date) {
  // Format as local time with TZID=America/New_York
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function windowDescription(windows) {
  if (windows.length === 0) return "No road flooding expected.";
  return windows
    .map((w) => `Road covered ${formatTime(w.start)} – ${formatTime(w.end)}`)
    .join(" and ");
}

export function generateICS(dailyClosures) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lieutenants Island Tides//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lieutenants Island Road",
    "X-WR-TIMEZONE:America/New_York",
  ];

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  for (const { date, windows } of dailyClosures) {
    // Individual closure events
    for (const w of windows) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid()}@lt-island-tides`,
        `DTSTART;TZID=America/New_York:${toICSDate(w.start)}`,
        `DTEND;TZID=America/New_York:${toICSDate(w.end)}`,
        "SUMMARY:🌊 Lieutenants Island Road Covered",
        `DESCRIPTION:Road impassable ${formatTime(w.start)} – ${formatTime(w.end)} (${formatDuration(w.start, w.end)})`,
        "BEGIN:VALARM",
        "TRIGGER:-PT1H",
        "ACTION:DISPLAY",
        "DESCRIPTION:Road floods in 1 hour",
        "END:VALARM",
        "END:VEVENT"
      );
    }

    // Nightly summary event at 8 PM previewing the NEXT day
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);
    const nextDayData = dailyClosures.find(
      (d) => d.date.toDateString() === nextDay.toDateString()
    );
    if (nextDayData !== undefined) {
      const summaryStart = new Date(date);
      summaryStart.setHours(20, 0, 0, 0);
      const summaryEnd = new Date(summaryStart);
      summaryEnd.setMinutes(30);

      const desc = nextDayData.windows.length === 0
        ? "No road flooding expected tomorrow."
        : "Tomorrow: " + windowDescription(nextDayData.windows);

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid()}@lt-island-tides-summary`,
        `DTSTART;TZID=America/New_York:${toICSDate(summaryStart)}`,
        `DTEND;TZID=America/New_York:${toICSDate(summaryEnd)}`,
        "SUMMARY:🌊 Tomorrow's Road Closures",
        `DESCRIPTION:${desc}`,
        "BEGIN:VALARM",
        "TRIGGER:PT0M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${desc}`,
        "END:VALARM",
        "END:VEVENT"
      );
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
