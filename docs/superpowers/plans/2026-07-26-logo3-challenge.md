# Logo 3 Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A physics-driven, flick-to-shoot 3-point mini-game (arc → deep → logo) inside CC Tracker, with rounds, streak/on-fire scoring, and localStorage personal bests.

**Architecture:** One new ES module, `shootout.js`, with three layers: an exported pure simulation core (physics, flick mapping, scoring, store parsing — tested via `node --test`), a Canvas-2D perspective renderer, and a DOM shell (overlay, screens, persistence) guarded behind `typeof document !== 'undefined'`. `index.html` gains a launch card + overlay; `styles.css` gains one appended block; `sw.js` caches the new file.

**Tech Stack:** Vanilla JS (ES module), Canvas 2D, WebAudio, localStorage, `node --test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-07-26-logo3-challenge-design.md`

## Global Constraints

- **No dependencies, no build step.** Vanilla JS only. Nothing added to `package.json`.
- `shootout.js` is an ES module loaded with `<script type="module" src="shootout.js?v=1">`; it must be importable under Node (all DOM/browser access lives inside `initShootout()` or is guarded — module top level only defines/exports).
- Units: **feet and seconds** in all world/physics code.
- **No RNG in the simulation core.** `Math.random()` is allowed only for cosmetic browser effects (particles, shake) and WebAudio noise buffers.
- localStorage key: **`cc-shootout-v1`** (schema in spec). Never let a parse failure throw.
- Version bumps (exact): `sw.js` `VERSION` `'v3'` → `'v4'`; `styles.css?v=6` → `styles.css?v=7` in `index.html` and in `sw.js` `SHELL`; add `'/shootout.js?v=1'` to `SHELL`; `app.js?v=5` stays.
- No official WNBA/Fever marks in the game scene — the center-court roundel is an original stylized "CC".
- Reuse existing CSS custom properties (`--gold`, `--arena-deep`, `--banner-edge`, `--font-display`, `--font-label`, `--font-mono`, …) and loaded Google Fonts (Graduate, Saira Condensed, Red Hat Mono).
- Tests run with: `node --test tests/shootout.test.mjs` (full suite: `node --test tests/`).
- Working dir contains a space (`CC Tracker`) — quote paths in shell commands.

## File Structure

- `shootout.js` (create) — everything game: pure core (top, exported) + renderer/shell (inside `initShootout()`).
- `tests/shootout.test.mjs` (create) — pure-core tests.
- `index.html` (modify) — launch card in Clark section, overlay markup, script tag, `styles.css?v=7`.
- `styles.css` (modify) — one appended `/* Logo 3 Challenge */` block.
- `sw.js` (modify) — `VERSION` + `SHELL`.
- `README.md` (modify) — feature blurb.

---

### Task 1: Pure physics core

**Files:**
- Create: `shootout.js`
- Test: `tests/shootout.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (exported from `shootout.js`, used by every later task):
  - Constants: `G`, `BALL_R`, `RIM_Y`, `RIM_R`, `RIM_TUBE`, `BOARD_Z`, `BOARD_HALF_W`, `BOARD_BOTTOM`, `BOARD_TOP`, `DRAG`, `REST_RIM`, `REST_BOARD`, `REST_FLOOR`, `RELEASE_Y`, `HELD_Y`, `DT`
  - `newBall(spot: {x, z}) → ball` where ball = `{p:{x,y,z}, v:{x,y,z}, t, live, done, made, swish, contacts:{rim, board, floor}}`
  - `stepBall(ball, dt = DT) → ball` (mutates; no-op unless `live && !done`)
  - `collideRim(ball) → bool`, `collideBoard(ball) → bool`
  - `launchSpeedFor(dist: ft, angleDeg) → ft/s` (speed that swishes at that distance/angle, drag included)

- [ ] **Step 1: Write the failing tests**

Create `tests/shootout.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newBall, stepBall, collideRim, collideBoard, launchSpeedFor,
  RELEASE_Y, RIM_Y, RIM_R, BALL_R, RIM_TUBE, REST_RIM, BOARD_Z, DT,
} from '../shootout.js';

// launch a ball from `dist` ft straight at the hoop and settle it
function shoot(dist, speed, angleDeg, lateralDeg = 0) {
  const th = (angleDeg * Math.PI) / 180, ph = (lateralDeg * Math.PI) / 180;
  const b = newBall({ x: 0, z: -dist });
  b.p.y = RELEASE_Y;
  b.v = {
    x: speed * Math.cos(th) * Math.sin(ph),
    y: speed * Math.sin(th),
    z: speed * Math.cos(th) * Math.cos(ph),
  };
  b.live = true;
  for (let i = 0; i < 6 / DT && !b.done; i++) stepBall(b, DT);
  return b;
}

test('tuned launch speed swishes from 22 ft', () => {
  const b = shoot(22, launchSpeedFor(22, 48), 48);
  assert.equal(b.made, true);
  assert.equal(b.swish, true);
});

test('15% weak from 22 ft comes up short', () => {
  const b = shoot(22, launchSpeedFor(22, 48) * 0.85, 48);
  assert.equal(b.made, false);
  assert.equal(b.done, true);
});

test('logo range needs more speed than the arc', () => {
  assert.ok(launchSpeedFor(30.5, 47) > launchSpeedFor(22, 48));
});

test('wide-right shot misses', () => {
  const b = shoot(22, launchSpeedFor(22, 48), 48, 6); // ~2.3 ft off-line at the rim
  assert.equal(b.made, false);
});

test('rim collision reflects with restitution and counts a contact', () => {
  const b = newBall({ x: 0, z: -22 });
  b.live = true;
  // ball just short of the front tube point (0, RIM_Y, -RIM_R), moving +z into it
  b.p = { x: 0, y: RIM_Y, z: -RIM_R - (BALL_R + RIM_TUBE - 0.01) };
  b.v = { x: 0, y: 0, z: 10 };
  assert.equal(collideRim(b), true);
  assert.equal(b.contacts.rim, 1);
  assert.ok(b.v.z < 0, 'reflected');
  assert.ok(Math.abs(b.v.z) <= 10 * REST_RIM, 'damped');
  const rp = { x: 0, y: RIM_Y, z: -RIM_R };
  const d = Math.hypot(b.p.x - rp.x, b.p.y - rp.y, b.p.z - rp.z);
  assert.ok(d >= BALL_R + RIM_TUBE - 1e-9, 'pushed out of the tube');
});

test('backboard bank reflects z with restitution', () => {
  const b = newBall({ x: 0, z: -22 });
  b.live = true;
  b.p = { x: 0, y: 11, z: BOARD_Z - BALL_R + 0.02 };
  b.v = { x: 0, y: -2, z: 12 };
  assert.equal(collideBoard(b), true);
  assert.equal(b.contacts.board, 1);
  assert.ok(b.v.z < 0);
});

test('make after rim contact is not a swish', () => {
  const b = newBall({ x: 0, z: -22 });
  b.live = true;
  b.p = { x: 0, y: RIM_Y + 0.05, z: 0 };
  b.v = { x: 0, y: -8, z: 0 };
  b.contacts.rim = 1;
  stepBall(b, DT);
  assert.equal(b.made, true);
  assert.equal(b.swish, false);
});

test('upward crossing through the ring is not a make', () => {
  const b = newBall({ x: 0, z: -22 });
  b.live = true;
  b.p = { x: 0, y: RIM_Y - 0.2, z: 0 };
  b.v = { x: 0, y: 12, z: 0 };
  stepBall(b, DT);
  assert.equal(b.made, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/shootout.test.mjs`
Expected: FAIL — cannot find module `../shootout.js`.

- [ ] **Step 3: Implement the physics core**

Create `shootout.js`:

```js
/* Logo 3 Challenge — flick-to-shoot logo-three mini-game.
   Pure sim core (exported, node-testable) + canvas renderer + DOM shell.
   World units: feet, seconds. x lateral (+right), y up, z depth (+toward board).
   Rim ring center is the world origin at height RIM_Y. No RNG in the sim. */

export const G = 32.17;                 // ft/s²
export const BALL_R = 0.378;            // 28.5" circumference ball
export const RIM_Y = 10;
export const RIM_R = 0.75;              // 18" ring
export const RIM_TUBE = 0.05;
export const BOARD_Z = 1.25;            // ring center → board face (15")
export const BOARD_HALF_W = 3;
export const BOARD_BOTTOM = 9.5;
export const BOARD_TOP = 13;
export const DRAG = 0.0087;             // quadratic air drag, 1/ft
export const REST_RIM = 0.55;
export const REST_BOARD = 0.5;
export const REST_FLOOR = 0.6;
export const RELEASE_Y = 6.5;
export const HELD_Y = 4.2;
export const DT = 1 / 120;

export function newBall(spot) {
  return {
    p: { x: spot.x, y: HELD_Y, z: spot.z },
    v: { x: 0, y: 0, z: 0 },
    t: 0, live: false, done: false, made: false, swish: false,
    contacts: { rim: 0, board: 0, floor: 0 },
  };
}

function integrate(p, v, dt) {
  const q = DRAG * Math.hypot(v.x, v.y, v.z) * dt;
  v.x -= v.x * q;
  v.y -= v.y * q + G * dt;
  v.z -= v.z * q;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
}

export function collideRim(b) {
  const hr = Math.hypot(b.p.x, b.p.z);
  if (hr < 1e-9) return false;
  const rx = (b.p.x / hr) * RIM_R, rz = (b.p.z / hr) * RIM_R; // nearest ring point
  const dx = b.p.x - rx, dy = b.p.y - RIM_Y, dz = b.p.z - rz;
  const d = Math.hypot(dx, dy, dz), min = BALL_R + RIM_TUBE;
  if (d >= min || d < 1e-9) return false;
  const nx = dx / d, ny = dy / d, nz = dz / d;
  b.p.x = rx + nx * min; b.p.y = RIM_Y + ny * min; b.p.z = rz + nz * min;
  const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
  if (vn < 0) {
    b.v.x -= (1 + REST_RIM) * vn * nx;
    b.v.y -= (1 + REST_RIM) * vn * ny;
    b.v.z -= (1 + REST_RIM) * vn * nz;
    b.v.x *= 0.98; b.v.y *= 0.98; b.v.z *= 0.98;
  }
  b.contacts.rim += 1;
  return true;
}

export function collideBoard(b) {
  if (b.v.z <= 0) return false;
  if (b.p.z + BALL_R < BOARD_Z || b.p.z - BALL_R > BOARD_Z + 0.5) return false;
  if (Math.abs(b.p.x) > BOARD_HALF_W || b.p.y < BOARD_BOTTOM || b.p.y > BOARD_TOP) return false;
  b.p.z = BOARD_Z - BALL_R;
  b.v.z = -b.v.z * REST_BOARD;
  b.contacts.board += 1;
  return true;
}

function collideFloor(b) {
  if (b.p.y - BALL_R > 0 || b.v.y >= 0) return false;
  b.p.y = BALL_R;
  b.v.y = -b.v.y * REST_FLOOR;
  b.v.x *= 0.8; b.v.z *= 0.8;
  b.contacts.floor += 1;
  return true;
}

export function stepBall(b, dt = DT) {
  if (!b.live || b.done) return b;
  const prev = { x: b.p.x, y: b.p.y, z: b.p.z };
  integrate(b.p, b.v, dt);
  collideRim(b);
  collideBoard(b);
  collideFloor(b);
  b.t += dt;
  if (!b.made && b.p.y < RIM_Y && prev.y >= RIM_Y) {
    const k = (prev.y - RIM_Y) / (prev.y - b.p.y);
    const xc = prev.x + (b.p.x - prev.x) * k;
    const zc = prev.z + (b.p.z - prev.z) * k;
    if (Math.hypot(xc, zc) < RIM_R - 0.02) {
      b.made = true;
      b.swish = !b.contacts.rim && !b.contacts.board;
    }
  }
  if ((b.made && b.p.y < RIM_Y - 2.4) ||
      b.contacts.floor >= 3 ||
      (b.contacts.floor > 0 && Math.hypot(b.v.x, b.v.y, b.v.z) < 5) ||
      b.t > 6) b.done = true;
  return b;
}

/* Launch speed that lands a shot dead-center from `dist` at `angleDeg`,
   solved against the dragful flight itself so tuning always matches physics. */
export function launchSpeedFor(dist, angleDeg) {
  const th = (angleDeg * Math.PI) / 180;
  let lo = 15, hi = 60;
  for (let i = 0; i < 36; i++) {
    const v = (lo + hi) / 2;
    if (flightError(dist, v, th) > 0) hi = v; else lo = v;
  }
  return (lo + hi) / 2;
}

function flightError(dist, v, th) {
  const p = { x: 0, y: RELEASE_Y, z: -dist };
  const vel = { x: 0, y: v * Math.sin(th), z: v * Math.cos(th) };
  for (let t = 0; t < 4; t += DT) {
    const prevY = p.y, prevZ = p.z;
    integrate(p, vel, DT);
    if (vel.y < 0 && prevY >= RIM_Y && p.y < RIM_Y) {
      const k = (prevY - RIM_Y) / (prevY - p.y);
      return prevZ + (p.z - prevZ) * k;   // crossing z: 0 = ring center, + = long
    }
  }
  return -dist; // never got there: way short
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/shootout.test.mjs`
Expected: 8 pass. If the swish test fails, log `flightError(22, launchSpeedFor(22, 48), 48 * Math.PI / 180)` — it must be ~0; the crossing radius margin in `stepBall` (`RIM_R - 0.02`) is the only tolerance.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js tests/shootout.test.mjs
git commit -m "Add Logo 3 Challenge physics core: 3D ball flight, rim/board/floor collisions, make detection"
```

---

### Task 2: Rounds, spots, and flick mapping

**Files:**
- Modify: `shootout.js` (append after physics core)
- Test: `tests/shootout.test.mjs` (append)

**Interfaces:**
- Consumes: `launchSpeedFor`, `RELEASE_Y` (Task 1).
- Produces (exported):
  - `BALLS_PER_ROUND = 5`
  - `ROUNDS: [{name, dist, value, spots: number[5] /* bearing degrees */}]` — `[{The Arc, 22, 100}, {Deep, 26, 200}, {The Logo, 30.5, 300}]`
  - `AIM_MAX` (radians, 14°)
  - `spotPosition(round: 0-2, ball: 0-4) → {x, z}` (shooter floor position; z negative)
  - `flickToLaunch(trail: [{x, y, t /* css px, ms */}], opts: {h: cssHeight, spot: {x, z}, dist}) → {p: {x,y,z}, v: {x,y,z}, power: 0-1} | null`

- [ ] **Step 1: Append failing tests**

Append to `tests/shootout.test.mjs`:

```js
import { ROUNDS, BALLS_PER_ROUND, AIM_MAX, spotPosition, flickToLaunch } from '../shootout.js';

const upFlick = (px, ms) => [{ x: 200, y: 600, t: 1000 }, { x: 200, y: 600 - px, t: 1000 + ms }];

test('rounds ladder: 22/26/30.5 ft at 100/200/300, five spots each', () => {
  assert.equal(ROUNDS.length, 3);
  assert.deepEqual(ROUNDS.map((r) => r.dist), [22, 26, 30.5]);
  assert.deepEqual(ROUNDS.map((r) => r.value), [100, 200, 300]);
  for (const r of ROUNDS) assert.equal(r.spots.length, BALLS_PER_ROUND);
  const top = spotPosition(0, 2);
  assert.ok(Math.abs(top.x) < 1e-9 && Math.abs(top.z + 22) < 1e-9);
});

test('straight flick from the top launches dead ahead', () => {
  const l = flickToLaunch(upFlick(300, 80), { h: 700, spot: spotPosition(0, 2), dist: 22 });
  assert.ok(l);
  assert.ok(l.v.z > 0 && l.v.y > 0);
  assert.ok(Math.abs(l.v.x) < 1e-9);
  assert.equal(l.p.y, RELEASE_Y);
});

test('corner spot: straight flick aims at the hoop', () => {
  const spot = spotPosition(0, 0);
  const l = flickToLaunch(upFlick(300, 80), { h: 700, spot, dist: 22 });
  const dot = (l.v.x * -spot.x + l.v.z * -spot.z) /
    (Math.hypot(l.v.x, l.v.z) * Math.hypot(spot.x, spot.z));
  assert.ok(dot > 0.9999, 'horizontal velocity points from spot to rim');
});

test('harder flick flies faster, capped at 1.22× the needed speed', () => {
  const o = { h: 700, spot: spotPosition(0, 2), dist: 22 };
  const speed = (l) => Math.hypot(l.v.x, l.v.y, l.v.z);
  const soft = flickToLaunch(upFlick(180, 100), o);
  const hard = flickToLaunch(upFlick(500, 60), o);
  assert.ok(speed(hard) > speed(soft));
  const max = flickToLaunch(upFlick(3000, 30), o);
  assert.ok(speed(max) <= 1.22 * launchSpeedFor(22, 44) + 1e-6);
});

test('sideways gesture steers, clamped to ±14°', () => {
  const t = [{ x: 200, y: 600, t: 0 }, { x: 500, y: 300, t: 80 }]; // 45° up-right
  const l = flickToLaunch(t, { h: 700, spot: spotPosition(0, 2), dist: 22 });
  assert.ok(Math.abs(Math.atan2(l.v.x, l.v.z) - AIM_MAX) < 1e-6);
});

test('downward or feeble gestures do not shoot', () => {
  const o = { h: 700, spot: spotPosition(0, 2), dist: 22 };
  assert.equal(flickToLaunch([{ x: 0, y: 0, t: 0 }, { x: 0, y: 80, t: 80 }], o), null);
  assert.equal(flickToLaunch([{ x: 0, y: 0, t: 0 }, { x: 0, y: -4, t: 80 }], o), null);
  assert.equal(flickToLaunch([{ x: 0, y: 0, t: 0 }], o), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/shootout.test.mjs`
Expected: Task-1 tests pass; new tests fail (`ROUNDS` not exported).

- [ ] **Step 3: Implement rounds + flick mapping**

Append to `shootout.js` after the physics section:

```js
/* ------------------------------------------------------- rounds & aiming */
export const BALLS_PER_ROUND = 5;
export const ROUNDS = [
  { name: 'The Arc',  dist: 22,   value: 100, spots: [-55, -28, 0, 28, 55] },
  { name: 'Deep',     dist: 26,   value: 200, spots: [-45, -22, 0, 22, 45] },
  { name: 'The Logo', dist: 30.5, value: 300, spots: [0, 0, 0, 0, 0] },
];
export const AIM_MAX = (14 * Math.PI) / 180;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function spotPosition(round, ball) {
  const r = ROUNDS[round];
  const a = (r.spots[ball] * Math.PI) / 180;
  return { x: Math.sin(a) * r.dist, z: -Math.cos(a) * r.dist };
}

/* Gesture → launch. Uses the last ≤100 ms of the pointer trail.
   Normalized flick speed n is in canvas-heights/second so devices agree.
   n ∈ [0.8, 3.2] maps to power 0.72–1.22 × the exact speed the distance
   needs; a flick of n ≈ 2.1 is money. Hard flicks fly flatter (50° → 44°). */
export function flickToLaunch(trail, opts) {
  if (!trail || trail.length < 2) return null;
  const end = trail[trail.length - 1];
  let i = trail.length - 1;
  while (i > 0 && end.t - trail[i - 1].t <= 100) i--;
  const s0 = trail[i];
  const dx = end.x - s0.x, dy = end.y - s0.y, dts = (end.t - s0.t) / 1000;
  if (dts <= 0 || dy > -8) return null;                 // must move up
  const n = Math.hypot(dx, dy) / opts.h / dts;
  if (n < 0.35) return null;                            // too feeble
  const pn = clamp((n - 0.8) / (3.2 - 0.8), 0, 1);
  const power = 0.72 + pn * 0.5;
  const angle = 50 - 6 * pn;
  const speed = power * launchSpeedFor(opts.dist, angle);
  const phi = clamp(Math.atan2(dx, -dy), -AIM_MAX, AIM_MAX);
  const beta = Math.atan2(-opts.spot.x, -opts.spot.z);  // bearing spot → rim
  const th = (angle * Math.PI) / 180, dir = beta + phi;
  return {
    p: { x: opts.spot.x, y: RELEASE_Y, z: opts.spot.z },
    v: {
      x: speed * Math.cos(th) * Math.sin(dir),
      y: speed * Math.sin(th),
      z: speed * Math.cos(th) * Math.cos(dir),
    },
    power: pn,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/shootout.test.mjs`
Expected: all pass (14).

- [ ] **Step 5: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js tests/shootout.test.mjs
git commit -m "Add shootout rounds, shot spots, and flick-to-launch gesture mapping"
```

---

### Task 3: Game state machine and persistent store

**Files:**
- Modify: `shootout.js` (append)
- Test: `tests/shootout.test.mjs` (append)

**Interfaces:**
- Consumes: `ROUNDS`, `BALLS_PER_ROUND` (Task 2).
- Produces (exported):
  - `newGame() → g` where g = `{round, ball, score, makes, swishes, streak, longest, fire, over}`
  - `recordShot(g, made: bool, swish: bool) → {points, roundUp, over}` (mutates g; advances ball/round)
  - `STORE_KEY = 'cc-shootout-v1'`
  - `emptyStore() → {bests: [], career: {games, makes, swishes, points}, muted: false}`
  - `parseStore(raw: string|null) → store` (never throws)
  - `updateBests(store, entry: {score, makes, streak, swishes, date}) → {store, isBest}` (pure — returns new store)

- [ ] **Step 1: Append failing tests**

Append to `tests/shootout.test.mjs`:

```js
import { newGame, recordShot, parseStore, emptyStore, updateBests, STORE_KEY } from '../shootout.js';

test('scoring: base values, swish +50%, on fire doubles from the igniting make', () => {
  const g = newGame();
  assert.equal(recordShot(g, true, false).points, 100);
  assert.equal(recordShot(g, true, true).points, 150);   // swish
  const third = recordShot(g, true, false);              // 3rd straight ignites
  assert.equal(g.fire, true);
  assert.equal(third.points, 200);                       // 100 × 2
  assert.equal(recordShot(g, true, true).points, 300);   // 100 × 1.5 × 2
  const fifth = recordShot(g, false, false);
  assert.equal(g.fire, false);
  assert.equal(g.streak, 0);
  assert.equal(fifth.roundUp, true);
  assert.equal(g.round, 1);
  assert.equal(g.score, 750);
  assert.equal(g.longest, 4);
});

test('streak carries across rounds; logo swish on fire = 900', () => {
  const g = newGame();
  for (let i = 0; i < 10; i++) recordShot(g, true, false);
  assert.equal(g.round, 2);
  assert.equal(g.fire, true);
  assert.equal(recordShot(g, true, true).points, 900);   // 300 × 1.5 × 2
});

test('game ends after 15 balls', () => {
  const g = newGame();
  for (let i = 0; i < 14; i++) assert.equal(recordShot(g, false, false).over, false);
  const last = recordShot(g, true, false);
  assert.equal(last.over, true);
  assert.equal(g.over, true);
  assert.equal(g.makes, 1);
});

test('parseStore survives garbage and fills missing fields', () => {
  assert.equal(STORE_KEY, 'cc-shootout-v1');
  assert.deepEqual(parseStore(null), emptyStore());
  assert.deepEqual(parseStore('not json'), emptyStore());
  assert.deepEqual(parseStore('{"bests":"x"}'), emptyStore());
  const s = parseStore('{"bests":[{"score":10}],"career":{"games":2}}');
  assert.equal(s.career.games, 2);
  assert.equal(s.career.makes, 0);
  assert.equal(s.muted, false);
});

test('updateBests sorts, caps at 10, ties are not new bests, career accumulates', () => {
  const e = (score) => ({ score, makes: 4, streak: 2, swishes: 1, date: '2026-07-26' });
  let r = updateBests(emptyStore(), e(500));
  assert.equal(r.isBest, true);
  r = updateBests(r.store, e(500));
  assert.equal(r.isBest, false);                         // tie keeps the older entry on top
  for (let i = 1; i <= 12; i++) r = updateBests(r.store, e(i));
  assert.equal(r.store.bests.length, 10);
  assert.equal(r.store.bests[0].score, 500);
  assert.equal(r.store.career.games, 14);
  assert.equal(r.store.career.makes, 14 * 4);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/shootout.test.mjs`
Expected: earlier tests pass; new fail (`newGame` not exported).

- [ ] **Step 3: Implement state machine + store**

Append to `shootout.js`:

```js
/* ------------------------------------------------------ scoring & store */
export function newGame() {
  return { round: 0, ball: 0, score: 0, makes: 0, swishes: 0, streak: 0, longest: 0, fire: false, over: false };
}

export function recordShot(g, made, swish) {
  let points = 0;
  if (made) {
    g.streak += 1;
    g.makes += 1;
    if (swish) g.swishes += 1;
    if (g.streak > g.longest) g.longest = g.streak;
    g.fire = g.streak >= 3;
    points = ROUNDS[g.round].value * (swish ? 1.5 : 1) * (g.fire ? 2 : 1);
    g.score += points;
  } else {
    g.streak = 0;
    g.fire = false;
  }
  g.ball += 1;
  let roundUp = false;
  if (g.ball >= BALLS_PER_ROUND) {
    g.ball = 0;
    if (g.round + 1 >= ROUNDS.length) g.over = true;
    else { g.round += 1; roundUp = true; }
  }
  return { points, roundUp, over: g.over };
}

export const STORE_KEY = 'cc-shootout-v1';

export function emptyStore() {
  return { bests: [], career: { games: 0, makes: 0, swishes: 0, points: 0 }, muted: false };
}

export function parseStore(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.bests) || typeof s.career !== 'object' || !s.career) return emptyStore();
    return { ...emptyStore(), ...s, career: { ...emptyStore().career, ...s.career } };
  } catch {
    return emptyStore();
  }
}

export function updateBests(store, entry) {
  const bests = [...store.bests, entry].sort((a, b) => b.score - a.score).slice(0, 10);
  const c = store.career;
  return {
    store: {
      ...store,
      bests,
      career: {
        games: c.games + 1,
        makes: c.makes + entry.makes,
        swishes: c.swishes + entry.swishes,
        points: c.points + entry.score,
      },
    },
    isBest: bests[0] === entry,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/`
Expected: all shootout tests pass and the existing `poll.test.mjs` suite still passes.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js tests/shootout.test.mjs
git commit -m "Add shootout scoring state machine and personal-best store logic"
```

---

### Task 4: Card, overlay shell, styles, service-worker bump

**Files:**
- Modify: `index.html` (card in Clark section, overlay before scripts, module script tag, `styles.css?v=7`)
- Modify: `styles.css` (append block)
- Modify: `sw.js` (`VERSION`, `SHELL`)
- Modify: `shootout.js` (append DOM shell bootstrap)

**Interfaces:**
- Consumes: nothing from the pure core yet.
- Produces (module-internal, inside `initShootout()` — later tasks add code INSIDE this function and rely on these): DOM refs `overlay`, `canvas`, `ctx`, `ui`, `card`, `playBtn`, `closeBtn`, `muteBtn`, `bestEl`; `view = {w, h}`; functions `sizeCanvas()`, `openGame()`, `closeGame()`. Element ids: `#shootout`, `#shootout-canvas`, `#shootout-ui`, `#shootout-close`, `#shootout-mute`, `#shootout-card`, `#shootout-play`, `#shootout-best`.

- [ ] **Step 1: Add the launch card to `index.html`**

In the Clark section, directly after the closing `</div>` of the shot-chart `banner chart-banner` block (the div containing `#shotchart-tip`, currently line 119) and before `<div class="ledger" id="clark-ledger">`, insert:

```html
      <div class="banner shootout-card" id="shootout-card">
        <div>
          <h4 class="chart-title">Logo 3 Challenge</h4>
          <p class="chart-sub">Flick it from way downtown — 15 balls, arc to logo.</p>
        </div>
        <div class="shootout-card-side">
          <span class="shootout-best" id="shootout-best">Not yet played</span>
          <button class="shootout-play" id="shootout-play">Play</button>
        </div>
      </div>
```

- [ ] **Step 2: Add the overlay + script tag to `index.html`**

Immediately before `<script src="app.js?v=5"></script>`, insert:

```html
  <div class="shootout-overlay" id="shootout" hidden>
    <canvas id="shootout-canvas" role="img" aria-label="Logo 3 Challenge shooting game"></canvas>
    <div class="shootout-ui" id="shootout-ui"></div>
    <button class="shootout-mute" id="shootout-mute" aria-label="Toggle sound" aria-pressed="false">🔊</button>
    <button class="shootout-close" id="shootout-close" aria-label="Close game">✕</button>
  </div>
```

After the `app.js` script tag add:

```html
  <script type="module" src="shootout.js?v=1"></script>
```

And in `<head>` change `styles.css?v=6` → `styles.css?v=7`.

- [ ] **Step 3: Append styles to `styles.css`**

```css
/* ============================================================
   LOGO 3 CHALLENGE
   ============================================================ */
.shootout-card { display: flex; align-items: center; justify-content: space-between; gap: 1rem; cursor: pointer; }
.shootout-card .chart-sub { margin: 0.15rem 0 0; }
.shootout-card-side { display: flex; align-items: center; gap: 0.8rem; flex-shrink: 0; }
.shootout-best { font-family: var(--font-mono); color: var(--gold); font-size: 0.85rem; white-space: nowrap; }
.shootout-play {
  font-family: var(--font-label); text-transform: uppercase; letter-spacing: 0.08em;
  font-size: 0.95rem; padding: 0.5rem 1.15rem; border-radius: 999px; cursor: pointer;
  color: oklch(0.2 0.05 262); background: var(--gold);
  border: 1px solid var(--gold-deep); box-shadow: 0 2px 0 var(--gold-shadow);
}
.shootout-play:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--gold-shadow); }
.shootout-ghost { background: transparent; color: var(--chalk-dim); border-color: var(--arena-line); box-shadow: none; margin-left: 0.5rem; }

.shootout-overlay { position: fixed; inset: 0; z-index: 80; background: var(--arena-deep); display: flex; justify-content: center; overscroll-behavior: none; }
.shootout-overlay[hidden] { display: none; }
#shootout-canvas { display: block; touch-action: none; }
.shootout-lock, .shootout-lock body { overflow: hidden; }

.shootout-close, .shootout-mute {
  position: absolute; top: calc(0.6rem + env(safe-area-inset-top)); width: 44px; height: 44px;
  border-radius: 50%; background: oklch(0.25 0.05 262 / 0.85); color: var(--chalk);
  border: 1px solid var(--arena-line); font-size: 1.05rem; z-index: 2; cursor: pointer;
}
.shootout-close { right: 0.7rem; }
.shootout-mute { left: 0.7rem; }

.shootout-ui { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 1; }
.shootout-ui .panel {
  pointer-events: auto; text-align: center; width: min(88vw, 380px);
  background: oklch(0.22 0.05 262 / 0.94); border: 1px solid var(--banner-edge);
  border-radius: 14px; padding: 1.4rem 1.6rem; box-shadow: 0 18px 50px oklch(0 0 0 / 0.45);
}
.shootout-ui h3 { font-family: var(--font-display); color: var(--gold); font-size: 1.35rem; letter-spacing: 0.04em; margin: 0 0 0.4rem; }
.shootout-ui p { color: var(--chalk-dim); margin: 0.3rem 0; font-size: 0.95rem; }
.shootout-ui .panel .shootout-play { margin-top: 0.9rem; }
.shootout-stats { display: flex; justify-content: center; gap: 1.2rem; margin-top: 0.6rem; font-family: var(--font-mono); font-size: 0.88rem; color: var(--chalk); }
.shootout-bests { list-style: none; margin: 0.8rem 0 0; padding: 0; font-family: var(--font-mono); font-size: 0.85rem; color: var(--chalk-dim); }
.shootout-bests li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.15rem 0; }
.shootout-bests .you { color: var(--gold); }
.shootout-newbest { font-family: var(--font-display); color: var(--gold); font-size: 1rem; animation: shootout-pop 0.5s var(--ease); }
@keyframes shootout-pop { from { transform: scale(0.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .shootout-newbest { animation: none; } }
```

- [ ] **Step 4: Bump the service worker**

In `sw.js` change:

```js
const VERSION = 'v4';
```

and:

```js
const SHELL = ['/', '/styles.css?v=7', '/app.js?v=5', '/shootout.js?v=1', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/badge-96.png'];
```

- [ ] **Step 5: Append the DOM shell bootstrap to `shootout.js`**

```js
/* ------------------------------------------------ DOM shell (browser only) */
if (typeof document !== 'undefined') initShootout();

function initShootout() {
  const card = document.getElementById('shootout-card');
  const playBtn = document.getElementById('shootout-play');
  const overlay = document.getElementById('shootout');
  if (!card || !playBtn || !overlay) return;
  const canvas = document.getElementById('shootout-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) { card.hidden = true; return; }
  const ui = document.getElementById('shootout-ui');
  const closeBtn = document.getElementById('shootout-close');
  const muteBtn = document.getElementById('shootout-mute');
  const bestEl = document.getElementById('shootout-best');

  const view = { w: 0, h: 0 };
  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = Math.min(overlay.clientWidth, 560);
    view.h = overlay.clientHeight;
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let lastFocus = null;
  function openGame() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('shootout-lock');
    sizeCanvas();
    ctx.fillStyle = '#0b1526';           // placeholder paint until Task 5's loop
    ctx.fillRect(0, 0, view.w, view.h);
    closeBtn.focus();
  }
  function closeGame() {
    overlay.hidden = true;
    document.documentElement.classList.remove('shootout-lock');
    (lastFocus && lastFocus.focus) ? lastFocus.focus() : playBtn.focus();
  }

  playBtn.addEventListener('click', openGame);
  card.addEventListener('click', (e) => { if (e.target !== playBtn) openGame(); });
  closeBtn.addEventListener('click', closeGame);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeGame(); });
  window.addEventListener('resize', () => { if (!overlay.hidden) sizeCanvas(); });
}
```

- [ ] **Step 6: Verify**

1. `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/` — still all green (module import must not touch the DOM at top level).
2. `node -e "import('./shootout.js').then((m) => console.log('exports:', Object.keys(m).length))"` — prints a count, no crash.
3. Serve (`python3 -m http.server 8000`) and check in a browser (Playwright MCP tools work headless): card renders under the shot chart, clicking it opens a navy full-screen overlay, ✕ and Escape close it, page scroll is locked while open, no console errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add index.html styles.css sw.js shootout.js
git commit -m "Add Logo 3 Challenge card, full-screen overlay shell, styles, and SW cache bump"
```

---

### Task 5: Perspective renderer and game loop

**Files:**
- Modify: `shootout.js` (inside `initShootout()`, replacing the placeholder paint)

**Interfaces:**
- Consumes: Task 4 shell refs (`overlay`, `canvas`, `ctx`, `ui`, `view`, `sizeCanvas`, `openGame`, `closeGame`); pure core (`spotPosition`, `newBall`, `RIM_Y`, `RIM_R`, `BALL_R`, `DT`).
- Produces (inside `initShootout()`, used by Tasks 6–8):
  - `makeCamera(spot) → cam`, `project(cam, x, y, z) → {x, y, s} | null`
  - `line3(cam, pts, close?)`, `arc3(cam, cx, cz, r, a0, a1, y?)`, `quad3(cam, pts, fill, stroke)`
  - `drawScene(cam)`, `drawRim(cam)`, `drawNet(cam)`, `drawBall(cam, ball, fire)`
  - `NET_S`, `NET_R`, `net = makeNet()` (node grid; static for now)
  - `startLoop()`, `stopLoop()`, `fail(err)`, `failed` flag; `tick(dt)` and `render()` (placeholder versions here, replaced in Task 6)
  - Temporary preview state: `previewSpot`, `previewCam`, `previewBall` (removed in Task 6)

- [ ] **Step 1: Add camera, projection, and drawing helpers**

Inside `initShootout()`, after `sizeCanvas`:

```js
  /* ---- camera & projection: pinhole, yawed to face the rim ---- */
  function makeCamera(spot) {
    const yaw = Math.atan2(-spot.x, -spot.z);
    return {
      yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
      x: spot.x - Math.sin(yaw) * 7, y: 5.6, z: spot.z - Math.cos(yaw) * 7,
    };
  }
  function project(cam, px, py, pz) {
    const dx = px - cam.x, dy = py - cam.y, dz = pz - cam.z;
    const cz = dz * cam.cos + dx * cam.sin;
    if (cz < 0.6) return null;
    const cx = dx * cam.cos - dz * cam.sin;
    const f = view.h * 1.15;
    return { x: view.w / 2 + (cx * f) / cz, y: view.h * 0.66 - (dy * f) / cz, s: f / cz };
  }
  function line3(cam, pts, close = false) {
    ctx.beginPath();
    let started = false;
    for (const [x, y, z] of pts) {
      const q = project(cam, x, y, z);
      if (!q) { started = false; continue; }
      if (started) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); started = true; }
    }
    if (close) ctx.closePath();
    ctx.stroke();
  }
  function arc3(cam, cx, cz, r, a0, a1, y = 0) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = a0 + ((a1 - a0) * i) / 48;
      pts.push([cx + Math.sin(a) * r, y, cz - Math.cos(a) * r]);
    }
    line3(cam, pts);
  }
  function quad3(cam, pts, fill, stroke) {
    const q = pts.map(([x, y, z]) => project(cam, x, y, z));
    if (q.some((p) => !p)) return;
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
```

- [ ] **Step 2: Add the scene painter**

```js
  function drawScene(cam) {
    const hor = view.h * 0.66;
    const sky = ctx.createLinearGradient(0, 0, 0, hor);
    sky.addColorStop(0, '#05080f');
    sky.addColorStop(1, '#101c33');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, hor);
    const fl = ctx.createLinearGradient(0, hor, 0, view.h);
    fl.addColorStop(0, '#3c2e1c');
    fl.addColorStop(1, '#7d6136');
    ctx.fillStyle = fl;
    ctx.fillRect(0, hor, view.w, view.h - hor);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(240,234,214,0.42)';
    line3(cam, [[-25, 0, 4], [25, 0, 4]]);                                  // baseline
    line3(cam, [[-25, 0, 4], [-25, 0, -42]]);                               // sidelines
    line3(cam, [[25, 0, 4], [25, 0, -42]]);
    line3(cam, [[-8, 0, 4], [-8, 0, -15], [8, 0, -15], [8, 0, 4]]);         // key
    arc3(cam, 0, -15, 6, -Math.PI / 2, Math.PI / 2);                        // FT circle (front half)
    ctx.strokeStyle = 'rgba(240,234,214,0.55)';
    arc3(cam, 0, 0, 22.15, -1.35, 1.35);                                    // 3-pt arc

    // center-court "CC" roundel (original mark) at the logo shooting spot
    ctx.strokeStyle = 'rgba(238,199,63,0.85)';
    ctx.lineWidth = 3;
    arc3(cam, 0, -30.5, 3, -Math.PI, Math.PI, 0.02);
    const lq = project(cam, 0, 0.02, -30.5);
    if (lq) {
      ctx.fillStyle = 'rgba(238,199,63,0.8)';
      ctx.font = `${Math.max(8, 2.2 * lq.s)}px Graduate, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CC', lq.x, lq.y);
    }

    // stanchion + backboard + shooter square
    ctx.strokeStyle = 'rgba(140,150,170,0.7)';
    ctx.lineWidth = 4;
    line3(cam, [[0, 0, 6.5], [0, 9.4, 6.5], [0, 9.4, 1.4]]);
    quad3(cam, [[-3, 9.5, 1.3], [3, 9.5, 1.3], [3, 13, 1.3], [-3, 13, 1.3]],
      'rgba(228,236,248,0.14)', 'rgba(228,236,248,0.75)');
    quad3(cam, [[-1, 10, 1.28], [1, 10, 1.28], [1, 11.5, 1.28], [-1, 11.5, 1.28]],
      null, 'rgba(228,236,248,0.8)');
  }

  function drawRim(cam) {
    const q = project(cam, 0, RIM_Y, 0);
    if (!q) return;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * 2 * Math.PI;
      pts.push([Math.cos(a) * RIM_R, RIM_Y, Math.sin(a) * RIM_R]);
    }
    ctx.strokeStyle = '#e05a24';
    ctx.lineWidth = Math.max(2, q.s * RIM_TUBE * 2);
    line3(cam, pts, true);
  }
```

Note: `RIM_TUBE` is module-scope (exported constant) so it is in scope here.

- [ ] **Step 3: Add the net grid (static) and ball painter**

```js
  const NET_S = 10, NET_R = 4;
  function makeNet() {
    const nodes = [];
    for (let r = 0; r < NET_R; r++) {
      const rad = RIM_R * (1 - r * 0.12), y = RIM_Y - r * 0.36;
      for (let s = 0; s < NET_S; s++) {
        const a = (s / NET_S) * 2 * Math.PI;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        nodes.push({ x, y, z, ox: x, oy: y, oz: z, px: x, py: y, pz: z, pin: r === 0 });
      }
    }
    const cons = [];
    const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (let r = 0; r < NET_R - 1; r++) for (let s = 0; s < NET_S; s++) {
      const i = r * NET_S + s;
      cons.push([i, i + NET_S, d3(nodes[i], nodes[i + NET_S])]);
      const j = (r + 1) * NET_S + ((s + 1) % NET_S);
      cons.push([i, j, d3(nodes[i], nodes[j])]);
    }
    return { nodes, cons };
  }
  const net = makeNet();

  function drawNet(cam) {
    const P = net.nodes.map((n) => project(cam, n.x, n.y, n.z));
    ctx.strokeStyle = 'rgba(240,240,240,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let r = 0; r < NET_R - 1; r++) for (let s = 0; s < NET_S; s++) {
      const a = P[r * NET_S + s];
      const b = P[(r + 1) * NET_S + s];
      const c = P[(r + 1) * NET_S + ((s + 1) % NET_S)];
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      if (a && c) { ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); }
    }
    ctx.stroke();
  }

  function drawBall(cam, b, fire) {
    const q = project(cam, b.p.x, b.p.y, b.p.z);
    if (!q) return;
    const r = Math.max(BALL_R * q.s, 3);
    const g = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.4, r * 0.2, q.x, q.y, r);
    g.addColorStop(0, fire ? '#ffb066' : '#e8853a');
    g.addColorStop(1, fire ? '#c33f10' : '#a34d16');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, 7);
    ctx.fill();
    const rot = b.rot || 0;
    ctx.strokeStyle = 'rgba(40,18,8,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 0.98, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 0.98, r * 0.35, rot, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 0.35, r * 0.98, rot, 0, 7); ctx.stroke();
  }
```

- [ ] **Step 4: Add the fixed-timestep loop, error trap, and preview state**

```js
  /* ---- loop: 120 Hz physics accumulator, rAF render, one-shot error trap ---- */
  let raf = 0, last = 0, acc = 0, failed = false;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!last) last = ts;
    const dt = Math.min((ts - last) / 1000, 0.1);
    last = ts;
    acc += dt;
    try {
      while (acc >= DT) { tick(DT); acc -= DT; }
      render();
    } catch (err) { fail(err); }
  }
  function startLoop() { if (!raf && !failed) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }
  function fail(err) {
    console.error('[shootout]', err);
    failed = true;
    stopLoop();
    ui.innerHTML = `<div class="panel"><h3>Something went wrong</h3>
      <p>The game hit an error. Close and reopen to try again.</p>
      <button class="shootout-play" id="shootout-errclose">Close</button></div>`;
    ui.querySelector('#shootout-errclose').onclick = closeGame;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (!overlay.hidden) startLoop();
  });

  // Preview-only state so the scene is visible; Task 6 replaces this with game state.
  const previewSpot = spotPosition(0, 2);
  const previewCam = makeCamera(previewSpot);
  const previewBall = newBall(previewSpot);
  function tick(dt) {}                                   // replaced in Task 6
  function render() {                                    // replaced in Task 6
    ctx.clearRect(0, 0, view.w, view.h);
    drawScene(previewCam);
    drawNet(previewCam);
    drawRim(previewCam);
    drawBall(previewCam, previewBall, false);
  }
```

In `openGame()` replace the placeholder fill (`ctx.fillStyle = '#0b1526'; ctx.fillRect(...)`) with `failed = false; startLoop();`, and add `stopLoop();` as the first line of `closeGame()`.

- [ ] **Step 5: Verify**

1. `node --test tests/` — green; `node -e "import('./shootout.js').then(() => console.log('ok'))"` — ok.
2. In the browser: opening the overlay shows the court from the top of the arc — wood floor, arc, gold CC roundel in the distance, backboard, orange rim ellipse with net, ball held low-center. Close/reopen works; backgrounding the tab stops the loop (check with the Performance monitor or a `console.log` in `frame` temporarily removed afterward).

- [ ] **Step 6: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js
git commit -m "Add shootout perspective renderer: court scene, rim, net grid, ball, fixed-timestep loop"
```

---

### Task 6: Gameplay — input, shot lifecycle, HUD, screens, persistence

**Files:**
- Modify: `shootout.js` (inside `initShootout()`; replaces Task 5's preview state, `tick`, `render`)

**Interfaces:**
- Consumes: everything above. Pure core: `flickToLaunch`, `spotPosition`, `newBall`, `stepBall`, `newGame`, `recordShot`, `updateBests`, `parseStore`, `emptyStore`, `STORE_KEY`, `ROUNDS`, `BALLS_PER_ROUND`, `RELEASE_Y`, `HELD_Y`, `RIM_Y`.
- Produces (inside `initShootout()`):
  - State `S = {mode, game, ball, spot, cam, wait, after, trail, dragging, fx: {msgs, parts, shake}, store, reduced}`
  - `setSpot(round, ball)`, `startGame()`, `resolveShot()`, `showStart()`, `showBetween(round)`, `endGame()`, `flash(text, color)`, `renderCardBest()`, `loadStore()`, `saveStore(store)`, `bestsHTML(bests, current)`
  - Stubs replaced in Task 7: `netTick(net, ball, dt)` (no-op), `kick(n)` (no-op), `burstAtRim()` (no-op), `flameTrail(ball)` (no-op), and in Task 8: `sfx` (no-op object)
  - Final `tick(dt)` / `render()` and pointer handlers.

- [ ] **Step 1: Replace preview state with game state and stubs**

Delete `previewSpot`, `previewCam`, `previewBall` and the placeholder `tick`/`render`. Add:

```js
  function loadStore() {
    try { return parseStore(localStorage.getItem(STORE_KEY)); } catch { return emptyStore(); }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
  }

  const S = {
    mode: 'idle',                 // idle | playing | between | over
    game: null, ball: null, spot: null, cam: null,
    wait: 0, after: null,         // countdown → callback
    trail: [], dragging: false,
    fx: { msgs: [], parts: [], shake: 0 },
    store: loadStore(),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  // Juice stubs — implemented in Task 7 (net/particles/shake) and Task 8 (sound).
  function netTick(netRef, ball, dt) {}
  function kick(n) {}
  function burstAtRim() {}
  function flameTrail(ball) {}
  const noop = () => {};
  let sfx = { bounce: noop, clank: noop, board: noop, swish: noop, score: noop, fire: noop, buzzer: noop };
```

- [ ] **Step 2: Add game flow (spots, screens, resolve, end)**

```js
  function setSpot(round, ballIdx) {
    S.spot = spotPosition(round, ballIdx);
    S.cam = makeCamera(S.spot);
    S.ball = newBall(S.spot);
    S.ball.pending = null;        // raise-animation clock (shell-only field)
    S.ball.storedV = null;
  }

  function startGame() {
    S.game = newGame();
    setSpot(0, 0);
    S.mode = 'playing';
    ui.innerHTML = '';
  }

  function flash(text, color) { S.fx.msgs.push({ text, color, t: 0 }); }

  function resolveShot() {
    const b = S.ball, wasFire = S.game.fire;
    const r = recordShot(S.game, b.made, b.swish);
    if (b.made) {
      flash(b.swish ? `SWISH! +${r.points}` : `+${r.points}`, b.swish ? '#ffd25e' : '#f0ead6');
      if (b.swish) sfx.swish();
      sfx.score();
      if (navigator.vibrate) navigator.vibrate(35);
      if (!wasFire && S.game.fire) {
        flash('ON FIRE · 2× POINTS', '#ff7a3c');
        sfx.fire();
        if (navigator.vibrate) navigator.vibrate([0, 40, 60, 40]);
      }
      burstAtRim();
    } else {
      flash('MISS', '#8fa2c8');
    }
    if (r.over) { S.wait = 0.9; S.after = endGame; }
    else if (r.roundUp) { S.wait = 0.9; S.after = () => showBetween(S.game.round); }
    else { S.wait = 0.65; S.after = () => setSpot(S.game.round, S.game.ball); }
  }

  function bestsHTML(bests, current) {
    if (!bests.length) return '';
    return '<ol class="shootout-bests">' + bests.slice(0, 5).map((b) =>
      `<li${b === current ? ' class="you"' : ''}><span>${b.score.toLocaleString()}</span>` +
      `<span>${b.makes}/15 · ${b.date}</span></li>`).join('') + '</ol>';
  }

  function showStart() {
    S.mode = 'idle';
    setSpot(0, 0);
    ui.innerHTML = `<div class="panel"><h3>Logo 3 Challenge</h3>
      <p>15 balls · 3 rounds · arc to logo.<br/>Flick up to shoot — swipe angle aims.</p>
      ${bestsHTML(S.store.bests, null)}
      <button class="shootout-play" id="shootout-start">Play</button></div>`;
    ui.querySelector('#shootout-start').onclick = startGame;
    ui.querySelector('#shootout-start').focus();
  }

  function showBetween(round) {
    S.mode = 'between';
    const r = ROUNDS[round];
    ui.innerHTML = `<div class="panel"><h3>Round ${round + 1} — ${r.name}</h3>
      <p>${r.dist} ft · ${r.value} points a make</p></div>`;
    S.wait = 1.5;
    S.after = () => { ui.innerHTML = ''; setSpot(round, 0); S.mode = 'playing'; };
  }

  function endGame() {
    S.mode = 'over';
    const g = S.game;
    const entry = { score: g.score, makes: g.makes, streak: g.longest, swishes: g.swishes, date: new Date().toISOString().slice(0, 10) };
    const { store, isBest } = updateBests(S.store, entry);
    S.store = store;
    saveStore(store);
    renderCardBest();
    sfx.buzzer();
    ui.innerHTML = `<div class="panel">
      ${isBest && g.score > 0 ? '<p class="shootout-newbest">NEW BEST!</p>' : ''}
      <h3>${g.score.toLocaleString()} PTS</h3>
      <div class="shootout-stats"><span>${g.makes}/15</span><span>streak ${g.longest}</span><span>${g.swishes} swish</span></div>
      ${bestsHTML(store.bests, entry)}
      <div><button class="shootout-play" id="shootout-again">Play again</button>
      <button class="shootout-play shootout-ghost" id="shootout-done">Close</button></div></div>`;
    ui.querySelector('#shootout-again').onclick = startGame;
    ui.querySelector('#shootout-done').onclick = closeGame;
    ui.querySelector('#shootout-again').focus();
  }

  function renderCardBest() {
    bestEl.textContent = S.store.bests[0] ? `Best: ${S.store.bests[0].score.toLocaleString()}` : 'Not yet played';
  }
  renderCardBest();
```

In `openGame()` add `showStart();` before `startLoop();` (so each open lands on the start screen), and in `closeGame()` add `ui.innerHTML = ''; S.mode = 'idle';` after `stopLoop();`.

- [ ] **Step 3: Add pointer input**

```js
  function sample(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (S.mode !== 'playing' || !S.ball || S.ball.live || S.ball.pending != null) return;
    const p = sample(e);
    if (p.y < view.h * 0.5) return;                      // grab zone: lower half
    canvas.setPointerCapture(e.pointerId);
    S.dragging = true;
    S.trail = [p];
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.dragging) return;
    S.trail.push(sample(e));
    if (S.trail.length > 24) S.trail.shift();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!S.dragging) return;
    S.dragging = false;
    S.trail.push(sample(e));
    const launch = flickToLaunch(S.trail, { h: view.h, spot: S.spot, dist: ROUNDS[S.game.round].dist });
    S.trail = [];
    if (!launch) return;
    S.ball.storedV = launch.v;
    S.ball.pending = 0;                                   // start the gather→release raise
  });
  canvas.addEventListener('pointercancel', () => { S.dragging = false; S.trail = []; });
```

- [ ] **Step 4: Final `tick` and `render` with HUD and floating text**

```js
  function tick(dt) {
    if (S.wait > 0) {
      S.wait -= dt;
      if (S.wait <= 0 && S.after) { const f = S.after; S.after = null; f(); }
    }
    const b = S.ball;
    if (b) {
      if (b.pending != null) {                            // 90 ms gather→release
        b.pending += dt;
        const k = Math.min(b.pending / 0.09, 1);
        b.p.y = HELD_Y + (RELEASE_Y - HELD_Y) * k;
        if (k === 1) { b.v = b.storedV; b.live = true; b.pending = null; }
      }
      if (b.live && !b.done) {
        const c0 = { rim: b.contacts.rim, board: b.contacts.board, floor: b.contacts.floor };
        stepBall(b, dt);
        b.rot = (b.rot || 0) + 7 * dt;
        if (b.contacts.rim > c0.rim) { sfx.clank(); kick(4); }
        if (b.contacts.board > c0.board) sfx.board();
        if (b.contacts.floor > c0.floor) sfx.bounce();
        if (S.game && S.game.fire) flameTrail(b);
        if (b.done && S.mode === 'playing') resolveShot();
      }
      netTick(net, b, dt);
    }
    S.fx.msgs = S.fx.msgs.filter((m) => (m.t += dt) < 1);
    for (const p of S.fx.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt; }
    S.fx.parts = S.fx.parts.filter((p) => p.life > 0);
    S.fx.shake = Math.max(0, S.fx.shake - 30 * dt);
  }

  function drawHUD() {
    const g = S.game;
    if (!g) return;
    const cx = view.w / 2, top = 14;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = "700 26px 'Red Hat Mono', monospace";
    ctx.fillStyle = '#eec73f';
    ctx.fillText(g.score.toLocaleString(), cx, top);
    if (S.mode === 'playing' || S.mode === 'between') {
      const r = ROUNDS[g.round];
      ctx.font = "600 15px 'Saira Condensed', sans-serif";
      ctx.fillStyle = 'rgba(238,231,210,0.85)';
      ctx.fillText(`${r.name.toUpperCase()} · ${r.dist} FT`, cx, top + 32);
      for (let i = 0; i < BALLS_PER_ROUND; i++) {
        ctx.beginPath();
        ctx.arc(cx + (i - 2) * 16, top + 62, 4, 0, 7);
        ctx.fillStyle = i < BALLS_PER_ROUND - g.ball ? '#eec73f' : 'rgba(255,255,255,0.18)';
        ctx.fill();
      }
      if (g.fire) {
        ctx.font = "700 15px 'Saira Condensed', sans-serif";
        ctx.fillStyle = '#ff7a3c';
        ctx.fillText(`ON FIRE ×2 · STREAK ${g.streak}`, cx, top + 76);
      } else if (g.streak > 0) {
        ctx.font = "600 13px 'Saira Condensed', sans-serif";
        ctx.fillStyle = 'rgba(238,231,210,0.6)';
        ctx.fillText(`streak ${g.streak}`, cx, top + 76);
      }
    }
  }

  function drawFx() {
    for (const p of S.fx.parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const m of S.fx.msgs) {
      ctx.globalAlpha = 1 - m.t;
      ctx.font = "24px Graduate, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, view.w / 2, view.h * 0.3 - m.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.save();
    if (S.fx.shake > 0) ctx.translate((Math.random() - 0.5) * S.fx.shake, (Math.random() - 0.5) * S.fx.shake);
    drawScene(S.cam);
    const b = S.ball;
    const behind = b && (b.p.z > 0 || (b.made && b.p.y < RIM_Y));
    if (b && behind) drawBall(S.cam, b, S.game && S.game.fire);
    drawNet(S.cam);
    drawRim(S.cam);
    if (b && !behind) drawBall(S.cam, b, S.game && S.game.fire);
    drawFx();
    ctx.restore();
    drawHUD();
  }
```

Note: `S.cam`/`S.ball` are set by `showStart()` → `setSpot(0, 0)` before the first `render()` (openGame calls `showStart()` before `startLoop()`), so they are never null while the loop runs.

- [ ] **Step 5: Verify by playing**

1. `node --test tests/` green; `node -e "import('./shootout.js').then(() => console.log('ok'))"` ok.
2. In the browser, play a full 15-ball game with a mouse: start screen → flick shots (aim + power both matter), makes swish or rattle believably, corner spots show the hoop picture rotated, misses bounce on the floor, round interstitials appear, end screen totals and saves. Reload the page — the card shows `Best: N`, the start screen shows the top-5 list. Throw a garbage value into `localStorage['cc-shootout-v1']` in devtools and reopen — no crash, fresh store.
3. Feel check (tune if needed, constants only): a comfortable flick from Round 1 should score with practice; Round 3 should demand a genuinely hard, clean flick. Tuning knobs: the `0.8/3.2` normalized-speed window and `0.72 + pn * 0.5` power band in `flickToLaunch` — do not touch physics constants to fix feel.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js
git commit -m "Add shootout gameplay: flick input, shot lifecycle, HUD, screens, personal bests"
```

---

### Task 7: Juice — live net, particles, shake, fire trail, reduced motion

**Files:**
- Modify: `shootout.js` (inside `initShootout()` — replace the Task 6 stubs `netTick`, `kick`, `burstAtRim`, `flameTrail`)

**Interfaces:**
- Consumes: `net` (Task 5), `S` (Task 6), `project`, `RIM_Y`, `BALL_R`.
- Produces: working versions of the four stubs; no signature changes.

- [ ] **Step 1: Replace the stubs**

```js
  /* Verlet net: nodes relax toward their rest shape; the ball shoves them. */
  function netTick(netRef, ball, dt) {
    for (const n of netRef.nodes) {
      if (n.pin) continue;
      const vx = (n.x - n.px) * 0.9, vy = (n.y - n.py) * 0.9, vz = (n.z - n.pz) * 0.9;
      n.px = n.x; n.py = n.y; n.pz = n.z;
      n.x += vx + (n.ox - n.x) * 0.03;
      n.y += vy + (n.oy - n.y) * 0.03;
      n.z += vz + (n.oz - n.z) * 0.03;
    }
    if (ball && ball.live && !ball.done) {
      const R = BALL_R + 0.05;
      for (const n of netRef.nodes) {
        if (n.pin) continue;
        const dx = n.x - ball.p.x, dy = n.y - ball.p.y, dz = n.z - ball.p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < R && d > 1e-6) {
          const push = (R - d) / d;
          n.x += dx * push; n.y += dy * push; n.z += dz * push;
        }
      }
    }
    for (let it = 0; it < 2; it++) {
      for (const [ia, ib, rest] of netRef.cons) {
        const a = netRef.nodes[ia], b2 = netRef.nodes[ib];
        const dx = b2.x - a.x, dy = b2.y - a.y, dz = b2.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= rest || d < 1e-6) continue;              // strings only pull
        const corr = (d - rest) / d / 2;
        if (!a.pin) { a.x += dx * corr; a.y += dy * corr; a.z += dz * corr; }
        if (!b2.pin) { b2.x -= dx * corr; b2.y -= dy * corr; b2.z -= dz * corr; }
      }
    }
  }

  function kick(n) { if (!S.reduced) S.fx.shake = n; }

  function burstAtRim() {
    if (S.reduced) return;
    const q = project(S.cam, 0, RIM_Y, 0);
    if (!q) return;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 2 * Math.PI, sp = 60 + Math.random() * 120;
      S.fx.parts.push({ x: q.x, y: q.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0.6 + Math.random() * 0.3, color: '#eec73f' });
    }
  }

  function flameTrail(ball) {
    if (S.reduced) return;
    const q = project(S.cam, ball.p.x, ball.p.y, ball.p.z);
    if (!q) return;
    S.fx.parts.push({
      x: q.x + (Math.random() - 0.5) * 4, y: q.y,
      vx: (Math.random() - 0.5) * 20, vy: 30,
      life: 0.35, color: Math.random() < 0.5 ? '#ff7a3c' : '#ffb066',
    });
  }
```

Remove the now-shadowed stub declarations from Task 6 (`function netTick(...) {}` etc.) — each name must be defined exactly once.

- [ ] **Step 2: Verify**

`node --test tests/` green (pure core untouched). In the browser: a made shot visibly snaps the net through; gold burst on makes; rim hits nudge the screen; on-fire shots leave a flame trail. Enable "reduce motion" in OS settings (or emulate `prefers-reduced-motion` in devtools rendering tab) — net still animates (it is object motion, not vestibular), but no shake, burst, or trail.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js
git commit -m "Add shootout juice: verlet net reacts to the ball, particles, shake, fire trail"
```

---

### Task 8: Synthesized sound and haptics

**Files:**
- Modify: `shootout.js` (inside `initShootout()` — replace the no-op `sfx`, wire the mute button)

**Interfaces:**
- Consumes: `S.store.muted` (Task 6), `muteBtn` (Task 4), `saveStore` (Task 6).
- Produces: `sfx = makeSfx(() => S.store.muted)` with the same seven method names as the stub: `bounce, clank, board, swish, score, fire, buzzer`.

- [ ] **Step 1: Implement WebAudio synth + mute**

Replace `let sfx = { ... noops ... }` with:

```js
  function makeSfx(isMuted) {
    let ac = null;
    function ctx2() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone({ type = 'sine', f0 = 440, f1 = f0, t = 0.1, g = 0.25, when = 0 }) {
      const c = ctx2();
      if (!c || isMuted()) return;
      const o = c.createOscillator(), v = c.createGain(), n = c.currentTime + when;
      o.type = type;
      o.frequency.setValueAtTime(f0, n);
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), n + t);
      v.gain.setValueAtTime(g, n);
      v.gain.exponentialRampToValueAtTime(0.001, n + t);
      o.connect(v).connect(c.destination);
      o.start(n);
      o.stop(n + t + 0.02);
    }
    function noise({ t = 0.15, g = 0.3, f = 1800, q = 1, slide = 0 }) {
      const c = ctx2();
      if (!c || isMuted()) return;
      const len = Math.max(1, (t * c.sampleRate) | 0);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      if (slide) bp.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t);
      const v = c.createGain();
      v.gain.setValueAtTime(g, c.currentTime);
      v.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t);
      src.connect(bp).connect(v).connect(c.destination);
      src.start();
    }
    return {
      bounce: () => tone({ f0: 110, f1: 60, t: 0.08, g: 0.35 }),
      clank: () => { tone({ type: 'square', f0: 210, f1: 150, t: 0.1, g: 0.2 }); noise({ t: 0.09, f: 900, g: 0.25 }); },
      board: () => tone({ f0: 160, f1: 120, t: 0.07, g: 0.25 }),
      swish: () => noise({ t: 0.22, f: 2600, slide: 500, g: 0.35, q: 0.8 }),
      score: () => { tone({ f0: 660, t: 0.09, g: 0.2 }); tone({ f0: 990, t: 0.12, g: 0.18, when: 0.07 }); },
      fire: () => { noise({ t: 0.5, f: 500, slide: 2400, g: 0.35 }); tone({ type: 'sawtooth', f0: 180, f1: 420, t: 0.4, g: 0.12 }); },
      buzzer: () => tone({ type: 'square', f0: 190, f1: 170, t: 0.5, g: 0.25 }),
    };
  }
  const sfx = makeSfx(() => S.store.muted);

  function syncMute() {
    muteBtn.textContent = S.store.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(S.store.muted));
  }
  muteBtn.addEventListener('click', () => {
    S.store.muted = !S.store.muted;
    saveStore(S.store);
    syncMute();
  });
  syncMute();
```

(`sfx` changes from `let` to `const` — the stub declaration is removed, not reassigned; also delete the now-unused `const noop` from Task 6. AudioContext is only created on the first sound after a user gesture, satisfying autoplay policy; haptics were already wired in Task 6's `resolveShot`.)

- [ ] **Step 2: Verify**

`node --test tests/` green; module still imports under Node (no `window` access at top level). In the browser: bounce/clank/swish/score/fire/buzzer all audible at the right moments; mute toggles instantly and survives a reload (persisted in the store blob).

- [ ] **Step 3: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add shootout.js
git commit -m "Add shootout synthesized sound effects, haptics, and persistent mute"
```

---

### Task 9: README, full-suite verification, playthrough QA

**Files:**
- Modify: `README.md`

**Interfaces:** none new.

- [ ] **Step 1: Document the feature**

In `README.md`, add to the "What it does" list (after the Clark Watch bullet):

```markdown
- **Logo 3 Challenge** — a flick-to-shoot 3-point mini-game: 15 balls across three deepening rounds (the arc → deep → the center-court logo), real 3D ball physics with rim/backboard collisions, swish bonuses, an NBA-Jam-style on-fire multiplier, and localStorage personal bests. Launched from a card in the Clark section; works with touch or mouse.
```

And in the "Tech" section, extend the hand-rolled-charts bullet with:

```markdown
- The Logo 3 Challenge game is a single dependency-free ES module (`shootout.js`): Canvas 2D with a hand-rolled perspective projection, 120 Hz fixed-timestep physics, a verlet net, and WebAudio-synthesized sound. Its pure simulation core is unit-tested in `tests/shootout.test.mjs`.
```

- [ ] **Step 2: Full verification pass**

1. `cd "/Users/sherlock/Projects/CC Tracker" && node --test tests/` — entire suite green.
2. `node -e "import('./shootout.js').then((m) => console.log(Object.keys(m).sort().join(', ')))"` — exports list prints.
3. Browser QA checklist (desktop + narrow mobile viewport):
   - [ ] Card shows best score (or "Not yet played"); opens overlay; ✕/Escape close; scroll locked while open; focus returns to the page on close.
   - [ ] Full game start→finish; between-round interstitials; end screen with NEW BEST on a first game.
   - [ ] Bank shots score; lip-outs happen; swishes flagged; on-fire doubles and un-fires on a miss.
   - [ ] Backgrounding the tab pauses; resizing/rotating mid-game keeps the scene proportioned.
   - [ ] Narrow viewport (~375px): HUD legible, panels fit, one-thumb flicks comfortable.
   - [ ] `styles.css?v=7` and `shootout.js?v=1` load (network tab), SW `v4` activates, and the game works offline on a second visit.
4. The user should play on a real phone (installed PWA) for final feel sign-off — flick tuning lives in `flickToLaunch`'s `[0.9, 4.0]` window and `0.72 + pn * 0.5` band only.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sherlock/Projects/CC Tracker"
git add README.md
git commit -m "Document the Logo 3 Challenge mini-game in the README"
```

---

### Task 6b (amendment, 2026-07-27): Shooting feel + depth retune

Owner playtest feedback after Task 6: shots nearly impossible to make (gesture
mapping demanded ~±1% flick precision); rounds read as the same distance (fixed
camera, no pitch, no floor context). Owner-approved calibration: **Balanced**
(±8% / ±6% / ±4% effective make windows via invisible sweet-spot assist).
Changes: `flickToLaunch` n-window widened to [0.9, 4.0] + power/aim assist
driven by new per-round `ROUNDS[i].assist` values; `HELD_Y` 4.2 → 3.6; pitched
(~11°) distance-aware camera (pull-back + rise per round); hardwood planks +
painted key; 3 new assist tests. Full brief:
`.superpowers/sdd/2026-07-26-logo3-challenge/task-6b-brief.md` (workspace copy).
