// Runs on the AirRex site. Lets the AirRex page hand the chosen trip (flight, shown price, passengers) to the
// helper, and tells the page the helper is installed. Only pages marked <meta name="airrex-app"> are served,
// so other sites on localhost are ignored.

(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const isAirRex = () => !!document.querySelector('meta[name="airrex-app"]');
  const reply = (msg) => window.postMessage({ ...msg, from: 'airrex-helper' }, location.origin);

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !isAirRex()) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.from === 'airrex-helper') return;
    if (d.type === 'airrex:hello') reply({ type: 'airrex:helper', version: VERSION });
    if (d.type === 'airrex:trip' && d.trip && typeof d.trip === 'object') {
      chrome.runtime.sendMessage({ type: 'trip:set', trip: d.trip }, (r) => reply({ type: 'airrex:trip-saved', ok: !!r?.ok }));
    }
  });

  const announce = () => isAirRex() && reply({ type: 'airrex:helper', version: VERSION });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce, { once: true });
  else announce();
})();
