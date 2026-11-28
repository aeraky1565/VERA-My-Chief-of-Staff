// Learning from your corrections (Learning.js, plan B1, Nov 28). Pins:
//  - a receipt line's group or season you change on save is learned for that item, and the next
//    scan starts that way; a line left as shown confirms what was learned; a save not from a scan
//    VERA remembers teaches nothing;
//  - every scanned line carries a season (learned, else guessed), so turning it into 🎄 Home picks it up;
//  - the card per store: the same card twice in a row at a store, by the same person, is the one
//    suggested there, over the best grocery rate; a different card starts the count again; a card
//    no longer theirs is never suggested;
//  - the stores stay small (most recent kept), and Forget undoes any one;
//  - wiring: both scans apply it, every save notes it, Done shopping and Log a grocery run use the
//    learned season, the panel in System › Checks lists both with Forget.
// Runs in a vm over fake Script Properties and cache. Every item, store and card is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RL = read('Learning.js'), SET = read('Settings.js'), GQ = read('GroceryRun.js'), GR = read('Groceries.js'), PAN = read('Pantry.js'), WEB = read('WebApp.js'),
  SL = read('SignalLearning.js'), HP = read('HomePurchases.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
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

function ctx(today) {
  const props = {}, cache = {};
  const c = { JSON, Object, String, Number, Math, Array, parseInt, isFinite, Logger: { log() {} }, props, cache,
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => today || '2026-11-28' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] == null ? null : cache[k], put: (k, v) => { cache[k] = v; } }) },
    veraLocked_: fn => fn() };
  vm.createContext(c);
  vm.runInContext([/var VERA_STATE_BUNDLES_ = \{[\s\S]*?\n\};/.exec(SET)[0], ...['veraStateProp_', 'veraStateNames_', 'veraStateGet_', 'veraStateSet_'].map(n => extractFn(SET, n)),
    extractFn(PAN, 'normalizeItemName_'), extractFn(HP, 'hpSeasonGuess_'), RL].join('\n'), c);
  return c;
}

console.log('Receipt lines');
{
  const c = ctx();
  const scan = () => c.rlScanLines_([{ name: 'christmas wreath', kind: 'home', food: false }, { name: 'paper towels', kind: 'supply', food: false }, { name: 'string lights', kind: 'supply', food: false }, { name: 'bananas', kind: 'grocery', food: true }]);
  let s = scan();
  check('every line carries a season: guessed from the name, else blank', s[0].season === 'Christmas' && s[2].season === '' && s.every(x => 'season' in x));
  check('nothing learned yet: the groups are as read', J(s.map(x => x.kind)) === J(['home', 'supply', 'supply', 'grocery']) && !s.some(x => x.learned));
  check('what VERA showed is remembered for the save', J(JSON.parse(c.cache.RL_GUESS || '{}')) === J({ 'christmas wreath': 'h|Christmas', 'paper towels': 's|', 'string lights': 's|', bananas: 'g|' }));
  // You save: string lights were Home · Christmas, the wreath is Home · Other, paper towels as shown.
  const changed = c.rlNoteLines_([{ name: 'string lights', kind: 'home', season: 'Christmas' }, { name: 'christmas wreath', kind: 'home', season: 'Other' }, { name: 'paper towels', kind: 'supply', food: false }]);
  check('two changes learned (group, season); the one left as shown isn’t stored', changed === 2 && J(Object.keys(c.rlItems_()).sort()) === J(['christmas wreath', 'string lights']), J(c.rlItems_()));
  s = scan();
  check('next scan: string lights start as 🎄 Home · Christmas, marked learned', s[2].kind === 'home' && s[2].season === 'Christmas' && s[2].learned === true && s[2].food === false, J(s[2]));
  check('…the wreath keeps the season you chose', s[0].season === 'Other' && s[0].learned === true);
  check('…the rest as read', s[1].kind === 'supply' && !s[1].learned && s[3].kind === 'grocery');
  c.rlNoteLines_([{ name: 'string lights', kind: 'home', season: 'Christmas' }]);
  check('saving it as shown confirms it: 2 times', c.rlParseItem_(c.rlItems_()['string lights']).times === 2);
  c.rlNoteLines_([{ name: 'string lights', kind: 'supply' }]);
  check('changing it back is learned too, the count starting again', J(c.rlParseItem_(c.rlItems_()['string lights'])) === J({ kind: 'supply', season: '', times: 1, at: '2026-11-28' }));
  const c2 = ctx();
  check('a save VERA didn’t scan teaches nothing', c2.rlNoteLines_([{ name: 'string lights', kind: 'home', season: 'Christmas' }]) === 0 && !c2.props.VERA_STATE_LEARN_ITEMS);
  check('the receipt’s matched name is the key when there is one', c.rlApply_([{ name: 'ks lights 100ct', match: 'string lights', kind: 'home' }], { 'string lights': 'h|Christmas|1|2026-11-28' })[0].season === 'Christmas');
  const big = {}; for (let i = 0; i < 150; i++) big['item ' + i] = 'h||1|2026-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0');
  c.rlItemsSave_(big);
  const kept = c.rlItems_();
  check('at most 120 items, the most recent kept, well under 9 KB', Object.keys(kept).length === 120 && c.props.VERA_STATE_LEARN_ITEMS.length < 8000, c.props.VERA_STATE_LEARN_ITEMS.length);
}

console.log('\nThe card per store');
{
  const c = ctx();
  c.rlNoteCard_('Costco', 'Ahmed', 'Costco Visa');
  check('once is not a habit: nothing suggested', c.rlCardFor_(c.rlCards_(), 'Costco', 'Ahmed', ['Costco Visa', 'Amex Gold']) === null);
  c.rlNoteCard_('costco ', 'Ahmed', 'Costco Visa');
  const s = c.rlCardFor_(c.rlCards_(), 'Costco', 'Ahmed', ['Costco Visa', 'Amex Gold']);
  check('twice in a row (any spelling of the store): suggested, and says why', s && s.card === 'Costco Visa' && s.learned && s.why === 'what you used at costco the last 2 times', J(s));
  check('…only for that person', c.rlCardFor_(c.rlCards_(), 'Costco', 'Victoria', ['Costco Visa']) === null);
  check('…never a card that is no longer theirs', c.rlCardFor_(c.rlCards_(), 'Costco', 'Ahmed', ['Amex Gold']) === null);
  c.rlNoteCard_('Costco', 'Ahmed', 'Amex Gold');
  check('a different card starts the count again', c.rlCardFor_(c.rlCards_(), 'Costco', 'Ahmed', ['Costco Visa', 'Amex Gold']) === null);
  c.rlNoteCard_('Costco', 'Ahmed', '');
  check('a run not on a card changes nothing', c.rlCards_()['costco|Ahmed'].split('|')[0] === 'Amex Gold');
}

console.log('\nWhat VERA learned, and Forget');
{
  const c = ctx();
  c.rlItemsSave_({ 'string lights': 'h|Christmas|2|2026-11-28', 'oat milk': 'g||1|2026-11-20' });
  c.rlNoteCard_('Costco', 'Ahmed', 'Costco Visa'); c.rlNoteCard_('Costco', 'Ahmed', 'Costco Visa'); c.rlNoteCard_('Target', 'Ahmed', 'Red Card');
  const l = c.rlLearnedLists_(c.rlItems_(), c.rlCards_());
  check('items, newest first, with group, season and times', J(l.items.map(x => [x.name, x.kind, x.season, x.times])) === J([['string lights', 'home', 'Christmas', 2], ['oat milk', 'grocery', '', 1]]));
  check('cards only where they are in force', J(l.cards.map(x => [x.store, x.who, x.card, x.times])) === J([['Costco', 'Ahmed', 'Costco Visa', 2]]), J(l.cards));
  check('Forget an item', c.webLearnForget_({ parameter: { type: 'item', key: 'string lights' } }).ok && !c.rlItems_()['string lights']);
  check('Forget a card', c.webLearnForget_({ parameter: { type: 'card', key: 'costco|Ahmed' } }).ok && !c.rlCards_()['costco|Ahmed']);
  check('…one it doesn’t know says so', c.webLearnForget_({ parameter: { type: 'item', key: 'nope' } }).ok === false && c.webLearnForget_({ parameter: { type: 'x', key: 'k' } }).ok === false);
}

console.log('\nWiring');
check('its own Script Properties bundles', /LEARN_ITEMS:\s+\['LEARN_ITEMS'\]/.test(SET) && /LEARN_CARDS:\s+\['LEARN_CARDS'\]/.test(SET));
check('both scans apply it: Log a grocery run and Done shopping', /if \(typeof rlScanLines_ === 'function'\) lines = rlScanLines_\(lines\);/.test(extractFn(GQ, 'gqClean_')) && /rlScanLines_\(lines\)/.test(extractFn(PAN, 'readReceipt_')));
check('…and the scan sends each line’s season', /season: l\.season \|\| '', learned: !!l\.learned/.test(extractFn(GQ, 'gqClean_')));
check('every save notes what changed: pantry lines, Done shopping, Home lines', /rlNoteLines_\(items\)/.test(extractFn(GQ, 'webGqLog_')) && /rlNoteLines_\(b\.items/.test(extractFn(WEB, 'webReceiptLog_')) && /rlNoteLines_\(homeLines\.map/.test(extractFn(GR, 'webGroceryLog_')));
check('a saved run notes its card', /rlNoteCard_\(x\.store, x\.who, x\.card\)/.test(extractFn(GR, 'webGroceryLog_')));
check('the setup suggests the learned card first', /suggested: used \|\| grBestCard_\(/.test(extractFn(GR, 'webGrocerySetup_')));
check('the route and the panel data', /case 'learn_forget':\s*return jsonOut_\(webLearnForget_\(e\)\)/.test(WEB) && /out\.receipts = rl\.items; out\.cards = rl\.cards;/.test(extractFn(SL, 'webSignalLearned_')));
const blk = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); return i === -1 || j === -1 ? '' : s.slice(i, j); };
const GRB = blk(APP, '// ---- GroceryRun (Log a grocery run', '// ---- /GroceryRun ----'), SHB = blk(APP, '// ---- ShopList (Shopping tab)', '// ---- /ShopList ----');
check('the screens take the learned season: both dashboards', /function rcSeasonFor_\(x\)\{return x&&x\.season\?String\(x\.season\):rcSeasonGuess_/.test(GRB) && GRB === blk(LITE, '// ---- GroceryRun (Log a grocery run', '// ---- /GroceryRun ----') && SHB === blk(LITE, '// ---- ShopList (Shopping tab)', '// ---- /ShopList ----'));
check('…on reading and on turning a line into 🎄 Home', (GRB.match(/rcSeasonFor_\(x\)/g) || []).length === 3 && (SHB.match(/rcSeasonFor_\(x\)/g) || []).length === 2 && !/rcSeasonGuess_\(x\.name\)|[^ ]rcSeasonGuess_\(name\)/.test(GRB + SHB));

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the panel: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const LEARNED = { ok: true, patterns: 12, quiet: [], kept: [], engaged: [], newThisWeek: [],
    receipts: [{ key: 'string lights', name: 'string lights', kind: 'home', season: 'Christmas', times: 2, at: '2026-11-28' }, { key: 'oat milk', name: 'oat milk', kind: 'grocery', season: '', times: 1, at: '2026-11-20' }],
    cards: [{ key: 'costco|Ahmed', store: 'Costco', who: 'Ahmed', card: 'Costco Visa', times: 3, at: '2026-11-28' }] };
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(PAGES, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(learned => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'signal_learned') return Promise.resolve(JSON.parse(JSON.stringify(learned)));
        if (p.action === 'signal_regroup') return Promise.resolve({ ok: true, dry: true, before: 12, after: 12, merges: [] }); return Promise.resolve({ ok: true }); };
      document.querySelectorAll('.modal-overlay').forEach(n => n.remove()); const root = document.getElementById('root'); if (root) root.style.display = 'none';
      const d = document.createElement('div'); d.id = 'sl'; d.style.padding = '0 16px'; document.body.appendChild(d);
      ReactDOM.createRoot(d).render(React.createElement(SysLearned, { apiUrl: 'u', apiToken: 't' }));
    }, LEARNED);
    await page.waitForTimeout(400);
    const t = await page.$eval('#sl', n => n.innerText).catch(() => '');
    check('From your receipts: each item with its group, season and times', /From your receipts · 2/i.test(t) && /string lights/.test(t) && /🎄 Home · Christmas · 2 times/.test(t) && /🥕 Grocery · 1 time\b/.test(t), t);
    check('Cards by store: store, who, card, how many times', /Cards by store · 1/i.test(t) && /Costco · Ahmed/.test(t) && /Costco Visa, the last 3 times/.test(t), t);
    await page.click('#sl .sl-item[data-key="string lights"] .sl-forget'); await page.waitForTimeout(80);
    await page.click('#sl .sl-card .sl-forget'); await page.waitForTimeout(80);
    const sent = (await page.evaluate(() => window.__ev)).filter(e => e.action === 'learn_forget').map(e => e.type + ':' + e.key);
    check('Forget sends learn_forget for that one', J(sent) === J(['item:string lights', 'card:costco|Ahmed']), J(sent));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
