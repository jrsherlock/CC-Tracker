import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAlerts, computeActive, summaryFacts, parseScheduleLite } from '../api/poll.js';
import { validSubscription } from '../api/subscribe.js';
import { sealJSON, openJSON } from '../lib/pushcrypto.js';
import { randomBytes } from 'node:crypto';

const MIN = 60000, H = 3600e3;
const T0 = Date.parse('2026-07-19T23:00:00Z');
const game = (o = {}) => ({ id: '401', date: T0, state: 'pre', completed: false, home: true, oppAbbr: 'CHI', oppName: 'Sky', feverScore: null, oppScore: null, won: false, broadcast: 'ION', ...o });
const sum = (o) => ({
  header: { id: o.id ?? '401', competitions: [{ status: { period: o.period ?? 1, displayClock: o.clock ?? '10:00', type: { state: o.state ?? 'in', completed: o.completed ?? false } }, competitors: [{ team: { id: '5' }, homeAway: 'home', score: String(o.fever ?? 0) }, { team: { id: '9' }, homeAway: 'away', score: String(o.opp ?? 0) }] }] },
  boxscore: { players: [{ statistics: [{ keys: ['points', 'rebounds', 'assists'], athletes: [{ athlete: { id: '4433403' }, stats: o.clark ?? null }] }] }] },
});

test('tipoff fires inside 35-minute window, once', () => {
  const g = [game()];
  const a = decideAlerts(g, null, { sent: {} }, T0 - 30 * MIN);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, 'tipoff:401');
  assert.match(a[0].body, /Sky/);
  assert.equal(decideAlerts(g, null, { sent: { 'tipoff:401': 1 } }, T0 - 30 * MIN).length, 0);
  assert.equal(decideAlerts(g, null, { sent: {} }, T0 - 2 * H).length, 0);
});

test('clutch fires only in Q4/OT, close, under 5:00', () => {
  const g = [game({ state: 'in' })];
  const hit = decideAlerts(g, sum({ period: 4, clock: '2:58', fever: 78, opp: 76, clark: ['12', '4', '6'] }), { sent: {} }, T0 + H);
  assert.ok(hit.some((a) => a.key === 'clutch:401'));
  assert.ok(!decideAlerts(g, sum({ period: 3, clock: '2:58', fever: 78, opp: 76 }), { sent: {} }, T0 + H).some((a) => a.key === 'clutch:401'));
  assert.ok(!decideAlerts(g, sum({ period: 4, clock: '2:58', fever: 85, opp: 76 }), { sent: {} }, T0 + H).some((a) => a.key === 'clutch:401'));
});

test('triple-double watch needs 8+ in all three', () => {
  const g = [game({ state: 'in' })];
  const yes = decideAlerts(g, sum({ period: 3, clock: '5:00', fever: 60, opp: 50, clark: ['12', '8', '9'] }), { sent: {} }, T0 + H);
  assert.ok(yes.some((a) => a.key === 'td:401'));
  const no = decideAlerts(g, sum({ period: 3, clock: '5:00', fever: 60, opp: 50, clark: ['12', '7', '9'] }), { sent: {} }, T0 + H);
  assert.ok(!no.some((a) => a.key === 'td:401'));
});

test('final fires once, fresh games only, includes Clark line', () => {
  const g = [game({ state: 'post', completed: true, feverScore: '81', oppScore: '76', won: true })];
  const s = sum({ state: 'post', completed: true, period: 4, clock: '0.0', fever: 81, opp: 76, clark: ['20', '5', '10'] });
  const a = decideAlerts(g, s, { sent: {} }, T0 + 3 * H);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, 'final:401');
  assert.match(a[0].title, /win/i);
  assert.match(a[0].body, /20 PTS/);
  assert.equal(decideAlerts(g, s, { sent: { 'final:401': 1 } }, T0 + 3 * H).length, 0);
  assert.equal(decideAlerts(g, s, { sent: {} }, T0 + 6 * H).length, 0);
});

test('computeActive gates the polling loop', () => {
  assert.equal(computeActive([game({ state: 'in' })], T0, null), true);
  assert.equal(computeActive([game()], T0 - 40 * MIN, null), true);
  assert.equal(computeActive([game()], T0 - 2 * H, null), false);
  const done = [game({ state: 'post', completed: true })];
  assert.equal(computeActive(done, T0 + 2 * H, null), true);
  assert.equal(computeActive(done, T0 + 2 * H, { sent: { 'final:401': 1 } }), false);
  assert.equal(computeActive(done, T0 + 4 * H, null), false);
});

test('summaryFacts pulls scores, clock, clark', () => {
  const f = summaryFacts(sum({ period: 4, clock: '2:58', fever: 78, opp: 76, clark: ['12', '4', '6'] }));
  assert.deepEqual([f.period, f.clockSec, f.feverScore, f.oppScore], [4, 178, 78, 76]);
  assert.deepEqual(f.clark, { pts: 12, reb: 4, ast: 6 });
});

test('parseScheduleLite maps ESPN events', () => {
  const data = { events: [{ id: '9', date: '2026-07-19T23:00:00Z', competitions: [{ status: { type: { state: 'pre', completed: false } }, competitors: [{ team: { id: '5', abbreviation: 'IND' }, homeAway: 'home' }, { team: { id: '9', abbreviation: 'CHI', shortDisplayName: 'Sky' }, homeAway: 'away' }], broadcasts: [{ media: { shortName: 'ION' } }] }] }] };
  const [g] = parseScheduleLite(data);
  assert.deepEqual([g.id, g.state, g.home, g.oppAbbr, g.broadcast], ['9', 'pre', true, 'CHI', 'ION']);
});

test('sealJSON/openJSON round-trips and rejects tampering', () => {
  const key = randomBytes(32);
  const obj = { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } };
  const sealed = sealJSON(obj, key);
  assert.ok(!sealed.includes('fcm.googleapis.com'));
  assert.deepEqual(openJSON(sealed, key), obj);
  const bad = JSON.parse(sealed);
  bad.ct = bad.ct.slice(0, -4) + 'AAAA';
  assert.throws(() => openJSON(JSON.stringify(bad), key));
});

test('validSubscription accepts real shape, rejects junk', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } };
  assert.equal(validSubscription(good), true);
  assert.equal(validSubscription({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }), false);
  assert.equal(validSubscription({ endpoint: 'https://x' }), false);
  assert.equal(validSubscription({ ...good, pad: 'x'.repeat(5000) }), false);
});
