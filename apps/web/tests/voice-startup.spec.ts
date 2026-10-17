import { expect, test } from '@playwright/test'

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test('blocked autoplay offers visible activation and retries the unheard greeting', async ({ page }) => {
  await page.route('**/src/firebase-auth.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: "export async function firebaseIdToken(){return 'synthetic-token'}" }))
  await page.route('**/v1/live/token', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'synthetic-live-token', model: 'synthetic-live-model', expiresAt: new Date(Date.now() + 600000).toISOString() }) }))
  await page.route('**/node_modules/.vite/deps/@google_genai.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export class GoogleGenAI {
      constructor(){this.live={connect:async(options)=>{
        window.greetingRequests ??= [];
        window.startupHarness={callbacks:options.callbacks};
        return {sendRealtimeInput(){},sendToolResponse(){},sendClientContent(value){window.greetingRequests.push(value)},close(){}};
      }}}
    }` }))
  await page.addInitScript(() => {
    const state = window as any
    state.blockAudio = true
    const Native = window.AudioContext
    window.AudioContext = class extends Native {
      resume(): Promise<void> { return state.blockAudio ? new Promise(() => {}) : super.resume() }
    }
    document.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button')?.textContent?.includes('Enable voice')) state.blockAudio = false
    }, { capture: true })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  const enable = page.getByRole('button', { name: 'Enable voice', exact: true })
  await expect(enable).toBeInViewport()
  await expect(page.getByLabel('Opening your workday')).toBeVisible()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Enter without voice' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('allow sound')
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')))).toEqual([])
  await enable.click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await expect(page.getByLabel('Opening your workday')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length)).toBe(1)
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')))).toEqual([])
  await page.evaluate(() => (window as any).startupHarness.callbacks.onclose())
  await page.getByRole('button', { name: 'Talk to your Alter' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length)).toBe(2)
  await page.evaluate(() => (window as any).startupHarness.callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: btoa('\0'.repeat(4800)), mimeType: 'audio/pcm;rate=24000' } }] } } }))
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')).length)).toBe(1)
  await expect(page.getByLabel('Opening your workday')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await page.getByRole('button', { name: 'Hear my briefing' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length)).toBe(3)

  await page.reload()
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByLabel('Opening your workday')).toBeVisible()
  await page.getByRole('button', { name: 'Enable voice', exact: true }).click()
  await expect(page.getByLabel('Opening your workday')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  expect(await page.evaluate(() => (window as any).greetingRequests.length)).toBe(0)
})

test('failed Google setup offers retry and does not enter an unusable workspace', async ({ page }) => {
  await page.route('**/v1/workspaces/retry-provision', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'provisioning' }) }))
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await page.evaluate(async () => {
    const { mockSnapshot, patchMock } = await import('/src/api/mock/workspace.ts')
    patchMock({ workspace: { ...mockSnapshot().workspace!, state: 'provisioning_failed' } })
  })
  await expect(page.getByLabel('Opening your workday')).toBeVisible()
  await expect(page.getByLabel('Opening your workday').getByRole('button', { name: 'Retry Google setup' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enter without voice' })).toHaveCount(0)
  await expect(page.locator('.offer-card').first()).toBeDisabled()
  const request = page.waitForRequest('**/v1/workspaces/retry-provision')
  await page.getByLabel('Opening your workday').getByRole('button', { name: 'Retry Google setup' }).click()
  expect((await request).method()).toBe('POST')
})
