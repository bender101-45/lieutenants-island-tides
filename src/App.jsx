import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  FLOOD_THRESHOLD_FT,
  fetchTidePredictions,
  computeDailyClosures,
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

export default function App() {
  const [displayClosures, setDisplayClosures] = useState(null);
  const [calendarClosures, setCalendarClosures] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Fetch 32 days with 1-day buffer on each end for interpolation edges
        const begin = new Date(today);
        begin.setDate(today.getDate() - 1);
        const end = new Date(today);
        end.setDate(today.getDate() + CALENDAR_DAYS + 1);

        const extremes = await fetchTidePredictions(
          toNoaaDate(begin),
          toNoaaDate(end)
        );

        const display = computeDailyClosures(extremes, today, DISPLAY_DAYS);
        const calendar = computeDailyClosures(extremes, today, CALENDAR_DAYS);

        setDisplayClosures(display);
        setCalendarClosures(calendar);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
            South Wellfleet, Massachusetts. The causeway floods when the tide
            reaches <strong>{FLOOD_THRESHOLD_FT} ft</strong> above MLLW at
            Wellfleet Harbor.
          </p>
        </div>
      </header>

      <main className="app-main">
        {loading && (
          <div className="status-msg">Loading tide predictions…</div>
        )}

        {error && (
          <div className="status-msg error">
            <strong>Could not load tide data.</strong>
            <br />
            {error}
          </div>
        )}

        {displayClosures && (
          <>
            <div className="days">
              {displayClosures.map(({ date, windows, extremes }, i) => (
                <DayCard
                  key={date.toISOString()}
                  date={date}
                  windows={windows}
                  extremes={extremes}
                  isToday={i === 0}
                />
              ))}
            </div>

            <div className="export-section">
              <button className="export-btn" onClick={downloadCalendar}>
                Add to Apple Calendar
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
        <p className="footer-note">
          A reconstructed forecast &mdash; verify conditions before crossing.
        </p>
      </footer>

      <Analytics />
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

function DayCard({ date, windows, extremes, isToday }) {
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
