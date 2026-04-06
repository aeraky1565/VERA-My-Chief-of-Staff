// ============================================================
// MonthlyReview.js — Monthly Life Review (Issue #82)
//
// On the 1st of each month, assembles a structured review of
// the prior month covering:
//   🎯 Goals (current year, by status)
//   ✅ Tasks (open / overdue snapshot)
//   💰 Finance (spending from Summaries tab)
//   🌴 PTO (usage + burn-down pace)
//   ✈️  Travel (trips from Itinerary in prior month)
//   ⚑  Flags (generated / resolved / unresolved)
//   💡 One thing to carry forward (Claude)
//
// Delivered as a Low urgency flag (full text in Reason field).
// Also archived to a "Monthly Reviews" tab (append-only).
//
// Called from nightlyRun() as: checkMonthlyReview_(ptoStats)
// ============================================================

var MONTHLY_REVIEWS_TAB_    = 'Monthly Reviews';
var MONTHLY_REVIEWS_HEADERS_ = ['Month Key', 'Month Label', 'Generated Date', 'Review'];

// ============================================================
// Entry point
// ============================================================

/**
 * Runs on the 1st of each month. Builds the prior-month review,
 * writes it as a Low flag, and archives it to the Monthly Reviews tab.
 *
 * @param {Object|null} ptoStats  Already-computed PTO snapshot from nightlyRun()
 */
function checkMonthlyReview_(ptoStats) {
  var cfg = getConfigValues();
  if (String(cfg['monthly_review_enabled'] || 'true').toLowerCase() === 'false') return;

  var today = new Date();
  if (today.getDate() !== 1) return;

  var tz         = Session.getScriptTimeZone();
  var priorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var label      = Utilities.formatDate(priorMonth, tz, 'MMMM yyyy');  // "March 2026"
  var monthKey   = Utilities.formatDate(priorMonth, tz, 'yyyyMM');     // "202603"
  var flagKey    = 'monthly_review_' + monthKey;

  // Dedup: skip if this month's review has already been written (any state)
  var ss        = getSpreadsheet();
  var flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (flagSheet && flagSheet.getLastRow() > 1) {
    var existing = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
    if (existing.some(function(r) { return String(r[9]).trim() === flagKey; })) {
      Logger.log('checkMonthlyReview_: review for ' + label + ' already exists — skipping.');
      return;
    }
  }

  Logger.log('checkMonthlyReview_: building review for ' + label + '…');
  var reviewText = buildMonthlyReview_(label, priorMonth, ptoStats);

  writeFlags([{
    source:  'Monthly Review',
    flag:    label + ' Life Review — ready',
    reason:  reviewText,
    urgency: 'Low',
    key:     flagKey,
  }]);

  archiveMonthlyReview_(label, monthKey, reviewText, ss);

  // Send dedicated email
  try {
    sendMonthlyReviewEmail_(label, reviewText);
  } catch (emailErr) {
    Logger.log('checkMonthlyReview_: email send failed (non-fatal): ' + emailErr.message);
  }

  Logger.log('checkMonthlyReview_: done.');
}

// ============================================================
// Review builder
// ============================================================

/**
 * Assembles the full review text for the prior month.
 */
function buildMonthlyReview_(label, priorMonth, ptoStats) {
  var tz         = Session.getScriptTimeZone();
  var monthStart = new Date(priorMonth.getFullYear(), priorMonth.getMonth(), 1);
  var monthEnd   = new Date(priorMonth.getFullYear(), priorMonth.getMonth() + 1, 0);

  var sections = [];
  sections.push('📅 ' + label + ' — Monthly Life Review');
  sections.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  sections.push(buildGoalsSection_());
  sections.push(buildTasksSection_());
  sections.push(buildFinanceSection_());
  sections.push(buildPTOSection_(ptoStats));
  sections.push(buildTravelSection_(monthStart, monthEnd, tz));
  sections.push(buildFlagsSection_(monthStart, monthEnd, tz));

  var bodyText = sections.join('\n');

  // Claude "one thing to carry forward"
  var insight = '';
  try {
    insight = generateMonthlyInsight_(bodyText);
  } catch (e) {
    Logger.log('checkMonthlyReview_: Claude insight failed (non-fatal): ' + e.message);
  }
  if (insight) bodyText += '\n💡 One thing to carry forward\n   ' + insight;

  return bodyText;
}

// ============================================================
// Section builders
// ============================================================

function buildGoalsSection_() {
  try {
    var year  = new Date().getFullYear();
    var goals = getGoals_().filter(function(g) { return g.year === year; });
    if (goals.length === 0) return '🎯 Goals\n   No goals tracked for ' + year + '.';

    var doing   = goals.filter(function(g) { return g.status === 'Doing'; });
    var done    = goals.filter(function(g) { return g.status === 'Done'; });
    var parked  = goals.filter(function(g) { return g.status === 'Parked'; });
    var todo    = goals.filter(function(g) { return g.status === 'To Do' || g.status === 'Resolutions'; });

    var lines = ['🎯 Goals (' + year + ')'];
    if (doing.length)  lines.push('   In Progress (' + doing.length  + '): ' + doing.map(function(g)  { return g.title; }).join(' · '));
    if (done.length)   lines.push('   Completed   (' + done.length   + '): ' + done.map(function(g)   { return g.title; }).join(' · '));
    if (parked.length) lines.push('   Parked      (' + parked.length + '): ' + parked.map(function(g) { return g.title; }).join(' · '));
    if (todo.length)   lines.push('   Not started (' + todo.length   + '): ' + todo.map(function(g)   { return g.title; }).join(' · '));
    return lines.join('\n');
  } catch (e) {
    return '🎯 Goals\n   (unavailable: ' + e.message + ')';
  }
}

function buildTasksSection_() {
  try {
    var tasks   = getOpenTasks();
    var open    = tasks.length;
    var overdue = tasks.filter(function(t) { return t.isOverdue; });
    var oldestAge = overdue.length
      ? Math.max.apply(null, overdue.map(function(t) { return t.ageInDays || 0; }))
      : 0;

    var lines = ['✅ Tasks'];
    lines.push('   Open: ' + open + '   Overdue: ' + overdue.length);
    if (overdue.length > 0) lines.push('   Oldest overdue: ' + oldestAge + ' days');
    return lines.join('\n');
  } catch (e) {
    return '✅ Tasks\n   (unavailable: ' + e.message + ')';
  }
}

function buildFinanceSection_() {
  try {
    var summaries = getSummaries();
    // Look for Total Spending rows written by Finance.js → getTransactionSummaries_
    var spendRows = summaries.filter(function(r) {
      return /total spending/i.test(String(r.metric || ''));
    });
    if (spendRows.length === 0) return '💰 Finance\n   (no transaction data configured)';

    var lines = ['💰 Finance'];
    spendRows.forEach(function(r) {
      lines.push('   ' + r.metric + ': ' + r.value);
    });

    // Top category movers
    var catRows = summaries.filter(function(r) {
      return r.source && /transaction|finance/i.test(String(r.source)) &&
             !/total spending|other/i.test(String(r.metric || ''));
    });
    if (catRows.length > 0) {
      lines.push('   Categories: ' + catRows.slice(0, 5).map(function(r) {
        return r.metric + ' ' + r.value;
      }).join(' · '));
    }
    return lines.join('\n');
  } catch (e) {
    return '💰 Finance\n   (unavailable: ' + e.message + ')';
  }
}

function buildPTOSection_(ptoStats) {
  try {
    if (!ptoStats) return '🌴 PTO\n   (not configured)';

    var used      = (ptoStats.used      || {}).vacationDays || 0;
    var planned   = (ptoStats.planned   || {}).vacationDays || 0;
    var remaining = (ptoStats.remaining || {}).vacationDays || 0;
    var pace      = (ptoStats.burnDown  || {}).paceStatus   || '';
    var plan321   = ptoStats['3-2-1']   || {};

    var lines = ['🌴 PTO'];
    lines.push('   Used: ' + used + ' days   Planned: ' + planned + ' days   Remaining: ' + remaining + ' days');
    if (pace) lines.push('   Pace: ' + pace);
    if (plan321.longWeekends !== undefined || plan321.midSizeWeeks !== undefined || plan321.bigPivot !== undefined) {
      lines.push('   3-2-1: Long weekends ' + (plan321.longWeekends || 0) +
                 ' · Mid-size ' + (plan321.midSizeWeeks || 0) +
                 ' · Big pivot ' + (plan321.bigPivot || 0));
    }
    return lines.join('\n');
  } catch (e) {
    return '🌴 PTO\n   (unavailable: ' + e.message + ')';
  }
}

function buildTravelSection_(monthStart, monthEnd, tz) {
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.ITINERARY);
    if (!sheet || sheet.getLastRow() < 2) return '✈️  Travel\n   No itinerary entries found.';

    var numRows = sheet.getLastRow() - 1;
    var data    = sheet.getRange(2, 1, numRows, ITINERARY_HEADERS.length).getValues();

    // ITINERARY_HEADERS: ID(0) TripKey(1) Type(2) Title(3) Date(4) ...
    var tripKeys = {};
    data.forEach(function(row) {
      var dateVal = row[4];
      if (!dateVal) return;
      var d = new Date(dateVal); d.setHours(0, 0, 0, 0);
      if (d >= monthStart && d <= monthEnd) {
        var key = String(row[1] || '').trim();
        if (key) tripKeys[key] = true;
      }
    });

    var trips = Object.keys(tripKeys);
    var lines = ['✈️  Travel'];
    if (trips.length === 0) {
      lines.push('   No trips this month.');
    } else {
      lines.push('   Trips: ' + trips.join(' · '));
    }
    return lines.join('\n');
  } catch (e) {
    return '✈️  Travel\n   (unavailable: ' + e.message + ')';
  }
}

function buildFlagsSection_(monthStart, monthEnd, tz) {
  try {
    var ss        = getSpreadsheet();
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (!flagSheet || flagSheet.getLastRow() < 2) return '⚑ Flags\n   No flags found.';

    var numRows = flagSheet.getLastRow() - 1;
    var data    = flagSheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    // FLAG_HEADERS: ID(0) Date(1) Source(2) Flag(3) Reason(4) Urgency(5)
    //               Acknowledged(6) Snoozed Until(7) Resolved(8) Key(9) Escalated(10)

    var generated  = 0;
    var resolved   = 0;
    var snoozed    = 0;
    var unresolved = 0;
    var oldestUnresolvedDate = null;
    var oldestUnresolvedFlag = '';

    data.forEach(function(r) {
      var dateVal = r[1];
      if (!dateVal) return;
      var d = new Date(dateVal); d.setHours(0, 0, 0, 0);
      if (d < monthStart || d > monthEnd) return;

      generated++;
      var isResolved = String(r[8]).toLowerCase() === 'yes';
      var isSnoozed  = String(r[7] || '').trim() !== '';
      if (isResolved) {
        resolved++;
      } else if (isSnoozed) {
        snoozed++;
      } else {
        unresolved++;
        if (!oldestUnresolvedDate || d < oldestUnresolvedDate) {
          oldestUnresolvedDate = d;
          oldestUnresolvedFlag = String(r[3] || '').trim();
        }
      }
    });

    var lines = ['⚑ Flags'];
    lines.push('   Generated: ' + generated + '   Resolved: ' + resolved +
               '   Snoozed: ' + snoozed + '   Unresolved: ' + unresolved);
    if (oldestUnresolvedFlag) {
      lines.push('   Oldest unresolved: "' + oldestUnresolvedFlag + '"');
    }
    return lines.join('\n');
  } catch (e) {
    return '⚑ Flags\n   (unavailable: ' + e.message + ')';
  }
}

// ============================================================
// Claude insight
// ============================================================

function generateMonthlyInsight_(reviewText) {
  var apiKey = getApiKey();
  var prompt =
    'Based on this monthly life review, generate exactly one sentence that is:\n' +
    '- Forward-looking, not backward-looking\n' +
    '- Specific to the data, not generic\n' +
    '- Actionable or thought-provoking\n' +
    '- Not motivational-poster tone\n\n' +
    'Reply with only the sentence, no prefix or explanation.\n\n' +
    reviewText;

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method:      'post',
    contentType: 'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('generateMonthlyInsight_: Claude returned ' + response.getResponseCode());
    return '';
  }
  return JSON.parse(response.getContentText()).content[0].text.trim();
}

// ============================================================
// Archive
// ============================================================

/**
 * Appends one row to the "Monthly Reviews" tab (creates tab if missing).
 * Rows are never overwritten — this is a permanent append-only log.
 */
function archiveMonthlyReview_(label, monthKey, reviewText, ss) {
  var sheet = ss.getSheetByName(MONTHLY_REVIEWS_TAB_);
  if (!sheet) {
    sheet = ss.insertSheet(MONTHLY_REVIEWS_TAB_);
    sheet.appendRow(MONTHLY_REVIEWS_HEADERS_);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, MONTHLY_REVIEWS_HEADERS_.length)
         .setFontWeight('bold')
         .setBackground('#1a2a4a')
         .setFontColor('#ffffff');
  }

  var tz  = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  sheet.appendRow([monthKey, label, now, reviewText]);
  Logger.log('archiveMonthlyReview_: archived ' + label + ' to "' + MONTHLY_REVIEWS_TAB_ + '" tab.');
}

// ============================================================
// Email
// ============================================================

/**
 * Sends a formatted HTML Monthly Life Review email.
 * Uses the same VERA dark theme as morningNudge().
 */
function sendMonthlyReviewEmail_(label, reviewText) {
  var to = CONFIG.MORNING_NUDGE_EMAIL;
  if (!to) { Logger.log('sendMonthlyReviewEmail_: no recipient configured.'); return; }

  // ── Logo (graceful fallback) ──────────────────────────────────────────────
  var inlineImages = {};
  var logoTag = '';
  try {
    var logoFileId = PropertiesService.getScriptProperties().getProperty('VERA_LOGO_FILE_ID');
    if (logoFileId) {
      inlineImages = { veraLogo: DriveApp.getFileById(logoFileId).getBlob() };
      logoTag = '<img src="cid:veraLogo" alt="VERA" style="width:100%;display:block;border:0;" />';
    }
  } catch (e) { /* no logo — use text banner */ }

  // ── Dashboard button ──────────────────────────────────────────────────────
  var dashUrl = PropertiesService.getScriptProperties().getProperty('VERA_DASHBOARD_URL') || '';
  var dashBtn = dashUrl
    ? '<tr><td style="padding:0 0 24px 0;">' +
      '<a href="' + dashUrl + '" style="display:inline-block;background:#0d1b3e;color:#c9a84c;' +
      'font-size:14px;font-weight:700;letter-spacing:1px;padding:12px 28px;border-radius:6px;' +
      'text-decoration:none;border:2px solid #c9a84c;">Open VERA Dashboard &rarr;</a>' +
      '</td></tr>'
    : '';

  // ── Convert plain-text review into HTML sections ──────────────────────────
  var sectionIcons = {
    '🎯': '#c9a84c',   // Goals
    '✅': '#66bb6a',   // Tasks
    '💰': '#42a5f5',   // Finance
    '🌴': '#26c6da',   // PTO
    '✈️':  '#7e57c2',  // Travel
    '⚑':  '#ef5350',   // Flags
    '💡': '#ffa726',   // Insight
  };

  var htmlSections = '';
  var lines = reviewText.split('\n');
  var inSection = false;
  var sectionBuf = [];

  function flushSection_() {
    if (!sectionBuf.length) return;
    var heading = sectionBuf[0];
    var icon    = heading.charAt(0);
    var color   = sectionIcons[icon] || '#c9a84c';
    var bodyLines = sectionBuf.slice(1).filter(function(l) { return l.trim() !== ''; });

    htmlSections +=
      '<tr><td style="padding:0 0 20px 0;">' +
      '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:' + color + ';">' +
      escapeHtml_(heading) + '</p>' +
      bodyLines.map(function(l) {
        return '<p style="margin:0 0 4px;font-size:13px;color:#c0cce8;padding-left:8px;">' +
               escapeHtml_(l.trim()) + '</p>';
      }).join('') +
      '</td></tr>' +
      '<tr><td style="padding:0 0 20px;border-bottom:1px solid #1e2e4a;">' +
      '</td></tr><tr><td style="padding:12px 0 0;"></td></tr>';

    sectionBuf = [];
  }

  lines.forEach(function(line) {
    // Skip the header lines (title + divider)
    if (line.indexOf('Monthly Life Review') !== -1) return;
    if (/^━+$/.test(line.trim())) return;
    if (line.trim() === '') {
      if (sectionBuf.length) flushSection_();
      return;
    }
    sectionBuf.push(line);
  });
  if (sectionBuf.length) flushSection_();

  // ── Header banner (logo or text) ─────────────────────────────────────────
  var headerBanner = logoTag
    ? '<tr><td style="background:#0d1b3e;padding:0;">' + logoTag + '</td></tr>'
    : '<tr><td style="background:#0d1b3e;padding:20px 32px;">' +
      '<p style="margin:0;font-size:22px;font-weight:900;color:#c9a84c;letter-spacing:3px;">VERA</p>' +
      '</td></tr>';

  var htmlBody =
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07111f;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#07111f;padding:24px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0d1b3e;' +
    'border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.5);">' +

    // Logo / brand header
    headerBanner +

    // Title row
    '<tr><td style="padding:28px 32px 8px;">' +
    '<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#4d6080;' +
    'letter-spacing:2px;text-transform:uppercase;">Monthly Life Review</p>' +
    '<p style="margin:0;font-size:26px;font-weight:800;color:#e8eaf6;line-height:1.2;">' +
    escapeHtml_(label) + '</p>' +
    '</td></tr>' +

    // Section content
    '<tr><td style="padding:20px 32px 0;">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    htmlSections +
    dashBtn +
    '</table></td></tr>' +

    // Footer
    '<tr><td style="padding:20px 32px 28px;border-top:1px solid #1e2e4a;">' +
    '<p style="margin:0;font-size:11px;color:#2e3d55;text-align:center;">' +
    'Generated by VERA · Your Chief of Staff</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  MailApp.sendEmail(to, '📅 ' + label + ' Life Review', reviewText, {
    name:         'VERA',
    htmlBody:     htmlBody,
    inlineImages: inlineImages,
  });
  Logger.log('sendMonthlyReviewEmail_: sent to ' + to);
}
