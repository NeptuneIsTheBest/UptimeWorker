ALTER TABLE global_settings ADD COLUMN page_refresh_seconds INTEGER NOT NULL DEFAULT 30
  CHECK (typeof(page_refresh_seconds) = 'integer' AND
    (page_refresh_seconds = 0 OR page_refresh_seconds BETWEEN 5 AND 3600));
