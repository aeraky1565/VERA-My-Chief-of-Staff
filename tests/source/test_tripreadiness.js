// Trip readiness (TripReadiness.js, issue #227 Profiles B): documents, member numbers on
// bookings, seats against preferences, lounge by status, a refill before the trip, health
// notes (cached, one call per country), the briefing lines, the packing add, the route, and
// the prescription-refill flag fix (PatternRecognition.js). Invented people and bookings.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TripReadiness.js'), 'utf8');
const TP = fs.readFileSync(path.join(ROOT, 'TravelerProfiles.js'), 'utf8');
const PR = fs.readFileSync(path.join(ROOT, 'PatternRecognition.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const PRE = fs.readFileSync(path.join(ROOT, 'PreTripBriefing.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

function mkSheet(rows) {
  return { rows, getLastRow: () => rows.length,
    getRange: (r, c, n, w) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(x => { const out = []; for (let i = 0; i < w; i++) out.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return out; }),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })), setValue: v => { rows[r - 1][c - 1] = v; } }),
    appendRow: r => rows.push(r.slice()) };
}

function ctx(o) {
  o = o || {};
  const health = mkSheet([['Key', 'Notes', 'Updated']].concat(o.health || []));
  const packing = mkSheet([['ID', 'Trip Key', 'Person', 'Category', 'Item', 'Checked', 'Source', 'Added Date']].concat(o.packing || []));
  const calls = [];
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error, parseInt,
    TABS: { TRIP_HEALTH_NOTES: 'Trip Health Notes', PACKING_ITEMS: 'PackingItems', TRAVELER_ITEMS: 'Traveler Items' },
    TRIP_HEALTH_NOTE_HEADERS: ['Key', 'Notes', 'Updated'], PACKING_ITEM_HEADERS: new Array(8).fill(''), TRAVELER_ITEM_HEADERS: new Array(13).fill(''),
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x', setProperty: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '2027-03-01' }, Logger: { log: () => {} },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'PackingItems' ? packing : null }), ensureSheet: () => health,
    callClaudeJsonDetailed_: p => { calls.push(p); return o.claude === null ? { json: null, error: 'down' } : { json: o.claude || { vaccines: ['Hepatitis A', 'Typhoid'], phrase: { language: 'Portuguese', text: 'Tenho alergia grave a amendoim.', english: 'I have a serious peanut allergy.' } } }; },
    tripItemsFor_: () => o.itinerary || [], webGetTripDocuments_: () => o.documents || { ok: true, countries: [] },
    getLoungePerkPrograms_: () => o.lounges || [], webGetPrescriptions_: () => ({ prescriptions: o.rx || [] }),
    webAddPackingItem_: e => { packing.rows.push(['PACK-1', e.parameter.tripKey, e.parameter.person, e.parameter.category, e.parameter.item, 'FALSE', 'manual', '']); return { ok: true, id: 'PACK-1' }; } };
  vm.createContext(c); vm.runInContext(TP, c); vm.runInContext(SRC, c);
  c.tpItems_ = () => o.items || [];
  c.__calls = calls; c.__health = health.rows; c.__packing = packing.rows;
  return c;
}

const ITEMS = [
  { person: 'Sam', section: 'membership', kind: 'airline', label: 'United MileagePlus', last4: '4455', tier: 'Premier Gold', value: 'Star Alliance' },
  { person: 'Sam', section: 'membership', kind: 'hotel', label: 'Marriott Bonvoy', last4: '7788' },
  { person: 'Sam', section: 'preference', kind: 'seat', value: 'window' },
  { person: 'Sam', section: 'health', kind: 'medication', label: 'Inhaler', value: 'RX-1' },
  { person: 'Sam', section: 'health', kind: 'allergy', label: 'Peanuts' },
  { person: 'Lee', section: 'membership', kind: 'airline', label: 'Delta SkyMiles', last4: '1100', tier: 'Silver', value: 'SkyTeam' },
  { person: 'Lee', section: 'preference', kind: 'seat', value: 'aisle' },
];
const DOCS = { ok: true, countries: [{ country: 'Portugal', role: 'stay', travelers: [
  { name: 'Sam', passports: [{ passportCountry: 'Canada', use: true, color: 'green', label: 'Visa Free', passport: { status: 'ok' } }] },
  { name: 'Lee', passports: [{ passportCountry: 'Ireland', use: true, color: 'red', label: 'Visa Required', passport: { status: 'ok' } }] }] }] };
const meta = m => JSON.stringify(m);
const ITIN = [
  { type: 'flight', title: 'TP 204 · IAD → LIS', metadata: meta({ traveler: 'Sam', seatAssignment: '23C' }) },
  { type: 'flight', title: 'UA 950 · LIS → EWR', metadata: meta({ traveler: 'Sam', loyaltyNumber: 'XX994455', seatAssignment: '12A' }) },
  { type: 'flight', title: 'DL 80 · LIS → JFK', metadata: meta({ traveler: 'Lee', loyaltyNumber: '22223333', seatAssignment: '30B' }) },
  { type: 'hotel', title: 'Lisbon Marriott', metadata: meta({ traveler: 'Sam' }) },
  { type: 'hotel', title: 'Small guesthouse', metadata: meta({}) }];

console.log('\nthe pieces');
{
  const c = ctx();
  check('an airline from the flight number or the airline name', c.trdAirline_({ title: 'UA 950 · LIS → EWR' }).alliance === 'star' && c.trdAirline_({ title: 'Flight', metadata: meta({ airline: 'Delta Air Lines' }) }).code === 'DL' && c.trdAirline_({ title: 'Ferry' }) === null);
  check('a programme earns on its own airline, and on partners by alliance', c.trdMemberFor_(ITEMS[0], c.trdAirline_({ title: 'UA 1' })) === 'own' && c.trdMemberFor_(ITEMS[0], c.trdAirline_({ title: 'TP 204' })) === 'partner' && c.trdMemberFor_(ITEMS[0], c.trdAirline_({ title: 'DL 80' })) === false);
  check('seats: window, aisle, middle and the row', J(c.trdSeat_('23c')) === J({ row: 23, letter: 'C', kind: 'aisle' }) && c.trdSeat_('12A').kind === 'window' && c.trdSeat_('30B').kind === 'middle' && c.trdSeat_('') === null);
  check('hotel brands', c.trdHotelBrand_('Lisbon Marriott') === 'marriott' && c.trdHotelBrand_('Small guesthouse') === '');
}

console.log('\nreadiness per traveller');
{
  const c = ctx();
  const r = c.trdReadiness_({ items: ITEMS, itinerary: ITIN, documents: DOCS, endDate: '2027-04-10',
    rx: [{ id: 'RX-1', person: 'Sam', medication: 'Inhaler', refillDate: '2027-04-02' }], packing: [] });
  const sam = r.find(p => p.person === 'Sam'), lee = r.find(p => p.person === 'Lee');
  const text = p => p.rows.map(x => x.state + ':' + x.area + ':' + x.text).join('\n');
  check('one entry per person with a profile', J(r.map(p => p.person)) === J(['Sam', 'Lee']));
  check('a visa required blocks the trip, listed first', lee.state === 'blocks' && lee.rows[0].state === 'blocks' && /Portugal: Visa Required on the Ireland passport/.test(lee.rows[0].text), text(lee));
  check('documents in order are ready', /ready:documents:Portugal: documents in order/.test(text(sam)));
  check('a partner flight with no number: “member number missing”', /todo:bookings:Member number missing on TP 204 · IAD → LIS: add your United MileagePlus \(••4455\) number/.test(text(sam)), text(sam));
  check('a flight with the right number is ready', /ready:bookings:UA 950 · LIS → EWR: United MileagePlus number on the booking/.test(text(sam)));
  check('someone else’s number is caught', /todo:bookings:DL 80 · LIS → JFK has number ••3333, not your Delta SkyMiles ••1100/.test(text(lee)));
  check('a hotel of your chain with no number; another hotel is left alone', /todo:bookings:Member number missing on Lisbon Marriott: add your Marriott Bonvoy \(••7788\) number/.test(text(sam)) && !/guesthouse/.test(text(sam)));
  check('seats against preferences: an aisle when you like a window', /todo:seats:Seat 23C on TP 204 · IAD → LIS is an aisle; you prefer window/.test(text(sam)) && /ready:seats:Seat 12A on UA 950/.test(text(sam)));
  check('…a middle when you like an aisle', /todo:seats:Seat 30B on DL 80 · LIS → JFK is a middle; you prefer aisle/.test(text(lee)));
  check('only your own flights count', !/DL 80/.test(text(sam)) && !/UA 950/.test(text(lee)));
  check('lounge by status on an international trip: Star Gold', /ready:lounge:Lounge by status: United MileagePlus Premier Gold \(Star Alliance Gold\)/.test(text(sam)) && !/lounge/.test(text(lee)));
  const rx = sam.rows.find(x => x.area === 'medication');
  check('a refill due before the trip ends, with “Add to packing”', rx && rx.state === 'todo' && /Refill Inhaler before you go \(due 2027-04-02\)/.test(rx.text) && rx.action.kind === 'pack' && rx.action.item === 'Refill Inhaler before leaving' && rx.action.person === 'Sam');
  const r2 = c.trdReadiness_({ items: ITEMS, itinerary: [], documents: null, endDate: '2027-04-10', rx: [{ id: 'RX-1', medication: 'Inhaler', refillDate: '2027-04-02' }], packing: [{ item: 'Refill Inhaler before leaving' }] });
  check('once it’s on the packing list, it’s ready', r2[0].rows.some(x => x.area === 'medication' && x.state === 'ready'));
  check('a refill after the trip isn’t mentioned', !c.trdReadiness_({ items: ITEMS, itinerary: [], endDate: '2027-04-10', rx: [{ id: 'RX-1', medication: 'Inhaler', refillDate: '2027-05-02' }] })[0].rows.some(x => x.area === 'medication'));
  check('no lounge line for a domestic trip', !c.trdReadiness_({ items: ITEMS, itinerary: ITIN, documents: { countries: [] }, endDate: '2027-04-10' })[0].rows.some(x => x.area === 'lounge'));
  check('rows run blocks, then to do, then ready', [sam, lee].every(p => p.rows.every((x, i) => !i || ({ blocks: 0, todo: 1, ready: 2 })[p.rows[i - 1].state] <= ({ blocks: 0, todo: 1, ready: 2 })[x.state])) && sam.rows[0].state === 'todo');
  check('the state is the worst row', sam.state === 'todo' && c.trdReadiness_({ items: [ITEMS[2]], itinerary: [ITIN[1]], endDate: 'x' })[0].state === 'ready');
}

console.log('\nhealth notes');
{
  const c = ctx();
  check('allergies and diets from every profile, once each', J(c.trdAllergies_(ITEMS.concat([{ person: 'Lee', section: 'health', kind: 'allergy', label: 'peanuts' }]))) === J(['Peanuts']));
  const h = c.trdHealthFor_('Portugal', ['Peanuts']);
  check('one call per country: vaccines and the allergy phrase', c.__calls.length === 1 && /Portugal/.test(c.__calls[0]) && /Peanuts/.test(c.__calls[0]) && h.vaccines[0] === 'Hepatitis A' && h.phrase.language === 'Portuguese' && h.saved === false);
  const again = c.trdHealthFor_('Portugal', ['Peanuts']);
  check('kept: the same country again asks nothing', c.__calls.length === 1 && again.saved === true && again.phrase.text === 'Tenho alergia grave a amendoim.');
  check('different allergies ask again', (c.trdHealthFor_('Portugal', []), c.__calls.length === 2) && /null/.test(c.__calls[1]));
  const down = ctx({ claude: null });
  check('Claude down: nothing saved, nothing shown', down.trdHealthFor_('Portugal', []) === null && down.__health.length === 1);
  check('the answer is cleaned: at most 6 short vaccines, a phrase needs text', c.trdCleanHealth_({ vaccines: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], phrase: { language: 'x' } }).vaccines.length === 6 && c.trdCleanHealth_({ phrase: { language: 'x' } }).phrase === null);
}

console.log('\nthe briefing');
{
  const c = ctx();
  const r = c.trdReadiness_({ items: ITEMS, itinerary: ITIN, documents: DOCS, endDate: '2027-04-10', rx: [] });
  const lines = c.trdBriefLines_(r, [{ country: 'Portugal', vaccines: ['Hepatitis A'], phrase: { language: 'Portuguese', text: 'Tenho alergia.' } }], ['Lounge by card: Priority Pass (Travel Card)']);
  check('what blocks or is to do, by person; ready rows left out', lines.some(l => /^• Lee \(blocks the trip\): Portugal: Visa Required/.test(l)) && lines.some(l => /^• Sam: Member number missing/.test(l)) && !lines.some(l => /documents in order/.test(l)));
  check('cards, vaccines and the allergy phrase', lines.some(l => /Priority Pass/.test(l)) && lines.some(l => /Portugal vaccines to ask your doctor about: Hepatitis A/.test(l)) && lines.some(l => /Allergy phrase \(Portuguese\): “Tenho alergia\.”/.test(l)));
  check('the pre-trip briefing carries a READINESS section, guarded', /var readinessSection = typeof trdBriefSection_ === 'function' \? trdBriefSection_\(trip\.tripKey, startDateStr, endDateStr\) : '';/.test(PRE) && /packSection, readinessSection, actionSection/.test(PRE));
}

console.log('\nthe routes');
{
  const c = ctx({ items: ITEMS, itinerary: ITIN, documents: DOCS, lounges: [{ program: 'Priority Pass', card: 'Travel Card' }, { program: 'Priority Pass', card: 'Other Card' }], rx: [{ id: 'RX-1', person: 'Sam', medication: 'Inhaler', refillDate: '2027-04-02' }] });
  const r = c.webTripReadiness_({ tripKey: '2027-04-01|Lisbon', startDate: '2027-04-01', endDate: '2027-04-10' });
  check('readiness: people, card lounges once each, health for stays', r.ok && r.people.length === 2 && J(r.cards) === J(['Lounge by card: Priority Pass (Travel Card)']) && r.health.length === 1 && r.health[0].country === 'Portugal');
  check('health=0 skips the notes', c.webTripReadiness_({ tripKey: 'k', startDate: '2027-04-01', endDate: '2027-04-10', health: '0' }).health.length === 0);
  check('no profiles yet: empty', J(ctx().webTripReadiness_({ tripKey: 'k' })) === J({ ok: true, people: [], cards: [], health: [], empty: true }));
  check('needs a trip', c.webTripReadiness_({}).ok === false);
  const p = c.webTripReadinessPack_({ tripKey: 'k', person: 'Sam', item: 'Refill Inhaler before leaving' });
  check('Add to packing: a Health item marked as from the profile', p.ok && c.__packing[1][3] === 'Health' && c.__packing[1][4] === 'Refill Inhaler before leaving' && c.__packing[1][6] === 'profile');
  check('…and only once', c.webTripReadinessPack_({ tripKey: 'k', person: 'Sam', item: 'refill inhaler before leaving' }).already === true && c.__packing.length === 2);
  check('wired: the routes and the Trip Health Notes tab', /case 'trip_readiness':\s+return jsonOut_\(webTripReadiness_\(e\.parameter\)\)/.test(WEB) && /case 'trip_readiness_pack':\s+return jsonOut_\(webTripReadinessPack_\(body\)\)/.test(WEB) && /TRIP_HEALTH_NOTES:\s+'Trip Health Notes'/.test(CODE));
  check('nothing here touches ARIA’s sheet', !/ARIA|aria/.test(SRC.replace(/^\/\/.*$/gm, '')));
}

console.log('\nthe prescription refill flag');
{
  const c = { String, Number, Object, Array, Math, JSON, RegExp, Date };
  vm.createContext(c); vm.runInContext(PR.replace(/^function (buildCrossDomainSnapshot_|checkCrossPatternFlags_)[\s\S]*?^}\n/gm, ''), c);
  c.snap = { prescriptionsDueSoon: [{ person: 'Sam', medication: 'Inhaler', daysLeft: 2 }, { person: 'Lee', medication: 'Eye drops', daysLeft: 6 }] };
  const out = vm.runInContext('evaluateCrossPatterns_(snap)', c).filter(x => /cross_rx_refill/.test(x.key));
  check('names the person and the days, no “undefined”', out.length === 2 && /^Sam’s Rx for Inhaler refill due in 2 days$/.test(out[0].flag) && !/undefined/.test(JSON.stringify(out)), JSON.stringify(out));
  check('2 days out is High, 6 is Medium', out[0].urgency === 'High' && out[1].urgency === 'Medium');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
