import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newBall, stepBall, collideRim, collideBoard, launchSpeedFor,
  RELEASE_Y, RIM_Y, RIM_R, BALL_R, RIM_TUBE, REST_RIM, BOARD_Z, DT,
  ROUNDS, BALLS_PER_ROUND, AIM_MAX, spotPosition, flickToLaunch,
  newGame, recordShot, parseStore, emptyStore, updateBests, STORE_KEY,
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

test('sweet-spot assist: a 6%-cold flick scores from 22 ft with round-1 assist, misses without', () => {
  const h = 700, up = 2.264 * h * 0.08;         // n≈2.264 → raw power ≈ 0.94
  const spot = spotPosition(0, 2);
  const trail = () => [{ x: 200, y: 640, t: 1000 }, { x: 200, y: 640 - up, t: 1080 }];
  const settle = (l) => {
    const b = newBall(spot);
    b.p = { ...l.p }; b.v = { ...l.v }; b.live = true;
    for (let i = 0; i < 6 / DT && !b.done; i++) stepBall(b, DT);
    return b;
  };
  assert.equal(settle(flickToLaunch(trail(), { h, spot, dist: 22, assist: 0.08 })).made, true);
  assert.equal(settle(flickToLaunch(trail(), { h, spot, dist: 22 })).made, false);
});

test('assist window is bounded: max-power flicks stay hot', () => {
  const h = 700, up = 4.5 * h * 0.08;           // n ≥ 4.0 → pn = 1
  const l = flickToLaunch([{ x: 200, y: 640, t: 1000 }, { x: 200, y: 640 - up, t: 1080 }],
    { h, spot: spotPosition(0, 2), dist: 22, assist: 0.08 });
  assert.ok(Math.hypot(l.v.x, l.v.y, l.v.z) > 1.1 * launchSpeedFor(22, 44));
});

test('aim assist: ~3° off-line scores with assist, misses without', () => {
  const h = 700, dyv = 2.636 * h * 0.08;        // n≈2.64 → raw power ≈ 1.0
  const dxv = Math.tan((3 * Math.PI) / 180) * dyv;
  const spot = spotPosition(0, 2);
  const trail = () => [{ x: 200, y: 640, t: 1000 }, { x: 200 + dxv, y: 640 - dyv, t: 1080 }];
  const settle = (l) => {
    const b = newBall(spot);
    b.p = { ...l.p }; b.v = { ...l.v }; b.live = true;
    for (let i = 0; i < 6 / DT && !b.done; i++) stepBall(b, DT);
    return b;
  };
  assert.equal(settle(flickToLaunch(trail(), { h, spot, dist: 22, assist: 0.08 })).made, true);
  assert.equal(settle(flickToLaunch(trail(), { h, spot, dist: 22 })).made, false);
});
