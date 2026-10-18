CREATE TABLE IF NOT EXISTS player_logins (
  id TEXT PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  device TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS player_logins_time ON player_logins(created_at);
CREATE INDEX IF NOT EXISTS player_logins_player ON player_logins(entry_id, created_at);
