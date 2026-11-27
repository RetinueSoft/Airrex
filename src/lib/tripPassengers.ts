// Passengers added for a trip while booking. Kept in memory only (this browser tab): nothing is stored on the
// device or sent to the server, and it is gone when the page is closed or reloaded.

import type { PassengerDetails, SearchQuery } from '../../shared/types.ts';

const trips = new Map<string, PassengerDetails[]>();

const key = (q: Pick<SearchQuery, 'origin' | 'destination' | 'date'>) => `${q.origin}-${q.destination}-${q.date}`;

export function tripPassengers(q: Pick<SearchQuery, 'origin' | 'destination' | 'date'>): PassengerDetails[] {
  return trips.get(key(q)) ?? [];
}

export function setTripPassengers(q: Pick<SearchQuery, 'origin' | 'destination' | 'date'>, list: PassengerDetails[]) {
  trips.set(key(q), list);
}

/** Forget every trip's passengers (on logout, so the next person on this computer can't see them). */
export function clearAllTripPassengers() {
  trips.clear();
}
