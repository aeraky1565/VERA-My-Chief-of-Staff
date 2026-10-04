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
              'Postal Code', 'Country', 'Relationship', 'Send Card', 'Last Card Sent',
              'Address Confirmed', 'Notes'];
const P_H  = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Member Type', 'Notes'];

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
      setValue: v => { while ((data[r - 1] || []).length < c) data[r - 1].push(''); data[r - 1][c - 1] = v; },
      setValues: vals => { vals.forEach((row, i) => { data[r - 1 + i] = row.slice(); }); },
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
    }) },
    SpreadsheetApp: { openById: id => {
      if (o.openThrows) throw new Error(o.openThrows);
      if (id !== 'BOOK-ID') throw new Error('unexpected id: ' + id);
      return ss;
    } },
    recordApiHealth_: (source, ok, detail, code) => health.push({ source, ok, detail, code }),
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
    extractFn(SRC.Code, 'ensureSheet'),
    extractFn(SRC.Book, 'getAddressBookSheet_'),
    extractFn(SRC.Book, 'ensureAddressBookTabs_'),
    extractFn(SRC.Book, 'addressBookCols_'),
    extractFn(SRC.Book, 'readAddressBookTab_'),
    extractFn(SRC.Book, 'findAddressBookRow_'),
    extractFn(SRC.Book, 'writeAddressBookRow_'),
    extractFn(SRC.Book, 'appendAddressBookRow_'),
    extractFn(SRC.Book, 'addressBookYesNo_'),
    extractFn(SRC.Book, 'newAddressBookId_'),
    extractFn(SRC.Web, 'webGetAddressBook_'),
    extractFn(SRC.Web, 'addressBookForWrite_'),
    extractFn(SRC.Web, 'webSaveHousehold_'),
    extractFn(SRC.Web, 'webDeleteHousehold_'),
    extractFn(SRC.Web, 'webSaveContact_'),
    extractFn(SRC.Web, 'webDeleteContact_'),
    extractFn(SRC.Web, 'webMarkCardSent_'),
    extractFn(SRC.Web, 'webConfirmAddress_'),
  ].join('\n'), ctx);
  return ctx;
}

const threw = fn => { try { fn(); return null; } catch (e) { return e.message; } };
const seeded = () => ({
  'Households': fakeSheet(HH_H, [
    ['HH-1', 'The Smith Family', '12 Elm St', 'Apt 4', 'Austin', 'TX', '78701', 'USA',
     'Family', 'Yes', '2025', '2026-01-10', 'via Jane'],
    ['HH-2', 'Dana & Omar', '3 Nile Rd', '', 'Cairo', '', '', 'Egypt', 'Friends', '', '', '', ''],
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

  check('both tabs are created', c._created.indexOf('Households') !== -1 &&
        c._created.indexOf('People') !== -1, JSON.stringify(c._created));
  const hdrOf = t => ((c._tabs[t] && c._tabs[t]._data[0]) || []).join('|');
  check('…with the full headers', hdrOf('Households') === HH_H.join('|'), hdrOf('Households'));
  check('…and the contact headers', hdrOf('People') === P_H.join('|'), hdrOf('People'));

  check('the pre-existing tab is left EXACTLY as it was',
        his._data.length === 2 && his._data[1][0] === 'Grandma' && his._data[0][0] === 'Name',
        JSON.stringify(his._data));
  check('…and is not deleted', c._tabs["Ahmed's list"] === his,
        'his data is the whole reason this is non-destructive');

  const before = JSON.stringify(c._tabs['Households']._data);
  c.webGetAddressBook_();
  check('a second call creates nothing new', c._created.length === 2, JSON.stringify(c._created));
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
  check('Send Card reads as a boolean for the UI', out.households[0].sendCard === true &&
        out.households[1].sendCard === false);
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
                 'State', 'Postal Code', 'Country', 'Relationship', 'Send Card',
                 'Last Card Sent', 'Address Confirmed', 'Notes'];
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: {
    'Households': fakeSheet(moved, [
      ['HH-1', 'The Smith Family', 'Dear John & Jane', '12 Elm St', '', 'Austin', 'TX',
       '78701', 'USA', 'Family', 'Yes', '2025', '2026-01-10', 'note'],
    ]),
    'People': fakeSheet(P_H, []),
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
                                  country: 'USA', relationship: 'Friends', sendCard: true });
  check('no id means insert', r.action === 'created' && /^HH-/.test(r.id), JSON.stringify(r));
  check('…appended to the tab', c._tabs['Households']._data.length === 4);
  const added = c.webGetAddressBook_().households.filter(h => h.id === r.id)[0];
  check('…with its fields', added.household === 'The Patels' && added.city === 'Reston');
  check('…and Send Card as the literal "Yes"',
        c._tabs['Households']._data[3][HH_H.indexOf('Send Card')] === 'Yes',
        'a boolean TRUE reads as unset to every other reader in this codebase');

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
                        country: 'USA', relationship: 'Family', sendCard: true, notes: '' });
  const h = c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0];
  check('an emptied Address Line 2 is actually emptied', h.address2 === '',
        JSON.stringify(h.address2) + ' — under GET this blank would never have been sent');
  check('…and an emptied note too', h.notes === '', JSON.stringify(h.notes));
  check('…while the fields that were set survive', h.address1 === '12 Elm St' && h.city === 'Austin');

  c.webSaveHousehold_({ id: 'HH-1', household: 'The Smith Family', sendCard: false });
  check('un-ticking the card list really clears it',
        c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0].sendCard === false,
        'this is the exact shape of the Autopay bug');

  check('…but the card history is NOT clobbered by an ordinary edit',
        c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0].lastCardSent === '2025',
        'fixing a typo in a postcode must not wipe what you know about past cards');
  check('…nor the confirmation date',
        c.webGetAddressBook_().households.filter(x => x.id === 'HH-1')[0].addressConfirmed === '2026-01-10');
}

console.log('\nSend Card is the literal "Yes"');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  check('true becomes Yes',      c.addressBookYesNo_(true) === 'Yes');
  check("'yes' becomes Yes",     c.addressBookYesNo_('yes') === 'Yes');
  check("'YES' becomes Yes",     c.addressBookYesNo_('YES') === 'Yes');
  check('false becomes blank',   c.addressBookYesNo_(false) === '');
  check('undefined becomes blank', c.addressBookYesNo_(undefined) === '');
  check("'no' becomes blank",    c.addressBookYesNo_('no') === '');
  check('it never yields a boolean',
        typeof c.addressBookYesNo_(true) === 'string' && typeof c.addressBookYesNo_(false) === 'string');
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
console.log('\nThe card run');
{
  const c = harness({ props: { ADDRESS_BOOK_SHEET_ID: 'BOOK-ID' }, tabs: seeded() });
  const thisYear = String(new Date().getFullYear());

  const r = c.webMarkCardSent_({ id: 'HH-2' });
  check('it stamps the current year', r.year === thisYear && r.alreadyMarked === false,
        JSON.stringify(r));
  check('…onto the row', c.webGetAddressBook_().households
        .filter(h => h.id === 'HH-2')[0].lastCardSent === thisYear);

  const again = c.webMarkCardSent_({ id: 'HH-2' });
  check('marking twice in one year is a no-op', again.alreadyMarked === true,
        'the second click of an idempotent button must write nothing');

  const back = c.webMarkCardSent_({ id: 'HH-1', year: '2019' });
  check('an explicit year can be recorded', back.year === '2019' &&
        c.webGetAddressBook_().households.filter(h => h.id === 'HH-1')[0].lastCardSent === '2019',
        'you might be filling in last year after the fact');

  check('an unknown household is refused', threw(() => c.webMarkCardSent_({ id: 'HH-404' })) !== null);
  check('a blank id is refused', threw(() => c.webMarkCardSent_({})) !== null);
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
console.log('\nWiring');
{
  check('the read is a GET action', /case 'address_book':\s*return jsonOut_\(webGetAddressBook_\(\)\)/.test(SRC.Web));

  // Every write is POST. Under GET, makeUrl would drop each blank.
  ['save_household', 'delete_household', 'save_contact', 'delete_contact',
   'mark_card_sent', 'confirm_address'].forEach(a => {
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
   'findAddressBookRow_', 'webGetAddressBook_', 'webSaveHousehold_', 'webSaveContact_',
   'addressBookYesNo_'].forEach(name => {
    const n = roots.reduce((acc, f) => acc +
      (fs.readFileSync(path.join(ROOT, f), 'utf8')
         .match(new RegExp('^function ' + name + '\\(', 'gm')) || []).length, 0);
    check(name + ' is declared exactly once', n === 1, String(n));
  });

  check('ensureSheet is reused, not reimplemented',
        /ensureSheet\(ss, ADDRESS_BOOK_HOUSEHOLDS_/.test(SRC.Book),
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
    check(label + ': deleting a household warns about its members',
          /members'\)|member' : 'members'/.test(s), 'the cascade must not be a surprise');
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
