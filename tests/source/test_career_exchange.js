// Career tab v2, phase 3 (issue #216): Network, Market, Brand, Exchange and the
// "How it connects" view. Exchange is the only PIES ↔ VERA bridge: a payload is
// refused unless its header is right, previewed with names / figures /
// initiative terms marked, imported only once confirmed, and logged. A role
// pasted in through Exchange lives in VERA's own tab: the agent's Tracker is
// never written. Invented companies, people and figures throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { extractFn, FakeSheet, FakeSS, sandbox, run } = require('./career_fixtures.js')(read);
const CAR = read('Career.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), INDEX = read('docs/index.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(2026, 9, 23, 12); }
  static now() { return new Date(2026, 9, 23, 12).getTime(); }
}

const TRACKER = () => [['Date found', 'Company', 'Title', 'Tier', 'Score', 'Job link', 'Status', 'Salary range', 'Track'],
  ['2026-10-22', 'Invented Corp', 'Associate Director, FP&A', '1', '86', 'https://jobs.example/a', 'New', '$150K–$210K', 'FP&A'],
  ['2026-10-22', 'Madeup LLC', 'Associate Director, PMO', '1', '80', 'https://jobs.example/b', 'New', '$140,000 - $190,000', 'PMO'],
  ['2026-10-23', 'Other Co', 'Associate Director, FP&A', '2', '74', 'https://jobs.example/c', 'Handoff', '$160K–$230K', 'FP&A'],
  ['2026-10-23', 'No Pay Inc', 'Director, Finance', '2', '72', 'https://jobs.example/d', 'New', '', 'FP&A']];

// A migrated sandbox with the job agent's sheet; every write to that sheet is recorded.
function full(over) {
  const agent = new FakeSS({ Tracker: TRACKER() });
  const agentWrites = [];
  const tr = agent.sheets.Tracker;
  const gr = tr.getRange.bind(tr);
  tr.getRange = (r, c, nr, nc) => { const g = gr(r, c, nr, nc); const sv = g.setValue, svs = g.setValues;
    g.setValue = v => { agentWrites.push([r, c, v]); return sv(v); }; g.setValues = v => { agentWrites.push([r, c, 'many']); return svs(v); }; return g; };
  tr.appendRow = row => { agentWrites.push(['append']); FakeSheet.prototype.appendRow.call(tr, row); };
  const S = sandbox(Object.assign({
    Date: FixedDate,
    getConfigValues: () => ({ career_alert_sheet_id: 'AGENT' }),
    SpreadsheetApp: { openById: id => { if (id !== 'AGENT') throw new Error('cannot open'); return agent; } },
    recordApiHealth_: () => {},
  }, over || {}));
  S.ss.sheets.Flags = new FakeSheet('Flags', [['ID','Date','Source','Flag','Reason','Urgency','Ack','Snooze','Resolved','Key','x']]);
  vm.runInContext(extractFn(CODE, 'appendExactKeyFlags_') + extractFn(CODE, 'resolveFlagsWithPrefix_') + 'function colorCodeFlags(){}', S);
  run(S, 'webGetCareer_()');
  S.agent = agent; S.agentWrites = agentWrites;
  return S;
}
const rows = (S, tab) => run(S, 'carReadRows_(getSpreadsheet().getSheetByName(' + JSON.stringify(tab) + '))');
const J = v => JSON.stringify(v);

// ============ Network ==========================================================
console.log('Network');
{
  const S = full();
  check('the v1 Network migrates once', rows(S, 'Career Contacts').length === 1);
  run(S, 'carStateSet_("contacts_v1", null)');
  delete S.props.CAR_MIGRATED_V1;
  run(S, 'carMigrateContacts_()');
  check('…and never on top of contacts already there', rows(S, 'Career Contacts').length === 1);
  const fresh = sandbox({ Date: FixedDate });
  run(fresh, 'carMigrateV1_()');   // Phase 1 already ran in production; Network was left visible
  check('a Phase 1 migration leaves Network visible…', !fresh.ss.getSheetByName('Career Network').hidden);
  run(fresh, 'carEnsureMigrated_()');
  check('…and Phase 3 still copies it and hides it, never deletes it', rows(fresh, 'Career Contacts').length === 1 && (fresh.ss.getSheetByName('Career Network') || {}).hidden === true && fresh.ss.deleted.length === 0);

  const T = [{ id: 'fpa', name: 'FP&A' }, { id: 'pmo', name: 'PMO' }];
  S.T = T;
  const gap = cs => J(run(S, 'carSponsorGap_(' + J(cs) + ', T)'));
  const c = (role, warmth, tracks) => ({ role, warmth, tracks: tracks || [] });
  check('no sponsor: a gap on every track', gap([c('mentor', 'strong')]) === J({ fpa: true, pmo: true }));
  check('a sponsor tagged to one track covers that track only', gap([c('sponsor', 'warm', ['fpa'])]) === J({ fpa: false, pmo: true }));
  check('an untagged sponsor covers both', gap([c('sponsor', 'strong')]) === J({ fpa: false, pmo: false }));
  check('a cold sponsor doesn’t count', gap([c('sponsor', 'cold')]) === J({ fpa: true, pmo: true }));
  S.T2 = [{ id: 'fpa', name: 'FP&A' }, { id: 'pmo', name: 'PMO', status: 'retired' }];
  check('a retired track isn’t judged', J(run(S, 'carSponsorGap_([], T2)')) === J({ fpa: true }));

  check('an unknown role is refused', run(S, 'webCareerSaveContact_({ contact: { name: "X", role: "boss" } })').ok === false);
  check('a contact needs a name', run(S, 'webCareerSaveContact_({ contact: { name: " " } })').ok === false);
  const saved = run(S, 'webCareerSaveContact_({ contact: { name: "Hiring manager", org: "Invented Corp", role: "hiring-manager", tracks: ["fpa", "evil"], source: "agent" } })');
  const ct = run(S, 'carReadContacts_()').find(x => x.id === saved.id);
  check('a saved contact keeps only known tracks and its source', saved.ok && J(ct.tracks) === '["fpa"]' && ct.source === 'agent' && ct.role === 'hiring-manager');
  run(S, 'webCareerTouchContact_({ id: ' + J(saved.id) + ' })');
  check('“Touched today” sets the last-touch date, and nothing else', run(S, 'carReadContacts_()').find(x => x.id === saved.id).lastTouch === '2026-10-23' &&
        run(S, 'carReadContacts_()').find(x => x.id === saved.id).org === 'Invented Corp');
  check('the dashboard turns a suggested person into a contact without inventing a name', (() => {
    const D = {}; vm.createContext(D);
    vm.runInContext(extractFn(APP, 'carContactFromMatch'), D);
    const r = vm.runInContext('carContactFromMatch({ suggestedPerson: "Talent partner", company: "Madeup LLC", track: "pmo", title: "AD, PMO" })', D);
    return r.name === 'Talent partner' && r.role === 'recruiter' && r.warmth === 'cold' && J(r.tracks) === '["pmo"]' && r.source === 'agent';
  })());
}

// ============ Market ===========================================================
console.log('\nMarket');
{
  const S = full();
  check('a range parses to its ends, in K or in full', J(run(S, 'carParseRange_("$108.5K–$185K")')) === '[108500,185000]' &&
        J(run(S, 'carParseRange_("$140,000 - $190,000")')) === '[140000,190000]' && run(S, 'carParseRange_("competitive")') === null);
  S.pkg = { base: 150000, bonusPct: 10, equityPerYr: 20000, unvestedForfeited: 30000, match401k: 6000, benefitsValue: 14000 };
  const est = run(S, 'carEstTotal_(pkg)');
  check('the estimated total adds base, bonus, equity, match and benefits', est.total === 150000 + 15000 + 20000 + 6000 + 14000 && est.bonus === 15000);
  check('a bonus amount wins over a percentage', run(S, 'carEstTotal_({ base: 100000, bonusPct: 10, bonusAmt: 25000 })').bonus === 25000);
  check('no base, no estimate', run(S, 'carEstTotal_({ bonusPct: 10 })') === null && run(S, 'carEstTotal_(null)') === null);
  const cmp = run(S, 'carCompareToPackage_("$160K–$220K", pkg, { base: 170000 })');
  check('the midpoint is compared with the base', cmp.mid === 190000 && cmp.pctMid === 27 && cmp.pctTop === 47, J(cmp));
  check('the estimated total keeps your bonus rate, match and benefits, and no equity', cmp.estTotalMid === 190000 + 19000 + 6000 + 14000 && cmp.vsTotal === 229000 - 205000);
  check('the first year loses the unvested equity and this year’s bonus', cmp.firstYearVsTotal === 229000 - 30000 - 15000 - 205000);
  check('a clear raise is a step up', cmp.verdict === 'step-up' && cmp.clearsFloor === true);
  check('a range that can’t reach the floor is below it', run(S, 'carCompareToPackage_("$120K–$160K", pkg, { base: 170000 })').verdict === 'below-floor');
  check('a range around today’s base is lateral', run(S, 'carCompareToPackage_("$140K–$160K", pkg, {})').verdict === 'lateral');
  check('a lower range is a step down', run(S, 'carCompareToPackage_("$100K–$120K", pkg, {})').verdict === 'step-down');
  check('no package: the range is shown, with nothing to compare', run(S, 'carCompareToPackage_("$100K–$120K", null, {})').verdict === 'no-package');
  check('no range: no comparison', run(S, 'carCompareToPackage_("", pkg, {})') === null);

  const b = run(S, 'carBenchmarks_(' + J([
    { track: 'fpa', title: 'Associate Director, FP&A', salaryRange: '$150K–$210K' },
    { track: 'fpa', title: 'Associate Director, Finance', salaryRange: '$160K–$230K' },
    { track: 'fpa', title: 'Associate Director, FP&A', salaryRange: '$170K–$200K' },
    { track: 'fpa', title: 'Director, Finance', salaryRange: '' },
    { track: 'pmo', title: 'Associate Director, PMO', salaryRange: '$140K–$190K' }]) + ')');
  const fpa = b.find(x => x.track === 'fpa' && x.level === 'Associate Director');
  check('benchmarks are medians by track and level, from stated pay only', b.length === 2 && fpa.count === 3 && fpa.lo === 160000 && fpa.hi === 210000 && fpa.mid === 185000, J(b));

  check('a package needs a base', run(S, 'webCareerSavePackage_({ package: { asOf: "2026-10" } })').ok === false);
  const before = rows(S, 'Career Package').length;   // the migrated row, as of this month (2026-10)
  run(S, 'webCareerSavePackage_({ package: { asOf: "2026-10", base: "155,000", bonusPct: "10" } })');
  run(S, 'webCareerSavePackage_({ package: { asOf: "2026-10", base: "156000" } })');
  check('the same “as of” month updates its row', before === 1 && rows(S, 'Career Package').length === 1 && run(S, 'carReadPackage_()').base === 156000, rows(S, 'Career Package').length);
  run(S, 'webCareerSavePackage_({ package: { asOf: "2027-01", base: "170000" } })');
  check('a new month adds a row, keeping the history', rows(S, 'Career Package').length === 2 && run(S, 'carReadPackage_()').base === 170000);

  const p = run(S, 'webGetCareerPipeline_()');
  check('each match is compared with the package', p.rows.find(r => r.company === 'Invented Corp').market.verdict !== undefined && p.rows.find(r => r.company === 'No Pay Inc').market === null);
  check('the Pipeline carries the benchmarks', p.benchmarks.length >= 2 && p.packageEst.base === 170000);
}

// ============ Brand ============================================================
console.log('\nBrand');
{
  const S = full();
  run(S, 'webCareerSaveBrand_({ brand: { positioning: { core: "Finance leader", evil: "x" }, resumes: [{ label: "Master", url: "https://docs.example/r" }, { label: "Bad", url: "http://plain.example" }, { label: "Script", url: "javascript:alert(1)" }], linkedin: [{ label: "About", text: "" }, { label: "Headline", text: "FP&A and PMO" }], staticProfile: "Invented arc", extra: "dropped" } })');
  const g = run(S, 'webGetCareer_()').brand;
  check('only https resume links are kept', g.resumes.length === 1 && g.resumes[0].label === 'Master');
  check('empty LinkedIn versions are dropped', g.linkedin.length === 1 && g.linkedin[0].label === 'Headline');
  check('unknown fields are dropped', g.extra === undefined && g.positioning.evil === undefined && g.positioning.core === 'Finance leader');
  check('the static profile is kept for MATCHER-CONTEXT', g.staticProfile === 'Invented arc');
}

// ============ Exchange: inbound ================================================
console.log('\nExchange: parsing');
const BRIEF = (period, extra) => 'PIES-BRIEF v1 | ' + (period || '2026-10') + '\n' + JSON.stringify(Object.assign({
  accomplishments: [
    { statement: 'Led the quarterly reforecast across four business units', scale: 'multi-billion-dollar portfolio', criterion: 'Planning & forecasting ownership' },
    { statement: 'Presented the investment case to the CFO staff', scale: '', criterion: 'Executive visibility' },
    { statement: 'Untagged item', scale: '', criterion: 'Not a criterion' }],
  scopeThemes: ['Broader portfolio'], visibilityChanges: [], feedbackThemes: ['Strategic'],
  readinessUpdates: [{ criterion: 'People leadership', status: 'partial', reason: 'Two direct reports' }, { criterion: 'Nope', status: 'proven', reason: '' }, { criterion: 'Org scope', status: 'great' }],
  internalCalibration: [{ level: 'AD', function: 'FP&A', track: 'fpa', score: 78, keyGap: 'P&L ownership' }, { level: 'AD', function: 'Ops', track: 'ops', score: 50 }],
}, extra || {}), null, 1);
const ROLE = (link, extra) => 'ROLE-MATCH v1 | 2026-10-23\n```json\n' + JSON.stringify(Object.assign({ dateFound: '2026-10-23', title: 'Associate Director, PMO', company: 'Elsewhere Co',
  level: 'Associate Director', track: 'pmo', score: { total: 82, level: 22, functional: 20, skills: 20, trajectory: 20 }, salaryRange: '$150K–$200K',
  suggestedPerson: 'Head of PMO', jobLink: link, calibrationNote: 'Strong on governance' }, extra || {})) + '\n```';
{
  const S = full();
  const P = t => run(S, 'carParseInbound_(' + J(t) + ')');
  check('no header is refused, and says what is expected', /first line must be/.test(P('{"accomplishments":[]}').error));
  check('an unknown payload is refused', /isn’t something Exchange imports/.test(P('VERA-INTENTS v1 | 2026-Q4\n1. x').error));
  check('a v2 brief is refused', /v2 isn’t supported/.test(P(BRIEF().replace('v1', 'v2')).error));
  check('a brief period must be YYYY-MM', /YYYY-MM/.test(P(BRIEF('2026-13')).error));
  check('JSON that doesn’t parse is refused', /doesn’t parse/.test(P('PIES-BRIEF v1 | 2026-10\n{ not json').error));
  check('a brief without accomplishments is refused', /accomplishments/.test(P('PIES-BRIEF v1 | 2026-10\n{"scopeThemes":[]}').error));
  const ok = P(BRIEF());
  check('a good brief parses', ok.ok && ok.period === '2026-10' && ok.brief.accomplishments.length === 3);
  check('readiness updates need a known status', ok.brief.readinessUpdates.length === 2);
  check('calibration lines need a track', ok.brief.internalCalibration.length === 1 && ok.brief.internalCalibration[0].fn === 'FP&A');
  const rm = P(ROLE('https://jobs.example/new'));
  check('a ROLE-MATCH parses, code fences and all, with its breakdown', rm.ok && rm.match.score === 82 && rm.match.breakdown === 'L 22 · F 20 · S 20 · T 20', J(rm));
  check('a ROLE-MATCH needs a track', /track/.test(P(ROLE('x', { track: 'ops' })).error));
  check('a ROLE-MATCH needs a title and company', /title and a company/.test(P(ROLE('x', { company: '' })).error));

  const marks = run(S, 'carSanitizeHighlights_(' + J(['Led Project Falcon with Acme Corp for $2.5M of savings', 'Cut 3 billion in spend on ATLAS', 'Owned FP&A and PMO reporting for the Associate Director and VP']) + ')');
  const has = (k, t) => marks.some(m => m.kind === k && m.text === t);
  check('dollar figures are marked', has('figure', '$2.5M') && has('figure', '3 billion'), J(marks));
  check('initiative-like terms are marked', has('initiative', 'Project Falcon') && has('initiative', 'ATLAS'), J(marks));
  check('proper nouns are marked', has('name', 'Acme Corp'), J(marks));
  check('ordinary career words are not', !marks.some(m => /^(Led|FP|PMO|Associate Director|VP|Owned)$/.test(m.text)), J(marks));
}

console.log('\nExchange: preview, import, the log');
{
  const S = full();
  const counts = () => ['Career Evidence', 'Career Exchange Log', 'Career Role Matches'].map(t => rows(S, t).length).join();
  const before = counts();
  const pv = run(S, 'webCareerExchangePreview_({ text: ' + J(BRIEF()) + ' })');
  check('a preview shows what would be imported, marks what to check, and saves nothing', pv.ok && pv.content.accomplishments.length === 3 && pv.marks.length > 0 && counts() === before, counts());
  check('the pasted text is never logged', !S.logs.some(l => /reforecast/.test(l)));
  check('an import that wasn’t confirmed is refused', run(S, 'webCareerExchangeImport_({ text: ' + J(BRIEF()) + ' })').ok === false && counts() === before);
  const imp = run(S, 'webCareerExchangeImport_({ text: ' + J(BRIEF()) + ', confirmed: true })');
  const ev = run(S, 'carReadEvidence_()').filter(e => e.source === 'PIES-BRIEF');
  check('accomplishments become Evidence, tagged by criterion name', imp.ok && ev.length === 3 &&
        J(ev.find(e => /reforecast/.test(e.statement)).criterionIds) === '["fpa-planning"]' && ev.every(e => e.month === '2026-10'), J(ev));
  check('…an unknown criterion is left untagged, not guessed', ev.find(e => e.statement === 'Untagged item').criterionIds.length === 0);
  check('…and nothing is claimed at AD scale', ev.every(e => !e.adScale));
  const g = run(S, 'webGetCareer_()');
  check('readiness updates are kept beside their criterion, never as an override', g.piesReadiness.updates.length === 1 && g.piesReadiness.updates[0].criterionId === 'core-people' &&
        !g.criteria.find(c => c.id === 'core-people').statusOverride);
  check('calibration lines reach the Pipeline', run(S, 'webGetCareerPipeline_()').calibration.lines.length === 1);
  check('the import is logged, counts only', g.exchange.log[0].direction === 'in' && g.exchange.log[0].payload === 'PIES-BRIEF' && g.exchange.log[0].period === '2026-10' && !/reforecast/.test(g.exchange.log[0].summary));
  const again = run(S, 'webCareerExchangeImport_({ text: ' + J(BRIEF()) + ', confirmed: true })');
  check('the same month’s brief can’t be imported twice', again.ok === false && /already imported/.test(again.error));
  const dupStatement = run(S, 'webCareerExchangeImport_({ text: ' + J(BRIEF('2026-11')) + ', confirmed: true })');
  check('a statement already in Evidence is not added again', dupStatement.ok && dupStatement.evidence === 0);

  const r1 = run(S, 'webCareerExchangeImport_({ text: ' + J(ROLE('https://jobs.example/new')) + ', confirmed: true })');
  check('a ROLE-MATCH lands in VERA’s own tab', r1.ok && rows(S, 'Career Role Matches').length === 1);
  check('…and the agent’s Tracker is never written', S.agentWrites.length === 0 && S.agent.sheets.Tracker.rows.length === TRACKER().length);
  const pipe = run(S, 'webGetCareerPipeline_()');
  const x = pipe.rows.find(r => r.source === 'exchange');
  check('it shows in the Pipeline, marked as from Exchange', x && x.company === 'Elsewhere Co' && x.track === 'pmo' && x.status === 'New');
  check('a posting the agent already has is refused as a duplicate', /already has this posting/.test(run(S, 'webCareerExchangeImport_({ text: ' + J(ROLE('https://jobs.example/a')) + ', confirmed: true })').error));
  check('…and so is one already pasted', /already in the Pipeline/.test(run(S, 'webCareerExchangeImport_({ text: ' + J(ROLE('https://jobs.example/new')) + ', confirmed: true })').error));
  S.ss.getSheetByName('Career Role Matches').appendRow(['CM-dup', '2026-10-22', 'Madeup LLC', 'Associate Director, PMO', '', 'pmo', 80, '', '', '', 'https://jobs.example/b', 'New', '', '2026-10']);
  check('a pasted role the agent also found is one entry in the Pipeline', run(S, 'webGetCareerPipeline_()').rows.filter(r => r.jobLink === 'https://jobs.example/b').length === 1);
  const st = run(S, 'webCareerSetStatus_({ source: "exchange", id: ' + J(x.id) + ', status: "Handoff" })');
  check('its status is written in VERA’s tab, not the Tracker', st.ok && rows(S, 'Career Role Matches')[0].Status === 'Handoff' && S.agentWrites.length === 0);
  check('an unknown status is still refused', run(S, 'webCareerSetStatus_({ source: "exchange", id: ' + J(x.id) + ', status: "Interviewing" })').ok === false);
  run(S, 'webCareerSetStatus_({ source: "exchange", id: ' + J(x.id) + ', status: "Hired" })');
  const cur = run(S, 'carReadLadder_()').find(r => r.status === 'current');
  check('Hired on an Exchange role advances the ladder on its track', cur.company === 'Elsewhere Co' && cur.track === 'pmo' && cur.moveType === 'external', J(cur));
}

// ============ Exchange: outbound ===============================================
console.log('\nExchange: copy out');
{
  const S = full();
  S.L = [{ status: 'reached', title: 'Old', track: '' }, { status: 'current', title: 'Senior Manager, Planning' },
         { status: 'next', track: 'fpa', title: 'Associate Director, FP&A', level: 'Associate Director' },
         { status: 'next', track: 'pmo', title: 'Associate Director, PMO', level: 'Associate Director' }];
  S.I = [{ text: 'Own a plan end to end', status: 'active' }, { text: 'Old one', status: 'retired' }, { text: 'Build a sponsor', status: 'active' }];
  S.TR = [{ id: 'fpa', name: 'FP&A' }, { id: 'pmo', name: 'Program & Project Management' }];
  const intents = run(S, 'carBuildIntentsPayload_(I, "2026-Q4", L, TR)');
  check('VERA-INTENTS follows §3.4 exactly', intents === 'VERA-INTENTS v1 | 2026-Q4\nNext step: Associate Director — tracks: FP&A; Program & Project Management\nIntents:\n1. Own a plan end to end\n2. Build a sponsor', intents);
  const exp = run(S, 'webCareerExchangeExport_({ kind: "intents" })');
  check('copying intents logs it and records the quarter', exp.ok && /^VERA-INTENTS v1 \| 2026-Q4/.test(exp.text) && (run(S, 'carStateGet_("intents_exported")') || {}).quarter === '2026-Q4' &&
        run(S, 'carReadExchangeLog_()').some(l => l.direction === 'out' && l.payload === 'VERA-INTENTS' && l.period === '2026-Q4'));
  run(S, 'webCareerSavePackage_({ package: { asOf: "2026-10", base: "151234" } })');
  run(S, 'webCareerSaveNorthStar_({ northstar: { compFloor: { base: "175000" }, locationStance: "DC metro", dealbreakers: "none" } })');
  run(S, 'webCareerSaveBrand_({ brand: { staticProfile: "Invented arc: engineer to planning lead" } })');
  run(S, 'webCareerSaveEvidence_({ evidence: { month: "2026-09", statement: "Recent invented win" } })');
  run(S, 'webCareerSaveEvidence_({ evidence: { month: "2025-01", statement: "Old invented win" } })');
  const m = run(S, 'webCareerExchangeExport_({ kind: "matcher" })').text;
  check('MATCHER-CONTEXT opens with its header', /^MATCHER-CONTEXT v1 \| 2026-10-23\n/.test(m));
  check('…carries the static profile, role history, tracks and floors', /Invented arc/.test(m) && /Senior Manager, Planning, Exampleco/.test(m) && /Program & Project Management/.test(m) && /175000/.test(m));
  check('…only the last 3 months of evidence', /Recent invented win/.test(m) && !/Old invented win/.test(m));
  check('…the rubric, and asks for ROLE-MATCH v1 JSON only', /4 dimensions × 25 points/.test(m) && /ROLE-MATCH v1 \| YYYY-MM-DD/.test(m) && /never a name/.test(m));
  check('…and never the current package', !/151234|151,234/.test(m));
  check('an unknown export is refused', run(S, 'webCareerExchangeExport_({ kind: "everything" })').ok === false);
}

// ============ overdue, and the nightly flags ======================================
console.log('\noverdue and flags');
{
  const S = full();
  const od = (log, y, mo, d) => run(S, 'carExchangeOverdue_(' + J(log) + ', new Date(' + y + ', ' + mo + ', ' + d + '))');
  const brief = p => ({ direction: 'in', payload: 'PIES-BRIEF', period: p });
  const intents = q => ({ direction: 'out', payload: 'VERA-INTENTS', period: q });
  check('no brief yet: nothing is overdue', od([], 2026, 9, 23).brief.overdue === false);
  check('last month’s brief in: not overdue', od([brief('2026-09')], 2026, 9, 23).brief.overdue === false);
  check('last month’s brief missing: overdue', od([brief('2026-08')], 2026, 9, 23).brief.overdue === true && od([brief('2026-08')], 2026, 9, 23).brief.due === '2026-09');
  check('intents not sent by the quarter’s 15th day: overdue', od([], 2026, 9, 23).intents.overdue === true && od([intents('2026-Q3')], 2026, 9, 23).intents.overdue === true);
  check('…but not in its first two weeks', od([], 2026, 9, 5).intents.overdue === false);
  check('…and not once sent', od([intents('2026-Q4')], 2026, 11, 20).intents.overdue === false);

  const flags = () => S.ss.sheets.Flags.rows.slice(1);
  run(S, 'carCareerFlags_()');
  const keys = flags().map(f => f[9]).sort();
  check('a track with no sponsor and unsent intents each raise one flag', J(keys) === J(['career-intents-overdue__2026-Q4', 'career-no-sponsor__fpa__2026-Q4', 'career-no-sponsor__pmo__2026-Q4']), J(keys));
  run(S, 'carCareerFlags_()');
  check('…once', flags().length === 3);
  run(S, 'webCareerSaveContact_({ contact: { name: "Invented Sponsor", role: "sponsor", warmth: "warm", tracks: ["fpa"] } })');
  run(S, 'webCareerExchangeExport_({ kind: "intents" })');
  run(S, 'carCareerFlags_()');
  const st = k => flags().find(f => f[9] === k)[8];
  check('a sponsor for a track clears its flag; the other stays', st('career-no-sponsor__fpa__2026-Q4') === 'Yes' && st('career-no-sponsor__pmo__2026-Q4') !== 'Yes');
  check('sending intents clears theirs', st('career-intents-overdue__2026-Q4') === 'Yes');
  const N = sandbox({ Date: FixedDate });
  check('nothing is flagged before the Career data exists', run(N, 'carCareerFlags_()') === 'not migrated');
}

// ============ How it connects ======================================================
console.log('\nHow it connects');
{
  const D = {}; vm.createContext(D);
  vm.runInContext(APP.match(/var CAR_SYSTEMS=\[[\s\S]*?\];\nvar CAR_CROSSINGS=\[[\s\S]*?\];\nvar CAR_RULES=\[[\s\S]*?\];\nvar CAR_FILES=\[[\s\S]*?\];/)[0], D);
  const what = D.CAR_CROSSINGS.map(c => c.what).join('\n');
  const headers = new Set();
  [CAR, APP].forEach(src => (src.match(/\b[A-Z]+(?:-[A-Z]+)+ v1\b/g) || []).forEach(h => headers.add(h)));
  const payloads = vm.runInContext(CAR.match(/var CAR_PAYLOADS_ = \{[^}]*\};/)[0] + 'CAR_PAYLOADS_', vm.createContext({}));
  Object.values(payloads).forEach(p => headers.add(p + ' v1'));
  const missing = [...headers].filter(h => what.indexOf(h) === -1);
  check('every payload header VERA reads or writes is a listed crossing', headers.size >= 4 && missing.length === 0, missing.join(', '));
  check('the three systems are described', J(D.CAR_SYSTEMS.map(s => s.name)) === J(['PIES', 'VERA', 'Job agent']) && D.CAR_SYSTEMS.every(s => s.owns && s.never));
  check('every crossing says when, how and where it lands', D.CAR_CROSSINGS.every(c => c.from && c.to && c.when && c.how && c.lands));
  check('the five agent touches are all there', ['Settings', 'Wins bank', 'Status', 'Inbox link'].every(t => D.CAR_CROSSINGS.some(c => (c.what + c.lands).indexOf(t) !== -1)));
  const flat = J([D.CAR_SYSTEMS, D.CAR_CROSSINGS, D.CAR_RULES, D.CAR_FILES]);
  check('names only: no links or ids', !/https?:|\/d\/|[A-Za-z0-9_-]{30,}/.test(flat));
  check('a header button opens it', /className:'btn btn-ghost car-map-btn'/.test(APP) && APP.includes('carH(CarConnects,'));
}

// ============ wiring and cleanup =====================================================
console.log('\nwiring');
{
  ['career_save_contact', 'career_delete_contact', 'career_touch_contact', 'career_save_package', 'career_save_brand',
   'career_exchange_preview', 'career_exchange_import', 'career_exchange_export'].forEach(a => {
    check('POST ' + a + ' is routed', new RegExp("case '" + a + "':\\s+return jsonOut_\\(webCareer\\w+_\\(body\\)\\);").test(WEB));
    check('…and the dashboard uses it', APP.includes("'" + a + "'"));
  });
  check('the v1 Network GET writers are gone, route and function', !/career_network|webAddCareerNetwork_|webUpdateCareerNetwork/.test(WEB + APP));
  check('the legacy Network view is gone', !/CareerNetworkView|handleAddCareerNetwork/.test(APP));
  check('the flags run nightly, in the second half', /nightlyStep_\(ctx, 'carCareerFlags_', carCareerFlags_\);/.test(CODE.slice(CODE.indexOf('function nightlyRunTail'))));
  ['CAREER_CONTACTS', 'CAREER_EXCHANGE_LOG', 'CAREER_ROLE_MATCHES'].forEach(t => check(t + ' is a named tab', new RegExp(t + ":\\s*'Career ").test(CODE)));
  check('all eight subtabs, in the spec’s order, in both built files', [APP, INDEX].every(t =>
    /\{id:'northstar'[^\]]*\{id:'readiness'[^\]]*\{id:'evidence'[^\]]*\{id:'pipeline'[^\]]*\{id:'network'[^\]]*\{id:'market'[^\]]*\{id:'brand'[^\]]*\{id:'exchange'/.test(t)));
  check('the import sends confirmed only from the preview’s checkbox', /disabled:b\|\|!checked,onClick:doImport/.test(APP) && /action:'career_exchange_import',text:text,confirmed:true/.test(APP));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
