// #258 Quiet flags (FlagQuiet.js): a resolved topic stays quiet until its date passes,
// a muted one for good; Claude's repeats under a new name are held back and listed;
// an automatic flag resolved by hand isn't reopened while quiet. Invented flags.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const SRC = read('FlagQuiet.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), NR = read('NightlyRunner.js'), CL = read('Claude.js'), FT = read('FlagsTasks.js');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
}
const FLAG_HEADERS = JSON.parse(CODE.match(/const FLAG_HEADERS\s*=\s*(\[[^\]]*\]);/)[1].replace(/'/g, '"'));
const TODAY = '2027-03-10';
process.on('uncaughtException', e => { console.log('  FAIL crashed: ' + (e && e.message)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });

function sheet(header, rows) {
  const all = [header.slice()].concat((rows || []).map(r => r.slice()));
  return { _all: all,
    getLastRow: () => all.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = all[r - 1 + i] || []; const o = []; for (let k = 0; k < (nc || 1); k++) o.push(row[c - 1 + k] === undefined ? '' : row[c - 1 + k]); out.push(o); } return out; },
      getValue: () => (all[r - 1] || [])[c - 1] || '',
      setValue: v => { while (all.length < r) all.push([]); all[r - 1][c - 1] = v; },
    }),
    deleteRow: r => { all.splice(r - 1, 1); },
    appendRow: row => { all.push(row.slice()); } };
}
const flagRow = o => [o.id, o.date || '2027-03-01', o.source || 'General', o.flag || 'A flag', o.reason || '', o.urgency || 'Low', 'No', '', o.resolved || 'No', o.key || '', '', o.due || ''];

function ctx(flags) {
  const store = {}, sheets = { Flags: sheet(FLAG_HEADERS, flags || []) };
  const c = { Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => d instanceof Date && !isNaN(d) ? TODAY : TODAY },
    TABS: { FLAGS: 'Flags' }, FLAG_HEADERS,
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, name, headers) => sheets[name] || (sheets[name] = sheet(headers, [])),
    veraStoreGet_: k => store[k] || null, veraStoreSet_: (k, v) => { store[k] = v; return true; },
    recordFlagOutcome_: () => {}, colorCodeFlags: () => {}, flagDueHeader_: () => {},
    _sheets: sheets, _store: store };
  vm.createContext(c);
  vm.runInContext(SRC, c);
  vm.runInContext(FT.match(/var AUTO_FLAG_KINDS_[\s\S]*?\n\];/)[0] + fn(FT, 'flagAutoOf_'), c);
  ['flagDueCell_', 'upsertKeyedFlags_', 'writeFlags', 'getExistingFlagFingerprints_', 'makeFlagFingerprint_', 'keysAreSimilar_'].forEach(n => vm.runInContext(fn(CODE, n), c));
  ['findFlagRow_', 'webResolve_'].forEach(n => vm.runInContext(fn(WEB, n), c));
  return c;
}

// A history in which "friendsgiving" and "costco" are rare and "amex" is everywhere.
const HIST = [];
for (let i = 0; i < 40; i++) HIST.push(flagRow({ id: 'H' + i, flag: 'AMEX perk expiring: Uber Cash', reason: 'AMEX monthly credit resets soon', key: 'perk_expiry_CP-' + i }));
const FG1 = flagRow({ id: 'F1', date: '2027-03-05', flag: 'Friendsgiving Saturday — confirm contribution or dish', reason: 'Friendsgiving is in 7 days (Mar 13) and no prep task exists.', key: 'friendsgiving_prep' });

console.log('\nTopic words');
{
  const c = ctx();
  check('words: lower-case, 4+ letters, everyday ones and possessives dropped', J(c.fqTokens_("Jordan’s Friendsgiving dish — confirm it TODAY")) === '["jordan","friendsgiving","dish"]', J(c.fqTokens_("Jordan’s Friendsgiving dish — confirm it TODAY")));
  const rows = HIST.concat([FG1]);
  const df = c.fqDocFreq_(rows.map(r => [r[3], r[4]]));
  check('how many flags each word is in', df.uber === 40 && df.friendsgiving === 1, J({ uber: df.uber, fg: df.friendsgiving }));
  check('a word in at most 3% of flags (3 at least) tells a topic apart', c.fqRareMax_(41) === 3 && c.fqRareMax_(500) === 15);
  const t = c.fqTopic_('Uber Friendsgiving dish', 'bring the dish to Friendsgiving', df, rows.length);
  check('a topic keeps the rare words, not the common ones', t.title.indexOf('friendsgiving') !== -1 && t.title.indexOf('uber') === -1, J(t));
}

console.log('\nSame topic');
{
  const c = ctx();
  const rows = HIST.concat([FG1]);
  const df = c.fqDocFreq_(rows.map(r => [r[3], r[4]])), n = rows.length;
  const T = (a, b) => c.fqTopic_(a, b, df, n);
  const fg1 = T(FG1[3], FG1[4]);
  check('Friendsgiving under a new name is the same topic', c.fqSame_(T('Friendsgiving dish — confirm contribution today', 'Friendsgiving is in 3 days and the dish is unconfirmed.'), fg1));
  check('…and again', c.fqSame_(T('Confirm Friendsgiving dish by tomorrow', 'The task to confirm your contribution is still open.'), fg1));
  check('one shared place name alone isn’t enough', !c.fqSame_(T('Florida trip in 11 days — itinerary thin', 'Only one item so far.'), T('IHG points expiring — use before Florida trip', 'Twenty thousand points lapse.')));
  check('everyday words alone don’t make a topic', !c.fqSame_(T('AMEX perk expiring soon', 'AMEX credit resets'), T('AMEX Gold renewal decision', 'AMEX annual fee')));
  check('two shared words only in the reasons don’t', !c.fqSame_(T('Water the plants', 'Humidifier and recycling are due too.'), T('Pay the electric bill', 'Humidifier and recycling were mentioned.')));
  check('three shared words, one in a title, do', c.fqSame_(T('Chores while away — delegate', 'Humidifier, plants and recycling are due on the cruise.'), T('Chores will lapse during the cruise', 'Humidifier, plants and recycling all fall during it.')));
}

console.log('\nHow long it stays quiet');
{
  const c = ctx();
  check('its Due, when it has one', c.fqUntil_({ flag: 'Pay the water bill', reason: '', due: '2027-03-20' }, TODAY) === '2027-03-20');
  check('…else the latest date its words name', c.fqUntil_({ flag: 'Friendsgiving Saturday', reason: 'It is on Mar 13; shopping by Mar 12.' }, TODAY) === '2027-03-13');
  check('…an ISO date counts', c.fqUntil_({ flag: 'Call the dentist', reason: 'Due 2027-03-18.' }, TODAY) === '2027-03-18');
  check('…a date over 30 days out isn’t the flag’s own', c.fqUntil_({ flag: 'Points expire', reason: 'They lapse on Jun 30.' }, TODAY) === '2027-03-17');
  check('…else 7 days', c.fqUntil_({ flag: 'Goal stalling', reason: 'No task.' }, TODAY) === '2027-03-17');
  check('a past date doesn’t count', c.fqUntil_({ flag: 'It was Mar 2', reason: '' }, TODAY) === '2027-03-17');
  check('a month early in the year rolls to next year when this one is long gone', J(c.fqDatesIn_('on Jan 4', '2027-11-20')) === '["2028-01-04"]', J(c.fqDatesIn_('on Jan 4', '2027-11-20')));
  check('quiet in force through its last day; muted always', c.fqActive_({ until: TODAY }, TODAY) && !c.fqActive_({ until: '2027-03-09' }, TODAY) && c.fqActive_({ until: 'never' }, TODAY));
}

console.log('\nHolding back');
{
  const c = ctx();
  const rows = HIST.concat([FG1]);
  const df = c.fqDocFreq_(rows.map(r => [r[3], r[4]])), n = rows.length;
  const quiet = [{ id: 'F1', key: 'friendsgiving_prep', title: FG1[3], topic: c.fqTopic_(FG1[3], FG1[4], df, n), until: '2027-03-13', kind: 'resolved', since: '2027-03-06' }];
  const cand = { source: 'Tasks', flag: 'Confirm Friendsgiving dish by tomorrow', reason: 'Friendsgiving contribution still open.', urgency: 'High', key: 'friendsgiving_dish_confirm' };
  let out = c.fqHoldBack_([cand], { open: [], quiet, df, n, today: TODAY });
  check('a repeat of a resolved, quiet topic is held back, saying why', out.keep.length === 0 && /resolved 2027-03-06 · quiet until 2027-03-13/.test(out.held[0].why), J(out));
  out = c.fqHoldBack_([cand], { open: [], quiet, df, n, today: '2027-03-14' });
  check('…not once its date has passed', out.keep.length === 1 && !out.held.length);
  out = c.fqHoldBack_([Object.assign({}, cand, { changed: 'the date moved to Sunday' })], { open: [], quiet, df, n, today: TODAY });
  check('one that says what changed comes back, saying so', out.keep.length === 1 && /^What changed: the date moved to Sunday\. /.test(out.keep[0].reason), J(out.keep));
  const muted = [Object.assign({}, quiet[0], { kind: 'muted', until: 'never' })];
  out = c.fqHoldBack_([Object.assign({}, cand, { changed: 'new' })], { open: [], quiet: muted, df, n, today: '2028-01-01' });
  check('a muted topic stays quiet, changed or not, for good', out.keep.length === 0 && /You muted this topic/.test(out.held[0].why));
  out = c.fqHoldBack_([cand], { open: [{ flag: FG1[3], reason: FG1[4], date: '2027-03-05', auto: false }], quiet: [], df, n, today: TODAY });
  check('a repeat of a flag still open is held', out.keep.length === 0 && /still open since 2027-03-05/.test(out.held[0].why));
  out = c.fqHoldBack_([{ flag: 'Use the Dunkin credit today', reason: 'The Dunkin credit lapses tonight.' }], { open: [{ flag: 'Perk expiring: Dunkin credit', reason: 'Dunkin credit lapses.', auto: true }], quiet: [], df, n, today: TODAY });
  check('…and one VERA’s own check has open says so', /VERA’s own check already has this open/.test((out.held[0] || {}).why || ''), J(out));
  out = c.fqHoldBack_([cand, Object.assign({}, cand, { key: 'friendsgiving_other', flag: 'Friendsgiving dish needs confirming' })], { open: [], quiet: [], df, n, today: TODAY });
  check('one per topic in a night', out.keep.length === 1 && out.held.length === 1);
  out = c.fqHoldBack_([{ flag: 'Call Costco about contacts', reason: 'Costco order pending.' }], { open: [], quiet, df, n, today: TODAY });
  check('another topic goes through', out.keep.length === 1);
}

console.log('\nThe prompt');
{
  const c = ctx();
  const rows = [FG1.map((v, i) => i === 8 ? 'Yes' : v), flagRow({ id: 'F2', date: '2027-03-08', flag: 'Call Costco about contacts', key: 'costco_contacts' }),
    flagRow({ id: 'F3', date: '2027-01-01', flag: 'Old one', key: 'old_one' }), flagRow({ id: 'F4', date: '2027-03-08', flag: 'Use soon: bread', key: 'ONHAND|OH-1' })];
  const txt = c.fqPromptSection_(rows, [{ key: 'friendsgiving_prep', title: FG1[3], until: '2027-03-13', kind: 'resolved' }, { key: 'muted_thing', title: 'A muted thing', until: 'never', kind: 'muted' }], TODAY);
  check('lists the last 3 weeks with what was done: resolved and quiet, open', /friendsgiving_prep · "Friendsgiving Saturday[^\n]*" · resolved, quiet until 2027-03-13/.test(txt) && /costco_contacts · "Call Costco about contacts" · open/.test(txt), txt);
  check('…not older ones, nor VERA’s own checks', !/old_one/.test(txt) && !/ONHAND/.test(txt));
  check('…and muted topics, whenever they were', /muted_thing · "A muted thing" · MUTED/.test(txt));
  check('the rules: reuse the key; leave resolved, muted and open topics; say what changed; leave VERA’s own checks', /reuse its key exactly/.test(txt) && /Do NOT raise a topic that is resolved and quiet, or MUTED, or still open/.test(txt) && /"changed"/.test(txt) && /card perks/.test(txt));
  check('the nightly prompt carries it, and asks for "changed"', /fqPromptBlock_\(\)/.test(CL) && /"changed" — OPTIONAL/.test(CL) && /changed: String\(f\.changed/.test(CL));
}

console.log('\nResolve, mute, unmute');
{
  const c = ctx(HIST.concat([FG1, flagRow({ id: 'A1', flag: 'Use soon: bread', key: 'ONHAND|OH-1' })]));
  const r = c.webResolve_('F1');
  const q = c._sheets['Flag Quiet']._all;
  check('Resolve says how long it stays quiet, and remembers the topic', r.ok && r.quietUntil === '2027-03-13' && q.length === 2 && q[1][1] === 'friendsgiving_prep' && q[1][6] === 'resolved' && /friendsgiving/.test(q[1][3]), J({ r, q }));
  c.webResolve_('F1');
  check('…once per flag', c._sheets['Flag Quiet']._all.length === 2);
  const m = c.webFlagMute_('F1');
  const q2 = c._sheets['Flag Quiet']._all;
  check('mute: resolved, never again', m.ok && q2.length === 2 && q2[1][5] === 'never' && q2[1][6] === 'muted');
  const view = c.webFlagsQuiet_();
  check('the list: muted topics, with their words', view.ok && view.muted.length === 1 && view.muted[0].id === 'F1' && view.muted[0].words.indexOf('friendsgiving') !== -1, J(view));
  check('unmute', c.webFlagUnmute_('F1').ok && c._sheets['Flag Quiet']._all.length === 1 && c.webFlagUnmute_('F1').ok === false);
  const a = c.webResolve_('A1');
  check('an automatic flag resolves too', a.ok && c._sheets.Flags._all[c._sheets.Flags._all.length - 1][8] === 'Yes');
}

console.log('\nAutomatic flags stay resolved while quiet');
{
  const c = ctx([flagRow({ id: 'A1', flag: 'Use soon: bread', key: 'ONHAND|OH-1' })]);
  c.webResolve_('A1');
  const wanted = { 'ONHAND|OH-1': { flag: 'Use soon: bread', reason: 'Plan it.', urgency: 'Low' } };
  c.upsertKeyedFlags_(c._sheets.Flags, 'ONHAND|', 'Meal Plan', wanted, TODAY);
  check('its check doesn’t reopen it while quiet', c._sheets.Flags._all[1][8] === 'Yes');
  c.upsertKeyedFlags_(c._sheets.Flags, 'ONHAND|', 'Meal Plan', {}, TODAY);
  check('once its check stops raising it, the quiet ends', c._sheets['Flag Quiet']._all.length === 1);
  c.upsertKeyedFlags_(c._sheets.Flags, 'ONHAND|', 'Meal Plan', wanted, TODAY);
  check('…so when it comes back, it reopens', c._sheets.Flags._all[1][8] === 'No');
  const c2 = ctx([flagRow({ id: 'A1', flag: 'Use soon: bread', key: 'ONHAND|OH-1' })]);
  c2.webFlagMute_('A1');
  c2.upsertKeyedFlags_(c2._sheets.Flags, 'ONHAND|', 'Meal Plan', {}, TODAY);
  c2.upsertKeyedFlags_(c2._sheets.Flags, 'ONHAND|', 'Meal Plan', wanted, TODAY);
  check('a muted one never reopens', c2._sheets.Flags._all[1][8] === 'Yes' && c2._sheets['Flag Quiet']._all.length === 2);
}

console.log('\nThe night');
{
  const c = ctx(HIST.concat([FG1.map((v, i) => i === 8 ? 'Yes' : v)]));
  c.webResolve_('F1');
  const kept = c.flagHoldBackRun_([{ source: 'Tasks', flag: 'Confirm Friendsgiving dish', reason: 'Friendsgiving contribution open.', urgency: 'High', key: 'fg_dish' },
                                   { source: 'Tasks', flag: 'Call Costco about contacts', reason: 'Costco order.', urgency: 'Low', key: 'costco' }]);
  const held = JSON.parse(c._store.FLAGS_HELD);
  check('repeats are held back, the rest kept', kept.length === 1 && kept[0].key === 'costco' && held.items.length === 1 && held.on === TODAY, J({ kept, held }));
  const v = c.webFlagsQuiet_();
  check('the held list is on Flags', v.held.length === 1 && v.held[0].i === 0 && /quiet until/.test(v.held[0].why));
  const raised = c.webFlagRaiseHeld_(0);
  const last = c._sheets.Flags._all[c._sheets.Flags._all.length - 1];
  check('Raise it writes it after all, and takes it off the list', raised.ok && last[9] === 'fg_dish' && JSON.parse(c._store.FLAGS_HELD).items.length === 0, J(raised));
  check('a raised flag isn’t blocked by the similar-key check', /if \(flag\.key && !flag\.changed && keysAreSimilar_/.test(CODE));
  check('the nightly step holds back before writing', /flagHoldBackRun_\(flags\)[\s\S]{0,120}writeFlags\(flags\)/.test(NR));
  check('routes', /case 'flags_quiet':\s+return jsonOut_\(webFlagsQuiet_\(\)\)/.test(WEB) && /case 'flag_mute':/.test(WEB) && /case 'flag_unmute':/.test(WEB) && /case 'flag_raise_held':/.test(WEB));
  const bad = ctx(); bad.fqFlagRows_ = () => { throw new Error('sheet down'); };
  check('if anything fails, every flag is written', bad.flagHoldBackRun_([{ flag: 'x' }]).length === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
