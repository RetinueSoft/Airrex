// Indian mobile numbers, used as the login for agencies and the site admin.
// Accepts "9943135008", "99431 35008", "+91 99431 35008", "09943135008"; stores the 10 digits.

/** The 10-digit mobile number, or '' when it isn't a valid Indian mobile number. */
export function normalizeMobile(input: unknown): string {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  let d = String(input).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
