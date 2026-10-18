import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { desktopApi, helper, HelperError, onDesktopVoice, takeDesktopRequest, voiceCommand, type DesktopPlanStep, type DesktopStepResult, type HelperPlatform, type HelperStatus, type VoiceCommand } from '../api/desktop'
import { Icon } from '../components/Icon'
import { voiceDock, type DockSnapshot } from '../live/dock'

type Helper = HelperStatus | 'checking' | 'missing'
type Entry = { id: string; kind: 'goal' | 'alter' | 'step'; text: string; state?: 'waiting' | 'running' | 'done' | 'failed' | 'stopped' | 'skipped'; detail?: string }
type Approval = { step: DesktopPlanStep; answer: (choice: VoiceCommand) => void }

const ASK_KEY = 'alter.desktop.askEachStep'
const guess: HelperPlatform = /Mac/i.test(navigator.platform) ? 'macos' : /Win/i.test(navigator.platform) ? 'windows' : 'linux'
const RUN: Record<HelperPlatform, { command: string; note: string }> = {
  windows: { command: 'py %USERPROFILE%\\Downloads\\alter_helper.py', note: 'Run this in Command Prompt. The first start installs what the helper needs.' },
  macos: { command: 'python3 ~/Downloads/alter_helper.py', note: 'Run this in Terminal, then allow Terminal under System Settings → Privacy & Security → Accessibility and Screen Recording.' },
  linux: { command: 'python3 ~/Downloads/alter_helper.py', note: 'Run this in a terminal. The helper works in X11 desktop sessions.' },
}
// Bundled builds, served by the site once fetched from CI (apps/desktop-helper/fetch-builds.sh).
// A command-line download skips the browser's "downloaded from the internet" warnings.
const SITE = window.location.origin
const BUILD: Record<HelperPlatform, { name: string; file: string; command: string; note: string }> = {
  windows: { name: 'Windows', file: 'alter-helper-windows.exe', command: `curl.exe -fLo %USERPROFILE%\\alter-helper.exe ${SITE}/downloads/alter-helper-windows.exe && %USERPROFILE%\\alter-helper.exe`, note: 'Open the downloaded file. If Windows says it protected your PC, choose More info, then Run anyway. Or paste this into Command Prompt instead:' },
  macos: { name: 'Mac', file: 'alter-helper-macos-arm64', command: `curl -fLo ~/alter-helper ${SITE}/downloads/alter-helper-macos-$(uname -m) && chmod +x ~/alter-helper && ~/alter-helper`, note: 'Paste this into Terminal. Then allow Terminal under System Settings → Privacy & Security → Accessibility and Screen Recording, quit Terminal, and run ~/alter-helper again.' },
  linux: { name: 'Linux', file: 'alter-helper-linux-x86_64', command: `curl -fLo ~/alter-helper ${SITE}/downloads/alter-helper-linux-x86_64 && chmod +x ~/alter-helper && ~/alter-helper`, note: 'Paste this into a terminal. The helper works in X11 desktop sessions.' },
}
/** The site answers missing files with its own small HTML page; a real build is neither. */
async function hasBuild(file: string) {
  try {
    const response = await fetch(`/downloads/${file}`, { method: 'HEAD', cache: 'no-store' })
    const size = response.headers.get('Content-Length') // Hosting may leave it out.
    return response.ok && !(response.headers.get('Content-Type') ?? '').includes('text/html') && (size === null || Number(size) > 1_000_000)
  } catch { return false }
}
// Chrome's Document Picture-in-Picture keeps a small window above every app, so the owner can
// follow and stop the Alter while it works in other programs.
type PipHost = Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } }
const pip = (window as PipHost).documentPictureInPicture
function dress(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement('style')
      style.textContent = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')
      target.document.head.append(style)
    } catch {
      if (!sheet.href) continue
      const link = target.document.createElement('link')
      link.rel = 'stylesheet'; link.href = sheet.href
      target.document.head.append(link)
    }
  }
  const theme = document.documentElement.dataset.theme
  if (theme) target.document.documentElement.dataset.theme = theme
  target.document.title = 'Alter'
  target.document.documentElement.style.background = 'var(--sheet)'
  target.document.body.className = 'float-body'
}

function FloatPanel(props: { voice: DockSnapshot; running: boolean; ready: boolean; doing: string; last: string; approval?: Approval; queue: string[]; onStop: () => void }) {
  const { voice, approval } = props
  const voiceState = voice.state === 'listening' && voice.muted ? 'muted' : voice.state
  const voiceLabel = { closed: 'Voice off', connecting: 'Connecting…', speaking: 'Speaking', listening: 'Listening', muted: 'Muted' }[voiceState]
  const line = props.running ? (props.doing ? `Doing: ${props.doing}` : 'Looking at the screen…')
    : props.last || (props.ready ? 'Say “on my computer, …” to give me a task.' : 'The desktop helper isn’t connected.')
  return <div className="float-panel" role="region" aria-label="Alter controls">
    <header><span className="alter-glyph" aria-hidden="true">✦</span><strong>Alter</strong><span className={`float-voice is-${voiceState}`}>{voiceLabel}</span></header>
    {approval ? <div className="float-approval" role="alertdialog" aria-label="Allow this step?">
      <p><strong>{approval.step.label}</strong>{approval.step.reason && <span className="hint">{approval.step.reason}</span>}</p>
      <div className="actions"><button type="button" className="primary" onClick={() => approval.answer('allow')}>Allow</button><button type="button" onClick={() => approval.answer('skip')}>Skip</button><button type="button" className="reject" onClick={() => approval.answer('stop')}>Stop</button></div>
    </div> : <p className="float-status" aria-live="polite">{line}</p>}
    {props.queue.length > 0 && <p className="hint float-next">Next: {props.queue[0]}{props.queue.length > 1 ? ` (+${props.queue.length - 1} more)` : ''}</p>}
    <div className="float-actions">
      {voice.state === 'closed' ? <button type="button" onClick={() => voiceDock.start()}><Icon name="mic" size={14} />Start voice</button> : <>
        <button type="button" aria-pressed={voice.muted} onClick={() => voiceDock.mute(!voice.muted)}><Icon name={voice.muted ? 'mic' : 'micOff'} size={14} />{voice.muted ? 'Unmute' : 'Mute'}</button>
        <button type="button" onClick={() => voiceDock.end()}>Stop</button>
      </>}
      {props.running && <button type="button" className="reject" onClick={props.onStop}><Icon name="stop" size={12} />Stop task</button>}
    </div>
  </div>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function Computer({ active }: { active: boolean }) {
  const [state, setState] = useState<Helper>('checking')
  const [code, setCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [goal, setGoal] = useState('')
  // Off by default: the Alter still asks before anything that sends, posts, buys or deletes.
  const [askEach, setAskEach] = useState(() => { try { return localStorage.getItem(ASK_KEY) === 'on' } catch { return false } })
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [shot, setShot] = useState('')
  const [point, setPoint] = useState<{ x: number; y: number }>()
  const [approval, setApproval] = useState<Approval>()
  const [queue, setQueue] = useState<string[]>([])
  const [doing, setDoing] = useState('')
  const [last, setLast] = useState('')
  const [floating, setFloating] = useState<Window>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [system, setSystem] = useState<HelperPlatform>(guess)
  const [builds, setBuilds] = useState<Partial<Record<HelperPlatform, boolean>>>({})
  const [copied, setCopied] = useState(false)
  const voice = useSyncExternalStore(voiceDock.subscribe, voiceDock.get)
  const run = useRef<{ stopped: boolean; sessionId?: string }>(undefined)
  const runningRef = useRef(false)
  const approvalRef = useRef<Approval>(undefined)
  const queueRef = useRef<string[]>([])
  const pendingGoal = useRef<string | undefined>(undefined)
  const status = typeof state === 'object' ? state : undefined
  const ready = !!status?.paired && !status.paused

  async function check() {
    try { setState(await helper.status()) } catch { setState('missing') }
  }
  useEffect(() => {
    if (!active || running) return
    // oxlint-disable-next-line react/set-state-in-effect -- Polls the helper, an external process.
    void check()
    const timer = setInterval(() => void check(), 3000)
    return () => clearInterval(timer)
  }, [active, running])

  function setQueued(list: string[]) { queueRef.current = list; setQueue(list) }
  function setPending(value?: Approval) { approvalRef.current = value; setApproval(value) }

  // Chat or voice hands over tasks ("on my computer, open Notepad and …"); one arriving
  // while another runs waits its turn.
  useEffect(() => {
    const take = (value?: string) => {
      if (!value) return
      if (runningRef.current) { setQueued([...queueRef.current, value]); voiceDock.announce(`I'll do that next: ${value}`); return }
      setGoal(value); pendingGoal.current = value
    }
    take(takeDesktopRequest())
    const listener = (event: Event) => { takeDesktopRequest(); take((event as CustomEvent<string>).detail) }
    window.addEventListener('alter:desktop-task', listener)
    return () => window.removeEventListener('alter:desktop-task', listener)
  }, [])
  useEffect(() => {
    if (ready && !running && pendingGoal.current) { const value = pendingGoal.current; pendingGoal.current = undefined; void start(value) }
  })

  // Saying "allow", "skip" or "stop" answers the step waiting for approval, or stops the task.
  const stopRef = useRef(stop)
  useEffect(() => { stopRef.current = stop })
  useEffect(() => onDesktopVoice((text) => {
    const command = voiceCommand(text)
    if (!command) return
    if (approvalRef.current) approvalRef.current.answer(command)
    else if (command === 'stop' && runningRef.current) stopRef.current('Stopped when you said stop.')
  }), [])

  useEffect(() => () => floating?.close(), [floating])

  const build = BUILD[system]
  const bundled = builds[system]
  useEffect(() => {
    if (state !== 'missing' || bundled !== undefined) return
    void hasBuild(build.file).then((found) => setBuilds((known) => ({ ...known, [system]: found })))
  }, [state, system, bundled, build.file])

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the command stays visible to copy by hand */ }
  }

  const add = (entry: Omit<Entry, 'id'>) => { const id = crypto.randomUUID(); setEntries((list) => [...list, { ...entry, id }]); return id }
  const update = (id: string, patch: Partial<Entry>) => setEntries((list) => list.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))

  function save(href: string, name: string) {
    const link = document.createElement('a')
    link.href = href
    link.download = name
    link.click()
  }

  async function download() {
    const { default: source } = await import('../../../desktop-helper/alter_helper.py?raw')
    const href = URL.createObjectURL(new Blob([source], { type: 'text/x-python' }))
    save(href, 'alter_helper.py')
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  /** The person at the computer allows this page in a helper window; no code to type. */
  async function connect() {
    setError(''); setBusy('Waiting for Allow on this computer…')
    try { await helper.connect(); await check() } catch (e) {
      const failure = e instanceof HelperError ? e : undefined
      // Helpers before 1.1 and those without a window only pair by code.
      if (failure && ['NOT_FOUND', 'CONFIRM_UNAVAILABLE', 'TOO_MANY_REQUESTS'].includes(failure.code)) { setShowCode(true); setError(failure.code === 'NOT_FOUND' ? 'This helper only pairs with a code. Enter the six-digit code it shows.' : failure.message) }
      else setError(e instanceof Error ? e.message : 'Could not connect.')
    } finally { setBusy('') }
  }

  async function pair() {
    setError(''); setBusy('Pairing…')
    try { await helper.pair(code); setCode(''); await check() } catch (e) { setError(e instanceof Error ? e.message : 'Pairing failed.') } finally { setBusy('') }
  }

  async function resume() {
    setError('')
    try { await helper.resume(); await check() } catch (e) { setError(e instanceof Error ? e.message : 'Could not resume.') }
  }

  /** Opens the floating controls; browsers allow it only right after a click. */
  async function float() {
    if (!pip || floating) return
    try {
      const target = await pip.requestWindow({ width: 360, height: 230 })
      dress(target)
      target.addEventListener('pagehide', () => setFloating(undefined))
      setFloating(target)
    } catch { /* Without a click it is refused; the button stays on the page. */ }
  }

  function stop(reason = 'Stopped.') {
    const current = run.current
    if (!current || current.stopped) return
    current.stopped = true
    setQueued([])
    approvalRef.current?.answer('stop')
    if (current.sessionId) void desktopApi.stop(current.sessionId).catch(() => undefined)
    add({ kind: 'alter', text: reason })
    setLast(reason)
  }

  function confirmHere(step: DesktopPlanStep) {
    return new Promise<VoiceCommand>((answer) => setPending({ step, answer: (choice) => { setPending(undefined); answer(choice) } }))
  }

  async function perform(step: DesktopPlanStep, current: { stopped: boolean }): Promise<DesktopStepResult | 'halt'> {
    const id = add({ kind: 'step', text: step.label, detail: step.reason || undefined, state: 'running' })
    setDoing(step.label)
    if (!step.actions.length) { update(id, { state: 'failed', detail: 'Not possible on this computer.' }); return { id: step.id, ok: false, error: 'That step is not supported on this computer. Try another way.' } }
    const target = step.actions.find((action) => typeof action.x === 'number')
    setPoint(target ? { x: target.x as number, y: target.y as number } : undefined)
    if (askEach || step.confirm) {
      update(id, { state: 'waiting' })
      voiceDock.announce(`I need your OK for this step: ${step.label}${step.reason ? `. ${step.reason}` : ''}. Say allow, skip or stop.`)
      const choice = await confirmHere(step)
      if (choice === 'stop' || current.stopped) { update(id, { state: 'stopped' }); return 'halt' }
      if (choice === 'skip') { update(id, { state: 'skipped', detail: 'Skipped' }); return { id: step.id, ok: false, error: 'The owner skipped this step. Do not repeat it; find another way or finish.' } }
      update(id, { state: 'running' })
    }
    try {
      await helper.act(step.actions, false, step.reason ? `${step.label} — ${step.reason}` : step.label)
      update(id, { state: 'done', detail: undefined })
      return { id: step.id, ok: true, acknowledged: step.confirm }
    } catch (e) {
      const failure = e instanceof HelperError ? e : new HelperError('The helper could not do that.', 0, '')
      if (['DECLINED', 'PAUSED', 'NOT_PAIRED', 'UNREACHABLE'].includes(failure.code)) {
        update(id, { state: 'stopped', detail: failure.message })
        if (failure.code !== 'DECLINED') setError(failure.message)
        return 'halt'
      }
      update(id, { state: 'failed', detail: failure.message })
      return { id: step.id, ok: false, error: failure.message.slice(0, 300) }
    }
  }

  async function start(task = goal) {
    const text = task.trim()
    if (!text || runningRef.current || !status) return
    const current: { stopped: boolean; sessionId?: string } = { stopped: false }
    run.current = current
    runningRef.current = true
    setRunning(true); setError(''); setEntries([]); setShot(''); setPoint(undefined); setDoing(''); setLast(''); setGoal(text)
    add({ kind: 'goal', text })
    try {
      const session = await desktopApi.start(text, status.platform)
      current.sessionId = session.sessionId
      let results: DesktopStepResult[] = []
      while (!current.stopped) {
        const screen = await helper.screenshot()
        setShot(`data:${screen.mimeType};base64,${screen.image}`); setPoint(undefined)
        if (current.stopped) break
        const turn = await desktopApi.step(session.sessionId, screen, results)
        if (current.stopped) break
        if (turn.message) { add({ kind: 'alter', text: turn.message }); setLast(turn.message) }
        if (turn.done) { current.stopped = true; voiceDock.announce(turn.message || 'That task is done.'); break }
        results = []
        for (const step of turn.steps) {
          const result = await perform(step, current)
          if (result === 'halt') { stop('Stopped. Nothing else was done.'); break }
          results.push(result)
        }
        await sleep(700) // Let the screen settle before the next look.
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Desktop control stopped.'
      setError(message)
      stop('Stopped because something went wrong.')
      voiceDock.announce(`I stopped the computer task: ${message}`)
    } finally {
      current.stopped = true
      runningRef.current = false
      setRunning(false)
      setPending(undefined)
      setDoing('')
      void check()
      // The loop: the next queued request starts as soon as this one ends.
      const [next, ...rest] = queueRef.current
      if (next) { setQueued(rest); setGoal(next); pendingGoal.current = next }
    }
  }

  const setup = RUN[system]
  const answer = (choice: VoiceCommand) => approval?.answer(choice)
  return <section className="screen computer">
    <header className="page-head with-action">
      <div><h1>Computer</h1><p className="hint">Let your Alter use this computer’s mouse and keyboard through the desktop helper.</p></div>
      <div className="actions">
        {pip && status?.paired && !floating && <button type="button" className="ghost" onClick={() => void float()}><Icon name="computer" size={14} />Float controls</button>}
        {status?.paired && <span className={`helper-pill${ready ? ' is-ready' : ''}`}><span aria-hidden="true" />{status.paused ? 'Helper stopped' : 'Helper connected'}</span>}
      </div>
    </header>

    {state === 'missing' && <section className="sheet computer-setup" aria-label="Set up the desktop helper">
      <div className="setup-head">
        <h2>Set up the desktop helper</h2>
        <label className="setup-system">For<select value={system} onChange={(e) => setSystem(e.target.value as HelperPlatform)}>{(Object.keys(BUILD) as HelperPlatform[]).map((key) => <option key={key} value={key}>{BUILD[key].name}</option>)}</select></label>
      </div>
      {bundled ? <ol>
        <li>
          <span>Get the helper on the computer your Alter should use. Nothing else to install.</span>
          {system === 'windows' && <button type="button" onClick={() => save(`/downloads/${build.file}`, build.file)}><Icon name="files" size={16} />Download for Windows</button>}
          <span className="hint">{build.note}</span>
          <div className="setup-command"><code>{build.command}</code><button type="button" className="ghost small" onClick={() => void copy(build.command)}>{copied ? 'Copied' : 'Copy'}</button></div>
        </li>
        <li><span>Come back here and press Connect. If your browser asks to reach apps on this device, choose Allow.</span></li>
      </ol> : <ol>
        <li><span>Download the helper to the computer your Alter should use.</span><button type="button" onClick={() => void download()}><Icon name="files" size={16} />Download alter_helper.py</button></li>
        <li><span>Start it. You need Python 3.9 or newer from python.org.</span><code>{setup.command}</code><span className="hint">{setup.note}</span></li>
        <li><span>Come back here and press Connect. If your browser asks to reach apps on this device, choose Allow.</span></li>
      </ol>}
      {bundled && <details className="setup-script"><summary>Use the Python script instead</summary><button type="button" onClick={() => void download()}><Icon name="files" size={16} />Download alter_helper.py</button><code>{setup.command}</code></details>}
      <p className="hint">The helper listens only on this computer and acts only for this paired page. Move the mouse into any screen corner to stop it at once.</p>
    </section>}

    {status && !status.paired && <section className="sheet computer-pair" aria-label="Connect the desktop helper">
      <h2>Connect the helper</h2>
      {status.confirmations && !showCode ? <>
        <p className="hint">The helper is running on this computer. Press Connect, then choose Allow in the window it opens.</p>
        <div className="actions"><button type="button" className="primary" disabled={!!busy} onClick={() => void connect()}>{busy || 'Connect'}</button><button type="button" className="ghost" onClick={() => setShowCode(true)}>Use a code instead</button></div>
      </> : <form aria-label="Pair the desktop helper" onSubmit={(e) => { e.preventDefault(); void pair() }}>
        <label htmlFor="helper-code">Code shown by the helper</label>
        <div className="actions"><input id="helper-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} /><button className="primary" disabled={!!busy || code.replace(/\D/g, '').length !== 6}>{busy || 'Pair'}</button></div>
      </form>}
    </section>}

    {status?.paused && <div role="alert" className="notice is-error"><span>You stopped your Alter from the computer. Move the mouse away from the screen corner, then resume.</span><button type="button" onClick={() => void resume()}>Resume</button></div>}
    {error && !status?.paused && <p role="alert" className="notice is-error">{error}</p>}

    {status?.paired && <div className="computer-grid">
      <div className="stack">
        <form className="sheet computer-task" aria-label="Desktop task" onSubmit={(e) => { e.preventDefault(); void float(); void start() }}>
          <label htmlFor="desktop-goal">What should your Alter do on this computer?</label>
          <textarea id="desktop-goal" rows={3} value={goal} disabled={running} placeholder="Open Notepad and write a short to-do list for tomorrow" onChange={(e) => setGoal(e.target.value)} />
          <label className="check-label"><input type="checkbox" checked={askEach} disabled={running} onChange={(e) => { setAskEach(e.target.checked); try { localStorage.setItem(ASK_KEY, e.target.checked ? 'on' : 'off') } catch { /* per-browser preference */ } }} />Ask before every step</label>
          <div className="actions">
            {running ? <button type="button" className="reject" onClick={() => stop()}><Icon name="stop" size={14} />Stop</button>
              : <button className="primary" disabled={!ready || !goal.trim()}><Icon name="play" size={14} />Start</button>}
            <span className="hint">{running ? 'Say “stop” or press Stop at any time.' : 'Your Alter asks only before steps that send, post, buy or delete.'}</span>
          </div>
          {queue.length > 0 && <p className="hint">Next: {queue.join(' · ')}</p>}
        </form>
        {approval && <section className="sheet computer-approval" role="alertdialog" aria-label="Approve this step">
          <p className="eyebrow">Your Alter wants to</p>
          <h3>{approval.step.label}</h3>
          {approval.step.reason && <p>{approval.step.reason}</p>}
          <div className="actions"><button className="primary" onClick={() => answer('allow')}>Allow</button><button onClick={() => answer('skip')}>Skip</button><button className="reject" onClick={() => answer('stop')}>Stop</button><span className="hint">Or say allow, skip or stop.</span></div>
        </section>}
        {entries.length > 0 && <ol className="sheet computer-log" aria-label="What your Alter did" aria-live="polite">
          {entries.map((entry) => <li key={entry.id} className={`log-${entry.kind}${entry.state ? ` is-${entry.state}` : ''}`}>
            {entry.kind === 'step' && <span className="step-state" aria-hidden="true">{entry.state === 'done' ? '✓' : entry.state === 'failed' ? '!' : entry.state === 'stopped' ? '×' : entry.state === 'skipped' ? '–' : '…'}</span>}
            {entry.kind === 'alter' && <span className="alter-glyph" aria-hidden="true">✦</span>}
            <span><strong>{entry.text}</strong>{entry.detail && <span className="hint"> · {entry.detail}</span>}</span>
          </li>)}
        </ol>}
      </div>
      <figure className="sheet computer-view">
        <figcaption className="eyebrow">What your Alter sees</figcaption>
        {shot ? <div className="computer-shot"><img src={shot} alt="The latest screenshot of this computer" />{point && <span className="computer-point" style={{ left: `${point.x / 9.99}%`, top: `${point.y / 9.99}%` }} aria-hidden="true" />}</div> : <p className="hint">The screen appears here while a task runs. Nothing is captured until a task starts.</p>}
        <button type="button" className="ghost" disabled={running} onClick={() => void helper.unpair().then(check)}>Disconnect this page</button>
      </figure>
    </div>}
    {state === 'checking' && <p role="status" className="hint">Looking for the desktop helper…</p>}
    {floating && createPortal(<FloatPanel voice={voice} running={running} ready={ready} doing={doing} last={last} approval={approval} queue={queue} onStop={() => stop('Stopped.')} />, floating.document.body)}
  </section>
}
