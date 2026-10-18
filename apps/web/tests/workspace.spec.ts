import { expect, test, type Page } from '@playwright/test'
import { WELCOME_OPENING } from './timing'
import { openScreen, showMoreRequests } from './nav'

async function join(page: Page) {
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible({ timeout: WELCOME_OPENING })
}

const navigate = openScreen

test('chat opens a proposal; repeated revisions survive navigation and approval', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await join(page)
  await showMoreRequests(page)
  await page.getByRole('button', { name: 'Add a QA update to the status doc' }).click()
  await page.getByRole('button', { name: 'Review proposal' }).click()
  let card = page.getByRole('article', { name: 'Status doc · QA section' }).filter({ visible: true })
  await expect(card.getByText('2 open bugs; sign-off pending.', { exact: false })).toBeVisible()
  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  await card.getByLabel('Revision instructions').fill('Retest the Android flow.')
  await card.getByRole('button', { name: 'Revise proposal' }).click()
  await expect(card.getByText('Document update · Revision 2')).toBeVisible()
  await card.getByRole('button', { name: 'Revise', exact: true }).click()
  await card.getByLabel('Revision instructions').fill('Retest the iOS flow.')
  await card.getByRole('button', { name: 'Revise proposal' }).click()
  await expect(card.getByText('Document update · Revision 3')).toBeVisible()
  await expect(card.getByText('Retest the Android flow.', { exact: false })).toBeVisible()
  await navigate(page, 'Approvals')
  card = page.getByRole('article', { name: 'Status doc · QA section' }).filter({ visible: true })
  await expect(card.getByText('Retest the iOS flow.', { exact: false })).toBeVisible()
  await card.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Applied in demo')
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await navigate(page, 'Home')
  await expect(page.getByRole('article', { name: 'Status doc · QA section' }).getByRole('status')).toHaveText('Applied in demo')
  await expect(page.getByText('I drafted a QA update', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('direct questions show allowed, escalated and private outcomes with sample rules', async ({ page }) => {
  await join(page)
  await navigate(page, 'Team')
  await page.getByRole('button', { name: "Ask Siddhi's Alter" }).click()
  const question = page.getByLabel("Question for Siddhi's Alter")
  const cases = [
    ['Why one-tap?', '✓ Allowed', 'Share project rationale with the team'],
    ['Confirm launch date?', '⚑ Asked Siddhi', 'Ask the owner before committing to dates'],
    ['Why is Siddhi on leave?', '× Not shared', 'Keep personal information private'],
  ]
  for (const [text, outcome, rule] of cases) {
    await question.fill(text)
    await page.getByRole('button', { name: 'Send question' }).click()
    await expect(page.getByText(outcome, { exact: true })).toBeVisible()
    await expect(page.getByText('How Siddhi’s Alter', { exact: false })).toBeVisible()
    await expect(page.getByText(rule, { exact: false })).toBeVisible()
  }
})

test('calendar proposal can be rejected; reset clears chat and restores proposals', async ({ page }) => {
  test.slow()
  await join(page)
  await showMoreRequests(page)
  await page.getByRole('button', { name: 'Book 30 min with Kani on Thursday' }).click()
  await page.getByRole('button', { name: 'Review proposal' }).click()
  const card = page.getByRole('article', { name: 'QA sync with Kani' })
  await expect(card.getByText('Attendees: You, Kani')).toBeVisible()
  await card.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Rejected')
  await navigate(page, 'Rules')
  await page.getByRole('button', { name: 'Reset Alter' }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await navigate(page, 'Approvals')
  await expect(card.getByRole('status')).toHaveText('Rejected')
  await navigate(page, 'Rules')
  await page.getByRole('button', { name: 'Reset Alter' }).click()
  await page.getByRole('button', { name: 'Confirm reset' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Where should we start?' })).toBeVisible()
  await navigate(page, 'Approvals')
  await expect(page.getByRole('article', { name: 'QA sync with Kani' }).getByRole('status')).toHaveText('Needs your approval')
})

test('mock API rejects stale decisions and mutations arriving after a reset', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const modulePath = '/src/api/mock/mockApi.ts'
    const { mockApi } = await import(modulePath)
    await mockApi.createWorkspace('Alex')
    const revised = await mockApi.revise('apr_doc', 'Keep the original notes.')
    let stale = ''
    try { await mockApi.decide('apr_doc', 'approve', 1) } catch (error) { stale = (error as Error).message }
    const applied = await mockApi.decide('apr_doc', 'approve', revised.revision)
    await mockApi.resetWorkspace()
    const pending = mockApi.revise('apr_doc', 'This must not survive reset.').catch((e: Error) => e.message)
    await mockApi.resetWorkspace()
    const reset = await pending
    const dataPath = '/src/api/mock/workspace.ts'
    const { mockApprovals } = await import(dataPath)
    return { stale, applied: applied.state, reset, revision: mockApprovals()[0].revision }
  })
  expect(results.stale).toContain('Review the latest version')
  expect(results.applied).toBe('applied')
  expect(results.reset).toContain('workspace was reset')
  expect(results.revision).toBe(1)
})

test('join and chat failures preserve input and allow retry', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const modulePath = '/src/api/client.ts'
    const { api } = await import(modulePath)
    const create = api.createWorkspace
    api.createWorkspace = async (...args: unknown[]) => { api.createWorkspace = create; throw new Error(`Could not join ${args[0]}. Try again.`) }
  })
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not join Alex')
  await expect(page.getByLabel('Your name')).toHaveValue('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible({ timeout: WELCOME_OPENING })
  await page.evaluate(async () => {
    const modulePath = '/src/api/client.ts'
    const { api } = await import(modulePath)
    const chat = api.chat
    api.chat = async () => { api.chat = chat; throw new Error('Rate limited. Please try again.') }
  })
  await page.getByLabel('Type to your Alter').fill('Why one-tap?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Rate limited' })).toBeVisible()
  await expect(page.getByLabel('Type to your Alter')).toHaveValue('Why one-tap?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('log').getByText('Siddhi chose One Tap on the login page', { exact: false })).toBeVisible()
  await expect(page.getByRole('log').getByText('Why one-tap?', { exact: true })).toHaveCount(1)
})
