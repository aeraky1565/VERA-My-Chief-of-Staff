// ============================================================
// OnHand.js — Meal Plan "on hand this week", built on Shopping
//
// On hand is what's in the house this week, so Suggest can plan around it:
//   · food checked off in Shopping or picked from a receipt (Purchase History rows)
//   · things typed in, "made extra" leftovers, and last week's carry-overs
// Dinners record which items they use (Meal Plan › Uses); when a dinner's day has
// passed, the items it used become used, so they don't carry over.
//
// Also here: Suggest the week (on hand + the week's schedule + Again/Skip), What can I
// make (recipes vs on hand), and the nightly use-soon and prep-tonight flags.
//
// ON_HAND_HEADERS: ID | Week Start | Item | Normalized | Source | Purchase ID |
//                  Use Soon | Status | Added | Note
//   Source: checkout | receipt | manual | leftover | carried
//   Status: on hand | pending (a carry-over not yet kept) | used | removed
//   Purchase ID: the Purchase History ID; CARRY:<id> for a carry-over; LEFT:<meal id>
// ============================================================

var OH_COL_ = { ID: 0, WEEK: 1, ITEM: 2, NORM: 3, SOURCE: 4, PID: 5, SOON: 6, STATUS: 7, ADDED: 8, NOTE: 9 };
var OH_LIVE_ = { 'on hand': 1, 'pending': 1 };

function ohSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.ON_HAND, ON_HAND_HEADERS), ON_HAND_HEADERS); }

function ohToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** yyyy-MM-dd plus n days, by the calendar (no time-zone drift). */
function ohAddDays_(iso, n) {
  var p = String(iso || '').split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + (n || 0)));
  return d.toISOString().slice(0, 10);
}

function ohRead_(sheet) {
  return tiRows_(sheet, ON_HAND_HEADERS.length).map(function(r, i) {
    return {
      rowNum: i + 2, id: String(r[OH_COL_.ID] || '').trim(), weekStart: dateCellToIso_(r[OH_COL_.WEEK]),
      item: String(r[OH_COL_.ITEM] || '').trim(), norm: String(r[OH_COL_.NORM] || '').trim(),
      source: String(r[OH_COL_.SOURCE] || '').trim(), pid: String(r[OH_COL_.PID] || '').trim(),
      useSoon: r[OH_COL_.SOON] === true || String(r[OH_COL_.SOON]).toUpperCase() === 'TRUE',
      status: String(r[OH_COL_.STATUS] || 'on hand').trim().toLowerCase(), note: String(r[OH_COL_.NOTE] || '').trim(),
    };
  }).filter(function(x) { return x.id; });
}

function ohRow_(id, weekStart, item, source, pid, useSoon, status, note) {
  return [id, weekStart, item, normalizeItemName_(item), source, pid || '', !!useSoon, status || 'on hand', tiNow_(), note || ''];
}

/** Food or not. Household (by the row's Category or the item's aisle) never goes on hand. */
function ohIsFood_(category, name) {
  return String(category || '').trim() !== 'Household' && pantryAisle_(name) !== 'Household';
}

// Spoils fast, so a purchase of it starts as "use soon".
var OH_PERISHABLE_ = /\b(spinach|lettuce|greens|herbs?|cilantro|parsley|mint|berr(y|ies)|strawberr(y|ies)|blueberr(y|ies)|raspberr(y|ies)|bananas?|avocados?|mushrooms?|fish|salmon|shrimp|chicken|ground|milk|cream|yogh?urt|bread)\b/i;

/**
 * Brings the week's on hand up to date. Pure over its inputs, so it can be tested:
 * returns the rows to append, the row numbers to delete and the row numbers to mark used.
 *   hist: Purchase History rows (raw), items: this sheet's rows, meals: the Meal Plan week,
 *   prevItems: last week's rows.
 */
function ohPlanSync_(weekStart, today, hist, items, meals, prevItems) {
  var end = ohAddDays_(weekStart, 6), tz = Session.getScriptTimeZone();
  var week = items.filter(function(x) { return x.weekStart === weekStart; });
  var havePid = {}, haveNorm = {};
  week.forEach(function(x) { if (x.pid) havePid[x.pid] = x; if (x.status !== 'removed') haveNorm[x.norm] = true; });
  var bought = {}, append = [], del = [], used = [];
  (hist || []).forEach(function(r) {
    var id = String(r[0] || '').trim(), src = String(r[9] || '').trim();
    var day = r[4] instanceof Date ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : String(r[4] || '').slice(0, 10);
    if (!id || (src !== 'checkout' && src !== 'receipt') || day < weekStart || day > end) return;
    bought[id] = true;
    var name = String(r[1] || '').trim(), norm = String(r[2] || '').trim() || normalizeItemName_(name);
    if (havePid[id] || haveNorm[norm] || !ohIsFood_(r[3], norm)) return;
    haveNorm[norm] = true;
    var store = String(r[7] || '').trim();
    append.push(ohRow_(tiMintId_('OH-'), weekStart, name, src, id, OH_PERISHABLE_.test(norm), 'on hand',
      (src === 'receipt' ? 'receipt' : 'checked off') + (store ? ' · ' + store : '') + ', ' + ohDayName_(day)));
  });
  // An untick takes its purchase row back out; its chip goes too (unless it was already used).
  week.forEach(function(x) {
    if ((x.source === 'checkout' || x.source === 'receipt') && x.pid && !bought[x.pid] && x.status === 'on hand') del.push(x.rowNum);
  });
  // Last week's leftovers come along once, waiting for keep / used it.
  if (today >= weekStart) {
    (prevItems || []).forEach(function(x) {
      if (x.status !== 'on hand' || havePid['CARRY:' + x.id] || haveNorm[x.norm]) return;
      havePid['CARRY:' + x.id] = true;
      append.push(ohRow_(tiMintId_('OH-'), weekStart, x.item, 'carried', 'CARRY:' + x.id, x.useSoon, 'pending', 'from last week'));
    });
  }
  // A dinner whose day has passed used what it was planned with.
  var usedIds = {};
  (meals || []).forEach(function(m) {
    if (!m.mealName || !m.date || m.date >= today || String(m.status).toLowerCase() === 'skipped') return;
    (m.uses || []).forEach(function(id) { usedIds[id] = true; });
  });
  week.forEach(function(x) { if (usedIds[x.id] && x.status === 'on hand') used.push(x.rowNum); });
  return { append: append, del: del, used: used };
}

function ohDayName_(iso) {
  var p = String(iso).split('-').map(Number);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] || '';
}

/** Sync, then the week's live items: [{id, item, source, note, useSoon, status}]. */
function ohWeek_(weekStart) {
  var today = ohToday_();
  return tiLocked_(function() {
    var sheet = ohSheet_(), items = ohRead_(sheet);
    var hist = [];
    try {
      var hs = getPurchaseHistorySheet_();
      if (hs.getLastRow() >= 2) hist = hs.getRange(2, 1, hs.getLastRow() - 1, PURCHASE_HISTORY_HEADERS.length).getValues();
    } catch (e) { Logger.log('ohWeek_: no Purchase History — ' + e.message); }
    var prev = items.filter(function(x) { return x.weekStart === addWeeksToStart_(weekStart, -1); });
    var plan = ohPlanSync_(weekStart, today, hist, items, getMealPlanWeek_(weekStart), prev);
    plan.used.forEach(function(n) { sheet.getRange(n, OH_COL_.STATUS + 1).setValue('used'); });
    plan.del.sort(function(a, b) { return b - a; }).forEach(function(n) { sheet.deleteRow(n); });
    if (plan.append.length) sheet.getRange(sheet.getLastRow() + 1, 1, plan.append.length, ON_HAND_HEADERS.length).setValues(plan.append);
    if (plan.used.length || plan.del.length || plan.append.length) items = ohRead_(sheet);
    return items.filter(function(x) { return x.weekStart === weekStart && OH_LIVE_[x.status]; })
      .map(function(x) { return { id: x.id, item: x.item, source: x.source, pid: x.pid, note: x.note, useSoon: x.useSoon, status: x.status }; });
  });
}

/** GET onhand_add {weekStart, item, useSoon} → {ok, item} */
function webOnHandAdd_(e) {
  var p = (e && e.parameter) || {};
  var item = String(p.item || '').trim().slice(0, 80);
  if (!item) return { ok: false, error: 'Type what you have on hand.' };
  var weekStart = String(p.weekStart || getCurrentWeekStart_()).trim();
  var row = ohRow_(tiMintId_('OH-'), weekStart, item, 'manual', '', p.useSoon === 'true' || p.useSoon === '1', 'on hand', 'added by you');
  tiLocked_(function() { ohSheet_().appendRow(row); });
  return { ok: true, item: { id: row[0], item: item, source: 'manual', note: row[9], useSoon: row[6], status: 'on hand' } };
}

/** GET onhand_set {id, useSoon?, status?} — status: on hand (keep) | used | removed. */
function webOnHandSet_(e) {
  var p = (e && e.parameter) || {};
  var id = String(p.id || '').trim();
  var status = p.status !== undefined ? String(p.status).trim().toLowerCase() : null;
  if (status !== null && ['on hand', 'used', 'removed'].indexOf(status) === -1) return { ok: false, error: 'Unknown status.' };
  return tiLocked_(function() {
    var sheet = ohSheet_(), row = tiRowOf_(sheet, ON_HAND_HEADERS.length, id);
    if (row === -1) return { ok: false, error: 'That item is no longer on hand.' };
    if (p.useSoon !== undefined) sheet.getRange(row, OH_COL_.SOON + 1).setValue(p.useSoon === 'true' || p.useSoon === '1');
    if (status !== null) sheet.getRange(row, OH_COL_.STATUS + 1).setValue(status);
    return { ok: true, id: id };
  });
}

/** GET meal_extras {weekStart, day, uses?, rating?} — uses: comma-separated on-hand ids; rating: again | skip | ''. */
function webMealExtras_(e) {
  var p = (e && e.parameter) || {};
  var weekStart = String(p.weekStart || getCurrentWeekStart_()).trim(), day = String(p.day || '').trim();
  if (p.rating !== undefined && ['again', 'skip', ''].indexOf(String(p.rating)) === -1) return { ok: false, error: 'Unknown rating.' };
  var res = mpSetExtras_(weekStart, day, p.uses !== undefined ? String(p.uses).split(',').map(function(s) { return s.trim(); }).filter(String) : undefined, p.rating);
  return res ? { ok: true, day: day } : { ok: false, error: 'Plan a dinner on ' + day + ' first.' };
}

/** GET made_extra {weekStart, day} → toggles that dinner's leftovers on hand (use soon). */
function webMadeExtra_(e) {
  var p = (e && e.parameter) || {};
  var weekStart = String(p.weekStart || getCurrentWeekStart_()).trim(), day = String(p.day || '').trim();
  var meal = getMealPlanWeek_(weekStart).filter(function(m) { return m.day === day && m.mealName; })[0];
  if (!meal) return { ok: false, error: 'Plan a dinner on ' + day + ' first.' };
  return tiLocked_(function() {
    var sheet = ohSheet_(), pid = 'LEFT:' + meal.id;
    var have = ohRead_(sheet).filter(function(x) { return x.pid === pid; })[0];
    if (have) { sheet.deleteRow(have.rowNum); return { ok: true, extra: false }; }
    sheet.appendRow(ohRow_(tiMintId_('OH-'), weekStart, 'leftover ' + meal.mealName.toLowerCase(), 'leftover', pid, true, 'on hand', 'from ' + day + '’s dinner'));
    return { ok: true, extra: true };
  });
}

// ---- Suggest the week ------------------------------------------------------------

var MP_TYPES_ = ['Home Cooked', 'Leftovers', 'Takeout', 'Eating Out'];

/**
 * The week as it bears on dinner, per day: away (a trip), a busy evening (a timed event
 * running into dinner time), guests staying, a gathering. Pure over its inputs.
 *   events: [{title, start:'yyyy-MM-dd HH:mm z'|'yyyy-MM-dd', end}], trips: [{label, startDate, endDate}],
 *   guests: [{label, arrivalDate, departureDate}], gatherings: [{title, date, type, guests:[], menu:[]}]
 */
function mpSchedule_(weekStart, events, trips, guests, gatherings) {
  var out = {};
  MEAL_PLAN_DAYS_.forEach(function(d, i) { out[d] = { date: ohAddDays_(weekStart, i), notes: [] }; });
  var hhmm = function(s) { var m = String(s || '').match(/ (\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  Object.keys(out).forEach(function(d) {
    var o = out[d], date = o.date;
    (trips || []).forEach(function(t) { if (t.startDate && t.endDate && date >= t.startDate && date <= t.endDate) { o.away = true; o.notes.push('away: ' + t.label); } });
    (guests || []).forEach(function(g) { if (g.arrivalDate && date >= g.arrivalDate && date < (g.departureDate || g.arrivalDate)) { o.guests = true; o.notes.push('house guests: ' + g.label); } });
    (gatherings || []).forEach(function(g) {
      if (g.date !== date) return;
      o.gathering = g.title;
      o.notes.push('gathering: ' + g.title + ((g.menu || []).length ? ' (menu: ' + g.menu.map(function(m) { return m.dish; }).filter(String).join(', ') + ')' : ''));
    });
    (events || []).forEach(function(ev) {
      if (String(ev.start || '').slice(0, 10) !== date) return;
      var s = hhmm(ev.start), en = hhmm(ev.end);
      if (s === null || en === null) return;
      if (en >= 17 * 60 + 30 && s < 20 * 60 + 30) { o.busy = true; o.notes.push('busy evening: ' + ev.title + ' until ' + String(ev.end).slice(11, 16)); }
    });
  });
  return out;
}

/** Again / Skip from every rated dinner in the sheet. */
function mpRatings_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  var again = {}, skip = {};
  if (sheet) _readMealPlanRows_(sheet).forEach(function(r) {
    var n = String(r.mealName || '').trim();
    if (!n) return;
    if (r.rating === 'again') again[n.toLowerCase()] = n;
    if (r.rating === 'skip') skip[n.toLowerCase()] = n;
  });
  return { again: Object.keys(again).map(function(k) { return again[k]; }), skip: Object.keys(skip).map(function(k) { return skip[k]; }) };
}

function mpTry_(fn, fallback) { try { return fn(); } catch (e) { Logger.log('suggest input skipped: ' + e.message); return fallback; } }

/**
 * Suggests dinners for the OPEN days only (a planned dinner, and a day already past,
 * stay as they are), built around what's on hand and the week. Writes nothing:
 * the dashboard shows the picks with their reasons, and meal_apply saves the ones kept.
 * @returns {{days:[{day, meal, type, why, uses:[names]}], stillToBuy:[names], open:[days]}}
 */
function mpSuggestWeek_(weekStart) {
  var today = ohToday_();
  var week = getMealPlanWeek_(weekStart);
  var open = MEAL_PLAN_DAYS_.filter(function(d, i) {
    var date = ohAddDays_(weekStart, i);
    return date >= today && !week.some(function(m) { return m.day === d && m.mealName; });
  });
  if (!open.length) return { days: [], stillToBuy: [], open: [] };
  var onHand = mpTry_(function() { return ohWeek_(weekStart).filter(function(x) { return x.status === 'on hand'; }); }, []);
  var sched = mpSchedule_(weekStart,
    mpTry_(function() { return getUpcomingEventsCached_(14); }, []),
    mpTry_(function() { return readTripRegistry_().rows.filter(tripIsLive_); }, []),
    mpTry_(function() { return getUpcomingGuests_(readPTOConfig_()); }, []),
    mpTry_(function() { return hfReadGatherings_(); }, []));
  var ratings = mpTry_(mpRatings_, { again: [], skip: [] });
  var recent = mpTry_(function() { return getMealPlanHistory_(3).map(function(r) { return r.mealName; }).filter(String); }, []);
  var recipes = mpTry_(function() { return mpReadRecipes_().map(function(r) { return r.name; }); }, []);
  var planned = week.filter(function(m) { return m.mealName; }).map(function(m) { return m.day + ': ' + m.mealName; });

  var prompt =
    'Plan dinners for these OPEN days only: ' + open.join(', ') + ' (week of ' + weekStart + ').\n' +
    'Already planned (keep, and avoid repeating): ' + (planned.join('; ') || 'none') + '.\n' +
    'ON HAND (use these first; "use soon" ones earliest): ' + (onHand.map(function(x) { return x.item + (x.useSoon ? ' (use soon)' : ''); }).join(', ') || 'nothing listed') + '.\n' +
    'THE WEEK: ' + open.map(function(d) { return d + ' — ' + (sched[d].notes.join('; ') || 'nothing special'); }).join(' | ') + '.\n' +
    'Rules: on a busy evening suggest something ready in about 20 minutes, or takeout. Away all day: suggest "Away" with type "Eating Out". ' +
    'House guests: cook for more. A gathering: use its menu (or name the gathering) instead of a new dinner. ' +
    'When a dinner makes a lot, make the next open night "Leftovers: <that dinner>". ' +
    'Favour dinners the household liked: ' + (ratings.again.join(', ') || 'none yet') + '. Never suggest: ' + (ratings.skip.join(', ') || 'nothing') + '. ' +
    'Avoid these recent dinners: ' + (recent.join(', ') || 'none') + '. Household recipes you may use: ' + (recipes.slice(0, 30).join(', ') || 'none saved') + '.\n' +
    'Reply ONLY with JSON (no fences): {"days":[{"day":"Tue","meal":"…","type":"Home Cooked|Leftovers|Takeout|Eating Out","why":"one short reason from the week or on hand","uses":["exact ON HAND names used"]}],' +
    '"stillToBuy":["ingredients these dinners need that are not on hand, plain names"]}';
  var resp = fetchTracked_('anthropic', CLAUDE_API_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (resp.getResponseCode() !== 200) throw new Error('Couldn’t get suggestions right now (HTTP ' + resp.getResponseCode() + ').');
  var json = JSON.parse(resp.getContentText());
  var out = mpCleanSuggest_((json.content && json.content[0] && json.content[0].text) || '', open, onHand.map(function(x) { return x.item; }), ratings.skip);
  out.open = open;
  return out;
}

/** What the model wrote, made safe: open days only, one per day, known types, on-hand names only, no Skip dinners. */
function mpCleanSuggest_(text, open, onHandNames, skip) {
  var raw = String(text || '').replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim(), obj;
  try { obj = JSON.parse(raw); } catch (e) { var m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : {}; } catch (e2) { obj = {}; } }
  var names = {}; (onHandNames || []).forEach(function(n) { names[String(n).toLowerCase()] = n; });
  var skipped = {}; (skip || []).forEach(function(n) { skipped[String(n).toLowerCase()] = true; });
  var seen = {}, days = [];
  (Array.isArray(obj.days) ? obj.days : []).forEach(function(d) {
    var day = String(d && d.day || '').trim(), meal = String(d && d.meal || '').trim().slice(0, 80);
    if (open.indexOf(day) === -1 || seen[day] || !meal || skipped[meal.toLowerCase()]) return;
    seen[day] = true;
    var uses = (Array.isArray(d.uses) ? d.uses : []).map(function(u) { return names[String(u).toLowerCase()]; }).filter(Boolean);
    days.push({ day: day, meal: meal, type: MP_TYPES_.indexOf(d.type) === -1 ? 'Home Cooked' : d.type, why: String(d.why || '').trim().slice(0, 140),
      uses: uses.filter(function(u, i) { return uses.indexOf(u) === i; }) });
  });
  days.sort(function(a, b) { return MEAL_PLAN_DAYS_.indexOf(a.day) - MEAL_PLAN_DAYS_.indexOf(b.day); });
  var buy = (Array.isArray(obj.stillToBuy) ? obj.stillToBuy : []).map(function(s) { return String(s || '').trim().slice(0, 60); })
    .filter(function(s, i, a) { return s && !names[s.toLowerCase()] && a.indexOf(s) === i; }).slice(0, 20);
  return { days: days, stillToBuy: buy };
}

/** GET suggest_week {weekStart} → the picks, unsaved. */
function webSuggestWeek_(e) {
  var weekStart = String((e && e.parameter && e.parameter.weekStart) || getCurrentWeekStart_()).trim();
  var r = mpSuggestWeek_(weekStart);
  return { ok: true, weekStart: weekStart, days: r.days, stillToBuy: r.stillToBuy, open: r.open };
}

/**
 * POST meal_apply {weekStart, picks:[{day, meal, type, uses:[names]}]} → saves the picks kept,
 * each with the on-hand items it uses. A day planned since the suggestion is left alone.
 */
function webMealApply_(body) {
  var b = body || {}, weekStart = String(b.weekStart || getCurrentWeekStart_()).trim();
  var picks = Array.isArray(b.picks) ? b.picks.slice(0, 7) : [];
  if (!picks.length) return { ok: false, error: 'Nothing to save.' };
  var items = mpTry_(function() { return ohWeek_(weekStart); }, []);
  var byName = {}; items.forEach(function(x) { byName[x.item.toLowerCase()] = x.id; });
  var week = getMealPlanWeek_(weekStart), saved = [], kept = [];
  picks.forEach(function(p) {
    var day = String(p && p.day || '').trim(), meal = String(p && p.meal || '').trim().slice(0, 80);
    if (MEAL_PLAN_DAYS_.indexOf(day) === -1 || !meal) return;
    if (week.some(function(m) { return m.day === day && m.mealName; })) { kept.push(day); return; }
    upsertMealPlanEntry_(weekStart, day, '', meal, MP_TYPES_.indexOf(p.type) === -1 ? 'Home Cooked' : p.type, 'Planned', '');
    var uses = (p.uses || []).map(function(n) { return byName[String(n).toLowerCase()]; }).filter(Boolean);
    if (uses.length) mpSetExtras_(weekStart, day, uses, undefined);
    saved.push(day);
  });
  return { ok: true, saved: saved, kept: kept };
}

// ---- What can I make --------------------------------------------------------------

function mpReadRecipes_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, RECIPE_HEADERS.length).getValues().map(function(r) {
    return { name: String(r[0] || '').trim(), time: String(r[3] || '').trim(), ingredients: String(r[5] || ''), notes: String(r[7] || '') };
  }).filter(function(r) { return r.name; });
}

// Always in the cupboard; never counted as missing.
var MP_STAPLES_ = /^(salt|pepper|black pepper|water|ice|sugar|olive oil|oil|vegetable oil|cooking spray)$/;

/** An ingredient line down to its food: "2 cups chopped spinach (fresh)" → "spinach". */
function mpIngredient_(line) {
  return String(line || '').toLowerCase().replace(/\([^)]*\)/g, ' ')
    .replace(/^[\s\d\/.,½¼¾⅓⅔-]+/, '')
    .replace(/^(cups?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|cloves?|cans?|pinch|handful|bunch(es)?|large|medium|small|of)\b\s*/g, '')
    .replace(/^(cups?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|cloves?|cans?|pinch|handful|bunch(es)?|large|medium|small|of)\b\s*/g, '')
    .replace(/\b(fresh|chopped|diced|minced|sliced|grated|ground|dried|frozen|boneless|skinless|to taste|optional|finely|roughly)\b/g, ' ')
    .replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Does an on-hand item cover an ingredient? Either name contains the other, by whole words, singular or plural. */
function mpCovers_(onHandNorm, ingredient) {
  var sing = function(s) { return s.split(' ').map(function(w) { return w.replace(/(ies)$/, 'y').replace(/(oes)$/, 'o').replace(/s$/, ''); }).join(' '); };
  var a = ' ' + sing(onHandNorm) + ' ', b = ' ' + sing(ingredient) + ' ';
  return a.trim() !== '' && b.trim() !== '' && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
}

/**
 * Recipes against on hand, no AI: those with nothing missing first, then one or two
 * missing; ties go to the one using more use-soon items. Pure over its inputs.
 */
function mpCook_(recipes, onHand) {
  var out = [];
  (recipes || []).forEach(function(r) {
    var ings = String(r.ingredients || '').split(/[\n,;]+/).map(mpIngredient_).filter(function(x) { return x && !MP_STAPLES_.test(x); });
    if (!ings.length) return;
    var have = [], missing = [];
    ings.forEach(function(ing) {
      var hit = (onHand || []).filter(function(x) { return mpCovers_(normalizeItemName_(x.item), ing); })[0];
      if (hit) { if (!have.some(function(h) { return h.name === hit.item; })) have.push({ name: hit.item, useSoon: !!hit.useSoon }); }
      else if (missing.indexOf(ing) === -1) missing.push(ing);
    });
    if (!have.length || missing.length > 2) return;
    out.push({ name: r.name, time: r.time, have: have, missing: missing });
  });
  out.sort(function(a, b) {
    return (a.missing.length - b.missing.length) || (b.have.filter(function(h) { return h.useSoon; }).length - a.have.filter(function(h) { return h.useSoon; }).length) || a.name.localeCompare(b.name);
  });
  return out.slice(0, 12);
}

/** GET meal_cook {weekStart} → {ok, recipes, open:[days still free]} */
function webMealCook_(e) {
  var weekStart = String((e && e.parameter && e.parameter.weekStart) || getCurrentWeekStart_()).trim(), today = ohToday_();
  var onHand = ohWeek_(weekStart).filter(function(x) { return x.status === 'on hand'; });
  var week = getMealPlanWeek_(weekStart);
  var open = MEAL_PLAN_DAYS_.filter(function(d, i) { return ohAddDays_(weekStart, i) >= today && !week.some(function(m) { return m.day === d && m.mealName; }); });
  return { ok: true, recipes: mpCook_(mpReadRecipes_(), onHand), open: open };
}

// ---- Nightly: use it soon, and prep tonight -------------------------------------

var OH_FLAG_PREFIX_ = 'ONHAND|', MP_PREP_PREFIX_ = 'MEALPREP|';
var MP_PREP_RE_ = /\b(thaw|defrost|marinat\w*|soak\w*|overnight|brine)\b/i;

/**
 * The flags wanted tonight. Pure over its inputs (tomorrow = the day the flag is read).
 *   · use soon: a use-soon item still in no dinner, Wednesday to Saturday, naming the next open night
 *   · prep: the dinner the day AFTER tomorrow needs thawing, marinating or soaking — the flag
 *     reads "tonight" on the morning it shows up.
 */
function mpNudgesWanted_(tomorrow, weekStart, items, meals, recipes) {
  var wanted = {};
  var used = {}; (meals || []).forEach(function(m) { (m.uses || []).forEach(function(id) { used[id] = true; }); });
  var dow = ohDayName_(tomorrow);
  if (['Wed', 'Thu', 'Fri', 'Sat'].indexOf(dow) !== -1) {
    var openDay = MEAL_PLAN_DAYS_.filter(function(d, i) { return ohAddDays_(weekStart, i) >= tomorrow && !(meals || []).some(function(m) { return m.day === d && m.mealName; }); })[0];
    (items || []).forEach(function(x) {
      if (x.status !== 'on hand' || !x.useSoon || used[x.id]) return;
      wanted[OH_FLAG_PREFIX_ + x.id] = { urgency: 'Low', flag: 'Use soon: ' + x.item,
        reason: x.item.charAt(0).toUpperCase() + x.item.slice(1) + ' isn’t in a dinner yet' + (openDay ? '; ' + openDay + ' is open' : '') + '. Plan it in Kitchen → Meal Plan, or mark it used.' };
    });
  }
  var target = ohAddDays_(tomorrow, 1);
  (meals || []).forEach(function(m) {
    if (m.date !== target || !m.mealName || String(m.status).toLowerCase() === 'skipped') return;
    var rec = (recipes || []).filter(function(r) { return r.name.toLowerCase() === m.mealName.toLowerCase(); })[0];
    var text = [m.notes, rec && rec.ingredients, rec && rec.notes].join(' ');
    if (!MP_PREP_RE_.test(text) && !/needs prep/i.test(m.notes || '')) return;
    var word = (text.match(MP_PREP_RE_) || ['prep'])[0].toLowerCase();
    wanted[MP_PREP_PREFIX_ + target] = { urgency: 'Low', date: tomorrow, flag: 'Prep tonight: ' + m.mealName,
      reason: ohDayName_(target) + '’s dinner (' + m.mealName + ') needs ' + (/^thaw|^defrost/.test(word) ? 'thawing' : /^marinat/.test(word) ? 'marinating' : /^soak/.test(word) ? 'soaking' : 'prep the night before') + ' — do it tonight.' };
  });
  return wanted;
}

/** Nightly step: refreshes the use-soon and prep flags; ones no longer wanted resolve. */
function mpSyncNudges_() {
  var ss = getSpreadsheet(), flags = ss.getSheetByName(TABS.FLAGS);
  if (!flags) return { skipped: 'no Flags tab' };
  var today = ohToday_(), tomorrow = ohAddDays_(today, 1);
  var weekStart = mpWeekStartOf_(tomorrow);
  var items = mpTry_(function() { return ohWeek_(weekStart); }, []);
  var meals = getMealPlanWeek_(weekStart);
  var nextWeek = addWeeksToStart_(weekStart, 1);
  if (ohAddDays_(tomorrow, 1) >= nextWeek) meals = meals.concat(getMealPlanWeek_(nextWeek));
  var wanted = mpNudgesWanted_(tomorrow, weekStart, items, meals, mpTry_(mpReadRecipes_, []));
  var split = function(prefix) { var o = {}; Object.keys(wanted).forEach(function(k) { if (k.indexOf(prefix) === 0) o[k] = wanted[k]; }); return o; };
  upsertKeyedFlags_(flags, OH_FLAG_PREFIX_, 'Meal Plan', split(OH_FLAG_PREFIX_), today);
  upsertKeyedFlags_(flags, MP_PREP_PREFIX_, 'Meal Plan', split(MP_PREP_PREFIX_), today);
  return { wanted: Object.keys(wanted).length };
}

/** The Monday of the week holding a yyyy-MM-dd date. */
function mpWeekStartOf_(iso) {
  var p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var dow = d.getUTCDay();
  return ohAddDays_(iso, dow === 0 ? -6 : 1 - dow);
}
