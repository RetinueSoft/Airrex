import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { saveRecentSearch } from '../lib/recentSearches.ts';
import type { CalendarDay, FlightOffer, SearchQuery, SearchResponse } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';
import { fetchCalendar, searchFlights } from '../lib/api.ts';
import { duration, money, prettyDate, shiftDate, time, timeAgo, todayYmd } from '../lib/format.ts';
import Icon from '../components/Icon.tsx';
import SearchForm, { toSearchParams } from '../components/SearchForm.tsx';
import FlightCard from '../components/FlightCard.tsx';
import BookingModal from '../components/BookingModal.tsx';
import FlightDetails from '../components/FlightDetails.tsx';
import QuoteTray, { MAX_QUOTE_FLIGHTS } from '../components/QuoteTray.tsx';
import { useAgent } from '../lib/agent.tsx';

type Sort = 'cheapest' | 'fastest' | 'earliest' | 'best';
const TIME_SLOTS = [
  { id: 'early', label: 'Before 6 AM', from: 0, to: 6 },
  { id: 'morning', label: '6 AM – 12 PM', from: 6, to: 12 },
  { id: 'afternoon', label: '12 PM – 6 PM', from: 12, to: 18 },
  { id: 'night', label: 'After 6 PM', from: 18, to: 24 },
];
const SLOT_ICON: Record<string, string> = { early: 'wb_twilight', morning: 'wb_sunny', afternoon: 'partly_cloudy_day', night: 'nights_stay' };

function departHour(o: FlightOffer) {
  return Number(o.segments[0].departAt.slice(11, 13));
}

export default function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const query: SearchQuery = {
    origin: (params.get('from') ?? '').toUpperCase(),
    destination: (params.get('to') ?? '').toUpperCase(),
    date: params.get('date') ?? todayYmd(),
    adults: Number(params.get('adults') ?? 1),
    cabin: 'economy', // AirRex searches Economy only
  };
  const queryKey = toSearchParams(query).toString();
  // Remember the search for "Recent searches" on the search screen.
  useEffect(() => {
    saveRecentSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('cheapest');
  const [airlines, setAirlines] = useState<Set<string>>(new Set());
  const [maxStops, setMaxStops] = useState<number>(9);
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [needCheckedBag, setNeedCheckedBag] = useState(false);
  const [booking, setBooking] = useState<FlightOffer | null>(null);
  const [details, setDetails] = useState<FlightOffer | null>(null);
  // Agent quote builder: flights picked for a WhatsApp quote (cleared when the search changes).
  const { agent } = useAgent();
  const quoteMode = !!agent?.active;
  const [quoteIds, setQuoteIds] = useState<string[]>([]);
  const [quoteFees, setQuoteFees] = useState<Record<string, number>>({}); // payment fee per leg set in details
  const [quoteMarkup, setQuoteMarkup] = useState<number | undefined>(undefined); // charge set in details
  const [quoteOpenSignal, setQuoteOpenSignal] = useState(0);
  useEffect(() => {
    setQuoteIds([]);
    setQuoteFees({});
    setQuoteMarkup(undefined);
  }, [queryKey]);
  function toggleQuote(id: string) {
    setQuoteIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_QUOTE_FLIGHTS ? ids : [...ids, id]));
  }
  /** From the details screen: add with the fee/charge shown there (then show the quote bar), or remove. */
  function toggleQuoteFromDetails(o: FlightOffer, feePerLeg: number, chargePerPerson?: number) {
    if (quoteIds.includes(o.id)) {
      setQuoteIds((ids) => ids.filter((x) => x !== o.id));
      return;
    }
    if (quoteIds.length >= MAX_QUOTE_FLIGHTS) {
      window.alert(`A quote can have up to ${MAX_QUOTE_FLIGHTS} flights.`);
      return;
    }
    setQuoteIds((ids) => [...ids, o.id]);
    setQuoteFees((f) => ({ ...f, [o.id]: feePerLeg }));
    if (chargePerPerson !== undefined) setQuoteMarkup(chargePerPerson); // changed by hand in the details screen
    setQuoteOpenSignal((n) => n + 1);
    setDetails(null);
  }
  const closeBooking = useCallback(() => setBooking(null), []);
  // Escape closes the booking pop-up first; the details screen stays until closed itself.
  const closeDetails = useCallback(() => {
    if (!bookingOpenRef.current) setDetails(null);
  }, []);
  const bookingOpenRef = useRef(false);
  bookingOpenRef.current = booking !== null;
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    searchFlights(query, ctrl.signal)
      .then((d) => {
        setData(d);
        setAirlines(new Set());
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const offers = data?.offers ?? [];
  const airlineStats = useMemo(() => {
    const m = new Map<string, { name: string; min: number; currency: string; count: number }>();
    for (const o of offers) {
      const cur = m.get(o.airlineCode);
      if (!cur) m.set(o.airlineCode, { name: airlineInfo(o.airlineCode, o.airlineName).name, min: o.fare.total, currency: o.fare.currency, count: 1 });
      else {
        cur.min = Math.min(cur.min, o.fare.total);
        cur.count++;
      }
    }
    return [...m.entries()].sort((a, b) => a[1].min - b[1].min);
  }, [offers]);

  const cheapest = offers.length ? Math.min(...offers.map((o) => o.fare.total)) : 0;
  const fastest = offers.length ? Math.min(...offers.map((o) => o.durationMinutes)) : 0;

  const filtered = useMemo(
    () =>
      offers.filter(
        (o) =>
          (airlines.size === 0 || airlines.has(o.airlineCode)) &&
          o.stops <= maxStops &&
          (!needCheckedBag || o.baggage?.checkedIncluded === true) &&
          (slots.size === 0 || TIME_SLOTS.some((s) => slots.has(s.id) && departHour(o) >= s.from && departHour(o) < s.to)),
      ),
    [offers, airlines, maxStops, slots, needCheckedBag],
  );
  const comparators = useMemo<Record<Sort, (a: FlightOffer, b: FlightOffer) => number>>(() => {
    const score = (o: FlightOffer) => o.fare.total / cheapest + (o.durationMinutes / fastest) * 0.6;
    return {
      cheapest: (a, b) => a.fare.total - b.fare.total,
      fastest: (a, b) => a.durationMinutes - b.durationMinutes,
      earliest: (a, b) => a.segments[0].departAt.localeCompare(b.segments[0].departAt),
      best: (a, b) => score(a) - score(b),
    };
  }, [cheapest, fastest]);
  const visible = useMemo(() => [...filtered].sort(comparators[sort]), [filtered, comparators, sort]);

  // One-line summary under each sort tab, from the top flight that tab would show.
  const sortSummary = (s: Sort) => {
    const top = [...filtered].sort(comparators[s])[0];
    if (!top) return '–';
    const p = money(top.fare.total, top.fare.currency);
    const d = duration(top.durationMinutes);
    if (s === 'fastest') return `${d} · ${p}`;
    if (s === 'earliest') return `${time(top.segments[0].departAt)} · ${p}`;
    return `${p} · ${d}`;
  };
  const stopCount = (max: number) => offers.filter((o) => o.stops <= max).length;

  function resetFilters() {
    setAirlines(new Set());
    setMaxStops(9);
    setSlots(new Set());
    setNeedCheckedBag(false);
  }
  const filtersActive = airlines.size > 0 || maxStops !== 9 || slots.size > 0 || needCheckedBag;
  const withCheckedBag = offers.filter((o) => o.baggage?.checkedIncluded === true);
  const cheapestWithBag = withCheckedBag.length ? Math.min(...withCheckedBag.map((o) => o.fare.total)) : undefined;

  function setDate(date: string) {
    const p = new URLSearchParams(params);
    p.set('date', date);
    setParams(p);
  }

  function toggle(set: Set<string>, value: string, update: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }

  const originName = findAirport(query.origin)?.city ?? query.origin;
  const destName = findAirport(query.destination)?.city ?? query.destination;
  const dates = [-3, -2, -1, 0, 1, 2, 3].map((d) => shiftDate(query.date, d)).filter((d) => d >= todayYmd());

  // Known prices for the nearby dates (no paid searches). Refreshed after the main search finishes,
  // so the current date's live price is included.
  const [stripPrices, setStripPrices] = useState<Map<string, CalendarDay>>(new Map());
  const dateKey = dates.join(',');
  useEffect(() => {
    if (loading || !dates.length) return;
    const ctrl = new AbortController();
    fetchCalendar(query.origin, query.destination, dates[0], dates[dates.length - 1], ctrl.signal)
      .then((c) => setStripPrices(new Map(c.days.map((d) => [d.date, d]))))
      .catch(() => setStripPrices(new Map()));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, query.origin, query.destination, loading]);
  const stripKnown = dates.map((d) => stripPrices.get(d)?.price).filter((p): p is number => p !== undefined);
  const stripMin = stripKnown.length > 1 ? Math.min(...stripKnown) : undefined;

  return (
    <div className="results-page">
      <section className="search-band">
        <div className="band-inner">
          <SearchForm key={queryKey} initial={query} />
        </div>
      </section>

      <div className="content">
        <section className="date-strip-row" aria-label="Flexible date fares">
          <div className="date-strip" role="tablist" aria-label="Change date">
            {dates.map((d) => {
              const day = stripPrices.get(d);
              const lowest = day?.price !== undefined && day.price === stripMin;
              return (
                <button
                  key={d}
                  role="tab"
                  aria-selected={d === query.date}
                  className={`date-pill ${d === query.date ? 'active' : ''} ${lowest ? 'lowest' : ''}`}
                  onClick={() => setDate(d)}
                  title={day?.price !== undefined ? `${day.source === 'estimate' ? 'About' : 'From'} ${money(day.price, 'INR')} per adult` : 'Price not known yet'}
                >
                  <span className="pill-date">{prettyDate(d)}</span>
                  <span className="strip-price">
                    {day?.price !== undefined ? `${day.source === 'estimate' ? '≈' : ''}${money(day.price, 'INR')}` : '–'}
                  </span>
                </button>
              );
            })}
          </div>
          <Link
            className="btn tonal cal-link"
            to={`/cheapest-dates?${new URLSearchParams({ from: query.origin, to: query.destination, start: query.date < todayYmd() ? todayYmd() : query.date, end: shiftDate(query.date, 29), adults: String(query.adults) })}`}
          >
            <Icon name="calendar_month" /> Cheapest dates
          </Link>
        </section>

        <div className="results-layout">
          <aside className={`filters ${showFilters ? 'open' : ''}`} aria-label="Flight filters">
            <div className="filters-head">
              <h2>Filters</h2>
              <button type="button" className="link-btn" onClick={resetFilters} disabled={!filtersActive}>Reset all</button>
            </div>

            <fieldset>
              <legend>Stops</legend>
              {([
                [9, 'Any'],
                [0, 'Non-stop only'],
                [1, 'Up to 1 stop'],
              ] as const).map(([v, l]) => (
                <label key={v} className="check">
                  <input type="radio" name="stops" checked={maxStops === v} onChange={() => setMaxStops(v)} />
                  <span className="grow">{l}</span>
                  <span className="count">{stopCount(v)}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Baggage</legend>
              <label className="check top">
                <input type="checkbox" checked={needCheckedBag} onChange={(e) => setNeedCheckedBag(e.target.checked)} />
                <span className="grow">
                  Check-in bag included
                  <span className="hint-text">Hides "cabin bag only" fares and fares where the check-in bag isn't stated.</span>
                </span>
                {cheapestWithBag !== undefined && <span className="count">{money(cheapestWithBag, offers[0].fare.currency)}</span>}
              </label>
            </fieldset>

            <fieldset>
              <legend>Airlines</legend>
              {airlineStats.map(([code, s]) => (
                <label key={code} className="check">
                  <input type="checkbox" checked={airlines.has(code)} onChange={() => toggle(airlines, code, setAirlines)} />
                  <span className="grow">{s.name}</span>
                  <span className="count">{money(s.min, s.currency)}</span>
                </label>
              ))}
            </fieldset>

            <fieldset>
              <legend>Departure time</legend>
              <div className="time-tiles">
                {TIME_SLOTS.map((s) => (
                  <label key={s.id} className={`time-tile ${slots.has(s.id) ? 'on' : ''}`}>
                    <input type="checkbox" className="sr-only" checked={slots.has(s.id)} onChange={() => toggle(slots, s.id, setSlots)} />
                    <Icon name={SLOT_ICON[s.id]} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </aside>

          <section className="results">
            <div className="results-toolbar">
              <div>
                <h1 className="route-title">{originName} → {destName}</h1>
                <p className="muted">
                  {prettyDate(query.date)} · {loading ? 'Searching…' : `Showing ${visible.length} of ${offers.length} flights`}
                </p>
                {data && !loading && !data.isDemoData && (
                  <p className="muted small-text">
                    Prices checked {timeAgo(data.fetchedAt)} · final price on the airline's site may vary slightly
                  </p>
                )}
              </div>
              <div className="toolbar-right">
                {data?.isDemoData && (
                  <span className="pill pill-warn notice-pill">
                    <Icon name="info" size={16} />
                    {data.notice ?? <span>Showing <b>demo fares</b>. Add a SerpApi key for live prices.</span>}
                  </span>
                )}
                <button className="btn filters-toggle" onClick={() => setShowFilters(!showFilters)}>
                  <Icon name="tune" /> {showFilters ? 'Close filters' : 'Filters'}
                </button>
              </div>
            </div>

            <div className="sort-tabs" role="tablist" aria-label="Sort flights">
              {(['cheapest', 'best', 'fastest', 'earliest'] as Sort[]).map((s) => (
                <button key={s} role="tab" aria-selected={sort === s} className={sort === s ? 'active' : ''} onClick={() => setSort(s)}>
                  <span className="tab-label">{s[0].toUpperCase() + s.slice(1)}</span>
                  <span className="tab-sub">{sortSummary(s)}</span>
                </button>
              ))}
            </div>

          {error && (
            <div className="error-box">
              {error} <Link to="/">New search</Link>
            </div>
          )}
          {loading && !data && <div className="skeletons">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>}
          {!loading && !error && visible.length === 0 && <div className="empty">No flights match these filters.</div>}

            <div className={`flight-list ${loading ? 'dim' : ''}`}>
              {visible.map((o) => {
                const tags: string[] = [];
                if (o.fare.total === cheapest) tags.push('Cheapest');
                if (o.durationMinutes === fastest) tags.push('Fastest');
                return (
                  <FlightCard
                    key={o.id}
                    offer={o}
                    tags={tags}
                    onBook={() => setBooking(o)}
                    onDetails={() => setDetails(o)}
                    inQuote={quoteIds.includes(o.id)}
                    onToggleQuote={quoteMode ? () => toggleQuote(o.id) : undefined}
                  />
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {quoteMode && agent && (
        <QuoteTray
          key={queryKey /* a new search starts a new quote */}
          agent={agent}
          query={query}
          flights={quoteIds.map((id) => offers.find((o) => o.id === id)).filter((o): o is FlightOffer => !!o)}
          onRemove={(id) => setQuoteIds((ids) => ids.filter((x) => x !== id))}
          onClear={() => setQuoteIds([])}
          feeOverrides={quoteFees}
          markupOverride={quoteMarkup}
          openSignal={quoteOpenSignal}
        />
      )}
      {details && (
        <FlightDetails
          offer={details}
          query={query}
          onClose={closeDetails}
          onBook={() => setBooking(details)}
          inQuote={quoteIds.includes(details.id)}
          onToggleQuote={quoteMode ? (fee, charge) => toggleQuoteFromDetails(details, fee, charge) : undefined}
        />
      )}
      {booking && <BookingModal offer={booking} query={query} onClose={closeBooking} />}
    </div>
  );
}
