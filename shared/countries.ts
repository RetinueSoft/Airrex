// Names for the 3-letter country codes printed on passports (common ones for Tamil Nadu travellers).
const NAMES: Record<string, string> = {
  IND: 'India', LKA: 'Sri Lanka', SGP: 'Singapore', MYS: 'Malaysia', ARE: 'United Arab Emirates', SAU: 'Saudi Arabia',
  QAT: 'Qatar', OMN: 'Oman', KWT: 'Kuwait', BHR: 'Bahrain', THA: 'Thailand', BGD: 'Bangladesh', NPL: 'Nepal',
  GBR: 'United Kingdom', USA: 'United States', CAN: 'Canada', AUS: 'Australia', NZL: 'New Zealand', DEU: 'Germany',
  FRA: 'France', MUS: 'Mauritius', MDV: 'Maldives', IDN: 'Indonesia', PHL: 'Philippines', CHN: 'China', HKG: 'Hong Kong',
  JPN: 'Japan', MMR: 'Myanmar', BRN: 'Brunei',
};

/** Nationality adjective airlines usually list in their dropdowns. */
const NATIONALITY: Record<string, string> = { IND: 'Indian', LKA: 'Sri Lankan', SGP: 'Singaporean', MYS: 'Malaysian' };

export function countryName(code: string) {
  return NAMES[code] ?? code;
}

export function nationalityName(code: string) {
  return NATIONALITY[code] ?? countryName(code);
}
