# VERA — Virtual Executive & Reminder Assistant

> Your personal chief of staff, built on Google Apps Script + Claude AI.

VERA runs silently in the background of your life. Every night it reads your calendar, tasks, finances, PTO, and shared life goals, then calls Claude AI to generate a prioritised list of flags. At 7 AM it delivers those flags to your inbox. A React dashboard lets you acknowledge, snooze, or resolve them at any time.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Design Layers](#design-layers)
3. [Intelligence Engines](#intelligence-engines)
4. [Interfaces](#interfaces)
5. [System Timing & Automation](#system-timing--automation)
6. [Data Model — Sheet Tabs](#data-model--sheet-tabs)
7. [Config Tab Reference](#config-tab-reference)
8. [Script Properties Reference](#script-properties-reference)
9. [User Workflows](#user-workflows)
10. [How VERA Communicates & Intervenes](#how-vera-communicates--intervenes)
11. [Dashboard API Reference](#dashboard-api-reference)
12. [File Structure](#file-structure)
13. [Setup & Deployment](#setup--deployment)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                             │
│  Google Calendar  ·  Tasks Sheet  ·  Transactions Sheet         │
│  Simple Ass Tracker  ·  External Sheets  ·  Shared Interests    │
└────────────────────────────┬────────────────────────────────────┘
                             │  nightly read
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  INTELLIGENCE ENGINES (Apps Script)             │
│  Calendar.js · Tasks.js · Finance.js · PTO.js · Summaries.js   │
│  Reminders.js · WeekendPlanner.js · Interests.js               │
└────────────────────────────┬────────────────────────────────────┘
                             │  structured context
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLAUDE AI  (claude-sonnet-4-6)                     │
│  buildPrompt() → generateFlags() → parseFlags()                 │
│  Max 8 flags per night · stable dedup keys · urgency tiers      │
└────────────────────────────┬────────────────────────────────────┘
                             │  FLAG-YYYYMMDD-NN rows
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LIFE OS GOOGLE SHEET                        │
│  Flags · Tasks · Projects · Goals · PTO · Summaries · Metrics  │
│  Transactions · Shopping · Interests · Config                   │
└──────┬─────────────────────────────┬──────────────────────────-─┘
       │ 7 AM email                  │ REST API (VERA_WEB_TOKEN)
       ▼                             ▼
┌─────────────┐          ┌───────────────────────┐
│  Gmail      │          │  React Dashboard       │
│  Morning    │          │  docs/index.html        │
│  Nudge      │          │  (hosted on Netlify or  │
│             │          │   opened as local file) │
└─────────────┘          └───────────────────────┘
```

---

## Design Layers

VERA is organised into four distinct layers:

### Layer 1 — Data Collection
Raw intelligence gathered from connected sources each night:
- **Calendar events** — all Google Calendars for the next 7 days, with RSVP status and event colour
- **Open tasks** — from the Tasks sheet, sorted by urgency (overdue → neglected → pending)
- **Financial metrics** — transaction pivot by category (2-month comparison) + SAT budget sheet
- **PTO & leave** — vacation days remaining, burn-down pace, upcoming travel, clear windows
- **Shared interests** — an interest ledger for Ahmed & Victoria, cross-referenced against events
- **External sheet metrics** — any Google Sheet cell wired up via `summary_sheet:*` config rows

### Layer 2 — Intelligence Processing
Each engine transforms raw data into structured facts for Claude:
- Calendars are labelled (`personal`, `shared`, or a custom label from Config)
- Tasks are aged, scored as overdue or neglected, and optionally given AI-suggested due dates
- Transactions are pivoted by category, skip-list filtered, and formatted as `$X vs $Y in Mon (+Z%)`
- PTO is classified into a 3-2-1 framework (long weekends · mid-size weeks · big pivot trips)
- Summaries are auto-written to the Metrics and Summaries tabs before Claude is called

### Layer 3 — AI Reasoning (Claude)
A structured prompt packages all of Layer 2's output with explicit reasoning rules:
- When to flag a calendar event (e.g., unresponded RSVP, colour-tagged event)
- When to flag a spending category (>20% AND >$30 over prior month)
- When to flag PTO pace (behind on burn-down, buffer days idle)
- When to cross-reference the interest ledger against upcoming events
- Output: a JSON array of up to 8 flags, each with `source · flag · reason · urgency · key`

### Layer 4 — Delivery & Actioning
Flags are written to the sheet and surfaced through two channels:
- **Email** — morning nudge at 7 AM, grouped by urgency, with a dashboard link
- **Dashboard** — live React UI with acknowledge / snooze / resolve actions, plus full CRUD for tasks, projects, goals, and shopping

---

## Intelligence Engines

### `Calendar.js` — Calendar Intelligence
Reads all Google Calendars via `CalendarApp.getAllCalendars()`.

| Feature | Detail |
|---------|--------|
| Look-ahead window | `calendar_days_ahead` (default 7) |
| RSVP status | `organizer · accepted · declined · tentative · invited (no response)` |
| Event colour capture | Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato |
| Calendar labelling | Custom via `calendar_label:CalName` · owned = `personal (CalName)` · unowned = `shared: CalName` |
| Skip list | Calendars named in `skip_calendars` are silently ignored |

---

### `Tasks.js` — Task Intelligence
Reads the Tasks sheet and surfaces overdue and neglected work.

| Feature | Detail |
|---------|--------|
| Overdue detection | `daysUntilDue < 0` |
| Neglected detection | Age ≥ `task_age_threshold_days` (default 7) |
| AI due-date suggestion | `suggestDueDates()` — Claude proposes dates for undated tasks, written with `[VERA: reason]` in Notes |
| Sort order | Overdue first → then oldest neglected → then pending |
| Flexible date parsing | Handles Date objects, strings, and Google Sheets serial numbers |

---

### `Finance.js` — Finance Intelligence
Two sub-engines: Simple Ass Tracker (SAT) and Transactions.

**Transaction Engine:**
- Reads Empower-format CSV from a separate Transactions Sheet (`TRANSACTIONS_SHEET_ID`)
- Auto-detects 2 most recent complete months (current month always excluded)
- Groups spending by category, skip-list filtered
- Outputs: Total Spending + top 10 categories + "Other N" bucket
- Sign convention: negative = expense, positive = income/credit (income rows skipped)

**SAT Engine:**
- Reads the budget tracker (Ahmed + Victoria + Shared columns)
- Auto-detects horizontal or vertical layout
- Extracts: Net Expenses, Disposable Income per person, plus Shared totals
- Parses both `$1,234` and `(500)` negative notation

---

### `PTO.js` — PTO / Leave Intelligence
The most sophisticated engine. Tracks your full vacation year.

**PTO Classification:**
| Pattern | Classification |
|---------|----------------|
| All-day event titled "Vacation" | Vacation block (workday-counted) |
| All-day event titled "PTO" | Personal time (8 hrs/day) |
| Timed event titled "PTO" | Personal time (exact duration) |
| Matches `holiday_keywords`, all-day | Company holiday (excluded from PTO count) |
| Matches `ignore_keywords` | Skipped entirely (e.g., "Pay Day") |

**3-2-1 Framework:**

| Tier | Target | Definition |
|------|--------|-----------|
| Long Weekends | 3/year | ≤ 3 workdays, ≤ 5 calendar days |
| Mid-Size Weeks | 2/year | 4–7 workdays |
| Big Pivot | 1/year | > 7 workdays |

**Clear Window Finder:** Scans gap calendars for runs of 3+ consecutive clear workdays over the next 90 days. Suggestions are written as all-day events to your Vera calendar (Sage colour). If you delete a suggestion, VERA marks it as declined and never re-suggests that window.

**Milestone Detection:** Scans gap calendars for all-day events whose titles match `milestone_keywords`. Each milestone is surfaced in the PTO tab and the Milestones dashboard tab with a live countdown.

---

### `Summaries.js` — Metrics Auto-Population
Runs at the very start of `nightlyRun()` before Claude is called.

**Metrics tab** (VERA's self-monitoring — fully automatic):
| Metric | Description |
|--------|-------------|
| `open_count` | Total non-completed tasks |
| `overdue_count` | Tasks past their due date |
| `due_within_7_days` | Tasks due soon but not yet overdue |
| `neglected_count` | Tasks older than `task_age_threshold_days` |
| `events_next_7_days` | Upcoming calendar events |
| `events_today` | Events happening today |
| `events_with_location` | Events with a physical location |
| `active_count` | Flags that are unacknowledged and unresolved |
| `high_count` | High-urgency active flags |
| `medium_count` | Medium-urgency active flags |

**Summaries tab** (external data — Config-driven):
- Any `summary_sheet:SourceName` row in Config wires a Google Sheet cell to the Summaries tab
- Finance rows (`[AUTO] Transactions`, `[AUTO] Simple Ass Tracker`) are written here automatically
- Manual rows in the Summaries tab are never touched (only `[AUTO]`-tagged rows are overwritten)

---

### `Reminders.js` — Anticipator & Explorer
Two proactive intelligence patterns:

**Anticipator** (runs hourly): Scans upcoming calendar events for items that require pre-event preparation reminders. Creates reminder events in the Vera calendar if a cooldown window hasn't passed.

**Explorer** (runs nightly): Produces a bulletin of interesting things to explore or act on, based on interests, upcoming events, and open tasks.

---

### `WeekendPlanner.js` — Weekend Planning Engine
Activated by `weekend_planner_enabled` in Config. Analyses the upcoming weekend and suggests activities based on interests, open tasks, and calendar gaps. Writes a Weekend Memo as a calendar event to the Vera calendar.

---

### `Telegram.js` — Telegram Bot Integration
Receives inbound messages via webhook (doPost). Messages are queued in CacheService and processed asynchronously via a one-shot trigger to avoid Apps Script timeout limits. Responses are delivered back through the Telegram Bot API.

---

## Interfaces

### Interface 1 — Morning Email (7 AM)

VERA sends a styled HTML email every morning *only if there are active flags*.

| Element | Detail |
|---------|--------|
| Sender | "VERA" (from `MORNING_NUDGE_EMAIL` Script Property) |
| Logo | Loaded from Google Drive (`VERA_LOGO_FILE_ID`); falls back to dark text banner |
| Content | Urgency breakdown (High · Medium · Low dots), total active count |
| Links | "Open VERA Dashboard →" (if `VERA_DASHBOARD_URL` is set) + Life OS sheet link |
| Skip logic | No email sent if zero active flags — no noise on quiet nights |

---

### Interface 2 — React Dashboard

A self-contained single-page app (`docs/index.html`) — no build step, no server required.

**Setup:** Enter your Web App URL and `VERA_WEB_TOKEN` in the Settings modal (⚙). Credentials persist in `localStorage`.

**Home Tab bento cards:**

| Card | Shows |
|------|-------|
| Active Flags | Count + High/Med/Low breakdown + top flag |
| Tasks | Open count · overdue count · next task |
| Projects | Project count · top 3 with pending task counts |
| Shopping | Total pending items · per-store breakdown |
| PTO | Vacation days remaining · personal hours · next PTO countdown |
| Milestones | Upcoming events · days until · linked item count |
| Spending Chart | Category bar chart: current vs prior month |

**Flag actions:**
| Action | Effect |
|--------|--------|
| ✓ Acknowledge | Marks flag as seen; removes from active view |
| 💤 Snooze 2d | Hides flag for 2 days; returns automatically |
| ✅ Resolve | Closes flag permanently |

**Urgency escalation (automatic):**
- At 3 days unacknowledged: urgency bumped one tier (Low → Medium → High)
- At 7 days unacknowledged: `"[Stale: open for 7+ days]"` appended to Reason

---

### Interface 3 — Vera Calendar

VERA writes three types of events to your dedicated Vera Google calendar:

| Event Type | Colour | Trigger |
|-----------|--------|---------|
| PTO Window Suggestion | Sage (green) | Clear 3+ workday window found |
| Buffer Day Alert | Banana (yellow) | Buffer days idle + no PTO soon |
| Milestone Countdown | Mauve (Grape) | Upcoming milestone detected |

Deleting a PTO suggestion event tells VERA not to suggest that window again.

---

### Interface 4 — Telegram Bot *(optional)*

Connect a Telegram bot to receive flag summaries and send commands. Configure via `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Script Properties. Messages are processed asynchronously to respect Apps Script timeout limits.

---

## System Timing & Automation

VERA installs three time-based triggers via `setupTriggers()`:

| Trigger | Time | Function | Purpose |
|---------|------|----------|---------|
| `nightlyRun` | 11 PM daily | `nightlyRun()` | Full intelligence pipeline |
| `morningNudge` | 7 AM daily | `morningNudge()` | Send flag summary email |
| `hourlyCheck` | Every hour | `hourlyCheck()` | Anticipator reminders |

### Nightly Pipeline Sequence (`nightlyRun`, 11 PM)

```
 1. escalateAgedFlags_()        ← bump urgency on stale unacknowledged flags
 2. writeSummarySnapshot()      ← refresh Metrics + Summaries tabs
 3. writePTOSnapshot_()         ← compute PTO stats, update Vera calendar
 4. runExplorer_()              ← generate Explorer bulletin
 5. getUpcomingEvents()         ← read all calendars (7 days)
 6. getOpenTasks()              ← read Tasks sheet
 7. getSummaries()              ← merge Metrics + Summaries for Claude
 8. getSharedInterestLedger_()  ← read Ahmed & Victoria interests
 9. suggestDueDates(tasks)      ← AI due-date suggestions for undated tasks
10. generateFlags(...)          ← call Claude API, parse JSON response
11. writeFlags(flags)           ← deduplicate + write + colour-code to Flags tab
```

### Flag Deduplication

VERA uses a stable "key" system to prevent re-flagging the same issue every night:
- Claude generates a snake_case key per flag (e.g., `verizon_bill_march_13`)
- Before writing, `getExistingFlagFingerprints_()` checks all unresolved flags
- A flag is skipped if its key already exists in the sheet
- Resolved flags can be re-flagged if the issue genuinely recurs

---

## Data Model — Sheet Tabs

All data lives in a single Google Sheet ("Life OS").

### Flags
| Column | Field | Notes |
|--------|-------|-------|
| A | ID | `FLAG-YYYYMMDD-NN` |
| B | Date | ISO date |
| C | Source | `Calendar · Tasks · Finance · Summaries · General` |
| D | Flag | One-line alert text |
| E | Reason | Detailed explanation |
| F | Urgency | `High · Medium · Low` |
| G | Acknowledged | `Yes / No` |
| H | Snoozed Until | ISO date (blank if not snoozed) |
| I | Resolved | `Yes / No` |
| J | Key | Stable snake_case dedup key |
| K | Escalated | `3d · 7d` (set by escalation engine) |

### Tasks
| Column | Field |
|--------|-------|
| A | ID (`TASK-YYYYMMDD-NN`) |
| B | Task |
| C | Added Date |
| D | Due Date |
| E | Status |
| F | Recurring |
| G | Notes |
| H | Flagged |

### Projects
`Project ID · Project Name · Task · Status · Priority · Due Date · Notes`

### Goals
`ID · Title · Description · Status (Resolutions/To Do/Doing/Parked/Done) · Category · Year · Progress % · Notes`

### PTO
Auto-populated nightly by `writePTOSnapshot_()`. Stores vacation balance, burn-down stats, clear windows, and milestones.

### Metrics (auto)
Written by `writeMetrics_()` each night. All rows tagged `[AUTO]` — wiped and rewritten on every run.

### Summaries (auto + manual)
- `[AUTO]` rows: Finance, external sheet metrics — wiped and rewritten nightly
- Manual rows: Your own notes — never touched by VERA

### Transactions
Separate Google Sheet (Empower CSV format): `Date · Account · Description · Category · Tags · Amount`

### Config
Key-value settings that drive all engine behaviour. See [Config Tab Reference](#config-tab-reference).

---

## Config Tab Reference

The Config tab is a two-column sheet (`Setting | Value`). All behaviour is controlled here — no code changes needed.

### Core Settings

| Key | Default | Description |
|-----|---------|-------------|
| `calendar_days_ahead` | `7` | How many days ahead to scan calendars |
| `task_age_threshold_days` | `7` | Days before a task is considered "neglected" |
| `skip_calendars` | *(blank)* | Comma-separated calendar names to ignore entirely |
| `calendar_label:CalName` | *(varies)* | Custom label for a specific calendar. Add one row per calendar. E.g. key=`calendar_label:Work`, value=`work` |

### Finance Settings

| Key | Default | Description |
|-----|---------|-------------|
| `finance_skip_categories` | See below | Comma-separated transaction categories to exclude from the spending chart |

Default skip list: `Income, Paycheck, Salary, Direct Deposit, Transfer, Transfers, Credit Card Payment, Credit Card Payments, Payment, Investments, Investment Income, Savings, Refund, Securities Trades`

### PTO Settings

All PTO keys use the `pto_` prefix.

| Key | Default | Description |
|-----|---------|-------------|
| `pto_calendar_name` | `Verizon Calendar` | Work calendar where PTO blocks appear |
| `pto_vera_calendar` | `Vera` | Calendar where VERA writes recommendations |
| `pto_vacation_days` | `20` | Annual vacation pool |
| `pto_personal_hours` | `48` | Annual personal time hours |
| `pto_year` | current year | Year to analyse |
| `pto_rollover_days` | `0` | Vacation days carried over from prior year |
| `pto_buffer_days` | `3` | Days held in reserve (subtracted from "available") |
| `gap_calendars` | `Verizon Calendar, AE&VV - Our Joint Chaos` | Comma-separated calendars scanned for travel, clear windows, and milestones |
| `milestone_keywords` | `Wedding,Graduation,Trip,Travel,Concert,Birthday` | Keywords that flag an event as a milestone |
| `holiday_keywords` | `Day,Holiday,Floating,Closure` | Keywords that identify company holidays |
| `ignore_keywords` | `Pay Day` | Keywords to skip entirely |
| `travel_ignore_keywords` | `Ramadan,Eid,Lent,Holiday,...` | Keywords to exclude from "Upcoming Travel" detection |
| `pto_buffer_remaining` | *(auto-calculated)* | Remaining buffer days (managed by VERA, do not edit manually) |

### Weekend Planner Settings

| Key | Default | Description |
|-----|---------|-------------|
| `weekend_planner_enabled` | `false` | Set to `true` to activate weekend planning |
| `lookahead_days` | `7` | How many days ahead to plan |
| `home_city` | *(blank)* | Your home city (used for local suggestions) |

### External Sheet Hooks

Wire any Google Sheet cell into the Summaries tab:

```
Key:   summary_sheet:SourceName
Value: SheetID|TabName|CellRef|metric_name
```

Example rows:
```
summary_sheet:SimpleAssTracker  →  1aBcXyZ|Budget|B2|checking_balance
summary_sheet:Fitness           →  1xYzAbC|Log|D4|gym_sessions_this_week
```

VERA reads these cells nightly and writes them as `[AUTO]` rows in the Summaries tab. Claude sees them as context.

---

## Script Properties Reference

Set these in Apps Script → Project Settings → Script Properties:

| Property | Required | Description |
|----------|----------|-------------|
| `VERA_SHEET_ID` | ✅ | Google Sheet ID of your Life OS sheet |
| `MORNING_NUDGE_EMAIL` | ✅ | Email address to receive the morning nudge |
| `CLAUDE_API_KEY` | ✅ | Anthropic API key |
| `VERA_WEB_TOKEN` | ✅ | Any random string — used to authenticate dashboard API calls |
| `VERA_LOGO_FILE_ID` | ☆ | Google Drive file ID for the VERA logo used in emails |
| `VERA_DASHBOARD_URL` | ☆ | URL of your hosted dashboard; adds an "Open Dashboard" button to emails |
| `SAT_SHEET_ID` | ☆ | Sheet ID for Simple Ass Tracker budget spreadsheet |
| `TRANSACTIONS_SHEET_ID` | ☆ | Sheet ID for Empower-format Transactions spreadsheet |
| `TELEGRAM_BOT_TOKEN` | ☆ | Telegram bot token (optional Telegram integration) |
| `TELEGRAM_CHAT_ID` | ☆ | Your Telegram chat ID (optional Telegram integration) |

✅ = required for core functionality  ☆ = optional feature unlock

---

## User Workflows

### Workflow 1 — Daily Review (2 min)
1. Open the 7 AM email from VERA
2. Scan the flag list by urgency
3. Click "Open VERA Dashboard →" for any flags you want to action
4. Acknowledge flags you've seen, snooze ones to revisit, resolve ones that are done

### Workflow 2 — Task Management
1. Open the **Tasks** tab in the dashboard
2. Overdue tasks surface in red at the top; neglected tasks (7+ days old) in amber
3. Check the box to mark a task complete
4. Click the pencil icon to edit due date or notes
5. Use **Add Task** to log new items; VERA will suggest a due date overnight

### Workflow 3 — Project Tracking
1. Open the **Projects** tab
2. Each project has its own sub-tab of tasks
3. Add, edit, or complete individual project tasks from the dashboard
4. VERA flags projects with stale tasks in its nightly run

### Workflow 4 — PTO Planning
1. Open the **PTO** tab to see your burn-down pace
2. VERA surfaces "clear windows" in your Vera Google Calendar (Sage events)
3. Accept a suggestion by leaving it alone; decline by deleting the calendar event
4. If VERA detects unused buffer days sitting idle, it places a yellow alert on the following Friday

### Workflow 5 — Milestone Awareness
1. Add an all-day event to any calendar in `gap_calendars` with a title matching `milestone_keywords`
   (e.g., "Cancun Vacation" on your family calendar)
2. VERA detects it overnight
3. The **Milestones** tab shows a countdown card, and auto-links any flags or tasks whose text mentions the event keyword
4. The Home tab bento card shows the next 3 milestones with item counts

### Workflow 6 — Finance Monitoring
1. Export transactions from Empower and paste into your Transactions sheet
2. Run `testRun()` (or wait for the 11 PM trigger) to refresh Finance summaries
3. The **Summaries** tab and Home **Spending Chart** will show current-vs-prior-month breakdown
4. VERA flags any category that's >20% AND >$30 over the prior month

### Workflow 7 — Interest & Activity Logging
1. Open the **Interests** tab
2. Log anything Ahmed or Victoria finds interesting (restaurants, hobbies, events)
3. VERA cross-references the ledger against upcoming calendar events nightly
4. Example: logging "Ethiopian food" interest → VERA flags "Ethiopian Food Festival in 3 days" automatically

### Workflow 8 — Adding External Metrics
1. Find the Sheet ID and cell reference of the metric you want to track
2. Add a row to Config: key = `summary_sheet:SourceName`, value = `SheetID|TabName|CellRef|metric_name`
3. Next nightly run: VERA reads the cell and surfaces it in Summaries and to Claude

---

## How VERA Communicates & Intervenes

### Proactive Flags
VERA never waits to be asked. Each night it analyses all connected data sources and generates actionable alerts:

| Source | Example flag |
|--------|-------------|
| **Calendar** | "You have a tentative RSVP for a meeting in 2 days — no response yet" |
| **Calendar** | "No events at all next week — unusual gap in your schedule" |
| **Tasks** | "Task 'Submit Q1 Report' is 9 days old with no due date and no progress" |
| **Finance** | "Dining out is $480 in Feb vs $290 in Jan (+66%) — check if one-off or trend" |
| **Finance** | "Disposable income is unusually low this month based on SAT data" |
| **PTO** | "You've used only 3 of 20 vacation days and are 4 days behind the ideal pace" |
| **PTO** | "Buffer days are sitting idle — no PTO planned in the next 21 days" |
| **Interests** | "You logged interest in jazz concerts — there's a jazz festival in 5 days" |

### Urgency Tiers
| Tier | Colour | Meaning |
|------|--------|---------|
| High | 🔴 Red | Requires attention soon; will escalate further if ignored |
| Medium | 🟡 Yellow | Worth addressing this week |
| Low | 🟢 Green | Informational; address when convenient |

### Escalation
VERA monitors how long flags go unacknowledged:
- **Day 3:** Urgency bumped one tier (Low → Medium, Medium → High)
- **Day 7:** Reason field updated with `[Stale: open for 7+ days — needs attention]`

### Snooze Logic
Snoozing a flag sets a "Snoozed Until" date. The flag is hidden from the active view and email during the snooze window. It reappears automatically once the snooze expires — it is not deleted.

### Calendar Interventions
VERA writes directly to your **Vera** calendar:
- **PTO suggestions** (Sage): "Clear window: Mon Jul 7 – Wed Jul 9 (3 workdays, Long Weekend opportunity)"
- **Buffer day alerts** (Banana): Placed on the next Friday when buffer days sit unused for 21+ days
- **Milestone countdowns** (Grape): "📍 Cancun Vacation: 47 days" placed on the Monday of the milestone week

### Email Delivery Rules
- Email is sent **only if** there are active (unacknowledged + unresolved) flags
- Content is pre-sorted High → Medium → Low
- Quiet nights (all flags resolved or snoozed) produce no email — no spam

---

## Dashboard API Reference

All requests authenticated via `?token=VERA_WEB_TOKEN`.

### Read Actions (GET)

| Action | Parameters | Response |
|--------|-----------|---------|
| `status` | — | `{activeFlags, high, medium, low, totalFlags, lastRun}` |
| `flags` | — | All flags |
| `flags` | `filter=active` | Unacknowledged + unresolved only |
| `tasks` | — | Open tasks |
| `summaries` | — | Summaries tab rows |
| `projects` | — | All projects + tasks |
| `goals` | — | All goals |
| `shopping` | — | Stores with item lists |
| `pto` | — | PTO stats + milestones + clear windows |
| `interests` | — | Shared interest ledger |
| `chat` | `message=TEXT, session=ID` | Claude conversational reply |

### Write Actions (GET with side-effects)

| Action | Parameters | Effect |
|--------|-----------|--------|
| `acknowledge` | `id=FLAG-xxx` | Marks acknowledged |
| `snooze` | `id=FLAG-xxx, days=N` | Snoozes for N days (default 2) |
| `resolve` | `id=FLAG-xxx` | Marks resolved |
| `complete_task` | `id=TASK-xxx` | Marks task done |
| `add_task` | `task, dueDate, notes` | Appends new task row |
| `update_task` | `id, task, dueDate, notes` | Updates task in place |
| `shopping_toggle` | `tabId, index` | Toggles item checked state |
| `shopping_add` | `tabId, text` | Adds item to store |
| `complete_project_task` | `row` | Marks project task done |
| `add_project_task` | `projectId, task, priority, dueDate, notes` | Adds project task |
| `update_project_task` | `row, task, priority, dueDate, notes` | Updates project task |
| `delete_project_task` | `row` | Removes project task row |
| `add_goal` | `title, description, status, category, year, notes` | Creates goal |
| `update_goal` | `id, [fields...]` | Partial-updates goal |
| `delete_goal` | `id` | Removes goal |
| `interests_add` | `person, interest, category, notes` | Logs new interest |
| `interests_delete` | `id` | Archives interest |

---

## File Structure

```
VERA-My-Chief-of-Staff/
│
├── Code.js              Core — nightlyRun(), morningNudge(), setupVERA(), CONFIG
├── WebApp.js            REST API — doGet(), doPost(), all route handlers
├── Claude.js            AI — buildPrompt(), generateFlags(), parseFlags()
├── Calendar.js          Intelligence — getUpcomingEvents()
├── Tasks.js             Intelligence — getOpenTasks(), suggestDueDates()
├── Finance.js           Intelligence — transaction pivot, SAT budget reader
├── Summaries.js         Auto-populate — writeSummarySnapshot()
├── PTO.js               Intelligence — PTO burn-down, milestones, clear windows
├── Reminders.js         Intelligence — Anticipator (hourly) + Explorer (nightly)
├── WeekendPlanner.js    Intelligence — weekend planning, Vera calendar events
├── Interests.js         CRUD — Shared Interest Ledger
├── Goals.js             CRUD — Yearly goals Kanban
├── Projects.js          CRUD — Project + task tracking
├── Shopping.js          CRUD — Multi-store shopping lists
├── Chat.js              Conversational — session-aware Claude chat
├── Telegram.js          Integration — Telegram bot webhook + async queue
├── Scheduler.js         Utilities — trigger management helpers
│
├── appsscript.json      OAuth scopes + V8 runtime config
├── .clasp.json          clasp scriptId + rootDir
├── push.ps1             Deploy script (clasp push + git push simultaneously)
│
└── docs/
    └── index.html       React SPA dashboard (self-contained, no build step)
```

---

## Setup & Deployment

### Prerequisites
- Google account with Apps Script enabled
- [clasp](https://github.com/google/clasp) installed (`npm install -g @google/clasp`)
- Anthropic API key

### Step 1 — Clone & Push
```bash
git clone https://github.com/aaeleraky/VERA-My-Chief-of-Staff
cd VERA-My-Chief-of-Staff
clasp login
clasp push
```

### Step 2 — Set Script Properties
In the Apps Script editor: **Project Settings → Script Properties**, add:
```
VERA_SHEET_ID         = (your Life OS Sheet ID)
MORNING_NUDGE_EMAIL   = (your email)
CLAUDE_API_KEY        = (sk-ant-...)
VERA_WEB_TOKEN        = (any random string, e.g. "mySecretToken123")
```

### Step 3 — Run Setup
In the Apps Script editor, run `setupVERA()` once. This:
- Creates all sheet tabs with headers and formatting
- Seeds the Config tab with default values
- Installs the three time-based triggers (11 PM · 7 AM · hourly)

### Step 4 — Deploy the Web App
- Apps Script editor → **Deploy → New deployment**
- Type: **Web App**
- Execute as: **Me**
- Who has access: **Anyone**
- Copy the Web App URL

### Step 5 — Configure the Dashboard
- Open `docs/index.html` in a browser (or deploy to Netlify/GitHub Pages)
- Click ⚙ Settings
- Paste the Web App URL and your `VERA_WEB_TOKEN`
- Click Save → the dashboard loads immediately

### Step 6 — Optional Enhancements
| Optional step | What it unlocks |
|---------------|----------------|
| Set `VERA_LOGO_FILE_ID` | VERA logo in morning email |
| Set `VERA_DASHBOARD_URL` | "Open Dashboard" button in morning email |
| Set `SAT_SHEET_ID` | Budget tracking from Simple Ass Tracker |
| Set `TRANSACTIONS_SHEET_ID` | Spending category charts |
| Add `calendar_label:*` rows to Config | Clean calendar labels in flags and emails |
| Add `summary_sheet:*` rows to Config | External metric hooks (fitness, finance, etc.) |
| Enable `weekend_planner_enabled=true` | Weekend planning engine |
| Configure Telegram properties | Telegram bot integration |

### Pushing Updates
Use `push.ps1` to deploy code and push to GitHub simultaneously:
```powershell
.\push.ps1
```
After pushing, create a **new Web App deployment version** in Apps Script for code changes to take effect.

### Running Tests
In the Apps Script editor, run `testRun()` to immediately execute the full nightly pipeline. Useful for:
- Verifying Finance and PTO configs are correct
- Refreshing the Summaries tab after adding external sheet hooks
- Testing a new Config setting without waiting for 11 PM

---

*Built with Google Apps Script · Claude AI · React · ☕*
