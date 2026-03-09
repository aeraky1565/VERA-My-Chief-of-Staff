// ============================================================
// VERA — Projects.js
// Multi-step project management with Claude-generated subtasks
// ============================================================
//
// Projects live in the "Projects" tab of the Life OS sheet.
// Schema: Project ID | Project Name | Task | Status | Priority | Due Date | Notes
//
// Projects are created via VERA chat (ACTION:create_project|...) and
// viewed/completed in the dashboard Projects tab.
// ============================================================

// ---- Column indices (0-based, matching PROJECT_HEADERS) --------------------
var PROJ_COL = {
  ID:       0,
  NAME:     1,
  TASK:     2,
  STATUS:   3,
  PRIORITY: 4,
  DUE:      5,
  NOTES:    6,
};

// ---- Create a new project --------------------------------------------------

/**
 * Writes a new project (one row per task) to the Projects tab.
 * Called by executeActions_() in Chat.js when Claude embeds a create_project ACTION.
 *
 * @param {string}   projectName  - Human-readable project name (e.g. "Europe Trip")
 * @param {string[]} taskLines    - Array of task strings from Claude, format:
 *                                  "Task description" or "Task description|priority"
 *                                  where priority is High/Medium/Low (optional)
 * @returns {{ projectId: string, count: number }}
 */
function createProject_(projectName, taskLines) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found. Run addProjectsTab() first.');

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
    .map(function(line) {
      // Optional inline priority: "Book flights|High"
      var parts    = line.split('|');
      var taskText = parts[0].trim();
      var priority = parts[1] ? parts[1].trim() : 'Medium';
      if (['High', 'Medium', 'Low'].indexOf(priority) === -1) priority = 'Medium';
      return [projectId, projectName, taskText, 'Pending', priority, '', ''];
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
 * Reads the Projects tab and returns all projects grouped by Project ID.
 * Most recently created projects first.
 *
 * @returns {Array} Array of project objects:
 *   [{
 *     projectId: 'PROJ-20260308-01',
 *     projectName: 'Europe Trip',
 *     tasks: [{
 *       task: 'Book flights', status: 'Pending', priority: 'High',
 *       dueDate: '', notes: '', rowNum: 2
 *     }, ...]
 *   }]
 */
function getProjects_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

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
        tasks:       [],
      };
      order.push(projectId);
    }

    var dueRaw = row[PROJ_COL.DUE];
    var dueStr = '';
    if (dueRaw instanceof Date) {
      dueStr = Utilities.formatDate(dueRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (dueRaw) {
      dueStr = String(dueRaw).trim();
    }

    projectMap[projectId].tasks.push({
      task:     String(row[PROJ_COL.TASK]     || '').trim(),
      status:   String(row[PROJ_COL.STATUS]   || 'Pending').trim(),
      priority: String(row[PROJ_COL.PRIORITY] || 'Medium').trim(),
      dueDate:  dueStr,
      notes:    String(row[PROJ_COL.NOTES]    || '').trim(),
      rowNum:   idx + 2, // 1-based sheet row (header = row 1, data starts at row 2)
    });
  });

  // Return newest first (highest Project ID = latest date + seq)
  order.reverse();
  return order.map(function(id) { return projectMap[id]; });
}

// ---- Complete a project task -----------------------------------------------

/**
 * Marks a single project task as Done.
 * @param {number} rowNum - The 1-based sheet row number of the task
 * @returns {{ ok: boolean }}
 */
function completeProjectTask_(rowNum) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found.');

  var rn = parseInt(rowNum, 10);
  if (isNaN(rn) || rn < 2) throw new Error('Invalid row number: ' + rowNum);

  sheet.getRange(rn, PROJ_COL.STATUS + 1).setValue('Done'); // +1: columns are 1-based
  return { ok: true, rowNum: rn, action: 'completed' };
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
      return p.projectName + ' (' + pending + ' task' + (pending === 1 ? '' : 's') + ' pending)';
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
