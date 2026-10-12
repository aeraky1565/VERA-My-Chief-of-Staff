// Negative controls for test_networth.js: revert ONE protection at a time and confirm
// the test bites.
//
// Every failure this guards is silent in production. A positional read returns a
// different number without complaint; a write to the planner corrupts another
// system's data; a flag with an amount in it reaches the morning email; a Joint
// balance counted twice inflates a total nobody re-adds by hand. So each protection
// gets a control, and two of them are bugs this file's code really had on the way in:
// the header prefix match that read "Bucket key" as "Bucket", and the dash anywhere in
// the text taken for a minus sign.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_netwrth');

const FILES = ['NetWorth.js', 'Trips.js', 'Code.js', 'WebApp.js', 'TestBench.js',
               'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// An anchor that has moved must THROW rather than leave the file unchanged, and the
// replacement goes through a FUNCTION: String.replace expands `$` in a string
// replacement, and these swaps are full of '$'.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const NW = 'NetWorth.js', APP = 'docs/app.js', LITE = 'docs/dashboard-lite.html';

const CONTROLS = {
  // ---- reading by label --------------------------------------------------
  'Outputs is read from a fixed row instead of by its label': b => ({
    [NW]: swap(b[NW], "    if (nwNorm_(grid[r][0]) !== 'net worth') continue;", '    if (r !== 5) continue;'),
  }),
  'balances are read from fixed owner columns': b => ({
    [NW]: swap(b[NW], '      var amount = nwNumber_(grid[r][owners[o].col]);', '      var amount = nwNumber_(grid[r][2 + o]);'),
  }),
  'headers go back to one prefix pass (the "Bucket key" read as "Bucket" bug)': b => ({
    [NW]: swap(b[NW],
      "  for (i = 0; i < headers.length; i++) {\n    if (nwNorm_(headers[i]) === want) return i;\n  }\n" +
      "  for (i = 0; i < headers.length; i++) {\n    if (nwNorm_(headers[i]).indexOf(want + ' ') === 0) return i;\n  }",
      "  for (i = 0; i < headers.length; i++) {\n    var h = nwNorm_(headers[i]);\n" +
      "    if (h === want || h.indexOf(want + ' ') === 0) return i;\n  }"),
  }),

  // ---- a missing number is never a wrong one -----------------------------
  'text in a money cell becomes $0': b => ({
    [NW]: swap(b[NW], '  if (!/^\\d+(\\.\\d+)?$/.test(s)) return null;', '  if (!/^\\d+(\\.\\d+)?$/.test(s)) return 0;'),
  }),
  'a blank planner figure becomes $0': b => ({
    [NW]: swap(b[NW], "    if (value === null || String(grid[r][1] == null ? '' : grid[r][1]).trim() === '') {",
                      '    if (value === null) {'),
  }),
  'an unmapped bucket is dropped instead of grouped as Unmapped': b => ({
    [NW]: swap(swap(b[NW], '    var c = cls[key] || NW_UNMAPPED_;', '    var c = cls[key];'),
               '    var t = tax[key] || NW_UNMAPPED_;', '    var t = tax[key];'),
  }),

  // ---- never write to the planner ----------------------------------------
  'the read path writes a note on the planner': b => ({
    [NW]: swap(b[NW], '    out[name] = sh ? sh.getDataRange().getValues() : null;',
                      "    if (sh) sh.getRange(1, 1).setNote('read by VERA');\n    out[name] = sh ? sh.getDataRange().getValues() : null;"),
  }),

  // ---- the CD flag ------------------------------------------------------
  'the CD flag carries the amount': b => ({
    [NW]: swap(b[NW], "      reason:  'From the planner sheet’s CDs tab.',", "      reason:  'Amount: $' + cd.amount + '.',"),
  }),
  'the 30-day window loses its last day': b => ({
    [NW]: swap(b[NW], '    if (days < 0 || days > NW_CD_FLAG_DAYS_) return;', '    if (days < 0 || days >= NW_CD_FLAG_DAYS_) return;'),
  }),
  'a CD flag is raised again every night': b => ({
    [NW]: swap(b[NW], '    if (keys[f.key]) return;\n', ''),
  }),
  'the flag key drops the maturity date, so a rolled-over CD never flags again': b => ({
    [NW]: swap(b[NW], "  return NW_CD_FLAG_PREFIX_ + slug + '_' + cd.matures;", '  return NW_CD_FLAG_PREFIX_ + slug;'),
  }),

  // ---- the mapping seed --------------------------------------------------
  'the seed ignores that it already ran, putting deleted rows back': b => ({
    [NW]: swap(b[NW], '  if (props.getProperty(NW_SEEDED_PROPERTY_)) return 0;\n', ''),
  }),
  'the seed writes over rows that already exist': b => ({
    [NW]: swap(b[NW], '    if (existing[pair[0]]) return;\n', ''),
  }),

  // ---- the slicer (the shared dashboard block) ---------------------------
  'Joint counts under each person as well': b => ({
    [APP]: swap(b[APP], '  return !f || nwDimValue_(item, f.dim) === f.value;',
                        "  return !f || nwDimValue_(item, f.dim) === f.value || (f.dim === 'owner' && item.owner === 'Joint');"),
  }),
  'CDs follow owner filters only, ignoring the rest': b => ({
    [APP]: swap(b[APP], '  return !f || nwDimValue_(item, f.dim) === f.value;',
                        "  return !f || (item.bucketKey && f.dim !== 'owner') || nwDimValue_(item, f.dim) === f.value;"),
  }),
  'Unmapped stops sorting last': b => ({
    [APP]: swap(b[APP], "    order = known.concat(other, seen.indexOf('Unmapped') !== -1 ? ['Unmapped'] : []);", '    order = seen;'),
  }),
  'dates parse as UTC midnight (the day before, west of Greenwich)': b => ({
    [APP]: swap(b[APP], '  return p.length >= 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;', '  return p.length >= 3 ? new Date(iso) : null;'),
  }),
  'one dashboard’s copy drifts from the other': b => ({
    [LITE]: swap(b[LITE], "'Read live from the planner sheet when this tab opens. VERA never writes to it.'",
                          "'Read live from the planner sheet when this tab opens. VERA never writes to it!'"),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });

  // West of Greenwich, so a UTC date parse lands on the wrong day and can be seen.
  const r = cp.spawnSync('node', ['test_networth.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, TZ: 'America/New_York' }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
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
