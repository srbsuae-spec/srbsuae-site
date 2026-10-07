CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  applied TEXT NOT NULL CHECK (applied IN ('yes','no')),
  confirmed TEXT CHECK (confirmed IN ('yes','no')),
  voter TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS votes_ts ON votes (ts);
CREATE INDEX IF NOT EXISTS votes_voter ON votes (voter);
