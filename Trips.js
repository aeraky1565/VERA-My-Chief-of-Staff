// ============================================================
// VERA — Trips.js
// The trip registry: one immutable Trip ID per trip, for life.
// ============================================================
//
// WHY THIS EXISTS
//
// Trip identity used to be the string `startDate + '|' + label`, computed fresh
// at sixteen call sites and frozen into eight sheet tabs at write time. Nothing
// could rewrite it — webUpdateItineraryItem_ edits columns 3-10 and has no
// branch for the key column at all.
//
// So when a flight was cancelled and a trip's start date moved, the trip
// acquired two identities: the old key on every row already written, the new one
// from the calendar. Downstream, that meant two travel-day emails (one per key),
// a pre-trip briefing that re-sent because its latch is keyed on the same
// string, and a post-trip email that fired early because the new key owned only
// a sliver of the itinerary.
//
// A Trip ID is minted once and never changes. Label, Start Date and End Date
// track the current truth and are free to move underneath it.
//
// WHAT MAKES RESOLUTION WORK
//
// Matching is deliberately layered, because no single signal is sufficient here:
//
//   1. Calendar event ID. Stable across date and title edits, and the same
//      shared event on two calendars has one iCalUID. But a user reacting to a
//      cancellation may DELETE the event and make a new one, which mints a new
//      UID — so this cannot be the only rule.
//   2. Alias. The exact legacy key, for rows and clients that predate the ID.
//   3. Label + date-range proximity. This is the branch that survives a
//      delete-and-recreate, which is the actual reported failure. Hence a
//      generous 14-day window: a rebooked flight moves a trip by days.
//
// And when two candidates match, it does NOT guess — guessing is the failure
// being fixed. It takes the nearest range, breaks ties on the oldest Created so
// the answer is deterministic across the 600s trip cache, logs it, and flags it.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It never writes to a calendar event. `ev.setTag()` would be a natural home for
// an ID, but getUpcomingTravel_ scans extended-family calendars that are
// read-only to this script, and a trip that throws on resolve is worse than a
// trip with no tag.
// ============================================================


// ---- the sheet -------------------------------------------------------------

var _tripsSheet_ = null;

/**
 * The Trips tab, created on demand rather than assumed.
 *
 * Same trap and the same fix as getTravelLegsSheet_ and ensureTripDecisionsSchema_:
 * createSheetTabs() only runs from setupVERA(), which nobody re-runs when a
 * feature ships, so on every existing sheet the tab would simply be absent and
 * the first resolve would throw.
 */
function getTripsSheet_() {
  if (!_tripsSheet_) {
    _tripsSheet_ = ensureTripsSchema_(ensureSheet(getSpreadsheet(), TABS.TRIPS, TRIPS_HEADERS));
  }
  return _tripsSheet_;
}

/** Widens an existing Trips tab to match TRIPS_HEADERS. See ensureProjectsSchema_. */
function ensureTripsSchema_(sheet) {
  if (!sheet) return sheet;
  var need = TRIPS_HEADERS.length;
  if (sheet.getMaxColumns() < need) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  }
  var header = sheet.getRange(1, 1, 1, need).getValues()[0];
  for (var i = 0; i < need; i++) {
    if (String(header[i]).trim() !== TRIPS_HEADERS[i]) {
      sheet.getRange(1, 1, 1, need).setValues([TRIPS_HEADERS]);
      sheet.getRange(1, 1, 1, need).setFontWeight('bold');
      break;
    }
  }
  return sheet;
}


// ---- the id ----------------------------------------------------------------

/**
 * Is this a Trip ID rather than a legacy key?
 *
 * A test, not a heuristic — which is the point. Chat.js's tripKeyArgs_ has to
 * guess whether a pipe is an argument separator or part of a trip key by asking
 * whether the first field looks like a date. An ID contains no pipe at all.
 */
function isTripId_(value) {
  return /^TRIP-[0-9A-F]{12}$/.test(String(value == null ? '' : value).trim());
}

/**
 * A fresh Trip ID: TRIP- plus 12 hex characters, 17 chars total.
 *
 * Length is load-bearing. Two flag keys derived from the trip key are TRUNCATED
 * — Fitness.js cuts at 50 characters and Pantry.js at 30 — so a full 36-char
 * UUID would be sliced mid-hex and manufacture collisions. 17 leaves room for
 * the prefix and a composite suffix under both.
 *
 * It carries no date and no label, so nothing can parse one back out. That is
 * the trap PROJ-YYYYMMDD-NN fell into, where Projects.js digs the creation date
 * back out of the id — and the trap this whole file exists to close.
 *
 * Injective under both sanitisers the latches use, which the old key was not:
 * 'Alaska/Yukon' and 'Alaska-Yukon' collide today.
 */
function mintTripId_() {
  var reg = readTripRegistry_();
  for (var attempt = 0; attempt < 8; attempt++) {
    var id = 'TRIP-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
    if (!reg.byId[id]) return id;
  }
  throw new Error('mintTripId_: could not mint a unique id after 8 attempts');
}


// ---- reading ---------------------------------------------------------------

var _tripRegistryCache_ = null;

/** Drops the per-execution registry memo. Call after any write. */
function invalidateTripRegistry_() { _tripRegistryCache_ = null; }

/**
 * The whole registry, indexed. Memoized per execution — nightlyRun reaches this
 * from six modules, and the same justification as _upcomingTravelCache_ applies.
 *
 * @returns {{byId:Object, byAlias:Object, byEventId:Object, rows:Array}}
 */
function readTripRegistry_() {
  if (_tripRegistryCache_) return _tripRegistryCache_;
  var out = { byId: {}, byAlias: {}, byEventId: {}, rows: [] };
  var sheet;
  try { sheet = getTripsSheet_(); } catch (e) {
    Logger.log('readTripRegistry_: Trips tab unavailable — ' + e.message);
    _tripRegistryCache_ = out;
    return out;
  }
  if (!sheet || sheet.getLastRow() < 2) { _tripRegistryCache_ = out; return out; }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIPS_HEADERS.length).getValues();
  data.forEach(function(r, i) {
    var id = String(r[0] || '').trim().toUpperCase();
    if (!id) return;
    var rec = {
      tripId:    id,
      label:     String(r[1] || '').trim(),
      startDate: tripDateCell_(r[2]),
      endDate:   tripDateCell_(r[3]),
      eventIds:  splitTripList_(r[4]),
      aliases:   splitTripList_(r[5]),
      created:   String(r[6] || '').trim(),
      lastSeen:  String(r[7] || '').trim(),
      status:    String(r[8] || 'active').trim() || 'active',
      _row:      i + 2,
    };
    out.byId[id] = rec;
    out.rows.push(rec);
    rec.aliases.forEach(function(a) { if (a && !out.byAlias[a]) out.byAlias[a] = id; });
    rec.eventIds.forEach(function(e) { if (e && !out.byEventId[e]) out.byEventId[e] = id; });
  });
  _tripRegistryCache_ = out;
  return out;
}

/** A Date cell or a yyyy-MM-dd string, normalised to yyyy-MM-dd. */
function tripDateCell_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}

function splitTripList_(v) {
  return String(v || '').split(';')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return !!s; });
}

/**
 * The record for an id, following 'merged:<id>' forwarding.
 *
 * A merge must leave a pointer behind: a losing id can still be held by a chat
 * transcript, an emailed link or a browser tab left open, and those should
 * resolve rather than silently find nothing.
 *
 * @returns {Object|null}
 */
function getTripById_(tripId) {
  var id = String(tripId == null ? '' : tripId).trim().toUpperCase();
  if (!id) return null;
  var reg = readTripRegistry_();
  for (var hop = 0; hop < 4; hop++) {
    var rec = reg.byId[id];
    if (!rec) return null;
    var m = /^merged:(TRIP-[0-9A-F]{12})$/i.exec(rec.status || '');
    if (!m) return rec;
    id = m[1].toUpperCase();
  }
  Logger.log('getTripById_: merge chain too deep for ' + tripId);
  return null;
}

/** The current label for an id — replaces every `tripKey.split('|')[1]`. */
function tripLabelFor_(tripId) {
  var rec = getTripById_(tripId);
  return rec ? rec.label : '';
}

/** The current start date for an id — replaces every `tripKey.split('|')[0]`. */
function tripStartDateFor_(tripId) {
  var rec = getTripById_(tripId);
  return rec ? rec.startDate : '';
}

/** @returns {{startDate:string,endDate:string}|null} */
function tripDateRangeFor_(tripId) {
  var rec = getTripById_(tripId);
  return rec ? { startDate: rec.startDate, endDate: rec.endDate } : null;
}


// ---- resolution ------------------------------------------------------------

/** Days between two yyyy-MM-dd ranges: 0 if they overlap, else the gap. */
function tripRangeDistanceDays_(aStart, aEnd, bStart, bEnd) {
  function t(s) { var d = new Date(String(s) + 'T00:00:00'); return isNaN(d.getTime()) ? null : d.getTime(); }
  var a1 = t(aStart), a2 = t(aEnd || aStart), b1 = t(bStart), b2 = t(bEnd || bStart);
  if (a1 === null || b1 === null) return null;
  if (a2 === null) a2 = a1;
  if (b2 === null) b2 = b1;
  if (a1 <= b2 && b1 <= a2) return 0;                       // overlapping
  var gap = (a1 > b2) ? (a1 - b2) : (b1 - a2);
  return Math.round(gap / 86400000);
}

function normaliseTripLabel_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** How far a trip may move and still be the same trip. A rebooked flight moves days. */
var TRIP_MATCH_TOLERANCE_DAYS_ = 14;

/**
 * The Trip ID for a trip, minting one if it is genuinely new.
 *
 * @param {Object} trip  — {label, startDate, endDate, eventIds?}
 * @param {Object} [opts] — {mint:boolean=true, appendAlias:boolean=false}
 * @returns {string} the id, or '' when unresolved and minting is off
 */
function resolveTripId_(trip, opts) {
  opts = opts || {};
  var mint = opts.mint !== false;
  if (!trip) return '';
  var label     = String(trip.label || '').trim();
  var startDate = String(trip.startDate || '').trim();
  var endDate   = String(trip.endDate || startDate).trim();
  if (!label && !startDate) return '';

  var reg      = readTripRegistry_();
  var eventIds = (trip.eventIds || []).filter(function(e) { return !!e; });

  // 1 — a calendar event we have seen before.
  for (var i = 0; i < eventIds.length; i++) {
    var hit = reg.byEventId[eventIds[i]];
    if (hit) {
      touchTripRow_(hit, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
      return hit;
    }
  }

  // 2 — the exact legacy key.
  var legacy = startDate + '|' + label;
  if (reg.byAlias[legacy]) {
    var aliasHit = reg.byAlias[legacy];
    touchTripRow_(aliasHit, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
    return aliasHit;
  }

  // 3 — same label, dates close enough. The branch that survives a
  // delete-and-recreate, where the event id changed but the trip did not.
  var normLabel  = normaliseTripLabel_(label);
  var candidates = [];
  reg.rows.forEach(function(rec) {
    if (rec.status && rec.status.indexOf('merged:') === 0) return;
    if (normaliseTripLabel_(rec.label) !== normLabel) return;
    var dist = tripRangeDistanceDays_(startDate, endDate, rec.startDate, rec.endDate);
    if (dist === null || dist > TRIP_MATCH_TOLERANCE_DAYS_) return;
    candidates.push({ rec: rec, dist: dist });
  });

  if (candidates.length === 1) {
    touchTripRow_(candidates[0].rec.tripId,
                  { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
    if (opts.appendAlias) appendTripAlias_(candidates[0].rec.tripId, legacy);
    return candidates[0].rec.tripId;
  }

  if (candidates.length > 1) {
    // Never mint on ambiguity — minting when unsure is precisely how a trip
    // acquires a second identity. Nearest range, then oldest Created so the
    // answer does not depend on row order or on which side of the 600s trip
    // cache we are on.
    candidates.sort(function(a, b) {
      if (a.dist !== b.dist) return a.dist - b.dist;
      return String(a.rec.created).localeCompare(String(b.rec.created));
    });
    var picked = candidates[0].rec;
    Logger.log('resolveTripId_: AMBIGUOUS — "' + label + '" ' + startDate + '..' + endDate +
               ' matched ' + candidates.length + ' registry rows; taking ' + picked.tripId +
               ' (nearest range, then oldest). Others: ' +
               candidates.slice(1).map(function(c) { return c.rec.tripId; }).join(', '));
    try {
      writeFlags([{
        source:  'Trips',
        flag:    'Two trip records match "' + label + '"',
        reason:  'VERA could not tell which trip record ' + startDate + '..' + endDate +
                 ' belongs to, so it used ' + picked.tripId + '. Merge or rename them in the Trips tab.',
        urgency: 'Low',
        key:     'trip_id_ambiguous_' + tripIdSlugForFlag_(picked.tripId),
      }]);
    } catch (fe) { Logger.log('resolveTripId_: could not flag the ambiguity — ' + fe.message); }
    touchTripRow_(picked.tripId, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
    return picked.tripId;
  }

  if (!mint) return '';
  return createTripRow_(label, startDate, endDate, eventIds, legacy);
}

/** resolveTripId_ for callers that have loose fields rather than a trip object. */
function resolveTripIdForLabelRange_(label, startDate, endDate, opts) {
  return resolveTripId_({ label: label, startDate: startDate, endDate: endDate }, opts);
}

function createTripRow_(label, startDate, endDate, eventIds, legacyAlias) {
  var sheet = getTripsSheet_();
  var id    = mintTripId_();
  var now   = new Date().toISOString();
  sheet.appendRow([
    id, label, startDate, endDate,
    (eventIds || []).join(';'),
    legacyAlias || '',
    now, now, 'active',
  ]);
  Logger.log('Trips: minted ' + id + ' for "' + label + '" ' + startDate + '..' + endDate);
  invalidateTripRegistry_();
  return id;
}

/**
 * Updates a registry row to the trip's current truth, and grows its event-ID set.
 *
 * The set only ever grows. A trip copied to a second calendar has a different
 * iCalUID there; the first run matches on label+range and adds it, and from then
 * on either calendar winning the scan-order race resolves at step 1. Self-healing.
 */
function touchTripRow_(tripId, fields) {
  var reg = readTripRegistry_();
  var rec = reg.byId[String(tripId).toUpperCase()];
  if (!rec) return;
  var sheet  = getTripsSheet_();
  var writes = [];

  if (fields.label && fields.label !== rec.label) writes.push([2, fields.label]);
  if (fields.startDate && fields.startDate !== rec.startDate) writes.push([3, fields.startDate]);
  if (fields.endDate && fields.endDate !== rec.endDate) writes.push([4, fields.endDate]);

  var incoming = (fields.eventIds || []).filter(function(e) { return e && rec.eventIds.indexOf(e) === -1; });
  if (incoming.length) writes.push([5, rec.eventIds.concat(incoming).join(';')]);

  var today = new Date().toISOString().slice(0, 10);
  if (String(rec.lastSeen).slice(0, 10) !== today) writes.push([8, new Date().toISOString()]);

  if (!writes.length) return;
  writes.forEach(function(w) { sheet.getRange(rec._row, w[0]).setValue(w[1]); });
  invalidateTripRegistry_();
}

/** Records a legacy key this trip answers to. Idempotent. */
function appendTripAlias_(tripId, legacyKey) {
  var key = String(legacyKey || '').trim();
  if (!key) return false;
  var reg = readTripRegistry_();
  var rec = reg.byId[String(tripId).toUpperCase()];
  if (!rec || rec.aliases.indexOf(key) !== -1) return false;
  getTripsSheet_().getRange(rec._row, 6).setValue(rec.aliases.concat([key]).join(';'));
  invalidateTripRegistry_();
  return true;
}

/** Records a calendar event this trip is built from. Idempotent. */
function appendTripEventId_(tripId, eventId) {
  var eid = String(eventId || '').trim();
  if (!eid) return false;
  var reg = readTripRegistry_();
  var rec = reg.byId[String(tripId).toUpperCase()];
  if (!rec || rec.eventIds.indexOf(eid) !== -1) return false;
  getTripsSheet_().getRange(rec._row, 5).setValue(rec.eventIds.concat([eid]).join(';'));
  invalidateTripRegistry_();
  return true;
}

/**
 * Attaches a tripId to every trip in an array, under one lock.
 *
 * Called from getUpcomingTravel_ BEFORE its 600-second cache write, so a cache
 * hit returns objects that already carry their ids and a cache miss re-resolves
 * to the same ones. Resolving at each read site instead would spread trip
 * identity across sixteen call sites, which is how the current mess arose.
 *
 * On lock failure it resolves read-only and leaves tripId blank. A briefing with
 * no id is recoverable; two ids for one trip is not.
 */
function attachTripIds_(trips) {
  var list = trips || [];
  if (!list.length) return list;

  var lock = null;
  var got  = false;
  try {
    lock = LockService.getScriptLock();
    got  = lock.tryLock(5000);
  } catch (e) { got = false; }

  if (!got) {
    Logger.log('attachTripIds_: could not take the lock — resolving read-only, minting nothing');
    list.forEach(function(t) {
      try { t.tripId = resolveTripId_(t, { mint: false }); } catch (e2) { t.tripId = ''; }
    });
    return list;
  }

  try {
    invalidateTripRegistry_();   // another execution may have minted while we waited
    list.forEach(function(t) {
      try {
        t.tripId = resolveTripId_(t, { mint: true });
      } catch (e3) {
        Logger.log('attachTripIds_: could not resolve "' + (t && t.label) + '" — ' + e3.message);
        t.tripId = '';
      }
    });
  } finally {
    try { lock.releaseLock(); } catch (e4) {}
  }
  return list;
}


// ---- slugs, shared with the latch migration --------------------------------

/** The ScriptProperty form: PRETRIP_48H_TRIP_9F3A7C21B0D4 */
function tripIdSlugForProperty_(tripId) {
  return String(tripId || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** The Flags-key form: pretrip_briefing_trip_9f3a7c21b0d4 */
function tripIdSlugForFlag_(tripId) {
  return String(tripId || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}


// ---- repair ----------------------------------------------------------------

/**
 * Every tab that carries a trip key, with the column it lives in.
 *
 * TripMeta is the odd one: its key is column A and IS the row identity, where
 * every other tab keeps it in column B as a foreign key. Countries keeps it in
 * column F.
 *
 * A missing TABS entry THROWS rather than being filtered out. Silently skipping
 * a tab would mean the repair reports success while leaving rows behind — the
 * same shape of silent gap this whole file exists to close. (Caught in review:
 * TABS.TRIP_RECS does not exist, it is TRIP_RECOMMENDATIONS, and a filter would
 * have dropped that tab without a word.)
 */
function tripKeyedTabs_() {
  var defs = [
    { name: 'ITINERARY',           tab: TABS.ITINERARY,           col: 2 },
    { name: 'TRIP_META',           tab: TABS.TRIP_META,           col: 1 },
    { name: 'PACKING_ITEMS',       tab: TABS.PACKING_ITEMS,       col: 2 },
    { name: 'COUNTRIES',           tab: TABS.COUNTRIES,           col: 6 },
    { name: 'TRIP_BUDGET',         tab: TABS.TRIP_BUDGET,         col: 2 },
    { name: 'TRIP_GIFTS',          tab: TABS.TRIP_GIFTS,          col: 2 },
    { name: 'TRIP_RECOMMENDATIONS', tab: TABS.TRIP_RECOMMENDATIONS, col: 2 },
    { name: 'TRIP_DECISIONS',      tab: TABS.TRIP_DECISIONS,      col: 2 },
  ];
  var missing = defs.filter(function(d) { return !d.tab; }).map(function(d) { return d.name; });
  if (missing.length) throw new Error('tripKeyedTabs_: TABS entries missing — ' + missing.join(', '));
  return defs;
}

/**
 * Finds trip keys that belong to no live trip and offers to merge them.
 *
 * This is the cleanup for a trip that already split in two before the registry
 * existed: rows written under the old startDate|label while the calendar moved
 * on to a new one.
 *
 * DRY RUN BY DEFAULT. It prints what it found and what it would merge into, and
 * changes nothing until you hand it a mapping you have read.
 *
 * @param {Object} [opts] — {dryRun:boolean=true, merges:{'<orphan key>':'<TRIP-id>'}}
 */
function repairOrphanTripKeys_(opts) {
  opts = opts || {};
  var dryRun = opts.dryRun !== false;
  var merges = opts.merges || {};
  var ss     = getSpreadsheet();
  var tabs   = tripKeyedTabs_();

  // ---- gather every distinct key, per tab --------------------------------
  var seen = {};   // key → { tab → count }
  tabs.forEach(function(t) {
    var sheet = ss.getSheetByName(t.tab);
    if (!sheet || sheet.getLastRow() < 2) return;
    var vals = sheet.getRange(2, t.col, sheet.getLastRow() - 1, 1).getValues();
    vals.forEach(function(r) {
      var k = String(r[0] || '').trim();
      if (!k) return;                     // EmailParser writes a blank key on purpose
      if (!seen[k]) seen[k] = {};
      seen[k][t.tab] = (seen[k][t.tab] || 0) + 1;
    });
  });

  // ---- which of them resolve to nothing -----------------------------------
  var orphans = [];
  Object.keys(seen).forEach(function(k) {
    if (isTripId_(k) && getTripById_(k)) return;             // a live id
    if (!isTripId_(k)) {
      var reg = readTripRegistry_();
      if (reg.byAlias[k]) return;                            // already mapped
    }
    var pipe  = k.indexOf('|');
    var start = pipe > 0 ? k.slice(0, pipe) : '';
    var label = pipe > 0 ? k.slice(pipe + 1) : '';
    var suggestion = '';
    if (label) {
      // Same matcher the live path uses, minting nothing.
      suggestion = resolveTripIdForLabelRange_(label, start, start, { mint: false });
    }
    orphans.push({ key: k, tabs: seen[k], startDate: start, label: label, suggestion: suggestion });
  });

  Logger.log('=== Orphan trip keys ===');
  if (!orphans.length) {
    Logger.log('None. Every trip key across ' + tabs.length + ' tabs resolves to a live trip.');
    return { orphans: [], applied: 0 };
  }
  orphans.forEach(function(o) {
    var where = Object.keys(o.tabs).map(function(t) { return t + ':' + o.tabs[t]; }).join(', ');
    Logger.log('  "' + o.key + '"');
    Logger.log('      rows: ' + where);
    Logger.log('      would merge into: ' + (o.suggestion || '(no match — needs a Trip ID typed by hand)'));
  });

  if (dryRun) {
    Logger.log('');
    Logger.log('DRY RUN — nothing changed. To apply, call with a mapping you have read:');
    Logger.log('  repairOrphanTripKeys_({ dryRun: false, merges: {');
    orphans.forEach(function(o) {
      Logger.log('    ' + JSON.stringify(o.key) + ': ' + JSON.stringify(o.suggestion || 'TRIP-XXXXXXXXXXXX') + ',');
    });
    Logger.log('  }});');
    return { orphans: orphans, applied: 0 };
  }

  // ---- apply ---------------------------------------------------------------
  var applied = 0;
  Object.keys(merges).forEach(function(orphanKey) {
    var targetId = String(merges[orphanKey] || '').trim().toUpperCase();
    var target   = getTripById_(targetId);
    if (!target) { Logger.log('SKIP "' + orphanKey + '" — ' + targetId + ' is not a live Trip ID'); return; }

    // TripMeta's key column IS the row identity, so two halves of a split trip
    // can hold different Context/Notes. Refuse rather than silently pick one.
    var metaSheet = ss.getSheetByName(TABS.TRIP_META);
    if (metaSheet && metaSheet.getLastRow() >= 2) {
      var meta = metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
      var a = null, b = null;
      meta.forEach(function(r) {
        var k = String(r[0] || '').trim();
        if (k === orphanKey) a = r;
        if (k === targetId)  b = r;
      });
      if (a && b) {
        for (var c = 1; c <= 2; c++) {          // Context, Notes
          var av = String(a[c] || '').trim(), bv = String(b[c] || '').trim();
          if (av && bv && av !== bv) {
            Logger.log('REFUSING "' + orphanKey + '" → ' + targetId + ' — both have a different ' +
                       TRIP_META_HEADERS[c] + ':');
            Logger.log('    orphan: ' + av);
            Logger.log('    target: ' + bv);
            Logger.log('  Merge them by hand in the TripMeta tab first, then re-run.');
            return;
          }
        }
      }
    }

    // Alias FIRST, so a half-failed run already maps the orphan and nothing mints.
    appendTripAlias_(targetId, orphanKey);

    tabs.forEach(function(t) {
      var sheet = ss.getSheetByName(t.tab);
      if (!sheet || sheet.getLastRow() < 2) return;
      var range = sheet.getRange(2, t.col, sheet.getLastRow() - 1, 1);
      var vals  = range.getValues();
      var hits  = 0;
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || '').trim() === orphanKey) { vals[i][0] = targetId; hits++; }
      }
      if (hits) { range.setValues(vals); Logger.log('  ' + t.tab + ': re-keyed ' + hits + ' row(s)'); }
    });

    clearTripLatches_(orphanKey);
    applied++;
    Logger.log('MERGED "' + orphanKey + '" → ' + targetId);
  });

  invalidateTripRegistry_();
  Logger.log('=== ' + applied + ' merge(s) applied ===');
  return { orphans: orphans, applied: applied };
}

/**
 * Deletes the dedupe latches belonging to a key, so the surviving trip's own
 * latches are the only ones left.
 *
 * Deliberately deletes rather than re-keys: the target already has its own
 * latch, and two rows for one trip is the visible symptom being cleaned up.
 */
function clearTripLatches_(tripKey) {
  var propSlug = String(tripKey).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  var flagSlug = String(tripKey).toLowerCase().replace(/[^a-z0-9]/g, '_')
                   .replace(/_+/g, '_').replace(/^_|_$/g, '');
  var props = PropertiesService.getScriptProperties();
  ['PRETRIP_48H_', 'PRETRIP_NB_', 'POSTTRIP_NUDGE_', 'POSTTRIP_RECAP_', 'POSTTRIP_DEBRIEF_']
    .forEach(function(prefix) {
      try { props.deleteProperty(prefix + propSlug); } catch (e) {}
    });

  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
    if (!sheet || sheet.getLastRow() < 2) return;
    var keyCol = FLAG_HEADERS.indexOf('Key') + 1;
    var keys   = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = keys.length - 1; i >= 0; i--) {   // bottom-up: deleting shifts rows below
      var k = String(keys[i][0] || '').toLowerCase();
      if (k.indexOf(flagSlug) !== -1 &&
          /^(pretrip_briefing_|posttrip_capture_|fitness_travel_gap_|trip_decision_|trip_premise_)/.test(k)) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {
    Logger.log('clearTripLatches_: could not clear flags for ' + tripKey + ' — ' + e.message);
  }
}

/** Editor entry point: shows what is orphaned, changes nothing. */
function repairOrphanTripKeysDryRun() {
  return repairOrphanTripKeys_({ dryRun: true });
}
