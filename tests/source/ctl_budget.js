// Negative controls for Finances › Budget (Budget.js, the BudgetEngine block shared by Budget.js
// and both dashboards, and the BudgetTab block): revert ONE rule at a time and confirm a test
// catches it. Engine and server rules run test_budget.js; dashboard rules run test_budget_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_budget_out');

const FILES = ['Budget.js', 'Code.js', 'TripIdeas.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const B = 'Budget.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// The engine lives in Budget.js and both dashboards; the full page is served from index.html.
const engine = (from, to) => b => ({ [B]: swap(b[B], from, to), [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_budget.js', UI = 'test_budget_ui.js';

const CONTROLS = [
  ['the tracker’s What If rows count as spending', engine("if(l2==='what if scenarios'){state='whatif';continue;}", "if(l2==='what if scenarios'){state='nice';continue;}")],
  ['required counts the credit', engine("x.kind==='fixed'&&x.amount>0", "x.kind==='fixed'")],
  ['net income is the typed one', engine("var net=gross-sum(ded)", "var net=p.netTyped!=null?p.netTyped:gross-sum(ded)")],
  ['own cards are not taken off the transfer', engine("checking:bgRound_(contribution-own)", "checking:bgRound_(contribution)")],
  ['the split is the wrong way round', engine("shares[model.people[0].key]=split;shares[model.people[1].key]=1-split;", "shares[model.people[0].key]=1-split;shares[model.people[1].key]=split;")],
  ['shared savings left out of net expenses', engine("netExp=fx+nc+psave+contribution+ssave", "netExp=fx+nc+psave+contribution")],
  ['the due day stays in the name', engine("function bgName_(label){return bgText_(label).replace(/\\s*\\((\\d{1,2})(?:st|nd|rd|th)\\)\\s*/i,' ').trim();}", "function bgName_(label){return bgText_(label);}")],
  ['an unmapped line is quietly filed', engine("for(var i=0;i<BG_CATS.length;i++)if(BG_CATS[i][1].test(name))return BG_CATS[i][0];return 'Other';}", "for(var i=0;i<BG_CATS.length;i++)if(BG_CATS[i][1].test(name))return BG_CATS[i][0];return 'Household';}")],
  ['the Config category map is ignored', engine("if(catMap&&catMap[k])return catMap[k];", "")],
  ['a rounding cent reads as a difference', engine("ok:Math.abs(d)<=0.05", "ok:d===0")],
  ['a figure that follows net income isn’t said to', engine("return Math.abs(d)>0.05&&Math.abs(d-nd)<=0.05?'follows net income':'';", "return '';")],
  ['a blank What if input counts as zero', engine("Object.prototype.hasOwnProperty.call(ov,k)&&ov[k]!==''&&ov[k]!=null&&isFinite(Number(ov[k]))", "Object.prototype.hasOwnProperty.call(ov,k)&&isFinite(Number(ov[k]))")],
  ['a scenario keeps keys the model doesn’t know', b => ({ [B]: swap(b[B], "if (known[k] && changes[k] !== ''", "if (changes[k] !== ''") })],
  ['a scenario saves with nothing changed', b => ({ [B]: swap(b[B], "  if (!Object.keys(changes).length) return { ok: false, error: 'Nothing is changed in What if yet.' };\n", "") })],
  ['the phone plan doesn’t replace the tracker’s lines', b => ({ [B]: swap(b[B], "x.trackerAmount = x.amount; x.amount = plan.total; swapped++;", "swapped++;") })],
  ['raw ignores the tracker’s own figures', engine("var own=function(x){return raw&&x.trackerAmount!=null?x.trackerAmount:x.amount;};", "var own=function(x){return x.amount;};")],
  ['the phone plan isn’t named as the cause', engine("r.because=p.ok?'the phone plan, from the phone tracker':(p.because||'a difference')+', and the phone plan';", "")],
  ['a line with no category isn’t flagged', b => ({ [B]: swap(b[B], "  bgFlagUncategorized_(computed.shared.other);\n", "") })],
  ['a category’s actual is compared with every line’s plan', both("if(a!=null){hit=true;t+=a;pl+=acts.lines[k].plan||0;}", "hit=hit||a!=null;t+=a||0;pl+=acts.lines[k]?acts.lines[k].plan:0;"), UI],
  ['actuals never show', both("setActs(r&&r.ok&&r.lines&&r.uploads?r:null);", "setActs(null);"), UI],
  ['Open in What if leaves its cards closed', both("Object.keys(ch).forEach(function(k){var w=k.split(/[.:]/)[0];o[w==='split'?'shared':w]=true;});setOpen(o);", ""), UI],
  ['the budget_model route is missing', b => ({ [W]: swap(b[W], "      case 'budget_model':", "      case 'budget_model_old':") })],
  ['the cards open expanded', both("var card=function(id,title,color,figure,collapsed,expanded,hasChange){var on=!!open[id];", "var card=function(id,title,color,figure,collapsed,expanded,hasChange){var on=open[id]!==false;"), UI],
  ['open or closed is forgotten', both("function bgOpenWrite_(v){try{localStorage.setItem('vera_budget_open',JSON.stringify(v));}catch(e){}}", "function bgOpenWrite_(v){}"), UI],
  ['a changed category isn’t marked', both("var catRow=function(C){var ch=anyCh(C.keys);", "var catRow=function(C){var ch=false;"), UI],
  ['Reset leaves the changes', both("onClick:function(){setOv({});setMsg('');}},'Reset'", "onClick:function(){setMsg('');}},'Reset'"), UI],
  ['a scenario sends everything typed', both("changes:changed}", "changes:ov}"), UI],
  ['delete doesn’t ask', both("onClick:function(){setConfirmDel(s.id);}},'Delete')", "onClick:function(){del(s.id);}},'Delete')"), UI],
  ['the lite Budget isn’t BudgetTab', b => ({ [L]: swap(b[L], "{activeFinanceTab === 'fin_budget' && <BudgetTab apiUrl={apiUrl} apiToken={apiToken} />}", "{activeFinanceTab === 'fin_budget' && <div />}") }), UI],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { BG_QUICK: '1' } : {}) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
