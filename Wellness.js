// ============================================================
// VERA — Wellness.js
// Health–Performance Correlation (Feature 12)
// ============================================================
//
// Functions:
//   logWellness_(who, metric, value, source)
//   fetchGoogleFitSleep_()
//   getWellnessByWeek_(weeksBack)
//   sendHealthPerformanceInsightMonthly_()
//   getHealthPerformanceSummaryLine_()
// ============================================================

/**
 * Appends one row to the Wellness Log for a given metric.
 * Idempotent: if a row for the same date + metric already exists, overwrites its value.
 *
 * @param {string} who    - Typically 'Ahmed'
 * @param {string} metric - 'sleep_hours', 'sleep_quality', 'energy', 'mood', or 'steps'
 * @param {number} value  - Numeric value
 * @param {string} source - 'google_fit' or 'manual'
 */
function logWellness_(who, metric, value, source) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.WELLNESS_LOG);
  if (!sheet) return;

  var tz      = Session.getScriptTimeZone();
  var today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var id      = 'WL-' + today.replace(/-/g, '') + '-' + metric;
  var now     = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

  // Check for existing row with same date + metric — overwrite if found
  if (sheet.getLastRow() > 1) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, WELLNESS_LOG_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.getRange(i + 2, 1, 1, WELLNESS_LOG_HEADERS.length).setValues(
          [[id, today, who, metric, value, source, now]]
        );
        Logger.log('logWellness_: overwrote existing row ' + id);
        return;
      }
    }
  }

  sheet.appendRow([id, today, who, metric, value, source, now]);
  Logger.log('logWellness_: appended ' + id + ' = ' + value + ' (' + source + ')');
}

/**
 * Fetches last night's sleep data from Google Fit and logs it to WELLNESS_LOG.
 * Returns the sleep hours as a float, or null if no data.
 */
function fetchGoogleFitSleep_() {
  var cfg = getConfigValues();
  if (String(cfg['wellness_log_enabled'] || 'true').toLowerCase() === 'false') return null;

  var tz = Session.getScriptTimeZone();
  var now = new Date();

  // Yesterday midnight → today midnight (in ms)
  var todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterdayMidnight = new Date(todayMidnight.getTime() - 86400000);

  var startMs = yesterdayMidnight.getTime();
  var endMs   = todayMidnight.getTime();

  var token = ScriptApp.getOAuthToken();
  var payload = {
    aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis:   endMs,
  };

  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        method:             'post',
        contentType:        'application/json',
        headers:            { Authorization: 'Bearer ' + token },
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
  } catch (e) {
    Logger.log('fetchGoogleFitSleep_: fetch error — ' + e.message);
    recordApiHealth_('googlefit-sleep', false, e.message, 0);
    return null;
  }

  if (response.getResponseCode() !== 200) {
    Logger.log('fetchGoogleFitSleep_: non-200 response — ' + response.getContentText().substring(0, 200));
    recordApiHealth_('googlefit-sleep', false,
      String(response.getContentText() || '').substring(0, 200), response.getResponseCode());
    return null;
  }

  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    recordApiHealth_('googlefit-sleep', false, 'parse error: ' + e.message, 200);
    return null;
  }

  // Sum sleep segment durations (all segment types count)
  var totalMs = 0;
  var buckets = body.bucket || [];
  buckets.forEach(function(bucket) {
    var datasets = bucket.dataset || [];
    datasets.forEach(function(ds) {
      var points = ds.point || [];
      points.forEach(function(pt) {
        var startNs = parseInt(pt.startTimeNanos, 10) || 0;
        var endNs   = parseInt(pt.endTimeNanos, 10)   || 0;
        totalMs += (endNs - startNs) / 1e6;
      });
    });
  });

  // The API answered, so the source is healthy either way. An empty result
  // usually means the watch was not worn — that is real data, not an outage,
  // and must not mark Google Fit as degraded.
  recordApiHealth_('googlefit-sleep', true, '', 200);

  if (totalMs === 0) {
    Logger.log('fetchGoogleFitSleep_: no sleep data returned for yesterday');
    return null;
  }

  var hours = Math.round((totalMs / 3600000) * 10) / 10;
  logWellness_('Ahmed', 'sleep_hours', hours, 'google_fit');
  Logger.log('fetchGoogleFitSleep_: logged ' + hours + 'h from Google Fit');
  return hours;
}

/**
 * Looks up which step_count.delta data source this Google Fit account
 * actually has (varies per account/device — there is no one dataSourceId
 * that works everywhere), preferring the standard merged-across-sources
 * view over a single-device raw stream. Returns a dataStreamId string, or
 * null if the account has no readable step_count.delta source at all.
 */
function findGoogleFitStepDataSourceId_(token) {
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataSources',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
  } catch (e) {
    Logger.log('findGoogleFitStepDataSourceId_: fetch error — ' + e.message);
    return null;
  }
  if (response.getResponseCode() !== 200) {
    Logger.log('findGoogleFitStepDataSourceId_: non-200 response — ' +
      response.getContentText().substring(0, 200));
    return null;
  }

  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('findGoogleFitStepDataSourceId_: parse error — ' + e.message);
    return null;
  }

  var sources = (body.dataSource || []).filter(function(ds) {
    return ds.dataType && ds.dataType.name === 'com.google.step_count.delta';
  });
  if (!sources.length) return null;

  // Prefer the standard system-managed merge across every connected
  // source (exists for virtually any account with step data at all);
  // fall back to any other derived (system-computed) source, then to
  // whatever's left (a single raw device/app stream).
  var merged = sources.find(function(ds) { return (ds.dataStreamId || '').indexOf('merge_step_deltas') !== -1; });
  if (merged) return merged.dataStreamId;
  var derived = sources.find(function(ds) { return (ds.dataStreamId || '').indexOf('derived:') === 0; });
  if (derived) return derived.dataStreamId;
  return sources[0].dataStreamId;
}

/**
 * Fetches yesterday's step count from Google Fit and logs it to WELLNESS_LOG.
 * Same window/auth/error-handling shape as fetchGoogleFitSleep_, but tracked
 * under its own 'googlefit-steps' ApiHealth source — sleep and steps use
 * different scopes/data types and can fail independently (e.g. steps needs
 * fitness.activity.read, sleep needs fitness.sleep.read), so sharing one
 * health entry would let one metric's failure mask the other's success.
 * Returns the step count as an integer, or null if no data.
 */
function fetchGoogleFitSteps_() {
  var cfg = getConfigValues();
  if (String(cfg['wellness_log_enabled'] || 'true').toLowerCase() === 'false') return null;

  var tz = Session.getScriptTimeZone();
  var now = new Date();

  // Yesterday midnight → today midnight (in ms)
  var todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterdayMidnight = new Date(todayMidnight.getTime() - 86400000);

  var startMs = yesterdayMidnight.getTime();
  var endMs   = todayMidnight.getTime();

  var token = ScriptApp.getOAuthToken();

  // Google Fit's aggregate endpoint 403s ("Cannot read data of type
  // com.google.step_count.delta") if you request the raw data type
  // directly — it needs a specific dataSourceId instead. Which derived
  // source actually exists varies per account (e.g. Google's own
  // "estimated_steps" pedometer source only exists for accounts using
  // Android's on-device step counting), so ask the account which
  // step-count sources it actually has rather than hardcoding one.
  var dataSourceId = findGoogleFitStepDataSourceId_(token);
  if (!dataSourceId) {
    Logger.log('fetchGoogleFitSteps_: no readable step_count.delta data source found for this account');
    recordApiHealth_('googlefit-steps', false, 'no readable step_count.delta data source found', 200);
    return null;
  }

  var payload = {
    aggregateBy: [{ dataSourceId: dataSourceId }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startMs,
    endTimeMillis:   endMs,
  };

  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        method:             'post',
        contentType:        'application/json',
        headers:            { Authorization: 'Bearer ' + token },
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );
  } catch (e) {
    Logger.log('fetchGoogleFitSteps_: fetch error — ' + e.message);
    recordApiHealth_('googlefit-steps', false, e.message, 0);
    return null;
  }

  if (response.getResponseCode() !== 200) {
    Logger.log('fetchGoogleFitSteps_: non-200 response — ' + response.getContentText().substring(0, 200));
    recordApiHealth_('googlefit-steps', false,
      String(response.getContentText() || '').substring(0, 200), response.getResponseCode());
    return null;
  }

  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    recordApiHealth_('googlefit-steps', false, 'parse error: ' + e.message, 200);
    return null;
  }

  // Sum step count deltas (integer counts, not durations)
  var totalSteps = 0;
  var buckets = body.bucket || [];
  buckets.forEach(function(bucket) {
    var datasets = bucket.dataset || [];
    datasets.forEach(function(ds) {
      var points = ds.point || [];
      points.forEach(function(pt) {
        var values = pt.value || [];
        values.forEach(function(v) {
          totalSteps += v.intVal || 0;
        });
      });
    });
  });

  // The API answered, so the source is healthy either way — a 0-step day is
  // real data (e.g. watch not worn), not an outage.
  recordApiHealth_('googlefit-steps', true, '', 200);

  if (totalSteps === 0) {
    Logger.log('fetchGoogleFitSteps_: no step data returned for yesterday');
    return null;
  }

  logWellness_('Ahmed', 'steps', totalSteps, 'google_fit');
  Logger.log('fetchGoogleFitSteps_: logged ' + totalSteps + ' steps from Google Fit');
  return totalSteps;
}

/**
 * Reads WELLNESS_LOG, GYM_LOG, and HABIT_LOG for a given week.
 *
 * @param {number} weeksBack - 0 = current Mon–Sun week, 1 = last week, etc.
 * @returns {{ sleep_hours_avg, sleep_quality_avg, energy_avg, mood_avg, steps_avg, gym_sessions, habit_completion_pct, has_data }}
 */
function getWellnessByWeek_(weeksBack) {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();

  // Find Monday of the target week
  var dayOfWeek   = today.getDay(); // 0=Sun
  var daysToMon   = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;
  var mondayThisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToMon);
  var mondayTarget   = new Date(mondayThisWeek.getTime() - weeksBack * 7 * 86400000);
  var sundayTarget   = new Date(mondayTarget.getTime() + 6 * 86400000);

  var weekStart = Utilities.formatDate(mondayTarget, tz, 'yyyy-MM-dd');
  var weekEnd   = Utilities.formatDate(sundayTarget, tz, 'yyyy-MM-dd');

  var result = {
    sleep_hours_avg:    null,
    sleep_quality_avg:  null,
    energy_avg:         null,
    mood_avg:           null,
    steps_avg:          null,
    gym_sessions:       0,
    habit_completion_pct: null,
    has_data:           false,
  };

  var ss = getSpreadsheet();

  // ── Wellness Log ──────────────────────────────────────────────────────────
  var wellSheet = ss.getSheetByName(TABS.WELLNESS_LOG);
  if (wellSheet && wellSheet.getLastRow() > 1) {
    var wellData = wellSheet.getRange(2, 1, wellSheet.getLastRow() - 1, WELLNESS_LOG_HEADERS.length).getValues();
    var sums     = { sleep_hours: 0, sleep_quality: 0, energy: 0, mood: 0, steps: 0 };
    var counts   = { sleep_hours: 0, sleep_quality: 0, energy: 0, mood: 0, steps: 0 };

    wellData.forEach(function(row) {
      var dateStr = String(row[1] || '').trim();
      if (dateStr < weekStart || dateStr > weekEnd) return;
      var metric = String(row[3] || '').trim();
      var val    = parseFloat(row[4]);
      if (isNaN(val)) return;
      if (metric in sums) {
        sums[metric]   += val;
        counts[metric] += 1;
      }
    });

    if (counts.sleep_hours > 0)   { result.sleep_hours_avg   = Math.round((sums.sleep_hours / counts.sleep_hours) * 10) / 10; result.has_data = true; }
    if (counts.sleep_quality > 0) { result.sleep_quality_avg = Math.round((sums.sleep_quality / counts.sleep_quality) * 10) / 10; result.has_data = true; }
    if (counts.energy > 0)        { result.energy_avg        = Math.round((sums.energy / counts.energy) * 10) / 10; result.has_data = true; }
    if (counts.mood > 0)          { result.mood_avg          = Math.round((sums.mood / counts.mood) * 10) / 10; result.has_data = true; }
    if (counts.steps > 0)         { result.steps_avg         = Math.round(sums.steps / counts.steps); result.has_data = true; }
  }

  // ── Gym Log ───────────────────────────────────────────────────────────────
  var gymSheet = ss.getSheetByName(TABS.GYM_LOG);
  if (gymSheet && gymSheet.getLastRow() > 1) {
    var gymData = gymSheet.getRange(2, 1, gymSheet.getLastRow() - 1, GYM_LOG_HEADERS.length).getValues();
    gymData.forEach(function(row) {
      var rawDate  = row[2]; // Event Date column
      var attended = String(row[3] || '').trim();
      if (!rawDate || attended !== 'Yes') return;
      var dateStr = Utilities.formatDate(new Date(rawDate), tz, 'yyyy-MM-dd');
      if (dateStr >= weekStart && dateStr <= weekEnd) result.gym_sessions++;
    });
  }

  // ── Habit Log ─────────────────────────────────────────────────────────────
  var habitSheet = ss.getSheetByName(TABS.HABIT_LOG);
  if (habitSheet && habitSheet.getLastRow() > 1) {
    var habitData    = habitSheet.getRange(2, 1, habitSheet.getLastRow() - 1, HABIT_LOG_HEADERS.length).getValues();
    var habitsSheet  = ss.getSheetByName(TABS.HABITS);
    var totalHabits  = 0;
    if (habitsSheet && habitsSheet.getLastRow() > 1) {
      var habitsData = habitsSheet.getRange(2, 1, habitsSheet.getLastRow() - 1, HABITS_HEADERS.length).getValues();
      totalHabits = habitsData.filter(function(r) { return String(r[4] || '').trim() !== 'false'; }).length;
    }

    if (totalHabits > 0) {
      var weekDays  = 7;
      var possible  = totalHabits * weekDays;
      var completed = 0;
      habitData.forEach(function(row) {
        var dateStr = String(row[2] || '').trim();
        if (dateStr >= weekStart && dateStr <= weekEnd) completed++;
      });
      if (possible > 0) {
        result.habit_completion_pct = Math.round((completed / possible) * 100);
      }
    }
  }

  return result;
}

/**
 * Returns a single summary sentence for the current week's wellness+performance data,
 * or '' if there's insufficient data. Called from sendWeeklyTrendReview_().
 */
function getHealthPerformanceSummaryLine_() {
  try {
    var cfg = getConfigValues();
    if (String(cfg['wellness_log_enabled'] || 'true').toLowerCase() === 'false') return '';

    var week = getWellnessByWeek_(0);
    if (!week.has_data) return '';

    var parts = [];
    if (week.energy_avg !== null)        parts.push('avg energy ' + week.energy_avg);
    if (week.mood_avg !== null)          parts.push('mood ' + week.mood_avg);
    if (week.sleep_quality_avg !== null) parts.push('sleep quality ' + week.sleep_quality_avg);
    if (week.sleep_hours_avg !== null)   parts.push('sleep ' + week.sleep_hours_avg + 'h');
    if (week.steps_avg !== null)         parts.push('steps ' + week.steps_avg.toLocaleString());
    if (parts.length === 0) return '';

    var perf = [];
    perf.push('gym ' + week.gym_sessions + '×');
    if (week.habit_completion_pct !== null) perf.push('habits ' + week.habit_completion_pct + '%');

    return '\u{1F4CA} This week: ' + parts.join(', ') + (perf.length ? ' — ' + perf.join(', ') : '');
  } catch (e) {
    Logger.log('getHealthPerformanceSummaryLine_ error: ' + e.message);
    return '';
  }
}

/**
 * Sends the monthly Health–Performance Insight to #vera-notifications on the 1st of each month.
 * Reads the last 4 weeks of data, calls Claude for pattern analysis, and posts a digest.
 */
function sendHealthPerformanceInsightMonthly_() {
  var cfg = getConfigValues();
  if (String(cfg['wellness_log_enabled'] || 'true').toLowerCase() === 'false') return;
  if (!isNotifEnabled_('health_performance_insight')) {
    Logger.log('sendHealthPerformanceInsightMonthly_: notif disabled'); return;
  }

  // Collect 4 weeks of data (weeksBack 1–4, i.e. last 4 completed weeks)
  var weekRows = [];
  for (var w = 1; w <= 4; w++) {
    var data = getWellnessByWeek_(w);
    if (data.has_data) weekRows.push({ weeksBack: w, data: data });
  }

  if (weekRows.length < 2) {
    Logger.log('sendHealthPerformanceInsightMonthly_: not enough data (' + weekRows.length + ' week(s))');
    return;
  }

  // Build week-by-week text table
  var tz   = Session.getScriptTimeZone();
  var now  = new Date();
  var tableLines = weekRows.map(function(wr) {
    var d = wr.data;
    var wStart = new Date(now.getTime() - wr.weeksBack * 7 * 86400000);
    // Get Monday of that week
    var dow = wStart.getDay();
    var daysToMon = (dow === 0) ? -6 : 1 - dow;
    var mon = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + daysToMon);
    var weekLabel = Utilities.formatDate(mon, tz, 'MMM d');

    var cols = ['  ' + weekLabel + ':'];
    if (d.sleep_hours_avg !== null)   cols.push('sleep ' + d.sleep_hours_avg + 'h');
    if (d.sleep_quality_avg !== null) cols.push('quality ' + d.sleep_quality_avg + '/5');
    if (d.energy_avg !== null)        cols.push('energy ' + d.energy_avg + '/5');
    if (d.mood_avg !== null)          cols.push('mood ' + d.mood_avg + '/5');
    if (d.steps_avg !== null)         cols.push('steps ' + d.steps_avg.toLocaleString());
    cols.push('gym ' + d.gym_sessions + '×');
    if (d.habit_completion_pct !== null) cols.push('habits ' + d.habit_completion_pct + '%');
    return cols.join(' · ');
  });

  var tableText = tableLines.join('\n');

  // Call Claude for pattern analysis
  var narrative = '';
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY') || '';
    if (apiKey) {
      var monthName = Utilities.formatDate(now, tz, 'MMMM yyyy');
      var prompt =
        'You are VERA, Ahmed\'s Chief of Staff. Here is week-by-week health and performance data for the past month:\n\n' +
        tableText + '\n\n' +
        'Metrics: sleep hours and steps (from Google Fit), sleep quality/energy/mood (rated 1–5 by Ahmed each morning), ' +
        'gym sessions attended, and habit completion percentage.\n\n' +
        'Identify 2–3 specific, data-backed patterns you observe (e.g. correlations between sleep and energy, ' +
        'gym frequency and habits, low-wellness weeks vs. performance dips). Then give 1 concrete recommendation. ' +
        'Be direct and specific. No filler. No markdown headers. Keep it under 120 words.';

      var resp = fetchTracked_('anthropic', 'https://api.anthropic.com/v1/messages', {
        method:      'post',
        contentType: 'application/json',
        headers:     { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        payload:     JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages:   [{ role: 'user', content: prompt }],
        }),
        muteHttpExceptions: true,
      });
      if (resp.getResponseCode() === 200) {
        var body = JSON.parse(resp.getContentText());
        narrative = (body.content && body.content[0] && body.content[0].text) ? body.content[0].text.trim() : '';
      }
    }
  } catch (aiErr) {
    Logger.log('sendHealthPerformanceInsightMonthly_ Claude error: ' + aiErr.message);
  }

  var monthLabel = Utilities.formatDate(now, tz, 'MMMM yyyy');
  var message =
    '*🔬 Health–Performance Insight — ' + monthLabel + '*\n\n' +
    'Week-over-week data:\n' + tableText +
    (narrative ? '\n\n' + narrative : '');

  var ch = getNotifChannel_('health_performance_insight');
  sendSlack_(ch, message);
  Logger.log('sendHealthPerformanceInsightMonthly_: sent to ' + ch);
  try { sendSlackLog_('🔬 Health–Performance Insight sent for ' + monthLabel); } catch (e) {}
}
