// Negative controls for #246: revert ONE rule at a time and confirm
// test_awaymode.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_awaymode');
const FILES = ['Away.js', 'Code.js', 'WebApp.js', 'Reminders.js', 'Claude.js', 'TravelerProfiles.js', 'Pacing.js', 'Wellness.js', 'MonthlyReview.js', 'Memory.js', 'EmailAdmin.js', 'docs/app.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const A = 'Away.js', C = 'Code.js', W = 'WebApp.js', R = 'Reminders.js', APP = 'docs/app.js';
const CONTROLS = [
  ['the switch ignores its end date', b => ({ [A]: swap(b[A], "if (st.AWAY_MANUAL === 'on' && (!until || today <= until)) {", "if (st.AWAY_MANUAL === 'on') {") })],
  ['a trip ended early comes back on', b => ({ [A]: swap(b[A], " && trip && trip !== String(st.AWAY_ENDED_TRIP || '')) {", " && trip) {") })],
  ['send holds anyway', b => ({ [A]: swap(b[A], "  if (policy === 'send') return false;\n", "") })],
  ['due ignores the deadline', b => ({ [A]: swap(b[A], "return !(d && (!away.until || d <= away.until)); }", "return false; }") })],
  ['a Config override is ignored', b => ({ [A]: swap(b[A], "  if (AWAY_POLICIES_.indexOf(v) !== -1) return v;\n", "") })],
  ['held ones are not counted', b => ({ [A]: swap(b[A], "    if (held) awayNoteHeld_(key);\n", "") })],
  ['any urgency gets through', b => ({ [A]: swap(b[A], "  if (String(flag && flag.urgency) !== 'High') return false;\n", "") })],
  ['any source gets through', b => ({ [A]: swap(b[A], "  if (!AWAY_DATED_PREFIXES_.some(function(p) { return k.indexOf(p) === 0; })) return false;\n", "") })],
  ['a late deadline gets through', b => ({ [A]: swap(b[A], "  return !!due && (!away.until || due <= away.until);", "  return !!due;") })],
  ['flags from before the trip are counted', b => ({ [A]: swap(b[A], "return (!since || awayIso_(x.date) >= since) && !awayFlagGetsThrough_(x, away);", "return !awayFlagGetsThrough_(x, away);") })],
  ['reminders and nudges lumped together', b => ({ [A]: swap(b[A], "if (AWAY_REMINDER_KEYS_.indexOf(k) !== -1) reminders += n; else nudges += n;", "nudges += n;") })],
  ['turning on again resets the start day', b => ({ [A]: swap(b[A], "AWAY_STARTED: was && st.AWAY_STARTED ? st.AWAY_STARTED : today,", "AWAY_STARTED: today,") })],
  ['ending early forgets the trip', b => ({ [A]: swap(b[A], "AWAY_ENDED_TRIP: st.VACATION_MODE_ACTIVE === 'true' ? (st.VACATION_TRIP_NAME || null) : null,", "AWAY_ENDED_TRIP: null,") })],
  ['the trip name is not escaped', b => ({ [A]: swap(b[A], "(label ? ' of the <strong>' + awayEsc_(label) + '</strong>' : '')", "(label ? ' of the <strong>' + label + '</strong>' : '')") })],
  ['a quiet day still says something needs you', b => ({ [A]: swap(b[A], "  if (!quiet) {\n", "  if (true) { d.through = d.through || [];\n") })],
  ['a registry default changed', b => ({ [C]: swap(b[C], "description: 'Hydration reminder', locked: false, whileAway: 'hold' }", "description: 'Hydration reminder', locked: false, whileAway: 'send' }") })],
  ['coupons no longer send if due', b => ({ [C]: swap(b[C], "description: 'Coupon or deal expiring soon', locked: false, whileAway: 'due' }", "description: 'Coupon or deal expiring soon', locked: false, whileAway: 'hold' }") })],
  ['the exact-key writer drops the deadline', b => ({ [C]: swap(b[C], "'No', '', 'No', f.key, '', flagDueCell_(f.due),", "'No', '', 'No', f.key, '',") })],
  ['the upsert drops the deadline', b => ({ [C]: swap(b[C], "'No', '', 'No', key, '', flagDueCell_(wanted[key].due),", "'No', '', 'No', key, '',") })],
  ['a bad Due value is kept', b => ({ [C]: swap(b[C], "  return /^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? s : '';\n}", "  return s;\n}") })],
  ['the coupon producer drops its deadline', b => ({ [C]: swap(b[C], "key: flagKey, due: expiry }", "key: flagKey }") })],
  ['escalation runs while away', b => ({ [C]: swap(b[C], "  if (typeof awayStatus_ === 'function' && awayStatus_().on) { Logger.log('escalateAgedFlags_: away, nothing escalated'); return; }\n", "") })],
  ['the morning email ignores Away mode', b => ({ [C]: swap(b[C], "    if (typeof awayStatus_ === 'function' && awayStatus_().on) {\n      sendAwayEditionEmail_();\n      return;\n    }\n", "") })],
  ['trip days are light again', b => ({ [C]: swap(b[C], "capacity_inferred_mode: 'busy',", "capacity_inferred_mode: 'light',") })],
  ['nudges ignore Away mode', b => ({ [R]: swap(b[R], "  if (notifKey && typeof awayHolds_ === 'function' && awayHolds_(notifKey, due)) {", "  if (false) {") })],
  ['the bill reminder drops its due date', b => ({ [R]: swap(b[R], "      'bill_due',\n      dueIso", "      'bill_due'") })],
  ['Claude’s due date taken as is', b => ({ 'Claude.js': swap(b['Claude.js'], "due:     /^\\d{4}-\\d{2}-\\d{2}$/.test(String(f.due || '').trim()) ? String(f.due).trim() : '',", "due:     String(f.due || ''),") })],
  ['a locked row can be changed', b => ({ [W]: swap(b[W], "  if (entry.locked) return { ok: false, error: 'locked' };\n  setConfigRow_('notif_' + key + '_while_away', value);", "  setConfigRow_('notif_' + key + '_while_away', value);") })],
  ['the banner shows the trip key', b => ({ [A]: swap(b[A], 'trip: awayTripLabel_(a.trip), started', 'trip: a.trip, started') })],
  ['a past date is accepted', b => ({ [W]: swap(b[W], "  if (on && until && until < awayToday_()) return { ok: false, error: 'that date has already passed' };\n", "") })],
  ['Home without the Away banner', b => ({ [APP]: swap(b[APP], "React.createElement(AwayBanner,{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate}),", "") })],
  ['the While away setting never saves', b => ({ [APP]: swap(b[APP], "api({action:'set_notif_while_away',key:key,value:value})", "Promise.resolve({ok:true})") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_awaymode.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
