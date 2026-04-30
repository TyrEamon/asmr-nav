export type ListenPlatform = 'youtube' | 'rsshub' | 'rss' | 'other'

export interface ListenSource {
  id: string
  title: string
  feedUrl: string
  platform: ListenPlatform
  tags: string[]
  enabled: boolean
  sortOrder: number
  lastFetchedAt: string
  lastStatus: string
  lastError: string
  itemCount: number
  createdAt: string
  updatedAt: string
}

export type ListenSourceMutation = Omit<
  ListenSource,
  'id' | 'lastFetchedAt' | 'lastStatus' | 'lastError' | 'itemCount' | 'createdAt' | 'updatedAt'
> & {
  id?: string
}

export interface ListenItem {
  id: string
  sourceId: string
  sourceTitle: string
  title: string
  url: string
  author: string
  platform: ListenPlatform
  publishedAt: string
  summary: string
  cover: string
  tags: string[]
  guid: string
  fetchedAt: string
}
