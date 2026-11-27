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
  TR: { code: 'TR', name: 'Scoot', color: '#ffd100', website: 'https://www.flyscoot.com', bookingUrl: 'https://www.flyscoot.com/' },
  AK: { code: 'AK', name: 'AirAsia', color: '#ff0000', website: 'https://www.airasia.com', bookingUrl: 'https://www.airasia.com/' },
  FD: { code: 'FD', name: 'Thai AirAsia', color: '#ff0000', website: 'https://www.airasia.com', bookingUrl: 'https://www.airasia.com/' },
  OD: { code: 'OD', name: 'Batik Air Malaysia', color: '#7a1c3c', website: 'https://www.batikair.com', bookingUrl: 'https://www.batikair.com/' },
  UL: { code: 'UL', name: 'SriLankan Airlines', color: '#003f87', website: 'https://www.srilankan.com', bookingUrl: 'https://www.srilankan.com/' },
  MH: { code: 'MH', name: 'Malaysia Airlines', color: '#00205b', website: 'https://www.malaysiaairlines.com', bookingUrl: 'https://www.malaysiaairlines.com/' },
  G9: { code: 'G9', name: 'Air Arabia', color: '#e31837', website: 'https://www.airarabia.com', bookingUrl: 'https://www.airarabia.com/' },
  '3L': { code: '3L', name: 'Air Arabia Abu Dhabi', color: '#e31837', website: 'https://www.airarabia.com', bookingUrl: 'https://www.airarabia.com/' },
  EY: { code: 'EY', name: 'Etihad Airways', color: '#bd8b13', website: 'https://www.etihad.com', bookingUrl: 'https://www.etihad.com/' },
  GF: { code: 'GF', name: 'Gulf Air', color: '#8a1538', website: 'https://www.gulfair.com', bookingUrl: 'https://www.gulfair.com/' },
  WY: { code: 'WY', name: 'Oman Air', color: '#7b6a3a', website: 'https://www.omanair.com', bookingUrl: 'https://www.omanair.com/' },
  OV: { code: 'OV', name: 'SalamAir', color: '#00a19a', website: 'https://www.salamair.com', bookingUrl: 'https://www.salamair.com/' },
  KU: { code: 'KU', name: 'Kuwait Airways', color: '#0c3c78', website: 'https://www.kuwaitairways.com', bookingUrl: 'https://www.kuwaitairways.com/' },
  J9: { code: 'J9', name: 'Jazeera Airways', color: '#00205b', website: 'https://www.jazeeraairways.com', bookingUrl: 'https://www.jazeeraairways.com/' },
  TG: { code: 'TG', name: 'Thai Airways', color: '#4b0f6b', website: 'https://www.thaiairways.com', bookingUrl: 'https://www.thaiairways.com/' },
  SL: { code: 'SL', name: 'Thai Lion Air', color: '#e2231a', website: 'https://www.lionairthai.com', bookingUrl: 'https://www.lionairthai.com/' },
  CX: { code: 'CX', name: 'Cathay Pacific', color: '#006564', website: 'https://www.cathaypacific.com', bookingUrl: 'https://www.cathaypacific.com/' },
  LH: { code: 'LH', name: 'Lufthansa', color: '#05164d', website: 'https://www.lufthansa.com', bookingUrl: 'https://www.lufthansa.com/' },
  ET: { code: 'ET', name: 'Ethiopian Airlines', color: '#2e7d32', website: 'https://www.ethiopianairlines.com', bookingUrl: 'https://www.ethiopianairlines.com/' },
  MK: { code: 'MK', name: 'Air Mauritius', color: '#c8102e', website: 'https://www.airmauritius.com', bookingUrl: 'https://www.airmauritius.com/' },
  BG: { code: 'BG', name: 'Biman Bangladesh Airlines', color: '#006a4e', website: 'https://www.biman-airlines.com', bookingUrl: 'https://www.biman-airlines.com/' },
  BS: { code: 'BS', name: 'US-Bangla Airlines', color: '#1e3f8a', website: 'https://www.usbair.com', bookingUrl: 'https://www.usbair.com/' },
  BI: { code: 'BI', name: 'Royal Brunei Airlines', color: '#1a1a1a', website: 'https://www.flyroyalbrunei.com', bookingUrl: 'https://www.flyroyalbrunei.com/' },
  '8D': { code: '8D', name: 'FitsAir', color: '#0b5fa5', website: 'https://www.fitsair.com', bookingUrl: 'https://www.fitsair.com/' },
  '9I': { code: '9I', name: 'Alliance Air', color: '#d62828', website: 'https://www.allianceair.in', bookingUrl: 'https://www.allianceair.in/' },
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
