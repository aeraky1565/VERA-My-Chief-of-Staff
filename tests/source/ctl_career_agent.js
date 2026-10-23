// Negative controls for the Career tab v2, phase 2 (issue #216): the job agent
// link. Revert ONE protection at a time and confirm test_career_agent.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cara');

const FILES = ['Career.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const C = 'Career.js', APP = 'docs/app.js';
const TEST = 'test_career_agent.js';

const CONTROLS = [
  // ---- the Tracker: Status cell only ----------------------------------------------
  ['the status writer rewrites the whole row', b => ({ [C]: swap(b[C], '    sheet.getRange(hit.row, statusCol).setValue(status);', '    sheet.getRange(hit.row, 1, 1, grid[0].length).setValues([grid[0].map(function() { return status; })]);') })],
  ['an ambiguous Company + Title takes the first row', b => ({ [C]: swap(b[C], '  if (byName.length === 1) return { row: byName[0] };', '  if (byName.length >= 1) return { row: byName[0] };') })],
  ['any status is accepted', b => ({ [C]: swap(b[C], "  if (CAR_TRACKER_STATUSES_.indexOf(status) === -1) return { ok: false, error: 'Unknown status: ' + status };\n", '') })],
  ['old 1–10 scores are not converted', b => ({ [C]: swap(b[C], '  if (n <= 10) return', '  if (n < 0) return') })],
  ['weekends count as days the agent missed', b => ({ [C]: swap(b[C], '    if (wd !== 0 && wd !== 6) n++;', '    n++;') })],
  ['the agent goes stale only after a week', b => ({ [C]: swap(b[C], 'stale: wd >= (threshold || 2)', 'stale: wd > 5') })],
  // ---- the Settings sync -------------------------------------------------------------
  ['a missing Settings row is appended', b => ({ [C]: swap(b[C], '    if (r === -1) { missing.push(c.label); return; }', '    if (r === -1) { sheet.appendRow([c.label, c.value]); missing.push(c.label); return; }') })],
  ['unchanged values are rewritten', b => ({ [C]: swap(b[C], '    if (String(grid[r][valCol]).trim() === c.value) { same.push(c.label); return; }\n', '') })],
  ['the old employer stays excluded', b => ({ [C]: swap(b[C], '  if (o && o !== n) list = list.filter(function(x) { return carLabel_(x) !== o; });\n', '') })],
  ['the Inbox link carries a token', b => ({ [C]: swap(b[C], "+ '?tab=career&sub=pipeline');", "+ '?tab=career&sub=pipeline&token=x');") })],
  ['Levels to consider drops the level after next', b => ({ [C]: swap(b[C], '.concat(future.length ? [carLevelOf_(future[0])] : [])', '') })],
  ['Hired advances before the rung has its company', b => ({ [C]: swap(b[C],
      "  carUpsert_(carSheet_(TABS.CAREER_LADDER, CAR_LADDER_HEADERS_),\n             { ID: next.id, Company: match.company, 'Move Type': 'external', Title: match.title || next.title }, 'CR');\n  webCareerAdvance_({ id: next.id });",
      "  webCareerAdvance_({ id: next.id });\n  carUpsert_(carSheet_(TABS.CAREER_LADDER, CAR_LADDER_HEADERS_),\n             { ID: next.id, Company: match.company, 'Move Type': 'external', Title: match.title || next.title }, 'CR');") })],
  ['the last employer is forgotten when a rung has none', b => ({ [C]: swap(b[C], "employer: plan.employer || prev.employer || '' };", 'employer: plan.employer };') })],
  // ---- constraints in the agent's Settings ----------------------------------------------
  ['saving a constraint appends a missing row', b => ({ [C]: swap(b[C], '    if (r === -1) { missing.push(c.label); return; }', '    if (r === -1) { sheet.appendRow([c.label, c.value]); missing.push(c.label); return; }') })],
  ['Companies to exclude becomes editable', b => ({ [C]: swap(b[C], "    if (!f || f.readOnly) return { ok: false, error:", "    if (!f) return { ok: false, error:") })],
  ['a floor need not be a number', b => ({ [C]: swap(b[C], "      if (v && !/^\\d+$/.test(v)) return { ok: false, error: f.label + ' must be a whole number.' };\n", '') })],
  ['the writer accepts a row VERA doesn’t own', b => ({ [C]: swap(b[C], "    if (CAR_AGENT_OWNED_LABELS_.indexOf(c.label) === -1) throw new Error('VERA does not own ' + c.label);\n", '') })],
  ['an unreachable sheet shows nothing instead of the last read', b => ({ [C]: swap(b[C], 'values: cache ? cache.values : {}, missing: []', 'values: {}, missing: []') })],
  ['a sync pushes the floors from VERA’s state again', b => ({ [C]: swap(b[C], "  put('Levels to consider', levels.join(', '));\n", "  put('Levels to consider', levels.join(', '));\n  put('Minimum base salary (USD)', '1');\n") })],
  ['the Pipeline ignores the Settings floor', b => ({ [C]: swap(b[C], "  var floor = { base: (carStateGet_('agent_constraints') || { values: {} }).values.baseFloor };", '  var floor = {};') })],
  ['the save route is missing', b => ({ 'WebApp.js': swap(b['WebApp.js'], "      case 'career_save_constraints':    return jsonOut_(webCareerSaveConstraints_(body));\n", '') })],
  // ---- the Wins bank ------------------------------------------------------------------
  ['an existing month’s tab is written to again', b => ({ [C]: swap(b[C], "  if (exists) return { skipped: 'exists' };\n", '') })],
  ['baseline wins are sent again', b => ({ [C]: swap(b[C], "return ev.source !== 'baseline' && !ev.winsBankSent;", 'return !ev.winsBankSent;') })],
  // ---- nightly ------------------------------------------------------------------------
  ['the stale flag repeats every night', b => ({ [C]: swap(b[C], "key: CAR_AGENT_STALE_KEY_ + '__' + (h.lastFound || 'none'),", "key: CAR_AGENT_STALE_KEY_ + '__' + Math.random(),") })],
  ['the stale flag never clears', b => ({ [C]: swap(b[C], "  if (!h.stale) { resolveFlagsWithPrefix_(flagSheet, CAR_AGENT_STALE_KEY_); return 'healthy'; }", "  if (!h.stale) { return 'healthy'; }") })],
  ['suggestions run every night', b => ({ [C]: swap(b[C], "  if (last.quarter === quarter) return 'done this quarter';\n", '') })],
  ['a suggestion can repeat an existing criterion', b => ({ [C]: swap(b[C], " || have.indexOf(carNorm_(x.name)) !== -1", '') })],
  ['the health check is dropped from the nightly run', b => ({ 'Code.js': swap(b['Code.js'], "    nightlyStep_(ctx, 'carCheckAgentHealth_', carCheckAgentHealth_);\n", '') })],
  // ---- the dashboard -------------------------------------------------------------------
  ['any tab can be deep-linked', b => ({ [APP]: swap(b[APP], "if(q.get('tab')!=='career')return null;", '') })],
  ['the deep link stays in the address bar', b => ({ [APP]: swap(b[APP], "try{window.history.replaceState(null,'',window.location.pathname+window.location.hash);}catch(e){}", '') })],
  ['the status route is missing', b => ({ 'WebApp.js': swap(b['WebApp.js'], "      case 'career_set_status':          return jsonOut_(webCareerSetStatus_(body));\n", '') })],
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
