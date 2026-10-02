-- Minimal isolated PostgreSQL fixture. Run ONLY in an empty local test database (not supabase test db).
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated;
create type public.chat_message_kind as enum ('text','image','audio','video','file','system','call');
create table public.chat_conversations(id uuid primary key, company_id uuid not null, dispatcher_id uuid not null, driver_id uuid not null);
create table public.chat_messages(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, conversation_id uuid not null,
  sender_id uuid not null, kind public.chat_message_kind not null default 'text', body text, file_name text,
  storage_path text, client_id uuid not null default gen_random_uuid(), created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz, deleted_at timestamptz, unique(sender_id,client_id)
);
create table public.chat_call_signals(call_id uuid, id bigint);
create function public.can_access_chat_conversation(target_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
select exists(select 1 from chat_conversations where id=target_conversation_id and auth.uid() in (driver_id,dispatcher_id))$$;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
create policy participants on public.chat_conversations to authenticated using(auth.uid() in (driver_id,dispatcher_id));
create policy participants on public.chat_messages to authenticated using(public.can_access_chat_conversation(conversation_id));
grant select on public.chat_conversations,public.chat_messages to authenticated;
insert into public.chat_conversations values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');

create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Assertion failed: %',label; end if; raise notice 'PASS: %',label; end $$;
