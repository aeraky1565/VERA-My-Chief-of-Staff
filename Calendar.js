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
    var calTzMaps = {};   // calendarId → { eventId/iCalUID: { startTz, endTz } }
    activeCalendars.forEach(function(c) {
      const map = {};
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
      } catch (tzErr) {
        Logger.log('Calendar: timezone fetch failed for "' + c.calNameRaw + '" — ' + tzErr.message);
      }
      calTzMaps[c.calendar.getId()] = map;
    });

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
