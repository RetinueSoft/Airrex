// AirRex Helper background worker.
// - Keeps the trip handed over by AirRex (flight, shown price, passengers) in chrome.storage.session:
//   memory only, cleared when the browser closes, never written to disk or sent anywhere.
// - Sends price captures from airline pages to the AirRex server the trip came from (no passenger data).

const TRIP_KEY = 'trip';
const TRIP_MAX_AGE_MS = 6 * 60 * 60 * 1000; // forget a trip after 6 hours

async function getTrip() {
  const { [TRIP_KEY]: trip } = await chrome.storage.session.get(TRIP_KEY);
  if (trip && Date.now() - trip.receivedAt > TRIP_MAX_AGE_MS) {
    await chrome.storage.session.remove(TRIP_KEY);
    return null;
  }
  return trip ?? null;
}

function airlineCodeOf(trip) {
  return trip?.offer?.airlineCode ?? '';
}

async function badge(trip) {
  await chrome.action.setBadgeText({ text: trip ? airlineCodeOf(trip).slice(0, 3) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'trip:set': {
        // Only from the AirRex bridge (content script on the AirRex site), never from airline pages.
        if (!sender.url || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(sender.url) && !(await isAirRexOrigin(sender.url))) {
          return sendResponse({ ok: false });
        }
        const trip = { ...msg.trip, apiOrigin: new URL(sender.url).origin, receivedAt: Date.now(), captures: 0 };
        await chrome.storage.session.set({ [TRIP_KEY]: trip });
        await badge(trip);
        return sendResponse({ ok: true });
      }
      case 'trip:get':
        return sendResponse({ trip: await getTrip() });
      case 'trip:clear':
        await chrome.storage.session.remove(TRIP_KEY);
        await badge(null);
        return sendResponse({ ok: true });
      case 'capture': {
        const trip = await getTrip();
        if (!trip) return sendResponse({ ok: false, reason: 'no trip' });
        if (trip.captures >= 40) return sendResponse({ ok: false, reason: 'limit' });
        const body = {
          trip: {
            origin: trip.query.origin,
            destination: trip.query.destination,
            date: trip.query.date,
            adults: trip.query.adults,
            airlineCode: trip.offer.airlineCode,
            flightNumbers: trip.offer.flightNumbers,
            shownTotal: trip.offer.shownTotal,
            googlePerPerson: trip.offer.googlePerPerson,
          },
          page: msg.page,
          helperVersion: chrome.runtime.getManifest().version,
        };
        try {
          const res = await fetch(`${trip.apiOrigin}/api/page-captures`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            trip.captures += 1;
            await chrome.storage.session.set({ [TRIP_KEY]: trip });
          }
          return sendResponse({ ok: res.ok, count: trip.captures });
        } catch (e) {
          return sendResponse({ ok: false, reason: String(e) });
        }
      }
      default:
        return sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

/** Production AirRex sites are listed in the manifest's first content script (besides localhost). */
async function isAirRexOrigin(url) {
  const cs = chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? [];
  return cs.some((pattern) => {
    const m = /^(https?):\/\/([^/]+)\//.exec(pattern);
    if (!m) return false;
    const u = new URL(url);
    const host = m[2].replace(/^\*\./, '');
    return u.protocol === `${m[1]}:` && (u.hostname === host || u.hostname.endsWith(`.${host}`));
  });
}

chrome.runtime.onStartup.addListener(async () => badge(await getTrip()));
