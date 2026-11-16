// Negative controls for test_appts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_appts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Appts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['the key minds case', swapIn(S, "return String(person || 'Ahmed').trim().toLowerCase() + '|' + String(type || '').trim().toLowerCase(); }", "return String(person || 'Ahmed').trim() + '|' + String(type || '').trim(); }")],
  ['phones kept raw', swapIn(S, "return String(v == null ? '' : v).replace(/[^\\d+()\\-. ]/g, '').trim().slice(0, 30); }", "return String(v == null ? '' : v).trim(); }")],
  ['a field not sent is wiped', swapIn(S, "var vals = [String(person || 'Ahmed').trim(), String(type).trim(), cur ? cur.doctor : '', cur ? cur.phone : '', cur ? cur.bookedOn : ''];", "var vals = [String(person || 'Ahmed').trim(), String(type).trim(), '', '', ''];")],
  ['the provider isn’t used', swapIn(S, "doctor: s.doctor || a.provider || '',", "doctor: s.doctor || '',")],
  ['a booking never ends', swapIn(S, "return !!bookedOn && (!lastVisit || String(lastVisit) < String(bookedOn)); }", "return !!bookedOn; }")],
  ['a second Task each time', swapIn(S, "&& String(rows[i][4]).trim() === 'Open') return { ok: true, made: false,", "&& false) return { ok: true, made: false,")],
  ['no phone in the Task', swapIn(S, "(phone ? '📞 ' + phone + ' · ' : '') + tag", "tag")],
  ['the read leaves out the contacts', swapIn(['WebApp.js'], "  return { ok: true, appointments: apcMerged_() };", "  return { ok: true, appointments: getHealthAppointments_() };")],
  ['booked still needs booking', swapIn(FULL, "if(apBooked_(a))booked.push(a);else if(", "if(false)booked.push(a);else if(")],
  ['due within 90', swapIn(FULL, "var AP_SOON_=30;", "var AP_SOON_=90;")],
  ['overdue not first', swapIn(FULL, "need.sort(function(a,b){return d(a)-d(b);});", "")],
  ['Book it does nothing', swapIn(FULL, "onClick:function(){book(a);}},'Book it → Task')", "onClick:function(){}},'Book it → Task')")],
  ['the doctor isn’t saved', swapIn(FULL, "call({action:'appt_contact',person:e.a.person,type:e.a.type,doctor:e.doctor,phone:e.phone});", "")],
  ['up to date shown open', swapIn(FULL, "showOk&&h('div',{className:'ap-grid'},g.ok.map(", "h('div',{className:'ap-grid'},g.ok.map(")],
];
const T = 'test_appts.js';
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
