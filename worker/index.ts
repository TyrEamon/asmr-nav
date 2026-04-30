import { defaultLinks } from '../src/data/defaultLinks'
import type { ListenItem, ListenPlatform, ListenSource } from '../src/types/listen'
import type { NavLink } from '../src/types/nav'

interface AssetBinding {
  fetch(request: Request | string | URL): Promise<Response>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
  exec(query: string): Promise<unknown>
}

interface Env {
  ASSETS: AssetBinding
  ASMR_DB: D1DatabaseLike
  ADMIN_PASSWORD?: string
  SESSION_SECRET?: string
  SESSION_TTL_SECONDS?: string
  AUTO_SEED_DEFAULTS?: string
  RSSHUB_BASE_URL?: string
  FEED_SYNC_INTERVAL_MINUTES?: string
}

interface LinkRow {
  id: string
  title: string
  url: string
  category: string
  description: string
  icon: string
  is_common: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

interface LinkInput {
  title: string
  url: string
  category: string
  description: string
  icon: string
  isCommon: boolean
  sortOrder: number
}

interface CategoryRenameInput {
  from: string
  to: string
}

interface CategoryOrderInput {
  categories: string[]
}

interface CategoryRow {
  name: string
  sort_order: number
}

interface ListenSourceRow {
  id: string
  title: string
  feed_url: string
  platform: string
  tags: string
  enabled: number
  sort_order: number
  last_fetched_at: string
  last_fetch_url: string
  next_cursor: string
  last_status: string
  last_error: string
  item_count: number | string | null
  created_at: string
  updated_at: string
}

interface ListenItemRow {
  id: string
  source_id: string
  source_title: string
  title: string
  url: string
  author: string
  platform: string
  published_at: string
  summary: string
  cover: string
  tags: string
  guid: string
  fetched_at: string
}

interface ListenSourceInput {
  title: string
  feedUrl: string
  platform: ListenPlatform
  tags: string[]
  enabled: boolean
  sortOrder: number
}

interface ParsedFeedItem {
  title: string
  url: string
  author: string
  publishedAt: string
  summary: string
  cover: string
  guid: string
}

interface ParsedFeedResult {
  fetchUrl: string
  items: ListenItem[]
  nextCursor: string
}

interface YouTubeShell {
  html: string
  fetchUrl: string
  apiKey: string
  clientVersion: string
}

interface SessionPayload {
  iat: number
  exp: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
}
const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  'CREATE TABLE IF NOT EXISTS link_common (link_id TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS category_meta (category TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 100)',
  "CREATE TABLE IF NOT EXISTS listen_sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, feed_url TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'rss', tags TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 100, last_fetched_at TEXT NOT NULL DEFAULT '', last_fetch_url TEXT NOT NULL DEFAULT '', next_cursor TEXT NOT NULL DEFAULT '', last_status TEXT NOT NULL DEFAULT 'idle', last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS listen_items (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'rss', published_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', guid TEXT NOT NULL, fetched_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_id, guid))",
  "INSERT OR IGNORE INTO link_common (link_id) SELECT id FROM links WHERE category = '常用推荐'",
  "UPDATE links SET category = '收藏' WHERE category = '常用推荐'",
  "INSERT OR IGNORE INTO category_meta (category, sort_order) SELECT DISTINCT category, CASE category WHEN '收藏' THEN 10 WHEN '推荐' THEN 20 ELSE 100 END FROM links",
  'CREATE INDEX IF NOT EXISTS idx_links_category_sort ON links(category, sort_order, title COLLATE NOCASE)',
  'CREATE INDEX IF NOT EXISTS idx_links_updated ON links(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_listen_sources_sort ON listen_sources(enabled DESC, sort_order ASC, title COLLATE NOCASE)',
  'CREATE INDEX IF NOT EXISTS idx_listen_items_random ON listen_items(platform, published_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_listen_items_source ON listen_items(source_id, published_at DESC)',
]
const LISTEN_PAGE_SIZE = 30
const LISTEN_MAX_ITEMS_PER_SOURCE = 300

let schemaReady: Promise<void> | null = null

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  })
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

function normalizePlatform(value: string): ListenPlatform {
  const platform = value.trim().toLowerCase()

  if (platform === 'youtube' || platform === 'rsshub' || platform === 'rss') {
    return platform
  }

  return 'other'
}

function normalizeTags(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,，\n]/)
      : []

  return Array.from(new Set(
    values
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .slice(0, 12),
  ))
}

function parseStoredTags(raw: string) {
  try {
    return normalizeTags(JSON.parse(raw))
  } catch {
    return normalizeTags(raw)
  }
}

function normalizeFeedUrl(raw: string) {
  const value = raw.trim()

  if (!value) {
    return ''
  }

  if (value.startsWith('/')) {
    return value
  }

  return normalizeUrl(value)
}

function buildListenSourcePayload(raw: unknown): ListenSourceInput | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<ListenSourceInput> & { tags?: unknown }
  const title = candidate.title?.trim() ?? ''
  const feedUrl = normalizeFeedUrl(candidate.feedUrl ?? '')
  const sortOrder = Number(candidate.sortOrder ?? 100)

  if (!title || !feedUrl) {
    return null
  }

  return {
    title,
    feedUrl,
    platform: normalizePlatform(candidate.platform ?? 'rss'),
    tags: normalizeTags(candidate.tags),
    enabled: candidate.enabled !== false,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
  }
}

function buildLinkPayload(raw: unknown): LinkInput | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<LinkInput>
  const title = candidate.title?.trim() ?? ''
  const url = normalizeUrl(candidate.url ?? '')
  const rawCategory = candidate.category ?? ''
  const category = normalizeCategory(rawCategory)
  const sortOrder = Number(candidate.sortOrder ?? 0)

  if (!title || !url || !category) {
    return null
  }

  return {
    title,
    url,
    category,
    description: candidate.description?.trim() ?? '',
    icon: candidate.icon?.trim().slice(0, 3) ?? '',
    isCommon: Boolean(candidate.isCommon) || rawCategory.trim() === '常用推荐',
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
  }
}

function buildCategoryRenamePayload(raw: unknown): CategoryRenameInput | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<CategoryRenameInput>
  const from = normalizeCategory(candidate.from ?? '')
  const to = normalizeCategory(candidate.to ?? '')

  if (!from || !to) {
    return null
  }

  return { from, to }
}

function buildCategoryOrderPayload(raw: unknown): CategoryOrderInput | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as { categories?: unknown }

  if (!Array.isArray(candidate.categories)) {
    return null
  }

  const categories = Array.from(new Set(
    candidate.categories
      .map((category) => normalizeCategory(String(category)))
      .filter(Boolean),
  ))

  return categories.length ? { categories } : null
}

function rowToLink(row: LinkRow): NavLink {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    category: normalizeCategory(row.category),
    description: row.description,
    icon: row.icon,
    isCommon: Boolean(row.is_common) || row.category === '常用推荐',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToListenSource(row: ListenSourceRow): ListenSource {
  return {
    id: row.id,
    title: row.title,
    feedUrl: row.feed_url,
    platform: normalizePlatform(row.platform),
    tags: parseStoredTags(row.tags),
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    lastFetchedAt: row.last_fetched_at,
    lastFetchUrl: row.last_fetch_url,
    nextCursor: row.next_cursor,
    lastStatus: row.last_status,
    lastError: row.last_error,
    itemCount: Number(row.item_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToListenItem(row: ListenItemRow): ListenItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    title: row.title,
    url: row.url,
    author: row.author,
    platform: normalizePlatform(row.platform),
    publishedAt: row.published_at,
    summary: row.summary,
    cover: row.cover,
    tags: parseStoredTags(row.tags),
    guid: row.guid,
    fetchedAt: row.fetched_at,
  }
}

function normalizeCategory(value: string) {
  const category = value.trim()
  return category === '常用推荐' ? '收藏' : category
}

function createId() {
  return crypto.randomUUID()
}

function ensureSchema(env: Env) {
  schemaReady ??= (async () => {
    for (const statement of SCHEMA_STATEMENTS) {
      await env.ASMR_DB.exec(statement)
    }
  })()
    .catch((error) => {
      schemaReady = null
      throw error
    })

  return schemaReady
}

async function ensureCategoryMeta(env: Env, category: string) {
  const sortOrder = category === '收藏'
    ? 10
    : category === '推荐'
      ? 20
      : 100

  await env.ASMR_DB
    .prepare('INSERT OR IGNORE INTO category_meta (category, sort_order) VALUES (?, ?)')
    .bind(category, sortOrder)
    .run()
}

async function listLinks(env: Env) {
  const result = await env.ASMR_DB
    .prepare(`
      SELECT
        links.id,
        links.title,
        links.url,
        links.category,
        links.description,
        links.icon,
        CASE WHEN link_common.link_id IS NULL THEN 0 ELSE 1 END AS is_common,
        links.sort_order,
        links.created_at,
        links.updated_at
      FROM links
      LEFT JOIN link_common ON link_common.link_id = links.id
      LEFT JOIN category_meta ON category_meta.category = links.category
      ORDER BY
        COALESCE(category_meta.sort_order, CASE links.category WHEN '收藏' THEN 10 WHEN '推荐' THEN 20 ELSE 100 END),
        links.category COLLATE NOCASE ASC,
        links.sort_order ASC,
        links.title COLLATE NOCASE ASC
    `)
    .all<LinkRow>()

  return result.results.map(rowToLink)
}

async function listCategories(env: Env) {
  await env.ASMR_DB
    .prepare(`
      INSERT OR IGNORE INTO category_meta (category, sort_order)
      SELECT DISTINCT
        category,
        CASE category
          WHEN '收藏' THEN 10
          WHEN '推荐' THEN 20
          ELSE 100
        END
      FROM links
    `)
    .run()

  const result = await env.ASMR_DB
    .prepare(`
      SELECT
        links.category AS name,
        COALESCE(category_meta.sort_order, CASE links.category WHEN '收藏' THEN 10 WHEN '推荐' THEN 20 ELSE 100 END) AS sort_order
      FROM links
      LEFT JOIN category_meta ON category_meta.category = links.category
      GROUP BY links.category
      ORDER BY
        sort_order ASC,
        links.category COLLATE NOCASE ASC
    `)
    .all<CategoryRow>()

  return result.results.map((row) => ({
    name: normalizeCategory(row.name),
    sortOrder: Number(row.sort_order),
  }))
}

async function readLink(env: Env, id: string) {
  const row = await env.ASMR_DB
    .prepare(`
      SELECT
        links.id,
        links.title,
        links.url,
        links.category,
        links.description,
        links.icon,
        CASE WHEN link_common.link_id IS NULL THEN 0 ELSE 1 END AS is_common,
        links.sort_order,
        links.created_at,
        links.updated_at
      FROM links
      LEFT JOIN link_common ON link_common.link_id = links.id
      WHERE links.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LinkRow>()

  return row ? rowToLink(row) : null
}

async function writeLink(env: Env, input: LinkInput, id?: string) {
  const existing = id ? await readLink(env, id) : null
  const now = new Date().toISOString()
  const linkId = existing?.id ?? id ?? createId()
  const createdAt = existing?.createdAt ?? now

  await env.ASMR_DB
    .prepare(`
      INSERT INTO links (
        id,
        title,
        url,
        category,
        description,
        icon,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        category = excluded.category,
        description = excluded.description,
        icon = excluded.icon,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `)
    .bind(
      linkId,
      input.title,
      input.url,
      input.category,
      input.description,
      input.icon,
      input.sortOrder,
      createdAt,
      now,
    )
    .run()

  await ensureCategoryMeta(env, input.category)

  if (input.isCommon) {
    await env.ASMR_DB
      .prepare('INSERT OR IGNORE INTO link_common (link_id) VALUES (?)')
      .bind(linkId)
      .run()
  } else {
    await env.ASMR_DB
      .prepare('DELETE FROM link_common WHERE link_id = ?')
      .bind(linkId)
      .run()
  }

  return readLink(env, linkId)
}

async function listListenSources(env: Env) {
  const result = await env.ASMR_DB
    .prepare(`
      SELECT
        listen_sources.id,
        listen_sources.title,
        listen_sources.feed_url,
        listen_sources.platform,
        listen_sources.tags,
        listen_sources.enabled,
        listen_sources.sort_order,
        listen_sources.last_fetched_at,
        listen_sources.last_fetch_url,
        listen_sources.next_cursor,
        listen_sources.last_status,
        listen_sources.last_error,
        listen_sources.created_at,
        listen_sources.updated_at,
        COUNT(listen_items.id) AS item_count
      FROM listen_sources
      LEFT JOIN listen_items ON listen_items.source_id = listen_sources.id
      GROUP BY listen_sources.id
      ORDER BY listen_sources.enabled DESC, listen_sources.sort_order ASC, listen_sources.title COLLATE NOCASE ASC
    `)
    .all<ListenSourceRow>()

  return result.results.map(rowToListenSource)
}

async function readListenSource(env: Env, id: string) {
  const row = await env.ASMR_DB
    .prepare(`
      SELECT
        listen_sources.id,
        listen_sources.title,
        listen_sources.feed_url,
        listen_sources.platform,
        listen_sources.tags,
        listen_sources.enabled,
        listen_sources.sort_order,
        listen_sources.last_fetched_at,
        listen_sources.last_fetch_url,
        listen_sources.next_cursor,
        listen_sources.last_status,
        listen_sources.last_error,
        listen_sources.created_at,
        listen_sources.updated_at,
        COUNT(listen_items.id) AS item_count
      FROM listen_sources
      LEFT JOIN listen_items ON listen_items.source_id = listen_sources.id
      WHERE listen_sources.id = ?
      GROUP BY listen_sources.id
      LIMIT 1
    `)
    .bind(id)
    .first<ListenSourceRow>()

  return row ? rowToListenSource(row) : null
}

async function writeListenSource(env: Env, input: ListenSourceInput, id?: string) {
  const existing = id ? await readListenSource(env, id) : null
  const now = new Date().toISOString()
  const sourceId = existing?.id ?? id ?? createId()
  const createdAt = existing?.createdAt ?? now
  const feedChanged = existing ? existing.feedUrl !== input.feedUrl : false

  await env.ASMR_DB
    .prepare(`
      INSERT INTO listen_sources (
        id,
        title,
        feed_url,
        platform,
        tags,
        enabled,
        sort_order,
        last_fetched_at,
        last_fetch_url,
        next_cursor,
        last_status,
        last_error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        feed_url = excluded.feed_url,
        platform = excluded.platform,
        tags = excluded.tags,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `)
    .bind(
      sourceId,
      input.title,
      input.feedUrl,
      input.platform,
      JSON.stringify(input.tags),
      input.enabled ? 1 : 0,
      input.sortOrder,
      feedChanged ? '' : existing?.lastFetchedAt ?? '',
      feedChanged ? '' : existing?.lastFetchUrl ?? '',
      feedChanged ? '' : existing?.nextCursor ?? '',
      feedChanged ? 'idle' : existing?.lastStatus ?? 'idle',
      feedChanged ? '' : existing?.lastError ?? '',
      createdAt,
      now,
    )
    .run()

  return readListenSource(env, sourceId)
}

async function deleteListenSource(env: Env, id: string) {
  await env.ASMR_DB.prepare('DELETE FROM listen_items WHERE source_id = ?').bind(id).run()
  await env.ASMR_DB.prepare('DELETE FROM listen_sources WHERE id = ?').bind(id).run()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'",
  }

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-zA-Z0-9#]+);/g, (match, name: string) => namedEntities[name] ?? match)
}

function stripHtml(value: string) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value: string, maxLength: number) {
  const text = stripHtml(value)
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function extractTag(block: string, tag: string) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'i')
  const match = block.match(pattern)
  return match ? stripHtml(match[1]) : ''
}

function extractBlocks(xml: string, tag: string) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'gi')
  return Array.from(xml.matchAll(pattern), (match) => match[0])
}

function extractAttrFromTag(tagText: string, attr: string) {
  const pattern = new RegExp(`${escapeRegExp(attr)}=["']([^"']+)["']`, 'i')
  const match = tagText.match(pattern)
  return match ? decodeEntities(match[1]).trim() : ''
}

function extractFirstTagAttr(block: string, tag: string, attr: string, requiredRel = '') {
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, 'gi')
  const matches = Array.from(block.matchAll(pattern), (match) => match[0])
  const preferred = requiredRel
    ? matches.find((tagText) => extractAttrFromTag(tagText, 'rel') === requiredRel)
    : matches[0]
  return preferred ? extractAttrFromTag(preferred, attr) : ''
}

function normalizeItemUrl(raw: string) {
  const value = normalizeUrl(raw)

  if (!value) {
    return ''
  }

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function normalizeDate(raw: string) {
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? new Date().toISOString() : new Date(timestamp).toISOString()
}

function extractJsonString(value: unknown) {
  return typeof value === 'string' ? stripHtml(value) : ''
}

function extractJsonAuthor(value: unknown, fallback = '') {
  if (typeof value === 'string') {
    return stripHtml(value)
  }

  if (value && typeof value === 'object') {
    const author = value as { name?: unknown }
    return extractJsonString(author.name)
  }

  return fallback
}

function parseJsonFeed(raw: unknown, source: ListenSource): ParsedFeedItem[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const payload = raw as { items?: unknown[] }

  if (!Array.isArray(payload.items)) {
    return []
  }

  return payload.items.map((item) => {
    const entry = item as Record<string, unknown>
    const authors = Array.isArray(entry.authors) ? entry.authors : []
    const author = extractJsonAuthor(entry.author, extractJsonAuthor(authors[0], source.title))
    const url = extractJsonString(entry.url)
      || extractJsonString(entry.link)
      || extractJsonString(entry.external_url)
    const publishedAt = extractJsonString(entry.date_published)
      || extractJsonString(entry.date_modified)
      || extractJsonString(entry.pubDate)
      || extractJsonString(entry.isoDate)

    return {
      title: extractJsonString(entry.title),
      url,
      author,
      publishedAt,
      summary: truncate(
        extractJsonString(entry.summary)
          || extractJsonString(entry.content_text)
          || extractJsonString(entry.content_html)
          || extractJsonString(entry.description),
        240,
      ),
      cover: normalizeItemUrl(
        extractJsonString(entry.image)
          || extractJsonString(entry.banner_image)
          || extractJsonString(entry.cover),
      ),
      guid: extractJsonString(entry.id) || extractJsonString(entry.guid) || url,
    }
  })
}

function parseXmlFeed(xml: string, source: ListenSource): ParsedFeedItem[] {
  const atomEntries = extractBlocks(xml, 'entry')

  if (atomEntries.length) {
    return atomEntries.map((entry) => {
      const link = extractFirstTagAttr(entry, 'link', 'href', 'alternate')
        || extractFirstTagAttr(entry, 'link', 'href')

      return {
        title: extractTag(entry, 'title'),
        url: link,
        author: extractTag(entry, 'name') || source.title,
        publishedAt: extractTag(entry, 'published') || extractTag(entry, 'updated'),
        summary: truncate(
          extractTag(entry, 'summary')
            || extractTag(entry, 'content')
            || extractTag(entry, 'media:description'),
          240,
        ),
        cover: normalizeItemUrl(
          extractFirstTagAttr(entry, 'media:thumbnail', 'url')
            || extractFirstTagAttr(entry, 'media:content', 'url'),
        ),
        guid: extractTag(entry, 'yt:videoId') || extractTag(entry, 'id') || link,
      }
    })
  }

  return extractBlocks(xml, 'item').map((item) => {
    const link = extractTag(item, 'link')

    return {
      title: extractTag(item, 'title'),
      url: link,
      author: extractTag(item, 'dc:creator') || extractTag(item, 'author') || source.title,
      publishedAt: extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated'),
      summary: truncate(
        extractTag(item, 'description')
          || extractTag(item, 'content:encoded')
          || extractTag(item, 'media:description'),
        240,
      ),
      cover: normalizeItemUrl(
        extractFirstTagAttr(item, 'media:thumbnail', 'url')
          || extractFirstTagAttr(item, 'media:content', 'url')
          || extractTag(item, 'enclosure'),
      ),
      guid: extractTag(item, 'guid') || link,
    }
  })
}

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'youtube.com'
      || host === 'www.youtube.com'
      || host === 'm.youtube.com'
  } catch {
    return false
  }
}

function isYouTubeStreamsUrl(value: string) {
  try {
    const url = new URL(value)
    return isYouTubeUrl(value) && url.pathname.split('/').filter(Boolean).includes('streams')
  } catch {
    return false
  }
}

function getYouTubeStreamsUrl(source: ListenSource) {
  const feedUrl = source.feedUrl.trim()

  if (isYouTubeStreamsUrl(feedUrl)) {
    return feedUrl
  }

  const rsshubChannelMatch = feedUrl.match(/\/youtube\/channel\/(UC[a-zA-Z0-9_-]+)/)

  if (rsshubChannelMatch) {
    return `https://www.youtube.com/channel/${rsshubChannelMatch[1]}/streams`
  }

  if (isYouTubeUrl(feedUrl)) {
    const url = new URL(feedUrl)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) {
      return `https://www.youtube.com/channel/${parts[1]}/streams`
    }

    if (parts[0]?.startsWith('@')) {
      return `https://www.youtube.com/${parts[0]}/streams`
    }
  }

  return ''
}

function extractYouTubeContinuationTokens(content: string) {
  const preferred = Array.from(
    content.matchAll(/"continuationItemRenderer":\{[\s\S]*?"continuationCommand":\{"token":"([^"]+)"/g),
    (match) => decodeURIComponent(match[1]),
  )
  const fallback = Array.from(
    content.matchAll(/"continuationCommand":\{"token":"([^"]+)"/g),
    (match) => decodeURIComponent(match[1]),
  )

  return Array.from(new Set((preferred.length ? preferred : fallback).filter(Boolean)))
}

function extractYouTubeShell(html: string, fetchUrl: string): YouTubeShell {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? ''
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
    || html.match(/"clientVersion":"([^"]+)"/)?.[1]
    || ''

  if (!apiKey || !clientVersion) {
    throw new Error('没有解析到 YouTube 翻页参数。')
  }

  return { html, fetchUrl, apiKey, clientVersion }
}

function extractYouTubeStreamsItems(html: string, source: ListenSource): ParsedFeedItem[] {
  const seen = new Set<string>()
  const items: ParsedFeedItem[] = []
  const rendererPattern = /"(?:videoRenderer|gridVideoRenderer|richItemRenderer)"\s*:\s*({[\s\S]*?})(?=,\s*"(?:videoRenderer|gridVideoRenderer|richItemRenderer|continuationItemRenderer|playlistRenderer|reelItemRenderer)"|\]\s*[,}])/g
  const fallbackPattern = /"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,2500}?"title":\{"runs":\[\{"text":"([^"]+)"/g

  function addItem(videoId: string, title: string, thumbnail = '', publishedAt = '') {
    if (!videoId || seen.has(videoId)) {
      return
    }

    const cleanTitle = stripHtml(title)

    if (!cleanTitle) {
      return
    }

    seen.add(videoId)
    items.push({
      title: cleanTitle,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: source.title,
      publishedAt,
      summary: '',
      cover: thumbnail,
      guid: videoId,
    })
  }

  Array.from(html.matchAll(rendererPattern)).forEach((match) => {
    const block = match[1]
    const videoId = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1] ?? ''
    const title = block.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)?.[1]
      || block.match(/"title":\{"simpleText":"([^"]+)"/)?.[1]
      || ''
    const publishedAt = block.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)?.[1] ?? ''
    const thumbnail = block.match(/"thumbnail":\{"thumbnails":\[\{"url":"([^"]+)"/)?.[1]
      ?.replace(/\\u0026/g, '&') ?? ''

    addItem(videoId, decodeEntities(title), normalizeItemUrl(thumbnail), publishedAt)
  })

  if (!items.length) {
    Array.from(html.matchAll(fallbackPattern)).forEach((match) => {
      addItem(match[1], decodeEntities(match[2]))
    })
  }

  return items.slice(0, LISTEN_PAGE_SIZE)
}

async function fetchYouTubeStreamsShell(streamsUrl: string): Promise<YouTubeShell> {
  const response = await fetch(streamsUrl, {
    headers: {
      'accept': 'text/html',
      'user-agent': 'Mozilla/5.0 ASMR-Nav/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`YouTube streams 页面请求失败：${response.status}`)
  }

  return extractYouTubeShell(await response.text(), streamsUrl)
}

async function fetchYouTubeContinuation(shell: YouTubeShell, cursor: string) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${shell.apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 ASMR-Nav/1.0',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: shell.clientVersion,
        },
      },
      continuation: cursor,
    }),
  })

  if (!response.ok) {
    throw new Error(`YouTube 翻页请求失败：${response.status}`)
  }

  return response.text()
}

async function fetchYouTubeStreamsItems(source: ListenSource, mode: 'latest' | 'more'): Promise<ParsedFeedResult> {
  const streamsUrl = getYouTubeStreamsUrl(source)

  if (!streamsUrl) {
    throw new Error('这个订阅源不支持补旧。请使用 YouTube streams 地址或 /youtube/channel/频道ID。')
  }

  const shell = await fetchYouTubeStreamsShell(streamsUrl)
  const firstCursor = source.nextCursor || extractYouTubeContinuationTokens(shell.html)[0] || ''
  const pageContent = mode === 'more' && firstCursor
    ? await fetchYouTubeContinuation(shell, firstCursor)
    : shell.html
  const nextCursor = extractYouTubeContinuationTokens(pageContent)[0] || ''
  const fetchedAt = new Date().toISOString()
  const items = extractYouTubeStreamsItems(pageContent, source)
    .map((item) => cleanParsedItem(item, source, fetchedAt))
    .filter(Boolean) as ListenItem[]

  return {
    fetchUrl: mode === 'more' && firstCursor ? `${streamsUrl}#more` : streamsUrl,
    items,
    nextCursor,
  }
}

function parseFeedContent(content: string, contentType: string, source: ListenSource) {
  const text = content.trim()

  if (contentType.includes('json') || text.startsWith('{')) {
    return parseJsonFeed(JSON.parse(text), source)
  }

  return parseXmlFeed(text, source)
}

function makeListenItemId(sourceId: string, guid: string) {
  let hash = 0
  const input = `${sourceId}:${guid}`

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0
  }

  return `listen-${Math.abs(hash).toString(36)}`
}

function cleanParsedItem(item: ParsedFeedItem, source: ListenSource, fetchedAt: string): ListenItem | null {
  const title = truncate(item.title, 160)
  const url = normalizeItemUrl(item.url)
  const guid = item.guid.trim() || url

  if (!title || !url || !guid) {
    return null
  }

  return {
    id: makeListenItemId(source.id, guid),
    sourceId: source.id,
    sourceTitle: source.title,
    title,
    url,
    author: truncate(item.author || source.title, 80),
    platform: source.platform,
    publishedAt: normalizeDate(item.publishedAt),
    summary: truncate(item.summary, 240),
    cover: normalizeItemUrl(item.cover),
    tags: source.tags,
    guid,
    fetchedAt,
  }
}

function shouldUseRsshubJson(source: ListenSource, url: URL) {
  return source.platform === 'rsshub'
    || source.feedUrl.startsWith('/')
    || url.hostname.toLowerCase().includes('rsshub')
}

function withRsshubJsonFormat(source: ListenSource, value: string) {
  const url = new URL(value)

  if (shouldUseRsshubJson(source, url) && !url.searchParams.has('format')) {
    url.searchParams.set('format', 'json')
  }

  return url.toString()
}

async function resolveYouTubeFeedUrl(value: string) {
  const url = new URL(value)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const firstPart = pathParts[0] ?? ''

  if (url.pathname === '/feeds/videos.xml' && url.searchParams.get('channel_id')) {
    return url.toString()
  }

  if (firstPart === 'channel' && pathParts[1]?.startsWith('UC')) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${pathParts[1]}`
  }

  if (firstPart.startsWith('@') || firstPart === 'c' || firstPart === 'user') {
    const response = await fetch(url.toString(), {
      headers: {
        'accept': 'text/html',
        'user-agent': 'Mozilla/5.0 ASMR-Nav/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`YouTube 页面请求失败：${response.status}`)
    }

    const html = await response.text()
    const channelId = html.match(/"externalId":"(UC[^"]+)"/)?.[1]
      || html.match(/"browseId":"(UC[^"]+)"/)?.[1]
      || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/)?.[1]

    if (!channelId) {
      throw new Error('没有从 YouTube 页面解析到频道 ID。')
    }

    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  }

  return url.toString()
}

async function resolveFeedFetchUrl(env: Env, source: ListenSource) {
  if (source.feedUrl.startsWith('/')) {
    const base = env.RSSHUB_BASE_URL?.trim()

    if (!base) {
      throw new Error('RSSHUB_BASE_URL is not configured.')
    }

    return withRsshubJsonFormat(source, new URL(source.feedUrl, base).toString())
  }

  const url = new URL(source.feedUrl)
  const host = url.hostname.toLowerCase()

  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    return resolveYouTubeFeedUrl(url.toString())
  }

  return withRsshubJsonFormat(source, url.toString())
}

async function fetchListenSourceItems(env: Env, source: ListenSource, mode: 'latest' | 'more' = 'latest'): Promise<ParsedFeedResult> {
  if (mode === 'more') {
    return fetchYouTubeStreamsItems(source, 'more')
  }

  if (isYouTubeStreamsUrl(source.feedUrl)) {
    return fetchYouTubeStreamsItems(source, 'latest')
  }

  const fetchUrl = await resolveFeedFetchUrl(env, source)
  const response = await fetch(fetchUrl, {
    headers: {
      'accept': 'application/json, application/xml, text/xml;q=0.9, */*;q=0.8',
      'user-agent': 'ASMR-Nav/1.0 (+https://asmr-nav)',
    },
  })

  if (!response.ok) {
    throw new Error(`订阅源请求失败：${response.status}`)
  }

  const content = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const fetchedAt = new Date().toISOString()
  const items = parseFeedContent(content, contentType, source)
    .map((item) => cleanParsedItem(item, source, fetchedAt))
    .filter(Boolean) as ListenItem[]

  return {
    fetchUrl,
    items,
    nextCursor: '',
  }
}

async function updateListenSourceStatus(env: Env, id: string, status: string, error = '') {
  await env.ASMR_DB
    .prepare(`
      UPDATE listen_sources
      SET last_status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `)
    .bind(status, error, new Date().toISOString(), id)
    .run()
}

async function syncListenSource(env: Env, id: string, mode: 'latest' | 'more' = 'latest') {
  const source = await readListenSource(env, id)

  if (!source) {
    throw new Error('订阅源不存在。')
  }

  await updateListenSourceStatus(env, id, 'syncing')

  try {
    const { fetchUrl, items, nextCursor } = await fetchListenSourceItems(env, source, mode)
    const now = new Date().toISOString()

    for (const item of items.slice(0, LISTEN_PAGE_SIZE)) {
      await env.ASMR_DB
        .prepare(`
          INSERT INTO listen_items (
            id,
            source_id,
            title,
            url,
            author,
            platform,
            published_at,
            summary,
            cover,
            tags,
            guid,
            fetched_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, guid) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            author = excluded.author,
            platform = excluded.platform,
            published_at = excluded.published_at,
            summary = excluded.summary,
            cover = excluded.cover,
            tags = excluded.tags,
            fetched_at = excluded.fetched_at,
            updated_at = excluded.updated_at
        `)
        .bind(
          item.id,
          item.sourceId,
          item.title,
          item.url,
          item.author,
          item.platform,
          item.publishedAt,
          item.summary,
          item.cover,
          JSON.stringify(item.tags),
          item.guid,
          item.fetchedAt,
          now,
          now,
        )
        .run()
    }

    await env.ASMR_DB
      .prepare(`
        DELETE FROM listen_items
        WHERE source_id = ?
          AND id NOT IN (
            SELECT id
            FROM listen_items
            WHERE source_id = ?
            ORDER BY published_at DESC, fetched_at DESC
            LIMIT ${LISTEN_MAX_ITEMS_PER_SOURCE}
          )
      `)
      .bind(source.id, source.id)
      .run()

    await env.ASMR_DB
      .prepare(`
        UPDATE listen_sources
        SET last_fetched_at = ?, last_fetch_url = ?, next_cursor = ?, last_status = ?, last_error = '', updated_at = ?
        WHERE id = ?
      `)
      .bind(now, fetchUrl, nextCursor, items.length ? 'success' : 'empty', now, id)
      .run()

    return {
      source: await readListenSource(env, id),
      imported: items.length,
      fetchUrl,
      hasMore: Boolean(nextCursor),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步失败。'
    await updateListenSourceStatus(env, id, 'error', message)
    throw error
  }
}

async function syncDueListenSources(env: Env, force = false) {
  await ensureSeedData(env)

  const intervalMinutes = Math.max(15, Number.parseInt(env.FEED_SYNC_INTERVAL_MINUTES ?? '360', 10) || 360)
  const cutoff = new Date(Date.now() - intervalMinutes * 60 * 1000).toISOString()
  const result = await env.ASMR_DB
    .prepare(`
      SELECT
        listen_sources.id,
        listen_sources.title,
        listen_sources.feed_url,
        listen_sources.platform,
        listen_sources.tags,
        listen_sources.enabled,
        listen_sources.sort_order,
        listen_sources.last_fetched_at,
        listen_sources.last_fetch_url,
        listen_sources.next_cursor,
        listen_sources.last_status,
        listen_sources.last_error,
        listen_sources.created_at,
        listen_sources.updated_at,
        COUNT(listen_items.id) AS item_count
      FROM listen_sources
      LEFT JOIN listen_items ON listen_items.source_id = listen_sources.id
      WHERE listen_sources.enabled = 1
        AND (? = 1 OR listen_sources.last_fetched_at = '' OR listen_sources.last_fetched_at < ?)
      GROUP BY listen_sources.id
      ORDER BY listen_sources.sort_order ASC, listen_sources.title COLLATE NOCASE ASC
      LIMIT 12
    `)
    .bind(force ? 1 : 0, cutoff)
    .all<ListenSourceRow>()

  const sources = result.results.map(rowToListenSource)
  let synced = 0
  let failed = 0

  for (const source of sources) {
    try {
      await syncListenSource(env, source.id)
      synced += 1
    } catch {
      failed += 1
    }
  }

  return { synced, failed, checked: sources.length }
}

async function pickRandomListenItem(env: Env, url: URL) {
  const platform = normalizePlatform(url.searchParams.get('platform') ?? '')
  const sourceId = url.searchParams.get('sourceId')?.trim() ?? ''
  const tag = url.searchParams.get('tag')?.trim() ?? ''
  const requestedFreshDays = Number.parseInt(url.searchParams.get('freshDays') ?? '90', 10)
  const freshDays = Number.isFinite(requestedFreshDays) ? Math.min(Math.max(requestedFreshDays, 1), 3650) : 90
  const cutoff = new Date(Date.now() - freshDays * 24 * 60 * 60 * 1000).toISOString()

  const pick = (withCutoff: boolean) => env.ASMR_DB
    .prepare(`
      SELECT
        listen_items.id,
        listen_items.source_id,
        listen_sources.title AS source_title,
        listen_items.title,
        listen_items.url,
        listen_items.author,
        listen_items.platform,
        listen_items.published_at,
        listen_items.summary,
        listen_items.cover,
        listen_items.tags,
        listen_items.guid,
        listen_items.fetched_at
      FROM listen_items
      JOIN listen_sources ON listen_sources.id = listen_items.source_id
      WHERE listen_sources.enabled = 1
        AND (? = 'other' OR listen_items.platform = ?)
        AND (? = '' OR listen_items.source_id = ?)
        AND (? = '' OR listen_items.tags LIKE ?)
        AND (? = 0 OR listen_items.published_at >= ?)
      ORDER BY RANDOM()
      LIMIT 1
    `)
    .bind(
      platform,
      platform,
      sourceId,
      sourceId,
      tag,
      `%${tag}%`,
      withCutoff ? 1 : 0,
      cutoff,
    )
    .first<ListenItemRow>()

  const row = await pick(true) ?? await pick(false)
  return row ? rowToListenItem(row) : null
}

async function ensureSeedData(env: Env) {
  await ensureSchema(env)

  const result = await env.ASMR_DB
    .prepare('SELECT COUNT(*) AS count FROM links')
    .first<{ count: number | string }>()
  const count = Number(result?.count ?? 0)

  if (count > 0 || env.AUTO_SEED_DEFAULTS === 'false') {
    return
  }

  const statements = defaultLinks.map((link) =>
    env.ASMR_DB
      .prepare(`
        INSERT INTO links (
          id,
          title,
          url,
          category,
          description,
          icon,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        link.id,
        link.title,
        link.url,
        link.category,
        link.description,
        link.icon,
        link.sortOrder,
        link.createdAt,
        link.updatedAt,
      ),
  )

  if (statements.length) {
    await env.ASMR_DB.batch(statements)
  }

  const categoryStatements = Array.from(new Set(defaultLinks.map((link) => link.category))).map((category, index) =>
    env.ASMR_DB
      .prepare('INSERT OR IGNORE INTO category_meta (category, sort_order) VALUES (?, ?)')
      .bind(category, (index + 1) * 10),
  )

  if (categoryStatements.length) {
    await env.ASMR_DB.batch(categoryStatements)
  }

  const commonStatements = defaultLinks
    .filter((link) => link.isCommon)
    .map((link) =>
      env.ASMR_DB
        .prepare('INSERT OR IGNORE INTO link_common (link_id) VALUES (?)')
        .bind(link.id),
    )

  if (commonStatements.length) {
    await env.ASMR_DB.batch(commonStatements)
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function encodeJson(value: unknown) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)))
}

function decodeJson<T>(value: string) {
  return JSON.parse(decoder.decode(base64UrlToBytes(value))) as T
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return bytesToBase64Url(new Uint8Array(signature))
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let result = 0

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return result === 0
}

function getSessionSecret(env: Env) {
  return env.SESSION_SECRET?.trim() || env.ADMIN_PASSWORD?.trim() || ''
}

async function createSessionToken(env: Env) {
  const ttlSeconds = Number.parseInt(env.SESSION_TTL_SECONDS ?? '28800', 10) || 28800
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = {
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  }
  const body = `${encodeJson({ alg: 'HS256', typ: 'JWT' })}.${encodeJson(payload)}`
  const signature = await hmac(getSessionSecret(env), body)

  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}

async function verifySessionToken(env: Env, token: string) {
  const secret = getSessionSecret(env)

  if (!secret) {
    return false
  }

  const parts = token.split('.')

  if (parts.length !== 3) {
    return false
  }

  const body = `${parts[0]}.${parts[1]}`
  const expectedSignature = await hmac(secret, body)

  if (!safeEqual(parts[2], expectedSignature)) {
    return false
  }

  try {
    const payload = decodeJson<SessionPayload>(parts[1])
    return payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return ''
  }

  return authHeader.slice('Bearer '.length).trim()
}

async function requireAdmin(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD?.trim()) {
    return json({ error: 'ADMIN_PASSWORD is not configured.' }, 500)
  }

  const valid = await verifySessionToken(env, getBearerToken(request))

  if (!valid) {
    return json({ error: 'Unauthorized' }, 401)
  }

  return null
}

async function handleLogin(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD?.trim()) {
    return json({ error: 'ADMIN_PASSWORD is not configured.' }, 500)
  }

  const raw = await request.json().catch(() => null) as { password?: string } | null
  const password = raw?.password ?? ''

  if (!safeEqual(password, env.ADMIN_PASSWORD)) {
    return json({ error: 'Password is incorrect.' }, 401)
  }

  return json(await createSessionToken(env))
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS })
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({
      ok: true,
      service: 'asmr-nav-worker',
      storage: { d1: Boolean(env.ASMR_DB) },
    })
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env)
  }

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    return json({ ok: true })
  }

  await ensureSeedData(env)

  if (url.pathname === '/api/links' && request.method === 'GET') {
    return json({
      items: await listLinks(env),
      categories: await listCategories(env),
      source: 'd1',
    })
  }

  if (url.pathname === '/api/listen/random' && request.method === 'GET') {
    return json({ item: await pickRandomListenItem(env, url) })
  }

  if (url.pathname === '/api/links' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const payload = buildLinkPayload(await request.json().catch(() => null))

    if (!payload) {
      return json({ error: 'Invalid link payload.' }, 400)
    }

    return json({ item: await writeLink(env, payload) }, 201)
  }

  if (url.pathname === '/api/categories/rename' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const payload = buildCategoryRenamePayload(await request.json().catch(() => null))

    if (!payload) {
      return json({ error: 'Invalid category rename payload.' }, 400)
    }

    if (payload.from === payload.to) {
      return json({ updated: 0, from: payload.from, to: payload.to })
    }

    const countRow = await env.ASMR_DB
      .prepare('SELECT COUNT(*) AS count FROM links WHERE category = ?')
      .bind(payload.from)
      .first<{ count: number | string }>()
    const updated = Number(countRow?.count ?? 0)

    if (updated > 0) {
      await env.ASMR_DB
        .prepare('UPDATE links SET category = ?, updated_at = ? WHERE category = ?')
        .bind(payload.to, new Date().toISOString(), payload.from)
        .run()
    }

    const existingToMeta = await env.ASMR_DB
      .prepare('SELECT category FROM category_meta WHERE category = ? LIMIT 1')
      .bind(payload.to)
      .first<{ category: string }>()
    const fromMeta = await env.ASMR_DB
      .prepare('SELECT sort_order FROM category_meta WHERE category = ? LIMIT 1')
      .bind(payload.from)
      .first<{ sort_order: number | string }>()

    if (!existingToMeta) {
      await env.ASMR_DB
        .prepare('INSERT OR IGNORE INTO category_meta (category, sort_order) VALUES (?, ?)')
        .bind(payload.to, Number(fromMeta?.sort_order ?? 100))
        .run()
    }

    await env.ASMR_DB
      .prepare('DELETE FROM category_meta WHERE category = ?')
      .bind(payload.from)
      .run()

    return json({ updated, from: payload.from, to: payload.to })
  }

  if (url.pathname === '/api/categories/order' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const payload = buildCategoryOrderPayload(await request.json().catch(() => null))

    if (!payload) {
      return json({ error: 'Invalid category order payload.' }, 400)
    }

    for (const [index, category] of payload.categories.entries()) {
      await env.ASMR_DB
        .prepare(`
          INSERT INTO category_meta (category, sort_order)
          VALUES (?, ?)
          ON CONFLICT(category) DO UPDATE SET sort_order = excluded.sort_order
        `)
        .bind(category, (index + 1) * 10)
        .run()
    }

    return json({ ok: true, categories: await listCategories(env) })
  }

  if (url.pathname === '/api/listen/sources' && request.method === 'GET') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    return json({ items: await listListenSources(env) })
  }

  if (url.pathname === '/api/listen/sources' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const payload = buildListenSourcePayload(await request.json().catch(() => null))

    if (!payload) {
      return json({ error: 'Invalid listen source payload.' }, 400)
    }

    return json({ item: await writeListenSource(env, payload) }, 201)
  }

  if (url.pathname === '/api/listen/test' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const payload = buildListenSourcePayload(await request.json().catch(() => null))

    if (!payload) {
      return json({ error: 'Invalid listen source payload.' }, 400)
    }

    const now = new Date().toISOString()
    const source: ListenSource = {
      id: 'test-source',
      title: payload.title,
      feedUrl: payload.feedUrl,
      platform: payload.platform,
      tags: payload.tags,
      enabled: payload.enabled,
      sortOrder: payload.sortOrder,
      lastFetchedAt: '',
      lastFetchUrl: '',
      nextCursor: '',
      lastStatus: 'testing',
      lastError: '',
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    const result = await fetchListenSourceItems(env, source)

    return json({
      ok: true,
      fetchUrl: result.fetchUrl,
      count: result.items.length,
      sample: result.items.slice(0, 3),
    })
  }

  if (url.pathname === '/api/listen/sync' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    return json(await syncDueListenSources(env, true))
  }

  if (url.pathname.startsWith('/api/listen/sources/')) {
    const parts = url.pathname.replace('/api/listen/sources/', '').split('/').filter(Boolean)
    const id = decodeURIComponent(parts[0] ?? '').trim()
    const action = parts[1] ?? ''

    if (!id) {
      return json({ error: 'Listen source id is required.' }, 400)
    }

    if (request.method === 'POST' && action === 'sync') {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      return json(await syncListenSource(env, id))
    }

    if (request.method === 'POST' && action === 'more') {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      return json(await syncListenSource(env, id, 'more'))
    }

    if (request.method === 'PUT' && !action) {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      const payload = buildListenSourcePayload(await request.json().catch(() => null))

      if (!payload) {
        return json({ error: 'Invalid listen source payload.' }, 400)
      }

      const existing = await readListenSource(env, id)

      if (!existing) {
        return json({ error: 'Listen source not found.' }, 404)
      }

      return json({ item: await writeListenSource(env, payload, id) })
    }

    if (request.method === 'DELETE' && !action) {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      await deleteListenSource(env, id)
      return json({ ok: true })
    }
  }

  if (url.pathname === '/api/links/import' && request.method === 'POST') {
    const authError = await requireAdmin(request, env)

    if (authError) {
      return authError
    }

    const mode = url.searchParams.get('mode') === 'replace' ? 'replace' : 'merge'
    const rawBody = await request.json().catch(() => null) as { items?: unknown[] } | null
    const items = Array.isArray(rawBody?.items)
      ? rawBody.items.map((item) => buildLinkPayload(item)).filter(Boolean) as LinkInput[]
      : []

    if (!items.length) {
      return json({ error: 'No valid links were provided.' }, 400)
    }

    if (mode === 'replace') {
      await env.ASMR_DB.exec('DELETE FROM link_common')
      await env.ASMR_DB.exec('DELETE FROM category_meta')
      await env.ASMR_DB.exec('DELETE FROM links')
    }

    for (const item of items) {
      const existing = await env.ASMR_DB
        .prepare('SELECT id FROM links WHERE url = ? LIMIT 1')
        .bind(item.url)
        .first<{ id: string }>()

      await writeLink(env, item, existing?.id)
    }

    return json({ imported: items.length, mode })
  }

  if (url.pathname.startsWith('/api/links/')) {
    const id = url.pathname.replace('/api/links/', '').trim()

    if (!id) {
      return json({ error: 'Link id is required.' }, 400)
    }

    if (request.method === 'PUT') {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      const payload = buildLinkPayload(await request.json().catch(() => null))

      if (!payload) {
        return json({ error: 'Invalid link payload.' }, 400)
      }

      const existing = await readLink(env, id)

      if (!existing) {
        return json({ error: 'Link not found.' }, 404)
      }

      return json({ item: await writeLink(env, payload, id) })
    }

    if (request.method === 'DELETE') {
      const authError = await requireAdmin(request, env)

      if (authError) {
        return authError
      }

      await env.ASMR_DB.prepare('DELETE FROM link_common WHERE link_id = ?').bind(id).run()
      await env.ASMR_DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run()
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env)
      }

      return env.ASSETS.fetch(request)
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : 'Unknown server error',
        },
        500,
      )
    }
  },
  scheduled(_controller: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(syncDueListenSources(env))
  },
}
