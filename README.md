# VERA — Virtual Executive & Reminder Assistant

> Your personal chief of staff, built on Google Apps Script + Claude AI.

VERA runs silently in the background of your life. Every night it reads your calendar, tasks, finances, PTO, travel plans, interests, and shared life goals, then calls Claude AI to generate a prioritised list of flags. At 7 AM it delivers those flags to your inbox. A React dashboard and a full conversational chat interface let you view, manage, and act on every domain of your life — from adding a recipe to booking a packing list — in plain English.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Design Layers](#design-layers)
3. [Intelligence Engines](#intelligence-engines)
4. [Interfaces](#interfaces)
5. [Chat — Conversational Interface](#chat--conversational-interface)
6. [Travel Module](#travel-module)
7. [Life OS Data Domains](#life-os-data-domains)
8. [System Timing & Automation](#system-timing--automation)
9. [Data Model — Sheet Tabs](#data-model--sheet-tabs)
10. [Config Tab Reference](#config-tab-reference)
11. [Script Properties Reference](#script-properties-reference)
12. [User Workflows](#user-workflows)
13. [How VERA Communicates & Intervenes](#how-vera-communicates--intervenes)
14. [Dashboard API Reference](#dashboard-api-reference)
15. [File Structure](#file-structure)
16. [Setup & Deployment](#setup--deployment)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│  Google Calendar · Tasks · Transactions Sheet · Simple Ass Tracker           │
│  External Sheets · Shared Interests · AviationStack · OpenWeatherMap         │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │  nightly read
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE ENGINES (Apps Script)                      │
│  Calendar · Tasks · Finance · PTO · Summaries · Reminders · WeekendPlanner   │
│  FlightStatus · Weather · Interests · Goals · Projects · SignalLearning      │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │  structured context
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       CLAUDE AI  (claude-sonnet-4-6)                         │
│  Nightly: buildPrompt() → generateFlags() → parseFlags()                     │
│  Chat:    buildChatSystemPrompt_() → callClaudeChat_() → executeActions_()   │
│  Max 8 flags/night · stable dedup keys · urgency tiers · 40+ chat actions    │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │  FLAG / ACTION rows
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        LIFE OS GOOGLE SHEET (21 tabs)                        │
│  Flags · Tasks · Projects · Goals · PTO · Summaries · Metrics · Interests    │
│  Ideas · Shopping · Recipes · Home Items · Itinerary · Packing Items         │
│  Countries · Bucket List · Transactions · Config · Milestones                │
└────────┬───────────────────────────┬─────────────────────────────────────────┘
         │ 7 AM email                │ REST API (VERA_WEB_TOKEN)
         ▼                           ▼
┌──────────────┐       ┌──────────────────────────────────────────────────────┐
│  Gmail       │       │  React Dashboard (docs/index.html)                   │
│  Morning     │       │  Home · Flags · Tasks · Projects · Goals · Shopping  │
│  Nudge       │       │  PTO · Milestones · Interests · Ideas · Travel       │
│              │       │  Home Items · Recipes · Countries · Bucket List      │
└──────────────┘       │  + Chat panel (conversational VERA)                  │
                       └──────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌──────────────┐       ┌──────────────────────────────────────────────────────┐
│  Telegram    │       │  Vera Google Calendar                                │
│  Bot         │       │  PTO suggestions · Buffer alerts · Milestones        │
└──────────────┘       └──────────────────────────────────────────────────────┘
```

---

## Design Layers

VERA is organised into four distinct layers:

### Layer 1 — Data Collection
Raw intelligence gathered from connected sources each night:
- **Google Calendar events** — all calendars for the next 7 days, with RSVP status and event colour
- **Open tasks** — from the Tasks sheet, sorted by urgency (overdue → neglected → pending)
- **Financial metrics** — transaction pivot by category (2-month comparison) + SAT budget sheet
- **PTO & leave** — vacation days remaining, burn-down pace, upcoming travel, clear windows
- **Shared interests** — an interest ledger for Ahmed & Victoria, cross-referenced against events
- **Travel** — upcoming trips, itinerary items, packing status, live flight status
- **Countries + Bucket List** — travel history and wishlist, cross-referenced against upcoming trips
- **External sheet metrics** — any Google Sheet cell wired up via `summary_sheet:*` config rows

### Layer 2 — Intelligence Processing
Each engine transforms raw data into structured facts for Claude:
- Calendars are labelled (`personal`, `shared`, or a custom label from Config)
- Tasks are aged, scored as overdue or neglected, and optionally given AI-suggested due dates
- Transactions are pivoted by category, skip-list filtered, and formatted as `$X vs $Y in Mon (+Z%)`
- PTO is classified into a 3-2-1 framework (long weekends · mid-size weeks · big pivot trips)
- Travel is tracked trip-by-trip: itinerary items, packing progress, live AviationStack flight status
- Summaries are auto-written to the Metrics and Summaries tabs before Claude is called

### Layer 3 — AI Reasoning (Claude)
A structured prompt packages all of Layer 2's output with explicit reasoning rules:
- When to flag a calendar event (e.g., unresponded RSVP, colour-tagged event)
- When to flag a spending category (>20% AND >$30 over prior month)
- When to flag PTO pace (behind on burn-down, buffer days idle)
- When to cross-reference the interest ledger against upcoming events
- When a bucket list destination is near a planned trip
- When an upcoming trip is a first-time country for Ahmed or Victoria
- Output: a JSON array of up to 8 flags, each with `source · flag · reason · urgency · key`

### Layer 4 — Delivery & Actioning
Flags are written to the sheet and surfaced through multiple channels:
- **Email** — morning nudge at 7 AM, grouped by urgency, with a dashboard link
- **Dashboard** — live React UI with full read/write access to all 21 data domains
- **Chat** — conversational natural-language interface with 40+ executable actions
- **Telegram** — bot integration for on-the-go access

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
| Recurring tasks | Automatically creates the next occurrence when a recurring task is completed |
| AI due-date suggestion | `suggestDueDates()` — Claude proposes dates for undated tasks, written with `[VERA: reason]` in Notes |
| Sort order | Overdue first → then oldest neglected → then pending |

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

### `FlightStatus.js` — Live Flight Status Monitor
Polls AviationStack API for real-time flight status on a rate-limited schedule.

| Window | Poll Interval |
|--------|--------------|
| Departure 6–24 hours away | Every 3 hours |
| Departure 1–6 hours away | Every 60 minutes |
| Departure < 1 hour away | Every 15 minutes |
| > 24 hours out or landed 60+ min ago | Skipped |

- Scans the Itinerary sheet for all rows of type `flight`
- Reads flight number from metadata `flightNum` field; falls back to extracting it from event title (e.g., "Flight to Tampa (UA 1140)" → `UA1140`)
- Stores fetched status (status, departure/arrival times, delay, gate, terminal) back into the row's metadata JSON
- Status is exposed via the `?action=flight_statuses` API endpoint
- **Required Script Property:** `AVIATIONSTACK_KEY`

---

### `Weather.js` — Destination Weather
Fetches current and forecast weather for any city using OpenWeatherMap.

- Resolves IATA airport codes to city names via the free AirportGap API (`airportgap.com`)
- Used by the dashboard Active Travel Card to show weather at your current trip destination
- Trip-position algorithm: shows the arrival city weather before departure, switches to next destination 24 h before each flight
- **Required Script Property:** `OPENWEATHERMAP_KEY`

---

### `SignalLearning.js` — Flag Suppression System
Prevents alert fatigue by learning which patterns are low-signal for this household.

- VERA tracks every flag key that gets acknowledged quickly (good signal) vs. ignored/resolved immediately (low signal)
- Patterns can be suppressed manually via the dashboard's Signal Learning tab
- Suppressed patterns are passed to `buildPrompt()` and excluded from Claude's output
- Expired flags (resolved without acknowledgement) are recorded as noise candidates

---

### `Telegram.js` — Telegram Bot Integration
Receives inbound messages via webhook (`doPost`). Messages are queued in `CacheService` and processed asynchronously via a one-shot trigger to avoid Apps Script timeout limits. Responses are delivered back through the Telegram Bot API.

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
| Projects | Project count + pending task counts |
| Shopping | Total pending items · per-store breakdown |
| PTO | Vacation days remaining · personal hours · next PTO countdown |
| Milestones | Upcoming events · days until · linked item count |
| Spending Chart | Category bar chart: current vs prior month |
| Active Travel Card | Current trip day / total days · destination weather · itinerary for today · flight status with gate/terminal/delay |

**Dashboard tabs:**

| Tab | Capabilities |
|-----|-------------|
| **Home** | Overview bento cards; Active Travel Card when a trip is in progress |
| **Flags** | View · acknowledge · snooze · resolve each flag |
| **Tasks** | View · complete · add · edit · delete tasks; overdue/neglected indicators |
| **Projects** | View all projects; add/complete/edit/delete project tasks |
| **Goals** | Kanban-style goal tracking; add/edit/update status/delete |
| **Shopping** | Multi-store lists; add items; toggle purchased |
| **PTO** | Burn-down stats · clear windows · 3-2-1 framework status |
| **Milestones** | Countdown cards; linked flags/tasks |
| **Interests** | Ahmed & Victoria shared interest ledger; add/delete |
| **Ideas** | Braindump capture; promote to task; archive |
| **Travel** | Upcoming trips; itinerary editor; packing list with progress; flight status |
| **Home Items** | Appliance/warranty tracker; record service; maintenance countdowns |
| **Recipes** | Recipe book; view ingredients; add to shopping list |
| **Countries** | Travel history map; add/delete visited countries |
| **Bucket List** | Dream destinations; star rating; mark visited |
| **Chat** | Conversational VERA interface (see below) |

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
| Milestone Countdown | Grape (purple) | Upcoming milestone detected |

Deleting a PTO suggestion event tells VERA not to suggest that window again.

---

### Interface 4 — Telegram Bot *(optional)*

Connect a Telegram bot to receive flag summaries and send commands. Configure via `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Script Properties. Messages are processed asynchronously to respect Apps Script timeout limits.

---

## Chat — Conversational Interface

VERA includes a full conversational interface powered by Claude. It maintains session history, reads the full context of your Life OS (all 21 data domains), and can take action across every domain in plain English.

### How it works
1. User sends a message via the dashboard Chat tab (or Telegram)
2. `buildChatContext_()` assembles a live snapshot of all data domains
3. `buildChatSystemPrompt_()` formats that snapshot into a structured system prompt
4. Claude responds conversationally and optionally emits `ACTION:` lines
5. `executeActions_()` parses and executes each action against the Google Sheet
6. Session history persists in the Chat History sheet (keyed by `session_id`)

### Context VERA sees in every chat message
Every message includes a live read of:
- Active flags (unresolved + unacknowledged)
- Open tasks (with IDs, due dates, recurring status)
- Bills (with row numbers, amounts, due dates, paid status)
- Projects + their open tasks
- Yearly goals (with IDs, status, progress)
- Shared interests (with IDs, person, category)
- Ideas braindump (with IDs, status)
- Shopping lists (per store)
- Recipes (with row numbers, ingredients)
- Home items (with row numbers, last service, next service)
- Upcoming trips (full itinerary + packing per trip)
- Countries visited (with IDs)
- Travel bucket list (with IDs, stars, dream trip flag)
- Summaries / finance metrics
- PTO stats
- Today's calendar events
- VERA proactive notices (time-sensitive items)

### Available Chat Actions (40+)

**Tasks**
| Action | Effect |
|--------|--------|
| `complete_task\|{id}` | Mark task done; auto-creates next recurrence if recurring |
| `delete_task\|{id}` | Remove task row |
| `update_task\|{id}\|{field}\|{value}` | Update task, dueDate, status, recurring, or notes |
| `create_task\|{text}\|{dueDate}\|{recurring}` | Add new task; supports recurring intervals |

**Flags**
| Action | Effect |
|--------|--------|
| `acknowledge_flag\|{id}` | Mark acknowledged |
| `snooze_flag\|{id}\|{days}` | Snooze for N days |
| `resolve_flag\|{id}` | Mark resolved |

**Bills**
| Action | Effect |
|--------|--------|
| `add_bill\|{name}\|{amount}\|{dueDay}\|{frequency}\|{category}\|{account}` | Add new bill |
| `mark_bill_paid\|{row}` | Toggle paid/unpaid for current month |
| `delete_bill\|{row}` | Remove bill row |

**Goals**
| Action | Effect |
|--------|--------|
| `add_goal\|{title}\|{category}\|{description}` | Create goal |
| `update_goal\|{id}\|{field}\|{value}` | Update status, progress, title, notes |
| `delete_goal\|{id}` | Remove goal |

**Interests**
| Action | Effect |
|--------|--------|
| `log_interest\|{person}\|{interest}\|{category}` | Auto-log mid-conversation mention |
| `add_interest\|{person}\|{interest}\|{category}\|{notes}` | Explicitly add interest |
| `delete_interest\|{id}` | Remove interest |

**Ideas**
| Action | Effect |
|--------|--------|
| `add_idea\|{text}\|{category}\|{tags}` | Capture idea/thought |
| `update_idea\|{id}\|{field}\|{value}` | Edit idea text, category, tags, notes |
| `promote_idea\|{id}` | Convert idea to open task |
| `archive_idea\|{id}` | Mark archived |

**Projects**
| Action | Effect |
|--------|--------|
| `create_project\|{name}\|{task1}~{task2}~{task3}` | Create project with task list |
| `add_project_task\|{project}\|{task}\|{priority}\|{dueDate}` | Add task to project |
| `complete_project_task\|{project}\|{task}` | Mark project task done |
| `delete_project_task\|{project}\|{task}` | Remove project task |

**Shopping**
| Action | Effect |
|--------|--------|
| `add_shopping_item\|{store}\|{item}` | Add item to store list |
| `toggle_shopping_item\|{store}\|{item}` | Toggle purchased/unpurchased |

**Recipes**
| Action | Effect |
|--------|--------|
| `add_recipe\|{name}\|{cuisine}\|{servings}\|{prepTime}\|{ingredients}\|{tags}` | Add recipe |
| `delete_recipe\|{row}` | Remove recipe |
| `recipe_to_shopping\|{row}` | Add all recipe ingredients to shopping |

**Home Items**
| Action | Effect |
|--------|--------|
| `add_home_item\|{name}\|{category}\|{warrantyExpiry}\|{intervalMonths}\|{notes}` | Add appliance/item |
| `record_home_service\|{row}` | Record service: sets Last Service=today, computes Next Service, creates GCal reminder |
| `delete_home_item\|{row}` | Remove home item |

**Travel — Itinerary**
| Action | Effect |
|--------|--------|
| `add_itinerary_item\|{tripKey}\|{type}\|{title}\|{date}\|{startTime}\|{endTime}\|{location}\|{notes}` | Add flight, hotel, dining, activity, etc. |
| `update_itinerary_item\|{id}\|{field}\|{value}` | Edit title, date, time, location, notes |
| `delete_itinerary_item\|{id}` | Remove itinerary item |
| `set_trip_context\|{tripKey}\|{context}` | Set trip sentiment (Anniversary Trip, Family Trip, etc.) |

**Travel — Packing**
| Action | Effect |
|--------|--------|
| `add_packing_item\|{tripKey}\|{person}\|{category}\|{item}` | Add packing item (ahmed/victoria/shared) |
| `check_packing_item\|{id}\|{true/false}` | Mark packed/unpacked |
| `delete_packing_item\|{id}` | Remove packing item |
| `generate_packing_list\|{tripKey}\|{startDate}\|{endDate}` | AI-generates full packing list from itinerary + weather + context |

**Countries & Bucket List**
| Action | Effect |
|--------|--------|
| `add_country\|{country}\|{city}\|{year}\|{traveller}\|{notes}` | Log a visited country |
| `delete_country\|{id}` | Remove country entry |
| `add_bucket_item\|{country}\|{city}\|{targetYear}\|{traveller}\|{stars}\|{dreamTrip}\|{notes}` | Add destination to bucket list |
| `update_bucket_item\|{id}\|{field}\|{value}` | Update visited date or stars rating |
| `delete_bucket_item\|{id}` | Remove bucket list item |

**Calendar**
| Action | Effect |
|--------|--------|
| `create_calendar_event\|{title}\|{date}\|{time}\|{durationMin}` | Create Google Calendar event directly |

### Proactive chat behaviours
- **VERA Notices:** VERA scans its time-sensitive notice engine before every response and will volunteer urgent items even when not asked directly
- **Closing the loop:** When Ahmed mentions something in passing, VERA offers to log it (e.g., "Victoria mentioned she likes pottery" → offers `add_interest`)
- **Connect the dots:** When asked about one domain, VERA checks related domains (e.g., weekend plans → checks interests + goals + clear calendar windows)
- **Next steps:** After completing an action, VERA suggests the logical next action
- **Web search:** VERA can perform web searches for current information (e.g., flight prices, restaurant hours) while keeping all personal data out of search queries

---

## Travel Module

The Travel module gives VERA full visibility into every trip — from itinerary planning through live flight status at the gate.

### Trip Structure
Each trip is identified by a **TripKey** (`YYYY-MM-DD|Trip Label`, e.g. `2026-03-19|Tampa Trip`). All itinerary items and packing items are linked to this key.

### Itinerary Item Types
`flight · train · cruise · ferry · hotel · dining · museum · beach · show · spa · skiing · snorkeling · theme_park · shopping · market · manual`

### Active Travel Card (Home Dashboard)
When a trip is in progress, the Home tab shows a dedicated Active Travel Card:

| Element | Detail |
|---------|--------|
| Day counter | "Day 2 of 5" with trip name |
| Destination weather | Real-time weather chip (temperature + emoji + city name) with trip-position awareness |
| Today's itinerary | All items for today, with times, locations, types |
| Flight rows | Departure/arrival times · location · status badge · gate · terminal · delay highlighting |

**Trip-position weather algorithm:**
- If within 24 h of next flight: shows weather at the arrival city at landing time
- If already past departure of last flight: shows current weather at current destination
- 24 h before return flight: switches back to home city weather

### Live Flight Status
Each flight row in the Active Travel Card shows a real-time status badge:
- `scheduled · active · landed · cancelled · diverted · incident`
- Departure time shown with strikethrough + amber updated time if delayed
- Gate and terminal displayed in blue when available
- Status refreshes on the 15-min trigger (see polling intervals above)

### Packing List Generation
Ask VERA in chat: *"Generate a packing list for the Tampa trip"* and VERA will:
1. Read the full itinerary (activities, weather, trip duration, context)
2. Call Claude to produce a comprehensive, categorised packing list
3. Write every item to the Packing Items sheet, attributed to ahmed/victoria/shared
4. Display the list immediately in the Travel tab

---

## Life OS Data Domains

VERA manages 21 data domains, all backed by tabs in a single Google Sheet:

| Domain | What it tracks | Chat CRUD |
|--------|---------------|-----------|
| **Flags** | AI-generated intelligence alerts | Acknowledge / snooze / resolve |
| **Tasks** | Open task backlog with recurring support | Full CRUD |
| **Projects** | Multi-task projects with priorities | Full CRUD |
| **Goals** | Yearly goals with status + progress | Full CRUD |
| **Interests** | Ahmed & Victoria shared interest ledger | Add / delete |
| **Ideas** | Braindump capture, promote to task | Full CRUD |
| **Bills** | Monthly bills with paid tracking | Add / mark paid / delete |
| **Shopping** | Multi-store shopping lists | Add / toggle |
| **Recipes** | Recipe book with ingredients | Add / delete / → shopping |
| **Home Items** | Appliances, warranties, maintenance schedule | Add / service / delete |
| **Itinerary** | Trip-by-trip event schedule | Full CRUD |
| **Packing Items** | Per-trip packing lists with packed status | Full CRUD + AI generate |
| **Countries** | Travel history (visited countries + cities) | Add / delete |
| **Bucket List** | Dream destinations with star rating | Full CRUD |
| **PTO** | Vacation burn-down, clear windows, milestones | Read (auto-populated) |
| **Summaries** | External life metrics (finance, fitness, etc.) | Read (Config-driven) |
| **Metrics** | VERA self-monitoring health stats | Read (auto-populated nightly) |
| **Transactions** | Empower-format spending history | Read (separate sheet) |
| **Config** | All system behaviour settings | — |
| **Chat History** | Conversational session memory | Read (auto-managed) |
| **Milestones** | Detected milestone events with countdowns | Read (auto-populated) |

---

## System Timing & Automation

VERA installs four time-based triggers via `setupTriggers()`:

| Trigger | Time | Function | Purpose |
|---------|------|----------|---------|
| `nightlyRun` | 11 PM daily | `nightlyRun()` | Full intelligence pipeline |
| `morningNudge` | 7 AM daily | `morningNudge()` | Send flag summary email |
| `hourlyCheck` | Every hour | `hourlyCheck()` | Anticipator reminders |
| `flightCheck` | Every 15 min | `checkFlightStatuses_()` | Live flight status polling |

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
 9. webGetCountries_()          ← read travel history
10. webGetBucketList_()         ← read bucket list
11. suggestDueDates(tasks)      ← AI due-date suggestions for undated tasks
12. generateFlags(...)          ← call Claude API, parse JSON response
13. writeFlags(flags)           ← deduplicate + write + colour-code to Flags tab
```

### Flag Deduplication
VERA uses a stable "key" system to prevent re-flagging the same issue every night:
- Claude generates a snake_case key per flag (e.g., `verizon_payment_due`)
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
`ID · Task · Added Date · Due Date · Status · Recurring · Notes · Flagged`

IDs: `TASK-YYYYMMDD-NN`

### Projects
`Project ID · Project Name · Task · Status · Priority · Due Date · Notes`

### Goals
`ID · Title · Description · Status · Category · Year · Progress % · Notes`

Status values: `Resolutions · To Do · In Progress · Parked · Done`

### Bills
`Bill · Amount · Due Day · Frequency · Category · Account · Paid · Notes`

Paid column stores `YYYY-MM` of last payment month; blank = unpaid.

### Interests
`ID · Person · Interest · Category · Source · Notes · Date Added`

IDs: `INT-YYYYMMDD-NN`; Category: `Food · Travel · Fitness · Culture · Hobbies · Learning · Other`

### Ideas
`ID · Date · Idea · Category · Tags · Notes · Status`

IDs: `IDEA-YYYYMMDD-NN`; Status: `New · Promoted · Archived`

### Recipes
`Name · Cuisine · Servings · Prep Time · Link · Ingredients · Tags · Notes`

Ingredients are semicolon-separated for the recipe-to-shopping action.

### Home Items
`Item · Category · Purchase Date · Warranty Expiry · Last Service · Next Service · Interval (mo) · Notes`

### Itinerary
`ID · Trip Key · Type · Title · Date · Start Time · End Time · Location · Notes · Metadata JSON`

IDs: `ITIN-YYYYMMDD-NN`; Metadata JSON stores `flightNum`, `flight_status` (from AviationStack), and other per-type fields.

### Packing Items
`ID · Trip Key · Person · Category · Item · Checked`

IDs: `PACK-YYYYMMDD-NN`; Person: `ahmed · victoria · shared`

### Countries
`ID · Country · City · Year · Traveller · Trip Key · Notes`

IDs: `c_` + timestamp; Traveller: `Ahmed · Victoria · Both`

### Bucket List
`ID · Country · City · Target Year · Traveller · Stars · Dream Trip · Notes · Visited`

IDs: `b_` + timestamp; Stars: 1–5 priority rating; Dream Trip: `yes` or description; Visited: date or blank

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
| `calendar_label:CalName` | *(varies)* | Custom label for a specific calendar. Add one row per calendar |

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
| `gap_calendars` | *(your calendars)* | Comma-separated calendars scanned for travel, clear windows, and milestones |
| `milestone_keywords` | `Wedding,Graduation,Trip,Travel,Concert,Birthday` | Keywords that flag an event as a milestone |
| `holiday_keywords` | `Day,Holiday,Floating,Closure` | Keywords that identify company holidays |
| `ignore_keywords` | `Pay Day` | Keywords to skip entirely |
| `travel_ignore_keywords` | `Ramadan,Eid,Lent,Holiday,...` | Keywords to exclude from "Upcoming Travel" detection |

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
| `OPENWEATHERMAP_KEY` | ☆ | OpenWeatherMap API key (for destination weather in Travel card) |
| `AVIATIONSTACK_KEY` | ☆ | AviationStack API key (for live flight status) |
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

### Workflow 2 — Conversational Life Management
1. Open the **Chat** tab in the dashboard
2. Ask VERA anything in plain English:
   - *"What's on my plate this week?"*
   - *"Add a task to call the dentist by Friday"*
   - *"Note that Victoria wants to visit Portugal"*
   - *"Log that we visited Tokyo in 2025"*
   - *"Generate a packing list for the Alaska cruise"*
3. VERA responds conversationally and takes the requested action immediately

### Workflow 3 — Trip Planning
1. Ask VERA in chat: *"Create itinerary for our Alaska cruise June 19–28"*
2. Add flights, hotels, dining, activities via chat or the Travel tab
3. VERA generates a packing list when asked, tailored to your itinerary and weather
4. During the trip, the Home Active Travel Card shows today's schedule + live flight status

### Workflow 4 — Task Management
1. Open the **Tasks** tab in the dashboard
2. Overdue tasks surface in red at the top; neglected tasks (7+ days old) in amber
3. Complete tasks directly, or ask VERA in chat
4. VERA will automatically create the next occurrence for recurring tasks

### Workflow 5 — Project Tracking
1. In chat: *"Create a project for the kitchen renovation"* — VERA asks clarifying questions then generates a 20–30 task checklist
2. Track progress in the **Projects** tab
3. VERA flags projects with stale tasks in its nightly run

### Workflow 6 — PTO Planning
1. Open the **PTO** tab to see your burn-down pace
2. VERA surfaces "clear windows" in your Vera Google Calendar (Sage events)
3. Accept a suggestion by leaving it alone; decline by deleting the calendar event
4. If VERA detects unused buffer days sitting idle, it places a yellow alert on the following Friday

### Workflow 7 — Milestone Awareness
1. Add an all-day event to any calendar in `gap_calendars` with a title matching `milestone_keywords`
2. VERA detects it overnight and shows a countdown card in the **Milestones** tab
3. The Home tab bento card shows the next 3 milestones with item counts

### Workflow 8 — Finance Monitoring
1. Export transactions from Empower and paste into your Transactions sheet
2. Run `testRun()` to refresh Finance summaries
3. The **Summaries** tab and Home **Spending Chart** show current-vs-prior-month breakdown
4. VERA flags any category that's >20% AND >$30 over the prior month

### Workflow 9 — Interest & Bucket List Logging
1. Mention something to VERA in chat: *"Victoria mentioned she loves hiking"* → VERA auto-logs it
2. *"Add Patagonia to our bucket list, 5 stars, dream trip"* → VERA adds it
3. When planning a trip, VERA proactively cross-references: *"Buenos Aires is near your Patagonia bucket list item — want to combine them?"*

### Workflow 10 — Home Maintenance
1. Open the **Home Items** tab or ask VERA to add an appliance
2. Set a service interval (e.g., HVAC every 12 months)
3. When you service the item: *"Log that I serviced the HVAC"* → VERA sets Last Service=today, computes Next Service, creates a GCal reminder
4. VERA flags items approaching their service date in the nightly run

### Workflow 11 — Recipe & Shopping
1. Add recipes via the **Recipes** tab or chat: *"Add a recipe for pasta carbonara"*
2. When cooking: *"Add the carbonara ingredients to shopping"* → all ingredients appear on the Recipe store list
3. Check items off in the **Shopping** tab as you shop

### Workflow 12 — Adding External Metrics
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
| **PTO** | "You've used only 3 of 20 vacation days and are 4 days behind the ideal pace" |
| **Interests** | "You logged interest in jazz concerts — there's a jazz festival in 5 days" |
| **Travel** | "Tampa trip in 3 days — packing list is only 40% complete" |
| **Travel** | "Heading to Japan — this will be your first time visiting. Any bucket list items there?" |
| **Bucket List** | "Buenos Aires trip next month — Patagonia is on your bucket list and is a 1.5h flight away" |
| **Home** | "HVAC is 14 months past its last service (interval: 12 months)" |

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
| `ideas` | — | Idea braindump |
| `bills` | — | Bills with paid status |
| `recipes` | — | Recipe list |
| `home_items` | — | Appliance/maintenance list |
| `travel` | `tripKey=...` | Trips + itinerary + packing per trip |
| `flight_statuses` | `tripKey=...` | Live flight status objects for a trip |
| `dest_weather` | `tripKey=..., hour=N` | Destination weather for active trip |
| `countries` | — | Visited countries list |
| `bucket_list` | — | Bucket list destinations |
| `chat` | `message=TEXT, session=ID` | Claude conversational reply + action execution |

### Write Actions (GET with side-effects)

| Action | Parameters | Effect |
|--------|-----------|--------|
| `acknowledge` | `id=FLAG-xxx` | Marks acknowledged |
| `snooze` | `id=FLAG-xxx, days=N` | Snoozes for N days (default 2) |
| `resolve` | `id=FLAG-xxx` | Marks resolved |
| `complete_task` | `id=TASK-xxx` | Marks task done |
| `add_task` | `task, dueDate, notes` | Appends new task row |
| `update_task` | `id, task, dueDate, notes` | Updates task in place |
| `delete_task` | `id` | Removes task row |
| `add_bill` | `name, amount, dueDay, frequency, category, account` | Adds bill |
| `delete_bill` | `row` | Removes bill row |
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
| `add_idea` | `idea, category, tags` | Adds idea |
| `promote_idea` | `id` | Converts idea to open task |
| `add_recipe` | `name, cuisine, servings, prepTime, ingredients, tags` | Adds recipe |
| `delete_recipe` | `row` | Removes recipe |
| `recipe_to_shopping` | `row` | Adds recipe ingredients to shopping list |
| `add_home_item` | `item, category, warrantyExpiry, intervalMonths, notes` | Adds home item |
| `record_service` | `row` | Records service date + computes next |
| `delete_home_item` | `row` | Removes home item |
| `add_itinerary_item` | `tripKey, type, title, date, startTime, endTime, location, notes` | Adds itinerary item |
| `update_itinerary_item` | `id, [fields...]` | Updates itinerary item |
| `delete_itinerary_item` | `id` | Removes itinerary item |
| `add_packing_item` | `tripKey, person, category, item` | Adds packing item |
| `update_packing_item` | `id, checked` | Marks packed/unpacked |
| `delete_packing_item` | `id` | Removes packing item |
| `generate_packing` | `tripKey, startDate, endDate` | AI-generates full packing list |
| `add_country` | `country, city, year, traveller, notes` | Logs visited country |
| `delete_country` | `id` | Removes country entry |
| `add_bucket_item` | `country, city, targetYear, traveller, stars, dreamTrip, notes` | Adds bucket list item |
| `update_bucket_item` | `id, visited, stars` | Updates visited or stars |
| `delete_bucket_item` | `id` | Removes bucket list item |

---

## File Structure

```
VERA-My-Chief-of-Staff/
│
├── Code.js              Core — nightlyRun(), morningNudge(), setupVERA(), CONFIG, TABS
├── WebApp.js            REST API — doGet(), doPost(), all 40+ route handlers
├── Claude.js            AI — buildPrompt(), generateFlags(), parseFlags()
├── Chat.js              Conversational — session-aware Claude chat, buildChatContext_(),
│                          buildChatSystemPrompt_(), executeActions_() (40+ actions)
├── Calendar.js          Intelligence — getUpcomingEvents()
├── Tasks.js             Intelligence — getOpenTasks(), suggestDueDates()
├── Finance.js           Intelligence — transaction pivot, SAT budget reader
├── Summaries.js         Auto-populate — writeSummarySnapshot(), writeMetrics_()
├── PTO.js               Intelligence — PTO burn-down, milestones, clear windows
├── Reminders.js         Intelligence — Anticipator (hourly) + Explorer (nightly)
├── WeekendPlanner.js    Intelligence — weekend planning, Vera calendar events
├── FlightStatus.js      Integration — AviationStack polling, rate-limited by window
├── Weather.js           Integration — OpenWeatherMap + AirportGap IATA resolution
├── Interests.js         CRUD — Shared Interest Ledger
├── Goals.js             CRUD — Yearly goals
├── Projects.js          CRUD — Project + task tracking
├── Shopping.js          CRUD — Multi-store shopping lists
├── SignalLearning.js    Intelligence — flag suppression pattern learning
├── Scheduler.js         Utilities — trigger management helpers
├── Telegram.js          Integration — Telegram bot webhook + async queue
│
├── appsscript.json      OAuth scopes + V8 runtime config
├── .clasp.json          clasp scriptId + rootDir
├── push.ps1             Deploy script (clasp push + git push simultaneously)
│
└── docs/
    └── index.html       React SPA dashboard (self-contained, no build step)
                           Home · Flags · Tasks · Projects · Goals · Shopping
                           PTO · Milestones · Interests · Ideas · Travel
                           Home Items · Recipes · Countries · Bucket List · Chat
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
- Creates all 21 sheet tabs with headers and formatting
- Seeds the Config tab with default values
- Installs all time-based triggers (11 PM · 7 AM · hourly · 15 min)

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
| Set `OPENWEATHERMAP_KEY` | Destination weather in Active Travel Card |
| Set `AVIATIONSTACK_KEY` | Live flight status (gate, terminal, delays) |
| Add `calendar_label:*` rows to Config | Clean calendar labels in flags and emails |
| Add `summary_sheet:*` rows to Config | External metric hooks (fitness, finance, etc.) |
| Enable `weekend_planner_enabled=true` | Weekend planning engine |
| Configure Telegram properties | Telegram bot integration |

### Pushing Updates
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
