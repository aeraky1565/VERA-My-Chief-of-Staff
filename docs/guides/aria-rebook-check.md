# ARIA: the rebook check (add to ARIA's task prompt)

VERA (#250) now records what you paid for a booked trip, so ARIA can tell you when the fare drops.
Paste the block below into ARIA's scheduled task prompt, after the part about the **ARIA Requests**
tab. Nothing else in ARIA changes.

---

**Rebook check for booked trips.** In VERA's "ARIA Requests" tab, a row with **Kind = watch**,
**Status = Booked**, a **Paid Per Person** amount and a **Reprice Until** date that is today or later
is a trip that's already booked. VERA wants to know if it gets cheaper. For each one, once a day:

1. Price the same trip: the same origin and destination airports, the same depart and return dates,
   the same number of travelers, bags and stop limit as its Watchlist row. Use the same sources you
   use for watching.
2. Log the cheapest fare you find to the **Fare Log**, as you do for watched trips, with
   **Role = `rebook`**. Fill in True Total (per person, with fees) and the Booking Link.
3. Don't change the trip's **Watch Status** (it stays Booked), don't set **Action Needed**, and don't
   email about it. VERA compares the fare with Paid Per Person and posts to #vera-act-now when it's
   lower by enough (Config `aria_rebook_min_saving`, $50 a person by default).
4. Stop after the Reprice Until date, or as soon as the row's Status is no longer Booked.

---

How it fits together:
- **VERA writes:**
  - Paid Per Person: the trip's Flights **Actual** in VERA's Trip Budget ÷ travelers, in whole dollars;
  - Reprice Until: the depart date.

  Both go in VERA's own tab, and VERA never writes ARIA's sheet.
- **ARIA writes:** a Fare Log row with Role `rebook`, in its own sheet.
- **VERA reads that row** and, if it's lower than what was paid by at least the minimum, posts
  "Price drop after booking" to #vera-act-now. It posts once per new low, with an Open link. It
  reads only rows from today or yesterday, and never after the depart date.
- **If the Flights Actual is blank or 0,** VERA writes nothing, so ARIA has nothing to check.
