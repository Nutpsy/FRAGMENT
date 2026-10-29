-- Existing submissions remain private. Never publish old inbox contents implicitly.
ALTER TABLE comments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved'));
ALTER TABLE comments ADD COLUMN parent_seq INTEGER REFERENCES comments(seq);
CREATE INDEX comments_public ON comments(channel, visibility, status, deleted_at, seq);
