// A failing regression run has to say WHAT failed, from outside the runner.
//
// The run that prompted this was a red tick and nothing else. Working out which
// requests hung meant reading the step log or the uploaded artifact — both served from
// blob storage that the API client used to investigate refuses to follow — or
// re-running the workflow, which that token cannot dispatch. One failure cost a whole
// push to identify, and the answer turned out to be legible only from the STEP TIMINGS:
// 46 seconds on the passing run against 3m40s on the failing one, which with
// `retries: 1` and a 20s request timeout is about four requests hanging and retried.
//
// Three things close that, and this file holds them in place:
//   1. the github reporter, whose ::error output becomes check-run annotations — the
//      one Actions endpoint that does answer;
//   2. the Slack message naming the failing tests;
//   3. every endpoint call timed and printed on EVERY run, so a request creeping
//      towards its timeout is visible before it is a red build.
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

const CONFIG = fs.readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
const SPEC   = fs.readFileSync(path.join(ROOT, 'tests/regression.spec.js'), 'utf8');
const WF     = fs.readFileSync(path.join(ROOT, '.github/workflows/regression.yml'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ============================================================================
console.log('The failure reaches the annotations endpoint');
{
  check('the github reporter is configured',
        /\['github'\]/.test(CONFIG),
        'its ::error output is what becomes a check-run annotation, and that endpoint ' +
        'is the only one readable when logs and artifacts cannot be fetched');
  check('…only under CI',
        /process\.env\.CI \|\| process\.env\.GITHUB_ACTIONS/.test(CONFIG),
        'locally the list reporter is already on screen');
  check('…alongside list and json, not instead of them',
        (CONFIG.match(/\['list'\]/g) || []).length === 2 &&
        (CONFIG.match(/outputFile: 'test-results\/results\.json'/g) || []).length === 2,
        'the json report is what the Slack step reads, and list is what a human reads');

  // The reporter name has to be one Playwright actually ships, or the run dies at
  // startup with "Unknown reporter" and reports nothing at all — worse than before.
  const RUNNER = path.join(ROOT, 'node_modules/playwright/lib/runner/index.js');
  if (fs.existsSync(RUNNER)) {
    const src = fs.readFileSync(RUNNER, 'utf8');
    check('"github" is a reporter this Playwright build knows',
          /"github"/.test(src),
          'an unknown reporter name fails the run before a single test executes');
  } else {
    check('"github" is a reporter this Playwright build knows', true,
          'playwright not installed here — skipped');
  }
}

console.log('\nThe Slack message names the failing tests');
{
  check('it reads the json report',
        /failing-titles\.js test-results\/results\.json/.test(WF));
  check('…guarded on the file existing',
        /if \[ -f test-results\/results\.json \]; then/.test(WF),
        'a missing report must still let the message go out saying the run failed');
  check('…and the titles are added to the message',
        /\*Failed:\*/.test(WF) && /\$\{FAILED\}/.test(WF));
  check('the payload is built with jq, not string interpolation',
        /jq -nc --arg t "\$TEXT"/.test(WF),
        'a quote or backslash in a test title would otherwise produce malformed JSON ' +
        'and lose the very message that explains the failure');
  check('the step still runs on success too',
        /- name: Notify Slack\n        if: always\(\)/.test(WF),
        'a green run should still report, or silence becomes ambiguous');
}

console.log('\nEvery endpoint call is timed');
{
  check('there is one timed helper, not a timer per test',
        /async function timedGet\(ctx, action, opts\)/.test(SPEC));
  check('…and no test calls ctx.get directly any more',
        (SPEC.match(/await ctx\.get\(/g) || []).length === 2,
        (SPEC.match(/await ctx\.get\(/g) || []).length + ' direct call(s) — expected ' +
        'exactly two: inside timedGet itself, and the warm-up');

  // Every action the suite exercises goes through it.
  ['status', 'get_notification_map', 'get_config_rows', 'address_book', 'regression_test']
    .forEach(a => {
      check('  ' + a + ' is timed',
            new RegExp("timedGet\\(ctx, '" + a + "'").test(SPEC), a);
    });

  check('a request that never answers is recorded, not just thrown',
        /endpointTimings\.push\(\{ action, ms, status: 'no answer' \}\)/.test(SPEC),
        'the hung requests are the whole diagnosis; losing them to the throw is how ' +
        'this was invisible');
  check('…and it still throws, so the test still fails',
        /status: 'no answer'[\s\S]{0,400}?throw err;/.test(SPEC),
        'swallowing it would turn a dead endpoint into a green run');
  check('the timings are reported after the block',
        /afterAll\([\s\S]{0,200}?reportEndpointTimings\(\)/.test(SPEC));
  check('…slowest first',
        /sort\(\(a, b\) => b\.ms - a\.ms\)/.test(SPEC));
  check('…and the ones that never answered are called out by name',
        /never answered/.test(SPEC) && /dead\.map\(t => t\.action\)/.test(SPEC));
}

console.log('\nThe warm-up measures as well as warms');
{
  check('there is one warm-up request before the API tests',
        /warm-up/.test(SPEC) &&
        SPEC.indexOf('warm-up') < SPEC.indexOf("timedGet(ctx, 'status'"),
        'after the first test it warms nothing');
  check('it gets a longer budget than the tests it protects',
        /action=status&token=\$\{VERA_TOKEN\}`,\s*\n?\s*\{ timeout: 45000 \}/.test(SPEC) ||
        /timeout: 45000/.test(SPEC),
        'a 20s budget is the thing it exists to stop being spent on a cold start');
  check('…and is NOT asserted',
        /catch \(err\) \{\n      console\.error\(`  🔥 warm-up got NO ANSWER/.test(SPEC),
        'its job is to measure and to warm; the tests below already gate, by name');
  check('its duration is printed either way',
        /🔥 warm-up: \$\{Date\.now\(\) - t0\}ms/.test(SPEC) &&
        /🔥 warm-up got NO ANSWER after \$\{Date\.now\(\) - t0\}ms/.test(SPEC),
        'that number is what separates a cold start from a sick endpoint');
}

// ============================================================================
// The extractor itself, driven with real report shapes. A one-liner inside the YAML
// would have been untestable — and the moment it matters is a failing run, which is
// the worst moment to be debugging the thing that reports failures.
console.log('\nfailing-titles.js');
{
  const { failingTitles, format } = require(path.join(ROOT, 'tests/failing-titles.js'));

  const report = { suites: [{ title: 'regression.spec.js', suites: [
    { title: 'Tier 3', specs: [
      { title: 'status endpoint returns ok', ok: false },
      { title: 'get_config_rows returns ok', ok: false },
      { title: 'get_notification_map returns ok', ok: true },
    ] },
    { title: 'Tier 1', specs: [{ title: 'page loads and root mounts', ok: true }] },
  ] }] };

  const titles = failingTitles(report);
  check('it finds the failing specs', titles.length === 2, JSON.stringify(titles));
  check('…by title', titles[0] === 'status endpoint returns ok', JSON.stringify(titles));
  check('…and ignores the passing ones',
        titles.indexOf('page loads and root mounts') === -1, JSON.stringify(titles));
  check('it descends into nested suites',
        titles.indexOf('get_config_rows returns ok') !== -1,
        'Playwright nests describe blocks, and a flat read would miss every one of them');

  // A skipped spec carries ok:true, so the credential-less skips must not be reported.
  const skipped = failingTitles({ suites: [{ specs: [
    { title: 'skipped for no creds', ok: true },
  ] }] });
  check('a skipped spec is not a failure', skipped.length === 0, JSON.stringify(skipped));

  check('nothing failing prints nothing at all',
        format([], 8) === '',
        'the caller tests for an empty string to leave the message unchanged');
  check('the list is capped', format(['a', 'b', 'c'], 2) === '• a\n• b\n…and 1 more',
        JSON.stringify(format(['a', 'b', 'c'], 2)) +
        ' — a total outage fails every test, and a wall of lines is not a report');
  check('…and the count still says it was total',
        /and 1 more/.test(format(['a', 'b', 'c'], 2)));

  // Guarded, so a version that DOES throw fails this assertion cleanly instead of
  // crashing the runner — a control that crashes reads as "did not bite".
  let malformed = '';
  let empties = [];
  try {
    empties = [failingTitles(null), failingTitles({}), failingTitles({ suites: null })];
  } catch (e) { malformed = e.message; }
  check('a malformed report yields nothing rather than throwing',
        malformed === '' && empties.every(a => a.length === 0),
        malformed || JSON.stringify(empties) +
        ' — the notification has to go out even when the report did not');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
