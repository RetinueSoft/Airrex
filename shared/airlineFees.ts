// Fees some airlines add on their payment page that Google Flights prices leave out.
// AirRex adds them to the shown price so it matches what the customer really pays.
// Amounts are in INR for bookings paid in rupees, from flights departing India.

import { findAirport } from './airports.ts';

export interface ProcessingFeeRule {
  /** Fee for the whole booking (not per passenger), GST included. */
  perBooking?: number;
  /** Fee per passenger per flight segment. */
  perPassengerPerSegment?: { domestic: number; international: number };
  /** Only for flights departing from these countries. */
  departingFrom: string[];
  label: string;
}

export const PROCESSING_FEES: Record<string, ProcessingFeeRule> = {
  // Scoot: ₹450 per booking + 18% GST for flights departing India (flyscoot.com payment methods page).
  // Scoot shows the exact fee before payment; update this if it changes.
  TR: { perBooking: 531, departingFrom: ['IN'], label: 'Scoot processing fee (₹450 + GST, per booking)' },
  // Air India Express convenience fee per passenger per segment: ₹325 domestic, ₹549 international
  // (airindiaexpress.com "Fees & Charges" PDF, Oct 2026).
  IX: {
    perPassengerPerSegment: { domestic: 325, international: 549 },
    departingFrom: ['IN'],
    label: 'Air India Express convenience fee',
  },
};

/** The processing fee rule that applies to this airline and departure airport, if any. */
export function processingFeeFor(airlineCode: string, originCode: string): ProcessingFeeRule | undefined {
  const rule = PROCESSING_FEES[airlineCode];
  if (!rule) return undefined;
  const country = findAirport(originCode)?.country;
  return country && rule.departingFrom.includes(country) ? rule : undefined;
}

/** Total fee for a booking. */
export function processingFeeTotal(
  rule: ProcessingFeeRule,
  opts: { passengers: number; segments: number; origin: string; destination: string },
): number {
  const domestic = findAirport(opts.origin)?.country === 'IN' && findAirport(opts.destination)?.country === 'IN';
  const perPax = rule.perPassengerPerSegment ? rule.perPassengerPerSegment[domestic ? 'domestic' : 'international'] : 0;
  return (rule.perBooking ?? 0) + perPax * opts.passengers * opts.segments;
}
