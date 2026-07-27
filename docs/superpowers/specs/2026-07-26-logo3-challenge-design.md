# Logo 3 Challenge — Design

**Date:** 2026-07-26
**Status:** Approved (design conversation 2026-07-26)

A fun, addictive 3-point shooting mini-game built into CC Tracker, themed around
Caitlin Clark's signature logo threes. Physics-driven, skill-based (no RNG),
playable one-thumb on mobile and with a mouse on desktop. Rounds, points, and a
persistent personal-best history.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Perspective | Behind the shooter, pseudo-3D (flick toward a receding hoop) |
| Core gesture | Drag & flick — direction = aim, gesture speed/length = power |
| Format | 3 deepening rounds × 5 balls, ending at the center-court logo |
| Placement | Full-screen overlay launched from a card in the Clark section |
| Tech | Hand-rolled Canvas 2D + perspective projection; zero dependencies, no build step |

## Architecture

New self-contained module **`shootout.js`** (loaded with its own
`<script type="module" src="shootout.js?v=1">` tag — it uses `export` so the
pure core is importable by tests; module scripts defer by default). `app.js` is untouched except that nothing in it needs to change at all —
the card lives in `index.html` and `shootout.js` wires its own listeners.
Markup added to `index.html`; styles appended to `styles.css`; `sw.js` shell
list gains `shootout.js?v=1` and `VERSION` bumps to `v4` (also bump the
`styles.css`/`index.html` query strings that change).

Internally `shootout.js` has three layers, kept as separable functions:

1. **Pure simulation core** (exported for tests, no DOM/canvas):
   physics step, collision resolution, make/swish detection, scoring + streak
   state machine, flick-gesture → launch-velocity mapping.
2. **Renderer**: canvas scene (court, hoop, net, ball, HUD, particles),
   perspective projection, fixed-timestep loop with interpolated render.
3. **Shell/UI**: overlay open/close, screens (start / between-rounds / end),
   localStorage bests, sound + haptics toggles.

Pure core is imported by tests via `import { ... } from '../shootout.js'` —
the file guards its DOM bootstrapping behind `typeof document !== 'undefined'`.

## Entry point & shell

- **Card** in the Clark section (below the shot chart card): gold-accented,
  "Logo 3 Challenge" with a one-line tease and `Best: N` (or "Not yet played").
- Tap → full-screen fixed overlay (`.shootout-overlay`), body scroll locked,
  `✕` button and `Escape` both close (with confirm-free instant close; game
  state is discarded mid-run — it's a 90-second game).
- Canvas sized to overlay via `devicePixelRatio`, portrait-first; on wide
  desktop viewports the playfield renders as a centered column (max-width
  ~560px) with letterboxed navy gutters.
- `visibilitychange` pauses the loop; `resize`/orientation re-measures.
- Focus is moved into the overlay on open and restored on close; buttons have
  ARIA labels. The canvas itself is `role="img"` with a short description —
  the game is inherently visual/gestural and is not made screen-reader playable.

## Scene & rendering

- World coordinates in **feet**: `x` lateral (+right), `y` up, `z` depth toward
  the hoop (shooter near origin). Pinhole projection with camera slightly above
  and behind the ball spot; screen pos = `center + (world − cam) · f / depth`.
- Scene: navy floor with perspective court lines (paint, WNBA 3-pt arc), gold
  **center-court logo** (stylized "CC" roundel — original, not official marks),
  backboard + proper-ellipse rim, stanchion hint, dark arena gradient backdrop.
- Net: small verlet cloth (~8 strands × 4 rings, distance constraints, a few
  iterations/frame), pinned to the rim ellipse; ball pushes nodes on a make.
- Ball: shaded circle with rotating seam lines (fake backspin); scale from
  projection. On-fire state adds flame trail particles.
- Loop: `requestAnimationFrame` render + fixed 120 Hz physics accumulator with
  interpolation. Runs only while the overlay is open.
- HUD (canvas-drawn): score, round name + ball dots remaining, streak flames.
- `prefers-reduced-motion`: no screen shake, no particle bursts, no flame trail.

## Physics (real, deterministic — no RNG)

Constants (WNBA regulation, in feet):

- Gravity 32.17 ft/s²; quadratic air drag with a small coefficient (tuned so a
  22-ft shot needs ~1–2% more speed than vacuum — flavor, not simulation-grade).
- Ball: 28.5″ circumference → radius 0.378 ft; restitution vs rim 0.55, vs
  board 0.5, vs floor 0.6 (with velocity damping per bounce).
- Rim: ring center 15″ from the board face; ring radius 0.75 ft, tube radius 0.05 ft,
  center at (0, 10, hoopZ). Collision: nearest point on the rim circle to ball
  center; if distance < ballR + tubeR, reflect velocity about the contact
  normal with restitution + tangential damping. Rattles/lip-outs emerge.
- Backboard: 6 ft × 3.5 ft plane, bottom edge at 9.5 ft; plane collision with
  restitution — bank shots are legal and score.
- **Make**: ball center crosses the rim plane (y = 10) moving downward with
  its center inside the ring radius. **Swish**: make with zero rim/board
  contacts. Miss: ball falls below floor plane or z overshoots far past board;
  it bounces on the floor and fades, then next ball spawns.

## Controls (flick model)

- Pointer events (`pointerdown/move/up`, `setPointerCapture`), identical for
  touch and mouse. Press anywhere in the lower third (generous target around
  the ball), drag, release.
- Launch velocity from the last ≤100 ms of the pointer trail:
  - Horizontal screen component → lateral aim angle (clamped ±14°).
  - Gesture speed (px/s, normalized by canvas height so devices behave alike)
    → launch speed, clamped to [min, max] per round.
  - Launch elevation: base 50°, eased down to ~44° as flick speed approaches
    max (hard flicks fly flatter) — gives arc feel without a second control.
- Per-round tuning maps a comfortable mid-strength flick to rim distance:
  required vacuum speed at 48° is ~24.5 ft/s (22 ft), ~26.8 ft/s (26 ft),
  ~29 ft/s (30.5 ft) — the gesture→speed scale shifts each round so deeper
  rounds need genuinely harder, cleaner flicks.
- Downward/backward gestures and taps without movement are ignored (no shot).

## Game format & scoring

3 rounds × 5 balls = 15 shots (~90 s/game):

| Round | Name | Distance | Spots | Make |
| --- | --- | --- | --- | --- |
| 1 | The Arc | 22 ft | corner → wing → top → wing → corner | 100 |
| 2 | Deep | 26 ft | same 5-spot sweep, deeper | 200 |
| 3 | The Logo | ~30.5 ft | center-court logo, 5 balls | 300 |

- Shot spots move the shooter origin (and camera) laterally per ball; the hoop
  stays world-fixed, so corners genuinely change the aim picture.
- **Swish** = +50% of that shot's value.
- **On fire**: 3 straight makes ignite the ball — all points ×2 until a miss.
  Streak carries across rounds. (Multipliers stack: logo swish on fire =
  300 × 1.5 × 2 = 900.)
- Between rounds: brief interstitial ("Round 2 — Deep · 200 pts a make").
- End screen: total score, makes/15, longest streak, swishes, top-5 best list,
  `NEW BEST!` treatment when earned, Play Again + Close.

## Persistence (`localStorage`, key `cc-shootout-v1`)

```json
{
  "bests": [{ "score": 3150, "makes": 12, "streak": 7, "swishes": 4, "date": "2026-07-26" }],
  "career": { "games": 14, "makes": 96, "swishes": 21, "points": 18400 }
}
```

- `bests` kept sorted, capped at 10. Card shows `bests[0]`; end screen shows
  top 5. JSON parse failures reset to empty (never crash the page).

## Sound & haptics

- WebAudio-synthesized (no asset files): bounce thud, rim clank (filtered
  noise + metallic ping), swish whoosh, on-fire whoosh/roar, score tick.
- AudioContext created lazily on first user gesture (autoplay policy).
- Mute toggle in the overlay HUD, persisted in the same localStorage blob.
- `navigator.vibrate(30)` on makes where supported (Android); silently absent
  elsewhere (iOS).

## Error handling

- All localStorage reads wrapped; corrupt data → fresh state.
- Canvas/context failure (ancient browser) → card hides itself.
- Overlay never blocks the rest of the app: any thrown error in the game loop
  is caught once, loop stops, overlay shows a "Something went wrong" note with
  a Close button.

## Testing (`tests/shootout.test.mjs`, `node --test`)

Pure-core tests, no DOM:

1. **Trajectory sanity**: a centered launch at the tuned speed/angle from 22 ft
   scores a make; the same shot 15% weak falls short (no make).
2. **Make detection**: downward crossing inside ring = make; upward crossing or
   outside radius = not a make; swish flag false after a rim contact.
3. **Rim collision**: ball approaching the ring reflects (velocity toward rim
   flips about the normal, speed reduced by restitution).
4. **Scoring/streak machine**: round values, swish bonus, on-fire at 3 makes,
   ×2 while hot, reset on miss, streak persists across round boundary.
5. **Bests list**: insert/sort/cap-at-10, new-best detection.

## Out of scope (YAGNI)

- Online/shared leaderboards, multiplayer, daily challenges.
- Real player sprites or official team/league marks inside the game scene.
- Landscape-specific layout (portrait column works in both orientations).
- Screen-reader-playable gameplay (menus/buttons accessible; play is visual).
