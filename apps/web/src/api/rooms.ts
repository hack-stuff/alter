import { httpCall } from './client'

export interface RoomInfo {
  code: string
  title: string
  host: string
  alter: { memberId: string; name: string }
  meetingId: string
  ended: boolean
}
export interface RoomPeerInfo { id: string; name: string; host: boolean }
export interface RoomSignal { from: string; kind: 'offer' | 'answer'; data: string; seq: number }

export interface RoomSummary {
  title: string
  host: string
  alter: string
  ended: boolean
  state: string
  decisions: string[]
  tasks: { title: string; owner: string; due: string }[]
  answers: string[]
  waitingOnAlterOwner: boolean
}

export const roomLink = (code: string) => `${location.origin}/m/${code}`
export const roomCodeFromPath = (path = location.pathname) => path.match(/^\/m\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/)?.[1]

export const roomApi = {
  create: (meetingId: string): Promise<RoomInfo> => httpCall('POST', '/rooms', { meetingId }),
  info: (code: string): Promise<RoomInfo> => httpCall('GET', `/rooms/${code}`),
  join: (code: string, name: string): Promise<{ peerId: string; room: RoomInfo; peers: RoomPeerInfo[] }> =>
    httpCall('POST', `/rooms/${code}/join`, { name }),
  poll: (code: string, peerId: string, after: number): Promise<{ peers: RoomPeerInfo[]; signals: RoomSignal[]; ended: boolean }> =>
    httpCall('POST', `/rooms/${code}/poll`, { peerId, after }),
  signal: (code: string, peerId: string, to: string, kind: 'offer' | 'answer', data: string) =>
    httpCall('POST', `/rooms/${code}/signal`, { peerId, to, kind, data }),
  leave: (code: string, peerId: string) => httpCall('POST', `/rooms/${code}/leave`, { peerId }),
  summary: (code: string): Promise<RoomSummary> => httpCall('GET', `/rooms/${code}/summary`),
  end: (code: string) => httpCall('POST', `/rooms/${code}/end`),
}
