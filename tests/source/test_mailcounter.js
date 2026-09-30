// Extracts the REAL parsers from MailCounter.js and runs them against four REAL
// USPS Daily Digest bodies captured from the mailbox, stripped exactly the way
// scanUSPSMail_ strips them. No hand-written fixture: the input is the actual
// HTML USPS sent.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const SRC = fs.readFileSync(ROOT + '/MailCounter.js', 'utf8');
const FIXTURES = path.join(__dirname, 'usps-fixtures');

function extractFn(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found in MailCounter.js: ' + name);
  let j = SRC.indexOf('{', i), depth = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j) + '\n';
}

const ctx = { console, String, parseInt };
vm.createContext(ctx);
vm.runInContext(extractFn('parseMailArrivingToday_'), ctx);
vm.runInContext(extractFn('parsePackagesArrivingToday_'), ctx);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// What scanUSPSMail_ does to msg.getBody() before handing it to the parsers.
const strip = html => html.replace(/<[^>]+>/g, ' ');

// date -> { mail, pkg } expected, read off the digests by hand.
const EXPECT = {
  '2026-09-11': { mail: 1, pkg: 1, headlineMail: 1 },
  '2026-09-13': { mail: 0, pkg: 0, headlineMail: 0 },
  '2026-09-15': { mail: 1, pkg: 0, headlineMail: 1 },
  '2026-09-17': { mail: 1, pkg: 0, headlineMail: 2 },  // the over-count case
};

const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.html')).sort();
check('four real digests captured as fixtures', files.length === 4, files.length + ' found');

console.log('\nper-digest parse');
for (const f of files) {
  const date = f.replace('.html', '');
  const body = strip(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
  const want = EXPECT[date];
  if (!want) { check(date + ': has an expectation', false); continue; }

  const mail = vm.runInContext('parseMailArrivingToday_', ctx)(body);
  const pkg  = vm.runInContext('parsePackagesArrivingToday_', ctx)(body);

  check(date + ': mail = ' + want.mail, mail === want.mail, 'got ' + mail);
  check(date + ': packages = ' + want.pkg, pkg === want.pkg, 'got ' + pkg);
}

// --- The change is real, not a no-op ----------------------------------------
console.log('\nthe old headline parse vs the new one');
{
  const body = strip(fs.readFileSync(path.join(FIXTURES, '2026-09-17.html'), 'utf8'));
  // The parse that used to run, verbatim from the previous MailCounter.js.
  const headline = (body.match(/(\d+)\s+mailpiece/i) || [])[1];
  check('Sep 17 headline would have counted 2', Number(headline) === 2, headline);
  check('Sep 17 now counts 1', vm.runInContext('parseMailArrivingToday_', ctx)(body) === 1);
  check('so the fix changes this digest by -1',
        Number(headline) - vm.runInContext('parseMailArrivingToday_', ctx)(body) === 1);
}

// --- The bound is load-bearing ----------------------------------------------
console.log('\nthe PACKAGES bound');
{
  // Sep 13 has NO mail bucket — only the packages one. An unbounded search
  // reads the packages number as mail. This is why the slice exists.
  const body = strip(fs.readFileSync(path.join(FIXTURES, '2026-09-13.html'), 'utf8'));
  const unbounded = (body.match(/Expected\s+Today\s+(\d+)\s+item/i) || [])[1];
  const pkgIdx = body.search(/\bPACKAGES\b/i);
  const etIdx  = body.search(/Expected\s+Today/i);

  check('Sep 13 has no MAIL-side bucket', etIdx > pkgIdx,
        'Expected Today at ' + etIdx + ', PACKAGES at ' + pkgIdx);
  check('an unbounded search would read the packages bucket', unbounded !== undefined,
        'unbounded found ' + unbounded);
  check('the bounded parser correctly returns 0',
        vm.runInContext('parseMailArrivingToday_', ctx)(body) === 0);

  // And PACKAGES is present in every digest, so the bound never degrades to
  // "search the whole body".
  let allHavePkgAnchor = true;
  for (const f of files) {
    const b = strip(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
    if (b.search(/\bPACKAGES\b/i) === -1) allHavePkgAnchor = false;
  }
  check('every digest contains a PACKAGES anchor', allHavePkgAnchor);
}

// --- Degenerate inputs -------------------------------------------------------
console.log('\ndegenerate input');
{
  const mail = vm.runInContext('parseMailArrivingToday_', ctx);
  check('empty body → 0', mail('') === 0);
  check('null body → 0', mail(null) === 0);
  check('body with no buckets → 0', mail('MAIL View Dashboard nothing here PACKAGES') === 0);
  check('"Your Mail Was Delivered" notice (no counts) → 0',
        mail('MAIL DELIVERY NOTIFICATION Your mail has been delivered today, September 17!') === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
