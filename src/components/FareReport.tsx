// "What did you pay?" — after booking, the traveller/agent tells AirRex what the airline actually charged.
// Saved in the fare_reports table and used to improve prices, fee and baggage rules.

import { useState } from 'react';
import type { FareReportInput, FlightOffer, SearchQuery } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { money } from '../lib/format.ts';
import { sendFareReport } from '../lib/api.ts';

const num = (s: string) => (s.trim() === '' ? undefined : Math.round(Number(s.replace(/[,₹\s]/g, ''))));

export default function FareReport({ offer, query, onDone }: { offer: FlightOffer; query: SearchQuery; onDone?: () => void }) {
  const airline = airlineInfo(offer.airlineCode, offer.airlineName);
  const [paid, setPaid] = useState('');
  const [fareType, setFareType] = useState('cheapest');
  const [bagKg, setBagKg] = useState('');
  const [bagCost, setBagCost] = useState('');
  const [fee, setFee] = useState('');
  const [other, setOther] = useState('');
  const [notes, setNotes] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const paidTotal = num(paid);
    if (!paidTotal || paidTotal < 100) {
      setError('Enter the total you paid on the airline site.');
      return;
    }
    const report: FareReportInput = {
      origin: query.origin,
      destination: query.destination,
      date: query.date,
      adults: query.adults,
      airlineCode: offer.airlineCode,
      flightNumbers: offer.segments.map((s) => s.flightNumber).join(' + '),
      shownTotal: offer.fare.total,
      paidTotal,
      fareType,
      bagKg: num(bagKg),
      bagCost: num(bagCost),
      airlineFee: num(fee),
      otherFees: num(other),
      notes: notes.trim() || undefined,
    };
    setState('sending');
    setError('');
    try {
      await sendFareReport(report);
      setState('sent');
      onDone?.();
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'Could not send');
    }
  }

  if (state === 'sent') return <p className="hint ok">Thank you! This helps AirRex show the real price.</p>;

  return (
    <form className="fare-report" onSubmit={submit}>
      <p className="muted small-text">
        AirRex showed <b>{money(offer.fare.total, offer.fare.currency)}</b> for {query.adults} adult{query.adults > 1 ? 's' : ''}. What
        did {airline.name} charge in the end? Only the amounts are saved, no personal details.
      </p>
      <div className="field-row">
        <label className="field">
          <span>Total paid (₹, all passengers)</span>
          <input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="numeric" required placeholder="e.g. 12450" />
        </label>
        <label className="field">
          <span>Fare chosen</span>
          <select value={fareType} onChange={(e) => setFareType(e.target.value)}>
            <option value="cheapest">Cheapest (no check-in bag)</option>
            <option value="with-bag">Fare with check-in bag</option>
            <option value="flexi">Flexi / higher fare</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field"><span>Bag bought (kg)</span><input value={bagKg} onChange={(e) => setBagKg(e.target.value)} inputMode="numeric" placeholder="optional" /></label>
        <label className="field"><span>Bag cost (₹)</span><input value={bagCost} onChange={(e) => setBagCost(e.target.value)} inputMode="numeric" placeholder="optional" /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Convenience / processing fee (₹)</span><input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="optional" /></label>
        <label className="field"><span>Seat, meal, other (₹)</span><input value={other} onChange={(e) => setOther(e.target.value)} inputMode="numeric" placeholder="optional" /></label>
      </div>
      <label className="field">
        <span>Anything else the site charged or asked?</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="optional, e.g. 'insurance pre-ticked ₹199'" />
      </label>
      {error && <p className="hint warn">{error}</p>}
      <div className="modal-actions">
        <button className="btn primary" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}
