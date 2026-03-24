// ============================================================
// SMART PURCHASE HISTORY & CONSUMPTION INTELLIGENCE — Issue #111
// Learns consumption rates from purchase history via EMA and
// auto-restocks the shopping Google Doc when items are due.
// No real-time pantry inventory — everything derived from
// purchase intervals (how often you buy, not how much is left).
// ============================================================

// ─── BOOTSTRAP DEFAULTS ──────────────────────────────────────
// Sensible starting intervals (days) before purchase history accumulates.
var PANTRY_DEFAULTS = {
  'milk': 7, 'eggs': 14, 'bread': 7, 'butter': 21, 'cheese': 14,
  'yogurt': 7, 'coffee': 30, 'tea': 30,
  'toilet paper': 14, 'paper towels': 21,
  'dish soap': 30, 'laundry detergent': 30, 'olive oil': 30,
  'pasta': 21, 'rice': 30, 'chicken': 7, 'ground beef': 7,
  'dishwasher pods': 30, 'garbage bags': 30, 'hand soap': 21,
  'shampoo': 30, 'conditioner': 30, 'toothpaste': 30,
};

// ─── NORMALIZATION ────────────────────────────────────────────

/**
 * Converts a raw item text to a canonical lowercase form for EMA grouping.
 * Strips leading quantity tokens (e.g. "2x", "2L", "24ct"), lowercases.
 * Claude receipt scan already provides canonical names — this cleans up
 * checkout-button items (user-written text in the Google Doc).
 */
function normalizeItemName_(rawText) {
  if (!rawText) return '';
  return String(rawText)
    .toLowerCase()
    .replace(/^\d+(\.\d+)?\s*(x|l|ml|oz|lb|kg|g|ct|pk|pack|each|unit|units)\s+/i, '') // leading qty+unit
    .replace(/^\d+\s*x\s*/i, '')   // "2x " prefix
    .replace(/\s+\d+(\.\d+)?\s*(l|ml|oz|lb|kg|g|ct|pk|pack)\b/gi, '') // trailing qty+unit
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── SHEET ACCESS ─────────────────────────────────────────────

function getPurchaseHistorySheet_() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(TABS.PURCHASE_HISTORY);
  if (!sh) throw new Error('Purchase History tab not found. Run createSheetTabs() to create it.');
  return sh;
}

// ─── READ FUNCTIONS ───────────────────────────────────────────

/**
 * Returns all purchase rows matching a normalized item name.
 * Matches exactly first, then fuzzy (≥70% token overlap).
 * Sorted by date ascending.
 */
function getPurchaseRows_(normalizedName) {
  var sh = getPurchaseHistorySheet_();
  if (sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, PURCHASE_HISTORY_HEADERS.length).getValues();
  var target = (normalizedName || '').toLowerCase().trim();
  var targetTokens = target.split(/\s+/).filter(function(t) { return t.length > 1; });

  var results = [];
  data.forEach(function(row) {
    var norm = String(row[2] || '').toLowerCase().trim(); // col 3 = Normalized
    if (!norm) return;

    var isMatch = (norm === target);
    if (!isMatch && targetTokens.length > 0) {
      var normTokens = norm.split(/\s+/).filter(function(t) { return t.length > 1; });
      if (normTokens.length > 0) {
        var shared = targetTokens.filter(function(t) { return normTokens.indexOf(t) !== -1; });
        var overlap = shared.length / Math.max(targetTokens.length, normTokens.length);
        isMatch = overlap >= 0.7;
      }
    }
    if (!isMatch) return;

    results.push({
      id:       String(row[0]  || ''),
      item:     String(row[1]  || ''),
      normalized: String(row[2] || ''),
      category: String(row[3]  || ''),
      date:     (row[4] instanceof Date && !isNaN(row[4].getTime()))
                  ? Utilities.formatDate(row[4], Session.getScriptTimeZone(), 'yyyy-MM-dd')
                  : String(row[4] || '').trim(),
      qty:      row[5]  !== '' ? parseFloat(row[5])  : null,
      unit:     String(row[6]  || ''),
      store:    String(row[7]  || ''),
      price:    row[8]  !== '' ? parseFloat(row[8])  : null,
      source:   String(row[9]  || ''),
      notes:    String(row[10] || ''),
    });
  });

  // Sort by date ascending
  results.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return results;
}

/**
 * Returns all distinct normalized item names from Purchase History.
 */
function getAllTrackedItems_() {
  var sh = getPurchaseHistorySheet_();
  if (sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues(); // col 3 = Normalized
  var seen = {};
  data.forEach(function(row) {
    var n = String(row[0] || '').trim();
    if (n) seen[n] = true;
  });
  return Object.keys(seen);
}

// ─── EMA ALGORITHM ───────────────────────────────────────────

/**
 * Exponential Moving Average of an array of numbers.
 * alpha = 0.3 → recent purchases weighted 30%, history 70%.
 * Higher alpha = faster adaptation to new patterns.
 */
function calcEMA_(values, alpha) {
  if (!values || values.length === 0) return null;
  if (values.length === 1) return values[0];
  var ema = values[0];
  for (var i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}

/**
 * Computes the depletion rate for an item.
 * Returns { avgDays, confidence, dataPoints }
 *   confidence: 'default' | 'learning' | 'building' | 'calibrated'
 */
function getDepletionRate_(normalizedName) {
  var cfg   = getConfigValues();
  var alpha = parseFloat(cfg['pantry_ema_alpha'] || '0.3') || 0.3;

  var rows  = getPurchaseRows_(normalizedName);
  if (rows.length < 2) {
    // Fewer than 2 purchases → no interval to compute
    var defaultDays = PANTRY_DEFAULTS[normalizedName] || 30;
    return {
      avgDays:    defaultDays,
      confidence: rows.length === 0 ? 'default' : 'learning',
      dataPoints: rows.length,
    };
  }

  // Compute gaps (days) between consecutive purchases
  var intervals = [];
  for (var i = 1; i < rows.length; i++) {
    var prev = new Date(rows[i - 1].date + 'T00:00:00');
    var curr = new Date(rows[i].date     + 'T00:00:00');
    var days = Math.round((curr - prev) / 86400000);
    if (days > 0) intervals.push(days);
  }
  if (!intervals.length) {
    return { avgDays: PANTRY_DEFAULTS[normalizedName] || 30, confidence: 'learning', dataPoints: rows.length };
  }

  var ema = calcEMA_(intervals, alpha);
  return {
    avgDays:    Math.round(ema),
    confidence: rows.length >= 4 ? 'calibrated' : rows.length === 3 ? 'building' : 'learning',
    dataPoints: rows.length,
  };
}

/**
 * Returns the most recent purchase row for an item, or null.
 */
function getLastPurchase_(normalizedName) {
  var rows = getPurchaseRows_(normalizedName);
  if (!rows.length) return null;
  return rows[rows.length - 1];
}

/**
 * Returns the store most frequently used for this item.
 * Falls back to the first Google Doc tab name.
 */
function getPreferredStore_(normalizedName) {
  var rows = getPurchaseRows_(normalizedName);
  if (!rows.length) {
    // Fall back to first tab in the shopping Google Doc
    try {
      var list = getShoppingList_();
      return list.length ? list[0].storeName : '';
    } catch (e) { return ''; }
  }
  var counts = {};
  rows.forEach(function(r) {
    if (r.store) counts[r.store] = (counts[r.store] || 0) + 1;
  });
  var best = '', bestCount = 0;
  Object.keys(counts).forEach(function(s) {
    if (counts[s] > bestCount) { bestCount = counts[s]; best = s; }
  });
  return best;
}

// ─── ITEMS DUE ────────────────────────────────────────────────

/**
 * Returns items predicted to run out within `daysAhead` days.
 * Each entry: { normalized, lastDate, estimatedEmpty, daysUntil, store, confidence, dataPoints }
 * Sorted by daysUntil ascending (most urgent first).
 */
function getItemsDue_(daysAhead) {
  var horizon = parseInt(daysAhead, 10) || 7;
  var today   = new Date();
  today.setHours(0, 0, 0, 0);
  var items   = getAllTrackedItems_();
  var results = [];

  items.forEach(function(norm) {
    try {
      var last = getLastPurchase_(norm);
      if (!last || !last.date) return;
      var rate = getDepletionRate_(norm);
      var lastD = new Date(last.date + 'T00:00:00');
      var emptyD = new Date(lastD.getTime() + rate.avgDays * 86400000);
      var daysUntil = Math.round((emptyD - today) / 86400000);
      if (daysUntil <= horizon) {
        results.push({
          normalized:     norm,
          lastDate:       last.date,
          estimatedEmpty: Utilities.formatDate(emptyD, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          daysUntil:      daysUntil,
          store:          getPreferredStore_(norm),
          confidence:     rate.confidence,
          dataPoints:     rate.dataPoints,
          avgDays:        rate.avgDays,
        });
      }
    } catch (e) { Logger.log('getItemsDue_ item error [' + norm + ']: ' + e.message); }
  });

  results.sort(function(a, b) { return a.daysUntil - b.daysUntil; });
  return results;
}

// ─── LOGGING ─────────────────────────────────────────────────

/**
 * Core write function — appends purchase rows to Purchase_History sheet.
 * items: [{ item, normalized, category, qty, unit, store, price }]
 * source: 'checkout' | 'receipt' | 'manual'
 */
function logPurchaseItems_(items, source) {
  if (!items || !items.length) return { ok: false, count: 0, error: 'No items provided' };
  var sh     = getPurchaseHistorySheet_();
  var tz     = Session.getScriptTimeZone();
  var today  = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Pre-read existing IDs to handle same-day duplicates
  var existingIds = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (id) existingIds[id] = true;
    });
  }

  var rows = [];
  items.forEach(function(item) {
    var rawItem  = String(item.item      || '').trim();
    var norm     = String(item.normalized || normalizeItemName_(rawItem)).trim();
    var baseId   = 'PH-' + today + '-' + norm.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    var id       = baseId;
    var suffix   = 2;
    while (existingIds[id]) { id = baseId + '-' + suffix; suffix++; }
    existingIds[id] = true;

    rows.push([
      id,
      rawItem,
      norm,
      String(item.category || 'Other').trim(),
      today,
      item.qty   != null ? item.qty   : '',
      String(item.unit  || '').trim(),
      String(item.store || '').trim(),
      item.price != null ? item.price : '',
      source || 'manual',
      String(item.notes || '').trim(),
    ]);
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, PURCHASE_HISTORY_HEADERS.length).setValues(rows);
  }
  Logger.log('logPurchaseItems_: logged ' + rows.length + ' item(s) from source=' + source);
  return { ok: true, count: rows.length };
}

/**
 * Logs a batch of checked-off items from the shopping list.
 * Called by the "📦 Log Run" button.
 * itemTexts: array of raw text strings (item names from the Google Doc).
 * storeTabId: the Google Doc tab ID for the store.
 */
function logPurchaseRun_(storeTabId, itemTexts) {
  if (!itemTexts || !itemTexts.length) return { ok: false, count: 0, error: 'No items' };

  // Resolve store name from tab ID
  var storeName = storeTabId;
  try {
    var list = getShoppingList_();
    var match = list.filter(function(s) { return s.tabId === storeTabId; });
    if (match.length) storeName = match[0].storeName;
  } catch (e) {}

  var items = itemTexts.map(function(text) {
    var raw  = String(text || '').replace(/^🤖\s*/, '').replace(/\s*\(est\..*?\)$/, '').trim();
    var norm = normalizeItemName_(raw);
    return { item: raw, normalized: norm, category: 'Other', qty: null, unit: '', store: storeName, price: null };
  });

  return logPurchaseItems_(items, 'checkout');
}

// ─── AUTO-RESTOCK ─────────────────────────────────────────────

/**
 * Nightly: finds items due within pantry_restock_days_ahead days,
 * checks if they're already in the shopping list, and auto-adds
 * missing ones with a 🤖 prefix to the correct store tab.
 */
function autoRestockItems_() {
  var cfg = getConfigValues();
  if ((cfg['pantry_enabled'] || 'false') !== 'true') {
    Logger.log('autoRestockItems_: disabled (pantry_enabled != true)'); return;
  }
  var daysAhead = parseInt(cfg['pantry_restock_days_ahead'] || '7', 10) || 7;
  var due       = getItemsDue_(daysAhead);
  if (!due.length) { Logger.log('autoRestockItems_: no items due in ' + daysAhead + ' days'); return; }

  // Fetch current shopping list to avoid duplicates
  var currentList = {};
  try {
    var shopData = getShoppingList_();
    shopData.forEach(function(store) {
      var key = store.storeName.toLowerCase();
      currentList[key] = store.items.map(function(i) {
        return i.text.toLowerCase().replace(/^🤖\s*/, '').replace(/\s*\(est\..*?\)$/, '').trim();
      });
      currentList['_tabId_' + key] = store.tabId;
    });
  } catch (e) { Logger.log('autoRestockItems_: could not read shopping list — ' + e.message); return; }

  var tz      = Session.getScriptTimeZone();
  var added   = [];
  var skipped = [];

  due.forEach(function(item) {
    try {
      var storeKey = (item.store || '').toLowerCase();
      var items    = currentList[storeKey] || Object.values(currentList).find(function(v) { return Array.isArray(v); }) || [];
      var tabId    = currentList['_tabId_' + storeKey] || '';

      // If no tab found, pick the first store tab
      if (!tabId) {
        var keys = Object.keys(currentList).filter(function(k) { return !k.startsWith('_'); });
        if (keys.length) tabId = currentList['_tabId_' + keys[0]];
      }
      if (!tabId) { skipped.push(item.normalized + ' (no store tab)'); return; }

      // Check if already in list (case-insensitive, strip 🤖 prefix)
      var alreadyIn = items.some(function(t) {
        return t.replace(/^🤖\s*/, '').replace(/\s*\(est\..*?\)$/, '').trim() === item.normalized;
      });
      if (alreadyIn) { skipped.push(item.normalized + ' (already in list)'); return; }

      // Format estimated date
      var estDate = '';
      try {
        var d = new Date(item.estimatedEmpty + 'T00:00:00');
        estDate = Utilities.formatDate(d, tz, 'MMM d');
      } catch (de) { estDate = item.estimatedEmpty; }

      var label = '\uD83E\uDD16 ' + item.normalized + ' (est. ~' + estDate + ')'; // 🤖
      addShoppingItem_(tabId, label);
      added.push(item.normalized + ' \u2192 ' + (item.store || tabId));
    } catch (e) { Logger.log('autoRestockItems_ item error [' + item.normalized + ']: ' + e.message); }
  });

  Logger.log('autoRestockItems_: added=[' + added.join(', ') + '] skipped=[' + skipped.join(', ') + ']');
}

// ─── TRIP-AWARE FLAGS ─────────────────────────────────────────

/**
 * Generates nightly flags when items run out during an upcoming trip window.
 * Checks the ITINERARY sheet for trip date ranges.
 */
function generatePantryFlags_() {
  var cfg = getConfigValues();
  if ((cfg['pantry_enabled'] || 'false') !== 'true') return;

  // Items due in the next 14 days
  var due = getItemsDue_(14);
  if (!due.length) return;

  // Read trip date ranges from ITINERARY sheet
  var trips = [];
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (sh && sh.getLastRow() >= 2) {
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
      var tripMap = {};
      rows.forEach(function(row) {
        var tk  = String(row[1] || '').trim(); // Trip Key
        var ds  = String(row[4] || '').trim(); // Date
        if (!tk || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
        if (!tripMap[tk]) tripMap[tk] = { key: tk, dates: [] };
        tripMap[tk].dates.push(ds);
      });
      Object.keys(tripMap).forEach(function(tk) {
        var dates = tripMap[tk].dates.sort();
        var start = new Date(dates[0] + 'T00:00:00');
        var end   = new Date(dates[dates.length - 1] + 'T00:00:00');
        var now   = new Date(); now.setHours(0,0,0,0);
        var daysToStart = Math.round((start - now) / 86400000);
        if (daysToStart >= 0 && daysToStart <= 30) {
          trips.push({ key: tk, label: tk.split('|')[1] || tk, start: dates[0], end: dates[dates.length - 1], daysToStart: daysToStart });
        }
      });
    }
  } catch (e) { Logger.log('generatePantryFlags_: itinerary read error — ' + e.message); return; }

  if (!trips.length) return;

  var flags = [];
  due.forEach(function(item) {
    trips.forEach(function(trip) {
      // Does the item's estimated empty date fall within the trip window?
      if (item.estimatedEmpty >= trip.start && item.estimatedEmpty <= trip.end) {
        var safeNorm = item.normalized.replace(/[^a-zA-Z0-9]/g, '_');
        var safeTripKey = trip.key.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        flags.push({
          source:  'Pantry Tracker',
          urgency: 'Low',
          flag:    item.normalized + ' will run out during your ' + trip.label + ' trip',
          reason:  item.normalized.charAt(0).toUpperCase() + item.normalized.slice(1) +
                   ' is estimated to run out ~' + item.estimatedEmpty +
                   ', which falls during your ' + trip.label + ' trip (' + trip.start + '–' + trip.end + '). ' +
                   'Consider buying before ' + trip.start + ', or restocking when you return.',
          key:     'pantry_trip_overlap_' + safeNorm + '_' + safeTripKey,
        });
      }
    });
  });

  if (flags.length) {
    writeFlags(flags);
    Logger.log('generatePantryFlags_: wrote ' + flags.length + ' trip-overlap flag(s)');
  }
}

// ─── DASHBOARD DATA ───────────────────────────────────────────

/**
 * Returns all tracked items with EMA stats for the History dashboard tab.
 * Each entry: { normalized, lastItem, lastDate, lastStore, avgDays, confidence, dataPoints, estimatedNext }
 */
function getPurchaseStats_() {
  var items = getAllTrackedItems_();
  var tz    = Session.getScriptTimeZone();
  var stats = [];

  items.forEach(function(norm) {
    try {
      var last = getLastPurchase_(norm);
      var rate = getDepletionRate_(norm);
      var estimatedNext = '';
      if (last && last.date) {
        var nextD = new Date(new Date(last.date + 'T00:00:00').getTime() + rate.avgDays * 86400000);
        estimatedNext = Utilities.formatDate(nextD, tz, 'yyyy-MM-dd');
      }
      stats.push({
        normalized:    norm,
        lastItem:      last ? last.item   : norm,
        lastDate:      last ? last.date   : '',
        lastStore:     last ? last.store  : '',
        avgDays:       rate.avgDays,
        confidence:    rate.confidence,
        dataPoints:    rate.dataPoints,
        estimatedNext: estimatedNext,
      });
    } catch (e) { Logger.log('getPurchaseStats_ item error [' + norm + ']: ' + e.message); }
  });

  stats.sort(function(a, b) { return a.normalized < b.normalized ? -1 : 1; });
  return stats;
}

// ─── TEST ─────────────────────────────────────────────────────

/**
 * Run from Apps Script editor to verify.
 * Set pantry_enabled=true in Config first.
 */
function testPantry() {
  Logger.log('=== testPantry ===');
  var cfg = getConfigValues();
  Logger.log('pantry_enabled=' + cfg['pantry_enabled']);

  var items = getAllTrackedItems_();
  Logger.log('Tracked items: ' + items.join(', '));

  if (items.length) {
    var sample = items[0];
    var rate   = getDepletionRate_(sample);
    var last   = getLastPurchase_(sample);
    Logger.log('[' + sample + '] avgDays=' + rate.avgDays + ' confidence=' + rate.confidence + ' dataPoints=' + rate.dataPoints);
    Logger.log('[' + sample + '] lastPurchase=' + JSON.stringify(last));
  }

  var due = getItemsDue_(7);
  Logger.log('Items due in 7 days: ' + due.map(function(d) { return d.normalized + '(' + d.daysUntil + 'd)'; }).join(', '));

  Logger.log('Running autoRestockItems_...');
  autoRestockItems_();

  Logger.log('Running generatePantryFlags_...');
  generatePantryFlags_();

  Logger.log('=== testPantry done ===');
}
