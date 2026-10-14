import { expect, test } from '@playwright/test'

test('production PWA has icons, controls the app, and restores the shell offline', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Alter', exact: true })).toBeVisible()
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href
    return await (await fetch(href)).json()
  })
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512'])
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await page.getByLabel('Your name').fill('Offline rehearsal')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByRole('heading', { name: "Offline rehearsal's Alter" })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Alter', exact: true })).toBeVisible()
  const cachedPaths = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)))).flat()
  })
  expect(cachedPaths.some((path) => path.startsWith('/v1/'))).toBe(false)
  expect(cachedPaths.some((path) => /token|receipt/.test(path))).toBe(false)
  await context.setOffline(false)
})
