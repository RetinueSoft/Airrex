import type { FlightOffer, SearchQuery } from '../../shared/types.ts';

export interface FlightProvider {
  name: string;
  isDemo: boolean;
  search(query: SearchQuery): Promise<FlightOffer[]>;
}
