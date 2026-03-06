// ============================================================
// VERA — Calendar.js
// Reads upcoming Google Calendar events for the next N days
// ============================================================

// Maps Google Calendar event color IDs to human-readable names.
// Used to surface color tags in the Claude prompt.
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
 * Each event includes:
 *   - isOwnedCalendar: true if Ahmed owns this calendar, false if it's shared
 *   - myStatus: Ahmed's RSVP status (organizer / accepted / tentative / invited / declined)
 *   - eventColor: the color tag applied directly to this event (if any)
 *
 * @returns {Array} Sorted array of event objects
 */
function getUpcomingEvents() {
  try {
    const now     = new Date();
    const endDate = new Date(now.getTime() + CONFIG.CALENDAR_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    const tz      = Session.getScriptTimeZone();

    // Build a set of calendar IDs that Ahmed owns (vs shared with him)
    const ownedIds = {};
    CalendarApp.getAllOwnedCalendars().forEach(function(c) {
      ownedIds[c.getId()] = true;
    });

    const events    = [];
    const calendars = CalendarApp.getAllCalendars();

    calendars.forEach(function(calendar) {
      let calEvents;
      try {
        calEvents = calendar.getEvents(now, endDate);
      } catch (calErr) {
        // Some shared/read-only calendars can throw — skip gracefully
        Logger.log('Skipping calendar "' + calendar.getName() + '": ' + calErr.message);
        return;
      }

      const isOwned = !!ownedIds[calendar.getId()];

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
        } catch (e) { /* leave as 'organizer' */ }

        // ---- Event color tag ---------------------------------------------
        // A color set directly on the event (not the calendar color).
        // Empty string means "uses calendar color" — no specific tag.
        let eventColor = '';
        try {
          const colorId = event.getColor();
          eventColor = EVENT_COLOR_NAMES[colorId] || '';
        } catch (e) { /* no color */ }

        events.push({
          title:           event.getTitle() || '(No title)',
          start:           Utilities.formatDate(startTime,        tz, 'yyyy-MM-dd HH:mm'),
          end:             Utilities.formatDate(event.getEndTime(), tz, 'yyyy-MM-dd HH:mm'),
          daysUntil:       Math.max(0, daysUntil),
          isAllDay:        event.isAllDayEvent(),
          location:        event.getLocation() || '',
          calendarName:    calendar.getName(),
          isOwnedCalendar: isOwned,
          myStatus:        myStatus,
          eventColor:      eventColor,
        });
      });
    });

    // Sort chronologically
    events.sort(function(a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    });

    const ownedCount  = events.filter(function(e) { return e.isOwnedCalendar;  }).length;
    const sharedCount = events.filter(function(e) { return !e.isOwnedCalendar; }).length;
    Logger.log('Calendar: fetched ' + events.length + ' events (' + ownedCount + ' owned, ' + sharedCount + ' shared) across ' + calendars.length + ' calendars.');

    return events;

  } catch (e) {
    Logger.log('getUpcomingEvents error: ' + e.message);
    return [];
  }
}
