// #244 "While you were away". Pins:
//  - when an Away period ends (a trip of yours, the switch's date passing, "End away
//    mode"), the period is recorded once, with its days, trip and held counts, and two
//    periods before a morning email merge;
//  - what the catch-up holds: flags raised in those days (the 5 most urgent open ones
//    listed, the rest counted), tasks that went overdue in those days (up to 5), what
//    was held (one line, by kind), the mail waiting; empty parts left out, and no
//    section at all when there's nothing;
//  - it shows once: cleared after the briefing goes out, and sent on its own on a
//    morning with no flags.
// Invented trips, flags and tasks.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const AWAY = read('Away.js'), CODE = read('Code.js'), PACING = read('Pacing.js'), SET = read('Settings.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; const m = /\)\s*\{/g; m.lastIndex = a; let d = 0, j = src.indexOf('{', m.exec(src).index); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
const REGISTRY = (() => { const a = CODE.indexOf('const NOTIF_REGISTRY = ['); return CODE.slice(a, CODE.indexOf('\n];', a) + 3).replace(/^const /, 'var '); })();
const FLAG_HEADERS_SRC = CODE.match(/^const FLAG_HEADERS\s*=.*;$/m)[0].replace(/^const /, 'var ');

const TODAY = '2026-11-17';
function ctx(opts) {
  const o = opts || {};
  const st = Object.assign({}, o.state || {}), sent = [];
  const c = {
    String, Array, Object, JSON, Math, Number, isNaN, parseInt, Date, RegExp,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: () => TODAY },
    veraStateGet_: () => Object.assign({}, st),
    veraStateSet_: (b, patch) => { Object.keys(patch).forEach(k => { if (patch[k] === null) delete st[k]; else st[k] = String(patch[k]); }); },
    getConfigValues: () => ({}),
    veraSetting_: () => 'https://example.invalid/vera',
    getMailCounter_: () => o.mail || { pieces: 0, packages: 0 },
    getOpenTasks: () => o.tasks || [],
    getNotifChannel_: () => o.channel || 'email',
    sendVeraEmail_: (to, subj, text, opt) => sent.push({ subj, text, html: opt.htmlBody }),
    sendSlack_: (ch, text) => { sent.push({ ch, text }); return true; },
    CONFIG: { MORNING_NUDGE_EMAIL: 'me@example.invalid' },
    TABS: { FLAGS: 'Flags' },
  };
  const rows = o.flagRows || [];
  c.getSpreadsheet = () => ({ getSheetByName: () => ({ getLastRow: () => rows.length + 1, getRange: (r, col, nr) => ({ getValues: () => rows.slice(0, nr) }) }) });
  c.__st = st; c.__sent = sent;
  vm.createContext(c);
  vm.runInContext(REGISTRY + '\n' + FLAG_HEADERS_SRC + '\n' + AWAY, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);

console.log('\nawayCloseDecide_: recording the period when Away mode ends');
{
  const c = ctx();
  const close = (st, end, trip) => { c.st = st; return run(c, 'awayCloseDecide_(st, ' + J(TODAY) + ', ' + J(end || '') + ', ' + J(trip || '') + ')'); };
  check('never away: nothing', close({}) === null);
  check('still away: nothing', close({ AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-20', AWAY_STARTED: '2026-11-10' }) === null);
  const auto = close({ VACATION_MODE_ACTIVE: 'false', AWAY_STARTED: '2026-11-08', AWAY_HELD: '{"water_break":6,"bill_due":2}' }, '', '2026-11-08|Island Cruise');
  check('a trip of yours ended: from its first day to yesterday, with the trip’s name and the held counts',
        auto && J(auto.back) === J({ start: '2026-11-08', end: '2026-11-16', trip: 'Island Cruise', held: { water_break: 6, bill_due: 2 } }), J(auto && auto.back));
  check('…and the period is closed, so it records once', auto && auto.patch.AWAY_STARTED === null && auto.patch.AWAY_HELD === null && J(JSON.parse(auto.patch.AWAY_BACK)) === J(auto.back));
  const man = close({ AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-14', AWAY_TRIP: 'Weekend', AWAY_STARTED: '2026-11-12' });
  check('the switch’s date passed: it ends on that date, and the switch is cleared',
        man && man.back.end === '2026-11-14' && man.back.trip === 'Weekend' && man.patch.AWAY_MANUAL === null && man.patch.AWAY_UNTIL === null, J(man));
  const tap = close({ AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-20', AWAY_STARTED: '2026-11-12' }, TODAY);
  check('"End away mode": ends today, even while still on', tap && tap.back.end === TODAY && tap.back.start === '2026-11-12');
  const midTrip = close({ VACATION_MODE_ACTIVE: 'true', VACATION_TRIP_NAME: '2026-11-15|Short Hop', AWAY_STARTED: '2026-11-15' }, TODAY);
  check('…ending a trip early names that trip', midTrip && midTrip.back.trip === 'Short Hop');
  const same = close({ VACATION_MODE_ACTIVE: 'false', AWAY_STARTED: TODAY });
  check('a period that began today never ends before it began', same && same.back.end === TODAY && same.back.start === TODAY);
  const two = close({ VACATION_MODE_ACTIVE: 'false', AWAY_STARTED: '2026-11-15', AWAY_HELD: '{"water_break":1}',
                      AWAY_BACK: J({ start: '2026-11-10', end: '2026-11-12', trip: 'First', held: { water_break: 2, gym_checkin: 1 } }) });
  check('two periods before a morning email become one catch-up',
        two && two.back.start === '2026-11-10' && two.back.end === '2026-11-16' && J(two.back.held) === J({ water_break: 3, gym_checkin: 1 }) && two.back.trip === 'First', J(two && two.back));
}

console.log('\nThe switch and the nightly check record it');
{
  const c = ctx({ state: { AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-20', AWAY_TRIP: 'Weekend', AWAY_STARTED: '2026-11-15', AWAY_HELD: '{"desk_break":2}' } });
  run(c, 'awaySet_(false)');
  const b = JSON.parse(c.__st.AWAY_BACK || '{}');
  check('"End away mode" records the catch-up for the days it was on', b.start === '2026-11-15' && b.end === TODAY && b.trip === 'Weekend' && J(b.held) === J({ desk_break: 2 }) && !c.__st.AWAY_STARTED, J(c.__st));
  check('a trip ending records it, with the trip it was', /if \(wasActiveEnd && typeof awayCloseIfEnded_ === 'function'\) awayCloseIfEnded_\('', endedTrip\);/.test(fnSrc(PACING, 'checkVacationMode_')));
  check('…and the record lives in the pacing state', /'AWAY_HELD', 'AWAY_BACK'\]/.test(SET));
}

console.log('\nawayBackSummary_: what the catch-up holds');
{
  const c = ctx();
  c.back = { start: '2026-11-08', end: '2026-11-16', trip: 'Island Cruise', held: { water_break: 6, bill_due: 2, gym_checkin: 1, monthly_review: 1, mystery_key: 1 } };
  c.flags = [
    { date: '2026-11-07', flag: 'Before the trip', urgency: 'High' },
    { date: '2026-11-09', flag: 'Return library books', urgency: 'Low' },
    { date: '2026-11-10', flag: 'Card perk ends Nov 30', urgency: 'Medium' },
    { date: '2026-11-11', flag: 'Car registration expires Nov 20', urgency: 'High' },
    { date: '2026-11-12', flag: 'Handled already', urgency: 'High', resolved: true },
    { date: '2026-11-12', flag: 'Seen already', urgency: 'High', acknowledged: true },
    { date: '2026-11-12', flag: 'Water heater service', urgency: 'Medium' },
    { date: '2026-11-13', flag: 'Passport photo', urgency: 'Medium' },
    { date: '2026-11-14', flag: 'Low two', urgency: 'Low' },
    { date: '2026-11-15', flag: 'Low three', urgency: 'Low' },
    { date: '2026-11-17', flag: 'This morning', urgency: 'High' },
  ];
  c.tasks = [
    { task: 'Book dentist', dueDate: '2026-11-10' }, { task: 'Before the trip', dueDate: '2026-11-05' },
    { task: 'Renew gym', dueDate: '2026-11-12' }, { task: 'Call insurer', dueDate: '2026-11-09' },
    { task: 'Due today', dueDate: TODAY }, { task: 'No date', dueDate: '' },
    { task: 'T4', dueDate: '2026-11-13' }, { task: 'T5', dueDate: '2026-11-14' }, { task: 'T6', dueDate: '2026-11-16' },
  ];
  const d = run(c, 'awayBackSummary_(back, flags, tasks, { pieces: 12, packages: 2 }, ' + J(TODAY) + ')');
  check('flags: raised in those days, and how many are still open', d.flags.raised === 9 && d.flags.open === 7, J(d.flags));
  check('…the open ones listed most urgent first, 5 of them, the rest counted',
        J(d.flags.list.map(f => f.flag)) === J(['Car registration expires Nov 20', 'Card perk ends Nov 30', 'Water heater service', 'Passport photo', 'Return library books']) && d.flags.more === 2, J(d.flags.list.map(f => f.flag)));
  check('tasks: due in those days and now overdue, earliest first, up to 5',
        d.tasks.count === 6 && J(d.tasks.list.map(t => t.task)) === J(['Call insurer', 'Book dentist', 'Renew gym', 'T4', 'T5']) && d.tasks.more === 1, J(d.tasks));
  check('held: one line, by kind, counted', d.held.total === 11 && d.held.line === '6 water breaks · 2 bill reminders · 1 gym check-in · 1 monthly review · 1 mystery key', d.held.line);
  check('mail: what’s waiting', d.mail.pieces === 12 && d.mail.packages === 2 && d.empty === false);
  c.back2 = { start: '2026-11-21', end: '2026-11-23', held: {} };
  check('nothing at all: empty', run(c, 'awayBackSummary_(back2, flags, tasks, { pieces: 0, packages: 0 }, "2026-11-24")').empty === true);
  check('…but mail alone is something', run(c, 'awayBackSummary_(back2, flags, tasks, { pieces: 0, packages: 1 }, "2026-11-24")').empty === false);
  c.back3 = { start: '2026-11-15', end: TODAY, held: {} };
  check('ended today: a task due today isn’t overdue yet', J(run(c, 'awayBackSummary_(back3, [], tasks, {}, ' + J(TODAY) + ')').tasks.list.map(t => t.task)) === J(['T6']));
}

console.log('\nawayBackSectionHtml_: the box in the email');
{
  const c = ctx();
  c.d = { start: '2026-11-08', end: '2026-11-16', trip: 'Island <Cruise>', empty: false,
          flags: { raised: 9, open: 7, list: [{ urgency: 'High', flag: 'Car <registration>' }], more: 6 },
          tasks: { count: 1, list: [{ task: 'Book dentist', dueDate: '2026-11-10' }], more: 0 },
          held: { total: 3, line: '3 water breaks' }, mail: { pieces: 12, packages: 2 } };
  const s = run(c, 'awayBackSectionHtml_(d, "https://example.invalid/vera")');
  check('the header: WELCOME BACK, the days and the trip, escaped', /WELCOME BACK/.test(s.html) && /while you were away · Nov 8 – Nov 16 \(Island &lt;Cruise&gt;\)/.test(s.html));
  check('flags, with the "and N more" count', /Flags raised: <strong>9<\/strong>, <strong>7<\/strong> still open/.test(s.html) && /Car &lt;registration&gt;/.test(s.html) && /… and 6 more/.test(s.html));
  check('tasks, with the day each was due', /Tasks that went overdue: <strong>1<\/strong>/.test(s.html) && /Book dentist <span[^>]*>\(was due Nov 10\)/.test(s.html));
  check('held and mail', /Held while you were away: <strong>3<\/strong>/.test(s.html) && /3 water breaks/.test(s.html) && /Mail waiting: <strong>12<\/strong> pieces, <strong>2<\/strong> packages/.test(s.html));
  check('the dashboard button', /Open the dashboard →/.test(s.html));
  check('the plain-text part', /^WELCOME BACK · while you were away \(Nov 8 – Nov 16 \(Island <Cruise>\)\)\nFlags raised: 9, 7 still open\n  • High · Car <registration>\n  … and 6 more\nTasks that went overdue: 1/.test(s.text), s.text);
  c.d.flags = { raised: 0, open: 0, list: [], more: 0 }; c.d.tasks = { count: 0, list: [], more: 0 }; c.d.mail = { pieces: 0, packages: 0 }; c.d.trip = '';
  const q = run(c, 'awayBackSectionHtml_(d, "")');
  check('a part with nothing is left out', !/Flags raised|Tasks that went|Mail waiting/.test(q.html) && /Held while you were away/.test(q.html) && !/Open the dashboard/.test(q.html));
  check('a one-day period shows one day', /away · Nov 8 – Nov 16/.test(s.html) && (c.d.end = c.d.start, /away · Nov 8<\/span>/.test(run(c, 'awayBackSectionHtml_(d, "")').html)));
  c.d0 = { start: '2026-11-21', end: '2026-11-23', trip: '', empty: true, flags: { raised: 0, open: 0, list: [], more: 0 }, tasks: { count: 0, list: [], more: 0 }, held: { total: 0, line: '' }, mail: { pieces: 0, packages: 0 } };
  check('nothing at all: no section', run(c, 'awayBackSectionHtml_(d0, "https://example.invalid/vera")') === null);
}

console.log('\nShown once');
{
  const back = J({ start: '2026-11-08', end: '2026-11-16', trip: 'Island Cruise', held: { water_break: 2 } });
  const c = ctx({ state: { AWAY_BACK: back }, flagRows: [['F1', '2026-11-10', 'S', 'Invented flag', 'r', 'High', 'No', '', 'No', 'k', '', '']], mail: { pieces: 3, packages: 0 } });
  const s = run(c, 'awayBackSection_(null)');
  check('the first morning: the section, from the Flags tab, tasks and mail', s && /Invented flag/.test(s.html) && /Mail waiting: <strong>3<\/strong> pieces/.test(s.html));
  run(c, 'awayBackClear_()');
  check('cleared, the next morning has none', run(c, 'awayBackSection_(null)') === null && !c.__st.AWAY_BACK);
  const e = ctx({ state: { AWAY_BACK: J({ start: '2026-11-21', end: '2026-11-23', held: {} }) } });
  check('an empty catch-up is dropped rather than kept for tomorrow', run(e, 'awayBackSection_(null)') === null && !e.__st.AWAY_BACK);
  const a = ctx({ state: { AWAY_BACK: back } });
  check('a morning with no flags: it goes on its own, then is cleared',
        run(a, 'sendAwayBackAlone_()') === true && a.__sent.length === 1 && /While you were away/.test(a.__sent[0].subj) && /2 water breaks/.test(a.__sent[0].html) && !a.__st.AWAY_BACK, J(a.__sent));
  const sl = ctx({ state: { AWAY_BACK: back }, channel: 'vera-chat' });
  check('…or to Slack when that’s where the briefing goes', run(sl, 'sendAwayBackAlone_()') === true && sl.__sent[0].ch === 'vera-chat' && /Welcome home/.test(sl.__sent[0].text));
  check('…and nothing to send: nothing sent', run(ctx(), 'sendAwayBackAlone_()') === false);
}

console.log('\nThe morning briefing');
{
  const mn = fnSrc(CODE, 'morningNudge');
  const iClose = mn.indexOf("if (typeof awayCloseIfEnded_ === 'function') awayCloseIfEnded_();"), iAway = mn.indexOf('sendAwayEditionEmail_();');
  check('a switch whose date passed is closed before the away check', iClose !== -1 && iAway !== -1 && iClose < iAway);
  check('both no-flags mornings send the catch-up on its own', (mn.match(/if \(typeof sendAwayBackAlone_ === 'function'\) sendAwayBackAlone_\(\);\s*\/\/ #244\s*return;/g) || []).length === 2);
  const iTasks = mn.indexOf("nightlyStep_(ctx, 'getOpenTasks'"), iSec = mn.indexOf("welcomeBack = awayBackSection_(openTasks);");
  check('the section is built from the open tasks this run already read', iTasks !== -1 && iSec > iTasks);
  check('it sits at the top of the email, under the greeting', /Good morning, Ahmed\.<\/p>' \+\s*\(welcomeBack \? '<p[^']*>Welcome home\. Here’s what piled up\.<\/p>' \+ welcomeBack\.html : ''\) \+\s*'<p[^']*>VERA flagged/.test(mn));
  check('…and in the plain text', /'Good morning, Ahmed\.',\s*'',\s*welcomeBack \? welcomeBack\.text \+ '\\n' : false,/.test(mn));
  const iSend = mn.indexOf("Logger.log('Morning nudge sent (Slack/'"), iClear = mn.indexOf('if (welcomeBack && typeof awayBackClear_ === \'function\') awayBackClear_();');
  check('cleared only after the briefing went out', iSend !== -1 && iClear > iSend);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
