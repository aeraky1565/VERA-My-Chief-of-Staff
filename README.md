# VERA — My Chief of Staff

**Virtual Executive & Reminder Assistant**

VERA is a personal chief of staff system built on Google Apps Script. It aggregates your life data — calendar, tasks, finances, PTO, and shared interests — runs intelligent analysis with Claude AI every night, and surfaces what matters through a web dashboard, Telegram, and email. VERA doesn't just remind you of things; it anticipates them, plans around them, and intervenes before they become problems.

---

## Table of Contents

1. [What is VERA?](#what-is-vera)
2. [Architecture Overview](#architecture-overview)
3. [Intelligence Engines](#intelligence-engines)
   - [Flag Generation Engine](#1-flag-generation-engine-claudejs)
   - [Anticipator Rules Engine](#2-anticipator-rules-engine-remindersjs)
   - [Explorer / Daily Discovery](#3-explorer--daily-discovery)
   - [Weekend Planner](#4-weekend-planner-weekendplannerjs)
4. [Interfaces](#interfaces)
   - [Web Dashboard](#1-web-dashboard)
   - [Telegram Bot](#2-telegram-bot)
   - [Conversational Interface](#3-conversational-interface-chatjs)
   - [Smart Scheduler](#4-smart-scheduler-schedulerjs)
5. [How VERA Communicates & Intervenes](#how-vera-communicates--intervenes)
6. [System Timings & Automations](#system-timings--automations)
7. [User Workflows](#user-workflows)
8. [Config Tab Reference](#config-tab-reference)
9. [Script Properties Reference](#script-properties-reference)
10. [Google Sheet Tabs](#google-sheet-tabs)
11. [Setup Guide](#setup-guide)
12. [Module Reference](#module-reference)

---

## What is VERA?

VERA is a "living chief of staff" for a 2-person household (Ahmed & Victoria). It runs silently in the background, pulling data from every corner of your life, reasoning over it nightly with Claude AI, and surfacing exactly what needs your attention — and nothing more.

**Core principles:**
- **Proactive over reactive** — VERA flags issues before they become urgent, not after
- **Signal over noise** — deduplication and cooldowns prevent alert fatigue
- **Action over observation** — you can complete tasks, manage flags, create projects, and schedule events directly through VERA
- **Convergence** — all life intelligence flows through one system (one sheet, one dashboard, one assistant)

**What VERA tracks:**
- Calendar events across all Google Calendars
- Open tasks with age, overdue status, and recurring flags
- Finances (budget via Simple Ass Tracker, spending via Empower CSV exports)
- PTO and vacation balance with burn-down pace and clear-window detection
- Yearly goals in a Kanban layout
- Multi-task projects with Claude-generated checklists
- A shared interest ledger (things you've mentioned wanting to try or experience)
- Shopping lists across multiple stores (via Google Doc)

---

## Architecture Overview

```
╔══════════════════════════════════════════════════════════════════╗
║                        DATA SOURCES                              ║
║  Google Calendar  ·  Tasks Tab  ·  SAT Sheet  ·  Empower CSV    ║
║  PTO (Verizon Cal) ·  Interest Ledger  ·  Goals / Projects       ║
╚══════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔══════════════════════════════════════════════════════════════════╗
║                    INTELLIGENCE LAYER                            ║
║                                                                  ║
║  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  ║
║  │  Flag Generation │  │ Anticipator Rules│  │ Weekend Planner│  ║
║  │   (Claude AI)    │  │  (Hourly Checks) │  │  (Monday 8am)  │  ║
║  └─────────────────┘  └──────────────────┘  └────────────────┘  ║
║                                                                  ║
║  ┌─────────────────┐  ┌──────────────────┐                      ║
║  │    Explorer      │  │  Smart Scheduler │                      ║
║  │ (Daily Discovery)│  │  (Photo → Cal)   │                      ║
║  └─────────────────┘  └──────────────────┘                      ║
╚══════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔══════════════════════════════════════════════════════════════════╗
║                    CENTRAL DATA STORE                            ║
║              Google Sheet "Life OS" (13 tabs)                    ║
║      FLAGS · TASKS · METRICS · SUMMARIES · PROJECTS             ║
║      GOALS · PTO · INTERESTS · SHOPPING · CONFIG · ...          ║
╚══════════════════════════════════════════════════════════════════╝
                              │
                              ▼
╔══════════════════════════════════════════════════════════════════╗
║                     DELIVERY CHANNELS                            ║
║                                                                  ║
║   ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐    ║
║   │  Web Dashboard  │  │ Telegram Bot │  │  Email Fallback  │    ║
║   │  (React SPA)    │  │  (Real-time) │  │  (HTML digest)  │    ║
║   └────────────────┘  └──────────────┘  └─────────────────┘    ║
╚══════════════════════════════════════════════════════════════════╝
```

**Tech stack:**

| Component | Technology |
|-----------|-----------|
| Runtime | Google Apps Script (V8) |
| AI Reasoning | Claude API (Anthropic) — `claude-sonnet-4-6` |
| Messaging | Telegram Bot API |
| Data Store | Google Sheets (Life OS spreadsheet) |
| Shopping List | Google Docs (with Tabs feature) |
| Calendar | Google Calendar API |
| Dashboard | React (single HTML file, served via Web App) |
| Deployment | `.clasp.json` (Apps Script CLI) |
| Timezone | America/New_York |

---

## Intelligence Engines

### 1. Flag Generation Engine (`Claude.js`)

The core nightly intelligence loop. Every night at 11pm, VERA assembles a rich context snapshot and sends it to Claude AI for reasoning.

**What gets included in the prompt:**
- Next N days of calendar events (configurable, default 7) with RSVP status, calendar ownership, event colors, and custom labels
- All open tasks with their age in days, overdue status, and recurring flags
- Life summaries — finance metrics (budget, spending by category, month-over-month changes), fitness data, and any external sheet metrics
- PTO stats — vacation days remaining, personal hours remaining, burn-down pace, and upcoming clear windows
- Shared Interest Ledger — last 20 entries (Ahmed and Victoria's logged interests, categorized)

**What Claude evaluates:**
- Calendar: unresponded RSVPs, upcoming deadlines without task coverage, color-tagged events, gaps in scheduling
- Tasks: overdue items, neglected tasks (older than `task_age_threshold_days`), missing due dates on important items
- Finance: spending spikes (>20% month-over-month increase + $30 absolute threshold), low disposable income, category anomalies
- PTO: burn-down pace behind ideal (>2 days off-track), year-end expiry risk (>24 personal hours remaining after Oct 1), no upcoming PTO with high balance (after Aug 1), long gap since last PTO (>60 days with none upcoming)
- Interest ledger: cross-reference interests against calendar and tasks for surfaced opportunities

**Flag schema:**

```json
{
  "source": "Tasks",
  "flag": "Book anniversary dinner — reservation needed",
  "reason": "Anniversary 4 days away, no restaurant task or reservation event exists.",
  "urgency": "High",
  "key": "anniversary_dinner_march_14"
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `source` | `Calendar`, `Tasks`, `Finance`, `Summaries`, `General` | Which domain triggered the flag |
| `flag` | Short action phrase (≤10 words) | What needs attention |
| `reason` | 1–2 sentences | Why this matters now |
| `urgency` | `High`, `Medium`, `Low` | Priority level |
| `key` | Stable slug | Used for deduplication across nights |

**Deduplication:** Each flag carries a stable `key`. If the same key appears the following night, the duplicate is suppressed. This prevents the same unresolved issue from cluttering your dashboard night after night.

**Escalation:** Flags that remain unacknowledged for multiple days are automatically escalated — their urgency is raised and they are re-surfaced in the next morning nudge. VERA doesn't let things silently age out.

**Capacity:** Maximum 8 flags per night (configurable via `max_flags_per_night`). VERA prioritizes High urgency, then by recency and impact.

---

### 2. Anticipator Rules Engine (`Reminders.js`)

The Anticipator runs every hour through a time-based trigger and evaluates four independent rules. Each rule has its own active time window, cooldown period, and delivery logic. Rules are evaluated in sequence; an error in one does not block the others.

**Rule 1 — Ergonomic Break**
- Active: Weekdays, 9am–6pm
- Interval: Every ~60 minutes (configurable via `ergonomic_interval_min`)
- Cooldown: 55 minutes (Telegram) / 180 minutes (email)
- Message: Stand up, clasp hands behind head, open chest — thoracic stretch for 60 seconds
- Keyed per day+hour to prevent double-sends within the same window

**Rule 2 — Hydration**
- Active: Weekdays, 8am–6pm
- Interval: Every ~120 minutes (configurable via `hydration_interval_min`)
- Cooldown: 110 minutes (Telegram) / 180 minutes (email)
- Message: "Have you had water in the last 2 hours?"

**Rule 3 — Calendar Opportunity**
- Active: Weekdays, 9am–5pm
- Trigger: When today's calendar has a free block ≥90 minutes
- Cooldown: 90 minutes (Telegram) / 180 minutes (email)
- Message: Identifies the free block duration and suggests the most urgent overdue or due-soon task
- Keyed per day+hour so each window is nudged at most once

**Rule 4 — Evening Mobility**
- Active: Daily at the configured hour (default 8pm, via `mobility_reminder_hour`)
- Sends once per day at that hour
- Message: Did you get movement in today? Stretch/mobility prompt

**Cooldown tracking:** Every sent reminder is appended to the `Reminders Memory` tab. The `wasRecentlySent_()` function reads this tab to enforce cooldowns before firing any nudge.

---

### 3. Explorer / Daily Discovery

A forward-looking AI discovery bulletin generated once per day as part of the nightly run (or shortly after).

**What it does:**
- Builds a discovery-mode prompt from your goals, tasks, upcoming events, life summaries, and the last 20 Interest Ledger entries
- Claude surfaces 2–3 warm, personalized observations — not urgent issues, but connections and opportunities
- Examples: "Victoria logged interest in Ethiopian food — there's an Ethiopian food festival this Saturday in Austin"; "You have 3 days off in April with no plans — your Europe goal is still Doing"

**Output:** Delivered as "🔍 Daily Discovery" via Telegram or email, under 200 words.

**Toggle:** Disable with `explorer_enabled = false` in the Config tab.

---

### 4. Weekend Planner (`WeekendPlanner.js`)

Every Monday morning at ~8am, VERA generates a personalized weekend planning memo and creates a calendar event.

**Three archetypes:**

| Archetype | Description | When weighted heavier |
|-----------|-------------|----------------------|
| **THE EXTENSION** | Goal-anchored activity — something that directly advances a yearly goal | When goals are lagging or momentum is low |
| **THE CONTRAST** | Rest and recharge — deliberate decompression | When the week was high-intensity (many flags, overdue tasks, event density) |
| **THE PROTOTYPE** | Novel experience not yet in the Interest Ledger | When the ledger has stale entries or no recent novelty |

**How intensity is computed:**
- Number of active (unresolved) flags
- Number of overdue or neglected tasks
- Calendar event density for the past week
- High intensity → THE CONTRAST weighted more heavily in the memo

**Clear window detection:**
- Scans the next 21 days (configurable via `weekend_planner_lookahead_days`)
- Finds weekend spans (Friday bridge, Monday bridge, full wrap) with no conflicting calendar events on gap calendars
- Surfaces windows in the memo as booking opportunities

**Output:**
- Telegram/email: a formatted "Weekend Decision Memo" with all three archetypes laid out
- Google Calendar: an all-day event on the upcoming Saturday with the full memo in the event description

**Cooldown:** ~6.25 days (9000 minutes) prevents double-sends.

---

## Interfaces

### 1. Web Dashboard

A single-page React application served from `docs/index.html` via the Google Apps Script Web App deployment.

**Authentication:** Token-based (`?token=YOUR_VERA_WEB_TOKEN`). No login page — single-user system.

**Status bar:** Always visible at the top. Shows total flags, active flags (unacknowledged + unresolved), and a breakdown by urgency (High / Medium / Low in color-coded pills).

**Tabs:**

| Tab | Purpose |
|-----|---------|
| **FLAGS** | Intelligence alerts generated nightly. Filter to "Active Only". Each card shows source, urgency, flag title, reason, and date. Actions: Acknowledge / Snooze / Resolve. |
| **TASKS** | Open to-do list. Tasks sorted: overdue first, then neglected (oldest). Age badges go gold when neglected, red when overdue. Add tasks inline with optional due date and notes. |
| **SHOPPING** | Multi-store shopping list pulled from a Google Doc. Each store is a tab. Toggle items with a checkbox (strikethrough = done). Add items per store. |
| **PROJECTS** | Multi-task projects grouped by project name. Each task has a checkbox, priority badge, optional due date, and notes. Projects created via the Chat tab. |
| **GOALS** | Yearly goals in a Kanban board. Columns: Resolutions → To Do → Doing → Parked → Done. Each card shows title, category, year, and progress bar. |
| **SUMMARIES** | Life metrics aggregated nightly from finance and external data sources. Shows source, metric name, value (gold), and as-of date. Includes month-over-month spending comparison. |
| **PTO** | Vacation and personal time dashboard. Shows remaining days, burn-down pace, buffer days counter. Lists upcoming clear windows (3+ day spans with no conflicts) and milestones. Button to trigger a buffer day. |
| **INTERESTS** | Shared interest ledger for Ahmed and Victoria. Shows person, interest, category, date logged. Add or archive (soft-delete) entries. |
| **CHAT** | Conversational AI interface. Type natural language questions or commands. VERA reads current context, calls Claude, executes embedded ACTION lines, and replies. Conversation history persists across visits. |

**Flag card actions:**

| Action | Effect |
|--------|--------|
| **Acknowledge** | Marks the flag as seen. Stays visible but no longer counts as "active" in the status bar. VERA notes it was acknowledged in escalation logic. |
| **Snooze** | Hides the flag until a future date (default: 2 days, configurable via `snooze_default_days`). The card shows "Snoozed until [date]". Re-appears automatically after snooze expires. |
| **Resolve** | Marks the flag as handled and closed. Removed from active view. The underlying issue key is archived so Claude won't regenerate the same flag until conditions change. |

---

### 2. Telegram Bot

VERA's real-time channel. All nudges (ergonomic, hydration, calendar opportunity, weekend planner, morning digest) are sent to Telegram first, with email as fallback.

**Setup flow:**
1. Create a bot via BotFather and note the token
2. Send `/start` to the bot — it replies with your chat ID
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_ID` in Script Properties
4. Run `setTelegramWebhook()` to register the Web App URL with Telegram

**Security:** Only the authorized chat ID can interact with the bot. All other senders are silently ignored.

**Commands:**

| Command | Description |
|---------|-------------|
| `/start` | Returns your chat ID (used during setup) |
| `/help` | Lists available commands and capabilities |
| `/status` | Quick summary: active flag count + open task count |
| `/clear` | Resets your Telegram conversation history |

**Natural language messages:** Any non-command message is routed to the Conversational Interface (Chat.js) via the same backend as the dashboard Chat tab.

**Photo messages:** Any image sent to the bot is routed to the Smart Scheduler — Claude vision extracts dates and events from the photo.

**Delivery pattern:**
1. VERA sends an immediate "⏳ Thinking..." placeholder
2. Calls Claude API in background (typically 2–5 seconds)
3. Edits the placeholder message with the actual response
4. A queuing system prevents concurrent execution conflicts if multiple messages arrive quickly

**Deduplication:** Telegram sometimes retries failed webhook deliveries. VERA caches processed `update_id` values for 10 minutes to silently skip retries.

---

### 3. Conversational Interface (`Chat.js`)

The same Claude-powered chat backend serves both the dashboard Chat tab and Telegram messages.

**Session handling:**
- Dashboard uses session key `dashboard` (shared across visits)
- Telegram uses the chat ID as the session key
- Conversation history stores the last 10 exchanges (20 messages: 10 user + 10 assistant)
- History is stored in Script Properties as JSON

**System prompt context:** Every Claude call includes:
- Active flags (unacknowledged + unresolved)
- Open tasks with age and urgency
- Active projects summary
- Available actions VERA can execute

**ACTION execution pattern:** Claude embeds structured action lines in its response that the backend intercepts and executes before sending the reply to the user:

```
ACTION:acknowledge_flag|FLAG-20260310-01
ACTION:complete_task|TASK-20260308-03
ACTION:create_project|Europe Trip|Book flights~Book hotel~Apply for Schengen visa
ACTION:log_interest|Victoria|Ethiopian food|Food
ACTION:snooze_flag|FLAG-20260309-02|3
ACTION:resolve_flag|FLAG-20260307-01
```

The ACTION line is stripped from the final reply; the user only sees a clean confirmation ("Flag acknowledged ✓").

**What you can ask VERA:**
- "What are my active flags?" → reads Flags tab, summarizes by urgency
- "Mark the grocery task done" → completes the task
- "Snooze the Verizon bill flag for 3 days" → snoozes the flag
- "Plan a Europe trip" → asks 2–4 clarifying questions, generates 20–30-task project checklist
- "Victoria wants to visit Wimberley" → logs interest: `INT-... | Victoria | visit Wimberley TX | Travel`
- "What's my PTO balance?" → reads live PTO stats
- "What's on my calendar this week?" → reads calendar events

---

### 4. Smart Scheduler (`Scheduler.js`)

Turn any screenshot into calendar events in seconds.

**How it works:**
1. Take a screenshot of an email, event flyer, class schedule, registration confirmation, or any document containing dates
2. Send the image to the Telegram bot
3. VERA downloads the image from Telegram and sends it to Claude vision with an extraction prompt
4. Claude returns a JSON array of all detected dates and events:
   ```json
   [
     {"title": "React Conference", "date": "2026-04-15", "allDay": true, "description": "Day 1 of 2-day conference"},
     {"title": "Workshop Registration Deadline", "date": "2026-03-31", "allDay": true, "description": ""}
   ]
   ```
5. VERA shows the extracted events and asks which calendar to create them on (1 = personal, 2 = shared)
6. You reply with the number → all events are created as all-day Google Calendar events

**Pending state:** Extracted events are cached for 5 minutes. If no calendar choice is received within that window, the extraction expires and you'll need to re-send the photo.

**Calendar options:** Configured via `scheduler_calendars` in the Config tab (default: `Vera,AE&VV - Our Joint Chaos`).

---

## How VERA Communicates & Intervenes

### Delivery Channels

VERA uses Telegram as the primary channel and email as the fallback:

| Situation | When | Channel | What VERA Sends |
|-----------|------|---------|-----------------|
| Morning briefing | 7am daily | Telegram / Email | Active flags digest with urgency breakdown and HTML formatting |
| Unacknowledged flag ages | Next nightly run | Flags tab | Urgency escalated; flag re-surfaces in next morning nudge |
| Ergonomic break due | Weekdays 9am–6pm, ~every 60 min | Telegram / Email | "Desk break time! Thoracic stretch for 60 seconds..." |
| Hydration reminder due | Weekdays 8am–6pm, ~every 120 min | Telegram / Email | "Have you had water in the last 2 hours?" |
| Free calendar block detected | Weekdays 9am–5pm, once per window | Telegram / Email | "You have a ~90-min free block — how about [most urgent task]?" |
| Evening mobility time | Daily at 8pm (configurable) | Telegram / Email | Stretch and movement prompt |
| Monday morning | Weekly at ~8am | Telegram / Email + Calendar | Weekend Decision Memo (Extension / Contrast / Prototype) + all-day calendar event |
| Photo received | Real-time | Telegram | "📷 Analyzing image..." → extracted events listed → calendar confirmation |
| Chat message received | Real-time | Telegram | Claude response with any actions executed |
| Daily discovery | After nightly run | Telegram / Email | "🔍 Daily Discovery" — 2–3 forward-looking observations |

### Intervention Mechanisms

| Mechanism | How It Works |
|-----------|-------------|
| **Acknowledgment** | Marks a flag as seen. It remains visible on the dashboard but is no longer counted as "active." VERA factors acknowledged status into escalation logic. |
| **Snooze** | Hides a flag for N days (default 2). The card shows the snooze-until date. After the snooze expires, the flag automatically re-appears as active. Useful for "I'll handle this on Friday." |
| **Resolution** | Marks a flag as fully handled. The flag key is archived so Claude won't regenerate the same flag until conditions genuinely change (e.g., a task is actually completed, not just acknowledged). |
| **Escalation** | If a High-urgency flag has been unacknowledged for 2+ nights, VERA escalates it in the morning nudge with added emphasis and notes how many days it has been outstanding. |
| **Deduplication** | Each flag has a stable `key` slug (e.g., `verizon_bill_march_13`). If Claude would generate the same flag the next night, the duplicate is suppressed. The key persists until the flag is resolved. |
| **Buffer Day Trigger** | The PTO tab has a "Trigger a Buffer Day" button. Pressing it decrements the buffer remaining counter and logs the date — a lightweight way to track unplanned days off without formally modifying the Verizon Calendar. |
| **Project Scaffolding** | In the Chat tab, say "Plan a [project]." VERA asks 2–4 clarifying questions about scope, timeline, and constraints, then generates a 20–30-task checklist via Claude with optional priorities and due dates. |
| **Interest Auto-logging** | If you mention something you want to try in chat ("Ahmed wants to learn woodworking"), VERA automatically logs it to the Interest Ledger. The next nightly run will cross-reference it against your calendar and goals. |
| **Calendar Opportunity Nudge** | When the Anticipator detects a ≥90-minute free block in today's calendar, it proactively suggests the most urgent pending task rather than letting the time slip by unnoticed. |

---

## System Timings & Automations

### Time-Based Triggers

| Function | Schedule | What It Does |
|----------|----------|--------------|
| `nightlyRun()` | 11pm nightly | (1) Escalates aged unacknowledged flags · (2) Snapshots auto-metrics to Metrics tab · (3) Pulls external summaries to Summaries tab · (4) Calls Claude → writes up to 8 new flags to Flags tab |
| `morningNudge()` | 7am daily | Compiles active (unacknowledged + unresolved) flags · Sends branded HTML digest email or Telegram message |
| `hourlyCheck()` | Every hour | Evaluates all 4 Anticipator rules (Ergonomic, Hydration, Calendar Opportunity, Evening Mobility) · Fires Weekend Planner on Monday at `weekend_planner_hour` |

### Event-Driven Triggers

| Function | Trigger | What It Does |
|----------|---------|--------------|
| `doPost()` | Telegram webhook | Receives Telegram updates · Routes chat messages to Chat.js · Routes photo messages to Scheduler.js |
| `doGet()` | Dashboard HTTP request | Handles all read (flags, tasks, summaries, PTO, etc.) and write (acknowledge, complete, add, etc.) API actions |

### Cooldown Reference

| Rule / Process | Telegram Cooldown | Email Cooldown |
|---------------|-------------------|----------------|
| Ergonomic break | 55 minutes | 180 minutes |
| Hydration | 110 minutes | 180 minutes |
| Calendar opportunity | 90 minutes | 180 minutes |
| Evening mobility | Once per day | Once per day |
| Weekend Planner | 9,000 minutes (~6.25 days) | 9,000 minutes |

| Cache | TTL | Purpose |
|-------|-----|---------|
| Telegram dedup (`TG_UPD_*`) | 600 seconds | Prevent processing Telegram retry deliveries |
| Telegram queue (`TG_Q_*`) | 120 seconds | Prevent concurrent Claude calls per chat |
| Scheduler pending (`SCHEDULER_PENDING_KEY_*`) | 300 seconds | Cache extracted events while awaiting calendar choice |

---

## User Workflows

### Daily Morning Review

1. Open the web dashboard (`https://script.google.com/macros/s/.../exec?token=YOUR_TOKEN`)
2. Check the status bar — how many active flags? Any High urgency?
3. Click the **FLAGS** tab (default view)
   - Acknowledge flags you've seen but aren't acting on today
   - Snooze flags you'll handle later ("Snooze 2" pushes it to the day after tomorrow)
   - Resolve flags for issues you've already handled
4. Click **TASKS** — complete anything finished, add anything new
5. Click **SUMMARIES** — review financial metrics and life data

### Managing Tasks via Chat

```
You:   "What are my most overdue tasks?"
VERA:  "Your 3 most overdue tasks are: (1) Call dentist — 27 days old, due Jan 15.
        (2) Renew car registration — 14 days old, due Feb 28. (3) ..."

You:   "Mark the dentist task done."
VERA:  "Done — 'Call dentist' marked complete. ✓"
```

### Creating a Project

1. In the **CHAT** tab (or via Telegram): "Plan a home office renovation"
2. VERA asks 2–4 questions: budget range? timeline? any constraints (rental, HOA)?
3. After your answers, VERA generates a 20–30-task checklist
4. Tasks appear in the **PROJECTS** tab, organized by project name
5. Check off tasks as you complete them

### Smart Calendar from a Screenshot

1. Screenshot an email with deadlines, a class schedule, or an event flyer
2. Send the image to the Telegram bot
3. VERA replies: "📷 Got it — analyzing image..."
4. VERA lists extracted events: "Found 3 events. Reply 1 for [personal calendar] or 2 for [shared calendar]."
5. Reply "2" → all events created on the shared calendar instantly

### Tracking PTO

1. Add PTO to your Verizon Calendar:
   - All-day event with "Vacation" in the title = 1 vacation day
   - All-day event with "PTO" in the title = personal day (48hr pool)
   - Timed event with "PTO" = personal hours (exact duration)
2. Open the **PTO** tab on the dashboard for live stats
3. VERA flags PTO risks nightly:
   - Burn-down pace more than 2 days behind ideal
   - >24 personal hours remaining after October 1 (expiry risk)
   - No upcoming PTO with vacation balance >5 days (after August 1)
   - >60 days since last PTO with none scheduled
4. Use "Trigger a Buffer Day" on the PTO tab to log unplanned days off

### Logging Shared Interests

```
You:   "Victoria wants to visit the Big Bend National Park."
VERA:  "Logged: Victoria — 'visit Big Bend National Park' (Travel). ✓
        I'll keep an eye out for clear windows and matching opportunities."
```

The interest is now stored in the ledger. In tomorrow night's flag generation, Claude will cross-reference it against PTO clear windows, calendar openings, and Ahmed's goals.

### Reviewing Finance

1. Export transactions from Empower as CSV → paste into the Transactions sheet
2. VERA reads the data nightly and populates the Summaries tab
3. Click **SUMMARIES** on the dashboard to see:
   - Month-over-month spending by category
   - Budget vs actual from Simple Ass Tracker
   - Flagged categories (>20% increase + $30 absolute threshold)
4. Finance flags appear automatically in the FLAGS tab when anomalies are detected

---

## Config Tab Reference

The Config tab is a simple key-value table in the Life OS Google Sheet. Add or edit rows to customize VERA's behavior. All keys are case-sensitive.

### General

| Key | Default | Description |
|-----|---------|-------------|
| `calendar_days_ahead` | `7` | Number of days ahead to fetch calendar events for Claude's context |
| `task_age_threshold_days` | `7` | Number of days before a task is considered "neglected" |
| `max_flags_per_night` | `8` | Maximum number of flags Claude generates in a single nightly run |
| `morning_nudge_time` | `7` | Hour (24h, 0–23) to send the morning nudge |
| `snooze_default_days` | `2` | Default snooze duration when a flag is snoozed via dashboard |
| `finance_review_day` | `1` | Day of month on which to surface finance-related flags |
| `active_sources` | `Calendar,Tasks,Summaries` | Comma-separated sources included in flag generation |

### Calendars

| Key | Default | Description |
|-----|---------|-------------|
| `skip_calendars` | `Holidays in United States` | Comma-separated calendar names to ignore entirely in all analysis |
| `calendar_label:CalendarName` | _(none)_ | Custom label for a calendar to inject into Claude's context. Example: `calendar_label:Eraky Family` → `family (shared, not Ahmed's direct obligations)` |

### Anticipator (Reminders)

| Key | Default | Description |
|-----|---------|-------------|
| `reminders_enabled` | `true` | Master switch for all Anticipator rules. Set to `false` to disable all proactive nudges. |
| `explorer_enabled` | `true` | Master switch for the Daily Discovery bulletin. |
| `explorer_interests` | _(built-in)_ | Custom interests string injected into the Explorer prompt context |
| `ergonomic_interval_min` | `60` | Target interval in minutes between ergonomic break nudges |
| `hydration_interval_min` | `120` | Target interval in minutes between hydration nudges |
| `mobility_reminder_hour` | `20` | 24h hour to fire the evening mobility nudge (once per day) |

### Weekend Planner

| Key | Default | Description |
|-----|---------|-------------|
| `weekend_planner_enabled` | `true` | Master switch for Weekend Planner. Set to `false` to disable. |
| `weekend_planner_lookahead_days` | `21` | Days to scan ahead for clear weekend windows |
| `weekend_planner_hour` | `8` | 24h hour on Monday to fire Weekend Planner |
| `weekend_planner_home_city` | `Austin, TX` | Base city used for driving-distance activity framing in the memo |

### Smart Scheduler

| Key | Default | Description |
|-----|---------|-------------|
| `scheduler_calendars` | `Vera,AE&VV - Our Joint Chaos` | Comma-separated calendar names offered as options when confirming photo-extracted events |

### Finance

| Key | Default | Description |
|-----|---------|-------------|
| `finance_skip_categories` | `Income,Paycheck,Salary,Direct Deposit,Transfer,Transfers,Credit Card Payment,Credit Card Payments,Payment,Investments,Investment Income,Savings,Refund,Securities Trades` | Comma-separated spending categories to exclude from the monthly analysis pivot. Edit directly in the Config tab. |

### PTO

| Key | Default | Description |
|-----|---------|-------------|
| `pto_calendar_name` | `Verizon Calendar` | Name of the work calendar containing PTO events |
| `pto_vera_calendar` | `Vera` | Calendar where VERA writes generated PTO-related events |
| `pto_vacation_days` | `20` | Annual vacation day pool |
| `pto_personal_hours` | `48` | Annual personal time pool in hours |
| `pto_buffer_days` | `3` | Planning buffer days (used for cushion in burn-down calculations) |
| `pto_rollover_days` | `0` | Days rolled over from the prior year |
| `pto_year` | _(current year)_ | Year to compute PTO for; auto-defaults to current year |
| `pto_gap_calendars` | `Verizon Calendar,AE&VV - Our Joint Chaos` | Comma-separated calendars scanned when detecting clear windows for vacation planning |
| `pto_milestone_keywords` | `Wedding,Graduation,Trip,Travel,Concert,Birthday` | Keywords in gap-calendar events that surface as "milestone" planning hooks |
| `pto_holiday_keywords` | `Day,Holiday,Floating,Closure` | Keywords that identify company holidays on the work calendar |
| `pto_ignore_keywords` | `Pay Day` | Work calendar events to skip entirely (not counted as PTO or holidays) |
| `pto_travel_ignore_keywords` | `Ramadan,Eid,Lent,Holiday,Observance,Fast,Christmas,Hanukkah,Diwali,Passover` | Multi-day events excluded from the "Upcoming Travel" section (religious observances, etc.) |
| `pto_buffer_remaining` | _(managed by dashboard)_ | Counter for remaining buffer days; decremented by the "Trigger Buffer Day" button |

### External Data Sources (Summaries)

| Key | Format | Description |
|-----|--------|-------------|
| `summary_sheet:SourceName` | `SheetID\|TabName\|CellRef\|metric_name` | Pull a single cell from an external Google Sheet and surface it in VERA's Summaries. Multiple rows with the same source prefix are all read. Example: `summary_sheet:Fitness` → `1xYz...\|Log\|D4\|gym_sessions_this_week` |

---

## Script Properties Reference

Set these in the Apps Script editor under **Project Settings → Script Properties**.

| Property | Required | Description |
|----------|----------|-------------|
| `VERA_SHEET_ID` | **Required** | Google Sheet ID of your Life OS spreadsheet |
| `CLAUDE_API_KEY` | **Required** | Anthropic API key (`sk-ant-...`) |
| `MORNING_NUDGE_EMAIL` | **Required** | Email address for all notifications (morning nudge, Anticipator fallback) |
| `VERA_WEB_TOKEN` | **Required** | Random string for dashboard authentication (≥16 chars recommended) |
| `VERA_WEB_APP_URL` | **Required** | Full URL of the deployed Web App (used for Telegram webhook registration) |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token from BotFather (enables Telegram integration) |
| `TELEGRAM_ALLOWED_CHAT_ID` | Optional | Your Telegram chat ID (restricts bot to authorized user only) |
| `SAT_SHEET_ID` | Optional | Google Sheet ID for the Simple Ass Tracker (budget/income data) |
| `TRANSACTIONS_SHEET_ID` | Optional | Google Sheet ID for Empower transaction exports |
| `SHOPPING_LIST_DOC_ID` | Optional | Google Doc ID for the multi-store shopping list |
| `VERA_LOGO_FILE_ID` | Optional | Google Drive file ID for the logo embedded in morning HTML email |

---

## Google Sheet Tabs

VERA uses a single Google Sheet ("Life OS") with 13 tabs:

| Tab | Contents | Managed By |
|-----|----------|-----------|
| `FLAGS` | AI-generated intelligence alerts: ID, date, source, flag text, reason, urgency, acknowledged, snoozedUntil, resolved, dedup key | Claude.js + WebApp.js |
| `TASKS` | Personal to-do list: ID, task text, addedDate, dueDate, status, recurring, notes, flagged | Tasks.js + WebApp.js |
| `METRICS` | Auto-counted life metrics (task count, flag count, event count). Cleared and rewritten nightly. All rows prefixed with `[AUTO]`. | Summaries.js |
| `SUMMARIES` | External life intelligence: finance metrics, fitness data, any summary_sheet: row outputs. Cleared and rewritten nightly. | Finance.js + Summaries.js |
| `TRANSACTIONS` | Finance transaction pivot from Empower CSV. | Finance.js |
| `PROJECTS` | Multi-task projects: projectId, projectName, task, status, priority, dueDate, notes | Projects.js |
| `GOALS` | Yearly goals Kanban: ID, title, description, status, category, year, progress (0–100), notes | Goals.js |
| `PTO` | PTO events parsed from Google Calendar: type, date, days, hours | PTO.js |
| `PTO Memory` | Deduplication state for PTO-related flags | PTO.js |
| `Reminders Memory` | Cooldown tracking: ruleKey, sentAt, message. Read by `wasRecentlySent_()`. | Reminders.js |
| `Interest Ledger` | Shared interest entries: ID, date, person, interest, category, source, notes, status | Interests.js |
| `Config` | All key-value configuration pairs (see Config Tab Reference above) | All modules read this |
| `Shopping` | _(Not a sheet tab — data stored in a Google Doc with Tabs)_ | Shopping.js |

---

## Setup Guide

### Prerequisites

- A Google account with Google Drive, Sheets, Calendar, and Apps Script access
- An Anthropic API key (`sk-ant-...`) — get one at console.anthropic.com
- Optional: A Telegram bot token (BotFather → `/newbot`)

### Step 1 — Create the Life OS Sheet

1. Create a new Google Sheet and name it "Life OS"
2. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

### Step 2 — Deploy the Code

1. Open the sheet → **Extensions → Apps Script**
2. In `Code.js`, replace `YOUR_SHEET_ID_HERE` with your actual Sheet ID in the `CONFIG` object
3. (Or) set `VERA_SHEET_ID` as a Script Property (preferred for security)
4. Copy all `.js` files from this repository into the Apps Script editor

### Step 3 — Initialize Tabs

Run `setupVERA()` from the Apps Script editor. This creates all 13 tabs with headers and seeds the Config tab with defaults.

### Step 4 — Set Script Properties

In Apps Script → **Project Settings → Script Properties**, add:

```
VERA_SHEET_ID          → your Life OS sheet ID
CLAUDE_API_KEY         → sk-ant-...
MORNING_NUDGE_EMAIL    → you@example.com
VERA_WEB_TOKEN         → some-random-secret-string
```

### Step 5 — Install Triggers

Run `setupTriggers()` from the editor. This installs:
- Nightly trigger at 11pm
- Morning nudge at 7am
- Hourly check every hour

### Step 6 — Deploy as Web App

1. **Deploy → New Deployment → Web App**
2. Execute as: **Me**
3. Who has access: **Anyone** (the token provides auth)
4. Copy the Web App URL

### Step 7 — Complete Web App Config

Add to Script Properties:
```
VERA_WEB_TOKEN         → same secret string as above
VERA_WEB_APP_URL       → https://script.google.com/macros/s/.../exec
```

Open the Web App URL in a browser with `?token=YOUR_TOKEN` appended.

### Step 8 — Configure Telegram (Optional)

1. Get a bot token from BotFather (`/newbot`)
2. Send `/start` to your bot — note the chat ID it returns
3. Add to Script Properties:
   ```
   TELEGRAM_BOT_TOKEN        → 1234567890:AABBcc...
   TELEGRAM_ALLOWED_CHAT_ID  → 987654321
   ```
4. Run `setTelegramWebhook()` from the editor

### Step 9 — Configure Finance (Optional)

1. Set `SAT_SHEET_ID` and `TRANSACTIONS_SHEET_ID` in Script Properties
2. Run `addFinanceConfig()` to seed finance Config defaults
3. Run `testFinance()` to verify data is reading correctly

### Step 10 — Configure PTO (Optional)

1. Add PTO events to your Verizon Calendar (title must contain "Vacation" or "PTO")
2. Seed Config tab with `pto_*` rows (see PTO section of Config Tab Reference)
3. Run `testPTO()` from the editor to verify stats in the Logger

### Step 11 — First Nightly Run

Run `nightlyRun()` manually from the editor to trigger the first flag generation and confirm everything works end-to-end before the scheduled trigger fires.

---

## Module Reference

| File | Size | Purpose |
|------|------|---------|
| `Code.js` | 36KB | Main orchestrator: setup, constants, nightly pipeline, trigger management, shared utilities |
| `Claude.js` | 16KB | Flag generation engine: prompt assembly, Claude API calls, JSON parsing, deduplication |
| `WebApp.js` | 23KB | Web App endpoints (`doGet` / `doPost`): all dashboard API actions and Telegram webhook routing |
| `Telegram.js` | 11KB | Telegram bot: webhook handling, message delivery, deduplication, queue management |
| `Chat.js` | 12KB | Conversational interface: session management, system prompt, ACTION line parsing and execution |
| `Calendar.js` | 5.8KB | Google Calendar fetching: all-calendar scan, label injection, RSVP extraction, dedup |
| `Tasks.js` | 12KB | Task management: read, age calculation, overdue detection, due date suggestions |
| `Summaries.js` | 13KB | Metrics and external sheet aggregation: Metrics tab + Summaries tab read/write |
| `Finance.js` | 22KB | Finance analysis: SAT budget reader, Empower transaction pivot, spending anomaly detection |
| `PTO.js` | 40KB | PTO engine: calendar parsing, vacation/personal tracking, burn-down, clear windows, milestones |
| `Reminders.js` | 21KB | Anticipator rules + Explorer: 4 proactive nudge rules, cooldown tracking, nudge delivery |
| `WeekendPlanner.js` | 26KB | Weekend Planner: intensity signal, 3-archetype memo, Claude generation, calendar event creation |
| `Scheduler.js` | 12KB | Smart Scheduler: Telegram photo download, Claude vision extraction, calendar creation |
| `Projects.js` | 8.2KB | Project management: create, read, complete tasks, CRUD via WebApp |
| `Goals.js` | 6.7KB | Yearly goals Kanban: CRUD with status, category, progress tracking |
| `Interests.js` | 5.8KB | Shared interest ledger: create, read, soft-archive (never hard-deleted) |
| `Shopping.js` | 5.6KB | Google Doc shopping list: read tabs, toggle items (strikethrough), add items |
| `appsscript.json` | — | OAuth scopes, V8 runtime, timezone (America/New_York) |
| `docs/index.html` | 121KB | React single-page dashboard: all tabs, flag cards, chat UI, status bar |
| `.clasp.json` | — | Apps Script CLI deployment configuration |
