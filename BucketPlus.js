// ============================================================
// VERA — BucketPlus.js
// Travel › Bucket List, release 2 (issue #228): when to go, what it costs in
// vacation days and points, and which places make a long weekend.
// ============================================================
//
// Place Facts (one row per place, one Claude call each, editable):
//   Best Months   the months a place is at its best (1–12). A suggestion fills a
//                 bucket row's new Best Months column when it is blank; editing
//                 the row wins from then on.
//   Flights       direct flights from the home airports (Config home_airports):
//                 [{from, minutes, seasonal}], an estimate, not a schedule
//
// The plan screen (POST places_plan_preview) also answers:
//   months   which months suit every chosen place, and which suit some
//   sample   a sample trip in the first good month (nights from the brief, or 7)
//   people   each traveller's vacation days left that year (from the work
//            calendars, as Trip Ideas reads them) and what the sample trip uses
//
// GET places also carries what the cards need without asking anything new:
// the cached facts, the home airports, the award table (Config rows
// award_<region>_<cabin> = "Programme:points", one way, one seat, with defaults)
// and the points held per programme (Loyalty Programs).
//
// Nothing here writes ARIA's sheet: "Ask ARIA" copies a request out.
// ============================================================

var BP_MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var BP_LONG_WEEKEND_MIN_ = 420;
// One way, one seat, saver level. Always shown as "about".
var BP_AWARDS_DEFAULT_ = {
  europe:        { economy: ['United', 30000], business: ['United', 60000] },
  asia:          { economy: ['United', 35000], business: ['United', 80000] },
  africa:        { economy: ['United', 40000], business: ['United', 80000] },
  north_america: { economy: ['United', 12500], business: ['United', 35000] },
  south_america: { economy: ['United', 30000], business: ['United', 60000] },
  oceania:       { economy: ['United', 40000], business: ['United', 88000] },
};
var BP_TRANSFERABLE_ = /ultimate rewards|membership rewards|thankyou|capital one|bilt|chase|amex|citi/i;

// ---- pure ---------------------------------------------------------------------

/** Months from "Apr–Jun, Sep", "4,5,6,9", ["Apr", 5] … → [4,5,6,9]. */
function bpMonths_(v) {
  var parts = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;/]+/), out = {};
  var num = function(x) {
    x = String(x).trim().toLowerCase();
    if (/^\d{1,2}$/.test(x)) { var n = +x; return n >= 1 && n <= 12 ? n : 0; }
    var i = BP_MONTHS_.map(function(m) { return m.toLowerCase(); }).indexOf(x.slice(0, 3));
    return i === -1 ? 0 : i + 1;
  };
  parts.forEach(function(p) {
    var r = String(p).split(/\s*[–—-]\s*|\s+to\s+/i);
    var a = num(r[0]), b = r.length > 1 ? num(r[1]) : a;
    if (!a || !b) return;
    for (var m = a, k = 0; k < 12; k++) { out[m] = 1; if (m === b) break; m = m % 12 + 1; }
  });
  return Object.keys(out).map(Number).sort(function(x, y) { return x - y; });
}

/** [4,5,6,9] → "Apr–Jun, Sep". */
function bpMonthsText_(ms) {
  ms = (ms || []).slice().sort(function(a, b) { return a - b; });
  var out = [], i = 0;
  while (i < ms.length) {
    var j = i;
    while (j + 1 < ms.length && ms[j + 1] === ms[j] + 1) j++;
    out.push(j - i >= 2 ? BP_MONTHS_[ms[i] - 1] + '–' + BP_MONTHS_[ms[j] - 1] : ms.slice(i, j + 1).map(function(m) { return BP_MONTHS_[m - 1]; }).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}

/** The months every place with best months shares, and the months any of them likes. */
function bpOverlap_(lists) {
  var known = (lists || []).filter(function(l) { return l && l.length; }), all = [], some = {};
  known.forEach(function(l) { l.forEach(function(m) { some[m] = (some[m] || 0) + 1; }); });
  Object.keys(some).forEach(function(m) { if (some[m] === known.length) all.push(+m); });
  return { all: all.sort(function(a, b) { return a - b; }), some: Object.keys(some).map(Number).sort(function(a, b) { return a - b; }), known: known.length, count: some };
}

/** A sample trip: the first Saturday of the first good month from next month on, home `nights` later. */
function bpSampleTrip_(months, today, nights) {
  nights = Math.max(1, Math.min(30, Number(nights) || 7));
  if (!months || !months.length) return null;
  var y = +today.slice(0, 4), m = +today.slice(5, 7);
  for (var k = 1; k <= 12; k++) {
    var mm = (m - 1 + k) % 12 + 1, yy = y + Math.floor((m - 1 + k) / 12);
    if (months.indexOf(mm) === -1) continue;
    var d = new Date(Date.UTC(yy, mm - 1, 1));
    while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
    var start = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + nights);
    return { start: start, end: d.toISOString().slice(0, 10), nights: nights, month: mm, monthName: BP_MONTHS_[mm - 1] };
  }
  return null;
}

/** The award table: defaults, then Config award_<region>_<cabin> = "Programme:points". */
function bpAwards_(cfg) {
  var out = JSON.parse(JSON.stringify(BP_AWARDS_DEFAULT_));
  Object.keys(cfg || {}).forEach(function(k) {
    var m = /^award_([a-z_]+)_(economy|premium|business|first)$/.exec(k);
    if (!m) return;
    var v = /^\s*([^:]+?)\s*:\s*([\d,]+)\s*$/.exec(String(cfg[k]));
    if (!v) return;
    (out[m[1]] = out[m[1]] || {})[m[2]] = [v[1], Number(v[2].replace(/,/g, ''))];
  });
  return out;
}

/** Points held per programme (Loyalty Programs rows with headers), and the transferable total. */
function bpBalances_(rows) {
  var h = (rows[0] || []).map(function(x) { return String(x).trim(); }), pi = h.indexOf('Program'), ti = h.indexOf('Total Points');
  var by = {}, transferable = 0;
  if (pi === -1 || ti === -1) return { by: by, transferable: 0 };
  rows.slice(1).forEach(function(r) {
    var p = String(r[pi] || '').trim(), n = Number(String(r[ti] || '').replace(/[^\d.]/g, '')) || 0;
    if (!p || !n) return;
    by[p] = (by[p] || 0) + n;
    if (BP_TRANSFERABLE_.test(p)) transferable += n;
  });
  return { by: by, transferable: transferable };
}

/** Claude's facts, cleaned: best months, and direct flights only from the home airports. */
function bpCleanFacts_(j, homes) {
  j = j || {};
  var hs = (homes || []).map(function(x) { return String(x).toUpperCase(); });
  var flights = (Array.isArray(j.flights) ? j.flights : []).map(function(f) {
    var from = String((f && f.from) || '').toUpperCase().trim(), min = Math.round(Number(f && f.minutes));
    return { from: from, minutes: min, seasonal: !!(f && f.seasonal) };
  }).filter(function(f) { return /^[A-Z]{3}$/.test(f.from) && hs.indexOf(f.from) !== -1 && f.minutes >= 30 && f.minutes <= 1200; });
  flights.sort(function(a, b) { return a.minutes - b.minutes; });
  return { bestMonths: bpMonths_(j.bestMonths || []), flights: flights.slice(0, 4) };
}

/** The best direct flight for a long weekend (under 7 hours), or null. */
function bpLongWeekend_(facts, maxMin) {
  var max = maxMin || BP_LONG_WEEKEND_MIN_;
  return ((facts && facts.flights) || []).filter(function(f) { return f.minutes < max; }).sort(function(a, b) { return a.minutes - b.minutes; })[0] || null;
}

function bpHomes_(cfg) {
  return String((cfg || {}).home_airports || 'IAD, DCA, BWI').split(/[\s,]+/).map(function(s) { return s.trim().toUpperCase(); }).filter(function(s) { return /^[A-Z]{3}$/.test(s); });
}

function bpPlaceKey_(b) { return [b.City, b.Country].map(function(x) { return String(x || '').trim(); }).filter(Boolean).join(', ').toLowerCase(); }

/** Each traveller's days left that year, against what the sample trip uses. */
function bpPeople_(people, sample) {
  return (people || []).map(function(p) {
    if (!sample) return { name: p.name, found: p.found !== false };
    var y = sample.start.slice(0, 4), left = p.remaining ? p.remaining[y] : null;
    var cost = tiPtoCost_(sample.start, sample.nights, p.holidays || {});
    return { name: p.name, found: p.found !== false, year: y, left: left == null ? null : left, uses: cost.days, bridged: cost.bridged, after: left == null ? null : left - cost.days };
  });
}

// ---- sheets -------------------------------------------------------------------

function bpFactsSheet_() { return ensureSheet(getSpreadsheet(), TABS.PLACE_FACTS, PLACE_FACT_HEADERS); }

/** Every cached place: {key: {bestMonths, flights, edited}}. */
function bpFactsAll_() {
  var sh = bpFactsSheet_(), out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PLACE_FACT_HEADERS.length).getValues().forEach(function(r, i) {
    var k = String(r[0] || '').trim();
    if (!k) return;
    var fl = [];
    try { fl = JSON.parse(String(r[2] || '[]')) || []; } catch (e) {}
    out[k] = { bestMonths: bpMonths_(String(r[1] || '')), flights: fl, edited: String(r[4] || '') === 'yes', _row: i + 2 };
  });
  return out;
}

function bpFactsWrite_(key, f, edited) {
  var sh = bpFactsSheet_(), have = bpFactsAll_()[key];
  var row = [key, bpMonthsText_(f.bestMonths), JSON.stringify(f.flights || []), new Date().toISOString(), edited ? 'yes' : ''];
  if (have) sh.getRange(have._row, 1, 1, PLACE_FACT_HEADERS.length).setValues([row]); else sh.appendRow(row);
}

// ---- routes -------------------------------------------------------------------

/**
 * GET bucket_facts {id, refresh} → {facts, bestMonths, saved}. One Claude call per place on a miss;
 * the suggestion fills the row's Best Months when it is blank.
 */
function webBucketFacts_(p) {
  p = p || {};
  var id = String(p.id || '').trim();
  var b = plBucketRows_().filter(function(x) { return String(x.ID) === id; })[0];
  if (!b) return { ok: false, error: 'That place is gone; refresh and try again.' };
  var key = bpPlaceKey_(b), cfg = getConfigValues(), homes = bpHomes_(cfg), all = bpFactsAll_();
  var f = all[key], saved = !!f;
  if (!f || (p.refresh === '1' && !f.edited)) {
    var place = [b.City, b.Country].filter(Boolean).join(', ');
    var prompt = 'For a trip to ' + place + ', reply with JSON only: {"bestMonths": [the 3 to 6 months (1-12) when it is at its best for a visit, weather and crowds together],' +
      ' "flights": [one entry for each of these airports with a regular nonstop flight to ' + place + ' or its main airport: ' + homes.join(', ') +
      ', as {"from": "IATA", "minutes": typical scheduled nonstop flight time, "seasonal": true if it only runs part of the year}]}. Leave out airports with no nonstop flight.';
    var r = callClaudeJsonDetailed_(prompt, { maxTokens: 400 });
    if (!r || !r.json) return f ? { ok: true, facts: f, bestMonths: bpMonths_(b['Best Months']), saved: true, note: 'Couldn’t ask again; showing what was saved.' } : { ok: false, error: 'Couldn’t look that up right now. Try again later.' };
    f = bpCleanFacts_(r.json, homes);
    plLocked_(function() { bpFactsWrite_(key, f, false); });
    saved = false;
  }
  var bm = bpMonths_(b['Best Months']);
  if (!bm.length && f.bestMonths.length) {
    plLocked_(function() { plSetBucket_(id, 'Best Months', bpMonthsText_(f.bestMonths)); });
    bm = f.bestMonths;
  }
  var out = { bestMonths: f.bestMonths, flights: f.flights };
  return { ok: true, facts: out, bestMonths: bm, saved: saved };
}

/** POST bucket_facts_set {id, flights:[{from, minutes, seasonal}]}: your own flight times win from now on. */
function webBucketFactsSet_(body) {
  var id = String((body && body.id) || '').trim();
  var b = plBucketRows_().filter(function(x) { return String(x.ID) === id; })[0];
  if (!b) return { ok: false, error: 'That place is gone; refresh and try again.' };
  var key = bpPlaceKey_(b), homes = bpHomes_(getConfigValues()), have = bpFactsAll_()[key] || { bestMonths: [], flights: [] };
  var f = { bestMonths: have.bestMonths, flights: bpCleanFacts_({ flights: body.flights || [] }, homes).flights };
  plLocked_(function() { bpFactsWrite_(key, f, true); });
  return { ok: true, facts: { bestMonths: f.bestMonths, flights: f.flights } };
}

/** What GET places adds for the cards: cached facts by bucket ID, home airports, awards, points held. */
function bpPlacesExtras_(bucket) {
  var cfg = getConfigValues(), all = {}, facts = {};
  try { all = bpFactsAll_(); } catch (e) { Logger.log('bpPlacesExtras_: facts — ' + e.message); }
  (bucket || []).forEach(function(b) { var f = all[bpPlaceKey_(b)]; if (f) facts[String(b.ID)] = { bestMonths: f.bestMonths, flights: f.flights }; });
  var balances = { by: {}, transferable: 0 };
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.LOYALTY_PROGRAMS);
    if (sh && sh.getLastRow() >= 2) balances = bpBalances_(sh.getDataRange().getValues());
  } catch (e) { Logger.log('bpPlacesExtras_: points — ' + e.message); }
  var cabin = String(cfg.award_cabin || 'business').toLowerCase();
  return { facts: facts, homeAirports: bpHomes_(cfg), awards: bpAwards_(cfg), awardCabin: /^(economy|premium|business|first)$/.test(cabin) ? cabin : 'business', points: balances, longWeekendMinutes: BP_LONG_WEEKEND_MIN_ };
}

/** What the plan screen adds: the months, a sample trip and each traveller's vacation days. */
function bpPlanExtras_(items, brief, today) {
  var ov = bpOverlap_(items.map(function(b) { return bpMonths_(b['Best Months']); }));
  var nights = Number(brief && brief.nights) || 7;
  var sample = bpSampleTrip_(ov.all.length ? ov.all : ov.some, today, nights);
  var people = [];
  try {
    var ty = Number(today.slice(0, 4)), years = [ty, ty + 1];
    people = bpPeople_([tiPtoPerson_('Ahmed', readPTOConfig_, years), tiPtoPerson_('Victoria', readVictoriaPTOConfig_, years)], sample);
  } catch (e) { Logger.log('bpPlanExtras_: vacation days unavailable — ' + e.message); }
  return { months: { all: ov.all, some: ov.some, known: ov.known, count: ov.count }, sample: sample, people: people };
}
