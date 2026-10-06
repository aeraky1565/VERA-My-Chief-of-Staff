// The failing test titles out of a Playwright JSON report, for the Slack message.
//
// A real script rather than a `node -e` one-liner inside the workflow, for one reason:
// a one-liner in YAML is untestable, and the thing it reports on is a failure — the
// moment you need it most is the moment you cannot debug it. This has a test
// (tests/source/test_regressionci.js) that drives it with real report shapes,
// including the empty and malformed ones.
//
// Prints nothing at all when there is nothing to say, so the caller can test for an
// empty string and leave the message as it was.
//
// Usage: node tests/failing-titles.js <results.json> [maxShown]

const fs = require('fs');

const MAX_DEFAULT = 8;   // a total outage fails everything; a wall of lines is not a report

function failingTitles(report) {
  const out = [];
  // Playwright nests suites arbitrarily deep: { suites: [ { specs: [...], suites: [...] } ] }
  (function walk(suite) {
    if (!suite || typeof suite !== 'object') return;
    (suite.specs || []).forEach(spec => {
      // `ok` is the spec's verdict after retries. A spec that was skipped has ok:true,
      // so this does not report the credential-less skips as failures.
      if (spec && spec.ok === false) out.push(String(spec.title || '(untitled)'));
    });
    (suite.suites || []).forEach(walk);
  })({ suites: report && report.suites });
  return out;
}

function format(titles, max) {
  if (!titles.length) return '';
  const shown = titles.slice(0, max).map(t => '• ' + t).join('\n');
  return titles.length > max
    ? shown + '\n…and ' + (titles.length - max) + ' more'
    : shown;
}

module.exports = { failingTitles, format };

if (require.main === module) {
  const file = process.argv[2];
  const max  = parseInt(process.argv[3], 10) || MAX_DEFAULT;
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // A missing or malformed report must not break the notification it belongs to —
    // the message still has to go out saying the run failed.
    process.stdout.write('');
    process.exit(0);
  }
  process.stdout.write(format(failingTitles(report), max));
}
