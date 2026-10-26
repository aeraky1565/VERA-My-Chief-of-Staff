# Trip Ideas hand-offs

VERA never calls another bot or AI chat. In **Travel → Trip Ideas** the dashboard
copies text out, and their answers come back by paste. These are the formats, so
a chat, WILLA or ARIA can be pointed at them.

Every amount is in US dollars, for all travelers together.

## VERA option v1 (AI chats, both ways)

**📋 Copy for an AI chat** on an idea copies the brief, your pieces and the
options you have so far. It ends by asking the chat to answer in this format,
with one block per option:

```
=== VERA option v1 ===
Name: 14 nights: Lisbon → Porto by train
Route:
- FLY Home → LIS
- STAY Lisbon · 5 nights
- TRAIN Lisbon → Porto · 3h
- STAY Porto · 4 nights
- FLY OPO → Home
Cost (USD, all travelers):
- Flights: 1400–1900 · your estimate
- Stays: 2500–3500
For:
- Two cities, one easy train
Against:
- No beach time
=== end ===
```

**Route lines**

- Route lines go in travel order, from home and back home.
- A stop is written `STAY <place> · <n> nights`, with an optional `· <note>`.
- A move is written `<MODE> <from> → <to>`, with an optional `· <note>`.
- MODE is one of `FLY`, `TRAIN`, `DRIVE`, `CRUISE`, `FERRY`, `BUS` or `MOVE`.
- `->` works in place of `→`, and `?` stands for an end that isn't known yet.

**Cost lines**

- A cost line is written `<category>: <low>–<high>`. A single figure also works.
- An optional `· <basis>` says where the figure came from. Without one, the basis is "their estimate".
- The categories are Flights, Stays, Cruise, Getting around and Daily spend.
- Leave out a category that doesn't apply.

**For and Against** are optional. Each line is one short point.

To bring options back, use **📥 Paste options** and paste the chat's whole answer:

- Blocks in this format are read exactly.
- An answer in the chat's own words is read by VERA's AI instead, and the preview says so.
- Markdown such as bold text or `*` bullets is fine.
- Nothing is saved until you press Save.

## WILLA

**↗ Hand off → Copy for WILLA** on an option copies one line, for example:

```
VERA → WILLA · Trip idea "Spring in Europe": Lisbon → Algarve → cruise · 13 nights · Mar – May 2027 · estimated $5.4k – $7.8k total (flights $1.4k – $1.8k, cruise $4k – $6k) · budget $9k (within). Can we afford it, and what should the budget be?
```

To bring WILLA's answer back, use **💰 Budget from WILLA** on the idea and paste
the answer.

- VERA takes the figure after the word "budget" (`Budget: $9,500`, `budget of $9.5k`).
- If there is no such figure, it takes the first dollar amount.
- You see the figure, and what it replaces, before using it.

## ARIA

ARIA usually needs no copy and paste. On a starred option of a shortlisted idea,
**🧭 Scout** writes a request to VERA's "ARIA Requests" tab. ARIA reads it on its
morning run, logs fares under the option, and VERA shows them on the option and
in the date windows. Ask VERA also uses them for that route's flights.

The manual hand-off below is a fallback for a one-off check in an ARIA chat.
Both buttons are hidden while ARIA is scouting the option itself.

**↗ Hand off → Copy for ARIA (manual)** appears on any option with flights. It
copies:

```
=== VERA fare request v1 ===
Trip: Spring in Europe · Lisbon → Algarve → cruise
Travelers: 2 adults
When: Mar – May 2027 · 13 nights
Flights:
- Home → LIS
- BCN → Home
Reply with one line:
Fare: $<total for all travelers, all these flights> · checked <yyyy-mm-dd>
=== end ===
```

ARIA answers with one line:

```
Fare: $1,840 · checked 2026-10-24
```

A range also works, for example `Fare: $1,700–$2,100`. If there is no "Fare" line,
VERA takes the first dollar amount.

To bring the fare back, use **Paste ARIA's fare**. It replaces the option's
flights estimate, and the basis records ARIA and the date the fare was checked:
`ARIA · checked 2026-10-24`. When the date is missing, the basis uses the day the
fare was pasted.
