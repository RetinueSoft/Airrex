// AirRex Helper engine: fills airline passenger forms and reads prices shown on airline pages.
// Plain browser JavaScript (no build step); exposed as globalThis.AirRexEngine. Used by airline.js.
//
// Filling is generic: each form field is identified from its label/placeholder/name/id, so it works on most
// airline forms without airline-specific code. Custom dropdowns that aren't real <select> elements can't
// always be set; those fields are highlighted for the person to pick by hand.
//
// Price capture reads only the page's visible text lines that contain an amount (₹ / INR / Rs ...).
// It never reads what is typed into inputs and never runs on payment pages.

(() => {
  'use strict';

  // ---------- Field recognition ----------

  const FIELD_PATTERNS = [
    // Order matters: more specific first.
    ['issuingCountry', /issu(ing|ed)\s*(country|by|authority)|country\s*of\s*issue|place\s*of\s*issue|issuance/],
    ['passportExpiry', /expir|valid\s*(till|until|upto|up to)|date\s*of\s*expiry/],
    ['passportNumber', /passport\s*(no|number|num|#)?|document\s*(no|number)|travel\s*document|\bdoc(ument)?\s*no/],
    ['nationality', /nationality|citizenship|citizen\s*of/],
    ['dateOfBirth', /date\s*of\s*birth|birth\s*date|\bdob\b|birthday|born/],
    ['title', /\btitle\b|salutation|prefix|\bhonorific/],
    ['givenNames', /first\s*(\/\s*given\s*)?name|given\s*name|forename|\bfname\b|first_?name|firstname/],
    ['surname', /last\s*name|sur\s*name|family\s*name|\blname\b|last_?name|lastname/],
    ['gender', /gender|\bsex\b/],
  ];

  // Fields to never touch (contact/booker details, payment, loyalty numbers...).
  const SKIP = /e-?mail|mobile|phone|contact|card|cvv|cvc|upi|otp|password|coupon|promo|gst|company|frequent|loyalty|ffp|member|address|pin\s*code|postal|city|state/;

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  }

  /** Text that describes a form control: label, aria, placeholder, name/id, nearby text. */
  function describe(el, keepDashes = false) {
    const parts = [];
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) parts.push(lab.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent);
    parts.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id);
    parts.push(el.getAttribute('autocomplete'), el.getAttribute('data-testid'), el.getAttribute('formcontrolname'));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) parts.push(document.getElementById(id)?.textContent);
    // Nearby text: previous siblings / parent's first text (common "label above input" layouts).
    let p = el.parentElement;
    for (let depth = 0; p && depth < 3 && parts.join(' ').length < 400; depth++, p = p.parentElement) {
      const own = [...p.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE || (n instanceof Element && !n.contains(el) && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(n.tagName)))
        .map((n) => n.textContent)
        .join(' ');
      if (own.trim()) {
        parts.push(own.slice(0, 120));
        break;
      }
    }
    const text = parts.filter(Boolean).join(' | ');
    // keepDashes: for reading date formats like "DD-MM-YYYY" from the label.
    return norm(keepDashes ? text : text.replace(/[_-]+/g, ' '));
  }

  function classify(el) {
    const d = describe(el);
    if (!d || SKIP.test(d)) return null;
    for (const [key, re] of FIELD_PATTERNS) if (re.test(d)) return { key, desc: d };
    return null;
  }

  function controls(root = document) {
    return [...root.querySelectorAll('input, select, textarea')].filter((el) => {
      if (!isVisible(el) || el.disabled || el.readOnly) return false;
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return !['hidden', 'submit', 'button', 'checkbox', 'file', 'image', 'reset', 'password'].includes(t);
    });
  }

  // ---------- Setting values so React / Angular / Vue notice ----------

  function setNative(el, value) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus({ preventScroll: true });
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /** Pick the <option> whose text or value matches one of the candidates. */
  function setSelect(sel, candidates) {
    const opts = [...sel.options];
    const cands = candidates.filter(Boolean).map(norm);
    for (const c of cands) {
      const hit = opts.find((o) => norm(o.value) === c || norm(o.textContent) === c);
      if (hit) return setNative(sel, hit.value), true;
    }
    for (const c of cands) {
      if (c.length < 3) continue;
      const hit = opts.find((o) => norm(o.textContent).startsWith(c) || norm(o.value).startsWith(c));
      if (hit) return setNative(sel, hit.value), true;
    }
    return false;
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

  /** Write a YYYY-MM-DD date into a date/text input, guessing the format from type/placeholder. */
  // Date style each airline's text date fields expect when the field itself doesn't say.
  const SITE_DATE_STYLE = [
    [/goindigo\.in$/, 'dd-mm-yyyy'], // IndiGo: DD-MM-YYYY
  ];

  /** The date format a text field wants: from its placeholder/label/pattern, else the airline's usual style. */
  function dateStyle(el) {
    const hint = [el.getAttribute('placeholder'), el.getAttribute('data-format'), el.getAttribute('pattern'), el.getAttribute('title'), describe(el, true)]
      .map(norm)
      .join(' ');
    if (/yyyy[-/.]mm[-/.]dd/.test(hint)) return 'yyyy-mm-dd';
    if (/mm[-/.]dd[-/.]yyyy/.test(hint)) return 'mm/dd/yyyy';
    if (/dd[-/ ]mmm[-/ ]yyyy/.test(hint)) return 'dd-mmm-yyyy';
    if (/dd-mm-yyyy/.test(hint)) return 'dd-mm-yyyy';
    if (/dd\.mm\.yyyy/.test(hint)) return 'dd.mm.yyyy';
    if (/dd\/mm\/yyyy/.test(hint)) return 'dd/mm/yyyy';
    return SITE_DATE_STYLE.find(([re]) => re.test(location.hostname))?.[1] ?? 'dd/mm/yyyy'; // Indian sites: DD/MM/YYYY
  }

  function formatDate(ymd, style) {
    const [y, m, d] = ymd.split('-');
    switch (style) {
      case 'yyyy-mm-dd': return `${y}-${m}-${d}`;
      case 'mm/dd/yyyy': return `${m}/${d}/${y}`;
      case 'dd-mmm-yyyy': return `${d}-${MONTHS[Number(m) - 1].replace(/^./, (c) => c.toUpperCase())}-${y}`;
      case 'dd-mm-yyyy': return `${d}-${m}-${y}`;
      case 'dd.mm.yyyy': return `${d}.${m}.${y}`;
      default: return `${d}/${m}/${y}`;
    }
  }

  function dateForInput(el, ymd) {
    if ((el.getAttribute('type') || '').toLowerCase() === 'date') return ymd;
    return formatDate(ymd, dateStyle(el));
  }

  /**
   * Type a date into a text field and check it stuck. Masked fields (which add the "-" or "/" themselves)
   * often reject a value with separators, so try other forms until the field shows the right date.
   */
  function setDate(el, ymd) {
    const [y, m, d] = ymd.split('-');
    const want = `${d}${m}${y}`;
    const digits = (s) => (s || '').replace(/\D/g, '');
    const okNow = () => {
      const v = digits(el.value);
      return v === want || v === `${m}${d}${y}` || v === `${y}${m}${d}` || (el.type === 'date' && el.value === ymd);
    };
    const tries = [dateForInput(el, ymd), formatDate(ymd, 'dd-mm-yyyy'), formatDate(ymd, 'dd/mm/yyyy'), want];
    for (const v of [...new Set(tries)]) {
      setNative(el, v);
      if (okNow()) return true;
    }
    return false;
  }

  /** Dates split into day / month / year selects or inputs inside one group. */
  function fillDateParts(group, ymd) {
    const [y, m, d] = ymd.split('-');
    const parts = controls(group);
    let done = 0;
    for (const el of parts) {
      const desc = describe(el);
      const isSel = el instanceof HTMLSelectElement;
      const n = isSel ? el.options.length : 0;
      if (/\byear\b|yyyy|\byy\b/.test(desc) || (isSel && n > 40)) {
        done += isSel ? Number(setSelect(el, [y])) : (setNative(el, y), 1);
      } else if (/\bmonth\b|\bmm\b|\bmon\b/.test(desc) || (isSel && n >= 12 && n <= 14)) {
        const mi = Number(m) - 1;
        done += isSel ? Number(setSelect(el, [m, String(Number(m)), MONTHS[mi], MONTHS_LONG[mi]])) : (setNative(el, m), 1);
      } else if (/\bday\b|\bdd\b|\bdate\b/.test(desc) || (isSel && n >= 28 && n <= 33)) {
        done += isSel ? Number(setSelect(el, [d, String(Number(d))])) : (setNative(el, d), 1);
      }
    }
    return done >= 3;
  }

  function countryCandidates(code, name, adjective) {
    return [code, name, adjective, code === 'IND' ? 'IN' : '', code === 'IND' ? 'Indian' : ''];
  }

  const COUNTRY = { IND: ['India', 'Indian'], LKA: ['Sri Lanka', 'Sri Lankan'], SGP: ['Singapore', 'Singaporean'], MYS: ['Malaysia', 'Malaysian'], ARE: ['United Arab Emirates', 'Emirati'], GBR: ['United Kingdom', 'British'], USA: ['United States', 'American'] };

  function valueFor(key, p, el, adult) {
    const isSel = el instanceof HTMLSelectElement;
    switch (key) {
      case 'givenNames': return p.givenNames;
      case 'surname': return p.surname;
      case 'passportNumber': return p.passportNumber;
      case 'title': {
        const t = p.sex === 'M' ? (adult ? ['Mr', 'MR', 'Mr.'] : ['Master', 'MSTR', 'Mstr']) : p.sex === 'F' ? (adult ? ['Ms', 'MS', 'Ms.', 'Mrs'] : ['Miss', 'MISS']) : [];
        return isSel ? t : t[0];
      }
      case 'gender': {
        const g = p.sex === 'M' ? ['Male', 'M', 'MALE'] : p.sex === 'F' ? ['Female', 'F', 'FEMALE'] : ['Other', 'X'];
        return isSel ? g : g[0];
      }
      case 'nationality':
      case 'issuingCountry': {
        const code = key === 'nationality' ? p.nationality : p.issuingCountry;
        const [name, adj] = COUNTRY[code] || [code, code];
        const c = countryCandidates(code, name, adj);
        return isSel ? c : key === 'nationality' ? adj : name;
      }
      case 'dateOfBirth': return p.dateOfBirth ? dateForInput(el, p.dateOfBirth) : '';
      case 'passportExpiry': return p.passportExpiry ? dateForInput(el, p.passportExpiry) : '';
    }
    return '';
  }

  function ageOn(dob, onDate) {
    const [ay, am, ad] = dob.split('-').map(Number);
    const [by, bm, bd] = onDate.split('-').map(Number);
    return by - ay - (bm < am || (bm === am && bd < ad) ? 1 : 0);
  }

  const mark = (el, ok) => {
    el.style.outline = ok ? '2px solid #16a34a' : '2px solid #d97706';
    el.style.outlineOffset = '1px';
  };

  /** Radio buttons (e.g. Male/Female, Mr/Ms) near a label. */
  function fillRadios(passengerIndex, key, wanted) {
    const radios = [...document.querySelectorAll('input[type=radio]')].filter(isVisible);
    const byName = new Map();
    for (const r of radios) {
      const d = describe(r);
      if (!(key === 'gender' ? /gender|sex|male|female/ : /title|mr|ms|mrs/).test(d)) continue;
      const list = byName.get(r.name) || [];
      list.push(r);
      byName.set(r.name, list);
    }
    const groups = [...byName.values()];
    const group = groups[passengerIndex];
    if (!group) return false;
    for (const w of wanted.map(norm)) {
      const hit = group.find((r) => norm(r.value) === w || norm(describe(r)).split(' | ')[0] === w || norm(r.closest('label')?.textContent) === w);
      if (hit) {
        hit.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Fill passenger number `index` (0-based) on the current page. The n-th field of each kind on the page
   * is taken to belong to the n-th passenger. Returns a report of what was filled and what wasn't.
   */
  function fillPassenger(p, index = 0, travelDate) {
    const adult = !p.dateOfBirth || !travelDate || ageOn(p.dateOfBirth, travelDate) >= 12;
    const byKey = new Map();
    for (const el of controls()) {
      const c = classify(el);
      if (!c) continue;
      const list = byKey.get(c.key) || [];
      list.push(el);
      byKey.set(c.key, list);
    }
    const filled = [];
    const missed = [];
    const labels = { title: 'Title', givenNames: 'First name', surname: 'Last name', gender: 'Gender', dateOfBirth: 'Date of birth', nationality: 'Nationality', passportNumber: 'Passport number', issuingCountry: 'Issuing country', passportExpiry: 'Passport expiry' };

    for (const key of Object.keys(labels)) {
      const have = key === 'passportNumber' || key === 'passportExpiry' || key === 'issuingCountry' ? p[key] : true;
      if (!have) continue;
      const list = byKey.get(key) || [];
      // Split date controls (day/month/year) show up as several "date of birth" fields for one passenger.
      const small = (e) => e instanceof HTMLSelectElement || Number(e.getAttribute('maxlength') || 99) <= 4;
      if ((key === 'dateOfBirth' || key === 'passportExpiry') && list.length >= 3 && list.length % 3 === 0 && list.every(small)) {
        const trio = list.slice(index * 3, index * 3 + 3);
        const ymd = key === 'dateOfBirth' ? p.dateOfBirth : p.passportExpiry;
        let container = trio[0]?.parentElement;
        while (container && !trio.every((e) => container.contains(e))) container = container.parentElement;
        const ok = !!(container && ymd && trio.length === 3 && fillDateParts(container, ymd));
        trio.forEach((e) => mark(e, ok));
        (ok ? filled : missed).push(labels[key]);
        continue;
      }
      const el = list[index];
      if (!el) {
        if ((key === 'gender' || key === 'title') && fillRadios(index, key, valueFor(key, p, document.createElement('select'), adult))) {
          filled.push(labels[key]);
        } else if (key === 'givenNames' || key === 'surname') {
          // Every passenger form has names: not finding them means the person must type them.
          missed.push(labels[key]);
        }
        // Other fields may simply not be on this airline's form (e.g. no issuing country): nothing to report.
        continue;
      }
      const v = valueFor(key, p, el, adult);
      let ok = false;
      if (el instanceof HTMLSelectElement) ok = setSelect(el, Array.isArray(v) ? v : [v]);
      else if ((key === 'dateOfBirth' || key === 'passportExpiry') && p[key]) ok = setDate(el, p[key]);
      else if (v) {
        setNative(el, Array.isArray(v) ? v[0] : v);
        ok = true;
      }
      mark(el, ok);
      (ok ? filled : missed).push(labels[key]);
    }
    return { filled, missed, passengerFieldsOnPage: Math.max(0, ...[...byKey.values()].map((l) => l.length)) };
  }

  // ---------- Price capture ----------

  const AMOUNT = /(?:₹|inr|rs\.?)\s?([\d,]+(?:\.\d{1,2})?)|([\d,]{3,}(?:\.\d{1,2})?)\s?(?:inr|₹)/i;
  const AMOUNT_ALL = /(?:₹|inr|rs\.?)\s?[\d,]+(?:\.\d{1,2})?|[\d,]{3,}(?:\.\d{1,2})?\s?(?:inr|₹)/gi;
  const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
  const LONG_DIGITS = /\b\d{8,}\b/g; // phone numbers, PNR-like numbers

  /** True on pages where payment details are entered: AirRex never reads those. */
  function isPaymentPage() {
    const url = location.href.toLowerCase();
    if (/payment|checkout\/pay|\/pay\b|paygate|razorpay|juspay|payu|ccavenue|billdesk|cybersource|adyen|stripe/.test(url)) return true;
    return [...document.querySelectorAll('input, iframe')].some((el) => {
      const d = norm([el.getAttribute('autocomplete'), el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('src')].join(' '));
      return /cc-number|card\s*number|cardnumber|cvv|cvc|card-number|razorpay|juspay|payu|ccavenue|billdesk|adyen|stripe/.test(d);
    });
  }

  /** Visible text lines that contain a price, with personal-looking parts removed. */
  function captureLines() {
    const out = [];
    const seen = new Set();
    const candidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (!(n instanceof HTMLElement) || /^(SCRIPT|STYLE|NOSCRIPT|INPUT|SELECT|TEXTAREA|OPTION)$/.test(n.tagName)) continue;
      if (n.closest('#airrex-helper-root')) continue;
      // Smallest block that holds an amount plus its label: the element's text is short and has an amount.
      const text = (n.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 160 || !AMOUNT.test(text)) continue;
      // Skip if a child element already holds the same text (keep the most specific line).
      if ([...n.children].some((c) => ((c.innerText || '').replace(/\s+/g, ' ').trim() === text))) continue;
      // Skip containers holding several prices (each line is captured on its own).
      if ((text.match(AMOUNT_ALL) || []).length > 1) continue;
      // Skip a bare amount ("₹ 8,940") when its parent line also has the label ("Base fare ₹ 8,940").
      if (!/[a-z]{3,}/i.test(text.replace(/\b(inr|rs)\b/gi, ''))) {
        const parentText = (n.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
        if (parentText.length <= 160 && (parentText.match(AMOUNT_ALL) || []).length === 1 && /[a-z]{3,}/i.test(parentText.replace(/\b(inr|rs)\b/gi, ''))) continue;
      }
      if (!isVisible(n)) continue;
      candidates.push({ el: n, text });
      if (candidates.length >= 600) break;
    }
    // Nested boxes often repeat the same single price; keep only the innermost one.
    for (const c of candidates) {
      if (candidates.some((d) => d !== c && c.el.contains(d.el))) continue;
      const clean = c.text.replace(EMAIL, '[email]').replace(LONG_DIGITS, '[number]');
      if (seen.has(clean)) continue;
      seen.add(clean);
      const m = AMOUNT.exec(clean);
      const amount = m ? Math.round(Number((m[1] || m[2]).replace(/,/g, ''))) : null;
      out.push({ text: clean, amount });
      if (out.length >= 200) break;
    }
    return out;
  }

  /**
   * Price lines on the current page. On the payment page this is the fare breakdown (where airlines such as IndiGo
   * add their convenience fee): only visible text lines with amounts, never what is typed into card/UPI fields
   * (inputs are skipped, and card forms sit in the payment provider's frames, which aren't read).
   */
  function capturePage(trip) {
    const lines = captureLines();
    const heading = (document.querySelector('h1, h2')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      host: location.host,
      path: location.pathname.slice(0, 200),
      title: document.title.slice(0, 120),
      heading,
      lines,
      paymentPage: isPaymentPage(),
      ...(trip ? { match: tripMatch(trip) } : {}),
    };
  }

  // ---------- Is this page about the trip AirRex handed over? ----------
  // People change the date or flight on the airline's site after continuing from AirRex. Prices must only be
  // recorded against the trip when the page shows the trip's own date and flight.

  const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Ways airline sites write a date: "07 Dec 2026", "7 Dec", "Dec 7", "07/12/2026", "2026-12-07"... */
  function dateRegex(ymd) {
    const [y, m, d] = ymd.split('-');
    const dn = String(Number(d));
    const mon = MON_SHORT[Number(m) - 1];
    const monLong = MONTHS_LONG[Number(m) - 1];
    const parts = [
      `0?${dn}(st|nd|rd|th)?[\\s,.-]*(${mon}|${monLong})\\b`,
      `\\b(${mon}|${monLong})[a-z]*[\\s,.-]*0?${dn}\\b`,
      `\\b0?${dn}[/.-]0?${Number(m)}[/.-](${y}|${y.slice(2)})\\b`,
      `\\b${y}-${m}-${d}\\b`,
    ];
    return new RegExp(`(^|[^\\d])(${parts.join('|')})`, 'i');
  }

  /** "6E 1349" matches "6E1349", "6E-1349", "6E 1349" on the page. */
  const flightRe = (fn) => {
    const [code, num] = fn.trim().split(/\s+/);
    return new RegExp(`\\b${code}\\s*-?\\s*0*${num}\\b`, 'i');
  };

  /**
   * Does this page show the trip? Returns:
   *  dateOk      — the travel date appears on the page;
   *  flightOk    — every flight number of the trip appears;
   *  otherFlights — other flight numbers of the same airline appear too (a list of flights, e.g. flight select);
   *  rowPrice    — on such a list, the lowest price in the trip flight's own row ("Starts at ₹12,227").
   */
  function tripMatch(trip) {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    const flights = String(trip.offer.flightNumbers || '').split('+').map((s) => s.trim()).filter(Boolean);
    const dateOk = dateRegex(trip.query.date).test(text);
    const flightOk = flights.length > 0 && flights.every((f) => flightRe(f).test(text));
    const code = trip.offer.airlineCode;
    const allOfAirline = new Set((text.match(new RegExp(`\\b${code}\\s*-?\\s*\\d{2,4}\\b`, 'gi')) || []).map((s) => s.replace(/\D/g, '')));
    const ours = new Set(flights.map((f) => f.replace(/\D/g, '').replace(/^0+/, '')));
    const otherFlights = [...allOfAirline].some((n) => !ours.has(n.replace(/^0+/, '')));
    // On a list of flights the page shows several dates (date strip), so the row itself must show the trip date.
    const row = flightOk && otherFlights ? rowPrice(flights[0], code, dateRegex(trip.query.date)) : null;
    return { dateOk, flightOk, otherFlights, rowPrice: row };
  }

  /**
   * Lowest amount in the smallest box around the flight number that holds a price but no other flight
   * (its row in a list of flights), or null when that row doesn't show the trip's date.
   */
  function rowPrice(flight, code, dateRe) {
    const re = flightRe(flight);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!re.test(n.textContent || '') || n.parentElement?.closest('#airrex-helper-root')) continue;
      let box = n.parentElement;
      for (let depth = 0; box && depth < 12; depth++, box = box.parentElement) {
        const t = (box.innerText || '').replace(/\s+/g, ' ');
        const others = (t.match(new RegExp(`\\b${code}\\s*-?\\s*\\d{2,4}\\b`, 'gi')) || []).filter((s) => !re.test(s));
        if (others.length) break; // grew past this flight's row
        const amounts = (t.match(AMOUNT_ALL) || []).map((a) => Math.round(Number(a.replace(/[^\d.]/g, '')))).filter((x) => x > 0);
        if (amounts.length) return dateRe.test(t) ? Math.min(...amounts) : null;
      }
    }
    return null;
  }

  // ---------- Flight search form (one way, from, to, date) ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  /** A real-looking click (mouse down/up + click) for custom widgets that listen to mouse events. */
  function press(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
  }

  /** Type text one character at a time, like a person, so autocomplete lists open. */
  async function typeText(el, text) {
    press(el);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      setter?.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(60);
    }
  }

  function visibleClickables(root = document) {
    return [...root.querySelectorAll('button, a, label, li, [role=option], [role=tab], [role=radio], [role=button], span, div, td')].filter(
      (el) => !el.closest('#airrex-helper-root') && isVisible(el),
    );
  }

  /** The smallest visible element whose text matches (e.g. a suggestion row containing "TRZ"). */
  function smallestMatching(re, exclude) {
    const hits = visibleClickables().filter((el) => el !== exclude && !el.contains(exclude) && re.test(textOf(el)) && textOf(el).length < 140);
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))[0] ?? null;
  }

  const SEARCH_SKIP = /e-?mail|mobile|phone|password|coupon|promo|pnr|booking\s*ref|last\s*name/;

  /** A visible text box for the search form (read-only ones too: they often open a calendar or list). */
  function findInput(re, notRe) {
    return [...document.querySelectorAll('input')].find((el) => {
      if (el.closest('#airrex-helper-root') || !isVisible(el) || el.disabled) return false;
      if (!['text', 'search', 'date', ''].includes((el.getAttribute('type') || '').toLowerCase())) return false;
      const d = describe(el);
      return re.test(d) && !(notRe && notRe.test(d)) && !SEARCH_SKIP.test(d);
    });
  }

  async function chooseOneWay() {
    const radio = [...document.querySelectorAll('input[type=radio]')].find((r) => /one\s*-?\s*way|oneway|\bow\b/.test(describe(r)) || /^(ow|oneway|one-way|one_way)$/i.test(r.value));
    if (radio) {
      press(radio.closest('label') || radio);
      if (!radio.checked) radio.click();
      return radio.checked;
    }
    const el = smallestMatching(/^one[\s-]?way$/i);
    if (el) {
      press(el);
      return true;
    }
    return false;
  }

  /** Type the airport into a From/To box and pick the suggestion with its code or city. */
  async function chooseAirport(kind, code, city) {
    const re = kind === 'from' ? /\bfrom\b|origin|leaving|depart(ure|ing)?\s*(city|from|airport)|source|flying from/ : /(^|\W)to(\W|$)|destination|going to|arriv(al|ing)\s*(city|airport)?|flying to/;
    const notRe = kind === 'from' ? /destination|going to|\bto\b\s*(city|airport)/ : /\bfrom\b|origin|leaving/;
    let input = findInput(re, notRe);
    if (!input) {
      // Some sites show a button ("From: Chennai") that opens a search box.
      const trigger = smallestMatching(kind === 'from' ? /^from\b/i : /^to\b/i);
      if (trigger) {
        press(trigger);
        await sleep(400);
        input = document.activeElement instanceof HTMLInputElement ? document.activeElement : findInput(/search|city|airport|from|to/);
      }
    }
    if (!input) return false;
    for (const query of [code, city]) {
      await typeText(input, query);
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const option = smallestMatching(new RegExp(`\\b${code}\\b`), input) || smallestMatching(new RegExp(`^${city}\\b`, 'i'), input);
        if (option) {
          press(option);
          await sleep(300);
          return true;
        }
      }
    }
    return false;
  }

  function dateVariants(ymd) {
    const [y, m, d] = ymd.split('-');
    const mi = Number(m) - 1;
    const dt = new Date(Number(y), mi, Number(d));
    const long = MONTHS_LONG[mi][0].toUpperCase() + MONTHS_LONG[mi].slice(1);
    const short = MONTHS[mi][0].toUpperCase() + MONTHS[mi].slice(1);
    const wd = dt.toLocaleDateString('en-GB', { weekday: 'long' });
    return {
      exact: [ymd, `${d}/${m}/${y}`, `${d}-${m}-${y}`, `${y}/${m}/${d}`, `${y}${m}${d}`, `${m}/${d}/${y}`, String(dt.getTime())],
      text: [`${Number(d)} ${long} ${y}`, `${long} ${Number(d)}, ${y}`, `${long} ${Number(d)} ${y}`, `${Number(d)} ${short} ${y}`, `${short} ${Number(d)}, ${y}`, `${wd}, ${long} ${Number(d)}, ${y}`, `${wd}, ${Number(d)} ${long} ${y}`],
    };
  }

  /** A calendar day cell for the date, found by its data-date / aria-label / title attributes. */
  function findDayCell(ymd) {
    const v = dateVariants(ymd);
    const exact = new Set(v.exact);
    const texts = v.text.map(norm);
    for (const el of document.querySelectorAll('[data-date], [data-day], [data-value], [data-iso], [data-time], [aria-label], [title], td, button')) {
      if (el.closest('#airrex-helper-root') || !isVisible(el)) continue;
      for (const a of ['data-date', 'data-day', 'data-value', 'data-iso', 'data-time']) {
        const val = el.getAttribute(a);
        if (val && (exact.has(val) || exact.has(val.slice(0, 10)))) return el;
      }
      const label = norm(el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (label && texts.some((t) => label.includes(t))) return el;
    }
    return null;
  }

  async function chooseDate(ymd) {
    const input = findInput(/depart(ure|ing)?\s*(date|on)?|travel\s*date|\bdate\b|\bwhen\b|check.?in/, /return|birth|expir/);
    if (input && (input.type === 'date' || !input.readOnly)) {
      if (setDate(input, ymd)) return true;
    }
    // Open the calendar (the date box, or a "Departure" button) and click the day.
    const opener = input || smallestMatching(/^depart(ure)?(\s*date)?\b/i);
    if (!opener) return false;
    press(opener);
    await sleep(500);
    for (let i = 0; i < 13; i++) {
      const cell = findDayCell(ymd);
      if (cell) {
        press(cell);
        await sleep(300);
        return true;
      }
      // The "next month" arrow: by its label, or a small element showing just an arrow / "Next".
      const isNext = (el) =>
        /^next$|next\s*month|^forward$|go\s*to\s*next/i.test(norm(el.getAttribute('aria-label') || el.getAttribute('title') || '')) ||
        /^(›|»|→|>|next|next month)$/i.test(textOf(el)) ||
        /(^|\s)(next|right)(-|_|\s|$)/i.test(el.getAttribute('class') || '') && textOf(el).length < 3;
      const nexts = [...document.querySelectorAll('button, a, [role=button], span, div, i, svg')].filter(
        (el) => !el.closest('#airrex-helper-root') && isVisible(el) && isNext(el),
      );
      // Prefer buttons/links; then the innermost element.
      const next = nexts.find((el) => /^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button') ?? nexts.find((el) => !nexts.some((o) => o !== el && el.contains(o)));
      if (!next) break;
      press(next);
      await sleep(350);
    }
    return false;
  }

  /**
   * Fill the airline's flight search: one way, from, to, date. Best effort: each step reports whether it
   * worked; anything missed can be copied from the panel.
   */
  async function fillSearch(q) {
    const filled = [];
    const missed = [];
    const step = async (label, fn) => {
      try {
        ((await fn()) ? filled : missed).push(label);
      } catch {
        missed.push(label);
      }
    };
    await step('One way', chooseOneWay);
    await step(`From (${q.origin})`, () => chooseAirport('from', q.origin, q.originCity || q.origin));
    await step(`To (${q.destination})`, () => chooseAirport('to', q.destination, q.destinationCity || q.destination));
    await step('Date', () => chooseDate(q.date));
    return { filled, missed };
  }

  /** The date style this airline site uses, for showing dates in the panel. */
  function siteDateStyle() {
    return SITE_DATE_STYLE.find(([re]) => re.test(location.hostname))?.[1] ?? 'dd/mm/yyyy';
  }

  globalThis.AirRexEngine = { fillPassenger, fillSearch, capturePage, isPaymentPage, classify, describe, formatDate, siteDateStyle };
})();
