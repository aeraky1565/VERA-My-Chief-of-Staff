// Negative controls for test_resell.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_resell');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Resell.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['listing doesn’t stamp', swapIn(S, "if (!rsYmd_(row['Listed Date'], 'UTC') || was === 'Unlisted') out['Listed Date'] = today;", "")],
  ['the sold price is ignored', swapIn(S, "out['Sold Price'] = !isNaN(sp) && sp >= 0 ? sp : (!isNaN(ask) ? ask : '');", "out['Sold Price'] = !isNaN(ask) ? ask : '';")],
  ['no asking-price fallback', swapIn(S, "out['Sold Price'] = !isNaN(sp) && sp >= 0 ? sp : (!isNaN(ask) ? ask : '');", "out['Sold Price'] = !isNaN(sp) && sp >= 0 ? sp : '';")],
  ['a price rise counts as a drop', swapIn(S, "if (!isNaN(oldA) && !isNaN(newA) && newA < oldA) out['Dropped On'] = today;", "if (!isNaN(oldA) && !isNaN(newA)) out['Dropped On'] = today;")],
  ['back to To list keeps the dates', swapIn(S, "  if (now === 'Unlisted' && was !== 'Unlisted') { out['Listed Date'] = ''; out['Sold Date'] = ''; out['Sold Price'] = ''; out['Dropped On'] = ''; }\n", "")],
  ['the columns aren’t named', swapIn(S, "sheet.getRange(1, at + 1).setValue(name); hdrs[at] = name;", "hdrs[at] = name;")],
  ['the update never stamps', swapIn(['WebApp.js'], "    var stamps = rsApplyStamps_(sheet, hdrs, rows[i], i + 1, p);", "    var stamps = {};")],
  ['dates come back as Dates', swapIn(['WebApp.js'], "obj[h] = r[i] instanceof Date ? rsYmd_(r[i], tz) : r[i];", "obj[h] = r[i];")],
  ['the nudge ignores a drop', swapIn(FULL, "var since=b!=null&&(a==null||b<a)?b:a;", "var since=a;")],
  ['the nudge at 7 days', swapIn(FULL, "var RS_NUDGE_=14;", "var RS_NUDGE_=7;")],
  ['sold this year counts every year', swapIn(FULL, "soldYear:c.sold.filter(function(i){return String(i['Sold Date']||'').slice(0,4)===y;})", "soldYear:c.sold.filter(function(i){return true;})")],
  ['List it does nothing', swapIn(FULL, "onClick:function(){list(it);}},'List it →')", "onClick:function(){}},'List it →')")],
  ['Sold ignores the price typed', swapIn(FULL, "update(it,{status:'Sold',soldPrice:v==null?'':String(v)}", "update(it,{status:'Sold'}")],
  ['no paid comparison', swapIn(FULL, "(paid!=null?' of '+rsMoney_(paid):'')", "''")],
  ['To list not by priority', swapIn(FULL, "o.tolist.sort(function(a,b){return (pr[a.Priority]==null?1:pr[a.Priority])-(pr[b.Priority]==null?1:pr[b.Priority])||", "o.tolist.sort(function(a,b){return ")],
];
const T = 'test_resell.js';
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
