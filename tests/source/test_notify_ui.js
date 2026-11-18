// Settings › Notifications in the browser, at 390 and 1280 (#250): grouped by category with Act now
// between Travel and Routines; each row's Where (Slack / Morning email / Off; check-ins Slack / Off;
// long reads Email / Off), the Slack channel only when it's Slack (any channel by name), While away
// only when it's not Off; locked rows stay locked. Invented data.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const N = (key, label, category, o) => Object.assign({ key, label, emoji: '•', category, channel: 'vera-notifications', description: label + ' description', enabled: true, locked: false, fixedChannel: false, whileAway: 'hold', delivery: 'slack', kind: 'push' }, o || {});
const MAP = { ok: true, notifications: [
  N('movement', 'Movement', 'Wellness Reminders'),
  N('morning_checkin', 'Morning Check-in', 'Wellness Reminders', { kind: 'checkin', channel: 'vera-chat' }),
  N('usps_mail', 'USPS Mail Scan', 'Routines', { delivery: 'email' }),
  N('weekly_trend_review', 'Weekly Trend Review', 'Routines', { kind: 'read', delivery: 'email', channel: 'email' }),
  N('travel_day_briefing', 'Travel Day Briefing', 'Travel', { whileAway: 'send' }),
  N('aria_book_now', 'ARIA Book Now', 'Act now', { channel: 'vera-act-now', whileAway: 'send' }),
  N('act_now_vera', 'VERA Decision Deadline', 'Act now', { channel: 'vera-act-now', whileAway: 'due', kind: 'act' }),
  N('bill_due', 'Bill Due', 'Flags & Alerts', { channel: 'family-money', whileAway: 'due' }),
  N('nightly_log', 'Nightly Run Summary', 'System Logs', { locked: true, channel: 'vera-logs' }),
] };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])) {
    const L = '@' + width + ': ';
    console.log('\nNotifications ' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept('house-ops'));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate((map) => {
      window.__gets = [];
      window.apiGet = async (u, t, p) => { window.__gets.push(p); return p.action === 'get_notification_map' ? map : { ok: true }; };
      document.body.innerHTML = '<div id="nm" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('nm')).render(React.createElement(NotificationMapPanel, { apiUrl: 'x', apiToken: 't' }));
    }, MAP);
    await page.waitForTimeout(300);
    const row = k => '#nm .nm-row[data-key="' + k + '"]';
    const opts = sel => page.$$eval(sel + ' option', ns => ns.map(n => n.textContent));
    try {
      const cats = await page.$$eval('#nm .nm-cat', ns => ns.map(n => n.dataset.cat));
      check(L + 'grouped by category, Act now between Travel and Routines', J(cats) === J(['Wellness Reminders', 'Flags & Alerts', 'Travel', 'Act now', 'Routines', 'System Logs']), J(cats));
      check(L + 'a push: Slack / Morning email / Off', J(await opts(row('movement') + ' .nm-where')) === J(['Slack', 'Morning email', 'Off']));
      check(L + 'a check-in: Slack / Off, and it says it expects a reply', J(await opts(row('morning_checkin') + ' .nm-where')) === J(['Slack', 'Off']) && /expects a reply/.test(await page.$eval(row('morning_checkin'), n => n.innerText)));
      check(L + 'a long read: Email / Off, with no Slack channel', J(await opts(row('weekly_trend_review') + ' .nm-where')) === J(['Email', 'Off']) && (await page.$(row('weekly_trend_review') + ' .nm-channel')) === null);
      check(L + 'a Morning email kind shows no Slack channel', (await page.$(row('usps_mail') + ' .nm-channel')) === null && (await page.$(row('usps_mail') + ' .nm-away')) !== null);
      check(L + 'the channel picker: the four VERA channels, the one in use, and Other', J(await opts(row('bill_due') + ' .nm-channel')) === J(['#vera-notifications', '#vera-chat', '#vera-act-now', '#vera-logs', '#family-money', 'Other channel…']));
      check(L + 'a locked row stays locked', /🔒 always on/.test(await page.$eval(row('nightly_log'), n => n.innerText)) && (await page.$(row('nightly_log') + ' select')) === null);
      await page.selectOption(row('movement') + ' .nm-where', 'email'); await page.waitForTimeout(80);
      check(L + 'choosing Morning email saves Where, and the channel goes', J((await page.evaluate(() => window.__gets)).slice(-1)[0]) === J({ action: 'set_notif_delivery', key: 'movement', value: 'email' }) && (await page.$(row('movement') + ' .nm-channel')) === null);
      await page.selectOption(row('movement') + ' .nm-where', 'off'); await page.waitForTimeout(80);
      check(L + 'Off hides While away', (await page.$(row('movement') + ' .nm-away')) === null);
      await page.selectOption(row('movement') + ' .nm-where', 'slack'); await page.waitForTimeout(80);
      await page.selectOption(row('movement') + ' .nm-channel', '__other'); await page.waitForTimeout(80);
      check(L + 'Other channel asks for its name and saves it', J((await page.evaluate(() => window.__gets)).slice(-1)[0]) === J({ action: 'set_notif_channel', key: 'movement', channel: 'house-ops' }) && /#house-ops/.test(J(await opts(row('movement') + ' .nm-channel'))));
      await page.selectOption(row('act_now_vera') + ' .nm-away', 'hold'); await page.waitForTimeout(80);
      check(L + 'While away saves', J((await page.evaluate(() => window.__gets)).slice(-1)[0]) === J({ action: 'set_notif_while_away', key: 'act_now_vera', value: 'hold' }));
      check(L + 'the hint names quiet hours and the cap', /quiet hours/.test(await page.$eval('#nm .nm-hint', n => n.innerText)) && /notif_daily_cap/.test(await page.$eval('#nm .nm-hint', n => n.innerText)));
    } catch (e) { check(L + 'the panel runs', false, e.message.split('\n')[0]); }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + 'no sideways scroll, no page errors', sw <= width && !errs.length, sw + ' ' + errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
