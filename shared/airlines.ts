// Airline directory used for logos/colours and for sending the user to the airline's own website.

export interface AirlineInfo {
  code: string;
  name: string;
  color: string;
  website: string;
  /** Page where a customer starts a booking on the airline's own site. */
  bookingUrl: string;
}

export const AIRLINES: Record<string, AirlineInfo> = {
  '6E': { code: '6E', name: 'IndiGo', color: '#1b1f6b', website: 'https://www.goindigo.in', bookingUrl: 'https://www.goindigo.in/' },
  AI: { code: 'AI', name: 'Air India', color: '#c8102e', website: 'https://www.airindia.com', bookingUrl: 'https://www.airindia.com/' },
  IX: { code: 'IX', name: 'Air India Express', color: '#e4572e', website: 'https://www.airindiaexpress.com', bookingUrl: 'https://www.airindiaexpress.com/' },
  QP: { code: 'QP', name: 'Akasa Air', color: '#ff6d38', website: 'https://www.akasaair.com', bookingUrl: 'https://www.akasaair.com/' },
  SG: { code: 'SG', name: 'SpiceJet', color: '#d71920', website: 'https://www.spicejet.com', bookingUrl: 'https://www.spicejet.com/' },
  EK: { code: 'EK', name: 'Emirates', color: '#d71921', website: 'https://www.emirates.com', bookingUrl: 'https://www.emirates.com/in/english/' },
  SQ: { code: 'SQ', name: 'Singapore Airlines', color: '#1d2d5c', website: 'https://www.singaporeair.com', bookingUrl: 'https://www.singaporeair.com/en_UK/in/home' },
  QR: { code: 'QR', name: 'Qatar Airways', color: '#5c0632', website: 'https://www.qatarairways.com', bookingUrl: 'https://www.qatarairways.com/en-in/homepage.html' },
  BA: { code: 'BA', name: 'British Airways', color: '#075aaa', website: 'https://www.britishairways.com', bookingUrl: 'https://www.britishairways.com/' },
};

export function airlineInfo(code: string, fallbackName?: string): AirlineInfo {
  return (
    AIRLINES[code] ?? {
      code,
      name: fallbackName ?? code,
      color: '#475569',
      website: `https://www.google.com/search?q=${encodeURIComponent((fallbackName ?? code) + ' airline official site')}`,
      bookingUrl: `https://www.google.com/search?q=${encodeURIComponent((fallbackName ?? code) + ' airline book flight')}`,
    }
  );
}
