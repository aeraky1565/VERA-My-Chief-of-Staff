// Luggage advice (Luggage.js, issue #230): weights and units, where each item goes, which bags
// each traveller takes and why, the about-weights against the limits, the airline box (Basic
// Economy, status, card perks, road trips), the moves kept in TripMeta "Luggage JSON", and the
// routes over in-memory sheets. Invented people, bags and trips.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'Luggage.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const TRD = fs.readFileSync(path.join(ROOT, 'TripReadiness.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const arr = name => eval((CODE.match(new RegExp('const ' + name + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1]);
const BAG_HEADERS = arr('BAG_HEADERS'), TRIP_META_HEADERS = arr('TRIP_META_HEADERS'), PACKING_ITEM_HEADERS = arr('PACKING_ITEM_HEADERS');

function fakeSheet(rows) {
  const data = rows.map(r => r.slice());
  const sh = {
    data,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let i = 0; i < (nc || 1); i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
      getValue: () => (data[r - 1] || [])[c - 1] === undefined ? '' : data[r - 1][c - 1],
      setValue: v => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
      setValues: vs => vs.forEach((row, i) => { while (data.length < r + i) data.push([]); row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }),
    }),
    appendRow: row => data.push(row.slice()),
    deleteRow: r => data.splice(r - 1, 1),
  };
  return sh;
}

function ctx(o) {
  o = o || {};
  const sheets = {
    Bags: fakeSheet([BAG_HEADERS].concat(o.bags || [])),
    TripMeta: fakeSheet([TRIP_META_HEADERS].concat(o.meta || [])),
    PackingItems: fakeSheet([PACKING_ITEM_HEADERS].concat(o.packing || [])),
  };
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, parseFloat, parseInt, Error,
    TABS: { BAGS: 'Bags', TRIP_META: 'TripMeta', PACKING_ITEMS: 'PackingItems', TRIP_GIFTS: 'TripGifts', CARD_PERKS: 'CardPerks' },
    BAG_HEADERS, TRIP_META_HEADERS, PACKING_ITEM_HEADERS,
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '2027-03-01' }, Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    tripKeyMatches_: (a, b) => { const v = String(a == null ? '' : a).trim(); return !!v && v === String(b).trim(); },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, n) => sheets[n],
    webSetTripMeta_: e => { sheets.TripMeta.appendRow([e.parameter.tripKey, '', '', '', '', '', 2, '', '', '', '']); return { ok: true }; },
    webGetTripMeta_: () => o.tripMeta || {},
    teTravellersForKey_: () => o.travellers || [],
    tpItems_: () => o.items || [],
    tripItemsFor_: () => o.itinerary || [],
  };
  vm.createContext(c);
  vm.runInContext(TRD, c);   // trdAirline_, trdMemberFor_, the alliance tiers
  vm.runInContext(SRC, c);
  c.__sheets = sheets;
  return c;
}

console.log('\nweights and units');
{
  const c = ctx();
  check('lb by default, kg converted to lb', c.luParseWeight_('9.3', 'lb') === 9.3 && c.luParseWeight_('4.2 kg') === 9.3 && c.luParseWeight_('4.2', 'kg') === 9.3);
  check('a unit typed wins over the switch', c.luParseWeight_('10 lb', 'kg') === 10);
  check('not a weight: null', c.luParseWeight_('heavy') === null && c.luParseWeight_('') === null && c.luParseWeight_('900') === null);
  check('typical weights: shoes about 2 lb, jeans about 1.5 lb', c.luItemWeight_('Running shoes') === 2 && c.luItemWeight_('Jeans') === 1.5);
  check('a count multiplies: "T-shirts x5"', c.luItemWeight_('T-shirts x5') === 2 && c.luItemWeight_('3 shirts') === 1.2);
  check('anything else is about half a pound', c.luItemWeight_('Travel pillow cover') === 0.5);
}

console.log('\nwhere each item goes');
{
  const c = ctx();
  const at = (t, g) => c.luPlace_(t, g);
  check('passport stays with you', at('Passport').place === 'personal' && /documents/.test(at('Passport').why));
  check('meds stay with you', at('Allergy meds').place === 'personal' && /meds/.test(at('Allergy meds').why));
  check('chargers and batteries: never checked', at('Phone charger').place === 'carry' && at('Power bank').place === 'carry' && /never checked/.test(at('Power bank').why));
  check('valuables stay with you', at('Laptop').place === 'carry' && at('Necklace').place === 'carry');
  check('a liquid over 100 ml goes checked', at('Shampoo 250 ml').place === 'checked' && /over 100 ml/.test(at('Shampoo 250 ml').why));
  check('a liquid of 100 ml or less can go anywhere', at('Shampoo 90 ml').place === 'any' && at('Lotion 3 oz').place === 'any');
  check('a full-size liquid: checked if there is one', at('Sunscreen').place === 'checked-soft' && at('Travel sunscreen').place !== 'checked-soft');
  check('fragile and liquid gifts go checked', at('Ceramic bowl', 'fragile').place === 'checked' && at('Olive oil x2', 'liquid').place === 'checked' && /liquid, fragile/.test(at('Olive oil', 'fragile').why));
  check('a food gift can go anywhere', at('Chocolate', 'food').place === 'any');
}

const bagRows = [
  ['B1', 'Grey roller', 'carry-on', '22 × 14 × 9 in', 5.7, 'Ahmed', '', ''],
  ['B2', 'Blue medium', 'checked', '27 × 18 × 11 in', 8.4, 'Victoria', '', ''],
  ['B3', 'Big black spinner', 'checked', '31 × 20 × 12 in', 10.8, 'Shared', '', ''],
  ['B4', 'Black backpack', 'personal', '18 × 12 × 7 in', 2.4, 'Ahmed', '', ''],
  ['B5', 'Tote', 'personal', '', 1.3, 'Victoria', '', ''],
];

console.log('\nwhich bags, and why');
{
  const c = ctx();
  const bags = c.luBagRows_(bagRows);
  const pk = (id, person, item) => ({ id, person, item, category: '' });
  const packing = [pk('1', 'ahmed', 'Passport'), pk('2', 'ahmed', 'T-shirts x5'), pk('3', 'ahmed', 'Jeans'), pk('4', 'ahmed', 'Phone charger'), pk('5', 'ahmed', 'Sunglasses'),
    pk('6', 'victoria', 'Wedding dress'), pk('7', 'victoria', 'Heels'), pk('8', 'victoria', 'Shampoo 250 ml'), pk('9', 'victoria', 'Allergy meds'), pk('10', 'shared', 'Adapter plugs')];
  const gifts = [{ id: 'G1', item: 'Olive oil x2', kind: 'host', packsAs: 'liquid' }, { id: 'G2', item: 'Ceramic bowl', kind: 'host', packsAs: 'fragile' }, { id: 'G3', item: 'Port wine', kind: 'us', packsAs: 'liquid' }];
  const r = c.luAdvise_({ travellers: ['Ahmed', 'Victoria'], packing, gifts, bags, nights: 8, laundry: true, characteristics: ['city'], flights: [], memberships: [], perks: [] });
  const a = r.people[0], v = r.people[1];
  check('one card per traveller, in order', r.people.length === 2 && a.name === 'Ahmed' && v.name === 'Victoria');
  check('you: carry-on only, with your own bags', !a.needChecked && J(a.bags.map(b => b.name)) === J(['Grey roller', 'Black backpack']) && /^Carry-on only: 8 nights with laundry/.test(a.why), a.why);
  check('Victoria: a checked bag, her own, because of the shampoo and the gifts', v.needChecked && v.bags[0].name === 'Blue medium' && /Shampoo 250 ml/.test(v.why), v.why);
  check('with a checked bag and no carry-on of her own free, no made-up carry-on', J(v.bags.map(b => b.name)) === J(['Blue medium', 'Tote']), J(v.bags.map(b => b.name)));
  check('the host gifts go with whoever has a checked bag', v.gifts === 2 && a.gifts === 0 && v.bags[0].items.some(i => i.key === 'g:G1' && i.gift && /liquid/.test(i.why)));
  check('gifts coming home leave room, on the checked bag', /1 gift coming home, about 3 lb: leave room/.test(v.why) && !/coming home/.test(a.why));
  check('shared items go with the first traveller', a.bags.some(b => b.items.some(i => i.key === 'p:10' && /shared/.test(i.why))));
  const pers = a.bags[1], carry = a.bags[0];
  check('passport and sunglasses in the personal item; charger in the carry-on', pers.items.some(i => i.item === 'Passport') && pers.items.some(i => i.item === 'Sunglasses') && carry.items.some(i => i.item === 'Phone charger'));
  check('meds stay with her even with a checked bag', v.bags.filter(b => b.type === 'personal')[0].items.some(i => i.item === 'Allergy meds'));
  check('the about-weight counts the bag’s own weight', carry.weightLb === Math.round((5.7 + 2 + 1.5 + 0.3 + 0.3) * 10) / 10, carry.weightLb);
  check('checked limit 50 lb; no carry-on limit on airlines that don’t weigh', v.bags[0].limitLb === 50 && carry.limitLb === null);
  const r2 = c.luAdvise_({ travellers: ['Ahmed'], packing: [pk('1', 'ahmed', 'Jeans')], bags, nights: 9, laundry: false, flights: [] });
  check('9 nights without laundry means a checked bag, the shared one when you have none', r2.people[0].needChecked && /9 nights without laundry/.test(r2.people[0].why) && r2.people[0].bags[0].name === 'Big black spinner');
  const shared1 = [['S1', 'Big black spinner', 'checked', '', 10.8, 'Shared', '', '']];
  const r2b = c.luAdvise_({ travellers: ['Ahmed', 'Victoria'], packing: [pk('1', 'ahmed', 'Jeans'), pk('2', 'victoria', 'Heels')], bags: c.luBagRows_(shared1), nights: 10 });
  check('one shared bag goes to one person; the other gets a plain checked bag', r2b.people[0].bags[0].name === 'Big black spinner' && r2b.people[1].bags[0].name === 'A checked bag' && r2b.people[1].bags[0].generic);
  const r3 = c.luAdvise_({ travellers: ['Ahmed'], packing: [pk('1', 'ahmed', 'Jeans')], bags: [], nights: 3, characteristics: ['ski'] });
  check('ski gear means a checked bag; no bags listed gives plain names, checked and personal item', r3.people[0].needChecked && /ski gear/.test(r3.people[0].why) && r3.people[0].bags[0].name === 'A checked bag' && r3.people[0].bags[0].generic
    && J(r3.people[0].bags.map(b => b.type)) === J(['checked', 'personal']));
  const r3b = c.luAdvise_({ travellers: ['Ahmed'], packing: [pk('1', 'ahmed', 'Jeans')], bags, nights: 9 });
  check('with a checked bag, your own carry-on still comes if it’s free', J(r3b.people[0].bags.map(b => b.name)) === J(['Big black spinner', 'Grey roller', 'Black backpack']));
  const heavy = []; for (let i = 0; i < 14; i++) heavy.push(pk('h' + i, 'ahmed', 'Boots'));
  const r4 = c.luAdvise_({ travellers: ['Ahmed'], packing: heavy, bags: [], nights: 2 });
  check('more than a carry-on and personal item hold: a checked bag', r4.people[0].needChecked && /about 42 lb of things/.test(r4.people[0].why), r4.people[0].why);
  const r4b = c.luAdvise_({ travellers: ['Ahmed'], packing: [pk('n', 'ahmed', 'Boots x11')], bags: [], nights: 2 });
  check('about 42 of 50 lb is near the limit; 30 of 50 is fine', r4b.people[0].bags[0].weightLb === 42 && r4b.people[0].bags[0].state === 'near'
    && c.luAdvise_({ travellers: ['Ahmed'], packing: [pk('n', 'ahmed', 'Boots x9')], bags: [], nights: 2 }).people[0].bags[0].state === 'ok', r4b.people[0].bags[0].weightLb);
  const many = []; for (let i = 0; i < 9; i++) many.push(pk('m' + i, 'ahmed', 'Boots x2'));
  const r5 = c.luAdvise_({ travellers: ['Ahmed'], packing: many, bags: [], nights: 2 });
  check('over 50 lb shows as over', r5.people[0].bags[0].state === 'over', r5.people[0].bags[0].weightLb);
  const r6 = c.luAdvise_({ travellers: [], packing: [pk('1', 'victoria', 'Heels')], bags: [] });
  check('no travellers set: the people on the packing list', r6.people.length === 1 && r6.people[0].name === 'Victoria');
}

console.log('\nmoves');
{
  const c = ctx();
  const bags = c.luBagRows_(bagRows);
  const packing = [{ id: '1', person: 'ahmed', item: 'Jeans' }, { id: '2', person: 'ahmed', item: 'Passport' }, { id: '3', person: 'ahmed', item: 'Book' }];
  const r = c.luAdvise_({ travellers: ['Ahmed'], packing, bags, nights: 2, laundry: false, moves: { 'p:3': 'B1', 'p:2': 'B1' } });
  const roller = r.people[0].bags.filter(b => b.id === 'B1')[0];
  check('a move puts the item in the bag picked', roller.items.some(i => i.key === 'p:3'));
  check('a move of a must-stay-with-you item into a carry-on is fine', roller.items.some(i => i.key === 'p:2' && !/moved/.test(i.why)));
  const r2 = c.luAdvise_({ travellers: ['Ahmed'], packing: [{ id: '2', person: 'ahmed', item: 'Passport' }, { id: '4', person: 'ahmed', item: 'Shampoo 300 ml' }], bags, nights: 2, moves: { 'p:2': 'B3' } });
  const checked = r2.people[0].bags.filter(b => b.type === 'checked')[0];
  check('moving the passport into a checked bag warns', checked.items.some(i => i.key === 'p:2' && /better with you/.test(i.why) && i.tone === 'warn'));
  const r3 = c.luAdvise_({ travellers: ['Ahmed'], packing, bags, nights: 2, moves: { 'p:1': 'B9' } });
  check('a move to a bag not on this trip is ignored', r3.people[0].bags.some(b => b.items.some(i => i.key === 'p:1')));
}

console.log('\nthe airline box');
{
  const c = ctx();
  const ua = { air: { code: 'UA', name: 'united', alliance: 'star' }, basic: false, label: 'UA 950' };
  const tp = { air: { code: 'TP', name: 'tap', alliance: 'star' }, basic: false, label: 'TP 204' };
  const mem = [{ person: 'Ahmed', section: 'membership', label: 'Aegean Miles+Bonus', value: 'Star Alliance', tier: 'Gold' }];
  const perks = [{ card: 'United Explorer', perk: 'Free first checked bag' }];
  const a = c.luAirline_({ flights: [tp, ua], memberships: mem, perks, people: ['Ahmed', 'Victoria'] });
  const txt = a.lines.map(l => l.text).join(' | ');
  check('one line per airline, by flight', /TP 204: carry-on and personal item, usually free/.test(txt) && /UA 950: carry-on/.test(txt), txt);
  check('partner status waives the checked bag', /Checked bags on United: free for Ahmed with Star Alliance Gold \(Aegean Miles\+Bonus Gold\)\. It often covers others/.test(txt), txt);
  check('a card perk on that airline waives it too', /Paying with the United Explorer waives the first United checked bag/.test(txt));
  const plain = c.luAirline_({ flights: [tp], memberships: [], perks, people: ['Victoria'] }).lines.map(l => l.text).join(' | ');
  check('no status, no perk on that airline: about what it costs', /Checked bag on TAP: may be paid, about \$35–75 each way/.test(plain) && !/Explorer/.test(plain), plain);
  check('TAP weighs carry-ons: the lowest limit, in lb', a.carryLimitLb === 17.6 && a.checkedLimitLb === 50);
  const b = c.luAirline_({ flights: [Object.assign({}, ua, { basic: true })], people: ['Ahmed'] });
  check('Basic Economy: a personal item only', b.basic && /Basic Economy, so a personal item only/.test(b.lines[0].text) && b.lines[0].tone === 'warn');
  const none = c.luAirline_({ flights: [], people: ['Ahmed'] });
  check('no flights yet: says so', none.none && /No flights/.test(none.note));
  const r = c.luAdvise_({ travellers: ['Ahmed'], packing: [{ id: '1', person: 'ahmed', item: 'Jeans' }, { id: '2', person: 'ahmed', item: 'Sweater' }], bags: [], nights: 2, flights: [Object.assign({}, ua, { basic: true })] });
  check('Basic Economy advice: personal item only, no carry-on', !r.people[0].bags.some(b => b.type === 'carry-on') && /^Personal item only \(Basic Economy\)/.test(r.people[0].why));
  const road = c.luAdvise_({ travellers: ['Ahmed'], packing: [{ id: '1', person: 'ahmed', item: 'Boots x9' }], bags: [], nights: 2, road: true, flights: [ua] });
  check('road trips: bags only, no airline rules and no limits', road.road && road.airline === null && road.people[0].bags.every(b => b.limitLb === null && b.state === 'ok'));
}

console.log('\nroutes');
{
  const c = ctx({ bags: bagRows, meta: [['2027-07-10|Lisbon', '', 'Flat with a washer', '', '', '', 2, '', '', '{"moves":{"p:1":"B4"},"v":1}', 'city']],
    packing: [['1', '2027-07-10|Lisbon', 'ahmed', 'Clothes', 'Jeans', 'FALSE', 'manual', ''], ['2', '2027-07-10|Lisbon', 'victoria', 'Clothes', 'Heels', 'FALSE', 'manual', ''], ['3', '2027-08-01|Rome', 'ahmed', 'Clothes', 'Hat', 'FALSE', 'manual', '']],
    tripMeta: { notes: 'Flat with a washer', characteristics: 'city' }, travellers: ['Ahmed', 'Victoria'],
    itinerary: [{ type: 'flight', title: 'TP 204 IAD → LIS', date: '2027-07-10', metadata: '{"flightNum":"TP204"}' }] });
  const r = c.webLuggage_({ tripKey: '2027-07-10|Lisbon', startDate: '2027-07-10', endDate: '2027-07-18' });
  check('luggage: ok, 8 nights, laundry read from the trip notes', r.ok && r.nights === 8 && r.laundry === true);
  check('only this trip’s packing items', r.people[0].count === 1 && r.people[1].count === 1);
  check('the saved move is used', r.people[0].bags.filter(b => b.id === 'B4')[0].items.some(i => i.key === 'p:1'));
  check('the airline from the itinerary', !r.airline.none && /TP204/.test(r.airline.lines[0].text), J(r.airline));
  check('tripKey required', c.webLuggage_({}).ok === false);
  const s1 = c.webLuBagSave_({ name: 'Red spinner', type: 'Checked', size: '76 × 52 × 31 cm', weight: '4.2', unit: 'kg', whose: 'Victoria' });
  const red = s1.bags.filter(b => b.name === 'Red spinner')[0];
  check('save a bag: kg stored as lb, type cleaned', s1.ok && red && red.type === 'checked' && red.emptyLb === 9.3 && red.whose === 'Victoria' && red.size === '76 × 52 × 31 cm');
  const s2 = c.webLuBagSave_({ id: red.id, name: 'Red spinner', type: 'checked', weight: '9 lb', whose: 'Shared' });
  check('edit a bag in place', s2.bags.filter(b => b.id === red.id).length === 1 && s2.bags.filter(b => b.id === red.id)[0].emptyLb === 9 && s2.bags.length === 6);
  check('a bag needs a name and a type; weight a number', c.webLuBagSave_({ type: 'checked' }).ok === false && c.webLuBagSave_({ name: 'X' }).ok === false && c.webLuBagSave_({ name: 'X', type: 'checked', weight: 'heavy' }).ok === false);
  check('delete a bag', c.webLuBagDelete_({ id: red.id }).bags.length === 5);
  const m = c.webLuMove_({ tripKey: '2027-07-10|Lisbon', item: 'p:2', bag: 'B5' });
  const cell = JSON.parse(c.__sheets.TripMeta.data[1][9]);
  check('a move is kept in the Luggage JSON column, with the earlier ones', m.ok && cell.moves['p:2'] === 'B5' && cell.moves['p:1'] === 'B4');
  c.webLuMove_({ tripKey: '2027-07-10|Lisbon', item: 'p:1', bag: '' });
  check('moving back to VERA’s pick clears it', !JSON.parse(c.__sheets.TripMeta.data[1][9]).moves['p:1']);
  const m2 = c.webLuMove_({ tripKey: '2027-08-01|Rome', item: 'p:3', bag: 'B1' });
  check('a trip with no details row gets one', m2.ok && c.__sheets.TripMeta.data.length === 3 && /B1/.test(c.__sheets.TripMeta.data[2][9]));
  check('only item keys are accepted', c.webLuMove_({ tripKey: '2027-07-10|Lisbon', item: 'x', bag: 'B1' }).ok === false);
  const road = ctx({ tripMeta: { characteristics: 'roadtrip, outdoors' }, itinerary: [{ type: 'flight', title: 'UA 1' }] }).webLuggage_({ tripKey: 'k', startDate: '2027-07-10', endDate: '2027-07-12' });
  check('a road trip has no airline box', road.road && road.airline === null);
}

console.log('\nwiring');
{
  check('the Bags tab is declared with its headers', /BAGS:\s*'Bags'/.test(CODE) && J(BAG_HEADERS) === J(['ID', 'Name', 'Type', 'Size', 'Empty Weight (lb)', 'Whose', 'Notes', 'Updated']));
  check('TripMeta column 10 is Luggage JSON', TRIP_META_HEADERS[9] === 'Luggage JSON' && /LU_JSON_COL_ = 10/.test(SRC));
  ['luggage', 'lu_bags'].forEach(a => check('GET ' + a + ' is routed', new RegExp("case '" + a + "':").test(WEB)));
  ['lu_bag_save', 'lu_bag_delete', 'lu_move'].forEach(a => check('POST ' + a + ' is routed', new RegExp("case '" + a + "':\\s*return jsonOut_\\(webLu\\w+_\\(body\\)\\)").test(WEB)));
  check('no calendar writes, no sheet IDs', !/CalendarApp|createEvent|openById/.test(SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
