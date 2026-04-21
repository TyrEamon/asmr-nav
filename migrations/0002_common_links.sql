CREATE TABLE IF NOT EXISTS link_common (
  link_id TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO link_common (link_id)
SELECT id FROM links
WHERE category = '常用推荐';

UPDATE links
SET category = '收藏'
WHERE category = '常用推荐';
