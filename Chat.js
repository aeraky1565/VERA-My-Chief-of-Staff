// ============================================================
// VERA — Chat.js
// Conversational AI interface — shared backend for
// the dashboard Chat tab and Telegram bot (Phase 4)
// ============================================================
//
// Script Properties used:
//   CHAT_HISTORY_{sessionId} — stored conversation history (JSON)
//
// Sessions:
//   'dashboard'  — dashboard Chat tab (shared, no multi-user concern)
//   '{chatId}'   — Telegram: the user's numeric Telegram chat ID
// ============================================================

var CHAT_HISTORY_PREFIX = 'CHAT_HISTORY_';
var CHAT_MAX_EXCHANGES  = 10; // keep last 10 back-and-forths (20 messages)

// ---- Web Search Tool (Issue #62) ------------------------------------------

var WEB_SEARCH_TOOL_ = {
  name: 'web_search',
  description:
    'Search the web for real-time or location-specific information. ' +
    'Use ONLY when the user needs current data (live prices, today\'s news, ' +
    'event status, local services) that is NOT in the provided context data. ' +
    'SECURITY RULE: The query MUST NOT contain personal identifiers — no names, ' +
    'email addresses, phone numbers, or home addresses. Use only generic public ' +
    'terms (city name, topic, year). ' +
    'Example: "Where do I vote?" → query "polling stations in Austin TX 2026", ' +
    'NOT "where does Ahmed vote".',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Concise web search query, max 200 chars, zero personal data.'
      }
    },
    required: ['query']
  }
};

/** Returns [WEB_SEARCH_TOOL_] if VERA_SEARCH_API_KEY is configured, else []. */
function getSearchTools_() {
  var key = PropertiesService.getScriptProperties()
              .getProperty('VERA_SEARCH_API_KEY') || '';
  return key ? [WEB_SEARCH_TOOL_] : [];
}

/**
 * Execute a web search via Serper.dev (default) or Tavily.
 * Engine selected by Script Property VERA_SEARCH_ENGINE ('serper'|'tavily').
 * Applies PII regex scrub before the query leaves the server.
 * Returns array of { title, snippet, link } (up to 3), or [] on error.
 */
function doWebSearch_(rawQuery) {
  var apiKey = PropertiesService.getScriptProperties()
                 .getProperty('VERA_SEARCH_API_KEY') || '';
  var engine = PropertiesService.getScriptProperties()
                 .getProperty('VERA_SEARCH_ENGINE') || 'serper';
  if (!apiKey) return [];

  // ── PII scrub (syntactic safety net) ──────────────────────────────────────
  var q = (rawQuery || '').trim().substring(0, 200);
  q = q.replace(/\b[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}\b/g, '[redacted]'); // email
  q = q.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,   '[redacted]'); // phone
  q = q.replace(/\b\d{3}-\d{2}-\d{4}\b/g,               '[redacted]'); // SSN
  if (q.indexOf('[redacted]') !== -1) {
    Logger.log('VERA web_search PII redacted. Original: ' + rawQuery);
  }
  Logger.log('VERA web_search query: ' + q);
  // ──────────────────────────────────────────────────────────────────────────

  try {
    if (engine === 'tavily') {
      var tvResp = UrlFetchApp.fetch('https://api.tavily.com/search', {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        payload: JSON.stringify({ api_key: apiKey, query: q, max_results: 3 }),
        muteHttpExceptions: true
      });
      var tvData = JSON.parse(tvResp.getContentText());
      return (tvData.results || []).slice(0, 3).map(function(r) {
        return { title: r.title || '', snippet: r.content || '', link: r.url || '' };
      });
    }
    // Default: Serper.dev
    var srResp = UrlFetchApp.fetch('https://google.serper.dev/search', {
      method: 'post',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ q: q, num: 3 }),
      muteHttpExceptions: true
    });
    var srData = JSON.parse(srResp.getContentText());
    return (srData.organic || []).slice(0, 3).map(function(r) {
      return { title: r.title || '', snippet: r.snippet || '', link: r.link || '' };
    });
  } catch (e) {
    Logger.log('VERA web_search error: ' + e.message);
    return [];
  }
}

// ============================================================
// PROACTIVE INSIGHTS — Issue #24
// ============================================================

/**
 * Pre-computes time-sensitive insights from context data.
 * Returns a formatted string for injection into the system prompt as VERA NOTICES.
 * Only surfaces HIGH-signal items so VERA can mention them proactively.
 *
 * @param {Object} context - The chat context object from buildChatContext_()
 * @returns {string} Formatted notices string, or '(nothing urgent right now)'
 */
function computeProactiveInsights_(context) {
  var notices = [];
  var today   = new Date(); today.setHours(0, 0, 0, 0);
  var tz      = Session.getScriptTimeZone();

  // 1. Tasks overdue >3 days (by name)
  try {
    if (context.tasks) {
      var overdueTasks = context.tasks.filter(function(t) {
        return t.isOverdue && t.daysUntilDue !== null && Math.abs(t.daysUntilDue) >= 3;
      }).sort(function(a, b) {
        return Math.abs(b.daysUntilDue) - Math.abs(a.daysUntilDue);
      }).slice(0, 3);

      overdueTasks.forEach(function(t) {
        var days = Math.abs(t.daysUntilDue);
        var urgency = days >= 7 ? 'HIGH' : 'MEDIUM';
        notices.push({ urgency: urgency, text: '⚠ Task overdue ' + days + ' days: "' + t.task + '"' });
      });
    }
  } catch (e) { Logger.log('computeProactiveInsights_: tasks — ' + e.message); }

  // 2. Bills due within 7 days (unpaid)
  try {
    if (context.bills) {
      var dayOfMonth = today.getDate();
      context.bills.forEach(function(b) {
        if (b.paid || b.dueDay === null) return;
        var daysUntilDue = b.dueDay - dayOfMonth;
        // Handle month-wrap: if dueDay < today, bill is due next month — only flag if close
        if (daysUntilDue < 0) daysUntilDue += new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        if (daysUntilDue <= 7) {
          var urgency = daysUntilDue <= 2 ? 'HIGH' : (daysUntilDue <= 5 ? 'MEDIUM' : 'LOW');
          var amtStr  = b.amount !== null ? ' ($' + b.amount + ')' : '';
          notices.push({ urgency: urgency, text: '💰 Bill due in ' + daysUntilDue + ' days: ' + b.bill + amtStr });
        }
      });
    }
  } catch (e) { Logger.log('computeProactiveInsights_: bills — ' + e.message); }

  // 3. Upcoming trips within 7 days + packing status
  try {
    if (context.travel && context.travel.trips) {
      context.travel.trips.forEach(function(trip) {
        var daysAway = trip.daysAway !== undefined ? trip.daysAway : null;
        if (daysAway === null && trip.startDate) {
          try { daysAway = Math.round((new Date(trip.startDate) - today) / 86400000); } catch(te) {}
        }
        if (daysAway === null || daysAway > 14) return;

        var tripKey   = trip.startDate + '|' + trip.label;
        var packItems = context.travel.packByTrip && context.travel.packByTrip[tripKey]
          ? context.travel.packByTrip[tripKey] : [];
        var itinItems = context.travel.itinByTrip && context.travel.itinByTrip[tripKey]
          ? context.travel.itinByTrip[tripKey] : [];

        if (daysAway <= 7 && packItems.length === 0) {
          notices.push({ urgency: 'HIGH', text: '🧳 ' + trip.label + ' is in ' + daysAway + ' days — packing list not started!' });
        } else if (daysAway <= 7) {
          var unpacked = packItems.filter(function(p) { return !p.checked; }).length;
          if (unpacked > 0) {
            notices.push({ urgency: 'MEDIUM', text: '🧳 ' + trip.label + ' in ' + daysAway + ' days — ' + unpacked + ' packing item(s) unpacked' });
          }
        }
        if (daysAway <= 14 && itinItems.length === 0) {
          notices.push({ urgency: 'MEDIUM', text: '📅 ' + trip.label + ' has no itinerary yet (' + daysAway + ' days away)' });
        }
      });
    }
  } catch (e) { Logger.log('computeProactiveInsights_: trips — ' + e.message); }

  // 4. Home items overdue or due within 7 days
  try {
    if (context.homeItems) {
      context.homeItems.forEach(function(h) {
        if (h.serviceDays === null) return;
        if (h.serviceDays < 0) {
          notices.push({ urgency: 'HIGH', text: '🔧 Home: ' + h.item + ' service overdue by ' + Math.abs(h.serviceDays) + ' days' });
        } else if (h.serviceDays <= 7) {
          notices.push({ urgency: 'LOW', text: '🔧 Home: ' + h.item + ' service due in ' + h.serviceDays + ' days' });
        }
      });
    }
  } catch (e) { Logger.log('computeProactiveInsights_: home items — ' + e.message); }

  // 5. Projects with overdue tasks
  try {
    if (context.projects) {
      context.projects.forEach(function(p) {
        var pending = p.tasks.filter(function(t) { return t.status !== 'Done'; });
        var overdue = pending.filter(function(t) {
          if (!t.dueDate) return false;
          try { return new Date(t.dueDate) < today; } catch(e2) { return false; }
        });
        if (overdue.length > 0) {
          notices.push({ urgency: 'MEDIUM', text: '📌 Project "' + p.projectName + '" has ' + overdue.length + ' overdue task(s)' });
        }
      });
    }
  } catch (e) { Logger.log('computeProactiveInsights_: projects — ' + e.message); }

  if (notices.length === 0) return '(nothing urgent right now)';

  // Sort: HIGH first, then MEDIUM, then LOW
  var order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  notices.sort(function(a, b) { return (order[a.urgency] || 2) - (order[b.urgency] || 2); });

  return notices.map(function(n) { return '[' + n.urgency + '] ' + n.text; }).join('\n');
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildChatSystemPrompt_(context) {
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  var flagLines = context.flags.length === 0
    ? '  (none active)'
    : context.flags.map(function(f) {
        return '  [' + f.urgency + '] ' + f.flag + ' — ' + f.reason + ' (ID: ' + f.id + ')';
      }).join('\n');

  var taskLines = context.tasks.length === 0
    ? '  (none open)'
    : context.tasks.map(function(t) {
        var line = '  - ' + t.task + ' (ID: ' + t.id + ')';
        if (t.dueDate)   line += ' | due: ' + t.dueDate;
        if (t.isOverdue) line += ' ⚠ OVERDUE';
        if (t.recurring) line += ' 🔁 ' + t.recurring;
        return line;
      }).join('\n');

  var summaryLines = context.summaries.length === 0
    ? '  (none available)'
    : context.summaries.map(function(s) {
        return '  [' + s.source + '] ' + s.metric + ': ' + s.value;
      }).join('\n');

  var projectsLine;
  if (!context.projects || context.projects.length === 0) {
    projectsLine = '  (none)';
  } else {
    var activeProjList = context.projects.filter(function(p) {
      return p.tasks.some(function(t) { return t.status !== 'Done'; });
    });
    if (activeProjList.length === 0) {
      projectsLine = '  (all projects complete)';
    } else {
      projectsLine = activeProjList.map(function(p) {
        var pending = p.tasks.filter(function(t) { return t.status !== 'Done'; });
        return '  ' + p.projectName + ' (' + pending.length + ' task' + (pending.length === 1 ? '' : 's') + ' pending):\n' +
          pending.map(function(t) {
            return '    [' + t.status + '] ' + t.task +
                   (t.priority && t.priority !== 'Medium' ? ' [' + t.priority + ']' : '') +
                   (t.dueDate ? ' due:' + t.dueDate : '');
          }).join('\n');
      }).join('\n');
    }
  }

  // Calendar events — same format as Claude.js lines 53–79
  var calLines;
  if (!context.calendarEvents || context.calendarEvents.length === 0) {
    calLines = '  (none in the next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days)';
  } else {
    calLines = context.calendarEvents.map(function(e) {
      var dl = e.daysUntil === 0 ? 'TODAY' : e.daysUntil === 1 ? 'TOMORROW' : 'in ' + e.daysUntil + ' days';
      var ts = e.isAllDay ? 'all day' : e.start.split(' ')[1];
      var ds = e.start.split(' ')[0];
      var ln = '  - ' + e.title + ' | ' + ds + ' ' + ts + ' [' + dl + ']';
      if (e.location) ln += ' @ ' + e.location;
      ln += ' (' + (e.calLabel || e.calendarName) + ')';
      if (e.myStatus && e.myStatus !== 'organizer' && e.myStatus !== 'accepted')
        ln += ' [RSVP: ' + e.myStatus + ']';
      if (e.eventColor) ln += ' [tagged: ' + e.eventColor + ']';
      return ln;
    }).join('\n');
  }

  // Shared Interest Ledger — include ID so Claude can reference for delete_interest
  var interestLines = (!context.interests || context.interests.length === 0)
    ? '  (none logged yet)'
    : context.interests.map(function(i) {
        return '  - [ID:' + i.id + '] ' + i.person + ': ' + i.interest +
               ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  // PTO — delegate to existing ptoSummaryForClaude_() (PTO.js)
  var ptoSection = context.ptoStats
    ? ptoSummaryForClaude_(context.ptoStats)
    : '  (unavailable — PTO calendar may not be configured)';

  // Yearly goals — include ID so Claude can reference them in update_goal / delete_goal
  var goalLines = (!context.goals || context.goals.length === 0)
    ? '  (none active)'
    : context.goals.map(function(g) {
        return '  - [' + g.status + '] ' + g.title +
               (g.category ? ' (' + g.category + ')' : '') + ' (ID: ' + g.id + ')';
      }).join('\n');

  var billLines = (!context.bills || context.bills.length === 0)
    ? '  (none)'
    : context.bills.map(function(b) {
        return '  [row:' + b.row + '] ' + b.bill +
               (b.amount ? ' $' + b.amount : '') +
               ' (' + b.frequency + ')' +
               (b.dueDay ? ' due day ' + b.dueDay : '') +
               (b.paid ? ' ✓ PAID this month' : ' — UNPAID');
      }).join('\n');

  var recipeLines = (!context.recipes || context.recipes.length === 0)
    ? '  (none)'
    : context.recipes.map(function(r) {
        var ingCount = r.ingredients ? r.ingredients.split(';').length : 0;
        return '  [row:' + r.row + '] ' + r.name +
               (r.cuisine ? ' (' + r.cuisine + ')' : '') +
               (ingCount > 0 ? ' — ' + ingCount + ' ingredients' : '');
      }).join('\n');

  var homeItemLines = (!context.homeItems || context.homeItems.length === 0)
    ? '  (none)'
    : context.homeItems.map(function(h) {
        var svc = h.nextService ? ' next service: ' + h.nextService : '';
        if (h.serviceDays !== null && h.serviceDays < 0) svc += ' ⚠ OVERDUE';
        else if (h.serviceDays !== null && h.serviceDays <= 14) svc += ' (due soon)';
        return '  [row:' + h.row + '] ' + h.item +
               (h.category ? ' [' + h.category + ']' : '') + svc;
      }).join('\n');

  var shoppingStoresList = (!context.shoppingStores || context.shoppingStores.length === 0)
    ? '(none configured)'
    : context.shoppingStores.join(', ');

  var ideaLines = (!context.ideas || context.ideas.length === 0)
    ? '  (none parked)'
    : context.ideas.map(function(i) {
        return '  [' + i.id + '] ' + i.idea +
               (i.category ? ' [' + i.category + ']' : '') +
               (i.status !== 'New' ? ' (' + i.status + ')' : '') +
               (i.tags ? ' — ' + i.tags : '');
      }).join('\n');

  return (
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed (and his partner Victoria).\n\n' +
    'IMPORTANT: You run inside Google Apps Script with direct access to Google Calendar, ' +
    'Google Sheets, and other Google services. Every ACTION listed below is FULLY IMPLEMENTED ' +
    'and will be executed immediately by the backend when you include it in your response. ' +
    'Never tell the user you cannot perform one of the listed actions — just include the ACTION ' +
    'line and it will be done. Do not hedge, disclaim, or suggest the user do it themselves.\n\n' +
    'Today is ' + today + '.\n\n' +

    'CURRENT STATE:\n\n' +
    'ACTIVE FLAGS (' + context.flags.length + '):\n' + flagLines + '\n\n' +
    'OPEN TASKS (' + context.tasks.length + '):\n' + taskLines + '\n\n' +
    'SUMMARIES:\n' + summaryLines + '\n\n' +
    'PROJECTS:\n' + projectsLine + '\n\n' +
    'UPCOMING CALENDAR EVENTS:\n' + calLines + '\n\n' +
    'SHARED INTEREST LEDGER (top 20):\n' + interestLines + '\n\n' +
    'YEARLY GOALS (active):\n' + goalLines + '\n\n' +
    'PTO STATUS:\n' + ptoSection + '\n\n' +
    'BILLS (' + context.bills.length + '):\n' + billLines + '\n\n' +
    'RECIPES (' + context.recipes.length + '):\n' + recipeLines + '\n\n' +
    'HOME ITEMS (' + context.homeItems.length + '):\n' + homeItemLines + '\n\n' +
    'SHOPPING STORES: ' + shoppingStoresList + '\n\n' +
    'IDEA BRAINDUMP (' + (context.ideas ? context.ideas.length : 0) + '):\n' + ideaLines + '\n\n' +

    (function() {
      var travel = context.travel;
      if (!travel || !travel.trips || travel.trips.length === 0) {
        return 'UPCOMING TRIPS:\n  (No upcoming trips found)\n\n';
      }
      var lines = 'UPCOMING TRIPS:\n';
      travel.trips.forEach(function(t) {
        var tk  = t.startDate + '|' + t.label;
        var ctx = (travel.tripContextMap && travel.tripContextMap[tk]) || '';
        lines += 'Trip: ' + t.label + ' (' + t.startDate + ' \u2013 ' + t.endDate + ')' +
                 (ctx ? ' | Context: ' + ctx : '') + ' | TripKey: ' + tk + '\n';
        var items = (travel.itinByTrip && travel.itinByTrip[tk]) || [];
        if (items.length > 0) {
          lines += '  Itinerary (' + items.length + ' item' + (items.length === 1 ? '' : 's') + '):\n';
          items.forEach(function(it) {
            lines += '    [' + it.id + '] ' + it.date + ' [' + it.type + '] ' + it.title +
                     (it.location ? ' @ ' + it.location : '') +
                     (it.startTime ? ' (' + it.startTime + ')' : '') + '\n';
          });
        } else {
          lines += '  Itinerary: (none)\n';
        }
        var pItems = (travel.packByTrip && travel.packByTrip[tk]) || [];
        if (pItems.length > 0) {
          var packed = pItems.filter(function(p) { return p.checked; }).length;
          lines += '  Packing (' + pItems.length + ' item' + (pItems.length === 1 ? '' : 's') + ', ' + packed + ' packed):\n';
          pItems.forEach(function(p) {
            lines += '    [' + p.id + '] ' + p.person + ' / ' + p.category + ' \u2014 ' + p.item +
                     (p.checked ? ' [packed]' : ' [unpacked]') + '\n';
          });
        } else {
          lines += '  Packing: (none)\n';
        }
      });
      return lines + '\n';
    })() +

    // ---- VERA NOTICES — proactive time-sensitive insights (Issue #24) --------
    (function() {
      try {
        var notices = computeProactiveInsights_(context);
        return 'VERA NOTICES (time-sensitive items requiring attention):\n' + notices + '\n\n' +
          'When answering ANY message, scan the VERA NOTICES above. If any item is truly time-sensitive ' +
          '(urgency = HIGH), briefly mention it in your response — even if Ahmed didn\'t ask about it directly. ' +
          'Example: "Done! Also — your Alaska trip is in 3 days and packing list isn\'t started. Want me to generate it now?"\n\n';
      } catch (noticesErr) {
        Logger.log('Chat: computeProactiveInsights_ error (non-fatal): ' + noticesErr.message);
        return '';
      }
    })() +

    'AVAILABLE ACTIONS — include these exact lines in your response to take action:\n' +
    'ACTION:complete_task|{taskId}\n' +
    'ACTION:delete_task|{taskId}\n' +
    'ACTION:update_task|{taskId}|{field}|{value}\n' +
    'ACTION:acknowledge_flag|{flagId}\n' +
    'ACTION:snooze_flag|{flagId}|{days}\n' +
    'ACTION:resolve_flag|{flagId}\n' +
    'ACTION:create_project|{project name}|{task 1}~{task 2}~{task 3}\n' +
    'ACTION:log_interest|{person}|{interest}|{category}\n' +
    'ACTION:create_task|{task text}|{due date YYYY-MM-DD}|{recurring interval or blank}\n' +
    'ACTION:create_calendar_event|{title}|{YYYY-MM-DD}|{HH:MM or all-day}|{duration_minutes}\n' +
    'ACTION:add_bill|{name}|{amount}|{due_day}|{frequency}|{category}|{account}\n' +
    'ACTION:mark_bill_paid|{row_number_or_bill_name}\n' +
    'ACTION:add_recipe|{name}|{cuisine}|{servings}|{prep_time}|{ingredients_semicolon_sep}|{tags}\n' +
    'ACTION:delete_recipe|{row_number}\n' +
    'ACTION:add_home_item|{item_name}|{category}|{warranty_expiry_YYYY-MM-DD}|{interval_months}|{notes}\n' +
    'ACTION:record_home_service|{row_number_or_item_name}\n' +
    'ACTION:add_shopping_item|{store_name}|{item_text}\n' +
    'ACTION:add_goal|{title}|{category}|{description}\n' +
    'ACTION:update_goal|{goalId}|{field}|{value}\n' +
    'ACTION:delete_goal|{goalId}\n' +
    'ACTION:delete_interest|{interestId}\n' +
    'ACTION:add_idea|{idea text}|{category}|{tags}\n' +
    'ACTION:promote_idea|{ideaId}\n' +
    'ACTION:archive_idea|{ideaId}\n' +
    // Travel — Itinerary
    'ACTION:add_itinerary_item|{tripKey}|{type}|{title}|{date YYYY-MM-DD}|{startTime HH:MM or blank}|{endTime HH:MM or blank}|{location or blank}|{notes or blank}\n' +
    '  \u2014 type options: flight, train, cruise, ferry, hotel, dining, museum, beach, show, spa, skiing, snorkeling, theme_park, shopping, market, manual\n' +
    'ACTION:update_itinerary_item|{id}|{field}|{value}  \u2014 fields: title, date, startTime, endTime, location, notes\n' +
    'ACTION:delete_itinerary_item|{id}\n' +
    'ACTION:set_trip_context|{tripKey}|{context}  \u2014 e.g. Anniversary Trip, Family Trip, Work Trip, Honeymoon, Visiting Friends\n' +
    // Travel — Packing
    'ACTION:add_packing_item|{tripKey}|{person}|{category}|{item}  \u2014 person: ahmed / victoria / shared\n' +
    'ACTION:check_packing_item|{id}|{true or false}  \u2014 mark a packing item as packed or unpacked\n' +
    'ACTION:delete_packing_item|{id}\n' +
    'ACTION:generate_packing_list|{tripKey}|{startDate YYYY-MM-DD}|{endDate YYYY-MM-DD}  \u2014 AI-generates full list using itinerary + context + weather\n' +
    // Project tasks
    'ACTION:add_project_task|{projectName}|{task description}|{priority: High/Medium/Low}|{dueDate YYYY-MM-DD or blank}\n' +
    'ACTION:complete_project_task|{projectName}|{task description}\n' +
    'ACTION:delete_project_task|{projectName}|{task description}\n' +
    // Existing gaps
    'ACTION:recipe_to_shopping|{row_number}  \u2014 add recipe ingredients to the shopping list\n' +
    'ACTION:delete_home_item|{row_number}\n' +
    'ACTION:update_idea|{ideaId}|{field}|{value}  \u2014 fields: idea, category, tags, notes\n' +
    'ACTION:toggle_shopping_item|{store_name}|{item_text}  \u2014 mark a shopping item as purchased/unpurchased\n' +
    '\n' +

    'RULES:\n' +
    '- Be concise and conversational. This is a chat interface, not an email.\n' +
    '- Address Ahmed directly by name when appropriate.\n' +
    '- If taking an action, include the ACTION line anywhere in your response, then confirm in plain text what you did.\n' +
    '- For complete_task / delete_task: match task by ID from OPEN TASKS above. When completing a recurring task, VERA will automatically create the next occurrence — mention the new due date to Ahmed in your reply.\n' +
    '- For create_task: use when Ahmed asks to add, create, or remember a task. Include due date if mentioned (YYYY-MM-DD). For the recurring field (3rd arg), pass the interval if Ahmed says "every month / weekly / daily / quarterly / yearly / every 2 weeks / every N days" etc. — use plain English like "Monthly", "Weekly", "Quarterly", "Yearly", "Bi-Weekly". Leave blank (empty string) for one-time tasks.\n' +
    '- For update_task: valid fields are "task" (rename), "dueDate" (YYYY-MM-DD), "status" (Open/Done/Paused), "recurring" (frequency string, or empty string to make it one-time), "notes".\n' +
    '- For create_calendar_event: VERA can and does create Google Calendar events directly via the Apps Script backend. Use this whenever Ahmed asks to schedule, block time, or add an event to his calendar. If the time is not mentioned, default to "all-day". If title or date are missing, ask for them before emitting the ACTION line. Never say you cannot create calendar events — you can.\n' +
    '- For create_project: before generating the plan, ask 2–4 targeted clarifying questions to understand scope, timeline, and constraints. Wait for the answers before emitting the ACTION line. Only skip questions if Ahmed has already provided enough context, or explicitly says "just create it" / "go ahead". Once you have the details, generate a comprehensive, exhaustive checklist — the goal is that Ahmed misses nothing. Think through every phase: planning, logistics, dependencies, admin/paperwork, communications, day-of execution, and follow-up. Explicitly include steps people commonly overlook. Aim for 20–30 tasks for complex projects. Order tasks chronologically. Assign priorities naturally (High for time-sensitive or blocking steps, Low for nice-to-haves). Separate tasks with ~ and optionally append |High or |Low to each task.\n' +
    '- For log_interest: when Ahmed or Victoria mentions liking something, wanting to try something, or expresses interest in a place, food, activity, or experience, log it automatically with ACTION:log_interest. Use person "Ahmed" or "Victoria". Pick the best category from: Food, Travel, Fitness, Culture, Hobbies, Learning, Other. Example: "Victoria mentioned she wants to visit Wimberley" → ACTION:log_interest|Victoria|visit Wimberley TX|Travel\n' +
    '- For add_bill: use empty string for optional fields (amount, dueDay, category, account) when not provided.\n' +
    '- For mark_bill_paid: pass the row number from BILLS above (e.g., "2" for [row:2]). This toggles: paid→unpaid, unpaid→paid.\n' +
    '- For add_recipe: ingredients must be semicolon-separated (e.g., "Pasta 400g; Beef 500g; Tomatoes 2 cans"). Use empty string for unknown fields.\n' +
    '- For delete_recipe: use the row number from RECIPES above. Always confirm the recipe name with Ahmed before deleting.\n' +
    '- For add_home_item: use empty string for warranty_expiry and interval_months if not provided.\n' +
    '- For record_home_service: pass the row number from HOME ITEMS above, OR the item name. Sets Last Service=today, computes Next Service, creates a GCal reminder.\n' +
    '- For add_shopping_item: store_name must partially match one of the SHOPPING STORES listed above.\n' +
    '- For update_goal: valid fields are "status" (To Do/In Progress/Done/Paused), "title", "category", "progress", "notes". Use goal ID from YEARLY GOALS above.\n' +
    '- For delete_goal / delete_interest: always confirm the item name with Ahmed before deleting.\n' +
    '- For add_idea: capture any unstructured thought, half-formed plan, or "park this for later" request. Category options: General/Home/Finance/Health/Career/Personal/Travel/Other. Tags are optional, comma-separated. Use when Ahmed says "note this", "park this idea", "I want to eventually...", etc.\n' +
    '- For promote_idea: converts the idea to a real open task. Use the idea ID from IDEA BRAINDUMP above. Confirm with Ahmed which idea to promote if it is ambiguous.\n' +
    '- For archive_idea: marks the idea as Archived (no longer shown). Always confirm the idea with Ahmed before archiving.\n' +
    '- For update_idea: valid fields are "idea" (text), "category", "tags", "notes". Use the idea ID from IDEA BRAINDUMP above.\n' +
    '- For add_itinerary_item: use the TripKey exactly as shown in UPCOMING TRIPS (e.g., "2026-06-19|Alaska Cruise"). Date must be YYYY-MM-DD. Use blank for optional time/location/notes.\n' +
    '- For update_itinerary_item / delete_itinerary_item: use the item ID (e.g., ITIN-20260101-01) shown in UPCOMING TRIPS above.\n' +
    '- For set_trip_context: use the TripKey exactly as shown. Context should describe the trip sentiment (Anniversary Trip, Family Trip, Work Trip, Honeymoon, Visiting Friends, Visiting Family, Solo Adventure, Girls Trip, Group Trip, etc.).\n' +
    '- For add_packing_item: person must be "ahmed", "victoria", or "shared". Use the TripKey exactly as shown.\n' +
    '- For check_packing_item / delete_packing_item: use the item ID (e.g., PACK-20260101-01) shown in UPCOMING TRIPS above.\n' +
    '- For generate_packing_list: triggers an AI-powered packing list generation (may take 15\u201330s). Use trip startDate/endDate from UPCOMING TRIPS. Warn Ahmed it may take a moment.\n' +
    '- For add_project_task: use the project name exactly as shown in PROJECTS above. Priority defaults to Medium if not specified.\n' +
    '- For complete_project_task / delete_project_task: use the project name and a substring of the task text to match. For delete, always confirm the task with Ahmed first.\n' +
    '- For recipe_to_shopping: use the row number from RECIPES above (e.g., "2" for [row:2]). This adds all ingredients to the Recipe shopping tab.\n' +
    '- For delete_home_item: use the row number from HOME ITEMS above. Always confirm the item with Ahmed before deleting.\n' +
    '- For toggle_shopping_item: store_name must partially match one of the SHOPPING STORES above. item_text must partially match the item. This toggles purchased/unpurchased.\n' +
    '- WEB SEARCH: When you call web_search, briefly tell Ahmed you\'re looking it up. ' +
    'Synthesize results naturally — do not dump raw snippets. If results are empty ' +
    'or unhelpful, say so. Only search when context data is insufficient.\n' +
    '- NEVER include personal identifiers (names, emails, phones, addresses) in a ' +
    'search query. Generic terms only: city name, topic, event type, year.\n' +
    '- Never fabricate data not present in the current state above.\n' +
    '- If asked about something not in the current state, say so honestly.\n' +
    '- PROACTIVE BEHAVIOR: You are an active personal assistant, not just a record keeper. ' +
    'When you see HIGH-urgency items in VERA NOTICES, mention them naturally in your response. ' +
    'High-urgency items → always mention. Medium → mention if relevant to the conversation. ' +
    'Low → only mention if the user asks or there\'s nothing else to add.\n' +
    '- CONNECT THE DOTS: When the user asks about a topic, check other domains for relevant connections. ' +
    'Example: user asks about weekend plans → check clear windows + active goals + interests. ' +
    'Example: user adds a task for "prepare slides" → check calendar for when the related meeting is.\n' +
    '- NEXT STEPS: After completing an action, suggest a logical next step when one is obvious. ' +
    'Example: after adding a packing item → "Should I also generate the full list for this trip?" ' +
    'Example: after completing a task → "You have 2 other tasks due this week — want to review them?"\n' +
    '- CLOSING THE LOOP: When Ahmed mentions something in conversation, offer to record it in the ' +
    'relevant system. Example: "Victoria mentioned she wants to try Thai food" → ACTION:log_interest. ' +
    'Example: "I need to call the doctor" → offer ACTION:create_task. Do this naturally, not intrusively.\n'
  );
}

// ============================================================
// CONTEXT BUILDER
// ============================================================

function buildChatContext_() {
  var ss = getSpreadsheet();

  // Active flags — read sheet directly
  var activeFlags = [];
  var flagSheet   = ss.getSheetByName(TABS.FLAGS);
  if (flagSheet && flagSheet.getLastRow() >= 2) {
    var numRows = flagSheet.getLastRow() - 1;
    var data    = flagSheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
    activeFlags = data
      .filter(function(r) {
        return r[0] !== '' &&
               String(r[6]).toLowerCase() !== 'yes' &&  // not acknowledged
               String(r[8]).toLowerCase() !== 'yes';    // not resolved
      })
      .map(function(r) {
        return {
          id:      String(r[0]),
          flag:    String(r[3] || ''),
          reason:  String(r[4] || ''),
          urgency: String(r[5] || 'Low'),
        };
      });
  }

  var tasks           = getOpenTasks();
  // Include Metrics tab (nightly auto-stats) alongside Summaries
  var summaries       = readSummaryTab_(ss, TABS.METRICS).concat(readSummaryTab_(ss, TABS.SUMMARIES));
  var projectsSummary = getProjectsSummaryForContext_();

  // Calendar events (default horizon = CONFIG.CALENDAR_DAYS_AHEAD)
  var calendarEvents = [];
  try { calendarEvents = getUpcomingEvents(); }
  catch (e) { Logger.log('Chat context: calendar — ' + e.message); }

  // Shared Interest Ledger (top 20 active entries)
  var interests = [];
  try { interests = getSharedInterestLedger_().slice(0, 20); }
  catch (e) { Logger.log('Chat context: interests — ' + e.message); }

  // PTO stats (live compute — same pattern as webGetPTO_ in WebApp.js)
  var ptoStats = null;
  try {
    var ptoCfg    = readPTOConfig_();
    var ptoResult = getPTOEvents_(ptoCfg);
    ptoStats = computePTOStats_(ptoResult, ptoCfg, new Date());
  } catch (e) { Logger.log('Chat context: PTO — ' + e.message); }

  // Yearly goals (active only, top 8 — same filter as WeekendPlanner.js)
  var goals = [];
  try {
    goals = getGoals_().filter(function(g) {
      var s = String(g.status || '').toLowerCase();
      return s !== 'done' && s !== 'archived' && s !== 'complete';
    }).slice(0, 8);
  } catch (e) { Logger.log('Chat context: goals — ' + e.message); }

  // Bills (for chat context)
  var bills = [];
  try {
    var billSheet = ss.getSheetByName(TABS.BILLS);
    if (billSheet && billSheet.getLastRow() >= 2) {
      var billData  = billSheet.getRange(2, 1, billSheet.getLastRow() - 1, BILL_HEADERS.length).getValues();
      var tzB       = Session.getScriptTimeZone();
      var currMonth = Utilities.formatDate(new Date(), tzB, 'yyyy-MM');
      bills = billData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return {
          row:       idx + 2,
          bill:      String(r[0] || '').trim(),
          amount:    r[1] !== '' ? Number(r[1]) : null,
          dueDay:    r[2] !== '' ? Number(r[2]) : null,
          frequency: String(r[3] || 'Monthly').trim(),
          paid:      String(r[6] || '').trim() === currMonth,
        };
      });
    }
  } catch (e) { Logger.log('Chat context: bills — ' + e.message); }

  // Recipes
  var recipes = [];
  try {
    var recSheet = ss.getSheetByName(TABS.RECIPES);
    if (recSheet && recSheet.getLastRow() >= 2) {
      var recData = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, RECIPE_HEADERS.length).getValues();
      recipes = recData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return {
          row:         idx + 2,
          name:        String(r[0] || '').trim(),
          cuisine:     String(r[1] || '').trim(),
          ingredients: String(r[5] || '').trim(),
          tags:        String(r[6] || '').trim(),
        };
      });
    }
  } catch (e) { Logger.log('Chat context: recipes — ' + e.message); }

  // Home Items
  var homeItems = [];
  try {
    var hiSheet = ss.getSheetByName(TABS.HOME_ITEMS);
    if (hiSheet && hiSheet.getLastRow() >= 2) {
      var hiData   = hiSheet.getRange(2, 1, hiSheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
      var todayHI  = new Date(); todayHI.setHours(0, 0, 0, 0);
      homeItems = hiData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        var svcDays = null;
        if (r[5]) {
          try { svcDays = Math.round((new Date(r[5]) - todayHI) / 86400000); } catch (ex) {}
        }
        return {
          row:            idx + 2,
          item:           String(r[0] || '').trim(),
          category:       String(r[1] || '').trim(),
          nextService:    r[5] ? String(r[5]).substring(0, 10) : '',
          intervalMonths: r[6] !== '' ? Number(r[6]) : null,
          serviceDays:    svcDays,
        };
      });
    }
  } catch (e) { Logger.log('Chat context: homeItems — ' + e.message); }

  // Shopping store names (so Claude knows which stores to add items to)
  var shoppingStores = [];
  try { shoppingStores = getShoppingList_().map(function(s) { return s.storeName; }); }
  catch (e) { Logger.log('Chat context: shopping stores — ' + e.message); }

  // Ideas braindump — all non-archived ideas (Issue #18)
  var ideas = [];
  try {
    var ideaSheet = ss.getSheetByName(TABS.IDEAS);
    if (ideaSheet && ideaSheet.getLastRow() >= 2) {
      var ideaData = ideaSheet.getRange(2, 1, ideaSheet.getLastRow() - 1, IDEA_HEADERS.length).getValues();
      ideas = ideaData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return { row: idx + 2,
                 id:        String(r[0]||'').trim(),
                 dateAdded: String(r[1]||'').trim(),
                 idea:      String(r[2]||'').trim(),
                 category:  String(r[3]||'').trim(),
                 tags:      String(r[4]||'').trim(),
                 notes:     String(r[5]||'').trim(),
                 status:    String(r[6]||'New').trim() };
      }).filter(function(i) { return i.status !== 'Archived'; });
    }
  } catch (e) { Logger.log('Chat context: ideas — ' + e.message); }

  // Full projects array (for detailed task display + action lookups)
  var projects = [];
  try { projects = getProjects_(); }
  catch (e) { Logger.log('Chat context: projects full — ' + e.message); }

  // ---- Travel (itinerary + packing + trip context) -------------------------
  var travelTrips = [];
  try {
    var travelCfg = readPTOConfig_();
    travelTrips = getUpcomingTravel_(travelCfg);
  } catch(e) { Logger.log('Chat context: travel trips — ' + e.message); }

  var itinByTrip = {};
  try {
    var itinSheet = ss.getSheetByName(TABS.ITINERARY);
    if (itinSheet && itinSheet.getLastRow() >= 2) {
      var itinRows = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
      itinRows.forEach(function(r) {
        var tk = String(r[1]).trim();
        if (!itinByTrip[tk]) itinByTrip[tk] = [];
        itinByTrip[tk].push({
          id: String(r[0]).trim(), type: String(r[2]).trim(),
          title: String(r[3]).trim(), date: String(r[4]).trim(),
          startTime: String(r[5]).trim(), location: String(r[7]).trim(),
        });
      });
    }
  } catch(e) { Logger.log('Chat context: itinerary — ' + e.message); }

  var packByTrip = {};
  try {
    var packSheet = ss.getSheetByName(TABS.PACKING_ITEMS);
    if (packSheet && packSheet.getLastRow() >= 2) {
      var packRows = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
      packRows.forEach(function(r) {
        var tk = String(r[1]).trim();
        if (!packByTrip[tk]) packByTrip[tk] = [];
        packByTrip[tk].push({
          id: String(r[0]).trim(), person: String(r[2]).trim(),
          category: String(r[3]).trim(), item: String(r[4]).trim(),
          checked: String(r[5]).toUpperCase() === 'TRUE',
        });
      });
    }
  } catch(e) { Logger.log('Chat context: packing — ' + e.message); }

  var tripContextMap = {};
  try {
    var metaSheet = ss.getSheetByName(TABS.TRIP_META);
    if (metaSheet && metaSheet.getLastRow() >= 2) {
      var metaRows = metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
      metaRows.forEach(function(r) {
        tripContextMap[String(r[0]).trim()] = String(r[1]).trim();
      });
    }
  } catch(e) { Logger.log('Chat context: trip meta — ' + e.message); }

  var travel = { trips: travelTrips, itinByTrip: itinByTrip, packByTrip: packByTrip, tripContextMap: tripContextMap };

  return {
    flags:           activeFlags,
    tasks:           tasks,
    summaries:       summaries,
    projectsSummary: projectsSummary,
    projects:        projects,
    calendarEvents:  calendarEvents,
    interests:       interests,
    ptoStats:        ptoStats,
    goals:           goals,
    bills:           bills,
    recipes:         recipes,
    homeItems:       homeItems,
    shoppingStores:  shoppingStores,
    ideas:           ideas,
    travel:          travel,
  };
}

// ============================================================
// HISTORY STORAGE  (Script Properties, per session)
// ============================================================

function loadChatHistory_(sessionId) {
  var key = CHAT_HISTORY_PREFIX + String(sessionId);
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveChatHistory_(sessionId, userMsg, replyText) {
  var history = loadChatHistory_(sessionId);
  history.push({ role: 'user',      content: userMsg   });
  history.push({ role: 'assistant', content: replyText });
  var trimmed = history.slice(-(CHAT_MAX_EXCHANGES * 2));
  var key     = CHAT_HISTORY_PREFIX + String(sessionId);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(trimmed));
}

// ============================================================
// CLAUDE API  (messages format, with conversation history)
// ============================================================

/**
 * @param {string}      userMessage   - User's text (may be empty when image-only)
 * @param {Array}       history       - Prior message objects
 * @param {string}      systemPrompt  - VERA system prompt
 * @param {string|null} imageBase64   - Optional base64-encoded image
 * @param {string|null} imageMimeType - e.g. 'image/jpeg', 'image/png'
 */
function callClaudeChat_(userMessage, history, systemPrompt, imageBase64, imageMimeType) {
  var apiKey = getApiKey();
  var tools  = getSearchTools_();

  // Build user content: multimodal array when image present, plain string otherwise
  var userContent;
  if (imageBase64 && imageMimeType) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageBase64 } },
      { type: 'text',  text: userMessage ||
          'Please analyze this image and tell me what actions I should take or what useful information you can extract.' }
    ];
  } else {
    userContent = userMessage;
  }

  var messages = history.concat([{ role: 'user', content: userContent }]);
  var sources  = [];

  for (var iter = 0; iter < 3; iter++) {   // cap: 3 tool-call iterations
    var requestBody = {
      model:      CLAUDE_MODEL,
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   messages,
    };
    if (tools.length > 0) requestBody.tools = tools;

    var fetchOptions = {
      method:             'post',
      contentType:        'application/json',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload:            JSON.stringify(requestBody),
      muteHttpExceptions: true,
    };

    var response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
    var httpCode = response.getResponseCode();
    var bodyText = response.getContentText();

    if (httpCode !== 200) {
      throw new Error('Claude API returned HTTP ' + httpCode + ': ' + bodyText.substring(0, 300));
    }

    var json = JSON.parse(bodyText);

    // ── Tool-use turn ──────────────────────────────────────────────────────
    if (json.stop_reason === 'tool_use') {
      var toolResults = [];
      for (var ci = 0; ci < json.content.length; ci++) {
        var blk = json.content[ci];
        if (blk.type === 'tool_use' && blk.name === 'web_search') {
          var results = doWebSearch_(blk.input.query);
          sources = sources.concat(results);
          toolResults.push({
            type:        'tool_result',
            tool_use_id: blk.id,
            content:     JSON.stringify(results)  // '[]' on failure — Claude handles gracefully
          });
        }
      }
      messages = messages.concat([
        { role: 'assistant', content: json.content },
        { role: 'user',      content: toolResults  }
      ]);
      continue;   // loop: give Claude the search results
    }

    // ── Final text response ────────────────────────────────────────────────
    var replyText = '';
    for (var ti = 0; ti < json.content.length; ti++) {
      if (json.content[ti].type === 'text') replyText += json.content[ti].text;
    }
    if (!replyText) throw new Error('Unexpected Claude API response structure');
    return { text: replyText.trim(), sources: sources };
  }

  // Fallback (shouldn't reach under normal use)
  return { text: '', sources: sources };
}

// ============================================================
// ACTION EXECUTION HELPERS
// ============================================================

/** Wraps params into a fake Apps Script event object for calling WebApp.js functions directly. */
function makeFakeEvent_(params) {
  return { parameter: params || {} };
}

/** Returns the projectId for a given project name (case-insensitive first match). */
function findProjectIdByName_(projectName) {
  var projects = getProjects_();
  var query    = (projectName || '').toLowerCase().trim();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].projectName.toLowerCase().trim() === query) return projects[i].projectId;
  }
  return null;
}

/**
 * Returns the 1-based sheet row number for a pending task within a project.
 * Matches project name exactly and task text as a substring (case-insensitive).
 */
function findProjectTaskRow_(projectName, taskText) {
  var projects = getProjects_();
  var pName    = (projectName || '').toLowerCase().trim();
  var tText    = (taskText    || '').toLowerCase().trim();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].projectName.toLowerCase().trim() !== pName) continue;
    var tasks = projects[i].tasks;
    for (var j = 0; j < tasks.length; j++) {
      if (tasks[j].status !== 'Done' &&
          tasks[j].task.toLowerCase().indexOf(tText) >= 0) {
        return tasks[j].rowNum;
      }
    }
  }
  return null;
}

// ============================================================
// ACTION EXECUTION
// Claude can embed ACTION lines in its reply; we execute then strip them.
// ============================================================

function executeActions_(rawText) {
  var lines    = rawText.split('\n');
  var executed = [];
  var errors   = [];

  lines.forEach(function(line) {
    // Strip leading whitespace/backticks Claude sometimes adds around code lines
    var trimmed = line.replace(/^[\s`]+/, '').replace(/[`]+$/, '');
    var m = trimmed.match(/^ACTION:(\w+)\|(.+)$/);
    if (!m) return;

    var type = m[1];
    var args = m[2].split('|');

    try {
      if      (type === 'complete_task') {
        var ctRes = webCompleteTask_(args[0]);
        executed.push(type + ' (' + args[0] + ')' + (ctRes.recurring ? ' → 🔁 next due ' + ctRes.nextDueDate : ''));
      }
      else if (type === 'acknowledge_flag') { webAcknowledge_(args[0]);                        executed.push(type); }
      else if (type === 'snooze_flag')     { webSnooze_(args[0], parseInt(args[1], 10) || 2); executed.push(type); }
      else if (type === 'resolve_flag')    { webResolve_(args[0]);                             executed.push(type); }
      else if (type === 'create_project')  {
        // Split on first pipe only — project name | tasks (tasks may contain |High, |Medium, |Low)
        var firstPipe = m[2].indexOf('|');
        var projName  = (firstPipe === -1 ? m[2] : m[2].substring(0, firstPipe)).trim() || 'Untitled Project';
        var tasksRaw  = firstPipe === -1 ? '' : m[2].substring(firstPipe + 1).trim();
        var taskNames = tasksRaw ? tasksRaw.split('~') : [];
        createProject_(projName, taskNames);
        executed.push(type);
      }
      else if (type === 'log_interest') {
        var person   = (args[0] || 'Ahmed').trim();
        var interest = (args[1] || '').trim();
        var category = (args[2] || 'Other').trim();
        if (interest) {
          createInterest_(person, interest, category, 'Chat', '');
          executed.push(type);
        }
      }
      else if (type === 'create_task') {
        var ctText = (args[0] || '').trim();
        var ctDue  = (args[1] || '').trim();
        var ctRec  = (args[2] || '').trim();
        if (!ctText) throw new Error('Task text is required');
        var ctResult = webAddTask_({ parameter: { task: ctText, dueDate: ctDue, recurring: ctRec } });
        executed.push(type + ' (' + ctResult.id + ')' + (ctRec ? ' 🔁 ' + ctRec : ''));
      }
      else if (type === 'create_calendar_event') {
        var evTitle    = (args[0] || '').trim();
        var evDate     = (args[1] || '').trim();
        var evTime     = (args[2] || 'all-day').trim().toLowerCase();
        var evDuration = parseInt(args[3], 10) || 60;
        if (!evTitle || !evDate) throw new Error('Title and date are required for create_calendar_event');
        var cal = CalendarApp.getDefaultCalendar();
        if (evTime === 'all-day' || evTime === '') {
          var startD = new Date(evDate + 'T00:00:00');
          if (isNaN(startD.getTime())) throw new Error('Invalid date: ' + evDate);
          cal.createAllDayEvent(evTitle, startD);
        } else {
          var startDT = new Date(evDate + 'T' + evTime + ':00');
          if (isNaN(startDT.getTime())) throw new Error('Invalid date/time: ' + evDate + ' ' + evTime);
          var endDT   = new Date(startDT.getTime() + evDuration * 60 * 1000);
          cal.createEvent(evTitle, startDT, endDT);
        }
        executed.push(type + ' ("' + evTitle + '" on ' + evDate + ')');
      }

      // ---- Tasks (extended) ------------------------------------------------
      else if (type === 'delete_task') {
        var dtFound = findTaskRow_(args[0]);
        dtFound.sheet.deleteRow(dtFound.rowNum);
        executed.push(type + ' (' + args[0] + ')');
      }
      else if (type === 'update_task') {
        var utId    = (args[0] || '').trim();
        var utField = (args[1] || '').trim().toLowerCase();
        var utVal   = (args[2] || '').trim();
        var utFound = findTaskRow_(utId);
        // TASK_HEADERS: ID(1) | Task(2) | Added(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
        var utColMap = { task: 2, text: 2, duedate: 4, due: 4, status: 5, recurring: 6, notes: 7 };
        var utCol    = utColMap[utField];
        if (!utCol) throw new Error('Unknown task field: ' + utField + '. Valid: task, dueDate, status, recurring, notes');
        utFound.sheet.getRange(utFound.rowNum, utCol).setValue(utVal);
        executed.push(type + ' (' + utId + ')');
      }

      // ---- Bills ------------------------------------------------------------
      else if (type === 'add_bill') {
        var abName = (args[0] || '').trim();
        if (!abName) throw new Error('Bill name required');
        var abSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
        if (!abSheet) throw new Error('Bills tab not found');
        // BILL_HEADERS: Bill | Amount | Due Day | Frequency | Category | Account | Paid | Notes
        abSheet.getRange(abSheet.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([[
          abName,
          args[1] !== undefined ? (Number(args[1]) || '') : '',
          args[2] !== undefined ? (Number(args[2]) || '') : '',
          (args[3] || 'Monthly').trim(),
          (args[4] || '').trim(),
          (args[5] || '').trim(),
          '', ''
        ]]);
        executed.push(type + ' (' + abName + ')');
      }
      else if (type === 'mark_bill_paid') {
        var mbArg   = (args[0] || '').trim();
        var mbSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
        if (!mbSheet || mbSheet.getLastRow() < 2) throw new Error('Bills tab is empty');
        var mbTz    = Session.getScriptTimeZone();
        var mbMonth = Utilities.formatDate(new Date(), mbTz, 'yyyy-MM');
        var mbRow   = parseInt(mbArg, 10);
        if (isNaN(mbRow) || mbRow < 2) {
          var mbVals = mbSheet.getRange(2, 1, mbSheet.getLastRow() - 1, 1).getValues();
          for (var mbi = 0; mbi < mbVals.length; mbi++) {
            if (String(mbVals[mbi][0]).toLowerCase().indexOf(mbArg.toLowerCase()) !== -1) {
              mbRow = mbi + 2; break;
            }
          }
        }
        if (!mbRow || mbRow < 2) throw new Error('Bill not found: ' + mbArg);
        var mbCell = mbSheet.getRange(mbRow, 7); // Col G = Paid
        mbCell.setValue(String(mbCell.getValue() || '').trim() === mbMonth ? '' : mbMonth);
        executed.push(type + ' (row ' + mbRow + ')');
      }

      // ---- Recipes ----------------------------------------------------------
      else if (type === 'add_recipe') {
        var arName = (args[0] || '').trim();
        if (!arName) throw new Error('Recipe name required');
        var arSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
        if (!arSheet) throw new Error('Recipes tab not found');
        // RECIPE_HEADERS: Name | Cuisine | Servings | Prep Time | Link | Ingredients | Tags | Notes
        arSheet.getRange(arSheet.getLastRow() + 1, 1, 1, RECIPE_HEADERS.length).setValues([[
          arName,
          (args[1] || '').trim(),   // cuisine
          (args[2] || '').trim(),   // servings
          (args[3] || '').trim(),   // prep time
          '',                       // link (not supplied via chat)
          (args[4] || '').trim(),   // ingredients (semicolon-sep)
          (args[5] || '').trim(),   // tags
          ''                        // notes
        ]]);
        executed.push(type + ' (' + arName + ')');
      }
      else if (type === 'delete_recipe') {
        var drRow = parseInt(args[0], 10);
        if (isNaN(drRow) || drRow < 2) throw new Error('Invalid recipe row: ' + args[0]);
        var drSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
        if (!drSheet) throw new Error('Recipes tab not found');
        drSheet.deleteRow(drRow);
        executed.push(type + ' (row ' + drRow + ')');
      }

      // ---- Home Items -------------------------------------------------------
      else if (type === 'add_home_item') {
        var ahItem = (args[0] || '').trim();
        if (!ahItem) throw new Error('Item name required');
        var ahSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
        if (!ahSheet) throw new Error('Home Items tab not found');
        // HOME_ITEM_HEADERS: Item | Category | Purchase Date | Warranty Expiry | Last Service | Next Service | Interval (mo) | Notes
        ahSheet.getRange(ahSheet.getLastRow() + 1, 1, 1, HOME_ITEM_HEADERS.length).setValues([[
          ahItem,
          (args[1] || '').trim(),   // category
          '',                       // purchase date (not supplied via chat)
          (args[2] || '').trim(),   // warranty expiry
          '', '',                   // last/next service
          args[3] !== undefined ? (Number(args[3]) || '') : '',  // interval months
          (args[4] || '').trim()    // notes
        ]]);
        executed.push(type + ' (' + ahItem + ')');
      }
      else if (type === 'record_home_service') {
        var rhArg   = (args[0] || '').trim();
        var rhSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
        if (!rhSheet || rhSheet.getLastRow() < 2) throw new Error('Home Items tab is empty');
        var rhRow   = parseInt(rhArg, 10);
        if (isNaN(rhRow) || rhRow < 2) {
          var rhVals = rhSheet.getRange(2, 1, rhSheet.getLastRow() - 1, 1).getValues();
          for (var rhi = 0; rhi < rhVals.length; rhi++) {
            if (String(rhVals[rhi][0]).toLowerCase().indexOf(rhArg.toLowerCase()) !== -1) {
              rhRow = rhi + 2; break;
            }
          }
        }
        if (!rhRow || rhRow < 2) throw new Error('Home item not found: ' + rhArg);
        var rhResult = webRecordService_({ parameter: { row: rhRow } });
        executed.push(type + ' (next: ' + (rhResult.nextService || 'N/A — no interval set') + ')');
      }

      // ---- Shopping ---------------------------------------------------------
      else if (type === 'add_shopping_item') {
        var asStore = (args[0] || '').trim();
        var asText  = (args[1] || '').trim();
        if (!asStore || !asText) throw new Error('Store name and item text are both required');
        var asStores = getShoppingList_();
        var asFound  = null;
        for (var asi = 0; asi < asStores.length; asi++) {
          if (asStores[asi].storeName.toLowerCase().indexOf(asStore.toLowerCase()) !== -1) {
            asFound = asStores[asi]; break;
          }
        }
        if (!asFound) throw new Error('Store not found: ' + asStore + '. Available: ' +
          asStores.map(function(s) { return s.storeName; }).join(', '));
        addShoppingItem_(asFound.tabId, asText);
        executed.push(type + ' (' + asText + ' → ' + asFound.storeName + ')');
      }

      // ---- Goals ------------------------------------------------------------
      else if (type === 'add_goal') {
        var agTitle = (args[0] || '').trim();
        if (!agTitle) throw new Error('Goal title required');
        // createGoal_(title, description, status, category, year, notes)
        createGoal_(agTitle, (args[2] || '').trim(), 'To Do', (args[1] || '').trim(), '', '');
        executed.push(type + ' (' + agTitle + ')');
      }
      else if (type === 'update_goal') {
        var ugId    = (args[0] || '').trim();
        var ugField = (args[1] || '').trim();
        var ugVal   = (args[2] || '').trim();
        if (!ugId) throw new Error('Goal ID required');
        var ugFields = {};
        ugFields[ugField] = ugVal;
        updateGoal_(ugId, ugFields);
        executed.push(type + ' (' + ugId + ')');
      }
      else if (type === 'delete_goal') {
        var dgId = (args[0] || '').trim();
        if (!dgId) throw new Error('Goal ID required');
        deleteGoal_(dgId);
        executed.push(type + ' (' + dgId + ')');
      }

      // ---- Interests --------------------------------------------------------
      else if (type === 'delete_interest') {
        var diId = (args[0] || '').trim();
        if (!diId) throw new Error('Interest ID required');
        deleteInterest_(diId);
        executed.push(type + ' (' + diId + ')');
      }

      // ---- Ideas ------------------------------------------------------------
      else if (type === 'add_idea') {
        var aiText = (args[0] || '').trim();
        if (!aiText) throw new Error('Idea text required');
        var aiSheet = getSpreadsheet().getSheetByName(TABS.IDEAS);
        if (!aiSheet) throw new Error('Ideas tab not found');
        var aiTz      = Session.getScriptTimeZone();
        var aiNow     = new Date();
        var aiDateStr = Utilities.formatDate(aiNow, aiTz, 'yyyy-MM-dd');
        var aiDateKey = Utilities.formatDate(aiNow, aiTz, 'yyyyMMdd');
        var aiLastRow = aiSheet.getLastRow();
        var aiCount   = 1;
        if (aiLastRow >= 2) {
          var aiIds = aiSheet.getRange(2, 1, aiLastRow - 1, 1).getValues();
          aiIds.forEach(function(r) {
            if (String(r[0]).indexOf('IDEA-' + aiDateKey) === 0) aiCount++;
          });
        }
        var aiId = 'IDEA-' + aiDateKey + '-' + (aiCount < 10 ? '0' + aiCount : String(aiCount));
        aiSheet.getRange(aiLastRow + 1, 1, 1, IDEA_HEADERS.length).setValues([[
          aiId, aiDateStr, aiText, (args[1] || '').trim(), (args[2] || '').trim(), '', 'New'
        ]]);
        executed.push(type + ' (' + aiId + ')');
      }
      else if (type === 'promote_idea') {
        var piId = (args[0] || '').trim();
        if (!piId) throw new Error('Idea ID required');
        var piResult = webPromoteIdea_({ parameter: { id: piId } });
        executed.push(type + ' (task: ' + piResult.taskId + ')');
      }
      else if (type === 'archive_idea') {
        var arId = (args[0] || '').trim();
        if (!arId) throw new Error('Idea ID required');
        var arFound = findIdeaRow_(arId);
        arFound.sheet.getRange(arFound.rowNum, 7).setValue('Archived');
        executed.push(type + ' (' + arId + ')');
      }

      // ---- Itinerary --------------------------------------------------------
      else if (type === 'add_itinerary_item') {
        webAddItineraryItem_(makeFakeEvent_({
          tripKey:   args[0] || '',
          type:      args[1] || 'manual',
          title:     args[2] || '',
          date:      args[3] || '',
          startTime: args[4] || '',
          endTime:   args[5] || '',
          location:  args[6] || '',
          notes:     args[7] || '',
        }));
        executed.push('add_itinerary_item (' + (args[2] || '') + ' on ' + (args[3] || '') + ')');
      }
      else if (type === 'update_itinerary_item') {
        var uitParams = { id: args[0] || '' };
        uitParams[args[1] || ''] = args[2] || '';
        webUpdateItineraryItem_(makeFakeEvent_(uitParams));
        executed.push('update_itinerary_item (' + args[0] + ' ' + args[1] + '=' + args[2] + ')');
      }
      else if (type === 'delete_itinerary_item') {
        webDeleteItineraryItem_(makeFakeEvent_({ id: args[0] || '' }));
        executed.push('delete_itinerary_item (' + args[0] + ')');
      }
      else if (type === 'set_trip_context') {
        webSetTripMeta_(makeFakeEvent_({ tripKey: args[0] || '', context: args[1] || '', notes: '' }));
        executed.push('set_trip_context (' + args[0] + ' \u2192 ' + args[1] + ')');
      }

      // ---- Packing ----------------------------------------------------------
      else if (type === 'add_packing_item') {
        webAddPackingItem_(makeFakeEvent_({
          tripKey:  args[0] || '',
          person:   args[1] || 'shared',
          category: args[2] || 'General',
          item:     args[3] || '',
        }));
        executed.push('add_packing_item (' + (args[3] || '') + ' for ' + (args[1] || 'shared') + ')');
      }
      else if (type === 'check_packing_item') {
        webUpdatePackingItem_(makeFakeEvent_({ id: args[0] || '', checked: args[1] || 'true' }));
        executed.push('check_packing_item (' + args[0] + ' = ' + args[1] + ')');
      }
      else if (type === 'delete_packing_item') {
        webDeletePackingItem_(makeFakeEvent_({ id: args[0] || '' }));
        executed.push('delete_packing_item (' + args[0] + ')');
      }
      else if (type === 'generate_packing_list') {
        webGeneratePacking_(makeFakeEvent_({ tripKey: args[0] || '', startDate: args[1] || '', endDate: args[2] || '' }));
        executed.push('generate_packing_list (' + args[0] + ')');
      }

      // ---- Project tasks ----------------------------------------------------
      else if (type === 'add_project_task') {
        var ptProjId = findProjectIdByName_(args[0]);
        if (!ptProjId) throw new Error('Project not found: ' + args[0]);
        webAddProjectTask_(makeFakeEvent_({
          projectId: ptProjId,
          task:      args[1] || '',
          priority:  args[2] || 'Medium',
          dueDate:   args[3] || '',
        }));
        executed.push('add_project_task (' + (args[1] || '') + ' \u2192 ' + args[0] + ')');
      }
      else if (type === 'complete_project_task') {
        var cptRow = findProjectTaskRow_(args[0], args[1]);
        if (!cptRow) throw new Error('Project task not found: ' + args[1] + ' in ' + args[0]);
        webCompleteProjectTask_(cptRow);
        executed.push('complete_project_task (' + (args[1] || '') + ')');
      }
      else if (type === 'delete_project_task') {
        var dptRow = findProjectTaskRow_(args[0], args[1]);
        if (!dptRow) throw new Error('Project task not found: ' + args[1] + ' in ' + args[0]);
        webDeleteProjectTask_(makeFakeEvent_({ row: String(dptRow) }));
        executed.push('delete_project_task (' + (args[1] || '') + ')');
      }

      // ---- Existing gaps ---------------------------------------------------
      else if (type === 'recipe_to_shopping') {
        var rtsRow = parseInt(args[0], 10);
        if (isNaN(rtsRow) || rtsRow < 2) throw new Error('Invalid recipe row: ' + args[0]);
        var rtsSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
        if (!rtsSheet) throw new Error('Recipes tab not found');
        var rtsIngrRaw = String(rtsSheet.getRange(rtsRow, 6).getValue() || '').trim();
        var rtsIngr    = rtsIngrRaw.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
        if (rtsIngr.length === 0) throw new Error('No ingredients found in recipe row ' + rtsRow);
        addRecipeIngredients_(rtsIngr);
        executed.push('recipe_to_shopping (row ' + rtsRow + ', ' + rtsIngr.length + ' ingredients)');
      }
      else if (type === 'delete_home_item') {
        webDeleteHomeItem_(makeFakeEvent_({ row: args[0] || '' }));
        executed.push('delete_home_item (row ' + args[0] + ')');
      }
      else if (type === 'update_idea') {
        var uiParams = { id: args[0] || '' };
        uiParams[args[1] || ''] = args[2] || '';
        webUpdateIdea_(makeFakeEvent_(uiParams));
        executed.push('update_idea (' + args[0] + ' ' + args[1] + '=' + args[2] + ')');
      }
      else if (type === 'toggle_shopping_item') {
        var allStores = getShoppingList_();
        var storeQ    = (args[0] || '').toLowerCase();
        var tgtStore  = null;
        for (var tsi = 0; tsi < allStores.length; tsi++) {
          if (allStores[tsi].storeName.toLowerCase().indexOf(storeQ) >= 0 ||
              allStores[tsi].tabId.toLowerCase().indexOf(storeQ) >= 0) {
            tgtStore = allStores[tsi];
            break;
          }
        }
        if (!tgtStore) throw new Error('Shopping store not found: ' + args[0]);
        var itemQ   = (args[1] || '').toLowerCase();
        var tgtItem = null;
        for (var tii = 0; tii < tgtStore.items.length; tii++) {
          if (tgtStore.items[tii].text.toLowerCase().indexOf(itemQ) >= 0) {
            tgtItem = tgtStore.items[tii];
            break;
          }
        }
        if (!tgtItem) throw new Error('Shopping item not found: ' + args[1] + ' in ' + args[0]);
        webToggleShoppingItem_(makeFakeEvent_({ tabId: tgtStore.tabId, index: tgtItem.index }));
        executed.push('toggle_shopping_item (' + args[1] + ' in ' + args[0] + ')');
      }

    } catch (e) {
      Logger.log('Action error [' + type + ']: ' + e.message);
      errors.push(type + ': ' + e.message);
    }
  });

  return { executed: executed, errors: errors };
}

function stripActions_(text) {
  return text.replace(/^ACTION:\w+\|[^\n]*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Process a single user message (and optional image) and return VERA's reply.
 * Loads history, calls Claude, executes any actions, saves history.
 *
 * @param {string}      userMessage   - The user's text (may be empty when image is provided)
 * @param {string}      sessionId     - 'dashboard' or Telegram chatId
 * @param {string|null} imageBase64   - Optional base64-encoded image data
 * @param {string|null} imageMimeType - MIME type of image (e.g. 'image/jpeg', 'image/png')
 * @returns {{ ok: boolean, reply: string }}
 */
function processChat_(userMessage, sessionId, imageBase64, imageMimeType) {
  sessionId = sessionId || 'dashboard';

  // Allow image-only messages (no text required when an image is attached)
  if (!userMessage && !imageBase64) {
    return { ok: true, reply: 'What can I help you with?' };
  }

  var history   = loadChatHistory_(sessionId);
  var context   = buildChatContext_();
  var sysPrompt = buildChatSystemPrompt_(context);
  var callResult = callClaudeChat_(
    (userMessage || '').trim(), history, sysPrompt,
    imageBase64   || null,
    imageMimeType || null
  );
  var rawReply = callResult.text;
  var sources  = callResult.sources || [];
  Logger.log('VERA raw reply:\n' + rawReply); // visible in Apps Script Execution Log

  // Execute any actions Claude embedded
  var actionResult = executeActions_(rawReply);

  // Strip ACTION lines before returning to user
  var cleanReply = stripActions_(rawReply);

  // Surface any action failures so the user knows something went wrong
  if (actionResult.errors.length > 0) {
    cleanReply += '\n\n⚠️ Note: some actions could not be completed — ' + actionResult.errors.join('; ') + '.';
  }

  // Persist this exchange — store [Image attached] placeholder, NEVER raw base64
  // (Script Properties have a 9 KB-per-property limit; base64 images are 100 KB+)
  var historyText = (userMessage || '').trim();
  if (imageBase64) historyText = (historyText ? historyText + ' ' : '') + '[Image attached]';
  saveChatHistory_(sessionId, historyText, cleanReply);

  return { ok: true, reply: cleanReply, sources: sources };
}

// ============================================================
// DEBUG HELPERS  (run from Apps Script editor)
// ============================================================

function clearChatHistory(sessionId) {
  sessionId = sessionId || 'dashboard';
  PropertiesService.getScriptProperties().deleteProperty(CHAT_HISTORY_PREFIX + sessionId);
  Logger.log('Chat history cleared for: ' + sessionId);
}

function testChat() {
  var result = processChat_('What are my active flags right now?', 'test');
  Logger.log('VERA reply:\n' + result.reply);
}
