// ============================================================
// Features.js — System › Settings › Feature Flags, Config and Feature map (#254)
//
// ONE LIST drives all three. Each feature names:
//   · its switch: the Config row <key>_enabled (missing = on), and <key>_paused_until for "off until…";
//   · what it needs (another feature), the nightly/morning steps it owns, the scheduled handlers it owns,
//     the notification kinds that belong to it, and the dashboard screens it shows;
//   · its own settings (cadence, thresholds, caps): Config rows shown on its row instead of on Config.
//
// OFF MEANS OFF EVERYWHERE, from this one list, without touching each feature's code:
//   · nightlyStep_ skips a step whose feature is off (featureOffStep_), and says so;
//   · notifDeliveryFrom_ answers 'off' for a notification whose feature is off (featureOffForNotif_),
//     so its Settings › Notifications row reads Off and comes back as it was when the feature does;
//   · the scheduled handlers it owns return early (featureOn_ at their top);
//   · /status lists the screens to hide (featureHiddenScreens_), and the dashboard leaves them out.
// "Off until" writes <key>_enabled = FALSE plus the date, so code that reads the switch directly
// sees Off too; the hourly check turns it back on when the date comes (featureResumePaused_).
// ============================================================

/** k, name, emoji, area, kind, description, touches, who sees it (sees|hidden|owner|na), needs,
 *  steps (nightlyStep_ names), jobs (scheduled handlers), notif (NOTIF_REGISTRY keys), screens
 *  (dashboard nav ids: a main tab, or <menu>/<subtab>), risky (said before turning it off), cfg. */
// Picker choices for schedules: a weekday, an hour, a day of the month, minutes between runs.
var SCHED_WEEKDAY_O_ = [['0', 'Sunday'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']];
var SCHED_HOUR_O_ = (function() { var o = []; for (var h = 0; h < 24; h++) o.push([String(h), h === 0 ? '12 am' : h < 12 ? h + ' am' : h === 12 ? '12 pm' : (h - 12) + ' pm']); return o; })();
var SCHED_DOM_O_ = (function() { var o = []; for (var d = 1; d <= 28; d++) o.push([String(d), d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th')]); return o; })();
var SCHED_DEC_O_ = (function() { var o = []; for (var d = 1; d <= 31; d++) o.push([String(d), 'Dec ' + d]); return o; })();
var SCHED_MIN_O_ = [['5', 'every 5 minutes'], ['10', 'every 10 minutes'], ['15', 'every 15 minutes'], ['30', 'every 30 minutes']];
function schedOpt_(c, l, kind, def, u) { return { c: c, l: l, type: 'select', sched: kind, def: def, u: u || '', o: kind === 'weekday' ? SCHED_WEEKDAY_O_ : kind === 'hour' ? SCHED_HOUR_O_ : kind === 'dom' ? SCHED_DOM_O_ : kind === 'dec' ? SCHED_DEC_O_ : SCHED_MIN_O_ }; }
// Changing one of these rebuilds that trigger (Code.js rebuildTrigger_).
var SCHED_TRIGGER_KEYS_ = { nightly_run_hour: ['nightlyRun', 'nightlyRunTail'], morning_nudge_time: ['morningNudge'], usps_scan_hour: ['scanUSPSMail_'],
  hoa_scan_day: ['scanHoaWebsite_'], hoa_scan_hour: ['scanHoaWebsite_'], email_parser_minutes: ['runEmailScan_'], flight_status_trigger_minutes: ['checkFlightStatuses_'] };

var FEATURES_ = [
  // Always on: when they run is all there is to set.
  { k: 'nightly_run', n: 'Nightly run', e: '🌙', a: 'System', kind: 'Housekeeping', d: 'Collects the day, writes flags, and tidies up. The second half runs an hour later.', t: ['Nightly'], v: 'na', fixed: true,
    jobs: ['nightlyRun', 'nightlyRunTail'], cfg: [schedOpt_('nightly_run_hour', 'Starts at', 'hour', '23', 'the second half an hour later')] },
  { k: 'morning_email', n: 'Morning email', e: '☀️', a: 'System', kind: 'Emails & briefings', d: 'The daily briefing email.', t: ['Morning email', 'Email'], v: 'na', fixed: true,
    jobs: ['morningNudge'], cfg: [schedOpt_('morning_nudge_time', 'Sent at', 'hour', '7')] },
  // Travel
  { k: 'pretrip_briefing', n: 'Pre-trip briefing', e: '✈️', a: 'Travel', kind: 'Emails & briefings', d: 'An email before you leave: weather, documents, what’s booked.', t: ['Nightly step', 'Email'], v: 'na',
    steps: ['checkPreTripBriefings_'], notif: ['pretrip_briefing', 'packing_reminder'], cfg: [{ c: 'pretrip_briefing_hours', l: 'Send it', type: 'num', def: '48', u: 'hours before departure' }] },
  { k: 'travel_day_briefing', n: 'Travel Day email', e: '🧳', a: 'Travel', kind: 'Emails & briefings', d: 'The morning-of email with flights, leave-by time and gate changes.', t: ['Morning email', 'Email'], v: 'sees',
    notif: ['travel_day_briefing', 'leave_home'] },
  { k: 'sleep_tz_advisor', n: 'Sleep & time-zone tips', e: '🌙', a: 'Travel', kind: 'Emails & briefings', d: 'Jet-lag tips inside the Travel Day email.', t: ['Email'], v: 'na', needs: 'travel_day_briefing' },
  { k: 'posttrip_capture', n: 'Post-trip capture', e: '🗺️', a: 'Travel', kind: 'Emails & briefings', d: 'The day after a trip: a debrief nudge, then a recap email.', t: ['Nightly step', 'Email', 'Flag'], v: 'na',
    steps: ['checkPostTripCapture_'], cfg: [{ c: 'posttrip_capture_delay_days', l: 'Debrief nudge', type: 'num', def: '1', u: 'days after you’re home' }, { c: 'posttrip_recap_delay_days', l: 'Recap email', type: 'num', def: '2', u: 'days after you’re home' }] },
  { k: 'places_autovisit', n: 'Places: add visited countries', e: '🌍', a: 'Travel', kind: 'Background checks', d: 'When a trip ends, its countries are added to Countries › Visited.', t: ['Nightly step', 'Countries tab'], v: 'sees',
    steps: ['plCloseEndedTrips_'] },
  { k: 'flight_status', n: 'Flight status checks', e: '🛫', a: 'Travel', kind: 'Background checks', d: 'On travel days: delays, gate changes, cancellations.', t: ['Every 15 min', 'Slack'], v: 'na',
    jobs: ['checkFlightStatuses_'], risky: 'You won’t hear about delays or gate changes on a travel day.', cfg: [schedOpt_('flight_status_trigger_minutes', 'Runs', 'minutes', '15'), { c: 'flight_status_poll_minutes', l: 'Re-check a flight after', type: 'num', def: '15', u: 'minutes' }] },
  // Health
  { k: 'fitness', n: 'Fitness', e: '💪', a: 'Health', kind: 'Screens', d: 'The Fitness screen, weekly target and the slow-week flag.', t: ['Screen', 'Nightly step', 'Flag'], v: 'hidden',
    steps: ['checkFitnessConsistency_', 'checkFitnessTravelGap_'], screens: ['health/fitness'], notif: ['health_performance_insight'],
    cfg: [{ c: 'fitness_weekly_target', l: 'Weekly target', type: 'num', def: '4', u: 'workouts' }, schedOpt_('fitness_low_flag_day', 'Flag a slow week on', 'weekday', '4'), schedOpt_('health_insight_day', 'Monthly health insight on the', 'dom', '1')] },
  { k: 'gym_tracker', n: 'Gym check-ins', e: '🏋️', a: 'Health', kind: 'Background checks', d: 'After a calendar workout ends, VERA asks “Did you go?”.', t: ['Hourly', 'Slack'], v: 'na', needs: 'fitness',
    steps: ['checkGymSessions_'], notif: ['gym_checkin'], cfg: [{ c: 'gym_tracker_lookback_hours', l: 'Look back', type: 'num', def: '48', u: 'hours' }, { c: 'gym_checkin_hours', l: 'Ask between', type: 'text', def: '18-23', u: '24 h, e.g. 18-23' }] },
  { k: 'morning_routine', n: 'Morning Routine', e: '☀️', a: 'Health', kind: 'Screens', d: 'Weekday and weekend checklists that reset each night.', t: ['Screen', 'Nightly step'], v: 'sees',
    steps: ['morningRoutineReset'], screens: ['health/morning_routine'] },
  { k: 'wellness_log', n: 'Wellness log', e: '🫀', a: 'Health', kind: 'Background checks', d: 'Keeps sleep and energy from the morning check-in.', t: ['Sheet', 'Slack'], v: 'na' },
  { k: 'reminders', n: 'Movement & check-in nudges', e: '🚶', a: 'Health', kind: 'Background checks', d: 'Stand-up and water nudges on workdays, the morning and evening check-ins.', t: ['Hourly', 'Every 15 min', 'Slack'], v: 'na',
    notif: ['movement', 'morning_checkin', 'evening_mobility'],
    cfg: [{ c: 'movement_times', l: 'Movement nudges at', type: 'text', def: '10:30, 13:30, 15:30' }, { c: 'movement_daily_cap', l: 'At most', type: 'num', def: '3', u: 'a day' }, { c: 'morning_checkin_time', l: 'Morning check-in', type: 'time', def: '06:30' }, { c: 'evening_checkin_time', l: 'Evening check-in', type: 'time', def: '20:00' }] },
  { k: 'rx_refills', n: 'Prescription refills', e: '💊', a: 'Health', kind: 'Background checks', d: 'A flag before a refill is due.', t: ['Nightly step', 'Flag'], v: 'sees', steps: ['checkRefills_'] },
  // Home & food
  { k: 'pantry', n: 'Pantry', e: '📦', a: 'Home & food', kind: 'Screens', d: 'Stock levels, use rates and restock flags.', t: ['Screen', 'Nightly step', 'Flag'], v: 'sees',
    steps: ['autoRestockItems_', 'generatePantryFlags_'], cfg: [{ c: 'pantry_restock_days_ahead', l: 'Warn', type: 'num', def: '7', u: 'days before something runs out' }] },
  { k: 'takeouts', n: 'Takeouts', e: '🥡', a: 'Home & food', kind: 'Screens', d: 'Takeout log and favourites.', t: ['Screen'], v: 'sees' },
  { k: 'home_upkeep', n: 'Home upkeep reminders', e: '🛠️', a: 'Home & food', kind: 'Background checks', d: 'Filters, gutters and service visits coming due.', t: ['Nightly step', 'Flag', 'Slack'], v: 'sees',
    steps: ['checkHomeServiceOverdue_', 'hfSyncUpkeepReminders_'], notif: ['home_service'] },
  { k: 'coupons', n: 'Coupons', e: '🎟️', a: 'Home & food', kind: 'Background checks', d: 'Expiring coupons, scratched off, then removed.', t: ['Nightly step', 'Slack'], v: 'sees',
    steps: ['checkExpiringCoupons_', 'purgeExpiredCoupons_'], notif: ['coupon_expiry'] },
  { k: 'usps_scan', n: 'USPS mail scan', e: '📬', a: 'Home & food', kind: 'Background checks', d: 'Reads Informed Delivery emails for today’s mail and packages.', t: ['Daily', 'Email inbox'], v: 'na',
    jobs: ['scanUSPSMail_'], notif: ['usps_mail'], cfg: [schedOpt_('usps_scan_hour', 'Scans at', 'hour', '10')] },
  { k: 'hoa_watch', n: 'HOA website watch', e: '🏘️', a: 'Home & food', kind: 'Background checks', d: 'Checks the HOA site for new notices.', t: ['Weekly', 'Slack'], v: 'sees', jobs: ['scanHoaWebsite_'],
    cfg: [schedOpt_('hoa_scan_day', 'Checks on', 'weekday', '1'), schedOpt_('hoa_scan_hour', 'At', 'hour', '9')] },
  // Money
  { k: 'financial_scenarios', n: 'Financial scenarios', e: '🧮', a: 'Money', kind: 'Screens', d: 'The what-if planner on the Money screen.', t: ['Screen'], v: 'hidden' },
  { k: 'loyalty_programs', n: 'Loyalty programs', e: '🎫', a: 'Money', kind: 'Screens', d: 'Points and status across airlines and hotels.', t: ['Screen'], v: 'hidden' },
  { k: 'monthly_review', n: 'Monthly life review', e: '📊', a: 'Money', kind: 'Emails & briefings', d: 'A review email at the start of each month.', t: ['Nightly step', 'Email'], v: 'na',
    steps: ['checkMonthlyReview_'], notif: ['monthly_review'], cfg: [schedOpt_('finance_review_day', 'Sent on the', 'dom', '1', 'of each month')] },
  { k: 'card_hub', n: 'Card perks', e: '💳', a: 'Money', kind: 'Background checks', d: 'Credits about to expire, and perks worth using this month.', t: ['Nightly step', 'Flag'], v: 'hidden',
    steps: ['closeExpiredPerkFlags_', 'checkCardPerksExpiring_', 'checkCardPerksActive_', 'seedPerkUses_', 'checkCardHub_', 'purgePastPerkReminderEvents_'],
    cfg: [schedOpt_('card_perks_review_day', 'Monthly perk review on the', 'dom', '1')] },
  { k: 'tax_docs', n: 'Tax documents', e: '🧾', a: 'Money', kind: 'Background checks', d: 'Tracks forms as they arrive and flags one that’s late.', t: ['Nightly step', 'Flag'], v: 'hidden', steps: ['checkTaxDocuments_', 'checkTaxLate_'] },
  // People & gifts
  { k: 'important_dates', n: 'Important dates', e: '🎂', a: 'People & gifts', kind: 'Background checks', d: 'Birthdays and anniversaries, synced with the calendar, with reminders.', t: ['Nightly step', 'Flag', 'Calendar'], v: 'sees',
    steps: ['syncCalendarBirthdaysToImportantDates_', 'syncImportantDatesToCalendar_', 'checkImportantDates_', 'checkNoGiftIdea_'],
    cfg: [{ c: 'dates_default_lead_time', l: 'Start reminding', type: 'num', def: '30', u: 'days before' }, { c: 'dates_medium_urgency_days', l: 'Medium from', type: 'num', def: '7', u: 'days before' }, { c: 'dates_high_urgency_days', l: 'High from', type: 'num', def: '1', u: 'day before' }] },
  { k: 'wish_list', n: 'Wish List', e: '🛍', a: 'People & gifts', kind: 'Screens', d: 'Your own wish list screen.', t: ['Screen'], v: 'sees' },
  { k: 'wishlists', n: 'Family wish lists', e: '🎄', a: 'People & gifts', kind: 'Screens', d: 'Reads each family member’s wish list sheet.', t: ['Screen', 'Sheets'], v: 'sees', steps: ['checkWishListGifts_'], screens: ['people/wishlists'],
    cfg: [schedOpt_('wishlist_wrap_day', '“Not wrapped yet” from', 'dec', '20'), schedOpt_('wishlist_flags_until', 'Gift flags until', 'dec', '25')] },
  { k: 'notes', n: 'Notes', e: '🗒️', a: 'People & gifts', kind: 'Screens', d: 'Private quick capture, tags and the Vault.', t: ['Screen', 'Jot tile'], v: 'owner', screens: ['life/notes'],
    risky: 'Your notes stay saved; only the screen and the Jot tile go away.' },
  // Work & career
  { k: 'career', n: 'Career', e: '🧭', a: 'Work & career', kind: 'Screens', d: 'North Star, evidence, pipeline and the monthly wins bank.', t: ['Screen', 'Nightly step', 'Flag'], v: 'hidden',
    steps: ['carCredNightly_', 'carNightly_', 'carCheckAgentHealth_', 'carMonthlyWinsBank_', 'carSuggestCriteria_', 'carCareerFlags_'], notif: ['career_cert_expiry'], screens: ['career'] },
  { k: 'pto_planner', n: 'PTO planner', e: '🏖️', a: 'Work & career', kind: 'Screens', d: 'Next year’s PTO plan, and the yearly rollover.', t: ['Screen', 'Nightly step'], v: 'sees',
    steps: ['checkPTOYearRollover_', 'checkPTOStrategy_', 'writePTOSnapshot_'], notif: ['pto_strategy'], screens: ['pto'],
    cfg: [schedOpt_('pto_accrual_day', 'Vacation accrues on the', 'dom', '16', 'of each month')] },
  { k: 'day_sequencing', n: 'Day sequencing', e: '📆', a: 'Work & career', kind: 'Emails & briefings', d: '“Your day, sequenced” in the morning email.', t: ['Morning email'], v: 'na' },
  { k: 'google_tasks', n: 'Google Tasks', e: '✅', a: 'Work & career', kind: 'Screens', d: 'Shows Google Tasks next to VERA’s.', t: ['Screen', 'Morning email'], v: 'na', steps: ['webGetGoogleTasks_'] },
  // Daily life
  { k: 'weekend_planner', n: 'Weekend planner', e: '📅', a: 'Daily life', kind: 'Emails & briefings', d: 'A weekend memo email with ideas around your calendar.', t: ['Email', 'Weekly'], v: 'na', notif: ['weekend_memo'],
    cfg: [schedOpt_('weekend_planner_day', 'Sent on', 'weekday', '3'), schedOpt_('weekend_planner_hour', 'At', 'hour', '8'), { c: 'weekend_planner_lookahead_days', l: 'Look ahead', type: 'num', def: '30', u: 'days' }] },
  { k: 'explorer', n: 'Daily discovery', e: '🔍', a: 'Daily life', kind: 'Emails & briefings', d: 'One curated pick a day from your interests.', t: ['Nightly step', 'Slack'], v: 'na', steps: ['runExplorer_'], notif: ['daily_discovery'],
    cfg: [{ c: 'explorer_interests', l: 'Interests', type: 'text', def: '', u: 'blank = from your interests' }] },
  { k: 'weekly_trend_review', n: 'Weekly trend review', e: '📈', a: 'Daily life', kind: 'Emails & briefings', d: 'A Sunday digest of how the week went.', t: ['Email'], v: 'na', steps: ['sendWeeklyTrendReview_'], notif: ['weekly_trend_review'],
    cfg: [schedOpt_('memory_snapshot_day', 'Sent on', 'weekday', '0', 'with that night’s weekly snapshot')] },
  { k: 'pacing', n: 'Easy mode', e: '🧘', a: 'Daily life', kind: 'Background checks', d: 'Holds back minor flags when you’re overloaded.', t: ['Nightly step'], v: 'na',
    cfg: [{ c: 'pacing_flag_threshold', l: 'Turn on after', type: 'num', def: '3', u: 'High flags in a night' }, { c: 'pacing_mode_days', l: 'Lasts', type: 'num', def: '7', u: 'days' }] },
  { k: 'away_mode', n: 'Away mode', e: '🏝️', a: 'Daily life', kind: 'Background checks', d: 'Holds non-urgent notifications while you travel, then a catch-up.', t: ['Hourly', 'Slack'], v: 'na' },
  { k: 'goal_checkin', n: 'Goal check-in', e: '🎯', a: 'Daily life', kind: 'Background checks', d: 'Once a week, a nudge about goals that have been Doing since an earlier month.', t: ['Hourly', 'Slack'], v: 'na',
    notif: ['goal_checkin'], cfg: [schedOpt_('goal_checkin_day', 'On', 'weekday', '1'), schedOpt_('goal_checkin_hour', 'At', 'hour', '8')] },
  { k: 'chores', n: 'Chores reset', e: '🧹', a: 'Home & food', kind: 'Background checks', d: 'Clears done chores so they come back: daily ones each night, weekly ones on their day.', t: ['Nightly step'], v: 'sees',
    steps: ['resetChoresByCadence_'], cfg: [schedOpt_('chores_reset_day', 'Weekly chores reset on', 'weekday', '5', 'every other week for biweekly ones')] },
  { k: 'experiments', n: 'Experiments', e: '🧪', a: 'Daily life', kind: 'Screens', d: 'Personal experiments and their check-ins.', t: ['Screen'], v: 'hidden' },
  // Assistants
  { k: 'aria_sync', n: 'ARIA travel watch', e: '🧭', a: 'Assistants', kind: 'Assistants', d: 'Reads ARIA’s tracker: Book now, and price drops after booking.', t: ['Hourly', 'Slack', 'ARIA sheet'], v: 'na',
    notif: ['aria_book_now', 'aria_price_drop'], cfg: [{ c: 'act_now_cap_aria', l: 'Act-now posts', type: 'num', def: '3', u: 'a day at most' }, { c: 'aria_rebook_min_saving', l: 'Price drop worth posting', type: 'num', def: '50', u: '$ a person' }] },
  { k: 'hailey_read', n: 'HAILEY home search', e: '🏡', a: 'Assistants', kind: 'Assistants', d: 'Standout listings and homes going off the market.', t: ['Hourly', 'Slack', 'HAILEY sheet'], v: 'na',
    notif: ['act_now_hailey', 'hailey_follow_up'], cfg: [{ c: 'act_now_cap_hailey', l: 'Act-now posts', type: 'num', def: '3', u: 'a day at most' }] },
  { k: 'tess_read', n: 'TESS job search', e: '💼', a: 'Assistants', kind: 'Assistants', d: 'Strong new matches, closing dates and application updates.', t: ['Hourly', 'Slack', 'TESS sheet'], v: 'owner',
    notif: ['act_now_tess', 'tess_follow_up'], cfg: [{ c: 'act_now_cap_tess', l: 'Act-now posts', type: 'num', def: '3', u: 'a day at most' }, { c: 'act_now_tess_min_score', l: 'Strong match from score', type: 'num', def: '85', u: 'of 100' }] },
  { k: 'willa_read', n: 'WILLA money planner', e: '💰', a: 'Assistants', kind: 'Assistants', d: 'CDs maturing and this month’s planned spending.', t: ['Hourly', 'Slack', 'WILLA sheet'], v: 'owner',
    steps: ['checkPlannerCdMaturity_'], notif: ['act_now_willa'], cfg: [{ c: 'act_now_cap_willa', l: 'Act-now posts', type: 'num', def: '2', u: 'a day at most' }] },
  { k: 'agent_health', n: 'Agent health', e: '🤖', a: 'Assistants', kind: 'Background checks', d: 'Notices when an assistant is late or failed.', t: ['Nightly step', 'Flag', 'Slack'], v: 'na',
    steps: ['checkAgentHealth_'], notif: ['agent_down_aria', 'agent_down_tess', 'agent_down_hailey'], risky: 'If ARIA, TESS or HAILEY stops running, nothing will tell you.' },
  // System
  { k: 'email_parser', n: 'Email parsing', e: '📧', a: 'System', kind: 'Background checks', d: 'Reads booking and receipt emails into VERA.', t: ['Every 30 min', 'Email inbox'], v: 'na', jobs: ['runEmailScan_'], cfg: [schedOpt_('email_parser_minutes', 'Checks', 'minutes', '30')] },
  { k: 'email_admin', n: 'Inbox admin', e: '📬', a: 'System', kind: 'Background checks', d: 'Follow-ups and clean-up suggestions.', t: ['Weekly', 'Slack'], v: 'na',
    cfg: [{ c: 'email_admin_frequency', l: 'Run', type: 'select', def: 'weekly', o: [['weekly', 'Weekly'], ['3days', 'Every 3 days']] }, schedOpt_('email_admin_day', 'Weekly on', 'weekday', '0')] },
  { k: 'memory_log', n: 'Memory log', e: '🧠', a: 'System', kind: 'Housekeeping', d: 'What VERA noticed over time; chat and reviews read it.', t: ['Sheet'], v: 'na', steps: ['pruneMemoryLog_'],
    risky: 'Chat and the monthly review lose their history from now on (nothing already saved is deleted).', cfg: [{ c: 'memory_log_retention_months', l: 'Keep', type: 'num', def: '12', u: 'months' }] },
  { k: 'run_log', n: 'Run log', e: '🗒️', a: 'System', kind: 'Housekeeping', d: 'A row for every scheduled run in VERA-Logs.', t: ['Sheet', 'Every run'], v: 'na',
    risky: 'If the nightly run dies, nothing will say where.', cfg: [{ c: 'run_log_keep_days', l: 'Keep', type: 'num', def: '30', u: 'days' }] },
];
var FEATURE_AREAS_ = ['Travel', 'Health', 'Home & food', 'Money', 'People & gifts', 'Work & career', 'Daily life', 'Assistants', 'System'];
var FEATURE_KINDS_ = ['Screens', 'Emails & briefings', 'Background checks', 'Assistants', 'Housekeeping'];

// Config rows VERA no longer reads. purgeRetiredConfig_ deletes them (nightly housekeeping).
var CONFIG_RETIRED_KEYS_ = ['travel_companions'];
var CONFIG_RETIRED_PATTERNS_ = [/^notif_(water_break|desk_break|calendar_opportunity)_/];

function featureByKey_(k) { for (var i = 0; i < FEATURES_.length; i++) if (FEATURES_[i].k === k) return FEATURES_[i]; return null; }
function featureIsoToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/**
 * Pure: a feature's state from Config values. → 'on' | 'off' | 'paused' | 'blocked'
 * Missing = on. FALSE with a future <key>_paused_until = paused (comes back that day). A feature
 * whose needed feature isn't on is blocked: its own switch is kept, so it returns with the other.
 */
function featureStateFrom_(k, cfg, today, seen) {
  cfg = cfg || {};
  var f = featureByKey_(k);
  if (!f) return 'on';
  seen = seen || {};
  if (seen[k]) return 'on';   // a loop in needs must never hang
  seen[k] = true;
  if (f.fixed) return 'on';   // always on: only its schedule can change
  var raw = String(cfg[k + '_enabled'] == null ? '' : cfg[k + '_enabled']).trim().toUpperCase();
  var until = String(cfg[k + '_paused_until'] || '').trim();
  var own = 'on';
  if (raw === 'FALSE') own = /^\d{4}-\d{2}-\d{2}$/.test(until) ? (until > today ? 'paused' : 'on') : 'off';
  if (own !== 'on') return own;
  if (f.needs && featureStateFrom_(f.needs, cfg, today, seen) !== 'on') return 'blocked';
  return 'on';
}

var _featCfg_ = null;   // this execution's Config, read once
function featureCfg_() { if (!_featCfg_) { try { _featCfg_ = getConfigValues() || {}; } catch (e) { _featCfg_ = {}; } } return _featCfg_; }
/** Is this feature on right now? Unknown keys are on. Never throws. */
function featureOn_(k) {
  try { return featureStateFrom_(k, featureCfg_(), featureIsoToday_()) === 'on'; } catch (e) { return true; }
}

/** Pure: {step name: feature key}, {notification key: feature key}. */
function featureStepMap_() { var m = {}; FEATURES_.forEach(function(f) { (f.steps || []).forEach(function(s) { m[s] = f.k; }); }); return m; }
function featureNotifMap_() { var m = {}; FEATURES_.forEach(function(f) { (f.notif || []).forEach(function(n) { m[n] = f.k; }); }); return m; }

/** The feature that switches this nightly/morning step off, or '' when it should run. Never throws. */
function featureOffStep_(stepName) {
  try { var k = featureStepMap_()[stepName]; return k && !featureOn_(k) ? k : ''; } catch (e) { return ''; }
}
/** Pure: the feature that switches this notification off ('' when none), from Config values. */
function featureOffForNotif_(notifKey, cfg, today) {
  var k = featureNotifMap_()[notifKey];
  if (!k) return '';
  return featureStateFrom_(k, cfg, today || featureIsoToday_()) === 'on' ? '' : k;
}
/** Pure: the dashboard screens to hide, from Config values. */
function featureHiddenScreens_(cfg, today) {
  var out = [];
  FEATURES_.forEach(function(f) { if ((f.screens || []).length && featureStateFrom_(f.k, cfg, today) !== 'on') out = out.concat(f.screens); });
  return out;
}

/** Pure: the features that need k (directly). */
function featureDependents_(k) { return FEATURES_.filter(function(f) { return f.needs === k; }).map(function(f) { return f.k; }); }

/** Hourly: a pause whose date has come turns the switch back on. → keys resumed */
function featureResumePaused_() {
  var cfg = featureCfg_(), today = featureIsoToday_(), done = [];
  FEATURES_.forEach(function(f) {
    var until = String(cfg[f.k + '_paused_until'] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until > today) return;
    try { setConfigRow_(f.k + '_enabled', 'TRUE'); setConfigRow_(f.k + '_paused_until', ''); done.push(f.k); } catch (e) { Logger.log('featureResumePaused_: ' + e.message); }
  });
  if (done.length) _featCfg_ = null;
  return done;
}

// ---- last activity -----------------------------------------------------------------------
/** End of a run: when each step last ran, for "last ran …" on its feature. Never throws. */
function featureNoteSteps_(timings) {
  try {
    if (!timings || !timings.length) return;
    var map = {};
    try { map = JSON.parse(veraStateGet_('STEPS').STEPS_LAST || '{}') || {}; } catch (e) { map = {}; }
    var now = Math.round(Date.now() / 1000), known = featureStepMap_();
    timings.forEach(function(t) { if (t && known[t.name]) map[t.name] = now; });
    veraStateSet_('STEPS', { STEPS_LAST: JSON.stringify(map) });
  } catch (e) { Logger.log('featureNoteSteps_ (non-fatal): ' + e.message); }
}
/** Pure: the latest of a feature's step runs and job heartbeats, as epoch ms (0 when none). */
function featureLastMs_(f, stepsLast, beats) {
  var best = 0;
  (f.steps || []).forEach(function(s) { var v = +((stepsLast || {})[s] || 0) * 1000; if (v > best) best = v; });
  (f.jobs || []).forEach(function(j) { var b = (beats || {})[j], v = b && b.lastRun ? new Date(b.lastRun).getTime() : 0; if (v > best) best = v; });
  return best;
}

// ---- routes ------------------------------------------------------------------------------
/** GET feature_flags (owner only) → {features:[…with state, until, last, settings], areas, kinds} */
function webFeatureFlags_() {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  try { featureResumePaused_(); } catch (e) {}
  _featCfg_ = null;
  var cfg = featureCfg_(), today = featureIsoToday_();
  var stepsLast = {}, beats = {};
  try { stepsLast = JSON.parse(veraStateGet_('STEPS').STEPS_LAST || '{}') || {}; } catch (e) {}
  try { beats = getHeartbeatState_() || {}; } catch (e) {}
  var nm = {}; try { NOTIF_REGISTRY.forEach(function(n) { nm[n.key] = n.label; }); } catch (e) {}
  var features = FEATURES_.map(function(f) {
    var state = featureStateFrom_(f.k, cfg, today), last = featureLastMs_(f, stepsLast, beats);
    return { k: f.k, n: f.n, e: f.e, a: f.a, kind: f.kind, d: f.d, t: f.t, v: f.v, needs: f.needs || '', risky: f.risky || '', fixed: !!f.fixed, when: featureWhen_(f, cfg),
      state: state, until: state === 'paused' ? String(cfg[f.k + '_paused_until']) : '', last: last ? new Date(last).toISOString() : '',
      own: String(cfg[f.k + '_enabled'] == null ? '' : cfg[f.k + '_enabled']).trim().toUpperCase() === 'FALSE' ? 'off' : 'on',
      known: cfg[f.k + '_enabled'] != null, screens: f.screens || [], steps: f.steps || [], jobs: f.jobs || [],
      notif: (f.notif || []).map(function(n) { return { key: n, label: nm[n] || n }; }),
      cfg: (f.cfg || []).map(function(x) { return { c: x.c, l: x.l, type: x.type, u: x.u || '', o: x.o || null, v: cfg[x.c] != null && cfg[x.c] !== '' ? String(cfg[x.c]) : x.def, isDefault: cfg[x.c] == null || cfg[x.c] === '' }; }) };
  });
  return { ok: true, features: features, areas: FEATURE_AREAS_, kinds: FEATURE_KINDS_, today: today };
}

/** POST set_feature {key, state: on|off|paused, until} (owner only). */
function webSetFeature_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {}, k = String(b.key || '').trim(), state = String(b.state || '').trim().toLowerCase(), until = String(b.until || '').trim();
  var f = featureByKey_(k);
  if (!f) return { ok: false, error: 'No feature called ' + k + '.' };
  if (f.fixed) return { ok: false, error: f.n + ' is always on; only when it runs can change.' };
  if (['on', 'off', 'paused'].indexOf(state) === -1) return { ok: false, error: 'state must be on, off or paused' };
  var today = featureIsoToday_();
  if (state === 'paused' && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today)) return { ok: false, error: 'Pick a date after today to turn it back on.' };
  setConfigRow_(k + '_enabled', state === 'on' ? 'TRUE' : 'FALSE');
  setConfigRow_(k + '_paused_until', state === 'paused' ? until : '');
  _featCfg_ = null;
  var cfg = featureCfg_();
  return { ok: true, key: k, state: featureStateFrom_(k, cfg, today), until: state === 'paused' ? until : '',
    dependents: featureDependents_(k).map(function(d) { return { k: d, state: featureStateFrom_(d, cfg, today) }; }) };
}

/** POST set_feature_setting {key, value} (owner only): a feature's own setting, by its Config row. */
function webSetFeatureSetting_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {}, c = String(b.key || '').trim(), v = String(b.value == null ? '' : b.value).trim();
  var x = null;
  FEATURES_.forEach(function(f) { (f.cfg || []).forEach(function(y) { if (y.c === c) x = y; }); });
  if (!x) return { ok: false, error: 'That isn’t a feature setting.' };
  if (x.type === 'num' && v !== '' && !/^\d+(\.\d+)?$/.test(v)) return { ok: false, error: 'That needs a number.' };
  if (x.type === 'time' && v !== '' && !/^\d{1,2}:\d{2}$/.test(v)) return { ok: false, error: 'That needs a time like 06:30.' };
  if (x.type === 'select' && x.o.map(function(o) { return o[0]; }).indexOf(v) === -1) return { ok: false, error: 'Pick one of the choices.' };
  if (c === 'gym_checkin_hours' && v !== '' && !gymCheckinRange_(v)) return { ok: false, error: 'Use two hours, like 18-23.' };
  setConfigRow_(c, v);
  _featCfg_ = null;
  try { _configCache_ = null; } catch (e) {}
  var rebuilt = [];
  (SCHED_TRIGGER_KEYS_[c] || []).forEach(function(handler) {
    try { if (rebuildTrigger_(handler)) rebuilt.push(handler); } catch (e) { Logger.log('webSetFeatureSetting_ rebuild ' + handler + ': ' + e.message); }
  });
  return { ok: true, key: c, value: v, rebuilt: rebuilt };
}

/** GET config_files (owner only): each linked file's name, and whether VERA can open it. */
var CONFIG_FILE_KEYS_ = ['planner_sheet_id', 'career_' + 'alert_sheet_id', 'notes_doc_id', 'run_log_sheet_id', 'vera_logo_file_id', 'sat_sheet_id',
  'transactions_sheet_id', 'shopping_list_doc_id', 'address_book_sheet_id', 'career_wins_bank_doc_id', 'phone_plan_sheet_id', 'life_plan_doc_id'];
/** Pure: the Drive id inside a link or bare id ('' when none). */
function configFileId_(v) {
  var t = String(v == null ? '' : v).trim(), m = t.match(/\/d\/([A-Za-z0-9_-]{20,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : '';
}
function webConfigFiles_() {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var cfg = featureCfg_(), out = {};
  CONFIG_FILE_KEYS_.forEach(function(k) {
    var id = configFileId_(cfg[k]);
    if (!id) { out[k] = { ok: false, name: '', why: cfg[k] ? 'Not a Drive link or ID' : 'Not set' }; return; }
    try { var f = DriveApp.getFileById(id); out[k] = { ok: true, name: f.getName(), url: f.getUrl(), updated: f.getLastUpdated().toISOString() }; }
    catch (e) { out[k] = { ok: false, name: '', why: 'VERA can’t open it (check it’s shared with the account VERA runs as)' }; }
  });
  return { ok: true, files: out };
}

/** GET config_calendars (owner only): the calendars VERA can see. */
function webConfigCalendars_() {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  try { return { ok: true, calendars: CalendarApp.getAllCalendars().map(function(c) { return c.getName(); }).sort() }; }
  catch (e) { return { ok: false, error: 'Calendars couldn’t be read: ' + e.message }; }
}

/** POST config_slack_test {key} (owner only): a test line in that channel. */
var CONFIG_SLACK_KEYS_ = ['slack_chat_channel_id', 'slack_notifications_channel_id', 'slack_act_now_channel_id', 'slack_logs_channel_id'];
function webConfigSlackTest_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var k = String((body || {}).key || '');
  if (CONFIG_SLACK_KEYS_.indexOf(k) === -1) return { ok: false, error: 'Not a Slack channel setting.' };
  var id = String(featureCfg_()[k] || '').trim();
  if (!/^[CG][A-Z0-9]{6,}$/.test(id)) return { ok: false, error: 'That channel ID doesn’t look right: it starts with C.' };
  var r = sendSlackMessage_(id, '✅ VERA test from Settings › Config');
  return r && r.ok ? { ok: true } : { ok: false, error: 'Slack said ' + ((r && r.error) || 'no') + '. Invite the VERA app to the channel.' };
}

// ---- housekeeping ------------------------------------------------------------------------
/** Pure: is this Config key retired? */
function configRetired_(key) {
  key = String(key || '').trim();
  return CONFIG_RETIRED_KEYS_.indexOf(key) !== -1 || CONFIG_RETIRED_PATTERNS_.some(function(re) { return re.test(key); });
}
/** Nightly: delete Config rows nothing reads any more, bottom-up. → count */
function purgeRetiredConfig_() {
  var sh = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sh || sh.getLastRow() < 2) return 0;
  var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), gone = 0;
  veraLocked_(function() {
    for (var i = keys.length - 1; i >= 0; i--) if (configRetired_(keys[i][0])) { sh.deleteRow(i + 2); gone++; }
  });
  if (gone) { try { _configCache_ = null; } catch (e) {} Logger.log('purgeRetiredConfig_: removed ' + gone + ' retired Config row(s)'); }
  return gone;
}

/** Pure: "18-23" → {from: 18, to: 23}, or null. */
function gymCheckinRange_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (!m) return null;
  var a = +m[1], b = +m[2];
  return a >= 0 && b <= 23 && a <= b ? { from: a, to: b } : null;
}

/** Pure: a feature's schedule in plain words, from its schedule settings ('' when it has none).
 *  "Wednesdays at 8 am" · "Daily at 10 am" · "The 1st of each month" · "Every 15 minutes". */
function featureWhen_(f, cfg) {
  cfg = cfg || {};
  var xs = (f.cfg || []).filter(function(x) { return x.sched; });
  if (!xs.length) return '';
  var val = function(x) { var raw = cfg[x.c] != null && String(cfg[x.c]).trim() !== '' ? String(parseInt(cfg[x.c], 10)) : x.def;
    return x.o.filter(function(o) { return o[0] === raw; })[0] || x.o.filter(function(o) { return o[0] === x.def; })[0]; };
  var by = {}; xs.forEach(function(x) { if (!by[x.sched]) by[x.sched] = val(x); });
  if (by.minutes) return by.minutes[1].charAt(0).toUpperCase() + by.minutes[1].slice(1);
  if (by.weekday && by.hour) return by.weekday[1] + 's at ' + by.hour[1];
  if (by.weekday) return by.weekday[1] + 's';
  if (by.hour) return 'Daily at ' + by.hour[1];
  if (by.dom) return 'The ' + by.dom[1] + ' of each month';
  if (by.dec) return 'December, until ' + val(xs[xs.length - 1])[1];
  return '';
}
