// Types shared by the API server and the web app.

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

export interface SearchQuery {
  origin: string;        // IATA airport code, e.g. "DEL"
  destination: string;   // IATA airport code, e.g. "BOM"
  date: string;          // YYYY-MM-DD
  adults: number;
  cabin: CabinClass;
}

export interface Segment {
  flightNumber: string;      // e.g. "6E 2134"
  carrierCode: string;       // IATA airline code, e.g. "6E"
  carrierName: string;
  origin: string;
  destination: string;
  departAt: string;          // local ISO datetime, e.g. 2026-12-01T06:15:00
  arriveAt: string;
  durationMinutes: number;
  aircraft?: string;
}

export interface FareBreakdown {
  /** Not every provider splits the fare (Google Flights only gives the total). */
  baseFare?: number;
  taxesAndFees?: number;
  /** What the customer actually pays, for all passengers. */
  total: number;
  currency: string;
  /** Price for one adult. The total is calculated as perPerson × passengers (one search covers any group size). */
  perPerson?: number;
  passengers?: number;
  /** Airline processing fee for the whole booking, already included in `total` (e.g. Scoot). */
  processingFee?: number;
  processingFeeLabel?: string;
}

/**
 * What luggage the fare includes. undefined = not known from the data source.
 * Many Indian low-cost fares are "cabin bag only": a check-in bag must be bought separately.
 */
export interface Baggage {
  cabinIncluded?: boolean;
  cabinKg?: number;
  checkedIncluded?: boolean;
  checkInKg?: number;
  /** A check-in bag can be added for a fee. */
  checkedForFee?: boolean;
  /** Original wording from the data source, e.g. "Checked baggage for a fee". */
  notes?: string[];
  /** From the airline's usual Economy allowance, not confirmed for this exact fare. */
  typical?: boolean;
  /** Cheapest way to carry more: the smallest pre-booked extra-weight slab (INR). */
  extra?: { kg: number; price: number; airportPerKg?: number };
  /** Price to add a check-in bag to a cabin-only fare, if the airline publishes one (INR). */
  addBag?: { kg: number; price: number };
  /** The airline's next fare type that includes a check-in bag costs this much more per person (INR range). */
  bagFare?: { kg: number; from: number; to: number };
}

export interface FlightOffer {
  id: string;
  airlineCode: string;       // validating / selling airline
  airlineName: string;
  segments: Segment[];
  durationMinutes: number;
  stops: number;
  fare: FareBreakdown;
  cabin: CabinClass;
  baggage?: Baggage;
  refundable?: boolean;
  seatsLeft?: number;
  /** Direct link to book this offer on the airline's site, when the data provider supplies one. */
  bookingUrl?: string;
  /** Opaque provider token used to fetch live booking links (SerpApi). */
  bookingToken?: string;
  airlineLogo?: string;
}

export interface SearchResponse {
  query: SearchQuery;
  provider: string;
  isDemoData: boolean;
  offers: FlightOffer[];
  /** When the prices were fetched from the provider (ISO). Cached results keep the original time. */
  fetchedAt: string;
  /** Message for the user, e.g. live prices unavailable and demo fares shown instead. */
  notice?: string;
}

/** A place where the user can buy a given flight (from SerpApi booking options). */
export interface BookingOption {
  bookWith: string;
  isAirline: boolean;
  /** Total for the group (perPerson × adults). */
  price?: number;
  perPerson?: number;
  currency: string;
  optionTitle?: string;
  /** Fare features from the seller, e.g. "1 carry-on bag", "Checked bag for a fee". */
  extensions?: string[];
  baggage?: Baggage;
  /** Google redirect URL. If postData is present it must be opened with an HTTP POST. */
  url?: string;
  postData?: string;
  phone?: string;
}

/** One day in the cheapest-date calendar. Prices are for 1 adult, Economy. */
export interface CalendarDay {
  date: string; // YYYY-MM-DD
  price?: number;
  airlineCode?: string;
  stops?: number;
  /**
   * live: from a real search the app saved (exact when checked)
   * estimate: from Travelpayouts recent searches (approximate)
   * demo: demo fares
   * none: not known yet (search that date to see prices)
   */
  source: 'live' | 'estimate' | 'demo' | 'none';
  checkedAt?: string;
}

export interface CalendarResponse {
  origin: string;
  destination: string;
  currency: string;
  days: CalendarDay[];
  cheapestDate?: string;
  isDemoData: boolean;
}

/** Travel agent account as the web app sees it (never includes the password). */
export interface AgentProfile {
  email: string;
  contactName: string;
  agencyName: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  gstin: string;
  website: string;
  /** data: URL of the agency logo, or '' */
  logo: string;
  brandColor: string;
  /** Printed at the bottom of tickets, e.g. terms or "Thank you for booking with us". */
  ticketFooter: string;
  /** Default service charge per passenger (INR) added to WhatsApp quotes. */
  defaultMarkup: number;
  /** Add 18% GST on the agency service charge. */
  gstOnCharge: boolean;
  /**
   * Approximate fee airlines add on their payment page (convenience/processing fee), INR per passenger
   * per flight leg. Keys: airline code ("6E", "AI"…) or "default" for all other airlines.
   */
  paymentFees: Record<string, number>;
  trialEndsAt: string;
  paidUntil: string | null;
  /** Trial or paid subscription is running. */
  active: boolean;
}

export interface QuoteFlight {
  airline: string;
  flightNumbers: string;
  departAt: string;
  arriveAt: string;
  origin: string;
  destination: string;
  stops: number;
  durationMinutes: number;
  baggage: string;
  farePerPerson: number;
  /** Airline payment-page fee per person (all legs). Missing on quotes saved before this existed. */
  paymentFeePerPerson?: number;
  currency: string;
}

export interface SavedQuote {
  id: number;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  updatedAt?: string;
  /** draft = built in the quote bar but not sent yet; sent = sent on WhatsApp or copied. */
  status: 'draft' | 'sent';
  data: {
    origin: string;
    destination: string;
    date: string;
    adults: number;
    markupPerPerson: number;
    flights: QuoteFlight[];
  };
}

export interface Airport {
  code: string;
  city: string;
  name: string;
  country: string;
  /** Other names people type, e.g. Trichy, Bangalore. */
  aliases?: string[];
}
