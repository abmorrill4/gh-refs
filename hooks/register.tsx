import type { Register } from 'claude-code'

import type { Card } from '../types'

const TTL_MS = 5 * 60_000
const MAX_REFS = 12

const CARDS = { plugin: 'gh-refs', key: 'cards' } as const

const URL_RE = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g
const LONG_RE = /(?<![\w./-])([\w.-]+\/[\w.-]+)#(\d+)\b/g
const BARE_RE = /(?<![\w/&#])#(\d+)\b/g
const repoOf = (ref: string): string => ref.split('#')[0] ?? ref

/** Every issue/PR the text names, as `owner/repo#n`, in order, deduped. */
export function findRefs(text: string, defaultRepo?: string): string[] {
  const found: { at: number; ref: string }[] = []
  for (const m of text.matchAll(URL_RE)) found.push({ at: m.index, ref: `${m[1]}#${m[2]}` })
  for (const m of text.matchAll(LONG_RE)) found.push({ at: m.index, ref: `${m[1]}#${m[2]}` })
  // a bare #n means the repo the reply last named in full, else the default; with neither it is skipped
  const last = found.sort((a, b) => a.at - b.at).at(-1)
  const bareRepo = last ? repoOf(last.ref) : defaultRepo
  if (bareRepo) for (const m of text.matchAll(BARE_RE)) found.push({ at: m.index, ref: `${bareRepo}#${m[1]}` })
  found.sort((a, b) => a.at - b.at)
  return [...new Set(found.map(f => f.ref))].slice(0, MAX_REFS)
}

/** One or two plain lines from a body: its Summary section if it has one, else its first paragraph. */
export function summarize(body: string): string {
  const text = body.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const section = /^#{1,6}\s*(?:summary|problem|overview|why)\b.*\n+([\s\S]*?)(?=\n#{1,6}\s|$)/im.exec(text)?.[1] ?? text
  const para =
    section
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .find(p => p && !/^(#|```|- \[|\||🤖)/.test(p)) ?? ''
  const flat = para
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > 220 ? flat.slice(0, 217).replace(/\s+\S*$/, '') + '…' : flat
}

type Labels = { nodes: { name: string }[] }
type Parent = { number: number; title: string; labels: Labels; parent?: Parent | null }
type Node = {
  __typename: 'Issue' | 'PullRequest'
  title: string
  state: string
  stateReason?: string | null
  isDraft?: boolean
  milestone: { title: string } | null
  labels: Labels
  body: string
  parent?: Parent | null
}

const isTheme = (p: Parent | null | undefined): p is Parent => !!p && p.labels.nodes.some(l => l.name === 'theme')

export function toCard(node: Node | null | undefined, fetchedAt: number): Card {
  if (!node) return { kind: 'Issue', title: 'Not found, or no access', state: 'unknown', labels: [], summary: '', fetchedAt }
  const isPr = node.__typename === 'PullRequest'
  const reason = node.stateReason === 'NOT_PLANNED' ? 'not planned' : node.stateReason === 'DUPLICATE' ? 'duplicate' : 'closed'
  const state = node.state === 'OPEN' && node.isDraft ? 'draft' : node.state === 'CLOSED' && !isPr ? reason : node.state.toLowerCase()
  const theme = [node.parent, node.parent?.parent].find(isTheme)
  return {
    kind: isPr ? 'PR' : 'Issue',
    title: node.title,
    state,
    milestone: node.milestone?.title,
    labels: node.labels.nodes.map(l => l.name).filter(n => n !== 'theme'),
    parent: theme
      ? `Theme: #${theme.number} ${theme.title}`
      : node.parent
        ? `Part of #${node.parent.number} ${node.parent.title}`
        : undefined,
    summary: summarize(node.body ?? ''),
    fetchedAt,
  }
}

const FRAGMENTS = `
fragment P on Issue { number title labels(first: 20) { nodes { name } } }
fragment F on IssueOrPullRequest {
  __typename
  ... on Issue { title state stateReason milestone { title } labels(first: 20) { nodes { name } } body parent { ...P parent { ...P } } }
  ... on PullRequest { title state isDraft milestone { title } labels(first: 20) { nodes { name } } body }
}`


/** One GraphQL query for every ref: `r<i>` per repo, `n<j>` per ref (j its index in `refs`). */
export function buildQuery(refs: string[]): string {
  const repos = [...new Set(refs.map(repoOf))]
  const parts = repos.map((repo, i) => {
    const [owner, name] = repo.split('/') as [string, string]
    const items = refs
      .map((ref, j) => (repoOf(ref) === repo ? `n${j}: issueOrPullRequest(number: ${ref.split('#')[1]}) { ...F }` : ''))
      .join(' ')
    return `r${i}: repository(owner: "${owner}", name: "${name}") { ${items} }`
  })
  return `{ ${parts.join('\n')} }${FRAGMENTS}`
}

const COLOR: Record<string, string> = {
  open: 'success',
  draft: 'subtle',
  merged: 'merged',
  closed: 'merged',
  'not planned': 'subtle',
  duplicate: 'subtle',
  unknown: 'warning',
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

export const register: Register = (on, options) => {
  const wanted = new Set<string>()
  const triedAt = new Map<string, number>()
  let isBusy = false
  // bare #n refs: the defaultRepo setting, else the GitHub repo of the session's folder
  let defaultRepo = String(options.defaultRepo ?? '').trim()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!REPO_RE.test(defaultRepo)) {
      const run = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).catch(() => undefined)
      defaultRepo = run?.exitCode === 0 ? run.stdout.trim() : ''
    }
    $.clock.every(1000, async () => {
      if (isBusy || wanted.size === 0) return
      isBusy = true
      const refs = [...wanted]
      wanted.clear()
      try {
        const now = await $.clock.now()
        refs.forEach(ref => triedAt.set(ref, now))
        // gh exits 1 when any ref is missing but still prints the others
        const run = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${buildQuery(refs)}`], { timeoutMs: 20_000 })
        const data = JSON.parse(run.stdout || '{}').data
        if (!data) return $.ui.log(`gh-refs: gh failed: ${run.stderr.slice(0, 300)}`, { to: 'debug' })
        const repos = [...new Set(refs.map(repoOf))]
        const fresh: Record<string, Card> = {}
        refs.forEach((ref, j) => {
          fresh[ref] = toCard(data[`r${repos.indexOf(repoOf(ref))}`]?.[`n${j}`], now)
        })
        // ponytail: get-then-set is safe while this timer is the only writer
        const { value: all = {} } = await $.state.get(CARDS)
        await $.state.set(CARDS, { ...all, ...fresh })
      } catch (err) {
        $.ui.log(`gh-refs: ${String(err)}`, { to: 'debug' })
      } finally {
        isBusy = false
      }
    })
    return started
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const refs = findRefs(e.props.text, defaultRepo || undefined)
    if (refs.length === 0) return drawn

    const { value: all = {} } = await $.state.get(CARDS)
    const now = await $.clock.now()
    for (const ref of refs) {
      const isStale = !all[ref] || now - all[ref].fetchedAt > TTL_MS
      if (isStale && now - (triedAt.get(ref) ?? 0) > 60_000) wanted.add(ref)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(30, Math.min(72, (e.viewport?.columns ?? 80) - 4))
    const scope = (i: number) => `${String(e.requestId).slice(-40)}:${i}`
    const label = (ref: string) => (repoOf(ref) === defaultRepo ? `#${ref.split('#')[1]}` : ref.split('/')[1])
    const colorOf = (card: Card | undefined) => (card ? COLOR[card.state] ?? 'text' : 'subtle')

    return (
      <Box flexDirection="column">
        {drawn}
        <Box height={0}>
          {refs.map((ref, i) => {
            const card = all[ref]
            return (
              <Box
                position="absolute"
                bottom={0}
                left={0}
                width={width}
                display="none"
                hover={{ scope: scope(i), display: 'flex' }}
                flexDirection="column"
                borderStyle="round"
                borderColor={colorOf(card)}
                backgroundColor="inverseText"
                paddingX={1}
              >
                <Text bold>
                  {label(ref)} {card?.title ?? 'Loading…'}
                </Text>
                {card && (
                  <Text color={colorOf(card)}>
                    {card.kind} · {card.state}
                    {card.milestone ? ` · ${card.milestone}` : ''}
                  </Text>
                )}
                {card && card.labels.length > 0 && <Text dimColor>{card.labels.join(', ')}</Text>}
                {card?.parent && <Text>{card.parent}</Text>}
                {card?.summary && <Text dimColor>{card.summary}</Text>}
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {refs.map((ref, i) => (
            <Box hover={{ scope: scope(i), backgroundColor: 'subtle' }}>
              <Text color={colorOf(all[ref])}>{label(ref)}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
