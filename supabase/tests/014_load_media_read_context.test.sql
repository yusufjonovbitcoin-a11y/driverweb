begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), now(), now()
from (values
  ('e1000000-0000-0000-0000-000000000001'::uuid, 'admin-a@load-media.test'),
  ('e1000000-0000-0000-0000-000000000002'::uuid, 'admin-b@load-media.test')
) as users(id, email);

insert into public.companies(id, name) values
  ('e2000000-0000-0000-0000-000000000001', 'Load Media A'),
  ('e2000000-0000-0000-0000-000000000002', 'Load Media B');

insert into public.profiles(id, company_id, role, full_name, email) values
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'company_admin', 'Admin A', 'admin-a@load-media.test'),
  ('e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002', 'company_admin', 'Admin B', 'admin-b@load-media.test');

insert into public.loads(
  id, company_id, owner_dispatcher_id, load_number, status,
  broker_rate, loaded_miles
) values (
  'e3000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'MEDIA-A', 'ready_for_offer', 1500, 600
);

insert into public.documents(id, company_id, load_id, document_type, created_by) values
  ('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'rate_confirmation', 'e1000000-0000-0000-0000-000000000001');

insert into public.document_versions(id, company_id, document_id, version_number, file_name, mime_type, storage_path, uploaded_by) values
  ('e5000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 1, 'rate.pdf', 'application/pdf', 'cloudinary:e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001');

update public.documents
set current_version_id = 'e5000000-0000-0000-0000-000000000001'
where id = 'e4000000-0000-0000-0000-000000000001';

insert into public.media_assets(
  id, company_id, uploaded_by, scope, context_id, cloudinary_asset_id, public_id,
  resource_type, delivery_type, version, format, file_name, mime_type, size_bytes
) values
  ('e6000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'load_document', 'e5000000-0000-0000-0000-000000000001', 'version-context', 'drivex/version-context', 'raw', 'authenticated', 1, 'pdf', 'rate.pdf', 'application/pdf', 512),
  ('e6000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'load_document', 'e3000000-0000-0000-0000-000000000001', 'load-context', 'drivex/load-context', 'raw', 'authenticated', 1, 'pdf', 'legacy-rate.pdf', 'application/pdf', 512);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select extensions.is(
  (select array_agg(id order by id) from public.media_assets where scope = 'load_document'),
  array[
    'e6000000-0000-0000-0000-000000000001'::uuid,
    'e6000000-0000-0000-0000-000000000002'::uuid
  ],
  'company admin can read load media keyed by either document version or load ID'
);

set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select extensions.is(
  (select count(*) from public.media_assets where scope = 'load_document'),
  0::bigint,
  'another company cannot read load media through either context form'
);

select * from extensions.finish();
rollback;
