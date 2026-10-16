import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, setDoc, collection, query, where, Timestamp } from 'firebase/firestore'
let env
before(async () => {
  env = await initializeTestEnvironment({projectId:'demo-alter',firestore:{host:'127.0.0.1',port:8085,rules:readFileSync(new URL('../../firestore.rules', import.meta.url),'utf8')}})
  await env.withSecurityRulesDisabled(async ({firestore}) => {
    const db=firestore()
    const seed={
      'userBindings/alice':{workspaceId:'w1',memberId:'a'},
      'userBindings/bob':{workspaceId:'w1',memberId:'b'},
      'userBindings/eve':{workspaceId:'w2',memberId:'e'},
      'workspaces/w1':{expiresAt:Timestamp.fromMillis(Date.now()+3600000),state:'ready'},
      'workspaces/w2':{expiresAt:Timestamp.fromMillis(Date.now()+3600000),state:'ready'},
      'workspaces/w1/members/a':{uid:'alice'},'workspaces/w1/members/b':{uid:'bob'},'workspaces/w2/members/e':{uid:'eve'},
      'workspaces/w1/approvals/one':{owner:'a'},'workspaces/w1/approvals/two':{owner:'b'},
      'workspaces/w1/memories/one':{owner:'a'},'workspaces/w1/receipts/one':{visibleTo:['a']},
      'workspaces/w1/activity/one':{visibleTo:['a']},'workspaces/w1/sources/private':{owner:'b'},
      'workspaces/w1/conversations/chat':{owner:'a'},'workspaces/w1/conversations/chat/messages/one':{text:'private'},
      'workspaces/w1/inbox/b/messages/one':{body:'private'},
      'workspaces/w1/contacts/a':{email:'alice@example.com'},'workspaces/w1/contacts/b':{email:'bob@example.com'},'workspaces/w1/rules/b/items/one':{mode:'deny'},
    }
    for (const [path,data] of Object.entries(seed)) await setDoc(doc(db,path),data)
  })
})
after(async () => {await env?.cleanup()})
test('workspace membership and private collections',async()=>{
  const db=env.authenticatedContext('alice').firestore()
  await assertSucceeds(getDoc(doc(db,'workspaces/w1')))
  await assertSucceeds(getDoc(doc(db,'workspaces/w1/members/b')))
  await assertSucceeds(getDoc(doc(db,'workspaces/w1/contacts/a')))
  for (const path of ['workspaces/w1/contacts/b','workspaces/w2','userBindings/alice','workspaces/w1/sources/private','workspaces/w1/inbox/b/messages/one','workspaces/w1/rules/b/items/one']) await assertFails(getDoc(doc(db,path)))
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'workspaces/w1')))
})
test('owner-filtered query succeeds; unfiltered and cross-owner reads fail',async()=>{
  const db=env.authenticatedContext('alice').firestore()
  await assertSucceeds(getDocs(query(collection(db,'workspaces/w1/approvals'),where('owner','==','a'))))
  await assertFails(getDocs(collection(db,'workspaces/w1/approvals')))
  await assertFails(getDoc(doc(db,'workspaces/w1/approvals/two')))
  await assertFails(getDoc(doc(env.authenticatedContext('eve').firestore(),'workspaces/w1/approvals/one')))
})
test('conversation and receipts are scoped; all client writes denied',async()=>{
  const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore()
  for (const path of ['workspaces/w1/conversations/chat/messages/one','workspaces/w1/receipts/one']) {
    await assertSucceeds(getDoc(doc(alice,path)));await assertFails(getDoc(doc(bob,path)))
  }
  for (const path of ['workspaces/w1','userBindings/alice','workspaces/w1/approvals/one','workspaces/w1/members/a']) await assertFails(setDoc(doc(alice,path),{owner:'a',uid:'alice'}))
})
