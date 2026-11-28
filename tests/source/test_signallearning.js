// Signal Learning (SignalLearning.js, #260): VERA learns from what you do with its flags. Pins:
//  - patterns add up: dates in any form and trailing ids are stripped, the first two words name the kind;
//  - being ignored teaches: each night raised with nothing done costs points past a grace, an
//    acknowledge or resolve starts the count again, a snooze halves it;
//  - soft quiet: Quiet still raises the flag (not in the hard-suppression list), Kept holds it back
//    from quieting until its date, Yes is honoured;
//  - the regroup merges old rows under today's patterns, dry by default;
//  - What VERA learned: quiet, kept, what you act on most, this week's new quiets;
//  - wiring: routes, the Flags marker, the morning email skips quiet kinds, the weekly line;
//  - the screens: Quieted by VERA in Flags (Keep showing these) and the System › Checks panel.
// Runs in a vm over a fake sheet. Every pattern and count is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SL = read('SignalLearning.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), MEM = read('Memory.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const TODAY = '2026-11-28';

function sheetOf(rows) {
  const data = rows;
  return { data, getLastRow: () => data.length, getLastColumn: () => data[0].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = x.slice(c - 1, c - 1 + (nc || 1)); while (o.length < (nc || 1)) o.push(''); return o; }),
      setValues: vals => vals.forEach((v, i) => { data[r - 1 + i] = data[r - 1 + i] || []; v.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }),
      setValue: v => { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; },
      getValue: () => (data[r - 1] || [])[c - 1],
      clearContent: () => { for (let i = 0; i < (nr || 1); i++) data[r - 1 + i] = []; }, setBackground() { return this; } }),
    appendRow: v => data.push(v.slice()), deleteRows: (a, n) => data.splice(a - 1, n), setFrozenRows() {} };
}
function ctx(rows) {
  const c = { String, Number, Math, JSON, Date, Object, Array, isNaN, parseInt, parseFloat, RegExp, Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: (d, tz, f) => (d instanceof Date && d.getTime() > Date.parse('2027-01-01')) ? d.toISOString().slice(0, 10) : TODAY } };
  vm.createContext(c); vm.runInContext(SL, c);
  c.veraLocked_ = fn => fn();
  const H = c.SIGNAL_LEARNING_HEADERS;
  c.sheet = sheetOf([H.slice()].concat(rows || []));
  c.ensureSignalLearningTab_ = () => c.sheet;
  c.getSpreadsheet = () => ({ getSheetByName: () => c.sheet });
  return c;
}
const row = (p, seen, ack, snz, res, exp, extra) => [p, seen, ack, snz, res, exp, '2026-11-27', 100, 'No'].concat(extra || []);

console.log('\npatterns add up');
{
  const c = ctx();
  const map = { 'gym_2026_03_22_walk': 'gym', 'gym-2026-03-24-gym-day-a': 'gym', 'verizon_bill_20260315': 'verizon_bill', 'task_neglect_TASK_0012': 'task_neglect',
    'tax_accountant_march_15': 'tax_accountant', 'cd_maturity_decision': 'cd_maturity', 'cd_maturity_action': 'cd_maturity', 'TECH|support|phone_d': 'tech_support', 'pto_burn_behind': 'pto_burn' };
  const bad = Object.keys(map).filter(k => c.extractKeyPattern_(k) !== map[k]).map(k => k + '→' + c.extractKeyPattern_(k));
  check('dates in any form, ids and instances are stripped; the first two words name the kind', !bad.length, bad.join(', '));
  check('an empty key is no pattern', c.extractKeyPattern_('') === '' && c.extractKeyPattern_(null) === '');
}

console.log('\nbeing ignored teaches');
{
  const c = ctx();
  const r = row('pto_burn', 216, 0, 0, 0, 0);
  const s = c.slScore_(r, TODAY);
  check('raised 216 nights, never acted on: drifts to 0 and quiets', s.score === 0 && s.state === 'Quiet' && s.quietSince === TODAY, J(s));
  check('a few nights is within the grace', c.slScore_(row('new_kind', 6, 0, 0, 0, 0, [6]), TODAY).score === 100);
  check('past the grace: 2 points a night', c.slScore_(row('meh', 20, 0, 0, 0, 0, [17]), TODAY).score === 80);
  check('what you act on stays up', c.slScore_(row('cd_maturity', 13, 1, 0, 1, 0, [2]), TODAY).state === 'No');
  check('an old row without the count is estimated from its actions', c.slSinceActed_(row('x', 30, 2, 1, 0, 0)) === 21 && c.slSinceActed_(row('x', 30, 2, 1, 0, 0, [4])) === 4);
  check('Kept until a date: not quieted, even at 0', c.slScore_(row('pto_burn', 216, 0, 0, 0, 0, [216, '', '2027-01-20']), TODAY).state === 'Kept');
  check('…once Kept passes, it can quiet again', c.slScore_(row('pto_burn', 216, 0, 0, 0, 0, [216, '', '2026-11-01']), TODAY).state === 'Quiet');
  check('the old hard Yes is honoured', c.slScore_(['old', 9, 0, 0, 0, 0, '', 100, 'Yes'], TODAY).state === 'Yes');
  check('fewer than 5 sightings never quiets', c.slScore_(row('rare', 4, 0, 4, 0, 0, [4]), TODAY).state === 'No');
}

console.log('\nrecording');
{
  const c = ctx([row('pto_burn', 10, 0, 0, 0, 0, [10])]);
  c.slRecordFlagsGenerated_(['pto_burn_behind_2026_11_28', 'pto_burn_ahead']);
  let r = c.sheet.data[1];
  check('a night raised: seen +1 and since-acted +1, once per pattern', r[1] === 11 && r[9] === 11, J(r));
  c.slRecordFlagOutcome_('pto_burn_behind', 'snoozed');
  r = c.sheet.data[1];
  check('a snooze halves the ignored nights and stamps Last Acted', r[9] === 5 && r[10] === TODAY && r[3] === 1, J(r));
  c.slRecordFlagOutcome_('pto_burn_behind', 'acknowledged');
  check('an acknowledge starts the count again', c.sheet.data[1][9] === 0);
  c.sheet.data[1][9] = 3;
  c.slRecordFlagOutcome_('pto_burn_behind', 'expired');
  check('an expiry isn’t you acting', c.sheet.data[1][9] === 3 && c.sheet.data[1][5] === 1, J(c.sheet.data[1]));
}

console.log('\nsoft quiet');
{
  const c = ctx([row('pto_burn', 216, 0, 0, 0, 0, [216, '', '', '2026-11-20']), row('cd_maturity', 13, 1, 0, 1, 0, [0]), ['old', 9, 0, 0, 0, 0, '', 0, 'Yes']]);
  c.sheet.data[1][8] = 'Quiet'; c.sheet.data[2][8] = 'No';
  check('Quiet patterns are listed', J(c.getQuietPatterns_()) === J(['pto_burn']));
  check('…but aren’t hard-suppressed: every check still raises them', J(c.getSuppressedKeyPatterns_()) === J(['old']));
  check('a key is quiet by its pattern', c.slIsQuietKey_('pto_burn_behind', ['pto_burn']) && !c.slIsQuietKey_('cd_maturity_action', ['pto_burn']));
  const k = c.webSignalKeep_({ parameter: { pattern: 'pto_burn' } });
  check('Keep showing these: Kept for 60 days, count reset', k.ok && k.state === 'Kept' && /^2027-01-2\d$/.test(c.sheet.data[1][11]) && c.sheet.data[1][9] === 0, J(c.sheet.data[1]));
  check('…and it’s no longer quiet', J(c.getQuietPatterns_()) === J([]));
  const a = c.webSignalAuto_({ parameter: { pattern: 'pto_burn' } });
  check('Let VERA decide again clears Kept', a.ok && c.sheet.data[1][11] === '' && a.state !== 'Kept', J(a));
  check('an unknown pattern says so', c.webSignalKeep_({ parameter: { pattern: 'nope' } }).ok === false);
}

console.log('\nthe regroup');
{
  const c = ctx([row('gym_2026_03_22_walk', 0, 0, 0, 3, 0), row('gym_2026_03_23_walk', 0, 0, 0, 1, 0), row('cd_maturity_decision', 6, 1, 0, 0, 0), row('cd_maturity_action', 7, 0, 0, 1, 0), row('pto_burn_behind', 216, 0, 0, 0, 0)]);
  const dry = c.webSignalRegroup_({ parameter: {} });
  check('dry by default: says what merges, writes nothing', dry.dry && dry.before === 5 && dry.after === 3 && c.sheet.data.length === 6 && dry.merges.some(m => m.pattern === 'gym' && m.from.length === 2), J(dry));
  check('…and that the PTO burn-rate flag would quiet', dry.merges.find(m => m.pattern === 'pto_burn').state === 'Quiet');
  const wet = c.webSignalRegroup_({ parameter: { dry: 'false' } });
  const rows = c.sheet.data.slice(1).filter(r => r[0]);
  const cd = rows.find(r => r[0] === 'cd_maturity');
  check('written: one row per pattern, counts added', !wet.dry && rows.length === 3 && cd[1] === 13 && cd[2] === 1 && cd[4] === 1, J(rows));
}

console.log('\nwhat VERA learned');
{
  const c = ctx();
  const rows = [row('pto_burn', 216, 0, 0, 0, 0, [216, '', '', '2026-11-25']), row('cd_maturity', 13, 1, 0, 1, 0, [0, '2026-05-12']), row('wedding_thankyou', 78, 1, 0, 0, 3, [70, '2026-03-02', '2027-01-01'])];
  rows[0][8] = 'Quiet'; rows[2][8] = 'Kept';
  const l = c.slLearned_(rows, TODAY);
  check('quiet, kept and what you act on', l.quiet.length === 1 && l.quiet[0].label === 'PTO burn' && l.kept[0].pattern === 'wedding_thankyou' && l.engaged[0].pattern === 'cd_maturity', J(l));
  check('the reason is plain', /^Raised 216 times; you’ve never acted on it\.$/.test(l.quiet[0].why), l.quiet[0].why);
  check('this week’s new quiets, for the weekly line', l.newThisWeek.length === 1);
}

console.log('\nwiring');
check('routes', /case 'signal_learned':\s*return jsonOut_\(webSignalLearned_\(\)\)/.test(WEB) && /case 'signal_keep':\s*return jsonOut_\(webSignalKeep_\(e\)\)/.test(WEB) && /case 'signal_auto':\s*return jsonOut_\(webSignalAuto_\(e\)\)/.test(WEB) && /case 'signal_regroup':\s*return jsonOut_\(webSignalRegroup_\(e\)\)/.test(WEB));
check('Flags marks quiet kinds', /if \(slIsQuietKey_\(f\.key, quiet\)\) \{ f\.vq = true;/.test(WEB));
check('the morning email skips quiet kinds', /!\(vqPatterns\.length && slIsQuietKey_\(String\(row\[9\] \|\| ''\), vqPatterns\)\)/.test(CODE));
check('the weekly review says what was quieted', /learned\.newThisWeek\.length/.test(MEM) && /learnedLine \? '\\n\\n🧠 ' \+ learnedLine : ''/.test(MEM));
check('System › Checks has the panel', /items:\['test','api_health','agent_health','learned',/.test(APP) && /cur==='learned'&&h\(SysLearned,/.test(APP));

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screens: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const LEARNED = { ok: true, patterns: 40, quiet: [{ pattern: 'pto_burn', label: 'PTO burn', why: 'Raised 216 times; you’ve never acted on it.', quietSince: '2026-11-28', seen: 216 }],
    kept: [{ pattern: 'wedding_thankyou', label: 'Wedding thankyou', keptUntil: '2027-01-27' }], engaged: [{ pattern: 'cd_maturity', label: 'CD maturity', acted: 2 }], newThisWeek: [] };
  const FLAGS = [{ id: 'F1', date: '2026-11-28', source: 'Nightly', flag: 'PTO burn rate behind', reason: 'r', urgency: 'Low', key: 'pto_burn_behind', vq: true, pattern: 'pto_burn' },
    { id: 'F2', date: '2026-11-28', source: 'Nightly', flag: 'CD matures Friday', reason: 'r', urgency: 'High', key: 'cd_maturity_action' }];
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(PAGES, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ learned, flags }) => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'signal_learned') return Promise.resolve(JSON.parse(JSON.stringify(learned))); if (p.action === 'flags_quiet') return Promise.resolve({ ok: true, held: [], muted: [] });
        if (p.action === 'signal_regroup') return Promise.resolve(p.dry === 'false' ? { ok: true, dry: false, before: 400, after: 150, merges: [] } : { ok: true, dry: true, before: 400, after: 150, merges: [{ pattern: 'gym', from: ['gym_2026_03_22_walk', 'gym_2026_03_23_walk', 'gym_2026_03_24_walk'], state: 'No' }, { pattern: 'pto_burn', from: ['pto_burn_behind'], state: 'Quiet' }] });
        return Promise.resolve({ ok: true }); };
      window.apiAction = () => Promise.resolve({ ok: true });
      document.querySelectorAll('.modal-overlay').forEach(n => n.remove()); const root = document.getElementById('root'); if (root) root.style.display = 'none';
      const mk = id => { const d = document.createElement('div'); d.id = id; d.style.padding = '0 16px'; document.body.appendChild(d); return d; };
      ReactDOM.createRoot(mk('fl')).render(React.createElement(FlagsView, { flags, loading: false, filterActive: true, onToggleActive() {}, onAction() {}, busy: false, onGoto() {}, onMakeTask() {}, apiUrl: 'u', apiToken: 't', quietTick: 0 }));
      ReactDOM.createRoot(mk('sl')).render(React.createElement(SysLearned, { apiUrl: 'u', apiToken: 't' }));
    }, { learned: LEARNED, flags: FLAGS });
    await page.waitForTimeout(400);
    const groups = await page.$$eval('#fl .flag-group', ns => ns.length);
    const vq = await page.$eval('#fl .vq', n => n.innerText).catch(() => '');
    check('Flags: the quiet one sits in “Quieted by VERA”, not in the groups', groups >= 1 && /Quieted by VERA/.test(vq) && !(await page.$eval('#fl', n => [...n.querySelectorAll('.flag-group')].some(g => /PTO burn rate behind/.test(g.innerText)))), vq);
    await page.click('#fl .vq summary'); await page.click('#fl .vq-keep'); await page.waitForTimeout(80);
    check('…Keep showing these sends signal_keep for its kind', J((await page.evaluate(() => window.__ev)).filter(e => e.action === 'signal_keep')) === J([{ action: 'signal_keep', pattern: 'pto_burn' }]) && /Shown again/.test(await page.$eval('#fl .vq-keep', n => n.innerText)));
    const sl = await page.$eval('#sl', n => n.innerText).catch(() => '');
    check('What VERA learned: quiet with why, kept, what you act on', /PTO burn/.test(sl) && /never acted on it/.test(sl) && /Wedding thankyou/.test(sl) && /until 2027-01-27/.test(sl) && /CD maturity \(2\)/.test(sl), sl);
    const rgText = await page.$eval('#sl .sl-regroup', n => n.innerText).catch(() => '');
    check('the tidy-up is shown before anything is written: counts, what quiets, examples', /400 old entries → 150 kinds/.test(rgText) && /1 would be quieted/.test(rgText) && /gym ← 3 entries/.test(rgText)
      && !(await page.evaluate(() => window.__ev)).some(e => e.action === 'signal_regroup' && e.dry === 'false'), rgText);
    await page.click('#sl .sl-merge'); await page.waitForTimeout(120);
    check('…Merge writes it', (await page.evaluate(() => window.__ev)).some(e => e.action === 'signal_regroup' && e.dry === 'false'));
    await page.click('#sl .sl-keep'); await page.waitForTimeout(80); await page.click('#sl .sl-auto'); await page.waitForTimeout(80);
    const sent = (await page.evaluate(() => window.__ev)).filter(e => /^signal_(keep|auto)$/.test(e.action) && e.pattern !== undefined).map(e => e.action + ':' + e.pattern);
    check('…its buttons keep or hand back', sent.includes('signal_keep:pto_burn') && sent.includes('signal_auto:wedding_thankyou'), J(sent));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
