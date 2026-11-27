// /helper: what the AirRex Helper browser extension does and how to install it.

import { Link } from 'react-router-dom';
import { useHelper } from '../lib/helper.ts';
import Icon from '../components/Icon.tsx';

export default function HelperPage() {
  const version = useHelper();
  return (
    <div className="page helper-page">
      <h1>AirRex Helper</h1>
      <p className="muted">
        A free add-on for Chrome or Edge on a computer. On the airline's website it fills the passenger form with the
        details you added in AirRex, and records the prices and fees the airline shows so AirRex stays accurate.
      </p>

      {version ? (
        <p className="hint ok">✓ AirRex Helper {version} is installed in this browser.</p>
      ) : (
        <p className="hint warn">Not installed in this browser yet.</p>
      )}

      <section className="details-card">
        <h2>How it works</h2>
        <ol className="helper-steps">
          <li>In AirRex, open a flight's <b>Book</b> pop-up and add the passengers (scan the passport or type the details).</li>
          <li>Click <b>Continue to the airline</b>. The airline's site opens with a small <b>AirRex Helper</b> panel in the corner.</li>
          <li>On the airline's passenger page, tap a passenger's name in the panel. The form is filled; fields it couldn't fill are highlighted orange.</li>
          <li>Check every detail, then continue and pay on the airline's site yourself.</li>
        </ol>
        <p className="muted small-text">
          Passenger details stay in your browser's memory and are cleared when the browser closes (or after 6 hours); they
          are not sent to AirRex. Prices and fees shown on the airline's pages (including the fare breakdown on the payment
          page) are recorded automatically; card and UPI details and anything you type are never read.
        </p>
      </section>

      <section className="details-card">
        <h2>Install (2 minutes)</h2>
        <ol className="helper-steps">
          <li>
            <a className="btn primary" href="/airrex-helper.zip" download>
              <Icon name="download" /> Download AirRex Helper
            </a>{' '}
            and extract (unzip) it. You get a folder named <b>airrex-helper</b>.
          </li>
          <li>
            Open <code>chrome://extensions</code> in Chrome (or <code>edge://extensions</code> in Edge) by typing it into the
            address bar.
          </li>
          <li>Turn on <b>Developer mode</b> (top-right in Chrome, left side in Edge).</li>
          <li>Click <b>Load unpacked</b> and choose the <b>airrex-helper</b> folder.</li>
          <li>Come back to this page and reload it: it should say the helper is installed.</li>
        </ol>
        <p className="muted small-text">Keep the airrex-helper folder; Chrome loads the add-on from it.</p>
      </section>

      <p>
        <Link to="/">Back to search</Link>
      </p>
    </div>
  );
}
