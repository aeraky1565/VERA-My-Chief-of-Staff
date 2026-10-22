// The family Christmas lists, read by STRUCTURE (WishLists.js).
//
// The old reader took getParagraphs(), which returns every table cell as its own
// paragraph across every year: the dashboard showed a pile of words. These tests run
// the real file in a vm against invented docs laid out like the real ones — a year
// banner, a Wishlist with struck items, a gift table with ticked checklist boxes and
// blank template rows, and an old-format year with Cost, "Purchased - X" and a Total.
// Invented names and items only.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WL = read('WishLists.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), README = read('README.md');
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ---- a fake DocumentApp body ------------------------------------------------
const T = { PARAGRAPH: 'P', LIST_ITEM: 'L', TABLE: 'T' };
const ATTR = { STRIKETHROUGH: 'STRIKE' };
function textEl(type, text, struck) {
  return {
    getType: () => type, getText: () => text,
    getAttributes: () => ({ STRIKE: struck ? true : null }),
    editAsText: () => ({ getText: () => text, isStrikethrough: () => (struck ? true : false) }),
  };
}
const P = (t, s) => textEl(T.PARAGRAPH, t, s);
const L = (t, s) => textEl(T.LIST_ITEM, t, s);
// A cell holding plain text, or a checklist box (ticked = its list item is struck).
const cell = c => {
  const kids = typeof c === 'string' ? [P(c)] : [L('', c.ticked)];
  return { getText: () => (typeof c === 'string' ? c : ''), getNumChildren: () => kids.length, getChild: k => kids[k] };
};
function TBL(rows) {
  return {
    getType: () => T.TABLE,
    asTable: () => ({
      getNumRows: () => rows.length,
      getRow: r => ({ getNumCells: () => rows[r].length, getCell: c => cell(rows[r][c]) }),
    }),
  };
}
const body = kids => ({ getNumChildren: () => kids.length, getChild: i => kids[i] });
const BOX = t => ({ ticked: !!t });

// Laid out like the real docs: title, then years newest first.
const DOC = body([
  P('Robin’s Christmas List'),
  TBL([['2026']]),
  P('Wishlist'),
  L(''),
  TBL([['Item', 'Purchaser', 'Purchased', 'Wrapped'], ['', '', BOX(1), BOX(1)], ['', '', BOX(0), BOX(0)]]),
  TBL([['2025']]),
  P(''),
  P('Wishlist'),
  L('Yoga Matt', true),
  L('Hiking Socks'),
  L('Ceramic Teapot'),
  P(''),
  TBL([
    ['Item', 'Purchaser', 'Purchased', 'Wrapped'],
    ['Yoga Mat', 'VV', BOX(1), BOX(0)],
    ['Hiking Socks', 'Stocking AE', BOX(0), BOX(0)],
    ['Board Game', 'VV/AE', BOX(1), BOX(1)],
    ['Candle', 'QX', BOX(0), BOX(0)],
    ['Scarf', 'Jordan', BOX(1), BOX(0)],
    ['', '', BOX(0), BOX(0)],
    ['', '', '', ''],
  ]),
  P('2019'),
  TBL([
    ['Item', 'Cost', 'Who is purchasing'],
    ['Teapot', '$30', 'Purchased - Vic'],
    ['Slippers', '$20', 'VV-wrapped'],
    ['Book', '$15', ''],
    ['Total', '$65', ''],
  ]),
  P('Ideas for next year'),
  L('Pottery class'),
  L('Plant stand'),
  P('Someone added a link here https://example.com/x'),
]);

function sandbox(over) {
  const S = Object.assign({
    DocumentApp: { ElementType: T, Attribute: ATTR, openById: () => ({ getBody: () => DOC }) },
    Logger: { log() {} }, JSON, Math, Date,
    getConfigValues: () => ({ wishlist_robin: 'DOC1', gift_initials_AE: 'Ahmed', gift_initials_VV: 'Victoria' }),
  }, over || {});
  vm.createContext(S);
  vm.runInContext(WL, S);
  return S;
}

// ============ blocks =========================================================
console.log('wishDocBlocks_: the doc as blocks, tables kept whole');
const S = sandbox();
S.doc = DOC;
const blocks = vm.runInContext('wishDocBlocks_(doc)', S);
check('a table stays ONE block, not a paragraph per cell (the old pile of words)',
      blocks.filter(b => b.t === 'table').length === 5 && blocks.every(b => b.t === 'table' || typeof b.text === 'string'));
const gt = blocks.find(b => b.t === 'table' && b.rows.length > 3 && b.rows[1][0].text === 'Yoga Mat');
check('a ticked checklist box reads as struck', gt.rows[1][2].struck === true && gt.rows[1][3].struck === false, JSON.stringify(gt.rows[1]));
const wish = t => blocks.find(b => b.t === 'p' && b.text === t);
check('a struck wish reads as struck', wish('Yoga Matt').struck === true && wish('Hiking Socks').struck === false);

// ============ parse ==========================================================
console.log('\nparseWishDoc_: years, wishes, gifts, ideas');
S.blocks = blocks;
const doc = vm.runInContext('parseWishDoc_(blocks)', S);
check('every year found: 2026 (table banner), 2025, 2019 (paragraph banner)', Object.keys(doc.years).sort().join(',') === '2019,2025,2026', Object.keys(doc.years).join(','));
check('the title before the first year is ignored', !JSON.stringify(doc).includes('Robin’s Christmas List'));
const y25 = doc.years[2025];
check('the wishlist, with what’s taken care of', JSON.stringify(y25.wishlist) === JSON.stringify([
  { text: 'Yoga Matt', done: true }, { text: 'Hiking Socks', done: false }, { text: 'Ceramic Teapot', done: false }]), JSON.stringify(y25.wishlist));
check('the gift table: blank template rows dropped', y25.gifts.length === 5, y25.gifts.map(g => g.item).join(','));
check('…ticked boxes read', y25.gifts[0].purchased && !y25.gifts[0].wrapped && y25.gifts[2].purchased && y25.gifts[2].wrapped && !y25.gifts[1].purchased);
check('2026 is only template: nothing in it', doc.years[2026].gifts.length === 0 && doc.years[2026].wishlist.length === 0, JSON.stringify(doc.years[2026]));
const y19 = doc.years[2019];
check('old format: "Purchased - Vic" is purchased, by Vic', y19.gifts[0].purchased && y19.gifts[0].purchaserRaw === 'Vic', JSON.stringify(y19.gifts[0]));
check('…"VV-wrapped" is purchased AND wrapped, by VV', y19.gifts[1].purchased && y19.gifts[1].wrapped && y19.gifts[1].purchaserRaw === 'VV', JSON.stringify(y19.gifts[1]));
check('…a blank one is neither', !y19.gifts[2].purchased && !y19.gifts[2].wrapped);
check('…and the Total row is not a gift', !y19.gifts.some(g => /total/i.test(g.item)));
check('ideas for next year, and nothing after them', JSON.stringify(y19.ideas) === '["Pottery class","Plant stand"]', JSON.stringify(y19.ideas));

console.log('\ncolumns are read by label, never by position');
{
  S.moved = [{ t: 'table', rows: [['2025'].map(t => ({ text: t }))] },
             { t: 'table', rows: [['Wrapped', 'Purchased', 'Item', 'Purchaser'].map(t => ({ text: t })),
                                  [{ text: '', struck: true }, { text: '', struck: false }, { text: 'Lamp' }, { text: 'AE' }]] }];
  const g = vm.runInContext('parseWishDoc_(moved)', S).years[2025].gifts[0] || {};
  check('reordered columns: Lamp, by AE, wrapped but not purchased', g.item === 'Lamp' && g.purchaserRaw === 'AE' && g.wrapped && !g.purchased, JSON.stringify(g));
  S.headerless = [{ t: 'table', rows: [[{ text: '2025' }]] }, { t: 'table', rows: [[{ text: 'Notes' }], [{ text: 'call mum' }]] }];
  check('a table with no Item column is not a gift table', vm.runInContext('parseWishDoc_(headerless)', S).years[2025].gifts.length === 0);
}

// ============ purchasers =====================================================
console.log('\nwho is buying: initials through Config');
{
  S.cfg = { gift_initials_AE: 'Ahmed', GIFT_INITIALS_vv: 'Victoria', gift_initials_JD: '' };
  const map = vm.runInContext('wishInitialsMap_(cfg)', S);
  check('Config initials, any case; a blank row maps nothing', JSON.stringify(map) === '{"AE":"Ahmed","VV":"Victoria"}', JSON.stringify(map));
  S.map = map;
  const p = raw => { S.raw = raw; return vm.runInContext('wishPurchasers_(raw, map)', S); };
  check('"Stocking VV" → Victoria, a stocking, ours', JSON.stringify(p('Stocking VV')) === JSON.stringify({ names: ['Victoria'], stocking: true, ours: true, unmapped: [] }), JSON.stringify(p('Stocking VV')));
  check('"VV/AE" → both', p('VV/AE').names.join(',') === 'Victoria,Ahmed');
  check('"cv&kv" → unmapped initials kept as written, and reported', p('cv&kv').names.join(',') === 'cv,kv' && p('cv&kv').unmapped.join(',') === 'CV,KV' && !p('cv&kv').ours);
  check('names are names, not initials: "Ange and Vic", "Mom"', p('Ange and Vic').names.join(',') === 'Ange,Vic' && p('Ange and Vic').unmapped.length === 0 && p('Mom').unmapped.length === 0);
  check('"CV on behalf of Alex" → CV and Alex', p('CV on behalf of Alex').names.join(',') === 'CV,Alex');
}

// ============ claims =========================================================
console.log('\nwishes nobody has claimed');
{
  S.sec = { wishlist: [{ text: 'Yoga Matt', done: false }, { text: 'Hiking Socks', done: false }, { text: 'Ceramic Teapot', done: false }, { text: 'Earrings', done: true }],
            gifts: [{ item: 'Yoga Mat' }, { item: 'Wool hiking socks' }], ideas: [] };
  const w = vm.runInContext('wishMarkClaims_(sec)', S).wishlist;
  check('"Yoga Matt" is claimed by "Yoga Mat"', w[0].claimed === true);
  check('"Hiking Socks" by "Wool hiking socks"', w[1].claimed === true);
  check('"Ceramic Teapot" is NOT claimed', w[2].claimed === false);
  check('a struck wish counts as taken care of', w[3].claimed === true);
}

// ============ the year ======================================================
console.log('\nthe year VERA opens on');
{
  const up = iso => vm.runInContext('upcomingChristmasYear_(new Date(' + JSON.stringify(iso + 'T12:00:00') + '))', S);
  check('October 2026 → 2026', up('2026-10-18') === 2026);
  check('Dec 26–31 still → that Christmas (returns, wrapping up)', up('2026-12-28') === 2026);
  check('Jan 1 rolls over → 2027', up('2027-01-01') === 2027);
}

// ============ the endpoint ==================================================
console.log('\nget_wish_lists');
{
  // A clock fixed at `iso`; dates built from an argument behave normally.
  const at = iso => class extends Date { constructor(...a) { a.length ? super(...a) : super(iso); } };
  const r = vm.runInContext('webGetFamilyWishLists_()', sandbox({ Date: at('2025-10-18T12:00:00') }));
  const robin = r.people[0];
  check('one person, every year, newest first', robin.person === 'Robin' && robin.years.join(',') === '2026,2025,2019', JSON.stringify(robin.years));
  check('opens on the upcoming year (2025 here)', r.upcomingYear === 2025 && robin.notStarted === false);
  const g = robin.sections[2025].gifts;
  check('each gift says who is buying, by name', JSON.stringify(g[0].names) === '["Victoria"]' && g[1].stocking && g[1].ours && JSON.stringify(g[4].names) === '["Jordan"]' && !g[4].ours, JSON.stringify(g.map(x => x.names)));
  check('unmapped initials are listed for the setup note', JSON.stringify(r.unmappedInitials) === '["QX"]', JSON.stringify(r.unmappedInitials));
  check('the unclaimed wish is marked', robin.sections[2025].wishlist.filter(w => !w.claimed).map(w => w.text).join() === 'Ceramic Teapot');
  const r26 = vm.runInContext('webGetFamilyWishLists_()', sandbox({ Date: at('2026-10-18T12:00:00') }));
  check('2026 is only a template → "not started"', r26.upcomingYear === 2026 && r26.people[0].notStarted === true);
  const S3 = sandbox({ getConfigValues: () => ({}) });
  check('no wishlist_* rows → says how to add them', /No wishlist_\* keys/.test(vm.runInContext('webGetFamilyWishLists_()', S3).note));
  const S4 = sandbox({ DocumentApp: { ElementType: T, Attribute: ATTR, openById: () => { throw new Error('no access'); } } });
  const bad = vm.runInContext('webGetFamilyWishLists_()', S4).people[0];
  check('a doc that won’t open says so, per person', /Couldn’t open the doc: no access/.test(bad.error) && bad.notStarted);
}

// ============ whose list is hidden ==========================================
console.log('\nviewer: you never see the list you are being gifted from');
{
  const cfg = { wishlist_ahmed: 'DOC_A', wishlist_victoria: 'DOC_V', wishlist_victoria_mom: 'DOC_M',
                gift_initials_AE: 'Ahmed', gift_initials_VV: 'Victoria' };
  const run = (viewer, over) => {
    const opened = [];
    const S9 = sandbox(Object.assign({
      getConfigValues: () => cfg,
      DocumentApp: { ElementType: T, Attribute: ATTR, openById: id => { opened.push(id); return { getBody: () => DOC }; } },
    }, over || {}));
    S9.e = viewer === undefined ? undefined : { parameter: { viewer } };
    const r = vm.runInContext('webGetFamilyWishLists_(e)', S9);
    return { r, opened, names: r.people.map(p => p.person) };
  };
  const all = run(undefined);
  check('no viewer (the nightly flag check): every list comes back', all.names.join() === 'Ahmed,Victoria,Victoria Mom', all.names.join());
  const asAhmed = run('ahmed');
  check('Ahmed’s dashboard: not Ahmed’s list, but Victoria’s and her family’s',
        asAhmed.names.join() === 'Victoria,Victoria Mom', asAhmed.names.join());
  const asVic = run('victoria');
  check('Victoria’s dashboard: not hers, but Ahmed’s — and "victoria" never hides "Victoria Mom"',
        asVic.names.join() === 'Ahmed,Victoria Mom', asVic.names.join());
  check('the viewer is case- and space-insensitive', run('  Victoria ').names.join() === 'Ahmed,Victoria Mom');
  check('the hidden doc is never even opened (nothing about it leaves the server)',
        asAhmed.opened.indexOf('DOC_A') === -1 && asVic.opened.indexOf('DOC_V') === -1 && asAhmed.opened.length === 2, asAhmed.opened.join());
  const withUnmapped = run('ahmed', { getConfigValues: () => ({ wishlist_ahmed: 'DOC_A' }) });
  check('hiding the only list leaves people empty, not the "add a key" note',
        withUnmapped.names.length === 0 && !withUnmapped.r.note && withUnmapped.r.ok === true);
  check('an unknown viewer hides nothing', run('someone').names.length === 3);
  const doorway = vm.runInContext('wishEntriesForViewer_([{person:"Ahmed"},{person:"Victoria"}], "")', sandbox()).length;
  check('an empty viewer hides nothing', doorway === 2);
}

// ============ flags ==========================================================
console.log('\nflags: our unbought gifts, Dec 1–25');
{
  S.people = [{ person: 'Robin', sections: { 2026: { gifts: [
    { item: 'Yoga Mat', names: ['Victoria'], ours: true, purchased: false, wrapped: false },
    { item: 'Board Game', names: ['Victoria', 'Ahmed'], ours: true, purchased: true, wrapped: false },
    { item: 'Board Game Two', names: ['Victoria'], ours: true, purchased: true, wrapped: true },
    { item: 'Scarf', names: ['Jordan'], ours: false, purchased: false, wrapped: false },
  ] } } }];
  const due = iso => { S.when = iso; return vm.runInContext('wishGiftFlagsDue_(people, new Date(when + "T12:00:00"))', S); };
  check('Nov 30: nothing', due('2026-11-30').length === 0);
  const d1 = due('2026-12-01');
  check('Dec 1: only ours, only unbought', d1.length === 1 && d1[0].flag === 'Not bought yet: Yoga Mat for Robin (Victoria).', JSON.stringify(d1.map(f => f.flag)));
  check('…with an exact key per gift', d1[0].key === 'gift__unbought__robin__2026__yoga-mat', d1[0].key);
  const d20 = due('2026-12-20');
  check('Dec 20: bought but not wrapped joins in, naming both of us', d20.length === 2 && d20[1].flag === 'Not wrapped yet: Board Game for Robin (Victoria and Ahmed).', JSON.stringify(d20.map(f => f.flag)));
  check('Dec 26: nothing (Christmas is over)', due('2026-12-26').length === 0);

  // The sheet side: raised once, closed when the box is ticked.
  const rows = [];
  const flagSheet = {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, n, w) => ({
      getValues: () => rows.slice(r - 2, r - 2 + n).map(x => x.slice(c - 1, c - 1 + w)),
      setValue: v => { rows[r - 2][c - 1] = v; },
    }),
    appendRow: x => rows.push(x.slice()),
  };
  const S5 = sandbox({ colorCodeFlags() {} });
  vm.runInContext(CODE.slice(CODE.indexOf('function appendExactKeyFlags_('), CODE.indexOf('function resolveFlagsWithPrefix_(')), S5);
  S5.sheet = flagSheet; S5.due = d1;
  vm.runInContext('appendExactKeyFlags_(sheet, due, "2026-12-01")', S5);
  vm.runInContext('appendExactKeyFlags_(sheet, due, "2026-12-02")', S5);
  check('raised once, not every night', rows.length === 1);
  S5.keys = {};
  check('closed once it’s no longer due (the box got ticked)', vm.runInContext('wishResolveStale_(sheet, keys)', S5) === 1 && rows[0][8] === 'Yes');
  vm.runInContext('appendExactKeyFlags_(sheet, due, "2026-12-03")', S5);
  check('…and a closed one is not raised again', rows.length === 1);
  rows.push(['F', '', '', '', '', '', '', '', 'No', 'cd_maturity_x', '']);
  vm.runInContext('wishResolveStale_(sheet, keys)', S5);
  check('other flags are never touched', rows[1][8] === 'No');
}

// ============ wiring =========================================================
console.log('\nwiring');
check('get_wish_lists is served by the new reader', /case 'get_wish_lists':\s+return jsonOut_\(webGetFamilyWishLists_\(e\)\);/.test(WEB) && !/function webGetFamilyWishLists_/.test(WEB));
check('the old paragraph reader is gone', !/\.getParagraphs\(/.test(WL));
check('the nightly steps run', /nightlyStep_\(ctx, 'seedWishListInitialsConfig_', seedWishListInitialsConfig_\);/.test(CODE) && /nightlyStep_\(ctx, 'checkWishListGifts_', checkWishListGifts_\);/.test(CODE));
check('the docs are never written to', !/\.(setText|appendParagraph|insert\w+|replaceText|clear)\(/.test(WL));
check('tbWishLists is in the README', /tbWishLists/.test(README));

const START = '// ---- WishListsView — SHARED VERBATIM', END = '// ---- /WishListsView ----';
const block = t => { const i = t.indexOf(START), j = t.indexOf(END); return i < 0 || j < 0 ? '' : t.slice(i, j + END.length); };
check('the view is one block, identical in both dashboards', block(APP).length > 2000 && block(APP) === block(LITE),
      block(APP) === block(LITE) ? '' : 'the two copies have drifted — paste the whole block across');
check('the full dashboard hands it the API settings, and no longer pre-loads every doc',
      /React\.createElement\(WishListsView,\{apiUrl:apiUrl,apiToken:apiToken,viewer:'ahmed'\}\)/.test(APP) && !/loadWishListsData\(apiUrl,apiToken\);\}/.test(APP));
check('dashboard-lite has a Wish Lists tab', /\{ id: 'wishlists',\s+label: '🎄 Wish Lists'\s+\}/.test(LITE) && /activeTab === 'wishlists' && \(\s+<WishListsView apiUrl=\{apiUrl\} apiToken=\{apiToken\} viewer="victoria" \/>/.test(LITE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
