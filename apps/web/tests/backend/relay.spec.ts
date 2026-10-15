import { expect, test } from '@playwright/test'

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

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
  await page.getByRole('button', { name: 'Talk to your Alter' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await expect.poll(() => audio).toBeGreaterThan(0)
  send!(JSON.stringify({ toolCall: { functionCalls: [{ id: 'relay-call', name: 'alter_chat', args: { message: 'Why did we switch to one-tap?' } }] } }))
  await expect(page.getByRole('log').getByText('one-tap', { exact: false }).first()).toBeVisible()
  await expect.poll(() => tools).toBe(1)
  await page.getByRole('button', { name: 'End voice' }).click()
  await page.getByRole('button', { name: 'Talk to your Alter' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  expect(mintCount).toBe(2)
  await page.getByRole('button', { name: 'End voice' }).click()
})
