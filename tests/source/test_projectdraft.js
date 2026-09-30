// Project context, and VERA drafting the task list from it.
//
// The load-bearing rules:
//   1. draft_project_tasks WRITES NOTHING. The whole review-and-regenerate step
//      depends on it — if drafting touched the sheet, a draft you disliked would
//      already be 25 rows to delete.
//   2. One question round only. An endpoint that can bounce questions back
//      forever is worse than one that gives up once and says so.
//   3. Context is inherited everywhere a row is added, or a project silently
//      loses it the first time you add a task.
//
// The REAL functions, brace-matched into a vm context, with UrlFetchApp stubbed
// to return realistic Anthropic response bodies.
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
// A multi-line `var X = 'a' + \n 'b';` declaration, up to its terminating ;
function extractMultiline(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error('not found: ' + decl);
  const end = src.indexOf(";\n", start);
  return src.slice(start, end + 1);
}

const HDRS_SRC = CODE.match(/^const PROJECT_HEADERS +=.*;$/m)[0];
const HEADERS  = JSON.parse(HDRS_SRC.slice(HDRS_SRC.indexOf('[')).replace(/;\s*$/, '').replace(/'/g, '"'));
const WIDTH    = HEADERS.length;
const PREV12   = ['Project ID','Project Name','Task','Status','Priority','Due Date','Notes','Owner',
                  'Completed On','Target Date','Phase','Sequence'];

// ---- fake sheet, faithful about width --------------------------------------
function makeSheet(rows, maxCols) {
  const data = rows.map(r => r.slice());
  let cols = maxCols || (rows[0] ? rows[0].length : 0);
  const sheet = {
    _rows: data, _writes: 0, _setValuesCalls: 0,
    getMaxColumns: () => cols,
    getLastRow: () => data.length,
    insertColumnsAfter: (_, n) => { cols += n; data.forEach(r => { while (r.length < cols) r.push(''); }); },
    getRange: (row, c, nr, nc) => {
      nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
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
        getValue: () => { const s = data[row - 1]; return s && s[c - 1] !== undefined ? s[c - 1] : ''; },
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
  extractMultiline(PROJ, 'var PROJECT_PLAN_GUIDANCE_ ='),
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
  extractFn(PROJ, 'setProjectFields_'),
  extractFn(PROJ, 'getProjectsSummaryForContext_'),
  extractFn(WEB,  'webAddProjectTask_'),
  extractFn(WEB,  'webCreateProject_'),
  extractFn(WEB,  'webSetProjectContext_'),
  extractFn(WEB,  'webAppendProjectTasks_'),
  extractFn(WEB,  'webDraftProjectTasks_'),
].join('\n');

// Stub Claude. `reply` is the raw assistant text; `code` the HTTP status.
function ctxFor(sheet, claude) {
  claude = claude || {};
  const calls = [];
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, parseFloat, isNaN, Error, Object, Date, RegExp, Infinity,
    TABS: { PROJECTS: 'Projects' },
    CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
    CLAUDE_MODEL:   'claude-sonnet-4-6',
    getApiKey: () => 'k',
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    getConfigValues: () => ({}),
    Session:   { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      return f === 'yyyyMMdd' ? '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
                              : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } },
    Logger: { log: () => {} },
    fetchTracked_: (src, url, opts) => {
      calls.push(JSON.parse(opts.payload));
      return {
        getResponseCode: () => claude.code || 200,
        getContentText:  () => claude.raw !== undefined ? claude.raw
                             : JSON.stringify({ content: [{ text: claude.reply || '{}' }] }),
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(PRELUDE, ctx);
  ctx.__calls = calls;
  return ctx;
}

function row(id, name, task, o) {
  o = o || {};
  return [id, name, task, o.status || 'Pending', o.priority || 'Medium', o.due || '',
          o.notes || '', o.owner || 'Shared', o.completed || '', o.target || '',
          o.phase || '', o.seq === undefined ? '' : o.seq, o.context || ''];
}

const TASKS_REPLY = JSON.stringify({
  mode: 'tasks',
  assumptions: 'Assumed driving, two travellers, September.',
  tasks: [
    { task: 'Map the driving route',   priority: 'High',   phase: 'Planning'  },
    { task: 'Book the ferry crossing', priority: 'High',   phase: 'Logistics' },
    { task: 'Check passport expiry',   priority: 'Medium', phase: 'Admin'     },
  ],
});
const QUESTIONS_REPLY = JSON.stringify({
  mode: 'questions',
  questions: ['Driving or flying between cities?', 'How many weeks?', 'Which countries?'],
});

// ============================ schema ========================================

console.log('\nthe header constant');
{
  check('Context is appended last', HEADERS[WIDTH - 1] === 'Context', HEADERS.join(','));
  check('every previous column is unchanged and in order',
        JSON.stringify(HEADERS.slice(0, 12)) === JSON.stringify(PREV12), HEADERS.slice(0, 12).join(','));
  const ctx = ctxFor(makeSheet([HEADERS.slice()], WIDTH));
  check('PROJ_COL.CONTEXT points at it',
        vm.runInContext('PROJ_COL.CONTEXT', ctx) === WIDTH - 1, vm.runInContext('PROJ_COL.CONTEXT', ctx));
}

console.log('\nwidening a 12-column sheet');
{
  const sheet = makeSheet([
    PREV12.slice(),
    ['PROJ-A','Kitchen','t1','Pending','High','','','Victoria','','2026-12-01','Planning',1],
  ], 12);
  const before = sheet._rows.slice(1).map(r => r.slice(0, 12).join('|'));
  const ctx = ctxFor(sheet);
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);
  check('widened to the full header width', sheet.getMaxColumns() === WIDTH, sheet.getMaxColumns());
  check('the Context header is written', sheet._rows[0][WIDTH - 1] === 'Context', sheet._rows[0].join(','));
  check('existing rows are byte-identical in their first 12 columns',
        JSON.stringify(sheet._rows.slice(1).map(r => r.slice(0, 12).join('|'))) === JSON.stringify(before));
  const snap = JSON.stringify(sheet._rows), w = sheet._writes;
  vm.runInContext('ensureProjectsSchema_(getSpreadsheet().getSheetByName(TABS.PROJECTS));', ctx);
  check('a second call changes nothing', JSON.stringify(sheet._rows) === snap);
  check('…and writes nothing', sheet._writes === w);
}

// ============================ context plumbing ==============================

console.log('\ncontext is project-level, like owner and target date');
{
  const sheet = makeSheet([HEADERS.slice(),
    row('PROJ-A','Trip','t1'), row('PROJ-B','Other','x'), row('PROJ-A','Trip','t2')], WIDTH);
  const ctx = ctxFor(sheet);
  sheet._setValuesCalls = 0;
  vm.runInContext("webSetProjectContext_({ projectId:'PROJ-A', context:'Road trip across Europe' })", ctx);

  check('written to every row of the project',
        sheet._rows[1][12] === 'Road trip across Europe' && sheet._rows[3][12] === 'Road trip across Europe',
        sheet._rows[1][12] + ' / ' + sheet._rows[3][12]);
  check('the other project is untouched', sheet._rows[2][12] === '', JSON.stringify(sheet._rows[2][12]));
  check('one setValues, not one per row', sheet._setValuesCalls === 1, sheet._setValuesCalls);
  check('it reads back on the project',
        vm.runInContext('getProjects_()', ctx).find(p => p.projectId === 'PROJ-A').context === 'Road trip across Europe');
}

console.log('\na task added later inherits the context');
{
  const sheet = makeSheet([HEADERS.slice(),
    row('PROJ-A','Trip','t1',{owner:'Victoria',target:'2026-12-01',context:'Cruise to the Greek islands',seq:1})], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("webAddProjectTask_({ parameter: { projectId:'PROJ-A', task:'t2' } })", ctx);
  const added = sheet._rows[2];
  check('context carried across', added[12] === 'Cruise to the Greek islands', added[12]);
  check('owner still carried across', added[7] === 'Victoria', added[7]);
  check('target date still carried across', added[9] === '2026-12-01', added[9]);
  check('the row is a full header width', added.length === WIDTH, added.length);
}

console.log('\ncreateProject_ writes the context on every row');
{
  const sheet = makeSheet([HEADERS.slice()], WIDTH);
  const ctx = ctxFor(sheet);
  vm.runInContext("createProject_('Europe', ['a|High|Planning','b'], 'Ahmed', 'Road trip, 3 weeks')", ctx);
  const rows = sheet._rows.slice(1);
  check('both rows carry it', rows.every(r => r[12] === 'Road trip, 3 weeks'), rows.map(r => r[12]).join('|'));
  check('no context given → blank, not undefined', (() => {
    const s2 = makeSheet([HEADERS.slice()], WIDTH); const c2 = ctxFor(s2);
    vm.runInContext("createProject_('X', ['a'])", c2);
    return s2._rows[1][12] === '';
  })());
}

console.log('\nwebCreateProject_ takes a POST body as well as e.parameter');
{
  const sheet = makeSheet([HEADERS.slice()], WIDTH);
  const ctx = ctxFor(sheet);
  // A POST body is a plain object — no e.parameter wrapper.
  vm.runInContext("webCreateProject_({ name:'Europe', tasks:'a\\nb', owner:'Shared', context:\"Ahmed's road trip\", targetDate:'2026-12-01' })", ctx);
  const rows = sheet._rows.slice(1);
  check('two rows written', rows.length === 2, rows.length);
  check('context survives an apostrophe', rows[0][12] === "Ahmed's road trip", rows[0][12]);
  check('the target date lands on every row', rows.every(r => r[9] === '2026-12-01'), rows.map(r => r[9]).join('|'));

  // …and still works the old way.
  const s2 = makeSheet([HEADERS.slice()], WIDTH); const c2 = ctxFor(s2);
  vm.runInContext("webCreateProject_({ parameter: { name:'Old', tasks:'a' } })", c2);
  check('the GET shape still works', s2._rows[1][2] === 'a', JSON.stringify(s2._rows[1]));
}

console.log('\ncontext reaches the chat summary');
{
  const sheet = makeSheet([HEADERS.slice(),
    row('PROJ-A','Europe Trip','t1',{context:'Road trip across Europe with Victoria'})], WIDTH);
  const ctx = ctxFor(sheet);
  const summary = vm.runInContext('getProjectsSummaryForContext_()', ctx);
  check('the project name is there', /Europe Trip/.test(summary), summary);
  check('…and so is what it is FOR', /Road trip across Europe/.test(summary), summary);

  // Long context must be truncated, not dumped into the prompt whole.
  const long = 'x'.repeat(400);
  const s2 = makeSheet([HEADERS.slice(), row('PROJ-A','P','t1',{context:long})], WIDTH);
  const sum2 = vm.runInContext('getProjectsSummaryForContext_()', ctxFor(s2));
  check('a long context is truncated', sum2.length < 300 && /…/.test(sum2), sum2.length);
}

// ============================ drafting ======================================

console.log('\ndraft_project_tasks WRITES NOTHING');
{
  for (const [label, reply] of [['tasks', TASKS_REPLY], ['questions', QUESTIONS_REPLY]]) {
    const sheet = makeSheet([HEADERS.slice(), row('PROJ-A','Trip','t1')], WIDTH);
    const ctx = ctxFor(sheet, { reply });
    const before = JSON.stringify(sheet._rows);
    vm.runInContext("webDraftProjectTasks_({ name:'Europe', context:'A road trip', round:1 })", ctx);
    check('a ' + label + ' reply leaves the sheet untouched',
          JSON.stringify(sheet._rows) === before && sheet._writes === 0, sheet._writes + ' writes');
  }
}

console.log('\ndrafting — the tasks path');
{
  const ctx = ctxFor(makeSheet([HEADERS.slice()], WIDTH), { reply: TASKS_REPLY });
  const r = vm.runInContext("webDraftProjectTasks_({ name:'Europe', context:'A road trip across Europe', targetDate:'2026-12-01', round:1 })", ctx);
  check('mode is tasks', r.mode === 'tasks', r.mode);
  check('three tasks come back', r.tasks.length === 3, r.tasks.length);
  check('each carries priority and phase',
        r.tasks.every(t => t.task && t.priority && t.phase), JSON.stringify(r.tasks[0]));
  check('the assumptions line is passed through',
        /Assumed driving/.test(r.assumptions), r.assumptions);

  // The prompt must actually carry the inputs, or the draft is generic.
  const prompt = ctx.__calls[0].messages[0].content;
  check('the prompt names the project', /Europe/.test(prompt));
  check('the prompt carries the context', /road trip across Europe/i.test(prompt));
  check('the prompt carries the target date', /2026-12-01/.test(prompt));
  check('the prompt uses the SHARED planning guidance',
        prompt.indexOf('the goal is that Ahmed misses nothing') !== -1);
  check('max_tokens is raised above callClaudeJson_’s 1024',
        ctx.__calls[0].max_tokens >= 3000, ctx.__calls[0].max_tokens);
}

console.log('\ndrafting — a bad priority is normalised, a blank task dropped');
{
  const reply = JSON.stringify({ mode:'tasks', tasks:[
    { task:'ok', priority:'URGENT', phase:'P' },
    { task:'',   priority:'High',   phase:'P' },
    { task:'no priority' },
  ]});
  const ctx = ctxFor(makeSheet([HEADERS.slice()], WIDTH), { reply });
  const r = vm.runInContext("webDraftProjectTasks_({ name:'X', context:'y', round:1 })", ctx);
  check('the blank task is dropped', r.tasks.length === 2, r.tasks.length);
  check('an unknown priority becomes Medium', r.tasks[0].priority === 'Medium', r.tasks[0].priority);
  check('a missing priority becomes Medium', r.tasks[1].priority === 'Medium', r.tasks[1].priority);
  check('a missing phase is blank, not undefined', r.tasks[1].phase === '', JSON.stringify(r.tasks[1].phase));
}

console.log('\ndrafting — the questions path, capped at ONE round');
{
  const ctx = ctxFor(makeSheet([HEADERS.slice()], WIDTH), { reply: QUESTIONS_REPLY });
  const r1 = vm.runInContext("webDraftProjectTasks_({ name:'Europe trip', context:'Europe trip', round:1 })", ctx);
  check('round 1 may ask', r1.mode === 'questions', r1.mode);
  check('at most four questions', r1.questions.length <= 4, r1.questions.length);
  check('round 1 invites questions in the prompt',
        /too thin to plan from/.test(ctx.__calls[0].messages[0].content));

  // Round 2 gets the SAME question-only reply. It must refuse, not re-ask.
  const ctx2 = ctxFor(makeSheet([HEADERS.slice()], WIDTH), { reply: QUESTIONS_REPLY });
  const r2 = vm.runInContext(
    "webDraftProjectTasks_({ name:'Europe trip', context:'Europe trip', round:2, answers:{'Driving or flying?':'Driving'} })", ctx2);
  check('round 2 does NOT return questions', r2.mode !== 'questions', r2.mode);
  check('…it reports a failure instead', r2.ok === false, JSON.stringify(r2));
  check('…with something a person can act on', /more detail/i.test(r2.error), r2.error);
  const p2 = ctx2.__calls[0].messages[0].content;
  check('round 2 forbids further questions in the prompt', /Do NOT ask anything further/.test(p2));
  check('round 2 passes the answers back', /Driving/.test(p2));
}

console.log('\ndrafting — failing closed');
{
  const bad = [
    ['malformed JSON',  { reply: 'here you go: {mode:tasks,,,' }],
    ['no JSON at all',  { reply: 'I am afraid I cannot help with that.' }],
    ['an empty body',   { reply: '' }],
    ['an HTTP 500',     { code: 500, reply: TASKS_REPLY }],
    ['an unparseable envelope', { raw: 'not json' }],
  ];
  bad.forEach(([label, claude]) => {
    const sheet = makeSheet([HEADERS.slice()], WIDTH);
    const ctx = ctxFor(sheet, claude);
    const r = vm.runInContext("webDraftProjectTasks_({ name:'X', context:'y', round:1 })", ctx);
    check(label + ' → ok:false, not a half-parsed list', r.ok === false, JSON.stringify(r).slice(0, 90));
    check('…and nothing was written', sheet._writes === 0, sheet._writes);
  });
}

console.log('\ndrafting — suggest-more passes the tasks already there');
{
  const ctx = ctxFor(makeSheet([HEADERS.slice()], WIDTH), { reply: TASKS_REPLY });
  vm.runInContext("webDraftProjectTasks_({ name:'Europe', context:'road trip', round:1, existingTasks:[{task:'Map the driving route'}] })", ctx);
  const prompt = ctx.__calls[0].messages[0].content;
  check('the prompt lists what is already there', /Map the driving route/.test(prompt));
  check('…and says not to repeat it', /do NOT repeat these/i.test(prompt));
}

// ============================ appending =====================================

console.log('\nappend_project_tasks');
{
  const sheet = makeSheet([HEADERS.slice(),
    row('PROJ-A','Trip','a',{owner:'Victoria',target:'2026-12-01',context:'Road trip',seq:1}),
    row('PROJ-B','Other','x'),
    row('PROJ-A','Trip','b',{owner:'Victoria',target:'2026-12-01',context:'Road trip',seq:2}),
  ], WIDTH);
  const ctx = ctxFor(sheet);
  sheet._setValuesCalls = 0;
  const r = vm.runInContext("webAppendProjectTasks_({ projectId:'PROJ-A', tasks:[{task:'c',priority:'High',phase:'Admin'},{task:'d'}] })", ctx);

  check('reports what it added', r.added === 2, r.added);
  check('appended in ONE setValues', sheet._setValuesCalls === 1, sheet._setValuesCalls);
  check('existing rows untouched', sheet._rows.slice(1, 4).map(x => x[2]).join(',') === 'a,x,b',
        sheet._rows.slice(1, 4).map(x => x[2]).join(','));
  const c = sheet._rows[4], d = sheet._rows[5];
  check('sequence continues from the max', c[11] === 3 && d[11] === 4, c[11] + ',' + d[11]);
  check('owner inherited', c[7] === 'Victoria', c[7]);
  check('target inherited', c[9] === '2026-12-01', c[9]);
  check('context inherited', c[12] === 'Road trip', c[12]);
  check('phase written', c[10] === 'Admin', c[10]);
  check('a missing priority becomes Medium', d[4] === 'Medium', d[4]);
  check('no completion stamp on an appended task', c[8] === '', JSON.stringify(c[8]));

  const p = vm.runInContext('getProjects_()', ctx).find(x => x.projectId === 'PROJ-A');
  check('they read back in order', p.tasks.map(t => t.task).join(',') === 'a,b,c,d',
        p.tasks.map(t => t.task).join(','));
}

console.log('\nappend_project_tasks — the refusals');
{
  const sheet = makeSheet([HEADERS.slice(), row('PROJ-A','Trip','a')], WIDTH);
  const ctx = ctxFor(sheet);
  const bad = [
    ["no projectId",    "webAppendProjectTasks_({ tasks:[{task:'c'}] })",                 /projectId is required/],
    ["unknown project", "webAppendProjectTasks_({ projectId:'NOPE', tasks:[{task:'c'}] })", /Project not found/],
    ["empty list",      "webAppendProjectTasks_({ projectId:'PROJ-A', tasks:[] })",        /non-empty array/],
    ["all blank tasks", "webAppendProjectTasks_({ projectId:'PROJ-A', tasks:[{task:'  '}] })", /No usable tasks/],
  ];
  bad.forEach(([label, code, re]) => {
    let threw = '';
    try { vm.runInContext(code, ctx); } catch (e) { threw = e.message; }
    check(label + ' throws', re.test(threw), threw);
  });
  check('…and nothing was appended', sheet._rows.length === 2, sheet._rows.length);

  // An unsequenced project must stay unsequenced, or the appended task jumps
  // to the top as the only row with a sequence.
  const s2 = makeSheet([HEADERS.slice(), row('PROJ-A','Trip','a'), row('PROJ-A','Trip','b')], WIDTH);
  const c2 = ctxFor(s2);
  vm.runInContext("webAppendProjectTasks_({ projectId:'PROJ-A', tasks:[{task:'c'}] })", c2);
  check('an unsequenced project stays unsequenced', s2._rows[3][11] === '', JSON.stringify(s2._rows[3][11]));
  check('…and the appended task still reads last',
        vm.runInContext('getProjects_()', c2)[0].tasks.map(t => t.task).join(',') === 'a,b,c');
}

// ============================ anti-drift ====================================

console.log('\nthe planning guidance exists exactly once');
{
  // Two copies of "how VERA plans a project" would answer the same question
  // differently in chat and in the dashboard. That is what the constant exists
  // to prevent, so the duplication is what gets asserted.
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'playwright.config.js');
  const NEEDLE = 'the goal is that Ahmed misses nothing';
  let copies = 0;
  files.forEach(f => {
    copies += (fs.readFileSync(ROOT + '/' + f, 'utf8').split(NEEDLE).length - 1);
  });
  check('the guidance text appears once across the project', copies === 1, copies + ' copies');
  check('it lives in Projects.js', PROJ.indexOf(NEEDLE) !== -1);
  check('Chat.js references the constant instead of repeating it',
        /PROJECT_PLAN_GUIDANCE_/.test(fs.readFileSync(ROOT + '/Chat.js', 'utf8')));
  check('the drafting endpoint references it too',
        /PROJECT_PLAN_GUIDANCE_/.test(extractFn(WEB, 'webDraftProjectTasks_')));
}

console.log('\nthe endpoints are reachable');
{
  ['draft_project_tasks', 'append_project_tasks', 'set_project_context'].forEach(a => {
    check("routed: '" + a + "'", new RegExp("case '" + a + "':").test(WEB));
  });
  // The POST switch specifically — the context is prose and a query string
  // mangles it, so a GET-only route would defeat the point.
  const doPost = extractFn(WEB, 'doPost');
  ['draft_project_tasks', 'create_project', 'append_project_tasks', 'set_project_context'].forEach(a => {
    check("doPost routes '" + a + "'", doPost.indexOf("case '" + a + "':") !== -1);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
