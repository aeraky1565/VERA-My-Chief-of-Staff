// Projects phase 1 — the derived model and the health verdict.
//
// The load-bearing rule is the one about stalled: a project may not be called
// stalled until it has a real Completed On stamp. Without it every project that
// predates the column reads as stalled the day this ships — a wall of false
// flags, which is precisely how a signal gets ignored. That rule is asserted
// here, not left as a comment.
//
// The REAL functions, brace-matched out of the source into a vm context.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const CODE  = fs.readFileSync(ROOT + '/Code.js',     'utf8');
const PROJ  = fs.readFileSync(ROOT + '/Projects.js', 'utf8');
const WEB   = fs.readFileSync(ROOT + '/WebApp.js',   'utf8');
const TASKS = fs.readFileSync(ROOT + '/Tasks.js',    'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractVar(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error('not found: ' + decl);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) + ';'; }
  }
  throw new Error('unbalanced: ' + decl);
}

const HDRS_SRC = CODE.match(/^const PROJECT_HEADERS +=.*;$/m)[0];

// Read the width from the constant rather than pinning it. Hardcoding the
// header list is what went stale in test_projectowner.js the moment a column
// was appended — and it fails in a confusing way, because a too-narrow fixture
// makes ensureProjectsSchema_ write the header row and inflate every
// "written in ONE setValues" count by one.
const H = JSON.parse(HDRS_SRC.slice(HDRS_SRC.indexOf('[')).replace(/;\s*$/, '').replace(/'/g, '"'));
const WIDTH = H.length;
const OLD8 = H.slice(0, 8);

// ---- dates, relative to today so the fixtures never go stale ---------------
const DAY = 86400000;
const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = d => new Date(today.getTime() + d * DAY).toISOString().slice(0, 10);

// ---- the fake sheet, faithful about width ----------------------------------
function makeSheet(rows, maxCols) {
  const data = rows.map(r => r.slice());
  let cols = maxCols || (rows[0] ? rows[0].length : 0);
  const sheet = {
    _rows: data, _writes: 0, _setValuesCalls: 0,
    getMaxColumns: () => cols,
    getLastRow: () => data.length,
    insertColumnsAfter: (_, n) => { cols += n; data.forEach(r => { while (r.length < cols) r.push(''); }); },
    getRange: (row, c, nr, nc) => {
      nr = nr === undefined ? 1 : nr;
      nc = nc === undefined ? 1 : nc;
      // Apps Script throws on a range wider than the sheet; a permissive fake
      // would let an over-wide write "pass" while the live sheet threw.
      if (c - 1 + nc > cols) throw new Error('range wider than sheet (' + (c - 1 + nc) + ' > ' + cols + ')');
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = [];
            for (let j = 0; j < nc; j++) {
              const s = data[row - 1 + i];
              r.push(s && s[c - 1 + j] !== undefined ? s[c - 1 + j] : '');
            }
            out.push(r);
          }
          return out;
        },
        getValue: () => {
          const s = data[row - 1];
          return s && s[c - 1] !== undefined ? s[c - 1] : '';
        },
        setValues: v => {
          sheet._writes++; sheet._setValuesCalls++;
          v.forEach((rv, i) => {
            while (!data[row - 1 + i]) data.push([]);
            rv.forEach((cv, j) => {
              const r = data[row - 1 + i];
              while (r.length <= c - 1 + j) r.push('');
              r[c - 1 + j] = cv;
            });
          });
        },
        setValue: v => {
          sheet._writes++;
          while (!data[row - 1]) data.push([]);
          const r = data[row - 1];
          while (r.length <= c - 1) r.push('');
          r[c - 1] = v;
        },
        setFontWeight: () => sheet,
        setBackground: () => sheet,
      };
    },
  };
  return sheet;
}

const PRELUDE = [
  HDRS_SRC,
  PROJ.match(/^var PROJECT_OWNERS_ +=.*;$/m)[0],
  PROJ.match(/^var PROJECT_STATUSES_ +=.*;$/m)[0],
  PROJ.match(/^var PROJECT_STALL_DAYS_DEFAULT_ +=.*;$/m)[0],
  PROJ.match(/^var PROJECT_AT_RISK_DAYS_DEFAULT_ +=.*;$/m)[0],
  extractVar(PROJ, 'var PROJ_COL = '),
  extractFn(TASKS, 'parseFlexibleDate'),
  extractFn(PROJ, 'normalizeProjectOwner_'),
  extractFn(PROJ, 'normalizeProjectStatus_'),
  extractFn(PROJ, 'projToday_'),
  extractFn(PROJ, 'projDateStr_'),
  extractFn(PROJ, 'projDaysUntil_'),
  extractFn(PROJ, 'projThreshold_'),
  extractFn(PROJ, 'ensureProjectsSchema_'),
  extractFn(PROJ, 'createProject_'),
  extractFn(PROJ, 'projectHealth_'),
  extractFn(PROJ, 'decorateProject_'),
  extractFn(PROJ, 'getProjects_'),
  extractFn(PROJ, 'setProjectTaskStatus_'),
  extractFn(PROJ, 'completeProjectTask_'),
  extractFn(PROJ, 'setProjectFields_'),
  extractFn(PROJ, 'reorderProjectTasks_'),
  extractFn(WEB,  'webAddProjectTask_'),
  extractFn(WEB,  'webUpdateProjectTask_'),
  extractFn(WEB,  'webSetProjectOwner_'),
  extractFn(WEB,  'webSetProjectTarget_'),
  extractFn(WEB,  'webReorderProjectTasks_'),
  extractFn(WEB,  'webCloseProject_'),
].join('\n');

function ctxFor(sheet, config) {
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, parseFloat, isNaN, Error, Object, Date, RegExp, Infinity,
    TABS: { PROJECTS: 'Projects' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    getConfigValues: () => config || {},
    Session:   { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      return f === 'yyyyMMdd' ? '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
                              : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(PRELUDE, ctx);
  return ctx;
}

// row helper: everything optional after the task text
function row(id, name, task, o) {
  o = o || {};
  var r = [id, name, task, o.status || 'Pending', o.priority || 'Medium', o.due || '',
           o.notes || '', o.owner || 'Shared', o.completed || '', o.target || '',
           o.phase || '', o.seq === undefined ? '' : o.seq];
  while (r.length < WIDTH) r.push('');   // stays the right width as columns are appended
  return r;
}

// ============================ the constant =================================

console.log('\nthe header constant');
{
  const ctx = ctxFor(makeSheet([H.slice()], WIDTH));
  const HH = vm.runInContext('PROJECT_HEADERS', ctx);
  check('the width matches the constant', HH.length === WIDTH, HH.length);
  check('the original 8 are unchanged and in order',
        JSON.stringify(HH.slice(0, 8)) === JSON.stringify(OLD8), HH.slice(0, 8).join(','));
  check('Completed On / Target Date / Phase / Sequence sit at 8-11',
        HH.slice(8, 12).join(',') === 'Completed On,Target Date,Phase,Sequence', HH.slice(8, 12).join(','));
  check('PROJ_COL matches the header positions',
        vm.runInContext('[PROJ_COL.COMPLETED_ON,PROJ_COL.TARGET_DATE,PROJ_COL.PHASE,PROJ_COL.SEQUENCE].join(",")', ctx)
          === '8,9,10,11');
  check('…and the original indices did not move',
        vm.runInContext('[PROJ_COL.ID,PROJ_COL.NAME,PROJ_COL.TASK,PROJ_COL.STATUS,PROJ_COL.PRIORITY,PROJ_COL.DUE,PROJ_COL.NOTES,PROJ_COL.OWNER].join(",")', ctx)
          === '0,1,2,3,4,5,6,7');
}

console.log('\nwidening an 8-column sheet');
{
  const sheet = makeSheet([
    OLD8.slice(),
    ['PROJ-A','Kitchen','Pick tiles','Pending','High','2026-02-01','showroom Sat','Victoria'],
  ], 8);
  const before = sheet._rows.slice(1).map(r => r.slice(0, 8).join('|'));
  const ctx = ctxFor(sheet);
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);

  check('widened to the full header width', sheet.getMaxColumns() === WIDTH, sheet.getMaxColumns());
  check('the appended headers are written',
        sheet._rows[0].slice(0, WIDTH).join(',') === H.join(','), sheet._rows[0].join(','));
  check('existing rows are byte-identical in their first 8 columns',
        JSON.stringify(sheet._rows.slice(1).map(r => r.slice(0, 8).join('|'))) === JSON.stringify(before));
  check('the new cells are blank, not undefined',
        sheet._rows.slice(1).every(r => r.slice(8).every(c => c === '')), JSON.stringify(sheet._rows[1]));

  const snap = JSON.stringify(sheet._rows), w = sheet._writes;
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);
  check('a second call changes nothing', JSON.stringify(sheet._rows) === snap);
  check('…and writes nothing', sheet._writes === w, sheet._writes + ' vs ' + w);
}

// ============================ statuses ======================================

console.log('\nnormalizeProjectStatus_');
{
  const ctx = ctxFor(makeSheet([H.slice()], WIDTH));
  const n = v => vm.runInContext('normalizeProjectStatus_(' + JSON.stringify(v) + ')', ctx);
  check("'' → Pending",           n('') === 'Pending', n(''));
  check("'blocked' → Blocked",    n('blocked') === 'Blocked', n('blocked'));
  check("'in progress' → In Progress", n('in progress') === 'In Progress', n('in progress'));
  check("'Done' → Done",          n('Done') === 'Done');
  check("'nonsense' → Pending",   n('nonsense') === 'Pending', n('nonsense'));
  // The whole codebase filters with `!== 'Done'`, so the new statuses must all
  // count as pending — otherwise a Blocked task would vanish from every count.
  check('every non-Done status is still "pending" under the existing filter',
        vm.runInContext("PROJECT_STATUSES_.filter(function(s){return s!=='Done';}).join(',')", ctx)
          === 'Pending,In Progress,Blocked');
}

// ============================ the stamp =====================================

console.log('\nCompleted On is stamped and cleared with the status');
{
  const sheet = makeSheet([H.slice(), row('PROJ-A','K','t1')], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext('completeProjectTask_(2)', ctx);
  check('ticking a task stamps today', sheet._rows[1][8] === iso(0), sheet._rows[1][8]);
  check('…and sets the status', sheet._rows[1][3] === 'Done', sheet._rows[1][3]);

  // Re-completing must not move the original date — it is what activity and
  // velocity are measured from.
  sheet._rows[1][8] = iso(-30);
  vm.runInContext('completeProjectTask_(2)', ctx);
  check('re-completing does NOT restamp', sheet._rows[1][8] === iso(-30), sheet._rows[1][8]);

  vm.runInContext("webUpdateProjectTask_({ parameter: { row:'2', status:'Pending' } })", ctx);
  check('moving back out of Done clears the stamp', sheet._rows[1][8] === '', JSON.stringify(sheet._rows[1][8]));
  check('…and writes the new status', sheet._rows[1][3] === 'Pending', sheet._rows[1][3]);
}

console.log('\nclosing a project stamps every task it marks Done');
{
  const sheet = makeSheet([
    H.slice(), row('PROJ-A','K','t1'), row('PROJ-A','K','t2',{status:'Done',completed:iso(-5)}),
    row('PROJ-B','T','tB'),
  ], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("webCloseProject_({ parameter: { projectId:'PROJ-A' } })", ctx);
  check('the pending task is stamped', sheet._rows[1][8] === iso(0), sheet._rows[1][8]);
  check('the already-done task keeps its original date', sheet._rows[2][8] === iso(-5), sheet._rows[2][8]);
  check('the other project is untouched', sheet._rows[3][3] === 'Pending', sheet._rows[3][3]);
}

// ============================ health ========================================

function healthOf(rows, config) {
  const sheet = makeSheet([H.slice()].concat(rows), 12);
  const ctx = ctxFor(sheet, config);
  return vm.runInContext('getProjects_()', ctx)[0];
}

console.log('\nstalled REQUIRES a real Completed On stamp');
{
  // A REAL legacy project: a dated id, because that is what every existing
  // project has. Using a fixture id with no parseable date would let this pass
  // for the wrong reason — a naive "fall back to the creation date"
  // implementation would have nothing to fall back to, and the assertion would
  // be green against the very bug it exists to catch.
  const OLD_ID = 'PROJ-' + iso(-400).replace(/-/g, '') + '-01';
  const p = healthOf([
    row(OLD_ID,'Old','t1',{status:'Done'}),
    row(OLD_ID,'Old','t2',{status:'Done'}),
    row(OLD_ID,'Old','t3'),
  ]);
  check('the fixture really is an old project', p.createdOn === iso(-400), p.createdOn);
  check('no stamps anywhere → lastActivity is blank', p.lastActivity === '', p.lastActivity);
  check('…daysSinceActivity is null, not the project age', p.daysSinceActivity === null, p.daysSinceActivity);
  check('…and a 400-day-old project is NOT called stalled', p.health !== 'stalled',
        p.health + ' / ' + p.healthReason);
  check('…it reads on_track', p.health === 'on_track', p.health);

  // The same project once it has one genuine stamp, long ago.
  const q = healthOf([
    row(OLD_ID,'Old','t1',{status:'Done',completed:iso(-40)}),
    row(OLD_ID,'Old','t2'),
  ]);
  check('one old stamp → stalled', q.health === 'stalled', q.health + ' / ' + q.healthReason);
  check('…and the reason names the gap since the STAMP, not since creation',
        /No activity for 40 days/.test(q.healthReason), q.healthReason);

  // Recent activity clears it, however old the project is.
  const r = healthOf([
    row(OLD_ID,'Old','t1',{status:'Done',completed:iso(-3)}),
    row(OLD_ID,'Old','t2'),
  ]);
  check('recent activity on an old project → on_track', r.health === 'on_track', r.health);
}

console.log('\nhealth precedence — the overlaps resolve one way, deliberately');
{
  // overdue beats stalled
  const a = healthOf([
    row('PROJ-A','X','t1',{status:'Done',completed:iso(-40)}),
    row('PROJ-A','X','t2',{due:iso(-2)}),
  ]);
  check('overdue AND inactive reads overdue', a.health === 'overdue', a.health + ' / ' + a.healthReason);
  check('…and counts the overdue tasks', a.overdueCount === 1, a.overdueCount);

  // blocked beats stalled — a project you cannot move is not one you neglect
  const b = healthOf([
    row('PROJ-A','X','t1',{status:'Done',completed:iso(-40)}),
    row('PROJ-A','X','t2',{status:'Blocked'}),
  ]);
  check('fully blocked AND inactive reads blocked', b.health === 'blocked', b.health + ' / ' + b.healthReason);

  // one blocked task among several is NOT a blocked project
  const c = healthOf([
    row('PROJ-A','X','t1',{status:'Blocked'}),
    row('PROJ-A','X','t2'),
  ]);
  check('one blocked task among pending ones is not a blocked project',
        c.health !== 'blocked', c.health);
  check('…but it is counted', c.blockedCount === 1, c.blockedCount);

  // target date passed with work left
  const d = healthOf([row('PROJ-A','X','t1',{target:iso(-3)})]);
  check('a passed target with work left reads overdue', d.health === 'overdue', d.health + ' / ' + d.healthReason);
  check('…and says how long ago', /passed 3d ago/.test(d.healthReason), d.healthReason);

  // at risk: target close, most work open
  const e = healthOf([
    row('PROJ-A','X','t1',{target:iso(3)}),
    row('PROJ-A','X','t2',{target:iso(3)}),
    row('PROJ-A','X','t3',{target:iso(3)}),
  ]);
  check('a close target with most work open reads at_risk', e.health === 'at_risk', e.health + ' / ' + e.healthReason);

  // …but not when it is nearly finished
  const f = healthOf([
    row('PROJ-A','X','t1',{target:iso(3),status:'Done',completed:iso(-1)}),
    row('PROJ-A','X','t2',{target:iso(3),status:'Done',completed:iso(-1)}),
    row('PROJ-A','X','t3',{target:iso(3),status:'Done',completed:iso(-1)}),
    row('PROJ-A','X','t4',{target:iso(3)}),
  ]);
  check('a close target on a nearly-finished project is not at_risk',
        f.health === 'on_track', f.health + ' / ' + f.healthReason + ' pct=' + f.pct);

  // all done
  const g = healthOf([row('PROJ-A','X','t1',{status:'Done',completed:iso(-1)})]);
  check('a finished project reads done', g.health === 'done', g.health);
}

console.log('\nthresholds come from Config');
{
  const rows = [row('PROJ-A','X','t1',{status:'Done',completed:iso(-10)}), row('PROJ-A','X','t2')];
  check('10 days idle is on_track at the default 14', healthOf(rows).health === 'on_track');
  check('…and stalled when Config says 7',
        healthOf(rows, { project_stall_days: '7' }).health === 'stalled',
        healthOf(rows, { project_stall_days: '7' }).health);
  check('a junk Config value falls back to the default',
        healthOf(rows, { project_stall_days: 'soon' }).health === 'on_track');
}

// ============================ next up =======================================

console.log('\nnextTask');
{
  const a = healthOf([row('PROJ-A','X','t1'), row('PROJ-A','X','t2',{status:'In Progress'})]);
  check('In Progress beats an earlier Pending task', a.nextTask && a.nextTask.task === 't2',
        a.nextTask && a.nextTask.task);

  const b = healthOf([row('PROJ-A','X','t1',{status:'Blocked'}), row('PROJ-A','X','t2')]);
  check('Blocked is skipped', b.nextTask && b.nextTask.task === 't2', b.nextTask && b.nextTask.task);

  const c = healthOf([row('PROJ-A','X','t1',{status:'Blocked'}), row('PROJ-A','X','t2',{status:'Blocked'})]);
  check('everything blocked → nextTask is null', c.nextTask === null, JSON.stringify(c.nextTask));

  const d = healthOf([row('PROJ-A','X','t1',{status:'Done',completed:iso(-1)})]);
  check('a finished project has no next task', d.nextTask === null, JSON.stringify(d.nextTask));
}

// ============================ order =========================================

console.log('\nSequence — order is a field, never a row position');
{
  const noSeq = healthOf([row('PROJ-A','X','a'), row('PROJ-A','X','b'), row('PROJ-A','X','c')]);
  check('a project with no sequences keeps sheet-row order',
        noSeq.tasks.map(t => t.task).join(',') === 'a,b,c', noSeq.tasks.map(t => t.task).join(','));

  const seq = healthOf([
    row('PROJ-A','X','a',{seq:3}), row('PROJ-A','X','b',{seq:1}), row('PROJ-A','X','c',{seq:2}),
  ]);
  check('sequences reorder the list', seq.tasks.map(t => t.task).join(',') === 'b,c,a',
        seq.tasks.map(t => t.task).join(','));
  check('rowNum still points at the original row',
        seq.tasks.map(t => t.rowNum).join(',') === '3,4,2', seq.tasks.map(t => t.rowNum).join(','));

  const half = healthOf([
    row('PROJ-A','X','a',{seq:2}), row('PROJ-A','X','b'), row('PROJ-A','X','c',{seq:1}),
  ]);
  check('an unsequenced row sorts after the sequenced ones',
        half.tasks.map(t => t.task).join(',') === 'c,a,b', half.tasks.map(t => t.task).join(','));
}

console.log('\nreordering writes the column once and never moves a row');
{
  const sheet = makeSheet([
    H.slice(), row('PROJ-A','X','a'), row('PROJ-B','Y','other'), row('PROJ-A','X','b'), row('PROJ-A','X','c'),
  ], WIDTH);
  const ctx = ctxFor(sheet);
  const before = sheet._rows.map(r => r[2]).join(',');
  sheet._setValuesCalls = 0;

  vm.runInContext("webReorderProjectTasks_({ parameter: { projectId:'PROJ-A', rowOrder:'5,2,4' } })", ctx);

  check('no row moved', sheet._rows.map(r => r[2]).join(',') === before, sheet._rows.map(r => r[2]).join(','));
  check('c,a,b got sequences 1,2,3',
        [sheet._rows[4][11], sheet._rows[1][11], sheet._rows[3][11]].join(',') === '1,2,3',
        [sheet._rows[4][11], sheet._rows[1][11], sheet._rows[3][11]].join(','));
  check("the other project's row is untouched", sheet._rows[2][11] === '', JSON.stringify(sheet._rows[2][11]));
  check('the column was written in ONE setValues', sheet._setValuesCalls === 1, sheet._setValuesCalls);

  const after = vm.runInContext('getProjects_()', ctx).find(p => p.projectId === 'PROJ-A');
  check('…and the read-back order matches', after.tasks.map(t => t.task).join(',') === 'c,a,b',
        after.tasks.map(t => t.task).join(','));

  // A row from another project would silently reorder someone else's work.
  let threw = '';
  try { vm.runInContext("webReorderProjectTasks_({ parameter: { projectId:'PROJ-A', rowOrder:'3' } })", ctx); }
  catch (err) { threw = err.message; }
  check('a foreign row number is refused', /not part of PROJ-A/.test(threw), threw);
}

console.log('\na task added later lands last');
{
  const sheet = makeSheet([H.slice(), row('PROJ-A','X','a',{seq:1}), row('PROJ-A','X','b',{seq:2})], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-A', task:'c' } })", ctx);
  const p = vm.runInContext('getProjects_()', ctx)[0];
  check('it sorts last', p.tasks.map(t => t.task).join(',') === 'a,b,c', p.tasks.map(t => t.task).join(','));
  check('…with sequence 3', sheet._rows[3][11] === 3, sheet._rows[3][11]);

  // On a project with no sequences at all, writing one would make the new task
  // the ONLY sequenced row and jump it to the top — the opposite of "last".
  const s2 = makeSheet([H.slice(), row('PROJ-B','Y','a'), row('PROJ-B','Y','b')], WIDTH);
  const c2 = ctxFor(s2);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-B', task:'c' } })", c2);
  check('an unsequenced project stays unsequenced', s2._rows[3][11] === '', JSON.stringify(s2._rows[3][11]));
  check('…and the new task still reads last',
        vm.runInContext('getProjects_()', c2)[0].tasks.map(t => t.task).join(',') === 'a,b,c');
}

// ============================ project-level fields ==========================

console.log('\nTarget Date is project-level, like Owner');
{
  const sheet = makeSheet([H.slice(), row('PROJ-A','X','a'), row('PROJ-B','Y','b'), row('PROJ-A','X','c')], WIDTH);
  const ctx = ctxFor(sheet);
  sheet._setValuesCalls = 0;
  vm.runInContext("webSetProjectTarget_({ parameter: { projectId:'PROJ-A', targetDate:'2026-11-01' } })", ctx);

  check('every row of the project gets it',
        sheet._rows[1][9] === '2026-11-01' && sheet._rows[3][9] === '2026-11-01',
        sheet._rows[1][9] + ' / ' + sheet._rows[3][9]);
  check('the other project is untouched', sheet._rows[2][9] === '', JSON.stringify(sheet._rows[2][9]));
  check('written in ONE setValues, not one per row', sheet._setValuesCalls === 1, sheet._setValuesCalls);
  check('it reads back on the project',
        vm.runInContext('getProjects_()', ctx).find(p => p.projectId === 'PROJ-A').targetDate === '2026-11-01');

  // Clearing is a real operation, not a missing argument.
  vm.runInContext("webSetProjectTarget_({ parameter: { projectId:'PROJ-A', targetDate:'' } })", ctx);
  check('a blank target clears it', sheet._rows[1][9] === '', JSON.stringify(sheet._rows[1][9]));
}

console.log('\nset_project_owner still works through the shared writer');
{
  const sheet = makeSheet([H.slice(), row('PROJ-A','X','a'), row('PROJ-A','X','b'), row('PROJ-B','Y','c')], WIDTH);
  const ctx = ctxFor(sheet);
  const res = vm.runInContext("webSetProjectOwner_({ parameter: { projectId:'PROJ-A', owner:'Victoria' } })", ctx);
  check('reports the owner back', res.owner === 'Victoria', res.owner);
  check('both rows updated', sheet._rows[1][7] === 'Victoria' && sheet._rows[2][7] === 'Victoria');
  check('the other project is untouched', sheet._rows[3][7] === 'Shared', sheet._rows[3][7]);
  check('rowsUpdated is right', res.rowsUpdated === 2, res.rowsUpdated);
}

console.log('\na new task inherits owner AND target date');
{
  const sheet = makeSheet([H.slice(),
    row('PROJ-A','X','a',{owner:'Victoria',target:'2026-11-01'})], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-A', task:'b', phase:'Admin' } })", ctx);
  const added = sheet._rows[2];
  check('owner carried across', added[7] === 'Victoria', added[7]);
  check('target date carried across', added[9] === '2026-11-01', added[9]);
  check('phase written', added[10] === 'Admin', added[10]);
  check('no completion stamp on a new task', added[8] === '', JSON.stringify(added[8]));
}

// ============================ phases ========================================

console.log('\nPhases');
{
  const p = healthOf([
    row('PROJ-A','X','a',{phase:'Planning'}),
    row('PROJ-A','X','b',{phase:'Planning'}),
    row('PROJ-A','X','c',{phase:'Logistics'}),
  ]);
  check('phases are listed in first-appearance order', p.phases.join(',') === 'Planning,Logistics', p.phases.join(','));
  check('each task keeps its phase', p.tasks.map(t => t.phase).join(',') === 'Planning,Planning,Logistics');

  const none = healthOf([row('PROJ-A','X','a'), row('PROJ-A','X','b')]);
  check('a project with no phases has an empty list', none.phases.length === 0, JSON.stringify(none.phases));
}

console.log('\ncreateProject_ parses the optional third field');
{
  const sheet = makeSheet([H.slice()], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("createProject_('Trip', ['Book flights|High|Logistics','Pack', 'Renew passport|Low|Admin'])", ctx);
  const rows = sheet._rows.slice(1);
  check('three rows', rows.length === 3, rows.length);
  check('phases land', rows.map(r => r[10]).join('|') === 'Logistics||Admin', rows.map(r => r[10]).join('|'));
  check('the two-field form still works', rows[1][4] === 'Medium' && rows[1][10] === '',
        rows[1][4] + '/' + rows[1][10]);
  check('priorities still land', rows.map(r => r[4]).join(',') === 'High,Medium,Low', rows.map(r => r[4]).join(','));
  check('sequence is written from the start', rows.map(r => r[11]).join(',') === '1,2,3', rows.map(r => r[11]).join(','));
  check('no completion stamps on a new project', rows.every(r => r[8] === ''));
}

// ============================ counts ========================================

console.log('\nderived counts');
{
  const p = healthOf([
    row('PROJ-A','X','a',{status:'Done',completed:iso(-1)}),
    row('PROJ-A','X','b',{status:'Blocked'}),
    row('PROJ-A','X','c',{due:iso(-1)}),
    row('PROJ-A','X','d'),
  ]);
  check('total', p.total === 4, p.total);
  check('done', p.done === 1, p.done);
  check('pending counts Blocked and In Progress', p.pending === 3, p.pending);
  check('pct', p.pct === 25, p.pct);
  check('overdueCount', p.overdueCount === 1, p.overdueCount);
  check('blockedCount', p.blockedCount === 1, p.blockedCount);
  check('createdOn is parsed free from the project id', p.createdOn === '', p.createdOn);

  const real = healthOf([row('PROJ-20260308-01','X','a')]);
  check('…and is a real date when the id has one', real.createdOn === '2026-03-08', real.createdOn);

  // A Done task must never be reported overdue just because its due date passed.
  const q = healthOf([row('PROJ-A','X','a',{status:'Done',completed:iso(-1),due:iso(-9)})]);
  check('a completed task is not overdue', q.overdueCount === 0, q.overdueCount);
  check('…and has no daysUntilDue', q.tasks[0].daysUntilDue === null, q.tasks[0].daysUntilDue);
}

// ============================ guards ========================================

console.log('\nevery PROJECT_HEADERS-wide range is still guarded');
{
  const files = ['Projects.js', 'WebApp.js', 'Memory.js', 'Code.js'];
  const unguarded = [];
  let swept = 0;
  files.forEach(f => {
    const s = fs.readFileSync(ROOT + '/' + f, 'utf8');
    let at = -1;
    while ((at = s.indexOf('PROJECT_HEADERS.length', at + 1)) !== -1) {
      if (!/getRange\s*\(/.test(s.slice(Math.max(0, at - 160), at))) continue;
      swept++;
      const before = s.slice(0, at);
      const fnAt = before.lastIndexOf('\nfunction ');
      const name = fnAt === -1 ? '(top level)' : before.slice(fnAt + 10, before.indexOf('(', fnAt)).trim();
      const upTo = fnAt === -1 ? before : before.slice(fnAt);
      if (!/ensureProjectsSchema_\s*\(/.test(upTo) && name !== 'ensureProjectsSchema_') unguarded.push(f + ' · ' + name);
    }
  });
  check('the sweep found the ranges', swept >= 4, swept + ' found');
  check('none is unguarded', unguarded.length === 0, unguarded.join(', '));
}

console.log('\nno status is written without going through the shared writer');
{
  // A direct setValue on the status column would mark a task Done with no
  // Completed On — exactly the drift the shared writer exists to prevent.
  const all = ['Projects.js', 'WebApp.js'].map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n');
  const direct = (all.match(/PROJ_COL\.STATUS \+ 1\)\s*\.setValue/g) || []).length;
  check('exactly one direct status write exists — the writer itself', direct === 1, direct);
  check('…and it is inside setProjectTaskStatus_',
        /PROJ_COL\.STATUS \+ 1\)\s*\.setValue/.test(extractFn(PROJ, 'setProjectTaskStatus_')));
  check('close_project routes through it', /setProjectTaskStatus_\s*\(/.test(extractFn(WEB, 'webCloseProject_')));
  check('update_project_task routes through it', /setProjectTaskStatus_\s*\(/.test(extractFn(WEB, 'webUpdateProjectTask_')));
  check('complete_project_task routes through it', /setProjectTaskStatus_\s*\(/.test(extractFn(PROJ, 'completeProjectTask_')));
}

console.log('\nthe endpoints are reachable');
{
  ['set_project_target', 'reorder_project_tasks'].forEach(a => {
    check("doGet routes '" + a + "'", new RegExp("case '" + a + "':").test(WEB));
  });
  check('close_project still routes', /case 'close_project':/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
