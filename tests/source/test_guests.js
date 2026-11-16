// Hosting › Guests (Guests.js, getUpcomingGuests_ in PTO.js, the guest routes, GuestsView). Pins:
//  - the prep list comes from Config guest_prep_list (one per line), else a default; saving it;
//  - ticks and headcount are kept per stay (title + arrival day) in a Guest Prep tab made on first use;
//  - the read splits past stays (left before today) from now and coming, and looks a year back;
//  - a guest count is guessed from the title ("Mom & Dad" 2, "The Lins (4)" 4);
//  - the screen: staying now on top with day N of M, coming with "Arrives in N d" and nights, prep
//    ticks, the headcount stepper, the guide and Meal Plan links, past stays folded, edit the list.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GU = read('Guests.js'), PTO = read('PTO.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows) {
  const grid = rows.map(r => r.slice());
  return { grid, getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: v => v.forEach((row, i) => { while (grid.length < r + i) grid.push([]); row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }) }),
    appendRow: r => grid.push(r.slice()) };
}
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T0 = new Date(); const day = n => iso(new Date(T0.getFullYear(), T0.getMonth(), T0.getDate() + n));

function ctx(cfg, stays) {
  const c = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, parseInt, cfg: Object.assign({}, cfg), sheets: {}, gotBack: null,
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => iso(d) } };
  c.getSpreadsheet = () => ({ getSheetByName: n => c.sheets[n] || null, insertSheet: n => (c.sheets[n] = fakeSheet([])) });
  c.getConfigValues = () => c.cfg; c.setConfigRow_ = (k, v) => { c.cfg[k] = v; return true; };
  c.veraLocked_ = f => f(); c.readPTOConfig_ = () => ({});
  c.getUpcomingGuests_ = (cfg, back) => { c.gotBack = back; return stays || []; };
  vm.createContext(c); vm.runInContext(GU, c); return c;
}

console.log('\nthe prep list');
{
  const c = ctx({});
  check('the default list when none is set', c.gpList_({}).length === 5 && /sheets/i.test(c.gpList_({})[0]));
  check('one per line (or ;), blanks and repeats dropped', J(c.gpList_({ guest_prep_list: 'Sheets\n\nTowels; Wi-Fi card\ntowels' })) === J(['Sheets', 'Towels', 'Wi-Fi card']));
  let r = c.webGuestPrepList_({ parameter: { items: 'Sheets\nTowels\n' } });
  check('saving the list', J(r.prep) === J(['Sheets', 'Towels']) && c.cfg.guest_prep_list === 'Sheets\nTowels');
  r = c.webGuestPrepList_({ parameter: { items: '  ' } });
  check('…an empty list goes back to the default', r.prep.length === 5);
  check('a guest count from the title', c.gpGuessGuests_('Mom & Dad') === 2 && c.gpGuessGuests_('Rania visiting') === 1 && c.gpGuessGuests_('The Lins (4)') === 4 && c.gpGuessGuests_('Sam, Jo and Kit staying') === 3);
}

console.log('\nticks and headcount per stay');
{
  const stays = [{ label: 'Mom & Dad', arrivalDate: day(-1), departureDate: day(3), durationDays: 5, daysAway: -1 }, { label: 'Rania', arrivalDate: day(12), departureDate: day(15), durationDays: 4, daysAway: 12 },
    { label: 'Cousins', arrivalDate: day(-40), departureDate: day(-37), durationDays: 4, daysAway: -40 }, { label: 'Old friends', arrivalDate: day(-200), departureDate: day(-198), durationDays: 3, daysAway: -200 }];
  const c = ctx({ guest_prep_list: 'Sheets\nTowels\nWi-Fi card' }, stays);
  let r = c.webGuests_();
  check('the read looks a year back', c.gotBack === 365);
  check('now and coming vs past (newest first)', J(r.guests.map(g => g.label)) === J(['Mom & Dad', 'Rania']) && J(r.past.map(g => g.label)) === J(['Cousins', 'Old friends']));
  check('each stay: a key, no ticks, a guessed headcount; the list', r.guests[0].stayKey === 'Mom & Dad|' + day(-1) && J(r.guests[0].checked) === J([]) && r.guests[0].people === 2 && J(r.prep) === J(['Sheets', 'Towels', 'Wi-Fi card']));
  check('nothing is written by reading', !c.sheets['Guest Prep']);
  c.webGuestPrepCheck_({ parameter: { stay: r.guests[1].stayKey, item: 'Towels', on: 'true' } });
  c.webGuestPrepCheck_({ parameter: { stay: r.guests[1].stayKey, item: 'Sheets', on: 'true' } });
  c.webGuestPrepCheck_({ parameter: { stay: r.guests[1].stayKey, item: 'Sheets', on: 'false' } });
  c.webGuestPeople_({ parameter: { stay: r.guests[1].stayKey, n: '3' } });
  c.webGuestPrepCheck_({ parameter: { stay: r.guests[0].stayKey, item: 'Sheets', on: 'true' } });
  const sh = c.sheets['Guest Prep'];
  check('a Guest Prep tab, made on first tick, one row per item', !!sh && J(sh.grid[0]) === J(['Stay', 'Item', 'Value', 'Updated']) && sh.grid.length === 5, J(sh && sh.grid.map(x => x.slice(0, 3))));
  r = c.webGuests_();
  check('ticks and headcount come back on their own stay', J(r.guests[1].checked) === J(['Towels']) && r.guests[1].people === 3 && J(r.guests[0].checked) === J(['Sheets']) && r.guests[0].people === 2, J(r.guests));
  c.cfg.guest_prep_list = 'Sheets\nWi-Fi card';
  check('…an item taken off the list stops counting', J(c.webGuests_().guests[1].checked) === J([]) && J(c.webGuests_().guests[0].checked) === J(['Sheets']));
  let threw = false; try { c.webGuestPeople_({ parameter: { stay: 'x', n: '0' } }); } catch (e) { threw = true; }
  check('a headcount must be 1 to 20', threw);
  threw = false; try { c.webGuestPrepCheck_({ parameter: { stay: 'x', item: '__people', on: 'true' } }); } catch (e) { threw = true; }
  check('the headcount row can’t be ticked', threw);
}
check('getUpcomingGuests_ looks back only when asked', /var from = new Date\(today\.getTime\(\) - \(Math\.max\(0, parseInt\(backDays, 10\) \|\| 0\)\)/.test(PTO) && /cal\.getEvents\(from, end\)/.test(PTO));

console.log('\nnow, coming, past');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['guDay_', 'guState_', 'guSplit_'].map(n => fnSrc(APP, n)).join('\n'), U);
const NOW = new Date(2026, 10, 16, 15);
check('staying: day N of M', J(U.guState_({ arrivalDate: '2026-11-15', departureDate: '2026-11-19' }, NOW)) === J({ kind: 'now', day: 2, total: 5, nights: 4, leavesToday: false }));
check('leaving today', U.guState_({ arrivalDate: '2026-11-12', departureDate: '2026-11-16' }, NOW).leavesToday === true);
check('coming: in N days and nights', J(U.guState_({ arrivalDate: '2026-11-28', departureDate: '2026-12-01' }, NOW)) === J({ kind: 'coming', days: 12, total: 4, nights: 3 }));
check('past', U.guState_({ arrivalDate: '2026-11-01', departureDate: '2026-11-03' }, NOW).kind === 'past');
check('split: now (soonest leaving first) and coming (soonest first)', J((s => [s.now.map(g => g.label), s.coming.map(g => g.label)])(U.guSplit_([{ label: 'B', arrivalDate: '2026-12-04', departureDate: '2026-12-07' }, { label: 'A', arrivalDate: '2026-11-15', departureDate: '2026-11-20' }, { label: 'C', arrivalDate: '2026-11-28', departureDate: '2026-11-30' }, { label: 'D', arrivalDate: '2026-11-14', departureDate: '2026-11-17' }], NOW))) === J([['D', 'A'], ['C', 'B']]));

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
    await page.evaluate(({ data }) => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'get_guests') return Promise.resolve(JSON.parse(JSON.stringify(data))); if (p.action === 'guest_prep_list') return Promise.resolve({ ok: true, prep: p.items.split('\n').filter(Boolean) }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="gu" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('gu')).render(React.createElement(GuestsView, { apiUrl: 'u', apiToken: 't', onOpen: s => window.__ev.push({ open: s }) }));
    }, { data: { ok: true, prep: ['Sheets', 'Towels', 'Wi-Fi card'],
      guests: [{ label: 'Rania', arrivalDate: day(12), departureDate: day(15), stayKey: 'Rania|' + day(12), checked: ['Wi-Fi card'], people: 1 }, { label: 'Mom & Dad', arrivalDate: day(-1), departureDate: day(3), stayKey: 'Mom & Dad|' + day(-1), checked: [], people: 2 }],
      past: [{ label: 'Cousins', arrivalDate: day(-40), departureDate: day(-37), stayKey: 'Cousins|x' }] } });
    await page.waitForTimeout(250);
    check('staying now on top, then coming up', J(await page.$$eval('#gu .gu-sect', ns => ns.map(n => n.textContent))) === J(['Staying now', 'Coming up']) && J(await page.$$eval('#gu .gu-card', ns => ns.map(n => n.querySelector('.gu-name').textContent))) === J(['Mom & Dad', 'Rania']));
    const now = await page.$eval('#gu .gu-card.now', n => n.innerText);
    check('…day 2 of 5, when they leave, 4 people', /Staying · day 2 of 5/.test(now) && /Leave /.test(now) && /4 people/.test(now), now);
    const soon = await page.$eval('#gu .gu-card:not(.now)', n => n.innerText);
    check('coming: arrives in 12 d, 3 nights, prep 1/3', /Arrives in 12 d/.test(soon) && /3 nights/.test(soon) && /Prep · 1\/3/.test(soon), soon);
    await page.click('#gu .gu-card:not(.now) .gu-tick >> text=Towels'); await page.waitForTimeout(40);
    check('ticking a prep item saves it for that stay', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'guest_prep_check', stay: 'Rania|' + day(12), item: 'Towels', on: true }) && /Prep · 2\/3/.test(await page.$eval('#gu .gu-card:not(.now)', n => n.innerText)));
    await page.click('#gu .gu-card.now .gu-step[aria-label="One more guest"]'); await page.waitForTimeout(40);
    check('the stepper changes the headcount', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'guest_people', stay: 'Mom & Dad|' + day(-1), n: 3 }) && /5 people/.test(await page.$eval('#gu .gu-card.now', n => n.innerText)));
    await page.click('#gu .gu-card.now .gu-guide'); const e1 = (await page.evaluate(() => window.__ev)).pop();
    await page.click('#gu .gu-card.now .gu-meals'); const e2 = (await page.evaluate(() => window.__ev)).pop();
    check('the guest guide and Meal Plan links', J([e1, e2]) === J([{ open: 'guide' }, { open: 'meal_plan' }]));
    check('past stays fold', /Past stays · 1 ▸/.test(await page.$eval('#gu', n => n.innerText)) && !(await page.$('#gu .gu-past')));
    await page.click('#gu .gu-fold >> text=/Past stays/'); await page.waitForTimeout(40);
    check('…and open', /Cousins/.test(await page.$eval('#gu .gu-past', n => n.innerText)) && /3 nights/.test(await page.$eval('#gu .gu-past', n => n.innerText)));
    await page.click('#gu .gu-edit'); await page.fill('#gu .gu-list-in', 'Sheets\nTowels\nWi-Fi card\nNight light'); await page.click('#gu .gu-list-save'); await page.waitForTimeout(60);
    check('editing the list once: every stay gets it', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'guest_prep_list', items: 'Sheets\nTowels\nWi-Fi card\nNight light' }) && (await page.$$('#gu .gu-card.now .gu-tick')).length === 4 && (await page.$$('#gu .gu-card:not(.now) .gu-tick')).length === 4);
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
