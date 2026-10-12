// Negative controls for the deploy cadence: revert ONE piece at a time and confirm
// test_deploycadence.js notices.
//
// This cadence is worth controlling more than most, because every way it can break
// breaks TOWARDS A GREEN TICK. A push that stops being unconditional, a reconcile that
// reads "unknown" as "no drift", a description nobody parses any more — each one leaves
// /exec serving old code while the workflow reports success. There is no red tick, no
// error in the log, and no symptom until someone wonders why a dashboard fix from three
// weeks ago still is not live.
//
// Unlike the other control runners, the files here are not root .js: the cadence lives
// across a workflow, a PowerShell script and one parser, so the copies preserve their
// relative paths and the test resolves everything from VERA_ROOT.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_deploycad');

const FILES = ['scripts/clasp-parse.js', 'scripts/deploy-marker.js',
               '.github/workflows/deploy.yml', 'push.ps1'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// An anchor that has moved must THROW, not quietly leave the file unchanged — a
// mutation that does not apply is a control that proves nothing while looking fine.
//
// The replacement goes through a FUNCTION, not a string: String.replace expands `$` in
// a string replacement (`$'` is "everything after the match"), and these replacements
// are full of `$(git rev-parse …)` and `$sha`. Passed as strings they would write
// something nobody wrote, and the runner would report a crash instead of a bite.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, function() { return to; });
};

const CONTROLS = {
  // ---- the parser ----------------------------------------------------------
  'the parser stops caring which deployment the sha belongs to': b => ({
    'scripts/clasp-parse.js': swap(b['scripts/clasp-parse.js'],
      '  var lines = String(text).split(\'\\n\');',
      '  var lines = [String(text)];'),
  }),
  // Both null-returns get their own control. Zero would read as "plenty of headroom"
  // and silence the ceiling warning permanently — the one warning whose whole job is
  // to arrive before the ceiling blocks a deploy.
  'an unreadable version count reads as zero instead of unknown': b => ({
    'scripts/clasp-parse.js': swap(b['scripts/clasp-parse.js'],
      '  if (!m) return null;', '  if (!m) return 0;'),
  }),
  'an empty version listing reads as zero instead of unknown': b => ({
    'scripts/clasp-parse.js': swap(b['scripts/clasp-parse.js'],
      '  if (!text) return null;', '  if (!text) return 0;'),
  }),
  'the parser accepts a description with no sha': b => ({
    'scripts/clasp-parse.js': swap(b['scripts/clasp-parse.js'],
      "const DESC_RE = /Auto-deploy\\s+([0-9a-f]{7,40})\\b/;",
      "const DESC_RE = /@\\d+ - (.+)$/;"),
  }),

  // ---- the marker ----------------------------------------------------------
  // The first of these is the actual defect, reproduced: it spent a version on the
  // commit that introduced the cadence, because that commit's body explains what
  // [deploy] means.
  'the marker is matched anywhere in the message again, body included': b => ({
    'scripts/deploy-marker.js': swap(b['scripts/deploy-marker.js'],
      "    var subject = String(msgs[i] == null ? '' : msgs[i]).split('\\n')[0];",
      "    var subject = String(msgs[i] == null ? '' : msgs[i]);"),
  }),
  'unreadable commit messages spend a version instead of none': b => ({
    'scripts/deploy-marker.js': swap(b['scripts/deploy-marker.js'],
      '  try { msgs = JSON.parse(text); } catch (e) { return false; }',
      '  try { msgs = JSON.parse(text); } catch (e) { return true; }'),
  }),
  'the workflow goes back to deciding the marker with contains()': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '          MARKER=$(printf \'%s\' "$COMMIT_MESSAGES" | node "$GITHUB_WORKSPACE/scripts/deploy-marker.js")',
      '          MARKER=${{ contains(toJSON(github.event.commits.*.message), \'[deploy]\') }}'),
  }),

  // ---- the cadence itself --------------------------------------------------
  // The one that matters most: if the push becomes conditional, every change that
  // is not marked [deploy] stops reaching triggers and the editor too, which is
  // most changes.
  'the push gets put behind the same gate as the deploy': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '      - name: Push to Apps Script\n        run: clasp push --force',
      "      - name: Push to Apps Script\n        if: steps.decide.outputs.should == 'true'\n        run: clasp push --force"),
  }),
  'the cadence stops being triggered by changes to itself': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      "      - '.github/workflows/deploy.yml'\n      - 'scripts/*.js'",
      "      - 'appsscript.json'"),
  }),
  'the reconcile treats an unreadable description as no drift': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '              SHOULD=true; REASON=drift-unknown',
      '              SHOULD=false; REASON=skip'),
  }),
  'a skipped deploy stops being reported': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '      - name: Report skipped deploy',
      '      - name: Say nothing about the skipped deploy'),
  }),
  // "Deploy skipped" on its own does not tell you how far behind /exec is, which is
  // the only number that decides whether to care.
  'the skip report stops naming the two shas': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '          MSG="Pushed $HEAD_SHA to Apps Script; no version minted. /exec is serving ${DEPLOYED:-an unreadable version}."',
      '          MSG="Deploy skipped."'),
  }),

  // ---- the load-bearing description ---------------------------------------
  'someone prettifies the deploy description': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '--description "Auto-deploy $(git rev-parse --short HEAD)"',
      '--description "Deployed from CI"'),
  }),
  'push.ps1 goes back to a description with no sha': b => ({
    'push.ps1': swap(b['push.ps1'], '--description "Auto-deploy $sha"', '--description "Auto-deployed"'),
  }),

  // ---- the guards around it ------------------------------------------------
  'the version-ceiling warning can fail the job': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '      - name: Warn near the version ceiling\n        continue-on-error: true',
      '      - name: Warn near the version ceiling'),
  }),
  'the deployment id goes back to being written out twice': b => ({
    '.github/workflows/deploy.yml': swap(b['.github/workflows/deploy.yml'],
      '          OUT=$(clasp deploy --deploymentId "$DEPLOYMENT_ID" \\',
      '          OUT=$(clasp deploy --deploymentId AKfycbx1PHRWmKbmHcVoVx0l-sVaCwWvaXceq-h55Xi-MA06zfUNDdfipM7B0HL4Gzm0IMta \\'),
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

  const r = cp.spawnSync('node', ['test_deploycadence.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
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
