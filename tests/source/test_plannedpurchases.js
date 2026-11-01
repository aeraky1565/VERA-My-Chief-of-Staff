// Planned Purchases (Finances): the comparison, the money, the timing, and what
// "bought" changes elsewhere. PlannedPurchases.js runs in a vm over fake sheets.
// Today is fixed at Nov 1, 2026. Every item, store, card and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PP = fs.readFileSync(path.join(ROOT, 'PlannedPurchases.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const HF = fs.readFileSync(path.join(ROOT, 'HomeFront.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const headers = name => eval(CODE.match(new RegExp('const ' + name + ' *= (\\[[^\\]]*\\]);'))[1]);
function fakeSheet(hdr) {
  const rows = [hdr.slice()];
  return { rows, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
      setValues: vals => vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }) }),
    appendRow: v => rows.push(v.slice()), deleteRow: r => rows.splice(r - 1, 1) };
}
let uuid = 0;
const S = vm.createContext({ console, JSON, Math, Number, String, Array, Date, isFinite, Object,
  TABS: { PLANNED_PURCHASES: 'PP', PP_OPTIONS: 'PPO', FLAGS: 'Flags', CREDIT_CARDS: 'Cards', CARD_PERKS: 'Perks' },
  PLANNED_PURCHASE_HEADERS: headers('PLANNED_PURCHASE_HEADERS'), PP_OPTION_HEADERS: headers('PP_OPTION_HEADERS'), CREDIT_CARD_HEADERS: headers('CREDIT_CARD_HEADERS'),
  Utilities: { getUuid: () => String(++uuid).padEnd(12, 'a') + '-0000', formatDate: () => '2026-11-01' },
  Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log: () => {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } });
S.sheets = { PP: fakeSheet(S.PLANNED_PURCHASE_HEADERS), PPO: fakeSheet(S.PP_OPTION_HEADERS),
  Cards: fakeSheet(S.CREDIT_CARD_HEADERS), Perks: fakeSheet(['ID', 'Card Name', 'Perk']) };
S.sheets.Cards.rows.push(['C1', 'Blue Card', 'Bank A', '1111', 0, 1, '', 'Ahmed', '', 'Yes'], ['C2', 'Old Card', 'Bank B', '2222', 0, 1, '', 'Ahmed', '', 'No'],
  ['C3', 'Green Card', 'Bank C', '3333', 0, 1, '', 'Ahmed', '', 'Yes']);
S.sheets.Perks.rows.push(['P1', 'Old Card', 'Purchase protection'], ['P2', 'Green Card', 'Cell phone protection'], ['P3', 'Blue Card', 'Extended warranty'], ['P4', 'Blue Card', 'Purchase protection']);
S.getSpreadsheet = () => ({ getSheetByName: n => S.sheets[n] || null });
S.ensureSheet = (ss, name) => S.sheets[name];
S.goals = [{ id: 'G-HOME', name: 'Home', currentAmount: 900, targetAmount: 2200, status: 'Active' }, { id: 'G-DONE', name: 'Old', currentAmount: 0, status: 'Achieved' }];
S.getFinancialGoals_ = () => S.goals;
S.goalUpdates = []; S.updateFinancialGoal_ = (id, f) => { S.goalUpdates.push([id, f]); return true; };
S.created = []; S.createFinancialGoal_ = f => { S.created.push(f); return 'G-NEW'; };
S.homeItems = []; S.webAddHomeItem_ = e => { S.homeItems.push(e.parameter); return { ok: true }; };
S.resell = []; S.webAddResellItem_ = e => { S.resell.push(e.parameter); return { ok: true }; };
vm.runInContext(PP, S);
const run = c => vm.runInContext(c, S);
const J = x => JSON.stringify(x);

console.log('\ncleaning');
{
  const p = run('ppClean_({ item: "  Living room   couch ", forWho: "victoria", budget: "$2,200", needBy: "2026-11-26", stage: "Deciding", must: ["Seats 4", "Seats 4", ""], no: "Light linen\\nGlued frame", notes: [{ text: "Sat on A", link: "javascript:x" }] })');
  check('names are tidied, money read from text', p.item === 'Living room couch' && p.budget === 2200, J(p));
  check('who and stage fall back to known values', p.forWho === 'Victoria' && p.stage === 'deciding');
  check('lists drop blanks and repeats; text lists split by line', J(p.must) === '["Seats 4"]' && J(p.no) === '["Light linen","Glued frame"]');
  check('a note keeps only a web link', p.notes[0].text === 'Sat on A' && p.notes[0].link === '');
  check('no budget is null, not zero', run('ppClean_({ item: "x" }).budget') === null);
  check('bought needs a price and a date', run('ppCleanBought_({ price: 10 })') === null && run('ppCleanBought_({ price: 10, orderedOn: "2026-10-14" })').price === 10);
}

console.log('\nthe comparison scores itself');
{
  S.P = run('ppClean_({ item: "Couch", budget: 2200, needBy: "2026-11-26", must: ["Seats 4", "Under 88 in"], nice: ["Chaise", "Deep seats", "Before Thanksgiving"], no: ["Light linen"] })');
  S.A = run('ppCleanOption_({ name: "A", price: 2049, leadDays: 70, delivery: "8–10 wks", checks: { "Seats 4": "yes", "Under 88 in": "yes", "Chaise": "yes", "Deep seats": "yes", "Light linen": "no" } })');
  S.B = run('ppCleanOption_({ name: "B", price: 1780, leadDays: 98, checks: { "Seats 4": "yes", "Under 88 in": "yes", "Chaise": "yes", "Light linen": "no" } })');
  S.C = run('ppCleanOption_({ name: "C", price: 1450, checks: { "Seats 4": "yes", "Under 88 in": "no", "Light linen": "yes" } })');
  S.D = run('ppCleanOption_({ name: "D", price: 900, checks: { "Seats 4": "yes" } })');
  const s = n => run('ppScore_(P, ' + n + ')');
  check('all musts and 2 of 3 nice', s('A').label === 'All musts · 2 of 3 nice' && s('A').ok, s('A').label);
  check('a must ticked no and a No ticked yes are two fails', s('C').fails === 2 && s('C').label === 'Fails 2 musts', s('C').label);
  check('unticked is unknown, not a pass', !s('D').ok && s('D').label === '1 of 2 musts checked', s('D').label);
  check('the best fit: passes everything, then most nice-to-haves', run('ppBest_(P, [B, A, C, D]).name') === 'A');
  S.A2 = Object.assign({}, S.A, { ruledOut: true });
  check('a ruled-out option is never the best', run('ppBest_(P, [A2, B, C]).name') === 'B');
  check('none pass: no best', run('ppBest_(P, [C, D])') === null);
}

console.log('\nprices are kept');
{
  const o1 = run('ppCleanOption_({ name: "A", price: 2049, seen: "2026-10-20" })');
  S.o1 = o1;
  const o2 = run('ppCleanOption_({ name: "A", price: 1989, seen: "2026-10-28" }, o1)');
  check('a new price joins the history; the latest is the price', o2.prices.length === 2 && run('ppPrice_(' + J(o2) + ')') === 1989);
  const o3 = run('ppCleanOption_({ name: "A", price: 2049 }, o1)');
  check('the same price again is not a new entry', o3.prices.length === 1);
}

console.log('\nmoney and timing');
{
  const m = run('ppMoneyLine_(P, { name: "Home", currentAmount: 900 }, "2026-11-01")');
  check('set aside is the goal balance', m.set === 900 && m.left === 1300 && m.pct === 41 && m.goalName === 'Home', J(m));
  check('what a week closes the gap by the need-by date', m.perWeek === Math.ceil(1300 / (25 / 7)), m.perWeek);
  check('no goal: nothing set aside', run('ppMoneyLine_(P, null, "2026-11-01")').set === 0);
  const sm = run('ppSummary_([{ stage: "deciding", budget: 2200, goalId: "G-HOME" }, { stage: "idea", budget: 600, goalId: "G-HOME" }, { stage: "bought", budget: 900, goalId: "G-HOME" }], { "G-HOME": { currentAmount: 900 } })');
  check('two purchases from one goal count its balance once; bought ones are out', sm.inProgress === 2 && sm.setAside === 900 && sm.budgets === 2800, J(sm));
  check('funded when the goal covers the budget', run('ppMoneyLine_(P, { currentAmount: 2500 }, "2026-11-01")').funded === true);
  check('order by: the need-by date less the lead time', run('ppOrderBy_(P, A)') === '2026-09-17' && run('ppOrderBy_(P, D)') === '');
  S.P2 = Object.assign({}, S.P, { needBy: '2027-01-20' });
  const al = run('ppAlerts_(P2, [A, B], "2026-11-01")');
  check('an order-by inside two weeks is said up front', al.length === 1 && /Order A by 2026-11-11 to have it by 2027-01-20/.test(al[0].text) && /Delivery takes 8–10 wks/.test(al[0].text), J(al));
  S.P3 = Object.assign({}, S.P, { needBy: '2027-06-01' });
  check('…not when it is months off', run('ppAlerts_(P3, [A], "2026-11-01")').length === 0);
  S.W = Object.assign({}, S.P, { stage: 'waiting', targetPrice: 299, needBy: '' });
  S.w1 = run('ppCleanOption_({ name: "Watch", price: 349 })');
  check('waiting for a deal: last price against the target', /Waiting for \$299 or less\. Last price: \$349/.test(run('ppAlerts_(W, [w1], "2026-11-01")')[0].text));
  S.w2 = run('ppCleanOption_({ name: "Watch", price: 289 })');
  check('…and says so when it is there', /At or under your \$299 target: \$289/.test(run('ppAlerts_(W, [w2], "2026-11-01")')[0].text));
}

console.log('\nthe card to use');
{
  S.CP = run('ppCardsAndPerks_()');
  check('cards and perks are read, closed cards marked', S.CP.cards.length === 3 && S.CP.cards[1].active === false, J(S.CP.cards));
  const c = run('ppSuggestCard_(CP.perks, CP.cards)');
  check('the active card with purchase protection or an extended warranty', c && c.card === 'Blue Card' && c.why === 'Extended warranty + Purchase protection', J(c));
  check('a closed card is never suggested; phone protection does not count', run('ppSuggestCard_([{card:"Old Card",perk:"Purchase protection"},{card:"Green Card",perk:"Cell phone protection"}], CP.cards)') === null);
}

console.log('\nthe sheet: save, options, bought');
{
  let r = run('webPpSave_({ purchase: { item: "Living room couch", forWho: "Shared", why: "for the living room", budget: 2200, needBy: "2026-11-26", needNote: "Thanksgiving guests", goalId: "G-HOME", must: ["Seats 4"], nice: ["Chaise"], no: ["Light linen"], oldItem: "Couch" } })');
  check('a purchase is created', r.ok && /^PP-/.test(r.purchase.id) && r.purchase.stage === 'researching', J(r));
  S.pid = r.purchase.id;
  r = run('webPpSave_({ purchase: { id: pid, stage: "deciding" } })');
  check('a partial save keeps every other field', r.ok && r.purchase.stage === 'deciding' && r.purchase.budget === 2200 && J(r.purchase.must) === '["Seats 4"]' && r.purchase.oldItem === 'Couch', J(r.purchase));
  check('a name is required', run('webPpSave_({ purchase: { budget: 10 } })').ok === false);
  r = run('webPpSave_({ purchase: { item: "New phone", budget: 1000, needBy: "2027-09-01", forWho: "Ahmed" }, newGoal: true })');
  check('"a new savings goal" makes one and links it', r.purchase.goalId === 'G-NEW' && S.created[0].name === 'New phone' && S.created[0].targetAmount === 1000 && S.created[0].owner === 'Ahmed', J(S.created));
  r = run('webPpNoteAdd_({ id: pid, text: "Sat on A at the showroom." })');
  check('a research note is dated today', r.ok && r.purchase.notes.length === 1 && r.purchase.notes[0].date === '2026-11-01');
  check('…and an empty one is refused', run('webPpNoteAdd_({ id: pid, text: " " })').ok === false);

  r = run('webPpOptionSave_({ option: { purchaseId: pid, name: "Option A", store: "Store One", price: 2049, leadDays: 70, returnDays: 30, checks: { "Seats 4": "yes", "Chaise": "yes", "Light linen": "no" } } })');
  check('an option is added, priced today', r.ok && /^PPO-/.test(r.option.id) && r.option.prices[0].seen === '2026-11-01', J(r.option));
  S.oid = r.option.id;
  r = run('webPpOptionSave_({ option: { id: oid, purchaseId: pid, price: 1989 } })');
  check('a new price keeps the old one and every other field', r.option.prices.length === 2 && r.option.store === 'Store One' && r.option.leadDays === 70 && r.option.checks.Chaise === 'yes', J(r.option));
  check('an option for a purchase that is gone is refused', run('webPpOptionSave_({ option: { purchaseId: "PP-NOPE", name: "x" } })').ok === false);
  const extra = run('webPpOptionSave_({ option: { purchaseId: pid, name: "Option C", price: 1450 } })').option.id;
  check('an option can be deleted', run('webPpOptionDelete_({ id: "' + extra + '" })').ok === true && S.sheets.PPO.rows.length === 2);

  const page = run('webPlannedPurchases_()');
  const couch = page.purchases.filter(p => p.id === S.pid)[0];
  check('the page: options carry their price and score', couch.options[0].price === 1989 && couch.options[0].score.label === 'All musts · 1 of 1 nice', J(couch.options[0]));
  check('…the best one is marked', couch.bestId === S.oid);
  check('…money from the goal', couch.money.set === 900 && couch.money.goalName === 'Home');
  check('…the summary counts each goal once', page.summary.inProgress === 2 && page.summary.setAside === 900 && page.summary.budgets === 3200, J(page.summary));
  check('…open goals to fund from, achieved ones left out', J(page.goals.map(g => g.id)) === '["G-HOME"]');
  check('…active cards and the suggestion', J(page.cards) === '["Blue Card","Green Card"]' && page.suggestedCard.card === 'Blue Card');

  r = run('webPpMarkBought_({ id: pid, bought: { optionId: oid, price: 1989, orderedOn: "2026-11-01", card: "Blue Card", deliveryFrom: "2026-11-20", deliveryTo: "2026-11-24", warrantyYears: 10, warrantyNote: "10-year frame warranty" } })');
  check('bought: saved with the store and return days from the option', r.ok && r.purchase.stage === 'bought' && r.purchase.bought.store === 'Store One' && r.purchase.bought.returnDays === 30, J(r));
  check('…the price comes out of the goal', J(S.goalUpdates) === J([['G-HOME', { currentAmount: 0 }]]), J(S.goalUpdates));
  check('…how much under budget', r.underBudget === 211);
  const hi = S.homeItems[0] || {};
  check('…the warranty goes to Warranties & Service, counted from delivery', hi.item === 'Living room couch' && hi.purchaseDate === '2026-11-24' && hi.warrantyExpiry === '2036-11-24' &&
        /Return window ends 2026-12-24/.test(hi.notes) && /10-year frame warranty/.test(hi.notes), J(hi));
  check('…and it cannot be bought twice', run('webPpMarkBought_({ id: pid, bought: { price: 1, orderedOn: "2026-11-01" } })').ok === false);
  check('bought needs a price and a date', run('webPpMarkBought_({ id: "' + run('webPpSave_({ purchase: { item: "Lamp" } })').purchase.id + '", bought: { price: 10 } })').ok === false);

  r = run('webPpOldPlan_({ id: pid, plan: "resell" })');
  check('the old one to Resell adds it to the Resell list', r.ok && r.purchase.oldPlan === 'resell' && S.resell.length === 1 && S.resell[0].item === 'Old couch', J(S.resell));
  run('webPpOldPlan_({ id: pid, plan: "resell" })');
  check('…once', S.resell.length === 1);
  S.couch = run('ppGet_(pid)');
  const done = run('ppAlerts_(couch, [], "2026-11-01")');
  check('a bought item says its delivery and return window', done.some(a => /Delivery 2026-11-20 to 2026-11-24/.test(a.text)) && done.some(a => /Return window ends 2026-12-24/.test(a.text)) &&
        done.some(a => /old couch: listed in Resell/.test(a.text)), J(done));
  check('delete removes a purchase and its options', run('webPpDelete_({ id: pid })').optionsRemoved === 1);
}

console.log('\nflags and Coming up');
{
  S.bp = run('ppClean_({ id: "PP-1", item: "Couch", stage: "bought", oldItem: "Couch", bought: { price: 1, orderedOn: "2026-10-01", deliveryFrom: "2026-11-02", deliveryTo: "2026-11-03", returnDays: 30 } })');
  S.rp = run('ppClean_({ id: "PP-2", item: "Laptop", stage: "bought", bought: { price: 1, orderedOn: "2026-10-04", returnDays: 30 } })');
  S.op = run('ppClean_({ id: "PP-3", item: "Rug", stage: "deciding", needBy: "2026-11-30", must: [] })');
  S.oo = { 'PP-3': [run('ppCleanOption_({ id: "O", name: "Wool rug", leadDays: 25, delivery: "3–4 wks" })')] };
  const w = run('ppFlagsWanted_([bp, rp, op], oo, "2026-11-01")');
  check('a delivery tomorrow is flagged, with the old item still to plan', w['PPURCH|delivery|PP-1'] && /arrives tomorrow/.test(w['PPURCH|delivery|PP-1'].flag) && /old couch still needs a plan/.test(w['PPURCH|delivery|PP-1'].reason), J(w));
  check('a return window closing in 3 days is flagged', w['PPURCH|return|PP-2'] && /2026-11-03/.test(w['PPURCH|return|PP-2'].reason), J(Object.keys(w)));
  check('an order-by within a week is flagged', w['PPURCH|order|PP-3'] && /Order Rug by 2026-11-05/.test(w['PPURCH|order|PP-3'].flag), J(Object.keys(w)));
  check('nightly step is registered', /nightlyStep_\(ctx, 'ppSyncFlags_', ppSyncFlags_\)/.test(CODE));
  check('Coming up reads deliveries and return windows', /purchases: hfTry_\('purchases', function\(\) \{ return ppComingUp_\(today\); \}, missing\)/.test(HF) &&
        /\(src\.purchases \|\| \[\]\)\.forEach/.test(HF));
}

console.log('\nroutes');
{
  check('GET planned_purchases', /case 'planned_purchases':\s*return jsonOut_\(webPlannedPurchases_\(\)\)/.test(WEB));
  ['pp_save:webPpSave_', 'pp_note_add:webPpNoteAdd_', 'pp_option_save:webPpOptionSave_', 'pp_option_delete:webPpOptionDelete_', 'pp_mark_bought:webPpMarkBought_', 'pp_old_plan:webPpOldPlan_', 'pp_delete:webPpDelete_']
    .forEach(x => { const [a, f] = x.split(':'); check('POST ' + a, new RegExp("case '" + a + "':\\s*return jsonOut_\\(" + f + "\\(body\\)\\)").test(WEB)); });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
