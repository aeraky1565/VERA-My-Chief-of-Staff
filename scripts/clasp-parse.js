#!/usr/bin/env node
//
// Reads the two facts the deploy workflow needs out of clasp's own output:
// which commit the live /exec deployment is serving, and how close the project
// is to Google's 200-version ceiling.
//
// WHY THIS IS A MODULE AND NOT TWO LINES OF grep IN THE YAML
//
// Deploys are now opt-in: a push to main always runs `clasp push`, but a VERSION is
// only minted for a commit marked [deploy], a manual dispatch, or the weekly
// reconcile. The reconcile is what makes opt-in safe, and it works by comparing the
// sha in the live deployment's DESCRIPTION — "Auto-deploy <short sha>" — against
// HEAD. That description string is therefore load-bearing: change it to something
// prettier and the reconcile silently stops reconciling while still reporting
// success. A parser in a file can be fed fixtures and controlled; a grep buried in a
// run: block cannot.
//
// Both functions FAIL SOFT, returning '' / null rather than throwing. The callers
// treat "I could not read this" as a reason to deploy (at most one wasted version a
// week) or to warn (never to block), so a future clasp whose output looks different
// degrades the cadence instead of breaking the deploy.
//
// Usage:
//   clasp deployments | node scripts/clasp-parse.js deployed-sha <deploymentId>
//   clasp versions    | node scripts/clasp-parse.js version-count

'use strict';

// clasp prints one line per deployment:
//
//   2 Deployments.
//   - AKfycbx1PHRW... @HEAD
//   - AKfycbx1PHRW... @42 - Auto-deploy f41b986
//
// Only the line carrying the deployment id we actually serve counts. Matching the
// whole blob instead would happily read the sha off a different deployment, or off
// the @HEAD line, and then report no drift when /exec is weeks behind.
const DESC_RE = /Auto-deploy\s+([0-9a-f]{7,40})\b/;

function deployedSha(text, deploymentId) {
  if (!text || !deploymentId) return '';
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(deploymentId) === -1) continue;
    var m = DESC_RE.exec(lines[i]);
    if (m) return m[1];
  }
  return '';
}

// `clasp versions` ends with a count line — "183 Versions." in v2, "~ 183 Versions ~"
// in some builds. The per-version lines ("- 42 - Auto-deploy f41b986") carry no
// "Version" word, so the first match is the summary either way.
const COUNT_RE = /(\d+)\s+Versions?\b/i;

function versionCount(text) {
  if (!text) return null;
  var m = COUNT_RE.exec(String(text));
  if (!m) return null;
  var n = Number(m[1]);
  return isFinite(n) ? n : null;
}

module.exports = { deployedSha: deployedSha, versionCount: versionCount };

// ---- CLI -------------------------------------------------------------------
//
// Prints the answer and nothing else, so the workflow can assign it straight to a
// shell variable. An unreadable input prints an empty line and still exits 0 — see
// the fail-soft note above.
if (require.main === module) {
  var mode = process.argv[2];
  var arg = process.argv[3];
  if (mode !== 'deployed-sha' && mode !== 'version-count') {
    process.stderr.write('usage: clasp-parse.js deployed-sha <deploymentId> | version-count\n');
    process.exit(2);
  }
  var chunks = [];
  process.stdin.on('data', function(c) { chunks.push(c); });
  process.stdin.on('end', function() {
    var text = Buffer.concat(chunks).toString('utf8');
    if (mode === 'deployed-sha') {
      process.stdout.write(deployedSha(text, arg) + '\n');
    } else {
      var n = versionCount(text);
      process.stdout.write((n === null ? '' : String(n)) + '\n');
    }
  });
}
