import type { BookingOption, CalendarResponse, SearchQuery, SearchResponse, FareReportInput } from '../../shared/types.ts';

/** Cheapest known 1-adult price per day. Uses no paid searches. */
export async function fetchCalendar(
  origin: string,
  destination: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  const res = await fetch(`/api/calendar?${new URLSearchParams({ origin, destination, from, to })}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Could not load prices (${res.status})`);
  return body as CalendarResponse;
}

function queryParams(q: SearchQuery) {
  return new URLSearchParams({
    origin: q.origin,
    destination: q.destination,
    date: q.date,
    adults: String(q.adults),
  });
}

export async function searchFlights(q: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`/api/search?${queryParams(q)}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);
  return body as SearchResponse;
}

/** Booking links for one flight. With cachedOnly, returns null instead of spending a paid search. */
export async function fetchBookingOptions(
  token: string,
  q: SearchQuery,
  signal?: AbortSignal,
  cachedOnly = false,
): Promise<BookingOption[] | null> {
  const params = queryParams(q);
  params.set('token', token);
  if (cachedOnly) params.set('cachedOnly', '1');
  const res = await fetch(`/api/booking-options?${params}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Could not load booking links (${res.status})`);
  return body as BookingOption[] | null;
}

/**
 * Open a booking link in a new tab. Google's booking redirect must be opened with an HTTP POST
 * carrying post_data, so we submit a hidden form instead of using a plain link.
 */
export function openBookingOption(opt: BookingOption) {
  if (!opt.url || !/^https:\/\//i.test(opt.url)) return false;
  if (!opt.postData) {
    window.open(opt.url, '_blank', 'noopener');
    return true;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = opt.url;
  form.target = '_blank';
  form.rel = 'noopener';
  for (const [name, value] of new URLSearchParams(opt.postData)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
  return true;
}

/** Send a "what did you pay?" report after booking. */
export async function sendFareReport(report: FareReportInput): Promise<void> {
  const res = await fetch('/api/fare-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Could not send (${res.status})`);
  }
}
