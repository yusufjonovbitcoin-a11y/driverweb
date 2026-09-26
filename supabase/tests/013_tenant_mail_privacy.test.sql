begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('d1000000-0000-0000-0000-000000000001'::uuid, 'platform@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000002'::uuid, 'admin-a@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000003'::uuid, 'admin-b@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000004'::uuid, 'scoped-platform@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000005'::uuid, 'dispatcher-a@mail-privacy.test')
) as users(id, email);

insert into public.companies(id, name) values
  ('d2000000-0000-0000-0000-000000000001', 'Mail Privacy A'),
  ('d2000000-0000-0000-0000-000000000002', 'Mail Privacy B');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('d1000000-0000-0000-0000-000000000001', null, 'super_admin', 'Platform Admin', 'platform@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'company_admin', 'Company Admin A', 'admin-a@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000002', 'company_admin', 'Company Admin B', 'admin-b@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 'super_admin', 'Scoped Platform Admin', 'scoped-platform@mail-privacy.test'),
  ('d1000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000001', 'dispatcher', 'Dispatcher A', 'dispatcher-a@mail-privacy.test');

insert into public.gmail_connections(id, company_id, mailbox_email, secret_reference, created_by) values
  ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'loads-a@example.test', 'vault://mail-a', 'd1000000-0000-0000-0000-000000000002'),
  ('d3000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'loads-b@example.test', 'vault://mail-b', 'd1000000-0000-0000-0000-000000000003');

insert into public.broker_messages(id, company_id, gmail_connection_id, provider_message_id, from_email, subject, received_at) values
  ('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'privacy-message-a', 'broker-a@example.test', 'Private A', now()),
  ('d4000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'privacy-message-b', 'broker-b@example.test', 'Private B', now());

insert into public.broker_attachments(id, company_id, message_id, file_name, mime_type, storage_path, checksum_sha256) values
  ('d5000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'private-a.pdf', 'application/pdf', 'mail-a/private-a.pdf', 'privacy-checksum-a'),
  ('d5000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'private-b.pdf', 'application/pdf', 'mail-b/private-b.pdf', 'privacy-checksum-b');

insert into public.ai_extractions(id, company_id, message_id, attachment_id, status, result) values
  ('d6000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'extracted', '{"loadNumber":"PRIVATE-A"}'),
  ('d6000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'd5000000-0000-0000-0000-000000000002', 'extracted', '{"loadNumber":"PRIVATE-B"}');

insert into public.ai_extraction_fields(id, extraction_id, company_id, field_name, extracted_value) values
  ('d7000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'loadNumber', '"PRIVATE-A"'),
  ('d7000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'loadNumber', '"PRIVATE-B"');

insert into storage.objects(id, bucket_id, name, owner) values (
  'd8000000-0000-0000-0000-000000000001',
  'broker-originals',
  'd2000000-0000-0000-0000-000000000001/private-message.eml',
  'd1000000-0000-0000-0000-000000000002'
);

insert into public.media_assets(
  id, company_id, uploaded_by, scope, cloudinary_asset_id, public_id,
  resource_type, delivery_type, version, format, file_name, mime_type, size_bytes
) values (
  'd9000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000002',
  'gmail_raw', 'privacy-gmail-raw-1', 'drivex/privacy-gmail-raw-1',
  'raw', 'authenticated', 1, 'eml', 'private-message.eml', 'message/rfc822', 512
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000001';

select extensions.is((select count(*) from public.gmail_connections), 0::bigint, 'super admin cannot read tenant Gmail connections');
select extensions.is((select count(*) from public.broker_messages), 0::bigint, 'super admin cannot read tenant broker messages');
select extensions.is((select count(*) from public.broker_attachments), 0::bigint, 'super admin cannot read tenant broker attachments');
select extensions.is((select count(*) from public.ai_extractions), 0::bigint, 'super admin cannot read tenant mail extraction results');
select extensions.is((select count(*) from public.ai_extraction_fields), 0::bigint, 'super admin cannot read tenant mail extraction fields');
select extensions.is((select count(*) from storage.objects where bucket_id = 'broker-originals'), 0::bigint, 'super admin cannot read raw tenant Gmail files');
select extensions.is((select count(*) from public.media_assets where scope = 'gmail_raw'), 0::bigint, 'super admin cannot read migrated tenant Gmail media');

set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000004';

select extensions.is((select count(*) from public.broker_messages), 0::bigint, 'company-scoped super admin still cannot read broker messages');
select extensions.is((select count(*) from storage.objects where bucket_id = 'broker-originals'), 0::bigint, 'company-scoped super admin cannot read raw Gmail files');
select extensions.is((select count(*) from public.media_assets where scope = 'gmail_raw'), 0::bigint, 'company-scoped super admin cannot read migrated Gmail media');

set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000002';

select extensions.is((select id from public.gmail_connections), 'd3000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact Gmail connection');
select extensions.is((select id from public.broker_messages), 'd4000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact broker message');
select extensions.is((select id from public.broker_attachments), 'd5000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact broker attachment');
select extensions.is((select id from public.ai_extractions), 'd6000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact mail extraction');
select extensions.is((select id from public.ai_extraction_fields), 'd7000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact extraction field');
select extensions.is((select id from storage.objects where bucket_id = 'broker-originals'), 'd8000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact raw Gmail file');
select extensions.is((select id from public.media_assets where scope = 'gmail_raw'), 'd9000000-0000-0000-0000-000000000001'::uuid, 'company admin sees its exact migrated Gmail media');

set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000003';
select extensions.is((select id from public.broker_messages), 'd4000000-0000-0000-0000-000000000002'::uuid, 'another company admin sees only its own broker message');

set local "request.jwt.claim.sub" = 'd1000000-0000-0000-0000-000000000005';
select extensions.is((select id from public.broker_messages), 'd4000000-0000-0000-0000-000000000001'::uuid, 'dispatcher sees only its company broker message');
select extensions.is((select id from storage.objects where bucket_id = 'broker-originals'), 'd8000000-0000-0000-0000-000000000001'::uuid, 'dispatcher sees only its company raw Gmail file');
select extensions.is((select id from public.media_assets where scope = 'gmail_raw'), 'd9000000-0000-0000-0000-000000000001'::uuid, 'dispatcher sees only its company migrated Gmail media');

select * from extensions.finish();
rollback;
