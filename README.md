# CC Tracker — Indiana Fever

A live, single-page Indiana Fever game tracker with a dedicated Caitlin Clark section. Built in the spirit of [Fly the W](https://github.com/jrsherlock/fly-the-w): one static page, no build step, no dependencies, live public-API data.

## What it does

- **Game center hero** — when the Fever are playing: live score, quarter and clock, last play, quarter-by-quarter linescore, and Caitlin Clark's live statline, refreshed every 25 seconds. Off nights: a countdown to tipoff with venue and broadcast, plus the last final.
- **Clark Watch** — season averages vs. career (PPG / APG / RPG / 3P%), a last-game banner with season-high flags, a points-per-game chart with a season-average reference line and hover statlines, a season ledger (highs, double-doubles, 20-point games), and a full recent game log.
- **Momentum** — a lead-tracker worm built from ESPN play-by-play: gold when the Fever lead, blue when trailing, with quarter gridlines, biggest lead / worst deficit, and a scrub-friendly crosshair tooltip.
- **Recent & up next** — last eight results with W/L chips, next five games with local tip times and broadcast.
- **Standings** — both conferences, Fever row highlighted, W/L/PCT/GB (plus streak and L10 on wider screens).
- **Highlights** — a swipeable rail of ESPN recaps, videos, and headlines.

Mobile-first throughout: sticky section nav, scroll-snap news rail, safe-area padding, battery-friendly polling that pauses when the tab is hidden.

## PWA + game-day alerts

The site is an installable PWA: add it to your home screen (Android/desktop get an
Install chip; iOS uses Share → Add to Home Screen) and it launches standalone with
offline support — the service worker keeps the shell and last-known scores.

Tap the bell in the top bar to opt into push alerts (on iOS 16.4+ this works only
from the installed home-screen app):

- **Tipoff soon** — ~30 minutes before the Fever tip.
- **Clutch alert** — Q4/OT, margin ≤5, under 5:00 to play.
- **Triple-double watch** — Clark at 8+ points, rebounds, and assists live.
- **Final** — score, W/L, and Clark's line.

How it works: `api/subscribe.js` stores push subscriptions (AES-256-GCM-encrypted
at rest) in Vercel Blob; a GitHub Actions cron (`.github/workflows/push-poller.yml`)
wakes every 30 minutes, and during game windows pings `api/poll.js` each minute,
which reads the same ESPN endpoints, decides alerts (pure, unit-tested logic in
`api/poll.js`, tests in `tests/`), and fans out via Web Push with VAPID. Alert
dedupe state lives in Blob too, so each alert fires once per game.

## Run locally

Any static server works:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tech

- Vanilla HTML / CSS / JS front end — no build step, no dependencies. The only
  server code is two Vercel Functions in `api/` (`web-push` + `@vercel/blob`).
- Data from the public ESPN API (team schedule, game summaries with play-by-play and boxscores, standings, news, and athlete stat endpoints), fetched client-side.
- Hand-rolled SVG charts. Chart colors validated for contrast and color-vision-deficiency separation against the navy surface.
- Graduate + Saira Condensed + Archivo + Red Hat Mono via Google Fonts.

## Disclaimer

Not affiliated with the Indiana Fever, Caitlin Clark, or the WNBA. Data courtesy of the public ESPN API.
