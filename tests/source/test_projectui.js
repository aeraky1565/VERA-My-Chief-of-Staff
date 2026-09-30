// Issue 199 — project ownership, in both REAL pages.
//
// Ahmed's dashboard gets an owner picker and filter chips. Victoria's gets a
// Projects tab it never had, scoped to Shared + her own, with the task checkbox
// as its only control. The scoping is the part worth proving: a filter that
// silently lets an Ahmed-only project through would be the whole point of the
// issue, undone.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Exactly the shape webGetProjects_ sends — including every DERIVED field, so
// the pages are handed what the server actually computes rather than a
// hand-waved subset. One project of each owner, so a filter that does nothing
// and a filter that hides everything both show up.
const t = (rowNum, task, o) => Object.assign(
  { rowNum, task, status:'Pending', priority:'Medium', dueDate:'', notes:'',
    phase:'', sequence:null, completedOn:'', isOverdue:false, daysUntilDue:null }, o || {});

const A_TASKS = [
  t(2, 'Pick tiles',    { priority:'High', phase:'Planning',  sequence:1, notes:'showroom Saturday' }),
  t(3, 'Measure units', {                  phase:'Planning',  sequence:2 }),
  t(7, 'Book fitter',   {                  phase:'Logistics', sequence:3 }),
  t(8, 'Order sink',    { status:'Done',   phase:'Logistics', sequence:4, completedOn:'2026-09-10' }),
];

// A real DragEvent (not a generic Event) is what React's drag handlers listen
// for, and dragstart has to land in its own turn so React can re-render with
// the new dragRow before drop reads it.
async function drag(page, fromRow, toRow) {
  const mk = `(n) => new DragEvent(n, { bubbles:true, cancelable:true, dataTransfer:new DataTransfer() })`;
  await page.evaluate(({ fromRow, mk }) => {
    const ev = eval(mk);
    document.querySelector('#pprobe [data-task-row="' + fromRow + '"]').dispatchEvent(ev('dragstart'));
  }, { fromRow, mk });
  await page.waitForTimeout(120);
  await page.evaluate(({ toRow, mk }) => {
    const ev = eval(mk);
    const el = document.querySelector('#pprobe [data-task-row="' + toRow + '"]');
    el.dispatchEvent(ev('dragover'));
    el.dispatchEvent(ev('drop'));
  }, { toRow, mk });
}

const FIXTURE = [
  { projectId:'PROJ-A', projectName:'Kitchen refit', owner:'Shared', targetDate:'2026-12-01',
    context:'Replacing the units and worktop before the in-laws visit at Christmas.',
    total:4, done:1, pending:3, pct:25, overdueCount:0, blockedCount:0,
    health:'on_track', healthReason:'3 tasks to go',
    phases:['Planning','Logistics'], nextTask:A_TASKS[0], tasks:A_TASKS },

  { projectId:'PROJ-B', projectName:'Tax filing', owner:'Ahmed', targetDate:'2026-09-25',
    total:1, done:0, pending:1, pct:0, overdueCount:0, blockedCount:0,
    health:'at_risk', healthReason:'Target in 3d, 100% left',
    phases:[], nextTask:t(4, 'Gather 1099s', { priority:'High' }),
    tasks:[ t(4, 'Gather 1099s', { priority:'High' }) ] },

  // Every remaining task is blocked, so there is nothing to pick up and the
  // server sends nextTask: null.
  { projectId:'PROJ-C', projectName:'Baby registry', owner:'Victoria', targetDate:'',
    total:1, done:0, pending:1, pct:0, overdueCount:0, blockedCount:1,
    health:'blocked', healthReason:'All 1 remaining task is blocked',
    phases:[], nextTask:null,
    tasks:[ t(5, 'Shortlist prams', { priority:'Low', status:'Blocked', notes:'waiting on the registry list' }) ] },

  // No owner at all — every project that pre-dates the column looks like this,
  // and it has to read as Shared on both sides.
  //
  // It is ALSO the disagreement case: its one task is Pending with no due date,
  // so raw task data implies a perfectly healthy project — but the server says
  // overdue (its target date passed). The pages must render the server's
  // verdict, not re-derive one. If a page ever computes health itself, this is
  // the fixture that catches it.
  { projectId:'PROJ-D', projectName:'Garage clear-out', targetDate:'2026-09-01',
    total:1, done:0, pending:1, pct:0, overdueCount:0, blockedCount:0,
    health:'overdue', healthReason:'Target date passed 3d ago, 1 task left',
    phases:[], nextTask:null, tasks:[ t(6, 'Hire skip') ] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  // ======================= Ahmed's dashboard =============================
  // ProjectsTab mounted directly with the fixture, so onSetOwner can be
  // captured. The component is the real one from the real built page.
  //
  // VERA_ONLY exists for the negative control: pointed at the pre-change pages
  // the full-dashboard half aborts on a chip that does not exist yet, which
  // would hide whether the lite half is also load-bearing.
  const ONLY = process.env.VERA_ONLY || '';
  for (const width of (ONLY === 'lite' ? [] : [390, 1280])) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil:'domcontentloaded' });

    const mount = () => page.evaluate((projects) => {
      document.querySelectorAll('.modal-overlay, #pprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'pprobe';
      document.body.appendChild(host);
      window.__ownerCalls = []; window.__reorderCalls = []; window.__closeCalls = [];
      ReactDOM.createRoot(host).render(React.createElement(ProjectsTab, {
        projects,
        onCompleteTask: () => {}, onAddTask: () => {}, onEditTask: () => {},
        onDeleteTask: () => {},   onCreateProject: () => {},
        onCloseProject: p => window.__closeCalls.push(p.projectId),
        onSetOwner: (id, owner) => window.__ownerCalls.push([id, owner]),
        onSetTarget: () => {},
        onReorder: (id, rows) => window.__reorderCalls.push([id, rows]),
        busy: false,
      }));
      return new Promise(r => setTimeout(r, 250));
    }, FIXTURE);

    const readState = () => page.evaluate(() => {
      const host = document.getElementById('pprobe');
      const chips = Array.from(host.querySelectorAll('[data-owner-filter]'));
      // The project tab strip: every button that carries an owner dot.
      const dots = Array.from(host.querySelectorAll('[data-owner-dot]'));
      return {
        chipLabels: chips.map(b => b.textContent.trim()),
        tabs: dots.map(d => (d.parentElement.textContent || '').replace(/\s+/g,' ').trim()),
        owners: dots.map(d => d.getAttribute('data-owner-dot')),
        pickerOwners: Array.from(host.querySelectorAll('[data-set-owner]')).map(b => b.getAttribute('data-set-owner')),
        pickerActive: Array.from(host.querySelectorAll('[data-set-owner]'))
          .filter(b => b.disabled).map(b => b.getAttribute('data-set-owner')),
        emptyNote: (host.querySelector('.proj-owner-empty') || {}).textContent || '',
        calls: window.__ownerCalls,
      };
    });

    await mount();
    let s = await readState();

    check('the filter offers All plus the three owners',
          s.chipLabels.join(',') === 'All,Shared,Ahmed,Victoria', s.chipLabels.join(','));
    check('All is the default — every project is listed',
          s.tabs.length === 4, s.tabs.length + ': ' + s.tabs.join(' | '));
    check('a project with no owner is drawn as Shared',
          s.owners.filter(o => o === 'Shared').length === 2, s.owners.join(','));

    // Filtering.
    const clickChip = o => page.click('#pprobe [data-owner-filter="' + o + '"]').then(() => page.waitForTimeout(200));

    await clickChip('Victoria');
    s = await readState();
    check('Victoria leaves exactly one project', s.tabs.length === 1, s.tabs.join(' | '));
    check('…and it is the right one', /Baby registry/.test(s.tabs[0] || ''), s.tabs[0]);

    await clickChip('Ahmed');
    s = await readState();
    check('Ahmed leaves exactly one project', s.tabs.length === 1, s.tabs.join(' | '));
    check('…and it is the right one', /Tax filing/.test(s.tabs[0] || ''), s.tabs[0]);

    await clickChip('Shared');
    s = await readState();
    check('Shared leaves two — the explicit one and the blank one',
          s.tabs.length === 2, s.tabs.join(' | '));

    await clickChip('All');
    s = await readState();
    check('All restores every project', s.tabs.length === 4, s.tabs.length);

    // The picker reflects the selected project and only fires for a change.
    check('the picker offers exactly the three owners',
          s.pickerOwners.join(',') === 'Shared,Ahmed,Victoria', s.pickerOwners.join(','));
    check("the selected project's own owner is the disabled one",
          s.pickerActive.join(',') === 'Shared', s.pickerActive.join(','));

    await page.click('#pprobe [data-set-owner="Victoria"]');
    await page.waitForTimeout(150);
    s = await readState();
    check('clicking Victoria calls onSetOwner once', s.calls.length === 1, JSON.stringify(s.calls));
    check('…with the selected project id and the new owner',
          s.calls[0] && s.calls[0][0] === 'PROJ-A' && s.calls[0][1] === 'Victoria',
          JSON.stringify(s.calls[0]));

    // ---- health, next up, phases, collapse, drag ----------------------
    await mount();
    let h = await page.evaluate(() => {
      const host = document.getElementById('pprobe');
      const chip = host.querySelector('[data-health-chip]');
      return {
        chip:   chip && chip.getAttribute('data-health-chip'),
        chipText: chip && chip.textContent.trim(),
        reason: (host.querySelector('[data-health-reason]') || {}).textContent || '',
        dots:   Array.from(host.querySelectorAll('[data-health-dot]')).map(d => d.getAttribute('data-health-dot')),
        nextUp: (host.querySelector('[data-next-up]') || {}).textContent || '',
        nextUpRow: (host.querySelector('[data-next-up]') || {}).getAttribute
                    ? host.querySelector('[data-next-up]').getAttribute('data-next-up') : null,
        phases: Array.from(host.querySelectorAll('[data-phase-header]')).map(d => d.getAttribute('data-phase-header')),
        taskRows: Array.from(host.querySelectorAll('[data-task-row]')).map(d => d.getAttribute('data-task-row')),
        doneRows: host.querySelectorAll('[data-done-row]').length,
        doneToggle: (host.querySelector('[data-toggle-done]') || {}).textContent || '',
        notes: Array.from(host.querySelectorAll('[data-task-notes]')).map(d => d.textContent.trim()),
        target: (host.querySelector('[data-project-target]') || {}).value,
      };
    });

    check('the selected project shows its health chip', h.chip === 'on_track', h.chip);
    check('…labelled in words', h.chipText === 'On track', h.chipText);
    check('…with the reason the server sent', h.reason === '3 tasks to go', h.reason);
    check('every project tab carries a health dot', h.dots.length === 4, h.dots.join(','));
    check('…and the dots are the four server verdicts',
          h.dots.join(',') === 'on_track,at_risk,blocked,overdue', h.dots.join(','));

    check('next up names the first pending task', /Pick tiles/.test(h.nextUp), h.nextUp.slice(0, 80));
    check('…and points at its row', h.nextUpRow === '2', h.nextUpRow);
    check('the target date input carries the project target', h.target === '2026-12-01', h.target);

    check('phase headers appear in order', h.phases.join(',') === 'Planning,Logistics', h.phases.join(','));
    check('only pending tasks are listed', h.taskRows.join(',') === '2,3,7', h.taskRows.join(','));
    check('completed tasks are collapsed by default', h.doneRows === 0, h.doneRows);
    check('…behind a count', /1 done/.test(h.doneToggle), h.doneToggle);
    check('task notes are rendered', h.notes.indexOf('showroom Saturday') !== -1, JSON.stringify(h.notes));

    await page.click('#pprobe [data-toggle-done]');
    await page.waitForTimeout(200);
    check('…and expand on click',
          await page.evaluate(() => document.querySelectorAll('#pprobe [data-done-row]').length) === 1);

    // The disagreement case: PROJ-D's only task is Pending with no due date, so
    // raw task data implies a healthy project. The server says overdue. If the
    // page re-derived health instead of rendering what it was given, this fails.
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pprobe button'));
      const d = tabs.find(b => /Garage clear-out/.test(b.textContent));
      d && d.click();
    });
    await page.waitForTimeout(250);
    const dState = await page.evaluate(() => {
      const host = document.getElementById('pprobe');
      const chip = host.querySelector('[data-health-chip]');
      return { chip: chip && chip.getAttribute('data-health-chip'),
               text: chip && chip.textContent.trim(),
               reason: (host.querySelector('[data-health-reason]') || {}).textContent || '' };
    });
    check("the page renders the SERVER's verdict, not its own", dState.chip === 'overdue', dState.chip);
    check('…shown as Overdue', dState.text === 'Overdue', dState.text);
    check('…with the server reason', /Target date passed 3d ago/.test(dState.reason), dState.reason);

    // Blocked project: nothing to pick up, and it says so rather than showing
    // a next action that cannot be started.
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('#pprobe button'));
      const c = tabs.find(b => /Baby registry/.test(b.textContent));
      c && c.click();
    });
    await page.waitForTimeout(250);
    const cState = await page.evaluate(() => {
      const host = document.getElementById('pprobe');
      return { up: host.querySelectorAll('[data-next-up]').length,
               blocked: (host.querySelector('[data-next-up-blocked]') || {}).textContent || '',
               pill: (host.querySelector('[data-task-status-pill]') || {}).getAttribute
                      ? host.querySelector('[data-task-status-pill]').getAttribute('data-task-status-pill') : null };
    });
    check('a fully blocked project offers no next action', cState.up === 0, cState.up);
    check('…and says why', /blocked/i.test(cState.blocked), cState.blocked.slice(0, 90));
    check('the blocked task carries a status pill', cState.pill === 'Blocked', cState.pill);

    // Drag: move "Book fitter" (row 7) is in another phase, so the drag that
    // must WORK is within Planning — row 3 onto row 2.
    await mount();
    // dragstart and drop must be in SEPARATE turns. Dispatched back to back in
    // one synchronous block, React never re-renders between them, so the drop
    // handler's closure still sees dragRow === null and nothing fires — the
    // test would fail against a component that works perfectly in a real drag,
    // where those events are milliseconds apart.
    await drag(page, 3, 2);
    await page.waitForTimeout(250);
    const reorder = await page.evaluate(() => window.__reorderCalls || []);
    check('a drag within a phase issues a reorder', reorder.length === 1, JSON.stringify(reorder));
    check('…with the whole project in its new order',
          reorder[0] && reorder[0][1].join(',') === '3,2,7,8', reorder[0] && reorder[0][1].join(','));

    // Across phases it must do nothing — ordering and grouping would fight.
    await mount();
    await drag(page, 7, 2);   // Logistics -> Planning
    await page.waitForTimeout(250);
    check('a drag ACROSS phases is refused',
          (await page.evaluate(() => (window.__reorderCalls || []).length)) === 0);

    // Close project
    await mount();
    await page.click('#pprobe [data-close-project]');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => window.__closeCalls || []);
    check('the close button calls onCloseProject', closed.length === 1, JSON.stringify(closed));
    check('…with the selected project', closed[0] === 'PROJ-A', closed[0]);

    // A filter that matches nothing must say so rather than render blank.
    // Mount a fixture holding only Ahmed's project, then ask for Victoria's.
    await page.evaluate((only) => {
      document.querySelectorAll('.modal-overlay, #pprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'pprobe';
      document.body.appendChild(host);
      window.__ownerCalls = [];
      ReactDOM.createRoot(host).render(React.createElement(ProjectsTab, {
        projects: only, onCompleteTask:()=>{}, onAddTask:()=>{}, onEditTask:()=>{},
        onDeleteTask:()=>{}, onCreateProject:()=>{}, onCloseProject:()=>{},
        onSetOwner:()=>{}, busy:false,
      }));
      return new Promise(r => setTimeout(r, 250));
    }, [FIXTURE[1]]); // Ahmed only
    await clickChip('Victoria');
    s = await readState();
    check('a filter that matches nothing explains itself',
          /No Victoria projects/.test(s.emptyNote), JSON.stringify(s.emptyNote.slice(0, 120)));
    check('…and draws no project tabs', s.tabs.length === 0, s.tabs.length);


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
  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const width of (ONLY === 'full' ? [] : [390, 1280])) {
    console.log('\ndashboard-lite @ ' + width + 'px');
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    const seen = [];

    await page.route('**/*', r => {
      const u = r.request().url();
      for (const n of Object.keys(vendor)) {
        if (u.includes(n)) return r.fulfill({ contentType:'application/javascript', body: vendor[n] });
      }
      if (u.includes('dashboard-lite.html')) {
        return r.fulfill({ contentType:'text/html', body: liteHtml });
      }
      if (u.startsWith('https://vera.test/')) {
        const q = new URL(u).searchParams;
        const action = q.get('action');
        seen.push({ action, row: q.get('row') });
        if (action === 'projects') {
          return r.fulfill({ contentType:'application/json',
                             body: JSON.stringify({ ok:true, count:FIXTURE.length, projects:FIXTURE }) });
        }
        return r.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true }) });
      }
      return r.fulfill({ contentType:'application/json', body:'{"ok":false}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('vera_url', 'https://vera.test/exec');
      localStorage.setItem('vera_token', 't');
    });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil:'networkidle' });

    const tabExists = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(b => /Projects/.test(b.textContent)));
    check('the Projects tab exists at all', tabExists);

    await page.click('button:has-text("Projects")');
    await page.waitForTimeout(600);

    const s = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[data-project-id]'))
        .map(d => d.getAttribute('data-project-id'));
      const badges = Array.from(document.querySelectorAll('[data-owner-badge]'))
        .map(b => b.getAttribute('data-owner-badge'));
      const text = document.body.textContent || '';
      const chipOf = id => {
        const c = document.querySelector('[data-project-id="' + id + '"] [data-health-chip]');
        return c ? c.getAttribute('data-health-chip') : null;
      };
      return {
        ids, badges,
        checkboxes: document.querySelectorAll('[data-project-id] input[type="checkbox"]').length,
        buttons: Array.from(document.querySelectorAll('[data-project-id] button')).map(b => b.textContent.trim()),
        mentionsAhmedProject: /Tax filing/.test(text),
        mentionsShared: /Kitchen refit/.test(text),
        mentionsVictoria: /Baby registry/.test(text),
        mentionsBlankOwner: /Garage clear-out/.test(text),
        chips: { A: chipOf('PROJ-A'), C: chipOf('PROJ-C'), D: chipOf('PROJ-D') },
        chipTextD: (document.querySelector('[data-project-id="PROJ-D"] [data-health-chip]') || {}).textContent,
        reasonD: (document.querySelector('[data-project-id="PROJ-D"] [data-health-reason]') || {}).textContent || '',
        nextUpA: (document.querySelector('[data-project-id="PROJ-A"] [data-next-up]') || {}).textContent || '',
        nextUpRowA: (document.querySelector('[data-project-id="PROJ-A"] [data-next-up]') || {}).getAttribute
                      ? document.querySelector('[data-project-id="PROJ-A"] [data-next-up]').getAttribute('data-next-up') : null,
        blockedC: (document.querySelector('[data-project-id="PROJ-C"] [data-next-up-blocked]') || {}).textContent || '',
        nextUpCount: document.querySelectorAll('[data-project-id="PROJ-C"] [data-next-up]').length,
        notes: Array.from(document.querySelectorAll('[data-task-notes]')).map(n => n.textContent.trim()),
        statusPill: (document.querySelector('[data-project-id="PROJ-C"] [data-task-status-pill]') || {}).getAttribute
                      ? document.querySelector('[data-project-id="PROJ-C"] [data-task-status-pill]').getAttribute('data-task-status-pill') : null,
        contextA: (document.querySelector('[data-project-id="PROJ-A"] [data-project-context]') || {}).textContent || '',
        contextDShown: !!document.querySelector('[data-project-id="PROJ-D"] [data-project-context]'),
        draftControls: document.querySelectorAll('[data-draft-with-vera],[data-suggest-tasks],[data-edit-context],[data-draft-review]').length,
      };
    });

    check('the projects endpoint was called', seen.some(x => x.action === 'projects'),
          seen.map(x => x.action).join(','));
    check('Shared, Victoria and the blank-owner project are shown',
          s.mentionsShared && s.mentionsVictoria && s.mentionsBlankOwner,
          JSON.stringify(s));
    check("Ahmed's project is NOT shown", !s.mentionsAhmedProject);
    check('three projects rendered, not four', s.ids.length === 3, s.ids.join(','));
    check('PROJ-B is absent from the rendered ids', s.ids.indexOf('PROJ-B') === -1, s.ids.join(','));
    check('each carries an owner badge', s.badges.length === 3, s.badges.join(','));
    check('the blank-owner project is badged Shared',
          s.badges.filter(b => b === 'Shared').length === 2, s.badges.join(','));

    // Health, next up, notes — the same server verdict as the full dashboard.
    check('each project carries a health chip',
          s.chips.A === 'on_track' && s.chips.C === 'blocked' && s.chips.D === 'overdue',
          JSON.stringify(s.chips));
    check("the chip is the SERVER's verdict, not a re-derived one",
          s.chipTextD && s.chipTextD.trim() === 'Overdue', s.chipTextD);
    check('…with the server reason', /Target date passed 3d ago/.test(s.reasonD), s.reasonD);
    check('next up names the first pending task', /Pick tiles/.test(s.nextUpA), s.nextUpA.slice(0, 80));
    check('…and points at its row', s.nextUpRowA === '2', s.nextUpRowA);
    check('a fully blocked project offers no next action', s.nextUpCount === 0, s.nextUpCount);
    check('…and says so', /blocked/i.test(s.blockedC), s.blockedC.slice(0, 80));
    check('the blocked task carries a status pill', s.statusPill === 'Blocked', s.statusPill);
    check('task notes are rendered',
          s.notes.indexOf('waiting on the registry list') !== -1, JSON.stringify(s.notes));
    check('the project context is shown', /in-laws visit at Christmas/.test(s.contextA), s.contextA);
    check('a project with no context renders no context block', s.contextDShown === false, s.contextDShown);
    // Drafting, editing and appending stay in the full dashboard.
    check('no drafting control on this page',
          s.draftControls === 0, s.draftControls);

    // Read-focused: a checkbox per task, and nothing else.
    check('tasks are checkable', s.checkboxes >= 3, s.checkboxes);
    check('no add / edit / delete / create control is rendered',
          s.buttons.length === 0, JSON.stringify(s.buttons));

    // Ticking a task hits the right row.
    const before = seen.filter(x => x.action === 'complete_project_task').length;
    await page.click('[data-project-id="PROJ-C"] input[type="checkbox"]');
    await page.waitForTimeout(500);
    const calls = seen.filter(x => x.action === 'complete_project_task');
    check('ticking a task calls complete_project_task', calls.length === before + 1,
          JSON.stringify(calls));
    check('…with that task\'s row number', calls.length > 0 && calls[calls.length-1].row === '5',
          calls.length ? calls[calls.length-1].row : 'none');

    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
