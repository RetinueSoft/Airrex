// Recent searches: each agency's own, stored on the server (last 8). Shown on the search screen so a search can be
// run again with one tap.

import type { SearchQuery } from '../../shared/types.ts';
import { todayYmd } from './format.ts';
import { recentSearchesApi } from './agent.tsx';

export type RecentSearch = Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'> & { id: number; at: string };

// Before this, recent searches were kept in the browser and shared by everyone using it: remove that old copy.
try {
  localStorage.removeItem('airrex.recentSearches.v1');
} catch {
  /* ignore */
}

export function loadRecentSearches(): Promise<RecentSearch[]> {
  return recentSearchesApi.list().catch(() => []);
}

/** Remember a search (the same route, date and travellers once; newest first). */
export function saveRecentSearch(q: Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'>) {
  if (!/^[A-Z]{3}$/.test(q.origin) || !/^[A-Z]{3}$/.test(q.destination)) return;
  recentSearchesApi.save({ origin: q.origin, destination: q.destination, date: q.date, adults: q.adults }).catch(() => {});
}

export function removeRecentSearch(s: RecentSearch) {
  return recentSearchesApi.remove(s.id).catch(() => {});
}

/** A date that has passed is moved to today, so tapping an old search still searches a bookable day. */
export function searchDate(s: RecentSearch) {
  const today = todayYmd();
  return s.date < today ? today : s.date;
}
