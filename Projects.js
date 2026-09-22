// ============================================================
// VERA — Projects.js
// Multi-step project management with Claude-generated subtasks
// ============================================================
//
// Projects live in the "Projects" tab of the Life OS sheet.
// Schema: Project ID | Project Name | Task | Status | Priority | Due Date |
//         Notes | Owner | Completed On | Target Date | Phase | Sequence | Context
//
// Projects are created via VERA chat (ACTION:create_project|...) and
// viewed/completed in the dashboard Projects tab.
//
// PROJECT-LEVEL vs TASK-LEVEL
// Owner, Target Date and Context belong to the project and are stored
// redundantly on every row (exactly as Project Name already is); each reads as
// the first non-blank cell in the group. Everything else is per task.
//
// A blank cell always means the pre-column default — 'Shared' for Owner, no
// target for Target Date, ungrouped for Phase, sheet order for Sequence — so
// nothing ever had to be backfilled.
//
// NO ROW IS EVER MOVED. rowNum is the task's identity across
// webUpdateProjectTask_, webCompleteProjectTask_ and Chat.js's
// findProjectTaskRow_, so reordering physically would invalidate every rowNum a
// client is holding. Order is the Sequence field, not the row position.
// ============================================================

// ---- Column indices (0-based, matching PROJECT_HEADERS) --------------------
var PROJ_COL = {
  ID:           0,
  NAME:         1,
  TASK:         2,
  STATUS:       3,
  PRIORITY:     4,
  DUE:          5,
  NOTES:        6,
  OWNER:        7,
  COMPLETED_ON: 8,
  TARGET_DATE:  9,
  PHASE:        10,
  SEQUENCE:     11,
  CONTEXT:      12,
};

var PROJECT_OWNERS_ = ['Shared', 'Ahmed', 'Victoria'];

// Every existing filter in the codebase is written as `status !== 'Done'`, so
// widening this list is backward compatible by construction.
//
// Blocked earns its place: without it a task waiting on someone else looks
// identical to one being neglected, and a health verdict cannot tell the
// difference between "you are behind" and "you are waiting". The reason goes in
// Notes, which the dashboard now renders.
var PROJECT_STATUSES_ = ['Pending', 'In Progress', 'Blocked', 'Done'];

/** Defaults for the two Config keys this module reads. */
var PROJECT_STALL_DAYS_DEFAULT_   = 14;
var PROJECT_AT_RISK_DAYS_DEFAULT_ = 7;

/**
 * How VERA plans a project — the shared half of the instruction.
 *
 * Two callers need this: the chat system prompt (Chat.js) and the dashboard's
 * drafting endpoint (webDraftProjectTasks_). Each adds its own OUTPUT FORMAT —
 * chat emits an ACTION line, the endpoint emits JSON — but the judgement about
 * what makes a good plan must be one text, or the two paths quietly drift into
 * giving different answers to the same question.
 */
var PROJECT_PLAN_GUIDANCE_ =
  'Generate a comprehensive, exhaustive checklist — the goal is that Ahmed misses nothing. ' +
  'Think through every phase: planning, logistics, dependencies, admin/paperwork, communications, ' +
  'day-of execution, and follow-up. Explicitly include steps people commonly overlook. ' +
  'Aim for 20–30 tasks for complex projects. Order tasks chronologically. ' +
  'Assign priorities naturally (High for time-sensitive or blocking steps, Low for nice-to-haves). ' +
  'Group tasks into phases — Planning, Logistics, Admin, Communications, Day-of, Follow-up, or ' +
  'whatever fits the project — so a 25-task list reads as sections rather than one wall. ' +
  'Use the SAME phase name for every task in a phase, and keep tasks of one phase together.';

/**
 * Coerces anything to a valid owner. Blank, unknown, or garbage → 'Shared'.
 * @param {*} v
 * @returns {string} One of PROJECT_OWNERS_
 */
function normalizeProjectOwner_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  for (var i = 0; i < PROJECT_OWNERS_.length; i++) {
    if (PROJECT_OWNERS_[i].toLowerCase() === s) return PROJECT_OWNERS_[i];
  }
  return 'Shared';
}

/**
 * Coerces anything to a valid task status. Blank or unknown → 'Pending'.
 * @param {*} v
 * @returns {string} One of PROJECT_STATUSES_
 */
function normalizeProjectStatus_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  for (var i = 0; i < PROJECT_STATUSES_.length; i++) {
    if (PROJECT_STATUSES_[i].toLowerCase() === s) return PROJECT_STATUSES_[i];
  }
  return 'Pending';
}

/** Today at midnight, so every day-count below is a whole number of days. */
function projToday_() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** yyyy-MM-dd for a Date or a cell value; '' when there is nothing to format. */
function projDateStr_(raw) {
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return raw ? String(raw).trim() : '';
}

/** Whole days from today to a date string; null when unparseable or blank. */
function projDaysUntil_(dateStr) {
  if (!dateStr) return null;
  var d = parseFlexibleDate(dateStr);   // Tasks.js — the one date parser here
  if (!d) return null;
  return Math.floor((d - projToday_()) / 86400000);
}

/**
 * Reads a Config threshold, falling back to its default. Mirrors how
 * getOpenTasks() reads task_age_threshold_days (Tasks.js).
 */
function projThreshold_(key, fallback) {
  try {
    var v = parseInt(getConfigValues()[key], 10);
    return isNaN(v) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/**
 * Widens an existing Projects tab to match PROJECT_HEADERS.
 *
 * ensureSheet() only writes headers into a BLANK sheet, so a live tab never
 * gains a newly appended column — and every read here takes a range
 * PROJECT_HEADERS.length wide, which throws outright once the constant is wider
 * than the sheet. Call this before any such range.
 *
 * Same shape as ensureImportantDatesSchema_ (WebApp.js).
 *
 * @param {Sheet} sheet
 * @returns {Sheet} the same sheet, for chaining
 */
function ensureProjectsSchema_(sheet) {
  if (!sheet) return sheet;
  var need = PROJECT_HEADERS.length;
  if (sheet.getMaxColumns() < need) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  }
  var header = sheet.getRange(1, 1, 1, need).getValues()[0];
  for (var i = 0; i < need; i++) {
    if (String(header[i]).trim() !== PROJECT_HEADERS[i]) {
      sheet.getRange(1, 1, 1, need).setValues([PROJECT_HEADERS]);
      sheet.getRange(1, 1, 1, need).setFontWeight('bold');
      break;
    }
  }
  return sheet;
}

// ---- Create a new project --------------------------------------------------

/**
 * Writes a new project (one row per task) to the Projects tab.
 * Called by executeActions_() in Chat.js when Claude embeds a create_project ACTION.
 *
 * @param {string}   projectName  - Human-readable project name (e.g. "Europe Trip")
 * @param {string[]} taskLines    - Array of task strings from Claude, format:
 *                                  "Task" | "Task|Priority" | "Task|Priority|Phase"
 *                                  where priority is High/Medium/Low. Both shorter
 *                                  forms still work, so nothing that emits the old
 *                                  two-field line breaks.
 * @param {string}   [owner]      - 'Ahmed' | 'Victoria' | 'Shared'. Anything else,
 *                                  including nothing, means 'Shared' — which is why
 *                                  chat-created projects are shared by default.
 * @param {string}   [context]    - free-text description of what the project is for.
 *                                  Project-level, written to every row.
 * @returns {{ projectId: string, count: number }}
 */
function createProject_(projectName, taskLines, owner, context) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found. Run addProjectsTab() first.');
  ensureProjectsSchema_(sheet);

  var ownerVal   = normalizeProjectOwner_(owner);
  var contextVal = String(context == null ? '' : context).trim();

  var today   = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');

  // Generate next sequential project ID for today
  var existingIds = [];
  if (sheet.getLastRow() >= 2) {
    var idData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    idData.forEach(function(r) {
      var v = String(r[0] || '').trim();
      if (v.indexOf('PROJ-' + dateStr) === 0) existingIds.push(v);
    });
  }
  var seq       = existingIds.length + 1;
  var projectId = 'PROJ-' + dateStr + '-' + String(seq).padStart(2, '0');

  var rows = taskLines
    .map(function(line) { return String(line || '').trim(); })
    .filter(function(line) { return line.length > 0; })
    .map(function(line, i) {
      // Optional inline fields: "Book flights|High|Logistics"
      var parts    = line.split('|');
      var taskText = parts[0].trim();
      var priority = parts[1] ? parts[1].trim() : 'Medium';
      var phase    = parts[2] ? parts[2].trim() : '';
      if (['High', 'Medium', 'Low'].indexOf(priority) === -1) priority = 'Medium';
      // Sequence is written from the start so a project created today never
      // depends on the row-order fallback.
      return [projectId, projectName, taskText, 'Pending', priority, '', '', ownerVal,
              '', '', phase, i + 1, contextVal];
    });

  if (rows.length === 0) {
    Logger.log('createProject_: no tasks provided for "' + projectName + '"');
    return { projectId: projectId, count: 0 };
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PROJECT_HEADERS.length).setValues(rows);

  // Subtle blue-tint background to match [AUTO] rows aesthetic
  sheet.getRange(sheet.getLastRow() - rows.length + 1, 1, rows.length, PROJECT_HEADERS.length)
    .setBackground('#f0f4ff');

  Logger.log('createProject_: created "' + projectName + '" (' + projectId + ') with ' + rows.length + ' tasks.');
  return { projectId: projectId, count: rows.length };
}

// ---- Read all projects -----------------------------------------------------

/**
 * Derives the health verdict for one project.
 *
 * THE SERVER DECIDES, THE CLIENTS RENDER. Both dashboards and the nightly check
 * read this one value rather than each re-deriving it from raw task rows, which
 * is the only way they cannot drift apart.
 *
 * Precedence, which resolves every overlap explicitly:
 *   1. overdue   — a pending task is past its due date, or the target date has
 *                  passed with work left
 *   2. at_risk   — the target date is close and most of the work is still open
 *   3. blocked   — EVERY pending task is Blocked
 *   4. stalled   — nothing completed in project_stall_days
 *   5. on_track
 *
 * blocked deliberately outranks stalled: a project you cannot move is not one
 * you are neglecting, and calling it stalled would be exactly the nagging this
 * is meant to avoid.
 *
 * @returns {{ health: string, reason: string }}
 */
function projectHealth_(p, stallDays, atRiskDays) {
  var pending = p.tasks.filter(function(t) { return t.status !== 'Done'; });
  if (pending.length === 0) return { health: 'done', reason: 'All tasks complete' };

  // 1 — overdue
  if (p.overdueCount > 0) {
    return { health: 'overdue',
             reason: p.overdueCount + ' task' + (p.overdueCount === 1 ? '' : 's') + ' overdue' };
  }
  if (p.daysUntilTarget !== null && p.daysUntilTarget < 0) {
    return { health: 'overdue',
             reason: 'Target date passed ' + Math.abs(p.daysUntilTarget) + 'd ago, '
                     + pending.length + ' task' + (pending.length === 1 ? '' : 's') + ' left' };
  }

  // 2 — at risk. "Most of the work still open" keeps this off a project that is
  // nearly finished and simply has a date coming up.
  if (p.daysUntilTarget !== null && p.daysUntilTarget <= atRiskDays && p.pct < 50) {
    return { health: 'at_risk',
             reason: 'Target in ' + p.daysUntilTarget + 'd, ' + (100 - p.pct) + '% left' };
  }

  // 3 — blocked, only when there is nothing at all to pick up
  if (p.blockedCount === pending.length) {
    return { health: 'blocked',
             reason: 'All ' + pending.length + ' remaining task'
                     + (pending.length === 1 ? ' is' : 's are') + ' blocked' };
  }

  // 4 — stalled. REQUIRES A REAL COMPLETION STAMP. Without this guard every
  // project that predates the Completed On column reads as stalled the day it
  // ships — a wall of false flags, which is how a signal gets ignored. A
  // project becomes eligible only once it has genuine activity data.
  if (p.lastActivity && p.daysSinceActivity !== null && p.daysSinceActivity >= stallDays) {
    return { health: 'stalled', reason: 'No activity for ' + p.daysSinceActivity + ' days' };
  }

  return { health: 'on_track', reason: pending.length + ' task' + (pending.length === 1 ? '' : 's') + ' to go' };
}

/**
 * Reads the Projects tab and returns all projects grouped by Project ID.
 * Most recently created projects first. Tasks are ordered by Sequence, falling
 * back to sheet-row order when a project has no sequences yet.
 *
 * @returns {Array} Array of project objects:
 *   [{
 *     projectId: 'PROJ-20260308-01', projectName: 'Europe Trip',
 *     owner: 'Shared', targetDate: '2026-11-01', context: 'Road trip across Europe…',
 *     createdOn: '2026-03-08',
 *     total: 8, done: 3, pending: 5, pct: 38,
 *     overdueCount: 1, blockedCount: 0,
 *     lastActivity: '2026-03-20', daysSinceActivity: 4, daysUntilTarget: 12,
 *     health: 'overdue', healthReason: '1 task overdue',
 *     nextTask: { … } | null,
 *     phases: ['Planning', 'Logistics'],
 *     tasks: [{ task, status, priority, dueDate, notes, phase, sequence,
 *               completedOn, isOverdue, daysUntilDue, rowNum }, …]
 *   }]
 */
function getProjects_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  ensureProjectsSchema_(sheet);

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, PROJECT_HEADERS.length).getValues();

  var projectMap = {};
  var order      = []; // preserve insertion order per project

  data.forEach(function(row, idx) {
    var projectId = String(row[PROJ_COL.ID]   || '').trim();
    if (!projectId) return;

    if (!projectMap[projectId]) {
      projectMap[projectId] = {
        projectId:   projectId,
        projectName: String(row[PROJ_COL.NAME] || '').trim(),
        owner:       'Shared',
        targetDate:  '',
        context:     '',
        tasks:       [],
      };
      order.push(projectId);
    }
    var proj = projectMap[projectId];

    // Project-level fields: the first row of the group that names one wins. A
    // project whose rows are all blank keeps the pre-column default.
    if (proj.owner === 'Shared' && String(row[PROJ_COL.OWNER] || '').trim()) {
      proj.owner = normalizeProjectOwner_(row[PROJ_COL.OWNER]);
    }
    if (!proj.targetDate) proj.targetDate = projDateStr_(row[PROJ_COL.TARGET_DATE]);
    if (!proj.context)    proj.context    = String(row[PROJ_COL.CONTEXT] || '').trim();

    var dueStr = projDateStr_(row[PROJ_COL.DUE]);
    var seqRaw = parseInt(row[PROJ_COL.SEQUENCE], 10);

    proj.tasks.push({
      task:        String(row[PROJ_COL.TASK]     || '').trim(),
      status:      normalizeProjectStatus_(row[PROJ_COL.STATUS]),
      priority:    String(row[PROJ_COL.PRIORITY] || 'Medium').trim(),
      dueDate:     dueStr,
      notes:       String(row[PROJ_COL.NOTES]    || '').trim(),
      phase:       String(row[PROJ_COL.PHASE]    || '').trim(),
      completedOn: projDateStr_(row[PROJ_COL.COMPLETED_ON]),
      sequence:    isNaN(seqRaw) ? null : seqRaw,
      rowNum:      idx + 2, // 1-based sheet row (header = row 1, data starts at row 2)
    });
  });

  var stallDays  = projThreshold_('project_stall_days',   PROJECT_STALL_DAYS_DEFAULT_);
  var atRiskDays = projThreshold_('project_at_risk_days', PROJECT_AT_RISK_DAYS_DEFAULT_);
  order.forEach(function(id) { decorateProject_(projectMap[id], stallDays, atRiskDays); });

  // Return newest first (highest Project ID = latest date + seq)
  order.reverse();
  return order.map(function(id) { return projectMap[id]; });
}

/**
 * Fills in every derived field on one project, in place.
 *
 * Split out of getProjects_ so the ordering, counting and verdict are one
 * readable unit rather than a tail on the row loop.
 */
function decorateProject_(p, stallDays, atRiskDays) {
  // ---- Order ---------------------------------------------------------------
  // Sequence when the project has any, sheet-row order when it has none. A
  // project whose rows are all blank therefore reads exactly as it did before
  // the column existed, and the first reorder writes the whole project at once.
  var anySeq = p.tasks.some(function(t) { return t.sequence !== null; });
  if (anySeq) {
    p.tasks.sort(function(a, b) {
      // A row with no sequence sorts after every row that has one, keeping its
      // relative position, so a half-sequenced project is still deterministic.
      var av = a.sequence === null ? Infinity : a.sequence;
      var bv = b.sequence === null ? Infinity : b.sequence;
      if (av !== bv) return av - bv;
      return a.rowNum - b.rowNum;
    });
  }

  // ---- Per-task derivations ------------------------------------------------
  p.tasks.forEach(function(t) {
    t.daysUntilDue = t.status === 'Done' ? null : projDaysUntil_(t.dueDate);
    t.isOverdue    = t.daysUntilDue !== null && t.daysUntilDue < 0;
  });

  // ---- Counts --------------------------------------------------------------
  var pending    = p.tasks.filter(function(t) { return t.status !== 'Done'; });
  p.total        = p.tasks.length;
  p.done         = p.total - pending.length;
  p.pending      = pending.length;
  p.pct          = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
  p.overdueCount = pending.filter(function(t) { return t.isOverdue; }).length;
  p.blockedCount = pending.filter(function(t) { return t.status === 'Blocked'; }).length;

  // ---- Dates ---------------------------------------------------------------
  // createdOn comes free from the PROJ-YYYYMMDD-NN id — no column needed.
  var m = /^PROJ-(\d{4})(\d{2})(\d{2})/.exec(p.projectId);
  p.createdOn = m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';

  var stamps = p.tasks.map(function(t) { return t.completedOn; })
                      .filter(Boolean).sort();
  p.lastActivity      = stamps.length ? stamps[stamps.length - 1] : '';
  var since           = p.lastActivity ? projDaysUntil_(p.lastActivity) : null;
  p.daysSinceActivity = since === null ? null : Math.max(0, -since);
  p.daysUntilTarget   = projDaysUntil_(p.targetDate);

  // ---- Next up -------------------------------------------------------------
  // Something already started beats something not started; Blocked is never
  // offered, because it is not something you can pick up.
  p.nextTask = null;
  for (var i = 0; i < p.tasks.length && !p.nextTask; i++) {
    if (p.tasks[i].status === 'In Progress') p.nextTask = p.tasks[i];
  }
  for (var j = 0; j < p.tasks.length && !p.nextTask; j++) {
    if (p.tasks[j].status === 'Pending') p.nextTask = p.tasks[j];
  }

  // ---- Phases, in the order they first appear ------------------------------
  p.phases = [];
  p.tasks.forEach(function(t) {
    if (t.phase && p.phases.indexOf(t.phase) === -1) p.phases.push(t.phase);
  });

  // ---- The verdict ---------------------------------------------------------
  var v = projectHealth_(p, stallDays, atRiskDays);
  p.health       = v.health;
  p.healthReason = v.reason;
}

// ---- Complete a project task -----------------------------------------------

/**
 * Sets one task's status and keeps Completed On in lockstep with it.
 *
 * Every status change goes through here — the dashboard checkbox, the status
 * picker and chat all reach it — so the stamp can never drift from the status
 * it is supposed to describe.
 *
 * @param {Sheet}  sheet
 * @param {number} rn     - 1-based sheet row
 * @param {string} status - anything; normalized
 * @returns {string} the status actually written
 */
function setProjectTaskStatus_(sheet, rn, status) {
  var val = normalizeProjectStatus_(status);
  sheet.getRange(rn, PROJ_COL.STATUS + 1).setValue(val); // +1: columns are 1-based

  if (val === 'Done') {
    // Do not restamp a task that was already Done — the original completion
    // date is the one that matters for activity and velocity.
    var existing = String(sheet.getRange(rn, PROJ_COL.COMPLETED_ON + 1).getValue() || '').trim();
    if (!existing) {
      sheet.getRange(rn, PROJ_COL.COMPLETED_ON + 1)
        .setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    }
  } else {
    // Moved back out of Done: the stamp is now a lie, so clear it.
    sheet.getRange(rn, PROJ_COL.COMPLETED_ON + 1).setValue('');
  }
  return val;
}

/**
 * Marks a single project task as Done.
 * @param {number} rowNum - The 1-based sheet row number of the task
 * @returns {{ ok: boolean }}
 */
function completeProjectTask_(rowNum) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found.');
  ensureProjectsSchema_(sheet);

  var rn = parseInt(rowNum, 10);
  if (isNaN(rn) || rn < 2) throw new Error('Invalid row number: ' + rowNum);

  setProjectTaskStatus_(sheet, rn, 'Done');
  return { ok: true, rowNum: rn, action: 'completed' };
}

/**
 * Writes one or more PROJECT-LEVEL fields onto every row of a project.
 *
 * Owner and Target Date both live on every row, so a partial write would leave
 * the project's value depending on which row happened to be read first. One
 * shared scan-and-write keeps set_project_owner and set_project_target honest
 * and identical, and each column is written with a single setValues rather than
 * one setValue per row.
 *
 * @param {string} projectId
 * @param {Object} fields - { OWNER: 'Ahmed', TARGET_DATE: '2026-11-01' }, keyed
 *                          by PROJ_COL name
 * @returns {{ ok: boolean, projectId: string, rowsUpdated: number }}
 */
function setProjectFields_(projectId, fields) {
  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Projects tab not found or empty');
  ensureProjectsSchema_(sheet);

  var n   = sheet.getLastRow() - 1;
  var ids = sheet.getRange(2, PROJ_COL.ID + 1, n, 1).getValues();

  var hit = [];
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === projectId) hit.push(i);
  }
  if (!hit.length) throw new Error('Project not found: ' + projectId);

  Object.keys(fields).forEach(function(colName) {
    var col     = PROJ_COL[colName];
    var current = sheet.getRange(2, col + 1, n, 1).getValues();
    hit.forEach(function(i) { current[i][0] = fields[colName]; });
    sheet.getRange(2, col + 1, n, 1).setValues(current);
  });

  return { ok: true, projectId: projectId, rowsUpdated: hit.length };
}

/**
 * Rewrites the Sequence column so a project's tasks read in the given order.
 *
 * Takes row numbers rather than indices because rowNum is the task identity the
 * client already holds, and because rows are never moved — only this column
 * changes. One read and one write regardless of how many tasks there are.
 *
 * @param {string}   projectId
 * @param {number[]} rowOrder - the project's rowNums, in the order wanted
 */
function reorderProjectTasks_(projectId, rowOrder) {
  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Projects tab not found or empty');
  ensureProjectsSchema_(sheet);

  var n    = sheet.getLastRow() - 1;
  var ids  = sheet.getRange(2, PROJ_COL.ID + 1, n, 1).getValues();
  var mine = {};
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === projectId) mine[i + 2] = true;
  }
  if (!Object.keys(mine).length) throw new Error('Project not found: ' + projectId);

  // A row the client named that is not in this project would silently reorder
  // somebody else's task, so refuse the whole call rather than write part of it.
  var wanted = (rowOrder || []).map(function(r) { return parseInt(r, 10); });
  for (var j = 0; j < wanted.length; j++) {
    if (!mine[wanted[j]]) throw new Error('Row ' + wanted[j] + ' is not part of ' + projectId);
  }

  var seq = sheet.getRange(2, PROJ_COL.SEQUENCE + 1, n, 1).getValues();
  wanted.forEach(function(rn, idx) { seq[rn - 2][0] = idx + 1; });

  // Any row of this project the client did not mention keeps a defined place
  // after the ones it did, so the result is never half-sequenced.
  var next = wanted.length + 1;
  Object.keys(mine).forEach(function(rnStr) {
    var rn = parseInt(rnStr, 10);
    if (wanted.indexOf(rn) === -1) seq[rn - 2][0] = next++;
  });

  sheet.getRange(2, PROJ_COL.SEQUENCE + 1, n, 1).setValues(seq);
  return { ok: true, projectId: projectId, ordered: wanted.length };
}

// ---- Brief summary for Claude chat context ---------------------------------

/**
 * Returns a one-line summary of active projects for inclusion in Claude's system prompt.
 * Example: "Active projects (2): Europe Trip (8 tasks pending), Moving Out (3 tasks pending)"
 * Returns empty string if no projects exist.
 */
function getProjectsSummaryForContext_() {
  try {
    var projects = getProjects_();
    if (!projects || projects.length === 0) return '';

    var active = projects.filter(function(p) {
      return p.tasks.some(function(t) { return t.status !== 'Done'; });
    });
    if (active.length === 0) return '';

    var parts = active.map(function(p) {
      var pending = p.tasks.filter(function(t) { return t.status !== 'Done'; }).length;
      var line = p.projectName + ' (' + pending + ' task' + (pending === 1 ? '' : 's') + ' pending';
      // What the project is FOR — the thing this summary could never say before.
      // Truncated, because the system prompt has many sections competing for room.
      if (p.context) {
        var c = p.context.replace(/\s+/g, ' ').trim();
        line += ' — ' + (c.length > 120 ? c.slice(0, 117) + '…' : c);
      }
      return line + ')';
    });

    return 'Active projects (' + active.length + '): ' + parts.join(', ');
  } catch (e) {
    Logger.log('getProjectsSummaryForContext_ error: ' + e.message);
    return '';
  }
}

// ---- Debug helpers ---------------------------------------------------------

/**
 * Run from the Apps Script editor to verify the Projects backend works end-to-end.
 * Check the Execution Log for results and look for any errors.
 */
function testCreateProject() {
  Logger.log('=== testCreateProject ===');

  // 1. Confirm Projects tab exists
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet) {
    Logger.log('❌ Projects tab MISSING — run addProjectsTab() first.');
    return;
  }
  Logger.log('✅ Projects tab found. Rows before: ' + sheet.getLastRow());

  // 2. Create a test project
  var result = createProject_('Test Project', [
    'Task A|High',
    'Task B|Medium',
    'Task C|Low',
  ]);
  Logger.log('✅ createProject_ returned: ' + JSON.stringify(result));

  // 3. Read it back
  var projects = getProjects_();
  Logger.log('Projects now: ' + projects.length);
  projects.forEach(function(p) {
    Logger.log('  ' + p.projectId + ' — ' + p.projectName + ' (' + p.tasks.length + ' tasks)');
  });

  Logger.log('=== testCreateProject complete ===');
}
