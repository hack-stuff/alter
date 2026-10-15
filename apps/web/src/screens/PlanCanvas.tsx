import { useEffect, useRef, useState } from 'react'
import { AlterOrb } from '../components/AlterOrb'
import { listen, speak } from '../agent/voice'
import { Icon, Avatar } from '../components/Icon'
import { OnScreenTips, type TipItem } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { Citations } from '../components/Citations'
import type { Citation, Member } from '../api/types'

export interface DiagramNode {
  id: string
  label: string
  category: 'ui' | 'backend' | 'decision' | 'fallback' | 'review'
  status: 'standard' | 'added_by_voice' | 'modified'
  description: string
  owner?: string
  citations: Citation[]
  x: number
  y: number
  connections: string[]
}

const INITIAL_NODES: DiagramNode[] = [
  {
    id: 'entry',
    label: '1. App Launch (Mobile)',
    category: 'ui',
    status: 'standard',
    description: 'User opens the app without an active session.',
    citations: [
      { sourceId: 'doc-login', title: 'Login design doc §1', locator: 'Overview' },
    ],
    x: 40,
    y: 120,
    connections: ['onetap', 'legacy'],
  },
  {
    id: 'onetap',
    label: '2. Google One-Tap Overlay',
    category: 'ui',
    status: 'standard',
    description: 'Native bottom sheet prompt for 1-tap Google account selection. Replaces retired Google Sign-In button.',
    citations: [
      { sourceId: 'arch-sync', title: 'Arch sync · Oct 8', locator: 'Rahul decision' },
      { sourceId: 'doc-login', title: 'Login design doc §2', locator: 'One-tap UI' },
    ],
    x: 280,
    y: 70,
    connections: ['auth_backend'],
  },
  {
    id: 'legacy',
    label: 'Standard Email / Password',
    category: 'fallback',
    status: 'standard',
    description: 'Fallback path if Google One-Tap is dismissed or unsupported.',
    citations: [
      { sourceId: 'doc-login', title: 'Login design doc §2.3', locator: 'Fallback' },
    ],
    x: 280,
    y: 240,
    connections: ['auth_backend'],
  },
  {
    id: 'auth_backend',
    label: '3. Token Auth (AUTH-112)',
    category: 'backend',
    status: 'standard',
    description: 'Backend verifies ID token with Google Identity Services. Approved for production on Oct 10 by Rahul.',
    owner: 'arjun',
    citations: [
      { sourceId: 'ticket-112', title: 'Ticket AUTH-112', locator: 'Status: Live in Prod' },
      { sourceId: 'rahul-notes', title: 'Arch sync · Oct 8', locator: 'AUTH-112' },
    ],
    x: 540,
    y: 70,
    connections: ['success'],
  },
  {
    id: 'success',
    label: '4. Authenticated Home Screen',
    category: 'ui',
    status: 'standard',
    description: 'User enters the application with verified identity session token.',
    citations: [
      { sourceId: 'doc-login', title: 'Login design doc §5', locator: 'Session' },
    ],
    x: 780,
    y: 120,
    connections: [],
  },
]

export function PlanCanvas({
  members,
  onBack,
  onApproveDoc,
}: {
  members: Member[]
  onBack: () => void
  onApproveDoc?: (summary: string) => void
}) {
  const [nodes, setNodes] = useState<DiagramNode[]>(INITIAL_NODES)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('onetap')
  const [feedbackMsg, setFeedbackMsg] = useState<string>(
    'Alter is ready. Try speaking an edit, or click a prompt tip below.'
  )
  const [isApproved, setIsApproved] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const liveVoice = !!import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()
  const [caption, setCaption] = useState('Listening — say what to change and watch the diagram redraw.')
  const [orbSpeaking, setOrbSpeaking] = useState(false)
  const [mic, setMic] = useState<'idle' | 'listening' | 'unsupported'>('idle')
  const editRef = useRef(applyVoiceEdit)
  useEffect(() => { editRef.current = applyVoiceEdit })
  useEffect(() => {
    if (liveVoice) return
    return listen({
      onState: (state) => setMic(state),
      onInterim: (phrase) => setCaption(`“${phrase}”`),
      onFinal: (phrase) => {
        setCaption(`Heard “${phrase}” — on it.`)
        editRef.current(phrase)
        speak('Got it.', { onStart: () => setOrbSpeaking(true), onEnd: () => setOrbSpeaking(false) })
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVoice])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? nodes[0]

  function applyVoiceEdit(instruction: string) {
    const text = instruction.toLowerCase()

    if (text.includes('biometric') || text.includes('face') || text.includes('fingerprint')) {
      if (nodes.some((n) => n.id === 'biometric')) {
        setFeedbackMsg('Biometric fallback is already in the flow diagram.')
        return
      }
      const newNode: DiagramNode = {
        id: 'biometric',
        label: '✦ Biometric Fallback (FaceID)',
        category: 'fallback',
        status: 'added_by_voice',
        description: 'Instant local biometric fallback before prompting full credentials. Added via Alter voice instruction.',
        owner: 'rahul',
        citations: [
          { sourceId: 'doc-login', title: 'Login design doc §4', locator: 'Biometrics' },
          { sourceId: 'ticket-112', title: 'AUTH-112 Security Addendum', locator: 'Biometric token' },
        ],
        x: 540,
        y: 240,
        connections: ['success'],
      }
      setNodes((prev) => {
        const updated = prev.map((node) => {
          if (node.id === 'onetap') {
            return { ...node, connections: [...node.connections, 'biometric'] }
          }
          return node
        })
        return [...updated, newNode]
      })
      setSelectedNodeId('biometric')
      setFeedbackMsg('Added Biometric Fallback (FaceID/Fingerprint) linked to AUTH-112 and updated the status doc preview.')
      setIsApproved(false)
    } else if (text.includes('meera') || text.includes('mock') || text.includes('design')) {
      if (nodes.some((n) => n.id === 'meera_review')) {
        setFeedbackMsg("Meera's design review checkpoint is already added.")
        return
      }
      const newNode: DiagramNode = {
        id: 'meera_review',
        label: "✦ Meera's Mock-up Sign-off",
        category: 'review',
        status: 'added_by_voice',
        description: "Design sign-off milestone. Meera's mobile mock-ups are due Friday before final release.",
        owner: 'meera',
        citations: [
          { sourceId: 'meera-notes', title: 'Login mock-ups', locator: 'Delivery: Friday' },
        ],
        x: 410,
        y: 10,
        connections: ['auth_backend'],
      }
      setNodes((prev) => {
        const updated = prev.map((node) => {
          if (node.id === 'onetap') {
            return { ...node, connections: [...node.connections, 'meera_review'] }
          }
          return node
        })
        return [...updated, newNode]
      })
      setSelectedNodeId('meera_review')
      setFeedbackMsg("Added Meera's mock-up review checkpoint (Due Friday) to the launch path.")
      setIsApproved(false)
    } else if (text.includes('timeout') || text.includes('session') || text.includes('30 min')) {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === 'success') {
            return {
              ...n,
              label: '4. Authenticated Home (30m Timeout)',
              status: 'modified',
              description: 'Session timeout extended from 15 minutes to 30 minutes as requested.',
            }
          }
          return n
        })
      )
      setSelectedNodeId('success')
      setFeedbackMsg('Updated session security timeout to 30 minutes in the auth configuration.')
      setIsApproved(false)
    } else {
      setFeedbackMsg(`Understood: "${instruction}". Updated the design specification and noted it for team review.`)
    }
  }

  function handleApprove() {
    setIsApproved(true)
    setFeedbackMsg('Approved! Updated Google Doc "Login Revamp — Status" and notified Meera and Arjun through their Alters.')
    onApproveDoc?.('One-Tap UI Architecture Plan Approved')
  }

  const tips: TipItem[] = [
    {
      type: 'say',
      text: 'Add biometric fallback to the mobile prompt',
      highlight: !nodes.some((n) => n.id === 'biometric'),
    },
    {
      type: 'say',
      text: "Include Meera's mock-up review checkpoint before launch",
      highlight: !nodes.some((n) => n.id === 'meera_review'),
    },
    {
      type: 'say',
      text: 'Change session timeout to 30 minutes',
    },
    {
      type: 'do',
      text: 'Click any diagram node to inspect citations & backstory',
      action: () => setSelectedNodeId(nodes[1]?.id ?? 'onetap'),
    },
    {
      type: 'do',
      text: 'Approve & sync changes to Google Docs',
      action: handleApprove,
    },
  ]

  return (
    <section className="screen plan-canvas-screen fx stage-dark">
      <div className="fx-aurora" aria-hidden="true" />
      <div className="stage-wipe" aria-hidden="true" />
      <div className="canvas-header">
        <button type="button" className="back-link-btn" onClick={onBack}>
          ← Back to your Alter
        </button>
        <div className="plan-title-block">
          <p className="eyebrow">Ongoing plan · co-edited with your Alter</p>
          <h2>Login Revamp — UI & System Architecture</h2>
          <p className="hint">
            Visual user journey from entry to authenticated session. Edit in real time using voice or suggested tips.
          </p>
        </div>
        <div className="canvas-header-actions">
          {isApproved ? (
            <span className="badge-approved">
              <Icon name="check" size={16} /> Updated in Google Docs
            </span>
          ) : (
            <button type="button" className="primary approve-button" onClick={handleApprove}>
              <Icon name="check" size={16} /> Approve & Sync to Docs
            </button>
          )}
        </div>
      </div>

      <OnScreenTips tips={tips} onSelectPrompt={applyVoiceEdit} />

      <div className="canvas-workspace-grid">
        {/* Main Interactive Diagram Canvas */}
        <div className="diagram-viewport card">
          <div className="diagram-legend">
            <span className="legend-chip ui">● UI Screen / Prompt</span>
            <span className="legend-chip backend">● Backend / Auth API</span>
            <span className="legend-chip fallback">● Fallback Route</span>
            <span className="legend-chip review">● Review Milestone</span>
            <span className="legend-diff">Cobalt border = Edited by Voice</span>
          </div>

          <div className="diagram-canvas">
            <svg className="diagram-svg" viewBox="0 0 960 360" preserveAspectRatio="xMidYMid meet">
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#8ca0b8" />
                </marker>
                <marker
                  id="arrowhead-blue"
                  markerWidth="8"
                  markerHeight="6"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#204dbe" />
                </marker>
              </defs>

              {/* Render Connections */}
              {nodes.map((node) =>
                node.connections.map((targetId) => {
                  const target = nodes.find((n) => n.id === targetId)
                  if (!target) return null
                  const isVoiceEdge = node.status !== 'standard' || target.status !== 'standard'
                  const startX = node.x + 160
                  const startY = node.y + 40
                  const endX = target.x
                  const endY = target.y + 40
                  const midX = (startX + endX) / 2
                  return (
                    <path
                      key={`${node.id}-${targetId}`}
                      d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      stroke={isVoiceEdge ? '#204dbe' : '#b2c2d4'}
                      strokeWidth={isVoiceEdge ? 3 : 2}
                      strokeDasharray={isVoiceEdge ? '4 2' : undefined}
                      markerEnd={isVoiceEdge ? 'url(#arrowhead-blue)' : 'url(#arrowhead)'}
                      className="connection-path"
                    />
                  )
                })
              )}
            </svg>

            {/* Render Nodes as Interactive Cards */}
            <div className="diagram-nodes-layer">
              {nodes.map((node) => {
                const isSelected = selectedNodeId === node.id
                return (
                  <button
                    key={node.id}
                    type="button"
                    style={{ left: `${node.x}px`, top: `${node.y}px` }}
                    className={`diagram-node-card node-cat-${node.category} ${
                      node.status !== 'standard' ? 'node-status-voice' : ''
                    } ${isSelected ? 'node-selected' : ''}`}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <div className="node-card-top">
                      <span className="node-category-tag">{node.category}</span>
                      {node.status === 'added_by_voice' && (
                        <span className="node-diff-badge">✦ Added by voice</span>
                      )}
                      {node.status === 'modified' && (
                        <span className="node-diff-badge">✦ Modified</span>
                      )}
                    </div>
                    <strong className="node-title">{node.label}</strong>
                    <p className="node-desc">{node.description}</p>
                    {node.owner && (
                      <div className="node-owner">
                        <Avatar name={node.owner} size="small" />
                        <span>Owned by {node.owner[0].toUpperCase() + node.owner.slice(1)}</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Live Voice Status & Confirmation Strip */}
          <div className="canvas-voice-footer">
            <div className="voice-feedback">
              <span className="sparkle-icon">✨</span>
              <span>{feedbackMsg}</span>
              {voiceActive && <span className="voice-active-indicator" style={{ marginLeft: 'auto', color: '#16a34a', fontWeight: 600 }}>● Listening</span>}
            </div>
            {liveVoice ? (
              <VoiceControl
                mode="revise"
                targetId="plan-canvas"
                autoStart
                onActive={setVoiceActive}
                onResult={(_res, _tool, input) => applyVoiceEdit(input)}
              />
            ) : (
              <span className="stage-mic">{mic === 'listening' ? '● Listening — just say what to change' : mic === 'unsupported' ? 'Voice needs Chrome — the tips below still work' : 'Starting to listen…'}</span>
            )}
          </div>
        </div>

        {/* Node Detail & Google Workspace Backstory Drawer */}
        <aside className="node-details-panel card">
          <p className="eyebrow">Node Context & Citations</p>
          <h3>{selectedNode.label}</h3>
          <p className="detail-desc">{selectedNode.description}</p>

          {selectedNode.owner && (
            <div className="detail-owner-card">
              <Avatar name={selectedNode.owner} size="small" />
              <div>
                <strong>
                  {members.find((m) => m.id === selectedNode.owner)?.name ?? selectedNode.owner}
                </strong>
                <p className="hint">
                  {members.find((m) => m.id === selectedNode.owner)?.role ?? 'Team Member'}
                </p>
              </div>
            </div>
          )}

          <div className="detail-citations">
            <h4>Sources</h4>
            <Citations sources={selectedNode.citations} />
          </div>

          <div className="detail-quick-actions">
            <h4>Voice Actions on this Node</h4>
            <div className="action-pills">
              <button
                type="button"
                className="chip"
                onClick={() => applyVoiceEdit(`Add biometric fallback to ${selectedNode.label}`)}
              >
                + Add biometric fallback
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => applyVoiceEdit(`Include Meera's mock-up review on ${selectedNode.label}`)}
              >
                + Add Meera design review
              </button>
            </div>
          </div>
        </aside>
      </div>
      <AlterOrb
        state={orbSpeaking ? 'speaking' : mic === 'listening' ? 'listening' : 'idle'}
        caption={caption}
        label="Your Alter"
        onHome={onBack}
      />
    </section>
  )
}
