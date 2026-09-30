// Marking a card perk used.
//
// The `Last Used` column is overloaded: it is BOTH the used flag and the period
// stamp, holding '2026-08' / '2026-Q3' / '2026-H2' / '2026'. That design is why
// a perk resets for free — the stored key simply stops matching next period —
// and it is also why the two things most worth testing are (a) that a quarterly
// perk gets the QUARTER key rather than the month key, and (b) that marking is
// idempotent, since the only pre-existing writer was a toggle whose second call
// un-marks.
//
// The REAL functions, brace-matched into a vm over a fake sheet.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const COD  = fs.readFileSync(ROOT + '/Code.js',   'utf8');
const CHT  = fs.readFileSync(ROOT + '/Chat.js',   'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// ---- the date -------------------------------------------------------------
// 2026-08-15 deliberately: the month key (2026-08) differs from the quarter key
// (2026-Q3) AND the month end (2026-08-31) differs from the quarter end
// (2026-09-30). In September both ends collapse to Sep 30 and the quarterly
// assertions would go green for the wrong reason.
const NOW = new Date('2026-08-15T12:00:00Z');
const MONTH_KEY = '2026-08', QUARTER_KEY = '2026-Q3';

const HDR = (function() {
  const m = /^const CARD_PERK_HEADERS\s*=\s*(\[[^\]]*\])/m.exec(COD);
  if (!m) throw new Error('CARD_PERK_HEADERS not found');
  return eval(m[1]);
})();

// id, card, perk, amount, freq, category, lastUsed, needsReview, autopay
const FIXTURE = () => [
  HDR.slice(),
  ['CP-1', 'Amex Platinum', 'Uber Cash',           15, 'Monthly',    'Travel',    '', '', ''],
  ['CP-2', 'Amex Gold',     'Uber Cash',           10, 'Monthly',    'Dining',    '', '', ''],
  ['CP-3', 'Amex Platinum', 'Airline Fee Credit',  50, 'Quarterly',  'Travel',    '', '', ''],
  ['CP-4', 'Chase Sapphire','Saks Credit',         50, 'Semiannual', 'Shopping',  '', '', 'Yes'],
  ['CP-5', 'Citi Premier',  'Uber Cash',           10, 'Monthly',    'Travel',    '', '', ''],
];
const CARDS = [
  { id: 'CC-1', cardName: 'Amex Platinum',  active: 'Yes' },
  { id: 'CC-2', cardName: 'Amex Gold',      active: 'Yes' },
  { id: 'CC-3', cardName: 'Chase Sapphire', active: 'Yes' },
  { id: 'CC-4', cardName: 'Citi Premier',   active: 'No'  },   // inactive on purpose
];

function pad(n) { return String(n).padStart(2, '0'); }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ctxFor(rows) {
  rows = rows || FIXTURE();
  const sheet = {
    _writes: 0,
    _rows: rows,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastRow: () => rows.length,
    getLastColumn: () => HDR.length,
    getRange: (r, c, nR, nC) => ({
      getValue: () => rows[r - 1][c - 1],
      setValue: v => { sheet._writes++; rows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nR || 1); i++) out.push(rows[r - 1 + i].slice(c - 1, c - 1 + (nC || 1)));
        return out;
      },
    }),
  };
  const flagSheet = { _rows: [], getLastRow: () => 0, getRange: () => ({ getValues: () => [] }) };

  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, isFinite, parseInt, isNaN, Error, RegExp, Boolean,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    // Both perk writers now end in finishCardPerkMarkedUsed_, which also clears the
    // reminder event. No calendar in this fixture: the real deletePerkReminderEvent_
    // runs and finds nothing, which is the behaviour when none is configured.
    getPrimarySharedCalendar_: () => null,
    CONFIG: { SHEET_ID: 'X' },
    TABS: { CARD_PERKS: 'Card Perks', FLAGS: 'Flags' },
    FLAG_HEADERS: ['ID','Date','Source','Flag','Reason','Urgency','Acknowledged','Snoozed Until','Resolved','Key','Escalated'],
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => (n === 'Flags' ? flagSheet : sheet) }) },
    // Format-aware: cardPerkPeriodKey_ branches on 'yyyy' vs 'M', and the
    // resolver formats period ends. A format-blind stub would make every
    // frequency return the same string and every assertion here meaningless.
    Utilities: { formatDate: (d, tz, f) => {
      const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
      if (f === 'yyyy')         return String(Y);
      if (f === 'M')            return String(M);
      if (f === 'yyyy-MM')      return Y + '-' + pad(M);
      if (f === 'yyyy-MM-dd')   return Y + '-' + pad(M) + '-' + pad(D);
      if (f === 'MMM d, yyyy')  return MONTHS[M - 1] + ' ' + D + ', ' + Y;
      throw new Error('unstubbed format: ' + f);
    } },
  };
  // cardPerkPeriodEnd_ builds `new Date(year, endMonth, 0)` in LOCAL time; the
  // container runs UTC, so this lines up with the formatter above.
  ctx.__sheet = sheet;
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(COD, 'cardPerkPeriodKey_'),
    extractFn(COD, 'cardPerkPeriodEnd_'),
    extractFn(WEB, 'resolveCardPerkRow_'),
    extractFn(WEB, 'webToggleCardPerk_'),
    extractFn(WEB, 'webMarkCardPerkUsed_'),
    extractFn(WEB, 'resolveCardPerkFlag_'),
    extractFn(WEB, 'finishCardPerkMarkedUsed_'),
    extractFn(COD, 'perkPeriodKeyEnd_'),
    extractFn(COD, 'perkCalendarMark_'),
    extractFn(COD, 'deletePerkReminderEvent_'),
    // Freeze "now" so the period keys are the fixture's, not the real date's.
    //
    // Every argument must be forwarded. cardPerkPeriodEnd_ calls
    // `new Date(year, endMonth, 0)` — a one-arg stub silently turned that into
    // `new Date(2026)`, i.e. 2026 milliseconds after the epoch, and every period
    // end came back as Jan 1 1970. A working function looked broken.
    'var __RealDate = Date;',
    'Date = function() {',
    '  if (arguments.length === 0) return new __RealDate(' + NOW.getTime() + ');',
    '  if (arguments.length === 1) return new __RealDate(arguments[0]);',
    '  return new __RealDate(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1,',
    '                        arguments.length > 3 ? arguments[3] : 0, arguments.length > 4 ? arguments[4] : 0,',
    '                        arguments.length > 5 ? arguments[5] : 0);',
    '};',
    'Date.parse = __RealDate.parse; Date.UTC = __RealDate.UTC;',
    'Date.now = function(){ return ' + NOW.getTime() + '; };',
    'Date.prototype = __RealDate.prototype;',
  ].join('\n'), ctx);
  return ctx;
}

const lastUsedOf = (ctx, id) => {
  const r = ctx.__sheet._rows.find(x => x[0] === id);
  return String(r[HDR.indexOf('Last Used')] || '');
};
const call = (ctx, fn, id) => { ctx.__id = id; return vm.runInContext(fn + '({ parameter: { id: __id } })', ctx); };

// ============ A — the period keys ==========================================

console.log('\nthe period key matches the perk\'s cadence');
{
  const ctx = ctxFor();
  const key = f => { ctx.__f = f; return vm.runInContext('cardPerkPeriodKey_(__f, new Date(), "UTC")', ctx); };
  check('Quarterly → ' + QUARTER_KEY, key('Quarterly') === QUARTER_KEY, key('Quarterly'));
  // The assertion that matters: a quarterly perk must NOT get the month key.
  // Writing '2026-08' would silence the reminder for August and then let it fire
  // again in September, mid-quarter, for a perk already redeemed.
  check('…and explicitly NOT the month key', key('Quarterly') !== MONTH_KEY);
  check('Monthly → ' + MONTH_KEY,    key('Monthly')    === MONTH_KEY,   key('Monthly'));
  check('Semiannual → 2026-H2',      key('Semiannual') === '2026-H2',   key('Semiannual'));
  check('Annual → 2026',             key('Annual')     === '2026',      key('Annual'));
}

// ============ B — the idempotent write ====================================

console.log('\nwebMarkCardPerkUsed_ stamps the current period');
{
  const ctx = ctxFor();
  const r = call(ctx, 'webMarkCardPerkUsed_', 'CP-1');
  check('it reports marked',        r.marked === true && r.alreadyMarked === false, JSON.stringify(r));
  check('the cell holds the key',   lastUsedOf(ctx, 'CP-1') === MONTH_KEY, lastUsedOf(ctx, 'CP-1'));
  check('it names the perk',        r.perk === 'Uber Cash' && r.cardName === 'Amex Platinum');
  check('…and the frequency',  r.frequency === 'Monthly');
  check('the period end is the month end', r.periodEndIso === '2026-08-31', r.periodEndIso);
  check('…with a readable label',    /Aug 31, 2026/.test(r.periodEndLabel), r.periodEndLabel);
  check('daysLeft is finite',       isFinite(r.daysLeft), r.daysLeft);
}

console.log('\n…and calling it twice changes nothing');
{
  const ctx = ctxFor();
  call(ctx, 'webMarkCardPerkUsed_', 'CP-1');
  const writesAfterFirst = ctx.__sheet._writes;
  const second = call(ctx, 'webMarkCardPerkUsed_', 'CP-1');
  check('still marked',                lastUsedOf(ctx, 'CP-1') === MONTH_KEY, lastUsedOf(ctx, 'CP-1'));
  check('it says so',                  second.alreadyMarked === true && second.marked === true);
  // The whole reason this function exists rather than reusing the toggle: a
  // repeat must touch no cells at all.
  check('and NO second write happened', ctx.__sheet._writes === writesAfterFirst,
        writesAfterFirst + ' → ' + ctx.__sheet._writes);
}

console.log('\na quarterly perk gets the QUARTER key');
{
  const ctx = ctxFor();
  const r = call(ctx, 'webMarkCardPerkUsed_', 'CP-3');
  check('the cell holds ' + QUARTER_KEY, lastUsedOf(ctx, 'CP-3') === QUARTER_KEY, lastUsedOf(ctx, 'CP-3'));
  check('…not the month key',       lastUsedOf(ctx, 'CP-3') !== MONTH_KEY);
  check('the period ends at the quarter end', r.periodEndIso === '2026-09-30', r.periodEndIso);
  check('…which is NOT the month end',   r.periodEndIso !== '2026-08-31');
}

console.log('\nan autopay perk is refused, not stamped');
{
  const ctx = ctxFor();
  const r = call(ctx, 'webMarkCardPerkUsed_', 'CP-4');
  check('it refuses',            r.marked === false && r.reason === 'autopay', JSON.stringify(r));
  check('nothing was written',   ctx.__sheet._writes === 0, ctx.__sheet._writes);
  check('the cell is untouched', lastUsedOf(ctx, 'CP-4') === '');
}

console.log('\nbad input is an error, not a silent no-op');
{
  const ctx = ctxFor();
  let threwBlank = false, threwUnknown = false;
  try { call(ctx, 'webMarkCardPerkUsed_', ''); }       catch (e) { threwBlank = /id is required/.test(e.message); }
  try { call(ctx, 'webMarkCardPerkUsed_', 'CP-999'); } catch (e) { threwUnknown = /not found/.test(e.message); }
  check('a blank id throws',   threwBlank);
  check('an unknown id throws', threwUnknown);
  check('and neither wrote',   ctx.__sheet._writes === 0);
}

// ============ C — the toggle is unchanged =================================

console.log('\nthe dashboard checkbox still TOGGLES');
{
  const ctx = ctxFor();
  const on = call(ctx, 'webToggleCardPerk_', 'CP-1');
  check('first click marks',   on.used === true && lastUsedOf(ctx, 'CP-1') === MONTH_KEY);
  const off = call(ctx, 'webToggleCardPerk_', 'CP-1');
  // This is the behaviour the refactor must not have quietly turned into a set —
  // a mis-click has to be undoable from the checkbox.
  check('second click clears', off.used === false && lastUsedOf(ctx, 'CP-1') === '',
        lastUsedOf(ctx, 'CP-1'));
}

console.log('\n…and the two writers agree on what to write');
{
  // The only reason resolveCardPerkRow_ exists. If they ever disagree about the
  // column or the period key, the checkbox and Chat would silently stamp
  // different cells or different strings for the same perk.
  const a = ctxFor(); call(a, 'webToggleCardPerk_',   'CP-3');
  const b = ctxFor(); call(b, 'webMarkCardPerkUsed_', 'CP-3');
  check('identical string for a quarterly perk',
        lastUsedOf(a, 'CP-3') === lastUsedOf(b, 'CP-3'),
        lastUsedOf(a, 'CP-3') + ' vs ' + lastUsedOf(b, 'CP-3'));
  check('…and it is the quarter key', lastUsedOf(a, 'CP-3') === QUARTER_KEY);
}

console.log('\n…and the autopay asymmetry is deliberate');
{
  // The checkbox is a manual override on a row he is looking at, so it still
  // toggles an autopay perk. Chat refuses. Pinned so a later tidy-up does not
  // "harmonise" the two by accident.
  const ctx = ctxFor();
  const r = call(ctx, 'webToggleCardPerk_', 'CP-4');
  check('the checkbox still toggles autopay', r.used === true, JSON.stringify(r));
  check('…while the marker refuses it',
        call(ctxFor(), 'webMarkCardPerkUsed_', 'CP-4').reason === 'autopay');
}

// ============ D — the Chat matcher ========================================

function chatCtx(rows) {
  rows = rows || FIXTURE();
  const base = ctxFor(rows);
  const out  = { executed: [], errors: [], notes: [] };
  base.__out = out;
  // webGetCards_ is stubbed (it reads five tabs); everything downstream of it —
  // the matcher and the real write — is the shipped code.
  vm.runInContext([
    'var webGetCards_ = function() { return { ok: true, cards: ' + JSON.stringify(CARDS) + ', perks: ' +
      'SpreadsheetApp.openById().getSheetByName("Card Perks").getDataRange().getValues().slice(1)' +
      '.filter(function(r){return r[0];}).map(function(r){ return {' +
      '  id:String(r[0]||\'\'), cardName:String(r[1]||\'\'), perk:String(r[2]||\'\'),' +
      '  amount: r[3] !== \'\' ? Number(r[3]) : null, frequency:String(r[4]||\'Monthly\'),' +
      '  lastUsed:String(r[6]||\'\'),' +
      '  needsReview:String(r[7]||\'\').trim().toLowerCase()===\'yes\',' +
      '  autopay:String(r[8]||\'\').trim().toLowerCase()===\'yes\' }; }) }; };',
    extractFn(CHT, 'makeFakeEvent_'),
  ].join('\n'), base);
  return base;
}

// Runs only the mark_perk_used branch, with the real matcher text lifted out of
// executeActions_ so the assertions exercise shipped code rather than a copy.
const MARK_BRANCH = (function() {
  const src = extractFn(CHT, 'executeActions_');
  const start = src.indexOf("else if (type === 'mark_perk_used') {");
  if (start === -1) throw new Error('mark_perk_used branch not found in executeActions_');
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start + 'else '.length, j + 1); }
  }
  throw new Error('unbalanced mark_perk_used branch');
})();

function runMark(ctx, perkArg, cardArg) {
  ctx.__args = [perkArg, cardArg === undefined ? '' : cardArg];
  vm.runInContext(
    'var type = "mark_perk_used", args = __args;' +
    'var executed = __out.executed, errors = __out.errors, notes = __out.notes;' +
    MARK_BRANCH, ctx);
  return ctx.__out;
}

console.log('\none match marks it');
{
  const ctx = chatCtx();
  const out = runMark(ctx, 'Airline');
  check('it wrote',            lastUsedOf(ctx, 'CP-3') === QUARTER_KEY, lastUsedOf(ctx, 'CP-3'));
  check('exactly one write',   ctx.__sheet._writes === 1, ctx.__sheet._writes);
  check('it reports the perk', /Airline Fee Credit/.test(out.executed[0]), out.executed[0]);
  check('…and the card',  /Amex Platinum/.test(out.executed[0]), out.executed[0]);
  check('no errors, no notes', out.errors.length === 0 && out.notes.length === 0);
}

console.log('\nno match is an error');
{
  const ctx = chatCtx();
  const out = runMark(ctx, 'Peloton');
  check('nothing written',  ctx.__sheet._writes === 0);
  check('it says what it looked for', /no perk found matching "Peloton"/.test(out.errors[0]), out.errors[0]);
}

console.log('\nan ambiguous match asks, and writes NOTHING');
{
  const ctx = chatCtx();
  const out = runMark(ctx, 'Uber');
  // Uber Cash is on Platinum AND Gold, both active and both unused. Guessing
  // would silently mark the wrong card's perk and silence a real reminder.
  check('NO write at all',        ctx.__sheet._writes === 0, ctx.__sheet._writes);
  check('it asks',                /Which one\?/.test(out.notes[0]), out.notes[0]);
  check('…naming Platinum',  /Amex Platinum/.test(out.notes[0]));
  check('…and Gold',         /Amex Gold/.test(out.notes[0]));
  check('it does not claim to have marked anything',
        /did not mark anything yet/.test(out.notes[0]), out.notes[0]);
  check('an ambiguity is not an error', out.errors.length === 0, JSON.stringify(out.errors));
  // The inactive Citi card also has an Uber Cash perk and must not be offered.
  check('the inactive card is not among the candidates', !/Citi/.test(out.notes[0]), out.notes[0]);
}

console.log('\n…unless the card is named');
{
  const ctx = chatCtx();
  runMark(ctx, 'Uber', 'Gold');
  check('exactly one write',       ctx.__sheet._writes === 1, ctx.__sheet._writes);
  check('on the Gold row',         lastUsedOf(ctx, 'CP-2') === MONTH_KEY, lastUsedOf(ctx, 'CP-2'));
  check('…and not Platinum',  lastUsedOf(ctx, 'CP-1') === '');
}

console.log('\n…or unless only one is still unused');
{
  const rows = FIXTURE();
  rows.find(r => r[0] === 'CP-1')[HDR.indexOf('Last Used')] = MONTH_KEY;  // Platinum already redeemed
  const ctx = chatCtx(rows);
  runMark(ctx, 'Uber');
  check('it picks the unused one', lastUsedOf(ctx, 'CP-2') === MONTH_KEY, lastUsedOf(ctx, 'CP-2'));
  check('one write',               ctx.__sheet._writes === 1, ctx.__sheet._writes);
  check('no question needed',      ctx.__out.notes.length === 0, JSON.stringify(ctx.__out.notes));
}

console.log('\nan inactive card is never matched');
{
  const ctx = chatCtx();
  const out = runMark(ctx, 'Uber', 'Citi');
  check('nothing written', ctx.__sheet._writes === 0);
  check('it reports no match', /no perk found/.test(out.errors[0]), out.errors[0]);
  check('…mentioning the card filter', /Citi/.test(out.errors[0]), out.errors[0]);
}

console.log('\nan autopay perk is explained, not failed');
{
  const ctx = chatCtx();
  const out = runMark(ctx, 'Saks');
  check('nothing written',  ctx.__sheet._writes === 0);
  check('it says autopay',  /autopay/.test(out.notes[0]), out.notes[0]);
  check('…and that nothing needs marking', /nothing to mark/.test(out.notes[0]), out.notes[0]);
  check('a refusal is not an error', out.errors.length === 0, JSON.stringify(out.errors));
}

console.log('\nmarking the same perk twice in one reply is harmless');
{
  const ctx = chatCtx();
  runMark(ctx, 'Uber', 'Gold');
  const afterFirst = ctx.__sheet._writes;
  const out = runMark(ctx, 'Uber', 'Gold');
  check('only the first wrote', ctx.__sheet._writes === afterFirst, afterFirst + ' → ' + ctx.__sheet._writes);
  check('it says already marked', out.notes.some(n => /already marked used for/.test(n)),
        JSON.stringify(out.notes));
  check('…and gives the reset date', out.notes.some(n => /Aug 31, 2026/.test(n)),
        JSON.stringify(out.notes));
}

// ============ F — the email ================================================

console.log('\nthe expiry email links to the dashboard');
{
  const ectx = { String, Number, Date, Math, Object, Array, RegExp };
  vm.createContext(ectx);
  vm.runInContext([
    extractFn(COD, 'escapeHtml_'),
    extractFn(COD, 'perkMerchantLabel_'),
    extractFn(COD, 'perkBadgeInitials_'),
    extractFn(COD, 'perkBadgeColor_'),
    extractFn(COD, 'buildCardPerkEmailHtml_'),
  ].join('\n'), ectx);

  const DATA = {
    perkName: 'Airline Fee Credit', cardName: 'Amex Platinum', amountStr: '$50',
    freq: 'Quarterly', periodEndLabel: 'Sep 30, 2026', daysUntil: 5,
    reason: 'Quarterly perk resets Sep 30, 2026 — use it or lose it.',
  };
  const URL = 'https://aeraky1565.github.io/VERA-My-Chief-of-Staff/';

  ectx.__d = Object.assign({}, DATA, { dashboardUrl: URL });
  const withUrl = vm.runInContext('buildCardPerkEmailHtml_(__d)', ectx);
  check('there is an anchor',        withUrl.indexOf('href="' + URL + '"') !== -1, withUrl.slice(-400));
  check('…the user can read',   /Open VERA Dashboard/.test(withUrl));

  // THIS ASSERTION MUST NEVER BE RELAXED. The API token is one global,
  // non-expiring credential authorising every action including deletes. No VERA
  // email has ever carried one, and this one reaches two mailboxes.
  check('NO token anywhere in the HTML', !/token/i.test(withUrl), (/.{0,60}token.{0,60}/i.exec(withUrl) || [''])[0]);
  check('…and no query string at all on the link', withUrl.indexOf(URL + '?') === -1);

  check('the prose route to the specific card survives',
        /Finances → Cards → Amex Platinum/.test(withUrl));

  ectx.__d = Object.assign({}, DATA);   // no dashboardUrl
  const without = vm.runInContext('buildCardPerkEmailHtml_(__d)', ectx);
  check('omitting the url renders no anchor', !/Open VERA Dashboard/.test(without));
  check('…and never href="undefined"',  !/undefined/.test(without),
        (/.{0,60}undefined.{0,60}/.exec(without) || [''])[0]);

  // The sender builds the plaintext twin; assert the shape it must have.
  const sender = extractFn(COD, 'checkCardPerksExpiring_');
  check('the sender passes the url in',      /dashboardUrl:\s*perkDashUrl/.test(sender));
  check('…reads it from the property',  /VERA_DASHBOARD_URL/.test(sender));
  check('…with a fallback so the CTA is never dead',
        /aeraky1565\.github\.io/.test(sender));
  check('the plaintext body carries it too', /Dashboard: ' \+ perkDashUrl/.test(sender));
  check('and the sender never appends a token',
        !/token/i.test(sender.slice(sender.indexOf('perkDashUrl'))), 'token near the url');
}

// ============ the wiring ===================================================

console.log('\nthe wiring');
{
  check('the route exists', /case 'mark_card_perk_used':\s*return jsonOut_\(webMarkCardPerkUsed_\(e\)\)/.test(WEB));
  check('the toggle route is untouched', /case 'toggle_card_perk':\s*return jsonOut_\(webToggleCardPerk_\(e\)\)/.test(WEB));
  check('both writers go through the resolver',
        /resolveCardPerkRow_\(/.test(extractFn(WEB, 'webToggleCardPerk_')) &&
        /resolveCardPerkRow_\(/.test(extractFn(WEB, 'webMarkCardPerkUsed_')));
  // ensureCardPerkColumns_ WRITES missing headers; the checkbox must not gain
  // that side effect by way of the shared resolver.
  check('the resolver does not write headers',
        !/ensureCardPerkColumns_/.test(extractFn(WEB, 'resolveCardPerkRow_')));
  // These two assertions used to read "the marker resolves the stale flag" and
  // "…and the toggle does NOT", pinning the difference as if it were the design.
  // It was the bug. The toggle is what the dashboard checkbox calls, so the
  // commonest path left a High-urgency flag open and let the calendar reminder
  // fire on a perk already redeemed. Both writers now end in one cleanup.
  check('both writers end in the shared cleanup',
        /finishCardPerkMarkedUsed_\(/.test(extractFn(WEB, 'webMarkCardPerkUsed_')) &&
        /finishCardPerkMarkedUsed_\(/.test(extractFn(WEB, 'webToggleCardPerk_')));
  check('…and neither carries its own copy of it',
        !/resolveCardPerkFlag_\(/.test(extractFn(WEB, 'webMarkCardPerkUsed_')) &&
        !/resolveCardPerkFlag_\(/.test(extractFn(WEB, 'webToggleCardPerk_')),
        'two copies is how they drifted apart');
  check('the cleanup resolves the flag AND clears the calendar reminder',
        /resolveCardPerkFlag_\(/.test(extractFn(WEB, 'finishCardPerkMarkedUsed_')) &&
        /deletePerkReminderEvent_\(/.test(extractFn(WEB, 'finishCardPerkMarkedUsed_')));
  check('un-ticking a mis-click runs no cleanup',
        /if \(newUsed !== ''\) \{/.test(extractFn(WEB, 'webToggleCardPerk_')),
        'the flag stays resolved and the event stays gone, by decision');
  check('the flag is resolved with "Yes", the value every reader tests for',
        /setValue\('Yes'\)/.test(extractFn(WEB, 'resolveCardPerkFlag_')));
  check('the action is declared',  /ACTION:mark_perk_used\|/.test(CHT));
  check('the guidance says to ask', /ASK which card/.test(CHT));
  check('…and never to guess', /Never pick one for him/.test(CHT));
  check('the notes channel is returned', /return \{ executed: executed, errors: errors, notes: notes \}/.test(CHT));
  check('…and surfaced to the reply', /actionResult\.notes/.test(CHT));
  check('the chat context no longer says "this month"', !/Unused perks this month/.test(CHT));
  check('…and uses the shared period helper',
        /cardPerkPeriodKey_\(p\.frequency/.test(CHT));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
