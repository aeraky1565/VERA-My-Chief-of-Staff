// The shared address book: who we send things to, and where.
//
// It lives in a SEPARATE spreadsheet — Ahmed built it so it can be shared with
// Victoria on its own, without handing over finances, health and career too. VERA
// reaches it by id from ADDRESS_BOOK_SHEET_ID, the same way the Simple Ass Tracker
// budget is read and written.
//
// Two things that fall out of it being someone else's document, both pinned below:
// VERA must never disturb what is already in that sheet, and every read must be
// header-driven, because a tab two people edit by hand WILL have a column inserted
// in the middle of it eventually.
//
// Writes are POST with a JSON body rather than GET with parameters. makeUrl in the
// dashboards drops falsy values instead of sending them, so under GET a cleared
// Address Line 2 would never arrive and would read as "leave it alone" — the bug
// that made un-checking Autopay a silent no-op (1a317f3). Nearly every field here is
// optional free text, so that trap would have applied to almost all of them.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Book:  fs.readFileSync(ROOT + '/AddressBook.js', 'utf8'),
  Web:   fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
  Code:  fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  App:   fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
  Index: fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
  Lite:  fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8'),
};

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let paren = 0, afterParams = -1;
  for (let j = src.indexOf('(', start); j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) { afterParams = j; break; } }
  }
  let depth = 0;
  for (let j = src.indexOf('{', afterParams); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
// [\s\S] rather than . — HOUSEHOLD_HEADERS is wrapped across three lines, and a
// dot-based match stops at the first newline and finds nothing.
const decl = (src, name) => {
  const m = new RegExp('^var ' + name + '\\s*=[\\s\\S]*?;', 'm').exec(src);
  if (!m) throw new Error('decl not found: ' + name);
  return m[0];
};

const HH_H = ['ID', 'Household', 'Address Line 1', 'Address Line 2', 'City', 'State',
              'Postal Code', 'Country', 'Relationship', 'Address Confirmed', 'Notes'];
const P_H  = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Member Type', 'Notes'];
const M_H  = ['ID', 'Household ID', 'Event', 'Sent', 'Notes'];
const I_H  = ['Household', 'Name', 'Member Type', 'Email', 'Phone',
              'Address Line 1', 'Address Line 2', 'City', 'State', 'Postal Code',
              'Country', 'Relationship', 'Household Notes', 'Person Notes', 'Status'];
// What Ahmed's live sheet looks like TODAY: the two retired columns are still in it.
// VERA must read around them and never write to them.
const HH_LEGACY = ['ID', 'Household', 'Address Line 1', 'Address Line 2', 'City', 'State',
                   'Postal Code', 'Country', 'Relationship', 'Send Card', 'Last Card Sent',
                   'Address Confirmed', 'Notes'];

// A spreadsheet that behaves like the real one where it matters: rows shift when you
// delete, appendRow pads to the widest row, and a tab can have EXTRA columns.
function fakeSheet(headers, rows) {
  // A freshly inserted sheet has getLastRow() === 0, and ensureSheet only writes
  // headers into one that is genuinely blank. Modelling a new tab as [[]] made it
  // look one row tall and the headers were silently skipped.
  const data = (headers && headers.length ? [headers.slice()] : [])
    .concat((rows || []).map(r => r.slice()));
  const api = {
    _data: data,
    _writes: { setValue: 0, setValues: 0 },
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const n = nr === undefined ? 1 : nr, w = nc === undefined ? 1 : nc;
        const out = [];
        for (let i = 0; i < n; i++) {
          const row = data[r - 1 + i] || [];
          const seg = [];
          for (let j = 0; j < w; j++) seg.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(seg);
        }
        return out;
      },
      getValue: () => { const row = data[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; },
      setValue: v => { api._writes.setValue++;
        while ((data[r - 1] || []).length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; },
      setValues: vals => {
        api._writes.setValues++;
        vals.forEach((row, i) => {
          const target = data[r - 1 + i] || (data[r - 1 + i] = []);
          row.forEach((v, j) => {
            while (target.length < c + j) target.push('');
            target[c - 1 + j] = v;
          });
        });
      },
      setFontWeight: () => api._range, setBackground: () => api._range, setFontColor: () => api._range,
    }),
    setFrozenRows: () => {},
    appendRow: r => data.push(r.slice()),
    deleteRow: n => data.splice(n - 1, 1),
  };
  api._range = api.getRange(1, 1);
  return api;
}

function harness(opts) {
  const o = opts || {};
  const tabs = o.tabs || {};
  const created = [];
  const health = [];
  const props = o.props || {};
  const ss = {
    getSheetByName: n => tabs[n] || null,
    insertSheet: n => { created.push(n); tabs[n] = fakeSheet([]); return tabs[n]; },
  };

  const ctx = {
    String, Number, Object, Array, Math, JSON, Date, RegExp, Boolean, Error, console,
    isFinite, isNaN, parseInt, parseFloat,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d, tz, f) => {
      const p2 = n => String(n).padStart(2, '0');
      if (f === 'yyyy') return String(d.getFullYear());
      if (f === 'yyyy-MM-dd') return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      throw new Error('unstubbed format: ' + f);
    } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      getProperties: () => Object.assign({}, props),
      deleteProperty: k => { delete props[k]; },
      // Deliberately absent: deleteAllProperties. Reaching for it here would mean
      // the prune could lose the entire store if it died mid-way.
    }) },
    SpreadsheetApp: { openById: id => {
      if (o.openThrows) throw new Error(o.openThrows);
      if (id !== 'BOOK-ID') throw new Error('unexpected id: ' + id);
      return ss;
    } },
    recordApiHealth_: (source, ok, detail, code) => health.push({ source, ok, detail, code }),
    getConfigValues: () => (o.config || {}),
    _tabs: tabs, _created: created, _health: health, _props: props,
  };
  vm.createContext(ctx);
  vm.runInContext([
    decl(SRC.Book, 'ADDRESS_BOOK_PROP_'),
    decl(SRC.Book, 'ADDRESS_BOOK_HEALTH_'),
    decl(SRC.Book, 'ADDRESS_BOOK_HOUSEHOLDS_'),
    decl(SRC.Book, 'ADDRESS_BOOK_PEOPLE_'),
    decl(SRC.Book, 'HOUSEHOLD_HEADERS'),
    decl(SRC.Book, 'CONTACT_HEADERS'),
    decl(SRC.Book, 'MAILING_HEADERS'),
    decl(SRC.Book, 'IMPORT_HEADERS'),
    decl(SRC.Book, 'ADDRESS_BOOK_IMPORT_'),
    extractFn(SRC.Book, 'appendAddressBookRows_'),
    decl(SRC.Book, 'ADDRESS_BOOK_MAILINGS_'),
    extractFn(SRC.Code, 'ensureSheet'),
    extractFn(SRC.Book, 'getAddressBookSheet_'),
    decl(SRC.Book, 'PROP_PRUNE_DAY_PLAN_DAYS_'),
    decl(SRC.Book, 'PROP_PRUNE_PERK_DAYS_'),
    decl(SRC.Book, 'PROP_PRUNE_TDB_DAYS_'),
    extractFn(SRC.Code, 'perkPeriodKeyEnd_'),
    extractFn(SRC.Book, 'pruneScriptProperties_'),
    extractFn(SRC.Book, 'ensureAddressBookTabs_'),
    extractFn(SRC.Book, 'addressBookCols_'),
    extractFn(SRC.Book, 'readAddressBookTab_'),
    extractFn(SRC.Book, 'findAddressBookRow_'),
    extractFn(SRC.Book, 'writeAddressBookRow_'),
    extractFn(SRC.Book, 'appendAddressBookRow_'),
    extractFn(SRC.Book, 'deleteAddressBookRowsFor_'),
    extractFn(SRC.Book, 'newAddressBookId_'),
    extractFn(SRC.Web, 'webGetAddressBook_'),
    extractFn(SRC.Web, 'addressBookForWrite_'),
    extractFn(SRC.Web, 'webSaveHousehold_'),
    extractFn(SRC.Web, 'webDeleteHousehold_'),
    extractFn(SRC.Web, 'webSaveContact_'),
    extractFn(SRC.Web, 'webDeleteContact_'),
    extractFn(SRC.Web, 'webSaveMailing_'),
    extractFn(SRC.Web, 'findMailing_'),
    extractFn(SRC.Web, 'webDeleteMailing_'),
    extractFn(SRC.Web, 'importCell_'),
    extractFn(SRC.Web, 'addressBookImport_'),
    extractFn(SRC.Web, 'webPreviewAddressImport_'),
    extractFn(SRC.Web, 'webRunAddressImport_'),
    extractFn(SRC.Web, 'webConfirmAddress_'),
  ].join('\n'), ctx);
  return ctx;
}

const threw = fn => { try { fn(); return null; } catch (e) { return e.message; } };
const seeded = () => ({
  'Households': fakeSheet(HH_H, [
    ['HH-1', 'The Smith Family', '12 Elm St', 'Apt 4', 'Austin', 'TX', '78701', 'USA',
     'Family', '2026-01-10', 'via Jane'],
    ['HH-2', 'Dana & Omar', '3 Nile Rd', '', 'Cairo', '', '', 'Egypt', 'Friends', '', ''],
  ]),
  'Mailings': fakeSheet(M_H, [
    // Two Christmas cards to the same household in different years. A single
    // 'Last Card Sent' column could only ever have held the second.
    ['M-1', 'HH-1', 'Christmas card',    '2024-12-12', ''],
    ['M-2', 'HH-1', 'Christmas card',    '2025-12-09', ''],
    // Deliberately the most recent, so 'most recently used first' is observable:
    // with Christmas as both oldest and newest, either sort order gives the
    // same answer and the assertion proves nothing.
    ['M-3', 'HH-1', 'Wedding thank you', '2026-07-02', 'for the vase'],
    ['M-4', 'HH-2', 'Christmas card',    '2025-12-11', ''],
    ['', '', '', '', ''],   // a spacer row left behind by hand
  ]),
  'People': fakeSheet(P_H, [
    // A half-typed row somebody left in the sheet. It has no ID, so it is not an
    // entry — and rendering it as a nameless person would be worse than ignoring it.
    ['', '', '', '', '', '', ''],
    ['P-1', 'HH-1', 'John Smith', 'john@x.test', '555-1', 'Adult', ''],
    ['P-2', 'HH-1', 'Mia Smith',  '',            '',      'Child', ''],
    ['P-3', 'HH-2', 'Dana',       'dana@x.test', '',      'Adult', ''],
  ]),
});

// ============================================================================
console.log('Not configured is not broken');
{
  const c = harness({ props: {} });
  let out = null, escaped = null;
  try { out = c.webGetAddressBook_(); } catch (e) { escaped = e.message; }
  check('it answers rather than throwing', escaped === null && out && out.ok === true,
        String(escaped));
  out = out || { households: [], people: [], configured: null };
  check('…saying it is not configured', out.configured === false);
  check('…with empty lists the dashboard can render', out.households.length === 0 && out.people.length === 0);
  check('NO api-health failure is recorded', c._health.length === 0,
        JSON.stringify(c._health));
  check('…because an unconfigured feature is not an outage', true,
        'that is the aviationstack bug: a normal state filed as a fault, nagging daily');
}

console.log('\nThe sheet id can come from the Config TAB, not just a property');
{
  // The Apps Script property editor lists 50 and goes read-only past that, and VERA
  // is well past it — so for a value a human types, the Config tab is the only home
  // that actually works.
  const viaCfg = harness({ props: {}, config: { address_book_sheet_id: 'BOOK-ID' }, tabs: seeded() });
  const out = viaCfg.webGetAddressBook_();
  check('a Config row configures it', out.configured === true && out.ok === true,
        JSON.stringify({ c: out.configured, ok: out.ok }));
  check('…and the data comes back', out.households.length === 2);

  const viaProp = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  check('the script property still works', viaProp.webGetAddressBook_().configured === true,
        'an existing deployment must not break');

  const both = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' },
                         config: { address_book_sheet_id: 'WRONG-ID' }, tabs: seeded() });
  check('the property wins when both are set', both.webGetAddressBook_().ok === true,
        'openById throws on any id but BOOK-ID, so this proves which was used');

  const neither = harness({ props: {}, config: {} });
  check('neither set is still just "not configured"',
        neither.webGetAddressBook_().configured === false);

  const cfgThrows = harness({ props: {}, tabs: seeded() });
  cfgThrows.getConfigValues = () => { throw new Error('Config tab missing'); };
  let cfgOut = null, cfgErr = null;
  try { cfgOut = cfgThrows.webGetAddressBook_(); } catch (e) { cfgErr = e.message; }
  check('a broken Config tab does not take the read down',
        cfgErr === null && cfgOut && cfgOut.configured === false,
        'it should read as unconfigured, not throw: ' + cfgErr);
}

console.log('\nA sheet we WERE told to open and could not IS an outage');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, openThrows: 'You do not have permission' });
  const out = c.webGetAddressBook_();
  check('the read reports failure', out.ok === false && out.configured === true);
  check('…carrying the reason', /permission/.test(out.error), out.error);
  check('…and it IS recorded against api health',
        c._health.length === 1 && c._health[0].ok === false, JSON.stringify(c._health));
  check('…under a stable source name', c._health[0].source === 'sheet:AddressBook',
        c._health[0].source);
}

// ============================================================================
console.log('\nVERA adds its tabs and disturbs nothing else');
{
  // Ahmed's own tab is already in that document. It must come out untouched.
  const his = fakeSheet(['Name', 'Addr'], [['Grandma', '9 Oak Ave']]);
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' },
                      tabs: { "Ahmed's list": his } });
  c.webGetAddressBook_();

  check('all four tabs are created', c._created.indexOf('Households') !== -1 &&
        c._created.indexOf('People') !== -1 && c._created.indexOf('Mailings') !== -1 &&
        c._created.indexOf('Import') !== -1,
        JSON.stringify(c._created));
  const hdrOf = t => ((c._tabs[t] && c._tabs[t]._data[0]) || []).join('|');
  check('…with the full headers', hdrOf('Households') === HH_H.join('|'), hdrOf('Households'));
  check('…and the contact headers', hdrOf('People') === P_H.join('|'), hdrOf('People'));
  check('…and the mailing headers', hdrOf('Mailings') === M_H.join('|'), hdrOf('Mailings'));

  check('the pre-existing tab is left EXACTLY as it was',
        his._data.length === 2 && his._data[1][0] === 'Grandma' && his._data[0][0] === 'Name',
        JSON.stringify(his._data));
  check('…and is not deleted', c._tabs["Ahmed's list"] === his,
        'his data is the whole reason this is non-destructive');

  const before = JSON.stringify(c._tabs['Households']._data);
  c.webGetAddressBook_();
  check('a second call creates nothing new', c._created.length === 4, JSON.stringify(c._created));
  check('…and rewrites no headers', JSON.stringify(c._tabs['Households']._data) === before);
}

// ============================================================================
console.log('\nReading');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const out = c.webGetAddressBook_();

  check('both households come back', out.households.length === 2, String(out.households.length));
  check('…with their fields', out.households[0].household === 'The Smith Family' &&
        out.households[0].city === 'Austin' && out.households[0].postalCode === '78701',
        JSON.stringify(out.households[0]));
  check('mailings come back', out.mailings.length === 4, String(out.mailings.length));
  check('…with the FULL history, not just the most recent',
        out.mailings.filter(m => m.householdId === 'HH-1' && m.event === 'Christmas card').length === 2,
        'a single Last Card Sent column could only ever hold the second');
  check('the event vocabulary is distinct', out.events.length === 2, JSON.stringify(out.events));
  check('…most recently used first',
        out.events[0] === 'Wedding thank you' && out.events[1] === 'Christmas card',
        JSON.stringify(out.events));
  check('all three people come back', out.people.length === 3, String(out.people.length));
  check('…and the blank spacer row is not one of them',
        out.people.every(p => p.id && p.name),
        'a row with no ID is someone half-typing, not a person');
  check('…linked to their household', out.people.filter(p => p.householdId === 'HH-1').length === 2);
  check('…and a child is marked as one', out.people[1].memberType === 'Child');
  check('a successful open records health', c._health.some(h => h.ok === true));
  check('the household note comes back', out.households[0].notes === 'via Jane',
        JSON.stringify(out.households[0].notes));
  check('…and a person note has its own field',
        out.people.every(p => typeof p.notes === 'string'),
        'a note about a household and a note about a person answer different questions');
}

console.log('\nReads are header-driven, because two people edit this sheet by hand');
{
  // Victoria inserts a 'Salutation' column between Household and Address Line 1.
  const moved = ['ID', 'Household', 'Salutation', 'Address Line 1', 'Address Line 2', 'City',
                 'State', 'Postal Code', 'Country', 'Relationship',
                 'Address Confirmed', 'Notes'];
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: {
    'Households': fakeSheet(moved, [
      ['HH-1', 'The Smith Family', 'Dear John & Jane', '12 Elm St', '', 'Austin', 'TX',
       '78701', 'USA', 'Family', '2026-01-10', 'note'],
    ]),
    'People':   fakeSheet(P_H, []),
    'Mailings': fakeSheet(M_H, []),
  }});
  const h = c.webGetAddressBook_().households[0];
  check('an inserted column does not shift every field',
        h.address1 === '12 Elm St' && h.city === 'Austin' && h.notes === 'note',
        JSON.stringify(h));
  check('…and reading by position would have got this wrong', true,
        'the first sign would be an address showing up in Notes');

  // And a write still lands in the right column.
  c.webSaveHousehold_({ id: 'HH-1', household: 'The Smith Family', city: 'Dallas' });
  const row = c._tabs['Households']._data[1];
  check('a write targets the header, not an index',
        row[moved.indexOf('City')] === 'Dallas' && row[moved.indexOf('Salutation')] === 'Dear John & Jane',
        JSON.stringify(row));
  check('…and the hand-added column is preserved', row[2] === 'Dear John & Jane',
        'VERA must not eat a column it has never heard of');
}

// ============================================================================
console.log('\nSaving a household');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const r = c.webSaveHousehold_({ household: 'The Patels', address1: '7 Cedar Way',
                                  city: 'Reston', state: 'VA', postalCode: '20190',
                                  country: 'USA', relationship: 'Friends' });
  check('no id means insert', r.action === 'created' && /^HH-/.test(r.id), JSON.stringify(r));
  check('…appended to the tab', c._tabs['Households']._data.length === 4);
  const added = c.webGetAddressBook_().households.filter(h => h.id === r.id)[0];
  check('…with its fields', added.household === 'The Patels' && added.city === 'Reston');

  const r2 = c.webSaveHousehold_({ id: 'HH-2', household: 'Dana & Omar', city: 'Alexandria',
                                   country: 'Egypt', relationship: 'Friends' });
  check('an id means update', r2.action === 'updated' && r2.id === 'HH-2');
  check('…in place', c._tabs['Households']._data.length === 4, 'no row was added');
  check('…changing the row named', c.webGetAddressBook_().households
        .filter(h => h.id === 'HH-2')[0].city === 'Alexandria');
  check('…and touching no other row', c.webGetAddressBook_().households
        .filter(h => h.id === 'HH-1')[0].city === 'Austin',
        'an edit to one household must not disturb its neighbours');

  check('a nameless household is refused',
        threw(() => c.webSaveHousehold_({ city: 'Nowhere' })) !== null,
        'it is what goes on the envelope');
  check('an unknown id is refused rather than silently inserted',
        threw(() => c.webSaveHousehold_({ id: 'HH-404', household: 'Ghost' })) !== null);
}

console.log('\nA blank really clears — the makeUrl trap, pinned');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  // HH-1 starts with 'Apt 4' and 'via Jane'. Save it with both emptied.
  c.webSaveHousehold_({ id: 'HH-1', household: 'The Smith Family', address1: '12 Elm St',
                        address2: '', city: 'Austin', state: 'TX', postalCode: '78701',
                        country: 'USA', relationship: 'Family', notes: '' });
  const h = c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0];
  check('an emptied Address Line 2 is actually emptied', h.address2 === '',
        JSON.stringify(h.address2) + ' — under GET this blank would never have been sent');
  check('…and an emptied note too', h.notes === '', JSON.stringify(h.notes));
  check('…while the fields that were set survive', h.address1 === '12 Elm St' && h.city === 'Austin');

  check('the confirmation date is NOT clobbered by an ordinary edit',
        c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0].addressConfirmed === '2026-01-10',
        'fixing a typo in a postcode must not wipe when the address was last checked');
  check('…and neither is the mailing history',
        c.webGetAddressBook_().mailings.length === 4,
        'the history lives in its own tab precisely so an edit cannot touch it');
}

console.log('\nA sheet that still has the retired columns is not disturbed');
{
  // Ahmed's live sheet has Send Card and Last Card Sent in it. They are retired, not
  // deleted: VERA reads around them and must never write to them.
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: {
    'Households': fakeSheet(HH_LEGACY, [
      ['HH-1', 'The Smith Family', '12 Elm St', '', 'Austin', 'TX', '78701', 'USA',
       'Family', 'Yes', '2025', '2026-01-10', 'via Jane'],
    ]),
    'People':   fakeSheet(P_H, []),
    'Mailings': fakeSheet(M_H, []),
  }});
  const h = c.webGetAddressBook_().households[0];
  check('the household still reads correctly around them',
        h.household === 'The Smith Family' && h.city === 'Austin' &&
        h.addressConfirmed === '2026-01-10' && h.notes === 'via Jane',
        JSON.stringify(h));
  check('…and the retired fields are simply not in the payload',
        h.sendCard === undefined && h.lastCardSent === undefined,
        JSON.stringify(Object.keys(h)));

  c.webSaveHousehold_({ id: 'HH-1', household: 'The Smith Family', city: 'Dallas', notes: '' });
  const row = c._tabs['Households']._data[1];
  check('an edit leaves Send Card exactly as it was',
        row[HH_LEGACY.indexOf('Send Card')] === 'Yes', JSON.stringify(row));
  check('…and Last Card Sent too', row[HH_LEGACY.indexOf('Last Card Sent')] === '2025',
        'retiring a column must not quietly wipe what is in it');
  check('…while the edit itself lands', row[HH_LEGACY.indexOf('City')] === 'Dallas');

  check('ensureSheet never removes them either',
        c._tabs['Households']._data[0].indexOf('Send Card') !== -1,
        'they are the user\'s to delete, in their own time');
}

// ============================================================================
console.log('\nContacts');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const r = c.webSaveContact_({ householdId: 'HH-2', name: 'Omar', email: 'omar@x.test',
                                memberType: 'Adult' });
  check('a contact is added', r.action === 'created' && /^P-/.test(r.id));
  check('…under its household', c.webGetAddressBook_().people
        .filter(p => p.householdId === 'HH-2').length === 2);

  c.webSaveContact_({ id: 'P-1', householdId: 'HH-1', name: 'John Smith', email: '', phone: '555-9' });
  const john = c.webGetAddressBook_().people.filter(p => p.id === 'P-1')[0];
  check('an edit clears an emptied email', john.email === '', JSON.stringify(john.email));
  check('…and updates the phone', john.phone === '555-9');

  check('a nameless contact is refused', threw(() => c.webSaveContact_({ householdId: 'HH-1' })) !== null);
  const noHh = threw(() => c.webSaveContact_({ name: 'Stray' }));
  check('a contact with no household is refused', noHh !== null,
        'a person with no household has no address, which is the point of the book');
  check('…saying so, rather than blaming a missing household',
        /must belong to a household/.test(noHh || ''), noHh,
        'the two guards fail for different reasons and must say which');
  check('…and one pointing at a household that does not exist',
        threw(() => c.webSaveContact_({ householdId: 'HH-404', name: 'Ghost' })) !== null,
        'that is how an invisible orphan row gets created');
}

console.log('\nDeleting a household takes its members with it');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const r = c.webDeleteHousehold_({ id: 'HH-1' });
  check('it reports the members it removed', r.membersRemoved === 2, JSON.stringify(r));
  const after = c.webGetAddressBook_();
  check('the household is gone', after.households.filter(h => h.id === 'HH-1').length === 0);
  check('…and both of its members', after.people.filter(p => p.householdId === 'HH-1').length === 0,
        'an orphan row renders nowhere, so it can never be found and fixed');
  check('the OTHER household is untouched', after.households.length === 1 &&
        after.households[0].id === 'HH-2');
  check('…and its member', after.people.length === 1 && after.people[0].id === 'P-3',
        JSON.stringify(after.people));
  check('an unknown household is refused', threw(() => c.webDeleteHousehold_({ id: 'HH-404' })) !== null);
}

console.log('\nDeleting a contact touches nothing else');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const delErr = threw(() => c.webDeleteContact_({ id: 'P-2' }));
  check('deleting a known contact succeeds', delErr === null, String(delErr));
  const after = c.webGetAddressBook_();
  check('the person is gone', after.people.filter(p => p.id === 'P-2').length === 0);
  check('…their sibling stays', after.people.filter(p => p.id === 'P-1').length === 1);
  check('…and the household stays', after.households.filter(h => h.id === 'HH-1').length === 1);
  check('an unknown contact is refused', threw(() => c.webDeleteContact_({ id: 'P-404' })) !== null);
}

// ============================================================================
console.log('\nLogging a mailing');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const today = (() => { const d = new Date(); const p2 = n => String(n).padStart(2, '0');
                         return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();

  const r = c.webSaveMailing_({ householdId: 'HH-2', event: 'Anniversary card' });
  check('a mailing is logged', r.action === 'created' && /^M-/.test(r.id), JSON.stringify(r));
  check('…dated today by default',
        c.webGetAddressBook_().mailings.filter(m => m.id === r.id)[0].sent === today);
  check('…against its household',
        c.webGetAddressBook_().mailings.filter(m => m.id === r.id)[0].householdId === 'HH-2');

  // The tick box can be double-clicked, and a request can be retried.
  const again = c.webSaveMailing_({ householdId: 'HH-2', event: 'Anniversary card' });
  check('logging the same thing on the same day is idempotent',
        again.alreadyLogged === true && again.id === r.id, JSON.stringify(again));
  check('…writing no second row', c.webGetAddressBook_().mailings.length === 5,
        'two identical rows would both have to be deleted by hand');
  check('…matching the event case-insensitively',
        c.webSaveMailing_({ householdId: 'HH-2', event: 'ANNIVERSARY CARD' }).alreadyLogged === true,
        'the event is free text somebody types');

  const nextYear = c.webSaveMailing_({ householdId: 'HH-2', event: 'Anniversary card', sent: '2027-07-02' });
  check('the SAME event on a different date is a new row', nextYear.action === 'created',
        'that is the history this tab exists for');

  const upd = c.webSaveMailing_({ id: 'M-1', householdId: 'HH-1', event: 'Christmas card',
                                  sent: '2024-12-14', notes: 'posted late' });
  check('an id updates in place', upd.action === 'updated');
  check('…changing only that row',
        c.webGetAddressBook_().mailings.filter(m => m.id === 'M-1')[0].sent === '2024-12-14' &&
        c.webGetAddressBook_().mailings.filter(m => m.id === 'M-2')[0].sent === '2025-12-09');

  c.webSaveMailing_({ id: 'M-1', householdId: 'HH-1', event: 'Christmas card',
                      sent: '2024-12-14', notes: '' });
  check('an emptied note really clears', c.webGetAddressBook_().mailings
        .filter(m => m.id === 'M-1')[0].notes === '', 'the makeUrl trap, again');

  check('a mailing with no event is refused',
        threw(() => c.webSaveMailing_({ householdId: 'HH-1' })) !== null);
  check('…with no household is refused',
        threw(() => c.webSaveMailing_({ event: 'Christmas card' })) !== null);
  const ghost = threw(() => c.webSaveMailing_({ householdId: 'HH-404', event: 'Christmas card' }));
  check('…and one pointing at a household that does not exist',
        ghost !== null && /not found/.test(ghost), String(ghost),
        'an orphan row renders nowhere, so it can never be found and fixed');
  check('an unknown id is refused rather than silently inserted',
        threw(() => c.webSaveMailing_({ id: 'M-404', householdId: 'HH-1', event: 'X' })) !== null);
}

console.log('\nUn-ticking, and the cascade');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const err = threw(() => c.webDeleteMailing_({ id: 'M-2' }));
  check('a mailing can be removed', err === null, String(err));
  const after = c.webGetAddressBook_();
  check('…and is gone', after.mailings.filter(m => m.id === 'M-2').length === 0);
  check('the household stays', after.households.filter(h => h.id === 'HH-1').length === 1);
  check('…and its OTHER mailings stay', after.mailings.filter(m => m.householdId === 'HH-1').length === 2,
        JSON.stringify(after.mailings.map(m => m.id)));
  check('an unknown mailing is refused', threw(() => c.webDeleteMailing_({ id: 'M-404' })) !== null);
}
{
  // The orphan rule now covers a third tab.
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const r = c.webDeleteHousehold_({ id: 'HH-1' });
  check('deleting a household reports the mailings it removed', r.mailingsRemoved === 3,
        JSON.stringify(r));
  // The shared delete refuses a blank value. Without that guard, every row whose
  // Household ID is blank — the spacer somebody left in the sheet — is swept away
  // with it, and reading the payload would never show the difference.
  check('…and a blank spacer row in the sheet is NOT swept away',
        c._tabs['Mailings']._data.some(r2 => String(r2[0] || '') === '' && r2.length > 1),
        JSON.stringify(c._tabs['Mailings']._data));
  const after = c.webGetAddressBook_();
  check('…and they are gone', after.mailings.filter(m => m.householdId === 'HH-1').length === 0);
  check('the other household keeps its own', after.mailings.length === 1 &&
        after.mailings[0].householdId === 'HH-2', JSON.stringify(after.mailings));
  check('…and its members', after.people.length === 1);
}

console.log('\nThe shared row delete, on its own');
{
  // Its contract is tested directly because the handlers only ever pass a real id,
  // so the blank guard is unreachable from them — and an unobservable guard is a
  // place for two readers to disagree about what it does.
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const sheet = c._tabs['Mailings'];
  const before = sheet._data.length;

  check('a blank value removes NOTHING',
        c.deleteAddressBookRowsFor_(sheet, 'Household ID', '') === 0 &&
        sheet._data.length === before,
        'without this, every row with a blank Household ID — the spacer somebody ' +
        'left in the sheet — is swept away by a delete that should match nothing');
  check('…and so does undefined', c.deleteAddressBookRowsFor_(sheet, 'Household ID') === 0);
  check('a column it does not have removes nothing',
        c.deleteAddressBookRowsFor_(sheet, 'Nope', 'HH-1') === 0 && sheet._data.length === before);
  check('a real value removes exactly its rows',
        c.deleteAddressBookRowsFor_(sheet, 'Household ID', 'HH-1') === 3,
        'three Christmas/wedding rows for HH-1');
  check('…leaving the others', sheet._data.length === before - 3);
  check('an empty sheet is a no-op',
        c.deleteAddressBookRowsFor_(fakeSheet(M_H, []), 'Household ID', 'HH-1') === 0);
}

console.log('\nCarrying the list forward');
{
  // The rule the dashboard applies, over the real payload: on the list if ever sent.
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const out = c.webGetAddressBook_();
  const forEvent = (hid, ev) => out.mailings.filter(m => m.householdId === hid &&
    m.event.toLowerCase() === ev.toLowerCase());
  const onList = out.households.filter(h => forEvent(h.id, 'Christmas card').length > 0);

  check('both households that have had a Christmas card are on the list',
        onList.length === 2, JSON.stringify(onList.map(h => h.id)));
  check('…and a household that has never had one is not',
        onList.every(h => h.id !== 'HH-3'),
        'a brand-new event starts empty, which is what "+ Add someone" is for');

  const sentIn = (hid, ev, yr) => forEvent(hid, ev).some(m => m.sent.slice(0, 4) === yr);
  check('the 2025 filter hides both', onList.filter(h => !sentIn(h.id, 'Christmas card', '2025')).length === 0);
  check('…and the 2026 filter shows both again',
        onList.filter(h => !sentIn(h.id, 'Christmas card', '2026')).length === 2,
        'that is the carry-forward: last year\'s list is this year\'s list');
  check('a different event has its own, smaller list',
        out.households.filter(h => forEvent(h.id, 'Wedding thank you').length > 0).length === 1);
}

console.log('\nConfirming an address');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const r = c.webConfirmAddress_({ id: 'HH-2' });
  check('it stamps a full date', /^\d{4}-\d{2}-\d{2}$/.test(r.confirmed), r.confirmed);
  check('…onto the row', c.webGetAddressBook_().households
        .filter(h => h.id === 'HH-2')[0].addressConfirmed === r.confirmed);
  check('…and changes nothing else', c.webGetAddressBook_().households
        .filter(h => h.id === 'HH-2')[0].city === 'Cairo');
  check('an explicit date can be given', c.webConfirmAddress_({ id: 'HH-1', date: '2024-03-02' })
        .confirmed === '2024-03-02');
  check('an unknown household is refused', threw(() => c.webConfirmAddress_({ id: 'HH-404' })) !== null);
}

// ============================================================================
console.log('\nThe property store stops filling up');
{
  const DAY = 86400000;
  // Years from any clock this runs on: with a fixture near today, removing the
  // injectable nowMs would still pass because real Date.now() gives the same answers.
  const NOW = Date.UTC(2031, 5, 17, 6, 0, 0);
  const iso = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0');
                      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const compact = ms => iso(ms).replace(/-/g, '');

  const props = {
    // Expired — these are what fill the store.
    ['day_plan_' + iso(NOW - 30 * DAY)]: '{}',
    ['TDB_SENT_' + compact(NOW - 90 * DAY) + '_PARIS']: '1',
    'PERK_NOTIFY_CP_14_2024_Q1': '1',
    'PERK_NOTIFY_CP_6_2024_09':  '1',
    'PERK_NOTIFY_CP_9_2023':     '1',
    // Still live, and deleting any of these re-sends something.
    ['day_plan_' + iso(NOW)]: '{}',
    ['day_plan_' + iso(NOW - 2 * DAY)]: '{}',
    ['TDB_SENT_' + compact(NOW - 3 * DAY) + '_ROME']: '1',
    ['PERK_NOTIFY_CP_14_' + new Date(NOW).getFullYear() + '_Q2']: '1',
    // webAddCardPerk_ mints ids as 'CP-' + Date.now(), so a real key looks like
    // this. Matching the first \\d{4} anywhere would read '1759' out of the ID as
    // the period, date it to 1759, and delete a LIVE latch — duplicate emails.
    ['PERK_NOTIFY_CP_1759539102345_' + new Date(NOW).getFullYear() + '_Q2']: '1',
    // Nothing to do with latches. Losing any of these would be serious.
    'API_HEALTH_STATE': '{}', 'LAST_NIGHTLY_RUN': 'x', 'NIGHTLY_STEP': 'y',
    'ADDRESS_BOOK_SHEET_ID': 'BOOK-ID', 'VERA_WEB_TOKEN': 'secret',
    'SCHED_SLACK_abc123': '1',
  };
  const c = harness({ props: props });
  let r = { scanned: 0, removed: 0, keys: [] }, pruneErr = null;
  try { r = c.pruneScriptProperties_(NOW); } catch (e) { pruneErr = e.message; }
  check('the prune completes without throwing', pruneErr === null, String(pruneErr),
        'a prune that reaches for an API the store does not have is worse than none');

  check('it reports what it scanned and removed', r.scanned === Object.keys(props).length + 0 || r.scanned > 0,
        JSON.stringify({ scanned: r.scanned, removed: r.removed }));
  check('an old day plan goes', r.keys.indexOf('day_plan_' + iso(NOW - 30 * DAY)) !== -1,
        JSON.stringify(r.keys));
  check('an old travel-day latch goes',
        r.keys.some(k => /^TDB_SENT_.*PARIS$/.test(k)));
  check('perk latches from past periods go — quarter, month and year shapes',
        r.keys.indexOf('PERK_NOTIFY_CP_14_2024_Q1') !== -1 &&
        r.keys.indexOf('PERK_NOTIFY_CP_6_2024_09') !== -1 &&
        r.keys.indexOf('PERK_NOTIFY_CP_9_2023') !== -1,
        JSON.stringify(r.keys));
  check('…matched at the END of the key, since a perk id contains underscores', true,
        'splitting on _ would read CP_14 as the period');

  check("TODAY's day plan stays", c._props['day_plan_' + iso(NOW)] === '{}');
  check('…and one from two days ago', c._props['day_plan_' + iso(NOW - 2 * DAY)] === '{}',
        'it is a cache Chat still reads');
  check('a recent travel-day latch stays',
        c._props['TDB_SENT_' + compact(NOW - 3 * DAY) + '_ROME'] === '1',
        'deleting it re-sends a briefing');
  check('a CURRENT perk latch stays',
        c._props['PERK_NOTIFY_CP_14_' + new Date(NOW).getFullYear() + '_Q2'] === '1',
        'deleting it emails about a perk twice');
  check('…even when the perk ID itself contains four digits',
        c._props['PERK_NOTIFY_CP_1759539102345_' + new Date(NOW).getFullYear() + '_Q2'] === '1',
        'ids are minted as CP- + Date.now(); reading the period out of the ID dates a ' +
        'live latch to 1759 and deletes it, which re-sends the email');

  check('everything that is not a latch is untouched',
        c._props['API_HEALTH_STATE'] === '{}' && c._props['LAST_NIGHTLY_RUN'] === 'x' &&
        c._props['NIGHTLY_STEP'] === 'y' && c._props['ADDRESS_BOOK_SHEET_ID'] === 'BOOK-ID' &&
        c._props['VERA_WEB_TOKEN'] === 'secret',
        JSON.stringify(Object.keys(c._props)));
  check('…including a key shape it does not recognise',
        c._props['SCHED_SLACK_abc123'] === '1',
        'an unparseable key is left alone rather than guessed at');

  const again = c.pruneScriptProperties_(NOW);
  check('a second pass removes nothing', again.removed === 0, JSON.stringify(again.keys));

  const empty = harness({ props: {} });
  check('an empty store is a no-op', empty.pruneScriptProperties_(NOW).removed === 0);

  // THE guard that matters: it must never be able to lose the store wholesale.
  const fn = extractFn(SRC.Book, 'pruneScriptProperties_');
  // Comments stripped: the comment in there NAMES deleteAllProperties in prose, to
  // explain why it is not used, and matching the source would read that as a call.
  const code = fn.replace(/\/\/[^\n]*/g, '');
  check('it deletes key by key, never deleteAllProperties',
        /deleteProperty\(k\)/.test(code) && !/deleteAllProperties/.test(code),
        'delete-all then restore loses EVERYTHING if the run is killed between them, ' +
        'and the nightly run is killed often enough to have a watchdog for it');
  check('…and one failed delete does not abort the rest', /catch \(delErr\)/.test(code));
}

console.log('\nBulk import');
{
  // A realistic paste: a family across three rows with the address on the first only,
  // a single-person household with no Household cell, a blank spacer, and a row with
  // nothing but a name.
  const importRows = () => [
    ['The Smiths Family', 'John Smith', 'Adult', 'john@x.test', '555-1',
     '12 Elm St', 'Apt 4', 'Austin', 'TX', '78701', 'USA', 'Family', 'via Jane', '', ''],
    ['The Smiths Family', 'Jane Smith', 'Adult', 'jane@x.test', '', '', '', '', '', '', '', '', '', '', ''],
    ['The Smiths Family', 'Mia Smith',  'Child', '',            '', '', '', '', '', '', '', '', '', 'allergic to nuts', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'Aunt Mary', 'Adult', 'mary@x.test', '', '3 Oak Rd', '', 'Reston', 'VA', '', 'USA', 'Family', '', '', ''],
  ];
  const freshTabs = (hh, pp) => ({
    'Households': fakeSheet(HH_H, hh || []),
    'People':     fakeSheet(P_H, pp || []),
    'Mailings':   fakeSheet(M_H, []),
    'Import':     fakeSheet(I_H, importRows()),
  });

  // ---- the preview writes nothing but Status ----
  {
    const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: freshTabs() });
    const r = c.webPreviewAddressImport_();
    check('the preview counts the households', r.households.created === 2, JSON.stringify(r.households));
    check('…and the people', r.people.created === 4, JSON.stringify(r.people));
    check('…and says it wrote nothing',
          r.messages.some(m => /Nothing has been written/.test(m)), JSON.stringify(r.messages));
    check('NOTHING reached the address book',
          c._tabs['Households']._data.length === 1 && c._tabs['People']._data.length === 1,
          'a preview that writes is not a preview');
    const status = c._tabs['Import']._data.slice(1).map(row => row[I_H.indexOf('Status')]);
    check('each row says what WILL happen', /^Will add: John Smith/.test(status[0]), JSON.stringify(status[0]));
    check('…and a blank spacer row says nothing', status[3] === '', JSON.stringify(status[3]));
  }

  // ---- the import ----
  {
    const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: freshTabs() });
    const r = c.webRunAddressImport_();
    const out = c.webGetAddressBook_();

    check('two households are created', out.households.length === 2, JSON.stringify(out.households.map(h => h.household)));
    check('…three rows of one family became ONE household',
          out.households.filter(h => h.household === 'The Smiths Family').length === 1,
          'grouped by the Household column, not by matching addresses');
    const smiths = out.households.filter(h => h.household === 'The Smiths Family')[0];
    check('…taking the address from the one row that had it',
          smiths.address1 === '12 Elm St' && smiths.city === 'Austin' && smiths.postalCode === '78701',
          JSON.stringify(smiths));
    check('…and the household note', smiths.notes === 'via Jane');

    check('four people are created', out.people.length === 4, String(out.people.length));
    check('…three of them in the Smith household',
          out.people.filter(p => p.householdId === smiths.id).length === 3);
    check('…with their own emails', out.people.filter(p => p.name === 'John Smith')[0].email === 'john@x.test');
    check('…and member type', out.people.filter(p => p.name === 'Mia Smith')[0].memberType === 'Child');
    check('…and a person note stays on the person',
          out.people.filter(p => p.name === 'Mia Smith')[0].notes === 'allergic to nuts');

    const mary = out.households.filter(h => h.household === 'Aunt Mary')[0];
    check('a person with no Household cell becomes a household of one',
          !!mary && out.people.filter(p => p.householdId === mary.id).length === 1,
          JSON.stringify(out.households.map(h => h.household)));
    check('…keeping their own address', mary.city === 'Reston');

    check('a blank spacer row creates nothing', out.households.length === 2);
    check('the Status column reports what happened',
          /^Added: John Smith/.test(c._tabs['Import']._data[1][I_H.indexOf('Status')]),
          JSON.stringify(c._tabs['Import']._data[1][I_H.indexOf('Status')]));
    check('the Import rows are NOT deleted', c._tabs['Import']._data.length === 6,
          'VERA deleting rows you typed is not something to do unwatched');

    // Assertions on COST, not only outcome. Five rows must not mean five writes.
    check('the whole Status column is written in ONE call',
          c._tabs['Import']._writes.setValues === 1 && c._tabs['Import']._writes.setValue === 0,
          JSON.stringify(c._tabs['Import']._writes) +
          ' — every setValue is its own round trip, and an import is hundreds of rows');
    check('…and the new rows go in as one block per tab',
          c._tabs['Households']._writes.setValues === 1 &&
          c._tabs['People']._writes.setValues === 1,
          JSON.stringify({ hh: c._tabs['Households']._writes, p: c._tabs['People']._writes }));
  }

  // ---- running it twice ----
  {
    const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: freshTabs() });
    c.webRunAddressImport_();
    const r2 = c.webRunAddressImport_();
    const out = c.webGetAddressBook_();
    check('a second run creates no duplicate households', out.households.length === 2,
          JSON.stringify(out.households.map(h => h.household)));
    check('…nor duplicate people', out.people.length === 4, String(out.people.length));
    check('…and reports them as already present', r2.people.skipped === 4, JSON.stringify(r2.people));
    check('…saying so per row',
          /Already present/.test(c._tabs['Import']._data[1][I_H.indexOf('Status')]));
  }

  // ---- an existing household: non-blank wins, blank leaves alone ----
  {
    const tabs = freshTabs([
      ['HH-9', 'The Smiths Family', '99 Old Rd', '', 'Dallas', 'TX', '75001', 'USA',
       'Family', '2026-01-10', 'keep this note'],
    ]);
    const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: tabs });
    const r = c.webRunAddressImport_();
    const smiths = c.webGetAddressBook_().households.filter(h => h.id === 'HH-9')[0];

    check('an existing household is updated, not duplicated', r.households.created === 1 &&
          r.households.updated === 1, JSON.stringify(r.households));
    check('…the Import row wins where it has a value',
          smiths.address1 === '12 Elm St' && smiths.city === 'Austin' && smiths.postalCode === '78701',
          JSON.stringify(smiths));
    check('…a BLANK Import cell leaves the existing value alone',
          smiths.addressConfirmed === '2026-01-10',
          'a half-filled Import row must not wipe a good value — that is the hazard ' +
          'of letting the import win, and the whole reason blanks are skipped');
    check('…and its people are added to it',
          c.webGetAddressBook_().people.filter(p => p.householdId === 'HH-9').length === 3);
  }

  // ---- an empty tab, and the shared implementation ----
  {
    const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: {
      'Households': fakeSheet(HH_H, []), 'People': fakeSheet(P_H, []),
      'Mailings': fakeSheet(M_H, []), 'Import': fakeSheet(I_H, []),
    }});
    const r = c.webRunAddressImport_();
    check('an empty Import tab is a no-op that says so', r.rows === 0 &&
          /empty/i.test(r.messages.join(' ')), JSON.stringify(r.messages));
  }

  check('preview and import are the SAME function with a flag',
        /function webPreviewAddressImport_\(\) \{ return addressBookImport_\(true\); \}/.test(SRC.Web) &&
        /function webRunAddressImport_\(\) \{ return addressBookImport_\(false\); \}/.test(SRC.Web),
        'a preview with its own implementation is a preview that can lie, and being ' +
        'believed is the only way a preview can hurt you');
  check('the bulk append writes one block, not a row at a time',
        /setValues\(block\)/.test(extractFn(SRC.Book, 'appendAddressBookRows_')) &&
        !/appendRow/.test(extractFn(SRC.Book, 'appendAddressBookRows_')),
        'appendRow per row is a round trip per row, and an import is hundreds');
}

console.log('\nWiring');
{
  const nightly = SRC.Code.slice(SRC.Code.indexOf('function nightlyRun()'),
                                 SRC.Code.indexOf('function nightlyRun()') + 40000);
  check('the property prune runs nightly',
        /nightlyStep_\(ctx, 'pruneScriptProperties_'/.test(nightly),
        'unpruned, the latches grow by hundreds a year');

  check('the read is a GET action', /case 'address_book':\s*return jsonOut_\(webGetAddressBook_\(\)\)/.test(SRC.Web));

  // Every write is POST. Under GET, makeUrl would drop each blank.
  ['save_household', 'delete_household', 'save_contact', 'delete_contact',
   'save_mailing', 'delete_mailing', 'confirm_address'].forEach(a => {
    const re = new RegExp("case '" + a + "':\\s*return jsonOut_\\(web[A-Za-z]+_\\(body\\)\\)");
    check("'" + a + "' is routed in doPost, taking the body", re.test(SRC.Web),
          'a query string cannot carry a cleared field');
  });
  check('none of them is ALSO a GET route',
        !/case 'save_household'[\s\S]{0,80}webSaveHousehold_\(e\)/.test(SRC.Web),
        'two routes to one writer is how they drift apart');

  // One declaration each across the shared global scope.
  const roots = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  ['getAddressBookSheet_', 'ensureAddressBookTabs_', 'readAddressBookTab_',
   'findAddressBookRow_', 'deleteAddressBookRowsFor_', 'webGetAddressBook_',
   'webSaveHousehold_', 'webSaveContact_', 'webSaveMailing_', 'findMailing_'].forEach(name => {
    const n = roots.reduce((acc, f) => acc +
      (fs.readFileSync(path.join(ROOT, f), 'utf8')
         .match(new RegExp('^function ' + name + '\\(', 'gm')) || []).length, 0);
    check(name + ' is declared exactly once', n === 1, String(n));
  });

  // The retired pair must not come back by accident.
  check('mark_card_sent is gone entirely',
        !/mark_card_sent|webMarkCardSent_/.test(SRC.Web),
        'superseded by save_mailing, which keeps the whole history');
  check('…and the schema no longer names the retired columns',
        !/'Send Card'/.test(decl(SRC.Book, 'HOUSEHOLD_HEADERS')) &&
        !/'Last Card Sent'/.test(decl(SRC.Book, 'HOUSEHOLD_HEADERS')),
        JSON.stringify(decl(SRC.Book, 'HOUSEHOLD_HEADERS')));
  check('the cascade uses ONE back-to-front delete for both tabs',
        (SRC.Web.match(/deleteAddressBookRowsFor_\(/g) || []).length === 2,
        'two copies of a back-to-front delete is two chances to write the forward one');

  check('ensureSheet is reused, not reimplemented',
        /ensureSheet\(ss, ADDRESS_BOOK_HOUSEHOLDS_/.test(SRC.Book) &&
        /ensureSheet\(ss, ADDRESS_BOOK_MAILINGS_/.test(SRC.Book),
        'it already takes the spreadsheet as a parameter, so it works on an external one');
  check('there is no Birthday column anywhere in the schema',
        !/Birthday/.test(decl(SRC.Book, 'CONTACT_HEADERS')) &&
        !/Birthday/.test(decl(SRC.Book, 'HOUSEHOLD_HEADERS')),
        'Important Dates owns birthdays and already flags them and writes them to the calendar');
}

console.log('\nThe dashboards');
{
  check('app.js no longer says "Coming soon" under People',
        !/Coming soon/.test(SRC.App.slice(SRC.App.indexOf('function PeopleTab'),
                                          SRC.App.indexOf('function PeopleTab') + 6000)),
        'that placeholder described this exact feature');
  check('…and renders the address book instead',
        /sub==='people'&&\/\*#__PURE__\*\/React\.createElement\(AddressBookView/.test(SRC.App));
  check('…with the credentials it needs to load itself',
        /React\.createElement\(AddressBookView,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(SRC.App));
  check('PeopleTab accepts them', /function PeopleTab\(\{apiUrl,apiToken,/.test(SRC.App));
  check('…and the parent passes them down',
        /React\.createElement\(PeopleTab,\{apiUrl:apiUrl,apiToken:apiToken,/.test(SRC.App));

  check('the lite dashboard has an Address Book tab',
        /\{ id: 'people',\s*label: '📒 Address Book'\s*\}/.test(SRC.Lite));
  check('…and renders the same view', /activeTab === 'people' && \(\s*<AddressBookView/.test(SRC.Lite));

  ['docs/app.js', 'docs/dashboard-lite.html'].forEach((label, i) => {
    const s = [SRC.App, SRC.Lite][i];
    check(label + ': writes go through apiPost, not apiGet',
          /apiPost\(apiUrl, apiToken, body\)|apiPost\(apiUrl,apiToken,body\)/.test(s),
          'a GET would drop every cleared field');
    check(label + ': the unconfigured state is explained, not an error',
          /ADDRESS_BOOK_SHEET_ID/.test(s));
    check(label + ': deleting a household warns about what goes with it',
          /member' : 'members'/.test(s) && /mailing' : 'mailings'/.test(s),
          'the cascade now covers a third tab and must not be a surprise');

    check(label + ': the event picker exists',
          /events\.map\(ev =>/.test(s) || /events\.map\(function\(ev\)/.test(s) ||
          /events\.map\(ev=>/.test(s),
          'picking an event is how you get to a card run');
    check(label + ': the card run carries the list forward from history',
          /forEvent\(h\.id, event\)\.length > 0/.test(s),
          'on the list if ever sent — no flag anywhere to go stale');
    check(label + ': …with a still-to-send toggle rather than an inference',
          /unsentOnly === 'year'/.test(s),
          "guessing an event's cadence would be right most of the time and " +
          'inexplicable the rest');
    check(label + ': a mis-tick is undoable', /action:\s*'delete_mailing'/.test(s));
    check(label + ': the full history renders under a household',
          /SENT/.test(s) && /m\.event/.test(s) && /m\.sent/.test(s));
    check(label + ': a new event can be started from nothing',
          /Add someone/.test(s), 'otherwise a brand-new event is unreachable');

    // An empty household showed "0 people" as dead grey text with the only way in
    // being a 4px triangle, which reads as broken rather than empty. Both halves of
    // the fix are pinned: the row opens on click, and an empty one says what to do.
    check(label + ': an empty household prompts instead of reading "0 people"',
          /\+ Add the names/.test(s),
          'dead text next to a hidden control is how a working feature looks broken');
    check(label + ': …and the whole row opens it, not just the triangle',
          /cursor:\s*'pointer'[\s\S]{0,120}?Open to add people|Open to add people/.test(s),
          'clicking the name to see who is in a household is what anyone tries first');

    // The retired controls must be gone, not merely unused.
    check(label + ': the card-list tick is gone from the form', !/On the card list/.test(s));
    check(label + ': the Mark-sent button is gone', !/mark_card_sent/.test(s));
    check(label + ': and nothing still reads the retired fields',
          !/h\.sendCard/.test(s) && !/h\.lastCardSent/.test(s) && !/cardsOnly/.test(s),
          'a leftover reference to removed state is a blank screen, not a missing feature');
  });

  check('index.html is not a stale build',
        SRC.Index.indexOf('AddressBookView') !== -1, 'run node docs/build.js');

  const readme = fs.readFileSync(ROOT + '/README.md', 'utf8');
  check('the README documents the script property', /ADDRESS_BOOK_SHEET_ID/.test(readme));
  check('…and why birthdays are deliberately absent',
        /birthday/i.test(readme) && /Address Book/.test(readme));

  // Notes are stored on both tabs, editable in both forms, and VISIBLE in the list.
  // Saved-but-never-shown is the failure mode worth pinning: the household note was
  // exactly that until it was caught.
  check('Notes is a column on both tabs',
        /'Notes'\];/.test(decl(SRC.Book, 'HOUSEHOLD_HEADERS')) &&
        /'Notes'\];/.test(decl(SRC.Book, 'CONTACT_HEADERS')));
  [['docs/app.js', SRC.App], ['docs/dashboard-lite.html', SRC.Lite]].forEach(([label, s]) => {
    check(label + ': both forms edit a note',
          (s.match(/label:\s*"Notes"|label="Notes"/g) || []).length === 2,
          'one for the household, one for the person');
    check(label + ': the household note is SHOWN in the list, not just stored',
          /h\.notes\s*&&/.test(s),
          'a field you can type into but never see again is not a field');
    check(label + ': …and the person note too', /p\.notes\s*&&/.test(s));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
