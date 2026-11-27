// "My trips": flights the agency continued to book on an airline site. Each agency's own, stored on the server
// (last 50).
import type { FlightOffer, SearchQuery } from '../../shared/types.ts';
import { tripsApi } from './agent.tsx';

export interface SavedTrip {
  id: number;
  savedAt: string;
  query: SearchQuery;
  offer: FlightOffer;
}

// Before this, trips were kept in the browser and shared by everyone using it: remove that old copy.
try {
  localStorage.removeItem('airrex.trips.v1');
} catch {
  /* ignore */
}

export function loadTrips(): Promise<SavedTrip[]> {
  return tripsApi.list().catch(() => []);
}

export function saveTrip(query: SearchQuery, offer: FlightOffer) {
  tripsApi.save(query, offer).catch(() => {});
}

export function removeTrip(id: number) {
  return tripsApi.remove(id).catch(() => {});
}
