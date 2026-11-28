// Negative controls for Home & seasonal (HomePurchases.js, Groceries.js, Pantry.js, the Finances
// card and the Pantry button): revert one rule at a time and confirm test_homepurchases.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_hp');
const FILES = ['HomePurchases.js', 'Groceries.js', 'Pantry.js', 'GroceryRun.js', 'Code.js', 'WebApp.js', 'NightlyRunner.js', 'Features.js', 'docs/app.js', 'docs/index.html'];
const BASE = {}; FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const one = f => (from, to) => b => { const o = {}; o[f] = swap(b[f], from, to); return o; };
const hp = one('HomePurchases.js'), gr = one('Groceries.js'), pa = one('Pantry.js');
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const UI = true;
const CONTROLS = [
  ['tax isn’t shared', hp("var f = linesSum > 0 ? total / linesSum : 1;", "var f = 1;")],
  ['Thanksgiving is the first Thursday', hp("var day = 1 + ((4 - first + 7) % 7) + 21;", "var day = 1 + ((4 - first + 7) % 7);")],
  ['Easter on a fixed day', hp("    case 'Easter': return hpEaster_(y);", "    case 'Easter': return y + '-04-01';")],
  ['no season guesses', hp("  if (/christmas|xmas|", "  if (false && /christmas|xmas|")],
  ['reminders any time of year', hp("    if (days < 0 || days > w * 7) return;", "    if (days < 0) return;")],
  ['reminders with nothing bought', hp("    if (!last.length) return;", "")],
  ['a home-only run refused', gr("  if (!(x.total > 0) && !(x.homeTotal > 0)) return { ok: false, error: 'Enter the total' };", "  if (!(x.total > 0)) return { ok: false, error: 'Enter the total' };")],
  ['home lines not written', gr("    if (x.homeTotal > 0 && typeof hpLog_ === 'function') home = hpLog_(hpRowsForRun_(x, homeLines, x.homeTotal));", "")],
  ['deleting a run leaves its home rows', gr("var home = 0; if (typeof hpDeleteRun_ === 'function') { try { home = hpDeleteRun_(id); } catch (e) {} }", "var home = 0;")],
  ['the home budget comes from the Budget tab', gr("var hb = grHomeBudget_(); home.budget = hb.amount;", "var hb = grHomeBudget_(); home.budget = grBudget_('home & seasonal');")],
  ['a blank line counts as a $0 budget', gr("amount: b.amount > 0 ? Math.round(b.amount * 100) / 100 : null", "amount: Math.round((b.amount || 0) * 100) / 100")],
  ['"and" doesn’t match "&"', gr("/^home\\s*(&|and)\\s*seasonal\\b/i", "/^home\\s*&\\s*seasonal\\b/i")],
  ['home lines reach the pantry', pa("  }).filter(function(x) { return x.norm && !x.home; });", "  }).filter(function(x) { return x.norm; });")],
  ['the reader forgets the kind', pa("    if (['grocery', 'supply', 'home'].indexOf(kind) === -1 || (kind === 'grocery' && !food)) kind = food ? 'grocery' : 'supply';", "    kind = food ? 'grocery' : 'supply';")],
  ['pantry_to_home leaves the rows', hp("    for (var j = hits.length - 1; j >= 0; j--) ph.deleteRow(hits[j].row);", "")],
  ['pantry_to_home double counts', hp("          run.total = Math.round((run.total - m.amount) * 100) / 100;", "")],
  ['"just the food" runs adjusted too', hp("          if (run.counted === 'food' && m.nonFood) break;", "")],
  ['not routed', one('WebApp.js')("      case 'pantry_to_home':           return jsonOut_(webPantryToHome_(e));   // HomePurchases.js\n", "")],
  ['not in the night', one('NightlyRunner.js')("\n    S('checkSeasonalReminders_', 3, function() { checkSeasonalReminders_(); }),", "")],
  ['the card hides Home & seasonal', ui("d.home&&(d.home.total>0||d.home.budget!=null)?h(GrcHome,{home:d.home}):null,", "null,"), UI],
  ['every aisle offers Not a pantry item', ui("if(aisle!=='Household'&&aisle!=='Other')return null;", ""), UI],
  ['moving forgets the season', ui("{action:'pantry_to_home',name:i.normalized,season:season||''}", "{action:'pantry_to_home',name:i.normalized,season:''}"), UI],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(c => {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch), changed = [];
  Object.keys(files).forEach(f => { if (files[f] !== BASE[f]) changed.push(f); const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); } catch (e) {} });
  const r = cp.spawnSync('node', ['test_homepurchases.js'], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || ''), fails = (out.match(/^  FAIL .*$/gm) || []);
  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY'); allBit = false; return; }
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
