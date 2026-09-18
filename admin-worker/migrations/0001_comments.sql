CREATE TABLE IF NOT EXISTS comments (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('home', 'bside')),
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 40),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS comments_inbox ON comments(deleted_at, seq);
CREATE TABLE IF NOT EXISTS comment_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_limits_expiry ON comment_limits(expires_at);
