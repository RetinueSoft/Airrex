// "Passenger details" in the booking pop-up: add passengers (scan passport or type), then copy each field into the
// airline's passenger form. Travellers' details stay in this browser tab only. Agents can also pick saved passengers
// or save new ones (encrypted on the server, deleted automatically).

import { useEffect, useRef, useState } from 'react';
import type { PassengerDetails, SavedPassenger, SearchQuery } from '../../shared/types.ts';
import { findAirport } from '../../shared/airports.ts';
import { passengersApi, useAgent } from '../lib/agent.tsx';
import { setTripPassengers, tripPassengers } from '../lib/tripPassengers.ts';
import { PassengerCard, PassengerForm, fullName } from './Passengers.tsx';
import Icon from './Icon.tsx';

export function SaveConsent({
  save,
  setSave,
  keepDays,
  setKeepDays,
}: {
  save: boolean;
  setSave: (v: boolean) => void;
  keepDays: number;
  setKeepDays: (v: number) => void;
}) {
  return (
    <div className="pax-consent">
      <label className="check">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        <span>
          Save to my passengers. I have this passenger's permission to keep their passport details for booking.
        </span>
      </label>
      {save && (
        <label className="field compact">
          <span>Delete automatically after</span>
          <select value={keepDays} onChange={(e) => setKeepDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>
      )}
    </div>
  );
}

export default function TripPassengers({ query, onChange }: { query: SearchQuery; onChange?: (list: PassengerDetails[]) => void }) {
  const { agent } = useAgent();
  const international = findAirport(query.origin)?.country !== 'IN' || findAirport(query.destination)?.country !== 'IN';
  const [list, setList] = useState<PassengerDetails[]>(() => tripPassengers(query));
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<SavedPassenger[] | null>(null);
  const [save, setSave] = useState(false);
  const [keepDays, setKeepDays] = useState(30);
  const [error, setError] = useState('');

  // Report real changes only (not the first render): opening the pop-up again must not overwrite the
  // passengers the helper already has.
  const initialList = useRef(list);
  useEffect(() => {
    setTripPassengers(query, list);
    if (list === initialList.current) return; // unchanged since the pop-up opened
    onChange?.(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  useEffect(() => {
    if (!agent) return;
    passengersApi
      .list()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [agent]);

  async function add(p: PassengerDetails) {
    setError('');
    if (agent && save) {
      try {
        const s = await passengersApi.save(p, keepDays);
        setSaved((x) => [s, ...(x ?? [])]);
      } catch (err) {
        setError(`Not saved: ${err instanceof Error ? err.message : 'error'}. The details are still used for this booking.`);
      }
    }
    setList((x) => [...x, p]);
    setAdding(false);
  }

  const canAddMore = list.length < query.adults;

  return (
    <details className="trip-pax" open={list.length > 0 || undefined}>
      <summary>
        <Icon name="badge" size={18} /> Passenger details for the airline form{list.length ? ` (${list.length}/${query.adults})` : ''}
      </summary>
      <p className="muted small-text">
        {international ? 'Scan the passport' : 'Add each traveller'} once, then copy each field into the airline's passenger
        form.{' '}
        {agent ? '' : 'Details stay in this browser tab only and are cleared when you close the page.'}
      </p>

      {list.map((p, i) => (
        <div key={i} className="pax-item">
          <PassengerCard passenger={p} index={i} travelDate={query.date} international={international} />
          <button type="button" className="link-btn" onClick={() => setList((x) => x.filter((_, j) => j !== i))}>
            Remove {fullName(p)}
          </button>
        </div>
      ))}

      {error && <p className="hint warn">{error}</p>}

      {canAddMore && !adding && (
        <div className="pax-add">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="person_add" size={18} /> Add passenger {list.length + 1}
          </button>
          {saved && saved.length > 0 && (
            <select
              className="pax-pick"
              value=""
              onChange={(e) => {
                const s = saved.find((x) => x.id === Number(e.target.value));
                if (s) setList((x) => [...x, s]);
              }}
            >
              <option value="">Choose a saved passenger…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s)} · {s.passportNumber || 'no passport'}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {adding && (
        <PassengerForm
          onDone={add}
          onCancel={() => setAdding(false)}
          doneLabel="Add passenger"
          extra={agent ? <SaveConsent save={save} setSave={setSave} keepDays={keepDays} setKeepDays={setKeepDays} /> : undefined}
        />
      )}
    </details>
  );
}
