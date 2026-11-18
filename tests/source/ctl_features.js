// Negative controls for Settings › Feature Flags, Config and Feature map (#254): break ONE rule at a
// time and confirm test_features.js (server) or test_featureflags_ui.js (the three subtabs) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_features_out');
const FILES = ['Features.js', 'Co' + 'de.js', 'WebApp.js', 'Notify.js', 'FlightStatus.js', 'MailCounter.js', 'NeighborhoodWatcher.js', 'Aria.js', 'RunLog.js', 'Away.js', 'GymTracker.js',
  'Reminders.js', 'EmailParser.js', 'PostTripCapture.js', 'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const on = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const fe = (from, to) => on('Features.js', from, to);
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const SRV = 'test_features.js', UI = 'test_featureflags_ui.js';

const CONTROLS = [
  ['FALSE doesn’t turn a feature off', fe("if (raw === 'FALSE') own =", "if (false) own ="), SRV],
  ['a pause never comes back', fe("(until > today ? 'paused' : 'on')", "'paused'"), SRV],
  ['needs are ignored', fe("if (f.needs && featureStateFrom_(f.needs, cfg, today, seen) !== 'on') return 'blocked';", ''), SRV],
  ['notifications don’t follow their feature', fe("return featureStateFrom_(k, cfg, today || featureIsoToday_()) === 'on' ? '' : k;", "return '';"), SRV],
  ['an off feature’s screens show', fe("if ((f.screens || []).length && featureStateFrom_(f.k, cfg, today) !== 'on') out = out.concat(f.screens);", ''), SRV],
  ['an off feature’s steps run', fe("return k && !featureOn_(k) ? k : '';", "return '';"), SRV],
  ['steps of other features are noted', fe("timings.forEach(function(t) { if (t && known[t.name]) map[t.name] = now; });", "timings.forEach(function(t) { if (t) map[t.name] = now; });"), SRV],
  ['last activity ignores heartbeats', fe("v = b && b.lastRun ? new Date(b.lastRun).getTime() : 0;", 'v = 0;'), SRV],
  ['a pause on a past date is taken', fe("|| until <= today))", '))'), SRV],
  ['a pause keeps the switch on', fe("setConfigRow_(k + '_enabled', state === 'on' ? 'TRUE' : 'FALSE');", "setConfigRow_(k + '_enabled', state === 'off' ? 'FALSE' : 'TRUE');"), SRV],
  ['any Config row can be set as a feature setting', fe("if (!x) return { ok: false, error: 'That isn’t a feature setting.' };", "if (!x) x = { type: 'text' };"), SRV],
  ['a pause that’s due stays off', fe("if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(until) || until > today) return;\n    try { setConfigRow_(f.k + '_enabled', 'TRUE');", "if (true) return;\n    try { setConfigRow_(f.k + '_enabled', 'TRUE');"), SRV],
  ['the purge takes a live row', fe("var CONFIG_RETIRED_PATTERNS_ = [/^notif_(water_break|desk_break|calendar_opportunity)_/];", "var CONFIG_RETIRED_PATTERNS_ = [/^notif_/];"), SRV],
  ['feature_flags isn’t owner only', fe("function webFeatureFlags_() {\n  var refused = peopleOwnerOnly_(); if (refused) return refused;", 'function webFeatureFlags_() {'), SRV],
  ['config rows readable by anyone', on('WebApp.js', "case 'get_config_rows':  return jsonOut_(peopleOwnerOnly_() || webGetConfigRows_());", "case 'get_config_rows':  return jsonOut_(webGetConfigRows_());"), SRV],
  ['nightlyStep_ ignores the switch', on('Co' + 'de.js', "var offBy = typeof featureOffStep_ === 'function' ? featureOffStep_(name) : '';", "var offBy = '';"), SRV],
  ['flight polling ignores the switch', on('FlightStatus.js', "&& typeof featureOn_ === 'function' && !featureOn_('flight_status')) {", '&& false) {'), SRV],
  ['away mode ignores the switch', on('Away.js', "if (typeof featureOn_ === 'function' && !featureOn_('away_mode'))", 'if (false)'), SRV],
  ['email parsing can’t come back on as TRUE', on('EmailParser.js', "if (String(enabled || '').trim().toLowerCase() !== 'true') {", "if (enabled !== 'true') {"), SRV],
  ['the switch turns a big feature off without asking', ui("if(f.risky||deps.length||(f.notif||[]).length||(f.t||[]).length>2)return setSheet({f:f,mode:'off'});", '')],
  ['no Undo', ui("showToast(msg,prev?function(){send(f,prev,f.n+' is back as it was',null);}:null);", 'showToast(msg,null);')],
  ['a blocked feature can be switched', ui("disabled:b||e==='blocked',onClick:function(){flip(f);}", 'disabled:b,onClick:function(){flip(f);}')],
  ['the sheet hides what needs it', ui("(all||[]).filter(function(d){return d.needs===f.k;}).forEach(function(d){out.push(d.n+' turns off too (it needs this)');});", '')],
  ['search ignores settings', ui("+' '+(f.cfg||[]).map(function(x){return x.l+' '+x.c;}).join(' ')).toLowerCase().indexOf(ql)", ").toLowerCase().indexOf(ql)")],
  ['emails show unmasked', ui("if(i.mask&&!shown[i.id])return h('div',{className:'cf-field'},", "if(false)return h('div',{className:'cf-field'},")],
  ['a skipped calendar’s boxes stay on', ui("dis=skipped&&c.k!=='skip_calendars';", 'dis=false;')],
  ['no Needed by', ui("if(by.length)parts.push(h('span',{key:'b',className:'cf-dl'},'Needed by')", "if(false)parts.push(h('span',{key:'b',className:'cf-dl'},'Needed by')")],
  ['section headings show as settings', b => { const x = ui("&&!/^[A-Z0-9 &:,()\\-–'’.\\/]+$/.test(k);});}", ';});}')(b), y = ui("{head=/^CONTENTS/.test(k)?'':k;return;}", "{head=/^CONTENTS/.test(k)?'':k;}")(x);
    return y; }],
  ['everything else is one pile again (headings ignored)', ui("t=head?cfHeadTitle_(head):'Other';", "t='Other';")],
  ['a heading keeps its SYSTEM-WIDE prefix', ui("replace(/^SYSTEM-WIDE:\\s*/i,'')", "replace(/^$/,'')")],
  ['the map loses the needs links', ui("if(f.needs&&has[f.needs])add(f.needs,f.k,true);", '')],
  ['an off feature isn’t marked on the map', ui("(s==='off'||s==='blocked'?' off':s==='paused'?' paused':'')", "''")],
  ['Notifications doesn’t say which feature turned it off', ui("n.offBy&&h('div',{className:'nm-offby'", "false&&h('div',{className:'nm-offby'"), 'test_notify_ui.js'],
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
