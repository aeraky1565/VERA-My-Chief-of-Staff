// Career › Credentials (CareerCredentials.js, issue #223) on invented credentials: the agent's
// line parsed, the line VERA writes (degrees, active, expired; years; never an ID), status and
// reminder dates (90/30/7 from Config, keyed by expiry), credits pace, the one-time import guard,
// and the agent write touching only "Credentials held". Every name and value is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CC = read('CareerCredentials.js'), CAR = read('Career.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), CHAT = read('Chat.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const writes = [];
function fakeSheet(name, grid, owner) {
  const sh = { getName: () => name, getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }), getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { writes.push(owner + ':' + name + ':' + r); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { writes.push(owner + ':' + name + ':' + r); while (grid[r - 1].length < c) grid[r - 1].push(''); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { writes.push(owner + ':' + name + ':append'); grid.push(row.slice()); }, deleteRow: r => { grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const SETTINGS = [['Setting', 'Your value'], ['Target level', 'Senior Lead'], ['Candidate background', 'Ten years in examples.'],
  ['Credential deal-breakers', 'license X required'], ['Credentials held', 'MBA; Example PM Pro; Quality Belt; Cloud Architect Cert (2024); Agile Lead Cert (2023)']];
const SETTINGS_BEFORE = J(SETTINGS);
const VERA = {}, PROPS = {}, CONFIG = { career_alert_sheet_id: 'agent-test' };
let TODAY = '2026-11-02';
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; } }) },
  SpreadsheetApp: { openById: id => { if (id !== 'agent-test') throw new Error('no such sheet'); return { getSheetByName: n => n === 'Settings' ? fakeSheet('Settings', SETTINGS, 'agent') : null }; } },
  Utilities: { getUuid: () => String(++S.__u).padStart(8, '0') + '-3456-7890-0000', formatDate: () => TODAY },
  Session: { getScriptTimeZone: () => 'UTC' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  getSpreadsheet: () => ({ getSheetByName: n => VERA[n] ? fakeSheet(n, VERA[n], 'vera') : null, insertSheet: n => { VERA[n] = []; return fakeSheet(n, VERA[n], 'vera'); } }),
  getConfigValues: () => CONFIG, TABS: { CAREER_STATE: 'Career State' }, __u: 0,
};
vm.createContext(S);
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
vm.runInContext(CAR.match(/var CAR_STATE_HEADERS_\s*=[^;]*;/)[0] + CAR.match(/var CAR_AGENT_OWNED_LABELS_ = \[[\s\S]*?\];/)[0], S);
['carSheet_', 'carReadRows_', 'carStateGet_', 'carStateSet_', 'carLabel_', 'carAgentSheetId_', 'carOpenAgentTab_', 'carWriteAgentSettings_'].forEach(n => vm.runInContext(extractFn(CAR, n), S));
vm.runInContext(CC, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };
const C = (o) => Object.assign({ id: 'X', kind: 'cert', name: 'Cert', issuer: '', field: '', earned: '', expires: '', renewal: 'none', creditsNeeded: null, creditsEarned: 0, fee: null, credentialId: '', verifyUrl: '', tracks: [], sendToAgent: true }, o);

console.log('\nreading the agent’s line');
const items = run('carCredParseAgent_("MBA; Example PM Pro; Cloud Architect Cert (2024); Old Scrum Cert (expired 2025);  ; Bachelor of Science")');
check('semicolons, a year, an expired year, degrees by name, blanks dropped', J(items.map(x => x.kind + ':' + x.name + ':' + x.earned + ':' + x.expires)) ===
  J(['degree:MBA::', 'cert:Example PM Pro::', 'cert:Cloud Architect Cert:2024:', 'cert:Old Scrum Cert::2025-12-31', 'degree:Bachelor of Science::']), J(items));

console.log('\nthe line VERA writes');
const ROWS = [C({ name: 'Cloud Architect Cert', earned: '2024-05-01', expires: '2026-12-01', credentialId: 'SECRET-123', verifyUrl: 'https://verify.example/abc' }),
  C({ kind: 'degree', name: 'Bachelor of Engineering', earned: '2010' }), C({ name: 'Old Scrum Cert', earned: '2021', expires: '2025-06-30' }),
  C({ name: 'Quality Belt' }), C({ kind: 'degree', name: 'MBA', earned: '2016', field: 'Finance' }), C({ name: 'Hidden Cert', sendToAgent: false })];
S.R = ROWS;
let line = run('carCredentialsLine_(R, "2026-11-02")');
check('degrees, then active certifications, then expired ones', line === 'Bachelor of Engineering (2010); MBA in Finance (2016); Cloud Architect Cert (2024); Quality Belt; Old Scrum Cert (expired 2025)', line);
check('never a credential ID or link; a cert not sent stays out', !/SECRET|verify\.example|Hidden/.test(line));
check('a certification lapsing moves it to the expired end', run('carCredentialsLine_(R, "2026-12-02")').endsWith('Quality Belt; Cloud Architect Cert (expired 2026); Old Scrum Cert (expired 2025)'));

console.log('\nstatus, pace and reminders');
check('status: active, renew soon, expired, no expiry, degree', J(['2027-06-01', '2026-12-01', '2026-10-01', ''].map(e => run('carCredStatus_(X, "2026-11-02").status', { X: C({ expires: e }) })).concat([run('carCredStatus_(X, "2026-11-02").status', { X: C({ kind: 'degree' }) })]))
  === J(['active', 'soon', 'expired', 'none', 'degree']));
check('…labelled for the badge', run('carCredStatus_(X, "2026-11-02").label', { X: C({ expires: '2026-12-01' }) }) === 'Renew by 2026-12-01' && run('carCredStatus_(X, "2026-11-02").label', { X: C({ expires: '2025-03-01' }) }) === 'Expired 2025');
let p = run('carCredPace_(X, "2026-11-02")', { X: C({ name: 'Example PM Pro', issuer: 'PMI', renewal: 'credits', creditsNeeded: 60, creditsEarned: 22, expires: '2027-07-02' }) });
check('credits pace: earned of needed, months left, a month', p.text === '22 of 60 PDUs · 8 months left · about 4.8 a month' && p.pct === 37, J(p));
check('…other issuers count “credits”, and done is done', run('carCredPace_(X, "2026-11-02").text', { X: C({ renewal: 'credits', creditsNeeded: 30, creditsEarned: 30, expires: '2027-11-02' }) }) === '30 of 30 credits · 12 months left · done');
check('lead times from Config, largest first; a bad value falls back', J(run('carCredLeads_("7, 30,90")')) === J([90, 30, 7]) && J(run('carCredLeads_("")')) === J([90, 30, 7]) && J(run('carCredLeads_("x")')) === J([90, 30, 7]));
const due = d => run('carCredRemindersDue_(X, T, [90,30,7], 4)', { X: [C({ name: 'Cloud Architect Cert', expires: '2026-12-31', renewal: 'fee', fee: 99 })], T: d });
check('nothing before 90 days', due('2026-09-01').length === 0);
check('one at 90 days, keyed by the expiry date', due('2026-10-02').length === 1 && due('2026-10-02')[0].key === 'career_cert_cloud_architect_cert_2026-12-31_90' && due('2026-10-02')[0].urgency === 'Low');
check('then 30, then 7 (High)', due('2026-12-01')[0].key.endsWith('_30') && due('2026-12-25')[0].key.endsWith('_7') && due('2026-12-25')[0].urgency === 'High');
check('none once expired', due('2027-01-02').length === 0);
check('a renewal (a new expiry) is a new key', run('carCredRemindersDue_(X, "2027-10-05", [90,30,7], 4)[0].key', { X: [C({ name: 'Cloud Architect Cert', expires: '2027-12-31' })] }) === 'career_cert_cloud_architect_cert_2027-12-31_90');
const behind = run('carCredRemindersDue_(X, "2026-11-02", [90,30,7], 4)', { X: [C({ name: 'Example PM Pro', issuer: 'PMI', renewal: 'credits', creditsNeeded: 60, creditsEarned: 10, expires: '2027-07-02' })] });
check('a credits cert behind pace gets a pace reminder', behind.length === 1 && behind[0].key === 'career_cert_pace_example_pm_pro_2027-07-02' && /50 PDUs still to earn/.test(behind[0].flag), J(behind));
check('…on pace, none', run('carCredRemindersDue_(X, "2026-11-02", [90,30,7], 4).length', { X: [C({ renewal: 'credits', creditsNeeded: 60, creditsEarned: 40, expires: '2027-07-02' })] }) === 0);

console.log('\nthe one-time import and the agent');
let r = run('webCareerCredentials_()');
const names = r.credentials.map(c => c.kind + ':' + c.name);
check('imported once: the agent’s line plus the bachelor’s degree', J(names) === J(['degree:Bachelor of Engineering', 'degree:MBA', 'cert:Example PM Pro', 'cert:Quality Belt', 'cert:Cloud Architect Cert', 'cert:Agile Lead Cert']) && !!PROPS.CAR_CRED_IMPORTED, J(names));
check('…with the years it gave', r.credentials.find(c => c.name === 'Cloud Architect Cert').earned === '2024');
check('…and never again (the guard)', run('carCredImportOnce_()').imported === false && run('webCareerCredentials_()').credentials.length === 6);
check('the totals', r.totals.degrees === 2 && r.totals.active === 4 && r.totals.soon === 0);
r = run('webCareerSaveCredential_({ credential: { name: "Example PM Pro Renewed", renewal: "credits", creditsNeeded: 60, creditsEarned: 5, expires: "2027-07-02", credentialId: "ID-999", tracks: ["Program & Project Management"] } })');
check('saving a certification sends the line to the agent', r.ok && r.sync && r.sync.written === true, J(r));
const held = SETTINGS.find(x => x[0] === 'Credentials held')[1];
check('…by label, “Credentials held” only; the agent’s own rows untouched', /Example PM Pro Renewed/.test(held) && !/ID-999/.test(held)
  && J(SETTINGS.filter(x => x[0] !== 'Credentials held')) === J(JSON.parse(SETTINGS_BEFORE).filter(x => x[0] !== 'Credentials held'))
  && writes.filter(w => /^agent:/.test(w)).every(w => w === 'agent:Settings:5'), J(writes.filter(w => /^agent:/.test(w))));
check('the writer refuses any label VERA doesn’t own', (() => { try { run('carWriteAgentSettings_(carOpenAgentTab_("agent-test","Settings"), [{ label: "Candidate background", value: "x" }])'); return false; } catch (e) { return /does not own/.test(e.message); } })());
const id = r.id;
const lg1 = run('webCareerLogCredits_({ id: ID, n: 12 })', { ID: id }), lg2 = run('webCareerLogCredits_({ name: "renewed", n: -2 })');
check('credits logged add up (a correction can subtract)', lg1.creditsEarned === 17 && lg2.creditsEarned === 15, J([lg1, lg2]));
check('…and not on a cert that doesn’t renew by credits', run('webCareerLogCredits_({ name: "Quality Belt", n: 3 })').ok === false);
r = run('carCredRenew_("Example PM Pro Renewed", "2030-07-02")');
check('renewing sets the new expiry and starts the credits over', r.ok && run('carCredRows_()').find(c => c.id === id).expires === '2030-07-02' && run('carCredRows_()').find(c => c.id === id).creditsEarned === 0, J(r));
check('a bad expiry, no name, or credits with no target are refused', run('webCareerSaveCredential_({ credential: { name: "x", expires: "soon" } })').ok === false
  && run('webCareerSaveCredential_({ credential: { name: "" } })').ok === false && run('webCareerSaveCredential_({ credential: { name: "y", renewal: "credits" } })').ok === false);
check('deleting sends the line again', run('webCareerDeleteCredential_({ id: ID })', { ID: id }).sync.written === true && !/Renewed/.test(SETTINGS.find(x => x[0] === 'Credentials held')[1]));
check('Chat context: names and state, never an ID', run('carCredContextLines_()').every(l => !/CRED-|ID-/.test(l)) && run('carCredContextLines_()').some(l => /Bachelor of Engineering \(degree\)/.test(l)));

console.log('\nwiring');
check('“Credentials held” is an owned label', /'Credentials held'\];/.test(CAR));
check('the nightly run runs it, before the step that reads tonight’s flags', CODE.indexOf("nightlyStep_(ctx, 'carCredNightly_', carCredNightly_)") !== -1 && CODE.indexOf("nightlyStep_(ctx, 'carCredNightly_', carCredNightly_)") < CODE.indexOf("nightlyStep_(ctx, 'checkCrossPatternFlags_'"));
check('the routes', /case 'career_credentials':\s+return jsonOut_\(webCareerCredentials_\(\)\)/.test(WEB) && /case 'career_credential_save':\s+return jsonOut_\(webCareerSaveCredential_\(body\)\)/.test(WEB)
  && /case 'career_credential_delete':\s+return jsonOut_\(webCareerDeleteCredential_\(body\)\)/.test(WEB) && /case 'career_credential_log_credits': return jsonOut_\(webCareerLogCredits_\(body\)\)/.test(WEB));
check('the notification', /key: 'career_cert_expiry',/.test(CODE));
check('Chat: renew_credential and log_credits', /ACTION:renew_credential\|\{name\}\|\{new expiry YYYY-MM-DD\}/.test(CHAT) && /type === 'renew_credential'/.test(CHAT) && /type === 'log_credits'/.test(CHAT) && /carCredContextLines_\(\)/.test(CHAT));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
