// Issue #235: the VERA sheet's look as a script (SheetStyle.js). Pins the plan
// (areas, tab order, column kinds, header, freeze, banding, colour rules), that it
// never writes a value or moves a column (VERA reads data tabs by position), that
// Config and Access get no formatting, that a re-run replaces only its own rules,
// that new tabs get the style, and that a long run resumes. Invented tabs and headers.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(path.join(ROOT, 'SheetStyle.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

// ---- fakes: every call is recorded --------------------------------------------
function fakeSheet(name, headers, log, extra) {
  const rules = (extra && extra.rules) || [];
  let bandings = (extra && extra.bandings) || [];
  const sh = {
    _name: name, _rules: rules, _index: 0,
    getName: () => name, getMaxRows: () => 50, getLastColumn: () => headers.length,
    getIndex: () => sh._index,
    getBandings: () => bandings.map(b => ({ remove: () => { log.push([name, 'removeBanding']); bandings = bandings.filter(x => x !== b); } })),
    getConditionalFormatRules: () => sh._rules,
    setConditionalFormatRules: r => { log.push([name, 'setRules', r.length]); sh._rules = r; },
    setFrozenRows: n => log.push([name, 'frozenRows', n]),
    setFrozenColumns: n => log.push([name, 'frozenCols', n]),
    setTabColor: c => log.push([name, 'tabColor', c]),
    getRange: (r, c, nr, nc) => {
      const rg = {
        getValues: () => [headers.slice()],
        setValue: () => { log.push([name, 'VALUE WRITE']); return rg; },
        setValues: () => { log.push([name, 'VALUE WRITE']); return rg; },
        setBackground: v => { log.push([name, 'bg', r, c, nr, nc, v]); return rg; },
        setFontColor: v => { log.push([name, 'fg', v]); return rg; },
        setFontWeight: v => { log.push([name, 'weight', v]); return rg; },
        setNumberFormat: v => { log.push([name, 'numberFormat', c, v]); return rg; },
        setWrapStrategy: v => { log.push([name, 'wrap', c, v]); return rg; },
        applyRowBanding: () => { log.push([name, 'band', nr, nc]); bandings.push({}); const b = { setHeaderRowColor: () => b, setFirstRowColor: () => b, setSecondRowColor: () => b }; return b; },
      };
      return rg;
    },
    insertColumnBefore: () => log.push([name, 'MOVE']), deleteColumn: () => log.push([name, 'MOVE']),
    moveColumns: () => log.push([name, 'MOVE']), deleteRow: () => log.push([name, 'MOVE']),
  };
  return sh;
}
function ruleBuilder(log) {
  return () => {
    const r = { bg: '', when: '' };
    const b = {
      setBackground: v => { r.bg = v; return b; }, setFontColor: () => b,
      whenFormulaSatisfied: f => { r.when = f; return b; }, whenTextEqualTo: t => { r.when = 'text:' + t; return b; },
      setRanges: () => b,
      build: () => ({ getBooleanCondition: () => ({ getBackground: () => r.bg }), _r: r }),
    };
    return b;
  };
}
function ctx(extra) {
  const log = [];
  const props = {};
  const c = Object.assign({
    String, Array, Number, Object, JSON, Math, RegExp, Date, log,
    Logger: { log: () => {} },
    SpreadsheetApp: { newConditionalFormatRule: ruleBuilder(log), BandingTheme: { LIGHT_GREY: 'LG' }, WrapStrategy: { WRAP: 'WRAP', CLIP: 'CLIP' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    __props: props,
  }, extra || {});
  vm.createContext(c);
  vm.runInContext(SRC, c);
  return c;
}
const run = (c, expr, vars) => { Object.assign(c, vars || {}); return vm.runInContext(expr, c); };

console.log('\nareas and tab order');
{
  const c = ctx();
  check('a named tab finds its area', run(c, 'ssAreaOf_("Itinerary").id') === 'travel' && run(c, 'ssAreaOf_("Flags").color') === '#c9a84c');
  check('a prefix finds it too', run(c, 'ssAreaOf_("Career Ladder").id') === 'career' && run(c, 'ssAreaOf_("FP Items").id') === 'health' && run(c, 'ssAreaOf_("Trip Outfits").id') === 'travel');
  check('an unknown tab has no area', run(c, 'ssAreaOf_("Scratch")') === null);
  const names = ['System Log', 'Career Ladder', 'Itinerary', 'Config', 'Scratch', 'Bills', 'Flags', 'Goals', 'Gym Log', 'Recipes', 'Trips',
    'Tasks', 'Projects', 'Access', 'PTO', 'Ideas', 'Chores'];
  const o = run(c, 'ssOrder_(__n)', { __n: names });
  check('Config stays first', o[0] === 'Config', J(o));
  check('Access stays at position 14', o[13] === 'Access', J(o));
  check('areas in order: today, travel, money, home, health, career, life', o.indexOf('Flags') < o.indexOf('Trips') && o.indexOf('Trips') < o.indexOf('Bills') &&
        o.indexOf('Bills') < o.indexOf('Recipes') && o.indexOf('Recipes') < o.indexOf('Gym Log') && o.indexOf('Gym Log') < o.indexOf('Career Ladder') &&
        o.indexOf('Career Ladder') < o.indexOf('Goals'), J(o));
  check('an unknown tab goes before VERA\'s internal tabs, which are last', o.indexOf('Goals') < o.indexOf('Scratch') && o[o.length - 1] === 'System Log', J(o));
  check('no tab is lost or doubled', o.length === names.length && new Set(o).size === names.length);
}

console.log('\ncolumn kinds, by header');
{
  const c = ctx();
  const k = h => run(c, 'ssColumnKind_(__h)', { __h: h });
  check('money: Amount, Budgeted, Best Fare Seen, Price Ceiling Per Person, Credit Limit', ['Amount', 'Budgeted', 'Best Fare Seen', 'Price Ceiling Per Person', 'Credit Limit'].every(h => k(h) === 'money'));
  check('not money: dates, IDs, counts, points, scores, due days, statuses', ['Due Date', 'Due Day', 'Bill ID', 'Points', 'Score', 'Status', 'Total Seen', 'Miles'].every(h => k(h) !== 'money'), ['Due Date', 'Due Day', 'Bill ID', 'Points', 'Score', 'Status', 'Total Seen', 'Miles'].map(k).join());
  check('prose is wrapped: Notes, Reason, Flag, Task, Description', ['Notes', 'Reason', 'Flag', 'Task', 'Description'].every(h => k(h) === 'prose'));
  check('JSON and ID lists are clipped', ['Metadata', 'Luggage JSON', 'Criterion IDs'].every(h => k(h) === 'code'));
  check('anything else is left alone', k('Company') === '' && k('') === '');
}

console.log('\nthe plan');
{
  const c = ctx();
  const tabs = [
    { name: 'Config', headers: ['Setting', 'Value', 'What it does', 'Where'], maxRows: 300 },
    { name: 'Access', headers: ['Person', 'Tabs'], maxRows: 20 },
    { name: 'Flags', headers: ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Ack', 'Snooze', 'Resolved', 'Key'], maxRows: 400 },
    { name: 'Bills', headers: ['Bill', 'Amount', 'Due Day', 'Status', '', ''], maxRows: 60 },
    { name: 'Empty', headers: [], maxRows: 10 },
  ];
  const p = run(c, 'ssPlan_(__t)', { __t: tabs });
  const of = (s, op) => p.ops.filter(x => x.sheet === s && (!op || x.op === op));
  check('Config and Access get no formatting at all', of('Config').length === 0 && of('Access').length === 0);
  check('an empty tab is left alone', of('Empty').length === 0);
  check('every op is a format, never a value write or a move', p.ops.every(x => ['header', 'freeze', 'band', 'tabColor', 'format', 'rule'].indexOf(x.op) !== -1), J([...new Set(p.ops.map(x => x.op))]));
  check('the header spans the used columns (trailing blanks ignored)', of('Bills', 'header')[0].cols === 4 && of('Flags', 'header')[0].cols === 10);
  check('row 1 frozen; column A too when a tab has more than 8 columns', of('Flags', 'freeze')[0].cols === 1 && of('Bills', 'freeze')[0].cols === 0);
  check('banding covers the whole grid, not just today\'s rows', of('Flags', 'band')[0].rows === 400);
  check('tab colours by area', of('Bills', 'tabColor')[0].color === '#2e9d5b' && of('Flags', 'tabColor')[0].color === '#c9a84c');
  check('Amount is money, Flag and Reason are wrapped', of('Bills', 'format').some(x => x.col === 2 && x.kind === 'money') &&
        of('Flags', 'format').filter(x => x.kind === 'prose').map(x => x.col).join() === '4,5');
  check('Urgency gets High, Medium and Low colours', of('Flags', 'rule').filter(x => x.col === 6).map(x => x.text).join() === 'High,Medium,Low');
  check('Status gets done, open, closed and overdue', of('Bills', 'rule').filter(x => x.col === 4).map(x => x.rule).join() === 'done,open,closed,overdue');
  check('a resolved Flags row greys out, across the row', of('Flags', 'rule').some(x => x.rule === 'resolved' && x.col === 9 && x.width === 10));
  check('the status formula matches whole words, in any case', run(c, 'ssStatusFormula_(4, ["done","paid"])') === '=REGEXMATCH(LOWER(TRIM($D2)),"^(done|paid)$")');
  check('the plan carries the tab order', p.order[0] === 'Config' && p.order.indexOf('Access') !== -1);
}

console.log('\napplying it');
{
  const ours = { getBooleanCondition: () => ({ getBackground: () => '#fde2e2' }), mine: 'old' };
  const theirs = { getBooleanCondition: () => ({ getBackground: () => '#123456' }), mine: 'hand-made' };
  const sheets = {};
  const order = ['Bills', 'Config', 'Flags', 'Access'];
  let c;
  c = ctx();
  const log = c.log;
  order.forEach((n, i) => {
    const heads = { Config: ['Setting', 'Value'], Access: ['Person', 'Tabs'], Flags: ['ID', 'Flag', 'Urgency', 'Resolved'], Bills: ['Bill', 'Amount', 'Status'] }[n];
    sheets[n] = fakeSheet(n, heads, log, n === 'Flags' ? { rules: [ours, theirs], bandings: [{}] } : {});
    sheets[n]._index = i + 1;
  });
  const moves = [];
  const ss = {
    getSheets: () => order.map(n => sheets[n]), getSheetByName: n => sheets[n],
    setActiveSheet: sh => { ss._active = sh; }, moveActiveSheet: i => moves.push([ss._active.getName(), i]),
  };
  c.__ss = ss;
  const r = run(c, 'ssApply_(__ss)');
  check('never writes a value', !log.some(x => x[1] === 'VALUE WRITE'));
  check('never moves a row or column', !log.some(x => x[1] === 'MOVE'));
  check('Config and Access are untouched', !log.some(x => x[0] === 'Config' || x[0] === 'Access'));
  check('the header is navy, white and bold', log.some(x => x[0] === 'Bills' && x[1] === 'bg' && x[2] === 1 && x[6] === '#1a1a2e') && log.some(x => x[0] === 'Bills' && x[1] === 'weight' && x[2] === 'bold'));
  const rmAt = log.findIndex(x => x[0] === 'Flags' && x[1] === 'removeBanding'), bandAt = log.findIndex(x => x[0] === 'Flags' && x[1] === 'band');
  check('old banding is removed before the new one', rmAt !== -1 && bandAt !== -1 && rmAt < bandAt, rmAt + ' / ' + bandAt);
  const fr = sheets.Flags._rules;
  check('a re-run drops only its own old rules and keeps hand-made ones', fr.indexOf(theirs) !== -1 && fr.indexOf(ours) === -1 && fr.length === 1 + 4, fr.length);
  check('money is formatted', log.some(x => x[0] === 'Bills' && x[1] === 'numberFormat' && x[2] === 2 && x[3] === '$#,##0.00'));
  check('tabs are put in order: Config 1st, today before money; Access, already in place, is not moved', J(moves) === J([['Config', 1], ['Flags', 2], ['Bills', 3]]), J(moves));
  check('it reports what it did', r.styled === 2 && r.remaining.length === 0 && r.ordered === true, J(r));
  check('…and leaves no half-done marker behind', !c.__props.SS_STYLE_DONE);
}

console.log('\na long run stops in time and resumes');
{
  let now = 0;
  const FakeDate = class extends Date {}; FakeDate.now = () => now;
  const c = ctx({ Date: FakeDate });
  const sheets = {};
  ['Bills', 'Flags', 'Trips'].forEach((n, i) => { sheets[n] = fakeSheet(n, ['A', 'Amount'], c.log); sheets[n]._index = i + 1; });
  const ss = { getSheets: () => Object.values(sheets), getSheetByName: n => sheets[n], setActiveSheet: () => {}, moveActiveSheet: () => { c.log.push(['', 'ORDER']); } };
  const orig = sheets.Flags.setFrozenRows;
  sheets.Bills.setFrozenRows = n => { now = 6 * 60 * 1000; };   // the first tab uses up the time
  c.__ss = ss;
  const r1 = run(c, 'ssApply_(__ss)');
  check('it stops before the time limit and says what is left', r1.styled === 1 && J(r1.remaining) === J(['Flags', 'Trips']) && r1.ordered === false, J(r1));
  check('…and does not reorder a half-styled sheet', !c.log.some(x => x[1] === 'ORDER'));
  now = 0;
  const r2 = run(c, 'ssApply_(__ss)');
  check('the next run does only the rest, then orders the tabs', r2.styled === 2 && r2.remaining.length === 0 && r2.ordered === true, J(r2));
}

console.log('\nnew tabs');
{
  const c = ctx();
  const sh = fakeSheet('Career Wins', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], c.log);
  c.__sh = sh;
  run(c, 'ssStyleNewTab_(__sh, 9)');
  check('a new tab gets banding, its area colour and column A frozen', c.log.some(x => x[1] === 'band') && c.log.some(x => x[1] === 'tabColor' && x[2] === '#7b5cd6') && c.log.some(x => x[1] === 'frozenCols' && x[2] === 1));
  const cfg = fakeSheet('Config', ['Setting', 'Value'], c.log); c.__cfg = cfg; const before = c.log.length;
  run(c, 'ssStyleNewTab_(__cfg, 2)');
  check('…but never Config', c.log.length === before);
  check('ensureSheet styles a tab it creates', /setFrozenRows\(1\);\s*\n\s*\/\/[^\n]*\n\s*if \(typeof ssStyleNewTab_ === 'function'\) ssStyleNewTab_\(sheet, headers\.length\);/.test(CODE));
  check('the style never runs in the nightly run', !/styleVeraSheet|ssApply_/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
