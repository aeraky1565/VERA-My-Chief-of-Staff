# VERA — Virtual Executive & Reminder Assistant

> Your personal chief of staff, built on Google Apps Script + Claude AI.

VERA runs silently in the background of your life. Every night it reads your calendar, tasks, finances, PTO, travel plans, interests, health, career, and shared life goals — then calls Claude AI to generate a prioritised list of flags. At 7 AM it delivers a summary to your inbox. A React dashboard and a full conversational chat interface let you view, manage, and act on every domain of your life in plain English.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Dashboard Tabs](#dashboard-tabs)
3. [Chat — Conversational Interface](#chat--conversational-interface)
4. [Chat Actions (40+)](#chat-actions)
5. [Intelligence & Proactive Features](#intelligence--proactive-features)
6. [Nightly Jobs](#nightly-jobs)
7. [Scheduled Automations](#scheduled-automations)
8. [Flag System](#flag-system)
9. [Travel Module](#travel-module)
10. [Finance Module](#finance-module)
11. [Health & Wellness Module](#health--wellness-module)
12. [People & Relationships Module](#people--relationships-module)
13. [Career Module](#career-module)
14. [Home Front Module](#home-front-module)
15. [Data Model — Sheet Tabs](#data-model--sheet-tabs)
16. [Config Tab Reference](#config-tab-reference)
17. [Script Properties Reference](#script-properties-reference)
18. [Integrations & External APIs](#integrations--external-apis)
19. [Dashboard API Reference](#dashboard-api-reference)
20. [File Structure](#file-structure)
21. [Setup & Deployment](#setup--deployment)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React SPA (docs/index.html — GitHub Pages, no build step)      │
│  Home · Chat · Flags · Tasks · Projects · Goals · Shopping      │
│  PTO · Travel · People · Home Front · Health · Career           │
│  Finance · Resources · + more                                    │
└────────────────────┬────────────────────────────────────────────┘
                     │  HTTPS (token-authenticated)
┌────────────────────▼────────────────────────────────────────────┐
│  Google Apps Script — doGet() / doPost() Web App                │
│  100+ REST endpoints · Trigger-based automation                  │
└──────┬──────────────┬───────────────┬───────────────────────────┘
       │              │               │
  Google Sheets   Claude API     External APIs
  (50+ tabs)    (Anthropic)   Calendar · Drive · Gmail
  Life OS data   Flags · Chat  AviationStack · OpenWeatherMap
                 Actions       Serper/Tavily · Telegram
```

**Key design decisions:**
- **No build pipeline** — React runs via Babel standalone in a single HTML file; deployable to GitHub Pages by push
- **Google Sheets as database** — every data domain is a named tab; no external DB required
- **Claude for intelligence** — flags, suggestions, packing lists, gift ideas, and natural-language actions all route through Claude
- **Token-authenticated API** — single `VERA_WEB_TOKEN` in Script Properties; all dashboard calls include it

---

## Dashboard Tabs

| Tab | What it does |
|-----|-------------|
| **Home** | Bento overview: active flags, tasks, projects, spending chart, PTO status, shopping, milestones, active travel card (trip-position aware weather + flight status) |
| **Chat** | Full conversational interface with 40+ executable actions |
| **Flags** | All intelligence alerts — view, acknowledge, snooze, resolve; filter by urgency; escalation tracking |
| **Tasks** | Tasks with overdue/neglected indicators; add/complete/edit/delete; recurring tasks |
| **Projects** | Project tracker with sub-tasks, priorities, progress; add/complete/delete tasks |
| **Goals** | Kanban-style yearly goal tracking; progress percentages; status management |
| **Shopping** | Multi-store lists; toggle purchased; recipe-to-shopping integration |
| **PTO Planner** | Ahmed + Victoria subtabs; burn-down stats; 3-2-1 framework; clear windows; milestones; buffer management |
| **Travel** | Upcoming trips; full itinerary editor (10+ item types); packing list with progress; flight status; trip context; recommendations |
| **People** | Important Dates (birthdays, anniversaries, meaningful dates); Gift Ideas per person |
| **Home Front** | Household chore checklist by cadence; Vehicle tracker (oil, registration, insurance, mileage) |
| **Health & Wellness** | Prescriptions for Ahmed & Victoria; Gym log with attendance tracking; Morning routine checklist |
| **Home Items** | Appliance/warranty tracker; record service; maintenance countdowns |
| **Interests** | Ahmed & Victoria shared interest ledger; category tracking |
| **Ideas** | Braindump; promote to task; archive; category & tag organisation |
| **Finance** | Bills, credit cards, loyalty programs, financial goals, what-if scenarios, transaction history |
| **Career** | Current role; career goals (1yr/3yr/5yr/10yr); progression timeline; skills; wins; network |
| **Recipes** | Recipe book; view ingredients; add to shopping list |
| **Countries** | Visited countries map; traveller tracking (Ahmed/Victoria/Both) |
| **Bucket List** | Dream destinations; star rating; mark visited; dream trip flagging |
| **Resources** | Reference documents VERA can read during chat (Google Docs + PDF auto-conversion) |

---

## Chat — Conversational Interface

VERA's chat is a full conversational AI backed by Claude. It loads live context from every relevant data domain before generating a response, so it always knows your current state.

**Intent-based context loading** — the system automatically detects what the message is about and loads only the relevant data:

| Intent | Data loaded |
|--------|------------|
| `finance` | Bills, credit cards, loyalty programs, financial goals |
| `travel` | Upcoming trips, itinerary, packing, bucket list, countries |
| `health` | Prescriptions, gym log (last 28 days) |
| `people` | Interests, important dates (next 90 days), gift ideas |
| `home` | Recipes, home items, shopping stores, takeouts, pantry |
| `career` | Career position, goals, wins |
| `goals` | Yearly goals, financial goals |
| `resources` | Reference documents registry |
| `projects` | All projects with tasks |
| Always | Active flags, open tasks, summaries/metrics, PTO status, calendar events |

**VERA Notices** — time-sensitive alerts are injected into every chat response regardless of topic.

---

## Chat Actions

VERA can execute 40+ real actions by embedding `ACTION:type|args` lines in its replies. Every action is executed immediately by the backend — no manual steps required.

### Tasks
| What you say | Action |
|---|---|
| "Add a task to call the dentist by Friday" | `create_task\|text\|dueDate\|recurring` |
| "Mark the dentist task done" | `complete_task\|id` |
| "Delete that task" | `delete_task\|id` |
| "Update the task due date to next Monday" | `update_task\|id\|field\|value` |

### Flags
| Action | Effect |
|---|---|
| `acknowledge_flag\|id` | Marks flag acknowledged |
| `snooze_flag\|id\|days` | Snoozes for N days |
| `resolve_flag\|id` | Marks resolved |

### Goals & Projects
```
create_project|Name|task1~task2~task3|High
add_goal|Title|Category|Description
update_goal|id|status|In Progress
```

### Calendar
```
create_calendar_event|Title|2026-04-20|14:00|60
```

### Travel
```
add_itinerary_item|2026-06-19|Alaska Cruise|hotel|Marriott|2026-06-19|15:00|16:00|Seattle|notes
add_packing_item|2026-06-19|Alaska Cruise|ahmed|Clothing|Rain jacket
generate_packing_list|2026-06-19|Alaska Cruise|2026-06-19|2026-06-26
add_gym_sessions|2026-06-19|Alaska Cruise
set_trip_context|2026-06-19|Alaska Cruise|Anniversary Trip
add_country|Japan|Tokyo|2024|Both|Amazing food scene
add_bucket_item|New Zealand|Queenstown|2027|Both|5|yes|Bungee + hiking
```

### Finance
```
add_bill|Netflix|15.99|1|Monthly|Entertainment|Chase Sapphire
mark_bill_paid|Netflix
simulate_scenario|Buy a car|one-time|35000
```

### Health & Wellness
```
add_prescription|Victoria|Vitamin D|1000 IU|Daily|2026-06-01
mark_prescription_refilled|Ahmed|Metformin|2026-07-01
log_gym_attend_latest|yes   ← "I went to the gym"
log_gym_attend_latest|no    ← "I skipped today"
```

### People & Relationships
```
add_important_date|Victoria|04-14|Victoria's Birthday|Yes|30
add_important_date|Both|2019-06-08|First Date Anniversary|Yes|30
log_gift_idea|Victoria|Pottery class at the local studio
log_interest|Victoria|Ceramics and pottery|Hobbies
```

### Career
```
add_career_win|Led product launch|3x revenue increase|Product|2026-03-15
add_career_goal|VP of Product|3yr|Leadership|Target by 2029
update_career_position|title|Senior Product Manager
```

### Home
```
add_home_item|Bosch Dishwasher|Appliance|2024-01-15|2027-01-15|6|notes
record_home_service|row_number
add_recipe|Chicken Tikka Masala|Indian|4|45 min|chicken;yogurt;spices|dinner
recipe_to_shopping|row_number
```

### Interests & Ideas
```
log_interest|Ahmed|Jazz piano|Music
add_idea|Build a home library wall|Home|renovation,books
promote_idea|idea_id
```

### Resources
```
fetch_resource_content|res_1234   ← reads Google Doc, answers from it
```

### Credit Cards & Loyalty
```
log_card_used|Chase Sapphire Preferred
update_loyalty_points|United MileagePlus|45000
```

---

## Intelligence & Proactive Features

### Nightly Flag Generation
Every night, Claude reads your full life context and generates prioritised flags. Flags are colour-coded by urgency and escalate automatically if ignored.

### Interest Cross-Reference
When you log an interest ("Victoria loves pottery"), VERA cross-references it against:
- Upcoming calendar events (jazz festival + Ahmed likes jazz → flag)
- Trip destinations (pottery scene in destination → mention in briefing)
- Gift ideas at 7-day mark (Claude generates 3 personalised suggestions based on logged interests)

### First-Time Country Detection
When a trip to a new country appears, VERA flags it as a milestone and suggests bucket list activities nearby.

### Important Dates Engine
Three-tier notification system for every birthday, anniversary, or meaningful date:
- **30 days before** → Low flag: reminder with notes
- **7 days before** → Medium flag: Claude generates 3 personalised gift/activity ideas based on logged interests
- **1 day before** → High flag: final confirmation prompt

### Financial Goal Health Checks
Nightly scan of all active financial goals. Flags goals at risk based on current progress vs. target. Supports what-if scenarios ("what if I buy a car for $35k?").

### Fitness Consistency Tracker
- Flags when weekly gym session count is below target on configured check-day
- Flags zero sessions by Thursday (Medium) and Saturday (High)
- Flags 3+ consecutive weeks below target
- Detects upcoming trips with no gym plan in the itinerary

### Pre/Post-Trip Intelligence
- **48 hours before departure**: pre-trip briefing flag with packing status, itinerary overview
- **Morning of travel**: clean, shareable travel day briefing email (not VERA-branded)
- **1 day after return**: post-trip capture prompt asking about restaurants, highlights, learnings, bucket list additions

### PTO Optimisation (3-2-1 Framework)
- Tracks vacation pool, personal hours, buffer days for Ahmed and Victoria separately
- Finds clear windows (3+ consecutive clear workdays) in next 90 days
- Suggests Vera Calendar events for clear windows; tracks declined suggestions
- Flags when buffer days sit idle 21+ days
- Tracks milestones (trips, weddings, graduations) from calendar keywords

### Signal Learning
VERA tracks which types of flags get actioned quickly (good signal) vs. which sit unacknowledged for weeks (noise). Over time, suppressed patterns are excluded from Claude's output.

### Web Search
VERA can search the web for current information (flight prices, restaurant reviews, local events, news) while automatically stripping PII from search queries.

### Resource Document Intelligence
Add Google Docs (HR policies, benefit guides, contracts) to the Resources tab. VERA reads them during chat to answer specific questions — e.g., "How many weeks of parental leave do I get?" PDFs are auto-converted to Google Docs for reading.

---

## Nightly Jobs

Run at 11 PM via Apps Script time trigger (`nightlyRun()`):

1. Write Summaries + Metrics snapshot
2. Sync birthdays from "Joint Chaos" calendar → Important Dates tab
3. Fire 30/7/1-day Important Date flags (with Claude gift suggestions at 7 days)
4. Write PTO snapshot + suggest Vera Calendar events for clear windows
5. Run Explorer engine (daily AI discovery bulletin)
6. Suggest due dates for undated tasks (Claude)
7. Check financial goal health + write at-risk flags
8. Check fitness consistency (weekly target, streak below target)
9. Check fitness travel gap (trips with no gym plan)
10. Check pre-trip briefings (48h before departure)
11. Check post-trip capture (1 day after return)
12. Auto-restock flagging from purchase history
13. Reset morning routine checklist
14. Generate nightly flags via Claude (calendar, tasks, finance, PTO, travel, interests)
15. Escalate aged flags (Day 3: bump urgency; Day 7: append stale marker)
16. Signal learning — record expired/unactioned flags

---

## Scheduled Automations

| Schedule | Job |
|---|---|
| **Nightly 11 PM** | Full intelligence run (16+ jobs) |
| **Daily 7 AM** | Morning nudge email (flag summary by urgency) |
| **Hourly** | Anticipator engine — pre-event prep reminders; Vera Calendar memos |
| **Every 15 min** | Flight status polling (rate-limited by proximity to departure) |
| **Every 30 min** | Email parser scan |

**Flight Status Rate Limits:**
- 6–24h before departure → poll every 3 hours
- 1–6h before departure → poll every 60 minutes
- < 1h before departure → poll every 15 minutes

---

## Flag System

### Urgency Levels
- 🔴 **High** — needs attention today
- 🟡 **Medium** — should act this week
- 🟢 **Low** — informational, no immediate action needed

### Flag Sources
| Source | Examples |
|---|---|
| Calendar | RSVP pending, event colour significance, unusual gaps, conflicts |
| Tasks | Overdue, neglected 7+ days, recurring transitions |
| Finance | Spending >20% AND >$30 over prior month, goal at risk |
| PTO | Burn-down behind pace, clear window found, buffer idle 21+ days |
| Travel | Incomplete packing, new country trip, fitness travel gap |
| Home | Appliances past service date, warranty expiry approaching |
| Important Dates | 30/7/1-day lead times for birthdays, anniversaries, meaningful dates |
| Fitness | Weekly target missed, zero sessions by Thu/Sat, 3+ weeks below target |
| Financial Goals | Goal at risk given current pace and monthly contribution |
| Interests | Upcoming calendar event matching a logged interest |

### Escalation Rules
- **Day 3 unacknowledged** → urgency bumped one tier (Low → Medium → High)
- **Day 7 unacknowledged** → reason appended with `[Stale: open for 7+ days]`
- **Dedup** — each flag has a unique key; same flag never fires twice in the same window

---

## Travel Module

VERA has a full itinerary management system covering the entire trip lifecycle.

### Itinerary Item Types
`flight` · `train` · `cruise` · `ferry` · `hotel` · `dining` · `museum` · `beach` · `show` · `spa` · `skiing` · `snorkeling` · `theme_park` · `shopping` · `market` · `manual`

### Active Travel Card
When a trip is active, the Home tab shows a live card with:
- **Weather** — trip-position-aware algorithm:
  - 24h before next flight: shows arrival city weather
  - Mid-trip: shows current destination weather
  - 24h before return flight: shows home weather
- **Flight status** — live gate, terminal, delay, status from AviationStack
- **Today's itinerary** — day's items with times and locations

### Pre-Trip Intelligence
- Packing list AI generation (Claude reads itinerary + weather + trip context)
- Packing progress tracking with completion percentage
- Pre-trip briefing flag 48 hours before departure
- Gym session scheduling for all interior trip days (skips arrival/departure)
- TripMeta context (Anniversary Trip, Family Trip, Work Trip, Honeymoon, etc.)

### Post-Trip Intelligence
- Capture prompt 1 day after return (restaurants visited, highlights, things to do differently, bucket list additions)
- Countries visited auto-update
- Travel history maintained per person (Ahmed/Victoria/Both)

### AI Trip Recommendations
Generate personalised activity, dining, and experience recommendations for any destination using Claude.

---

## Finance Module

- **Bills** — track monthly/annual bills with due dates, amounts, paid status (auto-resets monthly)
- **Credit Card Hub** — active cards per person (Ahmed/Victoria/Joint); reward rates by category; monthly/annual perks; last-used tracking; inactivity alerts
- **Loyalty Programs** — points balances, tiers, redemption goals; alert when points go stale
- **Financial Goals** — track savings goals with target amount, current amount, monthly contributions, APY, target date; nightly health-check flags when goals are at risk
- **What-If Scenarios** — simulate one-time purchases (car, holiday) or recurring changes (rent increase, new subscription) and see projected impact on all goals
- **Transaction History** — integrates with Empower CSV export and Simple Ass Tracker budget sheet; auto-detects 2 most recent complete months; pivots by category; flags spending overages
- **Cashflow Analysis** — monthly income vs. expense tracking

---

## Health & Wellness Module

- **Prescriptions** — medication tracker for Ahmed and Victoria: name, dosage, frequency, refill dates; refill-due flags
- **Gym Log** — session history (date, type, duration, attended/skipped); attendance via natural language ("I went to the gym", "skipped today")
- **Fitness Consistency** — weekly target tracking; nightly flags for low count, zero sessions by Thursday/Saturday, consecutive weeks below target; travel gap detection
- **Morning Routine** — daily habit checklist; auto-resets every night

---

## People & Relationships Module

- **Important Dates** — birthdays, anniversaries, meaningful shared events with configurable lead times
  - Auto-imports birthdays from "Joint Chaos" Google Calendar
  - 30-day Low / 7-day Medium / 1-day High flag tiers
  - 7-day flag includes Claude-generated personalised gift/activity suggestions based on logged interests
  - Recurring (MM-DD, year-agnostic) and one-time (YYYY-MM-DD) date formats
  - `Last Actioned Year` dedup prevents re-flagging within the same calendar year
- **Gift Ideas** — braindump of gift ideas per person; log via chat ("gift idea for Victoria: pottery class")
- **Shared Interest Ledger** — what Ahmed and Victoria each enjoy; cross-referenced against travel, calendar events, and gift suggestions
- **In Chat** — "What important dates are coming up?" returns next 90 days sorted by proximity; VERA proactively reminds when a date is within 7 days

---

## Career Module

- **Current Role** — title, company, department, work style, focus areas
- **Career Goals** — tiered by horizon: 1yr / 3yr / 5yr / 10yr; category and status tracking
- **Progression Timeline** — all roles held with company, duration, and highlights
- **Development** — skills and courses with completion status
- **Wins** — logged professional achievements with impact and category
- **Network** — professional contacts with last-contact tracking and relationship type
- **In Chat** — log wins, update position, add goals conversationally

---

## Home Front Module

- **Chore Checklist** — household chores by cadence (Daily/Weekly/Bi-weekly/Monthly/Quarterly/As-needed); auto-reset; checked-at timestamps
- **Vehicle Tracker** — oil change intervals, registration expiry, insurance expiry, mileage; service history
- **Home Items** — appliances and warranties with purchase date, warranty expiry, last service, next service date; configurable service interval; auto-creates Google Calendar reminders when service is recorded
- **Recipes** — recipe book with ingredients, cuisine, servings, prep time; one-tap add-to-shopping-list
- **Takeout Restaurants** — favourite restaurants with cuisine, contact, rating; per-restaurant menu item ratings
- **Shopping** — multi-store grocery/household lists; toggle purchased; recipe integration
- **Pantry & Purchase History** — track what you buy; consumption tracking; auto-flag replenishment candidates

---

## Data Model — Sheet Tabs

VERA uses 50+ named tabs in a single Google Sheet:

**Core:**
`Flags` · `Tasks` · `Projects` · `Goals` · `Config` · `Metrics` · `Summaries`

**Finance:**
`Bills` · `Credit Cards` · `Card Rewards` · `Card Perks` · `Loyalty Programs` · `Rewards Goals` · `Financial Goals` · `Financial Scenarios` · `Purchase History`

**Travel:**
`Itinerary` · `Packing Items` · `Trip Meta` · `Trip Recommendations` · `Countries` · `Bucket List` · `Bucket Activities` · `Traveler Profiles` · `Processed Emails`

**People & Relationships:**
`Shared Interests` · `Important Dates` · `Gift People` · `Gift Ideas` · `Ideas`

**Health:**
`Prescriptions` · `Gym Log` · `Morning Routine`

**Home:**
`Shopping` · `Recipes` · `Takeout Restaurants` · `Takeout Items` · `Home Items` · `Chores` · `Vehicles`

**Career:**
`Career Position` · `Career Goals` · `Career Progression` · `Career Development` · `Career Wins` · `Career Network`

**PTO:**
`PTO` · `PTO Memory` · `Reminders Memory`

**Intelligence:**
`Resources` · `Signal Learning`

---

## Config Tab Reference

The `Config` tab (columns: Setting | Value) controls all system behaviour without touching code.

### Core
| Key | Default | Description |
|---|---|---|
| `calendar_days_ahead` | `7` | Days ahead to scan Google Calendars |
| `task_age_threshold_days` | `7` | Days before a task is flagged as neglected |
| `skip_calendars` | — | Comma-separated calendar names to ignore |
| `calendar_label:CalName` | — | Custom label for a specific calendar |

### PTO (Ahmed)
| Key | Default | Description |
|---|---|---|
| `pto_calendar_name` | `Verizon Calendar` | Work calendar name |
| `pto_vera_calendar` | `Vera` | VERA calendar name for suggestions |
| `pto_vacation_days` | `20` | Annual vacation pool |
| `pto_personal_hours` | `48` | Annual personal time hours |
| `pto_buffer_days` | `3` | Days held in reserve |
| `pto_rollover_days` | `0` | Vacation carried over from prior year |
| `gap_calendars` | — | Calendars for travel / milestones / clear windows |
| `milestone_keywords` | `Wedding,Graduation,Trip,Travel,Concert,Birthday` | Calendar event keywords treated as milestones |
| `travel_ignore_keywords` | `Ramadan,Eid,Lent,Holiday` | Calendar events to skip for travel detection |

### PTO (Victoria)
| Key | Description |
|---|---|
| `victoria_pto_calendar_name` | Victoria's work calendar name |
| `victoria_pto_vacation_days` | Victoria's annual vacation pool |
| `victoria_pto_personal_hours` | Victoria's annual personal time hours |
| `victoria_pto_buffer_days` | Victoria's buffer days |

### Travel & Trips
| Key | Default | Description |
|---|---|---|
| `pretrip_briefing_enabled` | `true` | Enable pre-trip briefing flags |
| `pretrip_briefing_hours` | `48` | Hours before departure to fire briefing |
| `posttrip_capture_delay_days` | `1` | Days after trip end to fire capture prompt |
| `travel_day_briefing_enabled` | `true` | Morning-of-travel email |

### Fitness
| Key | Default | Description |
|---|---|---|
| `fitness_enabled` | `false` | Enable weekly gym consistency checks |
| `fitness_weekly_target` | `4` | Target gym sessions per week |
| `fitness_low_flag_day` | `4` (Wed) | Day of week to fire Low flag if behind target |

### Finance
| Key | Default | Description |
|---|---|---|
| `monthly_disposable_income` | `5000` | Monthly discretionary income for goal health checks |
| `finance_skip_categories` | `Income,Paycheck,...` | Transaction categories to exclude from analysis |

### Important Dates
| Key | Default | Description |
|---|---|---|
| `dates_default_lead_time` | `30` | Default days before to start flagging |
| `dates_high_urgency_days` | `1` | Days before for High flag |
| `dates_medium_urgency_days` | `7` | Days before for Medium flag (includes Claude gift suggestions) |

### External Sheet Hooks
```
summary_sheet:SourceName → SheetID|TabName|CellRef|metric_name
```
Wire external metrics (e.g., your own budget sheet) into the VERA Summaries tab.

---

## Script Properties Reference

Set in **Apps Script → Project Settings → Script Properties**.

### Required
| Property | Description |
|---|---|
| `VERA_SHEET_ID` | Google Sheet ID of your Life OS sheet |
| `MORNING_NUDGE_EMAIL` | Email address for the 7 AM morning nudge |
| `CLAUDE_API_KEY` | Anthropic API key (`sk-ant-...`) |
| `VERA_WEB_TOKEN` | Authentication token for dashboard API calls |

### Optional (Feature Unlocks)
| Property | Description |
|---|---|
| `VERA_LOGO_FILE_ID` | Google Drive file ID for VERA logo in emails |
| `VERA_DASHBOARD_URL` | Dashboard URL for email button links |
| `SAT_SHEET_ID` | Simple Ass Tracker budget sheet ID (finance integration) |
| `TRANSACTIONS_SHEET_ID` | Empower-format transactions sheet ID |
| `OPENWEATHERMAP_KEY` | OpenWeatherMap API key (destination weather) |
| `AVIATIONSTACK_KEY` | AviationStack API key (live flight status) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for mobile access |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for bot |
| `VERA_SEARCH_API_KEY` | Web search API key (Serper.dev or Tavily) |
| `VERA_SEARCH_ENGINE` | `serper` (default) or `tavily` |
| `LIFE_PLAN_DOC_ID` | Google Doc ID for financial goals seeding |

---

## Integrations & External APIs

| Integration | What it does |
|---|---|
| **Google Calendar** | Read all calendars; create Vera calendar events (PTO suggestions, maintenance reminders) |
| **Google Sheets** | All data storage; Config system; 50+ tabs |
| **Google Drive** | Read resource documents; PDF-to-Google-Doc conversion; logo images |
| **Google Gmail** | Morning nudge email; travel day briefing email |
| **Anthropic Claude** | Flag generation; chat responses; action execution; packing lists; gift suggestions; task due date AI |
| **AviationStack** | Real-time flight status (gate, terminal, delay, status) |
| **OpenWeatherMap** | Destination and home city weather |
| **AirportGap** | IATA airport code → city resolution for weather |
| **Serper.dev** | Web search for current information (default) |
| **Tavily** | Alternative web search provider |
| **Telegram** | Bot webhook for on-the-go mobile access |
| **Empower** | CSV transaction import for spending analysis |
| **Simple Ass Tracker** | Budget sheet integration for disposable income tracking |

---

## Dashboard API Reference

All endpoints: `GET https://script.google.com/...exec?token=TOKEN&action=ACTION`

### Read Endpoints
`status` · `flags` · `tasks` · `summaries` · `projects` · `goals` · `shopping` · `pto` · `interests` · `ideas` · `bills` · `recipes` · `home_items` · `travel` · `flight_statuses` · `dest_weather` · `countries` · `bucket_list` · `career` · `prescriptions` · `cards` · `morning_routine` · `gym_log` · `purchase_history` · `recommendations` · `chores` · `vehicles` · `profiles` · `financial_goals` · `resources` · `important_dates` · `gift_data` · `takeouts`

### Chat
`chat` — params: `message`, `session` (optional, defaults to `dashboard`)

### Write Endpoints (selection)
| Action | Params |
|---|---|
| `add_task` | `task`, `dueDate`, `recurring` |
| `complete_task` | `id` |
| `acknowledge` | `id` |
| `snooze` | `id`, `days` |
| `add_bill` | `bill`, `amount`, `dueDay`, `frequency`, `category`, `account` |
| `add_important_date` | `label`, `date`, `person`, `recurring`, `leadTime` |
| `add_gift_idea` | `person`, `idea` |
| `add_resource` | `name`, `url`, `category`, `appliesTo`, `description`, `tags` |
| `fetch_resource_content` | `id` |
| `gym_attend` | `id`, `attended` |
| `simulate_scenario` | `goalId`, `label`, `type`, `amount`, `frequency` |

Full endpoint list: see `WebApp.js` switch statement (100+ cases).

---

## File Structure

```
/
├── Code.js                  # Main entry: CONFIG, TABS, setupVERA(), nightlyRun(), morningNudge()
├── WebApp.js                # REST API: 100+ endpoint handlers, doGet(), doPost()
├── Chat.js                  # Conversational AI: context builder, system prompt, 40+ action handlers
├── Claude.js                # Flag generation: buildPrompt(), generateFlags(), parseFlags()
├── Calendar.js              # Google Calendar reading, event colour/RSVP tracking
├── Tasks.js                 # Task aging, overdue/neglected detection, due date suggestions
├── Finance.js               # Transaction pivoting, SAT budget reader, spending analysis
├── PTO.js                   # Vacation burn-down, 3-2-1 framework, clear windows, milestones
├── Summaries.js             # Auto-population of Metrics & Summaries tabs
├── Reminders.js             # Anticipator (hourly) + Explorer (nightly) engines
├── WeekendPlanner.js        # Weekend planning & Vera calendar memos
├── FlightStatus.js          # AviationStack polling, rate-limited by flight window
├── Weather.js               # OpenWeatherMap + AirportGap integration
├── SignalLearning.js        # Flag suppression pattern learning
├── ImportantDates.js        # Birthday sync, 30/7/1-day flag engine, interest-based gift suggestions
├── FinancialGoals.js        # What-if scenario planning, Life Plan doc seeding
├── PreTripBriefing.js       # 48h pre-departure briefing flags
├── PostTripCapture.js       # Post-trip reflection prompts
├── TravelDayBriefing.js     # Morning-of-travel email
├── Fitness.js               # Weekly consistency checks, travel gap detection
├── Pantry.js                # Purchase history, auto-restock flagging
├── GymTracker.js            # Gym attendance logging
├── EmailParser.js           # Email-based structured data extraction
├── Interests.js             # Shared interest ledger CRUD
├── Goals.js                 # Yearly goals CRUD
├── Projects.js              # Projects + project tasks CRUD
├── Shopping.js              # Shopping list CRUD
├── Scheduler.js             # Trigger management helpers
├── Telegram.js              # Bot webhook + async queue
├── appsscript.json          # Apps Script manifest (scopes, timezone, runtime)
└── docs/
    └── index.html           # React SPA — full dashboard (no build step required)
```

---

## Setup & Deployment

### Prerequisites
- Google account with Apps Script access
- Anthropic API key
- (Optional) AviationStack, OpenWeatherMap, Serper.dev API keys

### Steps

1. **Clone the repo**
   ```bash
   git clone https://github.com/aeraky1565/VERA-My-Chief-of-Staff.git
   cd VERA-My-Chief-of-Staff
   ```

2. **Install clasp**
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

3. **Create Apps Script project**
   ```bash
   clasp create --title "VERA" --type api
   clasp push
   ```

4. **Set Script Properties**
   In Apps Script → Project Settings → Script Properties, add all required properties (see [Script Properties Reference](#script-properties-reference)).

5. **Run initial setup**
   In the Apps Script editor, run `setupVERA()` once. This creates all 50+ sheet tabs with correct headers.

6. **Deploy as Web App**
   In Apps Script → Deploy → New Deployment → Web App. Set:
   - Execute as: **Me**
   - Who has access: **Anyone** (the token provides security)

   Copy the deployment URL.

7. **Configure the dashboard**
   Open `docs/index.html` via GitHub Pages, open the Settings modal (⚙ icon), and enter your deployment URL and token.

8. **Enable GitHub Pages**
   In your GitHub repo → Settings → Pages → Source: `main` branch, `/docs` folder.

9. **Set up triggers**
   Run `setupTriggers()` from the Apps Script editor. This creates:
   - Nightly run at 11 PM
   - Morning nudge at 7 AM
   - Hourly anticipator check
   - Flight status check every 15 minutes
   - Email scan every 30 minutes

10. **Seed initial data**
    Run `addDefaultConfigValues()` to populate the Config tab with defaults, then update values for your calendars, PTO pool, etc.

---

*VERA is a personal project by Ahmed — built to be the chief of staff he never had.*
