import { useCallback, useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  FLOOD_THRESHOLD_FT,
  fetchTidePredictions,
  loadCachedPredictions,
  computeDailyClosures,
  getDayCurve,
  getCurrentStatus,
  generateICS,
  formatTime,
  formatDuration,
  formatDate,
  formatShortDate,
} from "./tideLogic";
import "./App.css";

const DISPLAY_DAYS = 7;
const CALENDAR_DAYS = 30;

function toNoaaDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatStale(date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function App() {
  const [displayClosures, setDisplayClosures] = useState(null);
  const [calendarClosures, setCalendarClosures] = useState(null);
  const [todayCurve, setTodayCurve] = useState(null);
  const [error, setError] = useState(null);
  const [staleSince, setStaleSince] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [copied, setCopied] = useState(false);

  // Keep the "right now" status and countdown fresh
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    // Turn a set of extremes into the view models the UI needs.
    const build = (extremes) => {
      setDisplayClosures(computeDailyClosures(extremes, today, DISPLAY_DAYS));
      setCalendarClosures(computeDailyClosures(extremes, today, CALENDAR_DAYS));
      setTodayCurve(getDayCurve(extremes, today, todayEnd));
    };

    try {
      // Fetch 32 days with 1-day buffer on each end for interpolation edges
      const begin = new Date(today);
      begin.setDate(today.getDate() - 1);
      const end = new Date(today);
      end.setDate(today.getDate() + CALENDAR_DAYS + 1);

      const extremes = await fetchTidePredictions(
        toNoaaDate(begin),
        toNoaaDate(end)
      );
      build(extremes);
      setStaleSince(null);
    } catch {
      // NOAA is down — fall back to the last good forecast on this device.
      const cached = loadCachedPredictions();
      if (cached) {
        build(cached.extremes);
        setStaleSince(cached.savedAt);
      } else {
        setError("NOAA's tide service is temporarily unavailable.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function shareApp() {
    const url = window.location.href;
    const blurb =
      "Check when the road to Lieutenants Island floods each day. " +
      "Free, and works right on your phone.";
    const shareData = {
      title: "Lieutenants Island Road Flooding",
      text: blurb,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled the share sheet — nothing to do
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${blurb}\n${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // clipboard unavailable — nothing to do
      }
    }
  }

  function downloadCalendar() {
    if (!calendarClosures) return;
    const ics = generateICS(calendarClosures);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lieutenants-island-road.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <WaveMark />
          <h1>Lieutenants Island</h1>
          <p className="eyebrow">Road Flooding Forecast</p>
          <p className="subtitle">
            South Wellfleet, Massachusetts. Road flooding is estimated using a
            tide height of <strong>{FLOOD_THRESHOLD_FT} feet</strong>. These
            times are estimates only, actual conditions may vary.
          </p>
        </div>
      </header>

      <main className="app-main">
        {loading && (
          <div className="status-msg">Loading tide predictions…</div>
        )}

        {error && (
          <div className="status-msg error">
            <strong>{error}</strong>
            <p className="error-sub">
              This is a problem on NOAA's end, not the app. Please try again in a
              little while.
            </p>
            <button className="retry-btn" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {staleSince && !loading && (
          <div className="stale-banner">
            Showing your last saved forecast from {formatStale(staleSince)}.
            NOAA's live data is temporarily unavailable.
          </div>
        )}

        {displayClosures && (
          <>
            <StatusBanner
              status={getCurrentStatus(calendarClosures, now)}
              now={now}
            />

            <div className="days">
              {displayClosures.map(({ date, windows, extremes }, i) => (
                <DayCard
                  key={date.toISOString()}
                  date={date}
                  windows={windows}
                  extremes={extremes}
                  isToday={i === 0}
                  curve={i === 0 ? todayCurve : null}
                  now={now}
                />
              ))}
            </div>

            <div className="export-section">
              <button className="export-btn" onClick={downloadCalendar}>
                Add to Apple Calendar
              </button>
              <button className="share-btn" onClick={shareApp}>
                {copied ? "Link copied ✓" : "Share this app"}
              </button>
              <p className="export-hint">
                Downloads the next 30 days of closures, with a reminder one hour
                before each, plus a nightly 8&nbsp;PM preview of the next day.
              </p>
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Predictions from NOAA CO-OPS, station 8446613 (Wellfleet Harbor).{" "}
          <a
            href="https://tidesandcurrents.noaa.gov/stationhome.html?id=8446613"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source
          </a>
        </p>
      </footer>

      <Analytics />
    </div>
  );
}

function StatusBanner({ status, now }) {
  const { covered, nextChange } = status;
  const countdown = nextChange ? formatDuration(now, nextChange) : null;

  return (
    <div className={`status-banner ${covered ? "is-covered" : "is-open"}`}>
      <span className="status-dot" aria-hidden="true" />
      <div className="status-content">
        <span className="status-headline">
          {covered ? "Road is covered now" : "Road is open now"}
        </span>
        {countdown && (
          <span className="status-detail">
            {covered ? "Clears in" : "Next closure in"} {countdown}
            {" · "}
            {formatTime(nextChange)}
          </span>
        )}
      </div>
    </div>
  );
}

function WaveMark() {
  return (
    <svg
      className="wave-mark"
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 16 q 6 -10 11.5 0 t 11.5 0 t 11.5 0 t 9.5 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M2 10 q 6 -8 11.5 0 t 11.5 0 t 11.5 0 t 9.5 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

function TideGraph({ curve, now }) {
  const W = 340;
  const H = 130;
  const x0 = 0;
  const x1 = W;
  const y0 = 16;
  const y1 = H - 18;

  const dayStart = new Date(curve[0].t);
  dayStart.setHours(0, 0, 0, 0);
  const dayMs = 24 * 3600 * 1000;

  const heights = curve.map((p) => p.h);
  const loH = Math.min(...heights, FLOOD_THRESHOLD_FT) - 0.4;
  const hiH = Math.max(...heights, FLOOD_THRESHOLD_FT) + 0.4;

  const sx = (t) => x0 + ((t - dayStart.getTime()) / dayMs) * (x1 - x0);
  const sy = (h) => y1 - ((h - loH) / (hiH - loH)) * (y1 - y0);

  const pts = curve.map(
    (p) => `${sx(p.t.getTime()).toFixed(1)},${sy(p.h).toFixed(1)}`
  );
  const linePath = "M" + pts.join(" L");
  const areaPath =
    `M${sx(curve[0].t.getTime()).toFixed(1)},${y1} L` +
    pts.join(" L") +
    ` L${sx(curve[curve.length - 1].t.getTime()).toFixed(1)},${y1} Z`;

  const yThresh = sy(FLOOD_THRESHOLD_FT);
  const nowT = now.getTime();
  const showNow = nowT >= dayStart.getTime() && nowT <= dayStart.getTime() + dayMs;
  const nowX = sx(nowT);

  // current tide height (nearest sample) for the marker dot
  let nowH = null;
  if (showNow) {
    let best = curve[0];
    let bestDiff = Infinity;
    for (const p of curve) {
      const d = Math.abs(p.t.getTime() - nowT);
      if (d < bestDiff) {
        bestDiff = d;
        best = p;
      }
    }
    nowH = best.h;
  }

  // gentle animated surface ripples (drift horizontally within the water)
  const wl = 48;
  const wave = (yy, amp) => {
    const p = [];
    for (let x = -W; x <= 2 * W; x += 6) {
      p.push(`${x},${(yy + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(1)}`);
    }
    return "M" + p.join(" L");
  };
  const r1 = y0 + (y1 - y0) * 0.42;
  const r2 = y0 + (y1 - y0) * 0.62;

  const ticks = [0, 6, 12, 18, 24].map((h) => ({
    x: sx(dayStart.getTime() + h * 3600 * 1000),
    label:
      h === 0 || h === 24 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`,
  }));

  return (
    <svg
      className="tide-graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Tide height across today with the road-flooding level marked"
    >
      <defs>
        <clipPath id="underCurve">
          <path d={areaPath} />
        </clipPath>
        <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fc6d6" />
          <stop offset="1" stopColor="#dceef2" />
        </linearGradient>
      </defs>

      <g clipPath="url(#underCurve)">
        {/* water body */}
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="url(#waterFill)" />
        {/* covered zone above the flood line */}
        <rect x={x0} y={y0} width={x1 - x0} height={yThresh - y0}
              fill="#c9663a" opacity="0.38" />
        {/* drifting ripples */}
        <path className="tg-ripple tg-ripple-a" d={wave(r1, 2.4)}
              fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.5" />
        <path className="tg-ripple tg-ripple-b" d={wave(r2, 1.8)}
              fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.35" />
      </g>

      {/* soft flood line */}
      <line x1={x0} y1={yThresh} x2={x1} y2={yThresh}
            stroke="#b8552b" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" />
      <text x={x1 - 3} y={yThresh - 4} textAnchor="end" className="tg-thresh">
        flood level
      </text>

      {/* tide curve */}
      <path d={linePath} fill="none" stroke="#12707f" strokeWidth="2.4"
            strokeLinejoin="round" strokeLinecap="round" />

      {/* now marker */}
      {showNow && (
        <>
          <circle className="tg-nowpulse" cx={nowX} cy={sy(nowH)} r="4"
                  fill="#12707f" opacity="0.4" />
          <circle cx={nowX} cy={sy(nowH)} r="4"
                  fill="#0f2e38" stroke="#fff" strokeWidth="1.8" />
          <text x={nowX} y={y0 - 4} textAnchor="middle" className="tg-now">
            now
          </text>
        </>
      )}

      {/* time axis */}
      {ticks.map((t, i) => (
        <text
          key={i}
          x={t.x + (i === 0 ? 2 : i === ticks.length - 1 ? -2 : 0)}
          y={H - 4}
          textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
          className="tg-x"
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
}

function DayCard({ date, windows, extremes, isToday, curve, now }) {
  const closed = windows.length > 0;
  return (
    <div className={`day-card${isToday ? " today" : ""}`}>
      <div className="day-header">
        <div className="day-heading">
          {isToday && <span className="today-pill">Today</span>}
          <span className="day-label">
            {isToday ? formatDate(date) : formatShortDate(date)}
          </span>
        </div>
        <span className={`day-status ${closed ? "is-closed" : "is-open"}`}>
          {closed
            ? `${windows.length} closure${windows.length > 1 ? "s" : ""}`
            : "Open"}
        </span>
      </div>

      {curve && curve.length > 0 && <TideGraph curve={curve} now={now} />}

      {!closed ? (
        <div className="no-closure">No road flooding expected</div>
      ) : (
        <ul className="windows-list">
          {windows.map((w, i) => (
            <li key={i} className="window-item">
              <span className="window-times">
                {formatTime(w.start)}
                <span className="window-dash">&ndash;</span>
                {formatTime(w.end)}
              </span>
              <span className="window-duration">
                {formatDuration(w.start, w.end)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {extremes && extremes.length > 0 && (
        <div className="tides">
          {extremes.map((e, i) => (
            <div key={i} className="tide">
              <span className="tide-type">
                {e.type === "H" ? "High" : "Low"}
              </span>
              <span className="tide-time">{formatTime(e.t)}</span>
              <span className="tide-height">{e.v.toFixed(1)} ft</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
