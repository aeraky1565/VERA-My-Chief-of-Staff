// Negative controls for Finances › Budget (Budget.js, the BudgetEngine block shared by Budget.js
// and both dashboards, and the BudgetTab block): revert ONE rule at a time and confirm a test
// catches it. Engine and server rules run test_budget.js; dashboard rules run test_budget_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_budget_out');

const FILES = ['Budget.js', 'Code.js', 'TripIdeas.js', 'WebApp.js', 'Settings.js', 'Finance.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
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
  // the engine (Budget.js and both dashboards)
  ['a “Shared cost? Yes” deduction stays a personal deduction', engine("var shared=sharedCol>-1&&/^y/i.test(bgText_(at(r,sharedCol)));", "var shared=false;")],
  ['paychecks aren’t × paychecks in a regular month', engine("var n=x.perMonth;x.gross=bgRound_((x.grossPer||0)*n);", "var n=1;x.gross=bgRound_((x.grossPer||0)*n);")],
  ['taxes left out of the deductions', engine("if(x.taxesPer!=null)own.push(", "if(false)own.push(")],
  ['a shared bill paid by a person stays on Joint', engine("b.account=pb==='joint'?'Joint':(byKey[pb]?byKey[pb].name:paidBy);", "b.account='Joint';")],
  ['Joint ignores what’s on a card or paycheck', engine("checking:bgRound_(contribution-ownAll)", "checking:bgRound_(contribution)")],
  ['the split is the wrong way round', engine("shares[model.people[0].key]=split;shares[model.people[1].key]=1-split;", "shares[model.people[0].key]=1-split;shares[model.people[1].key]=split;")],
  ['take-home ignores what comes from pay', engine("takeHome:bgRound_(net-fromPay)", "takeHome:bgRound_(net)")],
  ['shared savings left out of left over', engine("netExp=fx+nc+psave+contribution+ssave", "netExp=fx+nc+psave+contribution")],
  ['settle-up crossed the wrong way', engine("settleUp:bgRound_(V.ownCards*A.share-A.ownCards*V.share)", "settleUp:bgRound_(A.ownCards*A.share-V.ownCards*V.share)")],
  ['required leaves out variable costs', engine("required=sum(lines.filter(function(x){return x.kind!=='nice';}))", "required=sum(lines.filter(function(x){return x.kind==='fixed';}))")],
  ['set-asides miss the shared ones a person pays', engine("+sum(mine.filter(function(x){return x.keptAs==='Set-aside';}))", "")],
  ['the sheet’s Category is ignored', engine("if(bgText_(sheetCat))return bgText_(sheetCat);", "")],
  ['the Config category map is ignored', engine("if(catMap&&catMap[k])return catMap[k];", "")],
  ['groceries count as a bill', engine("var BG_SPEND_RX=/grocer|costco|cleaning|\\btips?\\b/i;", "var BG_SPEND_RX=/^$/;")],
  ['the due day stays in the name', engine("function bgName_(label){return bgText_(label).replace(/\\s*\\((\\d{1,2})(?:st|nd|rd|th)\\)\\s*/i,' ').trim();}", "function bgName_(label){return bgText_(label);}")],
  ['the match check never flags a difference', engine("ok:Math.abs(d)<=0.05", "ok:true")],
  ['the phone plan doesn’t replace the sheet’s lines', b => ({ [B]: swap(b[B], "x.trackerAmount = x.amount; x.amount = plan.total; swapped++;", "swapped++;") })],
  ['a scenario keeps keys the model doesn’t know', b => ({ [B]: swap(b[B], "if (known[k] && changes[k] !== ''", "if (changes[k] !== ''") })],
  ['a scenario saves with nothing changed', b => ({ [B]: swap(b[B], "  if (!Object.keys(changes).length) return { ok: false, error: 'Nothing is changed in What if yet.' };\n", "") })],
  // writing (Budget.js, WebApp.js)
  ['a formula cell is written over', b => ({ [B]: swap(b[B], "    if (f) return { ok: false, error: writes[i].what + ' is worked out by the sheet, so VERA won’t type over it.' };\n", '') })],
  ['writes go one by one, before all are checked', b => ({ [B]: swap(b[B], "    var f = sheet.getRange(writes[i].row, writes[i].col).getFormula();", "    sheet.getRange(writes[i].row, writes[i].col).setValue(writes[i].value);\n    var f = sheet.getRange(writes[i].row, writes[i].col).getFormula();") })],
  ['any Type is accepted', b => ({ [B]: swap(b[B], "return t ? { ok: true, value: BG_TYPE_LABEL_[t] } : { ok: false, error: 'Type is Fixed, Variable or Nice to have.' };", "return { ok: true, value: bgText_(value) };") })],
  ['taxes can be typed over', b => ({ [B]: swap(b[B], "if (byKey[key].taxes) return { ok: false, error: 'Taxes are worked out from the deposit; change the net deposit instead.' };", "") })],
  ['a name may start a formula', b => ({ [B]: swap(b[B], "if (/^[=+@]/.test(s)) return { ok: false, error: 'A name can’t start with =, + or @.' };", "") })],
  ['a new bill goes below Total bills', b => ({ [B]: swap(b[B], "return blank ? { ok: true, row: blank, insertAfter: null, values: values, bill: out } : { ok: true, row: last + 1, insertAfter: last, values: values, bill: out };", "return { ok: true, row: C.total + 1, insertAfter: C.total, values: values, bill: out };") })],
  ['duplicates are added', b => ({ [B]: swap(b[B], "  if (dup) return { ok: false, error: '“' + dup.name + '” is already a bill for ' + dup.forWho + '. Change that one instead.' };\n", '') })],
  ['anyone may write', b => ({ [W]: swap(b[W], "return jsonOut_(peopleOwnerOnly_() || webBudgetWrite_(body));", "return jsonOut_(webBudgetWrite_(body));") })],
  ['the old Tracker tab is read', b => ({ [B]: swap(b[B], "var BG_TAB_ = 'Household Split';", "var BG_TAB_ = 'Tracker';") })],
  ['the HSA plan replaces the sheet’s figure', b => ({ [B]: swap(b[B], "  model.people.some(function(p) {\n    var d = p.deductions.filter(", "  model.people.forEach(function(p) { p.deductions.forEach(function(x) { if (BG_HSA_RX_.test(x.name) && num(year) != null) x.amount = num(year) / 12; }); });\n  model.people.some(function(p) {\n    var d = p.deductions.filter(") })],
  ['the budget_model route is missing', b => ({ [W]: swap(b[W], "      case 'budget_model':", "      case 'budget_model_old':") })],
  // the dashboard (BudgetTab, both)
  ['the summary boxes show cents', both("tile('bg-kpi-left','Left over',bgMoney_(c.totalDisposable),", "tile('bg-kpi-left','Left over',bgMoney_(c.totalDisposable,true),"), UI],
  ['the phone gets the wide table', both("var tbl=function(head,rows,foot,cls){if(narrow)return tblNarrow(head,rows,foot,cls);", "var tbl=function(head,rows,foot,cls){"), UI],
  ['✎ on a bill sends every field', both("if(String(v[f[0]]).trim()!==String(f[1]==null?'':f[1]).trim())edits.push(", "edits.push("), UI],
  ['a paycheck line in What if counts once a month', both("out[k]=Math.round(Number(v)*U.mult*10000)/10000;", "out[k]=Math.round(Number(v)*10000)/10000;"), UI],
  ['Write these to the sheet skips the confirm', both("onClick:function(){setConfirmWrite(true);}", "onClick:function(){write(edits,function(){setOv({});setWhatIf(false);});}"), UI],
  ['taxes get a ✎', both("return t?(whatIf?input(t.key,shownOf(t.key,t.per),p.name+' · taxes per paycheck'):h('span',{style:num},bgMoney_(t.per,true))):'—';", "return t?fig(t.key,t.per,bgMoney_(t.per,true),p.name+' · taxes'):'—';"), UI],
  ['a refused write closes the form silently', both("if(vedit)setVedit(Object.assign({},vedit,{err:e.message}));else flash(e.message);", "setVedit(null);"), UI],
  ['sections forget being opened', both("n[id]=!p[id];bgOpenWrite_(n);return n;", "n[id]=!p[id];return n;"), UI],
  ['actuals never show', both("setActs(r&&r.ok&&r.lines?r:null);", "setActs(null);"), UI],
  ['a scenario sends everything typed', both("changes:changed}", "changes:ov}"), UI],
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
