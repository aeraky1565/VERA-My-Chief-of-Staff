// The Flags and Tasks tabs' server side (FlagsTasks.js and the routes in WebApp.js):
//  - automatic flags: every prefix a nightly check keeps (upsertKeyedFlags_) is known,
//    with what clears it; Resolve on one is refused; a one-off flag still resolves;
//  - the Flags read returns Due, Escalated, automatic and what clears it;
//  - snooze to a date (tomorrow at the earliest, a year at most) or for days;
//  - a task made from a flag (its ID in "Flagged", the flag's text and Due), once;
//  - checking it off stamps "Completed" and resolves a one-off flag, leaves an automatic one;
//  - Done this week, Reopen; every whole-row task write is the new width.
// Invented flags and tasks.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FT = read('FlagsTasks.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), TASKS = read('Tasks.js'), SETTINGS = read('Settings.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const arr = n => JSON.parse(CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\]);'))[1].replace(/'/g, '"'));
const FLAG_HEADERS = arr('FLAG_HEADERS'), TASK_HEADERS = arr('TASK_HEADERS');
const TODAY = '2027-03-10';

// A sheet over rows (row 1 is the header), recording writes.
function sheet(name, header, rows) {
  const all = [header.slice()].concat(rows.map(r => r.slice()));
  const writes = [];
  const cell = (r, c) => { while (all.length < r) all.push([]); const row = all[r - 1]; while (row.length < c) row.push(''); return row; };
  return { _all: all, _writes: writes, getName: () => name,
    getLastRow: () => all.length, getLastColumn: () => header.length, getMaxColumns: () => 26,
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = all[r - 1 + i] || []; const o = []; for (let k = 0; k < (nc || 1); k++) o.push(row[c - 1 + k] === undefined ? '' : row[c - 1 + k]); out.push(o); } return out; },
      getValue: () => { const row = all[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; },
      setValue: v => { cell(r, c)[c - 1] = v; writes.push([r, c, v]); },
      setValues: v => { v.forEach((row, i) => row.forEach((x, k) => { cell(r + i, c + k)[c - 1 + k] = x; })); writes.push([r, c, v]); },
    }),
    deleteRow: r => { all.splice(r - 1, 1); writes.push(['delete', r]); },
    appendRow: row => { all.push(row.slice()); writes.push(['append', row]); } };
}
const flagRow = (o) => FLAG_HEADERS.map(h => ({ ID: o.id, Date: o.date || '2027-03-01', Source: o.source || 'Finance', Flag: o.flag || 'A flag', Reason: o.reason || '', Urgency: o.urgency || 'Low',
  Acknowledged: o.ack || 'No', 'Snoozed Until': o.snoozed || '', Resolved: o.resolved || 'No', Key: o.key || '', Escalated: o.escalated || '', Due: o.due || '' })[h]);
const taskRow = (o) => [o.id, o.task || 'A task', o.added || '2027-03-01', o.due || '', o.status || 'Open', o.recurring || '', o.notes || '', o.flagged || '', o.completed || ''];

function ctx(flags, tasks) {
  const sheets = { Flags: sheet('Flags', FLAG_HEADERS, flags || []), Tasks: sheet('Tasks', TASK_HEADERS, tasks || []) };
  const c = { String, Number, Object, Array, Date, Math, JSON, RegExp, isNaN, parseInt, Error, Set,
    Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => { const iso = new Date(d).toISOString(); return f === 'yyyyMMdd' ? '20270310' : f === 'yyyy-MM-dd' ? TODAY : iso; } },
    TABS: { FLAGS: 'Flags', TASKS: 'Tasks' }, FLAG_HEADERS, TASK_HEADERS,
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    veraLocked_: f => f(), recordFlagOutcome_: () => {}, getConfigValues: () => ({}),
    _sheets: sheets };
  vm.createContext(c);
  vm.runInContext(FT, c);
  ['findFlagRow_', 'findTaskRow_', 'webAcknowledge_', 'webSnooze_', 'webResolve_', 'webGetFlags_', 'webCompleteTask_', 'webDeleteTask_', 'webAddTask_', 'webUpdateTask_', 'webGetTasks_',
   'computeNextDueDate_', 'isWeekdayAnchored_', 'parseDayOfWeek_', 'nextWeekday_', 'formatDateVal_'].forEach(n => { try { vm.runInContext(fn(WEB, n), c); } catch (e) { if (n !== 'formatDateVal_') throw e; } });
  if (typeof c.formatDateVal_ !== 'function') c.formatDateVal_ = v => String(v || '');
  vm.runInContext('var DAY_NAMES_ = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];', c);
  vm.runInContext(fn(CODE, 'flagDueCell_'), c);
  vm.runInContext(fn(SETTINGS, 'veraNextSeqId_'), c);
  ['getOpenTasks', 'parseFlexibleDate'].forEach(n => vm.runInContext(fn(TASKS, n), c));
  return c;
}

console.log('\nautomatic flags');
{
  const c = ctx();
  // Every prefix passed to upsertKeyedFlags_ anywhere, by literal or by constant.
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const consts = {};
  files.forEach(f => { const s = read(f); let m; const re = /\b([A-Z][A-Z_]*_)\s*=\s*'([^']+)'/g; while ((m = re.exec(s))) consts[m[1]] = m[2]; });
  const prefixes = [], unknown = [];
  files.forEach(f => {
    const s = read(f); let m; const re = /upsertKeyedFlags_\(\s*\w+\s*,\s*('([^']*)'|([A-Z_]+_))/g;
    while ((m = re.exec(s))) { const p = m[2] !== undefined ? m[2] : consts[m[3]]; if (p === undefined) unknown.push(f + ':' + m[3]); else prefixes.push(p); }
  });
  const missing = prefixes.filter(p => !c.flagAutoOf_(p + 'x'));
  check('every prefix a nightly check keeps is known as automatic (' + new Set(prefixes).size + ')', prefixes.length >= 15 && !missing.length && !unknown.length, J({ missing, unknown }));
  check('…and each says what clears it', c.AUTO_FLAG_KINDS_.every(k => /^Clears /.test(k.clears)));
  check('a one-off key, or none, is not automatic', !c.flagAutoOf_('water_bill_nov') && !c.flagAutoOf_('') && !c.flagAutoOf_(null));
  check('a vehicle renewal is', !!c.flagAutoOf_('vehicle_renewal_VEH-1_service_2027-03-08'));
}

console.log('\nResolve, Snooze and the read');
{
  const flags = [flagRow({ id: 'F1', key: 'vehicle_renewal_VEH-1_service_2027-03-08', due: '2027-03-08', escalated: '3d' }), flagRow({ id: 'F2', key: 'water_bill_nov' }), flagRow({ id: 'F3' })];
  let c = ctx(flags);
  const r1 = c.webResolve_('F1');
  check('Resolve on an automatic flag is refused, saying what clears it', r1.ok === false && r1.auto === true && /clears itself\. Clears once the new date is saved/.test(r1.error), J(r1));
  check('…and nothing is written', !c._sheets.Flags._writes.length);
  const r2 = c.webResolve_('F2');
  check('a one-off flag still resolves', r2.ok === true && c._sheets.Flags._all[2][8] === 'Yes');
  const got = c.webGetFlags_({ parameter: {} }).flags;
  const f1 = got.find(f => f.id === 'F1');
  check('the read: due, escalated, automatic and what clears it', f1.due === '2027-03-08' && f1.escalated === '3d' && f1.auto === true && /Clears once/.test(f1.clears), J(f1));
  check('…a one-off flag: not automatic, nothing to clear', got.find(f => f.id === 'F3').auto === false && got.find(f => f.id === 'F3').clears === '');
  c = ctx(flags);
  let s = c.webSnooze_('F2', null, '2027-03-15');
  check('snooze until a date', s.ok !== false && s.snoozedUntil === '2027-03-15' && c._sheets.Flags._all[2][7] === '2027-03-15', J(s));
  s = c.webSnooze_('F2', 2);
  check('…or for days, as before', s.snoozedUntil === '2027-03-12');
  check('…2 days when nothing is said', c.webSnooze_('F2').snoozedUntil === '2027-03-12');
  check('today or earlier is refused', c.webSnooze_('F2', null, TODAY).ok === false && c.webSnooze_('F2', null, '2027-03-01').ok === false);
  check('more than a year out is refused', c.webSnooze_('F2', null, '2028-03-10').ok === false && c.webSnooze_('F2', null, '2028-03-09').ok !== false);
  check('a non-date is refused', c.webSnooze_('F2', null, 'Monday').ok === false && c.webSnooze_('F2', null, '2027-04-31').ok === false && /must be a date/.test(c.webSnooze_('F2', null, '2027-04-31').error));
  check('days are capped at a year', c.flagSnoozeUntil_('', 9999, TODAY).until === '2028-03-09');
}

console.log('\na task made from a flag');
{
  const flags = [flagRow({ id: 'F1', flag: 'Water bill not marked paid', key: 'water_bill_nov', due: '2027-03-14' }), flagRow({ id: 'F2', flag: 'Service the Civic', key: 'vehicle_renewal_VEH-1_service_2027-03-08' })];
  let c = ctx(flags, [taskRow({ id: 'TASK-20270310-01', task: 'Something else' })]);
  const r = c.webFlagToTask_({ id: 'F1' });
  const row = c._sheets.Tasks._all[2];
  check('it takes the flag’s text and Due, and keeps the flag’s ID in Flagged', r.ok && r.created && row[1] === 'Water bill not marked paid' && row[3] === '2027-03-14' && row[7] === 'F1' && row[4] === 'Open', J(row));
  check('…the next ID of the day, a whole row of the new width', r.id === 'TASK-20270310-02' && c._sheets.Tasks._writes.some(w => Array.isArray(w[2]) && w[2][0].length === TASK_HEADERS.length));
  const again = c.webFlagToTask_({ id: 'F1' });
  check('asked again, the same open task, not a second', again.ok && again.existing && again.id === r.id && c._sheets.Tasks._all.length === 3);
  check('an unknown flag is refused', c.webFlagToTask_({ id: 'F9' }).ok === false);
  check('the task shows its flag on the Tasks tab', (() => { const t = c.webGetTasks_().tasks.find(x => x.id === r.id); return t && t.flag && t.flag.flag === 'Water bill not marked paid' && t.flag.resolved === false; })());
  // check it off
  let done = c.webCompleteTask_(r.id);
  check('checking it off stamps the day', c._sheets.Tasks._all[2][8] === TODAY && c._sheets.Tasks._all[2][4] === 'Done', J(c._sheets.Tasks._all[2]));
  check('…and resolves a one-off flag', done.flag === 'resolved' && c._sheets.Flags._all[1][8] === 'Yes', J(done));
  c.webFlagToTask_({ id: 'F2' });
  const autoTask = c._sheets.Tasks._all[c._sheets.Tasks._all.length - 1][0];
  done = c.webCompleteTask_(autoTask);
  check('an automatic flag is left for its check', done.flag === 'left' && c._sheets.Flags._all[2][8] === 'No', J(done));
  check('a task with no flag says nothing about one', c.webCompleteTask_('TASK-20270310-01').flag === '');
  check('the Completed header is labelled on an older tab', c._sheets.Tasks._all[0][8] === 'Completed');
  // recurring
  c = ctx([], [taskRow({ id: 'T-R', task: 'Water plants', due: '2027-03-09', recurring: 'Weekly' })]);
  done = c.webCompleteTask_('T-R');
  const next = c._sheets.Tasks._all[2];
  check('a recurring task’s next one is a whole row of the new width', done.recurring && next && next.length >= TASK_HEADERS.length && next[4] === 'Open' && next[8] === '', J(next));
}

console.log('\nDone this week, Reopen, Delete');
{
  const rows = [taskRow({ id: 'A', task: 'Today', status: 'Done', completed: TODAY }), taskRow({ id: 'B', task: 'Six days ago', status: 'Done', completed: '2027-03-04' }),
    taskRow({ id: 'C', task: 'Seven days ago', status: 'Done', completed: '2027-03-03' }), taskRow({ id: 'D', task: 'Open', status: 'Open' }),
    taskRow({ id: 'E', task: 'Done long ago, no day', status: 'Done' }), taskRow({ id: 'F', task: 'Cancelled', status: 'Cancelled', completed: TODAY })];
  const c = ctx([], rows);
  const week = c.webGetTasks_().doneThisWeek;
  check('the last 7 days, newest first; nothing open, undated or cancelled', J(week.map(t => t.id)) === J(['A', 'B']), J(week));
  const r = c.webReopenTask_('A');
  check('Reopen: Open again, its day cleared', r.ok && c._sheets.Tasks._all[1][4] === 'Open' && c._sheets.Tasks._all[1][8] === '');
  check('…an unknown task is refused', c.webReopenTask_('Z').ok === false);
  c.webDeleteTask_('D');
  check('Delete removes the row (the existing route)', !c._sheets.Tasks._all.some(rw => rw[0] === 'D'));
}

console.log('\nthe shape of the Tasks tab');
{
  check('TASK_HEADERS ends in Flagged, Completed', TASK_HEADERS.slice(-2).join() === 'Flagged,Completed');
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const short = [];
  files.forEach(f => { const s = read(f); let m; const re = /TASK_HEADERS\.length\)\s*\.setValues\(\[\[?([^\]]*)\]/g;
    while ((m = re.exec(s))) { let depth = 0, n = m[1].trim() ? 1 : 0; for (const ch of m[1]) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) n++; } if (m[1].trim() && n && n !== TASK_HEADERS.length && !/^row$/.test(m[1].trim())) short.push(f + ': ' + n); } });
  check('every whole-row task write has ' + TASK_HEADERS.length + ' values', !short.length, short.join(', '));
  check('the add route writes the new width', /\.setValues\(\[\[id, taskText, addedStr, dueDate, 'Open', recurring, notes, '', ''\]\]\);/.test(WEB));
  check('the routes', /case 'flag_to_task':\s+return jsonOut_\(webFlagToTask_\(e\.parameter\)\);/.test(WEB) && /case 'reopen_task':\s+return jsonOut_\(webReopenTask_\(id\)\);/.test(WEB)
    && /case 'snooze':\s+return jsonOut_\(webSnooze_\(id, days, e\.parameter\.until\)\);/.test(WEB));
}

console.log('\ntask IDs never repeat');
{
  // Today's 02 was deleted and 03 is still there: counting rows would hand out 03 again.
  const c = ctx([], [taskRow({ id: 'TASK-20270310-01' }), taskRow({ id: 'TASK-20270310-03', task: 'Water plants', recurring: 'Weekly', due: '2027-03-12' })]);
  const added = c.webAddTask_({ parameter: { task: 'New one' } });
  check('a new task takes one past the highest number used today, not a count of rows', added.id === 'TASK-20270310-04', added.id);
  const done = c.webCompleteTask_('TASK-20270310-03');
  check('…and so does the next copy of a recurring task', done.recurring && done.nextTaskId === 'TASK-20270310-05', JSON.stringify(done));
  const ids = c._sheets.Tasks._all.slice(1).map(r => r[0]);
  check('no two rows share an ID', new Set(ids).size === ids.length, JSON.stringify(ids));
  const fromFlag = ctx([flagRow({ id: 'F1', flag: 'Do the thing' })], [taskRow({ id: 'TASK-20270310-07' })]).webFlagToTask_({ id: 'F1' });
  check('a task made from a flag too', fromFlag.id === 'TASK-20270310-08', fromFlag.id);
  const src = WEB + FT;
  check('every task ID comes from taskNextId_, under the lock', !/'TASK-' \+ (dateKey|dateStr) \+ '-' \+ String\(seq\)/.test(src) && (src.match(/taskNextId_\((sheet|taskSheet), (dateKey|dateStr|Utilities)/g) || []).length === 5
        && /const newId = veraLocked_\(function\(\) \{\n    const nid = taskNextId_\(sheet, dateKey\);/.test(WEB) && /const taskId = veraLocked_\(function\(\) \{\n    const id = taskNextId_\(sheet, dateStr\);/.test(WEB)
        && /const taskId = veraLocked_\(function\(\) \{\n    const id = taskNextId_\(taskSheet, dateStr\);/.test(WEB));
}

console.log('\nGoogle Tasks: completing keeps the title');
{
  const calls = [];
  const lists = [{ id: 'L-MY' }, { id: 'L-HOME' }];
  const g = { String, Object, JSON, Logger: { log: () => {} },
    Tasks: { Tasklists: { list: () => ({ items: lists }) },
      Tasks: { get: (l, id) => { calls.push(['get', l, id]); if (l === 'L-HOME' && id === 'T2') return { id }; throw new Error('Not Found'); },
               patch: (body, l, id) => { calls.push(['patch', JSON.stringify(body), l, id]); return {}; },
               update: (body, l, id) => { calls.push(['update', JSON.stringify(body), l, id]); return {}; } } } };
  vm.createContext(g);
  vm.runInContext(fn(WEB, 'webCompleteGoogleTask_'), g);
  const r = g.webCompleteGoogleTask_({ parameter: { id: 'T1', listId: 'L-HOME' } });
  check('it patches only the status, so the title, notes and due date stay', r.ok && JSON.stringify(calls) === JSON.stringify([['patch', '{"status":"completed"}', 'L-HOME', 'T1']]), JSON.stringify(calls));
  check('…never a whole-task update', !/Tasks\.Tasks\.update\(/.test(fn(WEB, 'webCompleteGoogleTask_')));
  calls.length = 0;
  const r2 = g.webCompleteGoogleTask_({ parameter: { id: 'T2' } });
  check('no list given: the list that holds it is found, not just the first', r2.ok && calls.filter(x => x[0] === 'patch').length === 1 && calls.filter(x => x[0] === 'patch')[0][2] === 'L-HOME', JSON.stringify(calls));
  const r3 = g.webCompleteGoogleTask_({ parameter: { id: 'T9' } });
  check('a task in no list: says so, writes nothing', r3.ok === false && /wasn’t found/.test(r3.error) && !calls.some(x => x[3] === 'T9'));
  check('the list comes back with each task, and the dashboard sends it', /listId:\s+t\.__listId,/.test(WEB) && /t\.__listId = list\.id;/.test(WEB)
        && /'complete_google_task',gt\.listId\?\{id,listId:gt\.listId\}:\{id\}/.test(read('docs/app.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
