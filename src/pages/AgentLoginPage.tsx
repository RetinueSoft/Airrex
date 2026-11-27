import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgent } from '../lib/agent.tsx';
import { PASSWORD_HINT, passwordProblem } from '../../shared/password.ts';
import Icon from '../components/Icon.tsx';
import { PLAN_PRICE } from '../lib/config.ts';

const BENEFITS = [
  ['travel_explore', 'All airlines, one screen', 'IndiGo, Air India, Akasa, SpiceJet and more, with total fares, baggage and a cheapest-date calendar.'],
  ['chat', 'WhatsApp quotes in one tap', 'Pick 2–3 flights, add your service charge, send a neat quote with your agency name.'],
  ['confirmation_number', 'Branded e-ticket printing', 'Your logo, address and GSTIN on every ticket. Hide the airline fare automatically.'],
  ['history', 'Saved customer quotes', 'Every quote is saved, so you can resend or follow up later.'],
] as const;

export default function AgentLoginPage() {
  const { login, signup } = useAgent();
  const navigate = useNavigate();
  // The app opens on this page: most visitors are agencies logging in.
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ mobile: '', password: '', agencyName: '', contactName: '', email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);


  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    if (mode === 'signup' && passwordProblem(form.password)) {
      setError(passwordProblem(form.password));
      setBusy(false);
      return;
    }
    try {
      if (mode === 'login') await login(form.mobile, form.password);
      else await signup(form);
      // Always start on the search screen (an agency still waiting for activation is sent to its Account page).
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page agent-auth">
      <section className="agent-pitch">
        <span className="pill pill-info"><Icon name="storefront" size={14} /> For travel agents</span>
        <h1>Quote faster. Print branded tickets.</h1>
        <p className="muted">
          AirRex for Agents helps small travel agencies compare fares, send WhatsApp quotes and print e-tickets with your own
          branding. Sign up and AirRex activates your account, then {PLAN_PRICE}.
        </p>
        <ul className="benefits">
          {BENEFITS.map(([icon, title, text]) => (
            <li key={title}>
              <span className="benefit-icon"><Icon name={icon} size={22} /></span>
              <span><b>{title}</b><span className="muted">{text}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="auth-card">
        <div className="auth-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Log in
          </button>
          <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Sign up
          </button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && (
            <>
              <label className="field"><span>Agency name</span>
                <input value={form.agencyName} onChange={set('agencyName')} required maxLength={120} placeholder="e.g. Sri Murugan Travels" autoComplete="organization" />
              </label>
              <div className="field-row">
                <label className="field"><span>Your name</span>
                  <input value={form.contactName} onChange={set('contactName')} maxLength={120} autoComplete="name" />
                </label>
                <label className="field"><span>Email (optional)</span>
                  <input type="email" value={form.email} onChange={set('email')} maxLength={200} autoComplete="email" />
                </label>
              </div>
            </>
          )}
          <label className="field"><span>Mobile number</span>
            <input value={form.mobile} onChange={set('mobile')} required maxLength={16} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
            {mode === 'signup' && <span className="hint-text">You'll log in with this number.</span>}
          </label>
          <label className="field"><span>Password</span>
            <input type="password" value={form.password} onChange={set('password')} required minLength={1}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? 'e.g. Travel@24' : ''} />
            {mode === 'signup' && <span className="hint-text">{PASSWORD_HINT}.</span>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
          {mode === 'signup' && <p className="muted small-text">AirRex checks new agencies and activates the account, usually within a day.</p>}
          {mode === 'login' && <p className="muted small-text">Forgot your password? Contact AirRex to reset it.</p>}
        </form>
      </section>
    </div>
  );
}
