import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIRPORTS, findAirport } from '../../shared/airports.ts';
import type { SearchQuery } from '../../shared/types.ts';
import { todayYmd } from '../lib/format.ts';
import Icon from './Icon.tsx';

export function airportLabel(code: string) {
  const a = findAirport(code);
  return a ? `${a.city} (${a.code})` : code;
}

export function AirportDatalist() {
  return (
    <datalist id="airports">
      {AIRPORTS.map((a) => (
        <option key={a.code} value={`${a.city} (${a.code})`}>{a.name}</option>
      ))}
    </datalist>
  );
}

/** Accepts "DEL", "del", "New Delhi", "New Delhi (DEL)". */
export function resolveAirport(text: string): string | null {
  const t = text.trim();
  const inParens = /\(([A-Za-z]{3})\)\s*$/.exec(t);
  if (inParens) return inParens[1].toUpperCase();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  const lower = t.toLowerCase();
  const match = AIRPORTS.find((a) => a.city.toLowerCase() === lower) ?? AIRPORTS.find((a) => a.city.toLowerCase().startsWith(lower));
  return match?.code ?? null;
}

/** URL params for the results page. Cabin is always Economy, so it isn't in the URL. */
export function toSearchParams(q: Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'>) {
  return new URLSearchParams({ from: q.origin, to: q.destination, date: q.date, adults: String(q.adults) });
}

export default function SearchForm({ initial, compact }: { initial?: Partial<SearchQuery>; compact?: boolean }) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(initial?.origin ? airportLabel(initial.origin) : '');
  const [to, setTo] = useState(initial?.destination ? airportLabel(initial.destination) : '');
  const [date, setDate] = useState(initial?.date ?? todayYmd());
  const [adults, setAdults] = useState(initial?.adults ?? 1);
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const origin = resolveAirport(from);
    const destination = resolveAirport(to);
    if (!origin) return setError('Choose where you are flying from.');
    if (!destination) return setError('Choose where you are flying to.');
    if (origin === destination) return setError('From and To must be different airports.');
    if (date < todayYmd()) return setError('Pick today or a future date.');
    setError('');
    navigate(`/results?${toSearchParams({ origin, destination, date, adults })}`);
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  return (
    <form className={`searchbar ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <AirportDatalist />
      <div className="searchbar-grid">
        <label className="sfield">
          <span className="sfield-label">From</span>
          <span className="sfield-row">
            <Icon name="flight_takeoff" className="sfield-icon primary" />
            <input list="airports" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="City or airport" autoComplete="off" required />
          </span>
        </label>
        <div className="swap-wrap">
          <button type="button" className="swap" onClick={swap} aria-label="Swap origin and destination">
            <Icon name="swap_horiz" size={20} />
          </button>
        </div>
        <label className="sfield">
          <span className="sfield-label">To</span>
          <span className="sfield-row">
            <Icon name="flight_land" className="sfield-icon primary" />
            <input list="airports" value={to} onChange={(e) => setTo(e.target.value)} placeholder="City or airport" autoComplete="off" required />
          </span>
        </label>
        <label className="sfield">
          <span className="sfield-label">Departure</span>
          <span className="sfield-row">
            <input type="date" value={date} min={todayYmd()} onChange={(e) => setDate(e.target.value)} required />
          </span>
        </label>
        <label className="sfield">
          <span className="sfield-label">Travelers</span>
          <span className="sfield-row">
            <Icon name="person" className="sfield-icon" />
            <select value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n} Adult{n > 1 ? 's' : ''}</option>)}
            </select>
          </span>
        </label>
        <button className="btn primary search-btn" type="submit">
          <Icon name="search" size={20} /> Search flights
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
