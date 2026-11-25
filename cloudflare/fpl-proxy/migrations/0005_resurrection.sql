CREATE TABLE resurrection_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL UNIQUE,
  side TEXT NOT NULL CHECK (side IN ('abyss','ice')),
  created_at TEXT NOT NULL,
  selection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (selection_status IN ('pending','selected','overflow','cancelled'))
);
CREATE INDEX resurrection_order ON resurrection_registrations(side,created_at);
CREATE TABLE resurrection_round (
  gw INTEGER PRIMARY KEY CHECK (gw=12),
  selection TEXT NOT NULL,
  selected_at TEXT NOT NULL
);
