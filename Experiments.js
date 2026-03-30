// ============================================================
// VERA — Experiments.js
// Personal experiment tracker intelligence (Issue #130)
//
// checkExperiments_()  — called from nightlyRun()
//   1. Flags Active experiments whose End Date has passed
//   2. Runs the experiment suggestion engine (weekly cadence,
//      never repeats the same suggestion)
// ============================================================

/**
 * Nightly intelligence for the Experiments tracker.
 * Called from nightlyRun() — wrapped in try/catch there.
 */
function checkExperiments_() {
  checkExperimentEndDates_();
  suggestExperiment_();
}

// ---- End-date flag check ---------------------------------------------------

/**
 * Scans Active experiments with a set End Date.
 * - Day 0 (end date reached): Low flag
 * - Day +3 (still Active):    Medium flag — fires once, then stops
 */
function checkExperimentEndDates_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.EXPERIMENTS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var tz      = Session.getScriptTimeZone();
  var today   = new Date();
  today.setHours(0, 0, 0, 0);

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, EXPERIMENT_HEADERS.length).getValues();

  data.forEach(function(row) {
    var id      = String(row[0] || '').trim();
    var title   = String(row[2] || '').trim();
    var endDate = row[6]; // End Date col
    var status  = String(row[7] || '').trim();

    if (!id || !title || !endDate || status !== 'Active') return;

    var end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    if (isNaN(end.getTime())) return;

    var daysOver = Math.round((today - end) / 86400000);
    if (daysOver < 0) return; // Not over yet

    var key0 = 'exp_ended_0_' + id;
    var key3 = 'exp_ended_3_' + id;

    if (daysOver === 0 && !flagKeyExists_(key0)) {
      addFlag_(
        'Experiments',
        'Experiment ended: "' + title + '"',
        'Low',
        key0,
        'Your experiment "' + title + '" reached its end date today. ' +
        'Head to Explore → Experiments to record the outcome and your verdict.'
      );
    } else if (daysOver >= 3 && !flagKeyExists_(key3) && !flagKeyExists_(key0 + '_resolved')) {
      addFlag_(
        'Experiments',
        'Experiment outcome still uncaptured: "' + title + '"',
        'Medium',
        key3,
        'Your experiment "' + title + '" ended ' + daysOver + ' days ago but is still marked Active. ' +
        'Take a moment to record the outcome — even a single sentence is enough.'
      );
    }
  });

  Logger.log('checkExperimentEndDates_: scan complete.');
}

/**
 * Returns true if a flag with the given key already exists (unresolved or resolved).
 */
function flagKeyExists_(key) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var keys = sheet.getRange(2, 10, sheet.getLastRow() - 1, 1).getValues(); // col 10 = Key
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) return true;
  }
  return false;
}

// ---- Experiment suggestion engine ------------------------------------------

/**
 * Once per week, suggests one new personal experiment based on the user's
 * interests, active goals, and existing experiments.
 *
 * Uses two cooldown keys:
 *   exp_suggest_weekly  — prevents more than one suggestion per 7 days
 *   exp_suggest_[slug]  — prevents the same suggestion from ever repeating
 */
function suggestExperiment_() {
  // Weekly cadence gate
  if (wasRecentlySent_('exp_suggest_weekly', 7 * 24 * 60)) {
    Logger.log('suggestExperiment_: weekly cooldown active, skipping.');
    return;
  }

  var ss = getSpreadsheet();

  // Collect context
  var interests = [];
  try { interests = getSharedInterestLedger_().slice(0, 20); } catch(e) {}

  var goals = [];
  try { goals = getGoals_().filter(function(g) {
    var s = String(g.status || '').toLowerCase();
    return s !== 'done' && s !== 'archived';
  }).slice(0, 8); } catch(e) {}

  // Collect past experiment titles + all previously suggested slugs from Reminders Memory
  var pastTitles = [];
  var expSheet = ss.getSheetByName(TABS.EXPERIMENTS);
  if (expSheet && expSheet.getLastRow() >= 2) {
    expSheet.getRange(2, 3, expSheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (r[0]) pastTitles.push(String(r[0]).trim()); });
  }

  var memSheet = ss.getSheetByName(TABS.REMINDERS_MEMORY);
  var pastSuggestions = [];
  if (memSheet && memSheet.getLastRow() >= 2) {
    var memData = memSheet.getRange(2, 1, memSheet.getLastRow() - 1, 3).getValues();
    memData.forEach(function(r) {
      if (String(r[0]).indexOf('exp_suggest_') === 0 && String(r[0]) !== 'exp_suggest_weekly') {
        pastSuggestions.push(String(r[2] || '').trim()); // Message col = suggestion title
      }
    });
  }

  var interestText = interests.length
    ? interests.map(function(i) { return '- ' + i.interest + (i.category ? ' [' + i.category + ']' : ''); }).join('\n')
    : '(none logged)';

  var goalText = goals.length
    ? goals.map(function(g) { return '- ' + g.title + (g.category ? ' (' + g.category + ')' : ''); }).join('\n')
    : '(none active)';

  var pastText = pastTitles.length
    ? pastTitles.map(function(t) { return '- ' + t; }).join('\n')
    : '(none yet)';

  var avoidText = pastSuggestions.length
    ? pastSuggestions.map(function(t) { return '- ' + t; }).join('\n')
    : '(none)';

  var prompt =
    'You are VERA, an AI chief of staff. Suggest ONE small, low-stakes personal experiment ' +
    'that would be genuinely interesting to run based on this person\'s interests and goals.\n\n' +
    'INTERESTS:\n' + interestText + '\n\n' +
    'ACTIVE GOALS:\n' + goalText + '\n\n' +
    'EXPERIMENTS ALREADY RUNNING OR COMPLETED:\n' + pastText + '\n\n' +
    'SUGGESTIONS ALREADY MADE (never repeat these):\n' + avoidText + '\n\n' +
    'Rules:\n' +
    '- One experiment only. Be specific and concrete — not "eat healthier" but "no added sugar Mon–Fri for 2 weeks".\n' +
    '- Should be completable in 1–4 weeks, or clearly open-ended.\n' +
    '- Do not repeat anything from the "already running/completed" or "already suggested" lists.\n' +
    '- Return JSON: {"title":"...","category":"...","hypothesis":"...","duration":"...","reason":"..."}\n' +
    '- category: one of Health / Fitness / Diet / Sleep / Productivity / Learning / Mental / Finance / Other\n' +
    '- duration: plain English e.g. "2 weeks", "30 days", or "ongoing"\n' +
    '- reason: 1 sentence why this would be valuable given their context';

  var result = callClaudeJson_(prompt, []);
  if (!result || !result.title) {
    Logger.log('suggestExperiment_: no valid suggestion returned.');
    return;
  }

  // Build slug from title for dedup key
  var slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 40);
  var slugKey = 'exp_suggest_' + slug;

  // Check if this specific suggestion was ever made
  if (wasRecentlySent_(slugKey, 999999)) {
    Logger.log('suggestExperiment_: slug "' + slug + '" already suggested, skipping.');
    return;
  }

  var flagReason =
    'Suggested experiment: "' + result.title + '" (' + (result.duration || 'duration TBD') + '). ' +
    (result.hypothesis ? 'Hypothesis: ' + result.hypothesis + '. ' : '') +
    'Why now: ' + (result.reason || '') + '. ' +
    'Tell VERA "add this experiment" to start tracking it.';

  addFlag_(
    'Experiments',
    'Experiment idea: ' + result.title,
    'Low',
    'exp_suggest_' + new Date().getTime(), // unique flag key each time
    flagReason
  );

  // Record in Reminders Memory — title stored as message for future dedup
  markSent_(slugKey, result.title);
  markSent_('exp_suggest_weekly', result.title);

  Logger.log('suggestExperiment_: suggested "' + result.title + '"');
}
