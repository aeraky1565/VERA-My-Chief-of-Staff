// LOUNGE ACCESS in the travel-day email.
//
// It never rendered. Not once, on any email ever sent. An orphaned paragraph of
// buildTravelDayPlainText_ had been spliced into getLoungePerkPrograms_'s body,
// referencing narrativeData and lines — neither in scope. Every call threw
// ReferenceError, the function's own catch returned [], and the section vanished.
//
// That was gate 1 of five, and gates 2-5 logged nothing, so a skipped section was
// invisible in the execution log. These tests cover the other four:
//
//   2. a Card Perks row has to name a lounge program — airline clubs never matched
//   3. an IATA code has to be findable
//   4. Claude has to name a lounge
//   5. the reply has to fit max_tokens and parse
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const EP   = fs.readFileSync(ROOT + '/EmailParser.js', 'utf8');
const TB   = fs.readFileSync(ROOT + '/TestBench.js', 'utf8');

// Whatever a fixture names has to be findable, or grounding drops it before these
// gate tests get a chance to run.
const LOUNGE_CORPUS = 'Sunset Lounge, The Club DCA, Centurion Lounge, Priority Pass, '
                    + 'Airport Lounge, Club at IAD, Terminal A B C';

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// The real functions, brace-matched out of the source. Never a retyped copy —
// a copy passes while the shipped code stays broken.
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
// Top-level `var NAME = ...;` declarations (the pattern tables, the caveat).
function extractVar(src, name) {
  const re = new RegExp('^var ' + name + '\\s*=', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found: var ' + name);
  const start = m.index;
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unterminated: var ' + name);
}

// ---------------------------------------------------------------------------
// A context holding the real matcher, plus a sheet the tests control.
// ---------------------------------------------------------------------------
function ctxFor(opts) {
  opts = opts || {};
  const logs = [];
  const claudeCalls = [];

  function sheetOf(rows, lastCol) {
    if (rows === null) return null;
    return {
      getLastRow: () => rows.length + 1,          // +1 for the header row
      getRange: (r, c, n, w) => ({
        getValues: () => rows.slice(r - 2, r - 2 + n).map(row => {
          const out = row.slice(0, w);
          while (out.length < w) out.push('');
          return out;
        }),
      }),
    };
  }

  const TABS = { CARD_PERKS: 'Card Perks', CREDIT_CARDS: 'Credit Cards', ITINERARY: 'Itinerary' };
  const sheets = {
    'Card Perks':   sheetOf(opts.perks === undefined ? [] : opts.perks),
    'Credit Cards': sheetOf(opts.cards === undefined ? [] : opts.cards),
    'Itinerary':    sheetOf(opts.itinerary === undefined ? [] : opts.itinerary),
  };

  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    TABS,
    ITINERARY_HEADERS: new Array(10).fill('h'),
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    escapeHtml_: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    // Whole-word helper the matcher may lean on, same semantics as WebApp.js.
    itinKeywordHit_: (hay, kw) =>
      new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(String(hay)),
    callClaudeJson_: (prompt, fallback, o) => {
      claudeCalls.push({ prompt: prompt, opts: o });
      return ('claude' in opts) ? opts.claude : fallback;
    },
    // buildTravelLoungeData_ is grounded in search now, and returns before calling
    // Claude at all when nothing comes back. These tests are about gates 4 and 5,
    // so the search always yields something and the grounding corpus is permissive
    // enough to keep whatever the fixture names. Grounding itself is the subject of
    // test_loungegrounding.js.
    doWebSearch_: (q) => [{ title: 'lounge results for ' + q, snippet: LOUNGE_CORPUS, link: '' }],
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    CLAUDE_MODEL: 'm', CLAUDE_API_URL: 'u', getApiKey: () => 'k',
    fetchTracked_: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ content: [{ text: 'CONFIRMED' }] }),
    }),
  };
  ctx.logs = logs;
  ctx.claudeCalls = claudeCalls;
  vm.createContext(ctx);

  ['LOUNGE_PROGRAM_PATTERNS_', 'LOUNGE_GENERIC_WORDS_', 'LOUNGE_CAVEAT_'].forEach(n => {
    new vm.Script(extractVar(TDB, n)).runInContext(ctx);
  });
  ['LOUNGE_SEARCH_MAX_QUERIES_', 'LOUNGE_HEDGE_RE_', 'LOUNGE_NONANSWER_RE_'].forEach(n => {
    new vm.Script(extractVar(TDB, n)).runInContext(ctx);
  });
  ['loungeProgramsForPerk_', 'getLoungePerkPrograms_', 'travelDayAirports_',
   'emptyLoungeData_', 'loungeProgramQuery_', 'loungeAirportQuery_',
   'searchLoungeCandidates_', 'verifyLoungeProgramAtAirport_', 'loungeCorpusFor_',
   'loungeNameIsGrounded_', 'loungeDetailOrNull_', 'validateLounges_',
   'buildTravelLoungeData_', 'buildTravelLoungeSection_',
   'loungeFallbackHtml_', 'buildTravelDayPlainText_'].forEach(n => {
    new vm.Script(extractFn(TDB, n)).runInContext(ctx);
  });
  return ctx;
}

// Just the lounge block out of the plain-text email, so the two renderers can be
// compared on the one question that matters: does a section appear.
function plainLoungeBlock(ctx, data) {
  const txt = ctx.buildTravelDayPlainText_('T', '2026-09-27', [], null, null, data, '');
  const m = /LOUNGE ACCESS\n-+\n([\s\S]*?)\n\n/.exec(txt);
  return m ? m[1] : null;
}

console.log('Gate 2 — the matcher recognises what people actually hold');
{
  const c = ctxFor();
  const P = c.loungeProgramsForPerk_;

  check('Priority Pass',   P('Priority Pass (airport lounge access)').indexOf('Priority Pass') !== -1);
  check('Centurion',       P('Centurion Lounge access').indexOf('Centurion Lounge') !== -1);
  check('Capital One',     P('Capital One Lounge access').indexOf('Capital One Lounge') !== -1);
  // The three that were invisible: no 'lounge' substring anywhere in the name.
  check('Delta Sky Club',  P('Delta Sky Club membership').indexOf('Delta Sky Club') !== -1,
        JSON.stringify(P('Delta Sky Club membership')));
  check('United Club',     P('United Club membership').indexOf('United Club') !== -1);
  check('Admirals Club',   P('Admirals Club membership').indexOf('Admirals Club') !== -1);
  check("…and Admiral's Club with the apostrophe",
        P("Admiral's Club membership").indexOf('Admirals Club') !== -1);
  check('Escape Lounge',   P('Escape Lounge access').indexOf('Escape Lounge') !== -1);
  check('Plaza Premium',   P('Plaza Premium Lounge').indexOf('Plaza Premium Lounge') !== -1);

  // A combined perk names two programs. The old cascade stopped at the first hit
  // and reported Centurion only, so the Priority Pass half went unmentioned.
  const both = P('Priority Pass + Centurion Lounge access');
  check('a combined perk yields BOTH programs', both.length === 2, JSON.stringify(both));
  check('…Centurion among them', both.indexOf('Centurion Lounge') !== -1);
  check('…Priority Pass too',    both.indexOf('Priority Pass') !== -1);

  // The normalizer bug: 'capital one lounge' was a dead keyword (anything holding
  // it matched the earlier bare 'lounge' first), while the normalize cascade
  // tested the looser 'capital one' — so ANY lounge perk naming Capital One got
  // relabelled "Capital One Lounge".
  const cap = P('Priority Pass lounge access on the Capital One Venture X');
  check('a Capital One CARD does not rename a Priority Pass perk',
        cap.indexOf('Priority Pass') !== -1, JSON.stringify(cap));

  // 'capital one' alone is not lounge access — that card has non-lounge perks.
  check('a Capital One perk with no lounge word does not match',
        P('Capital One Lifestyle Collection Hotel Credit').length === 0,
        JSON.stringify(P('Capital One Lifestyle Collection Hotel Credit')));

  // An unlisted program still survives, under its own name.
  const odd = P('Aspire Lounge access');
  check('an unlisted lounge perk keeps its own name', odd.length === 1 && /Aspire/.test(odd[0]),
        JSON.stringify(odd));

  // And plainly non-lounge perks stay out.
  ['Global Entry / TSA PreCheck', 'Airline Fee Credit', 'Uber Cash', 'Saks Credit']
    .forEach(p => check('"' + p + '" does not match', P(p).length === 0, JSON.stringify(P(p))));
}

console.log('\nGate 2 — the sheet read, with its two deliberate leniencies intact');
{
  // Blank Active means active; an empty Credit Cards tab means do not filter.
  // Both are correct, and both are why the active filter is not a suspect.
  const blank = ctxFor({
    perks: [['CP-1', 'AMEX Platinum', 'Priority Pass (airport lounge access)', 0, 'Annual', 'Travel', '']],
    cards: [['CC-1', 'AMEX Platinum', 'Amex', '1234', 695, 5, '', 'Me', '', '']],
  });
  check('a blank Active cell counts as active', blank.getLoungePerkPrograms_().length === 1);

  const noCards = ctxFor({
    perks: [['CP-1', 'AMEX Platinum', 'Centurion Lounge access', 0, 'Annual', 'Travel', '']],
    cards: [],
  });
  check('an empty Credit Cards tab does not filter anything',
        noCards.getLoungePerkPrograms_().length === 1);

  // Needs a SECOND, active card: with the only card inactive the activeCards map
  // comes out empty, which trips the "do not filter" leniency above and lets the
  // perk through. That is the documented behaviour, not a bug — so the fixture has
  // to make the map non-empty for the exclusion to be the thing under test.
  const inactive = ctxFor({
    perks: [['CP-1', 'Old Card', 'Priority Pass lounge', 0, 'Annual', 'Travel', ''],
            ['CP-2', 'Live Card', 'Centurion Lounge access', 0, 'Annual', 'Travel', '']],
    cards: [['CC-1', 'Old Card',  'X', '1', 0, 1, '', 'Me', '', 'No'],
            ['CC-2', 'Live Card', 'X', '2', 0, 1, '', 'Me', '', 'Yes']],
  });
  const liveOnly = inactive.getLoungePerkPrograms_();
  check('an explicitly inactive card IS excluded',
        liveOnly.length === 1 && liveOnly[0].card === 'Live Card', JSON.stringify(liveOnly));

  // Two programs on one row become two entries, deduped on program|card.
  const combo = ctxFor({
    perks: [['CP-1', 'AMEX Platinum', 'Priority Pass and Centurion Lounge access', 0, 'Annual', 'Travel', ''],
            ['CP-2', 'AMEX Platinum', 'Priority Pass (duplicate row)', 0, 'Annual', 'Travel', '']],
    cards: [['CC-1', 'AMEX Platinum', 'Amex', '1', 695, 5, '', 'Me', '', 'Yes']],
  });
  const got = combo.getLoungePerkPrograms_();
  check('one row, two programs → two entries', got.length === 2, JSON.stringify(got));
  check('…and a duplicate row adds nothing',
        got.filter(p => p.program === 'Priority Pass').length === 1, JSON.stringify(got));

  const missing = ctxFor({ perks: null });
  check('a missing Card Perks tab returns [] rather than throwing',
        Array.isArray(missing.getLoungePerkPrograms_()) && missing.getLoungePerkPrograms_().length === 0);
}

console.log('\nGate 3 — the airport scan, lifted out of the IIFE unchanged');
{
  const c = ctxFor();
  const row = (type, title, loc, meta) => ['', 'k', type, title, '2026-09-27', '18:47', '21:03', loc, '', meta];

  // One flight: departure kept, arrival deliberately omitted — a lounge you reach
  // after landing is no use.
  const one = c.travelDayAirports_([row('flight', 'TPA to IAD', '', JSON.stringify({ origin: 'TPA', dest: 'IAD' }))]);
  check('a single flight yields its departure', one.length === 1 && one[0].code === 'TPA', JSON.stringify(one));
  check('…labelled departure', one[0].role === 'departure');
  check('…and the arrival is omitted', !one.some(a => a.code === 'IAD'), JSON.stringify(one));

  // Two flights: the middle airport is a layover, the final arrival still omitted.
  const two = c.travelDayAirports_([
    row('flight', 'TPA to ATL', '', JSON.stringify({ origin: 'TPA', dest: 'ATL' })),
    row('flight', 'ATL to LAX', '', JSON.stringify({ origin: 'ATL', dest: 'LAX' })),
  ]);
  check('a connection yields departure + layover', two.length === 2, JSON.stringify(two));
  check('…ATL is the layover', two.some(a => a.code === 'ATL' && a.role === 'layover'));
  check('…and the final arrival is still omitted', !two.some(a => a.code === 'LAX'));

  // The Location fallback, for rows with no metadata.
  const loc = c.travelDayAirports_([row('flight', 'Flight', 'TPA', '')]);
  check('a bare code in Location is used', loc.length === 1 && loc[0].code === 'TPA', JSON.stringify(loc));

  // Gate 3's real failure mode: the reported event. Title-only scraping found
  // nothing, and the location was a prose airport name.
  const none = c.travelDayAirports_([row('flight', 'Flight to Washington (UA 1370)', 'Tampa International Airport', '')]);
  check('no code anywhere yields no airports', none.length === 0, JSON.stringify(none));

  check('non-flight rows are ignored',
        c.travelDayAirports_([row('hotel', 'Hotel', 'IAD', '')]).length === 0);
  check('malformed metadata does not throw',
        c.travelDayAirports_([row('flight', 'F', 'TPA', '{not json')]).length === 1);
}

console.log('\nGates 4 and 5 — never an empty section when access is genuinely held');
{
  const PERKS    = [{ program: 'Priority Pass', card: 'AMEX Platinum' }];
  const AIRPORTS = [{ code: 'TPA', role: 'departure' }];

  // Gate 4: Claude replies, but names nothing it is confident about.
  const declined = ctxFor({ claude: { lounges: [], tip: '' } });
  const d4 = declined.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a declining reply carries the programs through', d4.programs.length === 1, JSON.stringify(d4));
  check('…and the airports',   d4.airports.length === 1);
  check('…and marks itself unresolved', d4.resolved === false);
  check('…and the log names gate 4', declined.logs.some(l => /gate 4/.test(l)),
        declined.logs.join(' | '));

  // Gate 5: nothing parseable came back at all — a truncated reply looks exactly
  // like this, which is why the two must be distinguishable in the log.
  const truncated = ctxFor({ claude: null });
  const d5 = truncated.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('an unparseable reply also keeps the programs', d5.programs.length === 1);
  check('…and the log names gate 5, not gate 4',
        truncated.logs.some(l => /gate 5/.test(l)) && !truncated.logs.some(l => /gate 4/.test(l)),
        truncated.logs.join(' | '));

  // The budget is raised for this call specifically.
  check('the lounge call asks for more than the 1024 default',
        truncated.claudeCalls.length === 1 && truncated.claudeCalls[0].opts &&
        Number(truncated.claudeCalls[0].opts.maxTokens) > 1024,
        JSON.stringify(truncated.claudeCalls[0] && truncated.claudeCalls[0].opts));

  // Both renderers show the fallback, and they agree that a section appears.
  const html  = declined.buildTravelLoungeSection_(d4);
  const plain = plainLoungeBlock(declined, d4);
  check('HTML renders the fallback rather than nothing', !!html && html.length > 0);
  check('…naming the program held', /Priority Pass/.test(html), html);
  check('…and the card', /AMEX Platinum/.test(html));
  check('…and today\'s airport', /TPA/.test(html));
  check('plain text renders it too', plain !== null, String(plain));
  check('…naming the same program', plain !== null && /Priority Pass/.test(plain), String(plain));
  check('the two renderers agree a section appears', (!!html) === (plain !== null));

  // No programs at all → still nothing. No bare heading over an empty block,
  // which is the bug just fixed for USEFUL TO KNOW.
  const nothing = ctxFor();
  const empty   = nothing.emptyLoungeData_();
  check('no programs → no HTML section', nothing.buildTravelLoungeSection_(empty) === '');
  check('no programs → no plain-text heading', plainLoungeBlock(nothing, empty) === null);
  check('…and no bare LOUNGE ACCESS heading anywhere in the text',
        !/LOUNGE ACCESS/.test(nothing.buildTravelDayPlainText_('T', 'd', [], null, null, empty, '')));
  check('null lounge data is still safe', nothing.buildTravelLoungeSection_(null) === '');

  // A real reply renders the real thing, and the caveat rides along.
  const real = ctxFor({ claude: {
    lounges: [{ airport_code: 'TPA', lounge_name: 'Sunset Lounge', role: 'departure',
                program: 'Priority Pass', card: 'AMEX Platinum', terminal: 'A',
                hours: '6:00 AM - 9:00 PM', guest_limit: '2 guests' }],
    tip: 'Airside past security.',
  } });
  const dOk = real.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a real reply resolves', dOk.resolved === true);
  const htmlOk  = real.buildTravelLoungeSection_(dOk);
  const plainOk = plainLoungeBlock(real, dOk);
  check('HTML names the lounge', /Sunset Lounge/.test(htmlOk));
  check('plain text names it too', plainOk !== null && /Sunset Lounge/.test(plainOk), String(plainOk));

  // The details are recalled, not measured — both renderers say so, once.
  // Assert the constant is real text first: indexOf('') is 0 for any string, so a
  // blank caveat would sail through a bare containment check.
  check('the caveat is real text', typeof real.LOUNGE_CAVEAT_ === 'string' &&
        real.LOUNGE_CAVEAT_.length > 20, JSON.stringify(real.LOUNGE_CAVEAT_));
  check('HTML carries the caveat',
        real.LOUNGE_CAVEAT_.length > 20 && htmlOk.indexOf(real.LOUNGE_CAVEAT_) !== -1);
  check('plain text carries the same caveat string',
        real.LOUNGE_CAVEAT_.length > 20 && plainOk !== null &&
        plainOk.indexOf(real.LOUNGE_CAVEAT_) !== -1, String(plainOk));
  check('…and it says the details are unverified',
        /confirm|not a live feed|from memory/i.test(real.LOUNGE_CAVEAT_), real.LOUNGE_CAVEAT_);
  check('the caveat is one shared constant, not two literals',
        /var LOUNGE_CAVEAT_\s*=/.test(TDB) &&
        (TDB.match(/LOUNGE_CAVEAT_/g) || []).length >= 3);
}

console.log('\nThe shared Claude helper stays compatible');
{
  const fn = extractFn(EP, 'callClaudeJson_');
  // Every other caller passes two arguments. The default must still be 1024, or
  // this change silently alters cost and behaviour across the whole codebase.
  check('max_tokens is no longer a hardcoded literal in the body',
        !/max_tokens:\s*1024/.test(fn), 'still hardcoded');
  check('…and 1024 remains the default when opts is omitted',
        /Number\(opts\.maxTokens\)\s*>\s*0.*?:\s*1024/s.test(fn) ||
        /:\s*1024;/.test(fn), fn.slice(0, 400));
  check('the third parameter is optional', /function callClaudeJson_\(prompt, fallback, opts\)/.test(fn));

  // Run it for real against a stubbed fetch and read the body it sends.
  function sent(opts) {
    let body = null;
    const ctx = vm.createContext({
      String, Number, Math, JSON, Error, console,
      Logger: { log: () => {} },
      CLAUDE_MODEL: 'm', CLAUDE_API_URL: 'u', getApiKey: () => 'k',
      fetchTracked_: (tag, url, params) => {
        body = JSON.parse(params.payload);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ text: '{"ok":1}' }] }) };
      },
    });
    new vm.Script(fn).runInContext(ctx);
    ctx.callClaudeJson_('p', null, opts);
    return body;
  }
  check('two-argument callers still send 1024', sent(undefined).max_tokens === 1024,
        JSON.stringify(sent(undefined)));
  check('an explicit budget is honoured', sent({ maxTokens: 3000 }).max_tokens === 3000);
  check('a nonsense budget falls back to 1024', sent({ maxTokens: -5 }).max_tokens === 1024);
  check('a non-numeric budget falls back to 1024', sent({ maxTokens: 'lots' }).max_tokens === 1024);
}

console.log('\nThe gates announce themselves, and the diagnostic exists');
{
  // The reason this survived so long: a skipped section logged nothing at all.
  const caller = TDB.slice(TDB.indexOf('function sendTravelDayBriefing_('));
  const block  = caller.slice(0, caller.indexOf('Tomorrow flight preview'));
  check('the caller logs gate 2 by name', /gate 2/.test(block), 'no gate-2 log');
  check('the caller logs gate 3 by name', /gate 3/.test(block), 'no gate-3 log');
  check('it logs the perk and airport counts before branching',
        /LOUNGE: '\s*\+\s*loungePerks\.length/.test(block), 'no count log');
  check('a throw in the lookup still keeps the programs',
        /emptyLoungeData_\(loungePerks, travelAirports\)/.test(block));

  // The scan is shared with the diagnostic, not copied into it.
  check('the IIFE is gone from the caller', !/var travelAirports = \(function\(\)/.test(TDB));
  check('…replaced by a call to the named function',
        /travelAirports = travelDayAirports_\(sortedItems\)/.test(TDB));
  const diag = extractFn(TDB, 'diagnoseLoungeAccess_');
  check('the diagnostic calls the same scan', /travelDayAirports_\(rows\)/.test(diag));
  check('…and the same matcher', /loungeProgramsForPerk_\(perkName\)/.test(diag));
  check('…and prints Claude\'s result before deciding', /resolved=/.test(diag));
  check('…and writes nothing', !/setValue|appendRow|sendVeraEmail_|setProperty/.test(diag));

  check('TestBench exposes it', /function tbLoungeAccess\(\)/.test(TB));
  check('…with an airport knob so it runs without a trip', /var TB_AIRPORTS = ''/.test(TB));
  check('…and passes both knobs through',
        /diagnoseLoungeAccess_\(TB_DATE, TB_AIRPORTS\)/.test(TB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
