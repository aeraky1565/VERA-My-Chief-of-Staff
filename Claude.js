// ============================================================
// VERA — Claude.js
// Builds the intelligence prompt and calls the Anthropic API
// ============================================================

// ---- API Key ---------------------------------------------------------------
// The API key is stored in Script Properties, NOT in code.
// To set it: Apps Script editor → Project Settings → Script Properties
// Key: CLAUDE_API_KEY  |  Value: your key starting with "sk-ant-..."
// ----------------------------------------------------------------------------

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-sonnet-4-6';

/**
 * Retrieves the Anthropic API key from Script Properties.
 * Throws a helpful error if it hasn't been set yet.
 */
function getApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!key || key.trim() === '') {
    throw new Error(
      'CLAUDE_API_KEY is not set. ' +
      'Go to: Apps Script editor → Project Settings (gear icon) → Script Properties → Add property. ' +
      'Key: CLAUDE_API_KEY  |  Value: your Anthropic API key.'
    );
  }
  return key.trim();
}

// ============================================================
// BUILD PROMPT
// ============================================================

/**
 * Packages calendar events, tasks, and summaries into a structured
 * prompt for Claude to reason over.
 *
 * @param {Array} events    - From getUpcomingEvents()
 * @param {Array} tasks     - From getOpenTasks()
 * @param {Array} summaries - From getSummaries()
 * @returns {string} The full prompt string
 */
function buildPrompt(events, tasks, summaries, ptoStats, ledger, suppressedPatterns) {
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  // ---- Format: Calendar Events -------------------------------------------
  let eventsSection;
  if (events.length === 0) {
    eventsSection = 'No upcoming calendar events in the next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days.';
  } else {
    eventsSection = events.map(function(e) {
      let dayLabel;
      if (e.daysUntil === 0)      dayLabel = 'TODAY';
      else if (e.daysUntil === 1) dayLabel = 'TOMORROW';
      else                        dayLabel = 'in ' + e.daysUntil + ' days';

      const timeStr = e.isAllDay ? 'all day' : e.start.split(' ')[1];
      const dateStr = e.start.split(' ')[0];

      let line = '- ' + e.title + ' | ' + dateStr + ' ' + timeStr + ' [' + dayLabel + ']';
      if (e.location) line += ' @ ' + e.location;

      // Calendar label (from Config tab, or auto-detected fallback)
      line += ' (' + (e.calLabel || e.calendarName) + ')';

      // RSVP status — flag unresponded invites
      if (e.myStatus && e.myStatus !== 'organizer' && e.myStatus !== 'accepted') {
        line += ' [RSVP: ' + e.myStatus + ']';
      }

      // Event color tag — user applies these manually to categorize events
      if (e.eventColor) {
        line += ' [tagged: ' + e.eventColor + ']';
      }

      return line;
    }).join('\n');
  }

  // ---- Format: Open Tasks -------------------------------------------------
  let tasksSection;
  if (tasks.length === 0) {
    tasksSection = 'No open tasks.';
  } else {
    tasksSection = tasks.map(function(t) {
      let line = '- [' + t.status + '] ' + t.task;

      if (t.isOverdue && t.daysUntilDue !== null) {
        line += ' ⚠ OVERDUE by ' + Math.abs(t.daysUntilDue) + ' day' + (Math.abs(t.daysUntilDue) === 1 ? '' : 's');
      } else if (t.daysUntilDue !== null && t.daysUntilDue <= 3) {
        line += ' (due in ' + t.daysUntilDue + ' day' + (t.daysUntilDue === 1 ? '' : 's') + ')';
      } else if (t.dueDate) {
        line += ' (due: ' + t.dueDate + ')';
      }

      if (t.isNeglected) {
        line += ' [NEGLECTED: ' + t.ageInDays + ' days old]';
      }

      if (t.recurring) {
        line += ' [recurring: ' + t.recurring + ']';
      }

      if (t.notes) {
        line += ' — ' + t.notes;
      }

      return line;
    }).join('\n');
  }

  // ---- Format: Summaries --------------------------------------------------
  let summariesSection;
  if (summaries.length === 0) {
    summariesSection = 'No summaries available yet.';
  } else {
    summariesSection = summaries.map(function(s) {
      let line = '- [' + s.source + '] ' + s.metric + ': ' + s.value;
      if (s.asOf) line += ' (as of ' + s.asOf + ')';
      return line;
    }).join('\n');
  }

  // ---- Format: Shared Interest Ledger ------------------------------------
  const ledgerEntries = Array.isArray(ledger) ? ledger : [];
  let ledgerSection;
  if (ledgerEntries.length === 0) {
    ledgerSection = 'No interests logged yet.';
  } else {
    ledgerSection = ledgerEntries.slice(0, 20).map(function(i) {
      return '- ' + i.person + ': ' + i.interest + ' [' + i.category + ', logged ' + i.date + ']';
    }).join('\n');
  }

  // ---- Format: Bills (Issue #24 intelligence) --------------------------------
  var billsForPrompt = [];
  var billsSectionStr = '';
  try {
    var billsSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
    if (billsSheet && billsSheet.getLastRow() >= 2) {
      var tz_b     = Session.getScriptTimeZone();
      var currMonth = Utilities.formatDate(new Date(), tz_b, 'yyyy-MM');
      var billsData = billsSheet.getRange(2, 1, billsSheet.getLastRow() - 1, BILL_HEADERS.length).getValues();
      billsData.forEach(function(r) {
        var name = String(r[0] || '').trim();
        if (!name) return;
        var paidVal = String(r[6] || '').trim();
        billsForPrompt.push({
          bill:      name,
          amount:    r[1] !== '' ? Number(r[1]) : null,
          dueDay:    r[2] !== '' ? Number(r[2]) : null,
          frequency: String(r[3] || 'Monthly').trim(),
          paid:      paidVal === currMonth,
          notes:     String(r[7] || '').trim(),
        });
      });
    }
    billsSectionStr = billsForPrompt.length === 0
      ? 'No bills tracked.'
      : billsForPrompt.map(function(b) {
          var line = '- ' + b.bill;
          if (b.amount !== null) line += ' ($' + b.amount + ')';
          if (b.dueDay !== null) line += ' due day ' + b.dueDay;
          line += b.paid ? ' [PAID this month]' : ' [UNPAID]';
          if (b.frequency !== 'Monthly') line += ' [' + b.frequency + ']';
          return line;
        }).join('\n');
  } catch (billErr) {
    billsSectionStr = '(unavailable)';
  }

  // ---- Format: Home Items (Issue #24 intelligence) ---------------------------
  var homeItemsForPrompt = [];
  var homeItemsSectionStr = '';
  try {
    var homeSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
    if (homeSheet && homeSheet.getLastRow() >= 2) {
      var today_h = new Date(); today_h.setHours(0, 0, 0, 0);
      var homeData = homeSheet.getRange(2, 1, homeSheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
      homeData.forEach(function(r) {
        var item = String(r[0] || '').trim();
        if (!item) return;
        var serviceDays = null;
        if (r[5]) { try { var nd = new Date(r[5]); serviceDays = Math.round((nd - today_h) / 86400000); } catch(e2) {} }
        homeItemsForPrompt.push({
          item:           item,
          category:       String(r[1] || '').trim(),
          nextService:    r[5] ? String(r[5]).trim() : '',
          serviceDays:    serviceDays,
          intervalMonths: r[6] !== '' ? Number(r[6]) : null,
        });
      });
    }
    homeItemsSectionStr = homeItemsForPrompt.length === 0
      ? 'No home items tracked.'
      : homeItemsForPrompt.map(function(h) {
          var line = '- ' + h.item;
          if (h.category) line += ' [' + h.category + ']';
          if (h.serviceDays !== null) {
            if (h.serviceDays < 0)     line += ' ⚠ SERVICE OVERDUE by ' + Math.abs(h.serviceDays) + ' days';
            else if (h.serviceDays <= 14) line += ' (service in ' + h.serviceDays + ' days)';
            else                       line += ' (service in ~' + h.serviceDays + ' days)';
          } else if (h.nextService) {
            line += ' (next service: ' + h.nextService + ')';
          } else {
            line += ' (no service date set)';
          }
          return line;
        }).join('\n');
  } catch (homeErr) {
    homeItemsSectionStr = '(unavailable)';
  }

  // ---- Format: Goals (Issue #24 intelligence) --------------------------------
  var goalsForPrompt = [];
  var goalsSectionStr = '';
  try {
    goalsForPrompt = getGoals_();
    var currentYear = new Date().getFullYear();
    var currentMonth = new Date().getMonth(); // 0-indexed
    goalsSectionStr = goalsForPrompt.length === 0
      ? 'No goals tracked.'
      : goalsForPrompt.filter(function(g) { return g.year === currentYear; })
          .map(function(g) {
            // Estimate creation month from ID (format GOAL-YYYYMMDD-NN)
            var createdPriorMonth = false;
            var idMatch = g.id.match(/GOAL-(\d{4})(\d{2})\d{2}/);
            if (idMatch) {
              var goalYear  = parseInt(idMatch[1], 10);
              var goalMonth = parseInt(idMatch[2], 10) - 1; // 0-indexed
              createdPriorMonth = (goalYear === currentYear && goalMonth < currentMonth) ||
                                  (goalYear < currentYear);
            }
            var line = '- [' + g.status + '] ' + g.title;
            if (g.category) line += ' [' + g.category + ']';
            if (g.progress > 0) line += ' (' + g.progress + '% done)';
            if (createdPriorMonth && (g.status === 'Doing' || g.status === 'To Do'))
              line += ' ⚠ IN PROGRESS SINCE PRIOR MONTH';
            return line;
          }).join('\n') || 'No current-year goals.';
  } catch (goalErr) {
    goalsSectionStr = '(unavailable)';
  }

  // ---- Format: Projects (Issue #24 intelligence) ----------------------------
  var projectsForPrompt = [];
  var projectsSectionStr = '';
  try {
    var today_p = new Date(); today_p.setHours(0, 0, 0, 0);
    projectsForPrompt = getProjects_();
    projectsSectionStr = projectsForPrompt.length === 0
      ? 'No active projects.'
      : projectsForPrompt.map(function(p) {
          var pending = p.tasks.filter(function(t) { return t.status !== 'Done'; });
          if (pending.length === 0) return null; // All done — skip
          var hasOverdue = pending.some(function(t) {
            if (!t.dueDate) return false;
            try { return new Date(t.dueDate) < today_p; } catch(e2) { return false; }
          });
          var noDueDates = pending.every(function(t) { return !t.dueDate; });
          var line = '- ' + p.projectName + ' (' + pending.length + ' pending task(s))';
          if (hasOverdue)  line += ' ⚠ HAS OVERDUE TASKS';
          if (noDueDates && pending.length >= 2) line += ' [no due dates — may be abandoned]';
          return line;
        }).filter(function(l) { return l !== null; }).join('\n') || 'No active projects.';
  } catch (projErr) {
    projectsSectionStr = '(unavailable)';
  }

  // ---- Format: Upcoming Trips (Issue #24 intelligence) -----------------------
  var tripsForPrompt = [];
  var tripsSectionStr = '';
  try {
    var travelCfg = readPTOConfig_();
    tripsForPrompt = getUpcomingTravel_(travelCfg);
    var ss_t = getSpreadsheet();
    var today_t = new Date(); today_t.setHours(0, 0, 0, 0);

    tripsSectionStr = tripsForPrompt.length === 0
      ? 'No upcoming trips.'
      : tripsForPrompt.map(function(trip) {
          var daysAway = trip.daysAway !== undefined ? trip.daysAway
            : (trip.startDate ? Math.round((new Date(trip.startDate) - today_t) / 86400000) : null);
          var tripKey  = trip.startDate + '|' + trip.label;
          var line     = '- ' + trip.label + ' (starts: ' + trip.startDate + ')';
          if (daysAway !== null) line += ' [' + daysAway + ' days away]';
          line += ' | TripKey: ' + tripKey;

          // Count packing items
          var packCount = 0;
          try {
            var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);
            if (packSheet && packSheet.getLastRow() >= 2) {
              var packData = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
              packData.forEach(function(r) { if (String(r[1]).trim() === tripKey) packCount++; });
            }
          } catch(pe) {}

          // Count itinerary items
          var itinCount = 0;
          try {
            var itinSheet = ss_t.getSheetByName(TABS.ITINERARY);
            if (itinSheet && itinSheet.getLastRow() >= 2) {
              var itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
              itinData.forEach(function(r) { if (String(r[1]).trim() === tripKey) itinCount++; });
            }
          } catch(ie) {}

          line += ' | packing: ' + packCount + ' items, itinerary: ' + itinCount + ' items';
          if (daysAway !== null && daysAway <= 7 && packCount === 0) line += ' ⚠ NO PACKING LIST';
          if (daysAway !== null && daysAway <= 14 && itinCount === 0) line += ' ⚠ NO ITINERARY';
          return line;
        }).join('\n');
  } catch (tripErr) {
    tripsSectionStr = '(unavailable)';
  }

  // ---- Format: Idea Braindump (Issue #18) ---------------------------------
  let ideasSection;
  try {
    const ideaSheet = getSpreadsheet().getSheetByName(TABS.IDEAS);
    const newIdeas  = [];
    if (ideaSheet && ideaSheet.getLastRow() >= 2) {
      const ideaData = ideaSheet.getRange(2, 1, ideaSheet.getLastRow() - 1, IDEA_HEADERS.length).getValues();
      ideaData.forEach(function(r) {
        if (String(r[0]).trim() && String(r[6]).trim() === 'New') newIdeas.push(r);
      });
    }
    ideasSection = newIdeas.length === 0
      ? 'No unreviewed ideas.'
      : newIdeas.slice(0, 10).map(function(r) {
          return '- [' + (r[3] || 'General') + '] ' + r[2] +
                 (r[4] ? ' (tags: ' + r[4] + ')' : '') +
                 (r[5] ? ' — ' + r[5] : '');
        }).join('\n');
  } catch (ideaErr) {
    ideasSection = '(unavailable)';
  }

  // ---- Assemble the Full Prompt -------------------------------------------
  const prompt =
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed and Victoria, a 2-person household.\n\n' +

    'Today is ' + today + '.\n\n' +

    'Your role is to think ahead and surface what matters, not just report what exists. ' +
    'As you analyze the data below, ask yourself:\n' +
    '- What upcoming events need preparation or logistics that have not been addressed?\n' +
    '- Which tasks are at risk of slipping through the cracks (neglected, overdue, or undated)?\n' +
    '- Are there dependencies between calendar events and open tasks?\n' +
    '- What financial or recurring obligations are due soon?\n' +
    '- What patterns or conflicts would Ahmed not immediately notice on his own?\n\n' +

    'CALENDAR CONTEXT RULES:\n' +
    '- Events labeled "personal (...)" or with a label that explicitly names Ahmed are from his own calendars — treat these as his primary obligations.\n' +
    '- Events labeled "shared: X" come from calendars not owned by Ahmed\'s personal Google account. This includes his Verizon work calendar (shared from his employer\'s Google Workspace), Victoria\'s calendar, and shared family calendars. Do NOT assume "shared" means Victoria\'s — read the calendar name carefully. Events from a Verizon calendar belong to Ahmed.\n' +
    '- Flag "shared" calendar events only when they directly affect Ahmed (he needs to prepare, attend, RSVP, or take action).\n' +
    '- Events with [RSVP: invited (no response)] or [RSVP: tentative] mean Ahmed has not confirmed — flag these if the event is soon.\n' +
    '- Events with [tagged: Color] have a color label Ahmed applied manually — treat colored events as higher-intent or categorized items worth noting.\n\n' +

    'PTO CONTEXT RULES (when PTO STATUS section is present):\n' +
    '- Flag if burn-down pace gap is more than 2 days behind ideal (paceStatus = behind).\n' +
    '- Flag if personal hours remaining are >24 hrs and we are past October 1 (year-end expiry risk).\n' +
    '- Flag if there is no upcoming PTO and vacation balance is >5 days AND current date is after August 1.\n' +
    '- Flag if a 3-2-1 target category shows 0 planned AND 0 used with fewer than 3 months left in the year.\n' +
    '- Flag if the gap since last PTO is >60 days with no upcoming PTO.\n' +
    '- Use source "Tasks" for PTO flags (they are action items for Ahmed to schedule).\n\n' +

    'FINANCE CONTEXT RULES:\n' +
    '- The Summaries section includes spending data from Empower CSV exports (uploaded end-of-month). The "Total Spending" row shows the full-month total. Top 10 categories follow, then an "Other" bucket.\n' +
    '- Spending rows format: "Category — Month: $latest vs $prev in PrevMonth (+/-%)". Both months are complete months.\n' +
    '- Flag any spending category where latest month is MORE than 20% over prior month AND the absolute increase is at least $30. Use source "Finance".\n' +
    '- If a category shows a very large spike (>50% or >$200 over), flag it as High urgency — otherwise Medium.\n' +
    '- Simple Ass Tracker (SAT) rows show Ahmed and Victoria\'s net income, expenses, and disposable income for the current budget period.\n' +
    '- Flag if Shared Disposable Income or either person\'s Disposable Income is unexpectedly low (e.g. near zero or negative).\n' +
    '- Do NOT flag normal month-to-month variation (<20% or <$30 difference).\n\n' +

    'IDEA BRAINDUMP RULES:\n' +
    '- The Ideas section lists unstructured thoughts Ahmed has parked for later.\n' +
    '- Cross-reference ideas against calendar events, tasks, and summaries.\n' +
    '- If an idea aligns with an upcoming event, a gap in planning, or a recurring theme, suggest converting it to a task — surface this as a Low-urgency General flag.\n' +
    '- Do NOT flag an idea if it already has a corresponding open task or ongoing project.\n\n' +

    'SHARED INTEREST LEDGER RULES:\n' +
    '- The ledger below records things Ahmed and Victoria have specifically mentioned wanting or liking.\n' +
    '- Cross-reference it against calendar events and tasks. If a connection exists — a relevant venue, event, experience, or opportunity — generate a flag.\n' +
    '- Example triggers: a food festival nearby when Victoria logged "Ethiopian food"; a free weekend when Ahmed logged "boutique fitness class"; a travel event when either logged a destination.\n' +
    '- Use source "General" for interest-driven flags. Urgency is usually Low or Medium unless time-sensitive (e.g. tickets close tonight).\n' +
    '- Do NOT flag interests that already have an open task or upcoming calendar event addressing them.\n\n' +

    'BILLS INTELLIGENCE RULES:\n' +
    '- The Bills section lists recurring household payments tracked by Ahmed.\n' +
    '- Flag any bill where dueDay falls within 7 days of today\'s date AND it is marked UNPAID this month.\n' +
    '  Urgency: ≤2 days = High, ≤5 days = Medium, ≤7 days = Low.\n' +
    '- Do NOT flag bills marked PAID this month.\n' +
    '- Use source "Finance". Key format: bill_due_[bill_name_snake].\n\n' +

    'HOME MAINTENANCE INTELLIGENCE RULES:\n' +
    '- The Home Maintenance section lists household items with scheduled service intervals.\n' +
    '- Flag any item where service is OVERDUE (serviceDays < 0) — urgency = High.\n' +
    '- Flag any item where service is due within 14 days — urgency = Low.\n' +
    '- Use source "General". Key format: home_service_[item_name_snake].\n\n' +

    'GOALS STATUS RULES:\n' +
    '- The Goals section lists Ahmed\'s yearly goals.\n' +
    '- Flag any goal marked ⚠ IN PROGRESS SINCE PRIOR MONTH if it has no matching open task or recent calendar event.\n' +
    '  This suggests the goal may be stalling. Urgency = Low.\n' +
    '- Use source "General". Key format: goal_stall_[goal_title_snake].\n\n' +

    'PROJECTS STATUS RULES:\n' +
    '- The Projects section shows multi-step projects Ahmed is tracking.\n' +
    '- Flag any project marked ⚠ HAS OVERDUE TASKS — urgency = Medium.\n' +
    '- Flag any project marked [no due dates — may be abandoned] — urgency = Low.\n' +
    '- Use source "Tasks". Key format: project_overdue_[name_snake] or project_abandoned_[name_snake].\n\n' +

    'PRE-TRIP INTELLIGENCE RULES:\n' +
    '- The Upcoming Trips section shows travel on Ahmed\'s calendar.\n' +
    '- If a trip is ⚠ NO PACKING LIST within 7 days: urgency = High, flag "{{trip}} in N days — packing list not started".\n' +
    '- If a trip is ⚠ NO ITINERARY within 14 days: urgency = Medium, flag "{{trip}} has no itinerary yet".\n' +
    '- If a trip is within 3 days AND has packing/itinerary items: urgency = Low, "Final prep check for {{trip}}".\n' +
    '- Use source "General". Key format: packing_not_started_[trip_slug], itinerary_empty_[trip_slug], trip_final_check_[trip_slug].\n\n' +

    'TASK NEGLECT RULES (enhanced — flag by name):\n' +
    '- If a task has been open for >14 days (marked [NEGLECTED]), flag it specifically by name:\n' +
    '  "Task \'{{name}}\' has been open for N days — still relevant? Complete, update, or delete."\n' +
    '- Limit to the top 3 most neglected tasks (by age) to avoid flag spam.\n' +
    '- Urgency: <21 days = Low, 21–30 days = Medium, >30 days = High.\n' +
    '- Use source "Tasks". Key format: task_neglect_[task_id_or_name_snake].\n\n' +

    (suppressedPatterns && suppressedPatterns.length > 0
      ? 'SUPPRESSED TOPICS (user has consistently indicated these are not useful — do NOT generate flags for them):\n' +
        suppressedPatterns.map(function(p) { return '  - ' + p; }).join('\n') + '\n\n'
      : '') +

    (function() {
      try {
        var topPatterns = getTopSignalPatterns_(5);
        if (topPatterns.length === 0) return '';
        return 'SIGNAL LEARNING (what Ahmed engages with most — prioritize these topics):\n' +
          topPatterns.map(function(p) { return '  - ' + p.pattern + ' (score: ' + Math.round(p.score) + ')'; }).join('\n') +
          '\nUse these scores to weight flag importance — higher score patterns matter more to Ahmed.\n\n';
      } catch(slErr) { return ''; }
    })() +

    '=== UPCOMING CALENDAR EVENTS (next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days) ===\n' +
    eventsSection + '\n\n' +

    '=== OPEN TASKS ===\n' +
    tasksSection + '\n\n' +

    '=== LIFE SUMMARIES & METRICS ===\n' +
    summariesSection + '\n\n' +

    '=== SHARED INTEREST LEDGER ===\n' +
    ledgerSection + '\n\n' +

    '=== IDEA BRAINDUMP (top 10 unreviewed) ===\n' +
    ideasSection + '\n\n' +

    // ---- PTO Status (injected when available) ----------------------------
    (ptoStats ? '=== PTO STATUS ===\n' + ptoSummaryForClaude_(ptoStats) + '\n\n' : '') +

    // ---- New data sections for Issue #24 intelligence -------------------
    '=== BILLS (' + billsForPrompt.length + ' tracked) ===\n' +
    billsSectionStr + '\n\n' +

    '=== HOME MAINTENANCE (' + homeItemsForPrompt.length + ' items) ===\n' +
    homeItemsSectionStr + '\n\n' +

    '=== YEARLY GOALS ===\n' +
    goalsSectionStr + '\n\n' +

    '=== PROJECTS ===\n' +
    projectsSectionStr + '\n\n' +

    '=== UPCOMING TRIPS ===\n' +
    tripsSectionStr + '\n\n' +

    'CROSS-DOMAIN SYNTHESIS:\n' +
    'Before finalizing your flags, spend one reasoning pass looking for connections between domains:\n' +
    '- Calendar event + Task alignment: Is there an important meeting approaching with no prep task?\n' +
    '- Trip + Shopping or Packing: Is there a trip soon where packing hasn\'t started?\n' +
    '- Bill + Finance: Is there a bill due AND any indication of tight finances in Summaries?\n' +
    '- Goal + Calendar: Is there a clear free window this week that aligns with an active goal?\n' +
    '- Interest Ledger + Calendar: Has Ahmed/Victoria expressed interest in something with a nearby opportunity?\n' +
    'Generate up to 2 cross-domain flags from this synthesis — these are often the most valuable insights.\n\n' +

    'Based on this data, generate up to ' + CONFIG.MAX_FLAGS + ' intelligent, actionable flags for Ahmed. ' +
    'Prioritize items that are time-sensitive, high-stakes, have dependencies, or have been neglected.\n\n' +

    'CRITICAL — RESPONSE FORMAT:\n' +
    'Return ONLY a raw JSON array. ' +
    'No markdown. No code fences. No explanation before or after. Just the JSON array itself, starting with [ and ending with ].\n\n' +

    'Each object must have exactly these five fields:\n' +
    '  "source"  — one of: "Calendar", "Tasks", "Finance", "Summaries", "General"\n' +
    '  "flag"    — short action-oriented title, max 10 words\n' +
    '  "reason"  — specific explanation of why this matters right now, 1-2 sentences\n' +
    '  "urgency" — exactly one of: "High", "Medium", "Low"\n' +
    '  "key"     — a SHORT, STABLE, TOPIC-BASED snake_case identifier (2–4 words MAX). Rules:\n' +
    '    • NEVER include dates, months, or numbers — bad: "verizon_bill_march_13", good: "verizon_payment_due"\n' +
    '    • NEVER include dates, months, or numbers — bad: "dentist_task_march_9", good: "overdue_dentist_task"\n' +
    '    • Keep it IDENTICAL night-to-night for the same ongoing issue so the deduplication system blocks it\n' +
    '    • If an issue is genuinely new or a fresh recurrence, append a short qualifier: "verizon_payment_due_q2" or "dentist_followup"\n' +
    '    • Good examples: "verizon_payment_due", "anniversary_dinner", "ramadan_iftar", "sti_payout", "apartment_cleaning"\n' +
    '    • Bad examples: "verizon_bill_march_13", "upcoming_anniversary_dinner_march_9", "sti_payout_march_11"\n\n' +

    'Example of the expected format (do not include this in your response):\n' +
    '[{"source":"Calendar","flag":"Book restaurant before anniversary fills up","reason":"Anniversary dinner is 4 days away and no reservation task exists. Popular venues fill quickly on weekends.","urgency":"High","key":"anniversary_dinner"}]\n\n' +

    'Generate the flags for Ahmed now:';

  return prompt;
}

// ============================================================
// GENERATE FLAGS — Call Claude API and parse the response
// ============================================================

/**
 * Calls the Anthropic Claude API and parses the returned flag objects.
 *
 * @param {Array}  events    - From getUpcomingEvents()
 * @param {Array}  tasks     - From getOpenTasks()
 * @param {Array}  summaries - From getSummaries()
 * @param {Object} ptoStats  - From writePTOSnapshot_() (optional, may be null)
 * @param {Array}  ledger    - From getSharedInterestLedger_() (optional)
 * @returns {Array} Parsed and validated array of flag objects
 */
function generateFlags(events, tasks, summaries, ptoStats, ledger, suppressedPatterns) {
  const apiKey = getApiKey();
  const prompt = buildPrompt(events, tasks, summaries, ptoStats, ledger, suppressedPatterns || []);

  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role:    'user',
        content: prompt,
      },
    ],
  };

  const fetchOptions = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
    },
    payload:          JSON.stringify(requestBody),
    muteHttpExceptions: true, // We handle errors manually below
  };

  Logger.log('Calling Claude API (' + CLAUDE_MODEL + ')...');

  const response     = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    Logger.log('Claude API HTTP ' + responseCode + ': ' + responseText);
    throw new Error('Claude API returned HTTP ' + responseCode + '. Check your API key and account credits.');
  }

  let apiJson;
  try {
    apiJson = JSON.parse(responseText);
  } catch (parseErr) {
    throw new Error('Failed to parse Claude API response as JSON: ' + responseText.substring(0, 500));
  }

  if (!apiJson.content || !apiJson.content[0] || !apiJson.content[0].text) {
    throw new Error('Unexpected Claude API response structure: ' + JSON.stringify(apiJson).substring(0, 500));
  }

  const rawContent = apiJson.content[0].text.trim();
  Logger.log('Claude raw output (' + rawContent.length + ' chars): ' + rawContent.substring(0, 500));

  const flags = parseFlags(rawContent);
  Logger.log('Parsed ' + flags.length + ' valid flags from Claude response.');

  return flags;
}

// ============================================================
// PARSE FLAGS — Extract and validate the JSON array
// ============================================================

/**
 * Extracts a JSON flag array from Claude's raw text response.
 * Defensively handles stray markdown code fences that Claude
 * occasionally adds despite explicit instructions not to.
 *
 * @param {string} rawContent - The raw text from Claude's response
 * @returns {Array} Validated array of flag objects (may be empty)
 */
function parseFlags(rawContent) {
  let cleaned = rawContent.trim();

  // Strip markdown code fences if present
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i,     '')
    .replace(/\s*```$/i,     '')
    .trim();

  // Find the JSON array boundaries
  const startIdx = cleaned.indexOf('[');
  const endIdx   = cleaned.lastIndexOf(']');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    Logger.log('parseFlags: No valid JSON array found in response.');
    Logger.log('Full content was: ' + cleaned);
    return [];
  }

  const jsonStr = cleaned.substring(startIdx, endIdx + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    Logger.log('parseFlags JSON.parse failed: ' + e.message);
    Logger.log('JSON string was: ' + jsonStr.substring(0, 500));
    return [];
  }

  if (!Array.isArray(parsed)) {
    Logger.log('parseFlags: Parsed result is not an array.');
    return [];
  }

  const VALID_URGENCIES = ['High', 'Medium', 'Low'];
  const VALID_SOURCES   = ['Calendar', 'Tasks', 'Finance', 'Summaries', 'General', 'Ideas'];

  const validated = parsed
    .filter(function(f) {
      return f && typeof f === 'object' && f.flag && f.flag.trim() !== '';
    })
    .map(function(f) {
      const urgency = VALID_URGENCIES.indexOf(f.urgency) !== -1 ? f.urgency : 'Low';
      const source  = VALID_SOURCES.indexOf(f.source) !== -1 ? f.source : 'General';
      return {
        source:  source,
        flag:    String(f.flag   || '').trim(),
        reason:  String(f.reason || '').trim(),
        urgency: urgency,
        key:     String(f.key    || '').toLowerCase().replace(/[^a-z0-9_]/g, '').trim(),
      };
    })
    .slice(0, CONFIG.MAX_FLAGS); // Enforce max flag cap

  return validated;
}
