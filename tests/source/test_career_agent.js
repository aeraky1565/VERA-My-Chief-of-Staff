// Career tab v2, phase 2 (issue #216): the job agent link. VERA reads the agent's
// Tracker, writes only its Status cell, keeps the agent's Settings in step with
// North Star (VERA-owned cells only, never a new row), appends a dated Wins bank
// tab without touching earlier ones, flags an agent that has gone quiet, and once
// a quarter suggests criteria from the matches. Invented companies and figures.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { extractFn, FakeSheet, FakeSS, sandbox, run } = require('./career_fixtures.js')(read);
const CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), INDEX = read('docs/index.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// The agent's sheet, with every write recorded.
function agentSheet(trackerRows, settingsRows) {
  const ss = new FakeSS({ Tracker: trackerRows, Settings: settingsRows });
  const writes = [];
  Object.values(ss.sheets).forEach(sh => {
    const getRange = sh.getRange.bind(sh);
    sh.getRange = (r, c, nr, nc) => {
      const g = getRange(r, c, nr, nc);
      const sv = g.setValue, svs = g.setValues;
      g.setValue = v => { writes.push([sh.name, r, c, v]); return sv(v); };
      g.setValues = v => { writes.push([sh.name, r, c, 'many']); return svs(v); };
      return g;
    };
    sh.appendRow = row => { writes.push([sh.name, 'append']); FakeSheet.prototype.appendRow.call(sh, row); };
    sh.deleteRow = r => { writes.push([sh.name, 'delete', r]); FakeSheet.prototype.deleteRow.call(sh, r); };
  });
  return { ss, writes };
}

const TRACKER_HEAD = ['Status', 'Company', 'Title', 'Date found', 'Tier', 'Score', 'Job link', 'Materials folder', 'Notes', 'Salary range', 'Suggested person', 'Score breakdown', 'Track'];
const tracker = () => [TRACKER_HEAD,
  ['New',     'Invented Corp', 'Senior Manager, FP&A', new Date(2026, 9, 22), '1', '8',  'https://jobs.example/a', 'https://drive.example/f1', 'Hybrid', '$110K–$190K', 'Hiring manager', '', ''],
  ['Handoff', 'Madeup LLC',    'Associate Director, PMO', '2026-10-23', '1', '88', 'https://jobs.example/b', '', '', '', '', 'L 25 · F 22 · S 20 · T 21', 'PMO'],
  ['New',     'Same Co',       'Director, Finance', '2026-10-23', '1', '75', '', '', '', '', '', '', 'FP&A'],
  ['New',     'Same Co',       'Director, Finance', '2026-10-23', '1', '70', '', '', '', '', '', '', 'FP&A'],
  ['', '', '', '', '', '', '', '', '', '', '', '', ''],
];
const SETTINGS = () => [['Setting', 'Your value', 'Required', 'What it controls'],
  ['Target level', 'Senior Manager', 'Yes', ''], ['Levels to consider', '', 'No', ''],
  ['Minimum base salary (USD)', '180000', 'Yes', ''], ['Work mode', 'Hybrid', 'Yes', ''],
  ['Deal-breakers', '', 'No', ''], ['Companies to exclude', 'Bigco, Oldco, Staffing Inc', 'No', ''],
  ['Max matches per daily digest', '5', 'Yes', '']];   // no "VERA Inbox link" row: it must be reported, never added

function agentSandbox(over) {
  const A = agentSheet(tracker(), SETTINGS());
  const flags = new FakeSheet('Flags', [['ID','Date','Source','Flag','Reason','Urgency','Ack','Snooze','Resolved','Key','x']]);
  const S = sandbox(Object.assign({
    getConfigValues: () => ({ career_alert_sheet_id: 'AGENT', career_wins_bank_doc_id: 'DOC' }),
    SpreadsheetApp: { openById: id => { if (id !== 'AGENT') throw new Error('cannot open'); return A.ss; } },
    health: [], recordApiHealth_: function() { S.health.push([].slice.call(arguments)); },
  }, over || {}));
  S.ss.sheets.Flags = flags;
  S.A = A;
  vm.runInContext(extractFn(CODE, 'appendExactKeyFlags_') + extractFn(CODE, 'resolveFlagsWithPrefix_') +
                  'function colorCodeFlags(){}', S);
  run(S, 'webGetCareer_()');
  return S;
}

// ============ the Tracker =====================================================
console.log('reading the Tracker');
{
  const S = agentSandbox();
  check('a score of 10 or less is the old 1–10 scale', JSON.stringify(run(S, 'carNormScore_(8)')) === JSON.stringify({ total: 80, text: '8/10 (old scale)', oldScale: true }));
  check('a 0–100 score stays as it is', run(S, 'carNormScore_("88")').total === 88 && run(S, 'carNormScore_("")').total === null);
  const res = run(S, 'carReadTracker_("AGENT")');
  check('columns are found by label, in any order', res.status === 'ok' && res.rows.length === 4 && res.rows[0].company === 'Invented Corp' && res.rows[0].jobLink === 'https://jobs.example/a');
  check('a Date cell becomes yyyy-MM-dd', res.rows[0].dateFound === '2026-10-22');
  check('a blank Track reads as unassigned; FP&A and PMO map to ids', res.rows[0].track === 'unassigned' && res.rows[1].track === 'pmo' && res.rows[2].track === 'fpa');
  check('a blank row is skipped', res.rows.every(r => r.title));
  check('a good read is recorded as healthy', S.health.slice(-1)[0][0] === 'sheet:JobAgent' && S.health.slice(-1)[0][1] === true);
  S.grid = [['Company', 'Title', 'Score']];
  const bad = run(S, 'carTrackerParse_(grid, "UTC")');
  check('a missing required column is named, not guessed', bad.status === 'error' && /Date found, Job link, Status/.test(bad.reason), bad.reason);
  const reads = S.A.writes.length;
  check('reading writes nothing', reads === 0, JSON.stringify(S.A.writes));
}

console.log('\nagent health and the pattern read');
{
  const S = agentSandbox();
  check('Friday → Monday is one weekday', run(S, 'carWeekdaysBetween_("2026-10-23", "2026-10-26")') === 1);
  check('…Friday → Tuesday is two, which is stale at the default of two',
        run(S, 'carAgentHealth_([{ dateFound: "2026-10-23" }], "2026-10-27", 2)').stale === true &&
        run(S, 'carAgentHealth_([{ dateFound: "2026-10-23" }], "2026-10-26", 2)').stale === false);
  check('no matches at all is stale', run(S, 'carAgentHealth_([], "2026-10-27", 2)').stale === true);
  const p = run(S, 'carPatternRead_(carReadTracker_("AGENT").rows)');
  check('the pattern read is split by track, with an average score', p.pmo.count === 1 && p.pmo.avgScore === 88 && p.fpa.count === 2 && p.fpa.avgScore === 73 && p.unassigned.avgScore === 80, JSON.stringify(p));
  check('…and the funnel counts a Handoff', p.pmo.handedOff === 1 && p.pmo.applied === 0);
}

console.log('\nwriting a status');
{
  const S = agentSandbox();
  const r = run(S, 'webCareerSetStatus_({ jobLink: "https://jobs.example/a", company: "x", title: "y", status: "Passed" })');
  check('a status is written by Job link', r.ok && r.row === 2);
  check('…into the Status cell only — one write, nothing appended or deleted', JSON.stringify(S.A.writes) === JSON.stringify([['Tracker', 2, 1, 'Passed']]), JSON.stringify(S.A.writes));
  S.A.writes.length = 0;
  check('without a link it falls back to Company + Title', run(S, 'webCareerSetStatus_({ company: "madeup llc", title: "Associate Director, PMO", status: "Applied" })').row === 3);
  check('two rows with the same Company + Title is refused, not guessed', /More than one/.test(run(S, 'webCareerSetStatus_({ company: "Same Co", title: "Director, Finance", status: "Passed" })').error));
  check('a match no longer in the Tracker is refused', /no longer/.test(run(S, 'webCareerSetStatus_({ company: "Gone", title: "Gone", status: "Passed" })').error));
  check('an unknown status is refused before anything opens', run(S, 'webCareerSetStatus_({ jobLink: "https://jobs.example/a", status: "Interviewing" })').ok === false);
  check('only one write happened across all of that', S.A.writes.length === 1, JSON.stringify(S.A.writes));
  const N = sandbox();
  check('without the Config row it says what to add', /career_alert_sheet_id/.test(run(N, 'webCareerSetStatus_({ status: "Passed" })').error));
}

// ============ the Settings sync ===============================================
console.log('\nkeeping the agent’s Settings in step');
{
  const S = agentSandbox();
  check('swapping employers removes the old one, adds the new, keeps the rest',
        run(S, 'carSwapExclusion_("Bigco, Oldco, Staffing Inc", "oldco", "Newco")') === 'Bigco, Staffing Inc, Newco');
  check('…and never duplicates', run(S, 'carSwapExclusion_("Bigco, Newco", "", "newco")') === 'Bigco, Newco');
  S.A.writes.length = 0;
  run(S, 'webCareerSyncAgent_()');
  const firstSave = S.A.writes.filter(x => x[0] === 'Settings');
  const ladder = run(S, 'carReadLadder_()');
  S.L = ladder;
  const plan = run(S, 'carAgentSettingsCells_(L, { "Companies to exclude": "Bigco" }, "", "https://vera.example/")');
  const cell = l => (plan.cells.find(c => c.label === l) || {}).value;
  check('Target level is the next step’s level', cell('Target level') === 'Associate Director', JSON.stringify(plan.cells));
  check('Levels to consider runs current → next → the first future level', cell('Levels to consider') === 'Senior Manager, Associate Director, Director', cell('Levels to consider'));
  check('a sync never pushes the floors or deal-breakers: those are edited in place', ['Minimum base salary (USD)', 'Minimum total compensation (USD)', 'Deal-breakers', 'Work mode'].every(l => cell(l) === undefined), JSON.stringify(plan.cells));
  check('the Inbox link is the dashboard deep link, with no token', cell('VERA Inbox link') === 'https://vera.example/?tab=career&sub=pipeline' && !/token/i.test(cell('VERA Inbox link')));
  check('every cell is one VERA owns', plan.cells.every(c => run(S, 'CAR_AGENT_OWNED_LABELS_').includes(c.label)));
  const w = firstSave;
  check('a sync writes the Settings value column only, nothing appended', w.length > 0 && w.every(x => x[2] === 2 && x[1] !== 'append'), JSON.stringify(w));
  const settings = S.A.ss.sheets.Settings.rows;
  const val = l => (settings.find(r => r[0] === l) || [])[1];
  check('Target level lands in the agent’s sheet; its floors are left as they were', val('Target level') === 'Associate Director' && val('Minimum base salary (USD)') === '180000');
  check('the current employer is added to the exclusions', /Exampleco/.test(val('Companies to exclude')) && /Bigco/.test(val('Companies to exclude')));
  check('a label with no row is reported, never added', settings.length === SETTINGS().length && run(S, 'carStateGet_("agent_sync_last").missing').includes('VERA Inbox link'));
  check('rows VERA does not own are untouched', val('Work mode') === 'Hybrid' && val('Max matches per daily digest') === '5');
  S.A.writes.length = 0;
  run(S, 'webCareerSyncAgent_()');
  check('a second sync with nothing changed writes nothing', S.A.writes.length === 0, JSON.stringify(S.A.writes));
}

console.log('\nHired');
{
  const S = agentSandbox();
  run(S, 'webCareerSyncAgent_()');   // remembers the current employer, Exampleco
  const r = run(S, 'webCareerSetStatus_({ jobLink: "https://jobs.example/b", status: "Hired" })');
  const ladder = run(S, 'carReadLadder_()');
  const cur = ladder.find(x => x.status === 'current');
  check('Hired advances the ladder on the match’s track', r.advanced === true && cur.track === 'pmo' && cur.company === 'Madeup LLC' && cur.moveType === 'external', JSON.stringify(cur));
  check('the old role is reached', ladder.find(x => x.title === 'Senior Manager, Planning').status === 'reached');
  const ex = S.A.ss.sheets.Settings.rows.find(x => x[0] === 'Companies to exclude')[1];
  check('the new employer replaces the old one in the agent’s exclusions', /Madeup LLC/.test(ex) && !/Exampleco/.test(ex) && /Staffing Inc/.test(ex), ex);
}

console.log('\na blank company never strands the old employer');
{
  const S = agentSandbox();
  run(S, 'webCareerSyncAgent_()');                                     // remembers Exampleco
  const cur = run(S, 'carReadLadder_()').find(x => x.status === 'current');
  S.cur = cur;
  run(S, 'webCareerSaveRung_({ rung: Object.assign({}, cur, { company: "" }) })');   // company cleared for a while
  check('the remembered employer survives a sync with no company', run(S, 'carStateGet_("agent_sync_last").employer') === 'Exampleco');
  run(S, 'webCareerSaveRung_({ rung: Object.assign({}, cur, { company: "Newco" }) })');
  const ex = S.A.ss.sheets.Settings.rows.find(x => x[0] === 'Companies to exclude')[1];
  check('…so the next employer still replaces it', /Newco/.test(ex) && !/Exampleco/.test(ex), ex);
}

// ============ constraints: read from and written to the agent's Settings ==========
console.log('\nconstraints live in the agent’s Settings');
{
  const S = agentSandbox();
  const c = run(S, 'carReadConstraints_()');
  check('they are read from the Settings sheet by label', c.configured && c.values.baseFloor === '180000' && c.values.workMode === 'Hybrid' &&
        c.values.excludeCompanies === 'Bigco, Oldco, Staffing Inc', JSON.stringify(c.values));
  check('a label the sheet lacks is named, not guessed', c.missing.includes('Home location') && c.missing.includes('Minimum total compensation (USD)') && c.values.homeLocation === '');
  S.G = [['Your value', 'Notes', 'Setting'], ['165000', '', 'Minimum base salary (USD)'], ['Remote only', '', 'work mode']];
  const moved = run(S, 'carConstraintsFromSettings_(G)');
  check('columns and rows in any order, labels in any case', moved.values.baseFloor === '165000' && moved.values.workMode === 'Remote only');
  check('GET career carries them', run(S, 'webGetCareer_()').constraints.values.baseFloor === '180000');

  S.A.writes.length = 0;
  const r = run(S, 'webCareerSaveConstraints_({ constraints: { baseFloor: "$185,000", dealbreakers: "security clearance", workMode: "Hybrid" } })');
  const sw = S.A.writes.filter(x => x[0] === 'Settings');
  const val = l => (S.A.ss.sheets.Settings.rows.find(x => x[0] === l) || [])[1];
  check('a save writes the changed cells in place', r.ok && val('Minimum base salary (USD)') === '185000' && val('Deal-breakers') === 'security clearance', JSON.stringify(r));
  check('…the value column only, an unchanged value not at all, nothing appended', sw.length === 2 && sw.every(x => x[2] === 2) && S.A.ss.sheets.Settings.rows.length === SETTINGS().length, JSON.stringify(sw));
  check('…and the read-back shows the new values', r.constraints.values.baseFloor === '185000');
  const miss = run(S, 'webCareerSaveConstraints_({ constraints: { homeLocation: "Invented City" } })');
  check('a constraint whose row is missing is reported, never added', miss.ok && miss.missing.includes('Home location') && S.A.ss.sheets.Settings.rows.length === SETTINGS().length);
  check('Companies to exclude can’t be edited here', /doesn’t edit Companies to exclude/.test(run(S, 'webCareerSaveConstraints_({ constraints: { excludeCompanies: "" } })').error) && val('Companies to exclude') === 'Bigco, Oldco, Staffing Inc');
  check('an unknown key is refused', run(S, 'webCareerSaveConstraints_({ constraints: { targetLevel: "VP" } })').ok === false && val('Target level') === 'Senior Manager');
  check('a floor must be a whole number', /whole number/.test(run(S, 'webCareerSaveConstraints_({ constraints: { totalFloor: "lots" } })').error));
  check('VERA’s writer refuses a row it doesn’t own', (() => { try { run(S, 'carWriteAgentSettings_(carOpenAgentTab_("AGENT", "Settings"), [{ label: "Max matches per daily digest", value: "50" }])'); return false; } catch (e) { return /does not own/.test(e.message); } })() && val('Max matches per daily digest') === '5');

  run(S, 'webCareerSaveConstraints_({ constraints: { baseFloor: "195000" } })');
  run(S, 'webCareerSavePackage_({ package: { asOf: "2026-10", base: "150000" } })');
  const m = run(S, 'webGetCareerPipeline_()').rows.find(x => x.company === 'Invented Corp').market;
  check('the Pipeline judges each range against the floor in Settings', m && m.hi === 190000 && m.clearsFloor === false && m.verdict === 'below-floor', JSON.stringify(m));
  run(S, 'webCareerSaveConstraints_({ constraints: { baseFloor: "185000" } })');
  S.SpreadsheetApp.openById = () => { throw new Error('offline'); };
  const stale = run(S, 'carReadConstraints_()');
  check('the sheet unreachable: the last read comes back, marked stale', stale.stale === true && stale.values.baseFloor === '185000' && /offline/.test(stale.error));
  check('without the Config row it says so', run(sandbox(), 'carReadConstraints_()').configured === false &&
        /career_alert_sheet_id/.test(run(sandbox(), 'webCareerSaveConstraints_({ constraints: { baseFloor: "1" } })').error));
}

// ============ the Wins bank ===================================================
console.log('\nthe Wins bank');
{
  const calls = [];
  const mkTab = title => ({ getTitle: () => title, asDocumentTab: () => ({ getBody: () => ({
    appendParagraph: t => { calls.push(['para', title, t]); return { setHeading: h => calls.push(['heading', h]) }; },
    appendListItem: t => { calls.push(['item', title, t]); return { setGlyphType: () => {} }; } }) }) });
  const tabs = [mkTab('2026-10 Baseline (Master Resume)')];
  const doc = { getTabs: () => tabs.slice(), addTab: o => { calls.push(['addTab', o.title]); const t = mkTab(o.title); tabs.push(t); return t; },
                removeTab: () => calls.push(['REMOVED']) };
  const S = agentSandbox({ DocumentApp: { openById: () => doc, ParagraphHeading: { TITLE: 'TITLE', HEADING2: 'H2', NORMAL: 'NORMAL' }, GlyphType: { BULLET: 'B' },
    ElementType: { LIST_ITEM: 'LIST_ITEM', PARAGRAPH: 'PARAGRAPH' } } });
  run(S, 'webCareerSaveEvidence_({ evidence: { statement: "Ran the portfolio review", month: "2026-10", scale: "12 programs", criterionIds: ["pmo-portfolio"] } })');
  S.ym = run(S, 'carTodayYm_()');
  const plan = run(S, 'carWinsBankPlan_(carReadEvidence_(), ym)');
  check('the plan takes new manual evidence, never the baseline (the migrated v1 win is baseline)', plan.items.length === 1 && plan.items.every(i => i.source !== 'baseline') && plan.title === S.ym + ' update', JSON.stringify(plan.items.map(i => i.source)));
  const r = run(S, 'webCareerWinsBank_()');
  check('a dated tab is added, grouped by criterion, in the baseline’s format', r.result.added === 1 &&
        calls.some(c => c[0] === 'addTab' && c[1] === S.ym + ' update') &&
        calls.some(c => c[0] === 'item' && c[2] === 'Ran the portfolio review | Proof: 12 programs | 2026-10'), JSON.stringify(calls));
  check('earlier tabs are never written to or removed', !calls.some(c => c[1] === '2026-10 Baseline (Master Resume)' || c[0] === 'REMOVED'));
  check('sent items are stamped with the tab', run(S, 'carReadEvidence_()').filter(e => e.winsBankSent === S.ym + ' update').length === 1);
  calls.length = 0;
  run(S, 'webCareerSaveEvidence_({ evidence: { statement: "Later win", month: "2026-10" } })');
  const again = run(S, 'webCareerWinsBank_()');
  check('this month’s tab already exists: nothing is written, the item waits for next month', again.result.skipped === 'exists' && calls.length === 0);
}

// ============ nightly: health flag and suggestions ===============================
console.log('\nthe nightly checks');
{
  // A fixed clock: Wednesday 2026-10-28, three weekdays after the fixture's last match.
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(2026, 9, 28, 12); }
    static now() { return new Date(2026, 9, 28, 12).getTime(); }
  }
  const S = agentSandbox({ Date: FixedDate });
  run(S, 'carCheckAgentHealth_()');
  const flags = () => S.ss.sheets.Flags.rows.slice(1);
  check('a quiet agent raises one flag, keyed to the last match', flags().length === 1 && /^career-agent-stale__2026-10-23$/.test(flags()[0][9]) && /Daily job search digest/.test(flags()[0][4]), JSON.stringify(flags()));
  run(S, 'carCheckAgentHealth_()');
  check('…and only one', flags().length === 1);
  S.A.ss.sheets.Tracker.rows.push(['New', 'Fresh Co', 'Associate Director, FP&A', run(S, 'Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd")'), '1', '80', 'https://jobs.example/z', '', '', '', '', '', 'FP&A']);
  check('once matches arrive again the flag resolves', run(S, 'carCheckAgentHealth_()') === 'healthy' && flags()[0][8] === 'Yes');

  let asked = 0;
  const Q = agentSandbox({ callClaudeJson_: () => { asked++; return { suggestions: [
    { group: 'pmo', name: 'Vendor management', meaning: 'Runs vendor contracts', rationale: '3 of 4 PMO matches' },
    { group: 'pmo', name: 'Portfolio governance', meaning: 'dup of a criterion' },
    { group: 'sales', name: 'Quota' },
    { group: 'fpa', name: 'A' }, { group: 'fpa', name: 'B' }, { group: 'fpa', name: 'C' }, { group: 'fpa', name: 'D' }] }; } });
  run(Q, 'carSuggestCriteria_()');
  const sug = run(Q, 'carReadSuggestions_()');
  check('suggestions skip existing criteria and unknown groups, three per track at most', sug.length === 4 && sug.filter(x => x.group === 'fpa').length === 3 && !sug.some(x => x.name === 'Portfolio governance'), JSON.stringify(sug.map(x => x.name)));
  run(Q, 'carSuggestCriteria_()');
  check('…and run once a quarter', asked === 1);
  run(Q, 'webCareerResolveSuggestion_({ id: "' + sug.find(x => x.name === 'Vendor management').id + '", adopt: true })');
  check('adopting one makes it a market-sourced PMO criterion', run(Q, 'carReadCriteria_()').some(c => c.name === 'Vendor management' && c.group === 'pmo' && c.source === 'market'));
  check('…and it leaves the pending list', !run(Q, 'carReadSuggestions_()').some(x => x.name === 'Vendor management'));
}

// ============ the dashboard's deep link ===========================================
console.log('\nthe deep link');
{
  const D = {};
  vm.createContext(D);
  vm.runInContext('var CAR_SUBS;' + APP.match(/var CAR_SUBS=\[[^\]]*\];/)[0] + extractFn(APP, 'carParseDeepLink'), Object.assign(D, { URLSearchParams }));
  const dl = q => JSON.stringify(vm.runInContext('carParseDeepLink(' + JSON.stringify(q) + ')', D));
  check('?tab=career&sub=pipeline opens the Pipeline', dl('?tab=career&sub=pipeline') === '{"tab":"career","sub":"pipeline"}');
  check('an unknown subtab opens Career at its default', dl('?tab=career&sub=evil') === '{"tab":"career","sub":null}');
  check('other tabs are not deep-linkable', dl('?tab=finances') === 'null');
  check('a token in the link is never read', !/t0ken/.test(dl('?tab=career&sub=pipeline&token=t0ken')));
  check('every subtab can be deep-linked', ['market', 'brand', 'exchange', 'network'].every(s => JSON.parse(dl('?tab=career&sub=' + s)).sub === s));
  check('the app strips the link after reading it', /history\.replaceState\(null,'',window\.location\.pathname\+window\.location\.hash\)/.test(APP));
  check('the page opens on Career when deep-linked, and loads it', /useState\(careerDeepLink\?'career':'home'\)/.test(APP) && /if\(apiUrl&&apiToken\)loadCareer\(apiUrl,apiToken\);\},\[apiUrl,apiToken\]\)/.test(APP));
}

// ============ wiring ==========================================================
console.log('\nwiring');
{
  check('GET career_pipeline is routed', /case 'career_pipeline':\s+return jsonOut_\(webGetCareerPipeline_\(\)\);/.test(WEB));
  [['career_set_status', 'webCareerSetStatus_\\(body\\)'], ['career_sync_agent', 'webCareerSyncAgent_\\(\\)'],
   ['career_wins_bank', 'webCareerWinsBank_\\(\\)'], ['career_resolve_suggestion', 'webCareerResolveSuggestion_\\(body\\)'],
   ['career_save_constraints', 'webCareerSaveConstraints_\\(body\\)']].forEach(([a, fn]) => {
    check('POST ' + a + ' is routed', new RegExp("case '" + a + "':\\s+return jsonOut_\\(" + fn + "\\);").test(WEB));
    check('…and the dashboard uses it', APP.includes("'" + a + "'"));
  });
  const tail = CODE.slice(CODE.indexOf('function nightlyRunTail'));
  ['carCheckAgentHealth_', 'carMonthlyWinsBank_', 'carSuggestCriteria_'].forEach(n =>
    check(n + ' runs nightly, in the second half', new RegExp("nightlyStep_\\(ctx, '" + n + "', " + n + "\\);").test(tail)));
  check('the Suggestions tab is named', /CAREER_SUGGESTIONS:\s+'Career Suggestions'/.test(CODE));
  check('Pipeline is a Career subtab in both built files', [APP, INDEX].every(t => t.includes("{id:'pipeline',label:'📥 Pipeline'}") && t.includes('carH(CarPipeline,')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
