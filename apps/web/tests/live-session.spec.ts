import { expect, test } from '@playwright/test'

test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test('Live session handles transcripts, tools, duplicate calls, interruption and cleanup', async ({ page }) => {
  await page.route('**/src/firebase-auth.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: "export async function firebaseIdToken(){return 'test-firebase-token'}" }))
  await page.route('**/v1/live/token', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fake-ephemeral-token', model: 'test-live-model', expiresAt: new Date(Date.now() + 600_000).toISOString() }) }))
  await page.route('**/node_modules/.vite/deps/@google_genai.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export class GoogleGenAI {
      constructor() { this.live = { connect: async (options) => {
        window.liveHarness = { callbacks: options.callbacks, audio: 0, responses: [], closed: 0, text: [] };
        return { sendRealtimeInput(input) { if(input.audio) window.liveHarness.audio++; }, sendToolResponse(input) { window.liveHarness.responses.push(input); }, sendClientContent(input) { window.liveHarness.text.push(input); }, close() { window.liveHarness.closed++; } };
      } }; }
    }` }))
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const state = window as unknown as { testStreams: MediaStream[]; testAudio: AudioContext[] }
    state.testStreams = []; state.testAudio = []
    navigator.mediaDevices.getUserMedia = async (constraints) => { const stream = await original(constraints); state.testStreams.push(stream); return stream }
    const Native = window.AudioContext
    window.AudioContext = class extends Native { constructor(options?: AudioContextOptions) { super(options); state.testAudio.push(this) } }
  })
  await page.goto('/?voice=auto')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).liveHarness.audio)).toBeGreaterThan(0)
  await page.evaluate(async () => {
    const h = (window as any).liveHarness
    h.conversations = []
    const path = '/src/api/client.ts'
    const { api } = await import(path)
    const chat = api.chat
    api.chat = (...args: unknown[]) => { h.conversations.push(args[1]); return chat(...args) }
    h.callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Why one-tap?', finished: true }, outputTranscription: { text: 'Checking with Rahul.', finished: true } } })
    const call = { toolCall: { functionCalls: [{ id: 'call-1', name: 'alter_chat', args: { message: 'Why one-tap?' } }] } }
    h.callbacks.onmessage(call); h.callbacks.onmessage(call)
    h.callbacks.onmessage({ toolCallCancellation: { ids: ['cancelled'] } })
    h.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'cancelled', name: 'alter_chat', args: { message: 'Do not run this' } }] } })
  })
  await expect(page.getByRole('log').getByText('The old Google Sign-In button', { exact: false })).toBeVisible()
  await expect(page.getByRole('log').getByText('Why one-tap?', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Checking with Rahul.', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).liveHarness.responses.length)).toBe(1)
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'call-2', name: 'alter_chat', args: { message: 'Why is Rahul on leave?' } }] } }))
  await expect.poll(() => page.evaluate(() => (window as any).liveHarness.responses.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).liveHarness.conversations)).toEqual([undefined, 'conv_01'])
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'unsafe', name: 'approve', args: {} }] } }))
  await expect.poll(() => page.evaluate(() => (window as any).liveHarness.responses.length)).toBe(3)
  const unsafe = await page.evaluate(() => (window as any).liveHarness.responses[2].functionResponses[0].response.error)
  expect(unsafe).toContain('Approval requires the on-screen button')
  await page.evaluate(() => {
    const h = (window as any).liveHarness
    h.callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: btoa('\0'.repeat(48_000)), mimeType: 'audio/pcm;rate=24000' } }] } } })
  })
  await expect(page.getByText('Your Alter is speaking… · up to 10 minutes')).toBeVisible()
  await page.evaluate(() => (window as any).liveHarness.callbacks.onmessage({ serverContent: { interrupted: true } }))
  await expect(page.getByText('Listening… · up to 10 minutes')).toBeVisible()
  await page.getByRole('button', { name: 'End voice' }).click()
  await expect(page.getByRole('button', { name: 'Talk to your Alter' })).toBeVisible()
  const cleaned = await page.evaluate(() => ({ closed: (window as any).liveHarness.closed, tracks: (window as any).testStreams.flatMap((s: MediaStream) => s.getTracks().map((t) => t.readyState)), contexts: (window as any).testAudio.map((a: AudioContext) => a.state) }))
  expect(cleaned.closed).toBe(1)
  expect(cleaned.tracks).toEqual(['ended'])
  await expect.poll(() => page.evaluate(() => (window as any).testAudio.map((a: AudioContext) => a.state))).toEqual(['suspended'])
})

test('a rejected token request releases the microphone and returns to text controls', async ({ page }) => {
  await page.route('**/src/firebase-auth.ts', (route) => route.fulfill({ contentType: 'application/javascript', body: "export async function firebaseIdToken(){return 'test-firebase-token'}" }))
  await page.route('**/v1/live/token', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ detail: { error: { code: 'RATE_LIMITED', message: 'Your voice budget is used for now.' } } }) }))
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => { const stream = await original(constraints); (window as any).testStream = stream; return stream }
  })
  await page.goto('/?voice=auto')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByRole('alert')).toContainText('Your voice budget is used for now')
  await expect(page.getByRole('button', { name: 'Talk to your Alter' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).testStream.getTracks()[0].readyState)).toBe('ended')
})
