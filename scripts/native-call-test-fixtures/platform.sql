create role postgres;
alter table public.push_devices add column user_id uuid,add column company_id uuid,add column platform text,
 add column token text,add column disabled_at timestamptz,add column updated_at timestamptz default now(),add column last_seen_at timestamptz default now();
alter table public.push_devices add constraint push_devices_token_key unique(token);
alter table public.push_devices add constraint push_devices_user_platform_token_key unique(user_id,company_id,platform,token);
alter table public.push_deliveries add column attempt_count integer default 0,add column max_attempts integer default 5,
 add column next_attempt_at timestamptz default now(),add column created_at timestamptz default now();
create function public.test_error(command text,expected text) returns void language plpgsql as $$
declare actual text; begin begin execute command; exception when others then actual:=sqlerrm; end;
 if actual is null or position(expected in actual)=0 then raise exception 'Expected %, received %',expected,actual; end if;
 raise notice 'PASS: rejected with %',expected; end $$;
create schema vault;
create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
insert into vault.decrypted_secrets values('chat_cron_project_url','https://12345678901234567890.supabase.co'),('chat_push_cron_token',repeat('a',64));
create schema net;
create table net.test_requests(id bigint generated always as identity,url text,headers jsonb,body jsonb);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language plpgsql as $$ declare result bigint; begin
 insert into net.test_requests(url,headers,body) values(http_post.url,http_post.headers,http_post.body) returning id into result;return result;end $$;
create schema extensions;
create type extensions.http_header as (field text,value text);
create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
create type extensions.http_response as (status integer,content_type text,headers extensions.http_header[],content text);
create table extensions.test_requests(request extensions.http_request,timeout_ms text);
create function extensions.http_list_curlopt() returns void language sql as $$select$$;
create function extensions.http(request extensions.http_request) returns extensions.http_response language plpgsql as $$ begin
 insert into extensions.test_requests values(request,current_setting('http.curlopt_timeout_ms'));
 return row(200,'application/json',null,'{"claimed":0}')::extensions.http_response;end $$;
create schema worker_cron authorization postgres;
create table worker_cron.last_invocations(worker text primary key check(worker in('push','media')),request_id bigint not null,requested_at timestamptz not null default now());
alter table worker_cron.last_invocations enable row level security;
