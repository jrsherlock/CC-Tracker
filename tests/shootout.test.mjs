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
