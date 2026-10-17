import { expect, test, type Page } from '@playwright/test'
import { showMoreRequests } from './nav'

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

// A synthetic Gemini Live connection: the test plays the model's side.
async function withLiveHarness(page: Page) {
  await page.route('**/src/firebase-auth.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: "export async function firebaseIdToken(){return 'test-firebase-token'}" }))
  await page.route('**/v1/live/token', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fake-ephemeral-token', model: 'test-live-model', expiresAt: new Date(Date.now() + 600_000).toISOString() }) }))
  await page.route('**/node_modules/.vite/deps/@google_genai.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export class GoogleGenAI {
      constructor() { this.live = { connect: async (options) => {
        window.liveHarness = { callbacks: options.callbacks, responses: [] };
        return { sendRealtimeInput() {}, sendToolResponse(input) { window.liveHarness.responses.push(input); }, sendClientContent() {}, close() {} };
      } }; }
    }` }))
}

async function join(page: Page) {
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: btoa('\0'.repeat(4800)), mimeType: 'audio/pcm;rate=24000' } }] } } }))
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
}

test('the fast-path parser only fires on clear navigation requests', async ({ page }) => {
  await page.goto('/')
  const parsed = await page.evaluate(async () => {
    const path = '/src/agent/navigation.ts'
    const { parseNavigation } = await import(path)
    const cases = ['Open approvals', 'Show me the calendar proposal', 'Take me to team decisions', 'go to the work log', 'Alter, please open my rules', 'open card two',
      'show the retry node on the canvas', 'show me the canvas retry node', "what's on the canvas?", "don't open the canvas", 'Add a retry state to the diagram', 'Open files']
    return cases.map((text) => { const value = parseNavigation(text); return value ? [value.action.screen, value.action.targetElementId ?? '', value.confidence] : null })
  })
  expect(parsed).toEqual([
    ['approvals', '', 'high'],
    ['approvals', 'kind:calendar_event', 'high'],
    ['decisions', '', 'high'],
    ['work-log', '', 'high'],
    ['rules', '', 'high'],
    ['canvas', '', 'high'],
    ['canvas', 'label:retry', 'high'],
    ['canvas', 'label:retry', 'high'],
    ['canvas', '', 'low'],
    null,
    null,
    ['files', '', 'high'],
  ])
})

test('starting a Meet is distinct from opening its review', async ({ page }) => {
  await page.goto('/')
  const decisions = await page.evaluate(async () => {
    const { startMeetingIntent } = await import('/src/agent/navigation.ts')
    return ['Start the meeting', 'Please create a Google Meet', 'Begin our team sync', 'Open the meeting review', "Don't start the meeting"].map(startMeetingIntent)
  })
  expect(decisions).toEqual([true, true, true, false, false])
})

test('a spoken start command creates a Meet link and opens it without a click', async ({ page }) => {
  await page.route('**/v1/day/meet', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ meetUrl: 'https://meet.google.com/abc-defg-hij' }) }))
  await page.route('https://meet.google.com/abc-defg-hij', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Google Meet test call</h1>' }))
  await withLiveHarness(page)
  await join(page)
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Start the meeting' }, turnComplete: true } }))
  await expect(page).toHaveURL('https://meet.google.com/abc-defg-hij')
  await expect(page.getByRole('heading', { name: 'Google Meet test call' })).toBeVisible()
})

test('a spoken "open" moves the screen from the streaming transcript, before any tool call', async ({ page }) => {
  await withLiveHarness(page)
  await join(page)
  const timing = await page.evaluate(async () => {
    const path = '/src/agent/navigator.ts'
    const { alterNav } = await import(path)
    const events: string[] = []
    alterNav.subscribe((event: { screen: string; source: string }) => events.push(`${event.screen}:${event.source}`))
    const screen = document.querySelector('[data-screen="approvals"]')!
    const start = performance.now()
    let shown = 0
    const visible = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => { if (!screen.hasAttribute('hidden')) { shown = performance.now(); observer.disconnect(); resolve() } })
      observer.observe(screen, { attributes: true, attributeFilter: ['hidden'] })
    })
    // Only a partial transcript: no turnComplete and no tool call yet.
    ;(window as any).liveHarness.callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Open approvals' } } })
    await visible
    return { ms: shown - start, events }
  })
  expect(timing.events).toEqual(['approvals:voice-fast'])
  expect(timing.ms).toBeLessThan(100)
  await expect(page.getByRole('heading', { name: 'Waiting on you', level: 1 })).toBeVisible()
  await expect(page.getByText('Opened Approvals')).toBeVisible()
  // The model's tool call for the same request arrives later and is not repeated.
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'nav-1', name: 'alter_chat', args: { message: 'Open approvals' } }] } }))
  await expect.poll(() => page.evaluate(() => (window as any).liveHarness.responses.length)).toBe(1)
  const response = await page.evaluate(() => (window as any).liveHarness.responses[0].functionResponses[0].response.result)
  expect(response).toMatchObject({ navigation: 'approvals', alreadyOpen: true })
})

test('navigate_to highlights a proposal, and a spoken decision reaches the owner\'s Alter', async ({ page }) => {
  await withLiveHarness(page)
  await join(page)
  await showMoreRequests(page)
  await page.getByRole('button', { name: 'Add a QA update to the status doc' }).click()
  await expect(page.getByRole('button', { name: 'Review proposal' })).toBeVisible()
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'nav-2', name: 'navigate_to', args: { screen: 'approvals', target: 'kind:doc_edit' } }] } }))
  const card = page.locator('[data-screen="approvals"]').getByRole('article', { name: 'Status doc · QA section' })
  await expect(card).toHaveClass(/nav-highlight/)
  await expect(card).toBeFocused()
  await expect(page.getByText('Opened Approvals · doc edit')).toBeVisible()
  const result = await page.evaluate(async () => {
    const path = '/src/live/tools.ts'
    const { dispatchLiveTool } = await import(path)
    const rejects: string[] = []
    for (const name of ['approve', 'reject']) {
      try { await dispatchLiveTool(name, {}, { mode: 'chat', onResult: () => {} }) } catch (error) { rejects.push((error as Error).message) }
    }
    const decisions: unknown[] = []
    await dispatchLiveTool('decide_proposal', { decision: 'approve', kind: 'email' }, { mode: 'chat', onResult: () => {}, onDecide: async (intent: unknown) => { decisions.push(intent); return { decided: true } } })
    await dispatchLiveTool('alter_chat', { message: 'reject that email' }, { mode: 'chat', onResult: () => {}, onDecide: async (intent: unknown) => { decisions.push(intent); return { decided: true } } })
    return { rejects, decisions }
  })
  for (const message of result.rejects) expect(message).toContain('cannot perform that action')
  expect(result.decisions).toEqual([{ decision: 'approve', kind: 'email' }, { decision: 'reject', kind: 'email' }])
})
