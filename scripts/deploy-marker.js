#!/usr/bin/env node
//
// Does this push opt in to minting an Apps Script version?
//
// THE INCIDENT THIS FILE EXISTS FOR. The marker check was one GitHub expression:
//
//     contains(toJSON(github.event.commits.*.message), '[deploy]')
//
// and the very first commit it saw was the one that introduced the cadence. Its
// SUBJECT carried no marker. Its BODY explained the design — "a commit marked
// [deploy], a manual dispatch, or a Sunday reconcile" — and `contains` matched the
// prose about the marker, so the commit that was written to demonstrate a skipped
// deploy spent a version instead.
//
// A check that matches writing ABOUT a thing instead of the thing is the same defect
// as a test asserting on a comment. The fix is that only the FIRST LINE of a commit
// message can opt in: a subject line is 72 characters of intent, not a place anyone
// discusses tooling, while a body is exactly where this cadence gets explained — in
// commit messages, in design notes pasted into commits, in reverts quoting the
// original.
//
// THIS FAILS CLOSED, which is the opposite of the drift check in clasp-parse.js, on
// purpose. The two mistakes are not symmetrical: a marker missed costs at most a week
// of /exec lag, because the Sunday reconcile deploys what drifted — while a version
// spent cannot be reclaimed by any API. So unreadable input here means "no", and
// unreadable input there means "deploy".
//
// Usage:  echo "$COMMIT_MESSAGES_JSON" | node scripts/deploy-marker.js   → true|false

'use strict';

const MARKER = '[deploy]';

// `text` is the JSON array from toJSON(github.event.commits.*.message) — one entry per
// commit in the push, so a push of several commits deploys if ANY subject opts in. It
// is "[]" for a schedule or a manual dispatch, both of which decide elsewhere.
function hasMarker(text) {
  var msgs;
  try { msgs = JSON.parse(text); } catch (e) { return false; }
  if (!Array.isArray(msgs)) return false;
  for (var i = 0; i < msgs.length; i++) {
    var subject = String(msgs[i] == null ? '' : msgs[i]).split('\n')[0];
    if (subject.indexOf(MARKER) !== -1) return true;
  }
  return false;
}

module.exports = { hasMarker: hasMarker, MARKER: MARKER };

if (require.main === module) {
  var chunks = [];
  process.stdin.on('data', function(c) { chunks.push(c); });
  process.stdin.on('end', function() {
    process.stdout.write(hasMarker(Buffer.concat(chunks).toString('utf8')) ? 'true\n' : 'false\n');
  });
}
