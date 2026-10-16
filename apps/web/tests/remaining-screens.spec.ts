import { expect, test, type Page } from '@playwright/test'

async function join(page: Page, path = '/') {
  await page.goto(path)
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
}
async function navigate(page: Page, name: string) { await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: new RegExp(`^${name}`, 'i') }).click() }

test('an escalation requires review before sending and then appears answered', async ({ page }) => {
  await join(page)
  await navigate(page, 'escalations')
  await page.getByLabel('Your reply').fill('QA can sign off after the iOS crash is fixed.')
  await page.getByRole('button', { name: 'Review reply' }).click()
  await expect(page.getByText('Your answer will be sent', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send reply', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Send reply', exact: true }).click()
  await expect(page.getByText('Your answer: QA can sign off', { exact: false })).toBeVisible()
  await navigate(page, 'activity')
  await expect(page.getByText('Replied to the QA sign-off question')).toBeVisible()
})

test('taught memories need approval; rules and preferences persist across screens', async ({ page }) => {
  await join(page)
  await navigate(page, 'settings')
  await page.getByLabel('Teach your Alter something').fill('Run accessibility checks before sign-off.')
  await page.getByRole('button', { name: 'Teach', exact: true }).click()
  const memory = page.locator('.memory').filter({ hasText: 'Run accessibility checks' })
  await expect(memory).toContainText('proposed')
  await memory.getByRole('button', { name: 'Approve memory' }).click()
  await expect(memory).toContainText('approved')
  await memory.getByRole('button', { name: 'Revoke memory' }).click()
  await expect(memory).toContainText('revoked')
  const rule = page.getByRole('group', { name: 'Share project status → team' })
  await rule.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(rule.getByRole('button', { name: 'Deny', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Email me copies').fill('alex@example.com')
  await page.getByRole('button', { name: 'Save email' }).click()
  await expect(page.getByRole('status')).toContainText('Email preference saved')
  await navigate(page, 'team'); await navigate(page, 'settings')
  await expect(page.getByLabel('Email me copies')).toHaveValue('alex@example.com')
  await expect(page.getByRole('group', { name: 'Share project status → team' }).getByRole('button', { name: 'Deny' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('External email: denied by organization', { exact: false })).toBeVisible()
})

test('activity receipt drawer has sources and result; Escape closes it', async ({ page }) => {
  await join(page)
  await navigate(page, 'activity')
  await page.getByRole('button', { name: "Rahul's Alter answered you: why one-tap sign-in", exact: false }).click()
  const drawer = page.getByRole('dialog', { name: 'Action receipt' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('arch-sync-2026-10-08 · 12:04')
  await expect(drawer).toContainText('share-rationale')
  await expect(drawer).toContainText('Completed')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('sheet and email previews work; approved demo email reaches the inbox', async ({ page, isMobile }) => {
  await join(page)
  await page.getByRole('button', { name: 'Add a tracker row for the iOS crash' }).click()
  await page.getByRole('button', { name: 'Review proposal' }).click()
  await expect(page.getByRole('table')).toContainText('iOS sign-in crash')
  if (isMobile) await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.getByLabel('Message your Alter').fill('Email the team a QA summary')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review proposal' })).toHaveCount(2)
  await navigate(page, 'approvals')
  const email = page.getByRole('article', { name: 'Team email · QA summary' }).filter({ visible: true })
  await expect(email).toContainText('Workspace team inboxes')
  await email.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(email.getByRole('status')).toHaveText('Applied in demo')
  await navigate(page, 'files')
  await expect(page.getByRole('heading', { name: 'Login revamp · QA summary' })).toBeVisible()
  await expect(page.getByText('A file link is not available yet.').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('invite flow takes the security role and uses a shareable local invite URL', async ({ page }) => {
  await join(page, '/join/INV123')
  await navigate(page, 'team')
  await page.getByRole('button', { name: 'Copy invite link' }).click()
  await expect(page.getByLabel('Invite link')).toHaveValue(/\/join\/INV123$/)
  const role = await page.evaluate(async () => { const path = '/src/api/mock/mockApi.ts'; const { mockApi } = await import(path); return (await mockApi.me()).slot })
  expect(role).toBe('security_engineer')
})

test('kiosk is an AI-labelled huddle tile and director mode does not bypass authorization', async ({ page }) => {
  await page.goto('/?kiosk=1&tile=rahul')
  await expect(page.getByRole('heading', { name: "Rahul's Alter" })).toBeVisible()
  await expect(page.getByText('Rahul is on leave')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Talk to this Alter' })).toBeVisible()
  await page.goto('/?director=1')
  await page.getByLabel('Workspace ID').fill('ws_demo')
  await page.getByLabel('Director key').fill('fake-key')
  await page.getByRole('button', { name: 'Claim role' }).click()
  await expect(page.getByRole('alert')).toContainText('requires a configured video workspace')
})

test('voice tool router rejects approval and mismatched targets; permitted tools use the API', async ({ page }) => {
  await join(page)
  const result = await page.evaluate(async () => {
    const path = '/src/live/tools.ts'
    const { dispatchLiveTool } = await import(path)
    const context = { mode: 'revise', targetId: 'apr_doc', onResult: () => {} }
    const rejects = []
    for (const [name, args] of [['approve', {}], ['revise_approval', { approvalId: 'apr_email', instruction: 'Change this' }]]) {
      try { await dispatchLiveTool(name, args, context) } catch (error) { rejects.push((error as Error).message) }
    }
    const revised = await dispatchLiveTool('revise_approval', { approvalId: 'apr_doc', instruction: 'Check screen reader support.' }, context)
    const draft = await dispatchLiveTool('respond_escalation', { escalationId: 'esc_02', text: 'QA is pending.' }, { mode: 'reply', targetId: 'esc_02', draftOnly: true, onResult: () => {} })
    const storePath = '/src/api/mock/workspace.ts'; const { mockSnapshot } = await import(storePath)
    return { rejects, revision: revised.revision, draft, state: mockSnapshot().escalations[0].state }
  })
  expect(result.rejects[0]).toContain('Approval requires the on-screen button')
  expect(result.rejects[1]).toContain('Only the open proposal')
  expect(result.revision).toBe(2)
  expect(result.draft.sent).toBe(false)
  expect(result.state).toBe('pending')
})

test('PCM conversion clips, resamples and writes little-endian audio', async ({ page }) => {
  await page.goto('/')
  const audio = await page.evaluate(async () => {
    const path = '/src/live/audio.ts'; const { pcm16Resampler, pcmBase64 } = await import(path)
    const output = pcm16Resampler(16_000)(new Float32Array([-2, 2, .5]))
    const resampled = pcm16Resampler(48_000)(new Float32Array(480).fill(.5))
    return { output: [...output], length: resampled.length, sample: resampled[0], bytes: [...atob(pcmBase64(output))].map((c) => c.charCodeAt(0)) }
  })
  expect(audio.output).toEqual([-32768, 32767, 16384])
  expect(audio.length).toBe(160)
  expect(audio.sample).toBe(16384)
  expect(audio.bytes).toEqual([0, 128, 255, 127, 0, 64])
})
