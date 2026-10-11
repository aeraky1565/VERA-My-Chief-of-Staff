// ============================================================
// VERA — Calendar.js
// Reads upcoming Google Calendar events for the next N days
// ============================================================

// Maps Google Calendar event color IDs to human-readable names.
const EVENT_COLOR_NAMES = {
  '1':  'Lavender',
  '2':  'Sage',
  '3':  'Grape',
  '4':  'Flamingo',
  '5':  'Banana',
  '6':  'Tangerine',
  '7':  'Peacock',
  '8':  'Graphite',
  '9':  'Blueberry',
  '10': 'Basil',
  '11': 'Tomato',
};

// Per-execution memo behind getUpcomingEventsCached_, keyed by the resolved day
// count. Apps Script hands every execution a fresh global scope, so "per execution"
// needs no expiry — the same reason _spreadsheet_ (Code.js) and _calendarByName_
// (PTO.js) are plain globals.
var _upcomingEventsCache_ = {};

// Set once per execution when the Calendar advanced service answers "this API is not
// enabled". Read in Phase 2 below.
var _calendarAdvancedUnavailable_ = false;

/** Drops the memo. Called by TestBench to time a cold scan against a warm one. */
function invalidateUpcomingEvents_() { _upcomingEventsCache_ = {}; }

/** Re-arms the advanced-service probe, so a TestBench run reports what is true now. */
function invalidateCalendarAdvanced_() { _calendarAdvancedUnavailable_ = false; }

/**
 * Fetches all calendar events across all of the user's calendars
 * for the next CALENDAR_DAYS_AHEAD days.
 *
 * Calendar labeling (for Claude context) is driven by the Config tab:
 *   skip_calendars           → comma-separated calendar names to ignore entirely
 *   calendar_label:CalName   → custom label for a calendar (e.g. "family (shared)")
 *
 * If no label is defined for a calendar, falls back to auto-detecting
 * owned vs shared using Google's calendar ownership API.
 *
 * Times are shown in each event's own timezone (e.g. "09:00 EST" for a NYC
 * departure, "11:30 PST" for an LA arrival) using per-event timezone data
 * from the Calendar REST API.  Falls back to the script timezone if the
 * per-event timezone is not available.
 *
 * @returns {Array} Sorted array of event objects
 */
function getUpcomingEvents(daysAheadOverride) {
  try {
    const now        = new Date();
    const daysToScan = (typeof daysAheadOverride === 'number' && daysAheadOverride > 0)
      ? daysAheadOverride
      : CONFIG.CALENDAR_DAYS_AHEAD;
    const endDate = new Date(now.getTime() + daysToScan * 24 * 60 * 60 * 1000);
    const tz      = Session.getScriptTimeZone();

    // ---- Read config -------------------------------------------------------
    const cfg = getConfigValues();

    // Calendars to skip entirely (exact name match, case-insensitive)
    const skipList = (cfg['skip_calendars'] || '')
      .split(',')
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(function(s) { return s !== ''; });

    // calendar_label:* entries — build a lookup: calendarName → label
    const calendarLabels = {};
    Object.keys(cfg).forEach(function(key) {
      if (key.indexOf('calendar_label:') === 0) {
        const calName = key.substring('calendar_label:'.length).trim();
        calendarLabels[calName.toLowerCase()] = cfg[key].trim();
      }
    });

    // Victoria's calendars — anything in this list is labelled "shared"
    // Everything else (including third-party subscriptions) defaults to Ahmed's personal
    const victoriaCalendars = (cfg['victoria_calendars'] || '')
      .split(',')
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(function(s) { return s !== ''; });

    // ---- Phase 1: Filter calendars -----------------------------------------
    // Separate the filtering pass so we can batch-fetch timezone info in parallel.
    const activeCalendars = [];   // [{ calendar, calNameRaw, calLabel }]
    CalendarApp.getAllCalendars().forEach(function(calendar) {
      const calNameRaw   = calendar.getName();
      const calNameLower = calNameRaw.toLowerCase();

      if (skipList.indexOf(calNameLower) !== -1) {
        Logger.log('Skipping calendar (skip_calendars): "' + calNameRaw + '"');
        return;
      }

      let calLabel;
      if (calendarLabels[calNameLower]) {
        // Explicit label from Config tab takes priority
        calLabel = calendarLabels[calNameLower];
      } else if (victoriaCalendars.indexOf(calNameLower) !== -1) {
        // Victoria's calendar — shared between Ahmed and Victoria
        calLabel = 'shared: ' + calNameRaw;
      } else {
        // Everything else (owned, subscribed, imported) defaults to Ahmed's personal
        calLabel = 'personal (' + calNameRaw + ')';
      }

      activeCalendars.push({ calendar: calendar, calNameRaw: calNameRaw, calLabel: calLabel });
    });

    // ---- Phase 2: Fetch per-event timezone info via Calendar Advanced Service --
    // Each event may have its own timezone (e.g. a flight arriving in PST).
    // CalendarApp doesn't expose per-event timezone; Calendar.Events.list() does.
    //
    // This pass is PURE COST when the advanced service is switched off, which it is
    // on this project: it threw for every one of 11 calendars, and the only trace was
    // a Logger.log line nobody reads. So the first "you have not enabled this API"
    // answer is taken as final for the rest of the execution — the remaining calendars
    // skip the call and keep an empty map, which is exactly the state the catch already
    // produced, so Phase 3's `tzInfo.startTz || tz` fallback needs no change.
    //
    // A TRANSIENT failure is deliberately not taken as final. One calendar timing out
    // must not silence the other ten; only Google saying the API is off does that.
    var calTzMaps = {};   // calendarId → { eventId/iCalUID: { startTz, endTz } }
    var advAlreadyDown = _calendarAdvancedUnavailable_;
    var tzOk = false, tzErrText = '';
    activeCalendars.forEach(function(c) {
      const map = {};
      if (_calendarAdvancedUnavailable_) {
        calTzMaps[c.calendar.getId()] = map;
        return;
      }
      try {
        const result = Calendar.Events.list(c.calendar.getId(), {
          singleEvents: true,
          maxResults:   500,
          timeMin:      now.toISOString(),
          timeMax:      endDate.toISOString(),
          fields:       'items(id,iCalUID,start/timeZone,end/timeZone)',
        });
        (result.items || []).forEach(function(item) {
          const entry = {
            startTz: (item.start && item.start.timeZone) || null,
            endTz:   (item.end   && item.end.timeZone)   || null,
          };
          if (item.id)      map[item.id]      = entry;
          if (item.iCalUID) map[item.iCalUID] = entry;
        });
        tzOk = true;
      } catch (tzErr) {
        tzErrText = tzErr.message;
        Logger.log('Calendar: timezone fetch failed for "' + c.calNameRaw + '" — ' + tzErr.message);
        if (googleApiNotEnabled_(tzErr.message)) {
          _calendarAdvancedUnavailable_ = true;
          Logger.log('Calendar: the Calendar advanced service is NOT ENABLED. Skipping the ' +
                     'per-event timezone pass for the rest of this execution — every event ' +
                     'falls back to the script timezone until the Google Calendar API is ' +
                     'enabled on the Cloud project.');
        }
      }
      calTzMaps[c.calendar.getId()] = map;
    });

    // ONE health record per scan, not one per calendar: recordApiHealth_ writes Script
    // Properties and can send an alert (ApiHealth.js). Nothing recorded this at all
    // before, which is why a whole night of timezone fallbacks never reached the
    // morning banner — the symptom (every event on the script timezone) was visible
    // and its cause was not.
    //
    // ok = "at least one call worked". A single flaky calendar alongside ten good ones
    // is partial timezone data, already logged above, and not worth a daily banner line;
    // the API being off is, and that is the case this catches.
    //
    // Skipped entirely when the service was already known down earlier in this
    // execution: re-recording would inflate consecutiveFailures and overwrite the real
    // error message with an empty one.
    if (activeCalendars.length && !advAlreadyDown) {
      recordApiHealth_('googlecalendar-advanced', tzOk, tzErrText, 0);
    }

    // ---- Phase 3: Fetch events and format with per-event timezone -----------
    const events = [];

    activeCalendars.forEach(function(calInfo) {
      const calendar   = calInfo.calendar;
      const calNameRaw = calInfo.calNameRaw;
      const calLabel   = calInfo.calLabel;

      let calEvents;
      try {
        calEvents = calendar.getEvents(now, endDate);
      } catch (calErr) {
        Logger.log('Skipping calendar "' + calNameRaw + '" (error): ' + calErr.message);
        return;
      }

      const eventTzMap = calTzMaps[calendar.getId()] || {};

      calEvents.forEach(function(event) {
        const startTime = event.getStartTime();

        // daysUntil: 0 = today, 1 = tomorrow, etc.
        const msPerDay     = 1000 * 60 * 60 * 24;
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfEvent = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
        const daysUntil    = Math.round((startOfEvent - startOfToday) / msPerDay);

        // ---- RSVP / attendance status ------------------------------------
        let myStatus = 'organizer';
        try {
          const statusObj = event.getMyStatus();
          if      (statusObj === CalendarApp.GuestStatus.YES)     myStatus = 'accepted';
          else if (statusObj === CalendarApp.GuestStatus.NO)      myStatus = 'declined';
          else if (statusObj === CalendarApp.GuestStatus.MAYBE)   myStatus = 'tentative';
          else if (statusObj === CalendarApp.GuestStatus.INVITED) myStatus = 'invited (no response)';
          else if (statusObj === CalendarApp.GuestStatus.OWNER)   myStatus = 'organizer';
        } catch (e) { /* leave as organizer */ }

        // ---- Event color tag (manually applied by Ahmed) -----------------
        let eventColor = '';
        try {
          const colorId = event.getColor();
          eventColor = EVENT_COLOR_NAMES[colorId] || '';
        } catch (e) { /* no color */ }

        // ---- Timezone-aware time formatting --------------------------------
        // Per-event timezone comes from the Calendar REST API response.
        // Falls back to the script's timezone if not set.
        // All-day events have no time component — formatted as date only.
        const tzInfo  = eventTzMap[event.getId()] || {};
        const startTz = tzInfo.startTz || tz;
        const endTz   = tzInfo.endTz   || tz;

        const startFmt = event.isAllDayEvent()
          ? Utilities.formatDate(startTime,          tz,      'yyyy-MM-dd')
          : Utilities.formatDate(startTime,          startTz, 'yyyy-MM-dd HH:mm z');
        const endFmt = event.isAllDayEvent()
          ? Utilities.formatDate(event.getEndTime(), tz,    'yyyy-MM-dd')
          : Utilities.formatDate(event.getEndTime(), endTz, 'yyyy-MM-dd HH:mm z');

        events.push({
          title:        event.getTitle() || '(No title)',
          start:        startFmt,
          end:          endFmt,
          daysUntil:    Math.max(0, daysUntil),
          isAllDay:     event.isAllDayEvent(),
          location:     event.getLocation() || '',
          calendarName: calNameRaw,
          calLabel:     calLabel,
          myStatus:     myStatus,
          eventColor:   eventColor,
        });
      });
    });

    // Sort chronologically
    events.sort(function(a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    });

    Logger.log('Calendar: fetched ' + events.length + ' events across ' + activeCalendars.length + ' calendars.');
    return events;

  } catch (e) {
    Logger.log('getUpcomingEvents error: ' + e.message);
    return [];
  }
}

/**
 * getUpcomingEvents() for consumers that only AGGREGATE events, memoised for the
 * life of the execution.
 *
 * One nightly run used to do the identical all-calendar scan four times — the
 * collect step (Code.js), buildCalendarMetrics_ (Summaries.js), the pattern
 * snapshot (PatternRecognition.js) and runExplorer_ (Reminders.js) — all with no
 * argument, so all four scanned the same window. At the 12.6s that scan measured in
 * the morning timings that is ~38s of duplicated work inside the run that has twice
 * been killed by the six-minute ceiling.
 *
 * WHY THIS IS OPT-IN rather than a memo on getUpcomingEvents itself:
 * VERA creates and deletes calendar events in about fifteen places across eight
 * files (ImportantDates.js, PTO.js, Scheduler.js, WeekendPlanner.js, Chat.js,
 * WebApp.js, Code.js). Memoising the function everyone calls would mean invalidating
 * at every one of them, and a forgotten site would return a WRONG answer. Opt-in
 * means a forgotten site is only a missed speedup. The failure mode is the right way
 * round, and getUpcomingEvents keeps its contract: always live.
 *
 * So: if you mutate the calendar and then need to read it back, call
 * getUpcomingEvents(). This one may be stale within the execution.
 *
 * An empty result is NOT cached. getUpcomingEvents returns [] both for "nothing in
 * the window" and for "the whole scan failed" (its catch above) and the caller cannot
 * tell them apart, so caching [] would let one failed scan poison the rest of the
 * execution. Cost: a genuinely empty window re-scans. Same rule as
 * _weatherForecastCache_.
 *
 * Returns a copy, so a consumer that sorts or splices in place cannot corrupt the
 * next one. The event objects themselves are shared.
 *
 * @param {number} [daysAhead]  Same meaning as getUpcomingEvents'
 * @returns {Array} Sorted array of event objects
 */
function getUpcomingEventsCached_(daysAhead) {
  var days = (typeof daysAhead === 'number' && daysAhead > 0)
    ? daysAhead
    : CONFIG.CALENDAR_DAYS_AHEAD;
  var key = String(days);

  if (_upcomingEventsCache_[key]) return _upcomingEventsCache_[key].slice();

  var events = getUpcomingEvents(days);
  if (events && events.length) {
    _upcomingEventsCache_[key] = events;
    return events.slice();
  }
  return events;   // uncached — empty window, or a scan that failed
}
