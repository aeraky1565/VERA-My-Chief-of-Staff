// ============================================================
// VERA — Memory.js
// Longitudinal event log + weekly metric snapshots (Issue #9)
//
// appendMemoryEvent_(type, who, title, detail, context)
//   — append-only writer called from WebApp, Chat, Pacing,
//     GymTracker, and PostTripCapture
//
// writeWeeklySnapshot_()
//   — called from nightlyRun() on the configured snapshot day
//     (default Sunday); appends one row per metric to MEMORY_SNAPSHOT
//
// pruneMemoryLog_()
//   — called from nightlyRun() nightly; deletes rows older than
//     memory_log_retention_months (default 12)
//
// getMemoryContext_(days)
//   — returns a plain-text block for injection into chat prompts;
//     reads the last `days` days of events + last 8 weekly snapshots
// ============================================================

// ── Event types (kept as constants for consistency across callers) ────────────
var MEMORY_TYPE = {
  FLAG_ACKNOWLEDGED: 'flag_acknowledged',
  FLAG_SNOOZED:      'flag_snoozed',
  FLAG_RESOLVED:     'flag_resolved',
  TASK_COMPLETED:    'task_completed',
  GOAL_UPDATED:      'goal_updated',
  GYM_SESSION:       'gym_session',
  CAREER_WIN:        'career_win',
  PACING_ACTIVATED:  'pacing_activated',
  VACATION_STARTED:  'vacation_started',
  VACATION_ENDED:    'vacation_ended',
  TRIP_COMPLETED:    'trip_completed',
};

// ── Append a single event row ─────────────────────────────────────────────────

/**
 * Appends one row to the Memory Log tab.
 * Silent no-op if memory_log_enabled = false.
 *
 * @param {string} type    - One of MEMORY_TYPE values
 * @param {string} who     - 'Ahmed' | 'Victoria' | 'Both' | 'System'
 * @param {string} title   - Short summary line (≤ 80 chars recommended)
 * @param {string} detail  - Optional longer context
 * @param {string} context - Optional free-form tag or source label
 */
function appendMemoryEvent_(type, who, title, detail, context) {
  try {
    var cfg = getConfigValues();
    if ((cfg['memory_log_enabled'] || 'true') === 'false') return;

    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.MEMORY_LOG);
    if (!sheet) {
      sheet = ss.insertSheet(TABS.MEMORY_LOG);
      sheet.getRange(1, 1, 1, MEMORY_LOG_HEADERS.length).setValues([MEMORY_LOG_HEADERS]);
      sheet.setColumnWidth(1, 120);
      sheet.setColumnWidth(3, 120);
      sheet.setColumnWidth(4, 90);
      sheet.setColumnWidth(5, 200);
      sheet.setColumnWidth(6, 250);
      sheet.setColumnWidth(7, 140);
      sheet.hideSheet();
    }

    var tz        = Session.getScriptTimeZone();
    var now       = new Date();
    var ts        = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm');
    var dateKey   = Utilities.formatDate(now, tz, 'yyyyMMdd');
    var lastRow   = sheet.getLastRow();

    // Generate a lightweight sequential ID
    var seq = 1;
    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      ids.forEach(function(r) {
        if (String(r[0] || '').indexOf('MEM-' + dateKey) === 0) seq++;
      });
    }
    var id = 'MEM-' + dateKey + '-' + String(seq).padStart(3, '0');

    sheet.appendRow([
      id,
      ts,
      type   || '',
      who    || 'System',
      title  || '',
      detail || '',
      context || '',
    ]);
  } catch (e) {
    Logger.log('appendMemoryEvent_ error (non-fatal): ' + e.message);
  }
}

// ── Weekly metric snapshot ────────────────────────────────────────────────────

/**
 * Appends one row per metric to MEMORY_SNAPSHOT.
 * Called from nightlyRun() only on the configured snapshot day.
 * Skips if already ran this week (dedup by Week key).
 */
function writeWeeklySnapshot_() {
  try {
    var cfg = getConfigValues();
    if ((cfg['memory_log_enabled'] || 'true') === 'false') {
      Logger.log('writeWeeklySnapshot_: disabled'); return;
    }
    var snapshotDay = parseInt(cfg['memory_snapshot_day'] || '0', 10); // 0=Sun
    var today       = new Date();
    if (today.getDay() !== snapshotDay) {
      Logger.log('writeWeeklySnapshot_: not snapshot day (today=' + today.getDay() + ' configured=' + snapshotDay + ')');
      return;
    }

    var tz      = Session.getScriptTimeZone();
    var weekKey = getWeekKey_(today); // e.g. "2026-W14" — reuses Fitness.js helper
    var dateStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
    var ss      = getSpreadsheet();

    // ── Ensure snapshot sheet exists ──────────────────────────────────────────
    var snapSheet = ss.getSheetByName(TABS.MEMORY_SNAPSHOT);
    if (!snapSheet) {
      snapSheet = ss.insertSheet(TABS.MEMORY_SNAPSHOT);
      snapSheet.getRange(1, 1, 1, MEMORY_SNAPSHOT_HEADERS.length).setValues([MEMORY_SNAPSHOT_HEADERS]);
      snapSheet.hideSheet();
    }

    // ── Dedup: skip if this week already snapshotted ──────────────────────────
    if (snapSheet.getLastRow() >= 2) {
      var existingWeeks = snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, 1).getValues();
      for (var wi = 0; wi < existingWeeks.length; wi++) {
        if (String(existingWeeks[wi][0] || '') === weekKey) {
          Logger.log('writeWeeklySnapshot_: already ran for ' + weekKey); return;
        }
      }
    }

    var rows = [];

    // Helper to push a metric row
    function snap(metric, who, value) {
      rows.push([weekKey, metric, who, value, dateStr]);
    }

    // ── Flags ─────────────────────────────────────────────────────────────────
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() >= 2) {
      var flagData = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
      var highCount = 0, medCount = 0, lowCount = 0;
      flagData.forEach(function(r) {
        if (String(r[8] || '').toLowerCase() === 'yes') return; // resolved
        if (String(r[6] || '').toLowerCase() === 'yes') return; // acknowledged
        var urg = String(r[5] || '').trim();
        if (urg === 'High')   highCount++;
        else if (urg === 'Medium') medCount++;
        else if (urg === 'Low')    lowCount++;
      });
      snap('active_flags_high',   'System', highCount);
      snap('active_flags_medium', 'System', medCount);
      snap('active_flags_low',    'System', lowCount);
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    var taskSheet = ss.getSheetByName(TABS.TASKS);
    if (taskSheet && taskSheet.getLastRow() >= 2) {
      var taskData = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, TASK_HEADERS.length).getValues();
      var openCount = 0, overdueCount = 0;
      var todayTs   = new Date(); todayTs.setHours(0, 0, 0, 0);
      taskData.forEach(function(r) {
        if (String(r[4] || '').trim() !== 'Open') return;
        openCount++;
        var due = r[3];
        if (due) {
          var d = new Date(due); d.setHours(0, 0, 0, 0);
          if (!isNaN(d.getTime()) && d < todayTs) overdueCount++;
        }
      });
      snap('open_tasks',    'System', openCount);
      snap('overdue_tasks', 'System', overdueCount);
    }

    // ── Projects ──────────────────────────────────────────────────────────────
    var projSheet = ss.getSheetByName(TABS.PROJECTS);
    if (projSheet && projSheet.getLastRow() >= 2) {
      var projKeys = {};
      projSheet.getRange(2, 1, projSheet.getLastRow() - 1, PROJECT_HEADERS.length).getValues()
        .forEach(function(r) {
          var proj = String(r[0] || '').trim();
          if (proj) projKeys[proj] = true;
        });
      snap('active_projects', 'System', Object.keys(projKeys).length);
    }

    // ── Goals ─────────────────────────────────────────────────────────────────
    var goalSheet = ss.getSheetByName(TABS.GOALS);
    if (goalSheet && goalSheet.getLastRow() >= 2) {
      var openGoals = 0;
      goalSheet.getRange(2, 1, goalSheet.getLastRow() - 1, GOAL_HEADERS.length).getValues()
        .forEach(function(r) {
          var st = String(r[3] || '').trim(); // Status column (index 3)
          if (st !== 'Done' && st !== 'Paused') openGoals++;
        });
      snap('open_goals', 'System', openGoals);
    }

    // ── Gym sessions this week ────────────────────────────────────────────────
    try {
      var gymRows    = getGymLog_();
      var weekStart  = getMondayOfWeek_(today);
      var gymCount   = gymRows.filter(function(r) {
        if (r.attended !== 'Yes') return false;
        var d = new Date(r.date + 'T00:00:00');
        return d >= weekStart && d <= today;
      }).length;
      snap('gym_sessions_this_week', 'Ahmed', gymCount);
    } catch (gymErr) {
      Logger.log('writeWeeklySnapshot_ gym error (non-fatal): ' + gymErr.message);
    }

    // ── PTO remaining ─────────────────────────────────────────────────────────
    try {
      var ptoSnap = getPTOSnapshot_();
      if (ptoSnap && ptoSnap.remaining) {
        snap('pto_vacation_remaining', 'Ahmed',   ptoSnap.remaining.vacationDays    || 0);
        snap('pto_vacation_remaining', 'Victoria', ptoSnap.remaining.vicVacationDays || 0);
      }
    } catch (ptoErr) {
      Logger.log('writeWeeklySnapshot_ PTO error (non-fatal): ' + ptoErr.message);
    }

    // ── Bills unpaid ──────────────────────────────────────────────────────────
    try {
      var billSheet = ss.getSheetByName(TABS.BILLS);
      if (billSheet && billSheet.getLastRow() >= 2) {
        var unpaidCount = 0;
        billSheet.getRange(2, 1, billSheet.getLastRow() - 1, BILL_HEADERS.length).getValues()
          .forEach(function(r) {
            if (String(r[6] || '').toLowerCase() !== 'yes') unpaidCount++; // Paid column
          });
        snap('bills_unpaid', 'System', unpaidCount);
      }
    } catch (billErr) {
      Logger.log('writeWeeklySnapshot_ bills error (non-fatal): ' + billErr.message);
    }

    // ── Write all rows ────────────────────────────────────────────────────────
    if (rows.length) {
      snapSheet.getRange(snapSheet.getLastRow() + 1, 1, rows.length, MEMORY_SNAPSHOT_HEADERS.length)
               .setValues(rows);
      Logger.log('writeWeeklySnapshot_: wrote ' + rows.length + ' snapshot row(s) for ' + weekKey);
    }

  } catch (e) {
    Logger.log('writeWeeklySnapshot_ error (non-fatal): ' + e.message);
  }
}

// ── Prune old rows ────────────────────────────────────────────────────────────

/**
 * Deletes Memory Log and Memory Snapshot rows older than the retention window.
 * Called nightly from nightlyRun().
 */
function pruneMemoryLog_() {
  try {
    var cfg            = getConfigValues();
    if ((cfg['memory_log_enabled'] || 'true') === 'false') return;
    var retentionMonths = parseInt(cfg['memory_log_retention_months'] || '12', 10) || 12;

    var ss       = getSpreadsheet();
    var cutoff   = new Date();
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    cutoff.setHours(0, 0, 0, 0);

    var pruned = 0;

    // Prune Memory Log (col B = Timestamp, e.g. "2025-04-01 23:00")
    var logSheet = ss.getSheetByName(TABS.MEMORY_LOG);
    if (logSheet && logSheet.getLastRow() >= 2) {
      for (var i = logSheet.getLastRow(); i >= 2; i--) {
        var ts = logSheet.getRange(i, 2).getValue();
        if (!ts) continue;
        var d = new Date(ts);
        if (!isNaN(d.getTime()) && d < cutoff) {
          logSheet.deleteRow(i);
          pruned++;
        }
      }
    }

    // Prune Memory Snapshot (col E = As Of, e.g. "2025-04-06")
    var snapSheet = ss.getSheetByName(TABS.MEMORY_SNAPSHOT);
    if (snapSheet && snapSheet.getLastRow() >= 2) {
      for (var j = snapSheet.getLastRow(); j >= 2; j--) {
        var asOf = snapSheet.getRange(j, 5).getValue();
        if (!asOf) continue;
        var sd = new Date(asOf);
        if (!isNaN(sd.getTime()) && sd < cutoff) {
          snapSheet.deleteRow(j);
          pruned++;
        }
      }
    }

    if (pruned > 0) Logger.log('pruneMemoryLog_: deleted ' + pruned + ' row(s) older than ' + retentionMonths + ' months.');
    else Logger.log('pruneMemoryLog_: nothing to prune.');

  } catch (e) {
    Logger.log('pruneMemoryLog_ error (non-fatal): ' + e.message);
  }
}

// ── Context builder for chat ──────────────────────────────────────────────────

/**
 * Returns a plain-text block summarising recent memory for chat context.
 * @param {number} days - How many days back to read (default 90)
 * @returns {string}
 */
function getMemoryContext_(days) {
  try {
    var cfg = getConfigValues();
    if ((cfg['memory_log_enabled'] || 'true') === 'false') return '';

    var ss       = getSpreadsheet();
    var lookback = days || 90;
    var cutoff   = new Date();
    cutoff.setDate(cutoff.getDate() - lookback);
    cutoff.setHours(0, 0, 0, 0);

    var lines = [];

    // ── Recent events ─────────────────────────────────────────────────────────
    var logSheet = ss.getSheetByName(TABS.MEMORY_LOG);
    if (logSheet && logSheet.getLastRow() >= 2) {
      var logData = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, MEMORY_LOG_HEADERS.length).getValues();
      var recentEvents = [];
      logData.forEach(function(r) {
        var ts = new Date(r[1]);
        if (isNaN(ts.getTime()) || ts < cutoff) return;
        recentEvents.push({
          ts:      r[1],
          type:    String(r[2] || ''),
          who:     String(r[3] || ''),
          title:   String(r[4] || ''),
          detail:  String(r[5] || ''),
          context: String(r[6] || ''),
        });
      });

      if (recentEvents.length) {
        lines.push('=== MEMORY LOG (last ' + lookback + ' days, ' + recentEvents.length + ' events) ===');
        recentEvents.forEach(function(ev) {
          var line = ev.ts + ' [' + ev.type + '] ' + (ev.who && ev.who !== 'System' ? ev.who + ' — ' : '') + ev.title;
          if (ev.detail) line += ' | ' + ev.detail;
          lines.push(line);
        });
      }
    }

    // ── Weekly snapshots (last 8 weeks) ───────────────────────────────────────
    var snapSheet = ss.getSheetByName(TABS.MEMORY_SNAPSHOT);
    if (snapSheet && snapSheet.getLastRow() >= 2) {
      var snapData = snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, MEMORY_SNAPSHOT_HEADERS.length).getValues();

      // Collect unique weeks, most recent 8
      var weeksSeen = {};
      snapData.forEach(function(r) { if (r[0]) weeksSeen[r[0]] = true; });
      var weeks = Object.keys(weeksSeen).sort().slice(-8);

      if (weeks.length) {
        lines.push('\n=== WEEKLY SNAPSHOTS (last ' + weeks.length + ' weeks) ===');
        weeks.forEach(function(week) {
          var weekRows = snapData.filter(function(r) { return String(r[0]) === week; });
          var summary  = weekRows.map(function(r) {
            return r[2] !== 'System' ? r[1] + '(' + r[2] + ')=' + r[3] : r[1] + '=' + r[3];
          }).join(', ');
          lines.push(week + ': ' + summary);
        });
      }
    }

    return lines.length ? lines.join('\n') : '';

  } catch (e) {
    Logger.log('getMemoryContext_ error (non-fatal): ' + e.message);
    return '';
  }
}
