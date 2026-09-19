// ============================================================
// VERA — Important Dates Engine (Issue #80)
// ImportantDates.js — Nightly auto-sync + flagging engine
// ============================================================

/**
 * Scans the "Joint Chaos" shared calendar for birthday events
 * arriving within the next 30 days. Auto-adds any that don't
 * already have a matching entry in the Important Dates sheet.
 * Called from nightlyRun() in Code.js.
 */
/**
 * Normalises a Date column value (JS Date object, "YYYY-MM-DD", or "MM-DD")
 * to "MM-DD" so dedup comparisons are always apples-to-apples.
 */
function toMmDd_(val) {
  if (val instanceof Date) {
    return String(val.getMonth() + 1).padStart(2, '0') + '-' +
           String(val.getDate()).padStart(2, '0');
  }
  var s = String(val || '').trim();
  var m = s.match(/^\d{4}-(\d{2}-\d{2})$/);
  if (m) return m[1]; // YYYY-MM-DD → MM-DD
  return s;           // already MM-DD or empty
}

// ─── RULE ENGINE ──────────────────────────────────────────────────────────────
//
// Some dates that matter cannot be written as a calendar recurrence. National
// Wife Day is the third Sunday of September; Google Calendar can say "every
// September 20th" or "every third Sunday", but not both at once. The Date column
// therefore also accepts a rule, resolved fresh each year:
//
//   3rd sun of sep            Nth weekday of a named month, annually
//   last mon of may           last weekday of a named month, annually
//   1st fri of every month    Nth weekday, every month
//   thanksgiving -6d          N days from another row (by Label) or from `easter`
//
// Parsing is case- and whitespace-insensitive. Fixed MM-DD / YYYY-MM-DD values
// are untouched and keep resolving exactly as they always have.

var WEEKDAY_NAMES_ = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};

var MONTH_NAMES_ = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

var ORDINAL_WORDS_ = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

/**
 * Parses a Date-column value into a rule descriptor, or null when it is not a
 * rule (fixed dates, blanks and anything unrecognised all return null, so the
 * caller keeps its existing behaviour).
 *
 * @returns {{kind:'nth', n:number|'last', weekday:number, month:number|'every'}
 *          |{kind:'offset', ref:string, days:number}
 *          |null}
 */
function parseDateRule_(raw) {
  if (raw instanceof Date) return null;            // Sheets-coerced fixed date
  var s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  s = s.replace(/\s+/g, ' ');

  // <ordinal> <weekday> of <month|every month>
  var m = s.match(/^(\d+)(?:st|nd|rd|th)?\s+([a-z]+)\s+of\s+(?:the\s+)?([a-z]+)(?:\s+month)?$/);
  var n = null;
  if (m) {
    n = parseInt(m[1], 10);
  } else {
    m = s.match(/^(first|second|third|fourth|fifth|last)\s+([a-z]+)\s+of\s+(?:the\s+)?([a-z]+)(?:\s+month)?$/);
    if (m) n = (m[1] === 'last') ? 'last' : ORDINAL_WORDS_[m[1]];
  }
  if (m && n !== null) {
    var weekday = WEEKDAY_NAMES_[m[2]];
    if (weekday === undefined) return null;
    var monthWord = m[3];
    var month = (monthWord === 'every') ? 'every' : MONTH_NAMES_[monthWord];
    if (month === undefined) return null;
    if (n !== 'last' && (n < 1 || n > 5)) return null;
    return { kind: 'nth', n: n, weekday: weekday, month: month };
  }

  // <ref> <+|-><N><d|days>   e.g. "thanksgiving -6d", "easter + 50 days"
  m = s.match(/^(.+?)\s*([+-])\s*(\d+)\s*(?:d|days?)$/);
  if (m) {
    var ref = m[1].trim();
    if (!ref) return null;
    var days = parseInt(m[3], 10) * (m[2] === '-' ? -1 : 1);
    return { kind: 'offset', ref: ref, days: days };
  }

  return null;
}

/**
 * The Nth (or last) given weekday of a specific month.
 *
 * Returns null when that occurrence does not exist — there is no 5th Friday in
 * most months. Rolling forward into the next month instead would silently put
 * the event on a wrong date, which is worse than not placing it at all.
 */
function nthWeekdayOfMonth_(year, month, n, weekday) {
  if (n === 'last') {
    var last = new Date(year, month + 1, 0);        // last day of `month`
    var back = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - back);
  }
  var first   = new Date(year, month, 1);
  var forward = (weekday - first.getDay() + 7) % 7;
  var day     = 1 + forward + (n - 1) * 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  if (day > daysInMonth) return null;               // e.g. no 5th Friday
  return new Date(year, month, day);
}

/**
 * Easter Sunday (Gregorian computus). The one widely-used date that no
 * weekday rule can express, so it is available as a built-in offset anchor.
 */
function easterSunday_(year) {
  var a = year % 19,
      b = Math.floor(year / 100),
      c = year % 100,
      d = Math.floor(b / 4),
      e = b % 4,
      f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4),
      k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7,
      m2 = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m2 + 114) / 31) - 1,
      day = ((h + l - 7 * m2 + 114) % 31) + 1;
  return new Date(year, month, day);
}

/**
 * Resolves any Date-column value to its occurrence in a specific year.
 * Handles fixed values as well as rules, so callers need only one entry point.
 *
 * @param {*}      raw    the Date cell
 * @param {number} year
 * @param {Array}  rows   sibling rows, for resolving offset references by Label
 * @param {Object} seen   internal — visited Labels, for cycle detection
 * @returns {Date|null}
 */
function occurrenceInYear_(raw, year, rows, seen) {
  seen = seen || {};

  // Fixed values first — unchanged behaviour.
  if (raw instanceof Date) return new Date(year, raw.getMonth(), raw.getDate());
  var s = String(raw || '').trim();
  var fixed = s.match(/^(\d{2})-(\d{2})$/);
  if (fixed) return new Date(year, parseInt(fixed[1], 10) - 1, parseInt(fixed[2], 10));
  var full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return new Date(parseInt(full[1], 10), parseInt(full[2], 10) - 1, parseInt(full[3], 10));

  var rule = parseDateRule_(s);
  if (!rule) return null;

  if (rule.kind === 'nth') {
    if (rule.month === 'every') return null;        // month-stepping only; see nextOccurrence_
    return nthWeekdayOfMonth_(year, rule.month, rule.n, rule.weekday);
  }

  // offset
  if (rule.ref === 'easter') {
    var eas = easterSunday_(year);
    eas.setDate(eas.getDate() + rule.days);
    return eas;
  }
  if (Object.keys(seen).length >= 5) {
    Logger.log('ImportantDates: offset chain too deep at "' + rule.ref + '" — skipping');
    return null;
  }
  if (seen[rule.ref]) {
    Logger.log('ImportantDates: circular offset reference at "' + rule.ref + '" — skipping');
    return null;
  }
  var target = null;
  (rows || []).forEach(function(r) {
    if (target) return;
    if (String(r.label || '').trim().toLowerCase() === rule.ref) target = r;
  });
  if (!target) {
    Logger.log('ImportantDates: offset references unknown date "' + rule.ref + '" — skipping');
    return null;
  }
  var nextSeen = Object.assign({}, seen);
  nextSeen[rule.ref] = true;
  var anchor = occurrenceInYear_(target.date, year, rows, nextSeen);
  if (!anchor) return null;
  var out = new Date(anchor.getTime());
  out.setDate(out.getDate() + rule.days);
  return out;
}

/**
 * The next occurrence of a Date-column value on or after `from`.
 *
 * Tries this year then next, which is what keeps offsets correct across a year
 * boundary — the anchor and the offset date can legitimately fall in different
 * years. "of every month" rules step months instead.
 *
 * @returns {Date|null}
 */
function nextOccurrence_(raw, from, rows) {
  var base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  var rule = parseDateRule_(raw);

  if (rule && rule.kind === 'nth' && rule.month === 'every') {
    for (var step = 0; step <= 13; step++) {
      var probe = new Date(base.getFullYear(), base.getMonth() + step, 1);
      var hit   = nthWeekdayOfMonth_(probe.getFullYear(), probe.getMonth(), rule.n, rule.weekday);
      if (hit && hit >= base) return hit;
    }
    return null;
  }

  // A YYYY-MM-DD value names one specific day; it never rolls to another year.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw || '').trim())) {
    return occurrenceInYear_(raw, base.getFullYear(), rows);
  }

  for (var y = 0; y <= 1; y++) {
    var occ = occurrenceInYear_(raw, base.getFullYear() + y, rows);
    if (occ && occ >= base) return occ;
  }
  return null;
}

/**
 * Shapes the Important Dates sheet rows into the {label, date} form the offset
 * resolver expects. Kept next to the engine so callers cannot get it wrong.
 */
function ruleRowsFromSheetValues_(allRows) {
  return (allRows || []).slice(1).map(function(r) {
    return { id: String(r[0] || '').trim(), date: r[1], label: String(r[2] || '').trim() };
  }).filter(function(r) { return r.id; });
}

function syncCalendarBirthdaysToImportantDates_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet) {
    Logger.log('ImportantDates: Important Dates sheet not found — skipping sync.');
    return;
  }

  // Find the "Joint Chaos" calendar (case-insensitive name match)
  var targetCal = null;
  CalendarApp.getAllCalendars().forEach(function(c) {
    if (c.getName().toLowerCase().indexOf('joint chaos') !== -1) targetCal = c;
  });
  if (!targetCal) {
    Logger.log('ImportantDates: "Joint Chaos" calendar not found — skipping sync.');
    return;
  }

  // Scan events in the next 30 days. Build a person -> live MM-DD map from
  // birthday events up front — used below both to self-heal a stale sheet
  // row and to decide whether an event is already represented.
  var now     = new Date();
  var horizon = new Date(now.getTime() + 30 * 86400000);
  var events  = targetCal.getEvents(now, horizon);
  var liveBirthdays = {}; // personLower -> { person, dateKey }
  events.forEach(function(ev) {
    var title = ev.getTitle();
    if (title.toLowerCase().indexOf('birthday') === -1) return;
    var person = title.replace(/'?s?\s*birthday\s*$/i, '').trim();
    if (!person) return;
    var start   = ev.getStartTime();
    var dateKey = String(start.getMonth() + 1).padStart(2, '0') + '-' +
                  String(start.getDate()).padStart(2, '0');
    liveBirthdays[person.toLowerCase()] = { person: person, dateKey: dateKey };
  });

  // ── Step 0: Collapse duplicate birthday rows (same person, any date) ──────
  // The old version only caught exact (Person, MM-DD) collisions, which missed
  // the case where a stale sheet row disagrees with the calendar's current
  // date for the same person — the scan below would then add a SECOND row
  // instead of recognizing it as the same birthday. ("Kelly E's Birthday"
  // ended up on the sheet twice: 07-29 and 08-02.) This pass keeps one row
  // per person for birthday-labeled entries, correcting its date to whatever
  // the live calendar currently shows. Scoped to rows whose Label matches
  // "...'s Birthday" so manually-entered anniversaries/other dates that
  // happen to share a Person value are never touched.
  if (sheet.getLastRow() >= 2) {
    var allData   = sheet.getDataRange().getValues();
    var hdrs0     = allData[0];
    var dateIdx0  = hdrs0.indexOf('Date');
    var labelIdx0 = hdrs0.indexOf('Label');
    var personIdx0 = hdrs0.indexOf('Person');
    var keepRow   = {}; // personLower -> row index into allData
    var toDelete  = [];

    for (var r0 = 1; r0 < allData.length; r0++) {
      var rowId0 = String(allData[r0][0] || '').trim();
      if (!rowId0) continue;
      var label0 = String(allData[r0][labelIdx0] || '').trim();
      if (!/'s\s+birthday$/i.test(label0)) continue; // only touch birthday-sync rows
      var person0 = String(allData[r0][personIdx0] || '').trim().toLowerCase();
      if (!person0) continue;

      if (keepRow[person0] === undefined) {
        keepRow[person0] = r0;
      } else {
        toDelete.push(r0); // second+ row for this person — drop it
      }
    }

    // Correct the kept row's date to match the live calendar, when we have one.
    Object.keys(keepRow).forEach(function(personLower) {
      var live = liveBirthdays[personLower];
      if (!live) return;
      var r = keepRow[personLower];
      var currentMmDd = toMmDd_(allData[r][dateIdx0]);
      if (currentMmDd !== live.dateKey) {
        sheet.getRange(r + 1, dateIdx0 + 1).setValue(live.dateKey);
        Logger.log('ImportantDates: corrected "' + live.person + '" date ' +
                    currentMmDd + ' -> ' + live.dateKey);
      }
    });

    // Delete extras bottom-up so row indices stay valid.
    toDelete.sort(function(a, b) { return b - a; });
    toDelete.forEach(function(r) {
      sheet.deleteRow(r + 1); // +1 because getValues is 0-indexed
      Logger.log('ImportantDates: removed duplicate birthday row at index ' + r);
    });
  }

  // Load existing entries for duplicate-checking (post-dedup, post-correction)
  var existing = [];
  if (sheet.getLastRow() >= 2) {
    var rows = sheet.getDataRange().getValues();
    var hdrs = rows[0];
    rows.slice(1).forEach(function(r) {
      if (!r[0]) return;
      var obj = {};
      hdrs.forEach(function(h, i) { obj[h] = r[i]; });
      existing.push(obj);
    });
  }

  var added = 0;

  events.forEach(function(ev) {
    var title = ev.getTitle();
    if (title.toLowerCase().indexOf('birthday') === -1) return; // birthday events only

    // Strip "'s birthday" / " birthday" suffix to extract person name
    var person  = title.replace(/'?s?\s*birthday\s*$/i, '').trim();
    if (!person) return;

    var start   = ev.getStartTime();
    var dateKey = String(start.getMonth() + 1).padStart(2, '0') + '-' +
                  String(start.getDate()).padStart(2, '0');

    // Match on PERSON alone (not date+person) — a date mismatch means the
    // sheet was stale and has already been corrected above, not that this is
    // a different occasion. Scoped to birthday-labeled rows so this can't
    // false-match an unrelated entry that happens to mention the same name.
    var alreadyExists = existing.some(function(e) {
      var label = String(e['Label'] || '');
      if (!/'s\s+birthday$/i.test(label)) return false;
      return String(e['Person'] || '').toLowerCase().indexOf(person.toLowerCase()) !== -1 ||
             label.toLowerCase().indexOf(person.toLowerCase()) !== -1;
    });

    if (!alreadyExists) {
      var id = 'id_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      sheet.appendRow([id, dateKey, person + "'s Birthday", person, 'Yes', 30, '', '']);
      // Add to existing array so subsequent iterations in the same run don't double-add
      existing.push({ ID: id, Date: dateKey, Label: person + "'s Birthday",
                      Person: person, Recurring: 'Yes', 'Lead Time Days': 30 });
      Logger.log('ImportantDates: auto-added "' + person + '" (' + dateKey + ') from Joint Chaos calendar.');
      added++;
      Utilities.sleep(100); // avoid sheet write contention on rapid appends
    }
  });

  Logger.log('ImportantDates: sync complete — ' + added + ' entry/entries added.');
}

// ─── CALENDAR PLACEMENT ───────────────────────────────────────────────────────

/**
 * Normalises an event title for comparison: lowercased, emoji and punctuation
 * stripped, whitespace collapsed. "💝 National Wife Day" and "national wife day"
 * are the same occasion, and the point of the check is to recognise one you
 * already put on a calendar yourself.
 */
function normaliseEventTitle_(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[ -㌀\ud83c-􏰀-\udfff]/g, ' ') // emoji & symbols
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Places upcoming rule-based (and fixed) occasions on a calendar.
 *
 * Runs nightly from nightlyRun() with a 60-day horizon rather than on a monthly
 * schedule: a missed night simply catches up the next night. Only rows with
 * "Add to Calendar" set are considered, so existing rows keep their current
 * flags-only behaviour.
 *
 * Three dedup gates, cheapest first:
 *   1. Last Calendar Year already stamped for this occurrence → skip, no reads.
 *      This also means deleting an event VERA placed does not resurrect it —
 *      deleting is a decision, and re-creating nightly would fight the user.
 *   2. Already on any calendar VERA can read → stamp the year and skip.
 *   3. Otherwise create it, with a marker in the description, and stamp.
 */
function syncImportantDatesToCalendar_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('ImportantDates: no rows to place on a calendar.');
    return;
  }

  var allRows = sheet.getDataRange().getValues();
  var hdrs    = allRows[0];
  var col     = {};
  hdrs.forEach(function(h, i) { col[String(h).trim()] = i; });

  if (col['Add to Calendar'] === undefined) {
    Logger.log('ImportantDates: "Add to Calendar" column missing — run ensureImportantDatesSchema_().');
    return;
  }

  var cfg          = getConfigValues();
  var defaultLead  = parseInt(cfg['dates_calendar_lead_days'] || '60', 10) || 60;
  var ruleRows     = ruleRowsFromSheetValues_(allRows);
  var today        = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // ── Pass 1: work out what wants placing, without touching any calendar ────
  var wanted = [];
  allRows.slice(1).forEach(function(r, idx) {
    var id = String(r[0] || '').trim();
    if (!id) return;

    var addTo = String(r[col['Add to Calendar']] || '').trim();
    if (!addTo || addTo.toLowerCase() === 'no') return;

    var label = String(r[col['Label']] || '').trim();
    if (!label) return;

    var occ = nextOccurrence_(r[col['Date']], today, ruleRows);
    if (!occ) return;  // unparseable or a non-existent Nth weekday — already logged

    var daysUntil = Math.round((occ.getTime() - today.getTime()) / 86400000);
    var lead      = parseInt(r[col['Calendar Lead Days']], 10) || defaultLead;
    if (daysUntil < 0 || daysUntil > lead) return;

    var occYear = occ.getFullYear();
    if (String(r[col['Last Calendar Year']] || '').trim() === String(occYear)) return; // gate 1

    wanted.push({
      rowNum: idx + 2,
      id:     id,
      label:  label,
      date:   occ,
      year:   occYear,
      calName: (addTo.toLowerCase() === 'yes') ? null : addTo,
      notes:  String(r[col['Notes']] || '').trim(),
    });
  });

  if (!wanted.length) {
    Logger.log('ImportantDates: nothing due for calendar placement.');
    return;
  }

  // ── Pass 2: one calendar read per (calendar, distinct day) ────────────────
  var skipList = (cfg['skip_calendars'] || '').split(',')
    .map(function(s) { return s.trim().toLowerCase(); })
    .filter(function(s) { return s; });

  var readCals = CalendarApp.getAllCalendars().filter(function(c) {
    return skipList.indexOf(c.getName().toLowerCase()) === -1;
  });

  var dayKey  = function(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); };
  var seenDay = {};   // yyyy-MM-dd -> { titles: {normalised:true}, markers: {mark:true} }
  wanted.forEach(function(w) {
    var k = dayKey(w.date);
    if (seenDay[k]) return;
    var titles = {}, markers = {};
    readCals.forEach(function(c) {
      try {
        c.getEventsForDay(w.date).forEach(function(ev) {
          titles[normaliseEventTitle_(ev.getTitle())] = true;
          var desc = ev.getDescription() || '';
          var m = desc.match(/VERA-DATE:[^\s]+/g);
          if (m) m.forEach(function(mk) { markers[mk] = true; });
        });
      } catch (e) {
        Logger.log('ImportantDates: could not read "' + c.getName() + '" for ' + k + ': ' + e.message);
      }
    });
    seenDay[k] = { titles: titles, markers: markers };
  });

  // ── Pass 3: create what is genuinely missing ──────────────────────────────
  var sharedCal = null;
  var created = 0, alreadyThere = 0, failed = 0;

  wanted.forEach(function(w) {
    var day = seenDay[dayKey(w.date)];
    var marker = 'VERA-DATE:' + w.id + ':' + w.year;

    if (day.markers[marker] || day.titles[normaliseEventTitle_(w.label)]) {   // gate 2
      sheet.getRange(w.rowNum, col['Last Calendar Year'] + 1).setValue(String(w.year));
      alreadyThere++;
      return;
    }

    try {                                                                      // gate 3
      var cal = w.calName ? getCalendarByName_(w.calName)
                          : (sharedCal || (sharedCal = getPrimarySharedCalendar_()));
      if (!cal) {
        Logger.log('ImportantDates: no calendar available for "' + w.label + '" — skipping.');
        failed++;
        return;
      }
      var ev = cal.createAllDayEvent(w.label, w.date);
      ev.setDescription(w.notes ? (w.notes + '\n\n' + marker) : marker);
      sheet.getRange(w.rowNum, col['Last Calendar Year'] + 1).setValue(String(w.year));
      day.titles[normaliseEventTitle_(w.label)] = true;  // a same-day duplicate row won't re-add
      created++;
      Logger.log('ImportantDates: placed "' + w.label + '" on ' + dayKey(w.date));
    } catch (e) {
      Logger.log('ImportantDates: failed to place "' + w.label + '": ' + e.message);
      failed++;
    }
  });

  Logger.log('ImportantDates: calendar sync — ' + created + ' placed, ' +
             alreadyThere + ' already present, ' + failed + ' failed.');
}

// ─── FLAG ENGINE ──────────────────────────────────────────────────────────────

/**
 * Nightly flag engine for the Important Dates sheet.
 * Fires three flag tiers per entry:
 *   Low    — lead_time days before (default 30)
 *   Medium — 7 days before (includes Claude gift suggestions)
 *   High   — 1 day before
 *
 * Dedup: each tier uses a key like `important_dates_{id}_{tier}_{YYYY}` so it
 * fires at most once per year per tier. The `Last Actioned Year` column is
 * written after the High flag fires to prevent re-triggering if the nightly
 * runs multiple times in the same day.
 *
 * Date formats supported:
 *   MM-DD         — year-agnostic recurring (e.g. "04-14" for April 14 every year)
 *   YYYY-MM-DD    — one-time or fixed-year event
 */
function checkImportantDates_() {
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
    if (!sheet || sheet.getLastRow() < 2) { Logger.log('ImportantDates: no rows — skipping'); return; }

    var cfg         = getConfigValues();
    var defaultLead = parseInt(cfg['dates_default_lead_time']  || '30', 10) || 30;
    var highDays    = parseInt(cfg['dates_high_urgency_days']   || '1',  10) || 1;
    var medDays     = parseInt(cfg['dates_medium_urgency_days'] || '7',  10) || 7;

    var allRows  = sheet.getDataRange().getValues();
    var hdrs     = allRows[0];
    var colMap   = {};
    hdrs.forEach(function(h, i) { colMap[h] = i + 1; }); // 1-based for getRange

    var ruleRows = ruleRowsFromSheetValues_(allRows);
    var now      = new Date();
    var thisYear = now.getFullYear();
    var flags    = [];

    allRows.slice(1).forEach(function(row, idx) {
      var id       = String(row[0] || '').trim();
      if (!id) return;
      var dateRaw  = String(row[1] || '').trim();
      var label    = String(row[2] || '').trim();
      var person   = String(row[3] || '').trim();
      var recurring = String(row[4] || 'Yes').trim().toLowerCase() === 'yes';
      var leadTime = parseInt(row[5], 10) || defaultLead;
      var notes    = String(row[6] || '').trim();
      var lastActioned = String(row[7] || '').trim();

      if (!dateRaw || !label) return;

      // ── Compute next occurrence date ──────────────────────────────────
      // One entry point for fixed values and rules alike, so the vocabulary
      // stays identical here, in the calendar sync and on the dashboard.
      var isOneTime  = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && !recurring;
      var targetDate = nextOccurrence_(row[1], now, ruleRows);
      if (!targetDate) {
        Logger.log('ImportantDates: unresolvable date "' + dateRaw + '" for ' + id + ' — skipping');
        return;
      }

      var daysUntil = Math.round((targetDate.getTime() - now.getTime()) / 86400000);

      // Outside the lead time window — skip
      if (daysUntil < 0 || daysUntil > leadTime) return;

      // One-time events already actioned this year — skip
      if (isOneTime && lastActioned === String(thisYear)) return;

      // ── Determine flag tier ───────────────────────────────────────────
      var tier, urgency, dayLabel;
      if (daysUntil <= highDays) {
        tier     = '1d';
        urgency  = 'High';
        dayLabel = daysUntil === 0 ? 'is today' : 'is tomorrow';
      } else if (daysUntil <= medDays) {
        tier     = '7d';
        urgency  = 'Medium';
        dayLabel = 'is in ' + daysUntil + ' days';
      } else {
        tier     = '30d';
        urgency  = 'Low';
        dayLabel = 'is in ' + daysUntil + ' days';
      }

      var flagKey = 'important_dates_' + id + '_' + tier + '_' + thisYear;
      var reason  = label + ' for ' + person + ' ' + dayLabel + '.';
      if (notes) reason += ' Notes: ' + notes + '.';

      // ── At 7-day mark: call Claude for interest-based suggestions ─────
      if (tier === '7d') {
        try {
          var personLower = person.toLowerCase();
          var interests = getSharedInterestLedger_()
            .filter(function(i) {
              var ip = i.person.toLowerCase();
              return personLower === 'both' || ip === personLower || ip === 'both';
            })
            .slice(0, 15);

          // Also pull wish list items for this person (Issue #131)
          var wishListContext = '';
          try {
            var wlSheet = getSpreadsheet().getSheetByName(TABS.WISH_LIST);
            if (wlSheet && wlSheet.getLastRow() >= 2) {
              var wlRows = wlSheet.getRange(2, 1, wlSheet.getLastRow() - 1, WISH_LIST_HEADERS.length).getValues();
              var wlItems = wlRows.filter(function(r) {
                var rPerson = String(r[1] || '').toLowerCase();
                var rStatus = String(r[8] || '').trim();
                return String(r[0]).trim() &&
                       rStatus !== 'Purchased' &&
                       (rPerson === personLower || rPerson === 'both');
              }).map(function(r) {
                return '- ' + String(r[3] || '').trim() +
                       (r[6] ? ' (~$' + r[6] + ')' : '') +
                       ' [' + String(r[7] || 'Medium') + ' priority, ' + String(r[8] || 'Dreaming') + ']';
              });
              if (wlItems.length) {
                wishListContext = '\nTheir wish list items:\n' + wlItems.join('\n');
              }
            }
          } catch (wlErr) {
            Logger.log('ImportantDates: wish list lookup error: ' + wlErr.message);
          }

          if (interests.length || wishListContext) {
            var interestText = interests.map(function(i) {
              return '- ' + i.interest +
                     (i.category ? ' [' + i.category + ']' : '') +
                     (i.notes    ? ': ' + i.notes : '');
            }).join('\n');

            var claudePrompt =
              'Occasion: ' + label + ' for ' + person + ' (' + daysUntil + ' days away).\n' +
              (interestText ? 'Their logged interests:\n' + interestText + '\n' : '') +
              wishListContext + '\n\n' +
              'Suggest 3 specific, personalised gift or activity ideas. Be concrete — not ' +
              'categories, but actual suggestions. If any wish list items are listed above, ' +
              'prioritise them as gift ideas. Return a JSON array of objects: ' +
              '[{"idea":"...","reason":"...","estimated_cost":"..."}]';

            var suggestions = callClaudeJson_(claudePrompt, []);
            if (suggestions && suggestions.length) {
              reason += ' Personalised ideas based on interests: ' +
                suggestions.slice(0, 3).map(function(s, i) {
                  return (i + 1) + '. ' + s.idea +
                         (s.estimated_cost ? ' (~' + s.estimated_cost + ')' : '');
                }).join('; ') + '.';
            }
          }
        } catch (cErr) {
          Logger.log('ImportantDates: Claude suggestions error for ' + id + ': ' + cErr.message);
        }
      }

      flags.push({
        source:  'Important Dates',
        urgency: urgency,
        flag:    label + ' — ' + dayLabel,
        reason:  reason,
        key:     flagKey,
      });

      // Mark Last Actioned Year after High flag so re-runs skip it
      if (tier === '1d' && lastActioned !== String(thisYear)) {
        try {
          sheet.getRange(idx + 2, colMap['Last Actioned Year']).setValue(String(thisYear));
        } catch (e2) {
          Logger.log('ImportantDates: failed to update Last Actioned Year for ' + id + ': ' + e2.message);
        }
      }
    });

    if (flags.length) {
      writeFlags(flags);
      Logger.log('ImportantDates: wrote ' + flags.length + ' flag(s)');
    } else {
      Logger.log('ImportantDates: no flags due today');
    }
  } catch (e) {
    Logger.log('checkImportantDates_ error (non-fatal): ' + e.message);
  }
}

// ─── CONTEXT HELPER ──────────────────────────────────────────────────────────

/**
 * Returns upcoming important dates within `daysAhead`, sorted by proximity.
 * Used by Chat.js context loader. Each entry has a `daysUntil` field added.
 *
 * @param {number} daysAhead  How far ahead to look (e.g. 90)
 * @returns {Array}
 */
function getUpcomingImportantDates_(daysAhead) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var allRows  = sheet.getDataRange().getValues();
  var hdrs     = allRows[0];
  var now      = new Date();
  var thisYear = now.getFullYear();
  var results  = [];

  allRows.slice(1).forEach(function(row) {
    var id      = String(row[0] || '').trim();
    if (!id) return;
    var dateRaw = String(row[1] || '').trim();
    var label   = String(row[2] || '').trim();
    var person  = String(row[3] || '').trim();
    var recurring = String(row[4] || 'Yes').trim().toLowerCase() === 'yes';
    var leadTime  = parseInt(row[5], 10) || 30;
    var notes   = String(row[6] || '').trim();
    var lastActioned = String(row[7] || '').trim();
    if (!dateRaw || !label) return;

    var targetDate = null;
    var isOneTime  = false;

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      targetDate = new Date(dateRaw + 'T00:00:00');
      isOneTime  = !recurring;
    } else if (/^\d{2}-\d{2}$/.test(dateRaw)) {
      var mm = parseInt(dateRaw.split('-')[0], 10);
      var dd = parseInt(dateRaw.split('-')[1], 10);
      targetDate = new Date(thisYear, mm - 1, dd, 0, 0, 0);
      if (targetDate < now) targetDate = new Date(thisYear + 1, mm - 1, dd, 0, 0, 0);
    } else {
      return;
    }

    var daysUntil = Math.round((targetDate.getTime() - now.getTime()) / 86400000);
    if (daysUntil < 0 || daysUntil > daysAhead) return;
    if (isOneTime && lastActioned === String(thisYear)) return;

    var obj = {};
    hdrs.forEach(function(h, i) { obj[h] = row[i]; });
    obj['daysUntil'] = daysUntil;
    results.push(obj);
  });

  results.sort(function(a, b) { return a['daysUntil'] - b['daysUntil']; });
  return results;
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────

/**
 * DEBUG — Run this directly from the Apps Script editor to see exactly
 * which calendars VERA can see and which birthday events it finds.
 * Results appear in View → Logs (or Executions).
 */
function debugBirthdayCalendars() {
  var now       = new Date();
  var lookAhead = new Date(now.getFullYear(), now.getMonth() + 13, now.getDate());
  var cals      = CalendarApp.getAllCalendars();
  var calIds    = {};
  cals.forEach(function(c) { calIds[c.getId()] = true; });
  CalendarApp.getCalendarsByName('Birthdays').forEach(function(c) {
    if (!calIds[c.getId()]) { cals.push(c); calIds[c.getId()] = true; }
  });
  Logger.log('=== Calendar scan — ' + cals.length + ' calendars found ===');
  cals.forEach(function(cal) {
    Logger.log('Calendar: "' + cal.getName() + '"');
    var events = cal.getEvents(now, lookAhead);
    var birthdayEvents = events.filter(function(ev) {
      return ev.getTitle().toLowerCase().indexOf('birthday') !== -1;
    });
    if (birthdayEvents.length) {
      birthdayEvents.forEach(function(ev) {
        var d = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
        Logger.log('  → "' + ev.getTitle() + '" on ' + d);
      });
    } else {
      Logger.log('  (no birthday events in range)');
    }
  });
  Logger.log('=== End calendar scan ===');
}

/** Run from Apps Script editor to test the flag engine. */
function testCheckImportantDates() {
  Logger.log('=== testCheckImportantDates ===');
  checkImportantDates_();
  Logger.log('=== done — check Flags tab ===');
}
