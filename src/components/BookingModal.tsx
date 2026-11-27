import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BookingOption, FlightOffer, SearchQuery } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';
import { CABIN_LABEL, money, prettyDate, time } from '../lib/format.ts';
import { saveTrip } from '../lib/trips.ts';
import { fetchBookingOptions, openBookingOption } from '../lib/api.ts';
import { baggageSummary } from '../../shared/baggage.ts';
import TripPassengers from './TripPassengers.tsx';
import FareReport from './FareReport.tsx';
import { helperTrip, sendTripToHelper, updateHelperPassengers, useHelper } from '../lib/helper.ts';
import { tripPassengers } from '../lib/tripPassengers.ts';
import type { PassengerDetails } from '../../shared/types.ts';

export default function BookingModal({ offer, query, onClose }: { offer: FlightOffer; query: SearchQuery; onClose: () => void }) {
  const airline = airlineInfo(offer.airlineCode, offer.airlineName);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const helper = useHelper();
  const [options, setOptions] = useState<BookingOption[] | null>(null);
  const [optionsError, setOptionsError] = useState('');
  /** True while asking SerpApi for links (costs one search). */
  const [fetching, setFetching] = useState(false);
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  const fallbackUrl = offer.bookingUrl ?? airline.bookingUrl;

  const summary = [
    `${findAirport(query.origin)?.city ?? query.origin} (${query.origin}) → ${findAirport(query.destination)?.city ?? query.destination} (${query.destination})`,
    `${prettyDate(query.date)} · ${offer.segments.map((s) => s.flightNumber).join(' + ')} · dep ${time(first.departAt)} arr ${time(last.arriveAt)}`,
    `${query.adults} adult${query.adults > 1 ? 's' : ''} · ${CABIN_LABEL[query.cabin]} · ${money(offer.fare.total, offer.fare.currency)}` +
      (query.adults > 1 && offer.fare.perPerson !== undefined ? ` (${money(offer.fare.perPerson, offer.fare.currency)} each, est.)` : ''),
  ].join('\n');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Show booking links only if they are already saved: opening the pop-up must not spend a SerpApi search.
  const [checkedCache, setCheckedCache] = useState(!offer.bookingToken);
  useEffect(() => {
    if (!offer.bookingToken) return;
    const ctrl = new AbortController();
    fetchBookingOptions(offer.bookingToken, query, ctrl.signal, true)
      .then((o) => o && setOptions(o))
      .catch(() => {})
      .finally(() => !ctrl.signal.aborted && setCheckedCache(true));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.bookingToken]);

  /** Fetch the direct booking links for this flight (uses one SerpApi search; saved for 3 hours). */
  async function findLinks() {
    if (!offer.bookingToken) return;
    setFetching(true);
    setOptionsError('');
    try {
      setOptions(await fetchBookingOptions(offer.bookingToken, query));
    } catch (e) {
      setOptionsError(e instanceof Error ? e.message : 'Could not load booking links');
    } finally {
      setFetching(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function markOpened() {
    saveTrip(query, offer);
    setOpened(true);
    // AirRex Helper (browser extension): fills the airline's passenger form and records its prices.
    sendTripToHelper(helperTrip(query, offer, tripPassengers(query)));
  }

  /** Passengers added after continuing to the airline: update the helper too. */
  function onPassengersChange(list: PassengerDetails[]) {
    updateHelperPassengers(helperTrip(query, offer, list));
  }

  function goToAirlineHome() {
    markOpened();
    window.open(fallbackUrl, '_blank', 'noopener');
  }

  function book(opt: BookingOption) {
    if (openBookingOption(opt)) markOpened();
  }

  function priceLabel(o: BookingOption) {
    if (o.price === undefined) return '';
    if (query.adults > 1 && o.perPerson !== undefined) return `${money(o.price, o.currency)} (${money(o.perPerson, o.currency)} each)`;
    return money(o.price, o.currency);
  }

  // AirRex sends people to the airline's own website only, never to other booking sites.
  const airlineOptions = options?.filter((o) => o.isAirline && o.url) ?? [];
  const loadingOptions = fetching || !checkedCache;
  const canFindLinks = !!offer.bookingToken && options === null && checkedCache && !fetching;

  return (
    // Clicking outside doesn't close it (passenger details being added would be lost): use × or Esc.
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="book-title">Book on {airline.name}</h2>
        <p className="muted">
          You'll complete booking and payment on the airline's website. AirRex never sees your payment details.
        </p>
        <pre className="trip-summary">{summary}</pre>

        {query.adults > 1 && (
          <p className="hint warn">
            Select <b>{query.adults} adults</b> on the airline's website. The link opens with 1 passenger, and prices here
            are estimated as the 1-adult fare × {query.adults}.
          </p>
        )}

        {fetching && <p className="muted">Finding the booking link for this flight…</p>}

        {canFindLinks && (
          <button className="book-option" onClick={findLinks}>
            <span>
              <b>Get the direct link for this flight</b>
              <span className="muted"> · opens this flight on {airline.name}'s own website</span>
            </span>
            <span>→</span>
          </button>
        )}

        {airlineOptions.length > 0 && (
          <div className="book-options">
            {airlineOptions.map((o, i) => (
              <button key={i} className="book-option primary" onClick={() => book(o)}>
                <span>
                  <b>Book on {o.bookWith}</b>
                  {o.optionTitle && <span className="muted"> · {o.optionTitle}</span>}
                  {o.baggage && <span className="option-bags">{baggageSummary(o.baggage).label}</span>}
                </span>
                <span>{priceLabel(o)} ↗</span>
              </button>
            ))}
          </div>
        )}

        {!loadingOptions && airlineOptions.length === 0 && (
          <p className="hint">
            {optionsError ? 'A direct link for this flight isn\'t available right now. ' : ''}
            On the airline site, search the same route and date and pick flight{' '}
            <b>{offer.segments.map((s) => s.flightNumber).join(' + ')}</b>. The airline's price is final and may differ slightly.
          </p>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy flight details'}</button>
          <button className={`btn ${airlineOptions.length ? '' : 'primary'}`} onClick={goToAirlineHome}>
            {airlineOptions.length ? `${airline.name} homepage ↗` : `Continue to ${airline.name} ↗`}
          </button>
        </div>
        <TripPassengers query={query} onChange={onPassengersChange} />
        {helper ? (
          <p className="hint ok helper-note">
            ✓ AirRex Helper is on. After you continue, tap a passenger's name in the AirRex panel on {airline.name}'s
            passenger page to fill the form.
          </p>
        ) : (
          <p className="muted small-text helper-note">
            On a computer? <Link to="/helper">Install AirRex Helper</Link> to fill passenger details on the airline site
            automatically.
          </p>
        )}

        {opened && (
          <>
            <p className="hint ok">
              Saved to <Link to="/trips">My trips</Link>. After booking, download your e-ticket and use{' '}
              <Link to="/print">Print ticket</Link> to hide details and print it.
            </p>
            <details className="trip-report">
              <summary>Booked? Tell us what {airline.name} charged</summary>
              <FareReport offer={offer} query={query} />
            </details>
          </>
        )}
      </div>
    </div>
  );
}
