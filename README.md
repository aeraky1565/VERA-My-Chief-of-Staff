# VERA — Virtual Executive & Reminder Assistant

> Your personal chief of staff, built on Google Apps Script + Claude AI.

VERA runs silently in the background of your life. Every night at 11 PM it reads your Google Calendar, Tasks, finances, PTO balance, travel plans, health appointments, career wins, shared interests, household chores, contracts, and more — then calls Claude AI to generate a prioritised list of flags. At 7 AM it delivers a morning briefing to your inbox. A React dashboard and full conversational chat interface let you view, manage, and act on every domain of your life in plain English. Slack integration brings real-time bidirectional chat and rich Block Kit notifications to your phone.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Dashboard Tabs](#dashboard-tabs)
3. [Chat Interface](#chat-interface)
4. [Chat Actions](#chat-actions)
5. [Intelligence & Proactive Features](#intelligence--proactive-features)
6. [Nightly Pipeline](#nightly-pipeline)
7. [Triggers](#triggers)
8. [Flag System](#flag-system)
9. [Travel Module](#travel-module)
10. [Finance Module](#finance-module)
11. [Health & Wellness Module](#health--wellness-module)
12. [People & Relationships Module](#people--relationships-module)
13. [Career Module](#career-module)
14. [Home Front Module](#home-front-module)
15. [Slack Integration](#slack-integration)
16. [Data Model — Sheet Tabs](#data-model--sheet-tabs)
17. [Config Tab Reference](#config-tab-reference)
18. [Script Properties Reference](#script-properties-reference)
19. [Calendar Event Prefixes](#calendar-event-prefixes)
20. [Dashboard API Reference](#dashboard-api-reference)
21. [File Structure](#file-structure)
22. [Setup & Deployment](#setup--deployment)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Google Apps Script                         │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Calendar │  │  Tasks   │  │ Finance  │  │  Health/Travel/  │   │
│  │   .js    │  │   .js    │  │   .js    │  │  PTO/Career...   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │              │                  │             │
│       └──────────────┴──────────────┴──────────────────┘           │
│                                 │                                   │
│                          ┌──────▼──────┐                           │
│                          │  Code.js    │  nightlyRun() 11pm         │
│                          │  (17 steps) │                           │
│                          └──────┬──────┘                           │
│                                 │                                   │
│              ┌──────────────────┼──────────────────┐               │
│              │                  │                  │               │
│       ┌──────▼──────┐   ┌───────▼──────┐   ┌──────▼──────┐        │
│       │  Claude.js  │   │ Summaries.js │   │  WebApp.js  │        │
│       │ (AI engine) │   │ (metrics)    │   │ (JSON API)  │        │
│       └──────┬──────┘   └──────────────┘   └──────┬──────┘        │
│              │                                      │               │
│       ┌──────▼──────┐                       ┌──────▼──────┐        │
│       │  Flags tab  │                       │  React dash │        │
│       │  (Sheets)   │                       │  (Netlify)  │        │
│       └─────────────┘                       └─────────────┘        │
│                                                                     │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐    │
│  │  Reminders   │  │  Slack.js      │  │  PatternRecognition  │    │
│  │  hourlyCheck │  │  3 channels    │  │  7 compound patterns │    │
│  └──────────────┘  └────────────────┘  └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **All state lives in Google Sheets.** No external database. Every tab is readable and editable by hand, which makes debugging trivial and data portable.
- **Claude is called once per nightly run** for flag generation (not per sub-module), keeping API costs predictable. Individual sub-modules (chat, packing, weekend planner, etc.) make their own targeted calls.
- **All GET endpoints** — even mutating actions like acknowledge/snooze/resolve — use HTTP GET to avoid CORS preflight. The React dashboard uses `fetch` from a static file served from Netlify.
- **Secret-free code.** Every credential (API key, sheet ID, email, tokens) lives in Script Properties, never in source files.

---

## Dashboard Tabs

The React dashboard groups functionality into tabs and sub-tabs. All data is fetched from the Apps Script Web App endpoint.

| Tab | Sub-tab / Section | What it does |
|-----|-------------------|--------------|
| **Overview** | Flags | Active/snoozed/resolved flags with urgency colour-coding; acknowledge/snooze/resolve buttons |
| **Overview** | Status bar | Flag counts (High/Med/Low), last run date, weather ticker, pacing mode indicator |
| **Tasks** | VERA Tasks | Create, complete, delete, update open tasks; recurring task support |
| **Tasks** | Google Tasks | Read Google Tasks via Advanced Tasks API; complete individual tasks |
| **Tasks** | Projects | Multi-step projects with Claude-generated subtasks; per-task status tracking |
| **Chat** | Chat (Ahmed) | Full conversational interface — all 40+ actions available; web search tool |
| **Chat** | Chat Lite (Victoria) | Simplified read-friendly view; same backend |
| **Chat** | Slack (#vera-chat) | Bidirectional Slack chat routed through the same chat backend |
| **Calendar** | Upcoming Events | 7-day calendar view with event colours and RSVP status |
| **Calendar** | PTO Planner | PTO balance, burn-down pace, suggested windows, Victoria PTO |
| **Travel** | Trips | Itinerary items by trip; flight status (live via AviationStack) |
| **Travel** | Packing | Per-trip packing lists; AI-generated packing from itinerary + weather |
| **Travel** | Countries | Countries visited tracker (Ahmed + Victoria) |
| **Travel** | Bucket List | Dream destinations with star ratings and activity sublists |
| **Travel** | Traveler Profiles | Passport details + visa-check tool |
| **Finance** | Overview | 4-card bento: net income, spend vs budget, top categories, cashflow |
| **Finance** | Bills | Recurring bill tracker with paid/unpaid toggle |
| **Finance** | Transactions | Spending history from Empower CSV (separate Transactions sheet) |
| **Finance** | Credit Cards | Card rewards, perks tracker, inactivity alerts |
| **Finance** | Loyalty Programs | Points/miles balances, best-use guide, expiry alerts |
| **Finance** | Financial Goals | Goal progress, what-if scenario simulator |
| **Health** | Appointments | DR: calendar-based appointment tracker with next-due dates |
| **Health** | Prescriptions | Medication tracker for Ahmed + Victoria with refill dates |
| **Health** | Gym Log | Attendance log from calendar EXERCISE events |
| **Health** | Morning Routine | Daily checklist reset each night |
| **Home** | Steward | Warranties, service log, next-service reminders |
| **Home** | Chores | Cadence-based chore checklist (Daily/Weekly/Bi-weekly/Monthly/Quarterly) |
| **Home** | Shopping | Per-store shopping lists; recipe-to-shopping integration |
| **Home** | Meal Plan | Weekly dinner planner with takeout/home-cooked/leftovers modes |
| **Home** | Takeouts | Favourite restaurant list with rated menu items |
| **Home** | Pantry | Purchase history + auto-restock predictions (EMA model) |
| **Home** | Vehicles | Oil changes, tyre rotations, registration, inspection expiry tracking |
| **Home** | Guests | House guest arrival/departure tracking |
| **People** | Important Dates | Birthdays, anniversaries, meaningful dates with lead-time flagging |
| **People** | Gift Ideas | Per-person gift idea lists |
| **People** | Interests | Shared Interest Ledger (Ahmed + Victoria preferences) |
| **Career** | Profile | Current role snapshot, work style, focus areas |
| **Career** | Goals | Long-horizon career targets (1yr/3yr/5yr/10yr) |
| **Career** | Wins | Achievement log with impact notes |
| **Career** | Development | Skills, courses, focus areas |
| **Career** | Network | Professional relationships + last contact |
| **Career** | Progression | Career timeline |
| **Explore** | Goals | Yearly goals Kanban (To Do / In Progress / Done) |
| **Explore** | Ideas | Braindump repo with Thought Inbox and Shelve-to-idea pipeline |
| **Explore** | Experiments | Personal experiment tracker with check-in log |
| **Explore** | Growth | Books, courses, skill practice log |
| **Explore** | Resources | Reference links and docs library |
| **Explore** | Wish List | Aspirational purchase tracker |
| **Explore** | Recipes | Recipe library with ingredient lists |
| **Settings** | Config | Config tab editor (key/value pairs) |
| **Settings** | Contracts | Active contract tracker with expiry and notice-period flagging |

---

## Chat Interface

VERA's chat backend (`Chat.js`) is a single Claude-powered conversational engine shared across three surfaces:

**Dashboard — Ahmed** (`?session=dashboard`)
Full-access chat. All 40+ actions are available. Receives the complete context bundle: flags, tasks, Google Tasks, calendar, summaries, PTO, goals, bills, recipes, home items, travel, interests, career, credit cards, prescriptions, contracts, countries, bucket list, and VERA NOTICES (proactive time-sensitive highlights). Capacity mode is injected into the system prompt so VERA adjusts verbosity based on how busy the day is.

**Dashboard — Lite (Victoria)**
Same backend and session as the main dashboard, surfaced in a simpler read-focused layout. Victoria can ask questions and trigger actions; VERA's responses adapt based on who is asking.

**Slack — #vera-chat** (`source: slack`)
Inbound messages from Slack are received via the Events API POST to `doPost()`, queued in CacheService, and processed asynchronously to beat Slack's 3-second acknowledgement deadline. Outbound responses are sent via `chat.postMessage`. User identity is resolved via `SLACK_AHMED_USER_ID` / `SLACK_VICTORIA_USER_ID` Script Properties.

**Source routing:** the `session` parameter on the chat action determines the conversation history key (`CHAT_HISTORY_{session}`). VERA maintains the last 10 exchanges (20 messages) per session.

**Web search:** when `VERA_SEARCH_API_KEY` is set, VERA can call Serper.dev (default) or Tavily for real-time information. All queries are PII-scrubbed before leaving the server.

---

## Chat Actions

VERA's chat system supports the following action categories, each backed by a live Apps Script implementation:

| Category | Actions |
|----------|---------|
| **Tasks** | complete_task, delete_task, update_task (rename/due date/status/recurring/notes), create_task |
| **Flags** | acknowledge_flag, snooze_flag, resolve_flag |
| **Projects** | create_project (with Claude-generated exhaustive subtask list), add_project_task, complete_project_task, delete_project_task |
| **Calendar** | create_calendar_event (creates in Google Calendar), add_gym_sessions (schedules workout blocks on travel days) |
| **Bills** | add_bill, mark_bill_paid (toggle), delete_bill |
| **Recipes** | add_recipe, delete_recipe, recipe_to_shopping |
| **Meal Planning** | suggest_meals_week (AI-populated full week), set_meal (per-day override) |
| **Shopping** | add_shopping_item, toggle_shopping_item |
| **Home Items** | add_home_item, record_home_service, delete_home_item |
| **Goals** | add_goal, update_goal (status/title/category/progress/notes), delete_goal |
| **Ideas** | add_idea, add_thought (raw capture), shelve_thought (categorise), update_idea, promote_idea (→ task), archive_idea |
| **Interests** | log_interest (auto-capture from conversation), add_interest (explicit), delete_interest |
| **Travel — Itinerary** | add_itinerary_item (flight/train/cruise/ferry/hotel/dining/museum/beach/show/spa/skiing/snorkeling/theme_park/shopping/market/manual), update_itinerary_item, delete_itinerary_item, set_trip_context |
| **Travel — Packing** | add_packing_item (ahmed/victoria/shared), check_packing_item, delete_packing_item, generate_packing_list (AI-generated from itinerary + weather) |
| **Countries & Bucket List** | add_country, delete_country, add_bucket_item, update_bucket_item (visited/stars), delete_bucket_item |
| **Takeouts** | add_takeout_restaurant, add_takeout_item, delete_takeout_restaurant, delete_takeout_item |
| **Pantry / Purchase History** | add_purchase, log_receipt_items (image → line items) |
| **Career** | add_career_win, add_career_goal, update_career_position |
| **Prescriptions** | add_prescription, mark_prescription_refilled |
| **Health Appointments** | log_health_visit (creates DR: calendar event), add_health_appointment, query_health_due |
| **Credit Cards** | log_card_used, update_loyalty_points |
| **Post-trip debrief** | Structured 5-question debrief capturing restaurants, highlights, skips, Victoria's highlights, and would-return decision |
| **Thought triage** | Walk through THOUGHT INBOX: shelve, promote to task, or archive |

---

## Intelligence & Proactive Features

### Nightly Flag Generation (Claude AI)

The core intelligence engine. After collecting events, tasks, summaries, PTO stats, and the Shared Interest Ledger, `Code.js` packages a single structured prompt for `Claude.js` and calls `claude-sonnet-4-6`. Claude returns up to 8 flags per night (configurable via `max_flags_per_night`) with urgency ratings (High/Medium/Low), a machine-readable `key`, and a plain-text `reason`. Flags are written to the Flags tab with deduplication (exact fingerprint + 60% token-overlap fuzzy match) to prevent nightly repeats for ongoing issues.

### Cross-Domain Pattern Recognition (`PatternRecognition.js`)

Runs nightly as Step 0q. Assembles a lightweight cross-domain snapshot and evaluates seven compound rule-based patterns that span multiple life domains. Single-domain flags are handled by their own checkers; this module only fires when two or more domains signal together.

| # | Pattern | Signals required |
|---|---------|-----------------|
| 1 | **High-Stress Compound** | Overdue tasks + high unacknowledged flags + no gym this week |
| 2 | **Goal-Behaviour Drift** | Active goals + gym sessions below target + task backlog growing |
| 3 | **Social/Calendar Gap** | Empty week ahead (not in pacing/vacation mode) |
| 4 | **Overload + Pacing Mismatch** | High intensity week + pacing mode not active |
| 5 | **Meal Chaos** | Takeout ratio >70% in last 7 days + overdue tasks |
| 6 | **Backlog Accumulation** | Busy calendar + task neglect pile growing |
| 7 | **Health Neglect Compound** | Overdue health appointments + no gym sessions this week |

Config overrides: `pattern_max_flags` (default 2 per run), `pattern_dedup_days` (default 7 days before same pattern can re-fire).

### Signal Learning & Noise Filtering (`SignalLearning.js`)

Tracks flag engagement over time in the `SignalLearning` tab. Each flag key pattern receives a score starting at 100. Score decreases when flags are snoozed (−20) or expire unactioned (−15); it increases when acknowledged (+10) or resolved (+25). A pattern is suppressed when its score drops below 25 after at least 5 sightings. Suppressed patterns are fed into the nightly Claude prompt as a noise-filter list so VERA stops generating redundant flags.

### Pacing & Capacity Mode (`Pacing.js`)

**Vacation mode** is detected automatically each night: if today falls within an active trip in the Itinerary tab (where the traveller is not exclusively Victoria), `VACATION_MODE_ACTIVE` is set to `true` in Script Properties. While active, fitness consistency checks, pacing escalation, and flag escalation are all suppressed.

**Pacing mode** is activated by the miss-rate checker. If 2+ domains show missed targets (gym sessions, overdue tasks, unacknowledged flags, overdue chores) within a 48-hour window, VERA fires a Medium deferral-offer flag. If the offer is not responded to within another 48 hours and the pattern persists, VERA auto-activates pacing mode for 7 days: defers upcoming non-recurring tasks to next Monday and pauses routine Anticipator reminders.

**Capacity mode** is inferred nightly from tomorrow's calendar load (meeting density, total committed hours). The result (light/normal/busy) is injected into the chat system prompt to adjust VERA's verbosity and which priority levels it volunteers.

### Anticipator — Reminder Engine (`Reminders.js`)

Runs every hour via the `hourlyCheck` trigger. Evaluates a set of rule-based nudge rules and sends messages via Slack (#vera-notifications) with email fallback. Each rule has a cooldown tracked in the `Reminders Memory` sheet to prevent repeated nudges. Rules include:

- **Ergonomic break** — every ~60 minutes on weekdays 9am–6pm
- **Hydration check** — every ~120 minutes on weekdays 8am–6pm
- **Calendar opportunity window** — detects free blocks ≥90 minutes and suggests using them for a high-priority task
- **Evening mobility** — configurable hour each evening
- **Bills due** — alerts when a bill is due within the next few days
- **Trip packing reminder** — nudges about packing status for upcoming trips
- **Goal check-in** — periodic prompts to review goal progress
- **Home service due** — alerts when a home item's service interval is approaching

### Weekend Planner (`WeekendPlanner.js`)

Fires every Monday at ~8am (configurable via `weekend_planner_hour`). Generates a "Weekend Decision Memo" delivered via Slack/email and as an all-day Google Calendar event on the upcoming Saturday. The memo presents three archetypes: THE EXTENSION (goal-anchored activity), THE CONTRAST (rest/recharge, weighted higher when the intensity signal is high), and THE PROTOTYPE (new experience not already in the Interest Ledger). Draws on goals, the Shared Interest Ledger, PTO balance, and open calendar windows.

### Pre-trip & Post-trip Pipeline (`PreTripBriefing.js`, `PostTripCapture.js`)

**Pre-trip briefing:** nightly Step 0f checks for trips departing within the configured window (default 48 hours). For each qualifying trip it assembles a structured High-urgency flag containing weather at the destination, flight status, itinerary overview, confirmation numbers, cancellation deadlines, and packing completion status. Fires exactly once per trip via the flag deduplication system.

**Post-trip capture:** nightly Step 0g checks for trips that ended within `posttrip_capture_delay_days` (default 1 day). Fires a prompt flag inviting Ahmed to debrief the trip via chat. The chat backend handles the structured 5-question debrief flow, logging restaurants, highlights, and countries visited.

### Health Appointment Tracker (`HealthTracker.js`)

Scans all Google Calendars for events prefixed with `DR:`. Title format: `DR: Ahmed - Annual Physical` or `DR: Victoria - Dentist Cleaning - Dr. Patel`. VERA derives the person, appointment type, provider, last visit date, and scheduled next date — then computes days until the next appointment is due based on default intervals. Flags are generated nightly when appointments are approaching or overdue.

Default intervals (months):

| Appointment type | Interval |
|-----------------|----------|
| Annual physical | 12 |
| Dental cleaning / dentist | 6 |
| Eye exam / optometrist / ophthalmologist | 12 |
| Dermatology / dermatologist | 12 |
| Gynecology / OB-GYN | 12 |
| Therapy / therapist / chiropractor | 1 |
| Cardiology / endocrinology / allergist | 12 |
| Urgent care | 0 (never flagged — episodic) |

Override the default for any appointment by adding `interval:N` in the Google Calendar event description.

### Monthly Life Review (`MonthlyReview.js`)

Runs on the 1st of each month. Assembles a structured review of the prior month covering: goals by status, tasks snapshot, finance summaries, PTO burn-down pace, travel completed, flag counts (generated/resolved/unresolved), and a Claude-generated "one thing to carry forward." Delivered as a Low-urgency flag and archived to the `Monthly Reviews` tab (append-only).

### Important Dates + Birthday Auto-Sync (`ImportantDates.js`)

Nightly Step 0a scans the "Joint Chaos" shared Google Calendar for birthday events arriving within the next 30 days and auto-adds any new entries to the `Important Dates` tab (recurring, lead time 30 days). The nightly flag engine generates advance-warning flags for all important dates (birthdays, anniversaries, meaningful dates) within the configured lead-time window.

### Gym Tracker (`GymTracker.js`)

Nightly Step 0i scans the past 24–48 hours of all Google Calendars for events with `EXERCISE` in the description that have already ended. Each new session is logged to the `Gym Log` tab and a check-in flag is written. The fitness consistency checker (`Fitness.js`) runs in parallel and generates a Low flag on the configured day of the week (default Wednesday) if the weekly session count is below `fitness_weekly_target`.

### Finance Overview Dashboard (`Finance.js`)

The Finance tab in the dashboard shows: net income vs. spend (from the Simple Ass Tracker budget sheet via `SAT_SHEET_ID`), spending by category from the Transactions sheet (`TRANSACTIONS_SHEET_ID`), cashflow timeline, and bill status. Transaction data uses the Empower CSV export format. Categories can be configured for exclusion via `finance_skip_categories` in the Config tab.

### Email Admin & Travel Email Parser (`EmailParser.js`, `EmailAdmin.js`)

**Travel email parser** (gated by `email_parser_enabled=true`): scans Gmail every 30 minutes for travel confirmation emails (flights, hotels, cars, cruises, restaurants). Claude classifies each email with a confidence score. High-confidence emails are processed automatically into itinerary rows. Medium-confidence emails are held and a flag is generated for manual review. All processed emails are logged in the `Processed Emails` tab for deduplication.

**Email admin:** tracks email follow-ups in the `Email Follow-ups` tab. Chat can flag threads for follow-up.

---

## Nightly Pipeline

`nightlyRun()` runs every night at 11 PM via a time-based trigger. All steps are wrapped in individual try/catch so a failure in one step never aborts the rest of the run. Failures are collected and posted to `#vera-logs` as a summary at the end.

| Step | Function | Description |
|------|----------|-------------|
| Step -1 | `escalateAgedFlags_()` | Escalate unacknowledged flags older than 3 days (Medium) or 7 days (High) |
| Step 0 | `writeSummarySnapshot()` | Auto-populate Metrics + Summaries tabs from live data sources |
| Step 0a | `syncCalendarBirthdaysToImportantDates_()` | Sync birthday events from Joint Chaos calendar to Important Dates |
| Step 0a-ii | `resetChoresByCadence_()` | Reset chore checkboxes that have elapsed their cadence interval |
| Step 0b | `writePTOSnapshot_()` | Compute PTO usage, burn-down pace, and suggested windows; write to PTO tab |
| Step 0c | `runExplorer_()` | Daily AI discovery bulletin — generates a curiosity nudge based on interests |
| Step 0d | `getSuppressedKeyPatterns_()` | Load suppressed flag patterns from SignalLearning tab for noise filtering |
| Step 0e | `recordExpiredFlags_()` | Log flags that have been open >30 days without action into SignalLearning |
| Step 0f | `checkPreTripBriefings_()` | Generate pre-trip briefing flags for trips departing within 48h |
| Step 0g | `checkPostTripCapture_()` | Fire post-trip debrief prompt for trips that ended 1 day ago |
| Step 0h | Morning routine reset | Reset morning routine checkboxes to unchecked for the new day |
| Step 0i | `checkGymSessions_()` | Scan calendar for ended EXERCISE events; log to Gym Log; write check-in flag |
| Step 0j | `checkFitnessConsistency_()` / `checkFitnessTravelGap_()` | Fitness weekly target check + travel-period gap detection |
| Step 0k | `autoRestockItems_()` / `generatePantryFlags_()` | Pantry EMA-based restock predictions + trip-overlap flags |
| Step 0l | `inferCapacityMode_()` | Score tomorrow's calendar load → set capacity mode (light/normal/busy) |
| Step 0m | `checkContracts_()` | Flag contracts approaching expiry or within notice period |
| Step 0n | `checkHealthAppointments_()` | Flag overdue or upcoming DR: calendar appointments |
| Step 0o | `checkMonthlyReview_()` | Generate monthly life review on the 1st of each month |
| Step 0p | `resetWeekMealPlan_()` | Saturday only: archive current week meal plan, seed next week |
| Step 0q | `checkCrossPatternFlags_()` | Evaluate 7 cross-domain compound patterns |
| Step 1 | `getUpcomingEvents()` + `getOpenTasks()` + `getSummaries()` + `getSharedInterestLedger_()` | Collect all data for Claude |
| Step 1b | `suggestDueDates()` | Suggest due dates for undated tasks (writes back to sheet) |
| Step 2 | Skip check | Skip Claude call if all three data sources are simultaneously empty |
| Step 3 | `generateFlags()` | Build Claude prompt → call claude-sonnet-4-6 → parse flags |
| Step 4 | `writeFlags()` | Write flags to Flags tab with exact + fuzzy deduplication |
| Step 4b | `recordFlagsGenerated_()` | Record generated flag keys in SignalLearning for engagement tracking |
| Final | `sendSlackLog_()` | Post run summary to #vera-logs (flag counts, step warnings, elapsed time) |

---

## Triggers

| Function | Schedule | Purpose |
|----------|----------|---------|
| `nightlyRun` | Daily at 11 PM | Main intelligence pipeline — all 17+ steps |
| `morningNudge` | Daily at 7 AM | Morning briefing email with flags, tasks, and calendar summary |
| `hourlyCheck` | Every 1 hour | Anticipator reminder rules + Weekend Planner (Monday 8am) |
| `checkFlightStatuses_` | Every 15 minutes | Real-time flight status polling via AviationStack for flights within 24h |
| `runEmailScan_` | Every 30 minutes | Travel email inbox scan (gated by `email_parser_enabled=true` in Config) |

All triggers are installed by `setupTriggers()`. The function is safe to call multiple times — it deletes existing VERA triggers before recreating them to prevent duplicates.

> **Warning:** `runEmailScan_` can generate up to 144 Claude API calls per day when enabled. Only enable it when actively processing a travel email backlog. Disable when done.

---

## Flag System

### Urgency Levels

| Level | Colour | Meaning |
|-------|--------|---------|
| **High** | Red tint (`#ffe4e4`) | Requires attention within 24 hours |
| **Medium** | Yellow tint (`#fffbe4`) | Should be addressed this week |
| **Low** | Green tint (`#e4ffe8`) | Informational; act when convenient |

### Flag ID Format

`FLAG-YYYYMMDD-NN` where `NN` is a random two-digit suffix (10–99). The random suffix ensures uniqueness across multiple flags generated on the same night.

### Deduplication

Before writing a new flag, `writeFlags()` checks all existing flags (regardless of state) against two fingerprints:

1. **Exact fingerprint** — `source + flag text` combined hash. Prevents identical flags from being re-written.
2. **Fuzzy 60% token overlap** — the flag's machine-readable `key` is normalised (month names and standalone numbers stripped), tokenised on underscores, and compared against all existing key-based fingerprints. If 60% or more tokens match, the flag is considered a date-drifted duplicate and is skipped (e.g. `verizon_bill_march_13` vs `verizon_bill_march_14`).

### Lifecycle

```
created → [3 days] → escalated (Medium→High) → [7 days] → escalated (High stays High)
                                                          ↓
                        acknowledged / snoozed (N days) / resolved
```

Escalation is performed nightly by `escalateAgedFlags_()` (Step -1). Snoozed flags are re-surfaced automatically when `Snoozed Until` date has passed.

### Flag Sources

Claude AI · Pattern Recognition · Health Tracker · Contracts · Pantry · Fitness · Gym Tracker · PTO · Pre-trip Briefing · Post-trip Capture · Monthly Review · Important Dates · Pacing · Email Parser

---

## Travel Module

### Itinerary Event Types

The following types are supported in the `add_itinerary_item` chat action and `Itinerary` tab:

`flight` · `train` · `cruise` · `ferry` · `hotel` · `dining` · `museum` · `beach` · `show` · `spa` · `skiing` · `snorkeling` · `theme_park` · `shopping` · `market` · `manual`

### Pre-trip Briefing

48 hours before departure (configurable via `pretrip_briefing_hours`), VERA generates a High-urgency flag containing: destination weather, all flight legs with confirmation numbers, full itinerary overview, cancellation deadlines, and packing list completion percentage. Fires exactly once per trip via the flag key deduplication system.

### Flight Status Monitor

`checkFlightStatuses_()` runs every 15 minutes. It scans the Itinerary tab for flight rows with a flight number, plus Google Calendar for events matching the airline-code + number pattern. For flights within 24 hours of departure it queries the AviationStack API. Results are stored in the Itinerary sheet metadata column (JSON) and in Script Properties (`FLIGHT_STATUS_CACHE`). The dashboard merges both sources via `?action=flight_statuses&tripKey=...`.

Adaptive polling intervals: 6–24h before departure → every 3 hours; 1–6h → every 60 minutes; under 1h → every 15 minutes. A 429 rate-limit response triggers a 2-hour backoff (or 30-day backoff if the monthly quota is exhausted).

### Post-trip Capture

1 day after a trip ends, VERA fires a prompt flag. Responding via chat triggers a structured 5-question debrief: restaurants worth revisiting, trip highlights, things to skip next time, Victoria's highlights, and whether to go back. The chat backend auto-logs interests, countries visited, and bucket list updates.

### Email Parser

`runEmailScan_()` (every 30 minutes, gated by `email_parser_enabled=true`) searches Gmail for travel confirmation emails using a broad query covering flights, hotels, reservations, e-tickets, and check-in confirmations. Emails are batched and sent to Claude for confidence scoring. Emails scoring above 0.85 are auto-processed into itinerary rows; those scoring 0.60–0.85 are held pending manual review with a flag; those below 0.60 are silently discarded. All processed emails are recorded in the `Processed Emails` tab for deduplication.

### Calendar Title Prefix

Trips in Google Calendar should use the prefix `TRIP:` in the event title. VERA's itinerary tab uses a `Trip Key` format of `YYYY-MM-DD|Trip Label` (the departure date + a descriptive label).

---

## Finance Module

### Transactions Sheet

Financial transaction data lives in a **separate** Google Sheet (not a tab in Life OS), identified by `TRANSACTIONS_SHEET_ID` in Script Properties. Data format matches the Empower CSV export: Date, Account, Description, Category, Tags, Amount. This separation keeps sensitive financial data isolated from the main Life OS sheet.

### Simple Ass Tracker (SAT) Budget Integration

The SAT budget sheet is read via `SAT_SHEET_ID`. VERA reads the `Tracker` tab and supports both horizontal layouts (column-per-person) and vertical layouts (section-per-person). Budget metrics (net income, fixed expenses, shared expense splits) are surfaced in the Finance Overview dashboard and included in the nightly Claude context.

### Finance Overview Dashboard

Four bento cards on the Finance tab:

1. **Income vs. Spend** — net income from SAT vs. actual spend from Transactions
2. **Category Breakdown** — top spending categories this month
3. **Bills Status** — upcoming bills, paid/unpaid, due-day countdown
4. **Cashflow Timeline** — projected cashflow based on recurring bills and income

### Bills Tab

The `Bills` tab tracks recurring bills: bill name, amount, due day, frequency, category, account, paid status. VERA flags unpaid bills approaching their due date via the Anticipator. The chat interface can mark bills paid, add new bills, and delete bills by row number.

---

## Health & Wellness Module

### DR: Prefix Convention

Health appointments are tracked entirely via Google Calendar — no separate sheet tab. Title format:

```
DR: Ahmed - Annual Physical
DR: Victoria - Dentist Cleaning
DR: Ahmed - Eye Exam - Dr. Patel
```

If no ` - ` separator is present, person defaults to "Ahmed". The third segment (after a second ` - `) is treated as the provider name. The event description may contain `interval:N` to override the default check interval (in months) for that appointment type.

Full interval defaults — see the [Health Appointment Tracker](#nightly-flag-generation-claude-ai) section above.

### Gym Log

`GymTracker.js` logs sessions to the `Gym Log` tab by scanning calendar events with `EXERCISE` anywhere in the event description. Sessions can also be manually logged or backfilled via the dashboard. The weekly consistency checker fires on the configured day (default Wednesday) if the session count falls below `fitness_weekly_target`.

During active trips, `checkFitnessTravelGap_()` checks whether any gym sessions were scheduled for the trip interior days. If not, it offers to auto-schedule them via a flag.

### Morning Routine

The `Morning Routine` tab holds a configurable checklist. Each item has an ID, label, sort order, and checked/checked-at fields. The nightly run resets all items to unchecked. Items can be added, reordered, or deleted via the dashboard; VERA can generate a personalised routine via `?action=generate_morning_routine`.

### Prescriptions

The `Prescriptions` tab tracks active medications for Ahmed and Victoria: medication name, dosage, frequency, doctor, pharmacy, Rx number, last filled date, refill date, and days supply. VERA's chat can add prescriptions and mark refills. Upcoming refill dates are surfaced in the chat system prompt for proactive reminders.

---

## People & Relationships Module

### Important Dates

The `Important Dates` tab stores birthdays, anniversaries, and meaningful dates with: ID, Date (MM-DD for recurring), Label, Person, Recurring flag, Lead Time Days (default 30), Notes, and Last Actioned Year. VERA generates advance-warning flags within the lead-time window and automatically marks items as actioned each year after flagging.

### Auto-sync from Joint Chaos Calendar

Nightly Step 0a scans the "Joint Chaos" shared Google Calendar for birthday events arriving within the next 30 days. Any birthday not already in the Important Dates tab is auto-added with recurring=true and a 30-day lead time. The calendar name match is case-insensitive; if no "Joint Chaos" calendar is found, the step is skipped gracefully.

### Gift Ideas

The `Gift People` tab holds one row per person (default: Ahmed, Victoria). The `Gift Ideas` tab holds individual ideas linked to a person. The dashboard People tab shows per-person idea lists. Chat can add ideas via natural language.

---

## Career Module

The Career tab in the dashboard surfaces six sub-sections, each backed by a dedicated sheet tab:

| Tab | Purpose |
|-----|---------|
| `Career Position` | Current role snapshot: title, company, department, start date, work style, focus areas |
| `Career Goals` | Long-horizon targets with horizon (1yr/3yr/5yr/10yr), category, and status |
| `Career Progression` | Career timeline: all prior roles with highlights |
| `Career Development` | Skills, courses, and focus areas with target dates |
| `Career Wins` | Achievement log: win description, impact, category, date |
| `Career Network` | Professional contacts with relationship type and last-contact date |

VERA's chat interface auto-captures career wins when Ahmed mentions launches, recognitions, or positive outcomes mid-conversation. Career context (current position, active goals, recent wins) is injected into the chat system prompt for proactive coaching.

---

## Home Front Module

### Chores

The `Chores` tab holds household chores with cadence (Daily/Weekly/Bi-weekly/Monthly/Quarterly), sort order, and checked/checked-at timestamps. `resetChoresByCadence_()` runs nightly and resets chores whose cadence interval has elapsed. Chores are surfaced in the pacing miss-rate checker — overdue chores contribute to pacing mode activation.

### Vehicles

The `Vehicles` tab tracks cars/bikes with: nickname, year, make, model, VIN, license plate, driver, current mileage, oil change interval and history, registration/insurance/warranty expiry dates, emission and safety inspection expiry, tyre replacement history and interval, and service schedule. The dashboard can log oil changes, service visits, mileage updates, tyre changes, and inspection events.

### Pantry + Auto-Restock

The `Purchase History` tab logs grocery and household purchases with item name, normalised name, category, quantity, unit, store, and price. When `pantry_enabled=true`, VERA uses an exponential moving average model (`pantry_ema_alpha` default 0.3) to predict when items will run out and auto-adds them to the shopping list `pantry_restock_days_ahead` days before predicted depletion.

### Contracts + Expiry Flagging

The `Contracts` tab tracks active agreements: name, category, counterparty, start/end dates, auto-renewal flag, notice period, monthly cost, status, and document link. `checkContracts_()` runs nightly and generates flags for contracts approaching expiry (within the notice period + a buffer) or already expired. Chat can add, update, and log actions against contracts.

---

## Slack Integration

### Channels

| Channel | Property Key | Purpose |
|---------|-------------|---------|
| `#vera-chat` | `SLACK_CHAT_CHANNEL_ID` | Bidirectional conversational chat — Ahmed and Victoria can message VERA |
| `#vera-notifications` | `SLACK_NOTIFICATIONS_CHANNEL_ID` | Outbound flag alerts with Block Kit Acknowledge + Snooze buttons; High-urgency flags @mention Ahmed |
| `#vera-logs` | `SLACK_LOGS_CHANNEL_ID` | Nightly run summary (flag counts, step warnings, elapsed time), errors, pre-trip briefing confirmations |

### Block Kit Interactive Buttons

When a new flag is posted to `#vera-notifications`, it includes two Block Kit action buttons: **Acknowledge** and **Snooze 3 days**. Button interactions are received as `application/x-www-form-urlencoded` POST payloads (not JSON) to `doPost()`, routed to `handleSlackFormPost_()`. Responses use `replace_original: true` so the button row is replaced with a confirmation message.

### User ID Mapping

VERA resolves Slack user IDs to human names via Script Properties:

| Property | Usage |
|----------|-------|
| `SLACK_AHMED_USER_ID` | @mention on High-urgency flags; identity resolution in chat |
| `SLACK_VICTORIA_USER_ID` | Identity resolution in chat |
| `SLACK_ALLOWED_USER_IDS` | Comma-separated list of Slack user IDs authorised to chat with VERA |

### Inbound Message Flow

1. Slack sends an Events API POST to the Web App `doPost()` URL.
2. `doPost()` detects `body.type === 'event_callback'` and routes to `handleSlackEvent_()`.
3. The message is queued in `CacheService` and a one-shot trigger fires `processTelegramQueue_()` 100ms later (same async queue pattern as Telegram).
4. This returns 200 OK to Slack within the 3-second deadline.
5. The queued handler builds chat context, calls Claude, and sends the response back to `#vera-chat`.

---

## Data Model — Sheet Tabs

Every tab is created automatically by `setupVERA()` → `createSheetTabs()`. Headers are written in dark navy (`#1a1a2e`) with white text, and row 1 is frozen.

| Tab Name | Constant Key | Purpose | Auto-managed? |
|----------|-------------|---------|---------------|
| Flags | `FLAGS` | All generated flags (all states) | Written nightly by Claude + sub-modules |
| Tasks | `TASKS` | Open and completed VERA tasks | User-managed; recurring tasks auto-recreated |
| Metrics | `METRICS` | VERA health counts (tasks/calendar/flags) | Written nightly by `writeSummarySnapshot()` |
| Summaries | `SUMMARIES` | External life data feed (Finance, Fitness, etc.) | `[AUTO]` rows written nightly; manual rows preserved |
| Config | `CONFIG` | Key/value configuration pairs | User-managed |
| Projects | `PROJECTS` | Multi-step projects with subtasks | User + chat managed |
| Goals | `GOALS` | Yearly goals Kanban | User + chat managed |
| PTO | `PTO` | PTO balance snapshot | Written nightly by `writePTOSnapshot_()` |
| PTO Memory | `PTO_MEMORY` | Declined PTO suggestion blacklist | Auto-managed by PTO module |
| Reminders Memory | `REMINDERS_MEMORY` | Anticipator + Explorer cooldown log | Auto-managed by `hourlyCheck` |
| Shared Interests | `INTEREST_LEDGER` | Ahmed + Victoria interest log | User + chat managed |
| Bills | `BILLS` | Recurring bill tracker | User + chat managed |
| Recipes | `RECIPES` | Recipe library | User + chat managed |
| Meal Plan | `MEAL_PLAN` | Weekly dinner plan | AI + user managed; reset Saturdays |
| Takeout Restaurants | `TAKEOUT_RESTAURANTS` | Favourite takeout places | User + chat managed |
| Takeout Items | `TAKEOUT_ITEMS` | Menu items per restaurant | User + chat managed |
| Home Items | `HOME_ITEMS` | Warranties + service log | User + chat managed |
| Ideas | `IDEAS` | Braindump repo + Thought Inbox | User + chat managed |
| Itinerary | `ITINERARY` | Trip itinerary items | User + chat + email parser managed |
| TripMeta | `TRIP_META` | Trip context and sentiment notes | User + chat managed |
| PackingItems | `PACKING_ITEMS` | Per-trip packing list | User + chat + AI managed |
| Countries | `COUNTRIES` | Countries visited (Ahmed + Victoria) | User + chat managed |
| Bucket List | `BUCKET_LIST` | Travel dream destinations | User + chat managed |
| TripRecommendations | `TRIP_RECOMMENDATIONS` | AI-generated activity/dining recs | Generated on demand |
| Processed Emails | `PROCESSED_EMAILS` | Email parser dedup + outcome log | Auto-managed by EmailParser |
| Morning Routine | `MORNING_ROUTINE` | Daily checklist | Reset nightly; user + AI managed |
| Gym Log | `GYM_LOG` | Gym session attendance | Auto-populated by GymTracker |
| Purchase History | `PURCHASE_HISTORY` | Grocery/household purchase log | User + chat managed; AI predictions |
| Career Position | `CAREER_POSITION` | Current role snapshot | User + chat managed |
| Career Goals | `CAREER_GOALS` | Long-horizon career targets | User + chat managed |
| Career Progression | `CAREER_PROGRESSION` | Career timeline | User managed |
| Career Development | `CAREER_DEVELOPMENT` | Skills/courses/focus areas | User + chat managed |
| Career Wins | `CAREER_WINS` | Achievement log | User + chat managed (auto-captured) |
| Career Network | `CAREER_NETWORK` | Professional contacts | User managed |
| Prescriptions | `PRESCRIPTIONS` | Medication tracker (Ahmed + Victoria) | User + chat managed |
| Credit Cards | `CREDIT_CARDS` | Card metadata + ownership | User managed; seeded by `populateCreditCardHub()` |
| Card Rewards | `CARD_REWARDS` | Per-card category reward rates | User managed; seeded by `populateCreditCardHub()` |
| Card Perks | `CARD_PERKS` | Monthly/annual perk tracker | User managed; seeded by `populateCreditCardHub()` |
| Loyalty Programs | `LOYALTY_PROGRAMS` | Points/miles balances | User + chat managed |
| Rewards Goals | `REWARDS_GOALS` | Redemption goal tracking | User managed |
| Gift People | `GIFT_PEOPLE` | People with gift lists | User managed; seeded with Ahmed/Victoria |
| Gift Ideas | `GIFT_IDEAS` | Gift ideas per person | User + chat managed |
| Important Dates | `IMPORTANT_DATES` | Birthdays, anniversaries, meaningful dates | User + auto-synced from Joint Chaos calendar |
| Chores | `CHORES` | Household chore checklist | User managed; reset nightly by cadence |
| Traveler Profiles | `TRAVELER_PROFILES` | Passport + traveler profiles | User managed |
| Contracts | `CONTRACTS` | Active contract tracker | User + chat managed; flagged nightly |
| Vehicles | `VEHICLES` | Vehicle maintenance tracker | User + dashboard managed |
| Financial Goals | `FINANCIAL_GOALS` | Savings/investment goal tracking | User + dashboard managed |
| Financial Scenarios | `FINANCIAL_SCENARIOS` | What-if scenario saves per goal | User + dashboard managed |
| Email Follow-ups | `EMAIL_FOLLOW_UPS` | Email thread follow-up tracking | User + chat managed |
| Books | `BOOKS` | Reading list (Ahmed + Victoria) | User + dashboard managed |
| Courses | `COURSES` | Courses and learning content | User + dashboard managed |
| Skills | `SKILLS` | Skill building + practice log | User + dashboard managed |
| Experiments | `EXPERIMENTS` | Personal experiment tracker | User + dashboard managed |
| Experiment Checkins | `EXPERIMENT_CHECKINS` | Per-experiment check-in log | User + dashboard managed |
| Resources | `RESOURCES` | Reference links + docs | User + dashboard managed |
| BucketActivities | `BUCKET_ACTIVITIES` | Activity lists per bucket destination | User + chat managed |
| Wish List | `WISH_LIST` | Aspirational purchase tracker | User + dashboard managed |
| SignalLearning | (separate constant) | Flag engagement tracking for noise filtering | Auto-managed by SignalLearning engine |
| Monthly Reviews | (separate constant) | Archived monthly life reviews | Written 1st of each month |

---

## Config Tab Reference

Add these rows to the `Config` tab (`Setting` | `Value`). All keys are read via `getConfigValues()` which caches the tab for the duration of each execution.

| Key | Default | Module | What it controls |
|-----|---------|--------|-----------------|
| `calendar_days_ahead` | `7` | Calendar | Days ahead to fetch calendar events |
| `task_age_threshold_days` | `7` | Tasks | Days before a task is considered neglected |
| `max_flags_per_night` | `8` | Code | Maximum flags Claude can generate per nightly run |
| `morning_nudge_time` | `7` | Code | Hour for morning nudge email (24h, set by trigger) |
| `snooze_default_days` | `2` | Flags | Default snooze duration in days |
| `finance_review_day` | `1` | Finance | Day of month for finance review reminder |
| `active_sources` | `Calendar,Tasks,Summaries` | Code | Data sources included in nightly Claude context |
| `skip_calendars` | `Holidays in United States` | Calendar | Comma-separated calendar names to ignore |
| `calendar_label:CalName` | — | Calendar | Custom label for a specific calendar (e.g. `calendar_label:Ahmed \| personal`) |
| `pto_vacation_days` | `20` | PTO | Annual vacation allocation (days) |
| `pto_rollover_days` | `0` | PTO | Days carried over from prior year |
| `pto_personal_hours` | `48` | PTO | Annual personal time (hours) |
| `pto_buffer_days` | `3` | PTO | Reserve days held back from planning suggestions |
| `weather_location` | `` | Weather | City name for weather ticker (e.g. `Austin, TX`) |
| `email_parser_enabled` | `false` | EmailParser | Enable 30-minute inbox travel email scan |
| `pretrip_briefing_enabled` | `true` | PreTripBriefing | Enable pre-trip briefing flags |
| `pretrip_briefing_hours` | `48` | PreTripBriefing | Hours before departure to generate briefing |
| `posttrip_capture_enabled` | `true` | PostTripCapture | Enable post-trip debrief prompt |
| `posttrip_capture_delay_days` | `1` | PostTripCapture | Days after trip end to fire the capture flag |
| `gym_tracker_enabled` | `true` | GymTracker | Enable gym session tracking from calendar |
| `gym_tracker_lookback_hours` | `24` | GymTracker | Hours to scan back for ended EXERCISE events |
| `gym_sessions_per_week` | `3` | PatternRecognition | Target gym sessions per week (used in pattern checks) |
| `fitness_enabled` | `false` | Fitness | Enable weekly consistency checks |
| `fitness_weekly_target` | `4` | Fitness | Target gym sessions per week |
| `fitness_low_flag_day` | `4` | Fitness | Day to fire Low flag if behind (1=Sun…7=Sat; 4=Wed) |
| `fitness_travel_block_time` | `07:00` | Fitness | Start time for auto-created trip gym sessions |
| `fitness_travel_block_duration` | `60` | Fitness | Duration in minutes for auto-created trip gym sessions |
| `pantry_enabled` | `false` | Pantry | Enable purchase history + auto-restock predictions |
| `pantry_restock_days_ahead` | `7` | Pantry | Days ahead to predict and auto-add items to shopping list |
| `pantry_ema_alpha` | `0.3` | Pantry | EMA learning rate (higher = adapts faster to recent habits) |
| `pacing_enabled` | `true` | Pacing | Enable pacing/vacation mode detection |
| `pacing_flag_threshold` | `3` | Pacing | Number of unacknowledged Med/High flags to trigger pacing check |
| `pacing_mode_days` | `7` | Pacing | Duration of auto-activated pacing mode (days) |
| `reminders_enabled` | `true` | Reminders | Master switch for Anticipator rules |
| `explorer_enabled` | `true` | Reminders | Master switch for daily Explorer discovery bulletin |
| `explorer_interests` | (built-in default) | Reminders | Interests injected into Explorer prompt |
| `ergonomic_interval_min` | `60` | Reminders | Ergonomic break target interval (minutes) |
| `hydration_interval_min` | `120` | Reminders | Hydration reminder interval (minutes) |
| `mobility_reminder_hour` | `20` | Reminders | 24h hour for evening mobility nudge |
| `weekend_planner_enabled` | `true` | WeekendPlanner | Master switch for Weekend Planner |
| `weekend_planner_lookahead_days` | `21` | WeekendPlanner | Days to scan for clear windows |
| `weekend_planner_hour` | `8` | WeekendPlanner | Monday hour to fire Weekend Planner |
| `weekend_planner_home_city` | `Austin, TX` | WeekendPlanner | Base city for driving-radius framing |
| `pattern_max_flags` | `2` | PatternRecognition | Max new flags per nightly pattern recognition run |
| `pattern_dedup_days` | `7` | PatternRecognition | Days before same pattern key can re-fire |
| `monthly_review_enabled` | `true` | MonthlyReview | Enable monthly life review generation on 1st of month |
| `meal_planner_enabled` | `true` | MealPlan | Show Meal Plan sub-tab in dashboard |
| `google_tasks_enabled` | `true` | Tasks | Enable Google Tasks fetch in dashboard and chat |
| `morning_routine_enabled` | `true` | MorningRoutine | Show Morning Routine sub-tab |
| `takeouts_enabled` | `true` | Takeouts | Show Takeouts sub-tab |
| `experiments_enabled` | `true` | Experiments | Show Experiments sub-tab |
| `wish_list_enabled` | `true` | WishList | Show Wish List sub-tab |
| `wishlists_enabled` | `true` | WishList | Show Christmas Wish Lists section (People tab) |
| `finance_skip_categories` | (built-in default) | Finance | Comma-separated transaction categories to exclude from spend analysis |
| `summary_sheet:SourceName` | — | Summaries | External sheet metric hook: `SheetID\|TabName\|CellRef\|metric_name` |
| `travel_transit_buffer` | `120` | WebApp/Status | Default airport transit buffer minutes |
| `travel_customs_buffer` | `60` | WebApp/Status | Default customs buffer minutes |
| `travel_transit_buffer_XXX` | — | WebApp/Status | Airport-specific transit buffer (e.g. `travel_transit_buffer_IAD`) |

---

## Script Properties Reference

Set all properties in the Apps Script editor: **Project Settings → Script Properties**.

| Property Key | Required | Used By | Description |
|-------------|----------|---------|-------------|
| `VERA_SHEET_ID` | Yes | Code.js | Google Sheet ID for the Life OS sheet |
| `MORNING_NUDGE_EMAIL` | Yes | Code.js | Email address for morning briefing |
| `CLAUDE_API_KEY` | Yes | Claude.js | Anthropic API key |
| `VERA_WEB_TOKEN` | Yes | WebApp.js | Secret token required on all dashboard API requests (`?token=...`) |
| `VERA_DASHBOARD_URL` | No | morningNudge | Dashboard URL shown as "Open VERA Dashboard →" button in email |
| `VERA_LOGO_FILE_ID` | No | morningNudge | Google Drive file ID for VERA logo in morning email; falls back to text banner |
| `SAT_SHEET_ID` | No | Finance.js | Simple Ass Tracker Google Sheet ID |
| `TRANSACTIONS_SHEET_ID` | No | Finance.js | Transactions Google Sheet ID (Empower CSV format) |
| `SLACK_BOT_TOKEN` | No | Slack.js | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_CHAT_CHANNEL_ID` | No | Slack.js | Channel ID for #vera-chat |
| `SLACK_NOTIFICATIONS_CHANNEL_ID` | No | Slack.js | Channel ID for #vera-notifications |
| `SLACK_LOGS_CHANNEL_ID` | No | Slack.js | Channel ID for #vera-logs |
| `SLACK_AHMED_USER_ID` | No | Slack.js | Ahmed's Slack user ID (for @mention on High flags) |
| `SLACK_VICTORIA_USER_ID` | No | Slack.js | Victoria's Slack user ID |
| `SLACK_ALLOWED_USER_IDS` | No | Slack.js | Comma-separated authorised Slack user IDs |
| `AVIATIONSTACK_KEY` | No | FlightStatus.js | AviationStack API key for flight status polling |
| `OPENWEATHER_API_KEY` | No | Weather.js | OpenWeather API key for weather ticker and destination forecasts |
| `VERA_SEARCH_API_KEY` | No | Chat.js | Serper.dev or Tavily API key for web search in chat |
| `VERA_SEARCH_ENGINE` | No | Chat.js | `serper` (default) or `tavily` |
| `VACATION_MODE_ACTIVE` | Auto | Pacing.js | `true`/`false` — set nightly by `checkVacationMode_()` |
| `VACATION_MODE_ENDS` | Auto | Pacing.js | `YYYY-MM-DD` last date of active trip |
| `VACATION_TRIP_NAME` | Auto | Pacing.js | Trip key of active trip |
| `PACING_MODE_ACTIVE` | Auto | Pacing.js | `true`/`false` — set when pacing mode is activated |
| `PACING_MODE_ENDS` | Auto | Pacing.js | `YYYY-MM-DD` end of pacing mode window |
| `PACING_FIRST_DETECTED` | Auto | Pacing.js | Timestamp (ms) when miss-rate cluster was first detected |
| `PACING_OFFER_FLAG_KEY` | Auto | Pacing.js | Key of the deferral-offer flag that was written |
| `FLIGHT_STATUS_CACHE` | Auto | FlightStatus.js | JSON cache of calendar-based flight statuses |
| `AVIATIONSTACK_BACKOFF_UNTIL` | Auto | FlightStatus.js | Timestamp (ms) for AviationStack rate-limit backoff |
| `CHAT_HISTORY_{sessionId}` | Auto | Chat.js | Stored conversation history per session (JSON, last 10 exchanges) |

---

## Calendar Event Prefixes

VERA detects special prefixes in Google Calendar event titles to trigger specific behaviours:

| Prefix | Example Title | Detected By | What Happens |
|--------|--------------|-------------|--------------|
| `DR:` | `DR: Ahmed - Annual Physical` | `HealthTracker.js` | Event is tracked as a health appointment; last-visit date and next-due date are computed; nightly flags generated when overdue or approaching |
| `DR:` | `DR: Victoria - Dentist Cleaning - Dr. Patel` | `HealthTracker.js` | Same as above; third segment after ` - ` is treated as provider name; optional `interval:N` in description overrides default interval |
| `EXERCISE` (in description) | Any event with `EXERCISE` in the description field | `GymTracker.js` | Session is logged to the Gym Log tab and a check-in flag is written; used for gym consistency tracking and pattern recognition |
| `TRIP:` | `TRIP: Alaska Cruise` | Convention | Calendar events prefixed with TRIP: signal a travel period; used alongside the Itinerary tab for trip organisation |
| Birthday (in Joint Chaos calendar) | `Ahmed's Birthday` | `ImportantDates.js` | Auto-synced to Important Dates tab with recurring=true and 30-day lead time |

---

## Dashboard API Reference

All requests must include `?token=YOUR_VERA_WEB_TOKEN`. All mutations use GET to avoid CORS preflight.

### GET Actions

| Action | Parameters | Returns |
|--------|-----------|---------|
| `status` | — | Flag counts (total/active/high/medium/low), last run date, travel config, dashboard feature flags |
| `flags` | `filter=active` (optional) | All flags or active-only (not acknowledged + not resolved) |
| `tasks` | — | All open VERA tasks |
| `get_google_tasks` | — | Google Tasks from all task lists |
| `complete_google_task` | `id` | Completes a Google Task by ID |
| `summaries` | — | Summaries tab rows |
| `acknowledge` | `id` | Sets Acknowledged=Yes on flag |
| `snooze` | `id`, `days` | Sets Snoozed Until = today + days |
| `resolve` | `id` | Sets Resolved=Yes on flag |
| `complete_task` | `id` | Marks task Done; auto-creates next recurrence |
| `add_task` | `task`, `dueDate`, `recurring` | Appends new task row |
| `update_task` | `id`, `field`, `value` | Updates a single field on a task |
| `delete_task` | `id` | Removes task row |
| `shopping` | — | All shopping items grouped by store |
| `shopping_toggle` | `store`, `item` | Toggle purchased/unpurchased |
| `shopping_add` | `store`, `item` | Add shopping item |
| `shopping_delete` | `store`, `item` | Remove shopping item |
| `shopping_update` | `store`, `item`, `newItem` | Rename shopping item |
| `projects` | — | All projects with tasks |
| `complete_project_task` | `row` | Mark project task Done by row number |
| `add_project_task` | `project`, `task`, `priority`, `dueDate` | Add task to project |
| `update_project_task` | `row`, `field`, `value` | Update project task field |
| `delete_project_task` | `row` | Remove project task row |
| `goals` | — | All goals |
| `add_goal` | `title`, `description`, `category`, `year` | Add new goal |
| `update_goal` | `id`, `field`, `value` | Update goal field |
| `delete_goal` | `id` | Remove goal |
| `interests` | — | All Shared Interest Ledger entries |
| `interests_add` | `person`, `interest`, `category`, `source`, `notes` | Add interest entry |
| `interests_delete` | `id` | Remove interest entry |
| `pto` | — | PTO stats (used, remaining, pace, windows) |
| `pto_trigger_buffer` | — | Trigger PTO buffer suggestion |
| `budget` | — | SAT budget summary |
| `bills` | — | All bills with paid status |
| `bills_toggle` | `row` | Toggle bill paid status |
| `calendar_bills` | — | Calendar-based bill events |
| `bills_toggle_cal` | `id` | Toggle calendar bill |
| `bills_sync_transactions` | — | Sync bill statuses from transaction data |
| `tx_list` | — | Categorised transaction list |
| `recent_transactions` | — | Recent transactions |
| `cashflow` | `months` | Cashflow timeline |
| `tx_aliases` | — | Transaction merchant aliases |
| `set_tx_alias` | `merchant`, `alias` | Set a merchant alias |
| `recipes` | — | All recipes |
| `recipe_to_shopping` | `row` | Add recipe ingredients to shopping list |
| `meal_plan` | `week` | Weekly meal plan |
| `set_meal` | `day`, `meal`, `type` | Set a meal for a day |
| `update_meal_status` | `id`, `status` | Update meal status |
| `suggest_meals` | — | AI-suggest full week of dinners |
| `takeouts` | — | Favourite takeout restaurants with items |
| `homesteward` | — | Home items with service status |
| `homesteward_service` | `row` | Record service for a home item |
| `ideas` | — | All ideas (including Thought Inbox) |
| `add_idea` | `idea`, `category`, `tags` | Add idea |
| `update_idea` | `id`, `field`, `value` | Update idea field |
| `delete_idea` | `id` | Remove idea |
| `promote_idea` | `id` | Convert idea to open task |
| `shelve_thought` | `id`, `category` | Graduate thought to categorised idea |
| `add_bill` | `bill`, `amount`, `dueDay`, `frequency`, `category`, `account` | Add bill |
| `delete_bill` | `row` | Remove bill by row number |
| `add_recipe` | `name`, `cuisine`, `servings`, `prepTime`, `ingredients`, `tags` | Add recipe |
| `delete_recipe` | `row` | Remove recipe |
| `add_home_item` | `item`, `category`, `warrantyExpiry`, `intervalMonths`, `notes` | Add home item |
| `delete_home_item` | `row` | Remove home item |
| `itinerary` | `tripKey` | Itinerary items for a trip |
| `add_itinerary_item` | `tripKey`, `type`, `title`, `date`, `startTime`, `endTime`, `location`, `notes` | Add itinerary item |
| `update_itinerary_item` | `id`, `field`, `value` | Update itinerary item field |
| `delete_itinerary_item` | `id` | Remove itinerary item |
| `get_trip_meta` | `tripKey` | Get trip context/notes |
| `set_trip_meta` | `tripKey`, `context`, `notes`, `traveler` | Set trip meta |
| `get_packing` | `tripKey` | Packing list for a trip |
| `add_packing_item` | `tripKey`, `person`, `category`, `item` | Add packing item |
| `update_packing_item` | `id`, `field`, `value` | Update packing item |
| `delete_packing_item` | `id` | Remove packing item |
| `generate_packing` | `tripKey`, `startDate`, `endDate` | AI-generate packing list |
| `countries` | — | Countries visited |
| `add_country` | `country`, `city`, `year`, `traveller`, `notes` | Add country visited |
| `delete_country` | `id` | Remove country entry |
| `get_bucket_list` | — | Travel bucket list |
| `add_bucket_item` | `country`, `city`, `targetYear`, `traveller`, `stars`, `dreamTrip`, `notes` | Add bucket list item |
| `update_bucket_item` | `id`, `field`, `value` | Update bucket item (visited/stars) |
| `delete_bucket_item` | `id` | Remove bucket list item |
| `flight_statuses` | `tripKey` | Live flight statuses for a trip |
| `force_flight_statuses` | `tripKey` | Force-refresh flight statuses |
| `recommendations` | `tripKey` | AI trip activity/dining recommendations |
| `generate_recommendations` | `tripKey` | Generate new AI recommendations |
| `update_recommendation` | `id`, `field`, `value` | Update recommendation status |
| `accept_recommendation` | `id` | Accept recommendation → add to itinerary |
| `chat` | `message`, `session` | Send chat message, receive VERA response |
| `confirm_enrich` | — | Confirm email parser enrichment |
| `morning_routine` | — | Morning routine checklist |
| `generate_morning_routine` | — | AI-generate personalised morning routine |
| `morning_routine_toggle` | `id` | Toggle routine item checked |
| `morning_routine_add` | `item` | Add routine item |
| `morning_routine_delete` | `id` | Remove routine item |
| `morning_routine_move` | `id`, `direction` | Reorder routine item |
| `gym_log` | — | Gym session log |
| `gym_attend` | `id` | Mark gym session as attended |
| `gym_skip` | `id` | Mark gym session as skipped |
| `gym_backfill` | `startDate`, `endDate` | Backfill gym sessions from calendar |
| `purchase_history` | — | Purchase history + consumption predictions |
| `log_purchase_run` | `items` (JSON) | Log a grocery run |
| `purchase_suggestions` | — | Pantry auto-restock suggestions |
| `career` | — | Full career profile (position, goals, wins, development, network, progression) |
| `update_career_position` | `field`, `value` | Update career position field |
| `add_career_goal` | `title`, `horizon`, `category`, `notes` | Add career goal |
| `update_career_goal` | `id`, `field`, `value` | Update career goal |
| `delete_career_goal` | `id` | Remove career goal |
| `add_career_progression` | `title`, `company`, `startYear`, `endYear`, `type`, `highlights` | Add career history entry |
| `delete_career_progression` | `id` | Remove career progression entry |
| `add_career_development` | `item`, `type`, `targetDate`, `notes` | Add development item |
| `update_career_development` | `id`, `field`, `value` | Update development item |
| `delete_career_development` | `id` | Remove development item |
| `add_career_win` | `win`, `impact`, `category`, `date` | Log a career win |
| `delete_career_win` | `id` | Remove career win |
| `add_career_network` | `name`, `role`, `company`, `relationship`, `notes` | Add network contact |
| `update_career_network` | `id`, `field`, `value` | Update network contact |
| `delete_career_network` | `id` | Remove network contact |
| `prescriptions` | — | All active prescriptions |
| `add_prescription` | `person`, `medication`, `dosage`, `frequency`, `refillDate`, `notes` | Add prescription |
| `update_prescription` | `id`, `field`, `value` | Update prescription field |
| `delete_prescription` | `id` | Remove prescription |
| `cards` | — | Credit cards with rewards, perks, loyalty programs |
| `add_card` | (card fields) | Add credit card |
| `update_card` | `id`, `field`, `value` | Update card field |
| `delete_card` | `id` | Remove card |
| `add_card_reward` / `update_card_reward` / `delete_card_reward` | (reward fields) | Manage card reward rates |
| `add_card_perk` / `delete_card_perk` / `toggle_card_perk` | (perk fields) | Manage card perks |
| `add_loyalty_program` / `update_loyalty_program` / `delete_loyalty_program` | (program fields) | Manage loyalty programs |
| `add_rewards_goal` / `update_rewards_goal` / `delete_rewards_goal` | (goal fields) | Manage rewards goals |
| `get_gift_data` | — | Gift people + ideas |
| `add_gift_person` / `delete_gift_person` | `name` | Manage gift people |
| `add_gift_idea` / `delete_gift_idea` | `person`, `idea` | Manage gift ideas |
| `get_important_dates` | — | All important dates |
| `add_important_date` / `update_important_date` / `delete_important_date` | (date fields) | Manage important dates |
| `preview_calendar_birthdays` | — | Preview birthdays from Joint Chaos calendar |
| `import_calendar_birthdays` | — | Import birthdays from Joint Chaos calendar |
| `get_chores` | — | All chores with cadence and check status |
| `add_chore` / `delete_chore` / `toggle_chore` / `update_chore` | (chore fields) | Manage chores |
| `financial_goals` | — | Financial goals with progress |
| `add_financial_goal` / `update_financial_goal` / `delete_financial_goal` | (goal fields) | Manage financial goals |
| `simulate_scenario` | `goalId`, `changeType`, `amount` | What-if scenario calculation |
| `save_scenario` | `goalId`, `label`, `changeType`, `amount` | Save a scenario |
| `seed_financial_goals` | — | Seed sample financial goals |
| `get_vehicles` | — | All vehicles with service status |
| `add_vehicle` / `delete_vehicle` | (vehicle fields) | Manage vehicles |
| `vehicle_oil_change` | `id`, `date`, `mileage` | Log oil change |
| `vehicle_service` / `vehicle_mileage` / `vehicle_tire_change` | `id`, (fields) | Log vehicle events |
| `vehicle_emission_inspect` / `vehicle_safety_inspect` | `id`, `date` | Log inspection events |
| `get_contracts` | — | All contracts with expiry status |
| `add_contract` / `update_contract` / `delete_contract` | (contract fields) | Manage contracts |
| `log_contract_action` | `id`, `action` | Log an action against a contract |
| `get_guests` | — | Upcoming house guests |
| `get_profiles` / `save_profile` / `delete_profile` | (profile fields) | Manage traveler profiles |
| `get_growth` | — | Books, courses, skills |
| `add_book` / `update_book` / `delete_book` | (book fields) | Manage reading list |
| `add_course` / `update_course` / `delete_course` | (course fields) | Manage courses |
| `add_skill` / `update_skill` / `delete_skill` | (skill fields) | Manage skills |
| `record_practice` / `record_skill_practice` | `id`, `date` | Log skill practice session |
| `get_experiments` | — | All experiments with check-ins |
| `add_experiment` / `update_experiment` / `delete_experiment` | (experiment fields) | Manage experiments |
| `add_experiment_checkin` | `experimentId`, `note` | Log experiment check-in |
| `get_resources` / `add_resource` / `update_resource` / `delete_resource` | (resource fields) | Manage resource library |
| `fetch_resource_content` | `id` | Fetch and summarise a resource URL |
| `get_wish_lists` | — | Family/Christmas wish lists |
| `get_wish_list` | — | Personal wish list |
| `add_wish_item` / `update_wish_item` / `mark_wish_purchased` / `delete_wish_item` | (item fields) | Manage wish list |
| `add_bucket_activity` / `toggle_bucket_activity` / `delete_bucket_activity` | `bucketId`, `activity` | Manage bucket list activities |
| `get_pacing_status` | — | Current pacing/vacation mode status |
| `get_visa_requirements` | `passport`, `destination` | Visa requirements lookup |
| `health_appointments` | — | All tracked health appointments with next-due dates |
| `add_health_appointment` / `update_health_appointment` / `delete_health_appointment` | (appointment fields) | Manage health appointments |
| `log_health_visit` | `type`, `date` | Create DR: calendar event for a completed visit |
| `sync_life_plan_doc` | — | Sync Life Plan Google Doc to sheet |
| `saved_scenarios` | `goalId` | Get saved what-if scenarios for a goal |
| `dest_weather` | `destination`, `date` | Get weather forecast for a travel destination |

### POST Actions

| Action | Body Parameters | What it does |
|--------|----------------|-------------|
| `chat` | `message`, `session` | Send chat message (same as GET chat but supports longer payloads) |
| `acknowledge` | `id` | Acknowledge a flag |
| `snooze` | `id`, `days` | Snooze a flag |
| `resolve` | `id` | Resolve a flag |
| `add_takeout_restaurant` | `name`, `cuisine`, `phone`, `website`, `rating`, `notes` | Add takeout restaurant |
| `delete_takeout_restaurant` | `name` | Remove takeout restaurant and all its items |
| `add_takeout_item` | `restaurantName`, `item`, `description`, `rating`, `notes` | Add item to a takeout restaurant |
| `delete_takeout_item` | `restaurantName`, `item` | Remove a takeout item |
| `log_purchase_run` | `items` (JSON array) | Log a grocery/purchase run to Purchase History |

Slack Events API payloads (Block Kit interactions and slash commands as form-encoded) and Telegram webhook payloads are handled automatically without requiring the `token` parameter.

---

## File Structure

| File | Purpose |
|------|---------|
| `Code.js` | CONFIG, TABS constants, all column headers, `nightlyRun()`, `writeFlags()`, `setupVERA()`, `setupTriggers()`, `createSheetTabs()`, `morningNudge()`, `escalateAgedFlags_()`, `getConfigValues()` |
| `WebApp.js` | `doGet()` / `doPost()` JSON API bridge — all 200+ action routes |
| `Chat.js` | Conversational AI engine — system prompt, context builder, action dispatcher, proactive insights |
| `Claude.js` | `getApiKey()`, `buildPrompt()`, `generateFlags()`, `parseFlags()` |
| `Calendar.js` | `getUpcomingEvents()` — reads all Google Calendars with label/color/status |
| `Tasks.js` | `getOpenTasks()`, `parseFlexibleDate()`, `suggestDueDates()` |
| `Slack.js` | Slack bot — send/receive messages, Block Kit builders, App Home, event/interaction handlers |
| `Summaries.js` | `writeSummarySnapshot()` — Metrics + Summaries tab auto-population |
| `Finance.js` | SAT budget reader + Transactions reader; `getFinanceSummaries()` |
| `FinancialGoals.js` | Financial goals CRUD + what-if scenario simulator |
| `PTO.js` | PTO calendar parsing, stats computation, suggestion engine |
| `Goals.js` | Goals CRUD; `getGoals_()` |
| `Projects.js` | Projects CRUD; `getProjectsSummaryForContext_()` |
| `PatternRecognition.js` | Cross-domain pattern recognition — 7 compound patterns |
| `SignalLearning.js` | Flag engagement tracking, noise suppression, score engine |
| `Pacing.js` | Vacation mode, pacing mode, miss-rate checker, capacity mode |
| `Reminders.js` | Anticipator rule engine + Explorer daily discovery bulletin; `hourlyCheck()` |
| `WeekendPlanner.js` | Weekend Decision Memo — Monday 8am delivery |
| `PreTripBriefing.js` | 48-hour pre-trip briefing flag generation |
| `PostTripCapture.js` | Post-trip debrief prompt trigger |
| `TravelDayBriefing.js` | Day-of travel briefing |
| `FlightStatus.js` | Real-time flight status polling via AviationStack |
| `EmailParser.js` | Gmail travel confirmation email scanner + Claude batch classifier |
| `EmailAdmin.js` | Email follow-up tracking |
| `HealthTracker.js` | DR: calendar appointment tracker + interval-based flagging |
| `GymTracker.js` | EXERCISE calendar event scanner → Gym Log |
| `Fitness.js` | Weekly consistency checks + travel gap detection |
| `ImportantDates.js` | Birthday auto-sync from Joint Chaos calendar; important dates flagging |
| `MonthlyReview.js` | Monthly life review generator (1st of each month) |
| `MealPlan.js` | Weekly meal plan management + Saturday reset |
| `Pantry.js` | Purchase history EMA model + auto-restock predictions |
| `Shopping.js` | Shopping list CRUD; recipe-to-shopping |
| `Memory.js` | Memory event log (vacation start/end, etc.) |
| `Interests.js` | Shared Interest Ledger CRUD; `getSharedInterestLedger_()` |
| `Scheduler.js` | Utility scheduling helpers |
| `Weather.js` | OpenWeather API integration for ticker and destination forecasts |
| `Growth.js` | Books, courses, skills CRUD |
| `Experiments.js` | Experiment tracker + check-in log CRUD |
| `Contracts.js` | Contract CRUD + expiry flagging (`checkContracts_()`) |
| `appsscript.json` | OAuth scopes: Sheets, Calendar, UrlFetch, Mail, Drive, Tasks, Triggers, External requests |

---

## Setup & Deployment

### Step 1 — Create the Life OS Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it "VERA Life OS" (or anything you prefer).
3. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

### Step 2 — Set up clasp and push files

1. Install clasp: `npm install -g @google/clasp`
2. Log in: `clasp login`
3. In the repo directory: `clasp push`
4. Alternatively, use `push.ps1` to push to Apps Script and GitHub simultaneously.

### Step 3 — Set all Script Properties

In the Apps Script editor: **Project Settings → Script Properties → Add property**.

Minimum required:

| Property | Value |
|----------|-------|
| `VERA_SHEET_ID` | Your Life OS Sheet ID from Step 1 |
| `MORNING_NUDGE_EMAIL` | Your email address |
| `CLAUDE_API_KEY` | Your Anthropic API key |
| `VERA_WEB_TOKEN` | Any random string (e.g. generate with `openssl rand -hex 16`) |

Optional but recommended:

| Property | Value |
|----------|-------|
| `VERA_LOGO_FILE_ID` | Google Drive file ID of a VERA logo image |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (if using Slack integration) |
| `SLACK_CHAT_CHANNEL_ID` | Channel ID for #vera-chat |
| `SLACK_NOTIFICATIONS_CHANNEL_ID` | Channel ID for #vera-notifications |
| `SLACK_LOGS_CHANNEL_ID` | Channel ID for #vera-logs |
| `SAT_SHEET_ID` | Simple Ass Tracker Sheet ID (if using finance module) |
| `TRANSACTIONS_SHEET_ID` | Transactions Sheet ID (if using transaction tracking) |
| `AVIATIONSTACK_KEY` | AviationStack API key (if using flight status) |
| `OPENWEATHER_API_KEY` | OpenWeather API key (if using weather) |
| `VERA_SEARCH_API_KEY` | Serper.dev or Tavily API key (if using web search in chat) |

### Step 4 — Run setupVERA() once

In the Apps Script editor, select `setupVERA` from the function dropdown and click Run. This will:

- Create all sheet tabs with headers and default config rows
- Create the SignalLearning tab
- Install all 5 time-based triggers (`nightlyRun`, `morningNudge`, `hourlyCheck`, `checkFlightStatuses_`, `runEmailScan_`)

You will be prompted to authorise the required OAuth scopes. Approve all of them.

### Step 5 — Deploy as Web App

1. In the Apps Script editor: **Deploy → New deployment**
2. Type: **Web App**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Click **Deploy** — copy the Web App URL

### Step 6 — Set VERA_DASHBOARD_URL

1. Deploy the React dashboard to Netlify (or any static host).
2. Go back to Script Properties and add `VERA_DASHBOARD_URL` → your Netlify URL.
3. The morning email will now include an "Open VERA Dashboard →" button.

### Step 7 — Configure Slack (optional)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Add the `chat:write`, `channels:history`, `app_mentions:read`, and `users:read` scopes.
3. Enable the Events API. Set the request URL to your Web App URL.
4. Subscribe to the `message.channels` event type.
5. Install the app to your workspace and copy the Bot OAuth token → `SLACK_BOT_TOKEN`.
6. Add the bot to your three channels and copy each channel ID → the respective Script Properties.
7. Add `SLACK_AHMED_USER_ID`, `SLACK_VICTORIA_USER_ID`, and `SLACK_ALLOWED_USER_IDS`.

### Step 8 — Add Config tab rows for customisation

After running `setupVERA()`, the Config tab will be seeded with defaults. Customise as needed:

```
calendar_label:Ahmed            | personal
calendar_label:Victoria         | household partner
calendar_label:Eraky Family     | family (shared)
skip_calendars                  | Holidays in United States, Birthdays
weather_location                | Austin, TX
weekend_planner_home_city       | Austin, TX
```

### Step 9 — Redeploying after code changes

**Important:** every time you push code changes, you must create a **new deployment version** for the changes to take effect in the Web App endpoint.

1. Push changes: `clasp push` or run `push.ps1`
2. In Apps Script editor: **Deploy → Manage deployments**
3. Click the edit pencil on your active deployment
4. Select **New version** and click **Deploy**
5. The Web App URL stays the same — no need to update the dashboard.

The dashboard will pick up new behaviour on the next page load. Chat history is preserved in Script Properties across redeploys.
