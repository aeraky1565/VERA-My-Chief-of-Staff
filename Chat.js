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

  var importantDatesLines = (function() {
    var dates = context.importantDates;
    if (!dates || dates.length === 0) return '  (none in next 90 days)';
    return dates.map(function(d) {
      var days = d['daysUntil'];
      var when = days === 0 ? 'TODAY' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      return '  [' + String(d['ID'] || '') + '] ' + String(d['Label'] || '') +
             ' — ' + String(d['Date'] || '') +
             ' (' + when + ')' +
             (d['Person'] ? ' [' + d['Person'] + ']' : '') +
             (d['Notes']  ? ' — ' + String(d['Notes']).substring(0, 60) : '');
    }).join('\n');
  })();

  var giftIdeasLines = (function() {
    var ideas = context.giftIdeas;
    if (!ideas || ideas.length === 0) return '  (none saved)';
    var byPerson = {};
    ideas.forEach(function(i) {
      var p = String(i['Person'] || 'Unknown');
      if (!byPerson[p]) byPerson[p] = [];
      byPerson[p].push(String(i['Idea'] || ''));
    });
    var lines = '';
    Object.keys(byPerson).forEach(function(p) {
      lines += '  ' + p + ': ' + byPerson[p].join('; ') + '\n';
    });
    return lines.trim();
  })();

  var wishListLines = (!context.wishList || context.wishList.length === 0)
    ? '  (empty)'
    : context.wishList.map(function(w) {
        return '  [' + w.id + '] ' + w.item +
               ' (' + w.person + ')' +
               (w.price ? ' — $' + w.price : '') +
               ' [' + w.priority + ' priority, ' + w.status + ']' +
               (w.category ? ' [' + w.category + ']' : '');
      }).join('\n');

  var experimentLines = (!context.experiments || context.experiments.length === 0)
    ? '  (none active)'
    : context.experiments.map(function(ex) {
        var line = '  [' + ex.id + '] ' + ex.title +
                   ' (' + ex.person + ') — ' + ex.status +
                   (ex.category ? ' [' + ex.category + ']' : '') +
                   (ex.startDate ? ' | started: ' + ex.startDate : '') +
                   (ex.endDate ? ' | ends: ' + ex.endDate : '');
        if (ex.hypothesis) line += '\n    Hypothesis: ' + ex.hypothesis;
        if (ex.checkins && ex.checkins.length) {
          line += '\n    Recent check-ins: ' + ex.checkins.map(function(c) {
            return c.date + (c.note ? ' — ' + c.note : '');
          }).join(' | ');
        }
        return line;
      }).join('\n');

  var growthLines = (function() {
    if (!context.growthData) return '';
    var gd = context.growthData;
    var lines = '';
    // Books
    var reading  = (gd.books || []).filter(function(b) { return b.status === 'Reading'; });
    var wantBook = (gd.books || []).filter(function(b) { return b.status === 'Want to Read'; });
    var readDone = (gd.books || []).filter(function(b) { return b.status === 'Read'; }).slice(-5);
    if (reading.length) {
      lines += '  Currently reading:\n';
      reading.forEach(function(b) {
        lines += '    [' + b.id + '] "' + b.title + '"' + (b.author ? ' by ' + b.author : '') +
                 (b.person ? ' (' + b.person + ')' : '') + '\n';
      });
    }
    if (wantBook.length) {
      lines += '  Want to read (' + wantBook.length + ' books on backlog)\n';
    }
    if (readDone.length) {
      lines += '  Recently finished: ' + readDone.map(function(b) { return '"' + b.title + '"' + (b.rating ? ' ' + b.rating + '/5' : ''); }).join(', ') + '\n';
    }
    // Courses
    var inProg   = (gd.courses || []).filter(function(c) { return c.status === 'In Progress'; });
    var wantCrs  = (gd.courses || []).filter(function(c) { return c.status === 'Want to Do'; });
    var doneCrs  = (gd.courses || []).filter(function(c) { return c.status === 'Done'; }).slice(-3);
    if (inProg.length) {
      lines += '  In progress courses:\n';
      inProg.forEach(function(c) {
        lines += '    [' + c.id + '] "' + c.title + '"' + (c.source ? ' (' + c.source + ')' : '') +
                 (c.person ? ' — ' + c.person : '') + '\n';
      });
    }
    if (wantCrs.length) lines += '  Want to do (' + wantCrs.length + ' courses queued)\n';
    if (doneCrs.length) {
      lines += '  Recently completed courses: ' + doneCrs.map(function(c) { return '"' + c.title + '"'; }).join(', ') + '\n';
    }
    // Skills
    if ((gd.skills || []).length) {
      lines += '  Skills being built:\n';
      gd.skills.forEach(function(s) {
        lines += '    [' + s.id + '] ' + s.skill + ' — ' + s.level +
                 (s.person ? ' (' + s.person + ')' : '') +
                 (s.lastPracticed ? ' | last practiced: ' + s.lastPracticed : '') + '\n';
      });
    }
    return lines.trim() || '  (nothing logged yet)';
  })();

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

  var takeoutLines = (!context.takeouts || context.takeouts.length === 0)
    ? '  (none saved yet)'
    : context.takeouts.map(function(r) {
        var stars  = r.rating ? ' ' + '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '';
        var items  = r.items.length > 0
          ? r.items.map(function(it) {
              var iStars = it.rating ? ' ' + '★'.repeat(it.rating) + '☆'.repeat(5 - it.rating) : '';
              return '    • ' + it.item + iStars + (it.description ? ' — ' + it.description : '');
            }).join('\n')
          : '    (no items yet)';
        return '  ' + r.name + stars + (r.cuisine ? ' [' + r.cuisine + ']' : '') + '\n' + items;
      }).join('\n');

  var pantryLines = (!context.pantryDue || context.pantryDue.length === 0)
    ? '  (pantry tracking not yet active, or no purchases logged)'
    : context.pantryDue.map(function(p) {
        return '  ' + p.normalized +
               (p.daysUntil <= 0 ? ' — likely OUT' : ' — est. out in ~' + p.daysUntil + 'd') +
               (p.store ? ' (usually: ' + p.store + ')' : '') +
               ' [' + p.confidence + ']';
      }).join('\n');

  var careerLines = (function() {
    var c = context.career;
    if (!c) return '  (not yet configured)';
    var lines = '';
    if (c.position && c.position.title) {
      lines += '  Position: ' + c.position.title +
               (c.position.company ? ' at ' + c.position.company : '') +
               (c.position.startDate ? ' (since ' + c.position.startDate + ')' : '') + '\n';
      if (c.position.workStyle) lines += '  Work style: ' + c.position.workStyle + '\n';
      if (c.position.focusAreas) lines += '  Focus areas: ' + c.position.focusAreas + '\n';
    }
    if (c.goals && c.goals.length > 0) {
      lines += '  Goals (' + c.goals.length + '):\n';
      c.goals.filter(function(g) { return g.status !== 'Achieved' && g.status !== 'Paused'; })
        .forEach(function(g) {
          lines += '    [' + g.id + '] ' + g.title + ' [' + g.horizon + '] — ' + g.status + '\n';
        });
    }
    if (c.wins && c.wins.length > 0) {
      var recentWins = c.wins.slice(0, 5);
      lines += '  Recent wins:\n';
      recentWins.forEach(function(w) {
        lines += '    [' + (w.date || '') + '] ' + w.win + (w.impact ? ' — ' + w.impact : '') + '\n';
      });
    }
    return lines.trim() || '  (profile empty — set your position in the Career tab)';
  })();

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
    (context.projects !== null ? 'PROJECTS:\n' + projectsLine + '\n\n' : '') +
    'UPCOMING CALENDAR EVENTS (raw schedule data — do NOT infer travel from multi-day events here; use UPCOMING TRIPS for travel context):\n' + calLines + '\n\n' +
    (context.interests !== null ? 'SHARED INTEREST LEDGER (top 20):\n' + interestLines + '\n\n' : '') +
    (context.importantDates !== null ? 'IMPORTANT DATES (next 90 days):\n' + importantDatesLines + '\n\n' : '') +
    (context.giftIdeas !== null ? 'GIFT IDEAS:\n' + giftIdeasLines + '\n\n' : '') +
    (context.wishList !== null ? 'WISH LIST (active items):\n' + wishListLines + '\n\n' : '') +
    (context.experiments !== null ? 'EXPERIMENTS (active/ongoing/paused):\n' + experimentLines + '\n\n' : '') +
    (context.growthData !== null ? 'GROWTH \u2014 BOOKS, COURSES & SKILLS:\n' + growthLines + '\n\n' : '') +
    (context.memoryContext ? 'MEMORY LOG (recent events + weekly snapshots):\n' + context.memoryContext + '\n\n' : '') +
    (context.goals !== null ? 'YEARLY GOALS (active):\n' + goalLines + '\n\n' : '') +
    'PTO STATUS:\n' + ptoSection + '\n\n' +
    (context.bills !== null ? 'BILLS (' + context.bills.length + '):\n' + billLines + '\n\n' : '') +
    (context.recipes !== null ? 'RECIPES (' + context.recipes.length + '):\n' + recipeLines + '\n\n' : '') +
    (context.homeItems !== null ? 'HOME ITEMS (' + context.homeItems.length + '):\n' + homeItemLines + '\n\n' : '') +
    (context.shoppingStores !== null ? 'SHOPPING STORES: ' + shoppingStoresList + '\n\n' : '') +
    (context.takeouts !== null ? 'FAVORITE TAKEOUTS (' + context.takeouts.length + '):\n' + takeoutLines + '\n\n' : '') +
    (context.pantryDue !== null ? 'PANTRY \u2014 ITEMS DUE SOON (next 14 days):\n' + pantryLines + '\n\n' : '') +
    (context.career !== null ? 'CAREER PROFILE:\n' + careerLines + '\n\n' : '') +
    (function() {
      if (context.gymLog === null) return '';
      var gl = context.gymLog || [];
      var pending = gl.filter(function(s) { return !s.attended; });
      var recent  = gl.filter(function(s) { return  s.attended; }).slice(-10);
      var lines = 'GYM LOG (last 28 days):\n';
      if (pending.length) {
        lines += '  Awaiting check-in:\n';
        pending.forEach(function(s) { lines += '    [' + s.id + '] ' + s.title + ' — ' + s.date + '\n'; });
      }
      if (recent.length) {
        lines += '  Recent history:\n';
        recent.forEach(function(s) {
          lines += '    ' + s.date + ' — ' + (s.attended === 'Yes' ? '✓ Attended' : '✗ Skipped') + ' (' + s.title + ')\n';
        });
      }
      if (!pending.length && !recent.length) lines += '  (no sessions logged)\n';
      return lines + '\n';
    })() +
    (function() {
      if (context.prescriptions === null) return '';
      var rxList = context.prescriptions || [];
      var active = rxList.filter(function(r) { return r.active === 'Yes'; });
      if (!active.length) return 'PRESCRIPTIONS: (none on file)\n\n';
      var byPerson = {};
      active.forEach(function(r) {
        if (!byPerson[r.person]) byPerson[r.person] = [];
        byPerson[r.person].push(r);
      });
      var lines = 'PRESCRIPTIONS:\n';
      Object.keys(byPerson).forEach(function(person) {
        lines += '  ' + person + ':\n';
        byPerson[person].forEach(function(r) {
          lines += '    ' + r.medication +
            (r.dosage ? ' ' + r.dosage : '') +
            (r.frequency ? ' — ' + r.frequency : '') +
            (r.refillDate ? ' — refill ' + r.refillDate : ' — no refill date') + '\n';
        });
      });
      return lines + '\n';
    })() +
    (function() {
      if (context.cardsData === null) return '';
      var cd = context.cardsData;
      if (!cd || !cd.cards || !cd.cards.length) return 'CREDIT CARDS: (none on file)\n\n';
      var now = new Date(); now.setHours(0,0,0,0);
      var curMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
      var curYear  = String(now.getFullYear());
      var activeCards = cd.cards.filter(function(c) { return c.active === 'Yes'; });
      // Group by owner
      var byOwner = {};
      activeCards.forEach(function(c) {
        var o = c.owner || 'Ahmed';
        if (!byOwner[o]) byOwner[o] = [];
        byOwner[o].push(c);
      });
      var lines = 'CREDIT CARDS (active only):\n';
      var inactiveWarn = [];
      Object.keys(byOwner).forEach(function(owner) {
        lines += '  ' + owner + ':\n';
        byOwner[owner].forEach(function(c) {
          // Reward summary
          var cardRw = (cd.rewards || []).filter(function(r) { return r.cardName === c.cardName; });
          var rwStr  = cardRw.map(function(r) { return r.category + ' ' + r.rate + ' ' + r.rateType + (r.conditions ? ' (' + r.conditions + ')' : ''); }).join(', ');
          // Inactivity check
          var lastUsed = c.lastUsed ? c.lastUsed : null;
          var daysAgo  = lastUsed ? Math.round((now - new Date(lastUsed)) / 86400000) : null;
          if (daysAgo == null || daysAgo > 60) inactiveWarn.push(c.cardName + ' (' + owner + ')');
          // Unused perks this month
          var cardPerks = (cd.perks || []).filter(function(p) { return p.cardName === c.cardName; });
          var unusedPerks = cardPerks.filter(function(p) {
            var period = p.frequency === 'Annual' ? curYear : curMonth;
            return p.lastUsed !== period;
          });
          var authLabel = c.authUser ? ' [+' + c.authUser + ' auth user]' : '';
          lines += '    ' + c.cardName + authLabel + ': ' + (rwStr || '(no rewards defined)') + '\n';
          if (c.statementCredit) lines += '      Statement credit: ' + c.statementCredit + '\n';
          if (lastUsed) lines += '      Last used: ' + lastUsed + (daysAgo != null ? ' (' + daysAgo + ' days ago)' : '') + '\n';
          if (unusedPerks.length) lines += '      Unused perks this month: ' + unusedPerks.map(function(p) { return p.perk; }).join(', ') + '\n';
        });
      });
      if (inactiveWarn.length) lines += '  ⚠ Inactivity risk (>60 days unused): ' + inactiveWarn.join(', ') + '\n';
      return lines + '\n';
    })() +
    (function() {
      var cd = context.cardsData;
      if (!cd || (!cd.programs || !cd.programs.length) && (!cd.goals || !cd.goals.length)) return '';
      var now = new Date(); now.setHours(0,0,0,0);
      var lines = 'LOYALTY PROGRAMS:\n';
      (cd.programs || []).forEach(function(pg) {
        var estVal = Math.round(pg.totalPoints * (pg.centsPerPoint || 1) / 100);
        var ds90   = pg.expiry && pg.expiry !== 'Never' ? Math.round((new Date(pg.expiry) - now) / 86400000) : null;
        lines += '  ' + pg.program + ': ' + Number(pg.totalPoints).toLocaleString() + ' pts ($' + estVal.toLocaleString() + ' est.)';
        if (pg.bestUse) lines += ' — best for ' + pg.bestUse;
        if (ds90 != null && ds90 <= 90) lines += ' ⚠ EXPIRING in ' + ds90 + ' days (' + pg.expiry + ')';
        lines += '\n';
      });
      if (cd.goals && cd.goals.length) {
        lines += 'REWARDS GOALS:\n';
        cd.goals.forEach(function(g) {
          var pct    = g.targetPoints > 0 ? Math.round(g.currentPoints / g.targetPoints * 100) : 0;
          var needed = Math.max(0, g.targetPoints - g.currentPoints);
          lines += '  ' + g.goal + ': ' + Number(g.currentPoints).toLocaleString() + '/' + Number(g.targetPoints).toLocaleString() + ' ' + g.targetProgram;
          lines += ' (' + pct + '%) — need ' + Number(needed).toLocaleString() + ' more\n';
        });
      }
      return lines + '\n';
    })() +
    // ---- THOUGHT INBOX -------------------------------------------------------
    (function() {
      var thoughts = (context.ideas || []).filter(function(i) { return i.status === 'Thought'; });
      if (!thoughts.length) return '';
      var lines = 'THOUGHT INBOX (' + thoughts.length + ' unreviewed thought(s) from chat):\n';
      thoughts.forEach(function(t) {
        lines += '  \u2022 [' + t.id + '] ' + t.idea + ' (captured ' + t.dateAdded + ')\n';
      });
      return lines + '\n';
    })() +
    (context.ideas !== null ? 'IDEA BRAINDUMP (' + context.ideas.length + '):\n' + ideaLines + '\n\n' : '') +

    (function() {
      var travel = context.travel;
      if (!travel || !travel.trips || travel.trips.length === 0) {
        return 'UPCOMING TRIPS:\n  (No upcoming trips found)\n\n';
      }
      var lines = 'UPCOMING TRIPS:\n';
      travel.trips.forEach(function(t) {
        var tk      = t.startDate + '|' + t.label;
        var ctx     = (travel.tripContextMap && travel.tripContextMap[tk]) || '';
        var famNote = t.isExtendedFamily ? ' [extended family — not Ahmed\'s trip]' : '';
        lines += 'Trip: ' + t.label + ' (' + t.startDate + ' \u2013 ' + t.endDate + ')' +
                 (ctx ? ' | Context: ' + ctx : '') + famNote + ' | TripKey: ' + tk + '\n';
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

    // ---- RECENTLY COMPLETED TRIPS --------------------------------------------
    (function() {
      if (!context.recentTrips || !context.recentTrips.length) return '';
      var lines = 'RECENTLY COMPLETED TRIPS:\n';
      context.recentTrips.forEach(function(t) {
        lines += '  \u2022 ' + t.tripLabel +
                 ' (ended ' + Math.round(t.daysAgo) + ' day(s) ago)' +
                 ' | TripKey: ' + t.tripKey + '\n';
      });
      return lines + '\n';
    })() +

    // ---- UPCOMING HOUSE GUESTS (Issue #150) ---------------------------------
    (function() {
      if (!context.upcomingGuests || !context.upcomingGuests.length) return '';
      var lines = 'UPCOMING HOUSE GUESTS (' + context.upcomingGuests.length + '):\n';
      context.upcomingGuests.forEach(function(g) {
        var when = g.daysAway === 0 ? 'today' : (g.daysAway === 1 ? 'tomorrow' : 'in ' + g.daysAway + ' days');
        lines += '  \u2022 ' + g.label + ' \u2014 arriving ' + g.arrivalDate +
                 ', departing ' + g.departureDate +
                 ' (' + g.durationDays + ' night' + (g.durationDays === 1 ? '' : 's') + ', ' + when + ')\n';
      });
      return lines + '\n';
    })() +

    // ---- COUNTRIES VISITED ---------------------------------------------------
    (function() {
      if (!context.countries || !context.countries.length) return '';
      var lines = 'COUNTRIES VISITED (' + context.countries.length + ' total):\n';
      context.countries.forEach(function(c) {
        var line = '  \u2022 [' + c['ID'] + '] ' + c['Country'];
        if (c['City'])       line += ', ' + c['City'];
        if (c['Year'])       line += ' (' + c['Year'] + ')';
        if (c['Traveller'] && c['Traveller'] !== 'Both') line += ' [' + c['Traveller'] + ']';
        if (c['Notes'])      line += ' \u2014 ' + c['Notes'];
        lines += line + '\n';
      });
      return lines + '\n';
    })() +

    // ---- TRAVEL BUCKET LIST --------------------------------------------------
    (function() {
      if (!context.bucketList || !context.bucketList.length) return '';
      var lines = 'TRAVEL BUCKET LIST (' + context.bucketList.length + ' destinations):\n';
      context.bucketList.forEach(function(b) {
        var stars = b['Stars'] ? '\u2605'.repeat(Math.min(5, Number(b['Stars']))) : '';
        var line  = '  \u2022 [' + b['ID'] + '] ' + b['Country'];
        if (b['City'])        line += ', ' + b['City'];
        if (stars)            line += ' [' + stars + ']';
        if (b['Target Year']) line += ' \u2014 target ' + b['Target Year'];
        if (b['Dream Trip'])  line += ' \uD83C\uDF1F';
        if (b['Notes'])       line += ' \u2014 ' + b['Notes'];
        if (b['Visited'])     line += ' \u2705 visited';
        lines += line + '\n';
      });
      return lines + '\n';
    })() +

    // ---- Financial Goals (Issue #127) ----------------------------------------
    (function() {
      var fgoals = (context.financialGoals || []).filter(function(g) { return g.status === 'Active'; });
      if (!fgoals.length) return '';
      var lines = 'FINANCIAL GOALS (' + fgoals.length + ' active):\n';
      fgoals.forEach(function(g) {
        var pct  = g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0;
        var line = '  • [' + g.id + '] ' + g.name + ' — $' + g.currentAmount.toLocaleString() + ' / $' + g.targetAmount.toLocaleString() + ' (' + pct + '%)';
        if (g.monthlyContribution > 0) line += ' | $' + g.monthlyContribution.toLocaleString() + '/mo';
        if (g.targetDate)              line += ' | target: ' + g.targetDate;
        if (g.owner && g.owner !== 'Joint') line += ' [' + g.owner + ']';
        lines += line + '\n';
      });
      return lines + '\n';
    })() +

    // ---- REFERENCE RESOURCES (Issue #129) ------------------------------------
    (function() {
      var resList = context.resources;
      if (!resList || !resList.length) return '';
      var lines = 'REFERENCE RESOURCES (' + resList.length + ' document' + (resList.length === 1 ? '' : 's') + '):\n';
      lines += 'These are documents the user has uploaded for VERA to consult. ';
      lines += 'If a question relates to one of these, say so and offer to read it. ';
      lines += 'Use fetch_resource_content action to retrieve the actual text.\n';
      resList.forEach(function(r) {
        var canRead   = String(r['Drive File ID'] || '').trim() ? ' [readable]' : ' [link-only]';
        var appliesTo = String(r['Applies To'] || 'Both').trim();
        var whoTag    = appliesTo !== 'Both' ? ' [' + appliesTo + ' only]' : '';
        lines += '  \u2022 [' + r['ID'] + '] ' + r['Name'] + ' [' + r['Category'] + ']' + whoTag + canRead + '\n';
        if (r['Description']) lines += '    ' + r['Description'] + '\n';
        if (r['Tags']) lines += '    Tags: ' + r['Tags'] + '\n';
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
    'ACTION:add_thought|{raw thought text}  \u2014 capture an unfiltered thought from chat; no category or tags needed\n' +
    'ACTION:shelve_thought|{ideaId}|{category}  \u2014 graduate a parked thought into a proper idea; category from General/Home/Finance/Health/Career/Personal/Travel/Other\n' +
    'ACTION:promote_idea|{ideaId}\n' +
    'ACTION:archive_idea|{ideaId}\n' +
    // Travel — Itinerary
    'ACTION:add_itinerary_item|{tripKey}|{type}|{title}|{date YYYY-MM-DD}|{startTime HH:MM or blank}|{endTime HH:MM or blank}|{location or blank}|{notes or blank}\n' +
    '  \u2014 type options: flight, train, cruise, ferry, hotel, arranged_stay, dining, museum, beach, show, spa, skiing, snorkeling, theme_park, shopping, market, manual\n' +
    '  \u2014 use arranged_stay (not hotel) when staying informally with friends/family or at a private/rental accommodation with no formal hotel reservation\n' +
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
    // Interests
    'ACTION:add_interest|{person}|{interest}|{category}|{notes}\n' +
    '  \u2014 person = Ahmed or Victoria; category = Food/Travel/Fitness/Culture/Hobbies/Learning/Other\n' +
    // Bills
    'ACTION:delete_bill|{row_number}  \u2014 row from BILLS context above (e.g. "3" for [row:3]). Always confirm the bill name first.\n' +
    // Countries
    'ACTION:add_country|{country}|{city}|{year}|{traveller}|{notes}\n' +
    '  \u2014 traveller = Ahmed / Victoria / Both. year = YYYY or blank.\n' +
    'ACTION:delete_country|{id}  \u2014 id from COUNTRIES VISITED context above. Always confirm first.\n' +
    // Bucket List
    'ACTION:add_bucket_item|{country}|{city}|{targetYear}|{traveller}|{stars}|{dreamTrip}|{notes}\n' +
    '  \u2014 stars = 1-5 priority rating; dreamTrip = yes or short description. Use blank for unknown fields.\n' +
    'ACTION:update_bucket_item|{id}|{field}|{value}  \u2014 field = visited (value = date or "yes") | stars (value = 1-5)\n' +
    'ACTION:delete_bucket_item|{id}  \u2014 id from TRAVEL BUCKET LIST context above. Always confirm first.\n' +
    'ACTION:add_gym_sessions|{YYYY-MM-DD}|{Trip Label}  \u2014 schedules morning gym sessions on all interior days of a trip (skips arrival + departure day)\n' +
    'ACTION:log_gym_attend_latest|yes  \u2014 marks the most recent pending gym session as attended\n' +
    'ACTION:log_gym_attend_latest|no   \u2014 marks the most recent pending gym session as skipped\n' +
    'ACTION:log_receipt_items|{item}|{category}|{qty}|{unit}|{store}|{price}  \u2014 one line per item from a receipt or grocery image; qty/price blank if unclear\n' +
    // Takeouts (Issue #112)
    'ACTION:add_takeout_restaurant|{name}|{cuisine}|{phone}|{website}|{rating 1-5 or blank}|{notes}\n' +
    'ACTION:add_takeout_item|{restaurant_name}|{item}|{description}|{rating 1-5 or blank}|{notes}\n' +
    'ACTION:delete_takeout_restaurant|{restaurant_name}\n' +
    'ACTION:delete_takeout_item|{restaurant_name}|{item_name}\n' +
    // Pantry (Issue #111)
    'ACTION:add_purchase|{item}|{category}|{qty}|{unit}|{store}|{price}  \u2014 manually log a grocery/household purchase; qty/unit/store/price blank if unknown\n' +
    // Career
    'ACTION:add_career_win|{win}|{impact}|{category}|{date YYYY-MM-DD or blank}  \u2014 log a professional achievement\n' +
    'ACTION:add_career_goal|{title}|{horizon 1yr/3yr/5yr/10yr}|{category}|{notes}  \u2014 record a career goal\n' +
    'ACTION:update_career_position|{field}|{value}  \u2014 update position; field = title/company/department/workStyle/focusAreas/notes\n' +
    // Prescriptions (Issue #116)
    'ACTION:add_prescription|{person}|{medication}|{dosage}|{frequency}|{refillDate YYYY-MM-DD or blank}|{notes}  \u2014 add a prescription for Ahmed or Victoria\n' +
    'ACTION:mark_prescription_refilled|{person}|{medication}|{newRefillDate YYYY-MM-DD}  \u2014 update lastFilled=today and refillDate for a prescription\n' +
    // Credit Card Hub (Issues #115 + #117)
    'ACTION:log_card_used|{card_name}  \u2014 mark a credit card as used today (sets Last Used = today)\n' +
    'ACTION:update_loyalty_points|{program}|{new_total}  \u2014 update a loyalty program\'s point balance\n' +
    // Resources (Issue #129)
    'ACTION:fetch_resource_content|{resourceId}  \u2014 read a reference document\'s text (Google Docs only); resourceId from REFERENCE RESOURCES above\n' +
    // Important Dates (Issue #80)
    'ACTION:add_important_date|{person}|{date}|{label}|{recurring: Yes or No}|{leadTimeDays: number}  \u2014 add a date to the Important Dates tracker; date = MM-DD or YYYY-MM-DD; person = Ahmed / Victoria / Both / Family\n' +
    'ACTION:log_gift_idea|{person}|{idea}  \u2014 save a gift idea for a person to the Gift Ideas ledger\n' +
    // Wish List (Issue #131)
    'ACTION:add_wish_item|{person}|{item}|{category}|{price or blank}|{priority}|{urls or blank}|{notes or blank}  \u2014 add to wish list; person=Ahmed/Victoria/Both; category=Tech/Home & Furniture/Experiences/Fashion/Fitness/Books & Media/Other; priority=High/Medium/Low\n' +
    'ACTION:update_wish_item|{id}|{field}|{value}  \u2014 update wish list item field; field=person/category/item/description/urls/price/priority/status/notes\n' +
    'ACTION:mark_wish_purchased|{id}  \u2014 mark wish list item as purchased\n' +
    'ACTION:delete_wish_item|{id}  \u2014 remove wish list item\n' +
    // Experiments (Issue #130)
    'ACTION:add_experiment|{person}|{title}|{category}|{hypothesis}|{startDate: YYYY-MM-DD or blank}|{endDate: YYYY-MM-DD or blank}|{notes or blank}  \u2014 add a new experiment; person=Ahmed/Victoria/Both; category=Health/Fitness/Diet/Sleep/Productivity/Learning/Mental/Finance/Other\n' +
    'ACTION:update_experiment|{id}|{field}|{value}  \u2014 update experiment field; field=person/title/category/hypothesis/startdate/enddate/status/outcome/rating/notes\n' +
    'ACTION:log_experiment_checkin|{id}|{note}  \u2014 add a check-in note to an experiment\n' +
    'ACTION:delete_experiment|{id}  \u2014 remove an experiment\n' +
    // Growth — Books, Courses, Skills (Issue #88)
    'ACTION:add_book|{person}|{title}|{author or blank}|{category or blank}|{status}|{rating 1-5 or blank}|{notes or blank}  \u2014 add a book; person=Ahmed/Victoria; status=Want to Read/Reading/Read\n' +
    'ACTION:update_book|{id}|{field}|{value}  \u2014 update book field; field=person/title/author/category/status/rating/datestarted/datefinished/notes\n' +
    'ACTION:delete_book|{id}  \u2014 remove a book\n' +
    'ACTION:add_course|{person}|{title}|{source or blank}|{category or blank}|{status}|{rating 1-5 or blank}|{notes or blank}  \u2014 add a course/content; person=Ahmed/Victoria; status=Want to Do/In Progress/Done; source=platform e.g. Coursera/YouTube/Podcast\n' +
    'ACTION:update_course|{id}|{field}|{value}  \u2014 update course field; field=person/title/source/category/status/rating/datestarted/datefinished/notes\n' +
    'ACTION:delete_course|{id}  \u2014 remove a course\n' +
    'ACTION:add_skill|{person}|{skill}|{category or blank}|{level}|{goalLink or blank}|{notes or blank}  \u2014 add a skill; person=Ahmed/Victoria; level=Beginner/Intermediate/Advanced/Expert\n' +
    'ACTION:update_skill|{id}|{field}|{value}  \u2014 update skill field; field=person/skill/category/level/goallink/notes\n' +
    'ACTION:record_skill_practice|{id}  \u2014 mark a skill as practiced today\n' +
    'ACTION:delete_skill|{id}  \u2014 remove a skill\n' +
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
    '- For add_thought: use PROACTIVELY \u2014 when Ahmed mentions something capturable mid-conversation (a half-formed plan, "I\'ve been thinking about X", "random thought", "some day I want to", "what if we tried", "I should look into", "maybe we should", "I wonder if"), silently capture it with add_thought and mention "I\'ve parked that as a thought for later." Do NOT require Ahmed to explicitly ask. Use add_idea for intentional, structured braindump entries with a clear category. Use add_thought for anything raw, unfiltered, or passing.\n' +
    '- For shelve_thought: use during triage when Ahmed wants to properly categorize a thought. Use the thought ID from THOUGHT INBOX above. Category must be one of: General/Home/Finance/Health/Career/Personal/Travel/Other. After shelving, confirm what category it was assigned.\n' +
    '- For add_idea: capture intentional, structured braindump entries. Category options: General/Home/Finance/Health/Career/Personal/Travel/Other. Tags are optional, comma-separated. Use when Ahmed says "add this as an idea", "note this idea", or provides explicit category context.\n' +
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
    '- For add_interest: use this (not log_interest) when Ahmed explicitly asks to "add" or "save" an interest. log_interest is for auto-capturing mentions mid-conversation.\n' +
    '- For delete_bill: pass the row number from BILLS above (e.g., "3" for [row:3]). Always confirm the bill name with Ahmed before deleting.\n' +
    '- For add_country: log a country Ahmed or Victoria has visited. year is optional. traveller = Ahmed/Victoria/Both.\n' +
    '- For delete_country: use the ID from COUNTRIES VISITED above. Always confirm the country with Ahmed before deleting.\n' +
    '- For add_bucket_item: stars is 1–5 (5 = dream destination). dreamTrip = "yes" or a short description like "Cherry blossom season". Use blank for unknown fields.\n' +
    '- For update_bucket_item: use the ID from TRAVEL BUCKET LIST. field = "visited" (mark as visited with date/yes) or "stars" (update priority).\n' +
    '- For delete_bucket_item: use the ID from TRAVEL BUCKET LIST above. Always confirm the destination with Ahmed before deleting.\n' +
    '- For add_gym_sessions: use when Ahmed says "add gym sessions to the [trip] itinerary" or asks to schedule workouts during travel. ' +
    'Emit ACTION:add_gym_sessions|{departureDate}|{tripLabel} using the TripKey parts (e.g. TripKey "2026-06-19|Alaska Cruise" \u2192 ' +
    '"ACTION:add_gym_sessions|2026-06-19|Alaska Cruise"). Confirm how many blocks were added after execution.\n' +
    '- For log_gym_attend_latest: use when Ahmed says he went to the gym, finished a workout, hit the gym, did his session, or conversely that he skipped/missed/did not go. ' +
    'Emit ACTION:log_gym_attend_latest|yes for attended, ACTION:log_gym_attend_latest|no for skipped. ' +
    'After logging, confirm the session date and include the weekly attended count (count "Yes" entries from GYM LOG above for the current week).\n' +
    '- For log_receipt_items: when Ahmed uploads an image of a receipt, grocery haul, or fridge contents, ' +
    'extract all visible items and emit one log_receipt_items ACTION per item. Use canonical lowercase names ' +
    '(e.g. "milk" not "Kirkland 2% Reduced Fat Milk 2L"). category from: Dairy/Produce/Pantry/Meat/Household/Personal Care/Other. ' +
    'Leave qty/price blank if not clearly visible. Confirm total item count in your reply.\n' +
    '- For add_takeout_restaurant: cuisine, phone, website, notes are all optional (use blank). rating is 1–5 or blank.\n' +
    '- For add_takeout_item: restaurant_name must match a restaurant listed in FAVORITE TAKEOUTS above. description, rating, notes are optional (use blank). rating is 1–5 or blank.\n' +
    '- For delete_takeout_restaurant: always confirm with Ahmed before deleting — this also removes ALL items under that restaurant.\n' +
    '- For delete_takeout_item: pass the restaurant name and item name exactly as listed in FAVORITE TAKEOUTS. Always confirm the item with Ahmed before deleting.\n' +
    '- For add_purchase: use when Ahmed says "I just bought X", "log that I picked up X from Y", or "I got X at Z". Category from: Dairy/Produce/Pantry/Meat/Household/Personal Care/Other. Leave qty/unit/store/price blank if not mentioned. Confirm the item name and store.\n' +
    '- For add_career_win: capture automatically when Ahmed mentions an achievement, positive outcome, launch, promotion, or recognition (e.g., "we launched X", "I got recognized for Y", "my team won Z"). Category from: Promotion/Recognition/Launch/Leadership/Project/Other. Impact is a concise business outcome. Date defaults to today if not specified.\n' +
    '- For add_career_goal: use when Ahmed says "my career goal is X", "I want to become Y", or "in N years I want to Z". Map horizon naturally: <18 months → 1yr, ~3 years → 3yr, ~5 years → 5yr, 10+ years → 10yr. Category is optional — infer from context (e.g., Leadership, Technical, Visibility).\n' +
    '- For update_career_position: use when Ahmed mentions a new role, promotion, company change, or updates his focus areas. Confirm the change before emitting the ACTION. Do not use this for temporary assignments or speculation.\n' +
    '- For add_prescription: use when Ahmed says "add X mg of Y for {person}", "log that {person} takes X", or "{person} was prescribed X". person = Ahmed or Victoria. dosage/frequency/refillDate are optional — leave blank if not mentioned.\n' +
    '- For mark_prescription_refilled: use when Ahmed says "{person} just refilled X", "picked up {person}\'s X prescription", or "got the X refill". Sets last filled to today. Ask for new refill date if not provided; do not guess it.\n' +
    '- For log_card_used: use when Ahmed says "I used my X card", "paid with my X", or "charged it to X". Confirm the card was logged. Card name can be partial (e.g. "Amex" matches "Amex Gold").\n' +
    '- For update_loyalty_points: use when Ahmed says "I have N points in X now", "my X balance is N", or "I earned N more X points". new_total should be the absolute balance (not a delta). Confirm the update.\n' +
    '- VERA should proactively mention: (1) any credit card unused >60 days when discussing spending/finances, (2) unused monthly perks during current month when relevant, (3) loyalty program points expiring within 90 days.\n' +
    '- VERA can answer "which card should I use for X?" directly from CREDIT CARDS context — no ACTION needed; just explain the best option and why.\n' +
    '- FINANCIAL WHAT-IF: When Ahmed asks "what if I buy/spend X", "what if rent goes up X", "how does X affect my goal", ' +
    'identify the most relevant Active goal (prefer one with a target date), determine changeType (one-time vs recurring), ' +
    'parse the dollar amount, then emit: ACTION:simulate_scenario|{goalId}|{one-time|recurring}|{amount}|{label}\n' +
    '  Example: "What if I spend $30K on a car?" → ACTION:simulate_scenario|FGOAL-...|one-time|30000|car purchase\n' +
    '  Example: "What if rent goes up $400/month?" → ACTION:simulate_scenario|FGOAL-...|recurring|400|rent increase\n' +
    '  After simulation runs, show the verdict. Ask if Ahmed wants to save the scenario.\n' +
    '  If multiple goals exist and none is obvious, ask which goal to run the simulation against.\n' +
    '- POST-TRIP DEBRIEF: When Ahmed says "debrief", "recap the [trip]", "capture the [trip]", or "let\'s do the [trip] debrief", ' +
    'start a structured capture conversation. Reference RECENTLY COMPLETED TRIPS above for the trip name and TripKey. ' +
    'Ask these 5 questions (you may combine them or ask in sequence based on flow):\n' +
    '  1. Any restaurants, bars, or cafes worth going back to? (\u2192 ACTION:log_interest|Both|{name}, {city}|Food)\n' +
    '  2. Best experience or highlight of the trip? (\u2192 ACTION:log_interest|Both|{experience}|Travel)\n' +
    '  3. Anything you\'d skip or do differently next time? (\u2192 ACTION:log_interest|Ahmed|skip: {thing}, {city}|Travel)\n' +
    '  4. Anything Victoria specifically loved? (\u2192 ACTION:log_interest|Victoria|{thing}|{best category})\n' +
    '  5. Would you go back? (\u2192 ACTION:add_bucket_item or ACTION:update_bucket_item if destination already in bucket list)\n' +
    'After the questions, emit ACTION:add_country if the destination isn\'t already in COUNTRIES VISITED, ' +
    'using the trip notes as the Notes field. Confirm each item logged. End with a brief summary of what was captured.\n' +
    '- COUNTRIES + BUCKET LIST INTELLIGENCE: When Ahmed mentions upcoming travel, cross-check against visited countries (first-time destinations are exciting milestones) and bucket list. ' +
    'If a planned destination matches or is near a bucket list item, proactively mention it. ' +
    'If Ahmed mentions a place he has never visited, offer to add it to the bucket list.\n' +
    '- IMPORTANT DATES: Use add_important_date when Ahmed mentions a birthday, anniversary, or meaningful date he wants tracked. ' +
    'For the date: use MM-DD if it recurs every year (e.g. birthdays, anniversaries), or YYYY-MM-DD for one-time events. ' +
    'Default leadTimeDays to 30. Confirm what was saved including when the next flag will fire.\n' +
    '- GIFT IDEAS: Use log_gift_idea when Ahmed mentions a gift idea for someone ("get Victoria a pottery class", "gift idea for mum: cookbook"). ' +
    'Use "What important dates are coming up?" or "any upcoming dates?" to list from IMPORTANT DATES context. ' +
    'When a date is within 7 days, proactively remind Ahmed and offer to log a gift idea.\n' +
    '- WISH LIST: Use add_wish_item when Ahmed says he wants something, has his eye on something, or wants to track an aspirational purchase. ' +
    'This is distinct from the shopping list (groceries/household) — wish list is for considered, non-routine purchases (tech, furniture, experiences, etc.). ' +
    'Person defaults to Ahmed unless Victoria is mentioned. Price is optional. ' +
    'Use mark_wish_purchased when Ahmed says he bought or received an item. ' +
    'When helping with gift ideas for Ahmed or Victoria, cross-reference WISH LIST (active items) above before suggesting — wish list items make ideal gift ideas.\n' +
    '- EXPERIMENTS: Use add_experiment when Ahmed wants to start tracking a personal experiment (e.g. "no sugar for 2 weeks", "meditate every morning", "try cold showers"). ' +
    'Person defaults to Ahmed unless stated otherwise. startDate defaults to today (YYYY-MM-DD). endDate is optional. ' +
    'Use log_experiment_checkin when Ahmed gives an update on how an experiment is going — any note, observation, or progress update counts as a check-in. ' +
    'Use update_experiment with field=status to update state: Active / Ongoing / Paused / Stopped / Completed. ' +
    'Use update_experiment with field=outcome to record the final result. ' +
    'When Ahmed mentions his current experiments in conversation, reference their check-in history to give context-aware responses.\n' +
    '- GROWTH (Books, Courses, Skills): Use add_book when Ahmed mentions reading or wanting to read a book. ' +
    'Use update_book with field=status to move a book from "Reading" to "Read" when he finishes it — this auto-fills dateFinished. ' +
    'Use add_course for online courses, podcasts, YouTube series, or any structured learning content. ' +
    'Use add_skill when Ahmed mentions building or practicing a skill. ' +
    'Use record_skill_practice when he says he practiced or worked on a skill today — it stamps today\'s date automatically. ' +
    'Person defaults to Ahmed unless Victoria is explicitly mentioned. ' +
    'When Ahmed asks what he\'s currently reading or learning, summarise from GROWTH context above. ' +
    'Connect books/courses to active goals or interests when the link is obvious (e.g. a productivity book linked to a career goal).\n' +
    '- REFERENCE RESOURCES: Only use fetch_resource_content if a resource with a matching [ID] appears in the ' +
    'REFERENCE RESOURCES section above. Never invent or guess an ID. ' +
    'When a match exists, say "I have a document on this — let me check it." and emit ACTION:fetch_resource_content|{resourceId} using the exact ID shown. ' +
    'The backend will inject the document text so you can answer specifically. ' +
    'For [link-only] resources, provide the URL and explain you cannot read it directly. ' +
    'If no matching resource is listed, answer from general knowledge and suggest Ahmed add the document via Explore → Resources.\n' +
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
    'Example: "I need to call the doctor" → offer ACTION:create_task. Do this naturally, not intrusively.\n' +
    '- THOUGHT TRIAGE: When Ahmed says "what thoughts have I parked", "let\'s triage my thoughts", "what\'s in my thought inbox", or similar, load THOUGHT INBOX from context and walk through each item. For each thought, ask Ahmed what to do: (a) Shelve as idea \u2192 ACTION:shelve_thought|{id}|{category}, (b) Make it a task \u2192 ACTION:promote_idea|{id}, (c) Dismiss \u2192 ACTION:archive_idea|{id}. Be conversational \u2014 present 2\u20133 thoughts at a time, not all at once. Confirm each action.\n'
  );
}

// ============================================================
// INTENT DETECTOR  (Issue #128 — loads only relevant data modules)
// ============================================================

function detectChatIntent_(msg) {
  if (!msg) return {};
  var m = msg.toLowerCase();
  return {
    finance:  /\b(bill|bills|spend|budget|credit card|cashback|loyalty program|payment|subscription|afford|expense|financial goal|invest|saving)\b/.test(m) || /what.?if|reward point|money/.test(m),
    resources: /\b(policy|policies|coverage|allowed|eligible|benefit|benefits|insurance|leave|pto|parental|bereavement|remote work|work from|abroad|verizon|hr|handbook|guideline|regulation|rule|entitle|document|procedure)\b/.test(m),
    travel:   /\b(trip|travel|vacation|flight|hotel|cruise|packing|itinerary|passport|visa|airport|airline|abroad|destination)\b/.test(m) || /bucket list/.test(m),
    home:     /\b(recipe|cook|takeout|grocery|pantry|dinner|lunch|kitchen|maintenance|appliance|household)\b/.test(m) || /home item|shopping list|eating out|what.*eat|food/.test(m),
    career:   /\b(career|job|promotion|salary|resume|position|performance|raise)\b/.test(m),
    health:   /\b(medication|prescription|refill|doctor|pharmacy|medicine|pill|dose|gym|workout|exercise|fitness|session|went to the gym|hit the gym|skipped|missed)\b/.test(m) || /\brx\b/.test(m),
    people:   /\b(gift|birthday|anniversary|victoria|family|friend|present|important date|upcoming date|date coming)\b/.test(m),
    wishlist:    /\b(wish list|wishlist|want to buy|someday buy|aspiring|have my eye|dream purchase|been wanting|on my list|coveting)\b/.test(m),
    experiments: /\b(experiment|experiments|experimenting|hypothesis|trying out|testing out|tracking|track my|check[ -]?in|my experiment|personal test|run an experiment)\b/.test(m),
    growth:      /\b(book|books|reading|read|course|courses|skill|skills|learning|practice|practicing|level up|studying|study|podcast|finished reading|started reading|currently reading)\b/.test(m),
    memory:      /\b(remember|memory|log|history|last (week|month|year|quarter)|what have i|what did i|accomplished|completed (recently|this|last)|pattern|trend|retrospective|review|looking back|reflect)\b/.test(m),
    projects: /\b(project|milestone|deliverable)\b/.test(m),
    thoughts: /\b(thought|thoughts|parked|park(ed)?\s+(this|that|it)|random thought|triage|what.*thought|review.*thought|thought inbox|what.*(have i|did i) park|shelve|unshelved)\b/.test(m),
    goals:    /\b(goal|goals|achieve|progress|resolution)\b/.test(m),
  };
}

// ============================================================
// CONTEXT BUILDER
// ============================================================

function buildChatContext_(userMessage) {
  var ss     = getSpreadsheet();
  var intent = detectChatIntent_(userMessage || '');

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

  // Shared Interest Ledger (top 20 active entries) — people intent
  var interests = null;
  if (intent.people) {
    try { interests = getSharedInterestLedger_().slice(0, 20); }
    catch (e) { Logger.log('Chat context: interests — ' + e.message); interests = []; }
  }

  // Important Dates (next 90 days) + Gift Ideas — people intent
  var importantDates = null;
  var giftIdeas = null;
  if (intent.people) {
    try { importantDates = getUpcomingImportantDates_(90); }
    catch (e) { Logger.log('Chat context: importantDates — ' + e.message); importantDates = []; }
    try {
      var giRes = webGetGiftData_();
      giftIdeas = (giRes && giRes.ideas) || [];
    } catch (e) { Logger.log('Chat context: giftIdeas — ' + e.message); giftIdeas = []; }
  }

  // PTO stats (live compute — same pattern as webGetPTO_ in WebApp.js)
  var ptoStats = null;
  try {
    var ptoCfg    = readPTOConfig_();
    var ptoResult = getPTOEvents_(ptoCfg);
    ptoStats = computePTOStats_(ptoResult, ptoCfg, new Date());
  } catch (e) { Logger.log('Chat context: PTO — ' + e.message); }

  // Yearly goals (active only, top 8) — goals intent
  var goals = null;
  if (intent.goals || intent.finance) {
    try {
      goals = getGoals_().filter(function(g) {
        var s = String(g.status || '').toLowerCase();
        return s !== 'done' && s !== 'archived' && s !== 'complete';
      }).slice(0, 8);
    } catch (e) { Logger.log('Chat context: goals — ' + e.message); goals = []; }
  }

  // Bills — finance intent
  var bills = null;
  if (intent.finance) {
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
      } else {
        bills = [];
      }
    } catch (e) { Logger.log('Chat context: bills — ' + e.message); bills = []; }
  }

  // Recipes — home intent
  var recipes = null;
  if (intent.home) {
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
      } else {
        recipes = [];
      }
    } catch (e) { Logger.log('Chat context: recipes — ' + e.message); recipes = []; }
  }

  // Home Items — home intent
  var homeItems = null;
  if (intent.home) {
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
      } else {
        homeItems = [];
      }
    } catch (e) { Logger.log('Chat context: homeItems — ' + e.message); homeItems = []; }
  }

  // Shopping store names — home intent
  var shoppingStores = null;
  if (intent.home) {
    try { shoppingStores = getShoppingList_().map(function(s) { return s.storeName; }); }
    catch (e) { Logger.log('Chat context: shopping stores — ' + e.message); shoppingStores = []; }
  }

  // Wish List (active items only) — wishlist intent (Issue #131)
  var wishList = null;
  if (intent.wishlist) {
    try {
      var wlSheet = ss.getSheetByName(TABS.WISH_LIST);
      if (wlSheet && wlSheet.getLastRow() >= 2) {
        var wlData = wlSheet.getRange(2, 1, wlSheet.getLastRow() - 1, WISH_LIST_HEADERS.length).getValues();
        wishList = wlData
          .filter(function(r) { return String(r[0]).trim() && String(r[8]).trim() !== 'Purchased'; })
          .map(function(r, idx) {
            return {
              row:      idx + 2,
              id:       String(r[0] || '').trim(),
              person:   String(r[1] || '').trim(),
              category: String(r[2] || '').trim(),
              item:     String(r[3] || '').trim(),
              price:    r[6] !== '' && r[6] !== null ? Number(r[6]) : null,
              priority: String(r[7] || 'Medium').trim(),
              status:   String(r[8] || 'Dreaming').trim(),
            };
          });
      } else {
        wishList = [];
      }
    } catch (wlErr) { Logger.log('Chat context: wishList — ' + wlErr.message); wishList = []; }
  }

  // Experiments — experiments intent (Issue #130)
  var experiments = null;
  if (intent.experiments) {
    try {
      var expSheet = ss.getSheetByName(TABS.EXPERIMENTS);
      var expChkSheet = ss.getSheetByName(TABS.EXPERIMENT_CHECKINS);
      // Build check-ins map: experimentId -> last 3 check-ins
      var checkinsMap = {};
      if (expChkSheet && expChkSheet.getLastRow() >= 2) {
        var chkData = expChkSheet.getRange(2, 1, expChkSheet.getLastRow() - 1, EXPERIMENT_CHECKIN_HEADERS.length).getValues();
        chkData.forEach(function(r) {
          var eid = String(r[1] || '').trim();
          if (!eid) return;
          if (!checkinsMap[eid]) checkinsMap[eid] = [];
          checkinsMap[eid].push({ id: String(r[0]||'').trim(), date: String(r[3]||'').trim(), note: String(r[4]||'').trim() });
        });
        // Sort each list newest-first and keep last 3
        Object.keys(checkinsMap).forEach(function(k) {
          checkinsMap[k].sort(function(a, b) { return b.date.localeCompare(a.date); });
          checkinsMap[k] = checkinsMap[k].slice(0, 3);
        });
      }
      if (expSheet && expSheet.getLastRow() >= 2) {
        var expData = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, EXPERIMENT_HEADERS.length).getValues();
        experiments = expData
          .filter(function(r) { return String(r[0]).trim(); })
          .map(function(r) {
            var eid = String(r[0] || '').trim();
            var status = String(r[7] || 'Active').trim();
            return {
              id:         eid,
              person:     String(r[1] || '').trim(),
              title:      String(r[2] || '').trim(),
              category:   String(r[3] || '').trim(),
              hypothesis: String(r[4] || '').trim(),
              startDate:  String(r[5] || '').trim(),
              endDate:    String(r[6] || '').trim(),
              status:     status,
              outcome:    String(r[8] || '').trim(),
              rating:     String(r[9] || '').trim(),
              notes:      String(r[10] || '').trim(),
              checkins:   checkinsMap[eid] || [],
            };
          })
          .filter(function(ex) { return ex.status !== 'Completed' && ex.status !== 'Stopped'; });
      } else {
        experiments = [];
      }
    } catch (expErr) { Logger.log('Chat context: experiments — ' + expErr.message); experiments = []; }
  }

  // Growth — Books, Courses, Skills (Issue #88)
  var growthData = null;
  if (intent.growth) {
    try {
      var bSheet = ss.getSheetByName(TABS.BOOKS);
      var cSheet = ss.getSheetByName(TABS.COURSES);
      var sSheet = ss.getSheetByName(TABS.SKILLS);

      var books = [];
      if (bSheet && bSheet.getLastRow() >= 2) {
        bSheet.getRange(2, 1, bSheet.getLastRow() - 1, BOOK_HEADERS.length).getValues()
          .forEach(function(r) {
            var id = String(r[0] || '').trim();
            if (!id) return;
            books.push({
              id: id, person: String(r[1]||'').trim(), title: String(r[2]||'').trim(),
              author: String(r[3]||'').trim(), status: String(r[5]||'').trim(),
              rating: r[6] || null, dateStarted: String(r[7]||'').trim(),
              dateFinished: String(r[8]||'').trim(),
            });
          });
      }

      var courses = [];
      if (cSheet && cSheet.getLastRow() >= 2) {
        cSheet.getRange(2, 1, cSheet.getLastRow() - 1, COURSE_HEADERS.length).getValues()
          .forEach(function(r) {
            var id = String(r[0] || '').trim();
            if (!id) return;
            courses.push({
              id: id, person: String(r[1]||'').trim(), title: String(r[2]||'').trim(),
              source: String(r[3]||'').trim(), status: String(r[5]||'').trim(),
              rating: r[6] || null, dateFinished: String(r[8]||'').trim(),
            });
          });
      }

      var skillItems = [];
      if (sSheet && sSheet.getLastRow() >= 2) {
        sSheet.getRange(2, 1, sSheet.getLastRow() - 1, SKILL_HEADERS.length).getValues()
          .forEach(function(r) {
            var id = String(r[0] || '').trim();
            if (!id) return;
            skillItems.push({
              id: id, person: String(r[1]||'').trim(), skill: String(r[2]||'').trim(),
              category: String(r[3]||'').trim(), level: String(r[4]||'').trim(),
              lastPracticed: String(r[6]||'').trim(),
            });
          });
      }

      growthData = { books: books, courses: courses, skills: skillItems };
    } catch (grErr) { Logger.log('Chat context: growth — ' + grErr.message); growthData = { books: [], courses: [], skills: [] }; }
  }

  // Ideas braindump — people intent or thoughts triage
  var ideas = null;
  if (intent.people || intent.thoughts) {
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
      } else {
        ideas = [];
      }
    } catch (e) { Logger.log('Chat context: ideas — ' + e.message); ideas = []; }
  }

  // Full projects array — projects/goals intent
  var projects = null;
  if (intent.projects || intent.goals) {
    try { projects = getProjects_(); }
    catch (e) { Logger.log('Chat context: projects full — ' + e.message); projects = []; }
  }

  // ---- Travel (itinerary + packing + trip context) — travel intent ----------
  var travel     = null;
  var recentTrips = null;
  var countries   = null;
  var bucketList  = null;

  if (intent.travel) {
    var travelTrips    = [];
    var itinByTrip     = {};
    var packByTrip     = {};
    var tripContextMap = {};

    try {
      var travelCfg = readPTOConfig_();
      travelTrips = getUpcomingTravel_(travelCfg);
    } catch(e) { Logger.log('Chat context: travel trips — ' + e.message); }

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

    try {
      var metaSheet = ss.getSheetByName(TABS.TRIP_META);
      if (metaSheet && metaSheet.getLastRow() >= 2) {
        var metaRows = metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
        metaRows.forEach(function(r) {
          tripContextMap[String(r[0]).trim()] = String(r[1]).trim();
        });
      }
    } catch(e) { Logger.log('Chat context: trip meta — ' + e.message); }

    travel = { trips: travelTrips, itinByTrip: itinByTrip, packByTrip: packByTrip, tripContextMap: tripContextMap };

    // Recently-completed trips (ended 0.5–5 days ago)
    recentTrips = [];
    try {
      var now2 = new Date();
      Object.keys(itinByTrip).forEach(function(tk) {
        var datePart = tk.split('|')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;
        var maxDate = new Date(datePart + 'T00:00:00');
        itinByTrip[tk].forEach(function(item) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
            var d = new Date(item.date + 'T00:00:00');
            if (d > maxDate) maxDate = d;
          }
        });
        var daysAgo = (now2.getTime() - maxDate.getTime()) / 86400000;
        if (daysAgo >= 0.5 && daysAgo <= 5) {
          var tkParts = tk.split('|');
          var label   = tkParts.length > 1 ? tkParts.slice(1).join('|') : tk;
          recentTrips.push({ tripKey: tk, tripLabel: label, endDate: maxDate, daysAgo: daysAgo });
        }
      });
    } catch(e) { Logger.log('Chat context: recentTrips — ' + e.message); }

    try {
      var cRes = webGetCountries_();
      countries = (cRes && cRes.entries) || [];
    } catch(e) { Logger.log('Chat context: countries — ' + e.message); countries = []; }

    try {
      var bRes = webGetBucketList_();
      bucketList = (bRes && bRes.entries) || [];
    } catch(e) { Logger.log('Chat context: bucketList — ' + e.message); bucketList = []; }
  }

  // Favorite Takeouts — home intent
  var takeouts = null;
  if (intent.home) {
    try {
      var tRes = webGetTakeouts_();
      takeouts = (tRes && tRes.restaurants) || [];
    } catch(e) { Logger.log('Chat context: takeouts — ' + e.message); takeouts = []; }
  }

  // Pantry — home intent
  var pantryDue = null;
  if (intent.home) {
    try { pantryDue = getItemsDue_(14); }
    catch(e) { Logger.log('Chat context: pantryDue — ' + e.message); pantryDue = []; }
  }

  // Upcoming house guests — home intent (Issue #150)
  var upcomingGuests = null;
  if (intent.home) {
    try {
      var guestCfg2 = readPTOConfig_();
      upcomingGuests = getUpcomingGuests_(guestCfg2);
    } catch(e) { Logger.log('Chat context: upcomingGuests — ' + e.message); upcomingGuests = []; }
  }

  // Career profile — career intent
  var career = null;
  if (intent.career) {
    try {
      var carRes = webGetCareer_();
      if (carRes && carRes.ok) career = carRes;
    } catch(e) { Logger.log('Chat context: career — ' + e.message); }
  }

  // Prescriptions + Gym Log — health intent
  var prescriptions = null;
  var gymLog = null;
  if (intent.health) {
    try {
      var pRes = webGetPrescriptions_();
      prescriptions = (pRes && pRes.prescriptions) || [];
    } catch(e) { Logger.log('Chat context: prescriptions — ' + e.message); prescriptions = []; }
    try {
      var glRes = getGymLog_();
      // Only pass recent sessions (last 28 days) to keep context lean
      var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
      var cutoffStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      gymLog = glRes.filter(function(s) { return s.date >= cutoffStr; });
    } catch(e) { Logger.log('Chat context: gymLog — ' + e.message); gymLog = []; }
  }

  // Credit Card Hub — finance intent
  var cardsData = null;
  if (intent.finance) {
    try {
      var cardRes = webGetCards_();
      if (cardRes && cardRes.ok) cardsData = cardRes;
    } catch(e) { Logger.log('Chat context: cards — ' + e.message); }
  }

  // Financial Goals — finance or goals intent
  var financialGoals = null;
  if (intent.finance || intent.goals) {
    try { financialGoals = getFinancialGoals_(); }
    catch(e) { Logger.log('Chat context: financialGoals — ' + e.message); financialGoals = []; }
  }

  // Resources registry — resources intent (registry only, no content; content fetched on-demand)
  var resources = null;
  if (intent.resources) {
    try {
      var resSheet = ss.getSheetByName(TABS.RESOURCES);
      if (resSheet && resSheet.getLastRow() >= 2) {
        var resRows = resSheet.getDataRange().getValues();
        var resHdrs = resRows[0];
        resources = [];
        resRows.slice(1).forEach(function(r) {
          if (!r[0]) return;
          var obj = {};
          resHdrs.forEach(function(h, i) { obj[h] = r[i]; });
          resources.push(obj);
        });
      } else {
        resources = [];
      }
    } catch(e) { Logger.log('Chat context: resources — ' + e.message); resources = []; }
  }

  // Memory Log — retrospective queries (Issue #9)
  var memoryContext = null;
  if (intent.memory) {
    try { memoryContext = getMemoryContext_(90); }
    catch (e) { Logger.log('Chat context: memory — ' + e.message); memoryContext = null; }
  }

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
    recentTrips:     recentTrips,
    countries:       countries,
    bucketList:      bucketList,
    takeouts:        takeouts,
    pantryDue:       pantryDue,
    upcomingGuests:  upcomingGuests,
    career:          career,
    prescriptions:   prescriptions,
    gymLog:          gymLog,
    cardsData:       cardsData,
    financialGoals:  financialGoals,
    resources:       resources,
    importantDates:  importantDates,
    giftIdeas:       giftIdeas,
    wishList:        wishList,
    experiments:     experiments,
    growthData:      growthData,
    memoryContext:   memoryContext,
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

/** Adds `minutes` to a "HH:MM" time string. Returns new "HH:MM". Wraps at 24h. */
function incrementTime_(timeStr, minutes) {
  var parts = (timeStr || '00:00').split(':');
  var total = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0) + minutes;
  var h = Math.floor(total / 60) % 24, m = total % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
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

    // TripKey helper — TripKey format is "YYYY-MM-DD|TripName", which contains
    // an internal pipe that confuses the generic split above (Issue #104).
    // If args[0] looks like a date, re-join args[0]+'|'+args[1] as the TripKey.
    function tripKeyArgs_() {
      if (/^\d{4}-\d{2}-\d{2}$/.test(args[0] || '') && args.length > 1) {
        return { tripKey: args[0] + '|' + args[1], rest: args.slice(2) };
      }
      return { tripKey: args[0] || '', rest: args.slice(1) };
    }

    try {
      if      (type === 'complete_task') {
        var ctRes = webCompleteTask_(args[0]);
        executed.push(type + ' (' + args[0] + ')' + (ctRes.recurring ? ' → 🔁 next due ' + ctRes.nextDueDate : ''));
        // Memory already logged inside webCompleteTask_
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
        // Memory log — only status and progress changes are worth recording
        if (ugField === 'status' || ugField === 'progress') {
          try {
            var allGoals = getGoals_();
            var ugGoal   = allGoals.find(function(g) { return g.id === ugId; });
            var ugTitle  = ugGoal ? ugGoal.title : ugId;
            appendMemoryEvent_(MEMORY_TYPE.GOAL_UPDATED, 'Ahmed', ugTitle,
              ugField + ' → ' + ugVal, ugId);
          } catch (mErr) { Logger.log('Memory: update_goal hook (non-fatal) — ' + mErr.message); }
        }
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
      else if (type === 'add_thought') {
        var atText = (args[0] || '').trim();
        if (!atText) throw new Error('Thought text required');
        var atSheet = getSpreadsheet().getSheetByName(TABS.IDEAS);
        if (!atSheet) throw new Error('Ideas tab not found');
        var atTz      = Session.getScriptTimeZone();
        var atNow     = new Date();
        var atDateStr = Utilities.formatDate(atNow, atTz, 'yyyy-MM-dd');
        var atDateKey = Utilities.formatDate(atNow, atTz, 'yyyyMMdd');
        var atLastRow = atSheet.getLastRow();
        var atCount   = 1;
        if (atLastRow >= 2) {
          var atIds = atSheet.getRange(2, 1, atLastRow - 1, 1).getValues();
          atIds.forEach(function(r) {
            if (String(r[0]).indexOf('IDEA-' + atDateKey) === 0) atCount++;
          });
        }
        var atId = 'IDEA-' + atDateKey + '-' + (atCount < 10 ? '0' + atCount : String(atCount));
        atSheet.getRange(atLastRow + 1, 1, 1, IDEA_HEADERS.length).setValues([[
          atId, atDateStr, atText, '', '', '', 'Thought'
        ]]);
        executed.push('add_thought (' + atId + ')');
      }
      else if (type === 'shelve_thought') {
        var stId       = (args[0] || '').trim();
        var stCategory = (args[1] || 'General').trim();
        if (!stId) throw new Error('Thought ID required');
        webShelveThought_(makeFakeEvent_({ id: stId, category: stCategory }));
        executed.push('shelve_thought (' + stId + ' \u2192 ' + stCategory + ')');
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
        var aiTK = tripKeyArgs_();
        webAddItineraryItem_(makeFakeEvent_({
          tripKey:   aiTK.tripKey,
          type:      aiTK.rest[0] || 'manual',
          title:     aiTK.rest[1] || '',
          date:      aiTK.rest[2] || '',
          startTime: aiTK.rest[3] || '',
          endTime:   aiTK.rest[4] || '',
          location:  aiTK.rest[5] || '',
          notes:     aiTK.rest[6] || '',
        }));
        executed.push('add_itinerary_item (' + (aiTK.rest[1] || '') + ' on ' + (aiTK.rest[2] || '') + ')');
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
        var stcTK = tripKeyArgs_();
        webSetTripMeta_(makeFakeEvent_({ tripKey: stcTK.tripKey, context: stcTK.rest[0] || '', notes: '' }));
        executed.push('set_trip_context (' + stcTK.tripKey + ' \u2192 ' + (stcTK.rest[0] || '') + ')');
      }

      // ---- Packing ----------------------------------------------------------
      else if (type === 'add_packing_item') {
        var apiTK = tripKeyArgs_();
        webAddPackingItem_(makeFakeEvent_({
          tripKey:  apiTK.tripKey,
          person:   apiTK.rest[0] || 'shared',
          category: apiTK.rest[1] || 'General',
          item:     apiTK.rest[2] || '',
        }));
        executed.push('add_packing_item (' + (apiTK.rest[2] || '') + ' for ' + (apiTK.rest[0] || 'shared') + ')');
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
        var gplTK = tripKeyArgs_();
        webGeneratePacking_(makeFakeEvent_({ tripKey: gplTK.tripKey, startDate: gplTK.rest[0] || '', endDate: gplTK.rest[1] || '' }));
        executed.push('generate_packing_list (' + gplTK.tripKey + ')');
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

      // ---- Interests (add — log_interest already handles auto-capture) --------
      else if (type === 'add_interest') {
        var aiPerson   = (args[0] || 'Ahmed').trim();
        var aiInterest = (args[1] || '').trim();
        var aiCategory = (args[2] || 'Other').trim();
        var aiNotes2   = (args[3] || '').trim();
        if (!aiInterest) throw new Error('Interest text required');
        createInterest_(aiPerson, aiInterest, aiCategory, 'Chat', aiNotes2);
        executed.push(type + ' (' + aiPerson + ': ' + aiInterest + ')');
      }

      // ---- Bills (delete) -----------------------------------------------------
      else if (type === 'delete_bill') {
        var dbRow = parseInt(args[0], 10);
        if (isNaN(dbRow) || dbRow < 2) throw new Error('Invalid bill row: ' + args[0]);
        var dbSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
        if (!dbSheet) throw new Error('Bills tab not found');
        if (dbRow > dbSheet.getLastRow()) throw new Error('Row ' + dbRow + ' out of range');
        dbSheet.deleteRow(dbRow);
        executed.push(type + ' (row ' + dbRow + ')');
      }

      // ---- Countries ----------------------------------------------------------
      else if (type === 'add_country') {
        if (!args[0]) throw new Error('Country name required');
        webAddCountry_(makeFakeEvent_({
          country:   args[0] || '',
          city:      args[1] || '',
          year:      args[2] || '',
          traveller: args[3] || 'Both',
          notes:     args[4] || '',
        }));
        executed.push(type + ' (' + args[0] + ')');
      }
      else if (type === 'delete_country') {
        var dcId = (args[0] || '').trim();
        if (!dcId) throw new Error('Country ID required');
        webDeleteCountry_(makeFakeEvent_({ id: dcId }));
        executed.push(type + ' (' + dcId + ')');
      }

      // ---- Bucket List --------------------------------------------------------
      else if (type === 'add_bucket_item') {
        if (!args[0]) throw new Error('Country name required');
        webAddBucketItem_(makeFakeEvent_({
          country:    args[0] || '',
          city:       args[1] || '',
          targetYear: args[2] || '',
          traveller:  args[3] || 'Both',
          stars:      args[4] || '',
          dreamTrip:  args[5] || '',
          notes:      args[6] || '',
        }));
        executed.push(type + ' (' + args[0] + (args[1] ? ', ' + args[1] : '') + ')');
      }
      else if (type === 'update_bucket_item') {
        var ubId    = (args[0] || '').trim();
        var ubField = (args[1] || '').trim().toLowerCase();
        var ubVal   = (args[2] || '').trim();
        if (!ubId) throw new Error('Bucket item ID required');
        var ubParams = { id: ubId };
        if (ubField === 'visited') ubParams.visited = ubVal;
        else if (ubField === 'stars') ubParams.stars = ubVal;
        else throw new Error('Unknown field: ' + ubField + '. Valid: visited, stars');
        webUpdateBucketItem_(makeFakeEvent_(ubParams));
        executed.push(type + ' (' + ubId + ' ' + ubField + '=' + ubVal + ')');
      }
      else if (type === 'delete_bucket_item') {
        var dbiId = (args[0] || '').trim();
        if (!dbiId) throw new Error('Bucket item ID required');
        webDeleteBucketItem_(makeFakeEvent_({ id: dbiId }));
        executed.push(type + ' (' + dbiId + ')');
      }
      else if (type === 'log_gym_attend_latest') {
        var attended = (args[0] || 'yes').toLowerCase() === 'no' ? 'No' : 'Yes';
        var latestResult = webGymAttendLatest_(attended);
        if (!latestResult.ok) throw new Error(latestResult.error || 'No pending gym session found');
        executed.push('log_gym_attend_latest (' + latestResult.id + ' \u2192 ' + attended + ')');
      }
      else if (type === 'add_gym_sessions') {
        var agsTK   = tripKeyArgs_();
        var tripKey = agsTK.tripKey;
        if (!tripKey) throw new Error('Trip key required');

        // Find all dates in this trip's itinerary
        var itinSheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
        var tripDates = [];
        if (itinSheet && itinSheet.getLastRow() >= 2) {
          itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues()
            .forEach(function(row) {
              if (String(row[1] || '').trim() !== tripKey) return;
              var ds = String(row[4] || '').trim(); // col 4 = Date
              if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) tripDates.push(ds);
            });
        }

        // Fallback: trip exists on gap calendar but has no itinerary items yet
        if (!tripDates.length) {
          try {
            var ptoCfgFb  = readPTOConfig_();
            var calTripsFb = getUpcomingTravel_(ptoCfgFb);
            var depPartFb  = tripKey.split('|')[0];
            var lblPartFb  = tripKey.split('|').slice(1).join('|').toLowerCase();
            var matchedFb  = null;
            for (var fi = 0; fi < calTripsFb.length; fi++) {
              var ct = calTripsFb[fi];
              if (ct.startDate === depPartFb || ct.label.toLowerCase() === lblPartFb) {
                matchedFb = ct; break;
              }
            }
            if (!matchedFb) throw new Error('No itinerary items and no matching calendar trip for: ' + tripKey);
            var fcFb = new Date(matchedFb.startDate + 'T00:00:00');
            var feFb = new Date(matchedFb.endDate   + 'T00:00:00');
            var tzFb = Session.getScriptTimeZone();
            while (fcFb <= feFb) {
              tripDates.push(Utilities.formatDate(fcFb, tzFb, 'yyyy-MM-dd'));
              fcFb.setDate(fcFb.getDate() + 1);
            }
          } catch (fbErr) {
            throw new Error(fbErr.message);
          }
        }

        if (!tripDates.length) throw new Error('No dates found for trip: ' + tripKey);
        tripDates.sort();
        var minDate = tripDates[0], maxDate = tripDates[tripDates.length - 1];
        if (minDate === maxDate) throw new Error('Trip only spans one day — no interior days for gym sessions');

        var cfg2      = getConfigValues();
        var blockTime = (cfg2['fitness_travel_block_time']     || '07:00').trim();
        var blockDur  = parseInt(cfg2['fitness_travel_block_duration'] || '60', 10) || 60;
        var endTime   = incrementTime_(blockTime, blockDur);
        var tz2       = Session.getScriptTimeZone();
        var cursor    = new Date(minDate + 'T00:00:00');
        var endDate   = new Date(maxDate + 'T00:00:00');
        cursor.setDate(cursor.getDate() + 1); // skip arrival day
        var added = 0;
        while (cursor < endDate) { // < = skip departure day
          webAddItineraryItem_(makeFakeEvent_({
            tripKey: tripKey, type: 'activity', title: 'Morning gym session',
            date:    Utilities.formatDate(cursor, tz2, 'yyyy-MM-dd'),
            startTime: blockTime, endTime: endTime, location: 'Hotel fitness center', notes: '',
          }));
          cursor.setDate(cursor.getDate() + 1);
          added++;
        }
        executed.push('add_gym_sessions (' + added + ' block(s) \u2192 ' + tripKey + ')');
      }
      else if (type === 'log_receipt_items') {
        var riItem  = (args[0] || '').trim();
        if (!riItem) throw new Error('item name required');
        var riNorm  = normalizeItemName_(riItem);
        var riCat   = (args[1] || 'Other').trim();
        var riQty   = args[2] !== undefined && args[2] !== '' ? parseFloat(args[2]) : null;
        var riUnit  = (args[3] || '').trim();
        var riStore = (args[4] || '').trim();
        var riPrice = args[5] !== undefined && args[5] !== '' ? parseFloat(args[5]) : null;
        logPurchaseItems_([{
          item: riItem, normalized: riNorm, category: riCat,
          qty: riQty, unit: riUnit, store: riStore, price: riPrice,
        }], 'receipt');
        executed.push('log_receipt_items (' + riItem + ')');
      }

      // ---- Takeouts (Issue #112) -----------------------------------------
      else if (type === 'add_takeout_restaurant') {
        var atrName = (args[0] || '').trim();
        if (!atrName) throw new Error('restaurant name required');
        webAddTakeoutRestaurant_({
          name:    atrName,
          cuisine: (args[1] || '').trim(),
          phone:   (args[2] || '').trim(),
          website: (args[3] || '').trim(),
          rating:  args[4] && args[4].trim() ? Number(args[4]) : '',
          notes:   (args[5] || '').trim(),
        });
        executed.push('add_takeout_restaurant (' + atrName + ')');
      }
      else if (type === 'add_takeout_item') {
        var atiRest = (args[0] || '').trim();
        var atiItem = (args[1] || '').trim();
        if (!atiRest || !atiItem) throw new Error('restaurant and item name required');
        webAddTakeoutItem_({
          restaurant:  atiRest,
          item:        atiItem,
          description: (args[2] || '').trim(),
          rating:      args[3] && args[3].trim() ? Number(args[3]) : '',
          notes:       (args[4] || '').trim(),
        });
        executed.push('add_takeout_item (' + atiItem + ' @ ' + atiRest + ')');
      }
      else if (type === 'delete_takeout_restaurant') {
        var dtrName = (args[0] || '').trim();
        if (!dtrName) throw new Error('restaurant name required');
        webDeleteTakeoutRestaurant_({ name: dtrName });
        executed.push('delete_takeout_restaurant (' + dtrName + ')');
      }
      else if (type === 'delete_takeout_item') {
        var dtiRest = (args[0] || '').trim();
        var dtiItem = (args[1] || '').trim();
        if (!dtiRest || !dtiItem) throw new Error('restaurant name and item name required');
        // Look up row by restaurant + item name (case-insensitive)
        var dtiSheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_ITEMS);
        if (!dtiSheet || dtiSheet.getLastRow() < 2) throw new Error('No takeout items found');
        var dtiData = dtiSheet.getRange(2, 1, dtiSheet.getLastRow() - 1, 2).getValues();
        var dtiRow  = -1;
        for (var di = 0; di < dtiData.length; di++) {
          if (String(dtiData[di][0]).trim().toLowerCase() === dtiRest.toLowerCase() &&
              String(dtiData[di][1]).trim().toLowerCase() === dtiItem.toLowerCase()) {
            dtiRow = di + 2; break;
          }
        }
        if (dtiRow < 2) throw new Error('Item "' + dtiItem + '" not found at "' + dtiRest + '"');
        webDeleteTakeoutItem_({ row: dtiRow });
        executed.push('delete_takeout_item (' + dtiItem + ' @ ' + dtiRest + ')');
      }

      // ---- Pantry / Purchase History (Issue #111) --------------------------
      else if (type === 'add_purchase') {
        var apItem  = (args[0] || '').trim();
        if (!apItem) throw new Error('item name required');
        var apNorm  = normalizeItemName_(apItem);
        var apCat   = (args[1] || 'Other').trim();
        var apQty   = args[2] && args[2].trim() ? parseFloat(args[2]) : null;
        var apUnit  = (args[3] || '').trim();
        var apStore = (args[4] || '').trim();
        var apPrice = args[5] && args[5].trim() ? parseFloat(args[5]) : null;
        logPurchaseItems_([{
          item: apItem, normalized: apNorm, category: apCat,
          qty: apQty, unit: apUnit, store: apStore, price: apPrice,
        }], 'manual');
        executed.push('add_purchase (' + apItem + ')');
      }

      // Career
      else if (type === 'add_career_win') {
        var cwWin    = (args[0] || '').trim();
        var cwImpact = (args[1] || '').trim();
        var cwCat    = (args[2] || 'Project').trim();
        var cwDate   = (args[3] || '').trim() || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (cwWin) {
          webAddCareerWin_({ parameter: { win: cwWin, impact: cwImpact, category: cwCat, date: cwDate } });
          executed.push('add_career_win (' + cwWin.slice(0, 40) + ')');
          try {
            appendMemoryEvent_(MEMORY_TYPE.CAREER_WIN, 'Ahmed', cwWin,
              (cwImpact ? 'Impact: ' + cwImpact : '') + (cwCat ? ' · Category: ' + cwCat : ''), cwDate);
          } catch (mErr) { Logger.log('Memory: add_career_win hook (non-fatal) — ' + mErr.message); }
        }
      }

      else if (type === 'add_career_goal') {
        var cgTitle   = (args[0] || '').trim();
        var cgHorizon = (args[1] || '1yr').trim();
        var cgCat     = (args[2] || '').trim();
        var cgNotes   = (args[3] || '').trim();
        if (cgTitle) {
          webAddCareerGoal_({ parameter: { title: cgTitle, horizon: cgHorizon, category: cgCat, notes: cgNotes, status: 'Active' } });
          executed.push('add_career_goal (' + cgTitle + ')');
        }
      }

      else if (type === 'update_career_position') {
        // Field-by-field update: read current position, patch the field, then overwrite
        var cpField = (args[0] || '').trim();
        var cpValue = (args[1] || '').trim();
        if (cpField && cpValue) {
          var cpCur = webGetCareer_();
          var cpPos = (cpCur && cpCur.position) ? cpCur.position : {};
          cpPos[cpField] = cpValue;
          webUpdateCareerPosition_({ parameter: cpPos });
          executed.push('update_career_position (' + cpField + '=' + cpValue + ')');
        }
      }

      // Prescriptions (Issue #116)
      else if (type === 'add_prescription') {
        var rxPerson = (args[0] || 'Ahmed').trim();
        var rxMed    = (args[1] || '').trim();
        var rxDose   = (args[2] || '').trim();
        var rxFreq   = (args[3] || '').trim();
        var rxRefill = (args[4] || '').trim();
        var rxNotes  = (args[5] || '').trim();
        if (rxMed) {
          webAddPrescription_({ parameter: { person: rxPerson, medication: rxMed, dosage: rxDose, frequency: rxFreq, refillDate: rxRefill, notes: rxNotes, active: 'Yes' } });
          executed.push('add_prescription (' + rxPerson + ': ' + rxMed + ')');
        }
      }

      else if (type === 'mark_prescription_refilled') {
        var mrPerson = (args[0] || '').trim();
        var mrMed    = (args[1] || '').trim();
        var mrDate   = (args[2] || '').trim();
        if (mrPerson && mrMed && mrDate) {
          // Find the prescription by person + medication name match
          var allRx = webGetPrescriptions_();
          var rxRows = (allRx && allRx.prescriptions) || [];
          var today  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          var matched = rxRows.filter(function(r) {
            return r.person.toLowerCase() === mrPerson.toLowerCase() &&
                   r.medication.toLowerCase().indexOf(mrMed.toLowerCase()) >= 0;
          });
          if (matched.length > 0) {
            webUpdatePrescription_({ parameter: { id: matched[0].id, lastFilled: today, refillDate: mrDate } });
            executed.push('mark_prescription_refilled (' + mrPerson + ': ' + matched[0].medication + ')');
          } else {
            errors.push('mark_prescription_refilled: no prescription found for ' + mrPerson + '/' + mrMed);
          }
        }
      }

      // Credit Card Hub (Issues #115 + #117)
      else if (type === 'log_card_used') {
        var lcCard   = (args[0] || '').trim();
        var lcToday  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (lcCard) {
          var lcAll    = webGetCards_();
          var lcMatch  = (lcAll.cards || []).filter(function(c) {
            return c.cardName.toLowerCase().indexOf(lcCard.toLowerCase()) >= 0;
          });
          if (lcMatch.length > 0) {
            webUpdateCard_({ parameter: { id: lcMatch[0].id, lastUsed: lcToday } });
            executed.push('log_card_used (' + lcMatch[0].cardName + ')');
          } else {
            errors.push('log_card_used: no card found matching "' + lcCard + '"');
          }
        }
      }

      else if (type === 'update_loyalty_points') {
        var ulProg  = (args[0] || '').trim();
        var ulPts   = (args[1] || '').trim();
        if (ulProg && ulPts) {
          var ulAll   = webGetCards_();
          var ulMatch = (ulAll.programs || []).filter(function(p) {
            return p.program.toLowerCase().indexOf(ulProg.toLowerCase()) >= 0;
          });
          if (ulMatch.length > 0) {
            webUpdateLoyaltyProgram_({ parameter: { id: ulMatch[0].id, totalPoints: ulPts } });
            executed.push('update_loyalty_points (' + ulMatch[0].program + ' \u2192 ' + ulPts + ')');
          } else {
            errors.push('update_loyalty_points: no program found matching "' + ulProg + '"');
          }
        }
      }

      // ---- Financial Scenario Simulation (Issue #127) -------------------------
      else if (type === 'simulate_scenario') {
        var simGoalId    = (args[0] || '').trim();
        var simType      = (args[1] || 'one-time').trim();
        var simAmount    = parseFloat(args[2]) || 0;
        var simLabel     = (args[3] || 'scenario').trim();
        var simGoals     = getFinancialGoals_();
        var simGoal      = simGoals.filter(function(g) { return g.id === simGoalId; })[0];
        if (simGoal && simAmount > 0) {
          var simResult = simulateScenario_(simGoal, simType, simAmount);
          // Attach result to executed for the reply builder to surface
          executed.push('simulate_scenario:' + JSON.stringify(simResult));
        } else {
          errors.push('simulate_scenario: goal ' + simGoalId + ' not found or amount invalid');
        }
      }
      else if (type === 'save_scenario') {
        var ssGoalId   = (args[0] || '').trim();
        var ssType     = (args[1] || 'one-time').trim();
        var ssAmount   = parseFloat(args[2]) || 0;
        var ssLabel    = (args[3] || '').trim();
        var ssNotes    = (args[4] || '').trim();
        var ssGoals2   = getFinancialGoals_();
        var ssGoal2    = ssGoals2.filter(function(g) { return g.id === ssGoalId; })[0];
        if (ssGoal2 && ssAmount > 0) {
          var ssResult = simulateScenario_(ssGoal2, ssType, ssAmount);
          var ssId     = saveScenario_(ssGoalId, ssLabel, ssType, ssAmount, ssNotes, ssResult);
          executed.push('save_scenario (' + ssLabel + ', id=' + ssId + ')');
        } else {
          errors.push('save_scenario: goal ' + ssGoalId + ' not found or amount invalid');
        }
      }
      // Resources — fetch Google Doc content (Issue #129)
      else if (type === 'fetch_resource_content') {
        var frId = (args[0] || '').trim();
        if (frId) {
          var frResult = webFetchResourceContent_({ parameter: { id: frId } });
          if (frResult.ok) {
            executed.push('fetch_resource_content:' + JSON.stringify({ id: frId, name: frResult.name, content: frResult.content }));
          } else if (frResult.error === 'no_drive_file') {
            // No Drive File ID — URL-only resource, VERA should direct user to the link
            executed.push('fetch_resource_content:link_only:' + frResult.name + ':' + (frResult.url || ''));
          } else if (frResult.error === 'cannot_read_file') {
            // Drive File ID exists but DocumentApp.openById() failed (permissions / wrong file type)
            errors.push('fetch_resource_content: could not read "' + frResult.name + '" — ' +
              (frResult.detail || 'access denied') +
              '. Make sure the Google Doc is shared with the VERA service account (the same Google account running this script), and that it is a Google Docs file (not Sheets or PDF).');
          } else if (frResult.error === 'not found') {
            errors.push('fetch_resource_content: resource "' + frId + '" not found in knowledge base — it may not have been added yet via Explore → Resources');
          } else {
            errors.push('fetch_resource_content: ' + (frResult.error || 'unknown error'));
          }
        } else {
          errors.push('fetch_resource_content: resource id required');
        }
      }

      // ---- Important Dates (Issue #80) ------------------------------------
      else if (type === 'add_important_date') {
        var aidPerson    = (args[0] || 'Both').trim();
        var aidDate      = (args[1] || '').trim();
        var aidLabel     = (args[2] || '').trim();
        var aidRecurring = (args[3] || 'Yes').trim();
        var aidLead      = parseInt(args[4], 10) || 30;
        if (!aidDate || !aidLabel) throw new Error('date and label required for add_important_date');
        var aidResult = webAddImportantDate_({
          parameter: { label: aidLabel, date: aidDate, person: aidPerson,
                       recurring: aidRecurring, leadTime: String(aidLead), notes: '' }
        });
        if (!aidResult.ok) throw new Error(aidResult.error || 'failed to add date');
        executed.push('add_important_date (' + aidLabel + ' — ' + aidDate + ')');
      }
      else if (type === 'log_gift_idea') {
        var lgiPerson = (args[0] || '').trim();
        var lgiIdea   = args.slice(1).join('|').trim(); // idea may contain pipes
        if (!lgiPerson || !lgiIdea) throw new Error('person and idea required for log_gift_idea');
        var lgiResult = webAddGiftIdea_({ parameter: { person: lgiPerson, idea: lgiIdea } });
        if (!lgiResult.ok) throw new Error(lgiResult.error || 'failed to log gift idea');
        executed.push('log_gift_idea (' + lgiPerson + ': ' + lgiIdea + ')');
      }

      // Wish List (Issue #131)
      else if (type === 'add_wish_item') {
        var awPerson   = (args[0] || 'Ahmed').trim();
        var awItem     = (args[1] || '').trim();
        var awCategory = (args[2] || 'Other').trim();
        var awPrice    = (args[3] || '').trim();
        var awPriority = (args[4] || 'Medium').trim();
        var awUrls     = (args[5] || '').trim();
        var awNotes    = (args[6] || '').trim();
        if (!awItem) throw new Error('item is required for add_wish_item');
        webAddWishItem_({ parameter: { person: awPerson, item: awItem, category: awCategory,
                                       price: awPrice, priority: awPriority, urls: awUrls, notes: awNotes } });
        executed.push('add_wish_item (' + awPerson + ': ' + awItem + ')');
      }
      else if (type === 'update_wish_item') {
        var uwId    = (args[0] || '').trim();
        var uwField = (args[1] || '').trim();
        var uwValue = (args[2] || '').trim();
        if (!uwId || !uwField) throw new Error('id and field required for update_wish_item');
        webUpdateWishItem_({ parameter: { id: uwId, field: uwField, value: uwValue } });
        executed.push('update_wish_item (' + uwId + ' ' + uwField + '=' + uwValue + ')');
      }
      else if (type === 'mark_wish_purchased') {
        var mwpId = (args[0] || '').trim();
        if (!mwpId) throw new Error('id required for mark_wish_purchased');
        webMarkWishPurchased_({ parameter: { id: mwpId } });
        executed.push('mark_wish_purchased (' + mwpId + ')');
      }
      else if (type === 'delete_wish_item') {
        var dwId = (args[0] || '').trim();
        if (!dwId) throw new Error('id required for delete_wish_item');
        webDeleteWishItem_({ parameter: { id: dwId } });
        executed.push('delete_wish_item (' + dwId + ')');
      }
      // Experiments (Issue #130)
      else if (type === 'add_experiment') {
        var aePerson     = (args[0] || 'Ahmed').trim();
        var aeTitle      = (args[1] || '').trim();
        var aeCategory   = (args[2] || 'Other').trim();
        var aeHypothesis = (args[3] || '').trim();
        var aeStart      = (args[4] || '').trim();
        var aeEnd        = (args[5] || '').trim();
        var aeNotes      = (args[6] || '').trim();
        if (!aeTitle) throw new Error('title is required for add_experiment');
        webAddExperiment_({ parameter: { person: aePerson, title: aeTitle, category: aeCategory,
                                         hypothesis: aeHypothesis, startDate: aeStart, endDate: aeEnd, notes: aeNotes } });
        executed.push('add_experiment (' + aePerson + ': ' + aeTitle + ')');
      }
      else if (type === 'update_experiment') {
        var ueId    = (args[0] || '').trim();
        var ueField = (args[1] || '').trim();
        var ueValue = (args[2] || '').trim();
        if (!ueId || !ueField) throw new Error('id and field required for update_experiment');
        webUpdateExperiment_({ parameter: { id: ueId, field: ueField, value: ueValue } });
        executed.push('update_experiment (' + ueId + ' ' + ueField + '=' + ueValue + ')');
      }
      else if (type === 'log_experiment_checkin') {
        var lecId   = (args[0] || '').trim();
        var lecNote = (args[1] || '').trim();
        if (!lecId) throw new Error('id required for log_experiment_checkin');
        webAddExperimentCheckin_({ parameter: { experimentId: lecId, note: lecNote } });
        executed.push('log_experiment_checkin (' + lecId + ')');
      }
      else if (type === 'delete_experiment') {
        var deId = (args[0] || '').trim();
        if (!deId) throw new Error('id required for delete_experiment');
        webDeleteExperiment_({ parameter: { id: deId } });
        executed.push('delete_experiment (' + deId + ')');
      }
      // Growth — Books (Issue #88)
      else if (type === 'add_book') {
        var abPerson   = (args[0] || 'Ahmed').trim();
        var abTitle    = (args[1] || '').trim();
        var abAuthor   = (args[2] || '').trim();
        var abCategory = (args[3] || '').trim();
        var abStatus   = (args[4] || 'Want to Read').trim();
        var abRating   = (args[5] || '').trim();
        var abNotes    = (args[6] || '').trim();
        if (!abTitle) throw new Error('title is required for add_book');
        webAddBook_({ parameter: { person: abPerson, title: abTitle, author: abAuthor,
                                   category: abCategory, status: abStatus, rating: abRating, notes: abNotes } });
        executed.push('add_book (' + abPerson + ': "' + abTitle + '" — ' + abStatus + ')');
      }
      else if (type === 'update_book') {
        var ubId    = (args[0] || '').trim();
        var ubField = (args[1] || '').trim();
        var ubValue = (args[2] || '').trim();
        if (!ubId || !ubField) throw new Error('id and field required for update_book');
        webUpdateBook_({ parameter: { id: ubId, field: ubField, value: ubValue } });
        executed.push('update_book (' + ubId + ' ' + ubField + '=' + ubValue + ')');
      }
      else if (type === 'delete_book') {
        var dbId = (args[0] || '').trim();
        if (!dbId) throw new Error('id required for delete_book');
        webDeleteBook_({ parameter: { id: dbId } });
        executed.push('delete_book (' + dbId + ')');
      }
      // Growth — Courses (Issue #88)
      else if (type === 'add_course') {
        var acPerson   = (args[0] || 'Ahmed').trim();
        var acTitle    = (args[1] || '').trim();
        var acSource   = (args[2] || '').trim();
        var acCategory = (args[3] || '').trim();
        var acStatus   = (args[4] || 'Want to Do').trim();
        var acRating   = (args[5] || '').trim();
        var acNotes    = (args[6] || '').trim();
        if (!acTitle) throw new Error('title is required for add_course');
        webAddCourse_({ parameter: { person: acPerson, title: acTitle, source: acSource,
                                     category: acCategory, status: acStatus, rating: acRating, notes: acNotes } });
        executed.push('add_course (' + acPerson + ': "' + acTitle + '" — ' + acStatus + ')');
      }
      else if (type === 'update_course') {
        var ucId    = (args[0] || '').trim();
        var ucField = (args[1] || '').trim();
        var ucValue = (args[2] || '').trim();
        if (!ucId || !ucField) throw new Error('id and field required for update_course');
        webUpdateCourse_({ parameter: { id: ucId, field: ucField, value: ucValue } });
        executed.push('update_course (' + ucId + ' ' + ucField + '=' + ucValue + ')');
      }
      else if (type === 'delete_course') {
        var dcId = (args[0] || '').trim();
        if (!dcId) throw new Error('id required for delete_course');
        webDeleteCourse_({ parameter: { id: dcId } });
        executed.push('delete_course (' + dcId + ')');
      }
      // Growth — Skills (Issue #88)
      else if (type === 'add_skill') {
        var asPerson   = (args[0] || 'Ahmed').trim();
        var asSkill    = (args[1] || '').trim();
        var asCategory = (args[2] || '').trim();
        var asLevel    = (args[3] || 'Beginner').trim();
        var asGoalLink = (args[4] || '').trim();
        var asNotes    = (args[5] || '').trim();
        if (!asSkill) throw new Error('skill is required for add_skill');
        webAddSkill_({ parameter: { person: asPerson, skill: asSkill, category: asCategory,
                                    level: asLevel, goalLink: asGoalLink, notes: asNotes } });
        executed.push('add_skill (' + asPerson + ': ' + asSkill + ' [' + asLevel + '])');
      }
      else if (type === 'update_skill') {
        var usId    = (args[0] || '').trim();
        var usField = (args[1] || '').trim();
        var usValue = (args[2] || '').trim();
        if (!usId || !usField) throw new Error('id and field required for update_skill');
        webUpdateSkill_({ parameter: { id: usId, field: usField, value: usValue } });
        executed.push('update_skill (' + usId + ' ' + usField + '=' + usValue + ')');
      }
      else if (type === 'record_skill_practice') {
        var rspId = (args[0] || '').trim();
        if (!rspId) throw new Error('id required for record_skill_practice');
        webRecordSkillPractice_({ parameter: { id: rspId } });
        executed.push('record_skill_practice (' + rspId + ')');
      }
      else if (type === 'delete_skill') {
        var dsId = (args[0] || '').trim();
        if (!dsId) throw new Error('id required for delete_skill');
        webDeleteSkill_({ parameter: { id: dsId } });
        executed.push('delete_skill (' + dsId + ')');
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

  // Guard: allow image-only messages, but reject empty/whitespace-only text with no image.
  var trimmedMsg = (userMessage || '').trim();
  if (!trimmedMsg && !imageBase64) {
    return { ok: true, reply: 'What can I help you with?' };
  }

  // Victoria-aware: Dashboard Lite uses session 'victoria_dashboard'
  var isVictoria = (sessionId === 'victoria_dashboard');

  var history   = loadChatHistory_(sessionId);
  var context   = isVictoria ? buildVictoriaChatContext_(trimmedMsg) : buildChatContext_(trimmedMsg);
  var sysPrompt = isVictoria ? buildVictoriaChatSystemPrompt_(context) : buildChatSystemPrompt_(context);
  var callResult = callClaudeChat_(
    trimmedMsg, history, sysPrompt,
    imageBase64   || null,
    imageMimeType || null
  );
  var rawReply = callResult.text;
  var sources  = callResult.sources || [];
  Logger.log('VERA raw reply:\n' + rawReply); // visible in Apps Script Execution Log

  // Execute any actions Claude embedded
  var actionResult = executeActions_(rawReply);

  // If any Google Doc was fetched successfully, make a second Claude call with the content
  // so VERA can actually read the document and answer — not just say "let me fetch it"
  var fetchedDocs = actionResult.executed
    .filter(function(r) { return r.indexOf('fetch_resource_content:{') === 0; })
    .map(function(r) {
      try { return JSON.parse(r.substring('fetch_resource_content:'.length)); } catch (fe) { return null; }
    })
    .filter(Boolean);

  if (fetchedDocs.length > 0) {
    var docBlocks = fetchedDocs.map(function(d) {
      return '=== DOCUMENT: ' + d.name + ' ===\n' + (d.content || '(empty)') + '\n=== END ===';
    }).join('\n\n');

    // Build conversation history including the "let me fetch" exchange
    var followUpHistory = history.concat([
      { role: 'user',      content: trimmedMsg || '[Image attached]' },
      { role: 'assistant', content: stripActions_(rawReply) },
    ]);
    var followUpMsg = '[Document content retrieved]\n\n' + docBlocks +
      '\n\nUsing the document above, answer ' + (isVictoria ? 'Victoria\'s' : 'Ahmed\'s') + ' original question directly. ' +
      'Do not say you are fetching or retrieving — you have the content now. ' +
      'Be specific and cite the document where relevant.';
    var followUpResult = callClaudeChat_(followUpMsg, followUpHistory, sysPrompt, null, null);
    rawReply = followUpResult.text;
    sources  = (followUpResult.sources || []).concat(sources);
    Logger.log('VERA fetch follow-up reply:\n' + rawReply);
  }

  // Strip ACTION lines before returning to user
  var cleanReply = stripActions_(rawReply);

  // Surface any action failures so the user knows something went wrong
  if (actionResult.errors.length > 0) {
    cleanReply += '\n\n⚠️ Note: some actions could not be completed — ' + actionResult.errors.join('; ') + '.';
  }

  // Persist this exchange — store [Image attached] placeholder, NEVER raw base64
  // (Script Properties have a 9 KB-per-property limit; base64 images are 100 KB+)
  var historyText = trimmedMsg;
  if (imageBase64) historyText = (historyText ? historyText + ' ' : '') + '[Image attached]';
  saveChatHistory_(sessionId, historyText, cleanReply);

  return { ok: true, reply: cleanReply, sources: sources };
}

// ============================================================
// VICTORIA — Context + System Prompt (Issue #133)
// ============================================================

/**
 * Builds a reduced chat context for Victoria (Dashboard Lite / Slack as Victoria).
 * Loads only shared/household domains — no flags, career, goals, growth, experiments.
 * @param  {string} userMessage  Raw message for intent detection (same as buildChatContext_)
 * @returns {Object}  Context object shaped like buildChatContext_() output but with null for excluded domains
 */
function buildVictoriaChatContext_(userMessage) {
  var ss  = getSpreadsheet();
  var msg = (userMessage || '').toLowerCase();

  // Simple intent detection — same keywords as the main function
  var intent = {
    home:     /recipe|cook|dish|dinner|ingredient|grocery|shopping|store|buy|pantry|chore|clean|vacuum|takeout|food|meal|home|house|item|appliance|maintenance|vehicle|car|truck|oil change|tire/i.test(msg),
    finance:  /bill|payment|due|budget|spend|expense|card|credit|reward|points|loyalty/i.test(msg),
    travel:   /trip|travel|flight|hotel|itinerary|pack|passport|visa|destination|vacation|bucket|country|countries/i.test(msg),
    health:   /prescription|medication|refill|pill|dose|gym|workout|exercise|fitness/i.test(msg),
    people:   /birthday|anniversary|gift|important date|date|celebrate/i.test(msg),
    pto:      /pto|vacation|leave|day off|time off|victoria/i.test(msg),
    memory:   /remember|recall|when did|last time|history|used to|ago|previous/i.test(msg),
  };

  // Always load these for Victoria
  var tasks = [];
  try {
    var openTasks = getOpenTasks();
    // Filter to household-relevant tasks — exclude career/flags/personal tasks
    tasks = openTasks.filter(function(t) {
      var low = (t.task || '').toLowerCase();
      return !/career|work|job|promotion|interview|linkedin|performance review/i.test(low);
    }).slice(0, 20);
  } catch(e) { Logger.log('VictoriaContext: tasks — ' + e.message); }

  // Calendar events (shared view)
  var calendarEvents = [];
  try { calendarEvents = getUpcomingEvents(); }
  catch(e) { Logger.log('VictoriaContext: calendar — ' + e.message); }

  // Shopping
  var shoppingStores = [];
  try {
    var shRes = webGetShopping_();
    shoppingStores = (shRes && shRes.stores) ? shRes.stores.map(function(s) { return s.store; }) : [];
  } catch(e) { Logger.log('VictoriaContext: shopping — ' + e.message); }

  // Interests
  var interests = [];
  try {
    var intRes = webGetInterests_();
    interests = (intRes && intRes.interests) || [];
  } catch(e) { Logger.log('VictoriaContext: interests — ' + e.message); }

  // Important dates
  var importantDates = [];
  try { importantDates = getUpcomingImportantDates_(90); }
  catch(e) { Logger.log('VictoriaContext: importantDates — ' + e.message); }

  // Gift ideas
  var giftIdeas = null;
  if (intent.people) {
    try {
      var gRes = webGetGiftData_();
      if (gRes && gRes.ok) giftIdeas = gRes;
    } catch(e) { Logger.log('VictoriaContext: giftIdeas — ' + e.message); }
  }

  // PTO — both Ahmed's and Victoria's
  var ptoStats = null;
  try {
    var ptoRes = webGetPTO_();
    if (ptoRes && ptoRes.ok) ptoStats = ptoRes;
  } catch(e) { Logger.log('VictoriaContext: ptoStats — ' + e.message); }

  // Home data
  var recipes   = null;
  var homeItems = null;
  var takeouts  = null;
  var pantryDue = null;
  if (intent.home) {
    try {
      var hmRes = webGetRecipes_();
      recipes = (hmRes && hmRes.recipes) || [];
    } catch(e) { Logger.log('VictoriaContext: recipes — ' + e.message); }
    try {
      var hiRes = webGetHomesteward_();
      homeItems = (hiRes && hiRes.items) || [];
    } catch(e) { Logger.log('VictoriaContext: homeItems — ' + e.message); }
    try {
      var taRes = webGetTakeouts_();
      takeouts = (taRes && taRes.restaurants) || [];
    } catch(e) { Logger.log('VictoriaContext: takeouts — ' + e.message); }
    try { pantryDue = getItemsDue_(14); }
    catch(e) { Logger.log('VictoriaContext: pantryDue — ' + e.message); pantryDue = []; }
  }

  // Bills (shared)
  var bills = null;
  if (intent.finance) {
    try {
      var bRes = webGetBills_();
      bills = (bRes && bRes.bills) || [];
    } catch(e) { Logger.log('VictoriaContext: bills — ' + e.message); }
  }

  // Credit cards
  var cardsData = null;
  if (intent.finance) {
    try {
      var cardRes = webGetCards_();
      if (cardRes && cardRes.ok) cardsData = cardRes;
    } catch(e) { Logger.log('VictoriaContext: cards — ' + e.message); }
  }

  // Travel
  var travel      = null;
  var recentTrips = [];
  var countries   = [];
  var bucketList  = [];
  if (intent.travel) {
    try {
      var travelCfg = readPTOConfig_();
      var travelTrips = getUpcomingTravel_(travelCfg);
      var itinByTrip = {}, packByTrip = {}, tripContextMap = {};
      try {
        var itinSheet = ss.getSheetByName(TABS.ITINERARY);
        if (itinSheet && itinSheet.getLastRow() >= 2) {
          var itinRows = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
          itinRows.forEach(function(r) {
            var tk = String(r[1]).trim();
            if (!itinByTrip[tk]) itinByTrip[tk] = [];
            itinByTrip[tk].push({ id: String(r[0]).trim(), type: String(r[2]).trim(), title: String(r[3]).trim(), date: String(r[4]).trim(), startTime: String(r[5]).trim(), location: String(r[7]).trim() });
          });
        }
      } catch(e2) {}
      try {
        var packSheet = ss.getSheetByName(TABS.PACKING_ITEMS);
        if (packSheet && packSheet.getLastRow() >= 2) {
          var packRows = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
          packRows.forEach(function(r) {
            var tk = String(r[1]).trim();
            if (!packByTrip[tk]) packByTrip[tk] = [];
            packByTrip[tk].push({ id: String(r[0]).trim(), person: String(r[2]).trim(), category: String(r[3]).trim(), item: String(r[4]).trim(), checked: String(r[5]).toUpperCase() === 'TRUE' });
          });
        }
      } catch(e3) {}
      travel = { trips: travelTrips, itinByTrip: itinByTrip, packByTrip: packByTrip, tripContextMap: tripContextMap };
    } catch(e) { Logger.log('VictoriaContext: travel — ' + e.message); }
    try {
      var cRes = webGetCountries_();
      countries = (cRes && cRes.entries) || [];
    } catch(e) { Logger.log('VictoriaContext: countries — ' + e.message); }
    try {
      var bListRes = webGetBucketList_();
      bucketList = (bListRes && bListRes.entries) || [];
    } catch(e) { Logger.log('VictoriaContext: bucketList — ' + e.message); }
  }

  // Prescriptions (her own)
  var prescriptions = null;
  if (intent.health) {
    try {
      var pRes = webGetPrescriptions_();
      var allRx = (pRes && pRes.prescriptions) || [];
      // Victoria can see all prescriptions (shared household knowledge)
      prescriptions = allRx;
    } catch(e) { Logger.log('VictoriaContext: prescriptions — ' + e.message); }
  }

  // Memory
  var memoryContext = null;
  if (intent.memory) {
    try { memoryContext = getMemoryContext_(90); }
    catch(e) { Logger.log('VictoriaContext: memory — ' + e.message); }
  }

  // Upcoming guests (Issue #150)
  var upcomingGuests = null;
  if (intent.home) {
    try {
      var guestCfg = readPTOConfig_();
      upcomingGuests = getUpcomingGuests_(guestCfg);
    } catch(e) { Logger.log('VictoriaContext: upcomingGuests — ' + e.message); upcomingGuests = []; }
  }

  return {
    flags:          [],          // Victoria does not see Ahmed's flags
    tasks:          tasks,
    summaries:      [],
    calendarEvents: calendarEvents,
    interests:      interests,
    ptoStats:       ptoStats,
    goals:          null,        // Ahmed-specific
    bills:          bills,
    recipes:        recipes,
    homeItems:      homeItems,
    shoppingStores: shoppingStores,
    ideas:          null,        // Ahmed-specific
    travel:         travel,
    recentTrips:    recentTrips,
    countries:      countries,
    bucketList:     bucketList,
    takeouts:       takeouts,
    pantryDue:      pantryDue,
    upcomingGuests: upcomingGuests,
    career:         null,        // Ahmed-specific
    prescriptions:  prescriptions,
    gymLog:         null,        // Ahmed-specific
    cardsData:      cardsData,
    financialGoals: null,        // Ahmed-specific
    importantDates: importantDates,
    giftIdeas:      giftIdeas,
    wishList:       null,
    experiments:    null,        // Ahmed-specific
    growthData:     null,        // Ahmed-specific
    memoryContext:  memoryContext,
    // Victoria-specific projects/projectsSummary not needed
    projects:       null,
    projectsSummary: '',
  };
}

/**
 * Builds the system prompt for Victoria's chat session.
 * Addresses her by name, scoped to household / travel / shared domains.
 * @param  {Object} context  From buildVictoriaChatContext_()
 * @returns {string}
 */
function buildVictoriaChatSystemPrompt_(context) {
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  var taskLines = (!context.tasks || context.tasks.length === 0)
    ? '  (none open)'
    : context.tasks.map(function(t) {
        var line = '  - ' + t.task + ' (ID: ' + t.id + ')';
        if (t.dueDate)   line += ' | due: ' + t.dueDate;
        if (t.isOverdue) line += ' \u26a0 OVERDUE';
        if (t.recurring) line += ' \ud83d\udd01 ' + t.recurring;
        return line;
      }).join('\n');

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
      return ln;
    }).join('\n');
  }

  var billLines = (!context.bills || context.bills.length === 0)
    ? '  (none)'
    : context.bills.map(function(b) {
        return '  [row:' + b.row + '] ' + b.bill +
               (b.amount ? ' $' + b.amount : '') +
               ' (' + b.frequency + ')' +
               (b.dueDay ? ' due day ' + b.dueDay : '') +
               (b.paid ? ' \u2713 PAID this month' : ' \u2014 UNPAID');
      }).join('\n');

  var recipeLines = (!context.recipes || context.recipes.length === 0)
    ? '  (none)'
    : context.recipes.map(function(r) {
        return '  [row:' + r.row + '] ' + r.name + (r.cuisine ? ' (' + r.cuisine + ')' : '');
      }).join('\n');

  var homeItemLines = (!context.homeItems || context.homeItems.length === 0)
    ? '  (none)'
    : context.homeItems.map(function(h) {
        var svc = h.nextService ? ' next service: ' + h.nextService : '';
        if (h.serviceDays !== null && h.serviceDays < 0) svc += ' \u26a0 OVERDUE';
        else if (h.serviceDays !== null && h.serviceDays <= 14) svc += ' (due soon)';
        return '  [row:' + h.row + '] ' + h.item + (h.category ? ' [' + h.category + ']' : '') + svc;
      }).join('\n');

  var shoppingStoresList = (!context.shoppingStores || context.shoppingStores.length === 0)
    ? '(none configured)'
    : context.shoppingStores.join(', ');

  var takeoutLines = (!context.takeouts || context.takeouts.length === 0)
    ? '  (none saved yet)'
    : context.takeouts.map(function(r) {
        var items = r.items.length > 0
          ? r.items.map(function(it) { return '    \u2022 ' + it.item + (it.description ? ' \u2014 ' + it.description : ''); }).join('\n')
          : '    (no items yet)';
        return '  ' + r.name + (r.cuisine ? ' [' + r.cuisine + ']' : '') + '\n' + items;
      }).join('\n');

  var pantryLines = (!context.pantryDue || context.pantryDue.length === 0)
    ? '  (pantry tracking not active or no purchases logged)'
    : context.pantryDue.map(function(p) {
        return '  ' + p.normalized + (p.daysUntil <= 0 ? ' \u2014 likely OUT' : ' \u2014 est. out in ~' + p.daysUntil + 'd') + (p.store ? ' (usually: ' + p.store + ')' : '');
      }).join('\n');

  var interestLines = (!context.interests || context.interests.length === 0)
    ? '  (none logged yet)'
    : context.interests.map(function(i) {
        return '  - [ID:' + i.id + '] ' + i.person + ': ' + i.interest + ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  var importantDatesLines = (function() {
    var dates = context.importantDates;
    if (!dates || dates.length === 0) return '  (none in next 90 days)';
    return dates.map(function(d) {
      var days = d['daysUntil'];
      var when = days === 0 ? 'TODAY' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      var line = '  \u2022 ' + d['Name'] + ' \u2014 ' + d['Event'] + ' [' + when + ']';
      if (d['Gift Ideas']) line += ' | gift ideas: ' + d['Gift Ideas'];
      return line;
    }).join('\n');
  })();

  var ptoSection = context.ptoStats
    ? ptoSummaryForClaude_(context.ptoStats)
    : '  (unavailable)';

  // Travel sections (reuse the same pattern as buildChatSystemPrompt_)
  var travelSection = (function() {
    var travel = context.travel;
    if (!travel || !travel.trips || travel.trips.length === 0) return 'UPCOMING TRIPS:\n  (No upcoming trips found)\n\n';
    var lines = 'UPCOMING TRIPS:\n';
    travel.trips.forEach(function(t) {
      var tk  = t.startDate + '|' + t.label;
      var famNote = t.isExtendedFamily ? ' [extended family]' : '';
      lines += 'Trip: ' + t.label + ' (' + t.startDate + ' \u2013 ' + t.endDate + ')' + famNote + ' | TripKey: ' + tk + '\n';
      var items = (travel.itinByTrip && travel.itinByTrip[tk]) || [];
      if (items.length > 0) {
        lines += '  Itinerary (' + items.length + ' item' + (items.length === 1 ? '' : 's') + '):\n';
        items.forEach(function(it) {
          lines += '    [' + it.id + '] ' + it.date + ' [' + it.type + '] ' + it.title + (it.location ? ' @ ' + it.location : '') + '\n';
        });
      }
      var pItems = (travel.packByTrip && travel.packByTrip[tk]) || [];
      if (pItems.length > 0) {
        var packed = pItems.filter(function(p) { return p.checked; }).length;
        lines += '  Packing (' + pItems.length + ' items, ' + packed + ' packed):\n';
        pItems.forEach(function(p) {
          lines += '    [' + p.id + '] ' + p.person + ' / ' + p.category + ' \u2014 ' + p.item + (p.checked ? ' [packed]' : ' [unpacked]') + '\n';
        });
      }
    });
    return lines + '\n';
  })();

  var guestSection = (function() {
    if (!context.upcomingGuests || !context.upcomingGuests.length) return '';
    var lines = 'UPCOMING HOUSE GUESTS (' + context.upcomingGuests.length + '):\n';
    context.upcomingGuests.forEach(function(g) {
      var when = g.daysAway === 0 ? 'today' : (g.daysAway === 1 ? 'tomorrow' : 'in ' + g.daysAway + ' days');
      lines += '  \u2022 ' + g.label + ' \u2014 arriving ' + g.arrivalDate + ', departing ' + g.departureDate + ' (' + g.durationDays + ' night' + (g.durationDays === 1 ? '' : 's') + ', ' + when + ')\n';
    });
    return lines + '\n';
  })();

  var rxLines = (!context.prescriptions || context.prescriptions.length === 0)
    ? '  (none logged)'
    : context.prescriptions.map(function(p) {
        return '  [' + p.person + '] ' + p.medication + ' ' + p.dosage + ' ' + p.frequency +
               (p.refillDate ? ' | refill: ' + p.refillDate : '');
      }).join('\n');

  var memorySect = (!context.memoryContext || !context.memoryContext.events || !context.memoryContext.events.length)
    ? ''
    : 'MEMORY LOG (recent events):\n' +
      context.memoryContext.events.slice(0, 20).map(function(ev) {
        return '  \u2022 [' + (ev.date || '') + '] ' + (ev.summary || ev.event || '');
      }).join('\n') + '\n\n';

  return (
    'You are VERA \u2014 Virtual Executive & Reminder Assistant.\n' +
    'You are the household and travel assistant for Victoria (and her partner Ahmed).\n\n' +
    'Today is ' + today + '.\n\n' +

    'OPEN TASKS:\n' + taskLines + '\n\n' +

    'UPCOMING CALENDAR EVENTS (raw schedule data):\n' + calLines + '\n\n' +

    travelSection +
    guestSection +

    'BILLS:\n' + billLines + '\n\n' +

    'RECIPES:\n' + recipeLines + '\n\n' +

    'HOME ITEMS (appliances & maintenance):\n' + homeItemLines + '\n\n' +

    'SHOPPING STORES: ' + shoppingStoresList + '\n\n' +

    'FAVOURITE TAKEOUTS:\n' + takeoutLines + '\n\n' +

    'PANTRY STATUS (items running low):\n' + pantryLines + '\n\n' +

    'UPCOMING IMPORTANT DATES (next 90 days):\n' + importantDatesLines + '\n\n' +

    'SHARED INTERESTS:\n' + interestLines + '\n\n' +

    'PRESCRIPTIONS:\n' + rxLines + '\n\n' +

    (context.ptoStats ? 'PTO STATUS:\n' + ptoSection + '\n\n' : '') +

    memorySect +

    '== CAPABILITIES ==\n' +
    'You can take actions by embedding ACTION lines at the end of your reply. Each action is on its own line:\n' +
    '  ACTION:type|arg1|arg2|...\n\n' +
    'Available actions:\n' +
    '- For add_task: ACTION:add_task|{task description}|{due date YYYY-MM-DD or blank}|{recurring: daily/weekly/monthly or blank}\n' +
    '- For complete_task: ACTION:complete_task|{task ID}\n' +
    '- For add_shopping_item: ACTION:add_shopping_item|{store}|{item}|{qty or blank}\n' +
    '- For toggle_shopping_item: ACTION:toggle_shopping_item|{store}|{item}\n' +
    '- For add_itinerary_item: use the TripKey exactly as shown in UPCOMING TRIPS (e.g., "2026-06-19|Alaska Cruise"). Date must be YYYY-MM-DD.\n' +
    '  ACTION:add_itinerary_item|{tripKey}|{type: flight/hotel/activity/restaurant/other}|{title}|{date YYYY-MM-DD}|{startTime HH:MM or blank}|{endTime or blank}|{location or blank}|{notes or blank}\n' +
    '- For update_itinerary_item: ACTION:update_itinerary_item|{item ID}|{field}|{new value}\n' +
    '- For delete_itinerary_item: ACTION:delete_itinerary_item|{item ID}\n' +
    '- For check_packing_item: ACTION:check_packing_item|{item ID}|{true or false}\n' +
    '- For add_packing_item: ACTION:add_packing_item|{tripKey}|{person: ahmed/victoria/shared}|{category}|{item}\n' +
    '- For delete_packing_item: ACTION:delete_packing_item|{item ID}\n' +
    '- For generate_packing_list: ACTION:generate_packing_list|{tripKey}|{startDate YYYY-MM-DD}|{endDate YYYY-MM-DD}\n' +
    '- For add_country: ACTION:add_country|{country}|{city or blank}|{year or blank}|{traveller: Ahmed/Victoria/Both}|{notes or blank}\n' +
    '- For add_bucket_item: ACTION:add_bucket_item|{country}|{city or blank}|{notes or blank}|{targetYear or blank}|{stars 1-5 or blank}\n' +
    '- For add_interest: ACTION:add_interest|{person: Ahmed/Victoria/Both}|{interest}|{category}|{date YYYY-MM-DD or blank}\n' +
    '- For delete_interest: ACTION:delete_interest|{ID}\n' +
    '- For add_important_date: ACTION:add_important_date|{name}|{event type}|{date MM-DD}|{notes or blank}\n' +
    '- For update_important_date: ACTION:update_important_date|{ID}|{field}|{value}\n' +
    '- For delete_important_date: ACTION:delete_important_date|{ID}\n' +
    '- For add_gift_idea: ACTION:add_gift_idea|{person name}|{idea}\n' +
    '- For delete_gift_idea: ACTION:delete_gift_idea|{idea ID}\n' +
    '- For add_prescription: ACTION:add_prescription|{person}|{medication}|{dosage}|{frequency}|{refillDate YYYY-MM-DD or blank}|{notes or blank}\n' +
    '- For add_home_item: ACTION:add_home_item|{item}|{category}|{serviceIntervalDays or blank}|{notes or blank}\n' +
    '- For delete_home_item: ACTION:delete_home_item|{row}\n' +
    '- For add_recipe: ACTION:add_recipe|{name}|{cuisine or blank}|{ingredients semicolon-separated or blank}\n' +
    '- For delete_recipe: ACTION:delete_recipe|{row}\n' +
    '- For web_search: ACTION:web_search|{query}\n\n' +
    'IMPORTANT RULES:\n' +
    '- Never include ACTION lines in your visible reply \u2014 strip them out before responding.\n' +
    '- Use IDs from context (task ID, itinerary ID, packing item ID) exactly as shown.\n' +
    '- If asked about Ahmed\'s flags, career goals, personal finances, growth tracking, or experiments, let Victoria know those live in Ahmed\'s private dashboard.\n' +
    '- Be warm, helpful, and concise. Address Victoria by name when appropriate.\n'
  );
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
