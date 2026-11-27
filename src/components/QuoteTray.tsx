// Bottom bar for agents: build a quote from selected flights, set the airline payment fee per flight and the
// agency service charge, then send on WhatsApp.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AgentProfile, FlightOffer, SearchQuery } from '../../shared/types.ts';
import { quotesApi } from '../lib/agent.tsx';
import { quotePerPerson, quoteText, toQuoteFlight, whatsappLink } from '../lib/quote.ts';
import { money } from '../lib/format.ts';
import Icon from './Icon.tsx';
import { agencyCharge, legs, paymentFeePerLeg } from '../lib/charges.ts';

export const MAX_QUOTE_FLIGHTS = 5;

export default function QuoteTray({
  agent,
  query,
  flights,
  onRemove,
  onClear,
  defaultOpen = false,
  onSaved,
  feeOverrides,
  markupOverride,
  openSignal,
}: {
  agent: AgentProfile;
  query: SearchQuery;
  flights: FlightOffer[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Start expanded (e.g. when opened from My trips). */
  defaultOpen?: boolean;
  /** Called after the quote is saved to the server. */
  onSaved?: () => void;
  /** Payment fee per passenger per flight leg, by offer id (set from the details screen). */
  feeOverrides?: Record<string, number>;
  /** Service charge per passenger set from the details screen; replaces the current value when it changes. */
  markupOverride?: number;
  /** Increment to expand the bar (e.g. after "Add to quote" in the details screen). */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [markup, setMarkup] = useState(markupOverride ?? agent.defaultMarkup);
  const [fees, setFees] = useState<Record<string, number>>({}); // edits made in this bar
  const [status, setStatus] = useState('');
  const previewRef = useRef<HTMLPreElement>(null);

  // ---- Saving: one quote record per bar. Saved as a draft as soon as a flight is added, updated on every
  // change, marked "sent" when sent/copied. Saves run one after another so we never create duplicates.
  const idRef = useRef<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const statusRef = useRef<'draft' | 'sent'>('draft');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (markupOverride !== undefined) setMarkup(markupOverride);
  }, [markupOverride]);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  // A value set in the details screen wins over an earlier edit in this bar.
  useEffect(() => {
    if (!feeOverrides) return;
    setFees((f) => {
      const next = { ...f };
      for (const id of Object.keys(feeOverrides)) delete next[id];
      return next;
    });
  }, [feeOverrides]);

  const feePerLeg = (o: FlightOffer) => fees[o.id] ?? feeOverrides?.[o.id] ?? paymentFeePerLeg(agent, o.airlineCode);

  // The quote stores the agency charge per person INCLUDING GST (when GST is on), so totals stay consistent.
  const c = agencyCharge(agent, markup);
  const data = {
    origin: query.origin,
    destination: query.destination,
    date: query.date,
    adults: query.adults,
    markupPerPerson: c.total,
    flights: flights.map((o) => toQuoteFlight(o, agent, feePerLeg(o))),
  };
  const payloadKey = JSON.stringify([customerName, customerPhone, data]);

  function persist(nextStatus: 'draft' | 'sent'): Promise<boolean> {
    const body = { customerName, customerPhone, data, status: nextStatus };
    pendingRef.current = false;
    setSaveState('saving');
    const run = async () => {
      if (idRef.current) await quotesApi.update(idRef.current, body);
      else {
        idRef.current = (await quotesApi.save(body)).id;
        setSavedId(idRef.current);
      }
      statusRef.current = nextStatus;
    };
    const p = queueRef.current.then(run, run);
    queueRef.current = p.catch(() => {});
    return p.then(
      () => {
        setSaveState('saved');
        onSaved?.();
        return true;
      },
      (err) => {
        setSaveState('error');
        setStatus(err instanceof Error ? err.message : 'Could not save the quote');
        return false;
      },
    );
  }
  flushRef.current = () => {
    if (pendingRef.current && flights.length) void persist(statusRef.current);
  };

  // Auto-save: immediately for the first flight (so it shows in the quotes list), then shortly after each edit.
  useEffect(() => {
    if (!flights.length) return;
    pendingRef.current = true;
    const t = setTimeout(() => void persist(statusRef.current), idRef.current ? 700 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);
  // Save any last edit when the bar goes away (e.g. the agent opens My trips).
  useEffect(() => () => flushRef.current(), []);

  if (!flights.length) return null;

  const text = quoteText(data, agent, customerName);
  const cheapestTotal = Math.min(...data.flights.map((f) => quotePerPerson(f, c.total) * query.adults));

  async function sendWhatsApp() {
    // Open the window first (inside the click) so pop-up blockers allow it, then save in the background.
    window.open(whatsappLink(text, customerPhone), '_blank', 'noopener');
    if (await persist('sent')) setStatus('Sent and saved to your quotes ✓');
  }

  async function clear() {
    // A draft that was never sent is thrown away; a sent quote stays in the list.
    const id = idRef.current;
    pendingRef.current = false;
    await queueRef.current;
    if (id && statusRef.current === 'draft') {
      await quotesApi.remove(id).catch(() => {});
      onSaved?.();
    }
    // Start fresh: the next flight added begins a NEW quote (never overwrite the one just sent).
    idRef.current = null;
    setSavedId(null);
    statusRef.current = 'draft';
    setSaveState('idle');
    setCustomerName('');
    setCustomerPhone('');
    setFees({});
    setStatus('');
    onClear();
  }

  async function copy() {
    const saved = await persist('sent');
    try {
      await navigator.clipboard.writeText(text);
      if (saved) setStatus('Copied and saved ✓');
    } catch {
      // Clipboard blocked (old browser / permissions): select the preview so the agent can copy by hand.
      const pre = previewRef.current;
      if (pre) window.getSelection()?.selectAllChildren(pre);
      setStatus(saved ? 'Saved ✓ Text selected: press Ctrl+C (or long-press → Copy).' : 'Text selected: press Ctrl+C to copy.');
    }
  }

  return (
    <div className={`quote-tray ${open ? 'open' : ''}`} role="region" aria-label="Quote builder">
      <button className="quote-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chat" size={20} />
        <span className="grow">
          <b>Quote: {flights.length} flight{flights.length > 1 ? 's' : ''}</b>
          <span className="muted"> · from {money(cheapestTotal, data.flights[0].currency)} incl. fees &amp; your charge</span>
        </span>
        <span className={`save-state ${saveState}`}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && (statusRef.current === 'sent' ? '✓ Sent' : '✓ Draft saved')}
          {saveState === 'error' && 'Not saved'}
        </span>
        <span className="quote-bar-cta">{open ? 'Hide' : 'Send quote'} <Icon name={open ? 'expand_more' : 'expand_less'} /></span>
      </button>

      {open && (
        <div className="quote-body">
          <div className="quote-form">
            <div className="field-row">
              <label className="field"><span>Customer name</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} placeholder="e.g. Ravi Kumar" />
              </label>
              <label className="field"><span>Customer WhatsApp</span>
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="10-digit mobile" />
              </label>
              <label className="field small"><span>Your charge / person (₹)</span>
                <input type="number" min={0} step={50} value={markup} onChange={(e) => setMarkup(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                {c.gst > 0 && <span className="hint-text">+ 18% GST ₹{c.gst} = ₹{c.total} per person</span>}
              </label>
            </div>
            <ul className="quote-items">
              {flights.map((f, i) => {
                const q = data.flights[i];
                const n = legs(f);
                return (
                  <li key={f.id}>
                    <span className="qi-main">
                      <span>{i + 1}) <b>{q.airline}</b> {q.flightNumbers}</span>
                      <span className="qi-calc muted small-text">
                        Fare {money(q.farePerPerson, q.currency)}
                        <span className="qi-fee">
                          + payment fee ₹
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={feePerLeg(f)}
                            onChange={(e) => setFees({ ...fees, [f.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                            aria-label={`Airline payment fee per passenger for ${q.airline} ${q.flightNumbers}`}
                          />
                          {n > 1 && <> × {n} flights</>}
                        </span>
                        + your {money(c.total, q.currency)} = {money(quotePerPerson(q, c.total), q.currency)}/person
                      </span>
                    </span>
                    <b>{money(quotePerPerson(q, c.total) * query.adults, q.currency)}</b>
                    <button className="link-btn" onClick={() => onRemove(f.id)} aria-label={`Remove ${q.airline} ${q.flightNumbers}`}><Icon name="close" size={16} /></button>
                  </li>
                );
              })}
            </ul>
            <div className="quote-actions">
              <button className="btn primary whatsapp" onClick={sendWhatsApp}><Icon name="send" /> Send on WhatsApp</button>
              <button className="btn" onClick={copy}><Icon name="content_copy" /> Copy text</button>
              <button className="btn" onClick={clear} title={statusRef.current === 'draft' ? 'Discard this draft' : 'Close (the sent quote stays saved)'}>
                {statusRef.current === 'draft' ? 'Discard' : 'Done'}
              </button>
              {savedId && (
                <Link className="link-btn" to={`/agent/quotes/${savedId}`}>
                  View in quotes <Icon name="chevron_right" size={16} />
                </Link>
              )}
              {status && <span className="muted small-text">{status}</span>}
            </div>
          </div>
          <pre ref={previewRef} className="quote-preview" aria-label="Message preview">{text}</pre>
        </div>
      )}
    </div>
  );
}
