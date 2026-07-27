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

  let lastFocus = null;
  function openGame() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('shootout-lock');
    sizeCanvas();
    failed = false; startLoop();
    closeBtn.focus();
  }
  function closeGame() {
    stopLoop();
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
