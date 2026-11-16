// Negative controls for test_neighborhood.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_neighborhood');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Neighborhood.js'], FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']);
const CONTROLS = [
  ['Going adds a second event', swapIn(S, "    if (eventId) return { calendar: 'kept' };\n", "")],
  ['another answer leaves the event', swapIn(S, "    if (e) e.deleteEvent();", "    if (false) e.deleteEvent();")],
  ['the event id isn’t cleared', swapIn(S, "  sh.getRange(row, NB_EVENT_COL_).setValue('');\n  return { calendar: 'removed' };", "  return { calendar: 'removed' };")],
  ['any calendar will do', swapIn(S, "if (!found && String(c.getName()).toLowerCase().indexOf('joint chaos') !== -1) found = c;", "if (!found) found = c;")],
  ['a timed event lasts one hour', swapIn(S, "new Date(start.getTime() + 2 * 3600 * 1000)", "new Date(start.getTime() + 3600 * 1000)")],
  ['any photo is kept', swapIn(S, "return s.length <= NB_PHOTO_MAX_ && /^data:image\\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(s);", "return !!s;")],
  ['recurring flyers are cleared', swapIn(S, "  if (String(recurring) === 'true' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date || ''))) return false;", "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date || ''))) return false;")],
  ['cleared after 3 days', swapIn(S, "var NB_KEEP_PAST_DAYS_ = 30;", "var NB_KEEP_PAST_DAYS_ = 3;")],
  ['a date cell comes back as a timestamp', swapIn(['WebApp.js'], "obj[h] = h === 'Date' ? nbYmd_(x.r[i], tzF) : x.r[i] instanceof Date", "obj[h] = x.r[i] instanceof Date")],
  ['RSVP doesn’t touch the calendar', swapIn(['WebApp.js'], "    try { cal = nbSyncRsvp_(sheet, row, status); }", "    try { }")],
  ['Add to calendar uses the default one', swapIn(['WebApp.js'], "    var cal = nbJointCal_() || CalendarApp.getDefaultCalendar();", "    var cal = CalendarApp.getDefaultCalendar();")],
  ['the nightly clean-up isn’t run', swapIn(['Code.js'], "    nightlyStep_(ctx, 'purgeOldFlyers_', purgeOldFlyers_);   // Neighborhood.js: more than 30 days past\n", "")],
  ['this week is 3 days', swapIn(FULL, "if(n>=0&&n<=6)return 'week';", "if(n>=0&&n<=2)return 'week';")],
  ['tapping your answer doesn’t clear it', swapIn(FULL, "var next=f.Status===status?'':status;", "var next=status;")],
  ['no thumbnail zoom', swapIn(FULL, "onClick:function(){setZoom(f.Photo);}", "onClick:function(){}")],
  ['no scan history', swapIn(FULL, "full&&hist&&h('div',{className:'nb-histlist'}", "false&&h('div',{className:'nb-histlist'}")],
];
const T = 'test_neighborhood.js';
let allBit = true;
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const ui = Object.keys(patch).some(f => f.startsWith('docs/'));
  if (ui && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
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
