// System › Settings › Feature Flags, Config and Feature map in the browser (#254), at 390 and 1280.
// The data comes from the real Features.js routes run in node over invented Config values, so the
// page is tested against what the server really sends. Invented data throughout.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

// ---- the server's answer, from Features.js -------------------------------------------------
const CFG = { fitness_enabled: 'TRUE', email_parser_enabled: 'FALSE', pantry_enabled: 'FALSE', pantry_paused_until: '2099-01-02', experiments_enabled: 'FALSE',
  morning_nudge_email: 'someone@example.test', slack_victoria_user_id: 'PASTE_VICTORIA_USER_ID', planner_sheet_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  skip_calendars: 'Holidays Test', gap_calendars: 'Work Test, Home Test', victoria_calendars: 'Home Test', life_calendars: 'Home Test', bill_calendars: 'Bills Test',
  weekend_planner_narrative_calendars: 'Home Test', holiday_keywords: 'Day, Holiday', ignore_keywords: 'Pay Day', 'calendar_label:Work Test': 'My work',
  slack_chat_channel_id: 'C0TEST0001', mystery_setting: 'keep me', pretrip_briefing_hours: '36' };
function serverFlags(cfg) {
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, Number, parseInt,
    Utilities: { formatDate: () => '2026-11-19' }, Session: { getScriptTimeZone: () => 'UTC' },
    getConfigValues: () => cfg, peopleOwnerOnly_: () => null, veraStateGet_: () => ({ STEPS_LAST: J({ checkGymSessions_: Math.round(Date.now() / 1000) - 7200 }) }),
    getHeartbeatState_: () => ({ checkFlightStatuses_: { lastRun: new Date(Date.now() - 4 * 60000).toISOString() } }), setConfigRow_: () => true,
    NOTIF_REGISTRY: [{ key: 'gym_checkin', label: 'Gym Check-in' }, { key: 'pretrip_briefing', label: 'Pre-trip Briefing' }, { key: 'aria_book_now', label: 'ARIA Book Now' }] };
  vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(ROOT, 'Features.js'), 'utf8'), c);
  return JSON.parse(J(c.webFeatureFlags_()));
}
const FLAGS = serverFlags(CFG), FLAGS_FIT_OFF = serverFlags(Object.assign({}, CFG, { fitness_enabled: 'FALSE' }));
const ROWS = Object.keys(CFG).map(k => ({ key: k, value: CFG[k] })).concat([{ key: 'SYSTEM-WIDE: GENERAL', value: '' },
  { key: 'SYSTEM-WIDE: ASSISTANTS (HOME ROSTER)', value: '' }, { key: 'roster_link_zed', value: 'https://example.com/zed' }, { key: 'roster_link_quin', value: 'https://example.com/quin' },
  { key: 'GIFTS & WISH LISTS', value: '' }, { key: 'gift_initials_ZZ', value: 'Zed Zee' },
  { key: 'PTO: SAM', value: '' }, { key: 'sam_pto_year', value: '2026' }]);

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])) {
    const L = '@' + width + ': ';
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    const mount = async (comp, flags) => page.evaluate(([comp, flags, rows]) => {
      window.__gets = []; window.__posts = [];
      window.apiGet = async (u, t, p) => { window.__gets.push(p);
        if (p.action === 'feature_flags') return flags;
        if (p.action === 'get_config_rows') return { ok: true, rows };
        if (p.action === 'config_files') return { ok: true, files: { planner_sheet_id: { ok: true, name: 'Planner Test', url: 'https://docs.example.test/p', updated: new Date().toISOString() }, notes_doc_id: { ok: false, why: 'Not set' } } };
        if (p.action === 'config_calendars') return { ok: true, calendars: ['Home Test', 'Work Test', 'Bills Test', 'Holidays Test', 'School Test'] };
        return { ok: true }; };
      window.apiPost = async (u, t, b) => { window.__posts.push(b); return { ok: true }; };
      document.body.innerHTML = '<div id="t" style="padding:0 16px"></div>';
      if (window.__root) window.__root.unmount();
      window.__go = [];
      window.__root = ReactDOM.createRoot(document.getElementById('t'));
      window.__root.render(React.createElement(window[comp], { apiUrl: 'x', apiToken: 't', go: id => window.__go.push(id) }));
    }, [comp, flags, ROWS]);
    const wait = ms => page.waitForTimeout(ms);
    const last = async (kind) => (await page.evaluate(k => window[k], kind)).slice(-1)[0];
    try {
      // ---- Feature Flags ----
      console.log('\nFeature Flags ' + L);
      await mount('SysFeatureFlags', FLAGS); await wait(250);
      if (process.env.FF_SHOT) await page.screenshot({ path: process.env.FF_SHOT + '-flags-' + width + '.png' });
      const groups = await page.$$eval('.ff-group h3', n => n.map(x => x.textContent));
      check(L + 'grouped by area, all nine', J(groups) === J(['Travel', 'Health', 'Home & food', 'Money', 'People & gifts', 'Work & career', 'Daily life', 'Assistants', 'System']), J(groups));
      const stats = await page.$$eval('.ff-stat', n => n.map(x => x.innerText.replace(/\s+/g, ' ')));
      check(L + 'counts: features, on, off, paused', /^51 Features/i.test(stats[0]) && /1 Paused/i.test(stats[3]) && /2 Off/i.test(stats[2]), J(stats));
      check(L + 'a paused one says when it comes back, with Resume now', /Back Jan 2/i.test(await page.$eval('.ff-row[data-k="pantry"]', n => n.innerText)) && /Resume now/.test(await page.$eval('.ff-row[data-k="pantry"]', n => n.innerText)));
      check(L + 'last activity from the run times', /Last ran 2 h ago/.test(await page.$eval('.ff-row[data-k="gym_tracker"]', n => n.innerText)) && /Last ran 4 min ago/.test(await page.$eval('.ff-row[data-k="flight_status"]', n => n.innerText)));
      check(L + 'who sees it, shown only', /Victoria sees it/.test(await page.$eval('.ff-row[data-k="pantry"]', n => n.innerText)) && /Owner only/.test(await page.$eval('.ff-row[data-k="notes"]', n => n.innerText)));
      await page.click('.ff-row[data-k="takeouts"] .ff-switch'); await wait(120);
      check(L + 'a simple feature turns off at once', J(await last('__posts')) === J({ action: 'set_feature', key: 'takeouts', state: 'off' }) && /Takeouts is off/.test(await page.textContent('.ff-toast')));
      await page.click('.ff-toast button'); await wait(120);
      check(L + '…and Undo puts it back', J(await last('__posts')) === J({ action: 'set_feature', key: 'takeouts', state: 'on' }));
      await page.click('.ff-row[data-k="fitness"] .ff-switch'); await wait(120);
      const sheet = await page.textContent('.ff-sheet');
      check(L + 'a bigger one asks first and lists what stops: its screen, its check, what needs it, its notifications', /Turn off Fitness\?/.test(sheet) && /screen hides/.test(sheet) && /Gym check-ins turns off too/.test(sheet) && /Notifications these go to Off/.test(sheet), sheet.slice(0, 300));
      await page.click('.ff-sheet .ff-btn.primary'); await wait(120);
      check(L + '…then turns it off', J(await last('__posts')) === J({ action: 'set_feature', key: 'fitness', state: 'off' }));
      await page.click('.ff-row[data-k="run_log"] .ff-switch'); await wait(120);
      check(L + 'a risky one warns in red', /Heads up/.test(await page.textContent('.ff-sheet')) && !!(await page.$('.ff-sheet .ff-btn.danger')));
      await page.click('.ff-sheet .ff-btn:not(.danger)'); await wait(80);
      await page.click('.ff-row[data-k="explorer"] .ff-more:not(.ff-cfgbtn)'); await wait(120);
      await page.fill('.ff-sheet input[type=date]', '2099-03-01'); await page.click('.ff-sheet .ff-btn.primary'); await wait(120);
      check(L + 'Off until a date', J(await last('__posts')) === J({ action: 'set_feature', key: 'explorer', state: 'paused', until: '2099-03-01' }));
      await page.click('.ff-row[data-k="pretrip_briefing"] .ff-cfgbtn'); await wait(80);
      check(L + 'a feature’s own settings, with today’s value', /Send it 36 hours/.test(await page.textContent('.ff-row[data-k="pretrip_briefing"] .ff-cfgbtn')) && await page.inputValue('#ffc_pretrip_briefing_hours') === '36');
      await page.fill('#ffc_pretrip_briefing_hours', '24'); await page.press('#ffc_pretrip_briefing_hours', 'Tab'); await wait(120);
      check(L + '…saved as you leave the field', J(await last('__posts')) === J({ action: 'set_feature_setting', key: 'pretrip_briefing_hours', value: '24' }));
      await page.fill('.ff-search input', 'lookback'); await wait(60);
      check(L + 'search finds a feature by its settings', J(await page.$$eval('.ff-row', n => n.map(x => x.dataset.k))) === J(['gym_tracker']));
      await page.fill('.ff-search input', ''); await page.click('.ff-seg button:nth-child(2)'); await wait(60);
      check(L + 'By kind: five groups', (await page.$$eval('.ff-group h3', n => n.length)) === 5);
      await page.click('.ff-seg button:nth-child(1)');
      await mount('SysFeatureFlags', FLAGS_FIT_OFF); await wait(250);
      check(L + 'a feature whose need is off is blocked: its switch disabled, and it says why', await page.$eval('.ff-row[data-k="gym_tracker"] .ff-switch', n => n.disabled) && /Off because Fitness is off/.test(await page.$eval('.ff-row[data-k="gym_tracker"]', n => n.innerText)));
      let sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check(L + 'Feature Flags: no sideways scroll', sw <= width, sw);

      // ---- Config ----
      console.log('\nConfig ' + L);
      await mount('SysConfigPanel', FLAGS); await wait(300);
      if (process.env.FF_SHOT) { await page.screenshot({ path: process.env.FF_SHOT + '-config-' + width + '.png' }); await page.$eval('#cf_calgrid', n => n.scrollIntoView()); await page.screenshot({ path: process.env.FF_SHOT + '-cal-' + width + '.png' }); await page.evaluate(() => window.scrollTo(0, 0)); }
      const cg = await page.$$eval('.cf .ff-group h3', n => n.map(x => x.textContent));
      check(L + 'grouped: files, calendars, Slack & email, places, time off, words, general, everything else', J(cg) === J(['Linked files', 'Calendars', 'Slack & email', 'Places & home', 'Time off', 'Words VERA looks for', 'General', 'Other', 'Assistants', 'Gifts & Wish Lists', 'PTO: Sam']), J(cg));
      check(L + 'everything else is grouped under the Config tab\'s own headings, with their rows', /^Everything else/.test(await page.textContent('.cf-others-h')) &&
        J(await page.$$eval('.cf-ogroup', n => n.map(g => g.querySelector('h3').textContent + ':' + Array.from(g.querySelectorAll('.cf-okey')).map(c => c.textContent).join(',')))) ===
        J(['Other:mystery_setting', 'Assistants:roster_link_zed,roster_link_quin', 'Gifts & Wish Lists:gift_initials_ZZ', 'PTO: Sam:sam_pto_year']));
      check(L + 'an email address is masked until you tap Show', /•••• test/.test(await page.$eval('#cf_email', n => n.innerText)) && !(await page.$('#cf_email input')));
      await page.click('#cf_email .ff-more'); await wait(60);
      check(L + '…then it can be edited', await page.inputValue('#cf_email input') === 'someone@example.test');
      check(L + 'a file card: its name, Open, and the ID masked', /Planner Test/.test(await page.$eval('#cf_planner', n => n.innerText)) && /•••• 2345/.test(await page.$eval('#cf_planner', n => n.innerText)) && !!(await page.$('#cf_planner a[href="https://docs.example.test/p"]')));
      check(L + 'a placeholder left in needs a look', /Not set: it still says PASTE_VICTORIA_USER_ID/.test(await page.$eval('#cf_u_vic', n => n.innerText)));
      const calRows = await page.$$eval('#cf_calgrid tbody tr td:first-child b', n => n.map(x => x.textContent));
      check(L + 'the calendar grid lists the calendars in use, and their names', J(calRows.slice().sort()) === J(['Bills Test', 'Holidays Test', 'Home Test', 'Work Test']) && await page.inputValue('[aria-label="Work Test shown as"]') === 'My work', J(calRows));
      check(L + '…a skipped calendar’s other boxes are off', await page.$eval('[aria-label="Holidays Test: Free time"]', n => n.disabled));
      await page.click('[aria-label="Bills Test: Free time"]'); await wait(120);
      check(L + 'ticking a box saves that list', J(await last('__gets')) === J({ action: 'set_config_value', key: 'gap_calendars', value: 'Work Test, Home Test, Bills Test' }));
      await page.selectOption('#cfCalAdd', 'School Test'); await page.click('#cf_calgrid .cf-field .ff-more'); await wait(80);
      check(L + 'a calendar VERA can see can be added', (await page.$$eval('#cf_calgrid .cf-grid tbody tr', n => n.length)) === 5);
      await page.click('#cf_kw_ign .cf-kw button'); await wait(120);
      check(L + 'a keyword chip is removed', J(await last('__gets')) === J({ action: 'set_config_value', key: 'ignore_keywords', value: '' }));
      check(L + 'dependencies: used by (a feature link), needs, needed by', /Used by/.test(await page.$eval('#cf_kw_ign', n => n.innerText)) && /Needs/.test(await page.$eval('#cf_kw_ign', n => n.innerText)) && /Needed by/.test(await page.$eval('#cf_kw_hol', n => n.innerText)));
      await page.click('#cf_planner .cf-dep'); await wait(60);
      check(L + '…a feature link opens Feature Flags', J(await page.evaluate(() => window.__go)) === J(['flags']));
      await page.click('#cf_planner summary'); await wait(40);
      check(L + 'the raw Config line, masked too', /planner_sheet_id\s*•••• 2345/.test(await page.$eval('#cf_planner .cf-rawline', n => n.innerText)));
      check(L + 'a row nothing owns is still editable, and headings and feature settings stay out', /mystery_setting/.test(await page.textContent('.cf')) && !/SYSTEM-WIDE: GENERAL/.test(await page.textContent('.cf')) && !(await page.$('.cf-otherrow input[aria-label="pretrip_briefing_hours"]')));
      await page.click('.ff-stat:nth-child(4)'); await wait(60);
      check(L + 'the settings that moved, each with its feature', /Pre-trip briefing/.test(await page.textContent('.cf')) && /Send it: 36/.test(await page.textContent('.cf')));
      sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check(L + 'Config: no sideways scroll', sw <= width, sw);

      // ---- Feature map ----
      console.log('\nFeature map ' + L);
      await mount('SysFeatureMap', FLAGS_FIT_OFF); await wait(250);
      const n0 = await page.$$eval('.fm-node', n => n.length);
      check(L + 'the map draws settings, features and where you see them', n0 > 60 && (await page.$$eval('.fm-node.ft', n => n.length)) === 51 && (await page.$$eval('.fm-node.out', n => n.length)) > 5, n0);
      check(L + 'an off feature is dashed', await page.$eval('[data-mnode="fitness"]', n => n.classList.contains('off')));
      await page.click('[data-mnode="gym_tracker"]'); await wait(80);
      if (process.env.FF_SHOT) await page.screenshot({ path: process.env.FF_SHOT + '-map-' + width + '.png' });
      const info = await page.textContent('.fm-info');
      check(L + 'tapping a feature: what it reads, what it needs, where it shows up', /Reads from/.test(info) && /Needs/.test(info) && /Fitness/.test(info) && /Shows up in/.test(info), info.slice(0, 200));
      check(L + '…its paths light up', (await page.$$eval('.fm-edge.hot', n => n.length)) > 0);
      await page.click('[data-mnode="cfg_planner"]'); await wait(80);
      check(L + 'tapping a setting: what would lose it', /would lose it/.test(await page.textContent('.fm-info')));
      await page.click('.ff-chip:nth-child(2)'); await wait(80);
      check(L + 'an area chip narrows the map', (await page.$$eval('.fm-node.ft', n => n.length)) === 6);
      sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check(L + 'Feature map: no sideways page scroll (the map scrolls in its own box)', sw <= width, sw);
    } catch (e) { check(L + 'the panels run', false, e.message.split('\n')[0]); }
    check(L + 'no page errors', !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
