import { useEffect, useState } from 'react'
import { api, MOCK, ApiError } from './api/client'
import { useWorkspace } from './api/useWorkspace'
import type { Approval, JoinResult } from './api/types'
import { Alter } from './screens/Alter'
import { MeetCompanion } from './screens/MeetCompanion'
import { PlanCanvas } from './screens/PlanCanvas'
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
import './fx.css'

type Screen = 'alter' | 'meet' | 'plan' | 'work' | 'team' | 'approvals' | 'escalations' | 'activity' | 'settings' | 'files'

// The product's front door is the Alter itself. Everything else is a quiet
// workbench behind "More" — for the rehearsal team and curious judges, not the main flow.
const WORKBENCH: { id: Screen; label: string; icon: string; count?: 'approvals' | 'escalations' }[] = [
  { id: 'alter', label: 'Ask & delegate', icon: 'mic' },
  { id: 'meet', label: 'Live: Team sync', icon: 'work' },
  { id: 'plan', label: 'Shared plan', icon: 'files' },
  { id: 'approvals', label: 'Waiting on you', icon: 'approvals', count: 'approvals' },
  { id: 'escalations', label: 'Team decisions', icon: 'escalations', count: 'escalations' },
  { id: 'team', label: "The team's Alters", icon: 'team' },
  { id: 'activity', label: 'Work log', icon: 'activity' },
  { id: 'work', label: 'Meetings', icon: 'work' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'settings', label: 'Rules & memory', icon: 'settings' },
]

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
      if (!cancelled && (!(error instanceof ApiError) || error.status !== 404)) setRestoreError('Could not restore your Alter. Please retry before creating a new one.')
    }).finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [canRestore, restoreAttempt])
  const [screen, setScreen] = useState<Screen>(
    parameters.has('meeting') ? 'work' : parameters.has('decision') ? 'escalations' : parameters.get('view') === 'files' ? 'files' : 'alter'
  )
  const { data, error: streamError, refresh } = useWorkspace(session?.join)
  const [overrides, setOverrides] = useState<Record<string, Approval>>({})
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  function joined(join: JoinResult, name: string) { setSession({ join, name }); setOverrides({}); setScreen('alter') }
  function updateApproval(updated: Approval) { setOverrides((cards) => ({ ...cards, [updated.id]: updated })) }
  async function reset() {
    if (!session || resetting) return
    setResetting(true); setError('')
    try { joined(await api.resetWorkspace(), session.name); setGeneration((g) => g + 1); setConfirmReset(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reset this Alter. Please try again.') }
    finally { setResetting(false) }
  }
  if (parameters.get('kiosk') === '1' && (session || parameters.get('director') !== '1')) return <Kiosk memberId={parameters.get('tile') ?? 'rahul'} meetingId={parameters.get('meeting') ?? undefined} />
  if (restoring) return <main className="app join-layout"><p role="status">Opening your Alter…</p></main>
  if (restoreError && !session) return <main className="app join-layout"><p className="error" role="alert">{restoreError}</p><button onClick={() => { setRestoreError(''); setRestoring(true); setRestoreAttempt((value) => value + 1) }}>Retry sign-in</button></main>
  if (!session) return <main className={`app join-layout${parameters.get('director') === '1' ? '' : ' join-fx-page'}`}>{parameters.get('director') === '1' ? <Director onJoined={joined} /> : <Join inviteCode={inviteCode} onJoined={joined} />}</main>

  const approvals = data.approvals.filter((a) => a.owner === session.join.memberId).map((a) => {
    const latest = overrides[a.id]
    return latest && (latest.revision > a.revision || (latest.revision === a.revision && a.state === 'proposed')) ? latest : a
  })
  const escalations = data.escalations.filter((e) => e.owner === session.join.memberId)
  const pending = approvals.filter((a) => a.state === 'proposed').length
  const waiting = escalations.filter((e) => e.state === 'pending').length
  const inviteUrl = data.workspace?.inviteCode ? new URL(`/join/${data.workspace.inviteCode}`, location.origin).href : session.join.inviteUrl
  const meMember = data.members.find((m) => m.id === session.join.memberId)

  function workbenchButton(item: { id: Screen; label: string; icon: string; count?: 'approvals' | 'escalations' }) {
    return <button
      key={item.id}
      aria-pressed={screen === item.id}
      onClick={() => { setScreen(item.id); setMore(false) }}
    >
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
      {item.count === 'approvals' && pending > 0 && <span className="count">{pending}</span>}
      {item.count === 'escalations' && waiting > 0 && <span className="count">{waiting}</span>}
    </button>
  }

  const stageView = screen === 'meet' || screen === 'plan'
  return <main className="app">
    {!stageView && <header className="app-header">
      <div className="brand" onClick={() => setScreen('alter')} style={{ cursor: 'pointer' }}>
        <span className="brand-mark"><Icon name="sparkle" size={19} /></span>Alter
        <span className="hint">Your AI representative at work</span>
      </div>
      <div className="header-actions">
        <nav className="app-nav" aria-label="Alter">
          <button className="app-nav-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
            <Icon name="more" size={20} />
            <span>More ({WORKBENCH.length})</span>
          </button>
          {more && <div className="app-nav-menu">{WORKBENCH.map(workbenchButton)}</div>}
        </nav>
        <Notifications items={data.notifications ?? []} onOpen={(path) => { const params = new URL(path, location.origin).searchParams; setScreen(params.has('meeting') ? 'work' : params.has('decision') ? 'escalations' : 'files'); if (params.has('meeting')) { sessionStorage.setItem('alter.open.meeting', params.get('meeting')!); setGeneration((g) => g + 1) } }} />
        <Avatar name={session.name} size="small" />
      </div>
    </header>}

    {data.workspace?.simulated && <p className="demo-banner">Local development · {data.workspace.aiBackend === 'vertex' ? 'real Vertex AI and simulated Google resources' : 'simulated AI and Google resources'} · changes persist on this server</p>}
    {!stageView && data.workspace?.state === 'provisioning' && <p role="status">Your Alter is connecting to your team’s Google resources…</p>}
    {!stageView && data.workspace?.state === 'provisioning_failed' && <p role="alert" className="error">Google setup failed. Reset the demo or contact the administrator to try again.</p>}

    {streamError && <div role="alert" className="error"><p>{streamError}</p><button onClick={refresh}>Retry updates</button></div>}
    {confirmReset && <section className="reset-confirmation" aria-label="Reset confirmation"><p>Reset this Alter to its starting state? Its conversation, proposals and changes will be cleared.</p><div className="actions"><button onClick={() => void reset()} disabled={resetting}>{resetting ? 'Resetting…' : 'Confirm reset'}</button><button disabled={resetting} onClick={() => { setConfirmReset(false); setError('') }}>Cancel</button></div>{error && <p role="alert" className="error">{error}</p>}</section>}

    <div key={generation}>
      <div hidden={screen !== 'alter'}>
        <Alter
          name={session.name}
          workspaceId={session.join.workspaceId}
          members={data.members}
          approvals={approvals}
          escalations={escalations}
          events={data.events}
          active={screen === 'alter'}
          ready={MOCK || data.workspace?.state === 'ready'}
          onUpdate={updateApproval}
          onRefresh={refresh}
          onOpen={(s) => setScreen(s)}
        />
      </div>
      {screen === 'meet' && (
        <MeetCompanion
          members={data.members}
          owner={session.name}
          workspaceId={session.join.workspaceId}
          memberId={session.join.memberId}
          onReview={(id) => { sessionStorage.setItem('alter.open.meeting', id); setScreen('work'); setGeneration((g) => g + 1) }}
          onBack={() => setScreen('alter')}
        />
      )}
      {screen === 'plan' && (
        <PlanCanvas
          members={data.members}
          onBack={() => setScreen('alter')}
          onApproveDoc={() => { refresh() }}
        />
      )}
      {screen === 'work' && <Work key={session.join.workspaceId} members={data.members} memberId={session.join.memberId} initialId={parameters.get('meeting') ?? undefined} />}
      {screen === 'team' && <Team members={data.members} memberId={session.join.memberId} inviteUrl={inviteUrl} workspaceId={session.join.workspaceId} />}
      {screen === 'approvals' && <Approvals approvals={approvals} onUpdate={updateApproval} />}
      {screen === 'escalations' && <Escalations items={escalations} members={data.members} onRefresh={refresh} />}
      {screen === 'activity' && <Activity items={data.activity} receipts={data.receipts} members={data.members} escalations={escalations} traces={data.traces} since={meMember?.digestSince ?? meMember?.awaySince} />}
      {screen === 'settings' && <><Settings memories={data.memories.filter((m) => m.owner === session.join.memberId)} rules={data.rules} me={meMember} onRefresh={refresh} /><button onClick={() => setConfirmReset(true)} disabled={resetting}>Reset Alter</button></>}
      {screen === 'files' && <Files workspace={data.workspace} inbox={data.inbox} members={data.members} />}
    </div>
  </main>
}
