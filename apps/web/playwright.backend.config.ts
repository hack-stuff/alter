import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep the pinned Linux browser when present (managed build images), otherwise
// let Playwright resolve its own installed Chromium (macOS/local machines).
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)

export default defineConfig({
  testDir:'./tests/backend',outputDir:'test-results/backend',workers:1,timeout:60_000,
  use:{baseURL:'http://127.0.0.1:5177',trace:'retain-on-failure',launchOptions:{executablePath:chromium}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}}],
  webServer:[
    {command:'../../services/api/.venv/bin/uvicorn app.main:app --app-dir ../../services/api --host 127.0.0.1 --port 8082',url:'http://127.0.0.1:8082/healthz',env:{DEV_MODE:'1',DATABASE_PATH:join(tmpdir(),`alter-e2e-${Date.now()}.sqlite`),SERVICE_URL:'http://127.0.0.1:8082',PUBLIC_ORIGIN:'http://127.0.0.1:5177',CORS_ORIGINS:'http://127.0.0.1:5177',WELCOME_DELAY_SECONDS:'2',TRACE_DELAY_SECONDS:'0.01',TRUST_FORWARDED_IP:'1'},reuseExistingServer:false},
    {command:'npm run dev -- --host 127.0.0.1 --port 5177 --strictPort',url:'http://127.0.0.1:5177',env:{VITE_MOCK:'0',VITE_DEV_AUTH:'1',VITE_API_BASE:'http://127.0.0.1:8082/v1'},reuseExistingServer:false},
  ],
})
