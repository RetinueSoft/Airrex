// What the customer pays when booking through an agent:
//   airline fare (incl. taxes and the airline's convenience/processing fee, see shared/airlineFees.ts)
// + agency service charge: fixed ₹ and/or % of the fare (+ 18% GST on it, if the agent turned GST on)

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

/**
 * Extra airline payment fee per passenger per flight. Always 0 now: airline convenience/processing fees are
 * already included in the fares (shared/airlineFees.ts), so agents don't set them any more.
 */
export function paymentFeePerLeg(_agent?: unknown, _airlineCode?: string) {
  return 0;
}

type ChargeSettings = Pick<AgentProfile, 'defaultMarkup' | 'markupPercent' | 'markupMode' | 'markupMax'>;

/** The agent's default service charge per passenger (before GST) for a fare of `farePerPerson`. */
export function defaultCharge(agent: ChargeSettings, farePerPerson: number) {
  const fixed = Math.max(0, Math.round(agent.defaultMarkup || 0));
  const pct = Math.round((Math.max(0, farePerPerson) * Math.max(0, agent.markupPercent || 0)) / 100);
  switch (agent.markupMode) {
    case 'percent':
      return pct;
    case 'higher':
      return Math.max(fixed, pct);
    case 'lower':
      return Math.min(fixed, pct);
    case 'range': {
      // % of the fare, kept between the lower and upper limit.
      const max = Math.max(fixed, Math.round(agent.markupMax || 0));
      return Math.min(max, Math.max(fixed, pct));
    }
    default:
      return fixed;
  }
}

/** e.g. "₹300 or 5% of the fare, whichever is higher". */
export function chargeRule(agent: ChargeSettings) {
  const fixed = `₹${(agent.defaultMarkup || 0).toLocaleString('en-IN')}`;
  const pct = `${agent.markupPercent || 0}% of the fare`;
  switch (agent.markupMode) {
    case 'percent':
      return pct;
    case 'higher':
      return `${fixed} or ${pct}, whichever is higher`;
    case 'lower':
      return `${fixed} or ${pct}, whichever is lower`;
    case 'range':
      return `${pct}, at least ${fixed} and at most ₹${(agent.markupMax || 0).toLocaleString('en-IN')}`;
    default:
      return fixed;
  }
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
  agent: Pick<AgentProfile, 'gstOnCharge' | 'defaultMarkup' | 'markupPercent' | 'markupMode' | 'markupMax'>,
  opts: { feePerLeg?: number; chargePerPerson?: number } = {},
): CustomerPrice & { charge: AgencyCharge; feePerLeg: number; passengers: number; legs: number } {
  const passengers = offer.fare.passengers ?? 1;
  const n = legs(offer);
  const feePerLeg = Math.max(0, Math.round(opts.feePerLeg ?? 0));
  const farePerPerson = offer.fare.perPerson ?? offer.fare.total / passengers;
  const charge = agencyCharge(agent, opts.chargePerPerson ?? defaultCharge(agent, farePerPerson));
  const paymentFee = feePerLeg * n * passengers;
  const agency = charge.total * passengers;
  const total = offer.fare.total + paymentFee + agency;
  return { airline: offer.fare.total, paymentFee, agency, total, perPerson: Math.round(total / passengers), charge, feePerLeg, passengers, legs: n };
}
