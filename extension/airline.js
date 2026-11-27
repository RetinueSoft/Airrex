// Runs on airline websites. Shows the AirRex panel when a trip was handed over from AirRex:
//  - "Fill passenger N": fills the airline's passenger form (the person checks it and continues themselves).
//  - Records the prices/fees each page shows (text lines with amounts) and sends them to AirRex.
//    On the payment page only the fare breakdown text is read (never card/UPI details or anything typed).

(() => {
  if (window.top !== window || document.getElementById('airrex-helper-root')) return;
  const E = globalThis.AirRexEngine;
  if (!E) return;

  const HOST_AIRLINE = [
    [/goindigo\.in$/, '6E'], [/airindiaexpress\.com$/, 'IX'], [/airindia\.com$/, 'AI'], [/akasaair\.com$/, 'QP'],
    [/spicejet\.com$/, 'SG'], [/flyscoot\.com$/, 'TR'], [/srilankan\.com$/, 'UL'], [/airasia\.com$/, 'AK'],
    [/batikair\.com$/, 'OD'], [/malaysiaairlines\.com$/, 'MH'], [/airarabia\.com$/, 'G9'], [/emirates\.com$/, 'EK'],
    [/singaporeair\.com$/, 'SQ'], [/qatarairways\.com$/, 'QR'], [/etihad\.com$/, 'EY'], [/salamair\.com$/, 'OV'],
    [/omanair\.com$/, 'WY'], [/gulfair\.com$/, 'GF'], [/allianceair\.in$/, '9I'],
  ];
  const siteAirline = HOST_AIRLINE.find(([re]) => re.test(location.hostname))?.[1] ?? '';

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r ?? {})));
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let trip = null;
  let captured = 0;
  let lastSignature = '';
  let status = '';
  let collapsed = false;
  const openPax = new Set([0]); // passengers whose copy list is open (first one by default)
  let searchOpen = false;

  const COUNTRY = { IND: ['India', 'Indian'], LKA: ['Sri Lanka', 'Sri Lankan'], SGP: ['Singapore', 'Singaporean'], MYS: ['Malaysia', 'Malaysian'] };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function ageOn(dob, onDate) {
    const [ay, am, ad] = dob.split('-').map(Number);
    const [by, bm, bd] = onDate.split('-').map(Number);
    return by - ay - (bm < am || (bm === am && bd < ad) ? 1 : 0);
  }

  /** Every field an airline form asks for, in the airline's date style, for copying by hand. */
  function copyFields(p) {
    const style = E.siteDateStyle();
    const date = (ymd) => (ymd ? E.formatDate(ymd, style) : '');
    const longDate = (ymd) => {
      const [y, m, d] = (ymd || '').split('-');
      return y ? `${Number(d)} ${MON[Number(m) - 1]} ${y}` : '';
    };
    const adult = !p.dateOfBirth || ageOn(p.dateOfBirth, trip.query.date) >= 12;
    const title = p.sex === 'M' ? (adult ? 'Mr' : 'Master') : p.sex === 'F' ? (adult ? 'Ms' : 'Miss') : '';
    const [natName, natAdj] = COUNTRY[p.nationality] || [p.nationality, p.nationality];
    const [issName] = COUNTRY[p.issuingCountry] || [p.issuingCountry];
    return [
      ['Title', title],
      ['First / given name', p.givenNames],
      ['Last name / surname', p.surname],
      ['Gender', p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex === 'X' ? 'Other' : ''],
      ['Date of birth', date(p.dateOfBirth), longDate(p.dateOfBirth)],
      ['Nationality', natAdj, natName !== natAdj ? natName : ''],
      ['Passport number', p.passportNumber],
      ['Issuing country', issName],
      ['Passport expiry', date(p.passportExpiry), longDate(p.passportExpiry)],
    ].filter(([, v]) => v);
  }

  /** The flight search, for typing into the airline's search form by hand. */
  function searchFields() {
    const q = trip.query;
    const o = trip.offer;
    const [y, m, d] = q.date.split('-');
    const day = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', { weekday: 'short' });
    const time = (o.departAt || '').slice(11, 16);
    return [
      ['Trip', 'One way'],
      ['From', q.origin, q.originCity],
      ['To', q.destination, q.destinationCity],
      ['Departure date', E.formatDate(q.date, E.siteDateStyle()), `${day} ${Number(d)} ${MON[Number(m) - 1]} ${y}`],
      ['Adults', String(q.adults)],
      ['Flight', o.flightNumbers, time ? `departs ${time}` : ''],
    ];
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older pages / blocked clipboard API: copy through a temporary text box.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      root.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- Panel (shadow DOM so the airline's CSS can't break it) ----------
  const host = document.createElement('div');
  host.id = 'airrex-helper-root';
  host.style.cssText = 'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .p{font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,.18);width:320px;max-width:calc(100vw - 32px);overflow:hidden}
    .h{display:flex;align-items:center;gap:8px;background:#0a1c34;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}
    .h span{margin-left:auto;font-weight:400;opacity:.8;font-size:12px}
    .b{padding:10px 12px;display:grid;gap:8px;max-height:70vh;overflow:auto}
    .m{color:#475569;font-size:12px}
    .w{color:#92400e;background:#fef3c7;border-radius:8px;padding:6px 8px;font-size:12px}
    .ok{color:#166534;background:#dcfce7;border-radius:8px;padding:6px 8px;font-size:12px}
    button{font:inherit;font-weight:600;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer}
    button.s{background:#fff;color:#1d4ed8}
    .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .pax{border:1px solid #e2e8f0;border-radius:10px;padding:8px;display:grid;gap:6px}
    .pax .row b{margin-right:auto}
    details summary{cursor:pointer;color:#1d4ed8;font-weight:600;font-size:12px}
    .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;padding:5px 0;border-top:1px dashed #e2e8f0}
    .kv .l{grid-column:1/-1;color:#475569;font-size:11px;font-weight:600}
    .kv .v{font-family:ui-monospace,Consolas,monospace;font-size:13px;font-weight:700;word-break:break-all}
    .kv .v small{display:block;font-family:system-ui,sans-serif;font-weight:400;color:#64748b;font-size:11px}
    button.c{padding:3px 8px;font-size:12px;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
    button.c.done{background:#dcfce7;color:#166534;border-color:#86efac}
  </style><div class="p"><div class="h">✈ AirRex Helper<span></span></div><div class="b"></div></div>`;
  const head = root.querySelector('.h span');
  const body = root.querySelector('.b');
  root.querySelector('.h').addEventListener('click', () => {
    collapsed = !collapsed;
    render();
  });

  function render() {
    body.style.display = collapsed ? 'none' : 'grid';
    head.textContent = collapsed ? 'show' : 'hide';
    if (!trip) return;
    const o = trip.offer;
    const pax = trip.passengers ?? [];
    const payment = E.isPaymentPage();
    body.innerHTML = `
      <div><b>${esc(trip.query.origin)} → ${esc(trip.query.destination)}</b> · ${esc(trip.query.date)} · ${esc(o.flightNumbers)}</div>
      <div class="m">AirRex showed ${inr(o.shownTotal)} for ${trip.query.adults} adult${trip.query.adults > 1 ? 's' : ''}${o.processingFee ? ` (incl. ${inr(o.processingFee)} airline fee)` : ''}.</div>
      ${siteAirline && o.airlineCode && siteAirline !== o.airlineCode ? `<div class="w">This trip is for ${esc(o.airlineName)}, but this is a different airline's site.</div>` : ''}
      <div class="pax">
        <div class="row"><b>Flight search</b><button data-search>Fill search</button></div>
        <details data-sec="search" ${searchOpen ? 'open' : ''}><summary>Search details to copy</summary>
          ${searchFields().map(([label, value, note], k) => `<div class="kv"><span class="l">${esc(label)}</span>
            <span class="v">${esc(value)}${note ? `<small>${esc(note)}</small>` : ''}</span>
            <button class="c" data-copy="s:${k}">Copy</button></div>`).join('')}
        </details>
      </div>
      ${pax.length ? `${pax.map((p, i) => `<div class="pax">
          <div class="row"><b>${i + 1}. ${esc([p.givenNames, p.surname].filter(Boolean).join(' ') || `Passenger ${i + 1}`)}</b><button data-fill="${i}">Fill form</button></div>
          <details data-pax="${i}" ${openPax.has(i) ? 'open' : ''}><summary>Details to copy</summary>
            ${copyFields(p).map(([label, value, note], k) => `<div class="kv"><span class="l">${esc(label)}</span>
              <span class="v">${esc(value)}${note ? `<small>${esc(note)}</small>` : ''}</span>
              <button class="c" data-copy="${i}:${k}">Copy</button></div>`).join('')}
          </details></div>`).join('')}
        <div class="m">On the airline's passenger page tap <b>Fill form</b>, then check every field. Anything not filled: copy it from the list.</div>`
      : `<div class="pax">
          <div class="row"><b>Passenger details</b></div>
          <div class="w">No passengers yet.</div>
          <div class="m">In the AirRex tab, open this flight's <b>Book</b> pop-up → <b>Passenger details for the airline form</b>
          → <b>Add passenger</b> (scan the passport or type the details). They appear here within a few seconds with
          <b>Fill form</b> and <b>Copy</b> buttons; no need to click Continue again.</div>
        </div>`}
      ${status}
      ${payment ? '<div class="m">Payment page: card and UPI details are never read. Only the fare breakdown (fees, total) is recorded.</div>' : ''}
      <div class="m" data-captured>${capturedText()}</div>
      <div class="row"><button class="s" data-clear>Forget trip</button></div>`;
  }

  // Remember which copy lists are open across re-renders.
  body.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (d instanceof HTMLDetailsElement && d.dataset.sec === 'search') searchOpen = d.open;
      if (!(d instanceof HTMLDetailsElement) || d.dataset.pax === undefined) return;
      if (d.open) openPax.add(Number(d.dataset.pax));
      else openPax.delete(Number(d.dataset.pax));
    },
    true,
  );

  body.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.copy !== undefined) {
      const [a, b] = t.dataset.copy.split(':');
      const field = a === 's' ? searchFields()[Number(b)] : copyFields(trip.passengers[Number(a)])[Number(b)];
      if (field && (await copyText(field[1]))) {
        t.textContent = 'Copied';
        t.classList.add('done');
        setTimeout(() => {
          t.textContent = 'Copy';
          t.classList.remove('done');
        }, 1500);
      }
      return;
    }
    if (t.dataset.search !== undefined) {
      t.disabled = true;
      t.textContent = 'Filling…';
      const r = await E.fillSearch(trip.query);
      status = r.filled.length
        ? `<div class="ok">Search filled: ${esc(r.filled.join(', '))}.</div>${r.missed.length ? `<div class="w">Please set by hand (see Search details to copy): ${esc(r.missed.join(', '))}.</div>` : ''}${trip.query.adults > 1 ? `<div class="w">Set ${trip.query.adults} adults on the airline's search.</div>` : ''}`
        : '<div class="w">No flight search found on this page. Open the airline\'s home page, or copy the search details below.</div>';
      if (!r.filled.length) searchOpen = true;
      render();
      return;
    }
    if (t.dataset.fill !== undefined) {
      const i = Number(t.dataset.fill);
      const r = E.fillPassenger(trip.passengers[i], i, trip.query.date);
      status = r.filled.length
        ? `<div class="ok">Filled: ${esc(r.filled.join(', '))}.</div>${r.missed.length ? `<div class="w">Please fill by hand (highlighted orange if found): ${esc(r.missed.join(', '))}.</div>` : ''}`
        : '<div class="w">No passenger fields found on this page. Open the passenger details page and try again.</div>';
      render();
    } else if (t.dataset.clear !== undefined) {
      await send({ type: 'trip:clear' });
      trip = null;
      host.remove();
    }
  });

  // ---------- Price capture (automatic: whenever a page's prices change, including the payment page's
  // fare breakdown where fees such as IndiGo's convenience fee appear) ----------
  async function capture() {
    if (!trip) return;
    const page = E.capturePage();
    if (!page.lines.length) return;
    const signature = page.path + '|' + page.lines.map((l) => l.text).join('\n');
    if (signature === lastSignature) return;
    lastSignature = signature;
    const r = await send({ type: 'capture', page });
    if (r.ok) {
      captured += 1;
      const note = root.querySelector('[data-captured]');
      if (note) note.textContent = capturedText();
    }
  }

  const capturedText = () => `Prices recorded automatically on ${captured} page${captured === 1 ? '' : 's'} to keep AirRex accurate.`;

  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => capture(), 2500);
  };

  let started = false;
  let watching = false;
  async function start() {
    trip = (await send({ type: 'trip:get' })).trip ?? null;
    if (!trip || started) return; // nothing handed over from AirRex: stay invisible
    started = true;
    document.documentElement.appendChild(host);
    render();
    schedule();
    if (watching) return;
    watching = true;
    new MutationObserver((records) => {
      if (!trip) return;
      if (records.every((r) => host.contains(r.target) || r.target === host)) return;
      schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Single-page apps change the URL without reloading.
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        status = '';
        render();
        schedule();
      }
    }, 1000);
  }

  // Pick up a trip handed over (or updated, e.g. passengers added) while this tab is already open.
  setInterval(async () => {
    if (document.hidden) return;
    const latest = (await send({ type: 'trip:get' })).trip ?? null;
    if (!started) {
      if (latest) start();
      return;
    }
    if (!latest) {
      trip = null;
      host.remove();
      started = false;
      return;
    }
    if (latest.receivedAt !== trip?.receivedAt) {
      trip = latest;
      render();
    }
  }, 4000);

  start();
})();
