// Negative controls for the Career tab v2, phase 3 (issue #216): Network, Market,
// Brand, Exchange and "How it connects". Revert ONE protection at a time and
// confirm test_career_exchange.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_carx');

const FILES = ['Career.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const C = 'Career.js', APP = 'docs/app.js';
const TEST = 'test_career_exchange.js';

const CONTROLS = [
  // ---- Network ------------------------------------------------------------------
  ['contacts are copied again on top of existing ones', b => ({ [C]: swap(b[C], '    if (sheet.getLastRow() < 2) n = carAppend_(', '    n = carAppend_(') })],
  ['the v1 Network tab is deleted, not hidden', b => ({ [C]: swap(b[C], '    if (old && !old.isSheetHidden()) old.hideSheet();', '    if (old) getSpreadsheet().deleteSheet(old);') })],
  ['a cold sponsor counts', b => ({ [C]: swap(b[C], "c.role === 'sponsor' && c.warmth !== 'cold' && ", "c.role === 'sponsor' && ") })],
  ['the sponsor flag never clears', b => ({ [C]: swap(b[C], "    if (!gap[t]) { resolveFlagsWithPrefix_(flagSheet, 'career-no-sponsor__' + t); return; }", '    if (!gap[t]) { return; }') })],
  // ---- Market --------------------------------------------------------------------
  ['a bonus amount is ignored', b => ({ [C]: swap(b[C], 'var bonus = bonusAmt !== null ? bonusAmt : base', 'var bonus = base') })],
  ['the first year forgets the forfeited equity', b => ({ [C]: swap(b[C], 'out.estTotalMid - est.forfeited - Math.round(est.bonus)', 'out.estTotalMid - Math.round(est.bonus)') })],
  ['benchmarks count matches with no stated pay', b => ({ [C]: swap(b[C], '    if (!range) return;\n    var level', '    if (!range) range = [0, 0];\n    var level') })],
  ['a 401(k) % is read as dollars', b => ({ [C]: swap(b[C], 'var matchPct = matchRaw > 0 && matchRaw <= 100 ? matchRaw : null;', 'var matchPct = null;') })],
  ['key benefits split on every comma', b => ({ [C]: swap(b[C], ".split(/,(?!\\d{3}\\b)/)", ".split(/,/)") })],
  ['an older Package tab never gains the new column', b => ({ [C]: swap(b[C], '    if (add.length) sheet.getRange(1, sheet.getLastColumn() + 1, 1, add.length).setValues([add]);\n', '') })],
  ['any notes are moved into Key Benefits', b => ({ [C]: swap(b[C], "!pkg.keyBenefits.length && pkg.notes.trim() === v1)", "!pkg.keyBenefits.length && pkg.notes.trim())") })],
  // ---- Brand ---------------------------------------------------------------------
  ['a non-https resume link is kept', b => ({ [C]: swap(b[C], "/^https:\\/\\//.test(String(x.url || ''))", "String(x.url || '')") })],
  // ---- Exchange: inbound ----------------------------------------------------------
  ['any brief version is read', b => ({ [C]: swap(b[C], "  if (h.version !== 1) return { ok: false, error: 'PIES-BRIEF v'", "  if (false) return { ok: false, error: 'PIES-BRIEF v'") })],
  ['an unconfirmed import goes through', b => ({ [C]: swap(b[C], "  if (body.confirmed !== true) return { ok: false, error: 'Preview the payload and confirm it first.' };\n", '') })],
  ['the same brief imports twice', b => ({ [C]: swap(b[C], "      ? 'The PIES-BRIEF for ' + p.period + ' is already imported.' : '';", "      ? '' : '';") })],
  ['a preview writes to the log', b => ({ [C]: swap(b[C], '  var content = p.brief || p.match;\n', "  var content = p.brief || p.match;\n  carLogExchange_('in', p.type, p.period, 'preview');\n") })],
  ['a preview logs the pasted text', b => ({ [C]: swap(b[C], 'function webCareerExchangePreview_(body) {\n', 'function webCareerExchangePreview_(body) {\n  Logger.log(body.text);\n') })],
  ['brief items are claimed at AD scale', b => ({ [C]: swap(b[C], "Scale: a.scale, 'AD Scale': false,", "Scale: a.scale, 'AD Scale': true,") })],
  ['an unknown criterion is guessed', b => ({ [C]: swap(b[C], "'Criterion IDs': id || '', Source: 'PIES-BRIEF'", "'Criterion IDs': id || 'core-people', Source: 'PIES-BRIEF'") })],
  ['figures go unmarked', b => ({ [C]: swap(b[C], ".forEach(function(m) { add('figure', m); });", '.forEach(function(m) {});') })],
  ['ordinary acronyms are marked', b => ({ [C]: swap(b[C], "if (CAR_PLAIN_ACRONYMS_.indexOf(m.replace(/-/g, '')) === -1) add('initiative', m);", "add('initiative', m);") })],
  ['the Pipeline shows a pasted role twice', b => ({ [C]: swap(b[C], 'if (!x.jobLink || links.indexOf(x.jobLink) === -1) rows.push(x);', 'rows.push(x);') })],
  ['an Exchange role’s status goes to the Tracker', b => ({ [C]: swap(b[C], "  if (body.source === 'exchange') return carSetRoleMatchStatus_(body, status);\n", '') })],
  // ---- Exchange: outbound and overdue ---------------------------------------------
  ['copying intents isn’t remembered', b => ({ [C]: swap(b[C], "    carStateSet_('intents_exported', { quarter: quarter, at: now.toISOString() });\n", '') })],
  ['the package leaks into MATCHER-CONTEXT', b => ({ [C]: swap(b[C], 'staticProfile: (g.brand || {}).staticProfile, today: now', 'staticProfile: (g.brand || {}).staticProfile + JSON.stringify(g.package), today: now') })],
  ['all evidence goes into MATCHER-CONTEXT', b => ({ [C]: swap(b[C], 'var recent = (d.evidence || []).filter(function(e) { return e.month >= since; });', 'var recent = (d.evidence || []);') })],
  ['a brief is overdue before PIES has sent one', b => ({ [C]: swap(b[C], 'overdue: !!lastBrief && lastBrief < prevYm', 'overdue: !lastBrief || lastBrief < prevYm') })],
  ['intents nag from the quarter’s first day', b => ({ [C]: swap(b[C], '(now - qStart) / 86400000 >= 14', 'true') })],
  // ---- wiring and the dashboard ----------------------------------------------------
  ['the import route is missing', b => ({ 'WebApp.js': swap(b['WebApp.js'], "      case 'career_exchange_import':     return jsonOut_(webCareerExchangeImport_(body));\n", '') })],
  ['the flags are dropped from the nightly run', b => ({ 'Code.js': swap(b['Code.js'], "    nightlyStep_(ctx, 'carCareerFlags_', carCareerFlags_);\n", '') })],
  ['a crossing drops out of How it connects', b => ({ [APP]: swap(b[APP], "{from:'Claude',to:'VERA',what:'ROLE-MATCH v1',", "{from:'Claude',to:'VERA',what:'A role match',") })],
  ['a link gets into How it connects', b => ({ [APP]: swap(b[APP], "['Wins bank doc','Job agent (VERA appends tabs)'", "['Wins bank doc https://docs.example/x','Job agent (VERA appends tabs)'") })],
  ['the import skips the checkbox', b => ({ [APP]: swap(b[APP], 'disabled:b||!checked,onClick:doImport', 'disabled:b,onClick:doImport') })],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
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
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + TEST + ')');
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
