// Negative controls for Health › Care › Coverage (Coverage.js, its routes, the chat action, and the
// CoverageTab block shared by both dashboards): revert ONE rule at a time and confirm a test catches it.
// Server rules run test_coverage.js; dashboard rules run test_coverage_ui.js (skipped with no browser).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_coverage_out');

const FILES = ['Coverage.js', 'Code.js', 'Chat.js', 'TripIdeas.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const CV = 'Coverage.js', W = 'WebApp.js', CH = 'Chat.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const srv = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_coverage_ui.js';

const CONTROLS = [
  // the cheat sheet → cards
  ['a member ID isn’t private unless marked', srv(CV, "private: r.private === true || (r.private !== false && CV_SENSITIVE_RX_.test(r.label)) };", "private: r.private === true };")],
  ['the provider stays among the fields', srv(CV, "fields: fields.filter(function(f) { return f !== prov; }) });", "fields: fields });")],
  ['a card doesn’t tick who has what', srv(CV, "        grid[kind][person] = true;\n", "")],
  ['the doctors aren’t read', srv(CV, "(sub.rows || []).forEach(function(r) { doctors.push(", "[].forEach(function(r) { doctors.push(")],
  ['only insurance cards name the people', srv(CV, ": (CV_KINDS_[s.toLowerCase()] ? n : '');", ": '';")],
  // the covered list
  ['an edited row is overwritten by a fresh read', srv(CV, "if (edited || !plansRead[cvText_(r[1])])", "if (!plansRead[cvText_(r[1])])")],
  ['a fresh read duplicates a kept service', srv(CV, "if (!plan || !cvText_(f.service) || seen[key(plan, f.service)]) return;", "if (!plan || !cvText_(f.service)) return;")],
  ['“not covered” reads as covered', srv(CV, "/not/i.test(cvText_(f.status)) ? 'Not covered' : 'Covered'", "'Covered'")],
  ['the FSA guide counts as a plan document', srv(CV, "if (CV_FSA_DOC_RX_.test(text) && /benefit|hr/i.test(r.category + ' ' + text)) fsa.push(r);\n    else if", "if")],
  // FSA check
  ['the FSA documents are read every time', srv(CV, "if (text) try { cache.put('cv_fsa_docs', text.slice(0, 90000), 21600); } catch (e) {}", "")],
  ['the verdict isn’t normalised', srv(CV, "verdict: /^y/i.test(r.json.verdict) ? 'yes' : /^n/i.test(r.json.verdict) ? 'no' : 'maybe'", "verdict: r.json.verdict")],
  ['a question isn’t logged', srv(CV, "try { cvSheet_(CV_Q_TAB_, CV_Q_HEADERS_).appendRow([new Date(), item, out.verdict, out.why, out.source, by || '']); } catch (e) {}", "")],
  // perks
  ['last year’s sessions count this year', srv(CV, " && String(l.date).slice(0, 4) === String(year);", ";")],
  ['a session past the allowance is logged', srv(CV, "if (left && left.left <= 0) return { ok: false, error: 'All '", "if (false) return { ok: false, error: 'All '")],
  ['an unknown kind is logged', srv(CV, "if (allow.length && !allow.some(function(a) { return a.kind === kind; })) return", "if (false) return")],
  ['a bad allowance is saved', srv(CV, "if (cvText_(body.allowances) && !pkAllowances_(body.allowances).length) return", "if (false) return")],
  ['a perk name may start a formula', srv(CV, "if (/^[=+@]/.test(name)) return { ok: false, error: 'A name can’t start with =, + or @.' };", "")],
  ['deleting a perk keeps its log', srv(CV, "for (var i = rows.length - 1; i >= 0; i--) if (cvText_(rows[i][1]) === id) lg.deleteRow(i + 2);", "")],
  // routes and chat
  ['anyone can read the plan documents', srv(W, "case 'coverage_read_docs':         return jsonOut_(peopleOwnerOnly_() || webCoverageReadDocs_());", "case 'coverage_read_docs':         return jsonOut_(webCoverageReadDocs_());")],
  ['anyone can edit a perk', srv(W, "case 'perk_save':                  return jsonOut_(peopleOwnerOnly_() || webPerkSave_(body));", "case 'perk_save':                  return jsonOut_(webPerkSave_(body));")],
  ['the chat can’t ask the FSA question', srv(CH, "else if (type === 'fsa_check')", "else if (type === 'fsa_check_off')")],
  // the dashboard (both)
  ['a private number shows before Show', both("open?f.value:'••••'+String(f.value).slice(-4)", "f.value"), UI],
  ['another person’s cards show', both("var mine=(d.cards||[]).filter(function(c){return c.person===who;});", "var mine=(d.cards||[]);"), UI],
  ['a missing plan isn’t said', both("CV_PLAN_NAMES.filter(function(k){return !(grid[k]&&grid[k][who]);})", "[].filter(function(k){return !(grid[k]&&grid[k][who]);})"), UI],
  ['search ignores what you type', both("(!q||(r.service+' '+r.detail).toLowerCase().indexOf(q.toLowerCase())!==-1)", "true"), UI],
  ['a “no” reads as a yes', both("verdictWord={yes:'Yes',no:'Probably not',maybe:'It depends'}", "verdictWord={yes:'Yes',no:'Yes',maybe:'It depends'}"), UI],
  ['Log sends no kind', both("{action:'perk_log',perkId:p.id,kind:kind}", "{action:'perk_log',perkId:p.id}"), UI],
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
  const test = c[2] || 'test_coverage.js';
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
