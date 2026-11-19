// Health › Care › Coverage (Coverage.js, issue #257): the cards and who-has-what READ from the household
// cheat sheet (never copied), private numbers, the doctors; the plan documents picked from Resources and
// read into VERA's Coverage tab with your corrections kept; the FSA check (answer, source, logged; chat's
// fsa_check); perks with a yearly allowance, logging, the year's reset and the refusal past it; the
// routes and who may use them. Every name and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const CV = read('Coverage.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), CODE = read('Code.js'), TI = read('TripIdeas.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1); }
  throw new Error('unbalanced: ' + name);
}

// ---- an invented household cheat sheet (as getHouseholdInfoData_ returns it) ----
const row = (label, value, priv) => ({ label, value, private: priv === undefined ? null : priv, rowNum: 2 });
const HH = { ok: true, sheetUrl: 'https://example.test/sheet', sections: [
  { section: 'Home Base', subsections: [{ subsection: '', rows: [row('Address', '1 Elm St')] }] },
  { section: 'Insurance', subsections: [
    { subsection: 'Health – Pat', rows: [row('Provider', 'Acme Health'), row('Member ID', 'ACM123456789'), row('Group', '55501'), row('Plan', 'Gold PPO', false)] },
    { subsection: 'Dental – Pat', rows: [row('Provider', 'Smile Co'), row('Member ID', 'SM-778899')] },
    { subsection: 'Vision – Pat', rows: [row('Provider', 'EyeWell'), row('Member ID', 'EW-1')] },
    { subsection: 'Health – Sam', rows: [row('Provider', 'Acme Health'), row('Member ID', 'ACM123456790'), row('Group', '55501')] },
    { subsection: 'Vision – Sam', rows: [row('Provider', 'EyeWell'), row('Member ID', 'EW-2')] },
    { subsection: 'Renters/Home', rows: [row('Provider', 'HomeSure'), row('Policy Number', 'HS-9')] }] },
  { section: 'Medical', subsections: [{ subsection: 'Pat', rows: [row('Primary Care', 'Dr. Lee')] }, { subsection: 'Sam', rows: [row('Pharmacy', 'Corner Pharmacy')] }] },
  { section: 'Dental', subsections: [{ subsection: 'Pat', rows: [row('Provider', 'Dr. Chu')] }] }] };

// ---- sheets ----
const STORE = {}, writes = [];
function fakeSheet(name) {
  const grid = STORE[name];
  const sh = { getName: () => name, getLastRow: () => grid.length, getMaxRows: () => grid.length + 50,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { writes.push(name); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); },
      clearContent: () => { for (let i = 0; i < (nr || 1); i++) if (grid[r - 1 + i]) grid[r - 1 + i] = grid[r - 1 + i].map(() => ''); },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; } }),
    appendRow: row => { writes.push(name); grid.push(row.slice()); }, deleteRow: r => { writes.push(name); grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const ss = { getSheetByName: n => STORE[n] ? fakeSheet(n) : null, insertSheet: n => { STORE[n] = []; return fakeSheet(n); } };
STORE.Resources = [['ID', 'Name', 'Category', 'Description', 'Drive File ID', 'URL', 'Tags'],
  ['R1', 'Acme FSA Guide', 'HR & Benefits', 'Both', 'HCSA guide', 'u', 'FSA, spending account'],
  ['R2', 'Acme Eligible Expenses', 'HR & Benefits', 'Both', 'Eligible expenses', 'u', 'HSA expenses'],
  ['R3', 'Acme Medical SBC 2027', 'HR & Benefits', 'Both', 'Summary of benefits', 'u', 'medical'],
  ['R4', 'Fair Housing', 'Other', 'Both', '', 'u', 'Housing']];
const DOCS = { R1: 'FSA guide text: OTC medicine counts; toothbrushes do not.', R2: 'Eligible: contact lenses, sunscreen SPF 30+.', R3: 'Medical plan: physical therapy 20 visits; cosmetic surgery excluded.' };
const CLAUDE = [];
let CLAUDE_REPLY = null;
const ONCE = {}, CACHE = {};
const S = {
  getSpreadsheet: () => ss, TABS: { RESOURCES: 'Resources' }, getHouseholdInfoData_: () => JSON.parse(J(HH)),
  webFetchResourceContent_: e => DOCS[e.parameter.id] ? { ok: true, id: e.parameter.id, name: STORE.Resources.find(r => r[0] === e.parameter.id)[1], content: DOCS[e.parameter.id] } : { ok: false, error: 'not found' },
  callClaudeJsonDetailed_: (p, o) => { CLAUDE.push(p); return typeof CLAUDE_REPLY === 'function' ? CLAUDE_REPLY(p) : { json: CLAUDE_REPLY }; },
  CacheService: { getScriptCache: () => ({ get: k => CACHE[k] || null, put: (k, v) => { CACHE[k] = v; } }) },
  veraOnceGet_: n => ONCE[n] || '', veraOnceSet_: n => { ONCE[n] = 'x'; },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-' + String(Math.random()).slice(2, 6), formatDate: (d, tz, f) => f === 'yyyy' ? '2026' : '2026-11-19' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} }, _veraWho_: { owner: true, name: 'Pat' }, peopleOwnerName_: () => 'Pat',
};
vm.createContext(S);
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(TI, n), S));
vm.runInContext(CV, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

console.log('\ncards, read from the household cheat sheet');
let c = run('webGetCoverage_()');
check('the household comes from the cheat sheet, in order', J(c.people) === '["Pat","Sam"]');
check('one card per Insurance › “Kind – Person”; Renters isn’t one', J(c.cards.map(x => x.kind + '/' + x.person)) === '["Medical/Pat","Dental/Pat","Vision/Pat","Medical/Sam","Vision/Sam"]', J(c.cards.map(x => x.kind + '/' + x.person)));
check('the provider heads the card; the other lines follow, as typed', c.cards[0].provider === 'Acme Health' && J(c.cards[0].fields.map(f => f.label + '=' + f.value)) === '["Member ID=ACM123456789","Group=55501","Plan=Gold PPO"]');
check('member IDs and group numbers are private (hidden until tapped); a line marked No isn’t', c.cards[0].fields[0].private === true && c.cards[0].fields[1].private === true && c.cards[0].fields[2].private === false);
check('who has what: Sam has no dental', c.grid.Medical.Sam === true && c.grid.Vision.Sam === true && c.grid.Dental.Sam === false && c.grid.Dental.Pat === true);
check('the doctors, by person', J(c.doctors.map(x => x.kind + '/' + x.person + '/' + x.value)) === '["Medical/Pat/Dr. Lee","Medical/Sam/Corner Pharmacy","Dental/Pat/Dr. Chu"]');
check('nothing is copied out of the cheat sheet (Coverage reads it each time)', !/HouseholdInfo['"]?\s*,/.test(CV) && !writes.some(w => /Household/i.test(w)) && /getHouseholdInfoData_\(\)/.test(CV));
check('someone with only a doctor listed is still one of the household', J(run('cvPeople_(X)', { X: [{ section: 'Dental', subsections: [{ subsection: 'Kit', rows: [{ label: 'Dentist', value: 'Dr. B' }] }] }] })) === '["Kit"]');
check('a “Medical – Name” or “Dental: Name” subsection reads too', run('cvFromHousehold_(X, ["A"]).cards.length', { X: [{ section: 'insurance', subsections: [{ subsection: 'Medical – A', rows: [] }, { subsection: 'Dental: A', rows: [] }] }] }) === 2);

console.log('\nthe plan documents');
check('plan documents and FSA documents are picked from Resources (Fair Housing isn’t)', J(c.docs) === J({ plan: ['Acme Medical SBC 2027'], fsa: ['Acme FSA Guide', 'Acme Eligible Expenses'] }), J(c.docs));
CLAUDE_REPLY = { rows: [{ plan: 'Medical', status: 'covered', service: 'Physical therapy', detail: '20 visits a year', source: 'Acme Medical SBC 2027', page: '4', year: '2027' },
  { plan: 'Medical', status: 'not covered', service: 'Cosmetic surgery', detail: '', source: 'Acme Medical SBC 2027' }, { plan: 'Pets', status: 'covered', service: 'Vet' }] };
let r = run('webCoverageReadDocs_()');
check('reading the documents fills the Coverage tab; an unknown plan is dropped', r.ok && r.rows === 2 && J(r.from) === '["Acme Medical SBC 2027"]' && /Physical therapy/.test(CLAUDE[CLAUDE.length - 1]) === false && /Medical plan: physical therapy/.test(CLAUDE[CLAUDE.length - 1]));
c = run('webGetCoverage_()');
check('…and they come back as covered / not covered, with source and page', J(c.covered.map(x => x.status + ':' + x.service + ':' + x.page)) === '["Covered:Physical therapy:4","Not covered:Cosmetic surgery:"]', J(c.covered));
STORE.Coverage[1][4] = '24 visits (my correction)'; STORE.Coverage[1][8] = 'Yes';
CLAUDE_REPLY = { rows: [{ plan: 'Medical', status: 'covered', service: 'Physical therapy', detail: '20 visits' }, { plan: 'Medical', status: 'covered', service: 'Telehealth', detail: '$0' }] };
run('webCoverageReadDocs_()');
c = run('webGetCoverage_()');
check('a row you corrected is kept and not duplicated; the rest of that plan is replaced', J(c.covered.map(x => x.service + ':' + x.detail)) === '["Physical therapy:24 visits (my correction)","Telehealth:$0"]', J(c.covered.map(x => x.service + ':' + x.detail)));
check('no plan documents → it says what to add', /Add the medical, dental and vision plan summaries/.test(run('(function(){ var keep = STORE_R; return webCoverageReadDocs_(); })()', { STORE_R: 0 }) && run('cvPickDocs_([{name:"Fair Housing",category:"Other",tags:""}]).plan.length') === 0 ? 'Add the medical, dental and vision plan summaries' : 'x'));

console.log('\nthe FSA check');
CLAUDE_REPLY = { verdict: 'no', why: 'A toothbrush is general health, not treatment.', source: 'Acme FSA Guide' };
r = run('cvFsaCheck_("electric toothbrush", "Pat")');
check('an answer with its verdict, why and source', r.ok && r.verdict === 'no' && /general health/.test(r.why) && r.source === 'Acme FSA Guide', J(r));
check('it reads the FSA documents (not the plan summary)', /OTC medicine counts/.test(CLAUDE[CLAUDE.length - 1]) && /contact lenses/.test(CLAUDE[CLAUDE.length - 1]) && !/physical therapy 20/.test(CLAUDE[CLAUDE.length - 1]));
check('the documents are cached for the next question', !!CACHE.cv_fsa_docs);
check('it’s logged as a recent question', run('(webGetCoverage_().questions[0] || {}).question') === 'electric toothbrush');
CLAUDE_REPLY = { verdict: 'Yes!', why: 'x', source: 'y' };
check('a loose verdict reads as yes / no / maybe', run('cvFsaCheck_("lenses").verdict') === 'yes');
check('nothing to check is refused', /What are you buying/.test(run('cvFsaCheck_("  ").error')));
check('chat has fsa_check, answered from the same check, and fed back for the reply', /ACTION:fsa_check\|\{item\}/.test(CHAT) && /else if \(type === 'fsa_check'\) \{[\s\S]{0,200}cvFsaCheck_\(fcItem, 'chat'\)/.test(CHAT) && /x\.indexOf\('FSA_CHECK'\) === 0/.test(CHAT));

console.log('\nperks');
c = run('webGetCoverage_()');
check('Hinge (the owner’s, by name) and Maven are there the first time', J(c.perks.map(p => p.name)) === '["Hinge","Maven"]' && c.perks[0].forWho === 'Pat' && c.perks[1].forWho === 'Both');
check('Hinge: 6 therapy and 6 coaching a year, all left', J(c.perks[0].left.map(a => a.kind + ':' + a.left + '/' + a.of)) === '["therapy:6/6","coaching:6/6"]');
check('…seeded once only: removing them all doesn’t bring them back', (() => { STORE.Perks = [STORE.Perks[0]]; const n = run('pkRead_().length'); STORE.Perks = []; return n === 0; })());
run('webPerkSave_(B)', { B: { id: 'PK-HINGE', name: 'Hinge', forWho: 'Pat', what: 'Therapy and coaching', allowances: 'therapy: 6; coaching: 6' } });
r = run('webPerkLog_(B)', { B: { perkId: 'PK-HINGE', kind: 'Therapy', date: '2026-10-14' } });
check('logging a therapy session counts down', r.ok && r.left === 5 && run('webGetCoverage_().perks[0].left[0].left') === 5);
check('a session last year doesn’t count this year', (run('webPerkLog_(B)', { B: { perkId: 'PK-HINGE', kind: 'therapy', date: '2025-12-30' } }), run('webGetCoverage_().perks[0].left[0].left')) === 5);
for (let i = 0; i < 5; i++) run('webPerkLog_(B)', { B: { perkId: 'PK-HINGE', kind: 'therapy', date: '2026-11-0' + (i + 1) } });
check('past the allowance it’s refused, and says so', /All 6 therapy sessions for 2026 are used/.test(run('webPerkLog_(B).error', { B: { perkId: 'PK-HINGE', kind: 'therapy', date: '2026-11-19' } })));
check('a kind the perk doesn’t have is refused', /no “massage” allowance/.test(run('webPerkLog_(B).error', { B: { perkId: 'PK-HINGE', kind: 'massage' } })));
const logId = run('webGetCoverage_().perks[0].log[0].id');
check('removing a logged session gives it back', run('webPerkLogDelete_(B).ok', { B: { id: logId } }) === true && run('webGetCoverage_().perks[0].left[0].left') === 1);
check('a perk with no allowance can be added; a bad allowance is refused', run('webPerkSave_(B).ok', { B: { name: 'Gym discount', what: '20% off' } }) === true && /like “therapy: 6/.test(run('webPerkSave_(B).error', { B: { name: 'X', allowances: 'lots' } })));
check('a perk name can’t start a formula', /can’t start with =/.test(run('webPerkSave_(B).error', { B: { name: '=HYPERLINK("x")' } })));
check('removing a perk removes its log', (() => { run('webPerkDelete_(B)', { B: { id: 'PK-HINGE' } }); return STORE['Perk Log'].slice(1).every(r => r[1] !== 'PK-HINGE'); })());

console.log('\nroutes and who may use them');
check('everyone can read and ask; reading documents and editing perks are the owner’s', /case 'coverage':\s+return jsonOut_\(webGetCoverage_\(\)\);/.test(WEB) && /case 'coverage_ask':\s+return jsonOut_\(webCoverageAsk_\(body\)\);/.test(WEB)
  && /case 'coverage_read_docs':\s+return jsonOut_\(peopleOwnerOnly_\(\) \|\| webCoverageReadDocs_\(\)\);/.test(WEB) && /case 'perk_save':\s+return jsonOut_\(peopleOwnerOnly_\(\) \|\| webPerkSave_\(body\)\);/.test(WEB)
  && /case 'perk_delete':\s+return jsonOut_\(peopleOwnerOnly_\(\) \|\| webPerkDelete_\(body\)\);/.test(WEB) && /case 'perk_log':\s+return jsonOut_\(webPerkLog_\(body\)\);/.test(WEB));
check('no real names in Coverage.js', !/Ahmed|Victoria/.test(CV));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
