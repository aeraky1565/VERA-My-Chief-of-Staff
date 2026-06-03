// ============================================================
// Habits.js — Year in Review habit tracker (Issue #179)
//
// Two sheets:
//   Habits    — habit definitions (name, cadence, color, active)
//   HabitLog  — one row per completion event (habitId + date)
//
// Also surfaces GymTracker data as a built-in virtual habit.
// ============================================================

// ---- Read -------------------------------------------------------------------

function getHabits_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABITS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HABITS_HEADERS.length).getValues();
  return data
    .map(function(r) {
      return {
        id:      String(r[0] || '').trim(),
        name:    String(r[1] || '').trim(),
        cadence: String(r[2] || 'Daily').trim(),
        color:   String(r[3] || '#4fc3f7').trim(),
        active:  String(r[4] || 'Yes').trim() === 'Yes',
        notes:   String(r[5] || '').trim(),
      };
    })
    .filter(function(h) { return h.id; });
}

function getHabitLog_(year) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABIT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var prefix = String(year || new Date().getFullYear());
  var data   = sheet.getRange(2, 1, sheet.getLastRow() - 1, HABIT_LOG_HEADERS.length).getValues();
  return data
    .map(function(r) {
      return {
        id:      String(r[0] || '').trim(),
        habitId: String(r[1] || '').trim(),
        date:    String(r[2] || '').trim(),
        notes:   String(r[3] || '').trim(),
      };
    })
    .filter(function(e) { return e.id && e.date.indexOf(prefix) === 0; });
}

// ---- Year Review (habits + gym) -------------------------------------------

/**
 * Returns { habits, completions } for the given year.
 * habits      — array of habit objects (user-defined + virtual gym)
 * completions — { [habitId]: { [YYYY-MM-DD]: true } }
 */
function getYearReview_(year) {
  var y = year || new Date().getFullYear();

  // User-defined habits
  var habits = getHabits_().filter(function(h) { return h.active; });

  // Virtual: Gym + Walk habits pulled from GymLog
  var gymHabit  = { id: '__gym__',  name: 'Gym',        cadence: 'Varies', color: '#26c6da', active: true, notes: '' };
  var walkHabit = { id: '__walk__', name: 'Daily Walk',  cadence: 'Daily',  color: '#66bb6a', active: true, notes: '' };
  habits.push(gymHabit);
  habits.push(walkHabit);

  // User-defined completions
  var log     = getHabitLog_(y);
  var completions = {};
  log.forEach(function(e) {
    if (!completions[e.habitId]) completions[e.habitId] = {};
    completions[e.habitId][e.date] = true;
  });

  // Gym completions from GymLog
  try {
    var ss       = getSpreadsheet();
    var gymSheet = ss.getSheetByName(TABS.GYM_LOG);
    if (gymSheet && gymSheet.getLastRow() >= 2) {
      var gymData = gymSheet.getRange(2, 1, gymSheet.getLastRow() - 1, GYM_LOG_HEADERS.length).getValues();
      completions['__gym__']  = {};
      completions['__walk__'] = {};
      gymData.forEach(function(r) {
        var title    = String(r[1] || '').trim(); // Event Title
        var dateStr  = String(r[2] || '').trim(); // Event Date
        var attended = r[3]; // Attended — checkbox (true) or text ('Yes')
        var didAttend = attended === true || String(attended).trim().toLowerCase() === 'yes';
        if (dateStr.indexOf(String(y)) === 0 && didAttend) {
          if (title.toLowerCase().indexOf('walk') !== -1) {
            completions['__walk__'][dateStr] = true;
          } else {
            completions['__gym__'][dateStr] = true;
          }
        }
      });
    }
  } catch (gErr) {
    Logger.log('Habits: gym log read error — ' + gErr.message);
  }

  return { habits: habits, completions: completions, year: y };
}

// ---- Add / Update / Delete habits ------------------------------------------

function addHabit_(name, cadence, color, notes) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABITS);
  if (!sheet) throw new Error('Habits tab not found. Run addHabitsTab() first.');

  var today   = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  var existing = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
        .filter(function(r) { return String(r[0]).indexOf('HAB-' + dateStr) === 0; }).length
    : 0;
  var id = 'HAB-' + dateStr + '-' + String(existing + 1).padStart(2, '0');

  sheet.appendRow([id, name || '', cadence || 'Daily', color || '#4fc3f7', 'Yes', notes || '']);
  return { ok: true, id: id };
}

function updateHabit_(id, fields) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABITS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Habits tab not found or empty.');
  var colMap = { Name: 2, Cadence: 3, Color: 4, Active: 5, Notes: 6 };
  var idData  = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < idData.length; i++) {
    if (String(idData[i][0]).trim() === id) {
      Object.keys(fields).forEach(function(f) {
        if (colMap[f]) sheet.getRange(i + 2, colMap[f]).setValue(fields[f]);
      });
      return { ok: true, id: id };
    }
  }
  throw new Error('Habit not found: ' + id);
}

function deleteHabit_(id) {
  return updateHabit_(id, { Active: 'No' });
}

// ---- Log / Unlog completions -----------------------------------------------

function logHabitCompletion_(habitId, date, notes) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABIT_LOG);
  if (!sheet) throw new Error('HabitLog tab not found. Run addHabitsTab() first.');

  // Idempotent: don't double-log same habit+date
  if (sheet.getLastRow() >= 2) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, HABIT_LOG_HEADERS.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][1]).trim() === habitId && String(existing[i][2]).trim() === date) {
        return { ok: true, id: String(existing[i][0]).trim(), alreadyLogged: true };
      }
    }
  }

  var ts  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  var id  = 'LOG-' + habitId.replace(/[^a-zA-Z0-9]/g, '') + '-' + ts;
  sheet.appendRow([id, habitId, date, notes || '']);
  return { ok: true, id: id };
}

function unlogHabitCompletion_(habitId, date) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HABIT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HABIT_LOG_HEADERS.length).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][1]).trim() === habitId && String(data[i][2]).trim() === date) {
      sheet.deleteRow(i + 2);
      return { ok: true };
    }
  }
  return { ok: true }; // nothing to remove — that's fine
}

// ---- Setup ------------------------------------------------------------------

function addHabitsTab() {
  var ss = getSpreadsheet();

  // Habits sheet
  var habits = ss.getSheetByName(TABS.HABITS);
  if (!habits) {
    habits = ss.insertSheet(TABS.HABITS);
    habits.appendRow(HABITS_HEADERS);
    habits.getRange(1, 1, 1, HABITS_HEADERS.length)
      .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
    habits.setFrozenRows(1);
    Logger.log('Habits tab created.');
  } else {
    Logger.log('Habits tab already exists.');
  }

  // HabitLog sheet
  var log = ss.getSheetByName(TABS.HABIT_LOG);
  if (!log) {
    log = ss.insertSheet(TABS.HABIT_LOG);
    log.appendRow(HABIT_LOG_HEADERS);
    log.getRange(1, 1, 1, HABIT_LOG_HEADERS.length)
      .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
    log.setFrozenRows(1);
    Logger.log('HabitLog tab created.');
  } else {
    Logger.log('HabitLog tab already exists.');
  }
}
