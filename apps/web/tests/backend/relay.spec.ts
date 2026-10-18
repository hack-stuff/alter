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
  await page.getByRole('button', { name: 'Continue' }).click()
  // This connected build starts voice automatically. Clicking the temporary
  // start control races its transition to the active session.
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => audio, { timeout: 20_000 }).toBeGreaterThan(0)
  send!(JSON.stringify({ toolCall: { functionCalls: [{ id: 'relay-call', name: 'alter_chat', args: { message: 'Why did we switch to one-tap?' } }] } }))
  await expect(page.getByRole('log').getByText('one-tap', { exact: false }).first()).toBeVisible()
  await expect.poll(() => tools, { timeout: 20_000 }).toBe(1)
  await page.getByRole('button', { name: 'End voice' }).click()
  await page.getByRole('button', { name: 'Resume voice' }).click()
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 15_000 })
  expect(mintCount).toBe(2)
  await page.getByRole('button', { name: 'End voice' }).click()
})

test('a temporary provider drop reconnects once and then shows the reference', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.7' : '127.0.0.6' })
  let mintCount = 0
  const sockets: ((data: string) => void)[] = []
  await page.route('**/v1/live/sessions', (route) => {
    mintCount++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: `retry-ticket-${mintCount}`, socketPath: '/v1/live/connect' }) })
  })
  await page.routeWebSocket('**/v1/live/connect', (socket) => {
    sockets.push((data) => socket.send(data))
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).ticket) socket.send(JSON.stringify({ ready: true }))
    })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Relay retry')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 20_000 })
  const failure = JSON.stringify({ error: 'Vertex Live is temporarily unavailable. Retry or use text. Reference: retry1011', reference: 'retry1011', retryable: true })
  sockets[0](failure)
  await expect.poll(() => mintCount, { timeout: 15_000 }).toBe(2)
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 15_000 })
  expect(await page.getByText('Reference: retry1011').count()).toBe(0)
  sockets[1](failure)
  await expect(page.getByRole('alert')).toContainText('Reference: retry1011')
  expect(mintCount).toBe(2)
})

test('repeated model tool calls cannot flood chat', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.9' : '127.0.0.8' })
  let chatCalls = 0
  let responses = 0
  let send: ((data: string) => void) | undefined
  await page.route('**/v1/live/sessions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: 'repeat-ticket', socketPath: '/v1/live/connect' }) }))
  await page.route('**/v1/chat', (route) => {
    chatCalls++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversationId: 'conv_repeat', reply: { from: 'alter', text: 'Done.', citations: [], approvalIds: [], traceIds: [], ts: new Date().toISOString() } }) })
  })
  await page.routeWebSocket('**/v1/live/connect', (socket) => {
    send = (data) => socket.send(data)
    socket.onMessage((raw) => {
      const packet = JSON.parse(String(raw))
      if (packet.ticket) socket.send(JSON.stringify({ ready: true }))
      if (packet.functionResponses) responses++
    })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Relay guard')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 20_000 })
  for (const id of ['first', 'second']) {
    send!(JSON.stringify({ toolCall: { functionCalls: [{ id, name: 'alter_chat', args: { message: 'Add that Kani\'s mock-ups are due Friday.' } }] } }))
    await expect.poll(() => responses).toBe(id === 'first' ? 1 : 2)
  }
  expect(chatCalls).toBe(1)
  send!(JSON.stringify({ toolCall: { functionCalls: [{ id: 'third', name: 'alter_chat', args: { message: 'Add that Kani\'s mock-ups are due Friday.' } }] } }))
  await expect(page.getByRole('alert')).toContainText('Voice repeated the same request')
  expect(chatCalls).toBe(1)
})

test('a chat rate limit ends voice instead of asking the model to retry', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.11' : '127.0.0.10' })
  let chatCalls = 0
  let toolResponses = 0
  let send: ((data: string) => void) | undefined
  await page.route('**/v1/live/sessions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: 'limited-ticket', socketPath: '/v1/live/connect' }) }))
  await page.route('**/v1/chat', (route) => {
    chatCalls++
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: { error: { code: 'RATE_LIMITED', message: 'This workspace is busy. Please try again later.' } } }) })
  })
  await page.routeWebSocket('**/v1/live/connect', (socket) => {
    send = (data) => socket.send(data)
    socket.onMessage((raw) => {
      const packet = JSON.parse(String(raw))
      if (packet.ticket) socket.send(JSON.stringify({ ready: true }))
      if (packet.functionResponses) toolResponses++
    })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Relay limit')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: 20_000 })
  send!(JSON.stringify({ toolCall: { functionCalls: [{ id: 'limited', name: 'alter_chat', args: { message: 'What is next?' } }] } }))
  await expect(page.getByRole('alert')).toContainText('This workspace is busy')
  await expect(page.getByRole('button', { name: 'Talk to your Alter' })).toBeVisible()
  expect(chatCalls).toBe(1)
  expect(toolResponses).toBe(0)
})
