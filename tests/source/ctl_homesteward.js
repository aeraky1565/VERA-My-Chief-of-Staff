// Negative controls for test_homesteward.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_homesteward');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['HomeSteward.js'], FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']);
const CONTROLS = [
  ['links not limited to http(s)', swapIn(S, "return !s || /^https?:\\/\\/\\S+$/i.test(s);", "return true;")],
  ['a stale row writes the wrong item', swapIn(S, "  if (expected && expected.toLowerCase() !== actual.toLowerCase())\n", "  if (false)\n")],
  ['a link not sent is cleared', swapIn(S, "var receipt = p.receipt === undefined ? cur[0] : String(p.receipt).trim(), manual = p.manual === undefined ? cur[1] : String(p.manual).trim();", "var receipt = String(p.receipt || '').trim(), manual = String(p.manual || '').trim();")],
  ['the link columns aren’t named', swapIn(S, "if (!String(h[0]).trim() || !String(h[1]).trim()) sheet.getRange(1, HS_RECEIPT_COL_, 1, 2).setValues([['Receipt', 'Manual']]);", "")],
  ['Snooze moves it by a day', swapIn(S, "var next = hsAddDays_(today, 7);", "var next = hsAddDays_(today, 1);")],
  ['the Task’s date doesn’t follow', swapIn(S, "    if (due && String(rows[i][3]) !== due) sheet.getRange(i + 2, 4).setValue(due);\n", "")],
  ['a second Task every night', swapIn(S, "    if (String(rows[i][6] || '').indexOf(tag) === -1 || String(rows[i][4]).trim() !== 'Open') continue;", "    continue;")],
  ['no Task, flag only', swapIn(S, "    try { if (hsSyncTask_(o.item, o.next, false) === 'made') made++; } catch (err) { Logger.log('checkHomeServiceOverdue_ task: ' + err.message); }\n", "")],
  ['a Low flag', swapIn(S, "      urgency: 'Medium' };", "      urgency: 'Low' };")],
  ['due today counts as overdue', swapIn(S, "if (!item || !next || next >= todayIso) return;", "if (!item || !next || next > todayIso) return;")],
  ['recording doesn’t close the Task', swapIn(['WebApp.js'], "  try { hsSyncTask_(String(sheet.getRange(rowNum, 1).getValue() || ''), '', true); } catch (err) { Logger.log('record service task: ' + err.message); }\n", "")],
  ['the nightly step isn’t run', swapIn(['NightlyRunner.js'], "    S('checkHomeServiceOverdue_', 3, function() { checkHomeServiceOverdue_(); }),\n", "")],
  ['a warranty ending outranks an overdue service', swapIn(FULL, "if(s!=null&&s<0)return {rank:0,days:s};", "if(s!=null&&s<0)return {rank:2,days:s};")],
  ['Snooze offered on everything', swapIn(FULL, "u.rank<=1&&onSnooze&&h('button',{type:'button',className:'btn hs-snooze'", "onSnooze&&h('button',{type:'button',className:'btn hs-snooze'")],
  ['Later isn’t folded', swapIn(FULL, "    later&&rest.map(card)));}", "    rest.map(card)));}")],
  ['the links form takes anything', swapIn(FULL, "disabled:busy||(links.receipt&&!hsIsLink_(links.receipt))||(links.manual&&!hsIsLink_(links.manual)),", "disabled:busy,")],
];
const T = 'test_homesteward.js';
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
