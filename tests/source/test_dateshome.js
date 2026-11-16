// People › Important Dates (GiftNudge.js, checkNoGiftIdea_, DatesHome). Pins:
//  - a Low flag for a birthday or anniversary within 14 days with no open gift idea for the person;
//    given ideas don't count; it runs nightly after the important dates check;
//  - the screen: the next 30 days as cards with a countdown and the age or years, the no-gift note
//    opening Gift Ideas, By month, and By person still the full editor.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GN = read('GiftNudge.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };

console.log('\nno gift idea yet');
const DATES = [{ ID: 'd1', Label: 'Sam’s birthday', Person: 'Sam', Date: '2016-' + plus(10).slice(5), daysUntil: 10, nextDate: plus(10) },
  { ID: 'd2', Label: 'Anniversary', Person: 'Victoria', Date: '2018-' + plus(5).slice(5), daysUntil: 5, nextDate: plus(5) },
  { ID: 'd3', Label: 'Jo’s birthday', Person: 'Jo', Date: plus(20).slice(5), daysUntil: 20, nextDate: plus(20) },
  { ID: 'd4', Label: 'Dentist', Person: 'Ahmed', daysUntil: 3, nextDate: plus(3) }, { ID: 'd5', Label: 'Kit’s birthday', Person: 'Kit', daysUntil: 2, nextDate: plus(2) }];
const IDEAS = [{ Person: 'Victoria', Idea: 'Weekend away' }, { Person: 'Kit', Idea: 'Scarf', 'Given On': '2025-01-02' }];
{
  const calls = [];
  const c = { String, Number, Math, JSON, Date, Object, TABS: { FLAGS: 'F' }, getSpreadsheet: () => ({ getSheetByName: () => ({}) }), Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => isoOf(d) },
    webGetImportantDates_: () => ({ dates: DATES }), webGetGiftData_: () => ({ ideas: IDEAS }), upsertKeyedFlags_: (s, p, src, w) => calls.push([p, src, w]) };
  vm.createContext(c); vm.runInContext(GN, c);
  check('occasions only', c.gnIsOccasion_('Sam’s birthday') && c.gnIsOccasion_('Our anniversary') && !c.gnIsOccasion_('Dentist'));
  c.checkNoGiftIdea_();
  const w = calls[0][2];
  check('within 14 days, no open idea: Sam and Kit (Kit’s idea was given); not Victoria (has one), not Jo (20 d), not the dentist', calls[0][0] === 'no_gift_' && J(Object.keys(w).map(k => k.split('_')[2]).sort()) === J(['d1', 'd5']) && w[Object.keys(w)[0]].urgency === 'Low', J(Object.keys(w)));
  check('it runs nightly after the important dates', CODE.indexOf("nightlyStep_(ctx, 'checkNoGiftIdea_', checkNoGiftIdea_);") > CODE.indexOf("nightlyStep_(ctx, 'checkImportantDates_', checkImportantDates_);"));
}

console.log('\nthe screen’s numbers');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['dhIsOccasion_', 'dhYears_', 'dhSoon_', 'dhByMonth_', 'dhHasIdea_'].map(n => fnSrc(APP, n)).join('\n'), U);
check('ages and years', (U.dhYears_(DATES[0])||{}).word === 'turns 10' && (U.dhYears_(DATES[1])||{}).word === '8th anniversary' && U.dhYears_(DATES[2]) === null && (U.dhYears_({ Label: 'x birthday', Date: '2001-02-03', nextDate: '2022-02-03' })||{}).word === 'turns 21' && (U.dhYears_({ Label: 'Anniversary', Date: '2015-01-01', nextDate: '2026-01-01' })||{}).word === '11th anniversary');
check('the next 30 days, soonest first', J(U.dhSoon_(DATES, 30).map(d => d.ID)) === J(['d5', 'd4', 'd2', 'd1', 'd3']) && J(U.dhSoon_(DATES, 7).map(d => d.ID)) === J(['d5', 'd4', 'd2']));
check('by month', U.dhByMonth_(DATES, new Date()).reduce((s, m) => s + m.dates.length, 0) === 5);

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ dates, ideas }) => {
      window.__ev = [];
      document.body.innerHTML = '<div id="dh" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('dh')).render(React.createElement(DatesHome, { dates, ideas, loading: false, busy: false, onOpenGifts: p => window.__ev.push(['gifts', p]),
        onAdd() {}, onUpdate() {}, onDelete() {}, onPreviewCalendar() {}, onImportCalendar() {}, calPreviews: [], calPreviewLoading: false }));
    }, { dates: DATES, ideas: IDEAS });
    await page.waitForTimeout(200);
    check('the next 30 days as cards, soonest first', J(await page.$$eval('#dh .dh-card', ns => ns.map(n => n.dataset.date))) === J(['d5', 'd4', 'd2', 'd1', 'd3']));
    const sam = await page.$eval('#dh .dh-card[data-date="d1"]', n => n.innerText.replace(/\s+/g, ' '));
    check('a card: the countdown, who, the age, the no-gift note', /^10 days/.test(sam) && /Sam/.test(sam) && /turns 10/.test(sam) && /No gift idea yet · Add one/.test(sam), sam);
    check('…not when there’s an idea, nor for a non-occasion', !/No gift idea/.test(await page.$eval('#dh .dh-card[data-date="d2"]', n => n.innerText)) && !/No gift idea/.test(await page.$eval('#dh .dh-card[data-date="d4"]', n => n.innerText)));
    await page.click('#dh .dh-card[data-date="d1"] .dh-nudge');
    check('…Add one opens Gift Ideas', J((await page.evaluate(() => window.__ev)).pop()) === J(['gifts', 'Sam']));
    await page.click('#dh .dh-chip >> text=By month'); await page.waitForTimeout(40);
    check('By month', (await page.$$('#dh .dh-month')).length >= 1 && (await page.$$('#dh .dh-row')).length === 5);
    await page.click('#dh .dh-chip >> text=By person'); await page.waitForTimeout(80);
    check('By person is the full editor', await page.evaluate(() => /Sam/.test(document.querySelector('#dh').innerText) && !document.querySelector('#dh .dh-card')));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
