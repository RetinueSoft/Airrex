import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import SearchPage from './pages/SearchPage.tsx';
import ResultsPage from './pages/ResultsPage.tsx';
import TripsPage from './pages/TripsPage.tsx';
import CalendarPage from './pages/CalendarPage.tsx';
import Icon from './components/Icon.tsx';
import AgentLoginPage from './pages/AgentLoginPage.tsx';
import AgentDashboardPage from './pages/AgentDashboardPage.tsx';
import QuotesPage from './pages/QuotesPage.tsx';
import { useAgent } from './lib/agent.tsx';

// pdf.js is large, so the print tool loads only when opened.
const TicketPrintPage = lazy(() => import('./pages/TicketPrintPage.tsx'));

export default function App() {
  const { pathname } = useLocation();
  const { agent } = useAgent();
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark"><Icon name="flight_takeoff" size={20} /></span>
            AirRex
          </NavLink>
          <nav aria-label="Primary navigation">
            {/* "Search" stays highlighted on the results page too. */}
            <NavLink to="/" end className={({ isActive }) => (isActive || pathname === '/results' ? 'active' : '')}>
              Search
            </NavLink>
            <NavLink to="/cheapest-dates">Cheapest dates</NavLink>
            <NavLink to="/trips">My trips</NavLink>
            <NavLink to="/print" className="nav-print">
              <Icon name="confirmation_number" /> Print ticket
            </NavLink>
            <NavLink to={agent ? '/agent' : '/agent/login'} className="nav-agent" title={agent ? agent.agencyName : 'For travel agents'}>
              <Icon name={agent ? 'storefront' : 'login'} />
              <span className="nav-agent-label">{agent ? agent.agencyName : 'For agents'}</span>
            </NavLink>
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/cheapest-dates" element={<CalendarPage />} />
          <Route path="/agent/login" element={<AgentLoginPage />} />
          <Route path="/agent" element={<AgentDashboardPage />} />
          <Route path="/agent/quotes" element={<QuotesPage />} />
          <Route path="/agent/quotes/:id" element={<QuotesPage />} />
          <Route path="/print" element={<Suspense fallback={<p className="page muted">Loading…</p>}><TicketPrintPage /></Suspense>} />
          <Route path="*" element={<SearchPage />} />
        </Routes>
      </main>
      <footer className="footer no-print">
        AirRex compares fares only. Tickets are booked and paid for on the airline's own website.
      </footer>
    </div>
  );
}
