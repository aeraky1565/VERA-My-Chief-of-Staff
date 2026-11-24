// Practice logs from language apps (#259): PracticeLogs.js, read nightly into Life › Growth.
// Invented sheet ids and goals throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PL = read('PracticeLogs.js'), LIFE = read('Life.js'), NR = read('NightlyRunner.js'), SET = read('Settings.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

function ctx(opts) {
  opts = opts || {};
  const c = { JSON, Math, Number, String, Object, Array, Date, isNaN, logs: [], practice: [], store: Object.assign({}, opts.store || {}), opened: [] };
  c.Logger = { log: m => c.logs.push(String(m)) };
  c.veraSetting_ = k => k === 'PRACTICE_LOGS' ? (opts.config == null ? '' : opts.config) : '';
  c.veraStoreGet_ = k => c.store[k] == null ? null : c.store[k];
  c.veraStoreSet_ = (k, v) => { c.store[k] = v; return true; };
  c.lfToday_ = () => opts.today || '2026-11-24';
  c.lfLocked_ = fn => fn();
  c.lgLogPractice_ = (goal, day, minutes, note) => { if (opts.goneGoal === goal) return { ok: false, error: 'That goal is gone' }; c.practice.push([goal, day, minutes, note]); return { ok: true }; };
  c.SpreadsheetApp = { openById: id => { c.opened.push(id); const book = (opts.sheets || {})[id]; if (!book) throw new Error('no access ' + id);
    return { getSheetByName: n => book[n] ? { getDataRange: () => ({ getValues: () => book[n] }) } : null }; } };
  vm.createContext(c);
  vm.runInContext(fnSrc(LIFE, 'lfStr_') + '\n' + fnSrc(LIFE, 'lfYmd_') + '\n' + PL, c);
  return c;
}
const HDR = ['date', 'language', 'minutes', 'sessions', 'new_items', 'reviewed', 'theme', 'note', 'updated_at'];
const FR = 'SHEET-FR-INVENTED', DE = 'SHEET-DE-INVENTED';

console.log('the pure parts');
{
  const c = ctx();
  check('sources: a JSON list → sheet, tab (Practice by default), goal', J(c.plSources_('[{"sheet":"' + FR + '","goal":"GOAL-A"},{"sheet":"' + DE + '","tab":"Log","goal":"GOAL-B"}]')) === J([{ sheet: FR, tab: 'Practice', goal: 'GOAL-A' }, { sheet: DE, tab: 'Log', goal: 'GOAL-B' }]));
  check('…an item without a sheet or a goal is dropped', J(c.plSources_('[{"sheet":"' + FR + '"},{"goal":"GOAL-A"},{"sheet":"x","goal":"G"}]')) === J([{ sheet: 'x', tab: 'Practice', goal: 'G' }]));
  check('…bad JSON, an object or blank gives none', J(c.plSources_('[oops')) === '[]' && J(c.plSources_('{"sheet":"x"}')) === '[]' && J(c.plSources_('')) === '[]');
  const rows = c.plRows_([HDR,
    ['2026-11-23', 'fr', 12, 1, 3, 5, 'Au marché', 'les poireaux', 'x'],
    [new Date(2026, 10, 24), 'fr', 7, 2, 2, 0, 'Les soldes', 'dépensier', 'x'],
    ['', 'fr', 9], ['not a date', 'fr', 9], ['2026-11-22', 'fr', 'abc', 0, 0, 0, '', '', '']]);
  check('rows: one per date, oldest first, a Date cell read as its day, theme · note as the note', J(rows) === J([{ date: '2026-11-22', minutes: 0, note: '' }, { date: '2026-11-23', minutes: 12, note: 'Au marché · les poireaux' }, { date: '2026-11-24', minutes: 7, note: 'Les soldes · dépensier' }]), J(rows));
  check('…two rows on one date add up, keeping the first note', J(c.plRows_([['Date', 'Minutes', 'Theme'], ['2026-11-24', 5, 'A'], ['2026-11-24', 4, 'B']])) === J([{ date: '2026-11-24', minutes: 9, note: 'A' }]));
  check('…no date column, or no rows, gives nothing', J(c.plRows_([['day', 'minutes'], ['2026-11-24', 5]])) === '[]' && J(c.plRows_([HDR])) === '[]' && J(c.plRows_(null)) === '[]');
  const r = [{ date: '2026-11-10', minutes: 9, note: 'old' }, { date: '2026-11-20', minutes: 6, note: 'n1' }, { date: '2026-11-24', minutes: 10, note: 'n2' }];
  check('to send: nothing synced → every day since the window start, with minutes and note', J(c.plToSend_(r, {}, FR, '2026-11-17')) === J([{ date: '2026-11-20', minutes: 6, note: 'n1', key: FR + '|2026-11-20', total: 6 }, { date: '2026-11-24', minutes: 10, note: 'n2', key: FR + '|2026-11-24', total: 10 }]));
  const s = {}; s[FR + '|2026-11-20'] = 6; s[FR + '|2026-11-24'] = 6;
  check('…a day whose minutes went from 6 to 10 sends only 4, with no note; an unchanged day sends nothing', J(c.plToSend_(r, s, FR, '2026-11-17')) === J([{ date: '2026-11-24', minutes: 4, note: '', key: FR + '|2026-11-24', total: 10 }]));
  const s2 = {}; s2[FR + '|2026-11-24'] = 12;
  check('…minutes that went down send nothing', J(c.plToSend_([{ date: '2026-11-24', minutes: 10, note: '' }], s2, FR, '2026-11-17')) === '[]');
  const p = {}; p[FR + '|2026-09-01'] = 3; p[FR + '|2026-10-01'] = 4; p[DE + '|2026-11-01'] = 5;
  check('prune: days before the keep window go', J(Object.keys(c.plPrune_(p, '2026-09-25')).sort()) === J([FR + '|2026-10-01', DE + '|2026-11-01'].sort()));
  check('shift: across a month end and a leap day', c.plShift_('2026-03-01', -1) === '2026-02-28' && c.plShift_('2028-03-01', -1) === '2028-02-29' && c.plShift_('2026-11-24', -7) === '2026-11-17');
}

console.log('\nthe nightly read');
{
  const cfg = J([{ sheet: FR, tab: 'Practice', goal: 'GOAL-FR' }, { sheet: DE, goal: 'GOAL-DE' }]);
  const sheets = {}; sheets[FR] = { Practice: [HDR, ['2026-11-10', 'fr', 20, 1, 0, 0, 'Too old', '', ''], ['2026-11-23', 'fr', 12, 1, 3, 5, 'Au marché', 'les poireaux', ''], ['2026-11-24', 'fr', 7, 2, 2, 0, 'Les soldes', 'dépensier', '']] };
  const c = ctx({ config: cfg, sheets });
  let r1; try { r1 = c.plNightly_(); } catch (e) { r1 = { error: e.message }; }
  check('it logs each new day in the window on its goal, with its minutes and note', J(c.practice) === J([['GOAL-FR', '2026-11-23', 12, 'Au marché · les poireaux'], ['GOAL-FR', '2026-11-24', 7, 'Les soldes · dépensier']]), J(c.practice));
  check('…a log it can\'t open is skipped and counted, and the others still run', r1.logged === 2 && r1.failed === 1 && r1.ok === false && c.opened.indexOf(DE) !== -1);
  check('…what was sent is remembered in the VERA State tab', J(JSON.parse(c.store.PRACTICE_LOG_SYNCED || 'null')) === J({ [FR + '|2026-11-23']: 12, [FR + '|2026-11-24']: 7 }));
  check('…the log lines name the tab and counts, never a value', c.logs.some(l => /could not read the Practice tab of a practice log/.test(l)) && c.logs.some(l => /2 log\(s\), 2 day\(s\) logged, 1 unreadable/.test(l)) && !c.logs.some(l => /poireaux|soldes|SHEET-/.test(l)), J(c.logs));
  c.practice.length = 0;
  try { c.plNightly_(); } catch (e) {}
  check('a second run logs nothing', c.practice.length === 0);
  sheets[FR].Practice[3][2] = 15;
  try { c.plNightly_(); } catch (e) {}
  check('…and after more practice that day, only the difference', J(c.practice) === J([['GOAL-FR', '2026-11-24', 8, '']]) && (JSON.parse(c.store.PRACTICE_LOG_SYNCED || '{}') || {})[FR + '|2026-11-24'] === 15, J(c.practice));
}
{
  const store = { PRACTICE_LOG_SYNCED: J({ [FR + '|2026-08-01']: 5 }) };
  const sheets = {}; sheets[FR] = { Practice: [HDR, ['2026-11-24', 'fr', 7]] };
  const c = ctx({ config: J([{ sheet: FR, goal: 'GOAL-GONE' }]), sheets, store, goneGoal: 'GOAL-GONE' });
  try { c.plNightly_(); } catch (e) {}
  const kept = JSON.parse(c.store.PRACTICE_LOG_SYNCED || '{"none":1}');
  check('a day the goal refused isn\'t marked sent (so it\'s tried again), and old days are pruned', !('none' in kept) && !(FR + '|2026-11-24' in kept) && !(FR + '|2026-08-01' in kept) && c.logs.some(l => /GOAL-GONE 2026-11-24: That goal is gone/.test(l)));
}
{
  const c = ctx({ config: '' });
  const r = c.plNightly_();
  check('with no practice_logs in Config, nothing is read or written', r.sources === 0 && c.opened.length === 0 && !('PRACTICE_LOG_SYNCED' in c.store));
}

console.log('\nwiring');
check('the nightly step runs right after the Growth step', /S\('lgNightly_', 3, function\(\) \{ lgNightly_\(\); \}\),\n\s*S\('plNightly_', 3, function\(\) \{ plNightly_\(\); \}\)/.test(NR));
check('the synced key is a known VERA State key', /var VERA_STORE_KEYS_\s*=\s*\[[^\]]*'PRACTICE_LOG_SYNCED'/.test(SET));
check('nothing is written to an app\'s Sheet', !/openById\([^)]*\)[^;]*\.(setValue|setValues|appendRow|clear|deleteRow)/.test(PL));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
