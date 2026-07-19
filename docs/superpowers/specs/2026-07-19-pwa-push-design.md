# CC Tracker — PWA + Push Notifications design

Date: 2026-07-19 · Status: approved in conversation ("Build it all!")

## Goal

Turn CC Tracker into an installable PWA that sends game-day push notifications, while
keeping the front end a static, no-build vanilla HTML/CSS/JS app. The only new server
surface is two Vercel Functions in `/api`.

## Components

### 1. PWA shell (static files)

- `manifest.webmanifest` — name "CC Tracker", short_name "CC Tracker",
  `display: standalone`, `start_url: /#game`, theme/background `#0b1830`,
  icons 192/512 plus a maskable 512 (padded, solid navy background).
- Icons rasterized from `favicon.svg`: `icons/icon-192.png`, `icons/icon-512.png`,
  `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png` (180, solid bg),
  `icons/badge-96.png` (monochrome white glyph for Android notification badge).
- `index.html` gains the manifest link, `apple-touch-icon` link, and
  `apple-mobile-web-app-*` meta tags.

### 2. Service worker (`sw.js`, site root)

- Versioned cache name; bump invalidates old caches on activate.
- Strategies:
  - Shell (`/`, `index.html`, `styles.css`, `app.js`, manifest, icons): network-first,
    fall back to cache (offline shows last-known page).
  - ESPN API GETs: network-first; successful responses copied into a data cache;
    on network failure serve the cached copy (stale-if-error → offline shows
    last-known scores).
  - Fonts/logos/headshots: cache-first with background revalidation.
- Push handlers:
  - `push` → `showNotification(title, {body, icon, badge, data: {url}})`.
  - `notificationclick` → focus an existing client or `openWindow(data.url)`.
  - `pushsubscriptionchange` → resubscribe with the VAPID public key and re-POST
    to `/api/subscribe`.

### 3. Front-end push UI (`app.js` + `styles.css`)

- Bell toggle in the top bar reflecting subscription state
  (`pushManager.getSubscription()`).
- Tap flow: iOS Safari not installed → show an "Add to Home Screen" instruction
  card (push on iOS requires the installed app, 16.4+). Otherwise
  `Notification.requestPermission()` (only ever from this tap) →
  `pushManager.subscribe({userVisibleOnly, applicationServerKey})` →
  POST subscription JSON to `/api/subscribe`. Toggle off → unsubscribe +
  DELETE to `/api/subscribe`.
- `beforeinstallprompt` (Android/desktop Chrome) captured → small "Install"
  chip in the top bar.
- VAPID public key is a hardcoded const (public by design).

### 4. Backend (Vercel Functions, Node, ESM)

- `package.json` with `web-push` and `@vercel/blob` only; **no build script** so
  Vercel keeps serving the root statically.
- Storage: **Vercel Blob** (free tier, native, no marketplace purchase).
  - One blob per subscription: `subs/<sha256(endpoint)>.json` — no
    read-modify-write races.
  - Poller dedupe state: `state/<gameId>.json` (single writer: the scheduled
    poller; rare overlap accepted).
  - Fallback if Blob provisioning fails: Supabase table (project already connected).
- `api/subscribe.js` — POST: validate shape (https endpoint, p256dh/auth keys,
  size cap) and store; DELETE: remove by endpoint. 405 otherwise.
- `api/poll.js` — requires `POLL_SECRET` (Bearer or `?key=`).
  - `?mode=check`: cheap schedule fetch → `{active: bool}` (game live or tipping
    off within 45 min). Gates the GitHub Actions loop.
  - Full run: fetch schedule (+ summary when relevant), compute alerts, load
    per-game state, send via `web-push` to all stored subscriptions, prune
    404/410 subscriptions, save state.
  - Alert rules (each fires once per game, guarded by state):
    - `tipoff` — starts within ≤35 min: "Tipoff soon: Fever vs X, 7:00 PM on ESPN".
    - `clutch` — in-game, Q4/OT, margin ≤5, clock ≤5:00.
    - `tripledouble` — Clark ≥8 in three of pts/reb/ast, game in progress.
    - `final` — completed: score, W/L, Clark statline from boxscore.
  - Alert decision logic lives in a pure exported function
    (`decideAlerts(sched, summary, state, now)`) so it is unit-testable without
    network or storage.

### 5. Scheduler (GitHub Actions — repo is public, minutes are free)

- `.github/workflows/push-poller.yml`: cron every 30 min + `workflow_dispatch`.
- Job calls `mode=check`; if inactive, exits (seconds of runtime on off nights).
  If active, loops ~25 min pinging `/api/poll` every 60 s → 1-minute alert
  granularity during games. Vercel Cron is not used (Hobby granularity too coarse).
- `POLL_SECRET` stored as a repo Actions secret.

### 6. Secrets / env

- VAPID keypair via `web-push generate-vapid-keys`; `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto), `POLL_SECRET` set on Vercel
  (production + preview). `BLOB_READ_WRITE_TOKEN` auto-provisioned by the store.

## Error handling

- Subscribe endpoint rejects malformed/oversized payloads; front end surfaces a
  quiet toast/state reset on failure.
- Poller treats every push send independently; 404/410 deletes the subscription,
  other errors are logged and skipped.
- SW fetch handler never throws: falls through to network, then cache, then a
  plain error Response.

## Testing

- Pure alert logic unit-tested with fixtures (live ESPN samples + synthetic
  clutch/final states) via a node script.
- Local static serve + Playwright smoke test: SW registers, manifest parses,
  bell renders, zero console errors.
- Post-deploy: manifest/sw content-types, subscribe validation, poll auth,
  one manual workflow_dispatch run.

## Out of scope (v1)

- Per-alert-type preferences (single all-alerts toggle only).
- Season-aggregate shot chart, Record Watch (separate features).
- Web Push topic segmentation, rate limiting on subscribe.
