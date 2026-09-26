create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('31000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'integrity-admin@test.local', '', now(), now(), now()),
  ('31000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'integrity-dispatch@test.local', '', now(), now(), now()),
  ('31000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'integrity-driver1@test.local', '', now(), now(), now()),
  ('31000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'integrity-driver2@test.local', '', now(), now(), now());

insert into public.companies(id, name)
values ('a3100000-0000-0000-0000-000000000001', 'Integrity Test Company');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('31000000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001', 'company_admin', 'Integrity Admin', 'integrity-admin@test.local'),
  ('31000000-0000-0000-0000-000000000002', 'a3100000-0000-0000-0000-000000000001', 'dispatcher', 'Integrity Dispatcher', 'integrity-dispatch@test.local'),
  ('31000000-0000-0000-0000-000000000003', 'a3100000-0000-0000-0000-000000000001', 'driver', 'Integrity Driver One', 'integrity-driver1@test.local'),
  ('31000000-0000-0000-0000-000000000004', 'a3100000-0000-0000-0000-000000000001', 'driver', 'Integrity Driver Two', 'integrity-driver2@test.local');

insert into public.driver_profiles(user_id, company_id, cdl_number, vin) values
  ('31000000-0000-0000-0000-000000000003', 'a3100000-0000-0000-0000-000000000001', 'CDL-ONE', 'VIN-ONE'),
  ('31000000-0000-0000-0000-000000000004', 'a3100000-0000-0000-0000-000000000001', 'CDL-TWO', 'VIN-TWO');

insert into public.dispatcher_preferences(dispatcher_id, company_id, driver_scope)
values ('31000000-0000-0000-0000-000000000002', 'a3100000-0000-0000-0000-000000000001', 'selected');
insert into public.dispatcher_driver_access(dispatcher_id, driver_id, company_id) values
  ('31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000003', 'a3100000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000004', 'a3100000-0000-0000-0000-000000000001');

select extensions.is(
  public.normalize_document_type('Bill of Lading'),
  'bol',
  'legacy BOL aliases normalize before allowlist validation'
);
select extensions.is(
  public.normalize_document_type('unknown legacy type'),
  'other',
  'unknown legacy document types normalize safely instead of aborting deploy'
);

-- Load 1 exercises pickup/delivery evidence and completion guards.
insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'b3100000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  'INTEGRITY-DOC-1', 'assigned', 2500, 900
);
insert into public.load_stops(
  id, company_id, load_id, sequence, type, status,
  facility_name, address_line, city, region, requires_document
) values
  ('53100000-0000-0000-0000-000000000001', 'a3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 1, 'pickup', 'pending', 'Pickup', '1 Pickup Rd', 'Boise', 'ID', true),
  ('53100000-0000-0000-0000-000000000002', 'a3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 2, 'delivery', 'arrived', 'Delivery', '2 Delivery Rd', 'Reno', 'NV', true);
insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by,
  accepted_at, driver_stage
) values (
  'a5310000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000003',
  'active', '31000000-0000-0000-0000-000000000002', now(),
  'arrived_at_pickup'
);
update public.loads
set current_assignment_id = 'a5310000-0000-0000-0000-000000000001'
where id = 'b3100000-0000-0000-0000-000000000001';

-- A wrong-but-current document must not satisfy the pickup BOL guard.
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '53100000-0000-0000-0000-000000000001',
  'other', '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by
) values (
  'd6310000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000001', 1, 'wrong.pdf',
  'application/pdf', 'test/wrong-pickup',
  '31000000-0000-0000-0000-000000000003'
);
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000001'
where id = 'd5310000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';

select extensions.is(
  public.transition_stop(
    '53100000-0000-0000-0000-000000000001', 'arrived',
    'c5310000-0000-0000-0000-000000000001', 1
  )->>'status',
  'arrived',
  'pickup arrival is recorded before document enforcement'
);
select extensions.throws_ok(
  $$select public.transition_stop(
    '53100000-0000-0000-0000-000000000001', 'done',
    'c5310000-0000-0000-0000-000000000002', 2
  )$$,
  '23514',
  'Required pickup BOL is missing',
  'a generic current document cannot satisfy the pickup BOL requirement'
);

reset role;
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '53100000-0000-0000-0000-000000000001',
  'bol', '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by
) values (
  'd6310000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000002', 1, 'bol.pdf',
  'application/pdf', 'test/bol',
  '31000000-0000-0000-0000-000000000003'
);
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000002'
where id = 'd5310000-0000-0000-0000-000000000002';

-- A current_version_id from another document is FK-valid by company, but must
-- never count as evidence for this BOL.
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000005',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '53100000-0000-0000-0000-000000000001',
  'other', '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by
) values (
  'd6310000-0000-0000-0000-000000000005',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000005', 1, 'foreign.pdf',
  'application/pdf', 'test/foreign-version',
  '31000000-0000-0000-0000-000000000003'
);
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000005'
where id = 'd5310000-0000-0000-0000-000000000002';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.throws_ok(
  $$select public.transition_stop(
    '53100000-0000-0000-0000-000000000001', 'done',
    'c5310000-0000-0000-0000-00000000000a', 2
  )$$,
  '23514',
  'Required pickup BOL is missing',
  'a current version owned by another document cannot satisfy evidence'
);
reset role;
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000002'
where id = 'd5310000-0000-0000-0000-000000000002';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  public.transition_stop(
    '53100000-0000-0000-0000-000000000001', 'done',
    'c5310000-0000-0000-0000-000000000003', 2
  )->>'status',
  'done',
  'pickup completes when a current BOL exists'
);

select extensions.throws_ok(
  $$select public.begin_document_upload(
    'b3100000-0000-0000-0000-000000000001',
    '53100000-0000-0000-0000-000000000001',
    'pod', 'wrong-stop.pdf', 'application/pdf', 100
  )$$,
  'P0001',
  'POD must belong to a delivery stop',
  'POD cannot be opened against a pickup stop'
);
select extensions.throws_ok(
  $$select public.begin_document_upload(
    'b3100000-0000-0000-0000-000000000001', null,
    'executable', 'bad.exe', 'application/octet-stream', 100
  )$$,
  'P0001',
  'Unsupported document type',
  'document upload RPC enforces the allowlist'
);

reset role;
-- A delivery BOL is intentionally wrong. It must not allow delivery completion.
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '53100000-0000-0000-0000-000000000002',
  'bol', '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by
) values (
  'd6310000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000003', 1, 'wrong-delivery.pdf',
  'application/pdf', 'test/wrong-delivery',
  '31000000-0000-0000-0000-000000000003'
);
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000003'
where id = 'd5310000-0000-0000-0000-000000000003';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.throws_ok(
  $$select public.transition_stop(
    '53100000-0000-0000-0000-000000000002', 'done',
    'c5310000-0000-0000-0000-000000000004', 3
  )$$,
  '23514',
  'Required delivery POD is missing',
  'a BOL cannot satisfy the delivery POD requirement'
);

reset role;
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000004',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000001',
  '53100000-0000-0000-0000-000000000002',
  'pod', '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by
) values (
  'd6310000-0000-0000-0000-000000000004',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000004', 1, 'pod.pdf',
  'application/pdf', 'test/pod',
  '31000000-0000-0000-0000-000000000003'
);
update public.documents
set current_version_id = 'd6310000-0000-0000-0000-000000000004'
where id = 'd5310000-0000-0000-0000-000000000004';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  public.transition_stop(
    '53100000-0000-0000-0000-000000000002', 'done',
    'c5310000-0000-0000-0000-000000000005', 3
  )->>'status',
  'done',
  'delivery completes when a current POD exists'
);

reset role;
set local role service_role;
select extensions.throws_ok(
  $$update public.documents set document_type = 'other'
    where id = 'd5310000-0000-0000-0000-000000000004'$$,
  '23514',
  'Required BOL/POD evidence cannot be changed after completion',
  'service role cannot rewrite finalized POD evidence'
);
select extensions.throws_ok(
  $$update public.documents
    set company_id = 'a3100000-0000-0000-0000-000000000002'
    where id = 'd5310000-0000-0000-0000-000000000004'$$,
  '23514',
  'Required BOL/POD evidence cannot be changed after completion',
  'service role cannot move finalized POD evidence to another tenant'
);
select extensions.throws_ok(
  $$update public.document_versions set storage_path = 'tampered/pod'
    where id = 'd6310000-0000-0000-0000-000000000004'$$,
  '23514',
  'Finalized BOL/POD version is immutable',
  'service role cannot rewrite finalized POD storage evidence'
);
select extensions.throws_ok(
  $$delete from public.document_versions
    where id = 'd6310000-0000-0000-0000-000000000004'$$,
  '23514',
  'Finalized BOL/POD version is immutable',
  'service role cannot delete finalized POD storage evidence'
);
reset role;

-- Simulate pre-migration corruption with trigger replication bypass;
-- completion must still re-check evidence independently.
set local session_replication_role = replica;
update public.documents set document_type = 'other'
where id = 'd5310000-0000-0000-0000-000000000004';
set local session_replication_role = origin;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.throws_ok(
  $$select public.complete_load('b3100000-0000-0000-0000-000000000001')$$,
  '23514',
  'Every required pickup BOL and delivery POD must be present before completion',
  'delivered to completed re-checks BOL and POD evidence'
);
reset role;
set local session_replication_role = replica;
update public.documents set document_type = 'pod'
where id = 'd5310000-0000-0000-0000-000000000004';
set local session_replication_role = origin;
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  (public.complete_load('b3100000-0000-0000-0000-000000000001')).status::text,
  'completed',
  'load completes only after required evidence is restored'
);
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000001';
select extensions.throws_ok(
  $$select public.delete_operational_document('d5310000-0000-0000-0000-000000000004')$$,
  '23514',
  'Required BOL/POD cannot be deleted after the stop is completed',
  'required POD cannot be deleted after completion'
);

-- Load 2 exercises expirable upload leases.
reset role;
insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'b3100000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  'INTEGRITY-UPLOAD-1', 'assigned', 1800, 600
);
insert into public.load_stops(
  id, company_id, load_id, sequence, type, status,
  facility_name, address_line, city, region, requires_document
) values (
  '53100000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000002', 1, 'pickup', 'pending',
  'Lease Pickup', '3 Lease Rd', 'Boise', 'ID', true
);
insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by, accepted_at
) values (
  'a5310000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000003',
  'active', '31000000-0000-0000-0000-000000000002', now()
);
update public.loads
set current_assignment_id = 'a5310000-0000-0000-0000-000000000002'
where id = 'b3100000-0000-0000-0000-000000000002';

insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
)
select
  gen_random_uuid(), 'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000002',
  '53100000-0000-0000-0000-000000000003', 'bol',
  '31000000-0000-0000-0000-000000000003'
from generate_series(1, 10);
insert into public.document_versions(
  company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by, upload_expires_at, upload_lease_started_at
)
select
  d.company_id, d.id, 1, 'expired.pdf', 'application/pdf',
  concat('test/expired/', d.id),
  '31000000-0000-0000-0000-000000000003', now() - interval '1 minute',
  now() - interval '61 minutes'
from public.documents d
where d.load_id = 'b3100000-0000-0000-0000-000000000002';

-- Historical superseded rows have no explicit lease marker. Even a legacy
-- accidental expiry value must not make them cleanup candidates.
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000006',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000002', null, 'other',
  '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by, upload_expires_at, superseded_at
) values (
  'd6310000-0000-0000-0000-000000000006',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000006', 1, 'historical.pdf',
  'application/pdf', 'test/historical-superseded',
  '31000000-0000-0000-0000-000000000003', now() - interval '1 day', now()
);

-- A provider upload can succeed before bind_document_version_media. The media
-- registry context must let expiry cleanup delete that exact Cloudinary asset.
insert into public.documents(
  id, company_id, load_id, stop_id, document_type, created_by
) values (
  'd5310000-0000-0000-0000-000000000007',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000002', null, 'other',
  '31000000-0000-0000-0000-000000000003'
);
insert into public.document_versions(
  id, company_id, document_id, version_number, file_name, mime_type,
  storage_path, uploaded_by, upload_expires_at, upload_lease_started_at
) values (
  'd6310000-0000-0000-0000-000000000007',
  'a3100000-0000-0000-0000-000000000001',
  'd5310000-0000-0000-0000-000000000007', 1, 'orphan.pdf',
  'application/pdf', 'placeholder/orphan',
  '31000000-0000-0000-0000-000000000003', now() - interval '1 minute',
  now() - interval '61 minutes'
);
insert into public.media_assets(
  id, company_id, uploaded_by, scope, context_id, cloudinary_asset_id,
  public_id, resource_type, delivery_type, version, format, file_name,
  mime_type, size_bytes
) values (
  'd7310000-0000-0000-0000-000000000007',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000003', 'load_document',
  'd6310000-0000-0000-0000-000000000007', 'cloudinary-orphan-7',
  'drivex/orphan-7', 'raw', 'authenticated', 1, 'pdf', 'orphan.pdf',
  'application/pdf', 500
);

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select public.begin_document_upload(
  'b3100000-0000-0000-0000-000000000002',
  '53100000-0000-0000-0000-000000000003',
  'bol', 'fresh.pdf', 'application/pdf', 500
)->>'versionId' as fresh_upload_version_id
\gset
select extensions.ok(
  :'fresh_upload_version_id' is not null,
  'expired half-uploads do not permanently consume the ten-file limit'
);
select extensions.ok(
  public.can_access_load_media_context(:'fresh_upload_version_id'::uuid),
  'upload owner can authorize Cloudinary media with the pending version context'
);
select extensions.is(
  public.can_access_load_media_context(
    'b3100000-0000-0000-0000-000000000002'
  ),
  false,
  'a bare load id cannot bypass the document upload lease and quota'
);
select extensions.is(
  public.can_access_load_media_context(
    'd6310000-0000-0000-0000-000000000007'
  ),
  false,
  'an expired pending version cannot authorize a new provider upload'
);
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000004';
select extensions.is(
  public.can_access_load_media_context(:'fresh_upload_version_id'::uuid),
  false,
  'another driver cannot authorize media against a pending version lease'
);
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  (select count(*)
   from public.documents d
   where d.load_id = 'b3100000-0000-0000-0000-000000000002'
     and d.document_type = 'bol'),
  1::bigint,
  'section-local cleanup removes expired empty document rows'
);
reset role;
set local role service_role;
select public.cleanup_expired_document_uploads(1000);
reset role;
select extensions.ok(
  exists (
    select 1 from public.document_versions
    where id = 'd6310000-0000-0000-0000-000000000006'
  ),
  'historical superseded versions are never removed as expirable uploads'
);
select extensions.is(
  (select count(*) from public.jobs
   where type = 'provider.media_delete'
     and payload->>'provider' = 'supabase_storage'
     and payload ? 'storagePath'),
  10::bigint,
  'expired upload cleanup creates provider deletion outbox jobs with references'
);
select extensions.is(
  (select count(*) from public.jobs
   where type = 'provider.media_delete'
     and payload->>'provider' = 'cloudinary'
     and payload->>'publicId' = 'drivex/orphan-7'),
  1::bigint,
  'upload success followed by bind failure enqueues exact Cloudinary cleanup'
);
select extensions.is(
  (select payload->>'mediaAssetId' from public.jobs
   where type = 'provider.media_delete'
     and payload->>'publicId' = 'drivex/orphan-7'),
  'd7310000-0000-0000-0000-000000000007',
  'orphan cleanup retains the registry row id for deletion bookkeeping'
);

insert into public.jobs(
  id, company_id, type, payload, idempotency_key
) values (
  'f7310000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  'terminal.cleanup.test', '{}'::jsonb, 'terminal-cleanup-test'
);
set local role service_role;
select extensions.is(
  (select count(*) from public.claim_jobs(
    'terminal-cleanup-worker', array['terminal.cleanup.test'], 1
  ) where id = 'f7310000-0000-0000-0000-000000000001'),
  1::bigint,
  'service worker claims a cleanup job before terminal failure'
);
select extensions.ok(
  public.dead_letter_job(
    'f7310000-0000-0000-0000-000000000001',
    'terminal-cleanup-worker', 'invalid cleanup payload'
  ),
  'permanent cleanup failure becomes dead-letter immediately'
);
reset role;

-- Load 3 exercises two-phase reassignment.
reset role;
insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'b3100000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  'INTEGRITY-REASSIGN-1', 'in_progress', 3200, 1200
);
insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by,
  accepted_at, driver_stage
) values (
  'a5310000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000003',
  'active', '31000000-0000-0000-0000-000000000002', now(), 'in_transit'
);
update public.loads
set current_assignment_id = 'a5310000-0000-0000-0000-000000000003'
where id = 'b3100000-0000-0000-0000-000000000003';

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
create temporary table integrity_ids(reassignment_offer_id uuid);
grant all on integrity_ids to authenticated;
insert into integrity_ids values (null);
select extensions.is(
  (public.reassign_load(
    'b3100000-0000-0000-0000-000000000003',
    '31000000-0000-0000-0000-000000000004'
  )).status::text,
  'missed_offline',
  'offline reassignment is recorded without opening a handoff vacuum'
);
select extensions.is(
  (select current_assignment_id from public.loads
   where id = 'b3100000-0000-0000-0000-000000000003'),
  'a5310000-0000-0000-0000-000000000003'::uuid,
  'offline target leaves the old assignment attached to the load'
);
select extensions.is(
  (select status::text from public.assignments
   where id = 'a5310000-0000-0000-0000-000000000003'),
  'active',
  'offline target leaves the old assignment active'
);

reset role;
insert into public.driver_presence(driver_id, company_id, is_online, last_seen_at)
values (
  '31000000-0000-0000-0000-000000000004',
  'a3100000-0000-0000-0000-000000000001', true, now()
);
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
update integrity_ids
set reassignment_offer_id = (public.reassign_load(
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000004'
)).id;
select extensions.is(
  (select status::text from public.assignments
   where id = 'a5310000-0000-0000-0000-000000000003'),
  'active',
  'online offer also preserves the old assignment until acceptance'
);

set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000004';
select extensions.is(
  public.respond_offer(
    (select reassignment_offer_id from integrity_ids), 'accept',
    'c5310000-0000-0000-0000-000000000006'
  )->>'reassignment',
  'true',
  'replacement driver accepts the handoff atomically'
);
reset role;
select extensions.is(
  (select status::text from public.assignments
   where id = 'a5310000-0000-0000-0000-000000000003'),
  'reassigned',
  'old assignment closes only after replacement acceptance'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000004';
select extensions.is(
  (select a.driver_id
   from public.loads l join public.assignments a on a.id = l.current_assignment_id
   where l.id = 'b3100000-0000-0000-0000-000000000003'),
  '31000000-0000-0000-0000-000000000004'::uuid,
  'load atomically points at the replacement driver'
);
select extensions.is(
  (select a.driver_stage
   from public.loads l join public.assignments a on a.id = l.current_assignment_id
   where l.id = 'b3100000-0000-0000-0000-000000000003'),
  'in_transit',
  'reassignment preserves the execution stage'
);

-- Offline retries are generation-specific. A missed offer from the previous
-- assignment must not be returned after current_assignment_id changes.
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
select (public.reassign_load(
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000003'
)).id as first_offline_offer_id
\gset
reset role;
update public.assignments
set status = 'reassigned', ended_at = now()
where id = (
  select current_assignment_id from public.loads
  where id = 'b3100000-0000-0000-0000-000000000003'
);
insert into public.assignments(
  id, company_id, load_id, driver_id, status, assigned_by,
  accepted_at, driver_stage
) values (
  'a5310000-0000-0000-0000-000000000004',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000004', 'active',
  '31000000-0000-0000-0000-000000000002', now(), 'in_transit'
);
update public.loads
set current_assignment_id = 'a5310000-0000-0000-0000-000000000004'
where id = 'b3100000-0000-0000-0000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
select extensions.isnt(
  (public.reassign_load(
    'b3100000-0000-0000-0000-000000000003',
    '31000000-0000-0000-0000-000000000003'
  )).id,
  :'first_offline_offer_id'::uuid,
  'missed offline retry does not return an offer from an old assignment generation'
);
select extensions.is(
  (select status::text from public.offers where id = :'first_offline_offer_id'::uuid),
  'superseded',
  'old-generation missed offline offer is retired'
);
select extensions.is(
  (select count(*)
   from public.offers o
   where o.load_id = 'b3100000-0000-0000-0000-000000000003'
     and o.driver_id = '31000000-0000-0000-0000-000000000003'
     and o.status = 'missed_offline'
     and o.compatibility_warnings @> jsonb_build_array(jsonb_build_object(
       'code', 'REASSIGNMENT',
       'previousAssignmentId', 'a5310000-0000-0000-0000-000000000004'::uuid
     ))),
  1::bigint,
  'current missed offline offer records the exact assignment generation'
);

-- A stale pending offer returns and persists a structured result instead of
-- updating then raising (which would roll the update back).
reset role;
insert into public.offers(
  id, company_id, load_id, driver_id, status, loaded_miles, effective_rpm,
  compatibility_warnings, created_by
) values (
  'e5310000-0000-0000-0000-000000000011',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000003', 'pending', 1200, 2.66,
  '[]'::jsonb, '31000000-0000-0000-0000-000000000002'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  public.respond_offer(
    'e5310000-0000-0000-0000-000000000011', 'decline',
    'c5310000-0000-0000-0000-000000000011', now(),
    'Pickup appointment conflicts with HOS'
  )->>'reason',
  'Pickup appointment conflicts with HOS',
  'driver decline response preserves the supplied reason'
);
reset role;
select extensions.is(
  (select new_value->>'reason' from public.audit_events
   where action = 'offer.declined'
     and entity_id = 'e5310000-0000-0000-0000-000000000011'),
  'Pickup appointment conflicts with HOS',
  'offer decline audit preserves the driver reason'
);

insert into public.offers(
  id, company_id, load_id, driver_id, status, loaded_miles, effective_rpm,
  compatibility_warnings, created_by
) values (
  'e5310000-0000-0000-0000-000000000010',
  'a3100000-0000-0000-0000-000000000001',
  'b3100000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000003', 'pending', 1200, 2.66,
  jsonb_build_array(jsonb_build_object(
    'code', 'REASSIGNMENT',
    'previousAssignmentId', 'a5310000-0000-0000-0000-000000000003'::uuid
  )),
  '31000000-0000-0000-0000-000000000002'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  public.respond_offer(
    'e5310000-0000-0000-0000-000000000010', 'accept',
    'c5310000-0000-0000-0000-000000000010'
  )->>'reason',
  'active_assignment_changed',
  'stale reassignment returns a structured superseded result'
);
select extensions.is(
  (select status::text from public.offers
   where id = 'e5310000-0000-0000-0000-000000000010'),
  'superseded',
  'stale offer supersession is committed rather than rolled back'
);
select extensions.is(
  public.respond_offer(
    'e5310000-0000-0000-0000-000000000010', 'accept',
    'c5310000-0000-0000-0000-000000000010'
  )->>'reason',
  'active_assignment_changed',
  'stale response retry returns the persisted client operation result'
);
reset role;
select extensions.is(
  (select status::text from public.client_operations
   where operation_id = 'c5310000-0000-0000-0000-000000000010'),
  'rejected',
  'stale response is durably recorded as a rejected client operation'
);

-- RLS: drivers see only themselves/their own mapping; selected dispatchers see
-- only drivers authorized by can_access_driver.
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  (select count(*) from public.driver_profiles),
  1::bigint,
  'driver_profiles RLS exposes only the driver own row'
);
select extensions.is(
  (select count(*) from public.dispatcher_driver_access),
  1::bigint,
  'dispatcher mapping RLS exposes only the driver own mapping'
);

set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
select extensions.is(
  (select count(*) from public.driver_profiles),
  2::bigint,
  'dispatcher initially sees both explicitly selected drivers'
);
reset role;
delete from public.dispatcher_driver_access
where dispatcher_id = '31000000-0000-0000-0000-000000000002'
  and driver_id = '31000000-0000-0000-0000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000002';
select extensions.is(
  (select count(*) from public.driver_profiles),
  1::bigint,
  'selected dispatcher cannot read an unscoped driver profile'
);

select extensions.ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'warnings'
  ),
  'warnings is published to Supabase Realtime'
);
select extensions.ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ),
  'profiles are published for tenant-scoped member refreshes'
);
select extensions.ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_profiles'
  ),
  'driver profiles are published for equipment and avatar refreshes'
);

-- Push registration is self-scoped and every notification creates one durable
-- outbox job for a trusted provider worker.
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  (public.register_push_device(
    'push-token-driver-one-1234567890', 'android'
  )).platform,
  'android',
  'authenticated user can register an own push token'
);
select extensions.is(
  (select count(*) from public.push_devices),
  1::bigint,
  'push device RLS exposes the user own token only'
);

reset role;
insert into public.notifications(
  id, company_id, recipient_id, type, title, body
) values (
  'f5310000-0000-0000-0000-000000000003',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000003',
  'account_switch_test', 'Old account', 'Must not cross account boundary'
);
select extensions.is(
  (select count(*) from public.push_deliveries
   where notification_id = 'f5310000-0000-0000-0000-000000000003'),
  1::bigint,
  'notification fans out to one durable per-device delivery'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select public.register_push_device(
  concat('push-token-driver-one-extra-', lpad(g::text, 2, '0')), 'android'
)
from generate_series(1, 9) g;
select extensions.throws_ok(
  $$select public.register_push_device(
    'push-token-driver-one-over-cap-11', 'android'
  )$$,
  'P0001',
  'A maximum of 10 active push devices is allowed per user',
  'atomic registration enforces the ten active device cap'
);

set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000004';
select extensions.is(
  (select count(*) from public.push_devices),
  0::bigint,
  'another user cannot read the registered push token'
);
select extensions.is(
  (public.register_push_device(
    'push-token-driver-one-1234567890', 'ios'
  )).user_id,
  '31000000-0000-0000-0000-000000000004'::uuid,
  'registering after an account switch atomically transfers token ownership'
);
select extensions.is(
  (select count(*) from public.push_devices),
  1::bigint,
  'new token owner receives only the transferred own row'
);
reset role;
select extensions.is(
  (select status from public.push_deliveries
   where notification_id = 'f5310000-0000-0000-0000-000000000003'),
  'cancelled',
  'account switch atomically cancels old-recipient pending delivery'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000003';
select extensions.is(
  (select count(*) from public.push_devices
   where token = 'push-token-driver-one-1234567890'),
  0::bigint,
  'previous account cannot read a token after ownership transfer'
);
select extensions.ok(
  not public.unregister_push_device('push-token-driver-one-1234567890'),
  'previous account cannot unregister the transferred token'
);

reset role;
insert into public.notifications(
  id, company_id, recipient_id, type, title, body, entity_type, entity_id
) values (
  'f5310000-0000-0000-0000-000000000001',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  'test_push', 'Test push', 'Outbox test', 'load',
  'b3100000-0000-0000-0000-000000000001'
);
select extensions.is(
  (select count(*) from public.jobs
   where type = 'push.notification'
     and idempotency_key = 'push-notification:f5310000-0000-0000-0000-000000000001'),
  0::bigint,
  'notification fanout does not leave a redundant generic push job'
);

insert into public.notifications(
  id, company_id, recipient_id, type, title, body, entity_type, entity_id
) values (
  'f5310000-0000-0000-0000-000000000002',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000004',
  'delivery_state_test', 'Delivery state', 'Claim exactly once', 'load',
  'b3100000-0000-0000-0000-000000000001'
);
select device_id as push_delivery_device_id
from public.push_deliveries
where notification_id = 'f5310000-0000-0000-0000-000000000002'
\gset
set local role service_role;
select extensions.is(
  (select count(*) from public.claim_push_deliveries('push-test-worker', 1)),
  1::bigint,
  'service worker atomically claims one pending device delivery'
);
select extensions.ok(
  public.fail_push_delivery(
    'f5310000-0000-0000-0000-000000000002',
    :'push_delivery_device_id'::uuid,
    'push-test-worker', 'temporary provider error', interval '1 second'
  ),
  'claimed delivery can be failed with bounded retry state'
);
update public.push_deliveries
set next_attempt_at = now()
where notification_id = 'f5310000-0000-0000-0000-000000000002';
select extensions.is(
  (select count(*) from public.claim_push_deliveries('push-test-worker', 1)),
  1::bigint,
  'failed delivery can be reclaimed without creating a duplicate row'
);
select extensions.ok(
  public.complete_push_delivery(
    'f5310000-0000-0000-0000-000000000002',
    :'push_delivery_device_id'::uuid,
    'push-test-worker', 'provider-message-1'
  ),
  'claimed delivery can be completed by its lock owner'
);
select extensions.is(
  (select count(*) from public.push_deliveries
   where notification_id = 'f5310000-0000-0000-0000-000000000002'
     and status = 'sent'),
  1::bigint,
  'retry keeps one unique delivery row and ends in sent state'
);

reset role;
insert into public.notifications(
  id, company_id, recipient_id, type, title, body
) values (
  'f5310000-0000-0000-0000-000000000005',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000004',
  'stale_lease_test', 'Stale lease', 'Recover this delivery'
);
select device_id as stale_delivery_device_id
from public.push_deliveries
where notification_id = 'f5310000-0000-0000-0000-000000000005'
\gset
set local role service_role;
select extensions.is(
  (select count(*) from public.claim_push_deliveries('crashed-worker', 1)),
  1::bigint,
  'worker claims the delivery used for stale lease recovery'
);
update public.push_deliveries
set locked_at = now() - interval '6 minutes'
where notification_id = 'f5310000-0000-0000-0000-000000000005';
select extensions.is(
  (select count(*) from public.claim_push_deliveries('recovery-worker', 1)),
  1::bigint,
  'a stale processing delivery is atomically reclaimed after its lease'
);
select extensions.ok(
  public.complete_push_delivery(
    'f5310000-0000-0000-0000-000000000005',
    :'stale_delivery_device_id'::uuid,
    'recovery-worker', 'provider-message-after-recovery'
  ),
  'recovered delivery can be completed by the new lock owner'
);

reset role;
insert into public.notifications(
  id, company_id, recipient_id, type, title, body
) values (
  'f5310000-0000-0000-0000-000000000004',
  'a3100000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000004',
  'permanent_failure_test', 'Permanent failure', 'Cancel this delivery'
);
select device_id as permanent_failure_device_id
from public.push_deliveries
where notification_id = 'f5310000-0000-0000-0000-000000000004'
\gset
set local role service_role;
select extensions.is(
  (select count(*) from public.claim_push_deliveries('push-test-worker', 1)),
  1::bigint,
  'worker claims the delivery used for permanent failure handling'
);
select extensions.ok(
  public.fail_push_delivery(
    'f5310000-0000-0000-0000-000000000004',
    :'permanent_failure_device_id'::uuid,
    'push-test-worker', 'provider says token is invalid', interval '1 minute',
    false
  ),
  'worker records a non-retryable provider failure'
);
select extensions.is(
  (select status from public.push_deliveries
   where notification_id = 'f5310000-0000-0000-0000-000000000004'),
  'cancelled',
  'non-retryable push failure becomes terminal immediately'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '31000000-0000-0000-0000-000000000004';
select extensions.ok(
  public.unregister_push_device('push-token-driver-one-1234567890'),
  'new owner can unregister the transferred push token'
);
select extensions.is(
  (select count(*) from public.push_devices),
  0::bigint,
  'unregister removes the push token'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.push_deliveries', 'SELECT'),
  'authenticated clients cannot inspect provider delivery state'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated', 'public.claim_push_deliveries(text,integer)', 'EXECUTE'
  ),
  'authenticated clients cannot claim push deliveries'
);

-- Rate-limit state is service-only and atomically rejects requests above limit.
select extensions.ok(
  not has_table_privilege('authenticated', 'public.edge_rate_limits', 'SELECT'),
  'authenticated clients cannot inspect rate-limit counters'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_edge_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot consume service rate-limit buckets'
);
reset role;
set local role service_role;
select extensions.ok(
  public.consume_edge_rate_limit('test.edge', 'actor-one', 2, 60),
  'first distributed rate-limit request is allowed'
);
select extensions.ok(
  public.consume_edge_rate_limit('test.edge', 'actor-one', 2, 60),
  'second distributed rate-limit request is allowed'
);
select extensions.ok(
  not public.consume_edge_rate_limit('test.edge', 'actor-one', 2, 60),
  'request above the distributed limit is rejected'
);
insert into public.edge_rate_limits(
  scope, actor, window_started_at, request_count, updated_at
) values (
  'expired.edge', 'old-actor', now() - interval '3 days', 1,
  now() - interval '3 days'
);
select extensions.is(
  public.cleanup_edge_rate_limits(interval '2 days', 100),
  1,
  'service cleanup removes expired distributed rate-limit buckets'
);
select extensions.ok(
  not exists (
    select 1 from public.edge_rate_limits
    where scope = 'expired.edge' and actor = 'old-actor'
  ),
  'expired rate-limit state is absent after bounded cleanup'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.cleanup_edge_rate_limits(interval,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke rate-limit retention cleanup'
);

reset role;
select * from extensions.finish();
rollback;
