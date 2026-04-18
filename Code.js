// ============================================================
// VERA — Virtual Executive & Reminder Assistant
// Code.js — Main Entry Point
// ============================================================

// ---- CONFIG ----------------------------------------------------------------
// SHEET_ID and MORNING_NUDGE_EMAIL are loaded from Script Properties.
// CLAUDE_API_KEY is NOT stored here — it is loaded from Script Properties.
//   In Apps Script editor: Project Settings → Script Properties → Add:
//     VERA_SHEET_ID      → your Life OS Google Sheet ID
//     MORNING_NUDGE_EMAIL → your email address
// ----------------------------------------------------------------------------
const CONFIG = {
  SHEET_ID: PropertiesService.getScriptProperties().getProperty('VERA_SHEET_ID') || '',
  CALENDAR_DAYS_AHEAD: 7,
  TASK_AGE_THRESHOLD: 7,                 // Days before a task is considered neglected
  MAX_FLAGS: 8,
  MORNING_NUDGE_EMAIL: PropertiesService.getScriptProperties().getProperty('MORNING_NUDGE_EMAIL') || '',
  MORNING_NUDGE_HOUR: 7,
  NIGHTLY_RUN_HOUR: 23,
};

// Module-level cache for getConfigValues() — reset automatically per execution.
// Prevents the Config tab from being re-read on every sub-function call within
// a single nightly run (typically called 4–6 times per execution).
var _configCache_ = null;

// ---- Tab Names -------------------------------------------------------------
const TABS = {
  FLAGS:        'Flags',
  TASKS:        'Tasks',
  METRICS:      'Metrics',      // Auto-populated VERA health counts (Tasks, Calendar, Flags)
  SUMMARIES:    'Summaries',    // External life intelligence feed (Finance, Fitness, Kenz Box, etc.)
  CONFIG:       'Config',
  PROJECTS:     'Projects',     // Multi-step projects with Claude-generated subtasks
  GOALS:            'Goals',            // Yearly goals Kanban board
  PTO:              'PTO',              // PTO planner snapshot (written nightly by writePTOSnapshot_)
  PTO_MEMORY:       'PTO Memory',       // Stateful PTO suggestion history (declined windows blacklist)
  REMINDERS_MEMORY: 'Reminders Memory', // Reminders.js cooldown log (Anticipator + Explorer)
  INTEREST_LEDGER:  'Shared Interests', // Shared Interest Ledger (Issue #28)
  BILLS:            'Bills',            // Recurring bill tracker (Issue #57)
  RECIPES:          'Recipes',          // Recipe list (Issue #46)
  TAKEOUT_RESTAURANTS: 'Takeout Restaurants', // Favorite takeouts (Issue #112)
  TAKEOUT_ITEMS:       'Takeout Items',        // Takeout menu items (Issue #112)
  HOME_ITEMS:       'Home Items',       // Warranties + service log (Issue #21)
  IDEAS:            'Ideas',            // Braindump repo (Issue #18)
  ITINERARY:        'Itinerary',        // Trip itinerary items (Issue #63)
  TRIP_META:        'TripMeta',         // Trip context / sentiment notes (Issue #64)
  PACKING_ITEMS:    'PackingItems',     // Per-trip packing list items (Issue #64)
  COUNTRIES:        'Countries',        // Countries visited tracker (Issue #74)
  BUCKET_LIST:      'Bucket List',      // Travel bucket list (wishlist of destinations)
  TRIP_RECOMMENDATIONS: 'TripRecommendations', // AI-generated trip activity/dining recommendations (Issue #73)
  PROCESSED_EMAILS:     'Processed Emails',     // Email parser dedup + outcome log (Issue #98)
  MORNING_ROUTINE:      'Morning Routine',       // Daily routine checklist — sheet-backed, nightly reset
  GYM_LOG:             'Gym Log',              // Gym session attendance log (Issue #97)
  PURCHASE_HISTORY:    'Purchase History',     // Purchase history + consumption intelligence (Issue #111)
  CAREER_POSITION:    'Career Position',      // Current role snapshot (Career tab)
  CAREER_GOALS:       'Career Goals',         // Long-horizon career targets (Career tab)
  CAREER_PROGRESSION: 'Career Progression',   // Career timeline / roles held (Career tab)
  CAREER_DEVELOPMENT: 'Career Development',   // Skills, courses, focus areas (Career tab)
  CAREER_WINS:        'Career Wins',          // Achievement log (Career tab)
  CAREER_NETWORK:     'Career Network',       // Professional relationships (Career tab)
  PRESCRIPTIONS:      'Prescriptions',        // Medication tracker for Ahmed + Victoria (Issue #116)
  CREDIT_CARDS:       'Credit Cards',         // Card metadata + ownership (Issues #115/#117)
  CARD_REWARDS:       'Card Rewards',         // Per-card category reward rates
  CARD_PERKS:         'Card Perks',           // Monthly/annual perk tracker
  LOYALTY_PROGRAMS:   'Loyalty Programs',     // Points/miles balances (Issue #117)
  REWARDS_GOALS:      'Rewards Goals',        // Redemption goal tracking
  GIFT_PEOPLE:        'Gift People',          // Per-person gift idea lists (Issue #105)
  GIFT_IDEAS:         'Gift Ideas',           // Individual gift ideas linked to people (Issue #105)
  IMPORTANT_DATES:    'Important Dates',      // Birthdays, anniversaries, meaningful dates (Issue #80)
  CHORES:             'Chores',              // Household chore checklist by cadence (Issue #124)
  TRAVELER_PROFILES:  'Traveler Profiles',   // Passport + traveler profiles for visa checking (Issue #123)
  CONTRACTS:          'Contracts',            // Active contract & agreement tracker (Issue #146)
  VEHICLES:           'Vehicles',             // Vehicle tracker — oil, service, registration (Issue #125)
  FINANCIAL_GOALS:    'Financial Goals',      // Financial goals + what-if scenarios (Issue #127)
  TAX_DOCUMENTS:      'Tax Documents',        // Tax document checklist (Issue #166)
  FINANCIAL_SCENARIOS:'Financial Scenarios',  // Saved what-if scenarios per goal (Issue #127)
  EMAIL_FOLLOW_UPS:   'Email Follow-ups',     // Email Admin follow-up tracking (Issue #144)
  BOOKS:               'Books',               // Reading list (Issue #88)
  COURSES:             'Courses',             // Courses & learning content (Issue #88)
  SKILLS:              'Skills',              // Skill building + practice log (Issue #88)
  EXPERIMENTS:         'Experiments',         // Personal experiment tracker (Issue #130)
  EXPERIMENT_CHECKINS: 'Experiment Checkins', // Per-experiment check-in log (Issue #130)
  RESOURCES:           'Resources',            // Reference links + docs (Explore tab)
  BUCKET_ACTIVITIES:   'BucketActivities',     // Per-destination activity list (Issue #113)
  WISH_LIST:           'Wish List',            // Aspirational purchase tracker (Issue #131)
  MEAL_PLAN:           'Meal Plan',            // Weekly dinner planner (Issue #122)
  // HEALTH_APPOINTMENTS tab removed (Issue #85): appointments read from Google Calendar (DR: prefix)
  TRIP_BUDGET:        'Trip Budget',         // Per-trip budget line items (Issue #96)
  RESELL_LIST:        'Resell List',          // Items to sell tracker (Issue #170)
};

// ---- Column Headers --------------------------------------------------------
const FLAG_HEADERS        = ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated'];
const PROJECT_HEADERS     = ['Project ID', 'Project Name', 'Task', 'Status', 'Priority', 'Due Date', 'Notes'];
const TASK_HEADERS        = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged'];
const METRIC_HEADERS      = ['Source', 'Metric', 'Value', 'As Of'];  // Metrics tab
const SUMMARY_HEADERS     = ['Source', 'Metric', 'Value', 'As Of'];  // Summaries tab
const CONFIG_HEADERS      = ['Setting', 'Value'];
const GOAL_HEADERS        = ['ID', 'Title', 'Description', 'Status', 'Category', 'Year', 'Progress', 'Notes'];
const PTO_HEADERS         = ['Type', 'Label', 'Start Date', 'End Date', 'Weekdays', 'Hours', 'Status'];
const BILL_HEADERS        = ['Bill', 'Amount', 'Due Day', 'Frequency', 'Category', 'Account', 'Paid', 'Notes', 'Type'];
const PTO_MEMORY_HEADERS      = ['Start Date', 'End Date', 'Workdays', 'GCal Event ID', 'Status', 'Suggested On'];
const REMINDERS_MEMORY_HEADERS  = ['Rule Key', 'Sent At', 'Message'];
const INTEREST_LEDGER_HEADERS   = ['ID', 'Date Added', 'Person', 'Interest', 'Category', 'Source', 'Notes', 'Status'];
const RECIPE_HEADERS            = ['Name', 'Cuisine', 'Servings', 'Prep Time', 'Link', 'Ingredients', 'Tags', 'Notes'];
const MEAL_PLAN_HEADERS         = ['ID', 'Week Start', 'Day', 'Date', 'Meal Name', 'Type', 'Status', 'Notes'];
const TAKEOUT_RESTAURANT_HEADERS = ['Name', 'Cuisine', 'Phone', 'Website', 'Rating', 'Notes'];
const TAKEOUT_ITEM_HEADERS       = ['Restaurant', 'Item', 'Description', 'Rating', 'Notes'];
const HOME_ITEM_HEADERS         = ['Item', 'Category', 'Purchase Date', 'Warranty Expiry', 'Last Service', 'Next Service', 'Interval (mo)', 'Notes'];
const IDEA_HEADERS              = ['ID', 'Date Added', 'Idea', 'Category', 'Tags', 'Notes', 'Status'];
const ITINERARY_HEADERS         = ['ID', 'Trip Key', 'Type', 'Title', 'Date', 'Start Time', 'End Time', 'Location', 'Notes', 'Metadata'];
const TRIP_META_HEADERS         = ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveler', 'Trip Budget', 'Trip Travellers'];
const PACKING_ITEM_HEADERS      = ['ID', 'Trip Key', 'Person', 'Category', 'Item', 'Checked', 'Source', 'Added Date'];
const COUNTRIES_HEADERS         = ['ID', 'Country', 'City', 'Year', 'Traveller', 'Trip Key', 'Notes'];
const BUCKET_LIST_HEADERS       = ['ID', 'Country', 'City', 'Target Year', 'Traveller', 'Stars', 'Dream Trip', 'Notes', 'Visited'];
const TRIP_BUDGET_HEADERS       = ['ID', 'Trip Key', 'Category', 'Label', 'Budgeted', 'Actual', 'Notes']; // Issue #96
const TRIP_RECS_HEADERS         = ['ID', 'Trip Key', 'Suggested Date', 'Type', 'Title', 'Description', 'Rationale', 'Price Range', 'Link', 'Status', 'Source', 'Generated At'];
const PROCESSED_EMAILS_HEADERS  = ['Message ID', 'Processed At', 'Subject', 'Mode', 'Outcome', 'Pending Data'];
const MORNING_ROUTINE_HEADERS   = ['ID', 'Item', 'Source', 'Sort', 'Checked', 'Checked At', 'Added Date'];
const GYM_LOG_HEADERS          = ['ID', 'Event Title', 'Event Date', 'Attended', 'Logged At'];
const PURCHASE_HISTORY_HEADERS   = ['ID', 'Item', 'Normalized', 'Category', 'Date', 'Quantity', 'Unit', 'Store', 'Price', 'Source', 'Notes'];
const CAREER_POSITION_HEADERS    = ['Title', 'Company', 'Department', 'Start Date', 'Work Style', 'Focus Areas', 'Notes'];
const CAREER_GOAL_HEADERS        = ['ID', 'Title', 'Horizon', 'Category', 'Status', 'Target Date', 'Notes'];
const CAREER_PROGRESSION_HEADERS = ['ID', 'Title', 'Company', 'Start Year', 'End Year', 'Type', 'Highlights', 'Notes'];
const CAREER_DEVELOPMENT_HEADERS = ['ID', 'Item', 'Type', 'Status', 'Target Date', 'Notes'];
const CAREER_WIN_HEADERS         = ['ID', 'Date', 'Win', 'Impact', 'Category', 'Notes'];
const CAREER_NETWORK_HEADERS     = ['ID', 'Name', 'Role', 'Company', 'Relationship', 'Last Contact', 'Notes'];
const PRESCRIPTION_HEADERS       = ['ID', 'Person', 'Medication', 'Dosage', 'Frequency', 'Doctor', 'Pharmacy', 'Rx Number', 'Last Filled', 'Refill Date', 'Days Supply', 'Active', 'Notes'];
const CREDIT_CARD_HEADERS        = ['ID', 'Card Name', 'Issuer', 'Last 4', 'Annual Fee', 'Due Day', 'Last Used', 'Owner', 'Auth User', 'Active', 'Statement Credit', 'Notes'];
const CARD_REWARD_HEADERS        = ['ID', 'Card Name', 'Category', 'Rate', 'Rate Type', 'Conditions'];
const CARD_PERK_HEADERS          = ['ID', 'Card Name', 'Perk', 'Amount', 'Frequency', 'Category', 'Last Used'];
const LOYALTY_PROGRAM_HEADERS    = ['ID', 'Program', 'Linked Card', 'Total Points', 'Cents Per Point', 'Best Use', 'Expiry', 'Notes'];
const REWARDS_GOAL_HEADERS       = ['ID', 'Goal', 'Target Program', 'Target Points', 'Current Points', 'Notes'];
const GIFT_PEOPLE_HEADERS        = ['Name'];
const GIFT_IDEAS_HEADERS         = ['ID', 'Person', 'Idea', 'Added Date'];
const IMPORTANT_DATES_HEADERS    = ['ID', 'Date', 'Label', 'Person', 'Recurring', 'Lead Time Days', 'Notes', 'Last Actioned Year'];
const CHORES_HEADERS             = ['ID', 'Chore', 'Cadence', 'Sort', 'Checked', 'Checked At', 'Added Date'];
const TRAVELER_PROFILE_HEADERS   = ['ID', 'Name', 'Passport Country', 'Passport Expiry', 'Special Docs', 'Notes'];
const CONTRACT_HEADERS           = ['ID', 'Name', 'Category', 'Counterparty', 'Start Date', 'End Date', 'Auto-Renews', 'Notice Period Days', 'Monthly Cost', 'Status', 'Document Link', 'Notes'];
const VEHICLE_HEADERS            = ['ID', 'Nickname', 'Year', 'Make', 'Model', 'VIN', 'License Plate', 'State', 'Color', 'Driver', 'Purchase Date', 'Current Mileage', 'Oil Interval (mi)', 'Last Oil Change Date', 'Last Oil Change Mileage', 'Registration Expiry', 'Insurance Provider', 'Insurance Policy #', 'Insurance Expiry', 'Warranty Expiry (B2B)', 'Warranty Expiry (Powertrain)', 'Last Service', 'Next Service', 'Service Interval (mo)', 'Tire Size', 'Emission Inspection Expiry', 'Safety Inspection Expiry', 'Tires Last Replaced Date', 'Tires Last Replaced Mileage', 'Tire Interval (mi)', 'Tread Notes', 'Notes'];
const FINANCIAL_GOAL_HEADERS     = ['ID', 'Name', 'Target Amount', 'Current Amount', 'Monthly Contribution', 'Target Date', 'APY', 'Owner', 'Account', 'Status', 'Notes', 'Created At'];
const FINANCIAL_SCENARIO_HEADERS = ['ID', 'Goal ID', 'Label', 'Change Type', 'Amount', 'Notes', 'Created At'];
var TAX_DOCUMENT_HEADERS = ['ID', 'Tax Year', 'Form Type', 'Issuer / Source', 'Account / Description', 'Category', 'Status', 'Document Link', 'Owner', 'Notes'];
var NOTES_DOC_HEADERS = ['ID', 'Date Added', 'Title', 'Content', 'Tags', 'Related To', 'Pinned', 'Category'];
var NOTES_CATEGORIES  = ['General', 'Travel', 'Lessons Learned', 'Reference', 'Finance', 'Health'];
const EMAIL_FOLLOW_UP_HEADERS    = ['Thread ID', 'Subject', 'Sender', 'Date Flagged', 'Status'];
// Growth (Issue #88) — column order matches row[] offsets used in Growth.js
const BOOK_HEADERS               = ['ID', 'Person', 'Title', 'Author', 'Category', 'Status', 'Rating', 'Date Started', 'Date Finished', 'Notes'];
const COURSE_HEADERS             = ['ID', 'Person', 'Title', 'Source', 'Category', 'Status', 'Rating', 'Notes', 'Date Finished'];
const SKILL_HEADERS              = ['ID', 'Person', 'Skill', 'Category', 'Level', 'Goal Link', 'Last Practiced', 'Notes'];
// Experiments (Issue #130) — column order matches row[] offsets used in Experiments.js
const EXPERIMENT_HEADERS         = ['ID', 'Person', 'Title', 'Category', 'Hypothesis', 'Start Date', 'End Date', 'Status', 'Outcome', 'Notes'];
const RESELL_LIST_HEADERS        = ['ID', 'Item', 'Category', 'Asking Price', 'Original Price', 'Platform', 'Priority', 'Status', 'Notes', 'Added Date'];
const EXPERIMENT_CHECKIN_HEADERS = ['ID', 'Experiment ID', 'Date', 'Note'];
const RESOURCE_HEADERS           = ['ID', 'Name', 'Category', 'Applies To', 'Description', 'URL', 'Tags', 'Drive File ID'];
const BUCKET_ACTIVITIES_HEADERS  = ['ID', 'Bucket ID', 'Activity', 'Done', 'Added Date']; // Issue #113
const WISH_LIST_HEADERS          = ['ID', 'Person', 'Category', 'Item', 'Description', 'URLs', 'Price', 'Priority', 'Status', 'Date Added', 'Notes', 'Date Purchased']; // Issue #131
// HEALTH_APPOINTMENT_HEADERS removed (Issue #85): appointments read from Google Calendar, no sheet needed

// ============================================================
// SETUP — Run once to create all sheet tabs
// ============================================================

/**
 * Run this function once after creating your Life OS sheet.
 * It creates all required tabs with headers and default config rows.
 */
function setupVERA() {
  const ss = getSpreadsheet();
  createSheetTabs(ss);
  // Ensure Signal Learning tab exists (Issue #24 — active intelligence)
  try {
    ensureSignalLearningTab_();
  } catch (slErr) {
    Logger.log('ensureSignalLearningTab_ error (non-fatal): ' + slErr.message);
  }
  setupTriggers();
  Logger.log('✅ VERA setup complete. All tabs created and triggers installed.');
  Logger.log('   Next step: set your CLAUDE_API_KEY in Script Properties.');
}

function getSpreadsheet() {
  if (CONFIG.SHEET_ID === 'YOUR_SHEET_ID_HERE') {
    throw new Error('SHEET_ID not configured. Open Code.js and replace YOUR_SHEET_ID_HERE with your actual Google Sheet ID.');
  }
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function createSheetTabs(ss) {
  ss = ss || getSpreadsheet(); // allow calling standalone from the Apps Script editor
  // Default Config rows
  const configDefaults = [
    ['calendar_days_ahead',    '7'],
    ['task_age_threshold_days','7'],
    ['max_flags_per_night',    '8'],
    ['morning_nudge_time',     '7'],
    ['snooze_default_days',    '2'],
    ['finance_review_day',     '1'],
    ['active_sources',         'Calendar,Tasks,Summaries'],
    ['skip_calendars',         'Holidays in United States'],
    // Add rows like: calendar_label:Eraky Family | family (shared, not Ahmed's direct obligations)
    // Add rows like: calendar_label:Ahmed         | personal
    // Add rows like: calendar_label:Victoria       | household partner
    // PTO settings
    ['pto_vacation_days',      '20'],  // annual vacation allocation (days)
    ['pto_rollover_days',      '0'],   // days carried over from prior year (Issue #49)
    ['pto_personal_hours',     '48'],  // annual personal time (hours)
    ['pto_buffer_days',        '3'],   // reserve days held back from planning
    ['weather_location',       ''],    // city name for weather ticker, e.g. "Austin, TX"
    ['email_parser_enabled',       'false'], // set to 'true' to enable 30-min inbox scan (Issue #98)
    ['pretrip_briefing_enabled',   'true'],  // set to 'false' to disable pre-trip briefing flags (Issue #81)
    ['pretrip_briefing_hours',     '48'],    // hours before departure to generate briefing (Issue #81)
    ['posttrip_capture_enabled',   'true'],  // set to 'false' to disable post-trip debrief prompts (Issue #87)
    ['posttrip_capture_delay_days','1'],     // days after trip end to fire the capture flag (Issue #87)
    ['gym_tracker_enabled',       'true'],  // set to 'false' to disable gym session tracking (Issue #97)
    ['gym_tracker_lookback_hours','24'],    // hours to look back for ended EXERCISE events (Issue #97)
    ['fitness_enabled',              'false'], // set to 'true' to enable weekly consistency checks (Issue #84)
    ['fitness_weekly_target',        '4'],     // target gym sessions per week
    ['fitness_low_flag_day',         '4'],     // day to fire Low flag if behind: 1=Sun … 7=Sat (4=Wed)
    ['fitness_travel_block_time',    '07:00'], // start time for auto-created trip gym sessions
    ['fitness_travel_block_duration','60'],    // duration in minutes for auto-created trip gym sessions
    ['pantry_enabled',              'false'], // set 'true' to enable purchase history + auto-restock (Issue #111)
    // Dashboard tab visibility — Issue #134 (set 'false' to hide the subtab)
    ['morning_routine_enabled',     'true'],
    ['takeouts_enabled',            'true'],
    ['experiments_enabled',         'true'],
    ['wish_list_enabled',           'true'],
    ['wishlists_enabled',           'true'],  // Christmas Wish Lists (People tab)
    ['loyalty_programs_enabled',    'true'],  // reserved — no dedicated subtab yet
    ['financial_scenarios_enabled', 'true'],  // reserved — no dedicated subtab yet
    ['pantry_restock_days_ahead',   '7'],     // days ahead to predict and auto-add items to shopping list
    ['pantry_ema_alpha',            '0.3'],   // EMA learning rate: higher = adapts faster to recent habits
    // Google Tasks integration (Issue #99)
    ['google_tasks_enabled',   'true'],   // set 'false' to disable Google Tasks fetch in dashboard and chat
    // Monthly Life Review (Issue #82)
    ['monthly_review_enabled', 'true'],   // set 'false' to disable monthly review generation
    // Meal Planner (Issue #122)
    ['meal_planner_enabled', 'true'],     // set 'false' to hide Meal Plan subtab
  ];

  ensureSheet(ss, TABS.FLAGS,        FLAG_HEADERS);
  ensureSheet(ss, TABS.TASKS,        TASK_HEADERS);
  ensureSheet(ss, TABS.METRICS,      METRIC_HEADERS);
  ensureSheet(ss, TABS.SUMMARIES,    SUMMARY_HEADERS);
  ensureSheet(ss, TABS.PROJECTS,     PROJECT_HEADERS);
  ensureSheet(ss, TABS.GOALS,        GOAL_HEADERS);
  ensureSheet(ss, TABS.PTO,          PTO_HEADERS);
  ensureSheet(ss, TABS.PTO_MEMORY,       PTO_MEMORY_HEADERS);
  ensureSheet(ss, TABS.REMINDERS_MEMORY, REMINDERS_MEMORY_HEADERS);
  ensureSheet(ss, TABS.INTEREST_LEDGER,  INTEREST_LEDGER_HEADERS);
  ensureSheet(ss, TABS.BILLS,            BILL_HEADERS);
  ensureSheet(ss, TABS.RECIPES,             RECIPE_HEADERS);
  ensureSheet(ss, TABS.MEAL_PLAN,           MEAL_PLAN_HEADERS);
  ensureSheet(ss, TABS.TAKEOUT_RESTAURANTS, TAKEOUT_RESTAURANT_HEADERS);
  ensureSheet(ss, TABS.TAKEOUT_ITEMS,       TAKEOUT_ITEM_HEADERS);
  ensureSheet(ss, TABS.HOME_ITEMS,       HOME_ITEM_HEADERS);
  ensureSheet(ss, TABS.IDEAS,            IDEA_HEADERS);
  ensureSheet(ss, TABS.ITINERARY,        ITINERARY_HEADERS);
  ensureSheet(ss, TABS.TRIP_META,        TRIP_META_HEADERS);
  ensureSheet(ss, TABS.PACKING_ITEMS,    PACKING_ITEM_HEADERS);
  ensureSheet(ss, TABS.COUNTRIES,             COUNTRIES_HEADERS);
  ensureSheet(ss, TABS.BUCKET_LIST,           BUCKET_LIST_HEADERS);
  ensureSheet(ss, TABS.TRIP_RECOMMENDATIONS,  TRIP_RECS_HEADERS);
  ensureSheet(ss, TABS.PROCESSED_EMAILS,      PROCESSED_EMAILS_HEADERS);
  ensureSheet(ss, TABS.MORNING_ROUTINE,       MORNING_ROUTINE_HEADERS);
  ensureSheet(ss, TABS.GYM_LOG,              GYM_LOG_HEADERS);
  ensureSheet(ss, TABS.PURCHASE_HISTORY,     PURCHASE_HISTORY_HEADERS);
  ensureSheet(ss, TABS.CAREER_POSITION,      CAREER_POSITION_HEADERS);
  ensureSheet(ss, TABS.CAREER_GOALS,         CAREER_GOAL_HEADERS);
  ensureSheet(ss, TABS.CAREER_PROGRESSION,   CAREER_PROGRESSION_HEADERS);
  ensureSheet(ss, TABS.CAREER_DEVELOPMENT,   CAREER_DEVELOPMENT_HEADERS);
  ensureSheet(ss, TABS.CAREER_WINS,          CAREER_WIN_HEADERS);
  ensureSheet(ss, TABS.CAREER_NETWORK,       CAREER_NETWORK_HEADERS);
  ensureSheet(ss, TABS.PRESCRIPTIONS,        PRESCRIPTION_HEADERS);
  ensureSheet(ss, TABS.CREDIT_CARDS,         CREDIT_CARD_HEADERS);
  ensureSheet(ss, TABS.CARD_REWARDS,         CARD_REWARD_HEADERS);
  ensureSheet(ss, TABS.CARD_PERKS,           CARD_PERK_HEADERS);
  ensureSheet(ss, TABS.LOYALTY_PROGRAMS,     LOYALTY_PROGRAM_HEADERS);
  ensureSheet(ss, TABS.REWARDS_GOALS,        REWARDS_GOAL_HEADERS);
  ensureSheet(ss, TABS.GIFT_PEOPLE,          GIFT_PEOPLE_HEADERS, [['Ahmed'], ['Victoria']]);
  ensureSheet(ss, TABS.GIFT_IDEAS,           GIFT_IDEAS_HEADERS);
  ensureSheet(ss, TABS.IMPORTANT_DATES,      IMPORTANT_DATES_HEADERS);
  ensureSheet(ss, TABS.CHORES,               CHORES_HEADERS);
  ensureSheet(ss, TABS.TRAVELER_PROFILES,    TRAVELER_PROFILE_HEADERS);
  ensureSheet(ss, TABS.CONTRACTS,            CONTRACT_HEADERS);
  ensureSheet(ss, TABS.VEHICLES,             VEHICLE_HEADERS);
  ensureSheet(ss, TABS.FINANCIAL_GOALS,      FINANCIAL_GOAL_HEADERS);
  ensureSheet(ss, TABS.FINANCIAL_SCENARIOS,  FINANCIAL_SCENARIO_HEADERS);
  ensureSheet(ss, TABS.TAX_DOCUMENTS,        TAX_DOCUMENT_HEADERS);
  // TABS.HEALTH_APPOINTMENTS removed — appointments read from Google Calendar (Issue #85)
  ensureSheet(ss, TABS.TRIP_BUDGET,          TRIP_BUDGET_HEADERS);
  ensureSheet(ss, TABS.RESELL_LIST,          RESELL_LIST_HEADERS);
  ensureSheet(ss, TABS.CONFIG,               CONFIG_HEADERS, configDefaults);

  Logger.log('All VERA tabs verified/created.');
}

/**
 * ONE-TIME SEEDER — Run once from the Apps Script editor to pre-populate the
 * Credit Card Hub (Issues #115 + #117) with Ahmed & Victoria's 9 cards,
 * their reward categories, and tracked perks.
 *
 * Guard: aborts if Credit Cards sheet already has data rows (safe to re-run).
 * Data sourced from official card pages / NerdWallet / TPG (2025–2026).
 */
/** Public wrapper so this appears in the Apps Script function dropdown. Run once. */
function populateCreditCardHub() { populateCreditCardHub_(); }

function populateCreditCardHub_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // ── Guard: prevent duplicate seeding ──────────────────────────
  var ccSheet = ss.getSheetByName(TABS.CREDIT_CARDS);
  if (ccSheet && ccSheet.getLastRow() > 1) {
    Logger.log('populateCreditCardHub_: Credit Cards sheet already has data — aborting. ' +
               'Clear Credit Cards, Card Rewards and Card Perks sheets first if you want to re-seed.');
    return;
  }

  // ── CREDIT CARDS ──────────────────────────────────────────────
  // Columns: ID | Card Name | Issuer | Last 4 | Annual Fee | Due Day | Last Used | Owner | Auth User | Active | Statement Credit | Notes
  var cardRows = [
    //         ID      Card Name                Issuer               Last4  Fee  Due  LastUsed  Owner       AuthUser    Active  Statement Credit                                                                                          Notes
    ['CC-1', 'AMEX Gold',              'American Express', '', 325, '', '', 'Ahmed',    'Victoria', 'Yes', '$10 Dining/m \u00b7 $10 Uber Cash/m \u00b7 $7 Dunkin/m \u00b7 $100 Resy/yr',                                             ''],
    ['CC-2', 'AMEX Platinum',          'American Express', '', 895, '', '', 'Ahmed',    '',         'Yes', '$15 Uber/m \u00b7 $25 Streaming/m \u00b7 $600 Hotel/yr \u00b7 $400 Resy/yr \u00b7 $300 Equinox/yr \u00b7 $300 lululemon/yr', ''],
    ['CC-3', 'BILT Worldwide',         'BILT',             '',   0, '', '', 'Ahmed',    '',         'Yes', 'No annual fee \u00b7 2x on Rent Day (1st of month)',                                                                   ''],
    ['CC-4', 'BMW Card',               'BMW / U.S. Bank',  '',  99, '', '', 'Ahmed',    '',         'Yes', '$99/yr fee',                                                                                                             ''],
    ['CC-5', 'Capital One Venture',    'Capital One',      '',  95, '', '', 'Ahmed',    '',         'Yes', 'Global Entry/TSA reimbursement \u00b7 $50 hotel experience credit',                                                     ''],
    ['CC-6', 'AMEX Blue Cash Everyday','American Express', '',   0, '', '', 'Ahmed',    '',         'Yes', '$7 Disney Bundle/m',                                                                                                     ''],
    ['CC-7', 'Costco Anywhere Visa',   'Citi',             '',   0, '', '', 'Victoria', 'Ahmed',    'Yes', 'No annual fee (Costco membership required)',                                                                             ''],
    ['CC-8', 'Amazon Prime Visa',      'Chase',            '',   0, '', '', 'Ahmed',    'Victoria', 'Yes', 'No annual fee (Prime membership required)',                                                                              ''],
    ['CC-9', 'IHG One Rewards Premier',             'Chase', '',  99, '', '', 'Ahmed',   '',  'Yes', 'Free Night/yr \u00b7 IHG Platinum Elite status',   ''],
    ['CC-10','Chase Sapphire Preferred (Ahmed)',    'Chase', '',  95, '', '', 'Ahmed',   '',  'Yes', '$50 hotel credit/yr \u00b7 DashPass',                ''],
    ['CC-11','Chase Sapphire Preferred (Victoria)', 'Chase', '',  95, '', '', 'Victoria','',  'Yes', '$50 hotel credit/yr \u00b7 DashPass',                ''],
  ];

  var rwSheet   = ss.getSheetByName(TABS.CARD_REWARDS);
  var perkSheet = ss.getSheetByName(TABS.CARD_PERKS);

  // Bulk-write cards
  ccSheet.getRange(2, 1, cardRows.length, cardRows[0].length).setValues(cardRows);

  // ── CARD REWARDS ──────────────────────────────────────────────
  // Columns: ID | Card Name | Category | Rate | Rate Type | Conditions
  var rewardRows = [
    // AMEX Gold
    ['CR-1',  'AMEX Gold',              'Dining',             '4',   'x points',   'Worldwide, up to $50k/yr then 1x'],
    ['CR-2',  'AMEX Gold',              'Groceries',          '4',   'x points',   'US supermarkets, up to $25k/yr then 1x'],
    ['CR-3',  'AMEX Gold',              'Travel',             '3',   'x points',   'Flights booked direct or via Amex Travel'],
    ['CR-4',  'AMEX Gold',              'Hotels',             '2',   'x points',   'Prepaid hotels via Amex Travel'],
    ['CR-5',  'AMEX Gold',              'General Spend',      '1',   'x points',   ''],
    // AMEX Platinum
    ['CR-6',  'AMEX Platinum',          'Travel',             '5',   'x points',   'Flights booked direct or via Amex Travel, up to $500k/yr'],
    ['CR-7',  'AMEX Platinum',          'Hotels',             '5',   'x points',   'Prepaid hotels via Amex Travel'],
    ['CR-8',  'AMEX Platinum',          'General Spend',      '1',   'x points',   ''],
    // BILT Worldwide
    ['CR-9',  'BILT Worldwide',         'Rent',               '1',   'x points',   'No transaction fee on rent/mortgage payments'],
    ['CR-10', 'BILT Worldwide',         'Dining',             '3',   'x points',   ''],
    ['CR-11', 'BILT Worldwide',         'Travel',             '2',   'x points',   ''],
    ['CR-12', 'BILT Worldwide',         'General Spend',      '1',   'x points',   'Double points on Rent Day (1st of month)'],
    // BMW Card
    ['CR-13', 'BMW Card',               'BMW Services',       '5',   'x points',   'At BMW merchants'],
    ['CR-14', 'BMW Card',               'Gas',                '3',   'x points',   'Gas stations and EV charging'],
    ['CR-15', 'BMW Card',               'Dining',             '2',   'x points',   ''],
    ['CR-16', 'BMW Card',               'General Spend',      '1.5', 'x points',   ''],
    // Capital One Venture
    ['CR-17', 'Capital One Venture',    'Travel',             '5',   'x miles',    'Hotels, rentals, activities via Capital One Travel'],
    ['CR-18', 'Capital One Venture',    'General Spend',      '2',   'x miles',    'All other purchases'],
    // AMEX Blue Cash Everyday
    ['CR-19', 'AMEX Blue Cash Everyday','Groceries',          '3',   '% cashback', 'US supermarkets, up to $6k/yr then 1%'],
    ['CR-20', 'AMEX Blue Cash Everyday','Gas',                '3',   '% cashback', 'US gas stations, up to $6k/yr then 1%'],
    ['CR-21', 'AMEX Blue Cash Everyday','Online Shopping',    '3',   '% cashback', 'US online retail, up to $6k/yr then 1%'],
    ['CR-22', 'AMEX Blue Cash Everyday','General Spend',      '1',   '% cashback', ''],
    // Costco Anywhere Visa
    ['CR-23', 'Costco Anywhere Visa',   'Gas',                '4',   '% cashback', 'Eligible gas + EV stations up to $7k/yr then 1% (5% at Costco warehouses)'],
    ['CR-24', 'Costco Anywhere Visa',   'Dining',             '3',   '% cashback', 'Restaurants, cafes, fast food'],
    ['CR-25', 'Costco Anywhere Visa',   'Travel',             '3',   '% cashback', 'Airfare, hotels, car rentals, cruises'],
    ['CR-26', 'Costco Anywhere Visa',   'Costco',             '2',   '% cashback', 'Costco and Costco.com'],
    ['CR-27', 'Costco Anywhere Visa',   'General Spend',      '1',   '% cashback', ''],
    // Amazon Prime Visa
    ['CR-28', 'Amazon Prime Visa',      'Amazon & Whole Foods','5',  '% cashback', 'Amazon.com, Amazon Fresh, Whole Foods, Chase Travel'],
    ['CR-29', 'Amazon Prime Visa',      'Gas',                '2',   '% cashback', ''],
    ['CR-30', 'Amazon Prime Visa',      'Dining',             '2',   '% cashback', ''],
    ['CR-31', 'Amazon Prime Visa',      'Transit',            '2',   '% cashback', 'Local transit and rideshare'],
    ['CR-32', 'Amazon Prime Visa',      'General Spend',      '1',   '% cashback', ''],
    // IHG One Rewards Premier
    ['CR-33', 'IHG One Rewards Premier','IHG Hotels',         '10',  'x points',   'Card multiplier on top of IHG base rate'],
    ['CR-34', 'IHG One Rewards Premier','Travel',             '5',   'x points',   'Non-IHG travel'],
    ['CR-35', 'IHG One Rewards Premier','Dining',             '5',   'x points',   ''],
    ['CR-36', 'IHG One Rewards Premier','Gas',                '5',   'x points',   ''],
    ['CR-37', 'IHG One Rewards Premier',             'General Spend',      '3', 'x points',   ''],
    // Chase Sapphire Preferred (Ahmed)
    ['CR-38', 'Chase Sapphire Preferred (Ahmed)',   'Chase Travel Portal','5', 'x points',   'Via Chase Travel\u2120'],
    ['CR-39', 'Chase Sapphire Preferred (Ahmed)',   'Dining',             '3', 'x points',   ''],
    ['CR-40', 'Chase Sapphire Preferred (Ahmed)',   'Streaming',          '3', 'x points',   'Select streaming services'],
    ['CR-41', 'Chase Sapphire Preferred (Ahmed)',   'Online Groceries',   '3', 'x points',   'Excl. Walmart, Target, wholesale clubs'],
    ['CR-42', 'Chase Sapphire Preferred (Ahmed)',   'Travel',             '2', 'x points',   'All other travel'],
    ['CR-43', 'Chase Sapphire Preferred (Ahmed)',   'General Spend',      '1', 'x points',   ''],
    // Chase Sapphire Preferred (Victoria)
    ['CR-44', 'Chase Sapphire Preferred (Victoria)','Chase Travel Portal','5', 'x points',   'Via Chase Travel\u2120'],
    ['CR-45', 'Chase Sapphire Preferred (Victoria)','Dining',             '3', 'x points',   ''],
    ['CR-46', 'Chase Sapphire Preferred (Victoria)','Streaming',          '3', 'x points',   'Select streaming services'],
    ['CR-47', 'Chase Sapphire Preferred (Victoria)','Online Groceries',   '3', 'x points',   'Excl. Walmart, Target, wholesale clubs'],
    ['CR-48', 'Chase Sapphire Preferred (Victoria)','Travel',             '2', 'x points',   'All other travel'],
    ['CR-49', 'Chase Sapphire Preferred (Victoria)','General Spend',      '1', 'x points',   ''],
  ];

  rwSheet.getRange(2, 1, rewardRows.length, rewardRows[0].length).setValues(rewardRows);

  // ── CARD PERKS ────────────────────────────────────────────────
  // Columns: ID | Card Name | Perk | Amount | Frequency | Category | Last Used
  var perkRows = [
    // AMEX Gold
    ['CP-1',  'AMEX Gold',              'Dining Credit (Grubhub, Cheesecake Factory, etc.)', 10,  'Monthly',  'Dining',    ''],
    ['CP-2',  'AMEX Gold',              'Uber Cash',                                          10,  'Monthly',  'Travel',    ''],
    ['CP-3',  'AMEX Gold',              "Dunkin' Credit",                                     7,   'Monthly',  'Dining',    ''],
    ['CP-4',  'AMEX Gold',              'Resy Dining Credit',                                 100, 'Annual',   'Dining',    ''],
    ['CP-5',  'AMEX Gold',              'Hotel Collection Credit (4-5 star, 2+ nights)',      100, 'Annual',   'Travel',    ''],
    // AMEX Platinum
    ['CP-6',  'AMEX Platinum',          'Uber Cash',                                          15,  'Monthly',  'Travel',    ''],
    ['CP-7',  'AMEX Platinum',          'Streaming Credit (Disney+, Hulu, Peacock, etc.)',    25,  'Monthly',  'Streaming', ''],
    ['CP-8',  'AMEX Platinum',          'Walmart+ Credit',                                    13,  'Monthly',  'Other',     ''],
    ['CP-9',  'AMEX Platinum',          'Fine Hotels + Resorts Credit',                       600, 'Annual',   'Travel',    ''],
    ['CP-10', 'AMEX Platinum',          'Resy Dining Credit',                                 400, 'Annual',   'Dining',    ''],
    ['CP-11', 'AMEX Platinum',          'Equinox Credit',                                     300, 'Annual',   'Other',     ''],
    ['CP-12', 'AMEX Platinum',          'lululemon Credit',                                   300, 'Annual',   'Other',     ''],
    ['CP-13', 'AMEX Platinum',          'Airline Fee Credit',                                 200, 'Annual',   'Travel',    ''],
    ['CP-14', 'AMEX Platinum',          'Global Entry / TSA PreCheck',                        120, 'Annual',   'Travel',    ''],
    ['CP-15', 'AMEX Platinum',          'Priority Pass (airport lounge access)',               0,   'Annual',   'Travel',    ''],
    // BILT Worldwide
    ['CP-16', 'BILT Worldwide',         'Rent Day Double Points (1st of month)',               0,   'Monthly',  'Other',     ''],
    // Capital One Venture
    ['CP-17', 'Capital One Venture',    'Global Entry / TSA PreCheck',                        120, 'Annual',   'Travel',    ''],
    ['CP-18', 'Capital One Venture',    'Lifestyle Collection Hotel Credit',                   50,  'Annual',   'Travel',    ''],
    // AMEX Blue Cash Everyday
    ['CP-19', 'AMEX Blue Cash Everyday','Disney Bundle Credit',                                7,   'Monthly',  'Streaming', ''],
    // IHG One Rewards Premier
    ['CP-20', 'IHG One Rewards Premier','Anniversary Free Night Certificate',                  0,   'Annual',   'Travel',    ''],
    ['CP-21', 'IHG One Rewards Premier','IHG Platinum Elite Status',                           0,   'Annual',   'Travel',    ''],
    ['CP-22', 'IHG One Rewards Premier','United TravelBank Cash',                              50,  'Annual',   'Travel',    ''],
    ['CP-23', 'IHG One Rewards Premier','Global Entry / TSA PreCheck',                        120, 'Annual',   'Travel',    ''],
    ['CP-24', 'IHG One Rewards Premier',             'DashPass Membership',               0,   'Annual',   'Dining',  ''],
    // Chase Sapphire Preferred (Ahmed)
    ['CP-25', 'Chase Sapphire Preferred (Ahmed)',   'Annual Hotel Credit (Chase Travel)', 50,  'Annual',   'Travel',  ''],
    ['CP-26', 'Chase Sapphire Preferred (Ahmed)',   'DashPass Membership',                0,   'Annual',   'Dining',  ''],
    ['CP-27', 'Chase Sapphire Preferred (Ahmed)',   '10% Anniversary Points Bonus',       0,   'Annual',   'Other',   ''],
    // Chase Sapphire Preferred (Victoria)
    ['CP-28', 'Chase Sapphire Preferred (Victoria)','Annual Hotel Credit (Chase Travel)', 50,  'Annual',   'Travel',  ''],
    ['CP-29', 'Chase Sapphire Preferred (Victoria)','DashPass Membership',                0,   'Annual',   'Dining',  ''],
    ['CP-30', 'Chase Sapphire Preferred (Victoria)','10% Anniversary Points Bonus',       0,   'Annual',   'Other',   ''],
  ];

  perkSheet.getRange(2, 1, perkRows.length, perkRows[0].length).setValues(perkRows);

  Logger.log('populateCreditCardHub_: \u2705 Done! ' +
             cardRows.length + ' cards, ' + rewardRows.length + ' reward rows, ' + perkRows.length + ' perk rows written.');
}

/**
 * Creates a sheet tab if it doesn't exist, writes headers, and optionally
 * seeds default rows. Skips header/data writing if content already exists.
 */
function ensureSheet(ss, name, headers, defaultRows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    Logger.log('Created tab: ' + name);
  }

  // Only write headers if the sheet is blank
  if (sheet.getLastRow() === 0) {
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange
      .setFontWeight('bold')
      .setBackground('#1a1a2e')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Seed default data rows if provided and sheet is otherwise empty
    if (defaultRows && defaultRows.length > 0) {
      sheet.getRange(2, 1, defaultRows.length, defaultRows[0].length).setValues(defaultRows);
    }
  }

  return sheet;
}

// ============================================================
// TRIGGERS — Install time-based triggers programmatically
// ============================================================

/**
 * Creates the nightly (11pm) and morning nudge (7am) triggers.
 * Safe to call multiple times — deletes existing VERA triggers first.
 */
function setupTriggers() {
  // Remove any existing triggers for these functions to avoid duplicates
  const existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(function(trigger) {
    const handlerName = trigger.getHandlerFunction();
    if (handlerName === 'nightlyRun' || handlerName === 'morningNudge' || handlerName === 'hourlyCheck' || handlerName === 'checkFlightStatuses_' || handlerName === 'runEmailScan_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Nightly run at 11pm
  ScriptApp.newTrigger('nightlyRun')
    .timeBased()
    .atHour(CONFIG.NIGHTLY_RUN_HOUR)
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Morning nudge at 7am
  ScriptApp.newTrigger('morningNudge')
    .timeBased()
    .atHour(CONFIG.MORNING_NUDGE_HOUR)
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Hourly Anticipator — evaluates reminder rules every hour
  ScriptApp.newTrigger('hourlyCheck')
    .timeBased()
    .everyHours(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Flight status monitor — polls AviationStack for flights within 24h of departure
  ScriptApp.newTrigger('checkFlightStatuses_')
    .timeBased()
    .everyMinutes(15)
    .create();

  // Email inbox scanner — parses travel confirmation emails every 30 min (Issue #98)
  // ⚠ WARNING: email_parser_enabled=true can generate up to 144 Claude API calls/day.
  // Only enable in Config when actively processing a travel email backlog. Disable when done.
  ScriptApp.newTrigger('runEmailScan_')
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log('Triggers set: nightlyRun at 11pm, morningNudge at 7am, hourlyCheck every hour, checkFlightStatuses_ every 15min, runEmailScan_ every 30min.');
}

// ============================================================
// NIGHTLY RUN — Main intelligence pipeline
// ============================================================

/**
 * Main nightly function. Called by time-based trigger at 11pm.
 * Collects data → packages prompt → calls Claude → writes flags.
 */
function nightlyRun() {
  try {
    Logger.log('=== VERA nightly run started: ' + new Date() + ' ===');
    var today        = new Date();
    var runStart     = Date.now();
    var stepFailures = [];  // Collects non-fatal step failure messages for #vera-logs summary

    // Step -1: Escalate aged unacknowledged flags (Issue #5)
    try {
      escalateAgedFlags_();
    } catch (escErr) {
      Logger.log('escalateAgedFlags_ error (non-fatal): ' + escErr.message);
      stepFailures.push('escalateAgedFlags_: ' + escErr.message);
    }

    // Step 0: Auto-populate Summaries tab from live data (Phase 5)
    writeSummarySnapshot();

    // Step 0a: Sync upcoming birthdays from Joint Chaos calendar → Important Dates (Issue #80)
    try { syncCalendarBirthdaysToImportantDates_(); }
    catch (idErr) {
      Logger.log('syncCalendarBirthdaysToImportantDates_ error (non-fatal): ' + idErr.message);
      stepFailures.push('syncCalendarBirthdays_: ' + idErr.message);
    }

    // Step 0a-ii: Reset household chores by cadence (Issue #124)
    try { resetChoresByCadence_(); }
    catch (chErr) {
      Logger.log('resetChoresByCadence_ error (non-fatal): ' + chErr.message);
      stepFailures.push('resetChoresByCadence_: ' + chErr.message);
    }

    // Step 0b: PTO snapshot + Vera calendar recommendations (Issue #19)
    var ptoStats = null;
    try {
      ptoStats = writePTOSnapshot_();
      Logger.log('PTO snapshot written — vacation used: ' + (ptoStats && ptoStats.used ? ptoStats.used.vacationDays : '?') + ' days.');
    } catch (ptoErr) {
      Logger.log('PTO snapshot error (non-fatal): ' + ptoErr.message);
      stepFailures.push('writePTOSnapshot_: ' + ptoErr.message);
    }

    // Step 0c: Explorer — daily AI discovery bulletin (Reminders.js)
    try {
      runExplorer_();
    } catch (expErr) {
      Logger.log('runExplorer_ error (non-fatal): ' + expErr.message);
      stepFailures.push('runExplorer_: ' + expErr.message);
    }

    // Step 0d: Signal Learning — get suppressed patterns to filter noise (Issue #24)
    var suppressedPatterns = [];
    try {
      suppressedPatterns = getSuppressedKeyPatterns_();
      if (suppressedPatterns.length > 0) {
        Logger.log('SignalLearning: suppressing ' + suppressedPatterns.length + ' noise pattern(s): ' + suppressedPatterns.join(', '));
      }
    } catch (slErr) {
      Logger.log('getSuppressedKeyPatterns_ error (non-fatal): ' + slErr.message);
      stepFailures.push('getSuppressedKeyPatterns_: ' + slErr.message);
    }

    // Step 0e: Signal Learning — record expired flags (open > 30 days, never actioned)
    try {
      recordExpiredFlags_();
    } catch (expFlagErr) {
      Logger.log('recordExpiredFlags_ error (non-fatal): ' + expFlagErr.message);
      stepFailures.push('recordExpiredFlags_: ' + expFlagErr.message);
    }

    // Step 0f: Pre-trip briefings (48-hour auto-summary) (Issue #81)
    try {
      checkPreTripBriefings_();
    } catch (ptbErr) {
      Logger.log('checkPreTripBriefings_ error (non-fatal): ' + ptbErr.message);
      stepFailures.push('checkPreTripBriefings_: ' + ptbErr.message);
    }

    // Step 0g: Post-trip capture prompts (Issue #87)
    try {
      checkPostTripCapture_();
    } catch (ptcErr) {
      Logger.log('checkPostTripCapture_ error (non-fatal): ' + ptcErr.message);
      stepFailures.push('checkPostTripCapture_: ' + ptcErr.message);
    }

    // Step 0h: Reset morning routine checkboxes for the new day
    try {
      var mrSheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
      if (mrSheet && mrSheet.getLastRow() > 1) {
        var mrRows = mrSheet.getLastRow() - 1;
        var resetVals = [];
        for (var mri = 0; mri < mrRows; mri++) resetVals.push([false, '']);
        mrSheet.getRange(2, 5, mrRows, 2).setValues(resetVals); // cols 5–6: Checked, Checked At
        Logger.log('Morning routine: reset ' + mrRows + ' item(s) to unchecked.');
      }
    } catch (mrErr) {
      Logger.log('Morning routine reset error (non-fatal): ' + mrErr.message);
      stepFailures.push('morningRoutineReset: ' + mrErr.message);
    }

    // Step 0i: Gym session check-in prompts (Issue #97)
    try {
      checkGymSessions_();
    } catch (gymErr) {
      Logger.log('checkGymSessions_ error (non-fatal): ' + gymErr.message);
      stepFailures.push('checkGymSessions_: ' + gymErr.message);
    }

    // Step 0j: Fitness consistency + travel gap checks (Issue #84)
    try { checkFitnessConsistency_(); } catch (fcErr) { Logger.log('checkFitnessConsistency_ error (non-fatal): ' + fcErr.message); stepFailures.push('checkFitnessConsistency_: ' + fcErr.message); }
    try { checkFitnessTravelGap_();   } catch (ftErr) { Logger.log('checkFitnessTravelGap_ error (non-fatal): '   + ftErr.message); stepFailures.push('checkFitnessTravelGap_: '   + ftErr.message); }

    // Step 0k: Purchase history auto-restock + pantry trip-overlap flags (Issue #111)
    try { autoRestockItems_();    } catch (arErr) { Logger.log('autoRestockItems_ error (non-fatal): '    + arErr.message); stepFailures.push('autoRestockItems_: '    + arErr.message); }
    try { generatePantryFlags_(); } catch (pfErr) { Logger.log('generatePantryFlags_ error (non-fatal): ' + pfErr.message); stepFailures.push('generatePantryFlags_: ' + pfErr.message); }

    // Step 0l: Capacity mode inference — score tomorrow's calendar load (Issue #8)
    try { inferCapacityMode_(); } catch (capErr) { Logger.log('inferCapacityMode_ error (non-fatal): ' + capErr.message); stepFailures.push('inferCapacityMode_: ' + capErr.message); }

    // Step 0m: Contract expiry checks — generate flags for upcoming renewals/expirations (Issue #146)
    try { checkContracts_(); } catch (conErr) { Logger.log('checkContracts_ error (non-fatal): ' + conErr.message); stepFailures.push('checkContracts_: ' + conErr.message); }
    checkTaxDocuments_();
    Logger.log('Step 0n: tax document check done');

    // Step 0n: Health appointment due-date checks — flag overdue/upcoming appointments (Issue #85)
    try { checkHealthAppointments_(); } catch (hErr) { Logger.log('checkHealthAppointments_ error (non-fatal): ' + hErr.message); stepFailures.push('checkHealthAppointments_: ' + hErr.message); }

    // Step 0o: Monthly Life Review — generates on 1st of each month (Issue #82)
    try { checkMonthlyReview_(ptoStats); } catch (mrErr) { Logger.log('checkMonthlyReview_ error (non-fatal): ' + mrErr.message); stepFailures.push('checkMonthlyReview_: ' + mrErr.message); }

    // Step 0p: Meal Plan Saturday reset — archive current week, seed next week (Issue #122)
    if (today.getDay() === 6) {
      try { resetWeekMealPlan_(); } catch (mpErr) { Logger.log('resetWeekMealPlan_ error (non-fatal): ' + mpErr.message); stepFailures.push('resetWeekMealPlan_: ' + mpErr.message); }
    }

    // Step 0q: Cross-domain pattern recognition — compound signals across all domains (Issue #90)
    try { checkCrossPatternFlags_(); } catch (prErr) { Logger.log('checkCrossPatternFlags_ error (non-fatal): ' + prErr.message); stepFailures.push('checkCrossPatternFlags_: ' + prErr.message); }

    // Step 1: Collect
    const events    = getUpcomingEvents();
    const tasks     = getOpenTasks();
    const summaries = getSummaries();
    const ledger    = getSharedInterestLedger_();

    Logger.log('Data collected — Events: ' + events.length + ', Tasks: ' + tasks.length + ', Summaries: ' + summaries.length + ', Interests: ' + ledger.length);

    // Step 1b: Suggest due dates for undated tasks (writes back to sheet)
    suggestDueDates(tasks);

    // Step 2: Skip Claude if there is no meaningful data to reason about.
    // Only bypasses when ALL THREE are simultaneously empty (rare: quiet weekends,
    // cleared task list during travel, etc.). Any one non-empty source proceeds normally.
    if (events.length === 0 && tasks.length === 0 && summaries.length === 0) {
      Logger.log('nightlyRun: no events, tasks, or summaries tonight — skipping Claude call.');
      Logger.log('=== VERA nightly run complete: ' + new Date() + ' ===');
      var elapsedEmpty = Math.round((Date.now() - runStart) / 1000);
      try { sendSlackLog_('\u2705 Nightly run \u2014 0 flags (no data) in ' + elapsedEmpty + 's'); } catch (e) {}
      return;
    }

    // Step 2 & 3: Package + Reason (Claude) — pass suppressed patterns for noise filtering
    const flags = generateFlags(events, tasks, summaries, ptoStats, ledger, suppressedPatterns);

    // Step 4: Write
    if (flags && flags.length > 0) {
      writeFlags(flags);
      Logger.log('Wrote ' + flags.length + ' flags to sheet.');

      // Step 4b: Signal Learning — record generated flag keys as "seen"
      try {
        var flagKeys = flags.map(function(f) { return f.key || ''; }).filter(function(k) { return k; });
        if (flagKeys.length > 0) recordFlagsGenerated_(flagKeys);
      } catch (slErr) {
        Logger.log('recordFlagsGenerated_ error (non-fatal): ' + slErr.message);
      }
    } else {
      Logger.log('No flags generated tonight — nothing to write.');
    }

    Logger.log('=== VERA nightly run complete: ' + new Date() + ' ===');

    // Issue #158: Send high-level nightly summary to #vera-logs
    try {
      var elapsed     = Math.round((Date.now() - runStart) / 1000);
      var flagCount   = (flags && flags.length) ? flags.length : 0;
      var highCount   = flagCount ? flags.filter(function(f) { return f.urgency === 'High';   }).length : 0;
      var medCount    = flagCount ? flags.filter(function(f) { return f.urgency === 'Medium'; }).length : 0;
      var lowCount    = flagCount ? flags.filter(function(f) { return f.urgency === 'Low';    }).length : 0;
      var summary     = '\u2705 Nightly run \u2014 ' + flagCount + ' flag' + (flagCount !== 1 ? 's' : '') + ' written';
      if (flagCount > 0) summary += ' (' + highCount + ' High, ' + medCount + ' Med, ' + lowCount + ' Low)';
      if (stepFailures.length) summary += ' \u00b7 ' + stepFailures.length + ' step warning' + (stepFailures.length > 1 ? 's' : '');
      summary += ' in ' + elapsed + 's';
      sendSlackLog_(summary);
      if (stepFailures.length) {
        sendSlackLog_('\u26a0\ufe0f Step warnings:\n' + stepFailures.map(function(f) { return '\u2022 ' + f; }).join('\n'));
      }
      veraLog_('nightlyRun', 'Nightly',
        stepFailures.length ? 'Partial' : 'Success',
        flagCount + ' flag' + (flagCount !== 1 ? 's' : '') + ' written' +
          (flagCount > 0 ? ' (' + highCount + 'H ' + medCount + 'M ' + lowCount + 'L)' : '') +
          (stepFailures.length ? ' · ' + stepFailures.length + ' step warning(s)' : ''),
        elapsed * 1000,
        stepFailures.length ? stepFailures.join('; ') : '');
    } catch (slackSummaryErr) { /* non-fatal — never let logging break the run */ }

  } catch (e) {
    Logger.log('VERA nightly run ERROR: ' + e.message + '\n' + e.stack);
    // Issue #158: Send failure alert to #vera-logs
    try { sendSlackLog_('\u274c Nightly run FAILED: ' + e.message + ' (' + (e.fileName || 'Code') + ':' + (e.lineNumber || '?') + ')'); } catch (se) {}
    try {
      MailApp.sendEmail(
        CONFIG.MORNING_NUDGE_EMAIL,
        'VERA Error — Nightly Run Failed',
        'VERA encountered an error during the nightly run.\n\n' +
        'Error: ' + e.message + '\n\n' +
        'Stack:\n' + e.stack
      );
    } catch (mailErr) {
      Logger.log('Also failed to send error email: ' + mailErr.message);
    }
  }
}

// ============================================================
// WRITE FLAGS — Persist Claude's output to the Flags tab
// ============================================================

/**
 * Appends flag rows to the Flags tab and color-codes by urgency.
 * Skips any flag whose source + text fingerprint matches an existing
 * unresolved flag, to prevent nightly duplicates for ongoing issues.
 * @param {Array} flags - Array of flag objects from generateFlags()
 */
/**
 * Returns true if newKey shares ≥ 60% of its meaningful tokens with any
 * existing key-based fingerprint in the set.
 *
 * Month names and standalone numbers are stripped before comparison so
 * date-drifted keys (e.g. verizon_bill_march_13 vs verizon_bill_march_14)
 * are treated as the same issue.
 *
 * @param {string} newKey              - The candidate key from Claude
 * @param {Set}    existingFingerprints - Set returned by getExistingFlagFingerprints_()
 * @returns {boolean}
 */
function keysAreSimilar_(newKey, existingFingerprints) {
  if (!newKey) return false;

  function normalize(k) {
    return String(k).toLowerCase()
      // Remove month names (full and abbreviated)
      .replace(/jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?/g, '')
      // Remove standalone numbers
      .replace(/\b\d+\b/g, '')
      // Collapse repeated underscores
      .replace(/_+/g, '_')
      // Trim leading/trailing underscores
      .replace(/^_|_$/g, '');
  }

  var newTokens = normalize(newKey).split('_').filter(function(t) { return t.length > 2; });
  if (newTokens.length === 0) return false;

  var similar = false;
  existingFingerprints.forEach(function(fp) {
    if (similar) return; // Already found a match — short-circuit
    if (fp.indexOf('key:') !== 0) return; // Only compare against key-based fingerprints
    var existingTokens = normalize(fp.slice(4)).split('_').filter(function(t) { return t.length > 2; });
    if (existingTokens.length === 0) return;
    var matches = newTokens.filter(function(t) { return existingTokens.indexOf(t) !== -1; });
    var minLen  = Math.min(newTokens.length, existingTokens.length);
    if (minLen > 0 && matches.length / minLen >= 0.6) similar = true;
  });
  return similar;
}

function writeFlags(flags) {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const timestamp = dateStr.replace(/-/g, '');

  // Build fingerprint set of ALL flags ever written (open, ack, snoozed, resolved)
  const existing = getExistingFlagFingerprints_(sheet);

  let written = 0;
  let skipped = 0;

  flags.forEach(function(flag) {
    const fp = makeFlagFingerprint_(flag.source, flag.flag, flag.key);

    if (existing.has(fp)) {
      Logger.log('Dedup (exact): skipping [' + (flag.key || flag.flag) + ']');
      skipped++;
      return;
    }

    // Fuzzy check: reject keys that share ≥60% token overlap with any existing key
    // (catches date-drifted variants like verizon_bill_march_13 vs verizon_bill_march_14)
    if (flag.key && keysAreSimilar_(flag.key, existing)) {
      Logger.log('Dedup (fuzzy): skipping similar key [' + flag.key + ']');
      skipped++;
      return;
    }

    const rand2 = String(Math.floor(Math.random() * 90) + 10); // 10–99, never repeats across runs
    const id = 'FLAG-' + timestamp + '-' + rand2;

    const row = [
      id,                     // A: ID
      dateStr,                // B: Date
      flag.source  || '',     // C: Source
      flag.flag    || '',     // D: Flag
      flag.reason  || '',     // E: Reason
      flag.urgency || 'Low',  // F: Urgency
      'No',                   // G: Acknowledged
      '',                     // H: Snoozed Until
      'No',                   // I: Resolved
      flag.key     || '',     // J: Key (stable dedup identifier)
      '',                     // K: Escalated (3d / 7d once aged)
    ];
    sheet.appendRow(row);
    existing.add(fp); // Prevent dupes within the same batch
    written++;
  });

  if (written > 0) colorCodeFlags(sheet);
  Logger.log('writeFlags: ' + written + ' new flags written, ' + skipped + ' duplicates skipped.');
}

/**
 * Returns a Set of fingerprints for ALL flags ever written to the sheet,
 * regardless of their status (open, acknowledged, snoozed, or resolved).
 *
 * Once a key has been written — in any state — it is permanently blocked
 * from re-appearing. This prevents the same issue from cycling back after
 * the user resolves it. If the issue genuinely recurs later, Claude should
 * generate a new key (e.g. add a _q2 or _apr suffix).
 */
function getExistingFlagFingerprints_(sheet) {
  const fingerprints = new Set();
  if (!sheet || sheet.getLastRow() < 2) return fingerprints;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

  data.forEach(function(row) {
    const key = String(row[9] || '').trim(); // Column J: stable key (may be empty for legacy rows)
    fingerprints.add(makeFlagFingerprint_(row[2], row[3], key));
  });

  return fingerprints;
}

/**
 * Creates a deduplication fingerprint for a flag.
 *
 * When a stable "key" field is present (generated by Claude, e.g. "verizon_bill_march_13"),
 * uses the key ALONE as the fingerprint — no source prefix. This means the same key
 * always produces the same fingerprint regardless of how the source label is worded
 * across different nightly runs, preventing duplicates like "verizon_bill_march_13"
 * appearing twice because the source changed from "Finance" to "Finance/Verizon".
 *
 * Falls back to source + first 8 words of flag text for legacy rows that pre-date
 * the key field, so old unresolved flags still block re-duplication.
 *
 * @param {string} source   - Flag source (e.g. "Calendar", "Finance") — only used in fallback
 * @param {string} flagText - Flag title text (used as fallback)
 * @param {string} key      - Stable snake_case key from Claude (preferred; globally unique)
 */
function makeFlagFingerprint_(source, flagText, key) {
  // Preferred path: stable key provided by Claude — key alone is the fingerprint.
  // Keys are designed to be globally unique (e.g. "verizon_bill_march_13"), so no
  // source prefix is needed and including one only causes false mismatches.
  if (key && String(key).trim() !== '') {
    const safeKey = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
    return 'key:' + safeKey;
  }

  // Legacy fallback: source + first 8 words of flag text (for rows with no key)
  const src  = String(source || '').toLowerCase().trim();
  const text = String(flagText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
  return src + '|' + text;
}

/**
 * Applies background color to flag rows based on urgency level.
 * High = red-tint, Medium = yellow-tint, Low = green-tint.
 */
function colorCodeFlags(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const urgencyCol = 6; // Column F
  const urgencyData = sheet.getRange(2, urgencyCol, lastRow - 1, 1).getValues();

  urgencyData.forEach(function(row, i) {
    const rowNum  = i + 2;
    const urgency = row[0];
    let bgColor   = '#ffffff';

    if (urgency === 'High')   bgColor = '#fce8e6'; // soft red
    if (urgency === 'Medium') bgColor = '#fef9e7'; // soft yellow
    if (urgency === 'Low')    bgColor = '#e6f4ea'; // soft green

    sheet.getRange(rowNum, 1, 1, FLAG_HEADERS.length).setBackground(bgColor);
  });
}

// ============================================================
// SIGNAL LEARNING HELPERS — Expired flag recording
// ============================================================

/**
 * Scans the Flags tab for flags that have been open for >30 days
 * with no acknowledgement, snooze, or resolution — these are "expired/ignored".
 * Records them in SignalLearning so the pattern gets a noise score penalty.
 * Only records once per flag (Escalated column shows '7d' when stale).
 */
function recordExpiredFlags_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

  var expiredCount = 0;
  data.forEach(function(row) {
    var resolved  = String(row[8]  || '').toLowerCase(); // Col I: Resolved
    var ack       = String(row[6]  || '').toLowerCase(); // Col G: Acknowledged
    var snoozed   = String(row[7]  || '').trim();        // Col H: Snoozed Until
    var flagKey   = String(row[9]  || '').trim();        // Col J: Key
    var escalated = String(row[10] || '').trim();        // Col K: Escalated

    // Only flag unresolved, unacknowledged, unsnoozed rows
    if (resolved === 'yes' || ack === 'yes' || snoozed) return;

    // Must have a key to track pattern
    if (!flagKey) return;

    // Calculate age
    var flagDate = new Date(row[1]); // Col B: Date
    if (isNaN(flagDate.getTime())) return;
    flagDate.setHours(0, 0, 0, 0);
    var ageDays = Math.floor((today - flagDate) / (1000 * 60 * 60 * 24));

    // Record as expired if open >30 days (the 7d escalation marks it as stale)
    // Use escalated = '7d' as a proxy that means "VERA tried, user never responded"
    if (ageDays >= 30 || escalated === '7d') {
      try {
        recordFlagOutcome_(flagKey, 'expired');
        expiredCount++;
      } catch (e) {
        Logger.log('recordExpiredFlags_: error for key "' + flagKey + '": ' + e.message);
      }
    }
  });

  if (expiredCount > 0) {
    Logger.log('recordExpiredFlags_: recorded ' + expiredCount + ' expired flag(s).');
  }
}

// ============================================================
// FLAG ESCALATION — Age-based urgency bumps
// ============================================================

/**
 * Scans unresolved, unacknowledged flags and escalates aged ones:
 *   ≥ 3 days → bump urgency (Low→Medium, Medium→High); set Escalated = '3d'
 *   ≥ 7 days → append stale note to Reason; set Escalated = '7d'
 *
 * The 'Escalated' column (K) tracks state so each threshold fires once.
 * Snoozed flags are skipped while the snooze window is active.
 */
function escalateAgedFlags_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const numRows = sheet.getLastRow() - 1;
  const numCols = FLAG_HEADERS.length; // includes Escalated (col K = index 10)
  const data    = sheet.getRange(2, 1, numRows, numCols).getValues();

  // Column indices (0-based within data row; 1-based for sheet.getRange)
  const COL_DATE      = 1;  // B
  const COL_REASON    = 4;  // E
  const COL_URGENCY   = 5;  // F
  const COL_ACK       = 6;  // G
  const COL_SNOOZE    = 7;  // H
  const COL_RESOLVED  = 8;  // I
  const COL_ESCALATED = 10; // K

  const urgencyUp = { 'Low': 'Medium', 'Medium': 'High', 'High': 'High' };

  let escalated = 0;

  data.forEach(function(row, i) {
    // Skip resolved or acknowledged flags
    if (String(row[COL_RESOLVED] || '').toLowerCase() === 'yes') return;
    if (String(row[COL_ACK]      || '').toLowerCase() === 'yes') return;

    // Skip while snoozed
    const snoozeVal = row[COL_SNOOZE];
    if (snoozeVal) {
      var snoozeDate = new Date(snoozeVal);
      if (!isNaN(snoozeDate.getTime()) && snoozeDate > today) return;
    }

    // Calculate age in days
    const flagDate = new Date(row[COL_DATE]);
    if (isNaN(flagDate.getTime())) return;
    flagDate.setHours(0, 0, 0, 0);
    const ageDays = Math.floor((today - flagDate) / (1000 * 60 * 60 * 24));

    const rowNum           = i + 2; // 1-indexed sheet row
    const currentEscalated = String(row[COL_ESCALATED] || '').trim();
    const currentUrgency   = String(row[COL_URGENCY]   || 'Low').trim();
    const flagText         = String(row[3] || '');

    if (ageDays >= 7 && currentEscalated !== '7d') {
      // Mark 7-day stale: force urgency to High + append stale note
      sheet.getRange(rowNum, COL_ESCALATED + 1).setValue('7d');
      sheet.getRange(rowNum, COL_URGENCY   + 1).setValue('High'); // force High — no more Medium after 7d
      const reason = String(row[COL_REASON] || '');
      if (reason.indexOf('[Stale:') === -1) {
        sheet.getRange(rowNum, COL_REASON + 1).setValue(
          reason + (reason ? ' ' : '') + '[Stale: open for 7+ days — needs attention]'
        );
      }
      Logger.log('escalateAgedFlags_: 7d stale + forced High — row ' + rowNum + ' "' + flagText + '"');
      escalated++;

    } else if (ageDays >= 3 && currentEscalated === '') {
      // First escalation: bump urgency at 3 days
      const newUrgency = urgencyUp[currentUrgency] || currentUrgency;
      sheet.getRange(rowNum, COL_URGENCY   + 1).setValue(newUrgency);
      sheet.getRange(rowNum, COL_ESCALATED + 1).setValue('3d');
      Logger.log('escalateAgedFlags_: 3d bump ' + currentUrgency + '→' + newUrgency +
                 ' — row ' + rowNum + ' "' + flagText + '"');
      escalated++;
    }
  });

  if (escalated > 0) {
    colorCodeFlags(sheet);
    Logger.log('escalateAgedFlags_: escalated ' + escalated + ' flag(s).');
  } else {
    Logger.log('escalateAgedFlags_: no flags needed escalation tonight.');
  }
}

// ============================================================
// GET CONFIG VALUES — Read the Config tab into a key-value map
// ============================================================

/**
 * Reads all rows from the Config tab and returns them as a plain object.
 * Skips blank or malformed rows.
 *
 * Example output:
 * {
 *   "calendar_days_ahead": "7",
 *   "skip_calendars": "Holidays in United States",
 *   "calendar_label:Eraky Family": "family (shared, not Ahmed's direct obligations)",
 *   "calendar_label:Ahmed": "personal"
 * }
 *
 * @returns {Object} Key-value map of all Config settings
 */
function getConfigValues() {
  if (_configCache_) return _configCache_;
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.CONFIG);
    if (!sheet || sheet.getLastRow() < 2) return {};

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, 2).getValues();
    const config  = {};

    data.forEach(function(row) {
      const key   = String(row[0] || '').trim();
      const value = (row[1] === null || row[1] === undefined || row[1] === '') ? '' : String(row[1]).trim();
      if (key !== '') config[key] = value;
    });

    _configCache_ = config;
    return config;
  } catch (e) {
    Logger.log('getConfigValues error: ' + e.message);
    return {};
  }
}

// ============================================================
// GET SUMMARIES — Read from Summaries tab
// ============================================================

/**
 * Reads all rows from BOTH the Metrics tab (auto-counts) and the Summaries tab
 * (external life intelligence feed) and returns them combined for Claude.
 *
 * @returns {Array} Array of {source, metric, value, asOf} objects
 */
function getSummaries() {
  try {
    const ss = getSpreadsheet();
    return readSummaryTab_(ss, TABS.METRICS).concat(readSummaryTab_(ss, TABS.SUMMARIES));
  } catch (e) {
    Logger.log('getSummaries error: ' + e.message);
    return [];
  }
}

/**
 * Reads all non-blank rows from a single tab that shares the Source/Metric/Value/As Of schema.
 * Used by getSummaries() to read both Metrics and Summaries tabs.
 *
 * @param {Spreadsheet} ss       - The spreadsheet object
 * @param {string}      tabName  - Tab name to read (e.g. TABS.METRICS or TABS.SUMMARIES)
 * @returns {Array} Array of {source, metric, value, asOf} objects
 */
function readSummaryTab_(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, SUMMARY_HEADERS.length).getValues();

  return data
    .filter(function(row) { return row[0] !== ''; })
    .map(function(row) {
      return {
        source: String(row[0] || ''),
        metric: String(row[1] || ''),
        value:  String(row[2] || ''),
        asOf:   row[3] instanceof Date
          ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(row[3] || ''),
      };
    });
}

// ============================================================
// MORNING INTELLIGENCE — Issue #24
// ============================================================

/**
 * Builds a TODAY'S FOCUS / MAINTENANCE / TRAVEL HTML section for the morning email.
 * Only renders sections that have content — silently skips empty ones.
 *
 * @returns {string} HTML string (may be empty if nothing urgent)
 */
function buildMorningIntelligence_() {
  var html     = '';
  var tz       = Session.getScriptTimeZone();
  var today    = new Date(); today.setHours(0, 0, 0, 0);
  var dayOfMon = today.getDate();

  var focusRows = [];
  var maintRows = [];
  var travelRows = [];

  // ---- Today's Focus: Overdue tasks by name --------------------------------
  try {
    var openTasks = getOpenTasks();
    var overdueTasks = openTasks.filter(function(t) { return t.isOverdue; })
      .sort(function(a, b) { return Math.abs(b.daysUntilDue || 0) - Math.abs(a.daysUntilDue || 0); })
      .slice(0, 3);

    overdueTasks.forEach(function(t) {
      var days = Math.abs(t.daysUntilDue || 0);
      focusRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
        escapeHtml_(t.task) + '</strong> <span style="color:#c62828;font-size:13px;">— ' +
        days + ' day' + (days === 1 ? '' : 's') + ' overdue</span></p>');
    });
  } catch (e) { Logger.log('buildMorningIntelligence_: tasks — ' + e.message); }

  // ---- Today's Focus: Bills due within 5 days -----------------------------
  try {
    var billsSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
    if (billsSheet && billsSheet.getLastRow() >= 2) {
      var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
      var billsData = billsSheet.getRange(2, 1, billsSheet.getLastRow() - 1, BILL_HEADERS.length).getValues();
      billsData.forEach(function(r) {
        var name   = String(r[0] || '').trim();
        if (!name) return;
        var dueDay = r[2] !== '' ? Number(r[2]) : null;
        var paid   = String(r[6] || '').trim() === currMonth;
        if (paid || dueDay === null) return;
        var daysUntil = dueDay - dayOfMon;
        if (daysUntil < 0) daysUntil += new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        if (daysUntil > 5) return;
        var amtStr = r[1] !== '' ? ' ($' + Number(r[1]) + ')' : '';
        var dueStr = daysUntil === 0 ? 'DUE TODAY' : 'due in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's');
        focusRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
          escapeHtml_(name) + amtStr + '</strong> <span style="color:#e65100;font-size:13px;">— ' + dueStr + '</span></p>');
      });
    }
  } catch (e) { Logger.log('buildMorningIntelligence_: bills — ' + e.message); }

  // ---- Maintenance: Home items overdue or due within 14 days ---------------
  try {
    var homeSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
    if (homeSheet && homeSheet.getLastRow() >= 2) {
      var homeData = homeSheet.getRange(2, 1, homeSheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
      homeData.forEach(function(r) {
        var item = String(r[0] || '').trim();
        if (!item) return;
        var serviceDays = null;
        if (r[5]) { try { serviceDays = Math.round((new Date(r[5]) - today) / 86400000); } catch(e2) {} }
        if (serviceDays === null || serviceDays > 14) return;
        var statusStr;
        if (serviceDays < 0)   statusStr = Math.abs(serviceDays) + ' day' + (Math.abs(serviceDays) === 1 ? '' : 's') + ' overdue';
        else if (serviceDays === 0) statusStr = 'DUE TODAY';
        else                   statusStr = 'due in ' + serviceDays + ' day' + (serviceDays === 1 ? '' : 's');
        var textColor = serviceDays < 0 ? '#c62828' : '#777777';
        maintRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
          escapeHtml_(item) + '</strong> <span style="color:' + textColor + ';font-size:13px;">— ' + statusStr + '</span></p>');
      });
    }
  } catch (e) { Logger.log('buildMorningIntelligence_: home — ' + e.message); }

  // ---- Travel: Upcoming trips within 14 days --------------------------------
  try {
    var travelCfg   = readPTOConfig_();
    var travelTrips = getUpcomingTravel_(travelCfg);
    var ss_t = getSpreadsheet();

    travelTrips.forEach(function(trip) {
      var daysAway = trip.daysAway !== undefined ? trip.daysAway
        : (trip.startDate ? Math.round((new Date(trip.startDate) - today) / 86400000) : null);
      if (daysAway === null || daysAway > 14 || daysAway < 0) return;

      var tripKey = trip.startDate + '|' + trip.label;
      var packTotal = 0, packDone = 0;
      try {
        var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);
        if (packSheet && packSheet.getLastRow() >= 2) {
          packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues().forEach(function(r) {
            if (String(r[1]).trim() !== tripKey) return;
            packTotal++;
            if (String(r[5]).toLowerCase() === 'true' || String(r[5]).toLowerCase() === 'yes') packDone++;
          });
        }
      } catch(pe) {}

      var packStr = packTotal === 0 ? '⚠ packing not started' : (packDone + '/' + packTotal + ' packed');
      var daysStr = daysAway === 0 ? 'TODAY' : (daysAway + ' days away');
      travelRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
        escapeHtml_(trip.label) + '</strong> <span style="color:#555555;font-size:13px;">— ' +
        daysStr + ' · ' + packStr + '</span></p>');
    });
  } catch (e) { Logger.log('buildMorningIntelligence_: travel — ' + e.message); }

  // ---- Assemble HTML -------------------------------------------------------
  if (focusRows.length === 0 && maintRows.length === 0 && travelRows.length === 0) return '';

  html += '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">';

  if (focusRows.length > 0) {
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🎯 Today\'s Focus</p>';
    html += focusRows.join('');
  }

  if (maintRows.length > 0) {
    if (focusRows.length > 0) html += '<div style="margin-top:12px;"></div>';
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🔧 Maintenance</p>';
    html += maintRows.join('');
  }

  if (travelRows.length > 0) {
    if (focusRows.length > 0 || maintRows.length > 0) html += '<div style="margin-top:12px;"></div>';
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🧳 Travel</p>';
    html += travelRows.join('');
  }

  html += '</div>';
  return html;
}

/**
 * HTML-escapes a string for safe insertion into an HTML email.
 */
function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// MORNING NUDGE — 7am email summary
// ============================================================

// ============================================================
// TAX DOCUMENTS — Issue #166
// ============================================================

function checkTaxDocuments_() {
  try {
    var ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh   = ss.getSheetByName(TABS.TAX_DOCUMENTS);
    if (!sh || sh.getLastRow() < 2) return;
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, TAX_DOCUMENT_HEADERS.length).getValues();
    var today = new Date();
    var year  = today.getFullYear();
    // Tax year being checked is the PREVIOUS calendar year
    var taxYear = year - 1;
    var aprilDeadline = new Date(year, 3, 15); // April 15 of current year
    var daysToDeadline = Math.floor((aprilDeadline - today) / 86400000);
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (!flagSheet) return;

    rows.forEach(function(r) {
      var id       = r[0];
      var rowYear  = r[1];
      var formType = r[2];
      var issuer   = r[3];
      var status   = r[6] || 'not_received';
      if (!id || String(rowYear) !== String(taxYear)) return;

      var flagKey = 'tax_doc_' + id;
      // Check if flag already open
      var allFlags = flagSheet.getLastRow() > 1
        ? flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, 9).getValues()
        : [];
      var alreadyFlagged = allFlags.some(function(f) {
        return f[0] === flagKey && !f[6] && !f[7] && !f[8]; // not ack/snoozed/resolved
      });
      if (alreadyFlagged) return;

      // After Jan 31: flag any not_received
      var jan31 = new Date(year, 0, 31);
      if (today > jan31 && status === 'not_received') {
        var flagRow = [flagKey, new Date(), 'Tax', formType + ' from ' + issuer + ' not yet received (Tax Year ' + taxYear + ')', 'Document may be late or missing', 'Medium', '', '', ''];
        flagSheet.appendRow(flagRow);
      }

      // Within 30 days of April 15: flag anything not uploaded
      if (daysToDeadline > 0 && daysToDeadline <= 30 && status !== 'uploaded') {
        var urgency = daysToDeadline <= 7 ? 'High' : 'Medium';
        var flagRow2 = [flagKey + '_deadline', new Date(), 'Tax', 'Tax deadline in ' + daysToDeadline + ' days — ' + formType + ' from ' + issuer + ' not yet uploaded', 'File before April 15', urgency, '', '', ''];
        flagSheet.appendRow(flagRow2);
      }
    });
  } catch (err) {
    Logger.log('checkTaxDocuments_ error: ' + err.message);
  }
}

// ============================================================
// CONTRACT TRACKER — Issue #146
// ============================================================

/**
 * Reads active contracts and generates urgency-scaled flags for upcoming
 * expirations. Called from nightlyRun().
 *
 * Flag logic:
 *   - Within notice period (per-contract configurable, default 30 days) → Medium
 *   - Within 14 days → High
 *   - End date passed AND status still Active → High ("expired, no action logged")
 *
 * Uses flag key `contract_expiry_<id>` to prevent duplicate flags.
 */
function checkContracts_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONTRACTS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var tz      = Session.getScriptTimeZone();
  var today   = new Date(); today.setHours(0, 0, 0, 0);
  var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONTRACT_HEADERS.length).getValues();
  var flagsGenerated = 0;

  data.forEach(function(row) {
    var id            = String(row[0]).trim();
    var name          = String(row[1]).trim();
    var category      = String(row[2]).trim();
    var counterparty  = String(row[3]).trim();
    var endDateRaw    = row[5];
    var autoRenews    = String(row[6]).trim();
    var noticeDays    = parseInt(row[7], 10) || 30;
    var status        = String(row[9]).trim();

    if (!id || !name || status === 'Expired' || status === 'Terminated' || status === 'Renewed') return;
    if (!endDateRaw) return;

    var endDate = new Date(endDateRaw); endDate.setHours(0, 0, 0, 0);
    var daysUntil = Math.round((endDate - today) / 86400000);

    var urgency, flagText, reason;

    if (daysUntil < 0) {
      // Already expired but status not updated
      urgency  = 'High';
      flagText = 'Contract expired with no action: ' + name +
                 (counterparty ? ' (' + counterparty + ')' : '');
      reason   = 'End date was ' + Utilities.formatDate(endDate, tz, 'MMM d, yyyy') +
                 ' — status still shows Active. Log a renewal or termination.';
    } else if (daysUntil <= 14) {
      urgency  = 'High';
      flagText = 'Contract expiring in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's') + ': ' + name;
      reason   = (counterparty ? counterparty + ' · ' : '') + category +
                 (autoRenews === 'Yes' ? ' · auto-renews — shop around or let it roll?' :
                  autoRenews === 'No'  ? ' · does NOT auto-renew — action required' : '');
    } else if (daysUntil <= noticeDays) {
      urgency  = 'Medium';
      flagText = 'Contract notice window: ' + name + ' expires in ' + daysUntil + ' days';
      reason   = (counterparty ? counterparty + ' · ' : '') + category +
                 (autoRenews === 'Yes' ? ' · auto-renews — review or negotiate now' :
                  autoRenews === 'No'  ? ' · no auto-renewal — start renewal process' : '');
    } else {
      return; // not in any alert window
    }

    var flagKey = 'contract_expiry_' + id;

    // Check if this flag key already exists and is unresolved/unacknowledged
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() > 1) {
      var existing = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
      var alreadyOpen = existing.some(function(r) {
        return String(r[9]).trim() === flagKey &&
               String(r[6]).toLowerCase() !== 'yes' &&
               String(r[8]).toLowerCase() !== 'yes';
      });
      if (alreadyOpen) return;
    }

    writeFlags([{
      source:  'Contracts',
      flag:    flagText,
      reason:  reason,
      urgency: urgency,
      key:     flagKey
    }]);
    flagsGenerated++;
  });

  Logger.log('checkContracts_: ' + flagsGenerated + ' contract flag(s) generated.');
}

/**
 * Reads all contracts from the Contracts tab and returns enriched objects.
 * Used by WebApp and Chat context.
 */
function getContracts_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONTRACTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var tz    = Session.getScriptTimeZone();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONTRACT_HEADERS.length).getValues();

  return data.map(function(row, i) {
    var endDateRaw = row[5];
    var endDate    = endDateRaw ? new Date(endDateRaw) : null;
    var daysUntil  = endDate ? Math.round((endDate - today) / 86400000) : null;
    var noticeDays = parseInt(row[7], 10) || 30;
    var alertStatus;
    if (daysUntil === null) {
      alertStatus = 'OK';
    } else if (daysUntil < 0) {
      alertStatus = 'Expired';
    } else if (daysUntil <= 14) {
      alertStatus = 'Critical';
    } else if (daysUntil <= noticeDays) {
      alertStatus = 'Warning';
    } else {
      alertStatus = 'OK';
    }

    return {
      row:          i + 2,
      id:           String(row[0]).trim(),
      name:         String(row[1]).trim(),
      category:     String(row[2]).trim(),
      counterparty: String(row[3]).trim(),
      startDate:    row[4] ? Utilities.formatDate(new Date(row[4]), tz, 'yyyy-MM-dd') : '',
      endDate:      endDate ? Utilities.formatDate(endDate, tz, 'yyyy-MM-dd') : '',
      autoRenews:   String(row[6]).trim(),
      noticeDays:   noticeDays,
      monthlyCost:  row[8] !== '' ? Number(row[8]) : null,
      status:       String(row[9]).trim() || 'Active',
      docLink:      String(row[10]).trim(),
      notes:        String(row[11]).trim(),
      daysUntil:    daysUntil,
      alertStatus:  alertStatus
    };
  }).filter(function(c) { return c.id; });
}

// ============================================================
// CAPACITY MODE — Issue #8
// ============================================================

/**
 * Infers tomorrow's capacity mode (busy / normal / light) by scoring the
 * calendar load. Stores result in Script Properties so morningNudge() and
 * Chat can read it. Called nightly from nightlyRun().
 *
 * Scoring:
 *   busy   — >4 meetings OR >5h blocked OR majority back-to-back
 *   light  — <2 meetings AND mostly clear  (also: active trip, Friday)
 *   normal — everything else
 */
function inferCapacityMode_() {
  var tz       = Session.getScriptTimeZone();
  var now      = new Date();
  var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  var dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  // Friday nudge toward light
  var isFriday = (tomorrow.getDay() === 5);

  // Trip active → auto-light (check PTO config)
  var tripActive = false;
  try {
    var ptoCfg = readPTOConfig_();
    var trips  = ptoCfg.vacationBlocks || [];
    var tomorrowStr = Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd');
    trips.forEach(function(t) {
      if (tomorrowStr >= t.start && tomorrowStr <= t.end) tripActive = true;
    });
  } catch (e) { /* non-fatal */ }

  if (tripActive) {
    PropertiesService.getScriptProperties().setProperties({
      capacity_inferred_mode: 'light',
      capacity_inferred_date: Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd')
    });
    Logger.log('inferCapacityMode_: light (trip active)');
    return;
  }

  // Count tomorrow's calendar events
  var meetings      = 0;
  var totalMinutes  = 0;
  var prevEnd       = null;
  var backToBackCnt = 0;
  var timedEvents   = [];

  try {
    var allCals = CalendarApp.getAllCalendars();
    allCals.forEach(function(cal) {
      var evts = cal.getEvents(tomorrow, dayEnd);
      evts.forEach(function(ev) {
        if (ev.isAllDayEvent()) return;
        meetings++;
        var dur = (ev.getEndTime() - ev.getStartTime()) / 60000; // minutes
        totalMinutes += dur;
        timedEvents.push({ start: ev.getStartTime(), end: ev.getEndTime() });
      });
    });
  } catch (calErr) {
    Logger.log('inferCapacityMode_: calendar error (non-fatal) — ' + calErr.message);
  }

  // Sort timed events by start and detect back-to-back (gap < 15 min)
  timedEvents.sort(function(a, b) { return a.start - b.start; });
  timedEvents.forEach(function(ev) {
    if (prevEnd !== null) {
      var gapMin = (ev.start - prevEnd) / 60000;
      if (gapMin < 15) backToBackCnt++;
    }
    prevEnd = ev.end;
  });
  var backToBackMajority = timedEvents.length > 1 && backToBackCnt >= Math.ceil(timedEvents.length / 2);

  var totalHours = totalMinutes / 60;
  var mode;
  if (meetings > 4 || totalHours > 5 || backToBackMajority) {
    mode = 'busy';
  } else if (meetings < 2 || isFriday) {
    mode = 'light';
  } else {
    mode = 'normal';
  }

  PropertiesService.getScriptProperties().setProperties({
    capacity_inferred_mode: mode,
    capacity_inferred_date: Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd')
  });
  Logger.log('inferCapacityMode_: ' + mode + ' (' + meetings + ' meetings, ' + totalHours.toFixed(1) + 'h, b2b:' + backToBackCnt + ', friday:' + isFriday + ')');
}

/**
 * Returns today's effective capacity mode and its source.
 * Override beats inferred if the override date equals today.
 * Returns { mode: 'busy'|'normal'|'light', source: 'override'|'inferred'|'default' }
 */
function getCapacityMode_() {
  var tz      = Session.getScriptTimeZone();
  var today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var props   = PropertiesService.getScriptProperties();
  var overrideMode = props.getProperty('capacity_override_mode') || '';
  var overrideDate = props.getProperty('capacity_override_date') || '';
  var inferredMode = props.getProperty('capacity_inferred_mode') || '';
  var inferredDate = props.getProperty('capacity_inferred_date') || '';

  if (overrideMode && overrideDate === today) {
    return { mode: overrideMode, source: 'override' };
  }
  if (inferredMode && inferredDate === today) {
    return { mode: inferredMode, source: 'inferred' };
  }
  return { mode: 'normal', source: 'default' };
}

/**
 * Sends a branded HTML morning email if there are unacknowledged flags.
 * Includes VERA logo (loaded from Drive via VERA_LOGO_FILE_ID script property),
 * urgency breakdown, and a plain-text fallback.
 * Sender display name is set to "VERA".
 */
function morningNudge() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.FLAGS);

    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('Morning nudge: no flags found, skipping email.');
      return;
    }

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    // Active = not acknowledged AND not resolved
    const active = data.filter(function(row) {
      const acknowledged = String(row[6]).toLowerCase();
      const resolved     = String(row[8]).toLowerCase();
      return acknowledged !== 'yes' && resolved !== 'yes';
    });

    if (active.length === 0) {
      Logger.log('Morning nudge: no active flags, skipping email.');
      return;
    }

    // ---- Capacity mode filtering (Issue #8) ---------------------------------
    var capacityInfo = getCapacityMode_();
    var capMode      = capacityInfo.mode;   // 'busy' | 'normal' | 'light'
    var capSource    = capacityInfo.source; // 'override' | 'inferred' | 'default'

    // Helper: is a flag time-sensitive today?
    // Checks flag text / key for date-bound phrases so Low-urgency birthdays etc. aren't suppressed.
    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    function isTimeSensitiveToday_(row) {
      var text = (String(row[3]) + ' ' + String(row[4]) + ' ' + String(row[9])).toLowerCase();
      return text.indexOf('today') !== -1 ||
             text.indexOf('birthday') !== -1 ||
             text.indexOf('due today') !== -1 ||
             text.indexOf('arriving today') !== -1 ||
             text.indexOf(todayStr) !== -1;
    }

    var surfaced;
    var heldCount = 0;
    if (capMode === 'busy') {
      surfaced  = active.filter(function(r) { return r[5] === 'High' || isTimeSensitiveToday_(r); });
      heldCount = active.length - surfaced.length;
    } else if (capMode === 'normal') {
      surfaced  = active.filter(function(r) { return r[5] === 'High' || r[5] === 'Medium'; });
      heldCount = active.length - surfaced.length;
    } else {
      surfaced  = active;   // light: show everything
    }

    // If capacity filtering left nothing to show, fall back to showing all
    if (surfaced.length === 0) {
      surfaced  = active;
      heldCount = 0;
    }

    const total     = surfaced.length;
    const highCount = surfaced.filter(function(r) { return r[5] === 'High';   }).length;
    const medCount  = surfaced.filter(function(r) { return r[5] === 'Medium'; }).length;
    const lowCount  = surfaced.filter(function(r) { return r[5] === 'Low';    }).length;

    const subject = 'Good morning, Ahmed — VERA has ' + total + (total === 1 ? ' thing' : ' things') + ' for your attention';

    // ---- Build urgency rows for HTML ------------------------------------
    function urgencyRow(color, dot, label, count) {
      return count > 0
        ? '<tr><td style="padding:6px 0;">' +
            '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + color + ';margin-right:10px;vertical-align:middle;"></span>' +
            '<span style="font-size:15px;color:#333333;vertical-align:middle;">' + label + ': <strong>' + count + '</strong></span>' +
          '</td></tr>'
        : '';
    }

    const urgencyRows =
      urgencyRow('#e53935', '●', 'High priority',   highCount) +
      urgencyRow('#f9a825', '●', 'Medium priority', medCount)  +
      urgencyRow('#43a047', '●', 'Low priority',    lowCount);

    // ---- Try to load logo from Drive ------------------------------------
    let inlineImages = {};
    let logoTag = '';
    try {
      const logoFileId = PropertiesService.getScriptProperties().getProperty('VERA_LOGO_FILE_ID');
      if (logoFileId) {
        const logoBlob = DriveApp.getFileById(logoFileId).getBlob();
        inlineImages = { veraLogo: logoBlob };
        logoTag = '<img src="cid:veraLogo" alt="VERA" style="width:100%;display:block;border:0;" />';
      }
    } catch (logoErr) {
      Logger.log('Logo load failed (continuing without it): ' + logoErr);
    }

    // ---- Optional dashboard button (set VERA_DASHBOARD_URL in Script Properties) ----
    const dashboardUrl = PropertiesService.getScriptProperties().getProperty('VERA_DASHBOARD_URL') || '';
    const dashboardBtn = dashboardUrl
      ? '<tr><td style="padding:0 0 24px 0;">' +
          '<a href="' + dashboardUrl + '" style="display:inline-block;background:#0d1b3e;color:#c9a84c;font-size:14px;font-weight:700;letter-spacing:1px;padding:12px 28px;border-radius:6px;text-decoration:none;border:2px solid #c9a84c;">Open VERA Dashboard &rarr;</a>' +
        '</td></tr>'
      : '';
    const dashboardPlainText = dashboardUrl ? '\nDashboard: ' + dashboardUrl : '';
    const veraLink = dashboardUrl || 'https://aeraky1565.github.io/VERA-My-Chief-of-Staff/';

    // ---- Weather ticker (graceful — empty string if not configured) -----
    const weatherTicker = getWeatherTicker_();

    // ---- Today's calendar events ----------------------------------------
    let todayEvents = [];
    try {
      todayEvents = getUpcomingEvents().filter(function(e) { return e.daysUntil === 0; }).slice(0, 5);
    } catch (calErr) { Logger.log('morningNudge: calendar fetch error — ' + calErr.message); }

    let calendarSection = '';
    if (todayEvents.length > 0) {
      const calRows = todayEvents.map(function(e) {
        const timeStr = e.isAllDay ? 'All day' : (e.start.split(' ')[1] || '');
        const calName = e.calLabel || e.calendarName || '';
        const detail  = [timeStr, calName].filter(Boolean).join(' · ');
        return '<p style="margin:0 0 5px;font-size:14px;color:#444444;">' +
               '<strong>' + e.title + '</strong>' +
               (detail ? ' <span style="color:#888888;font-size:13px;">· ' + detail + '</span>' : '') +
               '</p>';
      }).join('');
      calendarSection =
        '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">' +
        '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">📅 Today</p>' +
        calRows +
        '</div>';
    } else {
      calendarSection =
        '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">' +
        '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">📅 Today</p>' +
        '<p style="margin:0;font-size:14px;color:#aaaaaa;font-style:italic;">Nothing on the calendar today.</p>' +
        '</div>';
    }

    // ---- Tasks: overdue + due today count -------------------------------
    let overdueCount   = 0;
    let dueTodayCount  = 0;
    try {
      const openTasks = getOpenTasks();
      overdueCount  = openTasks.filter(function(t) { return t.isOverdue; }).length;
      dueTodayCount = openTasks.filter(function(t) { return !t.isOverdue && t.daysUntilDue === 0; }).length;
    } catch (taskErr) { Logger.log('morningNudge: task fetch error — ' + taskErr.message); }

    // Google Tasks counts (Issue #99)
    let gOverdueCount  = 0;
    let gDueTodayCount = 0;
    try {
      const gRes = webGetGoogleTasks_();
      const gTasks = (gRes && gRes.tasks) || [];
      gOverdueCount  = gTasks.filter(function(t) { return t.isOverdue; }).length;
      gDueTodayCount = gTasks.filter(function(t) { return !t.isOverdue && t.daysUntilDue === 0; }).length;
    } catch (gTaskErr) { Logger.log('morningNudge: Google Tasks fetch error (non-fatal) — ' + gTaskErr.message); }
    const totalOverdue   = overdueCount  + gOverdueCount;
    const totalDueToday  = dueTodayCount + gDueTodayCount;

    let taskBadges = '';
    if (totalOverdue > 0 || totalDueToday > 0) {
      taskBadges = '<div style="margin-top:14px;">';
      if (totalOverdue > 0) {
        taskBadges += '<span style="display:inline-block;background:#fdecea;color:#c62828;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-right:8px;">⚠ ' + totalOverdue + ' overdue</span>';
      }
      if (totalDueToday > 0) {
        taskBadges += '<span style="display:inline-block;background:#fff8e1;color:#e65100;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">📋 ' + totalDueToday + ' due today</span>';
      }
      taskBadges += '</div>';
    }

    // ---- Morning Intelligence section (Issue #24) -------------------------
    let intelligenceSection = '';
    try {
      intelligenceSection = buildMorningIntelligence_();
    } catch (intErr) {
      Logger.log('morningNudge: buildMorningIntelligence_ error (non-fatal) — ' + intErr.message);
    }

    // ---- Guest arriving soon ticker (Issue #150) ----------------------------
    var guestTicker = '';
    try {
      var guestCfg  = readPTOConfig_();
      var guestList = getUpcomingGuests_(guestCfg);
      var arriving  = guestList.filter(function(g) { return g.daysAway >= 0 && g.daysAway <= 7; });
      if (arriving.length > 0) {
        var guestItems = arriving.map(function(g) {
          return '<tr><td style="padding:4px 0;font-size:14px;color:#333333;">' +
                 (g.daysAway === 0 ? '🏠 <strong>Guests arriving today:</strong> ' :
                  g.daysAway === 1 ? '🏠 <strong>Guests arriving tomorrow:</strong> ' :
                  '🏠 <strong>Guests in ' + g.daysAway + ' days:</strong> ') +
                 g.label + ' (' + g.arrivalDate + ' – ' + g.departureDate + ')' +
                 '</td></tr>';
        }).join('');
        guestTicker = '<table cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-left:3px solid #c9a84c;padding-left:12px;">' + guestItems + '</table>';
      }
    } catch (guestErr) {
      Logger.log('morningNudge: guest ticker error (non-fatal) — ' + guestErr.message);
    }

    // ---- Capacity mode ticker (Issue #8) ------------------------------------
    var capacityTicker = (function() {
      var dot, label, subLabel;
      var meetCount = 0;
      try {
        meetCount = getUpcomingEvents().filter(function(e) {
          return e.daysUntil === 0 && !e.isAllDay;
        }).length;
      } catch (e) { /* non-fatal */ }

      if (capMode === 'busy') {
        dot = '🔴';
        label = capSource === 'override'
          ? 'Busy day (you said so)'
          : 'Busy day (calendar load)';
        subLabel = meetCount + ' meeting' + (meetCount !== 1 ? 's' : '') +
                   ' · High-priority + time-sensitive only' +
                   (heldCount > 0 ? ' · <strong>' + heldCount + ' flag' + (heldCount !== 1 ? 's' : '') + ' held</strong>' : '');
      } else if (capMode === 'normal') {
        dot = '🟡';
        label = 'Normal day';
        subLabel = meetCount + ' meeting' + (meetCount !== 1 ? 's' : '') +
                   ' · showing High + Medium' +
                   (heldCount > 0 ? ' · <strong>' + heldCount + ' Low flag' + (heldCount !== 1 ? 's' : '') + ' held</strong>' : '');
      } else {
        dot = '🟢';
        label = 'Light day';
        subLabel = meetCount + ' meeting' + (meetCount !== 1 ? 's' : '') +
                   ' · surfacing all ' + total + ' flag' + (total !== 1 ? 's' : '');
      }

      return '<div style="margin-bottom:20px;padding:10px 14px;background:#f7f7fa;border-radius:6px;border-left:4px solid ' +
             (capMode === 'busy' ? '#e53935' : capMode === 'normal' ? '#f9a825' : '#43a047') + ';">' +
             '<span style="font-size:14px;font-weight:600;color:#333333;">' + dot + ' ' + label + '</span>' +
             '<span style="font-size:13px;color:#777777;margin-left:10px;">' + subLabel + '</span>' +
             '</div>';
    })();

    // ---- HTML body ------------------------------------------------------
    const htmlBody =
      '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5;padding:24px 0;">' +
      '<tr><td align="center">' +
      '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">' +

      // Logo header
      (logoTag
        ? '<tr><td style="padding:0;background:#0d1b3e;">' + logoTag + '</td></tr>'
        : '<tr><td style="padding:24px 40px;background:#0d1b3e;text-align:center;"><span style="color:#ffffff;font-size:28px;font-weight:bold;letter-spacing:4px;">VERA</span><br><span style="color:#c9a84c;font-size:11px;letter-spacing:2px;">YOUR PERSONAL CHIEF OF STAFF</span></td></tr>') +

      // Weather ticker (empty string → nothing rendered)
      weatherTicker +

      // Body
      '<tr><td style="padding:36px 40px;">' +
      '<p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#0d1b3e;">Good morning, Ahmed.</p>' +
      '<p style="margin:0 0 16px;font-size:15px;color:#555555;">VERA flagged <strong>' + total + ' item' + (total === 1 ? '' : 's') + '</strong> overnight requiring your attention.</p>' +
      capacityTicker +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">' + urgencyRows + '</table>' +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">' + dashboardBtn + '</table>' +
      guestTicker +
      calendarSection +
      taskBadges +
      intelligenceSection +
      '</td></tr>' +

      // Footer
      '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;">' +
      '<p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">Sent by VERA &mdash; Virtual Executive &amp; Reminder Assistant</p>' +
      '</td></tr>' +

      '</table></td></tr></table></body></html>';

    // ---- Plain text fallback --------------------------------------------
    const calPlainText = todayEvents.length > 0
      ? '\nToday:\n' + todayEvents.map(function(e) {
          const t = e.isAllDay ? 'All day' : (e.start.split(' ')[1] || '');
          return '  ' + e.title + (t ? ' · ' + t : '');
        }).join('\n')
      : '';
    const taskPlainText = (totalOverdue > 0 || totalDueToday > 0)
      ? '\nTasks: ' +
        (totalOverdue  > 0 ? totalOverdue  + ' overdue'   : '') +
        (totalOverdue  > 0 && totalDueToday > 0 ? ' · ' : '') +
        (totalDueToday > 0 ? totalDueToday + ' due today' : '')
      : '';

    var capPlainLabel = capMode === 'busy'
      ? (capSource === 'override' ? '🔴 Busy day (you said so)' : '🔴 Busy day (calendar load)')
      : capMode === 'normal' ? '🟡 Normal day' : '🟢 Light day';
    var capPlainLine = capPlainLabel + (heldCount > 0 ? ' · ' + heldCount + ' flag(s) held' : '');

    const plainText = [
      'Good morning, Ahmed.',
      '',
      capPlainLine,
      '',
      'VERA flagged ' + total + (total === 1 ? ' item' : ' items') + ' overnight:',
      '',
      highCount > 0 ? '  High priority:   ' + highCount : '',
      medCount  > 0 ? '  Medium priority: ' + medCount  : '',
      lowCount  > 0 ? '  Low priority:    ' + lowCount  : '',
      calPlainText,
      taskPlainText,
      '',
      'Open VERA: ' + veraLink,
      dashboardPlainText,
      '',
      '— VERA',
    ].filter(function(l) { return l !== false; }).join('\n');

    // ---- Send -----------------------------------------------------------
    const mailOptions = {
      name:        'VERA',
      htmlBody:    htmlBody,
      inlineImages: inlineImages,
    };

    MailApp.sendEmail(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions);
    Logger.log('Morning nudge sent (HTML): ' + total + ' active flags.');

  } catch (e) {
    Logger.log('morningNudge ERROR: ' + e.message);
  }
}

// ============================================================
// ONE-TIME MIGRATIONS — Run each once after deploying the relevant update
// ============================================================

/**
 * Creates the Metrics tab (with headers) for users who ran setupVERA() before
 * the Metrics/Summaries split was introduced. Safe to re-run.
 *
 * After running this, the nightly run will automatically:
 *   - Write auto-counts (Tasks/Calendar/Flags) into the new Metrics tab
 *   - Clear the old [AUTO] rows from the Summaries tab (which now holds external data)
 */
function addMetricsTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.METRICS, METRIC_HEADERS);
  Logger.log('✅ Metrics tab created (or already exists). Run testRun() to populate it.');
}

/**
 * Creates the Projects tab for users who ran setupVERA() before Phase 6.
 * Run once from the Apps Script editor after pushing this update.
 */
function addProjectsTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PROJECTS, PROJECT_HEADERS);
  Logger.log('✅ Projects tab created (or already exists).');
}

/**
 * Creates the PTO tab for users who ran setupVERA() before Issue #19.
 * Run once from the Apps Script editor after pushing this update.
 */
function addPTOTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PTO, PTO_HEADERS);
  Logger.log('✅ PTO tab created (or already exists). Seed Config tab with pto_* rows, then run testPTO().');
}

/**
 * Migration helper — run once from Apps Script editor to create the PTO Memory tab.
 * Safe to re-run; ensureSheet() is idempotent.
 */
function addPTOMemoryTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PTO_MEMORY, PTO_MEMORY_HEADERS);
  Logger.log('✅ PTO Memory tab created (or already exists). Stateful PTO suggestions are now active.');
}

/**
 * Migration helper — run once from Apps Script editor to seed PTO config rows.
 * Issue #49: Adds pto_vacation_days, pto_rollover_days, and other PTO settings
 * to the Config tab so they are visible and editable without hunting through code.
 * Safe to re-run — skips rows that already exist.
 */
function addPTOConfig() {
  var ss  = getSpreadsheet();
  var sh  = ss.getSheetByName(TABS.CONFIG);
  if (!sh) { Logger.log('Config tab not found.'); return; }

  var rows = [
    ['pto_calendar_name',          'Verizon Calendar'],
    ['pto_vera_calendar',          'Vera'],
    ['pto_vacation_days',          '20'],   // annual vacation allocation (days)
    ['pto_personal_hours',         '48'],   // annual personal time (hours)
    ['pto_rollover_days',          '0'],    // days carried over from prior year
    ['pto_buffer_days',            '3'],    // reserve days held back from planning
    ['pto_year',                   String(new Date().getFullYear())],
    ['gap_calendars',              'Verizon Calendar'],
    ['milestone_keywords',         'Wedding,Graduation,Trip,Travel,Concert,Birthday'],
    ['holiday_keywords',           'Day,Holiday,Floating,Closure'],
    ['ignore_keywords',            'Pay Day'],
    ['pto_guest_keywords',         'Visit,Staying,Guests'],  // keywords to identify guest events in gap calendars (Issue #150)
  ];

  var existing = sh.getDataRange().getValues()
    .map(function(r) { return String(r[0]).trim(); });

  var added = 0;
  rows.forEach(function(row) {
    if (existing.indexOf(row[0]) === -1) {
      sh.appendRow(row);
      added++;
    }
  });
  Logger.log('✅ addPTOConfig: added ' + added + ' row(s) (skipped ' + (rows.length - added) + ' already present).');
}

/**
 * Creates the Reminders Memory tab for users who ran setupVERA() before Issue #26.
 * Safe to re-run — ensureSheet() is idempotent.
 */
function addRemindersMemoryTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.REMINDERS_MEMORY, REMINDERS_MEMORY_HEADERS);
  Logger.log('✅ Reminders Memory tab created (or already exists). Run setupTriggers() to install the hourlyCheck trigger.');
}

/**
 * Creates the Shared Interests tab for users who ran setupVERA() before Issue #28.
 * Safe to re-run — ensureSheet() is idempotent.
 */
function addInterestLedgerTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.INTEREST_LEDGER, INTEREST_LEDGER_HEADERS);
  Logger.log('✅ Shared Interests tab created (or already exists). VERA will now track Ahmed & Victoria\'s interests.');
}

/**
 * Adds the "Key" header to Column J of the Flags tab.
 * Run this ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — checks if the column already exists before writing.
 */
function addKeyColumnToFlags() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet) throw new Error('Flags tab not found.');

  // Check if Key column already exists at Column J
  if (sheet.getLastColumn() >= 10) {
    const existingHeader = String(sheet.getRange(1, 10).getValue()).trim();
    if (existingHeader === 'Key') {
      Logger.log('Key column already exists at Column J — nothing to do.');
      return;
    }
  }

  sheet.getRange(1, 10)
    .setValue('Key')
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  Logger.log('✅ "Key" column added to Flags tab (Column J). Dedup will now use stable keys from Claude.');
}

// ============================================================
// MIGRATION — Weekend Planner Config (Issue #20)
// ============================================================

/**
 * Seeds the Config tab with Weekend Planner default settings.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips any key that already exists.
 */
function addWeekendPlannerConfig() {
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found.');

  const defaults = [
    ['weekend_planner_enabled',       'true'],
    ['weekend_planner_lookahead_days', '21'],
    ['weekend_planner_hour',           '8'],
    ['weekend_planner_home_city',      'Austin, TX'],
  ];

  // Read existing keys so we don't overwrite manual edits
  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  defaults.forEach(function(pair) {
    if (!existing.has(pair[0])) {
      sheet.appendRow(pair);
      added++;
    }
  });

  Logger.log('✅ addWeekendPlannerConfig: added ' + added + ' row(s). ' +
             (added < defaults.length ? (defaults.length - added) + ' row(s) already existed.' : ''));
}

// ============================================================
// MIGRATION — Finance Config
// ============================================================

/**
 * Seeds the Config tab with Finance default settings.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips any key that already exists.
 *
 * To customise which categories are excluded from the spending pivot,
 * edit the 'finance_skip_categories' row in the Config tab directly.
 * Values are comma-separated and matched case-insensitively.
 */
function addFinanceConfig() {
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found.');

  const defaults = [
    [
      'finance_skip_categories',
      'Income,Paycheck,Salary,Direct Deposit,Transfer,Transfers,' +
      'Credit Card Payment,Credit Card Payments,Payment,' +
      'Investments,Investment Income,Savings,Refund,Securities Trades',
    ],
  ];

  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  defaults.forEach(function(pair) {
    if (!existing.has(pair[0])) {
      sheet.appendRow(pair);
      added++;
    }
  });

  Logger.log('✅ addFinanceConfig: added ' + added + ' row(s). ' +
             (added < defaults.length ? (defaults.length - added) + ' already existed.' : ''));
}

// ============================================================
// MIGRATION — Weather Ticker Config (Issue #12)
// ============================================================

/**
 * Seeds the Config tab with the weather_location row introduced in Issue #12.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips the row if it already exists.
 *
 * After running:
 *   1. Set weather_location value in the Config tab (e.g. "Austin, TX")
 *   2. Set WEATHER_API_KEY in Apps Script → Project Settings → Script Properties
 *      (free key from openweathermap.org)
 */
function addWeatherConfig() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) { Logger.log('Config tab not found.'); return; }

  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  if (!existing.has('weather_location')) {
    sheet.appendRow(['weather_location', '']);
    added++;
  }

  Logger.log('✅ addWeatherConfig: added ' + added + ' row(s). ' +
             'Set the weather_location value and WEATHER_API_KEY Script Property to enable the weather ticker.');
}

// ============================================================
// DIAGNOSTIC — Calendar names for Config tab setup
// ============================================================

/**
 * Run this ONCE from the Apps Script editor (not from the dashboard).
 * Check the Execution Log to see the exact name and ID for every calendar
 * on your account — use these values in the Config tab's bill_calendars row.
 *
 * Example output:
 *   [Cal 1] name="aaeleraky@gmail.com"  id="aaeleraky@gmail.com"  owned=true
 *   [Cal 2] name="AE&VV - Our Joint Chaos"  id="abc123@group.calendar.google.com"  owned=true
 *
 * TIP: If you want to scan ALL calendars, just delete or blank out the
 *      bill_calendars row in your Config tab — no filtering will be applied.
 */
function listCalendarsForConfig() {
  var cals = CalendarApp.getAllCalendars();
  Logger.log('=== ' + cals.length + ' calendars found ===');
  cals.forEach(function(cal, i) {
    Logger.log('[Cal ' + (i + 1) + ']' +
      '  name="'  + cal.getName()          + '"' +
      '  id="'    + cal.getId()            + '"' +
      '  owned='  + cal.isOwnedByMe()      +
      '  color='  + cal.getColor());
  });
  Logger.log('=== Copy the "name" values (or "id" values) into Config tab bill_calendars, comma-separated ===');
}

// ============================================================
// MIGRATION — Bills Type column (Cashflow feature)
// ============================================================

/**
 * Adds a 'Type' header to column I of the Bills tab (col 9).
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips if the column already exists.
 *
 * Existing bills default to blank which is treated as 'Expense'.
 * After running, use the "+ Add Bill" modal to add Income entries
 * (e.g. Victoria's bi-weekly paycheck).
 */
function addBillTypeColumn() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet) { Logger.log('Bills tab not found. Run setupVERA() first.'); return; }

  var lastCol = sheet.getLastColumn();
  if (lastCol >= 9) {
    var existing = String(sheet.getRange(1, 9).getValue()).trim();
    if (existing === 'Type') {
      Logger.log('addBillTypeColumn: Type column already exists — no action needed.');
      return;
    }
  }
  sheet.getRange(1, 9).setValue('Type');
  Logger.log('✅ addBillTypeColumn: Type column added to Bills tab (col I). Existing rows default to Expense.');
}

// ============================================================
// CHORES — Nightly reset by cadence (Issue #124)
// ============================================================

/**
 * Resets household chore checkboxes based on cadence.
 * Called from nightlyRun().
 *   Daily     — reset every night
 *   Weekly    — reset on Friday nights
 *   Biweekly  — reset on even ISO-week Friday nights
 *   Monthly   — reset on last day of the month
 *   Seasonal  — never auto-reset
 */
function resetChoresByCadence_() {
  var now    = new Date();
  var dow    = now.getDay();   // 0=Sun … 6=Sat
  var dom    = now.getDate();
  var lastDom = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // ISO week number
  var d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);

  var isFriday          = (dow === 5);
  var isBiweeklyFriday  = isFriday && (weekNum % 2 === 0);
  var isLastDayOfMonth  = (dom === lastDom);

  var toReset = ['Daily'];
  if (isFriday)         toReset.push('Weekly');
  if (isBiweeklyFriday) toReset.push('Biweekly');
  if (isLastDayOfMonth) toReset.push('Monthly');

  var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(TABS.CHORES);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('resetChoresByCadence_: no chores found — skipping.');
    return;
  }

  var rows  = sheet.getDataRange().getValues();
  var hdrs  = rows[0];
  var cadIdx     = hdrs.indexOf('Cadence');
  var checkedIdx = hdrs.indexOf('Checked');
  if (cadIdx === -1 || checkedIdx === -1) return;

  var resetCount = 0;
  for (var i = 1; i < rows.length; i++) {
    var cadence = String(rows[i][cadIdx] || '');
    if (toReset.indexOf(cadence) !== -1 && rows[i][checkedIdx]) {
      sheet.getRange(i + 1, checkedIdx + 1).setValue(false);
      resetCount++;
    }
  }
  Logger.log('resetChoresByCadence_: reset ' + resetCount + ' chore(s). Cadences: ' + toReset.join(', '));
}

// ============================================================
// NOTES — Google Doc-backed note storage (Issue #167)
// ============================================================

/**
 * Returns the Notes Doc ID from Config tab (notes_doc_id).
 */
function getNotesDocId_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found');
  var data  = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'notes_doc_id') {
      var id = String(data[i][1]).trim();
      if (id) return id;
    }
  }
  throw new Error('notes_doc_id not set in Config tab. Create a Google Doc and paste its ID there.');
}

/**
 * Opens the VERA Notes Google Doc.
 */
function getNotesDoc_() {
  return DocumentApp.openById(getNotesDocId_());
}

/**
 * Returns the single notes table from the Doc body, creating it if absent.
 * No REST API or GCP project setup required — plain DocumentApp only.
 * @param {string} docId
 * @returns {GoogleAppsScript.Document.Table}
 */
function getNotesTable_(docId) {
  var body   = DocumentApp.openById(docId).getBody();
  var tables = body.getTables();
  if (tables.length) return tables[0];
  // First use: seed the table with the header row
  return body.appendTable([NOTES_DOC_HEADERS]);
}

/**
 * Reads all rows from the Notes Doc table. Returns array of note objects.
 * Category is stored as col 7 in each row.
 * @param {string} docId
 * @returns {Array}
 */
function readAllNotes_(docId) {
  var table   = getNotesTable_(docId);
  var notes   = [];
  var numRows = table.getNumRows();
  for (var r = 1; r < numRows; r++) {  // skip header row 0
    var row = table.getRow(r);
    var id  = row.getCell(0).getText().trim();
    if (!id) continue;
    notes.push({
      id:        id,
      dateAdded: row.getCell(1).getText().trim(),
      title:     row.getCell(2).getText().trim(),
      content:   row.getCell(3).getText().trim(),
      tags:      row.getCell(4).getText().trim(),
      relatedTo: row.getCell(5).getText().trim(),
      pinned:    row.getCell(6).getText().trim() === 'true',
      category:  row.getCell(7).getText().trim() || 'General',
      rowIndex:  r
    });
  }
  return notes;
}

/**
 * One-time setup: ensures the Notes Doc has its header table.
 * Safe to run multiple times. No REST API required.
 */
function setupNotesDoc() {
  getNotesTable_(getNotesDocId_());
  Logger.log('setupNotesDoc complete — header table ready.');
}

// ============================================================
// MANUAL TEST — Call this to do a full dry run before going live
// ============================================================

/**
 * Run this from the Apps Script editor to test the full pipeline manually.
 * Check the Execution Log and the Flags tab in your sheet after running.
 */
function testRun() {
  Logger.log('=== VERA MANUAL TEST RUN ===');
  nightlyRun();
  Logger.log('=== TEST RUN COMPLETE — check Flags tab and Execution Log above ===');
}
