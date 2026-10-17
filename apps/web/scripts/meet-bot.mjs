/** Local demo participant. Google sign-in stays in a separate Chrome profile. */
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const account = process.env.ALTER_MEET_BOT_ACCOUNT?.trim().toLowerCase()
if (!account) throw new Error('Set ALTER_MEET_BOT_ACCOUNT to the dedicated Alter Google account.')
const profile = process.env.ALTER_MEET_BOT_PROFILE || join(homedir(), '.config', 'alter', 'meet-bot-chrome')
const port = Number(process.env.ALTER_MEET_BOT_PORT || 8787)
const meetUrl = /^https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+$/

// Use synthetic devices and mute browser output. A newly opened tab can never
// capture the operator's microphone/camera or play the call into its own input.
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'],
})
let page = context.pages()[0] || await context.newPage()
await page.goto(`https://meet.google.com/?authuser=${encodeURIComponent(account)}`)
let joining = false

async function joinRoom(url) {
  if (!meetUrl.test(url)) throw new Error('A valid Google Meet URL is required.')
  const next = await context.newPage()
  try {
    await next.goto(`${url}?authuser=${encodeURIComponent(account)}`, { waitUntil: 'domcontentloaded' })
    await next.getByRole('button', { name: 'Join now' }).waitFor({ state: 'visible', timeout: 15000 })
    if (!await next.getByText(account, { exact: false }).isVisible()) {
      throw new Error('Sign into the dedicated Alter account in the bot Chrome window, then retry.')
    }
    const microphone = next.getByRole('button', { name: 'Turn off microphone' })
    if (await microphone.isVisible()) await microphone.click()
    const camera = next.getByRole('button', { name: 'Turn off camera' })
    if (await camera.isVisible()) await camera.click()
    await next.getByRole('button', { name: 'Join now' }).click()
    await next.getByRole('button', { name: 'Leave call' }).waitFor({ state: 'visible', timeout: 15000 })
    if (!await next.getByRole('button', { name: 'Turn on microphone' }).isVisible() ||
        !await next.getByRole('button', { name: 'Turn on camera' }).isVisible()) {
      throw new Error('The Alter joined but its microphone or camera is active.')
    }
    const previous = page
    page = next
    if (previous !== next && !previous.isClosed()) await previous.close()
    return { joined: true }
  } catch (error) {
    // Leave sign-in or Meet's error visible so the operator can resolve it.
    if (page !== next && !page.isClosed()) await page.close()
    page = next
    throw error
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'GET' && request.url === '/healthz') {
    response.end(JSON.stringify({ ok: true, joining }))
    return
  }
  if (request.method !== 'POST' || request.url !== '/join') {
    response.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
    return
  }
  if (joining) {
    response.writeHead(409).end(JSON.stringify({ error: 'An Alter is already joining.' }))
    return
  }
  joining = true
  try {
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 1024) throw new Error('Request too large.')
    }
    const result = await joinRoom(JSON.parse(body).meetUrl)
    response.writeHead(200).end(JSON.stringify(result))
  } catch (error) {
    response.writeHead(503).end(JSON.stringify({ error: error instanceof Error ? error.message : 'The Alter could not join Meet.' }))
  } finally {
    joining = false
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Alter Meet participant ready on http://127.0.0.1:${port}`)
  console.log('Sign into the dedicated Alter Google account in the new Chrome window before starting a meeting.')
})
process.on('SIGINT', async () => { server.close(); await context.close(); process.exit(0) })
