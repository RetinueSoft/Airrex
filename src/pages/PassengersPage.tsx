// Agent → Saved passengers (/agent/passengers): passport details saved with the passenger's permission.
// Stored encrypted on the server and deleted automatically on the chosen date.

import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { PassengerDetails, SavedPassenger } from '../../shared/types.ts';
import { passengersApi, useAgent } from '../lib/agent.tsx';
import { PassengerCard, PassengerForm, dmy, fullName } from '../components/Passengers.tsx';
import { SaveConsent } from '../components/TripPassengers.tsx';
import Icon from '../components/Icon.tsx';

export default function PassengersPage() {
  const { agent, loading } = useAgent();
  const [list, setList] = useState<SavedPassenger[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [keepDays, setKeepDays] = useState(30);

  useEffect(() => {
    if (!agent) return;
    passengersApi
      .list()
      .then(setList)
      .catch((e) => setError(e.message));
  }, [agent]);

  if (loading) return <p className="page muted">Loading…</p>;
  if (!agent) return <Navigate to="/agent/login" replace />;

  async function add(p: PassengerDetails) {
    if (!consent) {
      setError("Tick the box to confirm you have the passenger's permission.");
      return;
    }
    setError('');
    try {
      const s = await passengersApi.save(p, keepDays);
      setList((x) => [s, ...(x ?? [])]);
      setAdding(false);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  async function remove(s: SavedPassenger) {
    if (!confirm(`Delete ${fullName(s)}'s details now?`)) return;
    try {
      await passengersApi.remove(s.id);
      setList((x) => x?.filter((y) => y.id !== s.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    }
  }

  return (
    <div className="page">
      <Link to="/agent" className="back-link"><Icon name="arrow_back" /> Agent home</Link>
      <h1>Saved passengers</h1>
      <p className="muted">
        Scan a customer's passport once and pick them when booking. Details are encrypted on the server, visible only to your
        account, and deleted automatically on the date shown.
      </p>

      {error && <p className="hint warn">{error}</p>}

      {!adding && (
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="person_add" /> Add passenger
        </button>
      )}
      {adding && (
        <div className="details-card">
          <PassengerForm
            onDone={add}
            onCancel={() => setAdding(false)}
            doneLabel="Save passenger"
            extra={<SaveConsent save={consent} setSave={setConsent} keepDays={keepDays} setKeepDays={setKeepDays} />}
          />
        </div>
      )}

      <div className="pax-list">
        {list === null && !error && <p className="muted">Loading…</p>}
        {list?.length === 0 && <div className="empty">No saved passengers yet.</div>}
        {list?.map((s) => (
          <div key={s.id} className="pax-list-item">
            <div className="pax-list-row">
              <button className="grow pax-list-name" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <b>{fullName(s)}</b>
                <span className="muted small-text">
                  {s.passportNumber ? `Passport ${s.passportNumber}` : 'No passport'}
                  {s.passportExpiry && ` · expires ${dmy(s.passportExpiry)}`} · deleted on {new Date(s.deleteAfter).toLocaleDateString('en-IN')}
                </span>
              </button>
              <button className="link-btn" onClick={() => remove(s)}>Delete</button>
            </div>
            {open === s.id && <PassengerCard passenger={s} />}
          </div>
        ))}
      </div>
    </div>
  );
}
