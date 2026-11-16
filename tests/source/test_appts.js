// Health › Appointments (Appts.js, webGetHealthAppointments_, HealthAppointmentsTab). Pins:
//  - typed Doctor and Phone per person + type, in an Appointment Contacts tab made on first save;
//    the calendar's provider fills in when nothing is typed; phones keep only phone characters;
//  - Book it: one Task "Call Dr. Lin to book a dental cleaning" with the phone in its notes;
//  - Booked ✓ counts until a visit after it is on the calendar; cleared with on='';
//  - the screen: the switch, needs booking first (overdue first), booked, up to date folded,
//    Doctor ✎, Book it, Booked ✓, Call, Log visit. Invented appointments.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AP = read('Appts.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date());
const TH = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged', 'Completed'];
function sheetOf(rows) { return { rows, getLastRow: () => rows.length,
  getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => { while (rows.length < r + i) rows.push([]); row.forEach((x, j) => { (rows[r - 1 + i] = rows[r - 1 + i] || [])[c - 1 + j] = x; }); }) }) }; }
const CAL = [{ person: 'Ahmed', type: 'Dental cleaning', provider: 'Smile Dental', intervalMonths: 6, lastVisit: '2026-03-01', nextDue: '2026-09-01', daysUntil: -76, scheduledNext: null },
  { person: 'Victoria', type: 'Eye exam', provider: '', intervalMonths: 12, lastVisit: '2025-12-01', nextDue: '2026-12-01', daysUntil: 15, scheduledNext: null }];
function ctx() {
  const tabs = { Tasks: sheetOf([TH.slice()]) };
  const c = { String, Number, Math, JSON, Date, Object, tabs, TABS: { TASKS: 'Tasks' }, TASK_HEADERS: TH, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyyMMdd' ? isoOf(d).replace(/-/g, '') : isoOf(d) }, veraLocked_: f => f(), taskNextId_: s => 'T' + s.rows.length,
    getSpreadsheet: () => ({ getSheetByName: n => tabs[n] || null, insertSheet: n => (tabs[n] = sheetOf([])) }), getHealthAppointments_: () => JSON.parse(JSON.stringify(CAL)) };
  vm.createContext(c); vm.runInContext(AP + '\n' + fnSrc(WEB, 'webGetHealthAppointments_'), c); return c;
}

console.log('\ntyped doctor and phone');
{
  const c = ctx();
  check('the calendar’s provider fills in, nothing is written by reading', c.webGetHealthAppointments_().appointments[0].doctor === 'Smile Dental' && !c.tabs['Appointment Contacts']);
  c.webApptContact_({ parameter: { person: 'Victoria', type: 'Eye exam', doctor: 'Dr. Lin', phone: '555-0164 <x>' } });
  const sh = c.tabs['Appointment Contacts'];
  check('a tab made on first save, one row per person + type', sh && J(sh.rows[0]) === J(['Person', 'Type', 'Doctor', 'Phone', 'Booked On']) && J(sh.rows[1]) === J(['Victoria', 'Eye exam', 'Dr. Lin', '555-0164', '']), J(sh && sh.rows));
  c.webApptContact_({ parameter: { person: 'victoria', type: 'EYE EXAM', phone: '(555) 0199' } });
  check('…the same row again, any case; fields not sent are kept', sh.rows.length === 2 && sh.rows[1][2] === 'Dr. Lin' && sh.rows[1][3] === '(555) 0199');
  const got = c.webGetHealthAppointments_().appointments.filter(a => a.person === 'Victoria')[0];
  check('the read merges them', got.doctor === 'Dr. Lin' && got.phone === '(555) 0199' && got.booked === false);
}

console.log('\nBook it and Booked ✓');
{
  const c = ctx();
  check('the Task’s words', c.apcTaskText_('Lin', 'Dental cleaning') === 'Call Dr. Lin to book a dental cleaning' && c.apcTaskText_('Dr. Patel', 'Eye exam') === 'Call Dr. Patel to book an eye exam' && c.apcTaskText_('Smile Dental Office', 'checkup') === 'Call Smile Dental Office to book a checkup' && c.apcTaskText_('', 'Physical') === 'Call the office to book a physical');
  c.webApptContact_({ parameter: { person: 'Victoria', type: 'Eye exam', doctor: 'Lin', phone: '555-0164' } });
  let r = c.webApptBook_({ parameter: { person: 'Victoria', type: 'Eye exam' } });
  const t = c.tabs.Tasks.rows;
  check('a Task to call, due today, with the phone in its notes', r.made && t[1][1] === 'Call Dr. Lin to book an eye exam for Victoria' && t[1][3] === TODAY && t[1][4] === 'Open' && /📞 555-0164/.test(t[1][6]) && /VERA appt book:victoria\|eye exam/.test(t[1][6]), J(t[1]));
  r = c.webApptBook_({ parameter: { person: 'Victoria', type: 'Eye exam' } });
  check('…once while it’s open', !r.made && t.length === 2);
  c.webApptBooked_({ parameter: { person: 'Ahmed', type: 'Dental cleaning' } });
  check('Booked ✓ stamps today', c.tabs['Appointment Contacts'].rows.filter(x => x[1] === 'Dental cleaning')[0][4] === TODAY && c.webGetHealthAppointments_().appointments[0].booked === true);
  check('…until a visit after it', c.apcBooked_('2026-10-01', '2026-10-15') === false && c.apcBooked_('2026-10-01', '2026-09-01') === true && c.apcBooked_('', null) === false);
  c.webApptBooked_({ parameter: { person: 'Ahmed', type: 'Dental cleaning', on: '' } });
  check('…cleared with on=""', c.webGetHealthAppointments_().appointments[0].booked === false);
}

console.log('\nthe groups');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext('var AP_SOON_=30;\n' + ['apBooked_', 'apGroups_', 'apWhen_'].map(n => fnSrc(APP, n)).join('\n'), U);
const L = [{ person: 'Victoria', type: 'Eye exam', daysUntil: 15, intervalMonths: 12 }, { person: 'Ahmed', type: 'Dental', daysUntil: -76, intervalMonths: 6 }, { person: 'Ahmed', type: 'Flu shot', daysUntil: 60, intervalMonths: 12 }, { person: 'Ahmed', type: 'Physical', daysUntil: -3, intervalMonths: 12, booked: true },
  { person: 'Victoria', type: 'Derm', daysUntil: 10, intervalMonths: 12, scheduledNext: '2026-11-30' }, { person: 'Ahmed', type: 'Eye exam', daysUntil: 200, intervalMonths: 12 }, { person: 'Ahmed', type: 'Urgent care', daysUntil: -100, intervalMonths: 0 }, { person: 'Ahmed', type: 'Allergy', daysUntil: null, intervalMonths: 12 }];
const G = U.apGroups_(L);
check('needs booking: due within 30 days or overdue, not booked, overdue first', J(G.need.map(a => a.type)) === J(['Dental', 'Eye exam']));
check('booked: Booked ✓ or on the calendar', J(G.booked.map(a => a.type).sort()) === J(['Derm', 'Physical']));
check('up to date: later, no history, and episodic', J(G.ok.map(a => a.type)) === J(['Urgent care', 'Flu shot', 'Eye exam', 'Allergy']));
check('when', U.apWhen_(L[1]) === 'Overdue 76 d' && U.apWhen_(L[0]) === 'Due in 15 d' && U.apWhen_(L[7]) === 'No visit on the calendar yet');

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
    await page.evaluate(({ list }) => {
      window.__ev = []; window.confirm = () => true;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'health_appointments') return Promise.resolve({ ok: true, appointments: list });
        if (p.action === 'appt_book') return Promise.resolve({ ok: true, made: true, task: 'Call Dr. Lin to book an eye exam for Victoria', phone: '555-0164' }); return Promise.resolve({ ok: true, nextDue: '2027-05-16' }); };
      document.body.innerHTML = '<div id="ap" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('ap')).render(React.createElement(HealthAppointmentsTab, { apiUrl: 'u', apiToken: 't' }));
    }, { list: L.map(a => Object.assign({ doctor: a.type === 'Eye exam' && a.person === 'Victoria' ? 'Dr. Lin' : '', phone: a.type === 'Eye exam' && a.person === 'Victoria' ? '555-0164' : '', lastVisit: '2026-01-10' }, a)) });
    await page.waitForTimeout(250);
    check('needs booking first, then booked; up to date folded', J(await page.$$eval('#ap .ap-sect', ns => ns.map(n => n.textContent))) === J(['Needs booking · 2', 'Booked · 2']) && /Up to date · 4 ▸/.test(await page.$eval('#ap', n => n.innerText)) && (await page.$$('#ap .ap-card')).length === 4);
    const eye = await page.$eval('#ap .ap-card[data-appt="Victoria|Eye exam"]', n => n.innerText);
    check('a card: when, the typed doctor and phone, the actions', /Due in 15 d/.test(eye) && /Dr\. Lin · 555-0164 ✎/.test(eye) && /Book it → Task/.test(eye) && /Booked ✓/.test(eye) && /Call/.test(eye), eye);
    await page.click('#ap .ap-card[data-appt="Victoria|Eye exam"] .ap-book'); await page.waitForTimeout(60);
    check('Book it makes the Task and says so', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'appt_book', person: 'Victoria', type: 'Eye exam' }) && /Task added: Call Dr\. Lin to book an eye exam for Victoria \(555-0164\)/.test(await page.$eval('#ap', n => n.innerText)));
    await page.click('#ap .ap-card[data-appt="Ahmed|Dental"] .ap-doc'); await page.fill('#ap .ap-in-doc', 'Dr. Patel'); await page.fill('#ap .ap-in-phone', '555-0101'); await page.click('#ap .ap-save'); await page.waitForTimeout(60);
    check('Doctor ✎ saves the typed doctor and phone', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'appt_contact', person: 'Ahmed', type: 'Dental', doctor: 'Dr. Patel', phone: '555-0101' }) && /Dr\. Patel · 555-0101/.test(await page.$eval('#ap .ap-card[data-appt="Ahmed|Dental"]', n => n.innerText)));
    await page.click('#ap .ap-card[data-appt="Ahmed|Dental"] .ap-booked'); await page.waitForTimeout(60);
    check('Booked ✓ moves it to Booked', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'appt_booked', person: 'Ahmed', type: 'Dental' }) && J(await page.$$eval('#ap .ap-sect', ns => ns.map(n => n.textContent))) === J(['Needs booking · 1', 'Booked · 3']));
    await page.click('#ap .ap-chip >> text=Victoria'); await page.waitForTimeout(40);
    check('the switch', J(await page.$$eval('#ap .ap-card', ns => ns.map(n => n.dataset.appt))) === J(['Victoria|Eye exam', 'Victoria|Derm']));
    await page.click('#ap .ap-card[data-appt="Victoria|Derm"] .ap-log'); await page.waitForTimeout(60);
    check('Log visit', (await page.evaluate(() => window.__ev)).some(p => p.action === 'log_health_visit' && p.person === 'Victoria' && p.type === 'Derm'));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
