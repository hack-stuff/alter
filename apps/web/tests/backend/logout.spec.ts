import { expect, test } from '@playwright/test'

test('logging out switches local identity without deleting saved work', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Step into Priya’s day' }).click()
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  const originalUid = await page.evaluate(() => localStorage.getItem('alter.dev.uid'))
  expect(originalUid).toMatch(/^dev_/)

  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Log out?' })
  await expect(dialog).toContainText('browser-only identity')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await dialog.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page.getByLabel('Your name')).toBeVisible()
  const nextUid = await page.evaluate(() => localStorage.getItem('alter.dev.uid'))
  expect(nextUid).not.toBe(originalUid)
  await page.reload()
  await expect(page.getByLabel('Your name')).toBeVisible()

  const saved = await page.request.get('http://127.0.0.1:8082/v1/me', {
    headers: { 'X-Dev-Uid': originalUid! },
  })
  expect(saved.status()).toBe(200)
  expect((await saved.json()).name).toBe('Priya')
})
