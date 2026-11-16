// People › Address book (abRuns_, abLastCard_, abStale_, abPersonLinks_ in docs/app.js). Pins:
//  - the card runs on top, the most recently sent first, with "N of M sent this year", opening the run;
//  - a chip row per household: city, people, the last card sent, a stale-address chip;
//  - each person's next date and open gift ideas, opening People › Important Dates and Gift Ideas;
//  - bulk import and Check ids under ⚙ Tools;
//  - PeopleTab passes the dates and ideas down.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const Y = String(new Date().getFullYear()), LY = String(new Date().getFullYear() - 1);

// Invented households.
const HH = [
  { id: 'h1', household: 'The Fernsby family', address1: '4 Larch Way', city: 'Brookvale', state: 'TX', relationship: 'Family', addressConfirmed: Y + '-01-10' },
  { id: 'h2', household: 'Pell & Ora', address1: '9 Quill Rd', city: 'Marrow', relationship: 'Friends', addressConfirmed: (Number(Y) - 3) + '-05-01' },
  { id: 'h3', household: 'Uncle Tamsin', relationship: 'Family' }];
const PEOPLE = [{ id: 'c1', householdId: 'h1', name: 'Wren Fernsby' }, { id: 'c2', householdId: 'h1', name: 'Bo Fernsby' }, { id: 'c3', householdId: 'h2', name: 'Pell Arno' }];
const MAIL = [
  { id: 'm1', householdId: 'h1', event: 'Winter card', sent: Y + '-01-03' }, { id: 'm2', householdId: 'h2', event: 'Winter card', sent: '' },
  { id: 'm3', householdId: 'h1', event: 'Thank you', sent: LY + '-06-01' }, { id: 'm4', householdId: 'h2', event: 'Winter card', sent: LY + '-12-20' }];
const EVENTS = ['Thank you', 'Winter card'];
const DATES = [{ ID: 'd1', Label: 'Wren’s birthday', Person: 'Wren', daysUntil: 12, nextDate: '2099-01-01' }, { ID: 'd2', Label: 'Old one', Person: 'Wren', daysUntil: -3 },
  { ID: 'd3', Label: 'Pell’s birthday', Person: 'pell arno', daysUntil: 40 }];
const IDEAS = [{ Person: 'Wren', Idea: 'Book' }, { Person: 'Wren Fernsby', Idea: 'Kite' }, { Person: 'Wren', Idea: 'Old', 'Given On': LY + '-01-01' }, { Person: 'Bo', Idea: 'Socks' }];

console.log('\nthe pieces');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array, parseInt }; vm.createContext(U);
vm.runInContext(['abIsSent', 'abRuns_', 'abLastCard_', 'abStale_', 'abPersonLinks_'].map(n => fnSrc(APP, n)).join('\n'), U);
try {
  const runs = U.abRuns_(EVENTS, HH, MAIL, Y);
  check('card runs: the most recently sent first, on-list and sent-this-year counts', J(runs.map(r => [r.event, r.onList, r.sent])) === J([['Winter card', 2, 1], ['Thank you', 1, 0]]), J(runs));
  check('an event with nothing sent goes last', U.abRuns_(['Fresh', 'Winter card'], HH, MAIL.concat([{ householdId: 'h3', event: 'Fresh', sent: '' }]), Y)[1].event === 'Fresh');
  check('the last card is the newest sent, not a planned one', U.abLastCard_(MAIL.filter(m => m.householdId === 'h2')).id === 'm4' && U.abLastCard_([{ sent: '' }]) === null);
  const now = new Date(Number(Y), 5, 1);
  check('stale: never confirmed, or two or more years ago', !U.abStale_(HH[0], now) && U.abStale_(HH[1], now) && U.abStale_(HH[2], now));
  const l = U.abPersonLinks_(PEOPLE.filter(p => p.householdId === 'h1'), DATES, IDEAS);
  check('per person: the soonest upcoming date by first or full name; past ones skipped', l[0].next && l[0].next.ID === 'd1' && l[1].next === null && U.abPersonLinks_([PEOPLE[2]], DATES, IDEAS)[0].next.ID === 'd3');
  check('…and the open ideas, a given one not counted', l[0].ideas === 2 && l[1].ideas === 1, J(l));
} catch (e) { check('the pieces run', false, e.message); }

console.log('\nwiring');
check('PeopleTab passes the dates, the ideas and both links down', /React\.createElement\(AddressBookView,\{apiUrl:apiUrl,apiToken:apiToken,dates:datesData&&datesData\.dates\|\|\[\],ideas:giftData&&giftData\.ideas\|\|\[\],onOpenDates:function\(\)\{setSub\('dates'\);\},onOpenGifts:function\(\)\{setSub\('gifts'\);\}\}\)/.test(APP));

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
    await page.evaluate(({ hh, people, mail, events, dates, ideas }) => {
      window.__ev = [];
      window.apiGet = async () => ({ ok: true, configured: true, households: hh, people, mailings: mail, events });
      document.body.innerHTML = '<div id="ab" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('ab')).render(React.createElement(AddressBookView, { apiUrl: 'x', apiToken: 't', dates, ideas,
        onOpenDates: p => window.__ev.push(['dates', p]), onOpenGifts: p => window.__ev.push(['gifts', p]) }));
    }, { hh: HH, people: PEOPLE, mail: MAIL, events: EVENTS, dates: DATES, ideas: IDEAS });
    await page.waitForTimeout(250);
    try {
      check('the card runs on top, the current one first', J(await page.$$eval('#ab .ab-run', ns => ns.map(n => [n.dataset.event, n.classList.contains('current')]))) === J([['Winter card', true], ['Thank you', false]]));
      const run = await page.$eval('#ab .ab-run.current', n => n.innerText.replace(/\s+/g, ' '));
      check('…saying how far it has got', /Current · 1 of 2 sent this year/.test(run), run);
      const h1 = await page.evaluate(() => { const c = [...document.querySelectorAll('#ab .ab-chips')].find(n => /Brookvale/.test(n.innerText)); return c ? c.innerText.replace(/\s+/g, ' ') : ''; });
      check('household chips: city, people, the last card', /📍 Brookvale/.test(h1) && /👥 2/.test(h1) && /✉️ Winter card · /.test(h1) && !/Address/.test(h1), h1);
      const h2 = await page.evaluate(() => { const c = [...document.querySelectorAll('#ab .ab-chips')].find(n => /Marrow/.test(n.innerText)); return c ? c.innerText : ''; });
      check('…and a stale-address chip when it wants checking', /Address confirmed \d{4}/.test(h2) && !!(await page.$('#ab .ab-stale')), h2);
      const wren = await page.$eval('#ab .ab-person[data-person="Wren Fernsby"]', n => n.innerText.replace(/\s+/g, ' '));
      check('each person: next date and open ideas', /📅 Wren’s birthday · in 12 d/.test(wren) && /🎁 2 ideas for Wren/.test(wren), wren);
      await page.click('#ab .ab-person[data-person="Wren Fernsby"] .ab-date'); await page.waitForTimeout(40);
      check('clicking a link does not fold the household open', !(await page.evaluate(() => /SENT/.test(document.querySelector('#ab').innerText))));
      await page.click('#ab .ab-person[data-person="Bo Fernsby"] .ab-ideas');
      check('…opening Important Dates and Gift Ideas', J(await page.evaluate(() => window.__ev)) === J([['dates', 'Wren Fernsby'], ['gifts', 'Bo Fernsby']]));
      check('bulk import and Check ids are under ⚙ Tools, closed at first', !!(await page.$('#ab .ab-tools-btn')) && !(await page.$('#ab .ab-tools')));
      await page.click('#ab .ab-tools-btn'); await page.waitForTimeout(40);
      check('…and open from it', await page.evaluate(() => /Bulk import/.test(document.querySelector('#ab .ab-tools').innerText) && /Check ids/.test(document.querySelector('#ab .ab-tools').innerText)));
      await page.click('#ab .ab-run.current'); await page.waitForTimeout(60);
      check('a card run opens the run', !(await page.$('#ab .ab-runs')) && /Add someone/.test(await page.$eval('#ab', n => n.innerText)));
    } catch (e) { check('the screen runs', false, e.message.split('\n')[0]); }
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
