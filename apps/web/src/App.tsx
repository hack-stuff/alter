import { useEffect, useRef, useState } from 'react'
import { AccountMenu } from './components/AccountMenu'
import { api, MOCK, ApiError, httpCall } from './api/client'
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
import { Computer } from './screens/Computer'
import { Kiosk } from './screens/Kiosk'
import { Director } from './screens/Director'
import { Icon } from './components/Icon'
import { PersonWithAlter } from './components/People'
import { Work } from './screens/Work'
import { Notifications } from './components/Notifications'
import { useAlterNavigation, type View } from './agent/useAlterNavigation'
import { navigateTo as navAction, type ScreenId } from './agent/navigation'
import { GuestRoom } from './screens/MeetingRoom'
import { roomCodeFromPath } from './api/rooms'
import './App.css'

type NavItem = { id: ScreenId; label: string; icon: string; count?: 'approvals' | 'escalations'; also?: View[] }

// One task at a time: the rail switches the work surface, nothing else.
const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas' },
  { id: 'meeting', label: 'Meeting', icon: 'meeting', also: ['meetings'] },
  { id: 'approvals', label: 'Approvals', icon: 'approvals', count: 'approvals' },
  { id: 'decisions', label: 'Decisions', icon: 'decision', count: 'escalations' },
]
const SECONDARY: NavItem[] = [
  { id: 'team', label: 'Team', icon: 'team' },
  { id: 'work-log', label: 'Work log', icon: 'log' },
  { id: 'rules', label: 'Rules & memory', icon: 'settings' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'computer', label: 'Computer', icon: 'computer' },
]

const NAME_KEY = 'alter.lastName'

export default function App() {
  const parameters = new URLSearchParams(location.search)
  const roomCode = roomCodeFromPath()
  const inviteCode = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)$/)?.[1]
  const [session, setSession] = useState<{ join: JoinResult; name: string }>()
  const canRestore = !MOCK && (!!import.meta.env.VITE_FIREBASE_CONFIG || import.meta.env.VITE_DEV_AUTH === '1') && parameters.get('director') !== '1' && parameters.get('kiosk') !== '1'
  const [restoring, setRestoring] = useState(canRestore)
  // Remembered so the very first loading screen already shows this person's avatar.
  const [knownName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } })
  useEffect(() => { if (session?.name) try { localStorage.setItem(NAME_KEY, session.name) } catch { /* only a nicer loading screen */ } }, [session?.name])
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
  const { view: screen, navigateTo, showView } = useAlterNavigation(
    parameters.has('meeting') ? 'meetings' : parameters.has('decision') ? 'decisions' : parameters.get('view') === 'files' ? 'files' : 'home'
  )
  // Workday screens stay mounted once seen (Home, Canvas, Meeting, Approvals and
  // Decisions from the start) so switching never shows a loading state.
  const [visited, setVisited] = useState<Set<View>>(() => new Set<View>(['home', 'canvas', 'meeting', 'approvals', 'decisions']))
  if (!visited.has(screen)) setVisited(new Set(visited).add(screen))
  const mounted = (view: View) => visited.has(view)
  const { data, error: streamError, refresh } = useWorkspace(session?.join)
  const [overrides, setOverrides] = useState<Record<string, Approval>>({})
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [meetingStartRequest, setMeetingStartRequest] = useState(0)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [retryingSetup, setRetryingSetup] = useState(false)
  const [setupRetryError, setSetupRetryError] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const logoutDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = logoutDialog.current
    if (confirmLogout && !dialog?.open) dialog?.showModal()
    if (!confirmLogout && dialog?.open) dialog.close()
  }, [confirmLogout, loggingOut])
  async function logout() {
    if (loggingOut) return
    setLoggingOut(true); setLogoutError('')
    try {
      if (!MOCK) {
        if (localStorage.getItem('alter.push.device')) await (await import('./push')).disablePush()
        if (import.meta.env.VITE_DEV_AUTH === '1') localStorage.removeItem('alter.dev.uid')
        else await (await import('./firebase-auth')).firebaseSignOut()
      }
      for (const key of Object.keys(sessionStorage)) if (key.startsWith('alter.')) sessionStorage.removeItem(key)
      localStorage.removeItem(NAME_KEY)
      window.location.replace('/')
    } catch (e) {
      setLogoutError(e instanceof Error ? e.message : 'Could not log out. Please try again.')
      setLoggingOut(false)
    }
  }
  function joined(join: JoinResult, name: string) { setSession({ join, name }); setOverrides({}); go('home') }
  function updateApproval(updated: Approval) { setOverrides((cards) => ({ ...cards, [updated.id]: updated })) }
  function go(next: View) { setMore(false); window.scrollTo({ top: 0 }); if (next === 'meetings') showView(next); else navigateTo(navAction(next)) }
  function startMeeting() { go('meeting'); setMeetingStartRequest((value) => value + 1) }
  async function retrySetup() {
    if (retryingSetup) return
    setRetryingSetup(true); setSetupRetryError('')
    try { await httpCall('POST', '/workspaces/retry-provision'); refresh() }
    catch (e) { setSetupRetryError(e instanceof Error ? e.message : 'Could not retry Google setup. Please try again.') }
    finally { setRetryingSetup(false) }
  }
  async function reset() {
    if (!session || resetting) return
    setResetting(true); setError('')
    try { joined(await api.resetWorkspace(), session.name); setGeneration((g) => g + 1); setConfirmReset(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reset this Alter. Please try again.') }
    finally { setResetting(false) }
  }
  if (roomCode) return <GuestRoom code={roomCode} />
  if (parameters.get('kiosk') === '1' && (session || parameters.get('director') !== '1')) return <Kiosk memberId={parameters.get('tile') ?? 'siddhi'} meetingId={parameters.get('meeting') ?? undefined} />
  if (loggingOut) return <main className="join-layout"><p role="status" className="quiet-status">Logging out…</p></main>
  if (restoring) return <main className="join-layout">{knownName
    ? <div className="restore-status"><span className="opening-mark is-connecting" aria-hidden="true"><PersonWithAlter name={knownName} size="large" /></span><p role="status" className="quiet-status">Opening {knownName}’s Alter…</p></div>
    : <p role="status" className="quiet-status"><span className="alter-mark alter-mark-small" aria-hidden="true">✦</span>Opening your Alter…</p>}</main>
  if (restoreError && !session) return <main className="join-layout"><div className="sheet narrow"><p className="error" role="alert">{restoreError}</p><button className="primary" onClick={() => { setRestoreError(''); setRestoring(true); setRestoreAttempt((value) => value + 1) }}>Retry sign-in</button></div></main>
  if (!session) return <main className="join-layout">{parameters.get('director') === '1' ? <Director onJoined={joined} /> : <Join inviteCode={inviteCode} onJoined={joined} />}</main>

  const approvals = data.approvals.filter((a) => a.owner === session.join.memberId).map((a) => {
    const latest = overrides[a.id]
    return latest && (latest.revision > a.revision || (latest.revision === a.revision && a.state === 'proposed')) ? latest : a
  })
  const escalations = data.escalations.filter((e) => e.owner === session.join.memberId)
  const pending = approvals.filter((a) => a.state === 'proposed').length
  const waiting = escalations.filter((e) => e.state === 'pending').length
  const inviteUrl = data.workspace?.inviteCode ? new URL(`/join/${data.workspace.inviteCode}`, location.origin).href : session.join.inviteUrl
  const meMember = data.members.find((m) => m.id === session.join.memberId)
  const current = [...PRIMARY, ...SECONDARY].find((item) => item.id === screen || item.also?.includes(screen))

  function navButton(item: NavItem) {
    const count = item.count === 'approvals' ? pending : item.count === 'escalations' ? waiting : 0
    const selected = current?.id === item.id
    return <button
      key={item.id}
      type="button"
      className={`nav-item${selected ? ' is-current' : ''}`}
      data-nav-screen={item.id}
      aria-current={selected ? 'page' : undefined}
      aria-label={count ? `${item.label}, ${count} waiting` : item.label}
      onClick={() => go(item.id)}
    >
      <span className="nav-icon"><Icon name={item.icon} size={20} />{count > 0 && <span className="count" aria-hidden="true">{count}</span>}</span>
      <span className="nav-label">{item.label}</span>
    </button>
  }

  return <div className="shell">
    <nav className={`rail${more ? ' is-open' : ''}`} aria-label="Alter">
      <div className="rail-primary">{PRIMARY.map(navButton)}</div>
      <div className="rail-divider" aria-hidden="true" />
      <div className={`rail-secondary${more ? ' is-open' : ''}`}>{SECONDARY.map(navButton)}</div>
      <button type="button" className={`nav-item rail-more${SECONDARY.some((item) => item.id === current?.id) ? ' is-current' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>
        <span className="nav-icon"><Icon name="more" size={20} /></span><span className="nav-label">More</span>
      </button>
      <div className="rail-foot">
        <Notifications items={data.notifications ?? []} onOpen={(path) => { const params = new URL(path, location.origin).searchParams; go(params.has('meeting') ? 'meetings' : params.has('decision') ? 'decisions' : 'files'); if (params.has('meeting')) { sessionStorage.setItem('alter.open.meeting', params.get('meeting')!); setGeneration((g) => g + 1) } }} />
        <AccountMenu name={session.name} onLogout={() => { setLogoutError(''); setConfirmLogout(true) }} />
      </div>
    </nav>
    <dialog ref={logoutDialog} className="logout-dialog" aria-labelledby="logout-title" onCancel={() => setConfirmLogout(false)}>
      <p className="eyebrow">Account</p>
      <h2 id="logout-title">Log out?</h2>
      <p className="hint">{MOCK ? 'This local demo session will close.' : import.meta.env.VITE_DEV_AUTH === '1' ? 'This demo uses a browser-only identity. Logging out switches to a new identity, so this workspace may not be available again from this browser.' : 'This Alter uses anonymous sign-in. Logging out may prevent you from reopening this workspace. Your saved work will not be deleted.'}</p>
      {logoutError && <p role="alert" className="error">{logoutError}</p>}
      <div className="actions"><button type="button" onClick={() => setConfirmLogout(false)}>Cancel</button><button type="button" className="reject" onClick={() => void logout()}>Log out</button></div>
    </dialog>
    {more && <button type="button" className="sheet-scrim" aria-label="Close menu" onClick={() => setMore(false)} />}

    <main className="workspace">
      <div className="notices">
        {data.workspace?.simulated && <p className="demo-banner"><span className="badge-simulated" title={`Local development · ${data.workspace.aiBackend === 'vertex' ? 'real Gemini, simulated Google resources' : 'simulated AI and Google resources'}`}>Simulated</span></p>}
        {screen !== 'home' && data.workspace?.state === 'provisioning' && <p role="status" className="notice">Your Alter is connecting to your team’s Google resources…</p>}
        {screen !== 'home' && data.workspace?.state === 'provisioning_failed' && <div role="alert" className="notice is-error setup-retry"><span>Google setup didn’t finish. Your workspace and work are saved.</span><button type="button" disabled={retryingSetup} onClick={() => void retrySetup()}>{retryingSetup ? 'Retrying setup…' : 'Retry Google setup'}</button>{setupRetryError && <span>{setupRetryError}</span>}</div>}
        {streamError && <div role="alert" className="notice is-error"><p>{streamError}</p><button onClick={refresh}>Retry updates</button></div>}
      </div>

      <div key={generation} className="surface">
        <div data-screen="home" hidden={screen !== 'home'}>
          <Alter
            name={session.name}
            workspaceId={session.join.workspaceId}
            members={data.members}
            meId={session.join.memberId}
            approvals={approvals}
            escalations={escalations}
            events={data.events}
            active={screen === 'home'}
            ready={data.workspace?.state === 'ready' || (MOCK && !data.workspace?.state)}
            setupState={data.workspace?.state}
            retryingSetup={retryingSetup}
            setupRetryError={setupRetryError}
            onRetrySetup={retrySetup}
            onUpdate={updateApproval}
            onRefresh={refresh}
            onNavigate={(action, source) => navigateTo(action, source)}
            onStartMeeting={startMeeting}
          />
        </div>
        {(screen === 'meeting' || screen === 'meetings') && <div className="segmented page-tabs" role="tablist" aria-label="Meeting views">
          <button role="tab" aria-selected={screen === 'meeting'} onClick={() => go('meeting')}>Review</button>
          <button role="tab" aria-selected={screen === 'meetings'} onClick={() => go('meetings')}>All meetings</button>
        </div>}
        <div data-screen="meeting" hidden={screen !== 'meeting'}>
          <MeetCompanion
            members={data.members}
            owner={session.name}
            workspaceId={session.join.workspaceId}
            memberId={session.join.memberId}
            active={screen === 'meeting'}
            ready={data.workspace?.state === 'ready' || (MOCK && !data.workspace?.state)}
            startRequest={meetingStartRequest}
            onReview={(id) => { sessionStorage.setItem('alter.open.meeting', id); showView('meetings'); setGeneration((g) => g + 1) }}
            onBack={() => go('home')}
          />
        </div>
        <div data-screen="canvas" hidden={screen !== 'canvas'}>
          <PlanCanvas members={data.members} active={screen === 'canvas'} onBack={() => go('home')} onApproveDoc={() => { refresh() }} />
        </div>
        <div data-screen="approvals" hidden={screen !== 'approvals'}><Approvals approvals={approvals} onUpdate={updateApproval} /></div>
        <div data-screen="decisions" hidden={screen !== 'decisions'}><Escalations items={escalations} members={data.members} meName={session.name} onRefresh={refresh} /></div>
        {screen === 'meetings' && <div data-screen="meetings"><Work key={session.join.workspaceId} members={data.members} memberId={session.join.memberId} initialId={parameters.get('meeting') ?? undefined} /></div>}
        {mounted('team') && <div data-screen="team" hidden={screen !== 'team'}><Team members={data.members} memberId={session.join.memberId} inviteUrl={inviteUrl} workspaceId={session.join.workspaceId} /></div>}
        {mounted('work-log') && <div data-screen="work-log" hidden={screen !== 'work-log'}><Activity items={data.activity} receipts={data.receipts} members={data.members} escalations={escalations} traces={data.traces} since={meMember?.digestSince ?? meMember?.awaySince} /></div>}
        {mounted('rules') && <div data-screen="rules" hidden={screen !== 'rules'}>
          <Settings memories={data.memories.filter((m) => m.owner === session.join.memberId)} rules={data.rules} me={meMember} onRefresh={refresh} />
          <section className="sheet danger-zone" aria-label="Reset">
            <div><h3>Start over</h3><p className="hint">Return this Alter to its starting state.</p></div>
            {confirmReset ? <div className="reset-confirmation" aria-label="Reset confirmation"><p>Reset this Alter to its starting state? Its conversation, proposals and changes will be cleared.</p><div className="actions"><button className="reject" onClick={() => void reset()} disabled={resetting}>{resetting ? 'Resetting…' : 'Confirm reset'}</button><button disabled={resetting} onClick={() => { setConfirmReset(false); setError('') }}>Cancel</button></div>{error && <p role="alert" className="error">{error}</p>}</div>
              : <button onClick={() => setConfirmReset(true)} disabled={resetting}>Reset Alter</button>}
          </section>
        </div>}
        {mounted('files') && <div data-screen="files" hidden={screen !== 'files'}><Files workspace={data.workspace} inbox={data.inbox} members={data.members} /></div>}
        {mounted('computer') && <div data-screen="computer" hidden={screen !== 'computer'}><Computer active={screen === 'computer'} /></div>}
      </div>
    </main>
  </div>
}
