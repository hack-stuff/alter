import { expect, test } from '@playwright/test'
import { openScreen } from '../nav'

// A fake desktop helper on its usual address; the real API plans the steps.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300)]).toString('base64')

test('the Computer page pairs with the helper and does a chat task step by step', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'X-Real-IP': info.project.name === 'mobile' ? '127.0.0.11' : '127.0.0.10' })
  const fake = { running: false, paired: false, acts: [] as unknown[] }
  await page.route('http://127.0.0.1:47613/v1/**', async (route) => {
    if (!fake.running) return route.abort('connectionrefused')
    const request = route.request()
    const headers = await request.allHeaders()
    const reply = (status: number, body: unknown) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'Access-Control-Allow-Origin': headers.origin ?? 'http://127.0.0.1:5177' },
    })
    const path = new URL(request.url()).pathname
    if (path === '/v1/status') return reply(200, { app: 'alter-helper', version: '1.0.0', platform: 'windows', paired: fake.paired, paused: false, askEveryStep: false, confirmations: false, screen: { width: 1280, height: 800 } })
    if (path === '/v1/pair') {
      if (request.postDataJSON().code !== '123456') return reply(403, { error: { code: 'WRONG_CODE', message: 'That code doesn’t match the one shown by the helper.' } })
      fake.paired = true
      return reply(200, { token: 'helper-token' })
    }
    if (headers.authorization !== 'Bearer helper-token') return reply(401, { error: { code: 'NOT_PAIRED', message: 'Pair this page with the helper first.' } })
    if (path === '/v1/screenshot') return reply(200, { image: JPEG, mimeType: 'image/jpeg', width: 1280, height: 800 })
    if (path === '/v1/act') { fake.acts.push(request.postDataJSON()); return reply(200, { ok: true }) }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'Unknown helper path.' } })
  })

  // Only the Linux build is published here; the others fall back to the Python script.
  await page.route('**/downloads/alter-helper-linux-x86_64', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: '' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Step into Dev’s day' }).click()
  await expect(page.getByRole('button', { name: /^Account:/ })).toBeVisible()
  await openScreen(page, 'Computer')
  const setup = page.getByRole('region', { name: 'Set up the desktop helper' })
  await setup.getByRole('combobox').selectOption('linux')
  await expect(setup.locator('code').first()).toContainText('/downloads/alter-helper-linux-x86_64 && chmod +x ~/alter-helper && ~/alter-helper')
  await expect(setup.getByRole('button', { name: 'Copy' })).toBeVisible()
  await setup.getByRole('combobox').selectOption('windows')
  await expect(setup.getByRole('button', { name: 'Download alter_helper.py' })).toBeVisible()
  await expect(setup.getByRole('button', { name: 'Download for Windows' })).toHaveCount(0)

  // The page notices the helper once it starts.
  fake.running = true
  const pairing = page.getByRole('form', { name: 'Pair the desktop helper' })
  await expect(pairing).toBeVisible({ timeout: 8000 })
  await pairing.getByLabel('Code shown by the helper').fill('111 111')
  await pairing.getByRole('button', { name: 'Pair' }).click()
  await expect(page.locator('[data-screen="computer"]').getByRole('alert')).toContainText('doesn’t match')
  await pairing.getByLabel('Code shown by the helper').fill('123 456')
  await pairing.getByRole('button', { name: 'Pair' }).click()
  await expect(page.getByText('Helper connected')).toBeVisible()
  expect(fake.acts).toEqual([])

  // A chat request that names the computer is handed to this page and starts by itself.
  await openScreen(page, 'Home')
  await page.getByLabel('Type to your Alter').fill('On my computer, type "hello" in the open editor')
  await page.getByLabel('Type to your Alter').press('Enter')
  await expect(page.locator('[data-screen="computer"]')).toBeVisible()
  const approval = page.getByRole('alertdialog', { name: 'Approve this step' })
  await expect(approval).toContainText('Type “hello”')
  expect(fake.acts).toEqual([])
  await approval.getByRole('button', { name: 'Allow' }).click()
  const log = page.getByRole('list', { name: 'What your Alter did' })
  await expect(log).toContainText('Done — I typed it.')
  await expect(page.getByRole('img', { name: 'The latest screenshot of this computer' })).toBeVisible()
  expect(fake.acts).toEqual([{ actions: [{ action: 'type', x: 500, y: 500, text: 'hello', enter: false, clear: true }], confirm: false, summary: 'Type “hello”' }])
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
})
