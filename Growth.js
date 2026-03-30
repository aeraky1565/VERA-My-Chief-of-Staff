// ============================================================
// VERA — Growth.js
// Personal development intelligence (Issue #88)
//
// checkGrowth_()  — called from nightlyRun()
//   1. Flags books that have been "Reading" for 60+ days
//   2. Flags when no books/courses completed in the last 90 days
//   3. Flags skills that haven't been practiced in 60+ days
// ============================================================

/**
 * Nightly intelligence for the Growth tracker.
 * Called from nightlyRun() — wrapped in try/catch there.
 */
function checkGrowth_() {
  // Stale-reading and skill-atrophy nags are suppressed during active trips (Issue #139)
  if (!isInVacationMode_()) {
    checkStaleReading_();
    checkSkillAtrophy_();
  }
  // Learning gap still runs — missing 90 days in a row is worth flagging even after a trip
  checkLearningGap_();
}

// ---- Stale reading check ---------------------------------------------------

/**
 * Flags any book with status "Reading" whose Date Started is 60+ days ago.
 * Key: growth_stale_book_{id}  — fires once per book, then stops.
 */
function checkStaleReading_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BOOKS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var today   = new Date();
  today.setHours(0, 0, 0, 0);
  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, BOOK_HEADERS.length).getValues();

  data.forEach(function(row) {
    var id      = String(row[0] || '').trim();
    var person  = String(row[1] || '').trim();
    var title   = String(row[2] || '').trim();
    var status  = String(row[5] || '').trim();
    var started = row[7]; // Date Started

    if (!id || !title || status !== 'Reading' || !started) return;

    var startDate = new Date(started);
    startDate.setHours(0, 0, 0, 0);
    if (isNaN(startDate.getTime())) return;

    var daysIn = Math.round((today - startDate) / 86400000);
    if (daysIn < 60) return;

    var key = 'growth_stale_book_' + id;
    if (flagKeyExists_(key)) return;

    addFlag_(
      'Growth',
      person + ' — stale read: "' + title + '"',
      'Low',
      key,
      '"' + title + '" has been marked as Reading for ' + daysIn + ' days. ' +
      'Either pick it back up or mark it as abandoned in Growth → Personal Development.'
    );
  });

  Logger.log('checkStaleReading_: scan complete.');
}

// ---- Learning gap check ----------------------------------------------------

/**
 * For each person (Ahmed, Victoria), checks whether any book or course has
 * been completed in the last 90 days. If not, fires a Low flag.
 * Key: growth_learning_gap_{person}_{YYYY_QN}  — once per quarter per person.
 */
function checkLearningGap_() {
  var ss    = getSpreadsheet();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var cutoff = new Date(today.getTime() - 90 * 86400000);

  // Determine quarter key  (Q1-Q4)
  var quarter = 'Q' + (Math.floor(today.getMonth() / 3) + 1);
  var yearQ   = today.getFullYear() + '_' + quarter;

  ['Ahmed', 'Victoria'].forEach(function(person) {
    var hasRecent = false;

    // Check books
    var bSheet = ss.getSheetByName(TABS.BOOKS);
    if (bSheet && bSheet.getLastRow() >= 2) {
      bSheet.getRange(2, 1, bSheet.getLastRow() - 1, BOOK_HEADERS.length).getValues()
        .forEach(function(r) {
          if (hasRecent) return;
          if (String(r[1]).trim() !== person) return;
          if (String(r[5]).trim() !== 'Read') return;
          var finished = r[8]; // Date Finished
          if (!finished) return;
          var d = new Date(finished);
          if (!isNaN(d.getTime()) && d >= cutoff) hasRecent = true;
        });
    }

    // Check courses
    if (!hasRecent) {
      var cSheet = ss.getSheetByName(TABS.COURSES);
      if (cSheet && cSheet.getLastRow() >= 2) {
        cSheet.getRange(2, 1, cSheet.getLastRow() - 1, COURSE_HEADERS.length).getValues()
          .forEach(function(r) {
            if (hasRecent) return;
            if (String(r[1]).trim() !== person) return;
            if (String(r[5]).trim() !== 'Done') return;
            var finished = r[8]; // Date Finished
            if (!finished) return;
            var d = new Date(finished);
            if (!isNaN(d.getTime()) && d >= cutoff) hasRecent = true;
          });
      }
    }

    if (!hasRecent) {
      var key = 'growth_learning_gap_' + person.toLowerCase() + '_' + yearQ;
      if (flagKeyExists_(key)) return;
      addFlag_(
        'Growth',
        person + ' — no books or courses completed in 90 days',
        'Low',
        key,
        person + ' hasn\'t finished a book or course in the last 90 days. ' +
        'Head to Growth → Personal Development to log what you\'re reading or learning.'
      );
    }
  });

  Logger.log('checkLearningGap_: scan complete.');
}

// ---- Skill atrophy check ---------------------------------------------------

/**
 * Flags any skill whose Last Practiced date is 60+ days ago.
 * Key: growth_skill_atrophy_{id}_{YYYY}  — once per skill per year.
 */
function checkSkillAtrophy_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.SKILLS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var today   = new Date();
  today.setHours(0, 0, 0, 0);
  var yearKey = today.getFullYear();
  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, SKILL_HEADERS.length).getValues();

  data.forEach(function(row) {
    var id           = String(row[0] || '').trim();
    var person       = String(row[1] || '').trim();
    var skill        = String(row[2] || '').trim();
    var lastPracticed = row[6]; // Last Practiced

    if (!id || !skill || !lastPracticed) return;

    var lp = new Date(lastPracticed);
    lp.setHours(0, 0, 0, 0);
    if (isNaN(lp.getTime())) return;

    var daysAgo = Math.round((today - lp) / 86400000);
    if (daysAgo < 60) return;

    var key = 'growth_skill_atrophy_' + id + '_' + yearKey;
    if (flagKeyExists_(key)) return;

    addFlag_(
      'Growth',
      person + ' — skill atrophy: ' + skill,
      'Low',
      key,
      'You last practiced "' + skill + '" ' + daysAgo + ' days ago. ' +
      'Even a short session keeps the skill warm — head to Growth → Skill Building to log a practice.'
    );
  });

  Logger.log('checkSkillAtrophy_: scan complete.');
}
