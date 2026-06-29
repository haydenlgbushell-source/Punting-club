CREATE TABLE IF NOT EXISTS support_chats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name       TEXT,
  messages        JSONB NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE support_chats ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_support_chats_session
  ON support_chats(session_id);

CREATE INDEX IF NOT EXISTS idx_support_chats_last_msg
  ON support_chats(last_message_at DESC);
