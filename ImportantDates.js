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
      var targetDate = null;
      var isOneTime  = false;

      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        // Explicit year — treat as one-time unless Recurring=Yes
        targetDate = new Date(dateRaw + 'T00:00:00');
        isOneTime  = !recurring;
      } else if (/^\d{2}-\d{2}$/.test(dateRaw)) {
        // MM-DD — recurring year-agnostic
        var mm = parseInt(dateRaw.split('-')[0], 10);
        var dd = parseInt(dateRaw.split('-')[1], 10);
        targetDate = new Date(thisYear, mm - 1, dd, 0, 0, 0);
        if (targetDate < now) {
          // Already passed this year — roll to next year
          targetDate = new Date(thisYear + 1, mm - 1, dd, 0, 0, 0);
        }
      } else {
        Logger.log('ImportantDates: unrecognised date "' + dateRaw + '" for ' + id + ' — skipping');
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

          if (interests.length) {
            var interestText = interests.map(function(i) {
              return '- ' + i.interest +
                     (i.category ? ' [' + i.category + ']' : '') +
                     (i.notes    ? ': ' + i.notes : '');
            }).join('\n');

            var claudePrompt =
              'Occasion: ' + label + ' for ' + person + ' (' + daysUntil + ' days away).\n' +
              'Their logged interests:\n' + interestText + '\n\n' +
              'Suggest 3 specific, personalised gift or activity ideas. Be concrete — not ' +
              'categories, but actual suggestions. Return a JSON array of objects: ' +
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
