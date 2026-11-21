# ARIA: changes from VERA (add to ARIA's task prompt)

VERA can now change a trip ARIA is already watching: its ceiling, airports, travelers, flex days, or
airlines. Tap **✎ Change** on the trip's card in VERA. This is already in ARIA's scheduled task ("ARIA daily travel check") since 2026-11-21; the block below is kept
here as the reference, and for setting ARIA up again.

---

**Changes from VERA.** In VERA's "ARIA Requests" tab, a watch request (**Kind = watch**) can carry a
**Changes** cell, for example `2026-11-21: Ceiling Per Person blank→300; Flex Days 1→2`. It starts
with the date VERA sent the change. When that date is later than the last change you applied to
the trip's Watchlist row (match on **Trip ID**):

1. Copy each field named in Changes from the request to the Watchlist row, **overwriting** what's
   there, even a value typed in by hand. The request's columns hold the new values: Origin
   Airports, Destination Airports, Return-From Airports, Earliest Depart, Latest Return, Travelers,
   Ceiling Per Person (into Price Ceiling Per Person), Flex Days, Airline Preference, Airline Premium PP.
2. Add a line to the row's **Notes**: "Changed from VERA DATE: …" with the Changes text, so the
   next run knows the change has been applied.
3. Judge the trip again against the new values on this run: a new ceiling can mean UNDER_CEILING or
   BOOK_NOW now, and a ceiling that was missing clears CEILING_NOT_SET.

Fields not named in Changes keep the rule you already follow: fill them only while they're blank.

---

How it fits together:
- **VERA writes** only to its own ARIA Requests tab. A change keeps the same Request ID, and the
  card says "Changes sent DATE: … ARIA applies them on its next 06:52 run".
