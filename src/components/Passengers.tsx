// Passenger details for airline passenger forms:
//  - PassengerForm: scan a passport photo (read in the browser), paste the 2 MRZ lines, or type the details.
//  - PassengerCard: every field the airline form asks for, in its order, each with a Copy button.

import { useState, type ChangeEvent } from 'react';
import type { PassengerDetails } from '../../shared/types.ts';
import { parsePassportMrz } from '../../shared/mrz.ts';
import { countryName, nationalityName } from '../../shared/countries.ts';
import Icon from './Icon.tsx';

export const EMPTY_PASSENGER: PassengerDetails = {
  givenNames: '',
  surname: '',
  sex: '',
  dateOfBirth: '',
  nationality: 'IND',
  passportNumber: '',
  issuingCountry: 'IND',
  passportExpiry: '',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1985-04-12" -> "12/04/1985" (how Indian airline forms usually want it). */
export function dmy(ymd: string) {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

function longDate(ymd: string) {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : '';
}

export function fullName(p: PassengerDetails) {
  return [p.givenNames, p.surname].filter(Boolean).join(' ') || 'Passenger';
}

/** Months between two YYYY-MM-DD dates (b - a). */
function monthsBetween(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

function ageOn(dob: string, onDate: string) {
  return Math.floor(monthsBetween(dob, onDate) / 12);
}

/** Problems to warn about before booking (expiry, missing fields). */
export function passengerWarnings(p: PassengerDetails, travelDate?: string, international = true): string[] {
  const w: string[] = [];
  if (!p.givenNames && !p.surname) w.push('Name is missing.');
  if (!p.dateOfBirth) w.push('Date of birth is missing.');
  if (international) {
    if (!p.passportNumber) w.push('Passport number is missing.');
    if (!p.passportExpiry) w.push('Passport expiry date is missing.');
    else if (travelDate) {
      const left = monthsBetween(travelDate, p.passportExpiry);
      if (left < 0) w.push('The passport has expired before the travel date.');
      else if (left < 6) w.push('The passport expires within 6 months of travel. Many countries (e.g. Singapore, UAE, Malaysia) refuse entry; renew it first.');
    }
  }
  return w;
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value is visible and can be selected */
    }
  }
  return (
    <div className="pax-row">
      <span className="pax-label">{label}</span>
      <span className="pax-value">
        <b className="mono">{value || '—'}</b>
        {hint && <span className="muted small-text">{hint}</span>}
      </span>
      {value && (
        <button type="button" className="btn tonal pax-copy" onClick={copy} aria-label={`Copy ${label}`}>
          <Icon name={copied ? 'check' : 'content_copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

/** Each field an airline passenger form asks for, with Copy buttons. */
export function PassengerCard({
  passenger: p,
  index,
  travelDate,
  international = true,
}: {
  passenger: PassengerDetails;
  index?: number;
  travelDate?: string;
  international?: boolean;
}) {
  const adult = !p.dateOfBirth || !travelDate || ageOn(p.dateOfBirth, travelDate) >= 12;
  const title = p.sex === 'M' ? (adult ? 'Mr' : 'Master') : p.sex === 'F' ? (adult ? 'Ms' : 'Miss') : '';
  const warnings = passengerWarnings(p, travelDate, international);
  return (
    <section className="pax-card">
      <h3>
        {index !== undefined ? `Passenger ${index + 1}: ` : ''}
        {fullName(p)}
      </h3>
      {title && <CopyRow label="Title" value={title} />}
      <CopyRow label="First / given name" value={p.givenNames} hint={!p.givenNames ? 'No given name on the passport: follow the airline’s note for single names.' : undefined} />
      <CopyRow label="Last name / surname" value={p.surname} hint={!p.surname ? 'No surname on the passport: follow the airline’s note for single names.' : undefined} />
      <CopyRow label="Gender" value={p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex === 'X' ? 'Other' : ''} />
      <CopyRow label="Date of birth" value={dmy(p.dateOfBirth)} hint={longDate(p.dateOfBirth)} />
      {international && (
        <>
          <CopyRow label="Nationality" value={nationalityName(p.nationality)} hint={p.nationality} />
          <CopyRow label="Passport number" value={p.passportNumber} />
          <CopyRow label="Issuing country" value={countryName(p.issuingCountry)} hint={p.issuingCountry} />
          <CopyRow label="Passport expiry" value={dmy(p.passportExpiry)} hint={longDate(p.passportExpiry)} />
        </>
      )}
      {warnings.map((w) => (
        <p key={w} className="hint warn">{w}</p>
      ))}
      <p className="muted small-text">Type the names exactly as printed on the passport. Check every detail before paying.</p>
    </section>
  );
}

/** Scan a passport photo, paste the MRZ, or type the details; the result is editable before use. */
export function PassengerForm({
  initial,
  onDone,
  onCancel,
  doneLabel = 'Use these details',
  extra,
}: {
  initial?: PassengerDetails;
  onDone: (p: PassengerDetails) => void | Promise<void>;
  onCancel?: () => void;
  doneLabel?: string;
  /** Extra controls shown above the buttons (e.g. consent / keep-for). */
  extra?: React.ReactNode;
}) {
  const [p, setP] = useState<PassengerDetails>(initial ?? EMPTY_PASSENGER);
  const [status, setStatus] = useState('');
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [mrzText, setMrzText] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof PassengerDetails) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = k === 'sex' || k.startsWith('date') || k === 'passportExpiry' ? e.target.value : e.target.value.toUpperCase();
    setP((x) => ({ ...x, [k]: v }));
  };

  function applyResult(r: ReturnType<typeof parsePassportMrz>, from: string) {
    if (!r) {
      setScanNote({ ok: false, text: `Couldn't find the passport code in the ${from}. Type the details below instead.` });
      return;
    }
    setP(r.details);
    const name = r.nameUnsure ? ' The name was hard to read: correct its spelling from the passport.' : '';
    setScanNote(
      r.valid && !r.nameUnsure
        ? { ok: true, text: 'Read from the passport code and checked. Still compare the name and passport number with the passport.' }
        : r.valid
          ? { ok: false, text: `Passport number and dates read and checked.${name}` }
          : { ok: false, text: `Read, but the ${r.problems.join(', ')} didn't pass the passport's check: correct it below from the passport.${name}` },
    );
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setScanNote(null);
    try {
      const { scanPassportPhoto } = await import('../lib/passportScan.ts');
      applyResult(await scanPassportPhoto(file, setStatus), 'photo');
    } catch (err) {
      console.warn(err);
      setScanNote({ ok: false, text: 'The passport reader could not run here. Type the details below instead.' });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onDone({ ...p, givenNames: p.givenNames.trim(), surname: p.surname.trim(), passportNumber: p.passportNumber.replace(/\s/g, '') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pax-form" onSubmit={submit}>
      <div className="pax-scan">
        <label className={`btn primary file-btn ${busy ? 'disabled' : ''}`}>
          <Icon name="photo_camera" /> Scan passport photo page
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} disabled={busy} hidden />
        </label>
        <span className="muted small-text">
          Take a clear photo of the page with the photo, including the two lines of letters and &lt;&lt;&lt; at the bottom. The
          photo is read on this device and never uploaded.
        </span>
      </div>
      {status && <p className="muted">{status}</p>}
      {scanNote && <p className={scanNote.ok ? 'hint ok' : 'hint warn'}>{scanNote.text}</p>}

      <details className="pax-mrz">
        <summary>Or paste/type the two lines at the bottom of the passport</summary>
        <label className="field">
          <span>Passport code (2 lines)</span>
          <textarea rows={2} className="mono" value={mrzText} onChange={(e) => setMrzText(e.target.value)} placeholder={'P<IND…\nZ1234567<…'} />
        </label>
        <button type="button" className="btn" onClick={() => applyResult(parsePassportMrz(mrzText), 'text')}>Read these lines</button>
      </details>

      <div className="field-row">
        <label className="field"><span>Given name(s)</span><input value={p.givenNames} onChange={set('givenNames')} maxLength={60} autoComplete="off" /></label>
        <label className="field"><span>Surname</span><input value={p.surname} onChange={set('surname')} maxLength={60} autoComplete="off" /></label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Gender</span>
          <select value={p.sex} onChange={set('sex')}>
            <option value="">Select</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="X">Other</option>
          </select>
        </label>
        <label className="field"><span>Date of birth</span><input type="date" value={p.dateOfBirth} onChange={set('dateOfBirth')} /></label>
        <label className="field"><span>Nationality (code)</span><input value={p.nationality} onChange={set('nationality')} maxLength={3} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Passport number</span><input value={p.passportNumber} onChange={set('passportNumber')} maxLength={12} autoComplete="off" /></label>
        <label className="field"><span>Issued by (code)</span><input value={p.issuingCountry} onChange={set('issuingCountry')} maxLength={3} /></label>
        <label className="field"><span>Expiry date</span><input type="date" value={p.passportExpiry} onChange={set('passportExpiry')} /></label>
      </div>
      {extra}
      <div className="modal-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={busy || (!p.givenNames && !p.surname)}>{doneLabel}</button>
      </div>
    </form>
  );
}
