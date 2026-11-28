#!/usr/bin/env node
//
// Runs the source test suite in tests/source/.
//
// These tests read the repo's own .js files, brace-match the real functions out of
// them, and run those functions in a vm — so they verify the source rather than a
// transcription of it. They are separate from tests/regression.spec.js, which drives
// the deployed dashboard over the network.
//
// Usage:
//   node tests/run.js                      everything
//   node tests/run.js --node               tests that need no browser   (fast)
//   node tests/run.js --browser            tests that render in Chromium
//   node tests/run.js --controls           the ctl_* negative-control runners
//   node tests/run.js --list               print the classification and exit
//   node tests/run.js --changed            only tests that read a changed file, plus recent failures
//   node tests/run.js --jobs 4             how many files run at once (default: every core; --serial = 1)
//
// Selectors combine: --node --controls is what gates the Apps Script deploy.
//
// THE SUITE LEARNS FROM ITS OWN RUNS (tests/.timings.json, not committed; CI caches it):
//   - how long each file takes, so the slowest start first and the cores stay busy;
//   - which files failed lately, so --changed always re-runs them;
//   - flaky files: a failure that passes on one retry is reported as flaky (still a pass,
//     never skipped) and counted, so a repeat offender shows up in the summary to fix;
//   - a negative control whose anchor moved gets the closest line in the source now,
//     so re-pointing it is a copy and paste.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DIR = path.join(__dirname, 'source');

// A file goes in the browser group if it REQUIRES playwright or @babel/standalone —
// not if it merely mentions them. Several tests discuss both in their header comments
// and are pure Node (test_globals.js scans source text for them), and classifying by
// mention would drag those into the browser job and make it look broader than it is.
// A couple need only the babel bundle rather than Chromium; they ride along, since the
// browser job is the one with both installed.
const NEEDS_BROWSER = /require\(\s*['"][^'"]*(playwright|@babel\/standalone)/;

// Where Chromium is.
//
// The browser tests pass `executablePath: process.env.CHROMIUM_PATH`, and undefined
// means "use the one Playwright installed" — which is what CI does after
// `npx playwright install chromium`. These files used to hardcode an absolute path to
// one container's build, down to the build number, which would have failed on any
// other machine.
//
// Locally the browser often lives somewhere Playwright will not look
// (PLAYWRIGHT_BROWSERS_PATH), so find it once here rather than asking anyone to export
// a variable before running the suite.
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || base === '0' || !fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium')).sort().reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// A test may declare that it is SUPPOSED to fail, by carrying a line like
//
//     // EXPECT-FAILURES: 6
//
// test_triprow_control.js is a deliberately broken control: it reverts one rule so
// that the real test's assertions can be shown to bite. The count is checked
// EXACTLY — too few failures means the control has gone vacuous and is no longer
// controlling for anything, which is just as much a defect as too many.
const EXPECT_RE = /^\/\/\s*EXPECT-FAILURES:\s*(\d+)\s*$/m;

// A hung browser test would otherwise sit there until the CI job's own timeout,
// reporting nothing. Turn it into an ordinary failure with a readable reason.
const TIMEOUT_MS = { node: 60000, browser: 180000, control: 300000 };
// Running several at once slows each one down; the limits stretch with the pool.
let SLOWDOWN = 1;
const ROOT = path.join(__dirname, '..');
const TIMINGS = path.join(__dirname, '.timings.json');
const FLAKY_WINDOW_MS = 7 * 24 * 3600e3;

function classify() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
  const groups = { node: [], browser: [], controls: [] };
  files.forEach(f => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    if (f.startsWith('ctl_'))      groups.controls.push(f);
    else if (!f.startsWith('test_')) return;       // helpers, fixtures
    else if (NEEDS_BROWSER.test(src)) groups.browser.push(f);
    else groups.node.push(f);
  });
  return groups;
}

function expectedFailures(file) {
  const m = EXPECT_RE.exec(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return m ? Number(m[1]) : 0;
}

// Runs one file in its own process. Async, so several run at once (see main's pool).
function spawnOne(file, kind, chromium) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env);
    if (chromium) env.CHROMIUM_PATH = chromium;
    const t0 = Date.now();
    const child = cp.spawn(process.execPath, [file], { cwd: DIR, env: env });   // the controls spawn siblings with cwd: __dirname
    let out = '', timedOut = false;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS[kind] * SLOWDOWN);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ status: timedOut ? null : code, out: out, error: timedOut ? { code: 'ETIMEDOUT' } : null, ms: Date.now() - t0 });
    });
  });
}

async function runOne(file, kind, chromium) {
  const r = await spawnOne(file, kind, chromium);
  const out = r.out;
  const res = { file, kind, out, status: r.status, passed: 0, failed: 0, ok: false, why: '', ms: r.ms };

  if (r.error && r.error.code === 'ETIMEDOUT') {
    res.why = 'timed out after ' + Math.round(TIMEOUT_MS[kind] * SLOWDOWN / 1000) + 's';
    return res;
  }

  if (kind === 'control') {
    // The control runners report their own verdict and exit non-zero if any mutation
    // failed to break the test it targets.
    res.ok = r.status === 0 && /ALL CONTROLS BIT/.test(out);
    if (!res.ok) {
      res.why = /SOME CONTROLS DID NOT BITE/.test(out) ? 'a control did not bite'
              : 'exited ' + r.status + ' without a verdict';
    }
    const bit = out.match(/=== CONTROL:/g);
    res.passed = bit ? bit.length : 0;
    return res;
  }

  const sums = out.match(/(\d+) passed, (\d+) failed/g);
  if (!sums) {
    res.why = r.status === 0 ? 'printed no summary line' : 'crashed (exit ' + r.status + ')';
    return res;
  }
  const last = /(\d+) passed, (\d+) failed/.exec(sums[sums.length - 1]);
  res.passed = Number(last[1]);
  res.failed = Number(last[2]);

  const want = expectedFailures(file);
  res.expected = want;
  if (res.failed === want) {
    res.ok = true;
  } else if (want > 0) {
    res.why = 'expected exactly ' + want + ' deliberate failure(s), got ' + res.failed +
              (res.failed < want ? ' — the control has gone vacuous' : '');
  } else {
    res.why = res.failed + ' assertion(s) failed';
  }
  return res;
}

// ---- what the suite remembers between runs ------------------------------------------

function loadTimings() {
  try { const t = JSON.parse(fs.readFileSync(TIMINGS, 'utf8')); return t && typeof t === 'object' ? t : {}; } catch (e) { return {}; }
}
function saveTimings(t) {
  try { fs.writeFileSync(TIMINGS, JSON.stringify(t, null, 1)); } catch (e) {}
}
function remember(t, r, now) {
  const e = t[r.file] || { ms: 0, runs: 0, lastFail: 0, flaky: [] };
  e.ms = e.runs ? Math.round(e.ms * 0.6 + r.ms * 0.4) : r.ms;   // a moving average, so one slow run doesn't stick
  e.runs++;
  if (!r.ok) e.lastFail = now;
  if (r.flaky) e.flaky = (e.flaky || []).concat([now]);
  e.flaky = (e.flaky || []).filter(x => now - x < FLAKY_WINDOW_MS);
  t[r.file] = e;
}

// ---- --changed: the tests a change can affect ------------------------------------------

function changedFiles() {
  const run = args => { try { return cp.execSync('git ' + args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; } };
  let base = run('merge-base HEAD origin/main').trim();
  const list = (base ? run('diff --name-only ' + base) : '') + run('diff --name-only') + run('diff --name-only --cached') + run('ls-files --others --exclude-standard');
  return Array.from(new Set(list.split('\n').map(x => x.trim()).filter(Boolean)));
}
// A test is affected when it is itself changed, or its source names a changed file (read('Pantry.js'),
// 'docs/app.js' …). index.html is built from app.js, so a change to either reaches both.
function affected(file, changed) {
  if (changed.indexOf('tests/source/' + file) !== -1) return true;
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  return changed.some(c => {
    const names = [c, path.basename(c)];
    if (/docs\/(app\.js|index\.html)$/.test(c)) names.push('index.html', 'app.js');
    return names.some(n => src.indexOf("'" + n + "'") !== -1 || src.indexOf('"' + n + '"') !== -1 || src.indexOf('/' + n) !== -1);
  });
}

// ---- the anchor helper -------------------------------------------------------------------

const SEARCH_EXT = /\.(js|html)$/;
let SOURCE_LINES = null;
function sourceLines() {
  if (SOURCE_LINES) return SOURCE_LINES;
  SOURCE_LINES = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tests' || /\.min\.js$/.test(e.name) || e.name === 'index.html') return;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (d === ROOT || e.name === 'docs') walk(p); return; }
    if (!SEARCH_EXT.test(e.name)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (line.length < 2000) SOURCE_LINES.push({ file: path.relative(ROOT, p), n: i + 1, line: line }); });
  });
  walk(ROOT);
  return SOURCE_LINES;
}
const words = s => (String(s).match(/[A-Za-z_][A-Za-z0-9_]{2,}|\d+/g) || []);
// The line now most like the anchor that moved: the most shared words, then the shortest line.
function closestLine(anchor) {
  const want = Array.from(new Set(words(anchor)));
  if (!want.length) return null;
  let best = null;
  sourceLines().forEach(x => {
    const have = new Set(words(x.line));
    const hit = want.filter(w => have.has(w)).length;
    if (hit && (!best || hit > best.hit || (hit === best.hit && x.line.length < best.line.length))) best = { hit: hit, file: x.file, n: x.n, line: x.line };
  });
  return best && best.hit / want.length >= 0.5 ? best : null;
}
function anchorHints(out) {
  const moved = (out.match(/anchor moved: (.*)$/gm) || []).map(l => l.replace(/^anchor moved: /, ''));
  return moved.slice(0, 5).map(a => { const c = closestLine(a); return c ? '    anchor “' + a.slice(0, 60) + '…” → closest now ' + c.file + ':' + c.n + '  ' + c.line.trim().slice(0, 140) : '    anchor “' + a.slice(0, 60) + '…”: nothing close; the rule may be gone'; });
}

// ---- main ----------------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const groups = classify();

  if (argv.includes('--list')) {
    Object.keys(groups).forEach(g => {
      console.log('\n' + g + ' (' + groups[g].length + ')');
      groups[g].forEach(f => {
        const e = f.startsWith('test_') ? expectedFailures(f) : 0;
        console.log('  ' + f + (e ? '   [expects ' + e + ' failure(s)]' : ''));
      });
    });
    return 0;
  }

  const pick = { node: argv.includes('--node'), browser: argv.includes('--browser'),
                 controls: argv.includes('--controls') };
  if (!pick.node && !pick.browser && !pick.controls) pick.node = pick.browser = pick.controls = true;

  let plan = [];
  if (pick.node)     groups.node.forEach(f     => plan.push([f, 'node']));
  if (pick.browser)  groups.browser.forEach(f  => plan.push([f, 'browser']));
  if (pick.controls) groups.controls.forEach(f => plan.push([f, 'control']));

  const timings = loadTimings(), now = Date.now();
  if (argv.includes('--changed')) {
    const changed = changedFiles();
    const recent = f => timings[f] && timings[f].lastFail && now - timings[f].lastFail < FLAKY_WINDOW_MS;
    plan = plan.filter(([f]) => affected(f, changed) || recent(f));
    console.log('--changed: ' + changed.length + ' changed file(s) → ' + plan.length + ' test file(s)' + (changed.length ? ' (' + changed.slice(0, 6).join(', ') + (changed.length > 6 ? ', …' : '') + ')' : ''));
  }

  if (!plan.length) {
    console.error(argv.includes('--changed') ? 'nothing affected by the change' : 'no tests matched — is tests/source/ populated?');
    return argv.includes('--changed') ? 0 : 1;
  }

  const ji = argv.indexOf('--jobs');
  let jobs = argv.includes('--serial') ? 1 : ji !== -1 ? Number(argv[ji + 1]) : Number(process.env.VERA_TEST_JOBS) || require('os').cpus().length;
  jobs = Math.max(1, Math.min(jobs || 1, 16));
  SLOWDOWN = jobs > 1 ? 2 : 1;
  // Browsers are heavy: at most half the pool renders at once.
  const browserCap = Math.max(1, Math.floor(jobs / 2));

  const chromium = plan.some(([, k]) => k === 'browser') ? findChromium() : null;
  if (chromium) console.log('chromium: ' + chromium);

  // Slowest first (unknown files count as slow), so the last minutes aren't one long file alone.
  const order = plan.map((p, i) => ({ file: p[0], kind: p[1], i: i, ms: timings[p[0]] ? timings[p[0]].ms : 60000 }));
  order.sort((a, b) => b.ms - a.ms || a.i - b.i);
  console.log('running ' + order.length + ' file(s), ' + jobs + ' at a time' + (Object.keys(timings).length ? ', slowest first' : ''));

  const started = Date.now();
  const results = new Array(plan.length);
  let next = 0, browsers = 0;
  const take = () => {
    for (let k = next; k < order.length; k++) {
      if (order[k].kind === 'browser' && browsers >= browserCap) continue;
      const t = order.splice(k, 1)[0];
      return t;
    }
    return null;
  };
  const report = r => {
    const tag = r.ok ? (r.flaky ? 'ok* ' : 'ok  ') : 'FAIL';
    const detail = r.kind === 'control'
      ? (r.passed ? r.passed + ' controls' : '')
      : r.passed + ' passed' + (r.failed ? ', ' + r.failed + ' failed' : '') + (r.expected ? ' (' + r.expected + ' expected)' : '');
    console.log('  ' + tag + '  ' + r.file.padEnd(32) + detail + '  ' + (r.ms / 1000).toFixed(1) + 's' + (r.ok ? (r.flaky ? '   <- flaky: passed on retry' : '') : '   <- ' + r.why));
  };
  async function worker() {
    for (;;) {
      const t = take();
      if (!t) { if (order.length) { await new Promise(r => setTimeout(r, 200)); continue; } return; }
      if (t.kind === 'browser') browsers++;
      let r = await runOne(t.file, t.kind, t.kind === 'browser' ? chromium : null);
      // One retry, alone-ish: a pass then is flaky, reported and remembered, never hidden.
      if (!r.ok && !/timed out/.test(r.why)) {
        const again = await runOne(t.file, t.kind, t.kind === 'browser' ? chromium : null);
        if (again.ok) { again.flaky = true; again.firstWhy = r.why; r = again; }
      }
      if (t.kind === 'browser') browsers--;
      results[t.i] = r;
      remember(timings, r, now);
      report(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, plan.length) }, worker));
  saveTimings(timings);

  const all = results.filter(Boolean);
  const bad = all.filter(r => !r.ok);
  const totalPassed = all.reduce((n, r) => n + (r.kind === 'control' ? 0 : r.passed), 0);
  const totalFailed = all.reduce((n, r) => n + (r.kind === 'control' ? 0 : r.failed), 0);
  const expected    = all.reduce((n, r) => n + (r.expected || 0), 0);

  console.log('\n' + all.length + ' file(s) in ' + Math.round((Date.now() - started) / 1000) + 's (' + jobs + ' at a time)');
  console.log(totalPassed + ' assertions passed, ' + totalFailed + ' failed' +
              (expected ? ' (' + expected + ' of them deliberate)' : ''));

  const flaky = Object.keys(timings).filter(f => (timings[f].flaky || []).length >= 2);
  const flakyNow = all.filter(r => r.flaky);
  if (flakyNow.length || flaky.length) {
    console.log('\nflaky (passed only on a retry; worth fixing):');
    Array.from(new Set(flakyNow.map(r => r.file).concat(flaky))).forEach(f => console.log('  ' + f + ' — ' + ((timings[f] && timings[f].flaky) || []).length + ' time(s) this week'));
  }

  if (bad.length) {
    console.log('\n' + bad.length + ' file(s) need attention:');
    bad.forEach(r => console.log('  ' + r.file + ' — ' + r.why));
    // Print the failing assertions themselves, so CI logs are usable without
    // re-running anything locally.
    bad.forEach(r => {
      const lines = (r.out.match(/^\s*(FAIL|!!) .*$/gm) || []).slice(0, 15);
      if (!lines.length) return;
      console.log('\n' + r.file + ':');
      lines.forEach(l => console.log('  ' + l.trim()));
      anchorHints(r.out).forEach(l => console.log(l));
    });
    return 1;
  }

  console.log('\nall good');
  return 0;
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(1); });
