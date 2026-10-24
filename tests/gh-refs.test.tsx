import { expect, test } from 'claude-code/testing'

import { buildQuery, findRefs, summarize, toCard } from '../hooks/register'

test('finds refs, summarizes, and draws a chip under a reply', { options: { defaultRepo: 'octo/app' } }, async ($, on) => {
  expect(
    findRefs(
      'See [plain words](https://github.com/octo/app/issues/43), pull/202: ' +
        'https://github.com/octo/app/pull/202, cli/cli#9 and #7. Color #fff, heading # 3.',
    ),
  ).toEqual(['octo/app#43', 'octo/app#202', 'cli/cli#9', 'cli/cli#7'])
  expect(findRefs('Only #5 here', 'me/app')).toEqual(['me/app#5'])
  expect(findRefs('Only #5 here')).toEqual([])

  expect(summarize('Pilot feedback FR-04.\n\n## Summary\nEdit **rules** in the guide.\n\n## Requirements\n- x')).toBe(
    'Edit rules in the guide.',
  )

  const card = toCard(
    {
      __typename: 'Issue',
      title: 'T',
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
      milestone: { title: 'M' },
      labels: { nodes: [{ name: 'pilot' }] },
      body: 'Body.',
      parent: { number: 2, title: 'Epic', labels: { nodes: [] }, parent: { number: 1, title: 'Big theme', labels: { nodes: [{ name: 'theme' }] } } },
    },
    0,
  )
  expect(card.state).toBe('not planned')
  expect(card.parent).toBe('Theme: #1 Big theme')
  expect(toCard(null, 0).state).toBe('unknown')
  expect(buildQuery(['a/b#1', 'c/d#2'])).toContain('r1: repository(owner: "c", name: "d") {  n1: issueOrPullRequest(number: 2)')

  on('clock.now', () => ({ value: 0 }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>reply body</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'gh-refs',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    surface: 'desktop',
    props: { text: 'Fixes #43.', isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Text', text: /^#43$/ }))?.text).toBe('#43')
  expect((await ui.find({ type: 'Text', text: /reply body/ }))?.text).toBe('reply body')
  await ui.unmount()
})
