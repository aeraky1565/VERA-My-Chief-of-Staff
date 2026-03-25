// ============================================================
// VERA — Important Dates Engine (Issue #80)
// ImportantDates.js — Nightly auto-sync + future flagging
// ============================================================
//
// Current scope:
//   syncCalendarBirthdaysToImportantDates_() — called from nightlyRun()
//   Scans "Joint Chaos" calendar for birthday events arriving in the
//   next 30 days. If no matching entry exists in the Important Dates
//   sheet, silently adds it. If a match is found, skips it.
//
// Future scope (Issue #80 full engine):
//   - 30/7/1 day lead-time flags per entry
//   - Interest cross-reference + Claude gift suggestions (Issue #83)
// ============================================================

/**
 * Scans the "Joint Chaos" shared calendar for birthday events
 * arriving within the next 30 days. Auto-adds any that don't
 * already have a matching entry in the Important Dates sheet.
 * Called from nightlyRun() in Code.js.
 */
function syncCalendarBirthdaysToImportantDates_() {
  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.IMPORTANT_DATES);
  if (!sheet) {
    Logger.log('ImportantDates: Important Dates sheet not found — skipping sync.');
    return;
  }

  // Load existing entries for duplicate-checking
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

  // Find the "Joint Chaos" calendar (case-insensitive name match)
  var targetCal = null;
  CalendarApp.getAllCalendars().forEach(function(c) {
    if (c.getName().toLowerCase().indexOf('joint chaos') !== -1) targetCal = c;
  });
  if (!targetCal) {
    Logger.log('ImportantDates: "Joint Chaos" calendar not found — skipping sync.');
    return;
  }

  // Scan events in the next 30 days
  var now     = new Date();
  var horizon = new Date(now.getTime() + 30 * 86400000);
  var events  = targetCal.getEvents(now, horizon);
  var added   = 0;

  events.forEach(function(ev) {
    var title = ev.getTitle();
    if (title.toLowerCase().indexOf('birthday') === -1) return; // birthday events only

    // Strip "'s birthday" / " birthday" suffix to extract person name
    var person  = title.replace(/'?s?\s*birthday\s*$/i, '').trim();
    if (!person) return;

    var start   = ev.getStartTime();
    var dateKey = String(start.getMonth() + 1).padStart(2, '0') + '-' +
                  String(start.getDate()).padStart(2, '0');

    // Match: same MM-DD AND person name appears in either Person or Label (case-insensitive)
    var alreadyExists = existing.some(function(e) {
      var sameDateish   = String(e['Date'] || '').indexOf(dateKey) !== -1;
      var samePersonish = String(e['Person'] || '').toLowerCase().indexOf(person.toLowerCase()) !== -1 ||
                          String(e['Label']  || '').toLowerCase().indexOf(person.toLowerCase()) !== -1;
      return sameDateish && samePersonish;
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

/**
 * DEBUG — Run this directly from the Apps Script editor to see exactly
 * which calendars VERA can see and which birthday events it finds.
 * Results appear in View → Logs (or Executions).
 */
function debugBirthdayCalendars() {
  var now       = new Date();
  var lookAhead = new Date(now.getFullYear(), now.getMonth() + 13, now.getDate());
  var cals      = CalendarApp.getAllCalendars();
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
