// ============================================================
// VERA — PTO.js
// PTO Planner — reads Verizon Calendar, computes vacation/personal
// time stats, writes three types of events to the Vera calendar.
//
// HOW TO USE:
//   1. Seed Config tab with pto_* rows (see plan for full list)
//   2. Add PTO events to "Verizon Calendar":
//      - All-day + title contains "Vacation" → vacation days (pool of 20)
//      - All-day + title contains "PTO"      → personal time (8 hrs, pool of 48)
//      - Timed   + title contains "PTO"      → personal hours (actual duration)
//      - All-day + no keyword                → company holiday (auto-detected)
//      - Events matching pto_ignore_keywords (default: "Pay Day") → skipped entirely
//   3. testPTO() — verify stats in Logger
//   4. Push + redeploy WebApp
// ============================================================

// ---- Config -----------------------------------------------------------------

/**
 * Reads all pto_* keys from the Config tab.
 * @returns {Object} structured config
 */
function readPTOConfig_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found');

  var data    = sheet.getDataRange().getValues();
  var raw     = {};
  var allKeys = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
    allKeys[key] = val; // keep full key for non-pto_ settings
    if (key.indexOf('pto_') === 0) {
      raw[key.substring(4)] = val; // strip 'pto_' prefix
    }
  }

  return {
    calendarName:      raw['calendar_name']      || 'Verizon Calendar',
    veraCalendarName:  raw['vera_calendar']       || 'Vera',
    vacationDays:      parseInt(raw['vacation_days']  || '20', 10),
    personalHours:     parseInt(raw['personal_hours'] || '48', 10),
    year:              parseInt(raw['year'] || String(new Date().getFullYear()), 10),
    rolloverDays:      parseInt(raw['rollover_days']  || '0',  10),
    bufferDays:        parseInt(raw['buffer_days']    || '3',  10),
    gapCalendarsRaw:   raw['gap_calendars'] || 'Verizon Calendar,AE&VV - Our Joint Chaos',
    milestoneKeywords: (raw['milestone_keywords'] || 'Wedding,Graduation,Trip,Travel,Concert,Birthday')
                       .split(',').map(function(k) { return k.trim().toLowerCase(); }),
    // Only all-day events whose titles contain one of these strings are treated
    // as company holidays. Everything else that isn't Vacation/PTO is ignored.
    // Covers: Memorial Day, Independence Day, Labor Day, Thanksgiving Day,
    // Christmas Day, New Year's Day, MLK Day, Presidents' Day, Veterans Day,
    // Juneteenth, Columbus Day, Company Holiday, Floating Holiday, etc.
    holidayKeywords:       (raw['holiday_keywords'] || 'Day,Holiday,Floating,Closure')
                           .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    // Events in the work calendar whose titles contain any of these strings are
    // completely skipped — not counted as PTO or company holidays.
    ignoreKeywords:        (raw['ignore_keywords'] || 'Pay Day')
                           .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    // Multi-day events on gap calendars whose titles contain any of these strings
    // are excluded from the "Upcoming Travel" section (religious observances, etc.)
    travelIgnoreKeywords:  (raw['travel_ignore_keywords'] || 'Ramadan,Eid,Lent,Holiday,Observance,Fast,Hanukkah,Diwali,Passover')
                           .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    // When set, only multi-day events whose titles contain at least one of these
    // keywords are included as trips. Empty = include all multi-day events (old behaviour).
    travelRequireKeywords: (raw['travel_require_keywords'] || '')
                           .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    // Extra calendars scanned ONLY for trip detection (not for clear-window blocking or milestones).
    // Use for extended family / shared calendars whose events shouldn't block Ahmed's scheduling windows.
    travelExtraCalendars: (raw['travel_extra_calendars'] || '')
                          .split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    // Keywords in event title OR description that identify inbound guest visits on gap calendars.
    // Uses the top-level 'house_guest_keywords' Config key (not pto_* prefixed).
    guestKeywords: (allKeys['house_guest_keywords'] || 'Visit,Staying,Guests')
                   .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
  };
}

// ---- Victoria PTO Config ----------------------------------------------------

/**
 * Reads all victoria_pto_* keys from the Config tab for Victoria's PTO.
 * Falls back to shared gap/milestone/travel settings from Ahmed's config.
 * @returns {Object} structured config (same shape as readPTOConfig_())
 */
function readVictoriaPTOConfig_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found');

  var data    = sheet.getDataRange().getValues();
  var raw     = {};
  var shared  = {};
  var allKeys2 = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
    allKeys2[key] = val; // keep full key for non-pto_ settings
    if (key.indexOf('victoria_pto_') === 0) {
      raw[key.substring(13)] = val; // strip 'victoria_pto_' prefix
    }
    // Also read shared pto_ keys as fallbacks
    if (key.indexOf('pto_') === 0) {
      shared[key.substring(4)] = val;
    }
  }

  // Fall back to Ahmed's gap calendars, milestone keywords, etc. for shared sections
  return {
    calendarName:      raw['calendar_name']      || 'Westat Calendar',
    veraCalendarName:  raw['vera_calendar']       || shared['vera_calendar'] || 'Vera',
    vacationDays:      parseInt(raw['vacation_days']  || '15', 10),
    personalHours:     parseInt(raw['personal_hours'] || '0',  10),
    year:              parseInt(raw['year'] || shared['year'] || String(new Date().getFullYear()), 10),
    rolloverDays:      parseInt(raw['rollover_days']  || '0',  10),
    bufferDays:        parseInt(raw['buffer_days']    || '3',  10),
    // Shared settings — fall back to Ahmed's gap calendar config
    gapCalendarsRaw:   shared['gap_calendars'] || 'AE&VV - Our Joint Chaos',
    milestoneKeywords: (shared['milestone_keywords'] || 'Wedding,Graduation,Trip,Travel,Concert,Birthday')
                       .split(',').map(function(k) { return k.trim().toLowerCase(); }),
    holidayKeywords:   (raw['holiday_keywords'] || shared['holiday_keywords'] || 'Day,Holiday,Floating,Closure')
                       .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    ignoreKeywords:    (raw['ignore_keywords'] || shared['ignore_keywords'] || 'Pay Day')
                       .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    travelIgnoreKeywords: (shared['travel_ignore_keywords'] || 'Ramadan,Eid,Lent,Holiday,Observance,Fast,Christmas,Hanukkah,Diwali,Passover')
                          .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    travelRequireKeywords: (shared['travel_require_keywords'] || '')
                           .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
    travelExtraCalendars: (shared['travel_extra_calendars'] || '')
                          .split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    // Keywords in event title OR description that identify inbound guest visits on gap calendars.
    // Uses the top-level 'house_guest_keywords' Config key (not pto_* prefixed).
    guestKeywords: (allKeys2['house_guest_keywords'] || 'Visit,Staying,Guests')
                   .split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean),
  };
}

// ---- Buffer remaining -------------------------------------------------------

/**
 * Reads pto_buffer_remaining from Config tab.
 * Falls back to cfg.bufferDays if not set.
 */
function readPTOBufferRemaining_(cfg) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) return cfg.bufferDays;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'pto_buffer_remaining') {
      var v = parseInt(String(data[i][1]).trim(), 10);
      return isNaN(v) ? cfg.bufferDays : v;
    }
  }
  return cfg.bufferDays;
}

/**
 * Writes pto_buffer_remaining to Config tab (creates row if missing).
 */
function setPTOBufferRemaining_(newVal) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'pto_buffer_remaining') {
      sheet.getRange(i + 1, 2).setValue(Math.max(0, newVal));
      return;
    }
  }
  // Not found — append
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([['pto_buffer_remaining', Math.max(0, newVal)]]);
}

/**
 * Reads victoria_pto_buffer_remaining from Config tab.
 */
function readVictoriaPTOBufferRemaining_(cfg) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) return cfg.bufferDays;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'victoria_pto_buffer_remaining') {
      var v = parseInt(String(data[i][1]).trim(), 10);
      return isNaN(v) ? cfg.bufferDays : v;
    }
  }
  return cfg.bufferDays;
}

/**
 * Writes victoria_pto_buffer_remaining to Config tab (creates row if missing).
 */
function setVictoriaPTOBufferRemaining_(newVal) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'victoria_pto_buffer_remaining') {
      sheet.getRange(i + 1, 2).setValue(Math.max(0, newVal));
      return;
    }
  }
  // Not found — append
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([['victoria_pto_buffer_remaining', Math.max(0, newVal)]]);
}

// ---- Calendar helpers -------------------------------------------------------

/**
 * Returns the first CalendarApp.Calendar matching the given name.
 * Logs a warning and returns null if not found.
 */
function getCalendarByName_(name) {
  var cals = CalendarApp.getCalendarsByName(name.trim());
  if (!cals || cals.length === 0) {
    Logger.log('PTO: calendar not found: "' + name + '"');
    return null;
  }
  return cals[0];
}

/**
 * Returns an array of Calendar objects for the gap analysis calendars.
 */
function getGapCalendars_(cfg) {
  var names  = cfg.gapCalendarsRaw.split(',');
  var result = [];
  for (var i = 0; i < names.length; i++) {
    var cal = getCalendarByName_(names[i].trim());
    if (cal) result.push(cal);
  }
  return result;
}

/**
 * Counts workdays between startDate and endDate (inclusive),
 * excluding weekends and dates in holidaySet.
 * @param {Date}       startDate
 * @param {Date}       endDate
 * @param {Set<string>} holidaySet - Set of 'yyyy-MM-dd' strings
 * @returns {number}
 */
function countWeekdays_(startDate, endDate, holidaySet) {
  var tz    = Session.getScriptTimeZone();
  var count = 0;
  var d     = new Date(startDate.getTime());
  d.setHours(0, 0, 0, 0);
  var end = new Date(endDate.getTime());
  end.setHours(0, 0, 0, 0);

  while (d <= end) {
    var dow     = d.getDay();
    var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ---- PTO event reading ------------------------------------------------------

/**
 * Reads all PTO-related events from the Verizon Calendar for the configured year.
 * Pass 1: collects company holidays.
 * Pass 2: classifies 'Vacation' and 'PTO-Personal' events.
 *
 * @param {Object} cfg - from readPTOConfig_()
 * @returns {{ events: Array, holidays: Array, holidaySet: Set<string> }}
 */
function getPTOEvents_(cfg) {
  var cal = getCalendarByName_(cfg.calendarName);
  if (!cal) return { events: [], holidays: [], holidaySet: new Set() };

  var tz    = Session.getScriptTimeZone();
  var start = new Date(cfg.year, 0, 1);    // Jan 1
  var end   = new Date(cfg.year, 11, 31);  // Dec 31

  var allEvents  = cal.getEvents(start, end);
  var holidays   = [];
  var holidaySet = new Set();
  var ptoEvents  = [];
  var today      = new Date();
  today.setHours(0, 0, 0, 0);
  var yesterday  = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  var ignoreKws  = cfg.ignoreKeywords  || [];
  var holidayKws = cfg.holidayKeywords || ['day', 'holiday', 'floating', 'closure'];

  /** Returns true if the event title should be completely skipped (ignore list). */
  function isIgnored_(titleLower) {
    for (var k = 0; k < ignoreKws.length; k++) {
      if (ignoreKws[k] && titleLower.indexOf(ignoreKws[k]) !== -1) return true;
    }
    return false;
  }

  /** Returns true if the title looks like a company holiday (allowlist). */
  function isHoliday_(titleLower) {
    for (var k = 0; k < holidayKws.length; k++) {
      if (holidayKws[k] && titleLower.indexOf(holidayKws[k]) !== -1) return true;
    }
    return false;
  }

  // ---- Pass 1: collect company holidays -----------------------------------
  // Only all-day events that match holidayKeywords are treated as holidays.
  // Events matching ignoreKeywords (e.g. "Pay Day") are dropped first.
  // Everything else (STI payout, grants, performance reviews, etc.) is ignored.
  for (var i = 0; i < allEvents.length; i++) {
    var ev     = allEvents[i];
    var title  = ev.getTitle().trim();
    var tLower = title.toLowerCase();
    if (!ev.isAllDayEvent()) continue;
    if (isIgnored_(tLower)) continue;                        // "Pay Day(V)" etc. — drop entirely
    if (tLower.indexOf('vacation') !== -1) continue;         // handled in Pass 2
    if (tLower.indexOf('pto')      !== -1) continue;         // handled in Pass 2
    if (!isHoliday_(tLower)) continue;                       // not a holiday keyword — ignore

    var hDate    = ev.getAllDayStartDate();
    var hDateStr = Utilities.formatDate(hDate, tz, 'yyyy-MM-dd');
    if (!holidaySet.has(hDateStr)) {
      holidaySet.add(hDateStr);
      holidays.push({ label: title, date: hDateStr });
    }
  }

  // ---- Pass 2: classify PTO events ----------------------------------------
  for (var j = 0; j < allEvents.length; j++) {
    var ev2    = allEvents[j];
    var title2 = ev2.getTitle().trim();
    var tLow2  = title2.toLowerCase();
    if (isIgnored_(tLow2)) continue;                      // skip ignored events in all passes

    if (ev2.isAllDayEvent()) {
      if (tLow2.indexOf('vacation') !== -1) {
        // Full vacation day(s)
        var vStart   = ev2.getAllDayStartDate();
        var vEndExcl = ev2.getAllDayEndDate(); // exclusive
        var vEndIncl = new Date(vEndExcl.getTime() - 24 * 60 * 60 * 1000);

        if (vEndIncl < today) {
          // Entirely past → Used
          ptoEvents.push({
            type:      'Vacation',
            label:     title2,
            startDate: Utilities.formatDate(vStart,   tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(vEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  countWeekdays_(vStart, vEndIncl, holidaySet),
            hours:     null,
            status:    'Used',
          });
        } else if (vStart < today) {
          // In-progress: started before today, ends today or later → split at today boundary
          var vUsedDays    = countWeekdays_(vStart,     yesterday, holidaySet);
          var vPlannedDays = countWeekdays_(today,      vEndIncl,  holidaySet);
          if (vUsedDays > 0) {
            ptoEvents.push({
              type:      'Vacation',
              label:     title2,
              startDate: Utilities.formatDate(vStart,    tz, 'yyyy-MM-dd'),
              endDate:   Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd'),
              isAllDay:  true,
              weekdays:  vUsedDays,
              hours:     null,
              status:    'Used',
            });
          }
          ptoEvents.push({
            type:      'Vacation',
            label:     title2,
            startDate: Utilities.formatDate(today,    tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(vEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  vPlannedDays,
            hours:     null,
            status:    'Planned',
          });
        } else {
          // Entirely future → Planned
          ptoEvents.push({
            type:      'Vacation',
            label:     title2,
            startDate: Utilities.formatDate(vStart,   tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(vEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  countWeekdays_(vStart, vEndIncl, holidaySet),
            hours:     null,
            status:    'Planned',
          });
        }

      } else if (tLow2.indexOf('pto') !== -1) {
        // All-day PTO = 8 hrs per calendar day
        var pStart   = ev2.getAllDayStartDate();
        var pEndExcl = ev2.getAllDayEndDate();
        var pEndIncl = new Date(pEndExcl.getTime() - 24 * 60 * 60 * 1000);

        /** Count calendar days from d1 to d2 inclusive. */
        function countCalDays_(d1, d2) {
          var d = new Date(d1.getTime()); d.setHours(0, 0, 0, 0);
          var e = new Date(d2.getTime()); e.setHours(0, 0, 0, 0);
          var n = 0;
          while (d <= e) { n++; d.setDate(d.getDate() + 1); }
          return n;
        }

        if (pEndIncl < today) {
          // Entirely past → Used
          var pDays = countCalDays_(pStart, pEndIncl);
          ptoEvents.push({
            type:      'PTO-Personal',
            label:     title2,
            startDate: Utilities.formatDate(pStart,   tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(pEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  pDays,
            hours:     pDays * 8,
            status:    'Used',
          });
        } else if (pStart < today) {
          // In-progress → split at today boundary
          var pUsedDays    = countCalDays_(pStart,     yesterday);
          var pPlannedDays = countCalDays_(today,      pEndIncl);
          if (pUsedDays > 0) {
            ptoEvents.push({
              type:      'PTO-Personal',
              label:     title2,
              startDate: Utilities.formatDate(pStart,    tz, 'yyyy-MM-dd'),
              endDate:   Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd'),
              isAllDay:  true,
              weekdays:  pUsedDays,
              hours:     pUsedDays * 8,
              status:    'Used',
            });
          }
          ptoEvents.push({
            type:      'PTO-Personal',
            label:     title2,
            startDate: Utilities.formatDate(today,    tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(pEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  pPlannedDays,
            hours:     pPlannedDays * 8,
            status:    'Planned',
          });
        } else {
          // Entirely future → Planned
          var pDays = countCalDays_(pStart, pEndIncl);
          ptoEvents.push({
            type:      'PTO-Personal',
            label:     title2,
            startDate: Utilities.formatDate(pStart,   tz, 'yyyy-MM-dd'),
            endDate:   Utilities.formatDate(pEndIncl, tz, 'yyyy-MM-dd'),
            isAllDay:  true,
            weekdays:  pDays,
            hours:     pDays * 8,
            status:    'Planned',
          });
        }
      }
      // else: holiday — already captured in pass 1

    } else {
      // Timed event
      if (tLow2.indexOf('pto') !== -1) {
        var tStart  = ev2.getStartTime();
        var tEnd    = ev2.getEndTime();
        var tHours  = Math.round(((tEnd.getTime() - tStart.getTime()) / 3600000) * 10) / 10;
        var tStatus = tEnd < today ? 'Used' : 'Planned';
        ptoEvents.push({
          type:      'PTO-Personal',
          label:     title2,
          startDate: Utilities.formatDate(tStart, tz, 'yyyy-MM-dd'),
          endDate:   Utilities.formatDate(tEnd,   tz, 'yyyy-MM-dd'),
          isAllDay:  false,
          weekdays:  null,
          hours:     tHours,
          status:    tStatus,
        });
      }
      // else: regular work meeting — ignore
    }
  }

  // Sort by start date
  ptoEvents.sort(function(a, b) {
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });
  // Sort holidays by date
  holidays.sort(function(a, b) { return a.date < b.date ? -1 : 1; });

  return { events: ptoEvents, holidays: holidays, holidaySet: holidaySet };
}

// ---- Shared Chaos travel ----------------------------------------------------

// ---- Cruise Detection -------------------------------------------------------

/**
 * Keywords identifying cruise boarding events (title must START with one of these).
 * Ordered longest-first so e.g. "embarking" is checked before "embark".
 */
var CRUISE_BOARD_KEYWORDS    = ['embarking', 'boarding', 'embark', 'board'];
var CRUISE_DISEMBARK_KEYWORDS = ['disembarking', 'disembarkation', 'disembark'];

/** Returns true if the event title starts with a cruise boarding keyword. */
function isBoardingEvent_(title) {
  var low = title.toLowerCase();
  return CRUISE_BOARD_KEYWORDS.some(function(kw) {
    return low === kw || low.indexOf(kw + ' ') === 0;
  });
}

/** Returns true if the event title starts with a cruise disembarkation keyword. */
function isDisembarkEvent_(title) {
  var low = title.toLowerCase();
  return CRUISE_DISEMBARK_KEYWORDS.some(function(kw) {
    return low === kw || low.indexOf(kw + ' ') === 0;
  });
}

/**
 * Extracts the cruise/ship name from a boarding or disembarkation event title
 * by stripping the leading keyword and optional "the".
 *
 * Examples:
 *   "Board Norwegian Bliss"        → "Norwegian Bliss"
 *   "Boarding the Carnival Vista"  → "Carnival Vista"
 *   "Embarking on Celebrity Edge"  → "on Celebrity Edge" (kept — user chose that phrasing)
 *   "Disembarking Norwegian Bliss" → "Norwegian Bliss"
 *
 * @param {string} title
 * @returns {string}
 */
function extractCruiseName_(title) {
  var low    = title.toLowerCase();
  var allKw  = CRUISE_BOARD_KEYWORDS.concat(CRUISE_DISEMBARK_KEYWORDS);
  var result = title;
  for (var i = 0; i < allKw.length; i++) {
    var kw = allKw[i];
    if (low.indexOf(kw + ' ') === 0) {
      result = title.substring(kw.length).trim();
      break;
    }
    if (low === kw) { result = ''; break; }
  }
  // Strip optional leading "the "
  result = result.replace(/^the\s+/i, '').trim();
  return result;
}

/**
 * Scans raw Google Calendar events to detect cruise trips from
 * boarding / disembarkation event pairs.
 *
 * Detection logic:
 *   a) "Board*" / "Embark*" event followed by a "Disembark*" event
 *      within 30 days → paired into one cruise span.
 *   b) "Board*" / "Embark*" event that is multi-day (≥2 days) with
 *      no matching Disembark → treated as a self-contained cruise
 *      (the event itself spans the whole trip).
 *   c) Single-day "Board*" event with no Disembark → skipped
 *      (can't determine cruise end date).
 *
 * @param {Array}  rawEvents  - All Google Calendar event objects to scan
 * @param {string} tz         - Script timezone
 * @param {Date}   today      - Today at midnight local time
 * @returns {{ cruises: Array, skipKeys: Object, spans: Array }}
 *   cruises  — synthetic trip objects with isCruise: true
 *   skipKeys — { "title|startStr": true } — events to omit from regular travel
 *   spans    — [{ startStr, endStr }] date ranges for suppressing in-cruise events
 */
function detectCruises_(rawEvents, tz, today) {
  var boardings     = [];
  var disembarkings = [];

  rawEvents.forEach(function(ev) {
    if (!ev.isAllDayEvent()) return;
    var title    = ev.getTitle().trim();
    var startD   = ev.getAllDayStartDate();
    var endExcl  = ev.getAllDayEndDate();
    var endIncl  = new Date(endExcl.getTime() - 86400000);
    var dur      = Math.round((endExcl.getTime() - startD.getTime()) / 86400000);
    var startStr = Utilities.formatDate(startD,  tz, 'yyyy-MM-dd');
    var endStr   = Utilities.formatDate(endIncl, tz, 'yyyy-MM-dd');

    if (isBoardingEvent_(title)) {
      boardings.push({ title: title, start: startD, startStr: startStr, endStr: endStr, dur: dur });
    } else if (isDisembarkEvent_(title)) {
      disembarkings.push({ title: title, start: startD, startStr: startStr, endStr: endStr, dur: dur });
    }
  });

  var cruises  = [];
  var skipKeys = {};
  var spans    = [];

  boardings.forEach(function(b) {
    var shipName = extractCruiseName_(b.title);

    // Find the nearest Disembark event that occurs AFTER this boarding (within 30 days)
    var matchD = null;
    disembarkings.forEach(function(d) {
      if (d.start.getTime() <= b.start.getTime()) return;
      var daysDiff = Math.round((d.start.getTime() - b.start.getTime()) / 86400000);
      if (daysDiff > 30) return;
      if (!matchD || d.start.getTime() < matchD.start.getTime()) matchD = d;
    });

    var cruiseEndStr;
    if (matchD) {
      // Paired: use the disembarkation day as the inclusive end
      cruiseEndStr = matchD.endStr;
      skipKeys[matchD.title + '|' + matchD.startStr] = true;
    } else if (b.dur >= 2) {
      // No disembark found — the boarding event itself spans the full cruise
      cruiseEndStr = b.endStr;
    } else {
      // Single-day boarding with no matching Disembark — skip
      Logger.log('detectCruises_: boarding "' + b.title +
                 '" has no Disembark within 30 days and is single-day — skipping');
      return;
    }

    skipKeys[b.title + '|' + b.startStr] = true;

    var daysAway = Math.round((b.start.getTime() - today.getTime()) / 86400000);
    // Avoid doubling "Cruise" if the ship name already contains the word
    var label = shipName
      ? (/cruise/i.test(shipName) ? shipName : shipName + ' (Cruise)')
      : 'Cruise';

    cruises.push({
      label:        label,
      startDate:    b.startStr,
      endDate:      cruiseEndStr,
      daysAway:     daysAway,
      calendarName: '',
      isCruise:     true,
    });

    spans.push({ startStr: b.startStr, endStr: cruiseEndStr });
    Logger.log('detectCruises_: "' + label + '" ' + b.startStr + ' – ' + cruiseEndStr);
  });

  return { cruises: cruises, skipKeys: skipKeys, spans: spans };
}

// ---- Travel collection ------------------------------------------------------

/**
 * Reads multi-day all-day events from all gap calendars (excluding the work
 * PTO calendar itself) for the next 365 days so year-end trips (e.g. Christmas)
 * are always visible.
 * Gap calendars are config-driven via pto_gap_calendars (e.g. "AE&VV - Our Joint Chaos").
 * Cruise trips (Board* … Disembark* event pairs) are detected and returned as
 * synthetic entries with isCruise: true and a normalised label.
 * @returns {Array} [{ label, startDate, endDate, daysAway, calendarName, isCruise? }]
 */
// Per-execution memoization cache — every one of getUpcomingTravel_'s 11 call
// sites across the codebase builds its cfg via readPTOConfig_() with no
// per-caller variation, so within a single script execution this always scans
// the same 365-day, multi-calendar window for the same result. Without this,
// a single nightlyRun() was independently re-running the full scan 5-6 times
// (writePTOSnapshot_, generateFlags' prompt builder, checkPreTripBriefings_,
// checkFitnessConsistency_, checkFitnessTravelGap_, runExplorer_'s
// getTravelContextForPlanner_), which was expensive enough on its own to
// contribute to hitting the GAS 6-minute execution limit.
var _upcomingTravelCache_ = null;

function getUpcomingTravel_(cfg) {
  var cacheKey = JSON.stringify({
    gapCalendarsRaw:       cfg.gapCalendarsRaw,
    calendarName:          cfg.calendarName,
    travelExtraCalendars:  cfg.travelExtraCalendars,
    travelIgnoreKeywords:  cfg.travelIgnoreKeywords,
    travelRequireKeywords: cfg.travelRequireKeywords,
  });
  if (_upcomingTravelCache_ && _upcomingTravelCache_.key === cacheKey) {
    // .slice() so a caller mutating the array (push/sort/splice) can't corrupt
    // the shared cache for every other caller in this execution. No current
    // caller does this (verified), but it's cheap insurance for future ones.
    return _upcomingTravelCache_.result.slice();
  }

  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

  // Use gap calendars from config, but skip the work/PTO calendar — travel
  // entries come from shared/family calendars plus the user's own primary
  // calendar (added below, in Phase 1), never the work calendar.
  var gapCalNames = (cfg.gapCalendarsRaw || '').split(',')
    .map(function(n) { return n.trim(); })
    .filter(function(n) { return n && n !== cfg.calendarName; });

  // Extra calendars scanned for trips only (not for clear-window blocking).
  // Typically extended family calendars that are shared with Ahmed.
  var extraCalNames = cfg.travelExtraCalendars || [];
  var extraCalSet   = {};
  extraCalNames.forEach(function(n) { extraCalSet[n] = true; });

  // Merged list: gap calendars + extra-only travel calendars (deduplicated)
  var travelCalNames = gapCalNames.slice();
  extraCalNames.forEach(function(n) {
    if (travelCalNames.indexOf(n) === -1) travelCalNames.push(n);
  });

  var travelIgnore  = cfg.travelIgnoreKeywords  || [];
  var travelRequire = cfg.travelRequireKeywords || []; // empty = no restriction

  // ---- Phase 1: Collect ALL events from all travel calendars (including single-day)
  // We need single-day events too so cruise Board/Disembark days can be detected.
  var allCalEvents = [];   // [{ ev, calName, isExtendedFamily }]

  // The user's own primary calendar is always scanned too — a trip added
  // there is just as real as one on a shared/family calendar. Not the same
  // concept as travelExtraCalendars (extended-family visibility), so it's
  // always isExtendedFamily: false. Guard against double-scanning in case
  // it's also (redundantly) named in gap/extra config.
  var personalCal = CalendarApp.getDefaultCalendar();
  if (personalCal && travelCalNames.indexOf(personalCal.getName()) === -1) {
    var personalEvs = personalCal.getEvents(today, end);
    for (var pi = 0; pi < personalEvs.length; pi++) {
      allCalEvents.push({ ev: personalEvs[pi], calName: personalCal.getName(), isExtendedFamily: false });
    }
  }

  for (var c = 0; c < travelCalNames.length; c++) {
    var calN = travelCalNames[c];
    var cal  = getCalendarByName_(calN);
    if (!cal) {
      Logger.log('getUpcomingTravel_: calendar not found — "' + calN + '"');
      continue;
    }
    var rawEvs          = cal.getEvents(today, end);
    // Gap calendar membership always wins — if a calendar is in both gapCalNames
    // and travelExtraCalendars (config mistake), treat it as trusted, not extended family.
    var isExtendedFam   = !!extraCalSet[calN] && gapCalNames.indexOf(calN) === -1;
    for (var i = 0; i < rawEvs.length; i++) {
      allCalEvents.push({ ev: rawEvs[i], calName: calN, isExtendedFamily: isExtendedFam });
    }
  }

  // ---- Phase 2: Detect cruise trips from Board*/Disembark* event pairs
  var rawOnly     = allCalEvents.map(function(e) { return e.ev; });
  var cruiseData  = detectCruises_(rawOnly, tz, today);

  // Seed the travel list with the synthetic cruise entries
  var travel = cruiseData.cruises.slice();
  var seen   = {};   // deduplicate regular events by "label|startStr"

  // ---- Phase 3: Collect regular multi-day non-cruise events
  for (var ei = 0; ei < allCalEvents.length; ei++) {
    var ev               = allCalEvents[ei].ev;
    var calName          = allCalEvents[ei].calName;
    var isExtFam         = allCalEvents[ei].isExtendedFamily || false;

    if (!ev.isAllDayEvent()) continue;

    var label    = ev.getTitle().trim();
    var labelLow = label.toLowerCase();

    // Skip religious observances and other non-travel multi-day events
    var ignored = false;
    for (var ki = 0; ki < travelIgnore.length; ki++) {
      if (travelIgnore[ki] && labelLow.indexOf(travelIgnore[ki]) !== -1) {
        ignored = true;
        break;
      }
    }
    if (ignored) continue;

    // If travel_require_keywords is set, skip events that don't match any keyword
    if (travelRequire.length > 0) {
      var matched = false;
      for (var ri = 0; ri < travelRequire.length; ri++) {
        if (travelRequire[ri] && labelLow.indexOf(travelRequire[ri]) !== -1) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        Logger.log('getUpcomingTravel_: skipped "' + label + '" — no travel keyword match');
        continue;
      }
    }

    var evStart      = ev.getAllDayStartDate();
    var evEndExcl    = ev.getAllDayEndDate();
    var durationDays = (evEndExcl.getTime() - evStart.getTime()) / (24 * 60 * 60 * 1000);
    if (durationDays < 2) continue; // skip single-day events

    var evEndIncl = new Date(evEndExcl.getTime() - 24 * 60 * 60 * 1000);
    var daysAway  = Math.round((evStart.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    var startStr  = Utilities.formatDate(evStart, tz, 'yyyy-MM-dd');
    var endStr    = Utilities.formatDate(evEndIncl, tz, 'yyyy-MM-dd');
    var key       = label + '|' + startStr;

    // Skip events already captured as cruise components (Board / Disembark events)
    if (cruiseData.skipKeys[key]) continue;

    // Skip multi-day excursions or shore stays that fall entirely within a cruise span
    var withinCruise = cruiseData.spans.some(function(span) {
      return startStr >= span.startStr && endStr <= span.endStr;
    });
    if (withinCruise) {
      Logger.log('getUpcomingTravel_: suppressed "' + label + '" (' + startStr +
                 ' – ' + endStr + ') — falls within a cruise span');
      continue;
    }

    if (!seen[key]) {
      seen[key] = true;
      var tripEntry = {
        label:        label,
        startDate:    startStr,
        endDate:      endStr,
        daysAway:     daysAway,
        calendarName: calName,
      };
      if (isExtFam) tripEntry.isExtendedFamily = true;
      travel.push(tripEntry);
    }
  }

  // Sort by start date
  travel.sort(function(a, b) { return a.startDate < b.startDate ? -1 : 1; });

  // Filter out sub-events (hotel stays, pre-trip accommodations, etc.) that are
  // adjacent to or contained within a longer trip on the same calendar period.
  travel = filterSubEvents_(travel);

  // Store the untouched array in the cache and hand the caller a copy — same
  // reasoning as the cache-hit branch above: this call's array must never be
  // the same object a caller could mutate.
  _upcomingTravelCache_ = { key: cacheKey, result: travel };
  return travel.slice();
}

/**
 * Suppresses shorter multi-day events that are adjacent to or overlapping
 * a STRICTLY longer event — removes hotel stays, pre-trip accommodations, etc.
 * from appearing as standalone trips when they are part of a larger journey.
 *
 * Adjacency tolerance: 1 day (handles check-out day N / check-in day N+1 patterns).
 * Equal-duration events are NEVER suppressed (two back-to-back trips of equal
 * length are both kept as separate entries).
 *
 * Algorithm:
 *   1. Sort by duration descending (longer trips first)
 *   2. For each event, if a STRICTLY longer accepted event is already nearby, suppress it
 *   3. Re-sort by startDate ascending for output
 *
 * @param {Array} trips - Sorted array of trip objects from getUpcomingTravel_()
 * @returns {Array} Filtered array with sub-events removed
 */
function filterSubEvents_(trips) {
  if (trips.length <= 1) return trips;

  // Parse a yyyy-MM-dd string into a local midnight Date (avoids TZ parsing issues)
  function parseDateStr(s) {
    var p = s.split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  // Inclusive duration in days (endDate is already stored as inclusive)
  function duration(t) {
    return Math.round((parseDateStr(t.endDate) - parseDateStr(t.startDate)) / 86400000) + 1;
  }

  // Returns true if two trips overlap or are separated by ≤ 1 day
  // (handles hotel check-out day N immediately before trip start day N+1)
  function isNearby(a, b) {
    var aEnd   = parseDateStr(a.endDate);
    var bStart = parseDateStr(b.startDate);
    var bEnd   = parseDateStr(b.endDate);
    var aStart = parseDateStr(a.startDate);
    // Gap from a's end to b's start (negative = overlap; 0 = back-to-back; 1 = 1-day gap)
    var gapAB = Math.round((bStart - aEnd) / 86400000);
    // Gap from b's end to a's start (negative = overlap)
    var gapBA = Math.round((aStart - bEnd) / 86400000);
    return gapAB <= 1 && gapBA <= 1;
  }

  // Sort by duration descending so longer "parent" trips are evaluated first
  var sorted = trips.slice().sort(function(a, b) {
    var dd = duration(b) - duration(a);
    if (dd !== 0) return dd;
    return a.startDate < b.startDate ? -1 : 1; // tie-break: earlier start first
  });

  var accepted = [];
  sorted.forEach(function(trip) {
    var dur = duration(trip);
    // Suppress only if a STRICTLY longer accepted trip is nearby
    // (equal-duration consecutive trips are kept — they are separate destinations)
    // Cruise entries are never suppressed — they are the primary representation
    // of the cruise period and have already absorbed their component events.
    var isSubEvent = !trip.isCruise && accepted.some(function(acc) {
      return duration(acc) > dur && isNearby(acc, trip);
    });

    if (isSubEvent) {
      Logger.log('getUpcomingTravel_: suppressed sub-event "' + trip.label +
                 '" (' + trip.startDate + ' – ' + trip.endDate + ', ' + dur + 'd)' +
                 ' — absorbed into a nearby longer trip');
    } else {
      accepted.push(trip);
    }
  });

  // Re-sort by startDate ascending for consistent output order
  accepted.sort(function(a, b) { return a.startDate < b.startDate ? -1 : 1; });
  return accepted;
}

// ---- 3-2-1 classification ---------------------------------------------------

/**
 * Classifies a vacation block by duration.
 * @param {number} weekdays
 * @param {string} startDate 'yyyy-MM-dd'
 * @param {string} endDate   'yyyy-MM-dd' (inclusive)
 * @returns {'longWeekend'|'midSizeWeek'|'bigPivot'}
 */
function classifyPTOBlock_(weekdays, startDate, endDate) {
  var start    = new Date(startDate);
  var end      = new Date(endDate);
  var calDays  = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (weekdays <= 3 && calDays <= 5) return 'longWeekend';
  if (weekdays <= 7)                 return 'midSizeWeek';
  return 'bigPivot';
}

// ---- House Guests -----------------------------------------------------------

/**
 * Reads multi-day all-day events from gap calendars (shared chaos) whose
 * title OR description contains at least one guest keyword.
 * Used for the Guests subtab and morning email ticker (Issue #150).
 *
 * @param  {Object} cfg  From readPTOConfig_()
 * @returns {Array} [{ label, arrivalDate, departureDate, durationDays, daysAway, calendarName }]
 */
function getUpcomingGuests_(cfg) {
  var guestKeywords = cfg.guestKeywords || [];
  if (guestKeywords.length === 0) return []; // safety: never return everything without a keyword filter

  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000);

  // Scan gap calendars only (excludes work/PTO calendar)
  var gapCalNames = (cfg.gapCalendarsRaw || '').split(',')
    .map(function(n) { return n.trim(); })
    .filter(function(n) { return n && n !== cfg.calendarName; });

  var results = [];
  var seen    = {};

  for (var c = 0; c < gapCalNames.length; c++) {
    var cal = getCalendarByName_(gapCalNames[c]);
    if (!cal) continue;

    var events = cal.getEvents(today, end);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev.isAllDayEvent()) continue;

      var evStart      = ev.getAllDayStartDate();
      var evEndExcl    = ev.getAllDayEndDate();
      var durationDays = Math.round((evEndExcl.getTime() - evStart.getTime()) / (24 * 60 * 60 * 1000));
      if (durationDays < 2) continue; // single-day events are not guest stays

      var title    = ev.getTitle().trim();
      var descRaw  = '';
      try { descRaw = ev.getDescription() || ''; } catch (de) {}
      var titleLow = title.toLowerCase();
      var descLow  = descRaw.toLowerCase();

      // Must match at least one guest keyword in title OR description
      var matched = false;
      for (var ki = 0; ki < guestKeywords.length; ki++) {
        if (guestKeywords[ki] && (titleLow.indexOf(guestKeywords[ki]) !== -1 || descLow.indexOf(guestKeywords[ki]) !== -1)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;

      var evEndIncl = new Date(evEndExcl.getTime() - 24 * 60 * 60 * 1000);
      var startStr  = Utilities.formatDate(evStart,   tz, 'yyyy-MM-dd');
      var endStr    = Utilities.formatDate(evEndIncl, tz, 'yyyy-MM-dd');
      var key       = title + '|' + startStr;
      if (seen[key]) continue;
      seen[key] = true;

      var daysAway = Math.round((evStart.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

      results.push({
        label:        title,
        arrivalDate:  startStr,
        departureDate: endStr,
        durationDays: durationDays,
        daysAway:     daysAway,
        calendarName: gapCalNames[c],
      });
    }
  }

  results.sort(function(a, b) { return a.arrivalDate < b.arrivalDate ? -1 : 1; });
  return results;
}

// ---- Clear window finder ----------------------------------------------------

/**
 * Finds runs of consecutive clear workdays across all gap calendars.
 * "Clear" = no events on that day in ANY gap calendar.
 * Weekends don't break a run but aren't counted toward it.
 *
 * @param {Array}  gapCalendars
 * @param {Date}   today
 * @param {number} lookAheadDays (default 90)
 * @param {number} minDays       (default 3)
 * @returns {Array} Up to 3 windows: [{ startDate, endDate, workdays }]
 */
function findClearWindows_(gapCalendars, today, lookAheadDays, minDays) {
  lookAheadDays = lookAheadDays || 90;
  minDays       = minDays       || 3;

  var tz      = Session.getScriptTimeZone();
  var scanEnd = new Date(today.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
  var blocked = {}; // dateStr → true

  // Collect all events across gap calendars → blocked days
  for (var c = 0; c < gapCalendars.length; c++) {
    var events = gapCalendars[c].getEvents(today, scanEnd);
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      if (ev.isAllDayEvent()) {
        var evStart  = ev.getAllDayStartDate();
        var evEndExcl = ev.getAllDayEndDate(); // exclusive
        var d = new Date(evStart.getTime());
        d.setHours(0, 0, 0, 0);
        while (d < evEndExcl) {
          blocked[Utilities.formatDate(d, tz, 'yyyy-MM-dd')] = true;
          d.setDate(d.getDate() + 1);
        }
      } else {
        // Timed event — block just its day
        var dateStr2 = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
        blocked[dateStr2] = true;
      }
    }
  }

  // Walk forward, tracking runs of clear workdays
  var windows  = [];
  var runStart = null;
  var runLast  = null;
  var runDays  = 0;
  var d2 = new Date(today.getTime());
  d2.setDate(d2.getDate() + 1); // start tomorrow
  d2.setHours(0, 0, 0, 0);

  while (d2 <= scanEnd && windows.length < 3) {
    var dow     = d2.getDay();
    var dateStr = Utilities.formatDate(d2, tz, 'yyyy-MM-dd');

    if (dow === 0 || dow === 6) {
      // Weekend — skip (doesn't break or count toward run)

    } else if (blocked[dateStr]) {
      // Blocked workday — end the run
      if (runDays >= minDays) {
        windows.push({ startDate: runStart, endDate: runLast, workdays: runDays });
      }
      runStart = null;
      runLast  = null;
      runDays  = 0;

    } else {
      // Clear workday — extend the run
      if (!runStart) runStart = dateStr;
      runLast = dateStr;
      runDays++;
    }

    d2.setDate(d2.getDate() + 1);
  }

  // Capture final run if scan ended mid-run
  if (runDays >= minDays && windows.length < 3 && runStart) {
    windows.push({ startDate: runStart, endDate: runLast, workdays: runDays });
  }

  return windows;
}

// ---- Milestone finder -------------------------------------------------------

/**
 * Finds upcoming all-day events on gap calendars matching milestone keywords.
 * @param {Array}  gapCalendars
 * @param {Object} cfg
 * @param {Date}   today
 * @returns {Array} [{ label, date, daysUntil, calendarName }]
 */
function getMilestones_(gapCalendars, cfg, today) {
  var tz       = Session.getScriptTimeZone();
  var end      = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  var keywords = cfg.milestoneKeywords;
  var results  = [];
  var seen     = {};

  for (var c = 0; c < gapCalendars.length; c++) {
    var calName = gapCalendars[c].getName();
    var events  = gapCalendars[c].getEvents(today, end);
    for (var e = 0; e < events.length; e++) {
      var ev    = events[e];
      if (!ev.isAllDayEvent()) continue;
      var title = ev.getTitle().trim();
      var tLow  = title.toLowerCase();

      var match = false;
      for (var k = 0; k < keywords.length; k++) {
        if (tLow.indexOf(keywords[k]) !== -1) { match = true; break; }
      }
      if (!match) continue;

      var evDate   = ev.getAllDayStartDate();
      var dateStr  = Utilities.formatDate(evDate, tz, 'yyyy-MM-dd');
      var seenKey  = title + '|' + dateStr;
      if (seen[seenKey]) continue;
      seen[seenKey] = true;

      var daysUntil = Math.round((evDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      results.push({ label: title, date: dateStr, daysUntil: daysUntil, calendarName: calName });
    }
  }

  results.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  return results;
}

// ---- Stats computation ------------------------------------------------------

/**
 * Computes all PTO stats from events and config.
 * @param {{ events, holidays, holidaySet }} ptoResult - from getPTOEvents_()
 * @param {Object} cfg   - from readPTOConfig_()
 * @param {Date}   today
 * @returns {Object} full stats object
 */
function computePTOStats_(ptoResult, cfg, today) {
  var events   = ptoResult.events;
  var holidays = ptoResult.holidays;
  var tz       = Session.getScriptTimeZone();

  // ---- Used / Planned totals ----------------------------------------------
  var usedVacDays  = 0, plannedVacDays  = 0;
  var usedPersHrs  = 0, plannedPersHrs  = 0;

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'Vacation') {
      if (ev.status === 'Used') usedVacDays    += ev.weekdays;
      else                      plannedVacDays  += ev.weekdays;
    } else if (ev.type === 'PTO-Personal') {
      if (ev.status === 'Used') usedPersHrs     += ev.hours;
      else                      plannedPersHrs  += ev.hours;
    }
  }

  var totalVacDays = cfg.vacationDays + cfg.rolloverDays;
  var totalPersHrs = cfg.personalHours;
  var remVacDays   = totalVacDays - usedVacDays  - plannedVacDays;
  var remPersHrs   = totalPersHrs - usedPersHrs  - plannedPersHrs;

  // ---- Burn-down pace -----------------------------------------------------
  // Combine vacation days + PTO-Personal hours (÷8 per day) so that events
  // named "PTO" (personal pool) are included alongside "Vacation" events.
  var usedAllDays    = Math.round((usedVacDays    + usedPersHrs    / 8) * 10) / 10;
  var plannedAllDays = Math.round((plannedVacDays + plannedPersHrs / 8) * 10) / 10;
  var totalAllDays   = Math.round((totalVacDays   + totalPersHrs   / 8) * 10) / 10;

  var yearStart  = new Date(cfg.year, 0, 1);
  var dayOfYear  = Math.max(1, Math.round((today.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000)));
  var totalDays  = 365;
  var idealUsed  = Math.round((dayOfYear / totalDays) * totalAllDays * 10) / 10;
  var paceGap    = Math.round((usedAllDays - idealUsed) * 10) / 10;
  var paceStatus = paceGap >= 1 ? 'ahead' : paceGap <= -2 ? 'behind' : 'on-track';
  var projYearEnd = usedAllDays + plannedAllDays;
  var projUnused  = totalAllDays - projYearEnd;

  // ---- 3-2-1 classification -----------------------------------------------
  var threeToOne = {
    longWeekends: { target: 3, used: 0, planned: 0 },
    midSizeWeeks:  { target: 2, used: 0, planned: 0 },
    bigPivot:      { target: 1, used: 0, planned: 0 },
  };

  for (var j = 0; j < events.length; j++) {
    var ev2 = events[j];
    if (ev2.type !== 'Vacation') continue;
    var cat   = classifyPTOBlock_(ev2.weekdays, ev2.startDate, ev2.endDate);
    var field = cat === 'longWeekend' ? 'longWeekends' : cat === 'midSizeWeek' ? 'midSizeWeeks' : 'bigPivot';
    if (ev2.status === 'Used') threeToOne[field].used++;
    else                       threeToOne[field].planned++;
  }

  // ---- Next PTO -----------------------------------------------------------
  var nextPTO = null;
  for (var k = 0; k < events.length; k++) {
    var ev3 = events[k];
    if (ev3.status === 'Planned') {
      var evDate   = new Date(ev3.startDate);
      var daysAway = Math.round((evDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      nextPTO = { daysUntil: daysAway, label: ev3.label, startDate: ev3.startDate, type: ev3.type };
      break;
    }
  }

  // ---- Buffer remaining ---------------------------------------------------
  var bufRemaining = readPTOBufferRemaining_(cfg);

  // ---- Remaining holidays -------------------------------------------------
  var todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  var remainHolidays = holidays.filter(function(h) { return h.date >= todayStr; });

  return {
    year:    cfg.year,
    config:  {
      vacationDays:  cfg.vacationDays,
      personalHours: cfg.personalHours,
      rolloverDays:  cfg.rolloverDays,
      bufferDays:    cfg.bufferDays,
    },
    used:     { vacationDays: usedVacDays,   personalHours: usedPersHrs },
    planned:  { vacationDays: plannedVacDays, personalHours: plannedPersHrs },
    remaining:{ vacationDays: remVacDays,    personalHours: remPersHrs },
    burnDown: {
      dayOfYear:        dayOfYear,
      totalDays:        totalDays,
      idealUsedToDate:  idealUsed,
      actualUsedToDate: usedAllDays,
      paceGap:          paceGap,
      paceStatus:       paceStatus,
      projectedYearEnd: projYearEnd,
      projectedUnused:  projUnused,
    },
    threeToOneStatus: threeToOne,
    bufferStatus:     { total: cfg.bufferDays, remaining: bufRemaining },
    nextPTO:          nextPTO,
    events:           events,
    holidays:         remainHolidays,
    // clearWindows, milestones, upcomingTravel added by writePTOSnapshot_()
  };
}

// ---- VERA Calendar recommendations ------------------------------------------

// ============================================================
// PTO MEMORY — stateful suggestion store
// ============================================================

/**
 * Loads the PTO Memory tab into an array of objects.
 * Returns [] if the tab is missing or has no data rows.
 * Columns: Start Date | End Date | Workdays | GCal Event ID | Status | Suggested On
 */
function loadPTOMemory_(ss) {
  var sheet = ss.getSheetByName(TABS.PTO_MEMORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return rows
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      return {
        startDate:   String(r[0]).trim(),
        endDate:     String(r[1]).trim(),
        workdays:    Number(r[2]) || 0,
        eventId:     String(r[3]).trim(),
        status:      String(r[4]).trim(),   // 'suggested' | 'declined'
        suggestedOn: String(r[5]).trim(),
      };
    });
}

/**
 * Persists PTO Memory back to the sheet.
 * Only writes `declined` entries — `suggested` entries are regenerated each run
 * so there is no need to persist them across nights.
 */
function savePTOMemory_(ss, entries) {
  var sheet = ss.getSheetByName(TABS.PTO_MEMORY);
  if (!sheet) return; // tab not created yet — silent skip

  // Clear existing data rows
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  }

  var toSave = entries.filter(function(e) { return e.status === 'declined'; });
  if (toSave.length === 0) return;

  var rows = toSave.map(function(e) {
    return [e.startDate, e.endDate, e.workdays, e.eventId, e.status, e.suggestedOn];
  });
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

/**
 * Writes (or refreshes) 3 types of events in the "Vera" calendar:
 *   Type 1 — PTO Suggestions (clear windows mapped to 3-2-1 needs)
 *   Type 2 — Buffer Day Alert (tentative Friday when trigger condition met)
 *   Type 3 — Milestone Countdowns (from gap calendars, keyword-matched)
 *
 * Clears previous VERA-managed events before rewriting.
 * Accepts optional `ss` (Spreadsheet) and `memory` (loaded PTO Memory) for
 * stateful declined-window tracking.
 */
function writeVERARecommendations_(stats, cfg, ss, memory) {
  var vera = getCalendarByName_(cfg.veraCalendarName);
  if (!vera) {
    Logger.log('PTO: "' + cfg.veraCalendarName + '" calendar not found — skipping recommendations.');
    return;
  }

  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  // Scan slightly into the past to catch stale events
  var scanFrom = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
  var scanTo   = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);

  var existing = vera.getEvents(scanFrom, scanTo);

  // ---- Type 1: PTO Suggestions (stateful — respects declined windows) ------

  // a. Build set of GCal event IDs currently on the Vera calendar
  var currentEventIds = {};
  var todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  for (var ci = 0; ci < existing.length; ci++) {
    if (existing[ci].getTitle().indexOf('VERA Suggestion:') === 0) {
      currentEventIds[existing[ci].getId()] = true;
    }
  }

  // b. Reconcile memory: detect deletions (= user declined the suggestion)
  var workingMemory = memory ? memory.slice() : [];
  for (var mi = 0; mi < workingMemory.length; mi++) {
    var mem = workingMemory[mi];
    if (mem.status !== 'suggested') continue;          // already declined — skip
    if (mem.startDate < todayStr)   { workingMemory.splice(mi--, 1); continue; } // expired — drop
    if (!currentEventIds[mem.eventId]) {
      // Event is GONE — user deleted it → mark declined
      mem.status = 'declined';
      Logger.log('PTO Memory: window ' + mem.startDate + ' was declined (event deleted).');
    }
    // If still present → keep as 'suggested' (user has not acted on it yet)
  }

  // c. Build declined set from updated memory
  var declinedSet = {};
  for (var di = 0; di < workingMemory.length; di++) {
    if (workingMemory[di].status === 'declined') {
      declinedSet[workingMemory[di].startDate] = true;
    }
  }

  // d. Delete all existing suggestion events from calendar (clean slate for recreation)
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getTitle().indexOf('VERA Suggestion:') === 0) {
      try { existing[i].deleteEvent(); } catch(e) {}
    }
  }

  // e. Recreate suggestions — skip any window the user has declined
  var t31        = stats.threeToOneStatus;
  var longNeeded = Math.max(0, t31.longWeekends.target - t31.longWeekends.used - t31.longWeekends.planned);
  var midNeeded  = Math.max(0, t31.midSizeWeeks.target  - t31.midSizeWeeks.used  - t31.midSizeWeeks.planned);
  var bigNeeded  = Math.max(0, t31.bigPivot.target      - t31.bigPivot.used      - t31.bigPivot.planned);

  // Remove stale 'suggested' entries from previous run (they'll be re-added below with fresh IDs)
  workingMemory = workingMemory.filter(function(e) { return e.status === 'declined'; });

  var windows = stats.clearWindows || [];
  for (var w = 0; w < windows.length; w++) {
    var win    = windows[w];
    if (declinedSet[win.startDate]) {
      Logger.log('PTO Memory: skipping declined window ' + win.startDate);
      continue; // user said no — honour it
    }

    var days   = win.workdays;
    var type31 = days <= 3 ? 'Long Weekend' : days <= 7 ? 'Mid-Size Week' : 'Big Pivot';
    var needed = type31 === 'Long Weekend' ? longNeeded : type31 === 'Mid-Size Week' ? midNeeded : bigNeeded;
    var suffix = needed > 0 ? ' — ' + needed + ' remaining in plan' : ' — plan complete';
    var title  = 'VERA Suggestion: ' + type31 + suffix;

    var evStart = new Date(win.startDate + 'T00:00:00');
    var evEnd   = new Date(win.endDate   + 'T00:00:00');
    evEnd.setDate(evEnd.getDate() + 1); // exclusive end for createAllDayEvent

    try {
      var newEvent = vera.createAllDayEvent(title, evStart, evEnd);
      newEvent.setColor(CalendarApp.EventColor.SAGE);
      // f. Record new suggestion in memory
      workingMemory.push({
        startDate:   win.startDate,
        endDate:     win.endDate,
        workdays:    win.workdays,
        eventId:     newEvent.getId(),
        status:      'suggested',
        suggestedOn: todayStr,
      });
    } catch(e) {
      Logger.log('PTO: could not create suggestion event: ' + e.message);
    }
  }

  // g. Persist memory (only declined entries survive; suggested are ephemeral)
  if (ss) savePTOMemory_(ss, workingMemory);

  // ---- Type 2: Buffer Day Alert -------------------------------------------
  // Stateful: if user deletes the event, treat it as "declined for this week"
  // and don't re-suggest until the following week.
  var bProps         = PropertiesService.getScriptProperties();
  var bEventId       = bProps.getProperty('PTO_BUFFER_EVENT_ID')       || '';
  var bEventDate     = bProps.getProperty('PTO_BUFFER_EVENT_DATE')      || '';
  var bDeclinedUntil = bProps.getProperty('PTO_BUFFER_DECLINED_UNTIL')  || '';

  // Detect if the tracked event was deleted by the user (= declined)
  if (bEventId && bEventDate) {
    var bFound = false;
    for (var i2c = 0; i2c < existing.length; i2c++) {
      if (existing[i2c].getId() === bEventId) { bFound = true; break; }
    }
    if (!bFound) {
      // User deleted it — suppress until next Monday so it can re-appear the following week
      var bDecline = new Date(bEventDate + 'T00:00:00');
      bDecline.setDate(bDecline.getDate() + ((8 - bDecline.getDay()) % 7 || 7)); // next Monday after that Friday
      bDeclinedUntil = Utilities.formatDate(bDecline, tz, 'yyyy-MM-dd');
      bProps.setProperty('PTO_BUFFER_DECLINED_UNTIL', bDeclinedUntil);
      bProps.deleteProperty('PTO_BUFFER_EVENT_ID');
      bProps.deleteProperty('PTO_BUFFER_EVENT_DATE');
      bEventId   = '';
      bEventDate = '';
      Logger.log('PTO Buffer: event deleted by user — declined until ' + bDeclinedUntil);
    }
  }

  // Clear any stale VERA Buffer Day events that we no longer track (safety sweep)
  for (var i2 = 0; i2 < existing.length; i2++) {
    if (existing[i2].getTitle().indexOf('VERA Buffer Day') === 0 &&
        existing[i2].getId() !== bEventId) {
      try { existing[i2].deleteEvent(); } catch(e2) {}
    }
  }

  var buf = stats.bufferStatus;
  if (buf.remaining > 0) {
    // Check trigger: no upcoming PTO in 21 days OR last PTO > 30 days ago
    var daysSinceLast = 999;
    var daysToNext    = 999;

    for (var j = 0; j < stats.events.length; j++) {
      var evj = stats.events[j];
      if (evj.status === 'Used') {
        var diff1 = Math.round((today.getTime() - new Date(evj.endDate).getTime()) / (24*60*60*1000));
        if (diff1 >= 0 && diff1 < daysSinceLast) daysSinceLast = diff1;
      } else if (evj.status === 'Planned') {
        var diff2 = Math.round((new Date(evj.startDate).getTime() - today.getTime()) / (24*60*60*1000));
        if (diff2 >= 0 && diff2 < daysToNext) daysToNext = diff2;
      }
    }

    var shouldTrigger = (daysSinceLast > 30 || daysToNext > 21);

    // Find nearest upcoming Friday
    var friday = new Date(today.getTime());
    friday.setDate(friday.getDate() + 1); // start tomorrow
    var safetyBreak = 0;
    while (friday.getDay() !== 5 && safetyBreak < 14) {
      friday.setDate(friday.getDate() + 1);
      safetyBreak++;
    }
    var fridayStr = Utilities.formatDate(friday, tz, 'yyyy-MM-dd');

    // Skip if today is still within the declined window (i.e. before next Monday)
    var declinedThisWeek = bDeclinedUntil && todayStr < bDeclinedUntil;

    if (shouldTrigger && !declinedThisWeek && !bEventId) {
      // No existing tracked event for this Friday — create one
      var fridayEnd = new Date(friday.getTime());
      fridayEnd.setDate(fridayEnd.getDate() + 1);
      try {
        var bufEvent = vera.createAllDayEvent('VERA Buffer Day — consider taking this off', friday, fridayEnd);
        bufEvent.setColor(CalendarApp.EventColor.YELLOW);
        bProps.setProperty('PTO_BUFFER_EVENT_ID',   bufEvent.getId());
        bProps.setProperty('PTO_BUFFER_EVENT_DATE',  fridayStr);
        Logger.log('PTO Buffer: created for ' + fridayStr + ' (id: ' + bufEvent.getId() + ')');
      } catch(e3) {
        Logger.log('PTO: could not create buffer event: ' + e3.message);
      }
    } else if (!shouldTrigger || declinedThisWeek) {
      // Trigger cleared or week declined — remove any lingering tracked event
      if (bEventId) {
        for (var i2d = 0; i2d < existing.length; i2d++) {
          if (existing[i2d].getId() === bEventId) {
            try { existing[i2d].deleteEvent(); } catch(e2d) {}
            break;
          }
        }
        bProps.deleteProperty('PTO_BUFFER_EVENT_ID');
        bProps.deleteProperty('PTO_BUFFER_EVENT_DATE');
      }
      if (!shouldTrigger) {
        // Trigger gone — also clear any lingering declined window
        bProps.deleteProperty('PTO_BUFFER_DECLINED_UNTIL');
      }
    }
  } else {
    // No buffer remaining — clean up if anything was tracked
    if (bEventId) {
      for (var i2e = 0; i2e < existing.length; i2e++) {
        if (existing[i2e].getId() === bEventId) {
          try { existing[i2e].deleteEvent(); } catch(e2e) {}
          break;
        }
      }
      bProps.deleteProperty('PTO_BUFFER_EVENT_ID');
      bProps.deleteProperty('PTO_BUFFER_EVENT_DATE');
    }
    bProps.deleteProperty('PTO_BUFFER_DECLINED_UNTIL');
  }

  // ---- Type 3: Milestone Countdowns ---------------------------------------
  for (var i3 = 0; i3 < existing.length; i3++) {
    if (existing[i3].getTitle().indexOf('📍') === 0) {
      try { existing[i3].deleteEvent(); } catch(e4) {}
    }
  }

  var milestones = stats.milestones || [];
  for (var m = 0; m < milestones.length; m++) {
    var ms       = milestones[m];
    var msDate   = new Date(ms.date + 'T00:00:00');
    // Place on Monday of the milestone's week
    var dow      = msDate.getDay(); // 0=Sun
    var toMon    = dow === 0 ? -6 : 1 - dow; // days to go back to Monday
    var weekMon  = new Date(msDate.getTime());
    weekMon.setDate(weekMon.getDate() + toMon);
    weekMon.setHours(0, 0, 0, 0);

    // Don't create in the past
    if (weekMon < today) weekMon = new Date(today.getTime());

    var weekMonEnd = new Date(weekMon.getTime());
    weekMonEnd.setDate(weekMonEnd.getDate() + 1);

    var countdownTitle = '📍 ' + ms.label + ': ' + ms.daysUntil + ' days';
    try {
      var msEvent = vera.createAllDayEvent(countdownTitle, weekMon, weekMonEnd);
      msEvent.setColor(CalendarApp.EventColor.MAUVE);
    } catch(e5) {
      Logger.log('PTO: could not create milestone event: ' + e5.message);
    }
  }

  Logger.log('PTO: VERA calendar recommendations updated (' + windows.length + ' suggestions, ' + milestones.length + ' milestones).');
}

// ---- Snapshot (nightly) ------------------------------------------------------

/**
 * Main PTO nightly function — called from nightlyRun().
 * Reads all data, computes stats, writes PTO tab, updates Vera calendar.
 * @returns {Object} stats object for passing to Claude
 */
function writePTOSnapshot_() {
  var cfg   = readPTOConfig_();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var tz    = Session.getScriptTimeZone();
  var ss    = getSpreadsheet();

  // Load PTO Memory early — needed to filter declined windows from all outputs
  var memory      = loadPTOMemory_(ss);
  var declinedSet = {};
  for (var mi = 0; mi < memory.length; mi++) {
    if (memory[mi].status === 'declined') declinedSet[memory[mi].startDate] = true;
  }

  // Collect data
  var ptoResult  = getPTOEvents_(cfg);
  var travel     = getUpcomingTravel_(cfg);
  var gapCals    = getGapCalendars_(cfg);
  var allWindows = findClearWindows_(gapCals, today, 90, 3);
  var milestones = getMilestones_(gapCals, cfg, today);
  var stats      = computePTOStats_(ptoResult, cfg, today);

  // Filter out windows the user has declined — dashboard + Claude also see the filtered list
  var windows = allWindows.filter(function(w) { return !declinedSet[w.startDate]; });

  // Attach computed extras
  stats.clearWindows   = windows;
  stats.milestones     = milestones;
  stats.upcomingTravel = travel;

  // Write PTO sheet tab
  var sheet = ss.getSheetByName(TABS.PTO);
  if (!sheet) {
    sheet = ss.insertSheet(TABS.PTO);
  }

  // Header row
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, PTO_HEADERS.length).setValues([PTO_HEADERS]);
    sheet.getRange(1, 1, 1, PTO_HEADERS.length).setFontWeight('bold');
  }

  // Clear existing data rows
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, PTO_HEADERS.length).clearContent();
  }

  // Write PTO event rows
  var rows = ptoResult.events.map(function(ev) {
    return [
      ev.type,
      ev.label,
      ev.startDate,
      ev.endDate,
      ev.weekdays !== null ? ev.weekdays : '',
      ev.hours    !== null ? ev.hours    : '',
      ev.status,
    ];
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, PTO_HEADERS.length).setValues(rows);
  }

  // Update Vera calendar (pass ss + memory for stateful declined-window tracking)
  try {
    writeVERARecommendations_(stats, cfg, ss, memory);
  } catch(e) {
    Logger.log('PTO: writeVERARecommendations_ error: ' + e.message);
  }

  Logger.log('PTO snapshot done: ' + ptoResult.events.length + ' PTO events, ' +
             windows.length + ' windows (of ' + allWindows.length + ' found, ' +
             Object.keys(declinedSet).length + ' declined), ' + milestones.length + ' milestones.');
  return stats;
}

// ---- Claude summary ---------------------------------------------------------

/**
 * Formats a concise PTO status block for the Claude prompt.
 * @param {Object} stats - from computePTOStats_()
 * @returns {string}
 */
function ptoSummaryForClaude_(stats) {
  var b   = stats.burnDown;
  var t31 = stats.threeToOneStatus;
  var buf = stats.bufferStatus;

  var paceLabel =
    b.paceStatus === 'ahead'  ? 'AHEAD by ' + Math.abs(b.paceGap) + ' days' :
    b.paceStatus === 'behind' ? 'BEHIND by ' + Math.abs(b.paceGap) + ' days' :
                                 'on track';

  var nextLine = stats.nextPTO
    ? 'Next PTO: "' + stats.nextPTO.label + '" on ' + stats.nextPTO.startDate +
      ' (' + stats.nextPTO.daysUntil + ' days away).'
    : 'No upcoming PTO scheduled.';

  var travelLine = (stats.upcomingTravel && stats.upcomingTravel.length > 0)
    ? 'Shared family/travel (Shared Chaos): ' +
      stats.upcomingTravel.slice(0, 3).map(function(tr) {
        return '"' + tr.label + '" in ' + tr.daysAway + 'd';
      }).join(', ') + '.'
    : '';

  var windowLine = (stats.clearWindows && stats.clearWindows.length > 0)
    ? 'Clear PTO windows: ' +
      stats.clearWindows.map(function(w) {
        return w.startDate + ' to ' + w.endDate + ' (' + w.workdays + ' workdays)';
      }).join('; ') + '.'
    : 'No clear windows found in next 90 days.';

  var projLine = stats.burnDown.projectedUnused > 0
    ? ' (On current plan, ' + stats.burnDown.projectedUnused + ' vacation days may go unused.)'
    : '';

  return (
    'PTO STATUS (' + stats.year + '): ' +
    'Vacation: ' + stats.used.vacationDays + ' used / ' + stats.planned.vacationDays + ' planned / ' +
    stats.remaining.vacationDays + ' remaining of ' +
    (stats.config.vacationDays + stats.config.rolloverDays) + ' days' +
    (stats.config.rolloverDays > 0
      ? ' (' + stats.config.vacationDays + ' annual + ' + stats.config.rolloverDays + ' carried over from prior year)'
      : '') + '. ' +
    'Burn-down pace: ' + paceLabel + '.' + projLine + ' ' +
    'Personal time: ' + stats.used.personalHours + ' hrs used / ' +
    stats.remaining.personalHours + ' hrs remaining of ' + stats.config.personalHours + ' hrs. ' +
    '3-2-1 plan: ' +
    (t31.longWeekends.used + t31.longWeekends.planned) + '/' + t31.longWeekends.target + ' long weekends, ' +
    (t31.midSizeWeeks.used  + t31.midSizeWeeks.planned)  + '/' + t31.midSizeWeeks.target  + ' mid-size weeks, ' +
    (t31.bigPivot.used      + t31.bigPivot.planned)      + '/' + t31.bigPivot.target      + ' big pivot. ' +
    'Buffer: ' + buf.remaining + '/' + buf.total + ' days available. ' +
    nextLine +
    (travelLine ? ' ' + travelLine : '') + ' ' +
    windowLine
  );
}

// ---- Test -------------------------------------------------------------------

/**
 * Debug helper — run from Apps Script editor to verify PTO logic.
 * Logs full stats and Claude summary.
 */
function testPTO() {
  Logger.log('=== Running PTO test ===');
  var stats = writePTOSnapshot_();
  Logger.log('=== PTO STATS ===');
  Logger.log(JSON.stringify(stats, null, 2));
  Logger.log('=== CLAUDE SUMMARY ===');
  Logger.log(ptoSummaryForClaude_(stats));
  Logger.log('=== PTO test complete ===');
}
