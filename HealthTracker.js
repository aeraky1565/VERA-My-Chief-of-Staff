// ============================================================
// HealthTracker.js — Recurring Health Appointment Tracker (Issue #85)
//
// Nightly checker: reads Health Appointments sheet, computes days
// until/since each appointment's next due date, and generates flags
// at the correct urgency level. Reuses the same pattern as checkContracts_().
// ============================================================

/**
 * Nightly checker — called from nightlyRun() in Code.js.
 * Generates flags for upcoming or overdue health appointments.
 */
function checkHealthAppointments_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HEALTH_APPOINTMENTS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var tz    = Session.getScriptTimeZone();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEALTH_APPOINTMENT_HEADERS.length).getValues();

  // Try to get clear calendar windows to surface in flag text (non-fatal)
  var clearWindowText = '';
  try {
    var cfg  = readPTOConfig_();
    var gaps = getGapCalendars_(cfg);
    var wins = findClearWindows_(gaps, today, 90, 2);
    if (wins.length > 0) {
      clearWindowText = ' Clear windows: ' +
        wins.slice(0, 2).map(function(w) { return w.startDate + '–' + w.endDate; }).join(', ') + '.';
    }
  } catch (e) { /* PTO not configured — skip */ }

  var flagsGenerated = 0;

  data.forEach(function(row) {
    var id       = String(row[0]).trim();
    var apptType = String(row[1]).trim();
    var provider = String(row[2]).trim();
    var interval = parseInt(row[3], 10) || 12;
    var lastRaw  = row[4];
    var leadDays = parseInt(row[7], 10) || 30;

    if (!id || !apptType || !lastRaw) return;

    var lastDate = new Date(lastRaw); lastDate.setHours(0, 0, 0, 0);
    var nextDue  = new Date(lastDate);
    nextDue.setMonth(nextDue.getMonth() + interval);

    var daysUntil = Math.round((nextDue - today) / 86400000); // negative = overdue

    if (daysUntil > leadDays) return; // not in alerting window yet

    var urgency, flagText, reason;
    var lastStr = Utilities.formatDate(lastDate, tz, 'MMM d, yyyy');
    var dueStr  = Utilities.formatDate(nextDue,  tz, 'MMM d, yyyy');
    var provStr = provider ? ' · ' + provider : '';

    if (daysUntil >= 8) {
      urgency  = 'Low';
      flagText = apptType + ' due in ' + daysUntil + ' days';
      reason   = 'Last visit: ' + lastStr + '. Due: ' + dueStr + provStr + '.' + clearWindowText;
    } else if (daysUntil >= 0) {
      urgency  = 'Medium';
      flagText = apptType + ' due in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's');
      reason   = 'Last visit: ' + lastStr + '. Due: ' + dueStr + provStr + '.' + clearWindowText;
    } else if (daysUntil >= -30) {
      urgency  = 'Medium';
      flagText = apptType + ' is overdue by ' + (-daysUntil) + ' day' + (daysUntil === -1 ? '' : 's');
      reason   = 'Due date was ' + dueStr + '. Last visit: ' + lastStr + provStr + '.' + clearWindowText;
    } else {
      urgency  = 'High';
      flagText = apptType + ' is overdue by ' + (-daysUntil) + ' days';
      reason   = 'Due date was ' + dueStr + '. Last visit: ' + lastStr + provStr + '.' + clearWindowText;
    }

    var flagKey = 'health_appt_' + id.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Dedup: skip if an unresolved flag with this key already exists
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() > 1) {
      var existing   = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
      var alreadyOpen = existing.some(function(r) {
        return String(r[9]).trim() === flagKey &&
               String(r[6]).toLowerCase() !== 'yes' &&
               String(r[8]).toLowerCase() !== 'yes';
      });
      if (alreadyOpen) return;
    }

    writeFlags([{ source: 'Health Tracker', flag: flagText, reason: reason, urgency: urgency, key: flagKey }]);
    flagsGenerated++;
  });

  Logger.log('checkHealthAppointments_: ' + flagsGenerated + ' flag(s) generated.');
}

/**
 * Returns all health appointments as objects with computed nextDue + daysUntil.
 * Used by WebApp.js handlers and Chat.js actions.
 */
function getHealthAppointments_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HEALTH_APPOINTMENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var tz    = Session.getScriptTimeZone();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEALTH_APPOINTMENT_HEADERS.length).getValues();

  return data.map(function(row, idx) {
    var lastRaw  = row[4];
    var interval = parseInt(row[3], 10) || 12;
    var nextDue  = '';
    var daysUntil = null;

    if (lastRaw) {
      var d = new Date(lastRaw); d.setHours(0, 0, 0, 0);
      d.setMonth(d.getMonth() + interval);
      nextDue   = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      daysUntil = Math.round((d - today) / 86400000);
    }

    return {
      row:              idx + 2,
      id:               String(row[0]).trim(),
      type:             String(row[1]).trim(),
      provider:         String(row[2]).trim(),
      intervalMonths:   interval,
      lastAppointment:  formatDateVal_(row[4]),
      nextDue:          nextDue,
      daysUntil:        daysUntil,
      notes:            String(row[6]).trim(),
      reminderLeadDays: parseInt(row[7], 10) || 30,
    };
  }).filter(function(a) { return a.id; });
}
