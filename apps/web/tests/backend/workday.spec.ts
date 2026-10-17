import { expect, test } from '@playwright/test'

test('Dev edits a persisted design, publishes its reviewed specification, and prepares actual meeting follow-up', async ({
  page,
}, info) => {
  await page.setExtraHTTPHeaders({
    'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.42' : '127.0.0.41',
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Step into Dev’s day' }).click()
  await expect(
    page.getByRole('heading', { name: "Dev's Alter" }),
  ).toBeVisible()
  await expect(
    page.getByText('Local development · simulated AI', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Your Google Calendar agenda' }),
  ).toContainText('Review Kani')
  await expect(page.getByRole('heading', { name: 'Where should we start?' })).toBeVisible()
  const startTop = await page.getByRole('heading', { name: 'Where should we start?' }).evaluate((element) => element.getBoundingClientRect().top)
  const calendarTop = await page.getByRole('region', { name: 'Your Google Calendar agenda' }).evaluate((element) => element.getBoundingClientRect().top)
  expect(startTop).toBeLessThan(calendarTop)
  await page.getByRole('button', { name: /Shape the login plan/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Login journey', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: /Try saying:.*Add a retry state/ })
    .click()
  await expect(
    page.getByRole('button', { name: /fallback ✦ Added( by voice)? Retry sign-in/ }),
  ).toBeVisible()
  await expect(page.getByText('Your saved design · Revision 2')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: "Dev's Alter" }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Shape the login plan/ }).click()
  await expect(
    page.getByRole('button', { name: /Retry sign-in/ }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Undo last edit' }).click()
  await expect(page.getByRole('button', { name: /Retry sign-in/ })).toHaveCount(
    0,
  )
  await page
    .getByRole('button', { name: /Try saying:.*Add a retry state/ })
    .click()
  await page.getByRole('button', { name: 'Review publication' }).click()
  const publication = page.getByRole('region', {
    name: 'Review design publication',
  })
  await expect(publication.getByText('Needs your approval')).toBeVisible()
  await publication
    .getByRole('button', { name: 'Approve', exact: true })
    .click()
  await expect(publication.getByRole('status')).toHaveText('Applied')
  await publication
    .getByRole('button', { name: 'Read back published document' })
    .click()
  await expect(
    page.getByRole('article', { name: 'Published document readback' }),
  ).toContainText('Retry sign-in')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Back to your Alter', exact: false })
    .first()
    .click()
  await page.getByRole('button', { name: 'Meeting', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start a new Google Meet' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Alters ready for the demo' })).toContainText("Dev's Alter")
  await expect(page.getByRole('region', { name: 'Alters ready for the demo' })).toContainText("Siddhi's Alter")
  await expect(
    page.getByText('No transcript has been recorded here yet.'),
  ).toBeVisible()
  await page
    .getByLabel('The participants consent to transcript capture.')
    .check()
  await page.getByRole('button', { name: 'Start consenting session' }).click()
  await expect(
    page.getByRole('button', { name: 'Meeting finished — prepare my review' }),
  ).toBeVisible()
  await page.getByText("Ask Siddhi's Alter about the work").click()
  await page
    .getByRole('button', { name: /Try saying:.*Why did we switch/ })
    .click()
  await expect(
    page.getByRole('article', { name: 'Siddhi’s actual answer' }),
  ).toContainText('October 8')
  await page
    .getByRole('button', { name: /Try saying:.*When are we launching/ })
    .click()
  await expect(
    page.getByRole('article', { name: 'Siddhi’s actual answer' }),
  ).toContainText('Priority question saved')
  await page.getByText('Conversation record', { exact: true }).click()
  await page
    .getByLabel('Add actual meeting transcript')
    .fill(
      'Kani will update the mock-ups by Friday. Dev will update the status doc.',
    )
  await page
    .getByRole('button', { name: 'Save transcript', exact: true })
    .click()
  await expect(page.getByText('0 waiting to upload')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Meeting finished — prepare my review' })
    .click()
  await expect(page.getByRole('tab', { name: 'Status doc' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Login revamp — status' }),
  ).toBeVisible()
})
