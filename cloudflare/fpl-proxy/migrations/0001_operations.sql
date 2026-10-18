CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('arena', '{"gw":9,"open":false}');
CREATE TABLE IF NOT EXISTS player_codes (entry_id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY, gw INTEGER NOT NULL, challenger_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL CHECK (target_id != challenger_id), created_at TEXT NOT NULL,
  deleted_at TEXT, delete_reason TEXT, settled_at TEXT,
  challenger_score INTEGER, target_score INTEGER, challenger_delta INTEGER, target_delta INTEGER
);
CREATE INDEX IF NOT EXISTS duels_round ON duels(gw, deleted_at, created_at);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, display_day TEXT NOT NULL,
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS announcements_day ON announcements(display_day, deleted_at);
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, session_id TEXT NOT NULL,
  entry_id INTEGER, kind TEXT NOT NULL CHECK (kind IN ('pageview','identify','verified_login')),
  path TEXT NOT NULL, device TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_time ON visits(created_at);
CREATE INDEX IF NOT EXISTS visits_player ON visits(entry_id, created_at);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
