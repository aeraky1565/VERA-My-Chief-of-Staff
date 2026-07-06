const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    headless: true,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    // Use pre-installed browser in Claude Code remote env; CI installs its own
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? {}
      : { launchOptions: { executablePath: '/opt/pw-browsers/chromium' } }),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
