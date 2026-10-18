import { expect, test } from '@playwright/test'
import { VOICE_CONNECT, WELCOME_OPENING, pauseClock, tickUntil } from './timing'

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
  await page.clock.install()
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  // The welcome gives way 1.5s of page time after the sound check starts, which a loaded machine
  // can let pass before it first looks, so tick page time while checking for it.
  await pauseClock(page)
  await page.getByRole('button', { name: 'Continue' }).click()
  // Voice connects behind the welcome; when sound is blocked, the home screen opens at once.
  await tickUntil(page, () => page.getByLabel('Opening your workday').isVisible())
  const enable = page.getByRole('button', { name: 'Enable voice', exact: true })
  await tickUntil(page, () => enable.isVisible())
  await page.clock.resume()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await expect(page.getByLabel('Opening your workday')).toHaveCount(0)
  await expect(enable).toBeInViewport()
  await expect(page.getByRole('alert')).toContainText('allow sound')
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')))).toEqual([])
  await enable.click()
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: VOICE_CONNECT })
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length)).toBe(1)
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')))).toEqual([])
  await page.evaluate(() => (window as any).startupHarness.callbacks.onclose())
  await page.getByRole('button', { name: 'Talk to your Alter' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length), { timeout: VOICE_CONNECT }).toBe(2)
  await page.evaluate(() => (window as any).startupHarness.callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: btoa('\0'.repeat(4800)), mimeType: 'audio/pcm;rate=24000' } }] } } }))
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('alter.live.greeted.')).length)).toBe(1)
  await expect(page.getByLabel('Opening your workday')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await page.getByRole('button', { name: 'Hear my briefing' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).greetingRequests.length)).toBe(3)

  await page.reload()
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible({ timeout: WELCOME_OPENING })
  await page.getByRole('button', { name: 'Enable voice', exact: true }).click({ timeout: VOICE_CONNECT })
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible({ timeout: VOICE_CONNECT })
  expect(await page.evaluate(() => (window as any).greetingRequests?.length ?? 0)).toBe(0)
})

test('failed Google setup offers retry and does not enter an unusable workspace', async ({ page }) => {
  await page.route('**/v1/workspaces/retry-provision', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'provisioning' }) }))
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Continue' }).click()
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

test('slow workspace setup reveals the workday even when voice cannot start', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  // The welcome gives way after 8s of page time; tick it so a loaded machine can't pass that first.
  await pauseClock(page)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.evaluate(async () => {
    const { mockSnapshot, patchMock } = await import('/src/api/mock/workspace.ts')
    patchMock({ workspace: { ...mockSnapshot().workspace!, state: 'provisioning' } })
  })
  await tickUntil(page, () => page.getByLabel('Opening your workday').isVisible())
  await page.clock.fastForward(8_100)
  await expect(page.getByLabel('Opening your workday')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await expect(page.getByText('Your Alter is connecting to your team’s Google resources…')).toBeVisible()
})
