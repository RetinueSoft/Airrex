import type { Baggage, FlightOffer } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { baggageSummary, extraBagLabel } from '../../shared/baggage.ts';
import { dayOffset, duration, money, time } from '../lib/format.ts';
import Icon from './Icon.tsx';
import { useAgent } from '../lib/agent.tsx';
import { customerPrice } from '../lib/charges.ts';

export function AirlineBadge({ code, name, logo }: { code: string; name: string; logo?: string }) {
  const info = airlineInfo(code, name);
  if (logo) return <img className="airline-badge logo" src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  return (
    <span className="airline-badge" style={{ background: info.color }} aria-hidden>
      {code}
    </span>
  );
}

/** Pill showing what luggage the fare includes. */
export function BaggageChip({ baggage }: { baggage?: Baggage }) {
  const { label, tone } = baggageSummary(baggage);
  const icon = tone === 'ok' ? 'luggage' : tone === 'warn' ? 'work_outline' : 'info';
  const extra = extraBagLabel(baggage, true);
  return (
    <span
      className={`pill pill-${tone}`}
      title={[extraBagLabel(baggage), ...(baggage?.notes ?? [])].filter(Boolean).join(' · ') || 'Baggage allowance not provided. Check on the airline site.'}
    >
      <Icon name={icon} size={14} /> {label}
      {extra && <span className="pill-extra"> · {extra}</span>}
    </span>
  );
}

export function airlineDisplayName(offer: FlightOffer) {
  return offer.airlineName.includes('+') ? offer.airlineName : airlineInfo(offer.airlineCode, offer.airlineName).name;
}

function departurePeriod(iso: string) {
  const h = Number(iso.slice(11, 13));
  if (h < 6) return 'Early morning departure';
  if (h < 12) return 'Morning departure';
  if (h < 18) return 'Afternoon departure';
  return 'Evening departure';
}

const TAG_ICON: Record<string, string> = { Cheapest: 'sell', Fastest: 'bolt', Best: 'star' };

export default function FlightCard({
  offer,
  tags,
  onBook,
  onDetails,
  inQuote,
  onToggleQuote,
}: {
  offer: FlightOffer;
  tags: string[];
  onBook: () => void;
  onDetails: () => void;
  /** Agent quote mode: whether this flight is in the quote being built. */
  inQuote?: boolean;
  onToggleQuote?: () => void;
}) {
  const first = offer.segments[0];
  const last = offer.segments[offer.segments.length - 1];
  const via = offer.segments.slice(0, -1).map((s) => s.destination);
  const airline = airlineInfo(offer.airlineCode, offer.airlineName);
  const group = (offer.fare.passengers ?? 1) > 1 && offer.fare.perPerson !== undefined;
  // Agents: what the customer pays (airline fare + airline payment fee + service charge/GST).
  const { agent } = useAgent();
  const cp = agent?.active ? customerPrice(offer, agent) : undefined;

  return (
    // Clicking anywhere on the card (except its buttons) opens the full-screen details.
    <article className="flight-card" onClick={onDetails}>
      <div className="card-top">
        <div className="card-tags">
          {tags.map((t) => (
            <span key={t} className={`pill ${t === 'Cheapest' ? 'pill-ok' : 'pill-info'}`}>
              <Icon name={TAG_ICON[t] ?? 'label'} size={14} /> {t}
            </span>
          ))}
          <BaggageChip baggage={offer.baggage} />
        </div>
        {offer.seatsLeft ? <span className="card-note danger">Only {offer.seatsLeft} left</span> : null}
      </div>

      <div className="flight-main">
        {/* Left: airline, then the departure note. Centre: times and route. Right: price. */}
        <div className="flight-info">
          <div className="airline">
            <AirlineBadge code={offer.airlineCode} name={offer.airlineName} logo={offer.airlineLogo} />
            <div className="airline-text">
              <h3 className="airline-name">{airlineDisplayName(offer)}</h3>
              <p className="mono muted">{offer.segments.map((s) => s.flightNumber).join(', ')}</p>
            </div>
          </div>
          <p className="card-note departure-note">
            {offer.stops ? `${offer.stops} stop layover` : departurePeriod(first.departAt)}
          </p>
        </div>

        <div className="timeline">
          <div className="t-point">
            <p className="t-time">{time(first.departAt)}</p>
            <p className="mono muted">{first.origin}</p>
          </div>
          <div className="t-line">
            <span className="muted small-text">{duration(offer.durationMinutes)}</span>
            <div className="line">
              <span className="end-dot" />
              <span className="seg-line" />
              {offer.stops === 0 ? (
                <Icon name="flight" size={16} className="plane" />
              ) : (
                via.map((v, i) => (
                  <span key={v + i} className="stop-wrap">
                    {i > 0 && <span className="seg-line" />}
                    <span className="stop-dot" title={`Layover in ${v}`} />
                  </span>
                ))
              )}
              <span className="seg-line" />
              <span className="end-dot" />
            </div>
            <span className={offer.stops ? 'stops' : 'nonstop'}>
              {offer.stops === 0 ? 'Non-stop' : `${offer.stops} stop · ${via.join(', ')}`}
            </span>
          </div>
          <div className="t-point right">
            <p className="t-time">
              {time(last.arriveAt)}
              <sup>{dayOffset(first.departAt, last.arriveAt)}</sup>
            </p>
            <p className="mono muted">{last.destination}</p>
          </div>
        </div>

        <div className="price-col">
          <div className="price-block">
            {/* Agents: airline price first, then what the customer pays (airline fare + fees + their service
                charge) as the main price, then how it's made up. */}
            {cp && cp.total > cp.airline && (
              <p className="muted small-text">Airline price {money(cp.airline, offer.fare.currency)}</p>
            )}
            <p className="price">{money(cp ? cp.total : offer.fare.total, offer.fare.currency)}</p>
            <p className="muted small-text">
              {group
                ? `${money(cp ? cp.perPerson : offer.fare.perPerson!, offer.fare.currency)} × ${offer.fare.passengers} · est. total` +
                  (offer.fare.processingFee !== undefined
                    ? ` · incl. ${money(offer.fare.processingFee, offer.fare.currency)} ${offer.fare.processingFeeKind ?? 'airline fee'}`
                    : '')
                : offer.fare.processingFee !== undefined
                  ? `incl. taxes + ${money(offer.fare.processingFee, offer.fare.currency)} ${offer.fare.processingFeeKind ?? 'airline fee'}`
                  : cp && cp.agency > 0
                    ? 'incl. taxes'
                    : 'total incl. taxes'}
              {/* Agents: their service charge from their setting (fixed ₹ / % of fare), incl. GST when on. */}
              {cp && cp.agency > 0 && ` + ${money(cp.agency, offer.fare.currency)} service charge`}
            </p>
          </div>
        </div>
      </div>
      {/* Bottom bar: details on the left, quote and book on the right. */}
      <div className="card-actions">
        <button className="link-btn" onClick={(e) => { e.stopPropagation(); onDetails(); }}>
          Flight &amp; fare details <Icon name="chevron_right" size={16} />
        </button>
        <div className="card-actions-main">
          {onToggleQuote && (
            <button
              className={`btn quote-btn ${inQuote ? 'active' : ''}`}
              aria-pressed={inQuote}
              onClick={(e) => { e.stopPropagation(); onToggleQuote(); }}
            >
              <Icon name={inQuote ? 'check_circle' : 'add_circle'} /> {inQuote ? 'In quote' : 'Add to quote'}
            </button>
          )}
          <button className="btn primary book-btn" onClick={(e) => { e.stopPropagation(); onBook(); }}>
            Book on {airline.name}
          </button>
        </div>
      </div>
    </article>
  );
}
