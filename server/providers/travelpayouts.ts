// Approximate cheapest price per day from Travelpayouts / Aviasales Data API
// (https://support.travelpayouts.com/hc/en-us/articles/203956163).
// Prices come from Aviasales users' searches in the last ~48 hours: free, but approximate and with gaps.
// Enabled when TRAVELPAYOUTS_TOKEN is set.

export interface DayEstimate {
  price: number;
  airlineCode?: string;
  stops?: number;
}

interface GroupedPrice {
  price: number;
  airline?: string;
  transfers?: number;
}

export async function fetchMonthEstimates(
  token: string,
  origin: string,
  destination: string,
  month: string, // YYYY-MM
): Promise<Record<string, DayEstimate>> {
  const params = new URLSearchParams({
    origin,
    destination,
    departure_at: month,
    group_by: 'departure_at',
    currency: 'inr',
    market: process.env.TRAVELPAYOUTS_MARKET ?? 'in',
  });
  const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/grouped_prices?${params}`, {
    headers: { 'X-Access-Token': token, Accept: 'application/json', 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Record<string, GroupedPrice>; error?: string | null };
  if (!res.ok || body.success === false) throw new Error(`Travelpayouts: ${body.error ?? `HTTP ${res.status}`}`);

  const out: Record<string, DayEstimate> = {};
  for (const [date, item] of Object.entries(body.data ?? {})) {
    if (typeof item?.price !== 'number') continue;
    out[date.slice(0, 10)] = { price: item.price, airlineCode: item.airline, stops: item.transfers };
  }
  return out;
}
