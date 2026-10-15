import { httpCall, MOCK } from './client'

export interface Day {
  name: string
  role: string
  agenda: {
    id: string
    title: string
    start: string
    end: string
    meetUrl: string
    url: string
  }[]
  agendaError: string
  meetUrl: string
  meetingPresence: 'unverified'
  simulated: boolean
  voiceConfigured: boolean
  timeZone: string
}
export const dayApi = {
  get: (): Promise<Day> =>
    MOCK
      ? Promise.reject(
          new Error('Calendar access needs the connected backend.'),
        )
      : httpCall('GET', '/day'),
  setMeetUrl: (url: string): Promise<{ meetUrl: string }> =>
    httpCall('PUT', '/day/meet-link', { url }),
}
