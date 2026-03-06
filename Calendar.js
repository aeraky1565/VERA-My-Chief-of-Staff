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
 * @returns {Array} Sorted array of event objects
 */
function getUpcomingEvents() {
  try {
    const now     = new Date();
    const endDate = new Date(now.getTime() + CONFIG.CALENDAR_DAYS_AHEAD * 24 * 60 * 60 * 1000);
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

    // Owned calendar IDs for fallback detection (only used when no label defined)
    const ownedIds = {};
    CalendarApp.getAllOwnedCalendars().forEach(function(c) {
      ownedIds[c.getId()] = true;
    });

    // ---- Fetch events ------------------------------------------------------
    const events    = [];
    const calendars = CalendarApp.getAllCalendars();

    calendars.forEach(function(calendar) {
      const calNameRaw   = calendar.getName();
      const calNameLower = calNameRaw.toLowerCase();

      // Skip calendars on the skip list
      if (skipList.indexOf(calNameLower) !== -1) {
        Logger.log('Skipping calendar (skip_calendars): "' + calNameRaw + '"');
        return;
      }

      let calEvents;
      try {
        calEvents = calendar.getEvents(now, endDate);
      } catch (calErr) {
        Logger.log('Skipping calendar "' + calNameRaw + '" (error): ' + calErr.message);
        return;
      }

      // Determine the label for this calendar
      // Priority: Config label → auto-detect owned/shared
      let calLabel;
      if (calendarLabels[calNameLower]) {
        calLabel = calendarLabels[calNameLower];
      } else if (ownedIds[calendar.getId()]) {
        calLabel = 'personal (' + calNameRaw + ')';
      } else {
        calLabel = 'shared: ' + calNameRaw;
      }

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

        events.push({
          title:        event.getTitle() || '(No title)',
          start:        Utilities.formatDate(startTime,          tz, 'yyyy-MM-dd HH:mm'),
          end:          Utilities.formatDate(event.getEndTime(), tz, 'yyyy-MM-dd HH:mm'),
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

    Logger.log('Calendar: fetched ' + events.length + ' events across ' + calendars.length + ' calendars.');
    return events;

  } catch (e) {
    Logger.log('getUpcomingEvents error: ' + e.message);
    return [];
  }
}
