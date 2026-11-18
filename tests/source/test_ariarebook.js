// ARIA price drop after booking (#250, Aria.js): VERA tells ARIA what was paid for a booked trip
// (Flights Actual ÷ travelers, in VERA's own ARIA Requests tab), ARIA logs daily fares with
// Role = rebook, and VERA posts a lower one to #vera-act-now. Invented data.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const ARIA = read('Aria.js'), CODE = read('Code.js');

function ctx(opts) {
  opts = opts || {};
  const props = {};
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Number, Object, isFinite, parseInt, parseFloat, sent: [], held: [],
    dateCellToIso_: x => String(x || ''), Utilities: { formatDate: d => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => 'UTC' },
    getConfigValues: () => opts.cfg || {}, veraNotes_: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }),
    notifDelivery_: () => opts.delivery || 'slack', awayHolds_: () => !!opts.away, actNowAllowed_: () => opts.allowed !== false, actNowCap_: () => 3,
    notifHold_: (k, t) => c.held.push([k, t]), notifCounts_: () => ({ counts: { act_aria: 1 } }), notifBump_: () => {},
    getSlackChannelId_: () => 'C0ACTNOW1', getNotifChannel_: () => 'vera-act-now',
    sendSlackMessage_: (ch, text, blocks) => { c.sent.push({ ch, text, blocks }); return { ok: true }; } };
  vm.createContext(c);
  vm.runInContext(CODE.match(/const ARIA_REQUESTS_HEADERS = \[[^\]]*\];/)[0].replace('const ', 'var ') + '\n' + ARIA, c);
  c.__props = props;
  return c;
}

console.log('\nWhat was paid');
{
  const c = ctx();
  check('Flights Actual ÷ travelers, in whole dollars', c.ariaPaidPerPerson_([{ category: 'Flights', actual: '$1,932.55' }, { category: 'Hotel', actual: '900' }], 2) === 966);
  check('…two flight rows add up; 2 travelers when unknown', c.ariaPaidPerPerson_([{ category: 'Flights', actual: 600 }, { category: 'flight', actual: 400 }], null) === 500);
  check('…nothing when the actual is blank or 0', c.ariaPaidPerPerson_([{ category: 'Flights', actual: '' }], 2) === null && c.ariaPaidPerPerson_([{ category: 'Flights', actual: 0 }], 2) === null && c.ariaPaidPerPerson_([], 2) === null);
  const r = c.ariaRequestFromRow_(c.ariaRequestToRow_({ id: 'REQ-1', kind: 'watch', ref: '', tripId: 'TRIP-A1', label: 'Lisbon spring', earliest: '2027-04-02', latest: '2027-04-10', status: 'booked', created: 'x', updated: 'y', paidPP: 450, repriceUntil: '2027-04-02' }));
  check('the request row carries Paid Per Person and Reprice Until, at the end', r.paidPP === 450 && r.repriceUntil === '2027-04-02' && c.ARIA_REQUESTS_HEADERS.slice(-2).join('|') === 'Paid Per Person|Reprice Until' && c.ariaRequestToRow_({}).length === c.ARIA_REQUESTS_HEADERS.length);
  check('the Fare Log’s Role column is read', /role: 'Role'/.test(ARIA));
}

console.log('\nWhich fares post');
{
  const c = ctx();
  const reqs = [
    { kind: 'watch', status: 'booked', tripId: 'TRIP-A1', label: 'Lisbon spring', paidPP: 450, repriceUntil: '2027-04-02', travelers: 2 },
    { kind: 'watch', status: 'booked', tripId: 'TRIP-B2', label: 'Ski week', paidPP: 300, repriceUntil: '2026-11-10', travelers: 4 },
    { kind: 'watch', status: 'active', tripId: 'TRIP-C3', label: 'Still watching', paidPP: 500, repriceUntil: '2027-01-01' }];
  const F = (o) => Object.assign({ role: 'rebook', tripId: 'TRIP-A1', dateSeen: '2026-11-18', total: 380, route: 'IAD-LIS', airline: 'TAP', stops: 0, link: 'https://fares.example.test/a1' }, o);
  const picks = c.ariaRebookPicks_([F(), F({ total: 390 }), F({ total: 300, role: '' }), F({ tripId: 'TRIP-B2', total: 100 }), F({ tripId: 'TRIP-C3', total: 100 }), F({ total: 200, dateSeen: '2026-11-15' })], reqs, '2026-11-18', '2026-11-17', 50, []);
  check('a rebook fare lower than paid by $50 or more: the lowest per trip', J(picks.map(p => p.tripId + ':' + p.now)) === '["TRIP-A1:380"]' && picks[0].save === 70 && picks[0].key === 'ARIA|rebook|TRIP-A1|380');
  check('…not an ordinary watch fare, not a trip that has left, not one still being watched, not an old row', picks.length === 1);
  check('…the lowest, whichever order ARIA logged them in', c.ariaRebookPicks_([F({ total: 395 }), F({ total: 360 })], reqs, '2026-11-18', '2026-11-17', 50, [])[0].now === 360);
  check('…not a drop smaller than the minimum', c.ariaRebookPicks_([F({ total: 420 })], reqs, '2026-11-18', '2026-11-17', 50, []).length === 0);
  check('…once per new low; a lower one posts again', c.ariaRebookPicks_([F()], reqs, '2026-11-18', '2026-11-17', 50, ['ARIA|rebook|TRIP-A1|380']).length === 0 && c.ariaRebookPicks_([F({ total: 350 })], reqs, '2026-11-18', '2026-11-17', 50, ['ARIA|rebook|TRIP-A1|380']).length === 1);
  check('…the fare per person when there is no true total', c.ariaRebookPicks_([F({ total: null, farePP: 300 })], reqs, '2026-11-18', '2026-11-17', 50, [])[0].now === 300);
  const b = c.ariaRebookBlocks_(picks[0], 1, 3);
  check('the post: ARIA, until the depart date, the saving each and in all, route, airline, the rules line', /\*ARIA\*  ·  ⏳ until 2027-04-02  ·  Price drop after booking/.test(b[0].elements[0].text)
    && /\*Lisbon spring · now \$380 pp, you paid \$450 pp\*\nSave about \$70 each, \$140 for 2\. IAD-LIS · TAP · nonstop\.\nCheck your airline’s change or credit rules before you rebook\./.test(b[1].text.text), b[1].text.text);
  check('…an Open link, and "act-now 1 of 3 today"', b[2].elements[0].url === 'https://fares.example.test/a1' && /ARIA · act-now 1 of 3 today/.test(b[3].elements[0].text));
}

console.log('\nPosting');
{
  const reqs = [{ kind: 'watch', status: 'booked', tripId: 'TRIP-A1', label: 'Lisbon spring', paidPP: 450, repriceUntil: '2027-04-02', travelers: 2 }];
  const fares = [{ role: 'rebook', tripId: 'TRIP-A1', dateSeen: '2026-11-18', total: 380, link: 'https://fares.example.test/a1' }];
  const now = new Date('2026-11-18T15:00:00Z');
  const c = ctx();
  check('posts to #vera-act-now once', c.ariaPostPriceDrops_(fares, reqs, now) === 1 && c.sent[0].ch === 'C0ACTNOW1' && c.ariaPostPriceDrops_(fares, reqs, now) === 0 && c.sent.length === 1);
  const d = ctx({ cfg: { aria_rebook_min_saving: '100' } });
  check('the minimum is a setting', d.ariaPostPriceDrops_(fares, reqs, now) === 0);
  const off = ctx({ delivery: 'off' });
  check('Off sends nothing', off.ariaPostPriceDrops_(fares, reqs, now) === 0 && off.sent.length === 0);
  const capped = ctx({ allowed: false });
  check('past ARIA’s cap it waits for the morning email', capped.ariaPostPriceDrops_(fares, reqs, now) === 0 && capped.held.length === 1 && /Lisbon spring: now \$380 pp, you paid \$450 pp/.test(capped.held[0][1]));
  const away = ctx({ away: true });
  check('Away mode can hold it', away.ariaPostPriceDrops_(fares, reqs, now) === 0 && away.sent.length === 0);
}

console.log('\nWiring');
{
  check('the ARIA sync writes what was paid, then posts drops', /try \{ ariaSyncPaid_\(\); \}/.test(ARIA) && /try \{ ariaPostPriceDrops_\(t\.fares, ariaReadRequests_\(\), new Date\(\)\); \}/.test(ARIA));
  const sync = ARIA.slice(ARIA.indexOf('function ariaSyncPaid_'), ARIA.indexOf('function ariaRebookPicks_'));
  check('…only on booked trips that haven’t left, only in VERA’s own tab', /r\.status !== 'booked'/.test(sync) && /t\.startDate < today/.test(sync) && /ariaRequestsSheet_\(\)/.test(sync) && !/openById/.test(sync));
  check('a registry row in Act now, and the minimum as a Config row', /key: 'aria_price_drop',[^\n]*category: 'Act now'/.test(CODE) && /\['aria_rebook_min_saving', +'50'\]/.test(CODE));
  check('ARIA’s side is written down to paste', /Role = `rebook`/.test(read('docs/guides/aria-rebook-check.md')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
