import { useState } from 'react'
import { VoiceControl } from '../components/VoiceControl'
import { AlterBadge } from '../components/AlterBadge'
import type { Answer } from '../api/types'
import { Citations } from '../components/Citations'

const names: Record<string, string> = { rahul: 'Rahul', priya: 'Priya', meera: 'Meera', arjun: 'Arjun' }
export function Kiosk({ memberId }: { memberId: string }) {
  const [speaking, setSpeaking] = useState(false)
  const [answer, setAnswer] = useState<Answer>()
  return <main className={`kiosk ${speaking ? 'is-speaking' : ''}`}><div className="alter-cube" aria-hidden="true">A</div><h1>{names[memberId] ?? 'Teammate'}'s Alter <AlterBadge /></h1><p>{memberId === 'rahul' ? 'Rahul is on leave' : 'AI representative'}</p><VoiceControl mode="huddle" targetId={memberId} onSpeaking={setSpeaking} onResult={(result) => setAnswer(result as Answer)} />{answer && <div className="kiosk-answer"><p>{answer.answer}</p><Citations sources={answer.citations} /></div>}<p className="hint">Use this tile as an OBS browser source. Start voice before hiding the controls in your scene.</p></main>
}
