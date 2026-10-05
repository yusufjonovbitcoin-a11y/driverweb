-- Retry metadata only. Existing messages, attachments and extraction results
-- are retained. A failed provider request must not monopolize the backlog.
alter table public.broker_attachments
  add column if not exists ai_last_attempt_at timestamptz;
