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
