// Toolbar pop-up: shows the trip handed over from AirRex and lets the person forget it.
const main = document.getElementById('main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function show(trip) {
  if (!trip) {
    main.innerHTML = `<p>No trip yet.</p>
      <p class="m">In AirRex, open a flight's <b>Book</b> pop-up, add passengers, and click <b>Continue to the airline</b>.
      The airline site then shows the AirRex panel to fill passenger details.</p>`;
    return;
  }
  const pax = trip.passengers ?? [];
  main.innerHTML = `
    <p><b>${esc(trip.query.origin)} → ${esc(trip.query.destination)}</b> · ${esc(trip.query.date)}<br>
    ${esc(trip.offer.airlineName)} ${esc(trip.offer.flightNumbers)}</p>
    <p class="m">${pax.length} passenger${pax.length === 1 ? '' : 's'} ready to fill · prices recorded automatically on ${trip.captures ?? 0} page(s).</p>
    <p class="m">Passenger details are kept in this browser's memory only and are cleared when the browser closes (or after 6 hours).</p>
    <button id="clear">Forget this trip</button>`;
  document.getElementById('clear').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'trip:clear' }, () => show(null)));
}

chrome.runtime.sendMessage({ type: 'trip:get' }, (r) => show(r?.trip ?? null));
