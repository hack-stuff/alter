// A page keeps one audio output context so a permission gesture also covers
// later voice sessions and navigation. Microphone streams still end on stop.
let output: AudioContext | undefined

export function voiceAudio(): AudioContext {
  if (!output || output.state === 'closed') output = new AudioContext()
  return output
}

export function unlockVoiceAudio() {
  try { void voiceAudio().resume().catch(() => {}) } catch { /* The voice control presents the actionable error. */ }
}

export async function startVoiceAudio(): Promise<AudioContext> {
  const context = voiceAudio()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Click Enable voice to allow sound, then allow microphone access.')), 1500) }),
    ])
    if (context.state !== 'running') throw new Error('Click Enable voice to allow sound, then allow microphone access.')
    return context
  } finally { clearTimeout(timer) }
}

export function pauseVoiceAudio(context: AudioContext) {
  if (context.state !== 'closed') void context.suspend().catch(() => {})
}

export function installVoiceAudioUnlock() {
  const unlock = () => unlockVoiceAudio()
  document.addEventListener('pointerdown', unlock, { capture: true })
  document.addEventListener('keydown', unlock, { capture: true })
}
