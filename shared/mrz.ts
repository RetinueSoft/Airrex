// Reads the machine-readable zone (MRZ) printed at the bottom of a passport's photo page:
// two lines of 44 characters (ICAO 9303 "TD3"), e.g.
//   P<INDKUMAR<<RAVI<SHANKAR<<<<<<<<<<<<<<<<<<<<
//   Z1234567<4IND8504129M3105201<<<<<<<<<<<<<<02
// Check digits are verified so OCR mistakes are caught before the details are used.

import type { PassengerDetails } from './types.ts';

const WEIGHTS = [7, 3, 1];

function charValue(c: string) {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0; // '<'
}

export function checkDigit(s: string) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += charValue(s[i]) * WEIGHTS[i % 3];
  return String(sum % 10);
}

/** OCR often confuses letters and digits; fix them in fields that can only hold digits. */
function digitsOnly(s: string) {
  return s.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8').replace(/G/g, '6');
}

function mrzDate(yymmdd: string, kind: 'birth' | 'expiry'): string {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = Number(yymmdd.slice(0, 2));
  const nowYY = new Date().getFullYear() % 100;
  // Birth dates are in the past; expiry dates are at most ~10 years ahead.
  const century = kind === 'birth' ? (yy > nowYY ? 1900 : 2000) : yy > nowYY + 20 ? 1900 : 2000;
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  return `${century + yy}-${mm}-${dd}`;
}

const clean = (s: string) => s.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '<');

const FILLER_LOOKALIKES = /[KLCE(]/;

/** Split line 1 into issuing country and [surname, given names], repairing common OCR mistakes. */
function readNameLine(l1: string, nationality: string): { issuing: string; names: string[]; guessed: boolean } {
  let guessed = false;
  // "P<UTO…": the 2nd character is '<' or a document subtype letter. If the country only lines up one place
  // later (e.g. "PKUTO…" for "P<UTO…"), the '<' was misread.
  let start = 2;
  if (nationality && l1.slice(2, 5) !== nationality && l1.slice(3, 6) === nationality) {
    start = 3;
    guessed = true;
  }
  const issuing = l1.slice(start, start + 3).replace(/</g, '');
  let rest = l1.slice(start + 3);

  // Trailing filler read as KKK / LLL / CCC.
  const trimmed = rest.replace(/[<KLCE(]{3,}$/, (run) => (/^<+$/.test(run) ? run : (guessed = true, '')));
  rest = trimmed.replace(/<+$/, '');
  // "<K<" is a misread "<<" (passports spell names out in full, so a lone letter between fillers isn't a name).
  if (/<[KLCE(]</.test(rest)) {
    rest = rest.replace(/<[KLCE(]</g, '<<');
    guessed = true;
  }

  if (rest.includes('<<')) return { issuing, names: [rest.slice(0, rest.indexOf('<<')), rest.slice(rest.indexOf('<<') + 2)], guessed };

  // No '<<' found: the separator was probably misread as two look-alike characters (e.g. "KK").
  const m = /^([A-Z<]*?[A-Z]{2})([KLCE(<]{2})([A-Z].*)$/.exec(rest);
  if (m && FILLER_LOOKALIKES.test(m[2])) {
    return { issuing, names: [m[1], m[3]], guessed: true };
  }
  return { issuing, names: [rest, ''], guessed: true };
}

export interface MrzResult {
  details: PassengerDetails;
  /** All check digits matched (passport number, birth date, expiry). */
  valid: boolean;
  /** Fields whose check digit failed. */
  problems: string[];
  /** The name line (no check digits) needed repairs, so the name may be misspelt. */
  nameUnsure: boolean;
}

/** Find the two passport MRZ lines in OCR or pasted text and read them. Returns null if none found. */
export function parsePassportMrz(text: string): MrzResult | null {
  const lines = text
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => l.length >= 40);
  const i = lines.findIndex((l) => l.startsWith('P'));
  if (i < 0 || !lines[i + 1]) return null;
  const l1 = lines[i].padEnd(44, '<').slice(0, 44);
  const l2raw = lines[i + 1].padEnd(44, '<').slice(0, 44);

  // Line 2 layout: number(9) check, nationality(3), birth(6) check, sex, expiry(6) check, personal(14) check, final check
  const number = l2raw.slice(0, 9);
  const numberCheck = digitsOnly(l2raw[9]);
  const nationality = l2raw.slice(10, 13).replace(/[0-9]/g, (d) => ({ '0': 'O', '1': 'I', '5': 'S', '8': 'B' })[d] ?? d);
  const birth = digitsOnly(l2raw.slice(13, 19));
  const birthCheck = digitsOnly(l2raw[19]);
  const sex = l2raw[20];
  const expiry = digitsOnly(l2raw.slice(21, 27));
  const expiryCheck = digitsOnly(l2raw[27]);

  const problems: string[] = [];
  if (checkDigit(number) !== numberCheck) problems.push('passport number');
  if (checkDigit(birth) !== birthCheck) problems.push('date of birth');
  if (checkDigit(expiry) !== expiryCheck) problems.push('expiry date');
  const nat = nationality.replace(/</g, '');

  // Line 1: P, type, issuing country(3), SURNAME<<GIVEN<NAMES. It has no check digits, and OCR often reads the
  // '<' filler as K or L, so tidy it up (the person is always asked to compare the name with the passport).
  const { issuing, names, guessed } = readNameLine(l1, nat);
  const [surnamePart, givenPart = ''] = names;
  const words = (s: string) => s.split('<').filter(Boolean).join(' ');

  const details: PassengerDetails = {
    surname: words(surnamePart),
    givenNames: words(givenPart),
    sex: sex === 'M' || sex === 'F' ? sex : sex === '<' || sex === 'X' ? 'X' : '',
    dateOfBirth: mrzDate(birth, 'birth'),
    nationality: nationality.replace(/</g, ''),
    passportNumber: number.replace(/</g, ''),
    issuingCountry: issuing,
    passportExpiry: mrzDate(expiry, 'expiry'),
  };
  return { details, valid: problems.length === 0, problems, nameUnsure: guessed || (!details.surname && !details.givenNames) };
}
