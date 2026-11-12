// Travel › Gifts (issue #227), the server side in TripGifts.js: kind, status and
// packing on each gift (old rows read their status from Purchased), the budget,
// "given before" and the repeat warning, getting it home, ideas per place, the
// endpoints against an in-memory sheet, and the Chat action. Invented gifts.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TripGifts.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const CHAT = fs.readFileSync(path.join(ROOT, 'Chat.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const HEADERS = (CODE.match(/const TRIP_GIFT_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1];
const BUDGET_HEADERS = (CODE.match(/const TRIP_BUDGET_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1];
const IDEA_HEADERS = (CODE.match(/const GIFT_PLACE_IDEAS_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1];

// ---- an in-memory spreadsheet --------------------------------------------------
function makeSheet(name, rows) {
  const s = { name, rows: rows.map(r => r.slice()) };
  s.getLastRow = () => s.rows.length;
  s.getRange = (r, c, n, w) => ({
    getValues: () => s.rows.slice(r - 1, r - 1 + (n || 1)).map(x => { const out = []; for (let i = 0; i < (w || 1); i++) out.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return out; }),
    setValues: v => v.forEach((row, i) => { const t = s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; row.forEach((x, j) => { t[c - 1 + j] = x; }); }),
    setValue: v => { const t = s.rows[r - 1] = s.rows[r - 1] || []; t[c - 1] = v; },
  });
  s.appendRow = row => { s.rows.push(row.slice()); };
  s.deleteRow = r => { s.rows.splice(r - 1, 1); };
  return s;
}

function ctx(o) {
  o = o || {};
  const sheets = {};
  const H = eval(HEADERS), BH = eval(BUDGET_HEADERS), IH = eval(IDEA_HEADERS);
  sheets['Trip Gifts'] = makeSheet('Trip Gifts', [o.oldHeaders ? H.slice(0, 7) : H].concat(o.gifts || []));
  sheets['Trip Budget'] = makeSheet('Trip Budget', [BH].concat(o.budget || []));
  if (o.ideas) sheets['Gift Place Ideas'] = makeSheet('Gift Place Ideas', [IH].concat(o.ideas));
  const calls = [];
  const c = {
    String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error,
    Logger: { log: () => {} },
    TABS: { TRIP_GIFTS: 'Trip Gifts', TRIP_BUDGET: 'Trip Budget', GIFT_PLACE_IDEAS: 'Gift Place Ideas' },
    TRIP_GIFT_HEADERS: H, TRIP_BUDGET_HEADERS: BH, GIFT_PLACE_IDEAS_HEADERS: IH,
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: () => o.today || '2027-06-15' },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, n, h) => sheets[n] || (sheets[n] = makeSheet(n, [h])),
    tripKeysFor_: k => [k].concat((o.alias || {})[k] || []),
    tripRowMatches_: (cell, keys) => keys.indexOf(String(cell).trim()) !== -1,
    tripKeyForWrite_: k => k,
    getConfigValues: () => ({ home_country: o.home || 'United States' }),
    webGetTripMeta_: () => ({ tripTravellers: o.travellers || 2 }),
    readTripRegistry_: () => ({ rows: o.registry || [] }),
    callClaudeJsonDetailed_: p => { calls.push(p); return o.claude === null ? { json: null, error: 'down' } : { json: o.claude || { ideas: [] } }; },
  };
  vm.createContext(c);
  vm.runInContext(SRC, c);
  c.__sheets = sheets; c.__calls = calls;
  return c;
}

const T = '2027-06-12|Lisbon & Porto', OLD = '2025-06-01|Crete', OLDER = '2024-04-02|Japan';
const row = (id, trip, who, item, amount, purchased, kind, status, packs) => [id, trip, who, item, amount, purchased, '', kind || '', status || '', packs || ''];

console.log('\nthe sheet');
{
  const H = eval(HEADERS);
  check('three columns appended after the original seven', H.slice(0, 7).join() === 'ID,Trip Key,Recipient,Item,Amount,Purchased,Notes' && H.slice(7).join() === 'Kind,Status,Packs As,Trip ID');
  check('the ideas tab is declared', /GIFT_PLACE_IDEAS:\s*'Gift Place Ideas'/.test(CODE) && eval(IDEA_HEADERS).join() === 'Place,Ideas,Updated');
  const c = ctx({ oldHeaders: true, gifts: [['G1', T, 'Dad', 'Cork wallet', 28, 'Yes', '']] });
  c.webAddTripGift_({ parameter: { tripKey: T, item: 'Tiles', recipient: 'Mom' } });
  check('an older tab gets the new headers on first write', c.__sheets['Trip Gifts'].rows[0].join() === H.join(), c.__sheets['Trip Gifts'].rows[0].join());
}

console.log('\nkind, status, packing');
{
  const c = ctx();
  check('an old row reads its status from Purchased', c.tgStatusOf_('', 'Yes') === 'Bought' && c.tgStatusOf_('', 'No') === 'To buy' && c.tgStatusOf_('', '') === 'To buy');
  check('a Status cell wins, any case', c.tgStatusOf_('packed', 'No') === 'Packed' && c.tgStatusOf_('To Buy', 'Yes') === 'To buy');
  check('unknown kind is a souvenir; unknown packing is none', c.tgKindOf_('') === 'souvenir' && c.tgKindOf_('HOST') === 'host' && c.tgPacksOf_('x') === 'none');
  const g = c.tgRowToGift_(row('G1', T, 'Dad', 'Cork wallet', '28', 'Yes'));
  check('a row reads as a gift, keeping purchased for older readers', g.status === 'Bought' && g.purchased === true && g.amount === 28 && g.kind === 'souvenir', J(g));
  check('amounts: blank is none, "$1,250.5" is 1250.5', c.tgAmount_('') === null && c.tgAmount_('$1,250.5') === 1250.5 && c.tgAmount_('abc') === null);
}

console.log('\nthe budget');
{
  const c = ctx();
  const gifts = [{ amount: 34, status: 'Packed' }, { amount: 18, status: 'Bought' }, { amount: 30, status: 'To buy' }, { amount: null, status: 'To buy' }];
  check('bought counts packed too; planned is still to buy', J(c.tgBudget_(300, gifts)) === J({ budget: 300, bought: 52, planned: 30, left: 218 }), J(c.tgBudget_(300, gifts)));
  check('no budget set: no left', c.tgBudget_(null, gifts).left === null && c.tgBudget_('', gifts).budget === null);
}

console.log('\ngiven before');
{
  const c = ctx();
  const gifts = [
    { id: '1', tripKey: OLD, recipient: 'Mom', item: 'Tile coasters', status: 'Bought', kind: 'souvenir' },
    { id: '2', tripKey: OLDER, recipient: 'mom ', item: 'Silk scarf', status: 'Packed', kind: 'souvenir' },
    { id: '3', tripKey: T, recipient: 'Mom', item: 'Azulejo tiles', status: 'To buy', kind: 'souvenir' },
    { id: '4', tripKey: T, recipient: 'Us', item: 'Port', status: 'Bought', kind: 'us' },
    { id: '5', tripKey: OLD, recipient: 'Dad', item: 'Olive oil', status: 'Bought', kind: 'souvenir' },
    { id: '6', tripKey: T, recipient: '', item: 'Magnet', status: 'Bought', kind: 'souvenir' },
  ];
  const h = c.tgHistory_(gifts, c.tgLabelOf_);
  check('grouped by name ignoring case and spaces, A–Z', h.map(p => p.name).join() === 'Dad,Mom', J(h));
  check('only bought gifts; "us" and blank names left out', h[1].gifts.length === 2 && !J(h).includes('Port') && !J(h).includes('Magnet'));
  check('newest trip first, with trip name and year', h[1].gifts[0].trip === 'Crete' && h[1].gifts[0].year === '2025' && h[1].gifts[1].trip === 'Japan');
  const rep = c.tgRepeats_(h, 'MOM', 'Azulejo tile coasters', T);
  check('a repeat: same name, a shared word ("tile")', rep.length === 1 && rep[0].item === 'Tile coasters', J(rep));
  check('plural and singular match ("tiles" ~ "tile")', c.tgRepeats_(h, 'Mom', 'Painted tiles', T).length === 1);
  check('no repeat for a different thing', c.tgRepeats_(h, 'Mom', 'Cork wallet', T).length === 0);
  check('no repeat for someone else', c.tgRepeats_(h, 'Sam', 'Tile coasters', T).length === 0);
  check('filler words don’t match ("gift box")', c.tgRepeats_([{ name: 'Mom', gifts: [{ item: 'Gift box of tea', tripKey: OLD }] }], 'Mom', 'Gift box of soap', T).length === 0);
  check('the same trip doesn’t warn against itself', c.tgRepeats_([{ name: 'Mom', gifts: [{ item: 'Tile coasters', tripKey: T }] }], 'Mom', 'Tile coasters', T).length === 0);
}

console.log('\ngetting it home');
{
  const c = ctx();
  const gifts = [
    { item: 'Port, 10-year tawny', kind: 'souvenir', status: 'To buy', amount: 25, packsAs: 'none' },
    { item: 'Port, 20-year tawny', kind: 'us', status: 'Bought', amount: 45, packsAs: 'liquid' },
    { item: 'Ginjinha', kind: 'souvenir', status: 'Bought', amount: 15, packsAs: 'none' },
    { item: 'Tinned sardines', kind: 'souvenir', status: 'Bought', amount: 22, packsAs: 'none' },
    { item: 'Azulejo tiles', kind: 'souvenir', status: 'Bought', amount: 30, packsAs: 'fragile' },
    { item: 'Cured ham', kind: 'us', status: 'To buy', amount: 40, packsAs: 'food' },
    { item: 'Maple syrup', kind: 'host', status: 'Packed', amount: 34, packsAs: 'liquid' },
  ];
  const r = c.tgHomeCheck_(gifts, 'United States', 2);
  const kinds = r.rules.map(x => x.kind + ':' + x.title).join(' | ');
  check('host gifts leave with you, so they aren’t counted coming back', !kinds.includes('Maple'), kinds);
  check('liquids (chosen or read from the name) go in the checked bag', /checkin:Port, 10-year tawny, Port, 20-year tawny, Ginjinha/.test(kinds), kinds);
  check('fragile is counted', r.counts.fragile === 1 && /checkin:1 fragile/.test(kinds));
  check('3 bottles ≈ 2.25 L against 2 L for two: declare the rest', /declare:Alcohol: about 2.25 L/.test(kinds), kinds);
  check('two bottles for two people is fine', c.tgHomeCheck_(gifts.slice(0, 2), 'United States', 2).rules.some(x => x.kind === 'ok' && /1.5 L/.test(x.title)));
  check('food is declared', /declare:Tinned sardines/.test(kinds), kinds);
  check('meat can’t come in, and isn’t also listed as food', /avoid:Cured ham/.test(kinds) && !/declare:[^|]*ham/.test(kinds), kinds);
  check('the declare total is bought gifts coming back, against $800 each', r.declare.total === 112 && r.declare.allowance === 1600, J(r.declare));
  const eu = c.tgHomeCheck_(gifts, 'Portugal', 2);
  check('outside the US only the packing rules apply', eu.us === false && eu.declare === null && eu.rules.every(x => x.kind === 'checkin'), J(eu.rules));
}

console.log('\nideas for a place');
{
  const c = ctx();
  const ideas = c.tgCleanIdeas_({ ideas: [{ item: 'Port wine', kind: 'souvenir', packsAs: 'liquid', note: 'From the Douro' }, { item: 'Chorizo', packsAs: 'food' },
    { item: 'port wine' }, { item: '' }, { item: 'Cork goods', kind: 'weird', packsAs: 'odd' }] }, true);
  check('cleaned: no meat for a US home, no duplicates or blanks, unknown kind and packing fixed',
    J(ideas.map(i => i.item + '/' + i.kind + '/' + i.packsAs)) === J(['Port wine/souvenir/liquid', 'Cork goods/souvenir/none']), J(ideas));
  check('at most 10', c.tgCleanIdeas_(Array.from({ length: 15 }, (_, i) => ({ item: 'x' + i })), false).length === 10);
  check('the place is the trip’s name, without its date', c.tgPlaceKey_(T) === 'lisbon & porto' && c.tgPlaceKey_('  Kyoto ') === 'kyoto');
}

console.log('\nthe endpoints');
{
  const c = ctx({ gifts: [row('G1', T, 'Dad', 'Cork wallet', 28, 'Yes'), row('G2', T, 'Mom', 'Tiles', 30, 'No', 'souvenir', 'To buy', 'fragile'), row('G3', OLD, 'Mom', 'Tile coasters', 20, 'Yes')],
    budget: [['B1', T, 'Gifts', 'Gifts', 300, '', ''], ['B2', T, 'Hotels', 'x', 900, '', '']] });
  let r = c.webGetTripGifts_({ parameter: { tripKey: T } });
  check('get: this trip’s gifts only, with kind, status and packing', r.gifts.map(g => g.id + g.status).join() === 'G1Bought,G2To buy' && r.gifts[1].packsAs === 'fragile');
  check('get: the budget from the trip’s Gifts line', r.budget.budget === 300 && r.budget.bought === 28 && r.budget.planned === 30 && r.budget.left === 242, J(r.budget));
  check('get: the getting-home check comes with it', r.home && r.home.us === true && r.home.counts.fragile === 1);
  c.webAddTripGift_({ parameter: { tripKey: T, item: 'Maple syrup', recipient: 'Ana', amount: '34', kind: 'host', status: 'Packed', packsAs: 'liquid' } });
  const added = c.__sheets['Trip Gifts'].rows.slice(-1)[0];
  check('add: kind, status and packing written, Purchased kept in step', added.slice(2).join('|') === 'Ana|Maple syrup|34|Yes||host|Packed|liquid', added.join('|'));
  c.webUpdateTripGift_({ parameter: { id: 'G2', status: 'Packed' } });
  let g2 = c.__sheets['Trip Gifts'].rows.find(x => x[0] === 'G2');
  check('update: status moves Purchased with it', g2[8] === 'Packed' && g2[5] === 'Yes');
  c.webUpdateTripGift_({ parameter: { id: 'G2', purchased: 'false' } });
  g2 = c.__sheets['Trip Gifts'].rows.find(x => x[0] === 'G2');
  check('update: the old purchased flag still works', g2[8] === 'To buy' && g2[5] === 'No');
  check('update: unknown id', c.webUpdateTripGift_({ parameter: { id: 'nope', status: 'Bought' } }).ok === false);
  c.webSetTripGiftBudget_({ parameter: { tripKey: T, budget: '350' } });
  check('budget: updates the Gifts line, leaves others', c.__sheets['Trip Budget'].rows[1][4] === 350 && c.__sheets['Trip Budget'].rows[2][4] === 900);
  c.webSetTripGiftBudget_({ parameter: { tripKey: OLD, budget: '120' } });
  const nb = c.__sheets['Trip Budget'].rows.slice(-1)[0];
  check('budget: a trip without one gets a Gifts line', nb[1] === OLD && nb[2] === 'Gifts' && nb[4] === 120, nb.join('|'));
  const before = c.__sheets['Trip Budget'].rows.length;
  c.webSetTripGiftBudget_({ parameter: { tripKey: OLDER, budget: '' } });
  check('budget: clearing one that doesn’t exist adds nothing', c.__sheets['Trip Budget'].rows.length === before);
  r = c.webTripGiftCheck_({ parameter: { recipient: 'mom', item: 'tile coasters', tripKey: T } });
  check('check: warns about Mom’s coasters from Crete', r.repeats.length === 1 && r.repeats[0].trip === 'Crete', J(r));
  const hist = c.webTripGiftHistory_().people;
  check('history: by name', hist.map(p => p.name).join() === 'Ana,Dad,Mom', J(hist.map(p => p.name)));
  c.webDeleteTripGift_({ parameter: { id: 'G1' } });
  check('delete removes the row', !c.__sheets['Trip Gifts'].rows.some(x => x[0] === 'G1'));
}

console.log('\nideas: asked once per place');
{
  const c = ctx({ claude: { ideas: [{ item: 'Port wine', packsAs: 'liquid' }, { item: 'Salami' }] } });
  let r = c.webTripGiftIdeas_({ parameter: { tripKey: T } });
  check('first time: asks Claude, saves, no meat', r.saved === false && r.ideas.map(i => i.item).join() === 'Port wine' && c.__calls.length === 1 && /no meat/.test(c.__calls[0]));
  r = c.webTripGiftIdeas_({ parameter: { tripKey: '2029-01-01|Lisbon & Porto' } });
  check('the same place again: from the sheet, no second call', r.saved === true && c.__calls.length === 1 && r.ideas[0].item === 'Port wine');
  c.webTripGiftIdeas_({ parameter: { tripKey: T, refresh: '1' } });
  check('refresh asks again and replaces the row', c.__calls.length === 2 && c.__sheets['Gift Place Ideas'].rows.length === 2);
  const down = ctx({ claude: null });
  check('Claude down: a plain error, nothing saved', down.webTripGiftIdeas_({ parameter: { tripKey: T } }).ok === false && !down.__sheets['Gift Place Ideas'].rows.slice(1).length);
}

console.log('\nChat: gift_bought');
{
  const reg = [{ status: 'active', startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' }, { status: 'active', startDate: '2025-06-01', endDate: '2025-06-08', label: 'Crete' }];
  let c = ctx({ registry: reg, today: '2027-06-15', gifts: [row('G2', T, 'Mom', 'Azulejo tile coasters', 30, 'No', 'souvenir', 'To buy')] });
  check('the trip under way is the one', c.tgChatTrip_([{ key: 'a', startDate: '2027-06-12', endDate: '2027-06-22' }], '2027-06-15').key === 'a');
  check('a trip ended 5 days ago still counts; 9 days doesn’t', c.tgChatTrip_([{ key: 'b', startDate: '2027-06-01', endDate: '2027-06-10' }], '2027-06-15').key === 'b'
    && c.tgChatTrip_([{ key: 'b', startDate: '2027-06-01', endDate: '2027-06-06' }], '2027-06-15') === null);
  let msg = c.tgChatBought_('tile coasters', 'mom', '27');
  let g2 = c.__sheets['Trip Gifts'].rows.find(x => x[0] === 'G2');
  check('a match on the list is ticked off, with the amount', /ticked off/.test(msg) && g2[8] === 'Bought' && g2[4] === 27, msg + ' ' + g2.join('|'));
  msg = c.tgChatBought_('Cork wallet', 'Dad', '');
  const last = c.__sheets['Trip Gifts'].rows.slice(-1)[0];
  check('no match: added as a bought souvenir on that trip', /added/.test(msg) && last[1] === T && last[3] === 'Cork wallet' && last[8] === 'Bought' && last[7] === 'souvenir', last.join('|'));
  c = ctx({ registry: reg, today: '2027-03-01' });
  let err = ''; try { c.tgChatBought_('Tea', 'Sam', ''); } catch (e) { err = e.message; }
  check('no trip under way: says so, adds nothing', /no trip under way/.test(err) && c.__sheets['Trip Gifts'].rows.length === 1, err);
  check('Chat knows the action and runs it', /ACTION:gift_bought\|\{item\}\|/.test(CHAT) && /type === 'gift_bought'\) \{\s*try \{ executed\.push\(tgChatBought_\(args\[0\], args\[1\], args\[2\]\)\); \}/.test(CHAT));
}

console.log('\nroutes');
['get_trip_gifts:webGetTripGifts_(e)', 'add_trip_gift:webAddTripGift_(e)', 'update_trip_gift:webUpdateTripGift_(e)', 'delete_trip_gift:webDeleteTripGift_(e)',
 'set_trip_gift_budget:webSetTripGiftBudget_(e)', 'trip_gift_history:webTripGiftHistory_()', 'trip_gift_check:webTripGiftCheck_(e)', 'trip_gift_ideas:webTripGiftIdeas_(e)']
  .forEach(x => { const [a, f] = x.split(':'); check(a + ' is routed', new RegExp("case '" + a + "':\\s*return jsonOut_\\(" + f.replace(/[()]/g, '\\$&') + '\\)').test(WEB)); });
check('the old copies are gone from WebApp.js', !/^function webGetTripGifts_\(/m.test(WEB) && !/^function webAddTripGift_\(/m.test(WEB));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
