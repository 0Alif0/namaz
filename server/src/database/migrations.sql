-- Namaz backend schema.
--
-- What is deliberately absent: latitude, longitude, any place name, any user
-- identifier. The phone computes prayer times locally and uploads only the UTC
-- instants at which a push should be sent (spec §10, §26, §38).

CREATE TABLE IF NOT EXISTS subscriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  endpoint      VARCHAR(512)    NOT NULL,
  endpoint_hash CHAR(64)        NOT NULL,
  p256dh        VARCHAR(255)    NOT NULL,
  auth          VARCHAR(255)    NOT NULL,
  timezone      VARCHAR(64)     NOT NULL DEFAULT 'UTC',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscriptions_endpoint_hash (endpoint_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  prayer          ENUM('fajr','dhuhr','asr','maghrib','isha','tahajjud') NOT NULL,
  -- Stored in UTC. The application never converts this to local time.
  fire_at         DATETIME        NOT NULL,
  sent_at         DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_slot (subscription_id, prayer, fire_at),
  KEY ix_push_due (sent_at, fire_at),
  CONSTRAINT fk_push_subscription
    FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Small cache so a place name is looked up once per ~1 km square, not per user.
CREATE TABLE IF NOT EXISTS place_names (
  coarse_key VARCHAR(32)  NOT NULL,
  name       VARCHAR(160) NOT NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (coarse_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
