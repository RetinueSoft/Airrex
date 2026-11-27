import { useState } from 'react';
import { Link } from 'react-router-dom';
import { findAirport } from '../../shared/airports.ts';
import { loadRecentSearches, removeRecentSearch, searchDate, type RecentSearch } from '../lib/recentSearches.ts';
import SearchForm, { toSearchParams } from '../components/SearchForm.tsx';
import Icon from '../components/Icon.tsx';
import { prettyDate, shiftDate, todayYmd } from '../lib/format.ts';

// Popular with travellers from Tamil Nadu.
const POPULAR = [
  ['TRZ', 'SIN'],
  ['MAA', 'DXB'],
  ['TRZ', 'KUL'],
  ['CJB', 'SIN'],
  ['IXM', 'CMB'],
  ['MAA', 'DEL'],
  ['CJB', 'BLR'],
  ['TRZ', 'SHJ'],
];

const city = (code: string) => findAirport(code)?.city ?? code;

/** Recent searches: tap one to run it again (a past date moves to today). */
function RecentSearches() {
  const [list, setList] = useState<RecentSearch[]>(loadRecentSearches);
  if (!list.length) return null;
  const today = todayYmd();
  return (
    <section className="recent">
      <h2>Recent searches</h2>
      <div className="recent-list">
        {list.map((s) => (
          <div key={s.at} className="recent-item">
            <Link className="recent-link" to={`/results?${toSearchParams({ ...s, date: searchDate(s) })}`}>
              <Icon name="history" size={20} />
              <span className="grow">
                <b>{city(s.origin)} → {city(s.destination)}</b>
                <span className="muted small-text">
                  {s.origin} → {s.destination} · {s.date < today ? 'Today (was ' + prettyDate(s.date) + ')' : prettyDate(s.date)} · {s.adults} adult{s.adults > 1 ? 's' : ''}
                </span>
              </span>
              <Icon name="chevron_right" size={20} />
            </Link>
            <button
              type="button"
              className="link-btn recent-remove"
              aria-label={`Remove ${s.origin} to ${s.destination} from recent searches`}
              onClick={() => {
                removeRecentSearch(s);
                setList(loadRecentSearches());
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SearchPage() {
  const date = shiftDate(todayYmd(), 7);
  return (
    <>
      <section className="hero">
        <div className="band-inner">
          <h1>Compare every airline. Book direct.</h1>
          <p className="lead">See all flights and the real price you pay for your date, then book on the airline's own website.</p>
          <SearchForm />
          <Link to="/cheapest-dates" className="hero-link">
            <Icon name="calendar_month" /> Flexible dates? Find the cheapest day to fly →
          </Link>
        </div>
      </section>
      <div className="content">
        <RecentSearches />
        <section className="popular">
          <h2>Popular routes</h2>
          <div className="chips">
            {POPULAR.map(([o, d]) => (
              <Link key={o + d} className="chip" to={`/results?${toSearchParams({ origin: o, destination: d, date, adults: 1 })}`}>
                {o} → {d}
              </Link>
            ))}
          </div>
        </section>
        <section className="how">
          <div><b><Icon name="search" /> 1. Search</b><span>All airlines for your route and date, cheapest first.</span></div>
          <div><b><Icon name="open_in_new" /> 2. Book on the airline</b><span>Pick a flight and finish booking on IndiGo, Air India and others.</span></div>
          <div><b><Icon name="confirmation_number" /> 3. Print your ticket</b><span>Upload the e-ticket, hide what you don't want printed, print.</span></div>
        </section>
      </div>
    </>
  );
}
