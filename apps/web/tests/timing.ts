// Shared waits for steps whose latency grows with machine load rather than app logic.
import { expect, type Page } from '@playwright/test'

/**
 * Starting voice chains workspace readiness, the dock's start delay, microphone and
 * AudioWorklet setup, and the session mint before "Listening…" shows. Under heavy load
 * this has taken over 25s, so allow past the relay's own 40s connect timeout too.
 */
export const VOICE_CONNECT = 60_000

/**
 * After joining, the welcome ("Opening your workday") covers Home until voice connects or
 * fails, or for up to 15s of page time once the workspace is ready, so waits for the Home
 * heading need the voice budget rather than expect's default.
 */
export const WELCOME_OPENING = VOICE_CONNECT

/**
 * Pauses an installed page clock slightly ahead of now. pauseAt refuses a time that has
 * already passed, which a loaded machine can reach between reading the page's clock and
 * pausing it, so retry with a fresh reading.
 */
export async function pauseClock(page: Page, ahead = 1_000) {
  for (let attempt = 1; ; attempt++) {
    try { return await page.clock.pauseAt(await page.evaluate(() => Date.now()) + ahead) }
    catch (error) { if (attempt === 5 || !String(error).includes('to the past')) throw error }
  }
}

/**
 * With the page clock paused, steps page time in 100ms ticks until `check` passes. Wall-clock
 * work (loading, connecting) takes as long as it needs while app timers advance only a tick
 * per check, so a state an app timer ends soon after can't lapse before it is seen.
 */
export function tickUntil(page: Page, check: () => Promise<boolean>) {
  return expect.poll(async () => { await page.clock.runFor(100); return check() }, { timeout: VOICE_CONNECT }).toBe(true)
}
