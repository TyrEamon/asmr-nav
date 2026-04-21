import { defaultLinks } from '../src/data/defaultLinks'
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
  "INSERT OR IGNORE INTO link_common (link_id) SELECT id FROM links WHERE category = '常用推荐'",
  "UPDATE links SET category = '收藏' WHERE category = '常用推荐'",
  "INSERT OR IGNORE INTO category_meta (category, sort_order) SELECT DISTINCT category, CASE category WHEN '收藏' THEN 10 WHEN '推荐' THEN 20 ELSE 100 END FROM links",
  'CREATE INDEX IF NOT EXISTS idx_links_category_sort ON links(category, sort_order, title COLLATE NOCASE)',
  'CREATE INDEX IF NOT EXISTS idx_links_updated ON links(updated_at DESC)',
]

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
}
