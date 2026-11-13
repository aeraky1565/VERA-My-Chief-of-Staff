// #247 Agent health. Pins:
//  - schedules read from Config ("weekdays 06:36 America/New_York eod");
//  - each agent's Run Log read by header (ARIA's, TESS's Run Time/Status/Summary,
//    HAILEY's sweep with no Status column, the Weekly Digest's date-only rows);
//  - the rules: Late = no run logged for the latest scheduled run once it's due (2
//    hours after, or the end of the day for TESS); Failed = the latest run says so;
//    Partial is amber and counts as OK; the strip of the last 7 scheduled runs;
//  - a sheet VERA can't open is No signal and flagged; nothing logged yet isn't;
//  - one flag per agent for TESS and HAILEY, reworded, resolved on the next good run;
//    changes post to #vera-logs; TESS's job-find guess only until its Run Log exists;
//  - never a write to an agent's sheet;
//  - the panel, the roster dots, and the wiring.
// Invented runs and ids.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const AH = read('AgentHealth.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), CAR = read('Career.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; const m = /\)\s*\{/g; m.lastIndex = a; let d = 0, j = src.indexOf('{', m.exec(src).index); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };

// Thu 2026-11-12, 15:00 UTC = 10:00 AM Eastern (UTC-5).
const NOW = Date.UTC(2026, 10, 12, 15, 0);
const ET = () => -300;
function ctx(extra) {
  const c = Object.assign({ String, Array, Object, JSON, Math, Number, isNaN, parseInt, Date, RegExp, Logger: { log: () => {} } }, extra || {});
  vm.createContext(c);
  vm.runInContext(AH, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const iso = (d, h, m) => new Date(Date.UTC(2026, 10, d, h, m || 0)).toISOString();

console.log('\nagentParseSchedule_');
{
  const c = ctx();
  const p = s => run(c, 'agentParseSchedule_(' + J(s) + ')');
  const t = p('weekdays 06:36 America/New_York eod');
  check('weekdays, the time, the zone and "by end of day"', J(t.days) === J([1, 2, 3, 4, 5]) && t.hh === 6 && t.mm === 36 && t.tz === 'America/New_York' && t.eod === true && t.text === 'weekdays 6:36 AM ET', J(t));
  check('daily', J(p('daily 06:52 America/New_York').days) === J([0, 1, 2, 3, 4, 5, 6]) && p('daily 06:52 America/New_York').eod === false);
  check('a day, or a list of days', J(p('fri 18:00 America/Chicago').days) === J([5]) && p('fri 18:00 America/Chicago').text === 'Fri 6:00 PM CT' && J(p('mon,wed 09:00 America/Chicago').days) === J([1, 3]));
  check('nonsense is refused', p('sometimes 6am') === null && p('daily 25:00 America/New_York') === null && p('funday 06:00 America/New_York') === null);
}

console.log('\nagentSlots_: the scheduled runs, newest first');
{
  const c = ctx();
  c.sched = run(c, 'agentParseSchedule_("weekdays 06:36 America/New_York eod")'); c.ET = ET;
  const s = run(c, 'agentSlots_(sched, ' + NOW + ', ET, 7)');
  check('the 7 latest weekday runs that have started', J(s.map(x => x.date)) === J(['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-06', '2026-11-05', '2026-11-04']), J(s.map(x => x.date)));
  check('at 6:36 Eastern, and due at the end of that day', s[0].atMs === Date.UTC(2026, 10, 12, 11, 36) && s[0].dueMs === Date.UTC(2026, 10, 13, 5, 0));
  c.d = run(c, 'agentParseSchedule_("daily 11:00 America/New_York")');
  const later = run(c, 'agentSlots_(d, ' + NOW + ', ET, 2)');
  check('a run later today hasn’t started, so it isn’t listed', later[0].date === '2026-11-11');
  const dd = run(c, 'agentSlots_(agentParseSchedule_("daily 06:52 America/New_York"), ' + NOW + ', ET, 1)');
  check('without eod, due 2 hours after the scheduled time', dd[0].dueMs === Date.UTC(2026, 10, 12, 13, 52));
}

console.log('\nagentLogRuns_: Run Logs by header');
{
  const c = ctx();
  c.aria = [['Run Time', 'Status', 'Trips Synced', 'Rows Priced', 'Searches Used', 'Book Now', 'Action Needed', 'Failures', 'Notes', 'Run ID'],
            [iso(11, 11, 58), 'OK', 3, 14, 9, 1, 2, '', 'fine', 'R1'], [iso(12, 11, 57), 'Partial - Expedia down', 3, 12, 9, 0, 2, 'Expedia', '', 'R2']];
  const a = run(c, 'agentLogRuns_(aria)');
  check('ARIA: newest first, its Status, a summary from its counts', a.length === 2 && a[0].status === 'Partial' && a[0].at === iso(12, 11, 57) && /^Rows priced 12 · Book now 0 · Failures Expedia$/.test(a[0].summary), J(a));
  c.tess = [['Run Time (UTC)', 'Status', 'Summary'], ['2026-11-12T11:41:00Z', 'Failed', 'Gmail search failed'], [new Date(Date.UTC(2026, 10, 11, 11, 40)), 'ok', 'Found 9, kept 2']];
  const t = run(c, 'agentLogRuns_(tess)');
  check('TESS: ISO text or a Date, Status words, the Summary', t[0].status === 'Failed' && t[0].summary === 'Gmail search failed' && t[1].status === 'OK' && t[1].at === iso(11, 11, 40), J(t));
  c.hailey = [['Run time (UTC)', 'Markets searched', 'Results returned', 'New', 'Price cuts', 'Gone', 'Notes'],
              ['2026-11-12 12:43', 'Both', 40, 2, 1, 0, 'all good'], ['2026-11-11 12:41', 'Both', 38, 0, 0, 1, 'Zillow error for one area']];
  const h = run(c, 'agentLogRuns_(hailey)');
  check('HAILEY’s sweep: no Status column, so errors in Notes make it Partial', h[0].status === 'OK' && h[1].status === 'Partial' && /^Results returned 40 · New 2 · Price cuts 1 · Gone 0$/.test(h[0].summary), J(h));
  c.digest = [['Digest date', 'Tracked', 'Available now', 'Notes'], ['2026-11-01', 20, 9, 'sent'], ['', '', '', '']];
  const d = run(c, 'agentLogRuns_(digest)');
  check('the Weekly Digest: date-only rows, blank rows skipped', d.length === 1 && d[0].date === '2026-11-01' && d[0].at === '', J(d));
  check('no time column: nothing', run(c, 'agentLogRuns_([["Foo"],["x"]])').length === 0);
}

console.log('\nagentRunHealth_: the rules');
{
  const c = ctx(); c.ET = ET;
  c.daily = run(c, 'agentParseSchedule_("daily 06:52 America/New_York")');
  c.tessS = run(c, 'agentParseSchedule_("weekdays 06:36 America/New_York eod")');
  const H = (runs, sched, now, name) => { c.runs = runs; return run(c, 'agentRunHealth_(runs, ' + sched + ', ' + (now || NOW) + ', ET, ' + J(name || 'ARIA') + ')'); };
  const days = n => Array.from({ length: n }, (_, i) => ({ at: iso(12 - i, 11, 58), status: 'OK', summary: 'Priced ' + (10 - i) }));
  const ok = H(days(7), 'daily');
  check('on time: OK, the last run and what it said', ok.level === 'ok' && ok.lastRun === iso(12, 11, 58) && ok.text === 'Priced 10' && J(ok.strip) === J(Array(7).fill('ok')), J(ok));
  const late = H(days(7).slice(1), 'daily');
  check('today’s run missing 2 hours after its time: Late', late.level === 'late' && late.text === 'No run logged Thursday' && late.strip[0] === 'missing', J(late));
  const early = H(days(7).slice(1), 'daily', Date.UTC(2026, 10, 12, 12, 30));
  check('…but within the 2 hours, it isn’t due yet', early.level === 'ok' && early.strip[0] === 'pending', J(early));
  const two = H(days(7).slice(2), 'daily');
  check('two missed: both named', two.level === 'late' && two.text === 'No run logged Wednesday or Thursday', two.text);
  const many = H(days(7).slice(4), 'daily');
  check('more: counted', many.level === 'late' && many.text === 'No run logged — 4 scheduled runs in a row', many.text);
  const failed = H([{ at: iso(12, 11, 58), status: 'Failed', summary: 'Usage limit reached' }].concat(days(7).slice(1)), 'daily');
  check('the latest run says Failed: Failed, with why', failed.level === 'failed' && failed.text === 'ARIA’s last run failed: Usage limit reached' && failed.strip[0] === 'failed');
  const partial = H([{ at: iso(12, 11, 58), status: 'Partial', summary: 'Expedia down' }].concat(days(7).slice(1)), 'daily');
  check('Partial: amber in the strip, but OK', partial.level === 'ok' && partial.strip[0] === 'partial' && /partial: Expedia down/.test(partial.text));
  check('nothing logged at all: No signal', H([], 'daily').level === 'none' && H([], 'daily').text === 'Nothing logged yet');
  const tWed = [{ at: iso(10, 11, 40), status: 'OK', summary: 'Tue' }, { at: iso(9, 11, 40), status: 'OK', summary: 'Mon' }];
  const tess = H(tWed, 'tessS', NOW, 'TESS');
  check('TESS: Thursday isn’t late until the day is over, but Wednesday is', tess.level === 'late' && tess.text === 'No run logged Wednesday' && tess.strip[0] === 'pending' && tess.strip[1] === 'missing', J(tess));
  const weekend = H([{ at: iso(6, 11, 40), status: 'OK', summary: 'Fri' }], 'tessS', Date.UTC(2026, 10, 8, 15, 0), 'TESS');
  check('…and no weekend run is expected', weekend.level === 'ok' && weekend.strip[0] === 'ok', J(weekend));
  c.fri = run(c, 'agentParseSchedule_("fri 18:00 America/Chicago")');
  c.CT = () => -360;
  const dig = (runs, now) => { c.runs = runs; return run(c, 'agentRunHealth_(runs, fri, ' + now + ', CT, "digest")'); };
  check('a date-only digest row dated the next UTC day still counts', dig([{ date: '2026-11-07', status: 'OK', summary: '' }], Date.UTC(2026, 10, 12, 15)).level === 'ok');
  const missed = dig([{ date: '2026-10-31', status: 'OK', summary: '' }], Date.UTC(2026, 10, 12, 15));
  check('…and a Friday with no digest row is Late (the Nov 7 failure)', missed.level === 'late' && missed.text === 'No run logged Friday' && J(missed.strip.slice(0, 2)) === J(['missing', 'ok']), J(missed));
  check('no schedule: No signal, and it says how to fix it', /agent_schedule/.test(run(c, 'agentRunHealth_([], null, 0, null, "X")').text));
}

console.log('\nCounts, flags and #vera-logs');
{
  const c = ctx();
  c.agents = [{ name: 'ARIA', level: 'late', text: 'No run logged Thursday', flaggable: false },
              { name: 'TESS', level: 'late', text: 'No run logged Wednesday', schedule: 'weekdays 6:36 AM ET', flaggable: true },
              { name: 'HAILEY', level: 'failed', text: 'HAILEY’s last sweep failed: Zillow down', flaggable: true },
              { name: 'VERA', level: 'ok', text: 'all on time' }, { name: 'PIES', level: 'none', text: '' }];
  check('the counts', J(run(c, 'agentCounts_(agents)')) === J({ ok: 1, late: 2, failed: 1, none: 1 }));
  const w = run(c, 'agentWantedFlags_(agents)');
  check('one flag each for TESS and HAILEY, not ARIA (it flags itself) or VERA (the watchdog does)', J(Object.keys(w).sort()) === J(['AGENT_HEALTH|HAILEY', 'AGENT_HEALTH|TESS']), J(w));
  check('…worded from what happened, High', w['AGENT_HEALTH|TESS'].flag === 'TESS did not run' && w['AGENT_HEALTH|TESS'].reason === 'No run logged Wednesday (scheduled weekdays 6:36 AM ET).' && w['AGENT_HEALTH|TESS'].urgency === 'High' && w['AGENT_HEALTH|HAILEY'].flag === 'HAILEY run failed');
  c.agents2 = [{ name: 'TESS', level: 'ok', flaggable: true }, { name: 'HAILEY', level: 'none', text: 'Nothing logged yet', flaggable: true }];
  check('a good run wants no flag, so the old one resolves; nothing logged yet isn’t flagged', J(run(c, 'agentWantedFlags_(agents2)')) === '{}');
  c.agents3 = [{ name: 'HAILEY', level: 'none', cantOpen: true, text: 'No signal: can’t open HAILEY’s sheet', flaggable: true }];
  const co = run(c, 'agentWantedFlags_(agents3)');
  check('a sheet VERA can’t open is flagged', co['AGENT_HEALTH|HAILEY'] && co['AGENT_HEALTH|HAILEY'].flag === 'VERA can’t read HAILEY’s sheet' && co['AGENT_HEALTH|HAILEY'].urgency === 'Medium');
  const ch = run(c, 'agentChangeLines_(agents, { ARIA: "ok", TESS: "late", HAILEY: "ok", VERA: "late" })');
  check('#vera-logs: only what changed, and not VERA (the watchdog says it) or PIES', J(ch.lines) === J(['⚠️ ARIA: late — No run logged Thursday', '❌ HAILEY: failed — HAILEY’s last sweep failed: Zillow down']), J(ch.lines));
  check('…back on time is said too; the first night says nothing', J(run(c, 'agentChangeLines_([{ name: "TESS", level: "ok", text: "Found 9" }], { TESS: "late" })').lines) === J(['✅ TESS: back on time — Found 9'])
        && run(c, 'agentChangeLines_(agents, {})').lines.length === 0);
}

console.log('\nagentHealthRead_: from the sheets');
{
  const FIX = NOW;
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
  const sheets = {
    ARIAID: { 'Run Log': [['Run Time', 'Status', 'Rows Priced'], [iso(12, 11, 58), 'OK', 14]] },
    TESSID: { 'Run Log': [['Run Time (UTC)', 'Status', 'Summary'], [iso(11, 11, 40), 'OK', 'kept 2']] },
    HAILID: { 'Run Log': [['Run time (UTC)', 'Results returned', 'Notes'], [iso(12, 12, 43), 40, '']], 'Settings': [['Last run status', 'FAILED: Zillow unavailable']],
              'Weekly Digest': [['Digest date', 'Notes'], ['2026-11-01', 'sent']] },
  };
  const opened = [];
  const writes = [];
  const tab = v => ({ getLastRow: () => v.length, getLastColumn: () => v[0].length, getRange: () => ({ getValues: () => v, setValue: () => writes.push('setValue'), setValues: () => writes.push('setValues') }) });
  const ssFor = id => { opened.push(id); if (!sheets[id]) throw new Error('no access'); return { getSheetByName: n => sheets[id][n] ? new Proxy(tab(sheets[id][n]), { get: (t, k) => { if (/^(set|append|insert|delete|clear)/.test(String(k))) writes.push(k); return t[k]; } }) : null }; };
  const c = ctx({ Date: FakeDate,
    SpreadsheetApp: { openById: ssFor },
    Utilities: { formatDate: (d, tz, f) => f === 'Z' ? (tz === 'America/Chicago' ? '-0600' : '-0500') : '2026-11-12' },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    getConfigValues: () => ({ career_alert_sheet_id: 'TESSID', roster_link_hailey: 'HAILID' }),
    ariaSheetId_: () => 'ARIAID', ariaSheetIdFrom_: v => String(v || ''),
    getOverdueJobs_: () => [], getHeartbeatState_: () => ({ nightlyRun: { lastRun: Date.UTC(2026, 10, 12, 4, 42) } }),
    carReadTracker_: () => { throw new Error('should not be needed'); }, carAgentHealth_: () => ({}),
  });
  let h = { agents: [], counts: {} };
  try { h = run(c, 'agentHealthRead_()'); } catch (e) { check('agentHealthRead_ runs', false, e.message); }
  const by = { ARIA: { source: {} }, TESS: {}, HAILEY: {}, VERA: {}, PIES: {} }; h.agents.forEach(a => { by[a.name] = a; });
  check('every agent, in the roster’s terms', J(h.agents.map(a => a.name)) === J(['ARIA', 'TESS', 'HAILEY', 'VERA', 'PIES']));
  check('ARIA ran today: OK', by.ARIA.level === 'ok' && by.ARIA.schedule === 'daily 6:52 AM ET' && by.ARIA.source.url === 'https://docs.google.com/spreadsheets/d/ARIAID/edit');
  check('TESS ran Wednesday, Thursday not over: OK', by.TESS.level === 'ok' && by.TESS.flaggable === true, J(by.TESS));
  check('HAILEY: Settings says the last sweep failed, and the Friday digest is missing', by.HAILEY.level === 'failed' && /last sweep failed: FAILED: Zillow unavailable/.test(by.HAILEY.text) && (by.HAILEY.digest || {}).level === 'late', J(by.HAILEY));
  check('…its schedule shows both', by.HAILEY.schedule === 'weekdays 6:38 AM CT · digest Fri 6:00 PM CT', by.HAILEY.schedule);
  check('VERA from its watchdog; PIES never anything but No signal', by.VERA.level === 'ok' && by.PIES.level === 'none');
  check('never a write to an agent’s sheet', writes.length === 0, J(writes));
  check('the counts', J(h.counts) === J({ ok: 3, late: 0, failed: 1, none: 1 }), J(h.counts));
  // An unreadable sheet, and TESS with no Run Log yet (its job finds decide).
  delete sheets.HAILID; delete sheets.TESSID['Run Log'];
  c.carReadTracker_ = () => ({ status: 'ok', rows: [] }); c.carAgentHealth_ = () => ({ lastFound: '2026-11-06', weekdays: 4, stale: true });
  let h2 = { agents: [] };
  try { h2 = run(c, 'agentHealthRead_()'); } catch (e) { check('agentHealthRead_ runs again', false, e.message); }
  const b2 = { HAILEY: {}, TESS: {} }; h2.agents.forEach(a => { b2[a.name] = a; });
  check('a sheet VERA can’t open: No signal, and marked for a flag', b2.HAILEY.level === 'none' && b2.HAILEY.cantOpen === true && /can’t open HAILEY’s sheet/.test(b2.HAILEY.text));
  check('TESS with no Run Log yet: judged from its finds, and not flagged twice', b2.TESS.level === 'late' && b2.TESS.fallback === true && b2.TESS.flaggable === false && /until TESS writes a Run Log/.test(b2.TESS.text), J(b2.TESS));
}

console.log('\nRead only, and wired');
{
  check('AgentHealth.js never writes to a sheet it opens', !/\.(setValue|setValues|appendRow|insertSheet|deleteRow|deleteRows|deleteSheet|clear|clearContent|setFormula)\(/.test(AH));
  check('…its only writes are VERA’s own flag tab and VERA State', /upsertKeyedFlags_\(flagSheet, AGENT_FLAG_PREFIX_, 'System', agentWantedFlags_\(h\.agents\), today\)/.test(fnSrc(AH, 'checkAgentHealth_')) && /veraStoreSet_\('AGENT_HEALTH_LEVELS'/.test(fnSrc(AH, 'checkAgentHealth_')));
  check('the nightly run checks it', /nightlyStep_\(ctx, 'checkAgentHealth_', checkAgentHealth_\);/.test(CODE));
  check('the schedules are Config rows', /\['agent_schedule_tess',\s+'weekdays 06:36 America\/New_York eod'\]/.test(CODE) && /\['agent_schedule_hailey_digest', 'fri 18:00 America\/Chicago'\]/.test(CODE));
  check('the route, with Check again', /case 'agent_health':\s+return jsonOut_\(webAgentHealth_\(\{ refresh: \(e\.parameter \|\| \{\}\)\.refresh === '1' \}\)\);/.test(WEB));
  check('TESS’s job-find guess steps aside once it keeps a Run Log', /if \(typeof agentTessHasRunLog_ === 'function' && agentTessHasRunLog_\(sheetId\)\) \{\s*resolveFlagsWithPrefix_\(/.test(fnSrc(CAR, 'carCheckAgentHealth_')));
}

console.log('\nThe dashboard');
{
  check('System › Agent health, next to API health', /\{id:'api_health',label:'🩺 API health'\},\{id:'agent_health',label:'🤖 Agent health'\}/.test(APP) && /cur==='agent_health'&&h\(SysAgentHealth,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
  check('…in the Checks group of both dashboards’ menus', /items:\['test','api_health','agent_health'\]/.test(APP) && /items:\['test','api_health','agent_health'\]/.test(LITE));
  const p = fnSrc(APP, 'SysAgentHealth');
  check('the panel: counts, a card per agent, the strip, the source link, Check again', /action:'agent_health',refresh:'1'/.test(p) && /\['ok','late','failed','none'\]/.test(p) && /h\(AgStrip,/.test(p) && /"open sheet"/.test(p) && /'Check again'/.test(p));
  check('the roster shows a dot and a short line per agent (both dashboards share it)', /H\[r\.name\]&&h\("span",\{className:'roster-health'/.test(APP) && /H\[r\.name\]&&h\("span",\{className:'roster-health'/.test(LITE));
  check('System › Assistants hands the roster the health', /health:health\}/.test(fnSrc(APP, 'SysAssistants')) && /action:'agent_health'/.test(fnSrc(APP, 'SysAssistants')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
