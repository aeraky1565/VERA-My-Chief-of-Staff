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
BASE['tests/regression.spec.js'] =
  fs.readFileSync(path.join(SRC_DIR, 'tests', 'regression.spec.js'), 'utf8');

// The same mutation applied to all three shipped copies. Every one of them must
// actually change: the three differ in whitespace (app.js and index.html are what
// Babel reprinted, dashboard-lite.html is the JSX as written), so a pattern tuned to
// one shape can silently miss another — and a control that half-applies still looks
// like it bit, because the harness only sees that SOMETHING changed.
const eachDoc = (b, fn) => {
  const o = {}, missed = [];
  DOCS.forEach(f => {
    o['docs/' + f] = fn(b['docs/' + f]);
    if (o['docs/' + f] === b['docs/' + f]) missed.push(f);
  });
  if (missed.length) throw new Error('mutation did not apply to ' + missed.join(', '));
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
      '    return key(b).localeCompare(key(a));',
      '    return key(a).localeCompare(key(b));'),
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
      "  var id = String(b.id || '').trim();\n  if (id) {",
      "  var id = String(b.id || '').trim();\n  if (false) {"),
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

  // ---- bulk import ---------------------------------------------------------
  'the Import tab is never created': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  ensureSheet(ss, ADDRESS_BOOK_IMPORT_,     IMPORT_HEADERS);\n', ''),
  }),
  'the preview writes for real (not a preview at all)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      'function webPreviewAddressImport_() { return addressBookImport_(true); }',
      'function webPreviewAddressImport_() { return addressBookImport_(false); }'),
  }),
  'the import only previews (silently does nothing)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      'function webRunAddressImport_() { return addressBookImport_(false); }',
      'function webRunAddressImport_() { return addressBookImport_(true); }'),
  }),
  'rows group by address instead of the Household column': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    var key = hh.toLowerCase();",
      "    var key = importCell_(row, 'Address Line 1').toLowerCase();"),
  }),
  'a person with no Household cell is dropped': b => ({
    'WebApp.js': b['WebApp.js'].replace("    if (!hh && name) hh = name;\n", ''),
  }),
  'a blank spacer row becomes a household': b => ({
    'WebApp.js': b['WebApp.js'].replace("    if (!hh && !name) { status[i] = ''; return; }\n", ''),
  }),
  'the first non-blank no longer wins (last row of a family overwrites)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      if (v && !g.fields[HOUSEHOLD_FIELDS[src]]) g.fields[HOUSEHOLD_FIELDS[src]] = v;",
      "      g.fields[HOUSEHOLD_FIELDS[src]] = v;"),
  }),
  'a BLANK import cell overwrites an existing value': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("      if (v && !g.fields[HOUSEHOLD_FIELDS[src]]) g.fields[HOUSEHOLD_FIELDS[src]] = v;",
               "      g.fields[HOUSEHOLD_FIELDS[src]] = v;")
      .replace("        if (g.fields[target] && g.fields[target] !== existing[target]) changed.push(target);",
               "        if (g.fields[target] !== existing[target]) changed.push(target);"),
  }),
  'an existing household is duplicated instead of updated': b => ({
    'WebApp.js': b['WebApp.js'].replace("    var existing = hhByName[key];",
                                        "    var existing = null;"),
  }),
  'a second run duplicates people': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      if (peopleKey[pk]) {\n        pSkipped++;", "      if (false) {\n        pSkipped++;"),
  }),
  'the Status column is never written': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /    var block = \[\];\n    for \(var i = 0;[\s\S]*?impSheet\.getRange\(2, statusCol, block\.length, 1\)\.setValues\(block\);\n/, ''),
  }),
  'the Status is written one row at a time': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    impSheet.getRange(2, statusCol, block.length, 1).setValues(block);",
      "    block.forEach(function(v, i) { impSheet.getRange(2 + i, statusCol).setValue(v[0]); });"),
  }),
  'the import deletes the rows it processed': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  if (!dryRun) {\n    appendAddressBookRows_(hhSheet, HOUSEHOLD_HEADERS, newHouseholds);",
      "  if (!dryRun) {\n    for (var dz = raw.length; dz >= 2; dz--) impSheet.deleteRow(dz);\n" +
      "    appendAddressBookRows_(hhSheet, HOUSEHOLD_HEADERS, newHouseholds);"),
  }),
  'the bulk append goes back to one call per row': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  sheet.getRange(sheet.getLastRow() + 1, 1, block.length, lastCol).setValues(block);",
      "  block.forEach(function(r) { sheet.appendRow(r); });"),
  }),
  'the preview and the import stop sharing one implementation': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      'function webPreviewAddressImport_() { return addressBookImport_(true); }',
      'function webPreviewAddressImport_() { return { ok: true, rows: 0, ' +
      'households: { created: 0, updated: 0 }, people: { created: 0, skipped: 0 }, ' +
      "messages: ['Preview: looks fine.'] }; }"),
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

  // ---- the dead end: reaching an event nobody has ever been sent -----------
  // Each of these puts back the shipped version of the closed loop, in which the
  // picker was built from the mailings that already existed.
  'the picker is wired straight to setEvent again': b => eachDoc(b, s =>
    s.replace(/startEvent\(e\.target\.value\)/g, 'setEvent(e.target.value)')),
  'the + New event option is taken out of the picker': b => eachDoc(b, s => s
    .replace(/\n *\{\/\* Without this the UI is a closed loop:[\s\S]*?\*\/\}\n *<option value="__new__">＋ New event…<\/option>/, '')
    .replace(/, \/\*#__PURE__\*\/React\.createElement\("option", \{\n *value: "__new__"\n *\}, "＋ New event…"\)/, '')),
  'a just-named event is not offered as its own option (blank picker)': b => eachDoc(b, s => s
    .replace(/\n *\{event && events\.indexOf\(event\) === -1 &&\n *<option value=\{event\}>✉️ \{event\}<\/option>\}/, '')
    .replace(/event && events\.indexOf\(event\) === -1 && \/\*#__PURE__\*\/React\.createElement\("option", \{\n *value: event\n *\}, "✉️ ", event\), /, '')),
  'cancelling the name prompt enters a nameless run': b => eachDoc(b, s =>
    s.replace(/ *if \(!name\) return;[^\n]*\n/, '')),
  'the typed name is not trimmed': b => eachDoc(b, s =>
    // Scoped to the prompt itself. `|| '').trim()` appears in more than one function,
    // and a loose replace lands in whichever comes first in the file.
    s.replace(/(window\.prompt\('Name the event[^\n]*\|\| ''\))\.trim\(\)/, '$1')),
  'a new event opens on an empty list instead of the pool': b => eachDoc(b, s =>
    s.replace(/setAddingTo\(true\);(\s*)setUnsentOnly\('year'\);/, "$1setUnsentOnly('year');")),
  'a new event inherits the last run\'s filter': b => eachDoc(b, s =>
    s.replace(/setAddingTo\(true\);\s*setUnsentOnly\('year'\);/, 'setAddingTo(true);')),
  'switching events leaves the add-someone pool open': b => eachDoc(b, s =>
    s.replace(/setEvent\(choice\);\s*setAddingTo\(false\);/, 'setEvent(choice);')),
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
  // ---- planned rows: a blank Sent means on the list, not posted -------------
  'planned is not expressible (every row dated today)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var planned = String(b.planned || '') === 'true' || b.planned === true;",
      '  var planned = false;'),
  }),
  'the planned flag only accepts a real boolean': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var planned = String(b.planned || '') === 'true' || b.planned === true;",
      '  var planned = b.planned === true;'),
  }),
  'marking sent adds a row beside the planned one (the ghost)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  if \(!planned\) \{\n    var pending = findMailing_\(sheet, householdId, event, ''\);\n[\s\S]*?\n  \}\n/,
      ''),
  }),
  'reverting twins the planned row instead of merging': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /    if \(planned\) \{\n      var twin = findMailing_\(sheet, householdId, event, ''\);\n[\s\S]*?\n    \}\n/,
      ''),
  }),
  'a planned-only event sorts last in the dropdown': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var key = function(m) { return String(m.sent || '').trim() || '9999-12-31'; };",
      "  var key = function(m) { return String(m.sent || '').trim(); };"),
  }),

  // ---- one-cell addresses ---------------------------------------------------
  'the Full Address column is gone from the schema': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("'Country', 'Full Address', 'Relationship',",
                                                  "'Country', 'Relationship',"),
  }),
  'the split never says what was pasted': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /      if \(splitFrom\[i\]\) \{\n[\s\S]*?\n      \}\n/, ''),
  }),
  'the split does not reach the columns at all': b => ({
    'WebApp.js': b['WebApp.js'].replace("      r[c - 1]   = parsed[part] || '';",
                                        '      ;'),
  }),
  'the one-liner is left behind after being split': b => ({
    'WebApp.js': b['WebApp.js'].replace("    r[fullCol - 1]  = '';\n", ''),
  }),
  'the split is never written back to the tab': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  Object\.keys\(changed\)\.forEach\(function\(c\) \{\n[\s\S]*?\n  \}\);\n  return \{ split/,
      '  return { split'),
  }),
  'the split is written one row at a time': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '    var block = raw.map(function(r) { return [r[col - 1]]; });\n' +
      '    sheet.getRange(2, col, block.length, 1).setValues(block);',
      '    raw.forEach(function(r, i) { sheet.getRange(2 + i, col, 1, 1).setValues([[r[col - 1]]]); });'),
  }),
  'the pre-pass is not wired in (nothing is ever split)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '  var split     = splitImportAddresses_(impSheet, impCols, raw);',
      '  var split     = { split: [], failed: [] };'),
  }),
  'a missing Full Address column takes the whole import down': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  if \(!fullCol\) return \{ split: splitFrom, failed: failed \};/,
      "  if (!fullCol) throw new Error('No Full Address column');"),
  }),

  // ---- a column of addresses with nobody named ------------------------------
  'a nameless pasted address vanishes again': b => ({
    'WebApp.js': b['WebApp.js'].replace(/    var autoNamed = false;\n    if \(!hh\) \{\n[\s\S]*?\n    \}\n/,
                                        '    var autoNamed = false;\n'),
  }),
  'the invented name is the street without the city': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      var label = [importCell_(row, 'Address Line 1'), importCell_(row, 'City')]",
      "      var label = [importCell_(row, 'Address Line 1')]"),
  }),
  'a genuinely blank row becomes a household too': b => ({
    'WebApp.js': b['WebApp.js'].replace("    if (!hh && !name) { status[i] = ''; return; }",
                                        "    if (!hh && !name) { hh = 'Unknown'; }"),
  }),
  'nothing says the household was named after its address': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "        status[ri] += ' · named after the address, rename it';\n", ''),
  }),
  'two different addresses under one invented name are merged silently': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '      var collided = Object.keys(g.addrs).length > 1;',
      '      var collided = false;'),
  }),
  'the collision check looks at the name rather than the address': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /      g\.addrs\[IMPORT_ADDRESS_PARTS_\.map\(function\(k\) \{ return importCell_\(row, k\); \}\)\n *\.join\('\|'\)\.toLowerCase\(\)\] = true;/,
      '      g.addrs[g.label.toLowerCase()] = true;'),
  }),
  // ---- the parser, and the vocabularies it now leans on --------------------
  //
  // THE REPORTED BUG, put back: everything in Address Line 1.
  'the whole address lands in Address Line 1': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /^function parseFullAddress_\(text\) \{\n[\s\S]*?\n\}$/m,
      "function parseFullAddress_(text) {\n" +
      "  var t = String(text || '').trim();\n" +
      "  return t ? { 'Address Line 1': t } : {};\n}"),
  }),
  // The confidence rule, which is the half that STOPS it happening again.
  'an unreadable line is dumped into Address Line 1 instead of declined': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  if (!out['City'] && !out['State'] && !out['Postal Code'] && !out['Country']) return {};\n",
      ''),
  }),
  'a state is any two letters again': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  var k = String(word || \'\').trim().replace(/\\./g, \'\').toLowerCase();\n  return US_STATES_[k] || \'\';',
      '  var k = String(word || \'\').trim().replace(/\\./g, \'\');\n' +
      '  return /^[A-Za-z]{2}$/.test(k) ? k.toUpperCase() : (US_STATES_[k.toLowerCase()] || \'\');'),
  }),
  'the state vocabulary knows only the codes, not the names': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("'alabama':'AL',", "'xalabamax':'AL',")
      .replace("'texas':'TX',", "'xtexasx':'TX',"),
  }),
  'a country is anything without digits again': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "  var raw = String(word || '').trim().toLowerCase();\n" +
      "  return COUNTRIES_[raw] || COUNTRIES_[raw.replace(/\\./g, '')] || '';",
      "  var raw = String(word || '').trim();\n" +
      "  return /\\d/.test(raw) ? '' : raw;"),
  }),
  'country aliases are not collapsed to one spelling': b => ({
    'AddressBook.js': b['AddressBook.js'].replace("'us':'USA',", "'us':'US',"),
  }),
  'the street suffixes are gone (street and city stay glued)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(/^var STREET_SUFFIXES_ = \[[\s\S]*?\];$/m,
                                                  'var STREET_SUFFIXES_ = [];'),
  }),
  'a trailing quadrant is taken off the street': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(/^var DIRECTIONALS_ = \[[\s\S]*?\];$/m,
                                                  'var DIRECTIONALS_ = [];'),
  }),
  'the unit keywords are gone (no second address line)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(/^var UNIT_KEYWORDS_ = \[[\s\S]*?\];$/m,
                                                  'var UNIT_KEYWORDS_ = [];'),
  }),
  'a unit keyword at the start of the street still splits it': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  for (var i = 1; i < words.length; i++) {          // never the first word',
      '  for (var i = 0; i < words.length; i++) {'),
  }),
  'the state is matched anywhere in the segment, not at the end': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /    \/\/ 2\. A state immediately before it[\s\S]*?\n    \}\n/,
      '    for (var si = words.length - 1; si >= 0; si--) {\n' +
      '      if (parseUsState_(words[si])) { out[\'State\'] = parseUsState_(words[si]);\n' +
      '                                      words.splice(si, 1); break; }\n' +
      '    }\n'),
  }),
  'the postcode-first rule loses its street-suffix guard': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "        !words.some(isStreetSuffix_)) {", '        true) {'),
  }),
  'the leftover middle segments are dropped rather than kept as line 2': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      "    var line2 = [street.line2].concat(segs).filter(function(v) { return v; });",
      "    var line2 = [street.line2].filter(function(v) { return v; });"),
  }),

  // ---- a pasted address replaces what is there ------------------------------
  // THE REPORTED BUG, put back: the pre-pass protects its own stale output, so a bad
  // split can never be corrected by re-pasting.
  'the split refuses to overwrite a column that already has something in it': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '      if (!c) return;\n      r[c - 1]   = parsed[part] || \'\';',
      '      if (!c || !parsed[part] || cell(r, c)) return;\n      r[c - 1]   = parsed[part];'),
  }),
  'a split writes only the parts it found, never the empty ones': b => ({
    'WebApp.js': b['WebApp.js'].replace("      r[c - 1]   = parsed[part] || '';",
                                        "      if (!parsed[part]) return;\n      r[c - 1]   = parsed[part];"),
  }),
  'an import can fill a blank field but never clear one': b => ({
    'WebApp.js': b['WebApp.js'].replace(/      if \(g\.statesAddress\) \{\n[\s\S]*?\n      \}\n/, ''),
  }),
  'a row with no street line still claims to state the whole address': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (!g.statesAddress && importCell_(row, 'Address Line 1')) {",
      '    if (!g.statesAddress) {'),
  }),
  'the rule keys on the paste again, so preview and import disagree': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (!g.statesAddress && importCell_(row, 'Address Line 1')) {",
      '    if (!g.statesAddress && splitFrom[i]) {'),
  }),
  'a cleared field is reported as an ordinary update': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "          changed.push(target + (want[target] ? '' : ' (cleared)'));",
      '          changed.push(target);'),
  }),

  // ---- a line it cannot read -----------------------------------------------
  'a declined line has its one-liner cleared anyway': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (!Object.keys(parsed).length) { failed[i] = whole; return; }",
      "    if (!Object.keys(parsed).length) { failed[i] = whole; r[fullCol - 1] = '';\n" +
      "                                       changed[fullCol] = true; return; }"),
  }),
  'nothing on the row says the line could not be read': b => ({
    'WebApp.js': b['WebApp.js'].replace(/      if \(splitFailed\[i\]\) \{\n[\s\S]*?\n      \}\n/, ''),
  }),
  'a declined line is reported but its columns are filled anyway': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (!Object.keys(parsed).length) { failed[i] = whole; return; }",
      "    if (!Object.keys(parsed).length) { failed[i] = whole;\n" +
      "      parsed = { 'Address Line 1': whole }; }"),
  }),

  // ---- the column the live Import tab is missing ----------------------------
  'the missing column is never added to the live tab': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  ensureImportColumns_(ss.getSheetByName(ADDRESS_BOOK_IMPORT_));\n', ''),
  }),
  'it rewrites the whole header row instead of appending': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  var at = Math.max(sheet.getLastColumn(), 0) + 1;\n' +
      '  sheet.getRange(1, at, 1, adding.length).setValues([adding]);',
      '  sheet.getRange(1, 1, 1, IMPORT_HEADERS.length).setValues([IMPORT_HEADERS]);'),
  }),
  'it adds every column again on every call': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      '  var adding = IMPORT_HEADERS.filter(function(h) { return !have[h]; });',
      '  var adding = IMPORT_HEADERS.slice();'),
  }),

  // ---- the dashboards: planned, and the two buttons -------------------------
  // The pool's ＋ Add goes, leaving only ✓ Sent — which is the shipped version of
  // "the only way to start an event is to claim you already sent it". The label is
  // changed rather than the button excised: "＋ Add" occurs 26 times in docs/app.js
  // (Add Person, Add Idea, Add Chore…), so removing one and looking for the string
  // file-wide bit nothing at all until the assertions were scoped to the block.
  'the pool offers only + Sent again': b => eachDoc(b, s => s
    .replace(/title=\{'Add to ' \+ event \+ ' — not sent yet'\}/, "title={'Sent'}")
    .replace(/title: 'Add to ' \+ event \+ ' — not sent yet'/, "title: 'Sent'")
    .replace(/＋ Add\n *<\/button>/, '✓ Sent\n              </button>')
    .replace(/\}, "＋ Add"\)/, '}, "✓ Sent")')),
  'un-ticking deletes the row again instead of going back to planned': b => eachDoc(b, s => s
    .replace(/write\(\{ action:'save_mailing', id: sent\[0\]\.id, householdId:h\.id, event: event, planned:true \}\)/,
             "write({ action:'delete_mailing', id: sent[0].id })")
    .replace(/write\(\{\n *action: 'save_mailing',\n *id: sent\[0\]\.id,\n *householdId: h\.id,\n *event: event,\n *planned: true\n *\}\)/,
             "write({ action: 'delete_mailing', id: sent[0].id })")),
  // Babel drops the inner parens, so the JSX and the two compiled copies differ:
  // `String((m && m.sent) || '')` against `String(m && m.sent || '')`.
  'a planned row counts as sent': b => eachDoc(b, s =>
    s.replace(/function abIsSent\(m\) \{\s*return String\(\(?m && m\.sent\)? \|\| ''\)\.trim\(\) !== '';\s*\}/,
              'function abIsSent(m) { return !!m; }')),
  'nothing tells you a named event is not saved yet': b => eachDoc(b, s =>
    s.replace(/Nothing is saved for/g, 'No cards yet for')),
  'taking a household off an event needs no confirmation': b => eachDoc(b, s =>
    s.replace(/if \(!window\.confirm\(msg\)\) return;/, 'if (false) return;')),
  'the removals fire together and race their reloads': b => eachDoc(b, s => s
    .replace(/for \(const m of rows\) \{\n *if \(!await write\(\{ action:'delete_mailing', id:m\.id \}\)\) return;[^\n]*\n *\}/,
             "rows.forEach(m => write({ action:'delete_mailing', id:m.id }));")
    .replace(/for \(const m of rows\) \{\n *if \(!\(await write\(\{\n *action: 'delete_mailing',\n *id: m\.id\n *\}\)\)\) return;[\s\S]*?\n *\}/,
             "rows.forEach(m => write({ action: 'delete_mailing', id: m.id }));")),

  // ---- unique ids, and the repair -----------------------------------------
  // THE BUG ITSELF: a thousand possible ids per millisecond.
  'the id generator goes back to Date.now plus three digits': b => ({
    'AddressBook.js': b['AddressBook.js'].replace(
      /  ADDRESS_BOOK_ID_SEQ_\+\+;\n  return prefix[\s\S]*?Math\.random\(\)\.toString\(36\)\.slice\(2, 8\);/,
      "  return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);"),
  }),
  'the sequence stops advancing (every id in a run is the same)': b => ({
    'AddressBook.js': b['AddressBook.js'].replace('  ADDRESS_BOOK_ID_SEQ_++;\n', ''),
  }),
  'the repair never re-issues a duplicated household id': b => ({
    'WebApp.js': b['WebApp.js'].replace("      entry.id = newAddressBookId_('HH');",
                                        '      return;'),
  }),
  'the repair re-issues the FIRST of a set too (orphaning its children)': b => ({
    'WebApp.js': b['WebApp.js'].replace("      if (n === 0) return;              // the first keeps it\n", ''),
  }),
  'people are never re-linked, so both households keep all of them': b => ({
    'WebApp.js': b['WebApp.js'].replace("    r[pp.cols['Household ID'] - 1] = hits[0].id;\n    pRelinked++;",
                                        '    return;'),
  }),
  'an unattributable person is GUESSED rather than flagged': b => ({
    'WebApp.js': b['WebApp.js'].replace('    if (hits.length !== 1) {',
                                        '    if (false) {'),
  }),
  'the Import tab is ignored, so re-linking has nothing to go on': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    var homes = livesAt[name.toLowerCase()] || {};", '    var homes = {};'),
  }),
  'duplicate person and mailing ids are left alone': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "      r[tab.cols['ID'] - 1] = newAddressBookId_(pair[2] === 'people' ? 'P' : 'M');\n", ''),
  }),
  'a stranded mailing is not reported': b => ({
    'WebApp.js': b['WebApp.js'].replace(/  if \(mStranded\) \{\n[\s\S]*?\n  \}\n/, ''),
  }),
  'the repair preview writes for real (not a preview at all)': b => ({
    'WebApp.js': b['WebApp.js'].replace('  if (!dryRun) {\n    repairWriteColumn_(hhSheet',
                                        '  if (true) {\n    repairWriteColumn_(hhSheet'),
  }),
  'the repair writes one row at a time': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '  sheet.getRange(2, col, rows.length, 1).setValues(rows.map(function(r) { return [r[col - 1]]; }));',
      '  rows.forEach(function(r, i) { sheet.getRange(2 + i, col, 1, 1).setValues([[r[col - 1]]]); });'),
  }),
  'a clean book is reported as having been repaired': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '  var clean = !hhFixed && !pFixed && !mFixed && !pRelinked && !flagged.length;',
      '  var clean = false;'),
  }),
  'the live run stops checking that ids are unique': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /    expect\(\{ households: dupHh[\s\S]*?mailings: 0 \}\);\n/, ''),
  }),
  'the live run checks the three kinds separately, stopping at the first': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /    expect\(\{ households: dupHh[\s\S]*?mailings: 0 \}\);\n/,
      "    expect(dupHh, 'households share an id').toEqual([]);\n" +
      "    expect(dupP, 'people share an id').toEqual([]);\n" +
      "    expect(dupM, 'mailings share an id').toEqual([]);\n"),
  }),

  // ---- the live read-only check -------------------------------------------
  'the live run never checks the address book is configured': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      "test('address_book is configured and readable'",
      "test.skip('address_book is configured and readable'"),
  }),
  'the live check writes to the real address book': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      '    expect(resp.ok()).toBeTruthy();\n    const data = await resp.json();\n' +
      '    // A wrong id,',
      '    await ctx.post(VERA_URL, { data: { action: \'save_mailing\', token: VERA_TOKEN } });\n' +
      '    expect(resp.ok()).toBeTruthy();\n    const data = await resp.json();\n' +
      '    // A wrong id,'),
  }),
  'the live check stops naming the Config tab route in': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      "'property, or add an address_book_sheet_id row to the Config tab'",
      "'property'"),
  }),
  'the live check logs who is in the book': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      '`  📒 address book: ${data.households.length} households, `',
      '`  📒 address book: ${data.households[0].household} and others, `'),
  }),
  'a missing field no longer points at a stale deployment': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      '`${k} is missing from the response — is the live deployment stale?`',
      '`${k} should be an array`'),
  }),

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
  fs.mkdirSync(path.join(OUT, 'tests'), { recursive: true });
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
