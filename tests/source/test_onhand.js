// Meal Plan "on hand" (OnHand.js, with MealPlan.js, Pantry.js and the WebApp/Code wiring):
// on hand fills itself from this week's food purchases, keeps what you add, carries last
// week's over once, and marks what a past dinner used; Suggest plans only open days
// around on hand and the week; What can I make matches recipes; the nightly flags.
// Over fake sheets and a stubbed Claude. Every item, trip and date here is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const OH = read('OnHand.js'), MP = read('MealPlan.js'), PAN = read('Pantry.js'), TI = read('TripIdeas.js'), TRP = read('Trips.js'), CODE = read('Code.js'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) + '\n'; }
  }
  throw new Error('unbalanced: ' + name);
}
const constLine = (src, name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];')); return m ? m[0].replace(/^const/, 'var') + '\n' : ''; };

// ---- fake sheets: row 1 is the header ----------------------------------------------
function fakeSheet(headers, rows) {
  const sh = { rows: [headers.slice()].concat(rows || []) };
  sh.getLastRow = () => sh.rows.length;
  sh.getRange = (r, c, nr, nc) => ({
    getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (x, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return out; },
    setValues: v => { v.forEach((row, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((x, j) => { sh.rows[r - 1 + i][c - 1 + j] = x; }); }); },
    setValue: v => { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = v; },
    getValue: () => (sh.rows[r - 1] || [])[c - 1],
  });
  sh.appendRow = v => sh.rows.push(v.slice());
  sh.deleteRow = r => sh.rows.splice(r - 1, 1);
  return sh;
}

const TODAY = '2026-10-28';          // a Wednesday
const WS = '2026-10-26', PREV = '2026-10-19';
let uuid = 0;
const S = vm.createContext({ console, Math, JSON, Date, Object, String, Number, Array, isNaN, isFinite, parseInt, Error,
  Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: {
    formatDate: (d, tz, pat) => { if (!(d instanceof Date) || isNaN(d)) return ''; const iso = Math.abs(Date.now() - d.getTime()) < 5000 ? S.__today : d.toISOString().slice(0, 10);
      return pat === 'yyyyMMddHHmmss' ? iso.replace(/-/g, '') + '120000' : iso; },
    getUuid: () => String(++uuid).padStart(12, '0') + '-0000-0000-0000-000000000000',   // tiMintId_ keeps the first 12
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
});
S.__today = TODAY;
vm.runInContext(constLine(CODE, 'ON_HAND_HEADERS') + constLine(CODE, 'MEAL_PLAN_HEADERS') + constLine(CODE, 'PURCHASE_HISTORY_HEADERS') + constLine(CODE, 'RECIPE_HEADERS') + constLine(CODE, 'FLAG_HEADERS'), S);
vm.runInContext("var TABS = { ON_HAND: 'On Hand', MEAL_PLAN: 'Meal Plan', PURCHASE_HISTORY: 'Purchase History', RECIPES: 'Recipes', FLAGS: 'Flags' };", S);
vm.runInContext(MP.match(/var MEAL_PLAN_DAYS_[^\n]*\n/)[0] + MP.match(/var MP_COL_[^\n]*\n/)[0], S);
vm.runInContext(PAN.match(/var PANTRY_AISLES_ = \[[\s\S]*?\]\];\n/)[0], S);
[[TI, ['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_']], [TRP, ['dateCellToIso_']],
 [PAN, ['normalizeItemName_', 'pantryAisle_', 'getPurchaseHistorySheet_']],
 [MP, ['generateId_', 'addWeeksToStart_', 'dayDateForWeek_', '_readMealPlanRows_', 'getMealPlanWeek_', 'getMealPlanHistory_', 'upsertMealPlanEntry_', 'mpSetExtras_']],
 [CODE, ['upsertKeyedFlags_']]].forEach(([src, names]) => names.forEach(n => vm.runInContext(extract(src, n), S)));
vm.runInContext(OH, S);
S.getCurrentWeekStart_ = () => WS;
S.ensureSheet = (ss, name, headers) => S.sheets[name] || (S.sheets[name] = fakeSheet(headers, []));
const run = code => vm.runInContext(code, S);
const err = code => { try { run(code); return ''; } catch (e) { return e.message; } };

const PH = (id, item, date, store, src, cat) => [id, item, item.toLowerCase(), cat || 'Other', date, '', '', store, '', src, ''];
const meal = (day, date, name, uses, status, rating) => ['MP-' + day, WS, day, date, name, name ? 'Home Cooked' : '', status || 'Planned', '', (uses || []).join(','), rating || ''];
function fresh(opts) {
  opts = opts || {};
  S.sheets = {
    'On Hand': fakeSheet(vm.runInContext('ON_HAND_HEADERS', S), opts.onHand || []),
    'Meal Plan': fakeSheet(vm.runInContext('MEAL_PLAN_HEADERS', S), opts.meals || []),
    'Purchase History': fakeSheet(vm.runInContext('PURCHASE_HISTORY_HEADERS', S), opts.hist || []),
    'Recipes': fakeSheet(vm.runInContext('RECIPE_HEADERS', S), opts.recipes || []),
    'Flags': fakeSheet(vm.runInContext('FLAG_HEADERS', S), []),
  };
  S.getSpreadsheet = () => ({ getSheetByName: n => S.sheets[n] || null });
}
const ohRows = () => S.sheets['On Hand'].rows.slice(1);

console.log('\non hand fills itself from this week\'s food purchases');
fresh({ hist: [
  PH('PH-1', 'Cabbage', '2026-10-25', 'Costco', 'checkout'),                       // Sunday: last week
  PH('PH-2', 'Potatoes', '2026-10-26', 'Costco', 'checkout', 'Produce'),
  PH('PH-3', 'Spinach', '2026-10-27', 'Costco', 'receipt', 'Produce'),
  PH('PH-4', 'Paper towels', '2026-10-27', 'Costco', 'checkout'),                  // old rows say Other; the aisle says Household
  PH('PH-5', 'Batteries', '2026-10-27', 'Costco', 'receipt', 'Household'),
  PH('PH-6', 'Rice', '2026-10-27', 'Kroger', 'manual'),                             // not a shop
  PH('PH-7', 'Potatoes', '2026-10-27', 'Kroger', 'receipt', 'Produce'),             // same food again
  PH('PH-8', 'Feta', '2026-11-02', 'Costco', 'checkout')] });                       // next week
let items = run('ohWeek_("' + WS + '")');
const names = items.map(x => x.item).join();
check('this week\'s check-offs and receipt picks, food only, once each', names === 'Potatoes,Spinach', names);
check('…each says where it came from', items[0].note === 'checked off · Costco, Mon' && items[1].note === 'receipt · Costco, Tue' && items[0].source === 'checkout' && items[1].source === 'receipt', JSON.stringify(items));
check('…perishables start as use soon', items[1].useSoon === true && items[0].useSoon === false);
check('…the purchase it came from is kept', ohRows()[0][5] === 'PH-2' && ohRows()[0][7] === 'on hand');
const n1 = ohRows().length;
run('ohWeek_("' + WS + '")');
check('a second look adds nothing', ohRows().length === n1);
S.sheets['Purchase History'].rows = S.sheets['Purchase History'].rows.filter(r => r[0] !== 'PH-3');
items = run('ohWeek_("' + WS + '")');
check('an untick in Shopping takes its chip away', !items.some(x => x.item === 'Spinach') && !ohRows().some(r => r[5] === 'PH-3'), items.map(x => x.item).join());

console.log('\nadded by hand, kept, removed');
let r = run('webOnHandAdd_({ parameter: { weekStart: "' + WS + '", item: "  Half a chicken ", useSoon: "true" } })');
check('a typed item is added, use soon as asked', r.ok && r.item.item === 'Half a chicken' && r.item.useSoon === true && r.item.source === 'manual' && ohRows().some(x => x[2] === 'Half a chicken' && x[3] === 'half a chicken'));
check('…an empty one is refused', run('webOnHandAdd_({ parameter: { item: "  " } })').ok === false);
const chickenId = r.item.id;
check('use soon can be switched', run('webOnHandSet_({ parameter: { id: "' + chickenId + '", useSoon: "false" } })').ok && run('ohWeek_("' + WS + '")').find(x => x.id === chickenId).useSoon === false);
check('removed items leave the list; unknown status and missing ids are refused', run('webOnHandSet_({ parameter: { id: "' + chickenId + '", status: "removed" } })').ok
  && !run('ohWeek_("' + WS + '")').some(x => x.id === chickenId)
  && run('webOnHandSet_({ parameter: { id: "' + chickenId + '", status: "eaten" } })').ok === false && run('webOnHandSet_({ parameter: { id: "OH-NOPE", status: "used" } })').ok === false);
run('webOnHandSet_({ parameter: { id: "' + chickenId + '", status: "on hand" } })');

console.log('\nlast week carries over, once');
fresh({ onHand: [
  ['OH-A', PREV, 'Rice', 'rice', 'manual', '', false, 'on hand', '', ''],
  ['OH-B', PREV, 'Milk', 'milk', 'checkout', 'PH-9', true, 'used', '', ''],
  ['OH-C', PREV, 'Leftover soup', 'leftover soup', 'leftover', 'LEFT:x', true, 'on hand', '', '']] });
items = run('ohWeek_("' + WS + '")');
check('what was still on hand comes along, waiting for keep or used it', items.map(x => x.item + ':' + x.status + ':' + x.note).join() === 'Rice:pending:from last week,Leftover soup:pending:from last week', JSON.stringify(items));
check('…used things don\'t', !items.some(x => x.item === 'Milk'));
const rice = items.find(x => x.item === 'Rice');
run('webOnHandSet_({ parameter: { id: "' + rice.id + '", status: "used" } })');
items = run('ohWeek_("' + WS + '")');
check('…and only once: a carry-over marked used doesn\'t come back', !items.some(x => x.item === 'Rice') && ohRows().filter(x => x[2] === 'Rice' && x[1] === WS).length === 1);
S.__today = '2026-10-20';
fresh({ onHand: [['OH-A', PREV, 'Rice', 'rice', 'manual', '', false, 'on hand', '', '']] });
check('next week doesn\'t pull this week\'s in early', run('ohWeek_("' + WS + '")').length === 0);
S.__today = TODAY;

console.log('\na dinner uses things up once its day has passed');
fresh({ onHand: [
  ['OH-1', WS, 'Cabbage', 'cabbage', 'manual', '', true, 'on hand', '', ''],
  ['OH-2', WS, 'Feta', 'feta', 'manual', '', false, 'on hand', '', ''],
  ['OH-3', WS, 'Eggs', 'eggs', 'manual', '', false, 'on hand', '', ''],
  ['OH-4', WS, 'Kale', 'kale', 'manual', '', false, 'on hand', '', '']],
  meals: [meal('Mon', '2026-10-26', 'Hash', ['OH-1']), meal('Tue', '2026-10-27', 'Omelette', ['OH-3'], 'Skipped'), meal('Thu', '2026-10-29', 'Salad', ['OH-2']), meal('Wed', '2026-10-28', 'Soup', ['OH-4'])] });
items = run('ohWeek_("' + WS + '")');
check('Monday\'s hash used the cabbage', !items.some(x => x.id === 'OH-1') && ohRows().find(x => x[0] === 'OH-1')[7] === 'used');
check('…a skipped dinner, tonight\'s and Thursday\'s didn\'t use anything yet', ['OH-2', 'OH-3', 'OH-4'].every(id => items.some(x => x.id === id)), items.map(x => x.id).join());

console.log('\nwhat a dinner uses, Again / Skip, Made extra');
r = run('webMealExtras_({ parameter: { weekStart: "' + WS + '", day: "Thu", uses: "OH-2, OH-3", rating: "again" } })');
let row = S.sheets['Meal Plan'].rows.find(x => x[2] === 'Thu');
check('uses and rating are saved on the dinner', r.ok && row[8] === 'OH-2,OH-3' && row[9] === 'again', JSON.stringify(row));
check('…and read back', JSON.stringify(run('getMealPlanWeek_("' + WS + '")').find(x => x.day === 'Thu').uses) === '["OH-2","OH-3"]' && run('getMealPlanWeek_("' + WS + '")').find(x => x.day === 'Thu').rating === 'again');
check('a day with no dinner, or an unknown rating, is refused', run('webMealExtras_({ parameter: { weekStart: "' + WS + '", day: "Sat", rating: "skip" } })').ok === false
  && run('webMealExtras_({ parameter: { weekStart: "' + WS + '", day: "Thu", rating: "meh" } })').ok === false);
check('only what was sent changes', run('webMealExtras_({ parameter: { weekStart: "' + WS + '", day: "Thu", rating: "" } })').ok && row[8] === 'OH-2,OH-3' && row[9] === '');
r = run('webMadeExtra_({ parameter: { weekStart: "' + WS + '", day: "Mon" } })');
const left = ohRows().find(x => x[5] === 'LEFT:MP-Mon');
check('made extra puts the leftovers on hand, use soon', r.ok && r.extra === true && left && left[2] === 'leftover hash' && left[6] === true && left[4] === 'leftover' && left[9] === 'from Mon’s dinner');
r = run('webMadeExtra_({ parameter: { weekStart: "' + WS + '", day: "Mon" } })');
check('…tapped again, takes them back', r.extra === false && !ohRows().some(x => x[5] === 'LEFT:MP-Mon'));
check('…no dinner, no leftovers', run('webMadeExtra_({ parameter: { weekStart: "' + WS + '", day: "Sun" } })').ok === false);

console.log('\nthe week, for Suggest');
const sch = run('mpSchedule_("' + WS + '", ' + JSON.stringify([
  { title: 'Board meeting', start: '2026-10-27 17:00 EDT', end: '2026-10-27 19:30 EDT' },
  { title: 'Dentist', start: '2026-10-28 09:00 EDT', end: '2026-10-28 10:00 EDT' },
  { title: 'Holiday', start: '2026-10-29', end: '2026-10-30' }]) + ', [{ label: "Chicago", startDate: "2026-10-30", endDate: "2026-10-31" }], [{ label: "Visit: Sam", arrivalDate: "2026-10-28", departureDate: "2026-10-30" }], [{ title: "Birthday dinner", date: "2026-11-01", menu: [{ dish: "Burgers" }, { dish: "" }] }])');
check('a timed event into dinner time is a busy evening; a morning one and an all-day one aren\'t', sch.Tue.busy === true && /busy evening: Board meeting until 19:30/.test(sch.Tue.notes.join()) && !sch.Wed.busy && !sch.Thu.busy);
check('a trip is away, guests stay until they leave, a gathering brings its menu', sch.Fri.away && sch.Sat.away && !sch.Thu.away && sch.Wed.guests && sch.Thu.guests && !sch.Fri.guests
  && sch.Sun.gathering === 'Birthday dinner' && /menu: Burgers\)/.test(sch.Sun.notes.join()), JSON.stringify(sch));

console.log('\nSuggest: open days only, around on hand');
const clean = run('mpCleanSuggest_(' + JSON.stringify('```json\n' + JSON.stringify({ days: [
  { day: 'Thu', meal: 'Cabbage hash', type: 'Home Cooked', why: 'uses the cabbage', uses: ['CABBAGE', 'lobster'] },
  { day: 'Thu', meal: 'Second Thursday', type: 'Takeout' }, { day: 'Mon', meal: 'Past day' }, { day: 'Fri', meal: 'Liver', type: 'Home Cooked' },
  { day: 'Sat', meal: 'Pizza night', type: 'Pizza' }, { day: 'Sun', meal: '' }], stillToBuy: ['eggs', 'Cabbage', 'eggs', ''] }) + '\n```') + ', ["Thu","Fri","Sat","Sun"], ["Cabbage","Feta"], ["liver"])');
check('one per open day, Skip dinners dropped, unknown types become Home Cooked', clean.days.map(d => d.day + ':' + d.meal + ':' + d.type).join() === 'Thu:Cabbage hash:Home Cooked,Sat:Pizza night:Home Cooked', JSON.stringify(clean.days));
check('…uses only what is on hand, as on hand spells it; still to buy skips what you have', JSON.stringify(clean.days[0].uses) === '["Cabbage"]' && JSON.stringify(clean.stillToBuy) === '["eggs"]', JSON.stringify(clean));
check('…nonsense gives nothing, not an error', run('mpCleanSuggest_("no", ["Thu"], [], []).days.length') === 0);

fresh({ onHand: [['OH-1', WS, 'Cabbage', 'cabbage', 'manual', '', true, 'on hand', '', '']],
  meals: [meal('Mon', '2026-10-26', 'Hash', [], 'Planned', 'again'), meal('Thu', '2026-10-29', 'Tacos', []), ['MP-old', PREV, 'Fri', '2026-10-23', 'Liver', 'Home Cooked', 'Planned', '', '', 'skip']] });
S.getUpcomingEventsCached_ = () => [{ title: 'Late call', start: '2026-10-30 18:00 EDT', end: '2026-10-30 19:00 EDT' }];
S.readTripRegistry_ = () => ({ rows: [{ label: 'Chicago', startDate: '2026-11-01', endDate: '2026-11-03', status: 'active' }] });
S.tripIsLive_ = t => t.status === 'active';
S.getUpcomingGuests_ = () => { throw new Error('calendar down'); };
S.readPTOConfig_ = () => ({});
S.hfReadGatherings_ = () => [];
S.CLAUDE_API_URL = 'https://claude.test'; S.CLAUDE_MODEL = 'model-x'; S.getApiKey = () => 'k';
S.fetchTracked_ = (src, url, opts) => { S.sent = JSON.parse(opts.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ text: JSON.stringify({ days: [{ day: 'Wed', meal: 'Cabbage soup', type: 'Home Cooked', why: 'cabbage first', uses: ['cabbage'] }, { day: 'Thu', meal: 'Not this' }], stillToBuy: ['onion'] }) }] }) }; };
const sug = run('mpSuggestWeek_("' + WS + '")');
const prompt = S.sent.messages[0].content;
check('only open days from today on: not Monday or Tuesday (past), not Thursday (planned)', sug.open.join() === 'Wed,Fri,Sat,Sun' && sug.days.map(d => d.day).join() === 'Wed', JSON.stringify(sug));
check('the prompt carries on hand, the busy evening, the trip, Again and Skip', /Cabbage \(use soon\)/.test(prompt) && /Fri — busy evening: Late call until 19:00/.test(prompt)
  && /Sun — away: Chicago/.test(prompt) && /liked: Hash/.test(prompt) && /Never suggest: Liver/.test(prompt) && /Thu: Tacos/.test(prompt), prompt.slice(0, 400));
check('…and a source that fails (guests) doesn\'t stop it', sug.days.length === 1);
check('nothing is written by a suggestion', S.sheets['Meal Plan'].rows.length === 4);

console.log('\nsaving the picks');
r = run('webMealApply_({ weekStart: "' + WS + '", picks: [{ day: "Wed", meal: "Cabbage soup", type: "Home Cooked", uses: ["cabbage"] }, { day: "Thu", meal: "Overwrite?" }, { day: "Fri", meal: "Takeout", type: "Takeout", uses: ["lobster"] }, { day: "Funday", meal: "x" }] })');
const wk = run('getMealPlanWeek_("' + WS + '")');
check('open days are saved, with what they use by on-hand id; a planned day is kept', r.ok && r.saved.join() === 'Wed,Fri' && r.kept.join() === 'Thu'
  && wk.find(x => x.day === 'Wed').mealName === 'Cabbage soup' && JSON.stringify(wk.find(x => x.day === 'Wed').uses) === '["OH-1"]' && wk.find(x => x.day === 'Thu').mealName === 'Tacos' && wk.find(x => x.day === 'Fri').type === 'Takeout', JSON.stringify(r));
check('…nothing to save says so', run('webMealApply_({ weekStart: "' + WS + '", picks: [] })').ok === false);

console.log('\nWhat can I make');
check('an ingredient line comes down to its food', run('mpIngredient_("2 cups chopped fresh spinach (washed)")') === 'spinach' && run('mpIngredient_("1 lb boneless chicken thighs")') === 'chicken thighs' && run('mpIngredient_("3 cloves garlic, minced")') === 'garlic');
check('on hand covers an ingredient by whole words, singular or plural', run('mpCovers_("chicken thighs", "chicken")') && run('mpCovers_("potatoes", "potato")') && run('mpCovers_("berries", "berry")') && !run('mpCovers_("pear", "pearl barley")') && !run('mpCovers_("oil", "soil")'));
const cook = run('mpCook_(' + JSON.stringify([
  { name: 'Spinach omelette', time: '15 min', ingredients: '3 eggs\n1 cup spinach\nsalt\npepper' },
  { name: 'Hash', ingredients: 'cabbage, potatoes, onion' },
  { name: 'Feast', ingredients: 'lamb, saffron, rice, dates, pistachios' },
  { name: 'Toast', ingredients: 'bread, butter' },
  { name: 'No list', ingredients: '' },
  { name: 'Cabbage rolls', ingredients: 'cabbage; ground beef; tomato sauce' }]) + ', [{ item: "Eggs" }, { item: "Spinach", useSoon: true }, { item: "Cabbage", useSoon: true }, { item: "Potatoes" }])');
check('nothing missing first, then one or two missing; salt and pepper don\'t count', cook.map(c => c.name + ':' + c.missing.length).join() === 'Spinach omelette:0,Hash:1,Cabbage rolls:2', JSON.stringify(cook.map(c => [c.name, c.missing])));
check('…with what you have (use soon marked) and what you need', JSON.stringify(cook[0].have) === '[{"name":"Eggs","useSoon":false},{"name":"Spinach","useSoon":true}]' && JSON.stringify(cook[1].missing) === '["onion"]');
check('…a recipe using nothing on hand, or missing three or more, is left out', !cook.some(c => c.name === 'Toast' || c.name === 'Feast' || c.name === 'No list'));

console.log('\nthe nightly flags');
const its = [{ id: 'OH-1', item: 'spinach', useSoon: true, status: 'on hand' }, { id: 'OH-2', item: 'feta', useSoon: true, status: 'on hand' }, { id: 'OH-3', item: 'rice', useSoon: false, status: 'on hand' }];
const meals = [{ day: 'Thu', date: '2026-10-29', mealName: 'Salad', uses: ['OH-2'], status: 'Planned', notes: '' },
  { day: 'Fri', date: '2026-10-30', mealName: 'Lemon chicken', uses: [], status: 'Planned', notes: '' },
  { day: 'Sat', date: '2026-10-31', mealName: 'Stew', uses: [], status: 'Skipped', notes: 'needs prep' }];
const recipes = [{ name: 'Lemon chicken', ingredients: 'chicken, lemon', notes: 'Thaw the chicken overnight.' }];
let w = run('mpNudgesWanted_("2026-10-29", "' + WS + '", ' + JSON.stringify(its) + ', ' + JSON.stringify(meals) + ', ' + JSON.stringify(recipes) + ')');
check('Thursday: a use-soon item in no dinner is flagged, naming the next open night', Object.keys(w).join() === 'ONHAND|OH-1,MEALPREP|2026-10-30' && /Spinach isn’t in a dinner yet; Sat is open/.test(w['ONHAND|OH-1'].reason) === false && /Spinach isn’t in a dinner yet; Sun is open/.test(w['ONHAND|OH-1'].reason), JSON.stringify(w));
check('…one already in a dinner, or not use soon, isn\'t', !w['ONHAND|OH-2'] && !w['ONHAND|OH-3']);
check('prep: the day after tomorrow\'s dinner needs thawing, flagged for tonight', w['MEALPREP|2026-10-30'].flag === 'Prep tonight: Lemon chicken' && /needs thawing — do it tonight/.test(w['MEALPREP|2026-10-30'].reason) && w['MEALPREP|2026-10-30'].date === '2026-10-29');
w = run('mpNudgesWanted_("2026-10-27", "' + WS + '", ' + JSON.stringify(its) + ', ' + JSON.stringify(meals) + ', ' + JSON.stringify(recipes) + ')');
check('early in the week, no use-soon nudge yet', !Object.keys(w).some(k => /^ONHAND/.test(k)));
w = run('mpNudgesWanted_("2026-10-30", "' + WS + '", [], ' + JSON.stringify(meals) + ', [])');
check('a skipped dinner needs no prep, even marked "needs prep"', !w['MEALPREP|2026-10-31']);
w = run('mpNudgesWanted_("2026-10-30", "' + WS + '", [], ' + JSON.stringify(meals.map(m => Object.assign({}, m, { status: 'Planned' }))) + ', [])');
check('…but a planned one marked "needs prep" does', w['MEALPREP|2026-10-31'] && /needs prep the night before/.test(w['MEALPREP|2026-10-31'].reason));
check('the Monday of any date', run('mpWeekStartOf_("2026-11-01")') === WS && run('mpWeekStartOf_("2026-10-26")') === WS && run('mpWeekStartOf_("2026-10-28")') === WS);
fresh({ onHand: [['OH-1', WS, 'Spinach', 'spinach', 'manual', '', true, 'on hand', '', '']], meals: [meal('Fri', '2026-10-30', 'Stew', [], 'Planned')] });
S.sheets['Meal Plan'].rows[1][7] = 'soak the beans';
S.__today = '2026-10-28';
run('mpSyncNudges_()');
const fl = S.sheets['Flags'].rows.slice(1);
check('the nightly step writes both kinds as Meal Plan flags', fl.some(r => r[9] === 'ONHAND|OH-1' && r[2] === 'Meal Plan') && fl.some(r => r[9] === 'MEALPREP|2026-10-30' && r[3] === 'Prep tonight: Stew'), JSON.stringify(fl.map(r => r[9])));
S.__today = '2026-10-31';
run('mpSyncNudges_()');
check('…and resolves them once they no longer apply', S.sheets['Flags'].rows.slice(1).every(r => r[8] === 'Yes'), JSON.stringify(S.sheets['Flags'].rows.slice(1).map(r => [r[9], r[8]])));
S.__today = TODAY;

console.log('\nfood or not, in Purchase History');
check('aisles match the Shopping tab\'s', run('pantryAisle_("Paper towels")') === 'Household' && run('pantryAisle_("Greek yogurt")') === 'Dairy & Eggs' && run('pantryAisle_("Vanilla ice cream")') === 'Frozen' && run('pantryAisle_("Potting soil")') === 'Other');
const APP = read('docs/app.js'), shopRe = /\['(\w[^']*)', '#[0-9a-f]{6}', (\/[^\n]*\/i)\]/g, panRe = /\['(\w[^']*)', (\/[^\n]*\/i)\]/g;
const pairs = (src, re) => { const o = []; let m; while ((m = re.exec(src))) o.push(m[1] + ' ' + m[2]); return o.join('\n'); };
const shopAisles = pairs(APP.slice(APP.indexOf('var SHOP_AISLES_'), APP.indexOf('function shopAisle_')), shopRe);
check('…word for word (the server copy and the dashboards\' block)', shopAisles.length > 200 && shopAisles === pairs(PAN.slice(PAN.indexOf('var PANTRY_AISLES_'), PAN.indexOf('function pantryAisle_')), panRe.constructor(panRe.source.replace(/\\\//g, '/'), 'g')));
check('a check-off and a receipt line record their aisle; a receipt line marked not food is Household',
  /category: pantryAisle_\(raw\), store: store \}\], 'checkout'\)/.test(PAN) && /category: x\.food \? pantryAisle_\(x\.name\) : 'Household'/.test(PAN));

console.log('\nwiring');
check('the routes', ["case 'suggest_week':          return jsonOut_(webSuggestWeek_(e));", "case 'meal_cook':             return jsonOut_(webMealCook_(e));", "case 'meal_extras':           return jsonOut_(webMealExtras_(e));",
  "case 'made_extra':            return jsonOut_(webMadeExtra_(e));", "case 'onhand_add':            return jsonOut_(webOnHandAdd_(e));", "case 'onhand_set':            return jsonOut_(webOnHandSet_(e));",
  "case 'meal_apply':                 return jsonOut_(webMealApply_(body));"].every(x => WEB.indexOf(x) !== -1));
check('the planner\'s read brings this week\'s on hand, and survives it failing', /try \{ weeks\[0\]\.onHand = ohWeek_\(weeks\[0\]\.weekStart\); \} catch \(err\) \{ res\.onHandError = err\.message; \}/.test(WEB));
check('the tab is created; the nightly step runs', /ensureSheet\(ss, TABS\.ON_HAND,\s+ON_HAND_HEADERS\);/.test(CODE) && /nightlyStep_\(ctx, 'mpSyncNudges_', mpSyncNudges_\);/.test(CODE));
check('a moved dinner takes what it uses with it', /mpSetExtras_\(toWeekStart, toDay, source\.uses \|\| \[\], source\.rating \|\| ''\);/.test(MP));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
