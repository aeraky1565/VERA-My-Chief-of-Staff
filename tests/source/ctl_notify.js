// Negative controls for the notifications rework (#250): break ONE rule at a time and confirm
// test_notify.js (server) or test_notify_ui.js (Settings › Notifications) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_notify_out');
const FILES = ['Notify.js', 'Code.js', 'Reminders.js', 'Slack.js', 'WebApp.js', 'Wellness.js', 'WeekendPlanner.js', 'Aria.js', 'FlightStatus.js', 'appsscript.json', 'AgentHealth.js', 'Settings.js',
  'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const on = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const nf = (from, to) => on('Notify.js', from, to);
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const SRV = 'test_notify.js', UI = 'test_notify_ui.js';

const CONTROLS = [
  ['the morning-email kinds push like any other', nf("return NOTIF_EMAIL_DEFAULT_.indexOf(key) !== -1 ? 'email' : 'slack';", "return 'slack';"), SRV],
  ['the old enabled = FALSE is ignored', nf("if (String(cfg['notif_' + key + '_enabled'] || '').toUpperCase() === 'FALSE') return 'off';", ''), SRV],
  ['a check-in can go to the email', nf("if (kind === 'checkin') return 'slack';                       // a reply needs Slack", ''), SRV],
  ['quiet hours don’t wrap past midnight', nf('return a < b ? (minute >= a && minute < b) : (minute >= a || minute < b);', 'return minute >= a && minute < b;'), SRV],
  ['quiet hours hold travel too', nf("if (st.quiet && !always) return { go: 'digest', why: 'quiet' };", "if (st.quiet) return { go: 'digest', why: 'quiet' };"), SRV],
  ['no daily cap', nf("if (!always && st.pushed >= st.cap) return { go: 'digest', why: 'cap' };", ''), SRV],
  ['check-ins count against the cap', nf("if (st.kind === 'checkin') return { go: 'send', why: 'checkin' };\n", ''), SRV],
  ['system messages are gated', nf("if (NOTIF_SYSTEM_.indexOf(key) !== -1) return { go: 'send', why: 'system' };", ''), SRV],
  ['a held line is added twice', nf("if (!line || list.some(function(x) { return x.key === key && x.text === line; })) return;", 'if (!line) return;'), SRV],
  ['yesterday never rolls over', nf("yest = counts; yest.day = st.NOTIF_DAY; counts = {};", ''), SRV],
  ['a broken gate silences VERA', nf("catch (e) { Logger.log('notifGate_ (sent anyway): ' + e.message); return true; }", "catch (e) { return false; }"), SRV],
  ['movement past work hours', nf('.filter(function(m) { return m >= a && m < b; })', '.filter(function(m) { return m >= 0; })'), SRV],
  ['a movement slot repeats', nf("(sent || []).indexOf(times[i]) === -1 ? times[i] : -1", 'times[i]'), SRV],
  ['movement on a day off', nf('function moveDue_(minute, times, sent, off) {\n  if (off) return -1;', 'function moveDue_(minute, times, sent, off) {'), SRV],
  ['holidays aren’t days off', nf("if (typeof ptsVerizonHolidays_ === 'function' && ptsVerizonHolidays_(now.getFullYear())[iso]) return true;", ''), SRV],
  ['weekend check-in time ignored', nf('if (weekend) return notifMinutes_(cfg.morning_checkin_weekend_time, 8 * 60 + 30);', ''), SRV],
  ['the old hour setting is ignored', nf('return notifMinutes_(cfg.morning_checkin_time, oldH >= 0 && oldH < 24 ? oldH * 60 : 6 * 60 + 30);', 'return notifMinutes_(cfg.morning_checkin_time, 6 * 60 + 30);'), SRV],
  ['act-now posts a coupon', nf("var ACT_NOW_DECISIONS_ = ['PPURCH|return|', 'perk_expiry_', 'contract_expiry_'];", "var ACT_NOW_DECISIONS_ = ['PPURCH|return|', 'perk_expiry_', 'contract_expiry_', 'coupon_expiry_'];"), SRV],
  ['act-now posts a resolved flag', nf("if (String(r[8]).toLowerCase() === 'yes' || String(r[6]).toLowerCase() === 'yes') return false;", ''), SRV],
  ['no act-now cap', nf("if ((c[k] || 0) >= actNowCap_(cfg, who)) return false;", ''), SRV],
  ['sendNudge_ skips the gate', on('Reminders.js', "if (notifKey && typeof notifGate_ === 'function') {", "if (false) {"), SRV],
  ['"Reminder sent" is back', on('Reminders.js', "  if (!delivered) {\n    try { sendSlackLog_(", "  {\n    try { sendSlackLog_(delivered ? '\\u23f0 Reminder sent' : "), SRV],
  ['the email never shows what was held', on('Code.js', "(typeof notifHeldHtmlNow_ === 'function' ? notifHeldHtmlNow_() : '') +", "'' +"), SRV],
  ['no count line', on('Code.js', "try { if (typeof notifCountLine_ === 'function') sendSlackLog_('📊 ' + notifCountLine_(notifCounts_().yesterday)); } catch (ncErr) {}", ''), SRV],
  ['the weekend memo pings Slack again', on('WeekendPlanner.js', "  if (typeof notifGate_ !== 'function' || notifGate_('weekend_memo', 'Weekend memo')) {", "  sendSlack_('vera-notifications', '🗓️ Weekend memo is ready — check your email.');\n  if (true) {"), SRV],
  ['no sleep row', on('Slack.js', "  if (sleepHours === null) {\n    blocks.push({ type: 'actions', block_id: 'wellness_row_hours'", "  if (false) {\n    blocks.push({ type: 'actions', block_id: 'wellness_row_hours'"), SRV],
  ['the old rules run again', on('Reminders.js', "    function() { checkMovement_(now, cfg); },", "    function() { checkMovement_(now, cfg); },\n    function() { checkErgonomicBreak_(hour, isWeekday, cfg); },"), SRV],
  ['HAILEY posts listings over the ceiling', nf("&& /under/i.test(String(col(r, 'cost flag')))) {", ') {'), SRV],
  ['HAILEY posts any old listing', nf("if (status === 'new' && iso(col(r, 'first seen')) === today &&", "if (status === 'new' &&"), SRV],
  ['HAILEY posts an old price cut', nf("if (status !== 'gone' && last && last.slice(-10) === today) {", "if (status !== 'gone' && last) {"), SRV],
  ['HAILEY posts a home that’s gone', nf("if (status !== 'gone' && last && last.slice(-10) === today) {", "if (last && last.slice(-10) === today) {"), SRV],
  ['TESS posts below the bar', nf("|| !(score >= min)) return;", ') return;'), SRV],
  ['TESS posts a passed match', nf("if (String(col(r, 'status')).trim().toLowerCase() !== 'new' || iso(", 'if (iso('), SRV],
  ['an Open button without a link', nf("if (/^https:\\/\\//.test(item.url || '')) blocks.push(", 'blocks.push('), SRV],
  ['hourlyCheck doesn’t post HAILEY and TESS', on('Reminders.js', '  try { actNowAgentsSync_(new Date()); } catch (anErr) {}', ''), SRV],
  ['long keys are kept whole', nf("if (k.length <= 40) return k;", 'return k;'), SRV],
  ['the posted list grows past 9 KB', nf('JSON.stringify(out.slice(-200))', 'JSON.stringify(out)'), SRV],
  ['the old NOTIF list is never carried over', nf("if (!list.length) { try { list = JSON.parse(veraStateGet_('NOTIF').NOTIF_ACTNOW", "if (false) { try { list = JSON.parse(veraStateGet_('NOTIF').NOTIF_ACTNOW"), SRV],
  ['WILLA posts a CD months out', nf('if (d < 0 || d > 7) return;', 'if (d < 0) return;'), SRV],
  ['WILLA posts the plan every day', nf('if (day <= 3 && due.length) {', 'if (due.length) {'), SRV],
  ['WILLA forgets what can wait', nf("+ (wait ? ' ' + wait + ' can wait.' : '')", ''), SRV],
  ['HAILEY posts any home that went', nf('if (!under && !shown) return;', ''), SRV],
  ['HAILEY posts a home gone days ago', nf("if (String(col(r, 'notes')).indexOf('Gone ' + today) === -1) return;", ''), SRV],
  ['TESS closing date on any status', nf("    if (low === 'saved') {\n      var m = String(col(r, 'notes'))", "    if (true) {\n      var m = String(col(r, 'notes'))"), SRV],
  ['TESS first run posts every status', nf("var out = [], next = { _: 1 }, firstRun = !seen || !seen._;", "var out = [], next = { _: 1 }, firstRun = false;"), SRV],
  ['TESS repeats an unchanged status', nf("&& seen[id] !== low) {", ') {'), SRV],
  ['TESS statuses are never remembered', nf("try { if (tId) veraStateSet_('ACTNOW', { ACTNOW_SEEN: JSON.stringify(seen) }); }", 'try { 0; }'), SRV],
  ['agent down ignores Off', on('AgentHealth.js', "    if (where === 'off') return;\n", ''), SRV],
  ['agent down ignores its channel', on('AgentHealth.js', "var ch = known ? getNotifChannel_(key) : 'vera-logs';", "var ch = 'vera-logs';"), SRV],
  ['the nightly check posts all agents to #vera-logs', on('AgentHealth.js', 'if (ch.items.length) { try { agentHealthPost_(ch.items); } catch (e) {} }', "if (ch.lines.length) { try { sendSlackLog_('🤖 Agent health\\n' + ch.lines.join('\\n')); } catch (e) {} }"), SRV],
  ['a push can’t go to the morning email', ui("return kind==='checkin'?[['slack','Slack'],['off','Off']]:kind==='read'?[['email','Email'],['off','Off']]:[['slack','Slack'],['email','Morning email'],['off','Off']];", "return [['slack','Slack'],['off','Off']];")],
  ['the channel shows when it isn’t Slack', ui("where==='slack'&&h('select',{className:'nm-channel'", "h('select',{className:'nm-channel'")],
  ['no other channel', ui(",h('option',{key:'o',value:'__other'},'Other channel…')", '')],
  ['While away shows when Off', ui("where!=='off'&&n.whileAway&&n.key!=='morning_briefing'&&h('select',{className:'nm-away'", "n.whileAway&&n.key!=='morning_briefing'&&h('select',{className:'nm-away'")],
  ['an out-of-date list shows "unknown key"', ui("if(/unknown key/i.test(e.message||'')){", "if(false){")],
  ['Act now isn’t a category', ui("'Travel','Act now','Routines'", "'Travel','Routines'")],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  if (process.env.CTL_ONLY && c[0] !== process.env.CTL_ONLY) return;
  const test = c[2] || UI;
  if (test === UI && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + c[0] + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0] + '  (' + test + ')');
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit: ' + fails[0]);
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
