import { computed, ref } from 'vue'
import type { ListenItem, ListenPlatform, ListenSource, ListenSourceMutation } from '../types/listen'

const TOKEN_STORAGE_KEY = 'asmr-nav.session-token'

type ListenSyncState = 'idle' | 'loading' | 'saving' | 'syncing'

const sources = ref<ListenSource[]>([])
const syncState = ref<ListenSyncState>('idle')
const lastRandomItem = ref<ListenItem | null>(null)

function getApiBase() {
  const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
  return configuredBase.replace(/\/$/, '')
}

function buildApiUrl(path: string) {
  const base = getApiBase()
  return base ? `${base}${path}` : path
}

function getAuthToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
}

async function parseResponseError(response: Response) {
  try {
    const payload = await response.json() as { error?: string }
    return payload.error || `请求失败：${response.status}`
  } catch {
    return `请求失败：${response.status}`
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: boolean } = {},
) {
  const headers = new Headers(init.headers ?? {})
  headers.set('Accept', 'application/json')

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.auth) {
    const token = getAuthToken()

    if (!token) {
      throw new Error('请先进入后台。')
    }

    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw new Error(await parseResponseError(response))
  }

  return response.json() as Promise<T>
}

function normalizeSource(source: ListenSource): ListenSource {
  return {
    ...source,
    tags: Array.isArray(source.tags) ? source.tags : [],
    enabled: Boolean(source.enabled),
    itemCount: Number(source.itemCount ?? 0),
  }
}

async function refreshSources() {
  syncState.value = 'loading'

  try {
    const payload = await requestJson<{ items: ListenSource[] }>('/api/listen/sources', {}, { auth: true })
    sources.value = payload.items.map(normalizeSource)
  } finally {
    syncState.value = 'idle'
  }
}

async function saveSource(input: ListenSourceMutation) {
  syncState.value = 'saving'

  try {
    const path = input.id ? `/api/listen/sources/${input.id}` : '/api/listen/sources'
    const method = input.id ? 'PUT' : 'POST'
    const payload = await requestJson<{ item: ListenSource }>(
      path,
      {
        method,
        body: JSON.stringify(input),
      },
      { auth: true },
    )

    await refreshSources()
    return normalizeSource(payload.item)
  } finally {
    syncState.value = 'idle'
  }
}

async function deleteSource(id: string) {
  syncState.value = 'saving'

  try {
    await requestJson<{ ok: true }>(`/api/listen/sources/${id}`, { method: 'DELETE' }, { auth: true })
    await refreshSources()
  } finally {
    syncState.value = 'idle'
  }
}

async function testSource(input: ListenSourceMutation) {
  syncState.value = 'syncing'

  try {
    return await requestJson<{ ok: true; fetchUrl: string; count: number; sample: ListenItem[] }>(
      '/api/listen/test',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      { auth: true },
    )
  } finally {
    syncState.value = 'idle'
  }
}

async function syncSource(id: string) {
  syncState.value = 'syncing'

  try {
    const payload = await requestJson<{ imported: number; source: ListenSource | null }>(
      `/api/listen/sources/${id}/sync`,
      { method: 'POST' },
      { auth: true },
    )
    await refreshSources()
    return payload
  } finally {
    syncState.value = 'idle'
  }
}

async function loadMoreSource(id: string) {
  syncState.value = 'syncing'

  try {
    const payload = await requestJson<{ imported: number; source: ListenSource | null; hasMore: boolean }>(
      `/api/listen/sources/${id}/more`,
      { method: 'POST' },
      { auth: true },
    )
    await refreshSources()
    return payload
  } finally {
    syncState.value = 'idle'
  }
}

async function syncAllSources() {
  syncState.value = 'syncing'

  try {
    const payload = await requestJson<{ synced: number; failed: number; checked: number }>(
      '/api/listen/sync',
      { method: 'POST' },
      { auth: true },
    )
    await refreshSources()
    return payload
  } finally {
    syncState.value = 'idle'
  }
}

async function getRandomItem(options: { platform?: ListenPlatform; sourceId?: string; freshDays?: number } = {}) {
  const params = new URLSearchParams()

  if (options.platform) {
    params.set('platform', options.platform)
  }

  if (options.sourceId) {
    params.set('sourceId', options.sourceId)
  }

  if (options.freshDays) {
    params.set('freshDays', String(options.freshDays))
  }

  const query = params.toString()
  const payload = await requestJson<{ item: ListenItem | null }>(`/api/listen/random${query ? `?${query}` : ''}`)
  lastRandomItem.value = payload.item
  return payload.item
}

const enabledSources = computed(() => sources.value.filter((source) => source.enabled))

export function useListenLibrary() {
  return {
    sources,
    enabledSources,
    syncState,
    lastRandomItem,
    refreshSources,
    saveSource,
    deleteSource,
    testSource,
    syncSource,
    loadMoreSource,
    syncAllSources,
    getRandomItem,
  }
}
