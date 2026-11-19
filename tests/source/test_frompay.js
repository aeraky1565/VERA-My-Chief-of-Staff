// What comes out of a paycheck before it's paid (Budget.js bgWithPay_): insurance premiums,
// disability, AD&D, identity/legal plans, HSA. They aren't bills, Budget shows them under "Taken
// from pay" with take-home, the split is unchanged, and the HSA deduction is the year's figure ÷ 12
// (Config hsa_annual_<year>). On an invented tracker; every name and figure is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
// A control's sandbox holds only the root .js files; docs/ comes from the repo (no control changes it).
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const BUD = read('Budget.js'), BS = read('BillSchedule.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

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
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const E = vm.createContext({});
vm.runInContext(BUD.slice(BUD.indexOf('// ---- BudgetEngine'), BUD.indexOf('// ---- /BudgetEngine ----')), E);
vm.runInContext(/var BG_FROM_PAY_RX_ = .*;/.exec(BUD)[0] + '\n' + /var BG_HSA_RX_ = .*;/.exec(BUD)[0] + '\n' + extractFn(BUD, 'bgWithPay_'), E);
vm.runInContext(BS.slice(BS.indexOf('var BS_TAB_'), BS.indexOf('// ---- reading and writing')), E);

// The invented tracker, with an HSA deduction typed as the year's total, and two of Pat's own lines on the paycheck.
const grid = () => {
  const g = tracker();
  const find = (col, text) => g.findIndex(r => String((r || [])[col] || '').trim() === text);
  const hsaRow = find(1, 'State Withholding') + 1; g[hsaRow][1] = 'HSA Contributions'; g[hsaRow][2] = '$3,300.00';
  const ph = find(1, 'Phone - Pat'); g[ph][1] = 'Health Insurance - Dental'; g[ph][2] = '$20.00';
  const dw = find(4, 'Dog Walker'); g[dw][4] = 'Vision Plan';   // a premium on Joint: whose pay can't be told
  return g;
};
const model = (cfg, year) => { E.G = grid(); E.CFG = cfg || {}; E.Y = year || '2026'; return vm.runInContext('bgWithPay_(budgetModel_(G), CFG, Y)', E); };
const compute = m => { E.M = m; return vm.runInContext('budgetCompute_(M, {}, {})', E); };

console.log('Which lines come from pay');
const m = model({ hsa_annual_2026: '3300' });
const shared = n => m.shared.fixed.concat(m.shared.nice).find(x => x.name === n) || {};
check('a shared premium on a person’s account comes from that person’s pay', shared('Health Insurance - Medical').fromPay === 'pat');
check('…a shared line on Joint (even a premium), or one that isn’t a premium, doesn’t', !shared('Vision Plan').fromPay && !shared('Rent').fromPay && !shared('Groceries').fromPay && !shared('Internet').fromPay);
check('a person’s own premium comes from their pay; their other lines don’t', m.people[0].fixed.find(x => x.name === 'Health Insurance - Dental').fromPay === 'pat' && !m.people[0].fixed.find(x => x.name === 'Car Insurance - Pat').fromPay);
check('the words: medical, vision, dental, disability, AD&D, life insurance, identity, legal, HSA, FSA',
  ['Dental', 'Vision', 'Medical', 'Health Insurance - Vision (1+)', 'Long Term Disability (50%)', 'Employee Basic AD&D (1x)', 'Employee Basic: Life Insurance (1x)', 'Identity and Legal support', 'Short Term Disability', 'FSA'].every(n => E.BG_FROM_PAY_RX_.test(n)) && !E.BG_FROM_PAY_RX_.test('Car Insurance - Pat') && !E.BG_FROM_PAY_RX_.test('Renter Insurance'));
const mo = model({ 'from_pay:health insurance - medical': 'no', 'from_pay:groceries': 'yes' });
check('Config from_pay:<line> overrides the words, either way', !mo.shared.fixed.find(x => x.name === 'Health Insurance - Medical').fromPay && mo.shared.fixed.find(x => x.name === 'Groceries').fromPay === 'sam');

console.log('\nThe HSA, by the year');
const hsa = mm => mm.people[0].deductions.find(x => x.name === 'HSA Contributions');
check('this year: $3,300 ÷ 12, the tracker’s own figure kept', hsa(m).amount === 275 && hsa(m).trackerAmount === 3300 && m.hsa.annual === 3300 && m.hsa.year === '2026', J(m.hsa));
const m27 = model({ hsa_annual_2026: '3300', hsa_annual_2027: '$7,600' }, '2027');
check('next year: $7,600 ÷ 12', hsa(m27).amount === 633.33, String(hsa(m27).amount));
check('with no figure for the year, the tracker’s stands', hsa(model({}, '2026')).amount === 3300 && !model({}, '2026').hsa);

console.log('\nTake-home, and the split unchanged');
const c = compute(m), plain = compute(E.budgetModel_(grid()));
const pat = c.people[0], sam = c.people[1];
check('net income uses the HSA a month', pat.net === Math.round((10000 - 1000 - 1500 - 500 - 275) * 100) / 100, String(pat.net));
check('taken from pay: the medical premium and the dental line', pat.fromPay === 120 && J(pat.fromPayLines.map(x => x.name).sort()) === J(['Health Insurance - Dental', 'Health Insurance - Medical']), J(pat.fromPayLines));
check('take-home = net income − what comes from pay', pat.takeHome === Math.round((pat.net - 120) * 100) / 100);
check('a person with nothing from pay: take-home is their net income', sam.fromPay === 0 && sam.takeHome === sam.net);
const cNoHsa = compute(model({}, '2026'));
check('marking lines doesn’t change the split, the transfers or disposable (only the HSA does)', J(cNoHsa.people.map(p => [p.contribution, p.checking, p.savings, p.disposable])) === J(plain.people.map(p => [p.contribution, p.checking, p.savings, p.disposable])));

console.log('\nNot bills');
const L = E.bsBills_(c, {}, { month: '2026-11', today: '2026-11-19' });
check('a line taken from pay isn’t a bill (so no reminder, Accounts minimum or reconcile)', !L.bills.some(b => b.line === 'Health Insurance - Medical') && J(L.fromPay) === '["Health Insurance - Medical"]');
check('every other bill is still there', L.bills.some(b => b.line === 'Rent') && L.bills.some(b => b.line === 'Internet'));

console.log('\nWiring');
check('the server marks the model every time it reads the tracker', /bgWithPay_\(model, cfg, Utilities\.formatDate\(new Date\(\), Session\.getScriptTimeZone\(\), 'yyyy'\)\);/.test(extractFn(BUD, 'bgModel_')));
check('budget_model sends this year’s and next year’s HSA', /hsaYears: hsaYears,/.test(extractFn(BUD, 'webGetBudgetModel_')) && /\[y0, y0 \+ 1\]/.test(extractFn(BUD, 'webGetBudgetModel_')));
const eng = s => s.slice(s.indexOf('// ---- BudgetEngine'), s.indexOf('// ---- /BudgetEngine ----'));
check('the engine is the same in Budget.js and both dashboards', eng(BUD) === eng(APP) && eng(BUD) === eng(LITE));
const blk = (s, a, z) => s.slice(s.indexOf(a), s.indexOf(z, s.indexOf(a)));
check('the HSA editor and Budget are the same in both dashboards', blk(APP, 'function bgHsaYears_(', 'function BudgetTab(') === blk(LITE, 'function bgHsaYears_(', 'function BudgetTab(') && APP.indexOf('function bgHsaYears_(') !== -1);
check('Budget shows Taken from pay, then Take-home pay', /head\('TAKEN FROM PAY'\)/.test(APP) && /line\('','Take-home pay','net income − what comes from pay',p\.takeHome/.test(APP));
check('Bills & cashflow says which lines come from pay', /come out of a paycheck before it’s paid, so they aren’t bills/.test(APP) && /come out of a paycheck before it’s paid, so they aren’t bills/.test(LITE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
