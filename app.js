/* ============================================================
   CC TRACKER · INDIANA FEVER
   Vanilla JS, no build step. All data from the public ESPN API,
   fetched client-side (CORS is open) and refreshed on a timer.
   ============================================================ */

'use strict';

const FEVER_ID = '5';
const CLARK_ID = '4433403';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba';

const API = {
  schedule: `${BASE}/teams/${FEVER_ID}/schedule`,
  summary: (id) => `${BASE}/summary?event=${id}`,
  standings: `https://site.api.espn.com/apis/v2/sports/basketball/wnba/standings`,
  news: `${BASE}/news?team=${FEVER_ID}&limit=12`,
  athlete: `${WEB}/athletes/${CLARK_ID}`,
  overview: `${WEB}/athletes/${CLARK_ID}/overview`,
  gamelog: `${WEB}/athletes/${CLARK_ID}/gamelog`,
};

const S = {
  games: [],           // parsed schedule
  live: null, next: null, last: null,
  summary: null,       // summary of focus game (live ?? last)
  ccAvg: null,         // season averages for chart ref line
  updatedAt: null,
  pollCount: 0,
};

/* ---------------------------------------------------------- utils */
const $ = (sel) => document.querySelector(sel);

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function svgEl(tag, attrs = {}, parent = null) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function fmtDay(d) { return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`; }
function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtShortDate(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function relDate(iso) {
  const d = new Date(iso); const now = new Date();
  const days = Math.round((now - d) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDay(d);
}

function teamLogo(team) {
  if (team?.logos?.length) return team.logos[0].href;
  if (team?.logo) return team.logo;
  const ab = (team?.abbreviation || '').toLowerCase();
  return ab ? `https://a.espncdn.com/i/teamlogos/wnba/500/${ab}.png` : '';
}

function periodLabel(n) { return n <= 4 ? `Q${n}` : (n === 5 ? 'OT' : `${n - 4}OT`); }
function parseClock(v) {
  if (v == null) return 0;
  const s = String(v);
  if (s.includes(':')) { const [m, sec] = s.split(':'); return (+m) * 60 + (+sec); }
  return parseFloat(s) || 0;
}
function elapsedSecs(periodNum, clockVal) {
  const remain = parseClock(clockVal);
  if (periodNum <= 4) return (periodNum - 1) * 600 + (600 - remain);
  return 2400 + (periodNum - 5) * 300 + (300 - remain);
}

/* ---------------------------------------------------------- schedule */
function parseSchedule(data) {
  const events = data?.events || [];
  return events.map(ev => {
    const comp = ev.competitions?.[0] || {};
    const comps = comp.competitors || [];
    const fever = comps.find(c => c.team?.id === FEVER_ID) || comps.find(c => (c.team?.abbreviation || '') === 'IND');
    const opp = comps.find(c => c !== fever);
    const st = comp.status?.type || ev.status?.type || {};
    const scoreOf = (c) => {
      const sc = c?.score;
      if (sc == null) return null;
      if (typeof sc === 'object') return sc.displayValue ?? sc.value ?? null;
      return sc;
    };
    return {
      id: ev.id,
      date: new Date(ev.date),
      state: st.state || 'pre',                    // pre | in | post
      statusDetail: st.shortDetail || st.detail || '',
      completed: !!st.completed,
      home: fever?.homeAway === 'home',
      feverScore: scoreOf(fever),
      oppScore: scoreOf(opp),
      won: fever?.winner === true,
      opp: {
        abbr: opp?.team?.abbreviation || '—',
        name: opp?.team?.shortDisplayName || opp?.team?.displayName || 'TBD',
        logo: teamLogo(opp?.team),
      },
      venue: comp.venue?.fullName || '',
      broadcast: comp.broadcasts?.[0]?.media?.shortName || (Array.isArray(comp.broadcasts?.[0]?.names) ? comp.broadcasts[0].names[0] : '') || '',
    };
  }).sort((a, b) => a.date - b.date);
}

function classifyGames() {
  S.live = S.games.find(g => g.state === 'in') || null;
  const done = S.games.filter(g => g.state === 'post');
  S.last = done.length ? done[done.length - 1] : null;
  S.next = S.games.find(g => g.state === 'pre') || null;
}

/* ---------------------------------------------------------- hero */
function heroMatchupHTML(g, scores) {
  const showScores = !!scores;
  const fs = showScores ? Number(g.feverScore) : null;
  const os = showScores ? Number(g.oppScore) : null;
  return `
  <div class="matchup">
    <div class="team-side">
      <img class="team-logo" src="https://a.espncdn.com/i/teamlogos/wnba/500/ind.png" alt="Indiana Fever" />
      ${showScores ? `<div class="team-score ${fs >= os ? 'leads' : ''}">${esc(g.feverScore)}</div>` : ''}
      <div class="team-abbr is-fever">IND</div>
    </div>
    <div class="mid-col">
      <div class="mid-vs">${g.home ? 'VS' : '@'}</div>
      <div class="mid-clock ${g.state === 'in' ? 'is-live' : ''}" id="mid-clock">${g.state === 'in' ? esc(g.statusDetail) : (g.state === 'post' ? 'FINAL' : '')}</div>
    </div>
    <div class="team-side">
      <img class="team-logo" src="${esc(g.opp.logo)}" alt="${esc(g.opp.name)}" />
      ${showScores ? `<div class="team-score ${os > fs ? 'leads' : ''}">${esc(g.oppScore)}</div>` : ''}
      <div class="team-abbr">${esc(g.opp.abbr)}</div>
    </div>
  </div>`;
}

function renderHero() {
  const card = $('#hero-card');
  $('#live-flag').hidden = !S.live;

  if (S.live) {
    const g = S.live;
    card.innerHTML = `
      <p class="hero-eyebrow"><span class="liveword">Live</span><span>·</span><span>${g.home ? 'vs' : 'at'} ${esc(g.opp.name)}</span></p>
      ${heroMatchupHTML(g, true)}
      <div id="cc-liveline-slot"></div>
      <p class="lastplay" id="lastplay"></p>
      <div class="linescore" id="linescore"></div>`;
    return;
  }

  if (S.next) {
    const g = S.next;
    card.innerHTML = `
      <p class="hero-eyebrow">Next game · ${fmtDay(g.date)}</p>
      ${heroMatchupHTML(g, false)}
      <div class="countdown" id="countdown" aria-label="Countdown to tipoff"></div>
      <p class="hero-meta">${fmtTime(g.date)}${g.venue ? `<span class="dot">·</span>${esc(g.venue)}` : ''}${g.broadcast ? `<span class="dot">·</span>${esc(g.broadcast)}` : ''}</p>
      ${S.last ? `
      <div class="mini-final">
        <span class="lab">Last game</span>
        <span class="chip ${S.last.won ? 'w' : 'l'}">${S.last.won ? 'W' : 'L'}</span>
        <span>${S.last.home ? 'vs' : '@'} ${esc(S.last.opp.abbr)} · ${esc(S.last.feverScore)}–${esc(S.last.oppScore)}</span>
        <span>${fmtDay(S.last.date)}</span>
      </div>` : ''}`;
    tickCountdown();
    return;
  }

  if (S.last) {
    const g = S.last;
    card.innerHTML = `
      <p class="hero-eyebrow">Final · ${fmtDay(g.date)}</p>
      ${heroMatchupHTML(g, true)}
      <div id="cc-liveline-slot"></div>
      <div class="linescore" id="linescore"></div>`;
    return;
  }

  card.innerHTML = `<p class="err-note">No Fever games found on the schedule.</p>`;
}

function tickCountdown() {
  const cdEl = $('#countdown');
  if (!cdEl || !S.next) return;
  let ms = S.next.date - new Date();
  if (ms < 0) ms = 0;
  const d = Math.floor(ms / 864e5);
  const hrs = Math.floor(ms / 36e5) % 24;
  const min = Math.floor(ms / 6e4) % 60;
  const sec = Math.floor(ms / 1e3) % 60;
  const cells = d > 0
    ? [[d, d === 1 ? 'day' : 'days'], [hrs, 'hrs'], [min, 'min']]
    : [[hrs, 'hrs'], [min, 'min'], [sec, 'sec']];
  cdEl.innerHTML = cells.map(([n, lab]) =>
    `<div class="cd-cell"><div class="cd-num">${String(n).padStart(2, '0')}</div><div class="cd-lab">${lab}</div></div>`).join('');
}

/* enrich hero with summary data (live or final) */
function renderHeroDetail() {
  const sum = S.summary;
  const focus = S.live || S.last;
  if (!sum || !focus) return;
  if (S.live && String(focusIdOf()) !== String(S.live.id)) return;

  // status clock
  const comp = sum.header?.competitions?.[0];
  const st = comp?.status;
  const clockEl = $('#mid-clock');
  if (clockEl && S.live && st) {
    clockEl.textContent = st.type?.shortDetail || `${periodLabel(st.period || 1)} ${st.displayClock || ''}`;
  }

  // last play
  const plays = sum.plays || [];
  const lp = $('#lastplay');
  if (lp && plays.length) lp.textContent = plays[plays.length - 1].text || '';

  // linescore
  const lsEl = $('#linescore');
  if (lsEl && comp?.competitors?.length) {
    const rows = comp.competitors.map(c => {
      const scores = (c.linescores || []).map(l => l.displayValue ?? '–');
      return { abbr: c.team?.abbreviation || '', scores, total: c.score ?? '' };
    });
    const nQ = Math.max(4, ...rows.map(r => r.scores.length));
    if (rows.some(r => r.scores.length)) {
      lsEl.innerHTML = `<table>
        <thead><tr><th></th>${Array.from({ length: nQ }, (_, i) => `<th>${periodLabel(i + 1)}</th>`).join('')}<th>T</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.abbr)}</td>${Array.from({ length: nQ }, (_, i) => `<td>${esc(r.scores[i] ?? '–')}</td>`).join('')}<td class="tot">${esc(r.total)}</td></tr>`).join('')}</tbody>
      </table>`;
    }
  }

  // Clark live/box line
  const slot = $('#cc-liveline-slot');
  if (slot) {
    const line = clarkBoxLine(sum);
    slot.innerHTML = line ? `
      <div class="cc-liveline">
        <span class="who">Caitlin Clark · No. 22</span>
        ${line.map(([k, v, hot]) => `<span class="kv">${hot ? `<b>${esc(v)}</b>` : esc(v)} ${esc(k)}</span>`).join('')}
      </div>` : '';
  }
}

function clarkBoxLine(sum) {
  const teams = sum.boxscore?.players || [];
  for (const t of teams) {
    const stat = t.statistics?.[0];
    if (!stat) continue;
    const a = (stat.athletes || []).find(x => String(x.athlete?.id) === CLARK_ID);
    if (!a) continue;
    const keys = stat.keys || [];
    const v = (key) => { const i = keys.indexOf(key); return i >= 0 ? a.stats?.[i] : null; };
    if (!a.stats?.length) return null;
    const pts = v('points'), reb = v('rebounds'), ast = v('assists');
    const tp = v('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
    const min = v('minutes');
    return [
      ['PTS', pts ?? '0', true],
      ['REB', reb ?? '0', false],
      ['AST', ast ?? '0', false],
      ['3PT', tp ?? '0-0', false],
      ['MIN', min ?? '0', false],
    ];
  }
  return null;
}

function focusIdOf() { return (S.live || S.last)?.id ?? null; }

/* ---------------------------------------------------------- momentum worm */
function renderWorm() {
  const sum = S.summary;
  const wrap = $('#worm');
  const focus = S.live || S.last;
  if (!sum || !focus) { wrap.innerHTML = `<p class="err-note">No game data yet.</p>`; return; }

  const comp = sum.header?.competitions?.[0];
  const comps = comp?.competitors || [];
  const feverHome = (comps.find(c => c.team?.id === FEVER_ID) || {}).homeAway !== 'away';
  const plays = (sum.plays || []).filter(p => p.period?.number != null);
  if (plays.length < 2) { wrap.innerHTML = `<p class="err-note">Play-by-play will appear at tipoff.</p>`; return; }

  $('#worm-title').textContent = S.live ? 'Lead tracker · live' : 'Lead tracker · last game';
  $('#worm-sub').textContent = `${focus.home ? 'vs' : 'at'} ${focus.opp.name} · ${fmtDay(focus.date)}`;

  // build margin samples
  const samples = [{ t: 0, m: 0, label: 'Tip', score: '0–0' }];
  for (const p of plays) {
    const t = elapsedSecs(p.period.number, p.clock?.displayValue);
    const home = +p.homeScore || 0, away = +p.awayScore || 0;
    const m = feverHome ? home - away : away - home;
    const fev = feverHome ? home : away, opp = feverHome ? away : home;
    samples.push({ t, m, p: p.period.number, clock: p.clock?.displayValue || '', score: `${fev}–${opp}`, text: p.scoringPlay ? p.text : null });
  }
  samples.sort((a, b) => a.t - b.t);

  const W = 640, H = 230, padL = 34, padR = 12, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const tMax = Math.max(2400, samples[samples.length - 1].t);
  const mAbs = Math.max(6, ...samples.map(s => Math.abs(s.m)));
  const yMax = Math.ceil((mAbs + 1) / 5) * 5;
  const x = (t) => padL + (t / tMax) * iw;
  const y = (m) => padT + ih / 2 - (m / yMax) * (ih / 2);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });

  // defs: clips above / below zero
  const defs = svgEl('defs', {}, svg);
  const cA = svgEl('clipPath', { id: 'clip-above' }, defs);
  svgEl('rect', { x: 0, y: 0, width: W, height: y(0) }, cA);
  const cB = svgEl('clipPath', { id: 'clip-below' }, defs);
  svgEl('rect', { x: 0, y: y(0), width: W, height: H - y(0) }, cB);

  // quarter gridlines + labels
  const qEnds = [600, 1200, 1800, 2400];
  let extra = 2400; while (extra < tMax) { extra += 300; qEnds.push(extra); }
  for (const q of qEnds) {
    if (q > tMax) break;
    svgEl('line', { x1: x(q), y1: padT, x2: x(q), y2: padT + ih, stroke: 'oklch(0.32 0.045 262)', 'stroke-dasharray': '3 4', 'stroke-width': 1 }, svg);
  }
  const qStarts = [0, ...qEnds];
  for (let i = 0; i < qStarts.length - 1; i++) {
    const mid = (Math.min(qStarts[i + 1], tMax) + qStarts[i]) / 2;
    if (qStarts[i] >= tMax) break;
    const t = svgEl('text', { x: x(mid), y: H - 8, 'text-anchor': 'middle', fill: 'oklch(0.58 0.03 262)', 'font-size': 10, 'font-family': 'Red Hat Mono, monospace' }, svg);
    t.textContent = i < 4 ? `Q${i + 1}` : (i === 4 ? 'OT' : `${i - 3}OT`);
  }
  // y ticks
  const half = Math.max(1, Math.round(yMax / 2));
  for (const m of [-yMax, -half, half, yMax]) {
    const t = svgEl('text', { x: padL - 6, y: y(m) + 3, 'text-anchor': 'end', fill: 'oklch(0.58 0.03 262)', 'font-size': 10, 'font-family': 'Red Hat Mono, monospace' }, svg);
    t.textContent = (m > 0 ? '+' : '') + m;
  }
  // zero baseline
  svgEl('line', { x1: padL, y1: y(0), x2: W - padR, y2: y(0), stroke: 'oklch(0.45 0.035 262)', 'stroke-width': 1 }, svg);

  // area + stroke paths
  let line = `M ${x(samples[0].t).toFixed(1)} ${y(samples[0].m).toFixed(1)}`;
  for (let i = 1; i < samples.length; i++) line += ` L ${x(samples[i].t).toFixed(1)} ${y(samples[i].m).toFixed(1)}`;
  const area = `${line} L ${x(samples[samples.length - 1].t).toFixed(1)} ${y(0).toFixed(1)} L ${x(samples[0].t).toFixed(1)} ${y(0).toFixed(1)} Z`;

  svgEl('path', { d: area, fill: '#bc8a06', opacity: 0.42, 'clip-path': 'url(#clip-above)' }, svg);
  svgEl('path', { d: area, fill: '#6890d6', opacity: 0.38, 'clip-path': 'url(#clip-below)' }, svg);
  svgEl('path', { d: line, fill: 'none', stroke: '#bc8a06', 'stroke-width': 2, 'clip-path': 'url(#clip-above)', 'stroke-linejoin': 'round' }, svg);
  svgEl('path', { d: line, fill: 'none', stroke: '#6890d6', 'stroke-width': 2, 'clip-path': 'url(#clip-below)', 'stroke-linejoin': 'round' }, svg);

  // hover layer
  const cross = svgEl('line', { x1: 0, y1: padT, x2: 0, y2: padT + ih, stroke: 'oklch(0.78 0.025 92)', 'stroke-width': 1, opacity: 0 }, svg);
  const dot = svgEl('circle', { r: 4, fill: 'oklch(0.955 0.012 92)', stroke: 'oklch(0.15 0.045 262)', 'stroke-width': 2, opacity: 0 }, svg);

  wrap.innerHTML = '';
  wrap.appendChild(svg);

  const tip = $('#worm-tip');
  const banner = wrap.closest('.chart-banner');
  const onMove = (ev) => {
    const pt = ev.touches ? ev.touches[0] : ev;
    const rect = svg.getBoundingClientRect();
    const relX = (pt.clientX - rect.left) / rect.width * W;
    const tSec = Math.max(0, Math.min(tMax, (relX - padL) / iw * tMax));
    let best = samples[0];
    for (const s of samples) { if (Math.abs(s.t - tSec) < Math.abs(best.t - tSec)) best = s; }
    cross.setAttribute('x1', x(best.t)); cross.setAttribute('x2', x(best.t)); cross.setAttribute('opacity', 0.5);
    dot.setAttribute('cx', x(best.t)); dot.setAttribute('cy', y(best.m)); dot.setAttribute('opacity', 1);
    const sign = best.m > 0 ? `+${best.m}` : `${best.m}`;
    tip.innerHTML = `${best.p ? `${periodLabel(best.p)} ${esc(best.clock)}` : 'Tip'} · IND ${esc(best.score)} · <b>${sign}</b>${best.text ? `<br>${esc(best.text)}` : ''}`;
    tip.hidden = false;
    const bRect = banner.getBoundingClientRect();
    const tipX = Math.min(bRect.width - 170, Math.max(6, pt.clientX - bRect.left + 12));
    tip.style.left = `${tipX}px`;
    tip.style.top = `${rect.top - bRect.top + 8}px`;
  };
  const onLeave = () => { tip.hidden = true; cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('touchmove', onMove, { passive: true });
  svg.addEventListener('touchend', onLeave);

  // extremes
  let hi = samples[0], lo = samples[0];
  for (const s of samples) { if (s.m > hi.m) hi = s; if (s.m < lo.m) lo = s; }
  $('#worm-extremes').innerHTML = `
    <span>Biggest lead <b>${hi.m > 0 ? '+' + hi.m : '—'}</b>${hi.m > 0 && hi.p ? ` · ${periodLabel(hi.p)}` : ''}</span>
    <span>Worst deficit <b>${lo.m < 0 ? lo.m : '—'}</b>${lo.m < 0 && lo.p ? ` · ${periodLabel(lo.p)}` : ''}</span>`;
}

/* ---------------------------------------------------------- Clark section */
function renderClarkBio(ath) {
  const a = ath?.athlete || ath || {};
  const bits = [];
  if (a.displayHeight) bits.push(a.displayHeight);
  if (a.age) bits.push(`age ${a.age}`);
  const college = a.college?.name || a.collegeTeam?.displayName;
  if (college) bits.push(college);
  if (a.debutYear) bits.push(`since ${a.debutYear}`);
  if (a.draft?.displayText) bits.push(a.draft.displayText.replace(/ Pick.*$/, ''));
  $('#clark-meta').textContent = bits.length ? bits.join(' · ') : 'Guard · Indiana Fever';
}

function renderClarkTiles(overview) {
  const stats = overview?.statistics;
  const wrap = $('#clark-tiles');
  if (!stats?.names?.length || !stats.splits?.length) { wrap.innerHTML = `<p class="err-note">Season stats unavailable.</p>`; return; }
  const season = stats.splits.find(s => /regular season/i.test(s.displayName)) || stats.splits[0];
  const career = stats.splits.find(s => /career/i.test(s.displayName));
  const idx = (n) => stats.names.indexOf(n);
  const val = (split, n) => { const i = idx(n); return i >= 0 ? split?.stats?.[i] : null; };
  const gp = val(season, 'gamesPlayed');
  S.ccAvg = parseFloat(val(season, 'avgPoints')) || null;
  const tiles = [
    ['PPG', 'avgPoints', 'points'],
    ['APG', 'avgAssists', 'assists'],
    ['RPG', 'avgRebounds', 'rebounds'],
    ['3P%', 'threePointPct', 'three-point'],
  ];
  wrap.innerHTML = tiles.map(([lab, key]) => {
    const v = val(season, key);
    const c = career ? val(career, key) : null;
    return `<div class="stat-tile">
      <div class="lab">${lab}</div>
      <div class="val">${esc(v ?? '—')}</div>
      <div class="sub">${c != null ? `career ${esc(c)}` : ''}</div>
    </div>`;
  }).join('');
  const meta = $('#ptschart-sub');
  if (meta && gp) meta.textContent = `2026 regular season · ${gp} games`;
}

function parseGamelog(gl) {
  const labels = gl?.labels || [];
  const evMeta = gl?.events || {};
  const li = (lab) => labels.indexOf(lab);
  const iPTS = li('PTS'), iREB = li('REB'), iAST = li('AST'), i3PT = li('3PT'), iFG = li('FG'), iMIN = li('MIN');
  const rows = [];
  const seen = new Set();
  for (const st of gl?.seasonTypes || []) {
    for (const cat of st.categories || []) {
      for (const e of cat.events || []) {
        if (!e.eventId || seen.has(e.eventId)) continue;
        const meta = evMeta[e.eventId];
        if (!meta) continue;
        seen.add(e.eventId);
        const stat = e.stats || [];
        const threePM = i3PT >= 0 ? parseInt(String(stat[i3PT]).split('-')[0], 10) || 0 : 0;
        rows.push({
          id: e.eventId,
          date: new Date(meta.gameDate),
          opp: meta.opponent?.abbreviation || '—',
          home: meta.atVs !== '@',
          result: meta.gameResult || '',
          score: meta.score || '',
          pts: iPTS >= 0 ? +stat[iPTS] || 0 : 0,
          reb: iREB >= 0 ? +stat[iREB] || 0 : 0,
          ast: iAST >= 0 ? +stat[iAST] || 0 : 0,
          tp: i3PT >= 0 ? stat[i3PT] : '',
          tpm: threePM,
          fg: iFG >= 0 ? stat[iFG] : '',
          min: iMIN >= 0  ? stat[iMIN] : '',
        });
      }
    }
  }
  rows.sort((a, b) => a.date - b.date);
  return rows;
}

function renderClarkLastGame(rows) {
  const el = $('#clark-lastgame');
  if (!rows.length) { el.hidden = true; return; }
  const g = rows[rows.length - 1];
  const ptsHigh = Math.max(...rows.map(r => r.pts));
  const astHigh = Math.max(...rows.map(r => r.ast));
  const notes = [];
  if (g.pts >= ptsHigh) notes.push('Season-high points');
  if (g.ast >= astHigh) notes.push('Season-high assists');
  if (g.pts >= 10 && g.ast >= 10) notes.push('Double-double');
  el.hidden = false;
  el.innerHTML = `
    <div class="lab">Last game · ${g.home ? 'vs' : 'at'} ${esc(g.opp)} · ${fmtDay(g.date)}</div>
    <div class="line">
      <span><b>${g.pts}</b> PTS</span>
      <span><b>${g.ast}</b> AST</span>
      <span>${g.reb} REB</span>
      <span>${esc(g.tp)} 3PT</span>
      <span class="chip ${g.result === 'W' ? 'w' : 'l'}">${esc(g.result || '—')}</span>
      <span>${esc(g.score)}</span>
    </div>
    ${notes.length ? `<div class="flagnote">★ ${notes.join(' · ')}</div>` : ''}`;
}

function renderClarkChart(rows) {
  const wrap = $('#ptschart');
  if (!rows.length) { wrap.innerHTML = `<p class="err-note">Game log unavailable.</p>`; return; }
  const data = rows.slice(-15);
  const W = 640, H = 250, padL = 30, padR = 14, padT = 20, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const yMax = Math.max(30, Math.ceil(Math.max(...data.map(d => d.pts)) / 10) * 10);
  const bw = Math.min(26, (iw / data.length) * 0.62);
  const xc = (i) => padL + (i + 0.5) * (iw / data.length);
  const y = (v) => padT + ih - (v / yMax) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
  for (let g = 0; g <= yMax; g += 10) {
    svgEl('line', { x1: padL, y1: y(g), x2: W - padR, y2: y(g), stroke: 'oklch(0.28 0.045 262)', 'stroke-width': 1 }, svg);
    const t = svgEl('text', { x: padL - 6, y: y(g) + 3, 'text-anchor': 'end', fill: 'oklch(0.58 0.03 262)', 'font-size': 10, 'font-family': 'Red Hat Mono, monospace' }, svg);
    t.textContent = g;
  }

  const maxPts = Math.max(...data.map(d => d.pts));
  const bars = [];
  data.forEach((d, i) => {
    const bh = Math.max(2, (d.pts / yMax) * ih);
    const bx = xc(i) - bw / 2, by = y(d.pts);
    const r = Math.min(4, bw / 2);
    const path = `M ${bx} ${by + r} Q ${bx} ${by} ${bx + r} ${by} L ${bx + bw - r} ${by} Q ${bx + bw} ${by} ${bx + bw} ${by + r} L ${bx + bw} ${by + bh} L ${bx} ${by + bh} Z`;
    const bar = svgEl('path', { d: path, fill: '#bc8a06', opacity: d.pts === maxPts ? 1 : 0.82 }, svg);
    bars.push(bar);
    // direct label: season high + most recent
    if (d.pts === maxPts || i === data.length - 1) {
      const t = svgEl('text', { x: xc(i), y: by - 6, 'text-anchor': 'middle', fill: 'oklch(0.955 0.012 92)', 'font-size': 11, 'font-weight': 700, 'font-family': 'Red Hat Mono, monospace' }, svg);
      t.textContent = d.pts;
    }
    const lab = svgEl('text', { x: xc(i), y: H - 14, 'text-anchor': 'middle', fill: 'oklch(0.58 0.03 262)', 'font-size': 8.6, 'font-family': 'Red Hat Mono, monospace' }, svg);
    lab.textContent = d.opp;
    const dt = svgEl('text', { x: xc(i), y: H - 4, 'text-anchor': 'middle', fill: 'oklch(0.45 0.03 262)', 'font-size': 8, 'font-family': 'Red Hat Mono, monospace' }, svg);
    dt.textContent = fmtShortDate(d.date);
  });

  // season average reference line
  if (S.ccAvg) {
    svgEl('line', { x1: padL, y1: y(S.ccAvg), x2: W - padR, y2: y(S.ccAvg), stroke: 'oklch(0.78 0.025 92)', 'stroke-width': 1, 'stroke-dasharray': '5 5', opacity: 0.6 }, svg);
    const t = svgEl('text', { x: padL + 5, y: y(S.ccAvg) - 5, 'text-anchor': 'start', fill: 'oklch(0.78 0.025 92)', 'font-size': 9.5, 'font-family': 'Red Hat Mono, monospace' }, svg);
    t.textContent = `AVG ${S.ccAvg}`;
  }

  wrap.innerHTML = '';
  wrap.appendChild(svg);

  const tip = $('#ptschart-tip');
  const banner = wrap.closest('.chart-banner');
  bars.forEach((bar, i) => {
    const d = data[i];
    const show = (ev) => {
      const pt = ev.touches ? ev.touches[0] : ev;
      tip.innerHTML = `${fmtDay(d.date)} · ${d.home ? 'vs' : '@'} ${esc(d.opp)} (${esc(d.result)})<br><b>${d.pts} PTS</b> · ${d.ast} AST · ${d.reb} REB · ${esc(d.tp)} 3PT`;
      tip.hidden = false;
      const bRect = banner.getBoundingClientRect();
      tip.style.left = `${Math.min(bRect.width - 190, Math.max(6, pt.clientX - bRect.left - 60))}px`;
      tip.style.top = `${pt.clientY - bRect.top - 74}px`;
      bar.setAttribute('opacity', 1);
      bar.setAttribute('fill', '#e0aa14');
    };
    const hide = () => { tip.hidden = true; bar.setAttribute('fill', '#bc8a06'); bar.setAttribute('opacity', d.pts === maxPts ? 1 : 0.82); };
    bar.addEventListener('pointerenter', show);
    bar.addEventListener('pointermove', show);
    bar.addEventListener('pointerleave', hide);
  });
}

function renderClarkLedger(rows) {
  const el = $('#clark-ledger');
  if (!rows.length) { el.innerHTML = ''; return; }
  const ptsHigh = Math.max(...rows.map(r => r.pts));
  const astHigh = Math.max(...rows.map(r => r.ast));
  const dd = rows.filter(r => [r.pts, r.reb, r.ast].filter(v => v >= 10).length >= 2).length;
  const td = rows.filter(r => [r.pts, r.reb, r.ast].filter(v => v >= 10).length >= 3).length;
  const twenties = rows.filter(r => r.pts >= 20).length;
  const items = [
    ['Season high', `${ptsHigh} pts`],
    ['High assists', `${astHigh}`],
    [td > 0 ? 'Triple-doubles' : 'Double-doubles', `${td > 0 ? td : dd}`],
    ['20+ pt games', `${twenties} of ${rows.length}`],
  ];
  el.innerHTML = items.map(([k, v]) => `<div class="ledger-item"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('');
}

function renderGamelogTable(rows) {
  const tbody = $('#gamelog-table tbody');
  const last10 = rows.slice(-10).reverse();
  tbody.innerHTML = last10.map(g => `
    <tr>
      <td>${fmtShortDate(g.date)}</td>
      <td>${g.home ? '' : '@'}${esc(g.opp)}</td>
      <td>${esc(g.result)}</td>
      <td class="${g.pts >= 20 ? 'hi' : ''}">${g.pts}</td>
      <td>${g.reb}</td>
      <td class="${g.ast >= 10 ? 'hi' : ''}">${g.ast}</td>
      <td>${esc(g.tp)}</td>
      <td>${esc(g.fg)}</td>
    </tr>`).join('');
}

/* ---------------------------------------------------------- games lists */
function renderGameLists() {
  const recent = S.games.filter(g => g.state === 'post').slice(-8).reverse();
  const upcoming = S.games.filter(g => g.state === 'pre').slice(0, 5);

  $('#recent-rows').innerHTML = recent.length ? recent.map(g => `
    <li>
      <span class="gdate">${fmtShortDate(g.date)}</span>
      <span class="gopp"><img src="${esc(g.opp.logo)}" alt="" loading="lazy" /><span>${g.home ? 'vs' : '@'} ${esc(g.opp.name)}</span></span>
      <span class="gres"><span class="chip ${g.won ? 'w' : 'l'}">${g.won ? 'W' : 'L'}</span>${esc(g.feverScore)}–${esc(g.oppScore)}</span>
    </li>`).join('') : `<li class="err-note">No completed games yet.</li>`;

  $('#upcoming-rows').innerHTML = upcoming.length ? upcoming.map(g => `
    <li>
      <span class="gdate">${fmtShortDate(g.date)}</span>
      <span class="gopp"><img src="${esc(g.opp.logo)}" alt="" loading="lazy" /><span>${g.home ? 'vs' : '@'} ${esc(g.opp.name)}</span></span>
      <span class="gtime">${DAYS[g.date.getDay()]} ${fmtTime(g.date)}${g.broadcast ? `<br>${esc(g.broadcast)}` : ''}</span>
    </li>`).join('') : `<li class="err-note">Schedule complete.</li>`;
}

/* ---------------------------------------------------------- standings */
function statOf(entry, matchers) {
  for (const s of entry.stats || []) {
    const hay = [s.name, s.type, s.abbreviation, s.shortDisplayName].map(v => String(v || '').toLowerCase());
    if (matchers.some(m => hay.includes(m))) return s.displayValue ?? s.value ?? '—';
  }
  return '—';
}

function renderStandings(data) {
  const wrap = $('#standings-wrap');
  const confs = data?.children || [];
  if (!confs.length) { wrap.innerHTML = `<p class="err-note">Standings unavailable.</p>`; return; }
  const order = [...confs].sort((a) => (/east/i.test(a.name) ? -1 : 1));
  wrap.innerHTML = order.map(conf => {
    const entries = conf.standings?.entries || [];
    const sorted = [...entries].sort((a, b) => parseFloat(statOf(b, ['winpercent', 'leaguewinpercent'])) - parseFloat(statOf(a, ['winpercent', 'leaguewinpercent'])));
    return `<div class="conf-block">
      <h4 class="conf-label">${esc(conf.name)}</h4>
      <table class="standings-table">
        <thead><tr><th>Team</th><th>W</th><th>L</th><th>Pct</th><th>GB</th><th class="st-hide-sm">Strk</th><th class="st-hide-sm">L10</th></tr></thead>
        <tbody>
        ${sorted.map(e => {
          const t = e.team || {};
          const isFever = String(t.id) === FEVER_ID;
          return `<tr class="${isFever ? 'is-fever' : ''}">
            <td class="team"><span class="cell"><img src="${esc(teamLogo(t))}" alt="" loading="lazy" /><span>${esc(t.shortDisplayName || t.displayName || '')}</span></span></td>
            <td>${esc(statOf(e, ['wins', 'w']))}</td>
            <td>${esc(statOf(e, ['losses', 'l']))}</td>
            <td>${esc(statOf(e, ['winpercent', 'leaguewinpercent', 'pct']))}</td>
            <td>${esc(statOf(e, ['gamesbehind', 'gb']))}</td>
            <td class="st-hide-sm">${esc(statOf(e, ['streak', 'strk']))}</td>
            <td class="st-hide-sm">${esc(statOf(e, ['l10', 'last ten games', 'lasttengames']))}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('');

  // record chip from standings
  const east = order.flatMap(c => c.standings?.entries || []);
  const fever = east.find(e => String(e.team?.id) === FEVER_ID);
  if (fever) {
    const w = statOf(fever, ['wins', 'w']), l = statOf(fever, ['losses', 'l']);
    if (w !== '—') $('#record-chip').textContent = `${w}–${l}`;
  }
}

/* ---------------------------------------------------------- news */
function renderNews(data) {
  const rail = $('#news-rail');
  const arts = (data?.articles || []).slice(0, 8);
  if (!arts.length) { rail.innerHTML = `<p class="err-note">No headlines right now.</p>`; return; }
  const kicker = (t) => ({ Recap: 'Recap', Media: 'Video', Preview: 'Preview', HeadlineNews: 'News', Story: 'Story' }[t] || 'News');
  rail.innerHTML = arts.map(a => {
    const img = a.images?.[0]?.url || '';
    const href = a.links?.web?.href || '#';
    const k = kicker(a.type);
    return `<a class="news-card" href="${esc(href)}" target="_blank" rel="noopener">
      ${img ? `<img class="news-thumb" src="${esc(img)}" alt="" loading="lazy" />` : `<div class="news-thumb"></div>`}
      <div class="news-body">
        <span class="news-kicker ${k === 'Video' ? 'is-video' : ''}">${k}</span>
        <span class="news-headline">${esc(a.headline)}</span>
        <span class="news-date">${a.published ? relDate(a.published) : ''}</span>
      </div>
    </a>`;
  }).join('');
}

/* ---------------------------------------------------------- loaders */
async function loadSchedule() {
  const data = await getJSON(API.schedule);
  S.games = parseSchedule(data);
  classifyGames();
  renderHero();
  renderGameLists();
  // fallback record from schedule
  const done = S.games.filter(g => g.state === 'post');
  const w = done.filter(g => g.won).length;
  if (done.length && $('#record-chip').textContent === '—') $('#record-chip').textContent = `${w}–${done.length - w}`;
}

async function loadSummary() {
  const id = focusIdOf();
  if (!id) return;
  S.summary = await getJSON(API.summary(id));
  renderHeroDetail();
  renderWorm();
}

async function loadClark() {
  const results = await Promise.allSettled([
    getJSON(API.overview), getJSON(API.gamelog), getJSON(API.athlete),
  ]);
  const [ov, gl, ath] = results.map(r => r.status === 'fulfilled' ? r.value : null);
  if (ath) renderClarkBio(ath);
  if (ov) renderClarkTiles(ov);
  if (gl) {
    const rows = parseGamelog(gl);
    renderClarkLastGame(rows);
    renderClarkChart(rows);
    renderClarkLedger(rows);
    renderGamelogTable(rows);
  } else {
    $('#ptschart').innerHTML = `<p class="err-note">Game log unavailable.</p>`;
  }
}

async function loadStandings() { renderStandings(await getJSON(API.standings)); }
async function loadNews() { renderNews(await getJSON(API.news)); }

function stampUpdated() {
  S.updatedAt = new Date();
  const cadence = S.live ? 'refreshing every 25s' : 'auto-refreshing';
  $('#updated-line').textContent = `· Updated ${fmtTime(S.updatedAt)} · ${cadence} ·`;
}

/* ---------------------------------------------------------- boot + poll */
async function refreshCore() {
  try {
    await loadSchedule();
    await loadSummary();
    stampUpdated();
  } catch (err) {
    console.error('[cc-tracker]', err);
    $('#updated-line').textContent = '· Data hiccup, retrying ·';
  }
}

async function refreshSlow() {
  await Promise.allSettled([loadClark(), loadStandings(), loadNews()]);
}

function startPolling() {
  setInterval(() => { if (!document.hidden && S.next && !S.live) tickCountdown(); }, 1000);
  setInterval(async () => {
    if (document.hidden) return;
    S.pollCount++;
    if (S.live) {
      await refreshCore();                       // every 25s during games
    } else if (S.pollCount % 6 === 0) {
      await refreshCore();                       // every 2.5 min otherwise
    }
    if (S.pollCount % 36 === 0) await refreshSlow();  // every 15 min
  }, 25000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.updatedAt && (new Date() - S.updatedAt) > 60000) refreshCore();
  });
}

(async function init() {
  await refreshCore();
  refreshSlow();
  startPolling();
})();
