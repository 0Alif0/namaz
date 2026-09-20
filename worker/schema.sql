-- Namaz push backend, D1 (SQLite) schema.
--
-- What is deliberately absent, exactly as in the MySQL original: latitude,
-- longitude, place name, user identifier. The phone computes prayer times and
-- uploads only the UTC instants at which a push should be sent.
--
-- Instants are epoch milliseconds rather than text, so "is this due?" is an
-- integer comparison with no date-format assumptions anywhere.

CREATE TABLE IF NOT EXISTS subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint      TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL
                  REFERENCES subscriptions (id) ON DELETE CASCADE,
  prayer          TEXT NOT NULL
                  CHECK (prayer IN ('fajr','dhuhr','asr','maghrib','isha','tahajjud')),
  fire_at         INTEGER NOT NULL,
  sent_at         INTEGER,
  UNIQUE (subscription_id, prayer, fire_at)
);

CREATE INDEX IF NOT EXISTS ix_push_due ON scheduled_pushes (sent_at, fire_at);
