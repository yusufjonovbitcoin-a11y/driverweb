-- Minimal isolated PostgreSQL fixture. Run ONLY in an empty local test database (not supabase test db).
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to authenticated;
create type public.chat_message_kind as enum ('text','image','audio','video','file','system','call');
create type public.chat_call_kind as enum ('audio','video');
create type public.chat_call_status as enum ('ringing','accepted','declined','missed','ended');
create type public.chat_signal_kind as enum ('offer','answer','ice');
create table public.companies(id uuid primary key);
create table public.document_versions(id uuid primary key default gen_random_uuid(), storage_path text not null unique);
create table public.profiles(id uuid primary key,company_id uuid not null references companies(id),status text not null default 'active',role text not null default 'driver',full_name text not null default 'Fixture');
create function public.current_company_id() returns uuid language sql stable security definer set search_path=public as $$select company_id from profiles where id=auth.uid() and status='active'$$;
create function public.current_profile() returns public.profiles language sql security definer set search_path=public as $$select * from profiles where id=auth.uid() and status='active'$$;
create table public.chat_conversations(id uuid primary key, company_id uuid not null references companies(id), dispatcher_id uuid not null references profiles(id), driver_id uuid not null references profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_message_at timestamptz not null default now());
create table public.chat_messages(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, conversation_id uuid not null,
  sender_id uuid not null, kind public.chat_message_kind not null default 'text', body text, file_name text,
  storage_path text, mime_type text, size_bytes bigint, duration_ms integer, reply_to_id uuid references public.chat_messages(id),
  client_id uuid not null default gen_random_uuid(), created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz, deleted_at timestamptz, edited_at timestamptz, unique(sender_id,client_id),
  constraint chat_message_content_required check(nullif(btrim(coalesce(body,'')),'') is not null or storage_path is not null)
);
create table public.chat_calls(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),conversation_id uuid not null references chat_conversations(id),initiator_id uuid not null references profiles(id),recipient_id uuid not null references profiles(id),kind public.chat_call_kind not null,status public.chat_call_status not null default 'ringing',started_at timestamptz not null default now(),answered_at timestamptz,ended_at timestamptz,created_at timestamptz not null default now(),last_heartbeat_at timestamptz not null default now());
create table public.chat_call_signals(call_id uuid not null references chat_calls(id), id bigint generated always as identity primary key,company_id uuid not null,sender_id uuid not null,recipient_id uuid not null,kind public.chat_signal_kind not null,payload jsonb not null,created_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),recipient_id uuid not null references profiles(id),type text not null,title text not null,body text not null,entity_type text,entity_id uuid,read_at timestamptz,created_at timestamptz not null default now());
create table public.push_devices(id uuid primary key default gen_random_uuid());
create table public.push_deliveries(notification_id uuid not null references notifications(id),device_id uuid not null references push_devices(id),company_id uuid not null references companies(id),recipient_id uuid not null references profiles(id),platform text not null check(platform in('android','ios','web')),token_snapshot text not null,status text not null default 'pending' check(status in('pending','processing','sent','failed','cancelled')),locked_at timestamptz,locked_by text,last_error text,updated_at timestamptz not null default now(),primary key(notification_id,device_id));
create table public.jobs(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),type text not null,status text not null default 'pending',payload jsonb not null default '{}',idempotency_key text not null unique,created_at timestamptz not null default now());
create table public.media_assets(id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),uploaded_by uuid references profiles(id),scope text not null,context_id uuid,cloudinary_asset_id text not null unique,public_id text not null,resource_type text not null check(resource_type in('image','video','raw')),delivery_type text not null default 'authenticated' check(delivery_type='authenticated'),deleted_at timestamptz);
create function public.cloudinary_media_id(media_ref text) returns uuid language plpgsql immutable as $$
begin if media_ref is null or media_ref !~ '^cloudinary:[0-9a-fA-F-]{36}$' then return null; end if;
return substring(media_ref from 12)::uuid; exception when invalid_text_representation then return null; end$$;
create schema storage;
create table storage.buckets(id text primary key,public boolean not null default false,file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,owner_id text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
create policy storage_chat_media_read on storage.objects for select to authenticated using(false);
create policy storage_chat_media_upload on storage.objects for insert to authenticated with check(false);
create policy storage_chat_media_delete_own on storage.objects for delete to authenticated using(false);
insert into storage.buckets(id,public,file_size_limit) values('chat-media',false,104857600);
create function public.can_access_chat_conversation(target_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
select exists(select 1 from chat_conversations where id=target_conversation_id and company_id=current_company_id() and auth.uid() in (driver_id,dispatcher_id))$$;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
create policy participants on public.chat_conversations to authenticated using(auth.uid() in (driver_id,dispatcher_id));
create policy participants on public.chat_messages to authenticated using(public.can_access_chat_conversation(conversation_id));
alter table public.media_assets enable row level security;
create policy media_assets_select_company on public.media_assets for select to authenticated using(company_id=current_company_id() and deleted_at is null and can_access_chat_conversation(context_id));
grant select on public.media_assets to authenticated;
grant select on public.chat_conversations,public.chat_messages to authenticated;
create publication supabase_realtime;
insert into companies values('00000000-0000-0000-0000-000000000020'),('00000000-0000-0000-0000-000000000021');
insert into profiles(id,company_id,role) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','dispatcher'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020','driver'),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000021','dispatcher'),
 ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000021','driver'),
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000020','driver');
insert into public.chat_conversations(id,company_id,dispatcher_id,driver_id) values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');

create function public.test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Assertion failed: %',label; end if; raise notice 'PASS: %',label; end $$;
