// Packing, enriched (PackPlus.js, issue #234): three-step ticks kept in step with Checked, quantities
// and why, staples (profile and learned), similar past trips and the copy without the unused, the
// outfit plan and its pieces, buy before you go (the Shopping tab both ways), leave nothing behind,
// the after-trip review and its lessons, the luggage additions (wear on the plane, packed so far,
// over-the-limit fixes), and the wiring. Invented people, trips and items.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('PackPlus.js'), LU = read('Luggage.js'), LH = read('LeavingHome.js'), TRD = read('TripReadiness.js');
const CODE = read('Code.js'), WEB = read('WebApp.js'), TP = read('TravelerProfiles.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const arr = name => eval((CODE.match(new RegExp('const ' + name + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1]);
const H = { PackingItems: arr('PACKING_ITEM_HEADERS'), 'Trip Outfits': arr('TRIP_OUTFIT_HEADERS'), 'Packing Reviews': arr('PACKING_REVIEW_HEADERS'),
  'Leaving Home Runs': arr('LEAVE_RUN_HEADERS'), 'Leaving Home': arr('LEAVE_HOME_HEADERS'), Bags: arr('BAG_HEADERS'), TripMeta: arr('TRIP_META_HEADERS') };

function fakeSheet(rows) {
  const data = rows.map(r => r.slice());
  return { data, getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let i = 0; i < (nc || 1); i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
      getValue: () => (data[r - 1] || [])[c - 1] === undefined ? '' : data[r - 1][c - 1],
      setValue: v => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
      setValues: vs => vs.forEach((row, i) => { while (data.length < r + i) data.push([]); row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }),
    }),
    appendRow: row => data.push(row.slice()), deleteRow: r => data.splice(r - 1, 1) };
}
// A Shopping doc with tabs of list items; struck-through items are bought.
function fakeDoc(tabs) {
  const mk = (title, items) => ({ title, items: items.map(t => ({ text: t[0], done: !!t[1] })),
    getTitle() { return this.title; }, getId() { return 'tab-' + this.title; },
    asDocumentTab() { const tab = this; return { getBody: () => ({
      getNumChildren: () => tab.items.length,
      getChild: i => ({ getType: () => 'LIST', asListItem: () => ({ getText: () => tab.items[i].text, editAsText: () => ({ isStrikethrough: () => tab.items[i].done ? true : null }) }) }),
      appendListItem: t => { tab.items.push({ text: t, done: false }); return { setGlyphType: () => {} }; } }) }; } });
  const list = tabs.map(t => mk(t[0], t[1]));
  return { list, getTabs: () => list, addTab: o => { const t = mk(o.title, []); list.push(t); return t; } };
}

function ctx(o) {
  o = o || {};
  const sheets = {};
  Object.keys(H).forEach(n => { sheets[n] = fakeSheet([H[n]].concat((o.data || {})[n] || [])); });
  const lessons = [], tpSaves = [], claude = [];
  const doc = o.doc === null ? null : fakeDoc(o.doc || []);
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, parseFloat, parseInt, Error,
    TABS: { PACKING_ITEMS: 'PackingItems', TRIP_OUTFITS: 'Trip Outfits', PACKING_REVIEWS: 'Packing Reviews', LEAVE_RUNS: 'Leaving Home Runs', LEAVE_HOME: 'Leaving Home', BAGS: 'Bags', TRIP_META: 'TripMeta', TRIP_GIFTS: 'TripGifts', CARD_PERKS: 'CardPerks', ITINERARY: 'Itinerary' },
    PACKING_ITEM_HEADERS: H.PackingItems, TRIP_OUTFIT_HEADERS: H['Trip Outfits'], PACKING_REVIEW_HEADERS: H['Packing Reviews'], LEAVE_RUN_HEADERS: H['Leaving Home Runs'], LEAVE_HOME_HEADERS: H['Leaving Home'],
    BAG_HEADERS: H.Bags, TRIP_META_HEADERS: H.TripMeta, ITINERARY_HEADERS: [],
    TE_OWNER_: 'Ahmed', TE_PARTNER_: 'Victoria',
    Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log: () => {} },
    Utilities: { formatDate: (d, tz, f) => { const n = o.now || '2027-07-01T09:00'; return f === 'yyyy-MM-dd HH:mm' ? n.replace('T', ' ') : f === 'yyyy-MM-dd' ? n.slice(0, 10) : f === 'yyyyMMdd' ? n.slice(0, 10).replace(/-/g, '') : n; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    tripKeyMatches_: (a, b) => { const v = String(a == null ? '' : a).trim(); return !!v && v === String(b).trim(); },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, n, h) => sheets[n] || (sheets[n] = fakeSheet([h])),
    webGetTripMeta_: e => (o.meta || {})[e.parameter.tripKey] || {},
    webSetTripMeta_: () => ({ ok: true }),
    teTravellersForKey_: () => o.travellers || ['Ahmed', 'Victoria'],
    tpItems_: () => o.items || [],
    webTpSave_: b => { tpSaves.push(b); return { ok: true, id: b.id || 'TI-new' }; },
    tripItemsFor_: () => o.itinerary || [],
    readTripRegistry_: () => ({ rows: o.trips || [] }),
    callClaudeJsonDetailed_: (p) => { claude.push(p); return { json: o.claudeJson === undefined ? null : o.claudeJson }; },
    getShoppingDocId_: () => doc ? 'doc' : '',
    DocumentApp: { openById: () => doc, ElementType: { LIST_ITEM: 'LIST' }, GlyphType: { BULLET: 'b' } },
    logTripLesson_: (t, s, cat, label, d) => { lessons.push({ t, s, cat, label, d }); return { ok: true }; },
    tgAllRows_: () => o.gifts || [], tgRowToGift_: r => ({ id: r[0], tripKey: r[1], item: r[3], kind: r[7], packsAs: r[9] || 'none', status: r[8] }),
    tgHomeCheck_: (g) => ({ rules: [{ kind: 'checkin', title: 'Liquids', text: 'In the checked bag' }], declare: { total: 60, allowance: 1600 } }), tgHome_: () => 'United States',
  };
  vm.createContext(c); vm.runInContext(TRD, c); vm.runInContext(LU, c); vm.runInContext(LH, c); vm.runInContext(SRC, c);
  c.__sheets = sheets; c.__lessons = lessons; c.__tpSaves = tpSaves; c.__claude = claude; c.__doc = doc;
  return c;
}
const K = '2027-07-10|Lisbon';
const P = (id, person, item, extra) => [id, K, person, 'General', item, 'FALSE', 'ai', '2027-06-01'].concat(extra || []);

console.log('\nsteps and counts (pure)');
{
  const c = ctx();
  check('a Status cell wins; else from Checked', c.pkStatusOf_('buy', 'TRUE') === 'buy' && c.pkStatusOf_('', 'TRUE') === 'bag' && c.pkStatusOf_('', 'FALSE') === 'ready' && c.pkStatusOf_('nonsense', '') === 'ready');
  check('names match without counts or plurals', c.pkNorm_('T-shirts × 5') === c.pkNorm_('t-shirt') && c.pkNorm_('Socks (wool)') === c.pkNorm_('sock'));
  const q = (t, x) => c.pkQtyFor_(t, Object.assign({ nights: 8 }, x));
  check('8 nights, laundry once: 6 T-shirts', J(q('T-shirts', { laundry: true })) === J({ qty: 6, why: '8 nights, laundry once' }));
  check('8 nights, no laundry: 9', q('Underwear').qty === 9 && q('Underwear').why === '8 nights');
  check('14 nights, no laundry: 10, wash once there', q('Socks', { nights: 14 }).qty === 10 && /wash once there/.test(q('Socks', { nights: 14 }).why));
  check('trousers re-worn: 3 for 8 nights', q('Chinos').qty === 3 && q('Dress').qty === 3 && q('Dress shoes') === null);
  check('warm and 4+ nights: 2 swimsuits; cool nights: 2 sweaters', q('Swimsuit', { hiF: 81 }).qty === 2 && q('Swimsuit', { hiF: 70 }).qty === 1 && q('Sweater', { loF: 50 }).qty === 2 && /Evenings 61°F/.test(q('Sweater', { loF: 61 }).why));
  check('not clothing, or already counted: no count', q('Passport') === null && q('T-shirts x5') === null);
  check('the forecast’s range is read: 61–81°F', J(c.pkTempsFrom_('Expected: 61–81°F, dry. Warm')) === J({ loF: 61, hiF: 81, summary: 'Expected: 61–81°F, dry. Warm' }) && c.pkTempsFrom_('').hiF === undefined);
}

console.log('\nstaples');
{
  const c = ctx();
  const items = [{ person: 'Ahmed', section: 'preference', kind: 'always_pack', value: 'Contacts, allergy tablets; contacts' }, { person: 'Ahmed', section: 'preference', kind: 'seat', value: 'window' }];
  check('“Always pack” from the profile, split and de-duplicated', J(c.pkProfileStaples_(items)) === J({ Ahmed: ['Contacts', 'allergy tablets'] }));
  const rows = [];
  ['2025-01-01|A', '2025-05-01|B', '2025-09-01|C', '2026-02-01|D'].forEach((k, i) => {
    rows.push({ tripKey: k, person: 'ahmed', item: 'Phone stand' });
    if (i < 2) rows.push({ tripKey: k, person: 'ahmed', item: 'Umbrella' });
    rows.push({ tripKey: k, person: 'shared', item: 'Adapter' });
  });
  check('learned: on every list (3+ trips, 80%), not shared items', J(c.pkLearnedStaples_(rows)) === J({ ahmed: ['Phone stand'] }));
  check('learned needs 3 trips', J(c.pkLearnedStaples_(rows.filter(r => r.tripKey < '2025-09')) ) === J({}));
}

console.log('\npast trips');
{
  const c = ctx();
  const me = { label: 'Lisbon', start: '2027-07-10', nights: 8, traits: ['city', 'beach'] };
  const porto = c.pkSimilarity_(me, { label: 'Porto', start: '2025-09-02', nights: 6, traits: ['city'] });
  const lisbon = c.pkSimilarity_(me, { label: 'Lisbon again', start: '2024-06-20', nights: 9, traits: ['city', 'beach'] });
  check('alike by type, time of year, length and place', lisbon.score > porto.score && /same place/.test(lisbon.why.join()) && /city, beach/.test(lisbon.why.join()) && /same time of year/.test(lisbon.why.join()));
  const plan = c.pkCopyPlan_([{ person: 'ahmed', item: 'Sweater' }, { person: 'ahmed', item: 'Hair dryer' }, { person: 'ahmed', item: 'Passport' }], [{ person: 'ahmed', item: 'passport' }], ['hair dryers']);
  check('the copy skips what’s here and what went unused', J(plan.add.map(x => x.item)) === J(['Sweater']) && J(plan.skipped) === J(['Hair dryer']));
}

console.log('\noutfits (pure)');
{
  const c = ctx();
  const raw = { people: [{ name: 'Ahmed', days: [
    { date: '2027-07-10', label: 'Travel', weather: '75/62°F', looks: [{ when: 'Flight', pieces: ['Chinos', 'T-shirt', 'Walking shoes'] }] },
    { date: '2027-07-11', label: 'Sintra', looks: [{ when: 'Day', pieces: ['Shorts', 'T-shirt', 'Walking shoes'] }, { when: 'Evening', pieces: ['Chinos', 'T-shirt'] }] },
    { date: '2027-07-15', label: 'Thu', looks: [{ when: 'Dinner at Belcanto', pieces: ['Linen shirt', 'Chinos', 'Loafers'], note: 'smart casual' }] },
    { date: 'bad', label: 'x', looks: [{ when: 'x', pieces: [] }] } ] }, { name: 'Stranger', days: [{ date: '2027-07-10', looks: [{ pieces: ['x'] }] }] }] };
  const plan = c.pkCleanOutfits_(raw, ['Ahmed', 'Victoria']);
  check('cleaned: only travellers, days with looks', plan.people.length === 1 && plan.people[0].days.length === 3);
  const pieces = c.pkOutfitPieces_(plan.people[0]);
  const get = n => pieces.filter(p => p.item === n)[0] || {};
  check('T-shirts counted per wear; chinos re-worn (3 wears → 1)', get('T-shirt').qty === 3 && get('Chinos').qty === 1 && get('Walking shoes').qty === 1);
  check('each piece says where it’s from', /From outfits: Travel flight, Sintra day/.test(get('T-shirt').why) && /Thu dinner at belcanto/.test(get('Linen shirt').why), get('Linen shirt').why);
}

console.log('\nleave nothing behind (pure)');
{
  const c = ctx();
  const list = c.pkCheckoutItems_({ stays: [{ name: 'Alfama flat' }], packed: [{ item: 'Phone charger' }, { item: 'Power bank' }, { item: 'EU adapter' }, { item: 'Allergy meds' }], staples: ['Contacts'], homeGifts: 3 });
  const keys = list.map(i => i.key);
  check('chargers, the usual spots, adapters, meds and staples, gifts', J(keys) === J(['chargers', 'safe', 'bath', 'fridge', 'beds', 'wardrobe', 'keys', 'adapters', 'staples', 'gifts']), J(keys));
  check('…with why', /You packed 2: Phone charger, Power bank/.test(list[0].meta) && /Contacts, Allergy meds/.test(list[8].meta) && list[6].meta === 'Alfama flat');
  check('nothing packed: no chargers or adapters lines', c.pkCheckoutItems_({}).map(i => i.key).join() === 'safe,bath,fridge,beds,wardrobe,keys');
  check('review lessons', J(c.pkReviewLessons_({ unused: ['Hair dryer'], forgot: ['Beach towel'], bought: [] }, 'Lisbon').map(l => l.text)) === J(['Pack less: Hair dryer', 'Remember: Beach towel']));
}

console.log('\nthe list (routes)');
{
  const c = ctx({ data: { PackingItems: [P('PACK-1', 'ahmed', 'T-shirts'), P('PACK-2', 'ahmed', 'Sunscreen'), P('PACK-3', 'victoria', 'Allergy meds'), P('PACK-4', 'ahmed', 'Passport')] },
    meta: { [K]: { notes: 'Flat with a washer', characteristics: 'city, beach' } },
    items: [{ person: 'Ahmed', section: 'preference', kind: 'always_pack', value: 'Contacts, passport' }, { person: 'Victoria', section: 'preference', kind: 'always_pack', value: 'Retainer' }] });
  const pk = c.__sheets.PackingItems.data;
  const s1 = c.webPkStatus_({ id: 'PACK-1', status: 'bag', by: 'Ahmed' });
  check('in the bag: Status, Checked TRUE, who and when', s1.ok && pk[1][8] === 'bag' && pk[1][5] === 'TRUE' && pk[1][11] === 'Ahmed' && pk[1][12] === '2027-07-01 09:00');
  c.webPkStatus_({ id: 'PACK-1', status: 'ready', by: 'Victoria' });
  check('back to ready: Checked FALSE, the latest who', pk[1][8] === 'ready' && pk[1][5] === 'FALSE' && pk[1][11] === 'Victoria');
  check('a bad step or a gone item is refused', c.webPkStatus_({ id: 'PACK-1', status: 'packed' }).ok === false && c.webPkStatus_({ id: 'PACK-9', status: 'bag' }).ok === false);
  const g = c.pkAfterGenerate_(K, '2027-07-10', '2027-07-18', { hiF: 81, loF: 61 });
  check('after a list is made: the T-shirts are counted, with the laundry', pk[1][9] === 6 && pk[1][10] === '8 nights, laundry once', J(pk[1]));
  check('…and each traveller’s staples added once, not twice', g.staples === 2 && pk.filter(r => r[6] === 'staple').map(r => r[2] + ':' + r[4]).join() === 'ahmed:Contacts,victoria:Retainer');
  c.pkAfterGenerate_(K, '2027-07-10', '2027-07-18', {});
  check('running it again adds nothing', pk.filter(r => r[6] === 'staple').length === 2);
  check('qty: set by hand, 1–30', c.webPkQty_({ id: 'PACK-1', qty: 4 }).ok && pk[1][9] === 4 && pk[1][10] === 'Set by hand' && c.webPkQty_({ id: 'PACK-1', qty: 99 }).ok === false && c.webPkQty_({ id: 'PACK-1', qty: '' }).ok && pk[1][9] === '');
  const a = c.webPkAdd_({ tripKey: K, person: 'Victoria', item: 'Silk scarf', qty: 2 });
  check('add: lower-case person, ready, count kept', a.ok && pk[pk.length - 1][2] === 'victoria' && pk[pk.length - 1][8] === 'ready' && pk[pk.length - 1][9] === 2);
}

console.log('\nbuy before you go');
{
  const c = ctx({ data: { PackingItems: [P('PACK-1', 'ahmed', 'Sunscreen 100 ml'), P('PACK-2', 'victoria', 'Allergy meds'), P('PACK-3', 'shared', 'EU adapter')] }, doc: [['Costco', [['Milk']]]] });
  const r1 = c.webPkStatus_({ id: 'PACK-1', status: 'buy', by: 'Ahmed' });
  const tab = c.__doc.list.filter(t => t.title === 'Trip: Lisbon')[0];
  check('to buy: on a “Trip: Lisbon” Shopping tab, with the need-by date', r1.shopping === 'added' && tab && tab.items[0].text === 'Sunscreen 100 ml (need by Jul 8)', tab && J(tab.items));
  c.webPkStatus_({ id: 'PACK-1', status: 'buy', by: 'Ahmed' });
  check('not added twice', tab.items.length === 1);
  check('medicines stay with Prescriptions', c.webPkStatus_({ id: 'PACK-2', status: 'buy' }).shopping === 'rx' && tab.items.length === 1);
  c.webPkStatus_({ id: 'PACK-3', status: 'buy' });
  tab.items[0].done = true;
  const b = c.webPkBuy_({ tripKey: K });
  check('ticked bought in Shopping comes back as ready', J(b.bought) === J(['Sunscreen 100 ml']) && c.__sheets.PackingItems.data[1][8] === 'ready' && c.__sheets.PackingItems.data[1][11] === 'Shopping');
  check('the list: what’s still to buy, meds marked', J(b.items.map(i => i.item + (i.rx ? ' (rx)' : ''))) === J(['Allergy meds (rx)', 'EU adapter']) && b.list === 'Trip: Lisbon' && b.needBy === 'Jul 8' && b.shopping);
  const c2 = ctx({ data: { PackingItems: [P('PACK-1', 'ahmed', 'Sunscreen')] }, doc: null });
  check('no Shopping doc: still to buy here, says so', c2.webPkStatus_({ id: 'PACK-1', status: 'buy' }).shopping === 'none' && c2.webPkBuy_({ tripKey: K }).shopping === false);
}

console.log('\nstaples and past trips (routes)');
{
  const rows = [];
  ['2025-01-01|Rome', '2025-05-01|Porto', '2026-02-01|Oslo'].forEach((k, i) => { rows.push([k + i, k, 'ahmed', 'General', 'Phone stand', 'TRUE', 'ai', '']); rows.push([k + 'b', k, 'ahmed', 'General', i === 1 ? 'Hair dryer' : 'Book', 'TRUE', 'ai', '']); });
  rows.push(['NEW-1', K, 'ahmed', 'General', 'Passport', 'FALSE', 'ai', '']);
  const c = ctx({ data: { PackingItems: rows, 'Packing Reviews': [['2025-05-01|Porto', '["Hair dryer"]', '[]', '[]', 'Ahmed', '', 'yes']] },
    meta: { [K]: { characteristics: 'city' }, '2025-05-01|Porto': { characteristics: 'city' } },
    items: [{ id: 'TI-1', person: 'Ahmed', section: 'preference', kind: 'always_pack', value: 'Contacts' }],
    trips: [{ startDate: '2025-05-01', label: 'Porto', endDate: '2025-05-07' }] });
  const st = c.webPkStaples_();
  const ahmed = st.people.filter(p => p.name === 'Ahmed')[0];
  check('staples: the profile’s, and the phone stand VERA sees on every list', J(ahmed.profile) === J(['Contacts']) && J(ahmed.suggested) === J(['Phone stand']) && st.people.some(p => p.name === 'Victoria'));
  const acc = c.webPkStapleAccept_({ person: 'Ahmed', item: 'Phone stand' });
  check('accepting puts it on the profile’s Always pack', acc.ok && c.__tpSaves[0].id === 'TI-1' && c.__tpSaves[0].value === 'Contacts, Phone stand' && c.__tpSaves[0].kind === 'always_pack');
  const sim = c.webPkSimilar_({ tripKey: K, startDate: '2027-07-10', endDate: '2027-07-18' });
  check('similar past trips, earlier only, with why', sim.ok && sim.trips.length === 3 && sim.trips.every(t => t.tripKey !== K) && /you didn’t use 1 thing/.test(sim.trips.filter(t => t.label === 'Porto')[0].why));
  const cp = c.webPkCopy_({ tripKey: K, from: '2025-05-01|Porto', startDate: '2027-07-10', endDate: '2027-07-18' });
  const mine = c.__sheets.PackingItems.data.filter(r => r[1] === K).map(r => r[4]);
  check('copy: the phone stand comes, the unused hair dryer doesn’t', cp.ok && cp.added === 1 && J(cp.skipped) === J(['Hair dryer']) && mine.indexOf('Phone stand') !== -1 && mine.indexOf('Hair dryer') === -1);
  check('…marked as from Porto, and the staples follow', c.__sheets.PackingItems.data.some(r => r[1] === K && r[4] === 'Phone stand' && r[6] === 'copy' && r[10] === 'From Porto') && mine.indexOf('Contacts') !== -1);
}

console.log('\noutfits (routes)');
{
  const json = { people: [{ name: 'Ahmed', days: [{ date: '2027-07-10', label: 'Travel', weather: 'about 75°', looks: [{ when: 'Flight', pieces: ['Chinos', 'T-shirt'] }] },
    { date: '2027-07-15', label: 'Thu', looks: [{ when: 'Dinner', pieces: ['Linen shirt', 'Chinos'] }, { when: 'Day', pieces: ['T-shirt', 'Shorts'] }] }] }] };
  const c = ctx({ claudeJson: json, travellers: ['Ahmed'], data: { PackingItems: [P('PACK-1', 'ahmed', 'T-shirts', ['ready', 1, 'x'])] },
    itinerary: [{ date: '2027-07-15', type: 'dining', title: 'Belcanto', metadata: '{"dresscode":"smart casual"}' }], meta: { [K]: { characteristics: 'city' } } });
  check('none yet', c.webPkOutfits_({ tripKey: K }).has === false);
  const m = c.webPkOutfitsMake_({ tripKey: K, startDate: '2027-07-10', endDate: '2027-07-18' });
  check('one Claude call from the itinerary, the dress code and the travellers', c.__claude.length === 1 && /Belcanto/.test(c.__claude[0]) && /dress code: smart casual/.test(c.__claude[0]) && /for each traveller: Ahmed\./.test(c.__claude[0]) && /Re-wear pieces/.test(c.__claude[0]));
  check('saved, with the pieces', m.ok && c.webPkOutfits_({ tripKey: K }).has && m.people[0].pieces.length === 4 && c.__sheets['Trip Outfits'].data.length === 2);
  c.webPkOutfitsMake_({ tripKey: K, startDate: '2027-07-10', endDate: '2027-07-18' });
  check('making it again replaces it', c.__sheets['Trip Outfits'].data.length === 2);
  const add = c.webPkOutfitsAdd_({ tripKey: K, person: 'Ahmed' });
  const pk = c.__sheets.PackingItems.data;
  check('add to the list: new pieces added with counts, the T-shirts raised to 2', add.added === 3 && add.updated === 1 && pk[1][9] === 2 && pk.some(r => r[4] === 'Linen shirt' && r[6] === 'outfit' && /From outfits/.test(r[10])));
  const c2 = ctx({ claudeJson: null });
  check('a failed call says so', c2.webPkOutfitsMake_({ tripKey: K }).ok === false && c2.webPkOutfitsAdd_({ tripKey: K, person: 'Ahmed' }).ok === false);
}

console.log('\nleave nothing behind (routes)');
{
  const c = ctx({ data: { PackingItems: [P('PACK-1', 'ahmed', 'Phone charger')] }, itinerary: [{ type: 'hotel', title: 'Alfama flat', date: '2027-07-10' }],
    items: [{ person: 'Ahmed', section: 'preference', kind: 'always_pack', value: 'Contacts' }], travellers: ['Ahmed'],
    gifts: [['G1', K, 'Ana', 'Port wine', '', '', '', 'souvenir', 'Bought', 'liquid'], ['G2', K, 'Host', 'Tea', '', '', '', 'host', 'Bought', 'food']] });
  const q = { tripKey: K, startDate: '2027-07-10', endDate: '2027-07-18' };
  const v = c.webPkCheckout_(q);
  check('the list from the stay and what was packed, gifts coming home', v.ok && v.total === 9 && v.items[0].key === 'chargers' && v.stays[0] === 'Alfama flat' && v.gifts.count === 1 && v.gifts.declare.allowance === 1600);
  const t = c.webPkCheckoutTick_(Object.assign({ key: 'safe', done: true, by: 'Victoria' }, q));
  check('a tick: shared, with who and when, kept as a checkout row', t.done === 1 && t.items.filter(i => i.key === 'safe')[0].by === 'Victoria' && c.__sheets['Leaving Home Runs'].data[1][1] === 'checkout');
  check('the leaving-home list doesn’t pick it up', c.lhRuns_().filter(r => r.kind === 'trip').length === 0 && c.webPkCheckout_(q).done === 1);
  c.webPkCheckoutTick_(Object.assign({ key: 'safe', done: false }, q));
  check('untick', c.webPkCheckout_(q).done === 0 && c.__sheets['Leaving Home Runs'].data.length === 2);
}

console.log('\nafter the trip');
{
  const c = ctx({ data: { PackingItems: [P('PACK-1', 'ahmed', 'Sweater', ['bag', 2]), P('PACK-2', 'ahmed', 'Hair dryer'), P('PACK-3', 'victoria', 'sweaters')] }, meta: { [K]: { characteristics: 'city, beach' } } });
  const r = c.webPkReview_({ tripKey: K });
  check('what was packed, once each, with counts', r.ok && J(r.packed.map(p => p.item)) === J(['Sweater × 2', 'Hair dryer']) && !r.saved);
  const s = c.webPkReviewSave_({ tripKey: K, unused: ['Hair dryer', 'hair dryer'], forgot: ['Beach towel'], bought: ['Sunhat'], by: 'Ahmed' });
  check('saved, and three packing lessons logged for city trips', s.ok && J(c.__lessons.map(l => l.t)) === J(['Pack less: Hair dryer', 'Remember: Beach towel', 'Pack it, don’t buy it: Sunhat']) && c.__lessons[0].s === 'trait:city' && c.__lessons[0].cat === 'Packing');
  c.webPkReviewSave_({ tripKey: K, unused: ['Hair dryer', 'Sweater'], forgot: [], bought: [] });
  check('saving again updates it but logs no lessons twice', c.__lessons.length === 3 && c.__sheets['Packing Reviews'].data.length === 2 && J(c.webPkReview_({ tripKey: K }).unused) === J(['Hair dryer', 'Sweater']));
  const c2 = ctx({ meta: {} });
  c2.webPkReviewSave_({ tripKey: K, forgot: ['x'] });
  check('no trip type: an “always” lesson', c2.__lessons[0].s === 'always:all');
}

console.log('\nluggage additions');
{
  const c = ctx();
  const bags = c.luBagRows_([['B1', 'Grey roller', 'carry-on', '', 5.7, 'Ahmed', '', ''], ['B2', 'Blue medium', 'checked', '', 8.4, 'Ahmed', '', ''], ['B4', 'Backpack', 'personal', '', 2.4, 'Ahmed', '', '']]);
  const pk = (id, item, st, qty) => ({ id, person: 'ahmed', item, status: st || 'ready', qty: qty || '' });
  const packing = [pk('1', 'Boots', 'bag'), pk('2', 'T-shirts', 'bag', 10), pk('3', 'Shampoo 300 ml'), pk('4', 'Passport'), pk('5', 'Jeans', 'ready', 3)];
  for (let i = 0; i < 12; i++) packing.push(pk('h' + i, 'Boots x1'));
  const r = c.luAdvise_({ travellers: ['Ahmed'], packing, bags, nights: 9, laundry: false });
  const blue = r.people[0].bags.filter(b => b.id === 'B2')[0];
  check('a count on the list counts in the weight', blue.items.some(i => i.key === 'p:2' && i.item === 'T-shirts × 10' && i.lb === 4));
  check('packed so far: the bag plus what’s ticked in', blue.packed === 2 && blue.packedLb === Math.round((8.4 + 3 + 4) * 10) / 10, blue.packedLb);
  check('over the limit: fixes, biggest first', blue.state === 'over' && blue.fixes.length >= 2 && blue.fixes[0].saves >= blue.fixes[blue.fixes.length - 1].saves, J(blue.fixes));
  check('…wear the boots on the plane', blue.fixes.some(f => f.kind === 'wear' && /Boots/.test(f.item)));
  check('…never the shampoo into the cabin', !blue.fixes.some(f => f.kind === 'move' && f.key === 'p:3'));
  check('…one fewer of something counted, not one already suggested', blue.fixes.some(f => f.kind === 'fewer' && f.key === 'p:2' && f.item === 'T-shirts' && f.saves === 0.4) && blue.fixes.some(f => f.kind === 'move' && f.key === 'p:5' && f.to === 'B1') && new Set(blue.fixes.map(f => f.key)).size === blue.fixes.length, J(blue.fixes));
  const big = { id: 'X', type: 'checked', weightLb: 53, limitLb: 50, items: [{ key: 'p:o', item: 'Olive oil', lb: 3, qty: 1, place: 'checked' }, { key: 'p:d', item: 'Passport', lb: 0.5, qty: 1, place: 'personal' }] };
  const tote = { id: 'T', name: 'Tote', type: 'personal', weightLb: 2, limitLb: null, items: [] }, hold = { id: 'H', name: 'Spinner', type: 'checked', weightLb: 20, limitLb: 50, items: [] };
  check('a liquid is never moved into the cabin (the passport can be)', !c.luFixes_(big, [big, tote]).some(f => f.key === 'p:o') && c.luFixes_(big, [big, tote]).some(f => f.key === 'p:d'));
  check('documents never move into the hold, but the liquid can', J(c.luFixes_(big, [big, hold]).map(f => f.kind + ':' + f.key)) === J(['move:p:o']));
  const r2 = c.luAdvise_({ travellers: ['Ahmed'], packing, bags, nights: 9, moves: { 'p:1': 'wear' } });
  check('worn on the plane: in no bag, said in the advice', !r2.people[0].bags.some(b => b.items.some(i => i.key === 'p:1')) && /Wearing on the plane: Boots/.test(r2.people[0].why));
  check('a move to “wear” is accepted', /bag 'wear'/.test(LU));
}

console.log('\nwiring');
{
  check('PackingItems gains Status, Qty, Why, By, At, then the Trip ID (#239)', J(H.PackingItems.slice(8)) === J(['Status', 'Qty', 'Why', 'By', 'At', 'Trip ID']));
  check('the writers fill all 13 columns', /'FALSE', 'manual', addedDate, 'ready', '', '', '', '',/.test(WEB) && /'ready', '', '', '', '',   \/\/ Status, Qty, Why, By, At/.test(WEB));
  check('the old tick keeps Status in step', /found\.sheet\.getRange\(found\.rowNum, 9\)\.setValue\(val === 'TRUE' \? 'bag' : 'ready'\)/.test(WEB));
  check('making a list adds staples and counts', /if \(typeof pkAfterGenerate_ === 'function'\) pkAfterGenerate_\(tripKey, startDate, endDate, pkTempsFrom_\(weatherSummary\)\);/.test(WEB) && WEB.indexOf('pkAfterGenerate_(tripKey') < WEB.indexOf('var packResult = webGetPacking_(e);'));
  check('the list returns the new fields', /status:    typeof pkStatusOf_ === 'function'/.test(WEB) && /qty:       Number\(row\[9\]\)/.test(WEB));
  check('Always pack on the profile', /\['always_pack', 'Always pack'\]/.test(TP));
  check('the two new tabs', /TRIP_OUTFITS:\s*'Trip Outfits'/.test(CODE) && /PACKING_REVIEWS:\s*'Packing Reviews'/.test(CODE));
  ['pk_staples', 'pk_similar', 'pk_outfits', 'pk_buy', 'pk_checkout', 'pk_review'].forEach(a => check('GET ' + a, new RegExp("case '" + a + "':\\s*return jsonOut_\\(webPk\\w+_\\(").test(WEB)));
  ['pk_status', 'pk_qty', 'pk_add', 'pk_staple_accept', 'pk_copy', 'pk_outfits_make', 'pk_outfits_add', 'pk_checkout_tick', 'pk_review_save'].forEach(a => check('POST ' + a, new RegExp("case '" + a + "':\\s*return jsonOut_\\(webPk\\w+_\\(body\\)\\)").test(WEB)));
  check('no calendar writes, no sheet IDs', !/CalendarApp|createEvent|openById\('/.test(SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
