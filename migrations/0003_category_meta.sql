CREATE TABLE IF NOT EXISTS category_meta (
  category TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 100
);

INSERT OR IGNORE INTO category_meta (category, sort_order)
SELECT DISTINCT
  category,
  CASE category
    WHEN '收藏' THEN 10
    WHEN '推荐' THEN 20
    ELSE 100
  END
FROM links;
