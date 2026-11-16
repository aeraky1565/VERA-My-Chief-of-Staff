// Recurring tasks: the custom cadence (Every N days/weeks/months/years).
// Pins:
//  - parseCadence_ reads the presets and "Every N <unit>" (years too), and says null for anything else;
//  - the next due date: years, and month ends kept (Jan 31 → Feb 28, not Mar 3; Feb 29 → Feb 28);
//  - an old unreadable value still repeats monthly when completed, but saving one is refused, with why;
//  - the dashboard's copy (tcParse_, tcNext_) agrees with the server on every case;
//  - the task form: Custom… shows Every [N] [unit], previews the next date, saves "Every 2 years";
//    an old unreadable value opens as Custom with a warning. Invented tasks.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

const S = { Date, Math, String, Number, JSON, parseInt };
vm.createContext(S);
vm.runInContext('var DAY_NAMES_ = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];\n' +
  ['parseDayOfWeek_', 'nextWeekday_', 'isWeekdayAnchored_', 'parseCadence_', 'cadenceProblem_', 'addMonthsClamped_', 'computeNextDueDate_'].map(n => fnSrc(WEB, n)).join('\n'), S);
const C = { Date, Math, String, Number, JSON, parseInt };
vm.createContext(C);
vm.runInContext(APP.slice(APP.indexOf('var TC_UNITS='), APP.indexOf('const RECURRING_PRESETS=')), C);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const next = (from, v) => { const [y, m, d] = from.split('-').map(Number); const r = S.computeNextDueDate_(new Date(y, m - 1, d), v); return r ? iso(r) : ''; };

console.log('\nreading a cadence');
check('the presets', J(['Daily', 'Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Yearly'].map(v => S.parseCadence_(v))) === J([{ unit: 'day', n: 1 }, { unit: 'week', n: 1 }, { unit: 'week', n: 2 }, { unit: 'month', n: 1 }, { unit: 'month', n: 3 }, { unit: 'month', n: 6 }, { unit: 'year', n: 1 }]));
check('Every N days, weeks, months and years', J(['Every 3 days', 'every 6 weeks', 'Every 18 months', 'Every 2 years', '2 years', 'every year', 'Every 1 month'].map(v => S.parseCadence_(v))) === J([{ unit: 'day', n: 3 }, { unit: 'week', n: 6 }, { unit: 'month', n: 18 }, { unit: 'year', n: 2 }, { unit: 'year', n: 2 }, { unit: 'year', n: 1 }, { unit: 'month', n: 1 }]));
check('a weekday, and no repeat', S.parseCadence_('Every Sunday').weekday === 0 && S.parseCadence_('').none && S.parseCadence_('no').none);
check('anything else can’t be read', ['every 2 yeers', 'biannually', 'twice a month', 'every 0 days', 'every 100 days', 'whenever'].every(v => S.parseCadence_(v) === null));

console.log('\nthe next due date');
check('every 2 years', next('2027-03-15', 'Every 2 years') === '2029-03-15');
check('every 18 months', next('2027-03-15', 'Every 18 months') === '2028-09-15');
check('a month end stays at the end (Jan 31 → Feb 28, not Mar 3)', next('2027-01-31', 'Monthly') === '2027-02-28' && next('2027-08-31', 'Every 6 months') === '2028-02-29');
check('Feb 29 yearly → Feb 28', next('2028-02-29', 'Yearly') === '2029-02-28');
check('days and weeks as before', next('2027-03-15', 'Every 10 days') === '2027-03-25' && next('2027-03-15', 'Bi-Weekly') === '2027-03-29');
check('an old unreadable value still repeats monthly (as before)', next('2027-03-15', 'whenever') === '2027-04-15');
check('no repeat: nothing', next('2027-03-15', '') === '');

console.log('\nsaving: an unreadable cadence is refused, with why');
check('readable: no problem', ['', 'Monthly', 'Every 2 years', 'Every Friday'].every(v => S.cadenceProblem_(v) === ''));
check('unreadable: says so and what works', /can’t read the repeat "every 2 yeers"/.test(S.cadenceProblem_('every 2 yeers')) && /every N days, weeks, months or years/.test(S.cadenceProblem_('x')));
check('adding a task checks it', /const why = cadenceProblem_\(recurring\);\s*if \(why\) throw new Error\(why\);/.test(fnSrc(WEB, 'webAddTask_')));
check('editing a task checks it', /cadenceProblem_\(e\.parameter\.recurring\); if \(why\) throw new Error\(why\);/.test(fnSrc(WEB, 'webUpdateTask_')));

console.log('\nthe dashboard agrees with the server');
const cases = ['', 'Daily', 'Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Yearly', 'Every Sunday', 'Every Friday', 'Every 3 days', 'Every 6 weeks', 'Every 18 months', 'Every 2 years', 'every year', '2 years', 'every 2 yeers', 'biannually'];
const dates = ['2027-01-31', '2027-03-15', '2028-02-29', '2027-08-31', '2027-12-31'];
const diff = [];
cases.forEach(v => { if (J(C.tcParse_(v)) !== J(S.parseCadence_(v))) diff.push('parse ' + v);
  dates.forEach(d => { if (C.tcParse_(v) && C.tcNext_(d, v) !== next(d, v)) diff.push(v + ' @ ' + d + ': ' + C.tcNext_(d, v) + ' vs ' + next(d, v)); }); });
check('same reading and the same next date for every case', !diff.length, diff.join(' | '));
check('the label the picker saves', C.tcLabel_(2, 'year') === 'Every 2 years' && C.tcLabel_(1, 'month') === 'Every 1 month' && C.tcLabel_('0', 'week') === 'Every 1 week' && C.tcLabel_(250, 'day') === 'Every 99 days');
check('…which the server reads back', ['year', 'month', 'week', 'day'].every(u => J(S.parseCadence_(C.tcLabel_(3, u))) === J({ unit: u, n: 3 })));

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [412] : [412, 1280])) {
    console.log('\nthe task form @' + width);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    const mount = (task) => page.evaluate((task) => { window.__saved = null; document.body.innerHTML = '<div id="tf"></div>';
      ReactDOM.createRoot(document.getElementById('tf')).render(React.createElement(TaskFormModal, { task, onSave: t => { window.__saved = t; }, onClose() {}, busy: false })); }, task);
    await mount(null); await page.waitForTimeout(150);
    await page.fill('.modal input.form-input', 'Renew passport photos'); await page.fill('.modal input[type="date"]', '2027-03-15');
    await page.selectOption('.tc-preset', 'custom'); await page.waitForTimeout(80);
    check('Custom… shows Every [N] [unit]', !!(await page.$('.tc-custom')) && !!(await page.$('.tc-n')) && !!(await page.$('.tc-unit')));
    await page.fill('.tc-n', '2'); await page.selectOption('.tc-unit', 'year'); await page.waitForTimeout(80);
    check('…with the next date before saving', /Every 2 years · next after Mar 15, 2027: Mar 15, 2029/.test(await page.$eval('.tc-next', n => n.innerText)), await page.$eval('.tc-next', n => n.innerText));
    const units = await page.$$eval('.tc-unit option', ns => ns.map(n => n.textContent));
    check('…the units read as plurals for 2', J(units) === J(['days', 'weeks', 'months', 'years']));
    await page.click('.modal .btn-primary'); await page.waitForTimeout(80);
    check('it saves "Every 2 years"', (await page.evaluate(() => window.__saved && window.__saved.recurring)) === 'Every 2 years', J(await page.evaluate(() => window.__saved)));
    await mount({ id: 'T1', task: 'Dentist', dueDate: '2027-01-31', notes: '', recurring: 'Every 6 months' }); await page.waitForTimeout(150);
    check('a custom cadence opens in the picker', (await page.$eval('.tc-preset', n => n.value)) === 'custom' && (await page.$eval('.tc-n', n => n.value)) === '6' && (await page.$eval('.tc-unit', n => n.value)) === 'month' && /Jul 31, 2027/.test(await page.$eval('.tc-next', n => n.innerText)));
    await mount({ id: 'T2', task: 'Filter', dueDate: '2027-03-15', notes: '', recurring: 'Quarterly' }); await page.waitForTimeout(150);
    check('a preset opens as the preset', (await page.$eval('.tc-preset', n => n.value)) === 'Quarterly' && !(await page.$('.tc-custom')));
    await mount({ id: 'T3', task: 'Old one', dueDate: '2027-03-15', notes: '', recurring: 'every 2 yeers' }); await page.waitForTimeout(150);
    check('an old value VERA couldn’t read opens as Custom, saying so', (await page.$eval('.tc-preset', n => n.value)) === 'custom' && /It was "every 2 yeers", which VERA couldn’t read \(it repeated monthly\)/.test(await page.$eval('.tc-was', n => n.innerText).catch(() => '')));
    await page.selectOption('.tc-preset', ''); await page.waitForTimeout(50); await page.click('.modal .btn-primary'); await page.waitForTimeout(80);
    check('One-time saves no repeat', (await page.evaluate(() => window.__saved && window.__saved.recurring)) === '');
    check('no sideways scroll, no page errors', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1) && !errors.length, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
