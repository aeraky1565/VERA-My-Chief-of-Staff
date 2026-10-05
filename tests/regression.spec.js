// VERA Regression Test Suite
// Tests the live dashboard at GitHub Pages and the Apps Script API.
// Tiered: Tier 1 needs no credentials, Tier 2/3 require VERA_URL + VERA_TOKEN env vars.

const { test, expect, request: apiRequest } = require('@playwright/test');

const BASE_URL = 'https://aeraky1565.github.io/VERA-My-Chief-of-Staff/';
const VERA_URL = process.env.VERA_URL || '';
const VERA_TOKEN = process.env.VERA_TOKEN || '';
const HAS_CREDS = !!VERA_URL && !!VERA_TOKEN;

const TAB_LABELS = [
  'home', 'chat', 'flags', 'tasks', 'projects', 'shopping',
  'Home Front', 'people', 'pto', 'travel', 'finances', 'health',
  'career', 'growth', 'explore'
];

// ─── Tier 1: Basic health (no credentials) ──────────────────────────────────

test.describe('Tier 1 — Basic health (no credentials)', () => {
  test('page loads and root mounts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });

    // Our custom window.onerror handler writes this on JS crash
    const crashBanner = page.locator('text=⚠ JavaScript Error');
    await expect(crashBanner).not.toBeVisible({ timeout: 5000 });

    // Root should have content beyond the initial "Starting VERA…" placeholder
    const root = page.locator('#root');
    await expect(root).not.toBeEmpty();

    // No page-level JS errors
    expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });

  test('settings modal appears when not configured', async ({ page }) => {
    // Fresh page with empty localStorage → settings modal must appear.
    // React 18 createRoot renders concurrently, so wait for #root to be
    // non-empty before asserting the modal, not just networkidle.
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15000 });
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Tier 2: Authenticated UI ────────────────────────────────────────────────

test.describe('Tier 2 — Authenticated UI', () => {
  test.beforeEach(async ({ page }) => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set — skipping authenticated tests');
    }
    // Inject credentials into localStorage before React initialises
    await page.addInitScript(({ url, token }) => {
      localStorage.setItem('vera_url', url);
      localStorage.setItem('vera_token', token);
    }, { url: VERA_URL, token: VERA_TOKEN });
  });

  test('home tab loads and shows last-updated timestamp', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('button.tab-btn', { timeout: 20000 });
    // The header shows "Updated X ago" once data loads
    await expect(page.getByText(/Updated/)).toBeVisible({ timeout: 35000 });
  });

  for (const tab of TAB_LABELS) {
    test(`tab "${tab}" navigates without error`, async ({ page }) => {
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
      // Wait for the tab bar to appear (React mounted + API responded)
      await page.waitForSelector('button.tab-btn', { timeout: 30000 });
      await page.click(`button.tab-btn:has-text("${tab}")`);
      // Give the tab up to 10s; confirm no generic error banner appears
      await expect(page.locator('text=Error loading')).not.toBeVisible({ timeout: 10000 });
    });
  }

  test('settings modal opens via gear icon', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('button.btn-settings', { timeout: 30000 });
    // Click the ⚙ button (last .btn-settings — the 🔔 is first)
    const settingsBtns = page.locator('button.btn-settings');
    await settingsBtns.last().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
  });

  test('notification/config modal opens via bell icon', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('button.btn-settings', { timeout: 30000 });
    // Click the 🔔 button (first .btn-settings)
    const settingsBtns = page.locator('button.btn-settings');
    await settingsBtns.first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });
    // Modal should not show a hard error — loading state is OK
    await expect(page.locator('text=Error loading')).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── Tier 3: Apps Script API health ─────────────────────────────────────────

test.describe('Tier 3 — Apps Script API', () => {
  let ctx;

  test.beforeAll(async ({ playwright }) => {
    if (!HAS_CREDS) return;
    ctx = await playwright.request.newContext();
  });

  test.afterAll(async () => {
    if (ctx) await ctx.dispose();
  });

  test('status endpoint returns ok', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(`${VERA_URL}?action=status&token=${VERA_TOKEN}`, {
      timeout: 20000,
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  test('get_notification_map returns ok', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(
      `${VERA_URL}?action=get_notification_map&token=${VERA_TOKEN}`,
      { timeout: 20000 }
    );
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  test('get_config_rows returns ok', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(
      `${VERA_URL}?action=get_config_rows&token=${VERA_TOKEN}`,
      { timeout: 20000 }
    );
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  // READ-ONLY, deliberately: this reaches the real shared address book, so it counts
  // rows and never writes one. The counts are the point — the sheet id lives outside
  // the repo (Script Property, or an address_book_sheet_id row in the Config tab once
  // the properties editor goes read-only past 50), so this is the only place that can
  // see whether it is actually set. Counts only: names, emails and postal addresses
  // do not belong in a CI log.
  test('address_book is configured and readable', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(
      `${VERA_URL}?action=address_book&token=${VERA_TOKEN}`,
      { timeout: 30000 }
    );
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    // A wrong id, or one that was never shared with the account VERA runs as,
    // answers ok:false and carries the reason. That reason is worth reading out.
    expect(data.ok, `address_book failed: ${data.error || '(no reason given)'}`).toBe(true);
    expect(
      data.configured,
      'the address book is not configured — set the ADDRESS_BOOK_SHEET_ID script ' +
      'property, or add an address_book_sheet_id row to the Config tab'
    ).toBe(true);
    ['households', 'people', 'mailings', 'events'].forEach(k => {
      expect(Array.isArray(data[k]),
        `${k} is missing from the response — is the live deployment stale?`).toBe(true);
    });
    console.log(`  📒 address book: ${data.households.length} households, ` +
                `${data.people.length} people, ${data.mailings.length} mailings, ` +
                `${data.events.length} event(s)`);

    // EVERY ROW ID MUST BE UNIQUE, and this is the only place that can see the real
    // sheet. The generator was Date.now() plus three random digits, which in the
    // import's loop is a thousand possible ids per millisecond — 68 households
    // collided 88.7% of the time. Two households sharing an id show each other's
    // people, match each other in a search, and delete each other's members.
    const dupes = rows => {
      const seen = {}, bad = {};
      rows.forEach(r => { if (seen[r.id]) bad[r.id] = true; seen[r.id] = true; });
      return Object.keys(bad);
    };
    const dupHh = dupes(data.households), dupP = dupes(data.people), dupM = dupes(data.mailings);
    if (dupHh.length || dupP.length || dupM.length) {
      console.error(`  ⚠ duplicate ids — households ${dupHh.length}, ` +
                    `people ${dupP.length}, mailings ${dupM.length}`);
    }
    expect(dupHh, 'households share an id: run 🔧 Repair in the Bulk import panel').toEqual([]);
    expect(dupP,  'people share an id: run 🔧 Repair in the Bulk import panel').toEqual([]);
    expect(dupM,  'mailings share an id: run 🔧 Repair in the Bulk import panel').toEqual([]);
  });

  test('regression_test endpoint returns pass results', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(
      `${VERA_URL}?action=regression_test&token=${VERA_TOKEN}`,
      { timeout: 60000 }
    );
    // If the endpoint doesn't exist yet (not deployed via clasp), skip gracefully
    if (resp.status() === 400 || resp.status() === 404) {
      test.skip(true, 'regression_test action not yet deployed to Apps Script');
    }
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty('ok');
    expect(data).toHaveProperty('passed');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);

    // Print every check with its timing, not just the failures. The timings ARE
    // the diagnosis — this endpoint's real failure mode is running out of time,
    // and knowing which check ate it is the whole question.
    if (data.results) {
      data.results.forEach(r => {
        if (r.status === 'fail') {
          console.error(`  ❌ ${r.name} (${r.ms}ms): ${r.error}`);
        } else if (r.status === 'skipped') {
          console.error(`  ⏭  ${r.name}: never ran — ${r.error}`);
        } else {
          console.log(`  ✅ ${r.name} (${r.ms}ms)`);
        }
      });
      console.log(`  total ${data.total_ms}ms of ${data.budget_ms}ms budget`);
    }
    // A budget overrun is a failure, and now a legible one: the log above names
    // the last check that ran and how long it took. Before this, the endpoint
    // simply never answered and the spec died on a timeout that named nothing.
    if (data.skipped) {
      const lastRan = data.results.filter(r => r.status !== 'skipped').pop();
      throw new Error(
        `regression_test ran out of its ${data.budget_ms}ms budget after ` +
        `${data.results.length - data.skipped} of ${data.results.length} checks` +
        (lastRan ? ` — slowest completed: ${lastRan.name} (${lastRan.ms}ms)` : '')
      );
    }
    expect(data.ok).toBe(true);
  });
});
