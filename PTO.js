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

  var data = sheet.getDataRange().getValues();
  var raw  = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
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
    // Events in the work calendar whose titles contain any of these strings are
    // completely skipped — not counted as PTO or company holidays.
    ignoreKeywords:    (raw['ignore_keywords'] || 'Pay Day')
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

  var ignoreKws = cfg.ignoreKeywords || [];

  /** Returns true if the event title should be completely skipped. */
  function isIgnored_(titleLower) {
    for (var k = 0; k < ignoreKws.length; k++) {
      if (ignoreKws[k] && titleLower.indexOf(ignoreKws[k]) !== -1) return true;
    }
    return false;
  }

  // ---- Pass 1: collect company holidays -----------------------------------
  for (var i = 0; i < allEvents.length; i++) {
    var ev     = allEvents[i];
    var title  = ev.getTitle().trim();
    var tLower = title.toLowerCase();
    if (!ev.isAllDayEvent()) continue;
    if (isIgnored_(tLower)) continue;                     // e.g. "Pay Day(V)" — skip entirely
    if (tLower.indexOf('vacation') === -1 && tLower.indexOf('pto') === -1) {
      // No PTO keyword → company holiday
      var hDate    = ev.getAllDayStartDate();
      var hDateStr = Utilities.formatDate(hDate, tz, 'yyyy-MM-dd');
      if (!holidaySet.has(hDateStr)) {
        holidaySet.add(hDateStr);
        holidays.push({ label: title, date: hDateStr });
      }
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
        var vDays    = countWeekdays_(vStart, vEndIncl, holidaySet);
        var vStatus  = vEndIncl < today ? 'Used' : 'Planned';
        ptoEvents.push({
          type:      'Vacation',
          label:     title2,
          startDate: Utilities.formatDate(vStart,   tz, 'yyyy-MM-dd'),
          endDate:   Utilities.formatDate(vEndIncl, tz, 'yyyy-MM-dd'),
          isAllDay:  true,
          weekdays:  vDays,
          hours:     null,
          status:    vStatus,
        });

      } else if (tLow2.indexOf('pto') !== -1) {
        // All-day PTO = 8 hrs per calendar day
        var pStart   = ev2.getAllDayStartDate();
        var pEndExcl = ev2.getAllDayEndDate();
        var pEndIncl = new Date(pEndExcl.getTime() - 24 * 60 * 60 * 1000);
        var pStatus  = pEndIncl < today ? 'Used' : 'Planned';

        // Count calendar days (each = 8 hrs, regardless of weekday)
        var pDayCount = 0;
        var pd = new Date(pStart.getTime());
        pd.setHours(0, 0, 0, 0);
        var pdEnd = new Date(pEndIncl.getTime());
        pdEnd.setHours(0, 0, 0, 0);
        while (pd <= pdEnd) { pDayCount++; pd.setDate(pd.getDate() + 1); }
        var pHours = pDayCount * 8;

        ptoEvents.push({
          type:      'PTO-Personal',
          label:     title2,
          startDate: Utilities.formatDate(pStart,   tz, 'yyyy-MM-dd'),
          endDate:   Utilities.formatDate(pEndIncl, tz, 'yyyy-MM-dd'),
          isAllDay:  true,
          weekdays:  pDayCount,
          hours:     pHours,
          status:    pStatus,
        });
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

/**
 * Reads multi-day all-day events from all gap calendars (excluding the work
 * PTO calendar itself) for the next 180 days.
 * Gap calendars are config-driven via pto_gap_calendars (e.g. "AE&VV - Our Joint Chaos").
 * @returns {Array} [{ label, startDate, endDate, daysAway, calendarName }]
 */
function getUpcomingTravel_(cfg) {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var end = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000);

  // Use gap calendars from config, but skip the work/PTO calendar — travel
  // entries should only come from shared/family calendars.
  var gapCalNames = (cfg.gapCalendarsRaw || '').split(',')
    .map(function(n) { return n.trim(); })
    .filter(function(n) { return n && n !== cfg.calendarName; });

  var seen   = {};  // deduplicate by label+date in case event appears on multiple calendars
  var travel = [];

  for (var c = 0; c < gapCalNames.length; c++) {
    var cal = getCalendarByName_(gapCalNames[c]);
    if (!cal) {
      Logger.log('getUpcomingTravel_: calendar not found — "' + gapCalNames[c] + '"');
      continue;
    }

    var events = cal.getEvents(today, end);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev.isAllDayEvent()) continue;

      var evStart   = ev.getAllDayStartDate();
      var evEndExcl = ev.getAllDayEndDate();
      var durationDays = (evEndExcl.getTime() - evStart.getTime()) / (24 * 60 * 60 * 1000);
      if (durationDays < 2) continue; // skip single-day events

      var evEndIncl = new Date(evEndExcl.getTime() - 24 * 60 * 60 * 1000);
      var daysAway  = Math.round((evStart.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      var label     = ev.getTitle().trim();
      var startStr  = Utilities.formatDate(evStart,   tz, 'yyyy-MM-dd');
      var key       = label + '|' + startStr;

      if (!seen[key]) {
        seen[key] = true;
        travel.push({
          label:        label,
          startDate:    startStr,
          endDate:      Utilities.formatDate(evEndIncl, tz, 'yyyy-MM-dd'),
          daysAway:     daysAway,
          calendarName: gapCalNames[c],
        });
      }
    }
  }

  // Sort by start date
  travel.sort(function(a, b) { return a.startDate < b.startDate ? -1 : 1; });
  return travel;
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
  var yearStart  = new Date(cfg.year, 0, 1);
  var dayOfYear  = Math.max(1, Math.round((today.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000)));
  var totalDays  = 365;
  var idealUsed  = Math.round((dayOfYear / totalDays) * totalVacDays * 10) / 10;
  var paceGap    = Math.round((usedVacDays - idealUsed) * 10) / 10;
  var paceStatus = paceGap >= 1 ? 'ahead' : paceGap <= -2 ? 'behind' : 'on-track';
  var projYearEnd = usedVacDays + plannedVacDays;
  var projUnused  = totalVacDays - projYearEnd;

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
      actualUsedToDate: usedVacDays,
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

/**
 * Writes (or refreshes) 3 types of events in the "Vera" calendar:
 *   Type 1 — PTO Suggestions (clear windows mapped to 3-2-1 needs)
 *   Type 2 — Buffer Day Alert (tentative Friday when trigger condition met)
 *   Type 3 — Milestone Countdowns (from gap calendars, keyword-matched)
 *
 * Clears previous VERA-managed events before rewriting.
 */
function writeVERARecommendations_(stats, cfg) {
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

  // ---- Type 1: PTO Suggestions --------------------------------------------
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getTitle().indexOf('VERA Suggestion:') === 0) {
      try { existing[i].deleteEvent(); } catch(e) {}
    }
  }

  var t31       = stats.threeToOneStatus;
  var longNeeded = Math.max(0, t31.longWeekends.target - t31.longWeekends.used - t31.longWeekends.planned);
  var midNeeded  = Math.max(0, t31.midSizeWeeks.target  - t31.midSizeWeeks.used  - t31.midSizeWeeks.planned);
  var bigNeeded  = Math.max(0, t31.bigPivot.target      - t31.bigPivot.used      - t31.bigPivot.planned);

  var windows = stats.clearWindows || [];
  for (var w = 0; w < windows.length; w++) {
    var win    = windows[w];
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
    } catch(e) {
      Logger.log('PTO: could not create suggestion event: ' + e.message);
    }
  }

  // ---- Type 2: Buffer Day Alert -------------------------------------------
  for (var i2 = 0; i2 < existing.length; i2++) {
    if (existing[i2].getTitle().indexOf('VERA Buffer Day') === 0) {
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
    if (shouldTrigger) {
      // Find nearest upcoming Friday
      var friday = new Date(today.getTime());
      friday.setDate(friday.getDate() + 1); // start tomorrow
      var safetyBreak = 0;
      while (friday.getDay() !== 5 && safetyBreak < 14) {
        friday.setDate(friday.getDate() + 1);
        safetyBreak++;
      }
      var fridayEnd = new Date(friday.getTime());
      fridayEnd.setDate(fridayEnd.getDate() + 1);
      try {
        var bufEvent = vera.createAllDayEvent('VERA Buffer Day — consider taking this off', friday, fridayEnd);
        bufEvent.setColor(CalendarApp.EventColor.YELLOW);
      } catch(e3) {
        Logger.log('PTO: could not create buffer event: ' + e3.message);
      }
    }
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

  // Collect data
  var ptoResult  = getPTOEvents_(cfg);
  var travel     = getUpcomingTravel_(cfg);
  var gapCals    = getGapCalendars_(cfg);
  var windows    = findClearWindows_(gapCals, today, 90, 3);
  var milestones = getMilestones_(gapCals, cfg, today);
  var stats      = computePTOStats_(ptoResult, cfg, today);

  // Attach computed extras
  stats.clearWindows   = windows;
  stats.milestones     = milestones;
  stats.upcomingTravel = travel;

  // Write PTO sheet tab
  var ss    = getSpreadsheet();
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

  // Update Vera calendar
  try {
    writeVERARecommendations_(stats, cfg);
  } catch(e) {
    Logger.log('PTO: writeVERARecommendations_ error: ' + e.message);
  }

  Logger.log('PTO snapshot done: ' + ptoResult.events.length + ' PTO events, ' +
             windows.length + ' windows, ' + milestones.length + ' milestones.');
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
    stats.remaining.vacationDays + ' remaining of ' + stats.config.vacationDays + ' days. ' +
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
