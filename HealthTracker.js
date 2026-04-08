// ============================================================
// HealthTracker.js — Health Appointment Tracker (Issue #85)
//
// Reads Google Calendar events tagged with the DR: prefix:
//   DR: Ahmed - Annual Physical
//   DR: Victoria - Dentist Cleaning
//   DR: Ahmed - Eye Exam - Dr. Patel
//
// VERA scans past + future events to derive last-visit dates,
// computes next-due dates using default intervals per type,
// and generates flags when appointments are approaching or overdue.
//
// Optional: add "interval:N" on any line in the event description
// to override the default interval for that appointment type.
// ============================================================

var HEALTH_APPT_INTERVAL_DEFAULTS_ = {
  'physical':          12,  'annual physical':  12,
  'dental':             6,  'dentist':           6,  'dental cleaning':  6,  'teeth cleaning': 6,
  'eye exam':          12,  'optometrist':      12,  'ophthalmologist': 12,
  'dermatology':       12,  'dermatologist':    12,
  'gynecology':        12,  'obgyn':            12,  'gynaecology':     12,
  'therapy':            1,  'therapist':         1,
  'cardiology':        12,  'cardiologist':     12,
  'endocrinology':     12,  'endocrinologist':  12,
  'allergist':         12,  'allergy':          12,
  'chiropractor':       1,  'chiropractic':      1,
  'urgent care':        0,                               // never flag — episodic
};

var HEALTH_APPT_DEFAULT_INTERVAL_  = 12;  // fallback months if type not in table
var HEALTH_APPT_LOOKBACK_MONTHS_   = 30;  // scan this many months into the past
var HEALTH_APPT_LOOKAHEAD_MONTHS_  = 24;  // scan this many months into the future
var HEALTH_APPT_DEFAULT_LEAD_DAYS_ = 30;  // default alert window

/**
 * Returns the default interval (months) for a given appointment type string.
 * Tries exact match first, then substring match.
 */
function healthApptInterval_(type) {
  var norm = type.toLowerCase().trim();
  if (HEALTH_APPT_INTERVAL_DEFAULTS_[norm] !== undefined) {
    return HEALTH_APPT_INTERVAL_DEFAULTS_[norm];
  }
  var keys = Object.keys(HEALTH_APPT_INTERVAL_DEFAULTS_);
  for (var i = 0; i < keys.length; i++) {
    if (norm.indexOf(keys[i]) >= 0 || keys[i].indexOf(norm) >= 0) {
      return HEALTH_APPT_INTERVAL_DEFAULTS_[keys[i]];
    }
  }
  return HEALTH_APPT_DEFAULT_INTERVAL_;
}

// ============================================================
// Core data reader
// ============================================================

/**
 * Scans all Google Calendars for DR: tagged events, groups by person+type,
 * and returns an array of appointment objects with computed nextDue + daysUntil.
 *
 * Title format:
 *   DR: Ahmed - Annual Physical
 *   DR: Victoria - Dentist Cleaning
 *   DR: Ahmed - Eye Exam - Dr. Patel      ← third segment becomes provider
 *
 * If no " - " separator: person defaults to "Ahmed", entire remainder = type.
 *
 * Description override:
 *   interval:6   (number of months between appointments)
 *
 * Used by checkHealthAppointments_() (nightly), WebApp handlers, and Chat actions.
 *
 * @returns {Array<Object>} sorted array of { person, type, provider, intervalMonths,
 *                          lastVisit, nextDue, daysUntil, scheduledNext }
 */
function getHealthAppointments_() {
  var today     = new Date(); today.setHours(0, 0, 0, 0);
  var tz        = Session.getScriptTimeZone();
  var lookback  = new Date(today); lookback.setMonth(lookback.getMonth()  - HEALTH_APPT_LOOKBACK_MONTHS_);
  var lookahead = new Date(today); lookahead.setMonth(lookahead.getMonth() + HEALTH_APPT_LOOKAHEAD_MONTHS_);

  var cfg      = getConfigValues();
  var skipList = (cfg['skip_calendars'] || '')
    .split(',')
    .map(function(s) { return s.trim().toLowerCase(); })
    .filter(function(s) { return s !== ''; });

  // key = "person_lower|type_lower"  →  aggregated appointment data
  var apptMap = {};

  CalendarApp.getAllCalendars().forEach(function(calendar) {
    if (skipList.indexOf(calendar.getName().toLowerCase()) !== -1) return;

    var events;
    try {
      events = calendar.getEvents(lookback, lookahead);
    } catch (e) {
      Logger.log('getHealthAppointments_: skip "' + calendar.getName() + '" — ' + e.message);
      return;
    }

    events.forEach(function(event) {
      var title = event.getTitle() || '';
      if (title.substring(0, 3).toUpperCase() !== 'DR:') return;

      var rest    = title.substring(3).trim();
      var dashIdx = rest.indexOf(' - ');

      var person, typeAndProvider;
      if (dashIdx >= 0) {
        person          = rest.substring(0, dashIdx).trim();
        typeAndProvider = rest.substring(dashIdx + 3).trim();
      } else {
        person          = 'Ahmed';  // default when no separator
        typeAndProvider = rest;
      }

      if (!person) person = 'Ahmed';

      // Optional second separator marks provider name
      var dash2    = typeAndProvider.indexOf(' - ');
      var apptType = dash2 >= 0 ? typeAndProvider.substring(0, dash2).trim() : typeAndProvider.trim();
      var provider = dash2 >= 0 ? typeAndProvider.substring(dash2 + 3).trim() : '';

      if (!apptType) return;

      // Parse interval override from description
      var desc     = event.getDescription() || '';
      var intMatch = desc.match(/interval\s*:\s*(\d+)/i);
      var interval = intMatch ? parseInt(intMatch[1], 10) : null;

      var eventStart = new Date(event.getStartTime()); eventStart.setHours(0, 0, 0, 0);
      var isPast     = eventStart <= today;
      var isFuture   = eventStart > today;

      var key = person.toLowerCase() + '|' + apptType.toLowerCase();

      if (!apptMap[key]) {
        apptMap[key] = {
          person:            person,
          type:              apptType,
          provider:          provider,
          interval:          interval !== null ? interval : healthApptInterval_(apptType),
          lastVisitDate:     null,
          scheduledNextDate: null,
        };
      } else {
        if (!apptMap[key].provider && provider)  apptMap[key].provider  = provider;
        if (interval !== null)                    apptMap[key].interval  = interval;
      }

      if (isPast) {
        if (!apptMap[key].lastVisitDate || eventStart > apptMap[key].lastVisitDate) {
          apptMap[key].lastVisitDate = eventStart;
        }
      } else if (isFuture) {
        if (!apptMap[key].scheduledNextDate || eventStart < apptMap[key].scheduledNextDate) {
          apptMap[key].scheduledNextDate = eventStart;
        }
      }
    });
  });

  // Build result array with computed nextDue + daysUntil
  var results = Object.keys(apptMap).map(function(key) {
    var a = apptMap[key];
    var nextDue   = null;
    var daysUntil = null;

    if (a.lastVisitDate) {
      var nd = new Date(a.lastVisitDate);
      nd.setMonth(nd.getMonth() + a.interval);
      nd.setHours(0, 0, 0, 0);
      nextDue   = Utilities.formatDate(nd, tz, 'yyyy-MM-dd');
      daysUntil = Math.round((nd - today) / 86400000);
    }

    return {
      person:         a.person,
      type:           a.type,
      provider:       a.provider,
      intervalMonths: a.interval,
      lastVisit:      a.lastVisitDate
        ? Utilities.formatDate(a.lastVisitDate, tz, 'yyyy-MM-dd') : null,
      nextDue:        nextDue,
      daysUntil:      daysUntil,
      scheduledNext:  a.scheduledNextDate
        ? Utilities.formatDate(a.scheduledNextDate, tz, 'yyyy-MM-dd') : null,
    };
  });

  // Sort ascending by daysUntil (most overdue first), nulls last, then person, then type
  results.sort(function(a, b) {
    var da = a.daysUntil != null ? a.daysUntil : 99999;
    var db = b.daysUntil != null ? b.daysUntil : 99999;
    if (da !== db) return da - db;
    var p = a.person.localeCompare(b.person);
    return p !== 0 ? p : a.type.localeCompare(b.type);
  });

  return results;
}

// ============================================================
// Nightly flag generator
// ============================================================

/**
 * Nightly checker — called from nightlyRun() in Code.js.
 * Generates flags for upcoming or overdue health appointments.
 */
function checkHealthAppointments_() {
  var today        = new Date(); today.setHours(0, 0, 0, 0);
  var tz           = Session.getScriptTimeZone();
  var appointments = getHealthAppointments_();
  var leadDays     = HEALTH_APPT_DEFAULT_LEAD_DAYS_;

  // Try to surface clear calendar windows in flag text (non-fatal)
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
  var ss             = getSpreadsheet();

  appointments.forEach(function(a) {
    if (!a.lastVisit)           return;  // never visited — can't compute due date
    if (a.daysUntil > leadDays) return;  // outside alerting window
    if (a.intervalMonths === 0) return;  // interval=0 means episodic (never flag)

    var daysUntil = a.daysUntil;
    var lastStr   = a.lastVisit;
    var dueStr    = a.nextDue;
    var provStr   = a.provider  ? ' · ' + a.provider  : '';
    var whoStr    = a.person    ? ' (' + a.person + ')' : '';

    var urgency, flagText, reason;
    if (daysUntil >= 8) {
      urgency  = 'Low';
      flagText = a.type + whoStr + ' due in ' + daysUntil + ' days';
      reason   = 'Last visit: ' + lastStr + '. Due: ' + dueStr + provStr + '.' + clearWindowText;
    } else if (daysUntil >= 0) {
      urgency  = 'Medium';
      flagText = a.type + whoStr + ' due in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's');
      reason   = 'Last visit: ' + lastStr + '. Due: ' + dueStr + provStr + '.' + clearWindowText;
    } else if (daysUntil >= -30) {
      urgency  = 'Medium';
      flagText = a.type + whoStr + ' is overdue by ' + (-daysUntil) + ' day' + (daysUntil === -1 ? '' : 's');
      reason   = 'Due date was ' + dueStr + '. Last visit: ' + lastStr + provStr + '.' + clearWindowText;
    } else {
      urgency  = 'High';
      flagText = a.type + whoStr + ' is overdue by ' + (-daysUntil) + ' days';
      reason   = 'Due date was ' + dueStr + '. Last visit: ' + lastStr + provStr + '.' + clearWindowText;
    }

    var flagKey = 'health_appt_' +
      a.person.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' +
      a.type.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Dedup: skip if an unresolved flag with this key already exists
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() > 1) {
      var existing    = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
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
  // Issue #158: Log to #vera-logs when appointments are flagged
  if (flagsGenerated > 0) {
    try { sendSlackLog_('\ud83c\udfe5 Health \u2014 ' + flagsGenerated + ' appointment' + (flagsGenerated > 1 ? 's' : '') + ' flagged (overdue or upcoming)'); } catch (e) {}
  }
}
