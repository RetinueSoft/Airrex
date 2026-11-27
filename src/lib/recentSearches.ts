// Recent searches, kept in this browser only (localStorage). Shown on the search screen so a search can be
// run again with one tap.

import type { SearchQuery } from '../../shared/types.ts';
import { todayYmd } from './format.ts';

export type RecentSearch = Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'> & { at: number };

const KEY = 'airrex.recentSearches.v1';
const MAX = 8;

export function loadRecentSearches(): RecentSearch[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => s && /^[A-Z]{3}$/.test(s.origin) && /^[A-Z]{3}$/.test(s.destination)) : [];
  } catch {
    return [];
  }
}

/** Add a search to the top of the list (the same route, date and travellers only once). */
export function saveRecentSearch(q: Pick<SearchQuery, 'origin' | 'destination' | 'date' | 'adults'>) {
  if (!/^[A-Z]{3}$/.test(q.origin) || !/^[A-Z]{3}$/.test(q.destination)) return;
  const entry: RecentSearch = { origin: q.origin, destination: q.destination, date: q.date, adults: q.adults, at: Date.now() };
  const same = (s: RecentSearch) => s.origin === entry.origin && s.destination === entry.destination && s.date === entry.date && s.adults === entry.adults;
  const list = [entry, ...loadRecentSearches().filter((s) => !same(s))].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked (private mode): nothing to remember */
  }
}

export function removeRecentSearch(s: RecentSearch) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRecentSearches().filter((x) => x.at !== s.at)));
  } catch {
    /* ignore */
  }
}

/** A date that has passed is moved to today, so tapping an old search still searches a bookable day. */
export function searchDate(s: RecentSearch) {
  const today = todayYmd();
  return s.date < today ? today : s.date;
}
