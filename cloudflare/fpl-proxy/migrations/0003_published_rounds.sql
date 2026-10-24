CREATE TABLE IF NOT EXISTS published_rounds (
  gw INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot TEXT NOT NULL,
  published_at TEXT NOT NULL
);
