// Negative controls for test_pantry.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pantry');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Pantry.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['everything due restocks by itself', swapIn(S, ".filter(function(i) { return staples.indexOf(i.normalized) !== -1; });", ";")],
  ['staples aren’t normalized', swapIn(S, "return s.trim().toLowerCase(); }).filter(Boolean);", "return s.trim(); }).filter(Boolean);")],
  ['a staple can be added twice', swapIn(S, "list = pantryStaples_(getConfigValues()).filter(function(n) { return n !== name; });", "list = pantryStaples_(getConfigValues());")],
  ['unmarking doesn’t remove it', swapIn(S, "  if (on) list.push(name);\n", "  list.push(name);\n")],
  ['checked-off lines count as on the list', swapIn(S, "(st.items || []).forEach(function(i) { if (i.done) return;", "(st.items || []).forEach(function(i) {")],
  ['🤖 lines aren’t matched', swapIn(S, "return normalizeItemName_(String(text || '').replace(/^\\uD83E\\uDD16\\s*/, '').replace(/\\s*\\(est\\..*?\\)\\s*$/, ''));", "return normalizeItemName_(String(text || ''));")],
  ['adding duplicates', swapIn(S, "  if (already) return { ok: true, name: name, store: already, already: true };\n", "")],
  ['adding ignores the store', swapIn(S, "var st = lists.filter(function(s) { return String(s.storeName).trim().toLowerCase() === want; })[0] || lists[0];", "var st = lists[0];")],
  ['a list failure breaks the read', swapIn(S, "  try { lists = getShoppingList_(); } catch (e) { listErr = e.message; }", "  lists = getShoppingList_();")],
  ['running out ignores the window', swapIn(FULL, "return i.daysUntil!=null&&i.daysUntil<=days;}).sort(", "return i.daysUntil!=null;}).sort(")],
  ['running out isn’t soonest first', swapIn(FULL, "}).sort(function(a,b){return a.daysUntil-b.daysUntil||String(a.normalized).localeCompare(String(b.normalized));});}", "});}")],
  ['running-out items also listed by aisle', swapIn(FULL, "if(i.daysUntil!=null&&i.daysUntil<=days&&!q)return;", "")],
  ['on the list still offers Add', swapIn(FULL, "i.onList?h('span',{className:'pa-on'},'✓ On the '+i.onList+' list'):", "")],
  ['Add ignores the usual store', swapIn(FULL, "{action:'pantry_add',name:i.normalized,store:i.store||i.lastStore||''}", "{action:'pantry_add',name:i.normalized,store:''}")],
  ['☆ does nothing', swapIn(FULL, "onClick:function(){staple(i);}},i.staple?'★':'☆');", "onClick:function(){}},i.staple?'★':'☆');")],
  ['aisles open', swapIn(FULL, "var isOpen=!!q||!!open[g.aisle];", "var isOpen=true;")],
  ['the pantry sends no on hand', swapIn(S, "res.onHand = ohWeek_(getCurrentWeekStart_())", "res.onHand = [] || ohWeek_(getCurrentWeekStart_())")],
  ['the pantry sends used food as on hand', swapIn(S, ".filter(function(x) { return x.status === 'on hand'; })\n      .map(", ".filter(function(x) { return x.status !== 'pending'; })\n      .map(")],
  ['an on-hand failure costs the pantry', swapIn(S, "  } catch (e) { res.onHandError = e.message; }\n  return res;", "  } catch (e) { throw e; }\n  return res;")],
  ['Used it on the Pantry tab sends removed', swapIn(FULL, "onClick:function(){used(x,'used');}", "onClick:function(){used(x,'removed');}")],
  ['a used food stays listed', swapIn(FULL, "onHand:(d.onHand||[]).filter(function(y){return y.id!==x.id;})", "onHand:(d.onHand||[])")],
];
const T = 'test_pantry.js';
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
