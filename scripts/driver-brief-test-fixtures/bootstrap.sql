create role anon;
create role authenticated;
create type load_status as enum ('draft','review','ready_for_offer','offered','assigned','in_progress');
create table profiles(id uuid primary key, company_id uuid, role text, status text default 'active');
create table loads(id uuid primary key, company_id uuid, load_number text, status load_status,
  current_assignment_id uuid, version integer default 1);
create table assignments(id uuid primary key default gen_random_uuid(), company_id uuid, load_id uuid,
  driver_id uuid, assigned_by uuid, status text, accepted_price_snapshot_id uuid,
  requires_reconfirmation boolean, driver_stage text, ended_at timestamptz);
create table offers(id uuid primary key default gen_random_uuid(), load_id uuid, status text, responded_at timestamptz);
create table load_price_snapshots(id uuid, load_id uuid, created_at timestamptz);
create table notifications(company_id uuid, recipient_id uuid, type text, title text, body text, entity_type text, entity_id uuid);
create table audit_events(company_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
create table manual_load_imports(id uuid primary key, company_id uuid, load_id uuid, checksum_sha256 text,
  status text, extraction_schema_version integer, extracted_result jsonb);
create view load_overview with(security_invoker=true) as select id,company_id,status from loads;
create function current_profile() returns profiles language sql stable security definer set search_path=public
as $$select p from profiles p where p.id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function can_access_driver(driver_id uuid) returns boolean language sql stable as $$select true$$;
create function approve_load_draft(load_id uuid) returns void language sql as $$update loads set status='ready_for_offer' where id=load_id$$;
create function test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
