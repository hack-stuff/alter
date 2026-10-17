import { useEffect, useRef, useState } from 'react'
import { desktopApi, helper, HelperError, takeDesktopRequest, type DesktopPlanStep, type DesktopStepResult, type HelperPlatform, type HelperStatus } from '../api/desktop'
import { Icon } from '../components/Icon'

type Helper = HelperStatus | 'checking' | 'missing'
type Entry = { id: string; kind: 'goal' | 'alter' | 'step'; text: string; state?: 'waiting' | 'running' | 'done' | 'failed' | 'stopped'; detail?: string }

const ASK_KEY = 'alter.desktop.askEachStep'
const guess: HelperPlatform = /Mac/i.test(navigator.platform) ? 'macos' : /Win/i.test(navigator.platform) ? 'windows' : 'linux'
const RUN: Record<HelperPlatform, { command: string; note: string }> = {
  windows: { command: 'py %USERPROFILE%\\Downloads\\alter_helper.py', note: 'Run this in Command Prompt. The first start installs what the helper needs.' },
  macos: { command: 'python3 ~/Downloads/alter_helper.py', note: 'Run this in Terminal, then allow Terminal under System Settings → Privacy & Security → Accessibility and Screen Recording.' },
  linux: { command: 'python3 ~/Downloads/alter_helper.py', note: 'Run this in a terminal. The helper works in X11 desktop sessions.' },
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function Computer({ active }: { active: boolean }) {
  const [state, setState] = useState<Helper>('checking')
  const [code, setCode] = useState('')
  const [goal, setGoal] = useState('')
  const [askEach, setAskEach] = useState(() => { try { return localStorage.getItem(ASK_KEY) !== 'off' } catch { return true } })
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [shot, setShot] = useState('')
  const [point, setPoint] = useState<{ x: number; y: number }>()
  const [approval, setApproval] = useState<{ step: DesktopPlanStep; answer: (ok: boolean) => void }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const run = useRef<{ stopped: boolean; sessionId?: string }>(undefined)
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

  // Chat or voice may hand over a task ("open Notepad on my computer and …").
  useEffect(() => {
    const take = (value?: string) => { if (value) { setGoal(value); pendingGoal.current = value } }
    take(takeDesktopRequest())
    const listener = (event: Event) => { takeDesktopRequest(); take((event as CustomEvent<string>).detail) }
    window.addEventListener('alter:desktop-task', listener)
    return () => window.removeEventListener('alter:desktop-task', listener)
  }, [])
  useEffect(() => {
    if (ready && !running && pendingGoal.current) { const value = pendingGoal.current; pendingGoal.current = undefined; void start(value) }
  })

  const add = (entry: Omit<Entry, 'id'>) => { const id = crypto.randomUUID(); setEntries((list) => [...list, { ...entry, id }]); return id }
  const update = (id: string, patch: Partial<Entry>) => setEntries((list) => list.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))

  async function download() {
    const { default: source } = await import('../../../desktop-helper/alter_helper.py?raw')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([source], { type: 'text/x-python' }))
    link.download = 'alter_helper.py'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  async function pair() {
    setError(''); setBusy('Pairing…')
    try { await helper.pair(code); setCode(''); await check() } catch (e) { setError(e instanceof Error ? e.message : 'Pairing failed.') } finally { setBusy('') }
  }

  async function resume() {
    setError('')
    try { await helper.resume(); await check() } catch (e) { setError(e instanceof Error ? e.message : 'Could not resume.') }
  }

  function stop(reason = 'Stopped.') {
    const current = run.current
    if (!current || current.stopped) return
    current.stopped = true
    approval?.answer(false)
    if (current.sessionId) void desktopApi.stop(current.sessionId).catch(() => undefined)
    add({ kind: 'alter', text: reason })
  }

  /** Asks on the computer when the helper can show its window; otherwise here. */
  function confirmHere(step: DesktopPlanStep) {
    return new Promise<boolean>((answer) => setApproval({ step, answer: (ok) => { setApproval(undefined); answer(ok) } }))
  }

  async function perform(step: DesktopPlanStep, current: { stopped: boolean }): Promise<DesktopStepResult | 'halt'> {
    const id = add({ kind: 'step', text: step.label, detail: step.reason || undefined, state: 'running' })
    if (!step.actions.length) { update(id, { state: 'failed', detail: 'Not possible on this computer.' }); return { id: step.id, ok: false, error: 'That step is not supported on this computer. Try another way.' } }
    const target = step.actions.find((action) => typeof action.x === 'number')
    setPoint(target ? { x: target.x as number, y: target.y as number } : undefined)
    const needsOk = askEach || step.confirm
    const onComputer = needsOk && status?.confirmations !== false
    if (needsOk && !onComputer) {
      update(id, { state: 'waiting' })
      if (!(await confirmHere(step)) || current.stopped) { update(id, { state: 'stopped' }); return 'halt' }
      update(id, { state: 'running' })
    } else if (onComputer) update(id, { state: 'waiting', detail: step.reason || 'Waiting for your OK in the helper window on your computer.' })
    try {
      await helper.act(step.actions, onComputer, step.reason ? `${step.label} — ${step.reason}` : step.label)
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
    if (!text || running || !status) return
    const current: { stopped: boolean; sessionId?: string } = { stopped: false }
    run.current = current
    setRunning(true); setError(''); setEntries([]); setShot(''); setPoint(undefined)
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
        if (turn.message) add({ kind: 'alter', text: turn.message })
        if (turn.done) { current.stopped = true; break }
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
    } finally {
      current.stopped = true
      setRunning(false)
      setApproval(undefined)
      void check()
    }
  }

  const setup = RUN[status?.platform ?? guess]
  return <section className="screen computer">
    <header className="page-head with-action">
      <div><h1>Computer</h1><p className="hint">Let your Alter use this computer’s mouse and keyboard through the desktop helper.</p></div>
      {status?.paired && <span className={`helper-pill${ready ? ' is-ready' : ''}`}><span aria-hidden="true" />{status.paused ? 'Helper stopped' : 'Helper connected'}</span>}
    </header>

    {state === 'missing' && <section className="sheet computer-setup" aria-label="Set up the desktop helper">
      <h2>Set up the desktop helper</h2>
      <ol>
        <li><span>Download the helper to the computer your Alter should use.</span><button type="button" onClick={() => void download()}><Icon name="files" size={16} />Download alter_helper.py</button></li>
        <li><span>Start it. You need Python 3.9 or newer.</span><code>{setup.command}</code><span className="hint">{setup.note}</span></li>
        <li><span>Enter the six-digit code it shows. If your browser asks to reach apps on this device, choose Allow.</span></li>
      </ol>
      <p className="hint">The helper listens only on this computer and acts only for this paired page. Move the mouse into any screen corner to stop it at once.</p>
    </section>}

    {status && !status.paired && <form className="sheet computer-pair" aria-label="Pair the desktop helper" onSubmit={(e) => { e.preventDefault(); void pair() }}>
      <h2>Pair with the helper</h2>
      <p className="hint">The helper is running on this computer. Its window shows a six-digit code.</p>
      <label htmlFor="helper-code">Code shown by the helper</label>
      <div className="actions"><input id="helper-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} /><button className="primary" disabled={!!busy || code.replace(/\D/g, '').length !== 6}>{busy || 'Pair'}</button></div>
    </form>}

    {status?.paused && <div role="alert" className="notice is-error"><span>You stopped your Alter from the computer. Move the mouse away from the screen corner, then resume.</span><button type="button" onClick={() => void resume()}>Resume</button></div>}
    {error && !status?.paused && <p role="alert" className="notice is-error">{error}</p>}

    {status?.paired && <div className="computer-grid">
      <div className="stack">
        <form className="sheet computer-task" aria-label="Desktop task" onSubmit={(e) => { e.preventDefault(); void start() }}>
          <label htmlFor="desktop-goal">What should your Alter do on this computer?</label>
          <textarea id="desktop-goal" rows={3} value={goal} disabled={running} placeholder="Open Notepad and write a short to-do list for tomorrow" onChange={(e) => setGoal(e.target.value)} />
          <label className="check-label"><input type="checkbox" checked={askEach} disabled={running} onChange={(e) => { setAskEach(e.target.checked); try { localStorage.setItem(ASK_KEY, e.target.checked ? 'on' : 'off') } catch { /* per-browser preference */ } }} />Ask me before each step</label>
          <div className="actions">
            {running ? <button type="button" className="reject" onClick={() => stop()}><Icon name="stop" size={14} />Stop</button>
              : <button className="primary" disabled={!ready || !goal.trim()}><Icon name="play" size={14} />Start</button>}
            <span className="hint">{running ? 'Screenshots go to your Alter while this runs.' : 'Steps that send, buy or delete always ask first.'}</span>
          </div>
        </form>
        {approval && <section className="sheet computer-approval" role="alertdialog" aria-label="Approve this step">
          <p className="eyebrow">Your Alter wants to</p>
          <h3>{approval.step.label}</h3>
          {approval.step.reason && <p>{approval.step.reason}</p>}
          <div className="actions"><button className="primary" onClick={() => approval.answer(true)}>Allow</button><button className="reject" onClick={() => approval.answer(false)}>Stop</button></div>
        </section>}
        {entries.length > 0 && <ol className="sheet computer-log" aria-label="What your Alter did" aria-live="polite">
          {entries.map((entry) => <li key={entry.id} className={`log-${entry.kind}${entry.state ? ` is-${entry.state}` : ''}`}>
            {entry.kind === 'step' && <span className="step-state" aria-hidden="true">{entry.state === 'done' ? '✓' : entry.state === 'failed' ? '!' : entry.state === 'stopped' ? '×' : '…'}</span>}
            {entry.kind === 'alter' && <span className="alter-glyph" aria-hidden="true">✦</span>}
            <span><strong>{entry.text}</strong>{entry.detail && <span className="hint"> · {entry.detail}</span>}</span>
          </li>)}
        </ol>}
      </div>
      <figure className="sheet computer-view">
        <figcaption className="eyebrow">What your Alter sees</figcaption>
        {shot ? <div className="computer-shot"><img src={shot} alt="The latest screenshot of this computer" />{point && <span className="computer-point" style={{ left: `${point.x / 9.99}%`, top: `${point.y / 9.99}%` }} aria-hidden="true" />}</div> : <p className="hint">The screen appears here while a task runs. Nothing is captured until you press Start.</p>}
        <button type="button" className="ghost" disabled={running} onClick={() => void helper.unpair().then(check)}>Disconnect this page</button>
      </figure>
    </div>}
    {state === 'checking' && <p role="status" className="hint">Looking for the desktop helper…</p>}
  </section>
}
