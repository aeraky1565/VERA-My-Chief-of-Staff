// Drives the REAL executeActions_ from Chat.js with the ACTION lines Claude
// would emit, against stubbed web endpoints. The validation gate is the point:
// a rule Claude gets wrong must be refused, not written as a row that looks
// saved but never resolves.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const CHAT = fs.readFileSync(ROOT + '/Chat.js', 'utf8');
const IDS  = fs.readFileSync(ROOT + '/ImportantDates.js', 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const varSrc = n => IDS.match(new RegExp('^var ' + n + ' = [\\s\\S]*?^\\};?$', 'm'))[0];

function run(actionText, existing) {
  const calls = { added: [], updated: [] };
  const ctx = {
    Logger: { log: () => {} },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    webGetImportantDates_: () => ({ ok: true, dates: existing || [] }),
    webAddImportantDate_:    e => { calls.added.push(e.parameter); return { ok: true }; },
    webUpdateImportantDate_: e => { calls.updated.push(e.parameter); return { ok: true }; },
    Date, Object, String, Math, parseInt, parseFloat, JSON, Array, RegExp, isNaN,
  };
  vm.createContext(ctx);
  // Only the pieces this action path touches; every other handler is unreachable
  // for these inputs, so a full Chat.js load would add nothing but noise.
  vm.runInContext(
    ['WEEKDAY_NAMES_','MONTH_NAMES_','ORDINAL_WORDS_'].map(varSrc).join('\n') + '\n' +
    extractFn(IDS, 'parseDateRule_') + '\n' +
    extractFn(CHAT, 'executeActions_') + '\n' +
    'RESULT = executeActions_(TEXT);', Object.assign(ctx, { TEXT: actionText }));
  return { res: ctx.RESULT, calls };
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

console.log('\nsaving a floating date from chat');
{
  const { res, calls } = run(
    "Saved that for you.\nACTION:add_important_date|National Wife Day|3rd sun of sep|Victoria|yes|", []);
  check('one row added', calls.added.length === 1, JSON.stringify(calls.added));
  check('the rule is stored verbatim', calls.added[0] && calls.added[0].date === '3rd sun of sep',
        calls.added[0] && calls.added[0].date);
  check('label and person carried', calls.added[0] && calls.added[0].label === 'National Wife Day' &&
        calls.added[0].person === 'Victoria', JSON.stringify(calls.added[0]));
  check('calendar opt-in becomes Yes', calls.added[0] && calls.added[0].addToCalendar === 'Yes',
        calls.added[0] && calls.added[0].addToCalendar);
  check('reported as executed', res.executed.some(x => /add_important_date/.test(x)), JSON.stringify(res.executed));
  check('no errors', res.errors.length === 0, JSON.stringify(res.errors));
}

console.log('\nevery rule shape Claude is told about');
{
  const shapes = ['04-14', '2027-06-08', '3rd sun of sep', 'last mon of may',
                  '1st fri of every month', 'thanksgiving -6d', 'easter +50d',
                  'third sunday of september'];
  shapes.forEach(sh => {
    const { res, calls } = run('ACTION:add_important_date|X|' + sh + '|||', []);
    check('accepts "' + sh + '"', calls.added.length === 1 && res.errors.length === 0,
          JSON.stringify(res.errors));
  });
}

console.log('\na rule Claude gets wrong is refused, not written');
{
  const bad = ['every third sunday in september', 'the 3rd sunday', 'sometime in September',
               'Sept 21st', '3rd sun of septembre', '9/21'];
  bad.forEach(b => {
    const { res, calls } = run('ACTION:add_important_date|X|' + b + '|||', []);
    check('refuses "' + b + '"', calls.added.length === 0 && res.errors.length === 1,
          JSON.stringify(res.errors) + ' / added=' + calls.added.length);
  });
  const { res } = run('ACTION:add_important_date|X|nonsense|||', []);
  check('the error names the accepted forms', /3rd sun of sep/.test(res.errors[0]), res.errors[0]);
}

console.log('\nmissing pieces');
{
  let r = run('ACTION:add_important_date|||||', []);
  check('a blank label is refused', r.calls.added.length === 0 && r.res.errors.length === 1,
        JSON.stringify(r.res.errors));
  r = run('ACTION:add_important_date|Just a label|||', []);
  check('a label with no date is refused', r.calls.added.length === 0 && r.res.errors.length === 1,
        JSON.stringify(r.res.errors));
  check('…and says both are required', /label and a date/.test(r.res.errors[0]), r.res.errors[0]);
}

console.log('\nsaying it twice does not duplicate');
{
  const existing = [{ ID: 'id_1', Label: 'National Wife Day', Person: 'Victoria', Date: '09-21', Notes: 'old' }];
  const { res, calls } = run(
    'ACTION:add_important_date|National Wife Day|3rd sun of sep|Victoria|yes|', existing);
  check('no second row is added', calls.added.length === 0, JSON.stringify(calls.added));
  check('the existing row is updated instead', calls.updated.length === 1, JSON.stringify(calls.updated));
  check('…by its ID', calls.updated[0] && calls.updated[0].id === 'id_1', JSON.stringify(calls.updated[0]));
  check('…correcting the fixed date to the rule', calls.updated[0] && calls.updated[0].date === '3rd sun of sep',
        calls.updated[0] && calls.updated[0].date);
  check('the reply says it updated rather than added', res.executed.some(x => /updated/.test(x)),
        JSON.stringify(res.executed));

  const cased = run('ACTION:add_important_date|national WIFE day|3rd sun of sep|||', existing);
  check('label matching ignores case', cased.calls.updated.length === 1 && cased.calls.added.length === 0);

  const other = run('ACTION:add_important_date|Something Else|3rd sun of sep|||', existing);
  check('a different label still adds', other.calls.added.length === 1 && other.calls.updated.length === 0);
}

console.log('\nthe calendar flag');
{
  const cases = [['yes','Yes'], ['Yes','Yes'], ['true','Yes'], ['calendar','Yes'],
                 ['no',''], ['','' ], ['maybe','']];
  cases.forEach(([given, want]) => {
    const { calls } = run('ACTION:add_important_date|X|04-14||' + given + '|', []);
    check('"' + given + '" → ' + (want || '(off)'),
          calls.added[0] && calls.added[0].addToCalendar === want,
          calls.added[0] && JSON.stringify(calls.added[0].addToCalendar));
  });
}

console.log('\nsurrounding prose and formatting are tolerated');
{
  const { res, calls } = run(
    "Got it — I'll remember that.\n\n`ACTION:add_important_date|Friendsgiving|thanksgiving -6d|Both|yes|potluck`\n\nAnything else?",
    []);
  check('a backticked line still runs', calls.added.length === 1, JSON.stringify(res.errors));
  check('notes survive', calls.added[0] && calls.added[0].notes === 'potluck', JSON.stringify(calls.added[0]));
  check('an offset rule survives the pipe split',
        calls.added[0] && calls.added[0].date === 'thanksgiving -6d', calls.added[0] && calls.added[0].date);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
