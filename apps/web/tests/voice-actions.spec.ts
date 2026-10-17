import { expect, test } from '@playwright/test'

test('spoken card and design commands resolve to the intended actions', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { workSurface, requestedCard, designEdit } = await import('/src/agent/navigation.ts')
    return {
      cards: [1, 2, 3, 4].map((n) => requestedCard(`Alter, can you open card ${n}?`)),
      second: requestedCard('Show me the second card'),
      surfaces: ['open card one', 'please open card two', 'show card three', 'open the architecture'].map(workSurface),
      edit: designEdit('Change the arch to include a retry state'),
      question: designEdit('What is the architecture?'),
    }
  })
  expect(result).toEqual({
    cards: [1, 2, 3, 4],
    second: 2,
    surfaces: ['meet', 'plan', 'approvals', 'plan'],
    edit: true,
    question: false,
  })
})
