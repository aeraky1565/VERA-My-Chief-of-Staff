// ============================================================
// VERA — PlannedPurchases.js
// Finances → Planned Purchases: big buys from first idea to bought.
// ============================================================
//
// A purchase has what it has to do (Must / Nice / No), a budget and a need-by
// date, and the options compared for it. Each option is ticked against the
// requirements, so the comparison scores itself. Money set aside is the linked
// Financial Goal's balance: it lives in one place, never copied here.
//
// Prices are the ones Ahmed or Victoria enter; VERA checks no stores. A new
// price on an option is kept with the old ones, so the history shows.
//
// Mark as bought does the rest in one step: the price comes out of the goal,
// the delivery window becomes a flag the day before (and shows in Coming up),
// the return window and warranty go to Warranties & Service, and the item it
// replaces stays on the purchase until they choose Resell, Donate or Haul away.
//
//   pp*_   pure: cleaning, scoring, money, timing, flags
//   webPp* the sheet reads and writes
// ============================================================

var PP_STAGES_  = ['idea', 'researching', 'deciding', 'waiting', 'bought'];
var PP_FOR_     = ['Ahmed', 'Victoria', 'Shared'];
var PP_OLD_     = ['', 'resell', 'donate', 'haul', 'done'];
var PP_FLAG_PREFIX_ = 'PPURCH|';
var PP_ORDER_SOON_DAYS_ = 14;   // "order by" shows as a heads-up this close
var PP_RETURN_SOON_DAYS_ = 7;

// ---- pure: cleaning ----------------------------------------------------------

function ppStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function ppMoney_(v) {
  if (v === '' || v == null) return null;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function ppYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var t = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
function ppInt_(v, lo, hi) { if (v === '' || v == null) return null; var n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; }
function ppOneOf_(v, list, fb) { var s = String(v == null ? '' : v).trim(); var hit = list.filter(function(x) { return x.toLowerCase() === s.toLowerCase(); })[0]; return hit != null ? hit : fb; }
function ppList_(v, n, len) {
  var arr = Array.isArray(v) ? v : String(v == null ? '' : v).split('\n');
  return arr.map(function(x) { return ppStr_(x, len); }).filter(function(x, i, a) { return x && a.indexOf(x) === i; }).slice(0, n);
}
function ppParse_(s, fb) { try { var v = JSON.parse(String(s || '')); return v == null ? fb : v; } catch (e) { return fb; } }

/** Pure: a purchase as the dashboard sent it, made safe to store. */
function ppClean_(raw) {
  raw = raw || {};
  return {
    id: ppStr_(raw.id, 40), item: ppStr_(raw.item, 80), forWho: ppOneOf_(raw.forWho, PP_FOR_, 'Shared'), why: ppStr_(raw.why, 120),
    budget: ppMoney_(raw.budget), needBy: ppYmd_(raw.needBy), needNote: ppStr_(raw.needNote, 80), goalId: ppStr_(raw.goalId, 40),
    stage: ppOneOf_(raw.stage, PP_STAGES_, 'researching'),
    must: ppList_(raw.must, 12, 80), nice: ppList_(raw.nice, 12, 80), no: ppList_(raw.no, 12, 80),
    targetPrice: ppMoney_(raw.targetPrice), chosenOption: ppStr_(raw.chosenOption, 40),
    bought: ppCleanBought_(raw.bought), oldItem: ppStr_(raw.oldItem, 80), oldPlan: ppOneOf_(raw.oldPlan, PP_OLD_, ''),
    notes: (Array.isArray(raw.notes) ? raw.notes : []).map(function(n) {
      n = n || {}; var text = ppStr_(n.text, 400), link = ppStr_(n.link, 400);
      return text || link ? { date: ppYmd_(n.date), text: text, link: /^https?:\/\//i.test(link) ? link : '' } : null;
    }).filter(Boolean).slice(-60),
  };
}

/** Pure: the purchase as made, or null. */
function ppCleanBought_(b) {
  if (!b || typeof b !== 'object') return null;
  var price = ppMoney_(b.price), on = ppYmd_(b.orderedOn);
  if (price == null || !on) return null;
  var df = ppYmd_(b.deliveryFrom), dt = ppYmd_(b.deliveryTo);
  if (df && dt && dt < df) { var t = df; df = dt; dt = t; }
  return { optionId: ppStr_(b.optionId, 40), store: ppStr_(b.store, 80), price: price, orderedOn: on, card: ppStr_(b.card, 80),
    deliveryFrom: df, deliveryTo: dt || df, returnDays: ppInt_(b.returnDays, 0, 365), warrantyYears: ppInt_(b.warrantyYears, 0, 50),
    warrantyNote: ppStr_(b.warrantyNote, 120), receipt: /^https?:\/\//i.test(String(b.receipt || '')) ? ppStr_(b.receipt, 400) : '' };
}

/** Pure: an option as the dashboard sent it. A price is added to its history when it differs from the last one. */
function ppCleanOption_(raw, stored) {
  raw = raw || {};
  var prices = (stored && stored.prices) || (Array.isArray(raw.prices) ? raw.prices : []).map(function(p) { return { price: ppMoney_(p && p.price), seen: ppYmd_(p && p.seen) }; })
    .filter(function(p) { return p.price != null; });
  prices = prices.slice();
  var price = ppMoney_(raw.price);
  if (price != null && (!prices.length || prices[prices.length - 1].price !== price)) prices.push({ price: price, seen: ppYmd_(raw.seen) });
  var checks = {};
  var rc = raw.checks && typeof raw.checks === 'object' ? raw.checks : {};
  Object.keys(rc).slice(0, 40).forEach(function(k) { var v = String(rc[k] || '').toLowerCase(); if (v === 'yes' || v === 'no') checks[ppStr_(k, 80)] = v; });
  var link = ppStr_(raw.link, 400);
  return { id: ppStr_(raw.id, 40), purchaseId: ppStr_(raw.purchaseId, 40), name: ppStr_(raw.name, 100), store: ppStr_(raw.store, 80),
    link: /^https?:\/\//i.test(link) ? link : '', prices: prices.slice(-30), checks: checks,
    delivery: ppStr_(raw.delivery, 60), leadDays: ppInt_(raw.leadDays, 0, 365), returns: ppStr_(raw.returns, 60), returnDays: ppInt_(raw.returnDays, 0, 365),
    notes: ppStr_(raw.notes, 400), ruledOut: raw.ruledOut === true || String(raw.ruledOut) === 'true' || String(raw.ruledOut).toLowerCase() === 'yes' };
}

// ---- pure: the comparison ------------------------------------------------------

/** Pure: an option's latest price, or null. */
function ppPrice_(o) { var p = (o && o.prices) || []; return p.length ? p[p.length - 1].price : null; }

/**
 * Pure: how an option fits. A must ticked no, or a No ticked yes, is a fail;
 * nice-to-haves ticked yes are counted. Unticked is unknown, not a pass.
 */
function ppScore_(p, o) {
  var c = (o && o.checks) || {};
  var mustMet = p.must.filter(function(r) { return c[r] === 'yes'; }).length;
  var fails = p.must.filter(function(r) { return c[r] === 'no'; }).length + p.no.filter(function(r) { return c[r] === 'yes'; }).length;
  var unknown = p.must.filter(function(r) { return !c[r]; }).length + p.no.filter(function(r) { return !c[r]; }).length;
  var niceMet = p.nice.filter(function(r) { return c[r] === 'yes'; }).length;
  var label = fails ? 'Fails ' + fails + ' must' + (fails === 1 ? '' : 's')
    : unknown ? mustMet + ' of ' + p.must.length + ' musts checked'
    : (p.must.length ? 'All musts' : 'No musts set') + (p.nice.length ? ' · ' + niceMet + ' of ' + p.nice.length + ' nice' : '');
  return { mustMet: mustMet, fails: fails, unknown: unknown, niceMet: niceMet, ok: !fails && !unknown, label: label };
}

/** Pure: the best option still in the running: passes everything, most nice-to-haves, then cheapest. */
function ppBest_(p, options) {
  var live = (options || []).filter(function(o) { return !o.ruledOut; }).map(function(o) { return { o: o, s: ppScore_(p, o), price: ppPrice_(o) }; })
    .filter(function(x) { return x.s.ok; });
  live.sort(function(a, b) { return b.s.niceMet - a.s.niceMet || (a.price == null ? 1e12 : a.price) - (b.price == null ? 1e12 : b.price); });
  return live[0] ? live[0].o : null;
}

// ---- pure: money and timing ------------------------------------------------------

function ppDaysBetween_(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
function ppAddDays_(ymd, n) { var p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }

/**
 * Pure: the money line. set = the goal's balance (0 with no goal), capped at the
 * budget for the bar; perWeek = what closes the gap by the need-by date.
 */
function ppMoneyLine_(p, goal, today) {
  var budget = p.budget || 0, set = goal ? Math.max(0, Number(goal.currentAmount) || 0) : 0;
  var left = Math.max(0, budget - set), weeks = p.needBy && p.needBy > today ? ppDaysBetween_(today, p.needBy) / 7 : 0;
  return { set: set, budget: budget, left: left, funded: budget > 0 && left === 0, pct: budget ? Math.min(100, Math.round(set / budget * 100)) : 0,
    perWeek: left && weeks >= 1 ? Math.ceil(left / weeks) : null, goalName: goal ? String(goal.name || '') : '' };
}

/** Pure: the date to order an option by, from its lead time and the need-by date. */
function ppOrderBy_(p, o) { return p.needBy && o && o.leadDays != null ? ppAddDays_(p.needBy, -o.leadDays) : ''; }

/** Pure: the return window's last day: days after delivery (or the order, with no delivery date). */
function ppReturnBy_(b) {
  if (!b || b.returnDays == null) return '';
  return ppAddDays_(b.deliveryTo || b.deliveryFrom || b.orderedOn, b.returnDays);
}

/** Pure: what a purchase should say up front, most pressing first. */
function ppAlerts_(p, options, today) {
  var out = [];
  if (p.stage === 'bought' && p.bought) {
    var dl = p.bought.deliveryFrom;
    if (dl && dl >= today) out.push({ tone: dl <= ppAddDays_(today, 1) ? 'soon' : 'ok', text: 'Delivery ' + (p.bought.deliveryTo && p.bought.deliveryTo !== dl ? dl + ' to ' + p.bought.deliveryTo : dl) + '.' });
    var rb = ppReturnBy_(p.bought);
    if (rb && rb >= today) out.push({ tone: rb <= ppAddDays_(today, PP_RETURN_SOON_DAYS_) ? 'soon' : 'ok', text: 'Return window ends ' + rb + '.' });
    if (p.oldItem && !p.oldPlan) out.push({ tone: 'soon', text: 'The old ' + p.oldItem.toLowerCase() + ': resell, donate or haul away?' });
    else if (p.oldItem && p.oldPlan && p.oldPlan !== 'done') out.push({ tone: 'ok', text: 'The old ' + p.oldItem.toLowerCase() + ': ' + { resell: 'listed in Resell', donate: 'to donate', haul: 'to haul away' }[p.oldPlan] + '.' });
    return out;
  }
  var best = p.chosenOption ? (options || []).filter(function(o) { return o.id === p.chosenOption; })[0] : ppBest_(p, options);
  var ob = ppOrderBy_(p, best);
  if (ob && ob <= ppAddDays_(today, PP_ORDER_SOON_DAYS_)) {
    var d = ppDaysBetween_(today, ob);
    out.push({ tone: d <= 3 ? 'soon' : 'ok', text: (best.delivery ? 'Delivery takes ' + best.delivery + '. ' : '') + (d < 0 ? 'Past the order-by date (' + ob + ') for ' + p.needBy + '.' : 'Order ' + best.name + ' by ' + ob + ' to have it by ' + p.needBy + '.') });
  }
  if (p.stage === 'waiting' && p.targetPrice != null) {
    var low = (options || []).filter(function(o) { return !o.ruledOut && ppPrice_(o) != null; }).map(function(o) { return ppPrice_(o); }).sort(function(a, b) { return a - b; })[0];
    if (low != null) out.push({ tone: low <= p.targetPrice ? 'soon' : 'ok', text: low <= p.targetPrice ? 'At or under your $' + p.targetPrice + ' target: $' + low + '.' : 'Waiting for $' + p.targetPrice + ' or less. Last price: $' + low + '.' });
  }
  return out;
}

/** Pure: the top of the page. In progress = not bought; set aside counts each goal once. */
function ppSummary_(list, goalsById) {
  var open = (list || []).filter(function(p) { return p.stage !== 'bought'; }), seen = {}, set = 0, budgets = 0;
  open.forEach(function(p) {
    budgets += p.budget || 0;
    if (p.goalId && !seen[p.goalId] && goalsById[p.goalId]) { seen[p.goalId] = 1; set += Math.max(0, Number(goalsById[p.goalId].currentAmount) || 0); }
  });
  return { inProgress: open.length, setAside: set, budgets: budgets };
}

/** Pure: the card to suggest: an active card with purchase protection or an extended warranty in Card Perks. */
function ppSuggestCard_(perks, cards) {
  var active = {};
  (cards || []).forEach(function(c) { if (c && c.name && c.active !== false) active[c.name] = 1; });
  var hit = (perks || []).filter(function(k) { return k && active[k.card] && /purchase protection|extended warranty/i.test(String(k.perk || '')); });
  if (!hit.length) return null;
  var perksOf = hit.filter(function(k) { return k.card === hit[0].card; }).map(function(k) { return k.perk; });
  return { card: hit[0].card, why: perksOf.join(' + ') };
}

/** Pure: what saving "bought" changes elsewhere: the goal, Warranties & Service. */
function ppBoughtEffects_(p, goal, today) {
  var b = p.bought, out = { goal: null, homeItem: null };
  if (!b) return out;
  if (goal) out.goal = { id: goal.id, currentAmount: Math.max(0, Math.round(((Number(goal.currentAmount) || 0) - b.price) * 100) / 100) };
  var notes = ['Bought ' + b.orderedOn + (b.store ? ' at ' + b.store : '') + ' for $' + b.price + (b.card ? ' on ' + b.card : '') + ' (Planned Purchases).'];
  var rb = ppReturnBy_(b);
  if (rb) notes.push('Return window ends ' + rb + '.');
  if (b.warrantyNote) notes.push(b.warrantyNote);
  var purchase = b.deliveryTo || b.deliveryFrom || b.orderedOn;
  var y = Number(purchase.slice(0, 4));
  out.homeItem = { item: p.item, category: 'Planned purchase', purchaseDate: purchase,
    warrantyExpiry: b.warrantyYears ? (y + b.warrantyYears) + purchase.slice(4) : '', notes: notes.join(' ') };
  return out;
}

/** Pure: the flags wanted tonight: a delivery tomorrow, an order-by close, a return window closing. */
function ppFlagsWanted_(list, optionsBy, today) {
  var wanted = {}, tomorrow = ppAddDays_(today, 1);
  (list || []).forEach(function(p) {
    var b = p.bought;
    if (p.stage === 'bought' && b) {
      if (b.deliveryFrom && (b.deliveryFrom === tomorrow || b.deliveryFrom === today))
        wanted[PP_FLAG_PREFIX_ + 'delivery|' + p.id] = { urgency: 'Medium', flag: '📦 ' + p.item + ' arrives ' + (b.deliveryFrom === today ? 'today' : 'tomorrow'),
          reason: 'Delivery window ' + b.deliveryFrom + (b.deliveryTo && b.deliveryTo !== b.deliveryFrom ? ' to ' + b.deliveryTo : '') + (p.oldItem && !p.oldPlan ? '. The old ' + p.oldItem.toLowerCase() + ' still needs a plan.' : '.') };
      var rb = ppReturnBy_(b);
      if (rb && rb >= today && rb <= ppAddDays_(today, 3))
        wanted[PP_FLAG_PREFIX_ + 'return|' + p.id] = { urgency: 'Medium', flag: '↩️ Last days to return ' + p.item, reason: 'The return window ends ' + rb + '.' };
      return;
    }
    var opts = optionsBy[p.id] || [], best = p.chosenOption ? opts.filter(function(o) { return o.id === p.chosenOption; })[0] : ppBest_(p, opts);
    var ob = ppOrderBy_(p, best);
    if (ob && ob <= ppAddDays_(today, 7))
      wanted[PP_FLAG_PREFIX_ + 'order|' + p.id] = { urgency: ob <= today ? 'High' : 'Medium', flag: '🛒 Order ' + p.item + ' by ' + ob,
        reason: best.name + (best.delivery ? ' takes ' + best.delivery : '') + ' to arrive; you need it by ' + p.needBy + (p.needNote ? ' (' + p.needNote + ')' : '') + '.' };
  });
  return wanted;
}

// ---- rows ----------------------------------------------------------------------------

function ppToRow_(p, created, updated) {
  return [p.id, p.item, p.forWho, p.why, p.budget == null ? '' : p.budget, p.needBy, p.needNote, p.goalId, p.stage,
    JSON.stringify(p.must), JSON.stringify(p.nice), JSON.stringify(p.no), p.targetPrice == null ? '' : p.targetPrice, p.chosenOption,
    p.bought ? JSON.stringify(p.bought) : '', p.oldItem, p.oldPlan, JSON.stringify(p.notes), created, updated];
}
function ppFromRow_(r) {
  var p = ppClean_({ id: r[0], item: r[1], forWho: r[2], why: r[3], budget: r[4], needBy: ppYmd_(r[5]), needNote: r[6], goalId: r[7], stage: r[8],
    must: ppParse_(r[9], []), nice: ppParse_(r[10], []), no: ppParse_(r[11], []), targetPrice: r[12], chosenOption: r[13],
    bought: ppParse_(r[14], null), oldItem: r[15], oldPlan: r[16], notes: ppParse_(r[17], []) });
  p.created = String(r[18] || ''); p.updated = String(r[19] || '');
  return p;
}
function ppOptionToRow_(o, created, updated) {
  return [o.id, o.purchaseId, o.name, o.store, o.link, JSON.stringify(o.prices), JSON.stringify(o.checks), o.delivery,
    o.leadDays == null ? '' : o.leadDays, o.returns, o.returnDays == null ? '' : o.returnDays, o.notes, o.ruledOut ? 'yes' : '', created, updated];
}
function ppOptionFromRow_(r) {
  var o = ppCleanOption_({ id: r[0], purchaseId: r[1], name: r[2], store: r[3], link: r[4], prices: ppParse_(r[5], []), checks: ppParse_(r[6], {}),
    delivery: r[7], leadDays: r[8], returns: r[9], returnDays: r[10], notes: r[11], ruledOut: r[12] });
  o.created = String(r[13] || ''); o.updated = String(r[14] || '');
  return o;
}

// ---- the sheets -----------------------------------------------------------------------

function ppSheet_()        { return ensureSheet(getSpreadsheet(), TABS.PLANNED_PURCHASES, PLANNED_PURCHASE_HEADERS); }
function ppOptionsSheet_() { return ensureSheet(getSpreadsheet(), TABS.PP_OPTIONS, PP_OPTION_HEADERS); }
function ppRows_(sheet, w) { return !sheet || sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, w).getValues().filter(function(r) { return String(r[0]).trim(); }); }
function ppRowOf_(sheet, w, id) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var k = 0; k < ids.length; k++) if (String(ids[k][0]).trim() === id) return k + 2;
  return -1;
}
function ppMint_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase(); }
function ppToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function ppLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }

function ppAll_() { return ppRows_(ppSheet_(), PLANNED_PURCHASE_HEADERS.length).map(ppFromRow_); }
function ppAllOptions_() { return ppRows_(ppOptionsSheet_(), PP_OPTION_HEADERS.length).map(ppOptionFromRow_); }
function ppGet_(id) { return ppAll_().filter(function(p) { return p.id === id; })[0] || null; }
function ppGoalsById_() { var by = {}; try { getFinancialGoals_().forEach(function(g) { by[g.id] = g; }); } catch (e) { Logger.log('planned purchases: goals unavailable'); } return by; }

/** Card names and their purchase-protection perks, for the suggestion. */
function ppCardsAndPerks_() {
  var ss = getSpreadsheet(), cards = [], perks = [];
  try {
    var cs = ss.getSheetByName(TABS.CREDIT_CARDS);
    if (cs && cs.getLastRow() >= 2) cards = cs.getRange(2, 1, cs.getLastRow() - 1, CREDIT_CARD_HEADERS.length).getValues().filter(function(r) { return r[1]; })
      .map(function(r) { return { name: String(r[1]).trim(), active: !/^(no|false|closed)$/i.test(String(r[9] || '').trim()) }; });
    var ps = ss.getSheetByName(TABS.CARD_PERKS);
    if (ps && ps.getLastRow() >= 2) perks = ps.getRange(2, 1, ps.getLastRow() - 1, 3).getValues().filter(function(r) { return r[1]; })
      .map(function(r) { return { card: String(r[1]).trim(), perk: String(r[2] || '').trim() }; });
  } catch (e) { Logger.log('planned purchases: cards unavailable'); }
  return { cards: cards, perks: perks };
}

// ---- endpoints -------------------------------------------------------------------------

/** GET planned_purchases → every purchase with its options, score, money, timing and alerts. */
function webPlannedPurchases_() {
  var today = ppToday_(), goals = ppGoalsById_(), list = ppAll_(), opts = ppAllOptions_(), by = {};
  opts.forEach(function(o) { (by[o.purchaseId] = by[o.purchaseId] || []).push(o); });
  var cp = ppCardsAndPerks_();
  var out = list.map(function(p) {
    var options = (by[p.id] || []).map(function(o) {
      return Object.assign({}, o, { price: ppPrice_(o), score: ppScore_(p, o), orderBy: ppOrderBy_(p, o) });
    });
    var best = ppBest_(p, by[p.id] || []);
    return Object.assign({}, p, { options: options, bestId: best ? best.id : '', money: ppMoneyLine_(p, goals[p.goalId], today),
      alerts: ppAlerts_(p, by[p.id] || [], today), returnBy: ppReturnBy_(p.bought) });
  });
  return { ok: true, today: today, purchases: out, summary: ppSummary_(list, goals),
    goals: Object.keys(goals).map(function(k) { var g = goals[k]; return { id: g.id, name: g.name, currentAmount: g.currentAmount, status: g.status }; })
      .filter(function(g) { return String(g.status || 'Active') !== 'Achieved'; }),
    cards: cp.cards.filter(function(c) { return c.active; }).map(function(c) { return c.name; }), suggestedCard: ppSuggestCard_(cp.perks, cp.cards) };
}

/**
 * POST {action:'pp_save', purchase, newGoal} → creates or updates a purchase.
 * A field the dashboard leaves out keeps what the sheet has. newGoal makes a
 * Financial Goal for it (its name, budget and need-by date) and links it.
 */
function webPpSave_(body) {
  var raw = (body && body.purchase) || {};
  return ppLocked_(function() {
    var sheet = ppSheet_(), w = PLANNED_PURCHASE_HEADERS.length, now = new Date().toISOString();
    var id = ppStr_(raw.id, 40), row = id ? ppRowOf_(sheet, w, id) : -1;
    if (id && row === -1) return { ok: false, error: 'That purchase no longer exists' };
    var stored = row === -1 ? {} : ppFromRow_(sheet.getRange(row, 1, 1, w).getValues()[0]);
    var merged = Object.assign({}, stored);
    Object.keys(raw).forEach(function(k) { if (raw[k] !== undefined) merged[k] = raw[k]; });
    var p = ppClean_(merged);
    if (!p.item) return { ok: false, error: 'Say what it is' };
    if (body && body.newGoal && p.budget) {
      try { p.goalId = createFinancialGoal_({ name: p.item, targetAmount: p.budget, targetDate: p.needBy, owner: p.forWho === 'Shared' ? 'Joint' : p.forWho, notes: 'Planned Purchases' }); }
      catch (e) { return { ok: false, error: 'The savings goal could not be made: ' + e.message }; }
    }
    if (row === -1) { p.id = ppMint_('PP-'); sheet.appendRow(ppToRow_(p, now, now)); }
    else sheet.getRange(row, 1, 1, w).setValues([ppToRow_(p, stored.created || now, now)]);
    return { ok: true, purchase: p };
  });
}

/** POST {action:'pp_note_add', id, text, link} → a dated research note. */
function webPpNoteAdd_(body) {
  var p = ppGet_(ppStr_(body && body.id, 40));
  if (!p) return { ok: false, error: 'That purchase no longer exists' };
  var note = { date: ppToday_(), text: body.text, link: body.link };
  if (!ppStr_(note.text, 400) && !ppStr_(note.link, 400)) return { ok: false, error: 'Write the note first' };
  return webPpSave_({ purchase: { id: p.id, notes: p.notes.concat([note]) } });
}

/** POST {action:'pp_option_save', option} → creates or updates an option; a changed price joins its history. */
function webPpOptionSave_(body) {
  var raw = (body && body.option) || {};
  return ppLocked_(function() {
    if (!ppGet_(ppStr_(raw.purchaseId, 40))) return { ok: false, error: 'That purchase no longer exists' };
    var sheet = ppOptionsSheet_(), w = PP_OPTION_HEADERS.length, now = new Date().toISOString();
    var id = ppStr_(raw.id, 40), row = id ? ppRowOf_(sheet, w, id) : -1;
    if (id && row === -1) return { ok: false, error: 'That option no longer exists' };
    var stored = row === -1 ? null : ppOptionFromRow_(sheet.getRange(row, 1, 1, w).getValues()[0]);
    var merged = Object.assign({}, stored || {});
    Object.keys(raw).forEach(function(k) { if (raw[k] !== undefined && k !== 'prices') merged[k] = raw[k]; });
    if (!merged.seen) merged.seen = ppToday_();
    var o = ppCleanOption_(merged, stored);
    if (!o.name) return { ok: false, error: 'Name the option' };
    if (row === -1) { o.id = ppMint_('PPO-'); sheet.appendRow(ppOptionToRow_(o, now, now)); }
    else sheet.getRange(row, 1, 1, w).setValues([ppOptionToRow_(o, stored.created || now, now)]);
    return { ok: true, option: o };
  });
}

/** POST {action:'pp_option_delete', id}. */
function webPpOptionDelete_(body) {
  var id = ppStr_(body && body.id, 40);
  return ppLocked_(function() {
    var sheet = ppOptionsSheet_(), row = id ? ppRowOf_(sheet, PP_OPTION_HEADERS.length, id) : -1;
    if (row === -1) return { ok: false, error: 'That option no longer exists' };
    sheet.deleteRow(row);
    return { ok: true, id: id };
  });
}

/** POST {action:'pp_delete', id} → the purchase and its options. Its goal and any warranty entry stay. */
function webPpDelete_(body) {
  var id = ppStr_(body && body.id, 40);
  return ppLocked_(function() {
    var sheet = ppSheet_(), row = id ? ppRowOf_(sheet, PLANNED_PURCHASE_HEADERS.length, id) : -1;
    if (row === -1) return { ok: false, error: 'That purchase no longer exists' };
    sheet.deleteRow(row);
    var os = ppOptionsSheet_(), rows = os.getLastRow() >= 2 ? os.getRange(2, 1, os.getLastRow() - 1, 2).getValues() : [], n = 0;
    for (var k = rows.length - 1; k >= 0; k--) if (String(rows[k][1]).trim() === id) { os.deleteRow(k + 2); n++; }
    return { ok: true, id: id, optionsRemoved: n };
  });
}

/**
 * POST {action:'pp_mark_bought', id, bought} → saved as bought, then: the price
 * comes out of the goal and the item goes to Warranties & Service. A delivery
 * reminder is a nightly flag (ppFlagsWanted_), and Coming up reads deliveries
 * and return windows straight from this sheet.
 */
function webPpMarkBought_(body) {
  var p = ppGet_(ppStr_(body && body.id, 40));
  if (!p) return { ok: false, error: 'That purchase no longer exists' };
  if (p.stage === 'bought' && p.bought) return { ok: false, error: 'Already marked as bought' };
  var b = ppCleanBought_(body && body.bought);
  if (!b) return { ok: false, error: 'Enter the price paid and the order date' };
  if (b.optionId) {
    var o = ppAllOptions_().filter(function(x) { return x.id === b.optionId && x.purchaseId === p.id; })[0];
    if (o) { if (!b.store) b.store = o.store || o.name; if (b.returnDays == null) b.returnDays = o.returnDays; }
  }
  var saved = webPpSave_({ purchase: { id: p.id, stage: 'bought', bought: b, chosenOption: b.optionId || p.chosenOption } });
  if (!saved.ok) return saved;
  var goals = ppGoalsById_(), fx = ppBoughtEffects_(saved.purchase, goals[p.goalId], ppToday_()), done = [];
  if (fx.goal) { try { updateFinancialGoal_(fx.goal.id, { currentAmount: fx.goal.currentAmount }); done.push('goal'); } catch (e) { Logger.log('pp_mark_bought: goal not updated'); } }
  if (fx.homeItem) { try { webAddHomeItem_({ parameter: fx.homeItem }); done.push('warranty'); } catch (e) { Logger.log('pp_mark_bought: warranty entry not added'); } }
  var under = p.budget != null ? Math.round((p.budget - b.price) * 100) / 100 : null;
  return { ok: true, purchase: saved.purchase, done: done, underBudget: under };
}

/** POST {action:'pp_old_plan', id, plan} → resell (adds it to the Resell list), donate, haul, done. */
function webPpOldPlan_(body) {
  var p = ppGet_(ppStr_(body && body.id, 40));
  if (!p) return { ok: false, error: 'That purchase no longer exists' };
  var plan = ppOneOf_(body && body.plan, PP_OLD_, '');
  if (!p.oldItem) return { ok: false, error: 'This purchase does not replace anything' };
  if (plan === 'resell' && p.oldPlan !== 'resell') {
    try { webAddResellItem_({ parameter: { item: 'Old ' + p.oldItem.toLowerCase(), category: 'Other', notes: 'Replaced by ' + p.item + ' (Planned Purchases)' } }); }
    catch (e) { return { ok: false, error: 'Could not add it to Resell: ' + e.message }; }
  }
  return webPpSave_({ purchase: { id: p.id, oldPlan: plan } });
}

/** Coming up (Household): deliveries in the next 14 days and return windows closing within a week. */
function ppComingUp_(today) {
  var out = [], soon = ppAddDays_(today, 14);
  ppAll_().forEach(function(p) {
    var b = p.bought;
    if (p.stage !== 'bought' || !b) return;
    if (b.deliveryFrom && b.deliveryFrom >= today && b.deliveryFrom <= soon)
      out.push({ kind: 'delivery', section: 'steward', label: p.item, detail: 'Delivery ' + b.deliveryFrom + (b.deliveryTo && b.deliveryTo !== b.deliveryFrom ? '–' + b.deliveryTo : ''), date: b.deliveryFrom,
        tone: b.deliveryFrom <= ppAddDays_(today, 1) ? 'soon' : 'ok' });
    var rb = ppReturnBy_(b);
    if (rb && rb >= today && rb <= ppAddDays_(today, PP_RETURN_SOON_DAYS_))
      out.push({ kind: 'return', section: 'steward', label: p.item, detail: 'Return window ends ' + rb, date: rb, tone: 'soon' });
  });
  return out;
}

/** Nightly: delivery, order-by and return flags, raised and closed by key. */
function ppSyncFlags_() {
  var flags = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flags) return { skipped: 'no Flags tab' };
  var today = ppToday_(), by = {};
  ppAllOptions_().forEach(function(o) { (by[o.purchaseId] = by[o.purchaseId] || []).push(o); });
  var wanted = ppFlagsWanted_(ppAll_(), by, today);
  upsertKeyedFlags_(flags, PP_FLAG_PREFIX_, 'Finances', wanted, today);
  return { wanted: Object.keys(wanted).length };
}
