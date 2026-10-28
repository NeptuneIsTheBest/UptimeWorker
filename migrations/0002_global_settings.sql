CREATE TABLE global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  waf_bypass_enabled INTEGER NOT NULL DEFAULT 0 CHECK (waf_bypass_enabled IN (0, 1)),
  waf_bypass_token TEXT,
  waf_bypass_domains_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
INSERT INTO global_settings(id) VALUES (1);
