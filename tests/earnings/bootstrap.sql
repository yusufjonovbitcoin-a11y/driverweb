create role anon;
create role authenticated;
create schema auth;
create schema private;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table companies(id uuid primary key);
create table profiles(id uuid primary key,company_id uuid,role text,status text default 'active');
create table audit_events(company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,new_value jsonb);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,private,storage,auth to authenticated,anon;
grant select on profiles to authenticated;
grant select,insert on storage.objects to authenticated;
create function current_profile() returns profiles language sql security definer set search_path=public as $$select p from profiles p where p.id=auth.uid() and p.status='active'$$;
create function current_company_id() returns uuid language sql stable security definer set search_path=public as $$select company_id from profiles where id=auth.uid() and status='active'$$;
create function current_app_role() returns text language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and status='active'$$;
create function test_assert(ok boolean,label text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end$$;
create function test_error(statement text,label text) returns void language plpgsql as $$declare failed boolean:=false;begin begin execute statement;exception when others then failed:=true;end;perform test_assert(failed,label);end$$;
insert into companies values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into profiles(id,company_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','company_admin'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','dispatcher'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','driver'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','driver'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','driver');
