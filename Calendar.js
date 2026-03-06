// ============================================================
// VERA — Calendar.js
// Reads upcoming Google Calendar events for the next N days
// ============================================================

/**
 * Fetches all calendar events across all of the user's calendars
 * for the next CALENDAR_DAYS_AHEAD days.
 *
 * @returns {Array} Sorted array of event objects:
 *   { title, start, end, daysUntil, isAllDay, location, calendarName }
 */
function getUpcomingEvents() {
  try {
    const now     = new Date();
    const endDate = new Date(now.getTime() + CONFIG.CALENDAR_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    const tz      = Session.getScriptTimeZone();

    const events      = [];
    const calendars   = CalendarApp.getAllCalendars();

    // Calendars to skip — add display names here if needed (e.g. 'Holidays in United States')
    const skipCalendars = [];

    calendars.forEach(function(calendar) {
      if (skipCalendars.indexOf(calendar.getName()) !== -1) return;

      let calEvents;
      try {
        calEvents = calendar.getEvents(now, endDate);
      } catch (calErr) {
        // Some shared/read-only calendars can throw — skip gracefully
        Logger.log('Skipping calendar "' + calendar.getName() + '": ' + calErr.message);
        return;
      }

      calEvents.forEach(function(event) {
        const startTime = event.getStartTime();
        const endTime   = event.getEndTime();

        // daysUntil: 0 = today, 1 = tomorrow, etc.
        const msPerDay  = 1000 * 60 * 60 * 24;
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfEvent = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
        const daysUntil = Math.round((startOfEvent - startOfToday) / msPerDay);

        // Truncate description to avoid bloating the Claude prompt
        const rawDesc = event.getDescription() || '';
        const description = rawDesc.length > 300 ? rawDesc.substring(0, 297) + '...' : rawDesc;

        events.push({
          title:        event.getTitle()    || '(No title)',
          start:        Utilities.formatDate(startTime, tz, 'yyyy-MM-dd HH:mm'),
          end:          Utilities.formatDate(endTime,   tz, 'yyyy-MM-dd HH:mm'),
          daysUntil:    Math.max(0, daysUntil),
          isAllDay:     event.isAllDayEvent(),
          location:     event.getLocation() || '',
          description:  description,
          calendarName: calendar.getName(),
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
