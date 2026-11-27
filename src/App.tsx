import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import SearchPage from './pages/SearchPage.tsx';
import ResultsPage from './pages/ResultsPage.tsx';
import TripsPage from './pages/TripsPage.tsx';
import CalendarPage from './pages/CalendarPage.tsx';
import Icon from './components/Icon.tsx';
import AgentLoginPage from './pages/AgentLoginPage.tsx';
import AgentDashboardPage from './pages/AgentDashboardPage.tsx';
import QuotesPage from './pages/QuotesPage.tsx';
import PassengersPage from './pages/PassengersPage.tsx';
import HelperPage from './pages/HelperPage.tsx';
import SiteAdminPage from './pages/SiteAdminPage.tsx';
import { useAgent } from './lib/agent.tsx';

// pdf.js is large, so the print tool loads only when opened.
const TicketPrintPage = lazy(() => import('./pages/TicketPrintPage.tsx'));

function Shell({ nav, children }: { nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark"><Icon name="flight_takeoff" size={20} /></span>
            AirRex
          </NavLink>
          {nav && <nav aria-label="Primary navigation">{nav}</nav>}
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer no-print">
        AirRex compares fares only. Tickets are booked and paid for on the airline's own website.
      </footer>
    </div>
  );
}

/**
 * AirRex is for logged-in agencies only:
 *  - not logged in: only the login / sign-up page (any address shows it), no menus;
 *  - logged in but not active (waiting for activation, suspended or licence over): only the Account page;
 *  - active: the whole app.
 * /site-admin has its own login (user rexl).
 */
export default function App() {
  const { pathname } = useLocation();
  const { agent, loading } = useAgent();

  if (pathname === '/site-admin') return <Shell><SiteAdminPage /></Shell>;
  if (loading) return <Shell><p className="page muted">Loading…</p></Shell>;
  if (!agent) return <Shell><AgentLoginPage /></Shell>;

  const accountLink = (
    <NavLink to="/agent" className="nav-agent" title={agent.agencyName}>
      <Icon name="storefront" />
      <span className="nav-agent-label">{agent.agencyName}</span>
    </NavLink>
  );

  if (!agent.active) {
    return (
      <Shell nav={accountLink}>
        <Routes>
          <Route path="/agent" element={<AgentDashboardPage />} />
          <Route path="*" element={<Navigate to="/agent" replace />} />
        </Routes>
      </Shell>
    );
  }

  return (
    <Shell
      nav={
        <>
          {/* "Search" stays highlighted on the results page too. */}
          <NavLink to="/" end className={({ isActive }) => (isActive || pathname === '/results' ? 'active' : '')}>
            Search
          </NavLink>
          <NavLink to="/cheapest-dates">Cheapest dates</NavLink>
          <NavLink to="/trips">My trips</NavLink>
          <NavLink to="/print" className="nav-print">
            <Icon name="confirmation_number" /> Print ticket
          </NavLink>
          {accountLink}
        </>
      }
    >
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/cheapest-dates" element={<CalendarPage />} />
        <Route path="/agent/login" element={<Navigate to="/" replace />} />
        <Route path="/agent" element={<AgentDashboardPage />} />
        <Route path="/agent/quotes" element={<QuotesPage />} />
        <Route path="/agent/quotes/:id" element={<QuotesPage />} />
        <Route path="/agent/passengers" element={<PassengersPage />} />
        <Route path="/helper" element={<HelperPage />} />
        <Route path="/print" element={<Suspense fallback={<p className="page muted">Loading…</p>}><TicketPrintPage /></Suspense>} />
        <Route path="*" element={<SearchPage />} />
      </Routes>
    </Shell>
  );
}
