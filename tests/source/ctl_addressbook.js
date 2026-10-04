// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The ones that matter most put back mistakes this codebase has already made once:
// filing an unconfigured feature as an outage (aviationstack), letting a blank fail
// to clear a field (Autopay), reading a hand-edited sheet by column position, and
// leaving orphan rows behind a delete.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_abk');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const DOCS  = ['app.js', 'index.html', 'dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
DOCS.forEach(f => { BASE['docs/' + f] = fs.readFileSync(path.join(SRC_DIR, 'docs', f), 'utf8'); });
BASE['README.md'] = fs.readFileSync(path.join(SRC_DIR, 'README.md'), 'utf8');

const eachDoc = (b, fn) => {
  const o = {};
  DOCS.forEach(f => { o['docs/' + f] = fn(b['docs/' + f]); });
  return o;
};

const CONTROLS = {
  // ---- configuration and health -------------------------------------------
  'an unconfigured book is recorded as an outage': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  if (!id) return { ok: true, configured: false, ss: null, error: '' };",
      "  if (!id) { recordApiHealth_(ADDRESS_BOOK_HEALTH_, false, 'not configured', 0);\n" +
      "             return { ok: true, configured: false, ss: null, error: '' }; }"),
  }),
  'a real open failure is NOT recorded': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "    recordApiHealth_(ADDRESS_BOOK_HEALTH_, false, err.message, 0);\n", ''),
  }),
  'an unconfigured book throws instead of answering': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  if (!id) return { ok: true, configured: false, ss: null, error: '' };",
      "  if (!id) throw new Error('ADDRESS_BOOK_SHEET_ID not set');"),
  }),
  'the health source name drifts': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("var ADDRESS_BOOK_HEALTH_     = 'sheet:AddressBook';",
                                                  "var ADDRESS_BOOK_HEALTH_     = 'addressbook';"),
  }),

  // ---- not disturbing Ahmed's sheet ---------------------------------------
  'the tabs are never created': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /function ensureAddressBookTabs_\(ss\) \{\n[\s\S]*?\n\}/,
      'function ensureAddressBookTabs_(ss) {}'),
  }),
  'only the households tab is created': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  ensureSheet(ss, ADDRESS_BOOK_PEOPLE_,     CONTACT_HEADERS);\n", ''),
  }),
  'the headers are rewritten on every call': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  ensureSheet(ss, ADDRESS_BOOK_HOUSEHOLDS_, HOUSEHOLD_HEADERS);',
      '  var _s = ss.getSheetByName(ADDRESS_BOOK_HOUSEHOLDS_);\n' +
      '  if (_s) _s.getRange(1, 1, 1, HOUSEHOLD_HEADERS.length).setValues([HOUSEHOLD_HEADERS]);\n' +
      '  ensureSheet(ss, ADDRESS_BOOK_HOUSEHOLDS_, HOUSEHOLD_HEADERS);'),
  }),

  // ---- header-driven reads and writes --------------------------------------
  'reads go back to fixed column positions': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "      var c = cols[h];\n      rec[h] = c ?",
      "      var c = headers.indexOf(h) + 1;\n      rec[h] = c ?"),
  }),
  'writes go back to fixed column positions': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "function writeAddressBookRow_(sheet, rowNum, fields) {\n  var cols = addressBookCols_(sheet);",
      "function writeAddressBookRow_(sheet, rowNum, fields) {\n" +
      "  var cols = {}; HOUSEHOLD_HEADERS.concat(CONTACT_HEADERS).forEach(function(h, i) { cols[h] = i + 1; });"),
  }),
  'a row with no ID is read as a real entry': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("    if (!rec['ID']) return;", "    // kept"),
  }),

  // ---- the makeUrl trap, which POST exists to avoid ------------------------
  'save only writes the fields that are truthy (the GET bug)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  var fields = \{\n    'Household':        name,\n([\s\S]*?)\n  \};/,
      "  var fields = { 'Household': name };\n" +
      "  if (b.address1)     fields['Address Line 1'] = String(b.address1).trim();\n" +
      "  if (b.address2)     fields['Address Line 2'] = String(b.address2).trim();\n" +
      "  if (b.city)         fields['City'] = String(b.city).trim();\n" +
      "  if (b.state)        fields['State'] = String(b.state).trim();\n" +
      "  if (b.postalCode)   fields['Postal Code'] = String(b.postalCode).trim();\n" +
      "  if (b.country)      fields['Country'] = String(b.country).trim();\n" +
      "  if (b.relationship) fields['Relationship'] = String(b.relationship).trim();\n" +
      "  if (b.sendCard)     fields['Send Card'] = addressBookYesNo_(b.sendCard);\n" +
      "  if (b.notes)        fields['Notes'] = String(b.notes).trim();"),
  }),

  // ---- insert vs update ----------------------------------------------------
  'save always inserts, never updates': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var id = String(b.id || '').trim();\n  if (id) {\n    var rowNum = findAddressBookRow_(sheet, id);\n    if (!rowNum) throw new Error('Household not found: ' + id);\n    writeAddressBookRow_(sheet, rowNum, fields);\n    return { ok: true, id: id, action: 'updated' };\n  }\n",
      "  var id = '';\n"),
  }),
  'an unknown id is silently inserted instead of refused': b => ({
    'WebApp.js': b['WebApp.js'].replace("    if (!rowNum) throw new Error('Household not found: ' + id);\n    writeAddressBookRow_",
                                        "    if (!rowNum) { appendAddressBookRow_(sheet, HOUSEHOLD_HEADERS, fields); return { ok: true, id: id, action: 'created' }; }\n    writeAddressBookRow_"),
  }),
  'a household with no name is accepted': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  if \(!name\) throw new Error\('A household name is required [^']*'\);\n/, ''),
  }),
  'a contact can belong to no household': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  if (!householdId) throw new Error('A contact must belong to a household');", ''),
  }),
  'a contact can point at a household that does not exist': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  if \(!findAddressBookRow_\(hhSheet, householdId\)\) \{\n    throw new Error\('Household not found: ' \+ householdId\);\n  \}\n/, ''),
  }),

  // ---- deletion ------------------------------------------------------------
  'deleting a contact deletes the whole household': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /function webDeleteContact_\(body\) \{\n([\s\S]*?)  var sheet  = ss\.getSheetByName\(ADDRESS_BOOK_PEOPLE_\);/,
      'function webDeleteContact_(body) {\n$1  var sheet  = ss.getSheetByName(ADDRESS_BOOK_HOUSEHOLDS_);'),
  }),

  // ---- the card run --------------------------------------------------------
  'confirming an address also rewrites the row': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  writeAddressBookRow_(sheet, rowNum, { 'Address Confirmed': when });",
      "  writeAddressBookRow_(sheet, rowNum, { 'Address Confirmed': when, 'City': '' });"),
  }),

  // ---- schema and wiring ---------------------------------------------------
  'a Birthday column creeps back into the schema': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "var CONTACT_HEADERS   = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Member Type', 'Notes'];",
      "var CONTACT_HEADERS   = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Birthday', 'Member Type', 'Notes'];"),
  }),
  'the writes are exposed as GET routes too': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      case 'address_book':               return jsonOut_(webGetAddressBook_());",
      "      case 'address_book':               return jsonOut_(webGetAddressBook_());\n" +
      "      case 'save_household':             return jsonOut_(webSaveHousehold_(e));"),
  }),
  'the read route is dropped': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      case 'address_book':               return jsonOut_(webGetAddressBook_());\n", ''),
  }),
  'a write route is dropped': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      case 'save_mailing':               return jsonOut_(webSaveMailing_(body));\n", ''),
  }),
  'ensureSheet is reimplemented instead of reused': b => ({
    'AddressBook.js': b['AddressBook.js']
      .replace('  ensureSheet(ss, ADDRESS_BOOK_HOUSEHOLDS_, HOUSEHOLD_HEADERS);',
               '  if (!ss.getSheetByName(ADDRESS_BOOK_HOUSEHOLDS_)) ss.insertSheet(ADDRESS_BOOK_HOUSEHOLDS_);')
      .replace('  ensureSheet(ss, ADDRESS_BOOK_PEOPLE_,     CONTACT_HEADERS);',
               '  if (!ss.getSheetByName(ADDRESS_BOOK_PEOPLE_)) ss.insertSheet(ADDRESS_BOOK_PEOPLE_);'),
  }),

  // ---- the cascade, now through one shared helper -------------------------
  'the cascade is removed entirely (orphans everywhere)': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("  var removedMembers = deleteAddressBookRowsFor_(pSheet, 'Household ID', id);",
               '  var removedMembers = 0;')
      .replace("  var removedMailings = deleteAddressBookRowsFor_(mSheet, 'Household ID', id);",
               '  var removedMailings = 0;'),
  }),
  'mailings are left behind when a household goes': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var removedMailings = deleteAddressBookRowsFor_(mSheet, 'Household ID', id);",
      '  var removedMailings = 0;'),
  }),
  'the shared delete runs front to back (rows shift under it)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  for (var i = vals.length - 1; i >= 0; i--) {',
      '  for (var i = 0; i < vals.length; i++) {'),
  }),
  'the shared delete ignores the column and removes everything': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "    if (String(vals[i][0] || '').trim() !== want) continue;\n", ''),
  }),
  // Anchored on the line ABOVE as well: "if (!want) return 0;" appears twice in the
  // file, and a bare string replace hits findAddressBookRow_'s copy instead — a
  // control that silently mutates a different function proves nothing.
  'a blank value deletes every row': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  var want = String(value || '').trim();\n  if (!want) return 0;\n",
      "  var want = String(value || '').trim();\n"),
  }),

  // ---- mailings ------------------------------------------------------------
  'the Mailings tab is never created': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  ensureSheet(ss, ADDRESS_BOOK_MAILINGS_,   MAILING_HEADERS);\n', ''),
  }),
  'the read drops mailings': b => ({
    'WebApp.js': b['WebApp.js'].replace('           mailings: mailings, events: events };',
                                        '           mailings: [], events: events };'),
  }),
  'the event vocabulary is dropped': b => ({
    'WebApp.js': b['WebApp.js'].replace('           mailings: mailings, events: events };',
                                        '           mailings: mailings, events: [] };'),
  }),
  'the event list is not deduplicated': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '    if (e && !seen[e.toLowerCase()]) seen[e.toLowerCase()] = e;',
      '    if (e) seen[e + Math.random()] = e;'),
  }),
  'the event list is ordered oldest first': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    return String(b.sent || '').localeCompare(String(a.sent || ''));",
      "    return String(a.sent || '').localeCompare(String(b.sent || ''));"),
  }),
  'logging the same mailing twice writes two rows': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  var dup = findMailing_\(sheet, householdId, event, sent\);\n  if \(dup\) return \{ ok: true, id: dup, action: 'unchanged', alreadyLogged: true \};\n/, ''),
  }),
  'the duplicate check is case-sensitive on the event': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (String(rows[i]['Event'] || '').trim().toLowerCase() !== want) continue;",
      "    if (String(rows[i]['Event'] || '').trim() !== event) continue;"),
  }),
  'the duplicate check ignores the date (history collapses to one row)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (String(rows[i]['Sent'] || '').trim() !== String(sent || '').trim()) continue;\n", ''),
  }),
  'a mailing can point at a household that does not exist': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  if \(!findAddressBookRow_\(hhSheet, householdId\)\) \{\n    throw new Error\('Household not found: ' \+ householdId\);\n  \}\n  var sheet = ss\.getSheetByName\(ADDRESS_BOOK_MAILINGS_\);/,
      '  var sheet = ss.getSheetByName(ADDRESS_BOOK_MAILINGS_);'),
  }),
  'save_mailing always inserts, never updates': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  var id = String\(b\.id \|\| ''\)\.trim\(\);\n  if \(id\) \{\n    var rowNum = findAddressBookRow_\(sheet, id\);\n    if \(!rowNum\) throw new Error\('Mailing not found: ' \+ id\);\n    writeAddressBookRow_\(sheet, rowNum, fields\);\n    return \{ ok: true, id: id, action: 'updated' \};\n  \}\n/,
      "  var id = '';\n"),
  }),
  'delete_mailing removes the household instead': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /function webDeleteMailing_\(body\) \{\n([\s\S]*?)  var sheet  = ss\.getSheetByName\(ADDRESS_BOOK_MAILINGS_\);/,
      'function webDeleteMailing_(body) {\n$1  var sheet  = ss.getSheetByName(ADDRESS_BOOK_HOUSEHOLDS_);'),
  }),

  // ---- the retired columns -------------------------------------------------
  'Send Card creeps back into the schema': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "'Country', 'Relationship',\n                         'Address Confirmed', 'Notes'];",
      "'Country', 'Relationship', 'Send Card',\n                         'Last Card Sent', 'Address Confirmed', 'Notes'];"),
  }),
  'an ordinary edit writes to the retired columns again': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    'Notes':            String(b.notes        || '').trim(),\n  };",
      "    'Notes':            String(b.notes        || '').trim(),\n    'Send Card': '', 'Last Card Sent': '',\n  };"),
  }),

  // ---- the dashboards: the card run -------------------------------------
  'the card run no longer carries the list forward': b => eachDoc(b, s =>
    s.replace(/forEvent\(h\.id, event\)\.length > 0/g, 'false')),
  'the still-to-send toggle is gone': b => eachDoc(b, s =>
    s.replace(/unsentOnly === 'year'/g, 'false')),
  'a mis-tick can no longer be undone': b => eachDoc(b, s =>
    s.replace(/action:\s*'delete_mailing'/g, "action:'save_mailing'")),
  'the Add-someone path is removed (a new event is unreachable)': b => eachDoc(b, s =>
    s.replace(/\+ Add someone/g, 'x')),
  'a leftover reference to the removed card-list state': b => eachDoc(b, s =>
    s.replace(/const shown = households\.filter\(h => \{/g,
              'const shown = households.filter(h => {\n    if (cardsOnly && !h.sendCard) return false;')),

  // ---- the Config-tab fallback (the 50-property editor cap) ----------------
  'the Config tab fallback is removed (unsettable past 50 properties)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /  if \(!id\) \{\n    try \{ id = String\(getConfigValues\(\)\['address_book_sheet_id'\] \|\| ''\)\.trim\(\); \}\n    catch \(cfgErr\) \{ id = ''; \}\n  \}\n/, ''),
  }),
  'the Config tab wins over the script property': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  if (!id) {\n    try { id = String(getConfigValues()['address_book_sheet_id'] || '').trim(); }",
      "  if (true) {\n    try { id = String(getConfigValues()['address_book_sheet_id'] || '').trim(); }"),
  }),
  'a broken Config tab takes the whole read down': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "    try { id = String(getConfigValues()['address_book_sheet_id'] || '').trim(); }\n    catch (cfgErr) { id = ''; }",
      "    id = String(getConfigValues()['address_book_sheet_id'] || '').trim();"),
  }),
  'the config key is spelled differently': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("'address_book_sheet_id'", "'addressBookSheetId'"),
  }),

  // ---- the property prune --------------------------------------------------
  'the prune does nothing': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('  keys.forEach(function(key) {',
                                                  '  keys.forEach(function(key) { return;'),
  }),
  'it uses deleteAllProperties + restore (loses everything on a kill)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /  var deleted = \[\];\n  removed\.forEach\(function\(k\) \{\n[\s\S]*?\n  \}\);\n/,
      "  var deleted = removed.slice();\n  removed.forEach(function(k) { delete all[k]; });\n" +
      "  if (deleted.length) { props.deleteAllProperties(); props.setProperties(all); }\n"),
  }),
  'one failed delete aborts the rest': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "    try { props.deleteProperty(k); deleted.push(k); }\n" +
      "    catch (delErr) { Logger.log('pruneScriptProperties_: could not delete ' + k + ' — ' + delErr.message); }",
      "    props.deleteProperty(k); deleted.push(k);"),
  }),
  'day plans are pruned after one day': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('var PROP_PRUNE_DAY_PLAN_DAYS_  = 7;',
                                                  'var PROP_PRUNE_DAY_PLAN_DAYS_  = 0;'),
  }),
  'travel-day latches are pruned after a day (re-sends briefings)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('var PROP_PRUNE_TDB_DAYS_       = 30;',
                                                  'var PROP_PRUNE_TDB_DAYS_       = 1;'),
  }),
  'perk latches are pruned the moment the period ends (re-emails)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('var PROP_PRUNE_PERK_DAYS_      = 60;',
                                                  'var PROP_PRUNE_PERK_DAYS_      = -400;'),
  }),
  'the perk period is taken by splitting on _ (CP_14 read as the period)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "      m = /_(\\d{4})(?:_(\\d{2}|Q[1-4]|H[12]))?$/.exec(key);",
      "      m = /_(\\d{4})/.exec(key);"),
  }),
  'an unrecognised key shape is deleted rather than left alone': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  keys.forEach(function(key) {\n    var m;',
      '  keys.forEach(function(key) {\n    var m;\n    if (!/^(day_plan_|TDB_SENT_|PERK_NOTIFY_)/.test(key)) { removed.push(key); return; }'),
  }),
  'the prune is not wired into the nightly run': b => ({
    'Code.js': b['Code.js'].replace(/\n *nightlyStep_\(ctx, 'pruneScriptProperties_', pruneScriptProperties_\);/, ''),
  }),
  'the clock cannot be injected': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('  var now   = nowMs || Date.now();',
                                                  '  var now   = Date.now();'),
  }),

  // ---- the dashboards ------------------------------------------------------
  'the People sub-tab goes back to "Coming soon"': b => ({
    'docs/app.js': b['docs/app.js'].replace(
      "sub==='people'&&/*#__PURE__*/React.createElement(AddressBookView,{apiUrl:apiUrl,apiToken:apiToken})",
      "sub==='people'&&/*#__PURE__*/React.createElement(\"div\",{className:\"empty-state\"},\"Coming soon\")"),
  }),
  'PeopleTab is no longer given the credentials': b => ({
    'docs/app.js': b['docs/app.js'].replace("React.createElement(PeopleTab,{apiUrl:apiUrl,apiToken:apiToken,",
                                            "React.createElement(PeopleTab,{"),
  }),
  'the lite dashboard loses its tab': b => ({
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      "  { id: 'people',        label: '📒 Address Book'   },\n", ''),
  }),
  'the lite dashboard never renders the view': b => ({
    'docs/dashboard-lite.html': b['docs/dashboard-lite.html'].replace(
      /\{activeTab === 'people' && \(\s*<AddressBookView[\s\S]*?\)\}/, ''),
  }),
  'an empty household goes back to dead "0 people" text': b => eachDoc(b, s =>
    s.replace(/\+ Add the names/g, '0 people')),
  'only the small triangle opens a household again': b => eachDoc(b, s =>
    s.replace(/Open to add people and see what has been sent/g, '')),
  'the dashboards write through apiGet again': b => {
    const o = {};
    DOCS.forEach(f => {
      o['docs/' + f] = b['docs/' + f]
        .replace(/await apiPost\(apiUrl, apiToken, body\);/g, 'await apiGet(apiUrl, apiToken, body);')
        .replace(/await apiPost\(apiUrl,apiToken,body\);/g, 'await apiGet(apiUrl,apiToken,body);');
    });
    return o;
  },
  'the unconfigured state stops naming the property': b => {
    const o = {};
    DOCS.forEach(f => { o['docs/' + f] = b['docs/' + f].replace(/ADDRESS_BOOK_SHEET_ID/g, 'the setting'); });
    return o;
  },
  'index.html is a stale build': b => ({
    'docs/index.html': b['docs/index.html'].replace(/AddressBookView/g, 'ComingSoonView'),
  }),
  'the README never documents the property': b => ({
    'README.md': b['README.md'].replace(/ADDRESS_BOOK_SHEET_ID/g, 'the sheet id'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_addressbook.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
