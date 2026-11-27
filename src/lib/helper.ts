// Talks to the AirRex Helper browser extension (extension/ folder) through window.postMessage.
// The helper fills airline passenger forms and records the prices airline pages show.
// Passenger details handed over here stay in the browser (the extension's memory); they are not sent to AirRex.

import { useEffect, useState } from 'react';
import type { FlightOffer, PassengerDetails, SearchQuery } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';

export interface HelperTrip {
  v: 1;
  query: Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'> & { originCity: string; destinationCity: string };
  offer: {
    airlineCode: string;
    airlineName: string;
    flightNumbers: string;
    departAt: string;
    shownTotal: number;
    shownPerPerson?: number;
    processingFee?: number;
    currency: string;
  };
  passengers: PassengerDetails[];
}

let version: string | null = null;
const listeners = new Set<(v: string | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (d?.from === 'airrex-helper' && d.type === 'airrex:helper' && typeof d.version === 'string') {
      version = d.version;
      listeners.forEach((l) => l(version));
    }
  });
  window.postMessage({ type: 'airrex:hello' }, location.origin);
}

/** The installed helper's version, or null when it isn't installed (or not on this browser). */
export function useHelper() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    window.postMessage({ type: 'airrex:hello' }, location.origin);
    return () => void listeners.delete(setV);
  }, []);
  return v;
}

export function helperTrip(query: SearchQuery, offer: FlightOffer, passengers: PassengerDetails[]): HelperTrip {
  return {
    v: 1,
    query: {
      origin: query.origin,
      destination: query.destination,
      date: query.date,
      adults: query.adults,
      originCity: findAirport(query.origin)?.city ?? query.origin,
      destinationCity: findAirport(query.destination)?.city ?? query.destination,
    },
    offer: {
      airlineCode: offer.airlineCode,
      airlineName: airlineInfo(offer.airlineCode, offer.airlineName).name,
      flightNumbers: offer.segments.map((s) => s.flightNumber).join(' + '),
      departAt: offer.segments[0].departAt,
      shownTotal: offer.fare.total,
      shownPerPerson: offer.fare.perPerson,
      processingFee: offer.fare.processingFee,
      currency: offer.fare.currency,
    },
    passengers,
  };
}

const tripKey = (t: HelperTrip) => `${t.query.origin}-${t.query.destination}-${t.query.date}-${t.offer.flightNumbers}`;
// Which flight the helper was last given (route/date/flight only, no personal data). Kept for this tab so it
// survives a page reload.
const SENT_KEY = 'airrex.helper.sentTrip';
let lastSentKey = (() => {
  try {
    return sessionStorage.getItem(SENT_KEY) ?? '';
  } catch {
    return '';
  }
})();

/** Hand the trip to the helper (no-op when it isn't installed). */
export function sendTripToHelper(trip: HelperTrip) {
  if (!version) return;
  lastSentKey = tripKey(trip);
  try {
    sessionStorage.setItem(SENT_KEY, lastSentKey);
  } catch {
    /* storage blocked: only this page view remembers it */
  }
  window.postMessage({ type: 'airrex:trip', trip }, location.origin);
}

/**
 * Passengers added or removed later (pop-up reopened, added after continuing): update the helper if it already
 * has this flight, so the airline-site panel shows them without clicking Continue again.
 */
export function updateHelperPassengers(trip: HelperTrip) {
  if (version && lastSentKey && lastSentKey === tripKey(trip)) sendTripToHelper(trip);
}
