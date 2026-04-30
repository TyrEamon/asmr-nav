CREATE TABLE IF NOT EXISTS listen_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'rss',
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  last_fetched_at TEXT NOT NULL DEFAULT '',
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS listen_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'rss',
  published_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  guid TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, guid)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_listen_sources_sort
ON listen_sources(enabled DESC, sort_order ASC, title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_listen_items_random
ON listen_items(platform, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_listen_items_source
ON listen_items(source_id, published_at DESC);
