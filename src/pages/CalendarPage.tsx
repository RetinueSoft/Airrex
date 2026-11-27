// Cheapest-date calendar: pick a route and a date range, see the lowest known 1-adult price for each day.
// It uses no paid searches; the live search runs only when the user opens a date.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CalendarDay, CalendarResponse } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';
import { fetchCalendar } from '../lib/api.ts';
import { money, prettyDate, shiftDate, timeAgo, todayYmd } from '../lib/format.ts';
import { AirportDatalist, airportLabel, resolveAirport, toSearchParams } from '../components/SearchForm.tsx';

const MAX_DAYS = 62;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Sequential single-hue ramp (light = lower price, dark = higher price).
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#2a78d6', '#184f95'];

function dayCount(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}

function weekdayIndex(ymd: string) {
  return (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
}

function shortMoney(n: number) {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function describe(d: CalendarDay) {
  const parts = [prettyDate(d.date)];
  if (d.price === undefined) parts.push('No price yet. Open this date to search it.');
  else {
    parts.push(`${d.source === 'estimate' ? 'About ' : 'From '}${money(d.price, 'INR')} per adult`);
    if (d.airlineCode) parts.push(airlineInfo(d.airlineCode).name);
    if (d.stops !== undefined) parts.push(d.stops === 0 ? 'non-stop' : `${d.stops} stop${d.stops > 1 ? 's' : ''}`);
    if (d.source === 'estimate') parts.push('approximate, from recent searches');
    if (d.source === 'live' && d.checkedAt) parts.push(`checked ${timeAgo(d.checkedAt)}`);
    if (d.source === 'demo') parts.push('demo fare');
  }
  return parts.join(' · ');
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const origin = (params.get('from') ?? '').toUpperCase();
  const destination = (params.get('to') ?? '').toUpperCase();
  const start = params.get('start') ?? todayYmd();
  const end = params.get('end') ?? shiftDate(start, 29);
  const adults = Number(params.get('adults') ?? 1);

  const [fromText, setFromText] = useState(origin ? airportLabel(origin) : '');
  const [toText, setToText] = useState(destination ? airportLabel(destination) : '');
  const [startText, setStartText] = useState(start);
  const [endText, setEndText] = useState(end);
  const [formError, setFormError] = useState('');

  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!origin || !destination) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    fetchCalendar(origin, destination, start, end, ctrl.signal)
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e.message))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [origin, destination, start, end]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const o = resolveAirport(fromText);
    const d = resolveAirport(toText);
    if (!o || !d) return setFormError('Choose both airports.');
    if (o === d) return setFormError('From and To must be different.');
    if (startText < todayYmd()) return setFormError('Start date cannot be in the past.');
    if (endText < startText) return setFormError('End date must be on or after the start date.');
    if (dayCount(startText, endText) > MAX_DAYS) return setFormError(`Choose at most ${MAX_DAYS} days.`);
    setFormError('');
    setParams({ from: o, to: d, start: startText, end: endText, adults: String(adults) });
  }

  function openDate(date: string) {
    navigate(`/results?${toSearchParams({ origin, destination, date, adults })}`);
  }

  const priced = data?.days.filter((d) => d.price !== undefined) ?? [];
  const min = priced.length ? Math.min(...priced.map((d) => d.price!)) : 0;
  const max = priced.length ? Math.max(...priced.map((d) => d.price!)) : 0;
  const step = (price: number) => (max === min ? 0 : Math.min(RAMP.length - 1, Math.floor(((price - min) / (max - min)) * RAMP.length)));
  const cheapest = data?.days.find((d) => d.date === data.cheapestDate);
  const top3 = [...priced].sort((a, b) => a.price! - b.price!).slice(0, 3);
  const unknown = (data?.days.length ?? 0) - priced.length;

  // Split days into months for the grid.
  const months = useMemo(() => {
    const groups = new Map<string, CalendarDay[]>();
    for (const d of data?.days ?? []) {
      const key = d.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()];
  }, [data]);

  return (
    <div className="page calendar-page">
      <h1>Cheapest dates</h1>
      <p className="muted">
        Pick a route and a date range to see which day is cheapest. Prices are for 1 adult, Economy, and don't use any
        searches. Open a date to see live prices for every flight.
      </p>

      <form className="search-form compact" onSubmit={submit}>
        <AirportDatalist />
        <div className="field-row">
          <label className="field"><span>From</span>
            <input list="airports" value={fromText} onChange={(e) => setFromText(e.target.value)} placeholder="City or airport" autoComplete="off" required />
          </label>
          <label className="field"><span>To</span>
            <input list="airports" value={toText} onChange={(e) => setToText(e.target.value)} placeholder="City or airport" autoComplete="off" required />
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Between</span>
            <input type="date" value={startText} min={todayYmd()} onChange={(e) => setStartText(e.target.value)} required />
          </label>
          <label className="field"><span>And</span>
            <input type="date" value={endText} min={startText} onChange={(e) => setEndText(e.target.value)} required />
          </label>
          <button className="btn primary search-btn" type="submit">Find cheapest date</button>
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </form>

      {error && <div className="error-box">{error}</div>}
      {loading && !data && <div className="skeleton" style={{ height: 260, marginTop: 16 }} />}

      {data && (
        <div className={loading ? 'dim' : ''}>
          {data.isDemoData && <div className="notice" style={{ marginTop: 16 }}>Showing <b>demo fares</b>.</div>}

          <div className="cheapest-summary">
            {cheapest ? (
              <>
                <div>
                  <div className="muted small-text">
                    Cheapest day, {findAirport(origin)?.city ?? origin} → {findAirport(destination)?.city ?? destination}
                  </div>
                  <div className="cheapest-headline">
                    {prettyDate(cheapest.date)} · {cheapest.source === 'estimate' ? 'about ' : 'from '}
                    {money(cheapest.price!, data.currency)}
                  </div>
                  <div className="muted small-text">
                    {top3.length > 1 && (
                      <>Next cheapest: {top3.slice(1).map((d) => `${prettyDate(d.date)} (${shortMoney(d.price!)})`).join(', ')}</>
                    )}
                  </div>
                </div>
                <button className="btn primary" onClick={() => openDate(cheapest.date)}>See flights on {prettyDate(cheapest.date)}</button>
              </>
            ) : (
              <div className="muted">
                No prices known for these dates yet. Open a date below to search it. Once searched, its price shows here
                for 12 hours.
              </div>
            )}
          </div>

          <div className="cal-legend" aria-label="Legend">
            <span className="ramp-legend">
              Lower price
              {RAMP.map((c) => <i key={c} style={{ background: c }} />)}
              Higher price
            </span>
            <span><b>≈</b> approximate (recent searches)</span>
            <span className="legend-unknown">–</span> not known yet
          </div>

          {months.map(([month, days]) => (
            <section key={month} className="cal-month">
              <h3>{new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
              <div className="cal-grid" role="grid">
                {WEEKDAYS.map((w) => <div key={w} className="cal-weekday" role="columnheader">{w}</div>)}
                {Array.from({ length: weekdayIndex(days[0].date) }, (_, i) => <div key={`pad${i}`} />)}
                {days.map((d) => {
                  const known = d.price !== undefined;
                  const s = known ? step(d.price!) : -1;
                  const isCheapest = d.date === data.cheapestDate;
                  return (
                    <button
                      key={d.date}
                      role="gridcell"
                      className={`cal-cell ${known ? '' : 'unknown'} ${isCheapest ? 'cheapest' : ''} ${s >= 3 ? 'dark' : ''}`}
                      style={known ? { background: RAMP[s] } : undefined}
                      onClick={() => openDate(d.date)}
                      title={describe(d)}
                      aria-label={describe(d)}
                    >
                      <span className="cal-day">{Number(d.date.slice(8))}</span>
                      <span className="cal-price">
                        {known ? `${d.source === 'estimate' ? '≈' : ''}${shortMoney(d.price!)}` : '–'}
                      </span>
                      {isCheapest && <span className="cal-badge">Lowest</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {unknown > 0 && (
            <p className="muted small-text">
              {unknown} day{unknown > 1 ? 's have' : ' has'} no price yet. Tap a day to search it (uses 1 live search).
            </p>
          )}
          <p className="muted small-text">
            Calendar prices are a guide. The live price and booking link appear when you open a date. <Link to="/">New search</Link>
          </p>
        </div>
      )}
    </div>
  );
}
