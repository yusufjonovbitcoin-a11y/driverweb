-- Only unrelated platform surfaces are small fixtures. Core FK tables and all
-- commands/guards under test are loaded verbatim from production migrations.
alter table assignments add column driver_stage text not null default 'accepted';
alter table manual_load_imports add column extraction_schema_version integer default 3;
create view load_overview with(security_invoker=true) as select id,company_id,status,version from loads;
create table push_devices(id uuid primary key);
create table media_assets(id uuid primary key,company_id uuid,scope text,context_id uuid,
  deleted_at timestamptz,created_at timestamptz default now(),cloudinary_asset_id text,
  public_id text,resource_type text,delivery_type text);
create table chat_messages(id uuid primary key,storage_path text);
create schema storage;
create table storage.objects(bucket_id text,name text);
create function cloudinary_media_id(text) returns uuid language sql immutable as $$select null::uuid$$;
create function approve_load_draft(load_id uuid) returns void language sql as $$update loads set status='ready_for_offer' where id=load_id$$;
create function delete_unassigned_load(uuid) returns uuid language sql security definer as $$delete from loads where id=$1 returning id$$;
grant execute on function delete_unassigned_load(uuid) to authenticated;
create function test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
create function test_error(command text,expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute command; exception when others then actual:=sqlerrm; end;
  if actual is null or position(expected in actual)=0 then
    raise exception 'FAILED expected %, received % for %',expected,actual,command;
  end if;
  raise notice 'PASS: rejected with %',expected;
end $$;
create function test_seed_load(target uuid) returns void language sql as $$
  insert into loads(id,company_id,owner_dispatcher_id,load_number,status,broker_rate,loaded_miles)
  values(target,'00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',target::text,'ready_for_offer',1000,500)
$$;
