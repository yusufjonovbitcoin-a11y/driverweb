-- A03: STABLE reads run inside PostgREST READ ONLY transactions. Mutation RPCs
-- retain current_profile()'s row lock; only these actor snapshots are lock-free.
-- SECTION A03
do $migration$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.get_chat_safety_state(uuid)',
    'public.list_chat_reports(text,integer)',
    'public.get_driver_analytics(timestamptz,timestamptz)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if definition !~ 'actor public.profiles[[:space:]]*:=[[:space:]]*public.current_profile\(\);'
      or strpos(definition,E'\nbegin\n')=0 then raise exception 'Unexpected actor read: %',signature; end if;
    definition := regexp_replace(definition,
      'actor public.profiles[[:space:]]*:=[[:space:]]*public.current_profile\(\);', 'actor public.profiles;');
    definition := replace(definition,E'\nbegin\n',E'\nbegin\n  select * into actor from public.profiles p where p.id=(select auth.uid()) and p.status=''active'';\n');
    execute definition;
  end loop;
end $migration$;

-- SECTION A19
-- The load lock serializes binding with document uploads, trash and assignment
-- changes. A committed version can only be retried with the same immutable file.
create or replace function public.bind_document_version_media(
  version_id uuid, media_ref text, checksum_sha256 text default null
) returns public.documents language plpgsql security definer set search_path=public as $$
declare actor public.profiles:=public.current_profile(); target_version public.document_versions;
  target_document public.documents; target_load public.loads;
begin
  select * into target_version from public.document_versions
    where id=version_id and company_id=actor.company_id and uploaded_by=actor.id;
  if target_version.id is null then raise exception 'Upload not found'; end if;
  select l.* into target_load from public.loads l join public.documents d on d.load_id=l.id
    where d.id=target_version.document_id and l.company_id=actor.company_id for update of l;
  if target_load.id is null then raise exception 'Document access denied'; end if;
  if target_load.trashed_at is not null then raise exception 'LOAD_TRASHED'; end if;
  select * into target_version from public.document_versions where id=version_id for update;
  if not public.can_upload_load_document(target_load.id)
    or (target_load.execution_reset_at is not null and target_version.uploaded_at<target_load.execution_reset_at)
    then raise exception 'LOAD_DOCUMENT_STALE'; end if;
  select * into target_document from public.documents where id=target_version.document_id for update;
  if target_version.upload_lease_started_at is null and target_version.upload_expires_at is null then
    if target_version.storage_path is distinct from media_ref
      or target_version.checksum_sha256 is distinct from bind_document_version_media.checksum_sha256 then
      raise exception 'DOCUMENT_VERSION_IMMUTABLE';
    end if;
    return target_document;
  end if;
  if target_version.superseded_at is not null then raise exception 'DOCUMENT_VERSION_SUPERSEDED'; end if;
  if target_version.upload_lease_started_at is null or target_version.upload_expires_at is null
    or target_version.upload_expires_at<=clock_timestamp() then raise exception 'Upload session expired'; end if;
  if not public.is_valid_cloudinary_media(media_ref,'load_document',target_version.id) then
    raise exception 'Cloudinary media was not found'; end if;
  update public.document_versions set storage_path=media_ref,
    checksum_sha256=bind_document_version_media.checksum_sha256,
    upload_expires_at=null,upload_lease_started_at=null where id=target_version.id;
  update public.document_versions set superseded_at=now()
    where document_id=target_version.document_id and id<>target_version.id and superseded_at is null;
  update public.documents set current_version_id=target_version.id
    where id=target_version.document_id returning * into target_document;
  insert into public.document_checks(company_id,document_version_id)
    select actor.company_id,target_version.id
    where not exists(select 1 from public.document_checks where document_version_id=target_version.id);
  insert into public.jobs(company_id,type,payload,idempotency_key)
    values(actor.company_id,'document.ai_check',jsonb_build_object('documentVersionId',target_version.id,
      'loadId',target_document.load_id),'document-check:'||target_version.id)
    on conflict(idempotency_key) do nothing;
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(actor.company_id,actor.id,'document.uploaded','document',target_document.id,
      jsonb_build_object('versionId',target_version.id,'provider','cloudinary'));
  return target_document;
end $$;
revoke all on function public.bind_document_version_media(uuid,text,text) from public,anon;
grant execute on function public.bind_document_version_media(uuid,text,text) to authenticated;

-- Legacy Storage uploads have the same version/check idempotency contract.
create or replace function public.complete_document_upload(version_id uuid,checksum_sha256 text default null)
returns public.documents language plpgsql security definer set search_path=public as $$
declare actor public.profiles:=public.current_profile(); target_version public.document_versions;
  result public.documents; target_load public.loads;
begin
  select * into target_version from public.document_versions
    where id=version_id and company_id=actor.company_id and uploaded_by=actor.id;
  if target_version.id is null then raise exception 'Upload not found'; end if;
  select l.* into target_load from public.loads l join public.documents d on d.load_id=l.id
    where d.id=target_version.document_id and l.company_id=actor.company_id for update of l;
  if target_load.id is null then raise exception 'Document access denied'; end if;
  if target_load.trashed_at is not null then raise exception 'LOAD_TRASHED'; end if;
  select * into target_version from public.document_versions where id=version_id for update;
  if not public.can_upload_load_document(target_load.id)
    or (target_load.execution_reset_at is not null and target_version.uploaded_at<target_load.execution_reset_at)
    then raise exception 'LOAD_DOCUMENT_STALE'; end if;
  select * into result from public.documents where id=target_version.document_id for update;
  if target_version.upload_lease_started_at is null and target_version.upload_expires_at is null then
    if target_version.checksum_sha256 is distinct from complete_document_upload.checksum_sha256 then
      raise exception 'DOCUMENT_VERSION_IMMUTABLE'; end if;
    return result;
  end if;
  if target_version.superseded_at is not null then raise exception 'DOCUMENT_VERSION_SUPERSEDED'; end if;
  if target_version.upload_lease_started_at is null or target_version.upload_expires_at is null
    or target_version.upload_expires_at<=clock_timestamp() then raise exception 'Upload session expired'; end if;
  if not exists(select 1 from storage.objects where bucket_id='load-documents' and name=target_version.storage_path)
    then raise exception 'File upload is incomplete'; end if;
  update public.document_versions set checksum_sha256=complete_document_upload.checksum_sha256,
    upload_expires_at=null,upload_lease_started_at=null where id=target_version.id;
  update public.document_versions set superseded_at=now()
    where document_id=target_version.document_id and id<>target_version.id and superseded_at is null;
  update public.documents set current_version_id=target_version.id
    where id=target_version.document_id returning * into result;
  insert into public.document_checks(company_id,document_version_id)
    select actor.company_id,target_version.id
    where not exists(select 1 from public.document_checks where document_version_id=target_version.id);
  insert into public.jobs(company_id,type,payload,idempotency_key)
    values(actor.company_id,'document.ai_check',jsonb_build_object('documentVersionId',target_version.id,
      'loadId',result.load_id),'document-check:'||target_version.id)
    on conflict(idempotency_key) do nothing;
  return result;
end $$;
revoke all on function public.complete_document_upload(uuid,text) from public,anon;
grant execute on function public.complete_document_upload(uuid,text) to authenticated;

-- SECTION A01
-- Online heartbeat age and GPS capture age are independent. Existing positions
-- have unknown capture time; do not backfill it from their heartbeat timestamp.
alter table public.driver_presence add column location_captured_at timestamptz;
drop function public.upsert_driver_presence(numeric,numeric,numeric,numeric,boolean);
create function public.upsert_driver_presence(latitude numeric,longitude numeric,
  heading numeric default null,speed_mph numeric default null,online boolean default true,
  captured_at timestamptz default null)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.profiles:=public.current_profile(); event_time timestamptz:=clock_timestamp(); valid_sample boolean;
begin
  if actor.id is null or actor.role<>'driver' then raise exception 'Driver permission required'; end if;
  valid_sample:=coalesce(captured_at>event_time-interval '2 minutes' and captured_at<=event_time+interval '30 seconds'
    and latitude between -90 and 90 and longitude between -180 and 180
    and (heading is null or heading between 0 and 360)
    and (speed_mph is null or speed_mph between 0 and 99999),false);
  insert into public.driver_presence as presence_current(driver_id,company_id,is_online,latitude,longitude,
    heading,speed_mph,last_seen_at,location_captured_at)
  values(actor.id,actor.company_id,coalesce(online,false),case when valid_sample then latitude end,
    case when valid_sample then longitude end,case when valid_sample then heading end,
    case when valid_sample then speed_mph end,event_time,case when valid_sample then captured_at end)
  on conflict(driver_id) do update set is_online=excluded.is_online,last_seen_at=event_time,updated_at=event_time,
    latitude=case when excluded.location_captured_at>coalesce(presence_current.location_captured_at,'-infinity') then excluded.latitude else presence_current.latitude end,
    longitude=case when excluded.location_captured_at>coalesce(presence_current.location_captured_at,'-infinity') then excluded.longitude else presence_current.longitude end,
    heading=case when excluded.location_captured_at>coalesce(presence_current.location_captured_at,'-infinity') then excluded.heading else presence_current.heading end,
    speed_mph=case when excluded.location_captured_at>coalesce(presence_current.location_captured_at,'-infinity') then excluded.speed_mph else presence_current.speed_mph end,
    location_captured_at=greatest(presence_current.location_captured_at,excluded.location_captured_at);
end $$;
revoke all on function public.upsert_driver_presence(numeric,numeric,numeric,numeric,boolean,timestamptz) from public,anon;
grant execute on function public.upsert_driver_presence(numeric,numeric,numeric,numeric,boolean,timestamptz) to authenticated;

-- Batch samples already carry capture timestamps. Route this presence update
-- through the same monotonic/age checks, retaining the historical point ingest.
do $migration$
declare definition text:=pg_get_functiondef('public.ingest_driver_location_batch(uuid,jsonb)'::regprocedure);
  start_at integer; end_at integer;
begin
  start_at:=strpos(definition,'    insert into public.driver_presence(');
  end_at:=strpos(definition,'  return count_inserted;');
  if start_at=0 or end_at<=start_at then raise exception 'Unexpected batch presence update'; end if;
  definition:=substring(definition from 1 for start_at-1)||$body$    perform public.upsert_driver_presence(
      (latest_live_point->>'latitude')::numeric,(latest_live_point->>'longitude')::numeric,
      (latest_live_point->>'heading_deg')::numeric,
      (latest_live_point->>'speed_mps')::numeric*2.236936,true,latest_live_time);
  end if;
$body$||substring(definition from end_at);
  execute definition;
  definition:=pg_get_functiondef('public.prepare_driver_pay_quote(uuid,uuid,uuid,numeric,numeric,numeric,jsonb,double precision,double precision,timestamptz,text)'::regprocedure);
  if strpos(definition,$anchor$p_location_at < now()-interval '5 minutes'$anchor$)=0 then raise exception 'Unexpected quote freshness'; end if;
  definition:=replace(definition,$anchor$p_location_at < now()-interval '5 minutes'$anchor$,$anchor$p_location_at <= now()-interval '2 minutes'$anchor$);
  execute replace(definition,$anchor$p_location_at > now()+interval '1 minute'$anchor$,$anchor$p_location_at > now()+interval '30 seconds'$anchor$);
  definition:=pg_get_functiondef('private.freeze_driver_pay()'::regprocedure);
  if strpos(definition,$anchor$quote.location_at < now()-interval '10 minutes'$anchor$)=0 then raise exception 'Unexpected pay freeze freshness'; end if;
  execute replace(definition,$anchor$quote.location_at < now()-interval '10 minutes'$anchor$,$anchor$quote.location_at <= now()-interval '2 minutes'$anchor$);
end $migration$;

-- SECTION A05
-- Keep the installed projection (including later brief/trash columns) unchanged.
-- Replace only the two multiplicative stop joins, failing on unexpected SQL.
do $migration$
declare definition text:=pg_get_viewdef('public.load_overview'::regclass,true);
  pickup_join text:=$anchor$LEFT JOIN load_stops pickup ON pickup.load_id = l.id AND pickup.type = 'pickup'::stop_type$anchor$;
  delivery_join text:=$anchor$LEFT JOIN load_stops delivery ON delivery.load_id = l.id AND delivery.type = 'delivery'::stop_type$anchor$;
begin
  if strpos(definition,pickup_join)=0 or strpos(definition,delivery_join)=0 then
    raise exception 'Unexpected load overview stop joins';
  end if;
  definition:=replace(definition,pickup_join,$body$LEFT JOIN LATERAL (
    select * from public.load_stops s where s.load_id=l.id and s.company_id=l.company_id
    and s.type='pickup' order by s.sequence,s.id limit 1) pickup ON true$body$);
  definition:=replace(definition,delivery_join,$body$LEFT JOIN LATERAL (
    select * from public.load_stops s where s.load_id=l.id and s.company_id=l.company_id
    and s.type='delivery' order by s.sequence desc,s.id desc limit 1) delivery ON true$body$);
  execute 'create or replace view public.load_overview with (security_invoker=true) as '||definition;
end $migration$;

notify pgrst,'reload schema';
