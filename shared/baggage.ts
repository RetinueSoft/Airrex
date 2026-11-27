// Reads luggage allowance out of the short text notes flight sources attach to a fare,
// e.g. Google Flights: "Checked baggage for a fee", "1 carry-on bag", "1 checked bag", "15 kg checked baggage".

import type { Baggage } from './types.ts';

const BAG_WORDS = /bag|baggage|luggage|carry-on|carry on|cabin|overhead/i;

export function parseBaggage(lines: (string | undefined | null)[]): Baggage | undefined {
  const notes = [...new Set(lines.filter((l): l is string => !!l && BAG_WORDS.test(l)))];
  if (!notes.length) return undefined;

  const b: Baggage = { notes };
  for (const raw of notes) {
    const l = raw.toLowerCase();
    if (/restrict|depend|may apply|varies/.test(l)) continue; // unclear wording: keep as a note only
    const kg = /(\d{1,2})\s*kg/.exec(l)?.[1];
    const isChecked = /check(ed)?[-\s]?(in)?\s*(bag|baggage|luggage)/.test(l) || /\bchecked\b/.test(l);
    const isCabin = /carry[-\s]?on|cabin|hand\s*(bag|baggage|luggage)|overhead/.test(l);
    const negative = /for a fee|not included|no\s|fee applies|extra charge|paid|purchase/.test(l);

    if (isChecked) {
      if (negative) {
        b.checkedIncluded = false;
        if (/fee|paid|purchase|extra charge/.test(l)) b.checkedForFee = true;
      } else {
        b.checkedIncluded = true;
        if (kg) b.checkInKg = Number(kg);
      }
    } else if (isCabin) {
      if (negative) b.cabinIncluded = false;
      else {
        b.cabinIncluded = true;
        if (kg) b.cabinKg = Number(kg);
      }
    }
  }
  return b;
}

/** e.g. "Extra 3 kg ₹2,250 if pre-booked" (empty when the price isn't known). */
export function extraBagLabel(b?: Baggage, short = false): string {
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  if (b?.checkedIncluded === false && b.bagFare) {
    const range = b.bagFare.from === b.bagFare.to ? inr(b.bagFare.from) : `${inr(b.bagFare.from)}–${inr(b.bagFare.to).slice(1)}`;
    return short ? `${b.bagFare.kg} kg fare +${range}` : `Fare with a ${b.bagFare.kg} kg check-in bag: about ${range} more per person`;
  }
  if (b?.checkedIncluded === false && b.addBag) {
    return short ? `+${b.addBag.kg} kg bag ${inr(b.addBag.price)}` : `Add a ${b.addBag.kg} kg check-in bag for ${inr(b.addBag.price)}`;
  }
  if (b?.extra) {
    if (short) return `+${b.extra.kg} kg ${inr(b.extra.price)}`;
    const airport = b.extra.airportPerKg ? ` (${inr(b.extra.airportPerKg)}/kg at the airport)` : '';
    return `Extra ${b.extra.kg} kg ${inr(b.extra.price)} if pre-booked${airport}`;
  }
  return '';
}

/** Short label for cards and filters. */
export function baggageSummary(b?: Baggage): { label: string; tone: 'ok' | 'warn' | 'unknown' } {
  if (!b) return { label: 'Baggage: check airline', tone: 'unknown' };
  if (b.typical) {
    const cabin = `${b.cabinKg ?? 7} kg cabin`;
    if (b.checkedIncluded) return { label: `Usually ${cabin} + ${b.checkInKg ? `${b.checkInKg} kg ` : ''}check-in`, tone: 'ok' };
    if (b.checkedIncluded === false) return { label: `Usually cabin bag only (${b.cabinKg ?? 7} kg)`, tone: 'warn' };
    return { label: `Usually ${cabin} · check-in depends on fare`, tone: 'unknown' };
  }
  if (b.checkedIncluded) {
    return { label: `Cabin + ${b.checkInKg ? `${b.checkInKg} kg ` : ''}check-in bag`, tone: 'ok' };
  }
  if (b.checkedIncluded === false && b.cabinIncluded === false) return { label: 'No bags included (personal item only)', tone: 'warn' };
  if (b.checkedIncluded === false) return { label: 'Cabin bag only', tone: 'warn' };
  if (b.cabinIncluded) return { label: 'Cabin bag included · check-in: check airline', tone: 'unknown' };
  return { label: 'Baggage: check airline', tone: 'unknown' };
}
