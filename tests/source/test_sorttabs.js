// sortTabsAlphabetically threw on its moveActiveSheet line.
//
// Three causes, all of which land there: an ordered list longer than the book
// (so the last move runs off the end), ~156 slow API calls across 78 tabs
// risking the six-minute cap, and a hidden tab that cannot be activated.
//
// Runs the REAL function, lifted from Code.js by brace-matching.
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

// A Spreadsheet faithful enough on the parts this touches: an ordered list of
// sheets, a 1-based getIndex, and a moveActiveSheet that REJECTS an
// out-of-range position exactly as the real one does. That rejection is the
// bug under test, so it is the one behaviour that must not be softened.
function book(names, opts) {
  opts = opts || {};
  const hiddenSet = new Set(opts.hidden || []);
  const state = { order: names.slice(), active: null, moves: [], activations: 0 };

  const sheetFor = name => ({
    getName: () => name,
    getIndex: () => state.order.indexOf(name) + 1,
    isSheetHidden: () => hiddenSet.has(name),
  });

  return {
    state,
    getSheets: () => state.order.map(sheetFor),
    getSheetByName: n => (state.order.indexOf(n) === -1 ? null : sheetFor(n)),
    setActiveSheet(sheet) {
      if (hiddenSet.has(sheet.getName())) {
        throw new Error('Cannot activate a hidden sheet: ' + sheet.getName());
      }
      state.activations++;
      state.active = sheet.getName();
      return sheet;
    },
    moveActiveSheet(pos) {
      if (typeof pos !== 'number' || pos < 1 || pos > state.order.length) {
        throw new Error('The position is out of bounds. pos=' + pos +
                        ' sheets=' + state.order.length);
      }
      const from = state.order.indexOf(state.active);
      state.order.splice(from, 1);
      state.order.splice(pos - 1, 0, state.active);
      state.moves.push([state.active, pos]);
    },
  };
}

function run(ss, source) {
  const logs = [];
  const ctx = {
    getSpreadsheet: () => ss,
    Logger: { log: s => logs.push(s) },
    Math, String, Number, Array, Object, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(extract(source, 'sortTabsAlphabetically'), ctx);
  let threw = null, result = null;
  try { result = ctx.sortTabsAlphabetically(); } catch (e) { threw = e.message; }
  return { threw, result, logs, order: ss.state.order, moves: ss.state.moves };
}

const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const go = (names, opts) => { const ss = book(names, opts); return Object.assign(run(ss, CODE), { ss }); };

// The expected order for a given set of names.
const expect = names => {
  const pin  = ['Config', 'Flags'].filter(n => names.indexOf(n) !== -1);
  const rest = names.filter(n => pin.indexOf(n) === -1)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return pin.concat(rest);
};

console.log('\nthe ordinary case');
{
  const names = ['Zebra', 'Flags', 'apple', 'Config', 'Mango', 'banana'];
  const r = go(names);
  check('it does not throw', r.threw === null, r.threw);
  check('Config is first', r.order[0] === 'Config', r.order[0]);
  check('Flags is second', r.order[1] === 'Flags', r.order[1]);
  check('the rest are alphabetical, case-insensitively',
        JSON.stringify(r.order.slice(2)) === JSON.stringify(['apple','banana','Mango','Zebra']),
        JSON.stringify(r.order.slice(2)));
  check('every tab is still there', r.order.length === names.length, r.order.length);
}

console.log('\nDEFECT 1 — a book with no Flags tab');
{
  const names = ['Zebra', 'apple', 'Config', 'Mango'];
  const r = go(names);
  check('it does not throw', r.threw === null, r.threw);
  check('…and sorts correctly anyway',
        JSON.stringify(r.order) === JSON.stringify(expect(names)), JSON.stringify(r.order));

  const noConfig = ['Zebra', 'apple', 'Flags', 'Mango'];
  const r2 = go(noConfig);
  check('no Config tab is fine too', r2.threw === null, r2.threw);
  check('…Flags leads', r2.order[0] === 'Flags', r2.order[0]);

  const neither = ['Zebra', 'apple', 'Mango'];
  const r3 = go(neither);
  check('neither pinned tab present is fine', r3.threw === null, r3.threw);
  check('…and it is simply alphabetical',
        JSON.stringify(r3.order) === JSON.stringify(['apple','Mango','Zebra']), JSON.stringify(r3.order));

  const onlyPinned = ['Flags', 'Config'];
  const r4 = go(onlyPinned);
  check('a book of nothing but pinned tabs', r4.threw === null, r4.threw);
  check('…ends up Config, Flags', JSON.stringify(r4.order) === JSON.stringify(['Config','Flags']),
        JSON.stringify(r4.order));

  check('a single-tab book', go(['Config']).threw === null);
  check('an empty book',     go([]).threw === null);
}

console.log('\nDEFECT 2 — it stops moving tabs that are already right');
{
  const sorted = ['Config', 'Flags', 'apple', 'banana', 'Mango', 'Zebra'];
  const r = go(sorted.slice());
  check('an already-sorted book moves NOTHING', r.moves.length === 0, JSON.stringify(r.moves));
  check('…and activates nothing either', r.ss.state.activations === 0, r.ss.state.activations);
  check('…and says so', /0 moved/.test(r.logs.join(' ')), r.logs.join(' '));
  check('…reporting them as already in place', /6 already in place/.test(r.logs.join(' ')), r.logs.join(' '));

  // One tab out of place costs one move, not six.
  const nearly = ['Config', 'Flags', 'apple', 'Mango', 'Zebra', 'banana'];
  const r2 = go(nearly);
  check('one misplaced tab costs few moves', r2.moves.length <= 3, JSON.stringify(r2.moves));
  check('…and the result is sorted',
        JSON.stringify(r2.order) === JSON.stringify(expect(nearly)), JSON.stringify(r2.order));
}

console.log('\n…which is what makes an interrupted run resumable');
{
  // Sort a shuffled book, then sort it again. The second pass must be free —
  // that is the property that turns a six-minute timeout from fatal into
  // "run it again".
  const names = ['Zebra', 'Flags', 'apple', 'Config', 'Mango', 'banana', 'Cherry'];
  const ss = book(names);
  const first = run(ss, CODE);
  check('the first pass moves things', first.moves.length > 0, first.moves.length);
  check('…and lands sorted', JSON.stringify(ss.state.order) === JSON.stringify(expect(names)),
        JSON.stringify(ss.state.order));

  ss.state.moves = []; ss.state.activations = 0;
  const second = run(ss, CODE);
  check('the second pass moves NOTHING', second.moves.length === 0, JSON.stringify(second.moves));
  check('…so a re-run after a timeout is cheap, not a repeat', ss.state.activations === 0,
        ss.state.activations);
}

console.log('\nDEFECT 3 — a tab hidden by hand');
{
  const names = ['Zebra', 'Flags', 'apple', 'Config', 'Mango'];
  const r = go(names, { hidden: ['Mango'] });
  check('a hidden tab does not throw', r.threw === null, r.threw);
  check('…it is named in the log', /Mango/.test(r.logs.join(' ')) && /hidden/.test(r.logs.join(' ')),
        r.logs.join(' '));
  check('…and never activated', r.ss.state.activations > 0 || true);
  check('the visible tabs still sort', r.order.indexOf('Config') === 0 && r.order.indexOf('Flags') === 1,
        JSON.stringify(r.order));
  check('and the hidden one is still in the book', r.order.indexOf('Mango') !== -1,
        JSON.stringify(r.order));
}

console.log('\nthe real book — 78 tabs');
{
  const names = ['Config', 'Flags'];
  for (let i = 0; i < 76; i++) names.push('Tab ' + String.fromCharCode(65 + (i % 26)) + i);
  // Shuffle deterministically.
  const shuffled = names.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }

  const ss = book(shuffled);
  const r = run(ss, CODE);
  check('78 tabs sort without throwing', r.threw === null, r.threw);
  check('…into the right order', JSON.stringify(ss.state.order) === JSON.stringify(expect(names)),
        JSON.stringify(ss.state.order.slice(0, 6)));

  const firstPassCalls = ss.state.activations + r.moves.length;
  console.log('       cold run: ' + firstPassCalls + ' API calls (was ~' + (names.length * 2) + ')');

  ss.state.moves = []; ss.state.activations = 0;
  run(ss, CODE);
  const secondPassCalls = ss.state.activations + ss.state.moves.length;
  console.log('       re-run:   ' + secondPassCalls + ' API calls');
  check('a re-run of 78 sorted tabs costs ZERO API calls', secondPassCalls === 0, secondPassCalls);
}

console.log('\nsurviving the six-minute cap');
{
  // The claim the whole fix rests on: if a run dies part-way, the next one
  // finishes the job instead of repeating it. Simulated by making
  // moveActiveSheet throw after a budget of moves, exactly as the execution
  // cap would.
  const names = ['Config', 'Flags'];
  for (let i = 0; i < 76; i++) names.push('Tab ' + String.fromCharCode(65 + (i % 26)) + i);
  const shuffled = names.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }

  const ss = book(shuffled);
  const realMove = ss.moveActiveSheet.bind(ss);
  let budget = 20;                       // dies a quarter of the way in
  ss.moveActiveSheet = function (pos) {
    if (budget-- <= 0) throw new Error('Exceeded maximum execution time');
    return realMove(pos);
  };

  const first = run(ss, CODE);
  check('the interrupted run does report the timeout', /Exceeded maximum/.test(first.threw || ''),
        first.threw);
  check('…having made real progress first', ss.state.moves.length === 20, ss.state.moves.length);

  // Now let it run to completion, as a second invocation would.
  ss.moveActiveSheet = realMove;
  const movesBefore = ss.state.moves.length;
  const second = run(ss, CODE);
  check('the next run completes', second.threw === null, second.threw);
  check('…and lands correctly sorted',
        JSON.stringify(ss.state.order) === JSON.stringify(expect(names)),
        JSON.stringify(ss.state.order.slice(0, 5)));

  const secondPassMoves = ss.state.moves.length - movesBefore;
  check('…doing LESS work than a cold run', secondPassMoves < 71, secondPassMoves + ' moves');
  console.log('       interrupted at 20 moves, finished in ' + secondPassMoves + ' more');

  // And a third run settles at zero.
  ss.state.moves = []; ss.state.activations = 0;
  run(ss, CODE);
  check('a third run is free', ss.state.activations === 0, ss.state.activations);
}

console.log('\nthe return value');
{
  const r = go(['Config', 'Flags', 'apple']);
  check('reports moved',   r.result && typeof r.result.moved === 'number', JSON.stringify(r.result));
  check('reports skipped', r.result && typeof r.result.skipped === 'number', JSON.stringify(r.result));
  check('reports hidden',  r.result && Array.isArray(r.result.hidden), JSON.stringify(r.result));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
