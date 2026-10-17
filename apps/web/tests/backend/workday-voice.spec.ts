import { expect, test } from '@playwright/test'

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
})

test('one microphone follows Alter to saved diagram and consenting meeting', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const state = window as any
    state.voiceContexts = []
    const Native = window.AudioContext
    window.AudioContext = class extends Native { constructor(options?: AudioContextOptions) { super(options); state.voiceContexts.push(this) } }
  })
  await page.setExtraHTTPHeaders({
    'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.44' : '127.0.0.43',
  })
  const starts: { mode: string; targetId?: string; meetingId?: string }[] = []
  const active = new Set<number>()
  const closed = new Set<number>()
  let socketNumber = 0
  let send: ((value: unknown) => void) | undefined
  await page.route('**/v1/live/sessions', (route) => {
    starts.push(route.request().postDataJSON())
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ticket: 'fake-provider-ticket',
        socketPath: '/v1/live/connect',
      }),
    })
  })
  await page.routeWebSocket('**/v1/live/connect', (socket) => {
    const id = ++socketNumber
    send = (value) => socket.send(JSON.stringify(value))
    socket.onClose(() => {
      active.delete(id)
      closed.add(id)
    })
    socket.onMessage((raw) => {
      const packet = JSON.parse(String(raw))
      if (packet.ticket) {
        active.add(id)
        socket.send(JSON.stringify({ ready: true }))
      }
      if (packet.functionResponses)
        socket.send(JSON.stringify({ serverContent: { turnComplete: true } }))
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Step into Dev’s day' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  expect(starts.at(-1)?.mode).toBe('chat')
  // Live sometimes speaks a reply without calling its tool. The streaming
  // transcript alone opens the requested card, and the same voice session
  // follows the user onto the canvas instead of reconnecting.
  send!({ serverContent: { inputTranscription: { text: 'Open card two' }, turnComplete: true } })
  await expect(page.getByRole('heading', { name: 'Login journey', exact: true })).toBeVisible()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  expect(starts.map((start) => start.mode)).toEqual(['chat'])
  expect(active.size).toBe(1)
  await expect(page.getByRole('button', { name: 'End voice' })).toHaveCount(1)
  send!({
    toolCall: {
      functionCalls: [
        {
          id: 'diagram-edit-1',
          name: 'alter_chat',
          args: { message: 'Add a retry state if sign-in fails' },
        },
      ],
    },
  })
  const retry = page.getByRole('button', { name: /fallback ✦ Added( by voice)? Retry sign-in/ })
  await expect(retry).toBeVisible()
  await expect(retry).toHaveClass(/nav-highlight/)
  await expect(page.getByText('Your saved design · Revision 2')).toBeVisible()
  send!({ serverContent: { inputTranscription: { text: 'Change the session timeout to 15 minutes' }, turnComplete: true } })
  await expect(page.getByText('Your saved design · Revision 3')).toBeVisible()
  await expect(page.getByRole('button', { name: /Home · 15 minute session/ })).toBeVisible()
  await page
    .getByRole('button', { name: 'Back to your Alter', exact: false })
    .first()
    .click()
  expect(starts.map((start) => start.mode)).toEqual(['chat'])
  expect(active.size).toBe(1)
  await page.getByRole('button', { name: /Join the team sync/ }).click()
  await page
    .getByLabel('The participants consent to transcript capture.')
    .check()
  await page.getByRole('button', { name: 'Start consenting session' }).click()
  await expect.poll(() => starts.at(-1)?.mode).toBe('huddle')
  expect(starts.at(-1)?.meetingId).toMatch(/^meet_/)
  await expect.poll(() => page.evaluate(() => (window as any).voiceContexts.map((context: AudioContext) => context.state))).toEqual(['running'])
  await expect(page.getByRole('button', { name: 'End voice' })).toHaveCount(1)
  send!({
    toolCall: {
      functionCalls: [
        {
          id: 'huddle-question',
          name: 'ask_alter',
          args: {
            memberId: 'siddhi',
            question: 'Why did Siddhi choose one-tap?',
          },
        },
      ],
    },
  })
  await expect(
    page.getByRole('article', { name: 'Siddhi’s actual answer' }),
  ).toContainText('October 8')
})
