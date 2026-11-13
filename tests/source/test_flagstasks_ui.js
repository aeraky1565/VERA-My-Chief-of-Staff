// The Flags and Tasks tabs in the full dashboard, at phone and desktop width, over a stubbed
// server and invented flags and tasks: groups by area (open when they hold a High), the Due
// chip, automatic flags (no Resolve, what clears them), the snooze menu, Go to it, ＋ Task,
// quick reschedule, Undo after a check-off, Delete with a confirm, the flag a task came from,
// and Done this week with Reopen.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const add = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = add(0);

const FLAGS = [
  { id: 'F1', date: add(-3), source: 'Vehicles', flag: 'The Civic: service was due, done? Log it on the card', reason: 'Service', urgency: 'High', key: 'vehicle_renewal_VEH-1_service_' + add(-2), due: add(-2), auto: true, clears: 'Clears once the new date is saved on the vehicle’s card.' },
  { id: 'F2', date: add(-1), source: 'Finance', flag: 'Water bill not marked paid', reason: '$64.20', urgency: 'Medium', key: 'water_bill_nov', due: add(3), auto: false, clears: '' },
  { id: 'F3', date: add(-5), source: 'Gym Tracker', flag: 'No gym visit in 9 days', reason: '', urgency: 'Low', key: '', due: '', auto: false, clears: '' },
  { id: 'F4', date: add(-2), source: 'System', flag: 'TESS is late', reason: 'No run logged', urgency: 'Low', key: 'AGENT_HEALTH|TESS', due: '', auto: true, clears: 'Clears on the agent’s next good run.' },
  { id: 'F5', date: add(-9), source: 'Finance', flag: 'Snoozed card fee', reason: '', urgency: 'High', key: 'card_fee', due: '', auto: false, clears: '', snoozedUntil: add(4) },
];
const TASKS = [
  { id: 'TASK-1', task: 'Call the dentist about the crown', dueDate: add(-2), daysUntilDue: -2, isOverdue: true, status: 'Open', notes: '' },
  { id: 'TASK-2', task: 'Pay the water bill', dueDate: TODAY, daysUntilDue: 0, status: 'Open', notes: '', flagId: 'F2', flag: { id: 'F2', flag: 'Water bill not marked paid', resolved: false, auto: false } },
];
const DONE = [{ id: 'TASK-9', task: 'Renew library books', completed: add(-1) }];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    const L = '@' + width;
    console.log('\nfull dashboard ' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(({ FLAGS, TASKS, DONE }) => {
      try { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); localStorage.removeItem('vera_flag_groups'); localStorage.removeItem('vera_vh_open'); } catch (e) {}
      window.__calls = [];
      window.fetch = function(url) {
        let p = {}; try { const u = new URL(url); u.searchParams.forEach((v, k) => { p[k] = v; }); } catch (e) {}
        window.__calls.push(p);
        const a = p.action;
        const body = a === 'flags' ? { ok: true, flags: FLAGS } : a === 'tasks' ? { ok: true, tasks: TASKS, doneThisWeek: DONE }
          : a === 'status' ? { ok: true, activeFlags: 4, features: {} } : a === 'vehicles' ? { ok: true, vehicles: [] }
          : a === 'flag_to_task' ? { ok: true, id: 'TASK-3', created: true } : a === 'complete_task' ? { ok: true, id: p.id, action: 'completed', flag: 'resolved' }
          : { ok: true, rows: [], items: [], tasks: [], flags: [], summaries: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
      };
    }, { FLAGS, TASKS, DONE });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tab-btn')).some(b => /Flags/.test(b.textContent)), null, { timeout: 15000 }).catch(() => {});
    const tab = label => page.evaluate(l => { const b = Array.from(document.querySelectorAll('.tab-btn')).find(n => n.textContent.indexOf(l) !== -1); if (b) b.click(); return !!b; }, label);
    const calls = () => page.evaluate(() => window.__calls.filter(c => ['status', 'flags', 'tasks', 'summaries', 'get_google_tasks'].indexOf(c.action) === -1));
    const clearCalls = () => page.evaluate(() => { window.__calls = []; });
    // The main tab row is wider than a desktop window already (before this change); the content below it must not be.
    const sideways = () => page.evaluate(() => Array.from(document.querySelectorAll('.main *')).some(n => n.getBoundingClientRect().right > window.innerWidth + 1));

    // ---- Flags ----
    await tab('Flags'); await wait(500);
    const groups = await page.$$eval('.flag-group', ns => ns.map(n => ({ id: n.dataset.group, open: n.querySelector('.flag-group-head').getAttribute('aria-expanded') === 'true', cards: n.querySelectorAll('.flag-card').length })));
    check(L + ': groups by area in order, Snoozed last', groups.map(g => g.id).join() === 'finances,vehicles,health,system,snoozed', JSON.stringify(groups));
    check(L + ': a group with a High starts open, the rest folded', groups.filter(g => g.open).map(g => g.id).join() === 'vehicles', JSON.stringify(groups));
    check(L + ': a snoozed High doesn’t open its group', !groups.find(g => g.id === 'snoozed').open);
    const civic = '.flag-card[data-flag="F1"]';
    check(L + ': the Due chip says how late', (await page.$eval(civic + ' .flag-due', n => n.textContent).catch(() => '')) === 'overdue 2d');
    check(L + ': an automatic flag says so, and what clears it', (await page.$eval(civic + ' .flag-auto', n => n.textContent).catch(() => '')) === 'automatic' && /saved on the vehicle’s card/.test(await page.$eval(civic + ' .flag-clears', n => n.textContent).catch(() => '')));
    check(L + ': …and has no Resolve', !(await page.$(civic + ' .btn-resolve')));
    check(L + ': no sideways scroll on Flags', !(await sideways()));
    // open Finances: a one-off flag keeps Resolve
    await page.click('.flag-group[data-group="finances"] .flag-group-head'); await wait(100);
    check(L + ': a one-off flag keeps Resolve, and its Due chip', !!(await page.$('.flag-card[data-flag="F2"] .btn-resolve')) && /due /.test(await page.$eval('.flag-card[data-flag="F2"] .flag-due', n => n.textContent).catch(() => '')));
    check(L + ': the fold is remembered on this phone', /"finances":true/.test(await page.evaluate(() => localStorage.getItem('vera_flag_groups'))));
    // filters
    await page.selectOption('.flag-urg-filter', 'Low'); await wait(80);
    const lowGroups = await page.$$eval('.flag-group', ns => ns.map(n => n.dataset.group).join());
    check(L + ': the urgency filter', lowGroups === 'health,system', lowGroups);
    await page.selectOption('.flag-urg-filter', 'all'); await page.selectOption('.flag-area-filter', 'vehicles'); await wait(80);
    check(L + ': the area filter', (await page.$$eval('.flag-group', ns => ns.map(n => n.dataset.group).join())) === 'vehicles');
    await page.selectOption('.flag-area-filter', 'all'); await wait(80);
    // snooze menu
    await clearCalls();
    await page.click(civic + ' .btn-snooze'); await wait(80);
    const items = await page.$$eval(civic + ' .flag-snooze-menu [role=menuitem]', ns => ns.map(n => n.textContent));
    check(L + ': the snooze menu: Tomorrow, 2 days, (Monday), A week', /^Tomorrow/.test(items[0] || '') && /^2 days/.test(items[1] || '') && items.some(t => /^A week/.test(t)), JSON.stringify(items));
    await page.click(civic + ' .flag-snooze-menu [role=menuitem]:first-child'); await wait(150);
    let c = await calls();
    check(L + ': Tomorrow snoozes until tomorrow’s date', c.some(x => x.action === 'snooze' && x.id === 'F1' && x.until === add(1)), JSON.stringify(c));
    await wait(1700);
    await clearCalls();
    // ＋ Task
    await page.click('.flag-card[data-flag="F2"] .btn-totask'); await wait(200);
    c = await calls();
    check(L + ': ＋ Task makes a task from the flag', c.some(x => x.action === 'flag_to_task' && x.id === 'F2'), JSON.stringify(c));
    // Go to it
    const goLabel = await page.$eval(civic + ' .btn-goto', n => n.textContent).catch(() => '');
    check(L + ': Go to it names the place', goLabel === 'Go to the vehicle →', goLabel);
    await page.click(civic + ' .btn-goto'); await wait(500);
    const active = await page.$eval('.tab-btn.active', n => n.textContent).catch(() => '');
    check(L + ': …opens Home Front', /Home Front/.test(active), active);
    const onVehicles = await page.evaluate(() => !!document.querySelector('.vh-view, [data-vid], .vehicles-view') || /Vehicles/.test((document.querySelector('.subtab-btn.active, .vn-chip.on, [aria-current="page"]') || {}).textContent || ''));
    check(L + ': …on Vehicles, the vehicle’s card set to open', /"VEH-1":true/.test(await page.evaluate(() => localStorage.getItem('vera_vh_open'))) && onVehicles);

    // ---- Tasks ----
    await tab('Tasks'); await wait(500);
    await page.evaluate(() => Array.from(document.querySelectorAll('div')).filter(n => /^[▸] /.test(n.textContent) && n.style.cursor === 'pointer').forEach(n => n.click()));
    await wait(200);
    check(L + ': a task made from a flag shows it', /From flag: Water bill not marked paid/.test(await page.$eval('.task-flag', n => n.textContent).catch(() => '')));
    await clearCalls();
    const firstQuick = '.task-card .task-quick';
    await page.click(firstQuick + ' button:first-child'); await wait(300);
    c = await calls();
    check(L + ': Tomorrow moves the due date', c.some(x => x.action === 'update_task' && x.dueDate === add(1) && !('task' in x)), JSON.stringify(c));
    check(L + ': no sideways scroll on Tasks', !(await sideways()));
    await clearCalls();
    // complete then undo
    await page.click('.task-card .task-check'); await wait(200);
    check(L + ': checking off shows Undo', /done/.test(await page.$eval('.task-undo', n => n.textContent).catch(() => '')));
    await page.click('.task-undo-btn'); await wait(5300);
    c = await calls();
    check(L + ': Undo: nothing was written', !c.some(x => x.action === 'complete_task'), JSON.stringify(c));
    check(L + ': …and the bar is gone', !(await page.$('.task-undo')));
    // complete and let it go
    await page.click('.task-card .task-check'); await wait(5400);
    c = await calls();
    check(L + ': after 5 seconds the check-off is written', c.filter(x => x.action === 'complete_task').length === 1, JSON.stringify(c));
    await wait(1700);
    // Done this week
    await clearCalls();
    await page.click('.task-done-week > button'); await wait(100);
    check(L + ': Done this week lists what was checked off', /Renew library books/.test(await page.$eval('.task-done-week', n => n.textContent).catch(() => '')));
    await page.click('.task-done-row button'); await wait(300);
    c = await calls();
    check(L + ': Reopen', c.some(x => x.action === 'reopen_task' && x.id === 'TASK-9'), JSON.stringify(c));
    await wait(300);
    // Delete with a confirm
    await clearCalls();
    await page.click('.task-card .btn-edit'); await wait(200);
    await page.click('.task-del'); await wait(100);
    check(L + ': Delete asks first', /can't be undone/.test(await page.$eval('.task-del-confirm', n => n.textContent).catch(() => '')) && !(await calls()).some(x => x.action === 'delete_task'));
    await page.click('.task-del-yes'); await wait(300);
    c = await calls();
    check(L + ': …then deletes', c.some(x => x.action === 'delete_task'), JSON.stringify(c));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(2); });
