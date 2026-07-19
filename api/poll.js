import { timingSafeEqual } from 'node:crypto';
import { put, del, list } from '@vercel/blob';
import webpush from 'web-push';

const FEVER_ID = '5';
const CLARK_ID = '4433403';
const SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/5/schedule';
const SUMMARY_URL = (id) => `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${id}`;
const MIN = 60000, HOUR = 3600e3;
const TIPOFF_WINDOW = 35 * MIN;      // alert when tip is this close
const CHECK_LEAD = 45 * MIN;         // loop wakes this far ahead of tip
const FINAL_WINDOW = 5 * HOUR;       // ignore finals older than this (vs tip time)
const CHECK_TAIL = 3.5 * HOUR;       // stateless post-tip active window
const STATE_KEY = 'state/alerts.json';

/* ---------------- pure logic (unit-tested) ---------------- */

export function parseScheduleLite(data) {
  return ((data && data.events) || []).map((ev) => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const comps = comp.competitors || [];
    const fever = comps.find((c) => c.team && String(c.team.id) === FEVER_ID) || comps.find((c) => c.team && c.team.abbreviation === 'IND');
    const opp = comps.find((c) => c !== fever && c && c.team) || {};
    const st = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
    const scoreOf = (c) => {
      const sc = c && c.score;
      if (sc == null) return null;
      return typeof sc === 'object' ? (sc.displayValue ?? sc.value ?? null) : sc;
    };
    const b = comp.broadcasts && comp.broadcasts[0];
    return {
      id: String(ev.id),
      date: Date.parse(ev.date),
      state: st.state || 'pre',
      completed: !!st.completed,
      home: fever ? fever.homeAway === 'home' : true,
      oppAbbr: (opp.team && opp.team.abbreviation) || '—',
      oppName: (opp.team && (opp.team.shortDisplayName || opp.team.displayName)) || 'TBD',
      feverScore: scoreOf(fever),
      oppScore: scoreOf(opp),
      won: fever ? fever.winner === true : false,
      broadcast: (b && ((b.media && b.media.shortName) || (Array.isArray(b.names) && b.names[0]))) || '',
    };
  }).sort((a, b2) => a.date - b2.date);
}

export function summaryFacts(sum) {
  const comp = sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  if (!comp) return null;
  const st = comp.status || {};
  const fev = (comp.competitors || []).find((c) => c.team && String(c.team.id) === FEVER_ID);
  const opp = (comp.competitors || []).find((c) => c !== fev && c && c.team);
  let clark = null;
  for (const t of (sum.boxscore && sum.boxscore.players) || []) {
    const stat = t.statistics && t.statistics[0];
    if (!stat) continue;
    const a = (stat.athletes || []).find((x) => x.athlete && String(x.athlete.id) === CLARK_ID);
    if (!a || !a.stats || !a.stats.length) continue;
    const keys = stat.keys || [];
    const v = (k) => { const i = keys.indexOf(k); return i >= 0 ? (parseInt(a.stats[i], 10) || 0) : 0; };
    clark = { pts: v('points'), reb: v('rebounds'), ast: v('assists') };
    break;
  }
  const s = String(st.displayClock ?? '0');
  const clockSec = s.includes(':') ? (+s.split(':')[0]) * 60 + (+s.split(':')[1]) : (parseFloat(s) || 0);
  return {
    eventId: sum.header ? String(sum.header.id) : null,
    inProgress: !!(st.type && st.type.state === 'in'),
    completed: !!(st.type && st.type.completed),
    period: st.period || 0,
    clockSec,
    feverScore: Number((fev && fev.score) ?? 0),
    oppScore: Number((opp && opp.score) ?? 0),
    clark,
  };
}

export function computeActive(games, now, state) {
  if (games.some((g) => g.state === 'in')) return true;
  const next = games.filter((g) => g.state === 'pre' && g.date > now - 30 * MIN).sort((a, b) => a.date - b.date)[0];
  if (next && next.date - now <= CHECK_LEAD) return true;
  return games.some((g) => g.completed && now - g.date > 0 && now - g.date < CHECK_TAIL
    && (!state || !state.sent[`final:${g.id}`]));
}

const periodLabel = (n) => (n <= 4 ? `Q${n}` : (n === 5 ? 'OT' : `${n - 4}OT`));
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtTip = (ms) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Indiana/Indianapolis' }).format(ms) + ' ET';

export function decideAlerts(games, summary, state, now) {
  const sent = (state && state.sent) || {};
  const out = [];
  const facts = summary ? summaryFacts(summary) : null;

  const next = games.filter((g) => g.state === 'pre').sort((a, b) => a.date - b.date)[0];
  if (next && !sent[`tipoff:${next.id}`]) {
    const dt = next.date - now;
    if (dt > 0 && dt <= TIPOFF_WINDOW) {
      out.push({ key: `tipoff:${next.id}`, title: 'Fever tip off soon',
        body: `${next.home ? 'vs' : 'at'} ${next.oppName} · ${fmtTip(next.date)}${next.broadcast ? ` · ${next.broadcast}` : ''}`, url: '/#game' });
    }
  }

  const live = games.find((g) => g.state === 'in') || null;
  if (live && facts && facts.inProgress) {
    const margin = Math.abs(facts.feverScore - facts.oppScore);
    if (!sent[`clutch:${live.id}`] && facts.period >= 4 && facts.clockSec <= 300 && margin <= 5) {
      out.push({ key: `clutch:${live.id}`, title: 'Clutch time in Indy',
        body: `${periodLabel(facts.period)} ${fmtClock(facts.clockSec)} — Fever ${facts.feverScore}, ${live.oppName} ${facts.oppScore}. Tune in.`, url: '/#game' });
    }
    const c = facts.clark;
    if (!sent[`td:${live.id}`] && c && c.pts >= 8 && c.reb >= 8 && c.ast >= 8) {
      out.push({ key: `td:${live.id}`, title: 'Triple-double watch',
        body: `Caitlin Clark: ${c.pts} PTS · ${c.reb} REB · ${c.ast} AST`, url: '/#clark' });
    }
  }

  for (const g of games) {
    if (!g.completed || sent[`final:${g.id}`]) continue;
    const age = now - g.date;
    if (age <= 0 || age >= FINAL_WINDOW) continue;
    const clark = (facts && facts.clark && String(facts.eventId) === g.id)
      ? ` · Clark: ${facts.clark.pts} PTS, ${facts.clark.reb} REB, ${facts.clark.ast} AST` : '';
    out.push({ key: `final:${g.id}`, title: `Final: Fever ${g.won ? 'win' : 'fall'} ${g.feverScore}–${g.oppScore}`,
      body: `${g.home ? 'vs' : 'at'} ${g.oppName}${clark}`, url: '/#game' });
  }
  return out;
}

/* ---------------- I/O ---------------- */

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'cc-tracker-poller' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function authorized(req) {
  const secret = process.env.POLL_SECRET || '';
  const given = ((req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || String((req.query && req.query.key) || '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  return secret.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function loadState() {
  const { blobs } = await list({ prefix: STATE_KEY });
  if (!blobs.length) return { sent: {} };
  try { return await (await fetch(blobs[0].url, { cache: 'no-store' })).json(); }
  catch { return { sent: {} }; }
}

async function saveState(state, now) {
  for (const [k, ts] of Object.entries(state.sent)) if (now - ts > 7 * 24 * HOUR) delete state.sent[k];
  await put(STATE_KEY, JSON.stringify(state), { access: 'public', addRandomSuffix: false, contentType: 'application/json', allowOverwrite: true });
}

async function loadSubs() {
  const { blobs } = await list({ prefix: 'subs/' });
  const subs = [];
  for (const b of blobs) {
    try { subs.push({ url: b.url, sub: await (await fetch(b.url, { cache: 'no-store' })).json() }); }
    catch { /* skip unreadable */ }
  }
  return subs;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const now = Date.now();
  const games = parseScheduleLite(await getJSON(SCHEDULE_URL));

  if (req.query && req.query.mode === 'check') {
    return res.status(200).json({ active: computeActive(games, now, null) });
  }

  const focus = games.find((g) => g.state === 'in')
    || [...games].reverse().find((g) => g.completed && now - g.date > 0 && now - g.date < FINAL_WINDOW)
    || null;
  const summary = focus ? await getJSON(SUMMARY_URL(focus.id)).catch(() => null) : null;

  const state = await loadState();
  const alerts = decideAlerts(games, summary, state, now);
  let sent = 0, pruned = 0;
  if (alerts.length) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:jsherlock@cybercade.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const subs = await loadSubs();
    for (const alert of alerts) {
      for (const s of subs) {
        try {
          await webpush.sendNotification(s.sub, JSON.stringify({ title: alert.title, body: alert.body, url: alert.url, tag: alert.key }));
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) { await del(s.url).catch(() => {}); pruned++; }
        }
      }
      state.sent[alert.key] = now;
    }
    await saveState(state, now);
  }
  return res.status(200).json({ active: computeActive(games, now, state), alerts: alerts.map((a) => a.key), sent, pruned });
}
