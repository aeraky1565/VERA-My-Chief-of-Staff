// Grounding the lounge lookup in search.
//
// tbLoungeAccess() with DCA,ORD returned three lounges and the data was wrong:
//
//   [1] Centurion Lounge Chicago O'Hare @ ORD  terminal=Terminal 1
//   [2] The Salon at O'Hare (United Polaris Lounge excluded; check current
//       PP-participating lounges) @ ORD  hours=Varies by lounge
//
// There is no Centurion Lounge at O'Hare. The second is the model hedging inside a
// proper-noun field, with a non-answer in hours. It was all pure recall — no
// database, no API, no search — and the prompt's "OMIT it entirely — do not guess"
// did nothing, so the fix is not stronger wording.
//
// The guard under test is deterministic: a lounge name must appear, normalised, in
// the search snippets retrieved FOR ITS OWN AIRPORT.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

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
function extractVar(src, name) {
  const m = new RegExp('^var ' + name + '\\s*=', 'm').exec(src);
  if (!m) throw new Error('not found: var ' + name);
  let depth = 0;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('unterminated: var ' + name);
}

const FNS  = ['loungeProgramQuery_', 'loungeAirportQuery_', 'searchLoungeCandidates_',
              'verifyLoungeProgramAtAirport_', 'loungeCorpusFor_', 'loungeNameIsGrounded_',
              'loungeDetailOrNull_', 'validateLounges_', 'emptyLoungeData_',
              'buildTravelLoungeData_'];
const VARS = ['LOUNGE_SEARCH_MAX_QUERIES_', 'LOUNGE_HEDGE_RE_', 'LOUNGE_NONANSWER_RE_'];

function ctxFor(opts) {
  opts = opts || {};
  const logs = [], searches = [], claudeCalls = [], verifyCalls = [];
  const cacheStore = {};
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: m => logs.push(String(m)) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = v; },
      }),
    },
    doWebSearch_: (q, n) => {
      searches.push(q);
      return (opts.search || (() => []))(q, n) || [];
    },
    callClaudeJson_: (prompt, fallback, o) => {
      claudeCalls.push({ prompt, opts: o });
      return ('claude' in opts) ? opts.claude : fallback;
    },
    // The pair verifier answers in one word, so it uses the raw text path rather
    // than callClaudeJson_. opts.verdict maps "PROGRAM@CODE" to the reply.
    CLAUDE_MODEL: 'm', CLAUDE_API_URL: 'u', getApiKey: () => 'k',
    fetchTracked_: (tag, url, params) => {
      const body = JSON.parse(params.payload);
      const q = String(body.messages[0].content);
      verifyCalls.push(q);
      const m = /does (.+?) operate, or give access to, a lounge at ([A-Z]{3})/.exec(q);
      const key = m ? (m[1] + '@' + m[2]) : '?';
      const word = (opts.verdict || {})[key] || 'UNKNOWN';
      return { getResponseCode: () => 200,
               getContentText: () => JSON.stringify({ content: [{ text: word }] }) };
    },
  };
  ctx.logs = logs; ctx.searches = searches; ctx.claudeCalls = claudeCalls;
  ctx.verifyCalls = verifyCalls; ctx.cacheStore = cacheStore;
  vm.createContext(ctx);
  VARS.forEach(n => new vm.Script(extractVar(TDB, n)).runInContext(ctx));
  FNS.forEach(n => new vm.Script(extractFn(TDB, n)).runInContext(ctx));
  return ctx;
}

const AIRPORTS = [{ code: 'DCA', role: 'departure' }, { code: 'ORD', role: 'layover' }];
const PERKS    = [{ program: 'Priority Pass', card: 'AMEX Platinum' },
                  { program: 'Centurion Lounge', card: 'AMEX Platinum' }];

// Snippets shaped like the real thing: DCA genuinely has a Club; ORD's results talk
// about Priority Pass in general and Centurion locations elsewhere, and crucially
// never mention a Centurion at O'Hare, because there isn't one.
const SEARCH = q => {
  if (/DCA/.test(q) && /Priority Pass/i.test(q)) {
    return [{ title: 'The Club at DCA — Priority Pass', snippet: 'The Club DCA is located in Terminal B/C, airside past security.', link: 'x' }];
  }
  if (/DCA/.test(q)) {
    return [{ title: 'Amex lounges at Reagan National', snippet: 'There is no Centurion Lounge at DCA. Amex members can use other options.', link: 'x' }];
  }
  if (/ORD/.test(q) && /Priority Pass/i.test(q)) {
    return [{ title: 'Priority Pass at Chicago O’Hare', snippet: 'Priority Pass membership includes access to select restaurants at ORD.', link: 'x' }];
  }
  return [{ title: 'The Centurion® Lounge locations', snippet: 'Centurion Lounges are in ATL, DFW, MIA, LAS, SEA and others.', link: 'x' }];
};

console.log('The reported case: the invented ORD Centurion is dropped');
{
  const c = ctxFor({
    search: SEARCH,
    claude: {
      lounges: [
        { airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA',
          terminal: 'Terminal B/C', hours: '5:00 AM – 9:00 PM', guest_limit: '2 guests included' },
        // The fabrication.
        { airport_code: 'ORD', program: 'Centurion Lounge',
          lounge_name: 'Centurion Lounge Chicago O’Hare', terminal: 'Terminal 1',
          hours: '5:00 AM – 10:00 PM' },
        // The hedged name, verbatim from the real run.
        { airport_code: 'ORD', program: 'Priority Pass',
          lounge_name: 'The Salon at O’Hare (United Polaris Lounge excluded; check current PP-participating lounges)',
          terminal: 'Terminal 5', hours: 'Varies by lounge' },
      ],
      tip: 'At ORD, the Centurion Lounge in Terminal 1 is the stronger option.',
    },
  });

  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);
  const names = d.lounges.map(l => l.lounge_name);

  check('the ORD Centurion is gone', names.indexOf('Centurion Lounge Chicago ’O’Hare') === -1 &&
        !names.some(n => /Centurion/.test(n)), JSON.stringify(names));
  check('…and the drop says why, naming both halves of the check',
        (d.dropped || []).some(x => /not in ORD’s results/.test(x) && /came back (NOT_FOUND|UNKNOWN)/.test(x)),
        JSON.stringify(d.dropped));
  check('the hedged name is gone', !names.some(n => /Salon/.test(n)), JSON.stringify(names));
  check('…rejected as a caveat, not as ungrounded',
        (d.dropped || []).some(x => /parenthetical caveat/.test(x)), JSON.stringify(d.dropped));

  check('the real DCA lounge survives', names.indexOf('The Club DCA') !== -1, JSON.stringify(names));
  check('…keeping a terminal the results stated',
        d.lounges[0].terminal === 'Terminal B/C');
  check('…and real hours', d.lounges[0].hours === '5:00 AM – 9:00 PM');

  check('exactly one lounge survives', d.lounges.length === 1, JSON.stringify(names));
  check('the tip is not kept when it describes a dropped lounge',
        !/Centurion/.test(d.tip), d.tip);
}

console.log('\n…and the tip cannot smuggle a dropped lounge back in');
{
  // The same fabrication reaching the email through a different field. The tip is
  // written against the list BEFORE validation, so it can recommend a lounge that
  // was then removed — which is exactly what the real ORD run produced.
  const c = ctxFor({
    search: SEARCH,
    claude: {
      lounges: [
        { airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA' },
        { airport_code: 'ORD', program: 'Centurion Lounge', lounge_name: 'Centurion Lounge Chicago O’Hare' },
      ],
      tip: 'At ORD, the Centurion Lounge in Terminal 1 is the stronger option.',
    },
  });
  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a lounge survived, so the section still renders', d.lounges.length === 1);
  check('…but the tip naming the dropped lounge is cleared', d.tip === '', d.tip);

  // And a clean run keeps its tip — the rule must not be "never show a tip".
  const clean = ctxFor({
    search: SEARCH,
    claude: {
      lounges: [{ airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA' }],
      tip: 'The Club DCA is airside, so clear security first.',
    },
  });
  const cd = clean.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a run that dropped nothing keeps its tip', cd.tip.length > 0, cd.tip);
}

console.log('\nGrounding is per airport, and punctuation-insensitive');
{
  const c = ctxFor();
  const cands = {
    ORD: [{ title: 'Priority Pass at O’Hare', snippet: 'Select restaurants participate.', link: '' }],
    DCA: [{ title: 'The Centurion® Lounge', snippet: 'Located at DCA Terminal A.', link: '' }],
  };

  check('a name in its own airport’s corpus is grounded',
        c.loungeNameIsGrounded_('Priority Pass', c.loungeCorpusFor_(cands, 'ORD')));
  check('…and one that is not, is not',
        !c.loungeNameIsGrounded_('Centurion Lounge', c.loungeCorpusFor_(cands, 'ORD')),
        'a DCA mention must not vouch for ORD');
  check('the registered mark and case do not cause a false drop',
        c.loungeNameIsGrounded_('Centurion Lounge', c.loungeCorpusFor_(cands, 'DCA')),
        'The Centurion® Lounge should match Centurion Lounge');
  check('an unknown airport has an empty corpus',
        c.loungeCorpusFor_(cands, 'LAX') === '');
  check('a too-short name is never grounded', !c.loungeNameIsGrounded_('at', 'atatat'));

  // The merged-corpus mistake, asserted directly.
  const merged = c.loungeCorpusFor_(cands, 'ORD') + c.loungeCorpusFor_(cands, 'DCA');
  check('merging the corpora WOULD have let it through',
        c.loungeNameIsGrounded_('Centurion Lounge', merged),
        'which is why grounding is checked per airport');
}

console.log('\n…and one airport’s results cannot vouch for another’s');
{
  // The behavioural version of the merged-corpus hazard. "The Club DCA" is a REAL
  // name that appears in the DCA snippets — so a merged corpus would ground it
  // anywhere, including at an airport where no such lounge exists. Checking per
  // airport is what stops a real name being relocated.
  const c = ctxFor({
    search: SEARCH,
    claude: {
      lounges: [
        { airport_code: 'ORD', program: 'Priority Pass', lounge_name: 'The Club DCA' },
      ],
      tip: '',
    },
  });
  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a real name from ANOTHER airport is still dropped', d.lounges.length === 0,
        JSON.stringify(d.lounges.map(l => l.lounge_name + '@' + l.airport_code)));
  check('…because it was not found in ORD’s own results, and the pair did not verify',
        (d.dropped || []).some(x => /not in ORD’s results/.test(x)),
        JSON.stringify(d.dropped));

  // …while the same name at its own airport is kept, so the check is not just
  // rejecting everything.
  const ok = ctxFor({
    search: SEARCH,
    claude: { lounges: [{ airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA' }], tip: '' },
  });
  const okd = ok.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('the same name at its own airport is kept', okd.lounges.length === 1);
}

console.log('\nThe real DCA Centurion gets back in — by verification, not by string');
{
  // The false negative from the live run. This name is REAL (Amex operates a
  // Centurion Lounge at Reagan National) but it is a description, not a string any
  // snippet contains — and a 60-char cap killed it before grounding even ran.
  const REAL_NAME = 'The Centurion Lounge at Ronald Reagan Washington National Airport';
  check('the real name is longer than the old 60-char cap', REAL_NAME.length > 60,
        String(REAL_NAME.length));

  const c = ctxFor({
    search: SEARCH,
    verdict: { 'Centurion Lounge@DCA': 'CONFIRMED' },
    claude: {
      lounges: [{ airport_code: 'DCA', program: 'Centurion Lounge', lounge_name: REAL_NAME,
                  terminal: 'Terminal A' }],
      tip: '',
    },
  });
  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('it is kept', d.lounges.length === 1, JSON.stringify(d.dropped));
  check('…admitted by verification, not verbatim',
        d.lounges.length === 1 && d.lounges[0].admittedBy === 'verified',
        d.lounges.length ? d.lounges[0].admittedBy : 'dropped');
  check('…and it is NOT verbatim in the corpus, so the pair path is what saved it',
        !c.loungeNameIsGrounded_(REAL_NAME, c.loungeCorpusFor_(
          c.searchLoungeCandidates_(AIRPORTS, PERKS), 'DCA')));

  // The same shape at ORD, where the pair does not verify, must still be dropped.
  const ord = ctxFor({
    search: SEARCH,
    verdict: { 'Centurion Lounge@ORD': 'NOT_FOUND' },
    claude: {
      lounges: [{ airport_code: 'ORD', program: 'Centurion Lounge',
                  lounge_name: 'The Centurion Lounge at Chicago O' + '\u2019' + 'Hare International Airport' }],
      tip: '',
    },
  });
  const od = ord.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('the same descriptive shape at ORD is still dropped', od.lounges.length === 0,
        JSON.stringify(od.lounges.map(l => l.lounge_name)));
  check('…with NOT_FOUND named in the reason',
        (od.dropped || []).some(x => /NOT_FOUND/.test(x)), JSON.stringify(od.dropped));

  // UNKNOWN is not a yes.
  const unk = ctxFor({
    search: SEARCH,
    verdict: { 'Centurion Lounge@DCA': 'UNKNOWN' },
    claude: { lounges: [{ airport_code: 'DCA', program: 'Centurion Lounge', lounge_name: REAL_NAME }], tip: '' },
  });
  check('UNKNOWN does not admit', unk.buildTravelLoungeData_(AIRPORTS, PERKS).lounges.length === 0);
}

console.log('\nVerbatim names cost no verification call');
{
  const c = ctxFor({
    search: SEARCH,
    verdict: { 'Priority Pass@DCA': 'CONFIRMED' },
    claude: { lounges: [{ airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA' }], tip: '' },
  });
  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('the verbatim name is kept', d.lounges.length === 1);
  check('…marked as admitted verbatim', d.lounges[0].admittedBy === 'verbatim');
  check('…and no verification call was made at all', c.verifyCalls.length === 0,
        c.verifyCalls.length + ' call(s)');

  // Verdicts cache, so a second lookup that DOES need them spends nothing extra.
  const v = ctxFor({
    search: SEARCH,
    verdict: { 'Centurion Lounge@DCA': 'CONFIRMED' },
    claude: { lounges: [{ airport_code: 'DCA', program: 'Centurion Lounge',
                          lounge_name: 'The Centurion Lounge at Ronald Reagan Washington National Airport' }], tip: '' },
  });
  v.buildTravelLoungeData_(AIRPORTS, PERKS);
  const firstCalls = v.verifyCalls.length;
  v.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('pair verdicts are cached', v.verifyCalls.length === firstCalls,
        firstCalls + ' then ' + v.verifyCalls.length);
}

console.log('\nThe queries stopped duplicating "lounge"');
{
  const c = ctxFor();
  check('a programme already containing "Lounge" is not doubled',
        c.loungeProgramQuery_('Centurion Lounge', 'DCA') === 'Centurion Lounge DCA',
        c.loungeProgramQuery_('Centurion Lounge', 'DCA'));
  check('…nor one containing "Club"',
        c.loungeProgramQuery_('Delta Sky Club', 'DCA') === 'Delta Sky Club DCA');
  check('one that does not gets the word added',
        c.loungeProgramQuery_('Priority Pass', 'DCA') === 'Priority Pass lounge DCA');
  check('the general query targets listing pages',
        c.loungeAirportQuery_('dca') === 'DCA airport lounges list');
  check('no query says "lounge lounge"',
        !/lounge lounge/i.test(c.loungeProgramQuery_('Centurion Lounge', 'DCA')),
        'the exact defect seen in the live run');
}

console.log('\nNon-answers are nulled, not printed');
{
  const c = ctxFor();
  ['Varies by lounge', 'Check the app', 'Unknown', 'N/A', 'Typically 6am-10pm', 'Depends on terminal']
    .forEach(v => check('"' + v + '" is nulled', c.loungeDetailOrNull_(v) === null));
  check('a real time range survives', c.loungeDetailOrNull_('5:00 AM – 9:00 PM') === '5:00 AM – 9:00 PM');
  check('a real guest policy survives', c.loungeDetailOrNull_('2 guests at no charge') === '2 guests at no charge');
  check('blank is null', c.loungeDetailOrNull_('') === null);
  check('undefined is null', c.loungeDetailOrNull_(undefined) === null);
}

console.log('\nThe model cannot introduce an airport or a programme');
{
  const c = ctxFor();
  const cands = { DCA: [{ title: 'The Club DCA', snippet: 'Terminal B/C', link: '' }] };
  const v = c.validateLounges_([
    { airport_code: 'LAX', program: 'Priority Pass', lounge_name: 'The Club DCA' },
    { airport_code: 'DCA', program: 'Delta Sky Club', lounge_name: 'The Club DCA' },
    { airport_code: 'DCA', program: 'Priority Pass', lounge_name: 'The Club DCA' },
    { airport_code: 'DCA', program: 'Priority Pass', lounge_name: '' },
  ], cands, [{ code: 'DCA', role: 'departure' }], [{ program: 'Priority Pass', card: 'AMEX Platinum' }]);

  check('an airport we did not ask about is dropped',
        v.dropped.some(d => /was not asked about/.test(d)), JSON.stringify(v.dropped));
  check('a programme not held is dropped',
        v.dropped.some(d => /is not held/.test(d)), JSON.stringify(v.dropped));
  check('an unnamed lounge is dropped', v.dropped.some(d => /no lounge_name/.test(d)));
  check('the legitimate one survives', v.kept.length === 1, JSON.stringify(v.kept.map(k => k.lounge_name)));
  check('…and its card comes from the perks tab, not the model',
        v.kept[0].card === 'AMEX Platinum');
}

console.log('\nNo search key means no names at all');
{
  const c = ctxFor({ search: () => [], claude: { lounges: [{ airport_code: 'ORD', program: 'Priority Pass', lounge_name: 'Anything' }], tip: 'x' } });
  const d = c.buildTravelLoungeData_(AIRPORTS, PERKS);

  check('Claude is never called without candidates', c.claudeCalls.length === 0,
        'an ungrounded call is the behaviour being removed');
  check('…and no lounge is named', d.lounges.length === 0);
  check('…the programmes held are still carried', d.programs.length === 2);
  check('…so the section renders the fallback rather than nothing', d.resolved === false);
  check('…and the log says why', c.logs.some(l => /VERA_SEARCH_API_KEY unset/.test(l)),
        c.logs.join(' | '));
}

console.log('\nSearches are bounded and cached');
{
  const c = ctxFor({ search: SEARCH, claude: { lounges: [], tip: '' } });
  c.buildTravelLoungeData_(AIRPORTS, PERKS);
  const first = c.searches.length;
  check('2 general + 4 programme queries', first === 6, String(first));
  check('…the general listing queries run first',
        /airport lounges list/.test(c.searches[0]) && /airport lounges list/.test(c.searches[1]),
        c.searches.slice(0, 3).join(' | '));

  c.buildTravelLoungeData_(AIRPORTS, PERKS);
  check('a second run adds none — cached', c.searches.length === first, String(c.searches.length));

  // The cap, with a day that would otherwise fan out.
  const many = ctxFor({ search: SEARCH, claude: { lounges: [], tip: '' } });
  const lots = ['DCA', 'ORD', 'LAX', 'JFK', 'SFO'].map(code => ({ code, role: 'layover' }));
  many.buildTravelLoungeData_(lots, PERKS);
  check('a five-airport day is capped', many.searches.length <= many.LOUNGE_SEARCH_MAX_QUERIES_,
        many.searches.length + ' > ' + many.LOUNGE_SEARCH_MAX_QUERIES_);
  check('the cap is 12', many.LOUNGE_SEARCH_MAX_QUERIES_ === 12);
}

console.log('\nThe prompt asks the model to read, not to recall');
{
  const c = ctxFor({ search: SEARCH, claude: { lounges: [], tip: '' } });
  c.buildTravelLoungeData_(AIRPORTS, PERKS);
  const prompt = c.claudeCalls[0].prompt;

  check('the search results are in the prompt', /SEARCH RESULTS, grouped by airport/.test(prompt));
  check('…with the actual snippets', /The Club at DCA/.test(prompt));
  check('it forbids prior knowledge', /Do not use prior knowledge/.test(prompt));
  check('it requires the name be copied exactly', /Copy the lounge name EXACTLY/.test(prompt));
  check('it forbids caveats in the name field', /must contain a name and nothing else/.test(prompt));
  check('it permits an empty answer', /An empty list is a perfectly good answer/.test(prompt));

  // The instruction that demonstrably did nothing is gone, so nobody trusts it.
  check('the old "be CONFIDENT / do not guess" paragraph is gone',
        !/CONFIDENT/.test(prompt) && !/do not guess/i.test(prompt),
        'leaving it implies the guard lives in the wording');
  check('the source no longer carries it either', !/OMIT it entirely/.test(TDB));
}

console.log('\nThe diagnostic shows the working');
{
  const diag = extractFn(TDB, 'diagnoseLoungeAccess_');
  check('it fetches and prints the candidates', /searchLoungeCandidates_\(airports, loungePerks\)/.test(diag));
  check('…with a per-airport count', /result\(s\)/.test(diag));
  check('it prints every drop and its reason', /DROPPED/.test(diag));
  check('it names the missing key when there are no candidates',
        /VERA_SEARCH_API_KEY is unset/.test(diag));
  check('…and it still writes nothing', !/setValue|appendRow|sendVeraEmail_|setProperty/.test(diag));
  check('the stale "do not guess" diagnosis is gone', !/being read too strictly/.test(diag));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
