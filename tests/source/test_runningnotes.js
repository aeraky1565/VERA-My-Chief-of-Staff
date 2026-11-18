// VERA's running notes leave Script Properties (the editor shows 50; there were 108). Pins:
//  - the rules: every family the code writes is a note; the watchdog's keys, the nightly
//    stamps and the two hot keys stay; secrets and settings are never notes;
//  - the store (Settings.js, against a fake VERA State tab): a note is written to the tab,
//    read back, and only then its old property goes; reads fall back to the old property,
//    so nothing resends before the move; a tab that can't be written keeps the property;
//    a deleted note blanks its row and the next note reuses it; keys come from both homes;
//  - the move: every note moved and read back, an oversized one left with a reason,
//    Slack's trail into its bundle, the watchdog's keys untouched, safe to run twice;
//  - every writer reads and writes through the store, not Script Properties;
//  - the page: the route, the button, the count.
// Invented names and values.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SET = read('Settings.js'), SP = read('ScriptProps.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };

// A fake VERA State tab: rows of [Key, Value, Updated] after a header.
function world(propsIn, opts) {
  const o = opts || {};
  const store = Object.assign({}, propsIn || {});
  const rows = [['Key', 'Value', 'Updated']].concat(o.rows || []);
  const log = [];
  const sheet = {
    getLastRow: () => rows.length, getMaxRows: () => 1000,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const y = x.slice(c - 1, c - 1 + nc); while (y.length < nc) y.push(''); return y; }),
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValues: v => { if (o.readOnly) return; v.forEach((line, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; line.forEach((x, k) => { rows[r - 1 + i][c - 1 + k] = o.mangle ? 'x' : x; }); }); log.push(['row', r]); },
      setNumberFormat: () => {},
    }),
    appendRow: a => { if (o.readOnly) return; rows.push(o.mangle ? [a[0], 'x', a[2]] : a.slice()); log.push(['append', a[0]]); },
    hideSheet: () => {},
  };
  const api = {
    getProperty: k => (k in store ? store[k] : null),
    getProperties: () => Object.assign({}, store),
    setProperty: (k, v) => { log.push(['set', k]); store[k] = String(v); },
    deleteProperty: k => { log.push(['del', k]); delete store[k]; },
  };
  const c = { String, Object, JSON, Array, Date, Math, RegExp, Number, parseInt,
    PropertiesService: { getScriptProperties: () => api },
    Logger: { log: m => log.push(['log', m]) },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    TABS: { VERA_STATE: 'VERA State', CONFIG: 'Config' },
    getSpreadsheet: () => { if (o.noSheet) throw new Error('no sheet'); return { getSheetByName: n => (n === 'VERA State' ? sheet : null) }; },
    ensureSheet: () => sheet,
    peopleOwnerOnly_: () => (o.notOwner ? { ok: false, error: 'Only the owner can do that' } : null),
    getConfigValues: () => ({}),
  };
  vm.createContext(c);
  vm.runInContext(SET, c);
  vm.runInContext(SP, c);
  return { c, store, rows, log };
}
const tabRow = (rows, k) => rows.find(r => r[0] === k);

console.log('\nwhich keys are notes');
{
  const { c } = world();
  const notes = ['PERK_NOTIFY_CP_14_2027_Q1', 'TDB_SENT_20270101_TRIP_0001', 'SCHED_SLACK_F0ABC', 'day_plan_2027-01-02', 'CHAT_HISTORY_dashboard', 'CHAT_HISTORY_slack_U0X',
    'TI_CLIMATE_48.9_2.4', 'PRETRIP_48H_TRIP_0001', 'PRETRIP_NB_TRIP_0001', 'POSTTRIP_NUDGE_TRIP_0001', 'POSTTRIP_RECAP_TRIP_0001', 'POSTTRIP_DEBRIEF_TRIP_0001',
    'ARIA_FLAGS_SYNCED_AT', 'EMAIL_ADMIN_LAST_SCAN', 'ARIA_BOOK_NOW_POSTED', 'CU_DEBRIEFED', 'LF_WEEKEND_WISHES', 'LG_DID_IT_ASKS', 'LG_TIME_SNAPSHOTS', 'SS_STYLE_DONE'];
  const notNotes = ['SYSTEM_HEARTBEATS', 'TRIGGER_REGISTRATIONS', 'WATCHDOG_INCIDENTS', 'WATCHDOG_LAST_SLACK', 'NIGHTLY_STEP', 'MORNING_STEP', 'LAST_NIGHTLY_START',
    'LAST_MORNING_START', 'LAST_NIGHTLY_RUN', 'LAST_NIGHTLY_TAIL_RUN', 'USPS_SCAN_START', 'AVIATIONSTACK_BACKOFF_UNTIL', 'API_HEALTH_STATE',
    'CLAUDE_API_KEY', 'SLACK_BOT_TOKEN', 'VERA_SHEET_ID', 'VERA_DASHBOARD_URL', 'VERA_ONCE_MARKERS', 'VERA_STATE_PACING', 'day_plan_tomorrow', 'SLACK_LAST_POST'];
  check('every family the code writes is a running note', notes.every(k => c.veraIsNote_(k)), J(notes.filter(k => !c.veraIsNote_(k))));
  check('the watchdog’s keys, the nightly stamps, the hot keys, secrets, settings and records are not', notNotes.every(k => !c.veraIsNote_(k)), J(notNotes.filter(k => c.veraIsNote_(k))));
  check('Slack’s trail is a bundle instead', J(c.VERA_STATE_BUNDLES_.SLACK) === J(['SLACK_LAST_INTERACT', 'SLACK_LAST_UPDATE', 'SLACK_LAST_PROCESSED', 'SLACK_LAST_QUEUED', 'SLACK_LAST_POST', 'SLACK_PINNED_MORNING_TS']));
}

console.log('\nthe store');
{
  const { c, store, rows } = world({ TDB_SENT_20270101_X: '2027-01-01T08:00:00Z' });
  check('a note not moved yet is read from its old property (nothing resends before the move)', c.veraNoteGet_('TDB_SENT_20270101_X') === '2027-01-01T08:00:00Z');
  check('…a missing note is null', c.veraNoteGet_('TDB_SENT_20270102_Y') === null);
  check('writing one puts it in the tab, read back, and drops the old property', c.veraNoteSet_('TDB_SENT_20270101_X', 'v2') === true && tabRow(rows, 'TDB_SENT_20270101_X')[1] === 'v2' && !('TDB_SENT_20270101_X' in store));
  check('…and it reads from the tab now', c.veraNoteGet_('TDB_SENT_20270101_X') === 'v2');
  c.veraNoteSet_('CHAT_HISTORY_dashboard', '[1]');
  check('an existing row is updated in place, not appended again', c.veraNoteSet_('CHAT_HISTORY_dashboard', '[1,2]') && rows.filter(r => r[0] === 'CHAT_HISTORY_dashboard').length === 1 && tabRow(rows, 'CHAT_HISTORY_dashboard')[1] === '[1,2]');
  const n = rows.length;
  c.veraNoteDel_('CHAT_HISTORY_dashboard');
  check('deleting one blanks its row', c.veraNoteGet_('CHAT_HISTORY_dashboard') === null && !tabRow(rows, 'CHAT_HISTORY_dashboard'));
  c.veraNoteSet_('SCHED_SLACK_F0NEW', '123');
  check('…and the next new note reuses that row', rows.length === n && tabRow(rows, 'SCHED_SLACK_F0NEW')[1] === '123', rows.length + ' vs ' + n);
  store.PERK_NOTIFY_CP_1_2027_01 = 'x';
  check('the keys come from both homes, filtered', J(c.veraNoteKeys_(/^(SCHED_SLACK_|PERK_NOTIFY_)/).sort()) === J(['PERK_NOTIFY_CP_1_2027_01', 'SCHED_SLACK_F0NEW']));
  check('the props-shaped wrapper does the same', (() => { const p = c.veraNotes_(); p.setProperty('SS_STYLE_DONE', '{}'); return p.getProperty('SS_STYLE_DONE') === '{}' && !('SS_STYLE_DONE' in store); })());
}
{
  const { c, store } = world({}, { noSheet: true });
  check('when the tab can’t be reached, a note stays a Script Property (a sheet hiccup never loses a latch)', c.veraNoteSet_('TDB_SENT_20270101_Z', 's') === false && store.TDB_SENT_20270101_Z === 's' && c.veraNoteGet_('TDB_SENT_20270101_Z') === 's');
  const r = world({}, { mangle: true });
  check('…and when it doesn’t read back right, the property is kept too', r.c.veraNoteSet_('CU_DEBRIEFED', '{"a":1}') === false && r.store.CU_DEBRIEFED === '{"a":1}');
}

console.log('\nthe move');
{
  const big = 'x'.repeat(46000);
  const props = { CLAUDE_API_KEY: 'sk-INVENTED', VERA_SHEET_ID: 'InventedSheet', SYSTEM_HEARTBEATS: '{}', LAST_NIGHTLY_RUN: '2027-01-01', API_HEALTH_STATE: '{}',
    TDB_SENT_20270101_A: '1', PERK_NOTIFY_CP_2_2027_Q1: '2', PRETRIP_48H_TRIP_0001: '3', CHAT_HISTORY_dashboard: '[]', LG_TIME_SNAPSHOTS: big,
    SLACK_LAST_POST: '{"t":1}', SLACK_LAST_INTERACT: 'i', UNKNOWN_THING: 'u' };
  const { c, store, rows, log } = world(props);
  const r = c.webScriptPropsMoveNotes_();
  check('every running note moves, Slack’s trail into its bundle', r.ok && r.moved === 6 && ['TDB_SENT_20270101_A', 'PERK_NOTIFY_CP_2_2027_Q1', 'PRETRIP_48H_TRIP_0001', 'CHAT_HISTORY_dashboard', 'SLACK_LAST_POST', 'SLACK_LAST_INTERACT'].every(k => !(k in store)), J(r));
  check('…each is in the tab with its value, read back before the property went', tabRow(rows, 'PRETRIP_48H_TRIP_0001')[1] === '3' && tabRow(rows, 'CHAT_HISTORY_dashboard')[1] === '[]'
        && log.findIndex(x => x[0] === 'append' && x[1] === 'TDB_SENT_20270101_A') < log.findIndex(x => x[0] === 'del' && x[1] === 'TDB_SENT_20270101_A'));
  check('…Slack’s trail reads back from the bundle', JSON.parse(store.VERA_STATE_SLACK).SLACK_LAST_POST === '{"t":1}');
  check('one too long for a cell is left, with the reason', J(r.kept) === J([{ name: 'LG_TIME_SNAPSHOTS', why: 'too long for one cell' }]) && store.LG_TIME_SNAPSHOTS === big);
  check('secrets, the sheet id, the watchdog’s keys, the nightly stamp and anything unknown are untouched',
        ['CLAUDE_API_KEY', 'VERA_SHEET_ID', 'SYSTEM_HEARTBEATS', 'LAST_NIGHTLY_RUN', 'API_HEALTH_STATE', 'UNKNOWN_THING'].every(k => store[k] === props[k]));
  check('the count before and after', r.before === Object.keys(props).length && r.after === Object.keys(store).length, r.before + ' → ' + r.after);
  check('no value is logged', !log.some(x => x[0] === 'log' && /sk-INVENTED|InventedSheet|\{"t":1\}/.test(String(x[1]))));
  const again = c.webScriptPropsMoveNotes_();
  check('running it again moves nothing more', again.moved === 0 && Object.keys(store).length === r.after);
  check('after the move the page’s count is just what’s left to move', c.webScriptProps_().notesToMove === 1);
}
{
  const { c, store } = world({ TDB_SENT_20270101_A: '1' }, { notOwner: true });
  check('owner only: someone else moves nothing', c.webScriptPropsMoveNotes_().ok === false && store.TDB_SENT_20270101_A === '1');
}

console.log('\nthe writers use the store');
{
  const src = f => read(f);
  const has = (f, re) => re.test(src(f));
  check('card perks: the email latch', has('Code.js', /if \(!veraNoteGet_\(notifyKey\)\) \{/) && has('Code.js', /veraNoteSet_\(notifyKey, new Date\(\)\.toISOString\(\)\);/));
  check('the day plan Chat applies', has('Code.js', /veraNoteSet_\(planKey, JSON\.stringify\(analysis\)\);/) && has('Chat.js', /var dpJson  = veraNoteGet_\('day_plan_' \+ dpToday\);/));
  check('chat history, and clearing it', has('Chat.js', /var raw = veraNoteGet_\(key\);/) && has('Chat.js', /veraNoteSet_\(key, JSON\.stringify\(trimmed\)\);/) && has('Chat.js', /veraNoteDel_\(CHAT_HISTORY_PREFIX \+ sessionId\);/));
  check('the travel-day briefing latch', has('TravelDayBriefing.js', /veraNoteGet_\(_sKey\) \|\| veraNoteGet_\(_lKey\)/) && has('TravelDayBriefing.js', /veraNoteSet_\(_sKey, new Date\(\)\.toISOString\(\)\);/));
  check('the trip latches: seen, value, mark, seed and clear', ['tripLatchSeen_', 'tripLatchValue_', 'seedTripIdLatches_', 'clearTripLatches_'].every(f => /var props\s+= veraNotes_\(\);/.test(fnSrc(read('Trips.js'), f)))
        && /veraNoteSet_\(name, value \|\| new Date\(\)\.toISOString\(\)\);/.test(fnSrc(read('Trips.js'), 'tripLatchMark_')));
  check('the image dedupe, and Slack’s trail in its bundle', has('Slack.js', /veraNoteGet_\(dedupKey\)/) && has('Slack.js', /veraNoteSet_\(dedupKey, String\(Date\.now\(\)\)\);/)
        && !/PropertiesService\.getScriptProperties\(\)\.setProperty\('SLACK_/.test(src('Slack.js') + src('WebApp.js')) && /var props = veraStateProps_\('SLACK'\);/.test(fnSrc(WEB, 'webDebugSlack_')));
  check('a place’s climate', /var props = veraNotes_\(\), kept = null;/.test(fnSrc(read('TripIdeas.js'), 'tiClimate_')));
  check('ARIA’s sync stamp, its Book now posts and its price-drop posts (#250)', /var props = veraNotes_\(\)/.test(fnSrc(read('Aria.js'), 'maybeSyncAriaFlags_')) && /var props = veraNotes_\(\), posted = \[\];\n  try \{ posted = JSON\.parse\(props\.getProperty\(ARIA_REBOOK_POSTED_PROP_\)/.test(read('Aria.js')) && (read('Aria.js').match(/var props = veraNotes_\(\)/g) || []).length === 3);
  check('Coming up, Life, Growth histories', /veraNoteGet_\(CU_DONE_PROP_\)/.test(read('ComingUp.js')) && /veraNoteSet_\(CU_DONE_PROP_,/.test(read('ComingUp.js'))
        && /veraNoteGet_\(LF_WISHES_PROP_\)/.test(read('Life.js')) && /veraNoteSet_\(LG_DIDIT_PROP_,/.test(read('LifeGrowth.js')) && /veraNoteSet_\(LG_TIME_PROP_,/.test(read('LifeGrowth.js')));
  check('the sheet styling progress and the email admin window', /var props = veraNotes_\(\);/.test(read('SheetStyle.js')) && /var props = veraNotes_\(\);/.test(fnSrc(read('EmailAdmin.js'), 'runEmailAdmin_')));
  check('the nightly prune reads and deletes through the store', /veraNoteKeys_\(/.test(fnSrc(read('AddressBook.js'), 'pruneScriptProperties_')) && /veraNoteDel_\(k\)/.test(fnSrc(read('AddressBook.js'), 'pruneScriptProperties_')));
}

console.log('\nthe page');
{
  check('the route, owner only', /case 'script_props_move_notes':\s+return jsonOut_\(webScriptPropsMoveNotes_\(\)\);/.test(WEB) && /peopleOwnerOnly_\(\)/.test(fnSrc(SP, 'webScriptPropsMoveNotes_')));
  const p = APP.slice(APP.indexOf('function SysScriptProps('), APP.indexOf('\nfunction SysPeople(', APP.indexOf('function SysScriptProps(')));
  check('“Move running notes (n)” shows only when there are some, and says what moved', /d\.notesToMove>0&&h\("button",\{className:"sp-move-notes"/.test(p) && /'Move running notes \('\+d\.notesToMove\+'\)'/.test(p) && /' to the VERA State tab'/.test(p));
  check('index.html is rebuilt with it', read('docs/index.html').includes('sp-move-notes'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
