// Negative controls for test_choresforothers.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_choresforothers');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['ChoresForOthers.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['a reward with words counts as money', swapIn(S, "  return m ? Number(m[1]) : null;\n}", "  return m ? Number(m[1]) : (parseFloat(String(reward).replace('$', '')) || null);\n}")],
  ['Done doesn’t stamp a date', swapIn(S, "      sheet.getRange(i + 2, CFO_DONE_COL_).setValue(cfoToday_());\n", "")],
  ['the new columns aren’t named', swapIn(S, ".setValues([['Done Date', 'Paid']]);", ".setValues([['', '']]);")],
  ['an already-paid chore pays again', swapIn(S, " || String(r[CFO_PAID_COL_ - 1]).trim()) return;", ") return;")],
  ['an open chore can be paid', swapIn(S, "if (!match || String(r[4]).trim() !== 'Done' ||", "if (!match ||")],
  ['the read drops Paid', swapIn(S, "      obj.Paid = cfoYmd_(row[CFO_PAID_COL_ - 1]);\n", "")],
  ['the pay route ignores a person', swapIn(['WebApp.js'], "String(p.assignee || '').trim());", "'');")],
  ['owed counts paid chores', swapIn(FULL, "if(!cfoDone_(c)||cfoPaid_(c)||a==null)return;", "if(!cfoDone_(c)||a==null)return;")],
  ['the nudge comes the next day', swapIn(FULL, "return g!=null&&g>=CFO_NUDGE_DAYS_;});if(!old.length)return null;", "return g!=null&&g>=1;});if(!old.length)return null;")],
  ['the full Home leaves rewards out', swapIn(FULL, ".concat(cfoNeeds_((ex.cfo||{}).chores,new Date()))", "")],
  ['done this month counts every month', swapIn(FULL, "else if(String(c['Done Date']||'').slice(0,7)===ym)month++;", "else month++;")],
  ['Paid pays nobody', swapIn(FULL, "onClick:function(){if(onPay)onPay({assignee:o.who});}", "onClick:function(){}")],
  ['the filter does nothing', swapIn(FULL, "return who==='all'||String(c.Assignee||'').trim()===who;});", "return true;});")],
  ['open jobs show done ones', swapIn(FULL, "open=mine.filter(function(c){return !cfoDone_(c);});", "open=mine;")],
  ['no Not done yet', swapIn(FULL, "cfoDone_(chore)&&onReopen&&h('button'", "false&&h('button'")],
];
const T = 'test_choresforothers.js';
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
