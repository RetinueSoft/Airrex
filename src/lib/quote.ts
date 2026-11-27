// Builds the WhatsApp / copy-paste quote an agent sends to a customer.

import type { AgentProfile, FlightOffer, QuoteFlight, SavedQuote } from '../../shared/types.ts';
import { airlineInfo } from '../../shared/airlines.ts';
import { findAirport } from '../../shared/airports.ts';
import { baggageSummary, extraBagLabel } from '../../shared/baggage.ts';
import { duration, money, prettyDate, time } from './format.ts';
import { legs, paymentFeePerLeg } from './charges.ts';

/** Customer price per person for one quoted flight: airline fare + payment fee + agency charge. */
export function quotePerPerson(f: QuoteFlight, markupPerPerson: number) {
  return f.farePerPerson + (f.paymentFeePerPerson ?? 0) + markupPerPerson;
}

/** `feePerLeg` overrides the agent's default payment fee for this flight (e.g. edited in the details screen). */
export function toQuoteFlight(o: FlightOffer, agent?: Pick<AgentProfile, 'paymentFees'> | null, feePerLeg?: number): QuoteFlight {
  const first = o.segments[0];
  const last = o.segments[o.segments.length - 1];
  const passengers = o.fare.passengers ?? 1;
  return {
    paymentFeePerPerson: (feePerLeg ?? paymentFeePerLeg(agent, o.airlineCode)) * legs(o),
    airline: o.airlineName.includes('+') ? o.airlineName : airlineInfo(o.airlineCode, o.airlineName).name,
    flightNumbers: o.segments.map((s) => s.flightNumber).join(' + '),
    departAt: first.departAt,
    arriveAt: last.arriveAt,
    origin: first.origin,
    destination: last.destination,
    stops: o.stops,
    durationMinutes: o.durationMinutes,
    baggage: [baggageSummary(o.baggage).label, extraBagLabel(o.baggage)].filter(Boolean).join(' · '),
    farePerPerson: o.fare.perPerson ?? Math.round(o.fare.total / passengers),
    currency: o.fare.currency,
  };
}

export function quoteText(q: SavedQuote['data'], agent: AgentProfile, customerName: string) {
  const city = (c: string) => findAirport(c)?.city ?? c;
  const lines: string[] = [];
  lines.push(customerName ? `Dear ${customerName},` : 'Hello,');
  lines.push('');
  lines.push(`✈️ *Flight options: ${city(q.origin)} → ${city(q.destination)}*`);
  lines.push(`📅 ${prettyDate(q.date)} · ${q.adults} adult${q.adults > 1 ? 's' : ''} · Economy`);
  lines.push('');
  q.flights.forEach((f, i) => {
    const perPerson = quotePerPerson(f, q.markupPerPerson);
    const total = perPerson * q.adults;
    lines.push(`*${i + 1}) ${f.airline}* ${f.flightNumbers}`);
    lines.push(`   ${time(f.departAt)} ${f.origin} → ${time(f.arriveAt)} ${f.destination} · ${duration(f.durationMinutes)} · ${f.stops === 0 ? 'Non-stop' : `${f.stops} stop`}`);
    lines.push(`   🧳 ${f.baggage}`);
    lines.push(
      q.adults > 1
        ? `   💰 *${money(total, f.currency)}* total (${money(perPerson, f.currency)} per person)`
        : `   💰 *${money(total, f.currency)}*`,
    );
    lines.push('');
  });
  lines.push('Prices include taxes, airline payment charges and our service charge. Fares can change until the ticket is issued.');
  lines.push('Reply with the option number to book.');
  lines.push('');
  lines.push(`— ${agent.agencyName}${agent.contactName ? ` (${agent.contactName})` : ''}`);
  const contact = [agent.phone && `📞 ${agent.phone}`, agent.website].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  return lines.join('\n');
}

/** wa.me link. 10-digit Indian mobile numbers get the 91 country code. */
export function whatsappLink(text: string, phone?: string) {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
