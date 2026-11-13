// #218 People & access. Pins:
//  - sign-in: the owner's shared token still works; a person's code works by its
//    fingerprint (typed in any case, with spaces), the code itself is never stored;
//    "Sign out everywhere" stops every code of theirs; a new code leaves the old ones;
//  - the Access tab: rows for every tab of both dashboards, a column per person
//    (new ones all ticked), an Opens on row, ticks never overwritten by a sync;
//  - whoami: the person, their view, first tab and hidden tabs; the owner can't hide
//    System or People & access from itself; People & access is the owner's;
//  - the owner-only endpoints, and Slack's own posts checked by its verification token;
//  - the dashboards: both hide unticked tabs through the shared menu, land on the
//    person's first tab, and a lite-view person is sent to the lite dashboard.
// Invented names and codes.
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const PEOPLE = read('People.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; const m = /\)\s*\{/g; m.lastIndex = a; let d = 0, j = src.indexOf('{', m.exec(src).index); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };

function ctx(opts) {
  const o = opts || {};
  const props = Object.assign({}, o.props || {});
  let uuid = 0, sheet = o.sheet || null;
  const c = {
    String, Array, Object, JSON, Math, Number, isNaN, parseInt, Date, RegExp,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => 'uuid-' + (++uuid),
    },
    getConfigValues: () => o.config || {},
    getWebToken_: () => props.VERA_WEB_TOKEN || '',
    veraLocked_: fn => fn(),
    getSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => { sheet = mkSheet([]); c.__sheet = () => sheet; return sheet; } }),
  };
  c.__props = props; c.__sheet = () => sheet;
  vm.createContext(c);
  vm.runInContext(PEOPLE, c);
  return c;
}
function mkSheet(v) {
  const s = { v: v.map(r => r.slice()), boxes: null,
    getLastRow: () => s.v.length, getLastColumn: () => (s.v[0] || []).length,
    getRange: (r, col, nr, nc) => ({
      getValues: () => s.v.slice(r - 1, r - 1 + nr).map(x => x.slice(col - 1, col - 1 + nc)),
      setValues: vals => { vals.forEach((row, i) => { s.v[r - 1 + i] = s.v[r - 1 + i] || []; row.forEach((x, j) => { s.v[r - 1 + i][col - 1 + j] = x; }); }); },
      insertCheckboxes: () => { s.boxes = [r, col, nr, nc]; }, setFontWeight: () => {},
    }),
    setFrozenRows: () => {}, setFrozenColumns: () => {} };
  return s;
}
const run = (c, code) => vm.runInContext(code, c);
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

console.log('\nSign-in: who is this?');
{
  const c = ctx({ props: { VERA_WEB_TOKEN: 'owner-shared-token' }, config: { owner_name: 'Sam' } });
  check('the shared token is the owner, named from Config owner_name', J(c.veraIdentify_('owner-shared-token')) === J({ name: 'Sam', owner: true, view: 'full' }));
  c.__props.VERA_USER_TOKENS = J({ people: [{ name: 'Sam', owner: true, view: 'full', hashes: [] }, { name: 'Robin', owner: false, view: 'lite', hashes: [sha('ABCD-EFGH-JKMN-PQRS')] }] });
  check('a person’s code: by its fingerprint', J(c.veraIdentify_('ABCD-EFGH-JKMN-PQRS')) === J({ name: 'Robin', owner: false, view: 'lite' }) && J(run(c, '_veraWho_')) === J({ name: 'Robin', owner: false, view: 'lite' }));
  check('…typed in lower case or with spaces', c.veraIdentify_(' abcd-efgh-jkmn-pqrs ') !== null && c.veraIdentify_('ABCD-EFGH -JKMN-PQRS') !== null);
  check('a wrong code, or none: nobody', c.veraIdentify_('ABCD-EFGH-JKMN-PQRT') === null && c.veraIdentify_('') === null && run(c, '_veraWho_') === null);
  check('no shared token set: only codes work', ctx({}).veraIdentify_('') === null && run(ctx({}), 'peopleWho_("x", "", [], function(){ return "h"; })') === null);
  check('isAuthorized_ asks who it is, and keeps the old shared token working', /return !!veraIdentify_\(token\);/.test(fnSrc(WEB, 'isAuthorized_')) && !/=== token;/.test(fnSrc(WEB, 'isAuthorized_')));
}

console.log('\nCodes');
{
  const c = ctx();
  const code = run(c, 'peopleCodeFrom_([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,250])');
  check('four groups of four from letters and digits that can’t be confused', /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/.test(code) && !/[01OIL]/.test(code), code);
  const a = c.peopleNewCode_(), b = c.peopleNewCode_();
  check('a new code each time', a !== b && /^[A-Z2-9-]{19}$/.test(a));
  check('names: required, short, letters, not taken', c.peopleNameProblem_('', []) !== '' && c.peopleNameProblem_('X'.repeat(31), []) !== '' && c.peopleNameProblem_('R0bin', []) !== '' && c.peopleNameProblem_('robin', [{ name: 'Robin' }]) === 'robin is already listed' && c.peopleNameProblem_('Robin O\'Neil-Lee', []) === '');
}

console.log('\nThe owner’s endpoints');
{
  const c = ctx({ props: { VERA_WEB_TOKEN: 'owner-shared-token' }, config: { owner_name: 'Sam' } });
  c.veraIdentify_('owner-shared-token');
  const add = run(c, 'webPeopleAdd_({ name: "Robin", view: "lite" })');
  const rec = () => JSON.parse(c.__props.VERA_USER_TOKENS);
  check('add: a first code, shown once, stored only as its fingerprint', add.ok && /^[A-Z2-9-]{19}$/.test(add.code) && J(rec().people.map(p => p.name)) === J(['Sam', 'Robin'])
        && !c.__props.VERA_USER_TOKENS.includes(add.code) && rec().people[1].hashes[0] === sha(add.code), J(add));
  check('…and that code signs Robin in', J(c.veraIdentify_(add.code)) === J({ name: 'Robin', owner: false, view: 'lite' }));
  c.veraIdentify_('owner-shared-token');
  check('…with an Access column ticked everywhere', c.__sheet() && J(c.__sheet().v[0]) === J(['Area', 'Tab', 'Id', 'Sam', 'Robin']));
  check('a taken name is refused', run(c, 'webPeopleAdd_({ name: "robin" })').ok === false);
  const second = run(c, 'webPeopleNewCode_({ name: "Robin" })');
  check('a new code: both work', second.ok && c.veraIdentify_(second.code) && c.veraIdentify_(add.code) && (c.veraIdentify_('owner-shared-token'), true));
  check('the view switch', run(c, 'webPeopleSetView_({ name: "Robin", view: "full" })').ok && rec().people[1].view === 'full' && run(c, 'webPeopleSetView_({ name: "Robin", view: "tv" })').ok === false);
  const out = run(c, 'webPeopleSignOut_({ name: "Robin" })');
  check('sign out everywhere: every code stops', out.ok && out.signedOut === 2 && c.veraIdentify_(add.code) === null && c.veraIdentify_(second.code) === null);
  c.veraIdentify_('owner-shared-token');
  const list = run(c, 'webPeopleList_()');
  check('the list: name, owner, view, codes, last seen, tab count', list.ok && J(list.people.map(p => [p.name, p.owner, p.view, p.codes])) === J([['Sam', true, 'full', 0], ['Robin', false, 'full', 0]]));
  const third = run(c, 'webPeopleNewCode_({ name: "Robin" })');
  c.veraIdentify_(third.code);
  check('Robin isn’t the owner: none of it is allowed', ['webPeopleList_()', 'webPeopleAdd_({ name: "Kit" })', 'webPeopleNewCode_({ name: "Sam" })', 'webPeopleSignOut_({ name: "Sam" })', 'webPeopleSetView_({ name: "Sam", view: "lite" })', 'webAccessSync_({ catalog: [] })']
        .every(x => { const r = run(c, x); return r.ok === false && /owner/.test(r.error); }));
  check('the routes', /case 'whoami':\s+return jsonOut_\(webWhoami_\(\)\);/.test(WEB) && /case 'people_list':\s+return jsonOut_\(webPeopleList_\(\)\);/.test(WEB)
        && ['people_add', 'people_code', 'people_signout', 'people_view', 'access_sync'].every(a => new RegExp("case '" + a + "':\\s+return jsonOut_\\(web\\w+_\\(body\\)\\);").test(WEB)));
}

console.log('\nThe Access tab');
{
  const c = ctx();
  c.cat = [{ id: 'full:home', area: 'Home', tab: '(main tab)' }, { id: 'full:travel/aria', area: 'Travel', tab: 'Plan › aria' }];
  const p1 = run(c, 'accessSyncPlan_([], cat, ["Sam", "Robin"])');
  check('a new tab: headers, the Opens on row, a row per tab, all ticked', J(p1.values) === J([['Area', 'Tab', 'Id', 'Sam', 'Robin'], ['Opens on', '(their first tab)', 'opens_on', '', ''], ['Home', '(main tab)', 'full:home', true, true], ['Travel', 'Plan › aria', 'full:travel/aria', true, true]]) && p1.addedRows === 2, J(p1.values));
  c.v = p1.values; c.v[3][4] = false; c.v[1][4] = 'overview';
  c.cat2 = c.cat.concat([{ id: 'lite:overview', area: 'Today', tab: '(main tab)' }]);
  const p2 = run(c, 'accessSyncPlan_(v, cat2, ["Sam", "Robin", "Kit"])');
  check('a sync keeps every tick, adds the new tab ticked and the new person ticked', p2.values[3][4] === false && p2.values[1][4] === 'overview' && J(p2.values[4]) === J(['Today', '(main tab)', 'lite:overview', true, true, true]) && p2.values[3][5] === true && J(p2.addedCols) === J(['Kit']) && p2.addedRows === 1, J(p2.values));
  check('…and adds nothing when nothing is new', run(c, 'accessSyncPlan_(v, cat, ["Sam", "Robin"])').addedRows === 0);
  const a = run(c, 'accessFor_(v, "robin", false)');
  check('what Robin sees: the unticked tab hidden, and the first tab', J(a.hidden) === J(['full:travel/aria']) && a.opensOn === 'overview', J(a));
  c.v2 = [['Area', 'Tab', 'Id', 'Sam'], ['Opens on', '', 'opens_on', ''], ['System', '(main tab)', 'full:system', false], ['System', 'Settings › people', 'full:system/people', 'FALSE'], ['Flags', '(main tab)', 'full:flags', 'FALSE']];
  check('the owner can’t hide System or People & access from itself (FALSE as text counts)', J(run(c, 'accessFor_(v2, "Sam", true)').hidden) === J(['full:flags']));
  check('no column for them: nothing hidden', run(c, 'accessFor_(v, "Nobody", false)').hidden.length === 0);
  check('the count for the panel', J(run(c, 'accessCounts_(v, "Robin")')) === J({ visible: 1, total: 2 }));
  // whoami, end to end
  const sh = mkSheet([['Area', 'Tab', 'Id', 'Sam', 'Robin'], ['Opens on', '', 'opens_on', 'home', 'overview'], ['Home', '(main tab)', 'full:home', true, true], ['Flags', '(main tab)', 'full:flags', true, false]]);
  const w = ctx({ props: { VERA_WEB_TOKEN: 'tok', VERA_USER_TOKENS: J({ people: [{ name: 'Sam', owner: true, view: 'full', hashes: [] }, { name: 'Robin', view: 'lite', hashes: [sha('ROBN-ROBN-ROBN-ROBN')] }] }) }, sheet: sh });
  w.veraIdentify_('robn robn robn robn'.replace(/ /g, '-'));
  const me = run(w, 'webWhoami_()');
  check('whoami: who, the view, the first tab, and the hidden tabs (People & access is the owner’s)', me.ok && me.name === 'Robin' && me.view === 'lite' && me.owner === false && me.opensOn === 'overview' && J(me.hidden) === J(['full:flags', 'full:system/people']), J(me));
  check('…and records when they were last seen', !!JSON.parse(w.__props.VERA_USER_TOKENS).people[1].lastSeen);
  w.veraIdentify_('tok');
  const sync = run(w, 'webAccessSync_({ catalog: [{ id: "full:life/goals", area: "Life", tab: "Grow › goals" }, { id: "bad id!", area: "x" }] })');
  check('the owner’s sync adds the new row; a malformed id is dropped; the checkboxes go on the person cells only', sync.ok && sync.addedRows === 1 && sh.v.length === 5 && sh.v[4][2] === 'full:life/goals' && J(sh.boxes) === J([3, 4, 3, 2]), J(sh.v));
}

console.log('\nSlack’s posts');
{
  const c = ctx();
  check('the token is found in an event body, an interaction payload, a slash command or the raw body',
        c.slackPostToken_({}, { token: 'S1' }) === 'S1' && c.slackPostToken_({ parameter: { payload: J({ token: 'S2' }) } }, null) === 'S2'
        && c.slackPostToken_({ parameter: { token: 'S3', command: '/vera' } }, null) === 'S3'
        && c.slackPostToken_({ parameter: {}, postData: { contents: 'payload=' + encodeURIComponent(J({ token: 'S4' })) } }, null) === 'S4'
        && c.slackPostToken_({ parameter: {}, postData: { contents: 'command=%2Fvera&token=S5' } }, null) === 'S5');
  check('no SLACK_VERIFICATION_TOKEN yet: allowed, as before', c.slackPostOk_({}, { token: 'anything' }) === true);
  const s = ctx({ props: { SLACK_VERIFICATION_TOKEN: 'S1' } });
  check('set: Slack’s must match', s.slackPostOk_({}, { token: 'S1' }) === true && s.slackPostOk_({}, { token: 'nope' }) === false && s.slackPostOk_({ parameter: {} }, null) === false);
  const dp = fnSrc(WEB, 'doPost');
  check('doPost checks Slack’s form posts and events before handling them', /if \(!slackPostOk_\(e, null\)\) return errOut_\('Unauthorized', 401\);\s*return handleSlackFormPost_\(e\);/.test(dp)
        && /body\.type === 'url_verification'\)\) \{\s*if \(!slackPostOk_\(e, body\)\) return errOut_\('Unauthorized', 401\);/.test(dp));
  check('…and the dashboard’s posts still need a sign-in', /\/\/ VERA dashboard actions require auth\s*if \(!isAuthorized_\(e\)\) return errOut_\('Unauthorized', 401\);/.test(dp));
}

console.log('\nThe dashboards');
{
  const shared = s => { const a = s.indexOf('// ---- VeraTileNav'), b = s.indexOf('// ---- /VeraTileNav ----'); return s.slice(a, b); };
  check('the menu code that hides tabs is the same in both dashboards', shared(APP) === shared(LITE) && /function veraCan_\(id\)/.test(shared(APP)));
  check('…a hidden subtab leaves its menu, and an open one moves to the first allowed', /return by\[id\]&&veraCan_\(name\+'\/'\+id\);/.test(shared(APP)) && /if\(subHidden&&groups\[0\]&&!props\.none\)props\.onPick\(groups\[0\]\.tabs\[0\]\.id\);/.test(shared(APP)));
  check('…and the catalog the owner sends covers both dashboards', /veraAccessCatalog_\('full',VERA_MAIN_TABS\)\.concat\(veraAccessCatalog_\('lite',VERA_LITE_MAIN_TABS\)\)/.test(APP));
  check('full: the main tabs filtered, the first tab, and a lite-view person sent to lite', /VERA_MAIN_TABS\.map\(t=>t\.id\)\.filter\(tab=>veraCan_\(tab\)\)\.map\(tab=>/.test(APP)
        && /if\(d\.view==='lite'&&!d\.owner\)\{window\.location\.replace\('dashboard-lite\.html'\);return;\}/.test(APP) && /who\.opensOn&&ok\.indexOf\(who\.opensOn\)!==-1\)\{setActiveTab\(who\.opensOn\)/.test(APP));
  check('lite: the main tabs filtered and the first tab', /TOP_TABS\.filter\(tab => veraCan_\(tab\.id\)\)\.map\(tab =>/.test(LITE) && /VERA_ACCESS = \{ dash: 'lite', hidden: hid \};/.test(LITE) && /if \(who\.opensOn && ok\.indexOf\(who\.opensOn\) !== -1\) \{ setActiveTabRaw\(who\.opensOn\)/.test(LITE));
  check('the lists the catalog uses match the real tab bars', (() => {
    const lite = (LITE.match(/const TOP_TABS = \[([\s\S]*?)\];/) || [])[1] || '';
    const liteIds = (lite.match(/id: '([a-z_]+)'/g) || []).map(x => x.slice(5, -1));
    const cat = (APP.match(/var VERA_LITE_MAIN_TABS=\[(.*?)\];/) || [])[1] || '';
    return J(liteIds) === J((cat.match(/id:'([a-z_]+)'/g) || []).map(x => x.slice(4, -1)));
  })());
  check('System › Settings › People & access', /\{id:'people',label:'👥 People & access'\}/.test(APP) && /cur==='people'&&h\(SysPeople,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP) && /items:\['notifications','trip_emails','config','flags','people'\]/.test(APP));
  check('sign-in asks for a code, and no token prefix is shown any more', /"Your sign-in code"/.test(APP) && /Your sign-in code/.test(LITE) && !/vera-b479/.test(APP) && !/vera-b479/.test(LITE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
