import { useState } from 'react'
import type { JoinResult } from './api/types'
import { Home } from './screens/Home'
import { Join } from './screens/Join'
import './App.css'

type Screen = 'home' | 'team' | 'approvals' | 'escalations' | 'activity' | 'settings' | 'files'
const SCREENS: Screen[] = ['home', 'team', 'approvals', 'escalations', 'activity', 'settings', 'files']

// TODO(track-b §2): Team, Approvals, Escalations, Activity, Settings, Files screens.
function Placeholder({ name }: { name: string }) {
  return <section className="screen"><h2>{name}</h2><p>Not built yet.</p></section>
}

export default function App() {
  const inviteCode = location.pathname.match(/^\/join\/(\w+)/)?.[1]
  const [session, setSession] = useState<{ join: JoinResult; name: string }>()
  const [screen, setScreen] = useState<Screen>('home')

  if (!session) return <div className="app"><Join inviteCode={inviteCode} onJoined={(join, name) => setSession({ join, name })} /></div>

  return (
    <div className="app">
      <header>
        <strong>Alter</strong>
        <nav>
          {SCREENS.map((s) => (
            <button key={s} aria-pressed={s === screen} onClick={() => setScreen(s)}>{s}</button>
          ))}
        </nav>
      </header>
      {screen === 'home' ? <Home name={session.name} /> : <Placeholder name={screen} />}
    </div>
  )
}
