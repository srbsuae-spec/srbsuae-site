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

CREATE TABLE IF NOT EXISTS rik_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  sent TEXT NOT NULL CHECK (sent IN ('yes','no')),
  voter TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rik_votes_ts ON rik_votes (ts);
CREATE INDEX IF NOT EXISTS rik_votes_voter ON rik_votes (voter);

CREATE TABLE IF NOT EXISTS letter_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mail','copy')),
  voter TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS letter_uses_voter ON letter_uses (voter);
