// Deploys are opt-in, and the thing that makes opt-in safe is a weekly reconcile that
// reads the deployed sha back out of the live deployment's DESCRIPTION.
//
// That makes "Auto-deploy <short sha>" a contract between three files that have no
// other reason to agree: .github/workflows/deploy.yml writes it, push.ps1 writes it
// from a developer's machine, and scripts/clasp-parse.js reads it. Break any one and
// the failure is SILENT IN THE DIRECTION THAT MATTERS — the reconcile reports success
// while /exec quietly serves month-old code, because "no drift detected" and "I could
// not read the description" look identical in a green tick.
//
// So this file tests two things:
//   1. the parser, against clasp output shapes — including the ones that must read as
//      UNKNOWN, since unknown is what triggers the fail-open deploy;
//   2. that the three files still agree on the string, which is a text assertion and
//      says so.
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

const PARSE_PATH  = path.join(ROOT, 'scripts', 'clasp-parse.js');
const MARKER_PATH = path.join(ROOT, 'scripts', 'deploy-marker.js');
const YAML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const PS1  = fs.readFileSync(path.join(ROOT, 'push.ps1'), 'utf8');

// The real modules, not a transcription of them.
const { deployedSha, versionCount } = require(PARSE_PATH);
const { hasMarker } = require(MARKER_PATH);

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const ID = 'AKfycbx1PHRWmKbmHcVoVx0l-sVaCwWvaXceq-h55Xi-MA06zfUNDdfipM7B0HL4Gzm0IMta';
const OTHER = 'AKfycbzZZZZotherdeploymentZZZZ';

// ============ the parser: which sha is /exec serving ========================

console.log('deployedSha reads the sha off the right deployment');
{
  // The shape clasp prints: a count line, the @HEAD pseudo-deployment, then each
  // versioned deployment with its description.
  const listing = [
    '3 Deployments.',
    '- ' + ID + ' @HEAD',
    '- ' + OTHER + ' @7 - Auto-deploy 1111111',
    '- ' + ID + ' @42 - Auto-deploy f41b986',
    '',
  ].join('\n');

  check('finds the sha for our deployment', deployedSha(listing, ID) === 'f41b986',
        deployedSha(listing, ID));

  // THE TRAP. A parser that regexes the whole blob returns 1111111 here — the first
  // Auto-deploy in the output belongs to a different deployment — and then reports
  // drift forever, or no drift forever, depending which way the shas fall.
  check('…and not the one belonging to another deployment',
        deployedSha(listing, ID) !== '1111111', deployedSha(listing, ID));
  check('…reading the other deployment gives the other sha',
        deployedSha(listing, OTHER) === '1111111', deployedSha(listing, OTHER));

  const eight = '2 Deployments.\n- ' + ID + ' @42 - Auto-deploy f41b986a\n';
  check('an eight-character sha still reads', deployedSha(eight, ID) === 'f41b986a',
        deployedSha(eight, ID) + ' — git lengthens a short sha when it is ambiguous');
}

console.log('\ndeployedSha reads UNKNOWN rather than guessing');
{
  // Every case here routes the scheduled run into the fail-open branch: deploy once,
  // log the reason. Reading these as a sha instead would be the silent failure.
  check('our deployment absent from the listing',
        deployedSha('1 Deployments.\n- ' + OTHER + ' @7 - Auto-deploy 1111111\n', ID) === '',
        JSON.stringify(deployedSha('1 Deployments.\n- ' + OTHER + ' @7 - Auto-deploy 1111111\n', ID)));

  // push.ps1's old string. It is in here because it was LIVE on the deployment at the
  // time this was written, so the first reconcile met exactly this input.
  const old = '2 Deployments.\n- ' + ID + ' @42 - Auto-deployed\n';
  check('"Auto-deployed" with no sha reads as unknown', deployedSha(old, ID) === '',
        JSON.stringify(deployedSha(old, ID)));

  check('a deployment with no description at all',
        deployedSha('2 Deployments.\n- ' + ID + ' @42\n', ID) === '',
        JSON.stringify(deployedSha('2 Deployments.\n- ' + ID + ' @42\n', ID)));

  check('a hand-written description', deployedSha('- ' + ID + ' @42 - before the refactor\n', ID) === '',
        JSON.stringify(deployedSha('- ' + ID + ' @42 - before the refactor\n', ID)));

  // clasp failing prints to stderr and the workflow pipes it in anyway.
  check('an error message instead of a listing',
        deployedSha('Could not read API credentials. Are you logged in globally?', ID) === '');
  check('empty output', deployedSha('', ID) === '');
  check('no deployment id to look for', deployedSha('- x @42 - Auto-deploy f41b986', '') === '');
}

// ============ the parser: how much headroom is left ========================

console.log('\nversionCount reads the ceiling, or admits it cannot');
{
  check('the v2 count line', versionCount('183 Versions.\n- 183 - Auto-deploy f41b986\n') === 183,
        versionCount('183 Versions.\n'));
  check('the tilde-wrapped variant', versionCount('~ 183 Versions ~\n') === 183,
        versionCount('~ 183 Versions ~\n'));
  check('singular', versionCount('1 Version.\n') === 1, versionCount('1 Version.\n'));
  check('a count below the warning line still reads', versionCount('42 Versions.\n') === 42,
        versionCount('42 Versions.\n'));

  // null, NOT zero. Zero would mean "plenty of headroom" and silence the warning for
  // good; null prints a notice saying the number is unknown.
  check('unreadable output is null, not zero', versionCount('Error: not logged in') === null,
        JSON.stringify(versionCount('Error: not logged in')));
  check('empty output is null', versionCount('') === null, JSON.stringify(versionCount('')));
  check('…and null is not 0', versionCount('') !== 0);
}

// ============ only a subject line can spend a version ======================

console.log('\nhasMarker reads the subject, not the essay underneath it');
{
  const J = v => JSON.stringify(v);

  // THE COMMIT THAT CAUSED THIS. Subject carries no marker; the body explains what
  // the marker is for. `contains(toJSON(...), '[deploy]')` said true and spent a
  // version on the one commit written to demonstrate a skipped deploy.
  const theIncident = 'Spend a deploy version only when /exec needs one\n\n' +
    'always pushes and deploys only when a version is actually needed: a commit\n' +
    'marked [deploy], a manual dispatch, or a Sunday reconcile that deploys solely\n' +
    'when /exec has fallen behind main.\n';
  check('prose about the marker does not opt in', hasMarker(J([theIncident])) === false,
        'this exact message spent a version in run #114');

  check('a marked subject opts in', hasMarker(J(['Add the meal plan tab [deploy]'])) === true);
  check('…at the front of the subject too', hasMarker(J(['[deploy] fix the chat row numbers'])) === true);
  check('an unmarked subject does not', hasMarker(J(['Tidy the nightly budget log'])) === false);

  // A push of several commits deploys if ANY subject asks for it — otherwise batching
  // a dashboard fix behind a doc tweak would silently skip it.
  check('any one marked subject in the push is enough',
        hasMarker(J(['Tidy the log', 'Fix the Meal Plan week [deploy]', 'Update README'])) === true);
  check('…and none means none',
        hasMarker(J(['Tidy the log', 'Update README',
                     'Explain the deploy cadence in the docs\n\nmark a commit [deploy]\n'])) === false);

  // A revert quotes the original message wholesale, body and all.
  check('a revert quoting a marked commit does not re-opt in',
        hasMarker(J(['Revert "Fix the Meal Plan week"\n\nThis reverts commit abc1234.\nOriginal subject: Fix the Meal Plan week [deploy]\n'])) === false);

  // FAILS CLOSED, unlike the drift check. A missed marker costs a week; a spent
  // version cannot be reclaimed by any API.
  check('a schedule or dispatch has no commits', hasMarker('[]') === false);
  check('unparseable input spends nothing', hasMarker('not json') === false);
  check('…nor does an empty string', hasMarker('') === false);
  check('…nor a JSON object instead of an array', hasMarker('{"message":"x [deploy]"}') === false);
}

// ============ the three files still agree on the string ====================

console.log('\nthe description format is the same in every file that touches it');
{
  const DESC = '--description "Auto-deploy $(git rev-parse --short HEAD)"';
  check('deploy.yml writes the sha into the description', YAML.indexOf(DESC) !== -1,
        'the reconcile reads this back; see scripts/clasp-parse.js');
  check('push.ps1 writes the same format', /--description "Auto-deploy \$sha"/.test(PS1),
        'a local deploy that writes "Auto-deployed" makes every Sunday spend a version');
  check('…and push.ps1 computes that sha from git',
        /\$sha\s*=\s*\(git rev-parse --short HEAD\)/.test(PS1));
  check('the parser still looks for that prefix',
        fs.readFileSync(PARSE_PATH, 'utf8').indexOf('Auto-deploy') !== -1);
}

// ============ the workflow's shape is the cadence ==========================

console.log('\ndeploy.yml pushes always and deploys sometimes');
{
  // A `clasp push` behind the same gate as the deploy would undo the whole design:
  // triggers and the editor would stop getting fixes, which is the 90% of changes
  // that are not dashboard-served.
  const at = YAML.indexOf('name: Push to Apps Script');
  const next = YAML.indexOf('- name:', at);
  const pushStep = at === -1 ? '' : YAML.slice(at, next === -1 ? YAML.length : next);
  check('the push step exists', at !== -1);
  check('…and is NOT conditional', pushStep.indexOf('if:') === -1,
        pushStep.replace(/\s+/g, ' ').slice(0, 120));

  const dAt = YAML.indexOf('name: Deploy new version');
  const dStep = dAt === -1 ? '' : YAML.slice(dAt - 200, dAt + 200);
  check('the deploy step is gated on the decision',
        /if:\s*steps\.decide\.outputs\.should == 'true'/.test(dStep),
        dStep.replace(/\s+/g, ' ').slice(0, 160));

  // Otherwise the commit that rewrites the decision logic is the one commit that
  // never runs it.
  check('a change to the workflow triggers the workflow',
        /- '\.github\/workflows\/deploy\.yml'/.test(YAML));
  check('…and a change to either script does too',
        /- 'scripts\/\*\.js'/.test(YAML));

  // The reconcile's diff is against the DEPLOYED commit, which a depth-1 checkout
  // does not contain — it would resolve to "not in this history" and deploy weekly.
  check('the deploy job checks out full history', /fetch-depth: 0/.test(YAML),
        'the reconcile diffs against the deployed commit');

  // The expression form is what matched the prose. It must not come back.
  check('the marker is decided by the script, not by a contains() on the whole message',
        /deploy-marker\.js"/.test(YAML) &&
        !/contains\(toJSON\(github\.event\.commits\.\*\.message\)/.test(YAML),
        'contains() over the full message matched a commit body and spent a version');
  check('…and the script is handed every commit message in the push',
        /COMMIT_MESSAGES: \$\{\{ toJSON\(github\.event\.commits\.\*\.message\) \}\}/.test(YAML));
  check('workflow_dispatch is still the manual escape hatch', /^  workflow_dispatch:/m.test(YAML));

  // Without the schedule, a forgotten marker is permanent.
  check('the weekly reconcile is scheduled', /cron:\s*'37 17 \* \* 0'/.test(YAML));
  check('…in this file, so it inherits the live-/exec concurrency group',
        /group:\s*vera-live-exec/.test(YAML));
  check('…and it reads the deployed sha to decide',
        /clasp-parse\.js' deployed-sha/.test(YAML) || /clasp-parse\.js" deployed-sha/.test(YAML),
        'drift is read, not assumed');
  check('…failing open when it cannot be read', /REASON=drift-unknown/.test(YAML),
        'unknown must deploy; the alternative is /exec lagging in silence');

  // A skipped deploy that says nothing is how divergence becomes a mystery. The
  // assertion is scoped to that STEP: both shas appear in the decide step's own log
  // line too, and a check against the whole file would stay green while the report
  // itself said only "skipped".
  const sAt = YAML.indexOf('name: Report skipped deploy');
  const sStep = sAt === -1 ? '' : YAML.slice(sAt, YAML.indexOf('- name:', sAt));
  check('a skipped deploy is reported', sAt !== -1);
  check('…naming both shas', /\$HEAD_SHA/.test(sStep) && /\$\{DEPLOYED:-/.test(sStep),
        sStep.replace(/\s+/g, ' ').slice(0, 160));
  check('…and saying how to put the code on /exec', /\[deploy\]/.test(sStep));

  // The headroom warning must not be able to block a deploy.
  const vAt = YAML.indexOf('name: Warn near the version ceiling');
  const vStep = vAt === -1 ? '' : YAML.slice(vAt, YAML.indexOf('- name:', vAt));
  check('the ceiling warning exists', vAt !== -1);
  check('…and cannot fail the job', /continue-on-error:\s*true/.test(vStep),
        'a clasp output change must not be able to block a deploy');
  check('…and warns rather than exits', vStep.indexOf('::warning::') !== -1 && !/\bexit 1\b/.test(vStep));
  check('…below the 200 ceiling, with room to act', /-ge 180/.test(vStep));

  // The deployment id was inline in one place and is now read twice.
  check('the deployment id is declared once', (YAML.match(/AKfycbx1PHRW/g) || []).length === 1,
        'two copies of a deployment id is one too many');
  check('…and referenced through the env var', (YAML.match(/\$DEPLOYMENT_ID/g) || []).length >= 2);
}

// ============ the reconcile, run for real against real git history ========
//
// Everything above this point is a parser or a text assertion. The decision itself
// is shell, and the mistake it nearly shipped was invisible to both: comparing
// main's sha to the deployed sha reads EVERY commit as drift, including the ones
// that change only tests and docs, so a weekly reconcile would have minted a version
// every Sunday for ever — on a 30-version budget. The only way to see that is to run
// the step.
//
// So: extract the real `run:` block out of deploy.yml, build throwaway git repos,
// stub clasp, and let it decide.

console.log('\nthe reconcile asks what /exec serves, not whether main moved');
{
  // The step's script, lifted verbatim. No yaml library in this suite, so the block
  // is read by indentation — and if that ever stops finding it, this throws rather
  // than silently testing nothing.
  function extractRun(yaml, stepName) {
    const at = yaml.indexOf('name: ' + stepName);
    if (at === -1) throw new Error('step not found: ' + stepName);
    const runAt = yaml.indexOf('run: |', at);
    if (runAt === -1) throw new Error('no run block: ' + stepName);
    const lines = yaml.slice(yaml.indexOf('\n', runAt) + 1).split('\n');
    const indent = /^(\s*)/.exec(lines[0])[1].length;
    const out = [];
    for (const l of lines) {
      if (l.trim() !== '' && /^(\s*)/.exec(l)[1].length < indent) break;
      out.push(l.slice(indent));
    }
    return out.join('\n');
  }

  const decide = extractRun(YAML, 'Decide whether to deploy');
  check('the decision script was found in the workflow',
        /SHOULD=true; REASON=drift/.test(decide) && /GITHUB_OUTPUT/.test(decide),
        decide.slice(0, 80));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-cadence-'));
  const sh = path.join(tmp, 'decide.sh');
  fs.writeFileSync(sh, 'set -e\n' + decide);
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);

  const git = (repo, args) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  // A repo with one commit that changes a root .js file (which clasp pushes) and one
  // that changes only a test (which it does not).
  function buildRepo() {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@example.com']);
    git(repo, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(repo, 'Code.js'), 'function a(){}\n');
    git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'base']);
    const base = git(repo, ['rev-parse', '--short=7', 'HEAD']);

    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'x.js'), '// a test\n');
    fs.writeFileSync(path.join(repo, 'README.md'), 'docs\n');
    git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'tests and docs only']);
    const docsOnly = git(repo, ['rev-parse', '--short=7', 'HEAD']);

    fs.writeFileSync(path.join(repo, 'Code.js'), 'function a(){ return 1; }\n');
    git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'change what /exec serves']);
    const served = git(repo, ['rev-parse', '--short=7', 'HEAD']);
    return { repo: repo, base: base, docsOnly: docsOnly, served: served };
  }

  const R = buildRepo();
  const ID = 'AKfycbTESTdeploymentIDTESTTESTTEST';

  // `at` is the commit the stubbed deployment claims to be serving; HEAD is wherever
  // the repo is checked out.
  function run(event, deployedSha, head, messages) {
    fs.writeFileSync(path.join(bin, 'clasp'),
      '#!/bin/bash\n' + (deployedSha === null
        ? 'echo "nope" >&2; exit 1\n'
        : 'echo "- ' + ID + ' @HEAD"\necho "- ' + ID + ' @42 - Auto-deploy ' + deployedSha + '"\n'));
    fs.chmodSync(path.join(bin, 'clasp'), 0o755);
    git(R.repo, ['checkout', '-q', head]);
    const outFile = path.join(tmp, 'out.txt');
    fs.writeFileSync(outFile, '');
    const r = cp.spawnSync('bash', [sh], {
      cwd: R.repo, encoding: 'utf8',
      env: Object.assign({}, process.env, {
        PATH: bin + path.delimiter + process.env.PATH,
        EVENT: event,
        COMMIT_MESSAGES: JSON.stringify(messages || []),
        DEPLOYMENT_ID: ID,
        GITHUB_OUTPUT: outFile,
        GITHUB_WORKSPACE: REPO,          // where the two scripts live
      }),
    });
    const o = {};
    fs.readFileSync(outFile, 'utf8').split('\n').forEach(l => {
      const i = l.indexOf('=');
      if (i > 0) o[l.slice(0, i)] = l.slice(i + 1);
    });
    o.exit = r.status;
    o.log = (r.stdout || '') + (r.stderr || '');
    return o;
  }

  // THE DEFECT THIS SECTION EXISTS FOR.
  let o = run('schedule', R.base, R.docsOnly);
  check('a tests-and-docs commit is not drift',
        o.should === 'false' && o.reason === 'skip',
        o.reason + ' — comparing shas here mints a version every Sunday for ever');
  check('…and it says why rather than going quiet',
        /nothing Apps Script serves changed/.test(o.log), o.log.trim().split('\n').pop());

  o = run('schedule', R.base, R.served);
  check('a change to a root .js file IS drift', o.should === 'true' && o.reason === 'drift', o.reason);
  check('…and names the file', /Code\.js/.test(o.log), o.log.trim().split('\n').pop());

  o = run('schedule', R.served, R.served);
  check('/exec already on HEAD is not drift', o.should === 'false' && o.reason === 'skip', o.reason);

  o = run('schedule', null, R.served);
  check('an unreadable description deploys', o.should === 'true' && o.reason === 'drift-unknown', o.reason);

  // A sha that parses but is not in this history — a force-push, or a deploy from
  // somewhere else. Unknowable, so it must not read as "no drift".
  o = run('schedule', 'deadbee', R.served);
  check('a sha that is not in this history deploys',
        o.should === 'true' && o.reason === 'drift-unknown', o.reason);

  // The other events must be unaffected by all of the above.
  o = run('push', R.base, R.docsOnly, ['Tidy the tests']);
  check('an unmarked push never deploys', o.should === 'false' && o.reason === 'skip', o.reason);
  o = run('push', R.base, R.docsOnly, ['Tidy the tests [deploy]']);
  check('a marked push deploys whatever changed', o.should === 'true' && o.reason === 'marker', o.reason);
  o = run('workflow_dispatch', R.base, R.docsOnly);
  check('a manual dispatch deploys', o.should === 'true' && o.reason === 'manual', o.reason);

  check('every run exited cleanly', o.exit === 0, 'exit ' + o.exit);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
