// Ambient voice for the Alter surface — it speaks (speech synthesis) and it
// listens (continuous recognition). The rehearsal/mock build uses the
// browser's own engines; the deployed build drives conversations through the
// Gemini Live relay instead (VoiceControl autoStart) and skips this listener.

let muted = false

export function setVoiceMuted(value: boolean) {
  muted = value
  if (value && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}

export function isVoiceMuted() { return muted }

function preferredVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => /Google US English|Samantha|Daniel|Aria|Jenny/i.test(v.name)) ?? voices.find((v) => v.lang?.startsWith('en'))
}

export function speak(text: string, handlers?: { onStart?: () => void; onEnd?: () => void }) {
  if (muted || !('speechSynthesis' in window) || !text.trim()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.04
  utterance.pitch = 1.0
  const voice = preferredVoice()
  if (voice) utterance.voice = voice
  if (handlers?.onStart) utterance.onstart = handlers.onStart
  utterance.onend = () => handlers?.onEnd?.()
  utterance.onerror = () => handlers?.onEnd?.()
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

export interface ListeningHandlers {
  onFinal: (phrase: string) => void
  onInterim?: (phrase: string) => void
  onState?: (state: 'listening' | 'unsupported') => void
}

const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']

export function listen(handlers: ListeningHandlers): () => void {
  const Recognition = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition
  if (!Recognition) { handlers.onState?.('unsupported'); return () => {} }
  const recognition = new (Recognition as new () => {
    continuous: boolean
    interimResults: boolean
    lang: string
    onresult: (event: { resultIndex: number; results: { isFinal: boolean; 0?: { transcript?: string } }[] }) => void
    onend: () => void
    onerror: (event: { error?: string }) => void
    start: () => void
    abort: () => void
  })()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'
  let stopped = false
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const phrase = (result[0]?.transcript ?? '').trim()
      if (!phrase) continue
      if (result.isFinal) handlers.onFinal(phrase)
      else handlers.onInterim?.(phrase)
    }
  }
  recognition.onend = () => { if (!stopped) { try { recognition.start() } catch { /* restarting is best-effort */ } } }
  recognition.onerror = (event) => { if (FATAL_ERRORS.includes(event.error ?? '')) stopped = true }
  try { recognition.start(); handlers.onState?.('listening') } catch { handlers.onState?.('unsupported') }
  return () => { stopped = true; try { recognition.abort() } catch { /* already stopped */ } }
}
