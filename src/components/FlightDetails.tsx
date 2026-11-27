// Full-screen view of one flight: itinerary, layovers, fare and baggage, with a sticky Book button.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAgent } from '../lib/agent.tsx';
import { chargeRule, customerPrice, defaultCharge } from '../lib/charges.ts';
import { extraBagLabel } from '../../shared/baggage.ts';
import type { Baggage, FlightOffer, SearchQuery } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';
import { dayOffset, duration, money, prettyDate, time } from '../lib/format.ts';
import { AirlineBadge, airlineDisplayName } from './FlightCard.tsx';
import Icon from './Icon.tsx';

function BaggageTable({ baggage: b }: { baggage?: Baggage }) {
  const usual = b?.typical ? ' (usual for this airline)' : '';
  const cabin =
    b?.cabinIncluded === true
      ? { text: `Included${b.cabinKg ? ` · ${b.cabinKg} kg` : ''}${usual}`, tone: 'ok' }
      : b?.cabinIncluded === false
        ? { text: 'Not included', tone: 'warn' }
        : { text: 'Usually 1 bag (about 7 kg) on Indian domestic flights. Check airline.', tone: 'unknown' };
  const checked =
    b?.checkedIncluded === true
      ? { text: `Included${b.checkInKg ? ` · ${b.checkInKg} kg` : ''}${usual}`, tone: 'ok' }
      : b?.checkedIncluded === false
        ? { text: `${b.checkedForFee ? 'Not included · available for a fee' : 'Not included'}${usual}`, tone: 'warn' }
        : { text: b?.typical ? 'Depends on the fare type. Check airline.' : 'Not stated for this fare. Check airline.', tone: 'unknown' };
  return (
    <table className="bag-table">
      <tbody>
        <tr>
          <th scope="row">🧳 Cabin / hand bag</th>
          <td className={`bag-${cabin.tone}`}>{cabin.tone === 'ok' ? '✓ ' : cabin.tone === 'warn' ? '✕ ' : ''}{cabin.text}</td>
        </tr>
        <tr>
          <th scope="row">🛄 Check-in bag</th>
          <td className={`bag-${checked.tone}`}>{checked.tone === 'ok' ? '✓ ' : checked.tone === 'warn' ? '✕ ' : ''}{checked.text}</td>
        </tr>
        <tr>
          <th scope="row">➕ Extra baggage</th>
          <td className="bag-unknown">
            {extraBagLabel(b) ? `${extraBagLabel(b)}${b?.typical ? ' · usual price' : ''}` : "Price shown on the airline's website"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function airportName(code: string) {
  const a = findAirport(code);
  return a ? `${a.city} · ${a.name}` : code;
}

export default function FlightDetails({
  offer,
  query,
  onClose,
  onBook,
  inQuote,
  onToggleQuote,
}: {
  offer: FlightOffer;
  query: SearchQuery;
  onClose: () => void;
  onBook: () => void;
  /** Agents: whether this flight is already in the quote being built. */
  inQuote?: boolean;
  /** Agents: add/remove this flight, passing the payment fee (per passenger per leg) and charge shown here. */
  /** chargePerPerson is set only when the agent changed the charge for this flight. */
  onToggleQuote?: (feePerLeg: number, chargePerPerson?: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const airline = airlineInfo(offer.airlineCode, offer.airlineName);
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  const group = (offer.fare.passengers ?? 1) > 1 && offer.fare.perPerson !== undefined;
  const { fare } = offer;
  const passengers = fare.passengers ?? query.adults;

  // Agents: their service charge on top of the airline fare (starts at the profile default, editable here).
  const { agent } = useAgent();
  const isAgent = !!agent?.active;
  const defaultChargeHere = agent ? defaultCharge(agent, fare.perPerson ?? fare.total / (fare.passengers ?? 1)) : 0;
  const [chargeInput, setChargeInput] = useState(defaultChargeHere);
  const cp = agent ? customerPrice(offer, agent, { chargePerPerson: chargeInput }) : undefined;
  const charge = cp?.charge ?? { charge: 0, gst: 0, total: 0 };
  const customerPays = cp?.total ?? fare.total;

  // Lock page scroll behind the sheet, close on Escape, focus the close button for keyboard users.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="details-screen" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <header className="details-bar">
        <button ref={closeRef} className="back-btn" onClick={onClose} aria-label="Back to results">←</button>
        <div className="details-bar-title">
          <div id="details-title">{first.origin} → {last.destination}</div>
          <div className="muted small-text">{prettyDate(query.date)} · {query.adults} adult{query.adults > 1 ? 's' : ''} · Economy</div>
        </div>
        <button className="close-x" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="details-body">
        <section className="details-card">
          <div className="airline">
            <AirlineBadge code={offer.airlineCode} name={offer.airlineName} logo={offer.airlineLogo} />
            <div className="airline-text">
              <div className="airline-name">{airlineDisplayName(offer)}</div>
              <div className="muted">{offer.segments.map((s) => s.flightNumber).join(' + ')}</div>
            </div>
          </div>
          <div className="details-summary">
            <span><b>{time(first.departAt)}</b> {first.origin}</span>
            <span className="muted">→</span>
            <span><b>{time(last.arriveAt)}<sup>{dayOffset(first.departAt, last.arriveAt)}</sup></b> {last.destination}</span>
            <span className="muted">·</span>
            <span>{duration(offer.durationMinutes)}</span>
            <span className={offer.stops ? 'stops' : 'nonstop'}>{offer.stops === 0 ? 'Non-stop' : `${offer.stops} stop`}</span>
          </div>
        </section>

        <section className="details-card">
          <h2>Itinerary</h2>
          <ol className="itinerary">
            {offer.segments.map((s, i) => (
              <li key={i}>
                <div className="leg">
                  <div className="leg-rail" aria-hidden><span className="leg-dot" /><span className="leg-track" /><span className="leg-dot" /></div>
                  <div className="leg-stops">
                    <div className="leg-point">
                      <span className="leg-time">{time(s.departAt)}</span>
                      <span><b>{s.origin}</b> <span className="muted">{airportName(s.origin)}</span></span>
                    </div>
                    <div className="leg-info muted">
                      {s.carrierName} {s.flightNumber} · {duration(s.durationMinutes)}{s.aircraft ? ` · ${s.aircraft}` : ''}
                    </div>
                    <div className="leg-point">
                      <span className="leg-time">{time(s.arriveAt)}<sup>{dayOffset(s.departAt, s.arriveAt)}</sup></span>
                      <span><b>{s.destination}</b> <span className="muted">{airportName(s.destination)}</span></span>
                    </div>
                  </div>
                </div>
                {i < offer.segments.length - 1 && (
                  <div className="layover">
                    ⏱ Layover in {findAirport(s.destination)?.city ?? s.destination}:{' '}
                    <b>{duration((Date.parse(offer.segments[i + 1].departAt + 'Z') - Date.parse(s.arriveAt + 'Z')) / 60000)}</b>
                    {offer.segments[i + 1].departAt.slice(0, 10) !== s.arriveAt.slice(0, 10) && ' · overnight'}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="details-card">
          <h2>Fare</h2>
          <table className="fare-table">
            <tbody>
              {fare.baseFare !== undefined && <tr><td>Base fare</td><td>{money(fare.baseFare, fare.currency)}</td></tr>}
              {fare.taxesAndFees !== undefined && <tr><td>Taxes & fees</td><td>{money(fare.taxesAndFees, fare.currency)}</td></tr>}
              {fare.processingFee !== undefined && (
                <tr><td>Incl. {fare.processingFeeLabel ?? 'airline processing fee'}</td><td>{money(fare.processingFee, fare.currency)}</td></tr>
              )}
              {group && <tr><td>Per adult (incl. taxes)</td><td>{money(fare.perPerson!, fare.currency)}</td></tr>}
              <tr className={isAgent ? 'subtotal' : 'total'}>
                <td>
                  {isAgent ? 'Airline fare (incl. taxes)' : group ? `Est. total, ${fare.passengers} adults` : 'You pay (incl. taxes)'}
                  {isAgent && group && <span className="muted"> · {fare.passengers} adults</span>}
                </td>
                <td>{money(fare.total, fare.currency)}</td>
              </tr>
              {isAgent && cp && (
                <>
                  <tr className="agency-row">
                    <td>
                      <label className="charge-edit">
                        Agency service charge
                        <span className="charge-input">
                          ₹<input
                            type="number"
                            min={0}
                            step={50}
                            value={chargeInput}
                            onChange={(e) => setChargeInput(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                            aria-label="Agency service charge per passenger"
                          />
                          × {passengers}
                        </span>
                      </label>
                    </td>
                    <td>{money(charge.charge * passengers, fare.currency)}</td>
                  </tr>
                  {charge.gst > 0 && (
                    <tr className="agency-row">
                      <td>GST 18% on service charge</td>
                      <td>{money(charge.gst * passengers, fare.currency)}</td>
                    </tr>
                  )}
                  <tr className="total customer-total">
                    <td>Customer pays{passengers > 1 && <span className="muted"> · {money(customerPays / passengers, fare.currency)} each</span>}</td>
                    <td>{money(customerPays, fare.currency)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          {isAgent && (
            <p className="muted small-text">
              Only you see this breakdown. Your default charge is {chargeRule(agent!)}
              {agent!.gstOnCharge ? ' (+ GST)' : ''}. <Link to="/agent">Change defaults</Link>
            </p>
          )}
          {group && (
            <p className="muted small-text">
              Group total is calculated from the 1-adult fare. The airline may charge more if fewer seats are left at this price.
            </p>
          )}
          <p className="muted small-text">The final price is shown on {airline.name}'s website and may differ slightly.</p>
        </section>

        <section className="details-card">
          <h2>Baggage</h2>
          <BaggageTable baggage={offer.baggage} />
          {offer.baggage?.checkedIncluded === false && (
            <p className="hint warn">
              This is a <b>cabin bag only</b> fare. If you need a check-in bag, add it on {airline.name}'s website. It costs
              extra, and adding it while booking is usually cheaper than at the airport.
            </p>
          )}
          {offer.baggage?.notes && offer.baggage.notes.length > 0 && (
            <p className="muted small-text">{offer.baggage.typical ? '' : 'From the airline/fare data: '}{offer.baggage.notes.join(' · ')}</p>
          )}
          {offer.baggage?.typical && (
            <p className="muted small-text">
              Google Flights doesn't list baggage for this fare, so this is {airline.name}'s usual Economy allowance.
            </p>
          )}
          <p className="muted small-text">
            Allowances can differ by fare type (e.g. Saver vs Flexi). Confirm on the airline's website before paying.
          </p>
        </section>

        {(offer.refundable !== undefined || offer.seatsLeft) && (
          <section className="details-card">
            <h2>Fare rules</h2>
            <ul className="facts">
              {offer.refundable !== undefined && <li>{offer.refundable ? '↩ Refundable (fees may apply)' : '✕ Non-refundable'}</li>}
              {offer.seatsLeft && <li className="seats-fact">Only {offer.seatsLeft} seat{offer.seatsLeft > 1 ? 's' : ''} left</li>}
            </ul>
          </section>
        )}
      </div>

      <footer className="details-footer">
        {isAgent ? (
          <div>
            <div className="price">{money(customerPays, fare.currency)}</div>
            <div className="muted small-text">
              Customer pays · airline {money(fare.total, fare.currency)}
              {cp && cp.paymentFee > 0 && <> + fee {money(cp.paymentFee, fare.currency)}</>} + your {money(charge.total * passengers, fare.currency)}
            </div>
          </div>
        ) : (
          <div>
            <div className="price">{money(fare.total, fare.currency)}</div>
            <div className="muted small-text">{group ? `${money(fare.perPerson!, fare.currency)} × ${fare.passengers} adults · est.` : 'total incl. taxes'}</div>
          </div>
        )}
        <div className="details-footer-actions">
          {isAgent && onToggleQuote && (
            <button
              className={`btn quote-btn ${inQuote ? 'active' : ''}`}
              aria-pressed={inQuote}
              onClick={() => onToggleQuote(0, chargeInput === defaultChargeHere ? undefined : chargeInput)}
              title={inQuote ? 'Remove this flight from the quote' : 'Add with the payment fee and charge shown above'}
            >
              <Icon name={inQuote ? 'check_circle' : 'add_circle'} /> {inQuote ? 'In quote · remove' : 'Add to quote'}
            </button>
          )}
          <button className={`btn ${isAgent && onToggleQuote ? '' : 'primary'}`} onClick={onBook}>Book on {airline.name}</button>
        </div>
      </footer>
    </div>
  );
}
