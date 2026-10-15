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
  await page.getByRole('button', { name: 'Step into Priya’s day' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  expect(starts.at(-1)?.mode).toBe('chat')
  send!({ toolCall: { functionCalls: [{ id: 'open-plan', name: 'alter_chat', args: { message: 'Open the login plan' } }] } })
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await expect.poll(() => starts.at(-1)?.mode).toBe('diagram')
  await expect.poll(() => closed.size).toBeGreaterThanOrEqual(1)
  await expect.poll(() => active.size).toBe(1)
  await expect(page.getByRole('button', { name: 'End voice' })).toHaveCount(1)
  const planId = starts.at(-1)!.targetId
  expect(planId).toMatch(/^login_/)
  send!({
    toolCall: {
      functionCalls: [
        {
          id: 'diagram-edit-1',
          name: 'revise_diagram',
          args: { planId, instruction: 'Add a retry state if sign-in fails' },
        },
      ],
    },
  })
  await expect(
    page.getByRole('button', { name: /fallback Changed Retry sign-in/ }),
  ).toBeVisible()
  await expect(page.getByText('Your saved design · Revision 2')).toBeVisible()
  await page
    .getByRole('button', { name: 'Back to your Alter', exact: false })
    .first()
    .click()
  await expect.poll(() => starts.at(-1)?.mode).toBe('chat')
  await expect.poll(() => closed.size).toBeGreaterThanOrEqual(2)
  await expect.poll(() => active.size).toBe(1)
  await page.getByRole('button', { name: /Join the team sync/ }).click()
  await expect.poll(() => active.size).toBe(0)
  await page
    .getByLabel('The participants consent to transcript capture.')
    .check()
  await page.getByRole('button', { name: 'Start consenting session' }).click()
  await expect.poll(() => starts.at(-1)?.mode).toBe('huddle')
  expect(starts.at(-1)?.meetingId).toMatch(/^meet_/)
  await expect(page.getByRole('button', { name: 'End voice' })).toHaveCount(1)
  send!({
    toolCall: {
      functionCalls: [
        {
          id: 'huddle-question',
          name: 'ask_alter',
          args: {
            memberId: 'rahul',
            question: 'Why did Rahul choose one-tap?',
          },
        },
      ],
    },
  })
  await expect(
    page.getByRole('article', { name: 'Rahul’s actual answer' }),
  ).toContainText('October 8')
})
