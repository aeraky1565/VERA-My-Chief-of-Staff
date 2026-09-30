// The Trip Decisions tab has to create itself.
//
// createSheetTabs() is the only other thing that makes it, and that runs from
// setupVERA(), which nobody re-runs when a feature ships. On every sheet that
// predates this feature the tab was absent, so the first Confirm threw
// "Trip Decisions tab not found" — the feature was unusable on exactly the
// sheets it was built for.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extract(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

const HDRS = ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'];

// A fake sheet good enough for ensureSheet and ensureTripDecisionsSchema_.
function makeSheet(rows, maxCols) {
  return {
    rows: rows || [],
    maxCols: maxCols === undefined ? 26 : maxCols,
    getLastRow() { return this.rows.length; },
    getMaxColumns() { return this.maxCols; },
    insertColumnsAfter(after, n) { this.maxCols += n; },
    setFrozenRows() {}, setColumnWidth() {}, autoResizeColumn() {},
    getRange(r, c, nr, nc) {
      const self = this;
      return {
        getValues() {
          const o = [];
          for (let i = 0; i < (nr || 1); i++) {
            const row = self.rows[r - 1 + i] || [];
            const rr = [];
            for (let j = 0; j < (nc || 1); j++) rr.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
            o.push(rr);
          }
          return o;
        },
        setValues(v) {
          v.forEach((row, i) => {
            const target = r - 1 + i;
            while (self.rows.length <= target) self.rows.push([]);
            row.forEach((cell, j) => { self.rows[target][c - 1 + j] = cell; });
          });
          return this;
        },
        setValue(v) { return this.setValues([[v]]); },
        getValue() { return this.getValues()[0][0]; },
        setFontWeight() { return this; }, setBackground() { return this; },
        setFontColor() { return this; }, setNumberFormat() { return this; },
      };
    },
    appendRow(v) { this.rows.push(v.slice()); },
  };
}

function build(existingTab) {
  const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
  const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
  const state = { tabs: {}, inserted: [] };
  if (existingTab) state.tabs['Trip Decisions'] = existingTab;

  const ctx = {
    TABS: { TRIP_DECISIONS: 'Trip Decisions' },
    TRIP_DECISION_HEADERS: HDRS,
    Logger: { log(){} },
    // Apps Script gives every root .js one shared global scope, so these are
    // always in scope in production; the vm has to model that. With no registry
    // here they behave as the registry-less fallback does: the key stands alone.
    tripKeysFor_: k => [String(k == null ? '' : k).trim()],
    tripRowMatches_: (cell, keys) => {
      const v = String(cell == null ? '' : cell).trim();
      return !!v && (keys || []).indexOf(v) !== -1;
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    getSpreadsheet: () => ({
      getSheetByName: n => state.tabs[n] || null,
      insertSheet: n => { state.inserted.push(n); state.tabs[n] = makeSheet([]); return state.tabs[n]; },
    }),
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(extract(CODE, 'ensureSheet'), ctx);
  ['ensureTripDecisionsSchema_', 'tdFindDecisionRow_', 'tdDecisionSheet_', 'tdWriteDecision_']
    .forEach(fn => vm.runInContext(extract(WEB, fn), ctx));
  ctx.__state = state;
  return ctx;
}

console.log('\na sheet that predates the feature');
{
  const E = build(null);                       // no Trip Decisions tab at all
  let threw = null;
  try {
    E.tdWriteDecision_('2026-11-08|Miami', '2026-11-08|14:00', '2026-11-08', 'Decided', 'B', '', '');
  } catch (e) { threw = e.message; }

  check('confirming does NOT throw', threw === null, threw);
  check('the tab is created', E.__state.inserted.indexOf('Trip Decisions') !== -1,
        JSON.stringify(E.__state.inserted));

  const sheet = E.__state.tabs['Trip Decisions'];
  check('…with the right headers', sheet && JSON.stringify(sheet.rows[0]) === JSON.stringify(HDRS),
        sheet && JSON.stringify(sheet.rows[0]));
  check('…and the decision is actually recorded', sheet && sheet.rows.length === 2, sheet && sheet.rows.length);
  check('…with the chosen option', sheet && sheet.rows[1][5] === 'B', sheet && sheet.rows[1][5]);
  check('…and the status', sheet && sheet.rows[1][4] === 'Decided', sheet && sheet.rows[1][4]);
}

console.log('\na sheet that already has the tab');
{
  const existing = makeSheet([HDRS.slice(), ['TD-0','T','G','2026-11-08','Decided','A','','2026-10-02','']]);
  const E = build(existing);
  E.tdWriteDecision_('T2', 'G2', '2026-11-09', 'Decided', 'C', '', '');

  check('it is NOT re-created', E.__state.inserted.length === 0, JSON.stringify(E.__state.inserted));
  check('the existing row survives', existing.rows[1][0] === 'TD-0', existing.rows[1][0]);
  check('and the new one is appended', existing.rows.length === 3, existing.rows.length);
}

console.log('\na tab left over from an older, shorter header set');
{
  const narrow = makeSheet([['ID','Trip Key','Group Key']], 3);
  const E = build(narrow);
  E.tdWriteDecision_('T', 'G', '2026-11-09', 'Decided', 'C', '', '');

  check('it is widened to the full header set', narrow.maxCols >= HDRS.length, narrow.maxCols);
  check('…and the headers rewritten', JSON.stringify(narrow.rows[0]) === JSON.stringify(HDRS),
        JSON.stringify(narrow.rows[0]));
}

console.log('\nidempotent');
{
  const E = build(null);
  E.tdWriteDecision_('T', 'G', '2026-11-09', 'Decided', 'C', '', '');
  E.tdWriteDecision_('T', 'G', '2026-11-09', 'Decided', 'A', '', '');
  const sheet = E.__state.tabs['Trip Decisions'];
  check('the tab is created once', E.__state.inserted.length === 1, E.__state.inserted.length);
  check('confirming twice UPDATES rather than duplicating', sheet.rows.length === 2, sheet.rows.length);
  check('…and the later choice wins', sheet.rows[1][5] === 'A', sheet.rows[1][5]);
}

console.log('\nthe source says so');
{
  const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
  const fn = extract(WEB, 'tdDecisionSheet_');
  check('tdDecisionSheet_ uses ensureSheet', /ensureSheet\(/.test(fn), fn);
  check('…not a bare getSheetByName', !/getSheetByName/.test(fn), fn);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
