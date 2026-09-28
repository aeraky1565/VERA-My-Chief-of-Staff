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

/**
 * Drops the per-execution registry memo. Call after any write.
 *
 * Also drops the key-set memo below it, which is derived from the registry: an
 * alias appended during a run would otherwise leave every already-computed key
 * set stale, and a reader would keep seeing half the trip.
 */
function invalidateTripRegistry_() {
  _tripRegistryCache_ = null;
  invalidateTripKeyCache_();
}

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


// ---- resolve-on-read: the bridge from a frozen key to a live trip ----------
//
// The event-ID anchor works — resolveTripId_ checks reg.byEventId before it looks
// at anything else, so a trip whose start date moves keeps its id. What did NOT
// follow is every consumer downstream, which still compares the frozen string
// startDate + '|' + label. That string is written into eight tabs at insert time
// and never rewritten (webUpdateItineraryItem_ edits columns 3-10 and has no
// branch for the key column), so a trip whose date moved owns TWO key strings and
// every reader sees half a trip.
//
// These two functions are how a reader asks the registry instead of trusting the
// string. Neither mints: minting on a read is how a second identity gets created,
// which is the bug.

/** Per-execution memo. readTripRegistry_ is cached, but resolveTripId_'s
 *  label/date scan is O(rows) and these are called inside loops. */
var _tripKeySetCache_ = {};

/** Dropped alongside _tripRegistryCache_ so a stale set cannot outlive the sheet. */
function invalidateTripKeyCache_() { _tripKeySetCache_ = {}; }

/**
 * The trip id a legacy key belongs to, or '' — never minting.
 *
 * Splits `yyyy-MM-dd|Label` and hands the pieces to resolveTripId_, so all three
 * of its branches apply in order: the calendar event id, then this exact string
 * as a registered alias, then label + dates within TRIP_MATCH_TOLERANCE_DAYS_.
 *
 * @param {string} tripKey
 * @returns {string} 'TRIP-…' or ''
 */
function tripIdForKey_(tripKey) {
  var key = String(tripKey == null ? '' : tripKey).trim();
  if (!key) return '';
  if (isTripId_(key)) return String(key).toUpperCase();   // already an id

  var parts     = key.split('|');
  var startDate = parts[0].trim();
  var label     = parts.length > 1 ? parts.slice(1).join('|').trim() : '';
  if (!label) return '';   // not a trip key at all

  try {
    // Three things here are load-bearing, and all three are about NOT writing:
    //
    //   mint:false   — a read must never create a second identity.
    //   touch:false  — resolveTripId_ otherwise calls touchTripRow_, which writes
    //                  the label and dates it was handed onto the matched row. A
    //                  legacy key's date prefix is the trip's OLD start date, so
    //                  without this a single lookup reverts the registry to
    //                  whenever that key was minted — including the end date that
    //                  post-trip timing depends on.
    //   no endDate   — we genuinely do not know it. Passing startDate as a stand-in
    //                  made every resolution claim a zero-length trip.
    //
    // appendAlias is likewise not set: a read does not write.
    return resolveTripId_({ label: label, startDate: startDate },
                          { mint: false, touch: false }) || '';
  } catch (e) {
    Logger.log('tripIdForKey_("' + key + '") — ' + e.message);
    return '';
  }
}

/**
 * Every key string this trip has ever answered to: its canonical key first, then
 * every alias on the registry row.
 *
 * This is what a reader filters rows on. Matching the SET rather than one string
 * is what makes a trip that split into two keys read as one trip again.
 *
 * An unresolvable key comes back as [itself], so a missing Trips tab, an empty
 * registry or a key from before the registry existed all degrade to exactly
 * today's behaviour rather than returning nothing and hiding the trip.
 *
 * @param {string} tripKey
 * @returns {Array<string>} always non-empty when tripKey is non-empty
 */
function tripKeysFor_(tripKey) {
  var key = String(tripKey == null ? '' : tripKey).trim();
  if (!key) return [];
  if (Object.prototype.hasOwnProperty.call(_tripKeySetCache_, key)) {
    return _tripKeySetCache_[key];
  }

  var out = [key];
  try {
    var id  = tripIdForKey_(key);
    var rec = id ? getTripById_(id) : null;
    if (rec) {
      var seen = {};
      out = [];
      var canonical = String(rec.startDate || '') + '|' + String(rec.label || '');
      // The Trip ID is in the set too, so a row an earlier repairOrphanTripKeys_
      // run rewrote to a bare TRIP-… still matches. The two storage forms are
      // interchangeable at read time; only writers have to pick one.
      [canonical].concat(rec.aliases || []).concat([rec.tripId, key]).forEach(function(k) {
        var t = String(k || '').trim();
        if (t && t !== '|' && !seen[t]) { seen[t] = true; out.push(t); }
      });
      if (!out.length) out = [key];
    }
  } catch (e) {
    Logger.log('tripKeysFor_("' + key + '") — ' + e.message);
    out = [key];
  }

  _tripKeySetCache_[key] = out;
  return out;
}

/**
 * The one key to WRITE with, so new rows stop adding to a split.
 *
 * Unresolvable → the input unchanged, which is the safe direction: a row written
 * under the key it was handed is exactly today's behaviour.
 */
function canonicalTripKey_(tripKey) {
  var key = String(tripKey == null ? '' : tripKey).trim();
  if (!key) return key;
  try {
    var id = tripIdForKey_(key);
    if (!id) return key;
    var start = tripStartDateFor_(id);
    var label = tripLabelFor_(id);
    if (!start || !label) return key;
    return start + '|' + label;
  } catch (e) {
    Logger.log('canonicalTripKey_("' + key + '") — ' + e.message);
    return key;
  }
}

/**
 * Does this row's trip-key cell belong to the trip these keys describe?
 *
 * Replaces `String(row[n] || '').trim() === tripKey` at every read site. Pass the
 * result of tripKeysFor_ once, outside the loop — not the raw key.
 *
 * @param {*} cellValue         — the raw cell
 * @param {Array<string>} keys  — from tripKeysFor_
 */
function tripRowMatches_(cellValue, keys) {
  var v = String(cellValue == null ? '' : cellValue).trim();
  if (!v || !keys || !keys.length) return false;
  for (var i = 0; i < keys.length; i++) if (v === keys[i]) return true;
  return false;
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
 * @param {Object} [opts] — {mint:boolean=true, appendAlias:boolean=false,
 *        touch:boolean=true, strict:boolean=false}. strict refuses an ambiguous
 *        match instead of picking one — see the branch below.
 * @returns {string} the id, or '' when unresolved and minting is off
 */
function resolveTripId_(trip, opts) {
  opts = opts || {};
  var mint = opts.mint !== false;
  // touch:false makes this a pure lookup. touchTripRow_ WRITES the label, dates
  // and eventIds of whatever row it matches, which is right when the caller got
  // its fields from the calendar — and badly wrong when the caller only has a
  // legacy key, because a key's date prefix is the trip's OLD start date and
  // writing it back reverts the registry to the state the key came from.
  var touch = opts.touch !== false;
  function touch_(id, fields) { if (touch) touchTripRow_(id, fields); }
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
      touch_(hit, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
      return hit;
    }
  }

  // 2 — the exact legacy key.
  var legacy = startDate + '|' + label;
  if (reg.byAlias[legacy]) {
    var aliasHit = reg.byAlias[legacy];
    touch_(aliasHit, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
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
    touch_(candidates[0].rec.tripId,
                  { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
    if (opts.appendAlias) appendTripAlias_(candidates[0].rec.tripId, legacy);
    return candidates[0].rec.tripId;
  }

  if (candidates.length > 1) {
    // strict callers refuse rather than pick.
    //
    // Picking is right for minting: the caller has a real trip in hand and
    // returning nothing would strand it, so a logged, flagged, deterministic
    // choice beats no id at all. It is wrong for adoption, where the only cost
    // of refusing is that one legacy key stays unattached — against the risk of
    // silently handing one trip's rows to another.
    if (opts.strict) {
      Logger.log('resolveTripId_: AMBIGUOUS and strict — "' + label + '" ' +
                 startDate + '..' + endDate + ' matched ' + candidates.length +
                 ' registry rows (' +
                 candidates.map(function(c) { return c.rec.tripId; }).join(', ') +
                 '); refusing to choose.');
      return '';
    }
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
    touch_(picked.tripId, { label: label, startDate: startDate, endDate: endDate, eventIds: eventIds });
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

/** The legacy form every latch used before the registry: the key, slugged. */
function tripLegacySlugForProperty_(tripKey) {
  return String(tripKey || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * A flag dedup key that follows the trip rather than the key string.
 *
 * The Flags tab dedups on this string, so a trip whose date moved produced a
 * SECOND flag key and the pre-trip briefing flagged twice. Built from the Trip ID
 * where one resolves, and from the key otherwise — identical to the old output in
 * that case, so existing flags keep matching.
 *
 * @param {string} prefix  — e.g. 'pretrip_briefing_'
 * @param {Object|string} trip
 */
function tripFlagKey_(prefix, trip) {
  var t  = tripLatchTarget_(trip);
  var id = t.id || (t.key ? tripIdForKey_(t.key) : '');
  var tail = id ? tripIdSlugForFlag_(id) : String(t.key || '');
  return (String(prefix) + tail)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Every send latch keyed on a trip. Shared so the sites cannot drift apart. */
var TRIP_LATCH_PREFIXES_ = [
  'PRETRIP_48H_', 'PRETRIP_NB_',
  'POSTTRIP_NUDGE_', 'POSTTRIP_RECAP_', 'POSTTRIP_DEBRIEF_',
];

/** A trip object with .tripKey/.tripId, or a bare key string. */
function tripLatchTarget_(trip) {
  if (trip && typeof trip === 'object') {
    return { key: String(trip.tripKey || '').trim(),
             id:  String(trip.tripId  || '').trim().toUpperCase() };
  }
  return { key: String(trip == null ? '' : trip).trim(), id: '' };
}

/**
 * Has this trip already been sent under `prefix`?
 *
 * Checks the Trip ID latch first, then the legacy key latch. The fallback is
 * deliberate and is what makes this migration safe: the id key only exists for
 * trips seedTripIdLatches_ has reached, and a trip in flight when this ships
 * would otherwise look unsent and mail everyone a second time — the exact bug
 * being fixed. Keep the fallback for one release, then drop it.
 */
function tripLatchSeen_(prefix, trip) {
  var t = tripLatchTarget_(trip);
  var props = PropertiesService.getScriptProperties();

  var id = t.id || (t.key ? tripIdForKey_(t.key) : '');
  if (id && props.getProperty(prefix + tripIdSlugForProperty_(id))) return true;
  if (t.key && props.getProperty(prefix + tripLegacySlugForProperty_(t.key))) return true;

  // Any other key this trip has answered to. A latch written under the OLD key,
  // before the date moved, still counts as sent.
  if (t.key) {
    var keys = tripKeysFor_(t.key);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === t.key) continue;
      if (props.getProperty(prefix + tripLegacySlugForProperty_(keys[i]))) return true;
    }
  }
  return false;
}

/** The property name a mark would be written under. */
function tripLatchName_(prefix, trip) {
  var t  = tripLatchTarget_(trip);
  var id = t.id || (t.key ? tripIdForKey_(t.key) : '');
  return id ? (prefix + tripIdSlugForProperty_(id))
            : (prefix + tripLegacySlugForProperty_(t.key));
}

/**
 * The stored value, wherever it lives — id key, legacy key, or an older key the
 * trip has answered to. Same search order as tripLatchSeen_, which returns a
 * boolean; this one is for latches carrying a payload, like the debrief marker.
 *
 * @returns {string|null}
 */
function tripLatchValue_(prefix, trip) {
  var t     = tripLatchTarget_(trip);
  var props = PropertiesService.getScriptProperties();

  var id = t.id || (t.key ? tripIdForKey_(t.key) : '');
  if (id) {
    var v = props.getProperty(prefix + tripIdSlugForProperty_(id));
    if (v) return v;
  }
  if (!t.key) return null;
  var keys = tripKeysFor_(t.key);
  if (keys.indexOf(t.key) === -1) keys = [t.key].concat(keys);
  for (var i = 0; i < keys.length; i++) {
    var lv = props.getProperty(prefix + tripLegacySlugForProperty_(keys[i]));
    if (lv) return lv;
  }
  return null;
}

/** Marks it sent, on the Trip ID where there is one. */
function tripLatchMark_(prefix, trip, value) {
  var t = tripLatchTarget_(trip);
  var id = t.id || (t.key ? tripIdForKey_(t.key) : '');
  var name = id ? (prefix + tripIdSlugForProperty_(id))
                : (prefix + tripLegacySlugForProperty_(t.key));
  try {
    PropertiesService.getScriptProperties().setProperty(name, value || new Date().toISOString());
  } catch (e) {
    Logger.log('tripLatchMark_: could not write ' + name + ' — ' + e.message);
  }
  return name;
}

/**
 * Copies every legacy latch onto its Trip ID. Run ONCE, before the readers
 * switch over — otherwise every in-flight trip looks unsent and mails again.
 *
 * Additive and idempotent: it writes an id-keyed property only when one is
 * absent, and deletes nothing. Running it twice changes nothing.
 *
 * @returns {{seeded:number, skipped:number, details:Array<string>}}
 */
function seedTripIdLatches_() {
  var props   = PropertiesService.getScriptProperties();
  var reg     = readTripRegistry_();
  var seeded  = 0, skipped = 0, details = [];

  reg.rows.forEach(function(rec) {
    if (rec.status && rec.status.indexOf('merged:') === 0) return;
    var idSlug    = tripIdSlugForProperty_(rec.tripId);
    var canonical = String(rec.startDate || '') + '|' + String(rec.label || '');
    var keys      = [canonical].concat(rec.aliases || []);

    TRIP_LATCH_PREFIXES_.forEach(function(prefix) {
      var idName = prefix + idSlug;
      if (props.getProperty(idName)) { skipped++; return; }

      // The earliest legacy value wins: it is when the mail actually went out.
      var found = null;
      keys.forEach(function(k) {
        if (!k || k === '|') return;
        var v = props.getProperty(prefix + tripLegacySlugForProperty_(k));
        if (v && (found === null || String(v) < String(found))) found = v;
      });
      if (found === null) return;

      try {
        props.setProperty(idName, found);
        seeded++;
        details.push(idName + '  <-  ' + found + '  (' + rec.label + ')');
      } catch (e) {
        Logger.log('seedTripIdLatches_: could not write ' + idName + ' — ' + e.message);
      }
    });
  });

  Logger.log('seedTripIdLatches_: ' + seeded + ' seeded, ' + skipped + ' already present');
  details.forEach(function(d) { Logger.log('  ' + d); });
  return { seeded: seeded, skipped: skipped, details: details };
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
/**
 * Every distinct trip-key string across the eight trip-keyed tabs, with a row
 * count per tab. Shared by adoption and repair so the two cannot disagree about
 * what is actually in the sheet.
 *
 * @returns {Object} key → { tab → count }
 */
function scanTripKeyUsage_() {
  var ss   = getSpreadsheet();
  var seen = {};
  tripKeyedTabs_().forEach(function(t) {
    var sheet = ss.getSheetByName(t.tab);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getRange(2, t.col, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var k = String(r[0] || '').trim();
      if (!k) return;                       // EmailParser writes blanks on purpose
      if (!seen[k]) seen[k] = {};
      seen[k][t.tab] = (seen[k][t.tab] || 0) + 1;
    });
  });
  return seen;
}

/**
 * Teaches the registry the legacy keys it cannot otherwise see.
 *
 * WHY THIS HAS TO EXIST. Identity resolves through the calendar event id, which
 * survives a date change — but attachTripIds_ only ever sees trips as the CALENDAR
 * describes them, so the only key it can learn is the current one. The old key
 * lives solely in sheet rows, written before the date moved and never rewritten.
 * Nothing looked there, so the Aliases column stayed empty, tripKeysFor_ returned a
 * one-element set, and every read still saw half a trip. The resolve-on-read
 * plumbing was correct and had no input.
 *
 * This scans the tabs instead. A key that resolves to a live trip but is not that
 * trip's canonical key is recorded as an alias, and from then on every reader finds
 * the rows under it.
 *
 * SAFETY. Resolution is {mint:false, touch:false, strict:true}: it cannot create a
 * trip, cannot rewrite one, and refuses an ambiguous match rather than picking —
 * adopting on a guess is how one trip swallows another's rows. Keys that resolve to
 * nothing are left for repairOrphanTripKeys_, which asks before it acts.
 *
 * Additive and idempotent. appendTripAlias_ no-ops on a key it already holds, so a
 * second run writes nothing.
 *
 * @param {Object} [opts] — {dryRun:boolean=true}
 * @returns {{adopted:number, already:number, ambiguous:number, unresolved:number,
 *           details:Array<string>}}
 */
function adoptLegacyTripKeys_(opts) {
  opts = opts || {};
  var dryRun = opts.dryRun !== false;

  var usage = scanTripKeyUsage_();
  var keys  = Object.keys(usage);
  var out   = { adopted: 0, already: 0, ambiguous: 0, unresolved: 0, details: [] };
  if (!keys.length) return out;

  // Canonical keys and known aliases, so an already-attached key costs no resolve.
  var reg   = readTripRegistry_();
  var known = {};
  reg.rows.forEach(function(rec) {
    if (rec.status && rec.status.indexOf('merged:') === 0) return;
    known[String(rec.startDate || '') + '|' + String(rec.label || '')] = rec.tripId;
    known[rec.tripId] = rec.tripId;
    (rec.aliases || []).forEach(function(a) { if (a) known[a] = rec.tripId; });
  });

  keys.forEach(function(key) {
    if (known[key]) { out.already++; return; }

    var id = '';
    try {
      id = resolveTripId_({ label: key.split('|').slice(1).join('|').trim(),
                            startDate: key.split('|')[0].trim() },
                          { mint: false, touch: false, strict: true }) || '';
    } catch (e) {
      Logger.log('adoptLegacyTripKeys_: "' + key + '" — ' + e.message);
    }

    if (!id) {
      // Either nothing matched, or strict refused an ambiguous match. The log line
      // resolveTripId_ already wrote says which.
      out.unresolved++;
      out.details.push('  leave  ' + key + '  — no single live trip matches');
      return;
    }

    var rec = getTripById_(id);
    if (!rec) { out.unresolved++; return; }
    var canonical = String(rec.startDate || '') + '|' + String(rec.label || '');
    if (key === canonical) { out.already++; return; }

    var rows = 0;
    Object.keys(usage[key]).forEach(function(tab) { rows += usage[key][tab]; });
    out.details.push('  adopt  ' + key + '  -> ' + id + ' ("' + rec.label + '")  ' +
                     rows + ' row(s) in ' + Object.keys(usage[key]).join(', '));
    if (!dryRun) {
      if (appendTripAlias_(id, key)) out.adopted++; else out.already++;
    } else {
      out.adopted++;
    }
  });

  Logger.log('adoptLegacyTripKeys_' + (dryRun ? ' (DRY RUN)' : '') + ': ' +
             out.adopted + ' adopted, ' + out.already + ' already attached, ' +
             out.unresolved + ' left alone');
  out.details.forEach(function(d) { Logger.log(d); });
  if (dryRun && out.adopted) {
    Logger.log('  DRY RUN — nothing written. Apply with:');
    Logger.log('    adoptLegacyTripKeys_({ dryRun: false });');
  }
  if (out.unresolved) {
    Logger.log('  The "leave" keys belong to no live trip — repairOrphanTripKeysDryRun()');
    Logger.log('  shows what it would merge them into.');
  }
  return out;
}

/** Editor entry point: shows what adoption would attach, changes nothing. */
function adoptLegacyTripKeysDryRun() {
  return adoptLegacyTripKeys_({ dryRun: true });
}

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
      // The target's row is keyed by its CANONICAL KEY, not its id — TripMeta
      // stores key strings. Comparing against targetId alone meant b was always
      // null, so this guard never fired and a genuine Context conflict was
      // silently overwritten. Both forms are accepted: a previous repair run may
      // have left an id behind.
      var targetKey = canonicalTripKey_(targetId);
      var a = null, b = null;
      meta.forEach(function(r) {
        var k = String(r[0] || '').trim();
        if (k === orphanKey) a = r;
        if (k === targetId || (targetKey && k === targetKey)) b = r;
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

    // Rows are re-keyed to the target's CANONICAL KEY, not its bare id.
    // getRecentlyCompletedTrips_ and getTripBoundsByKey_ both skip any key that
    // is not yyyy-MM-dd-prefixed and derive the departure date from that prefix,
    // so rows migrated to TRIP-… would vanish from post-trip entirely. The id
    // stays the real identity; the key is its current display form.
    var mergeInto = canonicalTripKey_(targetId) || targetId;

    tabs.forEach(function(t) {
      var sheet = ss.getSheetByName(t.tab);
      if (!sheet || sheet.getLastRow() < 2) return;
      var range = sheet.getRange(2, t.col, sheet.getLastRow() - 1, 1);
      var vals  = range.getValues();
      var hits  = 0;
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || '').trim() === orphanKey) { vals[i][0] = mergeInto; hits++; }
      }
      if (hits) { range.setValues(vals); Logger.log('  ' + t.tab + ': re-keyed ' + hits + ' row(s)'); }
    });

    clearTripLatches_(orphanKey);
    applied++;
    Logger.log('MERGED "' + orphanKey + '" → ' + targetId + ' (rows re-keyed to "' + mergeInto + '")');
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
  var propSlug = tripLegacySlugForProperty_(tripKey);
  var flagSlug = String(tripKey).toLowerCase().replace(/[^a-z0-9]/g, '_')
                   .replace(/_+/g, '_').replace(/^_|_$/g, '');
  var props = PropertiesService.getScriptProperties();

  // LEGACY NAMES ONLY — deliberately.
  //
  // Latches now live under the Trip ID, so the obvious "also delete the id-keyed
  // one" is a trap: repairOrphanTripKeys_ calls appendTripAlias_(targetId,
  // orphanKey) BEFORE it calls this, so by now the orphan key resolves to the
  // TARGET's id. Deleting that would wipe the surviving trip's latch and mail
  // everything again — the precise failure this migration exists to prevent.
  //
  // There is no orphan id to clean up: an orphan key is by definition one that
  // resolved to no live trip, and a genuinely merged registry row forwards via
  // its `merged:` status instead.
  TRIP_LATCH_PREFIXES_.forEach(function(prefix) {
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

// ---------------------------------------------------------------------------

/**
 * What the registry thinks each trip is, and what post-trip would compute.
 *
 * Read-only: sends nothing, writes nothing, and resolves with mint:false so
 * running it cannot create the second identity it exists to detect.
 *
 * The column that matters is "keys" — a trip showing TWO is one whose start date
 * moved, and the whole point of this change is that both now resolve to one trip.
 */
function diagnoseTripIdentity_() {
  var tz = Session.getScriptTimeZone();
  Logger.log('=== Trip identity ===');

  var reg = readTripRegistry_();
  Logger.log(reg.rows.length + ' registry row(s), ' +
             Object.keys(reg.byAlias).length + ' alias(es), ' +
             Object.keys(reg.byEventId).length + ' calendar event id(s)');
  if (!reg.rows.length) {
    Logger.log('STOP — the Trips tab is empty. Ids are minted by getUpcomingTravel_,');
    Logger.log('  so run tbPTO() (or wait for the nightly pass) and try again.');
    return;
  }

  // Every distinct key actually present in the itinerary, so orphans show up.
  var keyCounts = {};
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (sheet && sheet.getLastRow() >= 2) {
      sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
        var k = String(r[0] || '').trim();
        if (k) keyCounts[k] = (keyCounts[k] || 0) + 1;
      });
    }
  } catch (e) {
    Logger.log('Itinerary read failed: ' + e.message);
  }

  var claimed = {};
  reg.rows.forEach(function(rec) {
    if (rec.status && rec.status.indexOf('merged:') === 0) {
      Logger.log('');
      Logger.log(rec.tripId + '  "' + rec.label + '"  -> forwarded to ' + rec.status);
      return;
    }
    var canonical = String(rec.startDate || '') + '|' + String(rec.label || '');
    var keys = tripKeysFor_(canonical);
    keys.forEach(function(k) { claimed[k] = rec.tripId; });

    var rows = 0;
    keys.forEach(function(k) { rows += (keyCounts[k] || 0); });

    Logger.log('');
    Logger.log(rec.tripId + '  "' + rec.label + '"  ' + rec.startDate + ' .. ' + rec.endDate);
    Logger.log('  event ids: ' + (rec.eventIds.length ? rec.eventIds.join(', ') : '(none — a recurring event, or added before the registry)'));
    Logger.log('  answers to ' + keys.length + ' key(s):');
    keys.forEach(function(k) {
      Logger.log('    ' + (k === canonical ? '* ' : '  ') + k + '   (' + (keyCounts[k] || 0) + ' itinerary row(s))');
    });
    if (keys.length > 1) {
      Logger.log('  ^ this trip SPLIT. Both keys now resolve to one trip; run');
      Logger.log('    repairOrphanTripKeysDryRun() if you also want the sheet tidied.');
    }

    // What post-trip would now decide, computed the same way it does.
    var bounds = null;
    try { bounds = getTripBoundsByKey_(canonical); } catch (e) {
      Logger.log('  getTripBoundsByKey_ threw — ' + e.message);
    }
    if (!bounds) {
      Logger.log('  post-trip: no itinerary rows, so nothing would fire.');
    } else {
      var endStr = Utilities.formatDate(bounds.endDate, tz, 'yyyy-MM-dd');
      var depStr = Utilities.formatDate(bounds.departureDate, tz, 'yyyy-MM-dd');
      var nights = (typeof tripDurationNights_ === 'function') ? tripDurationNights_(bounds) : null;
      Logger.log('  post-trip would use: ' + depStr + ' .. ' + endStr +
                 '  (' + (nights === null ? 'length unknown' : nights + ' night(s)') +
                 ', from ' + rows + ' row(s) across every key)');
      if (endStr < rec.endDate) {
        Logger.log('  ! computed end is EARLIER than the registry end (' + rec.endDate +
                   ') — that would fire early. Worth reporting.');
      }
    }

    TRIP_LATCH_PREFIXES_.forEach(function(prefix) {
      var seen = tripLatchSeen_(prefix, { tripKey: canonical, tripId: rec.tripId });
      var name = tripLatchName_(prefix, { tripKey: canonical, tripId: rec.tripId });
      if (seen) Logger.log('  latch ' + prefix + ' SET (would write ' + name + ')');
    });
  });

  // Unclaimed keys split two ways, and the difference decides what you run next.
  // Before this they printed as one list, which is what made "the tabs still show
  // old keys" impossible to interpret.
  var unclaimed  = Object.keys(keyCounts).filter(function(k) { return !claimed[k]; });
  var adoptable  = [];
  var orphaned   = [];
  unclaimed.forEach(function(k) {
    var id = '';
    try {
      id = resolveTripId_({ label: k.split('|').slice(1).join('|').trim(),
                            startDate: k.split('|')[0].trim() },
                          { mint: false, touch: false, strict: true }) || '';
    } catch (e) {}
    if (id) adoptable.push({ key: k, id: id }); else orphaned.push(k);
  });

  Logger.log('');
  if (adoptable.length) {
    Logger.log(adoptable.length + ' key(s) belong to a live trip but are not attached yet:');
    adoptable.forEach(function(o) {
      Logger.log('  ' + o.key + '  -> ' + o.id + '  (' + keyCounts[o.key] + ' row(s))');
    });
    Logger.log('  Until they are adopted, reads under them return only part of the trip.');
    Logger.log('  tbAdoptTripKeys() previews it; the nightly pass applies it on its own.');
  }
  if (orphaned.length) {
    Logger.log(orphaned.length + ' key(s) claimed by NO live trip:');
    orphaned.forEach(function(k) { Logger.log('  ' + k + '  (' + keyCounts[k] + ' row(s))'); });
    Logger.log('  Trips that ended, or split before the registry existed — or two live');
    Logger.log('  trips matched and adoption refused to guess. The log above says which.');
    Logger.log('  repairOrphanTripKeysDryRun() shows what it would merge them into.');
  }
  if (!adoptable.length && !orphaned.length) {
    Logger.log('Every itinerary key belongs to a live trip.');
  }
}
