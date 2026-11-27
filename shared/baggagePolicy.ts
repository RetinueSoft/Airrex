// Usual Economy baggage for each airline's cheapest fare. Used only when the flight data has no baggage
// details (Google Flights search results don't include them). Shown as "Usually …", never as confirmed.
// Allowances change and differ by fare type; update this table when an airline changes its policy.

import { findAirport } from './airports.ts';
import type { Baggage } from './types.ts';

interface Policy {
  cabinKg: number;
  /** true = check-in bag in the cheapest fare, false = cabin only (check-in costs extra), undefined = depends on fare. */
  checked?: boolean;
  checkInKg?: number;
  note?: string;
  extra?: Baggage['extra'];
  /** Extra-baggage price that depends on the other country of an international trip. */
  extraByCountry?: Record<string, NonNullable<Baggage['extra']>>;
  addBag?: Baggage['addBag'];
  bagFare?: Baggage['bagFare'];
}

const FULL_SERVICE: Policy = { cabinKg: 7, checked: true };
const CABIN_ONLY = (cabinKg: number, note?: string): Policy => ({ cabinKg, checked: false, note });

// Extra-baggage prices checked on the airlines' own pages (Nov 2026):
//   IndiGo  goindigo.in/information/fees-and-charges.html: 3 kg pre-paid ₹2,250, airport ₹800/kg;
//           Lite (cabin-only) fare: 15 kg check-in bag ₹2,000 domestic, ₹3,500 international.
//   Akasa   akasaair.com/add-ons/excess-baggage: 3 kg pre-paid ₹2,250, airport ₹800/kg.
//   Air India Express "Fees & Charges" PDF (Oct 2026):
//           domestic Value 15 kg incl.; +3 kg ₹2,250 pre-book; airport up to ₹850/kg;
//           domestic Lite 0 kg; add 10 kg ₹1,000 / 15 kg ₹1,500 pre-book (15 kg ₹2,000 at the airport);
//           international Value: +5 kg ₹6,800 (Gulf) / ₹7,000 (Singapore) pre-book;
//           airport ₹1,500–1,650/kg (Gulf), ₹2,000/kg (Singapore).
// International fares seen on Tamil Nadu routes (Trichy–Singapore etc., Nov 2026, from the AirRex owner):
//   the cheapest fare has no check-in bag; the next fare type with a bag costs more per person:
//   Scoot +20 kg ₹3,700–4,000 · Air India Express +30 kg ₹900–1,500 · IndiGo +30 kg ₹300–600.
//   SriLankan's cheapest fare already includes 30 kg.
// Other airlines: usual allowances only (no published INR extra-bag price found).

/** Flights within India. */
const DOMESTIC: Record<string, Policy> = {
  '6E': {
    cabinKg: 7, checked: true, checkInKg: 15,
    extra: { kg: 3, price: 2250, airportPerKg: 800 },
    note: 'IndiGo Lite fares are cabin bag only; a 15 kg check-in bag costs ₹2,000 on those.',
  }, // IndiGo
  QP: { cabinKg: 7, checked: true, checkInKg: 15, extra: { kg: 3, price: 2250, airportPerKg: 800 } }, // Akasa Air
  AI: { cabinKg: 7, checked: true, checkInKg: 15 }, // Air India
  SG: { cabinKg: 7, checked: true, checkInKg: 15 }, // SpiceJet
  IX: {
    cabinKg: 7,
    extra: { kg: 3, price: 2250, airportPerKg: 850 },
    note: 'Xpress Lite fares are cabin bag only (add 10 kg for ₹1,000 or 15 kg for ₹1,500 when booking); Xpress Value includes a 15 kg check-in bag (extra 3 kg ₹2,250).',
  }, // Air India Express
  '9I': { cabinKg: 5, checked: true, checkInKg: 15 }, // Alliance Air
};

/** Flights to or from another country. */
const INTERNATIONAL: Record<string, Policy> = {
  '6E': {
    cabinKg: 7, checked: false, bagFare: { kg: 30, from: 300, to: 600 },
    note: 'The cheapest IndiGo fare has no check-in bag. The next fare with 30 kg usually costs ₹300–600 more; adding a 15 kg bag later costs ₹3,500.',
  },
  QP: { cabinKg: 7, checked: true },
  AI: FULL_SERVICE,
  SG: { cabinKg: 7, checked: true },
  IX: {
    cabinKg: 7, checked: false, bagFare: { kg: 30, from: 900, to: 1500 },
    extraByCountry: {
      AE: { kg: 5, price: 6800, airportPerKg: 1650 }, QA: { kg: 5, price: 6800, airportPerKg: 1650 }, BH: { kg: 5, price: 6800, airportPerKg: 1650 }, OM: { kg: 5, price: 6800, airportPerKg: 1650 }, SA: { kg: 5, price: 6800, airportPerKg: 1650 },
      KW: { kg: 5, price: 7200, airportPerKg: 1750 },
      SG: { kg: 5, price: 7000, airportPerKg: 2000 },
      TH: { kg: 5, price: 7700, airportPerKg: 2000 },
    },
    note: 'The cheapest (Xpress Lite) fare has no check-in bag. Xpress Value with 30 kg usually costs ₹900–1,500 more. Extra 5 kg on Value: ₹6,800 to the Gulf, ₹7,000 to Singapore if pre-booked (₹1,500–2,000/kg at the airport).',
  },
  TR: {
    ...CABIN_ONLY(10, "Scoot's cheapest (Fly) fare is cabin bag only. The next fare (FlyBag) with 20 kg usually costs ₹3,700–4,000 more."),
    bagFare: { kg: 20, from: 3700, to: 4000 },
  }, // Scoot
  OD: { cabinKg: 7, note: 'Batik Air Malaysia: check-in bag depends on the fare type; check when booking.' }, // Batik Air Malaysia
  SL: { cabinKg: 7, note: 'Thai Lion Air: check-in bag depends on the fare type.' }, // Thai Lion Air
  G9: CABIN_ONLY(10, "Air Arabia's cheapest (Basic) fare has no check-in bag."), // Air Arabia
  '3L': CABIN_ONLY(10, "Air Arabia's cheapest (Basic) fare has no check-in bag."), // Air Arabia Abu Dhabi
  OV: CABIN_ONLY(7, "SalamAir's cheapest (Light) fare has no check-in bag."), // SalamAir
  J9: CABIN_ONLY(7, "Jazeera's cheapest (Light) fare has no check-in bag."), // Jazeera Airways
  AK: CABIN_ONLY(7), // AirAsia
  FD: CABIN_ONLY(7), // Thai AirAsia
  D7: CABIN_ONLY(7), // AirAsia X
  QZ: CABIN_ONLY(7), // Indonesia AirAsia
  VJ: CABIN_ONLY(7), // VietJet
  EK: FULL_SERVICE, // Emirates
  SQ: FULL_SERVICE, // Singapore Airlines
  QR: FULL_SERVICE, // Qatar Airways
  EY: FULL_SERVICE, // Etihad
  BA: FULL_SERVICE, // British Airways
  UL: { cabinKg: 7, checked: true, checkInKg: 30 }, // SriLankan: 30 kg even on the cheapest fare
  MH: FULL_SERVICE, // Malaysia Airlines
  TG: FULL_SERVICE, // Thai Airways
  CX: FULL_SERVICE, // Cathay Pacific
  LH: FULL_SERVICE, // Lufthansa
  WY: FULL_SERVICE, // Oman Air
  GF: FULL_SERVICE, // Gulf Air
  SV: FULL_SERVICE, // Saudia
  KU: FULL_SERVICE, // Kuwait Airways
  ET: FULL_SERVICE, // Ethiopian
  MK: FULL_SERVICE, // Air Mauritius
  BG: FULL_SERVICE, // Biman Bangladesh
  BS: FULL_SERVICE, // US-Bangla
  BI: FULL_SERVICE, // Royal Brunei
};

/** The airline's usual allowance for this route, or undefined if we don't know the airline. */
export function typicalBaggage(airlineCode: string, origin: string, destination: string): Baggage | undefined {
  const from = findAirport(origin)?.country;
  const to = findAirport(destination)?.country;
  const domestic = from === 'IN' && to === 'IN';
  const p = (domestic ? DOMESTIC : INTERNATIONAL)[airlineCode];
  if (!p) return undefined;
  return {
    typical: true,
    cabinIncluded: true,
    cabinKg: p.cabinKg,
    checkedIncluded: p.checked,
    checkInKg: p.checked ? p.checkInKg : undefined,
    checkedForFee: p.checked === false ? true : undefined,
    notes: p.note ? [p.note] : undefined,
    extra: p.extra ?? p.extraByCountry?.[from === 'IN' ? (to ?? '') : (from ?? '')],
    addBag: p.addBag,
    bagFare: p.checked === false ? p.bagFare : undefined,
  };
}
