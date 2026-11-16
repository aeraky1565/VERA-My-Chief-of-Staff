// Negative controls for test_gifts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_gifts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Gifts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['any link kept', swapIn(S, "return /^https?:\\/\\/[^\\s\"'<>]+$/i.test(s) && s.length <= 500 ? s : '';", "return s;")],
  ['prices kept as typed', swapIn(S, "  var s = String(v == null ? '' : v).replace(/[$,\\s]/g, '');\n  if (!s) return '';", "  return String(v == null ? '' : v);\n  var s = '';")],
  ['the columns aren’t named', swapIn(S, "if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, GI_PRICE_COL_, 1, GI_COLS_.length).setValues([GI_COLS_]);", "")],
  ['undo does nothing', swapIn(S, "if (String(p.undo || '') === '1') { sheet.getRange(row, GI_PRICE_COL_ + 2, 1, 2).setValues([['', '']]); return { ok: true, id: id, given: false }; }", "if (String(p.undo || '') === '1') return { ok: true, id: id, given: false };")],
  ['add drops the price', swapIn(['WebApp.js'], "var gs = ss.getSheetByName(TABS.GIFT_IDEAS), price = giPrice_(p.price), link = giLink_(p.link);", "var gs = ss.getSheetByName(TABS.GIFT_IDEAS), price = '', link = '';")],
  ['the old add bug', swapIn(FULL, "i.ID===tempId?(data.entry||data.idea||i):i", "i.ID===tempId?data.idea:i")],
  ['not by next occasion', swapIn(FULL, "return (x?x.daysUntil:99999)-(y?y.daysUntil:99999)||String(a).localeCompare(String(b));});}", "return String(a).localeCompare(String(b));});}")],
  ['given ones still chips', swapIn(FULL, "open=all.filter(function(i){return !giGiven_(i);})", "open=all")],
  ['Bought without the occasion', swapIn(FULL, "setBuying({ID:i.ID,occasion:giOccasion_(giNext_(dates,i.Person),now)});", "setBuying({ID:i.ID,occasion:''});")],
  ['no price on the chip', swapIn(FULL, "i.Idea,pr!=null&&h('b',null,' '+giMoney_(pr))", "i.Idea")],
];
const T = 'test_gifts.js';
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
