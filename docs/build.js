#!/usr/bin/env node
/**
 * VERA dashboard build
 * ============================================================================
 * Regenerates docs/index.html (the artifact GitHub Pages serves) from
 * docs/app.js (the file the app code is edited in).
 *
 * WHY THIS EXISTS
 *   index.html is fully self-contained: React, ReactDOM, and the whole app are
 *   inlined so the dashboard loads as a single file with no CDN dependency.
 *   app.js holds the same app code as a separate, editable file.
 *
 *   Historically the two were kept in sync by hand, which silently failed —
 *   commit 58c4245 updated app.js but not index.html, so a shipped feature
 *   never reached the live dashboard. This script makes the sync mechanical.
 *
 *   There is NO JSX/Babel step. Commit ada15e2 removed type="text/babel"
 *   because the app is authored directly in React.createElement form.
 *
 * USAGE
 *   node docs/build.js          # regenerate index.html from app.js
 *   node docs/build.js --check  # verify they match; exit 1 if not (for CI)
 * ============================================================================
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const DOCS   = __dirname;
const APP    = path.join(DOCS, 'app.js');
const INDEX  = path.join(DOCS, 'index.html');
const check  = process.argv.includes('--check');

// The app lives in the LAST <script> block, immediately before </body>.
// Anchoring on the tail avoids matching the inlined React bundle above it.
const OPEN  = '<script>';
const CLOSE = '</script>\n</body>';

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(APP))   fail('docs/app.js not found');
if (!fs.existsSync(INDEX)) fail('docs/index.html not found');

const appCode = fs.readFileSync(APP, 'utf-8');
const html    = fs.readFileSync(INDEX, 'utf-8');

const closeAt = html.lastIndexOf(CLOSE);
if (closeAt === -1) fail('could not find the closing </script></body> in index.html');

const openAt = html.lastIndexOf(OPEN, closeAt);
if (openAt === -1) fail('could not find the opening <script> for the app block');

const blockStart = openAt + OPEN.length;          // just after <script>
const current    = html.slice(blockStart, closeAt);

// app.js is written verbatim between the tags, with newlines so the tags stay
// on their own lines exactly as before.
const desired = '\n' + appCode.replace(/\n+$/, '') + '\n';

if (current === desired) {
  console.log('index.html is already in sync with app.js (' +
              appCode.length.toLocaleString() + ' bytes).');
  process.exit(0);
}

if (check) {
  console.error('index.html is OUT OF SYNC with app.js.');
  console.error('  index.html app block: ' + current.length.toLocaleString() + ' bytes');
  console.error('  docs/app.js:          ' + desired.length.toLocaleString() + ' bytes');
  console.error('Run: node docs/build.js');
  process.exit(1);
}

// A stray </script> inside the app code would terminate the block early and
// break the page, so refuse rather than emit corrupt HTML.
if (/<\/script/i.test(appCode)) {
  fail('app.js contains a literal "</script" which would close the block early. ' +
       'Split it as "<\\/script" in a string.');
}

fs.writeFileSync(INDEX, html.slice(0, blockStart) + desired + html.slice(closeAt), 'utf-8');

console.log('Rebuilt index.html from app.js.');
console.log('  app block: ' + current.length.toLocaleString() +
            ' -> ' + desired.length.toLocaleString() + ' bytes');
