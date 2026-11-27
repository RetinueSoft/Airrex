// What the customer pays when booking through an agent:
//   airline fare (incl. taxes)
// + airline payment fee (convenience/processing fee added on the airline's payment page; approximate)
// + agency service charge (+ 18% GST on it, if the agent turned GST on)

import type { AgentProfile, FlightOffer } from '../../shared/types.ts';
import { PROCESSING_FEES } from '../../shared/airlineFees.ts';

export const GST_RATE = 0.18;

export interface AgencyCharge {
  /** Service charge per passenger, before GST. */
  charge: number;
  /** GST on the service charge per passenger (0 when GST is off). */
  gst: number;
  /** Charge + GST per passenger. */
  total: number;
}

export function agencyCharge(agent: Pick<AgentProfile, 'gstOnCharge'>, chargePerPerson: number): AgencyCharge {
  const charge = Math.max(0, Math.round(chargePerPerson));
  const gst = agent.gstOnCharge ? Math.round(charge * GST_RATE) : 0;
  return { charge, gst, total: charge + gst };
}

/** Payment fee per passenger per flight leg for this airline (airline-specific, else default, else 0). */
export function paymentFeePerLeg(agent: Pick<AgentProfile, 'paymentFees'> | null | undefined, airlineCode: string) {
  const fees = agent?.paymentFees ?? {};
  if (fees[airlineCode] !== undefined) return fees[airlineCode];
  // The shown price already includes this airline's processing fee (e.g. Scoot), so don't add the default on top.
  if (PROCESSING_FEES[airlineCode]) return 0;
  return fees.default ?? 0;
}

/** Number of flight legs the fee applies to (one per segment). */
export function legs(offer: FlightOffer) {
  return Math.max(1, offer.segments.length);
}

export interface CustomerPrice {
  airline: number; // airline fare total (all passengers)
  paymentFee: number; // all passengers, all legs
  agency: number; // service charge + GST, all passengers
  total: number;
  perPerson: number;
}

/**
 * Full price for the customer. `feePerLeg` and `chargePerPerson` default to the agent's settings but can be
 * overridden (the details screen lets the agent edit both for one flight).
 */
export function customerPrice(
  offer: FlightOffer,
  agent: Pick<AgentProfile, 'gstOnCharge' | 'paymentFees' | 'defaultMarkup'>,
  opts: { feePerLeg?: number; chargePerPerson?: number } = {},
): CustomerPrice & { charge: AgencyCharge; feePerLeg: number; passengers: number; legs: number } {
  const passengers = offer.fare.passengers ?? 1;
  const n = legs(offer);
  const feePerLeg = Math.max(0, Math.round(opts.feePerLeg ?? paymentFeePerLeg(agent, offer.airlineCode)));
  const charge = agencyCharge(agent, opts.chargePerPerson ?? agent.defaultMarkup);
  const paymentFee = feePerLeg * n * passengers;
  const agency = charge.total * passengers;
  const total = offer.fare.total + paymentFee + agency;
  return { airline: offer.fare.total, paymentFee, agency, total, perPerson: Math.round(total / passengers), charge, feePerLeg, passengers, legs: n };
}
