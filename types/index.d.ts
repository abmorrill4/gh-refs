export type Card = {
  kind: 'Issue' | 'PR'
  title: string
  state: string
  milestone?: string
  labels: string[]
  parent?: string
  summary: string
  fetchedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'gh-refs': { cards: Record<string, Card> }
  }
}
