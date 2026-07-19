# Clark shot chart — design

Date: 2026-07-19 · Approved: user ("Build the Clark shot chart next")

## What

An SVG half-court in the Clark Watch section plotting Caitlin Clark's field-goal
attempts: makes vs misses, with per-shot tooltips, a Last game / Season toggle,
and live updates during games. Win-probability meter is explicitly out of scope.

## Data (verified against live ESPN summaries)

- Source: the summary endpoint's `plays[]` the app already fetches for the focus
  game; season mode lazily fetches past completed games' summaries once and
  caches parsed shots in `localStorage` (`cc-shots-v1`, keyed by event id).
- Shot filter: `text` matches `/^Caitlin Clark (makes|misses)/`, not a free
  throw, and sane coordinates (free throws carry sentinel garbage like
  x=-214748340). Participant-based filtering is WRONG — it matches her assists.
- Coordinate system (verified): x 0–50 across the court, rim center at
  (25, 0), y = distance up-court from the rim plane; already normalized to one
  basket. Layups can be slightly negative (behind rim plane).

## Rendering (dataviz skill applied)

- Half-court: baseline y=−5.25, backboard, rim, restricted arc, 16ft lane to the
  FT line (y=13.75) with circle, WNBA 3pt arc r=22.15 with corner lines at
  x≈3/47. Court lines recessive (same `oklch(0.32 0.045 262)` as worm gridlines).
- Marks: makes = filled `--mark-gold` #BC8A06 dots; misses = `--mark-blue`
  #6890D6 rings — color + shape (never color alone). ≥8px effective size, dark
  2px-equivalent surface ring for overlap separation. Palette pair re-validated
  dark-mode this session: all checks pass.
- Legend row (2 series) + a stats line in the chart sub ("18 FGA · 8 made").
- Hover/tap layer: per-mark tooltip (period, clock-less play text, shot value)
  reusing the existing `.chart-tip` pattern; invisible enlarged hit circles.
- Toggle: Last game (or Live during games — re-renders on the 25s poll) /
  Season (lazy aggregate with load progress, then cached).

## Files

`index.html` (new banner in Clark section), `app.js` (parse + render + season
cache), `styles.css` (toggle/legend styles). Version bumps: app v=5, styles
v=6, sw.js SHELL updated + cache VERSION v3.
