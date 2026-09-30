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
//
// Selectors combine: --node --controls is what gates the Apps Script deploy.

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

function runOne(file, kind, chromium) {
  const env = Object.assign({}, process.env);
  if (chromium) env.CHROMIUM_PATH = chromium;
  const r = cp.spawnSync(process.execPath, [file], {
    cwd: DIR,                       // the controls spawn siblings with cwd: __dirname
    encoding: 'utf8',
    timeout: TIMEOUT_MS[kind],
    env: env,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const res = { file, kind, out, status: r.status, passed: 0, failed: 0, ok: false, why: '' };

  if (r.error && r.error.code === 'ETIMEDOUT') {
    res.why = 'timed out after ' + (TIMEOUT_MS[kind] / 1000) + 's';
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

function main() {
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

  const plan = [];
  if (pick.node)     groups.node.forEach(f     => plan.push([f, 'node']));
  if (pick.browser)  groups.browser.forEach(f  => plan.push([f, 'browser']));
  if (pick.controls) groups.controls.forEach(f => plan.push([f, 'control']));

  if (!plan.length) {
    console.error('no tests matched — is tests/source/ populated?');
    return 1;
  }

  const chromium = plan.some(([, k]) => k === 'browser') ? findChromium() : null;
  if (chromium) console.log('chromium: ' + chromium);

  const started = Date.now();
  const results = [];
  let lastKind = null;
  plan.forEach(([file, kind]) => {
    if (kind !== lastKind) { console.log('\n--- ' + kind + ' ---'); lastKind = kind; }
    const r = runOne(file, kind, kind === 'browser' ? chromium : null);
    results.push(r);
    const tag = r.ok ? 'ok  ' : 'FAIL';
    const detail = kind === 'control'
      ? (r.passed ? r.passed + ' controls' : '')
      : r.passed + ' passed' + (r.failed ? ', ' + r.failed + ' failed' : '') +
        (r.expected ? ' (' + r.expected + ' expected)' : '');
    console.log('  ' + tag + '  ' + file.padEnd(32) + detail + (r.ok ? '' : '   <- ' + r.why));
  });

  const bad = results.filter(r => !r.ok);
  const totalPassed = results.reduce((n, r) => n + (r.kind === 'control' ? 0 : r.passed), 0);
  const totalFailed = results.reduce((n, r) => n + (r.kind === 'control' ? 0 : r.failed), 0);
  const expected    = results.reduce((n, r) => n + (r.expected || 0), 0);

  console.log('\n' + results.length + ' file(s) in ' + Math.round((Date.now() - started) / 1000) + 's');
  console.log(totalPassed + ' assertions passed, ' + totalFailed + ' failed' +
              (expected ? ' (' + expected + ' of them deliberate)' : ''));

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
    });
    return 1;
  }

  console.log('\nall good');
  return 0;
}

process.exit(main());
