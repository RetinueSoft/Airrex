import type { Airport } from './types.ts';

// Starter list. Replace with a full airport dataset (e.g. OurAirports) when going live.
export const AIRPORTS: Airport[] = [
  { code: 'DEL', city: 'New Delhi', name: 'Indira Gandhi International', country: 'IN' },
  { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International', country: 'IN' },
  { code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International', country: 'IN' },
  { code: 'MAA', city: 'Chennai', name: 'Chennai International', country: 'IN' },
  { code: 'HYD', city: 'Hyderabad', name: 'Rajiv Gandhi International', country: 'IN' },
  { code: 'CCU', city: 'Kolkata', name: 'Netaji Subhas Chandra Bose International', country: 'IN' },
  { code: 'AMD', city: 'Ahmedabad', name: 'Sardar Vallabhbhai Patel International', country: 'IN' },
  { code: 'PNQ', city: 'Pune', name: 'Pune International', country: 'IN' },
  { code: 'GOI', city: 'Goa', name: 'Dabolim', country: 'IN' },
  { code: 'GOX', city: 'Goa', name: 'Manohar International (Mopa)', country: 'IN' },
  { code: 'COK', city: 'Kochi', name: 'Cochin International', country: 'IN' },
  { code: 'TRV', city: 'Thiruvananthapuram', name: 'Trivandrum International', country: 'IN' },
  { code: 'JAI', city: 'Jaipur', name: 'Jaipur International', country: 'IN' },
  { code: 'LKO', city: 'Lucknow', name: 'Chaudhary Charan Singh International', country: 'IN' },
  { code: 'IXC', city: 'Chandigarh', name: 'Chandigarh International', country: 'IN' },
  { code: 'GAU', city: 'Guwahati', name: 'Lokpriya Gopinath Bordoloi International', country: 'IN' },
  { code: 'PAT', city: 'Patna', name: 'Jay Prakash Narayan International', country: 'IN' },
  { code: 'VNS', city: 'Varanasi', name: 'Lal Bahadur Shastri International', country: 'IN' },
  { code: 'BBI', city: 'Bhubaneswar', name: 'Biju Patnaik International', country: 'IN' },
  { code: 'IXB', city: 'Bagdogra', name: 'Bagdogra International', country: 'IN' },
  { code: 'SXR', city: 'Srinagar', name: 'Sheikh ul-Alam International', country: 'IN' },
  { code: 'IXZ', city: 'Port Blair', name: 'Veer Savarkar International', country: 'IN' },
  { code: 'VTZ', city: 'Visakhapatnam', name: 'Visakhapatnam International', country: 'IN' },
  { code: 'CJB', city: 'Coimbatore', name: 'Coimbatore International', country: 'IN' },
  { code: 'IXE', city: 'Mangaluru', name: 'Mangaluru International', country: 'IN' },
  { code: 'TRZ', city: 'Tiruchirappalli', name: 'Tiruchirappalli International', country: 'IN' },
  { code: 'IXM', city: 'Madurai', name: 'Madurai Airport', country: 'IN' },
  { code: 'CCJ', city: 'Kozhikode', name: 'Calicut International', country: 'IN' },
  { code: 'CNN', city: 'Kannur', name: 'Kannur International', country: 'IN' },
  { code: 'TIR', city: 'Tirupati', name: 'Tirupati Airport', country: 'IN' },
  { code: 'HBX', city: 'Hubballi', name: 'Hubballi Airport', country: 'IN' },
  { code: 'IXG', city: 'Belagavi', name: 'Belagavi Airport', country: 'IN' },
  { code: 'TCR', city: 'Thoothukudi', name: 'Tuticorin Airport', country: 'IN' },
  { code: 'NAG', city: 'Nagpur', name: 'Dr. Babasaheb Ambedkar International', country: 'IN' },
  { code: 'IDR', city: 'Indore', name: 'Devi Ahilya Bai Holkar', country: 'IN' },
  { code: 'DXB', city: 'Dubai', name: 'Dubai International', country: 'AE' },
  { code: 'SIN', city: 'Singapore', name: 'Changi', country: 'SG' },
  { code: 'LHR', city: 'London', name: 'Heathrow', country: 'GB' },
  { code: 'BKK', city: 'Bangkok', name: 'Suvarnabhumi', country: 'TH' },
  { code: 'DOH', city: 'Doha', name: 'Hamad International', country: 'QA' },
];

export function findAirport(code: string): Airport | undefined {
  return AIRPORTS.find((a) => a.code === code.toUpperCase());
}
