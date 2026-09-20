// ============================================================
// VERA — Trip Decisions (Issue #187, phase 1)
// TripDecisions.js — recognising tentative holds and grouping
//                    the ones that compete for the same slot
// ============================================================
//
// Plans firm up late. A week out you hold two or three options for a slot and
// decide on the day. Until now VERA could not tell a hold from a booking, so
// three competing holds read as a packed afternoon that does not exist —
// corrupting gap detection, itinerary notices and travel-time pairing alike.
//
// The model: competing holds are not N tentative items, they are ONE decision
// with N options. What makes two holds alternatives is that they compete for
// the same TIME, not that they are the same kind of thing — "museum or beach
// or shopping" is one afternoon's decision across three types.
//
// Phase 1 recognises and groups them. Confirming a choice, decide-by dates and
// recommendations come later; nothing here writes anything down.

/** Tentative markers. Whole-word so "maybenot" and "optional" do not trip. */
var TENTATIVE_PATTERNS_ = [
  /\btentative(ly)?\b/i,
  /\btbd\b/i,
  /\bmaybe\b/i,
  /\boptions?\b/i,
  /\bplan\s*[abc]\b/i,
  /\balt\b/i,
  /\[\s*\?\s*\]/,
  /\(\s*\?\s*\)/,
];

/** An explicit "Plan B" / "Option 2" marker — the strongest grouping signal. */
var OPTION_MARKER_RE_ = /\b(?:plan\s*[a-d]|option\s*\d+)\b/i;

/**
 * Does this item's own text say it is a hold?
 * Used for both sheet rows and calendar events, so the vocabulary is identical
 * whichever way an item got here.
 */
function isTentativeText_(title, notes) {
  var hay = String(title || '') + ' ' + String(notes || '');
  for (var i = 0; i < TENTATIVE_PATTERNS_.length; i++) {
    if (TENTATIVE_PATTERNS_[i].test(hay)) return true;
  }
  return false;
}

function hasExplicitOptionMarker_(title, notes) {
  return OPTION_MARKER_RE_.test(String(title || '') + ' ' + String(notes || ''));
}

/** morning <11:00 · midday 11:00–15:59 · evening ≥16:00 */
function timeBucketOf_(startTime) {
  var mins = tdTimeToMins_(startTime);
  if (mins === null) return '';
  if (mins < 11 * 60) return 'morning';
  if (mins < 16 * 60) return 'midday';
  return 'evening';
}

/** "HH:MM" → minutes, or null when there is no usable time. */
function tdTimeToMins_(t) {
  var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Parses an item's metadata JSON without throwing on a malformed cell. */
function tdReadMeta_(item) {
  if (!item) return {};
  var raw = item.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(String(raw));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function tdWriteMeta_(item, meta) {
  item.metadata = JSON.stringify(meta);
}

/**
 * True when two same-day holds are alternatives for one slot.
 *
 * Any one of three signals is enough, strongest first:
 *   1. both carry an explicit Plan/Option marker — a deliberate act, so it
 *      overrides everything and groups holds held hours apart
 *   2. their time ranges genuinely overlap — two things over the same hour
 *      cannot both happen, which is what "mutually exclusive" means
 *   3. same time bucket and same type — the conservative fallback for holds
 *      with a start but no end time
 *
 * Type is deliberately NOT part of signals 1 and 2. Grouping on type would file
 * "museum or beach or shopping" as three unrelated decisions, which is the case
 * this exists for.
 */
function tdAreAlternatives_(a, b) {
  if (a.date !== b.date) return false;

  if (a._explicit && b._explicit) return true;                       // 1

  var aStart = tdTimeToMins_(a.startTime), bStart = tdTimeToMins_(b.startTime);
  if (aStart === null || bStart === null) return false;
  var aEnd = tdTimeToMins_(a.endTime), bEnd = tdTimeToMins_(b.endTime);
  if (aEnd !== null && bEnd !== null && aStart < bEnd && bStart < aEnd) return true;  // 2

  var aType = String(a.type || '').toLowerCase();
  var bType = String(b.type || '').toLowerCase();
  return aType === bType && timeBucketOf_(a.startTime) === timeBucketOf_(b.startTime); // 3
}

/**
 * Marks tentative items and groups the ones competing for the same slot.
 *
 * Writes four fields into each item's metadata:
 *   tentative        — this is a hold, not a booking
 *   optionGroup      — "<date>|<earliest HH:MM>", shared by everything in the group
 *   optionCount      — how many options the group holds
 *   isRepresentative — exactly one per group; the one everything downstream
 *                      counts, so three holds occupy one slot rather than three
 *
 * Deriving it here, once, is what lets every consumer collapse with a filter
 * instead of its own copy of this logic. Two implementations of the grouping —
 * one in Apps Script, one in browser JS — would drift; a flag cannot.
 *
 * Mutates and returns `items`.
 */
function annotateOptionGroups_(items) {
  if (!items || !items.length) return items;

  // Pass 1 — flag holds. Only timed, dated, non-all-day items can compete for a
  // slot; an all-day hold has no slot to compete for.
  var candidates = [];
  items.forEach(function(it) {
    var meta = tdReadMeta_(it);
    var tentative = isTentativeText_(it.title, it.notes) || meta.tentative === true;
    if (!tentative) return;

    meta.tentative = true;
    tdWriteMeta_(it, meta);

    if (!it.date || !it.startTime || it.allDay) return;
    it._explicit = hasExplicitOptionMarker_(it.title, it.notes);
    candidates.push(it);
  });
  if (!candidates.length) return items;

  // Pass 2 — transitive closure over the alternatives test, so A~B and B~C put
  // all three in one group.
  var parent = candidates.map(function(_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i, j) { var ri = find(i), rj = find(j); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj); }

  for (var i = 0; i < candidates.length; i++) {
    for (var j = i + 1; j < candidates.length; j++) {
      if (tdAreAlternatives_(candidates[i], candidates[j])) union(i, j);
    }
  }

  var groups = {};
  candidates.forEach(function(it, idx) {
    var root = find(idx);
    if (!groups[root]) groups[root] = [];
    groups[root].push(it);
  });

  // Pass 3 — key, count, representative. Earliest start wins, ties broken by id
  // so repeated reads of the same data produce identical output.
  Object.keys(groups).forEach(function(root) {
    var members = groups[root].sort(function(a, b) {
      var am = tdTimeToMins_(a.startTime), bm = tdTimeToMins_(b.startTime);
      if (am !== bm) return am - bm;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
    var key = members[0].date + '|' + members[0].startTime;
    members.forEach(function(it, idx) {
      var meta = tdReadMeta_(it);
      meta.optionGroup      = key;
      meta.optionCount      = members.length;
      meta.isRepresentative = (idx === 0);
      tdWriteMeta_(it, meta);
    });
  });

  items.forEach(function(it) { delete it._explicit; });
  return items;
}

/**
 * One occupied slot per decision.
 *
 * Every consumer that reasons about the SHAPE of a day — free-time gaps,
 * itinerary notices, travel-leg pairing — must see a group as one item. Without
 * this, three competing holds read as a packed afternoon and produce free-time
 * that vanished and travel legs between places you will visit at most one of.
 *
 * Deliberately a filter over a flag the server already set, not a second copy
 * of annotateOptionGroups_'s logic.
 */
function collapseOptionGroups_(items) {
  if (!items || !items.length) return items || [];
  return items.filter(function(it) {
    var meta = tdReadMeta_(it);
    return !meta.optionGroup || meta.isRepresentative === true;
  });
}
