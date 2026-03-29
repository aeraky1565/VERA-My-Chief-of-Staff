// ============================================================
// FinancialGoals.js — Issue #127: What-If Scenario Planner
// ============================================================

var LIFE_PLAN_DOC_ID = '1rtFqqjbix9sDAMt2-7j1QLwW7WcqSQLYCuNDaWf9dvU';

// ---- Life Plan Doc Reader --------------------------------------------------

function readLifePlanDoc_() {
  var docId = PropertiesService.getScriptProperties().getProperty('LIFE_PLAN_DOC_ID') || LIFE_PLAN_DOC_ID;
  try {
    var doc  = DocumentApp.openById(docId);
    var body = doc.getBody().getText();
    return parseLifePlanText_(body);
  } catch (err) {
    Logger.log('readLifePlanDoc_ error: ' + err.message);
    return { goals: [], accounts: {}, raw: '' };
  }
}

function parseLifePlanText_(text) {
  // Extract goals table from section 1
  var goals = [];
  var goalPattern = /Emergency Fund|House Down Payment|Travel Fund|Wedding|Children Future|Retirement/gi;
  // Try to find a markdown or plain-text table between goal section headers
  var section1Match = text.match(/1\.\s*ESTABLISH SHARED GOALS([\s\S]*?)(?=2\.|$)/i);
  if (section1Match) {
    var sec = section1Match[1];
    var rows = sec.split('\n').filter(function(l) { return l.trim().length > 0; });
    rows.forEach(function(row) {
      var m = row.match(/([A-Za-z ]+?)\s*[\|\t]\s*\$?([\d,KkMm\.]+)\s*[\|\t]/);
      if (m) {
        goals.push({ name: m[1].trim(), targetAmount: parseMoney_(m[2]) });
      }
    });
  }
  // Extract account balances
  var accounts = { ahmed: {}, victoria: {} };
  var sec2 = text.match(/2\.\s*ASSESS[\s\S]*?(?=3\.|$)/i);
  if (sec2) {
    var s = sec2[0];
    // Ahmed savings
    var ahmSav = s.match(/Ahmed[\s\S]{0,200}?savings?\s*[\$:]\s*([\d,KkMm\.]+)/i);
    if (ahmSav) accounts.ahmed.savings = parseMoney_(ahmSav[1]);
    var ahmRet = s.match(/Ahmed[\s\S]{0,200}?401[kK]\s*[\$:]\s*([\d,KkMm\.]+)/i);
    if (ahmRet) accounts.ahmed.retirement = parseMoney_(ahmRet[1]);
    var vicSav = s.match(/Victoria[\s\S]{0,200}?savings?\s*[\$:]\s*([\d,KkMm\.]+)/i);
    if (vicSav) accounts.victoria.savings = parseMoney_(vicSav[1]);
    var vicRet = s.match(/Victoria[\s\S]{0,200}?401[kK]\s*[\$:]\s*([\d,KkMm\.]+)/i);
    if (vicRet) accounts.victoria.retirement = parseMoney_(vicRet[1]);
  }
  return { goals: goals, accounts: accounts };
}

function parseMoney_(str) {
  if (!str) return 0;
  str = String(str).replace(/[$,\s]/g, '').toUpperCase();
  if (str.endsWith('K')) return parseFloat(str) * 1000;
  if (str.endsWith('M')) return parseFloat(str) * 1000000;
  return parseFloat(str) || 0;
}

// ---- Seed goals from doc on first run ------------------------------------

function seedFinancialGoalsFromDoc_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_GOALS);
  if (!sheet) return { ok: false, error: 'Sheet not found' };
  // Only seed if empty
  if (sheet.getLastRow() > 1) return { ok: true, seeded: 0, message: 'Already has data' };

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var seeds = [
    ['FGOAL-' + today + '-01', 'Emergency Fund',     25000,  25000, '',           0,    0, 'Joint', '',              'Achieved', 'Ahmed $15K, Victoria $10K'],
    ['FGOAL-' + today + '-02', 'House Down Payment', 150000, 0,     '2026-04-01', 0,    0, 'Joint', 'Joint Savings', 'Active',   'Ahmed $75K, Victoria $75K'],
    ['FGOAL-' + today + '-03', 'Travel Fund',        5000,   0,     '',           0,    0, 'Joint', '',              'Active',   'Ahmed $2K, Victoria $2K'],
    ['FGOAL-' + today + '-04', 'Wedding - EG',       10000,  0,     '',           0,    0, 'Joint', '',              'Active',   'Ahmed $5K, Victoria $5K'],
  ];
  seeds.forEach(function(row) { sheet.appendRow(row); });
  return { ok: true, seeded: seeds.length };
}

// ---- CRUD ---------------------------------------------------------------

function getFinancialGoals_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_GOALS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var hdrs = FINANCIAL_GOAL_HEADERS;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, hdrs.length).getValues();
  return rows
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        id:                  r[0],
        name:                r[1],
        targetAmount:        Number(r[2]) || 0,
        currentAmount:       Number(r[3]) || 0,
        targetDate:          r[4] ? Utilities.formatDate(new Date(r[4]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        monthlyContribution: Number(r[5]) || 0,
        apy:                 Number(r[6]) || 0,
        owner:               r[7],
        account:             r[8],
        status:              r[9],
        notes:               r[10]
      };
    });
}

function createFinancialGoal_(fields) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_GOALS);
  var id    = 'FGOAL-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + Math.floor(Math.random() * 900 + 100);
  var row   = [
    id,
    fields.name               || '',
    Number(fields.targetAmount)        || 0,
    Number(fields.currentAmount)       || 0,
    fields.targetDate         || '',
    Number(fields.monthlyContribution) || 0,
    Number(fields.apy)                 || 0,
    fields.owner              || 'Joint',
    fields.account            || '',
    fields.status             || 'Active',
    fields.notes              || ''
  ];
  sheet.appendRow(row);
  return id;
}

function updateFinancialGoal_(id, fields) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_GOALS);
  if (!sheet) return false;
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      var row = data[i];
      if (fields.name               !== undefined) row[1]  = fields.name;
      if (fields.targetAmount       !== undefined) row[2]  = Number(fields.targetAmount);
      if (fields.currentAmount      !== undefined) row[3]  = Number(fields.currentAmount);
      if (fields.targetDate         !== undefined) row[4]  = fields.targetDate;
      if (fields.monthlyContribution!== undefined) row[5]  = Number(fields.monthlyContribution);
      if (fields.apy                !== undefined) row[6]  = Number(fields.apy);
      if (fields.owner              !== undefined) row[7]  = fields.owner;
      if (fields.account            !== undefined) row[8]  = fields.account;
      if (fields.status             !== undefined) row[9]  = fields.status;
      if (fields.notes              !== undefined) row[10] = fields.notes;
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return true;
    }
  }
  return false;
}

function deleteFinancialGoal_(id) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_GOALS);
  if (!sheet) return false;
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ---- Projection Engine --------------------------------------------------

function calculateProjection_(goal, asOfDate) {
  var now         = asOfDate || new Date();
  var remaining   = goal.targetAmount - goal.currentAmount;
  var contribution= goal.monthlyContribution;
  var apy         = goal.apy || 0;
  var targetDate  = goal.targetDate ? new Date(goal.targetDate) : null;

  if (remaining <= 0) {
    return { projectedDate: null, monthsRemaining: 0, onTrack: true, daysEarlyOrLate: targetDate ? Math.ceil((targetDate - now) / 86400000) : 0, achieved: true };
  }
  if (!contribution || contribution <= 0) {
    return { projectedDate: null, monthsRemaining: null, onTrack: false, daysEarlyOrLate: null, achieved: false, noContribution: true };
  }

  var monthsNeeded;
  if (apy > 0) {
    var r = apy / 100 / 12;
    // Binary search: solve target = current*(1+r)^t + contribution*((1+r)^t-1)/r
    var lo = 0, hi = 1200, mid;
    for (var iter = 0; iter < 80; iter++) {
      mid = (lo + hi) / 2;
      var fv = goal.currentAmount * Math.pow(1 + r, mid) + contribution * (Math.pow(1 + r, mid) - 1) / r;
      if (fv < goal.targetAmount) lo = mid; else hi = mid;
    }
    monthsNeeded = mid;
  } else {
    monthsNeeded = remaining / contribution;
  }

  var projectedDate = new Date(now.getTime() + monthsNeeded * 30.4375 * 86400000);
  var daysEarlyOrLate = targetDate ? Math.ceil((targetDate - projectedDate) / 86400000) : null;
  var onTrack = targetDate ? projectedDate <= targetDate : true;

  return {
    projectedDate:   projectedDate,
    monthsRemaining: Math.round(monthsNeeded * 10) / 10,
    onTrack:         onTrack,
    daysEarlyOrLate: daysEarlyOrLate,
    achieved:        false,
    noContribution:  false
  };
}

function simulateScenario_(goal, changeType, changeAmount) {
  changeAmount = Number(changeAmount) || 0;
  var baseline = calculateProjection_(goal);

  var modifiedGoal = JSON.parse(JSON.stringify(goal)); // deep clone
  if (changeType === 'one-time') {
    modifiedGoal.currentAmount = Math.max(0, goal.currentAmount - changeAmount);
  } else if (changeType === 'recurring') {
    modifiedGoal.monthlyContribution = Math.max(0, goal.monthlyContribution - changeAmount);
  }

  var scenario = calculateProjection_(modifiedGoal);

  var delayDays = 0;
  if (baseline.projectedDate && scenario.projectedDate) {
    delayDays = Math.round((scenario.projectedDate - baseline.projectedDate) / 86400000);
  } else if (!baseline.projectedDate && scenario.projectedDate) {
    delayDays = -999; // was unreachable, now reachable (shouldn't happen)
  } else if (baseline.projectedDate && !scenario.projectedDate) {
    delayDays = 99999; // becomes unreachable
  }

  var delayLabel = formatDelayLabel_(delayDays);
  var verdict = buildVerdict_(goal, baseline, scenario, delayDays, changeType, changeAmount);
  var atRisk   = scenario.projectedDate && goal.targetDate
                   ? new Date(scenario.projectedDate) > new Date(goal.targetDate)
                   : false;

  return {
    goal:      { id: goal.id, name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate },
    baseline:  serializeProjection_(baseline),
    scenario:  serializeProjection_(scenario),
    delayDays: delayDays,
    delayLabel: delayLabel,
    verdict:   verdict,
    atRisk:    atRisk
  };
}

function serializeProjection_(p) {
  return {
    projectedDate:   p.projectedDate ? Utilities.formatDate(p.projectedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
    monthsRemaining: p.monthsRemaining,
    onTrack:         p.onTrack,
    daysEarlyOrLate: p.daysEarlyOrLate,
    achieved:        p.achieved || false,
    noContribution:  p.noContribution || false
  };
}

function formatDelayLabel_(days) {
  if (days >= 99999) return 'Goal becomes unreachable';
  if (days <= 0)     return 'No delay';
  if (days < 14)     return '~' + days + ' days';
  if (days < 60)     return '~' + Math.round(days / 7) + ' weeks';
  return '~' + Math.round(days / 30.4375) + ' months';
}

function buildVerdict_(goal, baseline, scenario, delayDays, changeType, amount) {
  var fmtDate = function(d) {
    if (!d) return 'unknown';
    var dt = typeof d === 'string' ? new Date(d) : d;
    return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'MMM d, yyyy');
  };
  var baseDate = baseline.projectedDate ? fmtDate(baseline.projectedDate) : null;
  var scenDate = scenario.noContribution ? null : (scenario.projectedDate ? fmtDate(scenario.projectedDate) : null);

  if (scenario.noContribution) {
    return 'With this ' + (changeType === 'recurring' ? 'recurring expense' : 'purchase') + ', your monthly contribution would reach $0 — the goal becomes unreachable.';
  }
  if (delayDays <= 0) {
    return 'No impact on your timeline.';
  }
  var msg = 'Without this change, you\'re on track to reach ' + goal.name + ' by ' + baseDate + '.';
  msg += ' With a ' + (changeType === 'one-time' ? '$' + amount.toLocaleString() + ' purchase' : '$' + amount.toLocaleString() + '/month increase') + ', the new projected date is ' + scenDate + ' — a delay of ' + formatDelayLabel_(delayDays) + '.';
  if (goal.targetDate) {
    if (scenario.onTrack) {
      msg += ' Still on track before the ' + fmtDate(goal.targetDate) + ' deadline.';
    } else {
      msg += ' ⚠️ This pushes you past your ' + fmtDate(goal.targetDate) + ' deadline.';
    }
  }
  return msg;
}

function saveScenario_(goalId, label, changeType, changeAmount, notes, result) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_SCENARIOS);
  if (!sheet) return null;
  var id    = 'FSCEN-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  var now   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    id, goalId, label, changeType, changeAmount, notes,
    result.baseline.projectedDate || '',
    result.scenario.projectedDate || '',
    result.delayDays,
    now
  ]);
  return id;
}

function getFinancialScenarios_(goalId) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FINANCIAL_SCENARIOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, FINANCIAL_SCENARIO_HEADERS.length).getValues();
  return rows
    .filter(function(r) { return r[0] && (!goalId || r[1] === goalId); })
    .map(function(r) {
      return {
        id:               r[0],
        goalId:           r[1],
        label:            r[2],
        changeType:       r[3],
        changeAmount:     Number(r[4]),
        notes:            r[5],
        baselineDate:     r[6] ? Utilities.formatDate(new Date(r[6]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        scenarioDate:     r[7] ? Utilities.formatDate(new Date(r[7]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
        delayDays:        Number(r[8]),
        createdAt:        r[9]
      };
    });
}

// ---- Nightly health check -----------------------------------------------

function checkGoalHealth_() {
  var goals = getFinancialGoals_();
  var flags = [];
  var now   = new Date();

  goals.filter(function(g) { return g.status === 'Active'; }).forEach(function(g) {
    var proj = calculateProjection_(g);

    // No contribution plan
    if (proj.noContribution) {
      flags.push({
        source:  'Finance',
        flag:    g.name + ' has no monthly contribution set — add a progress plan.',
        urgency: 'Low',
        key:     'fgoal_' + g.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_needs_plan'
      });
      return;
    }

    // At risk vs target date
    if (g.targetDate && proj.projectedDate) {
      var daysLate = Math.ceil((proj.projectedDate - new Date(g.targetDate)) / 86400000);
      if (daysLate > 0) {
        var urgency = daysLate > 60 ? 'High' : daysLate > 15 ? 'Medium' : 'Low';
        flags.push({
          source:  'Finance',
          flag:    g.name + ' is projected ' + daysLate + ' days late (target: ' + g.targetDate + ', projected: ' + Utilities.formatDate(proj.projectedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') + ').',
          urgency: urgency,
          key:     'fgoal_' + g.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_at_risk'
        });
      }
    }
  });

  // Contribution squeeze check
  var activeGoals  = goals.filter(function(g) { return g.status === 'Active'; });
  var totalNeeded  = activeGoals.reduce(function(s, g) { return s + g.monthlyContribution; }, 0);
  var cfg = getConfigValues();
  var monthlyDisposable = Number(cfg['monthly_disposable_income']) || 5000;
  if (totalNeeded > 0 && monthlyDisposable < totalNeeded * 0.8) {
    flags.push({
      source:  'Finance',
      flag:    'Goal contributions ($' + totalNeeded.toLocaleString() + '/mo) exceed 80% of estimated disposable income.',
      urgency: 'Medium',
      key:     'fgoal_contribution_squeeze'
    });
  }

  return flags;
}

// ---- Public debug runner -------------------------------------------------

function debugReadLifePlanDoc() {
  var result = readLifePlanDoc_();
  Logger.log(JSON.stringify(result, null, 2));
}

function debugSeedGoals() {
  var result = seedFinancialGoalsFromDoc_();
  Logger.log(JSON.stringify(result));
}

function debugProjections() {
  var goals = getFinancialGoals_();
  goals.forEach(function(g) {
    var p = calculateProjection_(g);
    Logger.log(g.name + ' → ' + JSON.stringify(p));
  });
}
