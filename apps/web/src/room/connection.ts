// Browser-to-browser meeting room. The API only relays offers and answers; every
// participant connects directly to every other (a small mesh), and the host also
// tells everyone what the represented Alter is doing over a data channel.
import { roomApi, type RoomPeerInfo, type RoomSignal } from '../api/rooms'

export interface AlterUpdate { state: 'connecting' | 'listening' | 'speaking' | 'closed'; caption?: string }
export interface RemotePeer extends RoomPeerInfo { stream?: MediaStream; connected: boolean }

interface Link { pc: RTCPeerConnection; info: RoomPeerInfo; stream?: MediaStream; channel?: RTCDataChannel }

const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }

/** Wait for candidates so each offer or answer is sent once, complete. */
function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve() }
    })
  })
}

export class RoomConnection {
  peerId = ''
  private links = new Map<string, Link>()
  private order: string[] = []
  private after = 0
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private alter?: AlterUpdate
  private code: string
  private name: string
  private local: MediaStream
  private handlers: {
    onPeers: (peers: RemotePeer[]) => void
    onAlter?: (update: AlterUpdate) => void
    onEnded?: () => void
    onError?: (message: string) => void
  }

  constructor(code: string, name: string, local: MediaStream, handlers: RoomConnection['handlers']) {
    this.code = code
    this.name = name
    this.local = local
    this.handlers = handlers
  }

  async join() {
    const joined = await roomApi.join(this.code, this.name)
    this.peerId = joined.peerId
    await this.sync(joined.peers)
    this.schedule()
    return joined.room
  }

  /** Host only: share the Alter's state and caption with everyone. */
  sendAlter(update: AlterUpdate) {
    this.alter = update
    const text = JSON.stringify({ type: 'alter', ...update })
    for (const link of this.links.values()) if (link.channel?.readyState === 'open') link.channel.send(text)
  }

  async leave() {
    this.stopped = true
    clearTimeout(this.timer)
    for (const id of [...this.links.keys()]) this.drop(id)
    if (this.peerId) await roomApi.leave(this.code, this.peerId).catch(() => {})
  }

  private schedule() {
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 1000)
  }

  private async poll() {
    try {
      const value = await roomApi.poll(this.code, this.peerId, this.after)
      if (this.stopped) return
      if (value.ended) { this.handlers.onEnded?.(); return }
      for (const signal of value.signals) {
        this.after = Math.max(this.after, signal.seq)
        await this.receive(signal, value.peers)
      }
      await this.sync(value.peers)
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error.message : 'Lost touch with the meeting. Retrying…')
    }
    this.schedule()
  }

  private emit() {
    this.handlers.onPeers(this.order.filter((id) => id !== this.peerId && this.links.has(id)).map((id) => {
      const link = this.links.get(id)!
      return { ...link.info, stream: link.stream, connected: link.pc.connectionState === 'connected' }
    }))
  }

  private async sync(peers: RoomPeerInfo[]) {
    this.order = peers.map((peer) => peer.id)
    const mine = this.order.indexOf(this.peerId)
    for (const id of [...this.links.keys()]) if (!this.order.includes(id)) this.drop(id)
    for (const [index, peer] of peers.entries()) {
      if (peer.id === this.peerId || this.links.has(peer.id)) continue
      // The later arrival calls everyone already in the room, so two peers never both offer.
      if (index < mine) await this.call(peer)
    }
    this.emit()
  }

  private link(info: RoomPeerInfo) {
    const pc = new RTCPeerConnection(ICE)
    const link: Link = { pc, info }
    this.links.set(info.id, link)
    for (const track of this.local.getTracks()) pc.addTrack(track, this.local)
    pc.ontrack = (event) => { link.stream = event.streams[0] ?? new MediaStream([event.track]); this.emit() }
    pc.ondatachannel = (event) => this.bind(link, event.channel)
    pc.onconnectionstatechange = () => {
      // A failed link is dropped; the next poll calls again if this peer is the later arrival.
      if (pc.connectionState === 'failed') this.drop(info.id)
      this.emit()
    }
    return link
  }

  private bind(link: Link, channel: RTCDataChannel) {
    link.channel = channel
    channel.onopen = () => { if (this.alter) channel.send(JSON.stringify({ type: 'alter', ...this.alter })) }
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data))
        if (message.type === 'alter') this.handlers.onAlter?.({ state: message.state, caption: message.caption })
      } catch { /* Ignore malformed messages. */ }
    }
  }

  private async call(info: RoomPeerInfo) {
    const link = this.link(info)
    this.bind(link, link.pc.createDataChannel('alter'))
    await link.pc.setLocalDescription(await link.pc.createOffer())
    await gathered(link.pc)
    await roomApi.signal(this.code, this.peerId, info.id, 'offer', JSON.stringify(link.pc.localDescription)).catch(() => this.drop(info.id))
  }

  private async receive(signal: RoomSignal, peers: RoomPeerInfo[]) {
    const description = JSON.parse(signal.data) as RTCSessionDescriptionInit
    if (signal.kind === 'offer') {
      const info = peers.find((peer) => peer.id === signal.from)
      if (!info) return
      // A fresh offer replaces any earlier link with that peer.
      if (this.links.has(info.id)) this.drop(info.id)
      const link = this.link(info)
      await link.pc.setRemoteDescription(description)
      await link.pc.setLocalDescription(await link.pc.createAnswer())
      await gathered(link.pc)
      await roomApi.signal(this.code, this.peerId, info.id, 'answer', JSON.stringify(link.pc.localDescription)).catch(() => {})
    } else {
      const link = this.links.get(signal.from)
      if (link && link.pc.signalingState === 'have-local-offer') await link.pc.setRemoteDescription(description)
    }
  }

  private drop(id: string) {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    link.channel?.close()
    link.pc.close()
  }
}
