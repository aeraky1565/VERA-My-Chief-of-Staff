// The morning email in the agreed layout (docs/mockups/notifications.html, #250; MorningEmail.js).
//
//   ☀️ Tuesday, Nov 17: 2 things need you today
//   NEEDS YOU TODAY · YOUR DAY, SEQUENCED · THIS WEEK · HELD OVERNIGHT · ALSO
//   [Open Needs you in VERA]  Everything in this email stays quiet in Slack today. …
//
// The masthead is pinned to the email's original one: it was dropped once while the layout
// was rewritten, and nothing caught it but the preview. Invented data throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ME = read('MorningEmail.js'), CODE = read('Co' + 'de.js'), NOTIFY = read('Notify.js');

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
const c = { String, Number, JSON, Math, Date, Array, Object };
vm.createContext(c); vm.runInContext(ME, c);
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '→').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const D = { name: 'Ahmed', dateLabel: 'Tuesday, Nov 17', weatherHtml: '<tr><td>WEATHER</td></tr>',
  needs: [{ chip: 'High', text: 'Car registration expires Friday', area: 'Vehicles' }, { chip: 'Due', text: 'Electric bill, $142, due today', area: 'Bills' }],
  dayPlanHtml: '<div>DAY PLAN</div>',
  week: [{ text: 'Packing for Denver', when: 'leaves Fri', area: 'Travel', days: 3 }, { text: 'Water bill $48', when: 'Thu', area: 'Bills', days: 2 }],
  overnight: [{ label: '🎟️', text: 'Coupon ends tomorrow', at: '9:40 PM', why: 'quiet' }],
  also: [{ label: '📬', text: '2 pieces of mail arriving today', area: 'USPS' }], moreFlags: 3, dashboardUrl: 'https://example.test/vera/' };

console.log('The layout');
{
  const r = c.meRender_(D), t = strip(r.html);
  check('subject: "☀️ Tuesday, Nov 17: 2 things need you today"', r.subject === '☀️ Tuesday, Nov 17: 2 things need you today', r.subject);
  check('…one thing / nothing read right', c.meSubject_('Mon, x', 1) === '☀️ Mon, x: 1 thing needs you today' && c.meSubject_('Mon, x', 0) === '☀️ Mon, x: nothing needs you today');
  const order = ['Good morning, Ahmed.', 'Needs you today', 'DAY PLAN', 'This week', 'Held overnight', 'Also', 'Open Needs you in VERA', 'Everything in this email stays quiet in Slack today.'];
  check('the sections come in the mockup’s order', order.every((s, i) => i === 0 || t.indexOf(s) > t.indexOf(order[i - 1])), order.map(s => t.indexOf(s)).join(','));
  check('the weather strip sits under the masthead, before the greeting', r.html.indexOf('WEATHER') > r.html.indexOf('CHIEF OF STAFF') && r.html.indexOf('WEATHER') < r.html.indexOf('Good morning'));
  check('Needs you today: a High chip and a Due chip, each with its area', /High\s+Car registration expires Friday\s+Vehicles/.test(t) && /Due\s+Electric bill, \$142, due today\s+Bills/.test(t), t);
  check('This week: soonest first, with when and area', t.indexOf('Water bill $48 · Thu') < t.indexOf('Packing for Denver · leaves Fri') && /Water bill \$48 · Thu\s+Bills/.test(t));
  check('Held overnight says why and when', /🎟️ Coupon ends tomorrow \(arrived in quiet hours\)\s+9:40 PM/.test(t));
  check('…and "past today’s push limit" for the cap', /past today’s push limit/.test(strip(c.meRender_(Object.assign({}, D, { overnight: [{ text: 'x', why: 'cap' }] })).html)));
  check('Also: the email’s own kinds and the remaining flags', /📬 2 pieces of mail arriving today\s+USPS/.test(t) && /🚩 3 more flags on the Flags screen/.test(t));
  check('the button opens VERA', /href="https:\/\/example\.test\/vera\/"[^>]*>Open Needs you in VERA/.test(r.html));
  check('no old pieces: the capacity line or the priority counts', !/Light day|surfacing all|High priority:|Medium priority/.test(t));
  check('empty sections leave no heading', !/This week|Held overnight/.test(strip(c.meRender_(Object.assign({}, D, { week: [], overnight: [] })).html)));
  check('no day plan: today’s events instead', /📆 Today\s+9:00\s+Standup/.test(strip(c.meRender_(Object.assign({}, D, { dayPlanHtml: '', todayEvents: [{ time: '9:00', title: 'Standup' }] })).html)));
  check('text is escaped', c.meRender_(Object.assign({}, D, { needs: [{ chip: 'Due', text: '<b>x</b>', area: '' }] })).html.indexOf('&lt;b&gt;x&lt;/b&gt;') !== -1);
  check('the plain-text version has the same sections', /NEEDS YOU TODAY\n  High · Car registration expires Friday · Vehicles/.test(r.text) && /THIS WEEK\n  Water bill \$48 · Thu · Bills/.test(r.text) && /HELD OVERNIGHT/.test(r.text) && /ALSO/.test(r.text));
}

console.log('\nThe masthead, as it always was');
{
  const r = c.meRender_(D);
  const MAST = '<tr><td style="padding:24px 40px;background:#0d1b3e;text-align:center;"><span style="color:#ffffff;font-size:28px;font-weight:bold;letter-spacing:4px;">VERA</span><br><span style="color:#c9a84c;font-size:11px;letter-spacing:2px;">YOUR PERSONAL CHIEF OF STAFF</span></td></tr>';
  check('VERA with the gold "YOUR PERSONAL CHIEF OF STAFF" line, byte for byte', r.html.indexOf(MAST) !== -1);
  check('the logo from Drive replaces it when there is one', c.meRender_(Object.assign({}, D, { logoTag: '<img src="cid:veraLogo">' })).html.indexOf('cid:veraLogo') !== -1 && c.meRender_(Object.assign({}, D, { logoTag: '<img src="cid:veraLogo">' })).html.indexOf('CHIEF OF STAFF') === -1);
  check('the footer line stays', /Sent by VERA &mdash; Virtual Executive &amp; Reminder Assistant/.test(r.html));
  check('it fits a phone: the card is 100% wide up to 600', /<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;/.test(r.html) && !/<table width="600"/.test(r.html));
}

console.log('\nWhat goes where');
{
  const rows = [
    ['F1', '', 'Vehicle Maintenance', 'Registration expires Friday', '', 'High', '', '', '', '', '', ''],
    ['F2', '', 'Bills', 'Water bill due', '', 'Medium', '', '', '', '', '', '2026-11-19'],
    ['F3', '', 'Contracts', 'Gym contract notice', '', 'Medium', '', '', '', '', '', '2026-11-17'],
    ['F4', '', 'Home', 'Gutters', '', 'Low', '', '', '', '', '', '2026-11-16'],
    ['F5', '', 'Life', 'Try a new class', '', 'Low', '', '', '', '', '', ''],
    ['F6', '', 'Travel', 'Passport in 3 months', '', 'Medium', '', '', '', '', '', '2026-12-30'],
  ];
  c.rows = rows;
  const f = vm.runInContext('meFlagItems_(rows, "2026-11-17")', c);
  check('High flags lead, with their area from the Source', J(f.needs[0]) === J({ chip: 'High', text: 'Registration expires Friday', area: 'Vehicles' }));
  check('due today → Due; past due → Overdue', f.needs.some(x => x.chip === 'Due' && x.text === 'Gym contract notice' && x.area === 'Finances') && f.needs.some(x => x.chip === 'Overdue' && x.text === 'Gutters'));
  check('due in the next 7 days → This week, with its weekday', J(f.week) === J([{ text: 'Water bill due', when: 'Thu', area: 'Finances', days: 2 }]));
  check('the rest are counted for Also', f.more === 2);
  c.held = [{ key: 'coupon_expiry', text: 'a', why: 'quiet' }, { key: 'usps_mail', text: 'b', why: 'email' }, { key: 'x', text: 'c', why: 'cap' }, { key: 'y', text: 'd' }];
  const h = vm.runInContext('meHeldSplit_(held)', c);
  check('held: quiet hours and the cap → Held overnight; the email’s own → Also', J(h.overnight.map(x => x.text)) === '["a","c"]' && J(h.also.map(x => x.text)) === '["b","d"]');
  check('held items remember why', /function notifHold_\(key, text, why\)/.test(NOTIFY) && /notifHold_\(key, text, d\.why\)/.test(NOTIFY) && /why: why \|\| 'email'/.test(NOTIFY));
  check('dates and weekdays', c.meDateLabel_(new Date(2026, 10, 17)) === 'Tuesday, Nov 17' && c.meWeekday_(new Date(2026, 10, 19)) === 'Thu');
}

console.log('\nWhen it goes');
{
  check('nothing at all: no email', c.meIsEmpty_({}) === true && c.meIsEmpty_({ needs: [], week: [], overnight: [], also: [], moreFlags: 0 }) === true);
  check('any one thing: the email goes', ['needs', 'week', 'overnight', 'also'].every(k => c.meIsEmpty_({ [k]: [{}] }) === false) && c.meIsEmpty_({ dayPlanHtml: 'x' }) === false && c.meIsEmpty_({ moreFlags: 1 }) === false);
  const body = extractFn(CODE, 'morningNudge');
  check('no open flags is no longer a reason to skip it', !/no active flags, skipping email/.test(body) && !/no flags found, skipping email/.test(body));
  check('it skips only when every section is empty', /if \(meIsEmpty_\(/.test(body) && body.indexOf('if (meIsEmpty_(') < body.indexOf("sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText"));
  check('the email is the new layout', /var me = meRender_\(\{/.test(body) && /const htmlBody  = me\.html;/.test(body) && /subject = me\.subject;/.test(body));
  check('the intelligence block hands its facts over', /buildMorningIntelligence_\(allEvents, openTasks, capMode, intelSubTimings, meOut\)/.test(body) && /out\.dayPlanHtml = calPlanHtml;/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
