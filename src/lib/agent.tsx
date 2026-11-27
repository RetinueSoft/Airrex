// Logged-in travel agent, shared across the app.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AgentProfile, FlightOffer, PassengerDetails, SavedPassenger, SavedQuote, SearchQuery } from '../../shared/types.ts';

import { clearAllTripPassengers } from './tripPassengers.ts';
import { clearHelper } from './helper.ts';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/agent/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface SignupInput {
  mobile: string;
  password: string;
  agencyName: string;
  contactName: string;
  email: string;
}

interface AgentState {
  agent: AgentProfile | null;
  loading: boolean;
  login(mobile: string, password: string): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;
  saveProfile(p: Partial<AgentProfile>): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const Ctx = createContext<AgentState | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    call<AgentProfile>('GET', 'me')
      .then(setAgent)
      .catch(() => setAgent(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (mobile: string, password: string) => {
    setAgent(await call<AgentProfile>('POST', 'login', { mobile, password }));
  }, []);
  const signup = useCallback(async (input: SignupInput) => {
    setAgent(await call<AgentProfile>('POST', 'signup', input));
  }, []);
  const logout = useCallback(async () => {
    await call('POST', 'logout', {});
    // Nothing of this agency's work should stay for the next person using this computer.
    clearAllTripPassengers();
    clearHelper();
    setAgent(null);
  }, []);
  const saveProfile = useCallback(
    async (p: Partial<AgentProfile>) => {
      if (!agent) return;
      setAgent(await call<AgentProfile>('PUT', 'profile', { ...agent, ...p }));
    },
    [agent],
  );
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await call('POST', 'password', { currentPassword, newPassword });
  }, []);

  return <Ctx.Provider value={{ agent, loading, login, signup, logout, saveProfile, changePassword }}>{children}</Ctx.Provider>;
}

export function useAgent() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAgent must be inside AgentProvider');
  return v;
}

export const quotesApi = {
  list: () => call<SavedQuote[]>('GET', 'quotes'),
  save: (q: Omit<SavedQuote, 'id' | 'createdAt' | 'updatedAt'>) => call<{ id: number }>('POST', 'quotes', q),
  update: (id: number, q: Omit<SavedQuote, 'id' | 'createdAt' | 'updatedAt'>) => call<{ id: number }>('PUT', `quotes/${id}`, q),
  remove: (id: number) => call('DELETE', `quotes/${id}`),
};

export const passengersApi = {
  list: () => call<SavedPassenger[]>('GET', 'passengers'),
  save: (passenger: PassengerDetails, keepDays: number) =>
    call<SavedPassenger>('POST', 'passengers', { passenger, keepDays, consent: true }),
  remove: (id: number) => call('DELETE', `passengers/${id}`),
};

export const recentSearchesApi = {
  list: () => call<{ id: number; origin: string; destination: string; date: string; adults: number; at: string }[]>('GET', 'recent-searches'),
  save: (s: { origin: string; destination: string; date: string; adults: number }) => call('POST', 'recent-searches', s),
  remove: (id: number) => call('DELETE', `recent-searches/${id}`),
};

export const tripsApi = {
  list: () => call<{ id: number; savedAt: string; query: SearchQuery; offer: FlightOffer }[]>('GET', 'trips'),
  save: (query: SearchQuery, offer: FlightOffer) => call('POST', 'trips', { query, offer }),
  remove: (id: number) => call('DELETE', `trips/${id}`),
};

export function daysLeft(agent: AgentProfile) {
  const end = Date.parse(agent.inGrace ? agent.graceEndsAt : agent.expiresAt);
  return Math.max(0, Math.ceil((end - Date.now()) / 86400_000));
}

export function onTrial(agent: AgentProfile) {
  return Date.parse(agent.trialEndsAt) > Date.now() && !(agent.paidUntil && Date.parse(agent.paidUntil) > Date.now());
}
