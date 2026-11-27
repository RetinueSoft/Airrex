import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SavedQuote } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { loadTrips, removeTrip, type SavedTrip } from '../lib/trips.ts';
import { money, prettyDate, time, todayYmd } from '../lib/format.ts';
import { AirlineBadge } from '../components/FlightCard.tsx';
import { quotesApi, useAgent } from '../lib/agent.tsx';
import { QuoteBrowser } from './QuotesPage.tsx';
import QuoteTray from '../components/QuoteTray.tsx';
import Icon from '../components/Icon.tsx';
import FareReport from '../components/FareReport.tsx';

function TripList({ trips, canQuote, onQuote, onRemove }: {
  trips: SavedTrip[];
  canQuote: boolean;
  onQuote: (t: SavedTrip) => void;
  onRemove: (id: string) => void;
}) {
  if (trips.length === 0) {
    return (
      <div className="empty">
        No trips yet. When you tap <b>Book on …</b> for a flight, it is saved here. <Link to="/">Search flights</Link>
      </div>
    );
  }
  const today = todayYmd();
  return <TripRows trips={trips} canQuote={canQuote} onQuote={onQuote} onRemove={onRemove} today={today} />;
}

function TripRows({ trips, canQuote, onQuote, onRemove, today }: {
  trips: SavedTrip[];
  canQuote: boolean;
  onQuote: (t: SavedTrip) => void;
  onRemove: (id: string) => void;
  today: string;
}) {
  const [reporting, setReporting] = useState<string | null>(null);
  return (
    <div className="trip-list">
      {trips.map((t) => {
        const a = airlineInfo(t.offer.airlineCode, t.offer.airlineName);
        const first = t.offer.segments[0];
        const last = t.offer.segments[t.offer.segments.length - 1];
        const past = t.query.date < today;
        return (
          <div key={t.id} className="trip-wrap">
          <div className="trip">
            <AirlineBadge code={t.offer.airlineCode} name={a.name} logo={t.offer.airlineLogo} />
            <div className="grow">
              <b>{first.origin} → {last.destination}</b> · {prettyDate(t.query.date)} · {time(first.departAt)}–{time(last.arriveAt)}
              {past && <span className="pill pill-unknown trip-pill">Date passed</span>}
              <div className="muted">
                {a.name} {t.offer.segments.map((s) => s.flightNumber).join(' + ')} · {money(t.offer.fare.total, t.offer.fare.currency)}
                {t.query.adults > 1 && ` for ${t.query.adults} adults`}
              </div>
            </div>
            <div className="trip-actions">
              {canQuote && !past && (
                <button className="btn tonal" onClick={() => onQuote(t)}>
                  <Icon name="chat" /> Send quote
                </button>
              )}
              <a className="btn" href={t.offer.bookingUrl ?? a.bookingUrl} target="_blank" rel="noopener noreferrer">Open {a.name} ↗</a>
              <Link className="btn primary" to="/print">Print ticket</Link>
              <button className="link-btn" onClick={() => setReporting(reporting === t.id ? null : t.id)}>What did you pay?</button>
              <button className="link-btn" onClick={() => onRemove(t.id)}>Remove</button>
            </div>
          </div>
          {reporting === t.id && (
            <div className="trip-report-box">
              <FareReport offer={t.offer} query={t.query} />
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}

export default function TripsPage() {
  const { agent } = useAgent();
  const [params, setParams] = useSearchParams();
  const [trips, setTrips] = useState(loadTrips);
  const [quotes, setQuotes] = useState<SavedQuote[] | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState<SavedTrip | null>(null);

  // Agents see two tabs: their trips and the quotes they sent.
  const tab = agent && params.get('tab') === 'quotes' ? 'quotes' : 'trips';
  const setTab = (t: 'trips' | 'quotes') => {
    setQuoting(null);
    setParams(t === 'quotes' ? { tab: 'quotes' } : {}, { replace: true });
  };

  const refreshQuotes = () => quotesApi.list().then(setQuotes).catch((e) => setQuoteError(e.message));
  useEffect(() => {
    if (agent) refreshQuotes();
  }, [agent?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page trips-page">
      <div className="dash-head">
        <div>
          <h1>My trips</h1>
          <p className="muted">
            {agent
              ? 'Flights you opened to book, and the quotes you sent to customers.'
              : 'Flights you continued to book on an airline website. Saved on this device only.'}
          </p>
        </div>
        {agent && tab === 'quotes' && <Link to="/" className="btn primary"><Icon name="add" /> New quote</Link>}
      </div>

      {agent && (
        <div className="page-tabs" role="tablist" aria-label="My trips sections">
          <button role="tab" aria-selected={tab === 'trips'} className={tab === 'trips' ? 'active' : ''} onClick={() => setTab('trips')}>
            <Icon name="flight" /> Trips <span className="tab-count">{trips.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'quotes'} className={tab === 'quotes' ? 'active' : ''} onClick={() => setTab('quotes')}>
            <Icon name="forum" /> Quotes <span className="tab-count">{quotes?.length ?? '…'}</span>
          </button>
        </div>
      )}

      {tab === 'trips' ? (
        <TripList
          trips={trips}
          canQuote={!!agent?.active}
          onQuote={setQuoting}
          onRemove={(id) => { removeTrip(id); setTrips(loadTrips()); }}
        />
      ) : (
        <QuoteBrowser quotes={quotes} error={quoteError} />
      )}

      {agent?.active && quoting && (
        <QuoteTray
          key={quoting.id}
          agent={agent}
          query={quoting.query}
          flights={[quoting.offer]}
          onRemove={() => setQuoting(null)}
          onClear={() => setQuoting(null)}
          onSaved={refreshQuotes}
          defaultOpen
        />
      )}
    </div>
  );
}
