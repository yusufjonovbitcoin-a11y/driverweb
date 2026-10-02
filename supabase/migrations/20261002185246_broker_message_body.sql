-- Keep the readable plain-text version of each broker email alongside its
-- original private .eml. Existing tenant RLS on broker_messages applies here.
alter table public.broker_messages
  add column body_text text,
  add column body_truncated boolean not null default false;
