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
8. [Running Things by Hand (`TestBench.js`)](#running-things-by-hand-testbenchjs)
9. [Flag System](#flag-system)
10. [Travel Module](#travel-module)
11. [Finance Module](#finance-module)
12. [Health & Wellness Module](#health--wellness-module)
13. [People & Relationships Module](#people--relationships-module)
14. [Career Module](#career-module)
15. [Home Front Module](#home-front-module)
16. [Slack Integration](#slack-integration)
17. [Data Model — Sheet Tabs](#data-model--sheet-tabs)
18. [Config Tab Reference](#config-tab-reference)
19. [Script Properties Reference](#script-properties-reference)
20. [Calendar Event Prefixes](#calendar-event-prefixes)
21. [Dashboard API Reference](#dashboard-api-reference)
22. [File Structure](#file-structure)
23. [Setup & Deployment](#setup--deployment)

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
| **Tasks** | Projects | Multi-step projects. Describe what a project is **for** and VERA drafts the whole checklist — asking 2–4 clarifying questions first when the context is thin, then returning a phased plan you edit before anything is saved. Plus a health verdict per project (on track / at risk / stalled / blocked / overdue), a "next up" task, phase sections, drag-to-reorder, per-task status (Pending / In Progress / Blocked / Done), and an owner toggle with filter |
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
Same backend and session as the main dashboard, surfaced in a simpler read-focused layout. Victoria can ask questions and trigger actions; VERA's responses adapt based on who is asking. Its Projects tab is scoped to projects owned by `Shared` or `Victoria` and shows the same health chip, next-up task, context and notes as the full dashboard, but offers only the task checkbox — adding, editing, reordering, drafting and creating projects stay in the full dashboard. This is a view scope, not a security boundary: both pages carry the same API token.

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
| **Projects** | create_project (with Claude-generated exhaustive subtask list, each task optionally `Task|Priority|Phase`), draft_project_tasks, append_project_tasks, add_project_task, complete_project_task, delete_project_task, set_project_owner, set_project_target, set_project_context, reorder_project_tasks, close_project |
| **Calendar** | create_calendar_event (creates in Google Calendar), add_gym_sessions (schedules workout blocks on travel days) |
| **Bills** | add_bill, mark_bill_paid (toggle), delete_bill |
| **Recipes** | add_recipe, delete_recipe, recipe_to_shopping |
| **Meal Planning** | suggest_meals_week (AI-populated full week), set_meal (per-day override) |
| **Shopping** | add_shopping_item, toggle_shopping_item |
| **Home Items** | add_home_item, record_home_service, delete_home_item |
| **Goals** | add_goal, update_goal (status/title/category/progress/notes), delete_goal |
| **Ideas** | add_idea, add_thought (raw capture), shelve_thought (categorise), update_idea, promote_idea (→ task), archive_idea |
| **Interests** | log_interest (auto-capture from conversation), add_interest (explicit), delete_interest |
| **Travel — Itinerary** | add_itinerary_item (flight/train/cruise/ferry/hotel/dining/museum/beach/show/spa/skiing/snorkeling/theme_park/shopping/market/manual), update_itinerary_item, delete_itinerary_item, set_trip_context, set_trip_briefing |
| **Travel — Packing** | add_packing_item (ahmed/victoria/shared), check_packing_item, delete_packing_item, generate_packing_list (AI-generated from itinerary + weather) |
| **Countries & Bucket List** | add_country, delete_country, add_bucket_item, update_bucket_item (visited/stars), delete_bucket_item |
| **Takeouts** | add_takeout_restaurant, add_takeout_item, delete_takeout_restaurant, delete_takeout_item |
| **Pantry / Purchase History** | add_purchase, log_receipt_items (image → line items) |
| **Career** | add_career_win, add_career_goal, update_career_position |
| **Prescriptions** | add_prescription, mark_prescription_refilled |
| **Health Appointments** | log_health_visit (creates DR: calendar event), add_health_appointment, query_health_due |
| **Credit Cards** | log_card_used, mark_perk_used, update_loyalty_points |
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

Fires every **Wednesday** at ~8am (`Reminders.js` gates on `day === 3`; the hour is configurable via `weekend_planner_hour`). Generates a "Weekend Decision Memo" delivered via Slack/email and as an all-day Google Calendar event on the upcoming Saturday. The memo presents three archetypes: THE EXTENSION (goal-anchored activity), THE CONTRAST (rest/recharge, weighted higher when the intensity signal is high), and THE PROTOTYPE (new experience not already in the Interest Ledger). Draws on goals, the Shared Interest Ledger, PTO balance, and open calendar windows.

**Travel awareness.** The memo works out where Ahmed will be on *each* weekend day (`weekendTripFor_` / `getWeekendLocationPlan_`) rather than only asking whether he is away today. The destination is resolved with `inferTripDestination_` and must geocode before it is used; when a multi-city string like `"Puerto Plata / St Thomas / Tortola"` fails, `firstLocationSegment_` retries with the first leg — **never splitting on a comma**, since `"Fairfax, VA"` is one place and `geocodeLocation_` depends on that form. Weather is then fetched per distinct place, keyed on coordinates — one call for an ordinary weekend, two for a split one — and the event search runs against the place he will actually be. **Every weather line names its city**, at home as well as away, so a temperature is never ambiguous.

**Weather always lands.** Each day resolves to one of three bases: `destination` (away, placeable), `home`, or `home-fallback` (away, but nowhere nameable). A fallback shows **home's** forecast rather than nothing — an empty weather section reads as broken — and `weatherFallbackSentence_` supplies one plain-prose line saying so. Both renderers call it, and a test asserts neither ships the numbers without it: `SAT · Fairfax, VA · 61°F` on a weekend spent in Tampa is the original bug rendered identically. The event search deliberately keeps the stricter rule and still refuses to run — weather is a fact about a place, an outing is a suggestion.

When there is genuinely no weather, `getWeekendWeather_` logs **which** of five reasons applied (`no weather — …`) instead of the single `weatherData=null` that made a dead API key, a blank `weekend_planner_home_city`, a failed fetch and a weekend past the 5-day forecast horizon all look the same. That horizon is also why Wednesday matters: a Monday run would put Sunday outside the window.

**Prompt register.** Several prompt strings used to be finished sentences about Ahmed in the third person, and Claude lifted them into the memo verbatim — "the destination could not be determined", system register in the middle of a warm note. Those are now written as instructions (`STATE: away…`, `DATA NOTE: …`), and the prompt carries an explicit rule never to describe the memo's own construction: no sections, no missing data, no explaining an absence. Where an absence genuinely shapes the weekend, it is stated as a plain fact in the prose.

**Running it on demand.** `testWeekendMemo()` generates this weekend's memo and
prints the prompt and finished text to the execution log without sending
anything — no email, no Slack ping, no calendar event, no cooldown entry, and
crucially no planner-history write (that is the anti-repeat record; writing it
would make the next real memo avoid suggestions it never made). It ignores the
~6.25-day cooldown, which is the point, and costs one Claude call per run.
`runWeekendPlanner_` itself is underscore-private and so hidden from the Apps
Script Run menu — this is its handle, as `testExplorer()` is for `runExplorer_()`.

A trip covering the weekend is classified `away` *before* the pre-departure check. That ordering matters: a trip starting on Saturday used to match `pre_major_trip` (`daysAway <= 4`) and instruct Claude to suggest something "short, local, and low-energy" — local to a home he would not be in. `pre_major_trip` now fires only for a trip starting after the weekend ends, which is the case it was written for.

### Trip Identity (`Trips.js`)

Every trip has an immutable **Trip ID** — `TRIP-9F3A7C21B0D4` — minted once and
never changed. Label, start and end dates track the current truth and are free
to move underneath it.

**Why it exists.** Trip identity used to be the string `startDate + '|' + label`,
computed fresh at sixteen call sites and frozen into eight tabs at write time.
Nothing could rewrite it: `webUpdateItineraryItem_` edits columns 3–10 and has no
branch for the key column at all. So when a cancelled flight moved a trip's start
date, the trip acquired **two identities** — the old key on every row already
written, the new one from the calendar. That produced two travel-day emails (one
per key), a pre-trip briefing that re-sent because its latch is keyed on the same
string, and a post-trip email that fired early because the new key owned only a
sliver of the itinerary.

**The registry** is the `Trips` tab: `Trip ID | Label | Start Date | End Date |
Calendar Event IDs | Aliases | Created | Last Seen | Status`. Event IDs is a
**set** — a cruise is assembled from a Board/Disembark pair, and the same trip
shared to a second calendar keeps one iCalUID. `Aliases` holds every legacy key
the trip has answered to. `Status` carries `merged:<TRIP-…>` forwarding, so a
losing ID still held by a chat transcript or an open tab resolves rather than
vanishing.

**Matching, first match wins:**

| | Survives | Fails when |
|---|---|---|
| 1. Calendar event ID | date edits, title edits, cross-calendar sharing | the event was deleted and recreated |
| 2. Alias | rows and clients predating the ID | a key never seen before |
| 3. Label + dates within **14 days** | a delete-and-recreate, a rebooked flight | the trip was renamed *and* moved at once |

Branch 3 is why the tolerance is generous rather than exact: reacting to a
cancellation often means deleting the calendar entry and making a new one, which
mints a new iCalUID, and only proximity saves the ID then.

**It never guesses.** Two matching records produce no new ID — it takes the
nearest range, breaks ties on the oldest `Created` so the answer is deterministic
across the 600-second trip cache, logs it, and raises a low-urgency flag. Minting
when unsure is precisely the failure being fixed.

**Where IDs are minted.** In `getUpcomingTravel_`, after `filterSubEvents_` and
**before** the cache write — a cache hit must never serve trips with no ID. The
matcher is idempotent, so a cache miss re-resolves every trip to the ID it
already has. A `LockService` lock stops two concurrent cold loads both minting;
on lock failure it resolves read-only and leaves the ID blank, because a briefing
with no ID is recoverable and two IDs for one trip is not.

**How the rest of the system asks.** Minting the ID was only half of it — every
consumer still compared the frozen `startDate|label` string, so the anchor existed
and nothing used it. Two helpers bridge that, and neither writes:

| Helper | Use |
|---|---|
| `tripKeysFor_(key)` | **every** key string the trip has answered to — what a read filters on |
| `canonicalTripKey_(key)` | the single key to **write** with, so new rows stop adding to a split |

Both resolve with `mint: false` **and `touch: false`**. The second matters more
than it looks: `resolveTripId_` calls `touchTripRow_`, which writes the label and
dates it was handed onto the matched row. That is correct when the fields came
from the calendar and destructive when they came from a legacy key — a key's date
prefix is the trip's *old* start date, so without the gate a single lookup reverts
the registry to whenever that key was minted, including the end date the post-trip
timing depends on.

Reads use `tripRowMatches_(cell, keys)` rather than `=== tripKey`, so a trip
holding two keys reads as one trip everywhere.

**Send latches key on the Trip ID.** `PRETRIP_48H_`, `PRETRIP_NB_`,
`POSTTRIP_NUDGE_`, `POSTTRIP_RECAP_` and `POSTTRIP_DEBRIEF_` all go through
`tripLatchSeen_` / `tripLatchMark_`, which check the ID first and then every
legacy key the trip has used. The flag dedup keys (`pretrip_briefing_`,
`posttrip_capture_`) go through `tripFlagKey_` for the same reason — the old form
embedded the key string, so a trip whose date moved flagged twice.

> **Run `tbSeedTripLatches()` once, before relying on this.** Changing the latch
> key orphans every in-flight trip's existing latch, and the next nightly run
> re-sends every pre- and post-trip email — the exact bug being fixed. Seeding
> copies each legacy latch onto its Trip ID, preserving the original timestamp. It
> is additive and idempotent: it writes only where an ID latch is missing, deletes
> nothing, and running it twice changes nothing. The readers also fall back to the
> legacy key for one release, so a missed seed still cannot re-send.

**Post-trip no longer fires early.** `getRecentlyCompletedTrips_` groups by Trip
ID and takes `endDate = max(registry end, latest row across every key)`. Before
this it grouped by the raw key string, so a trip whose start date moved had its
newer key owning only the rows written after the change — its "latest row" was the
departure day itself, the email fired days early, and the zero-day span is where
"1 night" came from.

`tbTripIdentity()` prints every trip, its ID, every key it answers to with row
counts, the end date post-trip would now compute, and any itinerary key belonging
to no live trip. Read-only: it writes nothing and cannot mint.

**Why the other tabs still show old keys — and how they connect.** Nothing rewrites
the key column when a trip's dates move, so a trip that split keeps both strings in
the sheet. That is deliberate: rows are found by **resolution**, not by rewriting.

But resolution only works if the registry knows the old key, and it cannot learn it
on its own: `attachTripIds_` sees trips as the **calendar** describes them, and the
calendar has already moved on. The old key exists solely in sheet rows. Until it is
adopted, `Aliases` is empty, `tripKeysFor_` returns a one-element set, and every read
still sees half the trip.

`adoptLegacyTripKeys_` closes that. It scans the eight trip-keyed tabs, and any key
that resolves to a live trip but is not that trip's canonical key is recorded as an
alias. It runs in the nightly pass as **Step 0e-ii**, before the pre-trip and
post-trip steps that depend on it, so the next moved date heals itself.

It resolves with `mint: false, touch: false, strict: true`. `strict` is the
important one: where minting picks the nearest match on ambiguity — refusing would
strand a real trip — adoption **refuses**, because the only cost is one key staying
unattached, against the risk of handing one trip's rows to another. Additive and
idempotent; a second run writes nothing.

`tbAdoptTripKeys()` previews it without writing. `tbTripIdentity()` separates keys
that are **adoptable** (a live trip owns them) from ones that are genuinely
**orphaned** (no trip does) — the two look identical otherwise, which is exactly what
makes "the tabs still show old keys" hard to read.

> The two fixes are independent and both matter. The registry anchor protects
> post-trip *timing* even before adoption, because `getTripBoundsByKey_` seeds the
> end date from the calendar. Adoption restores the *rows* — the itinerary, the
> recap contents, packing counts — and becomes the only protection when a trip has
> no registry end date.

**Repairing a trip that already split.** `repairOrphanTripKeysDryRun()` from the
editor lists every trip key across all eight tabs that resolves to no live trip,
with per-tab row counts and the trip it would merge into. It changes nothing
until you hand it a mapping you have read:

```js
repairOrphanTripKeys_({ dryRun: false, merges: { '2026-09-19|Florida Trip': 'TRIP-9F3A7C21B0D4' } });
```

It writes the alias first, so a half-failed run has already mapped the orphan and
nothing re-mints. It **refuses** a merge where both halves have a different
TripMeta Context or Notes, printing both so you choose.

Rows are re-keyed to the target's **canonical key**, not its bare `TRIP-…` id.
`getRecentlyCompletedTrips_` and `getTripBoundsByKey_` both skip any key that is not
`yyyy-MM-dd`-prefixed and derive the departure date from that prefix, so rows
migrated to ids would disappear from post-trip entirely. The id stays the real
identity; the key is its current display form. (`tripKeysFor_` carries the id in its
set regardless, so rows an earlier run already rewrote still match.)

Use it only when you want the sheet itself tidied — adoption already makes the rows
resolve correctly without touching them.

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

### Address Book (`AddressBook.js`, `WebApp.js`)

The shared list of people we send things to — Christmas cards, birthday cards,
invitations to the children's things. Lives under **People → 👤 People** in the main
dashboard and as its own **📒 Address Book** tab in the mobile one.

**It is a different spreadsheet on purpose.** It is shared with Victoria on its own,
without handing over finances, health and career with it.

**Point VERA at it from the Config tab**, with a row whose key is
`address_book_sheet_id` and whose value is the sheet id. The
`ADDRESS_BOOK_SHEET_ID` script property is also read, and wins when both are set, so
an existing deployment keeps working — but the Config tab is the one that actually
works in practice:

> **The Apps Script property editor lists only the first 50 properties and is
> read-only past that** — *"to manage or view all of your properties, do so
> programmatically using the Properties service."* VERA is well past 50, so a setting
> a human has to type cannot be added there at all. A sheet has no such cap, and
> `wishlist_*` and `victoria_email` already live there.

With neither set the tab shows a setup line and
**records nothing against API health** — an unconfigured feature is not an outage,
and filing one as a fault is how the "SOME DATA IS NOT LIVE" banner lost its
credibility the first time.

**Three tabs.** A card is addressed to a `Household` — one envelope, one address, "and
family". An email or a phone call reaches a person in `People`. And `Mailings` records
what was actually sent: one row per thing posted, `Household ID · Event · Sent ·
Notes`. One flat list would mean either duplicating the address on every member, where
the copies drift apart, or losing the per-person details.

**`Event` is free text** — "Christmas card", "Wedding thank you". The dashboard offers
the values already in use, most recent first, and lets a new one be typed, so inventing
an occasion needs no column, no config and no deploy. Every row is something that
**actually went out**; there is no planned or draft state, so a row never has to be
interpreted, only counted.

> **`Send Card` and `Last Card Sent` were retired when `Mailings` arrived.** They
> tracked exactly one occasion and exactly one date, so a second Christmas card
> overwrote the first and *"did they get one in 2024?"* had no answer. VERA does not
> delete them from a sheet that still has them — it stops reading and writing them, so
> the columns can be removed by hand whenever it suits.

**Bulk entry: the `Import` tab.** One row per person, with the household name
repeated for everyone in the same family; the address only needs filling on one row of
each household (first non-blank wins). Press **Preview** in the dashboard and VERA
fills a `Status` column saying what each row *would* do, writing nothing else; read it,
fix anything, then press **Import**.

- **Rows group by the `Household` column, not by matching addresses.** "12 Elm St" and
  "12 Elm Street" are one house to a person and two to a string comparison, which is
  how one family quietly becomes two.
- A person with no `Household` cell becomes a household of one. A blank row is a
  spacer, not an error — a pasted block usually has a few.
- **Re-running is safe.** Households match on name and people on household + name, so
  a second run reports what is already there rather than duplicating it.
- An existing household is **updated** from the Import row, and **a blank Import cell
  leaves the existing value alone** — unless the row gives an `Address Line 1`, in
  which case it is stating the whole address and its blanks **clear**. "The import is
  the fresher copy" and "a half-filled row wipes a good address" are the same code if
  you are not careful; the street line is what tells them apart.

> Without the second half, a wrong `Address Line 2` was **permanent**. The pre-pass
> refused to overwrite a non-blank address cell — but it had written that cell itself
> on an earlier preview and could not tell its own stale output from something typed
> by hand. With the one-liner consumed on a successful split, re-pasting could not get
> back in either. So: a pasted line now replaces all six parts, empty ones included.
>
> The rule reads **the row**, not where the row came from. Keying it on "this was
> pasted" is the obvious reading and is wrong — the preview consumes the one-liner, so
> by the time Import runs there is no paste left to detect, and the preview would
> promise `Address Line 2 (cleared)` while the import quietly did nothing. Preview and
> Import are one function over one row; the rule has to be too.
- Imported rows are **not deleted**. Every row keeps its Status so you can check the
  result; clear the tab yourself when you are happy.

**🔧 Check ids / Repair**, beside Preview and Import. Every row id must be unique, and
for a while they were not: `newAddressBookId_` was `Date.now()` plus three random
digits, and inside the import's loop `Date.now()` does not change — **a thousand
possible ids per millisecond**. Measured on the real generator, 68 households collide
88.7% of the time and 121 people 99.9%.

> Two households sharing an id is not cosmetic. `membersOf(id)` returns the union, so
> each shows the other's people and a search for one **matches the other**;
> `key={h.id}` collides and React corrupts the list as you type; `findAddressBookRow_`
> returns the first match, so the ✏️ on the second card edits the first; and
> `deleteAddressBookRowsFor_` removes **every** row with that id, so deleting one
> household takes the other's members with it and leaves it standing and empty.

The generator now carries a **sequence number**. More random digits would only have
lengthened the odds; a counter makes a collision within one execution impossible, and
one execution is exactly where the loop lives. `Date.now()` separates executions and a
random tail covers two of them starting in the same millisecond.

Repair is **in place and non-destructive**: in each colliding set the first row keeps
its id and the rest take fresh ones, people are re-linked **from the Import tab by
name**, and anything that cannot be established that way — a person who never came
through the Import tab, a mailing, which carries no name to match on — is **reported
and left exactly as it is**. Nothing is deleted and nothing is guessed. On a healthy
book it says there is nothing to do, so it is safe to press at any time.

> Preview and import are **one function with a flag**, not two implementations. A
> preview that can disagree with the thing it previews is worse than none, because
> being believed is the only way a preview can hurt you.

**Or paste whole addresses into `Full Address`, one per line.** Pasting a multi-line
block into a Sheets cell puts each line in its own row, which is exactly the shape
wanted. VERA splits each one working **from the end** — country, postal code, state —
because that is where the recognisable things are; whatever is left at the front is
the street, cut at a unit keyword (`Apt`, `Suite`, `Unit`, `#`…) so an apartment lands
in `Address Line 2`.

> **It matches vocabularies, not shapes.** The first version split on commas and then
> guessed: a state was "any two letters", a country "anything without digits". Both
> are wrong often enough to matter — `St` is two letters, `Texas` is not — and they
> failed *silently*. `7 Nile Street Zamalek Cairo, Egypt` put the whole line into
> `Address Line 1`, and `Austin, Texas 78701` made the **city** `Texas 78701` and
> pushed Austin into `Address Line 2`.
>
> So there are now four lists: every state by **code and full name** (`Texas` → `TX`),
> countries by alias (`US`, `U.S.`, `United States` → one spelling, or the same list
> groups under two countries), street suffixes, and unit keywords. Knowing the state
> turns it into an **anchor** — the city is what sits before it, the street before
> that — and commas become a hint rather than the only structure.
>
> `Ct` is both Connecticut and Court, and no vocabulary fixes that. **Position** does:
> a state is only read from the end of the tail, and a street's suffix is found by
> scanning back from what remains. Both orderings of `12 Oak Ct … CT 06103` are
> pinned.

**A line it cannot read is left alone and flagged.** If no city, state, postcode or
country can be identified, the address columns stay **blank**, the `Full Address` cell
is **kept** so there is something to retype from, and `Status` says
*⚠ could not read "…" — fill the address columns in by hand*. The household still
imports; it just has no address.

> The old behaviour was to put the unreadable line in `Address Line 1`. That reads as
> a filled-in row with no city and surfaces only when somebody goes to print an
> envelope — **a wrong address is worse than a missing one.** It also means "cleared
> means split" holds in both directions: consumed when it parsed, kept when it did
> not.

**The split happens in the Import tab, on Preview.** The parts are written into that
row's own `Address Line 1` / `City` / `State` / `Postal Code` / `Country` cells and
the `Full Address` cell is **emptied**, so you can correct a misread cell by cell
before anything reaches the address book. Everything downstream then reads an
ordinary typed row — the parse is not a special case in the grouping, the precedence
or the writes, and *"a typed column wins"* stops being a rule that needs writing down:
a non-blank cell is simply never overwritten.

> **The one-liner is consumed**, so a non-blank `Full Address` always means "not split
> yet" — paste again and it splits again. It is not lost on the spot: the line it came
> from goes into that row's `Status` cell, which is where you check the split. It does
> not survive the *next* run's Status, so comparing is something to do when you
> preview, not next week.

> It is still allowed to be approximate **only because you see and can fix its work
> before anything is written**. Earlier it parsed invisibly on the way to `Households`
> and merely *reported* what it had read — by the time a misread was obvious the row
> was already in.

**A row with an address but no household name** is imported named after the address
(`12 Elm St, Austin`), for renaming later, and every row of it says so in `Status`
until it is. It used to hit the blank-row guard — which runs *before* the parse — and
vanish with an empty `Status` and no trace: forty addresses pasted, three names
missed, three silently gone.

> Households group by **name**, so naming one after its street means two different
> addresses on the same street *and* city land in one household, and
> first-non-blank-wins drops the second one's details. Street + city makes that rare;
> beyond that, a group that absorbed more than one distinct address **says so in
> `Status`**, naming it, rather than losing one quietly. Keying those groups by the
> address instead was rejected: that key also decides update-or-insert, so it would
> need a second key just for matching, and getting that wrong breaks "running it twice
> is safe".

> **The preview still writes nothing to `Households`, `People` or `Mailings`.** It
> does fill in the Import tab, which it always did — that is where `Status` goes.

> `Full Address` arrived after the Import tab already existed, and `ensureSheet` only
> writes headers into a *blank* tab — so the column would never have appeared.
> `ensureImportColumns_` appends anything missing at the right-hand edge. It applies
> to `Import` alone, which VERA created and is the only reader of; `Households` and
> `People` stay under the never-disturb rule.

**The card run carries forward from history.** Pick an event and a household is on the
list **if it has a row for that event at all** — send someone a Christmas card once
and they are on the list every year after, with no flag anywhere to keep in step or go
stale.

**A row with a date is sent; a row with a blank `Sent` is planned** — on the list, not
posted yet. The pool offers both: *＋ Add* files the intention, *✓ Sent* files the
fact. Ticking a planned household marks it sent and **takes over that row** rather
than adding a second. Un-ticking puts it **back to planned**, and a *✕* on the row
takes the household off the event entirely, behind a confirm that says it drops the
whole history for that event and not just this year's.

> **Planned is stored as a blank date, not a Status column.** A Status cell can
> disagree with the date — `Planned` sitting next to `2025-11-02` — and in a tab two
> people edit by hand it eventually will. A blank date cannot contradict anything.

> **This reverses the original design**, which said every row was something that
> actually went out so a row would never have to be interpreted. That was wrong the
> first time the feature was used: an event has no storage of its own — the dropdown
> is derived from these rows — so with only sent rows allowed, naming a new event
> saved *nothing* and the name was gone on the next load. There is still no `Events`
> tab; an event becomes real on the first household added to it, and the run says so
> in as many words until then.

**Starting the first event.** The picker is built from the mailings that already
exist, so on an empty address book it offers *＋ New event…*: it asks what to call
the event, then opens its run with the add-someone pool already showing, because by
definition nobody has had it yet.

> Without that option the feature was a **closed loop** — the event list came from
> history, and the only control that can create the first piece of history lived
> inside a run you could not reach. Every test seeded the event list, so none of
> them ever stood where Ahmed was standing. The fix is pinned by running the real
> `startEvent` out of all three shipped dashboard copies.

> The still-to-send filter is a **toggle**, not an inference: *not sent this year*
> (right for anything annual) or *everyone on the list*. Guessing an event's cadence
> from its own history would be right most of the time and inexplicable the rest.

`ensureAddressBookTabs_` adds any of those tabs that are missing and **touches
nothing else in that document** — it reuses `ensureSheet`, which only writes headers
into a blank sheet, so whatever you already built in there is left exactly as it was.

> **There is no Birthday column, deliberately.** The `Important Dates` tab already
> stores birthdays, flags them ahead of time and writes them to the shared calendar.
> A second birthday list would be a second thing to keep right, and the one that is
> already wired up would win.

**Reads are header-driven.** Two people edit this sheet by hand, so a column *will*
get inserted in the middle of it; reading by position would shift every field by one
from that moment on and the first sign would be an address in the Notes column. A
write targets the header too, so a column you add yourself is never eaten.

**Writes are POST with a JSON body, not GET.** `makeUrl` in the dashboards drops
falsy values rather than sending them, so a cleared Address Line 2 or an emptied note
would never arrive and would read as *"leave this field alone"* — the bug that made
un-checking Autopay a silent no-op. Nearly every field here is optional free text, so
under GET almost all of them would have needed a presence flag. A JSON body carries
`""` faithfully.

- `save_mailing` is **idempotent on household + event + date**, because the dashboard
  logs by ticking a box and a double click must not leave two identical rows. The same
  event on a *different* date is a new row — that is the history the tab exists for.
- `Address Confirmed` is a date. A confidently wrong address is the real failure of a
  card list, and this is the only thing that can tell it from a merely old one. It
  renders as a quiet marker on the row — **no flag, no nightly step, no email.**
- **Deleting a household deletes its members and its mailings.** An orphan row
  pointing at a household that no longer exists renders nowhere, so it can never be
  found and fixed. The dashboard names both counts before you confirm. Both sweeps go
  through one `deleteAddressBookRowsFor_`, which deletes **back to front** — two copies
  of that loop is two chances to write the forward one, where deleting row 4 shifts
  row 5 up into its place and the loop skips it.

### Card Perks (`Code.js`, `WebApp.js`)

Tracks use-it-or-lose-it credit-card benefits on the `Card Perks` tab. A perk's
`Frequency` is `Monthly`, `Quarterly`, `Semiannual`, `Annual`, `Every N Years` or
`Standing`, and the periodic ones are strictly **calendar** periods — not
cardmember-anniversary quarters.

> **One of those frequencies is not like the others.** `Monthly` through `Annual`
> are **calendar-aligned**: everyone's Q3 is the same Q3, so the period belongs to
> the calendar and to nothing else — which is why `cardPerkPeriodKey_` is never
> shown `Last Used`. `Every N Years` is **use-anchored**: the period runs from the
> day *you* claimed it. Adding it was therefore not a matter of adding a literal.
> "Used this period" stopped being an equality test against a key derived from
> today and became a range test against the stored anchor, and the four
> hand-rolled copies of that equality test — `checkCardPerksExpiring_`, two sites
> in `Chat.js`, and `isPerkUsed` in the dashboard — all had to become one
> predicate, `cardPerkIsUsed_` (`Code.js`). If you add another frequency, decide
> which of the two kinds it is first.

> **Blank `Frequency` means `Monthly`, not "ignore".** Three readers do
> `String(row[4] || 'Monthly')`, and both period helpers fall through to Monthly
> for any unrecognised value. A benefit entered with a blank frequency therefore
> raises a "use it or lose it" flag, email and calendar event **every month,
> forever**.

**`Standing` is for benefits that never expire** — lounge access, elite status, a
DashPass membership: things you have rather than things you use up. Leave `Amount`
blank as well; it is display-only.

- `checkCardPerksExpiring_` skips them entirely — no flag, no email, no calendar
  event.
- `cardPerkPeriodEnd_` returns **null** for them, and every derived field
  (`periodEndIso`, `periodEndLabel`, `daysLeft`) is null rather than a fabricated
  deadline.
- Marking one used is a no-op that writes no cell and reports `reason: 'standing'`.
- **The monthly issuer relevance check still runs.** A standing benefit can be
  discontinued, and that is exactly the thing worth being told about.
- The dashboard groups them under their own `Standing` heading with an `♾️`
  badge in place of the used/unused checkbox.

**`Every N Years` is for a credit you can claim once every few years** — the
Global Entry / TSA PreCheck application fee is the case it exists for — enter it
as `Every 4 Years` — and it appears on three cards (`CP-14`, `CP-17`, `CP-23`).
All three shipped as `Annual`,
so every December VERA raised three High-urgency *"expires Dec 31, use it or lose
it"* flags, emailed both mailboxes three times and put three events on the shared
calendar, for a fee credit that cannot be claimed again for years.

- **`Last Used` holds a full date** — `2023-12-14` — not a year. It is the anchor
  the next cycle is measured from, and a year alone would read as available on
  1 January, eleven months early. For Global Entry that means a rejected
  application and a lost $120.
- `cardPerkPeriodEnd_` returns **null**, exactly as for `Standing`. That one line
  is what switches off the flag, the email and the calendar event: there is no
  deadline to miss, so missing it costs nothing.
- Instead it gets one **Medium** flag when the cycle completes —
  *"Global Entry / TSA PreCheck is available again ($120) — AMEX Platinum"* —
  written by `checkCardPerkEligibleAgain_` and keyed
  `perk_eligible_<id>_<anchor>`. Medium, not High: nothing is at risk, and a High
  flag that can never expire is how an alert surface stops being believed.
- **A blank `Last Used` gets no notice at all.** An absent stamp is not evidence
  that the credit is due; inventing an anchor would prompt you about credits you
  may have spent before VERA existed.
- Marking it used re-anchors it to today and closes the notice
  (`resolveCardPerkEligibleFlags_`, which matches on the perk rather than the
  anchor, because the caller has just overwritten the anchor).
- The dashboard folds every cadence into one **Multi-year** group — `perkGroups`
  is a list of exact strings, so a frequency carrying a number would otherwise
  render nowhere at all with no error, the same trap `Standing` fell into.
- **A multi-year row has no checkbox.** In its place is a date box holding the day
  you claimed the credit, because the exact day is what the next cycle is counted
  from and a one-click "today" is the wrong control for it. The perk form grows a
  **Last claimed** field the moment you pick `Every 4 Years`, so a new row can
  carry its anchor from the start. Clearing either one clears the cell and the perk
  goes back to reading *"Never claimed"*.
- Both go through `update_card_perk`, and `perkAnchorForWrite_` (`WebApp.js`) is the
  only thing that decides whether a typed value may be stored: a real `yyyy-mm-dd`
  date, not in the future, and **only** on an `Every N Years` row. A hand-typed
  period key on a Monthly perk is refused, because nothing would ever match it.

> **Two parameters carry a presence flag — `lastUsedSet` and `autopaySet` — and
> they are not optional decoration.** `makeUrl` in the dashboards drops falsy
> values rather than sending them, so a blank never arrives and is
> indistinguishable from a caller that never mentioned the field. Without the flag,
> *clearing* anything is a silent no-op. That is exactly why un-checking Autopay
> from the perk form did nothing until the flag was added.

> **Integer years only.** A benefit advertised as "every 4.5 years" should be
> entered as `Every 5 Years` and be late rather than early.

`Autopay = Yes` also excludes a perk from tracking, but it means something
different — *this credit spends itself* — so don't reach for it to silence a
standing benefit.

**`Last Used` is both the used-flag and the period stamp.** For the
calendar-aligned frequencies it holds a period key, not a date: `2026-09`,
`2026-Q3`, `2026-H2`, `2026`; for `Every N Years` it holds `yyyy-MM-dd`.
`cardPerkPeriodKey_` (`Code.js`) is the single definition of what gets written,
and `cardPerkIsUsed_` of what it means. That design is why a periodic perk
**resets for free** — nothing clears the cell at the period boundary; the stored
key simply stops matching the new one. A perk used in Q3 last year therefore also
reads as unused. A multi-year perk resets for free too, just by a different
mechanism: today walks past the anchor plus N years.

**Marking one used — three ways:**

| Where | How |
|---|---|
| Dashboard | Finances → 💳 Cards → click the card → 🎁 Perks → the green checkbox. A **toggle**, so a second click undoes a mis-click. |
| Chat | "I used the Uber credit" → `ACTION:mark_perk_used`. **Idempotent** — saying it twice never un-marks. |
| API | `GET ?action=mark_card_perk_used&id=CP-n` (idempotent) or `toggle_card_perk` (the checkbox's toggle) |

Both writers go through `resolveCardPerkRow_` (`WebApp.js`) so they can never
disagree about which column they stamp or which key they stamp it with.

If the same perk text appears on two cards, Chat **asks which** rather than
guessing — a wrong guess would silence a real reminder. Perks with `Autopay=Yes`
are excluded from tracking entirely; Chat refuses to mark them and says why,
while the dashboard checkbox still toggles them as a manual override.

**Reminders.** `checkCardPerksExpiring_` runs in `nightlyRun` and skips any perk
whose stamp matches the current period, so marking one used silences it for the
rest of the period. Within 14 days of the period end it raises a High flag; within
7 it also emails and adds a calendar event, both deduped per perk per period.
**Marking one used cleans up after the reminder**, whichever way you do it. Both
writers end in `finishCardPerkMarkedUsed_` (`WebApp.js`), which resolves the
open flag and takes the reminder event off the shared calendar if its day has not
arrived yet. An event whose date has already passed stays as history.

> They did **not** always agree. `webMarkCardPerkUsed_` (Chat, API) resolved the
> flag; `webToggleCardPerk_` — the dashboard checkbox, the path actually used —
> wrote the `Last Used` cell and nothing else. And the `VERA-PERK:<id>:<period>`
> marker had exactly one occurrence in the repo, where it is written, so nothing
> could find the event again. A perk redeemed from the dashboard therefore kept
> its High flag *and* still fired its calendar reminder on the deadline. Both
> writers now share one cleanup, and `perkCalendarMark_` builds the marker for the
> writer and the reader alike.

The event is matched on that exact marker — the period is part of it, and the
trailing `:` is what stops `CP-1` matching `CP-11`. This runs against the
**shared** calendar, so a loose match would delete real plans.

**Un-ticking a mis-click writes only the cell.** The flag stays resolved and the
event stays gone: re-raising them would mean clearing `writeFlags`' fingerprint
and the `PERK_NOTIFY_` latch too, and a mis-click is far commoner than genuinely
wanting the reminder back. The email, of course, cannot be unsent.

**And when the period ends unredeemed, the flag closes itself.**
`closeExpiredPerkFlags_` runs in `nightlyRun` immediately before the checker: any
`perk_expiry_*` flag whose period has passed gets `Resolved = Yes`, so a credit
that died on Dec 31 stops shouting "expiring in 3 days" from the dashboard in
March. Marking used was previously the *only* exit — `resolveCardPerkFlag_` fires
on that alone, and `recordExpiredFlags_` records an outcome at 30 days without
ever setting `Resolved` — so unredeemed perks accumulated one open flag per period.

- The deadline is derived from the **flag key**, not the perk row.
  `perkPeriodKeyEnd_` parses the period out of `perk_expiry_<id>_<periodKey>`
  (`2026`, `2026-H2`, `2026-Q3`, `2026-09`). The row may since have been deleted,
  renamed or given a different frequency, and the flag still has to close.
- A key it does not recognise — including `standing` — returns **null and the flag
  is left alone**. Closing someone's reminder on a guess is worse than leaving it.
- The outcome is recorded as **`expired`, not `resolved`**. He did not act on it;
  it lapsed, and "which perks he never redeems" is the signal the learning pass
  wants. This also prevents a double count: `recordExpiredFlags_` skips rows that
  are already resolved.
- The perk row and the calendar event are untouched. The event is an all-day
  event *on* the period end, so it is already in the past and self-documenting.

The email links to the dashboard root and deliberately carries **no API token**:
that token is a single global non-expiring credential authorising every endpoint,
and no VERA email carries one. It cannot deep-link to the specific card because
the dashboard has no hash or query routing, which is why the email still names
the path in prose.

### Email Admin & Travel Email Parser (`EmailParser.js`, `EmailAdmin.js`)

**Travel email parser** (gated by `email_parser_enabled=true`): scans Gmail every 30 minutes for travel confirmation emails (flights, hotels, cars, cruises, restaurants). Claude classifies each email with a confidence score. High-confidence emails are processed automatically into itinerary rows. Medium-confidence emails are held and a flag is generated for manual review. All processed emails are logged in the `Processed Emails` tab for deduplication.

**Email admin:** tracks email follow-ups in the `Email Follow-ups` tab. Chat can flag threads for follow-up.

---

## Nightly Pipeline

`nightlyRun()` runs every night at 11 PM via a time-based trigger. **Every step goes
through `nightlyStep_(ctx, name, fn)`**, which checks the time budget, writes a
breadcrumb, times the step and catches anything it throws — so a failure in one step
never aborts the rest of the run. Failures, skips and the slowest steps are posted to
`#vera-logs` as a summary at the end.

Each step used to hand-roll its own seven-line `try/catch`, forty times over, and
only three of those forty consulted the deadline. Two (`writeSummarySnapshot`,
`checkTaxDocuments_`) had no guard at all and could take the whole run down.

### The night runs in two halves

It outgrew Apps Script's six-minute ceiling. The morning banner read

```
Nightly run started but did not finish — died during checkHealthAppointments_ (5m in)
```

and that breadcrumb — the only timing evidence a *terminated* execution leaves — is
what chose the boundary: five minutes of work reached exactly that step, so
everything from it onwards **had not run on any night** for as long as it had been
happening. `checkMonthlyReview_`, `sendHealthPerformanceInsightMonthly_`,
`resetWeekMealPlan_`, `checkCrossPatternFlags_`, `suggestDueDates` and `runExplorer_`.

| Trigger | Covers |
|---|---|
| `nightlyRun`, `NIGHTLY_RUN_HOUR` | everything through `purgeExpiredCoupons_` |
| `nightlyRunTail`, an hour later | `checkHealthAppointments_` → `runExplorer_` |

> Splitting at the tidier `=== Critical path done — flags written ===` banner was
> rejected: it leaves nearly forty steps on the far side, which is where all the time
> goes. It would have moved the death, not prevented it.

**Each half keeps its own start marker, breadcrumb and heartbeat** —
`LAST_NIGHTLY_TAIL_START`, `NIGHTLY_TAIL_STEP`, `nightlyRunTail`. One shared
heartbeat would let the first half's success report the whole night healthy while the
second died every night unseen, which is the failure the split exists to fix, rebuilt
one level up.

**And a step is now only started if the budget could plausibly cover it**
(`NIGHTLY_STEP_RESERVE_MS_`). The guard used to ask only whether the deadline had
*passed*, so a step beginning at 5m00s still had sixty seconds before the kill — and
took it. A reserve turns "killed, silently" into "skipped, and said so".

> This is also why the `⏱️ Slowest steps` line had never once appeared: it is emitted
> at the *end* of a run, so it existed only for runs that did not need it. A run that
> ends cleanly produces it, which is the number that says whether the split bought
> enough headroom or only some.

**Adding the second trigger needs `setupTriggers` re-run in the Apps Script editor.**
It cannot be registered from outside.

### `setupTriggers` is safe to re-run, and says what it did

It used to hold **three** lists: a hand-written `||` chain of handler names to delete,
a run of create blocks, and a hardcoded `Logger.log` summary. Adding `nightlyRunTail`
touched exactly one of them.

So the function whose own docstring promises it is *"safe to call multiple times"*
deleted seven handlers, created eight, and **appended the tail on every call**. Two
tails a night means two Explorer bulletins, two `suggestDueDates` Claude calls, two
`checkCrossPatternFlags_` passes over the same flags, and two heartbeats racing one
property — and Apps Script caps triggers per script, so the list only grew. Meanwhile
the log named the seven it had always named, so it could not even tell you the eighth
existed. That is the log line that prompted this.

All three now derive from one `veraTriggerSpecs_()` list, so **a handler cannot be
created without also being deletable, and cannot be created without appearing in the
log.** The next trigger added gets all three for free, which is the actual fix.

- A **function**, not a top-level `var`: the root `.js` files share one global scope
  with no guaranteed load order, so a list initialised from `CONFIG.…` or
  `Session.getScriptTimeZone()` at load time would be a cross-file ordering dependency.
- Every delete runs **before** any create. Interleaving would let a create land ahead
  of its own delete, rebuilding the duplicate from the other direction.
- Re-running it **repairs** a project that already has duplicates: every handler it
  owns is removed before any is recreated, so two of anything collapse back to one.
- Triggers it does not own are untouched — `Slack.js` manages its own queue triggers
  the same way, and got this right first.

`tests/source/test_triggers.js` pins the **exact builder chain for all eight handlers**.
That is not a description of the new code, it is an equivalence check against what was
live before: this function points real schedules, and a dropped `.everyDays(1)` or an
`.inTimezone()` added to an `everyMinutes` chain is a silent misfire. The two minute-
interval pollers deliberately take no timezone.

### "Never run" and "does not exist" used to look identical

`getOverdueJobs_` skipped any job with no heartbeat. The reason was good — on a fresh
deploy nothing has recorded, and alarming on all eight would teach you to ignore the
alarm before it ever said anything true — but it had a consequence: **a job that has
never run was indistinguishable from a job that does not exist.**

`nightlyRunTail` sat in exactly that state after being added. No heartbeat, no start
marker, so nothing said each morning whether its trigger had registered at all. Had it
not, the watchdog would have stayed silent about it forever — which is the failure the
two-half split exists to end, rebuilt inside the thing that was supposed to be
watching.

`setupTriggers` now records **when** it registered each handler
(`recordTriggerRegistrations_`, one JSON property mirroring `SYSTEM_HEARTBEATS`). That
is the missing evidence:

| Heartbeat | Registered | Verdict |
|---|---|---|
| none | never | quiet — the fresh-deploy case, unchanged |
| none | within its window | quiet — it was not due yet |
| none | longer ago than its window, **no** start marker | **"has not run in the … since it was registered — the trigger may not exist"** |
| none | longer ago than its window, start marker **present** | **"has started but never finished in the …"** + `died during <step>` |
| stale | anything | unchanged — the registration never overrides a real heartbeat |

The last two draw the same trigger-problem/code-problem distinction the stale branch
already drew, now shared through one `jobStartedAndDied_` helper rather than copied.

> The map is **replaced** on each `setupTriggers` run, not merged: a handler no longer
> in the list is no longer registered, and carrying its timestamp forward would leave
> the watchdog waiting on a trigger that is gone.

**This needs `setupTriggers` run once to take effect** — that is what writes the
registration timestamps. Until then the watchdog stays exactly as silent about
never-run jobs as before, so nothing regresses in the meantime.

### Flags are written as they go, and read once, last

The split raised a fair question: are the dependencies across the two triggers still
in the right order — should flag-setting come after everything, so nothing slips under
the radar?

**There is no deferred flag write to get wrong.** Around fifteen modules call
`writeFlags` as each step determines something, so a flag exists the moment it is
found; the `writeFlags(flags)` in `nightlyRun` is only the Claude-generated batch. So
the order that matters is not where flags are *written* but where they are **read**:

| Step | Reads flags for | Position | Why that is right |
|---|---|---|---|
| `escalateAgedFlags_` | flags **≥ 3 days old** | first | tonight's are zero days old |
| `recordExpiredFlags_`, `closeExpiredPerkFlags_` | age / period expiry | mid | about older flags |
| **`checkCrossPatternFlags_`** | **unresolved High flags** → intensity signal | **last** | needs every writer first |

`checkCrossPatternFlags_` is the only step that reads *tonight's* flags —
`buildCrossDomainSnapshot_` counts unresolved High ones into the signal that decides
whether the week is loaded. It is last in the night, which is correct, and it sits in
the tail, which means **it had not been running at all**.

The split preserved relative order exactly: step N still precedes N+1, with an hour's
gap. `tests/source/test_nightlybudget.js` holds this as an executable invariant —
classify every step by whether it calls `writeFlags` (one level deep, which is how
`writePTOSnapshot_` writing via `checkAccrualCapRisk_` is caught) and assert
`checkCrossPatternFlags_` comes after all of them. It asserts on **writes** only: the
same classifier run over *reads* reported `writeWeeklySnapshot_`, which has zero flag
references.

**What the split did change.** A head that dies no longer stops the tail — it runs an
hour later regardless. On such a night most writers never ran, the High count is near
zero, and the pattern engine reads a loaded week as a quiet one, confidently and with
no sign anything was missing. So `checkCrossPatternFlags_` — alone among the steps —
is gated on `nightlyHeadCompletedTonight_()`, which requires **both**:

- `LAST_NIGHTLY_RUN` within `NIGHTLY_HEAD_MAX_AGE_MS_` (4h — `.atHour()` is a window,
  not a time, so the real gap between the halves ranges up to nearly two hours), and
- **no** `NIGHTLY_STEP` breadcrumb, which is deleted only on the head's success path.

Neither alone suffices: a hard kill skips the `finally` and so the timestamp, but a
head that *threw* reaches the `finally` and writes it anyway — the breadcrumb is what
separates those. It is the same pair the watchdog uses to tell "died" from "never
fired". Non-fatal step failures do **not** count as incomplete; those steps named
themselves in the head's warnings, and refusing every imperfect night would refuse
almost every night.

A withheld step is reported as `🚧 Tail skipped — incomplete input`, counted
separately from `⏭️ Tail skipped for time`, and logs the night `Partial`. The two are
kept apart the whole way through because they need different responses from you: one
says the night ran long, the other says the night was incomplete.

> The other tail steps are deliberately **not** gated. `checkHealthAppointments_`,
> `resetWeekMealPlan_`, `suggestDueDates` and `runExplorer_` read their own sheets, and
> `checkMonthlyReview_` summarises a month rather than a night. Withholding them
> because of one bad evening would cost work and buy no correctness.
>
> One gap worth naming: the gate catches a head that *died*, not a head that finished
> having **skipped** steps for time. The head does not tell the tail what it dropped,
> so a budget-trimmed night still gets pattern-matched. That is the case the morning
> banner showed, fixed; the other remains open.

### The morning email outgrew six minutes too

One morning no briefing arrived, and the watchdog said only:

```
• Morning briefing has not gone out in 1d 2h (expected every 26 hours)
• Morning email has not run in 1d 2h (expected every 26 hours)
```

The Apps Script Executions row read **Timed out** — the same failure as the nightly
run, in the job that reports every morning. A terminated execution skips its `finally`,
so `recordHeartbeat_('morningNudge')`, the delivery marker and `flushSystemLog_` all
never ran: no heartbeat, no email, and that run's log gone with it.

`morningNudge` builds from ~15 sources — the Flags sheet, Drive, Calendar, a weather
API, the watchdog, two task backends, Signal Learning. Each already had its own
try/catch, so it degraded on **error** but not on **time**: one slow dependency took
the whole email. Every phase now goes through **`nightlyStep_`** (reused as-is — it is
generic; only its name is nightly), which supplies the catch, so the duplicated
try/catch is gone, and adds the three things that were missing:

| | |
|---|---|
| a **`MORNING_STEP` breadcrumb** written *before* each phase | a kill now names the phase. A marker written afterwards never survives the kill it exists to explain |
| a **budget** checked before each phase (4m30s, not the nightly 5m30s — the HTML build and the send come after) | **the email still sends, without that section.** A missing weather ticker beats a missing email |
| **timings**, reported as `⏱️ Slowest morning phases` | emitted at the end of a run, so until the kill was fixed it was only ever produced by runs that did not need it |

Reading the Flags sheet and the send itself are deliberately **not** budgeted: without
them there is no email left to degrade. `morningNudge` also gained `LAST_MORNING_START`
and both markers are now in its `HEARTBEAT_REGISTRY` entry, so `jobStartedAndDied_`
says *"Morning email started but did not finish — died during `X`"* instead of *"has
not run"*.

> One duplicated round trip went with it: the capacity ticker called
> `getUpcomingEvents()` a second time purely to count today's meetings, which
> `todayEventsAll` already held — an extra calendar fetch on the one execution that was
> out of time.

### A job cannot report on itself

The first morning email after the timeout fix arrived — and contained these two lines,
about itself:

```
• Morning briefing has not gone out in 1d 23h (expected every 26 hours)
• Morning email started but did not finish; last run was 1d 23h
  — died during runWatchdog_ (expected every 26 hours)
```

**`runWatchdog_` is the phase that produced them.** `morningNudge` runs the watchdog as
one of its own phases, ~250 lines before it records either of its heartbeats — so the
watchdog saw a start marker four seconds old against a heartbeat from the last run that
actually *finished*, and answered exactly as designed. Both lines were true of the past
and absurd where they were printed, and the breadcrumb obligingly named the phase that
was asking.

> It only shows up **the morning after a failure**: on a normal day the delivery marker
> is ~24h old, inside its 26h window, so nothing is reported. Which means it appeared on
> precisely the morning the banner most needed to be readable.

`runWatchdog_(exclude)` now threads a job list down to `getOverdueJobs_`, and
`morningNudge` passes `['morningNudge', 'delivery:morning_briefing']`.

**Excluded at the registry walk, not at the renderer** — one `notices` object feeds the
email lines, `syncWatchdogFlags_` and `announceWatchdogToSlack_`, so filtering in
`getWatchdogNotices_` would have cleaned the email and left a High flag in the sheet
saying the morning email died during `runWatchdog_`.

**Nothing stopped being watched, and that is the point.** `hourlyCheck` runs the
watchdog every hour *without* an exclusion, so both jobs stay covered — just not by
themselves, mid-run. It is the same reasoning as the comment already at its call site:
*if a job is the thing that died, it cannot be the thing that notices.*

#### Why not just record the heartbeat earlier

`hourlyCheck` does exactly that — it records, *then* calls `runWatchdog_`, which is why
it has never reported itself. **`morningNudge` cannot copy it.** Its heartbeat lives in
a `finally` so that a *terminated* run leaves none, and that is the only reason the
six-minute kill was detectable at all; recording before the watchdog phase would have
masked it. So `hourlyCheck`'s ordering is load-bearing, is now commented as such, and is
asserted — a swap would quietly bring the self-report back there.

### "Fired and did nothing" is not "never fired"

Found while diagnosing the above. `Watchdog.js` has stated the rule from the start:

> `runEmailScan_` early-returns when `email_parser_enabled` is false (its default) and
> `checkFlightStatuses_` no-ops with no flights booked. **Both still record.** Otherwise
> the watchdog would alarm permanently about correct behaviour.

Nothing enforced it, and `morningNudge` broke it — its
`if (!isNotifEnabled_('morning_briefing')) return;` sat *before* the `try` whose
`finally` records. So a briefing you switched off would have reported as an outage every
morning forever, and a genuinely broken one produced the identical sentence. The check
is now inside the `try`.

**`tests/source/test_heartbeats.js` enforces it for every job in the registry:** for
each, find the `try` whose `finalizer` records that job's heartbeat, and assert no
`return` sits outside it. Derived from `HEARTBEAT_REGISTRY`, so a job added later is
covered without anyone remembering.

> **It parses rather than scans, and that was learned the hard way.** Four hand-rolled
> text-scanning versions produced four false positives: `/\bfunction\b/` matched the
> word in `hourlyCheck`'s *own comment* about returning early; blanking string contents
> desynchronised on `.replace(/'/g, '')`; walking backwards from the `finally` landed
> 4.5k characters early inside an object literal; and a block-comment pass that ignored
> strings read the `*/*` in an HTTP `Accept` header as a comment opener and blanked 40
> lines of real code. All the same mistake — treating JavaScript as text.
> `@babel/standalone` was already a devDependency and ships a parser.

And `delivery:morning_briefing` now carries an `enabledKey`, so a briefing that is
switched off stops being reported as undelivered — while its *job* heartbeat keeps
reporting, so the trigger itself is still watched.

### What a missing nightly run does and does not mean

`recordHeartbeat_('nightlyRun')` sits in a **`finally`** block — *the trigger fired*
is what a heartbeat records, success or not. That makes the failure modes readable,
and they are not the same thing:

| What you see | What happened |
|---|---|
| Heartbeat recorded, `#vera-logs` summary with step warnings | Steps failed; the run finished. The warnings name them. |
| **"VERA Error — Nightly Run Failed"** email with a stack | Something threw outside a step's own guard. The `catch` emailed you, and the `finally` still recorded the heartbeat. |
| Watchdog says **"started but did not finish — died during `X`"** | The execution was **terminated** — almost always the 6-minute Apps Script ceiling. `finally` never ran, so there is no heartbeat and no email. `X` is the step it was in; see the breadcrumb below. |
| Watchdog says **"has not run in …"** with no start marker | The trigger never fired. Check **Triggers** in the editor; Apps Script auto-disables one after repeated failures. |
| Watchdog says **"has not run in the … since it was registered — the trigger may not exist"** | It has *never* run. `setupTriggers` recorded registering it, and no execution has followed. See below. |

The middle two used to be indistinguishable, which cost an investigation. `nightlyRun`
now writes `LAST_NIGHTLY_START` before any work and `LAST_NIGHTLY_RUN` beside the
heartbeat, and the Watchdog compares them. (`LAST_NIGHTLY_RUN` had been *read* by
`Slack.js` and written nowhere, so that status line always said `unknown`.)

> **A start marker is not a heartbeat.** It is deliberately not recorded as one: a run
> that started is not a run that happened, and letting the Watchdog count it would hide
> exactly the failure it exists to surface.

**The breadcrumb: `NIGHTLY_STEP`.** Knowing the run *died* still left the real
question open, and a terminated run takes its own evidence with it — the System Log
buffer only flushes at 50 rows (`SYSTEM_LOG_AUTOFLUSH_ROWS_`) and a nightly run never
reaches that, so the whole run's log is lost. `nightlyStep_` therefore writes
`<step>|<seconds elapsed>` to a Script Property **before** running each step. A marker
written afterwards would never survive the kill it exists to explain. A completed run
deletes it, so its *presence* is the signal, and the Watchdog reads it to name the
step.

> This does not guarantee the run survives. The budget cannot preempt a step that is
> already running, so one pathologically slow step can still blow the ceiling. What it
> guarantees is that the run stops being *invisible*: accumulated slowness now skips
> instead of dying, and a single slow step is named in the next morning's email.

**Time budget.** `DEADLINE` is set at 5 min 30 s, 30 seconds short of the ceiling, and
**`nightlyStep_` checks it before every step**. Past it, a step is skipped and
recorded rather than started — which is what lets the run reach its own `finally`,
write the heartbeat and report what it dropped, instead of being killed silently.
Skips are reported separately from warnings in the summary: the budget working as
designed is not a step failure.

The old arrangement checked the deadline at three sites, which meant a heavy step
*early* in the run spent the whole budget and the three guarded steps at the end never
got the chance to skip anything.

**Per-step timings** go to `#vera-logs` on every run, not only bad ones — a step
creeping towards the ceiling is worth seeing while it is still creeping, because by
the time it kills the run, the run is the thing that cannot tell you about it.

### API health: what belongs in the "SOME DATA IS NOT LIVE" banner

The banner's job is to say *do not trust this data*, and it loses that authority the
moment it reports things that are fine. Three rules keep it honest:

- **A successful call with an empty result is not an outage.** `fetchFlightStatus_`
  used to record a health *failure* on an HTTP 200 with an empty `data` array — but
  the AviationStack free tier only carries current/upcoming flights, so a flight
  booked weeks out legitimately returns nothing and the API answered perfectly to say
  so. It records a **success** now and still returns `null`, because *this flight has
  no live status* is a fact about the flight, not about the API.
- **An HTTP 429 is "try later", not "this data is wrong".** `recordApiHealth_` counted
  a rate limit like a 500, so open-meteo put a line in the banner every single morning
  — `last good data 8h 17m ago`, for a quota VERA does not spend. Open-Meteo limits
  **per IP** and Apps Script egresses from Google ranges shared with every Apps Script
  project, while VERA makes a handful of calls a night; caching harder cannot reliably
  change that. A 429 now records `lastRateLimited` / `rateLimitHits` and changes
  **nothing else** — `consecutiveFailures`, `lastError` and `lastFailure` are left
  exactly as they were. Two consequences fall out of that, and both are wanted: a
  source already degraded by a genuine fault **stays** degraded through a 429 and
  cannot be papered over by one, and a later success still clears everything normally.
  It is still announced in `#vera-logs`, through its **own** cooldown field
  (`lastRateLimitAlertedAt`) — sharing `lastAlertedAt` would let a daily rate limit
  suppress the alert for a real outage that started in between.
- **`pruneApiHealthState_` drops entries nothing has touched in 14 days.** A source
  retired from the code leaves residue that can never recover — clearing a failure
  requires a successful call, and nothing is ever going to make one. That is how
  `googlefit-steps` nagged daily for an integration that does not exist (only
  `googlefit-sleep` does). The discriminator is **recency of activity**, not failure
  count: a genuinely broken source still has code calling it, so its `lastFailure` is
  refreshed every night and it survives the prune however long it has been failing.
  **`lastRateLimited` counts as activity** in that recency check, because a 429
  deliberately freezes both `lastSuccess` and `lastFailure` — a source rate limited
  every day would otherwise age out as an orphan and be recreated on the next call,
  for ever.

> **open-meteo has four callers, not one.** `geocodePackingDestination_` (city →
> lat/lon, cached 6h) and `getPackingWeather_` (`WebApp.js`), `tripDailyForecast_`
> (`TripDecisions.js`), and — until the 429 work — the `☀️ UV` chip in `Weather.js`.
> Those first three feed `PreTripBriefing.js`, `TravelDayBriefing.js`, `TripDecisions.js`
> and two dashboard endpoints, so **open-meteo is load-bearing for packing and trip
> weather** and a real open-meteo fault must still reach the banner. `fetchUVIndex_` was
> the least valuable of the four — it already degraded to a dash — and is gone; the
> ticker keeps temperature, rain and AQI. openweathermap carries UV only on One Call
> 3.0, a separate subscription the three endpoints VERA uses do not include.
> `test_ratelimit.js` asserts the other three callers still exist and still record
> health, so "remove the UV chip" can never quietly become "remove trip weather".

### Script property housekeeping

`pruneScriptProperties_` (`AddressBook.js`) runs nightly and drops expired latches.
Three kinds were written and **never deleted**, and only fixed-name properties
(`Pacing.js`, `PTO.js`) were ever cleaned up:

| Key | Written | Growth |
|---|---|---|
| `day_plan_<yyyy-MM-dd>` | a cache for Chat's apply action | one a day — 365 a year |
| `PERK_NOTIFY_<ID>_<PERIOD>` | "already emailed about this perk" | one per perk per period |
| `TDB_SENT_<yyyymmdd>_<LABEL>` | "already sent this travel briefing" | one per travel day |

Each answers *"have I already done this"*, and the answer stops mattering once the
period is past. This is the same disease as the orphaned `googlefit-steps` health
entry — accumulated state nothing prunes — and it is what pushed the property store
past the editor's 50-row cap.

> **Deleting one too early re-sends something**, so every window is far wider than it
> needs to be: 7 days for a day plan (a pure cache), 30 for a travel briefing, and 60
> days **after the period end** for a perk notification. A key shape it does not
> recognise is left alone rather than guessed at.

> **It deletes one key at a time, never `deleteAllProperties()` plus a restore.** The
> cheap version is one round trip instead of N, and also a way to lose the API health
> state, every heartbeat and the web token if the run is killed between the two calls
> — and the nightly run is killed often enough to have a watchdog for it. The perk
> period is matched at the **end** of the key, because ids are minted as
> `'CP-' + Date.now()` and a four-digit match anywhere would read part of the
> timestamp as the period.

> Maintenance that walks a whole tab must read it in **one** `getValues()` and delete
> contiguous runs with `deleteRows(start, count)` — see `deleteRowsOlderThan_`
> (`Memory.js`) and `pruneSystemLog_` (`VERALog.js`). In Apps Script every `getValue()`
> and `deleteRow()` is its own round-trip, so a per-row loop over a few thousand rows
> is minutes of wall clock. That is not a micro-optimisation: it is the difference
> between a run that finishes and one that is killed without recording anything.

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
| Step 0e-ii | `adoptLegacyTripKeys_()` | Attach legacy trip keys found in the tabs to the trips they belong to — must precede 0f and 0g |
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
| `hourlyCheck` | Every 1 hour | Anticipator reminder rules + Weekend Planner (Wednesday 8am) |
| `checkFlightStatuses_` | Every 15 minutes | Real-time flight status polling via AviationStack for flights within 24h |
| `runEmailScan_` | Every 30 minutes | Travel email inbox scan (gated by `email_parser_enabled=true` in Config) |

All triggers are installed by `setupTriggers()`. The function is safe to call multiple times — it deletes existing VERA triggers before recreating them to prevent duplicates.

> **Warning:** `runEmailScan_` can generate up to 144 Claude API calls per day when enabled. Only enable it when actively processing a travel email backlog. Disable when done.

---

## Running Things by Hand (`TestBench.js`)

Everything above runs on a schedule. **`TestBench.js` is the index for running
any of it now**, from the Apps Script editor. Open the file, scan the sections,
pick a `tb*` function from the Run dropdown, read the Execution log.

It exists because the Run menu lists 200+ functions, so it is a haystack rather
than a menu. Most entries are one-line callouts — the implementations stay in
the files they belong to, and nothing is reimplemented here.

| Section | Entries |
|---------|---------|
| 1. Health & connections | `tbApiHealth`, `tbSystemHealth`, `tbWeather`, `tbClaude`, `tbSheetIntegrity`, `tbCalendarAccess` |
| 2. Daily & weekly emails | `tbNightlyRun`, `tbMorningNudge`, `tbWeekendMemoDryRun`, `tbWeekendMemoSend`, `tbWeeklyTrendReview`, `tbHourlyCheck`, `tbDailyDiscovery` |
| 3. Travel | `tbTripIdentity`, `tbAdoptTripKeys`, `tbSeedTripLatches`, `tbPreTripBriefing`, `tbTravelDayBriefing`, `tbTravelDayMap`, `tbLoungeAccess`, `tbPostTripCapture`, `tbTripLessons`, `tbTripDecisions`, `tbGeneratePacking`, `tbGenerateDiscoveries`, `tbTripContext`, `tbFlightStatus` |
| 4. Data & trackers | `tbPerkEventPurgePreview`, `tbPerkEventPurgeRun`, `tbPTO`, `tbGym`, `tbFitness`, `tbPantry`, `tbShopping`, `tbImportantDates`, `tbFinancialGoals`, `tbProjects`, `tbProjectHealth` |

### Knobs

**Apps Script cannot pass arguments from the Run menu.** Anything that needs a
date, a window or a trip is therefore a constant at the top of the file — edit
it, save, then run.

| Knob | Effect |
|------|--------|
| `TB_DATE` | `'yyyy-MM-dd'` — the travel-day briefing treats this as today, so you can preview a trip day that is not today. Blank = the real today. |
| `TB_PRETRIP_HOURS` | Widens the pre-trip departure window, in hours, to reach a trip further out than the configured 48. `0` = use `pretrip_briefing_hours`. |
| `TB_TRIP_LABEL` | Which trip `tbGeneratePacking` / `tbGenerateDiscoveries` target. Blank = the next upcoming one. |
| `TB_AIRPORTS` | `'TPA,IAD'` — airports for `tbLoungeAccess`, first treated as the departure. Set it to check lounge matching on a day with no trip; blank = scan the itinerary. |
| `TB_LESSON_TRIP` | `'Orlando, Florida\|Family\|beach'` — a made-up trip for `tbTripLessons` to match lessons against, as `destination\|context\|activities`. Any part may be blank. Blank overall = list every lesson without matching. |

### These send for real

With two exceptions, the entries do the real thing: real emails, real Slack
pings, real calendar events.

Where a once-per-trip or once-per-week guard would otherwise make a second run
silently do nothing, the wrapper **clears that guard first and says so in the
log** — `tbWeekendMemoSend` clears the 6.25-day cooldown row, and
`tbPreTripBriefing` / `tbPostTripCapture` delete the matching Flags rows,
because `writeFlags()` fingerprints against every flag ever written. A test that
quietly no-ops is worse than no test.

The two exceptions are **`tbWeekendMemoDryRun`**, which builds the whole memo,
logs the prompt and the finished text, and sends nothing — it would otherwise
write anti-repeat history that skews the next real memo — and **`tbProjects`**,
which writes a throwaway test project whose rows you should delete afterwards.

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

### Trip Lessons — what one trip teaches the next

A Florida beach trip was packed without a hat or a water bottle. Two separate
things were wrong, and the second shapes the whole design:

1. The packing prompt's beach hint listed *"swimwear, water shoes, dry bag,
   reef-safe sunscreen"* — it named neither.
2. That hint only fired when an **itinerary row was typed `beach`**. `activityTypes`
   is built from itinerary row types, not from the trip's name or context. With no
   beach-typed row, the hint never ran at all. **Fixed at the source:** the hints now
   also read the trip's Characteristics, so a trip marked `beach` gets beach guidance
   whatever its itinerary contains. The same applied to the ski, cruise, outdoors and
   theme-park hints, which all had the identical weakness.

The capture half already half-existed: debrief question 3 has always asked *"anything
you'd skip or do differently?"*, and the answer went into the Shared Interests ledger
— which `Interests.js` and the recap email read, and **nothing that plans a trip ever
did**. The loop was built on one side only.

**A lesson is a scoped rule, not a diary entry.** It lives on the `Memory Log` tab as
a `trip_lesson` row, with two columns no other event type uses:

| Scope | Fires on | |
|---|---|---|
| `trait:beach` | any trip marked with that **characteristic** | **prefer this** |
| `always:*` | every trip | |
| `context:Family Trip` | trips with that Trip Context — who you are with | |
| `destination:florida` | trips to that place, matched either way round so stored `florida` catches `Orlando, Florida` | narrow fallback |
| `activity:beach` | trips with an itinerary row of that `type` | narrower still |

> **A lesson generalises over the kind of trip, not the place.** The hat and the water
> bottle have nothing to do with Florida — they are about *beach trips*, and should
> fire for Hawaii or Greece too. Scoped `destination:florida` the lesson only ever
> helps on a return visit to the same state; scoped `activity:beach` it would have
> missed the original trip *for exactly the same reason the hint did*, since both
> read itinerary row types and no row was typed `beach`.
>
> `destination` survives because some lessons really are about a place — *"leave 30
> min earlier for ORD"*, *"tipping works differently in Japan"*. It is the wrong
> default, not a wrong idea. The debrief now offers `trait` first and names
> `destination` as the narrow fallback.

**Trip Characteristics** are what `trait` matches against: a `Characteristics` column
on `TripMeta` holding `beach, city` — multi-value, because Miami is both and forcing
one would make the field lie. The vocabulary is `beach · city · resort · ski ·
outdoors · roadtrip · cruise · themepark`, and `normaliseTripCharacteristics_` drops
anything outside it, since a characteristic nothing can match is indistinguishable
from a typo.

This is a **different axis from Trip Context**, which is `Anniversary Trip · Work Trip
· Family Trip · Girls Trip · Solo Adventure` — entirely *who you are with and why*.
A beach trip is a beach trip whether it is an anniversary or a family holiday.

Set them from the chips under the trip briefing in the dashboard, or in Chat with
`set_trip_characteristics`. Seeding is a deterministic keyword scan of **the trip
briefing** — the field that already says what the trip is actually for, so *"beach
week with the family"* suggests `beach`. No Claude call: explainable, free, and wrong
only by omission, which is why it is a suggestion and the field stays editable. The
trip *label* is deliberately never scanned — "Florida Trip" does not say beach, and
guessing a trip's character from its name is the move that already failed.

> **A blank Characteristics field is the one real hazard.** It reads exactly like
> "not a beach trip", so every `trait:` lesson silently says *no match* for a reason
> that has nothing to do with the lesson. It is therefore reported rather than
> inferred: the chips say so when empty, `webGeneratePacking_` returns
> `characteristicsMissing` with what the briefing suggests, and `tbTripLessons()`
> prints a note.

`Category` decides who reads it back: **Packing** reaches the packing prompt,
**Dining** and **Activities** reach the recommendations prompt. **Logistics** and
**Other** are captured and visible in chat but injected nowhere — a vague lesson
cannot quietly distort a generator.

In both prompts the block sits **above** the rules, not after them: a lesson exists
because the generic rules already failed once. In recommendations it sits before the
search instruction, so what you rejected shapes the search rather than being applied
to its results. Both lookups are non-fatal — an unreadable Memory Log costs you the
lessons, never the list.

**Lessons do not age out.** `pruneMemoryLog_` deletes rows older than
`memory_log_retention_months` (default 12) and now skips `trip_lesson`. Everything
else in that log records something that happened and has served its purpose a year
on; a lesson is a standing rule, and deleting it on its first birthday would silently
undo the thing it was written for. Retire one by deleting its row.

An unparseable scope is **refused at the door** — `logTripLesson_` returns an error
Chat surfaces, rather than writing a row every reader would ignore. Treating it as
"applies to everything" would push it into every prompt forever.

Check your work with `tbTripLessons()` (set `TB_LESSON_TRIP`), which lists every
lesson, says which would fire for a made-up trip, flags any unparseable scope, and
prints the exact block each prompt would receive. The failure mode is otherwise
silent: a lesson scoped to something your next trip won't match is indistinguishable
from no lesson at all.

### Pre-trip Briefing

48 hours before departure (configurable via `pretrip_briefing_hours`), VERA generates a High-urgency flag containing: destination weather, all flight legs with confirmation numbers, full itinerary overview, cancellation deadlines, and packing list completion percentage. Fires exactly once per trip via the flag key deduplication system.

### Travel-Day Briefing — where flight times come from

The day-of email reads its itinerary from **`webGetItinerary_`**, the same
function the dashboard's Active Travel Card uses, called with no second argument
so its per-event timezone pass runs. That pass formats each departure in the
event's own `start/timeZone` and each arrival in its `end/timeZone`, which is the
only reason the card has always shown the right clock.

The briefing used to run its own `CalendarApp` pull, format both ends in the
script zone, and write `dep_scheduled` / `arr_scheduled` as `.toISOString()` —
**UTC instants** — into metadata that the Claude prompt then labelled "local to
the origin/destination airport". It also scraped the destination IATA code from
the event **title only**, so `Flight to Washington (UA 1370)` yielded nothing.
Handed a UTC instant under a false label and no destination, Claude converted the
departure correctly and echoed the raw UTC clock for the arrival: a real email
showed `6:47 PM (TPA) → 1:03 AM (unknown)` for the flight its own schedule
section, four lines below, printed correctly as `18:47 – 21:03`.

**Measured, not generated.** `USEFUL TO KNOW` fields that are facts are computed
server-side and overwrite the model's answer unconditionally after the call:

| Field | Source |
|---|---|
| `dep_local`, `arr_local` | `webGetItinerary_`'s per-zone times, formatted 12-hour |
| `origin_code`, `dest_code` | the itinerary row — description **and** title |
| `tz_offset_hours`, `tz_offset_label` | the two IANA zones, evaluated **on the flight date** so August gets DST and January does not |
| `distance_miles`, `haul_category` | haversine over Open-Meteo geocoder coordinates (keyless, cached 6h) |
| `daynight_pct_day` | still the model's estimate — clamped 0–100 |

Zones come from the calendar where it supplies them and from the geocoded city
otherwise; the calendar's are exact, so they win. City centroids carry a 10–40 km
error, irrelevant at the rounding the email prints.

**Nothing prints a number whose input was unknown.** `tz_offset_hours` stays
`null` rather than becoming `0`, and every renderer gates on it. The dashboard's
recovery card shows an explicit *"timezone shift unknown"* state — previously the
`|| 0` coercion set its recovery window to zero days and the panel silently
disappeared on every day after a flight. A known departure time also survives an
unknown arrival: the times row is an OR, not an AND, and names the missing half.

### Lounge Access — five gates, and why it was silently empty

The travel-day email's `LOUNGE ACCESS` section **never rendered, on any email ever
sent.** An orphaned paragraph of `buildTravelDayPlainText_` had been spliced into
`getLoungePerkPrograms_`'s body, referencing `narrativeData` and `lines` — neither
in scope. Every call threw `ReferenceError`, the function's own catch returned
`[]`, and the section vanished. Nothing logged.

That was gate 1 of five. Each one now names itself in the execution log:

| Gate | Requires |
|---|---|
| 1 | `getLoungePerkPrograms_` returns without throwing |
| 2 | a `Card Perks` row whose **Perk** text names a lounge program |
| 3 | an IATA code from `metadata.origin`/`dest`, or a bare 3-letter code in **Location** |
| 4 | Claude names a lounge it is confident about |
| 5 | the reply fits the token budget and parses |

**Gate 2 is the one to check first.** `populateCreditCardHub_` seeds exactly one
matching perk (`CP-15, AMEX Platinum, Priority Pass`) and **aborts entirely if the
Credit Cards tab already has a data row**, so a sheet whose cards were entered by
hand never got it. This is a sheet fix, not a code fix.

**Programs recognised** — one ordered table, so matching and labelling cannot
disagree: Centurion Lounge · Priority Pass · Capital One Lounge · Delta Sky Club ·
United Club · Admirals Club · Escape Lounge · Plaza Premium · Global Lounge
Collection. Anything else containing "lounge" or "airport club" keeps its own perk
name rather than being dropped. A perk naming two programs yields **both** — the
old first-match cascade reported one. Airline clubs were previously invisible:
`Delta Sky Club` contains no "lounge" substring, so a row for it was discarded in
silence.

**It never shows an empty section.** When gates 1–3 pass but no lounge can be
named, the email lists the programs actually held plus today's airports and says
to check the program's app. An empty section is indistinguishable from the bug
above, which is precisely why it went unnoticed for so long.

**Lounge names are grounded in search, not recalled.** They used to come purely from
the model, and it invented them: a "Centurion Lounge Chicago O'Hare" at an airport
that has never had one, and the same at IAD. The prompt already said *"only include
lounges you are CONFIDENT exist — do not guess"*, and it guessed anyway, so that
paragraph is gone; stronger wording was never going to be the fix.

`searchLoungeCandidates_` runs a general `<CODE> airport lounges list` query per
airport — the shape that surfaces pages actually enumerating lounges — then one per
programme, phrased so a name already containing the word does not produce
`Centurion Lounge lounge DCA airport`. General queries go first so a capped run keeps
the informative ones; 12 queries max, cached 24h. The prompt then asks the model to
pick from those results rather than to remember. The guard that actually holds the line is deterministic,
in `validateLounges_`:

**Two ways in, and both are needed.** A lounge is kept when it passes the cheap
rejections **and** either:

- **its name appears verbatim** in the snippets retrieved for *its own airport* —
  `loungeNameIsGrounded_`, normalising both sides to lowercase alphanumerics. Free,
  deterministic, and how a proper noun like `The Club DCA` gets through. Per-airport
  on purpose: a real name from one airport must not vouch for a fabrication at
  another; or
- **its (programme, airport) pair verifies** — `verifyLoungeProgramAtAirport_` runs
  one targeted search and takes a one-word `CONFIRMED` / `NOT_FOUND` / `UNKNOWN`
  verdict, cached 24h. **`UNKNOWN` is not a yes.**

The second path exists because the first had a false negative: `The Centurion Lounge
at Ronald Reagan Washington National Airport` is real, but it is a *description*, not
a string any snippet contains — and it was being rejected by an arbitrary 60-character
cap before grounding even ran. The cap is now 100 and runs *after* grounding.

Equally, the pair check cannot replace the string check. `Centurion Lounge` appears in
ORD's results too, inside a list of cities that does not include Chicago — so no
substring test can separate *"there is one here"* from *"they exist, elsewhere"*, and
no model verdict alone should be the only guard. Keeping both is the point.
- A name containing a parenthetical or a hedge is **not a name** — the real run
  produced `"The Salon at O'Hare (United Polaris Lounge excluded; check current
  PP-participating lounges)"`.
- `hours`, `guest_limit` and `access_window` that say *"Varies by lounge"* or
  *"check the app"* are **nulled, not printed**.
- The airport and programme must be ones we asked about; the card always comes from
  the Card Perks tab, never the model.
- **The tip is cleared whenever anything was dropped.** It is written against the
  pre-validation list, so it once recommended the very Centurion Lounge that had just
  been removed — the same invention returning through a different field.

Every drop is logged with its reason, and `tbLoungeAccess()` prints them.

**Without `VERA_SEARCH_API_KEY` there are no names at all.** No candidates means no
model call — the section shows the programmes you hold and the airports in play, and
stops. The failure mode is silence, never fiction. The caveat line stays even when
names verify: a search snippet is not an official feed, and hours move.

**`tbLoungeAccess()`** walks the gates in order and stops at the first failure,
printing every `Card Perks` row with its matched program or why it missed, the
airports found and the row each came from, and Claude's raw reply before parsing
— the only way to tell gate 4 from gate 5. Set `TB_AIRPORTS = 'TPA,IAD'` to run it
on a day with no trip.

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
| Projects | `PROJECTS` | Multi-step projects with subtasks. Project-level `Owner` (Ahmed / Victoria / Shared, blank = Shared), `Target Date` and `Context` are written on every row of the project; per-task `Completed On`, `Phase` and `Sequence`. Rows are never moved — order is the `Sequence` field, because `rowNum` is a task's identity | User + chat managed |
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
| TripMeta | `TRIP_META` | Per-trip `Context` (a short label — Anniversary Trip, Work Trip — picked from a menu or typed) and `Notes`, which holds the **trip briefing**: free text saying what the trip is actually for. The column keeps its original name; everywhere a person reads it, it is the briefing | User + chat managed |


**Trip briefing.** Each trip carries two separate pieces of context. The
`Context` label is a category and drives category-shaped prompt rules
("Anniversary → spas, candlelit dinners"). The **briefing** is a sentence about
this particular trip — *"visiting Sarah and Tom for the new baby; quiet and
low-key, we want to be useful"* — and it feeds the discovery engine, the packing
list, both pre-trip emails and the travel-day narrative. Where the two conflict,
the generators are told the briefing wins. Set it in the Travel tab or from chat
with `set_trip_briefing`; `dashboard-lite` shows it read-only.
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
| `project_stall_days` | `14` | Projects | Days with no completed task before a project reads as stalled. A project with no `Completed On` stamp at all is never called stalled, so projects predating the column do not all go red at once |
| `project_at_risk_days` | `7` | Projects | Days before the target date at which a project less than half done reads as at risk |
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
| `weekend_planner_hour` | `8` | WeekendPlanner | Hour on Wednesday to fire Weekend Planner |
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
| `ADDRESS_BOOK_SHEET_ID` | No | AddressBook.js | Shared address book Google Sheet ID. Unset simply hides the feature |
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
| `Projects.js` | Projects CRUD; the derived model and health verdict (`decorateProject_`, `projectHealth_`); `setProjectTaskStatus_()` keeps `Completed On` in lockstep with status; `setProjectFields_()`/`reorderProjectTasks_()`; `PROJECT_PLAN_GUIDANCE_` — the single copy of how VERA plans a project, shared by the chat prompt and the drafting endpoint; `getProjectsSummaryForContext_()`; `ensureProjectsSchema_()` widens an existing tab to the current `PROJECT_HEADERS` |
| `PatternRecognition.js` | Cross-domain pattern recognition — 7 compound patterns |
| `SignalLearning.js` | Flag engagement tracking, noise suppression, score engine |
| `Pacing.js` | Vacation mode, pacing mode, miss-rate checker, capacity mode |
| `Reminders.js` | Anticipator rule engine + Explorer daily discovery bulletin; `hourlyCheck()` |
| `WeekendPlanner.js` | Weekend Decision Memo — Wednesday 8am delivery; `testWeekendMemo()` dry-runs it on demand |
| `PreTripBriefing.js` | 48-hour pre-trip briefing flag generation |
| `Trips.js` | **Trip identity.** The `Trips` registry — an immutable `TRIP-xxxxxxxxxxxx` per trip; `resolveTripId_` matches on calendar event ID, then alias, then label + date proximity, and never guesses between two candidates; `repairOrphanTripKeys_` merges trips that split before it existed |
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
| `TestBench.js` | **The index of manual test entry points.** One `tb*` callout per user-facing feature, grouped into four sections, with knobs at the top because the Run menu cannot pass arguments. Clears the relevant dedup guard before anything that would otherwise silently no-op |
| `appsscript.json` | OAuth scopes: Sheets, Calendar, UrlFetch, Mail, Drive, Tasks, Triggers, External requests |
| `docs/app.js` | **The dashboard source — edit this.** React app in `React.createElement` form (no JSX) |
| `docs/index.html` | Self-contained page GitHub Pages serves: CSS + inlined React bundle + a copy of `app.js`. **Generated — do not hand-edit** |
| `docs/build.js` | Regenerates `index.html` from `app.js`. `--check` verifies they match |
| `docs/.nojekyll` | Tells GitHub Pages to serve all files, including ones starting with `_` |
| `babel.config.json` | **Legacy, unused.** The dashboard no longer uses Babel or JSX |
| `push.ps1` | One-command deploy: builds dashboard → pushes to Apps Script → redeploys web app → commits to GitHub |

---

## Dashboard Development

The dashboard is served by GitHub Pages from `docs/index.html` at
`https://aeraky1565.github.io/VERA-My-Chief-of-Staff/`, and talks to the Apps
Script web app over the `?action=` JSON endpoints in `WebApp.js`.

**There is no JSX and no Babel step.** The app is written directly in
`React.createElement` form. Commit `ada15e2` removed `type="text/babel"` when
the dashboard grew large enough that in-browser Babel timed out and produced a
blank page.

### Architecture

```
docs/app.js          ← THE SOURCE. Edit this for UI changes.
      │
      │  node docs/build.js
      ▼
docs/index.html      ← generated: CSS + inlined React bundle + app.js copied
                       into the final <script> block. Served by GitHub Pages.
                       Self-contained, so the dashboard has no CDN dependency.
```

`index.html` inlines everything rather than loading `app.js` with a `<script
src>`, which is why the two files must be kept in step.

### Making dashboard changes

1. Edit `docs/app.js`.
2. Run `node docs/build.js` (or just run `push.ps1`, which does it as step 0).
3. Commit **both** files. GitHub Pages picks the change up within a few minutes.

> **Never hand-edit `docs/index.html`** — `build.js` overwrites its app block.
> Run `node docs/build.js --check` to verify the two are in sync; it exits
> non-zero if they have drifted.

#### Why the build script exists

The two files used to be synced by hand, which failed silently: commit
`58c4245` updated `app.js` but not `index.html`, so a shipped feature never
reached the live dashboard and nothing caught it. `build.js` makes the sync
mechanical and `--check` makes drift detectable.

### Blank page troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| A change to `app.js` isn't visible on the dashboard | `index.html` wasn't rebuilt | Run `node docs/build.js`, commit both files |
| Not sure whether the two files match | — | `node docs/build.js --check` |
| Blank dark-blue page, no console errors | The app block failed to parse | Open the console; check `index.html`'s last `<script>` block is intact |
| 401 Unauthorized JSON response | `VERA_WEB_TOKEN` in Script Properties doesn't match browser localStorage | Re-enter credentials via the ⚙ icon in the dashboard |
| Dashboard works locally but not on GitHub Pages | GitHub Pages hasn't redeployed yet | Wait 2–5 min, or check the Actions tab for deploy status |

---

## Tests

Two layers, and the distinction matters:

| | `tests/source/` | `tests/regression.spec.js` |
|---|---|---|
| Tests | the committed source | the **deployed** dashboard |
| Needs | a checkout | Pages published, `VERA_URL` + `VERA_TOKEN` |
| Runs on | every push and PR, any branch | push to `main`, after a 90s wait |
| Size | 64 files, 3115 assertions | 185 lines |

```bash
npm ci
npm test              # everything
npm run test:source   # node tests + controls — ~15s, and what gates the deploy
npm run test:ui       # the ones that render in Chromium — ~2min
node tests/run.js --list
```

### No FX Fee, and the International Travel cheat-sheet row

`Credit Cards` carries a **`No FX Fee`** Yes/No column, and the cheat sheet gained an
**International Travel** row listing the cards worth using for miscellaneous purchases
outside the US.

That row is unlike every other row in the panel. The others group **Card Rewards** rows
somebody typed; this one is **derived** from the card's FX flag, because "which card can
I use abroad" is a property of the card, not a reward category.

**Blank means not offered.** The flag is read as a boolean with unset → `false` — the
Card Perks `=== 'yes'` convention, deliberately *not* `Active`'s default-to-`'Yes'`. The
costs are asymmetric: a card wrongly offered costs ~3% of a foreign purchase, a card
wrongly withheld costs a tick in a box. **So the row is absent until cards are marked**,
which is the safe default made visible rather than an empty heading implying "no good
options".

**Ranked on General Spend / Everything Else only.** A miscellaneous purchase abroad is
exactly non-category spend, so a card's 4x dining rate is the wrong number to put beside
it. A fee-free card with no general-spend row still appears — it is still free to use —
listed after the rated ones and rendered as just its name.

Three things that are easy to get wrong here and are pinned by tests:

- **One label helper.** `copyCheatSheet` and the panel each built
  `cardName (rate rateType) | conditions` *independently*, in both dashboards. A
  fee-free card with no rate rendered `"Citi Double Cash (  )"` in every one of them, and
  fixing one would have left the Copy button disagreeing with the panel it copies. There
  is now a single `cheatLabel`.
- **Two representations meeting.** The server returns `noFxFee` as a **boolean** so the
  memo can filter on it directly, and takes `'Yes'`/`'No'` back. Without a conversion in
  the card modal the select had no matching option and saving posted `"true"`, which is
  not `'yes'` — so **editing any card silently turned its own FX flag off.**
- **The category field is free text**, so `International Travel` can also be typed as a
  real reward row. The derived cards merge into that row rather than adding a second one
  with the same key.

> No migration: `ensureCreditCardSchema_` already widens the sheet and rewrites the
> header row whenever it does not match `CREDIT_CARD_HEADERS` — it exists because Credit
> Limit was added the same way. And `webUpdateCard_` addresses columns by **number**, so
> `test_cardfx.js` derives every expected index from the header list in both directions:
> an index that drifts writes the FX flag into Notes, and an absent entry means the edit
> form can never save it at all.

### The card-perk calendar lifecycle

September's perk reminders were still on the shared calendar in October, and nothing
could remove them. Both halves of that are worth writing down, because one of them
wasn't a bug:

| | When |
|---|---|
| flag raised | 0–14 days before the perk's period end |
| **email + calendar event** | **≤ 7 days**, once per perk per period (a `PERK_NOTIFY_*` script property gates it, after they fired up to 15 times each) |
| event deleted on mark-used | `deletePerkReminderEvent_`, and **only while the date is still in the future** |
| event deleted once lapsed | `purgePastPerkReminderEvents_`, nightly in the **tail** |

**So a monthly perk ending 31 Oct gets its calendar event on 24 Oct.** Seeing nothing
for October on the 6th was correct, not a missing run — that half of the report was a
false alarm, and it is written down here so it doesn't get reported twice.

**The deletion half was a real gap.** `deletePerkReminderEvent_` had exactly one caller
— the dashboard's mark-used toggle — and refuses anything in the past on purpose
(*"a past event is history"*). Nothing in the nightly run touched perk events at all, so
a perk never redeemed kept its reminder for ever.

Deleting those loses nothing: the events are **nudges, not records**, and the audit
trail already lives in the Flags sheet, where `closeExpiredPerkFlags_` marks every
lapsed perk `expired` and feeds `recordFlagOutcome_`.

Three things make a destructive sweep over a **shared** calendar safe:

- **Only events whose description carries `VERA-PERK:`.** Not `VERA` — `ImportantDates.js`
  writes `VERA-DATE:<id>:<year>` into birthday and anniversary descriptions, and those
  legitimately stay on the calendar after the day has passed. A loose match would delete
  someone's birthday. The test has a past-birthday fixture precisely so the loose-match
  control has something to bite on.
- **Only events strictly before today.** An all-day event on the 29th spans the 29th to
  the 30th, so a window ending at today 00:00 would catch *today's* reminder through
  `getEvents` overlap semantics — and a perk whose period ends today is still live.
- **Preview before delete.** `tbPerkEventPurgePreview()` lists the dates and perk names
  and removes nothing; `tbPerkEventPurgeRun()` is a separate function.

> **Driven off the calendar marker, not off flag state.** Hooking
> `closeExpiredPerkFlags_` looked tidier and is fragile: it skips flags already
> resolved, so it would get exactly *one* night per period to delete the event and a
> night dropped for time would orphan it for ever. A 40-day window means any missed
> night is caught by the next one.
>
> The nightly sweep lives in the **tail** because the head's three perk steps are
> already #32–34 of 37 and so among the first the budget drops. And
> `deletePerkReminderEvent_`'s past-event guard was **not** relaxed — that would have
> been the lazy way to clear September and would have broken documented behaviour with
> its own tests.

The backlog sweep is in `TestBench.js` rather than the dashboard: the Credit Card Hub is
one minified `React.createElement` line, and wedging buttons into compiled output for a
run-once operation is risk without return. The `preview_perk_event_purge` /
`run_perk_event_purge` endpoint actions exist, so wiring UI later is one step.

### A failing CI run has to say what failed

The suite went red and said nothing else. Working out *which* requests hung was only
possible from the **step timings**:

| Run | `Run regression tests` | |
|---|---|---|
| passing | 15:20:33 → 15:21:19 — **46s** | the healthy baseline |
| failing | 15:07:42 → 15:11:22 — **3m40s** | ~4 requests hanging |

With `retries: 1` and a 20s request timeout, four hung requests retried once is ≈160s
on top of a normal run — which is the arithmetic that identified the failure mode
without ever seeing the log. That is too much work for a red tick, and it was forced,
because **the step log and the uploaded artifact are both served from blob storage**
that an API client cannot follow, and `workflow_dispatch` is not available to every
token. One failure cost a whole push to identify.

Three things close it:

- **The `github` reporter** (`playwright.config.js`, CI only). Its `::error` output
  becomes **check-run annotations**, and `repos/{owner}/{repo}/check-runs/{id}/annotations`
  *does* answer — so a failure now names itself through the one reachable endpoint.
- **The Slack message lists the failing test titles**, read from the `results.json` the
  JSON reporter already writes, via `tests/failing-titles.js`. A real script rather
  than a `node -e` one-liner in the YAML, because the moment it matters is a failing
  run — the worst moment to be debugging the thing that reports failures. It is capped
  at 8 titles (a total outage fails everything; a wall of lines is not a report) and
  the payload is built with `jq`, so a quote in a test title cannot produce malformed
  JSON and lose the message.
- **Every endpoint call is timed and printed on every run**, passing or not, with a
  slowest-first summary and the never-answered actions called out by name. Same reason
  the nightly run reports its slowest steps unconditionally: a request creeping from 1s
  towards its timeout is worth seeing while it is still creeping.

And **one warm-up request** ahead of the API block, with a 45s budget and no assertion.
The suite runs immediately after the deploy re-points the Apps Script deployment, and
the first call to a new version is cold. Its printed duration is the discriminator:
slow warm-up then fast tests means cold start; slow everything means the endpoint
itself is unwell.

> Honest about what that last one is: hardening plus a measurement, not a demonstrated
> fix. The passing run above also followed a deploy.

### When the regression suite times out

`tests/regression.spec.js` calls `action=regression_test` on the live web app, which
runs nine read-only checks serially — including `CalendarApp.getAllCalendars()`, whose
latency is Google's and not ours.

It used to have no time budget at all. When the nine checks overran the spec's 60-second
patience the request simply never returned, and because the response carries the
per-check timings, **a slow check produced a timeout that named nothing**:

```
TimeoutError: apiRequestContext.get: Timeout 60000ms exceeded.
  - → GET ***?action=regression_test&token=***
```

`REGRESSION_BUDGET_MS` (45s, deliberately inside the spec's 60s — **raise them
together or not at all**) now stops it *starting* a new check once the budget is
gone. Those checks come back `status: 'skipped'`, the response is sent, and the spec
prints every check with its timing plus the total against the budget.

An overrun still fails the build — *"I ran out of time"* is not a clean bill of health
— but it now fails naming the last check that completed and how long it took. Checks
are deliberately **not** reordered cheapest-first: that would make the suite look
healthier while hiding the thing worth finding.

> Same lesson as the nightly run above, in a different place: Apps Script work that
> outgrows its time box reports as **silence**, and silence is indistinguishable from
> never having happened. Both now answer before they are cut off.

`tests/run.js` discovers `tests/source/test_*.js`, classifies each by whether it
*requires* `playwright` or `@babel/standalone`, and runs it. Classification is by
require rather than by mention, because several pure-Node tests discuss both in their
comments — `test_globals.js` greps the source for them.

**How these tests work.** They read the repo's own `.js` files, brace-match the real
function out by name, and run *that* function in a `vm` with the Apps Script surface
stubbed. Never a copy: a transcription only proves the transcription works. So
`test_perkflagclose.js` runs the actual `closeExpiredPerkFlags_` from `Code.js`, and
renaming a column header in `FLAG_HEADERS` breaks it.

**Every behaviour has a negative control.** The `ctl_*.js` runners write a mutated copy
of the source to a temp directory, point the test at it with `VERA_ROOT`, and assert
the test *fails*. A test that cannot fail is not a test, and several here have gone
vacuous after a refactor — cache moved behind a helper, a constant changed, a guard
relocated. That is why the controls run in CI beside the tests and not as an
afterthought.

**A test may declare that it is supposed to fail.** `test_triprow_control.js` is the
card layout *without* the wrap fix, so the assertions in `test_triprow.js` can be shown
to bite. It carries

```js
// EXPECT-FAILURES: 6
```

and the runner checks that count **exactly**. Too few is as much a failure as too many:
if the control ever passes clean, the thing it controls for has stopped guarding
anything.

**The deploy waits for `test:source`.** `deploy.yml` gained a `fast` job that runs the
node tests and the controls, and `deploy` needs it. Before that, the only thing between
a push and the live Apps Script project was `node --check` — syntax — so a commit that
broke the perk period keys deployed to the running assistant and was found out
afterwards. The browser tests deliberately do **not** gate it: they cannot tell you
anything about the `.js` files being pushed, and `workflow_dispatch` still forces a
deploy by hand when a test is wrong and something urgent is broken.

> Commit messages before this section existed refer to `scratchpad/test_*.js`. That is
> the same file, at `tests/source/test_*.js`; the suite lived in a temp directory until
> it was brought into the repo.

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
| `ADDRESS_BOOK_SHEET_ID` | Shared address book Sheet ID (if using the Address Book) |
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

Run `push.ps1` — it handles everything automatically:

1. Builds the dashboard — `docs/app.js` → `docs/index.html` (`node docs/build.js`)
2. Pushes all `.js` / `.html` files to Apps Script via `clasp push`
3. Creates a new Apps Script deployment version (`clasp deploy`) so the Web App picks up changes immediately
4. Commits and pushes to GitHub (GitHub Pages redeploys within 2–5 minutes)

The Web App URL never changes. Chat history is preserved in Script Properties across redeploys.
