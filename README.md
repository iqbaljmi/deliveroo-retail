# Deliveroo Retail — Database-free Product Availability Upload

Next.js/TypeScript, database-free availability manager for 15 allowlisted K-Secret sites.

## Setup

1. Install Node.js 20 or later.
2. Extract the zip; open a terminal in the project folder.
3. `npm install`
4. Copy `.env.example` to `.env.local` and fill in your **own** Deliveroo Client ID, Client Secret and environment-specific Brand ID. The production Brand ID can differ from test. Set a strong `APP_PASSWORD`. Do not upload `.env.local` to Git.
5. Run `npm run dev` and browse `http://localhost:3000`. Sign in on the login page using APP_USER and APP_PASSWORD.
6. Select a store, click **Sync products**, then export the current availability or download that store's template. Fill it, upload, review, confirm and submit.

## Excel format

| Site ID | Barcode | Status |
|---|---|---|
| 718446 | 8809874683140 | Unavailable |

The `Availability` sheet is used when present, otherwise the first sheet is used. Every populated row must include the selected store's Site ID; the backend rejects cross-store rows and mismatched `Store` metadata before review. Sync the selected store before importing. Files are parsed in server memory and never saved. Barcodes must be **Excel Text cells** to preserve leading zeros and 13+ digit precision. PLUs also work where populated. Only Available, Unavailable, Hidden and common equivalents are accepted. Multiple barcodes or PLUs for the same product cannot be submitted as separate updates.

## APIs

- `GET /api/products?siteId=718446`: gets the allowlisted site's live catalogue; no DB.
- `GET /api/availability?siteId=718446`: gets that site's live unavailable / hidden lists.
- `POST /api/import`: accepts multipart `siteId` and `file`, validates the allowlisted site and workbook store identifiers, refreshes that store's catalogue and validates the imported rows. Maximum 4 MB and 10,000 data rows.
- `POST /api/update`: accepts `{ "siteId":"718446", "sourceSiteId":"718446", "updates": [{"item_id":"...", "status":"unavailable"}] }`, allowlists the site, rejects a mismatched import Site ID, validates product IDs against that site's live catalogue, calls Deliveroo and verifies current status.

## Important

- Availability API updates only statuses, **not quantities**. "Unavailable" may reset next morning; "Hidden" persists until changed. No rows are silently made available if omitted from upload.
- Only a subset of uploaded barcodes is sent. If one barcode is unknown, duplicated, or ambiguous, the page blocks submission until corrected. 
- Switching stores clears all synced catalogue, availability, uploaded rows, confirmation and result state. Each API request and response is tied to the selected allowlisted Site ID. Late sync/import results from a previous store are ignored. Store selection is locked while a submission is in progress.
- A login page and signed HttpOnly session cookie protect the screen and API routes. Credentials remain in server environment configuration.
- Node holds credentials in environment variables, never in browser code. Deliveroo access tokens cached only in server memory until near expiry.
- The page displays the HTTP outcome and GET verification (API state can take time to converge). No claim of success is made if verification mismatches.
- `lib/deliveroo.ts` provides shared connection methods, making a later Inventory API module straightforward.

## Validation

Run `npm run typecheck`, `npm run build`, and `node tests/multi-store.test.cjs`.
The multi-store regression tests mock every Deliveroo request, including stock submissions; they never contact the live API or load `.env.local` credentials.
Development builds use `.next-dev`; production builds and `npm start` use `.next`. This keeps production build checks from overwriting assets served by a running development server. Restart the development server after changing Next.js configuration.

## Delta availability updates

- Full or partial store Excel files are accepted. Import refreshes live availability and shows **Changed**, **Unchanged**, **Hidden kept**, and **Invalid** counts.
- Only reviewed changed products are submitted. The backend refreshes live availability immediately before writing and skips products that now match.
- A file that already matches needs no stock submission. Repeating an upload does not resend unchanged products.
- Products currently hidden stay hidden by default. To restore them, explicitly enable the hidden-product option and review the new change count. Setting a visible product to Hidden is still supported.
- Omitted products remain untouched. All writes use the individual-update endpoint.
- Results include submitted/skipped counts and a fresh verification snapshot. If verification cannot be read, sync again before another import or submission.
- No database, previous-upload cache, or stored Excel file is needed.

## Login

Open `http://localhost:3000`. The app redirects to a login page.
Use the existing `APP_USER` and `APP_PASSWORD` from the server's `.env.local`.
Signed HttpOnly session cookies last 12 hours. Sign Out clears the browser session.
Changing the configured username or password invalidates existing sessions.
The browser Basic Auth popup is replaced by this login page; unauthenticated API calls return JSON 401.

## Automatic Windows startup

Install once on the customer's Windows PC, from the account that will use the app:

1. Install Node.js 20 or later and configure `.env.local`.
2. Run `npm install`, then `npm run build`.
3. Run `npm run background:install`.
4. Open `http://localhost:3000` and sign in. No command window needs to stay open.

The installer creates a current-user Task Scheduler task at Windows sign-in.
If Task Scheduler registration is unavailable, it uses the current user's Windows startup registry entry.
Both methods launch the app invisibly. A supervisor restarts the production server after an unexpected exit.
It uses the production build, never `npm run dev`, and listens on localhost port 3000.

This setup runs while this Windows account is signed in; it does not run while the PC is off or asleep.
A service that starts before any user signs in requires a separate machine-wide service installation.
Run the installer again if the project folder or Node.js installation moves.

Commands:

- `npm run background:status`: show running state and log location.
- `npm run background:stop`: stop the background app.
- `npm run background:start`: start it again.
- `npm run background:uninstall`: remove automatic startup and stop the app.
- For code updates: stop the app, run `npm run build`, then start it again.

Logs and process state are in `runtime/`, which is excluded from Git. No credentials or stock uploads are stored there.
