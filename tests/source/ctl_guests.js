// Negative controls for test_guests.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_guests');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Guests.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['a set list is ignored', swapIn(S, "  if (!raw) return GP_DEFAULT_.slice();\n", "  return GP_DEFAULT_.slice();\n")],
  ['repeats kept', swapIn(S, "if (!s || seen[k]) return false;", "if (!s) return false;")],
  ['ticks shared by every stay', swapIn(S, "if (String(rows[i][0]).trim() === stay && String(rows[i][1]).trim() === item)", "if (String(rows[i][1]).trim() === item)")],
  ['reading makes the tab', swapIn(S, "var sh = gpSheet_(false), out = {};", "var sh = gpSheet_(true), out = {};")],
  ['no past stays', swapIn(S, "stays = getUpcomingGuests_(cfg, GP_PAST_DAYS_)", "stays = getUpcomingGuests_(cfg)")],
  ['past stays shown as coming', swapIn(S, "(g.departureDate < today ? past : guests).push(x);", "guests.push(x);")],
  ['an item off the list still counts', swapIn(S, "checked: s.checked.filter(function(i) { return prep.indexOf(i) !== -1; })", "checked: s.checked")],
  ['(N) in a title ignored', swapIn(S, "  if (m) return Math.max(1, Number(m[1]));\n", "")],
  ['any headcount accepted', swapIn(S, "  if (!(n >= 1 && n <= 20)) throw new Error('n must be 1 to 20');\n", "")],
  ['the reader never looks back', swapIn(['PTO.js'], "    var events = cal.getEvents(from, end);", "    var events = cal.getEvents(today, end);")],
  ['day count off by one', swapIn(FULL, "return {kind:'now',day:Math.round((t-a)/864e5)+1,", "return {kind:'now',day:Math.round((t-a)/864e5),")],
  ['staying now not on top', swapIn(FULL, "sp.now.length>0&&h('div',{className:'gu-sect'},'Staying now'),sp.now.map(stay),", "")],
  ['a tick saves nothing', swapIn(FULL, "apiGet(apiUrl,apiToken,{action:'guest_prep_check',stay:g.stayKey,item:item,on:on})", "Promise.resolve({action:'guest_prep_check',stay:g.stayKey,item:item,on:on})")],
  ['the guide link goes nowhere', swapIn(FULL, "onClick:function(){onOpen('guide');}", "onClick:function(){}")],
  ['past stays open', swapIn(FULL, "showPast&&(data.past||[]).map(", "(data.past||[]).map(")],
  ['the stepper counts the household', swapIn(FULL, "var cooking=2+(g.people||1);", "var cooking=(g.people||1);")],
];
const T = 'test_guests.js';
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
