# AirRex ✈

A mobile-friendly flight comparison web app (Skyscanner-style).

1. **Search**: pick from, to, date, passengers and cabin.
2. **Compare**: see every flight for that date with the full price (base fare + taxes = what you pay). You can sort (cheapest / best / fastest / earliest), filter by airline, stops and departure time, and switch dates.
3. **Book on the airline**: clicking *Book on Air India* (or IndiGo, Akasa, …) opens that airline's own website. Booking and payment happen there. The flight is saved under **My trips**.
4. **Print ticket**: upload the e-ticket PDF or photo, drag over anything you want to hide (fare, phone, email…), then print or save as PDF. The file is processed in the browser only and is never uploaded.

## Run it

Requires Node.js 22.18+ and **PostgreSQL 18+** (agent accounts, logins and quotes). Flight search works without
the database; only the agent pages need it.

1. Copy `.env.example` to `.env` and uncomment the `POSTGRES_*` lines under "Local development only".
2. Start a database, either way:
   - **Docker (same as the server):** set `POSTGRES_PASSWORD` in `.env`, then `npm run db:up`. This starts
     `airrex-postgres` on `127.0.0.1:5436` (the values in those lines).
   - **A Postgres you already have:** create a database named `airrex` and point `POSTGRES_HOST/PORT/USER/PASSWORD` at it.
3. Run the app:

```powershell
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 8787, and Vite proxies `/api` to it. Tables are created
automatically on startup. The server prints `PostgreSQL ready`, or the reason it can't connect.

**Moving from the old SQLite file** (`.data/airrex.db`, used before the switch to Postgres): run
`npm run import-sqlite` once. It copies agents, quotes and active logins, keeping their ids. It refuses to
run if Postgres already has agents; add `-- --replace` to overwrite them.

Production: `npm run build` then `npm start`. A single Node server then serves the API and the built app on `PORT` (default 8787).

### Server (Docker, RetinueSoft VPS)

`docker-compose.yml` follows the other RetinueSoft apps (MotoC2B, ReXL):

| Container | Image | Port (127.0.0.1 only) |
|---|---|---|
| `airrex-postgres` | `postgres:18`, user `postgres`, database `airrex` | `POSTGRES_HOST_PORT` (5436) for SSH-tunnel access |
| `airrex-app` | `ghcr.io/retinuesoft/airrex` (Dockerfile in this repo) | `APP_HOST_PORT` (18087), proxied by the common Caddy |

`POSTGRES_PASSWORD` comes from the shared `/root/common/.env`, and the app's settings from
`/root/common/env/airrex.env` (created from `.env.example`). It is served on https://airrex.retinuesoft.com and
`https://<server-ip>:8087`; install, updates and backups are described in [DEPLOY.md](DEPLOY.md).

Admin on the server: `app-compose airrex exec app node server/admin.ts list`.

## Flight data

With no configuration, the API returns **demo fares**. These are deterministic, realistic-looking flights for Indian domestic airlines, so the whole UI works offline.

### Live prices: Google Flights via SerpApi

1. Create a free account at [serpapi.com](https://serpapi.com). The free plan gives 250 searches a month.
2. Copy `.env.example` to `.env` and set `SERPAPI_API_KEY=...` (your key from the SerpApi dashboard).
3. Restart `npm run dev`. The startup line should say `data: google-flights`.

How searches are used:
- **One search per new route + date** (always Economy, always searched for 1 adult). For 2+ adults the app multiplies the 1-adult fare, so the group size doesn't use extra searches. Group totals are marked as estimates, because an airline can charge more when few seats are left at the cheapest fare. Results are reused for `SEARCH_CACHE_MINUTES` (default 720 = 12 hours) and saved in `.cache/`, so restarts don't use searches again. The results page shows "Prices checked X min ago".
- **Opening the booking pop-up is free.** It shows links already saved for that flight, otherwise "Continue to <airline>" (the airline's website). Only when the user clicks **Get the direct link for this flight** does the app spend one search to fetch the link to this flight on the airline's own website. Other booking sites (OTAs) are never shown: AirRex only sends people to the airline. Those links are saved for 3 hours.
- When the quota runs out, users see "Live prices are temporarily unavailable". Set `FALLBACK_TO_DEMO=true` to show labelled demo fares instead (useful in development).

Google Flights gives one total price including taxes, with no base/tax split, so the fare details show only "You pay".

### Cheapest-date calendar (`/cheapest-dates`)

Pick a route and a date range (up to 62 days) to see the cheapest 1-adult Economy price for each day. The date row on the results page shows the same prices. The calendar **uses no SerpApi searches**. Each day's price comes from:

1. a live search the app already saved in the last 12 hours (exact when checked), otherwise
2. **Travelpayouts** recent-search prices (approximate, shown with ≈), if `TRAVELPAYOUTS_TOKEN` is set, otherwise
3. "–", meaning not known yet. Tapping the day runs a normal live search.

To enable Travelpayouts (free): sign up at travelpayouts.com, connect the **Aviasales** programme, copy the API token from your profile into `.env` as `TRAVELPAYOUTS_TOKEN`. It uses `aviasales/v3/grouped_prices` with `market=in`, one request per route per month, saved for 6 hours.

| Source | Env var | Notes |
|---|---|---|
| Google Flights via [SerpApi](https://serpapi.com/google-flights-api) | `SERPAPI_API_KEY` | `server/providers/serpapi.ts`. Used first if set. |
| [Travelpayouts](https://www.travelpayouts.com) (Aviasales Data API) | `TRAVELPAYOUTS_TOKEN` | `server/providers/travelpayouts.ts`. Calendar estimates only. |
| [Duffel](https://duffel.com) | `DUFFEL_ACCESS_TOKEN` | `server/providers/duffel.ts`. A `duffel_test_…` token gives sandbox data. |

To add another source (TBO, Tripjack, Skyscanner partner API…), implement `FlightProvider` in `server/providers/` and select it in `server/index.ts`.

### About the "book on the airline website" step
With SerpApi, the booking pop-up lists **Book on IndiGo / Air India…** links from Google Flights. Google requires these redirects to be opened with an HTTP POST, which the app does in a new tab. If no airline link is available (or with demo data), the button opens the airline's homepage and shows the flight number with a copy button. Airline homepages are in `shared/airlines.ts`.

## AirRex for Agents (paid plan)

Travel agents sign up at **/agent/login** and get a free trial (`AGENT_TRIAL_DAYS`, default 30). While the trial or plan is active they get:

- **WhatsApp quotes.** On the results page each flight has **Add to quote**. The quote bar lets the agent add a customer name and number and a service charge per passenger, then **Send on WhatsApp** or **Copy text**. Quotes are saved under **Agent → Saved quotes**, where they can be resent or searched again for fresh prices.
- **Branded ticket printing.** The print page adds the agency header (logo, name, address, phone, GSTIN) and footer to every printed page.
- **Auto-hide fares.** On PDF e-tickets this finds price amounts (₹/INR/Rs, and numbers on Fare/Tax/Total/Fee lines) and covers them. Times, baggage weights and terminals are left alone. Agents should still check the result. It doesn't work on photos or scans.

- **Saved passengers** (Agent → Saved passengers). Scan a customer's passport once, with their permission, and pick
  them when booking. Details are encrypted on the server (AES-256-GCM, key in `PASSENGER_DATA_KEY`), visible only to
  that agent, and deleted automatically after 7/30/90/365 days (default 30).

When a plan ends, quotes and branding pause, but saved quotes can still be viewed.

### AirRex Helper (browser extension, `extension/`)

A Chrome/Edge extension (Manifest V3, plain JavaScript, no build step) for booking on a computer. Install page:
**/helper** (download `/airrex-helper.zip`, then *Load unpacked* in `chrome://extensions` with Developer mode on).

- **Hand-over.** When someone clicks *Continue to the airline* in AirRex's booking pop-up, the page passes the trip
  (route, date, flight, the price AirRex showed, and the passengers added) to the extension (`airrex-bridge.js`, only
  on pages with `<meta name="airrex-app">`). The extension keeps it in `chrome.storage.session` (memory only, cleared
  when the browser closes, forgotten after 6 hours). Passenger details are never sent to the AirRex server.
- **Fill passengers.** On the airline's site a small AirRex panel appears. Tapping a passenger's name fills the form
  (`engine.js`): fields are recognised from their labels/placeholders/names, values are set so React/Angular forms
  notice, dates match the field's format (or day/month/year dropdowns), title/gender/nationality dropdowns and radio
  buttons are matched by text. Contact, payment and loyalty fields are never touched. Fields it can't set (some custom
  dropdowns) are highlighted orange. Nothing is submitted: the person checks and continues.
- **Fill the flight search.** "Continue to the airline" usually opens the airline's home page. The panel's
  **Fill search** picks *One way*, types the From/To airport codes and chooses the matching suggestion, and sets the
  date (typed in the field's format, or by opening the calendar and clicking the day). Adults are listed for the
  person to set. A **Search details to copy** list (trip type, From, To, date in the airline's format, adults,
  flight number) covers anything it can't set.
- **Record prices (automatic).** On every airline page, including the payment page's fare breakdown (where
  IndiGo adds its convenience fee), the extension reads the visible text lines that contain an amount (fare options,
  fees, bag prices, totals), masks e-mails and long numbers, and posts them to `POST /api/page-captures` with the
  flight and AirRex's shown price. It never reads inputs, so card/UPI details and anything typed are never recorded
  (card forms also sit in the payment provider's frames). There is no button: travellers don't need to do anything.
  Read them with `npm run admin -- captures [days]` (the `payment` column marks payment pages) and
  `npm run admin -- capture <id>`.
- **Sites.** Airline domains are listed in `extension/manifest.json`. AirRex itself: localhost, plus the live address
  from `AIRREX_SITE_URL`, which `npm run build` (`server/tools/zip-extension.ts`) adds to the packed manifest.
- **Limits.** Filling is generic, so a field an airline builds unusually may be missed (it says which). Price lines
  are raw text: use them to check and update `shared/airlineFees.ts` and `shared/baggagePolicy.ts`.

### Passenger details and "What did you pay?" (everyone)

- **Passenger details for the airline form.** In the booking pop-up, travellers scan the passport photo page (or paste
  the two `P<IND…` lines, or type the details). The two-line passport code is read **in the browser**
  (`src/lib/passportScan.ts` with tesseract.js, checked by `shared/mrz.ts`); the photo is never uploaded. AirRex then
  shows every field the airline asks for, each with a **Copy** button, and warns if the passport expires within
  6 months of travel. Travellers' details stay in that browser tab only.
- **What did you pay?** After clicking through to the airline (pop-up, or later from **My trips**), people can report
  the final total, fare type, bag cost and fees. Reports are saved in `fare_reports` (no personal data) and shown with
  `npm run admin -- reports [days]`: per airline, how far the real price was from AirRex's, average bag cost and fees.
  Use them to update `shared/airlineFees.ts` and `shared/baggagePolicy.ts`.

**Taking payment / renewals (manual for now).** When an agent pays you (UPI, bank transfer), extend their plan:

```powershell
npm run admin -- list
npm run admin -- extend agent@example.com 30
npm run admin -- expire agent@example.com
npm run admin -- reset-password agent@example.com
npm run admin -- delete agent@example.com
```

Set `VITE_AGENT_PLAN_PRICE`, `VITE_SUPPORT_WHATSAPP` (or `VITE_SUPPORT_EMAIL`) in `.env` so agents see your price and a **Renew** button.

**Data.** Accounts, sessions and quotes are stored in PostgreSQL (tables `agents`, `sessions`, `quotes`; created and
upgraded automatically by `server/db.ts`). On the server, `backup-db.sh` backs it up with the other apps once AirRex is in `apps.conf`. Passwords are hashed with scrypt. Sessions use an HttpOnly cookie and expire after 30 days. Logins are rate-limited per IP. Behind a reverse proxy, set `TRUST_PROXY=true`. In production, set `NODE_ENV=production` so cookies are marked Secure, and serve the site over HTTPS.

## Project layout

```
shared/     types, airport list, airline directory (used by server and web)
server/     node:http API (/api/search, /api/airports) + flight providers
src/        React app: pages/ (Search, Results, My trips, Print ticket), components/, lib/
```
