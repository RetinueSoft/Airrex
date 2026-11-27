// "My trips": flights the user clicked through to book. Stored only in this browser.
import type { FlightOffer, SearchQuery } from '../../shared/types.ts';

export interface SavedTrip {
  id: string;
  savedAt: string;
  query: SearchQuery;
  offer: FlightOffer;
}

const KEY = 'airrex.trips.v1';

export function loadTrips(): SavedTrip[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveTrip(query: SearchQuery, offer: FlightOffer) {
  try {
    const trips = loadTrips().filter((t) => t.offer.id !== offer.id);
    trips.unshift({ id: offer.id, savedAt: new Date().toISOString(), query, offer });
    localStorage.setItem(KEY, JSON.stringify(trips.slice(0, 50)));
  } catch {
    /* storage unavailable (private mode) – ignore */
  }
}

export function removeTrip(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadTrips().filter((t) => t.id !== id)));
  } catch {
    /* ignore */
  }
}
