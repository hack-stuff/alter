import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'

// Keep the pinned Linux browser when present (managed build images), otherwise
// let Playwright resolve its own installed Chromium (macOS/local machines).
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)

test.use({ launchOptions: { executablePath: chromium, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test('Vertex relay client routes tools to the real local API and reconnects after stopping', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.5' : '127.0.0.4' })
  let mintCount = 0
  let audio = 0
  let tools = 0
  let send: ((data: string) => void) | undefined
  await page.route('**/v1/live/sessions', (route) => { mintCount++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: 'test-one-use-ticket', socketPath: '/v1/live/connect', expiresAt: new Date(Date.now() + 600000).toISOString() }) }) })
  await page.routeWebSocket('**/v1/live/connect', (socket) => {
    send = (data) => socket.send(data)
    socket.onMessage((raw) => {
      const packet = JSON.parse(String(raw))
      if (packet.ticket) socket.send(JSON.stringify({ ready: true }))
      if (packet.audio) audio++
      if (packet.functionResponses) { tools++; socket.send(JSON.stringify({ serverContent: { turnComplete: true } })) }
    })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Relay demo')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  // This connected build starts voice automatically. Clicking the temporary
  // start control races its transition to the active session.
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => audio, { timeout: 20_000 }).toBeGreaterThan(0)
  send!(JSON.stringify({ toolCall: { functionCalls: [{ id: 'relay-call', name: 'alter_chat', args: { message: 'Why did we switch to one-tap?' } }] } }))
  await expect(page.getByRole('log').getByText('one-tap', { exact: false }).first()).toBeVisible()
  await expect.poll(() => tools, { timeout: 20_000 }).toBe(1)
  await page.getByRole('button', { name: 'End voice' }).click()
  await page.getByRole('button', { name: 'Resume voice' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  expect(mintCount).toBe(2)
  await page.getByRole('button', { name: 'End voice' }).click()
})
