// Saved quotes for agents: searchable list (/agent/quotes) and a full view of one quote (/agent/quotes/:id).

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { AgentProfile, QuoteFlight, SavedQuote } from '../../shared/types.ts';
import { findAirport } from '../../shared/airports.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { quotesApi, useAgent } from '../lib/agent.tsx';
import { quotePerPerson, quoteText, whatsappLink } from '../lib/quote.ts';
import { duration, money, prettyDate, time, todayYmd } from '../lib/format.ts';
import { toSearchParams } from '../components/SearchForm.tsx';
import Icon from '../components/Icon.tsx';
import { MAX_QUOTES } from '../lib/config.ts';

const city = (c: string) => findAirport(c)?.city ?? c;

function cheapestTotal(q: SavedQuote) {
  if (!q.data.flights.length) return undefined;
  return Math.min(...q.data.flights.map((f) => quotePerPerson(f, q.data.markupPerPerson) * q.data.adults));
}

function sentOn(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function searchAgainLink(q: SavedQuote) {
  const date = q.data.date < todayYmd() ? todayYmd() : q.data.date;
  return `/results?${toSearchParams({ origin: q.data.origin, destination: q.data.destination, date, adults: q.data.adults })}`;
}

/** Airline code from a flight number like "6E 1709" or "IX 2001 + IX 2696". */
function airlineCodeOf(f: QuoteFlight) {
  return f.flightNumbers.trim().split(/\s+/)[0] ?? '';
}

/** Pick which quoted option the customer chose, then open that airline's booking page. */
function BookDialog({ q, onClose }: { q: SavedQuote; onClose: () => void }) {
  const d = q.data;
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function details(f: QuoteFlight) {
    return [
      `${city(d.origin)} (${d.origin}) → ${city(d.destination)} (${d.destination})`,
      `${prettyDate(d.date)} · ${f.airline} ${f.flightNumbers} · dep ${time(f.departAt)} arr ${time(f.arriveAt)}`,
      `${d.adults} adult${d.adults > 1 ? 's' : ''} · Economy${q.customerName ? ` · Customer: ${q.customerName}` : ''}`,
    ].join('\n');
  }

  async function copy(i: number, f: QuoteFlight) {
    try {
      await navigator.clipboard.writeText(details(f));
      setCopied(i);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal book-dialog" role="dialog" aria-modal="true" aria-labelledby="book-q-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="book-q-title">Book for {q.customerName || 'customer'}</h2>
        <p className="muted">
          {d.flights.length > 1 ? 'Choose the option the customer picked. ' : ''}
          The airline's website opens in a new tab. Search the same route and date there, pick the flight number below and
          select {d.adults} adult{d.adults > 1 ? 's' : ''}.
        </p>
        {d.date < todayYmd() && <p className="hint warn">This travel date has passed. Use "Search again" to quote a new date.</p>}
        <ul className="book-choices">
          {d.flights.map((f, i) => {
            const a = airlineInfo(airlineCodeOf(f), f.airline);
            return (
              <li key={i}>
                <div className="grow">
                  <b>{d.flights.length > 1 ? `${i + 1}) ` : ''}{f.airline}</b> <span className="mono muted">{f.flightNumbers}</span>
                  <div className="muted small-text">
                    {time(f.departAt)} {f.origin} → {time(f.arriveAt)} {f.destination} · {f.stops === 0 ? 'Non-stop' : `${f.stops} stop`} · quoted{' '}
                    {money(quotePerPerson(f, d.markupPerPerson) * d.adults, f.currency)} (airline fare then {money(f.farePerPerson * d.adults, f.currency)})
                  </div>
                </div>
                <div className="book-choice-actions">
                  <button className="btn" onClick={() => copy(i, f)}>
                    <Icon name={copied === i ? 'check' : 'content_copy'} /> {copied === i ? 'Copied' : 'Copy details'}
                  </button>
                  <a className="btn primary" href={a.bookingUrl} target="_blank" rel="noopener noreferrer">
                    Book on {a.name} <Icon name="open_in_new" size={16} />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted small-text">
          Fares change often: the airline's price today may differ from what you quoted. After booking, use <Link to="/print">Print ticket</Link> to
          print the e-ticket with your branding.
        </p>
      </div>
    </div>
  );
}

function QuoteActions({ q, agent, onDeleted }: { q: SavedQuote; agent: AgentProfile; onDeleted: () => void }) {
  const [msg, setMsg] = useState('');
  const [booking, setBooking] = useState(false);
  const text = quoteText(q.data, agent, q.customerName);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Copied ✓');
    } catch {
      const pre = document.querySelector('.quote-preview');
      if (pre) window.getSelection()?.selectAllChildren(pre);
      setMsg('Text selected: press Ctrl+C to copy.');
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the quote for ${q.customerName || 'this customer'}? This can't be undone.`)) return;
    await quotesApi.remove(q.id);
    onDeleted();
  }

  return (
    <div className="qd-actions">
      <a className="btn primary whatsapp" href={whatsappLink(text, q.customerPhone)} target="_blank" rel="noopener noreferrer">
        <Icon name="send" /> Resend on WhatsApp
      </a>
      <button className="btn" onClick={copy}><Icon name="content_copy" /> Copy text</button>
      <Link className="btn" to={searchAgainLink(q)}><Icon name="refresh" /> Search again (latest prices)</Link>
      <button className="btn primary" onClick={() => setBooking(true)} disabled={!q.data.flights.length}>
        <Icon name="flight_takeoff" /> Book
      </button>
      <button className="btn danger" onClick={remove}><Icon name="delete" /> Delete</button>
      {msg && <span className="muted small-text">{msg}</span>}
      {booking && <BookDialog q={q} onClose={() => setBooking(false)} />}
    </div>
  );
}

function QuoteDetail({ q, agent, onDeleted }: { q: SavedQuote; agent: AgentProfile; onDeleted: () => void }) {
  const d = q.data;
  const past = d.date < todayYmd();
  return (
    <div className="quote-detail">
      <div className="qd-head">
        <div>
          <h1>{q.customerName || 'Customer'}</h1>
          <p className="muted">
            {q.customerPhone && <><Icon name="call" size={16} /> {q.customerPhone} · </>}
            {q.status === 'draft' ? 'Draft, last saved' : 'Sent'} {sentOn(q.updatedAt ?? q.createdAt)}
          </p>
        </div>
        <span className="qd-pills">
          {q.status === 'draft' && <span className="pill pill-warn"><Icon name="edit_note" size={14} /> Draft (not sent yet)</span>}
          <span className={`pill ${past ? 'pill-unknown' : 'pill-ok'}`}>
            <Icon name={past ? 'history' : 'flight_takeoff'} size={14} /> {past ? 'Travel date passed' : 'Upcoming'}
          </span>
        </span>
      </div>

      <div className="qd-trip">
        <div><span className="muted small-text">Route</span><b>{city(d.origin)} → {city(d.destination)}</b></div>
        <div><span className="muted small-text">Travel date</span><b>{prettyDate(d.date)}</b></div>
        <div><span className="muted small-text">Passengers</span><b>{d.adults} adult{d.adults > 1 ? 's' : ''}</b></div>
        <div><span className="muted small-text">Your charge</span><b>{money(d.markupPerPerson, 'INR')} / person</b></div>
      </div>

      <QuoteActions q={q} agent={agent} onDeleted={onDeleted} />

      <h2>Flight options</h2>
      <div className="qd-table-wrap">
        <table className="qd-table">
          <thead>
            <tr><th>#</th><th>Flight</th><th>Timing</th><th>Baggage</th><th className="num">Airline fare</th><th className="num">Payment fee</th><th className="num">Your charge</th><th className="num">Customer pays</th></tr>
          </thead>
          <tbody>
            {d.flights.map((f, i) => {
              const per = quotePerPerson(f, d.markupPerPerson);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><b>{f.airline}</b><div className="mono muted">{f.flightNumbers}</div></td>
                  <td>
                    {time(f.departAt)} {f.origin} → {time(f.arriveAt)} {f.destination}
                    <div className="muted small-text">{duration(f.durationMinutes)} · {f.stops === 0 ? 'Non-stop' : `${f.stops} stop`}</div>
                  </td>
                  <td className="small-text">{f.baggage}</td>
                  <td className="num">{money(f.farePerPerson * d.adults, f.currency)}</td>
                  <td className="num">{f.paymentFeePerPerson ? money(f.paymentFeePerPerson * d.adults, f.currency) : '–'}</td>
                  <td className="num">{money(d.markupPerPerson * d.adults, f.currency)}</td>
                  <td className="num">
                    <b>{money(per * d.adults, f.currency)}</b>
                    {d.adults > 1 && <div className="muted small-text">{money(per, f.currency)} each</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small-text">Airline fares are as they were when the quote was sent. Use "Search again" for today's prices.</p>

      <h2>Message sent</h2>
      <pre className="quote-preview">{quoteText(d, agent, q.customerName)}</pre>
    </div>
  );
}

/** Search + filter + quote cards. Used on the Saved quotes page and the My trips "Quotes" tab. */
export function QuoteBrowser({ quotes, error }: { quotes: SavedQuote[] | null; error?: string }) {
  const [filter, setFilter] = useState('');
  const [when, setWhen] = useState<'all' | 'upcoming' | 'past'>('all');

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const today = todayYmd();
    return (quotes ?? []).filter((q) => {
      if (when === 'upcoming' && q.data.date < today) return false;
      if (when === 'past' && q.data.date >= today) return false;
      if (!f) return true;
      const hay = [q.customerName, q.customerPhone, q.data.origin, q.data.destination, city(q.data.origin), city(q.data.destination), ...q.data.flights.map((x) => `${x.airline} ${x.flightNumbers}`)]
        .join(' ')
        .toLowerCase();
      return hay.includes(f);
    });
  }, [quotes, filter, when]);
  const today = todayYmd();

  return (
    <>
      <div className="quotes-toolbar">
        <label className="search-box">
          <Icon name="search" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search customer, phone, city or flight" aria-label="Search quotes" />
        </label>
        <div className="seg" role="group" aria-label="Travel date">
          {(['all', 'upcoming', 'past'] as const).map((w) => (
            <button key={w} className={when === w ? 'active' : ''} onClick={() => setWhen(w)}>
              {w === 'all' ? 'All' : w === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {quotes === null && !error && <div className="skeletons"><div className="skeleton" /><div className="skeleton" /></div>}
      {quotes?.length === 0 && (
        <div className="empty">
          No quotes yet. Search flights, tap <b>Add to quote</b> on 2–3 options, then send on WhatsApp. <Link to="/">Search flights</Link>
        </div>
      )}
      {quotes && quotes.length > 0 && shown.length === 0 && <div className="empty">No quotes match your search.</div>}

      <ul className="quote-cards">
        {shown.map((q) => {
          const total = cheapestTotal(q);
          const past = q.data.date < today;
          return (
            <li key={q.id}>
              <Link to={`/agent/quotes/${q.id}`} className="quote-card">
                <span className="qc-avatar" aria-hidden>{(q.customerName || '?').slice(0, 1).toUpperCase()}</span>
                <span className="qc-main">
                  <b>
                    {q.customerName || 'Customer'}
                    {q.status === 'draft' && <span className="pill pill-warn status-pill">Draft</span>}
                  </b>
                  <span className="muted small-text">
                    {q.customerPhone || 'No phone'} · {q.status === 'draft' ? 'saved' : 'sent'} {sentOn(q.updatedAt ?? q.createdAt)}
                  </span>
                </span>
                <span className="qc-trip">
                  <b>{city(q.data.origin)} → {city(q.data.destination)}</b>
                  <span className="muted small-text">
                    {prettyDate(q.data.date)} · {q.data.adults} adult{q.data.adults > 1 ? 's' : ''} · {q.data.flights.length} option{q.data.flights.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="qc-price">
                  {total !== undefined && <><span className="muted small-text">from</span><b>{money(total, 'INR')}</b></>}
                  {past && <span className="pill pill-unknown">Date passed</span>}
                </span>
                <Icon name="chevron_right" className="qc-chevron" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function QuotesPage() {
  const { agent, loading } = useAgent();
  const { id } = useParams();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<SavedQuote[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!agent) return;
    quotesApi.list().then(setQuotes).catch((e) => setError(e.message));
  }, [agent?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="page muted">Loading…</p>;
  if (!agent) return <Navigate to="/agent/login" replace />;

  const selected = id ? quotes?.find((q) => String(q.id) === id) : undefined;
  const afterDelete = (qid: number) => {
    setQuotes((qs) => (qs ?? []).filter((x) => x.id !== qid));
    navigate('/agent/quotes', { replace: true });
  };

  // Detail view
  if (id) {
    return (
      <div className="page quotes-page">
        <Link to="/agent/quotes" className="back-link"><Icon name="arrow_back" /> All saved quotes</Link>
        {quotes === null && !error && <p className="muted">Loading…</p>}
        {error && <div className="error-box">{error}</div>}
        {quotes && !selected && <div className="empty">This quote was not found. It may have been deleted.</div>}
        {selected && <QuoteDetail q={selected} agent={agent} onDeleted={() => afterDelete(selected.id)} />}
      </div>
    );
  }

  // List view
  return (
    <div className="page quotes-page">
      <div className="dash-head">
        <div>
          <h1>Saved quotes</h1>
          <p className="muted">Every quote you build is saved here: drafts as soon as you add a flight, then marked sent when you send or copy it.{' '}
            Your latest {MAX_QUOTES} quotes are kept; the oldest is removed automatically when you add a new one.{' '}
            {quotes ? `${quotes.length} of ${MAX_QUOTES} used.` : ''}</p>
        </div>
        <Link to="/" className="btn primary"><Icon name="add" /> New quote</Link>
      </div>

      <QuoteBrowser quotes={quotes} error={error} />
    </div>
  );
}
