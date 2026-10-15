import { useEffect, useState } from 'react'
import { api, MOCK, ApiError } from './api/client'
import { useWorkspace } from './api/useWorkspace'
import type { Approval, JoinResult } from './api/types'
import { Home } from './screens/Home'
import { Join } from './screens/Join'
import { Team } from './screens/Team'
import { Approvals } from './screens/Approvals'
import { Escalations } from './screens/Escalations'
import { Activity } from './screens/Activity'
import { Settings } from './screens/Settings'
import { Files } from './screens/Files'
import { Kiosk } from './screens/Kiosk'
import { Director } from './screens/Director'
import { Icon, Avatar } from './components/Icon'
import { Work } from './screens/Work'
import { Notifications } from './components/Notifications'
import './App.css'

type Screen = 'home' | 'work' | 'team' | 'approvals' | 'escalations' | 'activity' | 'settings' | 'files'
const SCREENS: Screen[] = ['home', 'work', 'team', 'activity', 'approvals', 'escalations', 'files', 'settings']

export default function App() {
  const parameters = new URLSearchParams(location.search)
  const inviteCode = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)$/)?.[1]
  const [session, setSession] = useState<{ join: JoinResult; name: string }>()
  const canRestore = !MOCK && (!!import.meta.env.VITE_FIREBASE_CONFIG || import.meta.env.VITE_DEV_AUTH === '1') && parameters.get('director') !== '1' && parameters.get('kiosk') !== '1'
  const [restoring, setRestoring] = useState(canRestore)
  const [restoreError, setRestoreError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  useEffect(() => {
    if (!canRestore) return
    let cancelled = false
    void api.me().then((me) => { if (!cancelled) setSession({ name: me.name, join: { workspaceId: me.workspaceId, memberId: me.memberId, slot: me.slot, inviteUrl: '' } }) }).catch((error) => {
      if (!cancelled && (!(error instanceof ApiError) || error.status !== 404)) setRestoreError('Could not restore your workspace. Please retry before creating a new one.')
    }).finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [canRestore, restoreAttempt])
  const [screen, setScreen] = useState<Screen>(parameters.has('meeting') ? 'work' : parameters.has('decision') ? 'escalations' : parameters.get('view') === 'files' ? 'files' : 'home')
  const { data, error: streamError, refresh } = useWorkspace(session?.join)
  const [overrides, setOverrides] = useState<Record<string, Approval>>({})
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  function joined(join: JoinResult, name: string) { setSession({ join, name }); setOverrides({}); setScreen('home') }
  function updateApproval(updated: Approval) { setOverrides((cards) => ({ ...cards, [updated.id]: updated })) }
  async function reset() {
    if (!session || resetting) return
    setResetting(true); setError('')
    try { joined(await api.resetWorkspace(), session.name); setGeneration((g) => g + 1); setConfirmReset(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reset your workspace. Please try again.') }
    finally { setResetting(false) }
  }
  if (parameters.get('kiosk') === '1' && (session || parameters.get('director') !== '1')) return <Kiosk memberId={parameters.get('tile') ?? 'rahul'} meetingId={parameters.get('meeting') ?? undefined} />
  if (restoring) return <main className="app join-layout"><p role="status">Opening your workspace…</p></main>
  if (restoreError && !session) return <main className="app join-layout"><p className="error" role="alert">{restoreError}</p><button onClick={() => { setRestoreError(''); setRestoring(true); setRestoreAttempt((value) => value + 1) }}>Retry sign-in</button></main>
  if (!session) return <main className="app join-layout">{MOCK && <p className="demo-banner">Demo workspace · sample data</p>}{parameters.get('director') === '1' ? <Director onJoined={joined} /> : <Join inviteCode={inviteCode} onJoined={joined} />}</main>

  const approvals = data.approvals.filter((a) => a.owner === session.join.memberId).map((a) => {
    const latest = overrides[a.id]
    return latest && (latest.revision > a.revision || (latest.revision === a.revision && a.state === 'proposed')) ? latest : a
  })
  const escalations = data.escalations.filter((e) => e.owner === session.join.memberId)
  const pending = approvals.filter((a) => a.state === 'proposed').length
  const waiting = escalations.filter((e) => e.state === 'pending').length
  const inviteUrl = data.workspace?.inviteCode ? new URL(`/join/${data.workspace.inviteCode}`, location.origin).href : session.join.inviteUrl
  return <main className="app">
    <header className="app-header"><div className="brand"><span className="brand-mark"><Icon name="sparkle" size={19} /></span>Alter<span className="hint">{data.workspace?.name ?? 'Your workspace'}</span></div><div className="header-actions"><Notifications items={data.notifications ?? []} onOpen={(path) => { const params = new URL(path, location.origin).searchParams; setScreen(params.has('meeting') ? 'work' : params.has('decision') ? 'escalations' : 'files'); if (params.has('meeting')) { sessionStorage.setItem('alter.open.meeting', params.get('meeting')!); setGeneration((g) => g + 1) } }} /><Avatar name={session.name} size="small" /></div></header>
    {MOCK && <p className="demo-banner">Demo workspace · sample answers and changes · resets on reload</p>}
    {data.workspace?.simulated && <p className="demo-banner">Local development · {data.workspace.aiBackend === 'vertex' ? 'real Vertex AI and simulated Google resources' : 'simulated AI and Google resources'} · changes persist on this server</p>}
    {data.workspace?.state === 'provisioning' && <p role="status">Setting up your team’s Google resources…</p>}
    {data.workspace?.state === 'provisioning_failed' && <p role="alert" className="error">Google setup failed. Contact the administrator or reset the workspace to try again.</p>}
    <nav className="main-nav" aria-label="Workspace"><div className="nav-wordmark"><Icon name="sparkle" size={25} />alter</div><p className="nav-section-label">Your workspace</p>{SCREENS.map((s, i) => <button className={i > 3 ? 'secondary-nav' : ''} key={s} aria-pressed={s === screen} onClick={() => { setScreen(s); setMore(false) }}><Icon name={s} size={19} /><span>{s}</span>{s === 'approvals' && pending > 0 && <span className="count">{pending}</span>}{s === 'escalations' && waiting > 0 && <span className="count">{waiting}</span>}</button>)}<button className="more-toggle" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="more" size={21} /><span>More</span>{pending + waiting > 0 && <span className="count">{pending + waiting}</span>}</button>{more && <div className="mobile-more-menu">{SCREENS.slice(4).map((s) => <button key={s} aria-pressed={s === screen} onClick={() => { setScreen(s); setMore(false) }}><Icon name={s} size={18} /><span>{s}</span>{s === 'approvals' && pending > 0 && <span className="count">{pending}</span>}{s === 'escalations' && waiting > 0 && <span className="count">{waiting}</span>}</button>)}</div>}<div className="nav-footer"><Avatar name={session.name} size="small" /><span>{session.name}<br /><small>Your personal workspace</small></span></div></nav>
    {streamError && <div role="alert" className="error"><p>{streamError}</p><button onClick={refresh}>Retry workspace updates</button></div>}
    {confirmReset && <section className="reset-confirmation" aria-label="Reset confirmation"><p>Reset this workspace to its starting state? Your current conversation and changes will be cleared.</p><div className="actions"><button onClick={() => void reset()} disabled={resetting}>{resetting ? 'Resetting…' : 'Confirm reset'}</button><button disabled={resetting} onClick={() => { setConfirmReset(false); setError('') }}>Cancel</button></div>{error && <p role="alert" className="error">{error}</p>}</section>}
    <div key={generation}>
      <div hidden={screen !== 'home'}><Home key={session.join.workspaceId} active={screen === 'home'} name={session.name} workspaceId={session.join.workspaceId} approvals={approvals} events={data.events} onUpdate={updateApproval} /></div>
      {screen === 'work' && <Work key={session.join.workspaceId} members={data.members} memberId={session.join.memberId} initialId={parameters.get('meeting') ?? undefined} />}
      {screen === 'team' && <Team members={data.members} memberId={session.join.memberId} inviteUrl={inviteUrl} workspaceId={session.join.workspaceId} />}
      {screen === 'approvals' && <Approvals approvals={approvals} onUpdate={updateApproval} />}
      {screen === 'escalations' && <Escalations items={escalations} members={data.members} onRefresh={refresh} />}
      {screen === 'activity' && <Activity items={data.activity} receipts={data.receipts} members={data.members} escalations={escalations} traces={data.traces} since={data.members.find((m) => m.id === session.join.memberId)?.digestSince ?? data.members.find((m) => m.id === session.join.memberId)?.awaySince} />}
      {screen === 'settings' && <><Settings memories={data.memories.filter((m) => m.owner === session.join.memberId)} rules={data.rules} me={data.members.find((m) => m.id === session.join.memberId)} onRefresh={refresh} /><button onClick={() => setConfirmReset(true)} disabled={resetting}>Reset workspace</button></>}
      {screen === 'files' && <Files workspace={data.workspace} inbox={data.inbox} members={data.members} />}
    </div>
    <footer className="connected-apps" aria-label="Workspace apps">Docs · Drive · Sheets · Calendar · Gmail</footer>
  </main>
}
