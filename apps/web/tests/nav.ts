import { expect, type Page } from '@playwright/test'

/** Opens a screen from the rail (laptop) or the bottom bar and its More sheet (phone). */
export async function openScreen(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Alter' })
  await nav.getByRole('button', { name: /^Home/ }).filter({ visible: true }).waitFor()
  const pattern = new RegExp(`^${label}`, 'i')
  let button = nav.getByRole('button', { name: pattern }).filter({ visible: true })
  if (!await button.count()) {
    await nav.getByRole('button', { name: /^More/ }).click()
    button = nav.getByRole('button', { name: pattern }).filter({ visible: true })
  }
  const screen = await button.first().getAttribute('data-nav-screen')
  await button.first().click()
  // Screen switches run in a React transition; wait until this one is shown.
  await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible()
}

/** The meeting reviews list lives under the Meeting screen's "Meetings" tab. */
export async function openMeetings(page: Page) {
  await openScreen(page, 'Meeting')
  await page.getByRole('tab', { name: 'Meetings' }).click()
}

/** Example requests beyond the three quick chips sit behind a disclosure on Home. */
export async function showMoreRequests(page: Page) {
  const more = page.getByText('More things to ask', { exact: true })
  // Wait for Home to render the disclosure; an instant count races a slow render.
  await expect(more).toBeVisible()
  if (await page.locator('details.more-requests').getAttribute('open') === null) await more.click()
}
