ALTER TABLE listen_sources ADD COLUMN next_cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE listen_sources ADD COLUMN last_fetch_url TEXT NOT NULL DEFAULT '';
