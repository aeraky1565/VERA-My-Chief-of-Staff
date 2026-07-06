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
  'home_front', 'people', 'pto', 'travel', 'finances', 'health',
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
    // Fresh page with empty localStorage → settings modal must appear
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await expect(page.getByText('Web App URL')).toBeVisible({ timeout: 12000 });
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    // The header shows "Updated X ago" once data loads
    await expect(page.getByText(/Updated/)).toBeVisible({ timeout: 35000 });
  });

  for (const tab of TAB_LABELS) {
    test(`tab "${tab}" navigates without error`, async ({ page }) => {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
      // Wait for the tab bar to appear
      await page.waitForSelector('button.tab-btn', { timeout: 20000 });
      await page.click(`button.tab-btn:has-text("${tab}")`);
      // Give the tab up to 10s; confirm no generic error banner appears
      await expect(page.locator('text=Error loading')).not.toBeVisible({ timeout: 10000 });
    });
  }

  test('settings modal opens via gear icon', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('button.btn-settings', { timeout: 20000 });
    // Click the ⚙ button (last .btn-settings — the 🔔 is first)
    const settingsBtns = page.locator('button.btn-settings');
    await settingsBtns.last().click();
    await expect(page.getByText('Web App URL')).toBeVisible({ timeout: 5000 });
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

  test('regression_test endpoint returns pass results', async () => {
    if (!HAS_CREDS) {
      test.skip(true, 'VERA_URL / VERA_TOKEN not set');
    }
    const resp = await ctx.get(
      `${VERA_URL}?action=regression_test&token=${VERA_TOKEN}`,
      { timeout: 60000 }
    );
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data).toHaveProperty('ok');
    expect(data).toHaveProperty('passed');
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);

    // Print per-check results for easy debugging
    if (data.results) {
      data.results.forEach(r => {
        if (r.status === 'fail') {
          console.error(`  ❌ ${r.name}: ${r.error}`);
        } else {
          console.log(`  ✅ ${r.name} (${r.ms}ms)`);
        }
      });
    }
    expect(data.ok).toBe(true);
  });
});
