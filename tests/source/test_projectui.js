// The Projects board (the shared ProjBoard block), in BOTH real pages, at phone and desktop
// width. Ahmed's dashboard: cards sorted by the server's verdict, owner pills, Next up across
// projects, a project open with its Needed by date and pace, phases with progress, ticks, the
// status chip and Waiting on, tap-to-move, dates that follow the target, adding a task, and
// the dialogs only that page has. Victoria's: the same board scoped to Shared + her own, with
// no create / edit / delete / close / Ask VERA. The scoping is the part worth proving: a
// filter that lets an Ahmed-only project through would undo issue 199. Every value here is
// invented. PROJ_QUICK (set by ctl_projects.js): the full dashboard at phone width only.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP  = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- ProjBoard (Projects) — SHARED VERBATIM', END = '// ---- /ProjBoard ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block');
check('both dashboards carry the ProjBoard block, word for word', block(APP).length > 5000 && block(APP) === block(LITE));
check('a project task in Coming up opens Projects, in both pages',
      [APP, LITE].every(x => x.indexOf("onClick:function(){if(it.section==='projects'){if(props.onOpenProjects)props.onOpenProjects();return;}") !== -1 && /project:'Project'\}/.test(x))
      && APP.indexOf("onOpenProjects:function(){setActiveTab('projects');loadProjects(apiUrl,apiToken);}") !== -1 && LITE.indexOf("onOpenProjects={() => setActiveTab('projects')}") !== -1);
check('the full page keeps the board mounted while it reloads', APP.indexOf("activeTab==='projects'&&(tabLoading.projects&&!projects.length?") !== -1);

// Dates are relative to today, as the board reads them.
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
const fmt = s => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s.slice(5, 7) - 1] + ' ' + (+s.slice(8, 10));

// Exactly the shape webGetProjects_ sends, derived fields included.
const t = (rowNum, task, o) => Object.assign(
  { rowNum, task, status:'Pending', priority:'Medium', dueDate:'', notes:'', phase:'', sequence:null,
    completedOn:'', isOverdue:false, daysUntilDue:null, before:null, waitingOn:'' }, o || {});
const A_TASKS = [
  t(2, 'Pick tiles',    { phase:'Planning',  sequence:1, before:30, dueDate:day(6) }),
  t(3, 'Measure units', { phase:'Planning',  sequence:2, dueDate:day(10) }),
  t(7, 'Book fitter',   { phase:'Logistics', sequence:3, before:14, dueDate:day(22) }),
  t(8, 'Order sink',    { status:'Done', phase:'Logistics', sequence:4, completedOn:day(-2) }),
];
const FIXTURE = [
  { projectId:'PROJ-A', projectName:'Kitchen refit', owner:'Shared', targetDate:day(36),
    context:'Replacing the units and worktop before the in-laws visit at Christmas.',
    total:4, done:1, pending:3, pct:25, health:'on_track', healthReason:'3 tasks to go', timePct:40, pace:'slightly',
    phases:['Planning','Logistics'], nextTask:A_TASKS[0], tasks:A_TASKS },
  { projectId:'PROJ-B', projectName:'Tax filing', owner:'Ahmed', targetDate:day(3),
    total:1, done:0, pending:1, pct:0, health:'at_risk', healthReason:'Target in 3d, 100% left', timePct:90, pace:'behind',
    phases:[], nextTask:t(4, 'Gather 1099s', { dueDate:day(1) }), tasks:[ t(4, 'Gather 1099s', { dueDate:day(1) }) ] },
  // Everything left is blocked: nothing to pick up.
  { projectId:'PROJ-C', projectName:'Baby registry', owner:'Victoria', targetDate:'',
    total:1, done:0, pending:1, pct:0, health:'blocked', healthReason:'All 1 remaining task is blocked', timePct:null, pace:'',
    phases:[], nextTask:null, tasks:[ t(5, 'Shortlist prams', { status:'Blocked', waitingOn:'the registry' }) ] },
  // No owner (reads as Shared), and the disagreement case: its task looks healthy, but the
  // server says overdue. The pages must show the server's verdict.
  { projectId:'PROJ-D', projectName:'Garage clear-out', targetDate:'',
    total:1, done:0, pending:1, pct:0, health:'overdue', healthReason:'Target date passed 3d ago, 1 task left', timePct:null, pace:'',
    phases:[], nextTask:t(6, 'Hire skip'), tasks:[ t(6, 'Hire skip') ] },
  { projectId:'PROJ-E', projectName:'Paint the hall', owner:'Shared', targetDate:'',
    total:1, done:1, pending:0, pct:100, health:'done', healthReason:'All tasks complete', timePct:null, pace:'',
    phases:[], nextTask:null, tasks:[ t(9, 'Paint', { status:'Done' }) ] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const QUICK = !!process.env.PROJ_QUICK;
  const ONLY = process.env.VERA_ONLY || '';

  // ======================= Ahmed's dashboard =============================
  for (const width of (ONLY === 'lite' ? [] : QUICK ? [390] : [390, 1280])) {
    const L = 'full ' + width;
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => typeof ProjectsBoard === 'function' && typeof ProjectsTab === 'function', null, { timeout:15000 }).catch(() => {});
    const wide = width >= 900;

    // The real ProjectsTab from the built page, with a recording call and every dialog captured.
    const mount = (projects) => page.evaluate((projects) => {
      document.querySelectorAll('.modal-overlay, #pprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'pprobe'; host.style.padding = '0 16px';
      document.body.prepend(host);
      window.__calls = []; window.__reply = {}; window.__reloads = 0; window.__ui = [];
      const C = ProjectsTab;
      window.__props = {
        projects, apiUrl:'https://vera.test/exec', apiToken:'t',
        reload: () => { window.__reloads++; },
        onCreateProject: () => window.__ui.push(['create']),
        onSuggestTasks: p => window.__ui.push(['suggest', p.projectId]),
        onEditTask: tk => window.__ui.push(['edit', tk.rowNum]),
        onCloseProject: p => window.__ui.push(['close', p.projectId]),
        onSetOwner: (p, o) => window.__ui.push(['owner', p.projectId, o]),
        onSetContext: (p, c) => window.__ui.push(['context', p.projectId, c]),
      };
      // The page's own call goes through apiGet; record what it would send instead.
      window.apiGet = (u, tok, params) => { window.__calls.push(params); return Promise.resolve(window.__reply[params.action] || { ok:true }); };
      ReactDOM.createRoot(host).render(React.createElement(C, window.__props));
      return new Promise(r => setTimeout(r, 200));
    }, projects);
    const txt = (sel) => page.$$eval('#pprobe ' + sel, ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    const click = (sel, re) => page.evaluate(({ sel, re }) => { const b = Array.from(document.querySelectorAll('#pprobe ' + sel)).find(x => !re || new RegExp(re).test((x.textContent || '') + '|' + (x.getAttribute('aria-label') || ''))); if (b) b.click(); return !!b; }, { sel, re }).then(r => wait(80).then(() => r));
    const calls = () => page.evaluate(() => window.__calls);
    const last = () => page.evaluate(() => JSON.stringify(window.__calls[window.__calls.length - 1] || null));
    const cardNames = () => txt('.pj-card .pj-card-name');

    await mount(FIXTURE);
    // ---- the list ----
    check(L + ': cards are sorted by the server verdict — overdue, at risk, blocked, on track',
          JSON.stringify(await cardNames()) === '["Garage clear-out","Tax filing","Baby registry","Kitchen refit"]', JSON.stringify(await cardNames()));
    const chips = await txt('.pj-card .pj-health'), reasons = await txt('.pj-card .pj-reason');
    check(L + ": each card shows the SERVER's verdict and reason, not its own",
          chips.join(',') === 'Overdue,At risk,Blocked,On track' && reasons[0] === 'Target date passed 3d ago, 1 task left', JSON.stringify([chips, reasons[0]]));
    check(L + ': a project with no owner is badged Shared', (await txt('.pj-card .pj-owner-badge'))[0] === 'Shared');
    check(L + ': a card counts its tasks and its date', (await txt('.pj-card .pj-progress'))[3] === '1 of 4 done' && (await txt('.pj-card .pj-target-text'))[3] === 'Needed by ' + fmt(day(36)) + ' · 36d');
    check(L + ': a card offers its next task; an all-blocked one offers none',
          JSON.stringify(await txt('.pj-card-next-name')) === '["Hire skip","Gather 1099s","Pick tiles"]', JSON.stringify(await txt('.pj-card-next-name')));
    check(L + ': the finished project is folded away under a count', (await txt('.pj-done-toggle'))[0] === '▸ Done projects (1)' && !(await cardNames()).includes('Paint the hall'));
    await click('.pj-done-toggle');
    check(L + ': …and opens on tap', (await cardNames()).includes('Paint the hall'));
    check(L + ': owner pills are All plus the three owners', JSON.stringify(await txt('.pj-owner')) === '["All","Shared","Ahmed","Victoria"]');
    await click('.pj-owner', '^Victoria');
    check(L + ': Victoria leaves only her project', JSON.stringify(await cardNames()) === '["Baby registry"]', JSON.stringify(await cardNames()));
    await click('.pj-owner', '^Shared');
    check(L + ': Shared keeps the explicit one and the blank one (and the finished one)', JSON.stringify(await cardNames()) === '["Garage clear-out","Kitchen refit","Paint the hall"]', JSON.stringify(await cardNames()));
    await click('.pj-owner', '^Ahmed'); await click('.pj-owner', '^Ahmed');
    check(L + ': Ahmed leaves only his', JSON.stringify(await cardNames()) === '["Tax filing"]');
    await click('.pj-owner', '^All');
    await click('.pj-next-tick', 'Pick tiles');
    check(L + ': ticking a card\'s Next up completes that row', await last() === '{"action":"complete_project_task","row":2}', await last());
    check(L + ': …Next up moves on at once, and the page reloads', (await txt('.pj-card-next-name'))[2] === 'Measure units' && await page.evaluate(() => window.__reloads) === 1, JSON.stringify(await txt('.pj-card-next-name')));
    await click('.pj-new');
    check(L + ': + New project opens the page\'s dialog', JSON.stringify(await page.evaluate(() => window.__ui)) === '[["create"]]');

    // ---- Next up ----
    await mount(FIXTURE);
    check(L + ': the switch counts what can be picked up', (await txt('.pj-tab-next'))[0] === 'Next up · 3');
    await click('.pj-tab-next');
    check(L + ': Next up lists one task per project, soonest first, undated last',
          JSON.stringify(await txt('.pj-next-task')) === '["Gather 1099s","Pick tiles","Hire skip"]' && (await txt('.pj-next-from'))[1] === 'Kitchen refit · Planning', JSON.stringify(await txt('.pj-next-task')));
    await click('.pj-next-start', 'Start');
    check(L + ': Start marks it in progress', await last() === '{"action":"update_project_task","row":4,"status":"In Progress"}' && (await txt('.pj-next-start'))[0] === 'In progress ✓', await last());
    await click('.pj-next-done');
    check(L + ': Done completes it', await last() === '{"action":"complete_project_task","row":4}', await last());
    await page.evaluate(() => { window.__calls = []; });
    await click('.pj-next-block');
    check(L + ': Blocked… sets it Blocked and opens its project, asking who it waits on',
          await last() === '{"action":"update_project_task","row":2,"status":"Blocked"}' && (await txt('.pj-title'))[0] === 'Kitchen refit' && (await page.$$('#pprobe .pj-wait')).length === 1, await last());
    await click('.pj-wait-pick', '^Victoria');
    check(L + ': picking a person saves Waiting on, and the row says so',
          await last() === '{"action":"update_project_task","row":2,"waitingOn":"Victoria"}' && (await txt('.pj-waiting'))[0] === 'Waiting on Victoria' && (await page.$$('#pprobe .pj-wait')).length === 0, await last());

    // ---- a project ----
    await mount(FIXTURE);
    await click('.pj-card-open', 'Kitchen refit');
    check(L + (wide ? ': the open project sits beside the list' : ': a card opens its project in place of the list'),
          (await txt('.pj-title'))[0] === 'Kitchen refit' && (wide ? (await cardNames()).length === 4 && (await page.$$('#pprobe .pj-back')).length === 0 : (await cardNames()).length === 0 && (await page.$$('#pprobe .pj-back')).length === 1));
    check(L + ': phases in order, each with its count', JSON.stringify(await page.$$eval('#pprobe .pj-phase-name', ns => ns.map(n => n.textContent))) === '["Planning","Logistics"]' && JSON.stringify(await txt('.pj-phase-count')) === '["0 of 2","1 of 2"]', JSON.stringify(await txt('.pj-phase-count')));
    const dues = await txt('.pj-due');
    check(L + ': a task set days before says so; a fixed one does not',
          dues[0] === fmt(day(6)) + ' · in 6d · 30d before' && dues[1] === fmt(day(10)) + ' · in 10d', JSON.stringify(dues));
    check(L + ': Needed by shows the date and days left', (await txt('.pj-target-date'))[0] === fmt(day(36)) + ' · 36 days left');
    check(L + ': the pace bar is the server\'s time used against work done', /^Time used 40% Work done 25%/.test((await txt('.pj-pace'))[0] || '') && (await txt('.pj-pace-word'))[0] === 'A little behind pace.', JSON.stringify(await txt('.pj-pace')));
    await click('.pj-later');
    check(L + ': +1 wk moves the target', await last() === JSON.stringify({ action:'set_project_target', projectId:'PROJ-A', targetDate:day(43) }), await last());
    const dues2 = await txt('.pj-due');
    check(L + ': …tasks set days before move with it; the fixed one stays', dues2[0].startsWith(fmt(day(13)) + ' ') && dues2[1].startsWith(fmt(day(10)) + ' '), JSON.stringify(dues2));
    await click('.pj-earlier');
    check(L + ': −1 wk moves it back', await last() === JSON.stringify({ action:'set_project_target', projectId:'PROJ-A', targetDate:day(36) }));
    await page.evaluate(() => { const b = document.querySelectorAll('#pprobe .pj-status')[1]; b.click(); }); await wait(80);
    const st = async () => (await txt('.pj-status'))[1];
    check(L + ': the status chip cycles Pending → In progress', await last() === '{"action":"update_project_task","row":3,"status":"In Progress"}' && await st() === 'In progress', await last());
    await page.evaluate(() => { const b = document.querySelectorAll('#pprobe .pj-status')[1]; b.click(); }); await wait(80);
    check(L + ': …→ Blocked, which asks who it waits on', await last() === '{"action":"update_project_task","row":3,"status":"Blocked"}' && await st() === 'Blocked' && (await page.$$('#pprobe .pj-wait')).length === 1);
    await page.fill('#pprobe .pj-wait-other input', 'the fitter'); await page.$eval('#pprobe .pj-wait-other', f => f.requestSubmit()); await wait(80);
    check(L + ': someone not on the list can be typed in', await last() === '{"action":"update_project_task","row":3,"waitingOn":"the fitter"}' && (await txt('.pj-waiting'))[0] === 'Waiting on the fitter', await last());
    await page.evaluate(() => { const b = document.querySelectorAll('#pprobe .pj-status')[1]; b.click(); }); await wait(80);
    check(L + ': …→ Pending again, and Waiting on goes with it', await last() === '{"action":"update_project_task","row":3,"status":"Pending"}' && (await page.$$('#pprobe .pj-waiting')).length === 0, await last());
    await click('.pj-check', 'Done: Measure units');
    check(L + ': a tick completes the task', await last() === '{"action":"complete_project_task","row":3}' && (await page.$$eval('#pprobe .pj-check[aria-pressed="true"]', n => n.length)) === 2);
    await click('.pj-check', 'Reopen: Measure units');
    check(L + ': ticking a done task reopens it', await last() === '{"action":"update_project_task","row":3,"status":"Pending"}', await last());
    await click('.pj-move', 'Move Measure units');
    check(L + ': Move offers places only in its own phase', (await page.$$('#pprobe .pj-drop')).length === 1 && (await page.$$('#pprobe .pj-drop-end')).length === 0 && /Moving “Measure units”/.test((await txt('.pj-moving'))[0] || ''), (await page.$$('#pprobe .pj-drop')).length);
    await click('.pj-drop');
    check(L + ': Move here sends the whole project in its new order', await last() === '{"action":"reorder_project_tasks","projectId":"PROJ-A","rowOrder":"3,2,7,8"}' && (await txt('.pj-task-name'))[0] === 'Measure units', await last());
    await click('.pj-move', 'Move Book fitter');
    const inPlanning = await page.$$eval('#pprobe .pj-phase', ss => ss[0].querySelectorAll('.pj-drop, .pj-drop-end').length);
    check(L + ': a task never moves across phases', inPlanning === 0 && (await page.$$('#pprobe .pj-drop-end')).length === 1, inPlanning);
    await click('.pj-drop-end');
    check(L + ': …Move to the end puts it last in its phase', await last() === '{"action":"reorder_project_tasks","projectId":"PROJ-A","rowOrder":"3,2,8,7"}', await last());
    await click('.pj-add');
    await page.fill('#pprobe .pj-add-form input[type="text"]', 'Order worktop');
    await page.selectOption('#pprobe .pj-add-form select', 'Logistics');
    await page.fill('#pprobe .pj-add-before', '10');
    await page.$eval('#pprobe .pj-add-form', f => f.requestSubmit()); await wait(80);
    check(L + ': adding a task sends its phase and days before', await last() === '{"action":"add_project_task","projectId":"PROJ-A","task":"Order worktop","phase":"Logistics","before":"10"}' && (await page.$$('#pprobe .pj-add-form')).length === 0, await last());
    await page.evaluate(() => { window.__ui = []; });
    await click('.pj-edit', 'Edit Pick tiles'); await click('.pj-suggest'); await click('.pj-close');
    await page.selectOption('#pprobe .pj-owner-set', 'Victoria');
    await click('.pj-context-edit');
    await page.fill('#pprobe .pj-context-form textarea', 'Units and worktop.'); await page.$eval('#pprobe .pj-context-form', f => f.requestSubmit()); await wait(80);
    check(L + ': Edit, Ask VERA, Close, the owner and the context reach the page\'s own handlers',
          JSON.stringify(await page.evaluate(() => window.__ui)) === '[["edit",2],["suggest","PROJ-A"],["close","PROJ-A"],["owner","PROJ-A","Victoria"],["context","PROJ-A","Units and worktop."]]', JSON.stringify(await page.evaluate(() => window.__ui)));
    await page.evaluate(() => { window.__reply.set_project_target = { ok:false, error:'The sheet is busy.' }; });
    await click('.pj-later');
    check(L + ': a failed save says why', (await txt('.pj-err'))[0] === 'The sheet is busy.', JSON.stringify(await txt('.pj-err')));
    const tgt = await page.$$eval('#pprobe .pj-check, #pprobe .pj-card-open, #pprobe .pj-later, #pprobe .pj-add, #pprobe .pj-tab-list, #pprobe .pj-suggest', bs => bs.map(b => Math.round(b.getBoundingClientRect().height)));
    check(L + ': ticks and buttons are at least 44px tall', tgt.length > 4 && tgt.every(x => x >= 44), JSON.stringify(tgt));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (!wide) {
      await click('.pj-back');
      check(L + ': ‹ All projects goes back to the list', (await cardNames()).length === 4);
    }
    await mount(FIXTURE);
    await click('.pj-card-open', 'Baby registry');
    check(L + ': a project with no date offers to set one', (await page.$$('#pprobe .pj-target-set')).length === 1 && (await page.$$('#pprobe .pj-pace')).length === 0 && (await txt('.pj-waiting'))[0] === 'Waiting on the registry');
    await mount([]);
    check(L + ': no projects says how to start one', /^No projects yet\. Start one with \+ New project/.test((await txt('.pj-none'))[0] || ''), JSON.stringify(await txt('.pj-none')));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));

    // The drafting checks below were written for the old tab and stand as they were.
    // ---- drafting: transport ------------------------------------------
    // The context is prose. The risk a query string carries is LENGTH, not
    // character corruption — Apps Script caps the request URL, and a long
    // context plus a token plus everything else runs past it. So what matters
    // is that the page uses POST and that a long context survives the round
    // trip intact.
    const LONG = 'A three-week road trip across Europe with Victoria.\n'
               + "We are driving, not flying between cities — Ahmed's car. " + 'x'.repeat(3000);
    const transport = await page.evaluate(async (ctxText) => {
      const seen = [];
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        seen.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, mode: 'tasks', tasks: [] }) });
      };
      try {
        await apiPost('https://vera.test/exec', 'tok',
                      { action: 'draft_project_tasks', name: 'Europe', context: ctxText });
      } catch (e) { /* the stub resolves; nothing to do */ }
      window.fetch = realFetch;
      const s = seen[0] || {};
      let parsed = null;
      try { parsed = JSON.parse(s.body); } catch (e) {}
      return { method: s.method, urlLen: s.url.length, context: parsed && parsed.context,
               action: parsed && parsed.action };
    }, LONG);

    check('the draft request is a POST', transport.method === 'POST', transport.method);
    check('…carrying the action in the body', transport.action === 'draft_project_tasks', transport.action);
    check('a 3000-character context survives intact', transport.context === LONG,
          'len ' + (transport.context || '').length + ' vs ' + LONG.length);
    check('…including the newline and the apostrophe',
          /\n/.test(transport.context || '') && /Ahmed's/.test(transport.context || ''));
    check('the URL stays short — the whole point of POST', transport.urlLen < 200, transport.urlLen);
    // The same payload as a query string is what POST is avoiding.
    check('as a query string it would be over 3000 chars',
          encodeURIComponent(LONG).length > 3000, encodeURIComponent(LONG).length);

    // ---- drafting: the modal flow --------------------------------------
    const mountModal = (reply1, reply2) => page.evaluate(({ reply1, reply2 }) => {
      document.querySelectorAll('.modal-overlay, #mprobe, #pprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'mprobe';
      document.body.appendChild(host);
      window.__draftCalls = []; window.__saved = [];
      const replies = [reply1, reply2];
      ReactDOM.createRoot(host).render(React.createElement(NewProjectModal, {
        busy: false,
        onClose: () => {},
        onSave: p => window.__saved.push(p),
        onDraft: p => { window.__draftCalls.push(p);
                        return Promise.resolve(replies[Math.min(window.__draftCalls.length - 1, 1)]); },
      }));
      return new Promise(r => setTimeout(r, 250));
    }, { reply1, reply2 });

    const QUESTIONS = { ok: true, mode: 'questions',
                        questions: ['Driving or flying?', 'How many weeks?'] };
    const DRAFT = { ok: true, mode: 'tasks', assumptions: 'Assumed driving, two travellers.',
                    tasks: [ { task: 'Map the route', priority: 'High',   phase: 'Planning' },
                             { task: 'Book ferries',  priority: 'Medium', phase: 'Logistics' },
                             { task: 'Check passports', priority: 'Low',  phase: 'Admin' } ] };

    // Thin context → VERA asks first.
    await mountModal(QUESTIONS, DRAFT);
    await page.fill('#mprobe input', 'Europe trip');
    await page.fill('#mprobe [data-project-context]', 'Europe trip');
    await page.click('#mprobe [data-draft-with-vera]');
    await page.waitForTimeout(300);

    let m = await page.evaluate(() => ({
      answers: document.querySelectorAll('#mprobe [data-draft-answer]').length,
      calls:   window.__draftCalls,
      saved:   window.__saved.length,
      review:  document.querySelectorAll('#mprobe [data-draft-review]').length,
    }));
    check('a thin context produces questions, not a plan', m.answers === 2, m.answers);
    check('…round 1 was requested', m.calls[0] && m.calls[0].round === 1, m.calls[0] && m.calls[0].round);
    check('…and nothing has been saved', m.saved === 0, m.saved);
    check('…and no review list is shown yet', m.review === 0, m.review);

    // Answer them → the plan.
    await page.fill('#mprobe [data-draft-answer="0"]', 'Driving');
    await page.fill('#mprobe [data-draft-answer="1"]', 'Three weeks');
    await page.click('#mprobe [data-draft-generate]');
    await page.waitForTimeout(300);

    m = await page.evaluate(() => ({
      rows:  document.querySelectorAll('#mprobe [data-draft-row]').length,
      assum: (document.querySelector('#mprobe [data-draft-assumptions]') || {}).textContent || '',
      calls: window.__draftCalls,
      saved: window.__saved.length,
    }));
    check('answering produces the review list', m.rows === 3, m.rows);
    check('…round 2 was requested', m.calls[1] && m.calls[1].round === 2, m.calls[1] && m.calls[1].round);
    check('…with the answers attached',
          m.calls[1] && m.calls[1].answers && m.calls[1].answers['Driving or flying?'] === 'Driving',
          JSON.stringify(m.calls[1] && m.calls[1].answers));
    check('VERA’s assumptions are shown', /Assumed driving/.test(m.assum), m.assum);
    check('STILL nothing saved while reviewing', m.saved === 0, m.saved);

    // Edit and delete in the draft, then create.
    await page.fill('#mprobe [data-draft-row="0"] input', 'Map the driving route');
    await page.click('#mprobe [data-draft-delete="2"]');
    await page.waitForTimeout(200);
    m = await page.evaluate(() => ({
      rows: document.querySelectorAll('#mprobe [data-draft-row]').length,
      saved: window.__saved.length,
    }));
    check('a drafted task can be removed before saving', m.rows === 2, m.rows);
    check('…and still nothing is saved', m.saved === 0, m.saved);

    await page.click('#mprobe [data-draft-create]');
    await page.waitForTimeout(250);
    const saved = await page.evaluate(() => window.__saved);
    check('Create finally saves', saved.length === 1, saved.length);
    check('…only the tasks left in the draft', saved[0].tasks.split('\n').length === 2, saved[0].tasks);
    check('…with the edit applied', /Map the driving route/.test(saved[0].tasks), saved[0].tasks);
    check('…as Task|Priority|Phase lines the server already parses',
          saved[0].tasks.split('\n')[0] === 'Map the driving route|High|Planning',
          saved[0].tasks.split('\n')[0]);
    check('…and the context travels with it', saved[0].context === 'Europe trip', saved[0].context);

    // Regenerate asks again and replaces the list.
    await mountModal(DRAFT, { ok: true, mode: 'tasks', assumptions: 'Second pass.',
                              tasks: [ { task: 'Only this', priority: 'High', phase: 'P' } ] });
    await page.fill('#mprobe input', 'Europe');
    await page.fill('#mprobe [data-project-context]', 'A road trip across Europe, three weeks, driving.');
    await page.click('#mprobe [data-draft-with-vera]');
    await page.waitForTimeout(300);
    check('a rich context skips the questions',
          (await page.evaluate(() => document.querySelectorAll('#mprobe [data-draft-row]').length)) === 3);
    await page.click('#mprobe [data-draft-regenerate]');
    await page.waitForTimeout(300);
    m = await page.evaluate(() => ({
      rows: document.querySelectorAll('#mprobe [data-draft-row]').length,
      saved: window.__saved.length,
      calls: window.__draftCalls.length,
    }));
    check('regenerate replaces the draft', m.rows === 1, m.rows);
    check('…by calling draft again', m.calls === 2, m.calls);
    check('…and saves nothing on the way', m.saved === 0, m.saved);

    // A failed draft says so rather than silently doing nothing.
    await mountModal({ ok: false, error: 'VERA could not draft a task list from that.' }, DRAFT);
    await page.fill('#mprobe input', 'X');
    await page.click('#mprobe [data-draft-with-vera]');
    await page.waitForTimeout(300);
    const errText = await page.evaluate(() =>
      (document.querySelector('#mprobe [data-draft-error]') || {}).textContent || '');
    check('a failed draft is reported to the user', /could not draft/i.test(errText), errText);

    // The manual path still exists — nothing was taken away.
    await mountModal(DRAFT, DRAFT);
    await page.click('#mprobe [data-write-myself]');
    await page.waitForTimeout(200);
    check('you can still write the tasks yourself',
          (await page.evaluate(() => document.querySelectorAll('#mprobe textarea').length)) >= 2);

    await page.evaluate(() => { const n = document.getElementById('mprobe'); if (n) n.remove(); });

    await page.close();
  }

  // ======================= Victoria's dashboard ==========================
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  for (const width of (ONLY === 'full' || QUICK ? [] : [390, 1280])) {
    const L = 'lite ' + width;
    console.log('\ndashboard-lite @ ' + width + 'px');
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const seen = [];
    await page.route('**/*', r => {
      const u = r.request().url();
      for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType:'application/javascript', body: vendor[n] });
      if (u.includes('dashboard-lite.html')) return r.fulfill({ contentType:'text/html', body: LITE });
      if (u.startsWith('https://vera.test/')) {
        const q = new URL(u).searchParams, o = {};
        q.forEach((v, k) => { if (k !== 'token') o[k] = v; });
        seen.push(o);
        if (o.action === 'projects') return r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, count:FIXTURE.length, projects:FIXTURE }) });
        return r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true }) });
      }
      return r.fulfill({ contentType:'application/json', body:'{"ok":false}' });
    });
    await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil:'networkidle' });
    check(L + ': the Projects tab exists', await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b => /Projects/.test(b.textContent))));
    await page.click('button:has-text("Projects")');
    await page.waitForSelector('.pj-card', { timeout:5000 }).catch(() => {});
    const txt = (sel) => page.$$eval(sel, ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    const lastWrite = () => JSON.stringify(seen.filter(x => x.action !== 'projects').slice(-1)[0] || null);
    const names = await txt('.pj-card .pj-card-name');
    check(L + ': Shared, Victoria\'s and the blank-owner project are shown, sorted by verdict', JSON.stringify(names) === '["Garage clear-out","Baby registry","Kitchen refit"]', JSON.stringify(names));
    check(L + ": Ahmed's project is NOT shown anywhere", !/Tax filing|Gather 1099s/.test(await page.evaluate(() => document.body.innerText)));
    check(L + ': the owner pills are only hers and Shared', JSON.stringify(await txt('.pj-owner')) === '["All","Shared","Victoria"]', JSON.stringify(await txt('.pj-owner')));
    check(L + ': Next up counts only her projects', (await txt('.pj-tab-next'))[0] === 'Next up · 2');
    check(L + ': no create, edit, delete, close, owner or Ask VERA control', (await page.$$('.pj-new, .pj-edit, .pj-close, .pj-suggest, .pj-owner-set, .pj-context-edit')).length === 0);
    await page.$eval('.pj-next-tick[aria-label="Done: Pick tiles"]', b => b.click()); await wait(400);
    check(L + ': ticking a Next up completes that row', lastWrite() === '{"action":"complete_project_task","row":"2"}', lastWrite());
    check(L + ': …and the page reloads', seen.filter(x => x.action === 'projects').length >= 2);
    await page.$eval('.pj-card-open[aria-label="Open Baby registry"]', b => b.click()); await wait(200);
    check(L + ': a blocked task says who it waits on', (await txt('.pj-waiting'))[0] === 'Waiting on the registry');
    await page.$eval('.pj-status', b => b.click()); await wait(400);
    check(L + ': the status chip works here too', lastWrite() === '{"action":"update_project_task","row":"5","status":"Pending"}', lastWrite());
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
