import { computed, ref } from 'vue'
import { defaultLinks } from '../data/defaultLinks'
import type { ImportMode, NavLink, NavLinkMutation } from '../types/nav'

const LINKS_STORAGE_KEY = 'asmr-nav.links.v1'
const TOKEN_STORAGE_KEY = 'asmr-nav.session-token'
const COMMON_CATEGORY = '常用推荐'
const COLLECTION_CATEGORY = '收藏'
const RECOMMEND_CATEGORY = '推荐'

type SyncState = 'idle' | 'loading' | 'saving'
type CategoryInfo = {
  name: string
  sortOrder: number
}

const links = ref<NavLink[]>([])
const categoryOrders = ref<Record<string, number>>({})
const hydrated = ref(false)
const backendReachable = ref(false)
const syncState = ref<SyncState>('idle')
const authToken = ref('')

let attemptedRemoteBootstrap = false

function cloneDefaults() {
  return defaultLinks.map((link) => ({ ...link }))
}

function normalizeCategoryOrders(infos: CategoryInfo[] = []) {
  return infos.reduce<Record<string, number>>((orders, info) => {
    const name = normalizeCategory(info.name)
    const sortOrder = Number(info.sortOrder)

    if (name && Number.isFinite(sortOrder)) {
      orders[name] = sortOrder
    }

    return orders
  }, {})
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `link-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeUrl(raw: string) {
  const value = raw.trim()

  if (!value || value === '#') {
    return value
  }

  try {
    return new URL(value).toString()
  } catch {
    try {
      return new URL(`https://${value}`).toString()
    } catch {
      return ''
    }
  }
}

function sanitizeLink(raw: unknown): NavLink | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<NavLink>
  const title = candidate.title?.trim() ?? ''
  const url = normalizeUrl(candidate.url ?? '')
  const rawCategory = candidate.category ?? ''
  const category = normalizeCategory(rawCategory)
  const isCommon = Boolean(candidate.isCommon) || rawCategory.trim() === COMMON_CATEGORY

  if (!title || !url || !category) {
    return null
  }

  const createdAt = candidate.createdAt && !Number.isNaN(Date.parse(candidate.createdAt))
    ? candidate.createdAt
    : new Date().toISOString()
  const updatedAt = candidate.updatedAt && !Number.isNaN(Date.parse(candidate.updatedAt))
    ? candidate.updatedAt
    : createdAt

  return {
    id: candidate.id?.trim() || createId(),
    title,
    url,
    category,
    description: candidate.description?.trim() ?? '',
    icon: candidate.icon?.trim().slice(0, 3) ?? '',
    isCommon,
    sortOrder: Number.isFinite(candidate.sortOrder) ? Number(candidate.sortOrder) : 0,
    createdAt,
    updatedAt,
  }
}

function sortLinks(list: NavLink[]) {
  return [...list].sort((left, right) => {
    const categoryDiff = categoryRank(left.category) - categoryRank(right.category)

    if (categoryDiff !== 0) {
      return categoryDiff
    }

    if (left.category !== right.category) {
      return left.category.localeCompare(right.category, 'zh-CN')
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'zh-CN')
  })
}

function categoryRank(category: string) {
  if (category in categoryOrders.value) {
    return categoryOrders.value[category]
  }

  if (category === COLLECTION_CATEGORY) {
    return 1
  }

  if (category === RECOMMEND_CATEGORY) {
    return 2
  }

  return 10
}

function normalizeCategory(value: string) {
  const category = value.trim()
  return category === COMMON_CATEGORY ? COLLECTION_CATEGORY : category
}

function persistLocalSnapshot() {
  localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links.value))
}

function applyLinks(nextLinks: NavLink[]) {
  links.value = sortLinks(nextLinks)
  persistLocalSnapshot()
}

function getApiBase() {
  const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
  return configuredBase.replace(/\/$/, '')
}

function buildApiUrl(path: string) {
  const base = getApiBase()
  return base ? `${base}${path}` : path
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
    if (!authToken.value) {
      throw new Error('请先输入后台密码登录。')
    }

    headers.set('Authorization', `Bearer ${authToken.value}`)
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

function hydrate() {
  if (hydrated.value || typeof window === 'undefined') {
    return
  }

  authToken.value = sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''

  try {
    const raw = localStorage.getItem(LINKS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const localLinks = Array.isArray(parsed)
      ? parsed.map((item) => sanitizeLink(item)).filter(Boolean) as NavLink[]
      : []

    links.value = sortLinks(localLinks.length ? localLinks : cloneDefaults())
  } catch {
    links.value = sortLinks(cloneDefaults())
  }

  hydrated.value = true
}

function setAuthToken(value: string) {
  authToken.value = value.trim()

  if (!authToken.value) {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    return
  }

  sessionStorage.setItem(TOKEN_STORAGE_KEY, authToken.value)
}

async function refreshLinks(options: { force?: boolean; silent?: boolean } = {}) {
  hydrate()

  if (attemptedRemoteBootstrap && !options.force) {
    return
  }

  attemptedRemoteBootstrap = true

  if (!options.silent) {
    syncState.value = 'loading'
  }

  try {
    const payload = await requestJson<{ items: NavLink[]; categories?: CategoryInfo[] }>('/api/links')
    const nextLinks = payload.items.map((item) => sanitizeLink(item)).filter(Boolean) as NavLink[]
    categoryOrders.value = normalizeCategoryOrders(payload.categories)
    applyLinks(nextLinks)
    backendReachable.value = true
  } catch {
    backendReachable.value = false
  } finally {
    syncState.value = 'idle'
  }
}

async function login(password: string) {
  hydrate()
  const payload = await requestJson<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

  setAuthToken(payload.token)
  backendReachable.value = true
  await refreshLinks({ force: true, silent: true })
}

async function validateSession() {
  hydrate()

  if (!authToken.value) {
    return false
  }

  try {
    await requestJson<{ ok: true }>('/api/auth/me', {}, { auth: true })
    backendReachable.value = true
    return true
  } catch {
    setAuthToken('')
    return false
  }
}

function logout() {
  setAuthToken('')
}

function buildLocalCandidate(input: NavLinkMutation) {
  const existing = input.id ? links.value.find((link) => link.id === input.id) : null
  const timestamp = new Date().toISOString()
  const candidate = sanitizeLink({
    ...input,
    id: existing?.id ?? input.id ?? createId(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })

  if (!candidate) {
    throw new Error('请至少填写标题、链接和分类。')
  }

  return { existing, candidate }
}

async function saveLink(input: NavLinkMutation) {
  hydrate()
  syncState.value = 'saving'

  try {
    const path = input.id ? `/api/links/${input.id}` : '/api/links'
    const method = input.id ? 'PUT' : 'POST'
    const payload = await requestJson<{ item: NavLink }>(
      path,
      {
        method,
        body: JSON.stringify(input),
      },
      { auth: true },
    )

    await refreshLinks({ force: true, silent: true })
    return payload.item
  } catch (error) {
    if (backendReachable.value || authToken.value) {
      throw error
    }

    const { existing, candidate } = buildLocalCandidate(input)

    if (existing) {
      applyLinks(links.value.map((link) => (link.id === existing.id ? candidate : link)))
      return candidate
    }

    applyLinks([...links.value, candidate])
    return candidate
  } finally {
    syncState.value = 'idle'
  }
}

async function deleteLink(id: string) {
  hydrate()
  syncState.value = 'saving'

  try {
    await requestJson<{ ok: true }>(`/api/links/${id}`, { method: 'DELETE' }, { auth: true })
    await refreshLinks({ force: true, silent: true })
  } finally {
    syncState.value = 'idle'
  }
}

async function renameCategory(fromCategory: string, toCategory: string) {
  hydrate()
  const from = normalizeCategory(fromCategory)
  const to = normalizeCategory(toCategory)

  if (!from || !to) {
    throw new Error('请填写分类名称。')
  }

  if (from === to) {
    return 0
  }

  syncState.value = 'saving'

  try {
    const payload = await requestJson<{ updated: number }>(
      '/api/categories/rename',
      {
        method: 'POST',
        body: JSON.stringify({ from, to }),
      },
      { auth: true },
    )

    await refreshLinks({ force: true, silent: true })
    return payload.updated
  } catch (error) {
    if (backendReachable.value || authToken.value) {
      throw error
    }

    const updated = links.value.filter((link) => link.category === from).length

    if (updated > 0) {
      applyLinks(links.value.map((link) => (
        link.category === from
          ? { ...link, category: to, updatedAt: new Date().toISOString() }
          : link
      )))
    }

    return updated
  } finally {
    syncState.value = 'idle'
  }
}

async function updateCategoryOrder(nextCategories: string[]) {
  hydrate()
  const normalizedCategories = Array.from(new Set(nextCategories.map(normalizeCategory).filter(Boolean)))

  if (!normalizedCategories.length) {
    return
  }

  syncState.value = 'saving'

  try {
    await requestJson<{ ok: true }>(
      '/api/categories/order',
      {
        method: 'POST',
        body: JSON.stringify({ categories: normalizedCategories }),
      },
      { auth: true },
    )

    await refreshLinks({ force: true, silent: true })
  } catch (error) {
    if (backendReachable.value || authToken.value) {
      throw error
    }

    categoryOrders.value = normalizedCategories.reduce<Record<string, number>>((orders, category, index) => {
      orders[category] = (index + 1) * 10
      return orders
    }, {})
    applyLinks(links.value)
  } finally {
    syncState.value = 'idle'
  }
}

function exportLinks() {
  hydrate()
  return JSON.stringify(links.value, null, 2)
}

async function importLinks(rawJson: string, mode: ImportMode) {
  hydrate()
  const parsed = JSON.parse(rawJson)
  const candidateItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.links)
      ? parsed.links
      : null

  if (!candidateItems) {
    throw new Error('导入内容必须是数组，或包含 links 数组字段。')
  }

  const imported = candidateItems.map((item: unknown) => sanitizeLink(item)).filter(Boolean) as NavLink[]

  if (!imported.length) {
    throw new Error('没有解析到有效链接。')
  }

  await requestJson<{ imported: number }>(
    `/api/links/import?mode=${mode}`,
    {
      method: 'POST',
      body: JSON.stringify({ items: imported }),
    },
    { auth: true },
  )
  await refreshLinks({ force: true, silent: true })
  return imported.length
}

const categories = computed(() => {
  const names = Array.from(new Set(links.value.map((link) => link.category)))
  return names.sort((left, right) => {
    const diff = categoryRank(left) - categoryRank(right)
    return diff || left.localeCompare(right, 'zh-CN')
  })
})

export function useNavLibrary() {
  hydrate()
  void refreshLinks({ silent: true })

  return {
    links,
    categories,
    backendReachable,
    syncState,
    authToken,
    login,
    logout,
    validateSession,
    refreshLinks,
    saveLink,
    deleteLink,
    renameCategory,
    updateCategoryOrder,
    exportLinks,
    importLinks,
  }
}
