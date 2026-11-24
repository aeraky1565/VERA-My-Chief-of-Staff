// Tech gear in Warranties & Service (TechGear.js). Pins:
//  - a Tech category (any case; Laptop, Tablet, Phone, Watch, Computer…) marks a tech item;
//  - the seven tech columns go after Manual, named on first use; an old row reads blank;
//  - the read adds them plus isTech, supportDays, planDays; add and edit write them;
//  - text can't start like a formula; dates must be dates;
//  - the support lookup: Claude stubbed, a month becomes its last day, no date says so;
//  - the nightly flags: plan 30 d, support 90 d, trade-in 91–180 d before support ends,
//    only for tech, closing once past; wired in the night's list, the flag kinds and Features.
// Invented devices.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TG = read('TechGear.js'), HS = read('HomeSteward.js'), WEB = read('WebApp.js'), NR = read('NightlyRunner.js'), FT = read('FlagsTasks.js'), FE = read('Features.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 10;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (grid[r - 1] || [])[c - 1] ?? '',
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push(pad([])); grid[r - 1 + i][c - 1 + j] = x; })),
      setValue: x => { grid[r - 1][c - 1] = x; },
    }) };
}
const HEAD = ['Item', 'Category', 'Purchase Date', 'Warranty Expiry', 'Last Service', 'Next Service', 'Interval (mo)', 'Notes'];
function ctx(home, extra) {
  const sheets = { 'Home Items': home, Flags: {} };
  const c = Object.assign({ String, Number, Math, JSON, Date, Object, Array, parseInt, isNaN, Logger: { log() {} },
    TABS: { HOME_ITEMS: 'Home Items', FLAGS: 'Flags' }, HOME_ITEM_HEADERS: HEAD,
    Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => 'UTC' },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] }), getSuppressedKeyPatterns_: () => [], getConfigValues: () => ({}),
    __flags: null, upsertKeyedFlags_: (sh, prefix, src, wanted, date) => { c.__flags = { prefix, src, wanted, date }; },
    __prompt: '', callClaudeJsonDetailed_: p => { c.__prompt = p; return c.__reply; }, __reply: { json: null, error: 'no reply' } }, extra || {});
  vm.createContext(c); vm.runInContext(HS + '\n' + TG, c);
  c.Date = class extends Date { constructor(...a) { if (!a.length) super('2026-11-24T12:00:00Z'); else super(...a); } static now() { return Date.parse('2026-11-24T12:00:00Z'); } };
  return c;
}

console.log('\nwhat counts as tech');
{
  const c = ctx(fakeSheet([HEAD]));
  check('Tech in any case, and the device words', ['Tech', 'tech', 'TECH', 'Laptop', 'Tablet', 'Phone', 'Watch', 'Smartwatch', 'Computer', 'Electronics'].every(x => c.tgIsTech_(x)));
  check('…not a fridge, a watch battery’s "Personal", or blank', ['Kitchen', 'Appliance', 'Personal', '', 'Technician visit'].every(x => !c.tgIsTech_(x)));
  check('days between dates', c.tgDays_('2026-12-24', '2026-11-24') === 30 && c.tgDays_('2026-11-20', '2026-11-24') === -4 && c.tgDays_('', '2026-11-24') === null);
}

console.log('\ncolumns, read, add, edit');
{
  const home = fakeSheet([HEAD.concat(['Receipt', 'Manual']), ['Old fridge', 'Kitchen', '2024-01-01', '2026-01-01', '', '', '', '', '', ''],
    ['Tablet A', 'Tech', '2025-03-01', '2026-03-01', '', '', '', '', '', '']], 10);
  const c = ctx(home);
  const f = c.tgFields_(home.grid[1], '2026-11-24');
  check('an old row with no tech columns reads blank', f.owner === '' && f.supportUntil === '' && f.supportDays === null && f.isTech === false, J(f));
  const r = c.webTechItemSave_({ parameter: { row: '3', item: 'Tablet A', owner: 'Sam', model: 'Tab Pro 11', serial: 'SN-ZX81', supportUntil: '2029-10-31', supportSource: 'estimate: about 6 years after release', planName: 'CarePlus', planUntil: '2027-03-01' } });
  check('the seven columns are named after Manual on first use', J(home.grid[0].slice(10, 17)) === J(['Owner', 'Model', 'Serial', 'Support Until', 'Support Source', 'Plan Name', 'Plan Until']), J(home.grid[0]));
  check('…and the tech cells written on that row only', r.ok && J(home.grid[2].slice(10, 17)) === J(['Sam', 'Tab Pro 11', 'SN-ZX81', '2029-10-31', 'estimate: about 6 years after release', 'CarePlus', '2027-03-01']) && home.grid[1].slice(10).every(x => x === ''));
  const g = c.tgFields_(home.grid[2], '2026-11-24');
  check('the read gives isTech, the fields and the days left', g.isTech && g.owner === 'Sam' && g.model === 'Tab Pro 11' && g.supportDays === c.tgDays_('2029-10-31', '2026-11-24') && g.planDays === 97, J(g));
  let threw = ''; try { c.webTechItemSave_({ parameter: { row: '3', item: 'Phone B', owner: 'x' } }); } catch (e) { threw = e.message; }
  check('a stale list can’t write the wrong item', /holds "Tablet A"/.test(threw), threw);
  check('a formula-like value is refused', c.webTechItemSave_({ parameter: { row: '3', item: 'Tablet A', serial: '=IMPORTXML("x")' } }).ok === false && c.webTechItemSave_({ parameter: { row: '3', item: 'Tablet A', model: '@me' } }).ok === false);
  check('…a date must be a date', c.webTechItemSave_({ parameter: { row: '3', item: 'Tablet A', supportUntil: 'soon' } }).ok === false);
  check('…a serial that starts with a digit is fine', c.tgClean_({ serial: '-12AB' }).serial === '-12AB' || c.tgClean_({ serial: '12AB' }).serial === '12AB');
  check('the read reaches the tech columns and adds tgFields_', /Math\.min\(TG_LAST_COL_, sheet\.getMaxColumns\(\)\)/.test(WEB) && /\}, tgFields_\(row, todayIso\)\)\);/.test(WEB));
  check('a new item can bring its tech details', /if \(tgAny_\(p\)\) \{[\s\S]{0,260}tgWrite_\(sheet, sheet\.getLastRow\(\), tech\);/.test(WEB));
  check('the routes are wired', /case 'tech_item_save':\s*return jsonOut_\(webTechItemSave_\(e\)\)/.test(WEB) && /case 'tech_support_lookup':\s*return jsonOut_\(webTechSupportLookup_\(e\)\)/.test(WEB));
}

console.log('\nsupport lookup');
{
  const c = ctx(fakeSheet([HEAD]));
  c.__reply = { json: { date: '2029-10', basis: 'The maker supports tablets about 6 years after release.', confidence: 'medium' } };
  const r = c.webTechSupportLookup_({ parameter: { item: 'Tablet A', model: 'Tab Pro 11' } });
  check('a month becomes its last day, with the basis and confidence', r.ok && r.date === '2029-10-31' && /6 years/.test(r.basis) && r.confidence === 'medium', J(r));
  check('…the prompt names the device and asks for JSON', /Tablet A/.test(c.__prompt) && /Tab Pro 11/.test(c.__prompt) && /JSON only/.test(c.__prompt));
  c.__reply = { json: { date: '', basis: 'unknown' } };
  const n = c.webTechSupportLookup_({ parameter: { model: 'Mystery 9' } });
  check('no date: not ok, and it says to type one', n.ok === false && n.date === '' && /Type one in/.test(n.error));
  c.__reply = { json: null, error: 'API error 529' };
  check('no reply: says so', /didn’t answer \(API error 529\)/.test(c.webTechSupportLookup_({ parameter: { item: 'x' } }).error));
  check('nothing to look up: refused', c.webTechSupportLookup_({ parameter: {} }).ok === false);
  check('an odd confidence reads low', c.tgLookupClean_({ date: '2030-01-15', confidence: 'certain' }).confidence === 'low');
}

console.log('\nnightly flags');
{
  const c = ctx(fakeSheet([HEAD]));
  const T = '2026-11-24';
  const it = (o) => Object.assign({ isTech: true, item: 'Laptop C', owner: 'Sam', planUntil: '', supportUntil: '', planName: '', supportSource: '' }, o);
  const w1 = c.tgFlagsWanted_([it({ planUntil: '2026-12-14', planName: 'CarePlus' })], T);
  check('plan ending within 30 days: one flag, Medium', J(Object.keys(w1)) === J(['TECH|plan|laptop_c']) && w1['TECH|plan|laptop_c'].urgency === 'Medium' && /CarePlus ends in 20 days/.test(w1['TECH|plan|laptop_c'].flag), J(w1));
  check('…High in the last week', c.tgFlagsWanted_([it({ planUntil: '2026-11-28' })], T)['TECH|plan|laptop_c'].urgency === 'High');
  check('…none 31 days out, or once it has passed', !Object.keys(c.tgFlagsWanted_([it({ planUntil: '2026-12-25' })], T)).length && !Object.keys(c.tgFlagsWanted_([it({ planUntil: '2026-11-20' })], T)).length);
  const w2 = c.tgFlagsWanted_([it({ supportUntil: '2027-02-01' })], T);
  check('support ending within 90 days: a Low flag naming the replacement', w2['TECH|support|laptop_c'] && w2['TECH|support|laptop_c'].urgency === 'Low' && /Planned Purchases/.test(w2['TECH|support|laptop_c'].reason) && !w2['TECH|tradein|laptop_c'], J(w2));
  const w3 = c.tgFlagsWanted_([it({ supportUntil: '2027-04-24' })], T);
  check('91–180 days before support ends: the trade-in flag instead', w3['TECH|tradein|laptop_c'] && !w3['TECH|support|laptop_c'] && /Resell/.test(w3['TECH|tradein|laptop_c'].reason), J(w3));
  check('…nothing further out', !Object.keys(c.tgFlagsWanted_([it({ supportUntil: '2027-06-30' })], T)).length);
  check('only tech items', !Object.keys(c.tgFlagsWanted_([it({ isTech: false, planUntil: '2026-12-01', supportUntil: '2027-01-01' })], T)).length);
  check('the lead times come from Config', Object.keys(c.tgFlagsWanted_([it({ planUntil: '2027-01-20' })], T, { plan: 60, support: 90, tradein: 180 })).length === 1);
  const home = fakeSheet([HEAD.concat(['Receipt', 'Manual', 'Owner', 'Model', 'Serial', 'Support Until', 'Support Source', 'Plan Name', 'Plan Until']),
    ['Phone D', 'Phone', '', '', '', '', '', '', '', '', 'Sam', 'P8', '', '2027-01-15', 'you', '', ''],
    ['Kettle', 'Kitchen', '', '', '', '', '', '', '', '', '', '', '', '2027-01-15', '', '', '']], 17);
  const c2 = ctx(home);
  const r = c2.checkTechGear_();
  check('checkTechGear_ upserts TECH| flags for the tech rows only', c2.__flags.prefix === 'TECH|' && c2.__flags.src === 'Tech gear' && J(Object.keys(c2.__flags.wanted)) === J(['TECH|support|phone_d']) && r.tech === 1, J(c2.__flags));
  check('wired: in the night’s list after the home service step', /S\('checkHomeServiceOverdue_', 3, function\(\) \{ checkHomeServiceOverdue_\(\); \}\),\n\s*S\('checkTechGear_', 3, function\(\) \{ checkTechGear_\(\); \}\),/.test(NR));
  check('…a known flag kind that clears itself', /prefix: 'TECH\|'/.test(FT));
  check('…and a Features row with the three lead times', /k: 'tech_gear'[\s\S]{0,500}steps: \['checkTechGear_'\][\s\S]{0,300}tech_plan_days_ahead[\s\S]{0,200}tech_support_days_ahead[\s\S]{0,200}tech_tradein_days_ahead/.test(FE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
