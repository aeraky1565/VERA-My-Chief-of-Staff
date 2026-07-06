---
description: Run the VERA regression test suite. Tests the live dashboard (Playwright) and Apps Script API health. Reports pass/fail to terminal and Slack.
---

# VERA Regression Tests

Run a full regression check after any dashboard or Apps Script change.

## Steps

1. Run `bash scripts/run-regression.sh` and capture all output.

2. Parse the results:
   - Read `test-results/results.json` if it exists for structured data
   - Fall back to parsing the shell output

3. Print a clear terminal summary:
   ```
   ✅ Tier 1 — Basic health: 2/2 passed
   ✅ Tier 2 — Authenticated UI: 17/17 passed
   ✅ Tier 3 — Apps Script API: 2/2 passed
   ```
   For failures, show the test name and error message.

4. Post a Slack summary using `mcp__Slack__slack_send_message`:
   - Channel: find the user's primary VERA/ops channel (search for "#vera" or "#general")
   - If all pass: `"✅ VERA Regression: All tests passed (Tier 1+2+3)"`
   - If any fail: `"❌ VERA Regression: N tests failed\n• test_name: error message"`
   - Include the timestamp and total duration

5. For any failing tests, investigate:
   - Tier 1 failures → likely a bad deploy or syntax error in `docs/index.html`
   - Tier 2 tab failures → a specific component threw; check `docs/app.js` for that tab
   - Tier 3 API failures → read the `error` field from the JSON, map to the GAS function

## Environment variables

- `VERA_URL` — Apps Script web app URL (required for Tier 2/3)
- `VERA_TOKEN` — VERA_WEB_TOKEN from Script Properties (required for Tier 2/3)

If not set, only Tier 1 (basic health) runs. To set them for the session:
```
export VERA_URL="https://script.google.com/macros/s/.../exec"
export VERA_TOKEN="your-token-here"
```

Or create `.env.local` (gitignored) and source it: `source .env.local`.
