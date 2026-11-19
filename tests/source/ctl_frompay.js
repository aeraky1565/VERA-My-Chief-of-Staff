// Negative controls for what comes out of pay (Budget.js bgWithPay_; test_frompay.js). Each puts back
// one way a payroll line would be counted as a bill, or take-home or the HSA would be wrong.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fpay');
// Every root .js: the harness reads more of them than it mutates, and they share
// one global scope.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const BU = 'Budget.js', B = 'BillSchedule.js';
const rep = (f, a, b2) => b => { if (b[f].indexOf(a) === -1) throw new Error('anchor not found: ' + a.slice(0, 60)); return { [f]: b[f].replace(a, b2) }; };
const CONTROLS = {
  'dental isn’t recognised': rep(BU, '|\\bdental\\b', ''),
  'a shared line on any account comes from pay': rep(BU, '    if (who && say(x.name)) x.fromPay = who;', "    if (say(x.name)) x.fromPay = who || 'joint';"),
  'a person’s own lines are never from pay': rep(BU, '    p.fixed.concat(p.nice).forEach(function(x) { if (say(x.name)) x.fromPay = p.key; });', ''),
  'Config can’t say no': rep(BU, "/^(no|n|false|0)$/.test(v) ? false : ", ''),
  'the HSA stays the tracker’s monthly figure': rep(BU, '      x.trackerAmount = x.amount; x.amount = bgRound_(annual / 12);', '      x.trackerAmount = x.amount;'),
  'the HSA reads the wrong year': rep(BU, "cfg['hsa_annual_' + year] == null ? '' : cfg['hsa_annual_' + year]", "cfg['hsa_annual_2026'] == null ? '' : cfg['hsa_annual_2026']"),
  'the server never marks the model': rep(BU, "    bgWithPay_(model, cfg, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy'));", ''),
  'take-home ignores what comes from pay': rep(BU, ',takeHome:bgRound_(net-fromPay)};});', ',takeHome:bgRound_(net)};});'),
  'shared lines on the paycheck aren’t counted': rep(BU, '.concat(lines.filter(function(x){return x.fromPay===p.key;}))', ''),
  'a line from pay is still a bill': rep(B, "    if (x.fromPay) { fromPay.push(x.name); return; }", ''),
  'next year’s HSA isn’t sent': rep(BU, '[y0, y0 + 1].forEach', '[y0].forEach'),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_frompay.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
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
