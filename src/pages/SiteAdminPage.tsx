// /site-admin: the AirRex site admin ("rexl") activates agencies and sets their licence, expiry date and grace
// period. First visit after deployment: set the admin password with the one-time setup code from the server log.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PASSWORD_HINT, passwordProblem } from '../../shared/password.ts';
import Icon from '../components/Icon.tsx';

interface Agency {
  id: number;
  email: string;
  mobile: string;
  agencyName: string;
  contactName: string;
  phone: string;
  city: string;
  joined: string;
  status: 'pending' | 'active' | 'suspended';
  licence: string;
  expiresOn: string;
  graceDays: number;
  quotes: number;
  state: string;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/site-admin/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

const addDays = (days: number) => {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
};

const STATE_CLASS: Record<string, string> = {
  'Waiting for activation': 'pill-warn',
  Active: 'pill-ok',
  'In grace period': 'pill-warn',
  Expired: 'pill-unknown',
  Suspended: 'pill-unknown',
};

/** Reset an agency's password: rexl types one, or leaves it empty for a temporary one (shown once). */
function ResetPassword({ agency, onClose }: { agency: Agency; onClose: () => void }) {
  const [chosen, setChosen] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reset() {
    setError('');
    if (chosen && passwordProblem(chosen)) {
      setError(passwordProblem(chosen));
      return;
    }
    if (!confirm(`Reset the password of ${agency.agencyName}? They will be logged out everywhere.`)) return;
    setBusy(true);
    try {
      const r = await api<{ password: string }>('POST', `agencies/${agency.id}/reset-password`, { password: chosen });
      setResult(r.password);
      setChosen('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    } catch {
      /* select it by hand */
    }
  }

  return (
    <div className="reset-box">
      {result ? (
        <>
          <p>
            New password for <b>{agency.agencyName}</b> (login mobile {agency.mobile}): <code className="reset-pw">{result}</code>{' '}
            <button type="button" className="btn tonal" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </p>
          <p className="muted small-text">
            Shown only now. Send it to the agency and ask them to change it after logging in (Account → Change password).
          </p>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              <span>New password (leave empty for a temporary one)</span>
              <input value={chosen} onChange={(e) => setChosen(e.target.value)} autoComplete="off" placeholder="e.g. Travel@24" />
              <span className="hint-text">{PASSWORD_HINT}.</span>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="agency-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={reset}>{busy ? 'Resetting…' : 'Reset password'}</button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function AgencyRowEditor({ agency, onSaved }: { agency: Agency; onSaved: (a: Agency) => void }) {
  const [resetting, setResetting] = useState(false);
  const [draft, setDraft] = useState(agency);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  useEffect(() => setDraft(agency), [agency]);
  const changed =
    draft.status !== agency.status || draft.licence !== agency.licence || draft.expiresOn !== agency.expiresOn || draft.graceDays !== agency.graceDays ||
    draft.mobile !== agency.mobile;

  async function save() {
    setState('saving');
    setError('');
    try {
      const updated = await api<Agency>('PUT', `agencies/${agency.id}`, {
        status: draft.status,
        licence: draft.licence,
        expiresOn: draft.expiresOn,
        graceDays: draft.graceDays,
        mobile: draft.mobile,
      });
      onSaved(updated);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  function activate() {
    setDraft((d) => ({ ...d, status: 'active', expiresOn: d.expiresOn || addDays(30), licence: d.licence || 'Standard' }));
  }

  return (
    <div className={`agency-row ${agency.status === 'pending' ? 'pending' : ''}`}>
      <div className="agency-who">
        <b>{agency.agencyName}</b>
        <span className="muted small-text">
          {agency.contactName && `${agency.contactName} · `}
          Mobile {agency.mobile || '—'}
          {agency.email && ` · ${agency.email}`}
          {agency.city && ` · ${agency.city}`}
        </span>
        <span className="muted small-text">
          Joined {new Date(agency.joined).toLocaleDateString('en-IN')} · {agency.quotes} quote{agency.quotes === 1 ? '' : 's'}{' '}
          <span className={`pill ${STATE_CLASS[agency.state] ?? 'pill-unknown'}`}>{agency.state}</span>
        </span>
      </div>
      <div className="agency-edit field-row">
        <label className="field">
          <span>Login mobile</span>
          <input value={draft.mobile} inputMode="tel" maxLength={16} onChange={(e) => setDraft({ ...draft, mobile: e.target.value.replace(/[^0-9+ ]/g, '') })} />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Agency['status'] })}>
            <option value="pending">Waiting</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="field">
          <span>Licence</span>
          <input value={draft.licence} maxLength={60} placeholder="e.g. Standard" onChange={(e) => setDraft({ ...draft, licence: e.target.value })} />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input type="date" value={draft.expiresOn} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })} />
        </label>
        <label className="field small">
          <span>Grace days</span>
          <input type="number" min={0} max={365} value={draft.graceDays}
            onChange={(e) => setDraft({ ...draft, graceDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} />
        </label>
        <div className="agency-actions">
          {agency.status === 'pending' && draft.status === 'pending' && (
            <button type="button" className="btn tonal" onClick={activate}>Activate</button>
          )}
          <button type="button" className="btn primary" disabled={!changed || state === 'saving'} onClick={save}>
            {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {resetting ? (
        <ResetPassword agency={agency} onClose={() => setResetting(false)} />
      ) : (
        <button type="button" className="link-btn reset-link" onClick={() => setResetting(true)}>
          <Icon name="key" size={16} /> Reset password
        </button>
      )}
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (passwordProblem(next)) {
      setMsg(passwordProblem(next));
      return;
    }
    try {
      await api('POST', 'password', { currentPassword: current, newPassword: next });
      setMsg('Password changed.');
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not change');
    }
  }
  if (!open) return <button className="link-btn" onClick={() => setOpen(true)}>Change admin password</button>;
  return (
    <form className="details-card" onSubmit={submit}>
      <div className="field-row">
        <label className="field"><span>Current password</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label className="field"><span>New password</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <span className="hint-text">{PASSWORD_HINT}.</span></label>
      </div>
      {msg && <p className="muted small-text">{msg}</p>}
      <div className="form-actions">
        <button className="btn primary">Change password</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
      </div>
    </form>
  );
}

export default function SiteAdminPage() {
  const [status, setStatus] = useState<{ username: string; mobile: string; setupNeeded: boolean; loggedIn: boolean } | null>(null);
  const [agencies, setAgencies] = useState<Agency[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: '', mobile: '', password: '', confirm: '' });
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const s = await api<{ username: string; mobile: string; setupNeeded: boolean; loggedIn: boolean }>('GET', 'status');
      setStatus(s);
      if (s.loggedIn) setAgencies(await api<Agency[]>('GET', 'agencies'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (status?.setupNeeded && passwordProblem(form.password)) {
      setError(passwordProblem(form.password));
      return;
    }
    if (status?.setupNeeded && form.password !== form.confirm) {
      setError('The two passwords are different.');
      return;
    }
    setBusy(true);
    try {
      if (status?.setupNeeded) await api('POST', 'setup', { code: form.code, password: form.password });
      else await api('POST', 'login', { mobile: form.mobile, password: form.password });
      setForm({ ...form, password: '', confirm: '', code: '' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('POST', 'logout', {}).catch(() => {});
    setAgencies(null);
    refresh();
  }

  if (!status) return <div className="page"><h1>Site admin</h1>{error ? <p className="form-error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  if (!status.loggedIn) {
    return (
      <div className="page site-admin">
        <section className="auth-card">
          <h1>{status.setupNeeded ? 'Set up the site admin' : 'Site admin login'}</h1>
          {status.setupNeeded && (
            <p className="muted">
              Choose the password for <b>{status.username}</b> (log in with mobile {status.mobile}). Enter the one-time setup code printed in the server log when AirRex
              started (e.g. <code>app-compose airrex logs app</code>).
            </p>
          )}
          <form className="auth-form" onSubmit={submit}>
            {status.setupNeeded ? (
              <label className="field"><span>Setup code (from the server log)</span>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required autoComplete="off" />
              </label>
            ) : (
              <label className="field"><span>Mobile number</span>
                <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required inputMode="tel" autoComplete="tel" />
              </label>
            )}
            <label className="field"><span>{status.setupNeeded ? 'New password' : 'Password'}</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required
                autoComplete={status.setupNeeded ? 'new-password' : 'current-password'} />
              {status.setupNeeded && <span className="hint-text">{PASSWORD_HINT}.</span>}
            </label>
            {status.setupNeeded && (
              <label className="field"><span>Repeat the password</span>
                <input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required autoComplete="new-password" />
              </label>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : status.setupNeeded ? 'Set password and log in' : 'Log in'}</button>
          </form>
        </section>
      </div>
    );
  }

  const shown = (agencies ?? []).filter((a) =>
    `${a.agencyName} ${a.mobile} ${a.email} ${a.contactName} ${a.phone} ${a.city} ${a.state}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const waiting = (agencies ?? []).filter((a) => a.status === 'pending').length;

  return (
    <div className="page site-admin">
      <div className="card-head-row">
        <h1>Agencies</h1>
        <div className="row-actions">
          <ChangePassword />
          <button className="btn" onClick={logout}><Icon name="logout" /> Log out</button>
        </div>
      </div>
      <p className="muted">
        Logged in as <b>{status.username}</b>. {waiting ? <b>{waiting} waiting for activation.</b> : 'No agencies waiting.'} Activating
        needs an expiry date; after it, agent tools keep working for the grace days.
      </p>
      <label className="field site-admin-search">
        <span>Search</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Agency, mobile, email, city or state" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="agency-list">
        {agencies === null && <p className="muted">Loading…</p>}
        {agencies?.length === 0 && <div className="empty">No agencies yet.</div>}
        {shown.map((a) => (
          <AgencyRowEditor key={a.id} agency={a} onSaved={(u) => setAgencies((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null)} />
        ))}
      </div>
    </div>
  );
}
