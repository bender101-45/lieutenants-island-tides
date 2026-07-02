import { useEffect, useState } from "react";
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
        <h1>🌊 Lieutenants Island Road</h1>
        <p className="subtitle">
          South Wellfleet, MA &mdash; road floods above{" "}
          <strong>{FLOOD_THRESHOLD_FT} ft</strong> (MLLW, Wellfleet Harbor)
        </p>
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
              {displayClosures.map(({ date, windows }, i) => (
                <DayCard
                  key={date.toISOString()}
                  date={date}
                  windows={windows}
                  isToday={i === 0}
                />
              ))}
            </div>

            <div className="export-section">
              <button className="export-btn" onClick={downloadCalendar}>
                📅 Export to Apple Calendar (30 days)
              </button>
              <p className="export-hint">
                Includes closure alerts + nightly 8 PM preview of next day
              </p>
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Tide data: NOAA station 8446613 (Wellfleet Harbor) &middot;{" "}
          <a
            href="https://tidesandcurrents.noaa.gov/stationhome.html?id=8446613"
            target="_blank"
            rel="noopener noreferrer"
          >
            NOAA
          </a>
        </p>
      </footer>
    </div>
  );
}

function DayCard({ date, windows, isToday }) {
  return (
    <div className={`day-card${isToday ? " today" : ""}`}>
      <div className="day-header">
        <span className="day-label">
          {isToday ? "Today" : formatShortDate(date)}
        </span>
        {isToday && <span className="day-full-date">{formatDate(date)}</span>}
      </div>

      {windows.length === 0 ? (
        <div className="no-closure">No road flooding expected</div>
      ) : (
        <ul className="windows-list">
          {windows.map((w, i) => (
            <li key={i} className="window-item">
              <span className="window-icon">🚧</span>
              <span className="window-text">
                Road covered{" "}
                <strong>
                  {formatTime(w.start)} &ndash; {formatTime(w.end)}
                </strong>{" "}
                <span className="window-duration">
                  ({formatDuration(w.start, w.end)})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
