// Issue 199 — project ownership, server side.
//
// Projects gain an Owner column (Ahmed / Victoria / Shared). The column is
// APPENDED, so every existing column keeps its index and nothing has to move —
// but a live Projects tab is 7 columns wide and every read here takes a range
// PROJECT_HEADERS.length wide, which throws outright once the constant says 8.
// ensureProjectsSchema_ is what stops that, and this proves it.
//
// The REAL functions, brace-matched out of the source into a vm context. Never
// a copy — a copy would pass while the shipped code was broken.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT  = process.env.VERA_ROOT || REPO;
const CODE  = fs.readFileSync(ROOT + '/Code.js',     'utf8');
const PROJ  = fs.readFileSync(ROOT + '/Projects.js', 'utf8');
const WEB   = fs.readFileSync(ROOT + '/WebApp.js',   'utf8');

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
const OWNERS_SRC = PROJ.match(/^var PROJECT_OWNERS_ +=.*;$/m)[0];
const COL_SRC  = extractVar(PROJ, 'var PROJ_COL = ');

const OLD7 = ['Project ID','Project Name','Task','Status','Priority','Due Date','Notes'];
// Read the real width rather than pinning a number that goes stale the moment a
// column is appended — which is exactly what happened to this suite.
const PROJECT_HEADERS_ARR = JSON.parse(HDRS_SRC.slice(HDRS_SRC.indexOf('[')).replace(/;\s*$/, '').replace(/'/g, '"'));
const PROJECT_HEADERS_LEN = PROJECT_HEADERS_ARR.length;

// ---- a fake sheet that records what was written ----------------------------

function makeSheet(rows, maxCols) {
  const data = rows.map(r => r.slice());
  let cols = maxCols || (rows[0] ? rows[0].length : 0);
  const sheet = {
    _rows: data,
    _writes: 0,
    getMaxColumns: () => cols,
    getLastRow: () => data.length,
    insertColumnsAfter: (_, n) => {
      cols += n;
      data.forEach(r => { while (r.length < cols) r.push(''); });
    },
    getRange: (row, c, nr, nc) => {
      nr = nr === undefined ? 1 : nr;
      nc = nc === undefined ? 1 : nc;
      // Apps Script throws on a range wider than the sheet. Modelling that is
      // the whole point here — a permissive fake would let an 8-column write
      // onto a 7-column tab "pass" while the live sheet threw.
      if (c - 1 + nc > cols) {
        throw new Error('The number of columns in the range must be at least 1');
      }
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = [];
            for (let j = 0; j < nc; j++) {
              const src = data[row - 1 + i];
              r.push(src && src[c - 1 + j] !== undefined ? src[c - 1 + j] : '');
            }
            out.push(r);
          }
          return out;
        },
        setValues: v => {
          sheet._writes++;
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

// Shared prelude: the constants plus every function under test, in one global
// scope — which is how Apps Script actually runs these files.
const TASKS = fs.readFileSync(ROOT + '/Tasks.js', 'utf8');
const STATUSES_SRC = PROJ.match(/^var PROJECT_STATUSES_ +=.*;$/m)[0];
const STALL_SRC    = PROJ.match(/^var PROJECT_STALL_DAYS_DEFAULT_ +=.*;$/m)[0];
const RISK_SRC     = PROJ.match(/^var PROJECT_AT_RISK_DAYS_DEFAULT_ +=.*;$/m)[0];

const PRELUDE = [
  HDRS_SRC,
  OWNERS_SRC,
  STATUSES_SRC,
  STALL_SRC,
  RISK_SRC,
  COL_SRC,
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
  extractFn(PROJ, 'setProjectFields_'),
  extractFn(WEB,  'webAddProjectTask_'),
  extractFn(WEB,  'webSetProjectOwner_'),
].join('\n');

function ctxFor(sheet) {
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, parseFloat, isNaN, Error, Object, Date, RegExp, Infinity,
    TABS: { PROJECTS: 'Projects' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    getConfigValues: () => ({}),
    Session:   { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => '20260921' },
    Logger:    { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(PRELUDE, ctx);
  return ctx;
}

// ---- the constant ----------------------------------------------------------

console.log('\nthe header constant');
{
  const ctx = ctxFor(makeSheet([OLD7.slice()], 7));
  const H = vm.runInContext('PROJECT_HEADERS', ctx);
  check('Owner is present', H.indexOf('Owner') !== -1, H.join(','));
  check('the original 7 are unchanged and in order',
        JSON.stringify(H.slice(0, 7)) === JSON.stringify(OLD7), H.slice(0, 7).join(','));
  check('Owner is APPENDED, not inserted', H[7] === 'Owner', H[7]);
  check('PROJ_COL.OWNER points at it',
        vm.runInContext('PROJ_COL.OWNER', ctx) === 7, vm.runInContext('PROJ_COL.OWNER', ctx));
  check('…and every other index is untouched',
        vm.runInContext('[PROJ_COL.ID,PROJ_COL.NAME,PROJ_COL.TASK,PROJ_COL.STATUS,PROJ_COL.PRIORITY,PROJ_COL.DUE,PROJ_COL.NOTES].join(",")', ctx)
          === '0,1,2,3,4,5,6');
}

// ---- normalizeProjectOwner_ ------------------------------------------------

console.log('\nnormalizeProjectOwner_ — anything unrecognised is Shared');
{
  const ctx = ctxFor(makeSheet([OLD7.slice()], 7));
  const n = v => vm.runInContext('normalizeProjectOwner_(' + JSON.stringify(v) + ')', ctx);
  check("'' → Shared",          n('') === 'Shared', n(''));
  check('null → Shared',        vm.runInContext('normalizeProjectOwner_(null)', ctx) === 'Shared');
  check('undefined → Shared',   vm.runInContext('normalizeProjectOwner_(undefined)', ctx) === 'Shared');
  check("'nonsense' → Shared",  n('nonsense') === 'Shared', n('nonsense'));
  check("'Ahmed' → Ahmed",      n('Ahmed') === 'Ahmed', n('Ahmed'));
  check("'victoria' → Victoria (case-insensitive)", n('victoria') === 'Victoria', n('victoria'));
  check("'  SHARED ' → Shared (trimmed)", n('  SHARED ') === 'Shared', n('  SHARED '));
  // The sheet hands back numbers and Dates, not just strings.
  check('a number → Shared', vm.runInContext('normalizeProjectOwner_(42)', ctx) === 'Shared');
}

// ---- widening a live 7-column sheet ----------------------------------------

console.log('\nwidening a populated 7-column sheet');
{
  const sheet = makeSheet([
    OLD7.slice(),
    ['PROJ-20260101-01','Kitchen','Pick tiles','Pending','High','2026-02-01','showroom Sat'],
    ['PROJ-20260101-01','Kitchen','Book fitter','Done','Medium','',''],
  ], 7);
  const before = sheet._rows.slice(1).map(r => r.slice(0, 7).join('|'));
  const ctx = ctxFor(sheet);
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);

  check('the sheet is widened to the full header width',
        sheet.getMaxColumns() === PROJECT_HEADERS_LEN, sheet.getMaxColumns());
  check("the Owner header is written", sheet._rows[0][7] === 'Owner', sheet._rows[0].join(','));
  check('…and every other header matches the constant',
        sheet._rows[0].slice(0, PROJECT_HEADERS_LEN).join(',') === PROJECT_HEADERS_ARR.join(','),
        sheet._rows[0].join(','));
  check('existing data rows are byte-identical in their first 7 columns',
        JSON.stringify(sheet._rows.slice(1).map(r => r.slice(0, 7).join('|'))) === JSON.stringify(before),
        sheet._rows.slice(1).map(r => r.slice(0, 7).join('|')).join(' // '));
  check('their Owner cells are blank, not undefined',
        sheet._rows.slice(1).every(r => r[7] === ''), JSON.stringify(sheet._rows[1]));

  const snap = JSON.stringify(sheet._rows);
  const w = sheet._writes;
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);
  check('a second call changes nothing', JSON.stringify(sheet._rows) === snap);
  check('…and writes nothing', sheet._writes === w, sheet._writes + ' vs ' + w);
}

// ---- getProjects_ ----------------------------------------------------------

console.log('\ngetProjects_ — a blank Owner reads as Shared, with no write');
{
  // A live 7-column sheet, exactly as it stands today.
  const sheet = makeSheet([
    OLD7.slice(),
    ['PROJ-20260101-01','Kitchen','Pick tiles','Pending','High','',''],
    ['PROJ-20260101-01','Kitchen','Book fitter','Pending','Medium','',''],
  ], 7);
  const ctx = ctxFor(sheet);
  const projects = vm.runInContext('getProjects_()', ctx);

  check('it does not throw on a 7-column sheet', Array.isArray(projects));
  check('one project', projects.length === 1, projects.length);
  check("owner is 'Shared'", projects[0].owner === 'Shared', projects[0].owner);
  check('both tasks survive', projects[0].tasks.length === 2, projects[0].tasks.length);
  check('no Owner value was written to any data row',
        sheet._rows.slice(1).every(r => r[7] === ''), JSON.stringify(sheet._rows.slice(1)));
}

console.log('\ngetProjects_ — a named owner is carried through');
{
  const H = OLD7.concat(['Owner']);
  const sheet = makeSheet([
    H,
    ['PROJ-A','Kitchen','t1','Pending','High','','','Victoria'],
    ['PROJ-A','Kitchen','t2','Pending','High','','','Victoria'],
    ['PROJ-B','Taxes', 't1','Pending','High','','','Ahmed'],
    ['PROJ-C','Garden','t1','Pending','High','','',''],
  ], 8);
  const ctx = ctxFor(sheet);
  const byId = {};
  vm.runInContext('getProjects_()', ctx).forEach(p => { byId[p.projectId] = p; });

  check('Victoria project reads Victoria', byId['PROJ-A'].owner === 'Victoria', byId['PROJ-A'].owner);
  check('Ahmed project reads Ahmed',       byId['PROJ-B'].owner === 'Ahmed',    byId['PROJ-B'].owner);
  check('blank project reads Shared',      byId['PROJ-C'].owner === 'Shared',   byId['PROJ-C'].owner);

  // A half-written project (one row blank) must not read as Shared — the first
  // row that names an owner wins.
  const mixed = makeSheet([
    H,
    ['PROJ-D','Mixed','t1','Pending','High','','',''],
    ['PROJ-D','Mixed','t2','Pending','High','','','Victoria'],
  ], 8);
  const mctx = ctxFor(mixed);
  check('a project with one blank row still reads Victoria',
        vm.runInContext('getProjects_()', mctx)[0].owner === 'Victoria',
        vm.runInContext('getProjects_()', mctx)[0].owner);
}

// ---- createProject_ --------------------------------------------------------

console.log('\ncreateProject_ — the default is Shared');
{
  const sheet = makeSheet([OLD7.slice()], 7);
  const ctx = ctxFor(sheet);
  vm.runInContext("createProject_('Garden', ['Dig|High','Plant'])", ctx);
  const rows = sheet._rows.slice(1);
  check('two task rows written', rows.length === 2, rows.length);
  check('every row is Shared', rows.every(r => r[7] === 'Shared'),
        rows.map(r => r[7]).join(','));
  check('the sheet was widened first', sheet.getMaxColumns() === PROJECT_HEADERS_LEN, sheet.getMaxColumns());
}

console.log('\ncreateProject_ — an explicit owner lands on every row');
{
  const sheet = makeSheet([OLD7.concat(['Owner'])], 8);
  const ctx = ctxFor(sheet);
  vm.runInContext("createProject_('Baby stuff', ['A','B','C'], 'Victoria')", ctx);
  const rows = sheet._rows.slice(1);
  check('three rows', rows.length === 3, rows.length);
  check('all three say Victoria', rows.every(r => r[7] === 'Victoria'),
        rows.map(r => r[7]).join(','));
}

console.log('\ncreateProject_ — garbage owner falls back to Shared');
{
  const sheet = makeSheet([OLD7.concat(['Owner'])], 8);
  const ctx = ctxFor(sheet);
  vm.runInContext("createProject_('X', ['A'], 'nonsense')", ctx);
  check('written as Shared', sheet._rows[1][7] === 'Shared', sheet._rows[1][7]);
}

// ---- webSetProjectOwner_ ---------------------------------------------------

console.log('\nwebSetProjectOwner_ — every row of the project, and only that project');
{
  const sheet = makeSheet([
    OLD7.concat(['Owner']),
    ['PROJ-A','Kitchen','t1','Pending','High','','','Shared'],
    ['PROJ-B','Taxes',  't1','Pending','High','','','Shared'],
    ['PROJ-A','Kitchen','t2','Pending','High','','','Shared'],
    ['PROJ-A','Kitchen','t3','Done',   'Low', '','','Shared'],
  ], 8);
  const ctx = ctxFor(sheet);
  const res = vm.runInContext("webSetProjectOwner_({ parameter: { projectId:'PROJ-A', owner:'Victoria' } })", ctx);

  check('reports ok', res.ok === true);
  check('three rows updated', res.rowsUpdated === 3, res.rowsUpdated);
  check('every PROJ-A row is Victoria',
        sheet._rows.slice(1).filter(r => r[0] === 'PROJ-A').every(r => r[7] === 'Victoria'),
        sheet._rows.slice(1).map(r => r[0] + ':' + r[7]).join(' '));
  check('PROJ-B is untouched',
        sheet._rows.slice(1).find(r => r[0] === 'PROJ-B')[7] === 'Shared');
  check('a Done row is included too — owner is project-level, not task-level',
        sheet._rows.slice(1).find(r => r[2] === 't3')[7] === 'Victoria');

  // Nothing else on the row may move.
  check('the task text is unchanged',
        sheet._rows.slice(1).map(r => r[2]).join(',') === 't1,t1,t2,t3',
        sheet._rows.slice(1).map(r => r[2]).join(','));
}

console.log('\nwebSetProjectOwner_ — the failure modes');
{
  const sheet = makeSheet([
    OLD7.concat(['Owner']),
    ['PROJ-A','Kitchen','t1','Pending','High','','','Shared'],
  ], 8);
  const ctx = ctxFor(sheet);

  let threw = '';
  try { vm.runInContext("webSetProjectOwner_({ parameter: { owner:'Ahmed' } })", ctx); }
  catch (e) { threw = e.message; }
  check('a missing projectId throws', /projectId is required/.test(threw), threw);

  threw = '';
  try { vm.runInContext("webSetProjectOwner_({ parameter: { projectId:'NOPE', owner:'Ahmed' } })", ctx); }
  catch (e) { threw = e.message; }
  check('an unknown projectId throws', /Project not found/.test(threw), threw);
  check('…and wrote nothing', sheet._rows[1][7] === 'Shared', sheet._rows[1][7]);

  const res = vm.runInContext("webSetProjectOwner_({ parameter: { projectId:'PROJ-A', owner:'' } })", ctx);
  check('a blank owner normalizes to Shared rather than blanking the cell',
        res.owner === 'Shared' && sheet._rows[1][7] === 'Shared', res.owner + '/' + sheet._rows[1][7]);
}

console.log('\nwebSetProjectOwner_ widens a 7-column sheet before writing');
{
  const sheet = makeSheet([
    OLD7.slice(),
    ['PROJ-A','Kitchen','t1','Pending','High','',''],
  ], 7);
  const ctx = ctxFor(sheet);
  vm.runInContext("webSetProjectOwner_({ parameter: { projectId:'PROJ-A', owner:'Ahmed' } })", ctx);
  check('widened to the full header width', sheet.getMaxColumns() === PROJECT_HEADERS_LEN, sheet.getMaxColumns());
  check('Ahmed landed in column 8', sheet._rows[1][7] === 'Ahmed', JSON.stringify(sheet._rows[1]));
}

// ---- webAddProjectTask_ ----------------------------------------------------

console.log("webAddProjectTask_ — a new task inherits the project's owner");
{
  const sheet = makeSheet([
    OLD7.concat(['Owner']),
    ['PROJ-A','Kitchen','t1','Pending','High','','','Victoria'],
    ['PROJ-B','Taxes',  't1','Pending','High','','','Ahmed'],
  ], 8);
  const ctx = ctxFor(sheet);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-A', task:'t2', priority:'Low' } })", ctx);
  const added = sheet._rows[sheet._rows.length - 1];
  check('the row was appended', added[2] === 't2', JSON.stringify(added));
  check('it inherits Victoria, not Shared', added[7] === 'Victoria', added[7]);
  check('the project name still comes across', added[1] === 'Kitchen', added[1]);
  check('status defaults to Pending', added[3] === 'Pending', added[3]);

  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-B', task:'tB2' } })", ctx);
  check('a second project inherits its own owner',
        sheet._rows[sheet._rows.length - 1][7] === 'Ahmed',
        sheet._rows[sheet._rows.length - 1][7]);
}

console.log("webAddProjectTask_ — a project with no owner yet still writes Shared");
{
  const sheet = makeSheet([
    OLD7.slice(),
    ['PROJ-A','Kitchen','t1','Pending','High','',''],
  ], 7);
  const ctx = ctxFor(sheet);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-A', task:'t2' } })", ctx);
  const added = sheet._rows[sheet._rows.length - 1];
  check('Shared, never blank or undefined', added[7] === 'Shared', JSON.stringify(added));
  check('the row is a full header width', added.length === PROJECT_HEADERS_LEN, added.length);
}

// ---- the sites that would throw without the schema call --------------------

console.log('\nevery PROJECT_HEADERS-wide range is guarded');
{
  // A range sized by the constant against a narrower sheet is the failure this
  // whole column change risks, so the guard has to be present at each site
  // rather than assumed.
  function bodyOf(src, name) { return extractFn(src, name); }
  const guarded = [
    ['getProjects_',       bodyOf(PROJ, 'getProjects_')],
    ['createProject_',     bodyOf(PROJ, 'createProject_')],
    ['webAddProjectTask_', bodyOf(WEB,  'webAddProjectTask_')],
    // webSetProjectOwner_ delegates to setProjectFields_, so the guard lives
    // there now. Asserting on the caller would fail for the wrong reason.
    ['setProjectFields_',   bodyOf(PROJ, 'setProjectFields_')],
  ];
  guarded.forEach(([name, body]) => {
    check(name + ' calls ensureProjectsSchema_', /ensureProjectsSchema_\s*\(/.test(body));
  });

  const MEM = fs.readFileSync(ROOT + '/Memory.js', 'utf8');
  const at = MEM.indexOf('PROJECT_HEADERS.length');
  check('the Memory.js snapshot is guarded too',
        at !== -1 && /ensureProjectsSchema_\s*\(/.test(MEM.slice(Math.max(0, at - 400), at)),
        'PROJECT_HEADERS.length at ' + at);

  // And nowhere else takes such a range unguarded. Naming the four sites above
  // proves nothing about a fifth someone adds later, so this sweeps for every
  // getRange sized by the constant and asks whether its enclosing function
  // widens the sheet first.
  const files = ['Projects.js', 'WebApp.js', 'Memory.js', 'Code.js'];
  const unguarded = [];
  let swept = 0;
  files.forEach(f => {
    const s = fs.readFileSync(ROOT + '/' + f, 'utf8');
    let at = -1;
    while ((at = s.indexOf('PROJECT_HEADERS.length', at + 1)) !== -1) {
      // Not `[^)]*` between getRange( and the constant: the real calls contain
      // getLastRow(), whose closing paren ends such a match early and silently
      // hides the very sites this is looking for.
      const stmt = s.slice(Math.max(0, at - 160), at);
      if (!/getRange\s*\(/.test(stmt)) continue;
      swept++;
      const before = s.slice(0, at);
      const fnAt   = before.lastIndexOf('\nfunction ');
      const name   = fnAt === -1 ? '(top level)'
                                 : before.slice(fnAt + 10, before.indexOf('(', fnAt)).trim();
      // The enclosing scope, from the function keyword to the match, is enough:
      // the widen must happen BEFORE the range is taken, not after it.
      const upTo = fnAt === -1 ? before : before.slice(fnAt);
      if (!/ensureProjectsSchema_\s*\(/.test(upTo) && name !== 'ensureProjectsSchema_') {
        unguarded.push(f + ' · ' + name);
      }
    }
  });
  check('the sweep actually found the ranges', swept >= 4, swept + ' found');
  check('no PROJECT_HEADERS-wide getRange is left unguarded',
        unguarded.length === 0, unguarded.join(', '));
}

// ---- the router ------------------------------------------------------------

console.log('\nthe endpoint is reachable');
{
  check("doGet routes 'set_project_owner'",
        /case 'set_project_owner':\s*return jsonOut_\(webSetProjectOwner_\(e\)\);/.test(WEB));
  // A handler nobody can reach is the checkImportantDates_ failure mode again.
  check('…and the handler it names exists', WEB.indexOf('function webSetProjectOwner_(') !== -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
