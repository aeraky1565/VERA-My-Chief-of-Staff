// Renders the REAL buildChatSystemPrompt_ and checks the Important Dates block.
// Chat could not previously see these at all, so "when is X" and "don't re-add
// it" both depend on this reaching the prompt.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const CHAT = fs.readFileSync(ROOT + '/Chat.js', 'utf8');

function extractFn(name) {
  const start = CHAT.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = CHAT.indexOf('{', start); j < CHAT.length; j++) {
    if (CHAT[j] === '{') depth++;
    else if (CHAT[j] === '}') { depth--; if (depth === 0) return CHAT.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}

// Chat.js's prompt now builds from PROJECT_PLAN_GUIDANCE_, which lives in
// Projects.js. Apps Script runs every root file in ONE global scope so that is
// fine in production — but a vm context that loads only Chat.js has to be told,
// and the real constant is pulled in rather than a stand-in, so a change to it
// still flows through to these assertions.
const PLAN_GUIDANCE_SRC = (() => {
  const PROJ = fs.readFileSync(
    (process.env.VERA_ROOT || REPO) + '/Projects.js', 'utf8');
  const at = PROJ.indexOf('var PROJECT_PLAN_GUIDANCE_ =');
  if (at === -1) throw new Error('PROJECT_PLAN_GUIDANCE_ not found in Projects.js');
  return PROJ.slice(at, PROJ.indexOf(";\n", at) + 1);
})();

// Same reason as PROJECT_PLAN_GUIDANCE_ above: the CREDIT CARDS block now calls
// cardPerkPeriodKey_, which lives in Code.js. Pull in the real one so a change to
// the period rule still flows through to these assertions.
const PERIOD_KEY_SRC = (() => {
  const CODE = fs.readFileSync(
    (process.env.VERA_ROOT || REPO) + '/Code.js', 'utf8');
  const at = CODE.indexOf('function cardPerkPeriodKey_(');
  if (at === -1) throw new Error('cardPerkPeriodKey_ not found in Code.js');
  let depth = 0;
  for (let j = CODE.indexOf('{', at); j < CODE.length; j++) {
    if (CODE[j] === '{') depth++;
    else if (CODE[j] === '}') { depth--; if (depth === 0) return CODE.slice(at, j + 1); }
  }
  throw new Error('unbalanced cardPerkPeriodKey_');
})();

function prompt(importantDates, cardsData) {
  const ctx = {
    Logger: { log: () => {} },
    // Format-AWARE. cardPerkPeriodKey_ branches on 'yyyy' vs 'M', so a stub that
    // ignores the format string makes every frequency yield the same key and
    // every perk read as unused — the assertions below would pass on broken code.
    Utilities: { formatDate: (d, tz, f) => {
      const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1;
      if (f === 'yyyy')    return String(Y);
      if (f === 'M')       return String(M);
      if (f === 'yyyy-MM') return Y + '-' + String(M).padStart(2, '0');
      return d.toISOString().slice(0, 10);
    } },
    Session: { getScriptTimeZone: () => 'UTC' },
    computeProactiveInsights_: () => [],
    getConfigValues: () => ({}),
    CONFIG: { SHEET_ID: 'x', MORNING_NUDGE_EMAIL: 'a@b.c', TIMEZONE: 'UTC' },
    TABS: {}, getSpreadsheet: () => null,
    Date, Object, String, Math, parseInt, parseFloat, JSON, Array, isNaN, Number, RegExp,
  };
  vm.createContext(ctx);
  const C = { flags: [], tasks: [], projects: [], goals: [], interests: [], metrics: {},
    calendar: [], bills: [], recipes: [], homeItems: [], shoppingStores: [], ideas: [],
    travel: [], recentTrips: [], countries: [], bucketList: [], takeouts: [], pantryDue: [],
    career: {}, prescriptions: [], cardsData: cardsData || null, upcomingGuests: [], contracts: [],
    pinnedNotes: [], resources: [], mealPlan: [], summaries: [], importantDates };
  vm.runInContext(PLAN_GUIDANCE_SRC + '\n' + PERIOD_KEY_SRC + '\n' + extractFn('buildChatSystemPrompt_') + '\nOUT = buildChatSystemPrompt_(C);',
                  Object.assign(ctx, { C }));
  return ctx.OUT;
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

console.log('\nwith dates on file');
{
  let p;
  try {
    p = prompt([
      { ID:'id_1', Label:'National Wife Day', Person:'Victoria', Date:'3rd sun of sep',
        daysUntil: 366, 'Add to Calendar':'Yes' },
      { ID:'id_2', Label:"Victoria's Birthday", Person:'Victoria', Date:'04-14',
        daysUntil: 207, 'Add to Calendar':'' },
    ]);
  } catch (e) { console.log('  FAIL could not build prompt — ' + e.message); process.exit(1); }

  const sec = (p.match(/IMPORTANT DATES[\s\S]*?\n\n/) || [''])[0];
  check('the section exists', sec.length > 0, p.slice(0, 200));
  check('lists the rule row by its label', /National Wife Day/.test(sec), sec);
  check('shows a resolved horizon, not the raw rule alone', /in 366d/.test(sec), sec);
  check('still shows the stored rule for reference', /\[3rd sun of sep\]/.test(sec), sec);
  check('marks the calendar-bound one', /National Wife Day[^\n]*on the calendar/.test(sec), sec);
  check('does not mark the one that is not bound',
        !/Birthday[^\n]*on the calendar/.test(sec), sec);
  check('tells Claude not to re-add them', /do not re-add/i.test(sec), sec);
}

console.log('\nwith none on file');
{
  const p = prompt([]);
  check('says so rather than omitting the section', /IMPORTANT DATES: \(none on file\)/.test(p),
        (p.match(/IMPORTANT DATES[^\n]*/) || [''])[0]);
}

console.log('\nthe action is advertised');
{
  const p = prompt([]);
  check('add_important_date is in the action list', /ACTION:add_important_date\|/.test(p));
  check('the rule vocabulary is spelled out', /3rd sun of sep/.test(p) && /last mon of may/.test(p));
  check('the every-month form is documented', /of every month/.test(p));
  check('the offset form is documented', /easter \+50d/.test(p));
  check('it warns against converting a floating date to a fixed one',
        /NOT 09-21|silently drifts/.test(p), 'missing the drift warning');
  check('the calendar slot is explained', /shared calendar/.test(p));
}

// ---- card perks in the prompt ---------------------------------------------
// The CREDIT CARDS block feeds Claude's decision about mark_perk_used, so what
// it says has to be true for all four perk cadences — not just monthly.
const PERK_CARDS = {
  cards: [{ id: 'CC-1', cardName: 'Amex Platinum', owner: 'Ahmed', active: 'Yes' }],
  rewards: [],
  perks: [
    { id: 'CP-1', cardName: 'Amex Platinum', perk: 'Uber Cash',          amount: 15, frequency: 'Monthly',    lastUsed: '', autopay: false },
    { id: 'CP-2', cardName: 'Amex Platinum', perk: 'Airline Fee Credit', amount: 50, frequency: 'Quarterly',  lastUsed: '', autopay: false },
    { id: 'CP-3', cardName: 'Amex Platinum', perk: 'Saks Credit',        amount: 50, frequency: 'Semiannual', lastUsed: '', autopay: true  },
  ],
  programs: [], goals: [],
};

console.log('\nthe perk list is honest about cadence');
{
  const p = prompt([], PERK_CARDS);
  check('the perks are listed', /Unused perks:/.test(p), (p.match(/Unused perks[^\n]*/) || [''])[0]);
  // It used to say "this month" for every frequency, so a quarterly or
  // semiannual credit was announced as monthly — and that word reached the reply.
  check('it no longer claims they are all monthly', !/Unused perks this month/.test(p),
        (p.match(/Unused perks[^\n]*/) || [''])[0]);
  check('a non-monthly perk is labelled with its frequency', /Airline Fee Credit \(Quarterly\)/.test(p),
        (p.match(/Unused perks[^\n]*/) || [''])[0]);
  check('a monthly one is not cluttered with a label', /Uber Cash(?! \()/.test(p),
        (p.match(/Unused perks[^\n]*/) || [''])[0]);
  // Scoped to the perk LINE, not the whole prompt: the mark_perk_used guidance
  // uses "the Saks credit" as an example phrasing, so a whole-prompt match here
  // fails against perfectly correct output.
  const perkLine = (p.match(/Unused perks[^\n]*/) || [''])[0];
  check('an autopay perk is still excluded', !/Saks/.test(perkLine), perkLine);
}

console.log('\n\u2026and mark_perk_used is advertised with its guardrail');
{
  const p = prompt([], PERK_CARDS);
  check('the action is in the list', /ACTION:mark_perk_used\|/.test(p));
  check('it explains the period, not the day', /stays marked for the whole quarter/.test(p));
  check('it says to ASK when the perk is on two cards',
        /more than one card/.test(p) && /ASK which card/.test(p));
  check('\u2026and never to guess', /Never pick one for him/.test(p));
  check('autopay behaviour is spelled out', /on autopay/.test(p) && /nothing needs marking/.test(p));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
