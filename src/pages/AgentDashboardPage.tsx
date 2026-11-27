import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { AgentProfile, SavedQuote } from '../../shared/types.ts';
import { daysLeft, onTrial, quotesApi, useAgent } from '../lib/agent.tsx';
import { quoteText, whatsappLink } from '../lib/quote.ts';
import { findAirport } from '../../shared/airports.ts';
import { prettyDate } from '../lib/format.ts';
import { toSearchParams } from '../components/SearchForm.tsx';
import { AgencyFooter, AgencyHeader } from '../components/AgencyBrand.tsx';
import Icon from '../components/Icon.tsx';
import { chargeRule, defaultCharge } from '../lib/charges.ts';

const EXAMPLE_FARE = 10000;
const EXAMPLE_FARES = [5000, 10000, 30000];
import { PLAN_PRICE, SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '../lib/config.ts';

const FEE_AIRLINES = [
  ['6E', 'IndiGo'],
  ['AI', 'Air India'],
  ['IX', 'Air India Express'],
  ['QP', 'Akasa Air'],
  ['SG', 'SpiceJet'],
] as const;

/** Shrink an uploaded logo so it stays small (max 480×200) and save as PNG or WebP, whichever is smaller. */
async function logoToDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Please choose a PNG, JPG or WebP image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const scale = Math.min(1, 480 / img.naturalWidth, 200 / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const webp = canvas.toDataURL('image/webp', 0.9);
    const best = webp.startsWith('data:image/webp') && webp.length < png.length ? webp : png;
    if (best.length > 400_000) throw new Error('Logo is too detailed. Please use a simpler or smaller image.');
    return best;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PlanBanner({ agent }: { agent: AgentProfile }) {
  const left = daysLeft(agent);
  const renew = SUPPORT_WHATSAPP
    ? whatsappLink(`Hi, I'd like to renew AirRex for ${agent.agencyName} (${agent.email}).`, SUPPORT_WHATSAPP)
    : SUPPORT_EMAIL
      ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('AirRex renewal')}`
      : undefined;
  if (!agent.active) {
    return (
      <div className="plan-banner expired">
        <Icon name="error" size={22} />
        <div className="grow"><b>Your plan has ended.</b> Quotes and branded printing are paused. Renew for {PLAN_PRICE} to continue.</div>
        {renew && <a className="btn primary" href={renew} target="_blank" rel="noopener noreferrer">Renew now</a>}
      </div>
    );
  }
  return (
    <div className={`plan-banner ${left <= 5 ? 'soon' : ''}`}>
      <Icon name={onTrial(agent) ? 'hourglass_top' : 'verified'} size={22} />
      <div className="grow">
        {onTrial(agent) ? <><b>Free trial:</b> {left} day{left === 1 ? '' : 's'} left. After that {PLAN_PRICE}.</> : <><b>Active plan</b> · renews in {left} day{left === 1 ? '' : 's'}</>}
      </div>
      {renew && left <= 7 && <a className="btn" href={renew} target="_blank" rel="noopener noreferrer">Pay / renew</a>}
    </div>
  );
}

export default function AgentDashboardPage() {
  const { agent, loading, saveProfile, logout, changePassword } = useAgent();
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [quotes, setQuotes] = useState<SavedQuote[] | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    if (agent) setDraft(agent);
  }, [agent]);
  useEffect(() => {
    if (agent) quotesApi.list().then(setQuotes).catch(() => setQuotes([]));
  }, [agent?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="page muted">Loading…</p>;
  if (!agent) return <Navigate to="/agent/login" replace />;
  if (!draft) return null;

  const set = (k: keyof AgentProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [k]: k === 'defaultMarkup' ? Math.max(0, Math.round(Number(e.target.value) || 0)) : e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await saveProfile(draft!);
      setSaved('Saved ✓');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  }

  async function onLogo(file?: File) {
    if (!file) return;
    try {
      setDraft({ ...draft!, logo: await logoToDataUrl(file) });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that image');
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      setPwMsg('Password changed ✓ Other devices have been signed out.');
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : 'Could not change password');
    }
  }

  return (
    <div className="page agent-dash">
      <div className="dash-head">
        <div>
          <h1>{agent.agencyName}</h1>
          <p className="muted">{agent.email}</p>
        </div>
        <button className="btn" onClick={logout}><Icon name="logout" /> Log out</button>
      </div>

      <PlanBanner agent={agent} />

      <div className="quick-actions">
        <Link to="/" className="action-tile"><Icon name="travel_explore" size={26} /><b>Search &amp; quote</b><span>Find flights, tap "Add to quote", send on WhatsApp</span></Link>
        <Link to="/print" className="action-tile"><Icon name="confirmation_number" size={26} /><b>Print branded ticket</b><span>Upload e-ticket, auto-hide fare, print with your logo</span></Link>
        <Link to="/agent/quotes" className="action-tile"><Icon name="forum" size={26} /><b>Saved quotes{quotes ? ` (${quotes.length})` : ''}</b><span>View, resend or update quotes you sent to customers</span></Link>
        <Link to="/agent/passengers" className="action-tile"><Icon name="badge" size={26} /><b>Saved passengers</b><span>Scan passports once, copy details into airline forms</span></Link>
        <Link to="/cheapest-dates" className="action-tile"><Icon name="calendar_month" size={26} /><b>Cheapest dates</b><span>Find the cheapest day for a flexible customer</span></Link>
      </div>

      <div className="dash-grid">
        <form className="dash-card" onSubmit={save}>
          <h2>Agency profile &amp; branding</h2>
          <p className="muted small-text">Shown on printed tickets and WhatsApp quotes.</p>
          <div className="logo-row">
            {draft.logo ? <img src={draft.logo} alt="Agency logo" className="logo-preview" /> : <span className="logo-empty"><Icon name="add_photo_alternate" size={28} /></span>}
            <label className="btn file-btn">
              {draft.logo ? 'Change logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {draft.logo && <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, logo: '' })}>Remove</button>}
          </div>
          <div className="field-row">
            <label className="field"><span>Agency name</span><input value={draft.agencyName} onChange={set('agencyName')} required maxLength={120} /></label>
            <label className="field"><span>Contact person</span><input value={draft.contactName} onChange={set('contactName')} maxLength={120} /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Phone</span><input value={draft.phone} onChange={set('phone')} maxLength={20} inputMode="tel" /></label>
            <label className="field"><span>WhatsApp</span><input value={draft.whatsapp} onChange={set('whatsapp')} maxLength={20} inputMode="tel" /></label>
          </div>
          <label className="field"><span>Address</span><input value={draft.address} onChange={set('address')} maxLength={300} /></label>
          <div className="field-row">
            <label className="field"><span>City</span><input value={draft.city} onChange={set('city')} maxLength={80} /></label>
            <label className="field"><span>GSTIN (optional)</span><input value={draft.gstin} onChange={set('gstin')} maxLength={15} /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Website (optional)</span><input value={draft.website} onChange={set('website')} maxLength={200} /></label>
            <label className="field color-field"><span>Brand colour</span><input type="color" value={draft.brandColor} onChange={set('brandColor')} /></label>
          </div>
          <label className="field"><span>Ticket footer text</span>
            <textarea value={draft.ticketFooter} onChange={set('ticketFooter')} maxLength={400} rows={2} placeholder="e.g. Thank you for booking with us! Carry a photo ID. Report 2 hours before departure." />
          </label>
          <fieldset className="charge-settings">
            <legend>Default service charge per passenger</legend>
            <div className="field-row">
              <label className="field">
                <span>Charge as</span>
                <select value={draft.markupMode} onChange={(e) => setDraft({ ...draft, markupMode: e.target.value as AgentProfile['markupMode'] })}>
                  <option value="fixed">Fixed amount (₹)</option>
                  <option value="percent">% of the fare</option>
                  <option value="higher">₹ or %, whichever is higher</option>
                  <option value="lower">₹ or %, whichever is lower</option>
                  <option value="range">% with lower &amp; upper limit</option>
                </select>
              </label>
              {draft.markupMode !== 'fixed' && (
                <label className="field"><span>Percent of fare (%)</span>
                  <input type="number" min={0} max={50} step={0.5} value={draft.markupPercent}
                    onChange={(e) => setDraft({ ...draft, markupPercent: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} />
                </label>
              )}
              {draft.markupMode !== 'percent' && (
                <label className="field"><span>{draft.markupMode === 'range' ? 'Lower limit (₹)' : 'Amount (₹)'}</span>
                  <input type="number" min={0} step={50} value={draft.defaultMarkup} onChange={set('defaultMarkup')} />
                </label>
              )}
              {draft.markupMode === 'range' && (
                <label className="field"><span>Upper limit (₹)</span>
                  <input type="number" min={0} step={50} value={draft.markupMax}
                    onChange={(e) => setDraft({ ...draft, markupMax: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                </label>
              )}
            </div>
            <span className="hint-text">
              {chargeRule(draft)}. e.g.{' '}
              {EXAMPLE_FARES.map((f) => `₹${defaultCharge(draft, f).toLocaleString('en-IN')} on a ₹${f.toLocaleString('en-IN')} fare`).join(', ')}{' '}
              (per passenger).
              You can still change it for any flight or quote.
            </span>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={draft.gstOnCharge} onChange={(e) => setDraft({ ...draft, gstOnCharge: e.target.checked })} />
            <span className="grow">
              Add 18% GST on my service charge
              <span className="hint-text">
                e.g. ₹{defaultCharge(draft, EXAMPLE_FARE)} charge + ₹{Math.round(defaultCharge(draft, EXAMPLE_FARE) * 0.18)} GST = ₹{defaultCharge(draft, EXAMPLE_FARE) + Math.round(defaultCharge(draft, EXAMPLE_FARE) * 0.18)} per passenger. Check the correct rate with your CA.
              </span>
            </span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn primary" type="submit">Save profile</button>
            {saved && <span className="saved-msg">{saved}</span>}
          </div>
        </form>

        <div className="dash-side">
          <div className="dash-card">
            <h2>Ticket preview</h2>
            <p className="muted small-text">This header and footer are added to tickets you print.</p>
            <div className="ticket-preview">
              <AgencyHeader agent={draft} />
              <div className="ticket-preview-body">
                <span /><span /><span className="short" /><span /><span className="short" />
              </div>
              <AgencyFooter agent={draft} />
            </div>
          </div>

          <div className="dash-card">
            <div className="card-head-row">
              <h2>Recent quotes</h2>
              {quotes && quotes.length > 0 && <Link to="/agent/quotes" className="link-btn">View all {quotes.length} <Icon name="chevron_right" size={16} /></Link>}
            </div>
            {quotes === null && <p className="muted">Loading…</p>}
            {quotes?.length === 0 && <p className="muted">No quotes yet. Search flights and tap <b>Add to quote</b>.</p>}
            <ul className="quote-list">
              {quotes?.slice(0, 3).map((q) => (
                <li key={q.id}>
                  <Link to={`/agent/quotes/${q.id}`} className="grow quote-list-link">
                    <b>{q.customerName || 'Customer'}</b>
                    {q.status === 'draft' && <span className="pill pill-warn status-pill">Draft</span>} · {findAirport(q.data.origin)?.city ?? q.data.origin} → {findAirport(q.data.destination)?.city ?? q.data.destination}
                    <div className="muted small-text">
                      {prettyDate(q.data.date)} · {q.data.flights.length} option{q.data.flights.length === 1 ? '' : 's'} · sent {new Date(q.createdAt).toLocaleDateString()}
                    </div>
                  </Link>
                  <a className="btn tonal" href={whatsappLink(quoteText(q.data, agent, q.customerName), q.customerPhone)} target="_blank" rel="noopener noreferrer" title="Resend on WhatsApp">
                    <Icon name="send" />
                  </a>
                  <Link className="btn" to={`/results?${toSearchParams({ origin: q.data.origin, destination: q.data.destination, date: q.data.date < new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : q.data.date, adults: q.data.adults })}`} title="Search again for latest prices">
                    <Icon name="refresh" />
                  </Link>
                  <button className="btn" title="Delete" onClick={async () => { await quotesApi.remove(q.id); setQuotes(quotes.filter((x) => x.id !== q.id)); }}>
                    <Icon name="delete" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <form className="dash-card" onSubmit={submitPassword}>
            <h2>Change password</h2>
            <label className="field"><span>Current password</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></label>
            <label className="field"><span>New password</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} required /></label>
            {pwMsg && <p className="muted small-text">{pwMsg}</p>}
            <div className="form-actions"><button className="btn" type="submit">Change password</button></div>
          </form>
        </div>
      </div>
    </div>
  );
}
