import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test.use({ baseURL: 'http://127.0.0.1:5175' })
const fixture = (name: string) => JSON.parse(readFileSync(resolve('../../contracts/fixtures', `${name}.json`), 'utf8'))

test('live mode signs in anonymously, sends fresh bearer tokens and reads scoped Firestore snapshots', async ({ page, isMobile }) => {
  const workspace = fixture('workspace'), approvals = fixture('approvals'), activity = fixture('activity')
  const records = {
    'workspaces/ws_demo': workspace.workspace,
    'workspaces/ws_demo/members': workspace.members,
    'workspaces/ws_demo/approvals': [...approvals.approvals, { ...approvals.approvals[0], id: 'private', owner: 'someone_else', title: 'Another member private proposal' }],
    'workspaces/ws_demo/escalations': [activity.escalation],
    'workspaces/ws_demo/activity': [activity.activity[0]],
    'workspaces/ws_demo/receipts/rcp_01': activity.receipt,
    'workspaces/ws_demo/memories': [],
    'workspaces/ws_demo/rules/m_judge/items': [],
    'workspaces/ws_demo/inbox/m_judge/messages': [],
    'workspaces/ws_demo/a2aTraces': [activity.a2aTrace],
    'workspaces/ws_demo/conversations/conv_01/messages': [{ ...approvals.chat_reply.reply, text: 'Streamed reply from the conversation collection.' }],
  }
  await page.route('**/node_modules/.vite/deps/firebase_auth.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.authHarness = { signIns: 0, tokens: 0 };
    const user = { getIdToken: async () => 'test-token-' + ++window.authHarness.tokens };
    const auth = { currentUser: null, authStateReady: async () => {} };
    export function getAuth() { return auth }
    export function connectAuthEmulator() {}
    export async function signInAnonymously() { window.authHarness.signIns++; auth.currentUser = user; return { user } }
  ` }))
  await page.route('**/node_modules/.vite/deps/firebase_firestore.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const records = ${JSON.stringify(records)};
    window.firestoreHarness = { active: new Set(), observed: [] };
    export class Timestamp { constructor(value){this.value=value} toDate(){return new Date(this.value)} }
    records['workspaces/ws_demo/activity'][0].ts = new Timestamp('2026-10-14T14:12:00Z');
    export function getFirestore() { return {} }
    export function connectFirestoreEmulator() {}
    export function doc(_db,path) { return {kind:'doc',path} }
    export function collection(_db,path) { return {kind:'collection',path} }
    export function where(field,op,value) { return {field,op,value} }
    export function or(...filters) { return {or:filters} }
    export function query(ref,...filters) { return {...ref,filters} }
    function matches(row,filter) { return filter.or ? filter.or.some(f=>matches(row,f)) : filter.op==='array-contains' ? row[filter.field]?.includes(filter.value) : row[filter.field]===filter.value }
    export function onSnapshot(ref,next) {
      const h=window.firestoreHarness; h.active.add(ref); h.observed.push(ref);
      queueMicrotask(()=> {
        if(!h.active.has(ref)) return;
        const value=records[ref.path];
        if(ref.kind==='doc') next({id:ref.path.split('/').pop(),exists:()=>!!value,data:()=>value});
        else next({docs:(value||[]).filter(row=>(ref.filters||[]).every(f=>matches(row,f))).map(row=>({id:row.id,data:()=>row}))});
      });
      return ()=>h.active.delete(ref);
    }
  ` }))
  let joined = false
  const headers: Record<string, string>[] = []
  await page.route('**/v1/**', async (route) => {
    const request = route.request(); headers.push(request.headers())
    if (request.url().endsWith('/me')) {
      await route.fulfill({ status: joined ? 200 : 404, contentType: 'application/json', body: JSON.stringify(joined ? { ...workspace.created, name: 'Alex' } : { error: { code: 'NOT_JOINED', message: 'Join a workspace.' } }) })
    } else if (request.url().endsWith('/workspaces')) {
      joined = true
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(workspace.created) })
    } else if (request.url().endsWith('/conversations')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversationId: 'conv_01' }) })
    } else if (request.url().endsWith('/chat')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(approvals.chat_reply) })
    } else await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Get my Alter' }).click()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await page.getByRole('button', { name: 'Add a QA update to the status doc' }).click()
  await page.getByRole('button', { name: 'Review proposal' }).click()
  await expect(page.getByRole('article', { name: 'Status doc · QA section' })).toBeVisible()
  if (isMobile) await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('log').getByText('Streamed reply from the conversation collection.')).toBeVisible()
  if (isMobile) await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^More/ }).click()
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^approvals/ }).filter({ visible: true }).click()
  await expect(page.getByText('Another member private proposal')).toHaveCount(0)
  const observed = await page.evaluate(() => (window as any).firestoreHarness.observed)
  expect(observed.find((ref: any) => ref.path.endsWith('/approvals')).filters).toEqual([{ field: 'owner', op: '==', value: 'm_judge' }])
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^activity/ }).click()
  await expect(page.getByText('2026-10-14', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Rahul's Alter answered/ })).toBeVisible()
  expect(headers.length).toBeGreaterThanOrEqual(3)
  expect(headers.every((h) => h.authorization?.startsWith('Bearer test-token-') && !h['x-dev-uid'])).toBe(true)
  expect(new Set(headers.map((h) => h.authorization)).size).toBe(headers.length)
  expect(await page.evaluate(() => (window as any).authHarness.signIns)).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: "Alex's Alter" })).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveCount(0)
})
