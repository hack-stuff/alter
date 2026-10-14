import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  use: {
    ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
  },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4174 --strictPort', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
})
