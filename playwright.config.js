const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  retries: 1,
  // A FAILING RUN HAS TO SAY WHAT FAILED, FROM OUTSIDE THE RUNNER.
  //
  // A regression failure used to be a red tick and nothing else. The step log and the
  // uploaded artifact are both served from blob storage, which the API client used to
  // investigate refuses to follow, and workflow_dispatch is not available to it — so
  // "which four requests hung?" cost a whole push to answer.
  //
  // The github reporter emits ::error workflow commands, which GitHub turns into
  // CHECK-RUN ANNOTATIONS. Those come back from
  // repos/{owner}/{repo}/check-runs/{id}/annotations — the one Actions endpoint that
  // does answer. So the next failure names itself without a round trip.
  //
  // CI only: it would be noise locally, where the list reporter is already on screen.
  reporter: process.env.CI || process.env.GITHUB_ACTIONS
    ? [
        ['list'],
        ['github'],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : [
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
