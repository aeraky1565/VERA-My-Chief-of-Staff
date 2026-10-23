// Career tab v2 (issue #216, Career.js), phase 1: the data layer, the one-time
// migration from the v1 tabs, North Star, Readiness and Evidence.
//
// The real functions run in a vm over a fake spreadsheet. Invented people,
// companies and figures only — never the real profile.
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CAR = read('Career.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'),
      APP = read('docs/app.js'), INDEX = read('docs/index.html'), LITE = read('docs/dashboard-lite.html'),
      TB = read('TestBench.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

// ---- A fake spreadsheet: just what Career.js and ensureSheet use ---------------
class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; this.hidden = false; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() { return this.getRange(1, 1, this.rows.length, this.getLastColumn()); }
  getRange(r, c, nr, nc) {
    const sh = this; nr = nr || 1; nc = nc || 1;
    const api = {
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: (vals) => { vals.forEach((v, i) => { const ri = r - 1 + i; while (sh.rows.length <= ri) sh.rows.push([]); v.forEach((x, j) => { sh.rows[ri][c - 1 + j] = x; }); }); return api; },
      setValue: (v) => { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = v; return api; },
      setFontWeight: () => api, setBackground: () => api, setFontColor: () => api,
    };
    return api;
  }
  appendRow(row) { this.rows.push(row.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() {}
  hideSheet() { this.hidden = true; }
  isSheetHidden() { return this.hidden; }
}
class FakeSS {
  constructor(tabs) { this.sheets = {}; this.deleted = []; Object.keys(tabs || {}).forEach(k => { this.sheets[k] = new FakeSheet(k, tabs[k]); }); }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n, []); return this.sheets[n]; }
  deleteSheet(sh) { this.deleted.push(sh.name); delete this.sheets[sh.name]; }
}

const TABS_SRC = CODE.slice(CODE.indexOf('const TABS = {'), CODE.indexOf('};', CODE.indexOf('const TABS = {')) + 2).replace('const TABS', 'var TABS');

// v1 tabs, invented content.
function v1Tabs() {
  return {
    'Career Position': [['Title','Company','Department','Start Date','Work Style','Job Level','Base Salary','Bonus Pct','Equity','Benefits','Focus Areas','Notes'],
                        ['Senior Manager, Planning','Exampleco','Ops','2025','Hybrid','M6',150000,12,'RSU','Health','Forecasting','']],
    'Career Goals':    [['ID','Title','Horizon','Category','Status','Target Date','Notes'],
                        ['CG-1','Lead a planning function','3yr','Leadership','Active','',''],
                        ['CG-2','Old goal','1yr','','Achieved','','']],
    'Career Progression': [['ID','Title','Company','Start Year','End Year','Type','Highlights','Notes'],
                        ['CPR-1','Engineer','Firstco','2010','2015','New Role','',''],
                        ['CPR-2','Planning Manager','Secondco','2015','2022','New Role','',''],
                        ['CPR-3','Senior Manager, Planning','Exampleco','2025','','Promotion','','']],
    'Career Development': [['ID','Item','Type','Status','Target Date','Notes'], ['CD-1','Public speaking','Skill','Planned','','']],
    'Career Wins':     [['ID','Date','Win','Impact','Category','Notes'], ['CW-1', new Date(2024, 4, 3), 'Shipped the forecast model','Cut close by 2 days','Project','']],
    'Career Network':  [['ID','Name','Role','Company','Relationship','Last Contact','Notes'], ['CN-1','Pat Example','VP','Exampleco','Mentor','2026-01-02','']],
    'Config':          [['Key','Value']],
  };
}

function sandbox(over) {
  const props = {};
  const logs = [];
  const S = Object.assign({
    Date, Math, JSON, logs,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      if (f === 'yyyy-MM') return d.getFullYear() + '-' + p(d.getMonth() + 1);
      if (f === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      throw new Error('unknown format ' + f);
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    getConfigValues: () => ({}),
    callClaudeJson_: () => null,
    props,
  }, over || {});
  S.ss = S.ss || new FakeSS(v1Tabs());
  S.getSpreadsheet = () => S.ss;
  vm.createContext(S);
  vm.runInContext(TABS_SRC + '\n' + extractFn(CODE, 'ensureSheet') + '\n' + CAR, S);
  return S;
}
const run = (S, code) => vm.runInContext(code, S);

// ============ the pure rules ==================================================
console.log('readiness rules');
{
  const S = sandbox();
  S.ev = [
    { id: 'e1', month: '2024-06', adScale: true,  criterionIds: ['core-exec'] },
    { id: 'e2', month: '2023-06', adScale: true,  criterionIds: ['core-scope'] },   // 36 months before 2026-06
    { id: 'e3', month: '2026-01', adScale: false, criterionIds: ['core-people'] },
  ];
  const st = (id, today) => { S.a = [id, S.ev, today]; return run(S, 'carEvidenceStatus_.apply(null, a)'); };
  check('AD-scale evidence inside 3 years → Proven', st('core-exec', '2026-06') === 'proven');
  check('exactly 36 months old no longer counts → Partial', st('core-scope', '2026-06') === 'partial');
  check('…35 months old still does', st('core-scope', '2026-05') === 'proven');
  check('evidence not at AD scale → Partial', st('core-people', '2026-06') === 'partial');
  check('no linked evidence → Gap', st('fpa-pl', '2026-06') === 'gap');

  S.crit = { id: 'fpa-pl', group: 'fpa', name: 'P&L', statusOverride: 'proven', overrideNote: 'owned at prior job' };
  const v = run(S, 'carCriterionView_(crit, ev, "2026-06")');
  check('an override sets the status but is marked, with the computed status kept',
        v.status === 'proven' && v.overridden === true && v.computed === 'gap', JSON.stringify(v));
  S.crit.statusOverride = 'nonsense';
  check('a junk override is ignored', run(S, 'carCriterionView_(crit, ev, "2026-06")').overridden === false);

  const verdict = (statuses) => {
    S.cr = statuses.map((s, i) => ({ id: 'c' + i, group: i ? 'fpa' : 'core', statusOverride: s }));
    return run(S, 'carTrackVerdict_("fpa", cr, [], "2026-06")');
  };
  const r1 = verdict(['proven', 'proven']);
  check('all Proven → Ready, 100%', r1.verdict === 'ready' && r1.pct === 100);
  const r2 = verdict(['proven', 'partial', 'partial']);
  check('Partials but no Gap → Stretch, points 2+1+1 of 6', r2.verdict === 'stretch' && r2.points === 4 && r2.max === 6 && r2.pct === 67, JSON.stringify(r2));
  const r3 = verdict(['proven', 'gap']);
  check('any Gap → Not ready', r3.verdict === 'not-ready' && r3.gaps === 1);
  S.cr = [{ id: 'a', group: 'core', statusOverride: 'proven' }, { id: 'b', group: 'pmo', statusOverride: 'gap' }, { id: 'c', group: 'fpa', statusOverride: 'proven', active: false }];
  const r4 = run(S, 'carTrackVerdict_("fpa", cr, [], "2026-06")');
  check('a track counts the core plus its own criteria only, active ones', r4.criteria.length === 1 && r4.verdict === 'ready', JSON.stringify(r4.criteria.map(c => c.id)));
}

console.log('\nthe ladder advances');
{
  const S = sandbox();
  S.L = [
    { id: 'old', status: 'reached', track: '' },
    { id: 'cur', status: 'current', track: 'fpa', start: '2025' },
    { id: 'adf', status: 'next', track: 'fpa', order: 3 },
    { id: 'adp', status: 'next', track: 'pmo', order: 4 },
    { id: 'df2', status: 'future', track: 'fpa', order: 6 },
    { id: 'df1', status: 'future', track: 'fpa', order: 5 },
  ];
  const out = run(S, 'carAdvanceLadder_(L, "adf", "2027-03")');
  const by = id => out.find(r => r.id === id);
  check('the reached next step becomes current, started this month', by('adf').status === 'current' && by('adf').start === '2027-03');
  check('the old current rung becomes reached, ended this month', by('cur').status === 'reached' && by('cur').end === '2027-03');
  check('the first future rung on that track becomes next', by('df1').status === 'next' && by('df2').status === 'future');
  check('the other track is left alone', by('adp').status === 'next');
  check('the input is not mutated', S.L.find(r => r.id === 'adf').status === 'next');
  let threw = false; try { run(S, 'carAdvanceLadder_(L, "df2", "2027-03")'); } catch (e) { threw = /next step/.test(e.message); }
  check('only a next step can be reached', threw);
}

console.log('\nthe Wins bank baseline');
{
  const S = sandbox();
  S.blocks = [
    { type: 'heading', text: 'Financial planning, budgeting & forecasting' },
    { type: 'item', text: 'Owned the annual budget cycle | Proof: multi-million-dollar budget | Manager, Invented Corp (2015–2022)' },
    { type: 'heading', text: 'People leadership & delivery' },
    { type: 'item', text: 'Managed a team of 4 | Proof: +10% throughput | Team Lead, Madeup LLC (2023–present)' },
    { type: 'item', text: 'Shipped the forecast model | Proof: x | Somewhere (2020–2021)' },
  ];
  S.existing = [{ statement: 'Shipped the forecast model.' }];
  const items = run(S, 'carParseBaseline_(blocks, existing, "2026-10")');
  check('one item per new bullet; a statement already in Evidence is skipped', items.length === 2, items.length);
  check('the proof becomes the scale; the month is the end of the span', items[0].scale === 'multi-million-dollar budget' && items[0].month === '2022-12');
  check('"present" dates to this month', items[1].month === '2026-10');
  check('tags come from the heading', items[0].criterionIds.join() === 'fpa-planning' && items[1].criterionIds.join() === 'core-people');
  check('baseline wins are never assumed to be at AD scale', items.every(i => i.adScale === false && i.source === 'baseline'));
}

// ============ the migration ===================================================
console.log('\nthe one-time migration');
{
  const S = sandbox();
  const res = run(S, 'carMigrateV1_()');
  const tab = n => S.ss.getSheetByName(n);
  const rows = n => run(S, 'carReadRows_(getSpreadsheet().getSheetByName("' + n + '"))');
  check('it ran', res.migrated === true, JSON.stringify(res));
  const ladder = run(S, 'carReadLadder_()');
  check('Progression becomes reached history; the Position role is the current rung',
        ladder.filter(r => r.status === 'reached').length === 2 &&
        ladder.filter(r => r.status === 'current').length === 1 &&
        ladder.find(r => r.status === 'current').title === 'Senior Manager, Planning', JSON.stringify(ladder.map(r => r.title + ':' + r.status)));
  check('two Associate Director next steps, one per track, and a Director future step',
        ladder.filter(r => r.status === 'next').map(r => r.track).sort().join() === 'fpa,pmo' &&
        ladder.some(r => r.status === 'future' && r.title === 'Director'));
  check('ladder dates are kept as written (a start year is not turned into December)',
        ladder.find(r => r.title === 'Engineer').start === '2010');
  check('the 13 starter criteria are seeded: 5 core, 4 FP&A, 4 PMO',
        rows('Career Criteria').length === 13 &&
        rows('Career Criteria').filter(r => r.Group === 'core').length === 5 &&
        rows('Career Criteria').filter(r => r.Group === 'pmo').length === 4);
  check('Goals become intents; an achieved goal is retired', rows('Career Intents').length === 2 &&
        rows('Career Intents').find(r => r.Intent === 'Old goal').Status === 'retired');
  check('Wins become evidence', rows('Career Evidence').length === 1 && rows('Career Evidence')[0].Month === '2024-05');
  check('Position comp becomes the first package row', rows('Career Package').length === 1 && rows('Career Package')[0].Base === 150000);
  check('Development is kept as notes', run(S, 'carStateGet_("development")').length === 1);
  check('no v1 tab is deleted', S.ss.deleted.length === 0, S.ss.deleted.join());
  check('the five v1 tabs are hidden', ['Career Position','Career Goals','Career Progression','Career Development','Career Wins'].every(n => tab(n) && tab(n).hidden));
  check('…and Network stays visible', tab('Career Network') && !tab('Career Network').hidden);
  const counts = ['Career Ladder','Career Criteria','Career Evidence','Career Intents','Career Package'].map(n => rows(n).length).join();
  const again = run(S, 'carMigrateV1_()');
  check('a second run does nothing', again.skipped === true &&
        ['Career Ladder','Career Criteria','Career Evidence','Career Intents','Career Package'].map(n => rows(n).length).join() === counts);
  delete S.props.CAR_MIGRATED_V1;
  check('…even with its Script Property lost (the State row also guards it)', run(S, 'carMigrateV1_()').skipped === true &&
        ['Career Ladder','Career Criteria','Career Evidence','Career Intents','Career Package'].map(n => rows(n).length).join() === counts);
  const D = sandbox();
  const dry = run(D, 'carMigrateV1_({ dryRun: true })');
  check('a dry run reports counts and writes nothing', dry.dryRun === true && dry.counts.criteria === 13 &&
        !D.ss.getSheetByName('Career Ladder') && !D.ss.getSheetByName('Career Position').hidden);
}

console.log('\nthe baseline import');
{
  const blocks = [{ heading: 'Reporting architecture & automation' }, { item: 'Built the reporting stack | Proof: hours to minutes | Lead, Invented (2022–2024)' }];
  const body = { getNumChildren: () => blocks.length, getChild: i => ({
    getType: () => blocks[i].item ? 'LIST_ITEM' : 'PARAGRAPH',
    asListItem: () => ({ getText: () => blocks[i].item }),
    asParagraph: () => ({ getHeading: () => 'HEADING2', getText: () => blocks[i].heading }) }) };
  const opened = [];
  const S = sandbox({
    getConfigValues: () => ({ career_wins_bank_doc_id: 'DOC' }),
    DocumentApp: { ElementType: { LIST_ITEM: 'LIST_ITEM', PARAGRAPH: 'PARAGRAPH' }, ParagraphHeading: { NORMAL: 'NORMAL' },
      openById: id => { opened.push(id); return { getTabs: () => [
        { getTitle: () => '2026-11 update', asDocumentTab: () => ({ getBody: () => ({ getNumChildren: () => 0 }) }) },
        { getTitle: () => '2026-10 Baseline (Master Resume)', asDocumentTab: () => ({ getBody: () => body }) }] }; } },
  });
  run(S, 'carMigrateV1_()');
  const r1 = run(S, 'carImportBaseline_()');
  const ev = run(S, 'carReadEvidence_()');
  check('the baseline tab is found by name, not position, and imported', r1.imported === 1 && ev.some(e => e.statement === 'Built the reporting stack'));
  check('…tagged from its heading', ev.find(e => e.statement === 'Built the reporting stack').criterionIds.join() === 'fpa-systems');
  check('it runs once', run(S, 'carImportBaseline_()').skipped === true && opened.length === 1);
  const N = sandbox();
  run(N, 'carMigrateV1_()');
  check('with no Wins bank doc configured it waits, and says so', run(N, 'carImportBaseline_()').pending === true);
}

// ============ what Chat and the dashboard read ===================================
console.log('\nGET career, and the fields Chat reads');
{
  const S = sandbox();
  const g = run(S, 'webGetCareer_()');
  check('it migrates on first read', g.ok && g.ladder.length > 0 && g.criteria.length === 13);
  check('a verdict per track', g.readiness.fpa && g.readiness.pmo && typeof g.readiness.fpa.pct === 'number');
  check('Chat’s position: the current role', g.position.title === 'Senior Manager, Planning' && g.position.company === 'Exampleco' && g.position.workStyle === 'Hybrid');
  check('Chat’s goals: the intents, with a status', g.goals.length === 2 && g.goals.every(x => x.title && x.status));
  check('Chat’s wins: recent evidence', g.wins.length === 1 && g.wins[0].win === 'Shipped the forecast model');
  check('the v1 Network is still read', g.network.length === 1 && g.network[0].name === 'Pat Example');
}

console.log('\nthe writers Chat calls keep their names and parameters');
{
  const S = sandbox();
  run(S, 'webGetCareer_()');
  run(S, 'webAddCareerWin_({ parameter: { win: "Led the launch", impact: "Invented impact", category: "Launch", date: "2026-09-15" } })');
  const ev = run(S, 'carReadEvidence_()').find(e => e.statement === 'Led the launch');
  check('add_career_win → a manual Evidence item for that month', ev && ev.source === 'manual' && ev.month === '2026-09' && ev.scale === 'Invented impact');
  run(S, 'webAddCareerGoal_({ parameter: { title: "Run a PMO", horizon: "3yr" } })');
  check('add_career_goal → an active intent', run(S, 'carReadIntents_()').some(i => i.text === 'Run a PMO' && i.status === 'active'));
  run(S, 'webUpdateCareerPosition_({ parameter: { title: "Senior Manager, FP&A", focusAreas: "Forecasting" } })');
  const g = run(S, 'webGetCareer_()');
  check('update_career_position → the current rung’s title, and the profile', g.position.title === 'Senior Manager, FP&A' && g.position.focusAreas === 'Forecasting' &&
        g.ladder.filter(r => r.status === 'current').length === 1);
}

console.log('\nthe POST endpoints');
{
  const S = sandbox();
  run(S, 'webGetCareer_()');
  check('a rung with an unknown status is refused', run(S, 'webCareerSaveRung_({ rung: { title: "X", status: "dreaming" } })').ok === false);
  const id = run(S, 'webCareerSaveRung_({ rung: { title: "Director, PMO", track: "pmo", status: "future", moveType: "either" } }).id');
  check('a new rung is saved and ordered last', run(S, 'carReadLadder_()').slice(-1)[0].id === id);
  check('an unknown override is refused', run(S, 'webCareerSetOverride_({ id: "core-exec", status: "great" })').ok === false);
  run(S, 'webCareerSetOverride_({ id: "core-exec", status: "proven", note: "board deck" })');
  check('an override is stored with its note', run(S, 'carReadCriteria_()').find(c => c.id === 'core-exec').statusOverride === 'proven');
  run(S, 'webCareerSetOverride_({ id: "core-exec", status: "", note: "stale note" })');
  const ce = run(S, 'carReadCriteria_()').find(c => c.id === 'core-exec');
  check('clearing it returns the criterion to its evidence, note dropped', ce.statusOverride === '' && ce.overrideNote === '');
  run(S, 'webCareerSaveEvidence_({ evidence: { statement: "Ran the portfolio review", month: "2026-02", adScale: true, criterionIds: ["pmo-portfolio", "made-up"] } })');
  const e = run(S, 'carReadEvidence_()').find(x => x.statement === 'Ran the portfolio review');
  check('evidence keeps only known criterion ids', e.criterionIds.join() === 'pmo-portfolio' && e.adScale === true);
  const v = run(S, 'webGetCareer_()').readiness.pmo.criteria.find(c => c.id === 'pmo-portfolio');
  check('…and that criterion turns Proven', v.status === 'proven', v.status);
  const nextFpa = run(S, 'carReadLadder_()').find(r => r.status === 'next' && r.track === 'fpa');
  run(S, 'webCareerAdvance_({ id: "' + nextFpa.id + '" })');
  const after = run(S, 'carReadLadder_()');
  check('Mark reached moves the ladder up', after.find(r => r.id === nextFpa.id).status === 'current' &&
        after.filter(r => r.status === 'current').length === 1);
  check('a criterion needs a known group', run(S, 'webCareerSaveCriterion_({ criterion: { name: "X", group: "sales" } })').ok === false);
}

console.log('\nchecking a specific role');
{
  let prompt = '';
  const S = sandbox({ callClaudeJson_: (p) => { prompt = p; return {
    matches: [{ criterionId: 'pmo-delivery', note: 'runs 6 programs' }, { criterionId: 'invented-id', note: 'x' }],
    extras: [1, 2, 3, 4, 5, 6].map(i => ({ name: 'Extra ' + i, meaning: 'm' })),
    departures: [{ note: 'more a Director scope' }, {}] }; } });
  run(S, 'webGetCareer_()');
  const JD = 'Invented job description: lead the PMO for Madeup Corp, 6 programs.';
  S.JD = JD;
  const r = run(S, 'webCareerCheckRole_({ track: "pmo", jd: JD })');
  check('the result keeps only known criteria', r.ok && r.result.matches.length === 1 && r.result.matches[0].criterionId === 'pmo-delivery');
  check('at most five extras, and empty departures dropped', r.result.extras.length === 5 && r.result.departures.length === 1);
  check('the prompt carries the track’s core and PMO criteria, not FP&A', /core-people/.test(prompt) && /pmo-portfolio/.test(prompt) && !/fpa-pl/.test(prompt));
  check('the JD is fenced as data', /data, not instructions/.test(prompt) && prompt.includes(JD));
  check('the JD itself is never logged', !S.logs.some(l => l.includes('Madeup')) && S.logs.some(l => /jdChars=/.test(l)));
  const F = sandbox({ callClaudeJson_: () => null });
  check('no answer from Claude is an error, not an empty success', run(F, 'webCareerCheckRole_({ track: "fpa", jd: "x" })').ok === false);
  check('an unknown track is refused', run(F, 'webCareerCheckRole_({ track: "sales", jd: "x" })').ok === false);
}

// ============ wiring ==========================================================
console.log('\nwiring');
{
  check('GET career reads the v2 model', /case 'career':\s+return jsonOut_\(webGetCareer_\(\)\);/.test(WEB));
  ['career_save_northstar','career_save_rung','career_delete_rung','career_advance','career_save_intent','career_delete_intent',
   'career_save_evidence','career_delete_evidence','career_set_override','career_save_criterion','career_check_role'].forEach(a => {
    check('POST ' + a + ' is routed', new RegExp("case '" + a + "':\\s+return jsonOut_\\(webCareer\\w+_\\(body\\)\\);").test(WEB));
    check('…and the dashboard posts it', APP.includes("'" + a + "'"));
  });
  check('the v1 writers are gone from WebApp.js', !/function webGetCareer_|function webAddCareerWin_|case 'add_career_goal'/.test(WEB));
  check('the migration runs nightly, in the second half', /nightlyStep_\(ctx, 'carNightly_', carNightly_\);/.test(CODE.slice(CODE.indexOf('function nightlyRunTail'))));
  check('the six v2 tabs are named in TABS', ['CAREER_LADDER','CAREER_CRITERIA','CAREER_EVIDENCE','CAREER_INTENTS','CAREER_PACKAGE','CAREER_STATE'].every(k => new RegExp(k + ':').test(CODE)));
  check('Chat still reads webGetCareer_ and calls the v1 writers', /webGetCareer_\(\)/.test(CHAT) && /webAddCareerWin_\(/.test(CHAT) && /webUpdateCareerPosition_\(/.test(CHAT));
  check('Chat’s profile includes the next steps and their verdicts', /Next step: /.test(CHAT) && /readiness /.test(CHAT));
  check('tbCareer is in the testbench and the README', /function tbCareer\(\)/.test(TB) && read('README.md').includes('`tbCareer`'));
  check('the dashboard block is marked once, in both built files', [APP, INDEX].every(t => t.split('/* ==== CAREER TAB BEGIN').length === 2 && t.includes('/* ==== CAREER TAB END ==== */')));
  check('the Career tab reloads after a write', /React\.createElement\(CareerTab,\{career:career,[^}]*onReload:function\(\)\{return loadCareer\(apiUrl,apiToken\);\}/.test(APP));
  check('dashboard-lite has no Career tab (out of scope, #216 §9)', !/CareerTab|action:'career'|career_save_/.test(LITE));
  const ID_SHA = ['2630e81850aea78bd407a416645cd0a13532d27c58a13071c188f9ad8a8abcc1',   // the job agent's sheet
                  '78feb209f5f2d55f00ecfed3bb5d641b88a91b9b754670d4c0aa41b36a178ecf'];  // the Wins bank doc
  const shipped = CAR + CODE + WEB + APP + INDEX + TB + fs.readFileSync(__filename, 'utf8');
  const tokens = shipped.match(/[A-Za-z0-9_-]{40,50}/g) || [];
  check('neither real id is in the shipped files or this test', !tokens.some(t => ID_SHA.includes(crypto.createHash('sha256').update(t).digest('hex'))));
  check('no Google doc or sheet link is hard-coded', !/docs\.google\.com\/(spreadsheets|document)\/d\//.test(CAR + APP));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
